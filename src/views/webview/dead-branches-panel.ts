/**
 * Dead Branches Report dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Risk level legend with safety guidance
 * - Summary KPIs: Total, Merged, Stale, Orphaned branches
 * - D3.js donut chart for risk distribution
 * - Horizontal stacked bar chart for repository breakdown
 * - Sortable, filterable branches table with multi-select
 * - Branch deletion workflow with confirmation
 * - CSV export for branch data
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Rate limiting on message handlers
 * - Proper disposal and resource cleanup
 *
 * Ticket: GITX-231
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { generateDeadBranchesHtml } from './dead-branches-html.js';
import { getSettings } from '../../config/settings.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import { handleSharedMessage } from './shared-message-handlers.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type {
  DeadBranchesWebviewToHost,
  DeadBranchesHostToWebview,
  BranchRow,
  BranchSummary,
  RiskDistribution,
  RepoBreakdown,
  DeleteResult,
  RequestScanBranches,
} from './dead-branches-protocol.js';
import type { BranchStatus, BranchRiskLevel, DeadBranchesConfig } from '../../services/dead-branches-types.js';
import { DeadBranchesService } from '../../services/dead-branches-service.js';
import { BranchRepository } from '../../database/branch-repository.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DeadBranchesPanel';

/**
 * View type identifier for the dead branches webview.
 */
const VIEW_TYPE = 'gitrx.deadBranchesPanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Manages the Dead Branches Report WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: GITX-231
 */
export class DeadBranchesPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: DeadBranchesPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private branchRepo: BranchRepository | undefined;

  /**
   * Create or reveal the Dead Branches panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Dead Branches Report panel');

    // If panel exists, reveal it
    if (DeadBranchesPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      DeadBranchesPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!DeadBranchesPanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new dead branches webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Dead Branches Report',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    DeadBranchesPanel.currentPanel = new DeadBranchesPanel(panel, extensionUri, secretService);
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
        logger.error(
          CLASS_NAME,
          'verifyD3Integrity',
          `SHA-256 mismatch! Expected: ${D3_EXPECTED_SHA256}, Got: ${hash}`,
        );
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing DeadBranchesPanel');

    // Set the webview HTML content
    this.updateWebviewContent();

    // Listen for panel disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Listen for messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message: DeadBranchesWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);

        // Handle shared message types (exportCsv, openExternal)
        if (message.type === 'exportCsv' || message.type === 'openExternal') {
          void handleSharedMessage(
            message as { type: string },
            this.panel.webview,
            this.logger,
            CLASS_NAME,
          );
          return;
        }

        // Handle dead branches specific messages
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'DeadBranchesPanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating dead branches webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'));
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'dead-branches.css'),
    );

    // Get settings for URL prefixes
    const settings = getSettings();
    const githubOrg = settings.github.organization || '';

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `GitHub Org: ${githubOrg}`);

    webview.html = generateDeadBranchesHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
      githubOrg,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Dead branches webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   * Rate limited to prevent excessive database queries.
   */
  private async handleMessage(message: DeadBranchesWebviewToHost): Promise<void> {
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
      await this.ensureDbConnection();

      switch (message.type) {
        case 'requestBranchData': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestBranchData');
          const data = await this.getBranchData(message);
          this.postMessage({
            type: 'branchData',
            branches: data.branches,
            summary: data.summary,
            riskDistribution: data.riskDistribution,
            repositoryBreakdown: data.repositoryBreakdown,
            hasData: data.branches.length > 0,
          });
          break;
        }

        case 'requestFilterOptions': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestFilterOptions');
          const options = await this.getFilterOptions();
          this.postMessage({
            type: 'filterOptions',
            repositories: options.repositories,
            statuses: options.statuses,
            riskLevels: options.riskLevels,
          });
          break;
        }

        case 'deleteBranches': {
          this.logger.debug(
            CLASS_NAME,
            'handleMessage',
            `Processing deleteBranches: ${message.branches.length} branches in ${message.repository}`,
          );
          await this.deleteBranches(message.branches, message.repository, message.force || false);
          break;
        }

        case 'scanBranches': {
          this.logger.debug(
            CLASS_NAME,
            'handleMessage',
            `Processing scanBranches: ${message.repository ?? 'all repositories'}`,
          );
          await this.scanBranches(message);
          break;
        }

        // Shared message types handled early
        case 'exportCsv':
        case 'openExternal':
          // Already handled before the switch
          break;

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
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and BranchRepository.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.db && this.branchRepo) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Database already connected');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for dead branches');

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

    // Create branch repository for data access
    this.branchRepo = new BranchRepository(this.db);

    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for dead branches');
  }

  /**
   * Query branch data from the database with optional filters.
   * Delegates to BranchRepository for all database operations.
   *
   * @param filters - Filter criteria from the webview
   * @returns Branch data with summary statistics
   */
  private async getBranchData(filters: {
    repository?: string;
    riskLevel?: BranchRiskLevel;
    status?: BranchStatus;
    search?: string;
  }): Promise<{
    branches: BranchRow[];
    summary: BranchSummary;
    riskDistribution: RiskDistribution;
    repositoryBreakdown: RepoBreakdown[];
  }> {
    if (!this.branchRepo) {
      throw new Error('BranchRepository not initialized');
    }

    this.logger.debug(CLASS_NAME, 'getBranchData', `Fetching branch data with filters: ${JSON.stringify(filters)}`);

    // Convert webview filters to repository filters
    const repoFilters = {
      repository: filters.repository,
      riskLevels: filters.riskLevel ? [filters.riskLevel] : undefined,
      statuses: filters.status ? [filters.status] : undefined,
      search: filters.search,
    };

    // Query branches from the repository
    const summaryRows = await this.branchRepo.getDeadBranchSummary(repoFilters);
    this.logger.debug(CLASS_NAME, 'getBranchData', `Found ${summaryRows.length} branches`);

    // Map repository rows to webview BranchRow format
    const branches: BranchRow[] = summaryRows.map((row) => ({
      id: row.id,
      branchName: row.branchName,
      repository: row.repository,
      lastCommitDate: row.lastCommitDate ? row.lastCommitDate.toISOString() : '',
      lastCommitAuthor: row.lastCommitAuthor ?? 'Unknown',
      lastCommitSha: row.lastCommitSha ?? '',
      commitCount: row.commitCount,
      status: row.status,
      riskLevel: row.riskLevel,
      daysSinceLastCommit: Math.round(row.daysSinceLastCommit ?? 0),
      mergedInto: row.mergedInto ?? null,
      tooltip: this.generateTooltip(
        row.status,
        row.riskLevel,
        row.hasOpenPr,
        Math.round(row.daysSinceLastCommit ?? 0),
      ),
    }));

    // Get summary counts (unfiltered to show totals)
    const summaryStats = await this.branchRepo.getGlobalSummaryStatistics();
    const summary: BranchSummary = {
      total: summaryStats.total,
      merged: summaryStats.merged,
      stale: summaryStats.stale,
      orphaned: summaryStats.orphaned,
      active: summaryStats.active,
    };

    // Get risk distribution
    const riskStats = await this.branchRepo.getGlobalRiskDistribution();
    const riskDistribution: RiskDistribution = {
      safe: riskStats.safe,
      low: riskStats.low,
      medium: riskStats.medium,
      high: riskStats.high,
    };

    // Get repository breakdown
    const repoBreakdown = await this.branchRepo.getRepositoryRiskBreakdown();
    const repositoryBreakdown: RepoBreakdown[] = repoBreakdown.map((row) => ({
      repository: row.repository,
      safe: row.safe,
      low: row.low,
      medium: row.medium,
      high: row.high,
    }));

    return { branches, summary, riskDistribution, repositoryBreakdown };
  }

  /**
   * Generate contextual tooltip for branch status.
   */
  private generateTooltip(
    status: BranchStatus,
    riskLevel: BranchRiskLevel,
    hasOpenPr: boolean,
    daysSinceCommit: number,
  ): string {
    const parts: string[] = [];

    // Add status label
    switch (status) {
      case 'merged':
        parts.push('Merged branch');
        break;
      case 'stale':
        parts.push('Stale branch');
        break;
      case 'orphaned':
        parts.push('Orphaned branch');
        break;
      case 'active':
        parts.push('Active branch');
        break;
    }

    if (hasOpenPr) {
      parts.push('Has open PR');
    }

    parts.push(`${daysSinceCommit} days since last commit`);

    switch (riskLevel) {
      case 'safe':
        parts.push('Safe to delete');
        break;
      case 'low':
        parts.push('Low risk - verify before deleting');
        break;
      case 'medium':
        parts.push('Medium risk - review recent activity');
        break;
      case 'high':
        parts.push('High risk - active development');
        break;
    }

    return parts.join(' • ');
  }

  /**
   * Get available filter options from the database.
   * Delegates to BranchRepository for repository list.
   *
   * @returns Filter options (repositories, statuses, risk levels)
   */
  private async getFilterOptions(): Promise<{
    repositories: string[];
    statuses: BranchStatus[];
    riskLevels: BranchRiskLevel[];
  }> {
    if (!this.branchRepo) {
      throw new Error('BranchRepository not initialized');
    }

    this.logger.debug(CLASS_NAME, 'getFilterOptions', 'Fetching filter options');

    // Get distinct repositories from the repository
    const repositories = await this.branchRepo.getDistinctRepositories();

    // Static options for status and risk level
    const statuses: BranchStatus[] = ['merged', 'stale', 'orphaned', 'active'];
    const riskLevels: BranchRiskLevel[] = ['safe', 'low', 'medium', 'high'];

    return { repositories, statuses, riskLevels };
  }

  /**
   * Delete branches using git commands.
   * Shows confirmation dialog and validates protected branches.
   *
   * @param branches - Branch names to delete
   * @param repository - Repository name
   * @param force - If true, use git branch -D (force deletion)
   */
  private async deleteBranches(branches: string[], repository: string, force: boolean): Promise<void> {
    this.logger.info(
      CLASS_NAME,
      'deleteBranches',
      `Deleting ${branches.length} branches from ${repository} (force=${force})`,
    );

    // Confirmation dialog - require user to acknowledge deletion
    const branchList = branches.length <= 5
      ? branches.join(', ')
      : `${branches.slice(0, 5).join(', ')} and ${branches.length - 5} more`;

    const confirmText = branches.length > 10 ? 'DELETE' : 'Delete';
    const confirmation = await vscode.window.showWarningMessage(
      `Are you sure you want to delete ${branches.length} branch(es) from ${repository}?\n\n${branchList}`,
      { modal: true },
      confirmText,
      'Cancel',
    );

    if (confirmation !== confirmText) {
      this.logger.debug(CLASS_NAME, 'deleteBranches', 'User cancelled deletion');
      this.postMessage({
        type: 'deleteResult',
        results: [],
        success: false,
      });
      return;
    }

    // Get the repository path from settings
    const settings = getSettings();
    const repoConfig = settings.repositories?.find((r: { name: string }) => r.name === repository);
    if (!repoConfig || !repoConfig.path) {
      this.logger.error(CLASS_NAME, 'deleteBranches', `Repository path not found: ${repository}`);
      this.postMessage({
        type: 'deleteResult',
        results: branches.map((branchName) => ({
          branchName,
          success: false,
          error: 'Repository path not found in settings',
        })),
        success: false,
      });
      return;
    }

    // Ensure database connection for audit logging
    await this.ensureDbConnection();
    if (!this.db) {
      this.logger.error(CLASS_NAME, 'deleteBranches', 'Database connection not available');
      this.postMessage({
        type: 'deleteResult',
        results: branches.map((branchName) => ({
          branchName,
          success: false,
          error: 'Database connection not available for audit logging',
        })),
        success: false,
      });
      return;
    }

    // Create branch repository for audit logging
    const branchRepo = new BranchRepository(this.db);

    // Get config from settings
    // GITX-233: Include targetBranches from settings for configurable merge detection
    const config: DeadBranchesConfig = {
      staleDaysThreshold: settings.branchCleanup.staleDays,
      excludePatterns: [...settings.branchCleanup.excludePatterns],
      mergedOnly: settings.branchCleanup.mergedOnly,
      targetBranches: [...settings.branchCleanup.targetBranches],
    };

    // Create service for this repository
    // GITX-233: Pass repository name from settings to ensure database entries match config
    const service = new DeadBranchesService(repoConfig.path, branchRepo, config, repoConfig.name);

    // Delete branches using service
    const deleteResults = await service.deleteBranches(branches, force);

    // Map to protocol results
    const results: DeleteResult[] = deleteResults.map((r) => ({
      branchName: r.branchName,
      success: r.success,
      sha: r.sha,
      error: r.error,
    }));

    const successCount = results.filter((r) => r.success).length;
    this.logger.info(
      CLASS_NAME,
      'deleteBranches',
      `Deletion complete: ${successCount}/${branches.length} branches deleted`,
    );

    // Show result notification
    if (successCount === branches.length) {
      void vscode.window.showInformationMessage(
        `Successfully deleted ${successCount} branch(es) from ${repository}.`,
      );
    } else if (successCount > 0) {
      void vscode.window.showWarningMessage(
        `Deleted ${successCount}/${branches.length} branches. Check results for details.`,
      );
    } else {
      void vscode.window.showErrorMessage(
        `Failed to delete branches. ${results[0]?.error ?? 'Unknown error'}`,
      );
    }

    this.postMessage({
      type: 'deleteResult',
      results,
      success: results.every((r) => r.success),
    });
  }

  /**
   * Scan repositories for branch analysis.
   * Calls DeadBranchesService.analyzeBranches() for each configured repository
   * and populates the git_branch table.
   *
   * @param message - Scan request with optional repository filter
   */
  private async scanBranches(message: RequestScanBranches): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const settings = getSettings();
    const repos = settings.repositories ?? [];

    // Filter to specific repository if requested
    const targetRepos = message.repository
      ? repos.filter((r) => r.name === message.repository)
      : repos;

    if (targetRepos.length === 0) {
      this.logger.warn(CLASS_NAME, 'scanBranches', 'No repositories configured');
      this.postMessage({
        type: 'scanComplete',
        branchesFound: 0,
        repositoriesScanned: 0,
        success: false,
        error: 'No repositories configured. Add repositories in gitr.repositories setting.',
      });
      return;
    }

    this.logger.info(CLASS_NAME, 'scanBranches', `Scanning ${targetRepos.length} repositories`);

    let scannedRepos = 0;

    // Create branch repository for database operations
    const branchRepo = new BranchRepository(this.db);

    // Get config from settings
    // GITX-233: Include targetBranches from settings for configurable merge detection
    const config: DeadBranchesConfig = {
      staleDaysThreshold: settings.branchCleanup.staleDays,
      excludePatterns: [...settings.branchCleanup.excludePatterns],
      mergedOnly: settings.branchCleanup.mergedOnly,
      targetBranches: [...settings.branchCleanup.targetBranches],
    };

    for (const repoConfig of targetRepos) {
      try {
        // Send progress update
        this.postMessage({
          type: 'scanProgress',
          repository: repoConfig.name,
          current: scannedRepos + 1,
          total: targetRepos.length,
          message: `Scanning ${repoConfig.name}...`,
        });

        this.logger.debug(CLASS_NAME, 'scanBranches', `Analyzing repository: ${repoConfig.name} at ${repoConfig.path}`);

        // Create service for this repository
        // GITX-233: Pass repository name from settings to ensure database entries match config
        const service = new DeadBranchesService(repoConfig.path, branchRepo, config, repoConfig.name);

        // Analyze branches and save to database
        const branchCount = await service.syncBranchesToDatabase();
        scannedRepos++;

        this.logger.info(
          CLASS_NAME,
          'scanBranches',
          `Repository ${repoConfig.name}: synced ${branchCount} branches to database`,
        );
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(CLASS_NAME, 'scanBranches', `Error scanning ${repoConfig.name}: ${errorMsg}`);
        // Continue scanning other repositories
      }
    }

    // GITX-235: Get accurate total branch count vs cleanup candidates
    // totalBranches from syncBranchesToDatabase counts non-protected branches only.
    // We need to query the database for the accurate breakdown.
    const branchCountStats = await branchRepo.getTotalBranchCount();

    this.logger.info(
      CLASS_NAME,
      'scanBranches',
      `Scan complete: ${branchCountStats.totalBranches} total branches (${branchCountStats.cleanupCandidates} cleanup candidates) in ${scannedRepos} repositories`,
    );

    // Send completion message with both total and cleanup candidate counts
    this.postMessage({
      type: 'scanComplete',
      branchesFound: branchCountStats.totalBranches,
      repositoriesScanned: scannedRepos,
      cleanupCandidates: branchCountStats.cleanupCandidates,
      success: scannedRepos > 0,
    });

    // Auto-refresh branch data after scan
    if (scannedRepos > 0) {
      const data = await this.getBranchData({});
      this.postMessage({
        type: 'branchData',
        branches: data.branches,
        summary: data.summary,
        riskDistribution: data.riskDistribution,
        repositoryBreakdown: data.repositoryBreakdown,
        hasData: data.branches.length > 0,
      });
    }
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: DeadBranchesHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
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
   */
  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Dispose the panel and all its resources.
   */
  dispose(): void {
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing DeadBranchesPanel');

    DeadBranchesPanel.currentPanel = undefined;

    // Reset rate limiter state
    this.rateLimiter.reset();

    // Clear repository reference (repository doesn't hold resources)
    this.branchRepo = undefined;

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down dead branches database connection');
      void this.db.shutdown();
      this.db = undefined;
    }

    this.panel.dispose();

    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }

    this.logger.debug(CLASS_NAME, 'dispose', 'DeadBranchesPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    DeadBranchesPanel.currentPanel = undefined;
  }
}
