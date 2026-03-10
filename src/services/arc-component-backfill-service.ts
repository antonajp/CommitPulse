/**
 * Service for retroactively classifying commit_files rows into architecture
 * component categories using the ArcComponentClassifier.
 *
 * Follows the SccBackfillService pattern (IQS-882):
 * - Constructor with repository + classifier dependencies
 * - runBackfill() method with progress + cancellation support
 * - Batch processing with transaction-wrapped updates
 * - Typed result summary
 *
 * Smart refresh: Only processes NULL rows + rows where mapping changed
 * since the last run (detected via checksum comparison).
 *
 * Ticket: IQS-885
 */

import type { CancellationToken, Progress } from 'vscode';
import { LoggerService } from '../logging/logger.js';
import type { CommitRepository } from '../database/commit-repository.js';
import { ArcComponentClassifier } from './arc-component-classifier.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ArcComponentBackfillService';

/**
 * Batch size for UPDATE operations per transaction.
 */
const BATCH_SIZE = 1000;

/**
 * Result summary from an arc component backfill run.
 */
export interface ArcComponentBackfillResult {
  /** Total number of files found needing classification. */
  readonly totalFiles: number;
  /** Number of files successfully classified and updated. */
  readonly classifiedFiles: number;
  /** Number of files skipped due to errors. */
  readonly skippedFiles: number;
  /** Per-category file count breakdown. */
  readonly categoryCounts: Readonly<Record<string, number>>;
  /** Number of files classified as "Other". */
  readonly otherCount: number;
  /** Elapsed wall-clock time in milliseconds. */
  readonly durationMs: number;
}

/**
 * Row shape for files needing arc_component classification.
 */
export interface ArcComponentFileRow {
  readonly sha: string;
  readonly filename: string;
  readonly file_extension: string | null;
  readonly arc_component: string | null;
}

/**
 * Service that classifies commit_files into architecture component categories.
 */
export class ArcComponentBackfillService {
  private readonly logger: LoggerService;
  private readonly commitRepo: CommitRepository;
  private readonly classifier: ArcComponentClassifier;

  constructor(commitRepo: CommitRepository, classifier: ArcComponentClassifier) {
    this.logger = LoggerService.getInstance();
    this.commitRepo = commitRepo;
    this.classifier = classifier;
    this.logger.debug(CLASS_NAME, 'constructor', 'ArcComponentBackfillService created');
  }

  /**
   * Run the architecture component backfill.
   *
   * Smart refresh logic:
   * 1. First run: classifies all NULL arc_component rows
   * 2. Subsequent runs: only NULL rows + rows where mapping changed
   *
   * @param lastChecksum - Previous mapping checksum (empty string for first run)
   * @param progress - Optional VS Code progress reporter
   * @param token - Optional cancellation token
   * @returns ArcComponentBackfillResult summary
   */
  async runBackfill(
    lastChecksum: string,
    progress?: Progress<{ message?: string; increment?: number }>,
    token?: CancellationToken,
  ): Promise<ArcComponentBackfillResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'runBackfill', 'Starting architecture component backfill');

    // Determine if this is a smart refresh (checksum changed) or first run
    const currentChecksum = this.classifier.getMappingChecksum();
    const mappingChanged = lastChecksum !== '' && lastChecksum !== currentChecksum;
    this.logger.debug(
      CLASS_NAME,
      'runBackfill',
      `Checksum: last="${lastChecksum}", current="${currentChecksum}", mappingChanged=${mappingChanged}`,
    );

    // Step 1: Query files needing classification
    let rows: ArcComponentFileRow[];
    if (mappingChanged) {
      // Smart refresh: get NULL rows + ALL rows for re-classification
      this.logger.info(CLASS_NAME, 'runBackfill', 'Mapping changed — re-classifying all rows');
      rows = await this.commitRepo.getFilesForArcComponentBackfill(true);
    } else {
      // First run or unchanged: only NULL rows
      this.logger.info(CLASS_NAME, 'runBackfill', 'Classifying NULL arc_component rows only');
      rows = await this.commitRepo.getFilesForArcComponentBackfill(false);
    }

    if (rows.length === 0) {
      this.logger.info(CLASS_NAME, 'runBackfill', 'No files require arc component classification');
      progress?.report({ message: 'No files require classification' });
      return {
        totalFiles: 0,
        classifiedFiles: 0,
        skippedFiles: 0,
        categoryCounts: {},
        otherCount: 0,
        durationMs: Date.now() - startTime,
      };
    }

    this.logger.info(CLASS_NAME, 'runBackfill', `Found ${rows.length} files needing classification`);

    // Step 2: Classify each file
    const updates: Array<{ sha: string; filename: string; arcComponent: string }> = [];
    const categoryCounts: Record<string, number> = {};
    let skippedFiles = 0;
    const incrementPerFile = rows.length > 0 ? 100 / rows.length : 0;

    for (let i = 0; i < rows.length; i++) {
      if (token?.isCancellationRequested) {
        this.logger.info(CLASS_NAME, 'runBackfill', `Backfill cancelled by user at file ${i + 1}/${rows.length}`);
        break;
      }

      const row = rows[i]!;
      try {
        const category = this.classifier.classify(row.filename, row.file_extension);

        // Smart refresh optimization: skip if the category hasn't changed
        if (row.arc_component === category) {
          this.logger.trace(CLASS_NAME, 'runBackfill', `Unchanged: "${row.filename}" -> "${category}"`);
          continue;
        }

        updates.push({
          sha: row.sha,
          filename: row.filename,
          arcComponent: category,
        });

        categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(CLASS_NAME, 'runBackfill', `Error classifying "${row.filename}": ${message}`);
        skippedFiles++;
      }

      // Report progress periodically (every 100 files)
      if (i % 100 === 0) {
        progress?.report({
          message: `Classifying ${i + 1}/${rows.length} files...`,
          increment: incrementPerFile * Math.min(100, rows.length - i),
        });
      }
    }

    if (updates.length === 0) {
      this.logger.info(CLASS_NAME, 'runBackfill', 'No files require updating (all unchanged)');
      progress?.report({ message: 'All files up to date' });
      return {
        totalFiles: rows.length,
        classifiedFiles: 0,
        skippedFiles,
        categoryCounts: {},
        otherCount: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // Step 3: Batch update the database
    this.logger.info(CLASS_NAME, 'runBackfill', `Updating ${updates.length} files in batches of ${BATCH_SIZE}`);
    progress?.report({ message: `Updating ${updates.length} files...` });

    let classifiedFiles = 0;
    for (let batchStart = 0; batchStart < updates.length; batchStart += BATCH_SIZE) {
      if (token?.isCancellationRequested) {
        this.logger.info(CLASS_NAME, 'runBackfill', `Backfill cancelled during DB update at batch starting ${batchStart}`);
        break;
      }

      const batch = updates.slice(batchStart, batchStart + BATCH_SIZE);
      this.logger.debug(
        CLASS_NAME,
        'runBackfill',
        `Writing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: ${batch.length} updates`,
      );

      try {
        const batchUpdated = await this.commitRepo.batchUpdateArcComponent(batch);
        classifiedFiles += batchUpdated;
        this.logger.debug(CLASS_NAME, 'runBackfill', `Batch updated ${batchUpdated} rows`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(CLASS_NAME, 'runBackfill', `Batch update failed: ${message}`);
        skippedFiles += batch.length;
      }
    }

    const otherCount = categoryCounts['Other'] ?? 0;
    const durationMs = Date.now() - startTime;

    const result: ArcComponentBackfillResult = {
      totalFiles: rows.length,
      classifiedFiles,
      skippedFiles,
      categoryCounts,
      otherCount,
      durationMs,
    };

    this.logger.info(
      CLASS_NAME,
      'runBackfill',
      `Backfill complete: ${classifiedFiles} classified, ${skippedFiles} skipped, ${otherCount} "Other" in ${Math.round(durationMs / 1000)}s`,
    );

    // Log per-category breakdown
    for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
      this.logger.info(CLASS_NAME, 'runBackfill', `  ${cat}: ${count} files`);
    }

    return result;
  }
}
