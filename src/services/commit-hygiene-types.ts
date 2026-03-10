/**
 * TypeScript interfaces for the Commit Hygiene Tracker Dashboard data shapes.
 * Defines the data model for commit hygiene scoring based on conventional
 * commit patterns and message quality metrics.
 *
 * The Commit Hygiene Tracker helps teams maintain consistent commit standards:
 *   - Conventional commit prefix detection (feat, fix, docs, etc.)
 *   - Subject line length validation (50-72 chars ideal)
 *   - Proper capitalization and formatting
 *   - Scope and body presence
 *   - Breaking change notation
 *
 * Ticket: IQS-915
 */

// ============================================================================
// Quality Tiers
// ============================================================================

/**
 * Quality tier levels for commits based on hygiene score.
 * Based on calculated hygiene scores (0-100):
 *   - excellent: >= 80 (follows all best practices)
 *   - good: >= 60 (follows most best practices)
 *   - fair: >= 40 (follows some best practices)
 *   - poor: < 40 (needs improvement)
 */
export type QualityTier = 'excellent' | 'good' | 'fair' | 'poor';

/**
 * Conventional commit types supported by the hygiene checker.
 */
export type ConventionalCommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'test'
  | 'chore'
  | 'build'
  | 'ci'
  | 'perf'
  | 'revert';

// ============================================================================
// Commit Hygiene Data Point
// ============================================================================

/**
 * A single commit with its hygiene score and quality metrics.
 * Sourced from the vw_commit_hygiene database view.
 */
export interface CommitHygiene {
  /** Commit SHA identifier */
  readonly sha: string;
  /** Commit date as ISO date string */
  readonly commitDate: string;
  /** Git author login/username */
  readonly author: string;
  /** Repository name */
  readonly repository: string;
  /** Git branch name */
  readonly branch: string;
  /** First line of commit message (subject) */
  readonly commitMessageSubject: string;
  /** Number of files changed */
  readonly fileCount: number;
  /** Lines added in this commit */
  readonly linesAdded: number;
  /** Lines removed in this commit */
  readonly linesRemoved: number;
  /** Author's full name (from commit_contributors) */
  readonly fullName: string | null;
  /** Author's team (from commit_contributors) */
  readonly team: string | null;

  // Conventional commit analysis

  /** Whether the commit follows conventional commit format */
  readonly hasConventionalPrefix: boolean;
  /** The conventional commit type (feat, fix, etc.) or null */
  readonly commitType: ConventionalCommitType | null;
  /** Whether a scope is present: feat(scope): */
  readonly hasScope: boolean;
  /** The scope value if present */
  readonly scope: string | null;
  /** Whether this is a breaking change (! or BREAKING CHANGE:) */
  readonly isBreakingChange: boolean;
  /** Whether the commit has a body (multi-line message) */
  readonly hasBody: boolean;
  /** Length of the subject line in characters */
  readonly subjectLength: number;
  /** Whether subject starts with capital letter */
  readonly hasProperCapitalization: boolean;
  /** Whether subject does NOT end with period (good) */
  readonly noTrailingPeriod: boolean;
  /** Total number of lines in the commit message */
  readonly messageLineCount: number;

  // Individual scores

  /** Score for conventional prefix (0 or 30) */
  readonly prefixScore: number;
  /** Score for subject length (0-20) */
  readonly lengthScore: number;
  /** Score for proper capitalization (0 or 10) */
  readonly capitalizationScore: number;
  /** Score for no trailing period (0 or 5) */
  readonly periodScore: number;
  /** Score for having a scope (0 or 10) */
  readonly scopeScore: number;
  /** Score for having a body (0 or 15) */
  readonly bodyScore: number;
  /** Bonus score for breaking change notation (0 or 10) */
  readonly breakingChangeScore: number;

  // Aggregate metrics

  /** Total hygiene score (0-100) */
  readonly hygieneScore: number;
  /** Quality tier based on hygiene score */
  readonly qualityTier: QualityTier;

  // Linked tickets

  /** Linked Jira ticket ID if any */
  readonly jiraTicketId: string | null;
  /** Linked Linear ticket ID if any */
  readonly linearTicketId: string | null;
}

// ============================================================================
// Author Hygiene Summary
// ============================================================================

/**
 * Aggregated hygiene metrics by author.
 * Sourced from the vw_commit_hygiene_by_author database view.
 */
export interface AuthorHygieneSummary {
  /** Git author login/username */
  readonly author: string;
  /** Author's full name */
  readonly fullName: string | null;
  /** Author's team */
  readonly team: string | null;
  /** Repository name */
  readonly repository: string;

  // Commit counts

  /** Total number of commits */
  readonly totalCommits: number;
  /** Number of commits with conventional prefix */
  readonly conventionalCommits: number;
  /** Number of commits with scope */
  readonly scopedCommits: number;
  /** Number of commits with body */
  readonly commitsWithBody: number;
  /** Number of breaking changes */
  readonly breakingChanges: number;

  // Quality tier distribution

  /** Number of excellent quality commits */
  readonly excellentCount: number;
  /** Number of good quality commits */
  readonly goodCount: number;
  /** Number of fair quality commits */
  readonly fairCount: number;
  /** Number of poor quality commits */
  readonly poorCount: number;

  // Commit type distribution

  /** Number of feat commits */
  readonly featCount: number;
  /** Number of fix commits */
  readonly fixCount: number;
  /** Number of docs commits */
  readonly docsCount: number;
  /** Number of refactor commits */
  readonly refactorCount: number;
  /** Number of test commits */
  readonly testCount: number;
  /** Number of chore commits */
  readonly choreCount: number;
  /** Number of other type commits */
  readonly otherCount: number;

  // Average metrics

  /** Average hygiene score (0-100) */
  readonly avgHygieneScore: number;
  /** Average subject line length */
  readonly avgSubjectLength: number;

  // Percentage metrics

  /** Percentage of commits with conventional prefix */
  readonly conventionalPct: number;
  /** Percentage of good or excellent commits */
  readonly goodOrBetterPct: number;
}

// ============================================================================
// Weekly Hygiene Trend
// ============================================================================

/**
 * Weekly hygiene trend data point.
 * Sourced from the vw_commit_hygiene_weekly database view.
 */
export interface WeeklyHygieneTrend {
  /** Week start date as ISO date string */
  readonly week: string;
  /** Repository name */
  readonly repository: string;

  // Commit counts

  /** Total number of commits in the week */
  readonly totalCommits: number;
  /** Number of conventional commits */
  readonly conventionalCommits: number;

  // Quality tier distribution

  /** Number of excellent quality commits */
  readonly excellentCount: number;
  /** Number of good quality commits */
  readonly goodCount: number;
  /** Number of fair quality commits */
  readonly fairCount: number;
  /** Number of poor quality commits */
  readonly poorCount: number;

  // Commit type distribution

  /** Number of feat commits */
  readonly featCount: number;
  /** Number of fix commits */
  readonly fixCount: number;
  /** Number of other type commits */
  readonly otherTypeCount: number;

  // Metrics

  /** Average hygiene score for the week */
  readonly avgHygieneScore: number;
  /** Percentage of conventional commits */
  readonly conventionalPct: number;
  /** Percentage of good or excellent commits */
  readonly goodOrBetterPct: number;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Commit Hygiene dashboard commit data.
 */
export interface CommitHygieneData {
  /** Array of commit hygiene records, ordered by date descending */
  readonly commits: readonly CommitHygiene[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_commit_hygiene view exists */
  readonly viewExists: boolean;
}

/**
 * Complete response for author summary data.
 */
export interface AuthorHygieneSummaryData {
  /** Array of author hygiene summaries */
  readonly summaries: readonly AuthorHygieneSummary[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_commit_hygiene_by_author view exists */
  readonly viewExists: boolean;
}

/**
 * Complete response for weekly trend data.
 */
export interface WeeklyHygieneTrendData {
  /** Array of weekly trend data points */
  readonly trends: readonly WeeklyHygieneTrend[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_commit_hygiene_weekly view exists */
  readonly viewExists: boolean;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for Commit Hygiene queries.
 * All filters are optional and combined with AND logic.
 */
export interface CommitHygieneFilters {
  /** Start date for date range filter (ISO date string YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string YYYY-MM-DD) */
  readonly endDate?: string;
  /** Filter by repository name */
  readonly repository?: string;
  /** Filter by branch name */
  readonly branch?: string;
  /** Filter by quality tier */
  readonly qualityTier?: QualityTier;
  /** Filter by commit type */
  readonly commitType?: ConventionalCommitType;
  /** Filter by author */
  readonly author?: string;
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
export const COMMIT_HYGIENE_MAX_FILTER_LENGTH = 200;

/**
 * Maximum number of commit result rows returned to prevent memory exhaustion.
 */
export const COMMIT_HYGIENE_MAX_COMMIT_ROWS = 500;

/**
 * Maximum number of author summary rows returned.
 */
export const COMMIT_HYGIENE_MAX_AUTHOR_ROWS = 200;

/**
 * Maximum number of weekly trend rows returned.
 */
export const COMMIT_HYGIENE_MAX_WEEKLY_ROWS = 100;

/**
 * Valid quality tier values for input validation.
 */
export const VALID_QUALITY_TIERS: readonly QualityTier[] = [
  'excellent',
  'good',
  'fair',
  'poor',
];

/**
 * Valid conventional commit types for input validation.
 */
export const VALID_COMMIT_TYPES: readonly ConventionalCommitType[] = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'test',
  'chore',
  'build',
  'ci',
  'perf',
  'revert',
];
