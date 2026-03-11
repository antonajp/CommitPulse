/**
 * GitHub PR sync service using @octokit/rest.
 *
 * Syncs pull requests and reviews from GitHub to the local database
 * for the Code Review Velocity dashboard. Uses upsert operations
 * to handle incremental syncs.
 *
 * Key features:
 *   - Fetches PRs and reviews from GitHub API
 *   - Extracts ticket IDs from branch names (Jira/Linear patterns)
 *   - Counts review cycles (CHANGES_REQUESTED events)
 *   - Tracks first review timestamp
 *   - Respects GitHub rate limits with exponential backoff
 *
 * Security:
 *   - GitHub PAT stored in VS Code SecretStorage, never logged
 *   - All SQL queries use parameterized placeholders
 *
 * Ticket: IQS-899
 */

import { Octokit } from '@octokit/rest';
import type { RestEndpointMethodTypes } from '@octokit/rest';
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
import type {
  GitHubPRSyncConfig,
  PRSyncResult,
  FullPRSyncResult,
  GitHubPR,
  GitHubReview,
} from './code-review-velocity-types.js';

const CLASS_NAME = 'GitHubPRSyncService';
const DEFAULT_RATE_LIMIT_DELAY_MS = 100;
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_RATE_LIMIT_DELAY_MS = 30_000;
const GITHUB_PAGE_SIZE = 100;

/**
 * Regex patterns for extracting ticket IDs from branch names.
 * Supports both Jira (e.g., PROJ-123) and Linear (e.g., TEAM-123) formats.
 */
const TICKET_ID_REGEX = /([A-Z]{2,10}-\d+)/i;

/**
 * Service for syncing GitHub PR data to the local database.
 * Uses @octokit/rest for GitHub API with parameterized SQL,
 * rate limiting, and incremental sync support.
 */
export class GitHubPRSyncService {
  private readonly logger: LoggerService;
  private readonly octokit: Octokit;
  private readonly db: DatabaseService;

  constructor(
    token: string,
    db: DatabaseService,
    octokit?: Octokit,
  ) {
    this.db = db;
    this.logger = LoggerService.getInstance();

    // Allow injection of Octokit client for testing
    this.octokit = octokit ?? new Octokit({ auth: token });

    this.logger.debug(CLASS_NAME, 'constructor', 'GitHubPRSyncService created');
    this.logger.trace(CLASS_NAME, 'constructor', 'Token provided via SecretStorage (not logged)');
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
    configs: readonly GitHubPRSyncConfig[],
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
  async syncRepository(config: GitHubPRSyncConfig): Promise<PRSyncResult> {
    const startTime = Date.now();
    const repository = `${config.owner}/${config.repo}`;
    this.logger.info(CLASS_NAME, 'syncRepository', `Syncing PRs for: ${repository}`);

    let prsUpserted = 0;
    let reviewsUpserted = 0;
    let errorCount = 0;

    try {
      // Calculate the since date
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - config.syncDaysBack);
      const since = sinceDate.toISOString();

      this.logger.debug(CLASS_NAME, 'syncRepository', `Fetching PRs since: ${since}`);

      // Fetch PRs with pagination
      const prs = await this.fetchPullRequests(config.owner, config.repo, since);
      this.logger.info(CLASS_NAME, 'syncRepository', `Fetched ${prs.length} PRs`);

      // Process each PR
      for (const pr of prs) {
        try {
          // Fetch full PR details for additions/deletions/changed_files
          const prDetails = await this.fetchPRDetails(config.owner, config.repo, pr.number);

          // Extract ticket ID from branch name
          const ticketMatch = pr.head.ref.match(TICKET_ID_REGEX);
          const linkedTicketId = ticketMatch?.[1] ?? null;
          // Determine ticket type (Linear uses short keys like IQS-, Jira uses longer like PROJ-)
          const linkedTicketType = linkedTicketId
            ? this.inferTicketType(linkedTicketId)
            : null;

          // Determine PR state
          const state = prDetails.merged_at ? 'merged' : prDetails.state;

          // Upsert PR
          const prId = await this.upsertPullRequest(
            repository,
            pr.number,
            pr.id,
            pr.title,
            pr.user?.login ?? 'unknown',
            state,
            pr.created_at,
            pr.updated_at,
            null, // first_review_at calculated after reviews
            prDetails.merged_at,
            prDetails.closed_at,
            prDetails.merge_commit_sha,
            pr.head.ref,
            pr.base.ref,
            prDetails.additions ?? 0,
            prDetails.deletions ?? 0,
            prDetails.changed_files ?? 0,
            0, // review_cycles calculated after reviews
            linkedTicketId,
            linkedTicketType,
          );

          prsUpserted++;
          this.logger.debug(CLASS_NAME, 'syncRepository', `Upserted PR #${pr.number}: id=${prId}`);

          // Fetch and upsert reviews
          const reviews = await this.fetchReviews(config.owner, config.repo, pr.number);
          this.logger.debug(CLASS_NAME, 'syncRepository', `Fetched ${reviews.length} reviews for PR #${pr.number}`);

          for (const review of reviews) {
            if (!review.submitted_at) {
              continue; // Skip pending reviews without submission timestamp
            }

            await this.upsertReview(
              prId,
              review.id,
              review.user?.login ?? 'unknown',
              review.state.toLowerCase(),
              review.submitted_at,
              review.body,
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
          this.logger.error(CLASS_NAME, 'syncRepository', `Error processing PR #${pr.number}: ${message}`);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'syncRepository', `Fatal error syncing ${repository}: ${message}`);
      errorCount++;
    }

    const durationMs = Date.now() - startTime;
    this.logger.info(
      CLASS_NAME,
      'syncRepository',
      `Sync complete for ${repository}: ${prsUpserted} PRs, ${reviewsUpserted} reviews, ${errorCount} errors in ${durationMs}ms`,
    );

    return {
      repository,
      prsUpserted,
      reviewsUpserted,
      errorCount,
      durationMs,
    };
  }

  /**
   * Fetch pull requests from GitHub API with pagination.
   */
  private async fetchPullRequests(
    owner: string,
    repo: string,
    since: string,
  ): Promise<GitHubPR[]> {
    this.logger.debug(CLASS_NAME, 'fetchPullRequests', `Fetching PRs for ${owner}/${repo}`);

    const prs: GitHubPR[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      this.logger.trace(CLASS_NAME, 'fetchPullRequests', `Fetching page ${page}`);

      const response = await this.callWithRateLimiting(async () =>
        this.octokit.pulls.list({
          owner,
          repo,
          state: 'all',
          sort: 'updated',
          direction: 'desc',
          per_page: GITHUB_PAGE_SIZE,
          page,
        }),
      );

      if (!response || response.data.length === 0) {
        hasMore = false;
        break;
      }

      // Filter by since date (updated_at > since)
      const filtered = response.data.filter(
        (pr: RestEndpointMethodTypes['pulls']['list']['response']['data'][0]) =>
          new Date(pr.updated_at) >= new Date(since),
      );

      if (filtered.length === 0) {
        hasMore = false;
        break;
      }

      // Map to GitHubPR type
      for (const pr of filtered) {
        prs.push({
          id: pr.id,
          number: pr.number,
          title: pr.title,
          user: pr.user ? { login: pr.user.login } : null,
          state: pr.state as 'open' | 'closed',
          created_at: pr.created_at,
          updated_at: pr.updated_at,
          merged_at: pr.merged_at ?? null,
          closed_at: pr.closed_at ?? null,
          merge_commit_sha: pr.merge_commit_sha ?? null,
          head: { ref: pr.head.ref },
          base: { ref: pr.base.ref },
          additions: undefined, // Need to fetch from PR details
          deletions: undefined,
          changed_files: undefined,
        });
      }

      hasMore = response.data.length >= GITHUB_PAGE_SIZE;
      page++;
    }

    this.logger.debug(CLASS_NAME, 'fetchPullRequests', `Total PRs fetched: ${prs.length}`);
    return prs;
  }

  /**
   * Fetch detailed PR information including additions/deletions/changed_files.
   */
  private async fetchPRDetails(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GitHubPR> {
    this.logger.trace(CLASS_NAME, 'fetchPRDetails', `Fetching PR #${prNumber} details`);

    const response = await this.callWithRateLimiting(async () =>
      this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      }),
    );

    if (!response) {
      throw new Error(`Failed to fetch PR #${prNumber} details`);
    }

    const pr = response.data;
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      user: pr.user ? { login: pr.user.login } : null,
      state: pr.state as 'open' | 'closed',
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      merged_at: pr.merged_at ?? null,
      closed_at: pr.closed_at ?? null,
      merge_commit_sha: pr.merge_commit_sha ?? null,
      head: { ref: pr.head.ref },
      base: { ref: pr.base.ref },
      additions: pr.additions,
      deletions: pr.deletions,
      changed_files: pr.changed_files,
    };
  }

  /**
   * Fetch reviews for a PR from GitHub API.
   */
  private async fetchReviews(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GitHubReview[]> {
    this.logger.trace(CLASS_NAME, 'fetchReviews', `Fetching reviews for PR #${prNumber}`);

    const reviews: GitHubReview[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.callWithRateLimiting(async () =>
        this.octokit.pulls.listReviews({
          owner,
          repo,
          pull_number: prNumber,
          per_page: GITHUB_PAGE_SIZE,
          page,
        }),
      );

      if (!response || response.data.length === 0) {
        hasMore = false;
        break;
      }

      for (const review of response.data) {
        reviews.push({
          id: review.id,
          user: review.user ? { login: review.user.login } : null,
          state: review.state as GitHubReview['state'],
          submitted_at: review.submitted_at ?? null,
          body: review.body ?? null,
        });
      }

      hasMore = response.data.length >= GITHUB_PAGE_SIZE;
      page++;
    }

    return reviews;
  }

  /**
   * Upsert a pull request record.
   */
  private async upsertPullRequest(
    repository: string,
    prNumber: number,
    githubId: number,
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
  ): Promise<number> {
    this.logger.trace(CLASS_NAME, 'upsertPullRequest', `Upserting PR #${prNumber}`);

    const result = await this.db.query<PullRequestUpsertRow>(QUERY_UPSERT_PULL_REQUEST, [
      repository,
      prNumber,
      githubId,
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
    // Extract the prefix before the dash
    const match = ticketId.match(/^([A-Z]+)-/i);
    if (!match) {
      return 'jira'; // Default to Jira
    }

    const prefix = match[1];
    // Linear team keys are typically shorter (IQS, ENG, etc.)
    // Jira project keys can be longer (PROJECTNAME, etc.)
    // This is a heuristic - could be made configurable
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
   * Check if an error is a GitHub rate limit response (403/429).
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('too many requests') ||
        message.includes('secondary rate limit')
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
