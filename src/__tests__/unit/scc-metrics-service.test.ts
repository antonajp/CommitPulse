import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  SccMetricsService,
  findMatchingFilePath,
  MAX_FILES_PER_COMMIT,
  MAX_CONSECUTIVE_CLEANUP_FAILURES,
} from '../../services/scc-metrics-service.js';
import type {
  SccFileMetrics,
  SccLanguageGroup,
} from '../../services/scc-metrics-service.js';
import type { ExtractedFileDiff } from '../../services/git-analysis-types.js';

/**
 * Unit tests for SccMetricsService.
 *
 * Tests scc availability checking, file metrics extraction via scc CLI,
 * CommitFileRow/CommitFileTypeRow/CommitDirectoryRow building, scc output
 * parsing, and the findMatchingFilePath utility.
 *
 * Ticket: IQS-855
 */

// Use vi.hoisted() so mocks are available during vi.mock() factory execution
const { mockExecFile, mockMkdtemp, mockMkdir, mockWriteFile, mockRm, mockGitShow } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockMkdtemp: vi.fn(),
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockRm: vi.fn(),
  mockGitShow: vi.fn(),
}));

// Mock child_process.execFile
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

// Mock node:util promisify to return our mock
vi.mock('node:util', () => ({
  promisify: () => mockExecFile,
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdtemp: (...args: unknown[]) => mockMkdtemp(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  rm: (...args: unknown[]) => mockRm(...args),
}));

/**
 * Helper: create a mock SimpleGit instance.
 */
function createMockGit(): { show: typeof mockGitShow } {
  return { show: mockGitShow };
}

/**
 * Helper: create a sample ExtractedFileDiff.
 */
function createFileDiff(overrides?: Partial<ExtractedFileDiff>): ExtractedFileDiff {
  return {
    filePath: 'src/main.ts',
    fileExtension: '.ts',
    insertions: 10,
    deletions: 2,
    delta: 8,
    parentDirectory: 'src',
    subDirectory: '',
    isTestFile: false,
    ...overrides,
  };
}

/**
 * Helper: create sample scc JSON output.
 */
function createSccOutput(files: Array<{
  filename: string;
  lines?: number;
  code?: number;
  comment?: number;
  complexity?: number;
  weightedComplexity?: number;
  language?: string;
}>): string {
  const groups: SccLanguageGroup[] = [];
  const byLanguage = new Map<string, SccLanguageGroup['Files'][number][]>();

  for (const file of files) {
    const lang = file.language ?? 'TypeScript';
    if (!byLanguage.has(lang)) {
      byLanguage.set(lang, []);
    }
    byLanguage.get(lang)!.push({
      Filename: file.filename,
      Lines: file.lines ?? 100,
      Code: file.code ?? 80,
      Comment: file.comment ?? 10,
      Blank: 10,
      Complexity: file.complexity ?? 5,
      WeightedComplexity: file.weightedComplexity ?? 15,
      Language: lang,
    });
  }

  for (const [name, langFiles] of byLanguage) {
    groups.push({ Name: name, Files: langFiles });
  }

  return JSON.stringify(groups);
}

describe('SccMetricsService', () => {
  let service: SccMetricsService;

  beforeEach(() => {
    vi.resetAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    service = new SccMetricsService();

    // Default mock behaviors
    mockMkdtemp.mockResolvedValue('/tmp/gitrx-scc-test123');
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  // --------------------------------------------------------------------------
  // isSccAvailable
  // --------------------------------------------------------------------------

  describe('isSccAvailable', () => {
    it('should return true when scc is installed', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });

      const result = await service.isSccAvailable();

      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith('scc', ['--version']);
    });

    it('should return false when scc is not installed', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('ENOENT: scc not found'));

      const result = await service.isSccAvailable();

      expect(result).toBe(false);
    });

    it('should cache the availability result', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });

      await service.isSccAvailable();
      await service.isSccAvailable();

      // Only called once due to caching
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it('should allow resetting the availability cache', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });
      await service.isSccAvailable();

      service.resetAvailabilityCache();

      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.2.0', stderr: '' });
      await service.isSccAvailable();

      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });
  });

  // --------------------------------------------------------------------------
  // getFileMetricsViaScc
  // --------------------------------------------------------------------------

  describe('getFileMetricsViaScc', () => {
    it('should return empty map when scc is not available', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('ENOENT'));

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await service.getFileMetricsViaScc(git as any, 'abc123', ['src/main.ts']);

      expect(result.size).toBe(0);
    });

    it('should return empty map for empty file list', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await service.getFileMetricsViaScc(git as any, 'abc123', []);

      expect(result.size).toBe(0);
    });

    it('should extract files, run scc, and parse metrics', async () => {
      // scc --version succeeds
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });

      // git show returns file content
      mockGitShow.mockResolvedValue('const x = 1;\nconsole.log(x);');

      // scc run returns JSON output
      const sccOutput = createSccOutput([
        { filename: '/tmp/gitrx-scc-test123/src/main.ts', lines: 100, code: 80, comment: 10, complexity: 5, weightedComplexity: 15 },
      ]);
      mockExecFile.mockResolvedValueOnce({ stdout: sccOutput, stderr: '' });

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await service.getFileMetricsViaScc(git as any, 'abc123', ['src/main.ts']);

      expect(result.size).toBe(1);
      const metrics = result.get('src/main.ts');
      expect(metrics).toBeDefined();
      expect(metrics!.totalLines).toBe(100);
      expect(metrics!.totalCodeLines).toBe(80);
      expect(metrics!.totalCommentLines).toBe(10);
      expect(metrics!.complexity).toBe(5);
      expect(metrics!.weightedComplexity).toBe(15);
    });

    it('should clean up temp directory even on error', async () => {
      // scc --version succeeds
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });

      // git show fails
      mockGitShow.mockRejectedValue(new Error('git show failed'));

      // scc run returns empty
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await service.getFileMetricsViaScc(git as any, 'abc123', ['src/main.ts']);

      expect(mockRm).toHaveBeenCalledWith('/tmp/gitrx-scc-test123', { recursive: true, force: true });
    });

    it('should handle scc execution failure gracefully', async () => {
      // scc --version succeeds
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });

      // git show returns content
      mockGitShow.mockResolvedValue('const x = 1;');

      // scc run fails
      mockExecFile.mockRejectedValueOnce(new Error('scc crashed'));

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await service.getFileMetricsViaScc(git as any, 'abc123', ['src/main.ts']);

      expect(result.size).toBe(0);
    });

    it('should handle invalid scc JSON output gracefully', async () => {
      // scc --version succeeds
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });

      // git show returns content
      mockGitShow.mockResolvedValue('const x = 1;');

      // scc returns invalid JSON
      mockExecFile.mockResolvedValueOnce({ stdout: 'not valid json', stderr: '' });

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await service.getFileMetricsViaScc(git as any, 'abc123', ['src/main.ts']);

      expect(result.size).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // buildCommitFileRows
  // --------------------------------------------------------------------------

  describe('buildCommitFileRows', () => {
    it('should build rows with zero metrics when no scc metrics available', () => {
      const files = [
        createFileDiff({ filePath: 'src/main.ts', fileExtension: '.ts' }),
        createFileDiff({ filePath: 'src/utils/helper.ts', fileExtension: '.ts', parentDirectory: 'src', subDirectory: 'utils' }),
      ];

      const rows = service.buildCommitFileRows('sha123', 'testuser', files);

      expect(rows).toHaveLength(2);
      expect(rows[0]!.sha).toBe('sha123');
      expect(rows[0]!.filename).toBe('src/main.ts');
      expect(rows[0]!.fileExtension).toBe('.ts');
      expect(rows[0]!.lineInserts).toBe(10);
      expect(rows[0]!.lineDeletes).toBe(2);
      expect(rows[0]!.lineDiff).toBe(8);
      expect(rows[0]!.totalLines).toBe(0);
      expect(rows[0]!.totalCodeLines).toBe(0);
      expect(rows[0]!.totalCommentLines).toBe(0);
      expect(rows[0]!.complexity).toBe(0);
      expect(rows[0]!.weightedComplexity).toBe(0);
      expect(rows[0]!.author).toBe('testuser');
      expect(rows[0]!.parentDirectory).toBe('src');
      expect(rows[0]!.isTestFile).toBe(false);
      expect(rows[0]!.complexityChange).toBeNull();
      expect(rows[0]!.commentsChange).toBeNull();
      expect(rows[0]!.codeChange).toBeNull();
    });

    it('should merge scc metrics into file rows', () => {
      const files = [
        createFileDiff({ filePath: 'src/main.ts' }),
      ];
      const sccMetrics = new Map<string, SccFileMetrics>([
        ['src/main.ts', { totalLines: 200, totalCodeLines: 150, totalCommentLines: 30, complexity: 12, weightedComplexity: 36 }],
      ]);

      const rows = service.buildCommitFileRows('sha123', 'testuser', files, sccMetrics);

      expect(rows[0]!.totalLines).toBe(200);
      expect(rows[0]!.totalCodeLines).toBe(150);
      expect(rows[0]!.totalCommentLines).toBe(30);
      expect(rows[0]!.complexity).toBe(12);
      expect(rows[0]!.weightedComplexity).toBe(36);
    });

    it('should detect test files by TEST keyword in path (case insensitive)', () => {
      const files = [
        createFileDiff({ filePath: 'src/__tests__/unit/main.test.ts' }),
        createFileDiff({ filePath: 'src/main.ts' }),
        createFileDiff({ filePath: 'tests/integration/test-helper.ts' }),
        createFileDiff({ filePath: 'src/testing/fixture.ts' }),
      ];

      const rows = service.buildCommitFileRows('sha123', 'testuser', files);

      expect(rows[0]!.isTestFile).toBe(true);   // __tests__
      expect(rows[1]!.isTestFile).toBe(false);   // no TEST keyword
      expect(rows[2]!.isTestFile).toBe(true);    // tests/
      expect(rows[3]!.isTestFile).toBe(true);    // testing/
    });

    it('should handle empty file list', () => {
      const rows = service.buildCommitFileRows('sha123', 'testuser', []);
      expect(rows).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // buildFileTypeRows
  // --------------------------------------------------------------------------

  describe('buildFileTypeRows', () => {
    it('should group files by extension, parent_directory, sub_directory', () => {
      const files = [
        createFileDiff({ filePath: 'src/a.ts', fileExtension: '.ts', parentDirectory: 'src', subDirectory: '' }),
        createFileDiff({ filePath: 'src/b.ts', fileExtension: '.ts', parentDirectory: 'src', subDirectory: '' }),
        createFileDiff({ filePath: 'src/utils/c.ts', fileExtension: '.ts', parentDirectory: 'src', subDirectory: 'utils' }),
        createFileDiff({ filePath: 'package.json', fileExtension: '.json', parentDirectory: 'root', subDirectory: '' }),
      ];

      const rows = service.buildFileTypeRows('sha123', 'testuser', files);

      expect(rows).toHaveLength(3);

      // .ts|src| -> count 2
      const tsRoot = rows.find(r => r.fileExtension === '.ts' && r.parentDirectory === 'src' && r.subDirectory === '');
      expect(tsRoot).toBeDefined();
      expect(tsRoot!.numCount).toBe(2);

      // .ts|src|utils -> count 1
      const tsUtils = rows.find(r => r.fileExtension === '.ts' && r.subDirectory === 'utils');
      expect(tsUtils).toBeDefined();
      expect(tsUtils!.numCount).toBe(1);

      // .json|root| -> count 1
      const jsonRoot = rows.find(r => r.fileExtension === '.json');
      expect(jsonRoot).toBeDefined();
      expect(jsonRoot!.numCount).toBe(1);
    });

    it('should include sha and author in all rows', () => {
      const files = [createFileDiff()];
      const rows = service.buildFileTypeRows('sha456', 'author1', files);

      expect(rows.every(r => r.sha === 'sha456')).toBe(true);
      expect(rows.every(r => r.author === 'author1')).toBe(true);
    });

    it('should return empty array for empty file list', () => {
      const rows = service.buildFileTypeRows('sha123', 'testuser', []);
      expect(rows).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // buildDirectoryRows
  // --------------------------------------------------------------------------

  describe('buildDirectoryRows', () => {
    it('should create unique directory entries from file list', () => {
      const files = [
        createFileDiff({ filePath: 'src/a.ts', parentDirectory: 'src', subDirectory: '' }),
        createFileDiff({ filePath: 'src/b.ts', parentDirectory: 'src', subDirectory: '' }),
        createFileDiff({ filePath: 'src/utils/c.ts', parentDirectory: 'src', subDirectory: 'utils' }),
        createFileDiff({ filePath: 'lib/d.ts', parentDirectory: 'lib', subDirectory: '' }),
      ];

      const rows = service.buildDirectoryRows('sha123', 'testuser', files);

      expect(rows).toHaveLength(3);
      expect(rows.find(r => r.directory === 'src' && r.subdirectory === '')).toBeDefined();
      expect(rows.find(r => r.directory === 'src' && r.subdirectory === 'utils')).toBeDefined();
      expect(rows.find(r => r.directory === 'lib' && r.subdirectory === '')).toBeDefined();
    });

    it('should deduplicate directory entries', () => {
      const files = [
        createFileDiff({ parentDirectory: 'src', subDirectory: '' }),
        createFileDiff({ parentDirectory: 'src', subDirectory: '' }),
        createFileDiff({ parentDirectory: 'src', subDirectory: '' }),
      ];

      const rows = service.buildDirectoryRows('sha123', 'testuser', files);
      expect(rows).toHaveLength(1);
    });

    it('should include sha and author in all rows', () => {
      const files = [createFileDiff()];
      const rows = service.buildDirectoryRows('sha789', 'author2', files);

      expect(rows.every(r => r.sha === 'sha789')).toBe(true);
      expect(rows.every(r => r.author === 'author2')).toBe(true);
    });

    it('should return empty array for empty file list', () => {
      const rows = service.buildDirectoryRows('sha123', 'testuser', []);
      expect(rows).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // IQS-883: Security hardening - MAX_FILES_PER_COMMIT threshold
  // --------------------------------------------------------------------------

  describe('getFileMetricsViaScc - MAX_FILES threshold (IQS-883, CWE-400)', () => {
    it('should skip commits exceeding MAX_FILES_PER_COMMIT threshold', async () => {
      // Create a file list exceeding the threshold
      const largeFileList = Array.from(
        { length: MAX_FILES_PER_COMMIT + 1 },
        (_, i) => `src/file${i}.ts`,
      );

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await service.getFileMetricsViaScc(git as any, 'abc123', largeFileList);

      expect(result.size).toBe(0);
      // Should not even check scc availability
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('should process commits at exactly MAX_FILES_PER_COMMIT threshold', async () => {
      // scc --version succeeds
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });

      // git show returns file content for all files
      mockGitShow.mockResolvedValue('const x = 1;');

      // scc returns empty output (we just want to verify it's called)
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const exactFileList = Array.from(
        { length: MAX_FILES_PER_COMMIT },
        (_, i) => `src/file${i}.ts`,
      );

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await service.getFileMetricsViaScc(git as any, 'abc123', exactFileList);

      // Should have checked scc availability (first execFile call for --version)
      expect(mockExecFile).toHaveBeenCalledWith('scc', ['--version']);
    });
  });

  // --------------------------------------------------------------------------
  // IQS-883: Security hardening - Consecutive cleanup failure tracking
  // --------------------------------------------------------------------------

  describe('getFileMetricsViaScc - cleanup failure tracking (IQS-883, CWE-459)', () => {
    it('should increment consecutive cleanup failure counter when rm fails', async () => {
      // scc --version succeeds
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });

      // git show returns content
      mockGitShow.mockResolvedValue('const x = 1;');

      // scc returns valid output
      const sccOutput = createSccOutput([
        { filename: '/tmp/gitrx-scc-test123/src/main.ts', lines: 10, code: 8 },
      ]);
      mockExecFile.mockResolvedValueOnce({ stdout: sccOutput, stderr: '' });

      // rm fails
      mockRm.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await service.getFileMetricsViaScc(git as any, 'abc123', ['src/main.ts']);

      expect(service.consecutiveCleanupFailures).toBe(1);
    });

    it('should reset cleanup failure counter on successful cleanup', async () => {
      // First call: simulate cleanup failure
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });
      mockGitShow.mockResolvedValue('const x = 1;');
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockRm.mockRejectedValueOnce(new Error('EACCES'));

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await service.getFileMetricsViaScc(git as any, 'abc123', ['src/main.ts']);
      expect(service.consecutiveCleanupFailures).toBe(1);

      // Second call: cleanup succeeds
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockRm.mockResolvedValueOnce(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await service.getFileMetricsViaScc(git as any, 'def456', ['src/main.ts']);
      expect(service.consecutiveCleanupFailures).toBe(0);
    });

    it('should block scc calls when cleanup failure threshold exceeded', async () => {
      // Manually set the failure counter to the threshold via repeated failures
      for (let i = 0; i < MAX_CONSECUTIVE_CLEANUP_FAILURES; i++) {
        mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });
        mockGitShow.mockResolvedValue('const x = 1;');
        mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockRm.mockRejectedValueOnce(new Error('EACCES'));

        const git = createMockGit();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await service.getFileMetricsViaScc(git as any, `sha${i}`, ['src/main.ts']);
        service.resetAvailabilityCache(); // Reset so version check doesn't short-circuit
      }

      expect(service.consecutiveCleanupFailures).toBe(MAX_CONSECUTIVE_CLEANUP_FAILURES);
      expect(service.cleanupFailureThresholdExceeded).toBe(true);

      // Now the next call should be blocked without even checking scc availability
      mockExecFile.mockClear();
      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await service.getFileMetricsViaScc(git as any, 'blocked', ['src/file.ts']);
      expect(result.size).toBe(0);
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('should expose cleanupFailureThresholdExceeded correctly', () => {
      expect(service.cleanupFailureThresholdExceeded).toBe(false);
      expect(service.consecutiveCleanupFailures).toBe(0);
    });

    it('should allow resetCleanupFailureCounter to clear the counter', async () => {
      // Simulate a failure
      mockExecFile.mockResolvedValueOnce({ stdout: 'scc version 3.1.0', stderr: '' });
      mockGitShow.mockResolvedValue('const x = 1;');
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockRm.mockRejectedValueOnce(new Error('EACCES'));

      const git = createMockGit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await service.getFileMetricsViaScc(git as any, 'abc123', ['src/main.ts']);
      expect(service.consecutiveCleanupFailures).toBe(1);

      // Manually reset
      service.resetCleanupFailureCounter();
      expect(service.consecutiveCleanupFailures).toBe(0);
      expect(service.cleanupFailureThresholdExceeded).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // findMatchingFilePath
  // --------------------------------------------------------------------------

  describe('findMatchingFilePath', () => {
    it('should match exact file paths', () => {
      const result = findMatchingFilePath('src/main.ts', ['src/main.ts', 'src/utils.ts']);
      expect(result).toBe('src/main.ts');
    });

    it('should match file paths by endsWith (Python _find_string_ending_with behavior)', () => {
      // scc may report a relative path that is a suffix of the original
      const result = findMatchingFilePath('main.ts', ['src/main.ts', 'src/utils.ts']);
      expect(result).toBe('src/main.ts');
    });

    it('should return undefined for no match', () => {
      const result = findMatchingFilePath('nonexistent.ts', ['src/main.ts']);
      expect(result).toBeUndefined();
    });

    it('should prefer exact match over endsWith match', () => {
      // If there's both an exact and endsWith match, exact should win
      const result = findMatchingFilePath('main.ts', ['main.ts', 'src/main.ts']);
      expect(result).toBe('main.ts');
    });

    it('should handle empty file path list', () => {
      const result = findMatchingFilePath('main.ts', []);
      expect(result).toBeUndefined();
    });

    it('should handle empty target string', () => {
      // Empty string would match all paths via endsWith, but that's degenerate
      const result = findMatchingFilePath('', ['src/main.ts']);
      // Empty string: every string endsWith(''), so first match is returned
      expect(result).toBe('src/main.ts');
    });
  });
});
