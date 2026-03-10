/**
 * Data service for the Hot Spots dashboard.
 * Provides methods to fetch file-level risk metrics from the
 * vw_hot_spots database view, with optional filtering
 * by repository, risk tier, and thresholds.
 *
 * The Hot Spots dashboard helps engineering teams identify which files
 * are most likely to introduce bugs and should be prioritized for refactoring:
 *   - Churn count (distinct commits per file)
 *   - Complexity (cyclomatic complexity)
 *   - Bug count (commits linked to bug-type tickets)
 *   - Risk score (composite of churn x complexity x bugs)
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-901
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  QUERY_HOT_SPOTS_VIEW_EXISTS,
  QUERY_HOT_SPOTS_ALL,
  QUERY_HOT_SPOTS_BY_REPOSITORY,
  QUERY_HOT_SPOTS_BY_RISK_TIER,
  QUERY_HOT_SPOTS_MIN_CHURN,
  QUERY_HOT_SPOTS_MIN_COMPLEXITY,
  QUERY_HOT_SPOTS_COMBINED,
  QUERY_HOT_SPOTS_SUMMARY,
  type HotSpotDbRow,
  type HotSpotsSummary,
} from '../database/queries/hot-spots-queries.js';
import type {
  HotSpotRow,
  HotSpotsChartData,
  HotSpotsFilters,
  RiskTier,
} from './hot-spots-data-types.js';
import {
  HOT_SPOTS_MAX_FILTER_LENGTH,
  HOT_SPOTS_MAX_RESULT_ROWS,
} from './hot-spots-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'HotSpotsDataService';

/**
 * Valid risk tier values for input validation.
 */
const VALID_RISK_TIERS: readonly RiskTier[] = ['critical', 'high', 'medium', 'low'];

/**
 * Service responsible for querying the vw_hot_spots database
 * view and returning typed data for the Hot Spots dashboard.
 *
 * Ticket: IQS-901
 */
export class HotSpotsDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'HotSpotsDataService created');
  }

  /**
   * Check if the vw_hot_spots view exists.
   * Used for graceful degradation when migration 013 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkViewExists', 'Checking vw_hot_spots existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_HOT_SPOTS_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkViewExists', `vw_hot_spots exists: ${exists}`);
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
    if (value && value.length > HOT_SPOTS_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${HOT_SPOTS_MAX_FILTER_LENGTH}`
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${HOT_SPOTS_MAX_FILTER_LENGTH} characters`
      );
    }
  }

  /**
   * Validate risk tier filter input.
   * Ensures value is one of the valid risk tiers.
   *
   * @param value - Risk tier value to validate
   * @throws Error if value is not a valid risk tier
   */
  private validateRiskTier(value: RiskTier | undefined): void {
    if (value && !VALID_RISK_TIERS.includes(value)) {
      this.logger.warn(CLASS_NAME, 'validateRiskTier', `Invalid risk tier: ${value}`);
      throw new Error(`Invalid risk tier: ${value}. Must be one of: ${VALID_RISK_TIERS.join(', ')}`);
    }
  }

  /**
   * Validate numeric filter inputs.
   * Ensures values are non-negative integers.
   *
   * @param value - Numeric value to validate
   * @param fieldName - Name of the field for error message
   * @throws Error if value is invalid
   */
  private validateNumericFilter(value: number | undefined, fieldName: string): void {
    if (value !== undefined) {
      if (!Number.isInteger(value) || value < 0) {
        this.logger.warn(
          CLASS_NAME,
          'validateNumericFilter',
          `Invalid ${fieldName}: ${value} (must be non-negative integer)`
        );
        throw new Error(`${fieldName} must be a non-negative integer`);
      }
    }
  }

  /**
   * Validate date filter inputs.
   * Validates format and rejects malformed dates (CWE-20).
   *
   * @param filters - Filters to validate
   * @throws Error if dates are invalid
   */
  private validateDateFilters(filters: HotSpotsFilters): void {
    if (filters.startDate && !isValidDateString(filters.startDate)) {
      this.logger.warn(CLASS_NAME, 'validateDateFilters', `Invalid start date: ${filters.startDate}`);
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
   * Map database row to HotSpotRow.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToHotSpot(row: HotSpotDbRow): HotSpotRow {
    const lastChanged =
      row.last_changed instanceof Date
        ? row.last_changed.toISOString().split('T')[0] ?? ''
        : String(row.last_changed);

    return {
      filePath: row.file_path,
      repository: row.repository,
      churnCount: Number(row.churn_count),
      lastChanged,
      contributorCount: Number(row.contributor_count),
      complexity: Number(row.complexity),
      loc: Number(row.loc),
      bugCount: Number(row.bug_count),
      riskScore: Number(row.risk_score),
      riskTier: row.risk_tier,
    };
  }

  /**
   * Fetch hot spots with optional filters.
   *
   * @param filters - Optional repository, risk tier, and threshold filters
   * @returns Array of HotSpotRow sorted by risk score descending
   */
  async getHotSpots(filters: HotSpotsFilters = {}): Promise<readonly HotSpotRow[]> {
    this.logger.debug(
      CLASS_NAME,
      'getHotSpots',
      `Fetching hot spots: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateRiskTier(filters.riskTier);
    this.validateNumericFilter(filters.minChurn, 'minChurn');
    this.validateNumericFilter(filters.minComplexity, 'minComplexity');
    this.validateDateFilters(filters);

    // Determine which query to use based on filter combination
    const hasRepository = Boolean(filters.repository);
    const hasRiskTier = Boolean(filters.riskTier);
    const hasMinChurn = filters.minChurn !== undefined;
    const hasMinComplexity = filters.minComplexity !== undefined;

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [hasRepository, hasRiskTier, hasMinChurn, hasMinComplexity].filter(Boolean).length;

    if (filterCount === 0) {
      // No filters - use simple query
      sql = QUERY_HOT_SPOTS_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getHotSpots', 'Using unfiltered query');
    } else if (filterCount === 1 && hasRepository) {
      // Single repository filter
      sql = QUERY_HOT_SPOTS_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getHotSpots', 'Using repository filter query');
    } else if (filterCount === 1 && hasRiskTier) {
      // Single risk tier filter
      sql = QUERY_HOT_SPOTS_BY_RISK_TIER;
      params = [filters.riskTier];
      this.logger.debug(CLASS_NAME, 'getHotSpots', 'Using risk tier filter query');
    } else if (filterCount === 1 && hasMinChurn) {
      // Single min churn filter
      sql = QUERY_HOT_SPOTS_MIN_CHURN;
      params = [filters.minChurn];
      this.logger.debug(CLASS_NAME, 'getHotSpots', 'Using min churn filter query');
    } else if (filterCount === 1 && hasMinComplexity) {
      // Single min complexity filter
      sql = QUERY_HOT_SPOTS_MIN_COMPLEXITY;
      params = [filters.minComplexity];
      this.logger.debug(CLASS_NAME, 'getHotSpots', 'Using min complexity filter query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_HOT_SPOTS_COMBINED;
      params = [
        filters.repository ?? null,
        filters.riskTier ?? null,
        filters.minChurn ?? null,
        filters.minComplexity ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getHotSpots', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getHotSpots', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<HotSpotDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getHotSpots',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, HOT_SPOTS_MAX_RESULT_ROWS);
    if (result.rows.length > HOT_SPOTS_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getHotSpots',
        `Result set truncated from ${result.rows.length} to ${HOT_SPOTS_MAX_RESULT_ROWS} rows`
      );
    }

    const rows: HotSpotRow[] = limitedRows.map((row) => this.mapRowToHotSpot(row));

    this.logger.debug(
      CLASS_NAME,
      'getHotSpots',
      `Returning ${rows.length} hot spot records`
    );
    return rows;
  }

  /**
   * Get hot spots summary statistics by risk tier.
   * Returns aggregate counts useful for dashboard summary cards.
   *
   * @returns Array of summary statistics grouped by risk tier
   */
  async getHotSpotsSummary(): Promise<readonly HotSpotsSummary[]> {
    this.logger.debug(CLASS_NAME, 'getHotSpotsSummary', 'Fetching hot spots summary');

    const result = await this.db.query<HotSpotsSummary>(QUERY_HOT_SPOTS_SUMMARY);

    this.logger.debug(
      CLASS_NAME,
      'getHotSpotsSummary',
      `Summary has ${result.rows.length} risk tiers`
    );

    return result.rows;
  }

  /**
   * Get complete chart data including view existence check and hot spot data.
   *
   * @param filters - Optional filters for hot spots query
   * @returns HotSpotsChartData with data points and metadata
   */
  async getChartData(filters: HotSpotsFilters = {}): Promise<HotSpotsChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getChartData',
      `Fetching chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getChartData',
        'vw_hot_spots view not found -- returning empty data'
      );
      return {
        rows: [],
        hasData: false,
        viewExists: false,
      };
    }

    const rows = await this.getHotSpots(filters);

    this.logger.info(
      CLASS_NAME,
      'getChartData',
      `Chart data ready: ${rows.length} hot spot files`
    );

    return {
      rows,
      hasData: rows.length > 0,
      viewExists: true,
    };
  }
}
