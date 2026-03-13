/**
 * Story Points Trend chart webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one chart panel at a time)
 * - Message routing between webview and extension host
 * - D3.js v7 bundled as a local resource with SHA-256 integrity verification
 * - CSP nonce-based script authorization
 * - Rate limiting on message handlers (IQS-947)
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-940, IQS-947
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { StoryPointsTrendDataService } from '../../services/story-points-trend-data-service.js';
import { generateStoryPointsTrendHtml } from './story-points-trend-html.js';
import { getSettings } from '../../config/settings.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { StoryPointsTrendWebviewToHost, StoryPointsTrendHostToWebview } from './story-points-trend-protocol.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'StoryPointsTrendPanel';

/**
 * View type identifier for the story points trend webview.
 */
const VIEW_TYPE = 'gitrx.storyPointsTrendPanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Manages the Story Points Trend WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 */
export class StoryPointsTrendPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: StoryPointsTrendPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private dataService: StoryPointsTrendDataService | undefined;

  /**
   * Create or reveal the Story Points Trend panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Story Points Trend chart panel');

    // If panel exists, reveal it
    if (StoryPointsTrendPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      StoryPointsTrendPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!StoryPointsTrendPanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new story points trend webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Story Points Trend',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    StoryPointsTrendPanel.currentPanel = new StoryPointsTrendPanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing StoryPointsTrendPanel');

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
      (message: StoryPointsTrendWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'StoryPointsTrendPanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating story points trend webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'story-points-trend.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateStoryPointsTrendHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Story points trend webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   * Rate limited to prevent excessive database queries (IQS-947, CWE-770).
   */
  private async handleMessage(message: StoryPointsTrendWebviewToHost): Promise<void> {
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
      await this.ensureDbConnection();

      if (!this.dataService) {
        this.logger.error(CLASS_NAME, 'handleMessage', 'Data service not available after DB init');
        this.postError('Data service unavailable', message.type);
        return;
      }

      switch (message.type) {
        case 'requestStoryPointsTrendData': {
          const dataExists = await this.dataService.checkDataExists();
          if (!dataExists) {
            this.postMessage({
              type: 'storyPointsTrendData',
              rows: [],
              hasData: false,
              dataExists: false,
            });
            break;
          }

          const data = await this.dataService.getChartData({
            team: message.team,
            daysBack: message.daysBack,
          });
          this.postMessage({
            type: 'storyPointsTrendData',
            rows: data.rows,
            hasData: data.hasData,
            dataExists: true,
          });
          break;
        }

        case 'requestStoryPointsTrendTeams': {
          const teamsResponse = await this.dataService.getTeams();
          this.postMessage({
            type: 'storyPointsTrendTeams',
            teams: teamsResponse.teams,
          });
          break;
        }

        default: {
          // Exhaustiveness guard
          const unknownMessage = message as unknown as { type: string };
          this.logger.warn(CLASS_NAME, 'handleMessage', `Unknown message type: ${unknownMessage.type}`);
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
   * Lazily initializes the DatabaseService and StoryPointsTrendDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for story points trend chart');

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

    this.dataService = new StoryPointsTrendDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for story points trend chart');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: StoryPointsTrendHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'storyPointsTrendError',
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
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing StoryPointsTrendPanel');

    StoryPointsTrendPanel.currentPanel = undefined;

    // Reset rate limiter state
    this.rateLimiter.reset();

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down story points trend database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'StoryPointsTrendPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    StoryPointsTrendPanel.currentPanel = undefined;
  }
}
