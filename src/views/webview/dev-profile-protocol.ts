/**
 * Message protocol types for communication between the extension host
 * and the Developer Profile Dashboard webview.
 *
 * Messages flow in two directions:
 * - DevProfileWebviewToHost: Messages sent from the webview to the extension
 * - DevProfileHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: GITX-155
 */

import type {
  DevProfileSummary,
  DevProfileLocWeekly,
  DevProfileComplexFile,
  DevProfileFrequentFile,
  DevProfileDeveloper,
  DevProfileTimeframe,
  DevProfileTechStack,
  DevProfileCommentsWeekly,
  DevProfileTestsWeekly,
  DevProfileHygieneScore,
  DevProfileVelocityPoint,
} from '../../services/dev-profile-data-service.js';

// Re-export types for convenience
export type {
  DevProfileSummary,
  DevProfileLocWeekly,
  DevProfileComplexFile,
  DevProfileFrequentFile,
  DevProfileDeveloper,
  DevProfileTimeframe,
  DevProfileTechStack,
  DevProfileCommentsWeekly,
  DevProfileTestsWeekly,
  DevProfileHygieneScore,
  DevProfileVelocityPoint,
} from '../../services/dev-profile-data-service.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load the list of developers for the dropdown.
 */
export interface RequestDevelopers {
  readonly type: 'requestDevelopers';
}

/**
 * Request to load summary statistics for a developer.
 */
export interface RequestSummary {
  readonly type: 'requestSummary';
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Request to load LOC per week data.
 */
export interface RequestLocPerWeek {
  readonly type: 'requestLocPerWeek';
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Request to load top complex files.
 */
export interface RequestTopComplexFiles {
  readonly type: 'requestTopComplexFiles';
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Request to load top frequent files.
 */
export interface RequestTopFrequentFiles {
  readonly type: 'requestTopFrequentFiles';
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
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
 * Request to load all data for a developer.
 */
export interface RequestAllData {
  readonly type: 'requestAllData';
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Request to load technology stack data.
 * Ticket: GITX-156
 */
export interface RequestTechStack {
  readonly type: 'requestTechStack';
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Request to load comments per week data.
 * Ticket: GITX-156
 */
export interface RequestCommentsPerWeek {
  readonly type: 'requestCommentsPerWeek';
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Request to load tests per week data.
 * Ticket: GITX-156
 */
export interface RequestTestsPerWeek {
  readonly type: 'requestTestsPerWeek';
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Request to load hygiene score data.
 * Ticket: GITX-156
 */
export interface RequestHygieneScore {
  readonly type: 'requestHygieneScore';
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Request to load velocity vs LOC data.
 * Ticket: GITX-157
 */
export interface RequestVelocityVsLoc {
  readonly type: 'requestVelocityVsLoc';
  readonly developer: string;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Request to check if velocity data is available.
 * Ticket: GITX-157
 */
export interface RequestHasVelocityData {
  readonly type: 'requestHasVelocityData';
  readonly developer: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type DevProfileWebviewToHost =
  | RequestDevelopers
  | RequestSummary
  | RequestLocPerWeek
  | RequestTopComplexFiles
  | RequestTopFrequentFiles
  | RequestOpenFile
  | RequestAllData
  | RequestTechStack
  | RequestCommentsPerWeek
  | RequestTestsPerWeek
  | RequestHygieneScore
  | RequestVelocityVsLoc
  | RequestHasVelocityData;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with developer list for dropdown.
 */
export interface ResponseDevelopers {
  readonly type: 'developersData';
  readonly data: readonly DevProfileDeveloper[];
}

/**
 * Response with summary statistics.
 */
export interface ResponseSummary {
  readonly type: 'summaryData';
  readonly data: DevProfileSummary;
}

/**
 * Response with LOC per week data.
 */
export interface ResponseLocPerWeek {
  readonly type: 'locPerWeekData';
  readonly data: readonly DevProfileLocWeekly[];
}

/**
 * Response with top complex files.
 */
export interface ResponseTopComplexFiles {
  readonly type: 'topComplexFilesData';
  readonly data: readonly DevProfileComplexFile[];
}

/**
 * Response with top frequent files.
 */
export interface ResponseTopFrequentFiles {
  readonly type: 'topFrequentFilesData';
  readonly data: readonly DevProfileFrequentFile[];
}

/**
 * Error response sent when a data query fails.
 */
export interface ResponseError {
  readonly type: 'error';
  readonly message: string;
  readonly source: string;
}

/**
 * Initial state message with pre-selected developer.
 */
export interface ResponseInitialState {
  readonly type: 'initialState';
  readonly developer: string | null;
  readonly timeframeDays: DevProfileTimeframe;
}

/**
 * Response with technology stack data.
 * Ticket: GITX-156
 */
export interface ResponseTechStack {
  readonly type: 'techStackData';
  readonly data: readonly DevProfileTechStack[];
}

/**
 * Response with comments per week data.
 * Ticket: GITX-156
 */
export interface ResponseCommentsPerWeek {
  readonly type: 'commentsPerWeekData';
  readonly data: readonly DevProfileCommentsWeekly[];
}

/**
 * Response with tests per week data.
 * Ticket: GITX-156
 */
export interface ResponseTestsPerWeek {
  readonly type: 'testsPerWeekData';
  readonly data: readonly DevProfileTestsWeekly[];
}

/**
 * Response with hygiene score data.
 * Ticket: GITX-156
 */
export interface ResponseHygieneScore {
  readonly type: 'hygieneScoreData';
  readonly data: DevProfileHygieneScore;
}

/**
 * Response with velocity vs LOC data.
 * Ticket: GITX-157
 */
export interface ResponseVelocityVsLoc {
  readonly type: 'velocityVsLocData';
  readonly data: readonly DevProfileVelocityPoint[];
}

/**
 * Response indicating if velocity data is available.
 * Ticket: GITX-157
 */
export interface ResponseHasVelocityData {
  readonly type: 'hasVelocityData';
  readonly hasData: boolean;
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type DevProfileHostToWebview =
  | ResponseDevelopers
  | ResponseSummary
  | ResponseLocPerWeek
  | ResponseTopComplexFiles
  | ResponseTopFrequentFiles
  | ResponseInitialState
  | ResponseTechStack
  | ResponseCommentsPerWeek
  | ResponseTestsPerWeek
  | ResponseHygieneScore
  | ResponseVelocityVsLoc
  | ResponseHasVelocityData
  | ResponseError;
