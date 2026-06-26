/**
 * Data service for Developer Profile Dashboard. Queries commit data for developer metrics.
 * Security: CWE-89 (SQL Injection), CWE-20 (Input validation). Ticket: GITX-155, GITX-156, GITX-179
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import {
  QUERY_DEV_PROFILE_VELOCITY_VS_LOC,
  QUERY_DEV_PROFILE_HAS_VELOCITY_DATA,
} from '../database/queries/dev-profile-queries.js';
import type {
  DevProfileSummary,
  DevProfileLocWeekly,
  DevProfileComplexFile,
  DevProfileFrequentFile,
  DevProfileTechStack,
  DevProfileCommentsWeekly,
  DevProfileTestsWeekly,
  DevProfileHygieneScore,
  DevProfileDeveloper,
  DevProfileFilters,
  DevProfileVelocityPoint,
  DevProfileTestDebtMetrics,
  DevProfileTestDebtWeekly,
} from './dev-profile-data-types.js';

// Re-export types for convenience
export type {
  DevProfileSummary,
  DevProfileLocWeekly,
  DevProfileComplexFile,
  DevProfileFrequentFile,
  DevProfileTechStack,
  DevProfileCommentsWeekly,
  DevProfileTestsWeekly,
  DevProfileHygieneScore,
  DevProfileDeveloper,
  DevProfileTimeframe,
  DevProfileFilters,
  DevProfileVelocityPoint,
  DevProfileTestDebtMetrics,
  DevProfileTestDebtWeekly,
} from './dev-profile-data-types.js';

const CLASS_NAME = 'DevProfileDataService';
const MAX_FILTER_STRING_LENGTH = 200; // CWE-20: Input validation

/** Service for querying developer profile metrics. Ticket: GITX-155, GITX-156 */
export class DevProfileDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'DevProfileDataService created');
  }

  /**
   * Validate developer identifier at runtime.
   * Accepts either full_name (preferred) or login (fallback).
   *
   * @param developerFullName - The developer identifier (full_name or login) to validate
   * @param methodName - Calling method name for log context
   */
  private validateDeveloper(developerFullName: string, methodName: string): void {
    if (!developerFullName || developerFullName.trim().length === 0) {
      this.logger.warn(CLASS_NAME, methodName, 'Empty developer identifier rejected');
      throw new Error('Developer login is required.');
    }
    if (developerFullName.length > MAX_FILTER_STRING_LENGTH) {
      this.logger.warn(CLASS_NAME, methodName, `Developer identifier exceeds max length: ${developerFullName.length} > ${MAX_FILTER_STRING_LENGTH}`);
      throw new Error(`Developer identifier exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
    }
  }

  /**
   * Validate timeframe string at runtime.
   *
   * @param timeframeDays - The timeframe value to validate
   * @param methodName - Calling method name for log context
   */
  private validateTimeframe(timeframeDays: string, methodName: string): void {
    const allowedTimeframes = ['30', '60', '90', '180', '365', '730'];
    if (!allowedTimeframes.includes(timeframeDays)) {
      this.logger.warn(CLASS_NAME, methodName, `Invalid timeframe rejected: ${timeframeDays}`);
      throw new Error(`Invalid timeframe: ${timeframeDays}. Allowed values: ${allowedTimeframes.join(', ')}.`);
    }
  }

  /**
   * Calculate the start date based on timeframe days.
   *
   * @param timeframeDays - Number of days to go back
   * @returns ISO date string YYYY-MM-DD
   */
  private getStartDate(timeframeDays: string): string {
    const days = parseInt(timeframeDays, 10);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0] ?? '';
  }

  /**
   * Determine aggregation period based on timeframe.
   * GITX-179: For timeframes < 365 days, aggregate by week. For >= 365 days, aggregate by month.
   *
   * @param timeframeDays - The timeframe value (30, 60, 90, 180, 365, 730)
   * @returns 'week' or 'month'
   */
  getAggregationPeriod(timeframeDays: string): 'week' | 'month' {
    const days = parseInt(timeframeDays, 10);
    return days >= 365 ? 'month' : 'week';
  }

  /**
   * Validate aggregation period parameter before SQL execution.
   * Security: CWE-89 defense-in-depth - ensures only valid PostgreSQL DATE_TRUNC values.
   *
   * @param period - The aggregation period ('week' or 'month')
   * @param methodName - The calling method name for error reporting
   * @throws Error if period is not 'week' or 'month'
   */
  private validateAggregationPeriod(period: string, methodName: string): void {
    const allowedPeriods = ['week', 'month'];
    if (!allowedPeriods.includes(period)) {
      this.logger.error(CLASS_NAME, methodName, `Invalid aggregation period: ${period}`);
      throw new Error('Invalid aggregation period. Must be "week" or "month".');
    }
  }

  /**
   * Calculate the number of periods (weeks or months) in a timeframe.
   * GITX-179: Used for calculating average metrics per period.
   *
   * @param timeframeDays - Number of days in the timeframe
   * @returns Number of complete periods
   */
  /** Average days per month (365.25 / 12). Used for period calculations. */
  private static readonly AVERAGE_DAYS_PER_MONTH = 30.44;

  private getPeriodsCount(timeframeDays: string): number {
    const days = parseInt(timeframeDays, 10);
    const period = this.getAggregationPeriod(timeframeDays);
    if (period === 'month') {
      // Use ceil for consistency - ensures periods always cover the full timeframe
      return Math.max(1, Math.ceil(days / DevProfileDataService.AVERAGE_DAYS_PER_MONTH));
    }
    // Weeks
    return Math.max(1, Math.ceil(days / 7));
  }

  /**
   * Get list of all developers for the dropdown selector.
   * Groups by full_name and aggregates logins.
   * Sorted by commit count descending.
   *
   * @returns Array of developer options with fullName as primary identifier
   */
  async getDevelopers(): Promise<DevProfileDeveloper[]> {
    this.logger.debug(CLASS_NAME, 'getDevelopers', 'Fetching developer list');

    const sql = `
      SELECT
        cc.full_name,
        STRING_AGG(DISTINCT cc.login, ',') AS logins,
        COUNT(DISTINCT ch.sha)::int AS commit_count
      FROM commit_contributors cc
      LEFT JOIN commit_history ch ON ch.author = cc.login
      GROUP BY cc.full_name
      ORDER BY commit_count DESC
    `;

    const result = await this.db.query<{
      full_name: string | null;
      logins: string;
      commit_count: number;
    }>(sql);

    this.logger.debug(CLASS_NAME, 'getDevelopers', `Found ${result.rowCount} developers (grouped by full_name)`);

    return result.rows.map((row) => ({
      fullName: row.full_name,
      login: row.logins.split(',')[0] ?? '', // Use first login for display
      commitCount: row.commit_count,
    }));
  }

  /**
   * Get summary statistics for a developer.
   * Filters by full_name with fallback to login for NULL full_name.
   * GITX-179: Added average LOC per period and average story points per period.
   *
   * @param filters - Developer and timeframe filters (developer is full_name)
   * @returns Summary statistics including averages per week/month
   */
  async getSummary(filters: DevProfileFilters): Promise<DevProfileSummary> {
    this.validateDeveloper(filters.developer, 'getSummary');
    this.validateTimeframe(filters.timeframeDays, 'getSummary');

    this.logger.debug(CLASS_NAME, 'getSummary', `Fetching summary for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);
    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getSummary');
    const periodsCount = this.getPeriodsCount(filters.timeframeDays);

    const sql = `
      SELECT
        COUNT(DISTINCT ch.sha)::int AS total_commits,
        COALESCE(SUM(cf.line_inserts), 0)::bigint AS total_loc_added,
        COALESCE(AVG(NULLIF(cf.complexity, 0)), 0)::numeric AS avg_complexity,
        COUNT(DISTINCT ch.repository)::int AS repos_worked_on
      FROM commit_history ch
      LEFT JOIN commit_files cf ON cf.sha = ch.sha
      JOIN commit_contributors cc ON ch.author = cc.login
      WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
    `;

    const result = await this.db.query<{
      total_commits: number;
      total_loc_added: string;
      avg_complexity: string;
      repos_worked_on: number;
    }>(sql, [filters.developer, startDate]);

    const row = result.rows[0];
    if (!row) {
      return {
        totalCommits: 0,
        totalLoc: 0,
        avgComplexity: 0,
        repositoriesWorkedOn: 0,
        avgLocPerPeriod: 0,
        avgStoryPointsPerPeriod: null,
        aggregationPeriod,
      };
    }

    const totalLoc = Number(row.total_loc_added);
    const avgLocPerPeriod = Math.round(totalLoc / periodsCount);

    // GITX-179: Get story points for average calculation
    const storyPointsTotal = await this.getTotalStoryPoints(filters.developer, startDate);
    const avgStoryPointsPerPeriod = storyPointsTotal !== null
      ? Math.round((storyPointsTotal / periodsCount) * 10) / 10
      : null;

    this.logger.debug(CLASS_NAME, 'getSummary', `Summary: ${row.total_commits} commits, ${row.total_loc_added} LOC, avgLoc/${aggregationPeriod}: ${avgLocPerPeriod}`);

    return {
      totalCommits: row.total_commits,
      totalLoc,
      avgComplexity: Number(parseFloat(row.avg_complexity).toFixed(2)),
      repositoriesWorkedOn: row.repos_worked_on,
      avgLocPerPeriod,
      avgStoryPointsPerPeriod,
      aggregationPeriod,
    };
  }

  /**
   * Get total story points for a developer in a timeframe.
   * GITX-179: Helper for calculating average story points per period.
   *
   * @param developer - Developer full_name or login
   * @param startDate - Start date for the timeframe
   * @returns Total story points or null if no data
   */
  private async getTotalStoryPoints(developer: string, startDate: string): Promise<number | null> {
    const sql = `
      WITH linear_points AS (
        SELECT COALESCE(SUM(ld.calculated_story_points), 0)::int AS points
        FROM linear_detail ld
        JOIN commit_contributors cc ON (
          ld.assignee = cc.email OR ld.assignee = cc.login OR ld.assignee = cc.full_name
        )
        WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
          AND ld.completed_date >= $2
          AND ld.state IN ('Done', 'Completed')
      ),
      jira_points AS (
        -- GITX-183: Join on COALESCE(cc.jira_name, cc.full_name) for proper name alignment.
        -- The jira_name column is the canonical field for matching contributors to Jira assignees.
        SELECT COALESCE(SUM(jd.calculated_story_points), 0)::int AS points
        FROM jira_history jh
        JOIN jira_detail jd ON jh.jira_key = jd.jira_key
        JOIN commit_contributors cc ON jd.assignee = COALESCE(cc.jira_name, cc.full_name)
        WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
          AND jh.change_date >= $2
          AND jh.field = 'status'
          AND jh.to_value IN ('Done', 'Closed', 'Resolved')
      ),
      total AS (
        SELECT (SELECT points FROM linear_points) + (SELECT points FROM jira_points) AS total_points,
               EXISTS (SELECT 1 FROM linear_points WHERE points > 0) OR
               EXISTS (SELECT 1 FROM jira_points WHERE points > 0) AS has_data
      )
      SELECT total_points, has_data FROM total
    `;

    const result = await this.db.query<{
      total_points: number;
      has_data: boolean;
    }>(sql, [developer, startDate]);

    const row = result.rows[0];
    if (!row || !row.has_data) {
      return null;
    }

    return row.total_points;
  }

  /**
   * Get LOC per period data for the line chart.
   * Filters by full_name with fallback to login for NULL full_name.
   * GITX-179: Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
   *
   * @param filters - Developer and timeframe filters (developer is full_name)
   * @returns Array of LOC data points by repository per period (week or month)
   */
  async getLocPerWeek(filters: DevProfileFilters): Promise<DevProfileLocWeekly[]> {
    this.validateDeveloper(filters.developer, 'getLocPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getLocPerWeek');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getLocPerWeek');
    this.logger.debug(CLASS_NAME, 'getLocPerWeek', `Fetching LOC per ${aggregationPeriod} for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-179: Dynamic aggregation based on timeframe
    const sql = `
      SELECT
        DATE_TRUNC($3, ch.commit_date)::date AS week_start,
        ch.repository,
        COALESCE(SUM(cf.line_inserts), 0)::bigint AS lines_added,
        COALESCE(SUM(cf.line_deletes), 0)::bigint AS lines_removed,
        COALESCE(SUM(cf.line_inserts - cf.line_deletes), 0)::bigint AS net_lines
      FROM commit_history ch
      LEFT JOIN commit_files cf ON cf.sha = ch.sha
      JOIN commit_contributors cc ON ch.author = cc.login
      WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
        AND cf.line_inserts IS NOT NULL
      GROUP BY week_start, ch.repository
      ORDER BY week_start ASC, ch.repository
    `;

    const result = await this.db.query<{
      week_start: Date;
      repository: string;
      lines_added: string;
      lines_removed: string;
      net_lines: string;
    }>(sql, [filters.developer, startDate, aggregationPeriod]);

    this.logger.debug(CLASS_NAME, 'getLocPerWeek', `Found ${result.rowCount} ${aggregationPeriod}ly data points`);

    return result.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      repository: row.repository,
      linesAdded: Number(row.lines_added),
      linesRemoved: Number(row.lines_removed),
      netLines: Number(row.net_lines),
    }));
  }

  /**
   * Get top 15 most complex files modified by the developer.
   * Filters by full_name with fallback to login for NULL full_name.
   *
   * @param filters - Developer and timeframe filters (developer is full_name)
   * @returns Array of complex file data points
   */
  async getTopComplexFiles(filters: DevProfileFilters): Promise<DevProfileComplexFile[]> {
    this.validateDeveloper(filters.developer, 'getTopComplexFiles');
    this.validateTimeframe(filters.timeframeDays, 'getTopComplexFiles');

    this.logger.debug(CLASS_NAME, 'getTopComplexFiles', `Fetching top complex files for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const sql = `
      SELECT
        cf.filename AS file_path,
        MAX(cf.complexity)::int AS complexity_score,
        ch.repository,
        MAX(ch.commit_date)::date AS last_modified
      FROM commit_files cf
      JOIN commit_history ch ON ch.sha = cf.sha
      JOIN commit_contributors cc ON ch.author = cc.login
      WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
        AND cf.complexity IS NOT NULL
        AND cf.complexity > 0
      GROUP BY cf.filename, ch.repository
      ORDER BY complexity_score DESC
      LIMIT 15
    `;

    const result = await this.db.query<{
      file_path: string;
      complexity_score: number;
      repository: string;
      last_modified: Date;
    }>(sql, [filters.developer, startDate]);

    this.logger.debug(CLASS_NAME, 'getTopComplexFiles', `Found ${result.rowCount} complex files`);

    return result.rows.map((row) => ({
      filePath: row.file_path,
      complexityScore: row.complexity_score,
      repository: row.repository,
      lastModified: row.last_modified.toISOString().split('T')[0] ?? '',
    }));
  }

  /**
   * Get top 20 most frequently modified files by the developer.
   * Filters by full_name with fallback to login for NULL full_name.
   * GITX-179: Replaced repository with lastModified date column.
   *
   * @param filters - Developer and timeframe filters (developer is full_name)
   * @returns Array of frequent file data points with lastModified date
   */
  async getTopFrequentFiles(filters: DevProfileFilters): Promise<DevProfileFrequentFile[]> {
    this.validateDeveloper(filters.developer, 'getTopFrequentFiles');
    this.validateTimeframe(filters.timeframeDays, 'getTopFrequentFiles');

    this.logger.debug(CLASS_NAME, 'getTopFrequentFiles', `Fetching top frequent files for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-179: Replaced repository with MAX(commit_date) as last_modified
    const sql = `
      SELECT
        cf.filename AS file_path,
        COUNT(DISTINCT cf.sha)::int AS modification_count,
        COALESCE(SUM(ABS(cf.line_inserts) + ABS(COALESCE(cf.line_deletes, 0))), 0)::bigint AS total_loc_changed,
        MAX(ch.commit_date)::date AS last_modified
      FROM commit_files cf
      JOIN commit_history ch ON ch.sha = cf.sha
      JOIN commit_contributors cc ON ch.author = cc.login
      WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
      GROUP BY cf.filename
      ORDER BY modification_count DESC
      LIMIT 20
    `;

    const result = await this.db.query<{
      file_path: string;
      modification_count: number;
      total_loc_changed: string;
      last_modified: Date;
    }>(sql, [filters.developer, startDate]);

    this.logger.debug(CLASS_NAME, 'getTopFrequentFiles', `Found ${result.rowCount} frequent files`);

    return result.rows.map((row) => ({
      filePath: row.file_path,
      modificationCount: row.modification_count,
      totalLocChanged: Number(row.total_loc_changed),
      lastModified: row.last_modified.toISOString().split('T')[0] ?? '',
    }));
  }

  /**
   * Get technology stack contributions by category for the doughnut chart.
   * Filters by full_name with fallback to login for NULL full_name.
   * Ticket: GITX-156
   *
   * @param filters - Developer and timeframe filters (developer is full_name)
   * @returns Array of tech stack data points with percentages
   */
  async getTechStack(filters: DevProfileFilters): Promise<DevProfileTechStack[]> {
    this.validateDeveloper(filters.developer, 'getTechStack');
    this.validateTimeframe(filters.timeframeDays, 'getTechStack');

    this.logger.debug(CLASS_NAME, 'getTechStack', `Fetching tech stack for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // Query aggregates LOC by technology stack category using the view
    const sql = `
      WITH dev_contributions AS (
        SELECT
          vtsc.category,
          ch.repository,
          COALESCE(SUM(cf.line_inserts), 0)::bigint AS loc_count
        FROM commit_files cf
        JOIN commit_history ch ON cf.sha = ch.sha
        JOIN commit_contributors cc ON ch.author = cc.login
        JOIN vw_technology_stack_category vtsc ON cf.file_extension = vtsc.file_extension
        WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
          AND ch.commit_date >= $2
          AND ch.is_merge = FALSE
          AND cf.line_inserts IS NOT NULL
        GROUP BY vtsc.category, ch.repository
      ),
      total_loc AS (
        SELECT COALESCE(SUM(loc_count), 0) AS total FROM dev_contributions
      )
      SELECT
        dc.category,
        dc.repository,
        dc.loc_count,
        CASE
          WHEN tl.total > 0 THEN ROUND((dc.loc_count * 100.0 / tl.total)::numeric, 2)
          ELSE 0
        END AS percentage
      FROM dev_contributions dc
      CROSS JOIN total_loc tl
      WHERE dc.loc_count > 0
      ORDER BY dc.loc_count DESC
    `;

    const result = await this.db.query<{
      category: string;
      repository: string;
      loc_count: string;
      percentage: string;
    }>(sql, [filters.developer, startDate]);

    this.logger.debug(CLASS_NAME, 'getTechStack', `Found ${result.rowCount} tech stack categories`);

    return result.rows.map((row) => ({
      category: row.category,
      repository: row.repository,
      locCount: Number(row.loc_count),
      percentage: Number(row.percentage),
    }));
  }

  /**
   * Get comments added per period for the line chart.
   * Filters by full_name with fallback to login for NULL full_name.
   * Uses comments_change column with fallback to total_comment_lines for older commits.
   * Ticket: GITX-156, GITX-179
   * GITX-179: Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
   *
   * @param filters - Developer and timeframe filters (developer is full_name)
   * @returns Array of comment data points per period (week or month)
   */
  async getCommentsPerWeek(filters: DevProfileFilters): Promise<DevProfileCommentsWeekly[]> {
    this.validateDeveloper(filters.developer, 'getCommentsPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getCommentsPerWeek');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getCommentsPerWeek');
    this.logger.debug(CLASS_NAME, 'getCommentsPerWeek', `Fetching comments per ${aggregationPeriod} for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-179: Dynamic aggregation based on timeframe
    // Use COALESCE to handle NULL comments_change (from older commits before migration 026)
    const sql = `
      SELECT
        DATE_TRUNC($3, ch.commit_date)::date AS week_start,
        COALESCE(SUM(COALESCE(cf.comments_change, 0)), 0)::int AS comments_added
      FROM commit_files cf
      JOIN commit_history ch ON cf.sha = ch.sha
      JOIN commit_contributors cc ON ch.author = cc.login
      WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
      GROUP BY week_start
      ORDER BY week_start ASC
    `;

    const result = await this.db.query<{
      week_start: Date;
      comments_added: number;
    }>(sql, [filters.developer, startDate, aggregationPeriod]);

    this.logger.debug(CLASS_NAME, 'getCommentsPerWeek', `Found ${result.rowCount} ${aggregationPeriod}ly comment data points`);

    return result.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      commentsAdded: row.comments_added,
    }));
  }

  /**
   * Get tests modified per period for the line chart.
   * Filters by full_name with fallback to login for NULL full_name.
   * Filters by is_test_file = TRUE.
   * Ticket: GITX-156, GITX-179
   * GITX-179: Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
   *
   * @param filters - Developer and timeframe filters (developer is full_name)
   * @returns Array of test data points per period (week or month)
   */
  async getTestsPerWeek(filters: DevProfileFilters): Promise<DevProfileTestsWeekly[]> {
    this.validateDeveloper(filters.developer, 'getTestsPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getTestsPerWeek');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getTestsPerWeek');
    this.logger.debug(CLASS_NAME, 'getTestsPerWeek', `Fetching tests per ${aggregationPeriod} for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-179: Dynamic aggregation based on timeframe
    const sql = `
      SELECT
        DATE_TRUNC($3, ch.commit_date)::date AS week_start,
        COUNT(DISTINCT cf.filename)::int AS test_files_modified,
        COALESCE(SUM(cf.line_inserts), 0)::int AS test_lines_added
      FROM commit_files cf
      JOIN commit_history ch ON cf.sha = ch.sha
      JOIN commit_contributors cc ON ch.author = cc.login
      WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
        AND cf.is_test_file = TRUE
      GROUP BY week_start
      ORDER BY week_start ASC
    `;

    const result = await this.db.query<{
      week_start: Date;
      test_files_modified: number;
      test_lines_added: number;
    }>(sql, [filters.developer, startDate, aggregationPeriod]);

    this.logger.debug(CLASS_NAME, 'getTestsPerWeek', `Found ${result.rowCount} ${aggregationPeriod}ly test data points`);

    return result.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      testFilesModified: row.test_files_modified,
      testLinesAdded: row.test_lines_added,
    }));
  }

  /**
   * Get commit hygiene score from vw_commit_hygiene view.
   * Filters by full_name with fallback to login for NULL full_name.
   * Calculates weighted score: (jira_ref * 0.4) + (meaningful_msg * 0.4) + (non_merge * 0.2)
   * Ticket: GITX-156
   *
   * @param filters - Developer and timeframe filters (developer is full_name)
   * @returns Hygiene score breakdown
   */
  async getHygieneScore(filters: DevProfileFilters): Promise<DevProfileHygieneScore> {
    this.validateDeveloper(filters.developer, 'getHygieneScore');
    this.validateTimeframe(filters.timeframeDays, 'getHygieneScore');

    this.logger.debug(CLASS_NAME, 'getHygieneScore', `Fetching hygiene score for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // Query the vw_commit_hygiene view and calculate component percentages
    const sql = `
      WITH hygiene_stats AS (
        SELECT
          COUNT(*)::int AS total_commits,
          ROUND(AVG(vch.hygiene_score)::numeric, 2) AS avg_hygiene_score,
          -- Jira reference percentage: commits with linked ticket
          ROUND(100.0 * COUNT(*) FILTER (WHERE vch.jira_ticket_id IS NOT NULL OR vch.linear_ticket_id IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS jira_ref_pct,
          -- Meaningful message percentage: commits with conventional prefix OR good length
          ROUND(100.0 * COUNT(*) FILTER (WHERE vch.has_conventional_prefix = TRUE OR vch.subject_length BETWEEN 20 AND 72) / NULLIF(COUNT(*), 0), 1) AS meaningful_msg_pct,
          -- Quality tier counts for determining overall tier
          COUNT(*) FILTER (WHERE vch.quality_tier = 'excellent') AS excellent_count,
          COUNT(*) FILTER (WHERE vch.quality_tier = 'good') AS good_count,
          COUNT(*) FILTER (WHERE vch.quality_tier = 'fair') AS fair_count,
          COUNT(*) FILTER (WHERE vch.quality_tier = 'poor') AS poor_count
        FROM vw_commit_hygiene vch
        JOIN commit_contributors cc ON vch.author = cc.login
        WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
          AND vch.commit_date >= $2
      )
      SELECT
        total_commits,
        avg_hygiene_score,
        COALESCE(jira_ref_pct, 0) AS jira_ref_pct,
        COALESCE(meaningful_msg_pct, 0) AS meaningful_msg_pct,
        -- Non-merge is always 100% since the view already excludes merges
        100.0 AS non_merge_pct,
        excellent_count,
        good_count,
        fair_count,
        poor_count
      FROM hygiene_stats
    `;

    const result = await this.db.query<{
      total_commits: number;
      avg_hygiene_score: string | null;
      jira_ref_pct: string;
      meaningful_msg_pct: string;
      non_merge_pct: string;
      excellent_count: number;
      good_count: number;
      fair_count: number;
      poor_count: number;
    }>(sql, [filters.developer, startDate]);

    const row = result.rows[0];
    if (!row || row.total_commits === 0) {
      this.logger.debug(CLASS_NAME, 'getHygieneScore', 'No commits found for hygiene calculation');
      return {
        overallScore: 0,
        jiraRefPercentage: 0,
        meaningfulMsgPercentage: 0,
        nonMergePercentage: 100,
        totalCommits: 0,
        qualityTier: 'poor',
      };
    }

    // Calculate weighted overall score
    const jiraRefPct = Number(row.jira_ref_pct);
    const meaningfulMsgPct = Number(row.meaningful_msg_pct);
    const nonMergePct = Number(row.non_merge_pct);

    // Use the average hygiene score from the view directly
    const overallScore = Number(row.avg_hygiene_score ?? 0);

    // Determine quality tier based on distribution
    let qualityTier: 'excellent' | 'good' | 'fair' | 'poor';
    const totalCommits = row.total_commits;
    const excellentGoodRatio = (row.excellent_count + row.good_count) / totalCommits;

    if (excellentGoodRatio >= 0.8) {
      qualityTier = 'excellent';
    } else if (excellentGoodRatio >= 0.6) {
      qualityTier = 'good';
    } else if (excellentGoodRatio >= 0.4) {
      qualityTier = 'fair';
    } else {
      qualityTier = 'poor';
    }

    this.logger.debug(CLASS_NAME, 'getHygieneScore', `Hygiene score: ${overallScore}, tier: ${qualityTier}`);

    return {
      overallScore,
      jiraRefPercentage: jiraRefPct,
      meaningfulMsgPercentage: meaningfulMsgPct,
      nonMergePercentage: nonMergePct,
      totalCommits,
      qualityTier,
    };
  }

  /**
   * Get sprint velocity vs LOC data for the dual-axis chart.
   * Correlates story points from Linear/Jira with lines of code committed.
   * Uses commit_contributors.email -> Linear/Jira assignee mapping.
   * Ticket: GITX-157, GITX-179
   * GITX-179: Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
   *
   * @param filters - Developer and timeframe filters
   * @returns Array of velocity data points per period (week or month)
   */
  async getVelocityVsLoc(filters: DevProfileFilters): Promise<DevProfileVelocityPoint[]> {
    this.validateDeveloper(filters.developer, 'getVelocityVsLoc');
    this.validateTimeframe(filters.timeframeDays, 'getVelocityVsLoc');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getVelocityVsLoc');
    this.logger.debug(CLASS_NAME, 'getVelocityVsLoc', `Fetching velocity vs LOC per ${aggregationPeriod} for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-179: Pass aggregation period as third parameter
    const result = await this.db.query<{
      week_start: Date;
      story_points: number;
      lines_of_code: string;
      issue_count: number;
      commit_count: number;
    }>(QUERY_DEV_PROFILE_VELOCITY_VS_LOC, [filters.developer, startDate, aggregationPeriod]);

    this.logger.debug(CLASS_NAME, 'getVelocityVsLoc', `Found ${result.rowCount} ${aggregationPeriod}ly velocity data points`);

    return result.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      storyPoints: row.story_points,
      linesOfCode: Number(row.lines_of_code),
      issueCount: row.issue_count,
      commitCount: row.commit_count,
    }));
  }

  /**
   * Check if velocity data is available for a developer.
   * Returns true if the developer has any Linear/Jira issues assigned.
   * Ticket: GITX-157
   *
   * @param developer - Developer login
   * @returns true if velocity data exists
   */
  async hasVelocityData(developer: string): Promise<boolean> {
    this.validateDeveloper(developer, 'hasVelocityData');

    this.logger.debug(CLASS_NAME, 'hasVelocityData', `Checking velocity data availability for ${developer}`);

    const result = await this.db.query<{ has_data: boolean }>(
      QUERY_DEV_PROFILE_HAS_VELOCITY_DATA,
      [developer]
    );
    const hasData = result.rows[0]?.has_data ?? false;

    this.logger.debug(CLASS_NAME, 'hasVelocityData', `Velocity data available: ${hasData}`);
    return hasData;
  }

  /**
   * Get test debt metrics for a developer.
   * Returns period breakdown of commits by test coverage tier and ROI calculation.
   * Uses vw_commit_test_ratio and vw_subsequent_bugs views.
   * Ticket: GITX-172, GITX-179
   * GITX-179: Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
   *
   * @param filters - Developer and timeframe filters (developer is full_name)
   * @returns Test debt metrics with period data and ROI multiplier
   */
  async getTestDebtMetrics(filters: DevProfileFilters): Promise<DevProfileTestDebtMetrics> {
    this.validateDeveloper(filters.developer, 'getTestDebtMetrics');
    this.validateTimeframe(filters.timeframeDays, 'getTestDebtMetrics');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getTestDebtMetrics');
    this.logger.debug(CLASS_NAME, 'getTestDebtMetrics', `Fetching test debt metrics per ${aggregationPeriod} for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // Check if the required view exists
    const viewExistsResult = await this.db.query<{ view_exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_name = 'vw_commit_test_ratio'
      ) AS view_exists`
    );

    if (!viewExistsResult.rows[0]?.view_exists) {
      this.logger.warn(CLASS_NAME, 'getTestDebtMetrics', 'vw_commit_test_ratio view not found');
      return {
        weeklyData: [],
        lowTestBugRate: 0,
        highTestBugRate: 0,
        roiMultiplier: 0,
        totalCommits: 0,
        lowTestCommits: 0,
        teamAvgRoiMultiplier: null,
      };
    }

    // GITX-179: Dynamic aggregation based on timeframe
    // Query period test debt breakdown by tier
    // Filter by full_name with login fallback (GITX-169 pattern)
    const weeklyQuery = `
      SELECT
        DATE_TRUNC($3, ctr.commit_date)::DATE AS week_start,
        COUNT(*) FILTER (WHERE ctr.test_ratio IS NULL OR ctr.test_ratio < 0.1)::int AS low_test_commits,
        COUNT(*) FILTER (WHERE ctr.test_ratio >= 0.1 AND ctr.test_ratio < 0.5)::int AS medium_test_commits,
        COUNT(*) FILTER (WHERE ctr.test_ratio >= 0.5)::int AS high_test_commits,
        COUNT(*)::int AS total_commits
      FROM vw_commit_test_ratio ctr
      JOIN commit_contributors cc ON ctr.author = cc.login
      WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
        AND ctr.commit_date >= $2
        AND ctr.prod_loc_changed >= 50
      GROUP BY DATE_TRUNC($3, ctr.commit_date)
      ORDER BY week_start ASC
    `;

    const weeklyResult = await this.db.query<{
      week_start: Date;
      low_test_commits: number;
      medium_test_commits: number;
      high_test_commits: number;
      total_commits: number;
    }>(weeklyQuery, [filters.developer, startDate, aggregationPeriod]);

    this.logger.debug(CLASS_NAME, 'getTestDebtMetrics', `Found ${weeklyResult.rowCount} ${aggregationPeriod}ly data points`);

    // Query bug rates by tier for ROI calculation
    // Check if subsequent bugs view exists
    const bugsViewExistsResult = await this.db.query<{ view_exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_name = 'vw_subsequent_bugs'
      ) AS view_exists`
    );

    let lowTestBugRate = 0;
    let highTestBugRate = 0;
    let totalCommits = 0;
    let lowTestCommits = 0;
    let teamAvgRoiMultiplier: number | null = null;

    if (bugsViewExistsResult.rows[0]?.view_exists) {
      // Query developer's bug rates by tier
      const bugRateQuery = `
        WITH dev_commits AS (
          SELECT
            ctr.sha,
            ctr.test_ratio,
            COALESCE(sb.jira_bugs_filed, 0) + COALESCE(sb.linear_bugs_filed, 0) AS subsequent_bugs
          FROM vw_commit_test_ratio ctr
          LEFT JOIN vw_subsequent_bugs sb ON ctr.sha = sb.original_sha
          JOIN commit_contributors cc ON ctr.author = cc.login
          WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
            AND ctr.commit_date >= $2
            AND ctr.prod_loc_changed >= 50
        )
        SELECT
          COUNT(*) FILTER (WHERE test_ratio IS NULL OR test_ratio < 0.1)::int AS low_test_count,
          COUNT(*) FILTER (WHERE test_ratio >= 0.5)::int AS high_test_count,
          SUM(subsequent_bugs) FILTER (WHERE test_ratio IS NULL OR test_ratio < 0.1)::int AS low_test_bugs,
          SUM(subsequent_bugs) FILTER (WHERE test_ratio >= 0.5)::int AS high_test_bugs,
          COUNT(*)::int AS total_commits
        FROM dev_commits
      `;

      const bugRateResult = await this.db.query<{
        low_test_count: number;
        high_test_count: number;
        low_test_bugs: number;
        high_test_bugs: number;
        total_commits: number;
      }>(bugRateQuery, [filters.developer, startDate]);

      const row = bugRateResult.rows[0];
      if (row && row.total_commits > 0) {
        totalCommits = row.total_commits;
        lowTestCommits = row.low_test_count ?? 0;
        const lowTestBugs = row.low_test_bugs ?? 0;
        const highTestBugs = row.high_test_bugs ?? 0;
        const lowTestCount = row.low_test_count ?? 0;
        const highTestCount = row.high_test_count ?? 0;

        lowTestBugRate = lowTestCount > 0 ? lowTestBugs / lowTestCount : 0;
        highTestBugRate = highTestCount > 0 ? highTestBugs / highTestCount : 0;
      }

      // Query team average ROI for comparison
      const teamAvgQuery = `
        WITH team_commits AS (
          SELECT
            ctr.sha,
            ctr.test_ratio,
            COALESCE(sb.jira_bugs_filed, 0) + COALESCE(sb.linear_bugs_filed, 0) AS subsequent_bugs
          FROM vw_commit_test_ratio ctr
          LEFT JOIN vw_subsequent_bugs sb ON ctr.sha = sb.original_sha
          WHERE ctr.commit_date >= $1
            AND ctr.prod_loc_changed >= 50
        )
        SELECT
          COUNT(*) FILTER (WHERE test_ratio IS NULL OR test_ratio < 0.1)::int AS low_test_count,
          COUNT(*) FILTER (WHERE test_ratio >= 0.5)::int AS high_test_count,
          SUM(subsequent_bugs) FILTER (WHERE test_ratio IS NULL OR test_ratio < 0.1)::int AS low_test_bugs,
          SUM(subsequent_bugs) FILTER (WHERE test_ratio >= 0.5)::int AS high_test_bugs
        FROM team_commits
      `;

      const teamAvgResult = await this.db.query<{
        low_test_count: number;
        high_test_count: number;
        low_test_bugs: number;
        high_test_bugs: number;
      }>(teamAvgQuery, [startDate]);

      const teamRow = teamAvgResult.rows[0];
      if (teamRow) {
        const teamLowTestCount = teamRow.low_test_count ?? 0;
        const teamHighTestCount = teamRow.high_test_count ?? 0;
        const teamLowTestBugs = teamRow.low_test_bugs ?? 0;
        const teamHighTestBugs = teamRow.high_test_bugs ?? 0;

        const teamLowRate = teamLowTestCount > 0 ? teamLowTestBugs / teamLowTestCount : 0;
        const teamHighRate = teamHighTestCount > 0 ? teamHighTestBugs / teamHighTestCount : 0;

        if (teamHighRate > 0) {
          teamAvgRoiMultiplier = Number((teamLowRate / teamHighRate).toFixed(1));
        }
      }
    }

    // Calculate ROI multiplier
    const roiMultiplier = highTestBugRate > 0 ? Number((lowTestBugRate / highTestBugRate).toFixed(1)) : 0;

    // Build weekly data array
    const weeklyData: DevProfileTestDebtWeekly[] = weeklyResult.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      lowTestCommits: row.low_test_commits,
      mediumTestCommits: row.medium_test_commits,
      highTestCommits: row.high_test_commits,
      totalCommits: row.total_commits,
    }));

    this.logger.debug(CLASS_NAME, 'getTestDebtMetrics', `ROI multiplier: ${roiMultiplier}, totalCommits: ${totalCommits}`);

    return {
      weeklyData,
      lowTestBugRate: Number(lowTestBugRate.toFixed(2)),
      highTestBugRate: Number(highTestBugRate.toFixed(2)),
      roiMultiplier,
      totalCommits,
      lowTestCommits,
      teamAvgRoiMultiplier,
    };
  }
}
