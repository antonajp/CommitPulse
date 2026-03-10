/**
 * Service for retroactively calculating story points from issue duration
 * for Jira and Linear issues that lack manual estimates.
 *
 * Maps calendar-day duration (creation -> completion) to Fibonacci-scale
 * story points using the pure function in fibonacci-mapper.ts.
 *
 * Follows the SccBackfillService pattern (IQS-882):
 * - Constructor with repository dependencies
 * - runBackfill() method with progress + cancellation support
 * - Per-record processing (no long-running bulk updates)
 * - Typed result summary
 *
 * Ticket: IQS-884
 */

import type { CancellationToken, Progress } from 'vscode';
import { LoggerService } from '../logging/logger.js';
import type { JiraRepository } from '../database/jira-repository.js';
import type { LinearRepository } from '../database/linear-repository.js';
import { mapDurationToStoryPoints } from '../utils/fibonacci-mapper.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'StoryPointsBackfillService';

/**
 * Maximum duration in days before logging a warning about very long issues.
 */
const LONG_DURATION_THRESHOLD = 365;

/**
 * Result summary from a story points backfill run.
 */
export interface StoryPointsBackfillResult {
  /** Total number of issues found needing backfill (Jira + Linear). */
  readonly totalIssues: number;
  /** Number of Jira issues updated with calculated story points. */
  readonly jiraUpdated: number;
  /** Number of Linear issues updated with calculated story points. */
  readonly linearUpdated: number;
  /** Number of issues skipped (null dates, negative durations, etc.). */
  readonly skipped: number;
  /** Elapsed wall-clock time in milliseconds. */
  readonly durationMs: number;
}

/**
 * Row shape returned by Jira backfill query.
 */
export interface JiraBackfillRow {
  readonly jira_key: string;
  readonly created_date: Date | null;
  readonly status_change_date: Date | null;
}

/**
 * Row shape returned by Linear backfill query.
 */
export interface LinearBackfillRow {
  readonly linear_key: string;
  readonly created_date: Date | null;
  readonly end_date: Date | null;
}

/**
 * Service that calculates and backfills story points from issue duration.
 */
export class StoryPointsBackfillService {
  private readonly logger: LoggerService;
  private readonly jiraRepo: JiraRepository;
  private readonly linearRepo: LinearRepository;

  constructor(jiraRepo: JiraRepository, linearRepo: LinearRepository) {
    this.logger = LoggerService.getInstance();
    this.jiraRepo = jiraRepo;
    this.linearRepo = linearRepo;
    this.logger.debug(CLASS_NAME, 'constructor', 'StoryPointsBackfillService created');
  }

  /**
   * Run the story points backfill across Jira and Linear issues.
   *
   * 1. Query Jira issues needing backfill
   * 2. Query Linear issues needing backfill
   * 3. Calculate duration and map to Fibonacci points
   * 4. Update each record individually
   * 5. Report progress and return summary
   *
   * @param progress - Optional VS Code progress reporter
   * @param token - Optional cancellation token
   * @returns StoryPointsBackfillResult summary
   */
  async runBackfill(
    progress?: Progress<{ message?: string; increment?: number }>,
    token?: CancellationToken,
  ): Promise<StoryPointsBackfillResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'runBackfill', 'Starting story points backfill');

    // Step 1: Query Jira issues needing backfill
    this.logger.debug(CLASS_NAME, 'runBackfill', 'Querying Jira issues needing story points backfill');
    const jiraRows = await this.jiraRepo.getIssuesNeedingStoryPointsBackfill();
    this.logger.info(CLASS_NAME, 'runBackfill', `Found ${jiraRows.length} Jira issues needing backfill`);

    // Step 2: Query Linear issues needing backfill
    this.logger.debug(CLASS_NAME, 'runBackfill', 'Querying Linear issues needing story points backfill');
    const linearRows = await this.linearRepo.getIssuesNeedingStoryPointsBackfill();
    this.logger.info(CLASS_NAME, 'runBackfill', `Found ${linearRows.length} Linear issues needing backfill`);

    const totalIssues = jiraRows.length + linearRows.length;

    if (totalIssues === 0) {
      this.logger.info(CLASS_NAME, 'runBackfill', 'No issues require story points backfill');
      progress?.report({ message: 'No issues require backfill' });
      return {
        totalIssues: 0,
        jiraUpdated: 0,
        linearUpdated: 0,
        skipped: 0,
        durationMs: Date.now() - startTime,
      };
    }

    const incrementPerIssue = totalIssues > 0 ? 100 / totalIssues : 0;
    let jiraUpdated = 0;
    let linearUpdated = 0;
    let skipped = 0;

    // Step 3: Process Jira issues
    this.logger.debug(CLASS_NAME, 'runBackfill', 'Processing Jira issues');
    for (let i = 0; i < jiraRows.length; i++) {
      if (token?.isCancellationRequested) {
        this.logger.info(CLASS_NAME, 'runBackfill', `Backfill cancelled by user at Jira issue ${i + 1}/${jiraRows.length}`);
        break;
      }

      const row = jiraRows[i]!;
      progress?.report({
        message: `Jira ${i + 1}/${jiraRows.length}: ${row.jira_key}`,
        increment: incrementPerIssue,
      });

      const result = this.processJiraRow(row);
      if (result === null) {
        skipped++;
        continue;
      }

      try {
        await this.jiraRepo.updateCalculatedStoryPoints(row.jira_key, result);
        jiraUpdated++;
        this.logger.debug(CLASS_NAME, 'runBackfill', `Updated Jira ${row.jira_key}: ${result} points`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(CLASS_NAME, 'runBackfill', `Failed to update Jira ${row.jira_key}: ${message}`);
        skipped++;
      }
    }

    // Step 4: Process Linear issues (if not cancelled)
    if (!token?.isCancellationRequested) {
      this.logger.debug(CLASS_NAME, 'runBackfill', 'Processing Linear issues');
      for (let i = 0; i < linearRows.length; i++) {
        if (token?.isCancellationRequested) {
          this.logger.info(CLASS_NAME, 'runBackfill', `Backfill cancelled by user at Linear issue ${i + 1}/${linearRows.length}`);
          break;
        }

        const row = linearRows[i]!;
        progress?.report({
          message: `Linear ${i + 1}/${linearRows.length}: ${row.linear_key}`,
          increment: incrementPerIssue,
        });

        const result = this.processLinearRow(row);
        if (result === null) {
          skipped++;
          continue;
        }

        try {
          await this.linearRepo.updateCalculatedStoryPoints(row.linear_key, result);
          linearUpdated++;
          this.logger.debug(CLASS_NAME, 'runBackfill', `Updated Linear ${row.linear_key}: ${result} points`);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'runBackfill', `Failed to update Linear ${row.linear_key}: ${message}`);
          skipped++;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const result: StoryPointsBackfillResult = {
      totalIssues,
      jiraUpdated,
      linearUpdated,
      skipped,
      durationMs,
    };

    this.logger.info(
      CLASS_NAME,
      'runBackfill',
      `Backfill complete: ${jiraUpdated} Jira + ${linearUpdated} Linear updated, ${skipped} skipped in ${Math.round(durationMs / 1000)}s`,
    );
    return result;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Process a single Jira row: calculate duration, map to story points.
   * Uses created_date -> status_change_date for duration.
   *
   * @param row - Jira backfill row
   * @returns Story points value, or null if the row should be skipped
   */
  private processJiraRow(row: JiraBackfillRow): number | null {
    if (!row.created_date) {
      this.logger.warn(CLASS_NAME, 'processJiraRow', `Skipping ${row.jira_key}: null created_date`);
      return null;
    }
    if (!row.status_change_date) {
      this.logger.warn(CLASS_NAME, 'processJiraRow', `Skipping ${row.jira_key}: null status_change_date`);
      return null;
    }

    const durationDays = this.calculateDurationDays(row.created_date, row.status_change_date);

    if (durationDays < 0) {
      this.logger.warn(
        CLASS_NAME,
        'processJiraRow',
        `Skipping ${row.jira_key}: negative duration (${durationDays} days) — start > end`,
      );
      return null;
    }

    if (durationDays > LONG_DURATION_THRESHOLD) {
      this.logger.warn(
        CLASS_NAME,
        'processJiraRow',
        `${row.jira_key}: very long duration (${durationDays} days), capping at 21 points`,
      );
    }

    const points = mapDurationToStoryPoints(durationDays);
    this.logger.debug(CLASS_NAME, 'processJiraRow', `${row.jira_key}: ${durationDays} days -> ${points} points`);
    return points;
  }

  /**
   * Process a single Linear row: calculate duration, map to story points.
   * Uses created_date -> COALESCE(completed_date, status_change_date) for duration.
   *
   * @param row - Linear backfill row (end_date is already COALESCE'd by the query)
   * @returns Story points value, or null if the row should be skipped
   */
  private processLinearRow(row: LinearBackfillRow): number | null {
    if (!row.created_date) {
      this.logger.warn(CLASS_NAME, 'processLinearRow', `Skipping ${row.linear_key}: null created_date`);
      return null;
    }
    if (!row.end_date) {
      this.logger.warn(CLASS_NAME, 'processLinearRow', `Skipping ${row.linear_key}: null end_date`);
      return null;
    }

    const durationDays = this.calculateDurationDays(row.created_date, row.end_date);

    if (durationDays < 0) {
      this.logger.warn(
        CLASS_NAME,
        'processLinearRow',
        `Skipping ${row.linear_key}: negative duration (${durationDays} days) — start > end`,
      );
      return null;
    }

    if (durationDays > LONG_DURATION_THRESHOLD) {
      this.logger.warn(
        CLASS_NAME,
        'processLinearRow',
        `${row.linear_key}: very long duration (${durationDays} days), capping at 21 points`,
      );
    }

    const points = mapDurationToStoryPoints(durationDays);
    this.logger.debug(CLASS_NAME, 'processLinearRow', `${row.linear_key}: ${durationDays} days -> ${points} points`);
    return points;
  }

  /**
   * Calculate the duration in calendar days between two dates.
   * Uses floor division to get whole calendar days.
   *
   * @param startDate - Issue creation date
   * @param endDate - Issue completion/status change date
   * @returns Duration in calendar days (may be negative if start > end)
   */
  private calculateDurationDays(startDate: Date, endDate: Date): number {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
  }
}
