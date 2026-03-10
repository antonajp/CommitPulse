/**
 * Data service for the Developer Focus Score dashboard.
 * Provides methods to fetch focus scores from the vw_developer_focus
 * and vw_developer_daily_activity database views, with optional filtering.
 *
 * The Developer Focus dashboard helps engineering managers understand:
 *   - How many different tickets does a developer touch per day/week?
 *   - Are developers being pulled in too many directions?
 *   - What's the correlation between focus and code quality?
 *   - Which team members need workload rebalancing?
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-907
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import {
  QUERY_FOCUS_VIEW_EXISTS,
  QUERY_DAILY_ACTIVITY_VIEW_EXISTS,
  QUERY_FOCUS_ALL,
  QUERY_FOCUS_BY_DATE_RANGE,
  QUERY_FOCUS_BY_AUTHOR,
  QUERY_FOCUS_BY_CATEGORY,
  QUERY_FOCUS_COMBINED,
  QUERY_DAILY_ACTIVITY_ALL,
  QUERY_DAILY_ACTIVITY_BY_DATE_RANGE,
  QUERY_DAILY_ACTIVITY_BY_AUTHOR,
  QUERY_DAILY_ACTIVITY_COMBINED,
  QUERY_FOCUS_SUMMARY,
  QUERY_FOCUS_TRENDS,
  QUERY_TEAM_AVG_BY_WEEK,
  type FocusDbRow,
  type DailyActivityDbRow,
  type FocusSummaryDbRow,
  type TrendDbRow,
  type TeamAvgDbRow,
} from '../database/queries/focus-queries.js';
import type {
  DeveloperDailyActivity,
  DeveloperFocusRow,
  FocusFilters,
  FocusTrendData,
  DeveloperTrendPoint,
  TeamFocusSummary,
  FocusChartData,
  DailyActivityChartData,
  FocusCategory,
} from './developer-focus-types.js';
import {
  FOCUS_MAX_FILTER_LENGTH,
  FOCUS_MAX_RESULT_ROWS,
  VALID_FOCUS_CATEGORIES,
} from './developer-focus-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DeveloperFocusDataService';

/**
 * Service responsible for querying the vw_developer_focus and
 * vw_developer_daily_activity database views and returning typed data for
 * the Developer Focus Score dashboard.
 *
 * Ticket: IQS-907
 */
export class DeveloperFocusDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'DeveloperFocusDataService created');
  }

  /**
   * Check if the vw_developer_focus view exists.
   * Used for graceful degradation when migration 016 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkFocusViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkFocusViewExists', 'Checking vw_developer_focus existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_FOCUS_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkFocusViewExists', `vw_developer_focus exists: ${exists}`);
    return exists;
  }

  /**
   * Check if the vw_developer_daily_activity view exists.
   * Used for graceful degradation when migration 016 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkDailyActivityViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkDailyActivityViewExists', 'Checking vw_developer_daily_activity existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_DAILY_ACTIVITY_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkDailyActivityViewExists', `vw_developer_daily_activity exists: ${exists}`);
    return exists;
  }

  /**
   * Validate string filter inputs.
   * Enforces maximum length to prevent DoS attacks (CWE-20).
   *
   * @param value - String value to validate
   * @param fieldName - Name of the field for error message
   * @throws Error if value exceeds maximum length
   */
  private validateStringFilter(value: string | undefined, fieldName: string): void {
    if (value && value.length > FOCUS_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${FOCUS_MAX_FILTER_LENGTH}`
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${FOCUS_MAX_FILTER_LENGTH} characters`
      );
    }
  }

  /**
   * Validate focus category filter input.
   * Ensures value is one of the valid focus categories.
   *
   * @param value - Focus category value to validate
   * @throws Error if value is not a valid focus category
   */
  private validateFocusCategory(value: FocusCategory | undefined): void {
    if (value && !VALID_FOCUS_CATEGORIES.includes(value)) {
      this.logger.warn(CLASS_NAME, 'validateFocusCategory', `Invalid focus category: ${value}`);
      throw new Error(`Invalid focus category: ${value}. Must be one of: ${VALID_FOCUS_CATEGORIES.join(', ')}`);
    }
  }

  /**
   * Validate date filter input.
   * Ensures value is a valid ISO date string.
   *
   * @param value - Date string to validate
   * @param fieldName - Name of the field for error message
   * @throws Error if value is not a valid date
   */
  private validateDateFilter(value: string | undefined, fieldName: string): void {
    if (value) {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        this.logger.warn(CLASS_NAME, 'validateDateFilter', `Invalid date for ${fieldName}: ${value}`);
        throw new Error(`Invalid date format for ${fieldName}: ${value}`);
      }
    }
  }

  /**
   * Map database row to DeveloperDailyActivity.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToDailyActivity(row: DailyActivityDbRow): DeveloperDailyActivity {
    const commitDay =
      row.commit_day instanceof Date
        ? row.commit_day.toISOString().split('T')[0] ?? ''
        : String(row.commit_day).split('T')[0] ?? '';

    return {
      author: row.author,
      commitDay,
      repository: row.repository,
      commitCount: Number(row.commit_count),
      uniqueTickets: Number(row.unique_tickets),
      uniqueFiles: Number(row.unique_files),
      totalLocChanged: Number(row.total_loc_changed),
      ticketSwitches: Number(row.ticket_switches),
    };
  }

  /**
   * Map database row to DeveloperFocusRow.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToFocusRow(row: FocusDbRow): DeveloperFocusRow {
    const weekStart =
      row.week_start instanceof Date
        ? row.week_start.toISOString()
        : String(row.week_start);

    return {
      author: row.author,
      weekStart,
      totalCommits: Number(row.total_commits),
      totalUniqueTickets: Number(row.total_unique_tickets),
      totalUniqueFiles: Number(row.total_unique_files),
      totalLoc: Number(row.total_loc),
      activeDays: Number(row.active_days),
      avgTicketsPerDay: Number(row.avg_tickets_per_day),
      focusScore: Number(row.focus_score),
      locPerCommit: Number(row.loc_per_commit),
      commitsPerTicket: Number(row.commits_per_ticket),
      focusCategory: row.focus_category,
      focusScoreDelta: row.focus_score_delta !== null ? Number(row.focus_score_delta) : null,
    };
  }

  /**
   * Fetch daily activities with optional filters.
   *
   * @param filters - Optional date range and author filters
   * @returns Array of DeveloperDailyActivity sorted by commit_day descending
   */
  async getDailyActivities(filters: FocusFilters = {}): Promise<readonly DeveloperDailyActivity[]> {
    this.logger.debug(
      CLASS_NAME,
      'getDailyActivities',
      `Fetching daily activities: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateDateFilter(filters.startDate, 'startDate');
    this.validateDateFilter(filters.endDate, 'endDate');
    this.validateStringFilter(filters.author, 'author');

    // Determine which query to use based on filter combination
    const hasStartDate = Boolean(filters.startDate);
    const hasEndDate = Boolean(filters.endDate);
    const hasAuthor = Boolean(filters.author);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [hasStartDate || hasEndDate, hasAuthor].filter(Boolean).length;

    if (filterCount === 0) {
      // No filters - use simple query
      sql = QUERY_DAILY_ACTIVITY_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getDailyActivities', 'Using unfiltered query');
    } else if (filterCount === 1 && (hasStartDate || hasEndDate)) {
      // Single date range filter
      sql = QUERY_DAILY_ACTIVITY_BY_DATE_RANGE;
      params = [
        filters.startDate ?? new Date(0).toISOString(),
        filters.endDate ?? new Date().toISOString(),
      ];
      this.logger.debug(CLASS_NAME, 'getDailyActivities', 'Using date range query');
    } else if (filterCount === 1 && hasAuthor) {
      // Single author filter
      sql = QUERY_DAILY_ACTIVITY_BY_AUTHOR;
      params = [filters.author];
      this.logger.debug(CLASS_NAME, 'getDailyActivities', 'Using author query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_DAILY_ACTIVITY_COMBINED;
      params = [
        filters.startDate ?? null,
        filters.endDate ?? null,
        filters.author ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getDailyActivities', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getDailyActivities', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<DailyActivityDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getDailyActivities',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, FOCUS_MAX_RESULT_ROWS);
    if (result.rows.length > FOCUS_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getDailyActivities',
        `Result set truncated from ${result.rows.length} to ${FOCUS_MAX_RESULT_ROWS} rows`
      );
    }

    const activities: DeveloperDailyActivity[] = limitedRows.map((row) => this.mapRowToDailyActivity(row));

    this.logger.debug(
      CLASS_NAME,
      'getDailyActivities',
      `Returning ${activities.length} activity records`
    );
    return activities;
  }

  /**
   * Fetch focus scores with optional filters.
   *
   * @param filters - Optional date range, author, and focus category filters
   * @returns Array of DeveloperFocusRow sorted by week_start descending
   */
  async getFocusScores(filters: FocusFilters = {}): Promise<readonly DeveloperFocusRow[]> {
    this.logger.debug(
      CLASS_NAME,
      'getFocusScores',
      `Fetching focus scores: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateDateFilter(filters.startDate, 'startDate');
    this.validateDateFilter(filters.endDate, 'endDate');
    this.validateStringFilter(filters.author, 'author');
    this.validateFocusCategory(filters.focusCategory);

    // Determine which query to use based on filter combination
    const hasStartDate = Boolean(filters.startDate);
    const hasEndDate = Boolean(filters.endDate);
    const hasAuthor = Boolean(filters.author);
    const hasFocusCategory = Boolean(filters.focusCategory);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [hasStartDate || hasEndDate, hasAuthor, hasFocusCategory].filter(Boolean).length;

    if (filterCount === 0) {
      // No filters - use simple query
      sql = QUERY_FOCUS_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getFocusScores', 'Using unfiltered query');
    } else if (filterCount === 1 && (hasStartDate || hasEndDate)) {
      // Single date range filter
      sql = QUERY_FOCUS_BY_DATE_RANGE;
      params = [
        filters.startDate ?? new Date(0).toISOString(),
        filters.endDate ?? new Date().toISOString(),
      ];
      this.logger.debug(CLASS_NAME, 'getFocusScores', 'Using date range query');
    } else if (filterCount === 1 && hasAuthor) {
      // Single author filter
      sql = QUERY_FOCUS_BY_AUTHOR;
      params = [filters.author];
      this.logger.debug(CLASS_NAME, 'getFocusScores', 'Using author query');
    } else if (filterCount === 1 && hasFocusCategory) {
      // Single focus category filter
      sql = QUERY_FOCUS_BY_CATEGORY;
      params = [filters.focusCategory];
      this.logger.debug(CLASS_NAME, 'getFocusScores', 'Using focus category query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_FOCUS_COMBINED;
      params = [
        filters.startDate ?? null,
        filters.endDate ?? null,
        filters.author ?? null,
        filters.focusCategory ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getFocusScores', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getFocusScores', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<FocusDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getFocusScores',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, FOCUS_MAX_RESULT_ROWS);
    if (result.rows.length > FOCUS_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getFocusScores',
        `Result set truncated from ${result.rows.length} to ${FOCUS_MAX_RESULT_ROWS} rows`
      );
    }

    const focusRows: DeveloperFocusRow[] = limitedRows.map((row) => this.mapRowToFocusRow(row));

    this.logger.debug(
      CLASS_NAME,
      'getFocusScores',
      `Returning ${focusRows.length} focus records`
    );
    return focusRows;
  }

  /**
   * Build focus trend data from database queries.
   * Creates time series data for focus score visualization.
   *
   * @param filters - Optional filters for the underlying data
   * @returns FocusTrendData with developer trends and team averages
   */
  async getFocusTrends(filters: FocusFilters = {}): Promise<FocusTrendData> {
    this.logger.debug(
      CLASS_NAME,
      'getFocusTrends',
      `Building focus trends: filters=${JSON.stringify(filters)}`
    );

    // Validate filters
    this.validateDateFilter(filters.startDate, 'startDate');
    this.validateDateFilter(filters.endDate, 'endDate');

    // Fetch trends and team averages in parallel
    const [trendResult, teamAvgResult] = await Promise.all([
      this.db.query<TrendDbRow>(QUERY_FOCUS_TRENDS, [
        filters.startDate ?? null,
        filters.endDate ?? null,
      ]),
      this.db.query<TeamAvgDbRow>(QUERY_TEAM_AVG_BY_WEEK, [
        filters.startDate ?? null,
        filters.endDate ?? null,
      ]),
    ]);

    // Extract unique weeks
    const weekSet = new Set<string>();
    for (const row of trendResult.rows) {
      const weekStart =
        row.week_start instanceof Date
          ? row.week_start.toISOString()
          : String(row.week_start);
      weekSet.add(weekStart);
    }
    const weeks = Array.from(weekSet).sort();

    // Build developer trends
    const developerMap = new Map<string, { scores: Map<string, number>; total: number; count: number }>();
    for (const row of trendResult.rows) {
      const author = row.author;
      const weekStart =
        row.week_start instanceof Date
          ? row.week_start.toISOString()
          : String(row.week_start);
      const score = Number(row.focus_score);

      if (!developerMap.has(author)) {
        developerMap.set(author, { scores: new Map(), total: 0, count: 0 });
      }

      const devData = developerMap.get(author)!;
      devData.scores.set(weekStart, score);
      devData.total += score;
      devData.count += 1;
    }

    // Convert to trend points
    const developers: DeveloperTrendPoint[] = [];
    for (const [name, data] of developerMap) {
      const scores: number[] = [];
      for (const week of weeks) {
        scores.push(data.scores.get(week) ?? 0);
      }
      developers.push({
        name,
        scores,
        avgScore: data.count > 0 ? Math.round((data.total / data.count) * 100) / 100 : 0,
        weekCount: data.count,
      });
    }

    // Build team averages by week
    const teamAvgByWeek: number[] = [];
    const teamAvgMap = new Map<string, number>();
    for (const row of teamAvgResult.rows) {
      const weekStart =
        row.week_start instanceof Date
          ? row.week_start.toISOString()
          : String(row.week_start);
      teamAvgMap.set(weekStart, Number(row.team_avg_focus_score));
    }
    for (const week of weeks) {
      teamAvgByWeek.push(teamAvgMap.get(week) ?? 0);
    }

    // Calculate overall team average
    const overallTeamAvg =
      teamAvgByWeek.length > 0
        ? Math.round((teamAvgByWeek.reduce((a, b) => a + b, 0) / teamAvgByWeek.length) * 100) / 100
        : 0;

    this.logger.info(
      CLASS_NAME,
      'getFocusTrends',
      `Trends built: ${weeks.length} weeks, ${developers.length} developers, team avg ${overallTeamAvg}`
    );

    return {
      weeks,
      developers,
      teamAvgByWeek,
      overallTeamAvg,
    };
  }

  /**
   * Get team focus summary statistics.
   *
   * @param filters - Optional filters for the underlying data
   * @returns TeamFocusSummary with category counts
   */
  async getTeamSummary(filters: FocusFilters = {}): Promise<TeamFocusSummary> {
    this.logger.debug(
      CLASS_NAME,
      'getTeamSummary',
      `Fetching team summary: filters=${JSON.stringify(filters)}`
    );

    // Validate filters
    this.validateDateFilter(filters.startDate, 'startDate');
    this.validateDateFilter(filters.endDate, 'endDate');

    const result = await this.db.query<FocusSummaryDbRow>(QUERY_FOCUS_SUMMARY, [
      filters.startDate ?? null,
      filters.endDate ?? null,
    ]);

    const row = result.rows[0];
    if (!row) {
      this.logger.debug(CLASS_NAME, 'getTeamSummary', 'No summary data found');
      return {
        avgFocusScore: 0,
        deepFocusCount: 0,
        moderateFocusCount: 0,
        fragmentedCount: 0,
        highlyFragmentedCount: 0,
        totalDevelopers: 0,
      };
    }

    const summary: TeamFocusSummary = {
      avgFocusScore: row.avg_focus_score !== null ? Number(row.avg_focus_score) : 0,
      deepFocusCount: Number(row.deep_focus_count),
      moderateFocusCount: Number(row.moderate_focus_count),
      fragmentedCount: Number(row.fragmented_count),
      highlyFragmentedCount: Number(row.highly_fragmented_count),
      totalDevelopers: Number(row.total_developers),
    };

    this.logger.info(
      CLASS_NAME,
      'getTeamSummary',
      `Team summary: ${summary.totalDevelopers} developers, avg score ${summary.avgFocusScore}`
    );

    return summary;
  }

  /**
   * Get complete chart data including view existence check and focus data.
   *
   * @param filters - Optional filters for focus queries
   * @returns FocusChartData with focus data and metadata
   */
  async getChartData(filters: FocusFilters = {}): Promise<FocusChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getChartData',
      `Fetching chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkFocusViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getChartData',
        'vw_developer_focus view not found -- returning empty data'
      );
      return {
        focusData: [],
        trends: {
          weeks: [],
          developers: [],
          teamAvgByWeek: [],
          overallTeamAvg: 0,
        },
        teamSummary: {
          avgFocusScore: 0,
          deepFocusCount: 0,
          moderateFocusCount: 0,
          fragmentedCount: 0,
          highlyFragmentedCount: 0,
          totalDevelopers: 0,
        },
        hasData: false,
        viewExists: false,
      };
    }

    // Fetch data in parallel
    const [focusData, trends, teamSummary] = await Promise.all([
      this.getFocusScores(filters),
      this.getFocusTrends(filters),
      this.getTeamSummary(filters),
    ]);

    this.logger.info(
      CLASS_NAME,
      'getChartData',
      `Chart data ready: ${focusData.length} focus rows, ${trends.developers.length} developers`
    );

    return {
      focusData,
      trends,
      teamSummary,
      hasData: focusData.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get daily activity chart data with view existence check.
   *
   * @param filters - Optional filters for activity queries
   * @returns DailyActivityChartData with activities and metadata
   */
  async getDailyActivityChartData(filters: FocusFilters = {}): Promise<DailyActivityChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getDailyActivityChartData',
      `Fetching daily activity chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkDailyActivityViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getDailyActivityChartData',
        'vw_developer_daily_activity view not found -- returning empty data'
      );
      return {
        activities: [],
        hasData: false,
        viewExists: false,
      };
    }

    const activities = await this.getDailyActivities(filters);

    this.logger.info(
      CLASS_NAME,
      'getDailyActivityChartData',
      `Daily activity chart data ready: ${activities.length} activities`
    );

    return {
      activities,
      hasData: activities.length > 0,
      viewExists: true,
    };
  }
}
