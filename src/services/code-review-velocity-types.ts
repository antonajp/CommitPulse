/**
 * TypeScript interfaces for the Code Review Velocity dashboard data shapes.
 * Defines the data model for PR-level metrics including time to first review,
 * time to merge, review cycles, and size categories.
 *
 * The Code Review Velocity dashboard helps tech leads identify review bottlenecks:
 *   - How long do PRs sit before first review?
 *   - Which repositories have the slowest review cycles?
 *   - Are large PRs taking disproportionately longer?
 *   - Which reviewers are overloaded?
 *
 * Ticket: IQS-899
 */

// ============================================================================
// Code Review Velocity Data Point
// ============================================================================

/**
 * Size category for PRs based on lines changed.
 * Matches the SQL CASE statement in vw_code_review_velocity.
 */
export type PRSizeCategory = 'XS' | 'S' | 'M' | 'L' | 'XL';

/**
 * PR state values from GitHub API.
 */
export type PRState = 'open' | 'closed' | 'merged';

/**
 * Ticket system type for linked tickets.
 */
export type TicketType = 'jira' | 'linear';

/**
 * A single pull request with its velocity metrics.
 * Sourced from the vw_code_review_velocity database view.
 */
export interface CodeReviewMetrics {
  /** Database ID */
  readonly id: number;
  /** Repository in format owner/repo */
  readonly repository: string;
  /** GitHub PR number */
  readonly prNumber: number;
  /** PR title */
  readonly title: string;
  /** PR author (GitHub username) */
  readonly author: string;
  /** PR state: open, closed, merged */
  readonly state: PRState;
  /** When the PR was created (ISO date string) */
  readonly createdAt: string;
  /** When the PR was last updated (ISO date string) */
  readonly updatedAt: string | null;
  /** When the first review was submitted (ISO date string) */
  readonly firstReviewAt: string | null;
  /** When the PR was merged (ISO date string) */
  readonly mergedAt: string | null;
  /** When the PR was closed (ISO date string) */
  readonly closedAt: string | null;
  /** Source branch name */
  readonly headBranch: string | null;
  /** Target branch name */
  readonly baseBranch: string | null;
  /** Lines added */
  readonly additions: number;
  /** Lines deleted */
  readonly deletions: number;
  /** Total lines changed (additions + deletions) */
  readonly locChanged: number;
  /** Number of files changed */
  readonly changedFiles: number;
  /** Count of CHANGES_REQUESTED review events */
  readonly reviewCycles: number;
  /** Extracted ticket ID from branch name */
  readonly linkedTicketId: string | null;
  /** Ticket system: jira or linear */
  readonly linkedTicketType: TicketType | null;
  /** Hours from PR creation to first review */
  readonly hoursToFirstReview: number | null;
  /** Hours from PR creation to merge */
  readonly hoursToMerge: number | null;
  /** Hours from first review to merge */
  readonly hoursReviewToMerge: number | null;
  /** Size category: XS, S, M, L, XL */
  readonly sizeCategory: PRSizeCategory;
  /** GitHub username of the first reviewer */
  readonly firstReviewer: string | null;
}

// ============================================================================
// Aggregated Metrics Types
// ============================================================================

/**
 * Average metrics grouped by repository.
 */
export interface AvgMetricsByRepository {
  /** Repository name */
  readonly repository: string;
  /** Number of PRs in this repository */
  readonly prCount: number;
  /** Average hours to first review */
  readonly avgHoursToFirstReview: number | null;
  /** Average hours to merge */
  readonly avgHoursToMerge: number | null;
  /** Average review cycles */
  readonly avgReviewCycles: number | null;
  /** Average lines changed */
  readonly avgLocChanged: number | null;
}

/**
 * Average metrics grouped by author.
 */
export interface AvgMetricsByAuthor {
  /** PR author (GitHub username) */
  readonly author: string;
  /** Number of PRs by this author */
  readonly prCount: number;
  /** Average hours to first review */
  readonly avgHoursToFirstReview: number | null;
  /** Average hours to merge */
  readonly avgHoursToMerge: number | null;
  /** Average review cycles */
  readonly avgReviewCycles: number | null;
  /** Average lines changed */
  readonly avgLocChanged: number | null;
}

/**
 * Average metrics grouped by size category.
 */
export interface AvgMetricsBySize {
  /** Size category: XS, S, M, L, XL */
  readonly sizeCategory: PRSizeCategory;
  /** Number of PRs in this size category */
  readonly prCount: number;
  /** Average hours to first review */
  readonly avgHoursToFirstReview: number | null;
  /** Average hours to merge */
  readonly avgHoursToMerge: number | null;
  /** Average review cycles */
  readonly avgReviewCycles: number | null;
  /** Average lines changed */
  readonly avgLocChanged: number | null;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Code Review Velocity dashboard.
 * Contains PR velocity data plus metadata for the dashboard UI.
 */
export interface CodeReviewChartData {
  /** Array of PR velocity data points, ordered by created_at descending */
  readonly rows: readonly CodeReviewMetrics[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_code_review_velocity view exists */
  readonly viewExists: boolean;
}

/**
 * PR sync statistics.
 */
export interface PRStats {
  /** Total PRs in the database */
  readonly totalPRs: number;
  /** Number of merged PRs */
  readonly mergedPRs: number;
  /** Number of open PRs */
  readonly openPRs: number;
  /** Number of closed (not merged) PRs */
  readonly closedPRs: number;
  /** Number of PRs with at least one review */
  readonly prsWithReviews: number;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for Code Review Velocity queries.
 * All filters are optional and combined with AND logic.
 */
export interface CodeReviewFilters {
  /** Start date for date range filter (ISO date string YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string YYYY-MM-DD) */
  readonly endDate?: string;
  /** Filter by repository name */
  readonly repository?: string;
  /** Filter by PR author */
  readonly author?: string;
  /** Filter by size category */
  readonly sizeCategory?: PRSizeCategory;
  /** Filter by PR state */
  readonly state?: PRState;
}

/**
 * Maximum allowed length for string filter values (DoS prevention).
 * CWE-20: Improper Input Validation
 */
export const CODE_REVIEW_MAX_FILTER_LENGTH = 200;

// ============================================================================
// GitHub PR Sync Types
// ============================================================================

/**
 * Configuration for GitHub PR sync service.
 */
export interface GitHubPRSyncConfig {
  /** GitHub organization or owner */
  readonly owner: string;
  /** GitHub repository name */
  readonly repo: string;
  /** GitHub personal access token (from SecretStorage) */
  readonly token: string;
  /** How far back to sync PRs (days) */
  readonly syncDaysBack: number;
}

/**
 * Result of syncing PRs for a single repository.
 */
export interface PRSyncResult {
  /** Repository in format owner/repo */
  readonly repository: string;
  /** Number of PRs synced (upserted) */
  readonly prsUpserted: number;
  /** Number of reviews synced */
  readonly reviewsUpserted: number;
  /** Number of errors encountered */
  readonly errorCount: number;
  /** Duration in milliseconds */
  readonly durationMs: number;
}

/**
 * Result of syncing PRs across all repositories.
 */
export interface FullPRSyncResult {
  /** Results for each repository */
  readonly repositoryResults: readonly PRSyncResult[];
  /** Total PRs synced */
  readonly totalPRs: number;
  /** Total reviews synced */
  readonly totalReviews: number;
  /** Total errors */
  readonly totalErrors: number;
  /** Total duration in milliseconds */
  readonly totalDurationMs: number;
}

/**
 * A pull request as returned from the GitHub API.
 * Subset of fields needed for sync.
 */
export interface GitHubPR {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly user: { readonly login: string } | null;
  readonly state: 'open' | 'closed';
  readonly created_at: string;
  readonly updated_at: string;
  readonly merged_at: string | null;
  readonly closed_at: string | null;
  readonly merge_commit_sha: string | null;
  readonly head: { readonly ref: string };
  readonly base: { readonly ref: string };
  readonly additions?: number;
  readonly deletions?: number;
  readonly changed_files?: number;
}

/**
 * A review as returned from the GitHub API.
 */
export interface GitHubReview {
  readonly id: number;
  readonly user: { readonly login: string } | null;
  readonly state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  readonly submitted_at: string | null;
  readonly body: string | null;
}
