/**
 * Data service for the Test Debt Predictor Dashboard.
 * Provides methods to fetch test coverage trends and identify risky commits
 * with low test coverage that correlate with subsequent bugs.
 *
 * The Test Debt Predictor helps teams identify:
 *   - Commits with low test coverage (high risk)
 *   - Bug rates by test coverage tier
 *   - Weekly trends in test debt
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-913
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  QUERY_TEST_DEBT_VIEW_EXISTS,
  QUERY_COMMIT_TEST_RATIO_VIEW_EXISTS,
  QUERY_TEST_DEBT_TREND_ALL,
  QUERY_TEST_DEBT_TREND_DATE_RANGE,
  QUERY_TEST_DEBT_TREND_BY_REPOSITORY,
  QUERY_TEST_DEBT_TREND_COMBINED,
  QUERY_LOW_TEST_COMMITS_ALL,
  QUERY_LOW_TEST_COMMITS_DATE_RANGE,
  QUERY_LOW_TEST_COMMITS_BY_REPOSITORY,
  QUERY_LOW_TEST_COMMITS_BY_AUTHOR,
  QUERY_LOW_TEST_COMMITS_COMBINED,
  type TestDebtWeekDbRow,
  type CommitTestDetailDbRow,
} from '../database/queries/test-debt-queries.js';
import type {
  TestDebtFilters,
  TestDebtWeek,
  CommitTestDetail,
  TestDebtTrendData,
  LowTestCommitsData,
} from './test-debt-types.js';
import {
  TEST_DEBT_MAX_FILTER_LENGTH,
  TEST_DEBT_MAX_WEEKLY_ROWS,
  TEST_DEBT_MAX_COMMIT_ROWS,
  getTestCoverageTier,
} from './test-debt-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'TestDebtService';

/**
 * Service responsible for querying the vw_test_debt and related views
 * to return typed data for the Test Debt Predictor dashboard.
 *
 * Ticket: IQS-913
 */
export class TestDebtService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'TestDebtService created');
  }

  /**
   * Check if the vw_test_debt view exists.
   * Used for graceful degradation when migration 019 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkTestDebtViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkTestDebtViewExists', 'Checking vw_test_debt existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_TEST_DEBT_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkTestDebtViewExists', `vw_test_debt exists: ${exists}`);
    return exists;
  }

  /**
   * Check if the vw_commit_test_ratio view exists.
   * Used for graceful degradation when migration 019 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkCommitTestRatioViewExists(): Promise<boolean> {
    this.logger.debug(
      CLASS_NAME,
      'checkCommitTestRatioViewExists',
      'Checking vw_commit_test_ratio existence'
    );

    const result = await this.db.query<{ view_exists: boolean }>(
      QUERY_COMMIT_TEST_RATIO_VIEW_EXISTS
    );
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(
      CLASS_NAME,
      'checkCommitTestRatioViewExists',
      `vw_commit_test_ratio exists: ${exists}`
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
    if (value && value.length > TEST_DEBT_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${TEST_DEBT_MAX_FILTER_LENGTH}`
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${TEST_DEBT_MAX_FILTER_LENGTH} characters`
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
  private validateDateFilters(filters: TestDebtFilters): void {
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
   * Map database row to TestDebtWeek.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToTestDebtWeek(row: TestDebtWeekDbRow): TestDebtWeek {
    const week =
      row.week instanceof Date ? row.week.toISOString().split('T')[0] ?? '' : String(row.week);

    return {
      week,
      repository: row.repository,
      lowTestCommits: Number(row.low_test_commits),
      mediumTestCommits: Number(row.medium_test_commits),
      highTestCommits: Number(row.high_test_commits),
      totalCommits: Number(row.total_commits),
      bugsFromLowTest: Number(row.bugs_from_low_test),
      bugsFromMediumTest: Number(row.bugs_from_medium_test),
      bugsFromHighTest: Number(row.bugs_from_high_test),
      totalBugs: Number(row.total_bugs),
      lowTestBugRate: row.low_test_bug_rate !== null ? Number(row.low_test_bug_rate) : 0,
      mediumTestBugRate: row.medium_test_bug_rate !== null ? Number(row.medium_test_bug_rate) : 0,
      highTestBugRate: row.high_test_bug_rate !== null ? Number(row.high_test_bug_rate) : 0,
      avgTestRatio: row.avg_test_ratio !== null ? Number(row.avg_test_ratio) : null,
    };
  }

  /**
   * Map database row to CommitTestDetail.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToCommitTestDetail(row: CommitTestDetailDbRow): CommitTestDetail {
    const commitDate =
      row.commit_date instanceof Date
        ? row.commit_date.toISOString().split('T')[0] ?? ''
        : String(row.commit_date);

    const testRatio = row.test_ratio !== null ? Number(row.test_ratio) : null;

    return {
      sha: row.sha,
      commitDate,
      author: row.author,
      repository: row.repository,
      branch: row.branch,
      commitMessage: row.commit_message,
      prodLocChanged: Number(row.prod_loc_changed),
      testLocChanged: Number(row.test_loc_changed),
      prodFilesChanged: Number(row.prod_files_changed),
      testFilesChanged: Number(row.test_files_changed),
      testRatio,
      testCoverageTier: getTestCoverageTier(testRatio),
      subsequentBugs: Number(row.subsequent_bugs),
      jiraTicketId: row.jira_ticket_id,
      linearTicketId: row.linear_ticket_id,
    };
  }

  /**
   * Fetch weekly test debt trend data with optional filters.
   *
   * @param filters - Optional repository and date range filters
   * @returns Array of TestDebtWeek sorted by week descending
   */
  async getTestDebtTrend(filters: TestDebtFilters = {}): Promise<readonly TestDebtWeek[]> {
    this.logger.debug(
      CLASS_NAME,
      'getTestDebtTrend',
      `Fetching test debt trend: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateDateFilters(filters);

    // Determine which query to use based on filter combination
    const hasDateRange = Boolean(filters.startDate && filters.endDate);
    const hasRepository = Boolean(filters.repository);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [hasDateRange, hasRepository].filter(Boolean).length;

    if (filterCount === 0) {
      // No filters - use simple query
      sql = QUERY_TEST_DEBT_TREND_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getTestDebtTrend', 'Using unfiltered query');
    } else if (filterCount === 1 && hasDateRange) {
      // Single date range filter
      sql = QUERY_TEST_DEBT_TREND_DATE_RANGE;
      params = [filters.startDate, filters.endDate];
      this.logger.debug(CLASS_NAME, 'getTestDebtTrend', 'Using date range filter query');
    } else if (filterCount === 1 && hasRepository) {
      // Single repository filter
      sql = QUERY_TEST_DEBT_TREND_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getTestDebtTrend', 'Using repository filter query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_TEST_DEBT_TREND_COMBINED;
      params = [filters.startDate ?? null, filters.endDate ?? null, filters.repository ?? null];
      this.logger.debug(CLASS_NAME, 'getTestDebtTrend', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getTestDebtTrend', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<TestDebtWeekDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getTestDebtTrend',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, TEST_DEBT_MAX_WEEKLY_ROWS);
    if (result.rows.length > TEST_DEBT_MAX_WEEKLY_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getTestDebtTrend',
        `Result set truncated from ${result.rows.length} to ${TEST_DEBT_MAX_WEEKLY_ROWS} rows`
      );
    }

    const rows: TestDebtWeek[] = limitedRows.map((row) => this.mapRowToTestDebtWeek(row));

    this.logger.debug(
      CLASS_NAME,
      'getTestDebtTrend',
      `Returning ${rows.length} weekly test debt records`
    );
    return rows;
  }

  /**
   * Fetch commits with low test coverage and bug correlation.
   *
   * @param filters - Optional repository, author, and date range filters
   * @returns Array of CommitTestDetail sorted by subsequent bugs descending
   */
  async getLowTestCommits(filters: TestDebtFilters = {}): Promise<readonly CommitTestDetail[]> {
    this.logger.debug(
      CLASS_NAME,
      'getLowTestCommits',
      `Fetching low test commits: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.author, 'author');
    this.validateDateFilters(filters);

    // Determine which query to use based on filter combination
    const hasDateRange = Boolean(filters.startDate && filters.endDate);
    const hasRepository = Boolean(filters.repository);
    const hasAuthor = Boolean(filters.author);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [hasDateRange, hasRepository, hasAuthor].filter(Boolean).length;

    if (filterCount === 0) {
      // No filters - use simple query
      sql = QUERY_LOW_TEST_COMMITS_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getLowTestCommits', 'Using unfiltered query');
    } else if (filterCount === 1 && hasDateRange) {
      // Single date range filter
      sql = QUERY_LOW_TEST_COMMITS_DATE_RANGE;
      params = [filters.startDate, filters.endDate];
      this.logger.debug(CLASS_NAME, 'getLowTestCommits', 'Using date range filter query');
    } else if (filterCount === 1 && hasRepository) {
      // Single repository filter
      sql = QUERY_LOW_TEST_COMMITS_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getLowTestCommits', 'Using repository filter query');
    } else if (filterCount === 1 && hasAuthor) {
      // Single author filter
      sql = QUERY_LOW_TEST_COMMITS_BY_AUTHOR;
      params = [filters.author];
      this.logger.debug(CLASS_NAME, 'getLowTestCommits', 'Using author filter query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_LOW_TEST_COMMITS_COMBINED;
      params = [
        filters.startDate ?? null,
        filters.endDate ?? null,
        filters.repository ?? null,
        filters.author ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getLowTestCommits', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getLowTestCommits', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<CommitTestDetailDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getLowTestCommits',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, TEST_DEBT_MAX_COMMIT_ROWS);
    if (result.rows.length > TEST_DEBT_MAX_COMMIT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getLowTestCommits',
        `Result set truncated from ${result.rows.length} to ${TEST_DEBT_MAX_COMMIT_ROWS} rows`
      );
    }

    const rows: CommitTestDetail[] = limitedRows.map((row) => this.mapRowToCommitTestDetail(row));

    this.logger.debug(
      CLASS_NAME,
      'getLowTestCommits',
      `Returning ${rows.length} low test commit records`
    );
    return rows;
  }

  /**
   * Get complete test debt trend data including view existence check.
   *
   * @param filters - Optional filters for test debt query
   * @returns TestDebtTrendData with weekly data and metadata
   */
  async getTestDebtTrendData(filters: TestDebtFilters = {}): Promise<TestDebtTrendData> {
    this.logger.debug(
      CLASS_NAME,
      'getTestDebtTrendData',
      `Fetching test debt trend data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkTestDebtViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getTestDebtTrendData',
        'vw_test_debt view not found -- returning empty data'
      );
      return {
        weeks: [],
        hasData: false,
        viewExists: false,
      };
    }

    const weeks = await this.getTestDebtTrend(filters);

    this.logger.info(
      CLASS_NAME,
      'getTestDebtTrendData',
      `Trend data ready: ${weeks.length} weekly records`
    );

    return {
      weeks,
      hasData: weeks.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get complete low test commits data including view existence check.
   *
   * @param filters - Optional filters for low test commits query
   * @returns LowTestCommitsData with commit details and metadata
   */
  async getLowTestCommitsData(filters: TestDebtFilters = {}): Promise<LowTestCommitsData> {
    this.logger.debug(
      CLASS_NAME,
      'getLowTestCommitsData',
      `Fetching low test commits data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkCommitTestRatioViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getLowTestCommitsData',
        'vw_commit_test_ratio view not found -- returning empty data'
      );
      return {
        commits: [],
        hasData: false,
        viewExists: false,
      };
    }

    const commits = await this.getLowTestCommits(filters);

    this.logger.info(
      CLASS_NAME,
      'getLowTestCommitsData',
      `Commits data ready: ${commits.length} low test commits`
    );

    return {
      commits,
      hasData: commits.length > 0,
      viewExists: true,
    };
  }
}
