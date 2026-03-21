/**
 * TypeScript interfaces for the File Author LOC Contribution Report.
 *
 * Defines data shapes for:
 * - File contribution aggregation by author
 * - Filter options (file paths, date range)
 * - Chart and table data types
 *
 * Ticket: GITX-128
 */

/**
 * Maximum number of files that can be analyzed in a single query.
 * Enforced to prevent performance degradation with large file lists.
 */
export const FILE_AUTHOR_LOC_MAX_FILES = 100;

/**
 * Maximum length for file path strings.
 * Security constraint to prevent excessively long input strings.
 */
export const FILE_AUTHOR_LOC_MAX_PATH_LENGTH = 1024;

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 */
export const FILE_AUTHOR_LOC_MAX_RESULT_ROWS = 5000;

/**
 * Default time range in days for the contribution report.
 */
export const FILE_AUTHOR_LOC_DEFAULT_DAYS = 90;

/**
 * Timeframe preset options for quick selection.
 */
export type TimeframePreset = '7d' | '30d' | '90d' | '6m' | 'custom';

/**
 * Metric type for chart visualization.
 */
export type ContributionMetric = 'totalChurn' | 'linesAdded' | 'netLines';

/**
 * Chart type for visualization toggle.
 */
export type ContributionChartType = 'stacked' | 'grouped';

/**
 * Filters for the file author LOC query.
 */
export interface FileAuthorLocFilters {
  /** List of file paths to analyze (glob patterns supported) */
  readonly filePaths: readonly string[];
  /** Start date for the analysis (YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for the analysis (YYYY-MM-DD) */
  readonly endDate?: string;
  /** Repository to filter by (optional) */
  readonly repository?: string;
}

/**
 * A single row representing author contribution to a file.
 * This is the aggregated result from the database query.
 */
export interface FileAuthorLocRow {
  /** File path (relative to repository root) */
  readonly filename: string;
  /** Author login/username */
  readonly author: string;
  /** Author full name (from commit_contributors) */
  readonly authorName: string;
  /** Team name (from commit_contributors) */
  readonly team: string | null;
  /** Lines added by this author to this file */
  readonly linesAdded: number;
  /** Lines deleted by this author from this file */
  readonly linesDeleted: number;
  /** Net lines (added - deleted) */
  readonly netLines: number;
  /** Total churn (added + deleted) */
  readonly totalChurn: number;
  /** Number of distinct commits */
  readonly commitCount: number;
  /** Date of first commit by this author to this file */
  readonly firstCommit: string;
  /** Date of most recent commit by this author to this file */
  readonly lastCommit: string;
}

/**
 * Database row shape (snake_case) before transformation.
 */
export interface FileAuthorLocDbRow {
  readonly filename: string;
  readonly author: string;
  readonly author_name: string;
  readonly team: string | null;
  readonly lines_added: string | number;
  readonly lines_deleted: string | number;
  readonly net_lines: string | number;
  readonly total_churn: string | number;
  readonly commit_count: string | number;
  readonly first_commit: Date | string;
  readonly last_commit: Date | string;
}

/**
 * Commit detail for drill-down view.
 * Shows individual commits when user clicks on a bar segment.
 */
export interface FileAuthorCommitDetail {
  /** Commit SHA */
  readonly sha: string;
  /** Commit date (YYYY-MM-DD) */
  readonly commitDate: string;
  /** Commit author login */
  readonly author: string;
  /** Commit message (first line) */
  readonly message: string;
  /** Lines added in this commit for the file */
  readonly linesAdded: number;
  /** Lines deleted in this commit for the file */
  readonly linesDeleted: number;
}

/**
 * Database row shape for commit drill-down.
 */
export interface FileAuthorCommitDbRow {
  readonly sha: string;
  readonly commit_date: Date | string;
  readonly author: string;
  readonly message: string;
  readonly lines_added: string | number;
  readonly lines_deleted: string | number;
}

/**
 * Chart data structure for the webview.
 * Organized by file with author contributions.
 */
export interface FileAuthorLocChartData {
  /** Aggregated contribution rows */
  readonly rows: readonly FileAuthorLocRow[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Unique authors in the dataset */
  readonly authors: readonly string[];
  /** Unique files in the dataset */
  readonly files: readonly string[];
  /** Date range used for the query */
  readonly dateRange: {
    readonly startDate: string;
    readonly endDate: string;
  };
}

/**
 * File contribution summary for a single file.
 * Aggregates all authors' contributions to one file.
 */
export interface FileContributionSummary {
  /** File path */
  readonly filename: string;
  /** Total lines added across all authors */
  readonly totalLinesAdded: number;
  /** Total lines deleted across all authors */
  readonly totalLinesDeleted: number;
  /** Total churn across all authors */
  readonly totalChurn: number;
  /** Number of distinct authors */
  readonly authorCount: number;
  /** Primary author (most churn) */
  readonly primaryAuthor: string;
  /** Primary author percentage of total churn */
  readonly primaryAuthorPercentage: number;
}
