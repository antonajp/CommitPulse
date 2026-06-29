/**
 * Type definitions for the Organization Profile Dashboard.
 * Separated from the data service for better modularity and
 * to keep the service file under 600 lines.
 *
 * Ticket: GITX-204
 */

// ============================================================================
// Core Entity Types
// ============================================================================

/**
 * Organization entity with team and contributor counts.
 */
export interface Organization {
  readonly id: number;
  readonly name: string;
  readonly teamCount: number;
  readonly contributorCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Team entity with optional organization assignment.
 */
export interface Team {
  readonly id: number;
  readonly name: string;
  readonly organizationId: number | null;
  readonly organizationName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ============================================================================
// Summary and Metric Types
// ============================================================================

/**
 * Summary statistics for an organization.
 * Aggregates all team members' metrics.
 * GITX-206: Added avgComplexity, avgStoryPointsPerPeriod, repositoriesWorkedOn for KPI cards.
 */
export interface OrgProfileSummary {
  readonly organizationId: number;
  readonly organizationName: string;
  readonly teamCount: number;
  readonly contributorCount: number;
  readonly totalCommits: number;
  readonly totalLoc: number;
  /** Average complexity across all files touched by organization teams */
  readonly avgComplexity: number;
  /** Average LOC per week (timeframe <= 365 days) or month (timeframe > 365 days) */
  readonly avgLocPerPeriod: number;
  /** Average story points per week/month. Null if no Jira/Linear data */
  readonly avgStoryPointsPerPeriod: number | null;
  /** Aggregation period: 'week' for <= 365 days, 'month' for > 365 days */
  readonly aggregationPeriod: 'week' | 'month';
  /** Number of distinct repositories worked on by organization members */
  readonly repositoriesWorkedOn: number;
}

/**
 * LOC per period data point for stacked bar chart.
 * Can represent weekly or monthly data depending on timeframe.
 */
export interface OrgProfileLocWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly linesAdded: number;
  readonly linesDeleted: number;
  readonly netLines: number;
  readonly commitCount: number;
}

/**
 * LOC by repository per period data point for stacked bar chart.
 * GITX-207: Used for Lines of Code stacked bar chart by repository.
 */
export interface OrgProfileLocByRepository {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly repository: string;
  readonly linesAdded: number;
}

/**
 * Complex file data point with team breakdown.
 * Shows most complex files touched by organization teams.
 */
export interface OrgProfileComplexFile {
  readonly filename: string;
  readonly complexity: number;
  readonly teamName: string;
  readonly loc: number;
  readonly percentage: number;
}

/**
 * Frequently modified file data point with team breakdown.
 * Aggregates modifications across all organization teams.
 */
export interface OrgProfileFrequentFile {
  readonly filename: string;
  readonly totalChurn: number;
  readonly teamName: string;
  readonly churn: number;
  readonly percentage: number;
}

/**
 * Technology stack contribution data point for doughnut chart.
 * Aggregates LOC by technology category across organization.
 */
export interface OrgProfileTechStack {
  readonly category: string;
  readonly repository: string;
  readonly locCount: number;
  readonly percentage: number;
}

/**
 * Technology stack by file extension data point for doughnut chart.
 * GITX-214: Aggregates LOC by file extension (e.g., .ts, .py, .md).
 */
export interface OrgProfileTechStackByExtension {
  readonly extension: string;
  readonly repository: string;
  readonly locCount: number;
  readonly percentage: number;
}

/**
 * Comments per period data point for line chart.
 * Can represent weekly or monthly data depending on timeframe.
 */
export interface OrgProfileCommentsWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly commentLinesAdded: number;
  readonly totalFiles: number;
}

/**
 * Tests per period data point for line chart.
 * Can represent weekly or monthly data depending on timeframe.
 */
export interface OrgProfileTestsWeekly {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly testFilesModified: number;
  readonly testLinesAdded: number;
}

/**
 * Commit hygiene score breakdown for the organization.
 * Average across all organization teams.
 */
export interface OrgProfileHygieneScore {
  readonly avgHygieneScore: number; // 0-100
  readonly totalCommits: number;
  readonly conventionalCommits: number;
  readonly conventionalPct: number;
  // GITX-216: Enhanced hygiene metrics matching Developer Profile
  readonly qualityTier: string; // 'excellent' | 'good' | 'fair' | 'poor'
  readonly jiraRefPercentage: number; // % commits with Jira reference
  readonly meaningfulMsgPercentage: number; // % commits with proper length/capitalization
  readonly nonMergePercentage: number; // % non-merge commits (always 100 since we filter merges)
}

/**
 * Sprint velocity vs LOC data point for dual-axis chart.
 * Aggregates all organization teams' story points and LOC per period.
 */
export interface OrgProfileVelocityPoint {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly storyPoints: number; // Story points from Linear/Jira
  readonly linesOfCode: number; // Lines of code committed
  readonly issueCount: number; // Number of issues completed
  readonly commitCount: number; // Number of commits
}

/**
 * Team contribution to sprint velocity for a given period.
 * GITX-201: Used for team-colored stacked bar chart.
 */
export interface OrgVelocityTeamContribution {
  readonly teamName: string;
  readonly storyPoints: number;
  readonly issueCount: number;
}

/**
 * Sprint velocity with team-colored breakdown for stacked bar chart.
 * GITX-201: Replaces OrgProfileVelocityPoint with team-level granularity.
 */
export interface OrgProfileVelocityWithTeams {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly totalStoryPoints: number; // Total story points from all teams
  readonly linesOfCode: number; // Lines of code committed
  readonly issueCount: number; // Total number of issues completed
  readonly commitCount: number; // Number of commits
  readonly teamContributions: readonly OrgVelocityTeamContribution[]; // Per-team breakdown
}

/**
 * LOC by team per period data point for team-colored line chart.
 * GITX-201: Shows each team's LOC as a separate colored line.
 */
export interface OrgProfileLocByTeam {
  readonly weekStart: string; // YYYY-MM-DD (start of week or month)
  readonly teamName: string;
  readonly linesAdded: number;
}

// ============================================================================
// Hot Spots and Knowledge Concentration Types
// ============================================================================

/**
 * Risk tier categories for hot spots.
 */
export type OrgHotSpotRiskTier = 'critical' | 'high' | 'medium' | 'low';

/**
 * Hot spot data point for bubble chart visualization.
 */
export interface OrgProfileHotSpot {
  /** File path relative to repository root */
  readonly filePath: string;
  /** Repository name */
  readonly repository: string;
  /** Team that owns this file */
  readonly teamName: string;
  /** Number of distinct commits modifying this file */
  readonly churnCount: number;
  /** Current cyclomatic complexity */
  readonly complexity: number;
  /** Current lines of code */
  readonly loc: number;
  /** Normalized risk score (0-1 range, higher = more risk) */
  readonly riskScore: number;
  /** Risk tier: critical, high, medium, low */
  readonly riskTier: OrgHotSpotRiskTier;
}

/**
 * Concentration risk categories for knowledge concentration.
 */
export type OrgConcentrationRisk = 'critical' | 'high' | 'medium' | 'low';

/**
 * Knowledge concentration data point for treemap visualization.
 */
export interface OrgProfileKnowledgeConcentration {
  /** File path relative to repository root */
  readonly filePath: string;
  /** Repository name */
  readonly repository: string;
  /** Team that owns this file */
  readonly teamName: string;
  /** Total number of commits touching this file */
  readonly totalCommits: number;
  /** Number of distinct contributors */
  readonly totalContributors: number;
  /** Primary contributor with most commits */
  readonly topContributor: string;
  /** Percentage of commits by top contributor (0-100) */
  readonly topContributorPct: number;
  /** Knowledge concentration risk level */
  readonly concentrationRisk: OrgConcentrationRisk;
}

// ============================================================================
// Timeframe and Filter Types
// ============================================================================

/**
 * Timeframe preset option.
 * Same as Developer Profile for consistency.
 */
export type OrgProfileTimeframe = '30' | '60' | '90' | '180' | '365' | '730';

/**
 * Filters for organization profile queries.
 */
export interface OrgProfileFilters {
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
}

// ============================================================================
// CRUD Operation Types
// ============================================================================

/**
 * Input data for creating a new organization.
 */
export interface CreateOrganizationInput {
  readonly name: string;
}

/**
 * Input data for updating an existing organization.
 */
export interface UpdateOrganizationInput {
  readonly name: string;
}

/**
 * Input data for assigning a team to an organization.
 */
export interface AssignTeamInput {
  readonly teamId: number;
  readonly organizationId: number;
}

// ============================================================================
// Data Coverage Types - GITX-210
// ============================================================================

/**
 * Data status for a single team within an organization.
 * GITX-210: Used in the partial data coverage warning banner.
 */
export interface OrgTeamDataStatus {
  /** Team ID */
  readonly teamId: number;
  /** Team name */
  readonly teamName: string;
  /** Number of commits in the selected timeframe */
  readonly commitCount: number;
  /** Whether the team has any Jira data in the timeframe */
  readonly hasJiraData: boolean;
  /** Whether the team has any data (commitCount > 0) */
  readonly hasData: boolean;
}

/**
 * Overall data coverage summary for an organization.
 * GITX-210: Aggregated view of which teams have data.
 */
export interface OrgDataCoverage {
  /** Total number of teams in the organization */
  readonly totalTeams: number;
  /** Number of teams with at least one commit in the timeframe */
  readonly teamsWithData: number;
  /** Number of teams with Jira data in the timeframe */
  readonly teamsWithJiraData: number;
  /** Whether data is partial (teamsWithData < totalTeams) */
  readonly isPartial: boolean;
  /** Whether Jira data is partial (teamsWithJiraData < totalTeams) */
  readonly isJiraPartial: boolean;
  /** Individual team data status for expandable details */
  readonly teamStatus: readonly OrgTeamDataStatus[];
}
