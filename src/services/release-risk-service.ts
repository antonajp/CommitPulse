/**
 * Data service for the Release Risk Gauge Dashboard.
 * Provides methods to fetch per-commit risk metrics and release-level
 * risk summaries from the database views, with optional filtering
 * by repository, branch, date range, and risk category.
 *
 * The Release Risk Gauge helps QA teams prioritize testing by showing
 * which commits and releases carry the highest risk of introducing bugs:
 *   - Complexity risk (cyclomatic complexity change)
 *   - Test coverage risk (inverse of test file ratio)
 *   - Experience risk (inverse of author experience)
 *   - Hotspot risk (critical/high hotspot files touched)
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-911
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  QUERY_COMMIT_RISK_VIEW_EXISTS,
  QUERY_RELEASE_RISK_VIEW_EXISTS,
  QUERY_COMMIT_RISKS_ALL,
  QUERY_COMMIT_RISKS_DATE_RANGE,
  QUERY_COMMIT_RISKS_BY_REPOSITORY,
  QUERY_COMMIT_RISKS_BY_BRANCH,
  QUERY_COMMIT_RISKS_BY_CATEGORY,
  QUERY_COMMIT_RISKS_COMBINED,
  QUERY_RELEASE_RISKS_ALL,
  QUERY_RELEASE_RISKS_BY_REPOSITORY,
  QUERY_RELEASE_RISKS_BY_BRANCH,
  QUERY_RELEASE_RISKS_COMBINED,
  type CommitRiskDbRow,
  type ReleaseRiskDbRow,
} from '../database/queries/release-risk-queries.js';
import type {
  CommitRisk,
  ReleaseRiskSummary,
  ReleaseRiskFilters,
  ReleaseRiskCommitsData,
  ReleaseRiskSummaryData,
  RiskCategory,
} from './release-risk-types.js';
import {
  RELEASE_RISK_MAX_FILTER_LENGTH,
  RELEASE_RISK_MAX_COMMIT_ROWS,
  RELEASE_RISK_MAX_SUMMARY_ROWS,
  VALID_RISK_CATEGORIES,
} from './release-risk-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ReleaseRiskService';

/**
 * Service responsible for querying the vw_commit_risk and vw_release_risk
 * database views and returning typed data for the Release Risk Gauge dashboard.
 *
 * Ticket: IQS-911
 */
export class ReleaseRiskService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'ReleaseRiskService created');
  }

  /**
   * Check if the vw_commit_risk view exists.
   * Used for graceful degradation when migration 018 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkCommitRiskViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkCommitRiskViewExists', 'Checking vw_commit_risk existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_COMMIT_RISK_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkCommitRiskViewExists', `vw_commit_risk exists: ${exists}`);
    return exists;
  }

  /**
   * Check if the vw_release_risk view exists.
   * Used for graceful degradation when migration 018 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkReleaseRiskViewExists(): Promise<boolean> {
    this.logger.debug(
      CLASS_NAME,
      'checkReleaseRiskViewExists',
      'Checking vw_release_risk existence'
    );

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_RELEASE_RISK_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(
      CLASS_NAME,
      'checkReleaseRiskViewExists',
      `vw_release_risk exists: ${exists}`
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
    if (value && value.length > RELEASE_RISK_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${RELEASE_RISK_MAX_FILTER_LENGTH}`
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${RELEASE_RISK_MAX_FILTER_LENGTH} characters`
      );
    }
  }

  /**
   * Validate risk category filter input.
   * Ensures value is one of the valid risk categories.
   *
   * @param value - Risk category value to validate
   * @throws Error if value is not a valid risk category
   */
  private validateRiskCategory(value: RiskCategory | undefined): void {
    if (value && !VALID_RISK_CATEGORIES.includes(value)) {
      this.logger.warn(CLASS_NAME, 'validateRiskCategory', `Invalid risk category: ${value}`);
      throw new Error(
        `Invalid risk category: ${value}. Must be one of: ${VALID_RISK_CATEGORIES.join(', ')}`
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
  private validateDateFilters(filters: ReleaseRiskFilters): void {
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
   * Map database row to CommitRisk.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToCommitRisk(row: CommitRiskDbRow): CommitRisk {
    const commitDate =
      row.commit_date instanceof Date
        ? row.commit_date.toISOString().split('T')[0] ?? ''
        : String(row.commit_date);

    // Extract first line of commit message as summary
    const commitMessageSummary = row.commit_message
      ? row.commit_message.split('\n')[0] ?? null
      : null;

    return {
      sha: row.sha,
      commitDate,
      author: row.author,
      branch: row.branch,
      repository: row.repository,
      commitMessageSummary,
      fullName: row.full_name,
      team: row.team,
      ticketId: row.ticket_id,
      complexityDelta: Number(row.complexity_delta),
      locDelta: Number(row.loc_delta),
      fileCount: Number(row.file_count),
      testFileCount: Number(row.test_file_count),
      complexityRisk: Number(row.complexity_risk),
      testCoverageRisk: Number(row.test_coverage_risk),
      experienceRisk: Number(row.experience_risk),
      hotspotRisk: Number(row.hotspot_risk),
      totalRisk: Number(row.total_risk),
      riskCategory: row.risk_category,
    };
  }

  /**
   * Map database row to ReleaseRiskSummary.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToReleaseRiskSummary(row: ReleaseRiskDbRow): ReleaseRiskSummary {
    const firstCommitDate =
      row.first_commit_date instanceof Date
        ? row.first_commit_date.toISOString().split('T')[0] ?? ''
        : String(row.first_commit_date);

    const lastCommitDate =
      row.last_commit_date instanceof Date
        ? row.last_commit_date.toISOString().split('T')[0] ?? ''
        : String(row.last_commit_date);

    return {
      repository: row.repository,
      branch: row.branch,
      commitCount: Number(row.commit_count),
      firstCommitDate,
      lastCommitDate,
      releaseRiskScore: Number(row.release_risk_score),
      riskCategory: row.risk_category,
      riskBreakdown: {
        avgComplexityRisk: Number(row.avg_complexity_risk),
        avgTestCoverageRisk: Number(row.avg_test_coverage_risk),
        avgExperienceRisk: Number(row.avg_experience_risk),
        avgHotspotRisk: Number(row.avg_hotspot_risk),
      },
      riskDistribution: {
        criticalCount: Number(row.critical_commit_count),
        highCount: Number(row.high_commit_count),
        mediumCount: Number(row.medium_commit_count),
        lowCount: Number(row.low_commit_count),
      },
      maxRisk: Number(row.max_risk),
    };
  }

  /**
   * Fetch commit risks with optional filters.
   *
   * @param filters - Optional repository, branch, date range, and risk category filters
   * @returns Array of CommitRisk sorted by commit date descending
   */
  async getCommitRisks(filters: ReleaseRiskFilters = {}): Promise<readonly CommitRisk[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCommitRisks',
      `Fetching commit risks: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.branch, 'branch');
    this.validateStringFilter(filters.team, 'team');
    this.validateRiskCategory(filters.riskCategory);
    this.validateDateFilters(filters);

    // Determine which query to use based on filter combination
    const hasDateRange = Boolean(filters.startDate && filters.endDate);
    const hasRepository = Boolean(filters.repository);
    const hasBranch = Boolean(filters.branch);
    const hasRiskCategory = Boolean(filters.riskCategory);
    const hasTeam = Boolean(filters.team);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [hasDateRange, hasRepository, hasBranch, hasRiskCategory, hasTeam].filter(
      Boolean
    ).length;

    if (filterCount === 0) {
      // No filters - use simple query
      sql = QUERY_COMMIT_RISKS_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getCommitRisks', 'Using unfiltered query');
    } else if (filterCount === 1 && hasDateRange) {
      // Single date range filter
      sql = QUERY_COMMIT_RISKS_DATE_RANGE;
      params = [filters.startDate, filters.endDate];
      this.logger.debug(CLASS_NAME, 'getCommitRisks', 'Using date range filter query');
    } else if (filterCount === 1 && hasRepository) {
      // Single repository filter
      sql = QUERY_COMMIT_RISKS_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getCommitRisks', 'Using repository filter query');
    } else if (filterCount === 1 && hasBranch) {
      // Single branch filter
      sql = QUERY_COMMIT_RISKS_BY_BRANCH;
      params = [filters.branch];
      this.logger.debug(CLASS_NAME, 'getCommitRisks', 'Using branch filter query');
    } else if (filterCount === 1 && hasRiskCategory) {
      // Single risk category filter
      sql = QUERY_COMMIT_RISKS_BY_CATEGORY;
      params = [filters.riskCategory];
      this.logger.debug(CLASS_NAME, 'getCommitRisks', 'Using risk category filter query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_COMMIT_RISKS_COMBINED;
      params = [
        filters.startDate ?? null,
        filters.endDate ?? null,
        filters.repository ?? null,
        filters.branch ?? null,
        filters.riskCategory ?? null,
        filters.team ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getCommitRisks', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getCommitRisks', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<CommitRiskDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getCommitRisks',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, RELEASE_RISK_MAX_COMMIT_ROWS);
    if (result.rows.length > RELEASE_RISK_MAX_COMMIT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getCommitRisks',
        `Result set truncated from ${result.rows.length} to ${RELEASE_RISK_MAX_COMMIT_ROWS} rows`
      );
    }

    const rows: CommitRisk[] = limitedRows.map((row) => this.mapRowToCommitRisk(row));

    this.logger.debug(
      CLASS_NAME,
      'getCommitRisks',
      `Returning ${rows.length} commit risk records`
    );
    return rows;
  }

  /**
   * Fetch release risk summaries with optional filters.
   *
   * @param filters - Optional repository, branch, and risk category filters
   * @returns Array of ReleaseRiskSummary sorted by release risk score descending
   */
  async getReleaseRisks(
    filters: ReleaseRiskFilters = {}
  ): Promise<readonly ReleaseRiskSummary[]> {
    this.logger.debug(
      CLASS_NAME,
      'getReleaseRisks',
      `Fetching release risks: filters=${JSON.stringify(filters)}`
    );

    // Validate string filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.branch, 'branch');
    this.validateRiskCategory(filters.riskCategory);

    // Determine which query to use based on filter combination
    const hasRepository = Boolean(filters.repository);
    const hasBranch = Boolean(filters.branch);
    const hasRiskCategory = Boolean(filters.riskCategory);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [hasRepository, hasBranch, hasRiskCategory].filter(Boolean).length;

    if (filterCount === 0) {
      // No filters - use simple query
      sql = QUERY_RELEASE_RISKS_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getReleaseRisks', 'Using unfiltered query');
    } else if (filterCount === 1 && hasRepository) {
      // Single repository filter
      sql = QUERY_RELEASE_RISKS_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getReleaseRisks', 'Using repository filter query');
    } else if (filterCount === 1 && hasBranch) {
      // Single branch filter
      sql = QUERY_RELEASE_RISKS_BY_BRANCH;
      params = [filters.branch];
      this.logger.debug(CLASS_NAME, 'getReleaseRisks', 'Using branch filter query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_RELEASE_RISKS_COMBINED;
      params = [
        filters.repository ?? null,
        filters.branch ?? null,
        filters.riskCategory ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getReleaseRisks', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getReleaseRisks', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<ReleaseRiskDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getReleaseRisks',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, RELEASE_RISK_MAX_SUMMARY_ROWS);
    if (result.rows.length > RELEASE_RISK_MAX_SUMMARY_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getReleaseRisks',
        `Result set truncated from ${result.rows.length} to ${RELEASE_RISK_MAX_SUMMARY_ROWS} rows`
      );
    }

    const rows: ReleaseRiskSummary[] = limitedRows.map((row) =>
      this.mapRowToReleaseRiskSummary(row)
    );

    this.logger.debug(
      CLASS_NAME,
      'getReleaseRisks',
      `Returning ${rows.length} release risk summaries`
    );
    return rows;
  }

  /**
   * Get complete commit risk chart data including view existence check.
   *
   * @param filters - Optional filters for commit risks query
   * @returns ReleaseRiskCommitsData with commit risks and metadata
   */
  async getCommitRiskChartData(
    filters: ReleaseRiskFilters = {}
  ): Promise<ReleaseRiskCommitsData> {
    this.logger.debug(
      CLASS_NAME,
      'getCommitRiskChartData',
      `Fetching commit risk chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkCommitRiskViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getCommitRiskChartData',
        'vw_commit_risk view not found -- returning empty data'
      );
      return {
        commits: [],
        hasData: false,
        viewExists: false,
      };
    }

    const commits = await this.getCommitRisks(filters);

    this.logger.info(
      CLASS_NAME,
      'getCommitRiskChartData',
      `Chart data ready: ${commits.length} commit risk records`
    );

    return {
      commits,
      hasData: commits.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get complete release risk summary data including view existence check.
   *
   * @param filters - Optional filters for release risks query
   * @returns ReleaseRiskSummaryData with release summaries and metadata
   */
  async getReleaseRiskSummaryData(
    filters: ReleaseRiskFilters = {}
  ): Promise<ReleaseRiskSummaryData> {
    this.logger.debug(
      CLASS_NAME,
      'getReleaseRiskSummaryData',
      `Fetching release risk summary data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkReleaseRiskViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getReleaseRiskSummaryData',
        'vw_release_risk view not found -- returning empty data'
      );
      return {
        summaries: [],
        hasData: false,
        viewExists: false,
      };
    }

    const summaries = await this.getReleaseRisks(filters);

    this.logger.info(
      CLASS_NAME,
      'getReleaseRiskSummaryData',
      `Summary data ready: ${summaries.length} release risk summaries`
    );

    return {
      summaries,
      hasData: summaries.length > 0,
      viewExists: true,
    };
  }
}
