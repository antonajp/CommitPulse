/**
 * Data service for the Architecture Drift Heat Map Dashboard.
 * Provides methods to fetch drift data from the database views,
 * with optional filtering for cross-component commit analysis.
 *
 * The Architecture Drift Heat Map helps engineering architects understand:
 *   - Which commits touch multiple architecture components?
 *   - Where are cross-component dependencies emerging?
 *   - Which components have the highest drift intensity?
 *   - How is architectural coupling evolving over time?
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-917
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  QUERY_COMPONENT_CHANGES_VIEW_EXISTS,
  QUERY_CROSS_COMPONENT_VIEW_EXISTS,
  QUERY_DRIFT_VIEW_EXISTS,
  QUERY_DRIFT_WEEKLY_VIEW_EXISTS,
  QUERY_COUPLING_VIEW_EXISTS,
  QUERY_CROSS_COMPONENT_ALL,
  QUERY_CROSS_COMPONENT_DATE_RANGE,
  QUERY_CROSS_COMPONENT_BY_REPOSITORY,
  QUERY_CROSS_COMPONENT_BY_SEVERITY,
  QUERY_CROSS_COMPONENT_COMBINED,
  QUERY_DRIFT_ALL,
  QUERY_DRIFT_BY_REPOSITORY,
  QUERY_DRIFT_BY_COMPONENT,
  QUERY_DRIFT_BY_MIN_INTENSITY,
  QUERY_DRIFT_COMBINED,
  QUERY_WEEKLY_DRIFT_ALL,
  QUERY_WEEKLY_DRIFT_BY_REPOSITORY,
  QUERY_WEEKLY_DRIFT_BY_COMPONENT,
  QUERY_PAIR_COUPLING_ALL,
  QUERY_PAIR_COUPLING_BY_REPOSITORY,
  QUERY_PAIR_COUPLING_BY_COMPONENT,
  QUERY_DRIFT_SUMMARY,
  QUERY_UNIQUE_COMPONENTS,
  type CrossComponentDbRow,
  type DriftDbRow,
  type WeeklyDriftDbRow,
  type PairCouplingDbRow,
  type DriftSummaryDbRow,
  type UniqueComponentDbRow,
} from '../database/queries/drift-queries.js';
import type {
  CrossComponentCommit,
  ArchitectureDrift,
  WeeklyDriftTrend,
  ComponentPairCoupling,
  ArchitectureDriftFilters,
  ArchitectureDriftData,
  CrossComponentCommitData,
  WeeklyDriftTrendData,
  ComponentPairCouplingData,
  DriftHeatMapChartData,
  DriftSummary,
  HeatMapData,
  HeatMapCell,
  DriftSeverity,
} from './architecture-drift-types.js';
import {
  DRIFT_MAX_FILTER_LENGTH,
  DRIFT_MAX_RESULT_ROWS,
  DRIFT_MAX_COMMIT_ROWS,
  DRIFT_MAX_WEEKLY_ROWS,
  DRIFT_MAX_COUPLING_ROWS,
  VALID_DRIFT_SEVERITIES,
} from './architecture-drift-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ArchitectureDriftDataService';

/**
 * Service responsible for querying the vw_cross_component_commits,
 * vw_architecture_drift, vw_architecture_drift_weekly, and
 * vw_component_pair_coupling database views and returning typed data
 * for the Architecture Drift Heat Map Dashboard.
 *
 * Ticket: IQS-917
 */
export class ArchitectureDriftDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'ArchitectureDriftDataService created');
  }

  /**
   * Check if the vw_component_changes view exists.
   * Used for graceful degradation when migration 021 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkComponentChangesViewExists(): Promise<boolean> {
    this.logger.debug(
      CLASS_NAME,
      'checkComponentChangesViewExists',
      'Checking vw_component_changes existence'
    );

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_COMPONENT_CHANGES_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(
      CLASS_NAME,
      'checkComponentChangesViewExists',
      `vw_component_changes exists: ${exists}`
    );
    return exists;
  }

  /**
   * Check if the vw_cross_component_commits view exists.
   *
   * @returns true if the view exists
   */
  async checkCrossComponentViewExists(): Promise<boolean> {
    this.logger.debug(
      CLASS_NAME,
      'checkCrossComponentViewExists',
      'Checking vw_cross_component_commits existence'
    );

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_CROSS_COMPONENT_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(
      CLASS_NAME,
      'checkCrossComponentViewExists',
      `vw_cross_component_commits exists: ${exists}`
    );
    return exists;
  }

  /**
   * Check if the vw_architecture_drift view exists.
   *
   * @returns true if the view exists
   */
  async checkDriftViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkDriftViewExists', 'Checking vw_architecture_drift existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_DRIFT_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkDriftViewExists', `vw_architecture_drift exists: ${exists}`);
    return exists;
  }

  /**
   * Check if the vw_architecture_drift_weekly view exists.
   *
   * @returns true if the view exists
   */
  async checkWeeklyDriftViewExists(): Promise<boolean> {
    this.logger.debug(
      CLASS_NAME,
      'checkWeeklyDriftViewExists',
      'Checking vw_architecture_drift_weekly existence'
    );

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_DRIFT_WEEKLY_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(
      CLASS_NAME,
      'checkWeeklyDriftViewExists',
      `vw_architecture_drift_weekly exists: ${exists}`
    );
    return exists;
  }

  /**
   * Check if the vw_component_pair_coupling view exists.
   *
   * @returns true if the view exists
   */
  async checkPairCouplingViewExists(): Promise<boolean> {
    this.logger.debug(
      CLASS_NAME,
      'checkPairCouplingViewExists',
      'Checking vw_component_pair_coupling existence'
    );

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_COUPLING_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(
      CLASS_NAME,
      'checkPairCouplingViewExists',
      `vw_component_pair_coupling exists: ${exists}`
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
    if (value && value.length > DRIFT_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${DRIFT_MAX_FILTER_LENGTH}`
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${DRIFT_MAX_FILTER_LENGTH} characters`
      );
    }
  }

  /**
   * Validate numeric filter inputs.
   * Ensures heat intensity is in valid range (0-100).
   *
   * @param value - Numeric value to validate
   * @param fieldName - Name of the field for error message
   * @throws Error if value is out of range
   */
  private validateNumericFilter(value: number | undefined, fieldName: string): void {
    if (value !== undefined) {
      if (isNaN(value) || value < 0 || value > 100) {
        this.logger.warn(CLASS_NAME, 'validateNumericFilter', `Invalid ${fieldName}: ${value}`);
        throw new Error(`Invalid ${fieldName}: must be between 0 and 100`);
      }
    }
  }

  /**
   * Validate drift severity filter input.
   * Ensures value is one of the valid severity levels.
   *
   * @param value - Severity value to validate
   * @throws Error if value is not a valid severity
   */
  private validateSeverity(value: DriftSeverity | undefined): void {
    if (value && !VALID_DRIFT_SEVERITIES.includes(value)) {
      this.logger.warn(CLASS_NAME, 'validateSeverity', `Invalid drift severity: ${value}`);
      throw new Error(
        `Invalid drift severity: ${value}. Must be one of: ${VALID_DRIFT_SEVERITIES.join(', ')}`
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
  private validateDateFilters(filters: ArchitectureDriftFilters): void {
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
   * Convert Date object to ISO date string.
   */
  private dateToString(value: Date | string | null): string | null {
    if (value === null) {
      return null;
    }
    if (value instanceof Date) {
      return value.toISOString().split('T')[0] ?? null;
    }
    return String(value);
  }

  /**
   * Map database row to CrossComponentCommit.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToCrossComponentCommit(row: CrossComponentDbRow): CrossComponentCommit {
    const commitDate = this.dateToString(row.commit_date) ?? '';

    return {
      sha: row.sha,
      commitDate,
      author: row.author,
      repository: row.repository,
      branch: row.branch,
      commitMessage: row.commit_message,
      fileCount: Number(row.file_count),
      linesAdded: Number(row.lines_added),
      linesRemoved: Number(row.lines_removed),
      fullName: row.full_name,
      team: row.team,
      componentCount: Number(row.component_count),
      componentsTouched: row.components_touched ?? [],
      totalFilesChanged: Number(row.total_files_changed),
      totalLinesAdded: Number(row.total_lines_added),
      totalLinesRemoved: Number(row.total_lines_removed),
      driftSeverity: row.drift_severity,
      driftScore: Number(row.drift_score),
    };
  }

  /**
   * Map database row to ArchitectureDrift.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToDrift(row: DriftDbRow): ArchitectureDrift {
    return {
      component: row.component,
      repository: row.repository,
      crossComponentCommits: Number(row.cross_component_commits),
      totalCommits: Number(row.total_commits),
      driftPercentage: Number(row.drift_percentage),
      totalChurn: Number(row.total_churn),
      avgComponentsPerCommit: Number(row.avg_components_per_commit),
      criticalCount: Number(row.critical_count),
      highCount: Number(row.high_count),
      mediumCount: Number(row.medium_count),
      lowCount: Number(row.low_count),
      uniqueAuthors: Number(row.unique_authors),
      uniqueTeams: Number(row.unique_teams),
      firstDriftDate: this.dateToString(row.first_drift_date),
      lastDriftDate: this.dateToString(row.last_drift_date),
      heatIntensity: Number(row.heat_intensity),
    };
  }

  /**
   * Map database row to WeeklyDriftTrend.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToWeeklyTrend(row: WeeklyDriftDbRow): WeeklyDriftTrend {
    const week = this.dateToString(row.week) ?? '';

    return {
      week,
      component: row.component,
      repository: row.repository,
      crossComponentCommits: Number(row.cross_component_commits),
      totalCommits: Number(row.total_commits),
      driftPercentage: Number(row.drift_percentage),
      weeklyChurn: Number(row.weekly_churn),
      avgComponents: Number(row.avg_components),
      criticalCount: Number(row.critical_count),
      highCount: Number(row.high_count),
      mediumCount: Number(row.medium_count),
      lowCount: Number(row.low_count),
      uniqueAuthors: Number(row.unique_authors),
      heatIntensity: Number(row.heat_intensity),
    };
  }

  /**
   * Map database row to ComponentPairCoupling.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToPairCoupling(row: PairCouplingDbRow): ComponentPairCoupling {
    return {
      componentA: row.component_a,
      componentB: row.component_b,
      repository: row.repository,
      couplingCount: Number(row.coupling_count),
      uniqueCommits: Number(row.unique_commits),
      uniqueAuthors: Number(row.unique_authors),
      uniqueTeams: Number(row.unique_teams),
      criticalCount: Number(row.critical_count),
      highCount: Number(row.high_count),
      firstCouplingDate: this.dateToString(row.first_coupling_date),
      lastCouplingDate: this.dateToString(row.last_coupling_date),
      couplingStrength: Number(row.coupling_strength),
    };
  }

  /**
   * Fetch cross-component commits with optional filters.
   *
   * @param filters - Optional repository, date range, and severity filters
   * @returns Array of CrossComponentCommit sorted by commit date descending
   */
  async getCrossComponentCommits(
    filters: ArchitectureDriftFilters = {}
  ): Promise<readonly CrossComponentCommit[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCrossComponentCommits',
      `Fetching cross-component commits: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.author, 'author');
    this.validateStringFilter(filters.team, 'team');
    this.validateSeverity(filters.severity);
    this.validateDateFilters(filters);

    // Determine which query to use based on filter combination
    const hasDateRange = Boolean(filters.startDate && filters.endDate);
    const hasRepository = Boolean(filters.repository);
    const hasSeverity = Boolean(filters.severity);
    const hasAuthor = Boolean(filters.author);
    const hasTeam = Boolean(filters.team);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [hasDateRange, hasRepository, hasSeverity, hasAuthor, hasTeam].filter(
      Boolean
    ).length;

    if (filterCount === 0) {
      sql = QUERY_CROSS_COMPONENT_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getCrossComponentCommits', 'Using unfiltered query');
    } else if (filterCount === 1 && hasDateRange) {
      sql = QUERY_CROSS_COMPONENT_DATE_RANGE;
      params = [filters.startDate, filters.endDate];
      this.logger.debug(CLASS_NAME, 'getCrossComponentCommits', 'Using date range filter query');
    } else if (filterCount === 1 && hasRepository) {
      sql = QUERY_CROSS_COMPONENT_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getCrossComponentCommits', 'Using repository filter query');
    } else if (filterCount === 1 && hasSeverity) {
      sql = QUERY_CROSS_COMPONENT_BY_SEVERITY;
      params = [filters.severity];
      this.logger.debug(CLASS_NAME, 'getCrossComponentCommits', 'Using severity filter query');
    } else {
      sql = QUERY_CROSS_COMPONENT_COMBINED;
      params = [
        filters.startDate ?? null,
        filters.endDate ?? null,
        filters.repository ?? null,
        filters.severity ?? null,
        filters.author ?? null,
        filters.team ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getCrossComponentCommits', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getCrossComponentCommits', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<CrossComponentDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getCrossComponentCommits',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, DRIFT_MAX_COMMIT_ROWS);
    if (result.rows.length > DRIFT_MAX_COMMIT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getCrossComponentCommits',
        `Result set truncated from ${result.rows.length} to ${DRIFT_MAX_COMMIT_ROWS} rows`
      );
    }

    const commits: CrossComponentCommit[] = limitedRows.map((row) =>
      this.mapRowToCrossComponentCommit(row)
    );

    this.logger.debug(
      CLASS_NAME,
      'getCrossComponentCommits',
      `Returning ${commits.length} cross-component commits`
    );
    return commits;
  }

  /**
   * Fetch architecture drift data with optional filters.
   *
   * @param filters - Optional repository, component, and minimum intensity filters
   * @returns Array of ArchitectureDrift sorted by heat_intensity descending
   */
  async getArchitectureDrift(
    filters: ArchitectureDriftFilters = {}
  ): Promise<readonly ArchitectureDrift[]> {
    this.logger.debug(
      CLASS_NAME,
      'getArchitectureDrift',
      `Fetching architecture drift: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.component, 'component');
    this.validateNumericFilter(filters.minHeatIntensity, 'minHeatIntensity');

    // Determine which query to use
    const hasRepository = Boolean(filters.repository);
    const hasComponent = Boolean(filters.component);
    const hasMinIntensity = filters.minHeatIntensity !== undefined;

    let sql: string;
    let params: unknown[];

    const filterCount = [hasRepository, hasComponent, hasMinIntensity].filter(Boolean).length;

    if (filterCount === 0) {
      sql = QUERY_DRIFT_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getArchitectureDrift', 'Using unfiltered query');
    } else if (filterCount === 1 && hasRepository) {
      sql = QUERY_DRIFT_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getArchitectureDrift', 'Using repository filter query');
    } else if (filterCount === 1 && hasComponent) {
      sql = QUERY_DRIFT_BY_COMPONENT;
      params = [filters.component];
      this.logger.debug(CLASS_NAME, 'getArchitectureDrift', 'Using component filter query');
    } else if (filterCount === 1 && hasMinIntensity) {
      sql = QUERY_DRIFT_BY_MIN_INTENSITY;
      params = [filters.minHeatIntensity];
      this.logger.debug(CLASS_NAME, 'getArchitectureDrift', 'Using min intensity filter query');
    } else {
      sql = QUERY_DRIFT_COMBINED;
      params = [
        filters.repository ?? null,
        filters.component ?? null,
        filters.minHeatIntensity ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getArchitectureDrift', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getArchitectureDrift', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<DriftDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getArchitectureDrift',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, DRIFT_MAX_RESULT_ROWS);
    if (result.rows.length > DRIFT_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getArchitectureDrift',
        `Result set truncated from ${result.rows.length} to ${DRIFT_MAX_RESULT_ROWS} rows`
      );
    }

    const driftData: ArchitectureDrift[] = limitedRows.map((row) => this.mapRowToDrift(row));

    this.logger.debug(
      CLASS_NAME,
      'getArchitectureDrift',
      `Returning ${driftData.length} drift records`
    );
    return driftData;
  }

  /**
   * Fetch weekly drift trends with optional filters.
   *
   * @param filters - Optional repository and component filters
   * @returns Array of WeeklyDriftTrend sorted by week descending
   */
  async getWeeklyDriftTrends(
    filters: Pick<ArchitectureDriftFilters, 'repository' | 'component'> = {}
  ): Promise<readonly WeeklyDriftTrend[]> {
    this.logger.debug(
      CLASS_NAME,
      'getWeeklyDriftTrends',
      `Fetching weekly drift trends: filters=${JSON.stringify(filters)}`
    );

    // Validate filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.component, 'component');

    let sql: string;
    let params: unknown[];

    if (filters.repository) {
      sql = QUERY_WEEKLY_DRIFT_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getWeeklyDriftTrends', 'Using repository filter query');
    } else if (filters.component) {
      sql = QUERY_WEEKLY_DRIFT_BY_COMPONENT;
      params = [filters.component];
      this.logger.debug(CLASS_NAME, 'getWeeklyDriftTrends', 'Using component filter query');
    } else {
      sql = QUERY_WEEKLY_DRIFT_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getWeeklyDriftTrends', 'Using unfiltered query');
    }

    const result = await this.db.query<WeeklyDriftDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getWeeklyDriftTrends',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, DRIFT_MAX_WEEKLY_ROWS);
    if (result.rows.length > DRIFT_MAX_WEEKLY_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getWeeklyDriftTrends',
        `Result set truncated from ${result.rows.length} to ${DRIFT_MAX_WEEKLY_ROWS} rows`
      );
    }

    const trends: WeeklyDriftTrend[] = limitedRows.map((row) => this.mapRowToWeeklyTrend(row));

    this.logger.debug(
      CLASS_NAME,
      'getWeeklyDriftTrends',
      `Returning ${trends.length} weekly trends`
    );
    return trends;
  }

  /**
   * Fetch component pair coupling data with optional filters.
   *
   * @param filters - Optional repository and component filters
   * @returns Array of ComponentPairCoupling sorted by coupling_count descending
   */
  async getComponentPairCoupling(
    filters: Pick<ArchitectureDriftFilters, 'repository' | 'component'> = {}
  ): Promise<readonly ComponentPairCoupling[]> {
    this.logger.debug(
      CLASS_NAME,
      'getComponentPairCoupling',
      `Fetching component pair coupling: filters=${JSON.stringify(filters)}`
    );

    // Validate filters
    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.component, 'component');

    let sql: string;
    let params: unknown[];

    if (filters.repository) {
      sql = QUERY_PAIR_COUPLING_BY_REPOSITORY;
      params = [filters.repository];
      this.logger.debug(CLASS_NAME, 'getComponentPairCoupling', 'Using repository filter query');
    } else if (filters.component) {
      sql = QUERY_PAIR_COUPLING_BY_COMPONENT;
      params = [filters.component];
      this.logger.debug(CLASS_NAME, 'getComponentPairCoupling', 'Using component filter query');
    } else {
      sql = QUERY_PAIR_COUPLING_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getComponentPairCoupling', 'Using unfiltered query');
    }

    const result = await this.db.query<PairCouplingDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getComponentPairCoupling',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, DRIFT_MAX_COUPLING_ROWS);
    if (result.rows.length > DRIFT_MAX_COUPLING_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getComponentPairCoupling',
        `Result set truncated from ${result.rows.length} to ${DRIFT_MAX_COUPLING_ROWS} rows`
      );
    }

    const couplings: ComponentPairCoupling[] = limitedRows.map((row) =>
      this.mapRowToPairCoupling(row)
    );

    this.logger.debug(
      CLASS_NAME,
      'getComponentPairCoupling',
      `Returning ${couplings.length} coupling records`
    );
    return couplings;
  }

  /**
   * Get drift summary statistics.
   *
   * @returns DriftSummary with aggregate metrics
   */
  async getSummary(): Promise<DriftSummary> {
    this.logger.debug(CLASS_NAME, 'getSummary', 'Fetching drift summary');

    const result = await this.db.query<DriftSummaryDbRow>(QUERY_DRIFT_SUMMARY);

    const row = result.rows[0];
    if (!row) {
      this.logger.debug(CLASS_NAME, 'getSummary', 'No summary data found');
      return {
        totalCrossComponentCommits: 0,
        totalComponents: 0,
        avgDriftPercentage: 0,
        highestDriftComponent: null,
        maxHeatIntensity: 0,
        totalCritical: 0,
        totalHigh: 0,
        totalMedium: 0,
        totalLow: 0,
      };
    }

    const summary: DriftSummary = {
      totalCrossComponentCommits: Number(row.total_cross_component_commits),
      totalComponents: Number(row.total_components),
      avgDriftPercentage: row.avg_drift_percentage !== null ? Number(row.avg_drift_percentage) : 0,
      highestDriftComponent: row.highest_drift_component,
      maxHeatIntensity: row.max_heat_intensity !== null ? Number(row.max_heat_intensity) : 0,
      totalCritical: Number(row.total_critical),
      totalHigh: Number(row.total_high),
      totalMedium: Number(row.total_medium),
      totalLow: Number(row.total_low),
    };

    this.logger.info(
      CLASS_NAME,
      'getSummary',
      `Summary: ${summary.totalCrossComponentCommits} cross-component commits, ${summary.totalComponents} components`
    );

    return summary;
  }

  /**
   * Get list of unique components in drift data.
   *
   * @returns Array of component names
   */
  async getUniqueComponents(): Promise<readonly string[]> {
    this.logger.debug(CLASS_NAME, 'getUniqueComponents', 'Fetching unique components');

    const result = await this.db.query<UniqueComponentDbRow>(QUERY_UNIQUE_COMPONENTS);

    const components = result.rows.map((row) => row.component);

    this.logger.debug(CLASS_NAME, 'getUniqueComponents', `Found ${components.length} unique components`);
    return components;
  }

  /**
   * Build heat map data from weekly drift trends.
   * Creates a component x week matrix suitable for heat map visualization.
   *
   * @param weeklyTrends - Array of weekly drift trends
   * @returns HeatMapData with components, weeks, and cells
   */
  buildHeatMapData(weeklyTrends: readonly WeeklyDriftTrend[]): HeatMapData {
    this.logger.debug(
      CLASS_NAME,
      'buildHeatMapData',
      `Building heat map from ${weeklyTrends.length} weekly trends`
    );

    // Extract unique components and weeks
    const componentsSet = new Set<string>();
    const weeksSet = new Set<string>();

    for (const trend of weeklyTrends) {
      componentsSet.add(trend.component);
      weeksSet.add(trend.week);
    }

    const components = Array.from(componentsSet).sort();
    const weeks = Array.from(weeksSet).sort();

    this.logger.debug(
      CLASS_NAME,
      'buildHeatMapData',
      `Matrix dimensions: ${components.length} components x ${weeks.length} weeks`
    );

    // Build cells array
    const cells: HeatMapCell[] = [];
    for (const trend of weeklyTrends) {
      cells.push({
        component: trend.component,
        week: trend.week,
        intensity: trend.heatIntensity,
        commitCount: trend.crossComponentCommits,
      });
    }

    this.logger.debug(CLASS_NAME, 'buildHeatMapData', `Heat map cells: ${cells.length}`);

    return { components, weeks, cells };
  }

  /**
   * Get complete cross-component commit data including view existence check.
   *
   * @param filters - Optional filters for cross-component query
   * @returns CrossComponentCommitData with commits and metadata
   */
  async getCrossComponentCommitData(
    filters: ArchitectureDriftFilters = {}
  ): Promise<CrossComponentCommitData> {
    this.logger.debug(
      CLASS_NAME,
      'getCrossComponentCommitData',
      `Fetching cross-component commit data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkCrossComponentViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getCrossComponentCommitData',
        'vw_cross_component_commits view not found -- returning empty data'
      );
      return {
        commits: [],
        hasData: false,
        viewExists: false,
      };
    }

    const commits = await this.getCrossComponentCommits(filters);

    this.logger.info(
      CLASS_NAME,
      'getCrossComponentCommitData',
      `Cross-component data ready: ${commits.length} commits`
    );

    return {
      commits,
      hasData: commits.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get complete architecture drift data including view existence check.
   *
   * @param filters - Optional filters for drift query
   * @returns ArchitectureDriftData with drift data and metadata
   */
  async getArchitectureDriftData(
    filters: ArchitectureDriftFilters = {}
  ): Promise<ArchitectureDriftData> {
    this.logger.debug(
      CLASS_NAME,
      'getArchitectureDriftData',
      `Fetching architecture drift data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkDriftViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getArchitectureDriftData',
        'vw_architecture_drift view not found -- returning empty data'
      );
      return {
        driftData: [],
        hasData: false,
        viewExists: false,
      };
    }

    const driftData = await this.getArchitectureDrift(filters);

    this.logger.info(
      CLASS_NAME,
      'getArchitectureDriftData',
      `Architecture drift data ready: ${driftData.length} components`
    );

    return {
      driftData,
      hasData: driftData.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get complete weekly trend data including view existence check.
   *
   * @param filters - Optional repository and component filters
   * @returns WeeklyDriftTrendData with trends and metadata
   */
  async getWeeklyDriftTrendData(
    filters: Pick<ArchitectureDriftFilters, 'repository' | 'component'> = {}
  ): Promise<WeeklyDriftTrendData> {
    this.logger.debug(
      CLASS_NAME,
      'getWeeklyDriftTrendData',
      `Fetching weekly drift trend data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkWeeklyDriftViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getWeeklyDriftTrendData',
        'vw_architecture_drift_weekly view not found -- returning empty data'
      );
      return {
        trends: [],
        hasData: false,
        viewExists: false,
      };
    }

    const trends = await this.getWeeklyDriftTrends(filters);

    this.logger.info(
      CLASS_NAME,
      'getWeeklyDriftTrendData',
      `Weekly drift trend data ready: ${trends.length} trends`
    );

    return {
      trends,
      hasData: trends.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get complete component pair coupling data including view existence check.
   *
   * @param filters - Optional repository and component filters
   * @returns ComponentPairCouplingData with couplings and metadata
   */
  async getComponentPairCouplingData(
    filters: Pick<ArchitectureDriftFilters, 'repository' | 'component'> = {}
  ): Promise<ComponentPairCouplingData> {
    this.logger.debug(
      CLASS_NAME,
      'getComponentPairCouplingData',
      `Fetching component pair coupling data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkPairCouplingViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getComponentPairCouplingData',
        'vw_component_pair_coupling view not found -- returning empty data'
      );
      return {
        couplings: [],
        hasData: false,
        viewExists: false,
      };
    }

    const couplings = await this.getComponentPairCoupling(filters);

    this.logger.info(
      CLASS_NAME,
      'getComponentPairCouplingData',
      `Component pair coupling data ready: ${couplings.length} pairs`
    );

    return {
      couplings,
      hasData: couplings.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get complete heat map chart data including all views and summary.
   *
   * @param filters - Optional filters for all queries
   * @returns DriftHeatMapChartData with complete visualization data
   */
  async getHeatMapChartData(
    filters: ArchitectureDriftFilters = {}
  ): Promise<DriftHeatMapChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getHeatMapChartData',
      `Fetching heat map chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkDriftViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getHeatMapChartData',
        'vw_architecture_drift view not found -- returning empty data'
      );
      return {
        driftData: [],
        heatMapData: { components: [], weeks: [], cells: [] },
        couplingData: [],
        summary: {
          totalCrossComponentCommits: 0,
          totalComponents: 0,
          avgDriftPercentage: 0,
          highestDriftComponent: null,
          maxHeatIntensity: 0,
          totalCritical: 0,
          totalHigh: 0,
          totalMedium: 0,
          totalLow: 0,
        },
        hasData: false,
        viewExists: false,
      };
    }

    // Fetch data in parallel
    const [driftData, weeklyTrends, couplingData, summary] = await Promise.all([
      this.getArchitectureDrift(filters),
      this.getWeeklyDriftTrends({
        repository: filters.repository,
        component: filters.component,
      }),
      this.getComponentPairCoupling({
        repository: filters.repository,
        component: filters.component,
      }),
      this.getSummary(),
    ]);

    // Build heat map data from weekly trends
    const heatMapData = this.buildHeatMapData(weeklyTrends);

    this.logger.info(
      CLASS_NAME,
      'getHeatMapChartData',
      `Heat map chart data ready: ${driftData.length} components, ${heatMapData.cells.length} cells`
    );

    return {
      driftData,
      heatMapData,
      couplingData,
      summary,
      hasData: driftData.length > 0,
      viewExists: true,
    };
  }
}
