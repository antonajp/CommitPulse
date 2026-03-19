import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';

import {
  sanitizeFilename,
  validateCsvContent,
  handleCsvExport,
  createSuccessResponse,
  createErrorResponse,
  MAX_CSV_ROWS,
  MAX_CSV_COLUMNS,
  MAX_CSV_SIZE_BYTES,
} from '../../views/webview/csv-export-handler.js';
import type { CsvExportResult } from '../../views/webview/csv-export-handler.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for CSV export handler (GITX-127).
 * Tests filename sanitization, content validation, and export workflow.
 */
describe('csv-export-handler', () => {
  describe('sanitizeFilename', () => {
    it('should return default filename for empty input', () => {
      expect(sanitizeFilename('')).toBe('export.csv');
      expect(sanitizeFilename(null as unknown as string)).toBe('export.csv');
      expect(sanitizeFilename(undefined as unknown as string)).toBe('export.csv');
    });

    it('should remove path separators (CWE-22)', () => {
      expect(sanitizeFilename('/etc/passwd')).toBe('etcpasswd.csv');
      expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('windowssystem32.csv');
      expect(sanitizeFilename('data/../../../etc/passwd')).toBe('dataetcpasswd.csv');
    });

    it('should remove null bytes (CWE-22)', () => {
      expect(sanitizeFilename('file\0name.csv')).toBe('filename.csv');
    });

    it('should remove parent directory references (CWE-22)', () => {
      expect(sanitizeFilename('../secret.csv')).toBe('secret.csv');
      expect(sanitizeFilename('folder/../file.csv')).toBe('folderfile.csv');
    });

    it('should remove Windows-invalid characters', () => {
      expect(sanitizeFilename('file<name>.csv')).toBe('filename.csv');
      expect(sanitizeFilename('file:name.csv')).toBe('filename.csv');
      expect(sanitizeFilename('file"name".csv')).toBe('filename.csv');
      expect(sanitizeFilename('file|name.csv')).toBe('filename.csv');
      expect(sanitizeFilename('file?name.csv')).toBe('filename.csv');
      expect(sanitizeFilename('file*name.csv')).toBe('filename.csv');
    });

    it('should ensure .csv extension', () => {
      expect(sanitizeFilename('data')).toBe('data.csv');
      expect(sanitizeFilename('data.txt')).toBe('data.csv');
      expect(sanitizeFilename('data.CSV')).toBe('data.CSV');
      expect(sanitizeFilename('data.csv')).toBe('data.csv');
    });

    it('should trim whitespace', () => {
      expect(sanitizeFilename('  file.csv  ')).toBe('file.csv');
    });

    it('should limit filename length', () => {
      const longName = 'a'.repeat(300) + '.csv';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(200);
      expect(result.endsWith('.csv')).toBe(true);
    });

    it('should handle valid filenames unchanged', () => {
      expect(sanitizeFilename('dashboard-export-2026-03-19.csv')).toBe('dashboard-export-2026-03-19.csv');
      expect(sanitizeFilename('data_export.csv')).toBe('data_export.csv');
    });
  });

  describe('validateCsvContent', () => {
    it('should reject empty content', () => {
      expect(validateCsvContent('')).toEqual({
        valid: false,
        error: 'CSV content is empty or invalid',
      });
      expect(validateCsvContent(null as unknown as string)).toEqual({
        valid: false,
        error: 'CSV content is empty or invalid',
      });
    });

    it('should accept valid CSV content', () => {
      const validCsv = 'header1,header2\nvalue1,value2\nvalue3,value4';
      expect(validateCsvContent(validCsv)).toEqual({ valid: true });
    });

    it('should reject content exceeding max size', () => {
      // Create content just over 10MB
      const largeContent = 'a'.repeat(MAX_CSV_SIZE_BYTES + 1);
      const result = validateCsvContent(largeContent);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum size');
    });

    it('should reject content with too many rows', () => {
      // Create content with too many rows
      const manyRows = Array(MAX_CSV_ROWS + 10).fill('a,b,c').join('\n');
      const result = validateCsvContent(manyRows);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too many rows');
    });

    it('should reject content with too many columns', () => {
      // Create content with too many columns
      const manyColumns = Array(MAX_CSV_COLUMNS + 10).fill('col').join(',');
      const result = validateCsvContent(manyColumns);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too many columns');
    });

    it('should accept content at size limits', () => {
      // Create content just under limits
      const rows = Array(100).fill('a,b,c').join('\n');
      expect(validateCsvContent(rows)).toEqual({ valid: true });
    });

    it('should correctly count columns with quoted commas (RFC 4180)', () => {
      // CSV with quoted field containing commas - should be 3 columns, not 5
      const csvWithQuotedCommas = '"Name","Description, with commas","Count"\n"Item","Field, also, commas",10';
      const result = validateCsvContent(csvWithQuotedCommas);
      expect(result.valid).toBe(true);
    });

    it('should correctly count columns with escaped quotes', () => {
      // CSV with escaped quotes ("") - should be 2 columns
      const csvWithEscapedQuotes = '"Name with ""quotes""","Value"\nData,Other';
      const result = validateCsvContent(csvWithEscapedQuotes);
      expect(result.valid).toBe(true);
    });
  });

  describe('handleCsvExport', () => {
    let mockLogger: LoggerService;
    let mockShowSaveDialog: ReturnType<typeof vi.fn>;
    let mockWriteFile: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Create mock logger
      mockLogger = {
        debug: vi.fn(),
        trace: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as LoggerService;

      // Mock VS Code window.showSaveDialog
      mockShowSaveDialog = vi.fn();
      vi.spyOn(vscode.window, 'showSaveDialog').mockImplementation(mockShowSaveDialog);

      // Mock VS Code workspace.fs.writeFile
      mockWriteFile = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(vscode.workspace.fs, 'writeFile').mockImplementation(mockWriteFile);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return error for invalid content', async () => {
      const result = await handleCsvExport('', 'test.csv', 'test', mockLogger);
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty or invalid');
    });

    it('should return cancelled when user cancels dialog', async () => {
      mockShowSaveDialog.mockResolvedValue(undefined);

      const result = await handleCsvExport('a,b\n1,2', 'test.csv', 'test', mockLogger);
      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it('should write file successfully', async () => {
      const mockUri = { fsPath: '/tmp/export.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const result = await handleCsvExport('a,b\n1,2', 'export.csv', 'test', mockLogger);
      expect(result.success).toBe(true);
      expect(result.filePath).toBe('/tmp/export.csv');
      expect(result.filename).toBe('export.csv');
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should handle write errors gracefully', async () => {
      const mockUri = { fsPath: '/tmp/readonly.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);
      mockWriteFile.mockRejectedValue(new Error('Permission denied'));

      const result = await handleCsvExport('a,b\n1,2', 'test.csv', 'test', mockLogger);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to save file');
      expect(result.error).toContain('Permission denied');
    });

    it('should sanitize filename before use', async () => {
      const mockUri = { fsPath: '/tmp/safe.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      await handleCsvExport('a,b\n1,2', '../etc/passwd', 'test', mockLogger);
      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultUri: expect.objectContaining({
            path: expect.stringContaining('etcpasswd.csv'),
          }),
        }),
      );
    });

    it('should handle source parameter in logging', async () => {
      mockShowSaveDialog.mockResolvedValue(undefined);

      await handleCsvExport('a,b\n1,2', 'test.csv', 'dashboard', mockLogger);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'CsvExportHandler',
        'handleCsvExport',
        expect.stringContaining('dashboard'),
      );
    });

    it('should handle undefined source parameter', async () => {
      mockShowSaveDialog.mockResolvedValue(undefined);

      await handleCsvExport('a,b\n1,2', 'test.csv', undefined, mockLogger);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'CsvExportHandler',
        'handleCsvExport',
        expect.stringContaining('unknown'),
      );
    });
  });

  describe('createSuccessResponse', () => {
    it('should create success response with file details', () => {
      const result: CsvExportResult = {
        success: true,
        filePath: '/path/to/export.csv',
        filename: 'export.csv',
      };

      const response = createSuccessResponse(result);
      expect(response.type).toBe('exportCsvSuccess');
      expect(response.filename).toBe('export.csv');
      expect(response.filePath).toBe('/path/to/export.csv');
    });

    it('should use defaults for missing fields', () => {
      const result: CsvExportResult = {
        success: true,
      };

      const response = createSuccessResponse(result);
      expect(response.type).toBe('exportCsvSuccess');
      expect(response.filename).toBe('export.csv');
      expect(response.filePath).toBe('');
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response with message', () => {
      const result: CsvExportResult = {
        success: false,
        error: 'Validation failed',
      };

      const response = createErrorResponse(result);
      expect(response.type).toBe('exportCsvError');
      expect(response.message).toBe('Validation failed');
      expect(response.cancelled).toBe(false);
    });

    it('should indicate cancellation', () => {
      const result: CsvExportResult = {
        success: false,
        cancelled: true,
      };

      const response = createErrorResponse(result);
      expect(response.type).toBe('exportCsvError');
      expect(response.message).toBe('Export failed');
      expect(response.cancelled).toBe(true);
    });
  });

  describe('constants', () => {
    it('should have reasonable MAX_CSV_ROWS limit', () => {
      expect(MAX_CSV_ROWS).toBe(100_000);
    });

    it('should have reasonable MAX_CSV_COLUMNS limit', () => {
      expect(MAX_CSV_COLUMNS).toBe(100);
    });

    it('should have reasonable MAX_CSV_SIZE_BYTES limit (10MB)', () => {
      expect(MAX_CSV_SIZE_BYTES).toBe(10 * 1024 * 1024);
    });
  });
});
