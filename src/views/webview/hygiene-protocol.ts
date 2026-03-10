/**
 * Message protocol types for communication between the extension host
 * and the Commit Hygiene Tracker Dashboard webview.
 *
 * Messages flow in two directions:
 * - HygieneWebviewToHost: Messages sent from the webview to the extension
 * - HygieneHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-915
 */

import type {
  CommitHygiene,
  AuthorHygieneSummary,
  WeeklyHygieneTrend,
  QualityTier,
  ConventionalCommitType,
} from '../../services/commit-hygiene-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load commit hygiene data.
 * Optional repository, branch, date range, quality tier, and commit type filters.
 */
export interface RequestCommitHygieneData {
  readonly type: 'requestCommitHygieneData';
  readonly repository?: string;
  readonly branch?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly qualityTier?: QualityTier;
  readonly commitType?: ConventionalCommitType;
  readonly author?: string;
  readonly team?: string;
}

/**
 * Request to load author hygiene summary data.
 * Optional repository and team filters.
 */
export interface RequestAuthorHygieneSummary {
  readonly type: 'requestAuthorHygieneSummary';
  readonly repository?: string;
  readonly team?: string;
}

/**
 * Request to load weekly hygiene trend data.
 * Optional repository filter.
 */
export interface RequestWeeklyHygieneTrend {
  readonly type: 'requestWeeklyHygieneTrend';
  readonly repository?: string;
}

/**
 * Request to refresh all hygiene data with current filters.
 * Used when user clicks refresh button or when auto-refresh triggers.
 */
export interface RequestHygieneRefresh {
  readonly type: 'requestHygieneRefresh';
}

/**
 * Request to drill down into a specific author's commits.
 * Returns detailed commit hygiene for that author.
 */
export interface RequestAuthorHygieneDrilldown {
  readonly type: 'requestAuthorHygieneDrilldown';
  readonly author: string;
  readonly repository?: string;
}

/**
 * Request to drill down into commits of a specific quality tier.
 * Returns commits matching that quality tier.
 */
export interface RequestQualityTierDrilldown {
  readonly type: 'requestQualityTierDrilldown';
  readonly qualityTier: QualityTier;
  readonly repository?: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type HygieneWebviewToHost =
  | RequestCommitHygieneData
  | RequestAuthorHygieneSummary
  | RequestWeeklyHygieneTrend
  | RequestHygieneRefresh
  | RequestAuthorHygieneDrilldown
  | RequestQualityTierDrilldown;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with commit hygiene data.
 */
export interface ResponseCommitHygieneData {
  readonly type: 'commitHygieneData';
  readonly commits: readonly CommitHygiene[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with author hygiene summary data.
 */
export interface ResponseAuthorHygieneSummary {
  readonly type: 'authorHygieneSummary';
  readonly summaries: readonly AuthorHygieneSummary[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with weekly hygiene trend data.
 */
export interface ResponseWeeklyHygieneTrend {
  readonly type: 'weeklyHygieneTrend';
  readonly trends: readonly WeeklyHygieneTrend[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with drilldown data for a specific author.
 */
export interface ResponseAuthorHygieneDrilldown {
  readonly type: 'authorHygieneDrilldown';
  readonly author: string;
  readonly commits: readonly CommitHygiene[];
  readonly summary: AuthorHygieneSummary | null;
}

/**
 * Response with drilldown data for a specific quality tier.
 */
export interface ResponseQualityTierDrilldown {
  readonly type: 'qualityTierDrilldown';
  readonly qualityTier: QualityTier;
  readonly commits: readonly CommitHygiene[];
}

/**
 * Error response sent when a data query fails.
 */
export interface HygieneResponseError {
  readonly type: 'hygieneError';
  readonly message: string;
  readonly source: string;
}

/**
 * Loading state notification.
 * Sent when data is being fetched.
 */
export interface HygieneLoadingState {
  readonly type: 'hygieneLoading';
  readonly isLoading: boolean;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type HygieneHostToWebview =
  | ResponseCommitHygieneData
  | ResponseAuthorHygieneSummary
  | ResponseWeeklyHygieneTrend
  | ResponseAuthorHygieneDrilldown
  | ResponseQualityTierDrilldown
  | HygieneResponseError
  | HygieneLoadingState;
