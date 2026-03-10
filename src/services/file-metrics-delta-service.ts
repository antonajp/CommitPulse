/**
 * FileMetricsDeltaService: Calculate per-file complexity, comment, and code
 * line deltas between consecutive commits.
 *
 * Converts Python GitjaDataEnhancer.py methods to TypeScript:
 *   - calculate_complexity_comments_code_change -> calculateFileMetricsDeltas
 *   - _calculate_complexity_comments_code_change -> calculateDeltasForFile
 *
 * Key differences from Python:
 *   - Parameterized SQL via CommitRepository.batchUpdateFileMetricsDeltas (no f-strings)
 *   - TypeScript arrays + sort replace pandas groupby/diff/fillna
 *   - Batch transaction processing with configurable commit cycle
 *   - Note: The vw_commit_file_chage_history view already calculates these via
 *     LAG() window functions, so materialization is optional. This service exists
 *     for backward compatibility with the Python pipeline behavior.
 *
 * Ticket: IQS-863
 */

import { LoggerService } from '../logging/logger.js';
import { CommitRepository } from '../database/commit-repository.js';
import type { CommitFileMetrics, FileMetricsDelta } from '../database/commit-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'FileMetricsDeltaService';

/**
 * Default number of weeks to look back for file modifications.
 * Matches the Python default: datetime.now() - timedelta(weeks=2).
 */
const DEFAULT_SINCE_WEEKS = 2;

/**
 * Default commit cycle batch size.
 * Matches the Python default: commit_cycle=1000.
 */
const DEFAULT_COMMIT_CYCLE = 1000;

/**
 * Options for file metrics delta calculation.
 */
export interface FileMetricsDeltaOptions {
  /** ISO date string (YYYY-MM-DD) for the since cutoff. Default: 2 weeks ago. */
  readonly sinceDate?: string;
  /** Number of files to process per batch/transaction. Default: 1000. */
  readonly commitCycle?: number;
}

/**
 * Result of a file metrics delta calculation run.
 */
export interface FileMetricsDeltaResult {
  /** Number of unique files processed. */
  readonly filesProcessed: number;
  /** Total number of delta rows calculated and updated. */
  readonly deltasCalculated: number;
  /** Processing time in milliseconds. */
  readonly durationMs: number;
}

/**
 * FileMetricsDeltaService calculates per-file complexity, comment, and code
 * line deltas between consecutive commits and materializes them in the
 * commit_files table.
 *
 * Maps from Python GitjaDataEnhancer class methods:
 *   calculate_complexity_comments_code_change (line 167)
 *   _calculate_complexity_comments_code_change (line 188)
 *
 * Processing flow:
 * 1. Get unique files modified since a given date (files with > 1 commit)
 * 2. For each file, fetch base metrics ordered by commit_date
 * 3. Sort by commit_date, calculate diff (current - previous, first = value itself)
 * 4. Batch UPDATE commit_files with the calculated deltas
 *
 * The commit_cycle parameter controls transaction batching: every N files,
 * a new transaction is opened and the previous one committed. This matches
 * the Python behavior where SQL files are committed per cycle.
 *
 * Ticket: IQS-863
 */
export class FileMetricsDeltaService {
  private readonly logger: LoggerService;
  private readonly commitRepo: CommitRepository;

  constructor(commitRepo: CommitRepository) {
    this.logger = LoggerService.getInstance();
    this.commitRepo = commitRepo;

    this.logger.debug(CLASS_NAME, 'constructor', 'FileMetricsDeltaService created');
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Calculate and persist file metrics deltas for all modified files.
   *
   * Maps from Python calculate_complexity_comments_code_change().
   *
   * @param options - Configuration for since date and batch size
   * @returns Summary of the calculation run
   */
  async calculateFileMetricsDeltas(
    options: FileMetricsDeltaOptions = {},
  ): Promise<FileMetricsDeltaResult> {
    const startTime = Date.now();
    const sinceDate = options.sinceDate ?? this.getDefaultSinceDate();
    const commitCycle = options.commitCycle ?? DEFAULT_COMMIT_CYCLE;

    this.logger.critical(CLASS_NAME, 'calculateFileMetricsDeltas', `Starting file metrics delta calculation (sinceDate=${sinceDate}, commitCycle=${commitCycle})`);

    // Step 1: Get unique files modified since the cutoff date
    const files = await this.commitRepo.getUniqueFilesModifiedSince(sinceDate);
    this.logger.critical(CLASS_NAME, 'calculateFileMetricsDeltas', `Repo files to process: ${files.length}`);

    if (files.length === 0) {
      this.logger.info(CLASS_NAME, 'calculateFileMetricsDeltas', 'No files to process');
      return { filesProcessed: 0, deltasCalculated: 0, durationMs: Date.now() - startTime };
    }

    let totalDeltasCalculated = 0;
    let filesProcessed = 0;
    let batchDeltas: FileMetricsDelta[] = [];

    // Step 2: Process each file, batching updates per commit cycle
    for (const filename of files) {
      this.logger.debug(CLASS_NAME, 'calculateFileMetricsDeltas', `Processing file: ${filename}`);

      // Step 2a: Get base metrics for this file across all commits
      const fileMetrics = await this.commitRepo.getCommitFileBaseMetrics(filename);
      this.logger.debug(CLASS_NAME, 'calculateFileMetricsDeltas', `File ${filename}: ${fileMetrics.length} commit entries`);

      // Step 2b: Calculate deltas for this file
      const deltas = this.calculateDeltasForFile(fileMetrics);
      batchDeltas.push(...deltas);
      totalDeltasCalculated += deltas.length;
      filesProcessed++;

      // Step 2c: Flush batch when reaching commit cycle
      if (filesProcessed % commitCycle === 0) {
        this.logger.debug(CLASS_NAME, 'calculateFileMetricsDeltas', `Flushing batch of ${batchDeltas.length} deltas (files processed: ${filesProcessed})`);
        await this.commitRepo.batchUpdateFileMetricsDeltas(batchDeltas);
        batchDeltas = [];
      }
    }

    // Step 3: Flush remaining batch
    if (batchDeltas.length > 0) {
      this.logger.debug(CLASS_NAME, 'calculateFileMetricsDeltas', `Flushing final batch of ${batchDeltas.length} deltas`);
      await this.commitRepo.batchUpdateFileMetricsDeltas(batchDeltas);
    }

    const durationMs = Date.now() - startTime;

    this.logger.critical(CLASS_NAME, 'calculateFileMetricsDeltas', `File metrics delta calculation complete: ${filesProcessed} files, ${totalDeltasCalculated} deltas in ${durationMs}ms`);

    return {
      filesProcessed,
      deltasCalculated: totalDeltasCalculated,
      durationMs,
    };
  }

  // --------------------------------------------------------------------------
  // Delta calculation (public for testing)
  // --------------------------------------------------------------------------

  /**
   * Calculate complexity, comments, and code deltas for a single file's metrics.
   *
   * Maps from Python _calculate_complexity_comments_code_change().
   *
   * Python implementation:
   *   1. Group by filename (already done - we receive metrics for one file)
   *   2. Sort by commit_date within the group
   *   3. Use pandas diff() for each metric column
   *   4. Use fillna() to replace NaN (first row) with the value itself
   *
   * TypeScript equivalent:
   *   1. Sort by commitDate
   *   2. Iterate tracking previous values
   *   3. First row: delta = value itself
   *   4. Subsequent rows: delta = current - previous
   *
   * @param metrics - File metrics entries for a single file, may be unsorted
   * @returns Array of delta objects ready for database update
   */
  calculateDeltasForFile(metrics: readonly CommitFileMetrics[]): FileMetricsDelta[] {
    if (metrics.length === 0) {
      this.logger.trace(CLASS_NAME, 'calculateDeltasForFile', 'Empty metrics, returning no deltas');
      return [];
    }

    // Sort by commit_date ascending (matches Python sort_values(by=['commit_date']))
    const sorted = [...metrics].sort((a, b) => {
      const dateA = a.commitDate instanceof Date ? a.commitDate.getTime() : new Date(a.commitDate).getTime();
      const dateB = b.commitDate instanceof Date ? b.commitDate.getTime() : new Date(b.commitDate).getTime();
      return dateA - dateB;
    });

    this.logger.trace(CLASS_NAME, 'calculateDeltasForFile', `Calculating deltas for ${sorted.length} entries of file: ${sorted[0]?.filename}`);

    const deltas: FileMetricsDelta[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!;

      if (i === 0) {
        // First occurrence: delta = value itself
        // Matches Python: diff().fillna(fn_group['complexity'])
        deltas.push({
          sha: current.sha,
          filename: current.filename,
          complexityChange: current.complexity,
          commentsChange: current.totalCommentLines,
          codeChange: current.totalCodeLines,
        });
        this.logger.trace(CLASS_NAME, 'calculateDeltasForFile', `First entry: sha=${current.sha.substring(0, 8)} complexity=${current.complexity} comments=${current.totalCommentLines} code=${current.totalCodeLines}`);
      } else {
        // Subsequent: delta = current - previous
        // Matches Python: diff() returns current - previous
        const previous = sorted[i - 1]!;
        const complexityChange = current.complexity - previous.complexity;
        const commentsChange = current.totalCommentLines - previous.totalCommentLines;
        const codeChange = current.totalCodeLines - previous.totalCodeLines;

        deltas.push({
          sha: current.sha,
          filename: current.filename,
          complexityChange,
          commentsChange,
          codeChange,
        });
        this.logger.trace(CLASS_NAME, 'calculateDeltasForFile', `Delta: sha=${current.sha.substring(0, 8)} complexity=${complexityChange} comments=${commentsChange} code=${codeChange}`);
      }
    }

    this.logger.debug(CLASS_NAME, 'calculateDeltasForFile', `Calculated ${deltas.length} deltas for file: ${sorted[0]?.filename}`);
    return deltas;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Calculate the default since date (2 weeks ago).
   * Matches the Python default: datetime.now() - timedelta(weeks=2).
   *
   * @returns ISO date string in YYYY-MM-DD format
   */
  private getDefaultSinceDate(): string {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - DEFAULT_SINCE_WEEKS * 7 * 24 * 60 * 60 * 1000);
    const dateStr = twoWeeksAgo.toISOString().split('T')[0]!;
    this.logger.debug(CLASS_NAME, 'getDefaultSinceDate', `Default since date: ${dateStr}`);
    return dateStr;
  }
}
