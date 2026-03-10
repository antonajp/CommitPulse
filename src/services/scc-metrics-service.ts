/**
 * SCC CLI integration service for file-level code complexity metrics.
 *
 * Extracts file trees from git commits into temporary directories,
 * runs the `scc` (Sloc Cloc and Code) CLI tool to calculate per-file
 * metrics (Lines, Code, Comment, Complexity, WeightedComplexity), and
 * merges results into CommitFileRow / CommitFileTypeRow / CommitDirectoryRow
 * data structures for database persistence.
 *
 * Maps from Python GitCommitHistorySql.py methods:
 *   get_commit_files_scc_details -> getFileMetricsViaScc
 *   create_commit_df             -> buildCommitFileRows
 *   write_details_to_sql         -> (caller uses CommitRepository.insertCommitFiles)
 *   write_file_types_to_sql      -> buildFileTypeRows
 *   write_directories_to_sql     -> buildDirectoryRows
 *   _find_string_ending_with     -> findMatchingFilePath
 *
 * CRITICAL differences from Python:
 *   - Python uses subprocess.run(['scc', ...]) -> TypeScript uses child_process.execFile
 *   - Python uses pandas DataFrames for groupby -> TypeScript uses plain arrays + Map
 *   - Python uses TemporaryDirectory context manager -> TypeScript uses fs.mkdtemp + cleanup
 *   - Python uses f-string SQL (injection risk) -> TypeScript returns typed row objects
 *
 * Ticket: IQS-855
 */

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, normalize, isAbsolute, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { SimpleGit } from 'simple-git';
import { LoggerService } from '../logging/logger.js';
import type {
  CommitFileRow,
  CommitFileTypeRow,
  CommitDirectoryRow,
} from '../database/commit-types.js';
import type { ExtractedFileDiff } from './git-analysis-types.js';

const execFileAsync = promisify(execFile);

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'SccMetricsService';

/**
 * Maximum number of files per commit that scc will analyze.
 * Commits exceeding this threshold are skipped to prevent resource
 * exhaustion from extremely large commits (CWE-400).
 *
 * Ticket: IQS-883
 */
export const MAX_FILES_PER_COMMIT = 1_000;

/**
 * Maximum number of consecutive temp directory cleanup failures
 * before aborting to prevent disk exhaustion (CWE-459).
 *
 * Ticket: IQS-883
 */
export const MAX_CONSECUTIVE_CLEANUP_FAILURES = 5;

// ============================================================================
// SCC JSON output types
// ============================================================================

/**
 * A single file entry from scc's --by-file JSON output.
 * Matches the scc JSON schema for per-file results.
 */
export interface SccFileEntry {
  readonly Filename: string;
  readonly Lines: number;
  readonly Code: number;
  readonly Comment: number;
  readonly Blank: number;
  readonly Complexity: number;
  readonly WeightedComplexity: number;
  readonly Language: string;
}

/**
 * A language group entry from scc's --by-file JSON output.
 * Each group contains a "Files" array of SccFileEntry items.
 */
export interface SccLanguageGroup {
  readonly Name: string;
  readonly Files: readonly SccFileEntry[];
}

// ============================================================================
// SCC metrics result
// ============================================================================

/**
 * Per-file scc metrics mapped to a commit file path.
 * Contains the raw metrics from scc that get merged into CommitFileRow.
 */
export interface SccFileMetrics {
  readonly totalLines: number;
  readonly totalCodeLines: number;
  readonly totalCommentLines: number;
  readonly complexity: number;
  readonly weightedComplexity: number;
}

// ============================================================================
// SccMetricsService
// ============================================================================

/**
 * Service for extracting per-file code metrics using the scc CLI tool.
 *
 * The scc tool (https://github.com/boyter/scc) provides per-file metrics
 * including lines of code, comments, blanks, and cyclomatic complexity.
 *
 * Workflow:
 * 1. Extract commit file tree to a temp directory
 * 2. Run `scc --by-file -f json <tmpdir>` subprocess
 * 3. Parse JSON output and match files to commit diff paths
 * 4. Build typed row objects for database insertion
 *
 * Handles missing scc gracefully: warns and continues without metrics.
 */
export class SccMetricsService {
  private readonly logger: LoggerService;
  private sccAvailable: boolean | undefined;

  /** Consecutive temp cleanup failures; aborts at MAX threshold (IQS-883, CWE-459). */
  private _consecutiveCleanupFailures = 0;

  constructor() {
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'SccMetricsService created');
  }

  /** Current count of consecutive cleanup failures (IQS-883). */
  get consecutiveCleanupFailures(): number {
    return this._consecutiveCleanupFailures;
  }

  /** True if consecutive cleanup failures exceeded threshold (IQS-883). */
  get cleanupFailureThresholdExceeded(): boolean {
    return this._consecutiveCleanupFailures >= MAX_CONSECUTIVE_CLEANUP_FAILURES;
  }

  /** Reset the consecutive cleanup failure counter (IQS-883). */
  resetCleanupFailureCounter(): void {
    this._consecutiveCleanupFailures = 0;
    this.logger.debug(CLASS_NAME, 'resetCleanupFailureCounter', 'Cleanup failure counter reset');
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Check if the scc CLI tool is available on the system PATH.
   * Caches the result after the first call.
   *
   * @returns true if scc is available, false otherwise
   */
  async isSccAvailable(): Promise<boolean> {
    if (this.sccAvailable !== undefined) {
      this.logger.trace(CLASS_NAME, 'isSccAvailable', `Cached result: ${this.sccAvailable}`);
      return this.sccAvailable;
    }

    this.logger.debug(CLASS_NAME, 'isSccAvailable', 'Checking scc availability...');
    try {
      const { stdout } = await execFileAsync('scc', ['--version']);
      this.sccAvailable = true;
      this.logger.info(CLASS_NAME, 'isSccAvailable', `scc is available: ${stdout.trim()}`);
      return true;
    } catch (error: unknown) {
      this.sccAvailable = false;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'isSccAvailable', `scc is not available: ${message}. File metrics will be skipped.`);
      return false;
    }
  }

  /**
   * Reset the cached scc availability check.
   * Used in tests and when the user installs scc after extension startup.
   */
  resetAvailabilityCache(): void {
    this.sccAvailable = undefined;
    this.logger.debug(CLASS_NAME, 'resetAvailabilityCache', 'scc availability cache cleared');
  }

  /**
   * Get file-level scc metrics for a commit's files.
   * Maps from Python get_commit_files_scc_details().
   *
   * Extracts the relevant files from the commit tree to a temp directory,
   * runs scc against it, and returns a map of file path -> metrics.
   *
   * @param git - SimpleGit instance for the repository
   * @param commitSha - The commit SHA to analyze
   * @param filePaths - File paths from the commit diff to analyze
   * @returns Map of file path -> SccFileMetrics, empty map if scc unavailable
   */
  async getFileMetricsViaScc(
    git: SimpleGit,
    commitSha: string,
    filePaths: readonly string[],
  ): Promise<ReadonlyMap<string, SccFileMetrics>> {
    const emptyResult = new Map<string, SccFileMetrics>();

    if (filePaths.length === 0) {
      this.logger.debug(CLASS_NAME, 'getFileMetricsViaScc', `No files to analyze for ${commitSha.substring(0, 8)}`);
      return emptyResult;
    }

    // SECURITY (IQS-883, CWE-400): Skip commits exceeding MAX_FILES threshold
    // to prevent resource exhaustion from extremely large commits.
    if (filePaths.length > MAX_FILES_PER_COMMIT) {
      this.logger.warn(
        CLASS_NAME,
        'getFileMetricsViaScc',
        `Skipping commit ${commitSha.substring(0, 8)}: ${filePaths.length} files exceeds MAX_FILES_PER_COMMIT (${MAX_FILES_PER_COMMIT}). ` +
        `This protects against resource exhaustion (CWE-400).`,
      );
      return emptyResult;
    }

    // SECURITY (IQS-883, CWE-459): Abort if consecutive cleanup failures
    // have exceeded the threshold to prevent disk exhaustion.
    if (this.cleanupFailureThresholdExceeded) {
      this.logger.error(
        CLASS_NAME,
        'getFileMetricsViaScc',
        `Aborting scc analysis: ${this._consecutiveCleanupFailures} consecutive cleanup failures ` +
        `exceeded threshold (${MAX_CONSECUTIVE_CLEANUP_FAILURES}). Possible disk exhaustion risk (CWE-459).`,
      );
      return emptyResult;
    }

    // Check scc availability
    const available = await this.isSccAvailable();
    if (!available) {
      this.logger.debug(CLASS_NAME, 'getFileMetricsViaScc', `Skipping scc metrics for ${commitSha.substring(0, 8)} (scc unavailable)`);
      return emptyResult;
    }

    this.logger.debug(CLASS_NAME, 'getFileMetricsViaScc', `Analyzing ${filePaths.length} files for commit ${commitSha.substring(0, 8)}`);

    let tmpDir: string | undefined;
    try {
      // Create temp directory under $HOME/gitrx-tmp/ so snap-confined scc can access it.
      // Snap packages (e.g., scc installed via snap) cannot read /tmp or hidden
      // directories like $HOME/.cache due to confinement restrictions.
      const sccTmpBase = join(homedir(), 'gitrx-tmp');
      await mkdir(sccTmpBase, { recursive: true });
      tmpDir = await mkdtemp(join(sccTmpBase, 'scc-'));
      this.logger.debug(CLASS_NAME, 'getFileMetricsViaScc', `Created temp directory: ${tmpDir}`);

      // Extract files from git tree to temp directory
      const extractedCount = await this.extractFilesToTempDir(git, commitSha, filePaths, tmpDir);
      this.logger.debug(CLASS_NAME, 'getFileMetricsViaScc', `Extracted ${extractedCount} files to temp directory`);

      if (extractedCount === 0) {
        this.logger.debug(CLASS_NAME, 'getFileMetricsViaScc', `No files extracted for ${commitSha.substring(0, 8)}, skipping scc`);
        return emptyResult;
      }

      // Run scc
      const sccOutput = await this.runScc(tmpDir);
      if (!sccOutput) {
        this.logger.debug(CLASS_NAME, 'getFileMetricsViaScc', `scc returned no output for ${commitSha.substring(0, 8)}`);
        return emptyResult;
      }

      // Parse scc output and match to file paths
      const metrics = this.parseSccOutput(sccOutput, filePaths, tmpDir);
      this.logger.debug(CLASS_NAME, 'getFileMetricsViaScc', `Parsed scc metrics for ${metrics.size} files`);

      return metrics;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'getFileMetricsViaScc', `Failed to get scc metrics for ${commitSha.substring(0, 8)}: ${message}`);
      return emptyResult;
    } finally {
      // Clean up temp directory and track consecutive cleanup failures (IQS-883, CWE-459)
      if (tmpDir) {
        try {
          await rm(tmpDir, { recursive: true, force: true });
          this.logger.trace(CLASS_NAME, 'getFileMetricsViaScc', `Cleaned up temp directory: ${tmpDir}`);
          // Reset consecutive failure counter on success
          if (this._consecutiveCleanupFailures > 0) {
            this.logger.debug(
              CLASS_NAME,
              'getFileMetricsViaScc',
              `Cleanup succeeded, resetting consecutive failure counter (was ${this._consecutiveCleanupFailures})`,
            );
            this._consecutiveCleanupFailures = 0;
          }
        } catch (cleanupError: unknown) {
          this._consecutiveCleanupFailures++;
          const msg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          this.logger.warn(
            CLASS_NAME,
            'getFileMetricsViaScc',
            `Failed to clean up temp directory (consecutive failures: ${this._consecutiveCleanupFailures}/${MAX_CONSECUTIVE_CLEANUP_FAILURES}): ${msg}`,
          );
          if (this.cleanupFailureThresholdExceeded) {
            this.logger.error(
              CLASS_NAME,
              'getFileMetricsViaScc',
              `Consecutive cleanup failure threshold exceeded (${this._consecutiveCleanupFailures}). ` +
              `Subsequent scc calls will be blocked until counter is reset.`,
            );
          }
        }
      }
    }
  }

  /**
   * Build CommitFileRow objects from extracted file diffs and optional scc metrics.
   * Maps from Python create_commit_df() + write_details_to_sql().
   *
   * Merges per-file scc metrics (lines, code, comments, complexity) with
   * the base file diff data (insertions, deletions, extension, directories).
   *
   * @param sha - Commit SHA
   * @param author - Commit author name
   * @param files - Extracted file diffs from the commit
   * @param sccMetrics - Optional map of file path -> scc metrics
   * @returns Array of CommitFileRow ready for database insertion
   */
  buildCommitFileRows(
    sha: string,
    author: string,
    files: readonly ExtractedFileDiff[],
    sccMetrics: ReadonlyMap<string, SccFileMetrics> = new Map(),
  ): CommitFileRow[] {
    this.logger.debug(CLASS_NAME, 'buildCommitFileRows', `Building file rows for ${sha.substring(0, 8)} from ${files.length} files`);

    const rows: CommitFileRow[] = [];

    for (const file of files) {
      // Skip dependency/generated directories - these should not be in version control
      // and inflate LOC metrics when accidentally committed
      if (this.isDependencyPath(file.filePath)) {
        this.logger.trace(CLASS_NAME, 'buildCommitFileRows', `Skipping dependency file: ${file.filePath}`);
        continue;
      }
      // Test file detection: Python uses "TEST" in str(row['file_path']).upper()
      const isTestFile = file.filePath.toUpperCase().includes('TEST');

      // Look up scc metrics for this file
      const metrics = sccMetrics.get(file.filePath);
      const totalLines = metrics?.totalLines ?? 0;
      const totalCodeLines = metrics?.totalCodeLines ?? 0;
      const totalCommentLines = metrics?.totalCommentLines ?? 0;
      const complexity = metrics?.complexity ?? 0;
      const weightedComplexity = metrics?.weightedComplexity ?? 0;

      this.logger.trace(CLASS_NAME, 'buildCommitFileRows', `File: ${file.filePath}, scc=${metrics !== undefined}, complexity=${complexity}`);

      rows.push({
        sha,
        filename: file.filePath,
        fileExtension: file.fileExtension,
        lineInserts: file.insertions,
        lineDeletes: file.deletions,
        lineDiff: file.delta,
        totalLines,
        totalCodeLines,
        totalCommentLines,
        complexity,
        weightedComplexity,
        author,
        parentDirectory: file.parentDirectory,
        subDirectory: file.subDirectory,
        isTestFile,
        complexityChange: null,
        commentsChange: null,
        codeChange: null,
      });
    }

    const skipped = files.length - rows.length;
    if (skipped > 0) {
      this.logger.debug(CLASS_NAME, 'buildCommitFileRows', `Built ${rows.length} file rows for ${sha.substring(0, 8)} (skipped ${skipped} dependency files)`);
    } else {
      this.logger.debug(CLASS_NAME, 'buildCommitFileRows', `Built ${rows.length} file rows for ${sha.substring(0, 8)}`);
    }
    return rows;
  }

  /**
   * Build CommitFileTypeRow objects by grouping files by extension + directories.
   * Maps from Python write_file_types_to_sql() which uses pandas groupby.
   *
   * Groups files by (file_extension, parent_directory, sub_directory)
   * and counts occurrences in each group.
   *
   * @param sha - Commit SHA
   * @param author - Commit author name
   * @param files - Extracted file diffs from the commit
   * @returns Array of CommitFileTypeRow ready for database insertion
   */
  buildFileTypeRows(
    sha: string,
    author: string,
    files: readonly ExtractedFileDiff[],
  ): CommitFileTypeRow[] {
    this.logger.debug(CLASS_NAME, 'buildFileTypeRows', `Building file type rows for ${sha.substring(0, 8)} from ${files.length} files`);

    // Group by (file_extension, parent_directory, sub_directory)
    const groupMap = new Map<string, number>();

    for (const file of files) {
      // Skip dependency directories
      if (this.isDependencyPath(file.filePath)) {
        continue;
      }
      const key = `${file.fileExtension}|${file.parentDirectory}|${file.subDirectory}`;
      const current = groupMap.get(key) ?? 0;
      groupMap.set(key, current + 1);
    }

    const rows: CommitFileTypeRow[] = [];

    for (const [key, count] of groupMap) {
      const parts = key.split('|');
      const fileExtension = parts[0] ?? '';
      const parentDirectory = parts[1] ?? '';
      const subDirectory = parts[2] ?? '';

      rows.push({
        sha,
        fileExtension,
        numCount: count,
        author,
        parentDirectory,
        subDirectory,
      });
    }

    this.logger.debug(CLASS_NAME, 'buildFileTypeRows', `Built ${rows.length} file type rows for ${sha.substring(0, 8)}`);
    return rows;
  }

  /**
   * Build CommitDirectoryRow objects by grouping files by directories.
   * Maps from Python write_directories_to_sql() which uses pandas groupby.
   *
   * Groups files by (parent_directory, sub_directory) and creates one
   * row per unique directory combination.
   *
   * @param sha - Commit SHA
   * @param author - Commit author name
   * @param files - Extracted file diffs from the commit
   * @returns Array of CommitDirectoryRow ready for database insertion
   */
  buildDirectoryRows(
    sha: string,
    author: string,
    files: readonly ExtractedFileDiff[],
  ): CommitDirectoryRow[] {
    this.logger.debug(CLASS_NAME, 'buildDirectoryRows', `Building directory rows for ${sha.substring(0, 8)} from ${files.length} files`);

    // Group by (parent_directory, sub_directory) - deduplicate
    const seen = new Set<string>();
    const rows: CommitDirectoryRow[] = [];

    for (const file of files) {
      // Skip dependency directories
      if (this.isDependencyPath(file.filePath)) {
        continue;
      }
      const key = `${file.parentDirectory}|${file.subDirectory}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({
          sha,
          directory: file.parentDirectory,
          subdirectory: file.subDirectory,
          author,
        });
      }
    }

    this.logger.debug(CLASS_NAME, 'buildDirectoryRows', `Built ${rows.length} directory rows for ${sha.substring(0, 8)}`);
    return rows;
  }

  // --------------------------------------------------------------------------
  // Private: Dependency path detection
  // --------------------------------------------------------------------------

  /**
   * Check if a file path is within a dependency, build artifact, or transient directory.
   * These directories inflate LOC metrics when accidentally committed.
   *
   * Excluded directories by category:
   *
   * JavaScript/TypeScript dependencies:
   *   - node_modules/, .yarn/, bower_components/, jspm_packages/
   *
   * JavaScript build artifacts:
   *   - .next/, .nuxt/, .svelte-kit/, .angular/, .output/
   *   - .parcel-cache/, .vite/, .turbo/, storybook-static/
   *
   * Python:
   *   - __pycache__/, .venv/, venv/, env/, site-packages/
   *   - .eggs/, .tox/, .nox/, .mypy_cache/, .pytest_cache/
   *
   * Java/JVM:
   *   - target/, .gradle/, .m2/, out/
   *
   * Ruby:
   *   - vendor/bundle/, .bundle/
   *
   * PHP/Go:
   *   - vendor/
   *
   * .NET/C#:
   *   - bin/, obj/, packages/, .nuget/
   *
   * Rust:
   *   - target/
   *
   * Infrastructure/IaC:
   *   - .terraform/, .pulumi/, cdk.out/, .aws-sam/, .serverless/
   *
   * General build/transient:
   *   - dist/, build/, coverage/, .cache/
   *   - tmp/, .tmp/, temp/, logs/
   *   - __generated__/, generated/
   *
   * @param filePath - Relative file path from commit
   * @returns true if file should be excluded from LOC metrics
   */
  private isDependencyPath(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();

    // Root-level directories to exclude
    const rootPrefixes = [
      // JavaScript/TypeScript dependencies
      'node_modules/',
      '.yarn/',
      'bower_components/',
      'jspm_packages/',
      // JavaScript build artifacts
      '.next/',
      '.nuxt/',
      '.svelte-kit/',
      '.angular/',
      '.output/',
      '.parcel-cache/',
      '.vite/',
      '.turbo/',
      'storybook-static/',
      '.docusaurus/',
      '.expo/',
      // Python
      '__pycache__/',
      '.venv/',
      'venv/',
      'env/',
      'site-packages/',
      '.eggs/',
      '.tox/',
      '.nox/',
      '.mypy_cache/',
      '.pytest_cache/',
      '.ruff_cache/',
      // Java/JVM
      'target/',
      '.gradle/',
      '.m2/',
      'out/',
      // Ruby
      '.bundle/',
      // PHP/Go
      'vendor/',
      // .NET/C#
      'bin/',
      'obj/',
      'packages/',
      '.nuget/',
      // Infrastructure/IaC
      '.terraform/',
      '.pulumi/',
      'cdk.out/',
      '.aws-sam/',
      '.serverless/',
      // General build/transient
      'dist/',
      'build/',
      'coverage/',
      '.cache/',
      'tmp/',
      '.tmp/',
      'temp/',
      'logs/',
      '__generated__/',
      'generated/',
    ];

    // Check root-level prefixes
    for (const prefix of rootPrefixes) {
      if (lowerPath.startsWith(prefix)) {
        return true;
      }
    }

    // Also check for these directories nested anywhere in the path
    const nestedPatterns = [
      '/node_modules/',
      '/vendor/',
      '/__pycache__/',
      '/site-packages/',
      '/.venv/',
      '/venv/',
      '/target/',
      '/bin/',
      '/obj/',
      '/dist/',
      '/build/',
      '/.next/',
      '/.nuxt/',
      '/__generated__/',
    ];

    for (const pattern of nestedPatterns) {
      if (lowerPath.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Private: File extraction
  // --------------------------------------------------------------------------

  /**
   * Extract files from a git commit tree to a temporary directory.
   * Maps from the file extraction logic in Python get_commit_files_scc_details().
   *
   * Only extracts files that appear in the commit's file diff list.
   * This mirrors the Python approach that only runs scc on modified files.
   *
   * @param git - SimpleGit instance
   * @param commitSha - The commit SHA to extract files from
   * @param filePaths - File paths to extract (from commit diff)
   * @param tmpDir - Temporary directory to write files into
   * @returns Number of files successfully extracted
   */
  private async extractFilesToTempDir(
    git: SimpleGit,
    commitSha: string,
    filePaths: readonly string[],
    tmpDir: string,
  ): Promise<number> {
    this.logger.trace(CLASS_NAME, 'extractFilesToTempDir', `Extracting ${filePaths.length} files for ${commitSha.substring(0, 8)}`);
    let extractedCount = 0;

    for (const filePath of filePaths) {
      try {
        // SECURITY: Validate file path to prevent directory traversal (IQS-882)
        const normalizedPath = normalize(filePath);
        if (normalizedPath.startsWith('..') || isAbsolute(normalizedPath)) {
          this.logger.warn(CLASS_NAME, 'extractFilesToTempDir', `Skipping unsafe path: ${filePath}`);
          continue;
        }
        const destPath = join(tmpDir, normalizedPath);
        const resolvedDest = resolve(destPath);
        const resolvedTmpDir = resolve(tmpDir);
        if (!resolvedDest.startsWith(resolvedTmpDir + sep)) {
          this.logger.warn(CLASS_NAME, 'extractFilesToTempDir', `Path traversal blocked: ${filePath}`);
          continue;
        }

        // Use git show to get file content at specific commit
        const content = await git.show([`${commitSha}:${filePath}`]);

        // Create parent directories
        await mkdir(dirname(destPath), { recursive: true });

        // Write file content
        await writeFile(destPath, content, 'utf-8');
        extractedCount++;
        this.logger.trace(CLASS_NAME, 'extractFilesToTempDir', `Extracted: ${filePath}`);
      } catch (error: unknown) {
        // File may have been deleted or renamed - skip it
        const message = error instanceof Error ? error.message : String(error);
        this.logger.trace(CLASS_NAME, 'extractFilesToTempDir', `Could not extract ${filePath}: ${message}`);
      }
    }

    return extractedCount;
  }

  // --------------------------------------------------------------------------
  // Private: SCC execution
  // --------------------------------------------------------------------------

  /**
   * Run the scc CLI tool against a directory.
   * Maps from Python: subprocess.run(['scc', '--by-file', '-f', 'json', tmp_dir])
   *
   * @param directory - Directory to analyze
   * @returns Raw JSON string from scc stdout, or undefined on failure
   */
  private async runScc(directory: string): Promise<string | undefined> {
    this.logger.debug(CLASS_NAME, 'runScc', `Running scc on directory: ${directory}`);

    try {
      const { stdout, stderr } = await execFileAsync('scc', [
        '--by-file',
        '-f', 'json',
        directory,
      ], {
        timeout: 60_000, // 60-second timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
      });

      if (stderr && stderr.trim().length > 0) {
        this.logger.debug(CLASS_NAME, 'runScc', `scc stderr: ${stderr.trim()}`);
      }

      if (!stdout || stdout.trim().length === 0) {
        this.logger.debug(CLASS_NAME, 'runScc', 'scc produced empty output');
        return undefined;
      }

      this.logger.trace(CLASS_NAME, 'runScc', `scc output length: ${stdout.length} chars`);
      return stdout;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // execFile errors include stderr on the error object
      const stderrOutput = (error as { stderr?: string }).stderr;
      if (stderrOutput) {
        this.logger.error(CLASS_NAME, 'runScc', `scc execution failed: ${message} | stderr: ${stderrOutput.trim()}`);
      } else {
        this.logger.error(CLASS_NAME, 'runScc', `scc execution failed: ${message}`);
      }
      return undefined;
    }
  }

  // --------------------------------------------------------------------------
  // Private: SCC output parsing
  // --------------------------------------------------------------------------

  /**
   * Parse scc JSON output and match files to commit diff paths.
   * Maps from the matching logic in Python get_commit_files_scc_details().
   *
   * scc outputs a JSON array of language groups, each containing a Files array.
   * Each file has Filename (full path from the temp directory), Lines, Code,
   * Comment, Complexity, and WeightedComplexity.
   *
   * @param sccOutput - Raw JSON string from scc
   * @param filePaths - Original file paths from the commit diff
   * @param tmpDir - Temp directory path (prefix to strip from scc filenames)
   * @returns Map of original file path -> SccFileMetrics
   */
  private parseSccOutput(
    sccOutput: string,
    filePaths: readonly string[],
    tmpDir: string,
  ): Map<string, SccFileMetrics> {
    this.logger.trace(CLASS_NAME, 'parseSccOutput', `Parsing scc output for ${filePaths.length} files`);
    const metricsMap = new Map<string, SccFileMetrics>();

    let data: SccLanguageGroup[];
    try {
      data = JSON.parse(sccOutput) as SccLanguageGroup[];
    } catch (parseError: unknown) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      this.logger.error(CLASS_NAME, 'parseSccOutput', `Failed to parse scc JSON: ${message}`);
      return metricsMap;
    }

    if (!Array.isArray(data)) {
      this.logger.warn(CLASS_NAME, 'parseSccOutput', 'scc output is not an array');
      return metricsMap;
    }

    // Track already-processed filenames to avoid duplicates (matches Python file_list set)
    const processedFilenames = new Set<string>();

    // Normalize tmpDir path for stripping
    const tmpDirPrefix = tmpDir.endsWith('/') ? tmpDir : tmpDir + '/';

    for (const group of data) {
      if (!group.Files || !Array.isArray(group.Files)) {
        continue;
      }

      for (const sccFile of group.Files) {
        if (processedFilenames.has(sccFile.Filename)) {
          continue;
        }
        processedFilenames.add(sccFile.Filename);

        // Strip temp directory prefix to get relative path
        let relativePath = sccFile.Filename;
        if (relativePath.startsWith(tmpDirPrefix)) {
          relativePath = relativePath.substring(tmpDirPrefix.length);
        }

        // Match to original file path
        // Python uses _find_string_ending_with which checks if original path ends with scc filename
        const matchedPath = findMatchingFilePath(relativePath, filePaths);
        if (matchedPath) {
          metricsMap.set(matchedPath, {
            totalLines: sccFile.Lines,
            totalCodeLines: sccFile.Code,
            totalCommentLines: sccFile.Comment,
            complexity: sccFile.Complexity,
            weightedComplexity: sccFile.WeightedComplexity,
          });
          this.logger.trace(CLASS_NAME, 'parseSccOutput', `Matched: ${relativePath} -> ${matchedPath} (complexity=${sccFile.Complexity})`);
        }
      }
    }

    this.logger.debug(CLASS_NAME, 'parseSccOutput', `Matched ${metricsMap.size} of ${filePaths.length} files`);
    return metricsMap;
  }
}

// ============================================================================
// Utility functions (exported for testing)
// ============================================================================

/**
 * Find the original file path that ends with the target filename.
 * Maps from Python _find_string_ending_with().
 *
 * Handles cases where scc reports a relative filename while the original
 * path may contain additional parent directories.
 *
 * @param target - The filename/relative path from scc output
 * @param filePaths - The original commit file paths to search
 * @returns The matching file path, or undefined if no match
 */
export function findMatchingFilePath(
  target: string,
  filePaths: readonly string[],
): string | undefined {
  // First try exact match
  for (const path of filePaths) {
    if (path === target) {
      return path;
    }
  }

  // Then try endsWith match (matches Python behavior)
  for (const path of filePaths) {
    if (path.endsWith(target)) {
      return path;
    }
  }

  return undefined;
}
