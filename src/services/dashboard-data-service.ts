/**
 * Dashboard data service for querying analytics views.
 * Provides methods to fetch data for the Metrics Dashboard webview:
 * - Commit velocity (commits per day/week by repo)
 * - Technology stack distribution (file extensions by category)
 * - Team scorecards (weighted scores by contributor)
 * - File complexity trends (top N files by complexity change)
 * - Filter options (available teams and repositories)
 *
 * All queries use parameterized SQL ($1, $2 placeholders).
 * Data is sourced from PostgreSQL views:
 *   vw_scorecard, vw_scorecard_detail, vw_commit_file_chage_history,
 *   vw_technology_stack_category, vw_technology_stack_complexity
 *
 * Security: Runtime input validation for all user-supplied inputs (IQS-890).
 *
 * Ticket: IQS-869, IQS-890
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import { classifyProfile } from './contributor-profile-classifier.js';
import type {
  CommitVelocityPoint,
  VelocityGranularity,
  TechStackEntry,
  ScorecardRow,
  ScorecardDetailRow,
  FileComplexityPoint,
  DashboardFilters,
  FilterOptions,
} from './dashboard-data-types.js';
import type { ContributorMetrics, TeamPercentiles } from './contributor-profile-classifier.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DashboardDataService';

/**
 * Default number of top files to return for complexity trends.
 */
const DEFAULT_TOP_N_FILES = 20;

/**
 * Runtime allowlist for DATE_TRUNC granularity values.
 * Prevents SQL injection even if TypeScript type guard is bypassed.
 * CWE-89: SQL Injection prevention.
 */
const ALLOWED_GRANULARITIES: readonly string[] = ['day', 'week'] as const;

/**
 * Maximum allowed length for filter string inputs (team, repository).
 * Prevents performance issues from extremely large payloads.
 * CWE-20: Input validation.
 */
const MAX_FILTER_STRING_LENGTH = 200;

/**
 * Maximum number of repositories allowed in the filter array.
 * Prevents performance issues from extremely large arrays.
 * CWE-20: Input validation.
 */
const MAX_REPOSITORY_ARRAY_LENGTH = 50;

/**
 * Normalize repository filter to an array and validate length.
 * @param repository - Single string or array of strings
 * @returns Validated array of repository names, or undefined
 */
function normalizeRepositoryFilter(repository: string | readonly string[] | undefined): readonly string[] | undefined {
  if (repository === undefined) {
    return undefined;
  }
  const repos = typeof repository === 'string' ? [repository] : repository;
  if (repos.length === 0) {
    return undefined;
  }
  if (repos.length > MAX_REPOSITORY_ARRAY_LENGTH) {
    throw new Error(`Repository filter exceeds maximum of ${MAX_REPOSITORY_ARRAY_LENGTH} entries.`);
  }
  return repos;
}


/**
 * Service responsible for querying database views and returning
 * typed data for the Metrics Dashboard webview panels.
 *
 * Ticket: IQS-869
 */
export class DashboardDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'DashboardDataService created');
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Build a parameterized IN clause for repository filtering.
   * @param repos - Array of repository names
   * @param params - Parameter array to append values to
   * @param startParamIndex - Starting parameter index ($N)
   * @param tableAlias - Table alias for the repository column (e.g., 'ch')
   * @returns Object with condition string and next parameter index
   */
  private buildRepositoryInClause(
    repos: readonly string[],
    params: unknown[],
    startParamIndex: number,
    tableAlias: string,
  ): { condition: string; nextParamIndex: number } {
    const placeholders = repos.map((_, i) => `$${startParamIndex + i}`);
    params.push(...repos);
    return {
      condition: `${tableAlias}.repository IN (${placeholders.join(', ')})`,
      nextParamIndex: startParamIndex + repos.length,
    };
  }

  // ==========================================================================
  // Input Validation (IQS-890)
  // ==========================================================================

  /**
   * Validate dashboard filter inputs at runtime.
   * Checks date format/range, date ordering, and filter string lengths.
   * Throws descriptive errors with WARN-level logging for invalid inputs.
   *
   * @param filters - The dashboard filters to validate
   * @param methodName - Calling method name for log context
   */
  private validateFilters(filters: DashboardFilters, methodName: string): void {
    // Validate startDate format and range
    if (filters.startDate !== undefined) {
      if (!isValidDateString(filters.startDate)) {
        this.logger.warn(CLASS_NAME, methodName, `Invalid startDate rejected: ${filters.startDate}`);
        throw new Error(`Invalid startDate: ${filters.startDate}. Expected YYYY-MM-DD format within valid range (1970 to present+1yr).`);
      }
    }

    // Validate endDate format and range
    if (filters.endDate !== undefined) {
      if (!isValidDateString(filters.endDate)) {
        this.logger.warn(CLASS_NAME, methodName, `Invalid endDate rejected: ${filters.endDate}`);
        throw new Error(`Invalid endDate: ${filters.endDate}. Expected YYYY-MM-DD format within valid range (1970 to present+1yr).`);
      }
    }

    // Validate startDate <= endDate ordering
    if (filters.startDate !== undefined && filters.endDate !== undefined) {
      if (filters.startDate > filters.endDate) {
        this.logger.warn(CLASS_NAME, methodName, `Date range reversed: startDate=${filters.startDate} > endDate=${filters.endDate}`);
        throw new Error(`Invalid date range: startDate (${filters.startDate}) must be <= endDate (${filters.endDate}).`);
      }
    }

    // Validate team filter string length
    if (filters.team !== undefined) {
      if (filters.team.length > MAX_FILTER_STRING_LENGTH) {
        this.logger.warn(CLASS_NAME, methodName, `Team filter exceeds max length: ${filters.team.length} > ${MAX_FILTER_STRING_LENGTH}`);
        throw new Error(`Team filter exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
      }
    }

    // Validate repository filter - can be string or array
    if (filters.repository !== undefined) {
      const repos = typeof filters.repository === 'string' ? [filters.repository] : filters.repository;
      if (repos.length > MAX_REPOSITORY_ARRAY_LENGTH) {
        this.logger.warn(CLASS_NAME, methodName, `Repository filter array exceeds max length: ${repos.length} > ${MAX_REPOSITORY_ARRAY_LENGTH}`);
        throw new Error(`Repository filter exceeds maximum of ${MAX_REPOSITORY_ARRAY_LENGTH} entries.`);
      }
      for (const repo of repos) {
        if (repo.length > MAX_FILTER_STRING_LENGTH) {
          this.logger.warn(CLASS_NAME, methodName, `Repository name exceeds max length: ${repo.length} > ${MAX_FILTER_STRING_LENGTH}`);
          throw new Error(`Repository name exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
        }
      }
    }
  }

  // ==========================================================================
  // LOC per Week (IQS-919: renamed from Commit Velocity)
  // ==========================================================================

  /**
   * Fetch LOC per week/day data: total lines of code changed per time bucket, grouped by repository.
   * Queries commit_history joined with commit_files to sum line_inserts + line_deletes.
   *
   * IQS-919: Changed from counting commits to summing LOC (lines added + lines deleted).
   *
   * @param granularity - 'day' or 'week' aggregation bucket
   * @param filters - Optional date range, team, and repository filters
   * @returns Array of CommitVelocityPoint sorted by date ascending
   */
  async getCommitVelocity(
    granularity: VelocityGranularity,
    filters: DashboardFilters = {},
  ): Promise<CommitVelocityPoint[]> {
    // IQS-890: Runtime allowlist validation for DATE_TRUNC granularity (CWE-89 fix)
    if (!ALLOWED_GRANULARITIES.includes(granularity)) {
      this.logger.warn(CLASS_NAME, 'getCommitVelocity', `Invalid granularity rejected: ${String(granularity).slice(0, 50)}`);
      throw new Error(`Invalid granularity: ${String(granularity)}. Allowed values: ${ALLOWED_GRANULARITIES.join(', ')}.`);
    }

    // IQS-890: Validate filter inputs (CWE-20 fix)
    this.validateFilters(filters, 'getCommitVelocity');

    // Log after validation to avoid logging oversized/malicious payloads
    this.logger.debug(CLASS_NAME, 'getCommitVelocity', `Fetching LOC per ${granularity}: filters=${JSON.stringify(filters)}`);

    const dateTrunc = granularity === 'week' ? 'week' : 'day';
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

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
    if (filters.repository) {
      const repos = normalizeRepositoryFilter(filters.repository);
      if (repos) {
        const { condition, nextParamIndex } = this.buildRepositoryInClause(repos, params, paramIndex, 'ch');
        conditions.push(condition);
        paramIndex = nextParamIndex;
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // IQS-919: Query sums LOC (line_inserts + line_deletes) instead of counting commits
    const sql = `
      SELECT
        DATE_TRUNC('${dateTrunc}', ch.commit_date)::DATE AS date,
        ch.repository,
        COALESCE(SUM(cf.line_inserts + cf.line_deletes), 0)::BIGINT AS loc_count
      FROM commit_history ch
      LEFT JOIN commit_files cf ON ch.sha = cf.sha
      ${whereClause}
      GROUP BY DATE_TRUNC('${dateTrunc}', ch.commit_date)::DATE, ch.repository
      ORDER BY date ASC, ch.repository ASC
    `;

    this.logger.trace(CLASS_NAME, 'getCommitVelocity', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getCommitVelocity', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      date: Date;
      repository: string;
      loc_count: string; // BIGINT returns as string from pg
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getCommitVelocity', `Returned ${result.rowCount} LOC data points`);

    return result.rows.map((row) => ({
      date: row.date instanceof Date ? row.date.toISOString().split('T')[0] ?? '' : String(row.date),
      repository: row.repository,
      locCount: parseInt(row.loc_count, 10) || 0,
    }));
  }

  // ==========================================================================
  // Technology Stack Distribution
  // ==========================================================================

  /**
   * Fetch technology stack distribution: file extensions grouped by category.
   * Queries vw_technology_stack_category view.
   *
   * @param filters - Optional repository filter
   * @returns Array of TechStackEntry sorted by file count descending
   */
  async getTechStackDistribution(filters: DashboardFilters = {}): Promise<TechStackEntry[]> {
    this.validateFilters(filters, 'getTechStackDistribution');
    this.logger.debug(CLASS_NAME, 'getTechStackDistribution', `Fetching tech stack distribution: filters=${JSON.stringify(filters)}`);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    const repos = normalizeRepositoryFilter(filters.repository);
    if (repos) {
      // Join with commit_history to get repository context
      // vw_technology_stack_category is based on commit_files_types which has sha FK to commit_history
      const placeholders = repos.map((_, i) => `$${paramIndex + i}`);
      params.push(...repos);
      paramIndex += repos.length;
      conditions.push(`ch.repository IN (${placeholders.join(', ')})`);
    }

    // Build the query with optional repository filter
    // Need to join commit_files_types with commit_history to filter by repository
    // since vw_technology_stack_category doesn't include repository context directly
    let sql: string;
    if (conditions.length > 0) {
      // Query with repository filter - join through commit_files_types and commit_history
      sql = `
        SELECT
          vtsc.category,
          COUNT(DISTINCT cft.file_extension)::INTEGER AS extension_count,
          COUNT(*)::INTEGER AS file_count
        FROM commit_files_types cft
        INNER JOIN commit_history ch ON cft.sha = ch.sha
        INNER JOIN vw_technology_stack_category vtsc ON cft.file_extension = vtsc.file_extension
        WHERE ${conditions.join(' AND ')}
        GROUP BY vtsc.category
        ORDER BY file_count DESC
      `;
    } else {
      // Original query without filter
      sql = `
        SELECT
          vtsc.category,
          COUNT(DISTINCT vtsc.file_extension)::INTEGER AS extension_count,
          COUNT(*)::INTEGER AS file_count
        FROM vw_technology_stack_category vtsc
        GROUP BY vtsc.category
        ORDER BY file_count DESC
      `;
    }

    this.logger.trace(CLASS_NAME, 'getTechStackDistribution', `SQL: ${sql.trim()}`);
    if (params.length > 0) {
      this.logger.trace(CLASS_NAME, 'getTechStackDistribution', `Params: ${JSON.stringify(params)}`);
    }

    const result = await this.db.query<{
      category: string;
      extension_count: number;
      file_count: number;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getTechStackDistribution', `Returned ${result.rowCount} categories`);

    return result.rows.map((row) => ({
      category: row.category,
      extensionCount: row.extension_count,
      fileCount: row.file_count,
    }));
  }

  // ==========================================================================
  // Team Scorecard
  // ==========================================================================

  /**
   * Fetch team scorecard summary data from vw_scorecard.
   * Optionally filtered by team and repository.
   *
   * @param filters - Optional team and repository filters
   * @returns Array of ScorecardRow sorted by total score descending
   */
  async getScorecard(filters: DashboardFilters = {}): Promise<ScorecardRow[]> {
    // IQS-890: Validate filter inputs (CWE-20 fix)
    this.validateFilters(filters, 'getScorecard');

    this.logger.debug(CLASS_NAME, 'getScorecard', `Fetching scorecard: filters=${JSON.stringify(filters)}`);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.team) {
      conditions.push(`vs.team = $${paramIndex}`);
      params.push(filters.team);
      paramIndex++;
    }

    const repos = normalizeRepositoryFilter(filters.repository);
    if (repos) {
      // Filter by repository - need to ensure contributors have commits in selected repos
      const placeholders = repos.map((_, i) => `$${paramIndex + i}`);
      params.push(...repos);
      paramIndex += repos.length;
      conditions.push(`EXISTS (
        SELECT 1 FROM commit_history ch
        INNER JOIN commit_contributors cc2 ON ch.author = cc2.login
        WHERE cc2.full_name = vs.full_name
        AND ch.repository IN (${placeholders.join(', ')})
      )`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        vs.full_name,
        vs.team,
        vs.vendor,
        vs.total_score::NUMERIC(12,2)
      FROM vw_scorecard vs
      ${whereClause}
      ORDER BY vs.total_score DESC
    `;

    this.logger.trace(CLASS_NAME, 'getScorecard', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getScorecard', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      full_name: string;
      team: string;
      vendor: string;
      total_score: string;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getScorecard', `Returned ${result.rowCount} scorecard rows`);

    return result.rows.map((row) => ({
      fullName: row.full_name,
      team: row.team,
      vendor: row.vendor,
      totalScore: parseFloat(row.total_score),
    }));
  }

  /**
   * Fetch detailed scorecard breakdown from vw_scorecard_detail.
   * Optionally filtered by team and repository.
   *
   * @param filters - Optional team and repository filters
   * @returns Array of ScorecardDetailRow sorted by total computed score descending
   */
  async getScorecardDetail(filters: DashboardFilters = {}): Promise<ScorecardDetailRow[]> {
    // IQS-890: Validate filter inputs (CWE-20 fix)
    this.validateFilters(filters, 'getScorecardDetail');

    this.logger.debug(CLASS_NAME, 'getScorecardDetail', `Fetching scorecard detail: filters=${JSON.stringify(filters)}`);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.team) {
      conditions.push(`vsd.team = $${paramIndex}`);
      params.push(filters.team);
      paramIndex++;
    }

    const repos = normalizeRepositoryFilter(filters.repository);
    if (repos) {
      // Filter by repository - need to ensure contributors have commits in selected repos
      const placeholders = repos.map((_, i) => `$${paramIndex + i}`);
      params.push(...repos);
      paramIndex += repos.length;
      conditions.push(`EXISTS (
        SELECT 1 FROM commit_history ch
        INNER JOIN commit_contributors cc2 ON ch.author = cc2.login
        WHERE cc2.full_name = vsd.full_name
        AND ch.repository IN (${placeholders.join(', ')})
      )`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        vsd.full_name,
        vsd.team,
        vsd.vendor,
        vsd.release_assist_score,
        vsd.test_score,
        vsd.complexity_score,
        vsd.comments_score,
        vsd.code_score
      FROM vw_scorecard_detail vsd
      ${whereClause}
      ORDER BY (vsd.release_assist_score * 0.1 + vsd.test_score * 0.35 +
                vsd.complexity_score * 0.45 + vsd.comments_score * 0.1) DESC
    `;

    this.logger.trace(CLASS_NAME, 'getScorecardDetail', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getScorecardDetail', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      full_name: string;
      team: string;
      vendor: string;
      release_assist_score: string;
      test_score: string;
      complexity_score: string;
      comments_score: string;
      code_score: string;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getScorecardDetail', `Returned ${result.rowCount} detail rows`);

    return result.rows.map((row) => ({
      fullName: row.full_name,
      team: row.team,
      vendor: row.vendor,
      releaseAssistScore: parseFloat(row.release_assist_score),
      testScore: parseFloat(row.test_score),
      complexityScore: parseFloat(row.complexity_score),
      commentsScore: parseFloat(row.comments_score),
      codeScore: parseFloat(row.code_score),
    }));
  }

  // ==========================================================================
  // File Complexity Trends
  // ==========================================================================

  /**
   * Fetch file complexity trends: top N files by absolute complexity change.
   * Queries vw_commit_file_chage_history view.
   *
   * @param topN - Number of top files to return (default: 20)
   * @param filters - Optional date range, team, and repository filters
   * @returns Array of FileComplexityPoint sorted by commit date ascending
   */
  async getFileComplexityTrends(
    topN: number = DEFAULT_TOP_N_FILES,
    filters: DashboardFilters = {},
  ): Promise<FileComplexityPoint[]> {
    // IQS-890: Validate filter inputs (CWE-20 fix)
    this.validateFilters(filters, 'getFileComplexityTrends');

    this.logger.debug(CLASS_NAME, 'getFileComplexityTrends', `Fetching complexity trends: topN=${topN}, filters=${JSON.stringify(filters)}`);

    // Step 1: Find top N files by total absolute complexity change
    const topFilesConditions: string[] = [];
    const topFilesParams: unknown[] = [];
    let paramIndex = 1;

    if (filters.startDate) {
      topFilesConditions.push(`vcfch.commit_date >= $${paramIndex}`);
      topFilesParams.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      topFilesConditions.push(`vcfch.commit_date <= $${paramIndex}`);
      topFilesParams.push(filters.endDate);
      paramIndex++;
    }
    if (filters.team) {
      topFilesConditions.push(`vcfch.team = $${paramIndex}`);
      topFilesParams.push(filters.team);
      paramIndex++;
    }
    if (filters.repository) {
      const repos = normalizeRepositoryFilter(filters.repository);
      if (repos) {
        const { condition, nextParamIndex } = this.buildRepositoryInClause(repos, topFilesParams, paramIndex, 'vcfch');
        topFilesConditions.push(condition);
        paramIndex = nextParamIndex;
      }
    }

    const topFilesWhere = topFilesConditions.length > 0 ? `WHERE ${topFilesConditions.join(' AND ')}` : '';

    // Add topN as a parameter
    topFilesParams.push(topN);
    const limitParam = `$${paramIndex}`;

    const topFilesSql = `
      SELECT vcfch.filename
      FROM vw_commit_file_chage_history vcfch
      ${topFilesWhere}
      GROUP BY vcfch.filename
      ORDER BY SUM(ABS(vcfch.complexity_change)) DESC
      LIMIT ${limitParam}
    `;

    this.logger.trace(CLASS_NAME, 'getFileComplexityTrends', `Top files SQL: ${topFilesSql.trim()}`);

    const topFilesResult = await this.db.query<{ filename: string }>(topFilesSql, topFilesParams);

    if (topFilesResult.rowCount === 0) {
      this.logger.debug(CLASS_NAME, 'getFileComplexityTrends', 'No files found matching criteria');
      return [];
    }

    const topFilenames = topFilesResult.rows.map((r) => r.filename);
    this.logger.debug(CLASS_NAME, 'getFileComplexityTrends', `Found ${topFilenames.length} top files`);

    // Step 2: Fetch the full time series for those files
    const detailConditions: string[] = [];
    const detailParams: unknown[] = [];
    let detailParamIndex = 1;

    // Build parameterized IN clause for filenames
    const filenamePlaceholders = topFilenames.map((_fn, i) => `$${detailParamIndex + i}`).join(', ');
    detailConditions.push(`vcfch.filename IN (${filenamePlaceholders})`);
    detailParams.push(...topFilenames);
    detailParamIndex += topFilenames.length;

    if (filters.startDate) {
      detailConditions.push(`vcfch.commit_date >= $${detailParamIndex}`);
      detailParams.push(filters.startDate);
      detailParamIndex++;
    }
    if (filters.endDate) {
      detailConditions.push(`vcfch.commit_date <= $${detailParamIndex}`);
      detailParams.push(filters.endDate);
      detailParamIndex++;
    }
    if (filters.team) {
      detailConditions.push(`vcfch.team = $${detailParamIndex}`);
      detailParams.push(filters.team);
      detailParamIndex++;
    }
    if (filters.repository) {
      const repos = normalizeRepositoryFilter(filters.repository);
      if (repos) {
        const { condition, nextParamIndex } = this.buildRepositoryInClause(repos, detailParams, detailParamIndex, 'vcfch');
        detailConditions.push(condition);
        detailParamIndex = nextParamIndex;
      }
    }

    const detailWhere = `WHERE ${detailConditions.join(' AND ')}`;

    const detailSql = `
      SELECT
        vcfch.filename,
        vcfch.commit_date::DATE AS commit_date,
        vcfch.complexity,
        vcfch.complexity_change,
        vcfch.category
      FROM vw_commit_file_chage_history vcfch
      ${detailWhere}
      ORDER BY vcfch.commit_date ASC, vcfch.filename ASC
    `;

    this.logger.trace(CLASS_NAME, 'getFileComplexityTrends', `Detail SQL: ${detailSql.trim()}`);

    const detailResult = await this.db.query<{
      filename: string;
      commit_date: Date;
      complexity: number;
      complexity_change: number;
      category: string;
    }>(detailSql, detailParams);

    this.logger.debug(CLASS_NAME, 'getFileComplexityTrends', `Returned ${detailResult.rowCount} complexity data points`);

    return detailResult.rows.map((row) => ({
      filename: row.filename,
      commitDate: row.commit_date instanceof Date ? row.commit_date.toISOString().split('T')[0] ?? '' : String(row.commit_date),
      complexity: row.complexity,
      complexityChange: row.complexity_change,
      category: row.category,
    }));
  }

  /**
   * Fetch detailed scorecard breakdown with profile badges.
   * Computes team percentiles for each team and classifies each contributor.
   *
   * Ticket: IQS-942
   *
   * @param filters - Optional team and repository filters
   * @returns Array of ScorecardDetailRow with profile and commitCount populated
   */
  async getScorecardDetailWithProfiles(filters: DashboardFilters = {}): Promise<ScorecardDetailRow[]> {
    // IQS-890: Validate filter inputs (CWE-20 fix)
    this.validateFilters(filters, 'getScorecardDetailWithProfiles');

    this.logger.debug(CLASS_NAME, 'getScorecardDetailWithProfiles', `Fetching scorecard with profiles: filters=${JSON.stringify(filters)}`);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.team) {
      conditions.push(`vsd.team = $${paramIndex}`);
      params.push(filters.team);
      paramIndex++;
    }

    const repos = normalizeRepositoryFilter(filters.repository);
    if (repos) {
      // Filter by repository - need to ensure contributors have commits in selected repos
      const placeholders = repos.map((_, i) => `$${paramIndex + i}`);
      params.push(...repos);
      paramIndex += repos.length;
      conditions.push(`EXISTS (
        SELECT 1 FROM commit_history ch
        INNER JOIN commit_contributors cc2 ON ch.author = cc2.login
        WHERE cc2.full_name = vsd.full_name
        AND ch.repository IN (${placeholders.join(', ')})
      )`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Step 1: Fetch contributor scorecard detail with commit counts
    const contributorSql = `
      SELECT
        vsd.full_name,
        vsd.team,
        vsd.vendor,
        vsd.release_assist_score,
        vsd.test_score,
        vsd.complexity_score,
        vsd.comments_score,
        vsd.code_score,
        (
          SELECT COUNT(DISTINCT ch.sha)::INTEGER
          FROM commit_history ch
          INNER JOIN commit_contributors cc ON ch.author = cc.login
          WHERE cc.full_name = vsd.full_name
        ) AS commit_count
      FROM vw_scorecard_detail vsd
      ${whereClause}
      ORDER BY (vsd.release_assist_score * 0.1 + vsd.test_score * 0.35 +
                vsd.complexity_score * 0.45 + vsd.comments_score * 0.1) DESC
    `;

    this.logger.trace(CLASS_NAME, 'getScorecardDetailWithProfiles', `Contributor SQL: ${contributorSql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getScorecardDetailWithProfiles', `Params: ${JSON.stringify(params)}`);

    const contributorResult = await this.db.query<{
      full_name: string;
      team: string;
      vendor: string;
      release_assist_score: string;
      test_score: string;
      complexity_score: string;
      comments_score: string;
      code_score: string;
      commit_count: number;
    }>(contributorSql, params);

    this.logger.debug(CLASS_NAME, 'getScorecardDetailWithProfiles', `Fetched ${contributorResult.rowCount} contributors`);

    if (contributorResult.rowCount === 0) {
      this.logger.debug(CLASS_NAME, 'getScorecardDetailWithProfiles', 'No contributors found');
      return [];
    }

    // Step 2: Fetch team percentiles for classification
    const percentilesSql = `
      WITH team_scores AS (
        SELECT
          vsd.team,
          vsd.full_name,
          vsd.release_assist_score,
          vsd.test_score,
          vsd.complexity_score,
          vsd.comments_score
        FROM vw_scorecard_detail vsd
        ${whereClause}
      )
      SELECT
        team,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY release_assist_score)::NUMERIC(12,2) AS release_assist_median,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY test_score)::NUMERIC(12,2) AS test_median,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY complexity_score)::NUMERIC(12,2) AS complexity_median,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY comments_score)::NUMERIC(12,2) AS comments_median,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY release_assist_score)::NUMERIC(12,2) AS release_assist_p75,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY complexity_score)::NUMERIC(12,2) AS complexity_p75,
        COUNT(DISTINCT full_name)::INTEGER AS contributor_count
      FROM team_scores
      GROUP BY team
    `;

    this.logger.trace(CLASS_NAME, 'getScorecardDetailWithProfiles', `Percentiles SQL: ${percentilesSql.trim()}`);

    const percentilesResult = await this.db.query<{
      team: string;
      release_assist_median: string;
      test_median: string;
      complexity_median: string;
      comments_median: string;
      release_assist_p75: string;
      complexity_p75: string;
      contributor_count: number;
    }>(percentilesSql, params);

    this.logger.debug(CLASS_NAME, 'getScorecardDetailWithProfiles', `Fetched percentiles for ${percentilesResult.rowCount} teams`);

    // Build team percentiles map
    const teamPercentilesMap = new Map<string, TeamPercentiles>();
    for (const row of percentilesResult.rows) {
      teamPercentilesMap.set(row.team, {
        team: row.team,
        releaseAssistMedian: parseFloat(row.release_assist_median),
        testMedian: parseFloat(row.test_median),
        complexityMedian: parseFloat(row.complexity_median),
        commentsMedian: parseFloat(row.comments_median),
        releaseAssistP75: parseFloat(row.release_assist_p75),
        complexityP75: parseFloat(row.complexity_p75),
        contributorCount: row.contributor_count,
      });
    }

    // Step 3: Classify each contributor and build result rows
    const results: ScorecardDetailRow[] = [];

    for (const row of contributorResult.rows) {
      const teamStats = teamPercentilesMap.get(row.team);

      if (!teamStats) {
        this.logger.warn(
          CLASS_NAME,
          'getScorecardDetailWithProfiles',
          `No team percentiles found for team=${row.team}, contributor=${row.full_name}`
        );
        // Return row without profile
        results.push({
          fullName: row.full_name,
          team: row.team,
          vendor: row.vendor,
          releaseAssistScore: parseFloat(row.release_assist_score),
          testScore: parseFloat(row.test_score),
          complexityScore: parseFloat(row.complexity_score),
          commentsScore: parseFloat(row.comments_score),
          codeScore: parseFloat(row.code_score),
          commitCount: row.commit_count,
        });
        continue;
      }

      const contributorMetrics: ContributorMetrics = {
        fullName: row.full_name,
        team: row.team,
        releaseAssistScore: parseFloat(row.release_assist_score),
        testScore: parseFloat(row.test_score),
        complexityScore: parseFloat(row.complexity_score),
        commentsScore: parseFloat(row.comments_score),
        commitCount: row.commit_count,
      };

      const profile = classifyProfile(contributorMetrics, teamStats);

      this.logger.trace(
        CLASS_NAME,
        'getScorecardDetailWithProfiles',
        `Classified ${row.full_name} as ${profile}`
      );

      results.push({
        fullName: row.full_name,
        team: row.team,
        vendor: row.vendor,
        releaseAssistScore: parseFloat(row.release_assist_score),
        testScore: parseFloat(row.test_score),
        complexityScore: parseFloat(row.complexity_score),
        commentsScore: parseFloat(row.comments_score),
        codeScore: parseFloat(row.code_score),
        profile,
        commitCount: row.commit_count,
      });
    }

    this.logger.debug(CLASS_NAME, 'getScorecardDetailWithProfiles', `Returning ${results.length} rows with profiles`);
    return results;
  }

  // ==========================================================================
  // Filter Options
  // ==========================================================================

  /**
   * Fetch available filter options (teams and repositories) from the database.
   * Used to populate filter dropdowns in the webview.
   *
   * @returns FilterOptions with available teams and repositories
   */
  async getFilterOptions(): Promise<FilterOptions> {
    this.logger.debug(CLASS_NAME, 'getFilterOptions', 'Fetching filter options');

    // Fetch distinct teams
    const teamsSql = `
      SELECT DISTINCT team
      FROM commit_contributors
      WHERE team IS NOT NULL AND team <> ''
      ORDER BY team ASC
    `;

    const teamsResult = await this.db.query<{ team: string }>(teamsSql);
    const teams = teamsResult.rows.map((r) => r.team);
    this.logger.debug(CLASS_NAME, 'getFilterOptions', `Found ${teams.length} teams`);

    // Fetch distinct repositories
    const reposSql = `
      SELECT DISTINCT repository
      FROM commit_history
      WHERE repository IS NOT NULL AND repository <> ''
      ORDER BY repository ASC
    `;

    const reposResult = await this.db.query<{ repository: string }>(reposSql);
    const repositories = reposResult.rows.map((r) => r.repository);
    this.logger.debug(CLASS_NAME, 'getFilterOptions', `Found ${repositories.length} repositories`);

    return { teams, repositories };
  }
}
