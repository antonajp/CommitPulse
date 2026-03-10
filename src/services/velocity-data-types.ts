/**
 * TypeScript interfaces for the Sprint Velocity vs LOC chart data shapes.
 * Defines the data model for the dual-axis line chart comparing
 * weekly story points completed against weekly lines of code committed.
 *
 * Ticket: IQS-888
 */

// ============================================================================
// Sprint Velocity vs LOC Data Point
// ============================================================================

/**
 * A single data point representing one week of sprint velocity and LOC metrics.
 * Aggregated by ISO week (Monday start) from the vw_sprint_velocity_vs_loc view.
 */
export interface SprintVelocityVsLocPoint {
  /** ISO week start date (Monday) as YYYY-MM-DD string */
  readonly weekStart: string;
  /** Team name from linear_detail (null if only LOC data for this week) */
  readonly team: string | null;
  /** Project name from linear_detail */
  readonly project: string | null;
  /** Repository name from commit_history */
  readonly repository: string | null;
  /** Total story points completed this week (0 if no linked issues) */
  readonly totalStoryPoints: number;
  /** Count of distinct issues completed this week */
  readonly issueCount: number;
  /** Total lines of code changed this week (inserts + deletes) */
  readonly totalLocChanged: number;
  /** Total lines inserted this week */
  readonly totalLinesAdded: number;
  /** Total lines deleted this week */
  readonly totalLinesDeleted: number;
  /** Count of distinct commits this week */
  readonly commitCount: number;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Sprint Velocity vs LOC chart.
 * Contains the weekly data points plus metadata for the chart UI.
 */
export interface VelocityChartData {
  /** Array of weekly velocity/LOC data points, ordered by week descending */
  readonly rows: readonly SprintVelocityVsLocPoint[];
  /** Whether any data was found */
  readonly hasData: boolean;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for the velocity chart queries.
 * All filters are optional and combined with AND logic.
 */
export interface VelocityFilters {
  /** Start date for date range filter (ISO date string YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string YYYY-MM-DD) */
  readonly endDate?: string;
  /** Filter by team name */
  readonly team?: string;
  /** Filter by repository name (IQS-920) */
  readonly repository?: string;
}
