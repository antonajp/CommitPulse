/**
 * Type definitions for dead/stale branch detection and cleanup.
 *
 * Provides interfaces for branch analysis results, risk categorization,
 * deletion operations, and configuration. Used by DeadBranchesService
 * to identify branches that are merged, stale, or orphaned, and to
 * calculate risk levels for safe cleanup workflows.
 *
 * Ticket: GITX-231
 */

/**
 * Branch status classification based on merge state and activity.
 */
export type BranchStatus = 'merged' | 'stale' | 'orphaned' | 'active';

/**
 * Risk level for branch deletion safety assessment.
 *
 * Hierarchy (safest to riskiest):
 * - safe: Merged and old (>90 days) - safe to delete
 * - low: Merged and recent (<90 days) - low risk
 * - medium: Unmerged but old (90-180 days) - medium risk
 * - high: Unmerged with open PR OR <90 days - high risk
 */
export type BranchRiskLevel = 'safe' | 'low' | 'medium' | 'high';

/**
 * Metadata for a detected branch.
 *
 * Contains all information needed to assess deletion risk,
 * display in UI, and execute safe cleanup operations.
 */
export interface DetectedBranch {
  /** Branch name (without refs/heads/ or refs/remotes/ prefix) */
  name: string;

  /** Repository name from gitr.repositories config */
  repository: string;

  /** Last commit SHA (full 40-character hash) */
  lastCommitSha: string;

  /** Date of last commit on this branch */
  lastCommitDate: Date;

  /** Author of last commit */
  lastCommitAuthor: string;

  /** Total number of commits on this branch */
  commitCount: number;

  /** True if branch is fully merged into a protected branch */
  isMerged: boolean;

  /** Name of protected branch this was merged into (null if not merged) */
  mergedInto: string | null;

  /** True if branch is orphaned (local-only with no remote or remote deleted) */
  isOrphaned: boolean;

  /** True if branch has an open PR (GitHub, Linear, or Jira-linked) */
  hasOpenPR: boolean;

  /** True if branch matches protected branch patterns */
  isProtected: boolean;

  /** Computed status: merged, stale, orphaned, or active */
  status: BranchStatus;

  /** Computed risk level: safe, low, medium, or high */
  riskLevel: BranchRiskLevel;

  /** Number of days since last commit (for staleness calculation) */
  daysSinceLastCommit: number;
}

/**
 * Result of analyzing all branches in a repository.
 *
 * Includes the full list of detected branches plus summary
 * statistics for quick overview and filtering.
 */
export interface BranchAnalysisResult {
  /** All detected branches with metadata */
  branches: DetectedBranch[];

  /** Summary counts by status */
  summary: {
    total: number;
    merged: number;
    stale: number;
    orphaned: number;
    active: number;
  };

  /** Summary counts by risk level */
  riskDistribution: {
    safe: number;
    low: number;
    medium: number;
    high: number;
  };

  /** Risk distribution grouped by repository */
  repositoryBreakdown: Map<string, { safe: number; low: number; medium: number; high: number }>;
}

/**
 * Result of a single branch deletion operation.
 *
 * Used to track success/failure and provide SHA for recovery.
 */
export interface BranchDeletionResult {
  /** True if deletion succeeded */
  success: boolean;

  /** Name of branch that was deleted (or attempted) */
  branchName: string;

  /** SHA of branch tip (for recovery via git checkout -b) */
  sha: string;

  /** Error message if deletion failed */
  error?: string;
}

/**
 * Configuration for dead branch detection and cleanup.
 *
 * Controls staleness thresholds, exclusion patterns, and
 * safety settings for deletion operations.
 */
export interface DeadBranchesConfig {
  /**
   * Number of days since last commit to consider a branch stale.
   * Default: 90 days.
   * Configurable via gitr.deadBranches.staleDaysThreshold setting.
   */
  staleDaysThreshold: number;

  /**
   * Glob patterns for branches to exclude from analysis.
   * Default: ["main", "master", "develop", "release/*", "hotfix/*"]
   * Configurable via gitr.deadBranches.excludePatterns setting.
   *
   * Supports minimatch patterns:
   * - "feature/GITX-*" (specific prefix)
   * - "**-wip" (any branch ending in -wip)
   * - "staging" (exact match)
   */
  excludePatterns: string[];

  /**
   * If true, only include merged branches in analysis results.
   * Default: true (safer filtering for cleanup).
   * Configurable via gitr.deadBranches.mergedOnly setting.
   *
   * When false, includes all branches (merged and unmerged)
   * for comprehensive analysis, but deletion requires force flag.
   */
  mergedOnly: boolean;

  /**
   * Target branches to check for merge status.
   * Default: ["main", "master", "develop", "production", "release"]
   * Configurable via gitr.branchCleanup.targetBranches setting.
   *
   * Branches are considered "merged" if all their commits are
   * reachable from any of these target branches.
   *
   * GITX-233: Added to support BitBucket repos with non-standard
   * default branch naming conventions.
   */
  targetBranches?: string[];
}
