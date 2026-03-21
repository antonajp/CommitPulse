/**
 * File Author LOC Contribution Report webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Interactive horizontal stacked bar chart showing author contributions per file
 * - Input form for file paths and timeframe selection
 * - Sortable data table with drill-down capability
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Rate limiting on message handlers
 * - Proper disposal and resource cleanup
 *
 * Ticket: GITX-128
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { FileAuthorLocService } from '../../services/file-author-loc-service.js';
import { generateFileAuthorLocHtml } from './file-author-loc-html.js';
import { getSettings } from '../../config/settings.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import { handleSharedMessage } from './shared-message-handlers.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type {
  FileAuthorLocWebviewToHost,
  FileAuthorLocHostToWebview,
} from './file-author-loc-protocol.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'FileAuthorLocPanel';

/**
 * View type identifier for the file author LOC webview.
 */
const VIEW_TYPE = 'gitrx.fileAuthorLocPanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Manages the File Author LOC Contribution WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: GITX-128
 */
export class FileAuthorLocPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: FileAuthorLocPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private dataService: FileAuthorLocService | undefined;

  /**
   * Create or reveal the File Author LOC panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening File Author LOC Contribution panel');

    // If panel exists, reveal it
    if (FileAuthorLocPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      FileAuthorLocPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!FileAuthorLocPanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new file author LOC webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: File Contribution Report',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    FileAuthorLocPanel.currentPanel = new FileAuthorLocPanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing FileAuthorLocPanel');

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
      (message: FileAuthorLocWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'FileAuthorLocPanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating file author LOC webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'file-author-loc.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateFileAuthorLocHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'File author LOC webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   * Rate limited to prevent excessive database queries.
   */
  private async handleMessage(message: FileAuthorLocWebviewToHost): Promise<void> {
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

    try {
      // Handle shared message types (exportCsv, openExternal)
      const handled = await handleSharedMessage(
        message as { type: string },
        this.panel.webview,
        this.logger,
        CLASS_NAME,
      );
      if (handled) {
        return;
      }

      switch (message.type) {
        case 'requestFileAuthorLocData': {
          await this.handleRequestFileAuthorLocData(message);
          break;
        }

        case 'requestFileAuthorDrillDown': {
          await this.handleRequestDrillDown(message);
          break;
        }

        case 'requestRepositories': {
          await this.handleRequestRepositories();
          break;
        }

        case 'openFile': {
          await this.handleOpenFile(message);
          break;
        }

        default: {
          // Exhaustiveness guard
          const _exhaustive: never = message;
          this.logger.warn(
            CLASS_NAME,
            'handleMessage',
            `Unknown message type: ${String((_exhaustive as unknown as Record<string, unknown>).type)}`,
          );
        }
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleMessage', `Error handling ${message.type}: ${errorMsg}`);
      this.postError(errorMsg, message.type);
    }
  }

  /**
   * Handle request for file author LOC contribution data.
   */
  private async handleRequestFileAuthorLocData(message: {
    type: 'requestFileAuthorLocData';
    filePaths: readonly string[];
    startDate?: string;
    endDate?: string;
    repository?: string;
  }): Promise<void> {
    this.logger.debug(
      CLASS_NAME,
      'handleRequestFileAuthorLocData',
      `Processing request for ${message.filePaths.length} files`,
    );

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestFileAuthorLocData', 'Data service not available');
      this.postError('Data service unavailable', message.type);
      return;
    }

    const chartData = await this.dataService.getFileAuthorContributions({
      filePaths: message.filePaths,
      startDate: message.startDate,
      endDate: message.endDate,
      repository: message.repository,
    });

    this.postMessage({
      type: 'fileAuthorLocData',
      rows: chartData.rows,
      hasData: chartData.hasData,
      authors: chartData.authors,
      files: chartData.files,
      dateRange: chartData.dateRange,
    });
  }

  /**
   * Handle request for drill-down commit details.
   */
  private async handleRequestDrillDown(message: {
    type: 'requestFileAuthorDrillDown';
    filename: string;
    author: string;
    startDate: string;
    endDate: string;
  }): Promise<void> {
    this.logger.debug(
      CLASS_NAME,
      'handleRequestDrillDown',
      `Processing drill-down for ${message.filename} by ${message.author}`,
    );

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestDrillDown', 'Data service not available');
      this.postError('Data service unavailable', message.type);
      return;
    }

    const commits = await this.dataService.getCommitDetails(
      message.filename,
      message.author,
      message.startDate,
      message.endDate,
    );

    this.postMessage({
      type: 'fileAuthorDrillDownData',
      commits,
      filename: message.filename,
      author: message.author,
    });
  }

  /**
   * Handle request for available repositories.
   */
  private async handleRequestRepositories(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestRepositories', 'Processing repositories request');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestRepositories', 'Data service not available');
      this.postError('Data service unavailable', 'requestRepositories');
      return;
    }

    const repositories = await this.dataService.getRepositories();

    this.postMessage({
      type: 'repositories',
      repositories,
    });
  }

  /**
   * Handle request to open a file in VS Code.
   * Validates file path is within configured repositories (CWE-22 prevention).
   */
  private async handleOpenFile(message: {
    type: 'openFile';
    filePath: string;
    repository?: string;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleOpenFile', `Opening file: ${message.filePath}`);

    const settings = getSettings();

    // Find the repository configuration
    let repoConfig;
    if (message.repository) {
      repoConfig = settings.repositories.find(r => r.name === message.repository);
    } else {
      // If no repository specified, try to find the file in any configured repository
      for (const repo of settings.repositories) {
        const fullPath = path.join(repo.path, message.filePath);
        if (fs.existsSync(fullPath)) {
          repoConfig = repo;
          break;
        }
      }
    }

    if (!repoConfig) {
      this.logger.warn(CLASS_NAME, 'handleOpenFile', 'Repository not found');
      void vscode.window.showWarningMessage('Gitr: Repository not found in settings.');
      return;
    }

    // Construct full path and validate (CWE-22 prevention)
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
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and FileAuthorLocService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection');

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

    this.dataService = new FileAuthorLocService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: FileAuthorLocHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'fileAuthorLocError',
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
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing FileAuthorLocPanel');

    FileAuthorLocPanel.currentPanel = undefined;

    // Reset rate limiter state
    this.rateLimiter.reset();

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'FileAuthorLocPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    FileAuthorLocPanel.currentPanel = undefined;
  }
}
