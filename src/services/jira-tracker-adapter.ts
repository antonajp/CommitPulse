/**
 * Adapter wrapping the existing JiraService behind the IssueTrackerService interface.
 *
 * This adapter allows the pipeline to use JiraService through the common
 * IssueTrackerService abstraction, enabling future Linear support without
 * changing the pipeline orchestration logic.
 *
 * The adapter delegates all operations to the underlying JiraIncrementalLoader
 * (which coordinates JiraService + JiraChangelogService), and the JiraSettings
 * configuration for key validation.
 *
 * Ticket: IQS-874
 */

import { LoggerService } from '../logging/logger.js';
import type { JiraSettings } from '../config/settings.js';
import type { JiraIncrementalLoader, IncrementalLoadResult } from './jira-incremental-loader.js';
import type {
  IssueTrackerService,
  TrackerLoadResult,
  TrackerTypeId,
} from './issue-tracker-interface.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'JiraTrackerAdapter';

/**
 * Regex pattern for validating Jira issue identifiers.
 * Format: 2-10 uppercase letters, a dash, then 1 or more digits.
 * Examples: PROJ-123, AB-1, ENGINEERING-9999
 */
const JIRA_IDENTIFIER_PATTERN = /^[A-Z]{2,10}-\d+$/;

/**
 * Adapter that wraps JiraIncrementalLoader to implement IssueTrackerService.
 *
 * This is the "Jira side" of the tracker abstraction layer. When a repository
 * is configured with trackerType='jira' (the default), this adapter is used.
 */
export class JiraTrackerAdapter implements IssueTrackerService {
  readonly trackerType: TrackerTypeId = 'jira';

  private readonly logger: LoggerService;
  private readonly jiraLoader: JiraIncrementalLoader;
  private readonly jiraSettings: JiraSettings;

  /**
   * Create a new JiraTrackerAdapter.
   *
   * @param jiraLoader - The JiraIncrementalLoader that handles issue loading and changelog refresh
   * @param jiraSettings - The Jira configuration settings (project keys, key aliases, etc.)
   */
  constructor(
    jiraLoader: JiraIncrementalLoader,
    jiraSettings: JiraSettings,
  ) {
    this.jiraLoader = jiraLoader;
    this.jiraSettings = jiraSettings;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', `JiraTrackerAdapter created with ${jiraSettings.projectKeys.length} project keys`);
    this.logger.trace(CLASS_NAME, 'constructor', `Project keys: [${jiraSettings.projectKeys.join(', ')}]`);
  }

  /**
   * Load Jira issues using the incremental loader.
   * Delegates to JiraIncrementalLoader.runIncrementalLoad().
   *
   * @returns A unified TrackerLoadResult summarizing the operation
   */
  async loadIssues(): Promise<TrackerLoadResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'loadIssues', 'Starting Jira issue load via adapter');

    try {
      const result: IncrementalLoadResult = await this.jiraLoader.runIncrementalLoad();
      const durationMs = Date.now() - startTime;

      this.logger.info(CLASS_NAME, 'loadIssues', `Jira load complete: ${result.totalInserted} inserted, ${result.totalSkipped} skipped in ${durationMs}ms`);
      this.logger.debug(CLASS_NAME, 'loadIssues', `Projects loaded: ${result.projectResults.length}, unfinished refresh: ${result.unfinishedResult ? 'yes' : 'skipped'}`);

      return {
        issuesInserted: result.totalInserted,
        issuesSkipped: result.totalSkipped,
        issuesFailed: result.totalFailed,
        durationMs,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'loadIssues', `Jira load failed: ${message}`);
      throw error;
    }
  }

  /**
   * Get the configured Jira project keys.
   * Returns both the primary project keys and any alias source keys.
   *
   * @returns Array of valid Jira project key prefixes
   */
  async getValidKeys(): Promise<readonly string[]> {
    this.logger.debug(CLASS_NAME, 'getValidKeys', 'Retrieving valid Jira project keys');

    const keys = new Set<string>();

    // Add configured project keys
    for (const key of this.jiraSettings.projectKeys) {
      keys.add(key);
    }

    // Add alias source keys (the old project names that map to current ones)
    for (const aliasKey of Object.keys(this.jiraSettings.keyAliases)) {
      keys.add(aliasKey);
    }

    // Add alias target keys (the current project names that aliases map to)
    for (const aliasValue of Object.values(this.jiraSettings.keyAliases)) {
      keys.add(aliasValue);
    }

    const result = Array.from(keys);
    this.logger.debug(CLASS_NAME, 'getValidKeys', `Valid Jira keys: [${result.join(', ')}]`);
    return result;
  }

  /**
   * Check whether a string matches the Jira issue identifier format.
   * Format: PROJ-123 (2-10 uppercase letters, dash, digits).
   *
   * @param identifier - The potential issue identifier
   * @returns true if the identifier matches Jira format
   */
  isValidIdentifier(identifier: string): boolean {
    const isValid = JIRA_IDENTIFIER_PATTERN.test(identifier);
    this.logger.trace(CLASS_NAME, 'isValidIdentifier', `'${identifier}' isValid=${isValid}`);
    return isValid;
  }
}
