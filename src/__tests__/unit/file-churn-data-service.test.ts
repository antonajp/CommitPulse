import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { FileChurnDataService } from '../../services/file-churn-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for FileChurnDataService (IQS-895).
 * Tests data queries for the Top Files by Churn chart.
 */
describe('FileChurnDataService', () => {
  let mockDb: DatabaseService;
  let service: FileChurnDataService;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockResolvedValue(true),
    } as unknown as DatabaseService;

    service = new FileChurnDataService(mockDb);
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================
  describe('constructor', () => {
    it('should create a FileChurnDataService instance', () => {
      expect(service).toBeDefined();
    });
  });

  // ==========================================================================
  // getTopFilesByChurn
  // ==========================================================================
  describe('getTopFilesByChurn', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getTopFilesByChurn('team');
      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return mapped churn data grouped by team', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { filename: 'src/app.ts', total_churn: '1500', contributor: 'Platform', team: null, churn: '800', percentage: '53.3' },
          { filename: 'src/app.ts', total_churn: '1500', contributor: 'Backend', team: null, churn: '700', percentage: '46.7' },
        ],
        rowCount: 2,
      });

      const result = await service.getTopFilesByChurn('team');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        filename: 'src/app.ts',
        totalChurn: 1500,
        contributor: 'Platform',
        team: null,
        churn: 800,
        percentage: 53.3,
      });
      expect(result[1]).toEqual({
        filename: 'src/app.ts',
        totalChurn: 1500,
        contributor: 'Backend',
        team: null,
        churn: 700,
        percentage: 46.7,
      });
    });

    it('should return mapped churn data grouped by individual', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { filename: 'src/utils.ts', total_churn: '500', contributor: 'Alice', team: 'Platform', churn: '300', percentage: '60' },
          { filename: 'src/utils.ts', total_churn: '500', contributor: 'Bob', team: 'Backend', churn: '200', percentage: '40' },
        ],
        rowCount: 2,
      });

      const result = await service.getTopFilesByChurn('individual');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        filename: 'src/utils.ts',
        totalChurn: 500,
        contributor: 'Alice',
        team: 'Platform',
        churn: 300,
        percentage: 60,
      });
    });

    it('should use team-specific SQL fragment when groupBy is team', async () => {
      await service.getTopFilesByChurn('team');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      // Team query uses COALESCE(cc.team, '(Unassigned)') as contributor
      expect(sql).toContain("COALESCE(cc.team, '(Unassigned)') AS contributor");
    });

    it('should use individual-specific SQL fragment when groupBy is individual', async () => {
      await service.getTopFilesByChurn('individual');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      // Individual query uses COALESCE(cc.full_name, ch.author)
      expect(sql).toContain('COALESCE(cc.full_name, ch.author) AS contributor');
    });

    it('should pass topN as first parameter', async () => {
      await service.getTopFilesByChurn('team', 15);

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe(15);
    });

    it('should clamp topN to minimum of 1', async () => {
      await service.getTopFilesByChurn('team', 0);

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe(1);
    });

    it('should clamp topN to maximum of 100', async () => {
      await service.getTopFilesByChurn('team', 200);

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe(100);
    });

    it('should use default topN of 20 for non-integer value', async () => {
      await service.getTopFilesByChurn('team', 15.5);

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe(20);
    });

    it('should pass date filters as parameterized values', async () => {
      await service.getTopFilesByChurn('team', 20, {
        startDate: '2025-01-01',
        endDate: '2025-06-30',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).toContain('$2');
      expect(sql).toContain('$3');
      expect(params).toContain('2025-01-01');
      expect(params).toContain('2025-06-30');
    });

    it('should pass team filter as parameterized value', async () => {
      await service.getTopFilesByChurn('team', 20, { team: 'Platform' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain('Platform');
    });

    it('should pass repository filter as parameterized value', async () => {
      await service.getTopFilesByChurn('individual', 20, { repository: 'my-app' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain('my-app');
    });

    it('should include LIMIT clause for result rows', async () => {
      await service.getTopFilesByChurn('team');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('LIMIT');
    });

    it('should exclude merge commits', async () => {
      await service.getTopFilesByChurn('team');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('is_merge = FALSE');
    });

    it('should exclude node_modules directories', async () => {
      await service.getTopFilesByChurn('team');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain("filename NOT LIKE 'node_modules/%'");
    });

    it('should propagate database query errors', async () => {
      vi.mocked(mockDb.query).mockRejectedValueOnce(new Error('Connection refused'));
      await expect(service.getTopFilesByChurn('team')).rejects.toThrow('Connection refused');
    });
  });

  // ==========================================================================
  // getFileChurnDrilldown
  // ==========================================================================
  describe('getFileChurnDrilldown', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getFileChurnDrilldown('src/app.ts', 'Platform', 'team');
      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return mapped commit details', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { sha: 'abc1234567890', commit_date: '2025-03-01', author: 'alice', message: 'Fix bug in parser', lines_added: '50', lines_deleted: '20' },
        ],
        rowCount: 1,
      });

      const result = await service.getFileChurnDrilldown('src/app.ts', 'Platform', 'team');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        sha: 'abc1234567890',
        commitDate: '2025-03-01',
        author: 'alice',
        message: 'Fix bug in parser',
        linesAdded: 50,
        linesDeleted: 20,
      });
    });

    it('should pass filename and contributor as parameters', async () => {
      await service.getFileChurnDrilldown('src/utils.ts', 'Backend', 'team');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe('src/utils.ts');
      expect(params[1]).toBe('Backend');
    });

    it('should use team-specific SQL for team groupBy', async () => {
      await service.getFileChurnDrilldown('src/app.ts', 'Platform', 'team');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain("COALESCE(cc.team, '(Unassigned)') = $2");
    });

    it('should use individual-specific SQL for individual groupBy', async () => {
      await service.getFileChurnDrilldown('src/app.ts', 'Alice', 'individual');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('COALESCE(cc.full_name, ch.author) = $2');
    });

    it('should pass date filters as parameterized values', async () => {
      await service.getFileChurnDrilldown('src/app.ts', 'Platform', 'team', {
        startDate: '2025-01-01',
        endDate: '2025-06-30',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain('2025-01-01');
      expect(params).toContain('2025-06-30');
    });

    it('should include ORDER BY and LIMIT', async () => {
      await service.getFileChurnDrilldown('src/app.ts', 'Platform', 'team');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('ORDER BY ch.commit_date DESC');
      expect(sql).toContain('LIMIT 100');
    });
  });

  // ==========================================================================
  // Input Validation
  // ==========================================================================
  describe('input validation', () => {

    // groupBy allowlist (CWE-89)
    describe('groupBy allowlist', () => {
      it('should accept "team" groupBy', async () => {
        await service.getTopFilesByChurn('team');
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should accept "individual" groupBy', async () => {
        await service.getTopFilesByChurn('individual');
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject invalid groupBy value', async () => {
        const invalidGroupBy = "'; DROP TABLE commit_files; --" as 'team';
        await expect(service.getTopFilesByChurn(invalidGroupBy)).rejects.toThrow('Invalid groupBy');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject empty string groupBy', async () => {
        const emptyGroupBy = '' as 'team';
        await expect(service.getTopFilesByChurn(emptyGroupBy)).rejects.toThrow('Invalid groupBy');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });

    // Date validation (CWE-20)
    describe('date validation', () => {
      it('should accept valid date strings', async () => {
        await service.getTopFilesByChurn('team', 20, {
          startDate: '2025-01-01',
          endDate: '2025-12-31',
        });
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject malformed startDate', async () => {
        await expect(service.getTopFilesByChurn('team', 20, {
          startDate: 'not-a-date',
        })).rejects.toThrow('Invalid startDate');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject malformed endDate', async () => {
        await expect(service.getTopFilesByChurn('team', 20, {
          endDate: '2025/13/45',
        })).rejects.toThrow('Invalid endDate');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject reversed date range', async () => {
        await expect(service.getTopFilesByChurn('team', 20, {
          startDate: '2025-12-31',
          endDate: '2025-01-01',
        })).rejects.toThrow('Invalid date range');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });

    // Filter string validation (CWE-20)
    describe('filter string validation', () => {
      it('should reject team filter exceeding 200 characters', async () => {
        const longTeam = 'A'.repeat(201);
        await expect(service.getTopFilesByChurn('team', 20, {
          team: longTeam,
        })).rejects.toThrow('Team filter exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject repository filter exceeding 200 characters', async () => {
        const longRepo = 'B'.repeat(201);
        await expect(service.getTopFilesByChurn('team', 20, {
          repository: longRepo,
        })).rejects.toThrow('Repository filter exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });

    // Drilldown input validation
    describe('drilldown input validation', () => {
      it('should reject filename exceeding 500 characters', async () => {
        const longFilename = 'a'.repeat(501);
        await expect(service.getFileChurnDrilldown(longFilename, 'Team', 'team'))
          .rejects.toThrow('Filename exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject contributor exceeding 200 characters', async () => {
        const longContributor = 'a'.repeat(201);
        await expect(service.getFileChurnDrilldown('src/app.ts', longContributor, 'team'))
          .rejects.toThrow('Contributor exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject invalid groupBy in drilldown', async () => {
        const invalidGroupBy = 'invalid' as 'team';
        await expect(service.getFileChurnDrilldown('src/app.ts', 'Team', invalidGroupBy))
          .rejects.toThrow('Invalid groupBy');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });

    // Combined validation
    describe('combined validation', () => {
      it('should validate groupBy before filters', async () => {
        const badGroupBy = 'invalid' as 'team';
        await expect(service.getTopFilesByChurn(badGroupBy, 20, {
          startDate: '2025-01-01',
        })).rejects.toThrow('Invalid groupBy');
      });
    });
  });
});
