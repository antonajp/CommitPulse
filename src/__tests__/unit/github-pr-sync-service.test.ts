import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { GitHubPRSyncService } from '../../services/github-pr-sync-service.js';
import type { DatabaseService } from '../../database/database-service.js';
import type { GitHubPRSyncConfig } from '../../services/code-review-velocity-types.js';

/**
 * Helper to generate recent date strings for tests.
 * The service filters PRs by updated_at > since (90 days ago),
 * so test dates must be recent.
 */
function getRecentDateString(daysAgo = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

/**
 * Unit tests for GitHubPRSyncService (IQS-899).
 * Tests the GitHub PR sync service for the Code Review Velocity dashboard.
 *
 * Test coverage includes:
 * - Table existence checking
 * - PR sync flow with mocked Octokit
 * - Ticket extraction from branch names
 * - Review metrics updates
 * - Rate limiting and error handling
 */
describe('GitHubPRSyncService', () => {
  let mockDb: DatabaseService;
  let mockOctokit: {
    pulls: {
      list: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      listReviews: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as DatabaseService;

    mockOctokit = {
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        get: vi.fn().mockResolvedValue({
          data: {
            id: 123,
            number: 1,
            title: 'Test PR',
            user: { login: 'testuser' },
            state: 'closed',
            created_at: '2024-06-01T10:00:00Z',
            updated_at: '2024-06-05T14:00:00Z',
            merged_at: '2024-06-05T14:00:00Z',
            closed_at: '2024-06-05T14:00:00Z',
            merge_commit_sha: 'abc123',
            head: { ref: 'feature/IQS-100-new-feature' },
            base: { ref: 'main' },
            additions: 100,
            deletions: 20,
            changed_files: 5,
          },
        }),
        listReviews: vi.fn().mockResolvedValue({ data: [] }),
      },
    };
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('checkTableExists', () => {
    it('should return true when table exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ table_exists: true }],
        rowCount: 1,
      });

      const service = new GitHubPRSyncService('fake-token', mockDb, mockOctokit as never);
      const result = await service.checkTableExists();

      expect(result).toBe(true);
    });

    it('should return false when table does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ table_exists: false }],
        rowCount: 1,
      });

      const service = new GitHubPRSyncService('fake-token', mockDb, mockOctokit as never);
      const result = await service.checkTableExists();

      expect(result).toBe(false);
    });
  });

  describe('syncRepository', () => {
    it('should sync PRs and return result', async () => {
      const recentDate = getRecentDateString(5);

      // Mock pulls.list to return one PR
      mockOctokit.pulls.list.mockResolvedValueOnce({
        data: [
          {
            id: 123,
            number: 1,
            title: 'Test PR',
            user: { login: 'testuser' },
            state: 'closed',
            created_at: recentDate,
            updated_at: recentDate,
            merged_at: recentDate,
            closed_at: recentDate,
            merge_commit_sha: 'abc123',
            head: { ref: 'feature/IQS-100-new-feature' },
            base: { ref: 'main' },
          },
        ],
      });

      // Mock pulls.get for PR details
      mockOctokit.pulls.get.mockResolvedValueOnce({
        data: {
          id: 123,
          number: 1,
          title: 'Test PR',
          user: { login: 'testuser' },
          state: 'closed',
          created_at: recentDate,
          updated_at: recentDate,
          merged_at: recentDate,
          closed_at: recentDate,
          merge_commit_sha: 'abc123',
          head: { ref: 'feature/IQS-100-new-feature' },
          base: { ref: 'main' },
          additions: 100,
          deletions: 20,
          changed_files: 5,
        },
      });

      // Mock pulls.listReviews
      mockOctokit.pulls.listReviews.mockResolvedValueOnce({ data: [] });

      // Mock upsert to return PR ID
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: 1 }],
        rowCount: 1,
      });

      const config: GitHubPRSyncConfig = {
        owner: 'testorg',
        repo: 'testrepo',
        token: 'fake-token',
        syncDaysBack: 90,
      };

      const service = new GitHubPRSyncService('fake-token', mockDb, mockOctokit as never);
      const result = await service.syncRepository(config);

      expect(result.repository).toBe('testorg/testrepo');
      expect(result.prsUpserted).toBe(1);
      expect(result.errorCount).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should extract ticket ID from branch name', async () => {
      const recentDate = getRecentDateString(5);

      // Mock PR with Linear ticket in branch name
      mockOctokit.pulls.list.mockResolvedValueOnce({
        data: [
          {
            id: 123,
            number: 1,
            title: 'Test PR',
            user: { login: 'testuser' },
            state: 'closed',
            created_at: recentDate,
            updated_at: recentDate,
            merged_at: recentDate,
            closed_at: recentDate,
            merge_commit_sha: 'abc123',
            head: { ref: 'feature/IQS-899-add-pr-sync' },
            base: { ref: 'main' },
          },
        ],
      });

      // Mock pulls.get for PR details
      mockOctokit.pulls.get.mockResolvedValueOnce({
        data: {
          id: 123,
          number: 1,
          title: 'Test PR',
          user: { login: 'testuser' },
          state: 'closed',
          created_at: recentDate,
          updated_at: recentDate,
          merged_at: recentDate,
          closed_at: recentDate,
          merge_commit_sha: 'abc123',
          head: { ref: 'feature/IQS-899-add-pr-sync' },
          base: { ref: 'main' },
          additions: 100,
          deletions: 20,
          changed_files: 5,
        },
      });

      // Mock pulls.listReviews
      mockOctokit.pulls.listReviews.mockResolvedValueOnce({ data: [] });

      // Track upsert calls
      const upsertCalls: unknown[][] = [];
      (mockDb.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO pull_request')) {
          upsertCalls.push(params);
        }
        return { rows: [{ id: 1 }], rowCount: 1 };
      });

      const config: GitHubPRSyncConfig = {
        owner: 'testorg',
        repo: 'testrepo',
        token: 'fake-token',
        syncDaysBack: 90,
      };

      const service = new GitHubPRSyncService('fake-token', mockDb, mockOctokit as never);
      await service.syncRepository(config);

      // Verify ticket ID was extracted
      expect(upsertCalls.length).toBeGreaterThan(0);
      const prUpsertParams = upsertCalls[0];
      // linked_ticket_id is param $19
      expect(prUpsertParams?.[18]).toBe('IQS-899');
      // linked_ticket_type is param $20
      expect(prUpsertParams?.[19]).toBe('linear');
    });

    it('should extract Jira ticket ID from branch name', async () => {
      const recentDate = getRecentDateString(5);

      // Mock PR with Jira ticket in branch name
      mockOctokit.pulls.list.mockResolvedValueOnce({
        data: [
          {
            id: 123,
            number: 1,
            title: 'Test PR',
            user: { login: 'testuser' },
            state: 'closed',
            created_at: recentDate,
            updated_at: recentDate,
            merged_at: recentDate,
            closed_at: recentDate,
            merge_commit_sha: 'abc123',
            head: { ref: 'feature/PROJECTX-12345-long-jira-key' },
            base: { ref: 'main' },
          },
        ],
      });

      // Mock pulls.get for PR details
      mockOctokit.pulls.get.mockResolvedValueOnce({
        data: {
          id: 123,
          number: 1,
          title: 'Test PR',
          user: { login: 'testuser' },
          state: 'closed',
          created_at: recentDate,
          updated_at: recentDate,
          merged_at: recentDate,
          closed_at: recentDate,
          merge_commit_sha: 'abc123',
          head: { ref: 'feature/PROJECTX-12345-long-jira-key' },
          base: { ref: 'main' },
          additions: 100,
          deletions: 20,
          changed_files: 5,
        },
      });

      // Mock pulls.listReviews
      mockOctokit.pulls.listReviews.mockResolvedValueOnce({ data: [] });

      // Track upsert calls
      const upsertCalls: unknown[][] = [];
      (mockDb.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO pull_request')) {
          upsertCalls.push(params);
        }
        return { rows: [{ id: 1 }], rowCount: 1 };
      });

      const config: GitHubPRSyncConfig = {
        owner: 'testorg',
        repo: 'testrepo',
        token: 'fake-token',
        syncDaysBack: 90,
      };

      const service = new GitHubPRSyncService('fake-token', mockDb, mockOctokit as never);
      await service.syncRepository(config);

      // Verify ticket ID was extracted with Jira type
      expect(upsertCalls.length).toBeGreaterThan(0);
      const prUpsertParams = upsertCalls[0];
      // linked_ticket_id is param $19
      expect(prUpsertParams?.[18]).toBe('PROJECTX-12345');
      // linked_ticket_type is param $20 - longer prefix means Jira
      expect(prUpsertParams?.[19]).toBe('jira');
    });

    it('should sync reviews and update metrics', async () => {
      const recentDate = getRecentDateString(5);
      const reviewDate1 = getRecentDateString(4);
      const reviewDate2 = getRecentDateString(3);

      // Mock PR
      mockOctokit.pulls.list.mockResolvedValueOnce({
        data: [
          {
            id: 123,
            number: 1,
            title: 'Test PR',
            user: { login: 'testuser' },
            state: 'closed',
            created_at: recentDate,
            updated_at: recentDate,
            merged_at: recentDate,
            closed_at: recentDate,
            merge_commit_sha: 'abc123',
            head: { ref: 'feature-branch' },
            base: { ref: 'main' },
          },
        ],
      });

      // Mock pulls.get for PR details
      mockOctokit.pulls.get.mockResolvedValueOnce({
        data: {
          id: 123,
          number: 1,
          title: 'Test PR',
          user: { login: 'testuser' },
          state: 'closed',
          created_at: recentDate,
          updated_at: recentDate,
          merged_at: recentDate,
          closed_at: recentDate,
          merge_commit_sha: 'abc123',
          head: { ref: 'feature-branch' },
          base: { ref: 'main' },
          additions: 100,
          deletions: 20,
          changed_files: 5,
        },
      });

      // Mock reviews
      mockOctokit.pulls.listReviews.mockResolvedValueOnce({
        data: [
          {
            id: 456,
            user: { login: 'reviewer1' },
            state: 'CHANGES_REQUESTED',
            submitted_at: reviewDate1,
            body: 'Please fix the tests',
          },
          {
            id: 457,
            user: { login: 'reviewer1' },
            state: 'APPROVED',
            submitted_at: reviewDate2,
            body: 'LGTM',
          },
        ],
      });

      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: 1 }],
        rowCount: 1,
      });

      const config: GitHubPRSyncConfig = {
        owner: 'testorg',
        repo: 'testrepo',
        token: 'fake-token',
        syncDaysBack: 90,
      };

      const service = new GitHubPRSyncService('fake-token', mockDb, mockOctokit as never);
      const result = await service.syncRepository(config);

      expect(result.prsUpserted).toBe(1);
      expect(result.reviewsUpserted).toBe(2);
    });

    it('should handle errors gracefully', async () => {
      const recentDate = getRecentDateString(5);

      // Mock PR list
      mockOctokit.pulls.list.mockResolvedValueOnce({
        data: [
          {
            id: 123,
            number: 1,
            title: 'Test PR',
            user: { login: 'testuser' },
            state: 'open',
            created_at: recentDate,
            updated_at: recentDate,
            merged_at: null,
            closed_at: null,
            merge_commit_sha: null,
            head: { ref: 'feature-branch' },
            base: { ref: 'main' },
          },
        ],
      });

      // Mock PR details to throw error (non-rate-limit error)
      mockOctokit.pulls.get.mockRejectedValue(new Error('API error'));

      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: 1 }],
        rowCount: 1,
      });

      const config: GitHubPRSyncConfig = {
        owner: 'testorg',
        repo: 'testrepo',
        token: 'fake-token',
        syncDaysBack: 90,
      };

      const service = new GitHubPRSyncService('fake-token', mockDb, mockOctokit as never);
      const result = await service.syncRepository(config);

      expect(result.prsUpserted).toBe(0);
      expect(result.errorCount).toBe(1);
    });

    it('should handle rate limit errors with backoff', async () => {
      // Mock PR list to throw rate limit error then succeed
      let callCount = 0;
      mockOctokit.pulls.list.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('rate limit exceeded');
        }
        return { data: [] };
      });

      const config: GitHubPRSyncConfig = {
        owner: 'testorg',
        repo: 'testrepo',
        token: 'fake-token',
        syncDaysBack: 90,
      };

      const service = new GitHubPRSyncService('fake-token', mockDb, mockOctokit as never);
      const result = await service.syncRepository(config);

      // Should have retried
      expect(callCount).toBe(2);
      expect(result.prsUpserted).toBe(0);
      expect(result.errorCount).toBe(0);
    });
  });

  describe('syncAllRepositories', () => {
    it('should sync multiple repositories', async () => {
      // Mock empty PR list
      mockOctokit.pulls.list.mockResolvedValue({ data: [] });

      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: 1 }],
        rowCount: 1,
      });

      const configs: GitHubPRSyncConfig[] = [
        { owner: 'org1', repo: 'repo1', token: 'fake-token', syncDaysBack: 90 },
        { owner: 'org1', repo: 'repo2', token: 'fake-token', syncDaysBack: 90 },
        { owner: 'org2', repo: 'repo3', token: 'fake-token', syncDaysBack: 90 },
      ];

      const service = new GitHubPRSyncService('fake-token', mockDb, mockOctokit as never);
      const result = await service.syncAllRepositories(configs);

      expect(result.repositoryResults).toHaveLength(3);
      expect(result.repositoryResults[0]?.repository).toBe('org1/repo1');
      expect(result.repositoryResults[1]?.repository).toBe('org1/repo2');
      expect(result.repositoryResults[2]?.repository).toBe('org2/repo3');
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should aggregate totals across repositories', async () => {
      const recentDate = getRecentDateString(5);

      // Mock first repo with 2 PRs
      mockOctokit.pulls.list
        .mockResolvedValueOnce({
          data: [
            {
              id: 1, number: 1, title: 'PR 1', user: { login: 'user1' },
              state: 'closed', created_at: recentDate, updated_at: recentDate,
              merged_at: null, closed_at: null, merge_commit_sha: null,
              head: { ref: 'branch1' }, base: { ref: 'main' },
            },
            {
              id: 2, number: 2, title: 'PR 2', user: { login: 'user2' },
              state: 'closed', created_at: recentDate, updated_at: recentDate,
              merged_at: null, closed_at: null, merge_commit_sha: null,
              head: { ref: 'branch2' }, base: { ref: 'main' },
            },
          ],
        })
        .mockResolvedValueOnce({
          data: [
            {
              id: 3, number: 1, title: 'PR 3', user: { login: 'user3' },
              state: 'closed', created_at: recentDate, updated_at: recentDate,
              merged_at: null, closed_at: null, merge_commit_sha: null,
              head: { ref: 'branch3' }, base: { ref: 'main' },
            },
          ],
        });

      // Mock pulls.get for PR details (generic mock for all PRs)
      mockOctokit.pulls.get.mockImplementation(async ({ pull_number }: { pull_number: number }) => ({
        data: {
          id: pull_number,
          number: pull_number,
          title: `PR ${pull_number}`,
          user: { login: `user${pull_number}` },
          state: 'closed',
          created_at: '2024-06-01T00:00:00Z',
          updated_at: '2024-06-01T00:00:00Z',
          merged_at: null,
          closed_at: null,
          merge_commit_sha: null,
          head: { ref: `branch${pull_number}` },
          base: { ref: 'main' },
          additions: 10,
          deletions: 5,
          changed_files: 2,
        },
      }));

      // Mock reviews
      mockOctokit.pulls.listReviews.mockResolvedValue({ data: [] });

      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: 1 }],
        rowCount: 1,
      });

      const configs: GitHubPRSyncConfig[] = [
        { owner: 'org1', repo: 'repo1', token: 'fake-token', syncDaysBack: 90 },
        { owner: 'org1', repo: 'repo2', token: 'fake-token', syncDaysBack: 90 },
      ];

      const service = new GitHubPRSyncService('fake-token', mockDb, mockOctokit as never);
      const result = await service.syncAllRepositories(configs);

      expect(result.totalPRs).toBe(3);
      expect(result.totalErrors).toBe(0);
    });
  });
});
