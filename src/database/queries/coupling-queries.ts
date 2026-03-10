/**
 * Parameterized SQL queries for the Cross-Team Coupling Dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against the vw_contributor_team, vw_file_team_ownership,
 * vw_team_coupling, and vw_team_shared_files views created by migration
 * 017_team_coupling.sql.
 *
 * The views calculate:
 *   1. Team assignment from contributor mappings
 *   2. File ownership by team
 *   3. Cross-team coupling strength
 *   4. Shared file details for drill-down
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-909
 */

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Applied as LIMIT in each query.
 */
export const COUPLING_QUERY_MAX_ROWS = 1000;

// ============================================================================
// View Existence Checks
// ============================================================================

/**
 * Query to check if the vw_team_coupling view exists.
 * Used for graceful degradation if migration 017 has not been applied.
 */
export const QUERY_COUPLING_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_team_coupling'
  ) AS view_exists
`;

/**
 * Query to check if the vw_team_shared_files view exists.
 * Used for graceful degradation if migration 017 has not been applied.
 */
export const QUERY_SHARED_FILES_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_team_shared_files'
  ) AS view_exists
`;

/**
 * Query to check if the vw_contributor_team view exists.
 */
export const QUERY_CONTRIBUTOR_TEAM_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_contributor_team'
  ) AS view_exists
`;

// ============================================================================
// Team Coupling Matrix Queries
// ============================================================================

/**
 * Query to fetch all team coupling rows from the view.
 * Returns couplings ordered by shared_file_count descending.
 * Limited to COUPLING_QUERY_MAX_ROWS for safety.
 */
export const QUERY_COUPLING_ALL = `
  SELECT
    team_a,
    team_b,
    shared_file_count,
    total_shared_commits,
    coupling_strength,
    hotspot_files
  FROM vw_team_coupling
  ORDER BY shared_file_count DESC, coupling_strength DESC
  LIMIT ${COUPLING_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch coupling rows with minimum strength filter.
 * Parameters:
 *   $1 - min_coupling_strength (NUMERIC) - minimum coupling strength
 */
export const QUERY_COUPLING_BY_MIN_STRENGTH = `
  SELECT
    team_a,
    team_b,
    shared_file_count,
    total_shared_commits,
    coupling_strength,
    hotspot_files
  FROM vw_team_coupling
  WHERE coupling_strength >= $1
  ORDER BY shared_file_count DESC, coupling_strength DESC
  LIMIT ${COUPLING_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch coupling rows for a specific team.
 * Parameters:
 *   $1 - team_name (TEXT) - team to filter by
 */
export const QUERY_COUPLING_BY_TEAM = `
  SELECT
    team_a,
    team_b,
    shared_file_count,
    total_shared_commits,
    coupling_strength,
    hotspot_files
  FROM vw_team_coupling
  WHERE LOWER(team_a) = LOWER($1) OR LOWER(team_b) = LOWER($1)
  ORDER BY shared_file_count DESC, coupling_strength DESC
  LIMIT ${COUPLING_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch coupling between two specific teams.
 * Parameters:
 *   $1 - team_a (TEXT) - first team
 *   $2 - team_b (TEXT) - second team
 */
export const QUERY_COUPLING_BY_TEAM_PAIR = `
  SELECT
    team_a,
    team_b,
    shared_file_count,
    total_shared_commits,
    coupling_strength,
    hotspot_files
  FROM vw_team_coupling
  WHERE (LOWER(team_a) = LOWER($1) AND LOWER(team_b) = LOWER($2))
     OR (LOWER(team_a) = LOWER($2) AND LOWER(team_b) = LOWER($1))
  ORDER BY shared_file_count DESC
  LIMIT ${COUPLING_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch coupling rows with combined filters.
 * NULL values are treated as "no filter" via COALESCE/OR patterns.
 *
 * Parameters:
 *   $1 - team_a (TEXT) - team A filter (nullable)
 *   $2 - team_b (TEXT) - team B filter (nullable)
 *   $3 - min_coupling_strength (NUMERIC) - minimum strength (nullable)
 */
export const QUERY_COUPLING_COMBINED = `
  SELECT
    team_a,
    team_b,
    shared_file_count,
    total_shared_commits,
    coupling_strength,
    hotspot_files
  FROM vw_team_coupling
  WHERE ($1 IS NULL OR LOWER(team_a) = LOWER($1) OR LOWER(team_b) = LOWER($1))
    AND ($2 IS NULL OR LOWER(team_a) = LOWER($2) OR LOWER(team_b) = LOWER($2))
    AND ($3 IS NULL OR coupling_strength >= $3)
  ORDER BY shared_file_count DESC, coupling_strength DESC
  LIMIT ${COUPLING_QUERY_MAX_ROWS}
`;

// ============================================================================
// Shared File Detail Queries
// ============================================================================

/**
 * Query to fetch all shared files between teams.
 * Returns files ordered by total_commits descending.
 */
export const QUERY_SHARED_FILES_ALL = `
  SELECT
    file_path,
    repository,
    team_a,
    team_b,
    team_a_commits,
    team_b_commits,
    team_a_contributors,
    team_b_contributors,
    last_modified,
    total_commits
  FROM vw_team_shared_files
  ORDER BY total_commits DESC
  LIMIT ${COUPLING_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch shared files between a specific team pair.
 * Parameters:
 *   $1 - team_a (TEXT) - first team
 *   $2 - team_b (TEXT) - second team
 */
export const QUERY_SHARED_FILES_BY_TEAM_PAIR = `
  SELECT
    file_path,
    repository,
    team_a,
    team_b,
    team_a_commits,
    team_b_commits,
    team_a_contributors,
    team_b_contributors,
    last_modified,
    total_commits
  FROM vw_team_shared_files
  WHERE (LOWER(team_a) = LOWER($1) AND LOWER(team_b) = LOWER($2))
     OR (LOWER(team_a) = LOWER($2) AND LOWER(team_b) = LOWER($1))
  ORDER BY total_commits DESC
  LIMIT ${COUPLING_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch shared files for a single team (with any other team).
 * Parameters:
 *   $1 - team_name (TEXT) - team to filter by
 */
export const QUERY_SHARED_FILES_BY_TEAM = `
  SELECT
    file_path,
    repository,
    team_a,
    team_b,
    team_a_commits,
    team_b_commits,
    team_a_contributors,
    team_b_contributors,
    last_modified,
    total_commits
  FROM vw_team_shared_files
  WHERE LOWER(team_a) = LOWER($1) OR LOWER(team_b) = LOWER($1)
  ORDER BY total_commits DESC
  LIMIT ${COUPLING_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch shared files by repository.
 * Parameters:
 *   $1 - repository (TEXT) - repository to filter by
 */
export const QUERY_SHARED_FILES_BY_REPOSITORY = `
  SELECT
    file_path,
    repository,
    team_a,
    team_b,
    team_a_commits,
    team_b_commits,
    team_a_contributors,
    team_b_contributors,
    last_modified,
    total_commits
  FROM vw_team_shared_files
  WHERE LOWER(repository) = LOWER($1)
  ORDER BY total_commits DESC
  LIMIT ${COUPLING_QUERY_MAX_ROWS}
`;

// ============================================================================
// Summary and Statistics Queries
// ============================================================================

/**
 * Query to get coupling summary statistics.
 * Returns aggregate metrics for the coupling matrix.
 */
export const QUERY_COUPLING_SUMMARY = `
  WITH coupling_stats AS (
    SELECT
      COUNT(*) AS total_team_pairs,
      SUM(shared_file_count) AS total_shared_files,
      ROUND(AVG(coupling_strength)::NUMERIC, 2) AS avg_coupling_strength,
      MAX(coupling_strength) AS max_coupling_strength
    FROM vw_team_coupling
  ),
  highest_coupling AS (
    SELECT team_a, team_b, coupling_strength
    FROM vw_team_coupling
    ORDER BY coupling_strength DESC
    LIMIT 1
  ),
  unique_teams AS (
    SELECT COUNT(DISTINCT team) AS unique_team_count
    FROM (
      SELECT team_a AS team FROM vw_team_coupling
      UNION
      SELECT team_b AS team FROM vw_team_coupling
    ) teams
  )
  SELECT
    cs.total_team_pairs,
    cs.total_shared_files,
    cs.avg_coupling_strength,
    cs.max_coupling_strength,
    hc.team_a AS highest_coupling_team_a,
    hc.team_b AS highest_coupling_team_b,
    hc.coupling_strength AS highest_coupling_strength,
    ut.unique_team_count
  FROM coupling_stats cs
  CROSS JOIN highest_coupling hc
  CROSS JOIN unique_teams ut
`;

/**
 * Query to get list of unique teams in coupling data.
 * Used for filter dropdowns.
 */
export const QUERY_UNIQUE_TEAMS = `
  SELECT DISTINCT team FROM (
    SELECT team_a AS team FROM vw_team_coupling
    UNION
    SELECT team_b AS team FROM vw_team_coupling
  ) teams
  ORDER BY team
`;

/**
 * Query to get list of unique repositories in shared files.
 * Used for filter dropdowns.
 */
export const QUERY_UNIQUE_REPOSITORIES = `
  SELECT DISTINCT repository
  FROM vw_team_shared_files
  ORDER BY repository
`;

// ============================================================================
// Database Row Types
// ============================================================================

/**
 * TypeScript interface for coupling row from database.
 * Maps 1:1 to vw_team_coupling view columns (snake_case).
 */
export interface CouplingDbRow {
  readonly team_a: string;
  readonly team_b: string;
  readonly shared_file_count: number | string;
  readonly total_shared_commits: number | string;
  readonly coupling_strength: number | string;
  readonly hotspot_files: string[] | null;
}

/**
 * TypeScript interface for shared file row from database.
 * Maps 1:1 to vw_team_shared_files view columns (snake_case).
 */
export interface SharedFileDbRow {
  readonly file_path: string;
  readonly repository: string;
  readonly team_a: string;
  readonly team_b: string;
  readonly team_a_commits: number | string;
  readonly team_b_commits: number | string;
  readonly team_a_contributors: number | string;
  readonly team_b_contributors: number | string;
  readonly last_modified: Date | string;
  readonly total_commits: number | string;
}

/**
 * TypeScript interface for coupling summary row.
 */
export interface CouplingSummaryDbRow {
  readonly total_team_pairs: number | string;
  readonly total_shared_files: number | string;
  readonly avg_coupling_strength: number | string | null;
  readonly max_coupling_strength: number | string | null;
  readonly highest_coupling_team_a: string | null;
  readonly highest_coupling_team_b: string | null;
  readonly highest_coupling_strength: number | string | null;
  readonly unique_team_count: number | string;
}

/**
 * TypeScript interface for unique team row.
 */
export interface UniqueTeamDbRow {
  readonly team: string;
}

/**
 * TypeScript interface for unique repository row.
 */
export interface UniqueRepositoryDbRow {
  readonly repository: string;
}
