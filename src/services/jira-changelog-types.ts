/**
 * Type definitions for JiraChangelogService results.
 *
 * Separated from jira-changelog-service.ts for modularity (600-line limit).
 *
 * Ticket: IQS-857
 */

// ============================================================================
// Result types
// ============================================================================

/**
 * Result summary from extracting changelog entries for a single issue.
 */
export interface ChangelogResult {
  /** The Jira issue key. */
  readonly jiraKey: string;
  /** Number of status changes extracted. */
  readonly statusChanges: number;
  /** Number of assignee changes extracted. */
  readonly assigneeChanges: number;
  /** Total changelog entries extracted. */
  readonly totalEntries: number;
}

/**
 * Result summary from fetching GitHub dev status for a single issue.
 */
export interface GitHubDevStatusResult {
  /** The Jira issue key. */
  readonly jiraKey: string;
  /** Number of new branches saved. */
  readonly branchesSaved: number;
  /** Number of new pull requests saved. */
  readonly prsSaved: number;
  /** Number of branches skipped (already known). */
  readonly branchesSkipped: number;
  /** Number of PRs skipped (already known). */
  readonly prsSkipped: number;
}

/**
 * Result summary from updating unfinished issues.
 */
export interface UpdateUnfinishedResult {
  /** Number of issues successfully processed. */
  readonly issuesProcessed: number;
  /** Number of issues that failed to process. */
  readonly issuesFailed: number;
  /** Total changelog history entries inserted. */
  readonly totalHistoryEntries: number;
  /** Total GitHub branches saved. */
  readonly totalBranchesSaved: number;
  /** Total GitHub pull requests saved. */
  readonly totalPrsSaved: number;
  /** Duration of the update operation in milliseconds. */
  readonly durationMs: number;
}
