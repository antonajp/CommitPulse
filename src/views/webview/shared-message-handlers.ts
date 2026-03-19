/**
 * Shared message handlers for webview panels.
 * Handles common message types that are shared across all panels:
 * - exportCsv: Export data as CSV file (GITX-127)
 * - openExternal: Open URL in external browser (IQS-925)
 *
 * Usage:
 * ```typescript
 * // In handleMessage, before the panel-specific switch:
 * if (handleSharedMessage(message, panel.webview, logger)) {
 *   return; // Message was handled by shared handler
 * }
 * // Proceed with panel-specific message handling...
 * ```
 *
 * @module shared-message-handlers
 */

import * as vscode from 'vscode';
import { LoggerService } from '../../logging/logger.js';
import {
  handleCsvExport,
  createSuccessResponse,
  createErrorResponse,
} from './csv-export-handler.js';

/**
 * Common message types handled by shared handlers.
 */
export interface SharedExportCsvMessage {
  readonly type: 'exportCsv';
  readonly csvContent: string;
  readonly filename: string;
  readonly source?: string;
}

export interface SharedOpenExternalMessage {
  readonly type: 'openExternal';
  readonly url: string;
}

export type SharedMessage = SharedExportCsvMessage | SharedOpenExternalMessage;

/**
 * Check if a message is a shared message type that can be handled by shared handlers.
 *
 * @param message - The message to check (with 'type' property)
 * @returns True if the message is a shared message type
 */
export function isSharedMessage(message: { type: string }): message is SharedMessage {
  return message.type === 'exportCsv' || message.type === 'openExternal';
}

/**
 * Handle shared message types that are common across all panels.
 *
 * @param message - The message to handle (must have 'type' property)
 * @param webview - The webview to post response messages to
 * @param logger - Logger instance for structured logging
 * @param className - Class name for logging context
 * @returns True if the message was handled, false if it should be processed by panel-specific handler
 */
export async function handleSharedMessage(
  message: { type: string },
  webview: vscode.Webview,
  logger: LoggerService,
  className: string,
): Promise<boolean> {
  const METHOD_NAME = 'handleSharedMessage';

  switch (message.type) {
    case 'exportCsv': {
      const exportMsg = message as SharedExportCsvMessage;
      logger.debug(className, METHOD_NAME, `CSV export request: ${exportMsg.filename}`);

      const result = await handleCsvExport(
        exportMsg.csvContent,
        exportMsg.filename,
        exportMsg.source,
        logger,
      );

      if (result.success) {
        void webview.postMessage(createSuccessResponse(result));
      } else {
        void webview.postMessage(createErrorResponse(result));
      }
      return true;
    }

    case 'openExternal': {
      const openMsg = message as SharedOpenExternalMessage;
      logger.debug(className, METHOD_NAME, `Open external URL: ${openMsg.url}`);

      try {
        const url = new URL(openMsg.url);
        // Only allow HTTPS for security
        if (url.protocol !== 'https:') {
          logger.warn(className, METHOD_NAME, `Blocked non-HTTPS URL: ${openMsg.url}`);
          return true;
        }
        await vscode.env.openExternal(vscode.Uri.parse(openMsg.url));
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(className, METHOD_NAME, `Failed to open external URL: ${errorMsg}`);
      }
      return true;
    }

    default:
      // Not a shared message, let panel-specific handler process it
      return false;
  }
}
