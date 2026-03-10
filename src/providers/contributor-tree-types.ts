/**
 * TypeScript interfaces for the Contributors/Teams TreeView data shapes.
 *
 * Defines the data model for contributor and team information displayed in the
 * gitrx-contributors TreeView sidebar. Sourced from commit_contributors,
 * gitja_team_contributor, and max_num_count_per_login database views/tables.
 *
 * Ticket: IQS-867
 */

// ============================================================================
// Database result types for TreeView queries
// ============================================================================

/**
 * Row shape returned by the contributor summary query.
 * Combines data from commit_contributors + commit_history aggregation +
 * max_num_count_per_login view for the primary team assignment.
 */
export interface ContributorSummaryRow {
  /** GitHub login (primary key in commit_contributors). */
  readonly login: string;
  /** Full display name, or null if not available. */
  readonly fullName: string | null;
  /** Vendor classification (e.g., 'Company' or external vendor name). */
  readonly vendor: string | null;
  /** Primary team assignment from max_num_count_per_login view. */
  readonly team: string | null;
  /** Comma-separated list of repositories this contributor has committed to. */
  readonly repoList: string | null;
  /** Total number of commits by this contributor. */
  readonly commitCount: number;
}

// ============================================================================
// TreeView node types
// ============================================================================

/**
 * Discriminated union for Contributors TreeView node types.
 * Used by ContributorTreeProvider to differentiate root and child nodes.
 *
 * - 'team': Root node representing a team grouping
 * - 'contributor': A contributor node (child of team or root in flat mode)
 * - 'detail': A leaf node showing a specific contributor attribute
 * - 'empty': Placeholder node when no data is available
 */
export type ContributorTreeNodeType =
  | 'team'
  | 'contributor'
  | 'detail'
  | 'empty';

/**
 * Data model for a single node in the Contributors TreeView.
 * Carried by ContributorTreeItem for rendering and child resolution.
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
  /** Team name this node belongs to (for team and contributor nodes). */
  readonly teamName?: string;
  /** Contributor login (for contributor and detail nodes). */
  readonly contributorLogin?: string;
  /** Full contributor summary data (for contributor nodes, used on click). */
  readonly contributorData?: ContributorSummaryRow;
}

/**
 * Enum-like constants for the two display modes.
 * - 'grouped': Team root nodes with contributor children
 * - 'flat': All contributors listed alphabetically as root nodes
 */
export type ContributorViewMode = 'grouped' | 'flat';
