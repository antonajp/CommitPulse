/**
 * Parameterized SQL queries for the Development Pipeline dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against the vw_dev_pipeline_deltas view created
 * by migration 010_dev_pipeline_baseline.sql.
 *
 * The view calculates commit-level deltas for 4 metrics against merge-base baseline:
 *   1. Complexity delta - change in cyclomatic complexity
 *   2. LOC delta - net lines of code change
 *   3. Comments delta - change in comment lines
 *   4. Tests delta - LOC change in test files only
 *
 * Each commit is linked to its Linear/Jira ticket ID via commit_linear/commit_jira.
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 * Privacy: Only team names and display names returned, not emails.
 *
 * Ticket: IQS-896
 */

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Applied as LIMIT in each query.
 */
export const DEV_PIPELINE_MAX_RESULT_ROWS = 1000;

/**
 * Query to fetch all Development Pipeline deltas from the view.
 * Returns commits ordered by commit_date DESC (most recent first).
 * Limited to DEV_PIPELINE_MAX_RESULT_ROWS for safety.
 */
export const QUERY_DEV_PIPELINE_DELTAS = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    is_merge,
    full_name,
    team,
    ticket_id,
    ticket_project,
    ticket_type,
    complexity_delta,
    loc_delta,
    comments_delta,
    tests_delta,
    file_count,
    test_file_count,
    baseline_sha,
    total_complexity,
    total_code_lines,
    total_comment_lines
  FROM vw_dev_pipeline_deltas
  ORDER BY commit_date DESC
  LIMIT ${DEV_PIPELINE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Development Pipeline deltas with date range filter.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE) - beginning of date range
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE) - end of date range
 */
export const QUERY_DEV_PIPELINE_DELTAS_DATE_RANGE = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    is_merge,
    full_name,
    team,
    ticket_id,
    ticket_project,
    ticket_type,
    complexity_delta,
    loc_delta,
    comments_delta,
    tests_delta,
    file_count,
    test_file_count,
    baseline_sha,
    total_complexity,
    total_code_lines,
    total_comment_lines
  FROM vw_dev_pipeline_deltas
  WHERE commit_date >= $1 AND commit_date <= $2
  ORDER BY commit_date DESC
  LIMIT ${DEV_PIPELINE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Development Pipeline deltas with team filter.
 * Parameters:
 *   $1 - team (TEXT) - team name to filter by
 */
export const QUERY_DEV_PIPELINE_DELTAS_TEAM = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    is_merge,
    full_name,
    team,
    ticket_id,
    ticket_project,
    ticket_type,
    complexity_delta,
    loc_delta,
    comments_delta,
    tests_delta,
    file_count,
    test_file_count,
    baseline_sha,
    total_complexity,
    total_code_lines,
    total_comment_lines
  FROM vw_dev_pipeline_deltas
  WHERE team = $1
  ORDER BY commit_date DESC
  LIMIT ${DEV_PIPELINE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Development Pipeline deltas with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_DEV_PIPELINE_DELTAS_REPOSITORY = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    is_merge,
    full_name,
    team,
    ticket_id,
    ticket_project,
    ticket_type,
    complexity_delta,
    loc_delta,
    comments_delta,
    tests_delta,
    file_count,
    test_file_count,
    baseline_sha,
    total_complexity,
    total_code_lines,
    total_comment_lines
  FROM vw_dev_pipeline_deltas
  WHERE repository = $1
  ORDER BY commit_date DESC
  LIMIT ${DEV_PIPELINE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Development Pipeline deltas with ticket filter.
 * Matches either Linear or Jira ticket IDs.
 * Parameters:
 *   $1 - ticket_id (TEXT) - Linear key or Jira key to filter by
 */
export const QUERY_DEV_PIPELINE_DELTAS_TICKET = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    is_merge,
    full_name,
    team,
    ticket_id,
    ticket_project,
    ticket_type,
    complexity_delta,
    loc_delta,
    comments_delta,
    tests_delta,
    file_count,
    test_file_count,
    baseline_sha,
    total_complexity,
    total_code_lines,
    total_comment_lines
  FROM vw_dev_pipeline_deltas
  WHERE ticket_id = $1
  ORDER BY commit_date DESC
  LIMIT ${DEV_PIPELINE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch Development Pipeline deltas with combined filters.
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE) - beginning of date range
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE) - end of date range
 *   $3 - team (TEXT) - team name to filter by (nullable)
 *   $4 - repository (TEXT) - repository name to filter by (nullable)
 *
 * Note: NULL values in $3 or $4 are treated as "no filter" via COALESCE.
 */
export const QUERY_DEV_PIPELINE_DELTAS_COMBINED = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    is_merge,
    full_name,
    team,
    ticket_id,
    ticket_project,
    ticket_type,
    complexity_delta,
    loc_delta,
    comments_delta,
    tests_delta,
    file_count,
    test_file_count,
    baseline_sha,
    total_complexity,
    total_code_lines,
    total_comment_lines
  FROM vw_dev_pipeline_deltas
  WHERE commit_date >= $1 AND commit_date <= $2
    AND (team = $3 OR $3 IS NULL)
    AND (repository = $4 OR $4 IS NULL)
  ORDER BY commit_date DESC
  LIMIT ${DEV_PIPELINE_MAX_RESULT_ROWS}
`;

/**
 * Query to aggregate Development Pipeline deltas by ticket.
 * Groups all commits associated with the same ticket and sums deltas.
 * Useful for showing "total impact per ticket" view.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE) - beginning of date range (nullable)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE) - end of date range (nullable)
 */
export const QUERY_DEV_PIPELINE_DELTAS_BY_TICKET = `
  SELECT
    ticket_id,
    ticket_project,
    ticket_type,
    MAX(team) AS team,
    MAX(repository) AS repository,
    COUNT(DISTINCT sha)::INT AS commit_count,
    SUM(complexity_delta)::INT AS total_complexity_delta,
    SUM(loc_delta)::INT AS total_loc_delta,
    SUM(comments_delta)::INT AS total_comments_delta,
    SUM(tests_delta)::INT AS total_tests_delta,
    SUM(file_count)::INT AS total_file_count,
    SUM(test_file_count)::INT AS total_test_file_count,
    MIN(commit_date) AS first_commit_date,
    MAX(commit_date) AS last_commit_date
  FROM vw_dev_pipeline_deltas
  WHERE ticket_id IS NOT NULL
    AND (commit_date >= $1 OR $1 IS NULL)
    AND (commit_date <= $2 OR $2 IS NULL)
  GROUP BY ticket_id, ticket_project, ticket_type
  ORDER BY MAX(commit_date) DESC
  LIMIT ${DEV_PIPELINE_MAX_RESULT_ROWS}
`;

/**
 * Query to aggregate Development Pipeline deltas by author.
 * Groups all commits by author and sums deltas.
 * Useful for showing "developer productivity metrics" view.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE) - beginning of date range (nullable)
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE) - end of date range (nullable)
 */
export const QUERY_DEV_PIPELINE_DELTAS_BY_AUTHOR = `
  SELECT
    author,
    full_name,
    team,
    COUNT(DISTINCT sha)::INT AS commit_count,
    COUNT(DISTINCT ticket_id)::INT AS ticket_count,
    SUM(complexity_delta)::INT AS total_complexity_delta,
    SUM(loc_delta)::INT AS total_loc_delta,
    SUM(comments_delta)::INT AS total_comments_delta,
    SUM(tests_delta)::INT AS total_tests_delta,
    SUM(file_count)::INT AS total_file_count,
    SUM(test_file_count)::INT AS total_test_file_count,
    MIN(commit_date) AS first_commit_date,
    MAX(commit_date) AS last_commit_date
  FROM vw_dev_pipeline_deltas
  WHERE (commit_date >= $1 OR $1 IS NULL)
    AND (commit_date <= $2 OR $2 IS NULL)
  GROUP BY author, full_name, team
  ORDER BY COUNT(DISTINCT sha) DESC
  LIMIT ${DEV_PIPELINE_MAX_RESULT_ROWS}
`;

/**
 * Query to check if the vw_dev_pipeline_deltas view exists.
 * Used for graceful degradation if migration 010 has not been applied.
 */
export const QUERY_DEV_PIPELINE_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_dev_pipeline_deltas'
  ) AS view_exists
`;

/**
 * Query to check if the commit_baseline table exists.
 * Used to detect if baseline data has been populated by the pipeline.
 */
export const QUERY_COMMIT_BASELINE_TABLE_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'commit_baseline'
  ) AS table_exists
`;

/**
 * Query to get baseline population statistics.
 * Returns count of commits with baseline data vs total commits.
 * Helps diagnose if pipeline is populating baselines correctly.
 */
export const QUERY_BASELINE_POPULATION_STATS = `
  SELECT
    (SELECT COUNT(DISTINCT sha) FROM commit_history WHERE is_merge = FALSE)::INT AS total_commits,
    (SELECT COUNT(DISTINCT sha) FROM commit_baseline)::INT AS commits_with_baseline,
    (
      SELECT COUNT(DISTINCT sha)::FLOAT /
             NULLIF((SELECT COUNT(DISTINCT sha) FROM commit_history WHERE is_merge = FALSE), 0)
    ) AS baseline_coverage_ratio
`;

/**
 * TypeScript interface for Development Pipeline delta row.
 * Maps 1:1 to vw_dev_pipeline_deltas view columns.
 */
export interface DevPipelineDelta {
  readonly sha: string;
  readonly commit_date: Date;
  readonly author: string;
  readonly branch: string | null;
  readonly repository: string | null;
  readonly commit_message: string | null;
  readonly is_merge: boolean;
  readonly full_name: string | null;
  readonly team: string | null;
  readonly ticket_id: string | null;
  readonly ticket_project: string | null;
  readonly ticket_type: 'Linear' | 'Jira' | null;
  readonly complexity_delta: number;
  readonly loc_delta: number;
  readonly comments_delta: number;
  readonly tests_delta: number;
  readonly file_count: number;
  readonly test_file_count: number;
  readonly baseline_sha: string | null;
  readonly total_complexity: number;
  readonly total_code_lines: number;
  readonly total_comment_lines: number;
}

/**
 * TypeScript interface for aggregated deltas by ticket.
 */
export interface DevPipelineDeltaByTicket {
  readonly ticket_id: string;
  readonly ticket_project: string | null;
  readonly ticket_type: 'Linear' | 'Jira' | null;
  readonly team: string | null;
  readonly repository: string | null;
  readonly commit_count: number;
  readonly total_complexity_delta: number;
  readonly total_loc_delta: number;
  readonly total_comments_delta: number;
  readonly total_tests_delta: number;
  readonly total_file_count: number;
  readonly total_test_file_count: number;
  readonly first_commit_date: Date;
  readonly last_commit_date: Date;
}

/**
 * TypeScript interface for aggregated deltas by author.
 */
export interface DevPipelineDeltaByAuthor {
  readonly author: string;
  readonly full_name: string | null;
  readonly team: string | null;
  readonly commit_count: number;
  readonly ticket_count: number;
  readonly total_complexity_delta: number;
  readonly total_loc_delta: number;
  readonly total_comments_delta: number;
  readonly total_tests_delta: number;
  readonly total_file_count: number;
  readonly total_test_file_count: number;
  readonly first_commit_date: Date;
  readonly last_commit_date: Date;
}

/**
 * TypeScript interface for baseline population statistics.
 */
export interface BaselinePopulationStats {
  readonly total_commits: number;
  readonly commits_with_baseline: number;
  readonly baseline_coverage_ratio: number | null;
}

/**
 * Query to fetch weekly aggregated dev pipeline metrics.
 * Groups commits by ISO week and developer.
 * Includes representative SHA (latest commit of the week) and repository URL for GitHub navigation.
 *
 * Parameters:
 *   $1 - team (TEXT) - team name filter (required)
 *   $2 - start_date (DATE) - beginning of date range
 *   $3 - end_date (DATE) - end of date range
 */
export const QUERY_DEV_PIPELINE_WEEKLY = `
  SELECT
    DATE_TRUNC('week', v.commit_date)::DATE AS week_start,
    v.author,
    v.full_name,
    v.team,
    SUM(v.loc_delta)::BIGINT AS total_loc_delta,
    SUM(v.complexity_delta)::BIGINT AS total_complexity_delta,
    SUM(v.comments_delta)::BIGINT AS total_comments_delta,
    SUM(v.tests_delta)::BIGINT AS total_tests_delta,
    SUM(v.total_comment_lines)::BIGINT AS total_comment_lines,
    SUM(v.total_code_lines)::BIGINT AS total_code_lines,
    COUNT(*)::INT AS commit_count,
    -- Include latest commit SHA for GitHub navigation
    (ARRAY_AGG(v.sha ORDER BY v.commit_date DESC))[1] AS latest_sha,
    -- Include repository name for looking up repoUrl from VS Code settings
    v.repository
  FROM vw_dev_pipeline_deltas v
  WHERE v.team = $1
    AND v.commit_date >= $2
    AND v.commit_date <= $3
  GROUP BY DATE_TRUNC('week', v.commit_date)::DATE, v.author, v.full_name, v.team, v.repository
  ORDER BY week_start ASC, v.author ASC
  LIMIT ${DEV_PIPELINE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch unique teams for the dev pipeline filter.
 * Uses commit_contributors table (always populated) instead of vw_dev_pipeline_deltas view
 * (which requires baseline data). This ensures teams are available even before baseline
 * population is complete.
 */
export const QUERY_DEV_PIPELINE_TEAMS = `
  SELECT DISTINCT team
  FROM commit_contributors
  WHERE team IS NOT NULL AND team <> ''
  ORDER BY team ASC
`;

/**
 * TypeScript interface for weekly aggregated dev pipeline data.
 */
export interface DevPipelineWeeklyRow {
  readonly week_start: Date;
  readonly author: string;
  readonly full_name: string | null;
  readonly team: string | null;
  readonly total_loc_delta: number;
  readonly total_complexity_delta: number;
  readonly total_comments_delta: number;
  readonly total_tests_delta: number;
  readonly total_comment_lines: number;
  readonly total_code_lines: number;
  readonly commit_count: number;
  /** Latest commit SHA of the week (for GitHub navigation) */
  readonly latest_sha: string | null;
  /** Repository name for looking up repoUrl from VS Code settings */
  readonly repository: string | null;
}
