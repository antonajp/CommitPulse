import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSuccessResponse, createErrorResponse } from '../../views/webview/csv-export-handler.js';
import type { CsvExportResult } from '../../views/webview/csv-export-handler.js';

/**
 * Unit tests for CSV export webview response handlers (GITX-127).
 * Tests message creation for success/error scenarios.
 */
describe('CSV Export Webview Response Handlers', () => {
  describe('createSuccessResponse', () => {
    it('should create success response with all fields', () => {
      const result: CsvExportResult = {
        success: true,
        filePath: '/home/user/Documents/export-2026-03-19.csv',
        filename: 'export-2026-03-19.csv',
      };

      const response = createSuccessResponse(result);

      expect(response).toEqual({
        type: 'exportCsvSuccess',
        filename: 'export-2026-03-19.csv',
        filePath: '/home/user/Documents/export-2026-03-19.csv',
      });
    });

    it('should use default filename when missing', () => {
      const result: CsvExportResult = {
        success: true,
        filePath: '/tmp/test.csv',
      };

      const response = createSuccessResponse(result);

      expect(response.filename).toBe('export.csv');
      expect(response.filePath).toBe('/tmp/test.csv');
    });

    it('should use empty filePath when missing', () => {
      const result: CsvExportResult = {
        success: true,
        filename: 'data.csv',
      };

      const response = createSuccessResponse(result);

      expect(response.filename).toBe('data.csv');
      expect(response.filePath).toBe('');
    });

    it('should handle both fields missing', () => {
      const result: CsvExportResult = {
        success: true,
      };

      const response = createSuccessResponse(result);

      expect(response.type).toBe('exportCsvSuccess');
      expect(response.filename).toBe('export.csv');
      expect(response.filePath).toBe('');
    });

    it('should preserve special characters in filename', () => {
      const result: CsvExportResult = {
        success: true,
        filename: 'data-2026-03-19_final.csv',
        filePath: '/home/user/data-2026-03-19_final.csv',
      };

      const response = createSuccessResponse(result);

      expect(response.filename).toBe('data-2026-03-19_final.csv');
    });

    it('should preserve Windows paths', () => {
      const result: CsvExportResult = {
        success: true,
        filename: 'export.csv',
        filePath: 'C:\\Users\\test\\Documents\\export.csv',
      };

      const response = createSuccessResponse(result);

      expect(response.filePath).toBe('C:\\Users\\test\\Documents\\export.csv');
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response with message', () => {
      const result: CsvExportResult = {
        success: false,
        error: 'Failed to save file: Permission denied',
      };

      const response = createErrorResponse(result);

      expect(response).toEqual({
        type: 'exportCsvError',
        message: 'Failed to save file: Permission denied',
        cancelled: false,
      });
    });

    it('should indicate cancellation', () => {
      const result: CsvExportResult = {
        success: false,
        cancelled: true,
      };

      const response = createErrorResponse(result);

      expect(response.type).toBe('exportCsvError');
      expect(response.cancelled).toBe(true);
      expect(response.message).toBe('Export failed');
    });

    it('should use default message when error missing', () => {
      const result: CsvExportResult = {
        success: false,
      };

      const response = createErrorResponse(result);

      expect(response.message).toBe('Export failed');
      expect(response.cancelled).toBe(false);
    });

    it('should handle validation errors', () => {
      const result: CsvExportResult = {
        success: false,
        error: 'CSV content exceeds maximum size (12MB > 10MB)',
      };

      const response = createErrorResponse(result);

      expect(response.type).toBe('exportCsvError');
      expect(response.message).toContain('exceeds maximum size');
      expect(response.cancelled).toBe(false);
    });

    it('should handle file system errors', () => {
      const result: CsvExportResult = {
        success: false,
        error: 'Failed to save file: ENOSPC: no space left on device',
      };

      const response = createErrorResponse(result);

      expect(response.message).toContain('no space left on device');
      expect(response.cancelled).toBe(false);
    });

    it('should handle cancelled flag with error message (edge case)', () => {
      const result: CsvExportResult = {
        success: false,
        error: 'User cancelled operation',
        cancelled: true,
      };

      const response = createErrorResponse(result);

      expect(response.message).toBe('User cancelled operation');
      expect(response.cancelled).toBe(true);
    });
  });

  describe('Response type safety', () => {
    it('should create response with readonly type field', () => {
      const result: CsvExportResult = {
        success: true,
        filename: 'test.csv',
      };

      const response = createSuccessResponse(result);

      // TypeScript compile-time check: type should be readonly
      // @ts-expect-error - type field should be readonly
      response.type = 'invalid';
    });

    it('should create error response with readonly type field', () => {
      const result: CsvExportResult = {
        success: false,
        error: 'Test error',
      };

      const response = createErrorResponse(result);

      // TypeScript compile-time check: type field should be readonly
      // @ts-expect-error - type field should be readonly
      response.type = 'invalid';
    });
  });

  describe('Webview message handling simulation', () => {
    it('should simulate success message flow', () => {
      // Simulate webview receiving success message
      const mockWebview = {
        postMessage: vi.fn(),
      };

      const result: CsvExportResult = {
        success: true,
        filename: 'dashboard-export.csv',
        filePath: '/home/user/dashboard-export.csv',
      };

      const response = createSuccessResponse(result);
      mockWebview.postMessage(response);

      expect(mockWebview.postMessage).toHaveBeenCalledWith({
        type: 'exportCsvSuccess',
        filename: 'dashboard-export.csv',
        filePath: '/home/user/dashboard-export.csv',
      });
    });

    it('should simulate error message flow', () => {
      const mockWebview = {
        postMessage: vi.fn(),
      };

      const result: CsvExportResult = {
        success: false,
        error: 'CSV has too many rows (150,000 > 100,000)',
      };

      const response = createErrorResponse(result);
      mockWebview.postMessage(response);

      expect(mockWebview.postMessage).toHaveBeenCalledWith({
        type: 'exportCsvError',
        message: 'CSV has too many rows (150,000 > 100,000)',
        cancelled: false,
      });
    });

    it('should simulate cancellation message flow', () => {
      const mockWebview = {
        postMessage: vi.fn(),
      };

      const result: CsvExportResult = {
        success: false,
        cancelled: true,
      };

      const response = createErrorResponse(result);
      mockWebview.postMessage(response);

      expect(mockWebview.postMessage).toHaveBeenCalledWith({
        type: 'exportCsvError',
        message: 'Export failed',
        cancelled: true,
      });
    });
  });

  describe('Toast notification integration', () => {
    it('should provide message suitable for success toast', () => {
      const result: CsvExportResult = {
        success: true,
        filename: 'velocity-data.csv',
        filePath: '/tmp/velocity-data.csv',
      };

      const response = createSuccessResponse(result);

      // Webview would call: showExportSuccess(response.filename)
      const toastMessage = `Exported to ${response.filename}`;
      expect(toastMessage).toBe('Exported to velocity-data.csv');
    });

    it('should provide message suitable for error toast', () => {
      const result: CsvExportResult = {
        success: false,
        error: 'CSV content exceeds maximum size (15MB > 10MB)',
      };

      const response = createErrorResponse(result);

      // Webview would call: showExportError(response.message)
      expect(response.message).toContain('exceeds maximum size');
    });

    it('should not trigger toast for cancellation', () => {
      const result: CsvExportResult = {
        success: false,
        cancelled: true,
      };

      const response = createErrorResponse(result);

      // Webview checks: if (!response.cancelled) { showExportError(...) }
      expect(response.cancelled).toBe(true);
      // No toast should be shown for user-initiated cancellation
    });
  });
});
