/**
 * BitBucket PR sync service supporting both Cloud and Server variants.
 *
 * Syncs pull requests and reviews from BitBucket (Cloud or Server/Data Center)
 * to the local database for the Code Review Velocity dashboard. Uses upsert
 * operations to handle incremental syncs.
 *
 * Key features:
 *   - Supports BitBucket Cloud (api.bitbucket.org/2.0) and Server (self-hosted)
 *   - Fetches PRs with pagination (Cloud: next links, Server: start/limit)
 *   - Extracts reviews from activity feed (no separate reviews endpoint)
 *   - Extracts ticket IDs from branch names (Jira/Linear patterns)
 *   - Counts review cycles (CHANGES_REQUESTED events)
 *   - Tracks first review timestamp
 *   - Respects rate limits with exponential backoff
 *
 * Security:
 *   - BitBucket tokens stored in VS Code SecretStorage, never logged
 *   - All SQL queries use parameterized placeholders
 *   - URLs sanitized for logging to prevent credential exposure
 *
 * Ticket: GITX-228
 */

import { LoggerService } from '../logging/logger.js';
import { DatabaseService } from '../database/database-service.js';
import {
  QUERY_UPSERT_PULL_REQUEST,
  QUERY_UPSERT_PR_REVIEW,
  QUERY_UPDATE_FIRST_REVIEW_AT,
  QUERY_UPDATE_REVIEW_CYCLES,
  QUERY_PULL_REQUEST_TABLE_EXISTS,
  type PullRequestUpsertRow,
  type TableExistsRow,
} from '../database/queries/code-review-queries.js';
import { sanitizeUrlForLogging } from '../utils/url-sanitizer.js';
import type {
  PRSyncResult,
  FullPRSyncResult,
} from './code-review-velocity-types.js';

const CLASS_NAME = 'BitBucketPRSyncService';
const DEFAULT_RATE_LIMIT_DELAY_MS = 100;
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_RATE_LIMIT_DELAY_MS = 30_000;
const BITBUCKET_PAGE_SIZE = 100;

/**
 * Regex patterns for extracting ticket IDs from branch names.
 * Supports both Jira (e.g., PROJ-123) and Linear (e.g., TEAM-123) formats.
 */
const TICKET_ID_REGEX = /([A-Z]{2,10}-\d+)/i;

/**
 * Regex to parse BitBucket Cloud URLs.
 * Format: https://bitbucket.org/{workspace}/{repo_slug}
 */
const BITBUCKET_CLOUD_URL_REGEX = /^https?:\/\/bitbucket\.org\/([^/]+)\/([^/]+)/i;

/**
 * Regex to parse BitBucket Server URLs.
 * Format: https://{domain}/projects/{project}/repos/{repo}
 * Format: https://{domain}/scm/{project}/{repo}
 */
const BITBUCKET_SERVER_PROJECT_REGEX = /^https?:\/\/([^/]+)\/projects\/([^/]+)\/repos\/([^/]+)/i;
const BITBUCKET_SERVER_SCM_REGEX = /^https?:\/\/([^/]+)\/scm\/([^/]+)\/([^/]+)/i;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * BitBucket PR sync configuration.
 */
export interface BitBucketPRSyncConfig {
  /** BitBucket workspace (Cloud) or project key (Server) */
  readonly workspace: string;
  /** Repository slug */
  readonly repoSlug: string;
  /** BitBucket token from SecretStorage */
  readonly token: string;
  /** Number of days to sync back */
  readonly syncDaysBack: number;
  /** BitBucket variant */
  readonly variant: 'cloud' | 'server';
  /** Base URL for Server variant (required if variant='server') */
  readonly serverUrl?: string;
  /** Username for Cloud authentication (required if variant='cloud') */
  readonly username?: string;
}

/**
 * BitBucket pull request (normalized across Cloud and Server).
 */
export interface BitBucketPR {
  readonly id: number;
  readonly title: string;
  readonly author: { readonly displayName: string; readonly username?: string };
  readonly state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  readonly createdOn: string;
  readonly updatedOn: string;
  readonly closeDate?: string;
  readonly mergeCommit?: { readonly hash: string };
  readonly source: { readonly branch: { readonly name: string } };
  readonly destination: { readonly branch: { readonly name: string } };
  readonly additions?: number;
  readonly deletions?: number;
  readonly changedFiles?: number;
}

/**
 * BitBucket Cloud API response for paginated PRs.
 */
interface BitBucketCloudPRListResponse {
  readonly values: readonly BitBucketCloudPR[];
  readonly next?: string;
}

/**
 * BitBucket Server API response for paginated PRs.
 */
interface BitBucketServerPRListResponse {
  readonly values: readonly BitBucketServerPR[];
  readonly isLastPage: boolean;
  readonly nextPageStart?: number;
}

/**
 * BitBucket Cloud PR shape.
 */
interface BitBucketCloudPR {
  readonly id: number;
  readonly title: string;
  readonly author: { readonly display_name: string; readonly username?: string };
  readonly state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  readonly created_on: string;
  readonly updated_on: string;
  readonly close_date?: string;
  readonly merge_commit?: { readonly hash: string };
  readonly source: { readonly branch: { readonly name: string } };
  readonly destination: { readonly branch: { readonly name: string } };
}

/**
 * BitBucket Server PR shape.
 */
interface BitBucketServerPR {
  readonly id: number;
  readonly title: string;
  readonly author: { readonly user: { readonly displayName: string; readonly slug?: string } };
  readonly state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  readonly createdDate: number; // Unix timestamp in milliseconds
  readonly updatedDate: number;
  readonly closedDate?: number;
  readonly properties?: { readonly mergeCommit?: { readonly hash: string } };
  readonly fromRef: { readonly displayId: string };
  readonly toRef: { readonly displayId: string };
}

/**
 * BitBucket activity (used for extracting reviews).
 */
interface BitBucketActivity {
  readonly action?: string;
  readonly user?: { readonly display_name?: string; readonly displayName?: string; readonly username?: string; readonly slug?: string };
  readonly createdDate?: number; // Server: Unix timestamp
  readonly created_on?: string; // Cloud: ISO timestamp
  readonly id?: number;
}

/**
 * HTTP client interface for dependency injection (testing).
 */
export interface BitBucketHttpClient {
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

/**
 * Default HTTP client using Node.js fetch.
 */
class DefaultBitBucketHttpClient implements BitBucketHttpClient {
  async fetch(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, options);
  }
}

// ============================================================================
// Service Class
// ============================================================================

/**
 * Service for syncing BitBucket PR data to the local database.
 * Supports both BitBucket Cloud and Server variants with parameterized SQL,
 * rate limiting, and incremental sync support.
 */
export class BitBucketPRSyncService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;
  private readonly httpClient: BitBucketHttpClient;

  constructor(
    db: DatabaseService,
    httpClient?: BitBucketHttpClient,
  ) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.httpClient = httpClient ?? new DefaultBitBucketHttpClient();

    this.logger.debug(CLASS_NAME, 'constructor', 'BitBucketPRSyncService created');
  }

  /**
   * Check if the pull_request table exists.
   * Used for graceful degradation when migration 012 has not been applied.
   */
  async checkTableExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkTableExists', 'Checking pull_request table existence');

    const result = await this.db.query<TableExistsRow>(QUERY_PULL_REQUEST_TABLE_EXISTS);
    const exists = result.rows[0]?.table_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkTableExists', `pull_request table exists: ${exists}`);
    return exists;
  }

  /**
   * Sync pull requests for multiple repositories.
   *
   * @param configs - Array of repository sync configurations
   * @returns Combined sync results
   */
  async syncAllRepositories(
    configs: readonly BitBucketPRSyncConfig[],
  ): Promise<FullPRSyncResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'syncAllRepositories', `Starting PR sync for ${configs.length} repositories`);

    const results: PRSyncResult[] = [];

    for (const config of configs) {
      const result = await this.syncRepository(config);
      results.push(result);
    }

    const totalDurationMs = Date.now() - startTime;
    const totalPRs = results.reduce((sum, r) => sum + r.prsUpserted, 0);
    const totalReviews = results.reduce((sum, r) => sum + r.reviewsUpserted, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);

    this.logger.info(
      CLASS_NAME,
      'syncAllRepositories',
      `Sync complete: ${totalPRs} PRs, ${totalReviews} reviews, ${totalErrors} errors in ${totalDurationMs}ms`,
    );

    return {
      repositoryResults: results,
      totalPRs,
      totalReviews,
      totalErrors,
      totalDurationMs,
    };
  }

  /**
   * Sync pull requests for a single repository.
   *
   * @param config - Repository sync configuration
   * @returns Sync result for this repository
   */
  async syncRepository(config: BitBucketPRSyncConfig): Promise<PRSyncResult> {
    const startTime = Date.now();
    const repository = `${config.workspace}/${config.repoSlug}`;

    // GITX-222: Audit logging for BitBucket API access
    this.logger.info(
      CLASS_NAME,
      'syncRepository',
      `BitBucket API access: PR sync initiated for ${repository} (${config.syncDaysBack} days back, variant: ${config.variant})`,
    );

    let prsUpserted = 0;
    let reviewsUpserted = 0;
    let errorCount = 0;

    try {
      // Calculate the since date
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - config.syncDaysBack);

      this.logger.debug(CLASS_NAME, 'syncRepository', `Fetching PRs since: ${sinceDate.toISOString()}`);

      // Fetch PRs with pagination
      const prs = await this.fetchPullRequests(config, sinceDate);
      this.logger.info(CLASS_NAME, 'syncRepository', `Fetched ${prs.length} PRs`);

      // Process each PR
      for (const pr of prs) {
        try {
          // Extract ticket ID from branch name
          const ticketMatch = pr.source.branch.name.match(TICKET_ID_REGEX);
          const linkedTicketId = ticketMatch?.[1] ?? null;
          const linkedTicketType = linkedTicketId
            ? this.inferTicketType(linkedTicketId)
            : null;

          // Normalize state
          const state = this.normalizeState(pr.state);

          // Determine close/merge dates
          const closedAt = pr.closeDate ?? null;
          const mergedAt = pr.state === 'MERGED' ? closedAt : null;
          const mergeSha = pr.mergeCommit?.hash ?? null;

          // Get author username (fallback to display name)
          const author = pr.author.username ?? pr.author.displayName;

          // Upsert PR (migration 034 adds provider column)
          const prId = await this.upsertPullRequest(
            repository,
            pr.id,
            pr.id, // BitBucket ID used as both pr_number and provider_id
            pr.title,
            author,
            state,
            pr.createdOn,
            pr.updatedOn,
            null, // first_review_at calculated after reviews
            mergedAt,
            closedAt,
            mergeSha,
            pr.source.branch.name,
            pr.destination.branch.name,
            pr.additions ?? 0,
            pr.deletions ?? 0,
            pr.changedFiles ?? 0,
            0, // review_cycles calculated after reviews
            linkedTicketId,
            linkedTicketType,
            'bitbucket', // provider
          );

          prsUpserted++;
          this.logger.debug(CLASS_NAME, 'syncRepository', `Upserted PR #${pr.id}: db_id=${prId}`);

          // Fetch and upsert reviews from activity feed
          const reviews = await this.fetchReviews(config, pr.id);
          this.logger.debug(CLASS_NAME, 'syncRepository', `Fetched ${reviews.length} reviews for PR #${pr.id}`);

          for (const review of reviews) {
            await this.upsertReview(
              prId,
              review.id,
              review.reviewer,
              review.state,
              review.submittedAt,
              null, // BitBucket activities don't have review body
            );
            reviewsUpserted++;
          }

          // Update first_review_at and review_cycles
          await this.updateReviewMetrics(prId);

          // Rate limiting between PRs
          await this.delay(DEFAULT_RATE_LIMIT_DELAY_MS);
        } catch (error: unknown) {
          errorCount++;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'syncRepository', `Error processing PR #${pr.id}: ${message}`);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'syncRepository', `Fatal error syncing ${repository}: ${message}`);
      errorCount++;
    }

    const durationMs = Date.now() - startTime;

    // GITX-222: Audit logging for BitBucket API access completion
    if (errorCount === 0) {
      this.logger.info(
        CLASS_NAME,
        'syncRepository',
        `BitBucket API access complete: ${prsUpserted} PRs, ${reviewsUpserted} reviews synced from ${repository} in ${durationMs}ms`,
      );
    } else {
      this.logger.warn(
        CLASS_NAME,
        'syncRepository',
        `BitBucket API access complete with errors: ${prsUpserted} PRs, ${reviewsUpserted} reviews synced from ${repository} in ${durationMs}ms (${errorCount} errors)`,
      );
    }

    return {
      repository,
      prsUpserted,
      reviewsUpserted,
      errorCount,
      durationMs,
    };
  }

  /**
   * Parse BitBucket URL to extract workspace/project and repo slug.
   *
   * @param url - BitBucket repository URL
   * @returns { workspace, repoSlug, variant } or null if invalid
   */
  static parseUrl(url: string): { workspace: string; repoSlug: string; variant: 'cloud' | 'server'; serverUrl?: string } | null {
    const logger = LoggerService.getInstance();

    // Try Cloud URL
    const cloudMatch = url.match(BITBUCKET_CLOUD_URL_REGEX);
    if (cloudMatch) {
      const [, workspace, repoSlug] = cloudMatch;
      if (workspace && repoSlug) {
        logger.debug(CLASS_NAME, 'parseUrl', `Parsed Cloud URL: ${workspace}/${repoSlug}`);
        return { workspace, repoSlug, variant: 'cloud' };
      }
    }

    // Try Server project URL
    const projectMatch = url.match(BITBUCKET_SERVER_PROJECT_REGEX);
    if (projectMatch) {
      const [, domain, project, repo] = projectMatch;
      if (domain && project && repo) {
        const serverUrl = `https://${domain}`;
        logger.debug(CLASS_NAME, 'parseUrl', `Parsed Server URL (projects): ${project}/${repo}`);
        return { workspace: project, repoSlug: repo, variant: 'server', serverUrl };
      }
    }

    // Try Server SCM URL
    const scmMatch = url.match(BITBUCKET_SERVER_SCM_REGEX);
    if (scmMatch) {
      const [, domain, project, repo] = scmMatch;
      if (domain && project && repo) {
        const serverUrl = `https://${domain}`;
        logger.debug(CLASS_NAME, 'parseUrl', `Parsed Server URL (scm): ${project}/${repo}`);
        return { workspace: project, repoSlug: repo, variant: 'server', serverUrl };
      }
    }

    logger.warn(CLASS_NAME, 'parseUrl', `Failed to parse BitBucket URL: ${sanitizeUrlForLogging(url)}`);
    return null;
  }

  /**
   * Fetch pull requests from BitBucket API with pagination.
   */
  private async fetchPullRequests(
    config: BitBucketPRSyncConfig,
    sinceDate: Date,
  ): Promise<BitBucketPR[]> {
    this.logger.debug(CLASS_NAME, 'fetchPullRequests', `Fetching PRs for ${config.workspace}/${config.repoSlug}`);

    if (config.variant === 'cloud') {
      return this.fetchPullRequestsCloud(config, sinceDate);
    } else {
      return this.fetchPullRequestsServer(config, sinceDate);
    }
  }

  /**
   * Fetch PRs from BitBucket Cloud with next-link pagination.
   */
  private async fetchPullRequestsCloud(
    config: BitBucketPRSyncConfig,
    sinceDate: Date,
  ): Promise<BitBucketPR[]> {
    const prs: BitBucketPR[] = [];
    let nextUrl: string | null = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(config.workspace)}/${encodeURIComponent(config.repoSlug)}/pullrequests?pagelen=${BITBUCKET_PAGE_SIZE}&state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED`;

    while (nextUrl) {
      this.logger.trace(CLASS_NAME, 'fetchPullRequestsCloud', `Fetching: ${sanitizeUrlForLogging(nextUrl)}`);

      const response = await this.callWithRateLimiting(() =>
        this.httpClient.fetch(nextUrl!, {
          headers: this.getCloudHeaders(config),
        }),
      );

      if (!response || !response.ok) {
        throw new Error(`BitBucket Cloud API error: ${response?.status} ${response?.statusText}`);
      }

      const data = await response.json() as BitBucketCloudPRListResponse;

      // Filter by since date
      const filtered = data.values.filter(
        (pr) => new Date(pr.updated_on) >= sinceDate,
      );

      if (filtered.length === 0) {
        // No more PRs in the time range
        break;
      }

      // Map to normalized PR shape
      for (const pr of filtered) {
        prs.push({
          id: pr.id,
          title: pr.title,
          author: {
            displayName: pr.author.display_name,
            username: pr.author.username,
          },
          state: pr.state,
          createdOn: pr.created_on,
          updatedOn: pr.updated_on,
          closeDate: pr.close_date,
          mergeCommit: pr.merge_commit,
          source: pr.source,
          destination: pr.destination,
        });
      }

      // Check for next page
      nextUrl = data.next ?? null;
    }

    this.logger.debug(CLASS_NAME, 'fetchPullRequestsCloud', `Total PRs fetched: ${prs.length}`);
    return prs;
  }

  /**
   * Fetch PRs from BitBucket Server with start/limit pagination.
   */
  private async fetchPullRequestsServer(
    config: BitBucketPRSyncConfig,
    sinceDate: Date,
  ): Promise<BitBucketPR[]> {
    if (!config.serverUrl) {
      throw new Error('serverUrl is required for BitBucket Server variant');
    }

    const prs: BitBucketPR[] = [];
    let start = 0;
    let isLastPage = false;

    while (!isLastPage) {
      const url = `${config.serverUrl}/rest/api/1.0/projects/${encodeURIComponent(config.workspace)}/repos/${encodeURIComponent(config.repoSlug)}/pull-requests?state=ALL&limit=${BITBUCKET_PAGE_SIZE}&start=${start}`;
      this.logger.trace(CLASS_NAME, 'fetchPullRequestsServer', `Fetching: ${sanitizeUrlForLogging(url)}`);

      const response = await this.callWithRateLimiting(() =>
        this.httpClient.fetch(url, {
          headers: this.getServerHeaders(config),
        }),
      );

      if (!response || !response.ok) {
        throw new Error(`BitBucket Server API error: ${response?.status} ${response?.statusText}`);
      }

      const data = await response.json() as BitBucketServerPRListResponse;

      // Filter by since date
      const filtered = data.values.filter(
        (pr) => new Date(pr.updatedDate) >= sinceDate,
      );

      if (filtered.length === 0) {
        // No more PRs in the time range
        break;
      }

      // Map to normalized PR shape
      for (const pr of filtered) {
        prs.push({
          id: pr.id,
          title: pr.title,
          author: {
            displayName: pr.author.user.displayName,
            username: pr.author.user.slug,
          },
          state: pr.state,
          createdOn: new Date(pr.createdDate).toISOString(),
          updatedOn: new Date(pr.updatedDate).toISOString(),
          closeDate: pr.closedDate ? new Date(pr.closedDate).toISOString() : undefined,
          mergeCommit: pr.properties?.mergeCommit,
          source: {
            branch: {
              name: pr.fromRef.displayId,
            },
          },
          destination: {
            branch: {
              name: pr.toRef.displayId,
            },
          },
        });
      }

      // Check for next page
      isLastPage = data.isLastPage;
      start = data.nextPageStart ?? 0;
    }

    this.logger.debug(CLASS_NAME, 'fetchPullRequestsServer', `Total PRs fetched: ${prs.length}`);
    return prs;
  }

  /**
   * Fetch reviews for a PR from BitBucket activity feed.
   * BitBucket doesn't have a separate reviews endpoint - reviews are in the activity feed.
   */
  private async fetchReviews(
    config: BitBucketPRSyncConfig,
    prId: number,
  ): Promise<Array<{ id: number; reviewer: string; state: string; submittedAt: string }>> {
    if (config.variant === 'cloud') {
      return this.fetchReviewsCloud(config, prId);
    } else {
      return this.fetchReviewsServer(config, prId);
    }
  }

  /**
   * Fetch reviews from BitBucket Cloud activity endpoint.
   */
  private async fetchReviewsCloud(
    config: BitBucketPRSyncConfig,
    prId: number,
  ): Promise<Array<{ id: number; reviewer: string; state: string; submittedAt: string }>> {
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(config.workspace)}/${encodeURIComponent(config.repoSlug)}/pullrequests/${prId}/activity`;
    this.logger.trace(CLASS_NAME, 'fetchReviewsCloud', `Fetching activity: ${sanitizeUrlForLogging(url)}`);

    const response = await this.callWithRateLimiting(() =>
      this.httpClient.fetch(url, {
        headers: this.getCloudHeaders(config),
      }),
    );

    if (!response || !response.ok) {
      this.logger.warn(CLASS_NAME, 'fetchReviewsCloud', `Failed to fetch activity for PR #${prId}: ${response?.status}`);
      return [];
    }

    const data = await response.json() as { values: readonly BitBucketActivity[] };
    const reviews: Array<{ id: number; reviewer: string; state: string; submittedAt: string }> = [];

    // Extract APPROVED and CHANGES_REQUESTED activities
    for (const activity of data.values) {
      if (activity.action === 'approval:approved' || activity.action === 'approval:unapproved' || activity.action === 'approval:changes_requested') {
        const state = activity.action === 'approval:approved' ? 'approved' : 'changes_requested';
        const reviewer = activity.user?.display_name ?? activity.user?.username ?? 'unknown';
        const submittedAt = activity.created_on ?? new Date().toISOString();
        // Generate deterministic fallback ID from PR ID, timestamp, and reviewer
        // This avoids collisions from random IDs (CWE-338)
        const submittedTs = Date.parse(submittedAt) || Date.now();
        const fallbackId = parseInt(`${prId}${submittedTs}`.slice(-9), 10);
        const id = activity.id ?? fallbackId;

        reviews.push({ id, reviewer, state, submittedAt });
      }
    }

    return reviews;
  }

  /**
   * Fetch reviews from BitBucket Server activities endpoint.
   */
  private async fetchReviewsServer(
    config: BitBucketPRSyncConfig,
    prId: number,
  ): Promise<Array<{ id: number; reviewer: string; state: string; submittedAt: string }>> {
    if (!config.serverUrl) {
      throw new Error('serverUrl is required for BitBucket Server variant');
    }

    const url = `${config.serverUrl}/rest/api/1.0/projects/${encodeURIComponent(config.workspace)}/repos/${encodeURIComponent(config.repoSlug)}/pull-requests/${prId}/activities`;
    this.logger.trace(CLASS_NAME, 'fetchReviewsServer', `Fetching activity: ${sanitizeUrlForLogging(url)}`);

    const response = await this.callWithRateLimiting(() =>
      this.httpClient.fetch(url, {
        headers: this.getServerHeaders(config),
      }),
    );

    if (!response || !response.ok) {
      this.logger.warn(CLASS_NAME, 'fetchReviewsServer', `Failed to fetch activity for PR #${prId}: ${response?.status}`);
      return [];
    }

    const data = await response.json() as { values: readonly BitBucketActivity[] };
    const reviews: Array<{ id: number; reviewer: string; state: string; submittedAt: string }> = [];

    // Extract APPROVED and CHANGES_REQUESTED activities
    for (const activity of data.values) {
      if (activity.action === 'APPROVED' || activity.action === 'UNAPPROVED' || activity.action === 'REVIEWED') {
        const state = activity.action === 'APPROVED' ? 'approved' : 'changes_requested';
        const reviewer = activity.user?.displayName ?? activity.user?.slug ?? 'unknown';
        const submittedAt = activity.createdDate ? new Date(activity.createdDate).toISOString() : new Date().toISOString();
        // Generate deterministic fallback ID from PR ID, timestamp, and reviewer
        // This avoids collisions from random IDs (CWE-338)
        const submittedTs = Date.parse(submittedAt) || Date.now();
        const fallbackId = parseInt(`${prId}${submittedTs}`.slice(-9), 10);
        const id = activity.id ?? fallbackId;

        reviews.push({ id, reviewer, state, submittedAt });
      }
    }

    return reviews;
  }

  /**
   * Get HTTP headers for BitBucket Cloud API (HTTP Basic auth).
   */
  private getCloudHeaders(config: BitBucketPRSyncConfig): Record<string, string> {
    if (!config.username) {
      throw new Error('username is required for BitBucket Cloud authentication');
    }

    // BitBucket Cloud uses HTTP Basic: username:app_password encoded in Base64
    const credentials = Buffer.from(`${config.username}:${config.token}`).toString('base64');

    return {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
    };
  }

  /**
   * Get HTTP headers for BitBucket Server API (Bearer token).
   */
  private getServerHeaders(config: BitBucketPRSyncConfig): Record<string, string> {
    return {
      'Authorization': `Bearer ${config.token}`,
      'Accept': 'application/json',
    };
  }

  /**
   * Normalize BitBucket state to database state.
   * BitBucket states: OPEN, MERGED, DECLINED, SUPERSEDED
   * Database states: open, merged, closed
   */
  private normalizeState(state: string): string {
    switch (state.toUpperCase()) {
      case 'OPEN':
        return 'open';
      case 'MERGED':
        return 'merged';
      case 'DECLINED':
      case 'SUPERSEDED':
        return 'closed';
      default:
        this.logger.warn(CLASS_NAME, 'normalizeState', `Unknown state: ${state}, defaulting to 'closed'`);
        return 'closed';
    }
  }

  /**
   * Upsert a pull request record.
   */
  private async upsertPullRequest(
    repository: string,
    prNumber: number,
    providerId: number,
    title: string,
    author: string,
    state: string,
    createdAt: string,
    updatedAt: string,
    firstReviewAt: string | null,
    mergedAt: string | null,
    closedAt: string | null,
    mergeSha: string | null,
    headBranch: string,
    baseBranch: string,
    additions: number,
    deletions: number,
    changedFiles: number,
    reviewCycles: number,
    linkedTicketId: string | null,
    linkedTicketType: string | null,
    provider: 'github' | 'bitbucket',
  ): Promise<number> {
    this.logger.trace(CLASS_NAME, 'upsertPullRequest', `Upserting PR #${prNumber} (provider: ${provider})`);

    const result = await this.db.query<PullRequestUpsertRow>(QUERY_UPSERT_PULL_REQUEST, [
      repository,
      prNumber,
      providerId,
      title,
      author,
      state,
      createdAt,
      updatedAt,
      firstReviewAt,
      mergedAt,
      closedAt,
      mergeSha,
      headBranch,
      baseBranch,
      additions,
      deletions,
      changedFiles,
      reviewCycles,
      linkedTicketId,
      linkedTicketType,
      provider,
    ]);

    const id = result.rows[0]?.id;
    if (!id) {
      throw new Error(`Failed to upsert PR #${prNumber}`);
    }

    return id;
  }

  /**
   * Upsert a PR review record.
   */
  private async upsertReview(
    pullRequestId: number,
    githubId: number,
    reviewer: string,
    state: string,
    submittedAt: string,
    body: string | null,
  ): Promise<void> {
    this.logger.trace(CLASS_NAME, 'upsertReview', `Upserting review ${githubId}`);

    await this.db.query(QUERY_UPSERT_PR_REVIEW, [
      pullRequestId,
      githubId,
      reviewer,
      state,
      submittedAt,
      body,
    ]);
  }

  /**
   * Update first_review_at and review_cycles for a PR.
   */
  private async updateReviewMetrics(pullRequestId: number): Promise<void> {
    this.logger.trace(CLASS_NAME, 'updateReviewMetrics', `Updating metrics for PR id=${pullRequestId}`);

    await this.db.query(QUERY_UPDATE_FIRST_REVIEW_AT, [pullRequestId]);
    await this.db.query(QUERY_UPDATE_REVIEW_CYCLES, [pullRequestId]);
  }

  /**
   * Infer ticket type from ticket ID format.
   * Linear uses short team keys (2-5 chars), Jira uses longer (3-10 chars).
   */
  private inferTicketType(ticketId: string): 'jira' | 'linear' {
    const match = ticketId.match(/^([A-Z]+)-/i);
    if (!match) {
      return 'jira'; // Default to Jira
    }

    const prefix = match[1];
    if (prefix && prefix.length <= 4) {
      return 'linear';
    }
    return 'jira';
  }

  /**
   * Execute an API call with exponential backoff on rate limit responses.
   */
  private async callWithRateLimiting<T>(
    apiCall: () => Promise<T>,
  ): Promise<T | null> {
    let retries = 0;
    let delayMs = DEFAULT_RATE_LIMIT_DELAY_MS;

    while (retries <= MAX_RATE_LIMIT_RETRIES) {
      try {
        return await apiCall();
      } catch (error: unknown) {
        if (this.isRateLimitError(error) && retries < MAX_RATE_LIMIT_RETRIES) {
          retries++;
          this.logger.warn(
            CLASS_NAME,
            'callWithRateLimiting',
            `Rate limited. Retry ${retries}/${MAX_RATE_LIMIT_RETRIES} after ${delayMs}ms`,
          );
          await this.delay(delayMs);
          delayMs = Math.min(delayMs * 2, MAX_RATE_LIMIT_DELAY_MS);
          continue;
        }

        // Non-rate-limit error or retries exhausted - re-throw
        throw error;
      }
    }

    this.logger.error(
      CLASS_NAME,
      'callWithRateLimiting',
      `Rate limit retries exhausted after ${MAX_RATE_LIMIT_RETRIES} attempts`,
    );
    return null;
  }

  /**
   * Check if an error is a BitBucket rate limit response (429).
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('too many requests')
      );
    }
    return false;
  }

  /**
   * Delay execution for rate limiting between API requests.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
