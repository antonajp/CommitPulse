/**
 * Type definitions for the PR Coverage Report dashboard.
 *
 * Defines data shapes for:
 * - Overall coverage metrics (hero section)
 * - Orphan commits (table data)
 * - Branch/Author compliance charts
 * - Weekly trend data
 * - Filter options
 *
 * Ticket: GITX-221
 */

/**
 * Maximum length for string filter inputs (CWE-20 validation).
 */
export const PR_COVERAGE_MAX_FILTER_LENGTH = 255;

/**
 * Default number of days to analyze for coverage reports.
 */
export const PR_COVERAGE_DEFAULT_DAYS = 90;

// ============================================================================
// Coverage Status Types
// ============================================================================

/**
 * Coverage status classification for a commit.
 */
export type CoverageStatus = 'pr_linked' | 'orphan' | 'merge_commit';

// ============================================================================
// Overall Coverage Metrics
// ============================================================================

/**
 * Overall PR coverage summary metrics.
 * Used for hero section KPI cards.
 */
export interface PRCoverageOverall {
  /** Total non-merge commits analyzed */
  readonly totalCommits: number;
  /** Commits linked to a pull request */
  readonly prLinkedCommits: number;
  /** Commits without a pull request (orphans) */
  readonly orphanCommits: number;
  /** Merge commits (excluded from coverage calculation) */
  readonly mergeCommits: number;
  /** Number of repositories analyzed */
  readonly repositoriesAnalyzed: number;
  /** Coverage percentage: (prLinkedCommits / totalCommits) * 100 */
  readonly coveragePercentage: number;
}

// ============================================================================
// Orphan Commit Data
// ============================================================================

/**
 * Single orphan commit record for the orphan commits table.
 */
export interface OrphanCommit {
  /** Commit SHA (40 characters) */
  readonly sha: string;
  /** Repository name */
  readonly repository: string;
  /** Branch name where commit was made */
  readonly branch: string | null;
  /** Author login/name */
  readonly author: string;
  /** Commit timestamp (ISO string) */
  readonly commitDate: string;
  /** First line of commit message */
  readonly commitMessage: string | null;
  /** Lines added in commit */
  readonly linesAdded: number;
  /** Lines removed in commit */
  readonly linesRemoved: number;
  /** Number of files changed */
  readonly fileCount: number;
  /** Organization name */
  readonly organization: string | null;
}

// ============================================================================
// Coverage Breakdown Data
// ============================================================================

/**
 * PR coverage metrics grouped by branch.
 */
export interface CoverageByBranch {
  /** Repository name */
  readonly repository: string;
  /** Branch name */
  readonly branch: string;
  /** Total non-merge commits in branch */
  readonly totalCommits: number;
  /** Commits linked to PRs */
  readonly prLinkedCommits: number;
  /** Orphan commits */
  readonly orphanCommits: number;
  /** Coverage percentage for this branch */
  readonly coveragePercentage: number;
}

/**
 * PR coverage metrics grouped by author.
 */
export interface CoverageByAuthor {
  /** Repository name */
  readonly repository: string;
  /** Author login/name */
  readonly author: string;
  /** Total non-merge commits by author */
  readonly totalCommits: number;
  /** Commits linked to PRs */
  readonly prLinkedCommits: number;
  /** Orphan commits */
  readonly orphanCommits: number;
  /** Coverage percentage for this author */
  readonly coveragePercentage: number;
}

/**
 * PR coverage metrics grouped by contributor (full_name).
 */
export interface CoverageByContributor {
  /** Repository name */
  readonly repository: string;
  /** Contributor name (full_name or fallback to login) */
  readonly contributorName: string;
  /** Original Git login */
  readonly login: string;
  /** Total non-merge commits */
  readonly totalCommits: number;
  /** Commits linked to PRs */
  readonly prLinkedCommits: number;
  /** Orphan commits */
  readonly orphanCommits: number;
  /** Coverage percentage */
  readonly coveragePercentage: number;
}

/**
 * PR coverage metrics grouped by team.
 */
export interface CoverageByTeam {
  /** Repository name */
  readonly repository: string;
  /** Team name */
  readonly teamName: string;
  /** Number of contributors in team */
  readonly contributorCount: number;
  /** Total non-merge commits */
  readonly totalCommits: number;
  /** Commits linked to PRs */
  readonly prLinkedCommits: number;
  /** Orphan commits */
  readonly orphanCommits: number;
  /** Coverage percentage */
  readonly coveragePercentage: number;
}

// ============================================================================
// Trend Data
// ============================================================================

/**
 * Weekly coverage trend data point.
 */
export interface WeeklyTrendPoint {
  /** Week start date (ISO string, YYYY-MM-DD) */
  readonly weekStart: string;
  /** Total non-merge commits that week */
  readonly totalCommits: number;
  /** Commits linked to PRs */
  readonly prLinkedCommits: number;
  /** Orphan commits */
  readonly orphanCommits: number;
  /** Coverage percentage for this week */
  readonly coveragePercentage: number;
}

// ============================================================================
// Filter Options
// ============================================================================

/**
 * Filter options for PR coverage queries.
 */
export interface PRCoverageFilters {
  /** Start date for date range filter (YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for date range filter (YYYY-MM-DD) */
  readonly endDate?: string;
  /** Repository name filter */
  readonly repository?: string;
  /** Author name filter */
  readonly author?: string;
  /** Target branches to analyze (supports glob patterns) */
  readonly branches?: readonly string[];
}

// ============================================================================
// Chart Data Containers
// ============================================================================

/**
 * Complete data set for the PR Coverage dashboard.
 */
export interface PRCoverageChartData {
  /** Overall coverage metrics */
  readonly overall: PRCoverageOverall;
  /** Weekly trend data points */
  readonly weeklyTrend: readonly WeeklyTrendPoint[];
  /** Coverage breakdown by author */
  readonly byAuthor: readonly CoverageByAuthor[];
  /** Coverage breakdown by branch */
  readonly byBranch: readonly CoverageByBranch[];
  /** Coverage breakdown by contributor (full_name) */
  readonly byContributor: readonly CoverageByContributor[];
  /** Coverage breakdown by team */
  readonly byTeam: readonly CoverageByTeam[];
  /** Orphan commits list */
  readonly orphanCommits: readonly OrphanCommit[];
  /** Whether data exists */
  readonly hasData: boolean;
  /** Whether the view exists */
  readonly viewExists: boolean;
}

// ============================================================================
// Filter Lists
// ============================================================================

/**
 * Available filter options (populated from database).
 */
export interface PRCoverageFilterOptions {
  /** List of available repositories */
  readonly repositories: readonly string[];
  /** List of available authors */
  readonly authors: readonly string[];
  /** List of available contributors (full_name format) */
  readonly contributors: readonly string[];
  /** List of available branches */
  readonly branches: readonly string[];
}
