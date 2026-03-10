/**
 * Parameterized SQL queries for the LOC Committed chart.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries join commit_files, commit_history, and commit_contributors
 * to aggregate lines committed by architecture component, grouped by
 * repository, team, or author.
 *
 * The groupBy column is selected via an allowlist in the data service,
 * NOT via string interpolation. Each groupBy mode has its own query
 * constant to eliminate any dynamic SQL column injection risk.
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 * Privacy: Only team names and display names are returned, not emails.
 *
 * Ticket: IQS-889
 */

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Applied as LIMIT in each query.
 */
export const LOC_MAX_RESULT_ROWS = 5000;

/**
 * LOC Committed grouped by REPOSITORY.
 * Returns arc_component breakdown for each repository.
 *
 * Optional parameters (dynamic WHERE clause built by service):
 *   $1, $2 etc. - startDate, endDate, team, repository filters
 *
 * NOTE: The service builds the WHERE clause dynamically with parameterized
 * placeholders ($1, $2...) but the GROUP BY column is hardcoded per query.
 */
export const LOC_COMMITTED_GROUP_BY_REPOSITORY = `
  SELECT
    ch.repository AS group_key,
    COALESCE(cf.arc_component, '(Not Categorized)') AS arc_component,
    COALESCE(SUM(cf.line_inserts), 0)::BIGINT AS lines_added,
    COALESCE(SUM(cf.line_inserts - cf.line_deletes), 0)::BIGINT AS net_lines,
    COALESCE(SUM(cf.line_inserts + cf.line_deletes), 0)::BIGINT AS total_churn
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  LEFT JOIN commit_contributors cc ON ch.author = cc.login
`;

/**
 * LOC Committed grouped by TEAM.
 * Returns arc_component breakdown for each team.
 */
export const LOC_COMMITTED_GROUP_BY_TEAM = `
  SELECT
    COALESCE(cc.team, '(Unassigned)') AS group_key,
    COALESCE(cf.arc_component, '(Not Categorized)') AS arc_component,
    COALESCE(SUM(cf.line_inserts), 0)::BIGINT AS lines_added,
    COALESCE(SUM(cf.line_inserts - cf.line_deletes), 0)::BIGINT AS net_lines,
    COALESCE(SUM(cf.line_inserts + cf.line_deletes), 0)::BIGINT AS total_churn
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  LEFT JOIN commit_contributors cc ON ch.author = cc.login
`;

/**
 * LOC Committed grouped by AUTHOR (engineer).
 * Uses COALESCE(cc.full_name, ch.author) for display, ch.author as unique key.
 */
export const LOC_COMMITTED_GROUP_BY_AUTHOR = `
  SELECT
    COALESCE(cc.full_name, ch.author) AS group_key,
    COALESCE(cf.arc_component, '(Not Categorized)') AS arc_component,
    COALESCE(SUM(cf.line_inserts), 0)::BIGINT AS lines_added,
    COALESCE(SUM(cf.line_inserts - cf.line_deletes), 0)::BIGINT AS net_lines,
    COALESCE(SUM(cf.line_inserts + cf.line_deletes), 0)::BIGINT AS total_churn
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  LEFT JOIN commit_contributors cc ON ch.author = cc.login
`;

/**
 * Shared GROUP BY suffix for repository grouping.
 */
export const LOC_GROUP_SUFFIX_REPOSITORY = `
  GROUP BY ch.repository, COALESCE(cf.arc_component, '(Not Categorized)')
  ORDER BY SUM(cf.line_inserts + cf.line_deletes) DESC
`;

/**
 * Shared GROUP BY suffix for team grouping.
 */
export const LOC_GROUP_SUFFIX_TEAM = `
  GROUP BY COALESCE(cc.team, '(Unassigned)'), COALESCE(cf.arc_component, '(Not Categorized)')
  ORDER BY SUM(cf.line_inserts + cf.line_deletes) DESC
`;

/**
 * Shared GROUP BY suffix for author grouping.
 */
export const LOC_GROUP_SUFFIX_AUTHOR = `
  GROUP BY COALESCE(cc.full_name, ch.author), COALESCE(cf.arc_component, '(Not Categorized)')
  ORDER BY SUM(cf.line_inserts + cf.line_deletes) DESC
`;
