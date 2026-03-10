/**
 * Parameterized SQL queries for the Top Files by Churn chart.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Churn is calculated as SUM(line_inserts + line_deletes) per file.
 * The chart shows the top N files sorted by total churn descending,
 * with bar segments colored by team or contributor.
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-895
 */

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 */
export const FILE_CHURN_MAX_RESULT_ROWS = 1000;

/**
 * Maximum allowed topN parameter value.
 */
export const FILE_CHURN_MAX_TOP_N = 100;

/**
 * Minimum allowed topN parameter value.
 */
export const FILE_CHURN_MIN_TOP_N = 1;

/**
 * Default topN value.
 */
export const FILE_CHURN_DEFAULT_TOP_N = 20;

/**
 * Query to get top N files by churn with team aggregation.
 * Uses a CTE to first find top N files by total churn,
 * then aggregates churn by team for those files.
 *
 * Parameters:
 *   $1 - topN (number of files to return)
 *   $2+ - optional filters (startDate, endDate, team, repository)
 */
export const FILE_CHURN_BY_TEAM = `
WITH top_churn_files AS (
  -- Step 1: Find top N files by total churn
  SELECT cf.filename
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  WHERE cf.line_inserts IS NOT NULL
    AND ch.is_merge = FALSE
    AND cf.filename NOT LIKE 'node_modules/%'
    AND cf.filename NOT LIKE '%/node_modules/%'
    AND cf.filename NOT LIKE 'vendor/%'
    AND cf.filename NOT LIKE '%/vendor/%'
    AND cf.filename NOT LIKE '.yarn/%'
    AND cf.filename NOT LIKE 'bower_components/%'
    AND cf.filename NOT LIKE '__pycache__/%'
    AND cf.filename NOT LIKE '%/__pycache__/%'
    AND cf.filename NOT LIKE '.venv/%'
    AND cf.filename NOT LIKE 'venv/%'
    AND cf.filename NOT LIKE 'target/%'
    AND cf.filename NOT LIKE 'dist/%'
    AND cf.filename NOT LIKE 'build/%'
    AND cf.filename NOT LIKE 'bin/%'
    AND cf.filename NOT LIKE 'obj/%'
`;

/**
 * Suffix for top files CTE - completes GROUP BY and gets topN files.
 * This is appended after optional filter conditions.
 */
export const FILE_CHURN_TOP_FILES_SUFFIX = `
  GROUP BY cf.filename
  ORDER BY SUM(cf.line_inserts + cf.line_deletes) DESC
  LIMIT $1
),
file_totals AS (
  -- Calculate total churn per file for percentage calculation
  SELECT cf.filename, SUM(cf.line_inserts + cf.line_deletes)::BIGINT AS total_churn
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  WHERE cf.filename IN (SELECT filename FROM top_churn_files)
    AND cf.line_inserts IS NOT NULL
    AND ch.is_merge = FALSE
  GROUP BY cf.filename
),
team_breakdown AS (
  -- Step 2: Aggregate churn by team for the top files
  SELECT
    cf.filename,
    COALESCE(cc.team, '(Unassigned)') AS contributor,
    SUM(cf.line_inserts + cf.line_deletes)::BIGINT AS churn
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  LEFT JOIN commit_contributors cc ON ch.author = cc.login
  WHERE cf.filename IN (SELECT filename FROM top_churn_files)
    AND cf.line_inserts IS NOT NULL
    AND ch.is_merge = FALSE
`;

/**
 * Final SELECT for team grouping.
 */
export const FILE_CHURN_TEAM_SELECT = `
  GROUP BY cf.filename, COALESCE(cc.team, '(Unassigned)')
)
SELECT
  ft.filename,
  ft.total_churn,
  tb.contributor,
  NULL::TEXT AS team,
  tb.churn,
  CASE
    WHEN ft.total_churn > 0
    THEN ROUND((tb.churn::NUMERIC / ft.total_churn) * 100, 1)
    ELSE 0
  END AS percentage
FROM file_totals ft
INNER JOIN team_breakdown tb ON ft.filename = tb.filename
WHERE tb.churn > 0
ORDER BY ft.total_churn DESC, tb.churn DESC
`;

/**
 * Query to get top N files by churn with individual contributor aggregation.
 * Similar to team query but aggregates by contributor instead.
 *
 * Parameters:
 *   $1 - topN (number of files to return)
 *   $2+ - optional filters (startDate, endDate, team, repository)
 */
export const FILE_CHURN_BY_INDIVIDUAL = `
WITH top_churn_files AS (
  -- Step 1: Find top N files by total churn
  SELECT cf.filename
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  WHERE cf.line_inserts IS NOT NULL
    AND ch.is_merge = FALSE
    AND cf.filename NOT LIKE 'node_modules/%'
    AND cf.filename NOT LIKE '%/node_modules/%'
    AND cf.filename NOT LIKE 'vendor/%'
    AND cf.filename NOT LIKE '%/vendor/%'
    AND cf.filename NOT LIKE '.yarn/%'
    AND cf.filename NOT LIKE 'bower_components/%'
    AND cf.filename NOT LIKE '__pycache__/%'
    AND cf.filename NOT LIKE '%/__pycache__/%'
    AND cf.filename NOT LIKE '.venv/%'
    AND cf.filename NOT LIKE 'venv/%'
    AND cf.filename NOT LIKE 'target/%'
    AND cf.filename NOT LIKE 'dist/%'
    AND cf.filename NOT LIKE 'build/%'
    AND cf.filename NOT LIKE 'bin/%'
    AND cf.filename NOT LIKE 'obj/%'
`;

/**
 * Individual aggregation for top files CTE.
 */
export const FILE_CHURN_TOP_FILES_INDIVIDUAL_SUFFIX = `
  GROUP BY cf.filename
  ORDER BY SUM(cf.line_inserts + cf.line_deletes) DESC
  LIMIT $1
),
file_totals AS (
  -- Calculate total churn per file for percentage calculation
  SELECT cf.filename, SUM(cf.line_inserts + cf.line_deletes)::BIGINT AS total_churn
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  WHERE cf.filename IN (SELECT filename FROM top_churn_files)
    AND cf.line_inserts IS NOT NULL
    AND ch.is_merge = FALSE
  GROUP BY cf.filename
),
contributor_breakdown AS (
  -- Step 2: Aggregate churn by contributor for the top files
  SELECT
    cf.filename,
    COALESCE(cc.full_name, ch.author) AS contributor,
    cc.team AS team,
    SUM(cf.line_inserts + cf.line_deletes)::BIGINT AS churn
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  LEFT JOIN commit_contributors cc ON ch.author = cc.login
  WHERE cf.filename IN (SELECT filename FROM top_churn_files)
    AND cf.line_inserts IS NOT NULL
    AND ch.is_merge = FALSE
`;

/**
 * Final SELECT for individual contributor grouping.
 */
export const FILE_CHURN_INDIVIDUAL_SELECT = `
  GROUP BY cf.filename, COALESCE(cc.full_name, ch.author), cc.team
)
SELECT
  ft.filename,
  ft.total_churn,
  cb.contributor,
  cb.team,
  cb.churn,
  CASE
    WHEN ft.total_churn > 0
    THEN ROUND((cb.churn::NUMERIC / ft.total_churn) * 100, 1)
    ELSE 0
  END AS percentage
FROM file_totals ft
INNER JOIN contributor_breakdown cb ON ft.filename = cb.filename
WHERE cb.churn > 0
ORDER BY ft.total_churn DESC, cb.churn DESC
`;

/**
 * Query to get drill-down commit details for a specific file and team/contributor.
 * Used when user clicks on a bar segment.
 *
 * Parameters:
 *   $1 - filename
 *   $2 - contributor/team name
 *   $3 - groupBy mode ('team' or 'individual')
 *   $4, $5 - optional startDate, endDate
 */
export const FILE_CHURN_DRILLDOWN_BY_TEAM = `
SELECT
  ch.sha,
  ch.commit_date,
  ch.author,
  ch.message,
  cf.line_inserts AS lines_added,
  cf.line_deletes AS lines_deleted
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE cf.filename = $1
  AND COALESCE(cc.team, '(Unassigned)') = $2
  AND ch.is_merge = FALSE
`;

/**
 * Drill-down query for individual contributor mode.
 */
export const FILE_CHURN_DRILLDOWN_BY_INDIVIDUAL = `
SELECT
  ch.sha,
  ch.commit_date,
  ch.author,
  ch.message,
  cf.line_inserts AS lines_added,
  cf.line_deletes AS lines_deleted
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE cf.filename = $1
  AND COALESCE(cc.full_name, ch.author) = $2
  AND ch.is_merge = FALSE
`;

/**
 * Drilldown date filter suffix.
 */
export const FILE_CHURN_DRILLDOWN_DATE_SUFFIX = `
ORDER BY ch.commit_date DESC
LIMIT 100
`;
