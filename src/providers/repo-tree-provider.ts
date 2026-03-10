import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import { getSettings } from '../config/settings.js';
import type { RepositoryEntry } from '../config/settings.js';
import type { RepoStats, RepoTreeNodeData } from './repo-tree-types.js';
import { RepoStatsRepository } from '../database/repo-stats-repository.js';
import { DatabaseService, buildConfigFromSettings } from '../database/database-service.js';
import { SecretStorageService } from '../config/secret-storage.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'RepoTreeProvider';

/**
 * ThemeIcon identifiers used for tree nodes.
 * Using built-in VS Code codicons for consistent theming.
 */
const ICONS = {
  repo: new vscode.ThemeIcon('repo'),
  calendar: new vscode.ThemeIcon('calendar'),
  gitCommit: new vscode.ThemeIcon('git-commit'),
  person: new vscode.ThemeIcon('person'),
  gitBranch: new vscode.ThemeIcon('git-branch'),
  warning: new vscode.ThemeIcon('warning'),
  info: new vscode.ThemeIcon('info'),
} as const;

/**
 * RepoTreeItem extends vscode.TreeItem with typed node data.
 * Each item carries a RepoTreeNodeData payload for context menu
 * discrimination and child resolution.
 */
export class RepoTreeItem extends vscode.TreeItem {
  public readonly nodeData: RepoTreeNodeData;

  constructor(
    nodeData: RepoTreeNodeData,
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
 * RepoTreeProvider implements vscode.TreeDataProvider<RepoTreeItem> for the
 * gitrx-repos TreeView. Displays configured repositories with their
 * last sync date, total commits, unique contributors, and branch count.
 *
 * Root nodes: each configured repository from gitrx.repositories setting.
 * Child nodes: Last Sync Date, Total Commits, Unique Contributors, Branches.
 *
 * Data is fetched from the database (commit_history, commit_branch_relationship)
 * via RepoStatsRepository. If the database is unreachable, the tree gracefully
 * shows the configured repositories with a "No data available" message.
 *
 * Ticket: IQS-866
 */
export class RepoTreeProvider implements vscode.TreeDataProvider<RepoTreeItem>, vscode.Disposable {
  private readonly logger: LoggerService;

  /**
   * Event emitter that fires when the tree data changes.
   * Subscribers (the TreeView) will re-fetch data when this fires.
   */
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<RepoTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<RepoTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  /**
   * Cached repository statistics, keyed by repository name.
   * Populated on first getChildren() call and refreshed via refresh().
   */
  private statsCache: Map<string, RepoStats> = new Map();

  /**
   * Whether stats have been loaded at least once.
   */
  private statsLoaded = false;

  /**
   * Reference to SecretStorageService for database password retrieval.
   */
  private readonly secretService: SecretStorageService;

  constructor(secretService: SecretStorageService) {
    this.logger = LoggerService.getInstance();
    this.secretService = secretService;
    this.logger.debug(CLASS_NAME, 'constructor', 'RepoTreeProvider created');
  }

  /**
   * Signal the TreeView to refresh its contents.
   * Clears the stats cache so the next getChildren() call re-queries the database.
   */
  refresh(): void {
    this.logger.info(CLASS_NAME, 'refresh', 'Refreshing Repos TreeView');
    this.statsCache.clear();
    this.statsLoaded = false;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get the TreeItem representation for a given element.
   * Required by vscode.TreeDataProvider.
   */
  getTreeItem(element: RepoTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get child elements for a given parent, or root elements if parent is undefined.
   * Required by vscode.TreeDataProvider.
   *
   * @param element - The parent element, or undefined for root nodes
   * @returns Array of child RepoTreeItem nodes
   */
  async getChildren(element?: RepoTreeItem): Promise<RepoTreeItem[]> {
    this.logger.debug(
      CLASS_NAME,
      'getChildren',
      element ? `Getting children for: ${element.nodeData.repository}` : 'Getting root nodes',
    );

    if (!element) {
      return this.getRootNodes();
    }

    if (element.nodeData.type === 'repository') {
      return this.getRepoChildNodes(element.nodeData.repository);
    }

    // Leaf nodes have no children
    return [];
  }

  /**
   * Build root-level tree nodes from configured repositories.
   * Each configured repository becomes a collapsible root node.
   * If no repositories are configured, shows a placeholder message.
   */
  private async getRootNodes(): Promise<RepoTreeItem[]> {
    const settings = getSettings();
    const repositories = settings.repositories;

    this.logger.debug(CLASS_NAME, 'getRootNodes', `Found ${repositories.length} configured repositories`);

    if (repositories.length === 0) {
      this.logger.info(CLASS_NAME, 'getRootNodes', 'No repositories configured');
      const emptyNode = new RepoTreeItem(
        {
          type: 'repository',
          repository: '',
          label: 'No repositories configured',
          description: 'Configure gitrx.repositories in settings',
          tooltip: 'Add repository paths to gitrx.repositories in VS Code settings to see them here.',
        },
        vscode.TreeItemCollapsibleState.None,
      );
      emptyNode.iconPath = ICONS.info;
      return [emptyNode];
    }

    // Load stats from database if not cached
    if (!this.statsLoaded) {
      await this.loadStats();
    }

    const rootNodes: RepoTreeItem[] = [];

    for (const repo of repositories) {
      const stats = this.statsCache.get(repo.name);
      const node = this.buildRepoRootNode(repo, stats);
      rootNodes.push(node);
    }

    this.logger.debug(CLASS_NAME, 'getRootNodes', `Returning ${rootNodes.length} root nodes`);
    return rootNodes;
  }

  /**
   * Build a single root node for a configured repository.
   * Shows commit count and tracker badge in the description if stats are available.
   * IQS-876: tracker badge displayed as [Jira] or [Linear] or [None].
   */
  private buildRepoRootNode(repo: RepositoryEntry, stats: RepoStats | undefined): RepoTreeItem {
    // Build tracker badge string (IQS-876)
    const trackerBadge = repo.trackerType === 'linear' ? '[Linear]'
      : repo.trackerType === 'none' ? '[No Tracker]'
      : '[Jira]';

    const description = stats
      ? `${trackerBadge} ${stats.totalCommits} commits`
      : `${trackerBadge} No sync data`;

    const tooltip = stats
      ? `${repo.name}\nTracker: ${repo.trackerType}\nPath: ${repo.path}\nCommits: ${stats.totalCommits}\nContributors: ${stats.uniqueContributors}\nBranches: ${stats.branchCount}`
      : `${repo.name}\nTracker: ${repo.trackerType}\nPath: ${repo.path}\nNo sync data available. Run the pipeline to populate.`;

    const node = new RepoTreeItem(
      {
        type: 'repository',
        repository: repo.name,
        label: repo.name,
        description,
        tooltip,
      },
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    node.iconPath = ICONS.repo;

    this.logger.trace(CLASS_NAME, 'buildRepoRootNode', `Built root node: ${repo.name} (${description})`);
    return node;
  }

  /**
   * Build child nodes for a repository: Last Sync Date, Total Commits,
   * Unique Contributors, Branches.
   */
  private getRepoChildNodes(repository: string): RepoTreeItem[] {
    const stats = this.statsCache.get(repository);

    if (!stats) {
      this.logger.debug(CLASS_NAME, 'getRepoChildNodes', `No stats for: ${repository}`);
      const noDataNode = new RepoTreeItem(
        {
          type: 'lastSyncDate',
          repository,
          label: 'No data available',
          description: 'Run pipeline to sync',
          tooltip: 'Run "Gitr: Run Pipeline" to populate data for this repository.',
        },
        vscode.TreeItemCollapsibleState.None,
      );
      noDataNode.iconPath = ICONS.warning;
      return [noDataNode];
    }

    const children: RepoTreeItem[] = [];

    // Last Sync Date
    const syncDateStr = stats.lastSyncDate
      ? stats.lastSyncDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : 'Never';

    const syncDateNode = new RepoTreeItem(
      {
        type: 'lastSyncDate',
        repository,
        label: 'Last Sync',
        description: syncDateStr,
        tooltip: `Most recent commit date: ${stats.lastSyncDate?.toISOString() ?? 'No commits found'}`,
      },
      vscode.TreeItemCollapsibleState.None,
    );
    syncDateNode.iconPath = ICONS.calendar;
    children.push(syncDateNode);

    // Total Commits
    const commitsNode = new RepoTreeItem(
      {
        type: 'totalCommits',
        repository,
        label: 'Total Commits',
        description: stats.totalCommits.toLocaleString(),
        tooltip: `${stats.totalCommits.toLocaleString()} distinct commits in ${repository}`,
      },
      vscode.TreeItemCollapsibleState.None,
    );
    commitsNode.iconPath = ICONS.gitCommit;
    children.push(commitsNode);

    // Unique Contributors
    const contributorsNode = new RepoTreeItem(
      {
        type: 'uniqueContributors',
        repository,
        label: 'Unique Contributors',
        description: stats.uniqueContributors.toLocaleString(),
        tooltip: `${stats.uniqueContributors.toLocaleString()} unique commit authors in ${repository}`,
      },
      vscode.TreeItemCollapsibleState.None,
    );
    contributorsNode.iconPath = ICONS.person;
    children.push(contributorsNode);

    // Branches
    const branchesNode = new RepoTreeItem(
      {
        type: 'branches',
        repository,
        label: 'Branches',
        description: stats.branchCount.toLocaleString(),
        tooltip: `${stats.branchCount.toLocaleString()} distinct branches in ${repository}`,
      },
      vscode.TreeItemCollapsibleState.None,
    );
    branchesNode.iconPath = ICONS.gitBranch;
    children.push(branchesNode);

    this.logger.debug(CLASS_NAME, 'getRepoChildNodes', `Built ${children.length} child nodes for: ${repository}`);
    return children;
  }

  /**
   * Load repository statistics from the database into the cache.
   * Attempts a database connection using current settings. If the database
   * is not available, logs a warning and continues with empty stats.
   */
  private async loadStats(): Promise<void> {
    this.logger.debug(CLASS_NAME, 'loadStats', 'Loading repository statistics from database');

    let dbService: DatabaseService | undefined;

    try {
      const settings = getSettings();

      // Get database password from SecretStorage
      const dbPassword = await this.secretService.getDatabasePassword();
      if (!dbPassword) {
        this.logger.warn(CLASS_NAME, 'loadStats', 'Database password not configured. TreeView will show repos without stats.');
        this.statsLoaded = true;
        return;
      }

      // Initialize a short-lived database connection for the query
      dbService = new DatabaseService();
      const dbConfig = buildConfigFromSettings(settings.database, dbPassword);

      this.logger.debug(CLASS_NAME, 'loadStats', `Connecting to database: ${settings.database.host}:${settings.database.port}`);
      await dbService.initialize(dbConfig);

      const repoStatsRepo = new RepoStatsRepository(dbService);
      const allStats = await repoStatsRepo.getRepoStats();

      // Populate cache
      this.statsCache.clear();
      for (const stats of allStats) {
        this.statsCache.set(stats.repository, stats);
      }

      this.logger.info(CLASS_NAME, 'loadStats', `Loaded stats for ${allStats.length} repositories into cache`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        CLASS_NAME,
        'loadStats',
        `Failed to load repo stats from database: ${message}. TreeView will show repos without stats.`,
      );
    } finally {
      // Always shut down the short-lived connection
      if (dbService) {
        try {
          await dbService.shutdown();
          this.logger.debug(CLASS_NAME, 'loadStats', 'Short-lived database connection shut down');
        } catch (shutdownError: unknown) {
          const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
          this.logger.warn(CLASS_NAME, 'loadStats', `Database shutdown warning: ${msg}`);
        }
      }
      this.statsLoaded = true;
    }
  }

  /**
   * Dispose resources held by this provider.
   */
  dispose(): void {
    this.logger.debug(CLASS_NAME, 'dispose', 'Disposing RepoTreeProvider');
    this._onDidChangeTreeData.dispose();
    this.statsCache.clear();
  }
}
