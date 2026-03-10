/**
 * TypeScript interfaces for the Repos TreeView data shapes.
 *
 * Defines the data model for repository statistics displayed in the
 * gitrx-repos TreeView sidebar. Sourced from commit_history queries.
 *
 * Ticket: IQS-866
 */

/**
 * Aggregate statistics for a single configured repository.
 * Returned by RepoStatsRepository.getRepoStats().
 */
export interface RepoStats {
  /** Repository name (from commit_history.repository column). */
  readonly repository: string;
  /** Most recent commit date across all branches, or null if no commits. */
  readonly lastSyncDate: Date | null;
  /** Total number of distinct commits (by SHA). */
  readonly totalCommits: number;
  /** Number of unique commit authors. */
  readonly uniqueContributors: number;
  /** Number of distinct branches. */
  readonly branchCount: number;
}

/**
 * Discriminated union for TreeView node types.
 * Used by RepoTreeProvider to differentiate root (repo) and child (detail) nodes.
 */
export type RepoTreeNodeType =
  | 'repository'
  | 'lastSyncDate'
  | 'totalCommits'
  | 'uniqueContributors'
  | 'branches';

/**
 * Data model for a single node in the Repos TreeView.
 * Passed as TreeItem.contextValue and used for rendering.
 */
export interface RepoTreeNodeData {
  /** The type of this tree node. */
  readonly type: RepoTreeNodeType;
  /** The repository name this node belongs to. */
  readonly repository: string;
  /** Display label for this node. */
  readonly label: string;
  /** Optional description shown alongside the label. */
  readonly description?: string;
  /** Optional tooltip shown on hover. */
  readonly tooltip?: string;
}
