/**
 * Type definitions for the Metrics Dashboard data service.
 * These interfaces map to the database views used by the dashboard:
 * - vw_scorecard, vw_scorecard_detail
 * - vw_commit_file_chage_history
 * - vw_technology_stack_category
 * - vw_technology_stack_complexity
 *
 * Ticket: IQS-869
 */

// ============================================================================
// LOC per Week Types (IQS-919: renamed from Commit Velocity)
// ============================================================================

/**
 * Single data point for LOC per Week charts.
 * Represents the total lines of code changed (inserts + deletes) in a time bucket.
 *
 * Ticket: IQS-919
 */
export interface CommitVelocityPoint {
  /** The date bucket (ISO date string, e.g., "2025-01-15") */
  readonly date: string;
  /** Repository name */
  readonly repository: string;
  /** Lines of code changed in this time bucket (inserts + deletes) */
  readonly locCount: number;
}

/**
 * Granularity options for commit velocity aggregation.
 */
export type VelocityGranularity = 'day' | 'week';

// ============================================================================
// Technology Stack Types
// ============================================================================

/**
 * Technology stack distribution entry.
 * Groups file extensions by category with file counts.
 * Maps from vw_technology_stack_category.
 */
export interface TechStackEntry {
  /** Category name (e.g., "Frontend", "Backend", "Database") */
  readonly category: string;
  /** Number of distinct file extensions in this category */
  readonly extensionCount: number;
  /** Total number of files in this category */
  readonly fileCount: number;
}

// ============================================================================
// Scorecard Types
// ============================================================================

/**
 * Team scorecard summary row.
 * Maps from vw_scorecard view.
 */
export interface ScorecardRow {
  /** Contributor full name */
  readonly fullName: string;
  /** Team assignment */
  readonly team: string;
  /** Vendor classification */
  readonly vendor: string;
  /** Weighted total score */
  readonly totalScore: number;
}

/**
 * Contributor profile badge classification.
 * Based on normalized metrics and team medians.
 *
 * Ticket: IQS-942
 */
export type ContributorProfile =
  | 'Pragmatic Engineer'
  | 'Pragmatic Engineer (leans quality)'
  | 'Pragmatic Engineer (leans delivery)'
  | 'Pragmatic Engineer (leans architecture)'
  | 'Quality Guardian'
  | 'Architect'
  | 'Coordinator'
  | 'Documentation Champion'
  | 'Emerging Talent';

/**
 * Detailed scorecard breakdown row.
 * Maps from vw_scorecard_detail view.
 *
 * Ticket: IQS-942 - Added profile and commitCount fields
 */
export interface ScorecardDetailRow {
  /** Contributor full name */
  readonly fullName: string;
  /** Team assignment */
  readonly team: string;
  /** Vendor classification */
  readonly vendor: string;
  /** Release assist score (merge-based) */
  readonly releaseAssistScore: number;
  /** Test change score */
  readonly testScore: number;
  /** Complexity change score */
  readonly complexityScore: number;
  /** Comments change score */
  readonly commentsScore: number;
  /** Code change score */
  readonly codeScore: number;
  /** Contributor profile badge (optional, IQS-942) */
  readonly profile?: ContributorProfile;
  /** Total commit count for this contributor (optional, IQS-942) */
  readonly commitCount?: number;
}

// ============================================================================
// File Complexity Types
// ============================================================================

/**
 * File complexity trend data point.
 * Maps from vw_commit_file_chage_history.
 */
export interface FileComplexityPoint {
  /** File path/name */
  readonly filename: string;
  /** Commit date (ISO date string) */
  readonly commitDate: string;
  /** Absolute complexity value */
  readonly complexity: number;
  /** Change in complexity from previous commit */
  readonly complexityChange: number;
  /** Technology category of the file */
  readonly category: string;
}

// ============================================================================
// LOC Committed Types (IQS-889)
// ============================================================================

/**
 * Grouping dimension for LOC Committed chart.
 * Determines the X-axis category: by repository, team, or engineer.
 */
export type LocGroupBy = 'repository' | 'team' | 'author';

/**
 * Metric mode for LOC Committed chart.
 * Client-side toggle; all three metrics are returned from a single query.
 */
export type LocMetric = 'linesAdded' | 'netLines' | 'totalChurn';

/**
 * Single data point for the LOC Committed stacked bar chart.
 * Each row represents one (groupKey, arcComponent) combination
 * with all three LOC metrics pre-computed.
 */
export interface LocCommittedPoint {
  /** Group key value (repo name, team name, or author login) */
  readonly groupKey: string;
  /** Architecture component label (e.g., "Back-End", "Front-End") */
  readonly arcComponent: string;
  /** SUM(line_inserts) */
  readonly linesAdded: number;
  /** SUM(line_inserts - line_deletes) */
  readonly netLines: number;
  /** SUM(line_inserts + line_deletes) */
  readonly totalChurn: number;
}

// ============================================================================
// Top Complex Files Types (IQS-894)
// ============================================================================

/**
 * Grouping mode for the Top Complex Files chart.
 * Determines how contributors are displayed:
 * - 'team': Contributors aggregated by team
 * - 'individual': Each contributor shown separately
 */
export type ComplexityGroupBy = 'team' | 'individual';

/**
 * Single data point for the Top Complex Files horizontal stacked bar chart.
 * Each row represents one (filename, contributor/team) combination with LOC contribution.
 *
 * Ticket: IQS-894
 */
export interface TopComplexFilePoint {
  /** File path/name (sorted by total complexity descending) */
  readonly filename: string;
  /** Total file complexity (SCC complexity value or weighted complexity) */
  readonly complexity: number;
  /** Contributor/team name (depends on groupBy mode) */
  readonly contributor: string;
  /** Team name (only populated when groupBy='individual', null for team mode) */
  readonly team: string | null;
  /** Lines of code contributed by this contributor/team */
  readonly loc: number;
  /** Percentage of total file LOC contributed by this contributor/team */
  readonly percentage: number;
}

// ============================================================================
// File Churn Types (IQS-895)
// ============================================================================

/**
 * Grouping mode for the Top Files by Churn chart.
 * Determines how contributors are displayed:
 * - 'team': Contributors aggregated by team
 * - 'individual': Each contributor shown separately
 */
export type FileChurnGroupBy = 'team' | 'individual';

/**
 * Single data point for the Top Files by Churn horizontal stacked bar chart.
 * Each row represents one (filename, contributor/team) combination with churn.
 *
 * Churn = SUM(line_inserts + line_deletes)
 *
 * Ticket: IQS-895
 */
export interface FileChurnPoint {
  /** File path/name (sorted by total churn descending) */
  readonly filename: string;
  /** Total file churn (sum of all contributors) */
  readonly totalChurn: number;
  /** Contributor/team name (depends on groupBy mode) */
  readonly contributor: string;
  /** Team name (only populated when groupBy='individual', null for team mode) */
  readonly team: string | null;
  /** Lines of code churned by this contributor/team */
  readonly churn: number;
  /** Percentage of total file churn by this contributor/team */
  readonly percentage: number;
}

/**
 * Commit detail for drill-down view in the File Churn chart.
 * Shown when user clicks on a bar segment.
 *
 * Ticket: IQS-895
 */
export interface FileChurnCommitDetail {
  /** Commit SHA (first 7 chars typically displayed) */
  readonly sha: string;
  /** Commit date (ISO date string) */
  readonly commitDate: string;
  /** Author login/name */
  readonly author: string;
  /** Commit message (first line) */
  readonly message: string;
  /** Lines added in this commit for this file */
  readonly linesAdded: number;
  /** Lines deleted in this commit for this file */
  readonly linesDeleted: number;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Dashboard filter parameters for data queries.
 * All filters are optional and combined with AND logic.
 */
export interface DashboardFilters {
  /** Start date for date range filter (ISO date string) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string) */
  readonly endDate?: string;
  /** Filter by team name */
  readonly team?: string;
  /** Filter by repository name */
  readonly repository?: string;
}

/**
 * Available filter options derived from the database.
 * Used to populate filter dropdowns in the webview.
 */
export interface FilterOptions {
  /** List of available team names */
  readonly teams: readonly string[];
  /** List of available repository names */
  readonly repositories: readonly string[];
}
