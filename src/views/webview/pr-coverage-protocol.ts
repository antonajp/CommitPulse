/**
 * Message protocol types for communication between the extension host
 * and the PR Coverage Report dashboard webview.
 *
 * Messages flow in two directions:
 * - PRCoverageWebviewToHost: Messages sent from the webview to the extension
 * - PRCoverageHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: GITX-221
 */

import type {
  PRCoverageOverall,
  OrphanCommit,
  OrphanCategoryBreakdown,
  CoverageByBranch,
  CoverageByAuthor,
  CoverageByContributor,
  CoverageByTeam,
  WeeklyTrendPoint,
} from '../../services/pr-coverage-types.js';
import type { SharedWebviewToHost } from './shared-protocol.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load all PR coverage chart data.
 * Optional date range, repository, author, and branch filters may be provided.
 */
export interface RequestPRCoverageData {
  readonly type: 'requestPRCoverageData';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly repository?: string;
  readonly author?: string;
  readonly branches?: readonly string[];
  readonly teams?: readonly string[];
}

/**
 * Request to load orphan commits only.
 */
export interface RequestOrphanCommits {
  readonly type: 'requestOrphanCommits';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly repository?: string;
  readonly author?: string;
  readonly branches?: readonly string[];
  readonly teams?: readonly string[];
}

/**
 * Request to load filter options (repositories, authors, branches).
 */
export interface RequestFilterOptions {
  readonly type: 'requestFilterOptions';
  readonly repository?: string;
}

/**
 * Request to sync PR coverage data from GitHub.
 */
export interface RequestSyncCoverage {
  readonly type: 'requestSyncCoverage';
}

/**
 * Request to open a commit in GitHub.
 */
export interface RequestOpenCommit {
  readonly type: 'openCommit';
  readonly sha: string;
  readonly repository: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type PRCoverageWebviewToHost =
  | RequestPRCoverageData
  | RequestOrphanCommits
  | RequestFilterOptions
  | RequestSyncCoverage
  | RequestOpenCommit
  | SharedWebviewToHost;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with complete PR coverage chart data.
 */
export interface ResponsePRCoverageData {
  readonly type: 'prCoverageData';
  readonly overall: PRCoverageOverall;
  readonly weeklyTrend: readonly WeeklyTrendPoint[];
  readonly byAuthor: readonly CoverageByAuthor[];
  readonly byBranch: readonly CoverageByBranch[];
  readonly byContributor: readonly CoverageByContributor[];
  readonly byTeam: readonly CoverageByTeam[];
  readonly orphanCommits: readonly OrphanCommit[];
  /** Orphan category breakdown for chart and KPIs (GITX-227) */
  readonly orphanBreakdown: OrphanCategoryBreakdown;
  readonly hasData: boolean;
  readonly viewExists: boolean;
  readonly hasPRData: boolean;
}

/**
 * Response with orphan commits only.
 */
export interface ResponseOrphanCommits {
  readonly type: 'orphanCommitsData';
  readonly orphanCommits: readonly OrphanCommit[];
  readonly hasData: boolean;
}

/**
 * Response with filter options.
 */
export interface ResponseFilterOptions {
  readonly type: 'filterOptions';
  readonly repositories: readonly string[];
  readonly authors: readonly string[];
  readonly branches: readonly string[];
  readonly teams: readonly string[];
}

/**
 * Response with sync result.
 */
export interface ResponseSyncResult {
  readonly type: 'syncResult';
  readonly success: boolean;
  readonly linksCreated: number;
  readonly errorMessage?: string;
}

/**
 * Error response sent when a data query fails.
 */
export interface PRCoverageResponseError {
  readonly type: 'prCoverageError';
  readonly message: string;
  readonly source: string;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type PRCoverageHostToWebview =
  | ResponsePRCoverageData
  | ResponseOrphanCommits
  | ResponseFilterOptions
  | ResponseSyncResult
  | PRCoverageResponseError;
