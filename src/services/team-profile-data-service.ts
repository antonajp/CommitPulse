/**
 * Data service for Team Profile Dashboard. Queries commit data for team-aggregated metrics.
 * Security: CWE-89 (SQL Injection), CWE-20 (Input validation). Ticket: GITX-185
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidTeamName } from '../utils/team-validation.js';
import {
  QUERY_TEAM_PROFILE_VELOCITY_VS_LOC,
  QUERY_TEAM_PROFILE_HAS_VELOCITY_DATA,
} from '../database/queries/team-profile-queries.js';
import type {
  TeamProfileSummary,
  TeamProfileLocWeekly,
  TeamProfileComplexFile,
  TeamProfileFrequentFile,
  TeamProfileTechStack,
  TeamProfileCommentsWeekly,
  TeamProfileTestsWeekly,
  TeamProfileHygieneScore,
  TeamProfileTeam,
  TeamProfileFilters,
  TeamProfileVelocityPoint,
  TeamProfileTestDebtMetrics,
  TeamProfileTestDebtWeekly,
} from './team-profile-data-types.js';

// Re-export types for convenience
export type {
  TeamProfileSummary,
  TeamProfileLocWeekly,
  TeamProfileComplexFile,
  TeamProfileFrequentFile,
  TeamProfileTechStack,
  TeamProfileCommentsWeekly,
  TeamProfileTestsWeekly,
  TeamProfileHygieneScore,
  TeamProfileTeam,
  TeamProfileTimeframe,
  TeamProfileFilters,
  TeamProfileVelocityPoint,
  TeamProfileTestDebtMetrics,
  TeamProfileTestDebtWeekly,
} from './team-profile-data-types.js';

const CLASS_NAME = 'TeamProfileDataService';
const MAX_TEAM_NAME_LENGTH = 100; // CWE-20: Input validation

/** Service for querying team profile metrics. Ticket: GITX-185 */
export class TeamProfileDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'TeamProfileDataService created');
  }

  /**
   * Validate team name at runtime.
   * Uses isValidTeamName utility for security validation.
   *
   * @param teamName - The team name to validate
   * @param methodName - Calling method name for log context
   */
  private validateTeam(teamName: string, methodName: string): void {
    if (!teamName || teamName.trim().length === 0) {
      this.logger.warn(CLASS_NAME, methodName, 'Empty team name rejected');
      throw new Error('Team name is required.');
    }
    if (teamName.length > MAX_TEAM_NAME_LENGTH) {
      this.logger.warn(CLASS_NAME, methodName, `Team name exceeds max length: ${teamName.length} > ${MAX_TEAM_NAME_LENGTH}`);
      throw new Error(`Team name exceeds maximum length of ${MAX_TEAM_NAME_LENGTH} characters.`);
    }
    if (!isValidTeamName(teamName)) {
      this.logger.warn(CLASS_NAME, methodName, `Invalid team name rejected: ${teamName}`);
      throw new Error('Team name contains invalid characters. Only alphanumeric, spaces, hyphens, underscores, and periods are allowed.');
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
   * For timeframes < 365 days, aggregate by week. For >= 365 days, aggregate by month.
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
   * Used for calculating average metrics per period.
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
      return Math.max(1, Math.ceil(days / TeamProfileDataService.AVERAGE_DAYS_PER_MONTH));
    }
    // Weeks
    return Math.max(1, Math.ceil(days / 7));
  }

  /**
   * Get list of all teams for the dropdown selector.
   * Excludes NULL and 'Unassigned' teams.
   * Sorted by total commits descending.
   *
   * @returns Array of team options with member count and commit count
   */
  async getTeams(): Promise<TeamProfileTeam[]> {
    this.logger.debug(CLASS_NAME, 'getTeams', 'Fetching team list');

    const sql = `
      SELECT
        cc.team,
        COUNT(DISTINCT cc.login)::int AS member_count,
        COUNT(DISTINCT ch.sha)::int AS total_commits
      FROM commit_contributors cc
      LEFT JOIN commit_history ch ON ch.author = cc.login
      WHERE cc.team IS NOT NULL
        AND cc.team != 'Unassigned'
      GROUP BY cc.team
      ORDER BY total_commits DESC
    `;

    const result = await this.db.query<{
      team: string;
      member_count: number;
      total_commits: number;
    }>(sql);

    this.logger.debug(CLASS_NAME, 'getTeams', `Found ${result.rowCount} teams`);

    return result.rows.map((row) => ({
      team: row.team,
      memberCount: row.member_count,
      totalCommits: row.total_commits,
    }));
  }

  /**
   * Get summary statistics for a team.
   * Aggregates metrics across all team members.
   *
   * @param filters - Team and timeframe filters
   * @returns Summary statistics including averages per week/month
   */
  async getSummary(filters: TeamProfileFilters): Promise<TeamProfileSummary> {
    this.validateTeam(filters.team, 'getSummary');
    this.validateTimeframe(filters.timeframeDays, 'getSummary');

    this.logger.debug(CLASS_NAME, 'getSummary', `Fetching summary for team ${filters.team}`);

    const startDate = this.getStartDate(filters.timeframeDays);
    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getSummary');
    const periodsCount = this.getPeriodsCount(filters.timeframeDays);

    // GITX-186: Use consistent join pattern - ch.author stores git author name (full_name),
    // not login. Match dev-profile-data-service pattern for consistency.
    const sql = `
      WITH team_members AS (
        SELECT DISTINCT login, full_name
        FROM commit_contributors
        WHERE team = $1
      )
      SELECT
        COUNT(DISTINCT ch.sha)::int AS total_commits,
        COALESCE(SUM(cf.line_inserts), 0)::bigint AS total_loc_added,
        COALESCE(AVG(NULLIF(cf.complexity, 0)), 0)::numeric AS avg_complexity,
        COUNT(DISTINCT ch.repository)::int AS repos_worked_on
      FROM commit_history ch
      LEFT JOIN commit_files cf ON cf.sha = ch.sha
      JOIN team_members tm ON (
        ch.author = tm.full_name
        OR (tm.full_name IS NULL AND ch.author = tm.login)
      )
      WHERE ch.commit_date >= $2
        AND ch.is_merge = FALSE
    `;

    const result = await this.db.query<{
      total_commits: number;
      total_loc_added: string;
      avg_complexity: string;
      repos_worked_on: number;
    }>(sql, [filters.team, startDate]);

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

    // GITX-186: Get contributor counts for proper per-member averaging
    const commitContributorCount = await this.getActiveCommitContributorCount(filters.team, startDate);
    const spContributorCount = await this.getActiveStoryPointContributorCount(filters.team, startDate);

    // GITX-186: avgLocPerPeriod should be average per team member, not team total
    const avgLocPerPeriod = commitContributorCount > 0
      ? Math.round(totalLoc / periodsCount / commitContributorCount)
      : 0;

    // Get story points for average calculation
    const storyPointsTotal = await this.getTotalStoryPoints(filters.team, startDate);
    // GITX-186: avgStoryPointsPerPeriod should be average per team member
    const avgStoryPointsPerPeriod = storyPointsTotal !== null && spContributorCount > 0
      ? Math.round((storyPointsTotal / periodsCount / spContributorCount) * 10) / 10
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
   * Get total story points for a team in a timeframe.
   * Helper for calculating average story points per period.
   *
   * @param team - Team name
   * @param startDate - Start date for the timeframe
   * @returns Total story points or null if no data
   */
  private async getTotalStoryPoints(team: string, startDate: string): Promise<number | null> {
    // Defense-in-depth: Validate team even though callers should validate
    this.validateTeam(team, 'getTotalStoryPoints');
    const sql = `
      WITH linear_points AS (
        SELECT COALESCE(SUM(ld.calculated_story_points), 0)::int AS points
        FROM linear_detail ld
        JOIN commit_contributors cc ON (
          ld.assignee = cc.email OR ld.assignee = cc.login OR ld.assignee = cc.full_name
        )
        WHERE cc.team = $1
          AND ld.completed_date >= $2
          AND ld.state IN ('Done', 'Completed')
      ),
      jira_points AS (
        SELECT COALESCE(SUM(jd.calculated_story_points), 0)::int AS points
        FROM jira_history jh
        JOIN jira_detail jd ON jh.jira_key = jd.jira_key
        JOIN commit_contributors cc ON jd.assignee = COALESCE(cc.jira_name, cc.full_name)
        WHERE cc.team = $1
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
    }>(sql, [team, startDate]);

    const row = result.rows[0];
    if (!row || !row.has_data) {
      return null;
    }

    return row.total_points;
  }

  /**
   * Count team members who have commits in the timeframe.
   * GITX-186: Used for calculating per-member averages.
   *
   * @param team - Team name
   * @param startDate - Start date for the timeframe
   * @returns Number of active commit contributors
   */
  private async getActiveCommitContributorCount(team: string, startDate: string): Promise<number> {
    this.validateTeam(team, 'getActiveCommitContributorCount');
    const sql = `
      WITH team_members AS (
        SELECT DISTINCT login, full_name
        FROM commit_contributors
        WHERE team = $1
      )
      SELECT COUNT(DISTINCT ch.author)::int AS contributor_count
      FROM commit_history ch
      JOIN team_members tm ON (
        ch.author = tm.full_name
        OR (tm.full_name IS NULL AND ch.author = tm.login)
      )
      WHERE ch.commit_date >= $2
        AND ch.is_merge = FALSE
    `;

    const result = await this.db.query<{ contributor_count: number }>(sql, [team, startDate]);
    return result.rows[0]?.contributor_count ?? 0;
  }

  /**
   * Count team members who have completed story points in the timeframe.
   * GITX-186: Used for calculating per-member SP averages.
   *
   * @param team - Team name
   * @param startDate - Start date for the timeframe
   * @returns Number of contributors with story points
   */
  private async getActiveStoryPointContributorCount(team: string, startDate: string): Promise<number> {
    this.validateTeam(team, 'getActiveStoryPointContributorCount');
    const sql = `
      WITH linear_contributors AS (
        SELECT DISTINCT cc.full_name AS contributor
        FROM linear_detail ld
        JOIN commit_contributors cc ON (
          ld.assignee = cc.email OR ld.assignee = cc.login OR ld.assignee = cc.full_name
        )
        WHERE cc.team = $1
          AND ld.completed_date >= $2
          AND ld.state IN ('Done', 'Completed')
          AND ld.calculated_story_points > 0
      ),
      jira_contributors AS (
        SELECT DISTINCT cc.full_name AS contributor
        FROM jira_history jh
        JOIN jira_detail jd ON jh.jira_key = jd.jira_key
        JOIN commit_contributors cc ON jd.assignee = COALESCE(cc.jira_name, cc.full_name)
        WHERE cc.team = $1
          AND jh.change_date >= $2
          AND jh.field = 'status'
          AND jh.to_value IN ('Done', 'Closed', 'Resolved')
          AND jd.calculated_story_points > 0
      ),
      all_contributors AS (
        SELECT contributor FROM linear_contributors
        UNION
        SELECT contributor FROM jira_contributors
      )
      SELECT COUNT(DISTINCT contributor)::int AS contributor_count
      FROM all_contributors
    `;

    const result = await this.db.query<{ contributor_count: number }>(sql, [team, startDate]);
    return result.rows[0]?.contributor_count ?? 0;
  }

  /**
   * Get LOC per period data for the stacked bar chart.
   * Aggregates across all team members by repository.
   * Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
   *
   * @param filters - Team and timeframe filters
   * @returns Array of LOC data points by repository per period (week or month)
   */
  async getLocPerWeek(filters: TeamProfileFilters): Promise<TeamProfileLocWeekly[]> {
    this.validateTeam(filters.team, 'getLocPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getLocPerWeek');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getLocPerWeek');
    this.logger.debug(CLASS_NAME, 'getLocPerWeek', `Fetching LOC per ${aggregationPeriod} for team ${filters.team}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-186: Use consistent join pattern - ch.author stores git author name (full_name)
    const sql = `
      WITH team_members AS (
        SELECT DISTINCT login, full_name
        FROM commit_contributors
        WHERE team = $1
      )
      SELECT
        DATE_TRUNC($3, ch.commit_date)::date AS week_start,
        ch.repository,
        COALESCE(SUM(cf.line_inserts), 0)::bigint AS lines_added,
        COALESCE(SUM(cf.line_deletes), 0)::bigint AS lines_removed,
        COALESCE(SUM(cf.line_inserts - cf.line_deletes), 0)::bigint AS net_lines
      FROM commit_history ch
      LEFT JOIN commit_files cf ON cf.sha = ch.sha
      JOIN team_members tm ON (
        ch.author = tm.full_name
        OR (tm.full_name IS NULL AND ch.author = tm.login)
      )
      WHERE ch.commit_date >= $2
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
    }>(sql, [filters.team, startDate, aggregationPeriod]);

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
   * Get top 15 most complex files modified by any team member.
   * Shows highest complexity across all team members.
   *
   * @param filters - Team and timeframe filters
   * @returns Array of complex file data points
   */
  async getTopComplexFiles(filters: TeamProfileFilters): Promise<TeamProfileComplexFile[]> {
    this.validateTeam(filters.team, 'getTopComplexFiles');
    this.validateTimeframe(filters.timeframeDays, 'getTopComplexFiles');

    this.logger.debug(CLASS_NAME, 'getTopComplexFiles', `Fetching top complex files for team ${filters.team}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-186: Use consistent join pattern - ch.author stores git author name (full_name)
    const sql = `
      WITH team_members AS (
        SELECT DISTINCT login, full_name
        FROM commit_contributors
        WHERE team = $1
      )
      SELECT
        cf.filename AS file_path,
        MAX(cf.complexity)::int AS complexity_score,
        ch.repository,
        MAX(ch.commit_date)::date AS last_modified
      FROM commit_files cf
      JOIN commit_history ch ON ch.sha = cf.sha
      JOIN team_members tm ON (
        ch.author = tm.full_name
        OR (tm.full_name IS NULL AND ch.author = tm.login)
      )
      WHERE ch.commit_date >= $2
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
    }>(sql, [filters.team, startDate]);

    this.logger.debug(CLASS_NAME, 'getTopComplexFiles', `Found ${result.rowCount} complex files`);

    return result.rows.map((row) => ({
      filePath: row.file_path,
      complexityScore: row.complexity_score,
      repository: row.repository,
      lastModified: row.last_modified.toISOString().split('T')[0] ?? '',
    }));
  }

  /**
   * Get top 20 most frequently modified files by the team.
   * Aggregates modifications across all team members.
   *
   * @param filters - Team and timeframe filters
   * @returns Array of frequent file data points with lastModified date
   */
  async getTopFrequentFiles(filters: TeamProfileFilters): Promise<TeamProfileFrequentFile[]> {
    this.validateTeam(filters.team, 'getTopFrequentFiles');
    this.validateTimeframe(filters.timeframeDays, 'getTopFrequentFiles');

    this.logger.debug(CLASS_NAME, 'getTopFrequentFiles', `Fetching top frequent files for team ${filters.team}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-186: Use consistent join pattern - ch.author stores git author name (full_name)
    const sql = `
      WITH team_members AS (
        SELECT DISTINCT login, full_name
        FROM commit_contributors
        WHERE team = $1
      )
      SELECT
        cf.filename AS file_path,
        COUNT(DISTINCT cf.sha)::int AS modification_count,
        COALESCE(SUM(ABS(cf.line_inserts) + ABS(COALESCE(cf.line_deletes, 0))), 0)::bigint AS total_loc_changed,
        MAX(ch.commit_date)::date AS last_modified
      FROM commit_files cf
      JOIN commit_history ch ON ch.sha = cf.sha
      JOIN team_members tm ON (
        ch.author = tm.full_name
        OR (tm.full_name IS NULL AND ch.author = tm.login)
      )
      WHERE ch.commit_date >= $2
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
    }>(sql, [filters.team, startDate]);

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
   * Aggregates across all team members.
   *
   * @param filters - Team and timeframe filters
   * @returns Array of tech stack data points with percentages
   */
  async getTechStack(filters: TeamProfileFilters): Promise<TeamProfileTechStack[]> {
    this.validateTeam(filters.team, 'getTechStack');
    this.validateTimeframe(filters.timeframeDays, 'getTechStack');

    this.logger.debug(CLASS_NAME, 'getTechStack', `Fetching tech stack for team ${filters.team}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-186: Use consistent join pattern - ch.author stores git author name (full_name)
    // Query aggregates LOC by technology stack category using the view
    const sql = `
      WITH team_members AS (
        SELECT DISTINCT login, full_name
        FROM commit_contributors
        WHERE team = $1
      ),
      team_contributions AS (
        SELECT
          vtsc.category,
          ch.repository,
          COALESCE(SUM(cf.line_inserts), 0)::bigint AS loc_count
        FROM commit_files cf
        JOIN commit_history ch ON cf.sha = ch.sha
        JOIN team_members tm ON (
          ch.author = tm.full_name
          OR (tm.full_name IS NULL AND ch.author = tm.login)
        )
        JOIN vw_technology_stack_category vtsc ON cf.file_extension = vtsc.file_extension
        WHERE ch.commit_date >= $2
          AND ch.is_merge = FALSE
          AND cf.line_inserts IS NOT NULL
        GROUP BY vtsc.category, ch.repository
      ),
      total_loc AS (
        SELECT COALESCE(SUM(loc_count), 0) AS total FROM team_contributions
      )
      SELECT
        tc.category,
        tc.repository,
        tc.loc_count,
        CASE
          WHEN tl.total > 0 THEN ROUND((tc.loc_count * 100.0 / tl.total)::numeric, 2)
          ELSE 0
        END AS percentage
      FROM team_contributions tc
      CROSS JOIN total_loc tl
      WHERE tc.loc_count > 0
      ORDER BY tc.loc_count DESC
    `;

    const result = await this.db.query<{
      category: string;
      repository: string;
      loc_count: string;
      percentage: string;
    }>(sql, [filters.team, startDate]);

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
   * Aggregates across all team members.
   * Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
   *
   * @param filters - Team and timeframe filters
   * @returns Array of comment data points per period (week or month)
   */
  async getCommentsPerWeek(filters: TeamProfileFilters): Promise<TeamProfileCommentsWeekly[]> {
    this.validateTeam(filters.team, 'getCommentsPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getCommentsPerWeek');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getCommentsPerWeek');
    this.logger.debug(CLASS_NAME, 'getCommentsPerWeek', `Fetching comments per ${aggregationPeriod} for team ${filters.team}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-186: Use consistent join pattern - ch.author stores git author name (full_name)
    const sql = `
      WITH team_members AS (
        SELECT DISTINCT login, full_name
        FROM commit_contributors
        WHERE team = $1
      )
      SELECT
        DATE_TRUNC($3, ch.commit_date)::date AS week_start,
        COALESCE(SUM(COALESCE(cf.comments_change, 0)), 0)::int AS comments_added
      FROM commit_files cf
      JOIN commit_history ch ON cf.sha = ch.sha
      JOIN team_members tm ON (
        ch.author = tm.full_name
        OR (tm.full_name IS NULL AND ch.author = tm.login)
      )
      WHERE ch.commit_date >= $2
        AND ch.is_merge = FALSE
      GROUP BY week_start
      ORDER BY week_start ASC
    `;

    const result = await this.db.query<{
      week_start: Date;
      comments_added: number;
    }>(sql, [filters.team, startDate, aggregationPeriod]);

    this.logger.debug(CLASS_NAME, 'getCommentsPerWeek', `Found ${result.rowCount} ${aggregationPeriod}ly comment data points`);

    return result.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      commentsAdded: row.comments_added,
    }));
  }

  /**
   * Get tests modified per period for the line chart.
   * Aggregates across all team members.
   * Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
   *
   * @param filters - Team and timeframe filters
   * @returns Array of test data points per period (week or month)
   */
  async getTestsPerWeek(filters: TeamProfileFilters): Promise<TeamProfileTestsWeekly[]> {
    this.validateTeam(filters.team, 'getTestsPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getTestsPerWeek');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getTestsPerWeek');
    this.logger.debug(CLASS_NAME, 'getTestsPerWeek', `Fetching tests per ${aggregationPeriod} for team ${filters.team}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-186: Use consistent join pattern - ch.author stores git author name (full_name)
    const sql = `
      WITH team_members AS (
        SELECT DISTINCT login, full_name
        FROM commit_contributors
        WHERE team = $1
      )
      SELECT
        DATE_TRUNC($3, ch.commit_date)::date AS week_start,
        COUNT(DISTINCT cf.filename)::int AS test_files_modified,
        COALESCE(SUM(cf.line_inserts), 0)::int AS test_lines_added
      FROM commit_files cf
      JOIN commit_history ch ON cf.sha = ch.sha
      JOIN team_members tm ON (
        ch.author = tm.full_name
        OR (tm.full_name IS NULL AND ch.author = tm.login)
      )
      WHERE ch.commit_date >= $2
        AND ch.is_merge = FALSE
        AND cf.is_test_file = TRUE
      GROUP BY week_start
      ORDER BY week_start ASC
    `;

    const result = await this.db.query<{
      week_start: Date;
      test_files_modified: number;
      test_lines_added: number;
    }>(sql, [filters.team, startDate, aggregationPeriod]);

    this.logger.debug(CLASS_NAME, 'getTestsPerWeek', `Found ${result.rowCount} ${aggregationPeriod}ly test data points`);

    return result.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      testFilesModified: row.test_files_modified,
      testLinesAdded: row.test_lines_added,
    }));
  }

  /**
   * Get commit hygiene score from vw_commit_hygiene view.
   * Aggregates across all team members.
   * Calculates weighted score: (jira_ref * 0.4) + (meaningful_msg * 0.4) + (non_merge * 0.2)
   *
   * @param filters - Team and timeframe filters
   * @returns Hygiene score breakdown
   */
  async getHygieneScore(filters: TeamProfileFilters): Promise<TeamProfileHygieneScore> {
    this.validateTeam(filters.team, 'getHygieneScore');
    this.validateTimeframe(filters.timeframeDays, 'getHygieneScore');

    this.logger.debug(CLASS_NAME, 'getHygieneScore', `Fetching hygiene score for team ${filters.team}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // GITX-186: Use consistent join pattern - vch.author stores git author name (full_name)
    // Query the vw_commit_hygiene view and calculate component percentages
    const sql = `
      WITH team_members AS (
        SELECT DISTINCT login, full_name
        FROM commit_contributors
        WHERE team = $1
      ),
      hygiene_stats AS (
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
        JOIN team_members tm ON (
          vch.author = tm.full_name
          OR (tm.full_name IS NULL AND vch.author = tm.login)
        )
        WHERE vch.commit_date >= $2
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
    }>(sql, [filters.team, startDate]);

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
   * Aggregates across all team members.
   * Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
   *
   * @param filters - Team and timeframe filters
   * @returns Array of velocity data points per period (week or month)
   */
  async getVelocityVsLoc(filters: TeamProfileFilters): Promise<TeamProfileVelocityPoint[]> {
    this.validateTeam(filters.team, 'getVelocityVsLoc');
    this.validateTimeframe(filters.timeframeDays, 'getVelocityVsLoc');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getVelocityVsLoc');
    this.logger.debug(CLASS_NAME, 'getVelocityVsLoc', `Fetching velocity vs LOC per ${aggregationPeriod} for team ${filters.team}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<{
      week_start: Date;
      story_points: number;
      lines_of_code: string;
      issue_count: number;
      commit_count: number;
    }>(QUERY_TEAM_PROFILE_VELOCITY_VS_LOC, [filters.team, startDate, aggregationPeriod]);

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
   * Check if velocity data is available for a team.
   * Returns true if any team member has Linear/Jira issues assigned.
   *
   * @param team - Team name
   * @returns true if velocity data exists
   */
  async hasVelocityData(team: string): Promise<boolean> {
    this.validateTeam(team, 'hasVelocityData');

    this.logger.debug(CLASS_NAME, 'hasVelocityData', `Checking velocity data availability for team ${team}`);

    const result = await this.db.query<{ has_data: boolean }>(
      QUERY_TEAM_PROFILE_HAS_VELOCITY_DATA,
      [team]
    );
    const hasData = result.rows[0]?.has_data ?? false;

    this.logger.debug(CLASS_NAME, 'hasVelocityData', `Velocity data available: ${hasData}`);
    return hasData;
  }

  /**
   * Get test debt metrics for a team.
   * Returns period breakdown of commits by test coverage tier and ROI calculation.
   * Aggregates across all team members.
   * Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
   *
   * @param filters - Team and timeframe filters
   * @returns Test debt metrics with period data and ROI multiplier
   */
  async getTestDebtMetrics(filters: TeamProfileFilters): Promise<TeamProfileTestDebtMetrics> {
    this.validateTeam(filters.team, 'getTestDebtMetrics');
    this.validateTimeframe(filters.timeframeDays, 'getTestDebtMetrics');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getTestDebtMetrics');
    this.logger.debug(CLASS_NAME, 'getTestDebtMetrics', `Fetching test debt metrics per ${aggregationPeriod} for team ${filters.team}`);

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
        orgAvgRoiMultiplier: null,
      };
    }

    // GITX-186: Use consistent join pattern - ctr.author stores git author name (full_name)
    // Query period test debt breakdown by tier
    const weeklyQuery = `
      WITH team_members AS (
        SELECT DISTINCT login, full_name
        FROM commit_contributors
        WHERE team = $1
      )
      SELECT
        DATE_TRUNC($3, ctr.commit_date)::DATE AS week_start,
        COUNT(*) FILTER (WHERE ctr.test_ratio IS NULL OR ctr.test_ratio < 0.1)::int AS low_test_commits,
        COUNT(*) FILTER (WHERE ctr.test_ratio >= 0.1 AND ctr.test_ratio < 0.5)::int AS medium_test_commits,
        COUNT(*) FILTER (WHERE ctr.test_ratio >= 0.5)::int AS high_test_commits,
        COUNT(*)::int AS total_commits
      FROM vw_commit_test_ratio ctr
      JOIN team_members tm ON (
        ctr.author = tm.full_name
        OR (tm.full_name IS NULL AND ctr.author = tm.login)
      )
      WHERE ctr.commit_date >= $2
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
    }>(weeklyQuery, [filters.team, startDate, aggregationPeriod]);

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
    let orgAvgRoiMultiplier: number | null = null;

    if (bugsViewExistsResult.rows[0]?.view_exists) {
      // GITX-186: Use consistent join pattern - ctr.author stores git author name (full_name)
      // Query team's bug rates by tier
      const bugRateQuery = `
        WITH team_members AS (
          SELECT DISTINCT login, full_name
          FROM commit_contributors
          WHERE team = $1
        ),
        team_commits AS (
          SELECT
            ctr.sha,
            ctr.test_ratio,
            COALESCE(sb.jira_bugs_filed, 0) + COALESCE(sb.linear_bugs_filed, 0) AS subsequent_bugs
          FROM vw_commit_test_ratio ctr
          LEFT JOIN vw_subsequent_bugs sb ON ctr.sha = sb.original_sha
          JOIN team_members tm ON (
            ctr.author = tm.full_name
            OR (tm.full_name IS NULL AND ctr.author = tm.login)
          )
          WHERE ctr.commit_date >= $2
            AND ctr.prod_loc_changed >= 50
        )
        SELECT
          COUNT(*) FILTER (WHERE test_ratio IS NULL OR test_ratio < 0.1)::int AS low_test_count,
          COUNT(*) FILTER (WHERE test_ratio >= 0.5)::int AS high_test_count,
          SUM(subsequent_bugs) FILTER (WHERE test_ratio IS NULL OR test_ratio < 0.1)::int AS low_test_bugs,
          SUM(subsequent_bugs) FILTER (WHERE test_ratio >= 0.5)::int AS high_test_bugs,
          COUNT(*)::int AS total_commits
        FROM team_commits
      `;

      const bugRateResult = await this.db.query<{
        low_test_count: number;
        high_test_count: number;
        low_test_bugs: number;
        high_test_bugs: number;
        total_commits: number;
      }>(bugRateQuery, [filters.team, startDate]);

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

      // Query organization average ROI for comparison
      const orgAvgQuery = `
        WITH org_commits AS (
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
        FROM org_commits
      `;

      const orgAvgResult = await this.db.query<{
        low_test_count: number;
        high_test_count: number;
        low_test_bugs: number;
        high_test_bugs: number;
      }>(orgAvgQuery, [startDate]);

      const orgRow = orgAvgResult.rows[0];
      if (orgRow) {
        const orgLowTestCount = orgRow.low_test_count ?? 0;
        const orgHighTestCount = orgRow.high_test_count ?? 0;
        const orgLowTestBugs = orgRow.low_test_bugs ?? 0;
        const orgHighTestBugs = orgRow.high_test_bugs ?? 0;

        const orgLowRate = orgLowTestCount > 0 ? orgLowTestBugs / orgLowTestCount : 0;
        const orgHighRate = orgHighTestCount > 0 ? orgHighTestBugs / orgHighTestCount : 0;

        if (orgHighRate > 0) {
          orgAvgRoiMultiplier = Number((orgLowRate / orgHighRate).toFixed(1));
        }
      }
    }

    // Calculate ROI multiplier
    const roiMultiplier = highTestBugRate > 0 ? Number((lowTestBugRate / highTestBugRate).toFixed(1)) : 0;

    // Build weekly data array
    const weeklyData: TeamProfileTestDebtWeekly[] = weeklyResult.rows.map((row) => ({
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
      orgAvgRoiMultiplier,
    };
  }
}
