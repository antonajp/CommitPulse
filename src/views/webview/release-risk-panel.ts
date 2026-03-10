/**
 * Release Risk Gauge dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Speedometer-style gauge (0-100) with color zones (green/yellow/orange/red)
 * - Animated needle pointing to current risk score
 * - Risk breakdown panel with 4 mini gauges (complexity, tests, experience, hotspot)
 * - Bar chart showing top 5 riskiest commits
 * - Click commit to open diff
 * - Branch/repository selectors
 * - Risk badges: "Ship it", "Review recommended", "Review required", "High risk - escalate"
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-912
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { ReleaseRiskService } from '../../services/release-risk-service.js';
import { generateReleaseRiskHtml } from './release-risk-html.js';
import { getSettings } from '../../config/settings.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { ReleaseRiskFilters, CommitRisk, ReleaseRiskSummary } from '../../services/release-risk-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ReleaseRiskPanel';

/**
 * View type identifier for the release risk webview.
 */
const VIEW_TYPE = 'gitrx.releaseRiskPanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Messages from webview to host (extension).
 */
export type ReleaseRiskWebviewToHost =
  | { type: 'requestRiskData'; filters?: ReleaseRiskFilters }
  | { type: 'requestRiskRefresh'; filters?: ReleaseRiskFilters }
  | { type: 'requestRiskFilterUpdate'; filters: ReleaseRiskFilters }
  | { type: 'requestCommitDrillDown'; sha: string; repository: string }
  | { type: 'requestOpenDiff'; sha: string; repository: string };

/**
 * Messages from host (extension) to webview.
 */
export type ReleaseRiskHostToWebview =
  | {
      type: 'releaseRiskData';
      commits: readonly CommitRisk[];
      summary: ReleaseRiskSummary | null;
      hasData: boolean;
      viewExists: boolean;
    }
  | {
      type: 'releaseRiskFilterOptions';
      repositories: string[];
      branches: string[];
      teams: string[];
    }
  | { type: 'releaseRiskLoading'; isLoading: boolean }
  | { type: 'releaseRiskError'; message: string; source: string }
  | {
      type: 'commitDrillDown';
      commit: CommitRisk | null;
      hasData: boolean;
    };

/**
 * Manages the Release Risk Gauge WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: IQS-912
 */
export class ReleaseRiskPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: ReleaseRiskPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private db: DatabaseService | undefined;
  private dataService: ReleaseRiskService | undefined;

  /**
   * Create or reveal the Release Risk panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Release Risk panel');

    // If panel exists, reveal it
    if (ReleaseRiskPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      ReleaseRiskPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!ReleaseRiskPanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new release risk webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Release Risk',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    ReleaseRiskPanel.currentPanel = new ReleaseRiskPanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing ReleaseRiskPanel');

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
      (message: ReleaseRiskWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'ReleaseRiskPanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating release risk webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'release-risk.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateReleaseRiskHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Release risk webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   */
  private async handleMessage(message: ReleaseRiskWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    try {
      switch (message.type) {
        case 'requestRiskData': {
          await this.handleRequestRiskData(message.filters);
          break;
        }

        case 'requestRiskRefresh': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Refresh requested');
          await this.handleRequestRiskData(message.filters);
          break;
        }

        case 'requestRiskFilterUpdate': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Filter update requested');
          await this.handleRequestRiskData(message.filters);
          break;
        }

        case 'requestCommitDrillDown': {
          await this.handleRequestCommitDrillDown(message);
          break;
        }

        case 'requestOpenDiff': {
          await this.handleRequestOpenDiff(message);
          break;
        }

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
   * Handle request for release risk data.
   */
  private async handleRequestRiskData(filters?: ReleaseRiskFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestRiskData', 'Processing requestRiskData');

    // Send loading state
    this.postMessage({ type: 'releaseRiskLoading', isLoading: true });

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestRiskData', 'Data service not available after DB init');
      this.postError('Data service unavailable', 'requestRiskData');
      return;
    }

    // Get commit risks
    const commitsData = await this.dataService.getCommitRiskChartData(filters ?? {});

    // Get release risk summaries
    const summaryData = await this.dataService.getReleaseRiskSummaryData(filters ?? {});

    // Get the primary summary (first one matching filters, or overall)
    const primarySummary = summaryData.summaries[0] ?? null;

    // Send filter options
    await this.sendFilterOptions();

    this.postMessage({
      type: 'releaseRiskData',
      commits: commitsData.commits,
      summary: primarySummary,
      hasData: commitsData.hasData,
      viewExists: commitsData.viewExists,
    });

    this.postMessage({ type: 'releaseRiskLoading', isLoading: false });
  }

  /**
   * Handle drill-down request for a specific commit.
   */
  private async handleRequestCommitDrillDown(message: {
    type: 'requestCommitDrillDown';
    sha: string;
    repository: string;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestCommitDrillDown',
      `Drill-down for commit: ${message.sha} in ${message.repository}`);

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestCommitDrillDown', 'Data service not available');
      this.postError('Data service unavailable', 'requestCommitDrillDown');
      return;
    }

    // Find the specific commit
    const commits = await this.dataService.getCommitRisks({
      repository: message.repository,
    });

    const commit = commits.find(c => c.sha === message.sha) ?? null;

    this.postMessage({
      type: 'commitDrillDown',
      commit,
      hasData: commit !== null,
    });
  }

  /**
   * Handle request to open diff for a commit.
   */
  private async handleRequestOpenDiff(message: {
    type: 'requestOpenDiff';
    sha: string;
    repository: string;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestOpenDiff',
      `Opening diff for commit: ${message.sha} in ${message.repository}`);

    // Look up repository path from settings
    const settings = getSettings();
    const repoConfig = settings.repositories.find(r => r.name === message.repository);

    if (!repoConfig) {
      this.logger.warn(CLASS_NAME, 'handleRequestOpenDiff', `Repository not found: ${message.repository}`);
      void vscode.window.showWarningMessage(`Repository "${message.repository}" not found in settings.`);
      return;
    }

    // Open Git diff in VS Code
    try {
      const repoUri = vscode.Uri.file(repoConfig.path);
      // Use the git.openChange command to show the commit diff
      await vscode.commands.executeCommand('git.viewChanges', repoUri);
      this.logger.info(CLASS_NAME, 'handleRequestOpenDiff', `Opened diff for: ${message.sha}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleRequestOpenDiff', `Failed to open diff: ${msg}`);
      void vscode.window.showErrorMessage(`Could not open diff for commit: ${message.sha}`);
    }
  }

  /**
   * Send available filter options to the webview.
   */
  private async sendFilterOptions(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'sendFilterOptions', 'Fetching filter options');

    if (!this.dataService) {
      return;
    }

    // Get all commits to extract unique values for filters
    const commits = await this.dataService.getCommitRisks({});

    const repositories = [...new Set(commits.map(c => c.repository))].sort();
    const branches = [...new Set(commits.map(c => c.branch))].sort();
    const teams = [...new Set(commits.map(c => c.team).filter(t => t !== null))] as string[];
    teams.sort();

    this.postMessage({
      type: 'releaseRiskFilterOptions',
      repositories,
      branches,
      teams,
    });
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and ReleaseRiskService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for release risk');

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

    this.dataService = new ReleaseRiskService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for release risk');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: ReleaseRiskHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'releaseRiskError',
      message: errorMessage,
      source,
    });
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
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing ReleaseRiskPanel');

    ReleaseRiskPanel.currentPanel = undefined;

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down release risk database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'ReleaseRiskPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    ReleaseRiskPanel.currentPanel = undefined;
  }
}
