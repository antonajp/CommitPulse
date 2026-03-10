/**
 * TypeScript interfaces for the Knowledge Concentration dashboard data shapes.
 * Defines the data model for file-level ownership metrics and bus factor analysis.
 *
 * The Knowledge Concentration dashboard helps engineering managers identify:
 * - Which files are owned predominantly by one person?
 * - What's the overall bus factor of each module?
 * - Who are the backup experts for critical areas?
 * - Where should we invest in knowledge transfer?
 *
 * Ticket: IQS-903
 */

// ============================================================================
// Knowledge Concentration Data Point
// ============================================================================

/**
 * A single file with its ownership and bus factor metrics.
 * Sourced from the vw_knowledge_concentration database view.
 */
export interface FileOwnership {
  /** File path relative to repository root */
  readonly filePath: string;
  /** Repository name */
  readonly repository: string;
  /** Total number of commits touching this file */
  readonly totalCommits: number;
  /** Number of distinct contributors to this file */
  readonly totalContributors: number;
  /** Primary contributor with most commits */
  readonly topContributor: string;
  /** Percentage of commits by top contributor (0-100) */
  readonly topContributorPct: number;
  /** ISO date string of top contributor's last activity */
  readonly topContributorLastActive: string;
  /** Second contributor (backup expert), null if only one contributor */
  readonly secondContributor: string | null;
  /** Percentage of commits by second contributor, null if only one contributor */
  readonly secondContributorPct: number | null;
  /** Knowledge concentration risk level */
  readonly concentrationRisk: ConcentrationRisk;
  /** Bus factor: minimum people to lose before knowledge is lost */
  readonly busFactor: number;
}

/**
 * Concentration risk categories for knowledge silos.
 * - critical: >= 90% ownership by one person
 * - high: >= 80% ownership by one person
 * - medium: >= 60% ownership by one person
 * - low: < 60% ownership by one person
 */
export type ConcentrationRisk = 'critical' | 'high' | 'medium' | 'low';

// ============================================================================
// Module-Level Aggregation
// ============================================================================

/**
 * Module-level bus factor metrics.
 * Sourced from the vw_module_bus_factor database view.
 */
export interface ModuleBusFactor {
  /** Repository name */
  readonly repository: string;
  /** Module path (first 2 directory levels) */
  readonly modulePath: string;
  /** Number of files in this module */
  readonly fileCount: number;
  /** Average bus factor across files in module */
  readonly avgBusFactor: number;
  /** Minimum bus factor (highest risk file) */
  readonly minBusFactor: number;
  /** Count of files with critical or high concentration risk */
  readonly highRiskFiles: number;
  /** Count of files with critical concentration risk */
  readonly criticalRiskFiles: number;
  /** Average number of contributors per file */
  readonly avgContributors: number;
  /** Most common primary owner in this module */
  readonly primaryOwner: string;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Knowledge Concentration dashboard.
 * Contains file ownership data plus metadata for the dashboard UI.
 */
export interface KnowledgeConcentrationChartData {
  /** Array of file ownership data points */
  readonly rows: readonly FileOwnership[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_knowledge_concentration view exists */
  readonly viewExists: boolean;
}

/**
 * Complete response for the Module Bus Factor dashboard.
 * Contains module-level aggregation data plus metadata.
 */
export interface ModuleBusFactorChartData {
  /** Array of module bus factor data points */
  readonly rows: readonly ModuleBusFactor[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_module_bus_factor view exists */
  readonly viewExists: boolean;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for Knowledge Concentration queries.
 * All filters are optional and combined with AND logic.
 */
export interface KnowledgeFilters {
  /** Filter by repository name */
  readonly repository?: string;
  /** Filter by concentration risk level */
  readonly concentrationRisk?: ConcentrationRisk;
  /** Filter by specific contributor (top or second) */
  readonly contributor?: string;
  /** Filter by module path prefix */
  readonly modulePath?: string;
  /** Minimum bus factor threshold */
  readonly minBusFactor?: number;
  /** Maximum bus factor threshold (for finding high-risk files) */
  readonly maxBusFactor?: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum allowed length for string filter values (DoS prevention).
 * CWE-20: Improper Input Validation
 */
export const KNOWLEDGE_MAX_FILTER_LENGTH = 200;

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Matches similar limits in other dashboards.
 */
export const KNOWLEDGE_MAX_RESULT_ROWS = 500;

/**
 * Valid concentration risk values for input validation.
 */
export const VALID_CONCENTRATION_RISKS: readonly ConcentrationRisk[] = [
  'critical',
  'high',
  'medium',
  'low',
];
