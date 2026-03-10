/**
 * Parameterized SQL queries for the Commit Hygiene Tracker Dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against views created by migration 020_commit_hygiene.sql:
 *   - vw_commit_hygiene: Per-commit hygiene scores
 *   - vw_commit_hygiene_by_author: Author-level aggregations
 *   - vw_commit_hygiene_weekly: Weekly trend data
 *
 * The views calculate hygiene based on:
 *   1. Conventional commit prefix (feat, fix, docs, etc.)
 *   2. Subject line length (50-72 chars ideal)
 *   3. Proper capitalization
 *   4. No trailing period
 *   5. Scope presence
 *   6. Body presence
 *   7. Breaking change notation
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-915
 */

import type { QualityTier, ConventionalCommitType } from '../../services/commit-hygiene-types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum number of commit rows returned to prevent memory exhaustion.
 */
export const HYGIENE_QUERY_MAX_COMMIT_ROWS = 500;

/**
 * Maximum number of author summary rows returned.
 */
export const HYGIENE_QUERY_MAX_AUTHOR_ROWS = 200;

/**
 * Maximum number of weekly trend rows returned.
 */
export const HYGIENE_QUERY_MAX_WEEKLY_ROWS = 100;

// ============================================================================
// View Existence Queries
// ============================================================================

/**
 * Query to check if the vw_commit_hygiene view exists.
 * Used for graceful degradation if migration 020 has not been applied.
 */
export const QUERY_HYGIENE_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_commit_hygiene'
  ) AS view_exists
`;

/**
 * Query to check if the vw_commit_hygiene_by_author view exists.
 */
export const QUERY_HYGIENE_BY_AUTHOR_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_commit_hygiene_by_author'
  ) AS view_exists
`;

/**
 * Query to check if the vw_commit_hygiene_weekly view exists.
 */
export const QUERY_HYGIENE_WEEKLY_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_commit_hygiene_weekly'
  ) AS view_exists
`;

// ============================================================================
// Commit Hygiene Queries
// ============================================================================

/**
 * Query to fetch all commit hygiene data from the view.
 * Returns commits ordered by commit_date DESC.
 * Limited to HYGIENE_QUERY_MAX_COMMIT_ROWS for safety.
 */
export const QUERY_COMMIT_HYGIENE_ALL = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message_subject,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    has_conventional_prefix,
    commit_type,
    has_scope,
    scope,
    is_breaking_change,
    has_body,
    subject_length,
    has_proper_capitalization,
    no_trailing_period,
    message_line_count,
    prefix_score,
    length_score,
    capitalization_score,
    period_score,
    scope_score,
    body_score,
    breaking_change_score,
    hygiene_score,
    quality_tier,
    jira_ticket_id,
    linear_ticket_id
  FROM vw_commit_hygiene
  ORDER BY commit_date DESC
  LIMIT ${HYGIENE_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch commit hygiene with date range filter.
 * Parameters:
 *   $1 - start_date (DATE) - start of date range
 *   $2 - end_date (DATE) - end of date range
 */
export const QUERY_COMMIT_HYGIENE_DATE_RANGE = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message_subject,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    has_conventional_prefix,
    commit_type,
    has_scope,
    scope,
    is_breaking_change,
    has_body,
    subject_length,
    has_proper_capitalization,
    no_trailing_period,
    message_line_count,
    prefix_score,
    length_score,
    capitalization_score,
    period_score,
    scope_score,
    body_score,
    breaking_change_score,
    hygiene_score,
    quality_tier,
    jira_ticket_id,
    linear_ticket_id
  FROM vw_commit_hygiene
  WHERE commit_date >= $1::DATE AND commit_date <= $2::DATE
  ORDER BY commit_date DESC
  LIMIT ${HYGIENE_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch commit hygiene with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_COMMIT_HYGIENE_BY_REPOSITORY = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message_subject,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    has_conventional_prefix,
    commit_type,
    has_scope,
    scope,
    is_breaking_change,
    has_body,
    subject_length,
    has_proper_capitalization,
    no_trailing_period,
    message_line_count,
    prefix_score,
    length_score,
    capitalization_score,
    period_score,
    scope_score,
    body_score,
    breaking_change_score,
    hygiene_score,
    quality_tier,
    jira_ticket_id,
    linear_ticket_id
  FROM vw_commit_hygiene
  WHERE repository = $1
  ORDER BY commit_date DESC
  LIMIT ${HYGIENE_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch commit hygiene with quality tier filter.
 * Parameters:
 *   $1 - quality_tier (TEXT) - quality tier to filter by
 */
export const QUERY_COMMIT_HYGIENE_BY_QUALITY_TIER = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message_subject,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    has_conventional_prefix,
    commit_type,
    has_scope,
    scope,
    is_breaking_change,
    has_body,
    subject_length,
    has_proper_capitalization,
    no_trailing_period,
    message_line_count,
    prefix_score,
    length_score,
    capitalization_score,
    period_score,
    scope_score,
    body_score,
    breaking_change_score,
    hygiene_score,
    quality_tier,
    jira_ticket_id,
    linear_ticket_id
  FROM vw_commit_hygiene
  WHERE quality_tier = $1
  ORDER BY commit_date DESC
  LIMIT ${HYGIENE_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch commit hygiene with commit type filter.
 * Parameters:
 *   $1 - commit_type (TEXT) - conventional commit type to filter by
 */
export const QUERY_COMMIT_HYGIENE_BY_COMMIT_TYPE = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message_subject,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    has_conventional_prefix,
    commit_type,
    has_scope,
    scope,
    is_breaking_change,
    has_body,
    subject_length,
    has_proper_capitalization,
    no_trailing_period,
    message_line_count,
    prefix_score,
    length_score,
    capitalization_score,
    period_score,
    scope_score,
    body_score,
    breaking_change_score,
    hygiene_score,
    quality_tier,
    jira_ticket_id,
    linear_ticket_id
  FROM vw_commit_hygiene
  WHERE commit_type = $1
  ORDER BY commit_date DESC
  LIMIT ${HYGIENE_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch commit hygiene with combined filters.
 * Supports date range, repository, branch, quality tier, commit type, author, team.
 * NULL values are treated as "no filter" via COALESCE/OR patterns.
 *
 * Parameters:
 *   $1 - start_date (DATE) - start of date range (nullable)
 *   $2 - end_date (DATE) - end of date range (nullable)
 *   $3 - repository (TEXT) - repository name (nullable)
 *   $4 - branch (TEXT) - branch name (nullable)
 *   $5 - quality_tier (TEXT) - quality tier (nullable)
 *   $6 - commit_type (TEXT) - commit type (nullable)
 *   $7 - author (TEXT) - author login (nullable)
 *   $8 - team (TEXT) - team name (nullable)
 */
export const QUERY_COMMIT_HYGIENE_COMBINED = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message_subject,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    has_conventional_prefix,
    commit_type,
    has_scope,
    scope,
    is_breaking_change,
    has_body,
    subject_length,
    has_proper_capitalization,
    no_trailing_period,
    message_line_count,
    prefix_score,
    length_score,
    capitalization_score,
    period_score,
    scope_score,
    body_score,
    breaking_change_score,
    hygiene_score,
    quality_tier,
    jira_ticket_id,
    linear_ticket_id
  FROM vw_commit_hygiene
  WHERE (commit_date >= $1::DATE OR $1 IS NULL)
    AND (commit_date <= $2::DATE OR $2 IS NULL)
    AND (repository = $3 OR $3 IS NULL)
    AND (branch = $4 OR $4 IS NULL)
    AND (quality_tier = $5 OR $5 IS NULL)
    AND (commit_type = $6 OR $6 IS NULL)
    AND (author = $7 OR $7 IS NULL)
    AND (team = $8 OR $8 IS NULL)
  ORDER BY commit_date DESC
  LIMIT ${HYGIENE_QUERY_MAX_COMMIT_ROWS}
`;

// ============================================================================
// Author Summary Queries
// ============================================================================

/**
 * Query to fetch all author hygiene summaries.
 * Returns authors ordered by avg_hygiene_score DESC.
 */
export const QUERY_AUTHOR_HYGIENE_ALL = `
  SELECT
    author,
    full_name,
    team,
    repository,
    total_commits,
    conventional_commits,
    scoped_commits,
    commits_with_body,
    breaking_changes,
    excellent_count,
    good_count,
    fair_count,
    poor_count,
    feat_count,
    fix_count,
    docs_count,
    refactor_count,
    test_count,
    chore_count,
    other_count,
    avg_hygiene_score,
    avg_subject_length,
    conventional_pct,
    good_or_better_pct
  FROM vw_commit_hygiene_by_author
  ORDER BY avg_hygiene_score DESC
  LIMIT ${HYGIENE_QUERY_MAX_AUTHOR_ROWS}
`;

/**
 * Query to fetch author hygiene summaries with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_AUTHOR_HYGIENE_BY_REPOSITORY = `
  SELECT
    author,
    full_name,
    team,
    repository,
    total_commits,
    conventional_commits,
    scoped_commits,
    commits_with_body,
    breaking_changes,
    excellent_count,
    good_count,
    fair_count,
    poor_count,
    feat_count,
    fix_count,
    docs_count,
    refactor_count,
    test_count,
    chore_count,
    other_count,
    avg_hygiene_score,
    avg_subject_length,
    conventional_pct,
    good_or_better_pct
  FROM vw_commit_hygiene_by_author
  WHERE repository = $1
  ORDER BY avg_hygiene_score DESC
  LIMIT ${HYGIENE_QUERY_MAX_AUTHOR_ROWS}
`;

/**
 * Query to fetch author hygiene summaries with team filter.
 * Parameters:
 *   $1 - team (TEXT) - team name to filter by
 */
export const QUERY_AUTHOR_HYGIENE_BY_TEAM = `
  SELECT
    author,
    full_name,
    team,
    repository,
    total_commits,
    conventional_commits,
    scoped_commits,
    commits_with_body,
    breaking_changes,
    excellent_count,
    good_count,
    fair_count,
    poor_count,
    feat_count,
    fix_count,
    docs_count,
    refactor_count,
    test_count,
    chore_count,
    other_count,
    avg_hygiene_score,
    avg_subject_length,
    conventional_pct,
    good_or_better_pct
  FROM vw_commit_hygiene_by_author
  WHERE team = $1
  ORDER BY avg_hygiene_score DESC
  LIMIT ${HYGIENE_QUERY_MAX_AUTHOR_ROWS}
`;

// ============================================================================
// Weekly Trend Queries
// ============================================================================

/**
 * Query to fetch all weekly hygiene trends.
 * Returns weeks ordered by week DESC.
 */
export const QUERY_WEEKLY_HYGIENE_ALL = `
  SELECT
    week,
    repository,
    total_commits,
    conventional_commits,
    excellent_count,
    good_count,
    fair_count,
    poor_count,
    feat_count,
    fix_count,
    other_type_count,
    avg_hygiene_score,
    conventional_pct,
    good_or_better_pct
  FROM vw_commit_hygiene_weekly
  ORDER BY week DESC
  LIMIT ${HYGIENE_QUERY_MAX_WEEKLY_ROWS}
`;

/**
 * Query to fetch weekly hygiene trends with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_WEEKLY_HYGIENE_BY_REPOSITORY = `
  SELECT
    week,
    repository,
    total_commits,
    conventional_commits,
    excellent_count,
    good_count,
    fair_count,
    poor_count,
    feat_count,
    fix_count,
    other_type_count,
    avg_hygiene_score,
    conventional_pct,
    good_or_better_pct
  FROM vw_commit_hygiene_weekly
  WHERE repository = $1
  ORDER BY week DESC
  LIMIT ${HYGIENE_QUERY_MAX_WEEKLY_ROWS}
`;

// ============================================================================
// TypeScript Interfaces for Database Rows
// ============================================================================

/**
 * TypeScript interface for commit hygiene row from database.
 * Maps 1:1 to vw_commit_hygiene view columns (snake_case).
 */
export interface CommitHygieneDbRow {
  readonly sha: string;
  readonly commit_date: Date | string;
  readonly author: string;
  readonly repository: string;
  readonly branch: string;
  readonly commit_message_subject: string;
  readonly file_count: number | string;
  readonly lines_added: number | string;
  readonly lines_removed: number | string;
  readonly full_name: string | null;
  readonly team: string | null;
  readonly has_conventional_prefix: boolean;
  readonly commit_type: ConventionalCommitType | null;
  readonly has_scope: boolean;
  readonly scope: string | null;
  readonly is_breaking_change: boolean;
  readonly has_body: boolean;
  readonly subject_length: number | string;
  readonly has_proper_capitalization: boolean;
  readonly no_trailing_period: boolean;
  readonly message_line_count: number | string;
  readonly prefix_score: number | string;
  readonly length_score: number | string;
  readonly capitalization_score: number | string;
  readonly period_score: number | string;
  readonly scope_score: number | string;
  readonly body_score: number | string;
  readonly breaking_change_score: number | string;
  readonly hygiene_score: number | string;
  readonly quality_tier: QualityTier;
  readonly jira_ticket_id: string | null;
  readonly linear_ticket_id: string | null;
}

/**
 * TypeScript interface for author hygiene summary row from database.
 * Maps 1:1 to vw_commit_hygiene_by_author view columns (snake_case).
 */
export interface AuthorHygieneDbRow {
  readonly author: string;
  readonly full_name: string | null;
  readonly team: string | null;
  readonly repository: string;
  readonly total_commits: number | string;
  readonly conventional_commits: number | string;
  readonly scoped_commits: number | string;
  readonly commits_with_body: number | string;
  readonly breaking_changes: number | string;
  readonly excellent_count: number | string;
  readonly good_count: number | string;
  readonly fair_count: number | string;
  readonly poor_count: number | string;
  readonly feat_count: number | string;
  readonly fix_count: number | string;
  readonly docs_count: number | string;
  readonly refactor_count: number | string;
  readonly test_count: number | string;
  readonly chore_count: number | string;
  readonly other_count: number | string;
  readonly avg_hygiene_score: number | string;
  readonly avg_subject_length: number | string;
  readonly conventional_pct: number | string;
  readonly good_or_better_pct: number | string;
}

/**
 * TypeScript interface for weekly hygiene trend row from database.
 * Maps 1:1 to vw_commit_hygiene_weekly view columns (snake_case).
 */
export interface WeeklyHygieneDbRow {
  readonly week: Date | string;
  readonly repository: string;
  readonly total_commits: number | string;
  readonly conventional_commits: number | string;
  readonly excellent_count: number | string;
  readonly good_count: number | string;
  readonly fair_count: number | string;
  readonly poor_count: number | string;
  readonly feat_count: number | string;
  readonly fix_count: number | string;
  readonly other_type_count: number | string;
  readonly avg_hygiene_score: number | string;
  readonly conventional_pct: number | string;
  readonly good_or_better_pct: number | string;
}
