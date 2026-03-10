/**
 * Data service for the Top Files by Churn chart.
 * Queries commit_files JOIN commit_history JOIN commit_contributors
 * to get top N files by churn and team/contributor breakdown.
 *
 * Churn is calculated as SUM(line_inserts + line_deletes) per file.
 *
 * All queries use parameterized SQL ($1, $2 placeholders).
 * The groupBy mode (team vs individual) is validated against a runtime
 * allowlist and routed to separate hardcoded query constants -- zero
 * string interpolation for column selection.
 *
 * Security: CWE-89 (SQL Injection prevention), CWE-20 (Input validation).
 *
 * Ticket: IQS-895
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  FILE_CHURN_BY_TEAM,
  FILE_CHURN_TOP_FILES_SUFFIX,
  FILE_CHURN_TEAM_SELECT,
  FILE_CHURN_BY_INDIVIDUAL,
  FILE_CHURN_TOP_FILES_INDIVIDUAL_SUFFIX,
  FILE_CHURN_INDIVIDUAL_SELECT,
  FILE_CHURN_MAX_RESULT_ROWS,
  FILE_CHURN_MAX_TOP_N,
  FILE_CHURN_MIN_TOP_N,
  FILE_CHURN_DEFAULT_TOP_N,
  FILE_CHURN_DRILLDOWN_BY_TEAM,
  FILE_CHURN_DRILLDOWN_BY_INDIVIDUAL,
  FILE_CHURN_DRILLDOWN_DATE_SUFFIX,
} from '../database/queries/file-churn-queries.js';
import type {
  FileChurnPoint,
  FileChurnCommitDetail,
  FileChurnGroupBy,
  DashboardFilters,
} from './dashboard-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'FileChurnDataService';

/**
 * Runtime allowlist for file churn groupBy mode selection.
 * Prevents SQL injection even if TypeScript type guard is bypassed.
 * Each value maps to a separate hardcoded query constant.
 * CWE-89: SQL Injection prevention.
 */
const ALLOWED_FILE_CHURN_GROUP_BY: readonly string[] = ['team', 'individual'] as const;

/**
 * Maximum allowed length for filter string inputs (team, repository).
 * CWE-20: Input validation.
 */
const MAX_FILTER_STRING_LENGTH = 200;

/**
 * Maximum allowed length for filename parameter (drilldown).
 * CWE-20: Input validation.
 */
const MAX_FILENAME_LENGTH = 500;

/**
 * Maximum allowed length for contributor/team name parameter (drilldown).
 * CWE-20: Input validation.
 */
const MAX_CONTRIBUTOR_LENGTH = 200;

/**
 * Service responsible for querying database tables and returning typed data
 * for the Top Files by Churn chart in the Metrics Dashboard webview.
 *
 * Ticket: IQS-895
 */
export class FileChurnDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'FileChurnDataService created');
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
      this.logger.warn(CLASS_NAME, methodName, `Non-integer topN rejected: ${topN}, using default ${FILE_CHURN_DEFAULT_TOP_N}`);
      return FILE_CHURN_DEFAULT_TOP_N;
    }
    if (topN < FILE_CHURN_MIN_TOP_N) {
      this.logger.warn(CLASS_NAME, methodName, `topN below minimum: ${topN} < ${FILE_CHURN_MIN_TOP_N}, clamping to ${FILE_CHURN_MIN_TOP_N}`);
      return FILE_CHURN_MIN_TOP_N;
    }
    if (topN > FILE_CHURN_MAX_TOP_N) {
      this.logger.warn(CLASS_NAME, methodName, `topN above maximum: ${topN} > ${FILE_CHURN_MAX_TOP_N}, clamping to ${FILE_CHURN_MAX_TOP_N}`);
      return FILE_CHURN_MAX_TOP_N;
    }
    return topN;
  }

  /**
   * Fetch top N files by churn with team/contributor breakdown.
   * Returns data for a horizontal stacked bar chart where:
   * - Y-axis: Files sorted by total churn descending
   * - X-axis: Lines of code churned (adds + deletes)
   * - Bar segments: Colored by team or contributor
   *
   * @param groupBy - Grouping mode: 'team' or 'individual'
   * @param topN - Number of top files to return (default: 20, range: 1-100)
   * @param filters - Optional date range, team, and repository filters
   * @returns Array of FileChurnPoint sorted by total churn descending
   */
  async getTopFilesByChurn(
    groupBy: FileChurnGroupBy,
    topN: number = FILE_CHURN_DEFAULT_TOP_N,
    filters: DashboardFilters = {},
  ): Promise<FileChurnPoint[]> {
    // IQS-895: Runtime allowlist validation for groupBy (CWE-89 fix)
    if (!ALLOWED_FILE_CHURN_GROUP_BY.includes(groupBy)) {
      this.logger.warn(CLASS_NAME, 'getTopFilesByChurn', `Invalid groupBy rejected: ${String(groupBy).slice(0, 50)}`);
      throw new Error(`Invalid groupBy: ${String(groupBy)}. Allowed values: ${ALLOWED_FILE_CHURN_GROUP_BY.join(', ')}.`);
    }

    // Validate topN parameter
    const validatedTopN = this.validateTopN(topN, 'getTopFilesByChurn');

    // IQS-895: Validate filter inputs (CWE-20 fix)
    this.validateFilters(filters, 'getTopFilesByChurn');

    this.logger.debug(CLASS_NAME, 'getTopFilesByChurn', `Fetching top ${validatedTopN} files by churn: groupBy=${groupBy}, filters=${JSON.stringify(filters)}`);

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
    let topFilesSuffix: string;
    let aggregationSuffix: string;
    let selectQuery: string;

    if (groupBy === 'team') {
      baseQuery = FILE_CHURN_BY_TEAM;
      topFilesSuffix = FILE_CHURN_TOP_FILES_SUFFIX;
      aggregationSuffix = '';  // Team aggregation is in topFilesSuffix
      selectQuery = FILE_CHURN_TEAM_SELECT;
    } else {
      baseQuery = FILE_CHURN_BY_INDIVIDUAL;
      topFilesSuffix = FILE_CHURN_TOP_FILES_INDIVIDUAL_SUFFIX;
      aggregationSuffix = '';  // Individual aggregation is in topFilesSuffix
      selectQuery = FILE_CHURN_INDIVIDUAL_SELECT;
    }

    // Insert additional filter conditions if any
    let sql: string;
    if (additionalConditions.length > 0) {
      const additionalWhere = additionalConditions.map(c => `    AND ${c}`).join('\n');
      sql = `${baseQuery}\n${additionalWhere}\n${topFilesSuffix}\n${aggregationSuffix}\n${selectQuery}\nLIMIT ${FILE_CHURN_MAX_RESULT_ROWS}`;
    } else {
      sql = `${baseQuery}\n${topFilesSuffix}\n${aggregationSuffix}\n${selectQuery}\nLIMIT ${FILE_CHURN_MAX_RESULT_ROWS}`;
    }

    this.logger.trace(CLASS_NAME, 'getTopFilesByChurn', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getTopFilesByChurn', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      filename: string;
      total_churn: string;
      contributor: string;
      team: string | null;
      churn: string;
      percentage: string;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getTopFilesByChurn', `Returned ${result.rowCount} file churn data points`);

    return result.rows.map((row) => ({
      filename: row.filename,
      totalChurn: Number(row.total_churn),
      contributor: row.contributor,
      team: row.team,
      churn: Number(row.churn),
      percentage: Number(row.percentage),
    }));
  }

  /**
   * Fetch drill-down commit details for a specific file and team/contributor.
   * Returns the list of commits contributing to a specific bar segment.
   *
   * @param filename - The file path to drill down into
   * @param contributor - The team or contributor name
   * @param groupBy - Grouping mode: 'team' or 'individual'
   * @param filters - Optional date range filters
   * @returns Array of FileChurnCommitDetail
   */
  async getFileChurnDrilldown(
    filename: string,
    contributor: string,
    groupBy: FileChurnGroupBy,
    filters: DashboardFilters = {},
  ): Promise<FileChurnCommitDetail[]> {
    // Validate groupBy
    if (!ALLOWED_FILE_CHURN_GROUP_BY.includes(groupBy)) {
      this.logger.warn(CLASS_NAME, 'getFileChurnDrilldown', `Invalid groupBy rejected: ${String(groupBy).slice(0, 50)}`);
      throw new Error(`Invalid groupBy: ${String(groupBy)}. Allowed values: ${ALLOWED_FILE_CHURN_GROUP_BY.join(', ')}.`);
    }

    // Validate filename length
    if (filename.length > MAX_FILENAME_LENGTH) {
      this.logger.warn(CLASS_NAME, 'getFileChurnDrilldown', `Filename exceeds max length: ${filename.length} > ${MAX_FILENAME_LENGTH}`);
      throw new Error(`Filename exceeds maximum length of ${MAX_FILENAME_LENGTH} characters.`);
    }

    // Validate contributor length
    if (contributor.length > MAX_CONTRIBUTOR_LENGTH) {
      this.logger.warn(CLASS_NAME, 'getFileChurnDrilldown', `Contributor exceeds max length: ${contributor.length} > ${MAX_CONTRIBUTOR_LENGTH}`);
      throw new Error(`Contributor exceeds maximum length of ${MAX_CONTRIBUTOR_LENGTH} characters.`);
    }

    // Validate filters
    this.validateFilters(filters, 'getFileChurnDrilldown');

    this.logger.debug(CLASS_NAME, 'getFileChurnDrilldown', `Fetching drilldown: file=${filename.slice(0, 50)}, contributor=${contributor}, groupBy=${groupBy}`);

    // Build query
    const baseQuery = groupBy === 'team' ? FILE_CHURN_DRILLDOWN_BY_TEAM : FILE_CHURN_DRILLDOWN_BY_INDIVIDUAL;
    const params: unknown[] = [filename, contributor];
    let paramIndex = 3;

    const dateConditions: string[] = [];
    if (filters.startDate) {
      dateConditions.push(`AND ch.commit_date >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      dateConditions.push(`AND ch.commit_date <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }

    const sql = `${baseQuery}\n${dateConditions.join('\n')}\n${FILE_CHURN_DRILLDOWN_DATE_SUFFIX}`;

    this.logger.trace(CLASS_NAME, 'getFileChurnDrilldown', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getFileChurnDrilldown', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      sha: string;
      commit_date: string;
      author: string;
      message: string;
      lines_added: string;
      lines_deleted: string;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getFileChurnDrilldown', `Returned ${result.rowCount} commit details`);

    return result.rows.map((row) => ({
      sha: row.sha,
      commitDate: row.commit_date,
      author: row.author,
      message: row.message,
      linesAdded: Number(row.lines_added),
      linesDeleted: Number(row.lines_deleted),
    }));
  }
}
