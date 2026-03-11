/**
 * Jira changelog extraction and unfinished issue update service.
 *
 * Converts Python JiraApi.py methods to TypeScript:
 *   get_change_log_status_changes  -> extractChangelog
 *   update_unfinished_change_logs2 -> updateUnfinishedIssues
 *   update_issue_details           -> (uses JiraRepository.upsertJiraDetail)
 *   update_change_log_status_changes -> extractChangelog (same logic, unified)
 *
 * GitHub dev status fetching is delegated to JiraDevStatusService
 * (jira-dev-status-service.ts) for modularity and the 600-line file limit.
 *
 * CRITICAL differences from Python:
 *   - Python stores credentials in plaintext classified.properties
 *     => TypeScript uses VS Code SecretStorage via JiraServiceConfig
 *   - Python writes f-string SQL (SQL injection risk)
 *     => TypeScript uses JiraRepository with parameterized queries
 *
 * Ticket: IQS-857
 */

import { LoggerService } from '../logging/logger.js';
import { JiraRepository } from '../database/jira-repository.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import {
  extractIssueDetail,
} from './jira-issue-extractor.js';
import type { JiraExtractorConfig } from './jira-issue-extractor.js';
import type {
  JiraHistoryRow,
} from '../database/jira-types.js';
import type { JiraServiceConfig } from './jira-service.js';
import type { Version3Client, Version3Models } from 'jira.js';

// Type alias for cleaner code
type Issue = Version3Models.Issue;
import { JiraDevStatusService } from './jira-dev-status-service.js';
import type { UpdateUnfinishedResult } from './jira-changelog-types.js';
import { logJqlSearchRequest } from './jira-client-factory.js';

// Re-export types for consumers
export type {
  ChangelogResult,
  GitHubDevStatusResult,
  UpdateUnfinishedResult,
} from './jira-changelog-types.js';

// Re-export JiraDevStatusService for consumers
export { JiraDevStatusService } from './jira-dev-status-service.js';
export type { DevStatusConfig, DevStatusSaveResult } from './jira-dev-status-service.js';

// ============================================================================
// Constants
// ============================================================================

/** Class name constant for structured logging context. */
const CLASS_NAME = 'JiraChangelogService';

/** Default delay between API requests in milliseconds for rate limiting. */
const DEFAULT_RATE_LIMIT_DELAY_MS = 200;

/** Maximum retries on rate-limited (429) responses before giving up. */
const MAX_RATE_LIMIT_RETRIES = 5;

/** Maximum delay for exponential backoff on rate limit (429) responses. */
const MAX_RATE_LIMIT_DELAY_MS = 30_000;

/**
 * Default number of days to look back for recently completed issues.
 * Matches Python update_unfinished_change_logs2(days_ago=3).
 */
const DEFAULT_DAYS_AGO = 3;

/**
 * Changelog fields we track: status and assignee changes.
 * Matches Python: if item.field == 'status' or item.field == 'assignee'
 */
const TRACKED_CHANGELOG_FIELDS = new Set(['status', 'assignee']);

// ============================================================================
// JiraChangelogService implementation
// ============================================================================

/**
 * Service for extracting Jira changelogs and updating unfinished issues.
 *
 * Maps from Python JiraApi.py changelog methods with:
 * - Parameterized SQL instead of f-string interpolation
 * - Proper async/await instead of blocking I/O
 * - Configurable via VS Code settings (no hardcoded URLs or credentials)
 *
 * GitHub dev status fetching is delegated to JiraDevStatusService.
 */
export class JiraChangelogService {
  private readonly logger: LoggerService;
  private readonly jiraClient: Version3Client;
  private readonly jiraRepo: JiraRepository;
  private readonly pipelineRepo: PipelineRepository;
  private readonly config: JiraServiceConfig;
  private readonly extractorConfig: JiraExtractorConfig;
  private readonly devStatusService: JiraDevStatusService;

  constructor(
    config: JiraServiceConfig,
    jiraRepo: JiraRepository,
    pipelineRepo: PipelineRepository,
    jiraClient: Version3Client,
  ) {
    this.config = config;
    this.jiraRepo = jiraRepo;
    this.pipelineRepo = pipelineRepo;
    this.jiraClient = jiraClient;
    this.logger = LoggerService.getInstance();

    this.extractorConfig = {
      server: config.server,
      pointsField: config.pointsField,
    };

    // Create dev status service with Jira auth config
    this.devStatusService = new JiraDevStatusService(
      { server: config.server, username: config.username, token: config.token },
      jiraRepo,
    );

    this.logger.debug(CLASS_NAME, 'constructor', `JiraChangelogService created for server: ${config.server}`);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Extract changelog entries (status and assignee changes) from a Jira issue.
   *
   * Maps from Python JiraApi.get_change_log_status_changes().
   *
   * @param issue - The Jira issue with expanded changelog
   * @returns Array of JiraHistoryRow that were extracted
   */
  extractChangelog(issue: Issue): JiraHistoryRow[] {
    this.logger.debug(CLASS_NAME, 'extractChangelog', `Extracting changelog for: ${issue.key}`);

    const changelog = (issue as unknown as Record<string, unknown>).changelog as
      { histories?: Array<{ created: string; items: Array<{ field: string; fromString: string | null; toString: string | null }> }> } | undefined;

    if (!changelog?.histories) {
      this.logger.debug(CLASS_NAME, 'extractChangelog', `No changelog found for: ${issue.key}`);
      return [];
    }

    const historyRows: JiraHistoryRow[] = [];

    for (const history of changelog.histories) {
      for (const item of history.items) {
        // Match Python: if item.field == 'status' or item.field == 'assignee'
        if (TRACKED_CHANGELOG_FIELDS.has(item.field)) {
          const row: JiraHistoryRow = {
            jiraKey: issue.key,
            changeDate: new Date(history.created),
            assignee: null,
            field: item.field,
            fromValue: item.fromString ?? null,
            toValue: item.toString ?? null,
          };

          historyRows.push(row);

          this.logger.trace(
            CLASS_NAME, 'extractChangelog',
            `Changelog: ${issue.key} ${item.field}: '${item.fromString}' -> '${item.toString}' at ${history.created}`,
          );
        }
      }
    }

    this.logger.debug(CLASS_NAME, 'extractChangelog', `Extracted ${historyRows.length} changelog entries for: ${issue.key}`);
    return historyRows;
  }

  /**
   * Fetch GitHub dev status from the Jira REST API and persist branches
   * and pull requests. Delegates to JiraDevStatusService.
   *
   * @param issueId - The Jira issue internal ID (numeric)
   * @param issueKey - The Jira issue key (e.g., "IQS-100")
   * @returns Summary of branches and PRs saved
   */
  async fetchAndSaveGitHubDevStatus(
    issueId: string,
    issueKey: string,
  ): Promise<{ branchesSaved: number; prsSaved: number }> {
    this.logger.debug(CLASS_NAME, 'fetchAndSaveGitHubDevStatus', `Delegating to JiraDevStatusService for: ${issueKey}`);
    return this.devStatusService.fetchAndSave(issueId, issueKey);
  }

  /**
   * Update unfinished Jira issues: re-fetch issues not in Done/Cancelled
   * status and update their details, changelogs, and GitHub dev status.
   *
   * Maps from Python JiraApi.update_unfinished_change_logs2().
   *
   * Logic:
   * 1. Query for issues not in Done/Cancelled + recently completed (within daysAgo)
   * 2. For each issue:
   *    a. Re-fetch from Jira with expanded changelog
   *    b. Delete existing history, branches, PRs for that issue
   *    c. Re-insert updated issue details (upsert)
   *    d. Re-insert changelog entries
   *    e. Re-fetch and save GitHub dev status
   *
   * @param projectKeys - The project keys to process
   * @param daysAgo - Number of days to look back for recently completed issues
   * @returns Summary of the update operation
   */
  async updateUnfinishedIssues(
    projectKeys: readonly string[],
    daysAgo: number = DEFAULT_DAYS_AGO,
  ): Promise<UpdateUnfinishedResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'updateUnfinishedIssues', `Updating unfinished issues (daysAgo=${daysAgo}, projects=${projectKeys.join(',')})`);

    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'updateUnfinishedIssues',
      detail: `Updating unfinished issues (daysAgo=${daysAgo})`,
      status: 'START',
    });
    this.logger.info(CLASS_NAME, 'updateUnfinishedIssues', `Pipeline run started with id=${pipelineRunId}`);

    let issuesProcessed = 0;
    let issuesFailed = 0;
    let totalHistoryEntries = 0;
    let totalBranchesSaved = 0;
    let totalPrsSaved = 0;

    try {
      const unfinishedIssues = await this.jiraRepo.getUnfinishedJiraIssues2(daysAgo);
      this.logger.info(CLASS_NAME, 'updateUnfinishedIssues', `Found ${unfinishedIssues.length} unfinished issues`);

      for (const unfinished of unfinishedIssues) {
        try {
          this.logger.debug(CLASS_NAME, 'updateUnfinishedIssues', `Fetching issue: ${unfinished.jiraKey}`);

          const issue = await this.fetchIssueWithChangelog(unfinished.jiraKey);
          if (!issue) {
            this.logger.warn(CLASS_NAME, 'updateUnfinishedIssues', `Issue not found in Jira: ${unfinished.jiraKey}`);
            issuesFailed++;
            continue;
          }

          // Delete existing data for this issue before re-inserting
          await this.jiraRepo.deleteGitHubDataForKey(unfinished.jiraKey);
          await this.jiraRepo.deleteHistoryForKey(unfinished.jiraKey);

          // Extract project key from issue key
          const projectKey = issue.key.split('-')[0] ?? '';

          // Update issue details (upsert)
          const detail = extractIssueDetail(issue, projectKey, this.extractorConfig);
          await this.jiraRepo.upsertJiraDetail(detail);

          // Extract and save changelog
          const historyRows = this.extractChangelog(issue);
          if (historyRows.length > 0) {
            await this.jiraRepo.insertJiraHistory(historyRows);
            totalHistoryEntries += historyRows.length;
          }

          // Fetch and save GitHub dev status
          const devStatus = await this.devStatusService.fetchAndSave(issue.id, issue.key);
          totalBranchesSaved += devStatus.branchesSaved;
          totalPrsSaved += devStatus.prsSaved;

          issuesProcessed++;
          this.logger.debug(CLASS_NAME, 'updateUnfinishedIssues', `Processed: ${issue.key}`);

          // Log to pipeline (fire-and-forget)
          this.logPipelineJira(pipelineRunId, issue.key);

        } catch (error: unknown) {
          issuesFailed++;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'updateUnfinishedIssues', `Failed to process ${unfinished.jiraKey}: ${message}`);
        }
      }

      await this.safeLogTableCounts(pipelineRunId);
      await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FINISHED');
      this.logger.info(
        CLASS_NAME, 'updateUnfinishedIssues',
        `Complete: ${issuesProcessed} processed, ${issuesFailed} failed, ${totalHistoryEntries} history, ${totalBranchesSaved} branches, ${totalPrsSaved} PRs`,
      );

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'updateUnfinishedIssues', `Fatal error: ${message}`);
      await this.pipelineRepo.updatePipelineRun(pipelineRunId, `ERROR: ${message.substring(0, 200)}`);
    }

    const durationMs = Date.now() - startTime;
    this.logger.info(CLASS_NAME, 'updateUnfinishedIssues', `Duration: ${durationMs}ms`);

    return { issuesProcessed, issuesFailed, totalHistoryEntries, totalBranchesSaved, totalPrsSaved, durationMs };
  }

  /**
   * Process a single issue: extract changelog and fetch GitHub dev status.
   * Used during initial issue loading (called from JiraService).
   *
   * @param issue - The Jira issue with expanded changelog
   * @returns Counts of history entries and dev status items saved
   */
  async processIssueChangelogAndDevStatus(
    issue: Issue,
  ): Promise<{ historyCount: number; branchesSaved: number; prsSaved: number }> {
    this.logger.debug(CLASS_NAME, 'processIssueChangelogAndDevStatus', `Processing: ${issue.key}`);

    // Extract and save changelog
    const historyRows = this.extractChangelog(issue);
    let historyCount = 0;
    if (historyRows.length > 0) {
      await this.jiraRepo.insertJiraHistory(historyRows);
      historyCount = historyRows.length;
    }

    // Fetch and save GitHub dev status
    const devStatus = await this.devStatusService.fetchAndSave(issue.id, issue.key);

    this.logger.debug(
      CLASS_NAME, 'processIssueChangelogAndDevStatus',
      `Processed ${issue.key}: ${historyCount} history, ${devStatus.branchesSaved} branches, ${devStatus.prsSaved} PRs`,
    );

    return { historyCount, branchesSaved: devStatus.branchesSaved, prsSaved: devStatus.prsSaved };
  }

  // --------------------------------------------------------------------------
  // Private: Jira API helpers
  // --------------------------------------------------------------------------

  /**
   * Fetch a single issue from Jira with changelog expansion.
   * Uses the new enhanced search API (searchForIssuesUsingJqlEnhancedSearch).
   *
   * @param issueKey - The Jira issue key (e.g., "IQS-100")
   * @returns The issue with changelog, or null if not found
   */
  private async fetchIssueWithChangelog(issueKey: string): Promise<Issue | null> {
    this.logger.debug(CLASS_NAME, 'fetchIssueWithChangelog', `Fetching: ${issueKey}`);

    let retries = 0;
    let delayMs = DEFAULT_RATE_LIMIT_DELAY_MS;

    // Define fields and JQL for reuse in logging and request
    const jql = `key = "${issueKey}"`;
    const fields = [
      'summary', 'priority', 'status', 'created', 'reporter', 'assignee',
      'issuetype', 'resolution', 'fixVersions', 'components',
      'statuscategorychangedate', 'issuelinks', 'parent',
      this.config.pointsField,
    ];

    while (retries <= MAX_RATE_LIMIT_RETRIES) {
      try {
        // Log request details before API call for debugging
        logJqlSearchRequest({
          server: this.config.server,
          jql,
          startAt: 0,
          maxResults: 1,
          fields,
          expand: 'changelog',
          enabled: (this.config as { debugLogging?: boolean }).debugLogging,
        });

        // Use the new enhanced search API which calls /rest/api/3/search/jql
        const result = await this.jiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
          jql,
          maxResults: 1,
          expand: 'changelog',
          fields,
        });

        const issues = result.issues ?? [];
        if (issues.length === 0) {
          this.logger.debug(CLASS_NAME, 'fetchIssueWithChangelog', `Issue not found: ${issueKey}`);
          return null;
        }

        this.logger.trace(CLASS_NAME, 'fetchIssueWithChangelog', `Fetched: ${issueKey}`);
        return issues[0] ?? null;

      } catch (error: unknown) {
        if (this.isRateLimitError(error) && retries < MAX_RATE_LIMIT_RETRIES) {
          retries++;
          this.logger.warn(CLASS_NAME, 'fetchIssueWithChangelog', `Rate limited. Retry ${retries}/${MAX_RATE_LIMIT_RETRIES} after ${delayMs}ms`);
          await this.delay(delayMs);
          delayMs = Math.min(delayMs * 2, MAX_RATE_LIMIT_DELAY_MS);
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(CLASS_NAME, 'fetchIssueWithChangelog', `Failed to fetch ${issueKey}: ${message}`);
        return null;
      }
    }

    this.logger.error(CLASS_NAME, 'fetchIssueWithChangelog', `Rate limit retries exhausted for: ${issueKey}`);
    return null;
  }

  // --------------------------------------------------------------------------
  // Private: Rate limiting and utility
  // --------------------------------------------------------------------------

  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('429') || message.includes('rate limit') || message.includes('too many requests');
    }
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --------------------------------------------------------------------------
  // Private: Pipeline logging
  // --------------------------------------------------------------------------

  private logPipelineJira(pipelineRunId: number, jiraKey: string): void {
    this.pipelineRepo.insertPipelineLog({
      parentId: pipelineRunId,
      className: CLASS_NAME,
      context: 'updateUnfinishedIssues',
      detail: `Updated ${jiraKey}`,
      msgLevel: 5,
    }, undefined, jiraKey).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'logPipelineJira', `Pipeline log insert failed: ${msg}`);
    });
  }

  private async safeLogTableCounts(pipelineRunId: number): Promise<void> {
    try {
      await this.pipelineRepo.logTableCounts(pipelineRunId, [
        'jira_detail', 'jira_history', 'jira_issue_link', 'jira_parent',
        'jira_github_branch', 'jira_github_pullrequest',
        'gitr_pipeline_jira', 'gitr_pipeline_log', 'gitr_pipeline_run',
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'safeLogTableCounts', `Failed to log table counts: ${message}`);
    }
  }
}
