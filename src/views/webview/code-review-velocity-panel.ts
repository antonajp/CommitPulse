/**
 * Code Review Velocity dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Interactive scatter plot: X=LOC, Y=hours to merge
 * - Point size = review cycles, point color = repository/size category
 * - Click to open PR in GitHub or linked ticket
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Rate limiting on message handlers (IQS-947)
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-900, IQS-947
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { CodeReviewVelocityDataService } from '../../services/code-review-velocity-service.js';
import { generateCodeReviewVelocityHtml } from './code-review-velocity-html.js';
import { getSettings } from '../../config/settings.js';
import { validateExternalUrl } from '../../utils/url-validator.js';
import { buildIssueUrl } from '../../utils/url-builder.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import { handleSharedMessage } from './shared-message-handlers.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { CodeReviewWebviewToHost, CodeReviewHostToWebview } from './code-review-protocol.js';

/**
 * Extended message types for click actions from webview.
 * Ticket: IQS-926
 */
interface OpenTicketMessage {
  readonly type: 'openTicket';
  readonly ticketId: string;
  readonly ticketType: string;
  readonly jiraUrlPrefix: string;
  readonly linearUrlPrefix: string;
}

interface OpenExternalMessage {
  readonly type: 'openExternal';
  readonly url: string;
}

type CodeReviewClickMessage = OpenTicketMessage | OpenExternalMessage;

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'CodeReviewVelocityPanel';

/**
 * View type identifier for the code review velocity webview.
 */
const VIEW_TYPE = 'gitrx.codeReviewVelocityPanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Rate limiting configuration for external URL opens.
 * Prevents rapid-fire URL opens which could indicate malicious behavior.
 * Ticket: IQS-926
 */
const RATE_LIMIT_WINDOW_MS = 60000; // 60 seconds
const RATE_LIMIT_MAX_URLS = 5; // Max 5 URLs per window

/**
 * Manages the Code Review Velocity WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: IQS-900
 */
export class CodeReviewVelocityPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: CodeReviewVelocityPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private dataService: CodeReviewVelocityDataService | undefined;

  /**
   * Timestamps of recent URL opens for rate limiting.
   * Filtered to retain only timestamps within the rate limit window.
   * Ticket: IQS-926
   */
  private urlOpenTimestamps: number[] = [];

  /**
   * Create or reveal the Code Review Velocity panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Code Review Velocity chart panel');

    // If panel exists, reveal it
    if (CodeReviewVelocityPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      CodeReviewVelocityPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!CodeReviewVelocityPanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new code review velocity webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Code Review Velocity',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    CodeReviewVelocityPanel.currentPanel = new CodeReviewVelocityPanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing CodeReviewVelocityPanel');

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
      (message: CodeReviewWebviewToHost | CodeReviewClickMessage) => {
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
        // Handle click actions (non-data messages)
        if (message.type === 'openTicket') {
          void this.handleOpenTicket(message);
          return;
        }
        if (message.type === 'openExternal') {
          void this.handleOpenExternal(message.url);
          return;
        }
        // Handle data messages
        void this.handleMessage(message as CodeReviewWebviewToHost);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'CodeReviewVelocityPanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating code review velocity webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'code-review-velocity.css'),
    );

    // Get GitHub organization from settings for PR link generation
    const settings = getSettings();
    const githubOrg = settings.github.organization || '';

    // Get settings for issue tracker URL prefixes (IQS-926)
    const jiraUrlPrefix = settings.jira?.urlPrefix || settings.jira?.server || '';
    const linearUrlPrefix = settings.linear?.urlPrefix || '';

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `GitHub Org: ${githubOrg}`);

    webview.html = generateCodeReviewVelocityHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
      githubOrg,
      jiraUrlPrefix,
      linearUrlPrefix,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Code review velocity webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   * Rate limited to prevent excessive database queries (IQS-947, CWE-770).
   */
  private async handleMessage(message: CodeReviewWebviewToHost): Promise<void> {
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
        case 'requestCodeReviewData': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestCodeReviewData');
          const viewExists = await this.dataService.checkViewExists();
          if (!viewExists) {
            this.postMessage({
              type: 'codeReviewData',
              rows: [],
              hasData: false,
              viewExists: false,
            });
            break;
          }

          const data = await this.dataService.getChartData({
            startDate: message.startDate,
            endDate: message.endDate,
            repository: message.repository,
            author: message.author,
            sizeCategory: message.sizeCategory,
          });
          this.postMessage({
            type: 'codeReviewData',
            rows: data.rows,
            hasData: data.hasData,
            viewExists: true,
          });
          break;
        }

        case 'requestMergedPRData': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestMergedPRData');
          const mergedData = await this.dataService.getMergedPRMetrics({
            startDate: message.startDate,
            endDate: message.endDate,
          });
          this.postMessage({
            type: 'mergedPRData',
            rows: mergedData,
            hasData: mergedData.length > 0,
          });
          break;
        }

        case 'requestAvgByRepository': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestAvgByRepository');
          const avgByRepo = await this.dataService.getAvgMetricsByRepository({
            startDate: message.startDate,
            endDate: message.endDate,
          });
          this.postMessage({
            type: 'avgByRepository',
            rows: avgByRepo,
            hasData: avgByRepo.length > 0,
          });
          break;
        }

        case 'requestAvgByAuthor': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestAvgByAuthor');
          const avgByAuthor = await this.dataService.getAvgMetricsByAuthor({
            startDate: message.startDate,
            endDate: message.endDate,
          });
          this.postMessage({
            type: 'avgByAuthor',
            rows: avgByAuthor,
            hasData: avgByAuthor.length > 0,
          });
          break;
        }

        case 'requestAvgBySize': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestAvgBySize');
          const avgBySize = await this.dataService.getAvgMetricsBySize({
            startDate: message.startDate,
            endDate: message.endDate,
          });
          this.postMessage({
            type: 'avgBySize',
            rows: avgBySize,
            hasData: avgBySize.length > 0,
          });
          break;
        }

        case 'requestPRStats': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestPRStats');
          const stats = await this.dataService.getPRStats();
          this.postMessage({
            type: 'prStats',
            stats,
          });
          break;
        }

        case 'requestPRSync': {
          // PR sync is not handled here - it requires a separate command
          this.logger.debug(CLASS_NAME, 'handleMessage', 'PR sync requested - not implemented in panel');
          this.postError('PR sync not available from dashboard. Use "Gitr: Sync PRs from GitHub" command.', message.type);
          break;
        }

        // Shared message types handled by handleSharedMessage before switch
        case 'exportCsv':
        case 'openExternal':
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
   * Lazily initializes the DatabaseService and CodeReviewVelocityDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for code review velocity');

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

    this.dataService = new CodeReviewVelocityDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for code review velocity');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: CodeReviewHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'codeReviewError',
      message: errorMessage,
      source,
    });
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
   * Handle opening an external URL in the default browser.
   *
   * Security hardening (IQS-926):
   * - Rate limiting: max 5 URLs per 60 seconds
   * - Domain allowlist validation
   * - Rejects non-http/https schemes
   *
   * @param url - The URL to open
   */
  private async handleOpenExternal(url: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleOpenExternal', `Attempting to open external URL: ${url}`);

    // Rate limiting check (IQS-926)
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
   */
  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Dispose the panel and all its resources.
   */
  dispose(): void {
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing CodeReviewVelocityPanel');

    CodeReviewVelocityPanel.currentPanel = undefined;

    // Reset rate limiter state
    this.rateLimiter.reset();

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down code review velocity database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'CodeReviewVelocityPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    CodeReviewVelocityPanel.currentPanel = undefined;
  }
}
