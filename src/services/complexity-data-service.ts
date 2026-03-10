/**
 * Data service for the Top Complex Files chart.
 * Queries commit_files JOIN commit_history JOIN commit_contributors
 * to get top N files by complexity and contributor LOC breakdown.
 *
 * All queries use parameterized SQL ($1, $2 placeholders).
 * The groupBy mode (team vs individual) is validated against a runtime
 * allowlist and routed to separate hardcoded query constants -- zero
 * string interpolation for column selection.
 *
 * Security: CWE-89 (SQL Injection prevention), CWE-20 (Input validation).
 *
 * Ticket: IQS-894
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  TOP_COMPLEX_FILES_BY_INDIVIDUAL,
  TOP_COMPLEX_FILES_INDIVIDUAL_SUFFIX,
  TOP_COMPLEX_FILES_BY_TEAM,
  TOP_COMPLEX_FILES_TEAM_SUFFIX,
  COMPLEXITY_MAX_RESULT_ROWS,
} from '../database/queries/complexity-queries.js';
import type {
  TopComplexFilePoint,
  ComplexityGroupBy,
  DashboardFilters,
} from './dashboard-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ComplexityDataService';

/**
 * Default number of top files to return.
 */
const DEFAULT_TOP_N = 20;

/**
 * Valid range for topN parameter.
 */
const MIN_TOP_N = 1;
const MAX_TOP_N = 100;

/**
 * Runtime allowlist for complexity groupBy mode selection.
 * Prevents SQL injection even if TypeScript type guard is bypassed.
 * Each value maps to a separate hardcoded query constant.
 * CWE-89: SQL Injection prevention.
 */
const ALLOWED_COMPLEXITY_GROUP_BY: readonly string[] = ['team', 'individual'] as const;

/**
 * Maximum allowed length for filter string inputs (team, repository).
 * CWE-20: Input validation.
 */
const MAX_FILTER_STRING_LENGTH = 200;

/**
 * Service responsible for querying database tables and returning typed data
 * for the Top Complex Files chart in the Metrics Dashboard webview.
 *
 * Ticket: IQS-894
 */
export class ComplexityDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'ComplexityDataService created');
  }

  /**
   * Validate dashboard filter inputs at runtime.
   * Checks date format/range, date ordering, and filter string lengths.
   * Throws descriptive errors with WARN-level logging for invalid inputs.
   *
   * @param filters - The dashboard filters to validate
   * @param methodName - Calling method name for log context
   */
  private validateFilters(filters: DashboardFilters, methodName: string): void {
    if (filters.startDate !== undefined) {
      if (!isValidDateString(filters.startDate)) {
        this.logger.warn(CLASS_NAME, methodName, `Invalid startDate rejected: ${filters.startDate}`);
        throw new Error(`Invalid startDate: ${filters.startDate}. Expected YYYY-MM-DD format within valid range (1970 to present+1yr).`);
      }
    }
    if (filters.endDate !== undefined) {
      if (!isValidDateString(filters.endDate)) {
        this.logger.warn(CLASS_NAME, methodName, `Invalid endDate rejected: ${filters.endDate}`);
        throw new Error(`Invalid endDate: ${filters.endDate}. Expected YYYY-MM-DD format within valid range (1970 to present+1yr).`);
      }
    }
    if (filters.startDate !== undefined && filters.endDate !== undefined) {
      if (filters.startDate > filters.endDate) {
        this.logger.warn(CLASS_NAME, methodName, `Date range reversed: startDate=${filters.startDate} > endDate=${filters.endDate}`);
        throw new Error(`Invalid date range: startDate (${filters.startDate}) must be <= endDate (${filters.endDate}).`);
      }
    }
    if (filters.team !== undefined) {
      if (filters.team.length > MAX_FILTER_STRING_LENGTH) {
        this.logger.warn(CLASS_NAME, methodName, `Team filter exceeds max length: ${filters.team.length} > ${MAX_FILTER_STRING_LENGTH}`);
        throw new Error(`Team filter exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
      }
    }
    if (filters.repository !== undefined) {
      if (filters.repository.length > MAX_FILTER_STRING_LENGTH) {
        this.logger.warn(CLASS_NAME, methodName, `Repository filter exceeds max length: ${filters.repository.length} > ${MAX_FILTER_STRING_LENGTH}`);
        throw new Error(`Repository filter exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
      }
    }
  }

  /**
   * Validate topN parameter.
   * Must be a positive integer within the allowed range.
   *
   * @param topN - The topN value to validate
   * @param methodName - Calling method name for log context
   * @returns Validated topN value (clamped to valid range)
   */
  private validateTopN(topN: number, methodName: string): number {
    if (!Number.isInteger(topN)) {
      this.logger.warn(CLASS_NAME, methodName, `Non-integer topN rejected: ${topN}, using default ${DEFAULT_TOP_N}`);
      return DEFAULT_TOP_N;
    }
    if (topN < MIN_TOP_N) {
      this.logger.warn(CLASS_NAME, methodName, `topN below minimum: ${topN} < ${MIN_TOP_N}, clamping to ${MIN_TOP_N}`);
      return MIN_TOP_N;
    }
    if (topN > MAX_TOP_N) {
      this.logger.warn(CLASS_NAME, methodName, `topN above maximum: ${topN} > ${MAX_TOP_N}, clamping to ${MAX_TOP_N}`);
      return MAX_TOP_N;
    }
    return topN;
  }

  /**
   * Fetch top N complex files with contributor/team LOC breakdown.
   * Returns data for a horizontal stacked bar chart where:
   * - Y-axis: Files sorted by complexity descending
   * - X-axis: LOC value
   * - Bar segments: Colored by contributor or team
   *
   * @param groupBy - Grouping mode: 'team' or 'individual'
   * @param topN - Number of top files to return (default: 20, range: 1-100)
   * @param filters - Optional date range, team, and repository filters
   * @returns Array of TopComplexFilePoint sorted by complexity descending
   */
  async getTopComplexFiles(
    groupBy: ComplexityGroupBy,
    topN: number = DEFAULT_TOP_N,
    filters: DashboardFilters = {},
  ): Promise<TopComplexFilePoint[]> {
    // IQS-894: Runtime allowlist validation for groupBy (CWE-89 fix)
    if (!ALLOWED_COMPLEXITY_GROUP_BY.includes(groupBy)) {
      this.logger.warn(CLASS_NAME, 'getTopComplexFiles', `Invalid groupBy rejected: ${String(groupBy).slice(0, 50)}`);
      throw new Error(`Invalid groupBy: ${String(groupBy)}. Allowed values: ${ALLOWED_COMPLEXITY_GROUP_BY.join(', ')}.`);
    }

    // Validate topN parameter
    const validatedTopN = this.validateTopN(topN, 'getTopComplexFiles');

    // IQS-894: Validate filter inputs (CWE-20 fix)
    this.validateFilters(filters, 'getTopComplexFiles');

    this.logger.debug(CLASS_NAME, 'getTopComplexFiles', `Fetching top ${validatedTopN} complex files: groupBy=${groupBy}, filters=${JSON.stringify(filters)}`);

    // Build additional WHERE conditions for filters
    const additionalConditions: string[] = [];
    const params: unknown[] = [validatedTopN];  // $1 is always topN
    let paramIndex = 2;

    if (filters.startDate) {
      additionalConditions.push(`ch.commit_date >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      additionalConditions.push(`ch.commit_date <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.team) {
      additionalConditions.push(`cc.team = $${paramIndex}`);
      params.push(filters.team);
      paramIndex++;
    }
    if (filters.repository) {
      additionalConditions.push(`ch.repository = $${paramIndex}`);
      params.push(filters.repository);
      paramIndex++;
    }

    // Build the full query based on groupBy mode
    let baseQuery: string;
    let suffixQuery: string;

    if (groupBy === 'team') {
      baseQuery = TOP_COMPLEX_FILES_BY_TEAM;
      suffixQuery = TOP_COMPLEX_FILES_TEAM_SUFFIX;
    } else {
      baseQuery = TOP_COMPLEX_FILES_BY_INDIVIDUAL;
      suffixQuery = TOP_COMPLEX_FILES_INDIVIDUAL_SUFFIX;
    }

    // Insert additional filter conditions if any
    let sql: string;
    if (additionalConditions.length > 0) {
      const additionalWhere = additionalConditions.map(c => `    AND ${c}`).join('\n');
      sql = `${baseQuery}\n${additionalWhere}\n${suffixQuery}\nLIMIT ${COMPLEXITY_MAX_RESULT_ROWS}`;
    } else {
      sql = `${baseQuery}\n${suffixQuery}\nLIMIT ${COMPLEXITY_MAX_RESULT_ROWS}`;
    }

    this.logger.trace(CLASS_NAME, 'getTopComplexFiles', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getTopComplexFiles', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      filename: string;
      complexity: string;
      contributor: string;
      team: string | null;
      loc: string;
      percentage: string;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getTopComplexFiles', `Returned ${result.rowCount} complexity data points`);

    return result.rows.map((row) => ({
      filename: row.filename,
      complexity: Number(row.complexity),
      contributor: row.contributor,
      team: row.team,
      loc: Number(row.loc),
      percentage: Number(row.percentage),
    }));
  }
}
