/**
 * TypeScript interfaces for the Test Debt Predictor Dashboard data shapes.
 * Defines the data model for test coverage analysis and bug correlation,
 * helping teams identify which untested changes are likely to cause bugs.
 *
 * Test Debt Tiers:
 *   - Low test: test ratio NULL or < 0.1 (no tests or minimal)
 *   - Medium test: test ratio 0.1 - 0.5
 *   - High test: test ratio >= 0.5 (good test coverage)
 *
 * Ticket: IQS-913
 */

// ============================================================================
// Test Coverage Tier
// ============================================================================

/**
 * Test coverage tier based on test ratio thresholds.
 *   - low: ratio < 0.1 or NULL (high risk)
 *   - medium: ratio 0.1 - 0.5 (moderate risk)
 *   - high: ratio >= 0.5 (low risk)
 */
export type TestCoverageTier = 'low' | 'medium' | 'high';

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter parameters for Test Debt queries.
 * All filters are optional and combined with AND logic.
 */
export interface TestDebtFilters {
  /** Start date for date range filter (ISO date string YYYY-MM-DD) */
  readonly startDate?: string;
  /** End date for date range filter (ISO date string YYYY-MM-DD) */
  readonly endDate?: string;
  /** Filter by repository name */
  readonly repository?: string;
  /** Filter by author login/username */
  readonly author?: string;
}

// ============================================================================
// Weekly Test Debt Summary
// ============================================================================

/**
 * Weekly aggregated test debt metrics for a repository.
 * Sourced from the vw_test_debt database view.
 */
export interface TestDebtWeek {
  /** Week start date as ISO date string (Monday) */
  readonly week: string;
  /** Repository name */
  readonly repository: string;
  /** Number of commits with low test coverage (ratio < 0.1 or NULL) */
  readonly lowTestCommits: number;
  /** Number of commits with medium test coverage (ratio 0.1 - 0.5) */
  readonly mediumTestCommits: number;
  /** Number of commits with high test coverage (ratio >= 0.5) */
  readonly highTestCommits: number;
  /** Total commits for the week */
  readonly totalCommits: number;
  /** Bugs correlated with low-test commits */
  readonly bugsFromLowTest: number;
  /** Bugs correlated with medium-test commits */
  readonly bugsFromMediumTest: number;
  /** Bugs correlated with high-test commits */
  readonly bugsFromHighTest: number;
  /** Total bugs for the week */
  readonly totalBugs: number;
  /** Bug rate for low-test commits (bugs per commit) */
  readonly lowTestBugRate: number;
  /** Bug rate for medium-test commits (bugs per commit) */
  readonly mediumTestBugRate: number;
  /** Bug rate for high-test commits (bugs per commit) */
  readonly highTestBugRate: number;
  /** Average test ratio for the week (may be null if no commits with tests) */
  readonly avgTestRatio: number | null;
}

// ============================================================================
// Commit Test Detail
// ============================================================================

/**
 * Detailed test coverage metrics for a single commit.
 * Sourced from the vw_commit_test_ratio view with bug correlation.
 */
export interface CommitTestDetail {
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
  /** First line of commit message */
  readonly commitMessage: string | null;
  /** Lines of production code changed (insertions + deletions) */
  readonly prodLocChanged: number;
  /** Lines of test code changed (insertions + deletions) */
  readonly testLocChanged: number;
  /** Number of production files changed */
  readonly prodFilesChanged: number;
  /** Number of test files changed */
  readonly testFilesChanged: number;
  /** Test ratio (test LOC / prod LOC), null if no prod code changed */
  readonly testRatio: number | null;
  /** Test coverage tier based on ratio */
  readonly testCoverageTier: TestCoverageTier;
  /** Number of subsequent bugs correlated with this commit */
  readonly subsequentBugs: number;
  /** Linked Jira ticket ID, if any */
  readonly jiraTicketId: string | null;
  /** Linked Linear ticket ID, if any */
  readonly linearTicketId: string | null;
}

// ============================================================================
// Chart Response Types
// ============================================================================

/**
 * Complete response for the Test Debt trend chart.
 */
export interface TestDebtTrendData {
  /** Array of weekly test debt summaries, ordered by week descending */
  readonly weeks: readonly TestDebtWeek[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_test_debt view exists */
  readonly viewExists: boolean;
}

/**
 * Complete response for the low-test commits list.
 */
export interface LowTestCommitsData {
  /** Array of commits with low test coverage, ordered by subsequent bugs descending */
  readonly commits: readonly CommitTestDetail[];
  /** Whether any data was found */
  readonly hasData: boolean;
  /** Whether the vw_commit_test_ratio view exists */
  readonly viewExists: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum allowed length for string filter values (DoS prevention).
 * CWE-20: Improper Input Validation
 */
export const TEST_DEBT_MAX_FILTER_LENGTH = 200;

/**
 * Maximum number of weekly rows returned to prevent memory exhaustion.
 */
export const TEST_DEBT_MAX_WEEKLY_ROWS = 104; // 2 years of weeks

/**
 * Maximum number of commit detail rows returned.
 */
export const TEST_DEBT_MAX_COMMIT_ROWS = 500;

/**
 * Default time window in days for test debt analysis.
 * Defaults to 90 days to focus on recent activity.
 */
export const TEST_DEBT_DEFAULT_TIME_WINDOW_DAYS = 90;

/**
 * Test ratio threshold for low coverage tier.
 * Commits with ratio < 0.1 are considered low test coverage.
 */
export const TEST_DEBT_LOW_THRESHOLD = 0.1;

/**
 * Test ratio threshold for high coverage tier.
 * Commits with ratio >= 0.5 are considered high test coverage.
 */
export const TEST_DEBT_HIGH_THRESHOLD = 0.5;

/**
 * Minimum LOC changed to be included in analysis.
 * Filters out trivial commits for meaningful correlation.
 */
export const TEST_DEBT_MIN_LOC_CHANGED = 50;

/**
 * Bug correlation window in days.
 * Bugs filed within this window after a commit are correlated.
 */
export const TEST_DEBT_BUG_CORRELATION_DAYS = 28;

/**
 * Valid test coverage tier values for input validation.
 */
export const VALID_TEST_COVERAGE_TIERS: readonly TestCoverageTier[] = ['low', 'medium', 'high'];

/**
 * Determine test coverage tier from test ratio.
 *
 * @param testRatio - The test ratio value (may be null)
 * @returns The corresponding test coverage tier
 */
export function getTestCoverageTier(testRatio: number | null): TestCoverageTier {
  if (testRatio === null || testRatio < TEST_DEBT_LOW_THRESHOLD) {
    return 'low';
  }
  if (testRatio < TEST_DEBT_HIGH_THRESHOLD) {
    return 'medium';
  }
  return 'high';
}
