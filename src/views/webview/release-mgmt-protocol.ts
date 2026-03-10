/**
 * Message protocol types for communication between the extension host
 * and the Release Management Contributions chart webview.
 *
 * Messages flow in two directions:
 * - ReleaseMgmtWebviewToHost: Messages sent from the webview to the extension
 * - ReleaseMgmtHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-898
 */

import type {
  ReleaseContributionSummary,
  EnvironmentDistributionPoint,
} from '../../services/release-mgmt-data-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load release management chart data.
 * Optional date range, team, and repository filters may be provided.
 */
export interface RequestReleaseMgmtData {
  readonly type: 'requestReleaseMgmtData';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly team?: string;
  readonly repository?: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type ReleaseMgmtWebviewToHost = RequestReleaseMgmtData;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with release management chart data.
 */
export interface ResponseReleaseMgmtData {
  readonly type: 'releaseMgmtData';
  readonly summaries: readonly ReleaseContributionSummary[];
  readonly environmentDistribution: readonly EnvironmentDistributionPoint[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Error response sent when a data query fails.
 */
export interface ReleaseMgmtResponseError {
  readonly type: 'releaseMgmtError';
  readonly message: string;
  readonly source: string;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type ReleaseMgmtHostToWebview =
  | ResponseReleaseMgmtData
  | ReleaseMgmtResponseError;
