/**
 * Adapter wrapping LinearService behind the IssueTrackerService interface.
 *
 * This adapter allows the pipeline to use LinearService through the common
 * IssueTrackerService abstraction. Parallel to JiraTrackerAdapter.
 *
 * Ticket: IQS-875
 */

import { LoggerService } from '../logging/logger.js';
import type { LinearSettings } from '../config/settings.js';
import type { LinearIncrementalLoader, LinearIncrementalLoadResult } from './linear-incremental-loader.js';
import type {
  IssueTrackerService,
  TrackerLoadResult,
  TrackerTypeId,
} from './issue-tracker-interface.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'LinearTrackerAdapter';

/**
 * Regex pattern for validating Linear issue identifiers.
 * Format: 2-10 uppercase letters (with optional digits), a dash, then 1+ digits.
 * Examples: IQS-123, ENG-456, PLAT-9999
 */
const LINEAR_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]{1,10}-\d{1,6}$/;

/**
 * Adapter that wraps LinearIncrementalLoader to implement IssueTrackerService.
 *
 * This is the "Linear side" of the tracker abstraction layer. When a repository
 * is configured with trackerType='linear', this adapter is used.
 *
 * Ticket: IQS-875
 */
export class LinearTrackerAdapter implements IssueTrackerService {
  readonly trackerType: TrackerTypeId = 'linear';

  private readonly logger: LoggerService;
  private readonly linearLoader: LinearIncrementalLoader;
  private readonly linearSettings: LinearSettings;

  constructor(
    linearLoader: LinearIncrementalLoader,
    linearSettings: LinearSettings,
  ) {
    this.linearLoader = linearLoader;
    this.linearSettings = linearSettings;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', `LinearTrackerAdapter created with ${linearSettings.teamKeys.length} team keys`);
    this.logger.trace(CLASS_NAME, 'constructor', `Team keys: [${linearSettings.teamKeys.join(', ')}]`);
  }

  /**
   * Load Linear issues using the incremental loader.
   * Delegates to LinearIncrementalLoader.runIncrementalLoad().
   *
   * @returns A unified TrackerLoadResult summarizing the operation
   */
  async loadIssues(): Promise<TrackerLoadResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'loadIssues', 'Starting Linear issue load via adapter');

    try {
      const result: LinearIncrementalLoadResult = await this.linearLoader.runIncrementalLoad();
      const durationMs = Date.now() - startTime;

      this.logger.info(CLASS_NAME, 'loadIssues', `Linear load complete: ${result.totalInserted} inserted, ${result.totalSkipped} skipped in ${durationMs}ms`);
      this.logger.debug(CLASS_NAME, 'loadIssues', `Teams loaded: ${result.teamResults.length}, unfinished refreshed: ${result.unfinishedRefreshed}`);

      return {
        issuesInserted: result.totalInserted,
        issuesSkipped: result.totalSkipped,
        issuesFailed: result.totalFailed,
        durationMs,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'loadIssues', `Linear load failed: ${message}`);
      throw error;
    }
  }

  /**
   * Get the configured Linear team keys.
   * Returns both the primary team keys and any alias source keys.
   *
   * @returns Array of valid Linear team key prefixes
   */
  async getValidKeys(): Promise<readonly string[]> {
    this.logger.debug(CLASS_NAME, 'getValidKeys', 'Retrieving valid Linear team keys');

    const keys = new Set<string>();

    // Add configured team keys
    for (const key of this.linearSettings.teamKeys) {
      keys.add(key);
    }

    // Add alias source keys
    for (const aliasKey of Object.keys(this.linearSettings.keyAliases)) {
      keys.add(aliasKey);
    }

    // Add alias target keys
    for (const aliasValue of Object.values(this.linearSettings.keyAliases)) {
      keys.add(aliasValue);
    }

    const result = Array.from(keys);
    this.logger.debug(CLASS_NAME, 'getValidKeys', `Valid Linear keys: [${result.join(', ')}]`);
    return result;
  }

  /**
   * Check whether a string matches the Linear issue identifier format.
   * Format: TEAM-123 (1 uppercase letter + 1-10 uppercase alphanumerics, dash, digits).
   *
   * Validates against configured team keys whitelist.
   *
   * @param identifier - The potential issue identifier
   * @returns true if the identifier matches Linear format and belongs to a configured team
   */
  isValidIdentifier(identifier: string): boolean {
    // First check format
    if (!LINEAR_IDENTIFIER_PATTERN.test(identifier)) {
      this.logger.trace(CLASS_NAME, 'isValidIdentifier', `'${identifier}' failed format check`);
      return false;
    }

    // Then validate against configured team keys
    const dashIdx = identifier.indexOf('-');
    const prefix = dashIdx > 0 ? identifier.substring(0, dashIdx) : '';
    const isValid = this.linearSettings.teamKeys.includes(prefix)
      || Object.keys(this.linearSettings.keyAliases).includes(prefix)
      || Object.values(this.linearSettings.keyAliases).includes(prefix);

    this.logger.trace(CLASS_NAME, 'isValidIdentifier', `'${identifier}' isValid=${isValid}`);
    return isValid;
  }
}
