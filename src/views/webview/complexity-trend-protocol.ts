/**
 * Message protocol types for communication between the extension host
 * and the Complexity Trend chart webview.
 *
 * Messages flow in two directions:
 * - ComplexityTrendWebviewToHost: Messages sent from the webview to the extension
 * - ComplexityTrendHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: GITX-133, GITX-134, GITX-136
 */

import type { SharedWebviewToHost, SharedHostToWebview } from './shared-protocol.js';

// ============================================================================
// Data Types
// ============================================================================

/**
 * Time period granularity for complexity trend aggregation.
 * GITX-136: Added 'annual' for yearly aggregation.
 */
export type ComplexityTrendPeriod = 'weekly' | 'monthly' | 'annual';

/**
 * View mode for multi-series complexity trend chart.
 * Determines how data is grouped and displayed as separate lines.
 * - contributor: Each line represents an individual contributor
 * - team: Each line represents a team
 * - repository: Each line represents a repository
 * - archLayer: Each line represents an architectural layer (tech stack category)
 *
 * Ticket: GITX-136
 */
export type ComplexityTrendViewMode = 'contributor' | 'team' | 'repository' | 'archLayer';

/**
 * Complexity metric type for the Y-axis.
 * - average: Average complexity per commit
 * - total: Total (sum) complexity
 *
 * Ticket: GITX-136
 */
export type ComplexityTrendMetric = 'average' | 'total';

/**
 * Top N limit for number of entities displayed.
 * Ticket: GITX-136
 */
export type ComplexityTrendTopN = 5 | 10 | 20;

/**
 * @deprecated Use ComplexityTrendViewMode instead (GITX-136)
 * Grouping dimension for complexity trend chart.
 * - contributor: Group by individual contributor (default, current behavior)
 * - team: Group by team (aggregated complexity across team members)
 * - repository: Group by repository
 * - techStack: Group by technology stack category (Frontend, Backend, etc.)
 *
 * Ticket: GITX-134
 */
export type ComplexityTrendGroupBy = 'contributor' | 'team' | 'repository' | 'techStack';

/**
 * Filters for the complexity trend chart.
 *
 * Ticket: GITX-133, GITX-134, GITX-136
 */
export interface ComplexityTrendFilters {
  /** Time period for aggregation (weekly, monthly, annual) - GITX-136 */
  readonly period?: ComplexityTrendPeriod;
  /** View mode: which dimension shows as separate lines - GITX-136 */
  readonly viewMode?: ComplexityTrendViewMode;
  /** Complexity metric: average or total - GITX-136 */
  readonly metric?: ComplexityTrendMetric;
  /** Top N entities to display (5, 10, 20) - GITX-136 */
  readonly topN?: ComplexityTrendTopN;
  /** Specific entities selected via multi-select picker - GITX-136 */
  readonly selectedEntities?: readonly string[];
  /** @deprecated Use viewMode instead - GITX-136 */
  readonly groupBy?: ComplexityTrendGroupBy;
  /** Start date in YYYY-MM-DD format */
  readonly startDate?: string;
  /** End date in YYYY-MM-DD format */
  readonly endDate?: string;
  /** Pre-filter by team name (applied before viewMode breakdown) */
  readonly team?: string;
  /** Pre-filter by contributor (applied before viewMode breakdown) */
  readonly contributor?: string;
  /** Pre-filter by repository name (applied before viewMode breakdown) */
  readonly repository?: string;
  /** Pre-filter by technology stack category (applied before viewMode breakdown) - GITX-134 */
  readonly techStack?: string;
}

/**
 * A single data point in the complexity trend chart.
 * GITX-136: Added totalComplexity for metric toggle support.
 */
export interface ComplexityTrendPoint {
  /** Aggregated date (week/month/year start) in YYYY-MM-DD format */
  readonly date: string;
  /** Average complexity per commit for the period */
  readonly avgComplexity: number;
  /** Total (sum) complexity for the period - GITX-136 */
  readonly totalComplexity: number;
  /** Total complexity change (delta) */
  readonly complexityDelta: number;
  /** Maximum complexity seen in the period */
  readonly maxComplexity: number;
  /** Number of commits in this period */
  readonly commitCount: number;
  /** Number of files modified in this period */
  readonly fileCount: number;
  /** Entity key for multi-series (contributor/team/repo/archLayer depending on viewMode) */
  readonly groupKey: string;
}

/**
 * Filter options for dropdowns and multi-select pickers.
 *
 * Ticket: GITX-133, GITX-134, GITX-136
 */
export interface ComplexityTrendFilterOptions {
  readonly teams: readonly string[];
  readonly contributors: readonly string[];
  readonly repositories: readonly string[];
  /** Technology stack categories (architectural layers) from vw_technology_stack_category */
  readonly techStacks: readonly string[];
}

/**
 * Entity ranking for Top N selection.
 * Provides entities sorted by total complexity for the current filters.
 * GITX-136
 */
export interface ComplexityTrendEntityRanking {
  /** Entity name (contributor name, team name, repo name, or arch layer) */
  readonly entity: string;
  /** Total complexity for ranking */
  readonly totalComplexity: number;
}

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load complexity trend chart data.
 */
export interface RequestComplexityTrendData {
  readonly type: 'requestComplexityTrendData';
  readonly filters: ComplexityTrendFilters;
}

/**
 * Request to fetch available filter options (teams, contributors, repos).
 */
export interface RequestComplexityTrendFilterOptions {
  readonly type: 'requestComplexityTrendFilterOptions';
}

/**
 * Request entity rankings for the current viewMode and pre-filters.
 * Used to populate the Top N dropdown and multi-select picker.
 * GITX-136
 */
export interface RequestComplexityTrendEntityRanking {
  readonly type: 'requestComplexityTrendEntityRanking';
  /** View mode determines which entities to rank */
  readonly viewMode: ComplexityTrendViewMode;
  /** Pre-filters to apply before ranking */
  readonly filters: ComplexityTrendFilters;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type ComplexityTrendWebviewToHost =
  | RequestComplexityTrendData
  | RequestComplexityTrendFilterOptions
  | RequestComplexityTrendEntityRanking
  | SharedWebviewToHost;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with complexity trend chart data.
 */
export interface ResponseComplexityTrendData {
  readonly type: 'complexityTrendData';
  readonly data: readonly ComplexityTrendPoint[];
  readonly hasData: boolean;
  readonly dataExists: boolean;
}

/**
 * Response with filter options for dropdowns.
 */
export interface ResponseComplexityTrendFilterOptions {
  readonly type: 'complexityTrendFilterOptions';
  readonly options: ComplexityTrendFilterOptions;
}

/**
 * Response with entity rankings for Top N and multi-select.
 * GITX-136
 */
export interface ResponseComplexityTrendEntityRanking {
  readonly type: 'complexityTrendEntityRanking';
  /** Entities sorted by total complexity (descending) */
  readonly rankings: readonly ComplexityTrendEntityRanking[];
  /** View mode these rankings apply to */
  readonly viewMode: ComplexityTrendViewMode;
}

/**
 * Error response sent when a data query fails.
 */
export interface ComplexityTrendResponseError {
  readonly type: 'complexityTrendError';
  readonly message: string;
  readonly source: string;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type ComplexityTrendHostToWebview =
  | ResponseComplexityTrendData
  | ResponseComplexityTrendFilterOptions
  | ResponseComplexityTrendEntityRanking
  | ComplexityTrendResponseError
  | SharedHostToWebview;
