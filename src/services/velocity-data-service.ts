/**
 * Data service for the Sprint Velocity vs LOC chart.
 * Provides methods to fetch velocity and LOC data from the
 * vw_sprint_velocity_vs_loc database view, with optional filtering
 * by date range, team, team member, and repository.
 *
 * All queries use parameterized SQL ($1, $2 placeholders).
 *
 * Ticket: IQS-888, IQS-944, GITX-121
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import { isValidContributorName } from '../utils/contributor-validation.js';
import { isValidRepositoryName } from '../utils/repository-validation.js';
import { isValidTeamName } from '../utils/team-validation.js';
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
  QUERY_VELOCITY_UNIQUE_TEAMS,
  QUERY_VELOCITY_UNIQUE_CONTRIBUTORS,
  QUERY_VELOCITY_UNIQUE_REPOSITORIES,
  QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_MEMBER,
  QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_MEMBER_COMBINED,
  QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_MEMBER_REPOSITORY,
  QUERY_SPRINT_VELOCITY_VS_LOC_ALL_FILTERS,
  QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_MEMBER,
  QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_MEMBER_COMBINED,
  QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_MEMBER_REPOSITORY,
  QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_ALL_FILTERS,
} from '../database/queries/velocity-queries.js';
import type {
  SprintVelocityVsLocPoint,
  VelocityChartData,
  VelocityFilters,
  VelocityFilterOptions,
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
   * Get filter options for team, team member, and repository dropdowns.
   * Queries distinct values from commit_contributors and commit_history.
   *
   * Ticket: GITX-121
   *
   * @returns VelocityFilterOptions with teams, teamMembers, and repositories arrays
   */
  async getFilterOptions(): Promise<VelocityFilterOptions> {
    this.logger.debug(CLASS_NAME, 'getFilterOptions', 'Fetching filter options');

    // Query all filter options in parallel
    // GITX-129: Use 'repository' column name (not 'repo')
    const [teamsResult, membersResult, reposResult] = await Promise.all([
      this.db.query<{ team: string }>(QUERY_VELOCITY_UNIQUE_TEAMS),
      this.db.query<{ login: string }>(QUERY_VELOCITY_UNIQUE_CONTRIBUTORS),
      this.db.query<{ repository: string }>(QUERY_VELOCITY_UNIQUE_REPOSITORIES),
    ]);

    const teams = teamsResult.rows.map(row => row.team);
    const teamMembers = membersResult.rows.map(row => row.login);
    const repositories = reposResult.rows.map(row => row.repository);

    this.logger.debug(
      CLASS_NAME,
      'getFilterOptions',
      `Filter options: ${teams.length} teams, ${teamMembers.length} members, ${repositories.length} repos`,
    );

    return { teams, teamMembers, repositories };
  }

  /**
   * Fetch sprint velocity vs LOC data with optional filters.
   * Validates date inputs before query execution.
   *
   * @param filters - Optional date range, team, team member, and repository filters
   * @returns Array of SprintVelocityVsLocPoint sorted by week ascending
   */
  async getSprintVelocityVsLoc(filters: VelocityFilters = {}): Promise<readonly SprintVelocityVsLocPoint[]> {
    this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', `Fetching data: filters=${JSON.stringify(filters)}`);

    const hasDateRange = filters.startDate && filters.endDate;
    const hasTeam = Boolean(filters.team);
    const hasTeamMember = Boolean(filters.teamMember);
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

    // Validate team input (IQS-944)
    if (filters.team && !isValidTeamName(filters.team)) {
      this.logger.warn(CLASS_NAME, 'getSprintVelocityVsLoc', `Invalid team name rejected: ${filters.team}`);
      throw new Error(`Invalid team name: ${filters.team}. Must be 1-100 alphanumeric characters, spaces, hyphens, underscores, or periods.`);
    }

    // Validate team member input (GITX-121)
    if (filters.teamMember && !isValidContributorName(filters.teamMember)) {
      this.logger.warn(CLASS_NAME, 'getSprintVelocityVsLoc', `Invalid team member rejected: ${filters.teamMember}`);
      throw new Error(`Invalid team member: ${filters.teamMember}. Must be 1-200 alphanumeric characters, dots, hyphens, underscores, spaces, or @.`);
    }

    // Select the appropriate query based on filters (16 combinations with team member)
    let sql: string;
    let params: unknown[];

    // Priority order: DateRange > Team > TeamMember > Repository
    if (hasDateRange && hasTeam && hasTeamMember && hasRepository) {
      // All filters
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_ALL_FILTERS;
      params = [filters.startDate, filters.endDate, filters.team, filters.teamMember, filters.repository];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using date range + team + member + repository filter query');
    } else if (hasDateRange && hasTeamMember && hasRepository) {
      // Date range + team member + repository (no team)
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_MEMBER_REPOSITORY;
      params = [filters.startDate, filters.endDate, filters.teamMember, filters.repository];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using date range + member + repository filter query');
    } else if (hasDateRange && hasTeam && hasTeamMember) {
      // Date range + team + team member (no repository)
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_MEMBER_COMBINED;
      params = [filters.startDate, filters.endDate, filters.team, filters.teamMember];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using date range + team + member filter query');
    } else if (hasDateRange && hasTeamMember) {
      // Date range + team member only
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_MEMBER;
      params = [filters.startDate, filters.endDate, filters.teamMember];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using date range + member filter query');
    } else if (hasTeam && hasTeamMember && hasRepository) {
      // Team + team member + repository (no date range)
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_ALL_FILTERS;
      params = [filters.team, filters.teamMember, filters.repository];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using team + member + repository filter query');
    } else if (hasTeamMember && hasRepository) {
      // Team member + repository (no team, no date range)
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_MEMBER_REPOSITORY;
      params = [filters.teamMember, filters.repository];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using member + repository filter query');
    } else if (hasTeam && hasTeamMember) {
      // Team + team member (no repository, no date range)
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_MEMBER_COMBINED;
      params = [filters.team, filters.teamMember];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using team + member filter query');
    } else if (hasTeamMember) {
      // Team member only
      sql = QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_MEMBER;
      params = [filters.teamMember];
      this.logger.debug(CLASS_NAME, 'getSprintVelocityVsLoc', 'Using member filter query');
    } else if (hasDateRange && hasTeam && hasRepository) {
      // Date range + team + repository (no team member)
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
      human_story_points: number;
      ai_story_points: number;
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
      humanStoryPoints: Number(row.human_story_points ?? 0),
      aiStoryPoints: Number(row.ai_story_points ?? 0),
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
