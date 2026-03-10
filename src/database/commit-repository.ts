import type { PoolClient } from 'pg';
import { DatabaseService, type DatabaseQueryResult } from './database-service.js';
import { LoggerService } from '../logging/logger.js';
import type {
  CommitHistoryRow,
  CommitFileRow,
  CommitFileTypeRow,
  CommitDirectoryRow,
  CommitTagRow,
  CommitWordRow,
  AuthorCount,
  RepoDate,
  ShaBranch,
  CommitFileMetrics,
  FileMetricsDelta,
} from './commit-types.js';
import type { SccFileMetrics } from '../services/scc-metrics-service.js';
import type { ArcComponentFileRow } from '../services/arc-component-backfill-service.js';

// Re-export types so consumers can import from commit-repository directly
export type {
  CommitHistoryRow,
  CommitFileRow,
  CommitFileTypeRow,
  CommitDirectoryRow,
  CommitTagRow,
  CommitWordRow,
  AuthorCount,
  RepoDate,
  ShaBranch,
  CommitFileMetrics,
  FileMetricsDelta,
} from './commit-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'CommitRepository';

// ============================================================================
// SQL Constants - all parameterized, zero string interpolation
// ============================================================================

const SQL_INSERT_COMMIT_HISTORY = `
  INSERT INTO commit_history
    (sha, url, branch, repository, repository_url, author,
     commit_date, commit_message, file_count, lines_added,
     lines_removed, is_merge, is_jira_ref, organization)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  ON CONFLICT (sha) DO NOTHING
`;

const SQL_INSERT_COMMIT_FILE = `
  INSERT INTO commit_files
    (sha, filename, file_extension, line_inserts, line_deletes, line_diff,
     total_lines, total_code_lines, total_comment_lines,
     complexity, weighted_complexity, author,
     parent_directory, sub_directory, is_test_file,
     complexity_change, comments_change, code_change)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
  ON CONFLICT (sha, filename) DO NOTHING
`;

const SQL_INSERT_COMMIT_FILE_TYPE = `
  INSERT INTO commit_files_types
    (sha, file_extension, num_count, author, parent_directory, sub_directory)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (sha, file_extension, parent_directory, sub_directory) DO NOTHING
`;

const SQL_INSERT_COMMIT_DIRECTORY = `
  INSERT INTO commit_directory
    (sha, directory, subdirectory, author)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (sha, directory, subdirectory) DO NOTHING
`;

const SQL_INSERT_COMMIT_BRANCH_RELATIONSHIP = `
  INSERT INTO commit_branch_relationship
    (sha, branch, author, commit_date)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (sha, branch) DO NOTHING
`;

const SQL_INSERT_COMMIT_TAG = `
  INSERT INTO commit_tags
    (sha, tag, author)
  VALUES ($1, $2, $3)
`;

const SQL_INSERT_COMMIT_WORD = `
  INSERT INTO commit_msg_words
    (sha, word, author)
  VALUES ($1, $2, $3)
`;

const SQL_GET_KNOWN_SHAS_FOR_REPO = `
  SELECT DISTINCT sha FROM commit_history WHERE repository = $1
`;

const SQL_GET_KNOWN_COMMIT_BRANCH_RELATIONSHIPS = `
  SELECT ch.sha AS sha, COALESCE(cbr.branch, 'N-O-B-R-A-N-C-H') AS branch
  FROM commit_history ch
  LEFT JOIN commit_branch_relationship cbr ON ch.sha = cbr.sha
  WHERE ch.repository = $1
`;

const SQL_GET_UNLINKED_COMMITS = `
  SELECT ch.sha, ch.commit_message
  FROM commit_history ch
  WHERE NOT EXISTS (
    SELECT 1 FROM commit_jira cj WHERE ch.sha = cj.sha
  )
`;

const SQL_GET_ALL_COMMITS = `
  SELECT ch.sha, ch.commit_message FROM commit_history ch
`;

const SQL_IDENTIFY_UNKNOWN_COMMIT_AUTHORS = `
  SELECT ch.author, ch.repository, COUNT(*)::int AS cnt
  FROM commit_history ch
  WHERE NOT EXISTS (
    SELECT 1 FROM commit_contributors cc WHERE ch.author = cc.login
  )
  AND ch.repository = $1
  GROUP BY ch.author, ch.repository
  ORDER BY ch.author
`;

const SQL_IDENTIFY_GIT_REPO_MAX_COMMIT_DATE = `
  SELECT repository, MAX(commit_date) AS mcd
  FROM commit_history
  GROUP BY repository
  ORDER BY mcd ASC
`;

const SQL_GET_COMMIT_FILE_BASE_METRICS = `
  SELECT cf.sha, ch.commit_date, cf.filename, cf.complexity,
         cf.total_comment_lines, cf.total_code_lines
  FROM commit_files cf
  INNER JOIN commit_history ch ON ch.sha = cf.sha
  WHERE cf.filename = $1
  ORDER BY ch.commit_date ASC
`;

const SQL_GET_UNIQUE_FILES_SINCE = `
  SELECT cf.filename, COUNT(*)::int AS cnt
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  WHERE ch.commit_date >= $1::timestamp
  GROUP BY cf.filename
  HAVING COUNT(*) > 1
`;

const SQL_UPDATE_IS_JIRA_REF = `
  UPDATE commit_history SET is_jira_ref = $2
  WHERE sha = $1
`;

const SQL_GET_COMMIT_CONTRIBUTORS = `
  SELECT DISTINCT author FROM commit_history
`;

const SQL_FIND_SHAS_WITHOUT_URL = `
  SELECT sha FROM commit_history
  WHERE (url IS NULL OR url = '')
  AND repository = $1
`;

const SQL_UPDATE_COMMIT_URL = `
  UPDATE commit_history SET url = $2
  WHERE sha = $1
`;

const SQL_UPDATE_FILE_METRICS_DELTAS = `
  UPDATE commit_files SET complexity_change = $1, comments_change = $2, code_change = $3
  WHERE sha = $4 AND filename = $5
`;

const SQL_GET_SHAS_NEEDING_SCC_BACKFILL = `
  SELECT DISTINCT cf.sha, ch.repository
  FROM commit_files cf
  INNER JOIN commit_history ch ON cf.sha = ch.sha
  WHERE cf.total_lines = 0 AND cf.total_code_lines = 0
    AND cf.total_comment_lines = 0 AND cf.complexity = 0
    AND cf.weighted_complexity = 0
  ORDER BY ch.repository, cf.sha
`;

const SQL_GET_COMMIT_FILE_PATHS_FOR_SHA = `
  SELECT filename FROM commit_files WHERE sha = $1
`;

const SQL_UPDATE_COMMIT_FILE_SCC_METRICS = `
  UPDATE commit_files
  SET total_lines = $1, total_code_lines = $2, total_comment_lines = $3,
      complexity = $4, weighted_complexity = $5
  WHERE sha = $6 AND filename = $7
`;

const SQL_GET_FILES_FOR_ARC_COMPONENT_NULL = `
  SELECT sha, filename, file_extension, arc_component
  FROM commit_files
  WHERE arc_component IS NULL
  ORDER BY sha, filename
`;

const SQL_GET_FILES_FOR_ARC_COMPONENT_ALL = `
  SELECT sha, filename, file_extension, arc_component
  FROM commit_files
  ORDER BY sha, filename
`;

const SQL_UPDATE_ARC_COMPONENT = `
  UPDATE commit_files SET arc_component = $1
  WHERE sha = $2 AND filename = $3
`;

// ============================================================================
// CommitRepository implementation
// ============================================================================

/**
 * Repository for commit-related database tables. All queries use parameterized
 * placeholders ($1, $2) -- zero string interpolation. Ticket: IQS-852
 */
export class CommitRepository {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'CommitRepository created');
  }

  /**
   * Insert a single commit_history row.
   * Maps from Python GitCommitHistorySql.write_commit_to_file().
   * Uses ON CONFLICT DO NOTHING for idempotency.
   *
   * @param commit - The commit data to insert
   */
  async insertCommitHistory(commit: CommitHistoryRow): Promise<void> {
    this.logger.debug(CLASS_NAME, 'insertCommitHistory', `Inserting commit: ${commit.sha.substring(0, 8)}`);

    await this.db.query(SQL_INSERT_COMMIT_HISTORY, [
      commit.sha,
      commit.url,
      commit.branch,
      commit.repository,
      commit.repositoryUrl,
      commit.author,
      commit.commitDate,
      commit.commitMessage,
      commit.fileCount,
      commit.linesAdded,
      commit.linesRemoved,
      commit.isMerge,
      commit.isJiraRef,
      commit.organization,
    ]);

    this.logger.trace(CLASS_NAME, 'insertCommitHistory', `Commit ${commit.sha.substring(0, 8)} inserted`);
  }

  /**
   * Batch insert commit_files rows within a transaction.
   * Maps from Python GitCommitHistorySql.write_details_to_sql().
   * Uses ON CONFLICT DO NOTHING for idempotency.
   *
   * @param sha - The commit SHA (used for logging context)
   * @param files - Array of file rows to insert
   */
  async insertCommitFiles(sha: string, files: readonly CommitFileRow[]): Promise<void> {
    if (files.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertCommitFiles', `No files to insert for ${sha.substring(0, 8)}`);
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertCommitFiles', `Inserting ${files.length} files for commit ${sha.substring(0, 8)}`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const file of files) {
        await client.query(SQL_INSERT_COMMIT_FILE, [
          file.sha, file.filename, file.fileExtension,
          file.lineInserts, file.lineDeletes, file.lineDiff,
          file.totalLines, file.totalCodeLines, file.totalCommentLines,
          file.complexity, file.weightedComplexity, file.author,
          file.parentDirectory, file.subDirectory, file.isTestFile,
          file.complexityChange, file.commentsChange, file.codeChange,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertCommitFiles', `${files.length} files inserted for ${sha.substring(0, 8)}`);
  }

  /**
   * Batch insert commit_files_types rows within a transaction.
   * Maps from Python GitCommitHistorySql.write_file_types_to_sql().
   * Uses ON CONFLICT DO NOTHING for idempotency.
   *
   * @param sha - The commit SHA (used for logging context)
   * @param types - Array of file type rows to insert
   */
  async insertCommitFileTypes(sha: string, types: readonly CommitFileTypeRow[]): Promise<void> {
    if (types.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertCommitFileTypes', `No file types to insert for ${sha.substring(0, 8)}`);
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertCommitFileTypes', `Inserting ${types.length} file types for commit ${sha.substring(0, 8)}`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const ft of types) {
        await client.query(SQL_INSERT_COMMIT_FILE_TYPE, [
          ft.sha, ft.fileExtension, ft.numCount,
          ft.author, ft.parentDirectory, ft.subDirectory,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertCommitFileTypes', `${types.length} file types inserted for ${sha.substring(0, 8)}`);
  }

  /**
   * Batch insert commit_directory rows within a transaction.
   * Maps from Python GitCommitHistorySql.write_directories_to_sql().
   * Uses ON CONFLICT DO NOTHING for idempotency.
   *
   * @param sha - The commit SHA (used for logging context)
   * @param dirs - Array of directory rows to insert
   */
  async insertCommitDirectories(sha: string, dirs: readonly CommitDirectoryRow[]): Promise<void> {
    if (dirs.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertCommitDirectories', `No directories to insert for ${sha.substring(0, 8)}`);
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertCommitDirectories', `Inserting ${dirs.length} directories for commit ${sha.substring(0, 8)}`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const dir of dirs) {
        await client.query(SQL_INSERT_COMMIT_DIRECTORY, [
          dir.sha, dir.directory, dir.subdirectory, dir.author,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertCommitDirectories', `${dirs.length} directories inserted for ${sha.substring(0, 8)}`);
  }

  /**
   * Insert a commit_branch_relationship row.
   * Maps from Python GitCommitHistorySql._write_commit_branch_relationship().
   * Uses ON CONFLICT DO NOTHING for idempotency.
   */
  async insertCommitBranchRelationship(
    sha: string, branch: string, author: string, commitDate: Date,
  ): Promise<void> {
    this.logger.debug(CLASS_NAME, 'insertCommitBranchRelationship', `Inserting: ${sha.substring(0, 8)} -> ${branch}`);

    await this.db.query(SQL_INSERT_COMMIT_BRANCH_RELATIONSHIP, [sha, branch, author, commitDate]);

    this.logger.trace(CLASS_NAME, 'insertCommitBranchRelationship', `Inserted: ${sha.substring(0, 8)} -> ${branch}`);
  }

  /**
   * Batch insert commit_tags rows within a transaction.
   * Maps from Python GitCommitHistorySql.write_commit_tags_to_file().
   */
  async insertCommitTags(sha: string, tags: readonly CommitTagRow[]): Promise<void> {
    if (tags.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertCommitTags', `No tags to insert for ${sha.substring(0, 8)}`);
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertCommitTags', `Inserting ${tags.length} tags for commit ${sha.substring(0, 8)}`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const tag of tags) {
        await client.query(SQL_INSERT_COMMIT_TAG, [tag.sha, tag.tag, tag.author]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertCommitTags', `${tags.length} tags inserted for ${sha.substring(0, 8)}`);
  }

  /**
   * Batch insert commit_msg_words rows within a transaction.
   * Maps from Python GitCommitHistorySql.write_commit_words_to_file().
   */
  async insertCommitWords(sha: string, words: readonly CommitWordRow[]): Promise<void> {
    if (words.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertCommitWords', `No words to insert for ${sha.substring(0, 8)}`);
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertCommitWords', `Inserting ${words.length} words for commit ${sha.substring(0, 8)}`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const word of words) {
        await client.query(SQL_INSERT_COMMIT_WORD, [word.sha, word.word, word.author]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertCommitWords', `${words.length} words inserted for ${sha.substring(0, 8)}`);
  }

  /**
   * Batch update is_jira_ref flags within a transaction.
   * Maps from Python GitjaDataEnhancer.identify_commit_msg_jira_ref().
   * Ticket: IQS-861
   */
  async batchUpdateIsJiraRef(updates: ReadonlyArray<{ sha: string; isJiraRef: boolean }>): Promise<void> {
    if (updates.length === 0) {
      this.logger.debug(CLASS_NAME, 'batchUpdateIsJiraRef', 'No updates to apply');
      return;
    }

    this.logger.debug(CLASS_NAME, 'batchUpdateIsJiraRef', `Batch updating ${updates.length} is_jira_ref flags`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const update of updates) {
        await client.query(SQL_UPDATE_IS_JIRA_REF, [update.sha, update.isJiraRef]);
      }
    });

    this.logger.debug(CLASS_NAME, 'batchUpdateIsJiraRef', `Updated ${updates.length} is_jira_ref flags`);
  }

  /**
   * Batch update file metrics deltas (complexity_change, comments_change, code_change)
   * in commit_files within a transaction. Parameterized queries. Ticket: IQS-863
   */
  async batchUpdateFileMetricsDeltas(deltas: readonly FileMetricsDelta[]): Promise<void> {
    if (deltas.length === 0) {
      this.logger.debug(CLASS_NAME, 'batchUpdateFileMetricsDeltas', 'No deltas to apply');
      return;
    }
    this.logger.debug(CLASS_NAME, 'batchUpdateFileMetricsDeltas', `Batch updating ${deltas.length} file metrics deltas`);
    await this.db.transaction(async (client: PoolClient) => {
      for (const delta of deltas) {
        await client.query(SQL_UPDATE_FILE_METRICS_DELTAS, [
          delta.complexityChange, delta.commentsChange, delta.codeChange,
          delta.sha, delta.filename,
        ]);
        this.logger.trace(CLASS_NAME, 'batchUpdateFileMetricsDeltas', `Updated: sha=${delta.sha.substring(0, 8)} file=${delta.filename}`);
      }
    });
    this.logger.debug(CLASS_NAME, 'batchUpdateFileMetricsDeltas', `Updated ${deltas.length} file metrics deltas`);
  }

  /**
   * Get distinct commit authors from commit_history.
   * Used by DataEnhancerService. Ticket: IQS-861
   */
  async getCommitContributorLogins(): Promise<string[]> {
    this.logger.debug(CLASS_NAME, 'getCommitContributorLogins', 'Querying distinct commit authors');

    const result: DatabaseQueryResult<{ author: string }> =
      await this.db.query(SQL_GET_COMMIT_CONTRIBUTORS);

    const authors = result.rows.map((row) => row.author);

    this.logger.debug(CLASS_NAME, 'getCommitContributorLogins', `Found ${authors.length} distinct authors`);
    return authors;
  }

  /**
   * Find commit SHAs without a GitHub URL for a repository.
   * Maps from Python GitHubRelate.py _find_shas_without_url(). Ticket: IQS-859
   */
  async findShasWithoutUrl(repo: string): Promise<string[]> {
    this.logger.debug(CLASS_NAME, 'findShasWithoutUrl', `Querying SHAs without URL for repo: ${repo}`);

    const result: DatabaseQueryResult<{ sha: string }> =
      await this.db.query(SQL_FIND_SHAS_WITHOUT_URL, [repo]);

    const shas = result.rows.map((row) => row.sha);

    this.logger.debug(CLASS_NAME, 'findShasWithoutUrl', `Found ${shas.length} SHAs without URL`);
    return shas;
  }

  /**
   * Update a commit's URL field. Uses parameterized query ($1, $2).
   * Maps from Python GitHubRelate.py _get_commit_url(). Ticket: IQS-859
   */
  async updateCommitUrl(sha: string, url: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'updateCommitUrl', `Updating URL for ${sha.substring(0, 8)}`);

    await this.db.query(SQL_UPDATE_COMMIT_URL, [sha, url]);

    this.logger.trace(CLASS_NAME, 'updateCommitUrl', `URL updated for ${sha.substring(0, 8)}`);
  }

  /**
   * Get the set of known commit SHAs for a given repository.
   * Maps from Python PostgresDB.py identify_known_sha_for_repo().
   */
  async getKnownShasForRepo(repo: string): Promise<Set<string>> {
    this.logger.debug(CLASS_NAME, 'getKnownShasForRepo', `Querying known SHAs for repo: ${repo}`);

    const result: DatabaseQueryResult<{ sha: string }> = await this.db.query(
      SQL_GET_KNOWN_SHAS_FOR_REPO, [repo],
    );

    const shas = new Set<string>();
    for (const row of result.rows) {
      shas.add(row.sha);
    }

    this.logger.debug(CLASS_NAME, 'getKnownShasForRepo', `Found ${shas.size} known SHAs for repo: ${repo}`);
    return shas;
  }

  /**
   * Get known commit-to-branch relationships for a given repository.
   * Maps from Python PostgresDB.py get_known_commit_branch_relationships().
   * Uses 'N-O-B-R-A-N-C-H' sentinel when no branch exists.
   */
  async getKnownCommitBranchRelationships(repo: string): Promise<Map<string, string[]>> {
    this.logger.debug(CLASS_NAME, 'getKnownCommitBranchRelationships', `Querying for repo: ${repo}`);

    const result: DatabaseQueryResult<ShaBranch> = await this.db.query(
      SQL_GET_KNOWN_COMMIT_BRANCH_RELATIONSHIPS, [repo],
    );

    const relationships = new Map<string, string[]>();
    for (const row of result.rows) {
      const existing = relationships.get(row.sha);
      if (existing) {
        existing.push(row.branch);
      } else {
        relationships.set(row.sha, [row.branch]);
      }
    }

    this.logger.debug(CLASS_NAME, 'getKnownCommitBranchRelationships', `Found ${relationships.size} relationships`);
    return relationships;
  }

  /**
   * Get commits that have no Jira link (unlinked).
   * Maps from Python PostgresDB.py get_unlinked_commits().
   * When refresh=true, returns ALL commits for re-processing.
   */
  async getUnlinkedCommits(refresh = false): Promise<Map<string, string>> {
    this.logger.debug(CLASS_NAME, 'getUnlinkedCommits', `Querying (refresh=${refresh})`);

    const sql = refresh ? SQL_GET_ALL_COMMITS : SQL_GET_UNLINKED_COMMITS;
    const result: DatabaseQueryResult<{ sha: string; commit_message: string }> =
      await this.db.query(sql);

    const commits = new Map<string, string>();
    for (const row of result.rows) {
      commits.set(row.sha, row.commit_message);
    }

    this.logger.debug(CLASS_NAME, 'getUnlinkedCommits', `Found ${commits.size} commits`);
    return commits;
  }

  /**
   * Identify commit authors not in the commit_contributors table.
   * Maps from Python PostgresDB.py identify_unknown_commit_authors().
   */
  async identifyUnknownCommitAuthors(repo: string): Promise<AuthorCount[]> {
    this.logger.debug(CLASS_NAME, 'identifyUnknownCommitAuthors', `Querying for repo: ${repo}`);

    const result: DatabaseQueryResult<{ author: string; repository: string; cnt: number }> =
      await this.db.query(SQL_IDENTIFY_UNKNOWN_COMMIT_AUTHORS, [repo]);

    const authors: AuthorCount[] = result.rows.map((row) => ({
      author: row.author, repo: row.repository, count: row.cnt,
    }));

    this.logger.debug(CLASS_NAME, 'identifyUnknownCommitAuthors', `Found ${authors.length} unknown authors`);
    return authors;
  }

  /**
   * Get the maximum commit date for each repository.
   * Maps from Python PostgresDB.py identify_git_repo_max_commit_date().
   */
  async identifyGitRepoMaxCommitDate(): Promise<RepoDate[]> {
    this.logger.debug(CLASS_NAME, 'identifyGitRepoMaxCommitDate', 'Querying max commit dates');

    const result: DatabaseQueryResult<{ repository: string; mcd: Date }> =
      await this.db.query(SQL_IDENTIFY_GIT_REPO_MAX_COMMIT_DATE);

    const repos: RepoDate[] = result.rows.map((row) => ({
      repo: row.repository, maxDate: row.mcd,
    }));

    this.logger.debug(CLASS_NAME, 'identifyGitRepoMaxCommitDate', `Found ${repos.length} repositories`);
    return repos;
  }

  /**
   * Get file-level metrics for a specific file across all commits.
   * Maps from Python PostgresDB.py get_commit_file_base_metrics_for_file().
   */
  async getCommitFileBaseMetrics(filename: string): Promise<CommitFileMetrics[]> {
    this.logger.debug(CLASS_NAME, 'getCommitFileBaseMetrics', `Querying metrics for: ${filename}`);

    const result: DatabaseQueryResult<{
      sha: string; commit_date: Date; filename: string;
      complexity: number; total_comment_lines: number; total_code_lines: number;
    }> = await this.db.query(SQL_GET_COMMIT_FILE_BASE_METRICS, [filename]);

    const metrics: CommitFileMetrics[] = result.rows.map((row) => ({
      sha: row.sha, commitDate: row.commit_date, filename: row.filename,
      complexity: row.complexity, totalCommentLines: row.total_comment_lines,
      totalCodeLines: row.total_code_lines,
    }));

    this.logger.debug(CLASS_NAME, 'getCommitFileBaseMetrics', `Found ${metrics.length} entries`);
    return metrics;
  }

  /**
   * Get unique list of files modified since a given date.
   * Maps from Python PostgresDB.py get_unique_list_of_files().
   * Only returns files with more than one commit.
   */
  async getUniqueFilesModifiedSince(sinceDate: string): Promise<string[]> {
    this.logger.debug(CLASS_NAME, 'getUniqueFilesModifiedSince', `Querying since: ${sinceDate}`);

    const result: DatabaseQueryResult<{ filename: string; cnt: number }> =
      await this.db.query(SQL_GET_UNIQUE_FILES_SINCE, [sinceDate]);

    const files = result.rows.map((row) => row.filename);

    this.logger.debug(CLASS_NAME, 'getUniqueFilesModifiedSince', `Found ${files.length} files`);
    return files;
  }

  /**
   * Get commit SHAs where all 5 scc columns are zero (needing backfill).
   * Returns distinct SHA + repository pairs ordered by repository then SHA.
   * Ticket: IQS-882
   */
  async getShasNeedingSccBackfill(): Promise<Array<{ sha: string; repository: string }>> {
    this.logger.debug(CLASS_NAME, 'getShasNeedingSccBackfill', 'Querying SHAs needing scc backfill');

    const result: DatabaseQueryResult<{ sha: string; repository: string }> =
      await this.db.query(SQL_GET_SHAS_NEEDING_SCC_BACKFILL);

    this.logger.debug(CLASS_NAME, 'getShasNeedingSccBackfill', `Found ${result.rows.length} SHAs needing backfill`);
    return result.rows;
  }

  /**
   * Get file paths for a specific commit SHA from commit_files.
   * Used by the backfill command to know which files to run scc on.
   * Ticket: IQS-882
   */
  async getCommitFilePathsForSha(sha: string): Promise<string[]> {
    this.logger.debug(CLASS_NAME, 'getCommitFilePathsForSha', `Querying file paths for ${sha.substring(0, 8)}`);

    const result: DatabaseQueryResult<{ filename: string }> =
      await this.db.query(SQL_GET_COMMIT_FILE_PATHS_FOR_SHA, [sha]);

    const paths = result.rows.map((row) => row.filename);
    this.logger.debug(CLASS_NAME, 'getCommitFilePathsForSha', `Found ${paths.length} files for ${sha.substring(0, 8)}`);
    return paths;
  }

  /**
   * Update scc metrics for all files in a commit within a single transaction.
   * Uses parameterized queries ($1-$7) for security.
   * Returns the number of rows updated.
   * Ticket: IQS-882
   */
  async updateCommitFileSccMetrics(
    sha: string,
    metrics: ReadonlyMap<string, SccFileMetrics>,
  ): Promise<number> {
    if (metrics.size === 0) {
      this.logger.debug(CLASS_NAME, 'updateCommitFileSccMetrics', `No metrics to update for ${sha.substring(0, 8)}`);
      return 0;
    }

    this.logger.debug(CLASS_NAME, 'updateCommitFileSccMetrics', `Updating ${metrics.size} file metrics for ${sha.substring(0, 8)}`);

    let updatedCount = 0;
    await this.db.transaction(async (client: PoolClient) => {
      for (const [filename, m] of metrics) {
        const result = await client.query(SQL_UPDATE_COMMIT_FILE_SCC_METRICS, [
          m.totalLines, m.totalCodeLines, m.totalCommentLines,
          m.complexity, m.weightedComplexity,
          sha, filename,
        ]);
        updatedCount += result.rowCount ?? 0;
        this.logger.trace(CLASS_NAME, 'updateCommitFileSccMetrics', `Updated: sha=${sha.substring(0, 8)} file=${filename}`);
      }
    });

    this.logger.debug(CLASS_NAME, 'updateCommitFileSccMetrics', `Updated ${updatedCount} rows for ${sha.substring(0, 8)}`);

    if (updatedCount < metrics.size) {
      this.logger.warn(CLASS_NAME, 'updateCommitFileSccMetrics', `Expected to update ${metrics.size} files but only updated ${updatedCount} for ${sha.substring(0, 8)}`);
    }

    return updatedCount;
  }

  /**
   * Get commit_files rows needing arc_component classification.
   *
   * When includeAll is false (first run / no mapping change):
   *   Returns only rows where arc_component IS NULL.
   *
   * When includeAll is true (mapping changed):
   *   Returns ALL rows for re-classification.
   *
   * Ticket: IQS-885
   *
   * @param includeAll - If true, return all rows; if false, only NULL arc_component rows
   * @returns Array of file rows for classification
   */
  async getFilesForArcComponentBackfill(includeAll: boolean): Promise<ArcComponentFileRow[]> {
    const methodName = 'getFilesForArcComponentBackfill';
    this.logger.debug(CLASS_NAME, methodName, `Querying files for arc component backfill (includeAll=${includeAll})`);

    const sql = includeAll ? SQL_GET_FILES_FOR_ARC_COMPONENT_ALL : SQL_GET_FILES_FOR_ARC_COMPONENT_NULL;
    const result: DatabaseQueryResult<ArcComponentFileRow> = await this.db.query(sql);

    this.logger.debug(CLASS_NAME, methodName, `Found ${result.rows.length} files for arc component backfill`);
    return result.rows;
  }

  /**
   * Batch update arc_component for commit_files rows within a transaction.
   * Uses parameterized queries ($1, $2, $3) — zero string interpolation.
   * Returns the number of rows updated.
   *
   * Ticket: IQS-885
   *
   * @param updates - Array of { sha, filename, arcComponent } to update
   * @returns Number of rows updated
   */
  async batchUpdateArcComponent(
    updates: ReadonlyArray<{ sha: string; filename: string; arcComponent: string }>,
  ): Promise<number> {
    if (updates.length === 0) {
      this.logger.debug(CLASS_NAME, 'batchUpdateArcComponent', 'No updates to apply');
      return 0;
    }

    this.logger.debug(CLASS_NAME, 'batchUpdateArcComponent', `Batch updating ${updates.length} arc_component values`);

    let updatedCount = 0;
    await this.db.transaction(async (client: PoolClient) => {
      for (const update of updates) {
        const result = await client.query(SQL_UPDATE_ARC_COMPONENT, [
          update.arcComponent,
          update.sha,
          update.filename,
        ]);
        updatedCount += result.rowCount ?? 0;
        this.logger.trace(
          CLASS_NAME,
          'batchUpdateArcComponent',
          `Updated: sha=${update.sha.substring(0, 8)} file=${update.filename} -> ${update.arcComponent}`,
        );
      }
    });

    this.logger.debug(CLASS_NAME, 'batchUpdateArcComponent', `Updated ${updatedCount} rows`);
    return updatedCount;
  }
}
