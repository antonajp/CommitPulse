/**
 * Parameterized SQL queries for the Complexity Trend chart.
 * All queries use $1, $2, ... placeholders for SQL injection prevention.
 *
 * The complexity trend chart aggregates complexity metrics from commit_files
 * joined with commit_history and commit_contributors.
 *
 * Ticket: GITX-133, GITX-134
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
 * Get distinct technology stack categories from vw_technology_stack_category.
 * Used for tech stack filter dropdown (GITX-134).
 */
export const QUERY_COMPLEXITY_TREND_TECH_STACKS = `
SELECT DISTINCT category
FROM vw_technology_stack_category
WHERE category IS NOT NULL
  AND category != ''
  AND category != 'Other'
ORDER BY category ASC;
`;

// Note: Dynamic query construction is handled in ComplexityTrendDataService.buildQuery()
// which uses parameterized queries for all user inputs including LIMIT.
// The query builder supports: groupBy (contributor/team/repository/techStack),
// period (daily/weekly/monthly), and filters (team/contributor/repository/techStack).
// See: src/services/complexity-trend-data-service.ts (GITX-134)
