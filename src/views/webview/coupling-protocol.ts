/**
 * Message protocol types for communication between the extension host
 * and the Cross-Team Coupling dashboard webview.
 *
 * Messages flow in two directions:
 * - CouplingWebviewToHost: Messages sent from the webview to the extension
 * - CouplingHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-909
 */

import type {
  TeamCouplingRow,
  SharedFileDetail,
  ChordData,
  CouplingMatrixSummary,
  CouplingFilters,
} from '../../services/team-coupling-types.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load coupling chart data.
 * Optional filters for teams and minimum coupling strength.
 */
export interface RequestCouplingData {
  readonly type: 'requestCouplingData';
  readonly filters?: CouplingFilters;
}

/**
 * Request to load shared files data for a specific team pair.
 * Used for drill-down analysis of coupling between two teams.
 */
export interface RequestSharedFilesData {
  readonly type: 'requestSharedFilesData';
  readonly teamA: string;
  readonly teamB: string;
}

/**
 * Request to refresh coupling data with current filters.
 * Used when user clicks refresh button or when auto-refresh triggers.
 */
export interface RequestCouplingRefresh {
  readonly type: 'requestCouplingRefresh';
  readonly filters?: CouplingFilters;
}

/**
 * Request to update filters and reload data.
 * Used when user changes filter controls in the webview.
 */
export interface RequestCouplingFilterUpdate {
  readonly type: 'requestCouplingFilterUpdate';
  readonly filters: CouplingFilters;
}

/**
 * Request to drill down into a specific team's coupling details.
 * Used when user clicks on a team in the chord diagram.
 */
export interface RequestTeamDrillDown {
  readonly type: 'requestTeamDrillDown';
  /** Team name for drill-down */
  readonly team: string;
  /** Current filters to apply */
  readonly filters?: CouplingFilters;
}

/**
 * Request to drill down into a specific team pair.
 * Used when user clicks on a chord/arc in the diagram.
 */
export interface RequestTeamPairDrillDown {
  readonly type: 'requestTeamPairDrillDown';
  /** First team */
  readonly teamA: string;
  /** Second team */
  readonly teamB: string;
  /** Current filters to apply */
  readonly filters?: CouplingFilters;
}

/**
 * Request to navigate to a specific file.
 * Used when user clicks on a file in the shared files list.
 */
export interface RequestOpenFile {
  readonly type: 'requestOpenFile';
  /** File path to open */
  readonly filePath: string;
  /** Repository containing the file */
  readonly repository: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type CouplingWebviewToHost =
  | RequestCouplingData
  | RequestSharedFilesData
  | RequestCouplingRefresh
  | RequestCouplingFilterUpdate
  | RequestTeamDrillDown
  | RequestTeamPairDrillDown
  | RequestOpenFile;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with coupling chart data.
 */
export interface ResponseCouplingData {
  readonly type: 'couplingData';
  readonly couplingData: readonly TeamCouplingRow[];
  readonly chordData: ChordData;
  readonly summary: CouplingMatrixSummary;
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with shared files data for a team pair.
 */
export interface ResponseSharedFilesData {
  readonly type: 'sharedFilesData';
  readonly teamA: string;
  readonly teamB: string;
  readonly sharedFiles: readonly SharedFileDetail[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with drill-down data for a specific team.
 */
export interface ResponseTeamDrillDown {
  readonly type: 'teamDrillDown';
  readonly team: string;
  /** Coupling rows involving this team */
  readonly couplingRows: readonly TeamCouplingRow[];
  /** Total shared files with all other teams */
  readonly totalSharedFiles: number;
  /** Teams this team is coupled with */
  readonly coupledTeams: readonly string[];
  /** Average coupling strength with other teams */
  readonly avgCouplingStrength: number;
}

/**
 * Response with drill-down data for a specific team pair.
 */
export interface ResponseTeamPairDrillDown {
  readonly type: 'teamPairDrillDown';
  readonly teamA: string;
  readonly teamB: string;
  /** Coupling row for this pair */
  readonly coupling: TeamCouplingRow | null;
  /** Shared files between these teams */
  readonly sharedFiles: readonly SharedFileDetail[];
  /** Top hotspot files */
  readonly hotspotFiles: readonly string[];
}

/**
 * Error response sent when a data query fails.
 */
export interface CouplingResponseError {
  readonly type: 'couplingError';
  readonly message: string;
  readonly source: string;
}

/**
 * Loading state notification.
 * Sent when data is being fetched.
 */
export interface CouplingLoadingState {
  readonly type: 'couplingLoading';
  readonly isLoading: boolean;
}

/**
 * Filter options available for the dashboard.
 * Sent to populate filter dropdowns in the webview.
 */
export interface ResponseCouplingFilterOptions {
  readonly type: 'couplingFilterOptions';
  /** Available teams */
  readonly teams: readonly string[];
  /** Available repositories */
  readonly repositories: readonly string[];
  /** Coupling strength range in the data */
  readonly strengthRange: {
    readonly min: number;
    readonly max: number;
  };
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type CouplingHostToWebview =
  | ResponseCouplingData
  | ResponseSharedFilesData
  | ResponseTeamDrillDown
  | ResponseTeamPairDrillDown
  | CouplingResponseError
  | CouplingLoadingState
  | ResponseCouplingFilterOptions;
