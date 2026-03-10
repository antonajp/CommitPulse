/**
 * Type definitions for the Commit-Jira Linkage data service.
 * These interfaces map to the database views and tables used by the
 * Linkage webview panel:
 * - commit_history (is_jira_ref flag)
 * - commit_jira table
 * - vw_jira_history_detail
 * - vw_jira_history_assignments
 *
 * Ticket: IQS-870
 */

// ============================================================================
// Linkage Summary Types
// ============================================================================

/**
 * Summary of linked vs unlinked commits.
 * Computed from commit_history.is_jira_ref flag.
 */
export interface LinkageSummary {
  /** Total number of commits analyzed */
  readonly totalCommits: number;
  /** Number of commits linked to at least one Jira issue */
  readonly linkedCommits: number;
  /** Number of commits with no Jira reference */
  readonly unlinkedCommits: number;
  /** Percentage of linked commits (0-100) */
  readonly linkedPercent: number;
  /** Percentage of unlinked commits (0-100) */
  readonly unlinkedPercent: number;
}

// ============================================================================
// Jira Project Distribution Types
// ============================================================================

/**
 * Commit count grouped by Jira project key.
 * Computed from commit_jira.jira_project.
 */
export interface JiraProjectDistribution {
  /** Jira project key (e.g., "PROJ", "FEAT") */
  readonly jiraProject: string;
  /** Number of commits linked to this project */
  readonly commitCount: number;
}

// ============================================================================
// Jira Status Flow Types
// ============================================================================

/**
 * Status transition data point from vw_jira_history_detail.
 * Represents Jira issue status changes (e.g., in_dev, in_qa) over time.
 */
export interface JiraStatusFlowPoint {
  /** Date of the status change (ISO date string) */
  readonly changeDate: string;
  /** The status transitioned to */
  readonly toStatus: string;
  /** Number of issues transitioning to this status on this date */
  readonly issueCount: number;
}

// ============================================================================
// Assignment History Types
// ============================================================================

/**
 * Assignment change record from vw_jira_history_assignments.
 * Tracks Jira issue reassignment events over time.
 */
export interface AssignmentHistoryEntry {
  /** Jira issue key (e.g., "PROJ-123") */
  readonly jiraKey: string;
  /** Date of the assignment change (ISO date string) */
  readonly changeDate: string;
  /** Name of the assignee after the change */
  readonly assignedTo: string;
  /** Name of the previous assignee (empty if first assignment) */
  readonly assignedFrom: string;
}

// ============================================================================
// Unlinked Commit Types
// ============================================================================

/**
 * An unlinked commit entry for drill-down display.
 * Shows commits that have no Jira reference.
 */
export interface UnlinkedCommitEntry {
  /** Git commit SHA (abbreviated) */
  readonly sha: string;
  /** Author login */
  readonly author: string;
  /** Commit message */
  readonly commitMessage: string;
  /** Commit date (ISO date string) */
  readonly commitDate: string;
  /** Repository name */
  readonly repository: string;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Linkage view filter parameters.
 * All filters are optional and combined with AND logic.
 */
export interface LinkageFilters {
  /** Start date for date range filter (ISO date string) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string) */
  readonly endDate?: string;
  /** Filter by team name */
  readonly team?: string;
  /** Filter by repository name */
  readonly repository?: string;
  /** Filter by Jira project key (also used for Linear project keys). */
  readonly jiraProject?: string;
  /** Tracker type context for conditional queries. Ticket: IQS-876. */
  readonly trackerType?: 'jira' | 'linear';
}

/**
 * Available filter options derived from the database.
 * Used to populate filter dropdowns in the webview.
 */
export interface LinkageFilterOptions {
  /** List of available team names */
  readonly teams: readonly string[];
  /** List of available repository names */
  readonly repositories: readonly string[];
  /** List of available Jira project keys */
  readonly jiraProjects: readonly string[];
}
