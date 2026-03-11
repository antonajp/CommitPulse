/**
 * Backfill command registrations for the Gitr extension.
 *
 * Extracted from extension.ts to keep files under 600 lines.
 * Contains:
 *   - gitr.backfillSccMetrics (IQS-882)
 *   - gitr.backfillStoryPoints (IQS-884)
 *   - gitr.backfillArcComponents (IQS-885)
 *
 * All commands follow the same pattern:
 *   1. Mutual exclusion check (pipeline + backfill flags)
 *   2. Lightweight DB connection via buildDatabaseConnection()
 *   3. withProgress + cancellation
 *   4. Lazy-import service to avoid loading at startup
 *   5. Result notification
 */

import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import { isPipelineRunning, getSecretService, buildDatabaseConnection } from './index.js';
import { getSettings } from '../config/settings.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'BackfillCommands';

/**
 * Tracks whether a backfill run is in progress.
 * Used for mutual exclusion between concurrent backfill executions.
 * Shared across SCC and Story Points backfill commands.
 */
let backfillRunning = false;

/**
 * Check whether a backfill run is currently in progress.
 * Exported for mutual exclusion checks from extension.ts.
 *
 * @returns true if a backfill run is executing
 */
export function isBackfillRunning(): boolean {
  return backfillRunning;
}

/**
 * Register the "Gitr: Backfill SCC Metrics" command.
 *
 * Uses lightweight buildDatabaseConnection() (no Jira/GitHub/Linear wiring).
 * Mutually exclusive with pipeline runs and other backfill runs.
 *
 * Ticket: IQS-882
 *
 * @param logger - Logger instance for diagnostic messages
 * @returns The command disposable
 */
export function registerSccBackfillCommand(logger: LoggerService | undefined): vscode.Disposable {
  logger?.debug(CLASS_NAME, 'registerSccBackfillCommand', 'Registering SCC Backfill command');

  const backfillDisposable = vscode.commands.registerCommand('gitr.backfillSccMetrics', async () => {
    logger?.info(CLASS_NAME, 'backfillSccMetrics', 'Command executed: gitr.backfillSccMetrics');

    if (isPipelineRunning() || backfillRunning) {
      logger?.warn(CLASS_NAME, 'backfillSccMetrics', 'Another operation is already running, cannot start backfill');
      void vscode.window.showWarningMessage('Gitr: A pipeline or backfill run is already in progress. Please wait for it to complete.');
      return;
    }

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'backfillSccMetrics', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    backfillRunning = true;
    logger?.debug(CLASS_NAME, 'backfillSccMetrics', 'Backfill running flag set to true');

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Gitr: Backfilling SCC Metrics',
          cancellable: true,
        },
        async (progress, token) => {
          // Build lightweight DB connection
          const buildResult = await buildDatabaseConnection(secretService, LoggerService.getInstance());
          if (!buildResult) {
            return;
          }

          const { dbService, commitRepo } = buildResult;

          try {
            // Lazy-import to avoid loading scc deps at extension startup
            const { SccMetricsService } = await import('../services/scc-metrics-service.js');
            const { SccBackfillService } = await import('../services/scc-backfill-service.js');

            const sccService = new SccMetricsService();
            const backfillService = new SccBackfillService(commitRepo, sccService);

            const settings = getSettings();
            const result = await backfillService.runBackfill(settings.repositories, progress, token);

            // Show result notification
            if (result.totalCommits === 0) {
              void vscode.window.showInformationMessage('Gitr: No commits require SCC backfill.');
            } else {
              const durationSec = Math.round(result.durationMs / 1000);
              const message = `Gitr: SCC backfill complete — ${result.processedCommits}/${result.totalCommits} commits processed, ${result.totalFilesUpdated} files updated (${durationSec}s)`;
              if (result.skippedCommits > 0) {
                void vscode.window.showWarningMessage(`${message}. ${result.skippedCommits} commits skipped.`);
              } else {
                void vscode.window.showInformationMessage(message);
              }
            }

            logger?.info(CLASS_NAME, 'backfillSccMetrics', `Backfill result: ${JSON.stringify(result)}`);
          } finally {
            try {
              await dbService.shutdown();
              logger?.debug(CLASS_NAME, 'backfillSccMetrics', 'Database connection pool shut down');
            } catch (shutdownError: unknown) {
              const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
              logger?.warn(CLASS_NAME, 'backfillSccMetrics', `Database shutdown warning: ${msg}`);
            }
          }
        },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error(CLASS_NAME, 'backfillSccMetrics', `SCC backfill failed: ${message}`, error instanceof Error ? error : undefined);
      void vscode.window.showErrorMessage(`Gitr: SCC backfill failed — ${message}`);
    } finally {
      backfillRunning = false;
      logger?.debug(CLASS_NAME, 'backfillSccMetrics', 'Backfill running flag set to false');
    }
  });

  logger?.info(CLASS_NAME, 'registerSccBackfillCommand', 'SCC Backfill command registered');
  return backfillDisposable;
}

/**
 * Register the "Gitr: Backfill Story Points" command.
 *
 * Calculates story points from issue duration (creation -> completion)
 * and writes them to the calculated_story_points column.
 *
 * Uses lightweight buildDatabaseConnection() (no Jira/GitHub/Linear wiring).
 * Mutually exclusive with pipeline runs and other backfill runs.
 *
 * Ticket: IQS-884
 *
 * @param logger - Logger instance for diagnostic messages
 * @returns The command disposable
 */
export function registerStoryPointsBackfillCommand(logger: LoggerService | undefined): vscode.Disposable {
  logger?.debug(CLASS_NAME, 'registerStoryPointsBackfillCommand', 'Registering Story Points Backfill command');

  const storyPointsDisposable = vscode.commands.registerCommand('gitr.backfillStoryPoints', async () => {
    logger?.info(CLASS_NAME, 'backfillStoryPoints', 'Command executed: gitr.backfillStoryPoints');

    if (isPipelineRunning() || backfillRunning) {
      logger?.warn(CLASS_NAME, 'backfillStoryPoints', 'Another operation is already running, cannot start backfill');
      void vscode.window.showWarningMessage('Gitr: A pipeline or backfill run is already in progress. Please wait for it to complete.');
      return;
    }

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'backfillStoryPoints', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    backfillRunning = true;
    logger?.debug(CLASS_NAME, 'backfillStoryPoints', 'Backfill running flag set to true');

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Gitr: Backfilling Story Points',
          cancellable: true,
        },
        async (progress, token) => {
          // Build lightweight DB connection
          const buildResult = await buildDatabaseConnection(secretService, LoggerService.getInstance());
          if (!buildResult) {
            return;
          }

          const { dbService } = buildResult;

          try {
            // Lazy-import to avoid loading deps at extension startup
            const { JiraRepository } = await import('../database/jira-repository.js');
            const { LinearRepository } = await import('../database/linear-repository.js');
            const { StoryPointsBackfillService } = await import('../services/story-points-backfill-service.js');

            const jiraRepo = new JiraRepository(dbService);
            const linearRepo = new LinearRepository(dbService);
            const backfillService = new StoryPointsBackfillService(jiraRepo, linearRepo);

            const result = await backfillService.runBackfill(progress, token);

            // Show result notification
            const totalUpdated = result.jiraUpdated + result.linearUpdated;
            if (result.totalIssues === 0) {
              void vscode.window.showInformationMessage('Gitr: No issues require story points backfill.');
            } else {
              const durationSec = Math.round(result.durationMs / 1000);
              const message = `Gitr: Story points backfill complete — ${totalUpdated}/${result.totalIssues} issues updated (${durationSec}s)`;
              if (result.skipped > 0) {
                void vscode.window.showWarningMessage(`${message}. ${result.skipped} issues skipped.`);
              } else {
                void vscode.window.showInformationMessage(message);
              }
            }

            logger?.info(CLASS_NAME, 'backfillStoryPoints', `Backfill result: ${JSON.stringify(result)}`);
          } finally {
            try {
              await dbService.shutdown();
              logger?.debug(CLASS_NAME, 'backfillStoryPoints', 'Database connection pool shut down');
            } catch (shutdownError: unknown) {
              const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
              logger?.warn(CLASS_NAME, 'backfillStoryPoints', `Database shutdown warning: ${msg}`);
            }
          }
        },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error(CLASS_NAME, 'backfillStoryPoints', `Story points backfill failed: ${message}`, error instanceof Error ? error : undefined);
      void vscode.window.showErrorMessage(`Gitr: Story points backfill failed — ${message}`);
    } finally {
      backfillRunning = false;
      logger?.debug(CLASS_NAME, 'backfillStoryPoints', 'Backfill running flag set to false');
    }
  });

  logger?.info(CLASS_NAME, 'registerStoryPointsBackfillCommand', 'Story Points Backfill command registered');
  return storyPointsDisposable;
}

/**
 * In-memory cache of the last mapping checksum for smart refresh detection.
 * Resets when the extension is deactivated (fresh VS Code session).
 * Ticket: IQS-885
 */
let lastArcMappingChecksum = '';

/**
 * Register the "Gitr: Backfill Architecture Components" command.
 *
 * Classifies every file in commit_files into an architecture component
 * category (Front-End, Back-End, Database, DevOps/CI, etc.) using
 * user-editable extension and filename mappings.
 *
 * Uses lightweight buildDatabaseConnection() (no Jira/GitHub/Linear wiring).
 * Mutually exclusive with pipeline runs and other backfill runs.
 *
 * Ticket: IQS-885
 *
 * @param logger - Logger instance for diagnostic messages
 * @returns The command disposable
 */
export function registerArcComponentBackfillCommand(logger: LoggerService | undefined): vscode.Disposable {
  logger?.debug(CLASS_NAME, 'registerArcComponentBackfillCommand', 'Registering Arc Component Backfill command');

  const arcComponentDisposable = vscode.commands.registerCommand('gitr.backfillArcComponents', async () => {
    logger?.info(CLASS_NAME, 'backfillArcComponents', 'Command executed: gitr.backfillArcComponents');

    if (isPipelineRunning() || backfillRunning) {
      logger?.warn(CLASS_NAME, 'backfillArcComponents', 'Another operation is already running, cannot start backfill');
      void vscode.window.showWarningMessage('Gitr: A pipeline or backfill run is already in progress. Please wait for it to complete.');
      return;
    }

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'backfillArcComponents', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    backfillRunning = true;
    logger?.debug(CLASS_NAME, 'backfillArcComponents', 'Backfill running flag set to true');

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Gitr: Backfilling Architecture Components',
          cancellable: true,
        },
        async (progress, token) => {
          // Build lightweight DB connection
          const buildResult = await buildDatabaseConnection(secretService, LoggerService.getInstance());
          if (!buildResult) {
            return;
          }

          const { dbService, commitRepo } = buildResult;

          try {
            // Lazy-import to avoid loading deps at extension startup
            const { ArcComponentClassifier } = await import('../services/arc-component-classifier.js');
            const { ArcComponentBackfillService } = await import('../services/arc-component-backfill-service.js');

            // Read mappings from settings
            const settings = getSettings();
            const extensionMapping = settings.arcComponent.extensionMapping;
            const filenameMapping = settings.arcComponent.filenameMapping;

            logger?.debug(
              CLASS_NAME,
              'backfillArcComponents',
              `Extension mappings: ${Object.keys(extensionMapping).length}, Filename mappings: ${Object.keys(filenameMapping).length}`,
            );

            const classifier = new ArcComponentClassifier(extensionMapping, filenameMapping);
            const backfillService = new ArcComponentBackfillService(commitRepo, classifier);

            const result = await backfillService.runBackfill(lastArcMappingChecksum, progress, token);

            // Update checksum for smart refresh on next run
            lastArcMappingChecksum = classifier.getMappingChecksum();
            logger?.debug(CLASS_NAME, 'backfillArcComponents', `Updated mapping checksum: ${lastArcMappingChecksum}`);

            // Show result notification
            if (result.totalFiles === 0) {
              void vscode.window.showInformationMessage('Gitr: No files require architecture component classification.');
            } else {
              const durationSec = Math.round(result.durationMs / 1000);

              // Build category breakdown string
              const breakdown = Object.entries(result.categoryCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, count]) => `${cat}: ${count}`)
                .join(', ');

              const message = `Gitr: Arc component backfill complete — ${result.classifiedFiles}/${result.totalFiles} files classified (${durationSec}s). ${breakdown}`;

              if (result.otherCount > 0) {
                // Show warning with "Review Settings" action button
                const action = await vscode.window.showWarningMessage(
                  `${message}. ${result.otherCount} files defaulted to "Other".`,
                  'Review Settings',
                );
                if (action === 'Review Settings') {
                  logger?.info(CLASS_NAME, 'backfillArcComponents', 'User clicked Review Settings — opening arcComponent settings');
                  void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'gitrx.arcComponent',
                  );
                }
              } else {
                void vscode.window.showInformationMessage(message);
              }
            }

            logger?.info(CLASS_NAME, 'backfillArcComponents', `Backfill result: ${JSON.stringify(result)}`);
          } finally {
            try {
              await dbService.shutdown();
              logger?.debug(CLASS_NAME, 'backfillArcComponents', 'Database connection pool shut down');
            } catch (shutdownError: unknown) {
              const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
              logger?.warn(CLASS_NAME, 'backfillArcComponents', `Database shutdown warning: ${msg}`);
            }
          }
        },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error(CLASS_NAME, 'backfillArcComponents', `Arc component backfill failed: ${message}`, error instanceof Error ? error : undefined);
      void vscode.window.showErrorMessage(`Gitr: Arc component backfill failed — ${message}`);
    } finally {
      backfillRunning = false;
      logger?.debug(CLASS_NAME, 'backfillArcComponents', 'Backfill running flag set to false');
    }
  });

  logger?.info(CLASS_NAME, 'registerArcComponentBackfillCommand', 'Arc Component Backfill command registered');
  return arcComponentDisposable;
}

/**
 * Register the "Gitr: Backfill Jira Issues (Clear & Reload)" command.
 *
 * Clears all Jira-related tables and triggers a full reload from the Jira API.
 * Use this to recover from failed initial loads or to force a complete refresh.
 *
 * Requires:
 *   - Modal confirmation (destructive operation)
 *   - Valid Jira credentials (server, username, token)
 *   - Database connection
 *
 * Tables cleared:
 *   - gitr_pipeline_jira, jira_github_pullrequest, jira_github_branch
 *   - jira_parent, jira_issue_link, jira_history, jira_detail
 *
 * Preserves:
 *   - commit_jira (commits retain their Jira key references)
 *
 * Ticket: IQS-933
 *
 * @param logger - Logger instance for diagnostic messages
 * @returns The command disposable
 */
export function registerJiraBackfillCommand(logger: LoggerService | undefined): vscode.Disposable {
  logger?.debug(CLASS_NAME, 'registerJiraBackfillCommand', 'Registering Jira Backfill command');

  const jiraBackfillDisposable = vscode.commands.registerCommand('gitr.backfillJiraIssues', async () => {
    logger?.info(CLASS_NAME, 'backfillJiraIssues', 'Command executed: gitr.backfillJiraIssues');

    // Check mutual exclusion with pipeline and other backfill runs
    if (isPipelineRunning() || backfillRunning) {
      logger?.warn(CLASS_NAME, 'backfillJiraIssues', 'Another operation is already running, cannot start backfill');
      void vscode.window.showWarningMessage('Gitr: A pipeline or backfill run is already in progress. Please wait for it to complete.');
      return;
    }

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'backfillJiraIssues', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    // Step 1: Validate Jira configuration before showing confirmation
    const settings = getSettings();
    if (!settings.jira.server || !settings.jira.username) {
      logger?.warn(CLASS_NAME, 'backfillJiraIssues', 'Jira server or username not configured');
      void vscode.window.showErrorMessage('Gitr: Jira server and username must be configured. Check your settings.');
      return;
    }

    const jiraToken = await secretService.getJiraToken();
    if (!jiraToken) {
      logger?.warn(CLASS_NAME, 'backfillJiraIssues', 'Jira API token not configured');
      void vscode.window.showErrorMessage('Gitr: Jira API token is required. Use "Gitr: Set Jira API Token" to configure it.');
      return;
    }

    if (settings.jira.projectKeys.length === 0) {
      logger?.warn(CLASS_NAME, 'backfillJiraIssues', 'No Jira project keys configured');
      void vscode.window.showErrorMessage('Gitr: At least one Jira project key must be configured in settings (gitrx.jira.projectKeys).');
      return;
    }

    // Set backfillRunning BEFORE modal to prevent race condition (security fix)
    backfillRunning = true;
    logger?.debug(CLASS_NAME, 'backfillJiraIssues', 'Backfill running flag set to true (pre-confirmation)');

    try {
      // Step 2: Fetch issue count for informed confirmation (security fix - show exact count)
      let issueCount = 0;
      try {
        const buildResult = await buildDatabaseConnection(secretService, LoggerService.getInstance());
        if (buildResult) {
          const { dbService } = buildResult;
          try {
            const { JiraRepository } = await import('../database/jira-repository.js');
            const jiraRepo = new JiraRepository(dbService);
            issueCount = await jiraRepo.getJiraDetailCount();
          } finally {
            await dbService.shutdown();
          }
        }
      } catch (countError: unknown) {
        const msg = countError instanceof Error ? countError.message : String(countError);
        logger?.warn(CLASS_NAME, 'backfillJiraIssues', `Failed to get issue count: ${msg}`);
        // Continue with confirmation dialog even if count fails
      }

      // Step 3: Modal confirmation dialog with issue count (destructive operation)
      const confirmMessage = issueCount > 0
        ? `Gitr: This will DELETE ${issueCount.toLocaleString()} Jira issues and all related data, then reload from scratch. ` +
          'Commit-Jira mappings (commit_jira) will be preserved. ' +
          'This cannot be undone. Continue?'
        : 'Gitr: This will DELETE all Jira data and reload from scratch. ' +
          'Commit-Jira mappings (commit_jira) will be preserved. ' +
          'This cannot be undone. Continue?';

      const confirm = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        'Yes, Clear and Reload',
        'Cancel',
      );

      if (confirm !== 'Yes, Clear and Reload') {
        logger?.info(CLASS_NAME, 'backfillJiraIssues', 'Jira backfill cancelled by user');
        return;
      }

      logger?.info(CLASS_NAME, 'backfillJiraIssues', `User confirmed Jira backfill operation (${issueCount} issues to clear)`);

      // Step 4: Execute backfill with progress notification
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Gitr: Backfilling Jira Issues',
          cancellable: true,
        },
        async (progress, token) => {
          // Build lightweight DB connection
          const buildResult = await buildDatabaseConnection(secretService, LoggerService.getInstance());
          if (!buildResult) {
            return;
          }

          const { dbService } = buildResult;

          try {
            // Lazy-import to avoid loading deps at extension startup
            const { JiraRepository } = await import('../database/jira-repository.js');
            const { PipelineRepository } = await import('../database/pipeline-repository.js');
            const { JiraService } = await import('../services/jira-service.js');
            const { JiraChangelogService } = await import('../services/jira-changelog-service.js');
            const { JiraBackfillService } = await import('../services/jira-backfill-service.js');
            const { createJiraClient } = await import('../services/jira-client-factory.js');

            // Create repositories
            const jiraRepo = new JiraRepository(dbService);
            const pipelineRepo = new PipelineRepository(dbService);

            // Create Jira service with configured settings
            const jiraConfig = {
              server: settings.jira.server,
              username: settings.jira.username,
              token: jiraToken,
              pointsField: settings.jira.pointsField,
              debugLogging: settings.jira.debugLogging,
            };

            const jiraClient = createJiraClient({
              server: settings.jira.server,
              username: settings.jira.username,
              token: jiraToken,
              enableDebugLogging: settings.jira.debugLogging,
            });

            // IQS-935: Create changelog service for history extraction during issue loading
            const changelogService = new JiraChangelogService(jiraConfig, jiraRepo, pipelineRepo, jiraClient);
            const jiraService = new JiraService(jiraConfig, jiraRepo, pipelineRepo, jiraClient, changelogService);

            // Create backfill service
            const backfillService = new JiraBackfillService(
              jiraRepo,
              pipelineRepo,
              jiraService,
              settings.jira.projectKeys,
            );

            // Run the backfill
            const result = await backfillService.runBackfill(progress, token);

            // Show result notification
            if (result.cancelled) {
              void vscode.window.showWarningMessage('Gitr: Jira backfill was cancelled.');
            } else if (result.issuesLoaded === 0 && result.issuesFailed === 0) {
              void vscode.window.showInformationMessage(
                `Gitr: Jira backfill complete. Cleared ${result.issuesClearedBefore} issues. No new issues found.`,
              );
            } else {
              const durationSec = Math.round(result.durationMs / 1000);
              const message = `Gitr: Jira backfill complete — ${result.issuesLoaded} issues loaded in ${durationSec}s`;
              if (result.issuesFailed > 0) {
                void vscode.window.showWarningMessage(`${message}. ${result.issuesFailed} issues failed to load.`);
              } else {
                void vscode.window.showInformationMessage(message);
              }
            }

            logger?.info(CLASS_NAME, 'backfillJiraIssues', `Backfill result: ${JSON.stringify({
              cleared: result.issuesClearedBefore,
              loaded: result.issuesLoaded,
              failed: result.issuesFailed,
              durationMs: result.durationMs,
              cancelled: result.cancelled,
            })}`);
          } finally {
            try {
              await dbService.shutdown();
              logger?.debug(CLASS_NAME, 'backfillJiraIssues', 'Database connection pool shut down');
            } catch (shutdownError: unknown) {
              const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
              logger?.warn(CLASS_NAME, 'backfillJiraIssues', `Database shutdown warning: ${msg}`);
            }
          }
        },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error(CLASS_NAME, 'backfillJiraIssues', `Jira backfill failed: ${message}`, error instanceof Error ? error : undefined);
      void vscode.window.showErrorMessage(`Gitr: Jira backfill failed — ${message}`);
    } finally {
      // Always reset flag, even if user cancelled in modal
      backfillRunning = false;
      logger?.debug(CLASS_NAME, 'backfillJiraIssues', 'Backfill running flag reset');
    }
  });

  logger?.info(CLASS_NAME, 'registerJiraBackfillCommand', 'Jira Backfill command registered');
  return jiraBackfillDisposable;
}
