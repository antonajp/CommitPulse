/**
 * Test Debt Predictor dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Dual-axis chart: stacked bars (commit count by test tier) + line overlay (bug rate)
 * - Correlation scatter plot with trend line and R² value
 * - ROI headline metric ("Low-test commits cause 3.2x more bugs")
 * - Click bar segment to view commits in that tier
 * - Click commit to open diff
 * - Tier visibility toggles, date range filter
 * - Risky low-test commits list
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-914
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { TestDebtService } from '../../services/test-debt-service.js';
import { generateTestDebtHtml } from './test-debt-html.js';
import { getSettings } from '../../config/settings.js';
import { validateExternalUrl } from '../../utils/url-validator.js';
import { handleSharedMessage } from './shared-message-handlers.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { TestDebtFilters, TestDebtWeek, CommitTestDetail } from '../../services/test-debt-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'TestDebtPanel';

/**
 * View type identifier for the test debt webview.
 */
const VIEW_TYPE = 'gitrx.testDebtPanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Rate limiting configuration for external URL opens.
 * Prevents rapid-fire URL opens which could indicate malicious behavior.
 * Ticket: IQS-925
 */
const RATE_LIMIT_WINDOW_MS = 60000; // 60 seconds
const RATE_LIMIT_MAX_URLS = 5; // Max 5 URLs per window

/**
 * Messages from webview to host (extension).
 */
export type TestDebtWebviewToHost =
  | { type: 'requestTestDebtData'; filters?: TestDebtFilters }
  | { type: 'requestTestDebtRefresh'; filters?: TestDebtFilters }
  | { type: 'requestTestDebtFilterUpdate'; filters: TestDebtFilters }
  | { type: 'requestLowTestCommits'; filters?: TestDebtFilters }
  | { type: 'requestTierDrillDown'; tier: 'low' | 'medium' | 'high'; week: string; filters?: TestDebtFilters }
  | { type: 'requestCommitDrillDown'; sha: string; repository: string }
  | { type: 'requestOpenDiff'; sha: string; repository: string }
  | { type: 'openExternal'; url: string };

/**
 * Messages from host (extension) to webview.
 */
export type TestDebtHostToWebview =
  | {
      type: 'testDebtData';
      weeks: readonly TestDebtWeek[];
      hasData: boolean;
      viewExists: boolean;
      roiMetric: { multiplier: number; baseRate: number; lowTestRate: number } | null;
      correlation: { rSquared: number; slope: number; intercept: number } | null;
    }
  | {
      type: 'lowTestCommitsData';
      commits: readonly CommitTestDetail[];
      hasData: boolean;
      viewExists: boolean;
    }
  | {
      type: 'testDebtFilterOptions';
      repositories: string[];
      authors: string[];
    }
  | { type: 'testDebtLoading'; isLoading: boolean }
  | { type: 'testDebtError'; message: string; source: string }
  | {
      type: 'tierDrillDown';
      tier: 'low' | 'medium' | 'high';
      week: string;
      commits: readonly CommitTestDetail[];
      hasData: boolean;
    }
  | {
      type: 'commitDrillDown';
      commit: CommitTestDetail | null;
      hasData: boolean;
    };

/**
 * Manages the Test Debt Predictor WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: IQS-914
 */
export class TestDebtPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: TestDebtPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private db: DatabaseService | undefined;
  private dataService: TestDebtService | undefined;

  /**
   * Timestamps of recent URL opens for rate limiting.
   * Filtered to retain only timestamps within the rate limit window.
   * Ticket: IQS-925
   */
  private urlOpenTimestamps: number[] = [];

  /**
   * Create or reveal the Test Debt Predictor panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Test Debt Predictor panel');

    // If panel exists, reveal it
    if (TestDebtPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      TestDebtPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!TestDebtPanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new test debt webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Test Debt Predictor',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    TestDebtPanel.currentPanel = new TestDebtPanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing TestDebtPanel');

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
      (message: TestDebtWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'TestDebtPanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating test debt webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'test-debt.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateTestDebtHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Test debt webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   */
  private async handleMessage(message: TestDebtWebviewToHost): Promise<void> {
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
        case 'requestTestDebtData': {
          await this.handleRequestTestDebtData(message.filters);
          break;
        }

        case 'requestTestDebtRefresh': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Refresh requested');
          await this.handleRequestTestDebtData(message.filters);
          break;
        }

        case 'requestTestDebtFilterUpdate': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Filter update requested');
          await this.handleRequestTestDebtData(message.filters);
          break;
        }

        case 'requestLowTestCommits': {
          await this.handleRequestLowTestCommits(message.filters);
          break;
        }

        case 'requestTierDrillDown': {
          await this.handleRequestTierDrillDown(message);
          break;
        }

        case 'requestCommitDrillDown': {
          await this.handleRequestCommitDrillDown(message);
          break;
        }

        case 'requestOpenDiff': {
          await this.handleRequestOpenDiff(message);
          break;
        }

        case 'openExternal': {
          await this.handleOpenExternal(message.url);
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
   * Handle request for test debt trend data.
   */
  private async handleRequestTestDebtData(filters?: TestDebtFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestTestDebtData', 'Processing requestTestDebtData');

    // Send loading state
    this.postMessage({ type: 'testDebtLoading', isLoading: true });

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestTestDebtData', 'Data service not available after DB init');
      this.postError('Data service unavailable', 'requestTestDebtData');
      return;
    }

    // Get test debt trend data
    const trendData = await this.dataService.getTestDebtTrendData(filters ?? {});

    // Calculate ROI metric from the data
    const roiMetric = this.calculateRoiMetric(trendData.weeks);

    // Calculate correlation statistics
    const correlation = this.calculateCorrelation(trendData.weeks);

    // Send filter options
    await this.sendFilterOptions();

    this.postMessage({
      type: 'testDebtData',
      weeks: trendData.weeks,
      hasData: trendData.hasData,
      viewExists: trendData.viewExists,
      roiMetric,
      correlation,
    });

    this.postMessage({ type: 'testDebtLoading', isLoading: false });
  }

  /**
   * Handle request for low test commits data.
   */
  private async handleRequestLowTestCommits(filters?: TestDebtFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestLowTestCommits', 'Processing requestLowTestCommits');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestLowTestCommits', 'Data service not available');
      this.postError('Data service unavailable', 'requestLowTestCommits');
      return;
    }

    const commitsData = await this.dataService.getLowTestCommitsData(filters ?? {});

    this.postMessage({
      type: 'lowTestCommitsData',
      commits: commitsData.commits,
      hasData: commitsData.hasData,
      viewExists: commitsData.viewExists,
    });
  }

  /**
   * Handle drill-down request for a specific tier and week.
   */
  private async handleRequestTierDrillDown(message: {
    type: 'requestTierDrillDown';
    tier: 'low' | 'medium' | 'high';
    week: string;
    filters?: TestDebtFilters;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestTierDrillDown',
      `Drill-down for tier: ${message.tier}, week: ${message.week}`);

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestTierDrillDown', 'Data service not available');
      this.postError('Data service unavailable', 'requestTierDrillDown');
      return;
    }

    // Get commits for the specified week
    const weekEnd = new Date(message.week);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const tierFilters: TestDebtFilters = {
      ...message.filters,
      startDate: message.week,
      endDate: weekEnd.toISOString().split('T')[0],
    };

    const commitsData = await this.dataService.getLowTestCommitsData(tierFilters);

    // Filter commits by tier
    const filteredCommits = commitsData.commits.filter(c => c.testCoverageTier === message.tier);

    this.postMessage({
      type: 'tierDrillDown',
      tier: message.tier,
      week: message.week,
      commits: filteredCommits,
      hasData: filteredCommits.length > 0,
    });
  }

  /**
   * Handle drill-down request for a specific commit.
   */
  private async handleRequestCommitDrillDown(message: {
    type: 'requestCommitDrillDown';
    sha: string;
    repository: string;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestCommitDrillDown',
      `Drill-down for commit: ${message.sha} in ${message.repository}`);

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestCommitDrillDown', 'Data service not available');
      this.postError('Data service unavailable', 'requestCommitDrillDown');
      return;
    }

    // Find the specific commit
    const commits = await this.dataService.getLowTestCommits({
      repository: message.repository,
    });

    const commit = commits.find(c => c.sha === message.sha) ?? null;

    this.postMessage({
      type: 'commitDrillDown',
      commit,
      hasData: commit !== null,
    });
  }

  /**
   * Handle request to open diff for a commit.
   */
  private async handleRequestOpenDiff(message: {
    type: 'requestOpenDiff';
    sha: string;
    repository: string;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestOpenDiff',
      `Opening diff for commit: ${message.sha} in ${message.repository}`);

    // Look up repository path from settings
    const settings = getSettings();
    const repoConfig = settings.repositories.find(r => r.name === message.repository);

    if (!repoConfig) {
      this.logger.warn(CLASS_NAME, 'handleRequestOpenDiff', `Repository not found: ${message.repository}`);
      void vscode.window.showWarningMessage(`Repository "${message.repository}" not found in settings.`);
      return;
    }

    // Open Git diff in VS Code
    try {
      const repoUri = vscode.Uri.file(repoConfig.path);
      // Use the git.viewChanges command to show the commit diff
      await vscode.commands.executeCommand('git.viewChanges', repoUri);
      this.logger.info(CLASS_NAME, 'handleRequestOpenDiff', `Opened diff for: ${message.sha}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleRequestOpenDiff', `Failed to open diff: ${msg}`);
      void vscode.window.showErrorMessage(`Could not open diff for commit: ${message.sha}`);
    }
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
   * Calculate ROI metric from weekly test debt data.
   * Returns the multiplier showing how many more bugs low-test commits cause.
   */
  private calculateRoiMetric(weeks: readonly TestDebtWeek[]): { multiplier: number; baseRate: number; lowTestRate: number } | null {
    if (weeks.length === 0) {
      return null;
    }

    // Aggregate totals across all weeks
    let totalLowTestCommits = 0;
    let totalHighTestCommits = 0;
    let totalBugsFromLowTest = 0;
    let totalBugsFromHighTest = 0;

    for (const week of weeks) {
      totalLowTestCommits += week.lowTestCommits;
      totalHighTestCommits += week.highTestCommits;
      totalBugsFromLowTest += week.bugsFromLowTest;
      totalBugsFromHighTest += week.bugsFromHighTest;
    }

    // Calculate bug rates
    const lowTestRate = totalLowTestCommits > 0
      ? totalBugsFromLowTest / totalLowTestCommits
      : 0;

    const highTestRate = totalHighTestCommits > 0
      ? totalBugsFromHighTest / totalHighTestCommits
      : 0;

    // Avoid division by zero
    const baseRate = highTestRate > 0 ? highTestRate : 0.01;
    const multiplier = lowTestRate / baseRate;

    this.logger.debug(CLASS_NAME, 'calculateRoiMetric',
      `ROI: ${multiplier.toFixed(2)}x (low: ${lowTestRate.toFixed(3)}, high: ${highTestRate.toFixed(3)})`);

    return {
      multiplier: Math.round(multiplier * 10) / 10,
      baseRate: Math.round(highTestRate * 1000) / 1000,
      lowTestRate: Math.round(lowTestRate * 1000) / 1000,
    };
  }

  /**
   * Calculate correlation statistics between test ratio and bug rate.
   * Returns R² value, slope, and intercept for the trend line.
   */
  private calculateCorrelation(weeks: readonly TestDebtWeek[]): { rSquared: number; slope: number; intercept: number } | null {
    // Filter weeks with valid average test ratio
    const validWeeks = weeks.filter(w => w.avgTestRatio !== null && w.totalCommits > 0);

    if (validWeeks.length < 3) {
      this.logger.debug(CLASS_NAME, 'calculateCorrelation', 'Not enough data points for correlation');
      return null;
    }

    // Calculate mean values
    const xValues = validWeeks.map(w => w.avgTestRatio as number);
    const yValues = validWeeks.map(w =>
      w.totalBugs / w.totalCommits
    );

    const n = xValues.length;
    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const meanX = sumX / n;
    const meanY = sumY / n;

    // Calculate slope and intercept using least squares
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      const xDiff = (xValues[i] ?? 0) - meanX;
      const yDiff = (yValues[i] ?? 0) - meanY;
      numerator += xDiff * yDiff;
      denominator += xDiff * xDiff;
    }

    // Avoid division by zero
    if (denominator === 0) {
      return null;
    }

    const slope = numerator / denominator;
    const intercept = meanY - slope * meanX;

    // Calculate R²
    let ssTotal = 0;
    let ssResidual = 0;

    for (let i = 0; i < n; i++) {
      const yActual = yValues[i] ?? 0;
      const yPredicted = slope * (xValues[i] ?? 0) + intercept;
      ssTotal += Math.pow(yActual - meanY, 2);
      ssResidual += Math.pow(yActual - yPredicted, 2);
    }

    const rSquared = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;

    this.logger.debug(CLASS_NAME, 'calculateCorrelation',
      `Correlation: R²=${rSquared.toFixed(3)}, slope=${slope.toFixed(3)}, intercept=${intercept.toFixed(3)}`);

    return {
      rSquared: Math.round(rSquared * 1000) / 1000,
      slope: Math.round(slope * 1000) / 1000,
      intercept: Math.round(intercept * 1000) / 1000,
    };
  }

  /**
   * Send available filter options to the webview.
   */
  private async sendFilterOptions(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'sendFilterOptions', 'Fetching filter options');

    if (!this.dataService) {
      return;
    }

    // Get all low test commits to extract unique values for filters
    const commits = await this.dataService.getLowTestCommits({});

    const repositories = [...new Set(commits.map(c => c.repository))].sort();
    const authors = [...new Set(commits.map(c => c.author))].sort();

    this.postMessage({
      type: 'testDebtFilterOptions',
      repositories,
      authors,
    });
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and TestDebtService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for test debt');

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

    this.dataService = new TestDebtService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for test debt');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: TestDebtHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'testDebtError',
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
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing TestDebtPanel');

    TestDebtPanel.currentPanel = undefined;

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down test debt database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'TestDebtPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    TestDebtPanel.currentPanel = undefined;
  }
}
