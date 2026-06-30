/**
 * Message protocol types for communication between the extension host
 * and the Team Profile Dashboard webview.
 *
 * Messages flow in two directions:
 * - TeamProfileWebviewToHost: Messages sent from the webview to the extension
 * - TeamProfileHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: GITX-185
 */

import type {
  TeamProfileSummary,
  TeamProfileLocWeekly,
  TeamProfileComplexFile,
  TeamProfileFrequentFile,
  TeamProfileTeam,
  TeamProfileTimeframe,
  TeamProfileTechStack,
  TeamProfileTechStackByExtension,
  TeamProfileCommentsWeekly,
  TeamProfileTestsWeekly,
  TeamProfileHygieneScore,
  TeamProfileVelocityPoint,
  TeamProfileVelocityWithMembers,
  TeamProfileComplexFileWithContributors,
  TeamProfileFrequentFileWithContributors,
  TeamProfileHotSpot,
  TeamProfileKnowledgeConcentration,
  TeamProfileOrgAverages,
} from '../../services/team-profile-data-types.js';

// Re-export types for convenience
export type {
  TeamProfileSummary,
  TeamProfileLocWeekly,
  TeamProfileComplexFile,
  TeamProfileFrequentFile,
  TeamProfileTeam,
  TeamProfileTimeframe,
  TeamProfileTechStack,
  TeamProfileTechStackByExtension,
  TeamProfileCommentsWeekly,
  TeamProfileTestsWeekly,
  TeamProfileHygieneScore,
  TeamProfileVelocityPoint,
  TeamProfileVelocityWithMembers,
  TeamProfileComplexFileWithContributors,
  TeamProfileFrequentFileWithContributors,
  TeamProfileHotSpot,
  TeamProfileKnowledgeConcentration,
  TeamProfileOrgAverages,
} from '../../services/team-profile-data-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load the list of teams for the dropdown.
 */
export interface RequestTeams {
  readonly type: 'requestTeams';
}

/**
 * Request to load summary statistics for a team.
 */
export interface RequestTeamSummary {
  readonly type: 'requestTeamSummary';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load LOC per week data for a team.
 */
export interface RequestTeamLocPerWeek {
  readonly type: 'requestTeamLocPerWeek';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load top complex files for a team.
 */
export interface RequestTeamTopComplexFiles {
  readonly type: 'requestTeamTopComplexFiles';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load top frequent files for a team.
 */
export interface RequestTeamTopFrequentFiles {
  readonly type: 'requestTeamTopFrequentFiles';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to open a file in the editor.
 */
export interface RequestOpenFile {
  readonly type: 'openFile';
  readonly filePath: string;
  readonly repository: string;
}

/**
 * Request to load all data for a team.
 */
export interface RequestTeamAllData {
  readonly type: 'requestTeamAllData';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load technology stack data for a team.
 * Ticket: GITX-185
 */
export interface RequestTeamTechStack {
  readonly type: 'requestTeamTechStack';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load technology stack by file extension for a team.
 * GITX-214: File Extensions view for Technology Stack toggle.
 */
export interface RequestTeamTechStackByExtension {
  readonly type: 'requestTeamTechStackByExtension';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load comments per week data for a team.
 * Ticket: GITX-185
 */
export interface RequestTeamCommentsPerWeek {
  readonly type: 'requestTeamCommentsPerWeek';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load tests per week data for a team.
 * Ticket: GITX-185
 */
export interface RequestTeamTestsPerWeek {
  readonly type: 'requestTeamTestsPerWeek';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load hygiene score data for a team.
 * Ticket: GITX-185
 */
export interface RequestTeamHygieneScore {
  readonly type: 'requestTeamHygieneScore';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load velocity vs LOC data for a team.
 * Ticket: GITX-185
 */
export interface RequestTeamVelocityVsLoc {
  readonly type: 'requestTeamVelocityVsLoc';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to check if velocity data is available for a team.
 * Ticket: GITX-185
 */
export interface RequestTeamHasVelocityData {
  readonly type: 'requestTeamHasVelocityData';
  readonly team: string;
}

/**
 * Request to load top complex files with per-author contributions for chart.
 * GITX-186: Horizontal stacked bar chart with per-member contribution coloring.
 */
export interface RequestTeamComplexFilesChart {
  readonly type: 'requestTeamComplexFilesChart';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load top frequent files with per-author contributions for chart.
 * GITX-186: Horizontal stacked bar chart with per-member contribution coloring.
 */
export interface RequestTeamFrequentFilesChart {
  readonly type: 'requestTeamFrequentFilesChart';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load hot spots for a team.
 * GITX-188: Bubble chart filtered by team members.
 */
export interface RequestTeamHotSpots {
  readonly type: 'requestTeamHotSpots';
  readonly team: string;
}

/**
 * Request to load knowledge concentration for a team.
 * GITX-188: Treemap filtered by team members.
 */
export interface RequestTeamKnowledgeConcentration {
  readonly type: 'requestTeamKnowledgeConcentration';
  readonly team: string;
}

/**
 * Request to load velocity with member breakdown for stacked bar chart.
 * GITX-200: Sprint Velocity chart with member colors on Team Profile.
 */
export interface RequestTeamVelocityWithMembers {
  readonly type: 'requestTeamVelocityWithMembers';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Request to load organization-wide team averages for KPI comparison.
 * GITX-220: Displayed beside focal KPI values in lighter styling.
 */
export interface RequestTeamOrgAverages {
  readonly type: 'requestTeamOrgAverages';
  readonly team: string;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type TeamProfileWebviewToHost =
  | RequestTeams
  | RequestTeamSummary
  | RequestTeamLocPerWeek
  | RequestTeamTopComplexFiles
  | RequestTeamTopFrequentFiles
  | RequestOpenFile
  | RequestTeamAllData
  | RequestTeamTechStack
  | RequestTeamTechStackByExtension
  | RequestTeamCommentsPerWeek
  | RequestTeamTestsPerWeek
  | RequestTeamHygieneScore
  | RequestTeamVelocityVsLoc
  | RequestTeamHasVelocityData
  | RequestTeamVelocityWithMembers
  | RequestTeamComplexFilesChart
  | RequestTeamFrequentFilesChart
  | RequestTeamHotSpots
  | RequestTeamKnowledgeConcentration
  | RequestTeamOrgAverages;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with team list for dropdown.
 */
export interface ResponseTeams {
  readonly type: 'teamsData';
  readonly data: readonly TeamProfileTeam[];
}

/**
 * Response with summary statistics for a team.
 */
export interface ResponseTeamSummary {
  readonly type: 'teamSummaryData';
  readonly data: TeamProfileSummary;
}

/**
 * Response with LOC per week data for a team.
 */
export interface ResponseTeamLocPerWeek {
  readonly type: 'teamLocPerWeekData';
  readonly data: readonly TeamProfileLocWeekly[];
}

/**
 * Response with top complex files for a team.
 */
export interface ResponseTeamTopComplexFiles {
  readonly type: 'teamTopComplexFilesData';
  readonly data: readonly TeamProfileComplexFile[];
}

/**
 * Response with top frequent files for a team.
 */
export interface ResponseTeamTopFrequentFiles {
  readonly type: 'teamTopFrequentFilesData';
  readonly data: readonly TeamProfileFrequentFile[];
}

/**
 * Error response sent when a data query fails.
 */
export interface ResponseTeamError {
  readonly type: 'error';
  readonly message: string;
  readonly source: string;
}

/**
 * Initial state message with pre-selected team.
 */
export interface ResponseTeamInitialState {
  readonly type: 'initialState';
  readonly team: string | null;
  readonly timeframeDays: TeamProfileTimeframe;
}

/**
 * Response with technology stack data for a team.
 * Ticket: GITX-185
 */
export interface ResponseTeamTechStack {
  readonly type: 'teamTechStackData';
  readonly data: readonly TeamProfileTechStack[];
}

/**
 * Response with technology stack by file extension for a team.
 * GITX-214: File Extensions view for Technology Stack toggle.
 */
export interface ResponseTeamTechStackByExtension {
  readonly type: 'teamTechStackByExtensionData';
  readonly data: readonly TeamProfileTechStackByExtension[];
}

/**
 * Response with comments per week data for a team.
 * Ticket: GITX-185
 */
export interface ResponseTeamCommentsPerWeek {
  readonly type: 'teamCommentsPerWeekData';
  readonly data: readonly TeamProfileCommentsWeekly[];
}

/**
 * Response with tests per week data for a team.
 * Ticket: GITX-185
 */
export interface ResponseTeamTestsPerWeek {
  readonly type: 'teamTestsPerWeekData';
  readonly data: readonly TeamProfileTestsWeekly[];
}

/**
 * Response with hygiene score data for a team.
 * Ticket: GITX-185
 */
export interface ResponseTeamHygieneScore {
  readonly type: 'teamHygieneScoreData';
  readonly data: TeamProfileHygieneScore;
}

/**
 * Response with velocity vs LOC data for a team.
 * Ticket: GITX-185
 */
export interface ResponseTeamVelocityVsLoc {
  readonly type: 'teamVelocityVsLocData';
  readonly data: readonly TeamProfileVelocityPoint[];
}

/**
 * Response indicating if velocity data is available for a team.
 * Ticket: GITX-185
 */
export interface ResponseTeamHasVelocityData {
  readonly type: 'teamHasVelocityData';
  readonly hasData: boolean;
}

/**
 * Response with top complex files chart data with per-author contributions.
 * GITX-186: Horizontal stacked bar chart with per-member contribution coloring.
 */
export interface ResponseTeamComplexFilesChart {
  readonly type: 'teamComplexFilesChartData';
  readonly data: readonly TeamProfileComplexFileWithContributors[];
}

/**
 * Response with top frequent files chart data with per-author contributions.
 * GITX-186: Horizontal stacked bar chart with per-member contribution coloring.
 */
export interface ResponseTeamFrequentFilesChart {
  readonly type: 'teamFrequentFilesChartData';
  readonly data: readonly TeamProfileFrequentFileWithContributors[];
}

/**
 * Response with hot spots data for a team.
 * GITX-188: Bubble chart filtered by team members.
 */
export interface ResponseTeamHotSpots {
  readonly type: 'teamHotSpotsData';
  readonly data: readonly TeamProfileHotSpot[];
}

/**
 * Response with knowledge concentration data for a team.
 * GITX-188: Treemap filtered by team members.
 */
export interface ResponseTeamKnowledgeConcentration {
  readonly type: 'teamKnowledgeConcentrationData';
  readonly data: readonly TeamProfileKnowledgeConcentration[];
}

/**
 * Response with velocity data including per-member breakdown.
 * GITX-200: Sprint Velocity chart with member colors on Team Profile.
 */
export interface ResponseTeamVelocityWithMembers {
  readonly type: 'teamVelocityWithMembersData';
  readonly data: readonly TeamProfileVelocityWithMembers[];
}

/**
 * Response with organization-wide team averages for KPI comparison.
 * GITX-220: Displayed beside focal KPI values in lighter styling.
 */
export interface ResponseTeamOrgAverages {
  readonly type: 'teamOrgAveragesData';
  readonly data: TeamProfileOrgAverages;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type TeamProfileHostToWebview =
  | ResponseTeams
  | ResponseTeamSummary
  | ResponseTeamLocPerWeek
  | ResponseTeamTopComplexFiles
  | ResponseTeamTopFrequentFiles
  | ResponseTeamInitialState
  | ResponseTeamTechStack
  | ResponseTeamTechStackByExtension
  | ResponseTeamCommentsPerWeek
  | ResponseTeamTestsPerWeek
  | ResponseTeamHygieneScore
  | ResponseTeamVelocityVsLoc
  | ResponseTeamHasVelocityData
  | ResponseTeamVelocityWithMembers
  | ResponseTeamComplexFilesChart
  | ResponseTeamFrequentFilesChart
  | ResponseTeamHotSpots
  | ResponseTeamKnowledgeConcentration
  | ResponseTeamOrgAverages
  | ResponseTeamError;
