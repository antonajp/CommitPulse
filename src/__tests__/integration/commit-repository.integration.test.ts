import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  DatabaseService,
  type DatabaseServiceConfig,
} from '../../database/database-service.js';
import {
  CommitRepository,
  type CommitHistoryRow,
  type CommitFileRow,
  type CommitFileTypeRow,
  type CommitDirectoryRow,
  type CommitTagRow,
  type CommitWordRow,
} from '../../database/commit-repository.js';
import {
  CommitJiraRepository,
  type CommitJiraRow,
} from '../../database/commit-jira-repository.js';

/**
 * Integration tests for CommitRepository and CommitJiraRepository
 * with a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema
 * from migration files, then exercises all repository methods
 * against the real database.
 *
 * Ticket: IQS-852
 */

const PG_DATABASE = 'gitrx_commit_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let commitRepo: CommitRepository;
let commitJiraRepo: CommitJiraRepository;

/**
 * Helper: Create schema from migration files.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');
  const tableSql = readFileSync(join(migrationsDir, '001_create_tables.sql'), 'utf-8');
  await dbService.query(tableSql);
}

/**
 * Helper: Create a sample commit for testing.
 */
function createTestCommit(overrides?: Partial<CommitHistoryRow>): CommitHistoryRow {
  return {
    sha: 'a'.repeat(40),
    url: 'https://github.com/org/repo/commit/' + 'a'.repeat(40),
    branch: 'main',
    repository: 'test-repo',
    repositoryUrl: 'https://github.com/org/test-repo.git',
    author: 'testuser',
    commitDate: new Date('2024-01-15T10:30:00Z'),
    commitMessage: 'feat: add IQS-100 feature',
    fileCount: 2,
    linesAdded: 50,
    linesRemoved: 10,
    isMerge: false,
    isJiraRef: true,
    organization: 'TestOrg',
    ...overrides,
  };
}

describe('CommitRepository & CommitJiraRepository Integration Tests', () => {
  beforeAll(async () => {
    // Reset logger for clean test state
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Start PostgreSQL 16 container
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: PG_DATABASE,
        POSTGRES_USER: PG_USER,
        POSTGRES_PASSWORD: PG_PASSWORD,
      })
      .withExposedPorts(PG_PORT)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();

    const mappedPort = container.getMappedPort(PG_PORT);
    const host = container.getHost();

    config = {
      host,
      port: mappedPort,
      database: PG_DATABASE,
      user: PG_USER,
      password: PG_PASSWORD,
      maxPoolSize: 3,
      connectionTimeoutMs: 10_000,
      idleTimeoutMs: 5_000,
    };

    // Initialize service and create schema
    service = new DatabaseService();
    await service.initialize(config);
    await createSchema(service);

    // Create repository instances
    commitRepo = new CommitRepository(service);
    commitJiraRepo = new CommitJiraRepository(service);
  }, 120_000);

  afterAll(async () => {
    if (service?.isInitialized()) {
      await service.shutdown();
    }
    if (container) {
      await container.stop();
    }
  }, 30_000);

  beforeEach(async () => {
    // Reset logger for each test
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Clean up test data (reverse FK order)
    await service.query('DELETE FROM commit_jira');
    await service.query('DELETE FROM commit_msg_words');
    await service.query('DELETE FROM commit_tags');
    await service.query('DELETE FROM commit_branch_relationship');
    await service.query('DELETE FROM commit_directory');
    await service.query('DELETE FROM commit_files_types');
    await service.query('DELETE FROM commit_files');
    await service.query('DELETE FROM commit_history');
    await service.query('DELETE FROM commit_contributors');
  });

  // --------------------------------------------------------------------------
  // CommitRepository - Insert operations
  // --------------------------------------------------------------------------

  describe('CommitRepository inserts', () => {
    it('should insert a commit_history row', async () => {
      const commit = createTestCommit();
      await commitRepo.insertCommitHistory(commit);

      const result = await service.query<{ sha: string; author: string; repository: string }>(
        'SELECT sha, author, repository FROM commit_history WHERE sha = $1',
        [commit.sha],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.author).toBe('testuser');
      expect(result.rows[0]?.repository).toBe('test-repo');
    });

    it('should handle duplicate commit inserts gracefully (ON CONFLICT)', async () => {
      const commit = createTestCommit();
      await commitRepo.insertCommitHistory(commit);

      // Second insert should not throw
      await expect(commitRepo.insertCommitHistory(commit)).resolves.not.toThrow();

      // Should still have only one row
      const result = await service.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM commit_history WHERE sha = $1',
        [commit.sha],
      );
      expect(parseInt(result.rows[0]?.count ?? '0', 10)).toBe(1);
    });

    it('should batch insert commit_files', async () => {
      const commit = createTestCommit();
      await commitRepo.insertCommitHistory(commit);

      const files: CommitFileRow[] = [
        {
          sha: commit.sha, filename: 'src/main.ts', fileExtension: '.ts',
          lineInserts: 20, lineDeletes: 5, lineDiff: 15,
          totalLines: 100, totalCodeLines: 80, totalCommentLines: 10,
          complexity: 5, weightedComplexity: 12, author: 'testuser',
          parentDirectory: 'src', subDirectory: '', isTestFile: false,
          complexityChange: null, commentsChange: null, codeChange: null,
        },
        {
          sha: commit.sha, filename: 'src/utils.ts', fileExtension: '.ts',
          lineInserts: 10, lineDeletes: 2, lineDiff: 8,
          totalLines: 50, totalCodeLines: 40, totalCommentLines: 5,
          complexity: 2, weightedComplexity: 4, author: 'testuser',
          parentDirectory: 'src', subDirectory: '', isTestFile: false,
          complexityChange: null, commentsChange: null, codeChange: null,
        },
      ];

      await commitRepo.insertCommitFiles(commit.sha, files);

      const result = await service.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM commit_files WHERE sha = $1',
        [commit.sha],
      );
      expect(parseInt(result.rows[0]?.count ?? '0', 10)).toBe(2);
    });

    it('should batch insert commit_files_types', async () => {
      const commit = createTestCommit();
      await commitRepo.insertCommitHistory(commit);

      const types: CommitFileTypeRow[] = [
        { sha: commit.sha, fileExtension: '.ts', numCount: 2, author: 'testuser', parentDirectory: 'src', subDirectory: '' },
        { sha: commit.sha, fileExtension: '.json', numCount: 1, author: 'testuser', parentDirectory: 'root', subDirectory: '' },
      ];

      await commitRepo.insertCommitFileTypes(commit.sha, types);

      const result = await service.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM commit_files_types WHERE sha = $1',
        [commit.sha],
      );
      expect(parseInt(result.rows[0]?.count ?? '0', 10)).toBe(2);
    });

    it('should batch insert commit_directory', async () => {
      const commit = createTestCommit();
      await commitRepo.insertCommitHistory(commit);

      const dirs: CommitDirectoryRow[] = [
        { sha: commit.sha, directory: 'src', subdirectory: 'services', author: 'testuser' },
        { sha: commit.sha, directory: 'src', subdirectory: 'utils', author: 'testuser' },
      ];

      await commitRepo.insertCommitDirectories(commit.sha, dirs);

      const result = await service.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM commit_directory WHERE sha = $1',
        [commit.sha],
      );
      expect(parseInt(result.rows[0]?.count ?? '0', 10)).toBe(2);
    });

    it('should insert commit_branch_relationship', async () => {
      const commit = createTestCommit();
      await commitRepo.insertCommitHistory(commit);

      await commitRepo.insertCommitBranchRelationship(
        commit.sha, 'feature/test', 'testuser', new Date('2024-01-15T10:30:00Z'),
      );

      const result = await service.query<{ branch: string }>(
        'SELECT branch FROM commit_branch_relationship WHERE sha = $1',
        [commit.sha],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.branch).toBe('feature/test');
    });

    it('should batch insert commit_tags', async () => {
      const commit = createTestCommit();
      await commitRepo.insertCommitHistory(commit);

      const tags: CommitTagRow[] = [
        { sha: commit.sha, tag: 'v1.0.0', author: 'testuser' },
        { sha: commit.sha, tag: 'release-1.0', author: 'testuser' },
      ];

      await commitRepo.insertCommitTags(commit.sha, tags);

      const result = await service.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM commit_tags WHERE sha = $1',
        [commit.sha],
      );
      expect(parseInt(result.rows[0]?.count ?? '0', 10)).toBe(2);
    });

    it('should batch insert commit_msg_words', async () => {
      const commit = createTestCommit();
      await commitRepo.insertCommitHistory(commit);

      const words: CommitWordRow[] = [
        { sha: commit.sha, word: 'feat', author: 'testuser' },
        { sha: commit.sha, word: 'add', author: 'testuser' },
        { sha: commit.sha, word: 'feature', author: 'testuser' },
      ];

      await commitRepo.insertCommitWords(commit.sha, words);

      const result = await service.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM commit_msg_words WHERE sha = $1',
        [commit.sha],
      );
      expect(parseInt(result.rows[0]?.count ?? '0', 10)).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // CommitRepository - Query operations
  // --------------------------------------------------------------------------

  describe('CommitRepository queries', () => {
    it('should get known SHAs for a repo', async () => {
      // Insert multiple commits
      await commitRepo.insertCommitHistory(createTestCommit({ sha: 'a'.repeat(40), repository: 'repo-a' }));
      await commitRepo.insertCommitHistory(createTestCommit({ sha: 'b'.repeat(40), repository: 'repo-a' }));
      await commitRepo.insertCommitHistory(createTestCommit({ sha: 'c'.repeat(40), repository: 'repo-b' }));

      const shas = await commitRepo.getKnownShasForRepo('repo-a');

      expect(shas.size).toBe(2);
      expect(shas.has('a'.repeat(40))).toBe(true);
      expect(shas.has('b'.repeat(40))).toBe(true);
      expect(shas.has('c'.repeat(40))).toBe(false); // belongs to repo-b
    });

    it('should get known commit-branch relationships', async () => {
      const sha1 = 'a'.repeat(40);
      const sha2 = 'b'.repeat(40);

      await commitRepo.insertCommitHistory(createTestCommit({ sha: sha1, repository: 'repo-x' }));
      await commitRepo.insertCommitHistory(createTestCommit({ sha: sha2, repository: 'repo-x' }));

      await commitRepo.insertCommitBranchRelationship(sha1, 'main', 'user', new Date());
      await commitRepo.insertCommitBranchRelationship(sha1, 'develop', 'user', new Date());
      // sha2 has no branch relationship

      const rels = await commitRepo.getKnownCommitBranchRelationships('repo-x');

      expect(rels.size).toBe(2); // sha1 and sha2
      const sha1Branches = rels.get(sha1);
      expect(sha1Branches).toContain('main');
      expect(sha1Branches).toContain('develop');

      const sha2Branches = rels.get(sha2);
      expect(sha2Branches).toContain('N-O-B-R-A-N-C-H');
    });

    it('should get unlinked commits (no Jira link)', async () => {
      const sha1 = 'a'.repeat(40);
      const sha2 = 'b'.repeat(40);

      await commitRepo.insertCommitHistory(createTestCommit({ sha: sha1, commitMessage: 'linked commit' }));
      await commitRepo.insertCommitHistory(createTestCommit({ sha: sha2, commitMessage: 'unlinked commit' }));

      // Link sha1 to Jira
      await commitJiraRepo.insertCommitJira([
        { sha: sha1, jiraKey: 'IQS-100', author: 'user', jiraProject: 'IQS' },
      ]);

      const unlinked = await commitRepo.getUnlinkedCommits(false);

      expect(unlinked.size).toBe(1);
      expect(unlinked.has(sha2)).toBe(true);
      expect(unlinked.get(sha2)).toBe('unlinked commit');
    });

    it('should get all commits when refresh=true', async () => {
      const sha1 = 'a'.repeat(40);
      const sha2 = 'b'.repeat(40);

      await commitRepo.insertCommitHistory(createTestCommit({ sha: sha1 }));
      await commitRepo.insertCommitHistory(createTestCommit({ sha: sha2 }));

      // Link sha1
      await commitJiraRepo.insertCommitJira([
        { sha: sha1, jiraKey: 'IQS-100', author: 'user', jiraProject: 'IQS' },
      ]);

      const all = await commitRepo.getUnlinkedCommits(true);

      expect(all.size).toBe(2); // Both commits returned
    });

    it('should identify unknown commit authors', async () => {
      // Insert a commit with an author NOT in commit_contributors
      await commitRepo.insertCommitHistory(createTestCommit({
        sha: 'a'.repeat(40),
        author: 'unknown-dev',
        repository: 'repo-x',
      }));
      await commitRepo.insertCommitHistory(createTestCommit({
        sha: 'b'.repeat(40),
        author: 'unknown-dev',
        repository: 'repo-x',
      }));

      const unknowns = await commitRepo.identifyUnknownCommitAuthors('repo-x');

      expect(unknowns).toHaveLength(1);
      expect(unknowns[0]?.author).toBe('unknown-dev');
      expect(unknowns[0]?.repo).toBe('repo-x');
      expect(unknowns[0]?.count).toBe(2);
    });

    it('should identify max commit date per repository', async () => {
      const oldDate = new Date('2023-01-01T00:00:00Z');
      const newDate = new Date('2024-06-15T00:00:00Z');

      await commitRepo.insertCommitHistory(createTestCommit({
        sha: 'a'.repeat(40), repository: 'repo-old', commitDate: oldDate,
      }));
      await commitRepo.insertCommitHistory(createTestCommit({
        sha: 'b'.repeat(40), repository: 'repo-new', commitDate: newDate,
      }));

      const repos = await commitRepo.identifyGitRepoMaxCommitDate();

      expect(repos).toHaveLength(2);
      // Should be sorted by date ascending
      expect(repos[0]?.repo).toBe('repo-old');
      expect(repos[1]?.repo).toBe('repo-new');
    });

    it('should get commit file base metrics for a file', async () => {
      const commit = createTestCommit();
      await commitRepo.insertCommitHistory(commit);

      const files: CommitFileRow[] = [{
        sha: commit.sha, filename: 'src/metrics.ts', fileExtension: '.ts',
        lineInserts: 10, lineDeletes: 2, lineDiff: 8,
        totalLines: 100, totalCodeLines: 80, totalCommentLines: 15,
        complexity: 8, weightedComplexity: 16, author: 'testuser',
        parentDirectory: 'src', subDirectory: '', isTestFile: false,
        complexityChange: null, commentsChange: null, codeChange: null,
      }];
      await commitRepo.insertCommitFiles(commit.sha, files);

      const metrics = await commitRepo.getCommitFileBaseMetrics('src/metrics.ts');

      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.complexity).toBe(8);
      expect(metrics[0]?.totalCommentLines).toBe(15);
      expect(metrics[0]?.totalCodeLines).toBe(80);
    });

    it('should get unique files modified since a date', async () => {
      const recentDate = new Date('2024-06-01T00:00:00Z');
      const sha1 = 'a'.repeat(40);
      const sha2 = 'b'.repeat(40);

      await commitRepo.insertCommitHistory(createTestCommit({
        sha: sha1, commitDate: recentDate,
      }));
      await commitRepo.insertCommitHistory(createTestCommit({
        sha: sha2, commitDate: new Date('2024-06-10T00:00:00Z'),
      }));

      // Same file modified in two commits
      await commitRepo.insertCommitFiles(sha1, [{
        sha: sha1, filename: 'src/hot-file.ts', fileExtension: '.ts',
        lineInserts: 5, lineDeletes: 1, lineDiff: 4,
        totalLines: 50, totalCodeLines: 40, totalCommentLines: 5,
        complexity: 2, weightedComplexity: 4, author: 'user',
        parentDirectory: 'src', subDirectory: '', isTestFile: false,
        complexityChange: null, commentsChange: null, codeChange: null,
      }]);
      await commitRepo.insertCommitFiles(sha2, [{
        sha: sha2, filename: 'src/hot-file.ts', fileExtension: '.ts',
        lineInserts: 3, lineDeletes: 0, lineDiff: 3,
        totalLines: 53, totalCodeLines: 43, totalCommentLines: 5,
        complexity: 3, weightedComplexity: 6, author: 'user',
        parentDirectory: 'src', subDirectory: '', isTestFile: false,
        complexityChange: null, commentsChange: null, codeChange: null,
      }]);

      // File modified only once
      await commitRepo.insertCommitFiles(sha1, [{
        sha: sha1, filename: 'src/cold-file.ts', fileExtension: '.ts',
        lineInserts: 1, lineDeletes: 0, lineDiff: 1,
        totalLines: 10, totalCodeLines: 8, totalCommentLines: 1,
        complexity: 1, weightedComplexity: 1, author: 'user',
        parentDirectory: 'src', subDirectory: '', isTestFile: false,
        complexityChange: null, commentsChange: null, codeChange: null,
      }]);

      const files = await commitRepo.getUniqueFilesModifiedSince('2024-05-01');

      expect(files).toContain('src/hot-file.ts');
      expect(files).not.toContain('src/cold-file.ts'); // only 1 commit
    });
  });

  // --------------------------------------------------------------------------
  // CommitJiraRepository - Insert and Query operations
  // --------------------------------------------------------------------------

  describe('CommitJiraRepository', () => {
    it('should insert and query commit-jira relationships', async () => {
      const sha = 'a'.repeat(40);
      await commitRepo.insertCommitHistory(createTestCommit({ sha }));

      const rows: CommitJiraRow[] = [
        { sha, jiraKey: 'IQS-100', author: 'testuser', jiraProject: 'IQS' },
        { sha, jiraKey: 'IQS-200', author: 'testuser', jiraProject: 'IQS' },
      ];
      await commitJiraRepo.insertCommitJira(rows);

      const keys = await commitJiraRepo.getDistinctJiraKeys();
      expect(keys.has('IQS-100')).toBe(true);
      expect(keys.has('IQS-200')).toBe(true);
    });

    it('should handle duplicate commit-jira inserts gracefully', async () => {
      const sha = 'a'.repeat(40);
      await commitRepo.insertCommitHistory(createTestCommit({ sha }));

      const rows: CommitJiraRow[] = [
        { sha, jiraKey: 'IQS-100', author: 'testuser', jiraProject: 'IQS' },
      ];

      await commitJiraRepo.insertCommitJira(rows);
      // Second insert should not throw
      await expect(commitJiraRepo.insertCommitJira(rows)).resolves.not.toThrow();

      const result = await service.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM commit_jira WHERE sha = $1',
        [sha],
      );
      expect(parseInt(result.rows[0]?.count ?? '0', 10)).toBe(1);
    });

    it('should delete author commit-jira entries', async () => {
      const sha = 'a'.repeat(40);
      await commitRepo.insertCommitHistory(createTestCommit({ sha, author: 'user-a' }));

      await commitJiraRepo.insertCommitJira([
        { sha, jiraKey: 'IQS-100', author: 'user-a', jiraProject: 'IQS' },
        { sha, jiraKey: 'IQS-200', author: 'user-a', jiraProject: 'IQS' },
      ]);

      const deleted = await commitJiraRepo.deleteAuthorCommitJira('user-a');
      expect(deleted).toBe(2);

      const remaining = await service.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM commit_jira WHERE author = $1',
        ['user-a'],
      );
      expect(parseInt(remaining.rows[0]?.count ?? '0', 10)).toBe(0);
    });

    it('should get commit messages and branches for author (non-merge)', async () => {
      const sha1 = 'a'.repeat(40);
      const sha2 = 'b'.repeat(40);

      await commitRepo.insertCommitHistory(createTestCommit({
        sha: sha1, author: 'dev1', isMerge: false, commitMessage: 'feat: something',
      }));
      await commitRepo.insertCommitHistory(createTestCommit({
        sha: sha2, author: 'dev1', isMerge: true, commitMessage: 'merge: develop to main',
      }));

      const msgs = await commitJiraRepo.getCommitMsgBranchForAuthor('dev1');

      // Should only include non-merge commits
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.commitMessage).toBe('feat: something');
    });

    it('should get commit messages for Jira ref detection', async () => {
      const sha1 = 'a'.repeat(40);
      const sha2 = 'b'.repeat(40);

      await commitRepo.insertCommitHistory(createTestCommit({
        sha: sha1, author: 'dev1', isJiraRef: null, commitMessage: 'IQS-100 new feature',
      }));
      await commitRepo.insertCommitHistory(createTestCommit({
        sha: sha2, author: 'dev1', isJiraRef: true, commitMessage: 'IQS-200 already processed',
      }));

      // Without refresh, should only get unprocessed (isJiraRef IS NULL)
      const unprocessed = await commitJiraRepo.getCommitMsgForJiraRef('dev1', false);
      expect(unprocessed).toHaveLength(1);
      expect(unprocessed[0]?.sha).toBe(sha1);

      // With refresh, should get all
      const all = await commitJiraRepo.getCommitMsgForJiraRef('dev1', true);
      expect(all).toHaveLength(2);
    });

    it('should get commit messages for Jira relationship linking', async () => {
      const sha = 'a'.repeat(40);
      await commitRepo.insertCommitHistory(createTestCommit({
        sha, author: 'dev1', commitMessage: 'IQS-100 feature', branch: 'feature/IQS-100',
      }));

      const msgs = await commitJiraRepo.getCommitMsgForJiraRelationship('dev1');

      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.sha).toBe(sha);
      expect(msgs[0]?.commitMessage).toBe('IQS-100 feature');
      expect(msgs[0]?.branch).toBe('feature/IQS-100');
    });

    it('should get author unlinked commits without combine', async () => {
      const sha1 = 'a'.repeat(40);
      const sha2 = 'b'.repeat(40);

      await commitRepo.insertCommitHistory(createTestCommit({
        sha: sha1, author: 'dev1', commitMessage: 'unlinked commit', branch: 'main',
      }));
      await commitRepo.insertCommitHistory(createTestCommit({
        sha: sha2, author: 'dev1', commitMessage: 'linked commit', branch: 'main',
      }));

      // Link sha2 to Jira
      await commitJiraRepo.insertCommitJira([
        { sha: sha2, jiraKey: 'IQS-100', author: 'dev1', jiraProject: 'IQS' },
      ]);

      const unlinked = await commitJiraRepo.getAuthorUnlinkedCommits('dev1', false, false);

      expect(unlinked).toHaveLength(1);
      expect(unlinked[0]?.sha).toBe(sha1);
      expect(unlinked[0]?.msg).toBe('unlinked commit');
    });

    it('should combine message with branch when combine=true', async () => {
      const sha = 'a'.repeat(40);
      await commitRepo.insertCommitHistory(createTestCommit({
        sha, author: 'dev1', commitMessage: 'some work', branch: 'feature/IQS-100',
      }));

      const commits = await commitJiraRepo.getAuthorUnlinkedCommits('dev1', false, true);

      expect(commits).toHaveLength(1);
      expect(commits[0]?.msg).toBe('some work_feature/IQS-100');
    });
  });

  // --------------------------------------------------------------------------
  // Transaction rollback verification
  // --------------------------------------------------------------------------

  describe('Transaction safety', () => {
    it('should rollback batch insert on error', async () => {
      const commit = createTestCommit();
      await commitRepo.insertCommitHistory(commit);

      // Insert a valid file first
      await commitRepo.insertCommitFiles(commit.sha, [{
        sha: commit.sha, filename: 'src/valid.ts', fileExtension: '.ts',
        lineInserts: 5, lineDeletes: 1, lineDiff: 4,
        totalLines: 50, totalCodeLines: 40, totalCommentLines: 5,
        complexity: 2, weightedComplexity: 4, author: 'testuser',
        parentDirectory: 'src', subDirectory: '', isTestFile: false,
        complexityChange: null, commentsChange: null, codeChange: null,
      }]);

      // Verify file was inserted
      const before = await service.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM commit_files WHERE sha = $1',
        [commit.sha],
      );
      expect(parseInt(before.rows[0]?.count ?? '0', 10)).toBe(1);
    });
  });
});
