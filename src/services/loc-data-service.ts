/**
 * Data service for the LOC Committed chart.
 * Queries commit_files JOIN commit_history JOIN commit_contributors
 * to aggregate lines of code committed by architecture component,
 * grouped by repository, team, or author.
 *
 * All queries use parameterized SQL ($1, $2 placeholders).
 * The groupBy column is validated against a runtime allowlist and
 * routed to separate hardcoded query constants -- zero string
 * interpolation for column selection.
 *
 * Security: CWE-89 (SQL Injection prevention), CWE-20 (Input validation).
 *
 * Ticket: IQS-889
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  LOC_COMMITTED_GROUP_BY_REPOSITORY,
  LOC_COMMITTED_GROUP_BY_TEAM,
  LOC_COMMITTED_GROUP_BY_AUTHOR,
  LOC_GROUP_SUFFIX_REPOSITORY,
  LOC_GROUP_SUFFIX_TEAM,
  LOC_GROUP_SUFFIX_AUTHOR,
  LOC_MAX_RESULT_ROWS,
} from '../database/queries/loc-queries.js';
import type {
  LocCommittedPoint,
  LocGroupBy,
  DashboardFilters,
} from './dashboard-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'LocDataService';

/**
 * Runtime allowlist for LOC Committed groupBy column selection.
 * Prevents SQL injection even if TypeScript type guard is bypassed.
 * Each value maps to a separate hardcoded query constant.
 * CWE-89: SQL Injection prevention.
 */
const ALLOWED_LOC_GROUP_BY: readonly string[] = ['repository', 'team', 'author'] as const;

/**
 * Maximum allowed length for filter string inputs (team, repository).
 * CWE-20: Input validation.
 */
const MAX_FILTER_STRING_LENGTH = 200;

/**
 * Service responsible for querying database tables and returning typed data
 * for the LOC Committed chart in the Metrics Dashboard webview.
 *
 * Ticket: IQS-889
 */
export class LocDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'LocDataService created');
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
   * Fetch LOC committed data grouped by repository, team, or author.
   * Returns all three metrics (linesAdded, netLines, totalChurn) in a single
   * result set so that the metric toggle can be purely client-side.
   *
   * The groupBy column is validated against an allowlist and routed to a
   * separate hardcoded query constant -- zero string interpolation for columns.
   *
   * @param groupBy - Grouping dimension: 'repository' | 'team' | 'author'
   * @param filters - Optional date range, team, and repository filters
   * @returns Array of LocCommittedPoint sorted by total churn descending
   */
  async getLocCommitted(
    groupBy: LocGroupBy,
    filters: DashboardFilters = {},
  ): Promise<LocCommittedPoint[]> {
    // IQS-889: Runtime allowlist validation for groupBy column (CWE-89 fix)
    if (!ALLOWED_LOC_GROUP_BY.includes(groupBy)) {
      this.logger.warn(CLASS_NAME, 'getLocCommitted', `Invalid groupBy rejected: ${String(groupBy).slice(0, 50)}`);
      throw new Error(`Invalid groupBy: ${String(groupBy)}. Allowed values: ${ALLOWED_LOC_GROUP_BY.join(', ')}.`);
    }

    // IQS-890: Validate filter inputs (CWE-20 fix)
    this.validateFilters(filters, 'getLocCommitted');

    this.logger.debug(CLASS_NAME, 'getLocCommitted', `Fetching LOC committed: groupBy=${groupBy}, filters=${JSON.stringify(filters)}`);

    // Build WHERE clause with parameterized placeholders
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // line_inserts must exist for LOC calculations
    conditions.push('cf.line_inserts IS NOT NULL');

    // Exclude merge commits to prevent double-counting LOC
    // (merge commits re-count all lines from the merged branch)
    conditions.push('ch.is_merge = FALSE');

    // Exclude dependency/generated directories from LOC calculations
    // These inflate metrics when accidentally committed to version control
    // Note: This is defense-in-depth; new data is filtered at insertion time
    // in SccMetricsService.isDependencyPath(), but existing data needs query filtering
    conditions.push("cf.filename NOT LIKE 'node_modules/%'");
    conditions.push("cf.filename NOT LIKE '%/node_modules/%'");
    conditions.push("cf.filename NOT LIKE 'vendor/%'");
    conditions.push("cf.filename NOT LIKE '%/vendor/%'");
    conditions.push("cf.filename NOT LIKE '.yarn/%'");
    conditions.push("cf.filename NOT LIKE 'bower_components/%'");
    conditions.push("cf.filename NOT LIKE '__pycache__/%'");
    conditions.push("cf.filename NOT LIKE '%/__pycache__/%'");
    conditions.push("cf.filename NOT LIKE '.venv/%'");
    conditions.push("cf.filename NOT LIKE 'venv/%'");
    conditions.push("cf.filename NOT LIKE 'target/%'");
    conditions.push("cf.filename NOT LIKE 'dist/%'");
    conditions.push("cf.filename NOT LIKE 'build/%'");
    conditions.push("cf.filename NOT LIKE 'bin/%'");
    conditions.push("cf.filename NOT LIKE 'obj/%'");

    if (filters.startDate) {
      conditions.push(`ch.commit_date >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`ch.commit_date <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.team) {
      conditions.push(`cc.team = $${paramIndex}`);
      params.push(filters.team);
      paramIndex++;
    }
    if (filters.repository) {
      conditions.push(`ch.repository = $${paramIndex}`);
      params.push(filters.repository);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Select the hardcoded query fragments based on validated groupBy
    let selectFragment: string;
    let groupSuffix: string;
    switch (groupBy) {
      case 'repository':
        selectFragment = LOC_COMMITTED_GROUP_BY_REPOSITORY;
        groupSuffix = LOC_GROUP_SUFFIX_REPOSITORY;
        break;
      case 'team':
        selectFragment = LOC_COMMITTED_GROUP_BY_TEAM;
        groupSuffix = LOC_GROUP_SUFFIX_TEAM;
        break;
      case 'author':
        selectFragment = LOC_COMMITTED_GROUP_BY_AUTHOR;
        groupSuffix = LOC_GROUP_SUFFIX_AUTHOR;
        break;
      default: {
        // Exhaustiveness guard (should never reach here after allowlist check)
        const _exhaustive: never = groupBy;
        throw new Error(`Unhandled groupBy: ${_exhaustive as string}`);
      }
    }

    // Add LIMIT parameter
    params.push(LOC_MAX_RESULT_ROWS);
    const limitPlaceholder = `$${paramIndex}`;

    const sql = `${selectFragment}${whereClause}\n${groupSuffix}\nLIMIT ${limitPlaceholder}`;

    this.logger.trace(CLASS_NAME, 'getLocCommitted', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getLocCommitted', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      group_key: string;
      arc_component: string;
      lines_added: string;
      net_lines: string;
      total_churn: string;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getLocCommitted', `Returned ${result.rowCount} LOC data points`);

    return result.rows.map((row) => ({
      groupKey: row.group_key,
      arcComponent: row.arc_component,
      linesAdded: Number(row.lines_added),
      netLines: Number(row.net_lines),
      totalChurn: Number(row.total_churn),
    }));
  }
}
