/**
 * TypeScript interfaces for the Sprint Velocity vs LOC chart data shapes.
 * Defines the data model for the dual-axis line chart comparing
 * weekly story points completed against weekly lines of code committed.
 *
 * Ticket: IQS-888, IQS-944, GITX-121
 */

// ============================================================================
// Sprint Velocity vs LOC Data Point
// ============================================================================

/**
 * Aggregation period for velocity data.
 * - 'day': Daily aggregation
 * - 'week': Weekly aggregation (ISO week, Monday start) - default
 * - 'biweekly': Bi-weekly aggregation (2-week periods)
 *
 * Ticket: IQS-944
 */
export type VelocityAggregation = 'day' | 'week' | 'biweekly';

/**
 * A single data point representing one period of sprint velocity and LOC metrics.
 * Aggregated by the specified period from the vw_sprint_velocity_vs_loc view.
 *
 * IQS-944: Now includes separate human and AI story point columns for comparison.
 */
export interface SprintVelocityVsLocPoint {
  /** Period start date as YYYY-MM-DD string (day, week Monday, or biweekly start) */
  readonly weekStart: string;
  /** Team name from linear_detail (null if only LOC data for this period) */
  readonly team: string | null;
  /** Project name from linear_detail */
  readonly project: string | null;
  /** Repository name from commit_history */
  readonly repository: string | null;
  /**
   * Total story points completed this period (0 if no linked issues).
   * This is the combined total using COALESCE(calculated, human) for backward compatibility.
   */
  readonly totalStoryPoints: number;
  /**
   * Human-assigned story points (from jira_detail.points).
   * NULL/0 for Linear issues which don't have manual estimates.
   * Ticket: IQS-944
   */
  readonly humanStoryPoints: number;
  /**
   * AI-calculated story points (from calculated_story_points column).
   * Derived from issue duration using Fibonacci mapping.
   * Ticket: IQS-944
   */
  readonly aiStoryPoints: number;
  /** Count of distinct issues completed this period */
  readonly issueCount: number;
  /** Total lines of code changed this period (inserts + deletes) */
  readonly totalLocChanged: number;
  /** Total lines inserted this period */
  readonly totalLinesAdded: number;
  /** Total lines deleted this period */
  readonly totalLinesDeleted: number;
  /** Count of distinct commits this period */
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
  /**
   * Filter by team member (contributor login).
   * Ticket: GITX-121
   */
  readonly teamMember?: string;
  /** Filter by repository name (IQS-920) */
  readonly repository?: string;
  /**
   * Aggregation period: 'day', 'week' (default), or 'biweekly'.
   * NOTE: This is a client-side aggregation hint. The database view always
   * returns weekly data, and the webview aggregates client-side based on this setting.
   * Ticket: IQS-944
   */
  readonly aggregation?: VelocityAggregation;
}

/**
 * Filter options for the velocity chart dropdowns.
 * Contains distinct values for team, team member, and repository filters.
 * Ticket: GITX-121
 */
export interface VelocityFilterOptions {
  /** Distinct team names from commit_contributors */
  readonly teams: readonly string[];
  /** Distinct contributor logins from commit_contributors */
  readonly teamMembers: readonly string[];
  /** Distinct repository names from commit_history */
  readonly repositories: readonly string[];
}
