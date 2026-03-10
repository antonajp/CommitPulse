/**
 * Message protocol types for communication between the extension host
 * and the Hot Spots dashboard webview.
 *
 * Messages flow in two directions:
 * - HotSpotsWebviewToHost: Messages sent from the webview to the extension
 * - HotSpotsHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Part 1 (IQS-901): Database & Data Service
 * Part 2 (IQS-902): Webview & Visualization - Adds file open, history, and bug actions
 */

import type {
  HotSpotRow,
  RiskTier,
} from '../../services/hot-spots-data-types.js';
import type { HotSpotsSummary } from '../../database/queries/hot-spots-queries.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load hot spots data.
 * Optional repository, risk tier, and threshold filters may be provided.
 */
export interface RequestHotSpotsData {
  readonly type: 'requestHotSpotsData';
  readonly repository?: string;
  readonly riskTier?: RiskTier;
  readonly minChurn?: number;
  readonly minComplexity?: number;
}

/**
 * Request to load hot spots summary statistics.
 * Returns aggregate counts by risk tier.
 */
export interface RequestHotSpotsSummary {
  readonly type: 'requestHotSpotsSummary';
}

/**
 * Request to refresh hot spots data with current filters.
 * Used when user clicks refresh button or when auto-refresh triggers.
 */
export interface RequestHotSpotsRefresh {
  readonly type: 'requestHotSpotsRefresh';
}

/**
 * Request to open a file in VS Code editor (IQS-902).
 * Validates file path is within workspace before opening.
 */
export interface RequestOpenFile {
  readonly type: 'openFile';
  readonly filePath: string;
  readonly repository: string;
}

/**
 * Request to view file history in VS Code (IQS-902).
 * Uses VS Code's built-in Git extension for timeline view.
 */
export interface RequestViewHistory {
  readonly type: 'viewHistory';
  readonly filePath: string;
  readonly repository: string;
}

/**
 * Request to view bug tickets associated with a file (IQS-902).
 * Opens a quick pick list of linked bug tickets.
 */
export interface RequestViewBugs {
  readonly type: 'viewBugs';
  readonly filePath: string;
  readonly repository: string;
  readonly bugCount: number;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type HotSpotsWebviewToHost =
  | RequestHotSpotsData
  | RequestHotSpotsSummary
  | RequestHotSpotsRefresh
  | RequestOpenFile
  | RequestViewHistory
  | RequestViewBugs;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with hot spots data.
 */
export interface ResponseHotSpotsData {
  readonly type: 'hotSpotsData';
  readonly rows: readonly HotSpotRow[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with hot spots summary statistics by risk tier.
 */
export interface ResponseHotSpotsSummary {
  readonly type: 'hotSpotsSummary';
  readonly summary: readonly HotSpotsSummary[];
}

/**
 * Error response sent when a data query fails.
 */
export interface HotSpotsResponseError {
  readonly type: 'hotSpotsError';
  readonly message: string;
  readonly source: string;
}

/**
 * Loading state notification.
 * Sent when data is being fetched.
 */
export interface HotSpotsLoadingState {
  readonly type: 'hotSpotsLoading';
  readonly isLoading: boolean;
}

/**
 * Response with list of unique repositories (IQS-902).
 * Used to populate the repository filter dropdown.
 */
export interface ResponseRepositories {
  readonly type: 'repositories';
  readonly repositories: readonly string[];
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type HotSpotsHostToWebview =
  | ResponseHotSpotsData
  | ResponseHotSpotsSummary
  | HotSpotsResponseError
  | HotSpotsLoadingState
  | ResponseRepositories;
