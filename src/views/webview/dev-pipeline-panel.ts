/**
 * Development Pipeline dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one chart panel at a time)
 * - Message routing between webview and extension host
 * - D3.js v7 bundled as a local resource with SHA-256 integrity verification
 * - CSP nonce-based script authorization
 * - Click-to-open commit diff and ticket link actions
 * - URL validation with domain allowlist (IQS-924)
 * - Rate limiting for external URL opens (IQS-924)
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-897, IQS-924 (security hardening)
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { DevPipelineDataService } from '../../services/dev-pipeline-data-service.js';
import { generateDevPipelineHtml } from './dev-pipeline-html.js';
import { getSettings } from '../../config/settings.js';
import { validateExternalUrl } from '../../utils/url-validator.js';
import { buildIssueUrl } from '../../utils/url-builder.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { DevPipelineWebviewToHost, DevPipelineHostToWebview } from './dev-pipeline-protocol.js';

/**
 * Extended message type for click actions from webview.
 * These are not part of the data protocol but used for UI interactions.
 */
interface OpenCommitDiffMessage {
  readonly type: 'openCommitDiff';
  readonly sha: string;
}

interface OpenExternalMessage {
  readonly type: 'openExternal';
  readonly url: string;
}

/**
 * Message for opening a ticket in the browser.
 * Uses the URL builder utility for secure URL construction.
 * Ticket: IQS-926
 */
interface OpenTicketMessage {
  readonly type: 'openTicket';
  readonly ticketId: string;
  readonly ticketType: string;
  readonly jiraUrlPrefix: string;
  readonly linearUrlPrefix: string;
}

type DevPipelineClickMessage = OpenCommitDiffMessage | OpenExternalMessage | OpenTicketMessage;

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DevPipelinePanel';

/**
 * View type identifier for the development pipeline webview.
 */
const VIEW_TYPE = 'gitrx.devPipelinePanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Rate limiting configuration for external URL opens.
 * Prevents rapid-fire URL opens which could indicate malicious behavior.
 * Ticket: IQS-924
 */
const RATE_LIMIT_WINDOW_MS = 60000; // 60 seconds
const RATE_LIMIT_MAX_URLS = 5; // Max 5 URLs per window

/**
 * Manages the Development Pipeline WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 */
export class DevPipelinePanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: DevPipelinePanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private db: DatabaseService | undefined;
  private dataService: DevPipelineDataService | undefined;

  /**
   * Timestamps of recent URL opens for rate limiting.
   * Filtered to retain only timestamps within the rate limit window.
   * Ticket: IQS-924
   */
  private urlOpenTimestamps: number[] = [];

  /**
   * Create or reveal the Development Pipeline panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Development Pipeline dashboard panel');

    // If panel exists, reveal it
    if (DevPipelinePanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      DevPipelinePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!DevPipelinePanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new development pipeline webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Development Pipeline',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    DevPipelinePanel.currentPanel = new DevPipelinePanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing DevPipelinePanel');

    // Listen for panel disposal
    this.panel.onDidDispose(
      () => this.dispose(),
      null,
      this.disposables,
    );

    // Listen for messages from the webview - MUST be registered BEFORE setting HTML content
    // to avoid race condition where webview sends message before handler is ready
    this.panel.webview.onDidReceiveMessage(
      (message: DevPipelineWebviewToHost | DevPipelineClickMessage) => {
        this.logger.info(CLASS_NAME, 'onDidReceiveMessage', `Received message from webview: type=${message.type}`);
        // Handle click actions (non-data messages)
        if (message.type === 'openCommitDiff') {
          void this.handleOpenCommitDiff(message.sha);
          return;
        }
        if (message.type === 'openExternal') {
          void this.handleOpenExternal(message.url);
          return;
        }
        if (message.type === 'openTicket') {
          void this.handleOpenTicket(message);
          return;
        }
        // Handle data messages
        void this.handleMessage(message as DevPipelineWebviewToHost);
      },
      null,
      this.disposables,
    );

    // Set the webview HTML content AFTER message handler is registered
    // This prevents race condition where webview sends message before handler is ready
    this.updateWebviewContent();
    this.logger.info(CLASS_NAME, 'constructor', 'Webview content set, message handler ready');

    this.logger.info(CLASS_NAME, 'constructor', 'DevPipelinePanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating development pipeline webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'dev-pipeline.css'),
    );

    // Get settings for issue tracker URL prefixes (IQS-926)
    const settings = getSettings();
    const jiraUrlPrefix = settings.jira?.urlPrefix || settings.jira?.server || '';
    const linearUrlPrefix = settings.linear?.urlPrefix || '';

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateDevPipelineHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
      jiraUrlPrefix,
      linearUrlPrefix,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Development pipeline webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   */
  private async handleMessage(message: DevPipelineWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    try {
      await this.ensureDbConnection();

      if (!this.dataService) {
        this.logger.error(CLASS_NAME, 'handleMessage', 'Data service not available after DB init');
        this.postError('Data service unavailable', message.type);
        return;
      }

      switch (message.type) {
        case 'requestDevPipelineData': {
          const viewExists = await this.dataService.checkViewExists();
          if (!viewExists) {
            this.postMessage({
              type: 'devPipelineData',
              rows: [],
              hasData: false,
              viewExists: false,
            });
            break;
          }

          const data = await this.dataService.getChartData({
            startDate: message.startDate,
            endDate: message.endDate,
            team: message.team,
            repository: message.repository,
            ticketId: message.ticketId,
          });
          this.postMessage({
            type: 'devPipelineData',
            rows: data.rows,
            hasData: data.hasData,
            viewExists: true,
          });
          break;
        }

        case 'requestDevPipelineByTicket': {
          const byTicketData = await this.dataService.getDevPipelineMetricsByTicket({
            startDate: message.startDate,
            endDate: message.endDate,
          });
          this.postMessage({
            type: 'devPipelineByTicket',
            rows: byTicketData,
            hasData: byTicketData.length > 0,
          });
          break;
        }

        case 'requestDevPipelineByAuthor': {
          const byAuthorData = await this.dataService.getDevPipelineMetricsByAuthor({
            startDate: message.startDate,
            endDate: message.endDate,
          });
          this.postMessage({
            type: 'devPipelineByAuthor',
            rows: byAuthorData,
            hasData: byAuthorData.length > 0,
          });
          break;
        }

        case 'requestBaselineStats': {
          const stats = await this.dataService.getBaselineStats();
          this.postMessage({
            type: 'baselineStats',
            totalCommits: stats?.total_commits ?? 0,
            commitsWithBaseline: stats?.commits_with_baseline ?? 0,
            baselineCoverageRatio: stats?.baseline_coverage_ratio ?? null,
          });
          break;
        }

        case 'requestDevPipelineTeamList': {
          this.logger.info(CLASS_NAME, 'handleMessage', 'Fetching unique teams for dropdown');
          try {
            const teams = await this.dataService.getUniqueTeams();
            this.logger.info(CLASS_NAME, 'handleMessage', `Got ${teams.length} teams from database: ${JSON.stringify(teams.slice(0, 5))}...`);
            this.postMessage({
              type: 'devPipelineTeamList',
              teams,
            });
            this.logger.info(CLASS_NAME, 'handleMessage', `Sent ${teams.length} teams to webview`);
          } catch (teamError: unknown) {
            const teamErrorMsg = teamError instanceof Error ? teamError.message : String(teamError);
            this.logger.error(CLASS_NAME, 'handleMessage', `Failed to fetch teams: ${teamErrorMsg}`);
            this.postMessage({
              type: 'devPipelineTeamList',
              teams: [],
            });
          }
          break;
        }

        case 'requestDevPipelineWeeklyMetrics': {
          this.logger.debug(CLASS_NAME, 'handleMessage', `Fetching weekly metrics for team: ${message.team}`);
          // Pass repository settings for repoUrl lookup
          const currentSettings = getSettings();
          const weeklyData = await this.dataService.getWeeklyMetrics(
            message.team,
            message.startDate ?? this.getDefaultStartDate(),
            message.endDate ?? this.getDefaultEndDate(),
            currentSettings.repositories,
          );
          this.postMessage({
            type: 'devPipelineWeeklyMetrics',
            data: weeklyData,
          });
          this.logger.debug(CLASS_NAME, 'handleMessage', `Sent ${weeklyData.length} weekly data points to webview`);
          break;
        }

        default: {
          // Exhaustiveness guard
          this.logger.warn(CLASS_NAME, 'handleMessage', `Unknown message type: ${String((message as unknown as Record<string, unknown>).type)}`);
        }
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleMessage', `Error handling ${message.type}: ${errorMsg}`);
      this.logger.error(CLASS_NAME, 'handleMessage', `Stack: ${error instanceof Error ? error.stack : 'N/A'}`);

      // For team list requests, return empty list so UI remains functional
      if (message.type === 'requestDevPipelineTeamList') {
        this.logger.warn(CLASS_NAME, 'handleMessage', 'Returning empty team list due to error');
        this.postMessage({
          type: 'devPipelineTeamList',
          teams: [],
        });
        return;
      }

      // For weekly metrics requests, return empty data with error message
      if (message.type === 'requestDevPipelineWeeklyMetrics') {
        this.postMessage({
          type: 'devPipelineWeeklyMetrics',
          data: [],
          error: errorMsg,
        });
        return;
      }

      this.postError(errorMsg, message.type);
    }
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and DevPipelineDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for development pipeline');

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

    this.dataService = new DevPipelineDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for development pipeline');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: DevPipelineHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'devPipelineError',
      message: errorMessage,
      source,
    });
  }

  /**
   * Handle opening a commit diff in VS Code.
   * Note: This requires the Git extension to be active and may not work in all scenarios.
   *
   * @param sha - The commit SHA to open
   */
  private async handleOpenCommitDiff(sha: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleOpenCommitDiff', `Opening commit diff for: ${sha}`);
    try {
      // Try to use the built-in git.openChange command if available
      // Fallback: show information message with SHA
      await vscode.commands.executeCommand('git.viewCommit', sha);
    } catch (error: unknown) {
      // If git.viewCommit fails, try alternative approaches
      this.logger.debug(CLASS_NAME, 'handleOpenCommitDiff', 'git.viewCommit not available, showing info message');
      void vscode.window.showInformationMessage(
        `Commit: ${sha.substring(0, 7)}`,
        'Copy SHA',
      ).then((selection) => {
        if (selection === 'Copy SHA') {
          void vscode.env.clipboard.writeText(sha);
          void vscode.window.showInformationMessage(`Copied: ${sha}`);
        }
      });
    }
  }

  /**
   * Handle opening an external URL in the default browser.
   *
   * Security hardening (IQS-924):
   * - Rate limiting: max 5 URLs per 60 seconds
   * - Domain allowlist validation: GitHub, Linear, configured Jira server
   * - Rejects non-http/https schemes
   * - Rejects URLs with embedded credentials
   * - Logs all validation failures for audit
   *
   * @param url - The URL to open
   */
  private async handleOpenExternal(url: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleOpenExternal', `Attempting to open external URL: ${url}`);

    // Rate limiting check (IQS-924)
    const now = Date.now();
    this.urlOpenTimestamps = this.urlOpenTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    if (this.urlOpenTimestamps.length >= RATE_LIMIT_MAX_URLS) {
      this.logger.warn(CLASS_NAME, 'handleOpenExternal', `Rate limit exceeded: ${this.urlOpenTimestamps.length} URLs in window`);
      void vscode.window.showWarningMessage(
        'Gitr: Too many URLs opened recently. Please wait a moment before trying again.',
      );
      return;
    }

    // URL validation with domain allowlist (IQS-924)
    const settings = getSettings();
    const jiraServer = settings.jira?.server ?? '';
    const validation = validateExternalUrl(url, jiraServer);

    if (!validation.isValid) {
      this.logger.warn(CLASS_NAME, 'handleOpenExternal', `URL rejected: ${validation.reason} - URL: ${url}`);
      void vscode.window.showWarningMessage(
        `Gitr: Cannot open URL - ${validation.reason}`,
      );
      return;
    }

    // Record timestamp for rate limiting
    this.urlOpenTimestamps.push(now);

    // Open the validated URL
    try {
      this.logger.info(CLASS_NAME, 'handleOpenExternal', `Opening validated URL: ${url}`);
      await vscode.env.openExternal(validation.validatedUri!);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleOpenExternal', `Failed to open URL: ${msg}`);
    }
  }

  /**
   * Handle opening a ticket URL using the secure URL builder utility.
   *
   * Security hardening (IQS-926):
   * - Uses centralized URL builder with input validation
   * - Validates issue key format (prevents XSS/injection)
   * - Validates URL prefix scheme (http/https only)
   * - Rate limiting applied via handleOpenExternal
   *
   * @param message - The openTicket message with ticket details
   */
  private async handleOpenTicket(message: OpenTicketMessage): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleOpenTicket', `Building URL for: ${message.ticketId} (${message.ticketType})`);

    const settings = getSettings();
    const jiraServer = settings.jira?.server ?? '';

    // Use URL builder utility for secure URL construction
    const result = buildIssueUrl(
      message.ticketType,
      message.ticketId,
      message.jiraUrlPrefix,
      jiraServer,
      message.linearUrlPrefix,
    );

    if (!result.success) {
      this.logger.warn(CLASS_NAME, 'handleOpenTicket', `URL build failed: ${result.reason}`);
      if (result.notConfigured) {
        void vscode.window.showInformationMessage(
          `Gitr: ${result.reason}. Configure the URL prefix in settings.`,
        );
      } else {
        void vscode.window.showWarningMessage(`Gitr: Could not open ticket - ${result.reason}`);
      }
      return;
    }

    // Delegate to handleOpenExternal for rate limiting and final validation
    await this.handleOpenExternal(result.url!);
  }

  /**
   * Generate a cryptographic nonce for CSP script authorization.
   */
  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Get default start date (12 weeks ago).
   */
  private getDefaultStartDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - 84); // 12 weeks
    return date.toISOString().split('T')[0] ?? '';
  }

  /**
   * Get default end date (today).
   */
  private getDefaultEndDate(): string {
    return new Date().toISOString().split('T')[0] ?? '';
  }

  /**
   * Dispose the panel and all its resources.
   */
  dispose(): void {
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing DevPipelinePanel');

    DevPipelinePanel.currentPanel = undefined;

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down development pipeline database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'DevPipelinePanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    DevPipelinePanel.currentPanel = undefined;
  }
}
