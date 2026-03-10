/**
 * Service for retroactively running scc on existing commits that were
 * extracted before scc integration was added (IQS-855).
 *
 * Queries for commit_files rows where all 5 scc columns are zero,
 * groups them by repository, checks out each commit's file tree to a
 * temp directory, runs scc, and UPDATEs the rows with real metrics.
 *
 * Ticket: IQS-882
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { CancellationToken, Progress } from 'vscode';
import { LoggerService } from '../logging/logger.js';
import type { CommitRepository } from '../database/commit-repository.js';
import { SccMetricsService } from './scc-metrics-service.js';
import type { RepositoryEntry } from '../config/settings.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'SccBackfillService';

/**
 * Result summary from a backfill run.
 */
export interface BackfillResult {
  /** Total number of distinct commits found needing backfill. */
  readonly totalCommits: number;
  /** Number of commits successfully processed (scc ran + DB updated). */
  readonly processedCommits: number;
  /** Number of commits skipped due to errors or missing repos. */
  readonly skippedCommits: number;
  /** Total number of commit_files rows updated with scc metrics. */
  readonly totalFilesUpdated: number;
  /** Repository names that were skipped (not found in configured repos). */
  readonly skippedRepos: readonly string[];
  /** Elapsed wall-clock time in milliseconds. */
  readonly durationMs: number;
}

/**
 * Service that retroactively runs scc on commits with zero metrics.
 */
export class SccBackfillService {
  private readonly logger: LoggerService;
  private readonly commitRepo: CommitRepository;
  private readonly sccService: SccMetricsService;

  /**
   * Cache for validated repository paths to avoid redundant stat calls
   * within a single backfill run (IQS-883).
   */
  private readonly validatedPaths = new Map<string, boolean>();

  constructor(commitRepo: CommitRepository, sccService: SccMetricsService) {
    this.logger = LoggerService.getInstance();
    this.commitRepo = commitRepo;
    this.sccService = sccService;
    this.logger.debug(CLASS_NAME, 'constructor', 'SccBackfillService created');
  }

  /**
   * Run the scc backfill across all repositories.
   *
   * 1. Check scc availability
   * 2. Query commits needing backfill
   * 3. Group by repository, resolve repo name -> local path
   * 4. For each commit: extract files, run scc, update DB
   * 5. Report progress and return summary
   *
   * @param repositories - Configured repository entries (name -> path mapping)
   * @param progress - Optional VS Code progress reporter
   * @param token - Optional cancellation token
   * @returns BackfillResult summary
   */
  async runBackfill(
    repositories: readonly RepositoryEntry[],
    progress?: Progress<{ message?: string; increment?: number }>,
    token?: CancellationToken,
  ): Promise<BackfillResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'runBackfill', 'Starting scc backfill');

    // Step 1: Check scc availability
    const sccAvailable = await this.sccService.isSccAvailable();
    if (!sccAvailable) {
      this.logger.error(CLASS_NAME, 'runBackfill', 'scc CLI is not available on the system PATH');
      return {
        totalCommits: 0,
        processedCommits: 0,
        skippedCommits: 0,
        totalFilesUpdated: 0,
        skippedRepos: [],
        durationMs: Date.now() - startTime,
      };
    }
    this.logger.debug(CLASS_NAME, 'runBackfill', 'scc CLI is available');

    // Step 2: Query commits needing backfill
    const shaRows = await this.commitRepo.getShasNeedingSccBackfill();
    if (shaRows.length === 0) {
      this.logger.info(CLASS_NAME, 'runBackfill', 'No commits require scc backfill');
      progress?.report({ message: 'No commits require backfill' });
      return {
        totalCommits: 0,
        processedCommits: 0,
        skippedCommits: 0,
        totalFilesUpdated: 0,
        skippedRepos: [],
        durationMs: Date.now() - startTime,
      };
    }
    this.logger.info(CLASS_NAME, 'runBackfill', `Found ${shaRows.length} commits needing scc backfill`);

    // Step 3: Build repo name -> path lookup
    const repoPathMap = new Map<string, string>();
    for (const repo of repositories) {
      repoPathMap.set(repo.name, repo.path);
    }
    this.logger.debug(CLASS_NAME, 'runBackfill', `Configured repositories: ${[...repoPathMap.keys()].join(', ')}`);

    // Step 4: Process each commit
    let processedCommits = 0;
    let skippedCommits = 0;
    let totalFilesUpdated = 0;
    const skippedRepoSet = new Set<string>();
    const incrementPerCommit = shaRows.length > 0 ? 100 / shaRows.length : 0;

    for (let i = 0; i < shaRows.length; i++) {
      // Check cancellation
      if (token?.isCancellationRequested) {
        this.logger.info(CLASS_NAME, 'runBackfill', `Backfill cancelled by user at commit ${i + 1}/${shaRows.length}`);
        break;
      }

      const { sha, repository } = shaRows[i]!;
      this.logger.debug(CLASS_NAME, 'runBackfill', `Processing commit ${i + 1}/${shaRows.length}: ${sha.substring(0, 8)} (${repository})`);
      progress?.report({
        message: `Processing ${i + 1}/${shaRows.length}: ${sha.substring(0, 8)} (${repository})`,
        increment: incrementPerCommit,
      });

      // Resolve repository path
      const repoPath = repoPathMap.get(repository);
      if (!repoPath) {
        this.logger.warn(CLASS_NAME, 'runBackfill', `Repository "${repository}" not found in configured repositories, skipping`);
        skippedRepoSet.add(repository);
        skippedCommits++;
        continue;
      }

      try {
        // SECURITY (IQS-883, CWE-459): Check if cleanup failure threshold exceeded
        if (this.sccService.cleanupFailureThresholdExceeded) {
          this.logger.error(
            CLASS_NAME,
            'runBackfill',
            `Aborting backfill: consecutive temp cleanup failures exceeded threshold. ` +
            `Processed ${processedCommits} commits before abort.`,
          );
          break;
        }

        // Get file paths for this commit
        const filePaths = await this.commitRepo.getCommitFilePathsForSha(sha);
        if (filePaths.length === 0) {
          this.logger.debug(CLASS_NAME, 'runBackfill', `No files for commit ${sha.substring(0, 8)}, skipping`);
          skippedCommits++;
          continue;
        }
        this.logger.debug(CLASS_NAME, 'runBackfill', `Found ${filePaths.length} files for commit ${sha.substring(0, 8)}`);

        // SECURITY (IQS-883, CWE-20): Validate repository path exists and is a git directory
        const pathValid = await this.validateRepoPath(repoPath);
        if (!pathValid) {
          this.logger.warn(
            CLASS_NAME,
            'runBackfill',
            `Repository path "${repoPath}" failed validation (not a directory or not a git repo), skipping commit ${sha.substring(0, 8)}`,
          );
          skippedRepoSet.add(repository);
          skippedCommits++;
          continue;
        }

        // Run scc via the existing SccMetricsService
        const git = simpleGit(repoPath);
        const metrics = await this.sccService.getFileMetricsViaScc(git, sha, filePaths);

        if (metrics.size === 0) {
          this.logger.debug(CLASS_NAME, 'runBackfill', `scc returned no metrics for ${sha.substring(0, 8)}, skipping`);
          skippedCommits++;
          continue;
        }

        // Update database
        const rowsUpdated = await this.commitRepo.updateCommitFileSccMetrics(sha, metrics);
        totalFilesUpdated += rowsUpdated;
        processedCommits++;

        this.logger.debug(CLASS_NAME, 'runBackfill', `Updated ${rowsUpdated} rows for ${sha.substring(0, 8)}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(CLASS_NAME, 'runBackfill', `Error processing commit ${sha.substring(0, 8)}: ${message}`);
        skippedCommits++;
      }
    }

    // If we exited due to cleanup failure threshold, count remaining as skipped
    const durationMs = Date.now() - startTime;
    const result: BackfillResult = {
      totalCommits: shaRows.length,
      processedCommits,
      skippedCommits,
      totalFilesUpdated,
      skippedRepos: [...skippedRepoSet],
      durationMs,
    };

    this.logger.info(CLASS_NAME, 'runBackfill', `Backfill complete: ${processedCommits} processed, ${skippedCommits} skipped, ${totalFilesUpdated} files updated in ${Math.round(durationMs / 1000)}s`);
    return result;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Validate that a repository path exists, is a directory, and contains
   * a .git directory (indicating it is a git repository).
   *
   * SECURITY (IQS-883, CWE-20): Prevents passing invalid paths to simpleGit(),
   * which could cause confusing errors or operate on unintended directories.
   *
   * Results are cached for the lifetime of a backfill run to avoid
   * redundant filesystem checks for multiple commits in the same repo.
   *
   * @param repoPath - Absolute path to the repository
   * @returns true if the path is a valid git repository directory
   */
  private async validateRepoPath(repoPath: string): Promise<boolean> {
    // Check cache to avoid redundant stat calls for the same repo
    if (this.validatedPaths.has(repoPath)) {
      const cached = this.validatedPaths.get(repoPath)!;
      this.logger.trace(CLASS_NAME, 'validateRepoPath', `Cached validation for "${repoPath}": ${cached}`);
      return cached;
    }

    this.logger.debug(CLASS_NAME, 'validateRepoPath', `Validating repository path: "${repoPath}"`);
    try {
      // Check the path exists and is a directory
      const pathStat = await stat(repoPath);
      if (!pathStat.isDirectory()) {
        this.logger.warn(CLASS_NAME, 'validateRepoPath', `Path "${repoPath}" exists but is not a directory`);
        this.validatedPaths.set(repoPath, false);
        return false;
      }

      // Check that .git directory exists (indicates a git repository)
      const gitDirStat = await stat(join(repoPath, '.git'));
      if (!gitDirStat.isDirectory()) {
        this.logger.warn(CLASS_NAME, 'validateRepoPath', `Path "${repoPath}" is a directory but .git is not a directory`);
        this.validatedPaths.set(repoPath, false);
        return false;
      }

      this.logger.debug(CLASS_NAME, 'validateRepoPath', `Path "${repoPath}" is a valid git repository`);
      this.validatedPaths.set(repoPath, true);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'validateRepoPath', `Path validation failed for "${repoPath}": ${message}`);
      this.validatedPaths.set(repoPath, false);
      return false;
    }
  }
}
