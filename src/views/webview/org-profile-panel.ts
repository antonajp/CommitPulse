/**
 * Organization Profile Dashboard webview panel manager.
 * Creates and manages VS Code WebviewPanels with:
 * - Multi-instance pattern (multiple panels can be open simultaneously for different organizations)
 * - Message routing between webview and extension host
 * - D3.js v7 bundled as a local resource
 * - CSP nonce generation for script authorization
 * - Rate limiting on message handlers
 * - Proper disposal and resource cleanup
 * - Pre-selection of organization when opened from TreeView
 * - Shared dashboard cache service across all instances (GITX-194, GITX-197)
 *
 * Ticket: GITX-205, GITX-197
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { OrganizationProfileDataService } from '../../services/org-profile-data-service.js';
import { getSettings } from '../../config/settings.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from './message-rate-limiter.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type {
  OrgProfileWebviewToHost,
  OrgProfileHostToWebview,
  OrgProfileTimeframe,
} from './org-profile-protocol.js';
import { generateOrgProfileHtml } from './org-profile-html.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'OrganizationProfilePanel';

/**
 * View type identifier for the organization profile webview.
 */
const VIEW_TYPE = 'gitrx.organizationProfilePanel';

/**
 * Manages the Organization Profile Dashboard WebviewPanel lifecycle.
 * GITX-197: Implements multi-instance pattern - multiple panels can be open simultaneously
 * for different organizations, enabling side-by-side comparison.
 */
export class OrganizationProfilePanel implements vscode.Disposable {
  /**
   * Track all active panel instances for testing and cleanup.
   * GITX-197: Replaces singleton pattern with collection for multi-instance support.
   */
  private static activePanels: Set<OrganizationProfilePanel> = new Set();

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly rateLimiter: MessageRateLimiter;
  private db: DatabaseService | undefined;
  private dataService: OrganizationProfileDataService | undefined;
  private selectedOrganizationId: number | null = null;
  private selectedTimeframe: OrgProfileTimeframe = '90';
  /**
   * Flag to track disposal state and prevent race conditions.
   * When true, incoming messages are ignored to avoid "pool after end" errors.
   * Matches TeamProfilePanel pattern from GITX-175.
   */
  private isDisposed = false;

  /**
   * Create a new Organization Profile panel.
   * GITX-197: Always creates a new panel instance (no singleton). Multiple panels can be open
   * simultaneously for different organizations, enabling side-by-side comparison.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   * @param organization - Optional pre-selected organization name (used in panel title)
   * @returns The newly created OrganizationProfilePanel instance
   */
  static create(
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
    organization?: string,
  ): OrganizationProfilePanel {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'create', `Creating new Organization Profile panel${organization ? ` for ${organization}` : ''}`);

    // GITX-197: Determine view column - open beside if another editor/panel is active
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    logger.debug(CLASS_NAME, 'create', `Creating new webview panel in column ${column}`);

    // GITX-197: Panel title includes organization name for identification
    const panelTitle = organization ? `Org Profile: ${organization}` : 'Organization Profile';

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

    return new OrganizationProfilePanel(panel, extensionUri, secretService, organization);
  }

  /**
   * @deprecated Use create() instead. This method exists for backward compatibility
   * but will be removed in a future version.
   * GITX-197: createOrShow is replaced by create() for multi-instance support.
   */
  static createOrShow(
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
    organization?: string,
  ): void {
    // Delegate to create() for backward compatibility
    OrganizationProfilePanel.create(extensionUri, secretService, organization);
  }

  /**
   * Private constructor — use create() to create instances.
   * GITX-197: Each instance has independent state and shares the cache service.
   */
  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    secretService: SecretStorageService,
    organization?: string,
  ) {
    this.logger = LoggerService.getInstance();
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.secretService = secretService;
    this.rateLimiter = new MessageRateLimiter({
      minIntervalMs: DEFAULT_RATE_LIMIT_INTERVAL_MS,
      className: CLASS_NAME,
    });
    // GITX-197: Cache service is shared via singleton - accessed through OrganizationProfileDataService

    this.logger.debug(CLASS_NAME, 'constructor', `Initializing OrganizationProfilePanel for organization: ${organization ?? 'none'}`);

    // GITX-197: Track this panel in the active set
    OrganizationProfilePanel.activePanels.add(this);
    this.logger.debug(CLASS_NAME, 'constructor', `Active panels count: ${OrganizationProfilePanel.activePanels.size}`);

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
      (message: OrgProfileWebviewToHost) => {
        this.logger.debug(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    // If organization name provided, look up its ID after DB is available
    if (organization) {
      void this.initializeWithOrganizationName(organization);
    } else {
      // Send initial state to webview after a short delay to ensure it's ready
      setTimeout(() => {
        this.postMessage({
          type: 'initialState',
          organizationId: this.selectedOrganizationId,
          timeframeDays: this.selectedTimeframe,
        });
      }, 100);
    }

    this.logger.info(CLASS_NAME, 'constructor', `OrganizationProfilePanel initialized successfully for: ${organization ?? 'no organization'}`);
  }

  /**
   * Initialize the panel with an organization name by looking up its ID.
   */
  private async initializeWithOrganizationName(organizationName: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'initializeWithOrganizationName', `Looking up organization: ${organizationName}`);
    try {
      await this.ensureDbConnection();
      if (this.dataService) {
        const organizations = await this.dataService.getOrganizations();
        const org = organizations.find((o) => o.name === organizationName);
        if (org) {
          this.selectedOrganizationId = org.id;
          this.updatePanelTitle(org.name);
          this.logger.debug(CLASS_NAME, 'initializeWithOrganizationName', `Found organization ID: ${org.id}`);
        }
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'initializeWithOrganizationName', `Failed to look up organization: ${errorMsg}`);
    }

    this.postMessage({
      type: 'initialState',
      organizationId: this.selectedOrganizationId,
      timeframeDays: this.selectedTimeframe,
    });
  }

  /**
   * Update the panel title with the organization name.
   */
  private updatePanelTitle(organizationName: string): void {
    this.panel.title = `Organization Profile: ${organizationName}`;
    this.logger.debug(CLASS_NAME, 'updatePanelTitle', `Panel title updated to: ${this.panel.title}`);
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   * GITX-206: Now uses generateOrgProfileHtml from org-profile-html.ts for full KPI cards.
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

    // GITX-206: Use generateOrgProfileHtml for full KPI card implementation
    const html = generateOrgProfileHtml({
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
  private async handleMessage(message: OrgProfileWebviewToHost): Promise<void> {
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
        case 'requestOrganizations': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Processing requestOrganizations');
          const data = await this.dataService.getOrganizations();
          this.logger.debug(CLASS_NAME, 'handleMessage', `Got ${data.length} organizations, sending to webview`);
          this.postMessage({ type: 'organizationsData', data });
          this.logger.debug(CLASS_NAME, 'handleMessage', 'organizationsData message sent');
          break;
        }

        case 'requestOrganizationById': {
          const data = await this.dataService.getOrganizationById(message.organizationId);
          this.postMessage({ type: 'organizationData', data });
          break;
        }

        case 'requestOrgSummary': {
          const data = await this.dataService.getSummary({
            organizationId: message.organizationId,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'orgSummaryData', data });
          break;
        }

        case 'requestOrgLocPerWeek': {
          const data = await this.dataService.getLocPerWeek({
            organizationId: message.organizationId,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'orgLocPerWeekData', data });
          break;
        }

        case 'requestOrgTopComplexFiles': {
          const data = await this.dataService.getTopComplexFilesByTeam(message.organizationId);
          this.postMessage({ type: 'orgTopComplexFilesData', data });
          break;
        }

        case 'requestOrgTopFrequentFiles': {
          const data = await this.dataService.getTopFrequentFilesByTeam(message.organizationId);
          this.postMessage({ type: 'orgTopFrequentFilesData', data });
          break;
        }

        case 'requestOrgTechStack': {
          const data = await this.dataService.getTechStack({
            organizationId: message.organizationId,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'orgTechStackData', data });
          break;
        }

        // GITX-214: Technology stack by file extension
        case 'requestOrgTechStackByExtension': {
          const data = await this.dataService.getTechStackByExtension({
            organizationId: message.organizationId,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'orgTechStackByExtensionData', data });
          break;
        }

        case 'requestOrgCommentsPerWeek': {
          const data = await this.dataService.getCommentsPerWeek({
            organizationId: message.organizationId,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'orgCommentsPerWeekData', data });
          break;
        }

        case 'requestOrgTestsPerWeek': {
          const data = await this.dataService.getTestsPerWeek({
            organizationId: message.organizationId,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'orgTestsPerWeekData', data });
          break;
        }

        case 'requestOrgHygieneScore': {
          const data = await this.dataService.getHygieneScore(message.organizationId);
          this.postMessage({ type: 'orgHygieneScoreData', data });
          break;
        }

        // GITX-201: Velocity with team breakdown for stacked bar chart
        case 'requestOrgVelocityWithTeams': {
          const data = await this.dataService.getVelocityWithTeams({
            organizationId: message.organizationId,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'orgVelocityWithTeamsData', data });
          break;
        }

        // GITX-201: LOC by team for team-colored line chart
        case 'requestOrgLocByTeam': {
          const data = await this.dataService.getLocByTeam({
            organizationId: message.organizationId,
            timeframeDays: message.timeframeDays,
          });
          this.postMessage({ type: 'orgLocByTeamData', data });
          break;
        }

        case 'requestOrgHotSpots': {
          const data = await this.dataService.getHotSpots(message.organizationId);
          this.postMessage({ type: 'orgHotSpotsData', data });
          break;
        }

        case 'requestOrgKnowledgeConcentration': {
          const data = await this.dataService.getKnowledgeConcentration(message.organizationId);
          this.postMessage({ type: 'orgKnowledgeConcentrationData', data });
          break;
        }

        case 'requestOrgAllData': {
          // Request all data in parallel (matching TeamProfilePanel pattern)
          // GITX-201: Added velocityWithTeams and locByTeam for team-colored charts
          // GITX-210: Added dataCoverage for partial data coverage handling
          this.selectedOrganizationId = message.organizationId;
          this.selectedTimeframe = message.timeframeDays;
          const filters = {
            organizationId: message.organizationId,
            timeframeDays: message.timeframeDays,
          };
          const [summary, locPerWeek, complexFiles, frequentFiles, techStack, commentsPerWeek, testsPerWeek, hygieneScore, velocityWithTeams, locByTeam, hotSpots, knowledgeConcentration, dataCoverage] = await Promise.all([
            this.dataService.getSummary(filters),
            this.dataService.getLocPerWeek(filters),
            this.dataService.getTopComplexFilesByTeam(message.organizationId),
            this.dataService.getTopFrequentFilesByTeam(message.organizationId),
            this.dataService.getTechStack(filters),
            this.dataService.getCommentsPerWeek(filters),
            this.dataService.getTestsPerWeek(filters),
            this.dataService.getHygieneScore(message.organizationId),
            this.dataService.getVelocityWithTeams(filters),
            this.dataService.getLocByTeam(filters),
            this.dataService.getHotSpots(message.organizationId),
            this.dataService.getKnowledgeConcentration(message.organizationId),
            this.dataService.getDataCoverage(filters),
          ]);
          // Update panel title with organization name
          this.updatePanelTitle(summary.organizationName);
          // GITX-210: Send data coverage first so banner appears before charts
          this.postMessage({ type: 'orgDataCoverageData', data: dataCoverage });
          // Send all data to webview
          this.postMessage({ type: 'orgSummaryData', data: summary });
          this.postMessage({ type: 'orgLocPerWeekData', data: locPerWeek });
          // GITX-201: Send velocity with teams and LOC by team data
          this.postMessage({ type: 'orgVelocityWithTeamsData', data: velocityWithTeams });
          this.postMessage({ type: 'orgLocByTeamData', data: locByTeam });
          this.postMessage({ type: 'orgTopComplexFilesData', data: complexFiles });
          this.postMessage({ type: 'orgTopFrequentFilesData', data: frequentFiles });
          this.postMessage({ type: 'orgTechStackData', data: techStack });
          this.postMessage({ type: 'orgCommentsPerWeekData', data: commentsPerWeek });
          this.postMessage({ type: 'orgTestsPerWeekData', data: testsPerWeek });
          this.postMessage({ type: 'orgHygieneScoreData', data: hygieneScore });
          this.postMessage({ type: 'orgHotSpotsData', data: hotSpots });
          this.postMessage({ type: 'orgKnowledgeConcentrationData', data: knowledgeConcentration });
          break;
        }

        case 'requestOrgDataCoverage': {
          // GITX-210: Separate request for data coverage (for refresh without full data reload)
          const coverageFilters = {
            organizationId: message.organizationId,
            timeframeDays: message.timeframeDays,
          };
          const coverage = await this.dataService.getDataCoverage(coverageFilters);
          this.postMessage({ type: 'orgDataCoverageData', data: coverage });
          break;
        }

        case 'requestTeams': {
          const data = await this.dataService.getTeams();
          this.postMessage({ type: 'teamsData', data });
          break;
        }

        // CRUD Operations
        case 'createOrganization': {
          const created = await this.dataService.createOrganization({ name: message.name });
          this.postMessage({ type: 'organizationCreated', data: created });
          break;
        }

        case 'updateOrganization': {
          const updated = await this.dataService.updateOrganization(message.organizationId, { name: message.name });
          this.postMessage({ type: 'organizationUpdated', data: updated });
          break;
        }

        case 'deleteOrganization': {
          const success = await this.dataService.deleteOrganization(message.organizationId);
          this.postMessage({ type: 'organizationDeleted', organizationId: message.organizationId, success });
          break;
        }

        case 'assignTeamToOrganization': {
          const team = await this.dataService.assignTeamToOrganization(message.teamId, message.organizationId);
          this.postMessage({ type: 'teamAssigned', data: team });
          break;
        }

        case 'removeTeamFromOrganization': {
          const team = await this.dataService.removeTeamFromOrganization(message.teamId);
          this.postMessage({ type: 'teamRemoved', data: team });
          break;
        }

        default: {
          // Exhaustiveness check
          const _exhaustive: never = message;
          this.logger.warn(CLASS_NAME, 'handleMessage', `Unknown message type: ${(_exhaustive as OrgProfileWebviewToHost).type}`);
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
   * Lazily initializes the DatabaseService and OrganizationProfileDataService.
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

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for organization profile');

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

    this.dataService = new OrganizationProfileDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for organization profile');
  }

  /**
   * Post a typed message to the webview.
   *
   * @param message - The message to send to the webview
   */
  private postMessage(message: OrgProfileHostToWebview): void {
    this.logger.debug(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
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
   * GITX-197: Removes panel from active set instead of clearing singleton.
   */
  dispose(): void {
    // Prevent double disposal and set flag FIRST to stop new queries
    if (this.isDisposed) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Panel already disposed, skipping');
      return;
    }
    this.isDisposed = true;
    this.logger.info(CLASS_NAME, 'dispose', `Disposing OrganizationProfilePanel for: ${this.selectedOrganizationId ?? 'no organization'}`);

    // GITX-197: Remove from active panels set instead of clearing singleton
    OrganizationProfilePanel.activePanels.delete(this);
    this.logger.debug(CLASS_NAME, 'dispose', `Active panels remaining: ${OrganizationProfilePanel.activePanels.size}`);

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
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down organization profile database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'OrganizationProfilePanel disposed');
  }

  /**
   * Reset all panel tracking for testing purposes.
   * GITX-197: Clears the active panels set instead of singleton.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    OrganizationProfilePanel.activePanels.clear();
  }

  /**
   * Get the count of active panels.
   * GITX-197: Useful for testing and debugging multi-instance behavior.
   * @returns The number of currently active OrganizationProfilePanel instances
   */
  static getActivePanelCount(): number {
    return OrganizationProfilePanel.activePanels.size;
  }

  /**
   * Get the organization ID for this panel.
   * GITX-197: Useful for testing panel state.
   * @returns The selected organization ID or null
   */
  getOrganizationId(): number | null {
    return this.selectedOrganizationId;
  }

  /**
   * Get the timeframe for this panel.
   * GITX-197: Useful for testing panel state.
   * @returns The selected timeframe
   */
  getTimeframe(): OrgProfileTimeframe {
    return this.selectedTimeframe;
  }
}
