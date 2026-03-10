/**
 * Parameterized SQL queries for the Architecture Drift Heat Map Dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against views created by migration 021_architecture_drift.sql:
 *   - vw_component_changes: Maps commits to touched components
 *   - vw_cross_component_commits: Commits touching 2+ components
 *   - vw_architecture_drift: Component-level drift metrics
 *   - vw_architecture_drift_weekly: Component x week matrix
 *   - vw_component_pair_coupling: Component pair coupling data
 *
 * The views calculate:
 *   1. Cross-component commit detection
 *   2. Drift severity assignment (critical/high/medium/low)
 *   3. Heat map intensity values (0-100)
 *   4. Component pair coupling strength
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-917
 */

import type { DriftSeverity } from '../../services/architecture-drift-types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum number of drift result rows returned.
 */
export const DRIFT_QUERY_MAX_ROWS = 500;

/**
 * Maximum number of cross-component commit rows returned.
 */
export const DRIFT_QUERY_MAX_COMMIT_ROWS = 500;

/**
 * Maximum number of weekly trend rows returned.
 */
export const DRIFT_QUERY_MAX_WEEKLY_ROWS = 200;

/**
 * Maximum number of component pair coupling rows returned.
 */
export const DRIFT_QUERY_MAX_COUPLING_ROWS = 100;

// ============================================================================
// View Existence Queries
// ============================================================================

/**
 * Query to check if the vw_component_changes view exists.
 * Used for graceful degradation if migration 021 has not been applied.
 */
export const QUERY_COMPONENT_CHANGES_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_component_changes'
  ) AS view_exists
`;

/**
 * Query to check if the vw_cross_component_commits view exists.
 */
export const QUERY_CROSS_COMPONENT_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_cross_component_commits'
  ) AS view_exists
`;

/**
 * Query to check if the vw_architecture_drift view exists.
 */
export const QUERY_DRIFT_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_architecture_drift'
  ) AS view_exists
`;

/**
 * Query to check if the vw_architecture_drift_weekly view exists.
 */
export const QUERY_DRIFT_WEEKLY_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_architecture_drift_weekly'
  ) AS view_exists
`;

/**
 * Query to check if the vw_component_pair_coupling view exists.
 */
export const QUERY_COUPLING_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_component_pair_coupling'
  ) AS view_exists
`;

// ============================================================================
// Cross-Component Commits Queries
// ============================================================================

/**
 * Query to fetch all cross-component commits.
 * Returns commits ordered by commit_date DESC.
 * Limited to DRIFT_QUERY_MAX_COMMIT_ROWS for safety.
 */
export const QUERY_CROSS_COMPONENT_ALL = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    component_count,
    components_touched,
    total_files_changed,
    total_lines_added,
    total_lines_removed,
    drift_severity,
    drift_score
  FROM vw_cross_component_commits
  ORDER BY commit_date DESC
  LIMIT ${DRIFT_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch cross-component commits with date range filter.
 * Parameters:
 *   $1 - start_date (DATE) - start of date range
 *   $2 - end_date (DATE) - end of date range
 */
export const QUERY_CROSS_COMPONENT_DATE_RANGE = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    component_count,
    components_touched,
    total_files_changed,
    total_lines_added,
    total_lines_removed,
    drift_severity,
    drift_score
  FROM vw_cross_component_commits
  WHERE commit_date >= $1::DATE AND commit_date <= $2::DATE
  ORDER BY commit_date DESC
  LIMIT ${DRIFT_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch cross-component commits by repository.
 * Parameters:
 *   $1 - repository (TEXT) - repository name
 */
export const QUERY_CROSS_COMPONENT_BY_REPOSITORY = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    component_count,
    components_touched,
    total_files_changed,
    total_lines_added,
    total_lines_removed,
    drift_severity,
    drift_score
  FROM vw_cross_component_commits
  WHERE repository = $1
  ORDER BY commit_date DESC
  LIMIT ${DRIFT_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch cross-component commits by severity.
 * Parameters:
 *   $1 - drift_severity (TEXT) - severity level
 */
export const QUERY_CROSS_COMPONENT_BY_SEVERITY = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    component_count,
    components_touched,
    total_files_changed,
    total_lines_added,
    total_lines_removed,
    drift_severity,
    drift_score
  FROM vw_cross_component_commits
  WHERE drift_severity = $1
  ORDER BY commit_date DESC
  LIMIT ${DRIFT_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch cross-component commits with combined filters.
 * NULL values are treated as "no filter" via COALESCE/OR patterns.
 *
 * Parameters:
 *   $1 - start_date (DATE) - start of date range (nullable)
 *   $2 - end_date (DATE) - end of date range (nullable)
 *   $3 - repository (TEXT) - repository name (nullable)
 *   $4 - drift_severity (TEXT) - severity level (nullable)
 *   $5 - author (TEXT) - author login (nullable)
 *   $6 - team (TEXT) - team name (nullable)
 */
export const QUERY_CROSS_COMPONENT_COMBINED = `
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    component_count,
    components_touched,
    total_files_changed,
    total_lines_added,
    total_lines_removed,
    drift_severity,
    drift_score
  FROM vw_cross_component_commits
  WHERE (commit_date >= $1::DATE OR $1 IS NULL)
    AND (commit_date <= $2::DATE OR $2 IS NULL)
    AND (repository = $3 OR $3 IS NULL)
    AND (drift_severity = $4 OR $4 IS NULL)
    AND (author = $5 OR $5 IS NULL)
    AND (team = $6 OR $6 IS NULL)
  ORDER BY commit_date DESC
  LIMIT ${DRIFT_QUERY_MAX_COMMIT_ROWS}
`;

// ============================================================================
// Architecture Drift Queries
// ============================================================================

/**
 * Query to fetch all architecture drift data.
 * Returns components ordered by heat_intensity DESC.
 */
export const QUERY_DRIFT_ALL = `
  SELECT
    component,
    repository,
    cross_component_commits,
    total_commits,
    drift_percentage,
    total_churn,
    avg_components_per_commit,
    critical_count,
    high_count,
    medium_count,
    low_count,
    unique_authors,
    unique_teams,
    first_drift_date,
    last_drift_date,
    heat_intensity
  FROM vw_architecture_drift
  ORDER BY heat_intensity DESC
  LIMIT ${DRIFT_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch architecture drift by repository.
 * Parameters:
 *   $1 - repository (TEXT) - repository name
 */
export const QUERY_DRIFT_BY_REPOSITORY = `
  SELECT
    component,
    repository,
    cross_component_commits,
    total_commits,
    drift_percentage,
    total_churn,
    avg_components_per_commit,
    critical_count,
    high_count,
    medium_count,
    low_count,
    unique_authors,
    unique_teams,
    first_drift_date,
    last_drift_date,
    heat_intensity
  FROM vw_architecture_drift
  WHERE repository = $1
  ORDER BY heat_intensity DESC
  LIMIT ${DRIFT_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch architecture drift by component.
 * Parameters:
 *   $1 - component (TEXT) - component name
 */
export const QUERY_DRIFT_BY_COMPONENT = `
  SELECT
    component,
    repository,
    cross_component_commits,
    total_commits,
    drift_percentage,
    total_churn,
    avg_components_per_commit,
    critical_count,
    high_count,
    medium_count,
    low_count,
    unique_authors,
    unique_teams,
    first_drift_date,
    last_drift_date,
    heat_intensity
  FROM vw_architecture_drift
  WHERE component = $1
  ORDER BY heat_intensity DESC
  LIMIT ${DRIFT_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch architecture drift by minimum heat intensity.
 * Parameters:
 *   $1 - min_heat_intensity (NUMERIC) - minimum intensity threshold
 */
export const QUERY_DRIFT_BY_MIN_INTENSITY = `
  SELECT
    component,
    repository,
    cross_component_commits,
    total_commits,
    drift_percentage,
    total_churn,
    avg_components_per_commit,
    critical_count,
    high_count,
    medium_count,
    low_count,
    unique_authors,
    unique_teams,
    first_drift_date,
    last_drift_date,
    heat_intensity
  FROM vw_architecture_drift
  WHERE heat_intensity >= $1
  ORDER BY heat_intensity DESC
  LIMIT ${DRIFT_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch architecture drift with combined filters.
 * NULL values are treated as "no filter" via COALESCE/OR patterns.
 *
 * Parameters:
 *   $1 - repository (TEXT) - repository name (nullable)
 *   $2 - component (TEXT) - component name (nullable)
 *   $3 - min_heat_intensity (NUMERIC) - minimum intensity (nullable)
 */
export const QUERY_DRIFT_COMBINED = `
  SELECT
    component,
    repository,
    cross_component_commits,
    total_commits,
    drift_percentage,
    total_churn,
    avg_components_per_commit,
    critical_count,
    high_count,
    medium_count,
    low_count,
    unique_authors,
    unique_teams,
    first_drift_date,
    last_drift_date,
    heat_intensity
  FROM vw_architecture_drift
  WHERE (repository = $1 OR $1 IS NULL)
    AND (component = $2 OR $2 IS NULL)
    AND (heat_intensity >= $3 OR $3 IS NULL)
  ORDER BY heat_intensity DESC
  LIMIT ${DRIFT_QUERY_MAX_ROWS}
`;

// ============================================================================
// Weekly Drift Trend Queries
// ============================================================================

/**
 * Query to fetch all weekly drift trends.
 * Returns weeks ordered by week DESC.
 */
export const QUERY_WEEKLY_DRIFT_ALL = `
  SELECT
    week,
    component,
    repository,
    cross_component_commits,
    total_commits,
    drift_percentage,
    weekly_churn,
    avg_components,
    critical_count,
    high_count,
    medium_count,
    low_count,
    unique_authors,
    heat_intensity
  FROM vw_architecture_drift_weekly
  ORDER BY week DESC, heat_intensity DESC
  LIMIT ${DRIFT_QUERY_MAX_WEEKLY_ROWS}
`;

/**
 * Query to fetch weekly drift by repository.
 * Parameters:
 *   $1 - repository (TEXT) - repository name
 */
export const QUERY_WEEKLY_DRIFT_BY_REPOSITORY = `
  SELECT
    week,
    component,
    repository,
    cross_component_commits,
    total_commits,
    drift_percentage,
    weekly_churn,
    avg_components,
    critical_count,
    high_count,
    medium_count,
    low_count,
    unique_authors,
    heat_intensity
  FROM vw_architecture_drift_weekly
  WHERE repository = $1
  ORDER BY week DESC, heat_intensity DESC
  LIMIT ${DRIFT_QUERY_MAX_WEEKLY_ROWS}
`;

/**
 * Query to fetch weekly drift by component.
 * Parameters:
 *   $1 - component (TEXT) - component name
 */
export const QUERY_WEEKLY_DRIFT_BY_COMPONENT = `
  SELECT
    week,
    component,
    repository,
    cross_component_commits,
    total_commits,
    drift_percentage,
    weekly_churn,
    avg_components,
    critical_count,
    high_count,
    medium_count,
    low_count,
    unique_authors,
    heat_intensity
  FROM vw_architecture_drift_weekly
  WHERE component = $1
  ORDER BY week DESC, heat_intensity DESC
  LIMIT ${DRIFT_QUERY_MAX_WEEKLY_ROWS}
`;

// ============================================================================
// Component Pair Coupling Queries
// ============================================================================

/**
 * Query to fetch all component pair coupling data.
 * Returns pairs ordered by coupling_count DESC.
 */
export const QUERY_PAIR_COUPLING_ALL = `
  SELECT
    component_a,
    component_b,
    repository,
    coupling_count,
    unique_commits,
    unique_authors,
    unique_teams,
    critical_count,
    high_count,
    first_coupling_date,
    last_coupling_date,
    coupling_strength
  FROM vw_component_pair_coupling
  ORDER BY coupling_count DESC, coupling_strength DESC
  LIMIT ${DRIFT_QUERY_MAX_COUPLING_ROWS}
`;

/**
 * Query to fetch component pair coupling by repository.
 * Parameters:
 *   $1 - repository (TEXT) - repository name
 */
export const QUERY_PAIR_COUPLING_BY_REPOSITORY = `
  SELECT
    component_a,
    component_b,
    repository,
    coupling_count,
    unique_commits,
    unique_authors,
    unique_teams,
    critical_count,
    high_count,
    first_coupling_date,
    last_coupling_date,
    coupling_strength
  FROM vw_component_pair_coupling
  WHERE repository = $1
  ORDER BY coupling_count DESC, coupling_strength DESC
  LIMIT ${DRIFT_QUERY_MAX_COUPLING_ROWS}
`;

/**
 * Query to fetch component pair coupling for a specific component.
 * Parameters:
 *   $1 - component (TEXT) - component name
 */
export const QUERY_PAIR_COUPLING_BY_COMPONENT = `
  SELECT
    component_a,
    component_b,
    repository,
    coupling_count,
    unique_commits,
    unique_authors,
    unique_teams,
    critical_count,
    high_count,
    first_coupling_date,
    last_coupling_date,
    coupling_strength
  FROM vw_component_pair_coupling
  WHERE component_a = $1 OR component_b = $1
  ORDER BY coupling_count DESC, coupling_strength DESC
  LIMIT ${DRIFT_QUERY_MAX_COUPLING_ROWS}
`;

// ============================================================================
// Summary Queries
// ============================================================================

/**
 * Query to get drift summary statistics.
 * Returns aggregate metrics for the drift analysis.
 */
export const QUERY_DRIFT_SUMMARY = `
  WITH drift_stats AS (
    SELECT
      SUM(cross_component_commits) AS total_cross_component_commits,
      COUNT(DISTINCT component) AS total_components,
      ROUND(AVG(drift_percentage)::NUMERIC, 2) AS avg_drift_percentage,
      MAX(heat_intensity) AS max_heat_intensity,
      SUM(critical_count) AS total_critical,
      SUM(high_count) AS total_high,
      SUM(medium_count) AS total_medium,
      SUM(low_count) AS total_low
    FROM vw_architecture_drift
  ),
  highest_drift AS (
    SELECT component
    FROM vw_architecture_drift
    ORDER BY heat_intensity DESC
    LIMIT 1
  )
  SELECT
    ds.total_cross_component_commits,
    ds.total_components,
    ds.avg_drift_percentage,
    ds.max_heat_intensity,
    hd.component AS highest_drift_component,
    ds.total_critical,
    ds.total_high,
    ds.total_medium,
    ds.total_low
  FROM drift_stats ds
  CROSS JOIN highest_drift hd
`;

/**
 * Query to get list of unique components in drift data.
 * Used for filter dropdowns.
 */
export const QUERY_UNIQUE_COMPONENTS = `
  SELECT DISTINCT component
  FROM vw_architecture_drift
  ORDER BY component
`;

/**
 * Query to get list of unique repositories in drift data.
 * Used for filter dropdowns.
 */
export const QUERY_UNIQUE_REPOSITORIES = `
  SELECT DISTINCT repository
  FROM vw_architecture_drift
  ORDER BY repository
`;

// ============================================================================
// Database Row Types
// ============================================================================

/**
 * TypeScript interface for cross-component commit row from database.
 * Maps 1:1 to vw_cross_component_commits view columns (snake_case).
 */
export interface CrossComponentDbRow {
  readonly sha: string;
  readonly commit_date: Date | string;
  readonly author: string;
  readonly repository: string;
  readonly branch: string;
  readonly commit_message: string;
  readonly file_count: number | string;
  readonly lines_added: number | string;
  readonly lines_removed: number | string;
  readonly full_name: string | null;
  readonly team: string | null;
  readonly component_count: number | string;
  readonly components_touched: string[];
  readonly total_files_changed: number | string;
  readonly total_lines_added: number | string;
  readonly total_lines_removed: number | string;
  readonly drift_severity: DriftSeverity;
  readonly drift_score: number | string;
}

/**
 * TypeScript interface for architecture drift row from database.
 * Maps 1:1 to vw_architecture_drift view columns (snake_case).
 */
export interface DriftDbRow {
  readonly component: string;
  readonly repository: string;
  readonly cross_component_commits: number | string;
  readonly total_commits: number | string;
  readonly drift_percentage: number | string;
  readonly total_churn: number | string;
  readonly avg_components_per_commit: number | string;
  readonly critical_count: number | string;
  readonly high_count: number | string;
  readonly medium_count: number | string;
  readonly low_count: number | string;
  readonly unique_authors: number | string;
  readonly unique_teams: number | string;
  readonly first_drift_date: Date | string | null;
  readonly last_drift_date: Date | string | null;
  readonly heat_intensity: number | string;
}

/**
 * TypeScript interface for weekly drift row from database.
 * Maps 1:1 to vw_architecture_drift_weekly view columns (snake_case).
 */
export interface WeeklyDriftDbRow {
  readonly week: Date | string;
  readonly component: string;
  readonly repository: string;
  readonly cross_component_commits: number | string;
  readonly total_commits: number | string;
  readonly drift_percentage: number | string;
  readonly weekly_churn: number | string;
  readonly avg_components: number | string;
  readonly critical_count: number | string;
  readonly high_count: number | string;
  readonly medium_count: number | string;
  readonly low_count: number | string;
  readonly unique_authors: number | string;
  readonly heat_intensity: number | string;
}

/**
 * TypeScript interface for component pair coupling row from database.
 * Maps 1:1 to vw_component_pair_coupling view columns (snake_case).
 */
export interface PairCouplingDbRow {
  readonly component_a: string;
  readonly component_b: string;
  readonly repository: string;
  readonly coupling_count: number | string;
  readonly unique_commits: number | string;
  readonly unique_authors: number | string;
  readonly unique_teams: number | string;
  readonly critical_count: number | string;
  readonly high_count: number | string;
  readonly first_coupling_date: Date | string | null;
  readonly last_coupling_date: Date | string | null;
  readonly coupling_strength: number | string;
}

/**
 * TypeScript interface for drift summary row.
 */
export interface DriftSummaryDbRow {
  readonly total_cross_component_commits: number | string;
  readonly total_components: number | string;
  readonly avg_drift_percentage: number | string | null;
  readonly max_heat_intensity: number | string | null;
  readonly highest_drift_component: string | null;
  readonly total_critical: number | string;
  readonly total_high: number | string;
  readonly total_medium: number | string;
  readonly total_low: number | string;
}

/**
 * TypeScript interface for unique component row.
 */
export interface UniqueComponentDbRow {
  readonly component: string;
}

/**
 * TypeScript interface for unique repository row.
 */
export interface UniqueRepositoryDbRow {
  readonly repository: string;
}
