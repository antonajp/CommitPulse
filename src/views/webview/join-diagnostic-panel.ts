/**
 * Join Diagnostic Tool webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Message routing between webview and extension host
 * - CSP nonce generation for script authorization
 * - Rate limiting on message handlers
 * - Proper disposal and resource cleanup
 * - CSV export functionality
 *
 * Ticket: GITX-183
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { JoinDiagnosticDataService } from '../../services/join-diagnostic-data-service.js';
import { generateJoinDiagnosticHtml } from './join-diagnostic-html.js';
import { getSettings } from '../../config/settings.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type {
  JoinDiagnosticWebviewToHost,
  JoinDiagnosticHostToWebview,
  ContributorSummary,
  JiraMatchStats,
  UnmatchedIssue,
} from './join-diagnostic-protocol.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'JoinDiagnosticPanel';

/**
 * View type identifier for the join diagnostic webview.
 */
const VIEW_TYPE = 'gitrx.joinDiagnosticPanel';

/**
 * Manages the Join Diagnostic Tool WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 */
export class JoinDiagnosticPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: JoinDiagnosticPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private dataService: JoinDiagnosticDataService | undefined;
  /**
   * Flag to track disposal state and prevent race conditions.
   * When true, incoming messages are ignored to avoid "pool after end" errors.
   */
  private isDisposed = false;

  /**
   * Create or reveal the Join Diagnostic Tool panel.
   * If a panel already exists, it is brought to the front.
   * If no panel exists, a new one is created.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
  ): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Join Diagnostic Tool panel');

    // If panel exists, reveal it
    if (JoinDiagnosticPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      JoinDiagnosticPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Join Diagnostic Tool',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    JoinDiagnosticPanel.currentPanel = new JoinDiagnosticPanel(panel, extensionUri, secretService);
  }

  /**
   * Private constructor — use createOrShow() to create instances.
   */
  private constructor(
    panel: vscode.WebviewPanel,
    _extensionUri: vscode.Uri,
    secretService: SecretStorageService,
  ) {
    this.logger = LoggerService.getInstance();
    this.panel = panel;
    this.secretService = secretService;
    this.rateLimiter = new MessageRateLimiter({
      minIntervalMs: DEFAULT_RATE_LIMIT_INTERVAL_MS,
      className: CLASS_NAME,
    });

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing JoinDiagnosticPanel');

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
      (message: JoinDiagnosticWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'JoinDiagnosticPanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    const html = generateJoinDiagnosticHtml(nonce, webview.cspSource);

    webview.html = html;

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   * Routes each message type to the appropriate data service method.
   * Rate limited to prevent excessive database queries.
   *
   * @param message - The typed message from the webview
   */
  private async handleMessage(message: JoinDiagnosticWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    // Check disposal state to prevent race condition with pool shutdown
    if (this.isDisposed) {
      this.logger.debug(CLASS_NAME, 'handleMessage', `Panel disposed, ignoring message: ${message.type}`);
      return;
    }

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
      // Handle CSV export (no database needed)
      if (message.type === 'exportCsv') {
        await this.exportCsv(message.data, message.filename);
        return;
      }

      // Ensure database connection is established
      await this.ensureDbConnection();

      if (!this.dataService) {
        this.logger.error(CLASS_NAME, 'handleMessage', 'Data service not available after DB init');
        this.postError('Data service unavailable', message.type);
        return;
      }

      switch (message.type) {
        case 'requestAllContributors': {
          const contributors = await this.dataService.getAllContributors();
          // Map to protocol format (camelCase)
          const mappedContributors: ContributorSummary[] = contributors.map(c => ({
            login: c.login,
            fullName: c.fullName,
            jiraName: c.jiraName,
            email: '', // Not available in getAllContributors
            alignmentStatus: c.alignmentStatus,
          }));
          this.postMessage({ type: 'allContributors', contributors: mappedContributors });
          break;
        }

        case 'requestDiagnostics': {
          this.postMessage({ type: 'loading', isLoading: true });

          // Fetch all diagnostic data in parallel
          const [contributor, stats, unmatchedIssues] = await Promise.all([
            this.dataService.getContributorSummary(message.developer),
            this.dataService.getJiraMatchStats(message.developer),
            this.dataService.getUnmatchedIssues(message.developer),
          ]);

          if (!contributor) {
            this.postError(`Contributor not found: ${message.developer}`, 'requestDiagnostics');
            this.postMessage({ type: 'loading', isLoading: false });
            return;
          }

          // Map to protocol format
          const mappedStats: JiraMatchStats = {
            matchedCount: stats.matchedCount,
            matchedStoryPoints: stats.matchedStoryPoints,
            unmatchedCount: stats.unmatchedCount,
            unmatchedStoryPoints: stats.unmatchedStoryPoints,
          };

          const mappedIssues: UnmatchedIssue[] = unmatchedIssues.map(issue => ({
            jiraKey: issue.jiraKey,
            summary: issue.summary,
            jiraAssignee: issue.jiraAssignee,
            contributorFullName: issue.contributorFullName,
            contributorJiraName: issue.contributorJiraName,
            storyPoints: issue.calculatedStoryPoints,
            status: issue.status,
            mismatchReason: issue.mismatchReason,
          }));

          this.postMessage({
            type: 'diagnosticsData',
            contributor,
            stats: mappedStats,
            unmatchedIssues: mappedIssues,
          });

          this.postMessage({ type: 'loading', isLoading: false });
          break;
        }

        case 'requestOrphanedAssignees': {
          const assignees = await this.dataService.getOrphanedAssignees();
          this.postMessage({ type: 'orphanedAssignees', assignees });
          break;
        }

        default: {
          // Exhaustiveness check
          const _exhaustive: never = message;
          this.logger.warn(CLASS_NAME, 'handleMessage', `Unknown message type: ${(_exhaustive as JoinDiagnosticWebviewToHost).type}`);
        }
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleMessage', `Error handling ${message.type}: ${errorMsg}`);
      this.postError(errorMsg, message.type);
      this.postMessage({ type: 'loading', isLoading: false });
    }
  }

  /**
   * Export CSV data to a file and open it in the editor.
   *
   * @param csvData - The CSV content
   * @param filename - The filename to save as
   */
  private async exportCsv(csvData: string, filename: string): Promise<void> {
    // GITX-183: Sanitize filename to prevent path traversal (CWE-22)
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9\-_.]/g, '_');
    this.logger.debug(CLASS_NAME, 'exportCsv', `Exporting CSV: ${sanitizedFilename}`);

    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(sanitizedFilename),
        filters: {
          'CSV Files': ['csv'],
          'All Files': ['*'],
        },
      });

      if (!uri) {
        this.logger.debug(CLASS_NAME, 'exportCsv', 'User cancelled CSV export');
        return;
      }

      await vscode.workspace.fs.writeFile(uri, Buffer.from(csvData, 'utf-8'));
      this.logger.info(CLASS_NAME, 'exportCsv', `CSV exported to: ${uri.fsPath}`);

      // Open the file in the editor
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);

      void vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'exportCsv', `Failed to export CSV: ${errorMsg}`);
      void vscode.window.showErrorMessage(`Failed to export CSV: ${errorMsg}`);
    }
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and JoinDiagnosticDataService.
   * Throws if panel is disposed to prevent pool recreation during disposal.
   */
  private async ensureDbConnection(): Promise<void> {
    // Prevent pool recreation during disposal
    if (this.isDisposed) {
      this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Panel disposed, rejecting connection request');
      throw new Error('Panel is disposed. Cannot establish database connection.');
    }

    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for join diagnostics');

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

    this.dataService = new JoinDiagnosticDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for join diagnostics');
  }

  /**
   * Post a typed message to the webview.
   *
   * @param message - The message to send to the webview
   */
  private postMessage(message: JoinDiagnosticHostToWebview): void {
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
      type: 'error',
      message: errorMessage,
      source,
    });
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
    // Prevent double disposal and set flag FIRST to stop new queries
    if (this.isDisposed) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Panel already disposed, skipping');
      return;
    }
    this.isDisposed = true;
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing JoinDiagnosticPanel');

    JoinDiagnosticPanel.currentPanel = undefined;

    // Reset rate limiter state
    this.rateLimiter.reset();

    // Clear references BEFORE shutdown to prevent new queries
    // Store reference for async shutdown, then clear immediately
    const dbToShutdown = this.db;
    this.db = undefined;
    this.dataService = undefined;

    // Shut down the database connection in background
    // Log any shutdown errors but don't block disposal
    if (dbToShutdown) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down join diagnostic database connection');
      dbToShutdown.shutdown().catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(CLASS_NAME, 'dispose', `DB shutdown error: ${errorMsg}`);
      });
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

    this.logger.debug(CLASS_NAME, 'dispose', 'JoinDiagnosticPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    JoinDiagnosticPanel.currentPanel = undefined;
  }
}
