/**
 * Parameterized SQL queries for the Test Debt Predictor Dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against views created by migration 019_test_debt.sql:
 *   - vw_commit_test_ratio: Test coverage ratio per commit
 *   - vw_subsequent_bugs: Bug correlation within 28-day window
 *   - vw_test_debt: Weekly aggregated test debt summary
 *
 * Test Debt Tiers:
 *   - Low test: ratio NULL or < 0.1 (high risk)
 *   - Medium test: ratio 0.1 - 0.5 (moderate risk)
 *   - High test: ratio >= 0.5 (low risk)
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-913
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum number of weekly rows returned to prevent memory exhaustion.
 */
export const TEST_DEBT_QUERY_MAX_WEEKLY_ROWS = 104;

/**
 * Maximum number of commit detail rows returned.
 */
export const TEST_DEBT_QUERY_MAX_COMMIT_ROWS = 500;

// ============================================================================
// View Existence Queries
// ============================================================================

/**
 * Query to check if the vw_commit_test_ratio view exists.
 * Used for graceful degradation if migration 019 has not been applied.
 */
export const QUERY_COMMIT_TEST_RATIO_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_commit_test_ratio'
  ) AS view_exists
`;

/**
 * Query to check if the vw_subsequent_bugs view exists.
 */
export const QUERY_SUBSEQUENT_BUGS_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_subsequent_bugs'
  ) AS view_exists
`;

/**
 * Query to check if the vw_test_debt view exists.
 */
export const QUERY_TEST_DEBT_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_test_debt'
  ) AS view_exists
`;

// ============================================================================
// Test Debt Trend Queries
// ============================================================================

/**
 * Query to fetch all weekly test debt summaries.
 * Returns weeks ordered by week DESC.
 * Limited to TEST_DEBT_QUERY_MAX_WEEKLY_ROWS for safety.
 */
export const QUERY_TEST_DEBT_TREND_ALL = `
  SELECT
    week,
    repository,
    low_test_commits,
    medium_test_commits,
    high_test_commits,
    total_commits,
    bugs_from_low_test,
    bugs_from_medium_test,
    bugs_from_high_test,
    total_bugs,
    low_test_bug_rate,
    medium_test_bug_rate,
    high_test_bug_rate,
    avg_test_ratio
  FROM vw_test_debt
  ORDER BY week DESC, repository
  LIMIT ${TEST_DEBT_QUERY_MAX_WEEKLY_ROWS}
`;

/**
 * Query to fetch weekly test debt summaries with date range filter.
 * Parameters:
 *   $1 - start_date (DATE) - start of date range
 *   $2 - end_date (DATE) - end of date range
 */
export const QUERY_TEST_DEBT_TREND_DATE_RANGE = `
  SELECT
    week,
    repository,
    low_test_commits,
    medium_test_commits,
    high_test_commits,
    total_commits,
    bugs_from_low_test,
    bugs_from_medium_test,
    bugs_from_high_test,
    total_bugs,
    low_test_bug_rate,
    medium_test_bug_rate,
    high_test_bug_rate,
    avg_test_ratio
  FROM vw_test_debt
  WHERE week >= $1::DATE AND week <= $2::DATE
  ORDER BY week DESC, repository
  LIMIT ${TEST_DEBT_QUERY_MAX_WEEKLY_ROWS}
`;

/**
 * Query to fetch weekly test debt summaries with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_TEST_DEBT_TREND_BY_REPOSITORY = `
  SELECT
    week,
    repository,
    low_test_commits,
    medium_test_commits,
    high_test_commits,
    total_commits,
    bugs_from_low_test,
    bugs_from_medium_test,
    bugs_from_high_test,
    total_bugs,
    low_test_bug_rate,
    medium_test_bug_rate,
    high_test_bug_rate,
    avg_test_ratio
  FROM vw_test_debt
  WHERE repository = $1
  ORDER BY week DESC
  LIMIT ${TEST_DEBT_QUERY_MAX_WEEKLY_ROWS}
`;

/**
 * Query to fetch weekly test debt summaries with combined filters.
 * Supports date range and repository.
 * NULL values are treated as "no filter" via OR patterns.
 *
 * Parameters:
 *   $1 - start_date (DATE) - start of date range (nullable)
 *   $2 - end_date (DATE) - end of date range (nullable)
 *   $3 - repository (TEXT) - repository name (nullable)
 */
export const QUERY_TEST_DEBT_TREND_COMBINED = `
  SELECT
    week,
    repository,
    low_test_commits,
    medium_test_commits,
    high_test_commits,
    total_commits,
    bugs_from_low_test,
    bugs_from_medium_test,
    bugs_from_high_test,
    total_bugs,
    low_test_bug_rate,
    medium_test_bug_rate,
    high_test_bug_rate,
    avg_test_ratio
  FROM vw_test_debt
  WHERE (week >= $1::DATE OR $1 IS NULL)
    AND (week <= $2::DATE OR $2 IS NULL)
    AND (repository = $3 OR $3 IS NULL)
  ORDER BY week DESC, repository
  LIMIT ${TEST_DEBT_QUERY_MAX_WEEKLY_ROWS}
`;

// ============================================================================
// Low Test Commits Queries
// ============================================================================

/**
 * Query to fetch commits with low test coverage, including bug correlation.
 * Returns commits ordered by subsequent bugs DESC, then commit date DESC.
 * Joins vw_commit_test_ratio with vw_subsequent_bugs for complete data.
 * Limited to TEST_DEBT_QUERY_MAX_COMMIT_ROWS for safety.
 */
export const QUERY_LOW_TEST_COMMITS_ALL = `
  SELECT
    ctr.sha,
    ctr.commit_date,
    ctr.author,
    ctr.repository,
    ctr.branch,
    ctr.commit_message,
    ctr.prod_loc_changed,
    ctr.test_loc_changed,
    ctr.prod_files_changed,
    ctr.test_files_changed,
    ctr.test_ratio,
    ctr.jira_ticket_id,
    ctr.linear_ticket_id,
    COALESCE(sb.jira_bugs_filed, 0) + COALESCE(sb.linear_bugs_filed, 0) AS subsequent_bugs
  FROM vw_commit_test_ratio ctr
  LEFT JOIN vw_subsequent_bugs sb ON ctr.sha = sb.original_sha
  WHERE ctr.prod_loc_changed >= 50
    AND (ctr.test_ratio IS NULL OR ctr.test_ratio < 0.1)
  ORDER BY subsequent_bugs DESC, ctr.commit_date DESC
  LIMIT ${TEST_DEBT_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch low test commits with date range filter.
 * Parameters:
 *   $1 - start_date (DATE) - start of date range
 *   $2 - end_date (DATE) - end of date range
 */
export const QUERY_LOW_TEST_COMMITS_DATE_RANGE = `
  SELECT
    ctr.sha,
    ctr.commit_date,
    ctr.author,
    ctr.repository,
    ctr.branch,
    ctr.commit_message,
    ctr.prod_loc_changed,
    ctr.test_loc_changed,
    ctr.prod_files_changed,
    ctr.test_files_changed,
    ctr.test_ratio,
    ctr.jira_ticket_id,
    ctr.linear_ticket_id,
    COALESCE(sb.jira_bugs_filed, 0) + COALESCE(sb.linear_bugs_filed, 0) AS subsequent_bugs
  FROM vw_commit_test_ratio ctr
  LEFT JOIN vw_subsequent_bugs sb ON ctr.sha = sb.original_sha
  WHERE ctr.prod_loc_changed >= 50
    AND (ctr.test_ratio IS NULL OR ctr.test_ratio < 0.1)
    AND ctr.commit_date >= $1::DATE AND ctr.commit_date <= $2::DATE
  ORDER BY subsequent_bugs DESC, ctr.commit_date DESC
  LIMIT ${TEST_DEBT_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch low test commits with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_LOW_TEST_COMMITS_BY_REPOSITORY = `
  SELECT
    ctr.sha,
    ctr.commit_date,
    ctr.author,
    ctr.repository,
    ctr.branch,
    ctr.commit_message,
    ctr.prod_loc_changed,
    ctr.test_loc_changed,
    ctr.prod_files_changed,
    ctr.test_files_changed,
    ctr.test_ratio,
    ctr.jira_ticket_id,
    ctr.linear_ticket_id,
    COALESCE(sb.jira_bugs_filed, 0) + COALESCE(sb.linear_bugs_filed, 0) AS subsequent_bugs
  FROM vw_commit_test_ratio ctr
  LEFT JOIN vw_subsequent_bugs sb ON ctr.sha = sb.original_sha
  WHERE ctr.prod_loc_changed >= 50
    AND (ctr.test_ratio IS NULL OR ctr.test_ratio < 0.1)
    AND ctr.repository = $1
  ORDER BY subsequent_bugs DESC, ctr.commit_date DESC
  LIMIT ${TEST_DEBT_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch low test commits with author filter.
 * Parameters:
 *   $1 - author (TEXT) - author login to filter by
 */
export const QUERY_LOW_TEST_COMMITS_BY_AUTHOR = `
  SELECT
    ctr.sha,
    ctr.commit_date,
    ctr.author,
    ctr.repository,
    ctr.branch,
    ctr.commit_message,
    ctr.prod_loc_changed,
    ctr.test_loc_changed,
    ctr.prod_files_changed,
    ctr.test_files_changed,
    ctr.test_ratio,
    ctr.jira_ticket_id,
    ctr.linear_ticket_id,
    COALESCE(sb.jira_bugs_filed, 0) + COALESCE(sb.linear_bugs_filed, 0) AS subsequent_bugs
  FROM vw_commit_test_ratio ctr
  LEFT JOIN vw_subsequent_bugs sb ON ctr.sha = sb.original_sha
  WHERE ctr.prod_loc_changed >= 50
    AND (ctr.test_ratio IS NULL OR ctr.test_ratio < 0.1)
    AND ctr.author = $1
  ORDER BY subsequent_bugs DESC, ctr.commit_date DESC
  LIMIT ${TEST_DEBT_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch low test commits with combined filters.
 * Parameters:
 *   $1 - start_date (DATE) - start of date range (nullable)
 *   $2 - end_date (DATE) - end of date range (nullable)
 *   $3 - repository (TEXT) - repository name (nullable)
 *   $4 - author (TEXT) - author login (nullable)
 */
export const QUERY_LOW_TEST_COMMITS_COMBINED = `
  SELECT
    ctr.sha,
    ctr.commit_date,
    ctr.author,
    ctr.repository,
    ctr.branch,
    ctr.commit_message,
    ctr.prod_loc_changed,
    ctr.test_loc_changed,
    ctr.prod_files_changed,
    ctr.test_files_changed,
    ctr.test_ratio,
    ctr.jira_ticket_id,
    ctr.linear_ticket_id,
    COALESCE(sb.jira_bugs_filed, 0) + COALESCE(sb.linear_bugs_filed, 0) AS subsequent_bugs
  FROM vw_commit_test_ratio ctr
  LEFT JOIN vw_subsequent_bugs sb ON ctr.sha = sb.original_sha
  WHERE ctr.prod_loc_changed >= 50
    AND (ctr.test_ratio IS NULL OR ctr.test_ratio < 0.1)
    AND (ctr.commit_date >= $1::DATE OR $1 IS NULL)
    AND (ctr.commit_date <= $2::DATE OR $2 IS NULL)
    AND (ctr.repository = $3 OR $3 IS NULL)
    AND (ctr.author = $4 OR $4 IS NULL)
  ORDER BY subsequent_bugs DESC, ctr.commit_date DESC
  LIMIT ${TEST_DEBT_QUERY_MAX_COMMIT_ROWS}
`;

// ============================================================================
// TypeScript Interfaces for Database Rows
// ============================================================================

/**
 * TypeScript interface for test debt weekly row from database.
 * Maps 1:1 to vw_test_debt view columns (snake_case).
 */
export interface TestDebtWeekDbRow {
  readonly week: Date | string;
  readonly repository: string;
  readonly low_test_commits: number | string;
  readonly medium_test_commits: number | string;
  readonly high_test_commits: number | string;
  readonly total_commits: number | string;
  readonly bugs_from_low_test: number | string;
  readonly bugs_from_medium_test: number | string;
  readonly bugs_from_high_test: number | string;
  readonly total_bugs: number | string;
  readonly low_test_bug_rate: number | string | null;
  readonly medium_test_bug_rate: number | string | null;
  readonly high_test_bug_rate: number | string | null;
  readonly avg_test_ratio: number | string | null;
}

/**
 * TypeScript interface for commit test detail row from database.
 * Maps to joined vw_commit_test_ratio + vw_subsequent_bugs data.
 */
export interface CommitTestDetailDbRow {
  readonly sha: string;
  readonly commit_date: Date | string;
  readonly author: string;
  readonly repository: string;
  readonly branch: string;
  readonly commit_message: string | null;
  readonly prod_loc_changed: number | string;
  readonly test_loc_changed: number | string;
  readonly prod_files_changed: number | string;
  readonly test_files_changed: number | string;
  readonly test_ratio: number | string | null;
  readonly jira_ticket_id: string | null;
  readonly linear_ticket_id: string | null;
  readonly subsequent_bugs: number | string;
}
