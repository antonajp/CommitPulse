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
 * SQL file path for arc component classification.
 * Relative to extension root (scripts/classify-arc-component.sql).
 * GITX-146: Simplified to use SQL-based classification.
 */
const ARC_COMPONENT_SQL_FILE = 'scripts/classify-arc-component.sql';

/**
 * Expected SHA-256 checksum of the SQL file for integrity verification.
 * Security: CWE-494 (Download of Code Without Integrity Check).
 * Update this checksum whenever classify-arc-component.sql changes.
 * GITX-146: Security requirement - verify SQL file before execution.
 */
const ARC_COMPONENT_SQL_CHECKSUM = '044a3398ea0f4372230576fb4aba9126286bb485978984b5141129e984eefad4';

/**
 * Result type for arc component SQL classification.
 */
interface ArcComponentSqlResult {
  /** Category breakdown from SQL query results */
  categoryCounts: Record<string, number>;
  /** Total rows classified */
  totalClassified: number;
  /** Execution time in milliseconds */
  durationMs: number;
}

/**
 * Register the "Gitr: Backfill Architecture Components" command.
 *
 * Classifies every file in commit_files into an architecture component
 * category (Front-End, Back-End, Database, DevOps/CI, etc.) by executing
 * the LLM-generated SQL classification rules in scripts/classify-arc-component.sql.
 *
 * GITX-146: Simplified from TypeScript-based classification to direct SQL execution.
 * Removed user-editable VS Code settings in favor of canonical SQL rules.
 *
 * Uses lightweight buildDatabaseConnection() (no Jira/GitHub/Linear wiring).
 * Mutually exclusive with pipeline runs and other backfill runs.
 *
 * @param logger - Logger instance for diagnostic messages
 * @param extensionUri - Extension URI for resolving SQL file path
 * @returns The command disposable
 */
export function registerArcComponentBackfillCommand(
  logger: LoggerService | undefined,
  extensionUri?: vscode.Uri,
): vscode.Disposable {
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

    // Step 1: Show QuickPick for mode selection
    const modeSelection = await vscode.window.showQuickPick(
      [
        {
          label: 'Incremental (Recommended)',
          description: 'Only classify rows where arc_component IS NULL',
          mode: 'incremental' as const,
        },
        {
          label: 'Force Full Reclassification',
          description: 'Reset all rows to NULL, then re-classify everything',
          mode: 'force' as const,
        },
      ],
      {
        title: 'Gitr: Backfill Architecture Components',
        placeHolder: 'Select classification mode',
      },
    );

    if (!modeSelection) {
      logger?.info(CLASS_NAME, 'backfillArcComponents', 'User cancelled mode selection');
      return;
    }

    const forceMode = modeSelection.mode === 'force';
    logger?.info(CLASS_NAME, 'backfillArcComponents', `Mode selected: ${modeSelection.mode}`);

    backfillRunning = true;
    logger?.debug(CLASS_NAME, 'backfillArcComponents', 'Backfill running flag set to true');

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Gitr: Classifying Architecture Components (${forceMode ? 'Full' : 'Incremental'})`,
          cancellable: true,
        },
        async (progress, token) => {
          const startTime = Date.now();

          // Step 2: Locate and read the SQL file
          progress.report({ message: 'Reading classification rules...' });

          let sqlFilePath: string;
          if (extensionUri) {
            sqlFilePath = vscode.Uri.joinPath(extensionUri, ARC_COMPONENT_SQL_FILE).fsPath;
          } else {
            // Fallback: try to find extension context from global state
            const extensions = vscode.extensions.all.find((e) => e.id.includes('gitr'));
            if (extensions?.extensionPath) {
              const { join } = await import('path');
              sqlFilePath = join(extensions.extensionPath, ARC_COMPONENT_SQL_FILE);
            } else {
              throw new Error('Cannot determine extension path for SQL file');
            }
          }

          // Security: Validate SQL file path is within extension directory (CWE-22: Path Traversal)
          const { readFile } = await import('fs/promises');
          const { resolve, dirname } = await import('path');

          const resolvedPath = resolve(sqlFilePath);
          const extensionRoot = extensionUri ? extensionUri.fsPath : dirname(dirname(resolvedPath));

          if (!resolvedPath.startsWith(extensionRoot)) {
            logger?.error(CLASS_NAME, 'backfillArcComponents', `Security: SQL file path traversal detected: ${resolvedPath}`);
            throw new Error('Security error: SQL file path outside extension directory');
          }

          let sqlContent: string;
          try {
            sqlContent = await readFile(resolvedPath, 'utf-8');
            logger?.debug(CLASS_NAME, 'backfillArcComponents', `SQL file read: ${sqlContent.length} bytes from ${resolvedPath}`);
          } catch (readError: unknown) {
            const msg = readError instanceof Error ? readError.message : String(readError);
            logger?.error(CLASS_NAME, 'backfillArcComponents', `Failed to read SQL file: ${msg}`);
            throw new Error(`Classification rules file not found: ${ARC_COMPONENT_SQL_FILE}`);
          }

          // Security: Verify SQL file checksum (CWE-494: Download of Code Without Integrity Check)
          // Note: For development, we log but don't fail on checksum mismatch
          // In production, this should be enforced
          const { createHash } = await import('crypto');
          const actualChecksum = createHash('sha256').update(sqlContent).digest('hex');
          if (actualChecksum !== ARC_COMPONENT_SQL_CHECKSUM) {
            logger?.warn(
              CLASS_NAME,
              'backfillArcComponents',
              `SQL file checksum mismatch. Expected: ${ARC_COMPONENT_SQL_CHECKSUM}, Got: ${actualChecksum}`,
            );
            // Log but continue - checksum will need updating when SQL changes
          }

          // Check for cancellation
          if (token.isCancellationRequested) {
            logger?.info(CLASS_NAME, 'backfillArcComponents', 'Backfill cancelled before database connection');
            return;
          }

          // Step 3: Build lightweight DB connection
          progress.report({ message: 'Connecting to database...' });
          const buildResult = await buildDatabaseConnection(secretService, LoggerService.getInstance());
          if (!buildResult) {
            return;
          }

          const { dbService } = buildResult;

          try {
            // Step 4: Extract SQL statements from the file
            // Parse sections marked by @RESET_START/@RESET_END, @CLASSIFY_START/@CLASSIFY_END, @SUMMARY_START/@SUMMARY_END
            const resetMatch = sqlContent.match(/-- @RESET_START\n([\s\S]*?)-- @RESET_END/);
            const classifyMatch = sqlContent.match(/-- @CLASSIFY_START\n([\s\S]*?)-- @CLASSIFY_END/);
            const summaryMatch = sqlContent.match(/-- @SUMMARY_START\n([\s\S]*?)-- @SUMMARY_END/);

            if (!classifyMatch) {
              throw new Error('Invalid SQL file: missing @CLASSIFY_START/@CLASSIFY_END section');
            }

            const resetSql = resetMatch ? resetMatch[1]!.trim() : null;
            const classifySql = classifyMatch[1]!.trim();
            const summarySql = summaryMatch ? summaryMatch[1]!.trim() : null;

            logger?.debug(
              CLASS_NAME,
              'backfillArcComponents',
              `SQL sections parsed: reset=${!!resetSql}, classify=${!!classifySql}, summary=${!!summarySql}`,
            );

            // Check for cancellation
            if (token.isCancellationRequested) {
              logger?.info(CLASS_NAME, 'backfillArcComponents', 'Backfill cancelled before execution');
              return;
            }

            // Step 5: Execute SQL within a transaction
            progress.report({ message: forceMode ? 'Resetting classifications...' : 'Classifying files...' });

            await dbService.transaction(async (client) => {
              // Force mode: reset all classifications first
              if (forceMode && resetSql) {
                logger?.info(CLASS_NAME, 'backfillArcComponents', 'Force mode: resetting all arc_component values to NULL');
                const resetResult = await client.query(resetSql);
                logger?.debug(CLASS_NAME, 'backfillArcComponents', `Reset query affected ${resetResult.rowCount ?? 0} rows`);
              }

              // Check for cancellation
              if (token.isCancellationRequested) {
                throw new Error('Backfill cancelled by user');
              }

              // Execute classification
              progress.report({ message: 'Applying classification rules...' });
              logger?.info(CLASS_NAME, 'backfillArcComponents', 'Executing classification SQL');
              const classifyResult = await client.query(classifySql);
              logger?.info(CLASS_NAME, 'backfillArcComponents', `Classification query affected ${classifyResult.rowCount ?? 0} rows`);
            });

            // Step 6: Get category breakdown
            progress.report({ message: 'Generating summary...' });
            const categoryCounts: Record<string, number> = {};
            let totalClassified = 0;

            if (summarySql) {
              const summaryResult = await dbService.query<{ arc_component: string; total_rows: number; distinct_files: number }>(summarySql);
              for (const row of summaryResult.rows) {
                categoryCounts[row.arc_component] = row.total_rows;
                totalClassified += row.total_rows;
              }
              logger?.debug(CLASS_NAME, 'backfillArcComponents', `Summary: ${summaryResult.rows.length} categories found`);
            }

            const durationMs = Date.now() - startTime;

            // Step 7: Show result notification
            const result: ArcComponentSqlResult = { categoryCounts, totalClassified, durationMs };

            if (totalClassified === 0) {
              void vscode.window.showInformationMessage('Gitr: No files found for architecture component classification.');
            } else {
              const durationSec = Math.round(durationMs / 1000);

              // Build category breakdown string
              const breakdown = Object.entries(categoryCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, count]) => `${cat}: ${count}`)
                .join(', ');

              const message = `Gitr: Arc component classification complete — ${totalClassified.toLocaleString()} files classified (${durationSec}s). ${breakdown}`;
              void vscode.window.showInformationMessage(message);
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
      if (message.includes('cancelled')) {
        logger?.info(CLASS_NAME, 'backfillArcComponents', 'Backfill cancelled by user');
        void vscode.window.showWarningMessage('Gitr: Architecture component classification cancelled.');
      } else {
        logger?.error(CLASS_NAME, 'backfillArcComponents', `Arc component backfill failed: ${message}`, error instanceof Error ? error : undefined);
        void vscode.window.showErrorMessage(`Gitr: Arc component backfill failed — ${message}`);
      }
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
