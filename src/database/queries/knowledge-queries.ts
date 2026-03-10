/**
 * Parameterized SQL queries for the Knowledge Concentration dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against the vw_knowledge_concentration and vw_module_bus_factor
 * views created by migration 014_knowledge_concentration.sql.
 *
 * The views calculate:
 *   1. Ownership percentage - commits per contributor per file
 *   2. Top and second contributors per file
 *   3. Concentration risk categorization (critical >= 90%, high >= 80%, medium >= 60%)
 *   4. Bus factor - minimum people to lose before knowledge is lost
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-903
 */

import type { ConcentrationRisk } from '../../services/knowledge-concentration-types.js';

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Applied as LIMIT in each query.
 */
export const KNOWLEDGE_QUERY_MAX_ROWS = 500;

// ============================================================================
// View Existence Checks
// ============================================================================

/**
 * Query to check if the vw_knowledge_concentration view exists.
 * Used for graceful degradation if migration 014 has not been applied.
 */
export const QUERY_KNOWLEDGE_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_knowledge_concentration'
  ) AS view_exists
`;

/**
 * Query to check if the vw_module_bus_factor view exists.
 * Used for graceful degradation if migration 014 has not been applied.
 */
export const QUERY_MODULE_BUS_FACTOR_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_module_bus_factor'
  ) AS view_exists
`;

// ============================================================================
// Knowledge Concentration Queries
// ============================================================================

/**
 * Query to fetch all file ownership data from the view.
 * Returns files ordered by top_contributor_pct DESC (highest concentration first).
 * Limited to KNOWLEDGE_QUERY_MAX_ROWS for safety.
 */
export const QUERY_KNOWLEDGE_ALL = `
  SELECT
    file_path,
    repository,
    total_commits,
    total_contributors,
    top_contributor,
    top_contributor_pct,
    top_contributor_last_active,
    second_contributor,
    second_contributor_pct,
    concentration_risk,
    bus_factor
  FROM vw_knowledge_concentration
  ORDER BY top_contributor_pct DESC NULLS LAST
  LIMIT ${KNOWLEDGE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch file ownership with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_KNOWLEDGE_BY_REPOSITORY = `
  SELECT
    file_path,
    repository,
    total_commits,
    total_contributors,
    top_contributor,
    top_contributor_pct,
    top_contributor_last_active,
    second_contributor,
    second_contributor_pct,
    concentration_risk,
    bus_factor
  FROM vw_knowledge_concentration
  WHERE repository = $1
  ORDER BY top_contributor_pct DESC NULLS LAST
  LIMIT ${KNOWLEDGE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch file ownership with concentration risk filter.
 * Parameters:
 *   $1 - concentration_risk (TEXT) - risk level to filter by (critical/high/medium/low)
 */
export const QUERY_KNOWLEDGE_BY_RISK = `
  SELECT
    file_path,
    repository,
    total_commits,
    total_contributors,
    top_contributor,
    top_contributor_pct,
    top_contributor_last_active,
    second_contributor,
    second_contributor_pct,
    concentration_risk,
    bus_factor
  FROM vw_knowledge_concentration
  WHERE concentration_risk = $1
  ORDER BY top_contributor_pct DESC NULLS LAST
  LIMIT ${KNOWLEDGE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch file ownership by contributor (as top or second contributor).
 * Parameters:
 *   $1 - contributor (TEXT) - contributor name/login to filter by
 */
export const QUERY_KNOWLEDGE_BY_CONTRIBUTOR = `
  SELECT
    file_path,
    repository,
    total_commits,
    total_contributors,
    top_contributor,
    top_contributor_pct,
    top_contributor_last_active,
    second_contributor,
    second_contributor_pct,
    concentration_risk,
    bus_factor
  FROM vw_knowledge_concentration
  WHERE top_contributor = $1 OR second_contributor = $1
  ORDER BY top_contributor_pct DESC NULLS LAST
  LIMIT ${KNOWLEDGE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch file ownership with maximum bus factor filter.
 * Used to find high-risk files (low bus factor).
 * Parameters:
 *   $1 - max_bus_factor (INTEGER) - maximum bus factor threshold
 */
export const QUERY_KNOWLEDGE_BY_MAX_BUS_FACTOR = `
  SELECT
    file_path,
    repository,
    total_commits,
    total_contributors,
    top_contributor,
    top_contributor_pct,
    top_contributor_last_active,
    second_contributor,
    second_contributor_pct,
    concentration_risk,
    bus_factor
  FROM vw_knowledge_concentration
  WHERE bus_factor <= $1
  ORDER BY bus_factor ASC, top_contributor_pct DESC NULLS LAST
  LIMIT ${KNOWLEDGE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch file ownership with combined filters.
 * Supports repository, concentration_risk, contributor, and max_bus_factor filters.
 * NULL values are treated as "no filter" via COALESCE/OR patterns.
 *
 * Parameters:
 *   $1 - repository (TEXT) - repository name (nullable)
 *   $2 - concentration_risk (TEXT) - concentration risk level (nullable)
 *   $3 - contributor (TEXT) - contributor name (nullable)
 *   $4 - max_bus_factor (INTEGER) - maximum bus factor (nullable)
 */
export const QUERY_KNOWLEDGE_COMBINED = `
  SELECT
    file_path,
    repository,
    total_commits,
    total_contributors,
    top_contributor,
    top_contributor_pct,
    top_contributor_last_active,
    second_contributor,
    second_contributor_pct,
    concentration_risk,
    bus_factor
  FROM vw_knowledge_concentration
  WHERE (repository = $1 OR $1 IS NULL)
    AND (concentration_risk = $2 OR $2 IS NULL)
    AND (top_contributor = $3 OR second_contributor = $3 OR $3 IS NULL)
    AND (bus_factor <= $4 OR $4 IS NULL)
  ORDER BY top_contributor_pct DESC NULLS LAST
  LIMIT ${KNOWLEDGE_QUERY_MAX_ROWS}
`;

/**
 * Query to get knowledge concentration summary statistics.
 * Returns aggregate counts by concentration risk for dashboard summary cards.
 */
export const QUERY_KNOWLEDGE_SUMMARY = `
  SELECT
    concentration_risk,
    COUNT(*)::INTEGER AS file_count,
    AVG(bus_factor)::NUMERIC(10,2) AS avg_bus_factor,
    AVG(total_contributors)::NUMERIC(10,2) AS avg_contributors,
    AVG(top_contributor_pct)::NUMERIC(10,2) AS avg_top_contributor_pct
  FROM vw_knowledge_concentration
  GROUP BY concentration_risk
  ORDER BY
    CASE concentration_risk
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END
`;

// ============================================================================
// Module Bus Factor Queries
// ============================================================================

/**
 * Query to fetch all module bus factor data.
 * Returns modules ordered by avg_bus_factor ASC (highest risk first).
 * Limited to KNOWLEDGE_QUERY_MAX_ROWS for safety.
 */
export const QUERY_MODULE_BUS_FACTOR_ALL = `
  SELECT
    repository,
    module_path,
    file_count,
    avg_bus_factor,
    min_bus_factor,
    high_risk_files,
    critical_risk_files,
    avg_contributors,
    primary_owner
  FROM vw_module_bus_factor
  ORDER BY avg_bus_factor ASC, high_risk_files DESC
  LIMIT ${KNOWLEDGE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch module bus factor with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_MODULE_BUS_FACTOR_BY_REPOSITORY = `
  SELECT
    repository,
    module_path,
    file_count,
    avg_bus_factor,
    min_bus_factor,
    high_risk_files,
    critical_risk_files,
    avg_contributors,
    primary_owner
  FROM vw_module_bus_factor
  WHERE repository = $1
  ORDER BY avg_bus_factor ASC, high_risk_files DESC
  LIMIT ${KNOWLEDGE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch modules with high-risk files.
 * Returns only modules that have at least one high-risk file.
 */
export const QUERY_MODULE_BUS_FACTOR_HIGH_RISK = `
  SELECT
    repository,
    module_path,
    file_count,
    avg_bus_factor,
    min_bus_factor,
    high_risk_files,
    critical_risk_files,
    avg_contributors,
    primary_owner
  FROM vw_module_bus_factor
  WHERE high_risk_files > 0
  ORDER BY critical_risk_files DESC, high_risk_files DESC, avg_bus_factor ASC
  LIMIT ${KNOWLEDGE_QUERY_MAX_ROWS}
`;

// ============================================================================
// Database Row Types
// ============================================================================

/**
 * TypeScript interface for file ownership row from database.
 * Maps 1:1 to vw_knowledge_concentration view columns (snake_case).
 */
export interface KnowledgeDbRow {
  readonly file_path: string;
  readonly repository: string;
  readonly total_commits: number;
  readonly total_contributors: number;
  readonly top_contributor: string;
  readonly top_contributor_pct: number | string;
  readonly top_contributor_last_active: Date | string;
  readonly second_contributor: string | null;
  readonly second_contributor_pct: number | string | null;
  readonly concentration_risk: ConcentrationRisk;
  readonly bus_factor: number;
}

/**
 * TypeScript interface for module bus factor row from database.
 * Maps 1:1 to vw_module_bus_factor view columns (snake_case).
 */
export interface ModuleBusFactorDbRow {
  readonly repository: string;
  readonly module_path: string;
  readonly file_count: number;
  readonly avg_bus_factor: number | string;
  readonly min_bus_factor: number;
  readonly high_risk_files: number;
  readonly critical_risk_files: number;
  readonly avg_contributors: number | string;
  readonly primary_owner: string;
}

/**
 * TypeScript interface for knowledge concentration summary statistics.
 */
export interface KnowledgeSummary {
  readonly concentration_risk: ConcentrationRisk;
  readonly file_count: number;
  readonly avg_bus_factor: number;
  readonly avg_contributors: number;
  readonly avg_top_contributor_pct: number;
}
