import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DashboardDataService } from '../../services/dashboard-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for DashboardDataService (IQS-869).
 * Tests data queries for the Metrics Dashboard webview.
 */
describe('DashboardDataService', () => {
  let mockDb: DatabaseService;
  let service: DashboardDataService;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Create mock DatabaseService
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockResolvedValue(true),
    } as unknown as DatabaseService;

    service = new DashboardDataService(mockDb);
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
    it('should create a DashboardDataService instance', () => {
      expect(service).toBeDefined();
    });
  });

  // ==========================================================================
  // getCommitVelocity (IQS-919: now returns LOC instead of commit counts)
  // ==========================================================================
  describe('getCommitVelocity', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getCommitVelocity('day');
      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return mapped LOC data for day granularity', async () => {
      // IQS-919: Mock returns loc_count (string from BIGINT) instead of commit_count
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { date: new Date('2025-01-15'), repository: 'app1', loc_count: '1500' },
          { date: new Date('2025-01-16'), repository: 'app1', loc_count: '2300' },
        ],
        rowCount: 2,
      });

      const result = await service.getCommitVelocity('day');

      expect(result).toHaveLength(2);
      // IQS-919: Property renamed from commitCount to locCount
      expect(result[0]).toEqual({
        date: '2025-01-15',
        repository: 'app1',
        locCount: 1500,
      });
      expect(result[1]).toEqual({
        date: '2025-01-16',
        repository: 'app1',
        locCount: 2300,
      });
    });

    it('should handle zero LOC when commit has no file changes', async () => {
      // IQS-919: Edge case - commit with no associated file changes
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { date: new Date('2025-01-15'), repository: 'app1', loc_count: '0' },
        ],
        rowCount: 1,
      });

      const result = await service.getCommitVelocity('day');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        date: '2025-01-15',
        repository: 'app1',
        locCount: 0,
      });
    });

    it('should handle large LOC values (over 1M)', async () => {
      // IQS-919: Edge case - week with > 1M LOC changed
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { date: new Date('2025-01-13'), repository: 'monorepo', loc_count: '1500000' },
        ],
        rowCount: 1,
      });

      const result = await service.getCommitVelocity('week');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        date: '2025-01-13',
        repository: 'monorepo',
        locCount: 1500000,
      });
    });

    it('should pass date range filters as parameterized values', async () => {
      await service.getCommitVelocity('week', {
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      // Check SQL uses parameterized placeholders
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain("'week'");
      expect(params).toEqual(['2025-01-01', '2025-01-31']);
    });

    it('should pass repository filter as parameterized value', async () => {
      await service.getCommitVelocity('day', { repository: 'my-app' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain('my-app');
    });

    it('should join commit_files table for LOC calculation', async () => {
      // IQS-919: Verify the SQL uses the correct join
      await service.getCommitVelocity('day');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      // Verify the SQL joins commit_files and sums LOC
      expect(sql).toContain('commit_files');
      expect(sql).toContain('line_inserts');
      expect(sql).toContain('line_deletes');
      expect(sql).toContain('loc_count');
    });
  });

  // ==========================================================================
  // getTechStackDistribution
  // ==========================================================================
  describe('getTechStackDistribution', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getTechStackDistribution();
      expect(result).toEqual([]);
    });

    it('should return mapped tech stack entries', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { category: 'Frontend', extension_count: 5, file_count: 120 },
          { category: 'Backend', extension_count: 3, file_count: 80 },
        ],
        rowCount: 2,
      });

      const result = await service.getTechStackDistribution();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        category: 'Frontend',
        extensionCount: 5,
        fileCount: 120,
      });
      expect(result[1]).toEqual({
        category: 'Backend',
        extensionCount: 3,
        fileCount: 80,
      });
    });
  });

  // ==========================================================================
  // getScorecard
  // ==========================================================================
  describe('getScorecard', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getScorecard();
      expect(result).toEqual([]);
    });

    it('should return mapped scorecard rows', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { full_name: 'Jane Doe', team: 'Platform', vendor: 'Acme', total_score: '145.50' },
        ],
        rowCount: 1,
      });

      const result = await service.getScorecard();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        fullName: 'Jane Doe',
        team: 'Platform',
        vendor: 'Acme',
        totalScore: 145.50,
      });
    });

    it('should filter by team when specified', async () => {
      await service.getScorecard({ team: 'Platform' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).toContain('$1');
      expect(params).toEqual(['Platform']);
    });
  });

  // ==========================================================================
  // getScorecardDetail
  // ==========================================================================
  describe('getScorecardDetail', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getScorecardDetail();
      expect(result).toEqual([]);
    });

    it('should return mapped detail rows', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            full_name: 'John Smith',
            team: 'Platform',
            vendor: 'Vendor',
            release_assist_score: '10.00',
            test_score: '35.00',
            complexity_score: '45.00',
            comments_score: '5.00',
            code_score: '20.00',
          },
        ],
        rowCount: 1,
      });

      const result = await service.getScorecardDetail();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        fullName: 'John Smith',
        team: 'Platform',
        vendor: 'Vendor',
        releaseAssistScore: 10.00,
        testScore: 35.00,
        complexityScore: 45.00,
        commentsScore: 5.00,
        codeScore: 20.00,
      });
    });
  });

  // ==========================================================================
  // getFileComplexityTrends
  // ==========================================================================
  describe('getFileComplexityTrends', () => {
    it('should return empty array when no files match', async () => {
      const result = await service.getFileComplexityTrends(10);

      expect(result).toEqual([]);
      // Only the first query (top files) should have been called
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should run two queries when files are found', async () => {
      // First query: top files
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({
          rows: [{ filename: 'src/app.ts' }, { filename: 'src/main.ts' }],
          rowCount: 2,
        })
        // Second query: detail for those files
        .mockResolvedValueOnce({
          rows: [
            {
              filename: 'src/app.ts',
              commit_date: new Date('2025-01-10'),
              complexity: 15,
              complexity_change: 3,
              category: 'Backend',
            },
            {
              filename: 'src/main.ts',
              commit_date: new Date('2025-01-12'),
              complexity: 8,
              complexity_change: -1,
              category: 'Backend',
            },
          ],
          rowCount: 2,
        });

      const result = await service.getFileComplexityTrends(2);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        filename: 'src/app.ts',
        commitDate: '2025-01-10',
        complexity: 15,
        complexityChange: 3,
        category: 'Backend',
      });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should apply date and team filters to both queries', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ filename: 'src/app.ts' }],
        rowCount: 1,
      }).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await service.getFileComplexityTrends(5, {
        startDate: '2025-01-01',
        endDate: '2025-06-30',
        team: 'Platform',
      });

      // Both queries should have been called
      expect(mockDb.query).toHaveBeenCalledTimes(2);

      // First query should have filter params
      const firstCall = vi.mocked(mockDb.query).mock.calls[0];
      expect(firstCall).toBeDefined();
      const firstParams = firstCall![1] as unknown[];
      expect(firstParams).toContain('2025-01-01');
      expect(firstParams).toContain('2025-06-30');
      expect(firstParams).toContain('Platform');
    });
  });

  // ==========================================================================
  // getFilterOptions
  // ==========================================================================
  describe('getFilterOptions', () => {
    it('should return empty teams and repos when no data', async () => {
      const result = await service.getFilterOptions();

      expect(result.teams).toEqual([]);
      expect(result.repositories).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should return mapped filter options', async () => {
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({
          rows: [{ team: 'Platform' }, { team: 'Product' }],
          rowCount: 2,
        })
        .mockResolvedValueOnce({
          rows: [{ repository: 'app1' }, { repository: 'app2' }],
          rowCount: 2,
        });

      const result = await service.getFilterOptions();

      expect(result.teams).toEqual(['Platform', 'Product']);
      expect(result.repositories).toEqual(['app1', 'app2']);
    });
  });

  // ==========================================================================
  // Error handling
  // ==========================================================================
  describe('error handling', () => {
    it('should propagate database query errors', async () => {
      vi.mocked(mockDb.query).mockRejectedValueOnce(new Error('Connection refused'));

      await expect(service.getCommitVelocity('day')).rejects.toThrow('Connection refused');
    });
  });

  // ==========================================================================
  // Input Validation (IQS-890)
  // ==========================================================================
  describe('input validation (IQS-890)', () => {

    // ----------------------------------------------------------------------
    // Granularity allowlist (CWE-89: SQL Injection prevention)
    // ----------------------------------------------------------------------
    describe('granularity allowlist', () => {
      it('should accept "day" granularity', async () => {
        await service.getCommitVelocity('day');
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should accept "week" granularity', async () => {
        await service.getCommitVelocity('week');
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject invalid granularity value', async () => {
        // Force an invalid value past TypeScript type guard
        const invalidGranularity = "'; DROP TABLE commit_history; --" as 'day';
        await expect(service.getCommitVelocity(invalidGranularity)).rejects.toThrow('Invalid granularity');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject empty string granularity', async () => {
        const emptyGranularity = '' as 'day';
        await expect(service.getCommitVelocity(emptyGranularity)).rejects.toThrow('Invalid granularity');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });

    // ----------------------------------------------------------------------
    // Date validation (CWE-20: Input validation)
    // ----------------------------------------------------------------------
    describe('date validation', () => {
      it('should accept valid date strings', async () => {
        await service.getCommitVelocity('day', {
          startDate: '2025-01-01',
          endDate: '2025-12-31',
        });
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject malformed startDate', async () => {
        await expect(service.getCommitVelocity('day', {
          startDate: 'not-a-date',
        })).rejects.toThrow('Invalid startDate');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject malformed endDate', async () => {
        await expect(service.getCommitVelocity('day', {
          endDate: '2025/13/45',
        })).rejects.toThrow('Invalid endDate');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject impossible date (Feb 30)', async () => {
        await expect(service.getCommitVelocity('day', {
          startDate: '2025-02-30',
        })).rejects.toThrow('Invalid startDate');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject date outside valid range (too old)', async () => {
        await expect(service.getCommitVelocity('day', {
          startDate: '1900-01-01',
        })).rejects.toThrow('Invalid startDate');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject reversed date range (startDate > endDate)', async () => {
        await expect(service.getCommitVelocity('day', {
          startDate: '2025-12-31',
          endDate: '2025-01-01',
        })).rejects.toThrow('Invalid date range');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should accept same startDate and endDate', async () => {
        await service.getCommitVelocity('day', {
          startDate: '2025-06-15',
          endDate: '2025-06-15',
        });
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      // Validate date checks apply to all query methods
      it('should validate dates in getScorecard', async () => {
        await expect(service.getScorecard({
          startDate: 'invalid',
        })).rejects.toThrow('Invalid startDate');
      });

      it('should validate dates in getScorecardDetail', async () => {
        await expect(service.getScorecardDetail({
          endDate: 'bad-date',
        })).rejects.toThrow('Invalid endDate');
      });

      it('should validate dates in getFileComplexityTrends', async () => {
        await expect(service.getFileComplexityTrends(10, {
          startDate: '2025-13-01',
        })).rejects.toThrow('Invalid startDate');
      });

      it('should validate date ordering in getFileComplexityTrends', async () => {
        await expect(service.getFileComplexityTrends(10, {
          startDate: '2025-06-30',
          endDate: '2025-01-01',
        })).rejects.toThrow('Invalid date range');
      });
    });

    // ----------------------------------------------------------------------
    // Filter string validation (CWE-20: Input validation)
    // ----------------------------------------------------------------------
    describe('filter string validation', () => {
      it('should accept team filter within length limit', async () => {
        await service.getScorecard({ team: 'Platform' });
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject team filter exceeding 200 characters', async () => {
        const longTeam = 'A'.repeat(201);
        await expect(service.getScorecard({
          team: longTeam,
        })).rejects.toThrow('Team filter exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should accept team filter at exactly 200 characters', async () => {
        const maxTeam = 'A'.repeat(200);
        await service.getScorecard({ team: maxTeam });
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject repository filter exceeding 200 characters', async () => {
        const longRepo = 'B'.repeat(201);
        await expect(service.getCommitVelocity('day', {
          repository: longRepo,
        })).rejects.toThrow('Repository filter exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should accept repository filter at exactly 200 characters', async () => {
        const maxRepo = 'B'.repeat(200);
        await service.getCommitVelocity('day', { repository: maxRepo });
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject oversized team filter in getScorecardDetail', async () => {
        const longTeam = 'X'.repeat(201);
        await expect(service.getScorecardDetail({
          team: longTeam,
        })).rejects.toThrow('Team filter exceeds maximum length');
      });

      it('should reject oversized team filter in getFileComplexityTrends', async () => {
        const longTeam = 'Y'.repeat(201);
        await expect(service.getFileComplexityTrends(10, {
          team: longTeam,
        })).rejects.toThrow('Team filter exceeds maximum length');
      });
    });

    // ----------------------------------------------------------------------
    // Combined validation checks
    // ----------------------------------------------------------------------
    describe('combined validation', () => {
      it('should validate granularity before filters', async () => {
        // Invalid granularity should be caught even with valid filters
        const badGranularity = 'month' as 'day';
        await expect(service.getCommitVelocity(badGranularity, {
          startDate: '2025-01-01',
          endDate: '2025-12-31',
        })).rejects.toThrow('Invalid granularity');
      });

      it('should validate all filter fields together', async () => {
        // First invalid field should trigger error
        await expect(service.getCommitVelocity('day', {
          startDate: 'bad',
          endDate: '2025-12-31',
          team: 'Platform',
          repository: 'my-app',
        })).rejects.toThrow('Invalid startDate');
      });
    });
  });
});
