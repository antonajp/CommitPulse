/**
 * PR Coverage Report dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Hero metric: Overall PR coverage percentage with trend
 * - KPI cards: Total commits, PR-linked, orphans, repos analyzed
 * - D3.js donut chart for coverage visualization
 * - Line chart for weekly coverage trend
 * - Horizontal bar charts for author/branch compliance
 * - Sortable, paginated orphan commits table
 * - CSV export for orphan commits
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Rate limiting on message handlers
 * - Proper disposal and resource cleanup
 *
 * Ticket: GITX-221
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { PRCoverageService } from '../../services/pr-coverage-service.js';
import { generatePRCoverageHtml } from './pr-coverage-html.js';
import { getSettings } from '../../config/settings.js';
import { validateExternalUrl } from '../../utils/url-validator.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import { handleSharedMessage } from './shared-message-handlers.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { PRCoverageWebviewToHost, PRCoverageHostToWebview } from './pr-coverage-protocol.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'PRCoveragePanel';

/**
 * View type identifier for the PR coverage webview.
 */
const VIEW_TYPE = 'gitrx.prCoveragePanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Rate limiting configuration for external URL opens.
 * Prevents rapid-fire URL opens which could indicate malicious behavior.
 */
const RATE_LIMIT_WINDOW_MS = 60000; // 60 seconds
const RATE_LIMIT_MAX_URLS = 5; // Max 5 URLs per window

/**
 * Manages the PR Coverage Report WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: GITX-221
 */
export class PRCoveragePanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: PRCoveragePanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private dataService: PRCoverageService | undefined;

  /**
   * Timestamps of recent URL opens for rate limiting.
   * Filtered to retain only timestamps within the rate limit window.
   */
  private urlOpenTimestamps: number[] = [];

  /**
   * Create or reveal the PR Coverage panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening PR Coverage Report panel');

    // If panel exists, reveal it
    if (PRCoveragePanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      PRCoveragePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!PRCoveragePanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new PR coverage webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: PR Coverage Report',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    PRCoveragePanel.currentPanel = new PRCoveragePanel(panel, extensionUri, secretService);
  }

  /**
   * Verify the SHA-256 integrity of the D3.js bundle.
   *
   * @param d3Path - Absolute file path to d3.min.js
   * @param logger - Logger instance
   * @returns true if integrity check passes
   */
  private static verifyD3Integrity(d3Path: string, logger: LoggerService): boolean {
    logger.debug(CLASS_NAME, 'verifyD3Integrity', `Verifying D3.js integrity at: ${d3Path}`);

    try {
      const content = fs.readFileSync(d3Path);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      logger.debug(CLASS_NAME, 'verifyD3Integrity', `Computed SHA-256: ${hash}`);

      if (hash !== D3_EXPECTED_SHA256) {
        logger.error(CLASS_NAME, 'verifyD3Integrity',
          `SHA-256 mismatch! Expected: ${D3_EXPECTED_SHA256}, Got: ${hash}`);
        return false;
      }

      logger.info(CLASS_NAME, 'verifyD3Integrity', 'D3.js integrity verified successfully');
      return true;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(CLASS_NAME, 'verifyD3Integrity', `Failed to verify D3.js: ${msg}`);
      return false;
    }
  }

  /**
   * Private constructor -- use createOrShow() to create instances.
   */
  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
  ) {
    this.logger = LoggerService.getInstance();
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.secretService = secretService;
    this.rateLimiter = new MessageRateLimiter({
      minIntervalMs: DEFAULT_RATE_LIMIT_INTERVAL_MS,
      className: CLASS_NAME,
    });

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing PRCoveragePanel');

    // Set the webview HTML content
    this.updateWebviewContent();

    // Listen for panel disposal
    this.panel.onDidDispose(
      () => this.dispose(),
      null,
      this.disposables,
    );

    // Listen for messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message: PRCoverageWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        // Handle shared message types (exportCsv) - GITX-127
        if (message.type === 'exportCsv') {
          void handleSharedMessage(
            message as { type: string },
            this.panel.webview,
            this.logger,
            CLASS_NAME,
          );
          return;
        }
        // Handle open commit (click on SHA)
        if (message.type === 'openCommit') {
          void this.handleOpenCommit(message.sha, message.repository);
          return;
        }
        // Handle data messages
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'PRCoveragePanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating PR coverage webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'pr-coverage.css'),
    );

    // Get settings for URL prefixes
    const settings = getSettings();
    const githubOrg = settings.github.organization || '';

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `GitHub Org: ${githubOrg}`);

    webview.html = generatePRCoverageHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
      githubOrg,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'PR coverage webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   * Rate limited to prevent excessive database queries.
   */
  private async handleMessage(message: PRCoverageWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    // Rate limiting check
    const rateLimitCheck = this.rateLimiter.checkRateLimit(message.type);
    if (!rateLimitCheck.allowed) {
      this.logger.debug(
        CLASS_NAME,
        'handleMessage',
        `Rate limited: ${message.type}, wait ${rateLimitCheck.waitMs}ms`,
      );
      return;
    }

    // Handle shared message types early (exportCsv, openExternal) before DB connection
    const handled = await handleSharedMessage(message, this.panel.webview, this.logger, CLASS_NAME);
    if (handled) {
      return;
    }

    try {
      await this.ensureDbConnection();

      if (!this.dataService) {
        this.logger.error(CLASS_NAME, 'handleMessage', 'Data service not available after DB init');
        this.postError('Data service unavailable', message.type);
        return;
      }

      switch (message.type) {
        case 'requestPRCoverageData': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestPRCoverageData');
          const viewExists = await this.dataService.checkViewExists();
          if (!viewExists) {
            this.postMessage({
              type: 'prCoverageData',
              overall: {
                totalCommits: 0,
                prLinkedCommits: 0,
                orphanCommits: 0,
                mergeCommits: 0,
                repositoriesAnalyzed: 0,
                coveragePercentage: 0,
              },
              weeklyTrend: [],
              byAuthor: [],
              byBranch: [],
              byContributor: [],
              byTeam: [],
              orphanCommits: [],
              orphanBreakdown: {
                preMergeOnPrBranch: 0,
                directToProtected: 0,
                unlinkedFeatureBranch: 0,
                totalOrphans: 0,
                directPushPercentage: 0,
              },
              hasData: false,
              viewExists: false,
              hasPRData: false,
            });
            break;
          }

          const data = await this.dataService.getChartData({
            startDate: message.startDate,
            endDate: message.endDate,
            repository: message.repository,
            author: message.author,
            branches: message.branches,
            teams: message.teams,
          });
          this.postMessage({
            type: 'prCoverageData',
            overall: data.overall,
            weeklyTrend: data.weeklyTrend,
            byAuthor: data.byAuthor,
            byBranch: data.byBranch,
            byContributor: data.byContributor,
            byTeam: data.byTeam,
            orphanCommits: data.orphanCommits,
            orphanBreakdown: data.orphanBreakdown,
            hasData: data.hasData,
            viewExists: true,
            hasPRData: data.hasPRData,
          });
          break;
        }

        case 'requestOrphanCommits': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestOrphanCommits');
          const orphans = await this.dataService.getOrphanCommits({
            startDate: message.startDate,
            endDate: message.endDate,
            repository: message.repository,
            author: message.author,
            branches: message.branches,
            teams: message.teams,
          });
          this.postMessage({
            type: 'orphanCommitsData',
            orphanCommits: orphans,
            hasData: orphans.length > 0,
          });
          break;
        }

        case 'requestFilterOptions': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestFilterOptions');
          const options = await this.dataService.getFilterOptions(message.repository);
          this.postMessage({
            type: 'filterOptions',
            repositories: options.repositories,
            authors: options.authors,
            branches: options.branches,
            teams: options.teams,
          });
          break;
        }

        case 'requestSyncCoverage': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestSyncCoverage - triggering GitHub PR sync command');
          try {
            // Execute the gitr.syncGitHubPRs command which fetches PRs from GitHub and correlates coverage
            await vscode.commands.executeCommand('gitr.syncGitHubPRs');
            // Note: Success/failure notification is handled by the command itself

            // Refresh the dashboard data after sync
            // Re-fetch the chart data with current filters (no filters for refresh)
            const refreshData = await this.dataService.getChartData({});
            this.postMessage({
              type: 'prCoverageData',
              overall: refreshData.overall,
              weeklyTrend: refreshData.weeklyTrend,
              byAuthor: refreshData.byAuthor,
              byBranch: refreshData.byBranch,
              byContributor: refreshData.byContributor,
              byTeam: refreshData.byTeam,
              orphanCommits: refreshData.orphanCommits,
              orphanBreakdown: refreshData.orphanBreakdown,
              hasData: refreshData.hasData,
              viewExists: true,
              hasPRData: refreshData.hasPRData,
            });

            // Send sync success message (no linksCreated count from the command)
            this.postMessage({
              type: 'syncResult',
              success: true,
              linksCreated: 0, // Count not available from command execution
            });
          } catch (syncError: unknown) {
            const errorMsg = syncError instanceof Error ? syncError.message : String(syncError);
            this.logger.error(CLASS_NAME, 'handleMessage', `GitHub PR sync failed: ${errorMsg}`);
            this.postMessage({
              type: 'syncResult',
              success: false,
              linksCreated: 0,
              errorMessage: errorMsg,
            });
          }
          break;
        }

        case 'openCommit': {
          // Handle open commit - navigate to commit in GitHub
          await this.handleOpenCommit(message.sha, message.repository);
          break;
        }

        // Shared message types (exportCsv, openExternal) handled early via handleSharedMessage
        case 'exportCsv':
        case 'openExternal':
          // These are already handled before the switch, but included for exhaustiveness
          break;

        default: {
          // Exhaustiveness guard
          const _exhaustive: never = message;
          this.logger.warn(CLASS_NAME, 'handleMessage', `Unknown message type: ${String((_exhaustive as unknown as Record<string, unknown>).type)}`);
        }
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleMessage', `Error handling ${message.type}: ${errorMsg}`);
      this.postError(errorMsg, message.type);
    }
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and PRCoverageService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for PR coverage');

    const settings = getSettings();
    const password = await this.secretService.getDatabasePassword();

    if (!password) {
      const msg = 'Database password not configured. Use "Gitr: Set Database Password" first.';
      this.logger.warn(CLASS_NAME, 'ensureDbConnection', msg);
      void vscode.window.showWarningMessage(msg);
      throw new Error(msg);
    }

    this.db = new DatabaseService();
    const dbConfig = buildConfigFromSettings(settings.database, password);
    await this.db.initialize(dbConfig);

    this.dataService = new PRCoverageService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for PR coverage');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: PRCoverageHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'prCoverageError',
      message: errorMessage,
      source,
    });
  }

  /**
   * Handle opening a commit in GitHub.
   *
   * @param sha - Commit SHA
   * @param repository - Repository name
   */
  private async handleOpenCommit(sha: string, repository: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleOpenCommit', `Opening commit: ${sha} in ${repository}`);

    // Rate limiting check
    const now = Date.now();
    this.urlOpenTimestamps = this.urlOpenTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    if (this.urlOpenTimestamps.length >= RATE_LIMIT_MAX_URLS) {
      this.logger.warn(CLASS_NAME, 'handleOpenCommit', `Rate limit exceeded: ${this.urlOpenTimestamps.length} URLs in window`);
      void vscode.window.showWarningMessage(
        'Gitr: Too many URLs opened recently. Please wait a moment before trying again.',
      );
      return;
    }

    // Build GitHub commit URL
    const settings = getSettings();
    const githubOrg = settings.github.organization || '';

    // Repository might be in "repo" or "owner/repo" format
    const repoPath = repository.includes('/') ? repository : `${githubOrg}/${repository}`;
    const url = `https://github.com/${repoPath}/commit/${sha}`;

    // URL validation
    const validation = validateExternalUrl(url, '');

    if (!validation.isValid) {
      this.logger.warn(CLASS_NAME, 'handleOpenCommit', `URL rejected: ${validation.reason} - URL: ${url}`);
      void vscode.window.showWarningMessage(
        `Gitr: Cannot open URL - ${validation.reason}`,
      );
      return;
    }

    // Record timestamp for rate limiting
    this.urlOpenTimestamps.push(now);

    // Open the validated URL
    try {
      this.logger.info(CLASS_NAME, 'handleOpenCommit', `Opening validated URL: ${url}`);
      await vscode.env.openExternal(validation.validatedUri!);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleOpenCommit', `Failed to open URL: ${msg}`);
    }
  }

  /**
   * Generate a cryptographic nonce for CSP script authorization.
   */
  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Dispose the panel and all its resources.
   */
  dispose(): void {
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing PRCoveragePanel');

    PRCoveragePanel.currentPanel = undefined;

    // Reset rate limiter state
    this.rateLimiter.reset();

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down PR coverage database connection');
      void this.db.shutdown();
      this.db = undefined;
      this.dataService = undefined;
    }

    this.panel.dispose();

    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }

    this.logger.debug(CLASS_NAME, 'dispose', 'PRCoveragePanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    PRCoveragePanel.currentPanel = undefined;
  }
}
