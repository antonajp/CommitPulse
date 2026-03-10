/**
 * TypeScript interfaces for the Cross-Team Coupling Dashboard data shapes.
 * Defines the data model for team coupling analysis and shared file detection.
 *
 * The Cross-Team Coupling dashboard helps engineering architects understand:
 * - Which teams are architecturally entangled through shared code?
 * - What files are being modified by multiple teams?
 * - Where are potential ownership boundaries being crossed?
 * - Which areas need architectural attention or ownership clarification?
 *
 * Ticket: IQS-909
 */

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for coupling queries.
 * All filters are optional and combined with AND logic.
 */
export interface CouplingFilters {
  /** Start date for commit_date filter (ISO date string) */
  readonly startDate?: string;
  /** End date for commit_date filter (ISO date string) */
  readonly endDate?: string;
  /** Filter by specific team A */
  readonly teamA?: string;
  /** Filter by specific team B */
  readonly teamB?: string;
  /** Minimum coupling strength (0-100) to include */
  readonly minCouplingStrength?: number;
  /** Filter by repository */
  readonly repository?: string;
}

// ============================================================================
// Coupling Matrix Types
// ============================================================================

/**
 * Team coupling row from vw_team_coupling view.
 * Represents the coupling relationship between two teams.
 */
export interface TeamCouplingRow {
  /** First team in the pair (alphabetically ordered) */
  readonly teamA: string;
  /** Second team in the pair (alphabetically ordered) */
  readonly teamB: string;
  /** Number of files modified by both teams */
  readonly sharedFileCount: number;
  /** Total commits by both teams on shared files */
  readonly totalSharedCommits: number;
  /** Coupling strength percentage (0-100) */
  readonly couplingStrength: number;
  /** Most frequently co-modified files (hotspots) */
  readonly hotspotFiles: readonly string[];
}

/**
 * Chord diagram data structure for D3/Chart.js visualization.
 * Represents the coupling matrix in a format suitable for chord diagrams.
 */
export interface ChordData {
  /** Array of team names (matrix indices) */
  readonly teams: readonly string[];
  /** Symmetric matrix of coupling strengths [teamI][teamJ] */
  readonly matrix: readonly (readonly number[])[];
}

// ============================================================================
// Shared File Detail Types
// ============================================================================

/**
 * Detailed shared file information from vw_team_shared_files view.
 * Used for drill-down analysis of specific team pair coupling.
 */
export interface SharedFileDetail {
  /** Full file path */
  readonly filePath: string;
  /** Repository name */
  readonly repository: string;
  /** Number of commits by team A on this file */
  readonly teamACommits: number;
  /** Number of commits by team B on this file */
  readonly teamBCommits: number;
  /** Number of contributors from team A */
  readonly teamAContributors: number;
  /** Number of contributors from team B */
  readonly teamBContributors: number;
  /** Last modification date (ISO string) */
  readonly lastModified: string;
  /** Total commits by both teams */
  readonly totalCommits: number;
}

// ============================================================================
// Contributor Team Types
// ============================================================================

/**
 * Contributor team assignment from vw_contributor_team view.
 */
export interface ContributorTeam {
  /** Contributor login/identifier */
  readonly contributor: string;
  /** Resolved team name */
  readonly teamName: string;
}

// ============================================================================
// File Ownership Types
// ============================================================================

/**
 * File ownership record from vw_file_team_ownership view.
 */
export interface FileTeamOwnership {
  /** Full file path */
  readonly filePath: string;
  /** Repository name */
  readonly repository: string;
  /** Team name */
  readonly teamName: string;
  /** Number of commits by this team */
  readonly commitCount: number;
  /** Number of contributors from this team */
  readonly contributorCount: number;
  /** Last modification date (ISO string) */
  readonly lastModified: string;
}

// ============================================================================
// Summary Types
// ============================================================================

/**
 * Summary statistics for team coupling analysis.
 */
export interface CouplingMatrixSummary {
  /** Total number of team pairs with coupling */
  readonly totalTeamPairs: number;
  /** Total number of shared files across all pairs */
  readonly totalSharedFiles: number;
  /** Average coupling strength across all pairs */
  readonly avgCouplingStrength: number;
  /** Maximum coupling strength */
  readonly maxCouplingStrength: number;
  /** Team pair with highest coupling */
  readonly highestCouplingPair: {
    readonly teamA: string;
    readonly teamB: string;
    readonly strength: number;
  } | null;
  /** Total number of unique teams */
  readonly uniqueTeams: number;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Cross-Team Coupling dashboard.
 * Contains coupling data plus metadata for the dashboard UI.
 */
export interface CouplingChartData {
  /** Team coupling rows */
  readonly couplingData: readonly TeamCouplingRow[];
  /** Chord diagram data */
  readonly chordData: ChordData;
  /** Summary statistics */
  readonly summary: CouplingMatrixSummary;
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the views exist in the database */
  readonly viewExists: boolean;
}

/**
 * Response with shared file detail data for drill-down.
 */
export interface SharedFilesChartData {
  /** Team A name */
  readonly teamA: string;
  /** Team B name */
  readonly teamB: string;
  /** Shared file details */
  readonly sharedFiles: readonly SharedFileDetail[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the view exists in the database */
  readonly viewExists: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum allowed length for string filter values (DoS prevention).
 * CWE-20: Improper Input Validation
 */
export const COUPLING_MAX_FILTER_LENGTH = 200;

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Matches similar limits in other dashboards.
 */
export const COUPLING_MAX_RESULT_ROWS = 1000;

/**
 * Default minimum coupling strength threshold for filtering.
 */
export const COUPLING_DEFAULT_MIN_STRENGTH = 0;

/**
 * Coupling strength thresholds for category assignment.
 */
export const COUPLING_THRESHOLDS = {
  HIGH: 50,      // >= 50% overlap is high coupling
  MEDIUM: 20,    // >= 20% overlap is medium coupling
  LOW: 5,        // >= 5% overlap is low coupling
} as const;

/**
 * Default number of days to look back for coupling analysis.
 */
export const COUPLING_DEFAULT_DAYS = 90;
