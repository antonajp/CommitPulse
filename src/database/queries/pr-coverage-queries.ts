/**
 * Parameterized SQL queries for the PR Coverage Report dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against the vw_pr_coverage views and the
 * commit_pull_request junction table created by migration 031.
 *
 * Key metrics:
 *   1. PR coverage percentage - (PR-linked / total) * 100
 *   2. Orphan commits - commits without associated PRs
 *   3. Weekly coverage trends
 *   4. Per-author and per-branch breakdowns
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: GITX-221
 */

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Applied as LIMIT in each query.
 */
export const PR_COVERAGE_MAX_RESULT_ROWS = 1000;

// ============================================================================
// View Existence Check
// ============================================================================

/**
 * Query to check if the vw_pr_coverage view exists.
 * Used for graceful degradation if migration 031 has not been applied.
 */
export const QUERY_PR_COVERAGE_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_pr_coverage'
  ) AS view_exists
`;

/**
 * Query to check if the pull_request table has any rows.
 * Used to detect the 0.0% coverage bug when the table is empty.
 */
export const QUERY_PR_TABLE_COUNT = `
  SELECT COUNT(*) AS pr_count FROM pull_request
`;

// ============================================================================
// PR Coverage Metrics Queries
// ============================================================================

/**
 * Query to fetch overall PR coverage summary across all repositories.
 * Returns aggregated metrics for the hero section.
 */
export const QUERY_PR_COVERAGE_OVERALL = `
  SELECT
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'merge_commit') AS merge_commits,
    COUNT(DISTINCT repository) AS repositories_analyzed,
    CASE
      WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
         COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
        2
      )
      ELSE 0
    END AS coverage_percentage
  FROM vw_pr_coverage
`;

/**
 * Query to fetch PR coverage summary with date range filter.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 */
export const QUERY_PR_COVERAGE_OVERALL_DATE_RANGE = `
  SELECT
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'merge_commit') AS merge_commits,
    COUNT(DISTINCT repository) AS repositories_analyzed,
    CASE
      WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
         COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
        2
      )
      ELSE 0
    END AS coverage_percentage
  FROM vw_pr_coverage
  WHERE commit_date >= $1 AND commit_date <= $2
`;

/**
 * Query to fetch orphan commits with filters.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 *   $3 - repository (TEXT, nullable)
 *   $4 - author (TEXT, nullable)
 *   $5 - branches array (TEXT[], nullable)
 *   $6 - teams array (TEXT[], nullable)
 *   $7 - orphan_category (TEXT, nullable) - filter by specific category (GITX-227)
 */
export const QUERY_ORPHAN_COMMITS = `
  SELECT
    sha,
    repository,
    branch,
    author,
    commit_date,
    commit_message,
    lines_added,
    lines_removed,
    file_count,
    organization,
    orphan_category
  FROM vw_pr_coverage
  WHERE coverage_status = 'orphan'
    AND commit_date >= $1
    AND commit_date <= $2
    AND (repository = $3 OR $3 IS NULL)
    AND (author = $4 OR $4 IS NULL)
    AND (branch = ANY($5) OR $5 IS NULL)
    AND (team_name = ANY($6) OR $6 IS NULL)
    AND (orphan_category = $7 OR $7 IS NULL)
  ORDER BY commit_date DESC
  LIMIT ${PR_COVERAGE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch orphan category breakdown.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 *   $3 - repository (TEXT, nullable)
 *   $4 - teams array (TEXT[], nullable)
 *
 * Ticket: GITX-227
 */
export const QUERY_ORPHAN_CATEGORY_BREAKDOWN = `
  SELECT
    COUNT(*) FILTER (WHERE orphan_category = 'pre_merge_on_pr_branch') AS pre_merge_on_pr_branch_count,
    COUNT(*) FILTER (WHERE orphan_category = 'direct_to_protected') AS direct_to_protected_count,
    COUNT(*) FILTER (WHERE orphan_category = 'unlinked_feature_branch') AS unlinked_feature_branch_count,
    COUNT(*) FILTER (WHERE orphan_category IS NOT NULL) AS total_orphans,
    CASE
      WHEN COUNT(*) FILTER (WHERE orphan_category IS NOT NULL) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE orphan_category = 'direct_to_protected')::NUMERIC /
         COUNT(*) FILTER (WHERE orphan_category IS NOT NULL)::NUMERIC) * 100,
        1
      )
      ELSE 0
    END AS direct_push_percentage
  FROM vw_pr_coverage
  WHERE coverage_status = 'orphan'
    AND commit_date >= $1
    AND commit_date <= $2
    AND (repository = $3 OR $3 IS NULL)
    AND (team_name = ANY($4) OR $4 IS NULL)
`;

/**
 * Query to fetch PR coverage by branch with date range.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 *   $3 - repository (TEXT, nullable)
 *   $4 - teams array (TEXT[], nullable)
 */
export const QUERY_PR_COVERAGE_BY_BRANCH = `
  SELECT
    repository,
    branch,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,
    CASE
      WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
         COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
        2
      )
      ELSE 0
    END AS coverage_percentage
  FROM vw_pr_coverage
  WHERE commit_date >= $1
    AND commit_date <= $2
    AND (repository = $3 OR $3 IS NULL)
    AND (team_name = ANY($4) OR $4 IS NULL)
  GROUP BY repository, branch
  HAVING COUNT(*) FILTER (WHERE is_merge = false) > 0
  ORDER BY total_commits DESC
  LIMIT ${PR_COVERAGE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch PR coverage by author with date range.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 *   $3 - repository (TEXT, nullable)
 *   $4 - teams array (TEXT[], nullable)
 */
export const QUERY_PR_COVERAGE_BY_AUTHOR = `
  SELECT
    repository,
    author,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,
    CASE
      WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
         COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
        2
      )
      ELSE 0
    END AS coverage_percentage
  FROM vw_pr_coverage
  WHERE commit_date >= $1
    AND commit_date <= $2
    AND (repository = $3 OR $3 IS NULL)
    AND (team_name = ANY($4) OR $4 IS NULL)
  GROUP BY repository, author
  HAVING COUNT(*) FILTER (WHERE is_merge = false) > 0
  ORDER BY total_commits DESC
  LIMIT ${PR_COVERAGE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch weekly coverage trend with date range.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 *   $3 - repository (TEXT, nullable)
 *   $4 - teams array (TEXT[], nullable)
 */
export const QUERY_PR_COVERAGE_WEEKLY_TREND = `
  SELECT
    DATE_TRUNC('week', commit_date)::DATE AS week_start,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,
    CASE
      WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
         COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
        2
      )
      ELSE 0
    END AS coverage_percentage
  FROM vw_pr_coverage
  WHERE commit_date >= $1
    AND commit_date <= $2
    AND (repository = $3 OR $3 IS NULL)
    AND (team_name = ANY($4) OR $4 IS NULL)
    AND commit_date IS NOT NULL
  GROUP BY DATE_TRUNC('week', commit_date)
  ORDER BY week_start ASC
`;

/**
 * Query to get distinct repositories from pr_coverage view.
 */
export const QUERY_PR_COVERAGE_REPOSITORIES = `
  SELECT DISTINCT repository
  FROM vw_pr_coverage
  WHERE repository IS NOT NULL
  ORDER BY repository
`;

/**
 * Query to get distinct authors from pr_coverage view.
 * Parameters:
 *   $1 - repository (TEXT, nullable)
 */
export const QUERY_PR_COVERAGE_AUTHORS = `
  SELECT DISTINCT author
  FROM vw_pr_coverage
  WHERE author IS NOT NULL
    AND (repository = $1 OR $1 IS NULL)
  ORDER BY author
`;

/**
 * Query to get distinct branches from pr_coverage view.
 * Parameters:
 *   $1 - repository (TEXT, nullable)
 */
export const QUERY_PR_COVERAGE_BRANCHES = `
  SELECT DISTINCT branch
  FROM vw_pr_coverage
  WHERE branch IS NOT NULL
    AND (repository = $1 OR $1 IS NULL)
  ORDER BY branch
`;

/**
 * Query to fetch PR coverage by contributor (full_name).
 * Uses the vw_pr_coverage_by_contributor view from migration 032.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 *   $3 - repository (TEXT, nullable)
 *   $4 - teams array (TEXT[], nullable)
 */
export const QUERY_PR_COVERAGE_BY_CONTRIBUTOR = `
  SELECT
    repository,
    contributor_name,
    author AS login,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,
    CASE
      WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
         COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
        2
      )
      ELSE 0
    END AS coverage_percentage
  FROM vw_pr_coverage
  WHERE commit_date >= $1
    AND commit_date <= $2
    AND (repository = $3 OR $3 IS NULL)
    AND (team_name = ANY($4) OR $4 IS NULL)
  GROUP BY repository, contributor_name, author
  HAVING COUNT(*) FILTER (WHERE is_merge = false) > 0
  ORDER BY total_commits DESC
  LIMIT ${PR_COVERAGE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch PR coverage by team.
 * Uses the vw_pr_coverage base view with team aggregation from migration 032.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE)
 *   $3 - repository (TEXT, nullable)
 *   $4 - teams array (TEXT[], nullable)
 */
export const QUERY_PR_COVERAGE_BY_TEAM = `
  SELECT
    repository,
    team_name,
    COUNT(DISTINCT contributor_name) AS contributor_count,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,
    CASE
      WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
         COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
        2
      )
      ELSE 0
    END AS coverage_percentage
  FROM vw_pr_coverage
  WHERE commit_date >= $1
    AND commit_date <= $2
    AND (repository = $3 OR $3 IS NULL)
    AND (team_name = ANY($4) OR $4 IS NULL)
  GROUP BY repository, team_name
  HAVING COUNT(*) FILTER (WHERE is_merge = false) > 0
  ORDER BY total_commits DESC
  LIMIT ${PR_COVERAGE_MAX_RESULT_ROWS}
`;

/**
 * Query to get distinct contributors (full_name format) from pr_coverage view.
 * Uses the updated vw_pr_coverage with contributor_name column from migration 032.
 * Parameters:
 *   $1 - repository (TEXT, nullable)
 */
export const QUERY_PR_COVERAGE_CONTRIBUTORS = `
  SELECT DISTINCT
    contributor_name || ' (' || author || ')' AS contributor_display
  FROM vw_pr_coverage
  WHERE contributor_name IS NOT NULL
    AND (repository = $1 OR $1 IS NULL)
  ORDER BY contributor_display
`;

/**
 * Query to get distinct team names for filter dropdown.
 * Parameters:
 *   $1 - repository (TEXT, nullable)
 */
export const QUERY_PR_COVERAGE_TEAMS = `
  SELECT DISTINCT team_name
  FROM vw_pr_coverage
  WHERE team_name IS NOT NULL
    AND (repository = $1 OR $1 IS NULL)
  ORDER BY team_name
`;

// ============================================================================
// Commit-PR Link Management Queries
// ============================================================================

/**
 * Link a commit to a pull request using merge_sha correlation.
 * Parameters:
 *   $1 - sha (TEXT)
 *   $2 - pull_request_id (INTEGER)
 *   $3 - repository (TEXT)
 *   $4 - link_source (TEXT) - defaults to 'merge_sha'
 */
export const QUERY_LINK_COMMIT_TO_PR = `
  INSERT INTO commit_pull_request (sha, pull_request_id, repository, link_source)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (sha, pull_request_id) DO UPDATE SET
    link_source = EXCLUDED.link_source,
    created_at = NOW()
  RETURNING id
`;

/**
 * Bulk link commits to PRs using merge_sha correlation.
 * This finds all merged PRs where merge_sha matches a commit SHA.
 *
 * Repository matching handles format and case differences:
 * - commit_history.repository: "VocalRSVP" (repo name only, mixed case)
 * - pull_request.repository: "antonajp/vocalrsvp" (owner/repo format, lowercase)
 *
 * The join uses case-insensitive comparison (LOWER) and matches if:
 * 1. Repo names are equal (ignoring case), OR
 * 2. Commit repo matches the repo portion of PR's owner/repo format
 */
export const QUERY_SYNC_PR_COVERAGE_FROM_MERGE_SHA = `
  INSERT INTO commit_pull_request (sha, pull_request_id, repository, link_source)
  SELECT
    ch.sha,
    pr.id,
    ch.repository,
    'merge_sha'
  FROM commit_history ch
  INNER JOIN pull_request pr ON ch.sha = pr.merge_sha
    AND (LOWER(ch.repository) = LOWER(pr.repository)
      OR LOWER(ch.repository) = LOWER(SPLIT_PART(pr.repository, '/', 2)))
  WHERE NOT EXISTS (
    SELECT 1 FROM commit_pull_request cpr
    WHERE cpr.sha = ch.sha AND cpr.pull_request_id = pr.id
  )
  ON CONFLICT (sha, pull_request_id) DO NOTHING
`;

// ============================================================================
// TypeScript Interfaces
// ============================================================================

/**
 * TypeScript interface for view existence check.
 */
export interface ViewExistsRow {
  readonly view_exists: boolean;
}

/**
 * TypeScript interface for pull_request table count check.
 */
export interface PRTableCountRow {
  readonly pr_count: number;
}

/**
 * TypeScript interface for overall PR coverage summary.
 */
export interface PRCoverageOverallRow {
  readonly total_commits: number;
  readonly pr_linked_commits: number;
  readonly orphan_commits: number;
  readonly merge_commits: number;
  readonly repositories_analyzed: number;
  readonly coverage_percentage: number;
}

/**
 * TypeScript interface for orphan commit row.
 */
export interface OrphanCommitRow {
  readonly sha: string;
  readonly repository: string;
  readonly branch: string | null;
  readonly author: string;
  readonly commit_date: Date;
  readonly commit_message: string | null;
  readonly lines_added: number | null;
  readonly lines_removed: number | null;
  readonly file_count: number | null;
  readonly organization: string | null;
  /** Orphan category classification (GITX-227) */
  readonly orphan_category: string | null;
}

/**
 * TypeScript interface for orphan category breakdown row (GITX-227).
 */
export interface OrphanCategoryBreakdownRow {
  readonly pre_merge_on_pr_branch_count: number;
  readonly direct_to_protected_count: number;
  readonly unlinked_feature_branch_count: number;
  readonly total_orphans: number;
  readonly direct_push_percentage: number;
}

/**
 * TypeScript interface for coverage by branch row.
 */
export interface CoverageByBranchRow {
  readonly repository: string;
  readonly branch: string;
  readonly total_commits: number;
  readonly pr_linked_commits: number;
  readonly orphan_commits: number;
  readonly coverage_percentage: number;
}

/**
 * TypeScript interface for coverage by author row.
 */
export interface CoverageByAuthorRow {
  readonly repository: string;
  readonly author: string;
  readonly total_commits: number;
  readonly pr_linked_commits: number;
  readonly orphan_commits: number;
  readonly coverage_percentage: number;
}

/**
 * TypeScript interface for weekly trend row.
 */
export interface WeeklyTrendRow {
  readonly week_start: Date;
  readonly total_commits: number;
  readonly pr_linked_commits: number;
  readonly orphan_commits: number;
  readonly coverage_percentage: number;
}

/**
 * TypeScript interface for repository list.
 */
export interface RepositoryRow {
  readonly repository: string;
}

/**
 * TypeScript interface for author list.
 */
export interface AuthorRow {
  readonly author: string;
}

/**
 * TypeScript interface for branch list.
 */
export interface BranchRow {
  readonly branch: string;
}

/**
 * TypeScript interface for coverage by contributor row.
 */
export interface CoverageByContributorRow {
  readonly repository: string;
  readonly contributor_name: string;
  readonly login: string;
  readonly total_commits: number;
  readonly pr_linked_commits: number;
  readonly orphan_commits: number;
  readonly coverage_percentage: number;
}

/**
 * TypeScript interface for coverage by team row.
 */
export interface CoverageByTeamRow {
  readonly repository: string;
  readonly team_name: string;
  readonly contributor_count: number;
  readonly total_commits: number;
  readonly pr_linked_commits: number;
  readonly orphan_commits: number;
  readonly coverage_percentage: number;
}

/**
 * TypeScript interface for contributor list.
 */
export interface ContributorRow {
  readonly contributor_display: string;
}

/**
 * TypeScript interface for team list.
 */
export interface TeamRow {
  readonly team_name: string;
}

/**
 * TypeScript interface for link result.
 */
export interface LinkResultRow {
  readonly id: number;
}
