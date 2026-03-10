/**
 * Data service for the Code Review Velocity dashboard.
 * Provides methods to fetch PR velocity metrics from the
 * vw_code_review_velocity database view, with optional filtering
 * by date range, repository, author, and size category.
 *
 * The Code Review Velocity dashboard helps tech leads identify bottlenecks:
 *   - How long do PRs sit before first review?
 *   - Which repositories have the slowest review cycles?
 *   - Are large PRs taking disproportionately longer?
 *   - Which reviewers are overloaded?
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-899
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  CODE_REVIEW_MAX_RESULT_ROWS,
  QUERY_CODE_REVIEW_VELOCITY,
  QUERY_CODE_REVIEW_VELOCITY_DATE_RANGE,
  QUERY_CODE_REVIEW_VELOCITY_REPOSITORY,
  QUERY_CODE_REVIEW_VELOCITY_AUTHOR,
  QUERY_CODE_REVIEW_VELOCITY_SIZE,
  QUERY_CODE_REVIEW_VELOCITY_MERGED,
  QUERY_CODE_REVIEW_VELOCITY_COMBINED,
  QUERY_CODE_REVIEW_VIEW_EXISTS,
  QUERY_PR_STATS,
  QUERY_AVG_METRICS_BY_REPOSITORY,
  QUERY_AVG_METRICS_BY_AUTHOR,
  QUERY_AVG_METRICS_BY_SIZE,
  type CodeReviewVelocityRow,
  type ViewExistsRow,
  type PRStatsRow,
  type AvgMetricsRow,
} from '../database/queries/code-review-queries.js';
import type {
  CodeReviewMetrics,
  CodeReviewFilters,
  CodeReviewChartData,
  PRStats,
  AvgMetricsByRepository,
  AvgMetricsByAuthor,
  AvgMetricsBySize,
  PRSizeCategory,
} from './code-review-velocity-types.js';
import { CODE_REVIEW_MAX_FILTER_LENGTH } from './code-review-velocity-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'CodeReviewVelocityDataService';

/**
 * Default date range: last 90 days.
 * Applied when no date filters are provided.
 */
const DEFAULT_DATE_RANGE_DAYS = 90;

/**
 * Service responsible for querying the vw_code_review_velocity database
 * view and returning typed data for the Code Review Velocity dashboard.
 *
 * Ticket: IQS-899
 */
export class CodeReviewVelocityDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'CodeReviewVelocityDataService created');
  }

  /**
   * Check if the vw_code_review_velocity view exists.
   * Used for graceful degradation when migration 012 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkViewExists', 'Checking vw_code_review_velocity existence');

    const result = await this.db.query<ViewExistsRow>(QUERY_CODE_REVIEW_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkViewExists', `vw_code_review_velocity exists: ${exists}`);
    return exists;
  }

  /**
   * Get PR statistics (counts by state).
   *
   * @returns PR statistics
   */
  async getPRStats(): Promise<PRStats | null> {
    this.logger.debug(CLASS_NAME, 'getPRStats', 'Fetching PR statistics');

    const result = await this.db.query<PRStatsRow>(QUERY_PR_STATS);
    const stats = result.rows[0];

    if (!stats) {
      this.logger.debug(CLASS_NAME, 'getPRStats', 'No PR stats found');
      return null;
    }

    this.logger.debug(
      CLASS_NAME,
      'getPRStats',
      `PR stats: ${stats.total_prs} total, ${stats.merged_prs} merged, ${stats.open_prs} open`,
    );

    return {
      totalPRs: stats.total_prs,
      mergedPRs: stats.merged_prs,
      openPRs: stats.open_prs,
      closedPRs: stats.closed_prs,
      prsWithReviews: stats.prs_with_reviews,
    };
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
    if (value && value.length > CODE_REVIEW_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${CODE_REVIEW_MAX_FILTER_LENGTH}`,
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${CODE_REVIEW_MAX_FILTER_LENGTH} characters`,
      );
    }
  }

  /**
   * Validate date filter inputs.
   * Validates format and rejects malformed dates (CWE-20).
   *
   * @param filters - Filters to validate
   * @throws Error if dates are invalid
   */
  private validateDateFilters(filters: CodeReviewFilters): void {
    if (filters.startDate && !isValidDateString(filters.startDate)) {
      this.logger.warn(CLASS_NAME, 'validateDateFilters', `Invalid start date rejected: ${filters.startDate}`);
      throw new Error(`Invalid start date format: ${filters.startDate}. Expected YYYY-MM-DD.`);
    }
    if (filters.endDate && !isValidDateString(filters.endDate)) {
      this.logger.warn(CLASS_NAME, 'validateDateFilters', `Invalid end date rejected: ${filters.endDate}`);
      throw new Error(`Invalid end date format: ${filters.endDate}. Expected YYYY-MM-DD.`);
    }
    // Validate date range order
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
      this.logger.warn(
        CLASS_NAME,
        'validateDateFilters',
        `Invalid date range: ${filters.startDate} > ${filters.endDate}`,
      );
      throw new Error(
        `Invalid date range: start date (${filters.startDate}) must be before end date (${filters.endDate})`,
      );
    }
  }

  /**
   * Get default date range (last 90 days).
   *
   * @returns Object with startDate and endDate as ISO strings
   */
  private getDefaultDateRange(): { startDate: string; endDate: string } {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - DEFAULT_DATE_RANGE_DAYS);

    return {
      startDate: startDate.toISOString().split('T')[0] ?? '',
      endDate: endDate.toISOString().split('T')[0] ?? '',
    };
  }

  /**
   * Map database row to CodeReviewMetrics.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToMetrics(row: CodeReviewVelocityRow): CodeReviewMetrics {
    const formatDate = (date: Date | null): string | null => {
      if (!date) {
        return null;
      }
      return date instanceof Date
        ? date.toISOString()
        : String(date);
    };

    return {
      id: row.id,
      repository: row.repository,
      prNumber: row.pr_number,
      title: row.title,
      author: row.author,
      state: row.state,
      createdAt: formatDate(row.created_at) ?? '',
      updatedAt: formatDate(row.updated_at),
      firstReviewAt: formatDate(row.first_review_at),
      mergedAt: formatDate(row.merged_at),
      closedAt: formatDate(row.closed_at),
      headBranch: row.head_branch,
      baseBranch: row.base_branch,
      additions: Number(row.additions),
      deletions: Number(row.deletions),
      locChanged: Number(row.loc_changed),
      changedFiles: Number(row.changed_files),
      reviewCycles: Number(row.review_cycles),
      linkedTicketId: row.linked_ticket_id,
      linkedTicketType: row.linked_ticket_type,
      hoursToFirstReview: row.hours_to_first_review !== null ? Number(row.hours_to_first_review) : null,
      hoursToMerge: row.hours_to_merge !== null ? Number(row.hours_to_merge) : null,
      hoursReviewToMerge: row.hours_review_to_merge !== null ? Number(row.hours_review_to_merge) : null,
      sizeCategory: row.size_category,
      firstReviewer: row.first_reviewer,
    };
  }

  /**
   * Fetch code review velocity metrics with optional filters.
   * Applies default 90-day date range when no filters provided.
   *
   * @param filters - Optional date range, repository, author, and size filters
   * @returns Array of CodeReviewMetrics sorted by created_at descending
   */
  async getMetrics(
    filters: CodeReviewFilters = {},
  ): Promise<readonly CodeReviewMetrics[]> {
    this.logger.debug(
      CLASS_NAME,
      'getMetrics',
      `Fetching data: filters=${JSON.stringify(filters)}`,
    );

    // Validate string filters for length
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.author, 'author');
    this.validateStringFilter(filters.sizeCategory, 'sizeCategory');

    // Apply default date range if no filters specified
    const effectiveFilters = { ...filters };
    if (!effectiveFilters.startDate && !effectiveFilters.endDate) {
      const defaultRange = this.getDefaultDateRange();
      effectiveFilters.startDate = defaultRange.startDate;
      effectiveFilters.endDate = defaultRange.endDate;
      this.logger.debug(
        CLASS_NAME,
        'getMetrics',
        `Applied default date range: ${defaultRange.startDate} to ${defaultRange.endDate}`,
      );
    }

    // Validate date inputs
    this.validateDateFilters(effectiveFilters);

    // Determine which query to use based on filter combination
    const hasDateRange = Boolean(effectiveFilters.startDate && effectiveFilters.endDate);
    const hasRepository = Boolean(effectiveFilters.repository);
    const hasAuthor = Boolean(effectiveFilters.author);
    const hasSizeCategory = Boolean(effectiveFilters.sizeCategory);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    if (hasDateRange && (hasRepository || hasAuthor || hasSizeCategory)) {
      // Combined filters - use flexible combined query
      sql = QUERY_CODE_REVIEW_VELOCITY_COMBINED;
      params = [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
        effectiveFilters.author ?? null,
        effectiveFilters.sizeCategory ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getMetrics', 'Using combined filter query');
    } else if (hasDateRange) {
      sql = QUERY_CODE_REVIEW_VELOCITY_DATE_RANGE;
      params = [effectiveFilters.startDate, effectiveFilters.endDate];
      this.logger.debug(CLASS_NAME, 'getMetrics', 'Using date range filter query');
    } else if (hasRepository) {
      sql = QUERY_CODE_REVIEW_VELOCITY_REPOSITORY;
      params = [effectiveFilters.repository];
      this.logger.debug(CLASS_NAME, 'getMetrics', 'Using repository filter query');
    } else if (hasAuthor) {
      sql = QUERY_CODE_REVIEW_VELOCITY_AUTHOR;
      params = [effectiveFilters.author];
      this.logger.debug(CLASS_NAME, 'getMetrics', 'Using author filter query');
    } else if (hasSizeCategory) {
      sql = QUERY_CODE_REVIEW_VELOCITY_SIZE;
      params = [effectiveFilters.sizeCategory];
      this.logger.debug(CLASS_NAME, 'getMetrics', 'Using size filter query');
    } else {
      sql = QUERY_CODE_REVIEW_VELOCITY;
      params = [];
      this.logger.debug(CLASS_NAME, 'getMetrics', 'Using unfiltered query');
    }

    this.logger.trace(CLASS_NAME, 'getMetrics', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<CodeReviewVelocityRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getMetrics',
      `Query returned ${result.rows.length} rows`,
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, CODE_REVIEW_MAX_RESULT_ROWS);
    if (result.rows.length > CODE_REVIEW_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getMetrics',
        `Result set truncated from ${result.rows.length} to ${CODE_REVIEW_MAX_RESULT_ROWS} rows`,
      );
    }

    const rows: CodeReviewMetrics[] = limitedRows.map((row) => this.mapRowToMetrics(row));

    this.logger.debug(
      CLASS_NAME,
      'getMetrics',
      `Returning ${rows.length} code review metrics`,
    );
    return rows;
  }

  /**
   * Fetch merged PRs only with optional date range.
   *
   * @param filters - Optional date range filters
   * @returns Array of CodeReviewMetrics for merged PRs
   */
  async getMergedPRMetrics(
    filters: CodeReviewFilters = {},
  ): Promise<readonly CodeReviewMetrics[]> {
    this.logger.debug(
      CLASS_NAME,
      'getMergedPRMetrics',
      `Fetching merged PRs: filters=${JSON.stringify(filters)}`,
    );

    // Validate date inputs
    this.validateDateFilters(filters);

    const params = [filters.startDate ?? null, filters.endDate ?? null];

    const result = await this.db.query<CodeReviewVelocityRow>(
      QUERY_CODE_REVIEW_VELOCITY_MERGED,
      params,
    );

    this.logger.debug(
      CLASS_NAME,
      'getMergedPRMetrics',
      `Query returned ${result.rows.length} merged PRs`,
    );

    return result.rows.map((row) => this.mapRowToMetrics(row));
  }

  /**
   * Get average metrics grouped by repository.
   *
   * @param filters - Optional date range filters
   * @returns Array of average metrics by repository
   */
  async getAvgMetricsByRepository(
    filters: CodeReviewFilters = {},
  ): Promise<readonly AvgMetricsByRepository[]> {
    this.logger.debug(
      CLASS_NAME,
      'getAvgMetricsByRepository',
      `Fetching avg metrics by repository: filters=${JSON.stringify(filters)}`,
    );

    // Validate date inputs
    this.validateDateFilters(filters);

    const params = [filters.startDate ?? null, filters.endDate ?? null];

    const result = await this.db.query<AvgMetricsRow>(
      QUERY_AVG_METRICS_BY_REPOSITORY,
      params,
    );

    this.logger.debug(
      CLASS_NAME,
      'getAvgMetricsByRepository',
      `Query returned ${result.rows.length} repositories`,
    );

    return result.rows.map((row) => ({
      repository: row.repository ?? '',
      prCount: Number(row.pr_count),
      avgHoursToFirstReview: row.avg_hours_to_first_review !== null ? Number(row.avg_hours_to_first_review) : null,
      avgHoursToMerge: row.avg_hours_to_merge !== null ? Number(row.avg_hours_to_merge) : null,
      avgReviewCycles: row.avg_review_cycles !== null ? Number(row.avg_review_cycles) : null,
      avgLocChanged: row.avg_loc_changed !== null ? Number(row.avg_loc_changed) : null,
    }));
  }

  /**
   * Get average metrics grouped by author.
   *
   * @param filters - Optional date range filters
   * @returns Array of average metrics by author
   */
  async getAvgMetricsByAuthor(
    filters: CodeReviewFilters = {},
  ): Promise<readonly AvgMetricsByAuthor[]> {
    this.logger.debug(
      CLASS_NAME,
      'getAvgMetricsByAuthor',
      `Fetching avg metrics by author: filters=${JSON.stringify(filters)}`,
    );

    // Validate date inputs
    this.validateDateFilters(filters);

    const params = [filters.startDate ?? null, filters.endDate ?? null];

    const result = await this.db.query<AvgMetricsRow>(
      QUERY_AVG_METRICS_BY_AUTHOR,
      params,
    );

    this.logger.debug(
      CLASS_NAME,
      'getAvgMetricsByAuthor',
      `Query returned ${result.rows.length} authors`,
    );

    return result.rows.map((row) => ({
      author: row.author ?? '',
      prCount: Number(row.pr_count),
      avgHoursToFirstReview: row.avg_hours_to_first_review !== null ? Number(row.avg_hours_to_first_review) : null,
      avgHoursToMerge: row.avg_hours_to_merge !== null ? Number(row.avg_hours_to_merge) : null,
      avgReviewCycles: row.avg_review_cycles !== null ? Number(row.avg_review_cycles) : null,
      avgLocChanged: row.avg_loc_changed !== null ? Number(row.avg_loc_changed) : null,
    }));
  }

  /**
   * Get average metrics grouped by size category.
   *
   * @param filters - Optional date range filters
   * @returns Array of average metrics by size category
   */
  async getAvgMetricsBySize(
    filters: CodeReviewFilters = {},
  ): Promise<readonly AvgMetricsBySize[]> {
    this.logger.debug(
      CLASS_NAME,
      'getAvgMetricsBySize',
      `Fetching avg metrics by size: filters=${JSON.stringify(filters)}`,
    );

    // Validate date inputs
    this.validateDateFilters(filters);

    const params = [filters.startDate ?? null, filters.endDate ?? null];

    const result = await this.db.query<AvgMetricsRow>(
      QUERY_AVG_METRICS_BY_SIZE,
      params,
    );

    this.logger.debug(
      CLASS_NAME,
      'getAvgMetricsBySize',
      `Query returned ${result.rows.length} size categories`,
    );

    return result.rows.map((row) => ({
      sizeCategory: (row.size_category ?? 'M') as PRSizeCategory,
      prCount: Number(row.pr_count),
      avgHoursToFirstReview: row.avg_hours_to_first_review !== null ? Number(row.avg_hours_to_first_review) : null,
      avgHoursToMerge: row.avg_hours_to_merge !== null ? Number(row.avg_hours_to_merge) : null,
      avgReviewCycles: row.avg_review_cycles !== null ? Number(row.avg_review_cycles) : null,
      avgLocChanged: row.avg_loc_changed !== null ? Number(row.avg_loc_changed) : null,
    }));
  }

  /**
   * Get complete chart data including view existence check and metrics data.
   *
   * @param filters - Optional date range, repository, author filters
   * @returns CodeReviewChartData with data points and metadata
   */
  async getChartData(filters: CodeReviewFilters = {}): Promise<CodeReviewChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getChartData',
      `Fetching chart data: filters=${JSON.stringify(filters)}`,
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getChartData',
        'vw_code_review_velocity view not found -- returning empty data',
      );
      return {
        rows: [],
        hasData: false,
        viewExists: false,
      };
    }

    const rows = await this.getMetrics(filters);

    this.logger.info(
      CLASS_NAME,
      'getChartData',
      `Chart data ready: ${rows.length} PR metrics`,
    );

    return {
      rows,
      hasData: rows.length > 0,
      viewExists: true,
    };
  }
}
