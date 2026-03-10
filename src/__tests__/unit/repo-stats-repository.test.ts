import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { RepoStatsRepository } from '../../database/repo-stats-repository.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for RepoStatsRepository (IQS-866).
 * Tests aggregate repository statistics queries.
 */
describe('RepoStatsRepository', () => {
  let mockDbService: DatabaseService;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Create mock DatabaseService
    mockDbService = {
      query: vi.fn(),
      transaction: vi.fn(),
      initialize: vi.fn(),
      shutdown: vi.fn(),
      isConnected: vi.fn(),
      getPoolStats: vi.fn(),
      getPool: vi.fn(),
      isInitialized: vi.fn(),
    } as unknown as DatabaseService;
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('getRepoStats', () => {
    it('should return empty array when no repositories have data', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // stats query
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // branch query

      const repo = new RepoStatsRepository(mockDbService);
      const stats = await repo.getRepoStats();

      expect(stats).toEqual([]);
      expect(queryFn).toHaveBeenCalledTimes(2);
    });

    it('should return stats for repositories with commit data', async () => {
      const lastDate = new Date('2026-03-04T12:00:00Z');
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({
        rows: [
          {
            repository: 'my-app',
            last_sync_date: lastDate,
            total_commits: 150,
            unique_contributors: 5,
          },
          {
            repository: 'shared-lib',
            last_sync_date: new Date('2026-02-28T09:00:00Z'),
            total_commits: 42,
            unique_contributors: 3,
          },
        ],
        rowCount: 2,
      });
      queryFn.mockResolvedValueOnce({
        rows: [
          { repository: 'my-app', branch_count: 12 },
          { repository: 'shared-lib', branch_count: 4 },
        ],
        rowCount: 2,
      });

      const repo = new RepoStatsRepository(mockDbService);
      const stats = await repo.getRepoStats();

      expect(stats).toHaveLength(2);
      expect(stats[0]).toEqual({
        repository: 'my-app',
        lastSyncDate: lastDate,
        totalCommits: 150,
        uniqueContributors: 5,
        branchCount: 12,
      });
      expect(stats[1]).toEqual({
        repository: 'shared-lib',
        lastSyncDate: new Date('2026-02-28T09:00:00Z'),
        totalCommits: 42,
        uniqueContributors: 3,
        branchCount: 4,
      });
    });

    it('should default branchCount to 0 when branch data is missing for a repo', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({
        rows: [
          {
            repository: 'orphan-repo',
            last_sync_date: new Date('2026-01-01T00:00:00Z'),
            total_commits: 10,
            unique_contributors: 1,
          },
        ],
        rowCount: 1,
      });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no branch data

      const repo = new RepoStatsRepository(mockDbService);
      const stats = await repo.getRepoStats();

      expect(stats).toHaveLength(1);
      expect(stats[0]?.branchCount).toBe(0);
    });

    it('should handle null last_sync_date', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({
        rows: [
          {
            repository: 'empty-repo',
            last_sync_date: null,
            total_commits: 0,
            unique_contributors: 0,
          },
        ],
        rowCount: 1,
      });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const repo = new RepoStatsRepository(mockDbService);
      const stats = await repo.getRepoStats();

      expect(stats[0]?.lastSyncDate).toBeNull();
    });
  });

  describe('getRepoStatsByName', () => {
    it('should return stats for a matching repository', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({
        rows: [
          {
            repository: 'target-repo',
            last_sync_date: new Date('2026-03-01T00:00:00Z'),
            total_commits: 99,
            unique_contributors: 7,
          },
        ],
        rowCount: 1,
      });
      queryFn.mockResolvedValueOnce({
        rows: [{ repository: 'target-repo', branch_count: 3 }],
        rowCount: 1,
      });

      const repo = new RepoStatsRepository(mockDbService);
      const stats = await repo.getRepoStatsByName('target-repo');

      expect(stats).not.toBeNull();
      expect(stats?.repository).toBe('target-repo');
      expect(stats?.totalCommits).toBe(99);
    });

    it('should return null when repository has no data', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const repo = new RepoStatsRepository(mockDbService);
      const stats = await repo.getRepoStatsByName('nonexistent');

      expect(stats).toBeNull();
    });
  });
});
