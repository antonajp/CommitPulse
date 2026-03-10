import type { PoolClient } from 'pg';
import { DatabaseService, type DatabaseQueryResult } from './database-service.js';
import { LoggerService } from '../logging/logger.js';
import type {
  CommitJiraRow,
  CommitMessageBranch,
  CommitMessageForJiraRef,
  CommitMessageForJiraRelationship,
  AuthorUnlinkedCommit,
} from './commit-types.js';

// Re-export types so consumers can import from commit-jira-repository directly
export type {
  CommitJiraRow,
  CommitMessageBranch,
  CommitMessageForJiraRef,
  CommitMessageForJiraRelationship,
  AuthorUnlinkedCommit,
} from './commit-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'CommitJiraRepository';

// ============================================================================
// SQL Constants - all parameterized, zero string interpolation
// ============================================================================

const SQL_INSERT_COMMIT_JIRA = `
  INSERT INTO commit_jira (sha, jira_key, author, jira_project)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (sha, jira_key) DO NOTHING
`;

const SQL_DELETE_AUTHOR_COMMIT_JIRA = `
  DELETE FROM commit_jira WHERE author = $1
`;

const SQL_GET_DISTINCT_JIRA_KEYS = `
  SELECT DISTINCT jira_key FROM commit_jira
`;

const SQL_GET_COMMIT_MSG_BRANCH_FOR_AUTHOR = `
  SELECT commit_message, branch
  FROM commit_history
  WHERE author = $1 AND is_merge = false
`;

const SQL_GET_COMMIT_MSG_FOR_JIRA_REF = `
  SELECT sha, commit_message
  FROM commit_history
  WHERE author = $1 AND is_jira_ref IS NULL
`;

const SQL_GET_COMMIT_MSG_FOR_JIRA_REF_REFRESH = `
  SELECT sha, commit_message
  FROM commit_history
  WHERE author = $1
`;

const SQL_GET_COMMIT_MSG_FOR_JIRA_RELATIONSHIP = `
  SELECT sha, commit_message, branch
  FROM commit_history
  WHERE author = $1
`;

const SQL_GET_AUTHOR_UNLINKED_COMMITS = `
  SELECT ch.sha, ch.commit_message, ch.branch
  FROM commit_history ch
  WHERE NOT EXISTS (
    SELECT 1 FROM commit_jira cj WHERE ch.sha = cj.sha
  )
  AND ch.author = $1
`;

const SQL_GET_AUTHOR_UNLINKED_COMMITS_REFRESH = `
  SELECT ch.sha, ch.commit_message, ch.branch
  FROM commit_history ch
  WHERE ch.author = $1
`;

// ============================================================================
// CommitJiraRepository implementation
// ============================================================================

/**
 * Repository class for the commit_jira database table.
 *
 * Provides methods for inserting and querying commit-to-Jira relationships,
 * including Jira key detection from commit messages, author unlinked commits,
 * and commit message queries for Jira reference processing.
 *
 * Maps from Python PostgresDB.py methods with CRITICAL difference:
 * Python used f-string SQL (SQL injection risk via author param).
 * This TypeScript version uses ONLY parameterized queries.
 *
 * Ticket: IQS-852
 */
export class CommitJiraRepository {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'CommitJiraRepository created');
  }

  // --------------------------------------------------------------------------
  // Insert methods
  // --------------------------------------------------------------------------

  /**
   * Batch insert commit_jira rows within a transaction.
   * Uses ON CONFLICT DO NOTHING for idempotency.
   *
   * @param rows - Array of commit-jira relationship rows to insert
   */
  async insertCommitJira(rows: readonly CommitJiraRow[]): Promise<void> {
    if (rows.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertCommitJira', 'No commit-jira rows to insert');
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertCommitJira', `Inserting ${rows.length} commit-jira relationships`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const row of rows) {
        await client.query(SQL_INSERT_COMMIT_JIRA, [
          row.sha, row.jiraKey, row.author, row.jiraProject,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertCommitJira', `${rows.length} commit-jira relationships inserted`);
  }

  /**
   * Delete all commit_jira entries for a specific author.
   * Maps from Python PostgresDB.py delete_author_commit_jira().
   * Used before re-processing an author's commit-jira relationships.
   *
   * @param author - The author login to delete entries for
   * @returns Number of rows deleted
   */
  async deleteAuthorCommitJira(author: string): Promise<number> {
    this.logger.debug(CLASS_NAME, 'deleteAuthorCommitJira', `Deleting entries for author: ${author}`);

    const result = await this.db.query(SQL_DELETE_AUTHOR_COMMIT_JIRA, [author]);

    this.logger.debug(CLASS_NAME, 'deleteAuthorCommitJira', `Deleted ${result.rowCount} entries for: ${author}`);
    return result.rowCount;
  }

  // --------------------------------------------------------------------------
  // Query methods
  // --------------------------------------------------------------------------

  /**
   * Get distinct Jira keys from the commit_jira table.
   * Maps from Python PostgresDB.py get_distinct_jira_keys().
   */
  async getDistinctJiraKeys(): Promise<Set<string>> {
    this.logger.debug(CLASS_NAME, 'getDistinctJiraKeys', 'Querying distinct Jira keys');

    const result: DatabaseQueryResult<{ jira_key: string }> =
      await this.db.query(SQL_GET_DISTINCT_JIRA_KEYS);

    const keys = new Set<string>();
    for (const row of result.rows) {
      keys.add(row.jira_key);
    }

    this.logger.debug(CLASS_NAME, 'getDistinctJiraKeys', `Found ${keys.size} distinct Jira keys`);
    return keys;
  }

  /**
   * Get commit messages and branches for an author (non-merge commits).
   * Maps from Python PostgresDB.py get_commit_msg_branch_for_author().
   */
  async getCommitMsgBranchForAuthor(author: string): Promise<CommitMessageBranch[]> {
    this.logger.debug(CLASS_NAME, 'getCommitMsgBranchForAuthor', `Querying for author: ${author}`);

    const result: DatabaseQueryResult<{ commit_message: string; branch: string }> =
      await this.db.query(SQL_GET_COMMIT_MSG_BRANCH_FOR_AUTHOR, [author]);

    const messages: CommitMessageBranch[] = result.rows.map((row) => ({
      commitMessage: row.commit_message,
      branch: row.branch,
    }));

    this.logger.debug(CLASS_NAME, 'getCommitMsgBranchForAuthor', `Found ${messages.length} messages`);
    return messages;
  }

  /**
   * Get commit messages for Jira reference detection.
   * Maps from Python PostgresDB.py get_commit_msg_for_jira_ref().
   * When refresh=false, returns only commits where is_jira_ref IS NULL.
   * When refresh=true, returns all commits for the author.
   */
  async getCommitMsgForJiraRef(author: string, refresh = false): Promise<CommitMessageForJiraRef[]> {
    this.logger.debug(CLASS_NAME, 'getCommitMsgForJiraRef', `Querying for: ${author} (refresh=${refresh})`);

    const sql = refresh ? SQL_GET_COMMIT_MSG_FOR_JIRA_REF_REFRESH : SQL_GET_COMMIT_MSG_FOR_JIRA_REF;
    const result: DatabaseQueryResult<{ sha: string; commit_message: string }> =
      await this.db.query(sql, [author]);

    const messages: CommitMessageForJiraRef[] = result.rows.map((row) => ({
      sha: row.sha,
      commitMessage: row.commit_message,
    }));

    this.logger.debug(CLASS_NAME, 'getCommitMsgForJiraRef', `Found ${messages.length} commits`);
    return messages;
  }

  /**
   * Get commit messages with branch for Jira relationship linking.
   * Maps from Python PostgresDB.py get_commit_msg_for_jira_relationship().
   */
  async getCommitMsgForJiraRelationship(author: string): Promise<CommitMessageForJiraRelationship[]> {
    this.logger.debug(CLASS_NAME, 'getCommitMsgForJiraRelationship', `Querying for: ${author}`);

    const result: DatabaseQueryResult<{ sha: string; commit_message: string; branch: string }> =
      await this.db.query(SQL_GET_COMMIT_MSG_FOR_JIRA_RELATIONSHIP, [author]);

    const messages: CommitMessageForJiraRelationship[] = result.rows.map((row) => ({
      sha: row.sha,
      commitMessage: row.commit_message,
      branch: row.branch,
    }));

    this.logger.debug(CLASS_NAME, 'getCommitMsgForJiraRelationship', `Found ${messages.length} commits`);
    return messages;
  }

  /**
   * Get unlinked commits for a specific author.
   * Maps from Python PostgresDB.py get_author_unlinked_commits().
   * When combine=true, appends branch name to message with "_" separator.
   */
  async getAuthorUnlinkedCommits(
    author: string, refresh = false, combine = false,
  ): Promise<AuthorUnlinkedCommit[]> {
    this.logger.debug(CLASS_NAME, 'getAuthorUnlinkedCommits', `Querying for: ${author} (refresh=${refresh})`);

    const sql = refresh ? SQL_GET_AUTHOR_UNLINKED_COMMITS_REFRESH : SQL_GET_AUTHOR_UNLINKED_COMMITS;
    const result: DatabaseQueryResult<{ sha: string; commit_message: string; branch: string }> =
      await this.db.query(sql, [author]);

    const commits: AuthorUnlinkedCommit[] = result.rows.map((row) => ({
      author,
      sha: row.sha,
      msg: combine ? `${row.commit_message}_${row.branch}` : row.commit_message,
    }));

    this.logger.debug(CLASS_NAME, 'getAuthorUnlinkedCommits', `Found ${commits.length} commits`);
    return commits;
  }
}
