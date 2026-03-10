import type { PoolClient } from 'pg';
import { DatabaseService, type DatabaseQueryResult } from './database-service.js';
import { LoggerService } from '../logging/logger.js';
import type {
  PipelineRunStart,
  PipelineLogEntry,
} from './pipeline-types.js';
import type {
  PipelineRunRow,
  PipelineLogRow,
  PipelineTableCountRow,
} from '../providers/pipeline-run-tree-types.js';

// Re-export types so consumers can import from pipeline-repository directly
export type {
  PipelineRunStart,
  PipelineLogEntry,
  PipelineTableCount,
} from './pipeline-types.js';

// Re-export TreeView row types for consumers (IQS-868)
export type {
  PipelineRunRow,
  PipelineLogRow,
  PipelineTableCountRow,
} from '../providers/pipeline-run-tree-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'PipelineRepository';

// ============================================================================
// SQL Constants - all parameterized, zero string interpolation
// ============================================================================

const SQL_INSERT_PIPELINE_START = `
  INSERT INTO gitr_pipeline_run
    (class_name, context, detail, start_time, status)
  VALUES ($1, $2, $3, $4, $5)
  RETURNING id
`;

const SQL_INSERT_PIPELINE_LOG = `
  INSERT INTO gitr_pipeline_log
    (parent_id, class_name, context, detail, msg_level, transaction_date)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id
`;

const SQL_INSERT_PIPELINE_SHA = `
  INSERT INTO gitr_pipeline_sha (pipeline_id, sha)
  VALUES ($1, $2)
  ON CONFLICT (pipeline_id, sha) DO NOTHING
`;

const SQL_INSERT_PIPELINE_JIRA = `
  INSERT INTO gitr_pipeline_jira (pipeline_id, jira_key)
  VALUES ($1, $2)
  ON CONFLICT (pipeline_id, jira_key) DO NOTHING
`;

const SQL_INSERT_PIPELINE_LINEAR = `
  INSERT INTO gitr_pipeline_linear (pipeline_id, linear_key)
  VALUES ($1, $2)
  ON CONFLICT (pipeline_id, linear_key) DO NOTHING
`;

const SQL_UPDATE_PIPELINE_RUN = `
  UPDATE gitr_pipeline_run SET
    end_time = $1,
    status = $2
  WHERE id = $3
`;

/**
 * SQL to count rows in a specified table.
 * IMPORTANT: The table name is validated against a whitelist before use.
 * This is the ONE place where a dynamic table name is required (matching
 * the Python log_table_counts() behavior). We validate the table name
 * against an explicit allowlist to prevent SQL injection.
 */
const SQL_INSERT_TABLE_COUNT = `
  INSERT INTO gitja_pipeline_table_counts
    (gitr_table, row_count, count_date, pipeline_id)
  VALUES ($1, $2, $3, $4)
`;

// ============================================================================
// Read query SQL constants (IQS-868 - Pipeline Runs TreeView)
// ============================================================================

/**
 * Fetch the most recent pipeline runs, ordered by start_time DESC.
 * Limited to $1 rows for the TreeView display.
 */
const SQL_GET_RECENT_PIPELINE_RUNS = `
  SELECT
    id,
    class_name AS "className",
    context,
    detail,
    status,
    start_time AS "startTime",
    end_time AS "endTime"
  FROM gitr_pipeline_run
  ORDER BY start_time DESC
  LIMIT $1
`;

/**
 * Fetch all log entries for a given pipeline run, ordered by transaction_date ASC.
 */
const SQL_GET_PIPELINE_LOG_ENTRIES = `
  SELECT
    id,
    parent_id AS "parentId",
    class_name AS "className",
    context,
    detail,
    msg_level AS "msgLevel",
    transaction_date AS "transactionDate"
  FROM gitr_pipeline_log
  WHERE parent_id = $1
  ORDER BY transaction_date ASC
`;

/**
 * Fetch table counts for a given pipeline run, ordered by table name.
 */
const SQL_GET_PIPELINE_TABLE_COUNTS = `
  SELECT
    gitr_table AS "gitrTable",
    row_count AS "rowCount",
    count_date AS "countDate",
    pipeline_id AS "pipelineId"
  FROM gitja_pipeline_table_counts
  WHERE pipeline_id = $1
  ORDER BY gitr_table ASC
`;

// ============================================================================
// Table name allowlist for log_table_counts
// ============================================================================

/**
 * Allowlist of table and view names that can be counted.
 * This prevents SQL injection through dynamic table names in logTableCounts().
 * Any table not in this list will be skipped with a warning.
 */
const ALLOWED_COUNT_TABLES: ReadonlySet<string> = new Set([
  'commit_history',
  'commit_files',
  'commit_files_types',
  'commit_directory',
  'commit_tags',
  'commit_msg_words',
  'commit_branch_relationship',
  'commit_jira',
  'commit_contributors',
  'jira_detail',
  'jira_history',
  'jira_issue_link',
  'jira_parent',
  'jira_github_branch',
  'jira_github_pullrequest',
  'gitr_pipeline_run',
  'gitr_pipeline_log',
  'gitr_pipeline_sha',
  'gitr_pipeline_jira',
  'gitja_pipeline_table_counts',
  'gitja_team_contributor',
  // Linear tables (IQS-875)
  'linear_detail',
  'linear_history',
  'commit_linear',
  'gitr_pipeline_linear',
  // Views used by GitjaTeamContributor
  'max_num_count_per_login',
  'max_num_count_per_full_name',
  'num_count_per_full_name',
]);

/**
 * Validate a table name against the allowlist.
 * Returns true only if the name is in the whitelist.
 * Also validates that the name matches a safe identifier pattern.
 *
 * @param tableName - The table name to validate
 * @returns true if the table name is allowed
 */
function isAllowedTableName(tableName: string): boolean {
  // Additional guard: ensure name matches safe identifier pattern
  const safePattern = /^[a-z_][a-z0-9_]*$/;
  return ALLOWED_COUNT_TABLES.has(tableName) && safePattern.test(tableName);
}

// ============================================================================
// PipelineRepository implementation
// ============================================================================

/**
 * Repository class for pipeline-related database tables.
 *
 * Provides methods for inserting and updating pipeline run records,
 * log entries, and table count snapshots. Covers gitr_pipeline_run,
 * gitr_pipeline_log, gitr_pipeline_sha, gitr_pipeline_jira, and
 * gitja_pipeline_table_counts tables.
 *
 * Maps from Python PostgresDB.py methods:
 * - insert_gitr_pipeline_start() -> insertPipelineStart()
 * - insert_gitr_pipeline_log() -> insertPipelineLog()
 * - update_gitr_pipeline_run() -> updatePipelineRun()
 * - log_table_counts() -> logTableCounts()
 *
 * CRITICAL: Python used %s placeholders (safe in psycopg).
 * This TypeScript version uses $1, $2 parameterized queries.
 * The dynamic table name in logTableCounts() is validated against
 * an explicit allowlist to prevent SQL injection.
 *
 * Ticket: IQS-853
 */
export class PipelineRepository {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'PipelineRepository created');
  }

  // --------------------------------------------------------------------------
  // Pipeline run methods
  // --------------------------------------------------------------------------

  /**
   * Insert a pipeline run start record and return the generated ID.
   * Maps from Python PostgresDB.py insert_gitr_pipeline_start().
   *
   * @param run - The pipeline run start data
   * @returns The generated pipeline run ID
   */
  async insertPipelineStart(run: PipelineRunStart): Promise<number> {
    this.logger.debug(CLASS_NAME, 'insertPipelineStart', `Starting pipeline: ${run.className}.${run.context}`);

    const now = new Date();
    const result: DatabaseQueryResult<{ id: number }> = await this.db.query(
      SQL_INSERT_PIPELINE_START,
      [run.className, run.context, run.detail, now, run.status],
    );

    if (result.rows.length === 0) {
      this.logger.error(CLASS_NAME, 'insertPipelineStart', 'Failed to get RETURNING id');
      throw new Error('insertPipelineStart: RETURNING id produced no rows');
    }

    const id = result.rows[0]!.id;
    this.logger.info(CLASS_NAME, 'insertPipelineStart', `Pipeline started with id=${id} (${run.className}.${run.context})`);
    return id;
  }

  /**
   * Insert a pipeline log entry and optionally link to SHA/Jira.
   * Maps from Python PostgresDB.py insert_gitr_pipeline_log().
   *
   * @param entry - The log entry data
   * @param sha - Optional SHA to link to this log entry via gitr_pipeline_sha
   * @param jiraKey - Optional Jira key to link via gitr_pipeline_jira
   * @param linearKey - Optional Linear key to link via gitr_pipeline_linear (IQS-875)
   * @returns The generated log entry ID
   */
  async insertPipelineLog(
    entry: PipelineLogEntry,
    sha?: string,
    jiraKey?: string,
    linearKey?: string,
  ): Promise<number> {
    this.logger.trace(CLASS_NAME, 'insertPipelineLog', `Logging: ${entry.className}.${entry.context}`);

    const now = new Date();

    // Use transaction to atomically insert log + optional SHA/Jira links
    const logId = await this.db.transaction(async (client: PoolClient) => {
      const logResult = await client.query<{ id: number }>(
        SQL_INSERT_PIPELINE_LOG,
        [entry.parentId, entry.className, entry.context, entry.detail, entry.msgLevel, now],
      );

      if (logResult.rows.length === 0) {
        throw new Error('insertPipelineLog: RETURNING id produced no rows');
      }

      const id = logResult.rows[0]!.id;

      // Link to SHA if provided
      if (sha !== undefined) {
        this.logger.trace(CLASS_NAME, 'insertPipelineLog', `Linking log ${id} to sha: ${sha.substring(0, 8)}`);
        await client.query(SQL_INSERT_PIPELINE_SHA, [id, sha]);
      }

      // Link to Jira key if provided
      if (jiraKey !== undefined) {
        this.logger.trace(CLASS_NAME, 'insertPipelineLog', `Linking log ${id} to jira: ${jiraKey}`);
        await client.query(SQL_INSERT_PIPELINE_JIRA, [id, jiraKey]);
      }

      // Link to Linear key if provided (IQS-875)
      if (linearKey !== undefined) {
        this.logger.trace(CLASS_NAME, 'insertPipelineLog', `Linking log ${id} to linear: ${linearKey}`);
        await client.query(SQL_INSERT_PIPELINE_LINEAR, [id, linearKey]);
      }

      return id;
    });

    this.logger.trace(CLASS_NAME, 'insertPipelineLog', `Log entry created with id=${logId}`);
    return logId;
  }

  /**
   * Update a pipeline run's end time and status.
   * Maps from Python PostgresDB.py update_gitr_pipeline_run().
   *
   * @param id - The pipeline run ID to update
   * @param status - The new status string
   */
  async updatePipelineRun(id: number, status: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'updatePipelineRun', `Updating pipeline run ${id} to status: ${status}`);

    const now = new Date();
    await this.db.query(SQL_UPDATE_PIPELINE_RUN, [now, status, id]);

    this.logger.info(CLASS_NAME, 'updatePipelineRun', `Pipeline run ${id} updated to: ${status}`);
  }

  // --------------------------------------------------------------------------
  // Table count logging
  // --------------------------------------------------------------------------

  /**
   * Log row counts for a list of tables/views.
   * Maps from Python PostgresDB.py log_table_counts().
   *
   * SECURITY: Table names are validated against an explicit allowlist
   * before being used in SQL. This replaces the Python version which
   * had potential SQL injection via dynamic table names.
   *
   * @param pipelineId - The pipeline run ID to associate counts with
   * @param tableList - Array of table/view names to count
   */
  async logTableCounts(pipelineId: number, tableList: readonly string[]): Promise<void> {
    this.logger.debug(CLASS_NAME, 'logTableCounts', `Counting ${tableList.length} tables for pipeline ${pipelineId}`);

    const now = new Date();

    for (const tableName of tableList) {
      // Validate table name against allowlist
      if (!isAllowedTableName(tableName)) {
        this.logger.warn(CLASS_NAME, 'logTableCounts', `Skipping disallowed table name: ${tableName}`);
        continue;
      }

      try {
        // Safe: tableName is validated against allowlist + regex pattern
        const countResult: DatabaseQueryResult<{ count: string }> =
          await this.db.query(`SELECT COUNT(*)::text AS count FROM ${tableName}`);

        const rowCount = parseInt(countResult.rows[0]?.count ?? '0', 10);

        await this.db.query(SQL_INSERT_TABLE_COUNT, [
          tableName, rowCount, now, pipelineId,
        ]);

        this.logger.trace(CLASS_NAME, 'logTableCounts', `${tableName}: ${rowCount} rows`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(CLASS_NAME, 'logTableCounts', `Failed to count ${tableName}: ${message}`);
        // Continue with next table rather than aborting all counts
      }
    }

    this.logger.debug(CLASS_NAME, 'logTableCounts', `Table counts logged for pipeline ${pipelineId}`);
  }

  // --------------------------------------------------------------------------
  // Read queries for Pipeline Runs TreeView (IQS-868)
  // --------------------------------------------------------------------------

  /**
   * Fetch the most recent pipeline runs for the TreeView.
   * Returns rows ordered by start_time DESC, limited to the specified count.
   *
   * @param limit - Maximum number of runs to return (default 20)
   * @returns Array of PipelineRunRow objects
   */
  async getRecentPipelineRuns(limit: number = 20): Promise<PipelineRunRow[]> {
    this.logger.debug(CLASS_NAME, 'getRecentPipelineRuns', `Fetching up to ${limit} recent pipeline runs`);

    const result: DatabaseQueryResult<PipelineRunRow> = await this.db.query(
      SQL_GET_RECENT_PIPELINE_RUNS,
      [limit],
    );

    this.logger.info(
      CLASS_NAME,
      'getRecentPipelineRuns',
      `Fetched ${result.rows.length} pipeline runs`,
    );

    return result.rows;
  }

  /**
   * Fetch all log entries for a given pipeline run.
   * Returns rows ordered by transaction_date ASC.
   *
   * @param pipelineRunId - The pipeline run ID to fetch logs for
   * @returns Array of PipelineLogRow objects
   */
  async getPipelineLogEntries(pipelineRunId: number): Promise<PipelineLogRow[]> {
    this.logger.debug(
      CLASS_NAME,
      'getPipelineLogEntries',
      `Fetching log entries for pipeline run ${pipelineRunId}`,
    );

    const result: DatabaseQueryResult<PipelineLogRow> = await this.db.query(
      SQL_GET_PIPELINE_LOG_ENTRIES,
      [pipelineRunId],
    );

    this.logger.debug(
      CLASS_NAME,
      'getPipelineLogEntries',
      `Fetched ${result.rows.length} log entries for pipeline run ${pipelineRunId}`,
    );

    return result.rows;
  }

  /**
   * Fetch table count snapshots for a given pipeline run.
   * Returns rows ordered by table name ASC.
   *
   * @param pipelineRunId - The pipeline run ID to fetch counts for
   * @returns Array of PipelineTableCountRow objects
   */
  async getPipelineTableCounts(pipelineRunId: number): Promise<PipelineTableCountRow[]> {
    this.logger.debug(
      CLASS_NAME,
      'getPipelineTableCounts',
      `Fetching table counts for pipeline run ${pipelineRunId}`,
    );

    const result: DatabaseQueryResult<PipelineTableCountRow> = await this.db.query(
      SQL_GET_PIPELINE_TABLE_COUNTS,
      [pipelineRunId],
    );

    this.logger.debug(
      CLASS_NAME,
      'getPipelineTableCounts',
      `Fetched ${result.rows.length} table counts for pipeline run ${pipelineRunId}`,
    );

    return result.rows;
  }

  /**
   * Expose the table name allowlist for testing and validation.
   * Returns a copy to prevent mutation.
   */
  static getAllowedCountTables(): ReadonlySet<string> {
    return ALLOWED_COUNT_TABLES;
  }
}
