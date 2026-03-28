/**
 * Data service for the Complexity Trend chart.
 * Provides methods to fetch complexity trend data from commit_files
 * joined with commit_history and commit_contributors, with optional
 * filtering by date range, team, contributor, and repository.
 *
 * All queries use parameterized SQL ($1, $2 placeholders).
 *
 * Ticket: GITX-133
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  QUERY_COMPLEXITY_TREND_DATA_EXISTS,
  QUERY_COMPLEXITY_TREND_TEAMS,
  QUERY_COMPLEXITY_TREND_CONTRIBUTORS,
  QUERY_COMPLEXITY_TREND_REPOSITORIES,
  QUERY_COMPLEXITY_TREND_DAILY,
  QUERY_COMPLEXITY_TREND_WEEKLY,
  QUERY_COMPLEXITY_TREND_MONTHLY,
  QUERY_COMPLEXITY_TREND_DAILY_TEAM,
  QUERY_COMPLEXITY_TREND_WEEKLY_TEAM,
  QUERY_COMPLEXITY_TREND_MONTHLY_TEAM,
  QUERY_COMPLEXITY_TREND_DAILY_CONTRIBUTOR,
  QUERY_COMPLEXITY_TREND_WEEKLY_CONTRIBUTOR,
  QUERY_COMPLEXITY_TREND_MONTHLY_CONTRIBUTOR,
  QUERY_COMPLEXITY_TREND_DAILY_REPOSITORY,
  QUERY_COMPLEXITY_TREND_WEEKLY_REPOSITORY,
  QUERY_COMPLEXITY_TREND_MONTHLY_REPOSITORY,
} from '../database/queries/complexity-trend-queries.js';
import type {
  ComplexityTrendFilters,
  ComplexityTrendPoint,
  ComplexityTrendFilterOptions,
  ComplexityTrendPeriod,
} from '../views/webview/complexity-trend-protocol.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ComplexityTrendDataService';

/**
 * Default number of days to look back for trend data.
 */
const DEFAULT_DAYS_BACK = 90;

/**
 * Maximum number of rows returned from the trend query.
 * Prevents excessive memory usage.
 */
const MAX_RESULT_ROWS = 5000;

/**
 * Maximum filter string length (CWE-20 input validation).
 */
const MAX_FILTER_STRING_LENGTH = 200;

/**
 * Maximum date range in days (2 years) to prevent excessive queries.
 */
const MAX_DATE_RANGE_DAYS = 730;

/**
 * Allowed period values (runtime allowlist).
 */
const ALLOWED_PERIODS: readonly ComplexityTrendPeriod[] = ['daily', 'weekly', 'monthly'] as const;

/**
 * Response type for chart data.
 */
export interface ComplexityTrendChartData {
  readonly data: readonly ComplexityTrendPoint[];
  readonly hasData: boolean;
}

/**
 * Service responsible for querying commit_files and commit_history tables
 * and returning typed data for the Complexity Trend chart.
 *
 * Ticket: GITX-133
 */
export class ComplexityTrendDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'ComplexityTrendDataService created');
  }

  /**
   * Check if commit_files has complexity data.
   * Used for graceful degradation when no complexity data is available.
   *
   * @returns true if complexity data exists
   */
  async checkDataExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkDataExists', 'Checking commit_files complexity data existence');

    try {
      const result = await this.db.query<{ data_exists: boolean }>(QUERY_COMPLEXITY_TREND_DATA_EXISTS);
      const exists = result.rows[0]?.data_exists ?? false;

      this.logger.debug(CLASS_NAME, 'checkDataExists', `Complexity data exists: ${exists}`);
      return exists;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'checkDataExists', `Error checking data existence: ${errorMsg}`);
      return false;
    }
  }

  /**
   * Fetch filter options for dropdowns (teams, contributors, repos).
   *
   * @returns Filter options with teams, contributors, and repositories
   */
  async getFilterOptions(): Promise<ComplexityTrendFilterOptions> {
    this.logger.debug(CLASS_NAME, 'getFilterOptions', 'Fetching filter options');

    try {
      const [teamsResult, contributorsResult, reposResult] = await Promise.all([
        this.db.query<{ team: string }>(QUERY_COMPLEXITY_TREND_TEAMS),
        this.db.query<{ contributor: string }>(QUERY_COMPLEXITY_TREND_CONTRIBUTORS),
        this.db.query<{ repository: string }>(QUERY_COMPLEXITY_TREND_REPOSITORIES),
      ]);

      const teams = teamsResult.rows.map(row => row.team).filter(Boolean);
      const contributors = contributorsResult.rows.map(row => row.contributor).filter(Boolean);
      const repositories = reposResult.rows.map(row => row.repository).filter(Boolean);

      this.logger.debug(
        CLASS_NAME,
        'getFilterOptions',
        `Found ${teams.length} teams, ${contributors.length} contributors, ${repositories.length} repositories`,
      );

      return { teams, contributors, repositories };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'getFilterOptions', `Error fetching filter options: ${errorMsg}`);
      return { teams: [], contributors: [], repositories: [] };
    }
  }

  /**
   * Validate filter inputs for security (CWE-20, CWE-89 prevention).
   *
   * @param filters - Filters to validate
   * @throws Error if any filter is invalid
   */
  private validateFilters(filters: ComplexityTrendFilters): void {
    // Validate period
    const period = filters.period ?? 'weekly';
    if (!ALLOWED_PERIODS.includes(period)) {
      throw new Error(`Invalid period: ${period}. Allowed: ${ALLOWED_PERIODS.join(', ')}`);
    }

    // Validate dates
    if (filters.startDate && !isValidDateString(filters.startDate)) {
      throw new Error(`Invalid start date format: ${filters.startDate}. Expected YYYY-MM-DD.`);
    }
    if (filters.endDate && !isValidDateString(filters.endDate)) {
      throw new Error(`Invalid end date format: ${filters.endDate}. Expected YYYY-MM-DD.`);
    }

    // Validate date range doesn't exceed maximum
    if (filters.startDate && filters.endDate) {
      const start = new Date(filters.startDate);
      const end = new Date(filters.endDate);
      const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > MAX_DATE_RANGE_DAYS) {
        throw new Error(`Date range exceeds maximum of ${MAX_DATE_RANGE_DAYS} days (2 years).`);
      }
      if (daysDiff < 0) {
        throw new Error('Start date must be before or equal to end date.');
      }
    }

    // Validate string length for filter values
    if (filters.team && filters.team.length > MAX_FILTER_STRING_LENGTH) {
      throw new Error(`Team filter exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
    }
    if (filters.contributor && filters.contributor.length > MAX_FILTER_STRING_LENGTH) {
      throw new Error(`Contributor filter exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
    }
    if (filters.repository && filters.repository.length > MAX_FILTER_STRING_LENGTH) {
      throw new Error(`Repository filter exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
    }
  }

  /**
   * Allowed filter type values (runtime allowlist for defense-in-depth).
   */
  private static readonly ALLOWED_FILTER_TYPES = ['none', 'team', 'contributor', 'repository'] as const;

  /**
   * Select the appropriate query based on period and filter type.
   * Performs runtime validation as defense-in-depth against query injection.
   *
   * @param period - Time period (daily, weekly, monthly)
   * @param filterType - Type of filter applied (none, team, contributor, repository)
   * @returns SQL query string
   * @throws Error if period or filterType is invalid
   */
  private selectQuery(
    period: ComplexityTrendPeriod,
    filterType: 'none' | 'team' | 'contributor' | 'repository',
  ): string {
    // Defense-in-depth: Runtime validation to prevent SQL injection
    // even if TypeScript type system is bypassed
    if (!ALLOWED_PERIODS.includes(period)) {
      this.logger.error(CLASS_NAME, 'selectQuery', `Invalid period rejected: ${String(period)}`);
      throw new Error(`Invalid period: ${String(period)}`);
    }
    if (!ComplexityTrendDataService.ALLOWED_FILTER_TYPES.includes(filterType)) {
      this.logger.error(CLASS_NAME, 'selectQuery', `Invalid filterType rejected: ${String(filterType)}`);
      throw new Error(`Invalid filterType: ${String(filterType)}`);
    }

    // Use a lookup table approach to avoid dynamic query construction
    const queryMap: Record<ComplexityTrendPeriod, Record<'none' | 'team' | 'contributor' | 'repository', string>> = {
      daily: {
        none: QUERY_COMPLEXITY_TREND_DAILY,
        team: QUERY_COMPLEXITY_TREND_DAILY_TEAM,
        contributor: QUERY_COMPLEXITY_TREND_DAILY_CONTRIBUTOR,
        repository: QUERY_COMPLEXITY_TREND_DAILY_REPOSITORY,
      },
      weekly: {
        none: QUERY_COMPLEXITY_TREND_WEEKLY,
        team: QUERY_COMPLEXITY_TREND_WEEKLY_TEAM,
        contributor: QUERY_COMPLEXITY_TREND_WEEKLY_CONTRIBUTOR,
        repository: QUERY_COMPLEXITY_TREND_WEEKLY_REPOSITORY,
      },
      monthly: {
        none: QUERY_COMPLEXITY_TREND_MONTHLY,
        team: QUERY_COMPLEXITY_TREND_MONTHLY_TEAM,
        contributor: QUERY_COMPLEXITY_TREND_MONTHLY_CONTRIBUTOR,
        repository: QUERY_COMPLEXITY_TREND_MONTHLY_REPOSITORY,
      },
    };

    return queryMap[period][filterType];
  }

  /**
   * Fetch complexity trend data with optional filters.
   * Validates inputs before query execution.
   *
   * @param filters - Optional date range, period, team, contributor, repository filters
   * @returns Array of ComplexityTrendPoint sorted by date ascending
   */
  async getComplexityTrend(filters: ComplexityTrendFilters = {}): Promise<readonly ComplexityTrendPoint[]> {
    this.logger.debug(CLASS_NAME, 'getComplexityTrend', `Fetching data: filters=${JSON.stringify(filters)}`);

    // Validate all inputs
    this.validateFilters(filters);

    // Calculate date range
    const endDate: string = filters.endDate ?? new Date().toISOString().split('T')[0]!;
    const startDate = filters.startDate ?? this.calculateStartDate(endDate, DEFAULT_DAYS_BACK);

    const period: ComplexityTrendPeriod = filters.period ?? 'weekly';

    // Determine filter type and select query
    let filterType: 'none' | 'team' | 'contributor' | 'repository' = 'none';
    let params: unknown[] = [startDate, endDate];

    if (filters.team) {
      filterType = 'team';
      params = [startDate, endDate, filters.team];
      this.logger.debug(CLASS_NAME, 'getComplexityTrend', `Using team filter: ${filters.team}`);
    } else if (filters.contributor) {
      filterType = 'contributor';
      params = [startDate, endDate, filters.contributor];
      this.logger.debug(CLASS_NAME, 'getComplexityTrend', `Using contributor filter: ${filters.contributor}`);
    } else if (filters.repository) {
      filterType = 'repository';
      params = [startDate, endDate, filters.repository];
      this.logger.debug(CLASS_NAME, 'getComplexityTrend', `Using repository filter: ${filters.repository}`);
    }

    const sql = this.selectQuery(period, filterType);
    this.logger.trace(CLASS_NAME, 'getComplexityTrend', `Period: ${period}, Filter: ${filterType}`);
    this.logger.trace(CLASS_NAME, 'getComplexityTrend', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      date: Date | string;
      group_key: string;
      avg_complexity: number;
      complexity_delta: number;
      max_complexity: number;
      commit_count: number;
      file_count: number;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getComplexityTrend', `Query returned ${result.rows.length} rows`);

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, MAX_RESULT_ROWS);
    if (result.rows.length > MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getComplexityTrend',
        `Result set truncated from ${result.rows.length} to ${MAX_RESULT_ROWS} rows`,
      );
    }

    const rows: ComplexityTrendPoint[] = limitedRows.map(row => ({
      date: row.date instanceof Date ? row.date.toISOString().split('T')[0] ?? '' : String(row.date),
      groupKey: row.group_key ?? 'Unknown',
      avgComplexity: Number(row.avg_complexity) || 0,
      complexityDelta: Number(row.complexity_delta) || 0,
      maxComplexity: Number(row.max_complexity) || 0,
      commitCount: Number(row.commit_count) || 0,
      fileCount: Number(row.file_count) || 0,
    }));

    this.logger.debug(CLASS_NAME, 'getComplexityTrend', `Returning ${rows.length} trend data points`);
    return rows;
  }

  /**
   * Get complete chart data including data existence check and trend data.
   *
   * @param filters - Optional filters
   * @returns ComplexityTrendChartData with data points and metadata
   */
  async getChartData(filters: ComplexityTrendFilters = {}): Promise<ComplexityTrendChartData> {
    this.logger.debug(CLASS_NAME, 'getChartData', `Fetching chart data: filters=${JSON.stringify(filters)}`);

    // Check data existence for graceful degradation
    const dataExists = await this.checkDataExists();
    if (!dataExists) {
      this.logger.warn(CLASS_NAME, 'getChartData', 'Complexity data not found -- returning empty data');
      return { data: [], hasData: false };
    }

    const data = await this.getComplexityTrend(filters);

    this.logger.info(CLASS_NAME, 'getChartData', `Chart data ready: ${data.length} data points`);

    return { data, hasData: data.length > 0 };
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
