/**
 * TypeScript interfaces for the Ticket Lifecycle Sankey dashboard data shapes.
 * Defines the data model for status transition analysis and flow visualization.
 *
 * The Ticket Lifecycle dashboard helps engineering managers understand:
 * - What's the typical flow path for tickets?
 * - Where do tickets spend the most time (dwell time)?
 * - What percentage of tickets flow back (rework)?
 * - Which transitions are bottlenecks?
 *
 * Ticket: IQS-905
 */

// ============================================================================
// Status Category Types
// ============================================================================

/**
 * Status categories for grouping workflow states.
 * - backlog: Work not yet started
 * - in_progress: Active development
 * - review: Code review or QA
 * - done: Completed or closed
 * - unknown: Status not in status_order table
 */
export type StatusCategory = 'backlog' | 'in_progress' | 'review' | 'done' | 'unknown';

/**
 * Valid status categories for input validation.
 */
export const VALID_STATUS_CATEGORIES: readonly StatusCategory[] = [
  'backlog',
  'in_progress',
  'review',
  'done',
  'unknown',
];

/**
 * Ticket source type: Jira or Linear.
 */
export type TicketType = 'jira' | 'linear';

/**
 * Valid ticket types for input validation.
 */
export const VALID_TICKET_TYPES: readonly TicketType[] = ['jira', 'linear'];

// ============================================================================
// Transition Data Types
// ============================================================================

/**
 * A single status transition for a ticket.
 * Sourced from the vw_ticket_transitions database view.
 */
export interface TicketTransition {
  /** Ticket identifier (Jira key or Linear key) */
  readonly ticketId: string;
  /** Source system: jira or linear */
  readonly ticketType: TicketType;
  /** Status before transition */
  readonly fromStatus: string;
  /** Status after transition */
  readonly toStatus: string;
  /** Timestamp of the transition (ISO string) */
  readonly transitionTime: string;
  /** Assignee at time of transition */
  readonly assignee: string | null;
  /** Issue type (Story, Bug, Task, etc.) */
  readonly issueType: string;
  /** Hours spent in previous status before this transition */
  readonly dwellHours: number | null;
  /** Whether this is a backward transition (rework) */
  readonly isRework: boolean;
  /** Category of the source status */
  readonly fromCategory: StatusCategory;
  /** Category of the target status */
  readonly toCategory: StatusCategory;
}

/**
 * Aggregated transition for Sankey visualization.
 * Sourced from the vw_transition_matrix database view.
 */
export interface TransitionMatrixEntry {
  /** Source status name */
  readonly fromStatus: string;
  /** Target status name */
  readonly toStatus: string;
  /** Category of source status */
  readonly fromCategory: StatusCategory;
  /** Category of target status */
  readonly toCategory: StatusCategory;
  /** Number of transitions following this path */
  readonly transitionCount: number;
  /** Average dwell time in hours before this transition */
  readonly avgDwellHours: number | null;
  /** Median dwell time in hours before this transition */
  readonly medianDwellHours: number | null;
  /** Number of rework (backward) transitions */
  readonly reworkCount: number;
  /** Number of unique tickets that followed this path */
  readonly uniqueTickets: number;
}

// ============================================================================
// Sankey Chart Data Types
// ============================================================================

/**
 * A node in the Sankey diagram representing a status.
 */
export interface SankeyNode {
  /** Status name (unique identifier) */
  readonly status: string;
  /** Status category for color coding */
  readonly category: StatusCategory;
  /** Total tickets that entered this status */
  readonly ticketCount: number;
  /** Average dwell time in this status (hours) */
  readonly avgDwellHours: number;
}

/**
 * A link in the Sankey diagram representing a transition path.
 */
export interface SankeyLink {
  /** Source status name */
  readonly source: string;
  /** Target status name */
  readonly target: string;
  /** Number of tickets following this path */
  readonly count: number;
  /** Average dwell time before this transition */
  readonly avgDwellHours: number | null;
  /** Whether this is a rework (backward) transition */
  readonly isRework: boolean;
}

/**
 * Complete Sankey chart data structure.
 * Contains nodes (statuses) and links (transitions) for visualization.
 */
export interface SankeyData {
  /** Array of status nodes */
  readonly nodes: readonly SankeyNode[];
  /** Array of transition links */
  readonly links: readonly SankeyLink[];
  /** Total tickets analyzed */
  readonly totalTickets: number;
  /** Total rework transitions */
  readonly totalRework: number;
  /** Rework percentage (0-100) */
  readonly reworkPct: number;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for lifecycle queries.
 * All filters are optional and combined with AND logic.
 */
export interface LifecycleFilters {
  /** Start date for transition_time filter (ISO date string) */
  readonly startDate?: string;
  /** End date for transition_time filter (ISO date string) */
  readonly endDate?: string;
  /** Filter by ticket source (jira or linear) */
  readonly ticketType?: TicketType;
  /** Filter by issue type (Story, Bug, Task, etc.) */
  readonly issueType?: string;
  /** Filter by assignee name */
  readonly assignee?: string;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Ticket Lifecycle dashboard.
 * Contains Sankey data plus metadata for the dashboard UI.
 */
export interface LifecycleChartData {
  /** Sankey chart data (nodes and links) */
  readonly sankey: SankeyData;
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the views exist in the database */
  readonly viewExists: boolean;
}

/**
 * Response with individual transitions for detailed analysis.
 */
export interface TransitionsChartData {
  /** Array of individual transitions */
  readonly transitions: readonly TicketTransition[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the view exists in the database */
  readonly viewExists: boolean;
}

/**
 * Response with transition matrix for aggregated analysis.
 */
export interface TransitionMatrixChartData {
  /** Array of aggregated transitions */
  readonly matrix: readonly TransitionMatrixEntry[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the view exists in the database */
  readonly viewExists: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum allowed length for string filter values (DoS prevention).
 * CWE-20: Improper Input Validation
 */
export const LIFECYCLE_MAX_FILTER_LENGTH = 200;

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Matches similar limits in other dashboards.
 */
export const LIFECYCLE_MAX_RESULT_ROWS = 1000;

/**
 * Default number of days to look back for transition data.
 */
export const LIFECYCLE_DEFAULT_DAYS = 90;
