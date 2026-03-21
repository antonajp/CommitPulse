/**
 * Parameterized SQL queries for the File Author LOC Contribution Report.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Query aggregates LOC contributions by author per file within a date range.
 * Results are used for horizontal stacked bar charts showing file ownership.
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: GITX-128
 */

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 */
export const FILE_AUTHOR_LOC_MAX_RESULT_ROWS = 5000;

/**
 * Maximum number of commits returned for drill-down view.
 */
export const FILE_AUTHOR_LOC_DRILLDOWN_LIMIT = 100;

/**
 * Query to get author contributions aggregated by file.
 * Uses ANY($1) for file path array and date range filtering.
 *
 * Parameters:
 *   $1 - filenames (text[]) - Array of file paths to analyze
 *   $2 - startDate (date) - Start of date range (inclusive)
 *   $3 - endDate (date) - End of date range (inclusive)
 *
 * Returns aggregated LOC metrics per author per file.
 */
export const QUERY_FILE_AUTHOR_LOC = `
SELECT
  cf.filename,
  ch.author,
  COALESCE(cc.full_name, ch.author) AS author_name,
  cc.team,
  SUM(cf.line_inserts)::BIGINT AS lines_added,
  SUM(cf.line_deletes)::BIGINT AS lines_deleted,
  SUM(cf.line_inserts - cf.line_deletes)::BIGINT AS net_lines,
  SUM(cf.line_inserts + cf.line_deletes)::BIGINT AS total_churn,
  COUNT(DISTINCT ch.sha)::INT AS commit_count,
  MIN(ch.commit_date) AS first_commit,
  MAX(ch.commit_date) AS last_commit
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE cf.filename = ANY($1)
  AND ch.commit_date >= $2
  AND ch.commit_date <= $3
  AND ch.is_merge = FALSE
  AND cf.line_inserts IS NOT NULL
GROUP BY cf.filename, ch.author, cc.full_name, cc.team
ORDER BY cf.filename, total_churn DESC
LIMIT ${FILE_AUTHOR_LOC_MAX_RESULT_ROWS}
`;

/**
 * Query to get author contributions with repository filter.
 *
 * Parameters:
 *   $1 - filenames (text[]) - Array of file paths to analyze
 *   $2 - startDate (date) - Start of date range (inclusive)
 *   $3 - endDate (date) - End of date range (inclusive)
 *   $4 - repository (text) - Repository name to filter by
 */
export const QUERY_FILE_AUTHOR_LOC_BY_REPO = `
SELECT
  cf.filename,
  ch.author,
  COALESCE(cc.full_name, ch.author) AS author_name,
  cc.team,
  SUM(cf.line_inserts)::BIGINT AS lines_added,
  SUM(cf.line_deletes)::BIGINT AS lines_deleted,
  SUM(cf.line_inserts - cf.line_deletes)::BIGINT AS net_lines,
  SUM(cf.line_inserts + cf.line_deletes)::BIGINT AS total_churn,
  COUNT(DISTINCT ch.sha)::INT AS commit_count,
  MIN(ch.commit_date) AS first_commit,
  MAX(ch.commit_date) AS last_commit
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE cf.filename = ANY($1)
  AND ch.commit_date >= $2
  AND ch.commit_date <= $3
  AND ch.repository = $4
  AND ch.is_merge = FALSE
  AND cf.line_inserts IS NOT NULL
GROUP BY cf.filename, ch.author, cc.full_name, cc.team
ORDER BY cf.filename, total_churn DESC
LIMIT ${FILE_AUTHOR_LOC_MAX_RESULT_ROWS}
`;

/**
 * Query to get commit drill-down details for a specific file and author.
 * Used when user clicks on a bar segment.
 *
 * Parameters:
 *   $1 - filename (text) - Specific file path
 *   $2 - author (text) - Author login to filter by
 *   $3 - startDate (date) - Start of date range
 *   $4 - endDate (date) - End of date range
 */
export const QUERY_FILE_AUTHOR_COMMITS = `
SELECT
  ch.sha,
  ch.commit_date,
  ch.author,
  ch.message,
  cf.line_inserts AS lines_added,
  cf.line_deletes AS lines_deleted
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
WHERE cf.filename = $1
  AND ch.author = $2
  AND ch.commit_date >= $3
  AND ch.commit_date <= $4
  AND ch.is_merge = FALSE
ORDER BY ch.commit_date DESC
LIMIT ${FILE_AUTHOR_LOC_DRILLDOWN_LIMIT}
`;

/**
 * Query to get available files matching a pattern (for autocomplete).
 * Uses LIKE pattern matching with proper escaping.
 *
 * Parameters:
 *   $1 - pattern (text) - Pattern to match (with SQL wildcards)
 *   $2 - limit (int) - Maximum number of results
 */
export const QUERY_FILES_MATCHING_PATTERN = `
SELECT DISTINCT cf.filename
FROM commit_files cf
WHERE cf.filename LIKE $1
ORDER BY cf.filename
LIMIT $2
`;

/**
 * Query to get file list for a specific repository (for file picker).
 *
 * Parameters:
 *   $1 - repository (text) - Repository name
 *   $2 - limit (int) - Maximum number of results
 */
export const QUERY_FILES_BY_REPOSITORY = `
SELECT DISTINCT cf.filename
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
WHERE ch.repository = $1
ORDER BY cf.filename
LIMIT $2
`;

/**
 * Query to get unique repositories (for repository dropdown).
 * No parameters required.
 */
export const QUERY_DISTINCT_REPOSITORIES = `
SELECT DISTINCT repository
FROM commit_history
WHERE repository IS NOT NULL
ORDER BY repository
`;
