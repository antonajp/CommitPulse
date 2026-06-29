/**
 * TypeScript interfaces for the Contributors/Teams TreeView data shapes.
 *
 * Defines the data model for contributor and team information displayed in the
 * gitrx-contributors TreeView sidebar. Sourced from commit_contributors,
 * gitja_team_contributor, and max_num_count_per_login database views/tables.
 *
 * Ticket: IQS-867
 * Ticket: GITX-211 - Added 3-level hierarchy (Organization -> Team -> Contributor)
 */

// ============================================================================
// Database result types for TreeView queries
// ============================================================================

/**
 * Row shape returned by the contributor summary query.
 * Combines data from commit_contributors + commit_history aggregation +
 * max_num_count_per_login view for the primary team assignment.
 *
 * GITX-169: Now grouped by full_name instead of login.
 * GITX-211: Added organizationName for 3-level hierarchy support.
 */
export interface ContributorSummaryRow {
  /** Full display name (primary identifier, or null if not available). */
  readonly fullName: string | null;
  /** Comma-separated list of all GitHub logins associated with this full_name. */
  readonly logins: string;
  /** Vendor classification (e.g., 'Company' or external vendor name). */
  readonly vendor: string | null;
  /** Primary team assignment from max_num_count_per_login view. */
  readonly team: string | null;
  /** Organization name this contributor belongs to (null if team has no org). */
  readonly organizationName: string | null;
  /** Comma-separated list of repositories this contributor has committed to. */
  readonly repoList: string | null;
  /** Total number of commits by this contributor (aggregated across all logins). */
  readonly commitCount: number;
}

// ============================================================================
// TreeView node types - GITX-211: 3-level hierarchy discriminated unions
// ============================================================================

/**
 * Organization node in the 3-level hierarchy.
 * Root level node representing an organization.
 *
 * GITX-211: TreeView structure: Organization (root) -> Teams (children) -> Contributors
 */
export interface OrganizationNode {
  readonly type: 'organization';
  /** Organization name (display label). */
  readonly name: string;
  /** Number of teams in this organization. */
  readonly teamCount: number;
  /** Number of contributors across all teams. */
  readonly contributorCount: number;
  /** Total commits across all contributors. */
  readonly commitCount: number;
}

/**
 * Team node in the 3-level hierarchy.
 * Child of organization, parent of contributors.
 *
 * GITX-211: Includes organizationName for parent reference.
 */
export interface TeamNode {
  readonly type: 'team';
  /** Organization name (null for unassigned teams). */
  readonly organizationName: string | null;
  /** Team name (display label). */
  readonly teamName: string;
  /** Number of contributors in this team. */
  readonly contributorCount: number;
  /** Total commits by team members. */
  readonly commitCount: number;
}

/**
 * Contributor node in the 3-level hierarchy.
 * Child of team, leaf node in hierarchy (but can expand to show details).
 *
 * GITX-211: Includes organizationName and teamName for parent references.
 */
export interface ContributorNode {
  readonly type: 'contributor';
  /** Organization name (null if team has no org). */
  readonly organizationName: string | null;
  /** Team name. */
  readonly teamName: string;
  /** Full display name (or login if no fullName). */
  readonly fullName: string;
  /** Primary email (from logins). */
  readonly email: string;
  /** Total commits by this contributor. */
  readonly commitCount: number;
}

/**
 * Discriminated union for 3-level hierarchy node types.
 * GITX-211: Used by ContributorTreeProvider for hierarchical navigation.
 */
export type TreeNodeData = OrganizationNode | TeamNode | ContributorNode;

/**
 * Legacy discriminated union for Contributors TreeView node types.
 * Used by ContributorTreeProvider to differentiate root and child nodes.
 *
 * - 'organization': Root node representing an organization grouping (GITX-211)
 * - 'team': Node representing a team grouping (child of org in 3-level mode)
 * - 'contributor': A contributor node (child of team or root in flat mode)
 * - 'detail': A leaf node showing a specific contributor attribute
 * - 'empty': Placeholder node when no data is available
 */
export type ContributorTreeNodeType =
  | 'organization'
  | 'team'
  | 'contributor'
  | 'detail'
  | 'empty';

/**
 * Data model for a single node in the Contributors TreeView.
 * Carried by ContributorTreeItem for rendering and child resolution.
 *
 * GITX-211: Added organizationName for 3-level hierarchy support.
 */
export interface ContributorTreeNodeData {
  /** The type of this tree node for discrimination. */
  readonly type: ContributorTreeNodeType;
  /** Display label for this node. */
  readonly label: string;
  /** Optional description shown alongside the label (e.g., commit count). */
  readonly description?: string;
  /** Optional tooltip shown on hover with full details. */
  readonly tooltip?: string;
  /** Organization name this node belongs to (for org, team, and contributor nodes). */
  readonly organizationName?: string;
  /** Team name this node belongs to (for team and contributor nodes). */
  readonly teamName?: string;
  /** Contributor login (for contributor and detail nodes). */
  readonly contributorLogin?: string;
  /** Full contributor summary data (for contributor nodes, used on click). */
  readonly contributorData?: ContributorSummaryRow;
}

/**
 * Enum-like constants for the three display modes.
 * - 'grouped': Organization root nodes with team and contributor children (GITX-211)
 * - 'team': Team root nodes with contributor children (legacy 2-level mode)
 * - 'flat': All contributors listed alphabetically as root nodes
 */
export type ContributorViewMode = 'grouped' | 'team' | 'flat';
