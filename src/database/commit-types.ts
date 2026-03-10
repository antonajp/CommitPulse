/**
 * TypeScript interfaces for commit-related database data shapes.
 *
 * Extracted from commit-repository.ts and commit-jira-repository.ts
 * to keep individual files under the 600-line limit. These interfaces
 * map column-by-column from the legacy Python PostgresDB.py and
 * GitCommitHistorySql.py classes.
 *
 * Ticket: IQS-852
 */

// ============================================================================
// commit_history table
// ============================================================================

/**
 * Row shape for inserting into commit_history table.
 * Maps column by column from the legacy Python write_commit_to_file()
 * in GitCommitHistorySql.py.
 */
export interface CommitHistoryRow {
  readonly sha: string;
  readonly url: string;
  readonly branch: string;
  readonly repository: string;
  readonly repositoryUrl: string;
  readonly author: string;
  readonly commitDate: Date;
  readonly commitMessage: string;
  readonly fileCount: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly isMerge: boolean;
  readonly isJiraRef: boolean | null;
  readonly organization: string;
}

// ============================================================================
// commit_files table
// ============================================================================

/**
 * Row shape for inserting into commit_files table.
 * Maps from GitCommitHistorySql.py write_details_to_sql().
 */
export interface CommitFileRow {
  readonly sha: string;
  readonly filename: string;
  readonly fileExtension: string;
  readonly lineInserts: number;
  readonly lineDeletes: number;
  readonly lineDiff: number;
  readonly totalLines: number;
  readonly totalCodeLines: number;
  readonly totalCommentLines: number;
  readonly complexity: number;
  readonly weightedComplexity: number;
  readonly author: string;
  readonly parentDirectory: string;
  readonly subDirectory: string;
  readonly isTestFile: boolean;
  readonly complexityChange: number | null;
  readonly commentsChange: number | null;
  readonly codeChange: number | null;
}

// ============================================================================
// commit_files_types table
// ============================================================================

/**
 * Row shape for inserting into commit_files_types table.
 * Maps from GitCommitHistorySql.py write_file_types_to_sql().
 */
export interface CommitFileTypeRow {
  readonly sha: string;
  readonly fileExtension: string;
  readonly numCount: number;
  readonly author: string;
  readonly parentDirectory: string;
  readonly subDirectory: string;
}

// ============================================================================
// commit_directory table
// ============================================================================

/**
 * Row shape for inserting into commit_directory table.
 * Maps from GitCommitHistorySql.py write_directories_to_sql().
 */
export interface CommitDirectoryRow {
  readonly sha: string;
  readonly directory: string;
  readonly subdirectory: string;
  readonly author: string;
}

// ============================================================================
// commit_branch_relationship table
// ============================================================================

/**
 * Row shape for inserting into commit_branch_relationship table.
 * Maps from GitCommitHistorySql.py _write_commit_branch_relationship().
 */
export interface CommitBranchRelationshipRow {
  readonly sha: string;
  readonly branch: string;
  readonly author: string;
  readonly commitDate: Date;
}

// ============================================================================
// commit_tags table
// ============================================================================

/**
 * Row shape for inserting into commit_tags table.
 * Maps from GitCommitHistorySql.py write_commit_tags_to_file().
 */
export interface CommitTagRow {
  readonly sha: string;
  readonly tag: string;
  readonly author: string;
}

// ============================================================================
// commit_msg_words table
// ============================================================================

/**
 * Row shape for inserting into commit_msg_words table.
 * Maps from GitCommitHistorySql.py write_commit_words_to_file().
 */
export interface CommitWordRow {
  readonly sha: string;
  readonly word: string;
  readonly author: string;
}

// ============================================================================
// commit_jira table
// ============================================================================

/**
 * Row shape for inserting into commit_jira table.
 * Maps from Python PostgresDB.py get_sha_jira_insert_stmt().
 */
export interface CommitJiraRow {
  readonly sha: string;
  readonly jiraKey: string;
  readonly author: string;
  readonly jiraProject: string;
}

// ============================================================================
// Query result types
// ============================================================================

/**
 * Result shape for identifyUnknownCommitAuthors().
 * Maps from PostgresDB.py identify_unknown_commit_authors().
 */
export interface AuthorCount {
  readonly author: string;
  readonly repo: string;
  readonly count: number;
}

/**
 * Result shape for identifyGitRepoMaxCommitDate().
 * Maps from PostgresDB.py identify_git_repo_max_commit_date().
 */
export interface RepoDate {
  readonly repo: string;
  readonly maxDate: Date;
}

/**
 * Result shape for getKnownCommitBranchRelationships().
 * Maps from PostgresDB.py get_known_commit_branch_relationships().
 * Returns a Map<sha, branch[]> where 'N-O-B-R-A-N-C-H' is used
 * when no branch relationship exists (matches Python COALESCE).
 */
export interface ShaBranch {
  readonly sha: string;
  readonly branch: string;
}

/**
 * Result shape for getCommitFileBaseMetrics().
 * Maps from PostgresDB.py get_commit_file_base_metrics_for_file().
 */
export interface CommitFileMetrics {
  readonly sha: string;
  readonly commitDate: Date;
  readonly filename: string;
  readonly complexity: number;
  readonly totalCommentLines: number;
  readonly totalCodeLines: number;
}

/**
 * Delta values for file metrics (complexity, comments, code) between consecutive commits.
 * Maps from Python GitjaDataEnhancer._calculate_complexity_comments_code_change() output.
 * Used by FileMetricsDeltaService and CommitRepository.batchUpdateFileMetricsDeltas().
 * Ticket: IQS-863
 */
export interface FileMetricsDelta {
  readonly sha: string;
  readonly filename: string;
  readonly complexityChange: number;
  readonly commentsChange: number;
  readonly codeChange: number;
}

/**
 * Result shape for commit messages with branch info for an author.
 * Maps from PostgresDB.py get_commit_msg_branch_for_author().
 */
export interface CommitMessageBranch {
  readonly commitMessage: string;
  readonly branch: string;
}

/**
 * Result shape for commit messages for Jira ref detection.
 * Maps from PostgresDB.py get_commit_msg_for_jira_ref().
 */
export interface CommitMessageForJiraRef {
  readonly sha: string;
  readonly commitMessage: string;
}

/**
 * Result shape for commit messages with branch for Jira relationship.
 * Maps from PostgresDB.py get_commit_msg_for_jira_relationship().
 */
export interface CommitMessageForJiraRelationship {
  readonly sha: string;
  readonly commitMessage: string;
  readonly branch: string;
}

/**
 * Result shape for author unlinked commits.
 * Maps from PostgresDB.py get_author_unlinked_commits().
 */
export interface AuthorUnlinkedCommit {
  readonly author: string;
  readonly sha: string;
  readonly msg: string;
}
