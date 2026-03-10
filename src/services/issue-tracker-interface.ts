/**
 * Common interface for issue tracker services (Jira, Linear, etc.).
 *
 * Abstracts the tracker-specific API behind a uniform interface so the
 * pipeline can load issues, validate identifiers, and retrieve valid keys
 * regardless of whether the underlying tracker is Jira or Linear.
 *
 * Each tracker implementation (JiraTrackerAdapter, future LinearTrackerAdapter)
 * implements this interface to provide tracker-specific behavior.
 *
 * Ticket: IQS-874
 */

import { LoggerService } from '../logging/logger.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'IssueTrackerInterface';

/**
 * Result summary from a tracker issue loading operation.
 * Provides a unified shape regardless of the underlying tracker.
 */
export interface TrackerLoadResult {
  /** Number of new issues inserted. */
  readonly issuesInserted: number;
  /** Number of issues skipped (already known). */
  readonly issuesSkipped: number;
  /** Number of issues that failed to load. */
  readonly issuesFailed: number;
  /** Duration of the load operation in milliseconds. */
  readonly durationMs: number;
}

/**
 * Result summary from a tracker changelog/refresh operation.
 * Provides a unified shape regardless of the underlying tracker.
 */
export interface TrackerRefreshResult {
  /** Number of issues refreshed. */
  readonly issuesRefreshed: number;
  /** Number of issues that failed to refresh. */
  readonly issuesFailed: number;
  /** Duration of the refresh operation in milliseconds. */
  readonly durationMs: number;
}

/**
 * Tracker type identifier for dispatching to the correct implementation.
 */
export type TrackerTypeId = 'jira' | 'linear' | 'none';

/**
 * Common interface for issue tracker services.
 *
 * Implementations must be stateless with respect to configuration --
 * all config is provided at construction time. Methods are async
 * to support both REST (Jira) and GraphQL (Linear) backends.
 */
export interface IssueTrackerService {
  /**
   * The tracker type this service handles.
   */
  readonly trackerType: TrackerTypeId;

  /**
   * Load issues from the tracker into the local database.
   * Supports incremental loading (only new issues since last run).
   *
   * @returns A summary of the load operation
   */
  loadIssues(): Promise<TrackerLoadResult>;

  /**
   * Get the set of valid issue key prefixes (project/team keys) configured
   * for this tracker. Used by the commit-linking step to determine which
   * regex patterns to apply.
   *
   * @returns Array of valid key prefixes (e.g., ["IQS", "ENG"] for Linear, ["PROJ", "FEAT"] for Jira)
   */
  getValidKeys(): Promise<readonly string[]>;

  /**
   * Check whether a given string is a valid issue identifier for this tracker.
   * Used during commit message parsing to filter false positives.
   *
   * @param identifier - The potential issue identifier (e.g., "IQS-123", "ENG-456")
   * @returns true if the identifier matches this tracker's format
   */
  isValidIdentifier(identifier: string): boolean;
}

/**
 * Null implementation of IssueTrackerService for repositories with trackerType='none'.
 * All operations are no-ops that return empty/zero results.
 *
 * Ticket: IQS-874
 */
export class NullTrackerService implements IssueTrackerService {
  readonly trackerType: TrackerTypeId = 'none';
  private readonly logger: LoggerService;

  constructor() {
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'NullTrackerService', 'NullTrackerService created (trackerType=none)');
  }

  async loadIssues(): Promise<TrackerLoadResult> {
    this.logger.debug(CLASS_NAME, 'NullTrackerService.loadIssues', 'No-op: trackerType is none');
    return { issuesInserted: 0, issuesSkipped: 0, issuesFailed: 0, durationMs: 0 };
  }

  async getValidKeys(): Promise<readonly string[]> {
    this.logger.debug(CLASS_NAME, 'NullTrackerService.getValidKeys', 'No-op: trackerType is none');
    return [];
  }

  isValidIdentifier(_identifier: string): boolean {
    return false;
  }
}
