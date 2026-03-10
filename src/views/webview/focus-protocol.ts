/**
 * Message protocol types for communication between the extension host
 * and the Developer Focus Score dashboard webview.
 *
 * Messages flow in two directions:
 * - FocusWebviewToHost: Messages sent from the webview to the extension
 * - FocusHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-907
 */

import type {
  DeveloperFocusRow,
  DeveloperDailyActivity,
  FocusTrendData,
  TeamFocusSummary,
  FocusFilters,
  FocusCategory,
} from '../../services/developer-focus-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load focus chart data.
 * Optional filters for date range, author, and focus category.
 */
export interface RequestFocusData {
  readonly type: 'requestFocusData';
  readonly filters?: FocusFilters;
}

/**
 * Request to load daily activity data.
 * Used for detailed daily breakdowns and drill-down.
 */
export interface RequestDailyActivityData {
  readonly type: 'requestDailyActivityData';
  readonly filters?: FocusFilters;
}

/**
 * Request to load focus trend data.
 * Used for time series visualization.
 */
export interface RequestFocusTrendData {
  readonly type: 'requestFocusTrendData';
  readonly filters?: FocusFilters;
}

/**
 * Request to refresh focus data with current filters.
 * Used when user clicks refresh button or when auto-refresh triggers.
 */
export interface RequestFocusRefresh {
  readonly type: 'requestFocusRefresh';
  readonly filters?: FocusFilters;
}

/**
 * Request to update filters and reload data.
 * Used when user changes filter controls in the webview.
 */
export interface RequestFocusFilterUpdate {
  readonly type: 'requestFocusFilterUpdate';
  readonly filters: FocusFilters;
}

/**
 * Request to drill down into a specific developer's focus details.
 * Used when user clicks on a developer in the dashboard.
 */
export interface RequestDeveloperDrillDown {
  readonly type: 'requestDeveloperDrillDown';
  /** Author name for drill-down */
  readonly author: string;
  /** Current filters to apply */
  readonly filters?: FocusFilters;
}

/**
 * Request to drill down into a specific week's details.
 * Used when user clicks on a week in the trend chart.
 */
export interface RequestWeekDrillDown {
  readonly type: 'requestWeekDrillDown';
  /** Week start date (ISO string) */
  readonly weekStart: string;
  /** Current filters to apply */
  readonly filters?: FocusFilters;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type FocusWebviewToHost =
  | RequestFocusData
  | RequestDailyActivityData
  | RequestFocusTrendData
  | RequestFocusRefresh
  | RequestFocusFilterUpdate
  | RequestDeveloperDrillDown
  | RequestWeekDrillDown;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with focus chart data.
 */
export interface ResponseFocusData {
  readonly type: 'focusData';
  readonly focusData: readonly DeveloperFocusRow[];
  readonly trends: FocusTrendData;
  readonly teamSummary: TeamFocusSummary;
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with daily activity data.
 */
export interface ResponseDailyActivityData {
  readonly type: 'dailyActivityData';
  readonly activities: readonly DeveloperDailyActivity[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with focus trend data.
 */
export interface ResponseFocusTrendData {
  readonly type: 'focusTrendData';
  readonly trends: FocusTrendData;
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with drill-down data for a specific developer.
 */
export interface ResponseDeveloperDrillDown {
  readonly type: 'developerDrillDown';
  readonly author: string;
  /** Focus rows for this developer */
  readonly focusRows: readonly DeveloperFocusRow[];
  /** Daily activity for this developer */
  readonly dailyActivity: readonly DeveloperDailyActivity[];
  /** Average focus score */
  readonly avgFocusScore: number;
  /** Current focus category */
  readonly currentCategory: FocusCategory;
  /** Focus score trend (positive = improving) */
  readonly trend: number;
}

/**
 * Response with drill-down data for a specific week.
 */
export interface ResponseWeekDrillDown {
  readonly type: 'weekDrillDown';
  readonly weekStart: string;
  /** Focus rows for this week */
  readonly focusRows: readonly DeveloperFocusRow[];
  /** Team average focus score for this week */
  readonly teamAvgScore: number;
  /** Developer breakdown by category */
  readonly categoryBreakdown: {
    readonly deepFocus: readonly string[];
    readonly moderateFocus: readonly string[];
    readonly fragmented: readonly string[];
    readonly highlyFragmented: readonly string[];
  };
}

/**
 * Error response sent when a data query fails.
 */
export interface FocusResponseError {
  readonly type: 'focusError';
  readonly message: string;
  readonly source: string;
}

/**
 * Loading state notification.
 * Sent when data is being fetched.
 */
export interface FocusLoadingState {
  readonly type: 'focusLoading';
  readonly isLoading: boolean;
}

/**
 * Filter options available for the dashboard.
 * Sent to populate filter dropdowns in the webview.
 */
export interface ResponseFocusFilterOptions {
  readonly type: 'focusFilterOptions';
  /** Available authors */
  readonly authors: readonly string[];
  /** Available focus categories */
  readonly focusCategories: readonly FocusCategory[];
  /** Available week start dates */
  readonly weeks: readonly string[];
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type FocusHostToWebview =
  | ResponseFocusData
  | ResponseDailyActivityData
  | ResponseFocusTrendData
  | ResponseDeveloperDrillDown
  | ResponseWeekDrillDown
  | FocusResponseError
  | FocusLoadingState
  | ResponseFocusFilterOptions;
