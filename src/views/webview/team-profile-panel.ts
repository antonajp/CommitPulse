/**
 * Team Profile Dashboard webview panel manager.
 * Creates and manages VS Code WebviewPanels with:
 * - Multi-instance pattern (multiple panels can be open simultaneously for different teams)
 * - Message routing between webview and extension host
 * - D3.js v7 bundled as a local resource
 * - CSP nonce generation for script authorization
 * - Rate limiting on message handlers
 * - Proper disposal and resource cleanup
 * - Pre-selection of team when opened from TreeView
 * - Shared dashboard cache service across all instances (GITX-194, GITX-196)
 *
 * Ticket: GITX-185, GITX-196
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
 * GITX-196: Implements multi-instance pattern - multiple panels can be open simultaneously
 * for different teams, enabling side-by-side comparison.
 */
export class TeamProfilePanel implements vscode.Disposable {
  /**
   * Track all active panel instances for testing and cleanup.
   * GITX-196: Replaces singleton pattern with collection for multi-instance support.
   */
  private static activePanels: Set<TeamProfilePanel> = new Set();

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
   * Create a new Team Profile panel.
   * GITX-196: Always creates a new panel instance (no singleton). Multiple panels can be open
   * simultaneously for different teams, enabling side-by-side comparison.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   * @param team - Optional pre-selected team name (used in panel title)
   * @returns The newly created TeamProfilePanel instance
   */
  static create(
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
    team?: string,
  ): TeamProfilePanel {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'create', `Creating new Team Profile panel${team ? ` for ${team}` : ''}`);

    // GITX-196: Determine view column - open beside if another editor/panel is active
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    logger.debug(CLASS_NAME, 'create', `Creating new webview panel in column ${column}`);

    // GITX-196: Panel title includes team name for identification
    const panelTitle = team ? `Team Profile: ${team}` : 'Team Profile';

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

    return new TeamProfilePanel(panel, extensionUri, secretService, team);
  }

  /**
   * @deprecated Use create() instead. This method exists for backward compatibility
   * but will be removed in a future version.
   * GITX-196: createOrShow is replaced by create() for multi-instance support.
   */
  static createOrShow(
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
    team?: string,
  ): void {
    // Delegate to create() for backward compatibility
    TeamProfilePanel.create(extensionUri, secretService, team);
  }

  /**
   * Private constructor — use create() to create instances.
   * GITX-196: Each instance has independent state and shares the cache service.
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
    // GITX-196: Cache service is shared via singleton - accessed through TeamProfileDataService

    this.logger.debug(CLASS_NAME, 'constructor', `Initializing TeamProfilePanel for team: ${team ?? 'none'}`);

    // GITX-196: Track this panel in the active set
    TeamProfilePanel.activePanels.add(this);
    this.logger.debug(CLASS_NAME, 'constructor', `Active panels count: ${TeamProfilePanel.activePanels.size}`);

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

    this.logger.info(CLASS_NAME, 'constructor', `TeamProfilePanel initialized successfully for: ${team ?? 'no team'}`);
  }

  /**
   * Set the selected team, update the panel title, and notify the webview.
   * GITX-196: Updates panel title to reflect the selected team.
   */
  private setTeam(team: string): void {
    this.logger.debug(CLASS_NAME, 'setTeam', `Setting team to: ${team}`);
    this.selectedTeam = team;

    // GITX-196: Update panel title to include team name
    this.panel.title = `Team Profile: ${team}`;

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
          // GITX-196: Use setTeam to update title and state together
          // GITX-220: Added organization averages for KPI comparison
          this.setTeam(message.team);
          this.selectedTimeframe = message.timeframeDays;
          const filters = {
            team: message.team,
            timeframeDays: message.timeframeDays,
          };
          // GITX-200: Added velocityWithMembers for stacked member chart
          // GITX-220: Added orgAverages for KPI comparison
          const [summary, locPerWeek, complexFilesChart, frequentFilesChart, techStack, commentsPerWeek, testsPerWeek, hygieneScore, velocityVsLoc, velocityWithMembers, hasVelocityData, hotSpots, knowledgeConcentration, orgAverages] = await Promise.all([
            this.dataService.getSummary(filters),
            this.dataService.getLocPerWeek(filters),
            this.dataService.getTopComplexFilesWithContributors(filters),
            this.dataService.getTopFrequentFilesWithContributors(filters),
            this.dataService.getTechStack(filters),
            this.dataService.getCommentsPerWeek(filters),
            this.dataService.getTestsPerWeek(filters),
            this.dataService.getHygieneScore(filters),
            this.dataService.getVelocityVsLoc(filters),
            this.dataService.getVelocityWithMembers(filters),
            this.dataService.hasVelocityData(filters.team),
            this.dataService.getTeamHotSpots(filters.team),
            this.dataService.getTeamKnowledgeConcentration(filters.team),
            this.dataService.getOrganizationAverages(filters),
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
          // GITX-200: Send velocity with member breakdown for stacked chart
          this.postMessage({ type: 'teamVelocityWithMembersData', data: velocityWithMembers });
          this.postMessage({ type: 'teamHasVelocityData', hasData: hasVelocityData });
          // GITX-188: Send hot spots and knowledge concentration data
          this.postMessage({ type: 'teamHotSpotsData', data: hotSpots });
          this.postMessage({ type: 'teamKnowledgeConcentrationData', data: knowledgeConcentration });
          // GITX-220: Send organization averages for KPI comparison
          this.postMessage({ type: 'teamOrgAveragesData', data: orgAverages });
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

        // GITX-214: Technology stack by file extension
        case 'requestTeamTechStackByExtension': {
          const data = await this.dataService.getTechStackByExtension({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamTechStackByExtensionData', data });
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

        // GITX-200: Velocity with member breakdown for stacked bar chart
        case 'requestTeamVelocityWithMembers': {
          const velocityMembersData = await this.dataService.getVelocityWithMembers({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamVelocityWithMembersData', data: velocityMembersData });
          break;
        }

        // GITX-220: Organization averages for KPI comparison
        case 'requestTeamOrgAverages': {
          const orgAvgData = await this.dataService.getOrganizationAverages({
            team: message.team,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'teamOrgAveragesData', data: orgAvgData });
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
   * GITX-196: Removes panel from active set instead of clearing singleton.
   */
  dispose(): void {
    // GITX-175: Prevent double disposal and set flag FIRST to stop new queries
    if (this.isDisposed) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Panel already disposed, skipping');
      return;
    }
    this.isDisposed = true;
    this.logger.info(CLASS_NAME, 'dispose', `Disposing TeamProfilePanel for: ${this.selectedTeam ?? 'no team'}`);

    // GITX-196: Remove from active panels set instead of clearing singleton
    TeamProfilePanel.activePanels.delete(this);
    this.logger.debug(CLASS_NAME, 'dispose', `Active panels remaining: ${TeamProfilePanel.activePanels.size}`);

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
   * Reset all panel tracking for testing purposes.
   * GITX-196: Clears the active panels set instead of singleton.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    TeamProfilePanel.activePanels.clear();
  }

  /**
   * Get the count of active panels.
   * GITX-196: Useful for testing and debugging multi-instance behavior.
   * @returns The number of currently active TeamProfilePanel instances
   */
  static getActivePanelCount(): number {
    return TeamProfilePanel.activePanels.size;
  }

  /**
   * Get the team identifier for this panel.
   * GITX-196: Useful for testing panel state.
   * @returns The selected team or null
   */
  getTeam(): string | null {
    return this.selectedTeam;
  }

  /**
   * Get the timeframe for this panel.
   * GITX-196: Useful for testing panel state.
   * @returns The selected timeframe
   */
  getTimeframe(): TeamProfileTimeframe {
    return this.selectedTimeframe;
  }
}
