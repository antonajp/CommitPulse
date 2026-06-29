/**
 * Developer Profile Dashboard webview panel manager.
 * Creates and manages VS Code WebviewPanels with:
 * - Multi-instance pattern (multiple panels can be open simultaneously for different developers)
 * - Message routing between webview and extension host
 * - D3.js v7 bundled as a local resource
 * - CSP nonce generation for script authorization
 * - Rate limiting on message handlers
 * - Proper disposal and resource cleanup
 * - Pre-selection of developer when opened from TreeView (accepts login, webview converts to full_name)
 * - Developer filtering by full_name (with login fallback - GITX-169)
 * - Shared dashboard cache service across all instances (GITX-194, GITX-195)
 *
 * Ticket: GITX-155, GITX-169, GITX-195
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { DevProfileDataService } from '../../services/dev-profile-data-service.js';
import { generateDevProfileHtml } from './dev-profile-html.js';
import { getSettings } from '../../config/settings.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type {
  DevProfileWebviewToHost,
  DevProfileHostToWebview,
  DevProfileTimeframe,
} from './dev-profile-protocol.js';
// GITX-195: DashboardCacheService is used internally by DevProfileDataService (singleton pattern)

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DevProfilePanel';

/**
 * View type identifier for the developer profile webview.
 */
const VIEW_TYPE = 'gitrx.devProfilePanel';

/**
 * Manages the Developer Profile Dashboard WebviewPanel lifecycle.
 * GITX-195: Implements multi-instance pattern - multiple panels can be open simultaneously
 * for different developers, enabling side-by-side comparison.
 */
export class DevProfilePanel implements vscode.Disposable {
  /**
   * Track all active panel instances for testing and cleanup.
   * GITX-195: Replaces singleton pattern with collection for multi-instance support.
   */
  private static activePanels: Set<DevProfilePanel> = new Set();

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private dataService: DevProfileDataService | undefined;
  private selectedDeveloper: string | null = null;
  private selectedTimeframe: DevProfileTimeframe = '90';
  /**
   * Flag to track disposal state and prevent race conditions.
   * When true, incoming messages are ignored to avoid "pool after end" errors.
   * GITX-175: Fixes race condition between panel disposal and active database queries.
   */
  private isDisposed = false;

  /**
   * Create a new Developer Profile panel.
   * GITX-195: Always creates a new panel instance (no singleton). Multiple panels can be open
   * simultaneously for different developers, enabling side-by-side comparison.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   * @param developer - Optional pre-selected developer login (used in panel title)
   * @returns The newly created DevProfilePanel instance
   */
  static create(
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
    developer?: string,
  ): DevProfilePanel {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'create', `Creating new Developer Profile panel${developer ? ` for ${developer}` : ''}`);

    // GITX-195: Determine view column - open beside if another editor/panel is active
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    logger.debug(CLASS_NAME, 'create', `Creating new webview panel in column ${column}`);

    // GITX-195: Panel title includes developer name for identification
    const panelTitle = developer ? `Dev Profile: ${developer}` : 'Developer Profile';

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      panelTitle,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    return new DevProfilePanel(panel, extensionUri, secretService, developer);
  }

  /**
   * @deprecated Use create() instead. This method exists for backward compatibility
   * but will be removed in a future version.
   * GITX-195: createOrShow is replaced by create() for multi-instance support.
   */
  static createOrShow(
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
    developer?: string,
  ): void {
    // Delegate to create() for backward compatibility
    DevProfilePanel.create(extensionUri, secretService, developer);
  }

  /**
   * Private constructor — use create() to create instances.
   * GITX-195: Each instance has independent state and shares the cache service.
   */
  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
    developer?: string,
  ) {
    this.logger = LoggerService.getInstance();
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.secretService = secretService;
    this.selectedDeveloper = developer ?? null;
    this.rateLimiter = new MessageRateLimiter({
      minIntervalMs: DEFAULT_RATE_LIMIT_INTERVAL_MS,
      className: CLASS_NAME,
    });
    // GITX-195: Cache service is shared via singleton - accessed through DevProfileDataService

    this.logger.debug(CLASS_NAME, 'constructor', `Initializing DevProfilePanel for developer: ${developer ?? 'none'}`);

    // GITX-195: Track this panel in the active set
    DevProfilePanel.activePanels.add(this);
    this.logger.debug(CLASS_NAME, 'constructor', `Active panels count: ${DevProfilePanel.activePanels.size}`);

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
      (message: DevProfileWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    // Send initial state to webview after a short delay to ensure it's ready
    setTimeout(() => {
      this.postMessage({
        type: 'initialState',
        developer: this.selectedDeveloper,
        timeframeDays: this.selectedTimeframe,
      });
    }, 100);

    this.logger.info(CLASS_NAME, 'constructor', `DevProfilePanel initialized successfully for: ${developer ?? 'no developer'}`);
  }

  /**
   * Set the selected developer, update the panel title, and notify the webview.
   * GITX-195: Updates panel title to reflect the selected developer.
   */
  private setDeveloper(developer: string): void {
    this.logger.debug(CLASS_NAME, 'setDeveloper', `Setting developer to: ${developer}`);
    this.selectedDeveloper = developer;

    // GITX-195: Update panel title to include developer name
    this.panel.title = `Dev Profile: ${developer}`;

    this.postMessage({
      type: 'initialState',
      developer: this.selectedDeveloper,
      timeframeDays: this.selectedTimeframe,
    });
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'dev-profile.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    const html = generateDevProfileHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

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
  private async handleMessage(message: DevProfileWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    // GITX-175: Check disposal state to prevent race condition with pool shutdown
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
      // Handle file open request (no database needed)
      if (message.type === 'openFile') {
        this.logger.debug(CLASS_NAME, 'handleMessage', `Opening file: ${message.filePath}`);
        await this.openFileInEditor(message.filePath, message.repository);
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
        case 'requestDevelopers': {
          const data = await this.dataService.getDevelopers();
          this.postMessage({ type: 'developersData', data });
          break;
        }

        case 'requestSummary': {
          const data = await this.dataService.getSummary({
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'summaryData', data });
          break;
        }

        case 'requestLocPerWeek': {
          const data = await this.dataService.getLocPerWeek({
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'locPerWeekData', data });
          break;
        }

        case 'requestTopComplexFiles': {
          const data = await this.dataService.getTopComplexFiles({
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'topComplexFilesData', data });
          break;
        }

        case 'requestTopFrequentFiles': {
          const data = await this.dataService.getTopFrequentFiles({
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'topFrequentFilesData', data });
          break;
        }

        case 'requestAllData': {
          // Request all data in parallel (including GITX-156 + GITX-157 + GITX-172 charts)
          // GITX-195: Use setDeveloper to update title and state together
          this.setDeveloper(message.developer);
          this.selectedTimeframe = message.timeframeDays;
          const filters = {
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          };
          // GITX-157: Added velocityVsLoc and hasVelocityData
          const [summary, locPerWeek, complexFiles, frequentFiles, techStack, commentsPerWeek, testsPerWeek, hygieneScore, velocityVsLoc, hasVelocityData] = await Promise.all([
            this.dataService.getSummary(filters),
            this.dataService.getLocPerWeek(filters),
            this.dataService.getTopComplexFiles(filters),
            this.dataService.getTopFrequentFiles(filters),
            this.dataService.getTechStack(filters),
            this.dataService.getCommentsPerWeek(filters),
            this.dataService.getTestsPerWeek(filters),
            this.dataService.getHygieneScore(filters),
            this.dataService.getVelocityVsLoc(filters),
            this.dataService.hasVelocityData(filters.developer),
          ]);
          this.postMessage({ type: 'summaryData', data: summary });
          this.postMessage({ type: 'locPerWeekData', data: locPerWeek });
          this.postMessage({ type: 'topComplexFilesData', data: complexFiles });
          this.postMessage({ type: 'topFrequentFilesData', data: frequentFiles });
          this.postMessage({ type: 'techStackData', data: techStack });
          this.postMessage({ type: 'commentsPerWeekData', data: commentsPerWeek });
          this.postMessage({ type: 'testsPerWeekData', data: testsPerWeek });
          this.postMessage({ type: 'hygieneScoreData', data: hygieneScore });
          // GITX-157: Send velocity data and availability status
          this.postMessage({ type: 'velocityVsLocData', data: velocityVsLoc });
          this.postMessage({ type: 'hasVelocityData', hasData: hasVelocityData });
          break;
        }

        case 'requestTechStack': {
          const data = await this.dataService.getTechStack({
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'techStackData', data });
          break;
        }

        // GITX-214: Technology stack by file extension
        case 'requestTechStackByExtension': {
          const data = await this.dataService.getTechStackByExtension({
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'techStackByExtensionData', data });
          break;
        }

        case 'requestCommentsPerWeek': {
          const data = await this.dataService.getCommentsPerWeek({
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'commentsPerWeekData', data });
          break;
        }

        case 'requestTestsPerWeek': {
          const data = await this.dataService.getTestsPerWeek({
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'testsPerWeekData', data });
          break;
        }

        case 'requestHygieneScore': {
          const data = await this.dataService.getHygieneScore({
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'hygieneScoreData', data });
          break;
        }

        case 'requestVelocityVsLoc': {
          // GITX-157: Sprint velocity vs LOC chart data
          const data = await this.dataService.getVelocityVsLoc({
            developer: message.developer,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'velocityVsLocData', data });
          break;
        }

        case 'requestHasVelocityData': {
          // GITX-157: Check if velocity data is available
          const hasData = await this.dataService.hasVelocityData(message.developer);
          this.postMessage({ type: 'hasVelocityData', hasData });
          break;
        }

        default: {
          // Exhaustiveness check
          const _exhaustive: never = message;
          this.logger.warn(CLASS_NAME, 'handleMessage', `Unknown message type: ${(_exhaustive as DevProfileWebviewToHost).type}`);
        }
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleMessage', `Error handling ${message.type}: ${errorMsg}`);
      this.postError(errorMsg, message.type);
    }
  }

  /**
   * Open a file in the VS Code editor.
   *
   * @param filePath - The file path to open
   * @param repository - The repository name (used to resolve full path)
   */
  private async openFileInEditor(filePath: string, repository: string): Promise<void> {
    // Try to find the file in workspace folders or configured repositories
    const settings = getSettings();
    const repoConfig = settings.repositories.find((r) => r.name === repository);

    if (repoConfig) {
      const fullPath = vscode.Uri.file(`${repoConfig.path}/${filePath}`);
      try {
        const doc = await vscode.workspace.openTextDocument(fullPath);
        await vscode.window.showTextDocument(doc);
        this.logger.debug(CLASS_NAME, 'openFileInEditor', `Opened file: ${fullPath.fsPath}`);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(CLASS_NAME, 'openFileInEditor', `Could not open file: ${errorMsg}`);
        void vscode.window.showWarningMessage(`Could not open file: ${filePath}`);
      }
    } else {
      this.logger.warn(CLASS_NAME, 'openFileInEditor', `Repository not found in settings: ${repository}`);
      void vscode.window.showWarningMessage(`Repository "${repository}" not found in settings. Cannot open file.`);
    }
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and DevProfileDataService.
   * GITX-175: Throws if panel is disposed to prevent pool recreation during disposal.
   */
  private async ensureDbConnection(): Promise<void> {
    // GITX-175: Prevent pool recreation during disposal
    if (this.isDisposed) {
      this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Panel disposed, rejecting connection request');
      throw new Error('Panel is disposed. Cannot establish database connection.');
    }

    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for developer profile');

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

    this.dataService = new DevProfileDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for developer profile');
  }

  /**
   * Post a typed message to the webview.
   *
   * @param message - The message to send to the webview
   */
  private postMessage(message: DevProfileHostToWebview): void {
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
   * GITX-195: Removes panel from active set instead of clearing singleton.
   */
  dispose(): void {
    // GITX-175: Prevent double disposal and set flag FIRST to stop new queries
    if (this.isDisposed) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Panel already disposed, skipping');
      return;
    }
    this.isDisposed = true;
    this.logger.info(CLASS_NAME, 'dispose', `Disposing DevProfilePanel for: ${this.selectedDeveloper ?? 'no developer'}`);

    // GITX-195: Remove from active panels set instead of clearing singleton
    DevProfilePanel.activePanels.delete(this);
    this.logger.debug(CLASS_NAME, 'dispose', `Active panels remaining: ${DevProfilePanel.activePanels.size}`);

    // Reset rate limiter state
    this.rateLimiter.reset();

    // GITX-175: Clear references BEFORE shutdown to prevent new queries
    // Store reference for async shutdown, then clear immediately
    const dbToShutdown = this.db;
    this.db = undefined;
    this.dataService = undefined;

    // Shut down the database connection in background
    // Log any shutdown errors but don't block disposal
    if (dbToShutdown) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down developer profile database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'DevProfilePanel disposed');
  }

  /**
   * Reset all panel tracking for testing purposes.
   * GITX-195: Clears the active panels set instead of singleton.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    DevProfilePanel.activePanels.clear();
  }

  /**
   * Get the count of active panels.
   * GITX-195: Useful for testing and debugging multi-instance behavior.
   * @returns The number of currently active DevProfilePanel instances
   */
  static getActivePanelCount(): number {
    return DevProfilePanel.activePanels.size;
  }

  /**
   * Get the developer identifier for this panel.
   * GITX-195: Useful for testing panel state.
   * @returns The selected developer or null
   */
  getDeveloper(): string | null {
    return this.selectedDeveloper;
  }

  /**
   * Get the timeframe for this panel.
   * GITX-195: Useful for testing panel state.
   * @returns The selected timeframe
   */
  getTimeframe(): DevProfileTimeframe {
    return this.selectedTimeframe;
  }
}
