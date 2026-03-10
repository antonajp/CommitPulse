/**
 * Cross-Team Coupling dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Interactive chord diagram: D3.js chord layout with team arcs
 * - Chord thickness reflects coupling strength
 * - Hover highlights connected chords
 * - Click chord opens shared files panel
 * - Team visibility toggles
 * - Coupling strength threshold slider
 * - Summary panel with coupling insights
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-910
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { TeamCouplingDataService } from '../../services/team-coupling-service.js';
import { generateCouplingHtml } from './coupling-html.js';
import { getSettings } from '../../config/settings.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { CouplingWebviewToHost, CouplingHostToWebview } from './coupling-protocol.js';
import type { CouplingFilters } from '../../services/team-coupling-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'CouplingPanel';

/**
 * View type identifier for the cross-team coupling webview.
 */
const VIEW_TYPE = 'gitrx.couplingPanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Manages the Cross-Team Coupling WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: IQS-910
 */
export class CouplingPanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: CouplingPanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private db: DatabaseService | undefined;
  private dataService: TeamCouplingDataService | undefined;

  /**
   * Create or reveal the Cross-Team Coupling panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Cross-Team Coupling panel');

    // If panel exists, reveal it
    if (CouplingPanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      CouplingPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!CouplingPanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new cross-team coupling webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Team Coupling',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    CouplingPanel.currentPanel = new CouplingPanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing CouplingPanel');

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
      (message: CouplingWebviewToHost) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'CouplingPanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating cross-team coupling webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'coupling.css'),
    );

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateCouplingHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Cross-team coupling webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   */
  private async handleMessage(message: CouplingWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    try {
      switch (message.type) {
        case 'requestCouplingData': {
          await this.handleRequestCouplingData(message.filters);
          break;
        }

        case 'requestSharedFilesData': {
          await this.handleRequestSharedFilesData(message.teamA, message.teamB);
          break;
        }

        case 'requestCouplingRefresh': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Refresh requested');
          await this.handleRequestCouplingData(message.filters);
          break;
        }

        case 'requestCouplingFilterUpdate': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Filter update requested');
          await this.handleRequestCouplingData(message.filters);
          break;
        }

        case 'requestTeamDrillDown': {
          await this.handleRequestTeamDrillDown(message);
          break;
        }

        case 'requestTeamPairDrillDown': {
          await this.handleRequestTeamPairDrillDown(message);
          break;
        }

        case 'requestOpenFile': {
          await this.handleRequestOpenFile(message);
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
   * Handle request for coupling chart data.
   */
  private async handleRequestCouplingData(filters?: CouplingFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestCouplingData', 'Processing requestCouplingData');

    // Send loading state
    this.postMessage({ type: 'couplingLoading', isLoading: true });

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestCouplingData', 'Data service not available after DB init');
      this.postError('Data service unavailable', 'requestCouplingData');
      return;
    }

    const chartData = await this.dataService.getChartData(filters ?? {});

    // Also send filter options for the dropdowns
    await this.sendFilterOptions();

    this.postMessage({
      type: 'couplingData',
      couplingData: chartData.couplingData,
      chordData: chartData.chordData,
      summary: chartData.summary,
      hasData: chartData.hasData,
      viewExists: chartData.viewExists,
    });

    this.postMessage({ type: 'couplingLoading', isLoading: false });
  }

  /**
   * Handle request for shared files data between two teams.
   */
  private async handleRequestSharedFilesData(teamA: string, teamB: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestSharedFilesData',
      `Processing requestSharedFilesData: teamA=${teamA}, teamB=${teamB}`);

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestSharedFilesData', 'Data service not available');
      this.postError('Data service unavailable', 'requestSharedFilesData');
      return;
    }

    const chartData = await this.dataService.getSharedFilesChartData(teamA, teamB);

    this.postMessage({
      type: 'sharedFilesData',
      teamA: chartData.teamA,
      teamB: chartData.teamB,
      sharedFiles: chartData.sharedFiles,
      hasData: chartData.hasData,
      viewExists: chartData.viewExists,
    });
  }

  /**
   * Handle drill-down request for a specific team.
   */
  private async handleRequestTeamDrillDown(message: {
    type: 'requestTeamDrillDown';
    team: string;
    filters?: CouplingFilters;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestTeamDrillDown',
      `Drill-down for team: ${message.team}`);

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestTeamDrillDown', 'Data service not available');
      this.postError('Data service unavailable', 'requestTeamDrillDown');
      return;
    }

    // Get coupling data filtered to this team
    const teamFilters: CouplingFilters = {
      ...message.filters,
      teamA: message.team,
    };

    const couplingRows = await this.dataService.getCouplingMatrix(teamFilters);

    // Calculate summary for this team
    const coupledTeams = [...new Set(
      couplingRows.flatMap(r => [r.teamA, r.teamB])
        .filter(t => t !== message.team)
    )].sort();

    const totalSharedFiles = couplingRows.reduce((sum, r) => sum + r.sharedFileCount, 0);
    const avgCouplingStrength = couplingRows.length > 0
      ? Math.round(couplingRows.reduce((sum, r) => sum + r.couplingStrength, 0) / couplingRows.length * 100) / 100
      : 0;

    this.postMessage({
      type: 'teamDrillDown',
      team: message.team,
      couplingRows,
      totalSharedFiles,
      coupledTeams,
      avgCouplingStrength,
    });
  }

  /**
   * Handle drill-down request for a specific team pair.
   */
  private async handleRequestTeamPairDrillDown(message: {
    type: 'requestTeamPairDrillDown';
    teamA: string;
    teamB: string;
    filters?: CouplingFilters;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestTeamPairDrillDown',
      `Drill-down for team pair: ${message.teamA} <-> ${message.teamB}`);

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestTeamPairDrillDown', 'Data service not available');
      this.postError('Data service unavailable', 'requestTeamPairDrillDown');
      return;
    }

    // Get coupling data for this pair
    const couplingRows = await this.dataService.getCouplingMatrix({
      ...message.filters,
      teamA: message.teamA,
      teamB: message.teamB,
    });

    const coupling = couplingRows[0] ?? null;

    // Get shared files for this pair
    const sharedFiles = await this.dataService.getSharedFiles(message.teamA, message.teamB);

    const hotspotFiles = coupling?.hotspotFiles ?? [];

    this.postMessage({
      type: 'teamPairDrillDown',
      teamA: message.teamA,
      teamB: message.teamB,
      coupling,
      sharedFiles,
      hotspotFiles,
    });
  }

  /**
   * Handle request to open a file in VS Code.
   */
  private async handleRequestOpenFile(message: {
    type: 'requestOpenFile';
    filePath: string;
    repository: string;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestOpenFile',
      `Opening file: ${message.filePath} in ${message.repository}`);

    // Look up repository path from settings
    const settings = getSettings();
    const repoConfig = settings.repositories.find(r => r.name === message.repository);

    if (!repoConfig) {
      this.logger.warn(CLASS_NAME, 'handleRequestOpenFile', `Repository not found: ${message.repository}`);
      void vscode.window.showWarningMessage(`Repository "${message.repository}" not found in settings.`);
      return;
    }

    // Construct full file path
    const fullPath = vscode.Uri.file(`${repoConfig.path}/${message.filePath}`);

    try {
      const doc = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(doc);
      this.logger.info(CLASS_NAME, 'handleRequestOpenFile', `Opened file: ${fullPath.fsPath}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'handleRequestOpenFile', `Failed to open file: ${msg}`);
      void vscode.window.showErrorMessage(`Could not open file: ${message.filePath}`);
    }
  }

  /**
   * Send available filter options to the webview.
   */
  private async sendFilterOptions(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'sendFilterOptions', 'Fetching filter options');

    if (!this.dataService) {
      return;
    }

    const teams = await this.dataService.getUniqueTeams();
    const summary = await this.dataService.getSummary();

    // Get repositories from settings
    const settings = getSettings();
    const repositories = settings.repositories.map(r => r.name);

    this.postMessage({
      type: 'couplingFilterOptions',
      teams,
      repositories,
      strengthRange: {
        min: 0,
        max: summary.maxCouplingStrength,
      },
    });
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and TeamCouplingDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for team coupling');

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

    this.dataService = new TeamCouplingDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for team coupling');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: CouplingHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'couplingError',
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
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing CouplingPanel');

    CouplingPanel.currentPanel = undefined;

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down team coupling database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'CouplingPanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    CouplingPanel.currentPanel = undefined;
  }
}
