/**
 * TypeScript interfaces for the Architecture Drift Heat Map Dashboard data shapes.
 * Defines the data model for tracking cross-component architecture violations
 * through heat map visualization.
 *
 * The Architecture Drift Heat Map helps engineering architects understand:
 *   - Which commits touch multiple architecture components?
 *   - Where are cross-component dependencies emerging?
 *   - Which components have the highest drift intensity?
 *   - How is architectural coupling evolving over time?
 *
 * Ticket: IQS-917
 */

// ============================================================================
// Drift Severity Types
// ============================================================================

/**
 * Drift severity levels based on number of components touched.
 * Based on component count thresholds:
 *   - critical: >= 5 components (major architectural concern)
 *   - high: >= 4 components (significant coupling)
 *   - medium: >= 3 components (moderate coupling)
 *   - low: >= 2 components (minor coupling)
 *   - none: 1 component (no cross-component change)
 */
export type DriftSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none';

// ============================================================================
// Component Change Data Point
// ============================================================================

/**
 * A single component change record from vw_component_changes.
 * Maps a commit to its touched architecture component.
 */
export interface ComponentChange {
  /** Commit SHA identifier */
  readonly sha: string;
  /** Commit date as ISO date string */
  readonly commitDate: string;
  /** Git author login/username */
  readonly author: string;
  /** Repository name */
  readonly repository: string;
  /** Git branch name */
  readonly branch: string;
  /** Commit message */
  readonly commitMessage: string;
  /** Total files changed in commit */
  readonly fileCount: number;
  /** Total lines added in commit */
  readonly linesAdded: number;
  /** Total lines removed in commit */
  readonly linesRemoved: number;
  /** Architecture component this change affects */
  readonly arcComponent: string;
  /** Files changed in this component */
  readonly componentFileCount: number;
  /** Lines added in this component */
  readonly componentLinesAdded: number;
  /** Lines removed in this component */
  readonly componentLinesRemoved: number;
  /** Author's full name (from commit_contributors) */
  readonly fullName: string | null;
  /** Author's team (from commit_contributors) */
  readonly team: string | null;
}

// ============================================================================
// Cross-Component Commit Data Point
// ============================================================================

/**
 * A commit that touches 2+ architecture components.
 * Sourced from vw_cross_component_commits view.
 */
export interface CrossComponentCommit {
  /** Commit SHA identifier */
  readonly sha: string;
  /** Commit date as ISO date string */
  readonly commitDate: string;
  /** Git author login/username */
  readonly author: string;
  /** Repository name */
  readonly repository: string;
  /** Git branch name */
  readonly branch: string;
  /** Commit message */
  readonly commitMessage: string;
  /** Total files changed */
  readonly fileCount: number;
  /** Total lines added */
  readonly linesAdded: number;
  /** Total lines removed */
  readonly linesRemoved: number;
  /** Author's full name */
  readonly fullName: string | null;
  /** Author's team */
  readonly team: string | null;
  /** Number of components touched */
  readonly componentCount: number;
  /** Array of component names touched */
  readonly componentsTouched: readonly string[];
  /** Total files changed across all components */
  readonly totalFilesChanged: number;
  /** Total lines added across all components */
  readonly totalLinesAdded: number;
  /** Total lines removed across all components */
  readonly totalLinesRemoved: number;
  /** Drift severity level */
  readonly driftSeverity: DriftSeverity;
  /** Drift score (0-100) */
  readonly driftScore: number;
}

// ============================================================================
// Architecture Drift Summary
// ============================================================================

/**
 * Component-level drift metrics from vw_architecture_drift.
 * Used for heat map visualization.
 */
export interface ArchitectureDrift {
  /** Architecture component name */
  readonly component: string;
  /** Repository name */
  readonly repository: string;
  /** Number of cross-component commits involving this component */
  readonly crossComponentCommits: number;
  /** Total commits touching this component */
  readonly totalCommits: number;
  /** Percentage of commits that are cross-component */
  readonly driftPercentage: number;
  /** Total lines of code churn in cross-component commits */
  readonly totalChurn: number;
  /** Average components per cross-component commit */
  readonly avgComponentsPerCommit: number;
  /** Number of critical severity commits */
  readonly criticalCount: number;
  /** Number of high severity commits */
  readonly highCount: number;
  /** Number of medium severity commits */
  readonly mediumCount: number;
  /** Number of low severity commits */
  readonly lowCount: number;
  /** Unique authors involved in drift */
  readonly uniqueAuthors: number;
  /** Unique teams involved in drift */
  readonly uniqueTeams: number;
  /** First drift occurrence date */
  readonly firstDriftDate: string | null;
  /** Most recent drift occurrence date */
  readonly lastDriftDate: string | null;
  /** Heat map intensity (0-100) */
  readonly heatIntensity: number;
}

// ============================================================================
// Weekly Drift Trend
// ============================================================================

/**
 * Weekly drift data point for time series visualization.
 * Sourced from vw_architecture_drift_weekly view.
 */
export interface WeeklyDriftTrend {
  /** Week start date as ISO date string */
  readonly week: string;
  /** Architecture component name */
  readonly component: string;
  /** Repository name */
  readonly repository: string;
  /** Cross-component commits this week */
  readonly crossComponentCommits: number;
  /** Total commits this week */
  readonly totalCommits: number;
  /** Drift percentage this week */
  readonly driftPercentage: number;
  /** Code churn this week */
  readonly weeklyChurn: number;
  /** Average components per commit */
  readonly avgComponents: number;
  /** Critical severity count */
  readonly criticalCount: number;
  /** High severity count */
  readonly highCount: number;
  /** Medium severity count */
  readonly mediumCount: number;
  /** Low severity count */
  readonly lowCount: number;
  /** Unique authors this week */
  readonly uniqueAuthors: number;
  /** Heat intensity (0-100) */
  readonly heatIntensity: number;
}

// ============================================================================
// Component Pair Coupling
// ============================================================================

/**
 * Coupling between two components from vw_component_pair_coupling.
 * Shows which component pairs frequently change together.
 */
export interface ComponentPairCoupling {
  /** First component (alphabetically ordered) */
  readonly componentA: string;
  /** Second component (alphabetically ordered) */
  readonly componentB: string;
  /** Repository name */
  readonly repository: string;
  /** Number of times these components changed together */
  readonly couplingCount: number;
  /** Unique commits with this coupling */
  readonly uniqueCommits: number;
  /** Unique authors creating this coupling */
  readonly uniqueAuthors: number;
  /** Unique teams creating this coupling */
  readonly uniqueTeams: number;
  /** Critical severity count */
  readonly criticalCount: number;
  /** High severity count */
  readonly highCount: number;
  /** First coupling occurrence */
  readonly firstCouplingDate: string | null;
  /** Last coupling occurrence */
  readonly lastCouplingDate: string | null;
  /** Coupling strength score */
  readonly couplingStrength: number;
}

// ============================================================================
// Heat Map Matrix Types
// ============================================================================

/**
 * Heat map cell data for component x week matrix.
 */
export interface HeatMapCell {
  /** Component name (row) */
  readonly component: string;
  /** Week date (column) */
  readonly week: string;
  /** Heat intensity value (0-100) */
  readonly intensity: number;
  /** Cross-component commit count */
  readonly commitCount: number;
}

/**
 * Complete heat map data structure.
 */
export interface HeatMapData {
  /** List of unique components (rows) */
  readonly components: readonly string[];
  /** List of weeks (columns) */
  readonly weeks: readonly string[];
  /** Matrix of heat map cells */
  readonly cells: readonly HeatMapCell[];
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Architecture Drift dashboard.
 */
export interface ArchitectureDriftData {
  /** Component-level drift data */
  readonly driftData: readonly ArchitectureDrift[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_architecture_drift view exists */
  readonly viewExists: boolean;
}

/**
 * Response for cross-component commits data.
 */
export interface CrossComponentCommitData {
  /** Cross-component commits */
  readonly commits: readonly CrossComponentCommit[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the view exists */
  readonly viewExists: boolean;
}

/**
 * Response for weekly trend data.
 */
export interface WeeklyDriftTrendData {
  /** Weekly trend data points */
  readonly trends: readonly WeeklyDriftTrend[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the view exists */
  readonly viewExists: boolean;
}

/**
 * Response for component pair coupling data.
 */
export interface ComponentPairCouplingData {
  /** Component pair coupling data */
  readonly couplings: readonly ComponentPairCoupling[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the view exists */
  readonly viewExists: boolean;
}

/**
 * Complete chart data for heat map visualization.
 */
export interface DriftHeatMapChartData {
  /** Component-level drift summary */
  readonly driftData: readonly ArchitectureDrift[];
  /** Heat map matrix data */
  readonly heatMapData: HeatMapData;
  /** Component pair coupling data */
  readonly couplingData: readonly ComponentPairCoupling[];
  /** Summary statistics */
  readonly summary: DriftSummary;
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the views exist */
  readonly viewExists: boolean;
}

// ============================================================================
// Summary Types
// ============================================================================

/**
 * Summary statistics for architecture drift analysis.
 */
export interface DriftSummary {
  /** Total cross-component commits */
  readonly totalCrossComponentCommits: number;
  /** Total unique components with drift */
  readonly totalComponents: number;
  /** Average drift percentage across components */
  readonly avgDriftPercentage: number;
  /** Component with highest drift */
  readonly highestDriftComponent: string | null;
  /** Maximum heat intensity */
  readonly maxHeatIntensity: number;
  /** Total critical severity commits */
  readonly totalCritical: number;
  /** Total high severity commits */
  readonly totalHigh: number;
  /** Total medium severity commits */
  readonly totalMedium: number;
  /** Total low severity commits */
  readonly totalLow: number;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for Architecture Drift queries.
 * All filters are optional and combined with AND logic.
 */
export interface ArchitectureDriftFilters {
  /** Start date for date range filter (ISO date string YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string YYYY-MM-DD) */
  readonly endDate?: string;
  /** Filter by repository name */
  readonly repository?: string;
  /** Filter by component name */
  readonly component?: string;
  /** Filter by drift severity */
  readonly severity?: DriftSeverity;
  /** Minimum heat intensity threshold (0-100) */
  readonly minHeatIntensity?: number;
  /** Filter by author */
  readonly author?: string;
  /** Filter by team name */
  readonly team?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum allowed length for string filter values (DoS prevention).
 * CWE-20: Improper Input Validation
 */
export const DRIFT_MAX_FILTER_LENGTH = 200;

/**
 * Maximum number of drift result rows returned to prevent memory exhaustion.
 */
export const DRIFT_MAX_RESULT_ROWS = 500;

/**
 * Maximum number of cross-component commit rows returned.
 */
export const DRIFT_MAX_COMMIT_ROWS = 500;

/**
 * Maximum number of weekly trend rows returned.
 */
export const DRIFT_MAX_WEEKLY_ROWS = 200;

/**
 * Maximum number of component pair coupling rows returned.
 */
export const DRIFT_MAX_COUPLING_ROWS = 100;

/**
 * Valid drift severity values for input validation.
 */
export const VALID_DRIFT_SEVERITIES: readonly DriftSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'none',
];

/**
 * Drift severity thresholds (number of components).
 */
export const DRIFT_SEVERITY_THRESHOLDS = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
} as const;

/**
 * Heat intensity thresholds for categorization.
 */
export const HEAT_INTENSITY_THRESHOLDS = {
  HIGH: 70,    // >= 70 is high intensity
  MEDIUM: 40,  // >= 40 is medium intensity
  LOW: 10,     // >= 10 is low intensity
} as const;
