/**
 * TypeScript interfaces for Release Management Contributions chart data.
 * Defines the data shapes used by ReleaseManagementDataService and the webview panel.
 *
 * The chart visualizes release activity by team member across environments:
 *   - Production (blue #4dc9f6): Merges to main/master, release tags
 *   - Staging/Dev (orange #f67019): Merges to develop/staging branches
 *
 * All dates are ISO-8601 strings (YYYY-MM-DD) for JSON serialization.
 *
 * Ticket: IQS-898
 */

/**
 * Maximum allowed filter string length to prevent DoS (CWE-20).
 */
export const RELEASE_MGMT_MAX_FILTER_LENGTH = 200;

/**
 * Color scheme constants for the grouped bar chart.
 * Colorblind-accessible with 4.5:1 contrast ratio against dark backgrounds.
 */
export const RELEASE_MGMT_COLORS = {
  production: '#4dc9f6',
  staging: '#f67019',
} as const;

/**
 * Environment type discriminator.
 */
export type ReleaseEnvironment = 'Production' | 'Staging' | 'Dev';

/**
 * A single release contribution data point for one team member.
 * Aggregates merge commits and release tags by environment.
 */
export interface ReleaseContributionPoint {
  /** Author login/username */
  readonly author: string;
  /** Full display name (may be null if not in commit_contributors) */
  readonly fullName: string | null;
  /** Team name (may be null if not assigned) */
  readonly team: string | null;
  /** Repository name */
  readonly repository: string | null;
  /** Target environment: Production, Staging, Dev */
  readonly environment: ReleaseEnvironment | null;
  /** Count of merge commits to this environment */
  readonly mergeCount: number;
  /** Count of release tags created */
  readonly tagCount: number;
}

/**
 * Aggregated release contribution by author (summed across environments).
 * Used for the grouped bar chart where each author has Production and Staging bars.
 */
export interface ReleaseContributionSummary {
  /** Author login/username */
  readonly author: string;
  /** Full display name (may be null) */
  readonly fullName: string | null;
  /** Team name (may be null) */
  readonly team: string | null;
  /** Total Production merges (main/master/release branches) */
  readonly productionMerges: number;
  /** Total Staging/Dev merges (develop/staging/feature branches) */
  readonly stagingMerges: number;
  /** Total release tags created */
  readonly totalTags: number;
  /** Total activity (productionMerges + stagingMerges + totalTags) for sorting */
  readonly totalActivity: number;
}

/**
 * Environment distribution statistics for legend/summary cards.
 */
export interface EnvironmentDistributionPoint {
  /** Environment name: Production, Staging, Dev */
  readonly environment: string;
  /** Total merge commits to this environment */
  readonly mergeCount: number;
  /** Number of unique contributors */
  readonly contributorCount: number;
  /** Number of unique repositories */
  readonly repositoryCount: number;
}

/**
 * Filters for release contribution queries.
 * All filters are optional; empty filter returns all data within default time range.
 */
export interface ReleaseContributionFilters {
  /** Start date (ISO 8601: YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date (ISO 8601: YYYY-MM-DD) */
  readonly endDate?: string;
  /** Filter by team name */
  readonly team?: string;
  /** Filter by repository name */
  readonly repository?: string;
}

/**
 * Complete chart data including metadata and contribution points.
 */
export interface ReleaseContributionChartData {
  /** Aggregated contribution data for the grouped bar chart */
  readonly summaries: readonly ReleaseContributionSummary[];
  /** Raw contribution points (before aggregation) */
  readonly contributions: readonly ReleaseContributionPoint[];
  /** Environment distribution for summary cards */
  readonly environmentDistribution: readonly EnvironmentDistributionPoint[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the required database views exist */
  readonly viewExists: boolean;
}
