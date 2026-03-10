/**
 * Jira issue loading service using jira.js Version3Client.
 *
 * Orchestrates loading Jira issues for configured projects and persisting
 * them to PostgreSQL. Field extraction is delegated to jira-issue-extractor.ts.
 *
 * Converts Python JiraApi.py orchestration methods to TypeScript:
 *   load_all_project_issues -> loadProjectIssues
 *
 * CRITICAL differences from Python:
 *   - Python uses `jira` library with issue-by-key iteration (PROJECT-1, PROJECT-2...)
 *     => TypeScript uses jira.js Version3Client with JQL search for efficiency
 *   - Python writes f-string SQL files (SQL injection risk)
 *     => TypeScript uses JiraRepository with parameterized queries
 *   - Python reads credentials from classified.properties
 *     => TypeScript uses VS Code SecretStorage
 *   - Python hardcodes Jira server URL in code
 *     => TypeScript reads from VS Code settings
 *   - Python customfield_10034 hardcoded
 *     => TypeScript reads from configurable gitrx.jira.pointsField setting
 *
 * Ticket: IQS-856
 */

import { Version3Client } from 'jira.js';
import type { Issue } from 'jira.js/out/version3/models/index.js';
import { LoggerService } from '../logging/logger.js';
import { JiraRepository } from '../database/jira-repository.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import {
  extractIssueDetail,
  extractIssueLinks,
  extractIssueParent,
} from './jira-issue-extractor.js';
import type { JiraExtractorConfig } from './jira-issue-extractor.js';
import {
  createJiraClient,
  logJqlSearchRequest,
} from './jira-client-factory.js';

// Re-export extractor functions for convenience
export {
  extractIssueDetail,
  extractIssueLinks,
  extractIssueParent,
  parseJiraDate,
} from './jira-issue-extractor.js';
export type { JiraExtractorConfig } from './jira-issue-extractor.js';

// ============================================================================
// Configuration types
// ============================================================================

/**
 * Configuration for the JiraService.
 * Composed from VS Code settings and SecretStorage.
 */
export interface JiraServiceConfig {
  /** Jira server URL (e.g., https://yourorg.atlassian.net). */
  readonly server: string;
  /** Jira username (email) for API authentication. */
  readonly username: string;
  /** Jira API token from SecretStorage. */
  readonly token: string;
  /** Custom field ID for story points (default: customfield_10034). */
  readonly pointsField: string;
  /** Enable verbose debug logging for Jira API requests/responses. */
  readonly debugLogging?: boolean;
}

/**
 * Options for loading project issues.
 */
export interface LoadProjectIssuesOptions {
  /** Start at this issue number (inclusive). 0 = beginning. */
  readonly startKey: number;
  /** Maximum issue number to scan. 0 = auto-detect from database. */
  readonly maxKeys: number;
}

/**
 * Result summary from loading project issues.
 */
export interface LoadProjectIssuesResult {
  /** The project key that was loaded. */
  readonly projectKey: string;
  /** Number of new issues inserted. */
  readonly issuesInserted: number;
  /** Number of issues skipped (already known). */
  readonly issuesSkipped: number;
  /** Number of issue links inserted. */
  readonly linksInserted: number;
  /** Number of parent relationships inserted. */
  readonly parentsInserted: number;
  /** Number of issues that failed to load. */
  readonly issuesFailed: number;
  /** Duration of the load operation in milliseconds. */
  readonly durationMs: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'JiraService';

/**
 * Maximum number of issues per JQL search page.
 * Jira Cloud API caps at 100 per page.
 */
const JQL_PAGE_SIZE = 50;

/**
 * Buffer to add beyond known max key when auto-detecting max keys.
 * Accounts for potential gaps in Jira issue numbering.
 */
const AUTO_DETECT_BUFFER = 100;

/**
 * Default delay between API requests in milliseconds for rate limiting.
 */
const DEFAULT_RATE_LIMIT_DELAY_MS = 200;

/**
 * Maximum delay for exponential backoff on rate limit (429) responses.
 */
const MAX_RATE_LIMIT_DELAY_MS = 30_000;

/**
 * Maximum retries on rate-limited (429) responses before giving up.
 */
const MAX_RATE_LIMIT_RETRIES = 5;

// ============================================================================
// JiraService implementation
// ============================================================================

/**
 * Service for loading Jira issues and persisting them to PostgreSQL.
 *
 * Uses jira.js Version3Client for the Jira REST API and JiraRepository
 * for parameterized database operations. Supports incremental loading,
 * issue link extraction, parent extraction, and pipeline run tracking.
 *
 * Maps from Python JiraApi.py class with these improvements:
 * - JQL search instead of issue-by-key iteration
 * - Parameterized SQL instead of f-string interpolation
 * - Rate limiting awareness with exponential backoff
 * - Configurable points field
 * - Proper error handling per issue (continues on individual failure)
 */
export class JiraService {
  private readonly logger: LoggerService;
  private readonly jiraClient: Version3Client;
  private readonly jiraRepo: JiraRepository;
  private readonly pipelineRepo: PipelineRepository;
  private readonly config: JiraServiceConfig;
  private readonly extractorConfig: JiraExtractorConfig;

  constructor(
    config: JiraServiceConfig,
    jiraRepo: JiraRepository,
    pipelineRepo: PipelineRepository,
    jiraClient?: Version3Client,
  ) {
    this.config = config;
    this.jiraRepo = jiraRepo;
    this.pipelineRepo = pipelineRepo;
    this.logger = LoggerService.getInstance();

    // Build extractor config from service config
    this.extractorConfig = {
      server: config.server,
      pointsField: config.pointsField,
    };

    // Allow injection of jira client for testing
    // Use factory for debug logging middleware when not injected
    this.jiraClient = jiraClient ?? createJiraClient({
      server: config.server,
      username: config.username,
      token: config.token,
      enableDebugLogging: config.debugLogging,
    });

    this.logger.debug(CLASS_NAME, 'constructor', `JiraService created for server: ${config.server}`);
    this.logger.debug(CLASS_NAME, 'constructor', `Points field: ${config.pointsField}`);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Load all issues for a Jira project key.
   * Uses JQL search for efficiency instead of iterating by key number.
   * Skips already-known issues (incremental loading).
   *
   * Maps from Python JiraApi.load_all_project_issues().
   *
   * @param projectKey - The Jira project key (e.g., "IQS")
   * @param options - Optional start key and max keys for range control
   * @returns Summary of the load operation
   */
  async loadProjectIssues(
    projectKey: string,
    options: LoadProjectIssuesOptions = { startKey: 0, maxKeys: 0 },
  ): Promise<LoadProjectIssuesResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'loadProjectIssues', `Loading issues for project: ${projectKey}`);
    this.logger.debug(CLASS_NAME, 'loadProjectIssues', `Options: startKey=${options.startKey}, maxKeys=${options.maxKeys}`);

    // Start pipeline run tracking
    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'loadProjectIssues',
      detail: `Loading Jira issues for ${projectKey}`,
      status: 'START',
    });
    this.logger.info(CLASS_NAME, 'loadProjectIssues', `Pipeline run started with id=${pipelineRunId}`);

    let issuesInserted = 0;
    let issuesSkipped = 0;
    let linksInserted = 0;
    let parentsInserted = 0;
    let issuesFailed = 0;

    try {
      // Get known issue keys for incremental loading
      const knownKeys = await this.jiraRepo.getDistinctJiraKeysFromDetails();
      this.logger.info(CLASS_NAME, 'loadProjectIssues', `Known issue keys in database: ${knownKeys.size}`);

      // Determine effective max key
      const effectiveMaxKeys = await this.resolveMaxKeys(projectKey, options.maxKeys);
      this.logger.info(CLASS_NAME, 'loadProjectIssues', `Effective max keys: ${effectiveMaxKeys}`);

      // Build JQL query - effectiveMaxKeys=0 builds unbounded query (loads all)
      const jql = this.buildJqlQuery(projectKey, options.startKey, effectiveMaxKeys);
      this.logger.debug(CLASS_NAME, 'loadProjectIssues', `JQL query: ${jql}`);

      // Paginate through all results
      const counts = await this.paginateAndProcess(
        jql, projectKey, knownKeys, pipelineRunId,
      );
      issuesInserted = counts.inserted;
      issuesSkipped = counts.skipped;
      linksInserted = counts.links;
      parentsInserted = counts.parents;
      issuesFailed = counts.failed;

      // Log table counts (matches Python log_table_counts call)
      await this.safeLogTableCounts(pipelineRunId);

      await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FINISHED');
      this.logger.info(CLASS_NAME, 'loadProjectIssues', `Completed: ${issuesInserted} inserted, ${issuesSkipped} skipped, ${issuesFailed} failed`);

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'loadProjectIssues', `Fatal error loading ${projectKey}: ${message}`);
      await this.pipelineRepo.updatePipelineRun(pipelineRunId, `ERROR: ${message.substring(0, 200)}`);
    }

    const durationMs = Date.now() - startTime;
    this.logger.info(CLASS_NAME, 'loadProjectIssues', `Duration: ${durationMs}ms`);

    return {
      projectKey, issuesInserted, issuesSkipped,
      linksInserted, parentsInserted, issuesFailed, durationMs,
    };
  }

  /**
   * Load issues for all configured project keys.
   *
   * @param projectKeys - Array of Jira project keys to load
   * @param options - Optional start key and max keys
   * @returns Array of results, one per project
   */
  async loadAllProjects(
    projectKeys: readonly string[],
    options: LoadProjectIssuesOptions = { startKey: 0, maxKeys: 0 },
  ): Promise<LoadProjectIssuesResult[]> {
    this.logger.info(CLASS_NAME, 'loadAllProjects', `Loading ${projectKeys.length} projects: ${projectKeys.join(', ')}`);

    const results: LoadProjectIssuesResult[] = [];
    for (const projectKey of projectKeys) {
      const result = await this.loadProjectIssues(projectKey, options);
      results.push(result);
    }

    const totalInserted = results.reduce((sum, r) => sum + r.issuesInserted, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.issuesSkipped, 0);
    this.logger.info(CLASS_NAME, 'loadAllProjects', `All projects complete: ${totalInserted} inserted, ${totalSkipped} skipped`);

    return results;
  }

  // --------------------------------------------------------------------------
  // JQL query building
  // --------------------------------------------------------------------------

  /**
   * Build a JQL query for fetching project issues.
   * Uses JQL search instead of Python's sequential key iteration for efficiency.
   *
   * @param projectKey - The Jira project key
   * @param startKey - Starting issue number (0 = from beginning)
   * @param maxKeys - Maximum issue number to fetch up to (0 = unbounded)
   * @returns A JQL query string
   */
  buildJqlQuery(projectKey: string, startKey: number, maxKeys: number): string {
    this.logger.trace(CLASS_NAME, 'buildJqlQuery', `Building JQL for ${projectKey}: start=${startKey}, max=${maxKeys}`);

    // Base query: all issues in the project, ordered by key ascending
    let jql = `project = "${projectKey}" ORDER BY key ASC`;

    // If we have key bounds, filter by them
    if (startKey > 0 && maxKeys > 0) {
      jql = `project = "${projectKey}" AND key >= "${projectKey}-${startKey}" AND key <= "${projectKey}-${maxKeys}" ORDER BY key ASC`;
    } else if (startKey > 0) {
      jql = `project = "${projectKey}" AND key >= "${projectKey}-${startKey}" ORDER BY key ASC`;
    } else if (maxKeys > 0) {
      jql = `project = "${projectKey}" AND key <= "${projectKey}-${maxKeys}" ORDER BY key ASC`;
    }

    this.logger.trace(CLASS_NAME, 'buildJqlQuery', `Built JQL: ${jql}`);
    return jql;
  }

  // --------------------------------------------------------------------------
  // Pagination and issue processing
  // --------------------------------------------------------------------------

  /**
   * Paginate through JQL search results and process each issue.
   *
   * @returns Aggregate counts of processed issues
   */
  private async paginateAndProcess(
    jql: string,
    projectKey: string,
    knownKeys: Set<string>,
    pipelineRunId: number,
  ): Promise<{ inserted: number; skipped: number; links: number; parents: number; failed: number }> {
    let inserted = 0;
    let skipped = 0;
    let links = 0;
    let parents = 0;
    let failed = 0;

    let startAt = 0;
    let hasMore = true;

    while (hasMore) {
      this.logger.debug(CLASS_NAME, 'paginateAndProcess', `Fetching page: startAt=${startAt}, pageSize=${JQL_PAGE_SIZE}`);

      const searchResult = await this.searchWithRateLimiting(jql, startAt);
      if (!searchResult) {
        this.logger.error(CLASS_NAME, 'paginateAndProcess', 'Search returned null after rate limit retries');
        break;
      }

      const totalIssues = searchResult.total ?? 0;
      const issues = searchResult.issues ?? [];
      this.logger.debug(CLASS_NAME, 'paginateAndProcess', `Page returned ${issues.length} issues (total: ${totalIssues})`);

      for (const issue of issues) {
        try {
          const result = await this.processIssue(issue, projectKey, knownKeys, pipelineRunId);
          if (result === 'skipped') {
            skipped++;
          } else {
            inserted++;
            links += result.linksCount;
            parents += result.parentCount;
          }
        } catch (error: unknown) {
          failed++;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'paginateAndProcess', `Failed to process issue ${issue.key}: ${message}`);
        }
      }

      // Check if more pages are available
      startAt += issues.length;
      hasMore = startAt < totalIssues && issues.length > 0;

      if (hasMore) {
        // Respectful rate limiting between pages
        await this.delay(DEFAULT_RATE_LIMIT_DELAY_MS);
      }
    }

    return { inserted, skipped, links, parents, failed };
  }

  /**
   * Process a single Jira issue: extract data, persist to database,
   * and log to pipeline.
   *
   * @returns 'skipped' if already known, or counts of inserted sub-records
   */
  private async processIssue(
    issue: Issue,
    projectKey: string,
    knownKeys: Set<string>,
    pipelineRunId: number,
  ): Promise<'skipped' | { linksCount: number; parentCount: number }> {
    // Skip already-known issues
    if (knownKeys.has(issue.key)) {
      this.logger.trace(CLASS_NAME, 'processIssue', `Skipping known issue: ${issue.key}`);
      return 'skipped';
    }

    // Extract and persist issue detail
    const detail = extractIssueDetail(issue, projectKey, this.extractorConfig);
    await this.jiraRepo.upsertJiraDetail(detail);

    // Extract and persist issue links
    let linksCount = 0;
    const issueLinksData = extractIssueLinks(issue.key, issue);
    if (issueLinksData.length > 0) {
      await this.jiraRepo.replaceJiraIssueLinks(issue.key, issueLinksData);
      linksCount = issueLinksData.length;
    }

    // Extract and persist parent
    let parentCount = 0;
    const parent = extractIssueParent(issue.key, issue);
    if (parent) {
      await this.jiraRepo.insertJiraParents([parent]);
      parentCount = 1;
    }

    // Track in pipeline
    knownKeys.add(issue.key);
    this.logger.debug(CLASS_NAME, 'processIssue', `Committed issue: ${issue.key}`);

    // Log to pipeline (fire-and-forget)
    this.logPipelineJira(pipelineRunId, issue.key);

    return { linksCount, parentCount };
  }

  // --------------------------------------------------------------------------
  // Rate limiting and API helpers
  // --------------------------------------------------------------------------

  /**
   * Execute a JQL search with rate limiting awareness.
   * Implements exponential backoff on 429 (Too Many Requests) responses.
   *
   * @param jql - The JQL query to execute
   * @param startAt - The starting index for pagination
   * @returns The search results, or null if rate limit retries exhausted
   */
  private async searchWithRateLimiting(
    jql: string,
    startAt: number,
  ): Promise<{ total?: number; issues?: Issue[] } | null> {
    let retries = 0;
    let delayMs = DEFAULT_RATE_LIMIT_DELAY_MS;

    // Define fields for reuse in logging and request
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
          startAt,
          maxResults: JQL_PAGE_SIZE,
          fields,
          enabled: this.config.debugLogging,
        });

        const result = await this.jiraClient.issueSearch.searchForIssuesUsingJql({
          jql,
          startAt,
          maxResults: JQL_PAGE_SIZE,
          fields,
        });

        this.logger.trace(CLASS_NAME, 'searchWithRateLimiting', `Search returned ${result.issues?.length ?? 0} issues`);
        return result;

      } catch (error: unknown) {
        const isRateLimited = this.isRateLimitError(error);
        if (isRateLimited && retries < MAX_RATE_LIMIT_RETRIES) {
          retries++;
          this.logger.warn(CLASS_NAME, 'searchWithRateLimiting', `Rate limited (429). Retry ${retries}/${MAX_RATE_LIMIT_RETRIES} after ${delayMs}ms`);
          await this.delay(delayMs);
          delayMs = Math.min(delayMs * 2, MAX_RATE_LIMIT_DELAY_MS);
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(CLASS_NAME, 'searchWithRateLimiting', `Search failed: ${message}`);
        throw error;
      }
    }

    this.logger.error(CLASS_NAME, 'searchWithRateLimiting', `Rate limit retries exhausted after ${MAX_RATE_LIMIT_RETRIES} attempts`);
    return null;
  }

  /**
   * Check if an error is a rate limit (429) response.
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('429') || message.includes('rate limit') || message.includes('too many requests');
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Max key resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve the effective max keys for a project.
   * If maxKeys is 0, auto-detect from the database by finding the highest
   * known issue number and adding a buffer.
   * If no known issues exist, returns 0 to build an unbounded JQL query.
   *
   * @param projectKey - The project key
   * @param configuredMaxKeys - The configured max keys (0 = auto-detect)
   * @returns The effective max keys value (0 = unbounded JQL)
   */
  private async resolveMaxKeys(projectKey: string, configuredMaxKeys: number): Promise<number> {
    if (configuredMaxKeys > 0) {
      this.logger.debug(CLASS_NAME, 'resolveMaxKeys', `Using configured maxKeys: ${configuredMaxKeys}`);
      return configuredMaxKeys;
    }

    this.logger.debug(CLASS_NAME, 'resolveMaxKeys', `Auto-detecting maxKeys for ${projectKey}`);

    const maxIssues = await this.jiraRepo.identifyJiraProjMaxIssue();
    const projectMax = maxIssues.find((m) => m.jiraKey === projectKey);

    if (projectMax) {
      const detected = projectMax.count + AUTO_DETECT_BUFFER;
      this.logger.debug(CLASS_NAME, 'resolveMaxKeys', `Auto-detected maxKeys for ${projectKey}: ${projectMax.count} + ${AUTO_DETECT_BUFFER} = ${detected}`);
      return detected;
    }

    // No known issues for this project - return 0 for unbounded JQL
    // This allows initial load to fetch ALL issues in the project
    this.logger.debug(CLASS_NAME, 'resolveMaxKeys', `No known issues for ${projectKey}, using unbounded JQL query`);
    return 0;
  }

  // --------------------------------------------------------------------------
  // Pipeline logging
  // --------------------------------------------------------------------------

  /**
   * Log a Jira issue to the pipeline (fire-and-forget).
   */
  private logPipelineJira(pipelineRunId: number, jiraKey: string): void {
    this.pipelineRepo.insertPipelineLog({
      parentId: pipelineRunId,
      className: CLASS_NAME,
      context: 'loadProjectIssues',
      detail: `Loaded ${jiraKey}`,
      msgLevel: 5, // CRITICAL level matching Python logging.CRITICAL
    }, undefined, jiraKey).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'logPipelineJira', `Pipeline log insert failed: ${msg}`);
    });
  }

  /**
   * Log table counts with error handling.
   */
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

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /**
   * Delay execution for a specified number of milliseconds.
   * Used for rate limiting between API requests.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
