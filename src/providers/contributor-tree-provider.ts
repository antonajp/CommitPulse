import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import type {
  ContributorSummaryRow,
  ContributorTreeNodeData,
  ContributorViewMode,
} from './contributor-tree-types.js';
import { ContributorRepository } from '../database/contributor-repository.js';
import { DatabaseService, buildConfigFromSettings } from '../database/database-service.js';
import { SecretStorageService } from '../config/secret-storage.js';
import { getSettings } from '../config/settings.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ContributorTreeProvider';

/**
 * Label used for contributors with no team assignment.
 */
const UNASSIGNED_TEAM_LABEL = '(Unassigned)';

/**
 * ThemeIcon identifiers used for tree nodes.
 * Using built-in VS Code codicons for consistent theming.
 */
const ICONS = {
  team: new vscode.ThemeIcon('organization'),
  contributor: new vscode.ThemeIcon('person'),
  contributorCompany: new vscode.ThemeIcon('shield'),
  detail: new vscode.ThemeIcon('info'),
  commits: new vscode.ThemeIcon('git-commit'),
  vendor: new vscode.ThemeIcon('briefcase'),
  repos: new vscode.ThemeIcon('repo'),
  name: new vscode.ThemeIcon('account'),
  warning: new vscode.ThemeIcon('warning'),
  info: new vscode.ThemeIcon('info'),
  listFlat: new vscode.ThemeIcon('list-flat'),
  listTree: new vscode.ThemeIcon('list-tree'),
} as const;

/**
 * ContributorTreeItem extends vscode.TreeItem with typed node data.
 * Each item carries a ContributorTreeNodeData payload for context menu
 * discrimination and child resolution.
 */
export class ContributorTreeItem extends vscode.TreeItem {
  public readonly nodeData: ContributorTreeNodeData;

  constructor(
    nodeData: ContributorTreeNodeData,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(nodeData.label, collapsibleState);
    this.nodeData = nodeData;
    this.contextValue = nodeData.type;
    if (nodeData.description !== undefined) {
      this.description = nodeData.description;
    }
    if (nodeData.tooltip !== undefined) {
      this.tooltip = nodeData.tooltip;
    }
  }
}

/**
 * ContributorTreeProvider implements vscode.TreeDataProvider<ContributorTreeItem>
 * for the gitrx-contributors TreeView. Displays contributors organized by team
 * or as a flat alphabetical list.
 *
 * Root nodes (grouped mode): each unique team from max_num_count_per_login.
 * Child nodes per team: contributors belonging to that team.
 * Contributor details: login, full_name, vendor, commit count, repo list.
 *
 * Root nodes (flat mode): all contributors listed alphabetically.
 *
 * Data sourced from commit_contributors + gitja_team_contributor +
 * max_num_count_per_login via ContributorRepository.getContributorSummaries().
 *
 * Ticket: IQS-867
 */
export class ContributorTreeProvider
  implements vscode.TreeDataProvider<ContributorTreeItem>, vscode.Disposable
{
  private readonly logger: LoggerService;

  /**
   * Event emitter that fires when the tree data changes.
   * Subscribers (the TreeView) will re-fetch data when this fires.
   */
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<ContributorTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ContributorTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  /**
   * Cached contributor summaries, loaded from database.
   */
  private contributorCache: ContributorSummaryRow[] = [];

  /**
   * Whether data has been loaded at least once.
   */
  private dataLoaded = false;

  /**
   * Current display mode: 'grouped' (by team) or 'flat' (alphabetical).
   */
  private viewMode: ContributorViewMode = 'grouped';

  /**
   * Reference to SecretStorageService for database password retrieval.
   */
  private readonly secretService: SecretStorageService;

  constructor(secretService: SecretStorageService) {
    this.logger = LoggerService.getInstance();
    this.secretService = secretService;
    this.logger.debug(CLASS_NAME, 'constructor', 'ContributorTreeProvider created');
  }

  /**
   * Signal the TreeView to refresh its contents.
   * Clears the contributor cache so the next getChildren() call re-queries the database.
   */
  refresh(): void {
    this.logger.info(CLASS_NAME, 'refresh', 'Refreshing Contributors TreeView');
    this.contributorCache = [];
    this.dataLoaded = false;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Toggle between grouped (by team) and flat display modes.
   * Fires a tree data change event to rebuild the entire tree.
   *
   * @returns The new view mode label for display in notifications
   */
  toggleViewMode(): string {
    this.viewMode = this.viewMode === 'grouped' ? 'flat' : 'grouped';
    const modeLabel = this.viewMode === 'grouped' ? 'Group by Team' : 'Flat List';
    this.logger.info(CLASS_NAME, 'toggleViewMode', `View mode toggled to: ${modeLabel}`);
    this._onDidChangeTreeData.fire();
    return modeLabel;
  }

  /**
   * Get the current view mode.
   */
  getViewMode(): ContributorViewMode {
    return this.viewMode;
  }

  /**
   * Get the TreeItem representation for a given element.
   * Required by vscode.TreeDataProvider.
   */
  getTreeItem(element: ContributorTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get child elements for a given parent, or root elements if parent is undefined.
   * Required by vscode.TreeDataProvider.
   *
   * @param element - The parent element, or undefined for root nodes
   * @returns Array of child ContributorTreeItem nodes
   */
  async getChildren(element?: ContributorTreeItem): Promise<ContributorTreeItem[]> {
    this.logger.debug(
      CLASS_NAME,
      'getChildren',
      element
        ? `Getting children for: ${element.nodeData.type}/${element.nodeData.label}`
        : 'Getting root nodes',
    );

    // Ensure data is loaded
    if (!this.dataLoaded) {
      await this.loadContributors();
    }

    if (!element) {
      return this.getRootNodes();
    }

    if (element.nodeData.type === 'team') {
      return this.getTeamChildNodes(element.nodeData.teamName ?? UNASSIGNED_TEAM_LABEL);
    }

    if (element.nodeData.type === 'contributor') {
      return this.getContributorDetailNodes(element.nodeData.contributorLogin ?? '');
    }

    // Leaf nodes (detail, empty) have no children
    return [];
  }

  // --------------------------------------------------------------------------
  // Root node builders
  // --------------------------------------------------------------------------

  /**
   * Build root-level tree nodes based on the current view mode.
   */
  private getRootNodes(): ContributorTreeItem[] {
    if (this.contributorCache.length === 0) {
      this.logger.info(CLASS_NAME, 'getRootNodes', 'No contributor data available');
      return [this.buildEmptyNode()];
    }

    if (this.viewMode === 'grouped') {
      return this.getGroupedRootNodes();
    }
    return this.getFlatRootNodes();
  }

  /**
   * Build root nodes in grouped mode: one collapsible node per team.
   * Teams are sorted alphabetically with unassigned at the end.
   */
  private getGroupedRootNodes(): ContributorTreeItem[] {
    this.logger.debug(CLASS_NAME, 'getGroupedRootNodes', 'Building grouped root nodes');

    // Group contributors by team
    const teamMap = new Map<string, ContributorSummaryRow[]>();
    for (const contributor of this.contributorCache) {
      const teamKey = contributor.team ?? UNASSIGNED_TEAM_LABEL;
      const existing = teamMap.get(teamKey);
      if (existing) {
        existing.push(contributor);
      } else {
        teamMap.set(teamKey, [contributor]);
      }
    }

    // Sort team names: assigned teams alphabetically, unassigned last
    const teamNames = Array.from(teamMap.keys()).sort((a, b) => {
      if (a === UNASSIGNED_TEAM_LABEL) { return 1; }
      if (b === UNASSIGNED_TEAM_LABEL) { return -1; }
      return a.localeCompare(b);
    });

    const rootNodes: ContributorTreeItem[] = [];
    for (const teamName of teamNames) {
      const members = teamMap.get(teamName) ?? [];
      const totalCommits = members.reduce((sum, c) => sum + c.commitCount, 0);

      const node = new ContributorTreeItem(
        {
          type: 'team',
          label: teamName,
          description: `${members.length} contributors, ${totalCommits.toLocaleString()} commits`,
          tooltip: `Team: ${teamName}\nContributors: ${members.length}\nTotal Commits: ${totalCommits.toLocaleString()}`,
          teamName,
        },
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      node.iconPath = ICONS.team;
      rootNodes.push(node);
    }

    this.logger.debug(CLASS_NAME, 'getGroupedRootNodes', `Built ${rootNodes.length} team nodes`);
    return rootNodes;
  }

  /**
   * Build root nodes in flat mode: one collapsible node per contributor.
   * Contributors are sorted alphabetically by login.
   */
  private getFlatRootNodes(): ContributorTreeItem[] {
    this.logger.debug(CLASS_NAME, 'getFlatRootNodes', 'Building flat root nodes');

    const sorted = [...this.contributorCache].sort((a, b) => a.login.localeCompare(b.login));
    const rootNodes: ContributorTreeItem[] = [];

    for (const contributor of sorted) {
      rootNodes.push(this.buildContributorNode(contributor));
    }

    this.logger.debug(CLASS_NAME, 'getFlatRootNodes', `Built ${rootNodes.length} contributor nodes`);
    return rootNodes;
  }

  // --------------------------------------------------------------------------
  // Child node builders
  // --------------------------------------------------------------------------

  /**
   * Build child nodes for a team: one collapsible node per contributor in that team.
   * Contributors are sorted by commit count descending, then by login.
   */
  private getTeamChildNodes(teamName: string): ContributorTreeItem[] {
    const targetTeam = teamName === UNASSIGNED_TEAM_LABEL ? null : teamName;
    const members = this.contributorCache
      .filter((c) =>
        targetTeam === null ? c.team === null : c.team === targetTeam,
      )
      .sort((a, b) => {
        // Sort by commit count desc, then login asc
        if (b.commitCount !== a.commitCount) {
          return b.commitCount - a.commitCount;
        }
        return a.login.localeCompare(b.login);
      });

    this.logger.debug(
      CLASS_NAME,
      'getTeamChildNodes',
      `Building ${members.length} contributor nodes for team: ${teamName}`,
    );

    return members.map((contributor) => this.buildContributorNode(contributor));
  }

  /**
   * Build detail leaf nodes for a contributor: name, vendor, commits, repos.
   */
  private getContributorDetailNodes(login: string): ContributorTreeItem[] {
    const contributor = this.contributorCache.find((c) => c.login === login);
    if (!contributor) {
      this.logger.warn(CLASS_NAME, 'getContributorDetailNodes', `Contributor not found: ${login}`);
      return [];
    }

    this.logger.debug(
      CLASS_NAME,
      'getContributorDetailNodes',
      `Building detail nodes for: ${login}`,
    );

    const details: ContributorTreeItem[] = [];

    // Full Name
    if (contributor.fullName) {
      const nameNode = new ContributorTreeItem(
        {
          type: 'detail',
          label: 'Name',
          description: contributor.fullName,
          tooltip: `Full Name: ${contributor.fullName}`,
          contributorLogin: login,
        },
        vscode.TreeItemCollapsibleState.None,
      );
      nameNode.iconPath = ICONS.name;
      details.push(nameNode);
    }

    // Vendor
    const vendorLabel = contributor.vendor ?? 'Unknown';
    const vendorNode = new ContributorTreeItem(
      {
        type: 'detail',
        label: 'Vendor',
        description: vendorLabel,
        tooltip: `Vendor: ${vendorLabel}`,
        contributorLogin: login,
      },
      vscode.TreeItemCollapsibleState.None,
    );
    vendorNode.iconPath = ICONS.vendor;
    details.push(vendorNode);

    // Commit Count
    const commitsNode = new ContributorTreeItem(
      {
        type: 'detail',
        label: 'Commits',
        description: contributor.commitCount.toLocaleString(),
        tooltip: `Total Commits: ${contributor.commitCount.toLocaleString()}`,
        contributorLogin: login,
      },
      vscode.TreeItemCollapsibleState.None,
    );
    commitsNode.iconPath = ICONS.commits;
    details.push(commitsNode);

    // Repositories
    if (contributor.repoList) {
      const repos = contributor.repoList
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      const repoNode = new ContributorTreeItem(
        {
          type: 'detail',
          label: 'Repositories',
          description: repos.length === 1 ? repos[0]! : `${repos.length} repos`,
          tooltip: `Repositories:\n${repos.map((r) => `  - ${r}`).join('\n')}`,
          contributorLogin: login,
        },
        vscode.TreeItemCollapsibleState.None,
      );
      repoNode.iconPath = ICONS.repos;
      details.push(repoNode);
    }

    return details;
  }

  // --------------------------------------------------------------------------
  // Helper builders
  // --------------------------------------------------------------------------

  /**
   * Build a contributor tree node with commit count description and icon.
   */
  private buildContributorNode(contributor: ContributorSummaryRow): ContributorTreeItem {
    const displayName = contributor.fullName
      ? `${contributor.login} (${contributor.fullName})`
      : contributor.login;

    const vendorTag = contributor.vendor ? ` [${contributor.vendor}]` : '';
    const description = `${contributor.commitCount.toLocaleString()} commits${vendorTag}`;

    const tooltipParts = [
      `Login: ${contributor.login}`,
      contributor.fullName ? `Name: ${contributor.fullName}` : null,
      contributor.vendor ? `Vendor: ${contributor.vendor}` : null,
      contributor.team ? `Team: ${contributor.team}` : null,
      `Commits: ${contributor.commitCount.toLocaleString()}`,
      contributor.repoList ? `Repos: ${contributor.repoList}` : null,
    ].filter(Boolean);

    const node = new ContributorTreeItem(
      {
        type: 'contributor',
        label: displayName,
        description,
        tooltip: tooltipParts.join('\n'),
        teamName: contributor.team ?? undefined,
        contributorLogin: contributor.login,
        contributorData: contributor,
      },
      vscode.TreeItemCollapsibleState.Collapsed,
    );

    // Use shield icon for Company (internal) contributors
    const isCompany = contributor.vendor?.toLowerCase() === 'company';
    node.iconPath = isCompany ? ICONS.contributorCompany : ICONS.contributor;

    // Set command for click-to-show-detail
    node.command = {
      command: 'gitrx.showContributorDetail',
      title: 'Show Contributor Details',
      arguments: [contributor],
    };

    return node;
  }

  /**
   * Build an empty placeholder node when no data is available.
   */
  private buildEmptyNode(): ContributorTreeItem {
    const node = new ContributorTreeItem(
      {
        type: 'empty',
        label: 'No contributor data',
        description: 'Run pipeline to populate',
        tooltip: 'Run "Gitr: Run Pipeline" to load contributor data from your repositories.',
      },
      vscode.TreeItemCollapsibleState.None,
    );
    node.iconPath = ICONS.info;
    return node;
  }

  // --------------------------------------------------------------------------
  // Data loading
  // --------------------------------------------------------------------------

  /**
   * Load contributor summaries from the database into the cache.
   * Attempts a database connection using current settings. If the database
   * is not available, logs a warning and continues with empty data.
   */
  private async loadContributors(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'loadContributors', 'Loading contributor data from database');

    let dbService: DatabaseService | undefined;

    try {
      const settings = getSettings();

      // Get database password from SecretStorage
      const dbPassword = await this.secretService.getDatabasePassword();
      if (!dbPassword) {
        this.logger.warn(
          CLASS_NAME,
          'loadContributors',
          'Database password not configured. Contributors TreeView will be empty.',
        );
        this.dataLoaded = true;
        return;
      }

      // Initialize a short-lived database connection for the query
      dbService = new DatabaseService();
      const dbConfig = buildConfigFromSettings(settings.database, dbPassword);

      this.logger.debug(
        CLASS_NAME,
        'loadContributors',
        `Connecting to database: ${settings.database.host}:${settings.database.port}`,
      );
      await dbService.initialize(dbConfig);

      const contributorRepo = new ContributorRepository(dbService);
      this.contributorCache = await contributorRepo.getContributorSummaries();

      this.logger.info(
        CLASS_NAME,
        'loadContributors',
        `Loaded ${this.contributorCache.length} contributor summaries`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        CLASS_NAME,
        'loadContributors',
        `Failed to load contributors from database: ${message}. TreeView will be empty.`,
      );
      this.contributorCache = [];
    } finally {
      // Always shut down the short-lived connection
      if (dbService) {
        try {
          await dbService.shutdown();
          this.logger.debug(CLASS_NAME, 'loadContributors', 'Short-lived database connection shut down');
        } catch (shutdownError: unknown) {
          const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
          this.logger.warn(CLASS_NAME, 'loadContributors', `Database shutdown warning: ${msg}`);
        }
      }
      this.dataLoaded = true;
    }
  }

  /**
   * Dispose resources held by this provider.
   */
  dispose(): void {
    this.logger.debug(CLASS_NAME, 'dispose', 'Disposing ContributorTreeProvider');
    this._onDidChangeTreeData.dispose();
    this.contributorCache = [];
  }
}
