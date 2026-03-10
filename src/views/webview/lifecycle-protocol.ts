/**
 * Message protocol types for communication between the extension host
 * and the Ticket Lifecycle Sankey dashboard webview.
 *
 * Messages flow in two directions:
 * - LifecycleWebviewToHost: Messages sent from the webview to the extension
 * - LifecycleHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-905
 */

import type {
  SankeyData,
  TicketTransition,
  TransitionMatrixEntry,
  TicketType,
  StatusCategory,
  LifecycleFilters,
} from '../../services/ticket-lifecycle-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load Sankey chart data.
 * Optional filters for date range, ticket type, issue type, and assignee.
 */
export interface RequestSankeyData {
  readonly type: 'requestSankeyData';
  readonly filters?: LifecycleFilters;
}

/**
 * Request to load individual transition data.
 * Used for detailed transition analysis and drill-down.
 */
export interface RequestTransitionsData {
  readonly type: 'requestTransitionsData';
  readonly filters?: LifecycleFilters;
}

/**
 * Request to load transition matrix data.
 * Used for aggregated FROM -> TO analysis.
 */
export interface RequestMatrixData {
  readonly type: 'requestMatrixData';
  readonly filters?: LifecycleFilters;
}

/**
 * Request to refresh lifecycle data with current filters.
 * Used when user clicks refresh button or when auto-refresh triggers.
 */
export interface RequestLifecycleRefresh {
  readonly type: 'requestLifecycleRefresh';
  readonly filters?: LifecycleFilters;
}

/**
 * Request to update filters and reload data.
 * Used when user changes filter controls in the webview.
 */
export interface RequestFilterUpdate {
  readonly type: 'requestFilterUpdate';
  readonly filters: LifecycleFilters;
}

/**
 * Request to drill down into a specific status or transition.
 * Used when user clicks on a node or link in the Sankey diagram.
 */
export interface RequestDrillDown {
  readonly type: 'requestDrillDown';
  readonly drillDownType: 'status' | 'transition';
  /** Status name for status drill-down */
  readonly status?: string;
  /** Source status for transition drill-down */
  readonly fromStatus?: string;
  /** Target status for transition drill-down */
  readonly toStatus?: string;
  /** Current filters to apply */
  readonly filters?: LifecycleFilters;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type LifecycleWebviewToHost =
  | RequestSankeyData
  | RequestTransitionsData
  | RequestMatrixData
  | RequestLifecycleRefresh
  | RequestFilterUpdate
  | RequestDrillDown;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with Sankey chart data.
 */
export interface ResponseSankeyData {
  readonly type: 'sankeyData';
  readonly sankey: SankeyData;
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with individual transition data.
 */
export interface ResponseTransitionsData {
  readonly type: 'transitionsData';
  readonly transitions: readonly TicketTransition[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with transition matrix data.
 */
export interface ResponseMatrixData {
  readonly type: 'matrixData';
  readonly matrix: readonly TransitionMatrixEntry[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with drill-down data for a specific status.
 */
export interface ResponseStatusDrillDown {
  readonly type: 'statusDrillDown';
  readonly status: string;
  readonly category: StatusCategory;
  /** Transitions into this status */
  readonly incomingTransitions: readonly TransitionMatrixEntry[];
  /** Transitions out of this status */
  readonly outgoingTransitions: readonly TransitionMatrixEntry[];
  /** Average dwell time in this status */
  readonly avgDwellHours: number;
  /** Total tickets that reached this status */
  readonly ticketCount: number;
}

/**
 * Response with drill-down data for a specific transition.
 */
export interface ResponseTransitionDrillDown {
  readonly type: 'transitionDrillDown';
  readonly fromStatus: string;
  readonly toStatus: string;
  /** Individual tickets that followed this path */
  readonly tickets: readonly TicketTransition[];
  /** Is this a rework transition */
  readonly isRework: boolean;
}

/**
 * Error response sent when a data query fails.
 */
export interface LifecycleResponseError {
  readonly type: 'lifecycleError';
  readonly message: string;
  readonly source: string;
}

/**
 * Loading state notification.
 * Sent when data is being fetched.
 */
export interface LifecycleLoadingState {
  readonly type: 'lifecycleLoading';
  readonly isLoading: boolean;
}

/**
 * Filter options available for the dashboard.
 * Sent to populate filter dropdowns in the webview.
 */
export interface ResponseFilterOptions {
  readonly type: 'filterOptions';
  /** Available ticket types (jira, linear) */
  readonly ticketTypes: readonly TicketType[];
  /** Available issue types (Story, Bug, Task, etc.) */
  readonly issueTypes: readonly string[];
  /** Available assignees */
  readonly assignees: readonly string[];
  /** Available status names */
  readonly statuses: readonly string[];
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type LifecycleHostToWebview =
  | ResponseSankeyData
  | ResponseTransitionsData
  | ResponseMatrixData
  | ResponseStatusDrillDown
  | ResponseTransitionDrillDown
  | LifecycleResponseError
  | LifecycleLoadingState
  | ResponseFilterOptions;
