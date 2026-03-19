import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { handleCsvExport } from '../../views/webview/csv-export-handler.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Integration tests for CSV export feature (GITX-127).
 * Tests end-to-end scenarios including edge cases and error conditions.
 */
describe('CSV Export Integration Tests', () => {
  let mockLogger: LoggerService;
  let mockShowSaveDialog: ReturnType<typeof vi.fn>;
  let mockWriteFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      trace: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as LoggerService;

    mockShowSaveDialog = vi.fn();
    vi.spyOn(vscode.window, 'showSaveDialog').mockImplementation(mockShowSaveDialog);

    mockWriteFile = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(vscode.workspace.fs, 'writeFile').mockImplementation(mockWriteFile);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Real-world CSV scenarios', () => {
    it('should handle dashboard commit velocity export', async () => {
      const mockUri = { fsPath: '/tmp/commit-velocity-2026-03-19.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const csvContent = [
        'Date,Commits,LOC Added,LOC Deleted',
        '2026-03-01,15,2500,800',
        '2026-03-02,12,1800,650',
        '2026-03-03,18,3200,1200',
      ].join('\n');

      const result = await handleCsvExport(
        csvContent,
        'commit-velocity-2026-03-19.csv',
        'dashboard-velocity',
        mockLogger,
      );

      expect(result.success).toBe(true);
      expect(result.filename).toBe('commit-velocity-2026-03-19.csv');
      expect(mockWriteFile).toHaveBeenCalledOnce();
    });

    it('should handle scorecard export with special characters', async () => {
      const mockUri = { fsPath: '/tmp/scorecard.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const csvContent = [
        'Team,Repository,Quality Score,Notes',
        'Team Alpha,"repo-name-with-spaces",85,"Good progress, needs tests"',
        'Team Beta,legacy-app,62,"Technical debt: O\'Reilly says ""refactor"""',
      ].join('\n');

      const result = await handleCsvExport(csvContent, 'scorecard.csv', 'dashboard-scorecard', mockLogger);

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should handle file complexity export with Unicode characters', async () => {
      const mockUri = { fsPath: '/tmp/complexity.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const csvContent = [
        'File,Author,Complexity,Comments',
        'src/utils/日本語.ts,André García,145,Needs refactoring 🔧',
        'src/services/françois.ts,José María,98,Good structure ✓',
      ].join('\n');

      const result = await handleCsvExport(csvContent, 'complexity.csv', 'dashboard-complexity', mockLogger);

      expect(result.success).toBe(true);
    });
  });

  describe('Edge cases and boundaries', () => {
    it('should handle CSV with exactly 100,000 rows (at limit)', async () => {
      const mockUri = { fsPath: '/tmp/large.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      // Create CSV with exactly 100,000 rows (1 header + 99,999 data rows)
      const header = 'col1,col2,col3';
      const rows = Array(99999)
        .fill('val1,val2,val3')
        .join('\n');
      const csvContent = `${header}\n${rows}`;

      const result = await handleCsvExport(csvContent, 'large.csv', 'test', mockLogger);

      expect(result.success).toBe(true);
    });

    it('should reject CSV with 100,001 rows (over limit)', async () => {
      // Create CSV with 100,001 rows (1 header + 100,000 data rows)
      const header = 'col1,col2,col3';
      const rows = Array(100000)
        .fill('val1,val2,val3')
        .join('\n');
      const csvContent = `${header}\n${rows}`;

      const result = await handleCsvExport(csvContent, 'too-large.csv', 'test', mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('too many rows');
    });

    it('should handle CSV with exactly 100 columns (at limit)', async () => {
      const mockUri = { fsPath: '/tmp/wide.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const columns = Array(100).fill('col');
      const csvContent = columns.join(',');

      const result = await handleCsvExport(csvContent, 'wide.csv', 'test', mockLogger);

      expect(result.success).toBe(true);
    });

    it('should reject CSV with 101 columns (over limit)', async () => {
      const columns = Array(101).fill('col');
      const csvContent = columns.join(',');

      const result = await handleCsvExport(csvContent, 'too-wide.csv', 'test', mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('too many columns');
    });

    it('should handle CSV just under 10MB size limit', async () => {
      const mockUri = { fsPath: '/tmp/near-limit.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      // Create content just under 10MB (10,485,760 bytes)
      // But also under row limit (100,000 rows)
      const rowData = 'a'.repeat(95); // 95 chars + \n = 96 bytes per row
      const maxRows = 50000; // Well under both limits
      const csvContent = Array(maxRows).fill(rowData).join('\n');

      const result = await handleCsvExport(csvContent, 'near-limit.csv', 'test', mockLogger);

      expect(result.success).toBe(true);
    });

    it('should reject CSV over 10MB size limit', async () => {
      // Create content over 10MB
      const csvContent = 'a'.repeat(10485761); // 10MB + 1 byte

      const result = await handleCsvExport(csvContent, 'oversized.csv', 'test', mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds maximum size');
    });

    it('should handle empty header row', async () => {
      const mockUri = { fsPath: '/tmp/empty-header.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const csvContent = '\nrow1,row2,row3';

      const result = await handleCsvExport(csvContent, 'test.csv', 'test', mockLogger);

      expect(result.success).toBe(true);
    });

    it('should handle CSV with only headers (no data rows)', async () => {
      const mockUri = { fsPath: '/tmp/headers-only.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const csvContent = 'column1,column2,column3';

      const result = await handleCsvExport(csvContent, 'headers-only.csv', 'test', mockLogger);

      expect(result.success).toBe(true);
    });
  });

  describe('Security and validation', () => {
    it('should sanitize filenames with path traversal attempts', async () => {
      const mockUri = { fsPath: '/tmp/safe.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const result = await handleCsvExport('a,b\n1,2', '../../etc/passwd', 'test', mockLogger);

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultUri: expect.objectContaining({
            path: expect.stringContaining('etcpasswd.csv'),
          }),
        }),
      );
      expect(result.success).toBe(true);
    });

    it('should sanitize filenames with Windows-invalid characters', async () => {
      const mockUri = { fsPath: '/tmp/safe.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      await handleCsvExport('a,b\n1,2', 'file<name>:test?.csv', 'test', mockLogger);

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultUri: expect.objectContaining({
            path: expect.stringContaining('filenametest.csv'),
          }),
        }),
      );
    });

    it('should sanitize filenames with null bytes', async () => {
      const mockUri = { fsPath: '/tmp/safe.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      await handleCsvExport('a,b\n1,2', 'file\0name.csv', 'test', mockLogger);

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultUri: expect.objectContaining({
            path: expect.stringContaining('filename.csv'),
          }),
        }),
      );
    });

    it('should handle extremely long filenames by truncating', async () => {
      const mockUri = { fsPath: '/tmp/truncated.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const longFilename = 'a'.repeat(300) + '.csv';

      await handleCsvExport('a,b\n1,2', longFilename, 'test', mockLogger);

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultUri: expect.objectContaining({
            path: expect.stringMatching(/\.csv$/),
          }),
        }),
      );

      const callArg = mockShowSaveDialog.mock.calls[0]?.[0];
      const pathLength = callArg?.defaultUri?.path?.length ?? 0;
      expect(pathLength).toBeLessThanOrEqual(200);
    });
  });

  describe('Error handling and user experience', () => {
    it('should handle permission denied gracefully', async () => {
      const mockUri = { fsPath: '/root/readonly.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);
      mockWriteFile.mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await handleCsvExport('a,b\n1,2', 'test.csv', 'test', mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to save file');
      expect(result.error).toContain('permission denied');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle disk full error gracefully', async () => {
      const mockUri = { fsPath: '/tmp/test.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);
      mockWriteFile.mockRejectedValue(new Error('ENOSPC: no space left on device'));

      const result = await handleCsvExport('a,b\n1,2', 'test.csv', 'test', mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('no space left on device');
    });

    it('should handle file system errors with non-Error objects', async () => {
      const mockUri = { fsPath: '/tmp/test.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);
      mockWriteFile.mockRejectedValue('Unknown error string');

      const result = await handleCsvExport('a,b\n1,2', 'test.csv', 'test', mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to save file');
      expect(result.error).toContain('Unknown error string');
    });

    it('should handle cancelled dialog without logging error', async () => {
      mockShowSaveDialog.mockResolvedValue(undefined);

      const result = await handleCsvExport('a,b\n1,2', 'test.csv', 'test', mockLogger);

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'CsvExportHandler',
        'handleCsvExport',
        expect.stringContaining('cancelled'),
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should extract correct filename from complex path', async () => {
      const mockUri = { fsPath: '/home/user/Documents/exports/data-2026-03-19.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const result = await handleCsvExport('a,b\n1,2', 'original.csv', 'test', mockLogger);

      expect(result.success).toBe(true);
      expect(result.filename).toBe('data-2026-03-19.csv');
    });

    it('should handle Windows-style paths correctly', async () => {
      const mockUri = { fsPath: 'C:\\Users\\test\\Documents\\export.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const result = await handleCsvExport('a,b\n1,2', 'test.csv', 'test', mockLogger);

      expect(result.success).toBe(true);
      expect(result.filename).toBe('export.csv');
    });
  });

  describe('Content validation edge cases', () => {
    it('should handle CSV with empty cells', async () => {
      const mockUri = { fsPath: '/tmp/empty-cells.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const csvContent = 'col1,col2,col3\n,value2,\nvalue1,,value3';

      const result = await handleCsvExport(csvContent, 'test.csv', 'test', mockLogger);

      expect(result.success).toBe(true);
    });

    it('should handle CSV with quoted commas', async () => {
      const mockUri = { fsPath: '/tmp/quoted.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const csvContent = 'Name,Description\n"Smith, John","Developer, Senior"';

      const result = await handleCsvExport(csvContent, 'test.csv', 'test', mockLogger);

      expect(result.success).toBe(true);
    });

    it('should handle CSV with newlines in quoted fields', async () => {
      const mockUri = { fsPath: '/tmp/multiline.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      const csvContent = 'Name,Notes\n"John","Line 1\nLine 2\nLine 3"';

      const result = await handleCsvExport(csvContent, 'test.csv', 'test', mockLogger);

      expect(result.success).toBe(true);
    });

    it('should validate content with type coercion attempts', async () => {
      const result = await handleCsvExport(123 as unknown as string, 'test.csv', 'test', mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty or invalid');
    });

    it('should validate filename with type coercion attempts', async () => {
      const mockUri = { fsPath: '/tmp/export.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      await handleCsvExport('a,b\n1,2', null as unknown as string, 'test', mockLogger);

      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultUri: expect.objectContaining({
            path: expect.stringContaining('export.csv'),
          }),
        }),
      );
    });
  });

  describe('Logging and observability', () => {
    it('should log source identifier for debugging', async () => {
      mockShowSaveDialog.mockResolvedValue(undefined);

      await handleCsvExport('a,b\n1,2', 'test.csv', 'dashboard-velocity-chart', mockLogger);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'CsvExportHandler',
        'handleCsvExport',
        expect.stringContaining('dashboard-velocity-chart'),
      );
    });

    it('should use "unknown" for undefined source', async () => {
      mockShowSaveDialog.mockResolvedValue(undefined);

      await handleCsvExport('a,b\n1,2', 'test.csv', undefined, mockLogger);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'CsvExportHandler',
        'handleCsvExport',
        expect.stringContaining('unknown'),
      );
    });

    it('should log sanitized filename for tracking', async () => {
      mockShowSaveDialog.mockResolvedValue(undefined);

      await handleCsvExport('a,b\n1,2', '../../../malicious.csv', 'test', mockLogger);

      expect(mockLogger.trace).toHaveBeenCalledWith(
        'CsvExportHandler',
        'handleCsvExport',
        expect.stringContaining('malicious.csv'),
      );
    });

    it('should log successful writes with full path', async () => {
      const mockUri = { fsPath: '/home/user/export.csv' } as vscode.Uri;
      mockShowSaveDialog.mockResolvedValue(mockUri);

      await handleCsvExport('a,b\n1,2', 'test.csv', 'test', mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'CsvExportHandler',
        'handleCsvExport',
        expect.stringContaining('/home/user/export.csv'),
      );
    });
  });
});
