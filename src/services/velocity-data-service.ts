/**
 * Data service for the Sprint Velocity vs LOC chart.
 * Provides methods to fetch velocity and LOC data from the
 * vw_sprint_velocity_vs_loc database view, with optional filtering
 * by date range and team.
 *
 * All queries use parameterized SQL ($1, $2 placeholders).
 *
 * Ticket: IQS-888
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import { isValidRepositoryName } from '../utils/repository-validation.js';
import {
  QUERY_SPRINT_VELOCITY_VS_LOC,
  QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE,
  QUERY_SPRINT_VELOCITY_VS_LOC_TEAM,
  QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM,
  QUERY_SPRINT_VELOCITY_VS_LOC_REPOSITORY,
  QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_REPOSITORY,
  QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_REPOSITORY,
  QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_REPOSITORY,
  QUERY_VELOCITY_VIEW_EXISTS,
} from '../database/queries/velocity-queries.js';
import type {
  SprintVelocityVsLocPoint,
  VelocityChartData,
  VelocityFilters,
} from './velocity-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'VelocityDataService';

/**
 * Maximum number of rows returned from the velocity query.
 * Prevents excessive memory usage (~200 weeks = 4 years).
 */
const MAX_RESULT_ROWS = 200;

/**
 * Service responsible for querying the vw_sprint_velocity_vs_loc database
 * view and returning typed data for the Sprint Velocity vs LOC chart.
 *
 * Ticket: IQS-888
 */
export class VelocityDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'VelocityDataService created');
  }

  /**
   * Check if the vw_sprint_velocity_vs_loc view exists.
   * Used for graceful degradation when migration 008 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkViewExists', 'Checking vw_sprint_velocity_vs_loc existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_VELOCITY_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkViewExists', `vw_sprint_velocity_vs_loc exists: ${exists}`);
    return exists;
  }

  /**
   * Fetch sprint velocity vs LOC data with optional filters.
   * Validates date inputs before query execution.
   *
   * @param filters - Optional date range and team filters
   * @returns Array of SprintVelocityVsLocPoint sorted by week ascending
   */
  async getSprintVelocityVsLoc(filters: VelocityFilters = {}): Promise<readonly SprintVelocityVsLocPoint[]> {
    this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', `Fetching data: filters=${JSON.stringify(filters)}`);

    const hasDateRange = filters.startDate && filters.endDate;
    const hasTeam = Boolean(filters.team);
    const hasRepository = Boolean(filters.repository);

    // Validate date inputs
    if (filters.startDate && !isValidDateString(filters.startDate)) {
      this.logger.warn(CLASS_NAME, 'getSprintVelocityVsLoc', `Invalid start date rejected: ${filters.startDate}`);
      throw new Error(`Invalid start date format: ${filters.startDate}. Expected YYYY-MM-DD.`);
    }
    if (filters.endDate && !isValidDateString(filters.endDate)) {
      this.logger.warn(CLASS_NAME, 'getSprintVelocityVsLoc', `Invalid end date rejected: ${filters.endDate}`);
      throw new Error(`Invalid end date format: ${filters.endDate}. Expected YYYY-MM-DD.`);
    }

    // Validate repository input (IQS-920)
    if (filters.repository && !isValidRepositoryName(filters.repository)) {
      this.logger.warn(CLASS_NAME, 'getSprintVelocityVsLoc', `Invalid repository name rejected: ${filters.repository}`);
      throw new Error(`Invalid repository name: ${filters.repository}. Must be 1-100 alphanumeric characters, dots, hyphens, or underscores.`);
    }

    // Select the appropriate query based on filters (8 combinations with repository)
    let sql: string;
    let params: unknown[];

    if (hasDateRange && hasTeam && hasRepository) {
      // Date range + team + repository
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_REPOSITORY;
      params = [filters.startDate, filters.endDate, filters.team, filters.repository];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using date range + team + repository filter query');
    } else if (hasDateRange && hasRepository) {
      // Date range + repository
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_REPOSITORY;
      params = [filters.startDate, filters.endDate, filters.repository];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using date range + repository filter query');
    } else if (hasTeam && hasRepository) {
      // Team + repository
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_REPOSITORY;
      params = [filters.team, filters.repository];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using team + repository filter query');
    } else if (hasRepository) {
      // Repository only
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using repository filter query');
    } else if (hasDateRange && hasTeam) {
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM;
      params = [filters.startDate, filters.endDate, filters.team];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using date range + team filter query');
    } else if (hasDateRange) {
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE;
      params = [filters.startDate, filters.endDate];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using date range filter query');
    } else if (hasTeam) {
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_TEAM;
      params = [filters.team];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using team filter query');
    } else {
      sql = QUERY_SPRINT_VELOCITY_VS_LOC;
      params = [];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using unfiltered query');
    }

    this.logger.trace(CLASS_NAME, 'getSprintVelocityVsLoc', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      week_start: Date | string;
      team: string | null;
      project: string | null;
      repository: string | null;
      total_story_points: number;
      issue_count: number;
      total_loc_changed: number;
      total_lines_added: number;
      total_lines_deleted: number;
      commit_count: number;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', `Query returned ${result.rows.length} rows`);

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, MAX_RESULT_ROWS);
    if (result.rows.length > MAX_RESULT_ROWS) {
      this.logger.warn(CLASS_NAME, 'getSprintVelocityVsLoc', `Result set truncated from ${result.rows.length} to ${MAX_RESULT_ROWS} rows`);
    }

    const rows: SprintVelocityVsLocPoint[] = limitedRows.map(row => ({
      weekStart: row.week_start instanceof Date
        ? row.week_start.toISOString().split('T')[0] ?? ''
        : String(row.week_start),
      team: row.team,
      project: row.project,
      repository: row.repository,
      totalStoryPoints: Number(row.total_story_points),
      issueCount: Number(row.issue_count),
      totalLocChanged: Number(row.total_loc_changed),
      totalLinesAdded: Number(row.total_lines_added),
      totalLinesDeleted: Number(row.total_lines_deleted),
      commitCount: Number(row.commit_count),
    }));

    this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', `Returning ${rows.length} velocity data points`);
    return rows;
  }

  /**
   * Get complete chart data including view existence check and velocity data.
   *
   * @param filters - Optional date range and team filters
   * @returns VelocityChartData with data points and metadata
   */
  async getChartData(filters: VelocityFilters = {}): Promise<VelocityChartData> {
    this.logger.debug(CLASS_NAME, 'getChartData', `Fetching chart data: filters=${JSON.stringify(filters)}`);

    // Check view existence for graceful degradation
    const viewExists = await this.checkViewExists();
    if (!viewExists) {
      this.logger.warn(CLASS_NAME, 'getChartData', 'vw_sprint_velocity_vs_loc view not found -- returning empty data');
      return {
        rows: [],
        hasData: false,
      };
    }

    const rows = await this.getSprintVelocityVsLoc(filters);

    this.logger.info(CLASS_NAME, 'getChartData', `Chart data ready: ${rows.length} weekly data points`);

    return {
      rows,
      hasData: rows.length > 0,
    };
  }
}
