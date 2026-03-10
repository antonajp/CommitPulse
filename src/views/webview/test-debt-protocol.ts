/**
 * Message protocol types for communication between the extension host
 * and the Test Debt Predictor Dashboard webview.
 *
 * Messages flow in two directions:
 * - TestDebtWebviewToHost: Messages sent from the webview to the extension
 * - TestDebtHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-913
 */

import type { TestDebtWeek, CommitTestDetail } from '../../services/test-debt-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load test debt trend data.
 * Optional repository and date range filters may be provided.
 */
export interface RequestTestDebtTrend {
  readonly type: 'requestTestDebtTrend';
  readonly repository?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

/**
 * Request to load low test commits data.
 * Optional repository, author, and date range filters may be provided.
 */
export interface RequestLowTestCommits {
  readonly type: 'requestLowTestCommits';
  readonly repository?: string;
  readonly author?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

/**
 * Request to refresh all test debt data with current filters.
 * Used when user clicks refresh button or when auto-refresh triggers.
 */
export interface RequestTestDebtRefresh {
  readonly type: 'requestTestDebtRefresh';
}

/**
 * Request to drill down into a specific week's test debt.
 * Returns detailed commits for that week.
 */
export interface RequestTestDebtDrilldown {
  readonly type: 'requestTestDebtDrilldown';
  readonly week: string;
  readonly repository: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type TestDebtWebviewToHost =
  | RequestTestDebtTrend
  | RequestLowTestCommits
  | RequestTestDebtRefresh
  | RequestTestDebtDrilldown;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with test debt trend data.
 */
export interface ResponseTestDebtTrend {
  readonly type: 'testDebtTrend';
  readonly weeks: readonly TestDebtWeek[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with low test commits data.
 */
export interface ResponseLowTestCommits {
  readonly type: 'lowTestCommits';
  readonly commits: readonly CommitTestDetail[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with drilldown data for a specific week.
 */
export interface ResponseTestDebtDrilldown {
  readonly type: 'testDebtDrilldown';
  readonly week: string;
  readonly repository: string;
  readonly commits: readonly CommitTestDetail[];
}

/**
 * Error response sent when a data query fails.
 */
export interface TestDebtResponseError {
  readonly type: 'testDebtError';
  readonly message: string;
  readonly source: string;
}

/**
 * Loading state notification.
 * Sent when data is being fetched.
 */
export interface TestDebtLoadingState {
  readonly type: 'testDebtLoading';
  readonly isLoading: boolean;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type TestDebtHostToWebview =
  | ResponseTestDebtTrend
  | ResponseLowTestCommits
  | ResponseTestDebtDrilldown
  | TestDebtResponseError
  | TestDebtLoadingState;
