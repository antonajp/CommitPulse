/**
 * Parameterized SQL queries for the Top Complex Files chart.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries identify the top N most complex files and then aggregate
 * LOC contributions by contributor or team for stacked bar visualization.
 *
 * The groupBy mode (team vs individual) is selected via an allowlist
 * in the data service, NOT via string interpolation.
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-894
 */

/**
 * Maximum number of contributors per file to display.
 * Contributors below the threshold are aggregated into "Others".
 */
export const COMPLEXITY_MAX_CONTRIBUTORS_PER_FILE = 20;

/**
 * Maximum total result rows returned to prevent memory exhaustion.
 */
export const COMPLEXITY_MAX_RESULT_ROWS = 2000;

/**
 * Minimum percentage threshold for individual contributor display.
 * Contributors below this threshold are aggregated into "Others".
 */
export const COMPLEXITY_MIN_CONTRIBUTOR_PERCENTAGE = 2;

/**
 * Query to get top N files by complexity with contributor LOC breakdown.
 * Uses ROW_NUMBER() OVER to get the latest state of each file.
 *
 * Parameters:
 *   $1 - topN (number of files to return)
 *   $2+ - optional filters (startDate, endDate, team, repository)
 *
 * NOTE: The service builds the WHERE clause dynamically with parameterized
 * placeholders ($1, $2...) but the GROUP BY column is hardcoded per query.
 */
export const TOP_COMPLEX_FILES_BY_INDIVIDUAL = `
WITH latest_file_state AS (
  -- Get the most recent commit for each file to determine current complexity
  SELECT DISTINCT ON (cf.filename)
    cf.filename,
    COALESCE(cf.complexity, cf.weighted_complexity, cf.total_code_lines, 0) AS complexity,
    cf.sha
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  WHERE cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL OR cf.total_code_lines IS NOT NULL
  ORDER BY cf.filename, ch.commit_date DESC
),
top_files AS (
  -- Get top N files by complexity
  SELECT filename, complexity
  FROM latest_file_state
  ORDER BY complexity DESC
  LIMIT $1
),
contributor_loc AS (
  -- Aggregate LOC contributions per file per contributor
  SELECT
    cf.filename,
    COALESCE(cc.full_name, ch.author) AS contributor,
    cc.team AS team,
    COALESCE(SUM(cf.line_inserts), 0)::BIGINT AS loc
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  LEFT JOIN commit_contributors cc ON ch.author = cc.login
  WHERE cf.filename IN (SELECT filename FROM top_files)
    AND cf.line_inserts IS NOT NULL
    AND ch.is_merge = FALSE
`;

/**
 * Suffix for individual contributor grouping (GROUP BY contributor).
 */
export const TOP_COMPLEX_FILES_INDIVIDUAL_SUFFIX = `
  GROUP BY cf.filename, COALESCE(cc.full_name, ch.author), cc.team
)
SELECT
  tf.filename,
  tf.complexity,
  cl.contributor,
  cl.team,
  cl.loc,
  CASE
    WHEN SUM(cl.loc) OVER (PARTITION BY tf.filename) > 0
    THEN ROUND((cl.loc::NUMERIC / SUM(cl.loc) OVER (PARTITION BY tf.filename)) * 100, 1)
    ELSE 0
  END AS percentage
FROM top_files tf
INNER JOIN contributor_loc cl ON tf.filename = cl.filename
WHERE cl.loc > 0
ORDER BY tf.complexity DESC, cl.loc DESC
`;

/**
 * Query to get top N files by complexity with team LOC breakdown.
 * Aggregates contributors by team instead of showing individuals.
 */
export const TOP_COMPLEX_FILES_BY_TEAM = `
WITH latest_file_state AS (
  -- Get the most recent commit for each file to determine current complexity
  SELECT DISTINCT ON (cf.filename)
    cf.filename,
    COALESCE(cf.complexity, cf.weighted_complexity, cf.total_code_lines, 0) AS complexity,
    cf.sha
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  WHERE cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL OR cf.total_code_lines IS NOT NULL
  ORDER BY cf.filename, ch.commit_date DESC
),
top_files AS (
  -- Get top N files by complexity
  SELECT filename, complexity
  FROM latest_file_state
  ORDER BY complexity DESC
  LIMIT $1
),
team_loc AS (
  -- Aggregate LOC contributions per file per team
  SELECT
    cf.filename,
    COALESCE(cc.team, 'Unassigned') AS contributor,
    COALESCE(SUM(cf.line_inserts), 0)::BIGINT AS loc
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  LEFT JOIN commit_contributors cc ON ch.author = cc.login
  WHERE cf.filename IN (SELECT filename FROM top_files)
    AND cf.line_inserts IS NOT NULL
    AND ch.is_merge = FALSE
`;

/**
 * Suffix for team grouping (GROUP BY team).
 */
export const TOP_COMPLEX_FILES_TEAM_SUFFIX = `
  GROUP BY cf.filename, COALESCE(cc.team, 'Unassigned')
)
SELECT
  tf.filename,
  tf.complexity,
  tl.contributor,
  NULL::TEXT AS team,
  tl.loc,
  CASE
    WHEN SUM(tl.loc) OVER (PARTITION BY tf.filename) > 0
    THEN ROUND((tl.loc::NUMERIC / SUM(tl.loc) OVER (PARTITION BY tf.filename)) * 100, 1)
    ELSE 0
  END AS percentage
FROM top_files tf
INNER JOIN team_loc tl ON tf.filename = tl.filename
WHERE tl.loc > 0
ORDER BY tf.complexity DESC, tl.loc DESC
`;
