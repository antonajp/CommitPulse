/**
 * Developer Focus Score dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Interactive multi-line chart: X-axis = weeks, Y-axis = focus score (0-100)
 * - One line per developer, color-coded with distinct colors
 * - Team average dashed line overlay
 * - Background zones for focus categories (green/yellow/orange/red)
 * - Hover shows weekly summary tooltip
 * - Click data point opens week details panel
 * - Developer and team filters
 * - Declining trend alerts (3+ week downtrend)
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-908
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { DeveloperFocusDataService } from '../../services/developer-focus-service.js';
import { generateFocusHtml } from './focus-html.js';
import { getSettings } from '../../config/settings.js';
import { handleSharedMessage } from './shared-message-handlers.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { FocusWebviewToHost, FocusHostToWebview } from './focus-protocol.js';
import type { FocusFilters } from '../../services/developer-focus-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'FocusPanel';

/**
 * View type identifier for the developer focus webview.
 */
const VIEW_TYPE = 'gitrx.focusPanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Manages the Developer Focus Score WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: IQS-908
 */
export class FocusPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: FocusPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private db: DatabaseService | undefined;
  private dataService: DeveloperFocusDataService | undefined;

  /**
   * Create or reveal the Developer Focus panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Developer Focus panel');

    // If panel exists, reveal it
    if (FocusPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      FocusPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!FocusPanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new developer focus webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Developer Focus',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    FocusPanel.currentPanel = new FocusPanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing FocusPanel');

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
      (message: FocusWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'FocusPanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating developer focus webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'focus.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateFocusHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Developer focus webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   */
  private async handleMessage(message: FocusWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    try {
      // Handle shared message types (exportCsv) - GITX-127
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
        case 'requestFocusData': {
          await this.handleRequestFocusData(message.filters);
          break;
        }

        case 'requestDailyActivityData': {
          await this.handleRequestDailyActivityData(message.filters);
          break;
        }

        case 'requestFocusTrendData': {
          await this.handleRequestFocusTrendData(message.filters);
          break;
        }

        case 'requestFocusRefresh': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Refresh requested');
          await this.handleRequestFocusData(message.filters);
          break;
        }

        case 'requestFocusFilterUpdate': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Filter update requested');
          await this.handleRequestFocusData(message.filters);
          break;
        }

        case 'requestDeveloperDrillDown': {
          await this.handleRequestDeveloperDrillDown(message);
          break;
        }

        case 'requestWeekDrillDown': {
          await this.handleRequestWeekDrillDown(message);
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
   * Handle request for focus chart data.
   */
  private async handleRequestFocusData(filters?: FocusFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestFocusData', 'Processing requestFocusData');

    // Send loading state
    this.postMessage({ type: 'focusLoading', isLoading: true });

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestFocusData', 'Data service not available after DB init');
      this.postError('Data service unavailable', 'requestFocusData');
      return;
    }

    const chartData = await this.dataService.getChartData(filters ?? {});

    // Also send filter options for the dropdowns
    await this.sendFilterOptions(filters);

    this.postMessage({
      type: 'focusData',
      focusData: chartData.focusData,
      trends: chartData.trends,
      teamSummary: chartData.teamSummary,
      hasData: chartData.hasData,
      viewExists: chartData.viewExists,
    });

    this.postMessage({ type: 'focusLoading', isLoading: false });
  }

  /**
   * Handle request for daily activity data.
   */
  private async handleRequestDailyActivityData(filters?: FocusFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestDailyActivityData', 'Processing requestDailyActivityData');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestDailyActivityData', 'Data service not available');
      this.postError('Data service unavailable', 'requestDailyActivityData');
      return;
    }

    const chartData = await this.dataService.getDailyActivityChartData(filters ?? {});

    this.postMessage({
      type: 'dailyActivityData',
      activities: chartData.activities,
      hasData: chartData.hasData,
      viewExists: chartData.viewExists,
    });
  }

  /**
   * Handle request for focus trend data.
   */
  private async handleRequestFocusTrendData(filters?: FocusFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestFocusTrendData', 'Processing requestFocusTrendData');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestFocusTrendData', 'Data service not available');
      this.postError('Data service unavailable', 'requestFocusTrendData');
      return;
    }

    const viewExists = await this.dataService.checkFocusViewExists();
    if (!viewExists) {
      this.postMessage({
        type: 'focusTrendData',
        trends: {
          weeks: [],
          developers: [],
          teamAvgByWeek: [],
          overallTeamAvg: 0,
        },
        hasData: false,
        viewExists: false,
      });
      return;
    }

    const trends = await this.dataService.getFocusTrends(filters ?? {});

    this.postMessage({
      type: 'focusTrendData',
      trends,
      hasData: trends.developers.length > 0,
      viewExists: true,
    });
  }

  /**
   * Handle drill-down request for a specific developer.
   */
  private async handleRequestDeveloperDrillDown(message: {
    type: 'requestDeveloperDrillDown';
    author: string;
    filters?: FocusFilters;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestDeveloperDrillDown',
      `Drill-down for developer: ${message.author}`);

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestDeveloperDrillDown', 'Data service not available');
      this.postError('Data service unavailable', 'requestDeveloperDrillDown');
      return;
    }

    // Get focus data for this developer
    const developerFilters: FocusFilters = {
      ...message.filters,
      author: message.author,
    };

    const [focusRows, dailyActivityData] = await Promise.all([
      this.dataService.getFocusScores(developerFilters),
      this.dataService.getDailyActivities(developerFilters),
    ]);

    // Calculate summary statistics
    let avgFocusScore = 0;
    let trend = 0;
    let currentCategory: 'deep_focus' | 'moderate_focus' | 'fragmented' | 'highly_fragmented' = 'fragmented';

    if (focusRows.length > 0) {
      avgFocusScore = Math.round(
        focusRows.reduce((sum, r) => sum + r.focusScore, 0) / focusRows.length * 100
      ) / 100;

      // Get the most recent category
      const sortedRows = [...focusRows].sort((a, b) =>
        new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime()
      );
      currentCategory = sortedRows[0]?.focusCategory ?? 'fragmented';

      // Calculate trend (compare last 3 weeks to prior 3 weeks)
      if (sortedRows.length >= 6) {
        const recentAvg = ((sortedRows[0]?.focusScore ?? 0) + (sortedRows[1]?.focusScore ?? 0) + (sortedRows[2]?.focusScore ?? 0)) / 3;
        const priorAvg = ((sortedRows[3]?.focusScore ?? 0) + (sortedRows[4]?.focusScore ?? 0) + (sortedRows[5]?.focusScore ?? 0)) / 3;
        trend = Math.round((recentAvg - priorAvg) * 100) / 100;
      } else if (sortedRows.length >= 2) {
        trend = Math.round(((sortedRows[0]?.focusScore ?? 0) - (sortedRows[sortedRows.length - 1]?.focusScore ?? 0)) * 100) / 100;
      }
    }

    this.postMessage({
      type: 'developerDrillDown',
      author: message.author,
      focusRows,
      dailyActivity: dailyActivityData,
      avgFocusScore,
      currentCategory,
      trend,
    });
  }

  /**
   * Handle drill-down request for a specific week.
   */
  private async handleRequestWeekDrillDown(message: {
    type: 'requestWeekDrillDown';
    weekStart: string;
    filters?: FocusFilters;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestWeekDrillDown',
      `Drill-down for week: ${message.weekStart}`);

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestWeekDrillDown', 'Data service not available');
      this.postError('Data service unavailable', 'requestWeekDrillDown');
      return;
    }

    // Get focus data for this week
    const weekFilters: FocusFilters = {
      ...message.filters,
      startDate: message.weekStart,
      endDate: new Date(new Date(message.weekStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const focusRows = await this.dataService.getFocusScores(weekFilters);

    // Calculate team average for this week
    const teamAvgScore = focusRows.length > 0
      ? Math.round(focusRows.reduce((sum, r) => sum + r.focusScore, 0) / focusRows.length * 100) / 100
      : 0;

    // Group developers by category
    const categoryBreakdown = {
      deepFocus: focusRows.filter(r => r.focusCategory === 'deep_focus').map(r => r.author),
      moderateFocus: focusRows.filter(r => r.focusCategory === 'moderate_focus').map(r => r.author),
      fragmented: focusRows.filter(r => r.focusCategory === 'fragmented').map(r => r.author),
      highlyFragmented: focusRows.filter(r => r.focusCategory === 'highly_fragmented').map(r => r.author),
    };

    this.postMessage({
      type: 'weekDrillDown',
      weekStart: message.weekStart,
      focusRows,
      teamAvgScore,
      categoryBreakdown,
    });
  }

  /**
   * Send available filter options to the webview.
   */
  private async sendFilterOptions(filters?: FocusFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'sendFilterOptions', 'Fetching filter options');

    if (!this.dataService) {
      return;
    }

    // Get all focus data to extract unique values for filters
    const focusData = await this.dataService.getFocusScores(filters ?? {});

    const authors = [...new Set(focusData.map(f => f.author))].sort();
    const weeks = [...new Set(focusData.map(f => f.weekStart))].sort();
    const focusCategories: ('deep_focus' | 'moderate_focus' | 'fragmented' | 'highly_fragmented')[] = [
      'deep_focus',
      'moderate_focus',
      'fragmented',
      'highly_fragmented',
    ];

    this.postMessage({
      type: 'focusFilterOptions',
      authors,
      focusCategories,
      weeks,
    });
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and DeveloperFocusDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for developer focus');

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

    this.dataService = new DeveloperFocusDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for developer focus');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: FocusHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'focusError',
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
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing FocusPanel');

    FocusPanel.currentPanel = undefined;

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down developer focus database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'FocusPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    FocusPanel.currentPanel = undefined;
  }
}
