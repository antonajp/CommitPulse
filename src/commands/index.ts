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

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'Commands';

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
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Gitr: Running Pipeline',
          cancellable: true,
        },
        async (progress, token) => {
          if (token.isCancellationRequested) {
            logger.info(CLASS_NAME, 'runPipeline', 'Pipeline execution cancelled by user');
            return;
          }

          // Build the pipeline service from current settings and secrets
          const buildResult = await buildPipelineService(secretService, logger);
          if (!buildResult) {
            return; // buildPipelineService already showed error messages
          }

          const { pipelineService, dbService } = buildResult;

          try {
            logger.info(CLASS_NAME, 'runPipeline', 'PipelineService built, starting execution');

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
 * @returns A BuildPipelineResult, or null if configuration is insufficient
 */
async function buildPipelineService(
  secretService: SecretStorageService,
  logger: LoggerService,
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

    const jiraService = new JiraService(jiraConfig, jiraRepo, pipelineRepo, jiraClient);
    const changelogService = new JiraChangelogService(jiraConfig, jiraRepo, pipelineRepo, jiraClient);
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
  const dataEnhancerService = new DataEnhancerService(commitRepo, commitJiraRepo, settings.jira.keyAliases, commitLinearRepo);
  const teamAssignmentService = new TeamAssignmentService(contributorRepo, commitJiraRepo, pipelineRepo);

  // Step 8: Build pipeline config (IQS-931: added sinceDate)
  const configuredSteps = settings.pipeline.steps;
  const validatedSteps = PipelineService.validateSteps(configuredSteps);
  const pipelineConfig = PipelineService.buildConfig(
    validatedSteps,
    settings.jira.increment,
    settings.jira.daysAgo,
    settings.jira.projectKeys,
    settings.jira.keyAliases,
    settings.linear.teamKeys,
    settings.pipeline.sinceDate,
  );

  logger.info(CLASS_NAME, 'buildPipelineService', `Pipeline config: ${pipelineConfig.steps.length} steps, jiraIncrement=${pipelineConfig.jiraIncrement}, jiraDaysAgo=${pipelineConfig.jiraDaysAgo}, linearTeamKeys=${pipelineConfig.linearTeamKeys.length}, sinceDate=${pipelineConfig.sinceDate ?? '(none)'}`);

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
