/**
 * Data service for the Ticket Lifecycle Sankey dashboard.
 * Provides methods to fetch status transitions from the vw_ticket_transitions
 * and vw_transition_matrix database views, with optional filtering.
 *
 * The Ticket Lifecycle dashboard helps engineering managers understand:
 *   - What's the typical flow path for tickets?
 *   - Where do tickets spend the most time (dwell time)?
 *   - What percentage of tickets flow back (rework)?
 *   - Which transitions are bottlenecks?
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-905
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import {
  QUERY_TRANSITIONS_VIEW_EXISTS,
  QUERY_MATRIX_VIEW_EXISTS,
  QUERY_TRANSITIONS_ALL,
  QUERY_TRANSITIONS_BY_DATE_RANGE,
  QUERY_TRANSITIONS_BY_TICKET_TYPE,
  QUERY_TRANSITIONS_BY_ISSUE_TYPE,
  QUERY_TRANSITIONS_BY_ASSIGNEE,
  QUERY_TRANSITIONS_COMBINED,
  QUERY_MATRIX_ALL,
  QUERY_MATRIX_BY_DATE_RANGE,
  QUERY_MATRIX_COMBINED,
  QUERY_LIFECYCLE_SUMMARY,
  QUERY_STATUS_SUMMARY,
  type TransitionDbRow,
  type TransitionMatrixDbRow,
  type LifecycleSummaryDbRow,
  type StatusSummaryDbRow,
} from '../database/queries/lifecycle-queries.js';
import type {
  TicketTransition,
  TransitionMatrixEntry,
  SankeyNode,
  SankeyLink,
  SankeyData,
  LifecycleFilters,
  LifecycleChartData,
  TransitionsChartData,
  TransitionMatrixChartData,
  TicketType,
} from './ticket-lifecycle-types.js';
import {
  LIFECYCLE_MAX_FILTER_LENGTH,
  LIFECYCLE_MAX_RESULT_ROWS,
  VALID_TICKET_TYPES,
} from './ticket-lifecycle-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'TicketLifecycleDataService';

/**
 * Service responsible for querying the vw_ticket_transitions and
 * vw_transition_matrix database views and returning typed data for
 * the Ticket Lifecycle Sankey dashboard.
 *
 * Ticket: IQS-905
 */
export class TicketLifecycleDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'TicketLifecycleDataService created');
  }

  /**
   * Check if the vw_ticket_transitions view exists.
   * Used for graceful degradation when migration 015 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkTransitionsViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkTransitionsViewExists', 'Checking vw_ticket_transitions existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_TRANSITIONS_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkTransitionsViewExists', `vw_ticket_transitions exists: ${exists}`);
    return exists;
  }

  /**
   * Check if the vw_transition_matrix view exists.
   * Used for graceful degradation when migration 015 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkMatrixViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkMatrixViewExists', 'Checking vw_transition_matrix existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_MATRIX_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkMatrixViewExists', `vw_transition_matrix exists: ${exists}`);
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
    if (value && value.length > LIFECYCLE_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${LIFECYCLE_MAX_FILTER_LENGTH}`
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${LIFECYCLE_MAX_FILTER_LENGTH} characters`
      );
    }
  }

  /**
   * Validate ticket type filter input.
   * Ensures value is one of the valid ticket types.
   *
   * @param value - Ticket type value to validate
   * @throws Error if value is not a valid ticket type
   */
  private validateTicketType(value: TicketType | undefined): void {
    if (value && !VALID_TICKET_TYPES.includes(value)) {
      this.logger.warn(CLASS_NAME, 'validateTicketType', `Invalid ticket type: ${value}`);
      throw new Error(`Invalid ticket type: ${value}. Must be one of: ${VALID_TICKET_TYPES.join(', ')}`);
    }
  }

  /**
   * Validate date filter input.
   * Ensures value is a valid ISO date string.
   *
   * @param value - Date string to validate
   * @param fieldName - Name of the field for error message
   * @throws Error if value is not a valid date
   */
  private validateDateFilter(value: string | undefined, fieldName: string): void {
    if (value) {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        this.logger.warn(CLASS_NAME, 'validateDateFilter', `Invalid date for ${fieldName}: ${value}`);
        throw new Error(`Invalid date format for ${fieldName}: ${value}`);
      }
    }
  }

  /**
   * Map database row to TicketTransition.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToTransition(row: TransitionDbRow): TicketTransition {
    const transitionTime =
      row.transition_time instanceof Date
        ? row.transition_time.toISOString()
        : String(row.transition_time);

    return {
      ticketId: row.ticket_id,
      ticketType: row.ticket_type,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      transitionTime,
      assignee: row.assignee,
      issueType: row.issue_type,
      dwellHours: row.dwell_hours !== null ? Number(row.dwell_hours) : null,
      isRework: Boolean(row.is_rework),
      fromCategory: row.from_category,
      toCategory: row.to_category,
    };
  }

  /**
   * Map database row to TransitionMatrixEntry.
   * Converts numeric strings to numbers and snake_case to camelCase.
   */
  private mapRowToMatrixEntry(row: TransitionMatrixDbRow): TransitionMatrixEntry {
    return {
      fromStatus: row.from_status,
      toStatus: row.to_status,
      fromCategory: row.from_category,
      toCategory: row.to_category,
      transitionCount: Number(row.transition_count),
      avgDwellHours: row.avg_dwell_hours !== null ? Number(row.avg_dwell_hours) : null,
      medianDwellHours: row.median_dwell_hours !== null ? Number(row.median_dwell_hours) : null,
      reworkCount: Number(row.rework_count),
      uniqueTickets: Number(row.unique_tickets),
    };
  }

  /**
   * Fetch individual transitions with optional filters.
   *
   * @param filters - Optional date range, ticket type, issue type, and assignee filters
   * @returns Array of TicketTransition sorted by transition_time descending
   */
  async getTransitions(filters: LifecycleFilters = {}): Promise<readonly TicketTransition[]> {
    this.logger.debug(
      CLASS_NAME,
      'getTransitions',
      `Fetching transitions: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateDateFilter(filters.startDate, 'startDate');
    this.validateDateFilter(filters.endDate, 'endDate');
    this.validateTicketType(filters.ticketType);
    this.validateStringFilter(filters.issueType, 'issueType');
    this.validateStringFilter(filters.assignee, 'assignee');

    // Determine which query to use based on filter combination
    const hasStartDate = Boolean(filters.startDate);
    const hasEndDate = Boolean(filters.endDate);
    const hasTicketType = Boolean(filters.ticketType);
    const hasIssueType = Boolean(filters.issueType);
    const hasAssignee = Boolean(filters.assignee);

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    const filterCount = [hasStartDate || hasEndDate, hasTicketType, hasIssueType, hasAssignee].filter(Boolean).length;

    if (filterCount === 0) {
      // No filters - use simple query
      sql = QUERY_TRANSITIONS_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getTransitions', 'Using unfiltered query');
    } else if (filterCount === 1 && (hasStartDate || hasEndDate)) {
      // Single date range filter
      sql = QUERY_TRANSITIONS_BY_DATE_RANGE;
      params = [
        filters.startDate ?? new Date(0).toISOString(),
        filters.endDate ?? new Date().toISOString(),
      ];
      this.logger.debug(CLASS_NAME, 'getTransitions', 'Using date range query');
    } else if (filterCount === 1 && hasTicketType) {
      // Single ticket type filter
      sql = QUERY_TRANSITIONS_BY_TICKET_TYPE;
      params = [filters.ticketType];
      this.logger.debug(CLASS_NAME, 'getTransitions', 'Using ticket type query');
    } else if (filterCount === 1 && hasIssueType) {
      // Single issue type filter
      sql = QUERY_TRANSITIONS_BY_ISSUE_TYPE;
      params = [filters.issueType];
      this.logger.debug(CLASS_NAME, 'getTransitions', 'Using issue type query');
    } else if (filterCount === 1 && hasAssignee) {
      // Single assignee filter
      sql = QUERY_TRANSITIONS_BY_ASSIGNEE;
      params = [filters.assignee];
      this.logger.debug(CLASS_NAME, 'getTransitions', 'Using assignee query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_TRANSITIONS_COMBINED;
      params = [
        filters.startDate ?? null,
        filters.endDate ?? null,
        filters.ticketType ?? null,
        filters.issueType ?? null,
        filters.assignee ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getTransitions', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getTransitions', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<TransitionDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getTransitions',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, LIFECYCLE_MAX_RESULT_ROWS);
    if (result.rows.length > LIFECYCLE_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getTransitions',
        `Result set truncated from ${result.rows.length} to ${LIFECYCLE_MAX_RESULT_ROWS} rows`
      );
    }

    const transitions: TicketTransition[] = limitedRows.map((row) => this.mapRowToTransition(row));

    this.logger.debug(
      CLASS_NAME,
      'getTransitions',
      `Returning ${transitions.length} transition records`
    );
    return transitions;
  }

  /**
   * Fetch transition matrix with optional filters.
   *
   * @param filters - Optional date range, ticket type, issue type, and assignee filters
   * @returns Array of TransitionMatrixEntry sorted by transition_count descending
   */
  async getTransitionMatrix(filters: LifecycleFilters = {}): Promise<readonly TransitionMatrixEntry[]> {
    this.logger.debug(
      CLASS_NAME,
      'getTransitionMatrix',
      `Fetching transition matrix: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateDateFilter(filters.startDate, 'startDate');
    this.validateDateFilter(filters.endDate, 'endDate');
    this.validateTicketType(filters.ticketType);
    this.validateStringFilter(filters.issueType, 'issueType');
    this.validateStringFilter(filters.assignee, 'assignee');

    // Determine which query to use based on filter combination
    const hasStartDate = Boolean(filters.startDate);
    const hasEndDate = Boolean(filters.endDate);
    const hasTicketType = Boolean(filters.ticketType);
    const hasIssueType = Boolean(filters.issueType);
    const hasAssignee = Boolean(filters.assignee);
    const hasAnyFilter = hasStartDate || hasEndDate || hasTicketType || hasIssueType || hasAssignee;

    let sql: string;
    let params: unknown[];

    if (!hasAnyFilter) {
      // No filters - use default view (last 90 days)
      sql = QUERY_MATRIX_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getTransitionMatrix', 'Using unfiltered matrix query (90 days default)');
    } else if (!hasTicketType && !hasIssueType && !hasAssignee && (hasStartDate || hasEndDate)) {
      // Only date range filter - use optimized date range query
      sql = QUERY_MATRIX_BY_DATE_RANGE;
      params = [
        filters.startDate ?? new Date(0).toISOString(),
        filters.endDate ?? new Date().toISOString(),
      ];
      this.logger.debug(CLASS_NAME, 'getTransitionMatrix', 'Using date range matrix query');
    } else {
      // Multiple filters - use combined query
      sql = QUERY_MATRIX_COMBINED;
      params = [
        filters.startDate ?? null,
        filters.endDate ?? null,
        filters.ticketType ?? null,
        filters.issueType ?? null,
        filters.assignee ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getTransitionMatrix', 'Using combined filter matrix query');
    }

    this.logger.trace(CLASS_NAME, 'getTransitionMatrix', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<TransitionMatrixDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getTransitionMatrix',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, LIFECYCLE_MAX_RESULT_ROWS);
    if (result.rows.length > LIFECYCLE_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getTransitionMatrix',
        `Result set truncated from ${result.rows.length} to ${LIFECYCLE_MAX_RESULT_ROWS} rows`
      );
    }

    const matrix: TransitionMatrixEntry[] = limitedRows.map((row) => this.mapRowToMatrixEntry(row));

    this.logger.debug(
      CLASS_NAME,
      'getTransitionMatrix',
      `Returning ${matrix.length} matrix entries`
    );
    return matrix;
  }

  /**
   * Build Sankey chart data from transition matrix.
   * Creates nodes (statuses) and links (transitions) for visualization.
   *
   * @param filters - Optional filters for the underlying data
   * @returns SankeyData with nodes and links
   */
  async getSankeyData(filters: LifecycleFilters = {}): Promise<SankeyData> {
    this.logger.debug(
      CLASS_NAME,
      'getSankeyData',
      `Building Sankey data: filters=${JSON.stringify(filters)}`
    );

    // Fetch transition matrix and status summaries in parallel
    const [matrix, statusResult, summaryResult] = await Promise.all([
      this.getTransitionMatrix(filters),
      this.db.query<StatusSummaryDbRow>(QUERY_STATUS_SUMMARY, [
        filters.startDate ?? null,
        filters.endDate ?? null,
      ]),
      this.db.query<LifecycleSummaryDbRow>(QUERY_LIFECYCLE_SUMMARY, [
        filters.startDate ?? null,
        filters.endDate ?? null,
      ]),
    ]);

    // Build nodes from status summary
    const nodes: SankeyNode[] = statusResult.rows.map((row) => ({
      status: row.status,
      category: row.category,
      ticketCount: Number(row.ticket_count),
      avgDwellHours: row.avg_dwell_hours !== null ? Number(row.avg_dwell_hours) : 0,
    }));

    // Build links from transition matrix
    const links: SankeyLink[] = matrix.map((entry) => ({
      source: entry.fromStatus,
      target: entry.toStatus,
      count: entry.transitionCount,
      avgDwellHours: entry.avgDwellHours,
      isRework: entry.reworkCount > 0,
    }));

    // Extract summary statistics
    const summary = summaryResult.rows[0];
    const totalTickets = summary ? Number(summary.total_tickets) : 0;
    const totalRework = summary ? Number(summary.total_rework) : 0;
    const reworkPct = summary && summary.rework_pct !== null ? Number(summary.rework_pct) : 0;

    this.logger.info(
      CLASS_NAME,
      'getSankeyData',
      `Sankey data built: ${nodes.length} nodes, ${links.length} links, ${totalTickets} tickets, ${reworkPct}% rework`
    );

    return {
      nodes,
      links,
      totalTickets,
      totalRework,
      reworkPct,
    };
  }

  /**
   * Get complete chart data including view existence check and Sankey data.
   *
   * @param filters - Optional filters for transition queries
   * @returns LifecycleChartData with Sankey data and metadata
   */
  async getChartData(filters: LifecycleFilters = {}): Promise<LifecycleChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getChartData',
      `Fetching chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkTransitionsViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getChartData',
        'vw_ticket_transitions view not found -- returning empty data'
      );
      return {
        sankey: {
          nodes: [],
          links: [],
          totalTickets: 0,
          totalRework: 0,
          reworkPct: 0,
        },
        hasData: false,
        viewExists: false,
      };
    }

    const sankey = await this.getSankeyData(filters);

    this.logger.info(
      CLASS_NAME,
      'getChartData',
      `Chart data ready: ${sankey.nodes.length} nodes, ${sankey.links.length} links`
    );

    return {
      sankey,
      hasData: sankey.nodes.length > 0 || sankey.links.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get transitions chart data with view existence check.
   *
   * @param filters - Optional filters for transition queries
   * @returns TransitionsChartData with transitions and metadata
   */
  async getTransitionsChartData(filters: LifecycleFilters = {}): Promise<TransitionsChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getTransitionsChartData',
      `Fetching transitions chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkTransitionsViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getTransitionsChartData',
        'vw_ticket_transitions view not found -- returning empty data'
      );
      return {
        transitions: [],
        hasData: false,
        viewExists: false,
      };
    }

    const transitions = await this.getTransitions(filters);

    this.logger.info(
      CLASS_NAME,
      'getTransitionsChartData',
      `Transitions chart data ready: ${transitions.length} transitions`
    );

    return {
      transitions,
      hasData: transitions.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get transition matrix chart data with view existence check.
   *
   * @param filters - Optional filters for matrix queries
   * @returns TransitionMatrixChartData with matrix and metadata
   */
  async getMatrixChartData(filters: LifecycleFilters = {}): Promise<TransitionMatrixChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getMatrixChartData',
      `Fetching matrix chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkMatrixViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getMatrixChartData',
        'vw_transition_matrix view not found -- returning empty data'
      );
      return {
        matrix: [],
        hasData: false,
        viewExists: false,
      };
    }

    const matrix = await this.getTransitionMatrix(filters);

    this.logger.info(
      CLASS_NAME,
      'getMatrixChartData',
      `Matrix chart data ready: ${matrix.length} entries`
    );

    return {
      matrix,
      hasData: matrix.length > 0,
      viewExists: true,
    };
  }
}
