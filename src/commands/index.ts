import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import { SecretStorageService, SecretKeys } from '../config/secret-storage.js';
import { getSettings } from '../config/settings.js';
import { DatabaseService, buildConfigFromSettings } from '../database/database-service.js';
import { setExtensionUri, runAutoMigrations } from '../database/auto-migration.js';
import { CommitRepository } from '../database/commit-repository.js';
import { ContributorRepository } from '../database/contributor-repository.js';
import { CommitJiraRepository } from '../database/commit-jira-repository.js';
import { CommitLinearRepository } from '../database/commit-linear-repository.js';
import { JiraRepository } from '../database/jira-repository.js';
import { LinearRepository } from '../database/linear-repository.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import { GitAnalysisService } from '../services/git-analysis-service.js';
import { GitHubService } from '../services/github-service.js';
import { LinearClient } from '@linear/sdk';
import { JiraService } from '../services/jira-service.js';
import { createJiraClient } from '../services/jira-client-factory.js';
import { JiraChangelogService } from '../services/jira-changelog-service.js';
import { JiraIncrementalLoader } from '../services/jira-incremental-loader.js';
import { LinearService } from '../services/linear-service.js';
import { LinearIncrementalLoader } from '../services/linear-incremental-loader.js';
import { DataEnhancerService } from '../services/data-enhancer-service.js';
import { TeamAssignmentService } from '../services/team-assignment-service.js';
import { PipelineService } from '../services/pipeline-service.js';
import type { FastExtractionMode, ExtractionModeQuickPickItem } from '../services/git-analysis-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'Commands';

/**
 * Build Quick Pick items for extraction mode selection.
 * Uses static descriptions to avoid database queries for faster display.
 *
 * @returns Array of Quick Pick items for extraction mode selection
 *
 * Ticket: GITX-123, GITX-124 (optimized to avoid database query), GITX-125 (exported for testing), GITX-131 (added fast mode)
 */
export function buildExtractionModeQuickPickItems(): ExtractionModeQuickPickItem[] {
  // GITX-124: Use static descriptions to avoid double database initialization.
  // The incremental mode will automatically detect the watermark during execution.
  // GITX-131: Added fast mode as first option for optimized extraction.
  return [
    {
      label: '$(rocket) Fast Incremental',
      description: 'Optimized extraction (Recommended)',
      detail: 'Single git query across all branches. Fastest for regular syncs.',
      mode: 'fast',
    },
    {
      label: '$(sync) Incremental',
      description: 'Standard per-branch extraction',
      detail: 'Iterates each branch separately. Slower but traditional.',
      mode: 'incremental',
    },
    {
      label: '$(database) Full Re-extraction',
      description: 'Extract entire commit history',
      detail: 'Ignores previous data. Use if incremental sync has issues.',
      mode: 'full',
    },
  ];
}

/**
 * Show Quick Pick dialog for extraction mode selection.
 * Returns the selected mode or undefined if cancelled.
 *
 * GITX-124: Removed database query for last commit date to avoid double initialization.
 * The Quick Pick now shows immediately without database latency.
 * GITX-131: Updated return type to FastExtractionMode to support 'fast' mode.
 *
 * @param logger - Logger instance for diagnostic messages
 * @returns The selected extraction mode, or undefined if cancelled
 *
 * Ticket: GITX-123, GITX-124, GITX-125 (exported for testing), GITX-131 (fast mode)
 */
export async function showExtractionModeQuickPick(
  logger: LoggerService,
): Promise<FastExtractionMode | undefined> {
  const items = buildExtractionModeQuickPickItems();

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Git Extraction Mode',
    placeHolder: 'Choose extraction mode',
  });

  if (!selected) {
    logger.info(CLASS_NAME, 'showExtractionModeQuickPick', 'Extraction mode selection cancelled by user');
    return undefined;
  }

  logger.info(CLASS_NAME, 'showExtractionModeQuickPick', `User selected extraction mode: ${selected.mode}`);
  return selected.mode;
}

/**
 * Result from determining extraction mode based on first-run detection.
 *
 * Ticket: GITX-126, GITX-131 (updated mode type to FastExtractionMode)
 */
export interface ExtractionModeResult {
  /** The extraction mode to use */
  mode: FastExtractionMode;
  /** Whether this is a first run (no existing data) */
  isFirstRun: boolean;
}

/**
 * QuickPick item for repository selection.
 *
 * Ticket: GITX-130
 */
export interface RepositoryQuickPickItem extends vscode.QuickPickItem {
  /** Repository name, or undefined for "All Repositories" option */
  repository?: string;
}

/**
 * Determine extraction mode based on first-run detection.
 *
 * On first run (no commits in database): Returns 'full' mode without showing Quick Pick.
 * On subsequent runs: Shows Quick Pick for user to choose mode.
 *
 * @param commitRepo - CommitRepository for checking existing data
 * @param logger - Logger instance for diagnostic messages
 * @returns ExtractionModeResult with mode and first-run flag, or undefined if user cancelled
 *
 * Ticket: GITX-126 - Improve first-run UX for extraction mode selection
 */
export async function determineExtractionMode(
  commitRepo: CommitRepository,
  logger: LoggerService,
): Promise<ExtractionModeResult | undefined> {
  logger.debug(CLASS_NAME, 'determineExtractionMode', 'Checking for existing data to determine extraction mode');

  // GITX-126: Check if any commits exist to determine first-run state
  const hasData = await commitRepo.hasAnyCommits();

  if (!hasData) {
    // First run: Skip Quick Pick, default to full extraction
    logger.info(
      CLASS_NAME,
      'determineExtractionMode',
      'No existing data found - first run detected, defaulting to full extraction',
    );
    return { mode: 'full', isFirstRun: true };
  }

  // Subsequent run: Show Quick Pick for user to choose
  logger.debug(CLASS_NAME, 'determineExtractionMode', 'Existing data found - showing extraction mode Quick Pick');
  const selectedMode = await showExtractionModeQuickPick(logger);

  if (!selectedMode) {
    return undefined; // User cancelled
  }

  return { mode: selectedMode, isFirstRun: false };
}

/**
 * Build Quick Pick items for repository selection.
 * Includes "All Repositories" option plus individual repository choices.
 *
 * @returns Array of Quick Pick items for repository selection
 *
 * Ticket: GITX-130
 */
export function buildRepositoryQuickPickItems(): RepositoryQuickPickItem[] {
  const settings = getSettings();
  const items: RepositoryQuickPickItem[] = [];

  // First option: All Repositories
  items.push({
    label: '$(repo) All Repositories',
    description: `Process all ${settings.repositories.length} configured repositories`,
    detail: 'Runs extraction for every repository in settings',
    repository: undefined,
  });

  // Individual repository options
  for (const repo of settings.repositories) {
    items.push({
      label: `$(repo) ${repo.name}`,
      description: repo.path,
      detail: `Extract commits from ${repo.name} only`,
      repository: repo.name,
    });
  }

  return items;
}

/**
 * Show Quick Pick dialog for repository selection.
 * Returns the selected repository name, or undefined for "All Repositories",
 * or null if user cancelled.
 *
 * @param logger - Logger instance for diagnostic messages
 * @returns The selected repository name (or undefined for all), or null if cancelled
 *
 * Ticket: GITX-130
 */
export async function showRepositoryQuickPick(
  logger: LoggerService,
): Promise<string | undefined | null> {
  const items = buildRepositoryQuickPickItems();

  if (items.length === 1) {
    // Only "All Repositories" option - no repos configured
    logger.warn(CLASS_NAME, 'showRepositoryQuickPick', 'No repositories configured');
    void vscode.window.showWarningMessage('Gitr: No repositories configured. Add repos in Settings.');
    return null;
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Select Repository',
    placeHolder: 'Choose which repository to process',
  });

  if (!selected) {
    logger.info(CLASS_NAME, 'showRepositoryQuickPick', 'Repository selection cancelled by user');
    return null;
  }

  const repoName = selected.repository;
  logger.info(CLASS_NAME, 'showRepositoryQuickPick', `User selected repository: ${repoName ?? 'All Repositories'}`);
  return repoName;
}

/**
 * Tracks whether any pipeline run (manual or scheduled) is in progress.
 * Used for mutual exclusion between concurrent pipeline executions.
 */
let pipelineRunning = false;

/**
 * Check whether a pipeline run is currently in progress.
 * Used by ScheduleRunnerService for mutual exclusion.
 *
 * @returns true if a manual or scheduled pipeline run is executing
 */
export function isPipelineRunning(): boolean {
  return pipelineRunning;
}

/**
 * Execute a full pipeline run programmatically (used by scheduled runs).
 * Builds the PipelineService, runs the pipeline, and cleans up.
 *
 * Sets the pipelineRunning flag for mutual exclusion.
 *
 * @param secretService - SecretStorageService for credential retrieval
 */
export async function executePipelineRun(secretService: SecretStorageService): Promise<void> {
  const logger = LoggerService.getInstance();
  logger.info(CLASS_NAME, 'executePipelineRun', 'Starting pipeline run (programmatic)');

  if (pipelineRunning) {
    logger.warn(CLASS_NAME, 'executePipelineRun', 'Pipeline already running, skipping');
    return;
  }

  pipelineRunning = true;
  logger.debug(CLASS_NAME, 'executePipelineRun', 'Pipeline running flag set to true');

  try {
    const buildResult = await buildPipelineService(secretService, logger);
    if (!buildResult) {
      logger.error(CLASS_NAME, 'executePipelineRun', 'Failed to build pipeline service');
      return;
    }

    const { pipelineService, dbService } = buildResult;

    try {
      const result = await pipelineService.runPipeline();

      const statusMsg = result.status === 'SUCCESS' ? 'completed successfully'
        : result.status === 'PARTIAL' ? 'completed with errors'
        : 'failed';
      const successCount = result.stepResults.filter((r) => r.status === 'SUCCESS').length;
      const errorCount = result.stepResults.filter((r) => r.status === 'ERROR').length;
      const totalSteps = result.stepResults.length;

      const message = `Gitr: Scheduled pipeline ${statusMsg} (${successCount}/${totalSteps} steps OK, ${errorCount} errors, ${Math.round(result.totalDurationMs / 1000)}s)`;
      logger.critical(CLASS_NAME, 'executePipelineRun', message);
    } finally {
      try {
        await dbService.shutdown();
        logger.debug(CLASS_NAME, 'executePipelineRun', 'Database connection pool shut down');
      } catch (shutdownError: unknown) {
        const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
        logger.warn(CLASS_NAME, 'executePipelineRun', `Database shutdown warning: ${msg}`);
      }
    }
  } finally {
    pipelineRunning = false;
    logger.debug(CLASS_NAME, 'executePipelineRun', 'Pipeline running flag set to false');
  }
}

/**
 * Register all Gitr extension commands.
 * Each command is registered with VS Code and returned as a disposable.
 *
 * @param context - The extension context (provides SecretStorage, globalState, etc.)
 * @returns Array of disposables for all registered commands
 */
export function registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  const logger = LoggerService.getInstance();
  const disposables: vscode.Disposable[] = [];

  // Store extension URI for migration path resolution (IQS-879)
  setExtensionUri(context.extensionUri);
  logger.debug(CLASS_NAME, 'registerCommands', `Extension URI stored: ${context.extensionUri.fsPath}`);

  // Initialize SecretStorageService for credential management
  const secretService = new SecretStorageService(context.secrets);
  disposables.push(secretService);
  logger.debug(CLASS_NAME, 'registerCommands', 'SecretStorageService initialized for command registration');

  // gitr.runPipeline - Execute the analytics pipeline
  // GITX-123: Added extraction mode Quick Pick (incremental vs full)
  // GITX-126: First-run detection - skip Quick Pick when no data exists
  const runPipelineDisposable = vscode.commands.registerCommand('gitr.runPipeline', async () => {
    logger.info(CLASS_NAME, 'runPipeline', 'Command executed: gitr.runPipeline');
    logger.debug(CLASS_NAME, 'runPipeline', 'Pipeline execution starting...');

    if (pipelineRunning) {
      logger.warn(CLASS_NAME, 'runPipeline', 'Pipeline already running, cannot start another run');
      void vscode.window.showWarningMessage('Gitr: A pipeline run is already in progress. Please wait for it to complete.');
      return;
    }

    pipelineRunning = true;
    logger.debug(CLASS_NAME, 'runPipeline', 'Pipeline running flag set to true');

    try {
      // GITX-126: Build lightweight database connection first to check for existing data
      const checkResult = await buildDatabaseConnection(secretService, logger);
      if (!checkResult) {
        return; // buildDatabaseConnection already showed error messages
      }

      let extractionMode: FastExtractionMode;
      let isFirstRun = false;

      try {
        // GITX-126: Determine extraction mode based on first-run detection
        const modeResult = await determineExtractionMode(checkResult.commitRepo, logger);
        if (!modeResult) {
          logger.info(CLASS_NAME, 'runPipeline', 'Pipeline cancelled by user (Quick Pick dismissed)');
          return;
        }
        extractionMode = modeResult.mode;
        isFirstRun = modeResult.isFirstRun;

        // GITX-126: Show informational message for first-run
        if (isFirstRun) {
          void vscode.window.showInformationMessage(
            'Gitr: No existing data found. Performing initial full extraction.',
          );
        }
      } finally {
        // Always shut down the check connection - we'll create a fresh one for the pipeline
        await checkResult.dbService.shutdown();
        logger.debug(CLASS_NAME, 'runPipeline', 'First-run check database connection closed');
      }

      const modeLabel = extractionMode === 'full' ? 'Full' : extractionMode === 'fast' ? 'Fast' : 'Incremental';

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Gitr: Running Pipeline (${modeLabel})`,
          cancellable: true,
        },
        async (progress, token) => {
          if (token.isCancellationRequested) {
            logger.info(CLASS_NAME, 'runPipeline', 'Pipeline execution cancelled by user');
            return;
          }

          // Build the pipeline service from current settings and secrets
          // GITX-123: Pass extraction mode to buildPipelineService
          // GITX-131: extractionMode can now be 'fast' for optimized extraction
          const buildResult = await buildPipelineService(secretService, logger, extractionMode);
          if (!buildResult) {
            return; // buildPipelineService already showed error messages
          }

          const { pipelineService, dbService } = buildResult;

          try {
            logger.info(CLASS_NAME, 'runPipeline', `PipelineService built, starting execution (mode: ${modeLabel}, isFirstRun: ${isFirstRun})`);

            const result = await pipelineService.runPipeline(progress, token);

            // Show result notification
            const statusMsg = result.status === 'SUCCESS' ? 'completed successfully'
              : result.status === 'PARTIAL' ? 'completed with errors'
              : 'failed';

            const successCount = result.stepResults.filter((r) => r.status === 'SUCCESS').length;
            const errorCount = result.stepResults.filter((r) => r.status === 'ERROR').length;
            const totalSteps = result.stepResults.length;

            const message = `Gitr: Pipeline ${statusMsg} (${successCount}/${totalSteps} steps OK, ${errorCount} errors, ${Math.round(result.totalDurationMs / 1000)}s)`;

            if (result.status === 'FAILED') {
              void vscode.window.showErrorMessage(message);
            } else if (result.status === 'PARTIAL') {
              void vscode.window.showWarningMessage(message);
            } else {
              void vscode.window.showInformationMessage(message);
            }

            logger.info(CLASS_NAME, 'runPipeline', message);
          } finally {
            // Always shut down the database connection pool after pipeline completes
            try {
              await dbService.shutdown();
              logger.debug(CLASS_NAME, 'runPipeline', 'Database connection pool shut down');
            } catch (shutdownError: unknown) {
              const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
              logger.warn(CLASS_NAME, 'runPipeline', `Database shutdown warning: ${msg}`);
            }
          }
        }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(CLASS_NAME, 'runPipeline', `Pipeline execution failed: ${message}`, error instanceof Error ? error : undefined);
      void vscode.window.showErrorMessage(`Gitr: Pipeline failed - ${message}`);
    } finally {
      pipelineRunning = false;
      logger.debug(CLASS_NAME, 'runPipeline', 'Pipeline running flag set to false');
    }
  });
  disposables.push(runPipelineDisposable);

  // gitr.runGitExtraction - Run Git commit extraction only (IQS-949)
  // GITX-123: Added extraction mode Quick Pick (incremental vs full)
  // GITX-126: First-run detection - skip Quick Pick when no data exists
  const runGitExtractionDisposable = vscode.commands.registerCommand('gitr.runGitExtraction', async () => {
    logger.info(CLASS_NAME, 'runGitExtraction', 'Command executed: gitr.runGitExtraction');
    logger.debug(CLASS_NAME, 'runGitExtraction', 'Git extraction starting...');

    if (pipelineRunning) {
      logger.warn(CLASS_NAME, 'runGitExtraction', 'Pipeline already running, cannot start Git extraction');
      void vscode.window.showWarningMessage('Gitr: A pipeline run is already in progress. Please wait for it to complete.');
      return;
    }

    const settings = getSettings();
    if (settings.repositories.length === 0) {
      logger.warn(CLASS_NAME, 'runGitExtraction', 'No repositories configured');
      void vscode.window.showWarningMessage('Gitr: No repositories configured. Add repos in Settings.');
      return;
    }

    pipelineRunning = true;
    logger.debug(CLASS_NAME, 'runGitExtraction', 'Pipeline running flag set to true');

    const startTime = Date.now();

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Gitr: Running Git Extraction',
          cancellable: true,
        },
        async (progress, token) => {
          if (token.isCancellationRequested) {
            logger.info(CLASS_NAME, 'runGitExtraction', 'Git extraction cancelled by user');
            return;
          }

          // Build lightweight database connection
          progress.report({ message: 'Connecting to database...' });
          const buildResult = await buildDatabaseConnection(secretService, logger);
          if (!buildResult) {
            return; // buildDatabaseConnection already showed error messages
          }

          const { dbService, commitRepo } = buildResult;

          try {
            // GITX-126: Determine extraction mode based on first-run detection
            const modeResult = await determineExtractionMode(commitRepo, logger);
            if (!modeResult) {
              logger.info(CLASS_NAME, 'runGitExtraction', 'Extraction cancelled by user (Quick Pick dismissed)');
              return;
            }

            const extractionMode = modeResult.mode;
            const isFirstRun = modeResult.isFirstRun;
            const modeLabel = extractionMode === 'full' ? 'Full' : extractionMode === 'fast' ? 'Fast' : 'Incremental';

            // GITX-126: Show informational message for first-run
            if (isFirstRun) {
              void vscode.window.showInformationMessage(
                'Gitr: No existing data found. Performing initial full extraction.',
              );
            }

            // GITX-130: Show repository selection Quick Pick
            const selectedRepo = await showRepositoryQuickPick(logger);
            if (selectedRepo === null) {
              logger.info(CLASS_NAME, 'runGitExtraction', 'Extraction cancelled by user (Repository Quick Pick dismissed)');
              return;
            }

            // GITX-130: Filter repositories if user selected a specific one
            let repositoriesToProcess = settings.repositories;
            if (selectedRepo) {
              const targetRepo = settings.repositories.find(r => r.name === selectedRepo);
              if (!targetRepo) {
                logger.error(CLASS_NAME, 'runGitExtraction', `Selected repository not found: ${selectedRepo}`);
                void vscode.window.showErrorMessage(`Gitr: Repository "${selectedRepo}" not found in settings.`);
                return;
              }
              repositoriesToProcess = [targetRepo];
              logger.info(CLASS_NAME, 'runGitExtraction', `Filtering to single repository: ${selectedRepo}`);
            }

            // Create PipelineRepository for run tracking and GitAnalysisService
            const pipelineRepo = new PipelineRepository(dbService);
            const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo);

            // GITX-123: Build options from settings and extraction mode
            // GITX-131: Added useGitLogAll for fast extraction mode
            const options: { sinceDate?: string; debugLogging?: boolean; forceFullExtraction?: boolean; useGitLogAll?: boolean } = {};
            if (settings.pipeline.sinceDate) {
              options.sinceDate = settings.pipeline.sinceDate;
            }
            if (settings.git.debugLogging) {
              options.debugLogging = settings.git.debugLogging;
            }
            // GITX-123: Set forceFullExtraction based on user's mode selection
            if (extractionMode === 'full') {
              options.forceFullExtraction = true;
              logger.info(CLASS_NAME, 'runGitExtraction', 'Full extraction mode: ignoring database watermarks');
            }
            // GITX-131: Set optimization flag for fast extraction mode
            if (extractionMode === 'fast') {
              options.useGitLogAll = true;
              logger.info(CLASS_NAME, 'runGitExtraction', 'Fast extraction mode: using git log --all');
            }

            const repoLabel = selectedRepo ? ` for ${selectedRepo}` : '';
            logger.info(CLASS_NAME, 'runGitExtraction', `Extracting commits from ${repositoriesToProcess.length} repositories${repoLabel} (mode: ${modeLabel}, isFirstRun: ${isFirstRun})`);
            if (options.sinceDate) {
              logger.info(CLASS_NAME, 'runGitExtraction', `Using sinceDate filter: ${options.sinceDate}`);
            }

            // Run Git extraction
            const progressMsg = selectedRepo ? `${selectedRepo} (${modeLabel})` : `All Repos (${modeLabel})`;
            progress.report({ message: `Extracting commits: ${progressMsg}...` });
            const result = await gitAnalysisService.analyzeRepositories(repositoriesToProcess, options);

            // Calculate totals
            const totalCommits = result.repoResults.reduce((sum, r) => sum + r.commitsInserted, 0);
            const totalBranches = result.repoResults.reduce((sum, r) => sum + r.branchesProcessed, 0);
            const reposProcessed = result.repoResults.length;
            const reposFailed = result.repoResults.filter((r) => r.error !== undefined).length;
            const durationSecs = Math.round((Date.now() - startTime) / 1000);

            // Build result message
            let message: string;
            if (result.status === 'SUCCESS') {
              message = `Gitr: Extracted ${totalCommits.toLocaleString()} commits from ${totalBranches} branches across ${reposProcessed} repos (${durationSecs}s)`;
              void vscode.window.showInformationMessage(message);
            } else if (result.status === 'PARTIAL') {
              const successCount = reposProcessed - reposFailed;
              message = `Gitr: Extracted ${totalCommits.toLocaleString()} commits from ${successCount}/${reposProcessed} repos. ${reposFailed} repo(s) failed—check Output.`;
              void vscode.window.showWarningMessage(message);
            } else {
              message = 'Gitr: Git extraction failed. Ensure repositories exist and are accessible.';
              void vscode.window.showErrorMessage(message);
            }

            logger.info(CLASS_NAME, 'runGitExtraction', message);
            logger.debug(CLASS_NAME, 'runGitExtraction', `Result status: ${result.status}, pipelineRunId: ${result.pipelineRunId ?? 'N/A'}`);

          } finally {
            // Always shut down the database connection pool
            try {
              await dbService.shutdown();
              logger.debug(CLASS_NAME, 'runGitExtraction', 'Database connection pool shut down');
            } catch (shutdownError: unknown) {
              const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
              logger.warn(CLASS_NAME, 'runGitExtraction', `Database shutdown warning: ${msg}`);
            }
          }
        }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(CLASS_NAME, 'runGitExtraction', `Git extraction failed: ${message}`, error instanceof Error ? error : undefined);
      void vscode.window.showErrorMessage(`Gitr: Git extraction failed - ${message}`);
    } finally {
      pipelineRunning = false;
      logger.debug(CLASS_NAME, 'runGitExtraction', 'Pipeline running flag set to false');
    }
  });
  disposables.push(runGitExtractionDisposable);

  // gitr.runGitExtractionForRepo - Run Git commit extraction for a specific repository (GITX-130)
  // Accepts an optional repoName parameter. If not provided, shows repository selection QuickPick.
  // Then shows extraction mode QuickPick (incremental vs full).
  const runGitExtractionForRepoDisposable = vscode.commands.registerCommand(
    'gitr.runGitExtractionForRepo',
    async (repoName?: string) => {
      logger.info(CLASS_NAME, 'runGitExtractionForRepo', `Command executed: gitr.runGitExtractionForRepo${repoName ? ` for ${repoName}` : ''}`);
      logger.debug(CLASS_NAME, 'runGitExtractionForRepo', 'Per-repository Git extraction starting...');

      if (pipelineRunning) {
        logger.warn(CLASS_NAME, 'runGitExtractionForRepo', 'Pipeline already running, cannot start Git extraction');
        void vscode.window.showWarningMessage('Gitr: A pipeline run is already in progress. Please wait for it to complete.');
        return;
      }

      const settings = getSettings();
      if (settings.repositories.length === 0) {
        logger.warn(CLASS_NAME, 'runGitExtractionForRepo', 'No repositories configured');
        void vscode.window.showWarningMessage('Gitr: No repositories configured. Add repos in Settings.');
        return;
      }

      // Step 1: Determine target repository
      let targetRepoName = repoName;
      if (!targetRepoName) {
        // Show repository selection QuickPick
        const repoItems = settings.repositories.map((r) => ({
          label: r.name,
          description: r.path,
          repoName: r.name,
        }));

        const selected = await vscode.window.showQuickPick(repoItems, {
          title: 'Select Repository for Git Extraction',
          placeHolder: 'Choose a repository to analyze',
        });

        if (!selected) {
          logger.info(CLASS_NAME, 'runGitExtractionForRepo', 'Repository selection cancelled by user');
          return;
        }

        targetRepoName = selected.repoName;
        logger.info(CLASS_NAME, 'runGitExtractionForRepo', `User selected repository: ${targetRepoName}`);
      }

      // Step 2: Validate repository exists in settings
      const targetRepo = settings.repositories.find((r) => r.name === targetRepoName);
      if (!targetRepo) {
        logger.warn(CLASS_NAME, 'runGitExtractionForRepo', `Repository not found in settings: ${targetRepoName}`);
        void vscode.window.showWarningMessage(`Gitr: Repository "${targetRepoName}" not found in settings.`);
        return;
      }

      pipelineRunning = true;
      logger.debug(CLASS_NAME, 'runGitExtractionForRepo', 'Pipeline running flag set to true');

      const startTime = Date.now();

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Gitr: Running Git Extraction for ${targetRepoName}`,
            cancellable: true,
          },
          async (progress, token) => {
            if (token.isCancellationRequested) {
              logger.info(CLASS_NAME, 'runGitExtractionForRepo', 'Git extraction cancelled by user');
              return;
            }

            // Build lightweight database connection
            progress.report({ message: 'Connecting to database...' });
            const buildResult = await buildDatabaseConnection(secretService, logger);
            if (!buildResult) {
              return; // buildDatabaseConnection already showed error messages
            }

            const { dbService, commitRepo } = buildResult;

            try {
              // Step 3: Determine extraction mode based on first-run detection
              const modeResult = await determineExtractionMode(commitRepo, logger);
              if (!modeResult) {
                logger.info(CLASS_NAME, 'runGitExtractionForRepo', 'Extraction cancelled by user (Quick Pick dismissed)');
                return;
              }

              const extractionMode = modeResult.mode;
              const isFirstRun = modeResult.isFirstRun;
              const modeLabel = extractionMode === 'full' ? 'Full' : extractionMode === 'fast' ? 'Fast' : 'Incremental';

              // Update progress notification to include repo name and mode
              progress.report({ message: `Extracting commits (${modeLabel})...` });

              // Show informational message for first-run
              if (isFirstRun) {
                void vscode.window.showInformationMessage(
                  `Gitr: No existing data found. Performing initial full extraction for ${targetRepoName}.`,
                );
              }

              // Create PipelineRepository for run tracking and GitAnalysisService
              const pipelineRepo = new PipelineRepository(dbService);
              const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo);

              // Build options from settings and extraction mode
              // GITX-131: Added useGitLogAll for fast extraction mode
              const options: { sinceDate?: string; debugLogging?: boolean; forceFullExtraction?: boolean; useGitLogAll?: boolean } = {};
              if (settings.pipeline.sinceDate) {
                options.sinceDate = settings.pipeline.sinceDate;
              }
              if (settings.git.debugLogging) {
                options.debugLogging = settings.git.debugLogging;
              }
              // Set forceFullExtraction based on user's mode selection
              if (extractionMode === 'full') {
                options.forceFullExtraction = true;
                logger.info(CLASS_NAME, 'runGitExtractionForRepo', 'Full extraction mode: ignoring database watermarks');
              }
              // GITX-131: Set optimization flag for fast extraction mode
              if (extractionMode === 'fast') {
                options.useGitLogAll = true;
                logger.info(CLASS_NAME, 'runGitExtractionForRepo', 'Fast extraction mode: using git log --all');
              }

              logger.info(CLASS_NAME, 'runGitExtractionForRepo', `Extracting commits from repository: ${targetRepoName} (mode: ${modeLabel}, isFirstRun: ${isFirstRun})`);
              if (options.sinceDate) {
                logger.info(CLASS_NAME, 'runGitExtractionForRepo', `Using sinceDate filter: ${options.sinceDate}`);
              }

              // Run Git extraction for single repository
              const result = await gitAnalysisService.analyzeRepositories([targetRepo], options);

              // Calculate totals
              const totalCommits = result.repoResults.reduce((sum, r) => sum + r.commitsInserted, 0);
              const totalBranches = result.repoResults.reduce((sum, r) => sum + r.branchesProcessed, 0);
              const durationSecs = Math.round((Date.now() - startTime) / 1000);

              // Build result message
              let message: string;
              if (result.status === 'SUCCESS') {
                message = `Gitr: Extracted ${totalCommits.toLocaleString()} commits from ${totalBranches} branches in ${targetRepoName} (${durationSecs}s)`;
                void vscode.window.showInformationMessage(message);
              } else if (result.status === 'PARTIAL') {
                message = `Gitr: Extracted ${totalCommits.toLocaleString()} commits from ${targetRepoName}, but encountered errors—check Output.`;
                void vscode.window.showWarningMessage(message);
              } else {
                message = `Gitr: Git extraction failed for ${targetRepoName}. Ensure repository exists and is accessible.`;
                void vscode.window.showErrorMessage(message);
              }

              logger.info(CLASS_NAME, 'runGitExtractionForRepo', message);
              logger.debug(CLASS_NAME, 'runGitExtractionForRepo', `Result status: ${result.status}, pipelineRunId: ${result.pipelineRunId ?? 'N/A'}`);

            } finally {
              // Always shut down the database connection pool
              try {
                await dbService.shutdown();
                logger.debug(CLASS_NAME, 'runGitExtractionForRepo', 'Database connection pool shut down');
              } catch (shutdownError: unknown) {
                const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
                logger.warn(CLASS_NAME, 'runGitExtractionForRepo', `Database shutdown warning: ${msg}`);
              }
            }
          }
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(CLASS_NAME, 'runGitExtractionForRepo', `Git extraction failed: ${message}`, error instanceof Error ? error : undefined);
        void vscode.window.showErrorMessage(`Gitr: Git extraction failed - ${message}`);
      } finally {
        pipelineRunning = false;
        logger.debug(CLASS_NAME, 'runGitExtractionForRepo', 'Pipeline running flag set to false');
      }
    },
  );
  disposables.push(runGitExtractionForRepoDisposable);

  // gitr.startDatabase - Start the PostgreSQL Docker container
  const startDatabaseDisposable = vscode.commands.registerCommand('gitr.startDatabase', async () => {
    logger.info(CLASS_NAME, 'startDatabase', 'Command executed: gitr.startDatabase');
    logger.debug(CLASS_NAME, 'startDatabase', 'Database startup starting...');

    try {
      // TODO: Implement Docker container management in subsequent tickets
      logger.info(CLASS_NAME, 'startDatabase', 'Database startup placeholder - implementation pending');
      void vscode.window.showInformationMessage(
        'Gitr: Database management will be implemented in a future update.'
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(CLASS_NAME, 'startDatabase', `Database startup failed: ${message}`, error instanceof Error ? error : undefined);
      void vscode.window.showErrorMessage(`Gitr: Database start failed - ${message}`);
    }
  });
  disposables.push(startDatabaseDisposable);

  // gitr.stopDatabase - Stop the PostgreSQL Docker container
  const stopDatabaseDisposable = vscode.commands.registerCommand('gitr.stopDatabase', async () => {
    logger.info(CLASS_NAME, 'stopDatabase', 'Command executed: gitr.stopDatabase');
    logger.debug(CLASS_NAME, 'stopDatabase', 'Database shutdown starting...');

    try {
      // TODO: Implement Docker container management in subsequent tickets
      logger.info(CLASS_NAME, 'stopDatabase', 'Database shutdown placeholder - implementation pending');
      void vscode.window.showInformationMessage(
        'Gitr: Database management will be implemented in a future update.'
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(CLASS_NAME, 'stopDatabase', `Database shutdown failed: ${message}`, error instanceof Error ? error : undefined);
      void vscode.window.showErrorMessage(`Gitr: Database stop failed - ${message}`);
    }
  });
  disposables.push(stopDatabaseDisposable);

  // gitr.resetDatabase - Clear all data from the database (reset to empty state)
  const resetDatabaseDisposable = vscode.commands.registerCommand('gitr.resetDatabase', async () => {
    logger.info(CLASS_NAME, 'resetDatabase', 'Command executed: gitr.resetDatabase');

    // Confirm with user before proceeding
    const confirm = await vscode.window.showWarningMessage(
      'Gitr: This will DELETE ALL DATA from the database. This action cannot be undone. Are you sure?',
      { modal: true },
      'Yes, Reset Database',
      'Cancel'
    );

    if (confirm !== 'Yes, Reset Database') {
      logger.info(CLASS_NAME, 'resetDatabase', 'Database reset cancelled by user');
      return;
    }

    if (pipelineRunning) {
      logger.warn(CLASS_NAME, 'resetDatabase', 'Pipeline is running, cannot reset database');
      void vscode.window.showWarningMessage('Gitr: Cannot reset database while pipeline is running.');
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Gitr: Resetting Database',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Connecting to database...' });

          // Build database connection
          const dbPassword = await secretService.getDatabasePassword();
          if (!dbPassword) {
            void vscode.window.showErrorMessage('Gitr: Database password is required.');
            return;
          }

          const settings = getSettings();
          const dbService = new DatabaseService();
          const dbConfig = buildConfigFromSettings(settings.database, dbPassword);

          try {
            await dbService.initialize(dbConfig);
            logger.info(CLASS_NAME, 'resetDatabase', 'Database connection established');

            progress.report({ message: 'Truncating data tables...' });

            // Truncate all data tables in dependency order (children first)
            // Using TRUNCATE ... CASCADE to handle foreign key constraints
            const truncateSQL = `
              TRUNCATE TABLE
                gitr_pipeline_sha,
                gitr_pipeline_jira,
                gitja_pipeline_table_counts,
                gitr_pipeline_log,
                gitr_pipeline_run,
                commit_msg_words,
                commit_tags,
                commit_directory,
                commit_files_types,
                commit_files,
                commit_branch_relationship,
                commit_jira,
                commit_linear,
                jira_github_pullrequest,
                jira_github_branch,
                jira_parent,
                jira_issue_link,
                jira_history,
                jira_detail,
                linear_detail,
                gitja_team_contributor,
                commit_history,
                commit_contributors
              CASCADE;
            `;

            await dbService.query(truncateSQL, []);
            logger.info(CLASS_NAME, 'resetDatabase', 'All data tables truncated');

            progress.report({ message: 'Database reset complete!' });

            void vscode.window.showInformationMessage(
              'Gitr: Database reset complete. All data has been cleared. Run the pipeline to repopulate.'
            );
            logger.info(CLASS_NAME, 'resetDatabase', 'Database reset completed successfully');

          } finally {
            await dbService.shutdown();
            logger.debug(CLASS_NAME, 'resetDatabase', 'Database connection closed');
          }
        }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(CLASS_NAME, 'resetDatabase', `Database reset failed: ${message}`);
      void vscode.window.showErrorMessage(`Gitr: Database reset failed - ${message}`);
    }
  });
  disposables.push(resetDatabaseDisposable);

  // gitrx.setDatabasePassword - Prompt user to set the database password securely
  const setDbPasswordDisposable = vscode.commands.registerCommand(
    'gitrx.setDatabasePassword',
    async () => {
      logger.info(CLASS_NAME, 'setDatabasePassword', 'Command executed: gitrx.setDatabasePassword');
      logger.debug(CLASS_NAME, 'setDatabasePassword', 'Prompting user for database password...');

      try {
        const result = await secretService.promptAndStore(SecretKeys.DATABASE_PASSWORD);
        if (result !== undefined) {
          logger.info(CLASS_NAME, 'setDatabasePassword', 'Database password stored successfully');
        } else {
          logger.debug(CLASS_NAME, 'setDatabasePassword', 'User cancelled database password prompt');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(CLASS_NAME, 'setDatabasePassword', `Failed to set database password: ${message}`);
        void vscode.window.showErrorMessage(`Gitr: Failed to save database password - ${message}`);
      }
    }
  );
  disposables.push(setDbPasswordDisposable);

  // gitrx.setJiraToken - Prompt user to set the Jira API token securely
  const setJiraTokenDisposable = vscode.commands.registerCommand(
    'gitrx.setJiraToken',
    async () => {
      logger.info(CLASS_NAME, 'setJiraToken', 'Command executed: gitrx.setJiraToken');
      logger.debug(CLASS_NAME, 'setJiraToken', 'Prompting user for Jira API token...');

      try {
        const result = await secretService.promptAndStore(SecretKeys.JIRA_TOKEN);
        if (result !== undefined) {
          logger.info(CLASS_NAME, 'setJiraToken', 'Jira API token stored successfully');
        } else {
          logger.debug(CLASS_NAME, 'setJiraToken', 'User cancelled Jira token prompt');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(CLASS_NAME, 'setJiraToken', `Failed to set Jira token: ${message}`);
        void vscode.window.showErrorMessage(`Gitr: Failed to save Jira token - ${message}`);
      }
    }
  );
  disposables.push(setJiraTokenDisposable);

  // gitrx.setGitHubToken - Prompt user to set the GitHub PAT securely
  const setGitHubTokenDisposable = vscode.commands.registerCommand(
    'gitrx.setGitHubToken',
    async () => {
      logger.info(CLASS_NAME, 'setGitHubToken', 'Command executed: gitrx.setGitHubToken');
      logger.debug(CLASS_NAME, 'setGitHubToken', 'Prompting user for GitHub personal access token...');

      try {
        const result = await secretService.promptAndStore(SecretKeys.GITHUB_TOKEN);
        if (result !== undefined) {
          logger.info(CLASS_NAME, 'setGitHubToken', 'GitHub token stored successfully');
        } else {
          logger.debug(CLASS_NAME, 'setGitHubToken', 'User cancelled GitHub token prompt');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(CLASS_NAME, 'setGitHubToken', `Failed to set GitHub token: ${message}`);
        void vscode.window.showErrorMessage(`Gitr: Failed to save GitHub token - ${message}`);
      }
    }
  );
  disposables.push(setGitHubTokenDisposable);

  // gitrx.setLinearToken - Prompt user to set the Linear API key securely (IQS-874)
  const setLinearTokenDisposable = vscode.commands.registerCommand(
    'gitrx.setLinearToken',
    async () => {
      logger.info(CLASS_NAME, 'setLinearToken', 'Command executed: gitrx.setLinearToken');
      logger.debug(CLASS_NAME, 'setLinearToken', 'Prompting user for Linear API key...');

      try {
        const result = await secretService.promptAndStore(SecretKeys.LINEAR_TOKEN);
        if (result !== undefined) {
          logger.info(CLASS_NAME, 'setLinearToken', 'Linear API key stored successfully');
        } else {
          logger.debug(CLASS_NAME, 'setLinearToken', 'User cancelled Linear API key prompt');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(CLASS_NAME, 'setLinearToken', `Failed to set Linear API key: ${message}`);
        void vscode.window.showErrorMessage(`Gitr: Failed to save Linear API key - ${message}`);
      }
    }
  );
  disposables.push(setLinearTokenDisposable);

  // gitrx.setMigrationPassword - Prompt user to set the migration database password (IQS-880)
  const setMigrationPasswordDisposable = vscode.commands.registerCommand(
    'gitrx.setMigrationPassword',
    async () => {
      logger.info(CLASS_NAME, 'setMigrationPassword', 'Command executed: gitrx.setMigrationPassword');
      logger.debug(CLASS_NAME, 'setMigrationPassword', 'Prompting user for migration database password...');

      try {
        const result = await secretService.promptAndStore(SecretKeys.MIGRATION_PASSWORD);
        if (result !== undefined) {
          logger.info(CLASS_NAME, 'setMigrationPassword', 'Migration database password stored successfully');
        } else {
          logger.debug(CLASS_NAME, 'setMigrationPassword', 'User cancelled migration password prompt');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(CLASS_NAME, 'setMigrationPassword', `Failed to set migration password: ${message}`);
        void vscode.window.showErrorMessage(`Gitr: Failed to save migration password - ${message}`);
      }
    }
  );
  disposables.push(setMigrationPasswordDisposable);

  // gitrx.setBitbucketToken - Prompt user to set the Bitbucket access token securely (GITX-2)
  const setBitbucketTokenDisposable = vscode.commands.registerCommand(
    'gitrx.setBitbucketToken',
    async () => {
      logger.info(CLASS_NAME, 'setBitbucketToken', 'Command executed: gitrx.setBitbucketToken');
      logger.debug(CLASS_NAME, 'setBitbucketToken', 'Prompting user for Bitbucket access token...');

      try {
        const result = await secretService.promptAndStore(SecretKeys.BITBUCKET_TOKEN);
        if (result !== undefined) {
          logger.info(CLASS_NAME, 'setBitbucketToken', 'Bitbucket access token stored successfully');
        } else {
          logger.debug(CLASS_NAME, 'setBitbucketToken', 'User cancelled Bitbucket token prompt');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(CLASS_NAME, 'setBitbucketToken', `Failed to set Bitbucket token: ${message}`);
        void vscode.window.showErrorMessage(`Gitr: Failed to save Bitbucket token - ${message}`);
      }
    }
  );
  disposables.push(setBitbucketTokenDisposable);

  // Store secretService reference for scheduled pipeline runs
  registeredSecretService = secretService;

  logger.debug(CLASS_NAME, 'registerCommands', `Registered ${disposables.length} commands`);
  return disposables;
}

/**
 * Reference to the SecretStorageService created during registerCommands.
 * Used by ScheduleRunnerService to build pipeline services for scheduled runs.
 */
let registeredSecretService: SecretStorageService | undefined;

/**
 * Get the registered SecretStorageService instance.
 * Available after registerCommands has been called.
 *
 * @returns The SecretStorageService, or undefined if commands not yet registered
 */
export function getSecretService(): SecretStorageService | undefined {
  return registeredSecretService;
}

// ============================================================================
// Lightweight database connection factory (IQS-882)
// ============================================================================

/**
 * Result from buildDatabaseConnection containing lightweight DB access.
 * The caller is responsible for shutting down dbService after use.
 */
export interface BuildDatabaseResult {
  dbService: DatabaseService;
  commitRepo: CommitRepository;
}

/**
 * Build a lightweight database connection with CommitRepository only.
 * Does not wire up Jira/GitHub/Linear/pipeline services.
 * Used by commands that only need database access (e.g., scc backfill).
 *
 * IMPORTANT: The caller MUST call dbService.shutdown() after use.
 *
 * @param secretService - SecretStorageService for credential retrieval
 * @param logger - Logger instance for diagnostic messages
 * @returns A BuildDatabaseResult, or null if configuration is insufficient
 */
export async function buildDatabaseConnection(
  secretService: SecretStorageService,
  logger: LoggerService,
): Promise<BuildDatabaseResult | null> {
  logger.debug(CLASS_NAME, 'buildDatabaseConnection', 'Building lightweight database connection');

  const settings = getSettings();

  // Step 1: Get database password (required)
  const dbPassword = await secretService.getDatabasePassword();
  if (!dbPassword) {
    logger.error(CLASS_NAME, 'buildDatabaseConnection', 'Database password not available.');
    void vscode.window.showErrorMessage(
      'Gitr: Database password is required. Use "Gitr: Set Database Password" to configure it.'
    );
    return null;
  }

  // Step 2: Initialize database connection
  logger.debug(CLASS_NAME, 'buildDatabaseConnection', 'Initializing database connection');
  const dbService = new DatabaseService();
  const dbConfig = buildConfigFromSettings(settings.database, dbPassword);

  try {
    await dbService.initialize(dbConfig);
    logger.info(CLASS_NAME, 'buildDatabaseConnection', 'Database connection established');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(CLASS_NAME, 'buildDatabaseConnection', `Database initialization failed: ${message}`);
    void vscode.window.showErrorMessage(
      `Gitr: Cannot connect to database. Ensure the database is running. Error: ${message}`
    );
    return null;
  }

  // Step 2b: Auto-run pending database migrations (IQS-879)
  const migrationOk = await runAutoMigrations(dbService, logger, secretService);
  if (!migrationOk) {
    return null;
  }

  // Step 3: Create repository
  const commitRepo = new CommitRepository(dbService);

  return { dbService, commitRepo };
}

// ============================================================================
// Pipeline service factory
// ============================================================================

/**
 * Result from buildPipelineService containing the service and its database connection.
 * The caller is responsible for shutting down dbService after use.
 */
interface BuildPipelineResult {
  pipelineService: PipelineService;
  dbService: DatabaseService;
}

/**
 * Build a fully-wired PipelineService from current settings and secrets.
 *
 * Creates the database connection, repositories, and all service dependencies.
 * Returns null if required configuration is missing (database password).
 *
 * IMPORTANT: The caller MUST call dbService.shutdown() after the pipeline completes
 * to release the database connection pool.
 *
 * @param secretService - SecretStorageService for credential retrieval
 * @param logger - Logger instance for diagnostic messages
 * @param extractionMode - Optional extraction mode (GITX-123, GITX-131). Default: 'incremental'
 * @param selectedRepository - Optional repository filter (GITX-130). When set, only this repository is processed.
 * @returns A BuildPipelineResult, or null if configuration is insufficient
 */
async function buildPipelineService(
  secretService: SecretStorageService,
  logger: LoggerService,
  extractionMode: FastExtractionMode = 'incremental',
  selectedRepository?: string,
): Promise<BuildPipelineResult | null> {
  logger.debug(CLASS_NAME, 'buildPipelineService', 'Building PipelineService from settings and secrets');

  const settings = getSettings();

  // Step 1: Get database password (required)
  const dbPassword = await secretService.getDatabasePassword();
  if (!dbPassword) {
    logger.error(CLASS_NAME, 'buildPipelineService', 'Database password not available. Pipeline cannot run.');
    void vscode.window.showErrorMessage(
      'Gitr: Database password is required. Use "Gitr: Set Database Password" to configure it.'
    );
    return null;
  }

  // Step 2: Initialize database connection
  logger.debug(CLASS_NAME, 'buildPipelineService', 'Initializing database connection');
  const dbService = new DatabaseService();
  const dbConfig = buildConfigFromSettings(settings.database, dbPassword);

  try {
    await dbService.initialize(dbConfig);
    logger.info(CLASS_NAME, 'buildPipelineService', 'Database connection established');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(CLASS_NAME, 'buildPipelineService', `Database initialization failed: ${message}`);
    void vscode.window.showErrorMessage(
      `Gitr: Cannot connect to database. Ensure the database is running. Error: ${message}`
    );
    return null;
  }

  // Step 2b: Auto-run pending database migrations (IQS-879, IQS-880: privilege separation)
  const migrationOk = await runAutoMigrations(dbService, logger, secretService);
  if (!migrationOk) {
    return null;
  }

  // Step 3: Create repositories
  const commitRepo = new CommitRepository(dbService);
  const contributorRepo = new ContributorRepository(dbService);
  const commitJiraRepo = new CommitJiraRepository(dbService);
  const commitLinearRepo = new CommitLinearRepository(dbService);
  const jiraRepo = new JiraRepository(dbService);
  const linearRepo = new LinearRepository(dbService);
  const pipelineRepo = new PipelineRepository(dbService);

  // Step 4: Create Git analysis service
  const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo);

  // Step 5: Create GitHub service (optional - needs token + org)
  let githubService: GitHubService | null = null;
  const githubToken = await secretService.getGitHubToken();
  if (githubToken && settings.github.organization) {
    logger.debug(CLASS_NAME, 'buildPipelineService', `GitHub service configured for org: ${settings.github.organization}`);
    githubService = new GitHubService(
      { token: githubToken, organization: settings.github.organization },
      contributorRepo,
      commitRepo,
      pipelineRepo,
    );
  } else {
    logger.info(CLASS_NAME, 'buildPipelineService', 'GitHub service skipped (token or organization not configured)');
  }

  // Step 6: Create Jira services (optional - needs server + token + username)
  let jiraIncrementalLoader: JiraIncrementalLoader | null = null;
  const jiraToken = await secretService.getJiraToken();
  if (jiraToken && settings.jira.server && settings.jira.username) {
    logger.debug(CLASS_NAME, 'buildPipelineService', `Jira service configured for: ${settings.jira.server}`);
    logger.debug(CLASS_NAME, 'buildPipelineService', `Jira debug logging: ${settings.jira.debugLogging}`);
    const jiraConfig = {
      server: settings.jira.server,
      username: settings.jira.username,
      token: jiraToken,
      pointsField: settings.jira.pointsField,
      debugLogging: settings.jira.debugLogging,
    };

    // Create the jira.js Version3Client with debug logging middleware
    const jiraClient = createJiraClient({
      server: settings.jira.server,
      username: settings.jira.username,
      token: jiraToken,
      enableDebugLogging: settings.jira.debugLogging,
    });

    const changelogService = new JiraChangelogService(jiraConfig, jiraRepo, pipelineRepo, jiraClient);
    // IQS-935: Pass changelogService to JiraService for history extraction during issue loading
    const jiraService = new JiraService(jiraConfig, jiraRepo, pipelineRepo, jiraClient, changelogService);
    const loaderConfig = JiraIncrementalLoader.buildConfig(
      settings.jira.increment,
      settings.jira.daysAgo,
      settings.jira.projectKeys,
    );
    jiraIncrementalLoader = new JiraIncrementalLoader(
      loaderConfig, jiraService, changelogService, jiraRepo, pipelineRepo,
    );
  } else {
    logger.info(CLASS_NAME, 'buildPipelineService', 'Jira services skipped (server, token, or username not configured)');
  }

  // Step 6b: Create Linear services (optional - needs token + team keys) (IQS-876)
  let linearIncrementalLoader: LinearIncrementalLoader | null = null;
  const linearToken = await secretService.getLinearToken();
  if (linearToken && settings.linear.teamKeys.length > 0) {
    logger.debug(CLASS_NAME, 'buildPipelineService', `Linear service configured with ${settings.linear.teamKeys.length} team keys`);
    const linearClient = new LinearClient({ apiKey: linearToken });
    const linearService = new LinearService(
      { token: linearToken },
      linearRepo,
      pipelineRepo,
      linearClient,
    );
    const linearLoaderConfig = LinearIncrementalLoader.buildConfig(
      settings.linear.increment,
      settings.linear.daysAgo,
      settings.linear.teamKeys,
    );
    linearIncrementalLoader = new LinearIncrementalLoader(
      linearLoaderConfig, linearService, linearRepo, pipelineRepo,
    );
  } else {
    logger.info(CLASS_NAME, 'buildPipelineService', 'Linear services skipped (token or team keys not configured)');
  }

  // Step 7: Create data enhancer and team assignment services
  // IQS-935: Pass projectKeys to DataEnhancerService for commit-jira linking
  const dataEnhancerService = new DataEnhancerService(
    commitRepo, commitJiraRepo, settings.jira.keyAliases, commitLinearRepo, settings.jira.projectKeys,
  );
  const teamAssignmentService = new TeamAssignmentService(contributorRepo, commitJiraRepo, pipelineRepo);

  // Step 8: Build pipeline config (IQS-931: added sinceDate, GITX-123: added forceFullExtraction, GITX-130: added selectedRepository, GITX-131: added useGitLogAll)
  const configuredSteps = settings.pipeline.steps;
  const validatedSteps = PipelineService.validateSteps(configuredSteps);
  const forceFullExtraction = extractionMode === 'full';
  // GITX-131: Set optimization flag for fast extraction mode
  const useGitLogAll = extractionMode === 'fast';
  const pipelineConfig = PipelineService.buildConfig(
    validatedSteps,
    settings.jira.increment,
    settings.jira.daysAgo,
    settings.jira.projectKeys,
    settings.jira.keyAliases,
    settings.linear.teamKeys,
    settings.pipeline.sinceDate,
    forceFullExtraction,
    selectedRepository,
    useGitLogAll,
  );

  const modeLabel = extractionMode === 'full' ? 'Full' : extractionMode === 'fast' ? 'Fast' : 'Incremental';
  const repoLabel = selectedRepository ? `, selectedRepository=${selectedRepository}` : '';
  logger.info(CLASS_NAME, 'buildPipelineService', `Pipeline config: ${pipelineConfig.steps.length} steps, jiraIncrement=${pipelineConfig.jiraIncrement}, jiraDaysAgo=${pipelineConfig.jiraDaysAgo}, linearTeamKeys=${pipelineConfig.linearTeamKeys.length}, sinceDate=${pipelineConfig.sinceDate ?? '(none)'}, extractionMode=${modeLabel}${repoLabel}`);

  // Step 9: Create and return PipelineService with dbService for cleanup
  const pipelineService = new PipelineService(
    pipelineRepo,
    gitAnalysisService,
    githubService,
    jiraIncrementalLoader,
    linearIncrementalLoader,
    dataEnhancerService,
    teamAssignmentService,
    settings.repositories,
    pipelineConfig,
  );

  return { pipelineService, dbService };
}
