/**
 * GitHub contributor sync service using @octokit/rest.
 *
 * Converts Python GitHubRelate.py to TypeScript:
 *   get_contributors_details -> syncContributors
 *   update_contributors_with_unknown_authors -> syncUnknownAuthors
 *   relate_git_sha_to_hub_url -> syncCommitUrls
 *
 * Key differences from Python: @octokit/rest replaces PyGithub;
 * parameterized queries replace f-string SQL; SecretStorage replaces
 * classified.properties; VS Code settings replace hardcoded org name.
 *
 * Ticket: IQS-859
 */

// @ts-expect-error -- @octokit/rest is ESM-only; esbuild bundles it correctly at build time
import { Octokit } from '@octokit/rest';
import { LoggerService } from '../logging/logger.js';
import { ContributorRepository } from '../database/contributor-repository.js';
import { CommitRepository } from '../database/commit-repository.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import type { CommitContributorRow } from '../database/contributor-types.js';
import type {
  GitHubServiceConfig,
  SyncContributorsResult,
  SyncUnknownAuthorsResult,
  SyncCommitUrlsResult,
  GitHubSyncResult,
  GitHubContributor,
} from './github-service-types.js';

// Re-export types so consumers can import from github-service directly
export type {
  GitHubServiceConfig,
  SyncContributorsResult,
  SyncUnknownAuthorsResult,
  SyncCommitUrlsResult,
  GitHubSyncResult,
  GitHubContributor,
} from './github-service-types.js';

const CLASS_NAME = 'GitHubService';
const DEFAULT_RATE_LIMIT_DELAY_MS = 100;
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_RATE_LIMIT_DELAY_MS = 30_000;
const GITHUB_PAGE_SIZE = 100;

/**
 * Service for syncing GitHub contributor data to the local database.
 * Uses @octokit/rest for the GitHub REST API with parameterized SQL,
 * rate limiting, multi-repo deduplication, and pipeline run tracking.
 */
export class GitHubService {
  private readonly logger: LoggerService;
  private readonly octokit: Octokit;
  private readonly contributorRepo: ContributorRepository;
  private readonly commitRepo: CommitRepository;
  private readonly pipelineRepo: PipelineRepository;
  private readonly config: GitHubServiceConfig;

  constructor(
    config: GitHubServiceConfig,
    contributorRepo: ContributorRepository,
    commitRepo: CommitRepository,
    pipelineRepo: PipelineRepository,
    octokit?: Octokit,
  ) {
    this.config = config;
    this.contributorRepo = contributorRepo;
    this.commitRepo = commitRepo;
    this.pipelineRepo = pipelineRepo;
    this.logger = LoggerService.getInstance();

    // Allow injection of Octokit client for testing
    this.octokit = octokit ?? new Octokit({ auth: config.token });

    this.logger.debug(CLASS_NAME, 'constructor', `GitHubService created for org: ${config.organization}`);
    this.logger.trace(CLASS_NAME, 'constructor', 'Token provided via SecretStorage (not logged)');
  }

  /**
   * Run a full GitHub sync for all configured repositories.
   * Syncs contributors, unknown authors, and commit URLs for each repo.
   */
  async syncAll(
    repoNames: readonly string[],
    defaultTeam = 'New',
  ): Promise<GitHubSyncResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'syncAll', `Starting full GitHub sync for ${repoNames.length} repos`);

    const contributorResults: SyncContributorsResult[] = [];
    const unknownAuthorResults: SyncUnknownAuthorsResult[] = [];
    const commitUrlResults: SyncCommitUrlsResult[] = [];

    for (const repoName of repoNames) {
      this.logger.info(CLASS_NAME, 'syncAll', `Processing repo: ${repoName}`);

      // 1. Sync contributors from GitHub
      const contribResult = await this.syncContributors(repoName, defaultTeam);
      contributorResults.push(contribResult);

      // 2. Sync unknown authors from commit history
      const unknownResult = await this.syncUnknownAuthors(repoName, defaultTeam);
      unknownAuthorResults.push(unknownResult);

      // 3. Sync commit URLs
      const urlResult = await this.syncCommitUrls(repoName);
      commitUrlResults.push(urlResult);
    }

    const totalDurationMs = Date.now() - startTime;
    this.logger.info(CLASS_NAME, 'syncAll', `Full sync complete in ${totalDurationMs}ms`);

    return {
      contributorResults,
      unknownAuthorResults,
      commitUrlResults,
      totalDurationMs,
    };
  }

  /**
   * Fetch contributors from GitHub and sync to commit_contributors table.
   * Maps from Python GitHubRelate.get_contributors_details().
   * Handles insert (new), update (add repo), and skip (already known).
   */
  async syncContributors(
    repoName: string,
    defaultTeam = 'New',
  ): Promise<SyncContributorsResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'syncContributors', `Syncing contributors for: ${repoName}`);

    // Start pipeline tracking
    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'syncContributors',
      detail: `Syncing GitHub contributors for ${repoName}`,
      status: 'START',
    });
    this.logger.debug(CLASS_NAME, 'syncContributors', `Pipeline run started: id=${pipelineRunId}`);

    let contributorsInserted = 0;
    let contributorsUpdated = 0;
    let contributorsSkipped = 0;
    let errorCount = 0;

    try {
      // Get current contributors from database (login -> repo mapping)
      const knownContributors = await this.contributorRepo.getCurrentContributors();
      this.logger.debug(CLASS_NAME, 'syncContributors', `Known contributors in DB: ${knownContributors.size}`);

      // Fetch contributors from GitHub API with pagination
      const githubContributors = await this.fetchGitHubContributors(repoName);
      this.logger.info(CLASS_NAME, 'syncContributors', `GitHub returned ${githubContributors.length} contributors for ${repoName}`);

      // Process each contributor
      for (const ghContrib of githubContributors) {
        try {
          const result = await this.processContributor(
            ghContrib, repoName, knownContributors, defaultTeam,
          );

          switch (result) {
            case 'inserted':
              contributorsInserted++;
              break;
            case 'updated':
              contributorsUpdated++;
              break;
            case 'skipped':
              contributorsSkipped++;
              break;
          }
        } catch (error: unknown) {
          errorCount++;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'syncContributors', `Error processing contributor ${ghContrib.login}: ${message}`);
        }
      }

      await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FINISHED');
      this.logger.info(CLASS_NAME, 'syncContributors', `Sync complete: ${contributorsInserted} inserted, ${contributorsUpdated} updated, ${contributorsSkipped} skipped, ${errorCount} errors`);

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'syncContributors', `Fatal error syncing ${repoName}: ${message}`);
      await this.pipelineRepo.updatePipelineRun(pipelineRunId, `ERROR: ${message.substring(0, 200)}`);
    }

    const durationMs = Date.now() - startTime;
    this.logger.debug(CLASS_NAME, 'syncContributors', `Duration: ${durationMs}ms`);

    return {
      repoName,
      contributorsInserted,
      contributorsUpdated,
      contributorsSkipped,
      errorCount,
      durationMs,
    };
  }

  /**
   * Identify commit authors not in commit_contributors and insert them
   * as new contributors with vendor='New' and team=defaultTeam.
   * Maps from Python GitHubRelate.update_contributors_with_unknown_authors().
   */
  async syncUnknownAuthors(
    repoName: string,
    defaultTeam = 'New',
  ): Promise<SyncUnknownAuthorsResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'syncUnknownAuthors', `Identifying unknown authors for: ${repoName}`);

    // Start pipeline tracking
    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'syncUnknownAuthors',
      detail: `Identifying unknown commit authors for ${repoName}`,
      status: 'START',
    });
    this.logger.debug(CLASS_NAME, 'syncUnknownAuthors', `Pipeline run started: id=${pipelineRunId}`);

    let authorsInserted = 0;
    let errorCount = 0;

    try {
      // identifyUnknownCommitAuthors is in CommitRepository
      const unknowns = await this.commitRepo.identifyUnknownCommitAuthors(repoName);
      this.logger.info(CLASS_NAME, 'syncUnknownAuthors', `Found ${unknowns.length} unknown authors for ${repoName}`);

      for (const unknown of unknowns) {
        try {
          const row: CommitContributorRow = {
            login: unknown.author,
            username: unknown.author,
            email: null,
            bio: null,
            userLocation: null,
            publicRepos: null,
            followers: null,
            followingUsers: null,
            vendor: 'New',
            repo: unknown.repo,
            team: defaultTeam,
            fullName: unknown.author,
            jiraName: 'New',
            isCompanyAccount: false,
          };

          await this.contributorRepo.insertCommitContributor(row);
          authorsInserted++;

          this.logger.debug(CLASS_NAME, 'syncUnknownAuthors', `Inserted unknown author: ${unknown.author} (repo: ${unknown.repo})`);
        } catch (error: unknown) {
          errorCount++;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'syncUnknownAuthors', `Error inserting unknown author ${unknown.author}: ${message}`);
        }
      }

      await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FINISHED');
      this.logger.info(CLASS_NAME, 'syncUnknownAuthors', `Unknown authors sync complete: ${authorsInserted} inserted, ${errorCount} errors`);

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'syncUnknownAuthors', `Fatal error for ${repoName}: ${message}`);
      await this.pipelineRepo.updatePipelineRun(pipelineRunId, `ERROR: ${message.substring(0, 200)}`);
    }

    const durationMs = Date.now() - startTime;
    this.logger.debug(CLASS_NAME, 'syncUnknownAuthors', `Duration: ${durationMs}ms`);

    return {
      repoName,
      authorsInserted,
      errorCount,
      durationMs,
    };
  }

  /**
   * Find commits without GitHub URLs and fetch them from the GitHub API.
   * Maps from Python GitHubRelate.relate_git_sha_to_hub_url().
   */
  async syncCommitUrls(
    repoName: string,
  ): Promise<SyncCommitUrlsResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'syncCommitUrls', `Syncing commit URLs for: ${repoName}`);

    // Start pipeline tracking
    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'syncCommitUrls',
      detail: `Syncing commit URLs for ${repoName}`,
      status: 'START',
    });
    this.logger.debug(CLASS_NAME, 'syncCommitUrls', `Pipeline run started: id=${pipelineRunId}`);

    let urlsUpdated = 0;
    let errorCount = 0;

    try {
      // Find SHAs without URLs
      const shasWithoutUrl = await this.commitRepo.findShasWithoutUrl(repoName);
      this.logger.info(CLASS_NAME, 'syncCommitUrls', `Found ${shasWithoutUrl.length} SHAs without URLs for ${repoName}`);

      for (const sha of shasWithoutUrl) {
        try {
          // Fetch commit from GitHub
          const commitUrl = await this.fetchCommitUrl(repoName, sha);

          if (commitUrl) {
            await this.commitRepo.updateCommitUrl(sha, commitUrl);
            urlsUpdated++;
            this.logger.debug(CLASS_NAME, 'syncCommitUrls', `Updated URL for ${sha.substring(0, 8)}`);
          } else {
            this.logger.debug(CLASS_NAME, 'syncCommitUrls', `No URL found for ${sha.substring(0, 8)}`);
          }

          // Rate limiting between API calls
          await this.delay(DEFAULT_RATE_LIMIT_DELAY_MS);
        } catch (error: unknown) {
          errorCount++;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'syncCommitUrls', `Error fetching URL for ${sha.substring(0, 8)}: ${message}`);
        }
      }

      await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FINISHED');
      this.logger.info(CLASS_NAME, 'syncCommitUrls', `URL sync complete: ${urlsUpdated} updated, ${errorCount} errors`);

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'syncCommitUrls', `Fatal error for ${repoName}: ${message}`);
      await this.pipelineRepo.updatePipelineRun(pipelineRunId, `ERROR: ${message.substring(0, 200)}`);
    }

    const durationMs = Date.now() - startTime;
    this.logger.debug(CLASS_NAME, 'syncCommitUrls', `Duration: ${durationMs}ms`);

    return {
      repoName,
      urlsUpdated,
      errorCount,
      durationMs,
    };
  }

  /** Fetch all contributors for a repo with pagination. Maps from Python repo.get_contributors(). */
  private async fetchGitHubContributors(
    repoName: string,
  ): Promise<GitHubContributor[]> {
    this.logger.debug(CLASS_NAME, 'fetchGitHubContributors', `Fetching contributors for ${this.config.organization}/${repoName}`);

    const contributors: GitHubContributor[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      this.logger.trace(CLASS_NAME, 'fetchGitHubContributors', `Fetching page ${page}`);

      let response;
      try {
        response = await this.callWithRateLimiting(async () =>
          this.octokit.repos.listContributors({
            owner: this.config.organization,
            repo: repoName,
            per_page: GITHUB_PAGE_SIZE,
            page,
          }),
        );
      } catch (error: unknown) {
        // Handle 404 errors (repo not found, private, or inaccessible)
        if (this.isNotFoundError(error)) {
          this.logger.warn(CLASS_NAME, 'fetchGitHubContributors', `Repository not found on GitHub: ${this.config.organization}/${repoName} (may be local-only, private, or renamed)`);
          return [];
        }
        throw error;
      }

      if (!response || response.data.length === 0) { hasMore = false; break; }
      this.logger.trace(CLASS_NAME, 'fetchGitHubContributors', `Page ${page}: ${response.data.length} contributors`);

      // For each contributor, fetch their full profile to get name, email, bio, etc.
      for (const contrib of response.data) {
        if (!contrib.login) {
          this.logger.debug(CLASS_NAME, 'fetchGitHubContributors', 'Skipping contributor with no login');
          continue;
        }

        try {
          const userProfile = await this.fetchUserProfile(contrib.login);
          contributors.push(userProfile);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(CLASS_NAME, 'fetchGitHubContributors', `Failed to fetch profile for ${contrib.login}: ${message}`);

          // Fallback to minimal data from contributor listing
          contributors.push({ login: contrib.login, name: null, email: null, bio: null, location: null, publicRepos: 0, followers: 0, following: 0 });
        }

        // Rate limiting between user profile fetches
        await this.delay(DEFAULT_RATE_LIMIT_DELAY_MS);
      }

      hasMore = response.data.length >= GITHUB_PAGE_SIZE;
      page++;
    }

    this.logger.debug(CLASS_NAME, 'fetchGitHubContributors', `Total contributors fetched: ${contributors.length}`);
    return contributors;
  }

  /** Fetch a user's full profile. Maps from Python contributor.login/name/email fields. */
  private async fetchUserProfile(login: string): Promise<GitHubContributor> {
    this.logger.trace(CLASS_NAME, 'fetchUserProfile', `Fetching profile for: ${login}`);

    const response = await this.callWithRateLimiting(async () =>
      this.octokit.users.getByUsername({ username: login }),
    );

    if (!response) {
      this.logger.warn(CLASS_NAME, 'fetchUserProfile', `Rate limit exhausted for: ${login}`);
      return { login, name: null, email: null, bio: null, location: null, publicRepos: 0, followers: 0, following: 0 };
    }

    const user = response.data;
    this.logger.trace(CLASS_NAME, 'fetchUserProfile', `Profile fetched for ${login}: name=${user.name ?? '(none)'}`);

    return {
      login: user.login,
      name: user.name ?? null,
      email: user.email ?? null,
      bio: user.bio ?? null,
      location: user.location ?? null,
      publicRepos: user.public_repos ?? 0,
      followers: user.followers ?? 0,
      following: user.following ?? 0,
    };
  }

  /** Fetch a commit's HTML URL. Maps from Python self.repo.get_commit(sha).html_url. */
  private async fetchCommitUrl(repoName: string, sha: string): Promise<string | null> {
    this.logger.trace(CLASS_NAME, 'fetchCommitUrl', `Fetching commit URL for ${sha.substring(0, 8)} in ${repoName}`);

    try {
      const response = await this.callWithRateLimiting(async () =>
        this.octokit.repos.getCommit({
          owner: this.config.organization,
          repo: repoName,
          ref: sha,
        }),
      );

      if (response) {
        const url = response.data.html_url;
        this.logger.trace(CLASS_NAME, 'fetchCommitUrl', `URL: ${url}`);
        return url;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(CLASS_NAME, 'fetchCommitUrl', `Commit not found: ${sha.substring(0, 8)} - ${message}`);
    }

    return null;
  }

  /** Process a single contributor: skip (known+repo), update (known+new repo), or insert (new). */
  private async processContributor(
    ghContrib: GitHubContributor,
    repoName: string,
    knownContributors: Map<string, string>,
    defaultTeam: string,
  ): Promise<'inserted' | 'updated' | 'skipped'> {
    this.logger.trace(CLASS_NAME, 'processContributor', `Processing: ${ghContrib.login}`);

    const existingRepo = knownContributors.get(ghContrib.login);

    if (existingRepo !== undefined) {
      // Contributor is known - check if this repo is already listed
      // Python: if re.search(str(self.repo.name), str(known_contributors[contributor.login]), re.IGNORECASE)
      if (existingRepo.toLowerCase().includes(repoName.toLowerCase())) {
        this.logger.trace(CLASS_NAME, 'processContributor', `Skipping ${ghContrib.login} - already has repo ${repoName}`);
        return 'skipped';
      }

      // Update repo field with appended repo name
      // Python: repo = '{existing_repo}, {repo_name}'
      const updatedRepo = `${existingRepo}, ${repoName}`;
      await this.contributorRepo.updateContributorRepo(ghContrib.login, updatedRepo);
      this.logger.debug(CLASS_NAME, 'processContributor', `Updated ${ghContrib.login} repo: ${updatedRepo}`);

      // Update the local map to reflect the change for subsequent checks
      knownContributors.set(ghContrib.login, updatedRepo);

      return 'updated';
    }

    // New contributor - insert
    const row: CommitContributorRow = {
      login: ghContrib.login,
      username: ghContrib.name,
      email: ghContrib.email,
      bio: ghContrib.bio,
      userLocation: ghContrib.location,
      publicRepos: ghContrib.publicRepos !== null ? String(ghContrib.publicRepos) : null,
      followers: ghContrib.followers !== null ? String(ghContrib.followers) : null,
      followingUsers: ghContrib.following !== null ? String(ghContrib.following) : null,
      vendor: 'New',
      repo: repoName,
      team: defaultTeam,
      fullName: ghContrib.login,
      jiraName: 'New',
      isCompanyAccount: true,
    };

    await this.contributorRepo.insertCommitContributor(row);
    this.logger.debug(CLASS_NAME, 'processContributor', `Inserted new contributor: ${ghContrib.login}`);

    // Update the local map for multi-repo deduplication
    knownContributors.set(ghContrib.login, repoName);

    return 'inserted';
  }

  /** Execute an API call with exponential backoff on 403/429 rate limit responses. */
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
          this.logger.warn(CLASS_NAME, 'callWithRateLimiting', `Rate limited. Retry ${retries}/${MAX_RATE_LIMIT_RETRIES} after ${delayMs}ms`);
          await this.delay(delayMs);
          delayMs = Math.min(delayMs * 2, MAX_RATE_LIMIT_DELAY_MS);
          continue;
        }

        // Non-rate-limit error or retries exhausted - re-throw
        throw error;
      }
    }

    this.logger.error(CLASS_NAME, 'callWithRateLimiting', `Rate limit retries exhausted after ${MAX_RATE_LIMIT_RETRIES} attempts`);
    return null;
  }

  /** Check if an error is a GitHub rate limit response (403/429). */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('too many requests') ||
        message.includes('secondary rate limit');
    }
    return false;
  }

  /** Check if an error is a GitHub 404 Not Found response. */
  private isNotFoundError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Octokit throws errors with status codes in the message
      return message.includes('404') ||
        message.includes('not found');
    }
    // Check for Octokit RequestError with status property
    if (error && typeof error === 'object' && 'status' in error) {
      return (error as { status: number }).status === 404;
    }
    return false;
  }

  /** Delay execution for rate limiting between API requests. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
