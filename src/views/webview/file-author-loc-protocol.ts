/**
 * Message protocol types for communication between the extension host
 * and the File Author LOC Contribution webview.
 *
 * Messages flow in two directions:
 * - FileAuthorLocWebviewToHost: Messages sent from the webview to the extension
 * - FileAuthorLocHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: GITX-128
 */

import type {
  FileAuthorLocRow,
  FileAuthorCommitDetail,
  TimeframePreset,
} from '../../services/file-author-loc-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load file author contribution data.
 * Requires file paths and optional date range.
 */
export interface RequestFileAuthorLocData {
  readonly type: 'requestFileAuthorLocData';
  readonly filePaths: readonly string[];
  readonly startDate?: string;
  readonly endDate?: string;
  readonly repository?: string;
  readonly timeframePreset?: TimeframePreset;
}

/**
 * Request drill-down commit details for a specific file and author.
 * Triggered when user clicks on a bar segment.
 */
export interface RequestFileAuthorDrillDown {
  readonly type: 'requestFileAuthorDrillDown';
  readonly filename: string;
  readonly author: string;
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * Request list of available repositories for filter dropdown.
 */
export interface RequestRepositories {
  readonly type: 'requestRepositories';
}

/**
 * Request to open a file in VS Code editor.
 */
export interface RequestOpenFile {
  readonly type: 'openFile';
  readonly filePath: string;
  readonly repository?: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type FileAuthorLocWebviewToHost =
  | RequestFileAuthorLocData
  | RequestFileAuthorDrillDown
  | RequestRepositories
  | RequestOpenFile;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with file author contribution data.
 */
export interface ResponseFileAuthorLocData {
  readonly type: 'fileAuthorLocData';
  readonly rows: readonly FileAuthorLocRow[];
  readonly hasData: boolean;
  readonly authors: readonly string[];
  readonly files: readonly string[];
  readonly dateRange: {
    readonly startDate: string;
    readonly endDate: string;
  };
}

/**
 * Response with drill-down commit details.
 */
export interface ResponseFileAuthorDrillDown {
  readonly type: 'fileAuthorDrillDownData';
  readonly commits: readonly FileAuthorCommitDetail[];
  readonly filename: string;
  readonly author: string;
}

/**
 * Response with available repositories.
 */
export interface ResponseRepositories {
  readonly type: 'repositories';
  readonly repositories: readonly string[];
}

/**
 * Error response sent when a data query fails.
 */
export interface FileAuthorLocResponseError {
  readonly type: 'fileAuthorLocError';
  readonly message: string;
  readonly source: string;
}

/**
 * Loading state notification.
 */
export interface FileAuthorLocLoadingState {
  readonly type: 'fileAuthorLocLoading';
  readonly isLoading: boolean;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type FileAuthorLocHostToWebview =
  | ResponseFileAuthorLocData
  | ResponseFileAuthorDrillDown
  | ResponseRepositories
  | FileAuthorLocResponseError
  | FileAuthorLocLoadingState;
