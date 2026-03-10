/**
 * Message protocol types for communication between the extension host
 * and the Knowledge Concentration dashboard webview.
 *
 * Messages flow in two directions:
 * - KnowledgeWebviewToHost: Messages sent from the webview to the extension
 * - KnowledgeHostToWebview: Messages sent from the extension to the webview
 *
 * All messages are typed discriminated unions using the 'type' field
 * as the discriminant for exhaustive switch-case handling.
 *
 * Ticket: IQS-903
 */

import type {
  FileOwnership,
  ModuleBusFactor,
  ConcentrationRisk,
} from '../../services/knowledge-concentration-types.js';
import type { KnowledgeSummary } from '../../database/queries/knowledge-queries.js';

// ============================================================================
// Webview -> Extension (Requests)
// ============================================================================

/**
 * Request to load file ownership data.
 * Optional repository, concentration risk, and contributor filters may be provided.
 */
export interface RequestFileOwnershipData {
  readonly type: 'requestFileOwnershipData';
  readonly repository?: string;
  readonly concentrationRisk?: ConcentrationRisk;
  readonly contributor?: string;
  readonly maxBusFactor?: number;
}

/**
 * Request to load module bus factor data.
 * Optional repository filter may be provided.
 */
export interface RequestModuleBusFactorData {
  readonly type: 'requestModuleBusFactorData';
  readonly repository?: string;
}

/**
 * Request to load high-risk modules only.
 * Returns modules with at least one critical or high concentration risk file.
 */
export interface RequestHighRiskModules {
  readonly type: 'requestHighRiskModules';
}

/**
 * Request to load knowledge concentration summary statistics.
 * Returns aggregate counts by concentration risk.
 */
export interface RequestKnowledgeSummary {
  readonly type: 'requestKnowledgeSummary';
}

/**
 * Request to refresh knowledge concentration data with current filters.
 * Used when user clicks refresh button or when auto-refresh triggers.
 */
export interface RequestKnowledgeRefresh {
  readonly type: 'requestKnowledgeRefresh';
}

/**
 * Request to open a file in VS Code editor (IQS-904).
 * Validates file path is within workspace before opening.
 */
export interface RequestOpenFile {
  readonly type: 'openFile';
  readonly filePath: string;
  readonly repository: string;
}

/**
 * Request to filter treemap by a specific contributor (IQS-904).
 * Reloads the visualization showing only files owned by this person.
 */
export interface RequestFilterByContributor {
  readonly type: 'filterByContributor';
  readonly contributor: string;
}

/**
 * Union type of all messages sent from the webview to the extension host.
 */
export type KnowledgeWebviewToHost =
  | RequestFileOwnershipData
  | RequestModuleBusFactorData
  | RequestHighRiskModules
  | RequestKnowledgeSummary
  | RequestKnowledgeRefresh
  | RequestOpenFile
  | RequestFilterByContributor;

// ============================================================================
// Extension -> Webview (Responses)
// ============================================================================

/**
 * Response with file ownership data.
 */
export interface ResponseFileOwnershipData {
  readonly type: 'fileOwnershipData';
  readonly rows: readonly FileOwnership[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with module bus factor data.
 */
export interface ResponseModuleBusFactorData {
  readonly type: 'moduleBusFactorData';
  readonly rows: readonly ModuleBusFactor[];
  readonly hasData: boolean;
  readonly viewExists: boolean;
}

/**
 * Response with knowledge concentration summary statistics by risk level.
 */
export interface ResponseKnowledgeSummary {
  readonly type: 'knowledgeSummary';
  readonly summary: readonly KnowledgeSummary[];
}

/**
 * Error response sent when a data query fails.
 */
export interface KnowledgeResponseError {
  readonly type: 'knowledgeError';
  readonly message: string;
  readonly source: string;
}

/**
 * Loading state notification.
 * Sent when data is being fetched.
 */
export interface KnowledgeLoadingState {
  readonly type: 'knowledgeLoading';
  readonly isLoading: boolean;
}

/**
 * Response with list of unique repositories (IQS-904).
 * Used to populate the repository filter dropdown.
 */
export interface ResponseRepositories {
  readonly type: 'repositories';
  readonly repositories: readonly string[];
}

/**
 * Response with list of unique contributors (IQS-904).
 * Used to populate the contributor filter dropdown.
 */
export interface ResponseContributors {
  readonly type: 'contributors';
  readonly contributors: readonly string[];
}

/**
 * Union type of all messages sent from the extension host to the webview.
 */
export type KnowledgeHostToWebview =
  | ResponseFileOwnershipData
  | ResponseModuleBusFactorData
  | ResponseKnowledgeSummary
  | KnowledgeResponseError
  | KnowledgeLoadingState
  | ResponseRepositories
  | ResponseContributors;
