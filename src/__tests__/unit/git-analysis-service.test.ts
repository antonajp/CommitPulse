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
const mockGitRaw = vi.fn();

vi.mock('simple-git', () => ({
  default: vi.fn().mockImplementation(() => ({
    log: mockGitLog,
    branchLocal: mockGitBranchLocal,
    tags: mockGitTags,
    revparse: mockGitRevparse,
    getRemotes: mockGitGetRemotes,
    raw: mockGitRaw,
  })),
}));

// GITX-130: Mock repository path validator to always return valid
vi.mock('../../utils/repository-path-validator.js', () => ({
  validateRepositoryPath: vi.fn().mockReturnValue({ isValid: true, canonicalPath: '/test/path' }),
  findValidRepository: vi.fn().mockImplementation((name, repos) => repos.find((r: { name: string }) => r.name === name) || null),
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

      // GITX-2: Mock remote branches (empty for this test)
      const mockGitBranch = vi.fn().mockResolvedValue({
        all: [],
        branches: {},
        current: '',
        detached: false,
      });

      // GITX-1: Branch timestamps are now retrieved via git.raw() instead of git.log()
      mockGitRaw
        .mockResolvedValueOnce('abc123|2024-01-15 10:00:00 +0000\n')
        .mockResolvedValueOnce('def456|2024-01-14 10:00:00 +0000\n')
        .mockResolvedValueOnce('789abc|2024-01-13 10:00:00 +0000\n');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { branchLocal: mockGitBranchLocal, branch: mockGitBranch, raw: mockGitRaw } as any;
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

      // GITX-2: Mock remote branches (empty for this test)
      const mockGitBranch = vi.fn().mockResolvedValue({
        all: [],
        branches: {},
        current: '',
        detached: false,
      });

      // GITX-1: Branch timestamps are now retrieved via git.raw()
      mockGitRaw
        .mockResolvedValueOnce('abc123|2024-01-15 10:00:00 +0000\n')
        .mockRejectedValueOnce(new Error('branch not found'));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { branchLocal: mockGitBranchLocal, branch: mockGitBranch, raw: mockGitRaw } as any;
      const branches = await service.getAllBranches(mockGit);

      expect(branches).toHaveLength(1);
      expect(branches[0]!.name).toBe('main');
    });

    // GITX-2: Remote branch discovery tests
    it('should include remote branches alongside local branches (GITX-2)', async () => {
      mockGitBranchLocal.mockResolvedValue({
        all: ['main'],
        branches: {},
        current: 'main',
        detached: false,
      });

      // Mock remote branches
      const mockGitBranch = vi.fn().mockResolvedValue({
        all: ['origin/main', 'origin/feature-remote', 'origin/HEAD -> origin/main'],
        branches: {},
        current: '',
        detached: false,
      });

      // Mock timestamps: main (local), feature-remote (remote only)
      mockGitRaw
        .mockResolvedValueOnce('abc123|2024-01-15 10:00:00 +0000\n') // local main
        .mockResolvedValueOnce('def456|2024-01-14 10:00:00 +0000\n'); // origin/feature-remote

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { branchLocal: mockGitBranchLocal, branch: mockGitBranch, raw: mockGitRaw } as any;
      const branches = await service.getAllBranches(mockGit);

      // Should have: main (local) + origin/feature-remote (remote, not in local)
      // origin/main should be skipped because local 'main' exists
      expect(branches).toHaveLength(2);
      expect(branches.map(b => b.name)).toContain('main');
      expect(branches.map(b => b.name)).toContain('origin/feature-remote');

      // Verify isRemote flag is correctly set
      const localMain = branches.find(b => b.name === 'main');
      const remoteFeature = branches.find(b => b.name === 'origin/feature-remote');
      expect(localMain?.isRemote).toBe(false);
      expect(remoteFeature?.isRemote).toBe(true);
    });

    it('should skip remote branches that have a local equivalent (GITX-2)', async () => {
      mockGitBranchLocal.mockResolvedValue({
        all: ['main', 'develop'],
        branches: {},
        current: 'main',
        detached: false,
      });

      // Mock remote branches - origin/main and origin/develop have local equivalents
      const mockGitBranch = vi.fn().mockResolvedValue({
        all: ['origin/main', 'origin/develop', 'origin/feature-only-remote'],
        branches: {},
        current: '',
        detached: false,
      });

      mockGitRaw
        .mockResolvedValueOnce('abc123|2024-01-15 10:00:00 +0000\n') // main
        .mockResolvedValueOnce('def456|2024-01-14 10:00:00 +0000\n') // develop
        .mockResolvedValueOnce('789abc|2024-01-13 10:00:00 +0000\n'); // origin/feature-only-remote

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { branchLocal: mockGitBranchLocal, branch: mockGitBranch, raw: mockGitRaw } as any;
      const branches = await service.getAllBranches(mockGit);

      expect(branches).toHaveLength(3);
      expect(branches.map(b => b.name)).toContain('main');
      expect(branches.map(b => b.name)).toContain('develop');
      expect(branches.map(b => b.name)).toContain('origin/feature-only-remote');
      // origin/main and origin/develop should NOT be included (local equivalents exist)
      expect(branches.map(b => b.name)).not.toContain('origin/main');
      expect(branches.map(b => b.name)).not.toContain('origin/develop');

      // Verify isRemote flag is correctly set
      const localMain = branches.find(b => b.name === 'main');
      const localDevelop = branches.find(b => b.name === 'develop');
      const remoteFeature = branches.find(b => b.name === 'origin/feature-only-remote');
      expect(localMain?.isRemote).toBe(false);
      expect(localDevelop?.isRemote).toBe(false);
      expect(remoteFeature?.isRemote).toBe(true);
    });

    it('should filter out HEAD references from remote branches (GITX-2)', async () => {
      mockGitBranchLocal.mockResolvedValue({
        all: [],
        branches: {},
        current: '',
        detached: true,
      });

      // Mock remote branches including HEAD reference
      const mockGitBranch = vi.fn().mockResolvedValue({
        all: ['origin/main', 'origin/HEAD -> origin/main', 'origin/develop'],
        branches: {},
        current: '',
        detached: false,
      });

      mockGitRaw
        .mockResolvedValueOnce('abc123|2024-01-15 10:00:00 +0000\n') // origin/main
        .mockResolvedValueOnce('def456|2024-01-14 10:00:00 +0000\n'); // origin/develop

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { branchLocal: mockGitBranchLocal, branch: mockGitBranch, raw: mockGitRaw } as any;
      const branches = await service.getAllBranches(mockGit);

      expect(branches).toHaveLength(2);
      expect(branches.map(b => b.name)).toContain('origin/main');
      expect(branches.map(b => b.name)).toContain('origin/develop');
      // HEAD should NOT be included
      expect(branches.map(b => b.name).some(n => n.includes('HEAD'))).toBe(false);
    });

    it('should continue with local branches if remote listing fails (GITX-2)', async () => {
      mockGitBranchLocal.mockResolvedValue({
        all: ['main'],
        branches: {},
        current: 'main',
        detached: false,
      });

      // Mock remote branch listing failure
      const mockGitBranch = vi.fn().mockRejectedValue(new Error('remote listing failed'));

      mockGitRaw.mockResolvedValueOnce('abc123|2024-01-15 10:00:00 +0000\n');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { branchLocal: mockGitBranchLocal, branch: mockGitBranch, raw: mockGitRaw } as any;
      const branches = await service.getAllBranches(mockGit);

      // Should still have local branches even if remote listing fails
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

      // GITX-1: Branch timestamps are now retrieved via git.raw()
      // main: recent (2024-06-15), old-branch: old (2023-01-01)
      mockGitRaw
        .mockResolvedValueOnce('abc123|2024-06-15 10:00:00 +0000\n')
        .mockResolvedValueOnce('def456|2023-01-01 10:00:00 +0000\n');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { branchLocal: mockGitBranchLocal, raw: mockGitRaw } as any;
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

    // IQS-950: Test for accurate commit counting (new + existing = total)
    it('should accurately count new vs existing commits', async () => {
      // Set up: 2 existing commits (sha1, sha2), 1 new commit (sha3)
      const knownRelationships = new Map<string, string[]>([
        ['sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1', ['main']],
        ['sha2sha2sha2sha2sha2sha2sha2sha2sha2sha2', ['main', 'develop']],
      ]);

      // Return 3 commits from log: 2 existing + 1 new
      mockGitLog.mockResolvedValue({
        all: [
          createSampleLogEntry({ hash: 'sha1sha1sha1sha1sha1sha1sha1sha1sha1sha1' }),
          createSampleLogEntry({ hash: 'sha2sha2sha2sha2sha2sha2sha2sha2sha2sha2' }),
          createSampleLogEntry({ hash: 'sha3sha3sha3sha3sha3sha3sha3sha3sha3sha3' }),
        ],
        latest: null,
        total: 3,
      });

      const insertCommitSpy = vi.spyOn(commitRepo, 'insertCommitHistory');
      const insertBranchSpy = vi.spyOn(commitRepo, 'insertCommitBranchRelationship');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog, show: vi.fn() } as any;
      const tagMap = new Map<string, readonly string[]>();
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      const result = await service.processBranch(
        mockGit, repoContext, 'feature', {},
        knownRelationships, tagMap, 1,
      );

      // 3 commits in range: 1 new (sha3), 2 existing (sha1, sha2)
      // Only sha3 should be fully processed as new commit
      expect(result.newCommits).toBe(1);
      // sha1 needs branch relationship 'feature' added (not in 'main' or 'develop')
      // sha2 needs branch relationship 'feature' added
      // sha3 gets initial relationship
      // Total: 3 new relationships
      expect(result.newRelationships).toBe(3);
      expect(insertCommitSpy).toHaveBeenCalledTimes(1); // Only sha3
      expect(insertBranchSpy).toHaveBeenCalledTimes(3); // All 3 commits
    });

    // IQS-950: Test that refs/heads/ prefix is used for branch names
    it('should use refs/heads/ prefix when querying branch log', async () => {
      // This test verifies the fix for branch/tag name collision
      mockGitLog.mockResolvedValue({
        all: [createSampleLogEntry()],
        latest: null,
        total: 1,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog, show: vi.fn() } as any;
      const tagMap = new Map<string, readonly string[]>();
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      await service.processBranch(
        mockGit, repoContext, 'release-v1.0', {},
        new Map(), tagMap, 1,
      );

      // Verify git log was called with refs/heads/ prefix
      expect(mockGitLog).toHaveBeenCalledWith(
        expect.arrayContaining(['refs/heads/release-v1.0', '--numstat']),
      );
    });

    // IQS-950: Test branch/tag name collision scenario
    it('should handle branch name that matches a tag name', async () => {
      // Simulate a repository where both a branch and tag named "release-v1.0" exist
      // Without the refs/heads/ fix, git might interpret this as the tag
      mockGitLog.mockResolvedValue({
        all: [
          createSampleLogEntry({ hash: 'commit1commit1commit1commit1commit1commit1' }),
          createSampleLogEntry({ hash: 'commit2commit2commit2commit2commit2commit2' }),
        ],
        latest: null,
        total: 2,
      });

      const insertCommitSpy = vi.spyOn(commitRepo, 'insertCommitHistory');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog, show: vi.fn() } as any;
      const tagMap = new Map<string, readonly string[]>();
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      const result = await service.processBranch(
        mockGit, repoContext, 'release-v1.0', {}, // Branch name that could match a tag
        new Map(), tagMap, 1,
      );

      // Should extract both commits (not just tagged commit)
      expect(result.newCommits).toBe(2);
      expect(insertCommitSpy).toHaveBeenCalledTimes(2);

      // Verify the branch ref format was used
      expect(mockGitLog).toHaveBeenCalledWith(
        expect.arrayContaining(['refs/heads/release-v1.0']),
      );
    });

    // GITX-2: Test remote branch ref format
    it('should use refs/remotes/ prefix for remote branches (GITX-2)', async () => {
      mockGitLog.mockResolvedValue({
        all: [createSampleLogEntry()],
        latest: null,
        total: 1,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog, show: vi.fn() } as any;
      const tagMap = new Map<string, readonly string[]>();
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      // Process a remote branch with isRemote=true
      await service.processBranch(
        mockGit, repoContext, 'origin/feature-remote', {},
        new Map(), tagMap, 1, true, // isRemote flag
      );

      // Verify git log was called with refs/remotes/ prefix for remote branch
      expect(mockGitLog).toHaveBeenCalledWith(
        expect.arrayContaining(['refs/remotes/origin/feature-remote', '--numstat']),
      );
    });

    // GITX-2: Test local branch still uses refs/heads/
    it('should use refs/heads/ prefix for local branches (GITX-2)', async () => {
      mockGitLog.mockResolvedValue({
        all: [createSampleLogEntry()],
        latest: null,
        total: 1,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog, show: vi.fn() } as any;
      const tagMap = new Map<string, readonly string[]>();
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      // Process a local branch (no '/'), isRemote defaults to false
      await service.processBranch(
        mockGit, repoContext, 'main', {},
        new Map(), tagMap, 1,
      );

      // Verify git log was called with refs/heads/ prefix for local branch
      expect(mockGitLog).toHaveBeenCalledWith(
        expect.arrayContaining(['refs/heads/main', '--numstat']),
      );
    });

    // GITX-2: Test local branch with "/" in name still uses refs/heads/
    it('should use refs/heads/ prefix for local branches with "/" in name (GITX-2)', async () => {
      mockGitLog.mockResolvedValue({
        all: [createSampleLogEntry()],
        latest: null,
        total: 1,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog, show: vi.fn() } as any;
      const tagMap = new Map<string, readonly string[]>();
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      // Process a local branch with "/" in name, isRemote=false
      await service.processBranch(
        mockGit, repoContext, 'feature/new-feature', {},
        new Map(), tagMap, 1, false, // isRemote=false (it's a local branch)
      );

      // Verify git log was called with refs/heads/ prefix (not refs/remotes/)
      expect(mockGitLog).toHaveBeenCalledWith(
        expect.arrayContaining(['refs/heads/feature/new-feature', '--numstat']),
      );
    });

    // IQS-950: Test mixed tagged/untagged commits extraction
    it('should extract both tagged and untagged commits', async () => {
      const sha1 = 'tagged1tagged1tagged1tagged1tagged1tagged1';
      const sha2 = 'untaggeduntaggeduntaggeduntaggeduntagged1';
      const sha3 = 'tagged2tagged2tagged2tagged2tagged2tagged2';

      mockGitLog.mockResolvedValue({
        all: [
          createSampleLogEntry({ hash: sha1 }),
          createSampleLogEntry({ hash: sha2 }),
          createSampleLogEntry({ hash: sha3 }),
        ],
        latest: null,
        total: 3,
      });

      const insertCommitSpy = vi.spyOn(commitRepo, 'insertCommitHistory');
      const insertTagsSpy = vi.spyOn(commitRepo, 'insertCommitTags');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockGit = { log: mockGitLog, show: vi.fn() } as any;
      // Only sha1 and sha3 have tags; sha2 is untagged
      const tagMap = new Map<string, readonly string[]>([
        [sha1, ['v1.0.0']],
        [sha3, ['v1.0.1']],
      ]);
      const repoContext = {
        path: '/path', name: 'repo', organization: 'Org',
        repositoryUrl: 'https://github.com/Org/repo.git',
      };

      const result = await service.processBranch(
        mockGit, repoContext, 'main', {},
        new Map(), tagMap, 1,
      );

      // All 3 commits should be extracted regardless of tag status
      expect(result.newCommits).toBe(3);
      expect(insertCommitSpy).toHaveBeenCalledTimes(3);
      // Tags should be inserted for sha1 and sha3 only
      expect(insertTagsSpy).toHaveBeenCalledTimes(2);
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
      // GITX-1: Branch timestamp is now retrieved via git.raw()
      mockGitRaw.mockResolvedValue('abc123|2024-06-01 10:00:00 +0000\n');

      const options: GitAnalysisOptions = {
        sinceDate: '2024-01-01',
        untilDate: '2024-12-31',
      };

      const repos: RepositoryEntry[] = [createSampleRepoEntry()];
      await service.analyzeRepositories(repos, options);

      // GITX-1: Verify git.raw() was used to get branch timestamp for filtering
      expect(mockGitRaw).toHaveBeenCalled();
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
  // Auto-incremental watermark (GITX-1)
  // --------------------------------------------------------------------------

  describe('analyzeRepository auto-incremental watermark (GITX-1)', () => {
    it('should use last commit date as watermark when no sinceDate is configured', async () => {
      const lastCommitDate = new Date('2024-06-15T14:30:00Z');

      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // insertPipelineStart (in parent call)
        .mockResolvedValue({ rows: [], rowCount: 0 }); // default for other queries

      // Mock getLastCommitDateForRepo to return a date
      const getLastCommitDateSpy = vi.spyOn(commitRepo, 'getLastCommitDateForRepo');
      getLastCommitDateSpy.mockResolvedValue(lastCommitDate);

      mockGitGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://github.com/Org/repo.git' } },
      ]);
      mockGitTags.mockResolvedValue({ all: [], latest: undefined });
      mockGitBranchLocal.mockResolvedValue({
        all: ['main'],
        branches: {},
        current: 'main',
        detached: false,
      });
      // GITX-1: Branch timestamp is now retrieved via git.raw() instead of git.log()
      // Mock a branch more recent than 2024-06-15 to pass the sinceDate filter
      mockGitRaw.mockResolvedValue('abc123|2024-07-01 10:00:00 +0000\n');

      const repoEntry = createSampleRepoEntry();
      // No sinceDate in options
      const result = await service.analyzeRepository(repoEntry, {}, 1);

      expect(result.error).toBeUndefined();
      // Verify getLastCommitDateForRepo was called
      expect(getLastCommitDateSpy).toHaveBeenCalledWith(
        'test-repo',
        expect.stringMatching(/github\.com/),
      );
      // GITX-1: Verify git.raw() was used to get branch timestamp for filtering
      expect(mockGitRaw).toHaveBeenCalled();

      getLastCommitDateSpy.mockRestore();
    });

    it('should extract full history when no sinceDate and no existing commits', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      // Mock getLastCommitDateForRepo to return null (no existing commits)
      const getLastCommitDateSpy = vi.spyOn(commitRepo, 'getLastCommitDateForRepo');
      getLastCommitDateSpy.mockResolvedValue(null);

      mockGitGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://github.com/Org/repo.git' } },
      ]);
      mockGitTags.mockResolvedValue({ all: [], latest: undefined });
      mockGitBranchLocal.mockResolvedValue({
        all: ['main'],
        branches: {},
        current: 'main',
        detached: false,
      });
      // GITX-1: Branch timestamp is now retrieved via git.raw()
      mockGitRaw.mockResolvedValue('abc123|2024-07-01 10:00:00 +0000\n');

      const repoEntry = createSampleRepoEntry();
      const result = await service.analyzeRepository(repoEntry, {}, 1);

      expect(result.error).toBeUndefined();
      expect(getLastCommitDateSpy).toHaveBeenCalled();
      // Without a sinceDate or watermark, getAllBranches should be called
      // (no date filtering)
      expect(mockGitBranchLocal).toHaveBeenCalled();

      getLastCommitDateSpy.mockRestore();
    });

    it('should prefer explicit sinceDate over auto-watermark', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      // Mock getLastCommitDateForRepo - should NOT be called when sinceDate is provided
      const getLastCommitDateSpy = vi.spyOn(commitRepo, 'getLastCommitDateForRepo');
      getLastCommitDateSpy.mockResolvedValue(new Date('2024-01-01T00:00:00Z'));

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

      const repoEntry = createSampleRepoEntry();
      // Explicit sinceDate in options
      await service.analyzeRepository(repoEntry, { sinceDate: '2024-06-01' }, 1);

      // getLastCommitDateForRepo should NOT be called when sinceDate is already set
      expect(getLastCommitDateSpy).not.toHaveBeenCalled();

      getLastCommitDateSpy.mockRestore();
    });

    it('should isolate watermarks between multiple repositories', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      // Mock different watermarks for different repos
      const getLastCommitDateSpy = vi.spyOn(commitRepo, 'getLastCommitDateForRepo');
      getLastCommitDateSpy
        .mockResolvedValueOnce(new Date('2024-01-15T00:00:00Z')) // repo-a
        .mockResolvedValueOnce(new Date('2024-06-15T00:00:00Z')); // repo-b

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

      // Process two repos
      const repoA = createSampleRepoEntry({ name: 'repo-a' });
      const repoB = createSampleRepoEntry({ name: 'repo-b' });

      await service.analyzeRepository(repoA, {}, 1);
      await service.analyzeRepository(repoB, {}, 1);

      // Each repo should have its own watermark lookup
      expect(getLastCommitDateSpy).toHaveBeenCalledTimes(2);
      expect(getLastCommitDateSpy).toHaveBeenNthCalledWith(
        1,
        'repo-a',
        expect.any(String),
      );
      expect(getLastCommitDateSpy).toHaveBeenNthCalledWith(
        2,
        'repo-b',
        expect.any(String),
      );

      getLastCommitDateSpy.mockRestore();
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
