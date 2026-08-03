/**
 * TypeScript interfaces for the Dead Branches TreeView data shapes.
 *
 * Defines the data model for branch items displayed in the gitrx-dead-branches
 * TreeView sidebar. Branches are organized by risk level (Safe, Low, Medium, High).
 *
 * Ticket: GITX-239
 */

/**
 * Risk level categories for branch cleanup safety.
 * - **safe**: Merged AND >90 days old (safe to delete)
 * - **low**: Merged AND <90 days old
 * - **medium**: Unmerged AND 90-180 days old
 * - **high**: Unmerged AND (<90 days OR has open PR)
 */
export type BranchRiskLevel = 'safe' | 'low' | 'medium' | 'high';

/**
 * Display labels for risk level categories.
 */
export const RISK_LEVEL_LABELS: Record<BranchRiskLevel, string> = {
  safe: 'Safe',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/**
 * Order for displaying risk levels (safe first = safest to delete at top).
 */
export const RISK_LEVEL_ORDER: readonly BranchRiskLevel[] = [
  'safe',
  'low',
  'medium',
  'high',
] as const;

/**
 * Codicon IDs for risk level icons.
 * - safe: green check ($(pass))
 * - low: blue info ($(info))
 * - medium: yellow warning ($(warning))
 * - high: red error ($(error))
 */
export const RISK_LEVEL_ICONS: Record<BranchRiskLevel, string> = {
  safe: 'pass',
  low: 'info',
  medium: 'warning',
  high: 'error',
};

/**
 * Tooltips describing what each risk level means.
 */
export const RISK_LEVEL_TOOLTIPS: Record<BranchRiskLevel, string> = {
  safe: 'Merged branches over 90 days old - safe to delete',
  low: 'Merged branches under 90 days old',
  medium: 'Unmerged branches 90-180 days old',
  high: 'Unmerged branches under 90 days old or with open PRs',
};

/**
 * Discriminated union for TreeView node types.
 */
export type DeadBranchNodeType = 'riskCategory' | 'branch' | 'empty' | 'error';

/**
 * Branch data extracted from commit_history for display.
 */
export interface DeadBranchItem {
  /** Branch name */
  branchName: string;
  /** Repository name */
  repository: string;
  /** Last commit date */
  lastCommitDate: Date | null;
  /** Last commit author */
  lastCommitAuthor: string | null;
  /** Last commit SHA */
  lastCommitSha: string | null;
  /** Number of commits on branch */
  commitCount: number;
  /** Days since last commit */
  daysSinceLastCommit: number;
  /** Whether branch is merged into target branches */
  isMerged: boolean;
  /** Target branch merged into (if merged) */
  mergedInto: string | null;
  /** Whether branch has open PR */
  hasOpenPr: boolean;
  /** Whether branch is orphaned (remote deleted) */
  isOrphaned: boolean;
  /** Risk level for deletion safety */
  riskLevel: BranchRiskLevel;
  /** Branch status */
  status: 'merged' | 'stale' | 'orphaned' | 'active';
}

/**
 * Data model for a single node in the Dead Branches TreeView.
 */
export interface DeadBranchNodeData {
  /** The type of this tree node */
  readonly type: DeadBranchNodeType;
  /** Display label for this node */
  readonly label: string;
  /** Optional description shown alongside the label */
  readonly description?: string;
  /** Optional tooltip shown on hover */
  readonly tooltip?: string;
  /** Risk level (only for riskCategory nodes) */
  readonly riskLevel?: BranchRiskLevel;
  /** Branch data (only for branch nodes) */
  readonly branch?: DeadBranchItem;
  /** Error message (only for error nodes) */
  readonly errorMessage?: string;
}
