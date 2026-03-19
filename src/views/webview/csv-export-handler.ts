/**
 * CSV export handler for webview panels.
 * Handles file save dialog and writes CSV content to disk.
 *
 * Security controls (GITX-127):
 * - Filename sanitization (CWE-22: Path Traversal)
 * - Data size validation (CWE-770: Resource Exhaustion)
 * - Rate limiting enforced by caller
 *
 * @module csv-export-handler
 */

import * as vscode from 'vscode';
import { LoggerService } from '../../logging/logger.js';
import type { ResponseExportCsvSuccess, ResponseExportCsvError } from './protocol.js';

/**
 * Maximum number of rows allowed in CSV export.
 * Prevents memory exhaustion from oversized exports.
 */
export const MAX_CSV_ROWS = 100_000;

/**
 * Maximum number of columns allowed in CSV export.
 */
export const MAX_CSV_COLUMNS = 100;

/**
 * Maximum total size of CSV content in bytes (10 MB).
 */
export const MAX_CSV_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Result of CSV export operation.
 */
export interface CsvExportResult {
  readonly success: boolean;
  readonly filePath?: string;
  readonly filename?: string;
  readonly error?: string;
  readonly cancelled?: boolean;
}

/**
 * Sanitize a filename to prevent path traversal attacks.
 * Removes path separators, null bytes, and ensures .csv extension.
 *
 * Security: CWE-22 Path Traversal prevention.
 *
 * @param filename - The raw filename from the webview
 * @returns Sanitized filename safe for file system use
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'export.csv';
  }

  // Remove path separators and dangerous characters
  let sanitized = filename
    .replace(/[/\\]/g, '') // Remove forward/backslash
    .replace(/\0/g, '') // Remove null bytes
    .replace(/\.\./g, '') // Remove parent directory references
    .replace(/[<>:"|?*]/g, '') // Remove Windows-invalid characters
    .trim();

  // Ensure non-empty
  if (!sanitized) {
    sanitized = 'export';
  }

  // Enforce .csv extension (remove any other extension first)
  if (!sanitized.toLowerCase().endsWith('.csv')) {
    // Remove any existing extension (handles trailing dots too)
    const lastDotIndex = sanitized.lastIndexOf('.');
    if (lastDotIndex > 0) {
      sanitized = sanitized.substring(0, lastDotIndex);
    }
    sanitized += '.csv';
  }

  // Limit length (200 to leave room for path; 255 is common filesystem max)
  const CSV_EXTENSION = '.csv';
  const MAX_FILENAME_LENGTH = 200;
  if (sanitized.length > MAX_FILENAME_LENGTH) {
    const maxBasenameLength = MAX_FILENAME_LENGTH - CSV_EXTENSION.length;
    // Remove extension before truncating, then add back
    const basename = sanitized.toLowerCase().endsWith(CSV_EXTENSION)
      ? sanitized.substring(0, sanitized.length - CSV_EXTENSION.length)
      : sanitized;
    sanitized = basename.substring(0, maxBasenameLength) + CSV_EXTENSION;
  }

  return sanitized;
}

/**
 * Count columns in a CSV line respecting RFC 4180 quoted fields.
 * Properly handles commas within quoted strings.
 *
 * @param line - A single CSV line to count columns in
 * @returns The number of columns (fields) in the line
 */
function countCsvColumns(line: string): number {
  if (!line || line.length === 0) {
    return 0;
  }

  let columns = 1; // Start with 1 because n commas = n+1 columns
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // Handle escaped quotes ("") inside quoted strings
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        i++; // Skip the next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      columns++;
    }
  }

  return columns;
}

/**
 * Validate CSV content for size and structure.
 *
 * Security: CWE-770 Resource Exhaustion prevention.
 *
 * @param csvContent - The CSV content to validate
 * @returns Object with valid flag and error message if invalid
 */
export function validateCsvContent(csvContent: string): { valid: boolean; error?: string } {
  if (!csvContent || typeof csvContent !== 'string') {
    return { valid: false, error: 'CSV content is empty or invalid' };
  }

  // Check total size
  const sizeBytes = new TextEncoder().encode(csvContent).length;
  if (sizeBytes > MAX_CSV_SIZE_BYTES) {
    return {
      valid: false,
      error: `CSV content exceeds maximum size (${Math.round(sizeBytes / 1024 / 1024)}MB > ${MAX_CSV_SIZE_BYTES / 1024 / 1024}MB)`,
    };
  }

  // Check row count (approximate by counting newlines)
  const rowCount = csvContent.split('\n').length;
  if (rowCount > MAX_CSV_ROWS) {
    return {
      valid: false,
      error: `CSV has too many rows (${rowCount.toLocaleString()} > ${MAX_CSV_ROWS.toLocaleString()})`,
    };
  }

  // Check column count on first line (RFC 4180-aware parsing)
  const firstLine = csvContent.split('\n')[0] ?? '';
  const columnCount = countCsvColumns(firstLine);
  if (columnCount > MAX_CSV_COLUMNS) {
    return {
      valid: false,
      error: `CSV has too many columns (${columnCount} > ${MAX_CSV_COLUMNS})`,
    };
  }

  return { valid: true };
}

/**
 * Handle CSV export request from webview.
 * Shows save dialog and writes content to selected location.
 *
 * @param csvContent - The CSV content to save
 * @param filename - Suggested filename (will be sanitized)
 * @param source - Optional source identifier for logging
 * @param logger - Logger instance for structured logging
 * @returns Export result with success/error information
 */
export async function handleCsvExport(
  csvContent: string,
  filename: string,
  source: string | undefined,
  logger: LoggerService,
): Promise<CsvExportResult> {
  const CLASS_NAME = 'CsvExportHandler';
  const METHOD_NAME = 'handleCsvExport';

  logger.debug(CLASS_NAME, METHOD_NAME, `Export request from source: ${source ?? 'unknown'}, filename: ${filename}`);

  // Validate content
  const validation = validateCsvContent(csvContent);
  if (!validation.valid) {
    logger.warn(CLASS_NAME, METHOD_NAME, `Validation failed: ${validation.error}`);
    return {
      success: false,
      error: validation.error,
    };
  }

  // Sanitize filename
  const sanitizedFilename = sanitizeFilename(filename);
  logger.trace(CLASS_NAME, METHOD_NAME, `Sanitized filename: ${sanitizedFilename}`);

  // Show save dialog
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(sanitizedFilename),
    filters: {
      'CSV Files': ['csv'],
      'All Files': ['*'],
    },
    saveLabel: 'Export CSV',
    title: 'Export Data to CSV',
  });

  // User cancelled
  if (!saveUri) {
    logger.debug(CLASS_NAME, METHOD_NAME, 'User cancelled save dialog');
    return {
      success: false,
      cancelled: true,
    };
  }

  try {
    // Write file using VS Code workspace API
    const content = new TextEncoder().encode(csvContent);
    await vscode.workspace.fs.writeFile(saveUri, content);

    const finalFilename = saveUri.fsPath.split(/[/\\]/).pop() ?? sanitizedFilename;
    logger.info(CLASS_NAME, METHOD_NAME, `CSV exported successfully: ${saveUri.fsPath}`);

    return {
      success: true,
      filePath: saveUri.fsPath,
      filename: finalFilename,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(CLASS_NAME, METHOD_NAME, `Failed to write CSV file: ${errorMsg}`);
    return {
      success: false,
      error: `Failed to save file: ${errorMsg}`,
    };
  }
}

/**
 * Create success response message for webview.
 *
 * @param result - The export result
 * @returns Response message to send to webview
 */
export function createSuccessResponse(result: CsvExportResult): ResponseExportCsvSuccess {
  return {
    type: 'exportCsvSuccess',
    filename: result.filename ?? 'export.csv',
    filePath: result.filePath ?? '',
  };
}

/**
 * Create error response message for webview.
 *
 * @param result - The export result
 * @returns Response message to send to webview
 */
export function createErrorResponse(result: CsvExportResult): ResponseExportCsvError {
  return {
    type: 'exportCsvError',
    message: result.error ?? 'Export failed',
    cancelled: result.cancelled ?? false,
  };
}
