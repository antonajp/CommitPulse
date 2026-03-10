/**
 * Message protocol types for communication between the extension host
 * and the Release Risk Gauge Dashboard webview.
 *
 * Messages flow in two directions:
 * - ReleaseRiskWebviewToHost: Messages sent from the webview to the extension
 * - ReleaseRiskHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-911
 */

import type {
  CommitRisk,
  ReleaseRiskSummary,
  RiskCategory,
} from '../../services/release-risk-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load commit risk data.
 * Optional repository, branch, date range, and risk category filters may be provided.
 */
export interface RequestCommitRisksData {
  readonly type: 'requestCommitRisksData';
  readonly repository?: string;
  readonly branch?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly riskCategory?: RiskCategory;
  readonly team?: string;
}

/**
 * Request to load release risk summary data.
 * Optional repository, branch, and risk category filters may be provided.
 */
export interface RequestReleaseRiskSummary {
  readonly type: 'requestReleaseRiskSummary';
  readonly repository?: string;
  readonly branch?: string;
  readonly riskCategory?: RiskCategory;
}

/**
 * Request to refresh all release risk data with current filters.
 * Used when user clicks refresh button or when auto-refresh triggers.
 */
export interface RequestReleaseRiskRefresh {
  readonly type: 'requestReleaseRiskRefresh';
}

/**
 * Request to drill down into a specific release (repository + branch).
 * Returns detailed commit risks for that release.
 */
export interface RequestReleaseRiskDrilldown {
  readonly type: 'requestReleaseRiskDrilldown';
  readonly repository: string;
  readonly branch: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type ReleaseRiskWebviewToHost =
  | RequestCommitRisksData
  | RequestReleaseRiskSummary
  | RequestReleaseRiskRefresh
  | RequestReleaseRiskDrilldown;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with commit risk data.
 */
export interface ResponseCommitRisksData {
  readonly type: 'commitRisksData';
  readonly commits: readonly CommitRisk[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with release risk summary data.
 */
export interface ResponseReleaseRiskSummary {
  readonly type: 'releaseRiskSummary';
  readonly summaries: readonly ReleaseRiskSummary[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with drilldown data for a specific release.
 */
export interface ResponseReleaseRiskDrilldown {
  readonly type: 'releaseRiskDrilldown';
  readonly repository: string;
  readonly branch: string;
  readonly commits: readonly CommitRisk[];
  readonly summary: ReleaseRiskSummary | null;
}

/**
 * Error response sent when a data query fails.
 */
export interface ReleaseRiskResponseError {
  readonly type: 'releaseRiskError';
  readonly message: string;
  readonly source: string;
}

/**
 * Loading state notification.
 * Sent when data is being fetched.
 */
export interface ReleaseRiskLoadingState {
  readonly type: 'releaseRiskLoading';
  readonly isLoading: boolean;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type ReleaseRiskHostToWebview =
  | ResponseCommitRisksData
  | ResponseReleaseRiskSummary
  | ResponseReleaseRiskDrilldown
  | ReleaseRiskResponseError
  | ReleaseRiskLoadingState;
