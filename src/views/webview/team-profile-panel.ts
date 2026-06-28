/**
 * Team Profile Dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Message routing between webview and extension host
 * - D3.js v7 bundled as a local resource
 * - CSP nonce generation for script authorization
 * - Rate limiting on message handlers
 * - Proper disposal and resource cleanup
 * - Pre-selection of team when opened from TreeView
 *
 * Ticket: GITX-185
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { TeamProfileDataService } from '../../services/team-profile-data-service.js';
import { generateTeamProfileHtml } from './team-profile-html.js';
import { getSettings } from '../../config/settings.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type {
  TeamProfileWebviewToHost,
  TeamProfileHostToWebview,
  TeamProfileTimeframe,
} from './team-profile-protocol.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'TeamProfilePanel';

/**
 * View type identifier for the team profile webview.
 */
const VIEW_TYPE = 'gitrx.teamProfilePanel';

/**
 * Manages the Team Profile Dashboard WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 */
export class TeamProfilePanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: TeamProfilePanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private dataService: TeamProfileDataService | undefined;
  private selectedTeam: string | null = null;
  private selectedTimeframe: TeamProfileTimeframe = '90';
  /**
   * Flag to track disposal state and prevent race conditions.
   * When true, incoming messages are ignored to avoid "pool after end" errors.
   * GITX-175: Fixes race condition between panel disposal and active database queries.
   */
  private isDisposed = false;

  /**
   * Create or reveal the Team Profile panel.
   * If a panel already exists, it is brought to the front.
   * If no panel exists, a new one is created.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   * @param team - Optional pre-selected team name
   */
  static createOrShow(
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
    team?: string,
  ): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', `Opening Team Profile panel${team ? ` for ${team}` : ''}`);

    // If panel exists, reveal it and optionally update team
    if (TeamProfilePanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      if (team) {
        TeamProfilePanel.currentPanel.setTeam(team);
      }
      TeamProfilePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Team Profile',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    TeamProfilePanel.currentPanel = new TeamProfilePanel(panel, extensionUri, secretService, team);
  }

  /**
   * Private constructor — use createOrShow() to create instances.
   */
  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
    team?: string,
  ) {
    this.logger = LoggerService.getInstance();
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.secretService = secretService;
    this.selectedTeam = team ?? null;
    this.rateLimiter = new MessageRateLimiter({
      minIntervalMs: DEFAULT_RATE_LIMIT_INTERVAL_MS,
      className: CLASS_NAME,
    });

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing TeamProfilePanel');

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
      (message: TeamProfileWebviewToHost) => {
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
        team: this.selectedTeam,
        timeframeDays: this.selectedTimeframe,
      });
    }, 100);

    this.logger.info(CLASS_NAME, 'constructor', 'TeamProfilePanel initialized successfully');
  }

  /**
   * Set the selected team and notify the webview.
   */
  private setTeam(team: string): void {
    this.logger.debug(CLASS_NAME, 'setTeam', `Setting team to: ${team}`);
    this.selectedTeam = team;
    this.postMessage({
      type: 'initialState',
      team: this.selectedTeam,
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

    const html = generateTeamProfileHtml({
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
  private async handleMessage(message: TeamProfileWebviewToHost): Promise<void> {
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
        case 'requestTeams': {
          const data = await this.dataService.getTeams();
          this.postMessage({ type: 'teamsData', data });
          break;
        }

        case 'requestTeamSummary': {
          const data = await this.dataService.getSummary({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamSummaryData', data });
          break;
        }

        case 'requestTeamLocPerWeek': {
          const data = await this.dataService.getLocPerWeek({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamLocPerWeekData', data });
          break;
        }

        case 'requestTeamTopComplexFiles': {
          const data = await this.dataService.getTopComplexFiles({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamTopComplexFilesData', data });
          break;
        }

        case 'requestTeamTopFrequentFiles': {
          const data = await this.dataService.getTopFrequentFiles({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamTopFrequentFilesData', data });
          break;
        }

        case 'requestTeamAllData': {
          // Request all data in parallel (matching DevProfilePanel pattern)
          // GITX-186: Added per-author contribution chart data
          // GITX-188: Added hot spots and knowledge concentration, removed test debt
          this.selectedTeam = message.team;
          this.selectedTimeframe = message.timeframeDays;
          const filters = {
            team: message.team,
            timeframeDays: message.timeframeDays,
          };
          const [summary, locPerWeek, complexFilesChart, frequentFilesChart, techStack, commentsPerWeek, testsPerWeek, hygieneScore, velocityVsLoc, hasVelocityData, hotSpots, knowledgeConcentration] = await Promise.all([
            this.dataService.getSummary(filters),
            this.dataService.getLocPerWeek(filters),
            this.dataService.getTopComplexFilesWithContributors(filters),
            this.dataService.getTopFrequentFilesWithContributors(filters),
            this.dataService.getTechStack(filters),
            this.dataService.getCommentsPerWeek(filters),
            this.dataService.getTestsPerWeek(filters),
            this.dataService.getHygieneScore(filters),
            this.dataService.getVelocityVsLoc(filters),
            this.dataService.hasVelocityData(filters.team),
            this.dataService.getTeamHotSpots(filters.team),
            this.dataService.getTeamKnowledgeConcentration(filters.team),
          ]);
          this.postMessage({ type: 'teamSummaryData', data: summary });
          this.postMessage({ type: 'teamLocPerWeekData', data: locPerWeek });
          // GITX-186: Send chart data with per-author contributions
          this.postMessage({ type: 'teamComplexFilesChartData', data: complexFilesChart });
          this.postMessage({ type: 'teamFrequentFilesChartData', data: frequentFilesChart });
          this.postMessage({ type: 'teamTechStackData', data: techStack });
          this.postMessage({ type: 'teamCommentsPerWeekData', data: commentsPerWeek });
          this.postMessage({ type: 'teamTestsPerWeekData', data: testsPerWeek });
          this.postMessage({ type: 'teamHygieneScoreData', data: hygieneScore });
          this.postMessage({ type: 'teamVelocityVsLocData', data: velocityVsLoc });
          this.postMessage({ type: 'teamHasVelocityData', hasData: hasVelocityData });
          // GITX-188: Send hot spots and knowledge concentration data
          this.postMessage({ type: 'teamHotSpotsData', data: hotSpots });
          this.postMessage({ type: 'teamKnowledgeConcentrationData', data: knowledgeConcentration });
          break;
        }

        case 'requestTeamTechStack': {
          const data = await this.dataService.getTechStack({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamTechStackData', data });
          break;
        }

        case 'requestTeamCommentsPerWeek': {
          const data = await this.dataService.getCommentsPerWeek({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamCommentsPerWeekData', data });
          break;
        }

        case 'requestTeamTestsPerWeek': {
          const data = await this.dataService.getTestsPerWeek({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamTestsPerWeekData', data });
          break;
        }

        case 'requestTeamHygieneScore': {
          const data = await this.dataService.getHygieneScore({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamHygieneScoreData', data });
          break;
        }

        case 'requestTeamVelocityVsLoc': {
          const data = await this.dataService.getVelocityVsLoc({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamVelocityVsLocData', data });
          break;
        }

        case 'requestTeamHasVelocityData': {
          const hasData = await this.dataService.hasVelocityData(message.team);
          this.postMessage({ type: 'teamHasVelocityData', hasData });
          break;
        }

        // GITX-186: Chart data with per-author contributions
        case 'requestTeamComplexFilesChart': {
          const chartData = await this.dataService.getTopComplexFilesWithContributors({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamComplexFilesChartData', data: chartData });
          break;
        }

        case 'requestTeamFrequentFilesChart': {
          const chartData = await this.dataService.getTopFrequentFilesWithContributors({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamFrequentFilesChartData', data: chartData });
          break;
        }

        // GITX-188: Hot Spots and Knowledge Concentration charts
        case 'requestTeamHotSpots': {
          const hotSpotsData = await this.dataService.getTeamHotSpots(message.team);
          this.postMessage({ type: 'teamHotSpotsData', data: hotSpotsData });
          break;
        }

        case 'requestTeamKnowledgeConcentration': {
          const knowledgeData = await this.dataService.getTeamKnowledgeConcentration(message.team);
          this.postMessage({ type: 'teamKnowledgeConcentrationData', data: knowledgeData });
          break;
        }

        default: {
          // Exhaustiveness check
          const _exhaustive: never = message;
          this.logger.warn(CLASS_NAME, 'handleMessage', `Unknown message type: ${(_exhaustive as TeamProfileWebviewToHost).type}`);
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
   * Lazily initializes the DatabaseService and TeamProfileDataService.
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

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for team profile');

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

    this.dataService = new TeamProfileDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for team profile');
  }

  /**
   * Post a typed message to the webview.
   *
   * @param message - The message to send to the webview
   */
  private postMessage(message: TeamProfileHostToWebview): void {
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
    // GITX-175: Prevent double disposal and set flag FIRST to stop new queries
    if (this.isDisposed) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Panel already disposed, skipping');
      return;
    }
    this.isDisposed = true;
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing TeamProfilePanel');

    TeamProfilePanel.currentPanel = undefined;

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
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down team profile database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'TeamProfilePanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    TeamProfilePanel.currentPanel = undefined;
  }
}
