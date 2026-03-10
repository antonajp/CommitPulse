/**
 * Repository class for Linear-related database tables.
 *
 * Provides methods for inserting and querying linear_detail and
 * linear_history tables. Parallel to JiraRepository with
 * parameterized SQL queries only ($1, $2 placeholders).
 *
 * Ticket: IQS-875
 */

import type { PoolClient } from 'pg';
import { DatabaseService, type DatabaseQueryResult } from './database-service.js';
import { LoggerService } from '../logging/logger.js';
import type {
  LinearDetailRow,
  LinearHistoryRow,
  LinearTeamMaxIssue,
  UnfinishedLinearIssue,
} from './linear-types.js';

// Re-export types for convenience
export type {
  LinearDetailRow,
  LinearHistoryRow,
  LinearTeamMaxIssue,
  UnfinishedLinearIssue,
} from './linear-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'LinearRepository';

// ============================================================================
// SQL Constants - all parameterized, zero string interpolation
// ============================================================================

const SQL_UPSERT_LINEAR_DETAIL = `
  INSERT INTO linear_detail
    (linear_id, linear_key, priority, created_date, url, title, description,
     creator, state, assignee, project, team, estimate,
     status_change_date, completed_date)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  ON CONFLICT (linear_key) DO UPDATE SET
    linear_id = EXCLUDED.linear_id,
    priority = EXCLUDED.priority,
    url = EXCLUDED.url,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    creator = EXCLUDED.creator,
    state = EXCLUDED.state,
    assignee = EXCLUDED.assignee,
    project = EXCLUDED.project,
    team = EXCLUDED.team,
    estimate = EXCLUDED.estimate,
    status_change_date = EXCLUDED.status_change_date,
    completed_date = EXCLUDED.completed_date
`;

const SQL_INSERT_LINEAR_HISTORY = `
  INSERT INTO linear_history
    (linear_key, change_date, actor, field, from_value, to_value)
  VALUES ($1, $2, $3, $4, $5, $6)
`;

const SQL_DELETE_LINEAR_HISTORY_FOR_KEY = `
  DELETE FROM linear_history WHERE linear_key = $1
`;

const SQL_GET_DISTINCT_LINEAR_KEYS = `
  SELECT DISTINCT linear_key FROM linear_detail
`;

const SQL_IDENTIFY_LINEAR_TEAM_MAX_ISSUE = `
  SELECT split_part(linear_key, '-', 1) AS team_key,
         MAX(CAST(split_part(linear_key, '-', 2) AS INTEGER)) AS count
  FROM linear_detail
  GROUP BY 1
  ORDER BY count DESC
`;

const SQL_GET_UNFINISHED_LINEAR_ISSUES = `
  SELECT linear_key
  FROM linear_detail
  WHERE NOT state IN ('Done', 'Canceled', 'Cancelled', 'Duplicate')
  UNION
  SELECT linear_key
  FROM linear_detail
  WHERE state IN ('Done', 'Canceled', 'Cancelled', 'Duplicate')
  AND status_change_date >= CURRENT_DATE - $1::int
  ORDER BY linear_key
`;

const SQL_GET_LINEAR_ISSUES_NEEDING_STORY_POINTS_BACKFILL = `
  SELECT linear_key, created_date,
         COALESCE(completed_date, status_change_date) AS end_date
  FROM linear_detail
  WHERE calculated_story_points IS NULL
  AND (completed_date IS NOT NULL OR status_change_date IS NOT NULL)
`;

const SQL_UPDATE_LINEAR_CALCULATED_STORY_POINTS = `
  UPDATE linear_detail
  SET calculated_story_points = $1
  WHERE linear_key = $2
`;

// ============================================================================
// LinearRepository implementation
// ============================================================================

/**
 * Repository class for Linear-related database tables.
 *
 * Provides methods for inserting and querying linear_detail and
 * linear_history tables. All queries use parameterized SQL ($1, $2
 * placeholders) -- zero string interpolation.
 *
 * Parallel to JiraRepository with Linear-specific field mappings.
 *
 * Ticket: IQS-875
 */
export class LinearRepository {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'LinearRepository created');
  }

  // --------------------------------------------------------------------------
  // Insert / Upsert methods
  // --------------------------------------------------------------------------

  /**
   * Upsert a single linear_detail row.
   * Uses ON CONFLICT to update existing records by linear_key.
   *
   * @param detail - The Linear detail data to upsert
   */
  async upsertLinearDetail(detail: LinearDetailRow): Promise<void> {
    this.logger.debug(CLASS_NAME, 'upsertLinearDetail', `Upserting: ${detail.linearKey}`);

    await this.db.query(SQL_UPSERT_LINEAR_DETAIL, [
      detail.linearId,
      detail.linearKey,
      detail.priority,
      detail.createdDate,
      detail.url,
      detail.title,
      detail.description,
      detail.creator,
      detail.state,
      detail.assignee,
      detail.project,
      detail.team,
      detail.estimate,
      detail.statusChangeDate,
      detail.completedDate,
    ]);

    this.logger.trace(CLASS_NAME, 'upsertLinearDetail', `Upserted: ${detail.linearKey}`);
  }

  /**
   * Batch upsert linear_detail rows within a transaction.
   *
   * @param details - Array of Linear detail rows to upsert
   */
  async batchUpsertLinearDetails(details: readonly LinearDetailRow[]): Promise<void> {
    if (details.length === 0) {
      this.logger.debug(CLASS_NAME, 'batchUpsertLinearDetails', 'No details to upsert');
      return;
    }

    this.logger.debug(CLASS_NAME, 'batchUpsertLinearDetails', `Upserting ${details.length} Linear details`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const detail of details) {
        await client.query(SQL_UPSERT_LINEAR_DETAIL, [
          detail.linearId, detail.linearKey, detail.priority, detail.createdDate,
          detail.url, detail.title, detail.description, detail.creator,
          detail.state, detail.assignee, detail.project, detail.team,
          detail.estimate, detail.statusChangeDate, detail.completedDate,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'batchUpsertLinearDetails', `${details.length} details upserted`);
  }

  /**
   * Replace Linear history rows for a specific key.
   * Deletes existing history first, then batch inserts in a transaction.
   *
   * @param linearKey - The Linear key whose history is being replaced
   * @param history - Array of history rows to insert
   */
  async replaceLinearHistory(linearKey: string, history: readonly LinearHistoryRow[]): Promise<void> {
    this.logger.debug(CLASS_NAME, 'replaceLinearHistory', `Replacing ${history.length} history entries for: ${linearKey}`);

    await this.db.transaction(async (client: PoolClient) => {
      await client.query(SQL_DELETE_LINEAR_HISTORY_FOR_KEY, [linearKey]);
      for (const row of history) {
        await client.query(SQL_INSERT_LINEAR_HISTORY, [
          row.linearKey, row.changeDate, row.actor,
          row.field, row.fromValue, row.toValue,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'replaceLinearHistory', `History replaced for: ${linearKey}`);
  }

  // --------------------------------------------------------------------------
  // Query methods
  // --------------------------------------------------------------------------

  /**
   * Get distinct Linear keys from the linear_detail table.
   */
  async getDistinctLinearIds(): Promise<Set<string>> {
    this.logger.debug(CLASS_NAME, 'getDistinctLinearIds', 'Querying distinct keys from linear_detail');

    const result: DatabaseQueryResult<{ linear_key: string }> =
      await this.db.query(SQL_GET_DISTINCT_LINEAR_KEYS);

    const keys = new Set<string>();
    for (const row of result.rows) {
      keys.add(row.linear_key);
    }

    this.logger.debug(CLASS_NAME, 'getDistinctLinearIds', `Found ${keys.size} distinct keys`);
    return keys;
  }

  /**
   * Identify the maximum issue number per Linear team prefix.
   * Parallel to JiraRepository.identifyJiraProjMaxIssue().
   */
  async identifyLinearTeamMaxIssue(): Promise<LinearTeamMaxIssue[]> {
    this.logger.debug(CLASS_NAME, 'identifyLinearTeamMaxIssue', 'Querying max issue per team');

    const result: DatabaseQueryResult<{ team_key: string; count: number }> =
      await this.db.query(SQL_IDENTIFY_LINEAR_TEAM_MAX_ISSUE);

    const teams: LinearTeamMaxIssue[] = result.rows.map((row) => ({
      teamKey: row.team_key,
      count: row.count,
    }));

    this.logger.debug(CLASS_NAME, 'identifyLinearTeamMaxIssue', `Found ${teams.length} teams`);
    return teams;
  }

  /**
   * Get unfinished Linear issues using direct state query.
   * Parallel to JiraRepository.getUnfinishedJiraIssues2().
   * Returns issues not Done/Canceled, plus recently completed ones.
   *
   * @param daysAgo - Number of days to look back for recently completed issues (default: 2)
   */
  async getUnfinishedLinearIssues(daysAgo = 2): Promise<UnfinishedLinearIssue[]> {
    this.logger.debug(CLASS_NAME, 'getUnfinishedLinearIssues', `Querying with daysAgo=${daysAgo}`);

    const result: DatabaseQueryResult<{ linear_key: string }> =
      await this.db.query(SQL_GET_UNFINISHED_LINEAR_ISSUES, [daysAgo]);

    const issues: UnfinishedLinearIssue[] = result.rows.map((row) => ({
      linearKey: row.linear_key,
    }));

    this.logger.debug(CLASS_NAME, 'getUnfinishedLinearIssues', `Found ${issues.length} issues`);
    return issues;
  }

  // --------------------------------------------------------------------------
  // Story Points Backfill methods (IQS-884)
  // --------------------------------------------------------------------------

  /**
   * Get Linear issues that need calculated story points backfill.
   * Returns issues where calculated_story_points IS NULL and
   * at least one of completed_date or status_change_date IS NOT NULL.
   * Uses COALESCE(completed_date, status_change_date) as end_date.
   *
   * @returns Array of rows with linear_key, created_date, end_date
   */
  async getIssuesNeedingStoryPointsBackfill(): Promise<
    Array<{ linear_key: string; created_date: Date | null; end_date: Date | null }>
  > {
    this.logger.debug(CLASS_NAME, 'getIssuesNeedingStoryPointsBackfill', 'Querying Linear issues needing story points backfill');

    const result: DatabaseQueryResult<{
      linear_key: string;
      created_date: Date | null;
      end_date: Date | null;
    }> = await this.db.query(SQL_GET_LINEAR_ISSUES_NEEDING_STORY_POINTS_BACKFILL);

    this.logger.debug(
      CLASS_NAME,
      'getIssuesNeedingStoryPointsBackfill',
      `Found ${result.rows.length} Linear issues needing story points backfill`,
    );
    return result.rows;
  }

  /**
   * Update the calculated_story_points for a specific Linear issue.
   * Uses parameterized query ($1, $2) — zero string interpolation.
   *
   * @param linearKey - The Linear issue key (e.g., "ENG-123")
   * @param points - The calculated story points value
   */
  async updateCalculatedStoryPoints(linearKey: string, points: number): Promise<void> {
    this.logger.debug(CLASS_NAME, 'updateCalculatedStoryPoints', `Updating ${linearKey}: ${points} points`);

    await this.db.query(SQL_UPDATE_LINEAR_CALCULATED_STORY_POINTS, [points, linearKey]);

    this.logger.trace(CLASS_NAME, 'updateCalculatedStoryPoints', `Updated ${linearKey}`);
  }
}
