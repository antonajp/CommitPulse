/**
 * Type definitions for the Developer Profile Dashboard.
 * Separated from the data service for better modularity and
 * to keep the service file under 600 lines.
 *
 * Ticket: GITX-155, GITX-156, GITX-179
 */

/**
 * Summary statistics for a developer.
 * GITX-179: Added avgLocPerPeriod and avgStoryPointsPerPeriod for averages per week/month.
 * GITX-219: Added team average comparisons for KPI cards.
 */
export interface DevProfileSummary {
  readonly totalCommits: number;
  readonly totalLoc: number;
  readonly avgComplexity: number;
  readonly repositoriesWorkedOn: number;
  /** Average LOC per week (timeframe < 365 days) or month (timeframe >= 365 days). GITX-179 */
  readonly avgLocPerPeriod: number;
  /** Average story points per week/month. Null if no Jira/Linear data. GITX-179 */
  readonly avgStoryPointsPerPeriod: number | null;
  /** Aggregation period: 'week' for < 365 days, 'month' for >= 365 days. GITX-179 */
  readonly aggregationPeriod: 'week' | 'month';

  // GITX-219: Team average comparisons
  /** Team average commits in the timeframe. Null if developer not assigned to a team. */
  readonly teamAvgCommits: number | null;
  /** Team average LOC in the timeframe. Null if developer not assigned to a team. */
  readonly teamAvgLoc: number | null;
  /** Team average LOC per period. Null if developer not assigned to a team. */
  readonly teamAvgLocPerPeriod: number | null;
  /** Team average story points per period. Null if no team or no Jira/Linear data. */
  readonly teamAvgStoryPointsPerPeriod: number | null;
  /** Team average complexity. Null if developer not assigned to a team. */
  readonly teamAvgComplexity: number | null;
  /** Team average repositories count. Null if developer not assigned to a team. */
  readonly teamAvgRepos: number | null;
}

/**
 * LOC per period data point for stacked bar chart.
 * GITX-179: Can represent weekly or monthly data depending on timeframe.
 */
export interface DevProfileLocWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly repository: string;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly netLines: number;
}

/**
 * Complex file data point.
 */
export interface DevProfileComplexFile {
  readonly filePath: string;
  readonly complexityScore: number;
  readonly repository: string;
  readonly lastModified: string;
}

/**
 * Frequently modified file data point.
 * GITX-179: Replaced repository with lastModified date.
 */
export interface DevProfileFrequentFile {
  readonly filePath: string;
  readonly modificationCount: number;
  readonly totalLocChanged: number;
  /** Last modified date in YYYY-MM-DD format. GITX-179 */
  readonly lastModified: string;
}

/**
 * Technology stack contribution data point for doughnut chart.
 * Ticket: GITX-156
 */
export interface DevProfileTechStack {
  readonly category: string;
  readonly locCount: number;
  readonly percentage: number;
  readonly repository: string;
}

/**
 * Technology stack by file extension data point for doughnut chart.
 * GITX-214: Aggregates LOC by file extension (e.g., .ts, .py, .md).
 */
export interface DevProfileTechStackByExtension {
  readonly extension: string;
  readonly locCount: number;
  readonly percentage: number;
  readonly repository: string;
}

/**
 * Comments per period data point for line chart.
 * Ticket: GITX-156, GITX-179
 * GITX-179: Can represent weekly or monthly data depending on timeframe.
 */
export interface DevProfileCommentsWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly commentsAdded: number;
}

/**
 * Tests per period data point for line chart.
 * Ticket: GITX-156, GITX-179
 * GITX-179: Can represent weekly or monthly data depending on timeframe.
 */
export interface DevProfileTestsWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly testFilesModified: number;
  readonly testLinesAdded: number;
}

/**
 * Commit hygiene score breakdown.
 * Ticket: GITX-156
 */
export interface DevProfileHygieneScore {
  readonly overallScore: number; // 0-100
  readonly jiraRefPercentage: number;
  readonly meaningfulMsgPercentage: number;
  readonly nonMergePercentage: number;
  readonly totalCommits: number;
  readonly qualityTier: 'excellent' | 'good' | 'fair' | 'poor';
}

/**
 * Developer option for dropdown.
 */
export interface DevProfileDeveloper {
  readonly login: string;
  readonly fullName: string | null;
  readonly commitCount: number;
}

/**
 * Timeframe preset option.
 */
export type DevProfileTimeframe = '30' | '60' | '90' | '180' | '365' | '730';

/**
 * Filters for developer profile queries.
 */
export interface DevProfileFilters {
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Sprint velocity vs LOC data point for dual-axis chart.
 * Correlates story points completed with lines of code committed per period.
 * Ticket: GITX-157, GITX-179, GITX-199
 * GITX-179: Can represent weekly or monthly data depending on timeframe.
 * GITX-199: Added teamStoryPoints for stacked bar visualization showing developer
 * contribution against team total.
 */
export interface DevProfileVelocityPoint {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly storyPoints: number; // Story points from Linear/Jira (developer's contribution)
  readonly teamStoryPoints: number; // Total team story points for the period (GITX-199)
  readonly linesOfCode: number; // Lines of code committed
  readonly issueCount: number; // Number of issues completed
  readonly commitCount: number; // Number of commits
}

/**
 * Test debt data point per period for stacked bar chart.
 * Shows commits by test coverage tier (low/medium/high).
 * Ticket: GITX-172, GITX-179
 * GITX-179: Can represent weekly or monthly data depending on timeframe.
 */
export interface DevProfileTestDebtWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly lowTestCommits: number; // test_ratio NULL or < 0.1
  readonly mediumTestCommits: number; // test_ratio 0.1 - 0.5
  readonly highTestCommits: number; // test_ratio >= 0.5
  readonly totalCommits: number;
}

/**
 * Test debt metrics summary with ROI calculation.
 * Ticket: GITX-172
 */
export interface DevProfileTestDebtMetrics {
  /** Weekly breakdown for stacked bar chart */
  readonly weeklyData: readonly DevProfileTestDebtWeekly[];
  /** Bug rate for low test commits */
  readonly lowTestBugRate: number;
  /** Bug rate for high test commits */
  readonly highTestBugRate: number;
  /** ROI multiplier (lowTestBugRate / highTestBugRate), e.g., 2.4 = "2.4x more bugs" */
  readonly roiMultiplier: number;
  /** Total commits analyzed */
  readonly totalCommits: number;
  /** Low test commits count */
  readonly lowTestCommits: number;
  /** Team average ROI for comparison (null if not available) */
  readonly teamAvgRoiMultiplier: number | null;
}
