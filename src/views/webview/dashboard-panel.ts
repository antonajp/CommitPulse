/**
 * Metrics Dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one dashboard panel at a time)
 * - Message routing between webview and extension host
 * - D3.js v7 bundled as a local resource
 * - CSP nonce generation for script authorization
 * - Rate limiting on message handlers (IQS-947)
 * - Proper disposal and resource cleanup
 *
 * Tickets: IQS-869, IQS-887, IQS-947
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { DashboardDataService } from '../../services/dashboard-data-service.js';
import { LocDataService } from '../../services/loc-data-service.js';
import { ComplexityDataService } from '../../services/complexity-data-service.js';
import { FileChurnDataService } from '../../services/file-churn-data-service.js';
import { DevPipelineDataService } from '../../services/dev-pipeline-data-service.js';
import { generateDashboardHtml } from './dashboard-html.js';
import { getSettings } from '../../config/settings.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { WebviewToHost, HostToWebview } from './protocol.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DashboardPanel';

/**
 * View type identifier for the dashboard webview.
 */
const VIEW_TYPE = 'gitrx.dashboardPanel';

/**
 * Manages the Metrics Dashboard WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 */
export class DashboardPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: DashboardPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private dataService: DashboardDataService | undefined;
  private locDataService: LocDataService | undefined;
  private complexityDataService: ComplexityDataService | undefined;
  private fileChurnDataService: FileChurnDataService | undefined;
  private devPipelineDataService: DevPipelineDataService | undefined;

  /**
   * Create or reveal the Metrics Dashboard panel.
   * If a panel already exists, it is brought to the front.
   * If no panel exists, a new one is created.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Metrics Dashboard panel');

    // If panel exists, reveal it
    if (DashboardPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      DashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Metrics Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, secretService);
  }

  /**
   * Private constructor — use createOrShow() to create instances.
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing DashboardPanel');

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
      (message: WebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'DashboardPanel initialized successfully');
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
      vscode.Uri.joinPath(this.extensionUri, 'media', 'dashboard.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateDashboardHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   * Routes each message type to the appropriate data service method.
   * Rate limited to prevent excessive database queries (IQS-947, CWE-770).
   *
   * @param message - The typed message from the webview
   */
  private async handleMessage(message: WebviewToHost): Promise<void> {
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
      // Ensure database connection is established
      await this.ensureDbConnection();

      if (!this.dataService) {
        this.logger.error(CLASS_NAME, 'handleMessage', 'Data service not available after DB init');
        this.postError('Data service unavailable', message.type);
        return;
      }

      switch (message.type) {
        case 'requestCommitVelocity': {
          const data = await this.dataService.getCommitVelocity(
            message.granularity,
            message.filters,
          );
          this.postMessage({
            type: 'commitVelocityData',
            data,
            granularity: message.granularity,
          });
          break;
        }

        case 'requestTechStack': {
          const data = await this.dataService.getTechStackDistribution();
          this.postMessage({ type: 'techStackData', data });
          break;
        }

        case 'requestScorecard': {
          const data = await this.dataService.getScorecard(message.filters);
          this.postMessage({ type: 'scorecardData', data });
          break;
        }

        case 'requestScorecardDetail': {
          // IQS-942: Use getScorecardDetailWithProfiles to include contributor profile badges
          const data = await this.dataService.getScorecardDetailWithProfiles(message.filters);
          this.postMessage({ type: 'scorecardDetailData', data });
          break;
        }

        case 'requestFileComplexity': {
          const data = await this.dataService.getFileComplexityTrends(
            message.topN,
            message.filters,
          );
          this.postMessage({ type: 'fileComplexityData', data });
          break;
        }

        case 'requestLocCommitted': {
          if (!this.locDataService) {
            this.logger.error(CLASS_NAME, 'handleMessage', 'LOC data service not available after DB init');
            this.postError('LOC data service unavailable', message.type);
            return;
          }
          const data = await this.locDataService.getLocCommitted(
            message.groupBy,
            message.filters,
          );
          this.postMessage({
            type: 'locCommittedData',
            data,
            groupBy: message.groupBy,
          });
          break;
        }

        case 'requestFilterOptions': {
          const data = await this.dataService.getFilterOptions();
          this.postMessage({ type: 'filterOptionsData', data });
          break;
        }

        case 'requestTopComplexFiles': {
          if (!this.complexityDataService) {
            this.logger.error(CLASS_NAME, 'handleMessage', 'Complexity data service not available after DB init');
            this.postError('Complexity data service unavailable', message.type);
            return;
          }
          const data = await this.complexityDataService.getTopComplexFiles(
            message.groupBy,
            message.topN,
            message.filters,
          );
          this.postMessage({
            type: 'topComplexFilesData',
            data,
            groupBy: message.groupBy,
          });
          break;
        }

        case 'requestFileChurn': {
          if (!this.fileChurnDataService) {
            this.logger.error(CLASS_NAME, 'handleMessage', 'File churn data service not available after DB init');
            this.postError('File churn data service unavailable', message.type);
            return;
          }
          const data = await this.fileChurnDataService.getTopFilesByChurn(
            message.groupBy,
            message.topN,
            message.filters,
          );
          this.postMessage({
            type: 'fileChurnData',
            data,
            groupBy: message.groupBy,
          });
          break;
        }

        case 'requestFileChurnDrillDown': {
          if (!this.fileChurnDataService) {
            this.logger.error(CLASS_NAME, 'handleMessage', 'File churn data service not available after DB init');
            this.postError('File churn data service unavailable', message.type);
            return;
          }
          const data = await this.fileChurnDataService.getFileChurnDrilldown(
            message.filename,
            message.contributor,
            message.groupBy,
            message.filters,
          );
          this.postMessage({
            type: 'fileChurnDrillDownData',
            data,
            filename: message.filename,
            contributor: message.contributor,
          });
          break;
        }

        case 'requestDevPipelineTeamList': {
          if (!this.devPipelineDataService) {
            this.logger.error(CLASS_NAME, 'handleMessage', 'Dev pipeline data service not available after DB init');
            this.postError('Dev pipeline data service unavailable', message.type);
            return;
          }
          try {
            const teams = await this.devPipelineDataService.getUniqueTeams();
            this.postMessage({
              type: 'devPipelineTeamList',
              teams,
            });
            this.logger.debug(CLASS_NAME, 'handleMessage', `Sent ${teams.length} teams for dev pipeline filter`);
          } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger.error(CLASS_NAME, 'handleMessage', `Failed to fetch dev pipeline teams: ${errorMsg}`);
            this.postMessage({
              type: 'devPipelineTeamList',
              teams: [],
            });
          }
          break;
        }

        case 'requestDevPipelineWeeklyMetrics': {
          if (!this.devPipelineDataService) {
            this.logger.error(CLASS_NAME, 'handleMessage', 'Dev pipeline data service not available after DB init');
            this.postError('Dev pipeline data service unavailable', message.type);
            return;
          }

          // Validate team is provided
          if (!message.team || message.team.trim().length === 0) {
            const errorMsg = 'Team filter is required for developer pipeline metrics';
            this.logger.warn(CLASS_NAME, 'handleMessage', errorMsg);
            this.postMessage({
              type: 'devPipelineWeeklyMetrics',
              data: [],
              error: errorMsg,
            });
            return;
          }

          // Apply default date range if not provided (last 8 weeks)
          let startDate = message.startDate;
          let endDate = message.endDate;
          if (!startDate || !endDate) {
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 56); // 8 weeks
            startDate = start.toISOString().split('T')[0] ?? '';
            endDate = end.toISOString().split('T')[0] ?? '';
            this.logger.debug(
              CLASS_NAME,
              'handleMessage',
              `Applied default date range for dev pipeline: ${startDate} to ${endDate}`
            );
          }

          try {
            const serviceData = await this.devPipelineDataService.getWeeklyMetrics(
              message.team,
              startDate,
              endDate
            );
            // Map service data to protocol data
            const data = serviceData.map((row) => ({
              weekStart: row.weekStart,
              author: row.author,
              fullName: row.fullName,
              locDelta: row.totalLocDelta,
              complexityDelta: row.totalComplexityDelta,
              commentsDelta: row.totalCommentsDelta,
              testsDelta: row.totalTestsDelta,
              commentsRatio: row.commentsRatio,
              commitCount: row.commitCount,
            }));
            this.postMessage({
              type: 'devPipelineWeeklyMetrics',
              data,
            });
            this.logger.debug(
              CLASS_NAME,
              'handleMessage',
              `Sent ${data.length} weekly data points for team: ${message.team}`
            );
          } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger.error(CLASS_NAME, 'handleMessage', `Failed to fetch dev pipeline weekly metrics: ${errorMsg}`);
            this.postMessage({
              type: 'devPipelineWeeklyMetrics',
              data: [],
              error: errorMsg,
            });
          }
          break;
        }

        default: {
          // Exhaustiveness check: TypeScript will error if a message type is unhandled
          const _exhaustive: never = message;
          this.logger.warn(CLASS_NAME, 'handleMessage', `Unknown message type: ${(_exhaustive as WebviewToHost).type}`);
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
   * Lazily initializes the DatabaseService and DashboardDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for dashboard');

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

    this.dataService = new DashboardDataService(this.db);
    this.locDataService = new LocDataService(this.db);
    this.complexityDataService = new ComplexityDataService(this.db);
    this.fileChurnDataService = new FileChurnDataService(this.db);
    this.devPipelineDataService = new DevPipelineDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for dashboard');
  }

  /**
   * Post a typed message to the webview.
   *
   * @param message - The message to send to the webview
   */
  private postMessage(message: HostToWebview): void {
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
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing DashboardPanel');

    DashboardPanel.currentPanel = undefined;

    // Reset rate limiter state
    this.rateLimiter.reset();

    // Shut down the database connection
    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down dashboard database connection');
      void this.db.shutdown();
      this.db = undefined;
      this.dataService = undefined;
      this.locDataService = undefined;
      this.complexityDataService = undefined;
      this.fileChurnDataService = undefined;
      this.devPipelineDataService = undefined;
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

    this.logger.debug(CLASS_NAME, 'dispose', 'DashboardPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    DashboardPanel.currentPanel = undefined;
  }
}
