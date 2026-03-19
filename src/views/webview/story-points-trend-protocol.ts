/**
 * Message protocol types for communication between the extension host
 * and the Story Points Trend chart webview.
 *
 * Messages flow in two directions:
 * - StoryPointsTrendWebviewToHost: Messages sent from the webview to the extension
 * - StoryPointsTrendHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-940
 */

import type { StoryPointsTrendPoint } from '../../services/story-points-trend-data-types.js';
import type { SharedWebviewToHost, SharedHostToWebview } from './shared-protocol.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load story points trend chart data.
 * Optional date range and team filters may be provided.
 */
export interface RequestStoryPointsTrendData {
  readonly type: 'requestStoryPointsTrendData';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly team?: string;
  readonly daysBack?: number;
}

/**
 * Request to fetch available teams for the filter dropdown.
 */
export interface RequestStoryPointsTrendTeams {
  readonly type: 'requestStoryPointsTrendTeams';
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type StoryPointsTrendWebviewToHost =
  | RequestStoryPointsTrendData
  | RequestStoryPointsTrendTeams
  | SharedWebviewToHost;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with story points trend chart data.
 */
export interface ResponseStoryPointsTrendData {
  readonly type: 'storyPointsTrendData';
  readonly rows: readonly StoryPointsTrendPoint[];
  readonly hasData: boolean;
  readonly dataExists: boolean;
}

/**
 * Response with available teams for filter dropdown.
 */
export interface ResponseStoryPointsTrendTeams {
  readonly type: 'storyPointsTrendTeams';
  readonly teams: readonly string[];
}

/**
 * Error response sent when a data query fails.
 */
export interface StoryPointsTrendResponseError {
  readonly type: 'storyPointsTrendError';
  readonly message: string;
  readonly source: string;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type StoryPointsTrendHostToWebview =
  | ResponseStoryPointsTrendData
  | ResponseStoryPointsTrendTeams
  | StoryPointsTrendResponseError
  | SharedHostToWebview;
