/**
 * Jira backfill service for clearing and reloading all Jira data.
 *
 * Provides a recovery mechanism when the initial Jira load fails mid-way.
 * The regular pipeline uses incremental loading (from max issue key forward),
 * so partial initial loads result in missing earlier issues.
 *
 * This service:
 *   1. Validates Jira credentials (before clearing any data)
 *   2. Clears all Jira-related tables (preserves commit_jira mappings)
 *   3. Triggers a full reload from the Jira API (maxKeys=0 for unbounded JQL)
 *   4. Reports progress and final summary
 *
 * Ticket: IQS-933
 */

import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import { JiraRepository } from '../database/jira-repository.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import { JiraService, type LoadProjectIssuesResult } from './jira-service.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result summary from a Jira backfill operation.
 */
export interface JiraBackfillResult {
  /** Number of issues cleared from jira_detail before reload. */
  readonly issuesClearedBefore: number;
  /** Total issues loaded after clearing (across all projects). */
  readonly issuesLoaded: number;
  /** Issues that failed to load. */
  readonly issuesFailed: number;
  /** Duration of the entire backfill operation in milliseconds. */
  readonly durationMs: number;
  /** Whether the operation was cancelled by the user. */
  readonly cancelled: boolean;
  /** Per-project load results. */
  readonly projectResults: readonly LoadProjectIssuesResult[];
}

// ============================================================================
// Constants
// ============================================================================

/** Class name for structured logging. */
const CLASS_NAME = 'JiraBackfillService';

// ============================================================================
// JiraBackfillService implementation
// ============================================================================

/**
 * Service for clearing and reloading all Jira data.
 *
 * Use this to recover from failed initial loads or to force a full refresh.
 * The operation is destructive: all Jira tables are truncated (except commit_jira).
 *
 * Prerequisites:
 *   - Valid Jira credentials (server, username, token)
 *   - Database connection
 *   - User confirmation (handled by the command caller)
 */
export class JiraBackfillService {
  private readonly logger: LoggerService;
  private readonly jiraRepo: JiraRepository;
  private readonly pipelineRepo: PipelineRepository;
  private readonly jiraService: JiraService;
  private readonly projectKeys: readonly string[];

  /**
   * Create a new JiraBackfillService.
   *
   * @param jiraRepo - Repository for Jira database operations
   * @param pipelineRepo - Repository for pipeline logging
   * @param jiraService - Service for loading Jira issues via API
   * @param projectKeys - Jira project keys to reload (from settings)
   */
  constructor(
    jiraRepo: JiraRepository,
    pipelineRepo: PipelineRepository,
    jiraService: JiraService,
    projectKeys: readonly string[],
  ) {
    this.jiraRepo = jiraRepo;
    this.pipelineRepo = pipelineRepo;
    this.jiraService = jiraService;
    this.projectKeys = projectKeys;
    this.logger = LoggerService.getInstance();

    this.logger.debug(CLASS_NAME, 'constructor', `JiraBackfillService created with ${projectKeys.length} project keys`);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Run the complete Jira backfill operation.
   *
   * Steps:
   *   1. Validate Jira credentials (attempt a simple API call)
   *   2. Clear all Jira tables (atomic transaction)
   *   3. Reload all issues for configured project keys (maxKeys=0 for unbounded)
   *   4. Report progress throughout
   *
   * @param progress - VS Code progress reporter for status updates
   * @param token - Cancellation token for user abort
   * @returns Summary of the backfill operation
   */
  async runBackfill(
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<JiraBackfillResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'runBackfill', 'Starting Jira backfill operation');

    // Initialize result tracking
    let issuesClearedBefore = 0;
    let issuesLoaded = 0;
    let issuesFailed = 0;
    const projectResults: LoadProjectIssuesResult[] = [];

    // Start pipeline tracking
    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'runBackfill',
      detail: `Jira backfill: ${this.projectKeys.length} projects`,
      status: 'START',
    });
    this.logger.info(CLASS_NAME, 'runBackfill', `Pipeline run started with id=${pipelineRunId}`);

    try {
      // Check for cancellation before each major step
      if (token.isCancellationRequested) {
        this.logger.info(CLASS_NAME, 'runBackfill', 'Backfill cancelled before credential validation');
        await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'CANCELLED');
        return this.buildResult(issuesClearedBefore, issuesLoaded, issuesFailed, startTime, true, projectResults);
      }

      // Step 1: Validate credentials with a test API call
      progress.report({ message: 'Validating Jira credentials...' });
      this.logger.info(CLASS_NAME, 'runBackfill', 'Validating Jira credentials');

      const credentialsValid = await this.validateCredentials();
      if (!credentialsValid) {
        this.logger.error(CLASS_NAME, 'runBackfill', 'Jira credential validation failed');
        await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'ERROR: Credential validation failed');
        throw new Error('Jira credential validation failed. Please verify your Jira server, username, and API token.');
      }
      this.logger.info(CLASS_NAME, 'runBackfill', 'Jira credentials validated successfully');

      // Check for cancellation after credential validation
      if (token.isCancellationRequested) {
        this.logger.info(CLASS_NAME, 'runBackfill', 'Backfill cancelled after credential validation');
        await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'CANCELLED');
        return this.buildResult(issuesClearedBefore, issuesLoaded, issuesFailed, startTime, true, projectResults);
      }

      // Step 2: Clear all Jira tables
      progress.report({ message: 'Clearing Jira tables...' });
      this.logger.info(CLASS_NAME, 'runBackfill', 'Clearing all Jira tables');

      const clearResult = await this.jiraRepo.clearAllJiraData();
      issuesClearedBefore = clearResult.countBefore;

      await this.pipelineRepo.insertPipelineLog({
        parentId: pipelineRunId,
        className: CLASS_NAME,
        context: 'runBackfill',
        detail: `Cleared ${issuesClearedBefore} Jira issues`,
        msgLevel: 5,
      });

      this.logger.info(CLASS_NAME, 'runBackfill', `Cleared ${issuesClearedBefore} Jira issues from database`);

      // Note: No cancellation check after clearing - we must reload to avoid leaving tables empty

      // Step 3: Reload all issues for each configured project
      if (this.projectKeys.length === 0) {
        this.logger.warn(CLASS_NAME, 'runBackfill', 'No project keys configured. Skipping Jira reload.');
        await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FINISHED (no projects configured)');
        return this.buildResult(issuesClearedBefore, issuesLoaded, issuesFailed, startTime, false, projectResults);
      }

      this.logger.info(CLASS_NAME, 'runBackfill', `Loading issues for ${this.projectKeys.length} projects: ${this.projectKeys.join(', ')}`);

      for (let i = 0; i < this.projectKeys.length; i++) {
        const projectKey = this.projectKeys[i];
        if (!projectKey) {
          this.logger.warn(CLASS_NAME, 'runBackfill', `Skipping undefined project key at index ${i}`);
          continue;
        }
        const progressPct = Math.round((i / this.projectKeys.length) * 100);

        progress.report({
          message: `Loading ${projectKey}... (${i + 1}/${this.projectKeys.length})`,
          increment: i === 0 ? 0 : (100 / this.projectKeys.length),
        });

        this.logger.info(CLASS_NAME, 'runBackfill', `[${progressPct}%] Loading project ${projectKey} (${i + 1}/${this.projectKeys.length})`);

        // Load with maxKeys=0 for unbounded JQL (all issues in project)
        const loadResult = await this.jiraService.loadProjectIssues(projectKey, { startKey: 0, maxKeys: 0 });

        projectResults.push(loadResult);
        issuesLoaded += loadResult.issuesInserted;
        issuesFailed += loadResult.issuesFailed;

        this.logger.info(
          CLASS_NAME, 'runBackfill',
          `Project ${projectKey}: ${loadResult.issuesInserted} loaded, ${loadResult.issuesFailed} failed (${loadResult.durationMs}ms)`,
        );

        await this.pipelineRepo.insertPipelineLog({
          parentId: pipelineRunId,
          className: CLASS_NAME,
          context: 'runBackfill',
          detail: `${projectKey}: ${loadResult.issuesInserted} loaded, ${loadResult.issuesFailed} failed`,
          msgLevel: 5,
        });
      }

      // Final progress update
      progress.report({ message: 'Backfill complete!', increment: 100 });

      // Log final table counts
      await this.safeLogTableCounts(pipelineRunId);

      await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FINISHED');
      this.logger.info(
        CLASS_NAME, 'runBackfill',
        `Backfill complete: cleared ${issuesClearedBefore}, loaded ${issuesLoaded}, failed ${issuesFailed}`,
      );

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'runBackfill', `Backfill failed: ${message}`);
      await this.pipelineRepo.updatePipelineRun(pipelineRunId, `ERROR: ${message.substring(0, 200)}`);
      throw error;
    }

    return this.buildResult(issuesClearedBefore, issuesLoaded, issuesFailed, startTime, false, projectResults);
  }

  // --------------------------------------------------------------------------
  // Private: Credential validation
  // --------------------------------------------------------------------------

  /**
   * Validate Jira credentials by attempting a lightweight API call.
   * Uses the JiraService to attempt loading a minimal query.
   *
   * @returns true if credentials are valid with API access
   */
  private async validateCredentials(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'validateCredentials', 'Testing Jira API access');

    try {
      // Attempt to load a single project with a very limited range
      // This will fail fast if credentials are invalid
      if (this.projectKeys.length === 0) {
        this.logger.warn(CLASS_NAME, 'validateCredentials', 'No project keys configured, cannot validate');
        return false;
      }

      const testProject = this.projectKeys[0];
      if (!testProject) {
        this.logger.warn(CLASS_NAME, 'validateCredentials', 'First project key is undefined');
        return false;
      }
      this.logger.debug(CLASS_NAME, 'validateCredentials', `Testing with project ${testProject}`);

      // Load with startKey=1, maxKeys=1 to minimize data transfer
      // This triggers a JQL query which will fail if auth is wrong
      const result = await this.jiraService.loadProjectIssues(testProject, { startKey: 1, maxKeys: 1 });

      // Even if no issues are found, a successful API call means credentials work
      this.logger.debug(CLASS_NAME, 'validateCredentials', `Test query succeeded: ${result.issuesInserted + result.issuesSkipped} issues found`);
      return true;

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'validateCredentials', `Credential validation failed: ${message}`);

      // Check for common auth errors
      if (message.includes('401') || message.includes('Unauthorized')) {
        this.logger.error(CLASS_NAME, 'validateCredentials', 'Invalid Jira credentials (401 Unauthorized)');
      } else if (message.includes('403') || message.includes('Forbidden')) {
        this.logger.error(CLASS_NAME, 'validateCredentials', 'Jira access forbidden (403). Check API token permissions.');
      }

      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Private: Pipeline logging
  // --------------------------------------------------------------------------

  /**
   * Log table counts with error handling.
   */
  private async safeLogTableCounts(pipelineRunId: number): Promise<void> {
    try {
      await this.pipelineRepo.logTableCounts(pipelineRunId, [
        'jira_detail', 'jira_history', 'jira_issue_link', 'jira_parent',
        'jira_github_branch', 'jira_github_pullrequest', 'commit_jira',
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'safeLogTableCounts', `Failed to log table counts: ${message}`);
    }
  }

  // --------------------------------------------------------------------------
  // Private: Result building
  // --------------------------------------------------------------------------

  /**
   * Build a JiraBackfillResult from the operation state.
   */
  private buildResult(
    issuesClearedBefore: number,
    issuesLoaded: number,
    issuesFailed: number,
    startTime: number,
    cancelled: boolean,
    projectResults: readonly LoadProjectIssuesResult[],
  ): JiraBackfillResult {
    const durationMs = Date.now() - startTime;
    return {
      issuesClearedBefore,
      issuesLoaded,
      issuesFailed,
      durationMs,
      cancelled,
      projectResults,
    };
  }
}
