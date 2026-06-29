import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import type {
  ContributorSummaryRow,
  ContributorViewMode,
} from './contributor-tree-types.js';
import { ContributorRepository } from '../database/contributor-repository.js';
import { DatabaseService, buildConfigFromSettings } from '../database/database-service.js';
import { SecretStorageService } from '../config/secret-storage.js';
import { getSettings } from '../config/settings.js';
import {
  ContributorTreeItem,
  ICONS,
  UNASSIGNED_TEAM_LABEL,
  UNASSIGNED_ORG_LABEL,
  buildContributorDetailNodes,
  buildContributorNode,
  buildEmptyNode,
} from './contributor-tree-builders.js';

// Re-export ContributorTreeItem for consumers
export { ContributorTreeItem } from './contributor-tree-builders.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ContributorTreeProvider';

/**
 * ContributorTreeProvider implements vscode.TreeDataProvider<ContributorTreeItem>
 * for the gitrx-contributors TreeView.
 *
 * GITX-211: 3-level hierarchy support:
 * - grouped mode: Organization (root) -> Teams (children) -> Contributors (grandchildren)
 * - team mode: Team (root) -> Contributors (children) (legacy 2-level mode)
 * - flat mode: All contributors listed alphabetically
 *
 * Data sourced from commit_contributors + gitja_team_contributor +
 * max_num_count_per_login via ContributorRepository.getContributorSummaries().
 *
 * Ticket: IQS-867
 * Ticket: GITX-211 - 3-level hierarchy (Organization -> Team -> Contributor)
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
   * Current display mode:
   * - 'grouped': Organization root nodes with team and contributor children (GITX-211)
   * - 'team': Team root nodes with contributor children (legacy 2-level mode)
   * - 'flat': All contributors listed alphabetically
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
   * Toggle between grouped (by org), team (by team only), and flat display modes.
   * Cycles: grouped -> team -> flat -> grouped
   * Fires a tree data change event to rebuild the entire tree.
   *
   * GITX-211: Now supports 3 modes.
   *
   * @returns The new view mode label for display in notifications
   */
  toggleViewMode(): string {
    if (this.viewMode === 'grouped') {
      this.viewMode = 'team';
    } else if (this.viewMode === 'team') {
      this.viewMode = 'flat';
    } else {
      this.viewMode = 'grouped';
    }

    const modeLabels: Record<ContributorViewMode, string> = {
      grouped: 'Group by Organization',
      team: 'Group by Team',
      flat: 'Flat List',
    };
    const modeLabel = modeLabels[this.viewMode];
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
   * GITX-211: Supports 3-level hierarchy (organization -> team -> contributor).
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

    // GITX-211: Handle organization node -> return team children
    if (element.nodeData.type === 'organization') {
      return this.getOrganizationChildNodes(element.nodeData.organizationName ?? UNASSIGNED_ORG_LABEL);
    }

    if (element.nodeData.type === 'team') {
      return this.getTeamChildNodes(
        element.nodeData.teamName ?? UNASSIGNED_TEAM_LABEL,
        element.nodeData.organizationName,
      );
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
      return [buildEmptyNode()];
    }

    if (this.viewMode === 'grouped') {
      return this.getOrganizationRootNodes();
    }
    if (this.viewMode === 'team') {
      return this.getTeamRootNodes();
    }
    return this.getFlatRootNodes();
  }

  /**
   * Build root nodes in grouped mode: one collapsible node per organization.
   * Organizations are sorted alphabetically, "Unassigned" always at bottom.
   *
   * GITX-211: TreeView structure: Organization (root) -> Teams (children) -> Contributors
   * Display format: "Org Name - X teams, Y contributors, Z commits"
   */
  private getOrganizationRootNodes(): ContributorTreeItem[] {
    this.logger.debug(CLASS_NAME, 'getOrganizationRootNodes', 'Building organization root nodes');

    // Group contributors by organization
    const orgMap = new Map<string, ContributorSummaryRow[]>();
    for (const contributor of this.contributorCache) {
      const orgKey = contributor.organizationName ?? UNASSIGNED_ORG_LABEL;
      const existing = orgMap.get(orgKey);
      if (existing) {
        existing.push(contributor);
      } else {
        orgMap.set(orgKey, [contributor]);
      }
    }

    // Sort organization names: assigned orgs alphabetically, Unassigned last
    const orgNames = Array.from(orgMap.keys()).sort((a, b) => {
      if (a === UNASSIGNED_ORG_LABEL) { return 1; }
      if (b === UNASSIGNED_ORG_LABEL) { return -1; }
      return a.localeCompare(b);
    });

    const rootNodes: ContributorTreeItem[] = [];
    for (const orgName of orgNames) {
      const members = orgMap.get(orgName) ?? [];
      const totalCommits = members.reduce((sum, c) => sum + c.commitCount, 0);

      // Count unique teams in this organization
      const teamsInOrg = new Set<string>();
      for (const member of members) {
        teamsInOrg.add(member.team ?? UNASSIGNED_TEAM_LABEL);
      }
      const teamCount = teamsInOrg.size;

      // Format: "Org Name - X teams, Y contributors, Z commits"
      const description = `${teamCount} team${teamCount !== 1 ? 's' : ''}, ${members.length} contributor${members.length !== 1 ? 's' : ''}, ${totalCommits.toLocaleString()} commits`;

      const node = new ContributorTreeItem(
        {
          type: 'organization',
          label: orgName,
          description,
          tooltip: `Organization: ${orgName}\nTeams: ${teamCount}\nContributors: ${members.length}\nTotal Commits: ${totalCommits.toLocaleString()}`,
          organizationName: orgName,
        },
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      node.iconPath = ICONS.organization;

      // GITX-211: Add click command for organization nodes (opens Organization Profile)
      // Exclude "Unassigned" organization from Organization Profile (no click action)
      if (orgName !== UNASSIGNED_ORG_LABEL) {
        node.command = {
          command: 'gitrx.openOrganizationProfile',
          title: 'Open Organization Profile',
          arguments: [orgName],
        };
      }

      rootNodes.push(node);
    }

    this.logger.debug(CLASS_NAME, 'getOrganizationRootNodes', `Built ${rootNodes.length} organization nodes`);
    return rootNodes;
  }

  /**
   * Build root nodes in team mode (legacy 2-level): one collapsible node per team.
   * Teams are sorted alphabetically with unassigned at the end.
   */
  private getTeamRootNodes(): ContributorTreeItem[] {
    this.logger.debug(CLASS_NAME, 'getTeamRootNodes', 'Building team root nodes');

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

      // Format: "Team Name - X contributors, Y commits"
      const description = `${members.length} contributor${members.length !== 1 ? 's' : ''}, ${totalCommits.toLocaleString()} commits`;

      const node = new ContributorTreeItem(
        {
          type: 'team',
          label: teamName,
          description,
          tooltip: `Team: ${teamName}\nContributors: ${members.length}\nTotal Commits: ${totalCommits.toLocaleString()}`,
          teamName,
        },
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      node.iconPath = ICONS.team;

      // Add click command for team nodes (GITX-185)
      // Exclude "(Unassigned)" team from Team Profile (no click action)
      if (teamName !== UNASSIGNED_TEAM_LABEL) {
        node.command = {
          command: 'gitrx.openTeamProfile',
          title: 'Open Team Profile',
          arguments: [teamName],
        };
      }

      rootNodes.push(node);
    }

    this.logger.debug(CLASS_NAME, 'getTeamRootNodes', `Built ${rootNodes.length} team nodes`);
    return rootNodes;
  }

  /**
   * Build root nodes in flat mode: one collapsible node per contributor.
   * Contributors are sorted alphabetically by fullName (with fallback to logins).
   * GITX-169: Sort by fullName instead of login.
   */
  private getFlatRootNodes(): ContributorTreeItem[] {
    this.logger.debug(CLASS_NAME, 'getFlatRootNodes', 'Building flat root nodes');

    const sorted = [...this.contributorCache].sort((a, b) => {
      const nameA = (a.fullName ?? a.logins).toLowerCase();
      const nameB = (b.fullName ?? b.logins).toLowerCase();
      return nameA.localeCompare(nameB);
    });
    const rootNodes: ContributorTreeItem[] = [];

    for (const contributor of sorted) {
      rootNodes.push(buildContributorNode(contributor));
    }

    this.logger.debug(CLASS_NAME, 'getFlatRootNodes', `Built ${rootNodes.length} contributor nodes`);
    return rootNodes;
  }

  // --------------------------------------------------------------------------
  // Child node builders
  // --------------------------------------------------------------------------

  /**
   * Build child nodes for an organization: one collapsible node per team in that org.
   * Teams are sorted by commit count descending within organization.
   *
   * GITX-211: Organization -> Team hierarchy.
   */
  private getOrganizationChildNodes(orgName: string): ContributorTreeItem[] {
    const targetOrg = orgName === UNASSIGNED_ORG_LABEL ? null : orgName;

    // Group contributors by team within this organization
    const teamMap = new Map<string, ContributorSummaryRow[]>();
    for (const contributor of this.contributorCache) {
      const contributorOrg = contributor.organizationName;
      if (targetOrg === null ? contributorOrg === null : contributorOrg === targetOrg) {
        const teamKey = contributor.team ?? UNASSIGNED_TEAM_LABEL;
        const existing = teamMap.get(teamKey);
        if (existing) {
          existing.push(contributor);
        } else {
          teamMap.set(teamKey, [contributor]);
        }
      }
    }

    // Sort teams by commit count descending
    const teamEntries = Array.from(teamMap.entries())
      .map(([teamName, members]) => ({
        teamName,
        members,
        totalCommits: members.reduce((sum, c) => sum + c.commitCount, 0),
      }))
      .sort((a, b) => {
        // Sort by commit count desc, "(Unassigned)" always last
        if (a.teamName === UNASSIGNED_TEAM_LABEL) { return 1; }
        if (b.teamName === UNASSIGNED_TEAM_LABEL) { return -1; }
        return b.totalCommits - a.totalCommits;
      });

    const childNodes: ContributorTreeItem[] = [];
    for (const { teamName, members, totalCommits } of teamEntries) {
      // Format: "Team Name - X contributors, Y commits"
      const description = `${members.length} contributor${members.length !== 1 ? 's' : ''}, ${totalCommits.toLocaleString()} commits`;

      const node = new ContributorTreeItem(
        {
          type: 'team',
          label: teamName,
          description,
          tooltip: `Team: ${teamName}\nOrganization: ${orgName}\nContributors: ${members.length}\nTotal Commits: ${totalCommits.toLocaleString()}`,
          organizationName: orgName,
          teamName,
        },
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      node.iconPath = ICONS.team;

      // Add click command for team nodes (GITX-185)
      // Exclude "(Unassigned)" team from Team Profile (no click action)
      if (teamName !== UNASSIGNED_TEAM_LABEL) {
        node.command = {
          command: 'gitrx.openTeamProfile',
          title: 'Open Team Profile',
          arguments: [teamName],
        };
      }

      childNodes.push(node);
    }

    this.logger.debug(
      CLASS_NAME,
      'getOrganizationChildNodes',
      `Built ${childNodes.length} team nodes for organization: ${orgName}`,
    );

    return childNodes;
  }

  /**
   * Build child nodes for a team: one collapsible node per contributor in that team.
   * Contributors are sorted by commit count descending, then by fullName.
   * GITX-169: Sort by fullName instead of login.
   *
   * GITX-211: Now accepts optional orgName for 3-level hierarchy filtering.
   */
  private getTeamChildNodes(teamName: string, orgName?: string): ContributorTreeItem[] {
    const targetTeam = teamName === UNASSIGNED_TEAM_LABEL ? null : teamName;
    const targetOrg = orgName === UNASSIGNED_ORG_LABEL ? null : orgName;

    const members = this.contributorCache
      .filter((c) => {
        const teamMatch = targetTeam === null ? c.team === null : c.team === targetTeam;
        // In 'grouped' mode, also filter by organization
        if (this.viewMode === 'grouped' && orgName !== undefined) {
          const orgMatch = targetOrg === null ? c.organizationName === null : c.organizationName === targetOrg;
          return teamMatch && orgMatch;
        }
        return teamMatch;
      })
      .sort((a, b) => {
        // Sort by commit count desc, then fullName asc
        if (b.commitCount !== a.commitCount) {
          return b.commitCount - a.commitCount;
        }
        const nameA = (a.fullName ?? a.logins).toLowerCase();
        const nameB = (b.fullName ?? b.logins).toLowerCase();
        return nameA.localeCompare(nameB);
      });

    this.logger.debug(
      CLASS_NAME,
      'getTeamChildNodes',
      `Building ${members.length} contributor nodes for team: ${teamName}${orgName ? ` in org: ${orgName}` : ''}`,
    );

    return members.map((contributor) => buildContributorNode(contributor));
  }

  /**
   * Build detail leaf nodes for a contributor: name, logins, vendor, commits, repos.
   * GITX-169: Updated to show all associated logins and use fullName as identifier.
   */
  private getContributorDetailNodes(contributorKey: string): ContributorTreeItem[] {
    // Find by fullName or logins (since contributorKey could be either)
    const contributor = this.contributorCache.find(
      (c) => c.fullName === contributorKey || c.logins === contributorKey,
    );
    if (!contributor) {
      this.logger.warn(CLASS_NAME, 'getContributorDetailNodes', `Contributor not found: ${contributorKey}`);
      return [];
    }

    this.logger.debug(
      CLASS_NAME,
      'getContributorDetailNodes',
      `Building detail nodes for: ${contributorKey}`,
    );

    return buildContributorDetailNodes(contributor, contributorKey);
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
