/**
 * Ticket Lifecycle Sankey dashboard webview panel manager.
 * Creates and manages a VS Code WebviewPanel with:
 * - Singleton pattern (only one panel at a time)
 * - Interactive Sankey diagram: nodes = statuses, links = transitions
 * - Drill-down on link click to see individual tickets
 * - Click ticket to open in Jira/Linear browser
 * - Rework toggle and date range filters
 * - CSP nonce-based script authorization
 * - D3.js v7 bundled with SHA-256 integrity verification
 * - Proper disposal and resource cleanup
 *
 * Ticket: IQS-906
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, buildConfigFromSettings } from '../../database/database-service.js';
import { TicketLifecycleDataService } from '../../services/ticket-lifecycle-service.js';
import { generateLifecycleHtml } from './lifecycle-html.js';
import { getSettings } from '../../config/settings.js';
import { validateExternalUrl } from '../../utils/url-validator.js';
import { buildIssueUrl } from '../../utils/url-builder.js';
import { handleSharedMessage } from './shared-message-handlers.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { LifecycleWebviewToHost, LifecycleHostToWebview } from './lifecycle-protocol.js';
import type { LifecycleFilters, TicketTransition } from '../../services/ticket-lifecycle-types.js';

/**
 * Extended message type for click actions from webview.
 * Ticket: IQS-926
 */
interface OpenTicketMessage {
  readonly type: 'openTicket';
  readonly ticketId: string;
  readonly ticketType: string;
  readonly jiraUrlPrefix: string;
  readonly linearUrlPrefix: string;
}

type LifecycleClickMessage = OpenTicketMessage;

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'LifecyclePanel';

/**
 * View type identifier for the ticket lifecycle webview.
 */
const VIEW_TYPE = 'gitrx.lifecyclePanel';

/**
 * Expected SHA-256 hash of the bundled D3.js v7 library.
 * Used for integrity verification per IQS-880 security pattern.
 */
const D3_EXPECTED_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';

/**
 * Rate limiting configuration for external URL opens.
 * Prevents rapid-fire URL opens which could indicate malicious behavior.
 * Ticket: IQS-926
 */
const RATE_LIMIT_WINDOW_MS = 60000; // 60 seconds
const RATE_LIMIT_MAX_URLS = 5; // Max 5 URLs per window

/**
 * Manages the Ticket Lifecycle WebviewPanel lifecycle.
 * Implements singleton pattern: only one panel exists at a time.
 * Re-reveals existing panel if user triggers the command again.
 *
 * Ticket: IQS-906
 */
export class LifecyclePanel implements vscode.Disposable {
  /**
   * Singleton panel instance. Null when no panel is open.
   */
  private static currentPanel: LifecyclePanel | undefined;

  private readonly logger: LoggerService;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly secretService: SecretStorageService;
  private readonly disposables: vscode.Disposable[] = [];
  private db: DatabaseService | undefined;
  private dataService: TicketLifecycleDataService | undefined;

  /**
   * Timestamps of recent URL opens for rate limiting.
   * Filtered to retain only timestamps within the rate limit window.
   * Ticket: IQS-926
   */
  private urlOpenTimestamps: number[] = [];

  /**
   * Create or reveal the Ticket Lifecycle panel.
   * Verifies D3.js bundle integrity before creating the panel.
   *
   * @param extensionUri - The URI of the extension's root directory
   * @param secretService - SecretStorageService for database password retrieval
   */
  static createOrShow(extensionUri: vscode.Uri, secretService: SecretStorageService): void {
    const logger = LoggerService.getInstance();
    logger.info(CLASS_NAME, 'createOrShow', 'Opening Ticket Lifecycle panel');

    // If panel exists, reveal it
    if (LifecyclePanel.currentPanel) {
      logger.debug(CLASS_NAME, 'createOrShow', 'Existing panel found, revealing');
      LifecyclePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Verify D3.js bundle integrity (IQS-880 security pattern)
    const d3Path = vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js').fsPath;
    if (!LifecyclePanel.verifyD3Integrity(d3Path, logger)) {
      void vscode.window.showErrorMessage(
        'Gitr: D3.js bundle integrity check failed. The file may be corrupted or tampered with.',
      );
      return;
    }

    // Create a new panel
    logger.debug(CLASS_NAME, 'createOrShow', 'Creating new ticket lifecycle webview panel');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Gitr: Ticket Lifecycle',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    );

    LifecyclePanel.currentPanel = new LifecyclePanel(panel, extensionUri, secretService);
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

    this.logger.debug(CLASS_NAME, 'constructor', 'Initializing LifecyclePanel');

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
      (message: LifecycleWebviewToHost | LifecycleClickMessage) => {
        this.logger.trace(CLASS_NAME, 'onDidReceiveMessage', `Received message: type=${message.type}`);
        // Handle shared message types (exportCsv) - GITX-127
        if (message.type === 'exportCsv') {
          void handleSharedMessage(
            message as { type: string },
            this.panel.webview,
            this.logger,
            CLASS_NAME,
          );
          return;
        }
        // Handle click actions (non-data messages)
        if (message.type === 'openTicket') {
          void this.handleOpenTicket(message);
          return;
        }
        // Handle data messages
        void this.handleMessage(message as LifecycleWebviewToHost);
      },
      null,
      this.disposables,
    );

    this.logger.info(CLASS_NAME, 'constructor', 'LifecyclePanel initialized successfully');
  }

  /**
   * Generate and set the webview HTML content with CSP nonce and local resource URIs.
   */
  private updateWebviewContent(): void {
    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Generating ticket lifecycle webview HTML');

    const webview = this.panel.webview;
    const nonce = this.generateNonce();

    // Resolve local resource URIs
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'd3.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'lifecycle.css'),
    );

    // Get settings for issue tracker URL prefixes (IQS-926)
    const settings = getSettings();
    const jiraUrlPrefix = settings.jira?.urlPrefix || settings.jira?.server || '';
    const linearUrlPrefix = settings.linear?.urlPrefix || '';

    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `D3.js URI: ${d3Uri.toString()}`);
    this.logger.trace(CLASS_NAME, 'updateWebviewContent', `Style URI: ${styleUri.toString()}`);

    webview.html = generateLifecycleHtml({
      nonce,
      d3Uri,
      styleUri,
      cspSource: webview.cspSource,
      jiraUrlPrefix,
      linearUrlPrefix,
    });

    this.logger.debug(CLASS_NAME, 'updateWebviewContent', 'Ticket lifecycle webview HTML set');
  }

  /**
   * Handle incoming messages from the webview.
   */
  private async handleMessage(message: LifecycleWebviewToHost): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleMessage', `Handling message: ${message.type}`);

    try {
      switch (message.type) {
        case 'requestSankeyData': {
          await this.handleRequestSankeyData(message.filters);
          break;
        }

        case 'requestTransitionsData': {
          await this.handleRequestTransitionsData(message.filters);
          break;
        }

        case 'requestMatrixData': {
          await this.handleRequestMatrixData(message.filters);
          break;
        }

        case 'requestLifecycleRefresh': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Refresh requested');
          await this.handleRequestSankeyData(message.filters);
          break;
        }

        case 'requestFilterUpdate': {
          this.logger.debug(CLASS_NAME, 'handleMessage', 'Filter update requested');
          await this.handleRequestSankeyData(message.filters);
          break;
        }

        case 'requestDrillDown': {
          await this.handleRequestDrillDown(message);
          break;
        }

        // Shared message types handled by handleSharedMessage before switch
        case 'exportCsv':
        case 'openExternal':
          break;

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
   * Handle request for Sankey chart data.
   */
  private async handleRequestSankeyData(filters?: LifecycleFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestSankeyData', 'Processing requestSankeyData');

    // Send loading state
    this.postMessage({ type: 'lifecycleLoading', isLoading: true });

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestSankeyData', 'Data service not available after DB init');
      this.postError('Data service unavailable', 'requestSankeyData');
      return;
    }

    const chartData = await this.dataService.getChartData(filters ?? {});

    // Also send filter options for the dropdowns
    await this.sendFilterOptions(filters);

    this.postMessage({
      type: 'sankeyData',
      sankey: chartData.sankey,
      hasData: chartData.hasData,
      viewExists: chartData.viewExists,
    });

    this.postMessage({ type: 'lifecycleLoading', isLoading: false });
  }

  /**
   * Handle request for individual transition data.
   */
  private async handleRequestTransitionsData(filters?: LifecycleFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestTransitionsData', 'Processing requestTransitionsData');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestTransitionsData', 'Data service not available');
      this.postError('Data service unavailable', 'requestTransitionsData');
      return;
    }

    const chartData = await this.dataService.getTransitionsChartData(filters ?? {});

    this.postMessage({
      type: 'transitionsData',
      transitions: chartData.transitions,
      hasData: chartData.hasData,
      viewExists: chartData.viewExists,
    });
  }

  /**
   * Handle request for transition matrix data.
   */
  private async handleRequestMatrixData(filters?: LifecycleFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestMatrixData', 'Processing requestMatrixData');

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestMatrixData', 'Data service not available');
      this.postError('Data service unavailable', 'requestMatrixData');
      return;
    }

    const chartData = await this.dataService.getMatrixChartData(filters ?? {});

    this.postMessage({
      type: 'matrixData',
      matrix: chartData.matrix,
      hasData: chartData.hasData,
      viewExists: chartData.viewExists,
    });
  }

  /**
   * Handle drill-down requests for specific status or transition.
   */
  private async handleRequestDrillDown(message: {
    type: 'requestDrillDown';
    drillDownType: 'status' | 'transition';
    status?: string;
    fromStatus?: string;
    toStatus?: string;
    filters?: LifecycleFilters;
  }): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleRequestDrillDown',
      `Drill-down: type=${message.drillDownType}, status=${message.status}, from=${message.fromStatus}, to=${message.toStatus}`);

    await this.ensureDbConnection();

    if (!this.dataService) {
      this.logger.error(CLASS_NAME, 'handleRequestDrillDown', 'Data service not available');
      this.postError('Data service unavailable', 'requestDrillDown');
      return;
    }

    if (message.drillDownType === 'status' && message.status) {
      // Get transitions for a specific status
      const chartData = await this.dataService.getMatrixChartData(message.filters ?? {});

      const incoming = chartData.matrix.filter(m => m.toStatus === message.status);
      const outgoing = chartData.matrix.filter(m => m.fromStatus === message.status);

      // Calculate summary statistics
      const totalIncoming = incoming.reduce((sum, m) => sum + m.transitionCount, 0);
      const totalOutgoing = outgoing.reduce((sum, m) => sum + m.transitionCount, 0);
      const avgDwellHours = incoming.length > 0
        ? incoming.reduce((sum, m) => sum + (m.avgDwellHours ?? 0), 0) / incoming.length
        : 0;

      // Determine category from the matrix entries
      const category = incoming[0]?.toCategory ?? outgoing[0]?.fromCategory ?? 'unknown';

      this.postMessage({
        type: 'statusDrillDown',
        status: message.status,
        category,
        incomingTransitions: incoming,
        outgoingTransitions: outgoing,
        avgDwellHours,
        ticketCount: Math.max(totalIncoming, totalOutgoing),
      });
    } else if (message.drillDownType === 'transition' && message.fromStatus && message.toStatus) {
      // Get individual tickets for a specific transition path
      const transitionsData = await this.dataService.getTransitionsChartData(message.filters ?? {});

      const tickets: TicketTransition[] = transitionsData.transitions.filter(
        t => t.fromStatus === message.fromStatus && t.toStatus === message.toStatus
      ) as TicketTransition[];

      // Determine if this is a rework transition
      const matrixData = await this.dataService.getMatrixChartData(message.filters ?? {});
      const matrixEntry = matrixData.matrix.find(
        m => m.fromStatus === message.fromStatus && m.toStatus === message.toStatus
      );
      const isRework = matrixEntry ? matrixEntry.reworkCount > 0 : false;

      this.postMessage({
        type: 'transitionDrillDown',
        fromStatus: message.fromStatus,
        toStatus: message.toStatus,
        tickets,
        isRework,
      });
    } else {
      this.logger.warn(CLASS_NAME, 'handleRequestDrillDown', 'Invalid drill-down request');
      this.postError('Invalid drill-down parameters', 'requestDrillDown');
    }
  }

  /**
   * Send available filter options to the webview.
   */
  private async sendFilterOptions(filters?: LifecycleFilters): Promise<void> {
    this.logger.debug(CLASS_NAME, 'sendFilterOptions', 'Fetching filter options');

    if (!this.dataService) {
      return;
    }

    // Get all transitions to extract unique values for filters
    const transitionsData = await this.dataService.getTransitionsChartData(filters ?? {});

    const ticketTypes = [...new Set(transitionsData.transitions.map(t => t.ticketType))];
    const issueTypes = [...new Set(transitionsData.transitions.map(t => t.issueType).filter(Boolean))];
    const assignees = [...new Set(transitionsData.transitions.map(t => t.assignee).filter(Boolean) as string[])];
    const statuses = [...new Set([
      ...transitionsData.transitions.map(t => t.fromStatus),
      ...transitionsData.transitions.map(t => t.toStatus),
    ])];

    this.postMessage({
      type: 'filterOptions',
      ticketTypes,
      issueTypes: issueTypes.sort(),
      assignees: assignees.sort(),
      statuses: statuses.sort(),
    });
  }

  /**
   * Ensure a database connection is available for queries.
   * Lazily initializes the DatabaseService and TicketLifecycleDataService.
   */
  private async ensureDbConnection(): Promise<void> {
    if (this.dataService) {
      this.logger.trace(CLASS_NAME, 'ensureDbConnection', 'Data service already available');
      return;
    }

    this.logger.debug(CLASS_NAME, 'ensureDbConnection', 'Initializing database connection for ticket lifecycle');

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

    this.dataService = new TicketLifecycleDataService(this.db);
    this.logger.info(CLASS_NAME, 'ensureDbConnection', 'Database connection established for ticket lifecycle');
  }

  /**
   * Post a typed message to the webview.
   */
  private postMessage(message: LifecycleHostToWebview): void {
    this.logger.trace(CLASS_NAME, 'postMessage', `Posting message: type=${message.type}`);
    void this.panel.webview.postMessage(message);
  }

  /**
   * Post an error message to the webview.
   */
  private postError(errorMessage: string, source: string): void {
    this.postMessage({
      type: 'lifecycleError',
      message: errorMessage,
      source,
    });
  }

  /**
   * Handle opening a ticket URL using the secure URL builder utility.
   *
   * Security hardening (IQS-926):
   * - Uses centralized URL builder with input validation
   * - Validates issue key format (prevents XSS/injection)
   * - Validates URL prefix scheme (http/https only)
   * - Rate limiting applied via handleOpenExternal
   *
   * @param message - The openTicket message with ticket details
   */
  private async handleOpenTicket(message: OpenTicketMessage): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleOpenTicket', `Building URL for: ${message.ticketId} (${message.ticketType})`);

    const settings = getSettings();
    const jiraServer = settings.jira?.server ?? '';

    // Use URL builder utility for secure URL construction
    const result = buildIssueUrl(
      message.ticketType,
      message.ticketId,
      message.jiraUrlPrefix,
      jiraServer,
      message.linearUrlPrefix,
    );

    if (!result.success) {
      this.logger.warn(CLASS_NAME, 'handleOpenTicket', `URL build failed: ${result.reason}`);
      if (result.notConfigured) {
        void vscode.window.showInformationMessage(
          `Gitr: ${result.reason}. Configure the URL prefix in settings.`,
        );
      } else {
        void vscode.window.showWarningMessage(`Gitr: Could not open ticket - ${result.reason}`);
      }
      return;
    }

    // Delegate to handleOpenExternal for rate limiting and final validation
    await this.handleOpenExternal(result.url!);
  }

  /**
   * Handle opening an external URL in the default browser.
   *
   * Security hardening (IQS-926):
   * - Rate limiting: max 5 URLs per 60 seconds
   * - Domain allowlist validation
   * - Rejects non-http/https schemes
   *
   * @param url - The URL to open
   */
  private async handleOpenExternal(url: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'handleOpenExternal', `Attempting to open external URL: ${url}`);

    // Rate limiting check (IQS-926)
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
   * Generate a cryptographic nonce for CSP script authorization.
   */
  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Dispose the panel and all its resources.
   */
  dispose(): void {
    this.logger.info(CLASS_NAME, 'dispose', 'Disposing LifecyclePanel');

    LifecyclePanel.currentPanel = undefined;

    if (this.db) {
      this.logger.debug(CLASS_NAME, 'dispose', 'Shutting down ticket lifecycle database connection');
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

    this.logger.debug(CLASS_NAME, 'dispose', 'LifecyclePanel disposed');
  }

  /**
   * Reset the singleton for testing purposes.
   * @internal - Only use in test code
   */
  static resetForTesting(): void {
    LifecyclePanel.currentPanel = undefined;
  }
}
