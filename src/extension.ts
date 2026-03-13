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
import { ChartTreeProvider } from './providers/chart-tree-provider.js';

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
  // Arc Component Backfill command (IQS-885), and Jira Backfill command (IQS-933)
  disposables.push(registerSccBackfillCommand(logger));
  disposables.push(registerStoryPointsBackfillCommand(logger));
  disposables.push(registerArcComponentBackfillCommand(logger));
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

  // gitrx.runPipelineForRepo - Run pipeline for a specific repository (context menu)
  const runForRepoDisposable = vscode.commands.registerCommand(
    'gitrx.runPipelineForRepo',
    async (item: { nodeData?: { repository?: string } }) => {
      const repoName = item?.nodeData?.repository;
      logger?.info(CLASS_NAME, 'runPipelineForRepo', `Command executed: gitrx.runPipelineForRepo for ${repoName ?? 'unknown'}`);

      if (!repoName) {
        logger?.warn(CLASS_NAME, 'runPipelineForRepo', 'No repository context available');
        void vscode.window.showWarningMessage('Gitr: No repository selected.');
        return;
      }

      // Delegate to the main pipeline command
      // Future enhancement: pass repo filter parameter
      logger?.info(CLASS_NAME, 'runPipelineForRepo', `Running pipeline for repository: ${repoName}`);
      void vscode.window.showInformationMessage(`Gitr: Running pipeline for ${repoName}...`);
      await vscode.commands.executeCommand('gitr.runPipeline');
    },
  );
  disposables.push(runForRepoDisposable);

  // gitrx.openRepoInTerminal - Open a terminal at the repo path (context menu)
  const openTerminalDisposable = vscode.commands.registerCommand(
    'gitrx.openRepoInTerminal',
    (item: { nodeData?: { repository?: string } }) => {
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

      logger?.debug(CLASS_NAME, 'openRepoInTerminal', `Opening terminal at: ${repoEntry.path}`);
      const terminal = vscode.window.createTerminal({
        name: `Gitr: ${repoName}`,
        cwd: repoEntry.path,
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

      logger?.info(CLASS_NAME, 'showContributorDetail', `Showing details for: ${contributor.login}`);

      // Format details for the output channel
      const lines = [
        '='.repeat(60),
        `Contributor: ${contributor.login}`,
        '='.repeat(60),
        `Full Name:    ${contributor.fullName ?? 'N/A'}`,
        `Vendor:       ${contributor.vendor ?? 'Unknown'}`,
        `Team:         ${contributor.team ?? 'Unassigned'}`,
        `Commits:      ${contributor.commitCount.toLocaleString()}`,
        `Repositories: ${contributor.repoList ?? 'None'}`,
        '='.repeat(60),
      ];

      // Write to the Gitr output channel
      for (const line of lines) {
        logger?.info('ContributorDetail', contributor.login, line);
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

  logger?.info(CLASS_NAME, 'initializeChartTreeView', 'Charts TreeView and commands registered successfully');
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
