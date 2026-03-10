/**
 * Data service for the Commit Hygiene Tracker Dashboard.
 * Provides methods to fetch commit hygiene scores, author summaries,
 * and weekly trends from the database views, with optional filtering.
 *
 * The Commit Hygiene Tracker helps teams maintain consistent commit standards:
 *   - Conventional commit pattern detection (feat, fix, docs, etc.)
 *   - Subject line length validation (50-72 chars ideal)
 *   - Proper capitalization and formatting
 *   - Quality tier assignment (excellent/good/fair/poor)
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-915
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  QUERY_HYGIENE_VIEW_EXISTS,
  QUERY_HYGIENE_BY_AUTHOR_VIEW_EXISTS,
  QUERY_HYGIENE_WEEKLY_VIEW_EXISTS,
  QUERY_COMMIT_HYGIENE_ALL,
  QUERY_COMMIT_HYGIENE_DATE_RANGE,
  QUERY_COMMIT_HYGIENE_BY_REPOSITORY,
  QUERY_COMMIT_HYGIENE_BY_QUALITY_TIER,
  QUERY_COMMIT_HYGIENE_BY_COMMIT_TYPE,
  QUERY_COMMIT_HYGIENE_COMBINED,
  QUERY_AUTHOR_HYGIENE_ALL,
  QUERY_AUTHOR_HYGIENE_BY_REPOSITORY,
  QUERY_AUTHOR_HYGIENE_BY_TEAM,
  QUERY_WEEKLY_HYGIENE_ALL,
  QUERY_WEEKLY_HYGIENE_BY_REPOSITORY,
  type CommitHygieneDbRow,
  type AuthorHygieneDbRow,
  type WeeklyHygieneDbRow,
} from '../database/queries/hygiene-queries.js';
import type {
  CommitHygiene,
  AuthorHygieneSummary,
  WeeklyHygieneTrend,
  CommitHygieneFilters,
  CommitHygieneData,
  AuthorHygieneSummaryData,
  WeeklyHygieneTrendData,
  QualityTier,
  ConventionalCommitType,
} from './commit-hygiene-types.js';
import {
  COMMIT_HYGIENE_MAX_FILTER_LENGTH,
  COMMIT_HYGIENE_MAX_COMMIT_ROWS,
  COMMIT_HYGIENE_MAX_AUTHOR_ROWS,
  COMMIT_HYGIENE_MAX_WEEKLY_ROWS,
  VALID_QUALITY_TIERS,
  VALID_COMMIT_TYPES,
} from './commit-hygiene-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'CommitHygieneDataService';

/**
 * Service responsible for querying the vw_commit_hygiene, vw_commit_hygiene_by_author,
 * and vw_commit_hygiene_weekly database views and returning typed data for the
 * Commit Hygiene Tracker dashboard.
 *
 * Ticket: IQS-915
 */
export class CommitHygieneDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'CommitHygieneDataService created');
  }

  /**
   * Check if the vw_commit_hygiene view exists.
   * Used for graceful degradation when migration 020 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkHygieneViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkHygieneViewExists', 'Checking vw_commit_hygiene existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_HYGIENE_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkHygieneViewExists', `vw_commit_hygiene exists: ${exists}`);
    return exists;
  }

  /**
   * Check if the vw_commit_hygiene_by_author view exists.
   * Used for graceful degradation when migration 020 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkAuthorHygieneViewExists(): Promise<boolean> {
    this.logger.debug(
      CLASS_NAME,
      'checkAuthorHygieneViewExists',
      'Checking vw_commit_hygiene_by_author existence'
    );

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_HYGIENE_BY_AUTHOR_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(
      CLASS_NAME,
      'checkAuthorHygieneViewExists',
      `vw_commit_hygiene_by_author exists: ${exists}`
    );
    return exists;
  }

  /**
   * Check if the vw_commit_hygiene_weekly view exists.
   * Used for graceful degradation when migration 020 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkWeeklyHygieneViewExists(): Promise<boolean> {
    this.logger.debug(
      CLASS_NAME,
      'checkWeeklyHygieneViewExists',
      'Checking vw_commit_hygiene_weekly existence'
    );

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_HYGIENE_WEEKLY_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(
      CLASS_NAME,
      'checkWeeklyHygieneViewExists',
      `vw_commit_hygiene_weekly exists: ${exists}`
    );
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
    if (value && value.length > COMMIT_HYGIENE_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${COMMIT_HYGIENE_MAX_FILTER_LENGTH}`
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${COMMIT_HYGIENE_MAX_FILTER_LENGTH} characters`
      );
    }
  }

  /**
   * Validate quality tier filter input.
   * Ensures value is one of the valid quality tiers.
   *
   * @param value - Quality tier value to validate
   * @throws Error if value is not a valid quality tier
   */
  private validateQualityTier(value: QualityTier | undefined): void {
    if (value && !VALID_QUALITY_TIERS.includes(value)) {
      this.logger.warn(CLASS_NAME, 'validateQualityTier', `Invalid quality tier: ${value}`);
      throw new Error(
        `Invalid quality tier: ${value}. Must be one of: ${VALID_QUALITY_TIERS.join(', ')}`
      );
    }
  }

  /**
   * Validate commit type filter input.
   * Ensures value is one of the valid conventional commit types.
   *
   * @param value - Commit type value to validate
   * @throws Error if value is not a valid commit type
   */
  private validateCommitType(value: ConventionalCommitType | undefined): void {
    if (value && !VALID_COMMIT_TYPES.includes(value)) {
      this.logger.warn(CLASS_NAME, 'validateCommitType', `Invalid commit type: ${value}`);
      throw new Error(
        `Invalid commit type: ${value}. Must be one of: ${VALID_COMMIT_TYPES.join(', ')}`
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
  private validateDateFilters(filters: CommitHygieneFilters): void {
    if (filters.startDate && !isValidDateString(filters.startDate)) {
      this.logger.warn(
        CLASS_NAME,
        'validateDateFilters',
        `Invalid start date: ${filters.startDate}`
      );
      throw new Error(`Invalid start date format: ${filters.startDate}. Expected YYYY-MM-DD.`);
    }
    if (filters.endDate && !isValidDateString(filters.endDate)) {
      this.logger.warn(CLASS_NAME, 'validateDateFilters', `Invalid end date: ${filters.endDate}`);
      throw new Error(`Invalid end date format: ${filters.endDate}. Expected YYYY-MM-DD.`);
    }
    // Validate date range order
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
      this.logger.warn(
        CLASS_NAME,
        'validateDateFilters',
        `Invalid date range: ${filters.startDate} > ${filters.endDate}`
      );
      throw new Error(
        `Invalid date range: start date (${filters.startDate}) must be before end date (${filters.endDate})`
      );
    }
  }

  /**
   * Map database row to CommitHygiene.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToCommitHygiene(row: CommitHygieneDbRow): CommitHygiene {
    const commitDate =
      row.commit_date instanceof Date
        ? row.commit_date.toISOString().split('T')[0] ?? ''
        : String(row.commit_date);

    return {
      sha: row.sha,
      commitDate,
      author: row.author,
      repository: row.repository,
      branch: row.branch,
      commitMessageSubject: row.commit_message_subject,
      fileCount: Number(row.file_count),
      linesAdded: Number(row.lines_added),
      linesRemoved: Number(row.lines_removed),
      fullName: row.full_name,
      team: row.team,
      hasConventionalPrefix: row.has_conventional_prefix,
      commitType: row.commit_type,
      hasScope: row.has_scope,
      scope: row.scope,
      isBreakingChange: row.is_breaking_change,
      hasBody: row.has_body,
      subjectLength: Number(row.subject_length),
      hasProperCapitalization: row.has_proper_capitalization,
      noTrailingPeriod: row.no_trailing_period,
      messageLineCount: Number(row.message_line_count),
      prefixScore: Number(row.prefix_score),
      lengthScore: Number(row.length_score),
      capitalizationScore: Number(row.capitalization_score),
      periodScore: Number(row.period_score),
      scopeScore: Number(row.scope_score),
      bodyScore: Number(row.body_score),
      breakingChangeScore: Number(row.breaking_change_score),
      hygieneScore: Number(row.hygiene_score),
      qualityTier: row.quality_tier,
      jiraTicketId: row.jira_ticket_id,
      linearTicketId: row.linear_ticket_id,
    };
  }

  /**
   * Map database row to AuthorHygieneSummary.
   * Converts snake_case to camelCase and handles type conversions.
   */
  private mapRowToAuthorSummary(row: AuthorHygieneDbRow): AuthorHygieneSummary {
    return {
      author: row.author,
      fullName: row.full_name,
      team: row.team,
      repository: row.repository,
      totalCommits: Number(row.total_commits),
      conventionalCommits: Number(row.conventional_commits),
      scopedCommits: Number(row.scoped_commits),
      commitsWithBody: Number(row.commits_with_body),
      breakingChanges: Number(row.breaking_changes),
      excellentCount: Number(row.excellent_count),
      goodCount: Number(row.good_count),
      fairCount: Number(row.fair_count),
      poorCount: Number(row.poor_count),
      featCount: Number(row.feat_count),
      fixCount: Number(row.fix_count),
      docsCount: Number(row.docs_count),
      refactorCount: Number(row.refactor_count),
      testCount: Number(row.test_count),
      choreCount: Number(row.chore_count),
      otherCount: Number(row.other_count),
      avgHygieneScore: Number(row.avg_hygiene_score),
      avgSubjectLength: Number(row.avg_subject_length),
      conventionalPct: Number(row.conventional_pct),
      goodOrBetterPct: Number(row.good_or_better_pct),
    };
  }

  /**
   * Map database row to WeeklyHygieneTrend.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToWeeklyTrend(row: WeeklyHygieneDbRow): WeeklyHygieneTrend {
    const week =
      row.week instanceof Date
        ? row.week.toISOString().split('T')[0] ?? ''
        : String(row.week);

    return {
      week,
      repository: row.repository,
      totalCommits: Number(row.total_commits),
      conventionalCommits: Number(row.conventional_commits),
      excellentCount: Number(row.excellent_count),
      goodCount: Number(row.good_count),
      fairCount: Number(row.fair_count),
      poorCount: Number(row.poor_count),
      featCount: Number(row.feat_count),
      fixCount: Number(row.fix_count),
      otherTypeCount: Number(row.other_type_count),
      avgHygieneScore: Number(row.avg_hygiene_score),
      conventionalPct: Number(row.conventional_pct),
      goodOrBetterPct: Number(row.good_or_better_pct),
    };
  }

  /**
   * Fetch commit hygiene data with optional filters.
   *
   * @param filters - Optional repository, branch, date range, quality tier, and commit type filters
   * @returns Array of CommitHygiene sorted by commit date descending
   */
  async getCommitHygiene(filters: CommitHygieneFilters = {}): Promise<readonly CommitHygiene[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCommitHygiene',
      `Fetching commit hygiene: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.branch, 'branch');
    this.validateStringFilter(filters.author, 'author');
    this.validateStringFilter(filters.team, 'team');
    this.validateQualityTier(filters.qualityTier);
    this.validateCommitType(filters.commitType);
    this.validateDateFilters(filters);

    // Determine which query to use based on filter combination
    const hasDateRange = Boolean(filters.startDate && filters.endDate);
    const hasRepository = Boolean(filters.repository);
    const hasQualityTier = Boolean(filters.qualityTier);
    const hasCommitType = Boolean(filters.commitType);
    const hasBranch = Boolean(filters.branch);
    const hasAuthor = Boolean(filters.author);
    const hasTeam = Boolean(filters.team);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [
      hasDateRange,
      hasRepository,
      hasQualityTier,
      hasCommitType,
      hasBranch,
      hasAuthor,
      hasTeam,
    ].filter(Boolean).length;

    if (filterCount === 0) {
      // No filters - use simple query
      sql = QUERY_COMMIT_HYGIENE_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getCommitHygiene', 'Using unfiltered query');
    } else if (filterCount === 1 && hasDateRange) {
      // Single date range filter
      sql = QUERY_COMMIT_HYGIENE_DATE_RANGE;
      params = [filters.startDate, filters.endDate];
      this.logger.debug(CLASS_NAME, 'getCommitHygiene', 'Using date range filter query');
    } else if (filterCount === 1 && hasRepository) {
      // Single repository filter
      sql = QUERY_COMMIT_HYGIENE_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getCommitHygiene', 'Using repository filter query');
    } else if (filterCount === 1 && hasQualityTier) {
      // Single quality tier filter
      sql = QUERY_COMMIT_HYGIENE_BY_QUALITY_TIER;
      params = [filters.qualityTier];
      this.logger.debug(CLASS_NAME, 'getCommitHygiene', 'Using quality tier filter query');
    } else if (filterCount === 1 && hasCommitType) {
      // Single commit type filter
      sql = QUERY_COMMIT_HYGIENE_BY_COMMIT_TYPE;
      params = [filters.commitType];
      this.logger.debug(CLASS_NAME, 'getCommitHygiene', 'Using commit type filter query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_COMMIT_HYGIENE_COMBINED;
      params = [
        filters.startDate ?? null,
        filters.endDate ?? null,
        filters.repository ?? null,
        filters.branch ?? null,
        filters.qualityTier ?? null,
        filters.commitType ?? null,
        filters.author ?? null,
        filters.team ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getCommitHygiene', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getCommitHygiene', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<CommitHygieneDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getCommitHygiene',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, COMMIT_HYGIENE_MAX_COMMIT_ROWS);
    if (result.rows.length > COMMIT_HYGIENE_MAX_COMMIT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getCommitHygiene',
        `Result set truncated from ${result.rows.length} to ${COMMIT_HYGIENE_MAX_COMMIT_ROWS} rows`
      );
    }

    const rows: CommitHygiene[] = limitedRows.map((row) => this.mapRowToCommitHygiene(row));

    this.logger.debug(
      CLASS_NAME,
      'getCommitHygiene',
      `Returning ${rows.length} commit hygiene records`
    );
    return rows;
  }

  /**
   * Fetch author hygiene summaries with optional filters.
   *
   * @param filters - Optional repository and team filters
   * @returns Array of AuthorHygieneSummary sorted by avg_hygiene_score descending
   */
  async getAuthorSummaries(
    filters: Pick<CommitHygieneFilters, 'repository' | 'team'> = {}
  ): Promise<readonly AuthorHygieneSummary[]> {
    this.logger.debug(
      CLASS_NAME,
      'getAuthorSummaries',
      `Fetching author summaries: filters=${JSON.stringify(filters)}`
    );

    // Validate filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.team, 'team');

    let sql: string;
    let params: unknown[];

    if (filters.repository) {
      sql = QUERY_AUTHOR_HYGIENE_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getAuthorSummaries', 'Using repository filter query');
    } else if (filters.team) {
      sql = QUERY_AUTHOR_HYGIENE_BY_TEAM;
      params = [filters.team];
      this.logger.debug(CLASS_NAME, 'getAuthorSummaries', 'Using team filter query');
    } else {
      sql = QUERY_AUTHOR_HYGIENE_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getAuthorSummaries', 'Using unfiltered query');
    }

    const result = await this.db.query<AuthorHygieneDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getAuthorSummaries',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, COMMIT_HYGIENE_MAX_AUTHOR_ROWS);
    if (result.rows.length > COMMIT_HYGIENE_MAX_AUTHOR_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getAuthorSummaries',
        `Result set truncated from ${result.rows.length} to ${COMMIT_HYGIENE_MAX_AUTHOR_ROWS} rows`
      );
    }

    const summaries: AuthorHygieneSummary[] = limitedRows.map((row) =>
      this.mapRowToAuthorSummary(row)
    );

    this.logger.debug(
      CLASS_NAME,
      'getAuthorSummaries',
      `Returning ${summaries.length} author summaries`
    );
    return summaries;
  }

  /**
   * Fetch weekly hygiene trends with optional filters.
   *
   * @param filters - Optional repository filter
   * @returns Array of WeeklyHygieneTrend sorted by week descending
   */
  async getWeeklyTrends(
    filters: Pick<CommitHygieneFilters, 'repository'> = {}
  ): Promise<readonly WeeklyHygieneTrend[]> {
    this.logger.debug(
      CLASS_NAME,
      'getWeeklyTrends',
      `Fetching weekly trends: filters=${JSON.stringify(filters)}`
    );

    // Validate filters
    this.validateStringFilter(filters.repository, 'repository');

    let sql: string;
    let params: unknown[];

    if (filters.repository) {
      sql = QUERY_WEEKLY_HYGIENE_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getWeeklyTrends', 'Using repository filter query');
    } else {
      sql = QUERY_WEEKLY_HYGIENE_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getWeeklyTrends', 'Using unfiltered query');
    }

    const result = await this.db.query<WeeklyHygieneDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getWeeklyTrends',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, COMMIT_HYGIENE_MAX_WEEKLY_ROWS);
    if (result.rows.length > COMMIT_HYGIENE_MAX_WEEKLY_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getWeeklyTrends',
        `Result set truncated from ${result.rows.length} to ${COMMIT_HYGIENE_MAX_WEEKLY_ROWS} rows`
      );
    }

    const trends: WeeklyHygieneTrend[] = limitedRows.map((row) =>
      this.mapRowToWeeklyTrend(row)
    );

    this.logger.debug(
      CLASS_NAME,
      'getWeeklyTrends',
      `Returning ${trends.length} weekly trends`
    );
    return trends;
  }

  /**
   * Get complete commit hygiene chart data including view existence check.
   *
   * @param filters - Optional filters for commit hygiene query
   * @returns CommitHygieneData with commits and metadata
   */
  async getCommitHygieneChartData(
    filters: CommitHygieneFilters = {}
  ): Promise<CommitHygieneData> {
    this.logger.debug(
      CLASS_NAME,
      'getCommitHygieneChartData',
      `Fetching commit hygiene chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkHygieneViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getCommitHygieneChartData',
        'vw_commit_hygiene view not found -- returning empty data'
      );
      return {
        commits: [],
        hasData: false,
        viewExists: false,
      };
    }

    const commits = await this.getCommitHygiene(filters);

    this.logger.info(
      CLASS_NAME,
      'getCommitHygieneChartData',
      `Chart data ready: ${commits.length} commit hygiene records`
    );

    return {
      commits,
      hasData: commits.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get complete author summary data including view existence check.
   *
   * @param filters - Optional repository and team filters
   * @returns AuthorHygieneSummaryData with summaries and metadata
   */
  async getAuthorSummaryData(
    filters: Pick<CommitHygieneFilters, 'repository' | 'team'> = {}
  ): Promise<AuthorHygieneSummaryData> {
    this.logger.debug(
      CLASS_NAME,
      'getAuthorSummaryData',
      `Fetching author summary data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkAuthorHygieneViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getAuthorSummaryData',
        'vw_commit_hygiene_by_author view not found -- returning empty data'
      );
      return {
        summaries: [],
        hasData: false,
        viewExists: false,
      };
    }

    const summaries = await this.getAuthorSummaries(filters);

    this.logger.info(
      CLASS_NAME,
      'getAuthorSummaryData',
      `Author summary data ready: ${summaries.length} author summaries`
    );

    return {
      summaries,
      hasData: summaries.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get complete weekly trend data including view existence check.
   *
   * @param filters - Optional repository filter
   * @returns WeeklyHygieneTrendData with trends and metadata
   */
  async getWeeklyTrendData(
    filters: Pick<CommitHygieneFilters, 'repository'> = {}
  ): Promise<WeeklyHygieneTrendData> {
    this.logger.debug(
      CLASS_NAME,
      'getWeeklyTrendData',
      `Fetching weekly trend data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkWeeklyHygieneViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getWeeklyTrendData',
        'vw_commit_hygiene_weekly view not found -- returning empty data'
      );
      return {
        trends: [],
        hasData: false,
        viewExists: false,
      };
    }

    const trends = await this.getWeeklyTrends(filters);

    this.logger.info(
      CLASS_NAME,
      'getWeeklyTrendData',
      `Weekly trend data ready: ${trends.length} weekly trends`
    );

    return {
      trends,
      hasData: trends.length > 0,
      viewExists: true,
    };
  }
}
