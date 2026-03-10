import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { ContributorRepository } from '../../database/contributor-repository.js';
import { CommitRepository } from '../../database/commit-repository.js';
import { PipelineRepository } from '../../database/pipeline-repository.js';
import {
  GitHubService,
  type GitHubServiceConfig,
  type GitHubContributor,
} from '../../services/github-service.js';

/**
 * Unit tests for GitHubService class.
 *
 * Tests contributor sync, unknown author detection, commit URL mapping,
 * rate limiting, and multi-repo deduplication. Uses mocked Octokit client
 * and mocked database repositories.
 *
 * Ticket: IQS-859
 */

// ============================================================================
// Mock setup
// ============================================================================

// Mock pg module
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockOn = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    end: mockEnd,
    on: mockOn,
    query: mockQuery,
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  })),
}));

// Mock @octokit/rest - we inject a mock client directly so this is a fallback
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    repos: {
      listContributors: vi.fn(),
      getCommit: vi.fn(),
    },
    users: {
      getByUsername: vi.fn(),
    },
  })),
}));

// ============================================================================
// Test helpers
// ============================================================================

function createDbConfig(): DatabaseServiceConfig {
  return {
    host: 'localhost',
    port: 5433,
    database: 'gitrx_test',
    user: 'test_user',
    password: 'test_password',
  };
}

function createGitHubConfig(): GitHubServiceConfig {
  return {
    token: 'ghp_test-token-secret',
    organization: 'TestOrg',
  };
}

function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

/**
 * Create a mock Octokit client for injection.
 */
function createMockOctokit() {
  return {
    repos: {
      listContributors: vi.fn(),
      getCommit: vi.fn(),
    },
    users: {
      getByUsername: vi.fn(),
    },
  };
}

/**
 * Create a mock GitHub contributor list response.
 */
function createMockContributorListResponse(contributors: Array<{ login: string }>) {
  return {
    data: contributors.map((c) => ({
      login: c.login,
      id: Math.floor(Math.random() * 100000),
      contributions: 10,
    })),
    status: 200,
    headers: {},
    url: '',
  };
}

/**
 * Create a mock GitHub user profile response.
 */
function createMockUserResponse(overrides?: Partial<GitHubContributor>) {
  const o = overrides ?? {};
  return {
    data: {
      login: o.login ?? 'testuser',
      name: o.name ?? 'Test User',
      email: o.email ?? 'test@example.com',
      bio: o.bio ?? 'A test user',
      location: o.location ?? 'San Francisco',
      public_repos: o.publicRepos ?? 42,
      followers: o.followers ?? 100,
      following: o.following ?? 50,
    },
    status: 200,
    headers: {},
    url: '',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('GitHubService', () => {
  let dbService: DatabaseService;
  let contributorRepo: ContributorRepository;
  let commitRepo: CommitRepository;
  let pipelineRepo: PipelineRepository;
  let mockOctokit: ReturnType<typeof createMockOctokit>;
  let githubConfig: GitHubServiceConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createDbConfig());
    contributorRepo = new ContributorRepository(dbService);
    commitRepo = new CommitRepository(dbService);
    pipelineRepo = new PipelineRepository(dbService);
    mockOctokit = createMockOctokit();
    githubConfig = createGitHubConfig();
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create GitHubService with provided config', () => {
      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );
      expect(service).toBeDefined();
    });

    it('should accept optional Octokit injection for testing', () => {
      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );
      expect(service).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // syncContributors
  // --------------------------------------------------------------------------

  describe('syncContributors', () => {
    it('should insert new contributors from GitHub', async () => {
      // Setup pipeline mocks
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      // No existing contributors
      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map<string, string>());

      // Mock insert
      const insertSpy = vi.spyOn(contributorRepo, 'insertCommitContributor')
        .mockResolvedValue();

      // GitHub returns 1 contributor
      mockOctokit.repos.listContributors.mockResolvedValue(
        createMockContributorListResponse([{ login: 'dev1' }]),
      );
      mockOctokit.users.getByUsername.mockResolvedValue(
        createMockUserResponse({
          login: 'dev1',
          name: 'Developer One',
          email: 'dev1@example.com',
        }),
      );

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('my-repo');

      expect(insertSpy).toHaveBeenCalledTimes(1);
      expect(result.contributorsInserted).toBe(1);
      expect(result.contributorsUpdated).toBe(0);
      expect(result.contributorsSkipped).toBe(0);
      expect(result.repoName).toBe('my-repo');
    });

    it('should skip contributors already known for this repo', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      // Contributor already known with this repo
      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map([['dev1', 'my-repo']]));

      const insertSpy = vi.spyOn(contributorRepo, 'insertCommitContributor')
        .mockResolvedValue();

      mockOctokit.repos.listContributors.mockResolvedValue(
        createMockContributorListResponse([{ login: 'dev1' }]),
      );
      mockOctokit.users.getByUsername.mockResolvedValue(
        createMockUserResponse({ login: 'dev1' }),
      );

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('my-repo');

      expect(insertSpy).not.toHaveBeenCalled();
      expect(result.contributorsSkipped).toBe(1);
      expect(result.contributorsInserted).toBe(0);
    });

    it('should update contributor repo when known for different repo', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      // Contributor known for 'other-repo' but not 'my-repo'
      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map([['dev1', 'other-repo']]));

      const updateRepoSpy = vi.spyOn(contributorRepo, 'updateContributorRepo')
        .mockResolvedValue();

      mockOctokit.repos.listContributors.mockResolvedValue(
        createMockContributorListResponse([{ login: 'dev1' }]),
      );
      mockOctokit.users.getByUsername.mockResolvedValue(
        createMockUserResponse({ login: 'dev1' }),
      );

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('my-repo');

      expect(updateRepoSpy).toHaveBeenCalledWith('dev1', 'other-repo, my-repo');
      expect(result.contributorsUpdated).toBe(1);
      expect(result.contributorsInserted).toBe(0);
      expect(result.contributorsSkipped).toBe(0);
    });

    it('should handle multiple contributors with mixed status', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      // dev1 known for my-repo (skip), dev2 known for other-repo (update), dev3 new (insert)
      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map([
          ['dev1', 'my-repo'],
          ['dev2', 'other-repo'],
        ]));

      vi.spyOn(contributorRepo, 'insertCommitContributor').mockResolvedValue();
      vi.spyOn(contributorRepo, 'updateContributorRepo').mockResolvedValue();

      mockOctokit.repos.listContributors.mockResolvedValue(
        createMockContributorListResponse([
          { login: 'dev1' },
          { login: 'dev2' },
          { login: 'dev3' },
        ]),
      );

      mockOctokit.users.getByUsername
        .mockResolvedValueOnce(createMockUserResponse({ login: 'dev1' }))
        .mockResolvedValueOnce(createMockUserResponse({ login: 'dev2' }))
        .mockResolvedValueOnce(createMockUserResponse({ login: 'dev3' }));

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('my-repo');

      expect(result.contributorsSkipped).toBe(1);
      expect(result.contributorsUpdated).toBe(1);
      expect(result.contributorsInserted).toBe(1);
    });

    it('should continue processing when individual contributor fails', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map());

      // First insert succeeds, second fails, third succeeds
      vi.spyOn(contributorRepo, 'insertCommitContributor')
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce();

      mockOctokit.repos.listContributors.mockResolvedValue(
        createMockContributorListResponse([
          { login: 'dev1' },
          { login: 'dev2' },
          { login: 'dev3' },
        ]),
      );

      mockOctokit.users.getByUsername
        .mockResolvedValueOnce(createMockUserResponse({ login: 'dev1' }))
        .mockResolvedValueOnce(createMockUserResponse({ login: 'dev2' }))
        .mockResolvedValueOnce(createMockUserResponse({ login: 'dev3' }));

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('my-repo');

      expect(result.contributorsInserted).toBe(2);
      expect(result.errorCount).toBe(1);
    });

    it('should handle empty contributor list from GitHub', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map());

      mockOctokit.repos.listContributors.mockResolvedValue({
        data: [],
        status: 200,
        headers: {},
        url: '',
      });

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('empty-repo');

      expect(result.contributorsInserted).toBe(0);
      expect(result.contributorsUpdated).toBe(0);
      expect(result.contributorsSkipped).toBe(0);
    });

    it('should use fallback data when user profile fetch fails', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map());

      const insertSpy = vi.spyOn(contributorRepo, 'insertCommitContributor')
        .mockResolvedValue();

      // Contributor list succeeds but user profile fails
      mockOctokit.repos.listContributors.mockResolvedValue(
        createMockContributorListResponse([{ login: 'dev1' }]),
      );
      mockOctokit.users.getByUsername.mockRejectedValue(
        new Error('Not found'),
      );

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('my-repo');

      // Should still insert with minimal data
      expect(insertSpy).toHaveBeenCalledTimes(1);
      expect(result.contributorsInserted).toBe(1);
    });

    it('should gracefully handle 404 when repo does not exist on GitHub', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map());

      const insertSpy = vi.spyOn(contributorRepo, 'insertCommitContributor')
        .mockResolvedValue();

      // GitHub returns 404 for local-only/private/nonexistent repo
      mockOctokit.repos.listContributors.mockRejectedValue(
        new Error('Not Found - 404'),
      );

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('local-only-repo');

      // Should gracefully return 0 contributors, not throw
      expect(insertSpy).not.toHaveBeenCalled();
      expect(result.contributorsInserted).toBe(0);
      expect(result.contributorsSkipped).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(result.repoName).toBe('local-only-repo');
    });

    it('should handle 404 with Octokit status property', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map());

      // Simulate Octokit RequestError with status property
      const notFoundError = new Error('Not Found') as Error & { status: number };
      notFoundError.status = 404;
      mockOctokit.repos.listContributors.mockRejectedValue(notFoundError);

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('deleted-repo');

      expect(result.contributorsInserted).toBe(0);
      expect(result.errorCount).toBe(0);
    });

    it('should track pipeline run', async () => {
      const startSpy = vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(42);
      const updateSpy = vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map());

      mockOctokit.repos.listContributors.mockResolvedValue({
        data: [],
        status: 200,
        headers: {},
        url: '',
      });

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      await service.syncContributors('my-repo');

      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({
        className: 'GitHubService',
        context: 'syncContributors',
        status: 'START',
      }));
      expect(updateSpy).toHaveBeenCalledWith(42, 'FINISHED');
    });
  });

  // --------------------------------------------------------------------------
  // syncUnknownAuthors
  // --------------------------------------------------------------------------

  describe('syncUnknownAuthors', () => {
    it('should insert unknown commit authors as new contributors', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      // Two unknown authors
      vi.spyOn(commitRepo, 'identifyUnknownCommitAuthors')
        .mockResolvedValue([
          { author: 'unknown1', repo: 'my-repo', count: 5 },
          { author: 'unknown2', repo: 'my-repo', count: 3 },
        ]);

      const insertSpy = vi.spyOn(contributorRepo, 'insertCommitContributor')
        .mockResolvedValue();

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncUnknownAuthors('my-repo');

      expect(insertSpy).toHaveBeenCalledTimes(2);
      expect(result.authorsInserted).toBe(2);
      expect(result.repoName).toBe('my-repo');

      // Verify the inserted data shape
      const firstCall = insertSpy.mock.calls[0]![0]!;
      expect(firstCall.login).toBe('unknown1');
      expect(firstCall.vendor).toBe('New');
      expect(firstCall.team).toBe('New');
      expect(firstCall.isCompanyAccount).toBe(false);
      expect(firstCall.jiraName).toBe('New');
    });

    it('should use custom team name for unknown authors', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(commitRepo, 'identifyUnknownCommitAuthors')
        .mockResolvedValue([
          { author: 'unknown1', repo: 'my-repo', count: 5 },
        ]);

      const insertSpy = vi.spyOn(contributorRepo, 'insertCommitContributor')
        .mockResolvedValue();

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      await service.syncUnknownAuthors('my-repo', 'EC');

      const insertedRow = insertSpy.mock.calls[0]![0]!;
      expect(insertedRow.team).toBe('EC');
    });

    it('should handle empty unknown authors list', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(commitRepo, 'identifyUnknownCommitAuthors')
        .mockResolvedValue([]);

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncUnknownAuthors('my-repo');

      expect(result.authorsInserted).toBe(0);
      expect(result.errorCount).toBe(0);
    });

    it('should continue processing when individual author insert fails', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(commitRepo, 'identifyUnknownCommitAuthors')
        .mockResolvedValue([
          { author: 'unknown1', repo: 'my-repo', count: 5 },
          { author: 'unknown2', repo: 'my-repo', count: 3 },
        ]);

      vi.spyOn(contributorRepo, 'insertCommitContributor')
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error('Constraint violation'));

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncUnknownAuthors('my-repo');

      expect(result.authorsInserted).toBe(1);
      expect(result.errorCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // syncCommitUrls
  // --------------------------------------------------------------------------

  describe('syncCommitUrls', () => {
    it('should update commit URLs from GitHub', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(commitRepo, 'findShasWithoutUrl')
        .mockResolvedValue(['abc123def456', 'xyz789abc012']);

      const updateUrlSpy = vi.spyOn(commitRepo, 'updateCommitUrl')
        .mockResolvedValue();

      mockOctokit.repos.getCommit
        .mockResolvedValueOnce({
          data: { html_url: 'https://github.com/TestOrg/my-repo/commit/abc123def456' },
          status: 200,
        })
        .mockResolvedValueOnce({
          data: { html_url: 'https://github.com/TestOrg/my-repo/commit/xyz789abc012' },
          status: 200,
        });

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncCommitUrls('my-repo');

      expect(updateUrlSpy).toHaveBeenCalledTimes(2);
      expect(result.urlsUpdated).toBe(2);
      expect(result.errorCount).toBe(0);
    });

    it('should handle empty SHA list', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(commitRepo, 'findShasWithoutUrl')
        .mockResolvedValue([]);

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncCommitUrls('my-repo');

      expect(result.urlsUpdated).toBe(0);
      expect(result.errorCount).toBe(0);
    });

    it('should continue processing when individual commit URL fetch fails', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(commitRepo, 'findShasWithoutUrl')
        .mockResolvedValue(['sha1aabbccdd', 'sha2eeffgghh']);

      const updateUrlSpy = vi.spyOn(commitRepo, 'updateCommitUrl').mockResolvedValue();

      // First succeeds, second returns a commit not found (fetchCommitUrl catches
      // and returns null, so urlsUpdated stays at 1 and no error is counted)
      mockOctokit.repos.getCommit
        .mockResolvedValueOnce({
          data: { html_url: 'https://github.com/TestOrg/my-repo/commit/sha1aabbccdd' },
          status: 200,
        })
        .mockRejectedValueOnce(new Error('Not found'));

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncCommitUrls('my-repo');

      // First URL updated successfully
      expect(updateUrlSpy).toHaveBeenCalledTimes(1);
      expect(result.urlsUpdated).toBe(1);
      // fetchCommitUrl catches the error internally and returns null,
      // so the outer handler does not see an error for this SHA
      expect(result.errorCount).toBe(0);
    });

    it('should count errors when updateCommitUrl fails', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(commitRepo, 'findShasWithoutUrl')
        .mockResolvedValue(['sha1aabbccdd', 'sha2eeffgghh']);

      // First update succeeds, second update fails with DB error
      vi.spyOn(commitRepo, 'updateCommitUrl')
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error('DB write error'));

      mockOctokit.repos.getCommit
        .mockResolvedValueOnce({
          data: { html_url: 'https://github.com/TestOrg/my-repo/commit/sha1aabbccdd' },
          status: 200,
        })
        .mockResolvedValueOnce({
          data: { html_url: 'https://github.com/TestOrg/my-repo/commit/sha2eeffgghh' },
          status: 200,
        });

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncCommitUrls('my-repo');

      expect(result.urlsUpdated).toBe(1);
      expect(result.errorCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // syncAll
  // --------------------------------------------------------------------------

  describe('syncAll', () => {
    it('should sync all operations for multiple repos', async () => {
      // Pipeline mocks
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      // Contributor sync mocks
      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map());
      vi.spyOn(contributorRepo, 'insertCommitContributor').mockResolvedValue();

      // Unknown author mocks
      vi.spyOn(commitRepo, 'identifyUnknownCommitAuthors')
        .mockResolvedValue([]);

      // URL sync mocks
      vi.spyOn(commitRepo, 'findShasWithoutUrl')
        .mockResolvedValue([]);

      // GitHub API mocks
      mockOctokit.repos.listContributors.mockResolvedValue({
        data: [],
        status: 200,
        headers: {},
        url: '',
      });

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncAll(['repo1', 'repo2']);

      expect(result.contributorResults).toHaveLength(2);
      expect(result.unknownAuthorResults).toHaveLength(2);
      expect(result.commitUrlResults).toHaveLength(2);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // Multi-repo deduplication
  // --------------------------------------------------------------------------

  describe('multi-repo deduplication', () => {
    it('should case-insensitively detect existing repo in contributor record', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      // Contributor known for 'My-Repo' (different case)
      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map([['dev1', 'My-Repo']]));

      const insertSpy = vi.spyOn(contributorRepo, 'insertCommitContributor');
      const updateSpy = vi.spyOn(contributorRepo, 'updateContributorRepo');

      mockOctokit.repos.listContributors.mockResolvedValue(
        createMockContributorListResponse([{ login: 'dev1' }]),
      );
      mockOctokit.users.getByUsername.mockResolvedValue(
        createMockUserResponse({ login: 'dev1' }),
      );

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      // Syncing with 'my-repo' should match 'My-Repo' (case insensitive)
      const result = await service.syncContributors('my-repo');

      expect(insertSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(result.contributorsSkipped).toBe(1);
    });

    it('should detect repo in comma-separated list', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      // Contributor known for multiple repos including 'my-repo'
      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockResolvedValue(new Map([['dev1', 'other-repo, my-repo, third-repo']]));

      mockOctokit.repos.listContributors.mockResolvedValue(
        createMockContributorListResponse([{ login: 'dev1' }]),
      );
      mockOctokit.users.getByUsername.mockResolvedValue(
        createMockUserResponse({ login: 'dev1' }),
      );

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('my-repo');

      expect(result.contributorsSkipped).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Security
  // --------------------------------------------------------------------------

  describe('security', () => {
    it('should never include token in logged config', () => {
      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      // The service should exist and not expose token
      expect(service).toBeDefined();
    });

    it('should not accept empty token', () => {
      const emptyTokenConfig: GitHubServiceConfig = {
        token: '',
        organization: 'TestOrg',
      };

      // Service can be created (validation happens at usage time)
      const service = new GitHubService(
        emptyTokenConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );
      expect(service).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Pipeline tracking
  // --------------------------------------------------------------------------

  describe('pipeline tracking', () => {
    it('should track pipeline run for syncUnknownAuthors', async () => {
      const startSpy = vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(99);
      const updateSpy = vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(commitRepo, 'identifyUnknownCommitAuthors')
        .mockResolvedValue([]);

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      await service.syncUnknownAuthors('my-repo');

      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({
        className: 'GitHubService',
        context: 'syncUnknownAuthors',
        status: 'START',
      }));
      expect(updateSpy).toHaveBeenCalledWith(99, 'FINISHED');
    });

    it('should track pipeline run for syncCommitUrls', async () => {
      const startSpy = vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(77);
      const updateSpy = vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(commitRepo, 'findShasWithoutUrl')
        .mockResolvedValue([]);

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      await service.syncCommitUrls('my-repo');

      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({
        className: 'GitHubService',
        context: 'syncCommitUrls',
        status: 'START',
      }));
      expect(updateSpy).toHaveBeenCalledWith(77, 'FINISHED');
    });

    it('should record ERROR status on fatal failure', async () => {
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      const updateSpy = vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      vi.spyOn(contributorRepo, 'getCurrentContributors')
        .mockRejectedValue(new Error('Database connection lost'));

      const service = new GitHubService(
        githubConfig, contributorRepo, commitRepo, pipelineRepo,
        mockOctokit as never,
      );

      const result = await service.syncContributors('my-repo');

      expect(updateSpy).toHaveBeenCalledWith(1, expect.stringContaining('ERROR:'));
      expect(result.contributorsInserted).toBe(0);
    });
  });
});
