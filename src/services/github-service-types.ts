/**
 * TypeScript interfaces for GitHub contributor sync service.
 *
 * Extracted from github-service.ts to keep individual files under
 * the 600-line limit. These interfaces define configuration, result
 * summaries, and intermediate data shapes for the GitHubService class.
 *
 * Ticket: IQS-859
 */

// ============================================================================
// Configuration types
// ============================================================================

/**
 * Configuration for the GitHubService.
 * Composed from VS Code settings and SecretStorage.
 */
export interface GitHubServiceConfig {
  /** GitHub personal access token from SecretStorage. */
  readonly token: string;
  /** GitHub organization name from VS Code settings. */
  readonly organization: string;
}

// ============================================================================
// Sync result types
// ============================================================================

/**
 * Result summary from syncing contributors for a single repository.
 */
export interface SyncContributorsResult {
  /** The repository name that was synced. */
  readonly repoName: string;
  /** Number of new contributors inserted. */
  readonly contributorsInserted: number;
  /** Number of existing contributors updated with additional repo. */
  readonly contributorsUpdated: number;
  /** Number of contributors skipped (already known for this repo). */
  readonly contributorsSkipped: number;
  /** Number of errors encountered. */
  readonly errorCount: number;
  /** Duration of the sync in milliseconds. */
  readonly durationMs: number;
}

/**
 * Result summary from syncing unknown authors.
 */
export interface SyncUnknownAuthorsResult {
  /** The repository name that was checked. */
  readonly repoName: string;
  /** Number of unknown authors inserted. */
  readonly authorsInserted: number;
  /** Number of errors encountered. */
  readonly errorCount: number;
  /** Duration of the sync in milliseconds. */
  readonly durationMs: number;
}

/**
 * Result summary from syncing commit URLs.
 */
export interface SyncCommitUrlsResult {
  /** The repository name that was synced. */
  readonly repoName: string;
  /** Number of commit URLs updated. */
  readonly urlsUpdated: number;
  /** Number of errors encountered. */
  readonly errorCount: number;
  /** Duration of the sync in milliseconds. */
  readonly durationMs: number;
}

/**
 * Combined result from a full GitHub sync for all repos.
 */
export interface GitHubSyncResult {
  /** Per-repo contributor sync results. */
  readonly contributorResults: readonly SyncContributorsResult[];
  /** Per-repo unknown author sync results. */
  readonly unknownAuthorResults: readonly SyncUnknownAuthorsResult[];
  /** Per-repo commit URL sync results. */
  readonly commitUrlResults: readonly SyncCommitUrlsResult[];
  /** Total duration in milliseconds. */
  readonly totalDurationMs: number;
}

// ============================================================================
// Internal types
// ============================================================================

/**
 * Structured GitHub contributor profile data.
 * Intermediate representation between Octokit API response and database row.
 */
export interface GitHubContributor {
  readonly login: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly bio: string | null;
  readonly location: string | null;
  readonly publicRepos: number;
  readonly followers: number;
  readonly following: number;
}
