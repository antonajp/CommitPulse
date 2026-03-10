/**
 * TypeScript interfaces for the Release Risk Gauge Dashboard data shapes.
 * Defines the data model for per-commit risk metrics and release-level
 * risk summaries based on complexity, test coverage, experience, and hotspots.
 *
 * The Release Risk Gauge helps QA teams prioritize testing by identifying
 * which commits and releases carry the highest risk of introducing bugs.
 *
 * Ticket: IQS-911
 */

// ============================================================================
// Risk Categories
// ============================================================================

/**
 * Risk category levels for commits and releases.
 * Based on calculated risk scores:
 *   - critical: >= 0.75 (commit) or >= 0.6 (release)
 *   - high: >= 0.50 (commit) or >= 0.4 (release)
 *   - medium: >= 0.25 (commit) or >= 0.2 (release)
 *   - low: < 0.25 (commit) or < 0.2 (release)
 */
export type RiskCategory = 'critical' | 'high' | 'medium' | 'low';

// ============================================================================
// Commit Risk Data Point
// ============================================================================

/**
 * A single commit with its individual risk factor scores.
 * Sourced from the vw_commit_risk database view.
 */
export interface CommitRisk {
  /** Commit SHA identifier */
  readonly sha: string;
  /** Commit date as ISO date string */
  readonly commitDate: string;
  /** Git author login/username */
  readonly author: string;
  /** Git branch name */
  readonly branch: string;
  /** Repository name */
  readonly repository: string;
  /** First line of commit message */
  readonly commitMessageSummary: string | null;
  /** Author's full name (from commit_contributors) */
  readonly fullName: string | null;
  /** Author's team (from commit_contributors) */
  readonly team: string | null;
  /** Linked ticket ID (Linear or Jira) */
  readonly ticketId: string | null;
  /** Complexity delta from this commit */
  readonly complexityDelta: number;
  /** Lines of code delta from this commit */
  readonly locDelta: number;
  /** Number of files changed */
  readonly fileCount: number;
  /** Number of test files changed */
  readonly testFileCount: number;

  // Individual Risk Factor Scores (0-1 scale)

  /** Complexity risk: Based on complexity delta magnitude */
  readonly complexityRisk: number;
  /** Test coverage risk: Inverse of test file ratio */
  readonly testCoverageRisk: number;
  /** Experience risk: Inverse of author experience score */
  readonly experienceRisk: number;
  /** Hotspot risk: Based on critical/high hotspot files touched */
  readonly hotspotRisk: number;
  /** Total risk: Weighted composite of all factors */
  readonly totalRisk: number;
  /** Risk category based on total risk score */
  readonly riskCategory: RiskCategory;
}

// ============================================================================
// Release Risk Summary
// ============================================================================

/**
 * Risk breakdown showing average scores for each risk factor.
 * Used for the gauge visualization and risk analysis.
 */
export interface RiskBreakdown {
  /** Average complexity risk across all commits */
  readonly avgComplexityRisk: number;
  /** Average test coverage risk across all commits */
  readonly avgTestCoverageRisk: number;
  /** Average experience risk across all commits */
  readonly avgExperienceRisk: number;
  /** Average hotspot risk across all commits */
  readonly avgHotspotRisk: number;
}

/**
 * Commit counts by risk category.
 * Used for distribution analysis.
 */
export interface RiskDistribution {
  /** Number of commits in critical risk category */
  readonly criticalCount: number;
  /** Number of commits in high risk category */
  readonly highCount: number;
  /** Number of commits in medium risk category */
  readonly mediumCount: number;
  /** Number of commits in low risk category */
  readonly lowCount: number;
}

/**
 * Release-level risk summary aggregating commit risks.
 * Sourced from the vw_release_risk database view.
 */
export interface ReleaseRiskSummary {
  /** Repository name */
  readonly repository: string;
  /** Branch name */
  readonly branch: string;
  /** Total number of commits in the release */
  readonly commitCount: number;
  /** First commit date as ISO date string */
  readonly firstCommitDate: string;
  /** Last commit date as ISO date string */
  readonly lastCommitDate: string;
  /** Aggregate release risk score (0-1 scale) */
  readonly releaseRiskScore: number;
  /** Risk category based on release risk score */
  readonly riskCategory: RiskCategory;
  /** Breakdown of average risk by factor */
  readonly riskBreakdown: RiskBreakdown;
  /** Distribution of commits by risk category */
  readonly riskDistribution: RiskDistribution;
  /** Maximum risk score among all commits */
  readonly maxRisk: number;
}

// ============================================================================
// Author Experience
// ============================================================================

/**
 * Author experience data for risk calculation context.
 * Sourced from the vw_author_experience database view.
 */
export interface AuthorExperience {
  /** Git author login/username */
  readonly author: string;
  /** Total commits in the time window */
  readonly totalCommits: number;
  /** Number of distinct repositories contributed to */
  readonly repoCount: number;
  /** Number of distinct days with commits */
  readonly activeDays: number;
  /** Normalized experience score (0-1 scale, higher = more experienced) */
  readonly experienceScore: number;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Release Risk dashboard commit risks.
 */
export interface ReleaseRiskCommitsData {
  /** Array of commit risk data points, ordered by date/risk descending */
  readonly commits: readonly CommitRisk[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_commit_risk view exists */
  readonly viewExists: boolean;
}

/**
 * Complete response for the Release Risk dashboard summary.
 */
export interface ReleaseRiskSummaryData {
  /** Array of release risk summaries by repository/branch */
  readonly summaries: readonly ReleaseRiskSummary[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_release_risk view exists */
  readonly viewExists: boolean;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for Release Risk queries.
 * All filters are optional and combined with AND logic.
 */
export interface ReleaseRiskFilters {
  /** Start date for date range filter (ISO date string YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string YYYY-MM-DD) */
  readonly endDate?: string;
  /** Filter by repository name */
  readonly repository?: string;
  /** Filter by branch name */
  readonly branch?: string;
  /** Filter by risk category */
  readonly riskCategory?: RiskCategory;
  /** Filter by team name */
  readonly team?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum allowed length for string filter values (DoS prevention).
 * CWE-20: Improper Input Validation
 */
export const RELEASE_RISK_MAX_FILTER_LENGTH = 200;

/**
 * Maximum number of commit result rows returned to prevent memory exhaustion.
 */
export const RELEASE_RISK_MAX_COMMIT_ROWS = 500;

/**
 * Maximum number of release summary rows returned.
 */
export const RELEASE_RISK_MAX_SUMMARY_ROWS = 100;

/**
 * Default time window in days for risk calculation.
 * Defaults to 90 days to match hot spots window.
 */
export const RELEASE_RISK_DEFAULT_TIME_WINDOW_DAYS = 90;

/**
 * Valid risk category values for input validation.
 */
export const VALID_RISK_CATEGORIES: readonly RiskCategory[] = [
  'critical',
  'high',
  'medium',
  'low',
];
