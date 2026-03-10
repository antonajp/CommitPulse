/**
 * Message protocol types for communication between the extension host
 * and the Architecture Drift Heat Map Dashboard webview.
 *
 * Messages flow in two directions:
 * - DriftWebviewToHost: Messages sent from the webview to the extension
 * - DriftHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-917
 */

import type {
  CrossComponentCommit,
  ArchitectureDrift,
  WeeklyDriftTrend,
  ComponentPairCoupling,
  DriftSummary,
  HeatMapData,
  DriftSeverity,
} from '../../services/architecture-drift-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load architecture drift data.
 * Optional repository, component, and date range filters.
 */
export interface RequestDriftData {
  readonly type: 'requestDriftData';
  readonly repository?: string;
  readonly component?: string;
  readonly minHeatIntensity?: number;
}

/**
 * Request to load cross-component commit data.
 * Optional repository, severity, date range, author, and team filters.
 */
export interface RequestCrossComponentData {
  readonly type: 'requestCrossComponentData';
  readonly repository?: string;
  readonly severity?: DriftSeverity;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly author?: string;
  readonly team?: string;
}

/**
 * Request to load weekly drift trend data.
 * Optional repository and component filters.
 */
export interface RequestWeeklyDriftTrend {
  readonly type: 'requestWeeklyDriftTrend';
  readonly repository?: string;
  readonly component?: string;
}

/**
 * Request to load component pair coupling data.
 * Optional repository and component filters.
 */
export interface RequestPairCouplingData {
  readonly type: 'requestPairCouplingData';
  readonly repository?: string;
  readonly component?: string;
}

/**
 * Request to load complete heat map chart data.
 * Fetches drift data, weekly trends, coupling data, and summary.
 */
export interface RequestHeatMapChartData {
  readonly type: 'requestHeatMapChartData';
  readonly repository?: string;
  readonly component?: string;
  readonly minHeatIntensity?: number;
}

/**
 * Request to refresh all drift data with current filters.
 * Used when user clicks refresh button or when auto-refresh triggers.
 */
export interface RequestDriftRefresh {
  readonly type: 'requestDriftRefresh';
}

/**
 * Request to drill down into a specific component's drift details.
 * Returns detailed drift data for that component.
 */
export interface RequestComponentDrilldown {
  readonly type: 'requestComponentDrilldown';
  readonly component: string;
  readonly repository?: string;
}

/**
 * Request to drill down into commits of a specific severity level.
 * Returns cross-component commits matching that severity.
 */
export interface RequestSeverityDrilldown {
  readonly type: 'requestSeverityDrilldown';
  readonly severity: DriftSeverity;
  readonly repository?: string;
}

/**
 * Request to show commits that created coupling between two components.
 * Returns cross-component commits touching both components.
 */
export interface RequestComponentPairCommits {
  readonly type: 'requestComponentPairCommits';
  readonly componentA: string;
  readonly componentB: string;
  readonly repository?: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type DriftWebviewToHost =
  | RequestDriftData
  | RequestCrossComponentData
  | RequestWeeklyDriftTrend
  | RequestPairCouplingData
  | RequestHeatMapChartData
  | RequestDriftRefresh
  | RequestComponentDrilldown
  | RequestSeverityDrilldown
  | RequestComponentPairCommits;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with architecture drift data.
 */
export interface ResponseDriftData {
  readonly type: 'driftData';
  readonly driftData: readonly ArchitectureDrift[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with cross-component commit data.
 */
export interface ResponseCrossComponentData {
  readonly type: 'crossComponentData';
  readonly commits: readonly CrossComponentCommit[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with weekly drift trend data.
 */
export interface ResponseWeeklyDriftTrend {
  readonly type: 'weeklyDriftTrend';
  readonly trends: readonly WeeklyDriftTrend[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with component pair coupling data.
 */
export interface ResponsePairCouplingData {
  readonly type: 'pairCouplingData';
  readonly couplings: readonly ComponentPairCoupling[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with complete heat map chart data.
 */
export interface ResponseHeatMapChartData {
  readonly type: 'heatMapChartData';
  readonly driftData: readonly ArchitectureDrift[];
  readonly heatMapData: HeatMapData;
  readonly couplingData: readonly ComponentPairCoupling[];
  readonly summary: DriftSummary;
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with drilldown data for a specific component.
 */
export interface ResponseComponentDrilldown {
  readonly type: 'componentDrilldown';
  readonly component: string;
  readonly drift: ArchitectureDrift | null;
  readonly commits: readonly CrossComponentCommit[];
  readonly couplings: readonly ComponentPairCoupling[];
}

/**
 * Response with drilldown data for a specific severity level.
 */
export interface ResponseSeverityDrilldown {
  readonly type: 'severityDrilldown';
  readonly severity: DriftSeverity;
  readonly commits: readonly CrossComponentCommit[];
}

/**
 * Response with commits creating coupling between two components.
 */
export interface ResponseComponentPairCommits {
  readonly type: 'componentPairCommits';
  readonly componentA: string;
  readonly componentB: string;
  readonly commits: readonly CrossComponentCommit[];
}

/**
 * Error response sent when a data query fails.
 */
export interface DriftResponseError {
  readonly type: 'driftError';
  readonly message: string;
  readonly source: string;
}

/**
 * Loading state notification.
 * Sent when data is being fetched.
 */
export interface DriftLoadingState {
  readonly type: 'driftLoading';
  readonly isLoading: boolean;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type DriftHostToWebview =
  | ResponseDriftData
  | ResponseCrossComponentData
  | ResponseWeeklyDriftTrend
  | ResponsePairCouplingData
  | ResponseHeatMapChartData
  | ResponseComponentDrilldown
  | ResponseSeverityDrilldown
  | ResponseComponentPairCommits
  | DriftResponseError
  | DriftLoadingState;
