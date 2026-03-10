/**
 * TypeScript interfaces for Linear-related database data shapes.
 *
 * Parallel to jira-types.ts, covering linear_detail, linear_history,
 * commit_linear, and gitr_pipeline_linear tables.
 *
 * Ticket: IQS-875
 */

// ============================================================================
// linear_detail table
// ============================================================================

/**
 * Row shape for upserting into linear_detail table.
 * Maps from Linear SDK Issue type.
 */
export interface LinearDetailRow {
  readonly linearId: string;
  readonly linearKey: string;
  readonly priority: string;
  readonly createdDate: Date;
  readonly url: string;
  readonly title: string;
  readonly description: string | null;
  readonly creator: string | null;
  readonly state: string;
  readonly assignee: string | null;
  readonly project: string | null;
  readonly team: string;
  readonly estimate: number | null;
  readonly statusChangeDate: Date | null;
  readonly completedDate: Date | null;
  readonly calculatedStoryPoints: number | null;
}

// ============================================================================
// linear_history table
// ============================================================================

/**
 * Row shape for inserting into linear_history table.
 * Maps from Linear SDK IssueHistory type.
 */
export interface LinearHistoryRow {
  readonly linearKey: string;
  readonly changeDate: Date;
  readonly actor: string | null;
  readonly field: string;
  readonly fromValue: string | null;
  readonly toValue: string | null;
}

// ============================================================================
// commit_linear table
// ============================================================================

/**
 * Row shape for inserting into commit_linear table.
 * Parallel to CommitJiraRow in commit-types.ts.
 */
export interface CommitLinearRow {
  readonly sha: string;
  readonly linearKey: string;
  readonly author: string;
  readonly linearProject: string;
}

// ============================================================================
// Query result types for Linear operations
// ============================================================================

/**
 * Result shape for identifyLinearTeamMaxIssue().
 * Parallel to JiraProjectMaxIssue in jira-types.ts.
 */
export interface LinearTeamMaxIssue {
  readonly teamKey: string;
  readonly count: number;
}

/**
 * Result shape for getUnfinishedLinearIssues().
 * Parallel to UnfinishedJiraIssue2 in jira-types.ts.
 */
export interface UnfinishedLinearIssue {
  readonly linearKey: string;
}
