/**
 * Knowledge Concentration dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Interactive treemap: rectangles sized by LOC, colored by risk
 * - Click to open file in VS Code or filter by contributor
 * - Zoom into modules with breadcrumb navigation
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-904
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { KnowledgeConcentrationDataService } from '../../services/knowledge-concentration-service.js';
import { generateKnowledgeHtml } from './knowledge-html.js';
import { getSettings } from '../../config/settings.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { KnowledgeWebviewToHost, KnowledgeHostToWebview } from './knowledge-protocol.js';
import type { ConcentrationRisk } from '../../services/knowledge-concentration-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'KnowledgePanel';

/**
 * View type identifier for the knowledge concentration webview.
 */
const VIEW_TYPE = 'gitrx.knowledgePanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Manages the Knowledge Concentration WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: IQS-904
 */
export class KnowledgePanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: KnowledgePanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private db: DatabaseService | undefined;
  private dataService: KnowledgeConcentrationDataService | undefined;

  /**
   * Create or reveal the Knowledge Concentration panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Knowledge Concentration panel');

    // If panel exists, reveal it
    if (KnowledgePanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      KnowledgePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!KnowledgePanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new knowledge concentration webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Knowledge Concentration',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    KnowledgePanel.currentPanel = new KnowledgePanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing KnowledgePanel');

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
      (message: KnowledgeWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'KnowledgePanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating knowledge concentration webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'knowledge.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateKnowledgeHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Knowledge concentration webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   */
  private async handleMessage(message: KnowledgeWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    try {
      switch (message.type) {
        case 'requestFileOwnershipData': {
          await this.handleRequestFileOwnershipData(message);
          break;
        }

        case 'requestModuleBusFactorData': {
          await this.handleRequestModuleBusFactorData(message);
          break;
        }

        case 'requestHighRiskModules': {
          await this.handleRequestHighRiskModules();
          break;
        }

        case 'requestKnowledgeSummary': {
          await this.handleRequestKnowledgeSummary();
          break;
        }

        case 'requestKnowledgeRefresh': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Refresh requested');
          await this.handleRequestFileOwnershipData({ type: 'requestFileOwnershipData' });
          break;
        }

        case 'openFile': {
          await this.handleOpenFile(message);
          break;
        }

        case 'filterByContributor': {
          await this.handleFilterByContributor(message);
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
   * Handle request for file ownership data.
   */
  private async handleRequestFileOwnershipData(message: {
    type: 'requestFileOwnershipData';
    repository?: string;
    concentrationRisk?: ConcentrationRisk;
    contributor?: string;
    maxBusFactor?: number;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestFileOwnershipData', 'Processing requestFileOwnershipData');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestFileOwnershipData', 'Data service not available after DB init');
      this.postError('Data service unavailable', message.type);
      return;
    }

    const chartData = await this.dataService.getChartData({
      repository: message.repository,
      concentrationRisk: message.concentrationRisk,
      contributor: message.contributor,
      maxBusFactor: message.maxBusFactor,
    });

    // Extract unique repositories from data
    const repositories = [...new Set(chartData.rows.map(r => r.repository))].sort();

    // Extract unique contributors from data
    const contributors = [...new Set([
      ...chartData.rows.map(r => r.topContributor),
      ...chartData.rows.filter(r => r.secondContributor).map(r => r.secondContributor as string),
    ])].sort();

    this.postMessage({
      type: 'fileOwnershipData',
      rows: chartData.rows,
      hasData: chartData.hasData,
      viewExists: chartData.viewExists,
    });

    // Send repositories and contributors separately for filter dropdowns
    this.postMessage({
      type: 'repositories',
      repositories,
    });

    this.postMessage({
      type: 'contributors',
      contributors,
    });
  }

  /**
   * Handle request for module bus factor data.
   */
  private async handleRequestModuleBusFactorData(message: {
    type: 'requestModuleBusFactorData';
    repository?: string;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestModuleBusFactorData', 'Processing requestModuleBusFactorData');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestModuleBusFactorData', 'Data service not available');
      this.postError('Data service unavailable', message.type);
      return;
    }

    const chartData = await this.dataService.getModuleChartData({
      repository: message.repository,
    });

    this.postMessage({
      type: 'moduleBusFactorData',
      rows: chartData.rows,
      hasData: chartData.hasData,
      viewExists: chartData.viewExists,
    });
  }

  /**
   * Handle request for high-risk modules.
   */
  private async handleRequestHighRiskModules(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestHighRiskModules', 'Processing requestHighRiskModules');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestHighRiskModules', 'Data service not available');
      this.postError('Data service unavailable', 'requestHighRiskModules');
      return;
    }

    const viewExists = await this.dataService.checkModuleViewExists();
    if (!viewExists) {
      this.postMessage({
        type: 'moduleBusFactorData',
        rows: [],
        hasData: false,
        viewExists: false,
      });
      return;
    }

    const rows = await this.dataService.getHighRiskModules();

    this.postMessage({
      type: 'moduleBusFactorData',
      rows,
      hasData: rows.length > 0,
      viewExists: true,
    });
  }

  /**
   * Handle request for knowledge concentration summary statistics.
   */
  private async handleRequestKnowledgeSummary(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestKnowledgeSummary', 'Processing requestKnowledgeSummary');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestKnowledgeSummary', 'Data service not available');
      this.postError('Data service unavailable', 'requestKnowledgeSummary');
      return;
    }

    const summary = await this.dataService.getSummary();
    this.postMessage({
      type: 'knowledgeSummary',
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
   * Handle request to filter by contributor.
   * Reloads the treemap showing only files owned by the specified contributor.
   */
  private async handleFilterByContributor(message: { type: 'filterByContributor'; contributor: string }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleFilterByContributor', `Filtering by contributor: ${message.contributor}`);

    await this.handleRequestFileOwnershipData({
      type: 'requestFileOwnershipData',
      contributor: message.contributor,
    });
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and KnowledgeConcentrationDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for knowledge concentration');

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

    this.dataService = new KnowledgeConcentrationDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for knowledge concentration');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: KnowledgeHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'knowledgeError',
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
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing KnowledgePanel');

    KnowledgePanel.currentPanel = undefined;

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down knowledge concentration database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'KnowledgePanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    KnowledgePanel.currentPanel = undefined;
  }
}
