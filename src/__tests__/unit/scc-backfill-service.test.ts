import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { SccBackfillService, type BackfillResult } from '../../services/scc-backfill-service.js';
import type { SccFileMetrics } from '../../services/scc-metrics-service.js';
import type { RepositoryEntry } from '../../config/settings.js';

/**
 * Unit tests for SccBackfillService.
 *
 * Tests edge cases: scc unavailable, no SHAs to backfill, repo path missing,
 * scc fails per-commit, cancellation, empty metrics map, large dataset batching,
 * missing SHA in git repo, repo path validation, and cleanup failure threshold.
 *
 * Tickets: IQS-882, IQS-883
 */

// Use vi.hoisted() so mocks are available during vi.mock() factory execution
const { mockStat } = vi.hoisted(() => ({
  mockStat: vi.fn(),
}));

// Mock node:fs/promises for stat calls in validateRepoPath
vi.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
}));

// Mock simple-git
const mockGitInstance = {
  show: vi.fn(),
};
vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGitInstance),
}));

// Mock CommitRepository
function createMockCommitRepo() {
  return {
    getShasNeedingSccBackfill: vi.fn(),
    getCommitFilePathsForSha: vi.fn(),
    updateCommitFileSccMetrics: vi.fn(),
  };
}

// Mock SccMetricsService
function createMockSccService() {
  return {
    isSccAvailable: vi.fn(),
    getFileMetricsViaScc: vi.fn(),
    resetAvailabilityCache: vi.fn(),
    cleanupFailureThresholdExceeded: false,
    consecutiveCleanupFailures: 0,
    resetCleanupFailureCounter: vi.fn(),
  };
}

/**
 * Helper: create a stat result that represents a directory.
 */
function createDirStat() {
  return { isDirectory: () => true, isFile: () => false };
}

/**
 * Helper: create a stat result that represents a file (not a directory).
 */
function createFileStat() {
  return { isDirectory: () => false, isFile: () => true };
}

// Test repository entries
const TEST_REPOS: RepositoryEntry[] = [
  { path: '/repos/app', name: 'my-app', organization: 'Eng', trackerType: 'jira' },
  { path: '/repos/lib', name: 'my-lib', organization: 'Eng', trackerType: 'jira' },
];

describe('SccBackfillService', () => {
  let commitRepo: ReturnType<typeof createMockCommitRepo>;
  let sccService: ReturnType<typeof createMockSccService>;
  let service: SccBackfillService;

  beforeEach(() => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    commitRepo = createMockCommitRepo();
    sccService = createMockSccService();
    service = new SccBackfillService(
      commitRepo as unknown as import('../../database/commit-repository.js').CommitRepository,
      sccService as unknown as import('../../services/scc-metrics-service.js').SccMetricsService,
    );

    // Default: stat calls succeed (valid directory with .git)
    mockStat.mockImplementation((path: string) => {
      return Promise.resolve(createDirStat());
    });
  });

  it('should return early when scc is unavailable', async () => {
    sccService.isSccAvailable.mockResolvedValue(false);

    const result = await service.runBackfill(TEST_REPOS);

    expect(result.totalCommits).toBe(0);
    expect(result.processedCommits).toBe(0);
    expect(result.skippedCommits).toBe(0);
    expect(result.totalFilesUpdated).toBe(0);
    expect(commitRepo.getShasNeedingSccBackfill).not.toHaveBeenCalled();
  });

  it('should return early when no SHAs need backfill', async () => {
    sccService.isSccAvailable.mockResolvedValue(true);
    commitRepo.getShasNeedingSccBackfill.mockResolvedValue([]);

    const result = await service.runBackfill(TEST_REPOS);

    expect(result.totalCommits).toBe(0);
    expect(result.processedCommits).toBe(0);
    expect(result.totalFilesUpdated).toBe(0);
  });

  it('should skip commits when repository path is not configured', async () => {
    sccService.isSccAvailable.mockResolvedValue(true);
    commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
      { sha: 'aaa111', repository: 'unknown-repo' },
    ]);

    const result = await service.runBackfill(TEST_REPOS);

    expect(result.totalCommits).toBe(1);
    expect(result.processedCommits).toBe(0);
    expect(result.skippedCommits).toBe(1);
    expect(result.skippedRepos).toContain('unknown-repo');
    expect(sccService.getFileMetricsViaScc).not.toHaveBeenCalled();
  });

  it('should handle scc failure per commit gracefully', async () => {
    sccService.isSccAvailable.mockResolvedValue(true);
    commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
      { sha: 'sha1abc', repository: 'my-app' },
      { sha: 'sha2def', repository: 'my-app' },
    ]);
    commitRepo.getCommitFilePathsForSha
      .mockResolvedValueOnce(['src/a.ts'])
      .mockResolvedValueOnce(['src/b.ts']);

    // First commit throws, second succeeds
    sccService.getFileMetricsViaScc
      .mockRejectedValueOnce(new Error('git show failed'))
      .mockResolvedValueOnce(new Map<string, SccFileMetrics>([
        ['src/b.ts', { totalLines: 10, totalCodeLines: 8, totalCommentLines: 1, complexity: 2, weightedComplexity: 3 }],
      ]));
    commitRepo.updateCommitFileSccMetrics.mockResolvedValue(1);

    const result = await service.runBackfill(TEST_REPOS);

    expect(result.totalCommits).toBe(2);
    expect(result.processedCommits).toBe(1);
    expect(result.skippedCommits).toBe(1);
    expect(result.totalFilesUpdated).toBe(1);
  });

  it('should respect cancellation token', async () => {
    sccService.isSccAvailable.mockResolvedValue(true);
    commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
      { sha: 'sha1', repository: 'my-app' },
      { sha: 'sha2', repository: 'my-app' },
      { sha: 'sha3', repository: 'my-app' },
    ]);

    // Create a cancellation token that is already cancelled
    const token = { isCancellationRequested: true, onCancellationRequested: vi.fn() };

    const result = await service.runBackfill(
      TEST_REPOS,
      undefined,
      token as unknown as import('vscode').CancellationToken,
    );

    // Should not process any commits
    expect(result.processedCommits).toBe(0);
    expect(commitRepo.getCommitFilePathsForSha).not.toHaveBeenCalled();
  });

  it('should skip commits with empty scc metrics map', async () => {
    sccService.isSccAvailable.mockResolvedValue(true);
    commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
      { sha: 'sha1abc', repository: 'my-app' },
    ]);
    commitRepo.getCommitFilePathsForSha.mockResolvedValue(['src/main.ts']);

    // scc returns empty metrics (e.g., binary files only)
    sccService.getFileMetricsViaScc.mockResolvedValue(new Map<string, SccFileMetrics>());

    const result = await service.runBackfill(TEST_REPOS);

    expect(result.totalCommits).toBe(1);
    expect(result.processedCommits).toBe(0);
    expect(result.skippedCommits).toBe(1);
    expect(commitRepo.updateCommitFileSccMetrics).not.toHaveBeenCalled();
  });

  it('should process a large batch of commits across multiple repos', async () => {
    sccService.isSccAvailable.mockResolvedValue(true);

    // 5 commits across 2 repos
    const shaRows = [
      { sha: 'sha1aaa', repository: 'my-app' },
      { sha: 'sha2bbb', repository: 'my-app' },
      { sha: 'sha3ccc', repository: 'my-lib' },
      { sha: 'sha4ddd', repository: 'my-app' },
      { sha: 'sha5eee', repository: 'my-lib' },
    ];
    commitRepo.getShasNeedingSccBackfill.mockResolvedValue(shaRows);
    commitRepo.getCommitFilePathsForSha.mockResolvedValue(['src/file.ts']);

    const metricsMap = new Map<string, SccFileMetrics>([
      ['src/file.ts', { totalLines: 100, totalCodeLines: 80, totalCommentLines: 10, complexity: 5, weightedComplexity: 8 }],
    ]);
    sccService.getFileMetricsViaScc.mockResolvedValue(metricsMap);
    commitRepo.updateCommitFileSccMetrics.mockResolvedValue(1);

    const progressMessages: string[] = [];
    const progress = { report: vi.fn((msg: { message?: string }) => { if (msg.message) progressMessages.push(msg.message); }) };

    const result = await service.runBackfill(TEST_REPOS, progress);

    expect(result.totalCommits).toBe(5);
    expect(result.processedCommits).toBe(5);
    expect(result.skippedCommits).toBe(0);
    expect(result.totalFilesUpdated).toBe(5);
    expect(commitRepo.updateCommitFileSccMetrics).toHaveBeenCalledTimes(5);
    expect(progressMessages.length).toBe(5);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should skip commits with no file paths in commit_files', async () => {
    sccService.isSccAvailable.mockResolvedValue(true);
    commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
      { sha: 'sha1abc', repository: 'my-app' },
    ]);
    // No files returned
    commitRepo.getCommitFilePathsForSha.mockResolvedValue([]);

    const result = await service.runBackfill(TEST_REPOS);

    expect(result.totalCommits).toBe(1);
    expect(result.processedCommits).toBe(0);
    expect(result.skippedCommits).toBe(1);
    expect(sccService.getFileMetricsViaScc).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // IQS-883: Security hardening - Repository path validation (CWE-20)
  // --------------------------------------------------------------------------

  describe('repository path validation (IQS-883, CWE-20)', () => {
    it('should skip commits when repo path does not exist', async () => {
      sccService.isSccAvailable.mockResolvedValue(true);
      commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
        { sha: 'sha1abc', repository: 'my-app' },
      ]);
      commitRepo.getCommitFilePathsForSha.mockResolvedValue(['src/main.ts']);

      // stat throws ENOENT
      mockStat.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const result = await service.runBackfill(TEST_REPOS);

      expect(result.totalCommits).toBe(1);
      expect(result.processedCommits).toBe(0);
      expect(result.skippedCommits).toBe(1);
      expect(result.skippedRepos).toContain('my-app');
      expect(sccService.getFileMetricsViaScc).not.toHaveBeenCalled();
    });

    it('should skip commits when repo path is a file not a directory', async () => {
      sccService.isSccAvailable.mockResolvedValue(true);
      commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
        { sha: 'sha1abc', repository: 'my-app' },
      ]);
      commitRepo.getCommitFilePathsForSha.mockResolvedValue(['src/main.ts']);

      // First stat (repo path) returns a file, not a directory
      mockStat.mockResolvedValue(createFileStat());

      const result = await service.runBackfill(TEST_REPOS);

      expect(result.totalCommits).toBe(1);
      expect(result.processedCommits).toBe(0);
      expect(result.skippedCommits).toBe(1);
      expect(result.skippedRepos).toContain('my-app');
      expect(sccService.getFileMetricsViaScc).not.toHaveBeenCalled();
    });

    it('should skip commits when repo path has no .git directory', async () => {
      sccService.isSccAvailable.mockResolvedValue(true);
      commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
        { sha: 'sha1abc', repository: 'my-app' },
      ]);
      commitRepo.getCommitFilePathsForSha.mockResolvedValue(['src/main.ts']);

      // First stat (repo path) succeeds as directory,
      // second stat (.git) throws ENOENT
      mockStat
        .mockResolvedValueOnce(createDirStat())
        .mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

      const result = await service.runBackfill(TEST_REPOS);

      expect(result.totalCommits).toBe(1);
      expect(result.processedCommits).toBe(0);
      expect(result.skippedCommits).toBe(1);
      expect(result.skippedRepos).toContain('my-app');
      expect(sccService.getFileMetricsViaScc).not.toHaveBeenCalled();
    });

    it('should process commits when repo path is valid git directory', async () => {
      sccService.isSccAvailable.mockResolvedValue(true);
      commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
        { sha: 'sha1abc', repository: 'my-app' },
      ]);
      commitRepo.getCommitFilePathsForSha.mockResolvedValue(['src/main.ts']);

      // Both stat calls succeed (directory + .git directory)
      mockStat.mockResolvedValue(createDirStat());

      const metricsMap = new Map<string, SccFileMetrics>([
        ['src/main.ts', { totalLines: 100, totalCodeLines: 80, totalCommentLines: 10, complexity: 5, weightedComplexity: 8 }],
      ]);
      sccService.getFileMetricsViaScc.mockResolvedValue(metricsMap);
      commitRepo.updateCommitFileSccMetrics.mockResolvedValue(1);

      const result = await service.runBackfill(TEST_REPOS);

      expect(result.totalCommits).toBe(1);
      expect(result.processedCommits).toBe(1);
      expect(result.skippedCommits).toBe(0);
      expect(sccService.getFileMetricsViaScc).toHaveBeenCalled();
    });

    it('should cache repo path validation across commits in same repo', async () => {
      sccService.isSccAvailable.mockResolvedValue(true);
      commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
        { sha: 'sha1abc', repository: 'my-app' },
        { sha: 'sha2def', repository: 'my-app' },
      ]);
      commitRepo.getCommitFilePathsForSha.mockResolvedValue(['src/main.ts']);
      mockStat.mockResolvedValue(createDirStat());

      const metricsMap = new Map<string, SccFileMetrics>([
        ['src/main.ts', { totalLines: 10, totalCodeLines: 8, totalCommentLines: 1, complexity: 1, weightedComplexity: 2 }],
      ]);
      sccService.getFileMetricsViaScc.mockResolvedValue(metricsMap);
      commitRepo.updateCommitFileSccMetrics.mockResolvedValue(1);

      await service.runBackfill(TEST_REPOS);

      // stat should be called only twice for the first commit (path + .git),
      // the second commit should use cached result
      expect(mockStat).toHaveBeenCalledTimes(2);
    });
  });

  // --------------------------------------------------------------------------
  // IQS-883: Security hardening - Cleanup failure threshold abort
  // --------------------------------------------------------------------------

  describe('cleanup failure threshold abort (IQS-883, CWE-459)', () => {
    it('should abort backfill when cleanup failure threshold is exceeded', async () => {
      sccService.isSccAvailable.mockResolvedValue(true);
      commitRepo.getShasNeedingSccBackfill.mockResolvedValue([
        { sha: 'sha1abc', repository: 'my-app' },
        { sha: 'sha2def', repository: 'my-app' },
      ]);
      commitRepo.getCommitFilePathsForSha.mockResolvedValue(['src/main.ts']);
      mockStat.mockResolvedValue(createDirStat());

      // Simulate threshold exceeded
      sccService.cleanupFailureThresholdExceeded = true;

      const result = await service.runBackfill(TEST_REPOS);

      // Should break out of the loop after first check
      expect(result.totalCommits).toBe(2);
      expect(result.processedCommits).toBe(0);
      expect(sccService.getFileMetricsViaScc).not.toHaveBeenCalled();
    });
  });
});
