import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import {
  CommitJiraRepository,
  type CommitJiraRow,
} from '../../database/commit-jira-repository.js';

/**
 * Unit tests for CommitJiraRepository class.
 *
 * Tests all insert and query methods using a mocked DatabaseService.
 * Verifies parameterized SQL for all operations. No real database required.
 *
 * Ticket: IQS-852
 */

// Mock pg module
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockOn = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    end: mockEnd,
    on: mockOn,
    query: mockQuery,
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  })),
}));

/**
 * Helper: create a test config for DatabaseService.
 */
function createTestConfig(): DatabaseServiceConfig {
  return {
    host: 'localhost',
    port: 5433,
    database: 'gitrx_test',
    user: 'test_user',
    password: 'test_password',
  };
}

/**
 * Helper: set up the mock pool's connect method to return a mock client.
 */
function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  // Default health check response
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

describe('CommitJiraRepository', () => {
  let dbService: DatabaseService;
  let repo: CommitJiraRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createTestConfig());
    repo = new CommitJiraRepository(dbService);
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // --------------------------------------------------------------------------
  // Insert methods
  // --------------------------------------------------------------------------

  describe('insertCommitJira', () => {
    it('should batch insert commit-jira rows in a transaction', async () => {
      const callOrder: string[] = [];
      mockQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string') {
          callOrder.push(sql.trim().substring(0, 30));
        }
        return { rows: [], rowCount: 1 };
      });

      const rows: CommitJiraRow[] = [
        { sha: 'sha1', jiraKey: 'IQS-100', author: 'user1', jiraProject: 'IQS' },
        { sha: 'sha1', jiraKey: 'IQS-101', author: 'user1', jiraProject: 'IQS' },
      ];

      await repo.insertCommitJira(rows);

      // Verify transaction boundaries
      expect(callOrder.some((s) => s.includes('BEGIN'))).toBe(true);
      expect(callOrder.some((s) => s.includes('COMMIT'))).toBe(true);
    });

    it('should pass all fields as parameterized values', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const rows: CommitJiraRow[] = [
        { sha: 'sha1', jiraKey: 'PROJ-42', author: 'devuser', jiraProject: 'PROJ' },
      ];

      await repo.insertCommitJira(rows);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_jira'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toEqual(['sha1', 'PROJ-42', 'devuser', 'PROJ']);
    });

    it('should skip insert when rows array is empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.insertCommitJira([]);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });

    it('should use ON CONFLICT DO NOTHING for idempotency', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const rows: CommitJiraRow[] = [
        { sha: 'sha1', jiraKey: 'IQS-100', author: 'user', jiraProject: 'IQS' },
      ];

      // Should not throw even if row already exists
      await expect(repo.insertCommitJira(rows)).resolves.not.toThrow();
    });
  });

  describe('deleteAuthorCommitJira', () => {
    it('should delete entries for the specified author', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 5 });

      const count = await repo.deleteAuthorCommitJira('testuser');

      expect(count).toBe(5);
    });

    it('should pass author as parameterized value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.deleteAuthorCommitJira('testuser');

      const deleteCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM commit_jira'),
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![1]).toEqual(['testuser']);
    });

    it('should return 0 when no entries exist for author', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const count = await repo.deleteAuthorCommitJira('nonexistent');
      expect(count).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Query methods
  // --------------------------------------------------------------------------

  describe('getDistinctJiraKeys', () => {
    it('should return set of Jira keys', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { jira_key: 'IQS-100' },
          { jira_key: 'IQS-200' },
          { jira_key: 'PROJ-50' },
        ],
        rowCount: 3,
      });

      const result = await repo.getDistinctJiraKeys();

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(3);
      expect(result.has('IQS-100')).toBe(true);
      expect(result.has('IQS-200')).toBe(true);
      expect(result.has('PROJ-50')).toBe(true);
    });

    it('should return empty set when no keys exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await repo.getDistinctJiraKeys();
      expect(result.size).toBe(0);
    });
  });

  describe('getCommitMsgBranchForAuthor', () => {
    it('should return commit messages and branches for author', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { commit_message: 'feat: add feature', branch: 'feature/test' },
          { commit_message: 'fix: bug fix', branch: 'main' },
        ],
        rowCount: 2,
      });

      const result = await repo.getCommitMsgBranchForAuthor('testuser');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ commitMessage: 'feat: add feature', branch: 'feature/test' });
      expect(result[1]).toEqual({ commitMessage: 'fix: bug fix', branch: 'main' });
    });

    it('should pass author as parameterized value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getCommitMsgBranchForAuthor('myuser');

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('is_merge = false'),
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual(['myuser']);
    });
  });

  describe('getCommitMsgForJiraRef', () => {
    it('should return unprocessed commits when refresh=false', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ sha: 'sha1', commit_message: 'IQS-100 add feature' }],
        rowCount: 1,
      });

      const result = await repo.getCommitMsgForJiraRef('user', false);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ sha: 'sha1', commitMessage: 'IQS-100 add feature' });
    });

    it('should use IS NULL filter when refresh=false', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getCommitMsgForJiraRef('user', false);

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('IS NULL'),
      );
      expect(selectCall).toBeDefined();
    });

    it('should return all commits when refresh=true', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getCommitMsgForJiraRef('user', true);

      // Verify SQL does NOT have IS NULL clause
      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          (c[0] as string).includes('commit_history') &&
          (c[0] as string).includes('author = $1') &&
          !(c[0] as string).includes('IS NULL') &&
          !(c[0] as string).includes('is_merge'),
      );
      expect(selectCall).toBeDefined();
    });
  });

  describe('getCommitMsgForJiraRelationship', () => {
    it('should return commit messages with branch info', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { sha: 'sha1', commit_message: 'msg1', branch: 'main' },
          { sha: 'sha2', commit_message: 'msg2', branch: 'develop' },
        ],
        rowCount: 2,
      });

      const result = await repo.getCommitMsgForJiraRelationship('user');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ sha: 'sha1', commitMessage: 'msg1', branch: 'main' });
    });

    it('should pass author as parameterized value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getCommitMsgForJiraRelationship('devuser');

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          (c[0] as string).includes('commit_message, branch') &&
          (c[0] as string).includes('author = $1'),
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual(['devuser']);
    });
  });

  describe('getAuthorUnlinkedCommits', () => {
    it('should return unlinked commits for author when refresh=false', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { sha: 'sha1', commit_message: 'msg1', branch: 'main' },
        ],
        rowCount: 1,
      });

      const result = await repo.getAuthorUnlinkedCommits('user', false, false);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ author: 'user', sha: 'sha1', msg: 'msg1' });
    });

    it('should combine message with branch when combine=true', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { sha: 'sha1', commit_message: 'msg1', branch: 'feature/test' },
        ],
        rowCount: 1,
      });

      const result = await repo.getAuthorUnlinkedCommits('user', false, true);

      expect(result[0]?.msg).toBe('msg1_feature/test');
    });

    it('should use NOT EXISTS query when refresh=false', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getAuthorUnlinkedCommits('user', false);

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('NOT EXISTS'),
      );
      expect(selectCall).toBeDefined();
    });

    it('should return all commits when refresh=true', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getAuthorUnlinkedCommits('user', true);

      // Verify no NOT EXISTS
      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          (c[0] as string).includes('commit_history ch') &&
          (c[0] as string).includes('author = $1') &&
          !(c[0] as string).includes('NOT EXISTS'),
      );
      expect(selectCall).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // SQL injection prevention verification
  // --------------------------------------------------------------------------

  describe('SQL injection prevention', () => {
    it('should never interpolate author param into SQL', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const maliciousAuthor = "'; DROP TABLE commit_jira; --";
      await repo.getAuthorUnlinkedCommits(maliciousAuthor);

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('author = $1'),
      );
      expect(selectCall).toBeDefined();
      const sql = selectCall![0] as string;
      // SQL should NOT contain the injection string
      expect(sql).not.toContain('DROP TABLE');
      // But the params should contain it
      expect(selectCall![1]).toEqual([maliciousAuthor]);
    });

    it('should never interpolate jiraKey into SQL', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const maliciousRows: CommitJiraRow[] = [{
        sha: 'sha1',
        jiraKey: "'; DELETE FROM commit_jira; --",
        author: 'user',
        jiraProject: 'PROJ',
      }];

      await repo.insertCommitJira(maliciousRows);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_jira'),
      );
      expect(insertCall).toBeDefined();
      const sql = insertCall![0] as string;
      expect(sql).not.toContain('DELETE FROM');
    });
  });
});
