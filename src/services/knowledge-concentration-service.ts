/**
 * Data service for the Knowledge Concentration dashboard.
 * Provides methods to fetch file-level ownership metrics and bus factor data
 * from the vw_knowledge_concentration and vw_module_bus_factor database views,
 * with optional filtering by repository, concentration risk, contributor, and more.
 *
 * The Knowledge Concentration dashboard helps engineering managers identify:
 *   - Which files are owned predominantly by one person (knowledge silos)
 *   - What's the overall bus factor of each module
 *   - Who are the backup experts for critical areas
 *   - Where should we invest in knowledge transfer
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-903
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import {
  QUERY_KNOWLEDGE_VIEW_EXISTS,
  QUERY_MODULE_BUS_FACTOR_VIEW_EXISTS,
  QUERY_KNOWLEDGE_ALL,
  QUERY_KNOWLEDGE_BY_REPOSITORY,
  QUERY_KNOWLEDGE_BY_RISK,
  QUERY_KNOWLEDGE_BY_CONTRIBUTOR,
  QUERY_KNOWLEDGE_BY_MAX_BUS_FACTOR,
  QUERY_KNOWLEDGE_COMBINED,
  QUERY_KNOWLEDGE_SUMMARY,
  QUERY_MODULE_BUS_FACTOR_ALL,
  QUERY_MODULE_BUS_FACTOR_BY_REPOSITORY,
  QUERY_MODULE_BUS_FACTOR_HIGH_RISK,
  type KnowledgeDbRow,
  type ModuleBusFactorDbRow,
  type KnowledgeSummary,
} from '../database/queries/knowledge-queries.js';
import type {
  FileOwnership,
  ModuleBusFactor,
  KnowledgeConcentrationChartData,
  ModuleBusFactorChartData,
  KnowledgeFilters,
  ConcentrationRisk,
} from './knowledge-concentration-types.js';
import {
  KNOWLEDGE_MAX_FILTER_LENGTH,
  KNOWLEDGE_MAX_RESULT_ROWS,
  VALID_CONCENTRATION_RISKS,
} from './knowledge-concentration-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'KnowledgeConcentrationDataService';

/**
 * Service responsible for querying the vw_knowledge_concentration and
 * vw_module_bus_factor database views and returning typed data for
 * the Knowledge Concentration dashboard.
 *
 * Ticket: IQS-903
 */
export class KnowledgeConcentrationDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'KnowledgeConcentrationDataService created');
  }

  /**
   * Check if the vw_knowledge_concentration view exists.
   * Used for graceful degradation when migration 014 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkViewExists', 'Checking vw_knowledge_concentration existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_KNOWLEDGE_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkViewExists', `vw_knowledge_concentration exists: ${exists}`);
    return exists;
  }

  /**
   * Check if the vw_module_bus_factor view exists.
   * Used for graceful degradation when migration 014 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkModuleViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkModuleViewExists', 'Checking vw_module_bus_factor existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_MODULE_BUS_FACTOR_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkModuleViewExists', `vw_module_bus_factor exists: ${exists}`);
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
    if (value && value.length > KNOWLEDGE_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${KNOWLEDGE_MAX_FILTER_LENGTH}`
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${KNOWLEDGE_MAX_FILTER_LENGTH} characters`
      );
    }
  }

  /**
   * Validate concentration risk filter input.
   * Ensures value is one of the valid risk levels.
   *
   * @param value - Concentration risk value to validate
   * @throws Error if value is not a valid risk level
   */
  private validateConcentrationRisk(value: ConcentrationRisk | undefined): void {
    if (value && !VALID_CONCENTRATION_RISKS.includes(value)) {
      this.logger.warn(CLASS_NAME, 'validateConcentrationRisk', `Invalid concentration risk: ${value}`);
      throw new Error(`Invalid concentration risk: ${value}. Must be one of: ${VALID_CONCENTRATION_RISKS.join(', ')}`);
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
   * Map database row to FileOwnership.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToFileOwnership(row: KnowledgeDbRow): FileOwnership {
    const topContributorLastActive =
      row.top_contributor_last_active instanceof Date
        ? row.top_contributor_last_active.toISOString().split('T')[0] ?? ''
        : String(row.top_contributor_last_active);

    return {
      filePath: row.file_path,
      repository: row.repository,
      totalCommits: Number(row.total_commits),
      totalContributors: Number(row.total_contributors),
      topContributor: row.top_contributor,
      topContributorPct: Number(row.top_contributor_pct),
      topContributorLastActive,
      secondContributor: row.second_contributor,
      secondContributorPct: row.second_contributor_pct !== null ? Number(row.second_contributor_pct) : null,
      concentrationRisk: row.concentration_risk,
      busFactor: Number(row.bus_factor),
    };
  }

  /**
   * Map database row to ModuleBusFactor.
   * Converts numeric strings to numbers and snake_case to camelCase.
   */
  private mapRowToModuleBusFactor(row: ModuleBusFactorDbRow): ModuleBusFactor {
    return {
      repository: row.repository,
      modulePath: row.module_path,
      fileCount: Number(row.file_count),
      avgBusFactor: Number(row.avg_bus_factor),
      minBusFactor: Number(row.min_bus_factor),
      highRiskFiles: Number(row.high_risk_files),
      criticalRiskFiles: Number(row.critical_risk_files),
      avgContributors: Number(row.avg_contributors),
      primaryOwner: row.primary_owner,
    };
  }

  /**
   * Fetch file ownership data with optional filters.
   *
   * @param filters - Optional repository, concentration risk, contributor, and bus factor filters
   * @returns Array of FileOwnership sorted by top_contributor_pct descending
   */
  async getFileOwnership(filters: KnowledgeFilters = {}): Promise<readonly FileOwnership[]> {
    this.logger.debug(
      CLASS_NAME,
      'getFileOwnership',
      `Fetching file ownership: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.contributor, 'contributor');
    this.validateStringFilter(filters.modulePath, 'modulePath');
    this.validateConcentrationRisk(filters.concentrationRisk);
    this.validateNumericFilter(filters.minBusFactor, 'minBusFactor');
    this.validateNumericFilter(filters.maxBusFactor, 'maxBusFactor');

    // Determine which query to use based on filter combination
    const hasRepository = Boolean(filters.repository);
    const hasConcentrationRisk = Boolean(filters.concentrationRisk);
    const hasContributor = Boolean(filters.contributor);
    const hasMaxBusFactor = filters.maxBusFactor !== undefined;

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [hasRepository, hasConcentrationRisk, hasContributor, hasMaxBusFactor].filter(Boolean).length;

    if (filterCount === 0) {
      // No filters - use simple query
      sql = QUERY_KNOWLEDGE_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getFileOwnership', 'Using unfiltered query');
    } else if (filterCount === 1 && hasRepository) {
      // Single repository filter
      sql = QUERY_KNOWLEDGE_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getFileOwnership', 'Using repository filter query');
    } else if (filterCount === 1 && hasConcentrationRisk) {
      // Single concentration risk filter
      sql = QUERY_KNOWLEDGE_BY_RISK;
      params = [filters.concentrationRisk];
      this.logger.debug(CLASS_NAME, 'getFileOwnership', 'Using concentration risk filter query');
    } else if (filterCount === 1 && hasContributor) {
      // Single contributor filter
      sql = QUERY_KNOWLEDGE_BY_CONTRIBUTOR;
      params = [filters.contributor];
      this.logger.debug(CLASS_NAME, 'getFileOwnership', 'Using contributor filter query');
    } else if (filterCount === 1 && hasMaxBusFactor) {
      // Single max bus factor filter
      sql = QUERY_KNOWLEDGE_BY_MAX_BUS_FACTOR;
      params = [filters.maxBusFactor];
      this.logger.debug(CLASS_NAME, 'getFileOwnership', 'Using max bus factor filter query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_KNOWLEDGE_COMBINED;
      params = [
        filters.repository ?? null,
        filters.concentrationRisk ?? null,
        filters.contributor ?? null,
        filters.maxBusFactor ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getFileOwnership', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getFileOwnership', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<KnowledgeDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getFileOwnership',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, KNOWLEDGE_MAX_RESULT_ROWS);
    if (result.rows.length > KNOWLEDGE_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getFileOwnership',
        `Result set truncated from ${result.rows.length} to ${KNOWLEDGE_MAX_RESULT_ROWS} rows`
      );
    }

    const rows: FileOwnership[] = limitedRows.map((row) => this.mapRowToFileOwnership(row));

    this.logger.debug(
      CLASS_NAME,
      'getFileOwnership',
      `Returning ${rows.length} file ownership records`
    );
    return rows;
  }

  /**
   * Get knowledge concentration summary statistics by risk level.
   * Returns aggregate counts useful for dashboard summary cards.
   *
   * @returns Array of summary statistics grouped by concentration risk
   */
  async getSummary(): Promise<readonly KnowledgeSummary[]> {
    this.logger.debug(CLASS_NAME, 'getSummary', 'Fetching knowledge concentration summary');

    const result = await this.db.query<KnowledgeSummary>(QUERY_KNOWLEDGE_SUMMARY);

    this.logger.debug(
      CLASS_NAME,
      'getSummary',
      `Summary has ${result.rows.length} risk levels`
    );

    return result.rows;
  }

  /**
   * Fetch module-level bus factor data with optional filters.
   *
   * @param filters - Optional repository filter
   * @returns Array of ModuleBusFactor sorted by avg_bus_factor ascending (highest risk first)
   */
  async getModuleBusFactor(filters: KnowledgeFilters = {}): Promise<readonly ModuleBusFactor[]> {
    this.logger.debug(
      CLASS_NAME,
      'getModuleBusFactor',
      `Fetching module bus factor: filters=${JSON.stringify(filters)}`
    );

    // Validate repository filter
    this.validateStringFilter(filters.repository, 'repository');

    let sql: string;
    let params: unknown[];

    if (filters.repository) {
      sql = QUERY_MODULE_BUS_FACTOR_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getModuleBusFactor', 'Using repository filter query');
    } else {
      sql = QUERY_MODULE_BUS_FACTOR_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getModuleBusFactor', 'Using unfiltered query');
    }

    const result = await this.db.query<ModuleBusFactorDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getModuleBusFactor',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, KNOWLEDGE_MAX_RESULT_ROWS);
    if (result.rows.length > KNOWLEDGE_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getModuleBusFactor',
        `Result set truncated from ${result.rows.length} to ${KNOWLEDGE_MAX_RESULT_ROWS} rows`
      );
    }

    const rows: ModuleBusFactor[] = limitedRows.map((row) => this.mapRowToModuleBusFactor(row));

    this.logger.debug(
      CLASS_NAME,
      'getModuleBusFactor',
      `Returning ${rows.length} module bus factor records`
    );
    return rows;
  }

  /**
   * Fetch modules with high-risk files only.
   * Returns modules that have at least one file with critical or high concentration risk.
   *
   * @returns Array of ModuleBusFactor with high-risk files
   */
  async getHighRiskModules(): Promise<readonly ModuleBusFactor[]> {
    this.logger.debug(CLASS_NAME, 'getHighRiskModules', 'Fetching high-risk modules');

    const result = await this.db.query<ModuleBusFactorDbRow>(QUERY_MODULE_BUS_FACTOR_HIGH_RISK);

    this.logger.debug(
      CLASS_NAME,
      'getHighRiskModules',
      `Query returned ${result.rows.length} high-risk modules`
    );

    const rows: ModuleBusFactor[] = result.rows.map((row) => this.mapRowToModuleBusFactor(row));
    return rows;
  }

  /**
   * Get complete chart data including view existence check and file ownership data.
   *
   * @param filters - Optional filters for file ownership query
   * @returns KnowledgeConcentrationChartData with data points and metadata
   */
  async getChartData(filters: KnowledgeFilters = {}): Promise<KnowledgeConcentrationChartData> {
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
        'vw_knowledge_concentration view not found -- returning empty data'
      );
      return {
        rows: [],
        hasData: false,
        viewExists: false,
      };
    }

    const rows = await this.getFileOwnership(filters);

    this.logger.info(
      CLASS_NAME,
      'getChartData',
      `Chart data ready: ${rows.length} files with ownership data`
    );

    return {
      rows,
      hasData: rows.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get complete module bus factor chart data including view existence check.
   *
   * @param filters - Optional filters for module bus factor query
   * @returns ModuleBusFactorChartData with data points and metadata
   */
  async getModuleChartData(filters: KnowledgeFilters = {}): Promise<ModuleBusFactorChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getModuleChartData',
      `Fetching module chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkModuleViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getModuleChartData',
        'vw_module_bus_factor view not found -- returning empty data'
      );
      return {
        rows: [],
        hasData: false,
        viewExists: false,
      };
    }

    const rows = await this.getModuleBusFactor(filters);

    this.logger.info(
      CLASS_NAME,
      'getModuleChartData',
      `Module chart data ready: ${rows.length} modules with bus factor data`
    );

    return {
      rows,
      hasData: rows.length > 0,
      viewExists: true,
    };
  }
}
