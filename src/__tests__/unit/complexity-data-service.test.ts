import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { ComplexityDataService } from '../../services/complexity-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for ComplexityDataService (IQS-894).
 * Tests data queries for the Top Complex Files chart.
 */
describe('ComplexityDataService', () => {
  let mockDb: DatabaseService;
  let service: ComplexityDataService;

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

    service = new ComplexityDataService(mockDb);
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
    it('should create a ComplexityDataService instance', () => {
      expect(service).toBeDefined();
    });
  });

  // ==========================================================================
  // getTopComplexFiles
  // ==========================================================================
  describe('getTopComplexFiles', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getTopComplexFiles('individual');
      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return mapped complexity data grouped by individual', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { filename: 'src/app.ts', complexity: '150', contributor: 'Alice', team: 'Platform', loc: '500', percentage: '45.5' },
          { filename: 'src/app.ts', complexity: '150', contributor: 'Bob', team: 'Backend', loc: '600', percentage: '54.5' },
        ],
        rowCount: 2,
      });

      const result = await service.getTopComplexFiles('individual');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        filename: 'src/app.ts',
        complexity: 150,
        contributor: 'Alice',
        team: 'Platform',
        loc: 500,
        percentage: 45.5,
      });
      expect(result[1]).toEqual({
        filename: 'src/app.ts',
        complexity: 150,
        contributor: 'Bob',
        team: 'Backend',
        loc: 600,
        percentage: 54.5,
      });
    });

    it('should use team-specific SQL fragment when groupBy is team', async () => {
      await service.getTopComplexFiles('team');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      // Team query uses COALESCE(cc.team, 'Unassigned') as contributor
      expect(sql).toContain("COALESCE(cc.team, 'Unassigned') AS contributor");
    });

    it('should use individual-specific SQL fragment when groupBy is individual', async () => {
      await service.getTopComplexFiles('individual');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      // Individual query uses COALESCE(cc.full_name, ch.author)
      expect(sql).toContain('COALESCE(cc.full_name, ch.author) AS contributor');
    });

    it('should pass topN as first parameter', async () => {
      await service.getTopComplexFiles('individual', 15);

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe(15);
    });

    it('should clamp topN to minimum of 1', async () => {
      await service.getTopComplexFiles('individual', 0);

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe(1);
    });

    it('should clamp topN to maximum of 100', async () => {
      await service.getTopComplexFiles('individual', 200);

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe(100);
    });

    it('should use default topN of 20 for non-integer value', async () => {
      await service.getTopComplexFiles('individual', 15.5);

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe(20);
    });

    it('should pass date filters as parameterized values', async () => {
      await service.getTopComplexFiles('individual', 20, {
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
      await service.getTopComplexFiles('team', 20, { team: 'Platform' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain('Platform');
    });

    it('should pass repository filter as parameterized value', async () => {
      await service.getTopComplexFiles('individual', 20, { repository: 'my-app' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain('my-app');
    });

    it('should include LIMIT clause for result rows', async () => {
      await service.getTopComplexFiles('individual');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('LIMIT');
    });

    it('should exclude merge commits', async () => {
      await service.getTopComplexFiles('individual');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('is_merge = FALSE');
    });

    it('should handle NULL team in individual mode', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { filename: 'src/utils.ts', complexity: '50', contributor: 'Charlie', team: null, loc: '100', percentage: '100' },
        ],
        rowCount: 1,
      });

      const result = await service.getTopComplexFiles('individual');

      expect(result[0]?.team).toBeNull();
    });

    it('should propagate database query errors', async () => {
      vi.mocked(mockDb.query).mockRejectedValueOnce(new Error('Connection refused'));
      await expect(service.getTopComplexFiles('individual')).rejects.toThrow('Connection refused');
    });
  });

  // ==========================================================================
  // Input Validation
  // ==========================================================================
  describe('input validation', () => {

    // groupBy allowlist (CWE-89)
    describe('groupBy allowlist', () => {
      it('should accept "individual" groupBy', async () => {
        await service.getTopComplexFiles('individual');
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should accept "team" groupBy', async () => {
        await service.getTopComplexFiles('team');
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject invalid groupBy value', async () => {
        const invalidGroupBy = "'; DROP TABLE commit_files; --" as 'individual';
        await expect(service.getTopComplexFiles(invalidGroupBy)).rejects.toThrow('Invalid groupBy');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject empty string groupBy', async () => {
        const emptyGroupBy = '' as 'individual';
        await expect(service.getTopComplexFiles(emptyGroupBy)).rejects.toThrow('Invalid groupBy');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });

    // Date validation (CWE-20)
    describe('date validation', () => {
      it('should accept valid date strings', async () => {
        await service.getTopComplexFiles('individual', 20, {
          startDate: '2025-01-01',
          endDate: '2025-12-31',
        });
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject malformed startDate', async () => {
        await expect(service.getTopComplexFiles('individual', 20, {
          startDate: 'not-a-date',
        })).rejects.toThrow('Invalid startDate');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject malformed endDate', async () => {
        await expect(service.getTopComplexFiles('individual', 20, {
          endDate: '2025/13/45',
        })).rejects.toThrow('Invalid endDate');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject reversed date range', async () => {
        await expect(service.getTopComplexFiles('individual', 20, {
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
        await expect(service.getTopComplexFiles('individual', 20, {
          team: longTeam,
        })).rejects.toThrow('Team filter exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject repository filter exceeding 200 characters', async () => {
        const longRepo = 'B'.repeat(201);
        await expect(service.getTopComplexFiles('individual', 20, {
          repository: longRepo,
        })).rejects.toThrow('Repository filter exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });

    // Combined validation
    describe('combined validation', () => {
      it('should validate groupBy before filters', async () => {
        const badGroupBy = 'invalid' as 'individual';
        await expect(service.getTopComplexFiles(badGroupBy, 20, {
          startDate: '2025-01-01',
        })).rejects.toThrow('Invalid groupBy');
      });
    });
  });
});
