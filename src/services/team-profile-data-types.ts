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
 * GITX-220: Organization-wide team averages for KPI comparison.
 * Each metric represents the average across all teams in the same organization.
 * Displayed in lighter/grayer styling beside the focal team's primary value.
 */
export interface TeamProfileOrgAverages {
  /** Average total commits across all org teams in the timeframe */
  readonly orgAvgTotalCommits: number;
  /** Average total LOC across all org teams in the timeframe */
  readonly orgAvgTotalLoc: number;
  /** Average LOC per period across all org teams */
  readonly orgAvgLocPerPeriod: number;
  /** Average story points per period across all org teams (null if no SP data) */
  readonly orgAvgSpPerPeriod: number | null;
  /** Average complexity across all org teams */
  readonly orgAvgComplexity: number;
  /** Average repository count across all org teams */
  readonly orgAvgReposCount: number;
  /** Organization ID (null if team has no organization) */
  readonly organizationId: number | null;
  /** Organization name (null if team has no organization) */
  readonly organizationName: string | null;
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
 * Technology stack by file extension data point for doughnut chart.
 * GITX-214: Aggregates LOC by file extension (e.g., .ts, .py, .md).
 */
export interface TeamProfileTechStackByExtension {
  readonly extension: string;
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
 * GITX-200: Per-member story point contribution for stacked velocity chart.
 * Used for displaying stacked bars where each segment represents a team member's contribution.
 */
export interface TeamMemberVelocityContribution {
  /** Team member display name */
  readonly memberName: string;
  /** Story points completed by this member in the period */
  readonly storyPoints: number;
  /** Percentage of team total for this period */
  readonly percentage: number;
}

/**
 * GITX-200: Sprint velocity data with per-member breakdown for stacked bar chart.
 * Enables color-coded member contribution visualization on Team Profile.
 */
export interface TeamProfileVelocityWithMembers {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly totalStoryPoints: number; // Team total story points
  readonly linesOfCode: number; // Team total LOC
  readonly memberContributions: readonly TeamMemberVelocityContribution[];
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

/**
 * Per-author contribution to a file.
 * GITX-186: Used for horizontal stacked bar chart segments.
 */
export interface TeamProfileAuthorContribution {
  readonly authorName: string;
  readonly loc: number;
  readonly percentage: number;
}

// ============================================================================
// GITX-188: Hot Spots and Knowledge Concentration for Team Profile
// ============================================================================

/**
 * Risk tier categories for hot spots (same as global hot spots).
 * GITX-188: Reused for team-filtered hot spots.
 */
export type TeamHotSpotRiskTier = 'critical' | 'high' | 'medium' | 'low';

/**
 * Hot spot data point filtered by team members.
 * GITX-188: Used for bubble chart visualization.
 */
export interface TeamProfileHotSpot {
  /** File path relative to repository root */
  readonly filePath: string;
  /** Repository name */
  readonly repository: string;
  /** Number of distinct commits modifying this file by team members */
  readonly churnCount: number;
  /** Current cyclomatic complexity (most recent value) */
  readonly complexity: number;
  /** Current lines of code (most recent value) */
  readonly loc: number;
  /** Normalized risk score (0-1 range, higher = more risk) */
  readonly riskScore: number;
  /** Risk tier: critical, high, medium, low */
  readonly riskTier: TeamHotSpotRiskTier;
}

/**
 * Concentration risk categories for knowledge concentration.
 * GITX-188: Reused for team-filtered knowledge concentration.
 */
export type TeamConcentrationRisk = 'critical' | 'high' | 'medium' | 'low';

/**
 * Knowledge concentration data point filtered by team members.
 * GITX-188: Used for treemap visualization.
 */
export interface TeamProfileKnowledgeConcentration {
  /** File path relative to repository root */
  readonly filePath: string;
  /** Repository name */
  readonly repository: string;
  /** Total number of commits touching this file by team members */
  readonly totalCommits: number;
  /** Number of distinct team member contributors to this file */
  readonly totalContributors: number;
  /** Primary contributor with most commits */
  readonly topContributor: string;
  /** Percentage of commits by top contributor (0-100) */
  readonly topContributorPct: number;
  /** Knowledge concentration risk level */
  readonly concentrationRisk: TeamConcentrationRisk;
}

/**
 * Complex file with per-author contribution breakdown.
 * GITX-186: For horizontal stacked bar chart visualization.
 */
export interface TeamProfileComplexFileWithContributors {
  readonly filePath: string;
  readonly totalComplexity: number;
  readonly totalLoc: number;
  readonly repository: string;
  readonly lastModified: string;
  readonly authorContributions: readonly TeamProfileAuthorContribution[];
}

/**
 * Frequently modified file with per-author contribution breakdown.
 * GITX-186: For horizontal stacked bar chart visualization.
 */
export interface TeamProfileFrequentFileWithContributors {
  readonly filePath: string;
  readonly totalModifications: number;
  readonly totalLocChanged: number;
  readonly repository: string;
  readonly lastModified: string;
  readonly authorContributions: readonly TeamProfileAuthorContribution[];
}
