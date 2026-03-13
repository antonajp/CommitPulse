import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import {
  CommitRepository,
  type CommitHistoryRow,
  type CommitFileRow,
  type CommitFileTypeRow,
  type CommitDirectoryRow,
  type CommitTagRow,
  type CommitWordRow,
} from '../../database/commit-repository.js';

/**
 * Unit tests for CommitRepository class.
 *
 * Tests all insert and query methods using a mocked DatabaseService.
 * No real database is required -- the mock captures all SQL and params
 * to verify parameterized queries and correct data flow.
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

/**
 * Helper: create a sample CommitHistoryRow.
 */
function createSampleCommit(overrides?: Partial<CommitHistoryRow>): CommitHistoryRow {
  return {
    sha: 'abc123def456789012345678901234567890abcd',
    url: 'https://github.com/org/repo/commit/abc123def456789012345678901234567890abcd',
    branch: 'main',
    repository: 'test-repo',
    repositoryUrl: 'https://github.com/org/test-repo.git',
    author: 'testuser',
    commitDate: new Date('2024-01-15T10:30:00Z'),
    commitMessage: 'feat: add new feature IQS-100',
    fileCount: 3,
    linesAdded: 50,
    linesRemoved: 10,
    isMerge: false,
    isJiraRef: true,
    organization: 'TestOrg',
    ...overrides,
  };
}

/**
 * Helper: create a sample CommitFileRow.
 */
function createSampleFile(overrides?: Partial<CommitFileRow>): CommitFileRow {
  return {
    sha: 'abc123def456789012345678901234567890abcd',
    filename: 'src/main.ts',
    fileExtension: '.ts',
    lineInserts: 20,
    lineDeletes: 5,
    lineDiff: 15,
    totalLines: 100,
    totalCodeLines: 80,
    totalCommentLines: 10,
    complexity: 5,
    weightedComplexity: 12,
    author: 'testuser',
    parentDirectory: 'src',
    subDirectory: '',
    isTestFile: false,
    complexityChange: null,
    commentsChange: null,
    codeChange: null,
    ...overrides,
  };
}

describe('CommitRepository', () => {
  let dbService: DatabaseService;
  let repo: CommitRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createTestConfig());
    repo = new CommitRepository(dbService);
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // --------------------------------------------------------------------------
  // Insert methods
  // --------------------------------------------------------------------------

  describe('insertCommitHistory', () => {
    it('should insert a commit with parameterized SQL', async () => {
      const commit = createSampleCommit();
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await repo.insertCommitHistory(commit);

      // Find the INSERT call (skip BEGIN/health check calls)
      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_history'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toEqual([
        commit.sha,
        commit.url,
        commit.branch,
        commit.repository,
        commit.repositoryUrl,
        commit.author,
        commit.commitDate,
        commit.commitMessage,
        commit.fileCount,
        commit.linesAdded,
        commit.linesRemoved,
        commit.isMerge,
        commit.isJiraRef,
        commit.organization,
      ]);
    });

    it('should handle ON CONFLICT gracefully for duplicate SHAs', async () => {
      const commit = createSampleCommit();
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ON CONFLICT = 0 rows

      // Should not throw
      await expect(repo.insertCommitHistory(commit)).resolves.not.toThrow();
    });
  });

  describe('insertCommitFiles', () => {
    it('should batch insert files in a transaction', async () => {
      const callOrder: string[] = [];
      mockQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string') {
          callOrder.push(sql.trim().substring(0, 30));
        }
        return { rows: [], rowCount: 1 };
      });

      const files = [
        createSampleFile({ filename: 'src/a.ts' }),
        createSampleFile({ filename: 'src/b.ts' }),
      ];

      await repo.insertCommitFiles('abc123', files);

      // Verify transaction boundaries
      expect(callOrder.some((s) => s.includes('BEGIN'))).toBe(true);
      expect(callOrder.some((s) => s.includes('COMMIT'))).toBe(true);
    });

    it('should skip insert when files array is empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.insertCommitFiles('abc123', []);
      // No new query calls should have been made
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });

    it('should pass all file fields as parameterized values', async () => {
      const file = createSampleFile();
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      await repo.insertCommitFiles(file.sha, [file]);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_files'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toEqual([
        file.sha,
        file.filename,
        file.fileExtension,
        file.lineInserts,
        file.lineDeletes,
        file.lineDiff,
        file.totalLines,
        file.totalCodeLines,
        file.totalCommentLines,
        file.complexity,
        file.weightedComplexity,
        file.author,
        file.parentDirectory,
        file.subDirectory,
        file.isTestFile,
        file.complexityChange,
        file.commentsChange,
        file.codeChange,
      ]);
    });
  });

  describe('insertCommitFileTypes', () => {
    it('should batch insert file types in a transaction', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const types: CommitFileTypeRow[] = [
        { sha: 'abc123', fileExtension: '.ts', numCount: 3, author: 'user', parentDirectory: 'src', subDirectory: 'services' },
        { sha: 'abc123', fileExtension: '.json', numCount: 1, author: 'user', parentDirectory: 'root', subDirectory: '' },
      ];

      await repo.insertCommitFileTypes('abc123', types);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_files_types'),
      );
      expect(insertCall).toBeDefined();
    });

    it('should skip insert when types array is empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.insertCommitFileTypes('abc123', []);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('insertCommitDirectories', () => {
    it('should batch insert directories in a transaction', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const dirs: CommitDirectoryRow[] = [
        { sha: 'abc123', directory: 'src', subdirectory: 'services', author: 'user' },
      ];

      await repo.insertCommitDirectories('abc123', dirs);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_directory'),
      );
      expect(insertCall).toBeDefined();
    });

    it('should skip insert when dirs array is empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.insertCommitDirectories('abc123', []);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('insertCommitBranchRelationship', () => {
    it('should insert branch relationship with parameterized SQL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const date = new Date('2024-01-15T10:30:00Z');

      await repo.insertCommitBranchRelationship('abc123', 'feature/test', 'user', date);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_branch_relationship'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toEqual(['abc123', 'feature/test', 'user', date]);
    });
  });

  describe('insertCommitTags', () => {
    it('should batch insert tags in a transaction', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const tags: CommitTagRow[] = [
        { sha: 'abc123', tag: 'v1.0.0', author: 'user' },
        { sha: 'abc123', tag: 'release-1.0', author: 'user' },
      ];

      await repo.insertCommitTags('abc123', tags);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_tags'),
      );
      expect(insertCall).toBeDefined();
    });

    it('should skip insert when tags array is empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.insertCommitTags('abc123', []);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('insertCommitWords', () => {
    it('should batch insert words in a transaction', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const words: CommitWordRow[] = [
        { sha: 'abc123', word: 'feat', author: 'user' },
        { sha: 'abc123', word: 'add', author: 'user' },
        { sha: 'abc123', word: 'feature', author: 'user' },
      ];

      await repo.insertCommitWords('abc123', words);

      const insertCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_msg_words'),
      );
      expect(insertCalls.length).toBe(3);
    });

    it('should skip insert when words array is empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.insertCommitWords('abc123', []);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  // --------------------------------------------------------------------------
  // Query methods
  // --------------------------------------------------------------------------

  describe('getKnownShasForRepo', () => {
    it('should return set of SHAs for the given repo', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ sha: 'sha1' }, { sha: 'sha2' }, { sha: 'sha3' }],
        rowCount: 3,
      });

      const result = await repo.getKnownShasForRepo('test-repo');

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(3);
      expect(result.has('sha1')).toBe(true);
      expect(result.has('sha2')).toBe(true);
      expect(result.has('sha3')).toBe(true);
    });

    it('should pass repo as parameterized value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getKnownShasForRepo('my-repo');

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('SELECT DISTINCT sha'),
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual(['my-repo']);
    });

    it('should return empty set when no SHAs found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await repo.getKnownShasForRepo('empty-repo');
      expect(result.size).toBe(0);
    });
  });

  describe('getKnownCommitBranchRelationships', () => {
    it('should return map of SHA to branch arrays', async () => {
      // IQS-941: Test data no longer includes sentinel value since we use INNER JOIN
      // Only commits with actual branch relationships are returned
      mockQuery.mockResolvedValueOnce({
        rows: [
          { sha: 'sha1', branch: 'main' },
          { sha: 'sha1', branch: 'develop' },
          { sha: 'sha2', branch: 'feature/test' },
        ],
        rowCount: 3,
      });

      const result = await repo.getKnownCommitBranchRelationships('test-repo');

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get('sha1')).toEqual(['main', 'develop']);
      expect(result.get('sha2')).toEqual(['feature/test']);
    });

    it('should pass repo as parameterized value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getKnownCommitBranchRelationships('my-repo');

      // IQS-941: Changed from LEFT JOIN with COALESCE to INNER JOIN
      // Now looking for INNER JOIN pattern instead of COALESCE
      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INNER JOIN'),
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual(['my-repo']);
    });
  });

  describe('getUnlinkedCommits', () => {
    it('should return unlinked commits when refresh=false', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { sha: 'sha1', commit_message: 'fix: something' },
          { sha: 'sha2', commit_message: 'chore: update deps' },
        ],
        rowCount: 2,
      });

      const result = await repo.getUnlinkedCommits(false);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get('sha1')).toBe('fix: something');
      expect(result.get('sha2')).toBe('chore: update deps');
    });

    it('should return all commits when refresh=true', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ sha: 'sha1', commit_message: 'msg1' }],
        rowCount: 1,
      });

      await repo.getUnlinkedCommits(true);

      // Verify the SQL used does NOT have the NOT EXISTS clause
      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('SELECT ch.sha, ch.commit_message FROM commit_history ch') && !(c[0] as string).includes('NOT EXISTS'),
      );
      expect(selectCall).toBeDefined();
    });

    it('should use NOT EXISTS query when refresh=false', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getUnlinkedCommits(false);

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('NOT EXISTS'),
      );
      expect(selectCall).toBeDefined();
    });
  });

  describe('identifyUnknownCommitAuthors', () => {
    it('should return array of AuthorCount objects', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { author: 'unknown1', repository: 'repo1', cnt: 5 },
          { author: 'unknown2', repository: 'repo1', cnt: 3 },
        ],
        rowCount: 2,
      });

      const result = await repo.identifyUnknownCommitAuthors('repo1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ author: 'unknown1', repo: 'repo1', count: 5 });
      expect(result[1]).toEqual({ author: 'unknown2', repo: 'repo1', count: 3 });
    });

    it('should pass repo as parameterized value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.identifyUnknownCommitAuthors('my-repo');

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('commit_contributors'),
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual(['my-repo']);
    });
  });

  describe('identifyGitRepoMaxCommitDate', () => {
    it('should return array of RepoDate objects', async () => {
      const date1 = new Date('2024-01-01T00:00:00Z');
      const date2 = new Date('2024-06-15T00:00:00Z');

      mockQuery.mockResolvedValueOnce({
        rows: [
          { repository: 'repo-old', mcd: date1 },
          { repository: 'repo-new', mcd: date2 },
        ],
        rowCount: 2,
      });

      const result = await repo.identifyGitRepoMaxCommitDate();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ repo: 'repo-old', maxDate: date1 });
      expect(result[1]).toEqual({ repo: 'repo-new', maxDate: date2 });
    });

    it('should return empty array when no commits exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await repo.identifyGitRepoMaxCommitDate();
      expect(result).toHaveLength(0);
    });
  });

  describe('getCommitFileBaseMetrics', () => {
    it('should return metrics for a specific file', async () => {
      const date = new Date('2024-03-01T10:00:00Z');
      mockQuery.mockResolvedValueOnce({
        rows: [{
          sha: 'sha1',
          commit_date: date,
          filename: 'src/main.ts',
          complexity: 10,
          total_comment_lines: 20,
          total_code_lines: 80,
        }],
        rowCount: 1,
      });

      const result = await repo.getCommitFileBaseMetrics('src/main.ts');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        sha: 'sha1',
        commitDate: date,
        filename: 'src/main.ts',
        complexity: 10,
        totalCommentLines: 20,
        totalCodeLines: 80,
      });
    });

    it('should pass filename as parameterized value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getCommitFileBaseMetrics('src/test.ts');

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('commit_files cf'),
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual(['src/test.ts']);
    });
  });

  describe('getUniqueFilesModifiedSince', () => {
    it('should return filenames modified since date', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { filename: 'src/a.ts', cnt: 3 },
          { filename: 'src/b.ts', cnt: 2 },
        ],
        rowCount: 2,
      });

      const result = await repo.getUniqueFilesModifiedSince('2024-01-01');

      expect(result).toHaveLength(2);
      expect(result).toContain('src/a.ts');
      expect(result).toContain('src/b.ts');
    });

    it('should pass date as parameterized value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getUniqueFilesModifiedSince('2024-06-01');

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('HAVING COUNT'),
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual(['2024-06-01']);
    });
  });

  // --------------------------------------------------------------------------
  // Jira ref update methods (IQS-861)
  // --------------------------------------------------------------------------

  describe('batchUpdateIsJiraRef', () => {
    it('should batch update is_jira_ref in a transaction', async () => {
      const callOrder: string[] = [];
      mockQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string') {
          callOrder.push(sql.trim().substring(0, 30));
        }
        return { rows: [], rowCount: 1 };
      });

      const updates = [
        { sha: 'sha1', isJiraRef: true },
        { sha: 'sha2', isJiraRef: false },
      ];

      await repo.batchUpdateIsJiraRef(updates);

      expect(callOrder.some((s) => s.includes('BEGIN'))).toBe(true);
      expect(callOrder.some((s) => s.includes('COMMIT'))).toBe(true);
    });

    it('should skip update when array is empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.batchUpdateIsJiraRef([]);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('getCommitContributorLogins', () => {
    it('should return distinct author logins', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { author: 'user1' },
          { author: 'user2' },
          { author: 'user3' },
        ],
        rowCount: 3,
      });

      const result = await repo.getCommitContributorLogins();

      expect(result).toHaveLength(3);
      expect(result).toContain('user1');
      expect(result).toContain('user2');
      expect(result).toContain('user3');
    });

    it('should return empty array when no authors exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await repo.getCommitContributorLogins();
      expect(result).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // SQL injection prevention verification
  // --------------------------------------------------------------------------

  describe('SQL injection prevention', () => {
    it('should never use string interpolation in SQL queries', async () => {
      // Check that all SQL constants are static strings without template literals
      // This is a meta-test to verify the codebase pattern
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await repo.getKnownShasForRepo("'; DROP TABLE commit_history; --");

      // Verify the malicious input was passed as a parameter, not interpolated
      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('SELECT DISTINCT sha'),
      );
      expect(selectCall).toBeDefined();
      const sql = selectCall![0] as string;
      // SQL should NOT contain the injection string
      expect(sql).not.toContain('DROP TABLE');
      // But the params should contain it
      expect(selectCall![1]).toEqual(["'; DROP TABLE commit_history; --"]);
    });
  });
});
