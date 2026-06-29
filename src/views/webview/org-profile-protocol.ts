/**
 * Message protocol types for communication between the extension host
 * and the Organization Profile Dashboard webview.
 *
 * Messages flow in two directions:
 * - OrgProfileWebviewToHost: Messages sent from the webview to the extension
 * - OrgProfileHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: GITX-204
 */

import type {
  Organization,
  Team,
  OrgProfileSummary,
  OrgProfileLocWeekly,
  OrgProfileComplexFile,
  OrgProfileFrequentFile,
  OrgProfileTechStack,
  OrgProfileTechStackByExtension,
  OrgProfileCommentsWeekly,
  OrgProfileTestsWeekly,
  OrgProfileHygieneScore,
  OrgProfileVelocityWithTeams,
  OrgProfileLocByTeam,
  OrgProfileHotSpot,
  OrgProfileKnowledgeConcentration,
  OrgProfileTimeframe,
  OrgDataCoverage,
} from '../../services/org-profile-data-types.js';

// Re-export types for convenience
export type {
  Organization,
  Team,
  OrgProfileSummary,
  OrgProfileLocWeekly,
  OrgProfileComplexFile,
  OrgProfileFrequentFile,
  OrgProfileTechStack,
  OrgProfileTechStackByExtension,
  OrgProfileCommentsWeekly,
  OrgProfileTestsWeekly,
  OrgProfileHygieneScore,
  OrgProfileVelocityWithTeams,
  OrgProfileLocByTeam,
  OrgProfileHotSpot,
  OrgProfileKnowledgeConcentration,
  OrgProfileTimeframe,
  OrgDataCoverage,
} from '../../services/org-profile-data-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load the list of organizations for the dropdown.
 */
export interface RequestOrganizations {
  readonly type: 'requestOrganizations';
}

/**
 * Request to load a single organization by ID.
 */
export interface RequestOrganizationById {
  readonly type: 'requestOrganizationById';
  readonly organizationId: number;
}

/**
 * Request to load summary statistics for an organization.
 */
export interface RequestOrgSummary {
  readonly type: 'requestOrgSummary';
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
}

/**
 * Request to load LOC per week data for an organization.
 */
export interface RequestOrgLocPerWeek {
  readonly type: 'requestOrgLocPerWeek';
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
}

/**
 * Request to load top complex files for an organization.
 */
export interface RequestOrgTopComplexFiles {
  readonly type: 'requestOrgTopComplexFiles';
  readonly organizationId: number;
}

/**
 * Request to load top frequent files for an organization.
 */
export interface RequestOrgTopFrequentFiles {
  readonly type: 'requestOrgTopFrequentFiles';
  readonly organizationId: number;
}

/**
 * Request to load technology stack data for an organization.
 */
export interface RequestOrgTechStack {
  readonly type: 'requestOrgTechStack';
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
}

/**
 * Request to load technology stack by file extension for an organization.
 * GITX-214: File Extensions view for Technology Stack toggle.
 */
export interface RequestOrgTechStackByExtension {
  readonly type: 'requestOrgTechStackByExtension';
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
}

/**
 * Request to load comments per week data for an organization.
 */
export interface RequestOrgCommentsPerWeek {
  readonly type: 'requestOrgCommentsPerWeek';
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
}

/**
 * Request to load tests per week data for an organization.
 */
export interface RequestOrgTestsPerWeek {
  readonly type: 'requestOrgTestsPerWeek';
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
}

/**
 * Request to load hygiene score data for an organization.
 */
export interface RequestOrgHygieneScore {
  readonly type: 'requestOrgHygieneScore';
  readonly organizationId: number;
}

/**
 * Request to load velocity with team breakdown for stacked bar chart.
 * GITX-201: Sprint Velocity chart with team colors.
 */
export interface RequestOrgVelocityWithTeams {
  readonly type: 'requestOrgVelocityWithTeams';
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
}

/**
 * Request to load LOC by team for team-colored line chart.
 * GITX-201: LOC chart with each team as a separate colored line.
 */
export interface RequestOrgLocByTeam {
  readonly type: 'requestOrgLocByTeam';
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
}

/**
 * Request to load hot spots for an organization.
 */
export interface RequestOrgHotSpots {
  readonly type: 'requestOrgHotSpots';
  readonly organizationId: number;
}

/**
 * Request to load knowledge concentration for an organization.
 */
export interface RequestOrgKnowledgeConcentration {
  readonly type: 'requestOrgKnowledgeConcentration';
  readonly organizationId: number;
}

/**
 * Request to load all data for an organization.
 */
export interface RequestOrgAllData {
  readonly type: 'requestOrgAllData';
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
}

/**
 * Request to load data coverage for an organization.
 * GITX-210: Partial data coverage handling.
 */
export interface RequestOrgDataCoverage {
  readonly type: 'requestOrgDataCoverage';
  readonly organizationId: number;
  readonly timeframeDays: OrgProfileTimeframe;
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
 * Request to load the list of teams.
 */
export interface RequestTeams {
  readonly type: 'requestTeams';
}

// ============================================================================
// Webview -> Extension (CRUD Operations)
// ============================================================================

/**
 * Request to create a new organization.
 */
export interface RequestCreateOrganization {
  readonly type: 'createOrganization';
  readonly name: string;
}

/**
 * Request to update an existing organization.
 */
export interface RequestUpdateOrganization {
  readonly type: 'updateOrganization';
  readonly organizationId: number;
  readonly name: string;
}

/**
 * Request to delete an organization.
 */
export interface RequestDeleteOrganization {
  readonly type: 'deleteOrganization';
  readonly organizationId: number;
}

/**
 * Request to assign a team to an organization.
 */
export interface RequestAssignTeam {
  readonly type: 'assignTeamToOrganization';
  readonly teamId: number;
  readonly organizationId: number;
}

/**
 * Request to remove a team from its organization.
 */
export interface RequestRemoveTeam {
  readonly type: 'removeTeamFromOrganization';
  readonly teamId: number;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type OrgProfileWebviewToHost =
  | RequestOrganizations
  | RequestOrganizationById
  | RequestOrgSummary
  | RequestOrgLocPerWeek
  | RequestOrgTopComplexFiles
  | RequestOrgTopFrequentFiles
  | RequestOrgTechStack
  | RequestOrgTechStackByExtension
  | RequestOrgCommentsPerWeek
  | RequestOrgTestsPerWeek
  | RequestOrgHygieneScore
  | RequestOrgVelocityWithTeams
  | RequestOrgLocByTeam
  | RequestOrgHotSpots
  | RequestOrgKnowledgeConcentration
  | RequestOrgAllData
  | RequestOrgDataCoverage
  | RequestOpenFile
  | RequestTeams
  | RequestCreateOrganization
  | RequestUpdateOrganization
  | RequestDeleteOrganization
  | RequestAssignTeam
  | RequestRemoveTeam;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with organization list for dropdown.
 */
export interface ResponseOrganizations {
  readonly type: 'organizationsData';
  readonly data: readonly Organization[];
}

/**
 * Response with a single organization.
 */
export interface ResponseOrganizationById {
  readonly type: 'organizationData';
  readonly data: Organization | null;
}

/**
 * Response with summary statistics for an organization.
 */
export interface ResponseOrgSummary {
  readonly type: 'orgSummaryData';
  readonly data: OrgProfileSummary;
}

/**
 * Response with LOC per week data for an organization.
 */
export interface ResponseOrgLocPerWeek {
  readonly type: 'orgLocPerWeekData';
  readonly data: readonly OrgProfileLocWeekly[];
}

/**
 * Response with top complex files for an organization.
 */
export interface ResponseOrgTopComplexFiles {
  readonly type: 'orgTopComplexFilesData';
  readonly data: readonly OrgProfileComplexFile[];
}

/**
 * Response with top frequent files for an organization.
 */
export interface ResponseOrgTopFrequentFiles {
  readonly type: 'orgTopFrequentFilesData';
  readonly data: readonly OrgProfileFrequentFile[];
}

/**
 * Response with technology stack data for an organization.
 */
export interface ResponseOrgTechStack {
  readonly type: 'orgTechStackData';
  readonly data: readonly OrgProfileTechStack[];
}

/**
 * Response with technology stack by file extension for an organization.
 * GITX-214: File Extensions view for Technology Stack toggle.
 */
export interface ResponseOrgTechStackByExtension {
  readonly type: 'orgTechStackByExtensionData';
  readonly data: readonly OrgProfileTechStackByExtension[];
}

/**
 * Response with comments per week data for an organization.
 */
export interface ResponseOrgCommentsPerWeek {
  readonly type: 'orgCommentsPerWeekData';
  readonly data: readonly OrgProfileCommentsWeekly[];
}

/**
 * Response with tests per week data for an organization.
 */
export interface ResponseOrgTestsPerWeek {
  readonly type: 'orgTestsPerWeekData';
  readonly data: readonly OrgProfileTestsWeekly[];
}

/**
 * Response with hygiene score data for an organization.
 */
export interface ResponseOrgHygieneScore {
  readonly type: 'orgHygieneScoreData';
  readonly data: OrgProfileHygieneScore;
}

/**
 * Response with velocity data with team breakdown.
 * GITX-201: Sprint Velocity chart with team colors.
 */
export interface ResponseOrgVelocityWithTeams {
  readonly type: 'orgVelocityWithTeamsData';
  readonly data: readonly OrgProfileVelocityWithTeams[];
}

/**
 * Response with LOC by team data.
 * GITX-201: LOC chart with each team as a separate colored line.
 */
export interface ResponseOrgLocByTeam {
  readonly type: 'orgLocByTeamData';
  readonly data: readonly OrgProfileLocByTeam[];
}

/**
 * Response with hot spots data for an organization.
 */
export interface ResponseOrgHotSpots {
  readonly type: 'orgHotSpotsData';
  readonly data: readonly OrgProfileHotSpot[];
}

/**
 * Response with knowledge concentration data for an organization.
 */
export interface ResponseOrgKnowledgeConcentration {
  readonly type: 'orgKnowledgeConcentrationData';
  readonly data: readonly OrgProfileKnowledgeConcentration[];
}

/**
 * Response with data coverage information for an organization.
 * GITX-210: Partial data coverage handling.
 */
export interface ResponseOrgDataCoverage {
  readonly type: 'orgDataCoverageData';
  readonly data: OrgDataCoverage;
}

/**
 * Response with teams list.
 */
export interface ResponseTeams {
  readonly type: 'teamsData';
  readonly data: readonly Team[];
}

/**
 * Error response sent when a data query fails.
 */
export interface ResponseOrgError {
  readonly type: 'error';
  readonly message: string;
  readonly source: string;
}

/**
 * Initial state message with pre-selected organization.
 */
export interface ResponseOrgInitialState {
  readonly type: 'initialState';
  readonly organizationId: number | null;
  readonly timeframeDays: OrgProfileTimeframe;
}

// ============================================================================
// Extension -> Webview (CRUD Responses)
// ============================================================================

/**
 * Response after creating an organization.
 */
export interface ResponseOrganizationCreated {
  readonly type: 'organizationCreated';
  readonly data: Organization;
}

/**
 * Response after updating an organization.
 */
export interface ResponseOrganizationUpdated {
  readonly type: 'organizationUpdated';
  readonly data: Organization | null;
}

/**
 * Response after deleting an organization.
 */
export interface ResponseOrganizationDeleted {
  readonly type: 'organizationDeleted';
  readonly organizationId: number;
  readonly success: boolean;
}

/**
 * Response after assigning a team to an organization.
 */
export interface ResponseTeamAssigned {
  readonly type: 'teamAssigned';
  readonly data: Team | null;
}

/**
 * Response after removing a team from its organization.
 */
export interface ResponseTeamRemoved {
  readonly type: 'teamRemoved';
  readonly data: Team | null;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type OrgProfileHostToWebview =
  | ResponseOrganizations
  | ResponseOrganizationById
  | ResponseOrgSummary
  | ResponseOrgLocPerWeek
  | ResponseOrgTopComplexFiles
  | ResponseOrgTopFrequentFiles
  | ResponseOrgTechStack
  | ResponseOrgTechStackByExtension
  | ResponseOrgCommentsPerWeek
  | ResponseOrgTestsPerWeek
  | ResponseOrgHygieneScore
  | ResponseOrgVelocityWithTeams
  | ResponseOrgLocByTeam
  | ResponseOrgHotSpots
  | ResponseOrgKnowledgeConcentration
  | ResponseOrgDataCoverage
  | ResponseTeams
  | ResponseOrgInitialState
  | ResponseOrganizationCreated
  | ResponseOrganizationUpdated
  | ResponseOrganizationDeleted
  | ResponseTeamAssigned
  | ResponseTeamRemoved
  | ResponseOrgError;
