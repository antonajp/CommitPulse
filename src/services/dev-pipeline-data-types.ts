/**
 * TypeScript interfaces for the Development Pipeline dashboard data shapes.
 * Defines the data model for commit-level delta metrics including
 * complexity, LOC, comments, and test code changes.
 *
 * The Development Pipeline dashboard helps QA teams prioritize testing
 * by showing which commits have the highest impact in terms of code changes.
 *
 * Ticket: IQS-896
 */

// ============================================================================
// Development Pipeline Delta Data Point
// ============================================================================

/**
 * A single commit with its delta metrics relative to merge-base baseline.
 * Sourced from the vw_dev_pipeline_deltas database view.
 */
export interface DevPipelineDeltaPoint {
  /** Git commit SHA (40 character hex) */
  readonly sha: string;
  /** Commit timestamp as ISO date string */
  readonly commitDate: string;
  /** Git author login/username */
  readonly author: string;
  /** Git branch name */
  readonly branch: string | null;
  /** Repository name */
  readonly repository: string | null;
  /** First line of commit message (summary) */
  readonly commitMessageSummary: string | null;
  /** Contributor's full name from commit_contributors */
  readonly fullName: string | null;
  /** Team name from commit_contributors */
  readonly team: string | null;
  /** Primary ticket ID (Linear or Jira key) */
  readonly ticketId: string | null;
  /** Project associated with the ticket */
  readonly ticketProject: string | null;
  /** Ticket system: 'Linear' | 'Jira' | null */
  readonly ticketType: 'Linear' | 'Jira' | null;
  /** Change in cyclomatic complexity vs baseline */
  readonly complexityDelta: number;
  /** Net lines of code change vs baseline */
  readonly locDelta: number;
  /** Change in comment lines vs baseline */
  readonly commentsDelta: number;
  /** LOC change in test files only vs baseline */
  readonly testsDelta: number;
  /** Number of files modified in this commit */
  readonly fileCount: number;
  /** Number of test files modified in this commit */
  readonly testFileCount: number;
  /** The merge-base SHA used for delta calculation */
  readonly baselineSha: string | null;
  /** Total cyclomatic complexity of files in this commit */
  readonly totalComplexity: number;
  /** Total lines of code in files in this commit */
  readonly totalCodeLines: number;
  /** Total comment lines in files in this commit */
  readonly totalCommentLines: number;
}

// ============================================================================
// Aggregated Delta Types
// ============================================================================

/**
 * Aggregated delta metrics grouped by ticket.
 * Shows total impact of all commits associated with a ticket.
 */
export interface DevPipelineDeltaByTicket {
  /** Ticket ID (Linear or Jira key) */
  readonly ticketId: string;
  /** Project associated with the ticket */
  readonly ticketProject: string | null;
  /** Ticket system: 'Linear' | 'Jira' */
  readonly ticketType: 'Linear' | 'Jira' | null;
  /** Team name (from most recent commit) */
  readonly team: string | null;
  /** Repository name (from most recent commit) */
  readonly repository: string | null;
  /** Count of distinct commits for this ticket */
  readonly commitCount: number;
  /** Sum of complexity deltas across all commits */
  readonly totalComplexityDelta: number;
  /** Sum of LOC deltas across all commits */
  readonly totalLocDelta: number;
  /** Sum of comment deltas across all commits */
  readonly totalCommentsDelta: number;
  /** Sum of test LOC deltas across all commits */
  readonly totalTestsDelta: number;
  /** Total file modifications across all commits */
  readonly totalFileCount: number;
  /** Total test file modifications across all commits */
  readonly totalTestFileCount: number;
  /** Earliest commit date for this ticket */
  readonly firstCommitDate: string;
  /** Latest commit date for this ticket */
  readonly lastCommitDate: string;
}

/**
 * Aggregated delta metrics grouped by author.
 * Shows total impact of all commits by a single author.
 */
export interface DevPipelineDeltaByAuthor {
  /** Git author login/username */
  readonly author: string;
  /** Contributor's full name */
  readonly fullName: string | null;
  /** Team name */
  readonly team: string | null;
  /** Count of distinct commits by this author */
  readonly commitCount: number;
  /** Count of distinct tickets touched by this author */
  readonly ticketCount: number;
  /** Sum of complexity deltas across all commits */
  readonly totalComplexityDelta: number;
  /** Sum of LOC deltas across all commits */
  readonly totalLocDelta: number;
  /** Sum of comment deltas across all commits */
  readonly totalCommentsDelta: number;
  /** Sum of test LOC deltas across all commits */
  readonly totalTestsDelta: number;
  /** Total file modifications across all commits */
  readonly totalFileCount: number;
  /** Total test file modifications across all commits */
  readonly totalTestFileCount: number;
  /** Earliest commit date for this author */
  readonly firstCommitDate: string;
  /** Latest commit date for this author */
  readonly lastCommitDate: string;
}

/**
 * Weekly aggregated delta metrics grouped by ISO week and developer.
 * Shows total impact per developer per week.
 */
export interface DevPipelineWeeklyDataPoint {
  /** Start of the ISO week (Monday) as ISO date string */
  readonly weekStart: string;
  /** Git author login/username */
  readonly author: string;
  /** Contributor's full name */
  readonly fullName: string | null;
  /** Team name */
  readonly team: string | null;
  /** Sum of LOC deltas for the week */
  readonly totalLocDelta: number;
  /** Sum of complexity deltas for the week */
  readonly totalComplexityDelta: number;
  /** Sum of comment deltas for the week */
  readonly totalCommentsDelta: number;
  /** Sum of test LOC deltas for the week */
  readonly totalTestsDelta: number;
  /** Total comment lines across all commits in the week */
  readonly totalCommentLines: number;
  /** Total code lines across all commits in the week */
  readonly totalCodeLines: number;
  /** Number of commits in the week */
  readonly commitCount: number;
  /** Comments ratio: (totalCommentLines / totalCodeLines) * 100 */
  readonly commentsRatio: number;
  /** Latest commit SHA of the week (for GitHub navigation) */
  readonly latestSha: string | null;
  /** Repository URL (e.g., https://github.com/owner/repo) for GitHub commit navigation */
  readonly repoUrl: string | null;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Development Pipeline dashboard.
 * Contains commit delta data plus metadata for the dashboard UI.
 */
export interface DevPipelineChartData {
  /** Array of commit delta data points, ordered by commit date descending */
  readonly rows: readonly DevPipelineDeltaPoint[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_dev_pipeline_deltas view exists */
  readonly viewExists: boolean;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for Development Pipeline queries.
 * All filters are optional and combined with AND logic.
 */
export interface DevPipelineFilters {
  /** Start date for date range filter (ISO date string YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string YYYY-MM-DD) */
  readonly endDate?: string;
  /** Filter by team name */
  readonly team?: string;
  /** Filter by repository name */
  readonly repository?: string;
  /** Filter by ticket ID (Linear or Jira key) */
  readonly ticketId?: string;
}

/**
 * Maximum allowed length for string filter values (DoS prevention).
 * CWE-20: Improper Input Validation
 */
export const DEV_PIPELINE_MAX_FILTER_LENGTH = 200;
