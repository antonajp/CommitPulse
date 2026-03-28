/**
 * Parameterized SQL queries for the Complexity Trend chart.
 * All queries use $1, $2, ... placeholders for SQL injection prevention.
 *
 * The complexity trend chart aggregates complexity metrics from commit_files
 * joined with commit_history and commit_contributors.
 *
 * Ticket: GITX-133
 */

/**
 * Check if commit_files has complexity data.
 * Used for graceful degradation when no complexity data is available.
 */
export const QUERY_COMPLEXITY_TREND_DATA_EXISTS = `
SELECT EXISTS (
  SELECT 1 FROM commit_files cf
  WHERE cf.complexity IS NOT NULL
     OR cf.weighted_complexity IS NOT NULL
  LIMIT 1
) AS data_exists;
`;

/**
 * Get distinct teams from commit_contributors for filter dropdown.
 */
export const QUERY_COMPLEXITY_TREND_TEAMS = `
SELECT DISTINCT team
FROM commit_contributors
WHERE team IS NOT NULL
  AND team != ''
ORDER BY team ASC;
`;

/**
 * Get distinct contributors (authors) from commit_history for filter dropdown.
 */
export const QUERY_COMPLEXITY_TREND_CONTRIBUTORS = `
SELECT DISTINCT
  COALESCE(cc.full_name, ch.author) AS contributor
FROM commit_history ch
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND EXISTS (
    SELECT 1 FROM commit_files cf
    WHERE cf.sha = ch.sha
      AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  )
ORDER BY contributor ASC;
`;

/**
 * Get distinct repositories from commit_history for filter dropdown.
 */
export const QUERY_COMPLEXITY_TREND_REPOSITORIES = `
SELECT DISTINCT repository
FROM commit_history
WHERE repository IS NOT NULL
  AND repository != ''
ORDER BY repository ASC;
`;

/**
 * Complexity trend aggregated by day.
 * Parameters: $1 = startDate, $2 = endDate
 * Optional filters are applied dynamically in the data service.
 */
export const QUERY_COMPLEXITY_TREND_DAILY = `
SELECT
  DATE(ch.commit_date) AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
GROUP BY DATE(ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by week.
 * Parameters: $1 = startDate, $2 = endDate
 */
export const QUERY_COMPLEXITY_TREND_WEEKLY = `
SELECT
  DATE_TRUNC('week', ch.commit_date)::DATE AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
GROUP BY DATE_TRUNC('week', ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by month.
 * Parameters: $1 = startDate, $2 = endDate
 */
export const QUERY_COMPLEXITY_TREND_MONTHLY = `
SELECT
  DATE_TRUNC('month', ch.commit_date)::DATE AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
GROUP BY DATE_TRUNC('month', ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by day with team filter.
 * Parameters: $1 = startDate, $2 = endDate, $3 = team
 */
export const QUERY_COMPLEXITY_TREND_DAILY_TEAM = `
SELECT
  DATE(ch.commit_date) AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
  AND cc.team = $3
GROUP BY DATE(ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by week with team filter.
 * Parameters: $1 = startDate, $2 = endDate, $3 = team
 */
export const QUERY_COMPLEXITY_TREND_WEEKLY_TEAM = `
SELECT
  DATE_TRUNC('week', ch.commit_date)::DATE AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
  AND cc.team = $3
GROUP BY DATE_TRUNC('week', ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by month with team filter.
 * Parameters: $1 = startDate, $2 = endDate, $3 = team
 */
export const QUERY_COMPLEXITY_TREND_MONTHLY_TEAM = `
SELECT
  DATE_TRUNC('month', ch.commit_date)::DATE AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
  AND cc.team = $3
GROUP BY DATE_TRUNC('month', ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by day with contributor filter.
 * Parameters: $1 = startDate, $2 = endDate, $3 = contributor
 */
export const QUERY_COMPLEXITY_TREND_DAILY_CONTRIBUTOR = `
SELECT
  DATE(ch.commit_date) AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
  AND (cc.full_name = $3 OR ch.author = $3)
GROUP BY DATE(ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by week with contributor filter.
 * Parameters: $1 = startDate, $2 = endDate, $3 = contributor
 */
export const QUERY_COMPLEXITY_TREND_WEEKLY_CONTRIBUTOR = `
SELECT
  DATE_TRUNC('week', ch.commit_date)::DATE AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
  AND (cc.full_name = $3 OR ch.author = $3)
GROUP BY DATE_TRUNC('week', ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by month with contributor filter.
 * Parameters: $1 = startDate, $2 = endDate, $3 = contributor
 */
export const QUERY_COMPLEXITY_TREND_MONTHLY_CONTRIBUTOR = `
SELECT
  DATE_TRUNC('month', ch.commit_date)::DATE AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
  AND (cc.full_name = $3 OR ch.author = $3)
GROUP BY DATE_TRUNC('month', ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by day with repository filter.
 * Parameters: $1 = startDate, $2 = endDate, $3 = repository
 */
export const QUERY_COMPLEXITY_TREND_DAILY_REPOSITORY = `
SELECT
  DATE(ch.commit_date) AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
  AND ch.repository = $3
GROUP BY DATE(ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by week with repository filter.
 * Parameters: $1 = startDate, $2 = endDate, $3 = repository
 */
export const QUERY_COMPLEXITY_TREND_WEEKLY_REPOSITORY = `
SELECT
  DATE_TRUNC('week', ch.commit_date)::DATE AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
  AND ch.repository = $3
GROUP BY DATE_TRUNC('week', ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;

/**
 * Complexity trend aggregated by month with repository filter.
 * Parameters: $1 = startDate, $2 = endDate, $3 = repository
 */
export const QUERY_COMPLEXITY_TREND_MONTHLY_REPOSITORY = `
SELECT
  DATE_TRUNC('month', ch.commit_date)::DATE AS date,
  COALESCE(cc.full_name, ch.author) AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
  AND (cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)
  AND ch.commit_date >= $1::DATE
  AND ch.commit_date <= $2::DATE
  AND ch.repository = $3
GROUP BY DATE_TRUNC('month', ch.commit_date), COALESCE(cc.full_name, ch.author)
ORDER BY date ASC, avg_complexity DESC
LIMIT 5000;
`;
