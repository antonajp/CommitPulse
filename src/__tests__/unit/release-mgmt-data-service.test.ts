import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { ReleaseManagementDataService } from '../../services/release-mgmt-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for ReleaseManagementDataService
 * Tests data service methods with mock database.
 *
 * Ticket: IQS-898
 */
describe('ReleaseManagementDataService', () => {
  let mockDb: DatabaseService;
  let service: ReleaseManagementDataService;

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

    service = new ReleaseManagementDataService(mockDb);
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // checkViewExists
  // ==========================================================================
  describe('checkViewExists', () => {
    it('should return true when view exists', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const result = await service.checkViewExists();

      expect(result).toBe(true);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return false when view does not exist', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty result', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // getReleaseContributions - Happy path
  // ==========================================================================
  describe('getReleaseContributions (happy path)', () => {
    it('should return empty array when no contributions found', async () => {
      const result = await service.getReleaseContributions();

      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return contributions mapped to camelCase', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            author: 'alice',
            full_name: 'Alice Smith',
            team: 'Platform',
            repository: 'frontend',
            environment: 'Production',
            merge_count: 5,
            tag_count: 2,
          },
          {
            author: 'bob',
            full_name: 'Bob Jones',
            team: 'Backend',
            repository: 'api',
            environment: 'Staging',
            merge_count: 8,
            tag_count: 0,
          },
        ],
        rowCount: 2,
      });

      const result = await service.getReleaseContributions();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        author: 'alice',
        fullName: 'Alice Smith',
        team: 'Platform',
        repository: 'frontend',
        environment: 'Production',
        mergeCount: 5,
        tagCount: 2,
      });
      expect(result[1]).toEqual({
        author: 'bob',
        fullName: 'Bob Jones',
        team: 'Backend',
        repository: 'api',
        environment: 'Staging',
        mergeCount: 8,
        tagCount: 0,
      });
    });

    it('should use parameterized queries (CWE-89 prevention)', async () => {
      await service.getReleaseContributions({
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      // Verify parameterized placeholders
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(params[0]).toBe('2025-01-01');
      expect(params[1]).toBe('2025-01-31');
    });
  });

  // ==========================================================================
  // getReleaseContributions - Filters
  // ==========================================================================
  describe('getReleaseContributions (filters)', () => {
    it('should apply team filter', async () => {
      await service.getReleaseContributions({ team: 'Platform' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];

      expect(params).toContain('Platform');
    });

    it('should apply repository filter', async () => {
      await service.getReleaseContributions({ repository: 'frontend' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];

      expect(params).toContain('frontend');
    });

    it('should apply default 30-day range when no dates provided', async () => {
      const beforeCall = new Date();
      await service.getReleaseContributions();

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];

      const startDate = new Date(params[0] as string);
      const endDate = new Date(params[1] as string);

      // Start date should be approximately 30 days before end date
      const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThanOrEqual(29.9);
      expect(daysDiff).toBeLessThanOrEqual(30.1);

      // End date should be approximately now
      expect(endDate.getTime()).toBeLessThanOrEqual(beforeCall.getTime() + 1000);
    });
  });

  // ==========================================================================
  // Input validation (CWE-20)
  // ==========================================================================
  describe('input validation', () => {
    it('should reject invalid startDate format', async () => {
      await expect(service.getReleaseContributions({
        startDate: 'not-a-date',
      })).rejects.toThrow('Invalid start date format');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should reject invalid endDate format', async () => {
      await expect(service.getReleaseContributions({
        endDate: '2025-13-45',
      })).rejects.toThrow('Invalid end date format');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should reject reversed date range (startDate > endDate)', async () => {
      await expect(service.getReleaseContributions({
        startDate: '2025-12-31',
        endDate: '2025-01-01',
      })).rejects.toThrow('Invalid date range');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should reject team filter exceeding max length', async () => {
      const longTeam = 'A'.repeat(201);
      await expect(service.getReleaseContributions({
        team: longTeam,
      })).rejects.toThrow('exceeds maximum length');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should reject repository filter exceeding max length', async () => {
      const longRepo = 'A'.repeat(201);
      await expect(service.getReleaseContributions({
        repository: longRepo,
      })).rejects.toThrow('exceeds maximum length');
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getEnvironmentDistribution
  // ==========================================================================
  describe('getEnvironmentDistribution', () => {
    it('should return environment distribution data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { environment: 'Production', merge_count: 50, contributor_count: 5, repository_count: 3 },
          { environment: 'Staging', merge_count: 80, contributor_count: 8, repository_count: 4 },
        ],
        rowCount: 2,
      });

      const result = await service.getEnvironmentDistribution();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        environment: 'Production',
        mergeCount: 50,
        contributorCount: 5,
        repositoryCount: 3,
      });
      expect(result[1]).toEqual({
        environment: 'Staging',
        mergeCount: 80,
        contributorCount: 8,
        repositoryCount: 4,
      });
    });
  });

  // ==========================================================================
  // getChartData
  // ==========================================================================
  describe('getChartData', () => {
    it('should return empty data when view does not exist', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const result = await service.getChartData();

      expect(result.viewExists).toBe(false);
      expect(result.hasData).toBe(false);
      expect(result.summaries).toEqual([]);
      expect(result.contributions).toEqual([]);
      expect(result.environmentDistribution).toEqual([]);
    });

    it('should return aggregated summaries', async () => {
      // View exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // Contributions query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { author: 'alice', full_name: 'Alice Smith', team: 'Platform', repository: 'app', environment: 'Production', merge_count: 5, tag_count: 2 },
          { author: 'alice', full_name: 'Alice Smith', team: 'Platform', repository: 'app', environment: 'Staging', merge_count: 8, tag_count: 0 },
          { author: 'bob', full_name: 'Bob Jones', team: 'Backend', repository: 'api', environment: 'Production', merge_count: 3, tag_count: 1 },
        ],
        rowCount: 3,
      });

      // Environment distribution query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { environment: 'Production', merge_count: 8, contributor_count: 2, repository_count: 2 },
          { environment: 'Staging', merge_count: 8, contributor_count: 1, repository_count: 1 },
        ],
        rowCount: 2,
      });

      const result = await service.getChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.summaries).toHaveLength(2);

      // Alice should have aggregated counts
      const alice = result.summaries.find(s => s.author === 'alice');
      expect(alice).toBeDefined();
      expect(alice?.productionMerges).toBe(5);
      expect(alice?.stagingMerges).toBe(8);
      expect(alice?.totalTags).toBe(2);
      expect(alice?.totalActivity).toBe(15); // 5 + 8 + 2

      // Bob should have his counts
      const bob = result.summaries.find(s => s.author === 'bob');
      expect(bob).toBeDefined();
      expect(bob?.productionMerges).toBe(3);
      expect(bob?.stagingMerges).toBe(0);
      expect(bob?.totalTags).toBe(1);
      expect(bob?.totalActivity).toBe(4); // 3 + 0 + 1
    });

    it('should sort summaries by total activity descending', async () => {
      // View exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // Contributions query - Alice has more activity
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { author: 'bob', full_name: 'Bob Jones', team: 'Backend', repository: 'api', environment: 'Production', merge_count: 2, tag_count: 0 },
          { author: 'alice', full_name: 'Alice Smith', team: 'Platform', repository: 'app', environment: 'Production', merge_count: 10, tag_count: 5 },
        ],
        rowCount: 2,
      });

      // Environment distribution query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.getChartData();

      // Alice should be first (more activity)
      expect(result.summaries[0]?.author).toBe('alice');
      expect(result.summaries[1]?.author).toBe('bob');
    });
  });

  // ==========================================================================
  // Security: SQL Injection prevention (CWE-89)
  // ==========================================================================
  describe('security (SQL injection prevention)', () => {
    it('should prevent SQL injection via team filter', async () => {
      const maliciousTeam = "'; DROP TABLE commit_history; --";
      await service.getReleaseContributions({ team: maliciousTeam });

      // Query should be called with parameterized value, not string concatenation
      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).not.toContain(maliciousTeam);
      expect(params).toContain(maliciousTeam); // Passed as parameter
    });

    it('should prevent SQL injection via repository filter', async () => {
      const maliciousRepo = "'; DROP TABLE commit_history; --";
      await service.getReleaseContributions({ repository: maliciousRepo });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).not.toContain(maliciousRepo);
      expect(params).toContain(maliciousRepo);
    });
  });
});
