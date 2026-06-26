/**
 * Type definitions for the Team Profile Dashboard.
 * Separated from the data service for better modularity and
 * to keep the service file under 600 lines.
 *
 * Ticket: GITX-185
 */

/**
 * Summary statistics for a team.
 * Aggregates all team members' metrics.
 */
export interface TeamProfileSummary {
  readonly totalCommits: number;
  readonly totalLoc: number;
  readonly avgComplexity: number;
  readonly repositoriesWorkedOn: number;
  /** Average LOC per week (timeframe < 365 days) or month (timeframe >= 365 days) */
  readonly avgLocPerPeriod: number;
  /** Average story points per week/month. Null if no Jira/Linear data */
  readonly avgStoryPointsPerPeriod: number | null;
  /** Aggregation period: 'week' for < 365 days, 'month' for >= 365 days */
  readonly aggregationPeriod: 'week' | 'month';
}

/**
 * LOC per period data point for stacked bar chart.
 * Can represent weekly or monthly data depending on timeframe.
 */
export interface TeamProfileLocWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly repository: string;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly netLines: number;
}

/**
 * Complex file data point.
 * Shows most complex files touched by any team member.
 */
export interface TeamProfileComplexFile {
  readonly filePath: string;
  readonly complexityScore: number;
  readonly repository: string;
  readonly lastModified: string;
}

/**
 * Frequently modified file data point.
 * Aggregates modifications across all team members.
 */
export interface TeamProfileFrequentFile {
  readonly filePath: string;
  readonly modificationCount: number;
  readonly totalLocChanged: number;
  /** Last modified date in YYYY-MM-DD format */
  readonly lastModified: string;
}

/**
 * Technology stack contribution data point for doughnut chart.
 * Aggregates LOC by technology category across team.
 */
export interface TeamProfileTechStack {
  readonly category: string;
  readonly repository: string;
  readonly locCount: number;
  readonly percentage: number;
}

/**
 * Comments per period data point for line chart.
 * Can represent weekly or monthly data depending on timeframe.
 */
export interface TeamProfileCommentsWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly commentsAdded: number;
}

/**
 * Tests per period data point for line chart.
 * Can represent weekly or monthly data depending on timeframe.
 */
export interface TeamProfileTestsWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly testFilesModified: number;
  readonly testLinesAdded: number;
}

/**
 * Commit hygiene score breakdown for the team.
 * Average across all team members.
 */
export interface TeamProfileHygieneScore {
  readonly overallScore: number; // 0-100
  readonly jiraRefPercentage: number;
  readonly meaningfulMsgPercentage: number;
  readonly nonMergePercentage: number;
  readonly totalCommits: number;
  readonly qualityTier: 'excellent' | 'good' | 'fair' | 'poor';
}

/**
 * Team option for dropdown selector.
 * Shows team name and aggregate member count.
 */
export interface TeamProfileTeam {
  readonly team: string;
  readonly memberCount: number;
  readonly totalCommits: number;
}

/**
 * Timeframe preset option.
 * Same as Developer Profile for consistency.
 */
export type TeamProfileTimeframe = '30' | '60' | '90' | '180' | '365' | '730';

/**
 * Filters for team profile queries.
 */
export interface TeamProfileFilters {
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Sprint velocity vs LOC data point for dual-axis chart.
 * Aggregates all team members' story points and LOC per period.
 * Can represent weekly or monthly data depending on timeframe.
 */
export interface TeamProfileVelocityPoint {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly storyPoints: number; // Story points from Linear/Jira
  readonly linesOfCode: number; // Lines of code committed
  readonly issueCount: number; // Number of issues completed
  readonly commitCount: number; // Number of commits
}

/**
 * Test debt data point per period for stacked bar chart.
 * Shows commits by test coverage tier (low/medium/high) for the team.
 */
export interface TeamProfileTestDebtWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly lowTestCommits: number; // test_ratio NULL or < 0.1
  readonly mediumTestCommits: number; // test_ratio 0.1 - 0.5
  readonly highTestCommits: number; // test_ratio >= 0.5
  readonly totalCommits: number;
}

/**
 * Test debt metrics summary with ROI calculation for the team.
 */
export interface TeamProfileTestDebtMetrics {
  /** Weekly breakdown for stacked bar chart */
  readonly weeklyData: readonly TeamProfileTestDebtWeekly[];
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
  /** Organization average ROI for comparison (null if not available) */
  readonly orgAvgRoiMultiplier: number | null;
}
