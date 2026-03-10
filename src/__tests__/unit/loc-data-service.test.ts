import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { LocDataService } from '../../services/loc-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for LocDataService (IQS-889).
 * Tests data queries for the LOC Committed chart.
 */
describe('LocDataService', () => {
  let mockDb: DatabaseService;
  let service: LocDataService;

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

    service = new LocDataService(mockDb);
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
    it('should create a LocDataService instance', () => {
      expect(service).toBeDefined();
    });
  });

  // ==========================================================================
  // getLocCommitted
  // ==========================================================================
  describe('getLocCommitted', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getLocCommitted('repository');
      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return mapped LOC data grouped by repository', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { group_key: 'my-app', arc_component: 'Back-End', lines_added: '1500', net_lines: '1200', total_churn: '1800' },
          { group_key: 'my-app', arc_component: 'Front-End', lines_added: '800', net_lines: '600', total_churn: '1000' },
        ],
        rowCount: 2,
      });

      const result = await service.getLocCommitted('repository');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        groupKey: 'my-app',
        arcComponent: 'Back-End',
        linesAdded: 1500,
        netLines: 1200,
        totalChurn: 1800,
      });
      expect(result[1]).toEqual({
        groupKey: 'my-app',
        arcComponent: 'Front-End',
        linesAdded: 800,
        netLines: 600,
        totalChurn: 1000,
      });
    });

    it('should use team-specific SQL fragment when groupBy is team', async () => {
      await service.getLocCommitted('team');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      // Team query uses COALESCE(cc.team, '(Unassigned)')
      expect(sql).toContain("COALESCE(cc.team, '(Unassigned)')");
    });

    it('should use author-specific SQL fragment when groupBy is author', async () => {
      await service.getLocCommitted('author');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      // Author query uses COALESCE(cc.full_name, ch.author)
      expect(sql).toContain('COALESCE(cc.full_name, ch.author)');
    });

    it('should use repository-specific SQL fragment when groupBy is repository', async () => {
      await service.getLocCommitted('repository');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('ch.repository AS group_key');
    });

    it('should pass date filters as parameterized values', async () => {
      await service.getLocCommitted('repository', {
        startDate: '2025-01-01',
        endDate: '2025-06-30',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(params).toContain('2025-01-01');
      expect(params).toContain('2025-06-30');
    });

    it('should pass team filter as parameterized value', async () => {
      await service.getLocCommitted('team', { team: 'Platform' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain('Platform');
    });

    it('should pass repository filter as parameterized value', async () => {
      await service.getLocCommitted('repository', { repository: 'my-app' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain('my-app');
    });

    it('should include LIMIT parameter from LOC_MAX_RESULT_ROWS', async () => {
      await service.getLocCommitted('repository');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).toContain('LIMIT');
      expect(params).toContain(5000);
    });

    it('should exclude merge commits to prevent double-counting LOC', async () => {
      await service.getLocCommitted('repository');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      // Must filter out merge commits (they re-count lines from merged branches)
      expect(sql).toContain('is_merge = FALSE');
    });

    it('should exclude dependency and build artifact directories from LOC calculations', async () => {
      await service.getLocCommitted('repository');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      // Must filter out dependency directories (they inflate metrics when committed)
      // JavaScript
      expect(sql).toContain("NOT LIKE 'node_modules/%'");
      expect(sql).toContain("NOT LIKE '%/node_modules/%'");
      expect(sql).toContain("NOT LIKE 'vendor/%'");
      expect(sql).toContain("NOT LIKE '.yarn/%'");
      expect(sql).toContain("NOT LIKE 'bower_components/%'");
      // Python
      expect(sql).toContain("NOT LIKE '__pycache__/%'");
      expect(sql).toContain("NOT LIKE '.venv/%'");
      expect(sql).toContain("NOT LIKE 'venv/%'");
      // Build artifacts
      expect(sql).toContain("NOT LIKE 'target/%'");
      expect(sql).toContain("NOT LIKE 'dist/%'");
      expect(sql).toContain("NOT LIKE 'build/%'");
      expect(sql).toContain("NOT LIKE 'bin/%'");
      expect(sql).toContain("NOT LIKE 'obj/%'");
    });

    it('should handle NULL arc_component as (Not Categorized)', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { group_key: 'my-app', arc_component: '(Not Categorized)', lines_added: '100', net_lines: '50', total_churn: '150' },
        ],
        rowCount: 1,
      });

      const result = await service.getLocCommitted('repository');

      expect(result[0]?.arcComponent).toBe('(Not Categorized)');
    });

    it('should handle negative net_lines values', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { group_key: 'legacy', arc_component: 'Back-End', lines_added: '100', net_lines: '-500', total_churn: '600' },
        ],
        rowCount: 1,
      });

      const result = await service.getLocCommitted('repository');

      expect(result[0]?.netLines).toBe(-500);
    });

    it('should propagate database query errors', async () => {
      vi.mocked(mockDb.query).mockRejectedValueOnce(new Error('Connection refused'));
      await expect(service.getLocCommitted('repository')).rejects.toThrow('Connection refused');
    });
  });

  // ==========================================================================
  // Input Validation
  // ==========================================================================
  describe('input validation', () => {

    // groupBy allowlist (CWE-89)
    describe('groupBy allowlist', () => {
      it('should accept "repository" groupBy', async () => {
        await service.getLocCommitted('repository');
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should accept "team" groupBy', async () => {
        await service.getLocCommitted('team');
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should accept "author" groupBy', async () => {
        await service.getLocCommitted('author');
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject invalid groupBy value', async () => {
        const invalidGroupBy = "'; DROP TABLE commit_files; --" as 'repository';
        await expect(service.getLocCommitted(invalidGroupBy)).rejects.toThrow('Invalid groupBy');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject empty string groupBy', async () => {
        const emptyGroupBy = '' as 'repository';
        await expect(service.getLocCommitted(emptyGroupBy)).rejects.toThrow('Invalid groupBy');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });

    // Date validation (CWE-20)
    describe('date validation', () => {
      it('should accept valid date strings', async () => {
        await service.getLocCommitted('repository', {
          startDate: '2025-01-01',
          endDate: '2025-12-31',
        });
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject malformed startDate', async () => {
        await expect(service.getLocCommitted('repository', {
          startDate: 'not-a-date',
        })).rejects.toThrow('Invalid startDate');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject malformed endDate', async () => {
        await expect(service.getLocCommitted('repository', {
          endDate: '2025/13/45',
        })).rejects.toThrow('Invalid endDate');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject reversed date range', async () => {
        await expect(service.getLocCommitted('repository', {
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
        await expect(service.getLocCommitted('repository', {
          team: longTeam,
        })).rejects.toThrow('Team filter exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject repository filter exceeding 200 characters', async () => {
        const longRepo = 'B'.repeat(201);
        await expect(service.getLocCommitted('repository', {
          repository: longRepo,
        })).rejects.toThrow('Repository filter exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });

    // Combined validation
    describe('combined validation', () => {
      it('should validate groupBy before filters', async () => {
        const badGroupBy = 'invalid' as 'repository';
        await expect(service.getLocCommitted(badGroupBy, {
          startDate: '2025-01-01',
        })).rejects.toThrow('Invalid groupBy');
      });
    });
  });
});
