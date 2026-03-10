/**
 * Repository class for the commit_linear database table.
 *
 * Provides methods for inserting and querying commit-to-Linear relationships.
 * Parallel to CommitJiraRepository with parameterized SQL queries.
 *
 * Ticket: IQS-875
 */

import type { PoolClient } from 'pg';
import { DatabaseService, type DatabaseQueryResult } from './database-service.js';
import { LoggerService } from '../logging/logger.js';
import type { CommitLinearRow } from './linear-types.js';
import type { AuthorUnlinkedCommit, CommitMessageForJiraRef } from './commit-types.js';

// Re-export types for convenience
export type { CommitLinearRow } from './linear-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'CommitLinearRepository';

// ============================================================================
// SQL Constants - all parameterized, zero string interpolation
// ============================================================================

const SQL_INSERT_COMMIT_LINEAR = `
  INSERT INTO commit_linear (sha, linear_key, author, linear_project)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (sha, linear_key) DO NOTHING
`;

const SQL_DELETE_AUTHOR_COMMIT_LINEAR = `
  DELETE FROM commit_linear WHERE author = $1
`;

const SQL_GET_DISTINCT_LINEAR_KEYS = `
  SELECT DISTINCT linear_key FROM commit_linear
`;

const SQL_GET_COMMIT_MSG_FOR_LINEAR_REF = `
  SELECT sha, commit_message
  FROM commit_history
  WHERE author = $1 AND is_linear_ref IS NULL
`;

const SQL_GET_COMMIT_MSG_FOR_LINEAR_REF_REFRESH = `
  SELECT sha, commit_message
  FROM commit_history
  WHERE author = $1
`;

const SQL_GET_AUTHOR_UNLINKED_COMMITS_LINEAR = `
  SELECT ch.sha, ch.commit_message, ch.branch
  FROM commit_history ch
  WHERE NOT EXISTS (
    SELECT 1 FROM commit_linear cl WHERE ch.sha = cl.sha
  )
  AND ch.author = $1
`;

const SQL_GET_AUTHOR_UNLINKED_COMMITS_LINEAR_REFRESH = `
  SELECT ch.sha, ch.commit_message, ch.branch
  FROM commit_history ch
  WHERE ch.author = $1
`;

const SQL_UPDATE_IS_LINEAR_REF = `
  UPDATE commit_history SET is_linear_ref = $2
  WHERE sha = $1
`;

// ============================================================================
// CommitLinearRepository implementation
// ============================================================================

/**
 * Repository class for the commit_linear database table.
 *
 * Provides methods for inserting and querying commit-to-Linear relationships,
 * including Linear key detection from commit messages and author unlinked commits.
 * All queries use parameterized SQL ($1, $2 placeholders).
 *
 * Ticket: IQS-875
 */
export class CommitLinearRepository {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'CommitLinearRepository created');
  }

  // --------------------------------------------------------------------------
  // Insert methods
  // --------------------------------------------------------------------------

  /**
   * Batch insert commit_linear rows within a transaction.
   * Uses ON CONFLICT DO NOTHING for idempotency.
   *
   * @param rows - Array of commit-linear relationship rows to insert
   */
  async insertCommitLinear(rows: readonly CommitLinearRow[]): Promise<void> {
    if (rows.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertCommitLinear', 'No commit-linear rows to insert');
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertCommitLinear', `Inserting ${rows.length} commit-linear relationships`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const row of rows) {
        await client.query(SQL_INSERT_COMMIT_LINEAR, [
          row.sha, row.linearKey, row.author, row.linearProject,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertCommitLinear', `${rows.length} commit-linear relationships inserted`);
  }

  /**
   * Delete all commit_linear entries for a specific author.
   * Used before re-processing an author's commit-linear relationships.
   *
   * @param author - The author login to delete entries for
   * @returns Number of rows deleted
   */
  async deleteAuthorCommitLinear(author: string): Promise<number> {
    this.logger.debug(CLASS_NAME, 'deleteAuthorCommitLinear', `Deleting entries for author: ${author}`);

    const result = await this.db.query(SQL_DELETE_AUTHOR_COMMIT_LINEAR, [author]);

    this.logger.debug(CLASS_NAME, 'deleteAuthorCommitLinear', `Deleted ${result.rowCount} entries for: ${author}`);
    return result.rowCount;
  }

  // --------------------------------------------------------------------------
  // Query methods
  // --------------------------------------------------------------------------

  /**
   * Get distinct Linear keys from the commit_linear table.
   */
  async getDistinctLinearKeys(): Promise<Set<string>> {
    this.logger.debug(CLASS_NAME, 'getDistinctLinearKeys', 'Querying distinct Linear keys');

    const result: DatabaseQueryResult<{ linear_key: string }> =
      await this.db.query(SQL_GET_DISTINCT_LINEAR_KEYS);

    const keys = new Set<string>();
    for (const row of result.rows) {
      keys.add(row.linear_key);
    }

    this.logger.debug(CLASS_NAME, 'getDistinctLinearKeys', `Found ${keys.size} distinct Linear keys`);
    return keys;
  }

  /**
   * Get commit messages for Linear reference detection.
   * When refresh=false, returns only commits where is_linear_ref IS NULL.
   * When refresh=true, returns all commits for the author.
   */
  async getCommitMsgForLinearRef(author: string, refresh = false): Promise<CommitMessageForJiraRef[]> {
    this.logger.debug(CLASS_NAME, 'getCommitMsgForLinearRef', `Querying for: ${author} (refresh=${refresh})`);

    const sql = refresh ? SQL_GET_COMMIT_MSG_FOR_LINEAR_REF_REFRESH : SQL_GET_COMMIT_MSG_FOR_LINEAR_REF;
    const result: DatabaseQueryResult<{ sha: string; commit_message: string }> =
      await this.db.query(sql, [author]);

    const messages: CommitMessageForJiraRef[] = result.rows.map((row) => ({
      sha: row.sha,
      commitMessage: row.commit_message,
    }));

    this.logger.debug(CLASS_NAME, 'getCommitMsgForLinearRef', `Found ${messages.length} commits`);
    return messages;
  }

  /**
   * Get unlinked commits for a specific author (no commit_linear link).
   * When combine=true, appends branch name to message with "_" separator.
   */
  async getAuthorUnlinkedCommits(
    author: string, refresh = false, combine = false,
  ): Promise<AuthorUnlinkedCommit[]> {
    this.logger.debug(CLASS_NAME, 'getAuthorUnlinkedCommits', `Querying for: ${author} (refresh=${refresh})`);

    const sql = refresh ? SQL_GET_AUTHOR_UNLINKED_COMMITS_LINEAR_REFRESH : SQL_GET_AUTHOR_UNLINKED_COMMITS_LINEAR;
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

  /**
   * Batch update is_linear_ref flags within a transaction.
   *
   * @param updates - Array of SHA + isLinearRef pairs
   */
  async batchUpdateIsLinearRef(updates: ReadonlyArray<{ sha: string; isLinearRef: boolean }>): Promise<void> {
    if (updates.length === 0) {
      this.logger.debug(CLASS_NAME, 'batchUpdateIsLinearRef', 'No updates to apply');
      return;
    }

    this.logger.debug(CLASS_NAME, 'batchUpdateIsLinearRef', `Batch updating ${updates.length} is_linear_ref flags`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const update of updates) {
        await client.query(SQL_UPDATE_IS_LINEAR_REF, [update.sha, update.isLinearRef]);
      }
    });

    this.logger.debug(CLASS_NAME, 'batchUpdateIsLinearRef', `Updated ${updates.length} is_linear_ref flags`);
  }
}
