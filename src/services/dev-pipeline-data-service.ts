/**
 * Data service for the Development Pipeline dashboard.
 * Provides methods to fetch commit-level delta metrics from the
 * vw_dev_pipeline_deltas database view, with optional filtering
 * by date range, team, repository, and ticket.
 *
 * The Development Pipeline dashboard helps QA teams prioritize testing
 * by showing which commits have the highest impact in terms of code changes:
 *   - Complexity delta (cyclomatic complexity change)
 *   - LOC delta (net lines of code change)
 *   - Comments delta (comment lines change)
 *   - Tests delta (test file LOC change)
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-896, IQS-930
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import type { RepositoryEntry } from '../config/settings.js';
import {
  DEV_PIPELINE_MAX_RESULT_ROWS,
  QUERY_DEV_PIPELINE_DELTAS,
  QUERY_DEV_PIPELINE_DELTAS_DATE_RANGE,
  QUERY_DEV_PIPELINE_DELTAS_TEAM,
  QUERY_DEV_PIPELINE_DELTAS_REPOSITORY,
  QUERY_DEV_PIPELINE_DELTAS_TICKET,
  QUERY_DEV_PIPELINE_DELTAS_COMBINED,
  QUERY_DEV_PIPELINE_DELTAS_BY_TICKET,
  QUERY_DEV_PIPELINE_DELTAS_BY_AUTHOR,
  QUERY_DEV_PIPELINE_VIEW_EXISTS,
  QUERY_BASELINE_POPULATION_STATS,
  QUERY_DEV_PIPELINE_WEEKLY,
  QUERY_DEV_PIPELINE_TEAMS,
  type DevPipelineDelta,
  type DevPipelineDeltaByTicket as DbDevPipelineDeltaByTicket,
  type DevPipelineDeltaByAuthor as DbDevPipelineDeltaByAuthor,
  type BaselinePopulationStats,
  type DevPipelineWeeklyRow,
} from '../database/queries/dev-pipeline-queries.js';
import type {
  DevPipelineDeltaPoint,
  DevPipelineDeltaByTicket,
  DevPipelineDeltaByAuthor,
  DevPipelineChartData,
  DevPipelineFilters,
  DevPipelineWeeklyDataPoint,
} from './dev-pipeline-data-types.js';
import {
  validateStringFilter,
  validateDateFilters,
  validateWeeklyMetricsInputs,
} from './dev-pipeline-validators.js';
import {
  mapRowToDeltaPoint,
  buildRepoUrlMap,
  getDefaultDateRange,
} from './dev-pipeline-mappers.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DevPipelineDataService';

/**
 * Service responsible for querying the vw_dev_pipeline_deltas database
 * view and returning typed data for the Development Pipeline dashboard.
 *
 * Ticket: IQS-896, IQS-930
 */
export class DevPipelineDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'DevPipelineDataService created');
  }

  /**
   * Check if the vw_dev_pipeline_deltas view exists.
   * Used for graceful degradation when migration 010 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkViewExists', 'Checking vw_dev_pipeline_deltas existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_DEV_PIPELINE_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkViewExists', `vw_dev_pipeline_deltas exists: ${exists}`);
    return exists;
  }

  /**
   * Get baseline population statistics.
   * Returns count of commits with baseline data vs total commits.
   * Helps diagnose if pipeline is populating baselines correctly.
   *
   * @returns Baseline population stats
   */
  async getBaselineStats(): Promise<BaselinePopulationStats | null> {
    this.logger.debug(CLASS_NAME, 'getBaselineStats', 'Fetching baseline population stats');

    const result = await this.db.query<BaselinePopulationStats>(QUERY_BASELINE_POPULATION_STATS);
    const stats = result.rows[0] ?? null;

    if (stats) {
      this.logger.debug(
        CLASS_NAME,
        'getBaselineStats',
        `Baseline coverage: ${stats.commits_with_baseline}/${stats.total_commits} commits (${((stats.baseline_coverage_ratio ?? 0) * 100).toFixed(1)}%)`
      );
    }

    return stats;
  }

  /**
   * Fetch development pipeline deltas with optional filters.
   * Applies default 3-week date range when no filters provided.
   *
   * @param filters - Optional date range, team, repository, and ticket filters
   * @returns Array of DevPipelineDeltaPoint sorted by commit date descending
   */
  async getDevPipelineMetrics(
    filters: DevPipelineFilters = {}
  ): Promise<readonly DevPipelineDeltaPoint[]> {
    this.logger.debug(
      CLASS_NAME,
      'getDevPipelineMetrics',
      `Fetching data: filters=${JSON.stringify(filters)}`
    );

    // Validate string filters for length
    validateStringFilter(filters.team, 'team', this.logger);
    validateStringFilter(filters.repository, 'repository', this.logger);
    validateStringFilter(filters.ticketId, 'ticketId', this.logger);

    // Apply default date range if no filters specified
    const effectiveFilters = { ...filters };
    if (!effectiveFilters.startDate && !effectiveFilters.endDate) {
      const defaultRange = getDefaultDateRange();
      effectiveFilters.startDate = defaultRange.startDate;
      effectiveFilters.endDate = defaultRange.endDate;
      this.logger.debug(
        CLASS_NAME,
        'getDevPipelineMetrics',
        `Applied default date range: ${defaultRange.startDate} to ${defaultRange.endDate}`
      );
    }

    // Validate date inputs
    validateDateFilters(effectiveFilters, this.logger);

    // Determine which query to use based on filter combination
    const hasDateRange = Boolean(effectiveFilters.startDate && effectiveFilters.endDate);
    const hasTeam = Boolean(effectiveFilters.team);
    const hasRepository = Boolean(effectiveFilters.repository);
    const hasTicketId = Boolean(effectiveFilters.ticketId);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    if (hasTicketId) {
      // Single ticket filter - use dedicated query
      sql = QUERY_DEV_PIPELINE_DELTAS_TICKET;
      params = [effectiveFilters.ticketId];
      this.logger.debug(CLASS_NAME, 'getDevPipelineMetrics', 'Using ticket filter query');
    } else if (hasDateRange && (hasTeam || hasRepository)) {
      // Combined filters - use flexible combined query
      sql = QUERY_DEV_PIPELINE_DELTAS_COMBINED;
      params = [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.team ?? null,
        effectiveFilters.repository ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getDevPipelineMetrics', 'Using combined filter query');
    } else if (hasDateRange) {
      sql = QUERY_DEV_PIPELINE_DELTAS_DATE_RANGE;
      params = [effectiveFilters.startDate, effectiveFilters.endDate];
      this.logger.debug(CLASS_NAME, 'getDevPipelineMetrics', 'Using date range filter query');
    } else if (hasTeam) {
      sql = QUERY_DEV_PIPELINE_DELTAS_TEAM;
      params = [effectiveFilters.team];
      this.logger.debug(CLASS_NAME, 'getDevPipelineMetrics', 'Using team filter query');
    } else if (hasRepository) {
      sql = QUERY_DEV_PIPELINE_DELTAS_REPOSITORY;
      params = [effectiveFilters.repository];
      this.logger.debug(CLASS_NAME, 'getDevPipelineMetrics', 'Using repository filter query');
    } else {
      sql = QUERY_DEV_PIPELINE_DELTAS;
      params = [];
      this.logger.debug(CLASS_NAME, 'getDevPipelineMetrics', 'Using unfiltered query');
    }

    this.logger.trace(CLASS_NAME, 'getDevPipelineMetrics', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<DevPipelineDelta>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getDevPipelineMetrics',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, DEV_PIPELINE_MAX_RESULT_ROWS);
    if (result.rows.length > DEV_PIPELINE_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getDevPipelineMetrics',
        `Result set truncated from ${result.rows.length} to ${DEV_PIPELINE_MAX_RESULT_ROWS} rows`
      );
    }

    const rows: DevPipelineDeltaPoint[] = limitedRows.map((row) => mapRowToDeltaPoint(row));

    this.logger.debug(
      CLASS_NAME,
      'getDevPipelineMetrics',
      `Returning ${rows.length} dev pipeline delta points`
    );
    return rows;
  }

  /**
   * Fetch development pipeline deltas aggregated by ticket.
   *
   * @param filters - Optional date range filters
   * @returns Array of DevPipelineDeltaByTicket sorted by last commit date descending
   */
  async getDevPipelineMetricsByTicket(
    filters: DevPipelineFilters = {}
  ): Promise<readonly DevPipelineDeltaByTicket[]> {
    this.logger.debug(
      CLASS_NAME,
      'getDevPipelineMetricsByTicket',
      `Fetching by-ticket data: filters=${JSON.stringify(filters)}`
    );

    // Validate date inputs
    validateDateFilters(filters, this.logger);

    const params = [filters.startDate ?? null, filters.endDate ?? null];

    const result = await this.db.query<DbDevPipelineDeltaByTicket>(
      QUERY_DEV_PIPELINE_DELTAS_BY_TICKET,
      params
    );

    this.logger.debug(
      CLASS_NAME,
      'getDevPipelineMetricsByTicket',
      `Query returned ${result.rows.length} tickets`
    );

    const rows: DevPipelineDeltaByTicket[] = result.rows.map((row) => ({
      ticketId: row.ticket_id,
      ticketProject: row.ticket_project,
      ticketType: row.ticket_type,
      team: row.team,
      repository: row.repository,
      commitCount: Number(row.commit_count),
      totalComplexityDelta: Number(row.total_complexity_delta),
      totalLocDelta: Number(row.total_loc_delta),
      totalCommentsDelta: Number(row.total_comments_delta),
      totalTestsDelta: Number(row.total_tests_delta),
      totalFileCount: Number(row.total_file_count),
      totalTestFileCount: Number(row.total_test_file_count),
      firstCommitDate:
        row.first_commit_date instanceof Date
          ? row.first_commit_date.toISOString().split('T')[0] ?? ''
          : String(row.first_commit_date),
      lastCommitDate:
        row.last_commit_date instanceof Date
          ? row.last_commit_date.toISOString().split('T')[0] ?? ''
          : String(row.last_commit_date),
    }));

    return rows;
  }

  /**
   * Fetch development pipeline deltas aggregated by author.
   *
   * @param filters - Optional date range filters
   * @returns Array of DevPipelineDeltaByAuthor sorted by commit count descending
   */
  async getDevPipelineMetricsByAuthor(
    filters: DevPipelineFilters = {}
  ): Promise<readonly DevPipelineDeltaByAuthor[]> {
    this.logger.debug(
      CLASS_NAME,
      'getDevPipelineMetricsByAuthor',
      `Fetching by-author data: filters=${JSON.stringify(filters)}`
    );

    // Validate date inputs
    validateDateFilters(filters, this.logger);

    const params = [filters.startDate ?? null, filters.endDate ?? null];

    const result = await this.db.query<DbDevPipelineDeltaByAuthor>(
      QUERY_DEV_PIPELINE_DELTAS_BY_AUTHOR,
      params
    );

    this.logger.debug(
      CLASS_NAME,
      'getDevPipelineMetricsByAuthor',
      `Query returned ${result.rows.length} authors`
    );

    const rows: DevPipelineDeltaByAuthor[] = result.rows.map((row) => ({
      author: row.author,
      fullName: row.full_name,
      team: row.team,
      commitCount: Number(row.commit_count),
      ticketCount: Number(row.ticket_count),
      totalComplexityDelta: Number(row.total_complexity_delta),
      totalLocDelta: Number(row.total_loc_delta),
      totalCommentsDelta: Number(row.total_comments_delta),
      totalTestsDelta: Number(row.total_tests_delta),
      totalFileCount: Number(row.total_file_count),
      totalTestFileCount: Number(row.total_test_file_count),
      firstCommitDate:
        row.first_commit_date instanceof Date
          ? row.first_commit_date.toISOString().split('T')[0] ?? ''
          : String(row.first_commit_date),
      lastCommitDate:
        row.last_commit_date instanceof Date
          ? row.last_commit_date.toISOString().split('T')[0] ?? ''
          : String(row.last_commit_date),
    }));

    return rows;
  }

  /**
   * Get complete chart data including view existence check and delta data.
   *
   * @param filters - Optional date range, team, repository filters
   * @returns DevPipelineChartData with data points and metadata
   */
  async getChartData(filters: DevPipelineFilters = {}): Promise<DevPipelineChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getChartData',
      `Fetching chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getChartData',
        'vw_dev_pipeline_deltas view not found -- returning empty data'
      );
      return {
        rows: [],
        hasData: false,
        viewExists: false,
      };
    }

    const rows = await this.getDevPipelineMetrics(filters);

    this.logger.info(
      CLASS_NAME,
      'getChartData',
      `Chart data ready: ${rows.length} commit delta points`
    );

    return {
      rows,
      hasData: rows.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get unique team names from the dev pipeline data.
   *
   * @returns Array of team names sorted alphabetically
   */
  async getUniqueTeams(): Promise<string[]> {
    this.logger.debug(CLASS_NAME, 'getUniqueTeams', 'Fetching unique team names');

    const result = await this.db.query<{ team: string }>(QUERY_DEV_PIPELINE_TEAMS);

    this.logger.debug(
      CLASS_NAME,
      'getUniqueTeams',
      `Query returned ${result.rows.length} unique teams`
    );

    const teams = result.rows.map((row) => row.team);

    this.logger.trace(CLASS_NAME, 'getUniqueTeams', `Teams: ${JSON.stringify(teams)}`);

    return teams;
  }

  /**
   * Get weekly aggregated metrics for a team.
   * Groups commits by ISO week and developer, summing delta metrics.
   *
   * @param team - Team name (required)
   * @param startDate - Start date (YYYY-MM-DD)
   * @param endDate - End date (YYYY-MM-DD)
   * @param repositories - Repository settings from VS Code for repoUrl lookup
   * @returns Array of weekly data points sorted by week and author
   */
  async getWeeklyMetrics(
    team: string,
    startDate: string,
    endDate: string,
    repositories: readonly RepositoryEntry[] = []
  ): Promise<readonly DevPipelineWeeklyDataPoint[]> {
    this.logger.debug(
      CLASS_NAME,
      'getWeeklyMetrics',
      `Fetching weekly metrics for team: ${team}`
    );
    this.logger.trace(
      CLASS_NAME,
      'getWeeklyMetrics',
      `Query params: ${JSON.stringify({ team, startDate, endDate })}`
    );

    // Validate inputs
    validateWeeklyMetricsInputs(team, startDate, endDate, this.logger);

    // Build repository URL lookup map from settings
    const repoUrlMap = buildRepoUrlMap(repositories, this.logger);

    // Execute query
    const params = [team, startDate, endDate];
    const result = await this.db.query<DevPipelineWeeklyRow>(QUERY_DEV_PIPELINE_WEEKLY, params);

    this.logger.debug(
      CLASS_NAME,
      'getWeeklyMetrics',
      `Query returned ${result.rows.length} weekly data points`
    );

    // Transform to DevPipelineWeeklyDataPoint format
    const rows: DevPipelineWeeklyDataPoint[] = result.rows.map((row) => {
      const totalCodeLines = Number(row.total_code_lines);
      const totalCommentLines = Number(row.total_comment_lines);

      // Calculate comments ratio: (total_comment_lines / total_code_lines) * 100
      // Avoid division by zero
      const commentsRatio =
        totalCodeLines > 0 ? (totalCommentLines / totalCodeLines) * 100 : 0;

      const weekStart =
        row.week_start instanceof Date
          ? row.week_start.toISOString().split('T')[0] ?? ''
          : String(row.week_start);

      // Look up repoUrl from settings based on repository name
      const repoUrl = row.repository ? repoUrlMap.get(row.repository) ?? null : null;
      if (row.repository && !repoUrl) {
        this.logger.trace(
          CLASS_NAME,
          'getWeeklyMetrics',
          `No repoUrl configured for repository: ${row.repository}`
        );
      }

      return {
        weekStart,
        author: row.author,
        fullName: row.full_name,
        team: row.team,
        totalLocDelta: Number(row.total_loc_delta),
        totalComplexityDelta: Number(row.total_complexity_delta),
        totalCommentsDelta: Number(row.total_comments_delta),
        totalTestsDelta: Number(row.total_tests_delta),
        totalCommentLines,
        totalCodeLines,
        commitCount: Number(row.commit_count),
        commentsRatio,
        latestSha: row.latest_sha ?? null,
        repoUrl,
      };
    });

    this.logger.debug(
      CLASS_NAME,
      'getWeeklyMetrics',
      `Returning ${rows.length} weekly data points`
    );

    return rows;
  }
}
