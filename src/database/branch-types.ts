/**
 * Type definitions for branch tracking and dead branch analysis.
 * Ticket: GITX-231
 */

/**
 * Row type for git_branch table.
 */
export interface GitBranchRow {
  id?: number;
  branchName: string;
  repository: string;
  lastCommitSha: string | null;
  lastCommitDate: Date | null;
  lastCommitAuthor: string | null;
  commitCount: number;
  isMerged: boolean;
  mergedInto: string | null;
  mergedDate: Date | null;
  isOrphaned: boolean;
  hasOpenPr: boolean;
  isProtected: boolean;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Row type for vw_dead_branch_summary view.
 */
export interface DeadBranchSummaryRow {
  id: number;
  branchName: string;
  repository: string;
  lastCommitDate: Date | null;
  lastCommitAuthor: string | null;
  lastCommitSha: string | null;
  commitCount: number;
  isMerged: boolean;
  mergedInto: string | null;
  isOrphaned: boolean;
  hasOpenPr: boolean;
  isProtected: boolean;
  createdAt: Date;
  updatedAt: Date;
  daysSinceLastCommit: number | null;
  status: 'merged' | 'stale' | 'orphaned' | 'active';
  riskLevel: 'safe' | 'low' | 'medium' | 'high';
}

/**
 * Filters for dead branch query.
 */
export interface DeadBranchFilters {
  repository?: string;
  riskLevels?: Array<'safe' | 'low' | 'medium' | 'high'>;
  statuses?: Array<'merged' | 'stale' | 'orphaned' | 'active'>;
  minDaysSinceLastCommit?: number;
  maxDaysSinceLastCommit?: number;
  isMerged?: boolean;
  hasOpenPr?: boolean;
  excludeProtected?: boolean;
  /** Search filter for branch name (case-insensitive substring match) */
  search?: string;
}

/**
 * Audit log entry for branch operations.
 */
export interface BranchOperationAudit {
  operationType: 'branch_delete' | 'branch_batch_delete' | 'branch_restore';
  repository: string;
  branchName: string | null;
  branchSha: string | null;
  operator: string | null;
  result: 'success' | 'failed' | 'rejected';
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Branch statistics for a repository.
 */
export interface BranchStatistics {
  totalBranches: number;
  safeBranches: number;
  lowRiskBranches: number;
  mediumRiskBranches: number;
  highRiskBranches: number;
  mergedBranches: number;
  staleBranches: number;
  orphanedBranches: number;
  activeBranches: number;
  protectedBranches: number;
  deletedBranches: number;
}

/**
 * Summary statistics by branch status (merged, stale, orphaned, active).
 * Used for dashboard KPI cards.
 */
export interface BranchSummaryStats {
  total: number;
  merged: number;
  stale: number;
  orphaned: number;
  active: number;
}

/**
 * Risk distribution counts.
 * Used for dashboard donut chart.
 */
export interface RiskDistributionStats {
  safe: number;
  low: number;
  medium: number;
  high: number;
}

/**
 * Per-repository risk breakdown.
 * Used for dashboard stacked bar chart.
 */
export interface RepositoryRiskBreakdown {
  repository: string;
  safe: number;
  low: number;
  medium: number;
  high: number;
}

/**
 * Total branch count statistics.
 * GITX-235: Distinguishes between total branches and cleanup candidates.
 */
export interface TotalBranchCountStats {
  /** Total branches including protected */
  totalBranches: number;
  /** Cleanup candidates (excludes protected branches) */
  cleanupCandidates: number;
}

/**
 * Branch metadata extracted from commit_history table.
 * GITX-237: Alternative to live git commands for branch analysis.
 *
 * Note: Without git merge-base, we cannot determine if a branch is merged.
 * Status and risk levels are calculated conservatively assuming branches are NOT merged.
 */
export interface CommitHistoryBranch {
  branchName: string;
  repository: string;
  lastCommitDate: Date | null;
  lastCommitAuthor: string | null;
  lastCommitSha: string | null;
  commitCount: number;
  daysSinceLastCommit: number;
  status: 'stale' | 'active';
  riskLevel: 'medium' | 'high';
  isMerged: boolean;
  mergedInto: string | null;
  isOrphaned: boolean;
  hasOpenPr: boolean;
  isProtected: boolean;
}
