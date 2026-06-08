/**
 * Message protocol types for communication between the extension host
 * and the Sprint Velocity vs LOC chart webview.
 *
 * Messages flow in two directions:
 * - VelocityWebviewToHost: Messages sent from the webview to the extension
 * - VelocityHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-888, IQS-944, GITX-121
 */

import type { SprintVelocityVsLocPoint } from '../../services/velocity-data-types.js';
import type { SharedWebviewToHost, SharedHostToWebview } from './shared-protocol.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Aggregation period for velocity data.
 * - 'day': Daily aggregation
 * - 'week': Weekly aggregation (ISO week, Monday start) - default
 * - 'biweekly': Bi-weekly aggregation (2-week periods)
 *
 * Ticket: IQS-944
 */
export type VelocityAggregation = 'day' | 'week' | 'biweekly';

/**
 * Request to load sprint velocity vs LOC chart data.
 * Optional date range, team, team member, and repository filters may be provided.
 */
export interface RequestVelocityData {
  readonly type: 'requestVelocityData';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly team?: string;
  /**
   * Filter by team member (contributor login).
   * Ticket: GITX-121
   */
  readonly teamMember?: string;
  /** Filter by repository name (IQS-920) */
  readonly repository?: string;
  /**
   * Aggregation period: 'day', 'week' (default), or 'biweekly'.
   * Ticket: IQS-944
   */
  readonly aggregation?: VelocityAggregation;
}

/**
 * Request to load filter options for team, team member, and repository dropdowns.
 * Ticket: GITX-121
 */
export interface RequestFilterOptions {
  readonly type: 'requestFilterOptions';
}

/**
 * Request to drill down into commits for a specific week's LOC data.
 * Ticket: GITX-149
 */
export interface RequestLocWeekDrillDown {
  readonly type: 'requestLocWeekDrillDown';
  /** The week start date (YYYY-MM-DD) */
  readonly weekStart: string;
  /** Optional repository filter */
  readonly repository?: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type VelocityWebviewToHost =
  | RequestVelocityData
  | RequestFilterOptions
  | RequestLocWeekDrillDown
  | SharedWebviewToHost;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with sprint velocity vs LOC chart data.
 */
export interface ResponseVelocityData {
  readonly type: 'velocityData';
  readonly rows: readonly SprintVelocityVsLocPoint[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Error response sent when a data query fails.
 */
export interface VelocityResponseError {
  readonly type: 'velocityError';
  readonly message: string;
  readonly source: string;
}

/**
 * Response with filter options for team, team member, and repository dropdowns.
 * Ticket: GITX-121
 */
export interface ResponseFilterOptions {
  readonly type: 'filterOptions';
  /** Distinct team names from commit_contributors */
  readonly teams: readonly string[];
  /** Distinct contributor logins from commit_contributors */
  readonly teamMembers: readonly string[];
  /** Distinct repository names from commit_history */
  readonly repositories: readonly string[];
}

/**
 * Commit detail for drill-down display.
 * Ticket: GITX-149
 */
export interface LocWeekCommitDetail {
  /** Short SHA (7 characters) */
  readonly sha: string;
  /** Commit date (ISO string) */
  readonly commitDate: string;
  /** Author name or login */
  readonly author: string;
  /** Primary branch name (or "main" if multiple) */
  readonly branch: string;
  /** Commit message (truncated to 1000 chars) */
  readonly message: string;
  /** Lines added in this commit */
  readonly linesAdded: number;
  /** Lines deleted in this commit */
  readonly linesDeleted: number;
  /** Total LOC changed (added + deleted) */
  readonly totalLoc: number;
}

/**
 * Response with commit details for a week's LOC drill-down.
 * Ticket: GITX-149, GITX-150
 */
export interface ResponseLocWeekDrillDown {
  readonly type: 'locWeekDrillDown';
  /** The week start date that was requested */
  readonly weekStart: string;
  /** Repository filter that was applied, if any */
  readonly repository: string | null;
  /**
   * Repository base URL for constructing commit links (e.g., https://github.com/owner/repo).
   * Null if repository URL is not configured or multiple repos are aggregated.
   * Ticket: GITX-150
   */
  readonly repoUrl: string | null;
  /** Total LOC for this week */
  readonly totalLoc: number;
  /** Number of commits in this week */
  readonly commitCount: number;
  /** Commit details, sorted by LOC impact descending */
  readonly commits: readonly LocWeekCommitDetail[];
}

/**
 * Error response for drill-down request.
 * Ticket: GITX-149
 */
export interface ResponseLocWeekDrillDownError {
  readonly type: 'locWeekDrillDownError';
  readonly message: string;
  readonly weekStart: string;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type VelocityHostToWebview =
  | ResponseVelocityData
  | VelocityResponseError
  | ResponseFilterOptions
  | ResponseLocWeekDrillDown
  | ResponseLocWeekDrillDownError
  | SharedHostToWebview;
