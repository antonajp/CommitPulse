/**
 * TypeScript interfaces for the Developer Focus Score Dashboard data shapes.
 * Defines the data model for focus analysis and context switching detection.
 *
 * The Developer Focus dashboard helps engineering managers understand:
 * - How many different tickets does a developer touch per day/week?
 * - Are developers being pulled in too many directions?
 * - What's the correlation between focus and code quality?
 * - Which team members need workload rebalancing?
 *
 * Ticket: IQS-907
 */

// ============================================================================
// Focus Category Types
// ============================================================================

/**
 * Focus categories for classifying developer focus levels.
 * - deep_focus: Focus score >= 80 (minimal context switching)
 * - moderate_focus: Focus score 60-79 (acceptable switching)
 * - fragmented: Focus score 40-59 (concerning levels)
 * - highly_fragmented: Focus score < 40 (needs intervention)
 */
export type FocusCategory = 'deep_focus' | 'moderate_focus' | 'fragmented' | 'highly_fragmented';

/**
 * Valid focus categories for input validation.
 */
export const VALID_FOCUS_CATEGORIES: readonly FocusCategory[] = [
  'deep_focus',
  'moderate_focus',
  'fragmented',
  'highly_fragmented',
];

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for focus queries.
 * All filters are optional and combined with AND logic.
 */
export interface FocusFilters {
  /** Start date for week_start filter (ISO date string) */
  readonly startDate?: string;
  /** End date for week_start filter (ISO date string) */
  readonly endDate?: string;
  /** Filter by author name */
  readonly author?: string;
  /** Filter by team name (requires team mapping) */
  readonly team?: string;
  /** Filter by focus category */
  readonly focusCategory?: FocusCategory;
}

// ============================================================================
// Daily Activity Types
// ============================================================================

/**
 * Daily developer activity row from vw_developer_daily_activity.
 * Used for detailed daily breakdowns and drill-down analysis.
 */
export interface DeveloperDailyActivity {
  /** Developer name/email */
  readonly author: string;
  /** The day (ISO date string) */
  readonly commitDay: string;
  /** Repository name */
  readonly repository: string;
  /** Number of commits on this day */
  readonly commitCount: number;
  /** Number of unique tickets touched */
  readonly uniqueTickets: number;
  /** Number of unique files modified */
  readonly uniqueFiles: number;
  /** Total lines of code changed */
  readonly totalLocChanged: number;
  /** Number of ticket switches (context indicator) */
  readonly ticketSwitches: number;
}

// ============================================================================
// Focus Score Types
// ============================================================================

/**
 * Weekly developer focus row from vw_developer_focus.
 * Contains the calculated focus score and related metrics.
 */
export interface DeveloperFocusRow {
  /** Developer name/email */
  readonly author: string;
  /** Start of the week (ISO date string) */
  readonly weekStart: string;
  /** Total commits for the week */
  readonly totalCommits: number;
  /** Total unique tickets touched */
  readonly totalUniqueTickets: number;
  /** Total unique files modified */
  readonly totalUniqueFiles: number;
  /** Total lines of code changed */
  readonly totalLoc: number;
  /** Number of active working days */
  readonly activeDays: number;
  /** Average tickets touched per active day */
  readonly avgTicketsPerDay: number;
  /** Focus score (0-100, higher = better focus) */
  readonly focusScore: number;
  /** Lines of code per commit (productivity indicator) */
  readonly locPerCommit: number;
  /** Commits per ticket (depth indicator) */
  readonly commitsPerTicket: number;
  /** Focus category classification */
  readonly focusCategory: FocusCategory;
  /** Week-over-week focus score change (null for first week) */
  readonly focusScoreDelta: number | null;
}

// ============================================================================
// Trend Analysis Types
// ============================================================================

/**
 * Developer trend data for time series visualization.
 */
export interface DeveloperTrendPoint {
  /** Developer name */
  readonly name: string;
  /** Array of focus scores over time */
  readonly scores: readonly number[];
  /** Average focus score across all weeks */
  readonly avgScore: number;
  /** Number of weeks with data */
  readonly weekCount: number;
}

/**
 * Focus trend data for the dashboard.
 * Contains time series data for charting focus over time.
 */
export interface FocusTrendData {
  /** Array of week start dates (ISO strings) */
  readonly weeks: readonly string[];
  /** Developer-level trend data */
  readonly developers: readonly DeveloperTrendPoint[];
  /** Team average focus score by week */
  readonly teamAvgByWeek: readonly number[];
  /** Overall team average focus score */
  readonly overallTeamAvg: number;
}

// ============================================================================
// Summary Types
// ============================================================================

/**
 * Summary statistics for a developer over a period.
 */
export interface DeveloperFocusSummary {
  /** Developer name */
  readonly author: string;
  /** Average focus score */
  readonly avgFocusScore: number;
  /** Current focus category */
  readonly currentCategory: FocusCategory;
  /** Total commits */
  readonly totalCommits: number;
  /** Total tickets touched */
  readonly totalTickets: number;
  /** Focus score trend (positive = improving) */
  readonly trend: number;
  /** Number of weeks analyzed */
  readonly weeksAnalyzed: number;
}

/**
 * Team-level focus summary.
 */
export interface TeamFocusSummary {
  /** Average team focus score */
  readonly avgFocusScore: number;
  /** Number of developers in deep focus */
  readonly deepFocusCount: number;
  /** Number of developers in moderate focus */
  readonly moderateFocusCount: number;
  /** Number of developers fragmented */
  readonly fragmentedCount: number;
  /** Number of developers highly fragmented */
  readonly highlyFragmentedCount: number;
  /** Total developers analyzed */
  readonly totalDevelopers: number;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Developer Focus dashboard.
 * Contains focus data plus metadata for the dashboard UI.
 */
export interface FocusChartData {
  /** Developer focus rows */
  readonly focusData: readonly DeveloperFocusRow[];
  /** Trend data for visualization */
  readonly trends: FocusTrendData;
  /** Team summary statistics */
  readonly teamSummary: TeamFocusSummary;
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the views exist in the database */
  readonly viewExists: boolean;
}

/**
 * Response with daily activity data for drill-down.
 */
export interface DailyActivityChartData {
  /** Daily activity records */
  readonly activities: readonly DeveloperDailyActivity[];
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
export const FOCUS_MAX_FILTER_LENGTH = 200;

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Matches similar limits in other dashboards.
 */
export const FOCUS_MAX_RESULT_ROWS = 1000;

/**
 * Default number of weeks to look back for focus data.
 */
export const FOCUS_DEFAULT_WEEKS = 12;

/**
 * Focus score thresholds for category assignment.
 */
export const FOCUS_THRESHOLDS = {
  DEEP_FOCUS: 80,
  MODERATE_FOCUS: 60,
  FRAGMENTED: 40,
} as const;

/**
 * Focus score formula: 100 - (avgTicketsPerDay * MULTIPLIER)
 * This multiplier determines how much each additional ticket impacts the score.
 */
export const FOCUS_SCORE_MULTIPLIER = 15;
