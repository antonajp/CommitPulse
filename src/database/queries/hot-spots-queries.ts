/**
 * Parameterized SQL queries for the Hot Spots dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against the vw_hot_spots view created
 * by migration 013_hot_spots.sql.
 *
 * The view calculates file-level risk metrics based on:
 *   1. Churn count - number of distinct commits per file
 *   2. Complexity - current cyclomatic complexity
 *   3. Bug count - tickets of type 'Bug' linked to commits
 *   4. Risk score - weighted composite (churn 40%, complexity 40%, bugs 20%)
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-901
 */

import type { RiskTier } from '../../services/hot-spots-data-types.js';

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Applied as LIMIT in each query. Matches ticket AC of 200 files.
 */
export const HOT_SPOTS_QUERY_MAX_ROWS = 200;

/**
 * Query to check if the vw_hot_spots view exists.
 * Used for graceful degradation if migration 013 has not been applied.
 */
export const QUERY_HOT_SPOTS_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_hot_spots'
  ) AS view_exists
`;

/**
 * Query to fetch all hot spots from the view.
 * Returns files ordered by risk_score DESC (highest risk first).
 * Limited to HOT_SPOTS_QUERY_MAX_ROWS for safety.
 */
export const QUERY_HOT_SPOTS_ALL = `
  SELECT
    file_path,
    repository,
    churn_count,
    last_changed,
    contributor_count,
    complexity,
    loc,
    bug_count,
    risk_score,
    risk_tier
  FROM vw_hot_spots
  ORDER BY risk_score DESC NULLS LAST
  LIMIT ${HOT_SPOTS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch hot spots with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_HOT_SPOTS_BY_REPOSITORY = `
  SELECT
    file_path,
    repository,
    churn_count,
    last_changed,
    contributor_count,
    complexity,
    loc,
    bug_count,
    risk_score,
    risk_tier
  FROM vw_hot_spots
  WHERE repository = $1
  ORDER BY risk_score DESC NULLS LAST
  LIMIT ${HOT_SPOTS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch hot spots with risk tier filter.
 * Parameters:
 *   $1 - risk_tier (TEXT) - risk tier to filter by (critical/high/medium/low)
 */
export const QUERY_HOT_SPOTS_BY_RISK_TIER = `
  SELECT
    file_path,
    repository,
    churn_count,
    last_changed,
    contributor_count,
    complexity,
    loc,
    bug_count,
    risk_score,
    risk_tier
  FROM vw_hot_spots
  WHERE risk_tier = $1
  ORDER BY risk_score DESC NULLS LAST
  LIMIT ${HOT_SPOTS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch hot spots with minimum churn threshold.
 * Parameters:
 *   $1 - min_churn (INTEGER) - minimum churn count threshold
 */
export const QUERY_HOT_SPOTS_MIN_CHURN = `
  SELECT
    file_path,
    repository,
    churn_count,
    last_changed,
    contributor_count,
    complexity,
    loc,
    bug_count,
    risk_score,
    risk_tier
  FROM vw_hot_spots
  WHERE churn_count >= $1
  ORDER BY risk_score DESC NULLS LAST
  LIMIT ${HOT_SPOTS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch hot spots with minimum complexity threshold.
 * Parameters:
 *   $1 - min_complexity (INTEGER) - minimum complexity threshold
 */
export const QUERY_HOT_SPOTS_MIN_COMPLEXITY = `
  SELECT
    file_path,
    repository,
    churn_count,
    last_changed,
    contributor_count,
    complexity,
    loc,
    bug_count,
    risk_score,
    risk_tier
  FROM vw_hot_spots
  WHERE complexity >= $1
  ORDER BY risk_score DESC NULLS LAST
  LIMIT ${HOT_SPOTS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch hot spots with combined filters.
 * Supports repository, risk tier, min churn, and min complexity filters.
 * NULL values are treated as "no filter" via COALESCE/OR patterns.
 *
 * Parameters:
 *   $1 - repository (TEXT) - repository name (nullable)
 *   $2 - risk_tier (TEXT) - risk tier (nullable)
 *   $3 - min_churn (INTEGER) - minimum churn count (nullable)
 *   $4 - min_complexity (INTEGER) - minimum complexity (nullable)
 */
export const QUERY_HOT_SPOTS_COMBINED = `
  SELECT
    file_path,
    repository,
    churn_count,
    last_changed,
    contributor_count,
    complexity,
    loc,
    bug_count,
    risk_score,
    risk_tier
  FROM vw_hot_spots
  WHERE (repository = $1 OR $1 IS NULL)
    AND (risk_tier = $2 OR $2 IS NULL)
    AND (churn_count >= $3 OR $3 IS NULL)
    AND (complexity >= $4 OR $4 IS NULL)
  ORDER BY risk_score DESC NULLS LAST
  LIMIT ${HOT_SPOTS_QUERY_MAX_ROWS}
`;

/**
 * Query to get hot spots summary statistics.
 * Returns aggregate counts by risk tier for dashboard summary cards.
 */
export const QUERY_HOT_SPOTS_SUMMARY = `
  SELECT
    risk_tier,
    COUNT(*)::INTEGER AS file_count,
    AVG(churn_count)::NUMERIC(10,2) AS avg_churn,
    AVG(complexity)::NUMERIC(10,2) AS avg_complexity,
    SUM(bug_count)::INTEGER AS total_bugs
  FROM vw_hot_spots
  GROUP BY risk_tier
  ORDER BY
    CASE risk_tier
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END
`;

/**
 * TypeScript interface for Hot Spot row from database.
 * Maps 1:1 to vw_hot_spots view columns (snake_case).
 */
export interface HotSpotDbRow {
  readonly file_path: string;
  readonly repository: string;
  readonly churn_count: number;
  readonly last_changed: Date | string;
  readonly contributor_count: number;
  readonly complexity: number;
  readonly loc: number;
  readonly bug_count: number;
  readonly risk_score: number | string;
  readonly risk_tier: RiskTier;
}

/**
 * TypeScript interface for Hot Spots summary statistics.
 */
export interface HotSpotsSummary {
  readonly risk_tier: RiskTier;
  readonly file_count: number;
  readonly avg_churn: number;
  readonly avg_complexity: number;
  readonly total_bugs: number;
}
