import * as vscode from 'vscode';
import { LoggerService, parseLogLevel } from './logging/logger.js';
import { registerCommands, isPipelineRunning, executePipelineRun, getSecretService } from './commands/index.js';
import { registerSccBackfillCommand, registerStoryPointsBackfillCommand, registerArcComponentBackfillCommand, registerJiraBackfillCommand } from './commands/backfill-commands.js';
import { resetMigrationCache } from './database/auto-migration.js';
import { ScheduleRunnerService } from './services/schedule-runner-service.js';
import { getSettings } from './config/settings.js';
import { RepoTreeProvider } from './providers/repo-tree-provider.js';
import { ContributorTreeProvider } from './providers/contributor-tree-provider.js';
import type { ContributorSummaryRow } from './providers/contributor-tree-types.js';
import { PipelineRunTreeProvider } from './providers/pipeline-run-tree-provider.js';
import { showPipelineRunLog } from './providers/pipeline-run-utils.js';
import { DashboardPanel } from './views/webview/dashboard-panel.js';
import { LinkagePanel } from './views/webview/linkage-panel.js';
import { VelocityChartPanel } from './views/webview/velocity-chart-panel.js';
import { DevPipelinePanel } from './views/webview/dev-pipeline-panel.js';
import { ReleaseMgmtPanel } from './views/webview/release-mgmt-panel.js';
import { CodeReviewVelocityPanel } from './views/webview/code-review-velocity-panel.js';
import { HotSpotsPanel } from './views/webview/hot-spots-panel.js';
import { KnowledgePanel } from './views/webview/knowledge-panel.js';
import { LifecyclePanel } from './views/webview/lifecycle-panel.js';
import { FocusPanel } from './views/webview/focus-panel.js';
import { CouplingPanel } from './views/webview/coupling-panel.js';
import { ReleaseRiskPanel } from './views/webview/release-risk-panel.js';
import { TestDebtPanel } from './views/webview/test-debt-panel.js';
import { HygienePanel } from './views/webview/hygiene-panel.js';
import { DriftPanel } from './views/webview/drift-panel.js';
import { StoryPointsTrendPanel } from './views/webview/story-points-trend-panel.js';
import { FileAuthorLocPanel } from './views/webview/file-author-loc-panel.js';
import { ComplexityTrendPanel } from './views/webview/complexity-trend-panel.js';
import { DevProfilePanel } from './views/webview/dev-profile-panel.js';
import { TeamProfilePanel } from './views/webview/team-profile-panel.js';
import { JoinDiagnosticPanel } from './views/webview/join-diagnostic-panel.js';
import { OrganizationProfilePanel } from './views/webview/org-profile-panel.js';
import { PRCoveragePanel } from './views/webview/pr-coverage-panel.js';
import { DeadBranchesPanel } from './views/webview/dead-branches-panel.js';
import { ChartTreeProvider } from './providers/chart-tree-provider.js';
import { GitHubPRSyncService } from './services/github-pr-sync-service.js';
import { PRCoverageService } from './services/pr-coverage-service.js';
import type { GitHubPRSyncConfig } from './services/code-review-velocity-types.js';

/**
 * Extension-level disposables for cleanup on deactivation.
 */
const disposables: vscode.Disposable[] = [];

/**
 * Logger instance for the extension lifecycle.
 */
let logger: LoggerService | undefined;

/**
 * Schedule runner service instance for background pipeline execution.
 * Ticket: IQS-865
 */
let scheduleRunner: ScheduleRunnerService | undefined;

/**
 * Repo TreeView provider for displaying configured repositories with stats.
 * Ticket: IQS-866
 */
let repoTreeProvider: RepoTreeProvider | undefined;

/**
 * Contributor TreeView provider for displaying contributors grouped by team.
 * Ticket: IQS-867
 */
let contributorTreeProvider: ContributorTreeProvider | undefined;

/**
 * Pipeline Runs TreeView provider for displaying pipeline run history.
 * Ticket: IQS-868
 */
let pipelineRunTreeProvider: PipelineRunTreeProvider | undefined;

/**
 * Charts TreeView provider for displaying available chart visualizations.
 * Ticket: IQS-886
 */
let chartTreeProvider: ChartTreeProvider | undefined;

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'Extension';

/**
 * Called by VS Code when the extension is activated.
 * Activation triggers are defined in package.json activationEvents.
 *
 * @param context - The extension context provided by VS Code
 */
export function activate(context: vscode.ExtensionContext): void {
  logger = LoggerService.getInstance();
  logger.info(CLASS_NAME, 'activate', 'Gitr extension activating...');

  // Read log level from configuration
  const config = vscode.workspace.getConfiguration('gitrx');
  const configuredLevel = config.get<string>('logLevel', 'INFO');
  logger.setLevel(parseLogLevel(configuredLevel));
  logger.debug(CLASS_NAME, 'activate', `Log level set to: ${configuredLevel}`);

  // Show the output channel so users can see activation logs
  logger.show();

  // Register all commands
  logger.debug(CLASS_NAME, 'activate', 'Registering commands...');
  const commandDisposables = registerCommands(context);
  disposables.push(...commandDisposables);
  logger.debug(CLASS_NAME, 'activate', `Registered ${commandDisposables.length} command(s)`);

  // Register gitrx.fixRepositoryNames command (GITX-168)
  const fixRepositoryNamesDisposable = vscode.commands.registerCommand('gitrx.fixRepositoryNames', async () => {
    logger?.info(CLASS_NAME, 'fixRepositoryNames', 'Command executed: gitrx.fixRepositoryNames');
    await executeFixRepositoryNames();
  });
  disposables.push(fixRepositoryNamesDisposable);

  // Register gitr.toggleSchedule command (IQS-865)
  const toggleScheduleDisposable = vscode.commands.registerCommand('gitr.toggleSchedule', async () => {
    logger?.info(CLASS_NAME, 'toggleSchedule', 'Command executed: gitr.toggleSchedule');
    const currentConfig = vscode.workspace.getConfiguration('gitrx');
    const currentEnabled = currentConfig.get<boolean>('schedule.enabled', false);
    const newEnabled = !currentEnabled;

    await currentConfig.update('schedule.enabled', newEnabled, vscode.ConfigurationTarget.Global);
    const stateLabel = newEnabled ? 'enabled' : 'disabled';
    logger?.info(CLASS_NAME, 'toggleSchedule', `Schedule toggled to: ${stateLabel}`);
    void vscode.window.showInformationMessage(`Gitr: Scheduled pipeline ${stateLabel}`);
  });
  disposables.push(toggleScheduleDisposable);

  // Register Repos TreeView provider (IQS-866)
  initializeRepoTreeView(context);

  // Register Contributors TreeView provider (IQS-867)
  initializeContributorTreeView(context);

  // Register Pipeline Runs TreeView provider (IQS-868)
  initializePipelineRunTreeView(context);

  // Register Metrics Dashboard command (IQS-869)
  initializeDashboardCommand(context);

  // Register Commit-Jira Linkage command (IQS-870)
  initializeLinkageCommand(context);

  // Register SCC Backfill command (IQS-882), Story Points Backfill command (IQS-884),
  // Arc Component Backfill command (GITX-146: simplified to SQL-based), and Jira Backfill command (IQS-933)
  disposables.push(registerSccBackfillCommand(logger));
  disposables.push(registerStoryPointsBackfillCommand(logger));
  disposables.push(registerArcComponentBackfillCommand(logger, context.extensionUri));
  disposables.push(registerJiraBackfillCommand(logger));

  // Register Charts TreeView and Architecture Chart command (IQS-886)
  initializeChartTreeView(context);

  // Listen for configuration changes
  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('gitrx.logLevel')) {
      const newLevel = vscode.workspace
        .getConfiguration('gitrx')
        .get<string>('logLevel', 'INFO');
      logger?.setLevel(parseLogLevel(newLevel));
      logger?.info(CLASS_NAME, 'activate.onDidChangeConfiguration', `Log level changed to: ${newLevel}`);
    }
  });
  disposables.push(configChangeDisposable);

  // Initialize and start the schedule runner if enabled (IQS-865)
  initializeScheduleRunner();

  // Add all disposables to context subscriptions for VS Code-managed cleanup
  for (const disposable of disposables) {
    context.subscriptions.push(disposable);
  }

  logger.info(CLASS_NAME, 'activate', 'Gitr extension activated successfully');
}

/**
 * Initialize the ScheduleRunnerService for background pipeline execution.
 * Auto-starts if gitrx.schedule.enabled is true in settings.
 *
 * Maps from Python GitrScheduleRunner.start_schedule() -> VS Code background timer.
 * Ticket: IQS-865
 */
function initializeScheduleRunner(): void {
  logger?.debug(CLASS_NAME, 'initializeScheduleRunner', 'Initializing schedule runner');

  scheduleRunner = new ScheduleRunnerService();
  disposables.push(scheduleRunner);

  // Wire up mutual exclusion check
  scheduleRunner.setPipelineRunningCheck(() => isPipelineRunning());

  // Wire up pipeline execution callback
  scheduleRunner.setPipelineRunCallback(async () => {
    const secretService = getSecretService();
    if (!secretService) {
      logger?.error(CLASS_NAME, 'scheduledPipelineRun', 'SecretStorageService not available for scheduled run');
      return;
    }
    await executePipelineRun(secretService);
  });

  // Auto-start if schedule is enabled in settings
  const settings = getSettings();
  if (settings.schedule.enabled) {
    logger?.info(CLASS_NAME, 'initializeScheduleRunner', 'Schedule is enabled, auto-starting schedule runner');
    scheduleRunner.start();
  } else {
    logger?.info(CLASS_NAME, 'initializeScheduleRunner', 'Schedule is disabled, schedule runner not started');
    // Still show status bar (will show "Schedule Off")
    scheduleRunner.start(); // start() handles the disabled case gracefully
  }
}

/**
 * Initialize the Repos TreeView provider and register associated commands.
 * Registers:
 *  - gitrx-repos TreeView with RepoTreeProvider
 *  - gitrx.refreshRepos command
 *  - gitrx.runPipelineForRepo context menu command
 *  - gitrx.openRepoInTerminal context menu command
 *
 * Ticket: IQS-866
 */
function initializeRepoTreeView(_context: vscode.ExtensionContext): void {
  logger?.debug(CLASS_NAME, 'initializeRepoTreeView', 'Initializing Repos TreeView');

  const secretService = getSecretService();
  if (!secretService) {
    logger?.warn(CLASS_NAME, 'initializeRepoTreeView', 'SecretStorageService not available yet, deferring TreeView init');
    return;
  }

  repoTreeProvider = new RepoTreeProvider(secretService);
  disposables.push(repoTreeProvider);

  // Register the TreeView with VS Code
  const treeView = vscode.window.createTreeView('gitrx-repos', {
    treeDataProvider: repoTreeProvider,
    showCollapseAll: true,
  });
  disposables.push(treeView);
  logger?.debug(CLASS_NAME, 'initializeRepoTreeView', 'TreeView gitrx-repos registered');

  // gitrx.refreshRepos - Refresh the Repos TreeView
  const refreshDisposable = vscode.commands.registerCommand('gitrx.refreshRepos', () => {
    logger?.info(CLASS_NAME, 'refreshRepos', 'Command executed: gitrx.refreshRepos');
    repoTreeProvider?.refresh();
  });
  disposables.push(refreshDisposable);

  // gitrx.runPipelineForRepo - Run Git extraction for a specific repository (context menu)
  // GITX-130: Now properly filters to the selected repository
  const runForRepoDisposable = vscode.commands.registerCommand(
    'gitrx.runPipelineForRepo',
    async (item: { nodeData?: { repository?: string } }) => {
      const repoName = item?.nodeData?.repository;
      logger?.info(CLASS_NAME, 'runPipelineForRepo', `Command executed for repo: ${repoName ?? 'unknown'}`);

      if (!repoName) {
        logger?.warn(CLASS_NAME, 'runPipelineForRepo', 'No repository context available');
        void vscode.window.showWarningMessage('Gitr: No repository selected.');
        return;
      }

      // Validate repository exists in settings
      const settings = getSettings();
      const targetRepo = settings.repositories.find((r) => r.name === repoName);
      if (!targetRepo) {
        logger?.warn(CLASS_NAME, 'runPipelineForRepo', `Repository not found in settings: ${repoName}`);
        void vscode.window.showWarningMessage(`Gitr: Repository "${repoName}" not found in settings.`);
        return;
      }

      // Check if pipeline is already running
      if (isPipelineRunning()) {
        logger?.warn(CLASS_NAME, 'runPipelineForRepo', 'Pipeline already running');
        void vscode.window.showWarningMessage('Gitr: A pipeline run is already in progress. Please wait for it to complete.');
        return;
      }

      // Execute the per-repository extraction command with the repo name
      // This delegates to a new command that handles the extraction mode QuickPick
      await vscode.commands.executeCommand('gitr.runGitExtractionForRepo', repoName);
    },
  );
  disposables.push(runForRepoDisposable);

  // gitrx.openRepoInTerminal - Open a terminal at the repo path (context menu)
  const openTerminalDisposable = vscode.commands.registerCommand(
    'gitrx.openRepoInTerminal',
    async (item: { nodeData?: { repository?: string } }) => {
      const repoName = item?.nodeData?.repository;
      logger?.info(CLASS_NAME, 'openRepoInTerminal', `Command executed: gitrx.openRepoInTerminal for ${repoName ?? 'unknown'}`);

      if (!repoName) {
        logger?.warn(CLASS_NAME, 'openRepoInTerminal', 'No repository context available');
        void vscode.window.showWarningMessage('Gitr: No repository selected.');
        return;
      }

      // Look up the repository path from settings
      const settings = getSettings();
      const repoEntry = settings.repositories.find((r) => r.name === repoName);
      if (!repoEntry) {
        logger?.warn(CLASS_NAME, 'openRepoInTerminal', `Repository not found in settings: ${repoName}`);
        void vscode.window.showWarningMessage(`Gitr: Repository "${repoName}" not found in settings.`);
        return;
      }

      // GITX-130: Validate repository path for security before opening terminal
      const { validateRepositoryPath } = await import('./utils/repository-path-validator.js');
      const validation = validateRepositoryPath(repoEntry.path, settings.repositories);
      if (!validation.isValid) {
        logger?.error(CLASS_NAME, 'openRepoInTerminal', `Security: Invalid repository path for ${repoName}: ${validation.reason}`);
        void vscode.window.showErrorMessage(`Gitr: Security error - repository path is invalid: ${validation.reason}`);
        return;
      }

      logger?.debug(CLASS_NAME, 'openRepoInTerminal', `Opening terminal at: ${validation.canonicalPath}`);
      const terminal = vscode.window.createTerminal({
        name: `Gitr: ${repoName}`,
        cwd: validation.canonicalPath,
      });
      terminal.show();
    },
  );
  disposables.push(openTerminalDisposable);

  logger?.info(CLASS_NAME, 'initializeRepoTreeView', 'Repos TreeView and commands registered successfully');
}

/**
 * Initialize the Contributors/Teams TreeView provider and register associated commands.
 * Registers:
 *  - gitrx-contributors TreeView with ContributorTreeProvider
 *  - gitrx.refreshContributors command
 *  - gitrx.toggleContributorView command
 *  - gitrx.showContributorDetail command
 *
 * Ticket: IQS-867
 */
function initializeContributorTreeView(_context: vscode.ExtensionContext): void {
  logger?.debug(CLASS_NAME, 'initializeContributorTreeView', 'Initializing Contributors TreeView');

  const secretService = getSecretService();
  if (!secretService) {
    logger?.warn(CLASS_NAME, 'initializeContributorTreeView', 'SecretStorageService not available yet, deferring Contributors TreeView init');
    return;
  }

  contributorTreeProvider = new ContributorTreeProvider(secretService);
  disposables.push(contributorTreeProvider);

  // Register the TreeView with VS Code
  const treeView = vscode.window.createTreeView('gitrx-contributors', {
    treeDataProvider: contributorTreeProvider,
    showCollapseAll: true,
  });
  disposables.push(treeView);
  logger?.debug(CLASS_NAME, 'initializeContributorTreeView', 'TreeView gitrx-contributors registered');

  // gitrx.refreshContributors - Refresh the Contributors TreeView
  const refreshDisposable = vscode.commands.registerCommand('gitrx.refreshContributors', () => {
    logger?.info(CLASS_NAME, 'refreshContributors', 'Command executed: gitrx.refreshContributors');
    contributorTreeProvider?.refresh();
  });
  disposables.push(refreshDisposable);

  // gitrx.toggleContributorView - Toggle between grouped and flat view
  const toggleDisposable = vscode.commands.registerCommand('gitrx.toggleContributorView', () => {
    logger?.info(CLASS_NAME, 'toggleContributorView', 'Command executed: gitrx.toggleContributorView');
    if (contributorTreeProvider) {
      const newMode = contributorTreeProvider.toggleViewMode();
      void vscode.window.showInformationMessage(`Gitr: Contributors view set to ${newMode}`);
    }
  });
  disposables.push(toggleDisposable);

  // gitrx.showContributorDetail - Show contributor details in output channel on click
  const showDetailDisposable = vscode.commands.registerCommand(
    'gitrx.showContributorDetail',
    (contributor: ContributorSummaryRow) => {
      if (!contributor) {
        logger?.warn(CLASS_NAME, 'showContributorDetail', 'No contributor data provided');
        return;
      }

      const displayName = contributor.fullName ?? contributor.logins;
      logger?.info(CLASS_NAME, 'showContributorDetail', `Showing details for: ${displayName}`);

      // Format details for the output channel
      const lines = [
        '='.repeat(60),
        `Contributor: ${displayName}`,
        '='.repeat(60),
        `Full Name:    ${contributor.fullName ?? 'N/A'}`,
        `Logins:       ${contributor.logins}`,
        `Vendor:       ${contributor.vendor ?? 'Unknown'}`,
        `Team:         ${contributor.team ?? 'Unassigned'}`,
        `Commits:      ${contributor.commitCount.toLocaleString()}`,
        `Repositories: ${contributor.repoList ?? 'None'}`,
        '='.repeat(60),
      ];

      // Write to the Gitr output channel
      for (const line of lines) {
        logger?.info('ContributorDetail', displayName, line);
      }

      // Show the output channel so the user can see it
      logger?.show();
    },
  );
  disposables.push(showDetailDisposable);

  logger?.info(CLASS_NAME, 'initializeContributorTreeView', 'Contributors TreeView and commands registered successfully');
}

/**
 * Initialize the Pipeline Runs TreeView provider and register associated commands.
 * Registers:
 *  - gitrx-pipeline-runs TreeView with PipelineRunTreeProvider
 *  - gitrx.refreshPipelineRuns command
 *  - gitrx.showPipelineRunLog command (click on run -> show log in output channel)
 *
 * Ticket: IQS-868
 */
function initializePipelineRunTreeView(_context: vscode.ExtensionContext): void {
  logger?.debug(CLASS_NAME, 'initializePipelineRunTreeView', 'Initializing Pipeline Runs TreeView');

  const secretService = getSecretService();
  if (!secretService) {
    logger?.warn(CLASS_NAME, 'initializePipelineRunTreeView', 'SecretStorageService not available yet, deferring Pipeline Runs TreeView init');
    return;
  }

  pipelineRunTreeProvider = new PipelineRunTreeProvider(secretService);
  disposables.push(pipelineRunTreeProvider);

  // Register the TreeView with VS Code
  const treeView = vscode.window.createTreeView('gitrx-pipeline-runs', {
    treeDataProvider: pipelineRunTreeProvider,
    showCollapseAll: true,
  });
  disposables.push(treeView);
  logger?.debug(CLASS_NAME, 'initializePipelineRunTreeView', 'TreeView gitrx-pipeline-runs registered');

  // gitrx.refreshPipelineRuns - Refresh the Pipeline Runs TreeView
  const refreshDisposable = vscode.commands.registerCommand('gitrx.refreshPipelineRuns', () => {
    logger?.info(CLASS_NAME, 'refreshPipelineRuns', 'Command executed: gitrx.refreshPipelineRuns');
    pipelineRunTreeProvider?.refresh();
  });
  disposables.push(refreshDisposable);

  // gitrx.showPipelineRunLog - Show pipeline run log in output channel on click
  const showLogDisposable = vscode.commands.registerCommand(
    'gitrx.showPipelineRunLog',
    async (pipelineRunId: number) => {
      if (typeof pipelineRunId !== 'number' || !pipelineRunId) {
        logger?.warn(CLASS_NAME, 'showPipelineRunLog', 'No pipeline run ID provided');
        return;
      }

      logger?.info(CLASS_NAME, 'showPipelineRunLog', `Command executed: gitrx.showPipelineRunLog for run #${pipelineRunId}`);
      await showPipelineRunLog(pipelineRunId, secretService);
    },
  );
  disposables.push(showLogDisposable);

  logger?.info(CLASS_NAME, 'initializePipelineRunTreeView', 'Pipeline Runs TreeView and commands registered successfully');
}

/**
 * Initialize the Metrics Dashboard command.
 * Registers:
 *  - gitrx.openDashboard command that opens a webview panel
 *
 * Ticket: IQS-869
 */
function initializeDashboardCommand(context: vscode.ExtensionContext): void {
  logger?.debug(CLASS_NAME, 'initializeDashboardCommand', 'Registering Metrics Dashboard command');

  const openDashboardDisposable = vscode.commands.registerCommand('gitrx.openDashboard', () => {
    logger?.info(CLASS_NAME, 'openDashboard', 'Command executed: gitrx.openDashboard');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openDashboard', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    DashboardPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openDashboardDisposable);

  logger?.info(CLASS_NAME, 'initializeDashboardCommand', 'Metrics Dashboard command registered');
}

/**
 * Initialize the Commit-Jira Linkage command.
 * Registers:
 *  - gitrx.openLinkageView command that opens a webview panel
 *
 * Ticket: IQS-870
 */
function initializeLinkageCommand(context: vscode.ExtensionContext): void {
  logger?.debug(CLASS_NAME, 'initializeLinkageCommand', 'Registering Commit-Jira Linkage command');

  const openLinkageDisposable = vscode.commands.registerCommand('gitrx.openLinkageView', () => {
    logger?.info(CLASS_NAME, 'openLinkageView', 'Command executed: gitrx.openLinkageView');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openLinkageView', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    LinkagePanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openLinkageDisposable);

  logger?.info(CLASS_NAME, 'initializeLinkageCommand', 'Commit-Jira Linkage command registered');
}

/**
 * Initialize the Charts TreeView provider and register associated commands.
 * Registers:
 *  - gitrx-charts TreeView with ChartTreeProvider
 *  - gitrx.refreshCharts command
 *  - gitrx.openSprintVelocityChart command
 *
 * Ticket: IQS-886
 */
function initializeChartTreeView(context: vscode.ExtensionContext): void {
  logger?.debug(CLASS_NAME, 'initializeChartTreeView', 'Initializing Charts TreeView');

  chartTreeProvider = new ChartTreeProvider();
  disposables.push(chartTreeProvider);

  // Register the TreeView with VS Code
  const treeView = vscode.window.createTreeView('gitrx-charts', {
    treeDataProvider: chartTreeProvider,
    showCollapseAll: true,
  });
  disposables.push(treeView);
  logger?.debug(CLASS_NAME, 'initializeChartTreeView', 'TreeView gitrx-charts registered');

  // gitrx.refreshCharts - Refresh the Charts TreeView
  const refreshDisposable = vscode.commands.registerCommand('gitrx.refreshCharts', () => {
    logger?.info(CLASS_NAME, 'refreshCharts', 'Command executed: gitrx.refreshCharts');
    chartTreeProvider?.refresh();
  });
  disposables.push(refreshDisposable);

  // gitrx.openSprintVelocityChart - Open the Sprint Velocity vs LOC chart (IQS-888)
  const openVelocityChartDisposable = vscode.commands.registerCommand('gitrx.openSprintVelocityChart', () => {
    logger?.info(CLASS_NAME, 'openSprintVelocityChart', 'Command executed: gitrx.openSprintVelocityChart');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openSprintVelocityChart', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    VelocityChartPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openVelocityChartDisposable);

  // gitrx.openDevPipeline - Open the Development Pipeline dashboard (IQS-897)
  const openDevPipelineDisposable = vscode.commands.registerCommand('gitrx.openDevPipeline', () => {
    logger?.info(CLASS_NAME, 'openDevPipeline', 'Command executed: gitrx.openDevPipeline');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openDevPipeline', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    DevPipelinePanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openDevPipelineDisposable);

  // gitrx.openReleaseMgmtChart - Open the Release Management Contributions chart (IQS-898)
  const openReleaseMgmtDisposable = vscode.commands.registerCommand('gitrx.openReleaseMgmtChart', () => {
    logger?.info(CLASS_NAME, 'openReleaseMgmtChart', 'Command executed: gitrx.openReleaseMgmtChart');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openReleaseMgmtChart', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    ReleaseMgmtPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openReleaseMgmtDisposable);

  // gitrx.openCodeReviewVelocity - Open the Code Review Velocity dashboard (IQS-900)
  const openCodeReviewVelocityDisposable = vscode.commands.registerCommand('gitrx.openCodeReviewVelocity', () => {
    logger?.info(CLASS_NAME, 'openCodeReviewVelocity', 'Command executed: gitrx.openCodeReviewVelocity');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openCodeReviewVelocity', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    CodeReviewVelocityPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openCodeReviewVelocityDisposable);

  // gitrx.openHotSpots - Open the Hot Spots dashboard (IQS-902)
  const openHotSpotsDisposable = vscode.commands.registerCommand('gitrx.openHotSpots', () => {
    logger?.info(CLASS_NAME, 'openHotSpots', 'Command executed: gitrx.openHotSpots');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openHotSpots', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    HotSpotsPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openHotSpotsDisposable);

  // gitrx.openKnowledgeConcentration - Open the Knowledge Concentration dashboard (IQS-904)
  const openKnowledgeDisposable = vscode.commands.registerCommand('gitrx.openKnowledgeConcentration', () => {
    logger?.info(CLASS_NAME, 'openKnowledgeConcentration', 'Command executed: gitrx.openKnowledgeConcentration');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openKnowledgeConcentration', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    KnowledgePanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openKnowledgeDisposable);

  // gitrx.openTicketLifecycle - Open the Ticket Lifecycle dashboard (IQS-906)
  const openLifecycleDisposable = vscode.commands.registerCommand('gitrx.openTicketLifecycle', () => {
    logger?.info(CLASS_NAME, 'openTicketLifecycle', 'Command executed: gitrx.openTicketLifecycle');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openTicketLifecycle', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    LifecyclePanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openLifecycleDisposable);

  // gitrx.openDeveloperFocus - Open the Developer Focus Score dashboard (IQS-908)
  const openDeveloperFocusDisposable = vscode.commands.registerCommand('gitrx.openDeveloperFocus', () => {
    logger?.info(CLASS_NAME, 'openDeveloperFocus', 'Command executed: gitrx.openDeveloperFocus');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openDeveloperFocus', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    FocusPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openDeveloperFocusDisposable);

  // gitrx.openTeamCoupling - Open the Cross-Team Coupling dashboard (IQS-910)
  const openTeamCouplingDisposable = vscode.commands.registerCommand('gitrx.openTeamCoupling', () => {
    logger?.info(CLASS_NAME, 'openTeamCoupling', 'Command executed: gitrx.openTeamCoupling');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openTeamCoupling', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    CouplingPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openTeamCouplingDisposable);

  // gitrx.openReleaseRisk - Open the Release Risk Gauge dashboard (IQS-912)
  const openReleaseRiskDisposable = vscode.commands.registerCommand('gitrx.openReleaseRisk', () => {
    logger?.info(CLASS_NAME, 'openReleaseRisk', 'Command executed: gitrx.openReleaseRisk');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openReleaseRisk', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    ReleaseRiskPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openReleaseRiskDisposable);

  // gitrx.openTestDebt - Open the Test Debt Predictor dashboard (IQS-914)
  const openTestDebtDisposable = vscode.commands.registerCommand('gitrx.openTestDebt', () => {
    logger?.info(CLASS_NAME, 'openTestDebt', 'Command executed: gitrx.openTestDebt');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openTestDebt', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    TestDebtPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openTestDebtDisposable);

  // gitrx.openCommitHygiene - Open the Commit Hygiene Tracker dashboard (IQS-916)
  const openCommitHygieneDisposable = vscode.commands.registerCommand('gitrx.openCommitHygiene', () => {
    logger?.info(CLASS_NAME, 'openCommitHygiene', 'Command executed: gitrx.openCommitHygiene');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openCommitHygiene', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    HygienePanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openCommitHygieneDisposable);

  // gitrx.openArchitectureDrift - Open the Architecture Drift Heat Map dashboard (IQS-918)
  const openArchitectureDriftDisposable = vscode.commands.registerCommand('gitrx.openArchitectureDrift', () => {
    logger?.info(CLASS_NAME, 'openArchitectureDrift', 'Command executed: gitrx.openArchitectureDrift');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openArchitectureDrift', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    DriftPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openArchitectureDriftDisposable);

  // gitrx.openStoryPointsTrend - Open the Story Points Trend chart (IQS-940)
  const openStoryPointsTrendDisposable = vscode.commands.registerCommand('gitrx.openStoryPointsTrend', () => {
    logger?.info(CLASS_NAME, 'openStoryPointsTrend', 'Command executed: gitrx.openStoryPointsTrend');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openStoryPointsTrend', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    StoryPointsTrendPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openStoryPointsTrendDisposable);

  // gitrx.openFileContributionReport - Open the File Author LOC Contribution Report (GITX-128)
  const openFileContributionReportDisposable = vscode.commands.registerCommand('gitrx.openFileContributionReport', () => {
    logger?.info(CLASS_NAME, 'openFileContributionReport', 'Command executed: gitrx.openFileContributionReport');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openFileContributionReport', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    FileAuthorLocPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openFileContributionReportDisposable);

  // gitrx.openComplexityTrend - Open the Complexity Trend chart (GITX-133)
  const openComplexityTrendDisposable = vscode.commands.registerCommand('gitrx.openComplexityTrend', () => {
    logger?.info(CLASS_NAME, 'openComplexityTrend', 'Command executed: gitrx.openComplexityTrend');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openComplexityTrend', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    ComplexityTrendPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openComplexityTrendDisposable);

  // gitrx.openDeveloperProfile - Open the Developer Profile dashboard (GITX-155, GITX-195)
  // GITX-195: Always creates a new panel for multi-instance side-by-side comparison
  const openDevProfileDisposable = vscode.commands.registerCommand('gitrx.openDeveloperProfile', (developer?: string) => {
    logger?.info(CLASS_NAME, 'openDeveloperProfile', `Command executed: gitrx.openDeveloperProfile${developer ? ` for ${developer}` : ''}`);

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openDeveloperProfile', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    // GITX-195: Use create() instead of createOrShow() for multi-instance support
    DevProfilePanel.create(context.extensionUri, secretService, developer);
  });
  disposables.push(openDevProfileDisposable);

  // gitrx.openTeamProfile - Open the Team Profile dashboard (GITX-185)
  const openTeamProfileDisposable = vscode.commands.registerCommand('gitrx.openTeamProfile', (team?: string) => {
    logger?.info(CLASS_NAME, 'openTeamProfile', `Command executed: gitrx.openTeamProfile${team ? ` for team ${team}` : ''}`);

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openTeamProfile', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    // GITX-196: Use create() instead of createOrShow() for multi-instance support
    TeamProfilePanel.create(context.extensionUri, secretService, team);
  });
  disposables.push(openTeamProfileDisposable);

  // gitrx.openJoinDiagnostic - Open the Join Diagnostics panel (GITX-183)
  const openJoinDiagnosticDisposable = vscode.commands.registerCommand('gitrx.openJoinDiagnostic', () => {
    logger?.info(CLASS_NAME, 'openJoinDiagnostic', 'Command executed: gitrx.openJoinDiagnostic');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openJoinDiagnostic', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    JoinDiagnosticPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openJoinDiagnosticDisposable);

  // gitrx.openOrganizationProfile - Open the Organization Profile dashboard (GITX-205)
  const openOrgProfileDisposable = vscode.commands.registerCommand('gitrx.openOrganizationProfile', (organization?: string) => {
    logger?.info(CLASS_NAME, 'openOrganizationProfile', `Command executed: gitrx.openOrganizationProfile${organization ? ` for ${organization}` : ''}`);

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openOrganizationProfile', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    OrganizationProfilePanel.createOrShow(context.extensionUri, secretService, organization);
  });
  disposables.push(openOrgProfileDisposable);

  // gitrx.openPRCoverageDashboard - Open the PR Coverage Report dashboard (GITX-221)
  const openPRCoverageDisposable = vscode.commands.registerCommand('gitrx.openPRCoverageDashboard', () => {
    logger?.info(CLASS_NAME, 'openPRCoverageDashboard', 'Command executed: gitrx.openPRCoverageDashboard');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'openPRCoverageDashboard', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    PRCoveragePanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(openPRCoverageDisposable);

  // gitrx.analyzeBranches - Open the Dead Branches Analysis panel (GITX-231)
  const analyzeBranchesDisposable = vscode.commands.registerCommand('gitrx.analyzeBranches', () => {
    logger?.info(CLASS_NAME, 'analyzeBranches', 'Command executed: gitrx.analyzeBranches');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'analyzeBranches', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    DeadBranchesPanel.createOrShow(context.extensionUri, secretService);
  });
  disposables.push(analyzeBranchesDisposable);

  // gitr.syncPRs - Sync Pull Requests for all configured repositories (GITX-228: provider-agnostic)
  const syncPRsHandler = async (): Promise<void> => {
    logger?.info(CLASS_NAME, 'syncPRs', 'Command executed: gitr.syncPRs');

    const secretService = getSecretService();
    if (!secretService) {
      logger?.warn(CLASS_NAME, 'syncPRs', 'SecretStorageService not available');
      void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Syncing Pull Requests',
        cancellable: true,
      },
      async (progress, token) => {
        try {
          // Check for cancellation
          if (token.isCancellationRequested) {
            logger?.info(CLASS_NAME, 'syncPRs', 'PR sync cancelled by user');
            return;
          }

          // Get repository configurations from settings
          const settings = getSettings();
          if (settings.repositories.length === 0) {
            void vscode.window.showInformationMessage('Gitr: No repositories configured. Add repositories in settings first.');
            logger?.warn(CLASS_NAME, 'syncPRs', 'No repositories configured');
            return;
          }

          // Helper: Detect provider from repoUrl
          type Provider = 'github' | 'bitbucket' | 'unknown';
          const detectProviderFromUrl = (url: string): Provider => {
            if (/github\.com/i.test(url)) return 'github';
            if (/bitbucket\.org/i.test(url)) return 'bitbucket';
            if (/bitbucket\./i.test(url)) return 'bitbucket'; // BitBucket Server
            return 'unknown';
          };

          // Helper: Parse GitHub URL
          const parseGitHubUrl = (url: string): { owner: string; repo: string } | null => {
            const match = url.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/);
            if (!match || !match[1] || !match[2]) return null;
            return { owner: match[1], repo: match[2] };
          };

          // Helper: Parse BitBucket Cloud URL (https://bitbucket.org/{workspace}/{repo})
          const parseBitBucketCloudUrl = (url: string): { workspace: string; repo: string } | null => {
            const match = url.match(/bitbucket\.org\/([^/]+)\/([^/.]+)/i);
            if (!match || !match[1] || !match[2]) return null;
            return { workspace: match[1], repo: match[2] };
          };

          // Helper: Parse BitBucket Server URL
          // Patterns: https://{domain}/projects/{project}/repos/{repo}
          //           https://{domain}/scm/{project}/{repo}
          const parseBitBucketServerUrl = (url: string): { project: string; repo: string; domain: string } | null => {
            const projectMatch = url.match(/([^/]+)\/projects\/([^/]+)\/repos\/([^/.]+)/i);
            if (projectMatch && projectMatch[1] && projectMatch[2] && projectMatch[3]) {
              return { domain: projectMatch[1], project: projectMatch[2], repo: projectMatch[3] };
            }
            const scmMatch = url.match(/([^/]+)\/scm\/([^/]+)\/([^/.]+)/i);
            if (scmMatch && scmMatch[1] && scmMatch[2] && scmMatch[3]) {
              return { domain: scmMatch[1], project: scmMatch[2], repo: scmMatch[3] };
            }
            return null;
          };

          // Group repositories by provider
          const githubRepos: Array<(typeof settings.repositories)[number]> = [];
          const bitbucketRepos: Array<(typeof settings.repositories)[number]> = [];
          const unknownRepos: Array<(typeof settings.repositories)[number]> = [];

          for (const repo of settings.repositories) {
            if (!repo.repoUrl) {
              logger?.warn(CLASS_NAME, 'syncPRs', `Skipping repository "${repo.name}" - no repoUrl configured`);
              continue;
            }
            const provider = detectProviderFromUrl(repo.repoUrl);
            if (provider === 'github') githubRepos.push(repo);
            else if (provider === 'bitbucket') bitbucketRepos.push(repo);
            else unknownRepos.push(repo);
          }

          // Log unknown providers
          if (unknownRepos.length > 0) {
            const names = unknownRepos.map((r) => r.name).join(', ');
            logger?.warn(CLASS_NAME, 'syncPRs', `Unknown provider for repositories: ${names}`);
            void vscode.window.showWarningMessage(
              `Gitr: Cannot determine provider for ${unknownRepos.length} repositories. Supported: GitHub, BitBucket.`,
            );
          }

          if (githubRepos.length === 0 && bitbucketRepos.length === 0) {
            void vscode.window.showWarningMessage('Gitr: No valid GitHub or BitBucket repositories found.');
            logger?.warn(CLASS_NAME, 'syncPRs', 'No valid repositories to sync');
            return;
          }

          logger?.info(CLASS_NAME, 'syncPRs', `Found ${githubRepos.length} GitHub + ${bitbucketRepos.length} BitBucket repositories`);
          progress.report({ message: `Syncing ${githubRepos.length} GitHub + ${bitbucketRepos.length} BitBucket repositories...` });

          // Get database connection
          const dbPassword = await secretService.getDatabasePassword();
          if (!dbPassword) {
            void vscode.window.showErrorMessage('Gitr: Database password not set. Use "Gitr: Set Database Password" command first.');
            logger?.warn(CLASS_NAME, 'syncPRs', 'Database password not configured');
            return;
          }

          // Import database service
          const { DatabaseService, buildConfigFromSettings } = await import('./database/database-service.js');
          const dbService = new DatabaseService();
          const dbConfig = buildConfigFromSettings(settings.database, dbPassword);

          try {
            // Connect to database
            await dbService.initialize(dbConfig);

            let totalPRs = 0;
            let totalReviews = 0;

            // --- Sync GitHub repositories ---
            if (githubRepos.length > 0) {
              const githubToken = await secretService.getGitHubToken();
              if (!githubToken) {
                void vscode.window.showWarningMessage(
                  'Gitr: GitHub token not set. GitHub repositories will be skipped. Use "Gitr: Set GitHub Token" to configure.',
                );
                logger?.warn(CLASS_NAME, 'syncPRs', 'GitHub token not configured');
              } else {
                progress.report({ message: `Syncing ${githubRepos.length} GitHub repositories...` });

                // Build GitHubPRSyncConfig array
                const githubConfigs: GitHubPRSyncConfig[] = [];
                for (const repo of githubRepos) {
                  const parsed = parseGitHubUrl(repo.repoUrl!);
                  if (!parsed) {
                    logger?.warn(CLASS_NAME, 'syncPRs', `Skipping GitHub repo "${repo.name}" - unable to parse URL`);
                    continue;
                  }

                  const prCoverageConfig = vscode.workspace.getConfiguration('gitrx.prCoverage');
                  const syncDaysBack = prCoverageConfig.get<number>('sinceDays', 90);

                  githubConfigs.push({
                    owner: parsed.owner,
                    repo: parsed.repo,
                    token: githubToken,
                    syncDaysBack,
                  });
                }

                if (githubConfigs.length > 0) {
                  // Check if pull_request table exists
                  const prSyncService = new GitHubPRSyncService(githubToken, dbService);
                  const tableExists = await prSyncService.checkTableExists();
                  if (!tableExists) {
                    void vscode.window.showErrorMessage(
                      'Gitr: pull_request table not found. Run "Gitr: Run Database Migrations" to create the required schema.',
                    );
                    logger?.error(CLASS_NAME, 'syncPRs', 'pull_request table does not exist - migration 012 not applied');
                    return;
                  }

                  // Sync all GitHub repositories
                  const githubResult = await prSyncService.syncAllRepositories(githubConfigs);
                  totalPRs += githubResult.totalPRs;
                  totalReviews += githubResult.totalReviews;

                  logger?.info(
                    CLASS_NAME,
                    'syncPRs',
                    `GitHub sync complete: ${githubResult.totalPRs} PRs, ${githubResult.totalReviews} reviews in ${githubResult.totalDurationMs}ms`,
                  );
                }
              }
            }

            // --- Sync BitBucket repositories ---
            if (bitbucketRepos.length > 0) {
              const bitbucketToken = await secretService.getBitbucketToken();
              if (!bitbucketToken) {
                void vscode.window.showWarningMessage(
                  'Gitr: BitBucket token not set. BitBucket repositories will be skipped. Use "Gitr: Set Bitbucket Access Token" to configure.',
                );
                logger?.warn(CLASS_NAME, 'syncPRs', 'BitBucket token not configured');
              } else {
                progress.report({ message: `Syncing ${bitbucketRepos.length} BitBucket repositories...` });

                // Build BitBucket configs
                const bitbucketConfigs: Array<{ workspace?: string; project?: string; repo: string; domain?: string }> = [];
                for (const repo of bitbucketRepos) {
                  const cloudParsed = parseBitBucketCloudUrl(repo.repoUrl!);
                  const serverParsed = parseBitBucketServerUrl(repo.repoUrl!);

                  if (cloudParsed) {
                    bitbucketConfigs.push({ workspace: cloudParsed.workspace, repo: cloudParsed.repo });
                  } else if (serverParsed) {
                    bitbucketConfigs.push({
                      project: serverParsed.project,
                      repo: serverParsed.repo,
                      domain: serverParsed.domain,
                    });
                  } else {
                    logger?.warn(CLASS_NAME, 'syncPRs', `Skipping BitBucket repo "${repo.name}" - unable to parse URL`);
                  }
                }

                if (bitbucketConfigs.length > 0) {
                  // Import and instantiate BitBucket PR sync service
                  const { BitBucketPRSyncService } = await import('./services/bitbucket-pr-sync-service.js');
                  const bitbucketService = new BitBucketPRSyncService(dbService);

                  // Check if pull_request table exists
                  const tableExists = await bitbucketService.checkTableExists();
                  if (!tableExists) {
                    void vscode.window.showErrorMessage(
                      'Gitr: pull_request table not found. Run "Gitr: Run Database Migrations" to create the required schema.',
                    );
                    logger?.error(CLASS_NAME, 'syncPRs', 'pull_request table does not exist for BitBucket sync');
                  } else {
                    // Build BitBucketPRSyncConfig array
                    const prCoverageConfig = vscode.workspace.getConfiguration('gitrx.prCoverage');
                    const syncDaysBack = prCoverageConfig.get<number>('sinceDays', 90);

                    // Get BitBucket Cloud username from settings (GITX-229)
                    const bitbucketConfig = vscode.workspace.getConfiguration('gitrx.bitbucket');
                    const bitbucketUsername = bitbucketConfig.get<string>('username', '');

                    // Check if any Cloud repos exist and username is not configured
                    const hasCloudRepos = bitbucketConfigs.some((c) => c.workspace !== undefined);
                    if (hasCloudRepos && !bitbucketUsername) {
                      void vscode.window.showErrorMessage(
                        'Gitr: BitBucket Cloud username not configured. Set "gitrx.bitbucket.username" to your Atlassian account email.',
                      );
                      logger?.error(
                        CLASS_NAME,
                        'syncPRs',
                        'BitBucket Cloud repos found but username not configured. Set gitrx.bitbucket.username setting.',
                      );
                    }

                    // GITX-229: Validate username is email format for Cloud repos (not workspace name)
                    if (hasCloudRepos && bitbucketUsername && !bitbucketUsername.includes('@')) {
                      void vscode.window.showErrorMessage(
                        'Gitr: BitBucket username must be an email address (your Atlassian account email), not a workspace name.',
                      );
                      logger?.error(
                        CLASS_NAME,
                        'syncPRs',
                        'Invalid BitBucket username format (must be email, not workspace name)',
                      );
                    }

                    // Use inline type import for BitBucketPRSyncConfig
                    type BitBucketPRSyncConfigType = import('./services/code-review-velocity-types.js').BitBucketPRSyncConfig;
                    const bbSyncConfigs: BitBucketPRSyncConfigType[] = [];

                    for (const config of bitbucketConfigs) {
                      if (config.workspace) {
                        // BitBucket Cloud - skip if no username configured (GITX-229)
                        if (!bitbucketUsername) {
                          logger?.warn(
                            CLASS_NAME,
                            'syncPRs',
                            `Skipping BitBucket Cloud repo "${config.repo}" - username not configured`,
                          );
                          continue;
                        }
                        bbSyncConfigs.push({
                          workspace: config.workspace,
                          repoSlug: config.repo,
                          token: bitbucketToken,
                          syncDaysBack,
                          variant: 'cloud',
                          // GITX-229: Use username from settings (Atlassian email), not workspace name
                          username: bitbucketUsername,
                        });
                      } else if (config.project && config.domain) {
                        // BitBucket Server
                        bbSyncConfigs.push({
                          workspace: config.project,
                          repoSlug: config.repo,
                          token: bitbucketToken,
                          syncDaysBack,
                          variant: 'server',
                          serverUrl: `https://${config.domain}`,
                        });
                      }
                    }

                    // Sync all BitBucket repositories
                    const bitbucketResult = await bitbucketService.syncAllRepositories(bbSyncConfigs);
                    totalPRs += bitbucketResult.totalPRs;
                    totalReviews += bitbucketResult.totalReviews;

                    logger?.info(
                      CLASS_NAME,
                      'syncPRs',
                      `BitBucket sync complete: ${bitbucketResult.totalPRs} PRs, ${bitbucketResult.totalReviews} reviews`,
                    );
                  }
                }
              }
            }

            // Check for cancellation
            if (token.isCancellationRequested) {
              logger?.info(CLASS_NAME, 'syncPRs', 'PR sync cancelled by user after sync');
              return;
            }

            // Sync commit-PR links from merge_sha
            progress.report({ message: 'Correlating PRs with commits...' });
            const prCoverageService = new PRCoverageService(dbService);
            const linksCreated = await prCoverageService.syncCoverageFromMergeSha();

            logger?.info(CLASS_NAME, 'syncPRs', `Created ${linksCreated} commit-PR links from merge_sha correlation`);

            // Show success message
            void vscode.window.showInformationMessage(
              `Gitr: Successfully synced ${totalPRs} PRs and ${totalReviews} reviews. Created ${linksCreated} commit-PR links.`,
            );
          } finally {
            await dbService.shutdown();
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          logger?.error(CLASS_NAME, 'syncPRs', `Failed to sync PRs: ${message}`);
          void vscode.window.showErrorMessage(`Gitr: Failed to sync PRs: ${message}`);
        }
      },
    );
  };

  // Register both command IDs to the same handler for backward compatibility
  disposables.push(
    vscode.commands.registerCommand('gitr.syncPRs', syncPRsHandler),
    vscode.commands.registerCommand('gitr.syncGitHubPRs', syncPRsHandler), // Deprecated alias
  );

  logger?.info(CLASS_NAME, 'initializeChartTreeView', 'Charts TreeView and commands registered successfully');
}

/**
 * GITX-168: Execute the Fix Repository Names command.
 * Detects and corrects repository name mismatches in the database.
 * Requires user confirmation before making any corrections.
 */
async function executeFixRepositoryNames(): Promise<void> {
  logger?.info(CLASS_NAME, 'executeFixRepositoryNames', 'Starting repository name mismatch detection');

  const secretService = getSecretService();
  if (!secretService) {
    logger?.warn(CLASS_NAME, 'executeFixRepositoryNames', 'SecretStorageService not available');
    void vscode.window.showWarningMessage('Gitr: Extension not fully initialized. Try again in a moment.');
    return;
  }

  const settings = getSettings();
  if (settings.repositories.length === 0) {
    void vscode.window.showInformationMessage('Gitr: No repositories configured. Add repositories in settings first.');
    return;
  }

  // Import database service
  const { DatabaseService, buildConfigFromSettings } = await import('./database/database-service.js');
  const { CommitRepository } = await import('./database/commit-repository.js');
  const { sanitizeUrlForLogging } = await import('./utils/url-sanitizer.js');

  const password = await secretService.getDatabasePassword();
  if (!password) {
    void vscode.window.showWarningMessage('Gitr: Database password not set. Use "Gitr: Set Database Password" command first.');
    return;
  }

  const dbService = new DatabaseService();
  const dbConfig = buildConfigFromSettings(settings.database, password);

  try {
    // Connect to database
    await dbService.initialize(dbConfig);

    const commitRepo = new CommitRepository(dbService);

    // Collect all mismatches across repositories
    type MismatchInfo = {
      repoName: string;
      repoUrl: string;
      mismatches: Array<{ currentName: string; commitCount: number }>;
    };
    const allMismatches: MismatchInfo[] = [];

    for (const repo of settings.repositories) {
      const repoUrl = repo.repoUrl ?? `https://github.com/unknown/${repo.name}`;
      const sanitizedUrl = sanitizeUrlForLogging(repoUrl);
      const mismatches = await commitRepo.detectRepositoryNameMismatch(repo.name, sanitizedUrl);

      if (mismatches.length > 0) {
        allMismatches.push({
          repoName: repo.name,
          repoUrl: sanitizedUrl,
          mismatches,
        });
      }
    }

    if (allMismatches.length === 0) {
      void vscode.window.showInformationMessage('Gitr: No repository name mismatches found. All repositories are correctly configured.');
      logger?.info(CLASS_NAME, 'executeFixRepositoryNames', 'No mismatches found');
      return;
    }

    // Build confirmation message
    let totalCommits = 0;
    const detailLines: string[] = [];
    for (const info of allMismatches) {
      for (const mismatch of info.mismatches) {
        totalCommits += mismatch.commitCount;
        detailLines.push(`  "${mismatch.currentName}" -> "${info.repoName}" (${mismatch.commitCount} commits)`);
      }
    }

    const confirmMessage =
      `Found ${totalCommits} commits with incorrect repository names:\n\n` +
      detailLines.join('\n') +
      '\n\nThis will update the repository field in commit_history. Continue?';

    logger?.info(CLASS_NAME, 'executeFixRepositoryNames', `Found ${totalCommits} commits with mismatched names`);

    // Show confirmation dialog
    const choice = await vscode.window.showWarningMessage(
      confirmMessage,
      { modal: true },
      'Yes, Fix Names',
      'Cancel',
    );

    if (choice !== 'Yes, Fix Names') {
      logger?.info(CLASS_NAME, 'executeFixRepositoryNames', 'User cancelled repository name fix');
      return;
    }

    // Apply corrections
    let totalUpdated = 0;
    for (const info of allMismatches) {
      for (const mismatch of info.mismatches) {
        const updatedCount = await commitRepo.updateRepositoryName(
          info.repoName,
          mismatch.currentName,
          info.repoUrl,
        );
        totalUpdated += updatedCount;

        // Audit trail logging
        logger?.info(
          CLASS_NAME,
          'executeFixRepositoryNames',
          `AUDIT: Updated ${updatedCount} commits: "${mismatch.currentName}" -> "${info.repoName}" (URL: ${info.repoUrl})`,
        );
      }
    }

    void vscode.window.showInformationMessage(`Gitr: Successfully updated ${totalUpdated} commits with correct repository names.`);
    logger?.info(CLASS_NAME, 'executeFixRepositoryNames', `Completed: ${totalUpdated} commits updated`);

    // Refresh TreeViews to reflect changes
    void vscode.commands.executeCommand('gitrx.refreshRepos');

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error(CLASS_NAME, 'executeFixRepositoryNames', `Failed to fix repository names: ${message}`);
    void vscode.window.showErrorMessage(`Gitr: Failed to fix repository names: ${message}`);
  } finally {
    await dbService.shutdown();
  }
}

/**
 * Called by VS Code when the extension is deactivated.
 * Clean up all resources including the schedule runner.
 */
export function deactivate(): void {
  logger?.info(CLASS_NAME, 'deactivate', 'Gitr extension deactivating...');

  // Reset migration session cache (IQS-879)
  logger?.debug(CLASS_NAME, 'deactivate', 'Resetting migration session cache');
  resetMigrationCache();

  // Stop the schedule runner explicitly before general disposal (IQS-865)
  if (scheduleRunner) {
    logger?.debug(CLASS_NAME, 'deactivate', 'Stopping schedule runner');
    scheduleRunner.stop();
    scheduleRunner = undefined;
  }

  // Clean up the repo tree provider (IQS-866)
  if (repoTreeProvider) {
    logger?.debug(CLASS_NAME, 'deactivate', 'Disposing RepoTreeProvider');
    repoTreeProvider = undefined;
  }

  // Clean up the contributor tree provider (IQS-867)
  if (contributorTreeProvider) {
    logger?.debug(CLASS_NAME, 'deactivate', 'Disposing ContributorTreeProvider');
    contributorTreeProvider = undefined;
  }

  // Clean up the pipeline run tree provider (IQS-868)
  if (pipelineRunTreeProvider) {
    logger?.debug(CLASS_NAME, 'deactivate', 'Disposing PipelineRunTreeProvider');
    pipelineRunTreeProvider = undefined;
  }

  // Clean up the chart tree provider (IQS-886)
  if (chartTreeProvider) {
    logger?.debug(CLASS_NAME, 'deactivate', 'Disposing ChartTreeProvider');
    chartTreeProvider = undefined;
  }

  for (const disposable of disposables) {
    try {
      disposable.dispose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error(CLASS_NAME, 'deactivate', `Error disposing resource: ${message}`);
    }
  }
  disposables.length = 0;

  logger?.info(CLASS_NAME, 'deactivate', 'Gitr extension deactivated');
  logger?.dispose();
  logger = undefined;
}
