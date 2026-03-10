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
 * Ticket: IQS-888
 */

import type { SprintVelocityVsLocPoint } from '../../services/velocity-data-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load sprint velocity vs LOC chart data.
 * Optional date range, team, and repository filters may be provided.
 */
export interface RequestVelocityData {
  readonly type: 'requestVelocityData';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly team?: string;
  /** Filter by repository name (IQS-920) */
  readonly repository?: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type VelocityWebviewToHost = RequestVelocityData;

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
 * Union type of all messages sent from the extension host to the webview.
 */
export type VelocityHostToWebview =
  | ResponseVelocityData
  | VelocityResponseError;
