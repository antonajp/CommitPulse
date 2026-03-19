/**
 * Message protocol types for communication between the extension host
 * and the Code Review Velocity dashboard webview.
 *
 * Messages flow in two directions:
 * - CodeReviewWebviewToHost: Messages sent from the webview to the extension
 * - CodeReviewHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-899
 */

import type {
  CodeReviewMetrics,
  PRStats,
  AvgMetricsByRepository,
  AvgMetricsByAuthor,
  AvgMetricsBySize,
  PRSizeCategory,
  PRState,
} from '../../services/code-review-velocity-types.js';
import type { SharedWebviewToHost } from './shared-protocol.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load code review velocity metrics.
 * Optional date range, repository, author, and size filters may be provided.
 */
export interface RequestCodeReviewData {
  readonly type: 'requestCodeReviewData';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly repository?: string;
  readonly author?: string;
  readonly sizeCategory?: PRSizeCategory;
  readonly state?: PRState;
}

/**
 * Request to load merged PR metrics only.
 */
export interface RequestMergedPRData {
  readonly type: 'requestMergedPRData';
  readonly startDate?: string;
  readonly endDate?: string;
}

/**
 * Request to load average metrics by repository.
 */
export interface RequestAvgByRepository {
  readonly type: 'requestAvgByRepository';
  readonly startDate?: string;
  readonly endDate?: string;
}

/**
 * Request to load average metrics by author.
 */
export interface RequestAvgByAuthor {
  readonly type: 'requestAvgByAuthor';
  readonly startDate?: string;
  readonly endDate?: string;
}

/**
 * Request to load average metrics by size category.
 */
export interface RequestAvgBySize {
  readonly type: 'requestAvgBySize';
  readonly startDate?: string;
  readonly endDate?: string;
}

/**
 * Request to load PR statistics.
 */
export interface RequestPRStats {
  readonly type: 'requestPRStats';
}

/**
 * Request to trigger PR sync from GitHub.
 */
export interface RequestPRSync {
  readonly type: 'requestPRSync';
  readonly owner?: string;
  readonly repo?: string;
  readonly syncDaysBack?: number;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type CodeReviewWebviewToHost =
  | RequestCodeReviewData
  | RequestMergedPRData
  | RequestAvgByRepository
  | RequestAvgByAuthor
  | RequestAvgBySize
  | RequestPRStats
  | RequestPRSync
  | SharedWebviewToHost;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with code review velocity metrics.
 */
export interface ResponseCodeReviewData {
  readonly type: 'codeReviewData';
  readonly rows: readonly CodeReviewMetrics[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with merged PR metrics only.
 */
export interface ResponseMergedPRData {
  readonly type: 'mergedPRData';
  readonly rows: readonly CodeReviewMetrics[];
  readonly hasData: boolean;
}

/**
 * Response with average metrics by repository.
 */
export interface ResponseAvgByRepository {
  readonly type: 'avgByRepository';
  readonly rows: readonly AvgMetricsByRepository[];
  readonly hasData: boolean;
}

/**
 * Response with average metrics by author.
 */
export interface ResponseAvgByAuthor {
  readonly type: 'avgByAuthor';
  readonly rows: readonly AvgMetricsByAuthor[];
  readonly hasData: boolean;
}

/**
 * Response with average metrics by size category.
 */
export interface ResponseAvgBySize {
  readonly type: 'avgBySize';
  readonly rows: readonly AvgMetricsBySize[];
  readonly hasData: boolean;
}

/**
 * Response with PR statistics.
 */
export interface ResponsePRStats {
  readonly type: 'prStats';
  readonly stats: PRStats | null;
}

/**
 * Response with PR sync result.
 */
export interface ResponsePRSync {
  readonly type: 'prSyncResult';
  readonly success: boolean;
  readonly totalPRs: number;
  readonly totalReviews: number;
  readonly errorCount: number;
  readonly durationMs: number;
}

/**
 * Error response sent when a data query fails.
 */
export interface CodeReviewResponseError {
  readonly type: 'codeReviewError';
  readonly message: string;
  readonly source: string;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type CodeReviewHostToWebview =
  | ResponseCodeReviewData
  | ResponseMergedPRData
  | ResponseAvgByRepository
  | ResponseAvgByAuthor
  | ResponseAvgBySize
  | ResponsePRStats
  | ResponsePRSync
  | CodeReviewResponseError;
