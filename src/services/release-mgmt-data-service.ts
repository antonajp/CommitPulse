/**
 * Data service for the Release Management Contributions chart.
 * Provides methods to fetch release activity data from the
 * vw_release_contributions and related database views, with optional
 * filtering by date range, team, and repository.
 *
 * The chart visualizes which team members contribute the most to releases
 * by tracking:
 *   - Merge commits to production branches (main/master/release/*)
 *   - Merge commits to staging branches (develop/staging/dev)
 *   - Release tag creation
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89.
 * Input validation enforces string length limits per CWE-20.
 *
 * Ticket: IQS-898
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  RELEASE_MAX_RESULT_ROWS,
  RELEASE_DEFAULT_DAYS,
  QUERY_RELEASE_CONTRIBUTIONS_BY_ENVIRONMENT,
  QUERY_RELEASE_CONTRIBUTIONS_BY_TEAM,
  QUERY_RELEASE_CONTRIBUTIONS_BY_REPOSITORY,
  QUERY_ENVIRONMENT_DISTRIBUTION,
  QUERY_RELEASE_VIEWS_EXIST,
  type ReleaseContribution,
  type EnvironmentDistribution,
} from '../database/queries/release-queries.js';
import type {
  ReleaseContributionPoint,
  ReleaseContributionSummary,
  EnvironmentDistributionPoint,
  ReleaseContributionChartData,
  ReleaseContributionFilters,
  ReleaseEnvironment,
} from './release-mgmt-data-types.js';
import { RELEASE_MGMT_MAX_FILTER_LENGTH } from './release-mgmt-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ReleaseManagementDataService';

/**
 * Service responsible for querying release management database views
 * and returning typed data for the Release Management Contributions chart.
 *
 * Ticket: IQS-898
 */
export class ReleaseManagementDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'ReleaseManagementDataService created');
  }

  /**
   * Check if the vw_release_contributions view exists.
   * Used for graceful degradation when migration 011 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkViewExists', 'Checking vw_release_contributions existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_RELEASE_VIEWS_EXIST);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkViewExists', `vw_release_contributions exists: ${exists}`);
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
    if (value && value.length > RELEASE_MGMT_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${RELEASE_MGMT_MAX_FILTER_LENGTH}`,
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${RELEASE_MGMT_MAX_FILTER_LENGTH} characters`,
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
  private validateDateFilters(filters: ReleaseContributionFilters): void {
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
      throw new Error(`Invalid date range: start date (${filters.startDate}) must be before end date (${filters.endDate})`);
    }
  }

  /**
   * Get default date range (last 30 days).
   *
   * @returns Object with startDate and endDate as ISO strings
   */
  private getDefaultDateRange(): { startDate: string; endDate: string } {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - RELEASE_DEFAULT_DAYS);

    return {
      startDate: startDate.toISOString().split('T')[0] ?? '',
      endDate: endDate.toISOString().split('T')[0] ?? '',
    };
  }

  /**
   * Map database row to ReleaseContributionPoint.
   * Converts snake_case to camelCase.
   */
  private mapRowToContributionPoint(row: ReleaseContribution): ReleaseContributionPoint {
    return {
      author: row.author,
      fullName: row.full_name,
      team: row.team,
      repository: row.repository,
      environment: row.environment as ReleaseEnvironment | null,
      mergeCount: Number(row.merge_count),
      tagCount: Number(row.tag_count),
    };
  }

  /**
   * Map database row to EnvironmentDistributionPoint.
   */
  private mapRowToDistributionPoint(row: EnvironmentDistribution): EnvironmentDistributionPoint {
    return {
      environment: row.environment,
      mergeCount: Number(row.merge_count),
      contributorCount: Number(row.contributor_count),
      repositoryCount: Number(row.repository_count),
    };
  }

  /**
   * Aggregate contribution points into summaries by author.
   * Each author gets one summary with Production and Staging totals.
   */
  private aggregateContributions(
    contributions: readonly ReleaseContributionPoint[],
  ): readonly ReleaseContributionSummary[] {
    const byAuthor = new Map<string, {
      author: string;
      fullName: string | null;
      team: string | null;
      productionMerges: number;
      stagingMerges: number;
      totalTags: number;
    }>();

    for (const c of contributions) {
      let entry = byAuthor.get(c.author);
      if (!entry) {
        entry = {
          author: c.author,
          fullName: c.fullName,
          team: c.team,
          productionMerges: 0,
          stagingMerges: 0,
          totalTags: 0,
        };
        byAuthor.set(c.author, entry);
      }

      // Update full name and team if available (take most recent non-null)
      if (c.fullName) entry.fullName = c.fullName;
      if (c.team) entry.team = c.team;

      // Aggregate by environment
      if (c.environment === 'Production') {
        entry.productionMerges += c.mergeCount;
      } else if (c.environment === 'Staging' || c.environment === 'Dev') {
        entry.stagingMerges += c.mergeCount;
      }

      // Tags are counted once per author (already aggregated in query)
      entry.totalTags += c.tagCount;
    }

    // Convert to array and calculate totalActivity
    const summaries: ReleaseContributionSummary[] = [];
    for (const entry of byAuthor.values()) {
      summaries.push({
        ...entry,
        totalActivity: entry.productionMerges + entry.stagingMerges + entry.totalTags,
      });
    }

    // Sort by total activity descending
    summaries.sort((a, b) => b.totalActivity - a.totalActivity);

    return summaries;
  }

  /**
   * Fetch release contributions with optional filters.
   * Applies default 30-day date range when no dates specified.
   *
   * @param filters - Optional date range, team, repository filters
   * @returns Array of ReleaseContributionPoint
   */
  async getReleaseContributions(
    filters: ReleaseContributionFilters = {},
  ): Promise<readonly ReleaseContributionPoint[]> {
    this.logger.debug(
      CLASS_NAME,
      'getReleaseContributions',
      `Fetching data: filters=${JSON.stringify(filters)}`,
    );

    // Validate string filters for length
    this.validateStringFilter(filters.team, 'team');
    this.validateStringFilter(filters.repository, 'repository');

    // Apply default date range if not specified
    const effectiveFilters = { ...filters };
    if (!effectiveFilters.startDate && !effectiveFilters.endDate) {
      const defaultRange = this.getDefaultDateRange();
      effectiveFilters.startDate = defaultRange.startDate;
      effectiveFilters.endDate = defaultRange.endDate;
      this.logger.debug(
        CLASS_NAME,
        'getReleaseContributions',
        `Applied default date range: ${defaultRange.startDate} to ${defaultRange.endDate}`,
      );
    }

    // Validate date inputs
    this.validateDateFilters(effectiveFilters);

    // Select query based on filters
    const hasTeam = Boolean(effectiveFilters.team);
    const hasRepository = Boolean(effectiveFilters.repository);

    let sql: string;
    let params: unknown[];

    if (hasTeam) {
      sql = QUERY_RELEASE_CONTRIBUTIONS_BY_TEAM;
      params = [effectiveFilters.startDate, effectiveFilters.endDate, effectiveFilters.team];
      this.logger.debug(CLASS_NAME, 'getReleaseContributions', 'Using team filter query');
    } else if (hasRepository) {
      sql = QUERY_RELEASE_CONTRIBUTIONS_BY_REPOSITORY;
      params = [effectiveFilters.startDate, effectiveFilters.endDate, effectiveFilters.repository];
      this.logger.debug(CLASS_NAME, 'getReleaseContributions', 'Using repository filter query');
    } else {
      sql = QUERY_RELEASE_CONTRIBUTIONS_BY_ENVIRONMENT;
      params = [effectiveFilters.startDate, effectiveFilters.endDate];
      this.logger.debug(CLASS_NAME, 'getReleaseContributions', 'Using date range filter query');
    }

    this.logger.trace(CLASS_NAME, 'getReleaseContributions', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<ReleaseContribution>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getReleaseContributions',
      `Query returned ${result.rows.length} rows`,
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, RELEASE_MAX_RESULT_ROWS);
    if (result.rows.length > RELEASE_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getReleaseContributions',
        `Result set truncated from ${result.rows.length} to ${RELEASE_MAX_RESULT_ROWS} rows`,
      );
    }

    const contributions = limitedRows.map((row) => this.mapRowToContributionPoint(row));

    this.logger.debug(
      CLASS_NAME,
      'getReleaseContributions',
      `Returning ${contributions.length} contribution points`,
    );

    return contributions;
  }

  /**
   * Fetch environment distribution statistics.
   *
   * @param filters - Optional date range filters
   * @returns Array of EnvironmentDistributionPoint
   */
  async getEnvironmentDistribution(
    filters: ReleaseContributionFilters = {},
  ): Promise<readonly EnvironmentDistributionPoint[]> {
    this.logger.debug(
      CLASS_NAME,
      'getEnvironmentDistribution',
      `Fetching distribution: filters=${JSON.stringify(filters)}`,
    );

    // Apply default date range if not specified
    const effectiveFilters = { ...filters };
    if (!effectiveFilters.startDate && !effectiveFilters.endDate) {
      const defaultRange = this.getDefaultDateRange();
      effectiveFilters.startDate = defaultRange.startDate;
      effectiveFilters.endDate = defaultRange.endDate;
    }

    // Validate date inputs
    this.validateDateFilters(effectiveFilters);

    const result = await this.db.query<EnvironmentDistribution>(
      QUERY_ENVIRONMENT_DISTRIBUTION,
      [effectiveFilters.startDate, effectiveFilters.endDate],
    );

    this.logger.debug(
      CLASS_NAME,
      'getEnvironmentDistribution',
      `Query returned ${result.rows.length} environment rows`,
    );

    return result.rows.map((row) => this.mapRowToDistributionPoint(row));
  }

  /**
   * Get complete chart data including view existence check, contributions,
   * summaries, and environment distribution.
   *
   * @param filters - Optional date range, team, repository filters
   * @returns ReleaseContributionChartData with all data for rendering
   */
  async getChartData(
    filters: ReleaseContributionFilters = {},
  ): Promise<ReleaseContributionChartData> {
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
        'vw_release_contributions view not found -- returning empty data',
      );
      return {
        summaries: [],
        contributions: [],
        environmentDistribution: [],
        hasData: false,
        viewExists: false,
      };
    }

    // Fetch contributions and distribution in parallel
    const [contributions, environmentDistribution] = await Promise.all([
      this.getReleaseContributions(filters),
      this.getEnvironmentDistribution(filters),
    ]);

    // Aggregate contributions into summaries
    const summaries = this.aggregateContributions(contributions);

    this.logger.info(
      CLASS_NAME,
      'getChartData',
      `Chart data ready: ${summaries.length} contributors, ${contributions.length} contribution points`,
    );

    return {
      summaries,
      contributions,
      environmentDistribution,
      hasData: contributions.length > 0,
      viewExists: true,
    };
  }
}
