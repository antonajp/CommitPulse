import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

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

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { CommitLinearRepository } from '../../database/commit-linear-repository.js';
import type { CommitLinearRow } from '../../database/linear-types.js';

/**
 * Unit tests for CommitLinearRepository.
 *
 * Validates:
 * - insertCommitLinear batch insertion with ON CONFLICT
 * - deleteAuthorCommitLinear removes author entries
 * - getDistinctLinearKeys returns Set
 * - getCommitMsgForLinearRef with refresh flag
 * - getAuthorUnlinkedCommits with refresh and combine flags
 * - batchUpdateIsLinearRef batch updates
 * - All SQL uses parameterized queries
 *
 * Ticket: IQS-875
 */

// ============================================================================
// Test helpers
// ============================================================================

function createDbConfig(): DatabaseServiceConfig {
  return {
    host: 'localhost',
    port: 5433,
    database: 'gitrx_test',
    user: 'test_user',
    password: 'test_password',
  };
}

function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

describe('CommitLinearRepository', () => {
  let db: DatabaseService;
  let repo: CommitLinearRepository;

  beforeEach(async () => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    vi.clearAllMocks();

    setupMockClient();
    db = new DatabaseService();
    await db.initialize(createDbConfig());
    repo = new CommitLinearRepository(db);
  });

  afterEach(async () => {
    try { await db.shutdown(); } catch { /* ignore */ }
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    _clearMocks();
  });

  describe('insertCommitLinear', () => {
    it('should skip empty arrays', async () => {
      const callCountBefore = mockQuery.mock.calls.length;
      await repo.insertCommitLinear([]);
      expect(mockQuery.mock.calls.length).toBe(callCountBefore);
    });

    it('should insert rows using parameterized SQL', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const rows: CommitLinearRow[] = [
        { sha: 'abc123', linearKey: 'IQS-42', author: 'john', linearProject: 'IQS' },
        { sha: 'def456', linearKey: 'IQS-43', author: 'john', linearProject: 'IQS' },
      ];

      await repo.insertCommitLinear(rows);

      // Verify INSERT was called with correct parameters
      const insertCalls = mockQuery.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO commit_linear'),
      );
      expect(insertCalls.length).toBe(2);
      expect(insertCalls[0]![1]).toEqual(['abc123', 'IQS-42', 'john', 'IQS']);
    });

    it('should use ON CONFLICT DO NOTHING for idempotency', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const rows: CommitLinearRow[] = [
        { sha: 'abc123', linearKey: 'IQS-42', author: 'john', linearProject: 'IQS' },
      ];

      await repo.insertCommitLinear(rows);

      const insertCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('ON CONFLICT'),
      );
      expect(insertCall).toBeDefined();
    });
  });

  describe('deleteAuthorCommitLinear', () => {
    it('should delete entries for the given author', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 5 });

      const deleted = await repo.deleteAuthorCommitLinear('john');

      expect(deleted).toBe(5);
      const deleteCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('DELETE FROM commit_linear'),
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![1]).toEqual(['john']);
    });
  });

  describe('getDistinctLinearKeys', () => {
    it('should return a Set of Linear keys', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { linear_key: 'IQS-1' },
          { linear_key: 'ENG-10' },
        ],
        rowCount: 2,
      });

      const keys = await repo.getDistinctLinearKeys();

      expect(keys).toBeInstanceOf(Set);
      expect(keys.size).toBe(2);
      expect(keys.has('IQS-1')).toBe(true);
      expect(keys.has('ENG-10')).toBe(true);
    });
  });

  describe('getCommitMsgForLinearRef', () => {
    it('should return commits for non-refresh mode (is_linear_ref IS NULL)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { sha: 'abc123', commit_message: 'Fix IQS-42 bug' },
        ],
        rowCount: 1,
      });

      const commits = await repo.getCommitMsgForLinearRef('john', false);

      expect(commits).toHaveLength(1);
      expect(commits[0]).toEqual({ sha: 'abc123', commitMessage: 'Fix IQS-42 bug' });

      const queryCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('is_linear_ref IS NULL'),
      );
      expect(queryCall).toBeDefined();
    });

    it('should return all commits for refresh mode', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { sha: 'abc123', commit_message: 'Fix IQS-42 bug' },
          { sha: 'def456', commit_message: 'Update readme' },
        ],
        rowCount: 2,
      });

      const commits = await repo.getCommitMsgForLinearRef('john', true);

      expect(commits).toHaveLength(2);

      // refresh mode should NOT have IS NULL filter
      const queryCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('WHERE author = $1')
          && !(call[0] as string).includes('IS NULL'),
      );
      expect(queryCall).toBeDefined();
    });
  });

  describe('getAuthorUnlinkedCommits', () => {
    it('should return unlinked commits', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { sha: 'abc123', commit_message: 'Fix IQS-42', branch: 'feature/IQS-42' },
        ],
        rowCount: 1,
      });

      const commits = await repo.getAuthorUnlinkedCommits('john', false, false);

      expect(commits).toHaveLength(1);
      expect(commits[0]).toEqual({
        author: 'john',
        sha: 'abc123',
        msg: 'Fix IQS-42',
      });
    });

    it('should combine message and branch when combine=true', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { sha: 'abc123', commit_message: 'Fix bug', branch: 'feature/IQS-42' },
        ],
        rowCount: 1,
      });

      const commits = await repo.getAuthorUnlinkedCommits('john', false, true);

      expect(commits[0]!.msg).toBe('Fix bug_feature/IQS-42');
    });
  });

  describe('batchUpdateIsLinearRef', () => {
    it('should skip empty arrays', async () => {
      const callCountBefore = mockQuery.mock.calls.length;
      await repo.batchUpdateIsLinearRef([]);
      expect(mockQuery.mock.calls.length).toBe(callCountBefore);
    });

    it('should update is_linear_ref flags in a transaction', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      await repo.batchUpdateIsLinearRef([
        { sha: 'abc123', isLinearRef: true },
        { sha: 'def456', isLinearRef: false },
      ]);

      // Verify UPDATE calls
      const updateCalls = mockQuery.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('UPDATE commit_history SET is_linear_ref'),
      );
      expect(updateCalls.length).toBe(2);
      expect(updateCalls[0]![1]).toEqual(['abc123', true]);
      expect(updateCalls[1]![1]).toEqual(['def456', false]);
    });
  });
});
