import * as vscode from 'vscode';
import type {
  ContributorSummaryRow,
  ContributorTreeNodeData,
} from './contributor-tree-types.js';

/**
 * Label used for contributors with no team assignment.
 */
export const UNASSIGNED_TEAM_LABEL = '(Unassigned)';

/**
 * Label used for organizations with no name assignment.
 * GITX-211: Teams without an organization are grouped here.
 */
export const UNASSIGNED_ORG_LABEL = 'Unassigned';

/**
 * ThemeIcon identifiers used for tree nodes.
 * Using built-in VS Code codicons for consistent theming.
 * GITX-211: Added organization icon.
 */
export const ICONS = {
  organization: new vscode.ThemeIcon('organization'),
  team: new vscode.ThemeIcon('people'),
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
 *
 * GITX-211: Updated to support aria-level via accessibilityInformation.
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
 * Build detail leaf nodes for a contributor: name, logins, vendor, commits, repos.
 * GITX-169: Updated to show all associated logins and use fullName as identifier.
 *
 * @param contributor The contributor data
 * @param contributorKey The unique key for this contributor (fullName or logins)
 * @returns Array of detail tree items
 */
export function buildContributorDetailNodes(
  contributor: ContributorSummaryRow,
  contributorKey: string,
): ContributorTreeItem[] {
  const details: ContributorTreeItem[] = [];

  // Full Name
  if (contributor.fullName) {
    const nameNode = new ContributorTreeItem(
      {
        type: 'detail',
        label: 'Name',
        description: contributor.fullName,
        tooltip: `Full Name: ${contributor.fullName}`,
        contributorLogin: contributorKey,
      },
      vscode.TreeItemCollapsibleState.None,
    );
    nameNode.iconPath = ICONS.name;
    details.push(nameNode);
  }

  // Logins - show all associated logins
  const logins = contributor.logins
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const loginsNode = new ContributorTreeItem(
    {
      type: 'detail',
      label: 'Logins',
      description: logins.length === 1 ? logins[0]! : `${logins.length} logins`,
      tooltip: `Logins:\n${logins.map((l) => `  - ${l}`).join('\n')}`,
      contributorLogin: contributorKey,
    },
    vscode.TreeItemCollapsibleState.None,
  );
  loginsNode.iconPath = ICONS.name;
  details.push(loginsNode);

  // Vendor
  const vendorLabel = contributor.vendor ?? 'Unknown';
  const vendorNode = new ContributorTreeItem(
    {
      type: 'detail',
      label: 'Vendor',
      description: vendorLabel,
      tooltip: `Vendor: ${vendorLabel}`,
      contributorLogin: contributorKey,
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
      contributorLogin: contributorKey,
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
        contributorLogin: contributorKey,
      },
      vscode.TreeItemCollapsibleState.None,
    );
    repoNode.iconPath = ICONS.repos;
    details.push(repoNode);
  }

  return details;
}

/**
 * Build a contributor tree node with commit count description and icon.
 * GITX-169: Display as "{fullName} (@{login})" or just login if no fullName.
 * GITX-211: Display as "Full Name (X commits)" to match acceptance criteria.
 *
 * @param contributor The contributor data
 * @returns A ContributorTreeItem for the contributor
 */
export function buildContributorNode(contributor: ContributorSummaryRow): ContributorTreeItem {
  // Get the primary login (first one in the comma-separated list)
  const primaryLogin = contributor.logins.split(',')[0]?.trim() ?? contributor.logins;

  // Format: "Full Name (X commits)" or "{login} (X commits)" if no fullName
  const displayName = contributor.fullName ?? primaryLogin;
  const description = `(${contributor.commitCount.toLocaleString()} commits)`;

  // Tooltip with all details
  const logins = contributor.logins
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const teamLabel = contributor.team ?? '(Unassigned)';
  const orgLabel = contributor.organizationName ?? 'Unassigned';
  const tooltipParts = [
    contributor.fullName ? contributor.fullName : null,
    `Logins: ${logins.join(', ')}`,
    `Organization: ${orgLabel}`,
    `Team: ${teamLabel}`,
    contributor.vendor ? `Vendor: ${contributor.vendor}` : null,
    `Commits: ${contributor.commitCount.toLocaleString()}`,
  ].filter(Boolean);

  // Use fullName as the key, or logins if fullName is null
  const contributorKey = contributor.fullName ?? contributor.logins;

  const node = new ContributorTreeItem(
    {
      type: 'contributor',
      label: displayName,
      description,
      tooltip: tooltipParts.join('\n'),
      organizationName: contributor.organizationName ?? undefined,
      teamName: contributor.team ?? undefined,
      contributorLogin: contributorKey,
      contributorData: contributor,
    },
    vscode.TreeItemCollapsibleState.Collapsed,
  );

  // Use shield icon for Company (internal) contributors
  const isCompany = contributor.vendor?.toLowerCase() === 'company';
  node.iconPath = isCompany ? ICONS.contributorCompany : ICONS.contributor;

  // Set command for click to open Developer Profile dashboard (GITX-155)
  // GITX-178: Pass full_name (with login fallback) to match Developer Profile query pattern
  // The Developer Profile queries use: WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
  const contributorIdentifier = contributor.fullName ?? primaryLogin;
  node.command = {
    command: 'gitrx.openDeveloperProfile',
    title: 'Open Developer Profile',
    arguments: [contributorIdentifier],
  };

  return node;
}

/**
 * Build an empty placeholder node when no data is available.
 *
 * @returns A ContributorTreeItem placeholder
 */
export function buildEmptyNode(): ContributorTreeItem {
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
