/**
 * TypeScript interfaces for Jira-related database data shapes.
 *
 * Maps column-by-column from the legacy Python PostgresDB.py and
 * JiraGitHub.py classes. Covers jira_detail, jira_history,
 * jira_issue_link, jira_parent, jira_github_branch, and
 * jira_github_pullrequest tables.
 *
 * Ticket: IQS-853
 */

// ============================================================================
// jira_detail table
// ============================================================================

/**
 * Row shape for upserting into jira_detail table.
 * Maps from JiraApi.py Jira detail processing.
 */
export interface JiraDetailRow {
  readonly jiraId: string;
  readonly jiraKey: string;
  readonly priority: string;
  readonly createdDate: Date;
  readonly url: string;
  readonly summary: string;
  readonly description: string | null;
  readonly reporter: string | null;
  readonly issuetype: string;
  readonly project: string;
  readonly resolution: string | null;
  readonly assignee: string | null;
  readonly status: string;
  readonly fixversion: string | null;
  readonly component: string | null;
  readonly statusChangeDate: Date | null;
  readonly points: number | null;
  readonly calculatedStoryPoints: number | null;
}

// ============================================================================
// jira_history table
// ============================================================================

/**
 * Row shape for inserting into jira_history table.
 * Maps from JiraApi.py Jira history (changelog) processing.
 */
export interface JiraHistoryRow {
  readonly jiraKey: string;
  readonly changeDate: Date;
  readonly assignee: string | null;
  readonly field: string;
  readonly fromValue: string | null;
  readonly toValue: string | null;
}

// ============================================================================
// jira_issue_link table
// ============================================================================

/**
 * Row shape for inserting into jira_issue_link table.
 * Maps from JiraApi.py Jira issue link processing.
 */
export interface JiraIssueLinkRow {
  readonly jiraKey: string;
  readonly linkType: string;
  readonly linkKey: string;
  readonly linkStatus: string | null;
  readonly linkPriority: string | null;
  readonly issueType: string | null;
}

// ============================================================================
// jira_parent table
// ============================================================================

/**
 * Row shape for inserting into jira_parent table.
 * Maps from JiraApi.py Jira parent issue processing.
 */
export interface JiraParentRow {
  readonly jiraKey: string;
  readonly parentKey: string;
  readonly parentSummary: string | null;
  readonly parentType: string | null;
}

// ============================================================================
// jira_github_branch table
// ============================================================================

/**
 * Row shape for inserting into jira_github_branch table.
 * Maps from Python JiraGitHub.py Branch class data.
 */
export interface JiraGitHubBranchRow {
  readonly jiraId: number;
  readonly jiraKey: string;
  readonly branchName: string;
  readonly displayId: string | null;
  readonly lastCommit: string;
  readonly authorDate: Date | null;
  readonly author: string | null;
  readonly branchUrl: string | null;
  readonly pullUrl: string | null;
  readonly commitUrl: string | null;
}

// ============================================================================
// jira_github_pullrequest table
// ============================================================================

/**
 * Row shape for inserting into jira_github_pullrequest table.
 * Maps from Python JiraGitHub.py PullRequest class data.
 */
export interface JiraGitHubPullRequestRow {
  readonly jiraId: number;
  readonly jiraKey: string;
  readonly id: string;
  readonly name: string | null;
  readonly sourceBranch: string | null;
  readonly sourceUrl: string | null;
  readonly destinationBranch: string | null;
  readonly destinationUrl: string | null;
  readonly pullStatus: string | null;
  readonly url: string | null;
  readonly lastUpdate: Date | null;
}

// ============================================================================
// Query result types for Jira operations
// ============================================================================

/**
 * Result shape for identifyJiraProjMaxIssue().
 * Maps from PostgresDB.py identify_jira_proj_max_issue().
 */
export interface JiraProjectMaxIssue {
  readonly jiraKey: string;
  readonly count: number;
}

/**
 * Result shape for getUnfinishedJiraIssues().
 * Maps from PostgresDB.py get_unfinished_jira_issues().
 */
export interface UnfinishedJiraIssue {
  readonly jiraKey: string;
  readonly changeDate: Date;
}

/**
 * Result shape for getUnfinishedJiraIssues2().
 * Maps from PostgresDB.py get_unfinished_jira_issues2().
 */
export interface UnfinishedJiraIssue2 {
  readonly jiraKey: string;
}

/**
 * Result shape for getKnownJiraGithubBranches().
 * Maps from PostgresDB.py get_known_jira_github_branches().
 */
export interface KnownJiraGitHubBranch {
  readonly jiraId: number;
  readonly lastCommit: string;
  readonly branchName: string;
}

/**
 * Result shape for getKnownJiraGithubPRs().
 * Maps from PostgresDB.py get_known_jira_github_pullrequests().
 */
export interface KnownJiraGitHubPR {
  readonly jiraId: number;
  readonly id: string;
}
