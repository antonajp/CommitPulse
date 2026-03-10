/**
 * Commit Hygiene Tracker dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Stacked bar chart: commit counts by quality tier (excellent/good/fair/poor)
 * - Average score trend line overlay
 * - Donut chart showing current distribution
 * - Factor breakdown bars (linkage, conventional, co-author, length)
 * - Author leaderboard with best hygiene scores
 * - Click bar segment to view commits in that tier
 * - Author filter, quality tier toggles, date range filter
 * - "Poor commits to fix" actionable list
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-916
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { CommitHygieneDataService } from '../../services/commit-hygiene-service.js';
import { generateHygieneHtml } from './hygiene-html.js';
import { getSettings } from '../../config/settings.js';
import { validateExternalUrl } from '../../utils/url-validator.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type {
  CommitHygieneFilters,
  CommitHygiene,
  AuthorHygieneSummary,
  WeeklyHygieneTrend,
  QualityTier,
} from '../../services/commit-hygiene-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'HygienePanel';

/**
 * View type identifier for the hygiene webview.
 */
const VIEW_TYPE = 'gitrx.hygienePanel';

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
export type HygieneWebviewToHost =
  | { type: 'requestHygieneData'; filters?: CommitHygieneFilters }
  | { type: 'requestHygieneRefresh'; filters?: CommitHygieneFilters }
  | { type: 'requestHygieneFilterUpdate'; filters: CommitHygieneFilters }
  | { type: 'requestPoorCommits'; filters?: CommitHygieneFilters }
  | { type: 'requestAuthorSummary'; filters?: Pick<CommitHygieneFilters, 'repository' | 'team'> }
  | { type: 'requestTierDrillDown'; tier: QualityTier; week: string; filters?: CommitHygieneFilters }
  | { type: 'requestCommitDrillDown'; sha: string; repository: string }
  | { type: 'requestOpenDiff'; sha: string; repository: string }
  | { type: 'openExternal'; url: string };

/**
 * Messages from host (extension) to webview.
 */
export type HygieneHostToWebview =
  | {
      type: 'hygieneData';
      weeks: readonly WeeklyHygieneTrend[];
      hasData: boolean;
      viewExists: boolean;
      summaryMetric: { avgScore: number; goodOrBetterPct: number; conventionalPct: number } | null;
    }
  | {
      type: 'poorCommitsData';
      commits: readonly CommitHygiene[];
      hasData: boolean;
      viewExists: boolean;
    }
  | {
      type: 'authorSummaryData';
      summaries: readonly AuthorHygieneSummary[];
      hasData: boolean;
      viewExists: boolean;
    }
  | {
      type: 'hygieneFilterOptions';
      repositories: string[];
      authors: string[];
      teams: string[];
    }
  | { type: 'hygieneLoading'; isLoading: boolean }
  | { type: 'hygieneError'; message: string; source: string }
  | {
      type: 'tierDrillDown';
      tier: QualityTier;
      week: string;
      commits: readonly CommitHygiene[];
      hasData: boolean;
    }
  | {
      type: 'commitDrillDown';
      commit: CommitHygiene | null;
      hasData: boolean;
    };

/**
 * Manages the Commit Hygiene Tracker WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: IQS-916
 */
export class HygienePanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: HygienePanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private db: DatabaseService | undefined;
  private dataService: CommitHygieneDataService | undefined;

  /**
   * Timestamps of recent URL opens for rate limiting.
   * Filtered to retain only timestamps within the rate limit window.
   * Ticket: IQS-925
   */
  private urlOpenTimestamps: number[] = [];

  /**
   * Create or reveal the Commit Hygiene Tracker panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Commit Hygiene Tracker panel');

    // If panel exists, reveal it
    if (HygienePanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      HygienePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!HygienePanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new hygiene webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Commit Hygiene Tracker',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    HygienePanel.currentPanel = new HygienePanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing HygienePanel');

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
      (message: HygieneWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'HygienePanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating hygiene webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'hygiene.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateHygieneHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Hygiene webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   */
  private async handleMessage(message: HygieneWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    try {
      switch (message.type) {
        case 'requestHygieneData': {
          await this.handleRequestHygieneData(message.filters);
          break;
        }

        case 'requestHygieneRefresh': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Refresh requested');
          await this.handleRequestHygieneData(message.filters);
          break;
        }

        case 'requestHygieneFilterUpdate': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Filter update requested');
          await this.handleRequestHygieneData(message.filters);
          break;
        }

        case 'requestPoorCommits': {
          await this.handleRequestPoorCommits(message.filters);
          break;
        }

        case 'requestAuthorSummary': {
          await this.handleRequestAuthorSummary(message.filters);
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
   * Handle request for hygiene trend data.
   */
  private async handleRequestHygieneData(filters?: CommitHygieneFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestHygieneData', 'Processing requestHygieneData');

    // Send loading state
    this.postMessage({ type: 'hygieneLoading', isLoading: true });

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestHygieneData', 'Data service not available after DB init');
      this.postError('Data service unavailable', 'requestHygieneData');
      return;
    }

    // Get weekly trend data
    const trendData = await this.dataService.getWeeklyTrendData(
      filters?.repository ? { repository: filters.repository } : {}
    );

    // Calculate summary metric from the data
    const summaryMetric = this.calculateSummaryMetric(trendData.trends);

    // Send filter options
    await this.sendFilterOptions();

    this.postMessage({
      type: 'hygieneData',
      weeks: trendData.trends,
      hasData: trendData.hasData,
      viewExists: trendData.viewExists,
      summaryMetric,
    });

    this.postMessage({ type: 'hygieneLoading', isLoading: false });

    // Also request poor commits and author summary
    await this.handleRequestPoorCommits(filters);
    await this.handleRequestAuthorSummary(filters);
  }

  /**
   * Handle request for poor commits data.
   */
  private async handleRequestPoorCommits(filters?: CommitHygieneFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestPoorCommits', 'Processing requestPoorCommits');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestPoorCommits', 'Data service not available');
      this.postError('Data service unavailable', 'requestPoorCommits');
      return;
    }

    const commitsData = await this.dataService.getCommitHygieneChartData({
      ...filters,
      qualityTier: 'poor',
    });

    this.postMessage({
      type: 'poorCommitsData',
      commits: commitsData.commits,
      hasData: commitsData.hasData,
      viewExists: commitsData.viewExists,
    });
  }

  /**
   * Handle request for author summary data.
   */
  private async handleRequestAuthorSummary(
    filters?: Pick<CommitHygieneFilters, 'repository' | 'team'>
  ): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestAuthorSummary', 'Processing requestAuthorSummary');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestAuthorSummary', 'Data service not available');
      this.postError('Data service unavailable', 'requestAuthorSummary');
      return;
    }

    const summaryData = await this.dataService.getAuthorSummaryData(filters ?? {});

    this.postMessage({
      type: 'authorSummaryData',
      summaries: summaryData.summaries,
      hasData: summaryData.hasData,
      viewExists: summaryData.viewExists,
    });
  }

  /**
   * Handle drill-down request for a specific tier and week.
   */
  private async handleRequestTierDrillDown(message: {
    type: 'requestTierDrillDown';
    tier: QualityTier;
    week: string;
    filters?: CommitHygieneFilters;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestTierDrillDown',
      `Drill-down for tier: ${message.tier}, week: ${message.week}`);

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestTierDrillDown', 'Data service not available');
      this.postError('Data service unavailable', 'requestTierDrillDown');
      return;
    }

    // Get commits for the specified week and tier
    const weekEnd = new Date(message.week);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const tierFilters: CommitHygieneFilters = {
      ...message.filters,
      startDate: message.week,
      endDate: weekEnd.toISOString().split('T')[0],
      qualityTier: message.tier,
    };

    const commitsData = await this.dataService.getCommitHygieneChartData(tierFilters);

    this.postMessage({
      type: 'tierDrillDown',
      tier: message.tier,
      week: message.week,
      commits: commitsData.commits,
      hasData: commitsData.commits.length > 0,
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
    const commits = await this.dataService.getCommitHygiene({
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
   * Calculate summary metric from weekly trend data.
   * Returns the average hygiene score and percentage metrics.
   */
  private calculateSummaryMetric(
    weeks: readonly WeeklyHygieneTrend[]
  ): { avgScore: number; goodOrBetterPct: number; conventionalPct: number } | null {
    if (weeks.length === 0) {
      return null;
    }

    // Calculate weighted averages across all weeks
    let totalCommits = 0;
    let totalScore = 0;
    let totalGoodOrBetter = 0;
    let totalConventional = 0;

    for (const week of weeks) {
      totalCommits += week.totalCommits;
      totalScore += week.avgHygieneScore * week.totalCommits;
      totalGoodOrBetter += (week.excellentCount + week.goodCount);
      totalConventional += week.conventionalCommits;
    }

    // Avoid division by zero
    if (totalCommits === 0) {
      return null;
    }

    const avgScore = totalScore / totalCommits;
    const goodOrBetterPct = (totalGoodOrBetter / totalCommits) * 100;
    const conventionalPct = (totalConventional / totalCommits) * 100;

    this.logger.debug(CLASS_NAME, 'calculateSummaryMetric',
      `Summary: avgScore=${avgScore.toFixed(1)}, goodOrBetter=${goodOrBetterPct.toFixed(1)}%, conventional=${conventionalPct.toFixed(1)}%`);

    return {
      avgScore: Math.round(avgScore * 10) / 10,
      goodOrBetterPct: Math.round(goodOrBetterPct * 10) / 10,
      conventionalPct: Math.round(conventionalPct * 10) / 10,
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

    // Get commits to extract unique values for filters
    const commits = await this.dataService.getCommitHygiene({});

    const repositories = [...new Set(commits.map(c => c.repository))].sort();
    const authors = [...new Set(commits.map(c => c.author))].sort();
    const teams = [...new Set(commits.map(c => c.team).filter(t => t !== null))] as string[];
    teams.sort();

    this.postMessage({
      type: 'hygieneFilterOptions',
      repositories,
      authors,
      teams,
    });
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and CommitHygieneDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for hygiene');

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

    this.dataService = new CommitHygieneDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for hygiene');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: HygieneHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'hygieneError',
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
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing HygienePanel');

    HygienePanel.currentPanel = undefined;

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down hygiene database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'HygienePanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    HygienePanel.currentPanel = undefined;
  }
}
