/**
 * Message protocol types for communication between the extension host
 * and the Metrics Dashboard webview.
 *
 * Messages flow in two directions:
 * - WebviewToHost: Messages sent from the webview to the extension
 * - HostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-869
 */

import type {
  CommitVelocityPoint,
  VelocityGranularity,
  TechStackEntry,
  ScorecardRow,
  ScorecardDetailRow,
  FileComplexityPoint,
  DashboardFilters,
  FilterOptions,
  LocCommittedPoint,
  LocGroupBy,
  TopComplexFilePoint,
  ComplexityGroupBy,
  FileChurnPoint,
  FileChurnCommitDetail,
  FileChurnGroupBy,
} from '../../services/dashboard-data-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load commit velocity data.
 */
export interface RequestCommitVelocity {
  readonly type: 'requestCommitVelocity';
  readonly granularity: VelocityGranularity;
  readonly filters: DashboardFilters;
}

/**
 * Request to load technology stack distribution data.
 */
export interface RequestTechStack {
  readonly type: 'requestTechStack';
}

/**
 * Request to load scorecard data.
 */
export interface RequestScorecard {
  readonly type: 'requestScorecard';
  readonly filters: DashboardFilters;
}

/**
 * Request to load scorecard detail data.
 */
export interface RequestScorecardDetail {
  readonly type: 'requestScorecardDetail';
  readonly filters: DashboardFilters;
}

/**
 * Request to load file complexity trends data.
 */
export interface RequestFileComplexity {
  readonly type: 'requestFileComplexity';
  readonly topN: number;
  readonly filters: DashboardFilters;
}

/**
 * Request to load LOC committed data (IQS-889).
 * Grouped by repository, team, or author with optional filters.
 */
export interface RequestLocCommitted {
  readonly type: 'requestLocCommitted';
  readonly groupBy: LocGroupBy;
  readonly filters: DashboardFilters;
}

/**
 * Request to load filter options (teams, repositories).
 */
export interface RequestFilterOptions {
  readonly type: 'requestFilterOptions';
}

/**
 * Request to load top complex files data (IQS-894).
 * Horizontal stacked bar chart showing contributor/team LOC breakdown.
 */
export interface RequestTopComplexFiles {
  readonly type: 'requestTopComplexFiles';
  readonly groupBy: ComplexityGroupBy;
  readonly topN: number;
  readonly filters: DashboardFilters;
}

/**
 * Request to load top files by churn data (IQS-895).
 * Horizontal stacked bar chart showing churn by team/contributor.
 */
export interface RequestFileChurn {
  readonly type: 'requestFileChurn';
  readonly groupBy: FileChurnGroupBy;
  readonly topN: number;
  readonly filters: DashboardFilters;
}

/**
 * Request drill-down data for a file churn bar segment (IQS-895).
 * Returns list of commits for the selected file + team/contributor.
 */
export interface RequestFileChurnDrillDown {
  readonly type: 'requestFileChurnDrillDown';
  readonly filename: string;
  readonly contributor: string;
  readonly groupBy: FileChurnGroupBy;
  readonly filters: DashboardFilters;
}

/**
 * Request team list for Developer Pipeline filter dropdown (IQS-929).
 */
export interface RequestDevPipelineTeamList {
  readonly type: 'requestDevPipelineTeamList';
}

/**
 * Request weekly metrics for Developer Pipeline charts (IQS-929).
 * Requires mandatory team filter. Date range is optional.
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
export type WebviewToHost =
  | RequestCommitVelocity
  | RequestTechStack
  | RequestScorecard
  | RequestScorecardDetail
  | RequestFileComplexity
  | RequestLocCommitted
  | RequestFilterOptions
  | RequestTopComplexFiles
  | RequestFileChurn
  | RequestFileChurnDrillDown
  | RequestDevPipelineTeamList
  | RequestDevPipelineWeeklyMetrics;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with commit velocity data.
 */
export interface ResponseCommitVelocity {
  readonly type: 'commitVelocityData';
  readonly data: readonly CommitVelocityPoint[];
  readonly granularity: VelocityGranularity;
}

/**
 * Response with technology stack distribution data.
 */
export interface ResponseTechStack {
  readonly type: 'techStackData';
  readonly data: readonly TechStackEntry[];
}

/**
 * Response with scorecard data.
 */
export interface ResponseScorecard {
  readonly type: 'scorecardData';
  readonly data: readonly ScorecardRow[];
}

/**
 * Response with scorecard detail data.
 */
export interface ResponseScorecardDetail {
  readonly type: 'scorecardDetailData';
  readonly data: readonly ScorecardDetailRow[];
}

/**
 * Response with file complexity trends data.
 */
export interface ResponseFileComplexity {
  readonly type: 'fileComplexityData';
  readonly data: readonly FileComplexityPoint[];
}

/**
 * Response with LOC committed data (IQS-889).
 */
export interface ResponseLocCommitted {
  readonly type: 'locCommittedData';
  readonly data: readonly LocCommittedPoint[];
  readonly groupBy: LocGroupBy;
}

/**
 * Response with filter options.
 */
export interface ResponseFilterOptions {
  readonly type: 'filterOptionsData';
  readonly data: FilterOptions;
}

/**
 * Error response sent when a data query fails.
 */
export interface ResponseError {
  readonly type: 'error';
  readonly message: string;
  readonly source: string;
}

/**
 * Response with top complex files data (IQS-894).
 */
export interface ResponseTopComplexFiles {
  readonly type: 'topComplexFilesData';
  readonly data: readonly TopComplexFilePoint[];
  readonly groupBy: ComplexityGroupBy;
}

/**
 * Response with top files by churn data (IQS-895).
 */
export interface ResponseFileChurn {
  readonly type: 'fileChurnData';
  readonly data: readonly FileChurnPoint[];
  readonly groupBy: FileChurnGroupBy;
}

/**
 * Response with drill-down commit details for file churn (IQS-895).
 */
export interface ResponseFileChurnDrillDown {
  readonly type: 'fileChurnDrillDownData';
  readonly data: readonly FileChurnCommitDetail[];
  readonly filename: string;
  readonly contributor: string;
}

/**
 * Weekly metric data point for Developer Pipeline (IQS-929).
 * Aggregates metrics by week and author.
 */
export interface DevPipelineWeeklyDataPoint {
  readonly weekStart: string; // YYYY-MM-DD (Monday of the week)
  readonly author: string;
  readonly fullName: string | null;
  readonly locDelta: number;
  readonly complexityDelta: number;
  readonly commentsDelta: number;
  readonly testsDelta: number;
  readonly commentsRatio: number | null; // comment_lines / total_lines * 100
  readonly commitCount: number;
}

/**
 * Response with Developer Pipeline team list (IQS-929).
 */
export interface ResponseDevPipelineTeamList {
  readonly type: 'devPipelineTeamList';
  readonly teams: readonly string[];
}

/**
 * Response with Developer Pipeline weekly metrics (IQS-929).
 */
export interface ResponseDevPipelineWeeklyMetrics {
  readonly type: 'devPipelineWeeklyMetrics';
  readonly data: readonly DevPipelineWeeklyDataPoint[];
  readonly error?: string;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type HostToWebview =
  | ResponseCommitVelocity
  | ResponseTechStack
  | ResponseScorecard
  | ResponseScorecardDetail
  | ResponseFileComplexity
  | ResponseLocCommitted
  | ResponseFilterOptions
  | ResponseTopComplexFiles
  | ResponseFileChurn
  | ResponseFileChurnDrillDown
  | ResponseDevPipelineTeamList
  | ResponseDevPipelineWeeklyMetrics
  | ResponseError;
