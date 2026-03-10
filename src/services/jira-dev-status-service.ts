/**
 * Jira GitHub dev status fetching and saving service.
 *
 * Extracts the dev status API integration from JiraChangelogService for
 * modularity and the 600-line file limit.
 *
 * Converts Python JiraApi.py save_github_info() method to TypeScript:
 *   - Calls Jira REST API /rest/dev-status/latest/issue/detail
 *   - Parses response using IJiraDevStatusResponse model
 *   - Deduplicates against known branches/PRs using in-memory Map/Set
 *   - Persists new records via JiraRepository
 *
 * IMPORTANT: This uses the Jira REST API, NOT the GitHub API.
 * The dev status endpoint returns GitHub branch and PR data linked
 * to a Jira issue. Authentication uses Jira credentials (basic auth).
 *
 * Ticket: IQS-857
 */

import { LoggerService } from '../logging/logger.js';
import { JiraRepository } from '../database/jira-repository.js';
import type {
  JiraGitHubBranchRow,
  JiraGitHubPullRequestRow,
  KnownJiraGitHubBranch,
  KnownJiraGitHubPR,
} from '../database/jira-types.js';
import {
  parseJiraDevStatusResponse,
} from '../models/jira-github.js';
import type { IJiraDevStatusResponse } from '../models/jira-github.js';

// ============================================================================
// Constants
// ============================================================================

const CLASS_NAME = 'JiraDevStatusService';

/** Default delay between API requests in milliseconds for rate limiting. */
const DEFAULT_RATE_LIMIT_DELAY_MS = 200;

/** Maximum retries on rate-limited (429) responses. */
const MAX_RATE_LIMIT_RETRIES = 5;

/** Maximum delay for exponential backoff on rate limit responses. */
const MAX_RATE_LIMIT_DELAY_MS = 30_000;

/**
 * Configuration needed for dev status API calls.
 */
export interface DevStatusConfig {
  /** Jira server URL. */
  readonly server: string;
  /** Jira username for basic auth. */
  readonly username: string;
  /** Jira API token for basic auth. */
  readonly token: string;
}

/**
 * Result from fetching and saving dev status for a single issue.
 */
export interface DevStatusSaveResult {
  readonly branchesSaved: number;
  readonly prsSaved: number;
}

// ============================================================================
// JiraDevStatusService implementation
// ============================================================================

/**
 * Service for fetching GitHub dev status from the Jira REST API and
 * persisting branches and pull requests with deduplication.
 *
 * Uses in-memory Map/Set caches for O(1) dedup lookups, replacing the
 * Python pandas DataFrame approach.
 */
export class JiraDevStatusService {
  private readonly logger: LoggerService;
  private readonly jiraRepo: JiraRepository;
  private readonly config: DevStatusConfig;

  /** In-memory cache: jiraId -> Set<"lastCommit|branchName"> */
  private knownBranches: Map<string, Set<string>>;

  /** In-memory cache: jiraId -> Set<prId> */
  private knownPRs: Map<string, Set<string>>;

  /** Whether caches have been loaded from the database. */
  private cachesLoaded: boolean;

  constructor(
    config: DevStatusConfig,
    jiraRepo: JiraRepository,
  ) {
    this.config = config;
    this.jiraRepo = jiraRepo;
    this.logger = LoggerService.getInstance();

    this.knownBranches = new Map();
    this.knownPRs = new Map();
    this.cachesLoaded = false;

    this.logger.debug(CLASS_NAME, 'constructor', 'JiraDevStatusService created');
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Fetch GitHub dev status from the Jira REST API and persist branches
   * and pull requests to their respective tables.
   *
   * Maps from Python JiraApi.save_github_info().
   *
   * @param issueId - The Jira issue internal ID (numeric string)
   * @param issueKey - The Jira issue key (e.g., "IQS-100")
   * @returns Summary of branches and PRs saved
   */
  async fetchAndSave(
    issueId: string,
    issueKey: string,
  ): Promise<DevStatusSaveResult> {
    this.logger.debug(CLASS_NAME, 'fetchAndSave', `Fetching dev status for: ${issueKey} (id=${issueId})`);

    // Ensure dedup caches are loaded
    await this.ensureCachesLoaded();

    // Build the Jira dev status API URL
    const url = `${this.config.server}/rest/dev-status/latest/issue/detail?issueId=${encodeURIComponent(issueId)}&applicationType=GitHub&dataType=branch`;
    this.logger.debug(CLASS_NAME, 'fetchAndSave', `Dev status URL: ${url}`);

    // Make the HTTP request with Jira basic auth
    let response: IJiraDevStatusResponse;
    try {
      response = await this.fetchFromJira(url);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'fetchAndSave', `Failed to fetch dev status for ${issueKey}: ${message}`);
      return { branchesSaved: 0, prsSaved: 0 };
    }

    // Check for API errors
    if (response.errors.length > 0) {
      this.logger.error(CLASS_NAME, 'fetchAndSave', `Dev status API errors for ${issueKey}: ${JSON.stringify(response.errors)}`);
      return { branchesSaved: 0, prsSaved: 0 };
    }

    let branchesSaved = 0;
    let prsSaved = 0;
    const numericIssueId = parseInt(issueId, 10);

    for (const detail of response.detail) {
      // Process branches
      for (const branch of detail.branches) {
        try {
          const saved = await this.saveBranchIfNew(numericIssueId, issueKey, branch);
          if (saved) { branchesSaved++; }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'fetchAndSave', `Error saving branch for ${issueKey}: ${message}`);
        }
      }

      // Process pull requests
      for (const pr of detail.pullRequests) {
        try {
          const saved = await this.savePullRequestIfNew(numericIssueId, issueKey, pr);
          if (saved) { prsSaved++; }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'fetchAndSave', `Error saving PR for ${issueKey}: ${message}`);
        }
      }
    }

    this.logger.debug(CLASS_NAME, 'fetchAndSave', `Dev status for ${issueKey}: ${branchesSaved} branches, ${prsSaved} PRs saved`);
    return { branchesSaved, prsSaved };
  }

  /**
   * Fetch the dev status response from the Jira REST API.
   * Uses basic auth with Jira credentials.
   *
   * @param url - The full Jira dev status API URL
   * @returns Parsed IJiraDevStatusResponse
   */
  async fetchFromJira(url: string): Promise<IJiraDevStatusResponse> {
    this.logger.trace(CLASS_NAME, 'fetchFromJira', `Fetching: ${url}`);

    const authHeader = `Basic ${Buffer.from(`${this.config.username}:${this.config.token}`).toString('base64')}`;

    let retries = 0;
    let delayMs = DEFAULT_RATE_LIMIT_DELAY_MS;

    while (retries <= MAX_RATE_LIMIT_RETRIES) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
          },
        });

        if (response.status === 429 && retries < MAX_RATE_LIMIT_RETRIES) {
          retries++;
          this.logger.warn(CLASS_NAME, 'fetchFromJira', `Rate limited (429). Retry ${retries}/${MAX_RATE_LIMIT_RETRIES} after ${delayMs}ms`);
          await this.delay(delayMs);
          delayMs = Math.min(delayMs * 2, MAX_RATE_LIMIT_DELAY_MS);
          continue;
        }

        if (!response.ok) {
          throw new Error(`Jira dev status API returned ${response.status}: ${response.statusText}`);
        }

        const rawData: unknown = await response.json();
        this.logger.trace(CLASS_NAME, 'fetchFromJira', 'Response received, parsing...');

        const parsed = parseJiraDevStatusResponse(rawData);
        this.logger.trace(CLASS_NAME, 'fetchFromJira', `Parsed: ${parsed.detail.length} detail entries, ${parsed.errors.length} errors`);

        return parsed;
      } catch (error: unknown) {
        if (this.isRateLimitError(error) && retries < MAX_RATE_LIMIT_RETRIES) {
          retries++;
          this.logger.warn(CLASS_NAME, 'fetchFromJira', `Rate limited. Retry ${retries}/${MAX_RATE_LIMIT_RETRIES} after ${delayMs}ms`);
          await this.delay(delayMs);
          delayMs = Math.min(delayMs * 2, MAX_RATE_LIMIT_DELAY_MS);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Rate limit retries exhausted after ${MAX_RATE_LIMIT_RETRIES} attempts`);
  }

  // --------------------------------------------------------------------------
  // Private: Cache management
  // --------------------------------------------------------------------------

  /** Ensure deduplication caches are loaded from the database. */
  private async ensureCachesLoaded(): Promise<void> {
    if (this.cachesLoaded) { return; }

    this.logger.debug(CLASS_NAME, 'ensureCachesLoaded', 'Loading dedup caches from database');

    const dbBranches = await this.jiraRepo.getKnownJiraGitHubBranches();
    this.knownBranches = this.buildBranchLookup(dbBranches);
    this.logger.debug(CLASS_NAME, 'ensureCachesLoaded', `Loaded ${dbBranches.length} known branches`);

    const dbPRs = await this.jiraRepo.getKnownJiraGitHubPRs();
    this.knownPRs = this.buildPRLookup(dbPRs);
    this.logger.debug(CLASS_NAME, 'ensureCachesLoaded', `Loaded ${dbPRs.length} known PRs`);

    this.cachesLoaded = true;
  }

  /** Build lookup map for known branches: jiraId -> Set<"lastCommit|branchName"> */
  private buildBranchLookup(branches: KnownJiraGitHubBranch[]): Map<string, Set<string>> {
    const lookup = new Map<string, Set<string>>();
    for (const b of branches) {
      const key = String(b.jiraId);
      const dedupKey = `${b.lastCommit}|${b.branchName}`;
      const existing = lookup.get(key);
      if (existing) { existing.add(dedupKey); }
      else { lookup.set(key, new Set([dedupKey])); }
    }
    return lookup;
  }

  /** Build lookup map for known PRs: jiraId -> Set<prId> */
  private buildPRLookup(prs: KnownJiraGitHubPR[]): Map<string, Set<string>> {
    const lookup = new Map<string, Set<string>>();
    for (const pr of prs) {
      const key = String(pr.jiraId);
      const existing = lookup.get(key);
      if (existing) { existing.add(pr.id); }
      else { lookup.set(key, new Set([pr.id])); }
    }
    return lookup;
  }

  // --------------------------------------------------------------------------
  // Private: Save with deduplication
  // --------------------------------------------------------------------------

  /** Save a branch if not already known. Returns true if saved. */
  private async saveBranchIfNew(
    issueId: number,
    issueKey: string,
    branch: { name: string; url: string; createPullRequestUrl: string; lastCommit: { id: string; displayId: string; authorTimestamp: number; url: string; author: { name: string } } },
  ): Promise<boolean> {
    const jiraIdKey = String(issueId);
    const dedupKey = `${branch.lastCommit.id}|${branch.name}`;

    const knownForIssue = this.knownBranches.get(jiraIdKey);
    if (knownForIssue?.has(dedupKey)) {
      this.logger.trace(CLASS_NAME, 'saveBranchIfNew', `Skipping known branch: ${issueKey} ${branch.name}`);
      return false;
    }

    const row: JiraGitHubBranchRow = {
      jiraId: issueId,
      jiraKey: issueKey,
      branchName: branch.name,
      displayId: branch.lastCommit.displayId,
      lastCommit: branch.lastCommit.id,
      authorDate: new Date(branch.lastCommit.authorTimestamp),
      author: branch.lastCommit.author.name,
      branchUrl: branch.url,
      pullUrl: branch.createPullRequestUrl,
      commitUrl: branch.lastCommit.url,
    };

    await this.jiraRepo.insertJiraGitHubBranches([row]);

    if (knownForIssue) { knownForIssue.add(dedupKey); }
    else { this.knownBranches.set(jiraIdKey, new Set([dedupKey])); }

    this.logger.debug(CLASS_NAME, 'saveBranchIfNew', `Saved branch: ${issueKey} ${branch.name}`);
    return true;
  }

  /** Save a pull request if not already known. Returns true if saved. */
  private async savePullRequestIfNew(
    issueId: number,
    issueKey: string,
    pr: { id: string; name: string; source: unknown; destination: unknown; status: string; url: string; lastUpdate: string },
  ): Promise<boolean> {
    const jiraIdKey = String(issueId);

    const knownForIssue = this.knownPRs.get(jiraIdKey);
    if (knownForIssue?.has(pr.id)) {
      this.logger.trace(CLASS_NAME, 'savePullRequestIfNew', `Skipping known PR: ${issueKey} ${pr.id}`);
      return false;
    }

    const source = pr.source as { branch?: string; url?: string } | null;
    const destination = pr.destination as { branch?: string; url?: string } | null;

    const row: JiraGitHubPullRequestRow = {
      jiraId: issueId,
      jiraKey: issueKey,
      id: pr.id,
      name: pr.name,
      sourceBranch: source?.branch ?? null,
      sourceUrl: source?.url ?? null,
      destinationBranch: destination?.branch ?? null,
      destinationUrl: destination?.url ?? null,
      pullStatus: pr.status,
      url: pr.url,
      lastUpdate: pr.lastUpdate ? new Date(pr.lastUpdate) : null,
    };

    await this.jiraRepo.insertJiraGitHubPullRequests([row]);

    if (knownForIssue) { knownForIssue.add(pr.id); }
    else { this.knownPRs.set(jiraIdKey, new Set([pr.id])); }

    this.logger.debug(CLASS_NAME, 'savePullRequestIfNew', `Saved PR: ${issueKey} ${pr.id}`);
    return true;
  }

  // --------------------------------------------------------------------------
  // Private: Utility
  // --------------------------------------------------------------------------

  /** Check if an error is a rate limit (429) response. */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('429') || message.includes('rate limit') || message.includes('too many requests');
    }
    return false;
  }

  /** Delay execution for rate limiting. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
