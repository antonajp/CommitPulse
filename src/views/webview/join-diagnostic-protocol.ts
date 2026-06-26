/**
 * Message protocol types for Join Diagnostic webview communication.
 * Defines the message types exchanged between the webview and extension host
 * for the Join Diagnostic Tool dashboard.
 *
 * Ticket: GITX-183
 */

/** Summary of contributor alignment status */
export interface ContributorSummary {
  login: string;
  fullName: string;
  jiraName: string | null;
  email: string;
  alignmentStatus: string;
}

/** Jira join match statistics */
export interface JiraMatchStats {
  matchedCount: number;
  matchedStoryPoints: number;
  unmatchedCount: number;
  unmatchedStoryPoints: number;
}

/** Details of an unmatched Jira issue */
export interface UnmatchedIssue {
  jiraKey: string;
  summary: string;
  jiraAssignee: string;
  contributorFullName: string;
  contributorJiraName: string | null;
  storyPoints: number | null;
  status: string;
  mismatchReason: string;
}

/** Orphaned Jira assignee (not in commit_contributors) */
export interface OrphanedAssignee {
  assignee: string;
  issueCount: number;
  totalStoryPoints: number;
}

/** Messages from webview to extension host */
export type JoinDiagnosticWebviewToHost =
  | { type: 'requestDiagnostics'; developer: string }
  | { type: 'requestAllContributors' }
  | { type: 'requestOrphanedAssignees' }
  | { type: 'exportCsv'; data: string; filename: string };

/** Messages from extension host to webview */
export type JoinDiagnosticHostToWebview =
  | { type: 'diagnosticsData'; contributor: ContributorSummary; stats: JiraMatchStats; unmatchedIssues: UnmatchedIssue[] }
  | { type: 'allContributors'; contributors: ContributorSummary[] }
  | { type: 'orphanedAssignees'; assignees: OrphanedAssignee[] }
  | { type: 'error'; message: string; source: string }
  | { type: 'loading'; isLoading: boolean };
