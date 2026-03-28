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
 * Ticket: GITX-133
 */

import type { SharedWebviewToHost, SharedHostToWebview } from './shared-protocol.js';

// ============================================================================
// Data Types
// ============================================================================

/**
 * Time period granularity for complexity trend aggregation.
 */
export type ComplexityTrendPeriod = 'daily' | 'weekly' | 'monthly';

/**
 * Filters for the complexity trend chart.
 */
export interface ComplexityTrendFilters {
  /** Time period for aggregation (daily, weekly, monthly) */
  readonly period?: ComplexityTrendPeriod;
  /** Start date in YYYY-MM-DD format */
  readonly startDate?: string;
  /** End date in YYYY-MM-DD format */
  readonly endDate?: string;
  /** Filter by team name */
  readonly team?: string;
  /** Filter by contributor (author) */
  readonly contributor?: string;
  /** Filter by repository name */
  readonly repository?: string;
}

/**
 * A single data point in the complexity trend chart.
 */
export interface ComplexityTrendPoint {
  /** Aggregated date (day/week/month start) in YYYY-MM-DD format */
  readonly date: string;
  /** Average complexity for the period */
  readonly avgComplexity: number;
  /** Total complexity change (delta) */
  readonly complexityDelta: number;
  /** Maximum complexity seen in the period */
  readonly maxComplexity: number;
  /** Number of commits in this period */
  readonly commitCount: number;
  /** Number of files modified in this period */
  readonly fileCount: number;
  /** Group key for multi-series (contributor/team/repo depending on groupBy) */
  readonly groupKey: string;
}

/**
 * Filter options for dropdowns (teams, contributors, repositories).
 */
export interface ComplexityTrendFilterOptions {
  readonly teams: readonly string[];
  readonly contributors: readonly string[];
  readonly repositories: readonly string[];
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
 * Union type of all messages sent from the webview to the extension host.
 */
export type ComplexityTrendWebviewToHost =
  | RequestComplexityTrendData
  | RequestComplexityTrendFilterOptions
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
  | ComplexityTrendResponseError
  | SharedHostToWebview;
