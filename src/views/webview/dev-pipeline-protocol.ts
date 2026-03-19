/**
 * Message protocol types for communication between the extension host
 * and the Development Pipeline dashboard webview.
 *
 * Messages flow in two directions:
 * - DevPipelineWebviewToHost: Messages sent from the webview to the extension
 * - DevPipelineHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-896
 */

import type {
  DevPipelineDeltaPoint,
  DevPipelineDeltaByTicket,
  DevPipelineDeltaByAuthor,
} from '../../services/dev-pipeline-data-types.js';
import type { SharedWebviewToHost } from './shared-protocol.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load development pipeline delta data.
 * Optional date range, team, repository, and ticket filters may be provided.
 */
export interface RequestDevPipelineData {
  readonly type: 'requestDevPipelineData';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly team?: string;
  readonly repository?: string;
  readonly ticketId?: string;
}

/**
 * Request to load development pipeline data aggregated by ticket.
 */
export interface RequestDevPipelineByTicket {
  readonly type: 'requestDevPipelineByTicket';
  readonly startDate?: string;
  readonly endDate?: string;
}

/**
 * Request to load development pipeline data aggregated by author.
 */
export interface RequestDevPipelineByAuthor {
  readonly type: 'requestDevPipelineByAuthor';
  readonly startDate?: string;
  readonly endDate?: string;
}

/**
 * Request to check baseline population statistics.
 * Used to diagnose if baseline data is being populated correctly.
 */
export interface RequestBaselineStats {
  readonly type: 'requestBaselineStats';
}

/**
 * Request to load the list of available teams for the team filter.
 * IQS-929: Team filter is required for focused developer analysis.
 */
export interface RequestDevPipelineTeamList {
  readonly type: 'requestDevPipelineTeamList';
}

/**
 * Request to load weekly aggregated metrics by developer for a specific team.
 * IQS-929: Separate charts for LOC, Complexity, Comments Ratio, Tests.
 */
export interface RequestDevPipelineWeeklyMetrics {
  readonly type: 'requestDevPipelineWeeklyMetrics';
  readonly team: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type DevPipelineWebviewToHost =
  | RequestDevPipelineData
  | RequestDevPipelineByTicket
  | RequestDevPipelineByAuthor
  | RequestBaselineStats
  | RequestDevPipelineTeamList
  | RequestDevPipelineWeeklyMetrics
  | SharedWebviewToHost;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with development pipeline commit delta data.
 */
export interface ResponseDevPipelineData {
  readonly type: 'devPipelineData';
  readonly rows: readonly DevPipelineDeltaPoint[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with development pipeline data aggregated by ticket.
 */
export interface ResponseDevPipelineByTicket {
  readonly type: 'devPipelineByTicket';
  readonly rows: readonly DevPipelineDeltaByTicket[];
  readonly hasData: boolean;
}

/**
 * Response with development pipeline data aggregated by author.
 */
export interface ResponseDevPipelineByAuthor {
  readonly type: 'devPipelineByAuthor';
  readonly rows: readonly DevPipelineDeltaByAuthor[];
  readonly hasData: boolean;
}

/**
 * Response with baseline population statistics.
 */
export interface ResponseBaselineStats {
  readonly type: 'baselineStats';
  readonly totalCommits: number;
  readonly commitsWithBaseline: number;
  readonly baselineCoverageRatio: number | null;
}

/**
 * Error response sent when a data query fails.
 */
export interface DevPipelineResponseError {
  readonly type: 'devPipelineError';
  readonly message: string;
  readonly source: string;
}

/**
 * Response with the list of available teams for the team filter.
 * IQS-929: Teams extracted from commit_contributors table.
 */
export interface ResponseDevPipelineTeamList {
  readonly type: 'devPipelineTeamList';
  readonly teams: readonly string[];
}

/**
 * Response with weekly aggregated metrics by developer.
 * IQS-929: Used to render the 4 separate metric charts.
 */
export interface ResponseDevPipelineWeeklyMetrics {
  readonly type: 'devPipelineWeeklyMetrics';
  readonly data: readonly import('../../services/dev-pipeline-data-types.js').DevPipelineWeeklyDataPoint[];
  readonly error?: string;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type DevPipelineHostToWebview =
  | ResponseDevPipelineData
  | ResponseDevPipelineByTicket
  | ResponseDevPipelineByAuthor
  | ResponseBaselineStats
  | DevPipelineResponseError
  | ResponseDevPipelineTeamList
  | ResponseDevPipelineWeeklyMetrics;
