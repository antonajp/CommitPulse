/**
 * Linear issue loading service using @linear/sdk.
 *
 * Fetches issues from Linear's GraphQL API and persists them to PostgreSQL
 * via LinearRepository. Supports cursor-based pagination, rate limiting
 * with exponential backoff, and incremental loading.
 *
 * Parallel to JiraService with Linear-specific API patterns.
 *
 * Ticket: IQS-875
 */

import { LinearClient } from '@linear/sdk';
import { LoggerService } from '../logging/logger.js';
import { LinearRepository } from '../database/linear-repository.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import { extractLinearDetail } from './linear-issue-extractor.js';
import type { LinearIssueData } from './linear-issue-extractor.js';

// Re-export extractor for convenience
export { extractLinearDetail, mapPriority } from './linear-issue-extractor.js';
export type { LinearIssueData } from './linear-issue-extractor.js';

// ============================================================================
// Configuration types
// ============================================================================

/**
 * Configuration for the LinearService.
 * Token comes from VS Code SecretStorage.
 */
export interface LinearServiceConfig {
  /** Linear API key from SecretStorage (starts with lin_api_). */
  readonly token: string;
}

/**
 * Options for loading team issues.
 */
export interface LoadTeamIssuesOptions {
  /** Start at this issue number (inclusive). 0 = beginning. */
  readonly startKey: number;
  /** Maximum issue number to scan. 0 = unbounded. */
  readonly maxKeys: number;
}

/**
 * Result summary from loading team issues.
 */
export interface LoadTeamIssuesResult {
  /** The team key that was loaded. */
  readonly teamKey: string;
  /** Number of new issues inserted. */
  readonly issuesInserted: number;
  /** Number of issues skipped (already known). */
  readonly issuesSkipped: number;
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
const CLASS_NAME = 'LinearService';

/**
 * Default delay between API requests in milliseconds.
 * Linear allows 3,000 req/min which is generous, but we stay polite.
 */
const DEFAULT_RATE_LIMIT_DELAY_MS = 50;

/**
 * Maximum delay for exponential backoff on rate limit responses.
 */
const MAX_RATE_LIMIT_DELAY_MS = 30_000;

/**
 * Maximum retries on rate-limited or transient failure responses.
 */
const MAX_RETRIES = 3;

/**
 * Number of issues to fetch per GraphQL page.
 */
const PAGE_SIZE = 50;

// ============================================================================
// Raw GraphQL response types for eager-loaded queries
// ============================================================================

/**
 * Shape of the raw GraphQL response from TEAM_ISSUES_QUERY.
 * Matches the query structure so we can avoid SDK lazy-loading overhead.
 */
interface RawTeamIssuesResponse {
  team: {
    issues: {
      nodes: Array<{
        id: string;
        identifier: string;
        title: string;
        description?: string | null;
        priority: number;
        estimate?: number | null;
        createdAt: string;
        completedAt?: string | null;
        url: string;
        state?: { name: string } | null;
        assignee?: { name: string } | null;
        creator?: { name: string } | null;
        project?: { name: string } | null;
        team?: { key: string; name: string } | null;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor?: string | null;
      };
    };
  };
}

// ============================================================================
// LinearService implementation
// ============================================================================

/**
 * Service for loading Linear issues and persisting them to PostgreSQL.
 *
 * Uses @linear/sdk for the Linear GraphQL API and LinearRepository
 * for parameterized database operations. Supports incremental loading
 * and pipeline run tracking.
 *
 * Ticket: IQS-875
 */
export class LinearService {
  private readonly logger: LoggerService;
  private readonly linearClient: LinearClient;
  private readonly linearRepo: LinearRepository;
  private readonly pipelineRepo: PipelineRepository;

  constructor(
    config: LinearServiceConfig,
    linearRepo: LinearRepository,
    pipelineRepo: PipelineRepository,
    linearClient?: LinearClient,
  ) {
    this.linearRepo = linearRepo;
    this.pipelineRepo = pipelineRepo;
    this.logger = LoggerService.getInstance();

    // Allow injection of Linear client for testing
    this.linearClient = linearClient ?? new LinearClient({ apiKey: config.token });

    this.logger.debug(CLASS_NAME, 'constructor', 'LinearService created');
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Load all issues for a Linear team key.
   * Uses cursor-based pagination via @linear/sdk.
   * Skips already-known issues (incremental loading).
   *
   * @param teamKey - The Linear team key (e.g., "IQS")
   * @param options - Optional start key and max keys for range control
   * @returns Summary of the load operation
   */
  async loadTeamIssues(
    teamKey: string,
    options: LoadTeamIssuesOptions = { startKey: 0, maxKeys: 0 },
  ): Promise<LoadTeamIssuesResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'loadTeamIssues', `Loading issues for team: ${teamKey}`);
    this.logger.debug(CLASS_NAME, 'loadTeamIssues', `Options: startKey=${options.startKey}, maxKeys=${options.maxKeys}`);

    // Start pipeline run tracking
    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'loadTeamIssues',
      detail: `Loading Linear issues for ${teamKey}`,
      status: 'START',
    });
    this.logger.info(CLASS_NAME, 'loadTeamIssues', `Pipeline run started with id=${pipelineRunId}`);

    let issuesInserted = 0;
    let issuesSkipped = 0;
    let issuesFailed = 0;

    try {
      // Get known issue keys for incremental loading
      const knownKeys = await this.linearRepo.getDistinctLinearIds();
      this.logger.info(CLASS_NAME, 'loadTeamIssues', `Known issue keys in database: ${knownKeys.size}`);

      // Fetch team first to get the team ID
      const team = await this.fetchTeamByKey(teamKey);
      if (!team) {
        this.logger.error(CLASS_NAME, 'loadTeamIssues', `Team not found: ${teamKey}`);
        await this.pipelineRepo.updatePipelineRun(pipelineRunId, `ERROR: Team not found: ${teamKey}`);
        return { teamKey, issuesInserted: 0, issuesSkipped: 0, issuesFailed: 0, durationMs: Date.now() - startTime };
      }

      this.logger.debug(CLASS_NAME, 'loadTeamIssues', `Found team: ${team.name} (id=${team.id})`);

      // Paginate through all team issues
      const counts = await this.paginateTeamIssues(
        team.id, teamKey, knownKeys, options, pipelineRunId,
      );
      issuesInserted = counts.inserted;
      issuesSkipped = counts.skipped;
      issuesFailed = counts.failed;

      await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FINISHED');
      this.logger.info(CLASS_NAME, 'loadTeamIssues', `Completed: ${issuesInserted} inserted, ${issuesSkipped} skipped, ${issuesFailed} failed`);

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Sanitize error messages: redact potential API keys or emails
      const sanitized = this.sanitizeErrorMessage(message);
      this.logger.error(CLASS_NAME, 'loadTeamIssues', `Fatal error loading ${teamKey}: ${sanitized}`);
      await this.pipelineRepo.updatePipelineRun(pipelineRunId, `ERROR: ${sanitized.substring(0, 200)}`);
    }

    const durationMs = Date.now() - startTime;
    this.logger.info(CLASS_NAME, 'loadTeamIssues', `Duration: ${durationMs}ms`);

    return { teamKey, issuesInserted, issuesSkipped, issuesFailed, durationMs };
  }

  // --------------------------------------------------------------------------
  // Pagination and issue processing
  // --------------------------------------------------------------------------

  /**
   * Paginate through team issues using cursor-based pagination.
   *
   * @returns Aggregate counts of processed issues
   */
  private async paginateTeamIssues(
    teamId: string,
    _teamKey: string,
    knownKeys: Set<string>,
    options: LoadTeamIssuesOptions,
    _pipelineRunId: number,
  ): Promise<{ inserted: number; skipped: number; failed: number }> {
    let inserted = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | undefined;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore) {
      pageCount++;
      this.logger.debug(CLASS_NAME, 'paginateTeamIssues', `Fetching page ${pageCount} for team ${_teamKey} (cursor: ${cursor ?? 'start'}, pipeline=${_pipelineRunId})`);

      const page = await this.fetchTeamIssuesPage(teamId, cursor);
      if (!page) {
        this.logger.error(CLASS_NAME, 'paginateTeamIssues', 'Page fetch returned null after retries');
        break;
      }

      const issues = page.issues;
      this.logger.debug(CLASS_NAME, 'paginateTeamIssues', `Page returned ${issues.length} issues`);

      for (const issue of issues) {
        try {
          // Filter by range if specified
          const issueNumber = this.extractIssueNumber(issue.identifier);
          if (options.startKey > 0 && issueNumber < options.startKey) {
            this.logger.trace(CLASS_NAME, 'paginateTeamIssues', `Skipping ${issue.identifier} (before startKey ${options.startKey})`);
            continue;
          }
          if (options.maxKeys > 0 && issueNumber > options.maxKeys) {
            this.logger.trace(CLASS_NAME, 'paginateTeamIssues', `Skipping ${issue.identifier} (after maxKeys ${options.maxKeys})`);
            continue;
          }

          // Skip already-known issues
          if (knownKeys.has(issue.identifier)) {
            this.logger.trace(CLASS_NAME, 'paginateTeamIssues', `Skipping known: ${issue.identifier}`);
            skipped++;
            continue;
          }

          // Extract and persist
          const detail = extractLinearDetail(issue);
          await this.linearRepo.upsertLinearDetail(detail);
          knownKeys.add(issue.identifier);
          inserted++;

          this.logger.debug(CLASS_NAME, 'paginateTeamIssues', `Committed issue: ${issue.identifier}`);
        } catch (error: unknown) {
          failed++;
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'paginateTeamIssues', `Failed to process ${issue.identifier}: ${msg}`);
        }
      }

      // Check for next page
      hasMore = page.hasNextPage;
      cursor = page.endCursor;

      if (hasMore) {
        await this.delay(DEFAULT_RATE_LIMIT_DELAY_MS);
      }
    }

    return { inserted, skipped, failed };
  }

  // --------------------------------------------------------------------------
  // Linear API helpers
  // --------------------------------------------------------------------------

  /**
   * Fetch a team by its key (e.g., "IQS") using the Linear SDK.
   */
  private async fetchTeamByKey(teamKey: string): Promise<{ id: string; name: string } | null> {
    this.logger.debug(CLASS_NAME, 'fetchTeamByKey', `Looking up team: ${teamKey}`);

    try {
      const teams = await this.retryOnTransientFailure(() => this.linearClient.teams());
      const team = teams.nodes.find((t) => t.key === teamKey);
      if (team) {
        return { id: team.id, name: team.name };
      }
      return null;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'fetchTeamByKey', `Failed to fetch teams: ${this.sanitizeErrorMessage(msg)}`);
      return null;
    }
  }

  /**
   * Raw GraphQL query that eagerly fetches issue fields AND relation names
   * in a single request, avoiding the N+1 lazy-loading problem where
   * each issue.state / issue.assignee / etc. triggers a separate API call.
   */
  private static readonly TEAM_ISSUES_QUERY = `
    query TeamIssues($teamId: String!, $first: Int!, $after: String) {
      team(id: $teamId) {
        issues(first: $first, after: $after) {
          nodes {
            id
            identifier
            title
            description
            priority
            estimate
            createdAt
            completedAt
            url
            state { name }
            assignee { name }
            creator { name }
            project { name }
            team { key name }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

  /**
   * Fetch a page of issues for a team ID using a single raw GraphQL query.
   *
   * Uses rawRequest instead of the SDK's lazy-loaded models to fetch all
   * relation fields (state, assignee, creator, project, team) in one round-trip,
   * eliminating 5 extra API calls per issue.
   */
  private async fetchTeamIssuesPage(
    teamId: string,
    cursor?: string,
  ): Promise<{ issues: LinearIssueData[]; hasNextPage: boolean; endCursor?: string } | null> {
    try {
      const response = await this.retryOnTransientFailure(() =>
        this.linearClient.client.rawRequest<RawTeamIssuesResponse, Record<string, unknown>>(
          LinearService.TEAM_ISSUES_QUERY,
          { teamId, first: PAGE_SIZE, after: cursor },
        ),
      );

      const connection = response.data?.team?.issues;
      if (!connection) {
        this.logger.error(CLASS_NAME, 'fetchTeamIssuesPage', 'GraphQL response missing team.issues');
        return null;
      }

      const issues: LinearIssueData[] = connection.nodes.map((node: RawTeamIssuesResponse['team']['issues']['nodes'][number]) => ({
        id: node.id,
        identifier: node.identifier,
        title: node.title,
        description: node.description,
        priority: node.priority,
        estimate: node.estimate,
        createdAt: node.createdAt,
        completedAt: node.completedAt,
        url: node.url,
        state: node.state ?? null,
        assignee: node.assignee ?? null,
        creator: node.creator ?? null,
        project: node.project ?? null,
        team: node.team ?? null,
      }));

      return {
        issues,
        hasNextPage: connection.pageInfo.hasNextPage,
        endCursor: connection.pageInfo.endCursor ?? undefined,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'fetchTeamIssuesPage', `Failed: ${this.sanitizeErrorMessage(msg)}`);
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Retry and rate limiting
  // --------------------------------------------------------------------------

  /**
   * Retry an async operation with exponential backoff on transient failures.
   *
   * @param operation - The async operation to retry
   * @returns The result of the operation
   */
  private async retryOnTransientFailure<T>(operation: () => Promise<T>): Promise<T> {
    let retries = 0;
    let delayMs = DEFAULT_RATE_LIMIT_DELAY_MS;

    while (true) {
      try {
        return await operation();
      } catch (error: unknown) {
        retries++;
        if (retries > MAX_RETRIES) {
          throw error;
        }

        const isTransient = this.isTransientError(error);
        if (!isTransient) {
          throw error;
        }

        this.logger.warn(CLASS_NAME, 'retryOnTransientFailure', `Transient error, retry ${retries}/${MAX_RETRIES} after ${delayMs}ms`);
        await this.delay(delayMs);
        delayMs = Math.min(delayMs * 2, MAX_RATE_LIMIT_DELAY_MS);
      }
    }
  }

  /**
   * Check if an error is transient (rate limit, network, server error).
   */
  private isTransientError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return msg.includes('429') || msg.includes('rate limit')
        || msg.includes('too many requests') || msg.includes('econnreset')
        || msg.includes('etimedout') || msg.includes('500')
        || msg.includes('502') || msg.includes('503');
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /**
   * Extract the numeric issue number from a Linear identifier.
   * E.g., "IQS-123" -> 123
   */
  private extractIssueNumber(identifier: string): number {
    const dashIdx = identifier.lastIndexOf('-');
    if (dashIdx < 0) {
      return 0;
    }
    const numStr = identifier.substring(dashIdx + 1);
    const num = parseInt(numStr, 10);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Sanitize error messages to prevent credential leakage.
   * Redacts API keys, email addresses, and other sensitive patterns.
   */
  private sanitizeErrorMessage(message: string): string {
    // Redact Linear API keys (lin_api_...)
    let sanitized = message.replace(/lin_api_[a-zA-Z0-9]+/g, 'lin_api_***REDACTED***');
    // Redact email addresses
    sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '***EMAIL_REDACTED***');
    // Redact Bearer tokens
    sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***REDACTED***');
    return sanitized;
  }

  /**
   * Delay execution for a specified number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
