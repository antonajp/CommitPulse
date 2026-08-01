/**
 * Message protocol types for communication between the extension host
 * and the Dead Branches Report webview.
 *
 * Messages flow in two directions:
 * - DeadBranchesWebviewToHost: Messages sent from the webview to the extension
 * - DeadBranchesHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: GITX-231
 */

import type { BranchStatus, BranchRiskLevel } from '../../services/dead-branches-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load dead branch data with optional filters.
 */
export interface RequestBranchData {
  readonly type: 'requestBranchData';
  /** Optional repository filter */
  readonly repository?: string;
  /** Optional risk level filter */
  readonly riskLevel?: BranchRiskLevel;
  /** Optional status filter */
  readonly status?: BranchStatus;
  /** Optional search string for branch name */
  readonly search?: string;
}

/**
 * Request to load filter options (available repositories, statuses, risk levels).
 */
export interface RequestFilterOptions {
  readonly type: 'requestFilterOptions';
}

/**
 * Request to delete one or more branches.
 * Extension host will validate protected branches and show confirmation dialog.
 */
export interface RequestDeleteBranches {
  readonly type: 'deleteBranches';
  /** Branch names to delete */
  readonly branches: string[];
  /** Repository name */
  readonly repository: string;
  /** If true, use git branch -D (force deletion) */
  readonly force?: boolean;
}

/**
 * Request to export branch data to CSV file.
 */
export interface RequestExportCsv {
  readonly type: 'exportCsv';
  /** The filtered/sorted branch data to export */
  readonly data: unknown[];
}

/**
 * Request to open an external URL (commit link, GitHub branch).
 */
export interface RequestOpenExternal {
  readonly type: 'openExternal';
  readonly url: string;
}

/**
 * Request to scan repositories for branch analysis.
 * This triggers DeadBranchesService.analyzeBranches() for each configured repository.
 */
export interface RequestScanBranches {
  readonly type: 'scanBranches';
  /** Optional: specific repository to scan. If omitted, scans all configured repos. */
  readonly repository?: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type DeadBranchesWebviewToHost =
  | RequestBranchData
  | RequestFilterOptions
  | RequestDeleteBranches
  | RequestExportCsv
  | RequestOpenExternal
  | RequestScanBranches;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Branch row data for table display.
 * Flattened from DetectedBranch with UI-friendly fields.
 */
export interface BranchRow {
  /** Unique row ID (database ID or generated) */
  readonly id: number;
  /** Branch name */
  readonly branchName: string;
  /** Repository name */
  readonly repository: string;
  /** Last commit date (ISO string for sorting) */
  readonly lastCommitDate: string;
  /** Author of last commit */
  readonly lastCommitAuthor: string;
  /** Last commit SHA (full 40 chars for URL construction) */
  readonly lastCommitSha: string;
  /** Total commits on this branch */
  readonly commitCount: number;
  /** Computed status */
  readonly status: BranchStatus;
  /** Computed risk level */
  readonly riskLevel: BranchRiskLevel;
  /** Days since last commit */
  readonly daysSinceLastCommit: number;
  /** Protected branch this was merged into, null if not merged */
  readonly mergedInto: string | null;
  /** Contextual help text for this branch's status */
  readonly tooltip: string;
}

/**
 * Summary counts by status.
 */
export interface BranchSummary {
  /** Total branches analyzed (excluding protected) */
  readonly total: number;
  /** Merged branches count */
  readonly merged: number;
  /** Stale branches count */
  readonly stale: number;
  /** Orphaned branches count */
  readonly orphaned: number;
  /** Active branches count */
  readonly active: number;
}

/**
 * Risk level distribution for donut chart.
 */
export interface RiskDistribution {
  readonly safe: number;
  readonly low: number;
  readonly medium: number;
  readonly high: number;
}

/**
 * Repository-level risk breakdown for stacked bar chart.
 */
export interface RepoBreakdown {
  readonly repository: string;
  readonly safe: number;
  readonly low: number;
  readonly medium: number;
  readonly high: number;
}

/**
 * Response with dead branch data and summary statistics.
 */
export interface ResponseBranchData {
  readonly type: 'branchData';
  /** Filtered branch rows for table */
  readonly branches: readonly BranchRow[];
  /** Summary counts */
  readonly summary: BranchSummary;
  /** Risk distribution */
  readonly riskDistribution: RiskDistribution;
  /** Per-repository breakdown */
  readonly repositoryBreakdown: readonly RepoBreakdown[];
  /** True if any data exists (empty state if false) */
  readonly hasData: boolean;
}

/**
 * Response with filter dropdown options.
 */
export interface ResponseFilterOptions {
  readonly type: 'filterOptions';
  /** Available repository names */
  readonly repositories: readonly string[];
  /** Available status values */
  readonly statuses: readonly BranchStatus[];
  /** Available risk levels */
  readonly riskLevels: readonly BranchRiskLevel[];
}

/**
 * Result of a single branch deletion.
 */
export interface DeleteResult {
  /** Branch name */
  readonly branchName: string;
  /** True if deletion succeeded */
  readonly success: boolean;
  /** SHA of deleted branch (for recovery) */
  readonly sha?: string;
  /** Error message if deletion failed */
  readonly error?: string;
}

/**
 * Response with deletion results.
 */
export interface ResponseDeleteResult {
  readonly type: 'deleteResult';
  /** Results for each branch deletion attempt */
  readonly results: readonly DeleteResult[];
  /** True if all deletions succeeded */
  readonly success: boolean;
}

/**
 * Error response sent when a request fails.
 */
export interface ResponseError {
  readonly type: 'error';
  /** Error message to display */
  readonly message: string;
  /** Source of the error (request type) */
  readonly source: string;
}

/**
 * Response indicating scan is in progress.
 */
export interface ResponseScanProgress {
  readonly type: 'scanProgress';
  /** Repository currently being scanned */
  readonly repository: string;
  /** Current repo index (1-based) */
  readonly current: number;
  /** Total repositories to scan */
  readonly total: number;
  /** Optional status message */
  readonly message?: string;
}

/**
 * Response indicating scan completed.
 */
export interface ResponseScanComplete {
  readonly type: 'scanComplete';
  /** Number of branches found */
  readonly branchesFound: number;
  /** Number of repositories scanned */
  readonly repositoriesScanned: number;
  /** True if scan completed successfully */
  readonly success: boolean;
  /** Error message if scan failed */
  readonly error?: string;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type DeadBranchesHostToWebview =
  | ResponseBranchData
  | ResponseFilterOptions
  | ResponseDeleteResult
  | ResponseError
  | ResponseScanProgress
  | ResponseScanComplete;
