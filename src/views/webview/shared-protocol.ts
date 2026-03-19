/**
 * Shared message protocol types for communication between extension host
 * and webview panels.
 *
 * These types are used across all panels for common functionality:
 * - CSV export (GITX-127)
 * - External URL opening (IQS-925)
 *
 * Usage in panel protocol files:
 * ```typescript
 * import type { SharedWebviewToHost, SharedHostToWebview } from './shared-protocol.js';
 *
 * export type MyPanelWebviewToHost = MyRequest1 | MyRequest2 | SharedWebviewToHost;
 * export type MyPanelHostToWebview = MyResponse1 | MyResponse2 | SharedHostToWebview;
 * ```
 *
 * @module shared-protocol
 */

// ============================================================================
// Webview -> Extension (Shared Requests)
// ============================================================================

/**
 * Request to export data as CSV file (GITX-127).
 * Webview sends CSV content to extension host for file save dialog.
 * This works around VS Code webview CSP restrictions that prevent Blob URLs.
 */
export interface RequestExportCsv {
  readonly type: 'exportCsv';
  /** The CSV content to save (already escaped per RFC 4180 + formula sanitization) */
  readonly csvContent: string;
  /** Suggested filename (will be sanitized by extension host) */
  readonly filename: string;
  /** Optional identifier for the source chart/table for logging */
  readonly source?: string;
}

/**
 * Request to open an external URL in the browser (IQS-925).
 * Webview sends URL to extension host for validation and opening.
 */
export interface RequestOpenExternal {
  readonly type: 'openExternal';
  readonly url: string;
}

/**
 * Union type of all shared request messages from webview to extension.
 */
export type SharedWebviewToHost = RequestExportCsv | RequestOpenExternal;

// ============================================================================
// Extension -> Webview (Shared Responses)
// ============================================================================

/**
 * Response indicating CSV export succeeded (GITX-127).
 * Sent after file is written to disk.
 */
export interface ResponseExportCsvSuccess {
  readonly type: 'exportCsvSuccess';
  /** The filename that was saved (sanitized) */
  readonly filename: string;
  /** Full path where file was saved (for logging/debugging) */
  readonly filePath: string;
}

/**
 * Response indicating CSV export failed (GITX-127).
 * Sent when save dialog is cancelled or file write fails.
 */
export interface ResponseExportCsvError {
  readonly type: 'exportCsvError';
  /** Error message to display to user */
  readonly message: string;
  /** Whether user cancelled (not a true error) */
  readonly cancelled: boolean;
}

/**
 * Union type of all shared response messages from extension to webview.
 */
export type SharedHostToWebview = ResponseExportCsvSuccess | ResponseExportCsvError;
