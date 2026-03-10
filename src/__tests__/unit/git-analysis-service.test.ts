import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { CommitRepository } from '../../database/commit-repository.js';
import { PipelineRepository } from '../../database/pipeline-repository.js';
import { SccMetricsService } from '../../services/scc-metrics-service.js';
import { GitAnalysisService, computeEffectiveSinceDate } from '../../services/git-analysis-service.js';
import {
  isMergeCommit,
  extractCommitWords,
  extractCommitData,
  buildCommitHistoryRow,
  parseDiffFiles,
  getParentDirectory,
  getSubDirectory,
  getFileExtension,
} from '../../services/git-commit-extractor.js';
import type { RepositoryEntry } from '../../config/settings.js';
import type { GitAnalysisOptions } from '../../services/git-analysis-types.js';

/**
 * Unit tests for GitAnalysisService class.
 *
 * Tests merge detection, word extraction, directory parsing, commit data
 * extraction, tag map building, and the analyzeRepositories orchestration.
 * Uses mocked simple-git and database dependencies.
 *
 * Ticket: IQS-854
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

// Mock simple-git module
const mockGitLog = vi.fn();
const mockGitBranchLocal = vi.fn();
const mockGitTags = vi.fn();
const mockGitRevparse = vi.fn();
const mockGitGetRemotes = vi.fn();

vi.mock('simple-git', () => ({
  default: vi.fn().mockImplementation(() => ({
    log: mockGitLog,
    branchLocal: mockGitBranchLocal,
    tags: mockGitTags,
    revparse: mockGitRevparse,
    getRemotes: mockGitGetRemotes,
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
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

/**
 * Helper: create a sample RepositoryEntry.
 */
function createSampleRepoEntry(overrides?: Partial<RepositoryEntry>): RepositoryEntry {
  return {
    path: '/home/user/repos/test-repo',
    name: 'test-repo',
    organization: 'TestOrg',
    trackerType: 'jira',
    ...overrides,
  };
}

/**
 * Helper: create a sample simple-git log entry matching DefaultLogFields.
 */
function createSampleLogEntry(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    hash: 'abc123def456789012345678901234567890abcd',
    date: '2024-01-15T10:30:00+00:00',
    message: 'feat: add new feature IQS-100',
    refs: '',
    body: '',
    author_name: 'testuser',
    author_email: 'test@example.com',
    diff: {
      changed: 2,
      deletions: 5,
      insertions: 20,
      files: [
        { file: 'src/main.ts', changes: 15, insertions: 10, deletions: 5, binary: false },
        { file: 'src/utils/helper.ts', changes: 10, insertions: 10, deletions: 0, binary: false },
      ],
    },
    ...overrides,
  };
}

// Use vi.hoisted() so mocks are available during vi.mock() factory execution
const { mockSccExecFile } = vi.hoisted(() => ({
  mockSccExecFile: vi.fn(),
}));

// Mock child_process and fs for SccMetricsService (scc availability check)
vi.mock('node:child_process', () => ({
  execFile: mockSccExecFile,
}));
vi.mock('node:util', () => ({
  promisify: () => mockSccExecFile,
}));
vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn().mockResolvedValue('/tmp/gitrx-scc-test'),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe('GitAnalysisService', () => {
  let dbService: DatabaseService;
  let commitRepo: CommitRepository;
  let pipelineRepo: PipelineRepository;
  let sccService: SccMetricsService;
  let service: GitAnalysisService;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createTestConfig());
    commitRepo = new CommitRepository(dbService);
    pipelineRepo = new PipelineRepository(dbService);
    sccService = new SccMetricsService();
    service = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

    // Default: scc is not available (to prevent real scc calls in unit tests)
    mockSccExecFile.mockRejectedValue(new Error('scc not available'));
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // --------------------------------------------------------------------------
  // Merge detection
  // --------------------------------------------------------------------------

  describe('isMergeCommit', () => {
    it('should detect "merge" keyword in commit message (case insensitive)', () => {
      expect(isMergeCommit('Merge branch main into develop', 'feature/test')).toBe(true);
      expect(isMergeCommit('merge pull request #123', 'main')).toBe(true);
      expect(isMergeCommit('MERGE branch', 'feature')).toBe(true);
    });

    it('should detect "uat" keyword in commit message', () => {
      expect(isMergeCommit('Deploy to UAT environment', 'feature/test')).toBe(true);
      expect(isMergeCommit('uat deployment', 'main')).toBe(true);
    });

    it('should detect "QAFull" keyword in commit message', () => {
      expect(isMergeCommit('QAFull regression test', 'feature/test')).toBe(true);
      expect(isMergeCommit('qafull run', 'main')).toBe(true);
    });

    it('should detect "revert" keyword in commit message', () => {
      expect(isMergeCommit('Revert "feat: broken feature"', 'main')).toBe(true);
      expect(isMergeCommit('revert changes from PR #42', 'develop')).toBe(true);
    });

    it('should detect "release" keyword in commit message', () => {
      expect(isMergeCommit('Release v1.2.3', 'main')).toBe(true);
      expect(isMergeCommit('prepare release candidate', 'release/v1.2')).toBe(true);
    });

    it('should detect "prod" keyword in commit message', () => {
      expect(isMergeCommit('Deploy to prod', 'main')).toBe(true);
      expect(isMergeCommit('production hotfix', 'hotfix')).toBe(true);
    });

    it('should detect "backup" keyword in commit message', () => {
      expect(isMergeCommit('backup before refactor', 'feature/test')).toBe(true);
    });

    it('should detect merge keywords in branch name', () => {
      expect(isMergeCommit('normal commit', 'release/v1.2.3')).toBe(true);
      expect(isMergeCommit('normal commit', 'uat-deploy')).toBe(true);
      expect(isMergeCommit('normal commit', 'merge-feature')).toBe(true);
      expect(isMergeCommit('normal commit', 'prod-hotfix')).toBe(true);
    });

    it('should return false for non-merge commits', () => {
      expect(isMergeCommit('feat: add login page', 'feature/login')).toBe(false);
      expect(isMergeCommit('fix: resolve null pointer', 'bugfix/null-check')).toBe(false);
      expect(isMergeCommit('chore: update dependencies', 'main')).toBe(false);
      expect(isMergeCommit('docs: update README', 'develop')).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(isMergeCommit('', '')).toBe(false);
      expect(isMergeCommit('', 'main')).toBe(false);
      expect(isMergeCommit('normal commit', '')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Word extraction
  // --------------------------------------------------------------------------

  describe('extractCommitWords', () => {
    it('should split on spaces, slashes, periods, and commas', () => {
      const words = extractCommitWords('sha1', 'feat: add new feature', 'user');
      expect(words).toEqual([
        { sha: 'sha1', word: 'feat:', author: 'user' },
        { sha: 'sha1', word: 'add', author: 'user' },
        { sha: 'sha1', word: 'new', author: 'user' },
        { sha: 'sha1', word: 'feature', author: 'user' },
      ]);
    });

    it('should lowercase all words (matching Python)', () => {
      const words = extractCommitWords('sha1', 'Fix BROKEN Feature', 'user');
      expect(words.every((w) => w.word === w.word.toLowerCase())).toBe(true);
    });

    it('should split on slashes (matching Python path splitting)', () => {
      const words = extractCommitWords('sha1', 'fix/path/issue', 'user');
      const wordValues = words.map((w) => w.word);
      expect(wordValues).toContain('fix');
      expect(wordValues).toContain('path');
      expect(wordValues).toContain('issue');
    });

    it('should split on periods', () => {
      const words = extractCommitWords('sha1', 'update file.name.ts', 'user');
      const wordValues = words.map((w) => w.word);
      expect(wordValues).toContain('update');
      expect(wordValues).toContain('file');
      expect(wordValues).toContain('name');
      expect(wordValues).toContain('ts');
    });

    it('should split on commas', () => {
      const words = extractCommitWords('sha1', 'fix a,b,c items', 'user');
      const wordValues = words.map((w) => w.word);
      expect(wordValues).toContain('fix');
      expect(wordValues).toContain('a');
      expect(wordValues).toContain('b');
      expect(wordValues).toContain('c');
    });

    it('should filter out empty strings from splits', () => {
      const words = extractCommitWords('sha1', '  double  spaces  ', 'user');
      expect(words.every((w) => w.word.length > 0)).toBe(true);
    });

    it('should return empty array for empty message', () => {
      const words = extractCommitWords('sha1', '', 'user');
      expect(words).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Directory parsing (exported functions)
  // --------------------------------------------------------------------------

  describe('getParentDirectory', () => {
    it('should return first directory segment for nested paths', () => {
      expect(getParentDirectory('src/main.ts')).toBe('src');
      expect(getParentDirectory('lib/utils/helper.ts')).toBe('lib');
    });

    it('should return "root" for files without directory', () => {
      expect(getParentDirectory('README.md')).toBe('root');
      expect(getParentDirectory('.gitignore')).toBe('root');
    });

    it('should handle deep paths', () => {
      expect(getParentDirectory('src/services/database/queries.ts')).toBe('src');
    });
  });

  describe('getSubDirectory', () => {
    it('should return second directory segment for deeply nested paths', () => {
      expect(getSubDirectory('src/services/main.ts')).toBe('services');
      expect(getSubDirectory('lib/utils/deep/file.ts')).toBe('utils');
    });

    it('should return empty string for files without subdirectory', () => {
      expect(getSubDirectory('src/main.ts')).toBe('');
      expect(getSubDirectory('README.md')).toBe('');
    });

    it('should return empty string for root files', () => {
      expect(getSubDirectory('.gitignore')).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // Commit data extraction
  // --------------------------------------------------------------------------

  describe('extractCommitData', () => {
    it('should extract structured commit data from log entry', () => {
      const logEntry = createSampleLogEntry();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = extractCommitData(logEntry as any, 'main');

      expect(result.sha).toBe('abc123def456789012345678901234567890abcd');
      expect(result.author).toBe('testuser');
      expect(result.authorEmail).toBe('test@example.com');
      expect(result.branch).toBe('main');
      expect(result.message).toBe('feat: add new feature IQS-100');
      expect(result.fileCount).toBe(2);
      expect(result.isMerge).toBe(false);
    });

    it('should clean commit message (remove newlines, carriage returns, apostrophes)', () => {
      const logEntry = createSampleLogEntry({
        message: "feat: add feature\r\nwith newlines\nand apostrophe's",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = extractCommitData(logEntry as any, 'main');

      expect(result.message).not.toContain('\r');
      expect(result.message).not.toContain('\n');
      expect(result.message).not.toContain("'");
    });

    it('should detect merge commits from message keywords', () => {
      const logEntry = createSampleLogEntry({
        message: 'Merge branch develop into main',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = extractCommitData(logEntry as any, 'main');
      expect(result.isMerge).toBe(true);
    });

    it('should detect merge commits from branch keywords', () => {
      const logEntry = createSampleLogEntry({
        message: 'normal commit',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = extractCommitData(logEntry as any, 'release/v1.0');
      expect(result.isMerge).toBe(true);
    });

    it('should parse file diffs with correct directory structures', () => {
      const logEntry = createSampleLogEntry({
        diff: {
          changed: 3,
          deletions: 2,
          insertions: 10,
          files: [
            { file: 'src/services/main.ts', changes: 5, insertions: 3, deletions: 2, binary: false },
            { file: 'README.md', changes: 7, insertions: 7, deletions: 0, binary: false },
            { file: 'src/__tests__/unit/test.ts', changes: 3, insertions: 3, deletions: 0, binary: false },
          ],
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = extractCommitData(logEntry as any, 'main');

      expect(result.files).toHaveLength(3);

      // First file: src/services/main.ts
      expect(result.files[0]!.parentDirectory).toBe('src');
      expect(result.files[0]!.subDirectory).toBe('services');
      expect(result.files[0]!.fileExtension).toBe('.ts');
      expect(result.files[0]!.isTestFile).toBe(false);

      // Second file: README.md (root level)
      expect(result.files[1]!.parentDirectory).toBe('root');
      expect(result.files[1]!.subDirectory).toBe('');

      // Third file: test file
      expect(result.files[2]!.isTestFile).toBe(true);
    });

    it('should handle commits with no diff data', () => {
      const logEntry = createSampleLogEntry({ diff: undefined });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = extractCommitData(logEntry as any, 'main');

      expect(result.files).toHaveLength(0);
      expect(result.fileCount).toBe(0);
      expect(result.linesAdded).toBe(0);
      expect(result.linesRemoved).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // CommitHistoryRow builder
  // --------------------------------------------------------------------------

  describe('buildCommitHistoryRow', () => {
    it('should build a properly structured CommitHistoryRow', () => {
      const extracted = {
        sha: 'abc123def456789012345678901234567890abcd',
        author: 'testuser',
        authorEmail: 'test@example.com',
        date: '2024-01-15T10:30:00+00:00',
        message: 'feat: add feature',
        branch: 'main',
        fileCount: 2,
        linesAdded: 20,
        linesRemoved: 5,
        isMerge: false,
        files: [],
      };
      const repoContext = {
        path: '/path',
        name: 'test-repo',
        organization: 'TestOrg',
        repositoryUrl: 'https://github.com/TestOrg/test-repo.git',
      };

      const row = buildCommitHistoryRow(extracted, repoContext);

      expect(row.sha).toBe(extracted.sha);
      expect(row.url).toBe('https://github.com/TestOrg/test-repo/commit/abc123def456789012345678901234567890abcd');
      expect(row.branch).toBe('main');
      expect(row.repository).toBe('test-repo');
      expect(row.repositoryUrl).toBe('https://github.com/TestOrg/test-repo.git');
      expect(row.author).toBe('testuser');
      expect(row.commitDate).toBeInstanceOf(Date);
      expect(row.commitMessage).toBe('feat: add feature');
      expect(row.fileCount).toBe(2);
      expect(row.linesAdded).toBe(20);
      expect(row.linesRemoved).toBe(5);
      expect(row.isMerge).toBe(false);
      expect(row.isJiraRef).toBeNull(); // Deferred to later ticket
      expect(row.organization).toBe('TestOrg');
    });
  });

  // --------------------------------------------------------------------------
  // Tag map building
  // --------------------------------------------------------------------------

  describe('buildTagMap', () => {
    it('should build tag map from git tags', async () => {
      mockGitTags.mockResolvedValue({
        all: ['v1.0.0', 'v1.1.0', 'v2.0.0'],
        latest: 'v2.0.0',
      });

      mockGitRevparse
        .mockResolvedValueOnce('sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1')
        .mockResolvedValueOnce('sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1')
        .mockResolvedValueOnce('sha2sha2sha2sha2sha2sha2sha2sha2sha2sha2');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { tags: mockGitTags, revparse: mockGitRevparse } as any;
      const tagMap = await service.buildTagMap(mockGit);

      expect(tagMap.size).toBe(2);
      expect(tagMap.get('sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1')).toEqual(['v1.0.0', 'v1.1.0']);
      expect(tagMap.get('sha2sha2sha2sha2sha2sha2sha2sha2sha2sha2')).toEqual(['v2.0.0']);
    });

    it('should handle repositories with no tags', async () => {
      mockGitTags.mockResolvedValue({ all: [], latest: undefined });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { tags: mockGitTags, revparse: mockGitRevparse } as any;
      const tagMap = await service.buildTagMap(mockGit);

      expect(tagMap.size).toBe(0);
    });

    it('should skip tags that cannot be resolved', async () => {
      mockGitTags.mockResolvedValue({
        all: ['v1.0.0', 'bad-tag'],
        latest: 'v1.0.0',
      });

      mockGitRevparse
        .mockResolvedValueOnce('sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1')
        .mockRejectedValueOnce(new Error('not a valid object'));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { tags: mockGitTags, revparse: mockGitRevparse } as any;
      const tagMap = await service.buildTagMap(mockGit);

      expect(tagMap.size).toBe(1);
      expect(tagMap.has('sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Branch discovery
  // --------------------------------------------------------------------------

  describe('getAllBranches', () => {
    it('should list all local branches with timestamps', async () => {
      mockGitBranchLocal.mockResolvedValue({
        all: ['main', 'develop', 'feature/test'],
        branches: {},
        current: 'main',
        detached: false,
      });

      mockGitLog
        .mockResolvedValueOnce({ latest: { date: '2024-01-15T10:00:00Z' }, all: [] })
        .mockResolvedValueOnce({ latest: { date: '2024-01-14T10:00:00Z' }, all: [] })
        .mockResolvedValueOnce({ latest: { date: '2024-01-13T10:00:00Z' }, all: [] });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { branchLocal: mockGitBranchLocal, log: mockGitLog } as any;
      const branches = await service.getAllBranches(mockGit);

      expect(branches).toHaveLength(3);
      expect(branches[0]!.name).toBe('main');
      expect(branches[1]!.name).toBe('develop');
      expect(branches[2]!.name).toBe('feature/test');
    });

    it('should skip branches that fail to resolve', async () => {
      mockGitBranchLocal.mockResolvedValue({
        all: ['main', 'broken-branch'],
        branches: {},
        current: 'main',
        detached: false,
      });

      mockGitLog
        .mockResolvedValueOnce({ latest: { date: '2024-01-15T10:00:00Z' }, all: [] })
        .mockRejectedValueOnce(new Error('branch not found'));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { branchLocal: mockGitBranchLocal, log: mockGitLog } as any;
      const branches = await service.getAllBranches(mockGit);

      expect(branches).toHaveLength(1);
      expect(branches[0]!.name).toBe('main');
    });
  });

  describe('findRecentBranches', () => {
    it('should filter branches by sinceDate', async () => {
      mockGitBranchLocal.mockResolvedValue({
        all: ['main', 'old-branch'],
        branches: {},
        current: 'main',
        detached: false,
      });

      // main: recent, old-branch: old
      mockGitLog
        .mockResolvedValueOnce({ latest: { date: '2024-06-15T10:00:00Z' }, all: [] })
        .mockResolvedValueOnce({ latest: { date: '2023-01-01T10:00:00Z' }, all: [] });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { branchLocal: mockGitBranchLocal, log: mockGitLog } as any;
      const branches = await service.findRecentBranches(mockGit, '2024-01-01');

      expect(branches).toHaveLength(1);
      expect(branches[0]!.name).toBe('main');
    });
  });

  // --------------------------------------------------------------------------
  // processBranch
  // --------------------------------------------------------------------------

  describe('processBranch', () => {
    it('should skip known SHAs and only record new branch relationships', async () => {
      const knownRelationships = new Map<string, string[]>([
        ['sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1', ['main']],
      ]);

      mockGitLog.mockResolvedValue({
        all: [
          createSampleLogEntry({ hash: 'sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1' }),
        ],
        latest: null,
        total: 1,
      });

      // The commit is known with branch 'main', now processing 'develop'
      // It should only insert a branch relationship, not a full commit
      const insertCommitSpy = vi.spyOn(commitRepo, 'insertCommitHistory');
      const insertBranchSpy = vi.spyOn(commitRepo, 'insertCommitBranchRelationship');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog } as any;
      const tagMap = new Map<string, readonly string[]>();
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      const result = await service.processBranch(
        mockGit, repoContext, 'develop', {},
        knownRelationships, tagMap, 1,
      );

      expect(result.newCommits).toBe(0);
      expect(result.newRelationships).toBe(1);
      expect(insertCommitSpy).not.toHaveBeenCalled();
      expect(insertBranchSpy).toHaveBeenCalledOnce();
    });

    it('should skip if SHA already has the same branch relationship', async () => {
      const knownRelationships = new Map<string, string[]>([
        ['sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1', ['main']],
      ]);

      mockGitLog.mockResolvedValue({
        all: [
          createSampleLogEntry({ hash: 'sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1' }),
        ],
        latest: null,
        total: 1,
      });

      const insertBranchSpy = vi.spyOn(commitRepo, 'insertCommitBranchRelationship');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog } as any;
      const tagMap = new Map<string, readonly string[]>();
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      const result = await service.processBranch(
        mockGit, repoContext, 'main', {},
        knownRelationships, tagMap, 1,
      );

      expect(result.newCommits).toBe(0);
      expect(result.newRelationships).toBe(0);
      expect(insertBranchSpy).not.toHaveBeenCalled();
    });

    it('should fully process new commits including file metrics', async () => {
      const knownRelationships = new Map<string, string[]>();

      mockGitLog.mockResolvedValue({
        all: [createSampleLogEntry()],
        latest: null,
        total: 1,
      });

      const insertCommitSpy = vi.spyOn(commitRepo, 'insertCommitHistory');
      const insertBranchSpy = vi.spyOn(commitRepo, 'insertCommitBranchRelationship');
      const insertWordsSpy = vi.spyOn(commitRepo, 'insertCommitWords');
      const insertTagsSpy = vi.spyOn(commitRepo, 'insertCommitTags');
      const insertFilesSpy = vi.spyOn(commitRepo, 'insertCommitFiles');
      const insertFileTypesSpy = vi.spyOn(commitRepo, 'insertCommitFileTypes');
      const insertDirsSpy = vi.spyOn(commitRepo, 'insertCommitDirectories');
      const pipelineLogSpy = vi.spyOn(pipelineRepo, 'insertPipelineLog');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog, show: vi.fn() } as any;
      const tagMap = new Map<string, readonly string[]>();
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      const result = await service.processBranch(
        mockGit, repoContext, 'main', {},
        knownRelationships, tagMap, 1,
      );

      expect(result.newCommits).toBe(1);
      expect(result.newRelationships).toBe(1);
      expect(insertCommitSpy).toHaveBeenCalledOnce();
      expect(insertBranchSpy).toHaveBeenCalledOnce();
      expect(insertWordsSpy).toHaveBeenCalledOnce();
      expect(insertTagsSpy).not.toHaveBeenCalled(); // No tags in tagMap
      // File metrics inserts should be called since the sample has 2 files
      expect(insertFilesSpy).toHaveBeenCalledOnce();
      expect(insertFileTypesSpy).toHaveBeenCalledOnce();
      expect(insertDirsSpy).toHaveBeenCalledOnce();
      expect(pipelineLogSpy).toHaveBeenCalledOnce();
    });

    it('should insert tags for new commits when tags exist', async () => {
      const knownRelationships = new Map<string, string[]>();
      const sha = 'abc123def456789012345678901234567890abcd';

      mockGitLog.mockResolvedValue({
        all: [createSampleLogEntry({ hash: sha })],
        latest: null,
        total: 1,
      });

      const insertTagsSpy = vi.spyOn(commitRepo, 'insertCommitTags');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog, show: vi.fn() } as any;
      const tagMap = new Map<string, readonly string[]>([
        [sha, ['v1.0.0', 'release-1.0']],
      ]);
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      await service.processBranch(
        mockGit, repoContext, 'main', {},
        knownRelationships, tagMap, 1,
      );

      expect(insertTagsSpy).toHaveBeenCalledOnce();
      const tagArgs = insertTagsSpy.mock.calls[0]!;
      expect(tagArgs[0]).toBe(sha);
      expect(tagArgs[1]).toHaveLength(2);
    });

    it('should handle git log errors gracefully', async () => {
      mockGitLog.mockRejectedValue(new Error('branch not found'));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog } as any;
      const tagMap = new Map<string, readonly string[]>();
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      const result = await service.processBranch(
        mockGit, repoContext, 'nonexistent', {},
        new Map(), tagMap, 1,
      );

      expect(result.newCommits).toBe(0);
      expect(result.newRelationships).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // analyzeRepositories orchestration
  // --------------------------------------------------------------------------

  describe('analyzeRepositories', () => {
    it('should return SUCCESS when all repos complete without error', async () => {
      // Set up pipeline start to return an ID
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 }) // insertPipelineStart
        .mockResolvedValue({ rows: [], rowCount: 0 }); // all subsequent queries

      // Mock simple-git operations
      mockGitGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://github.com/Org/repo.git' } },
      ]);
      mockGitTags.mockResolvedValue({ all: [], latest: undefined });
      mockGitBranchLocal.mockResolvedValue({
        all: [],
        branches: {},
        current: 'main',
        detached: false,
      });

      const repos: RepositoryEntry[] = [createSampleRepoEntry()];
      const result = await service.analyzeRepositories(repos, {});

      expect(result.status).toBe('SUCCESS');
      expect(result.pipelineRunId).toBe(42);
      expect(result.repoResults).toHaveLength(1);
      expect(result.repoResults[0]!.error).toBeUndefined();
    });

    it('should return FAILED when all repos fail', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      // Make the git init fail by making branchLocal throw
      mockGitGetRemotes.mockRejectedValue(new Error('not a git repo'));
      mockGitTags.mockRejectedValue(new Error('not a git repo'));
      mockGitBranchLocal.mockRejectedValue(new Error('not a git repo'));

      const repos: RepositoryEntry[] = [createSampleRepoEntry()];
      const result = await service.analyzeRepositories(repos, {});

      expect(result.status).toBe('FAILED');
      expect(result.repoResults[0]!.error).toBeDefined();
    });

    it('should handle empty repository list', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await service.analyzeRepositories([], {});

      expect(result.status).toBe('SUCCESS');
      expect(result.repoResults).toHaveLength(0);
    });

    it('should pass date range options through to branch processing', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      mockGitGetRemotes.mockResolvedValue([]);
      mockGitTags.mockResolvedValue({ all: [], latest: undefined });
      mockGitBranchLocal.mockResolvedValue({
        all: ['main'],
        branches: {},
        current: 'main',
        detached: false,
      });
      mockGitLog.mockResolvedValue({ latest: { date: '2024-06-01' }, all: [], total: 0 });

      const options: GitAnalysisOptions = {
        sinceDate: '2024-01-01',
        untilDate: '2024-12-31',
      };

      const repos: RepositoryEntry[] = [createSampleRepoEntry()];
      await service.analyzeRepositories(repos, options);

      // Verify findRecentBranches was used (the branch log was called for date check)
      expect(mockGitLog).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // repoUrl configuration (IQS-923)
  // --------------------------------------------------------------------------

  describe('analyzeRepository repoUrl handling (IQS-923)', () => {
    it('should use configured repoUrl when provided', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // insertPipelineStart
        .mockResolvedValue({ rows: [], rowCount: 0 }); // subsequent queries

      // Mock simple-git operations - note we still mock getRemotes but expect
      // it NOT to be called when repoUrl is configured
      mockGitGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://github.com/Org/auto-detected.git' } },
      ]);
      mockGitTags.mockResolvedValue({ all: [], latest: undefined });
      mockGitBranchLocal.mockResolvedValue({
        all: [],
        branches: {},
        current: 'main',
        detached: false,
      });

      // Create repo entry with explicit repoUrl
      const repoWithUrl = createSampleRepoEntry({
        repoUrl: 'https://github.com/CustomOrg/custom-repo',
      });

      const result = await service.analyzeRepository(repoWithUrl, {}, 1);

      // Should succeed without error
      expect(result.error).toBeUndefined();
      // getRemotes should NOT be called because we have a configured repoUrl
      expect(mockGitGetRemotes).not.toHaveBeenCalled();
    });

    it('should fall back to auto-detection when repoUrl is undefined', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      mockGitGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://github.com/Org/auto-detected.git' } },
      ]);
      mockGitTags.mockResolvedValue({ all: [], latest: undefined });
      mockGitBranchLocal.mockResolvedValue({
        all: [],
        branches: {},
        current: 'main',
        detached: false,
      });

      // Create repo entry WITHOUT repoUrl
      const repoWithoutUrl = createSampleRepoEntry();

      const result = await service.analyzeRepository(repoWithoutUrl, {}, 1);

      expect(result.error).toBeUndefined();
      // getRemotes SHOULD be called for auto-detection
      expect(mockGitGetRemotes).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // File extension extraction
  // --------------------------------------------------------------------------

  describe('parseDiffFiles', () => {
    it('should extract correct file extensions', () => {
      const logEntry = createSampleLogEntry({
        diff: {
          changed: 4,
          deletions: 0,
          insertions: 10,
          files: [
            { file: 'src/main.ts', changes: 5, insertions: 5, deletions: 0, binary: false },
            { file: 'package.json', changes: 2, insertions: 2, deletions: 0, binary: false },
            { file: '.gitignore', changes: 1, insertions: 1, deletions: 0, binary: false },
            { file: 'src/styles.module.css', changes: 2, insertions: 2, deletions: 0, binary: false },
          ],
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const files = parseDiffFiles(logEntry as any);

      expect(files).toHaveLength(4);
      expect(files[0]!.fileExtension).toBe('.ts');
      expect(files[1]!.fileExtension).toBe('.json');
      expect(files[2]!.fileExtension).toBe(''); // dotfile, no extension
      expect(files[3]!.fileExtension).toBe('.css');
    });

    it('should detect test files by TEST keyword in path (case insensitive)', () => {
      const logEntry = createSampleLogEntry({
        diff: {
          changed: 3,
          deletions: 0,
          insertions: 10,
          files: [
            { file: 'src/__tests__/unit/main.test.ts', changes: 5, insertions: 5, deletions: 0, binary: false },
            { file: 'src/main.ts', changes: 3, insertions: 3, deletions: 0, binary: false },
            { file: 'tests/integration/test-helper.ts', changes: 2, insertions: 2, deletions: 0, binary: false },
          ],
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const files = parseDiffFiles(logEntry as any);

      expect(files[0]!.isTestFile).toBe(true);
      expect(files[1]!.isTestFile).toBe(false);
      expect(files[2]!.isTestFile).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // computeEffectiveSinceDate (IQS-931)
  // --------------------------------------------------------------------------

  describe('computeEffectiveSinceDate (IQS-931)', () => {
    it('should return undefined when neither date is set', () => {
      expect(computeEffectiveSinceDate(undefined, undefined)).toBeUndefined();
    });

    it('should return global date when only global is set', () => {
      expect(computeEffectiveSinceDate(undefined, '2023-01-01')).toBe('2023-01-01');
    });

    it('should return repo date when only repo startDate is set', () => {
      expect(computeEffectiveSinceDate('2022-06-15', undefined)).toBe('2022-06-15');
    });

    it('should return repo date when repo date is later', () => {
      // Repo: 2023-06-01, Global: 2023-01-01 -> use repo (more restrictive)
      expect(computeEffectiveSinceDate('2023-06-01', '2023-01-01')).toBe('2023-06-01');
    });

    it('should return global date when global date is later', () => {
      // Repo: 2022-01-01, Global: 2023-01-01 -> use global (more restrictive)
      expect(computeEffectiveSinceDate('2022-01-01', '2023-01-01')).toBe('2023-01-01');
    });

    it('should return either date when both are equal', () => {
      const date = '2023-06-15';
      expect(computeEffectiveSinceDate(date, date)).toBe(date);
    });

    it('should handle dates from different years correctly', () => {
      expect(computeEffectiveSinceDate('2024-01-01', '2022-12-31')).toBe('2024-01-01');
      expect(computeEffectiveSinceDate('2020-06-15', '2023-01-01')).toBe('2023-01-01');
    });

    it('should handle dates within the same month correctly', () => {
      expect(computeEffectiveSinceDate('2023-06-15', '2023-06-01')).toBe('2023-06-15');
      expect(computeEffectiveSinceDate('2023-06-01', '2023-06-15')).toBe('2023-06-15');
    });
  });
});
