/**
 * Type definitions for the Developer Profile Dashboard.
 * Separated from the data service for better modularity and
 * to keep the service file under 600 lines.
 *
 * Ticket: GITX-155, GITX-156
 */

/**
 * Summary statistics for a developer.
 */
export interface DevProfileSummary {
  readonly totalCommits: number;
  readonly totalLoc: number;
  readonly avgComplexity: number;
  readonly repositoriesWorkedOn: number;
}

/**
 * LOC per week data point for stacked bar chart.
 */
export interface DevProfileLocWeekly {
  readonly weekStart: string; // YYYY-MM-DD (Monday of the week)
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
 */
export interface DevProfileFrequentFile {
  readonly filePath: string;
  readonly modificationCount: number;
  readonly totalLocChanged: number;
  readonly repository: string;
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
 * Comments per week data point for line chart.
 * Ticket: GITX-156
 */
export interface DevProfileCommentsWeekly {
  readonly weekStart: string; // YYYY-MM-DD (Monday of the week)
  readonly commentsAdded: number;
}

/**
 * Tests per week data point for line chart.
 * Ticket: GITX-156
 */
export interface DevProfileTestsWeekly {
  readonly weekStart: string; // YYYY-MM-DD (Monday of the week)
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
 * Correlates story points completed with lines of code committed per week.
 * Ticket: GITX-157
 */
export interface DevProfileVelocityPoint {
  readonly weekStart: string; // YYYY-MM-DD (Monday of the week)
  readonly storyPoints: number; // Story points from Linear/Jira
  readonly linesOfCode: number; // Lines of code committed
  readonly issueCount: number; // Number of issues completed
  readonly commitCount: number; // Number of commits
}
