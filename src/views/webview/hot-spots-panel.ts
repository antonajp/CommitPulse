/**
 * Hot Spots dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Interactive bubble chart: X=complexity, Y=churn
 * - Bubble size = LOC, bubble color = risk tier
 * - Click to open file in VS Code or view history
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Rate limiting on message handlers (IQS-947)
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-902, IQS-947
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { HotSpotsDataService } from '../../services/hot-spots-data-service.js';
import { generateHotSpotsHtml } from './hot-spots-html.js';
import { getSettings } from '../../config/settings.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { HotSpotsWebviewToHost, HotSpotsHostToWebview } from './hot-spots-protocol.js';
import type { RiskTier } from '../../services/hot-spots-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'HotSpotsPanel';

/**
 * View type identifier for the hot spots webview.
 */
const VIEW_TYPE = 'gitrx.hotSpotsPanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Manages the Hot Spots WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: IQS-902
 */
export class HotSpotsPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: HotSpotsPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private dataService: HotSpotsDataService | undefined;

  /**
   * Create or reveal the Hot Spots panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Hot Spots chart panel');

    // If panel exists, reveal it
    if (HotSpotsPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      HotSpotsPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!HotSpotsPanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new hot spots webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Hot Spots',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    HotSpotsPanel.currentPanel = new HotSpotsPanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing HotSpotsPanel');

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
      (message: HotSpotsWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'HotSpotsPanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating hot spots webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'hot-spots.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateHotSpotsHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Hot spots webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   * Rate limited to prevent excessive database queries (IQS-947, CWE-770).
   */
  private async handleMessage(message: HotSpotsWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    // Rate limiting check (IQS-947: 500ms minimum interval between requests)
    const rateLimitCheck = this.rateLimiter.checkRateLimit(message.type);
    if (!rateLimitCheck.allowed) {
      this.logger.debug(
        CLASS_NAME,
        'handleMessage',
        `Rate limited: ${message.type}, wait ${rateLimitCheck.waitMs}ms`,
      );
      return;
    }

    try {
      switch (message.type) {
        case 'requestHotSpotsData': {
          await this.handleRequestHotSpotsData(message);
          break;
        }

        case 'requestHotSpotsSummary': {
          await this.handleRequestHotSpotsSummary();
          break;
        }

        case 'requestHotSpotsRefresh': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Refresh requested');
          await this.handleRequestHotSpotsData({ type: 'requestHotSpotsData' });
          break;
        }

        case 'openFile': {
          await this.handleOpenFile(message);
          break;
        }

        case 'viewHistory': {
          await this.handleViewHistory(message);
          break;
        }

        case 'viewBugs': {
          await this.handleViewBugs(message);
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
   * Handle request for hot spots data.
   */
  private async handleRequestHotSpotsData(message: {
    type: 'requestHotSpotsData';
    repository?: string;
    riskTier?: RiskTier;
    minChurn?: number;
    minComplexity?: number;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestHotSpotsData', 'Processing requestHotSpotsData');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestHotSpotsData', 'Data service not available after DB init');
      this.postError('Data service unavailable', message.type);
      return;
    }

    const chartData = await this.dataService.getChartData({
      repository: message.repository,
      riskTier: message.riskTier,
      minChurn: message.minChurn,
      minComplexity: message.minComplexity,
    });

    // Extract unique repositories from data
    const repositories = [...new Set(chartData.rows.map(r => r.repository))].sort();

    this.postMessage({
      type: 'hotSpotsData',
      rows: chartData.rows,
      hasData: chartData.hasData,
      viewExists: chartData.viewExists,
    });

    // Send repositories separately for filter dropdown
    this.postMessage({
      type: 'repositories',
      repositories,
    });
  }

  /**
   * Handle request for hot spots summary statistics.
   */
  private async handleRequestHotSpotsSummary(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestHotSpotsSummary', 'Processing requestHotSpotsSummary');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestHotSpotsSummary', 'Data service not available');
      this.postError('Data service unavailable', 'requestHotSpotsSummary');
      return;
    }

    const summary = await this.dataService.getHotSpotsSummary();
    this.postMessage({
      type: 'hotSpotsSummary',
      summary,
    });
  }

  /**
   * Handle request to open a file in VS Code.
   * Validates file path is within configured repositories (CWE-22 prevention).
   */
  private async handleOpenFile(message: { type: 'openFile'; filePath: string; repository: string }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleOpenFile', `Opening file: ${message.filePath} in ${message.repository}`);

    const settings = getSettings();
    const repoConfig = settings.repositories.find(r => r.name === message.repository);

    if (!repoConfig) {
      this.logger.warn(CLASS_NAME, 'handleOpenFile', `Repository not found: ${message.repository}`);
      void vscode.window.showWarningMessage(`Gitr: Repository "${message.repository}" not found in settings.`);
      return;
    }

    // Construct full path and validate it's within repository (CWE-22 prevention)
    const fullPath = path.join(repoConfig.path, message.filePath);
    const normalizedFullPath = path.normalize(fullPath);
    const normalizedRepoPath = path.normalize(repoConfig.path);

    if (!normalizedFullPath.startsWith(normalizedRepoPath)) {
      this.logger.error(CLASS_NAME, 'handleOpenFile', `Path traversal attempt detected: ${message.filePath}`);
      void vscode.window.showErrorMessage('Gitr: Invalid file path.');
      return;
    }

    try {
      const uri = vscode.Uri.file(normalizedFullPath);
      await vscode.window.showTextDocument(uri);
      this.logger.info(CLASS_NAME, 'handleOpenFile', `Opened file: ${normalizedFullPath}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleOpenFile', `Failed to open file: ${msg}`);
      void vscode.window.showErrorMessage(`Gitr: Could not open file: ${msg}`);
    }
  }

  /**
   * Handle request to view file history.
   * Uses VS Code's built-in Git timeline view.
   */
  private async handleViewHistory(message: { type: 'viewHistory'; filePath: string; repository: string }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleViewHistory', `Viewing history for: ${message.filePath}`);

    const settings = getSettings();
    const repoConfig = settings.repositories.find(r => r.name === message.repository);

    if (!repoConfig) {
      this.logger.warn(CLASS_NAME, 'handleViewHistory', `Repository not found: ${message.repository}`);
      void vscode.window.showWarningMessage(`Gitr: Repository "${message.repository}" not found in settings.`);
      return;
    }

    // Construct full path and validate
    const fullPath = path.join(repoConfig.path, message.filePath);
    const normalizedFullPath = path.normalize(fullPath);
    const normalizedRepoPath = path.normalize(repoConfig.path);

    if (!normalizedFullPath.startsWith(normalizedRepoPath)) {
      this.logger.error(CLASS_NAME, 'handleViewHistory', `Path traversal attempt detected: ${message.filePath}`);
      void vscode.window.showErrorMessage('Gitr: Invalid file path.');
      return;
    }

    try {
      const uri = vscode.Uri.file(normalizedFullPath);
      // First open the file to show in editor
      await vscode.window.showTextDocument(uri);
      // Then execute the timeline focus command to show git history
      await vscode.commands.executeCommand('timeline.focus');
      this.logger.info(CLASS_NAME, 'handleViewHistory', `Showing timeline for: ${normalizedFullPath}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleViewHistory', `Failed to view history: ${msg}`);
      void vscode.window.showErrorMessage(`Gitr: Could not view file history: ${msg}`);
    }
  }

  /**
   * Handle request to view bug tickets for a file.
   * Shows an information message with bug count since direct ticket lookup
   * would require additional database queries.
   */
  private async handleViewBugs(message: { type: 'viewBugs'; filePath: string; repository: string; bugCount: number }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleViewBugs', `Viewing bugs for: ${message.filePath} (count: ${message.bugCount})`);

    const bugWord = message.bugCount === 1 ? 'bug ticket' : 'bug tickets';
    void vscode.window.showInformationMessage(
      `Gitr: ${message.filePath} has ${message.bugCount} linked ${bugWord}. ` +
      `Open the Issue Linkage view for details.`,
    );

    this.logger.info(CLASS_NAME, 'handleViewBugs', `Displayed bug info for: ${message.filePath}`);
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and HotSpotsDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for hot spots');

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

    this.dataService = new HotSpotsDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for hot spots');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: HotSpotsHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'hotSpotsError',
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
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing HotSpotsPanel');

    HotSpotsPanel.currentPanel = undefined;

    // Reset rate limiter state
    this.rateLimiter.reset();

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down hot spots database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'HotSpotsPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    HotSpotsPanel.currentPanel = undefined;
  }
}
