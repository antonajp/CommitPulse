/**
 * Commit-Jira Linkage webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one linkage panel at a time)
 * - Message routing between webview and extension host
 * - D3.js v7 bundled as a local resource
 * - CSP nonce generation for script authorization
 * - Proper disposal and resource cleanup
 *
 * Tickets: IQS-870, IQS-887
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { LinkageDataService } from '../../services/linkage-data-service.js';
import { generateLinkageHtml } from './linkage-html.js';
import { getSettings } from '../../config/settings.js';
import { validateExternalUrl } from '../../utils/url-validator.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { LinkageWebviewToHost, LinkageHostToWebview } from './linkage-protocol.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'LinkagePanel';

/**
 * View type identifier for the linkage webview.
 */
const VIEW_TYPE = 'gitrx.linkagePanel';

/**
 * Rate limiting configuration for external URL opens.
 * Prevents rapid-fire URL opens which could indicate malicious behavior.
 * Ticket: IQS-925
 */
const RATE_LIMIT_WINDOW_MS = 60000; // 60 seconds
const RATE_LIMIT_MAX_URLS = 5; // Max 5 URLs per window

/**
 * Manages the Commit-Jira Linkage WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 */
export class LinkagePanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: LinkagePanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private db: DatabaseService | undefined;
  private dataService: LinkageDataService | undefined;

  /**
   * Timestamps of recent URL opens for rate limiting.
   * Filtered to retain only timestamps within the rate limit window.
   * Ticket: IQS-925
   */
  private urlOpenTimestamps: number[] = [];

  /**
   * Create or reveal the Linkage panel.
   * If a panel already exists, it is brought to the front.
   * If no panel exists, a new one is created.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Issue Linkage panel');

    // If panel exists, reveal it
    if (LinkagePanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      LinkagePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new linkage webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Issue Linkage',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    LinkagePanel.currentPanel = new LinkagePanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing LinkagePanel');

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
      (message: LinkageWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'LinkagePanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating linkage webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'dashboard.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateLinkageHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Linkage webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   * Routes each message type to the appropriate data service method.
   *
   * @param message - The typed message from the webview
   */
  private async handleMessage(message: LinkageWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    try {
      // Ensure database connection is established
      await this.ensureDbConnection();

      if (!this.dataService) {
        this.logger.error(CLASS_NAME, 'handleMessage', 'Data service not available after DB init');
        this.postError('Data service unavailable', message.type);
        return;
      }

      switch (message.type) {
        case 'requestLinkageSummary': {
          const data = await this.dataService.getLinkageSummary(message.filters);
          this.postMessage({ type: 'linkageSummaryData', data });
          break;
        }

        case 'requestJiraProjectDistribution': {
          const data = await this.dataService.getJiraProjectDistribution(message.filters);
          this.postMessage({ type: 'jiraProjectDistributionData', data });
          break;
        }

        case 'requestJiraStatusFlow': {
          const data = await this.dataService.getJiraStatusFlow(message.filters);
          this.postMessage({ type: 'jiraStatusFlowData', data });
          break;
        }

        case 'requestAssignmentHistory': {
          const data = await this.dataService.getAssignmentHistory(message.filters);
          this.postMessage({ type: 'assignmentHistoryData', data });
          break;
        }

        case 'requestUnlinkedCommits': {
          const data = await this.dataService.getUnlinkedCommits(message.filters);
          this.postMessage({ type: 'unlinkedCommitsData', data });
          break;
        }

        case 'requestLinkageFilterOptions': {
          const data = await this.dataService.getFilterOptions();
          this.postMessage({ type: 'linkageFilterOptionsData', data });
          break;
        }

        case 'openExternal': {
          await this.handleOpenExternal(message.url);
          break;
        }

        default: {
          // Exhaustiveness check: TypeScript will error if a message type is unhandled
          const _exhaustive: never = message;
          this.logger.warn(CLASS_NAME, 'handleMessage', `Unknown message type: ${(_exhaustive as LinkageWebviewToHost).type}`);
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
   * Lazily initializes the DatabaseService and LinkageDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for linkage panel');

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

    this.dataService = new LinkageDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for linkage panel');
  }

  /**
   * Post a typed message to the webview.
   *
   * @param message - The message to send to the webview
   */
  private postMessage(message: LinkageHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   *
   * @param errorMessage - The error description
   * @param source - The request type that caused the error
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'linkageError',
      message: errorMessage,
      source,
    });
  }

  /**
   * Handle opening an external URL in the default browser.
   *
   * Security hardening (IQS-925):
   * - Rate limiting: max 5 URLs per 60 seconds
   * - Domain allowlist validation
   * - Rejects non-http/https schemes
   *
   * @param url - The URL to open
   */
  private async handleOpenExternal(url: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleOpenExternal', `Attempting to open external URL: ${url}`);

    // Rate limiting check (IQS-925)
    const now = Date.now();
    this.urlOpenTimestamps = this.urlOpenTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    if (this.urlOpenTimestamps.length >= RATE_LIMIT_MAX_URLS) {
      this.logger.warn(CLASS_NAME, 'handleOpenExternal', `Rate limit exceeded: ${this.urlOpenTimestamps.length} URLs in window`);
      void vscode.window.showWarningMessage(
        'Gitr: Too many URLs opened recently. Please wait a moment before trying again.',
      );
      return;
    }

    // URL validation with domain allowlist
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
   * Generate a cryptographic nonce for CSP script authorization.
   *
   * @returns A 32-character hex nonce string
   */
  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Dispose the panel and all its resources.
   * Shuts down the database connection if one was opened.
   */
  dispose(): void {
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing LinkagePanel');

    LinkagePanel.currentPanel = undefined;

    // Shut down the database connection
    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down linkage database connection');
      void this.db.shutdown();
      this.db = undefined;
      this.dataService = undefined;
    }

    // Dispose the webview panel
    this.panel.dispose();

    // Dispose all subscriptions
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }

    this.logger.debug(CLASS_NAME, 'dispose', 'LinkagePanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    LinkagePanel.currentPanel = undefined;
  }
}
