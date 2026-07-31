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
// Git Provider Types
// ============================================================================

/**
 * SCM provider type for PR data source.
 */
export type GitProvider = 'github' | 'bitbucket';

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
  /** Repository in format owner/repo or project/repo */
  readonly repository: string;
  /** Number of PRs synced (upserted) */
  readonly prsUpserted: number;
  /** Number of reviews synced */
  readonly reviewsUpserted: number;
  /** Number of errors encountered */
  readonly errorCount: number;
  /** Duration in milliseconds */
  readonly durationMs: number;
  /** Git provider (optional for backward compatibility) */
  readonly provider?: GitProvider;
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

// ============================================================================
// BitBucket PR Sync Types
// ============================================================================

/**
 * BitBucket variant type.
 * Cloud uses API v2.0, Server uses API v1.0 with different response schemas.
 */
export type BitBucketVariant = 'cloud' | 'server';

/**
 * Configuration for BitBucket PR sync service.
 */
export interface BitBucketPRSyncConfig {
  /** BitBucket workspace (Cloud) or project key (Server) */
  readonly workspace: string;
  /** Repository slug */
  readonly repoSlug: string;
  /** BitBucket access token from SecretStorage */
  readonly token: string;
  /** Number of days to sync back */
  readonly syncDaysBack: number;
  /** BitBucket variant: cloud or server */
  readonly variant: BitBucketVariant;
  /** Base URL for Server variant (required if variant='server') */
  readonly serverUrl?: string;
  /** Username for Cloud Basic Auth (required if variant='cloud') */
  readonly username?: string;
}

/**
 * BitBucket PR state values.
 * Note: BitBucket uses uppercase, unlike GitHub's lowercase.
 */
export type BitBucketPRState = 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';

/**
 * A pull request as returned from BitBucket Cloud API v2.0.
 */
export interface BitBucketCloudPR {
  readonly id: number;
  readonly title: string;
  readonly author: {
    readonly display_name: string;
    readonly account_id?: string;
    readonly nickname?: string;
  };
  readonly state: BitBucketPRState;
  readonly created_on: string;
  readonly updated_on: string;
  readonly close_source_branch?: boolean;
  readonly merge_commit?: { readonly hash: string } | null;
  readonly source: {
    readonly branch: { readonly name: string };
    readonly repository?: { readonly full_name: string };
  };
  readonly destination: {
    readonly branch: { readonly name: string };
    readonly repository?: { readonly full_name: string };
  };
  /** BitBucket Cloud provides these in the main PR response */
  readonly comment_count?: number;
  readonly task_count?: number;
}

/**
 * A pull request as returned from BitBucket Server API v1.0.
 */
export interface BitBucketServerPR {
  readonly id: number;
  readonly title: string;
  readonly author: {
    readonly user: {
      readonly displayName: string;
      readonly name: string;
      readonly emailAddress?: string;
    };
  };
  readonly state: BitBucketPRState;
  /** Server uses millisecond timestamps, not ISO strings */
  readonly createdDate: number;
  readonly updatedDate: number;
  readonly closedDate?: number;
  readonly fromRef: {
    readonly displayId: string;
    readonly id: string;
  };
  readonly toRef: {
    readonly displayId: string;
    readonly id: string;
  };
  readonly properties?: {
    readonly mergeCommit?: { readonly id: string };
  };
}

/**
 * Union type for BitBucket PR from either API variant.
 */
export type BitBucketPR = BitBucketCloudPR | BitBucketServerPR;

/**
 * BitBucket Cloud activity item (for review extraction).
 */
export interface BitBucketCloudActivity {
  readonly approval?: {
    readonly date: string;
    readonly user: {
      readonly display_name: string;
      readonly account_id?: string;
    };
  };
  readonly changes_requested?: {
    readonly date: string;
    readonly user: {
      readonly display_name: string;
      readonly account_id?: string;
    };
  };
  readonly comment?: {
    readonly created_on: string;
    readonly user: {
      readonly display_name: string;
    };
    readonly content?: { readonly raw: string };
  };
}

/**
 * BitBucket Server activity item (for review extraction).
 */
export interface BitBucketServerActivity {
  readonly action: 'APPROVED' | 'UNAPPROVED' | 'DECLINED' | 'COMMENTED' | 'OPENED' | 'MERGED';
  readonly createdDate: number;
  readonly user: {
    readonly displayName: string;
    readonly name: string;
  };
  readonly comment?: {
    readonly text: string;
  };
}

/**
 * Result of syncing PRs for a single BitBucket repository.
 * Same structure as PRSyncResult but explicitly typed.
 */
export interface BitBucketPRSyncResult extends PRSyncResult {
  readonly provider: 'bitbucket';
  readonly variant: BitBucketVariant;
}

// ============================================================================
// Provider Detection Types
// ============================================================================

/**
 * Result of parsing a repository URL to detect provider and extract info.
 */
export interface ParsedRepoUrl {
  readonly provider: GitProvider;
  readonly owner: string;
  readonly repo: string;
  /** For BitBucket Server, the base URL */
  readonly serverUrl?: string;
  /** BitBucket variant if applicable */
  readonly variant?: BitBucketVariant;
}

/**
 * URL parsing error when provider cannot be determined.
 */
export interface RepoUrlParseError {
  readonly success: false;
  readonly error: string;
  readonly originalUrl: string;
}

/**
 * Successful URL parse result.
 */
export interface RepoUrlParseSuccess extends ParsedRepoUrl {
  readonly success: true;
}

/**
 * Result type for URL parsing.
 */
export type RepoUrlParseResult = RepoUrlParseSuccess | RepoUrlParseError;
