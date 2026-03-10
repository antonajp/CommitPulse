/**
 * Parameterized SQL queries for the Code Review Velocity dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against the vw_code_review_velocity view and the
 * pull_request/pull_request_review tables created by migration 012.
 *
 * Key metrics:
 *   1. Hours to first review - how long PRs wait before first review
 *   2. Hours to merge - total time from creation to merge
 *   3. Review cycles - number of "changes requested" events
 *   4. Size category - XS/S/M/L/XL based on lines changed
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-899
 */

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Applied as LIMIT in each query.
 */
export const CODE_REVIEW_MAX_RESULT_ROWS = 1000;

// ============================================================================
// Pull Request Upsert Queries
// ============================================================================

/**
 * Upsert a pull request record.
 * Parameters:
 *   $1  - repository (TEXT)
 *   $2  - pr_number (INTEGER)
 *   $3  - github_id (BIGINT)
 *   $4  - title (TEXT)
 *   $5  - author (TEXT)
 *   $6  - state (TEXT) - open, closed, merged
 *   $7  - created_at (TIMESTAMP WITH TIME ZONE)
 *   $8  - updated_at (TIMESTAMP WITH TIME ZONE)
 *   $9  - first_review_at (TIMESTAMP WITH TIME ZONE)
 *   $10 - merged_at (TIMESTAMP WITH TIME ZONE)
 *   $11 - closed_at (TIMESTAMP WITH TIME ZONE)
 *   $12 - merge_sha (TEXT)
 *   $13 - head_branch (TEXT)
 *   $14 - base_branch (TEXT)
 *   $15 - additions (INTEGER)
 *   $16 - deletions (INTEGER)
 *   $17 - changed_files (INTEGER)
 *   $18 - review_cycles (INTEGER)
 *   $19 - linked_ticket_id (TEXT)
 *   $20 - linked_ticket_type (TEXT) - jira, linear
 */
export const QUERY_UPSERT_PULL_REQUEST = `
  INSERT INTO pull_request (
    repository, pr_number, github_id, title, author, state,
    created_at, updated_at, first_review_at, merged_at, closed_at,
    merge_sha, head_branch, base_branch,
    additions, deletions, changed_files, review_cycles,
    linked_ticket_id, linked_ticket_type
  ) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11,
    $12, $13, $14,
    $15, $16, $17, $18,
    $19, $20
  )
  ON CONFLICT (repository, pr_number) DO UPDATE SET
    github_id = EXCLUDED.github_id,
    title = EXCLUDED.title,
    author = EXCLUDED.author,
    state = EXCLUDED.state,
    updated_at = EXCLUDED.updated_at,
    first_review_at = COALESCE(pull_request.first_review_at, EXCLUDED.first_review_at),
    merged_at = EXCLUDED.merged_at,
    closed_at = EXCLUDED.closed_at,
    merge_sha = EXCLUDED.merge_sha,
    head_branch = EXCLUDED.head_branch,
    base_branch = EXCLUDED.base_branch,
    additions = EXCLUDED.additions,
    deletions = EXCLUDED.deletions,
    changed_files = EXCLUDED.changed_files,
    review_cycles = EXCLUDED.review_cycles,
    linked_ticket_id = EXCLUDED.linked_ticket_id,
    linked_ticket_type = EXCLUDED.linked_ticket_type
  RETURNING id
`;

/**
 * Get pull request ID by repository and PR number.
 * Parameters:
 *   $1 - repository (TEXT)
 *   $2 - pr_number (INTEGER)
 */
export const QUERY_GET_PR_ID = `
  SELECT id FROM pull_request
  WHERE repository = $1 AND pr_number = $2
`;

/**
 * Upsert a pull request review record.
 * Parameters:
 *   $1 - pull_request_id (INTEGER)
 *   $2 - github_id (BIGINT)
 *   $3 - reviewer (TEXT)
 *   $4 - state (TEXT) - approved, changes_requested, commented, dismissed
 *   $5 - submitted_at (TIMESTAMP WITH TIME ZONE)
 *   $6 - body (TEXT)
 */
export const QUERY_UPSERT_PR_REVIEW = `
  INSERT INTO pull_request_review (
    pull_request_id, github_id, reviewer, state, submitted_at, body
  ) VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (github_id) DO UPDATE SET
    reviewer = EXCLUDED.reviewer,
    state = EXCLUDED.state,
    submitted_at = EXCLUDED.submitted_at,
    body = EXCLUDED.body
`;

/**
 * Update first_review_at on pull_request if not already set.
 * Parameters:
 *   $1 - pull_request_id (INTEGER)
 */
export const QUERY_UPDATE_FIRST_REVIEW_AT = `
  UPDATE pull_request
  SET first_review_at = (
    SELECT MIN(submitted_at)
    FROM pull_request_review
    WHERE pull_request_id = $1
  )
  WHERE id = $1 AND first_review_at IS NULL
`;

/**
 * Update review_cycles count on pull_request.
 * Parameters:
 *   $1 - pull_request_id (INTEGER)
 */
export const QUERY_UPDATE_REVIEW_CYCLES = `
  UPDATE pull_request
  SET review_cycles = (
    SELECT COUNT(*)::INT
    FROM pull_request_review
    WHERE pull_request_id = $1 AND state = 'changes_requested'
  )
  WHERE id = $1
`;

// ============================================================================
// Code Review Velocity Queries
// ============================================================================

/**
 * Query to fetch all Code Review Velocity metrics from the view.
 * Returns PRs ordered by created_at DESC (most recent first).
 * Limited to CODE_REVIEW_MAX_RESULT_ROWS for safety.
 */
export const QUERY_CODE_REVIEW_VELOCITY = `
  SELECT
    id,
    repository,
    pr_number,
    title,
    author,
    state,
    created_at,
    updated_at,
    first_review_at,
    merged_at,
    closed_at,
    head_branch,
    base_branch,
    additions,
    deletions,
    loc_changed,
    changed_files,
    review_cycles,
    linked_ticket_id,
    linked_ticket_type,
    hours_to_first_review,
    hours_to_merge,
    hours_review_to_merge,
    size_category,
    first_reviewer
  FROM vw_code_review_velocity
  ORDER BY created_at DESC
  LIMIT ${CODE_REVIEW_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Code Review Velocity metrics with date range filter.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 */
export const QUERY_CODE_REVIEW_VELOCITY_DATE_RANGE = `
  SELECT
    id,
    repository,
    pr_number,
    title,
    author,
    state,
    created_at,
    updated_at,
    first_review_at,
    merged_at,
    closed_at,
    head_branch,
    base_branch,
    additions,
    deletions,
    loc_changed,
    changed_files,
    review_cycles,
    linked_ticket_id,
    linked_ticket_type,
    hours_to_first_review,
    hours_to_merge,
    hours_review_to_merge,
    size_category,
    first_reviewer
  FROM vw_code_review_velocity
  WHERE created_at >= $1 AND created_at <= $2
  ORDER BY created_at DESC
  LIMIT ${CODE_REVIEW_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Code Review Velocity metrics with repository filter.
 * Parameters:
 *   $1 - repository (TEXT)
 */
export const QUERY_CODE_REVIEW_VELOCITY_REPOSITORY = `
  SELECT
    id,
    repository,
    pr_number,
    title,
    author,
    state,
    created_at,
    updated_at,
    first_review_at,
    merged_at,
    closed_at,
    head_branch,
    base_branch,
    additions,
    deletions,
    loc_changed,
    changed_files,
    review_cycles,
    linked_ticket_id,
    linked_ticket_type,
    hours_to_first_review,
    hours_to_merge,
    hours_review_to_merge,
    size_category,
    first_reviewer
  FROM vw_code_review_velocity
  WHERE repository = $1
  ORDER BY created_at DESC
  LIMIT ${CODE_REVIEW_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Code Review Velocity metrics with author filter.
 * Parameters:
 *   $1 - author (TEXT)
 */
export const QUERY_CODE_REVIEW_VELOCITY_AUTHOR = `
  SELECT
    id,
    repository,
    pr_number,
    title,
    author,
    state,
    created_at,
    updated_at,
    first_review_at,
    merged_at,
    closed_at,
    head_branch,
    base_branch,
    additions,
    deletions,
    loc_changed,
    changed_files,
    review_cycles,
    linked_ticket_id,
    linked_ticket_type,
    hours_to_first_review,
    hours_to_merge,
    hours_review_to_merge,
    size_category,
    first_reviewer
  FROM vw_code_review_velocity
  WHERE author = $1
  ORDER BY created_at DESC
  LIMIT ${CODE_REVIEW_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Code Review Velocity metrics with size category filter.
 * Parameters:
 *   $1 - size_category (TEXT) - XS, S, M, L, XL
 */
export const QUERY_CODE_REVIEW_VELOCITY_SIZE = `
  SELECT
    id,
    repository,
    pr_number,
    title,
    author,
    state,
    created_at,
    updated_at,
    first_review_at,
    merged_at,
    closed_at,
    head_branch,
    base_branch,
    additions,
    deletions,
    loc_changed,
    changed_files,
    review_cycles,
    linked_ticket_id,
    linked_ticket_type,
    hours_to_first_review,
    hours_to_merge,
    hours_review_to_merge,
    size_category,
    first_reviewer
  FROM vw_code_review_velocity
  WHERE size_category = $1
  ORDER BY created_at DESC
  LIMIT ${CODE_REVIEW_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Code Review Velocity metrics for merged PRs only.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 */
export const QUERY_CODE_REVIEW_VELOCITY_MERGED = `
  SELECT
    id,
    repository,
    pr_number,
    title,
    author,
    state,
    created_at,
    updated_at,
    first_review_at,
    merged_at,
    closed_at,
    head_branch,
    base_branch,
    additions,
    deletions,
    loc_changed,
    changed_files,
    review_cycles,
    linked_ticket_id,
    linked_ticket_type,
    hours_to_first_review,
    hours_to_merge,
    hours_review_to_merge,
    size_category,
    first_reviewer
  FROM vw_code_review_velocity
  WHERE state = 'merged'
    AND (created_at >= $1 OR $1 IS NULL)
    AND (created_at <= $2 OR $2 IS NULL)
  ORDER BY created_at DESC
  LIMIT ${CODE_REVIEW_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Code Review Velocity metrics with combined filters.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 *   $3 - repository (TEXT, nullable)
 *   $4 - author (TEXT, nullable)
 *   $5 - size_category (TEXT, nullable)
 */
export const QUERY_CODE_REVIEW_VELOCITY_COMBINED = `
  SELECT
    id,
    repository,
    pr_number,
    title,
    author,
    state,
    created_at,
    updated_at,
    first_review_at,
    merged_at,
    closed_at,
    head_branch,
    base_branch,
    additions,
    deletions,
    loc_changed,
    changed_files,
    review_cycles,
    linked_ticket_id,
    linked_ticket_type,
    hours_to_first_review,
    hours_to_merge,
    hours_review_to_merge,
    size_category,
    first_reviewer
  FROM vw_code_review_velocity
  WHERE created_at >= $1 AND created_at <= $2
    AND (repository = $3 OR $3 IS NULL)
    AND (author = $4 OR $4 IS NULL)
    AND (size_category = $5 OR $5 IS NULL)
  ORDER BY created_at DESC
  LIMIT ${CODE_REVIEW_MAX_RESULT_ROWS}
`;

/**
 * Query to check if the vw_code_review_velocity view exists.
 * Used for graceful degradation if migration 012 has not been applied.
 */
export const QUERY_CODE_REVIEW_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_code_review_velocity'
  ) AS view_exists
`;

/**
 * Query to check if pull_request table exists.
 */
export const QUERY_PULL_REQUEST_TABLE_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'pull_request'
  ) AS table_exists
`;

/**
 * Query to get PR sync statistics.
 * Returns count of PRs by state.
 */
export const QUERY_PR_STATS = `
  SELECT
    COUNT(*)::INT AS total_prs,
    COUNT(CASE WHEN state = 'merged' THEN 1 END)::INT AS merged_prs,
    COUNT(CASE WHEN state = 'open' THEN 1 END)::INT AS open_prs,
    COUNT(CASE WHEN state = 'closed' AND state != 'merged' THEN 1 END)::INT AS closed_prs,
    COUNT(CASE WHEN first_review_at IS NOT NULL THEN 1 END)::INT AS prs_with_reviews
  FROM pull_request
`;

/**
 * Query to get average metrics by repository.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE, nullable)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE, nullable)
 */
export const QUERY_AVG_METRICS_BY_REPOSITORY = `
  SELECT
    repository,
    COUNT(*)::INT AS pr_count,
    AVG(hours_to_first_review)::NUMERIC(10, 2) AS avg_hours_to_first_review,
    AVG(hours_to_merge)::NUMERIC(10, 2) AS avg_hours_to_merge,
    AVG(review_cycles)::NUMERIC(10, 2) AS avg_review_cycles,
    AVG(loc_changed)::INT AS avg_loc_changed
  FROM vw_code_review_velocity
  WHERE state = 'merged'
    AND (created_at >= $1 OR $1 IS NULL)
    AND (created_at <= $2 OR $2 IS NULL)
  GROUP BY repository
  ORDER BY pr_count DESC
`;

/**
 * Query to get average metrics by author.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE, nullable)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE, nullable)
 */
export const QUERY_AVG_METRICS_BY_AUTHOR = `
  SELECT
    author,
    COUNT(*)::INT AS pr_count,
    AVG(hours_to_first_review)::NUMERIC(10, 2) AS avg_hours_to_first_review,
    AVG(hours_to_merge)::NUMERIC(10, 2) AS avg_hours_to_merge,
    AVG(review_cycles)::NUMERIC(10, 2) AS avg_review_cycles,
    AVG(loc_changed)::INT AS avg_loc_changed
  FROM vw_code_review_velocity
  WHERE state = 'merged'
    AND (created_at >= $1 OR $1 IS NULL)
    AND (created_at <= $2 OR $2 IS NULL)
  GROUP BY author
  ORDER BY pr_count DESC
`;

/**
 * Query to get average metrics by size category.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE, nullable)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE, nullable)
 */
export const QUERY_AVG_METRICS_BY_SIZE = `
  SELECT
    size_category,
    COUNT(*)::INT AS pr_count,
    AVG(hours_to_first_review)::NUMERIC(10, 2) AS avg_hours_to_first_review,
    AVG(hours_to_merge)::NUMERIC(10, 2) AS avg_hours_to_merge,
    AVG(review_cycles)::NUMERIC(10, 2) AS avg_review_cycles,
    AVG(loc_changed)::INT AS avg_loc_changed
  FROM vw_code_review_velocity
  WHERE state = 'merged'
    AND (created_at >= $1 OR $1 IS NULL)
    AND (created_at <= $2 OR $2 IS NULL)
  GROUP BY size_category
  ORDER BY
    CASE size_category
      WHEN 'XS' THEN 1
      WHEN 'S' THEN 2
      WHEN 'M' THEN 3
      WHEN 'L' THEN 4
      WHEN 'XL' THEN 5
    END
`;

// ============================================================================
// TypeScript Interfaces
// ============================================================================

/**
 * TypeScript interface for Code Review Velocity row.
 * Maps 1:1 to vw_code_review_velocity view columns.
 */
export interface CodeReviewVelocityRow {
  readonly id: number;
  readonly repository: string;
  readonly pr_number: number;
  readonly title: string;
  readonly author: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly created_at: Date;
  readonly updated_at: Date | null;
  readonly first_review_at: Date | null;
  readonly merged_at: Date | null;
  readonly closed_at: Date | null;
  readonly head_branch: string | null;
  readonly base_branch: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly loc_changed: number;
  readonly changed_files: number;
  readonly review_cycles: number;
  readonly linked_ticket_id: string | null;
  readonly linked_ticket_type: 'jira' | 'linear' | null;
  readonly hours_to_first_review: number | null;
  readonly hours_to_merge: number | null;
  readonly hours_review_to_merge: number | null;
  readonly size_category: 'XS' | 'S' | 'M' | 'L' | 'XL';
  readonly first_reviewer: string | null;
}

/**
 * TypeScript interface for PR ID lookup result.
 */
export interface PullRequestIdRow {
  readonly id: number;
}

/**
 * TypeScript interface for PR upsert result.
 */
export interface PullRequestUpsertRow {
  readonly id: number;
}

/**
 * TypeScript interface for view existence check.
 */
export interface ViewExistsRow {
  readonly view_exists: boolean;
}

/**
 * TypeScript interface for table existence check.
 */
export interface TableExistsRow {
  readonly table_exists: boolean;
}

/**
 * TypeScript interface for PR statistics.
 */
export interface PRStatsRow {
  readonly total_prs: number;
  readonly merged_prs: number;
  readonly open_prs: number;
  readonly closed_prs: number;
  readonly prs_with_reviews: number;
}

/**
 * TypeScript interface for average metrics by grouping.
 */
export interface AvgMetricsRow {
  readonly repository?: string;
  readonly author?: string;
  readonly size_category?: 'XS' | 'S' | 'M' | 'L' | 'XL';
  readonly pr_count: number;
  readonly avg_hours_to_first_review: number | null;
  readonly avg_hours_to_merge: number | null;
  readonly avg_review_cycles: number | null;
  readonly avg_loc_changed: number | null;
}
