import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { BranchRepository } from '../../database/branch-repository.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for BranchRepository.
 * Tests the new aggregate methods added for GITX-232:
 * - getGlobalSummaryStatistics
 * - getGlobalRiskDistribution
 * - getRepositoryRiskBreakdown
 * - getDistinctRepositories
 *
 * Ticket: GITX-232
 */
describe('BranchRepository', () => {
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

  describe('getGlobalSummaryStatistics', () => {
    it('should return summary statistics with correct counts', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({
        rows: [{
          total: 25,
          merged_count: 10,
          stale_count: 8,
          orphaned_count: 3,
          active_count: 4,
        }],
        rowCount: 1,
      });

      const repo = new BranchRepository(mockDbService);
      const stats = await repo.getGlobalSummaryStatistics();

      expect(stats).toEqual({
        total: 25,
        merged: 10,
        stale: 8,
        orphaned: 3,
        active: 4,
      });
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('should return zeros when no branches exist', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({ rows: [{}], rowCount: 1 });

      const repo = new BranchRepository(mockDbService);
      const stats = await repo.getGlobalSummaryStatistics();

      expect(stats).toEqual({
        total: 0,
        merged: 0,
        stale: 0,
        orphaned: 0,
        active: 0,
      });
    });

    it('should handle empty result set', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const repo = new BranchRepository(mockDbService);
      const stats = await repo.getGlobalSummaryStatistics();

      expect(stats).toEqual({
        total: 0,
        merged: 0,
        stale: 0,
        orphaned: 0,
        active: 0,
      });
    });
  });

  describe('getGlobalRiskDistribution', () => {
    it('should return risk distribution with correct counts', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({
        rows: [{
          safe_count: 5,
          low_count: 8,
          medium_count: 7,
          high_count: 3,
        }],
        rowCount: 1,
      });

      const repo = new BranchRepository(mockDbService);
      const distribution = await repo.getGlobalRiskDistribution();

      expect(distribution).toEqual({
        safe: 5,
        low: 8,
        medium: 7,
        high: 3,
      });
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('should return zeros when no branches exist', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({ rows: [{}], rowCount: 1 });

      const repo = new BranchRepository(mockDbService);
      const distribution = await repo.getGlobalRiskDistribution();

      expect(distribution).toEqual({
        safe: 0,
        low: 0,
        medium: 0,
        high: 0,
      });
    });

    it('should handle empty result set', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const repo = new BranchRepository(mockDbService);
      const distribution = await repo.getGlobalRiskDistribution();

      expect(distribution).toEqual({
        safe: 0,
        low: 0,
        medium: 0,
        high: 0,
      });
    });
  });

  describe('getRepositoryRiskBreakdown', () => {
    it('should return risk breakdown per repository', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({
        rows: [
          { repository: 'app-1', safe_count: 2, low_count: 3, medium_count: 1, high_count: 0 },
          { repository: 'app-2', safe_count: 1, low_count: 2, medium_count: 2, high_count: 1 },
        ],
        rowCount: 2,
      });

      const repo = new BranchRepository(mockDbService);
      const breakdown = await repo.getRepositoryRiskBreakdown();

      expect(breakdown).toHaveLength(2);
      expect(breakdown[0]).toEqual({
        repository: 'app-1',
        safe: 2,
        low: 3,
        medium: 1,
        high: 0,
      });
      expect(breakdown[1]).toEqual({
        repository: 'app-2',
        safe: 1,
        low: 2,
        medium: 2,
        high: 1,
      });
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no repositories have data', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const repo = new BranchRepository(mockDbService);
      const breakdown = await repo.getRepositoryRiskBreakdown();

      expect(breakdown).toEqual([]);
    });
  });

  describe('getDistinctRepositories', () => {
    it('should return list of distinct repository names', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({
        rows: [
          { repository: 'alpha-service' },
          { repository: 'beta-api' },
          { repository: 'gamma-frontend' },
        ],
        rowCount: 3,
      });

      const repo = new BranchRepository(mockDbService);
      const repositories = await repo.getDistinctRepositories();

      expect(repositories).toEqual(['alpha-service', 'beta-api', 'gamma-frontend']);
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no repositories exist', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const repo = new BranchRepository(mockDbService);
      const repositories = await repo.getDistinctRepositories();

      expect(repositories).toEqual([]);
    });
  });

  describe('getDeadBranchSummary with search filter', () => {
    it('should filter branches by search term', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            branch_name: 'feature/auth-login',
            repository: 'app',
            last_commit_date: new Date('2026-01-15'),
            last_commit_author: 'alice',
            last_commit_sha: 'abc123',
            commit_count: 5,
            is_merged: false,
            merged_into: null,
            is_orphaned: false,
            has_open_pr: false,
            is_protected: false,
            created_at: new Date('2026-01-01'),
            updated_at: new Date('2026-01-15'),
            days_since_last_commit: 30,
            status: 'stale',
            risk_level: 'medium',
          },
        ],
        rowCount: 1,
      });

      const repo = new BranchRepository(mockDbService);
      const results = await repo.getDeadBranchSummary({ search: 'auth' });

      expect(results).toHaveLength(1);
      expect(results[0]?.branchName).toBe('feature/auth-login');

      // Verify search parameter was used in query
      const queryCall = queryFn.mock.calls[0];
      const params = queryCall?.[1] as unknown[];
      expect(params).toContain('%auth%');
    });

    it('should combine search with other filters', async () => {
      const queryFn = mockDbService.query as ReturnType<typeof vi.fn>;
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const repo = new BranchRepository(mockDbService);
      await repo.getDeadBranchSummary({
        repository: 'my-app',
        riskLevels: ['high'],
        search: 'feature',
      });

      // Verify all parameters were passed
      const queryCall = queryFn.mock.calls[0];
      const params = queryCall?.[1] as unknown[];
      expect(params).toContain('my-app');
      expect(params).toContainEqual(['high']);
      expect(params).toContain('%feature%');
    });
  });
});
