/**
 * TypeScript interfaces for the Story Points Trend chart data shapes.
 * Defines the data model for the dual-line chart comparing
 * story points in Development vs QA status over time.
 *
 * Ticket: IQS-940
 */

// ============================================================================
// Story Points Trend Data Point
// ============================================================================

/**
 * A single data point representing one day of story points distribution.
 * Shows how many story points are in Development vs QA statuses.
 */
export interface StoryPointsTrendPoint {
  /** Date as YYYY-MM-DD string */
  readonly transitionDate: string;
  /** Status category: 'Development' or 'QA' */
  readonly statusCategory: string;
  /** Total story points in this status category on this date */
  readonly totalStoryPoints: number;
  /** Count of distinct tickets in this status category */
  readonly ticketCount: number;
}

/**
 * Aggregated data point for chart rendering.
 * Combines Development and QA values for a single date.
 */
export interface StoryPointsTrendAggregated {
  /** Date as YYYY-MM-DD string */
  readonly date: string;
  /** Story points in Development status */
  readonly developmentPoints: number;
  /** Story points in QA status */
  readonly qaPoints: number;
  /** Ticket count in Development status */
  readonly developmentTickets: number;
  /** Ticket count in QA status */
  readonly qaTickets: number;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Story Points Trend chart.
 * Contains daily data points plus metadata for the chart UI.
 */
export interface StoryPointsTrendChartData {
  /** Array of daily story points trend data points */
  readonly rows: readonly StoryPointsTrendPoint[];
  /** Whether any data was found */
  readonly hasData: boolean;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for the story points trend queries.
 * All filters are optional and combined with AND logic.
 */
export interface StoryPointsTrendFilters {
  /** Start date for date range filter (ISO date string YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string YYYY-MM-DD) */
  readonly endDate?: string;
  /** Filter by team name */
  readonly team?: string;
  /** Number of days to look back (default 30) */
  readonly daysBack?: number;
}

// ============================================================================
// Teams Response Type
// ============================================================================

/**
 * Response containing available teams for the filter dropdown.
 */
export interface StoryPointsTrendTeamsResponse {
  /** Array of distinct team names */
  readonly teams: readonly string[];
}
