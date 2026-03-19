/**
 * Message protocol types for communication between the extension host
 * and the Sprint Velocity vs LOC chart webview.
 *
 * Messages flow in two directions:
 * - VelocityWebviewToHost: Messages sent from the webview to the extension
 * - VelocityHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-888, IQS-944, GITX-121
 */

import type { SprintVelocityVsLocPoint } from '../../services/velocity-data-types.js';
import type { SharedWebviewToHost, SharedHostToWebview } from './shared-protocol.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Aggregation period for velocity data.
 * - 'day': Daily aggregation
 * - 'week': Weekly aggregation (ISO week, Monday start) - default
 * - 'biweekly': Bi-weekly aggregation (2-week periods)
 *
 * Ticket: IQS-944
 */
export type VelocityAggregation = 'day' | 'week' | 'biweekly';

/**
 * Request to load sprint velocity vs LOC chart data.
 * Optional date range, team, team member, and repository filters may be provided.
 */
export interface RequestVelocityData {
  readonly type: 'requestVelocityData';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly team?: string;
  /**
   * Filter by team member (contributor login).
   * Ticket: GITX-121
   */
  readonly teamMember?: string;
  /** Filter by repository name (IQS-920) */
  readonly repository?: string;
  /**
   * Aggregation period: 'day', 'week' (default), or 'biweekly'.
   * Ticket: IQS-944
   */
  readonly aggregation?: VelocityAggregation;
}

/**
 * Request to load filter options for team, team member, and repository dropdowns.
 * Ticket: GITX-121
 */
export interface RequestFilterOptions {
  readonly type: 'requestFilterOptions';
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type VelocityWebviewToHost = RequestVelocityData | RequestFilterOptions | SharedWebviewToHost;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with sprint velocity vs LOC chart data.
 */
export interface ResponseVelocityData {
  readonly type: 'velocityData';
  readonly rows: readonly SprintVelocityVsLocPoint[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Error response sent when a data query fails.
 */
export interface VelocityResponseError {
  readonly type: 'velocityError';
  readonly message: string;
  readonly source: string;
}

/**
 * Response with filter options for team, team member, and repository dropdowns.
 * Ticket: GITX-121
 */
export interface ResponseFilterOptions {
  readonly type: 'filterOptions';
  /** Distinct team names from commit_contributors */
  readonly teams: readonly string[];
  /** Distinct contributor logins from commit_contributors */
  readonly teamMembers: readonly string[];
  /** Distinct repository names from commit_history */
  readonly repositories: readonly string[];
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type VelocityHostToWebview =
  | ResponseVelocityData
  | VelocityResponseError
  | ResponseFilterOptions
  | SharedHostToWebview;
