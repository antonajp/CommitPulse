/**
 * Data service for the Story Points Trend chart.
 * Provides methods to fetch story points distribution data from
 * jira_history and jira_detail tables, with optional filtering
 * by date range and team.
 *
 * All queries use parameterized SQL ($1, $2 placeholders).
 *
 * Ticket: IQS-940
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import { isValidTeamName } from '../utils/team-validation.js';
import {
  QUERY_STORY_POINTS_TREND,
  QUERY_STORY_POINTS_TREND_TEAM,
  QUERY_STORY_POINTS_TREND_DATA_EXISTS,
  QUERY_STORY_POINTS_TREND_TEAMS,
} from '../database/queries/story-points-trend-queries.js';
import type {
  StoryPointsTrendPoint,
  StoryPointsTrendChartData,
  StoryPointsTrendFilters,
  StoryPointsTrendTeamsResponse,
} from './story-points-trend-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'StoryPointsTrendDataService';

/**
 * Default number of days to look back for trend data.
 */
const DEFAULT_DAYS_BACK = 30;

/**
 * Maximum number of rows returned from the trend query.
 * Prevents excessive memory usage.
 */
const MAX_RESULT_ROWS = 1000;

/**
 * Service responsible for querying Jira history and detail tables
 * and returning typed data for the Story Points Trend chart.
 *
 * Ticket: IQS-940
 */
export class StoryPointsTrendDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'StoryPointsTrendDataService created');
  }

  /**
   * Check if jira_history has status transition data.
   * Used for graceful degradation when no Jira data is available.
   *
   * @returns true if status transition data exists
   */
  async checkDataExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkDataExists', 'Checking jira_history status data existence');

    try {
      const result = await this.db.query<{ data_exists: boolean }>(QUERY_STORY_POINTS_TREND_DATA_EXISTS);
      const exists = result.rows[0]?.data_exists ?? false;

      this.logger.debug(CLASS_NAME, 'checkDataExists', `jira_history status data exists: ${exists}`);
      return exists;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'checkDataExists', `Error checking data existence: ${errorMsg}`);
      return false;
    }
  }

  /**
   * Fetch distinct teams for the filter dropdown.
   *
   * @returns Array of distinct team names
   */
  async getTeams(): Promise<StoryPointsTrendTeamsResponse> {
    this.logger.debug(CLASS_NAME, 'getTeams', 'Fetching distinct teams for filter');

    try {
      const result = await this.db.query<{ team: string }>(QUERY_STORY_POINTS_TREND_TEAMS);
      const teams = result.rows.map(row => row.team).filter(Boolean);

      this.logger.debug(CLASS_NAME, 'getTeams', `Found ${teams.length} distinct teams`);
      return { teams };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'getTeams', `Error fetching teams: ${errorMsg}`);
      return { teams: [] };
    }
  }

  /**
   * Fetch story points trend data with optional filters.
   * Validates date inputs before query execution.
   *
   * @param filters - Optional date range and team filters
   * @returns Array of StoryPointsTrendPoint sorted by date ascending
   */
  async getStoryPointsTrend(filters: StoryPointsTrendFilters = {}): Promise<readonly StoryPointsTrendPoint[]> {
    this.logger.debug(CLASS_NAME, 'getStoryPointsTrend', `Fetching data: filters=${JSON.stringify(filters)}`);

    // Calculate date range
    const daysBack = filters.daysBack ?? DEFAULT_DAYS_BACK;
    const endDate: string = filters.endDate ?? new Date().toISOString().split('T')[0]!;
    const startDate = filters.startDate ?? this.calculateStartDate(endDate, daysBack);

    // Validate date inputs
    if (startDate && !isValidDateString(startDate)) {
      this.logger.warn(CLASS_NAME, 'getStoryPointsTrend', `Invalid start date rejected: ${startDate}`);
      throw new Error(`Invalid start date format: ${startDate}. Expected YYYY-MM-DD.`);
    }
    if (endDate && !isValidDateString(endDate)) {
      this.logger.warn(CLASS_NAME, 'getStoryPointsTrend', `Invalid end date rejected: ${endDate}`);
      throw new Error(`Invalid end date format: ${endDate}. Expected YYYY-MM-DD.`);
    }

    // Validate team input
    if (filters.team && !isValidTeamName(filters.team)) {
      this.logger.warn(CLASS_NAME, 'getStoryPointsTrend', `Invalid team name rejected: ${filters.team}`);
      throw new Error(`Invalid team name: ${filters.team}. Must be 1-100 alphanumeric characters.`);
    }

    const hasTeam = Boolean(filters.team);

    // Select the appropriate query based on filters
    let sql: string;
    let params: unknown[];

    if (hasTeam) {
      sql = QUERY_STORY_POINTS_TREND_TEAM;
      params = [startDate, endDate, filters.team];
      this.logger.debug(CLASS_NAME, 'getStoryPointsTrend', 'Using team filter query');
    } else {
      sql = QUERY_STORY_POINTS_TREND;
      params = [startDate, endDate];
      this.logger.debug(CLASS_NAME, 'getStoryPointsTrend', 'Using unfiltered query');
    }

    this.logger.trace(CLASS_NAME, 'getStoryPointsTrend', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      transition_date: Date | string;
      status_category: string;
      total_story_points: number;
      ticket_count: number;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getStoryPointsTrend', `Query returned ${result.rows.length} rows`);

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, MAX_RESULT_ROWS);
    if (result.rows.length > MAX_RESULT_ROWS) {
      this.logger.warn(CLASS_NAME, 'getStoryPointsTrend', `Result set truncated from ${result.rows.length} to ${MAX_RESULT_ROWS} rows`);
    }

    const rows: StoryPointsTrendPoint[] = limitedRows.map(row => ({
      transitionDate: row.transition_date instanceof Date
        ? row.transition_date.toISOString().split('T')[0] ?? ''
        : String(row.transition_date),
      statusCategory: row.status_category,
      totalStoryPoints: Number(row.total_story_points),
      ticketCount: Number(row.ticket_count),
    }));

    this.logger.debug(CLASS_NAME, 'getStoryPointsTrend', `Returning ${rows.length} trend data points`);
    return rows;
  }

  /**
   * Get complete chart data including data existence check and trend data.
   *
   * @param filters - Optional date range and team filters
   * @returns StoryPointsTrendChartData with data points and metadata
   */
  async getChartData(filters: StoryPointsTrendFilters = {}): Promise<StoryPointsTrendChartData> {
    this.logger.debug(CLASS_NAME, 'getChartData', `Fetching chart data: filters=${JSON.stringify(filters)}`);

    // Check data existence for graceful degradation
    const dataExists = await this.checkDataExists();
    if (!dataExists) {
      this.logger.warn(CLASS_NAME, 'getChartData', 'jira_history status data not found -- returning empty data');
      return {
        rows: [],
        hasData: false,
      };
    }

    const rows = await this.getStoryPointsTrend(filters);

    this.logger.info(CLASS_NAME, 'getChartData', `Chart data ready: ${rows.length} daily data points`);

    return {
      rows,
      hasData: rows.length > 0,
    };
  }

  /**
   * Calculate start date based on end date and days back.
   *
   * @param endDate - End date in YYYY-MM-DD format
   * @param daysBack - Number of days to go back
   * @returns Start date in YYYY-MM-DD format
   */
  private calculateStartDate(endDate: string, daysBack: number): string {
    const end = new Date(endDate + 'T00:00:00Z');
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - daysBack);
    return start.toISOString().split('T')[0] ?? endDate;
  }
}
