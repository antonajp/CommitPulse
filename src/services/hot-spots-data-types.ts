/**
 * TypeScript interfaces for the Hot Spots dashboard data shapes.
 * Defines the data model for file-level risk metrics including
 * churn count, complexity, and bug correlation.
 *
 * The Hot Spots dashboard helps engineering teams identify which files
 * are most likely to introduce bugs and should be prioritized for refactoring.
 *
 * Ticket: IQS-901
 */

// ============================================================================
// Hot Spot Data Point
// ============================================================================

/**
 * A single file with its hot spot risk metrics.
 * Sourced from the vw_hot_spots database view.
 */
export interface HotSpotRow {
  /** File path relative to repository root */
  readonly filePath: string;
  /** Repository name */
  readonly repository: string;
  /** Number of distinct commits modifying this file in time window */
  readonly churnCount: number;
  /** Timestamp of most recent change as ISO date string */
  readonly lastChanged: string;
  /** Number of distinct authors modifying this file */
  readonly contributorCount: number;
  /** Current cyclomatic complexity (most recent value) */
  readonly complexity: number;
  /** Current lines of code (most recent value) */
  readonly loc: number;
  /** Count of bug tickets associated with this file */
  readonly bugCount: number;
  /** Normalized risk score (0-1 range, higher = more risk) */
  readonly riskScore: number;
  /** Risk tier: critical, high, medium, low */
  readonly riskTier: RiskTier;
}

/**
 * Risk tier categories for hot spots.
 */
export type RiskTier = 'critical' | 'high' | 'medium' | 'low';

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Hot Spots dashboard.
 * Contains hot spot data plus metadata for the dashboard UI.
 */
export interface HotSpotsChartData {
  /** Array of hot spot data points, ordered by risk score descending */
  readonly rows: readonly HotSpotRow[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_hot_spots view exists */
  readonly viewExists: boolean;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for Hot Spots queries.
 * All filters are optional and combined with AND logic.
 */
export interface HotSpotsFilters {
  /** Start date for date range filter (ISO date string YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string YYYY-MM-DD) */
  readonly endDate?: string;
  /** Filter by repository name */
  readonly repository?: string;
  /** Filter by risk tier (critical, high, medium, low) */
  readonly riskTier?: RiskTier;
  /** Minimum churn count threshold */
  readonly minChurn?: number;
  /** Minimum complexity threshold */
  readonly minComplexity?: number;
}

/**
 * Maximum allowed length for string filter values (DoS prevention).
 * CWE-20: Improper Input Validation
 */
export const HOT_SPOTS_MAX_FILTER_LENGTH = 200;

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Matches the acceptance criteria limit of 200 files.
 */
export const HOT_SPOTS_MAX_RESULT_ROWS = 200;

/**
 * Default time window in days for churn calculation.
 * Defaults to 90 days per ticket requirements.
 */
export const HOT_SPOTS_DEFAULT_TIME_WINDOW_DAYS = 90;
