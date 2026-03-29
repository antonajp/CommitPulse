/**
 * Data service for the Complexity Trend chart.
 * Provides methods to fetch complexity trend data from commit_files
 * joined with commit_history and commit_contributors, with optional
 * filtering by date range, team, contributor, repository, and tech stack.
 *
 * GITX-136: Added support for multi-series visualization with:
 * - viewMode (contributor/team/repository/archLayer)
 * - metric (average/total)
 * - period (weekly/monthly/annual)
 * - topN limiting
 * - selectedEntities multi-select
 * - pre-filters applied before viewMode breakdown
 *
 * All queries use parameterized SQL ($1, $2 placeholders).
 *
 * Ticket: GITX-133, GITX-134, GITX-136
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  QUERY_COMPLEXITY_TREND_DATA_EXISTS,
  QUERY_COMPLEXITY_TREND_TEAMS,
  QUERY_COMPLEXITY_TREND_CONTRIBUTORS,
  QUERY_COMPLEXITY_TREND_REPOSITORIES,
  QUERY_COMPLEXITY_TREND_TECH_STACKS,
} from '../database/queries/complexity-trend-queries.js';
import type {
  ComplexityTrendFilters,
  ComplexityTrendPoint,
  ComplexityTrendFilterOptions,
  ComplexityTrendPeriod,
  ComplexityTrendViewMode,
  ComplexityTrendTopN,
  ComplexityTrendEntityRanking,
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
 * GITX-136: Removed 'daily', added 'annual'.
 */
const ALLOWED_PERIODS: readonly ComplexityTrendPeriod[] = ['weekly', 'monthly', 'annual'] as const;

/**
 * Allowed viewMode values (runtime allowlist) - GITX-136.
 */
const ALLOWED_VIEW_MODES: readonly ComplexityTrendViewMode[] = [
  'contributor',
  'team',
  'repository',
  'archLayer',
] as const;

/**
 * Allowed topN values (runtime allowlist) - GITX-136.
 */
const ALLOWED_TOP_N: readonly ComplexityTrendTopN[] = [5, 10, 20] as const;

/**
 * Allowed tech stack categories (CWE-20 input validation).
 * These must match the categories in vw_technology_stack_category.
 * Ticket: GITX-134
 */
const ALLOWED_TECH_STACK_CATEGORIES: readonly string[] = [
  'Audio',
  'Backend',
  'Configuration',
  'Database',
  'Dev Ops',
  'Document',
  'Frontend',
  'Image',
  'Multimedia',
  'Other',
  'Process Automation',
  'Reports',
  'Testing',
] as const;

/**
 * Response type for chart data.
 */
export interface ComplexityTrendChartData {
  readonly data: readonly ComplexityTrendPoint[];
  readonly hasData: boolean;
}

/**
 * Internal type for query builder result.
 */
interface QueryBuilderResult {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * Service responsible for querying commit_files and commit_history tables
 * and returning typed data for the Complexity Trend chart.
 *
 * Ticket: GITX-133, GITX-134, GITX-136
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
   * Fetch filter options for dropdowns (teams, contributors, repos, tech stacks).
   *
   * @returns Filter options with teams, contributors, repositories, and techStacks
   */
  async getFilterOptions(): Promise<ComplexityTrendFilterOptions> {
    this.logger.debug(CLASS_NAME, 'getFilterOptions', 'Fetching filter options');

    try {
      const [teamsResult, contributorsResult, reposResult, techStacksResult] = await Promise.all([
        this.db.query<{ team: string }>(QUERY_COMPLEXITY_TREND_TEAMS),
        this.db.query<{ contributor: string }>(QUERY_COMPLEXITY_TREND_CONTRIBUTORS),
        this.db.query<{ repository: string }>(QUERY_COMPLEXITY_TREND_REPOSITORIES),
        this.db.query<{ category: string }>(QUERY_COMPLEXITY_TREND_TECH_STACKS),
      ]);

      const teams = teamsResult.rows.map(row => row.team).filter(Boolean);
      const contributors = contributorsResult.rows.map(row => row.contributor).filter(Boolean);
      const repositories = reposResult.rows.map(row => row.repository).filter(Boolean);
      const techStacks = techStacksResult.rows.map(row => row.category).filter(Boolean);

      this.logger.debug(
        CLASS_NAME,
        'getFilterOptions',
        `Found ${teams.length} teams, ${contributors.length} contributors, ` +
          `${repositories.length} repositories, ${techStacks.length} tech stacks`,
      );

      return { teams, contributors, repositories, techStacks };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'getFilterOptions', `Error fetching filter options: ${errorMsg}`);
      return { teams: [], contributors: [], repositories: [], techStacks: [] };
    }
  }

  /**
   * Validate filter inputs for security (CWE-20, CWE-89 prevention).
   *
   * @param filters - Filters to validate
   * @throws Error if any filter is invalid
   */
  private validateFilters(filters: ComplexityTrendFilters): void {
    // Validate period (GITX-136: weekly, monthly, annual)
    const period = filters.period ?? 'monthly';
    if (!ALLOWED_PERIODS.includes(period)) {
      throw new Error(`Invalid period: ${period}. Allowed: ${ALLOWED_PERIODS.join(', ')}`);
    }

    // Validate viewMode (GITX-136)
    if (filters.viewMode !== undefined && !ALLOWED_VIEW_MODES.includes(filters.viewMode)) {
      throw new Error(`Invalid viewMode: ${filters.viewMode}. Allowed: ${ALLOWED_VIEW_MODES.join(', ')}`);
    }

    // Validate metric (GITX-136)
    if (filters.metric !== undefined && filters.metric !== 'average' && filters.metric !== 'total') {
      throw new Error(`Invalid metric: ${filters.metric}. Allowed: average, total`);
    }

    // Validate topN (GITX-136)
    if (filters.topN !== undefined && !ALLOWED_TOP_N.includes(filters.topN)) {
      throw new Error(`Invalid topN: ${filters.topN}. Allowed: ${ALLOWED_TOP_N.join(', ')}`);
    }

    // Validate selectedEntities (GITX-136)
    if (filters.selectedEntities !== undefined) {
      if (!Array.isArray(filters.selectedEntities)) {
        throw new Error('selectedEntities must be an array');
      }
      if (filters.selectedEntities.length > 50) {
        throw new Error('selectedEntities exceeds maximum of 50 entities');
      }
      for (const entity of filters.selectedEntities) {
        if (typeof entity !== 'string' || entity.length > MAX_FILTER_STRING_LENGTH) {
          throw new Error(`Invalid entity in selectedEntities: exceeds ${MAX_FILTER_STRING_LENGTH} characters`);
        }
      }
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

    // Validate string length for pre-filter values
    if (filters.team && filters.team.length > MAX_FILTER_STRING_LENGTH) {
      throw new Error(`Team filter exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
    }
    if (filters.contributor && filters.contributor.length > MAX_FILTER_STRING_LENGTH) {
      throw new Error(`Contributor filter exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
    }
    if (filters.repository && filters.repository.length > MAX_FILTER_STRING_LENGTH) {
      throw new Error(`Repository filter exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
    }

    // Validate tech stack against allowlist (GITX-134)
    if (filters.techStack) {
      if (filters.techStack.length > MAX_FILTER_STRING_LENGTH) {
        throw new Error(`Tech stack filter exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
      }
      if (!ALLOWED_TECH_STACK_CATEGORIES.includes(filters.techStack)) {
        throw new Error(
          `Invalid tech stack category: ${filters.techStack}. Allowed: ${ALLOWED_TECH_STACK_CATEGORIES.join(', ')}`,
        );
      }
    }
  }

  /**
   * Get the date aggregation expression based on period.
   * Uses allowlist validation for defense-in-depth.
   * GITX-136: Added 'annual' period, removed 'daily'.
   *
   * @param period - Time period (weekly, monthly, annual)
   * @returns SQL expression for date aggregation
   */
  private getDateAggregation(period: ComplexityTrendPeriod): string {
    // Allowlist validation - this should never throw if validateFilters was called
    if (!ALLOWED_PERIODS.includes(period)) {
      throw new Error(`Invalid period: ${period}`);
    }

    // Static lookup - no string interpolation
    const dateAggregationMap: Record<ComplexityTrendPeriod, string> = {
      weekly: "DATE_TRUNC('week', ch.commit_date)::DATE",
      monthly: "DATE_TRUNC('month', ch.commit_date)::DATE",
      annual: "DATE_TRUNC('year', ch.commit_date)::DATE",
    };

    return dateAggregationMap[period];
  }

  /**
   * Get the group key expression based on viewMode dimension.
   * Uses allowlist validation for defense-in-depth.
   * GITX-136: Renamed from getGroupKeyExpression, uses viewMode.
   *
   * @param viewMode - View mode dimension
   * @returns SQL expression for group key
   */
  private getViewModeExpression(viewMode: ComplexityTrendViewMode): string {
    // Allowlist validation - this should never throw if validateFilters was called
    if (!ALLOWED_VIEW_MODES.includes(viewMode)) {
      throw new Error(`Invalid viewMode: ${viewMode}`);
    }

    // Static lookup - no string interpolation
    const viewModeMap: Record<ComplexityTrendViewMode, string> = {
      contributor: 'COALESCE(cc.full_name, ch.author)',
      team: "COALESCE(cc.team, 'Unassigned')",
      repository: 'ch.repository',
      archLayer: 'vtsc.category',
    };

    return viewModeMap[viewMode];
  }

  /**
   * Build SQL query dynamically based on filters.
   * Uses parameterized queries only - no string interpolation of user input.
   *
   * GITX-136: Updated to support viewMode, topN, selectedEntities, and totalComplexity.
   *
   * @param filters - Validated filters
   * @param startDate - Start date (validated)
   * @param endDate - End date (validated)
   * @returns QueryBuilderResult with SQL and parameters
   */
  private buildQuery(
    filters: ComplexityTrendFilters,
    startDate: string,
    endDate: string,
  ): QueryBuilderResult {
    const period = filters.period ?? 'monthly';
    const viewMode = filters.viewMode ?? 'contributor';

    const dateAggregation = this.getDateAggregation(period);
    const viewModeExpression = this.getViewModeExpression(viewMode);

    // Build parameter array - dates are always first two params
    const params: unknown[] = [startDate, endDate];
    let paramIndex = 3;

    // Build WHERE clause conditions
    const whereConditions: string[] = [
      'ch.is_merge = FALSE',
      '(cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)',
      'ch.commit_date >= $1::DATE',
      'ch.commit_date <= $2::DATE',
    ];

    // Determine if tech stack JOIN is needed (GITX-136)
    const needsTechStackJoin = viewMode === 'archLayer' || filters.techStack !== undefined;

    // Add pre-filter conditions with parameterized values (GITX-136)
    if (filters.team) {
      whereConditions.push(`cc.team = $${paramIndex}`);
      params.push(filters.team);
      paramIndex++;
    }
    if (filters.contributor) {
      whereConditions.push(`(cc.full_name = $${paramIndex} OR ch.author = $${paramIndex})`);
      params.push(filters.contributor);
      paramIndex++;
    }
    if (filters.repository) {
      whereConditions.push(`ch.repository = $${paramIndex}`);
      params.push(filters.repository);
      paramIndex++;
    }
    if (filters.techStack) {
      whereConditions.push(`vtsc.category = $${paramIndex}`);
      params.push(filters.techStack);
      paramIndex++;
    }

    // Add selectedEntities filter if provided (GITX-136)
    if (filters.selectedEntities && filters.selectedEntities.length > 0) {
      const placeholders = filters.selectedEntities.map((_, i) => `$${paramIndex + i}`).join(', ');
      whereConditions.push(`${viewModeExpression} IN (${placeholders})`);
      params.push(...filters.selectedEntities);
      paramIndex += filters.selectedEntities.length;
    }

    // Build the complete SQL query
    const techStackJoin = needsTechStackJoin
      ? 'LEFT JOIN vw_technology_stack_category vtsc ON cf.file_extension = vtsc.file_extension'
      : '';

    // Add LIMIT as parameterized value (CWE-89 prevention)
    const limitParamIndex = paramIndex;
    params.push(MAX_RESULT_ROWS);

    // GITX-136: Added total_complexity for metric toggle support
    const sql = `
SELECT
  ${dateAggregation} AS date,
  ${viewModeExpression} AS group_key,
  AVG(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS avg_complexity,
  SUM(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS total_complexity,
  SUM(COALESCE(cf.complexity_change, 0))::BIGINT AS complexity_delta,
  MAX(COALESCE(cf.complexity, cf.weighted_complexity, 0))::INTEGER AS max_complexity,
  COUNT(DISTINCT ch.sha)::INTEGER AS commit_count,
  COUNT(DISTINCT cf.filename)::INTEGER AS file_count
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
${techStackJoin}
WHERE ${whereConditions.join('\n  AND ')}
GROUP BY ${dateAggregation}, ${viewModeExpression}
ORDER BY date ASC, total_complexity DESC
LIMIT $${limitParamIndex};
`;

    this.logger.trace(CLASS_NAME, 'buildQuery', `Generated SQL for viewMode=${viewMode}, period=${period}`);
    this.logger.trace(CLASS_NAME, 'buildQuery', `Params: ${JSON.stringify(params)}`);

    return { sql, params };
  }

  /**
   * Fetch complexity trend data with optional filters.
   * Validates inputs before query execution.
   *
   * GITX-136: Updated to support viewMode, topN, selectedEntities, and totalComplexity.
   *
   * @param filters - Optional filters including viewMode, metric, topN, selectedEntities
   * @returns Array of ComplexityTrendPoint sorted by date ascending
   */
  async getComplexityTrend(filters: ComplexityTrendFilters = {}): Promise<readonly ComplexityTrendPoint[]> {
    this.logger.debug(CLASS_NAME, 'getComplexityTrend', `Fetching data: filters=${JSON.stringify(filters)}`);

    // Validate all inputs
    this.validateFilters(filters);

    // Calculate date range
    const endDate: string = filters.endDate ?? new Date().toISOString().split('T')[0]!;
    const startDate = filters.startDate ?? this.calculateStartDate(endDate, DEFAULT_DAYS_BACK);

    // Build and execute query
    const { sql, params } = this.buildQuery(filters, startDate, endDate);

    const result = await this.db.query<{
      date: Date | string;
      group_key: string;
      avg_complexity: number;
      total_complexity: number;
      complexity_delta: number;
      max_complexity: number;
      commit_count: number;
      file_count: number;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getComplexityTrend', `Query returned ${result.rows.length} rows`);

    // Apply row limit for safety (limit is in query, but double-check)
    let limitedRows = result.rows.slice(0, MAX_RESULT_ROWS);
    if (result.rows.length > MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getComplexityTrend',
        `Result set truncated from ${result.rows.length} to ${MAX_RESULT_ROWS} rows`,
      );
    }

    // GITX-136: Apply topN filtering if specified and no selectedEntities
    if (filters.topN && (!filters.selectedEntities || filters.selectedEntities.length === 0)) {
      const topEntities = this.getTopEntities(limitedRows, filters.topN);
      limitedRows = limitedRows.filter(row => topEntities.has(row.group_key));
      this.logger.debug(
        CLASS_NAME,
        'getComplexityTrend',
        `Applied topN=${filters.topN}, kept ${topEntities.size} entities`,
      );
    }

    const rows: ComplexityTrendPoint[] = limitedRows.map(row => ({
      date: row.date instanceof Date ? row.date.toISOString().split('T')[0] ?? '' : String(row.date),
      groupKey: row.group_key ?? 'Unknown',
      avgComplexity: Number(row.avg_complexity) || 0,
      totalComplexity: Number(row.total_complexity) || 0,
      complexityDelta: Number(row.complexity_delta) || 0,
      maxComplexity: Number(row.max_complexity) || 0,
      commitCount: Number(row.commit_count) || 0,
      fileCount: Number(row.file_count) || 0,
    }));

    this.logger.debug(CLASS_NAME, 'getComplexityTrend', `Returning ${rows.length} trend data points`);
    return rows;
  }

  /**
   * Get top N entities by total complexity from result set.
   * GITX-136
   *
   * @param rows - Query result rows
   * @param topN - Number of top entities to return
   * @returns Set of entity names (group_key values)
   */
  private getTopEntities(
    rows: readonly { group_key: string; total_complexity: number }[],
    topN: ComplexityTrendTopN,
  ): Set<string> {
    // Sum total complexity by entity
    const entityTotals = new Map<string, number>();
    for (const row of rows) {
      const current = entityTotals.get(row.group_key) ?? 0;
      entityTotals.set(row.group_key, current + Number(row.total_complexity));
    }

    // Sort by total complexity descending and take top N
    const sorted = Array.from(entityTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN);

    return new Set(sorted.map(([entity]) => entity));
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
   * Get entity rankings for the Top N dropdown and multi-select picker.
   * Returns entities sorted by total complexity descending.
   * GITX-136
   *
   * @param viewMode - Which dimension to rank entities for
   * @param filters - Pre-filters to apply before ranking
   * @returns Array of entity rankings sorted by total complexity
   */
  async getEntityRankings(
    viewMode: ComplexityTrendViewMode,
    filters: ComplexityTrendFilters = {},
  ): Promise<readonly ComplexityTrendEntityRanking[]> {
    this.logger.debug(
      CLASS_NAME,
      'getEntityRankings',
      `Fetching rankings for viewMode=${viewMode}, filters=${JSON.stringify(filters)}`,
    );

    // Validate viewMode
    if (!ALLOWED_VIEW_MODES.includes(viewMode)) {
      throw new Error(`Invalid viewMode: ${viewMode}. Allowed: ${ALLOWED_VIEW_MODES.join(', ')}`);
    }

    // Calculate date range
    const endDate: string = filters.endDate ?? new Date().toISOString().split('T')[0]!;
    const startDate = filters.startDate ?? this.calculateStartDate(endDate, DEFAULT_DAYS_BACK);

    const viewModeExpression = this.getViewModeExpression(viewMode);

    // Build parameter array
    const params: unknown[] = [startDate, endDate];
    let paramIndex = 3;

    // Build WHERE clause conditions
    const whereConditions: string[] = [
      'ch.is_merge = FALSE',
      '(cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL)',
      'ch.commit_date >= $1::DATE',
      'ch.commit_date <= $2::DATE',
    ];

    // Determine if tech stack JOIN is needed
    const needsTechStackJoin = viewMode === 'archLayer' || filters.techStack !== undefined;

    // Add pre-filter conditions
    if (filters.team) {
      whereConditions.push(`cc.team = $${paramIndex}`);
      params.push(filters.team);
      paramIndex++;
    }
    if (filters.contributor) {
      whereConditions.push(`(cc.full_name = $${paramIndex} OR ch.author = $${paramIndex})`);
      params.push(filters.contributor);
      paramIndex++;
    }
    if (filters.repository) {
      whereConditions.push(`ch.repository = $${paramIndex}`);
      params.push(filters.repository);
      paramIndex++;
    }
    if (filters.techStack) {
      whereConditions.push(`vtsc.category = $${paramIndex}`);
      params.push(filters.techStack);
      paramIndex++;
    }

    const techStackJoin = needsTechStackJoin
      ? 'LEFT JOIN vw_technology_stack_category vtsc ON cf.file_extension = vtsc.file_extension'
      : '';

    // Limit to 100 entities max
    const limitParamIndex = paramIndex;
    params.push(100);

    const sql = `
SELECT
  ${viewModeExpression} AS entity,
  SUM(COALESCE(cf.complexity, cf.weighted_complexity, 0))::NUMERIC(10,2) AS total_complexity
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
${techStackJoin}
WHERE ${whereConditions.join('\n  AND ')}
GROUP BY ${viewModeExpression}
HAVING SUM(COALESCE(cf.complexity, cf.weighted_complexity, 0)) > 0
ORDER BY total_complexity DESC
LIMIT $${limitParamIndex};
`;

    const result = await this.db.query<{
      entity: string;
      total_complexity: number;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getEntityRankings', `Query returned ${result.rows.length} entities`);

    return result.rows.map(row => ({
      entity: row.entity ?? 'Unknown',
      totalComplexity: Number(row.total_complexity) || 0,
    }));
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
