/**
 * Message protocol types for communication between the extension host
 * and the Commit-Jira Linkage webview.
 *
 * Messages flow in two directions:
 * - LinkageWebviewToHost: Messages sent from the webview to the extension
 * - LinkageHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-870
 */

import type {
  LinkageSummary,
  JiraProjectDistribution,
  JiraStatusFlowPoint,
  AssignmentHistoryEntry,
  UnlinkedCommitEntry,
  LinkageFilters,
  LinkageFilterOptions,
} from '../../services/linkage-data-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load linkage summary data (linked vs unlinked).
 */
export interface RequestLinkageSummary {
  readonly type: 'requestLinkageSummary';
  readonly filters: LinkageFilters;
}

/**
 * Request to load Jira project distribution data.
 */
export interface RequestJiraProjectDistribution {
  readonly type: 'requestJiraProjectDistribution';
  readonly filters: LinkageFilters;
}

/**
 * Request to load Jira status flow timeline data.
 */
export interface RequestJiraStatusFlow {
  readonly type: 'requestJiraStatusFlow';
  readonly filters: LinkageFilters;
}

/**
 * Request to load assignment history data.
 */
export interface RequestAssignmentHistory {
  readonly type: 'requestAssignmentHistory';
  readonly filters: LinkageFilters;
}

/**
 * Request to load unlinked commits for drill-down display.
 */
export interface RequestUnlinkedCommits {
  readonly type: 'requestUnlinkedCommits';
  readonly filters: LinkageFilters;
}

/**
 * Request to load filter options (teams, repos, Jira projects).
 */
export interface RequestLinkageFilterOptions {
  readonly type: 'requestLinkageFilterOptions';
}

/**
 * Request to open an external URL in the browser.
 * Ticket: IQS-925
 */
export interface RequestOpenExternal {
  readonly type: 'openExternal';
  readonly url: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type LinkageWebviewToHost =
  | RequestLinkageSummary
  | RequestJiraProjectDistribution
  | RequestJiraStatusFlow
  | RequestAssignmentHistory
  | RequestUnlinkedCommits
  | RequestLinkageFilterOptions
  | RequestOpenExternal;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with linkage summary data.
 */
export interface ResponseLinkageSummary {
  readonly type: 'linkageSummaryData';
  readonly data: LinkageSummary;
}

/**
 * Response with Jira project distribution data.
 */
export interface ResponseJiraProjectDistribution {
  readonly type: 'jiraProjectDistributionData';
  readonly data: readonly JiraProjectDistribution[];
}

/**
 * Response with Jira status flow timeline data.
 */
export interface ResponseJiraStatusFlow {
  readonly type: 'jiraStatusFlowData';
  readonly data: readonly JiraStatusFlowPoint[];
}

/**
 * Response with assignment history data.
 */
export interface ResponseAssignmentHistory {
  readonly type: 'assignmentHistoryData';
  readonly data: readonly AssignmentHistoryEntry[];
}

/**
 * Response with unlinked commits for drill-down.
 */
export interface ResponseUnlinkedCommits {
  readonly type: 'unlinkedCommitsData';
  readonly data: readonly UnlinkedCommitEntry[];
}

/**
 * Response with linkage filter options.
 */
export interface ResponseLinkageFilterOptions {
  readonly type: 'linkageFilterOptionsData';
  readonly data: LinkageFilterOptions;
}

/**
 * Error response sent when a data query fails.
 */
export interface LinkageResponseError {
  readonly type: 'linkageError';
  readonly message: string;
  readonly source: string;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type LinkageHostToWebview =
  | ResponseLinkageSummary
  | ResponseJiraProjectDistribution
  | ResponseJiraStatusFlow
  | ResponseAssignmentHistory
  | ResponseUnlinkedCommits
  | ResponseLinkageFilterOptions
  | LinkageResponseError;
