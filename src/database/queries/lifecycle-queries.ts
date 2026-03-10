/**
 * Parameterized SQL queries for the Ticket Lifecycle Sankey dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against the vw_ticket_transitions and vw_transition_matrix
 * views created by migration 015_ticket_lifecycle.sql.
 *
 * The views calculate:
 *   1. Individual transitions with timestamps and dwell time
 *   2. Rework detection based on status_order ordinals
 *   3. Aggregated transition matrix for Sankey visualization
 *   4. Status category grouping
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-905
 */

import type { StatusCategory, TicketType } from '../../services/ticket-lifecycle-types.js';

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Applied as LIMIT in each query.
 */
export const LIFECYCLE_QUERY_MAX_ROWS = 1000;

// ============================================================================
// View Existence Checks
// ============================================================================

/**
 * Query to check if the vw_ticket_transitions view exists.
 * Used for graceful degradation if migration 015 has not been applied.
 */
export const QUERY_TRANSITIONS_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_ticket_transitions'
  ) AS view_exists
`;

/**
 * Query to check if the vw_transition_matrix view exists.
 * Used for graceful degradation if migration 015 has not been applied.
 */
export const QUERY_MATRIX_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_transition_matrix'
  ) AS view_exists
`;

/**
 * Query to check if the status_order table exists.
 */
export const QUERY_STATUS_ORDER_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'status_order'
  ) AS table_exists
`;

// ============================================================================
// Ticket Transitions Queries
// ============================================================================

/**
 * Query to fetch all transitions from the view.
 * Returns transitions ordered by transition_time DESC.
 * Limited to LIFECYCLE_QUERY_MAX_ROWS for safety.
 */
export const QUERY_TRANSITIONS_ALL = `
  SELECT
    ticket_id,
    ticket_type,
    from_status,
    to_status,
    transition_time,
    assignee,
    issue_type,
    dwell_hours,
    is_rework,
    from_category,
    to_category
  FROM vw_ticket_transitions
  ORDER BY transition_time DESC
  LIMIT ${LIFECYCLE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch transitions with date range filter.
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range
 *   $2 - end_date (TIMESTAMP) - end of date range
 */
export const QUERY_TRANSITIONS_BY_DATE_RANGE = `
  SELECT
    ticket_id,
    ticket_type,
    from_status,
    to_status,
    transition_time,
    assignee,
    issue_type,
    dwell_hours,
    is_rework,
    from_category,
    to_category
  FROM vw_ticket_transitions
  WHERE transition_time >= $1::TIMESTAMP
    AND transition_time <= $2::TIMESTAMP
  ORDER BY transition_time DESC
  LIMIT ${LIFECYCLE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch transitions with ticket type filter.
 * Parameters:
 *   $1 - ticket_type (TEXT) - 'jira' or 'linear'
 */
export const QUERY_TRANSITIONS_BY_TICKET_TYPE = `
  SELECT
    ticket_id,
    ticket_type,
    from_status,
    to_status,
    transition_time,
    assignee,
    issue_type,
    dwell_hours,
    is_rework,
    from_category,
    to_category
  FROM vw_ticket_transitions
  WHERE ticket_type = $1
  ORDER BY transition_time DESC
  LIMIT ${LIFECYCLE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch transitions with issue type filter.
 * Parameters:
 *   $1 - issue_type (TEXT) - issue type to filter by
 */
export const QUERY_TRANSITIONS_BY_ISSUE_TYPE = `
  SELECT
    ticket_id,
    ticket_type,
    from_status,
    to_status,
    transition_time,
    assignee,
    issue_type,
    dwell_hours,
    is_rework,
    from_category,
    to_category
  FROM vw_ticket_transitions
  WHERE LOWER(issue_type) = LOWER($1)
  ORDER BY transition_time DESC
  LIMIT ${LIFECYCLE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch transitions with assignee filter.
 * Parameters:
 *   $1 - assignee (TEXT) - assignee to filter by
 */
export const QUERY_TRANSITIONS_BY_ASSIGNEE = `
  SELECT
    ticket_id,
    ticket_type,
    from_status,
    to_status,
    transition_time,
    assignee,
    issue_type,
    dwell_hours,
    is_rework,
    from_category,
    to_category
  FROM vw_ticket_transitions
  WHERE LOWER(assignee) = LOWER($1)
  ORDER BY transition_time DESC
  LIMIT ${LIFECYCLE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch transitions with combined filters.
 * NULL values are treated as "no filter" via COALESCE/OR patterns.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range (nullable)
 *   $2 - end_date (TIMESTAMP) - end of date range (nullable)
 *   $3 - ticket_type (TEXT) - jira or linear (nullable)
 *   $4 - issue_type (TEXT) - issue type filter (nullable)
 *   $5 - assignee (TEXT) - assignee filter (nullable)
 */
export const QUERY_TRANSITIONS_COMBINED = `
  SELECT
    ticket_id,
    ticket_type,
    from_status,
    to_status,
    transition_time,
    assignee,
    issue_type,
    dwell_hours,
    is_rework,
    from_category,
    to_category
  FROM vw_ticket_transitions
  WHERE (transition_time >= $1::TIMESTAMP OR $1 IS NULL)
    AND (transition_time <= $2::TIMESTAMP OR $2 IS NULL)
    AND (ticket_type = $3 OR $3 IS NULL)
    AND (LOWER(issue_type) = LOWER($4) OR $4 IS NULL)
    AND (LOWER(assignee) = LOWER($5) OR $5 IS NULL)
  ORDER BY transition_time DESC
  LIMIT ${LIFECYCLE_QUERY_MAX_ROWS}
`;

// ============================================================================
// Transition Matrix Queries
// ============================================================================

/**
 * Query to fetch all aggregated transitions from the matrix view.
 * Returns transitions ordered by transition_count DESC.
 */
export const QUERY_MATRIX_ALL = `
  SELECT
    from_status,
    to_status,
    from_category,
    to_category,
    transition_count,
    avg_dwell_hours,
    median_dwell_hours,
    rework_count,
    unique_tickets
  FROM vw_transition_matrix
  ORDER BY transition_count DESC
  LIMIT ${LIFECYCLE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch matrix with custom date range.
 * This query bypasses the view's 90-day default and applies custom filtering.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range
 *   $2 - end_date (TIMESTAMP) - end of date range
 */
export const QUERY_MATRIX_BY_DATE_RANGE = `
  SELECT
    from_status,
    to_status,
    from_category,
    to_category,
    COUNT(*) AS transition_count,
    ROUND(AVG(dwell_hours)::NUMERIC, 2) AS avg_dwell_hours,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dwell_hours)::NUMERIC, 2) AS median_dwell_hours,
    COUNT(*) FILTER (WHERE is_rework) AS rework_count,
    COUNT(DISTINCT ticket_id) AS unique_tickets
  FROM vw_ticket_transitions
  WHERE transition_time >= $1::TIMESTAMP
    AND transition_time <= $2::TIMESTAMP
  GROUP BY from_status, to_status, from_category, to_category
  ORDER BY transition_count DESC
  LIMIT ${LIFECYCLE_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch matrix with combined filters.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range (nullable)
 *   $2 - end_date (TIMESTAMP) - end of date range (nullable)
 *   $3 - ticket_type (TEXT) - jira or linear (nullable)
 *   $4 - issue_type (TEXT) - issue type filter (nullable)
 *   $5 - assignee (TEXT) - assignee filter (nullable)
 */
export const QUERY_MATRIX_COMBINED = `
  SELECT
    from_status,
    to_status,
    from_category,
    to_category,
    COUNT(*) AS transition_count,
    ROUND(AVG(dwell_hours)::NUMERIC, 2) AS avg_dwell_hours,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dwell_hours)::NUMERIC, 2) AS median_dwell_hours,
    COUNT(*) FILTER (WHERE is_rework) AS rework_count,
    COUNT(DISTINCT ticket_id) AS unique_tickets
  FROM vw_ticket_transitions
  WHERE (transition_time >= $1::TIMESTAMP OR $1 IS NULL)
    AND (transition_time <= $2::TIMESTAMP OR $2 IS NULL)
    AND (ticket_type = $3 OR $3 IS NULL)
    AND (LOWER(issue_type) = LOWER($4) OR $4 IS NULL)
    AND (LOWER(assignee) = LOWER($5) OR $5 IS NULL)
  GROUP BY from_status, to_status, from_category, to_category
  ORDER BY transition_count DESC
  LIMIT ${LIFECYCLE_QUERY_MAX_ROWS}
`;

// ============================================================================
// Summary and Statistics Queries
// ============================================================================

/**
 * Query to get lifecycle summary statistics.
 * Returns aggregate counts by status category.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range (nullable)
 *   $2 - end_date (TIMESTAMP) - end of date range (nullable)
 */
export const QUERY_LIFECYCLE_SUMMARY = `
  SELECT
    COUNT(DISTINCT ticket_id) AS total_tickets,
    COUNT(*) AS total_transitions,
    COUNT(*) FILTER (WHERE is_rework) AS total_rework,
    ROUND((COUNT(*) FILTER (WHERE is_rework)::NUMERIC / NULLIF(COUNT(*), 0) * 100)::NUMERIC, 2) AS rework_pct,
    ROUND(AVG(dwell_hours)::NUMERIC, 2) AS avg_dwell_hours,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dwell_hours)::NUMERIC, 2) AS median_dwell_hours
  FROM vw_ticket_transitions
  WHERE (transition_time >= $1::TIMESTAMP OR $1 IS NULL)
    AND (transition_time <= $2::TIMESTAMP OR $2 IS NULL)
`;

/**
 * Query to get status-level statistics for node building.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range (nullable)
 *   $2 - end_date (TIMESTAMP) - end of date range (nullable)
 */
export const QUERY_STATUS_SUMMARY = `
  WITH incoming AS (
    SELECT
      to_status AS status,
      to_category AS category,
      COUNT(DISTINCT ticket_id) AS ticket_count,
      ROUND(AVG(dwell_hours)::NUMERIC, 2) AS avg_dwell_hours
    FROM vw_ticket_transitions
    WHERE (transition_time >= $1::TIMESTAMP OR $1 IS NULL)
      AND (transition_time <= $2::TIMESTAMP OR $2 IS NULL)
    GROUP BY to_status, to_category
  ),
  outgoing AS (
    SELECT
      from_status AS status,
      from_category AS category,
      COUNT(DISTINCT ticket_id) AS ticket_count,
      ROUND(AVG(dwell_hours)::NUMERIC, 2) AS avg_dwell_hours
    FROM vw_ticket_transitions
    WHERE (transition_time >= $1::TIMESTAMP OR $1 IS NULL)
      AND (transition_time <= $2::TIMESTAMP OR $2 IS NULL)
    GROUP BY from_status, from_category
  )
  SELECT
    COALESCE(i.status, o.status) AS status,
    COALESCE(i.category, o.category) AS category,
    COALESCE(i.ticket_count, 0) + COALESCE(o.ticket_count, 0) AS ticket_count,
    COALESCE(i.avg_dwell_hours, o.avg_dwell_hours, 0) AS avg_dwell_hours
  FROM incoming i
  FULL OUTER JOIN outgoing o ON i.status = o.status
  ORDER BY ticket_count DESC
`;

// ============================================================================
// Database Row Types
// ============================================================================

/**
 * TypeScript interface for ticket transition row from database.
 * Maps 1:1 to vw_ticket_transitions view columns (snake_case).
 */
export interface TransitionDbRow {
  readonly ticket_id: string;
  readonly ticket_type: TicketType;
  readonly from_status: string;
  readonly to_status: string;
  readonly transition_time: Date | string;
  readonly assignee: string | null;
  readonly issue_type: string;
  readonly dwell_hours: number | string | null;
  readonly is_rework: boolean;
  readonly from_category: StatusCategory;
  readonly to_category: StatusCategory;
}

/**
 * TypeScript interface for transition matrix row from database.
 * Maps 1:1 to vw_transition_matrix view columns (snake_case).
 */
export interface TransitionMatrixDbRow {
  readonly from_status: string;
  readonly to_status: string;
  readonly from_category: StatusCategory;
  readonly to_category: StatusCategory;
  readonly transition_count: number | string;
  readonly avg_dwell_hours: number | string | null;
  readonly median_dwell_hours: number | string | null;
  readonly rework_count: number | string;
  readonly unique_tickets: number | string;
}

/**
 * TypeScript interface for lifecycle summary statistics.
 */
export interface LifecycleSummaryDbRow {
  readonly total_tickets: number | string;
  readonly total_transitions: number | string;
  readonly total_rework: number | string;
  readonly rework_pct: number | string | null;
  readonly avg_dwell_hours: number | string | null;
  readonly median_dwell_hours: number | string | null;
}

/**
 * TypeScript interface for status summary row.
 */
export interface StatusSummaryDbRow {
  readonly status: string;
  readonly category: StatusCategory;
  readonly ticket_count: number | string;
  readonly avg_dwell_hours: number | string | null;
}
