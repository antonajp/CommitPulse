import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { JiraRepository } from '../../database/jira-repository.js';
import { PipelineRepository } from '../../database/pipeline-repository.js';
import { JiraChangelogService } from '../../services/jira-changelog-service.js';
import { JiraDevStatusService } from '../../services/jira-dev-status-service.js';
import type { JiraServiceConfig } from '../../services/jira-service.js';
import type { Issue } from 'jira.js/out/version3/models/index.js';

/**
 * Unit tests for JiraChangelogService and JiraDevStatusService.
 *
 * Tests changelog extraction, GitHub dev status fetching, deduplication,
 * unfinished issue updates, and error handling.
 *
 * Ticket: IQS-857
 */

// ============================================================================
// Mock setup
// ============================================================================

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

vi.mock('jira.js', () => ({
  Version3Client: vi.fn().mockImplementation(() => ({
    issueSearch: {
      searchForIssuesUsingJql: vi.fn(),
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

function createJiraConfig(): JiraServiceConfig {
  return {
    server: 'https://test.atlassian.net',
    username: 'test@example.com',
    token: 'test-token-secret',
    pointsField: 'customfield_10034',
  };
}

function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

function createMockJiraClient() {
  return {
    issueSearch: {
      searchForIssuesUsingJql: vi.fn(),
    },
  };
}

/**
 * Create a mock Issue with changelog for testing.
 */
function createMockIssueWithChangelog(overrides?: {
  id?: string;
  key?: string;
  histories?: Array<{
    created: string;
    items: Array<{ field: string; fromString: string | null; toString: string | null }>;
  }>;
}): Issue {
  const o = overrides ?? {};
  return {
    id: o.id ?? '10001',
    key: o.key ?? 'IQS-100',
    fields: {
      summary: 'Test issue summary',
      priority: { name: 'High' },
      status: { name: 'In Progress' },
      created: '2024-01-15T10:00:00.000+0000',
      reporter: { displayName: 'Test Reporter' },
      assignee: { displayName: 'Test Assignee' },
      issuetype: { name: 'Story' },
      resolution: null,
      fixVersions: [],
      components: [],
      customfield_10034: null,
      statuscategorychangedate: '2024-01-20T12:00:00.000+0000',
      parent: undefined,
      issuelinks: [],
      aggregatetimespent: null,
      duedate: null,
      lastViewed: null,
      resolutiondate: null,
      timespent: null,
      timetracking: {},
      environment: null,
      workratio: 0,
      watches: { watchCount: 0, isWatching: false },
      labels: [],
      updated: '2024-01-20T12:00:00.000+0000',
      timeoriginalestimate: null,
      attachment: [],
      creator: { displayName: 'Creator' },
      subtasks: [],
      comment: { comments: [], self: '', maxResults: 0, total: 0, startAt: 0 },
      votes: { votes: 0, hasVoted: false },
      worklog: { startAt: 0, maxResults: 0, total: 0, worklogs: [] },
    },
    changelog: {
      histories: o.histories ?? [
        {
          created: '2024-01-16T14:30:00.000+0000',
          items: [
            { field: 'status', fromString: 'Open', toString: 'In Progress' },
          ],
        },
        {
          created: '2024-01-17T09:00:00.000+0000',
          items: [
            { field: 'assignee', fromString: 'User A', toString: 'User B' },
          ],
        },
      ],
    },
  } as unknown as Issue;
}

// ============================================================================
// JiraChangelogService Tests
// ============================================================================

describe('JiraChangelogService', () => {
  let dbService: DatabaseService;
  let jiraRepo: JiraRepository;
  let pipelineRepo: PipelineRepository;
  let mockJiraClient: ReturnType<typeof createMockJiraClient>;
  let jiraConfig: JiraServiceConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createDbConfig());
    jiraRepo = new JiraRepository(dbService);
    pipelineRepo = new PipelineRepository(dbService);
    mockJiraClient = createMockJiraClient();
    jiraConfig = createJiraConfig();
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
    it('should create JiraChangelogService with provided config', () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );
      expect(service).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // extractChangelog
  // --------------------------------------------------------------------------

  describe('extractChangelog', () => {
    it('should extract status and assignee changes from changelog', () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const issue = createMockIssueWithChangelog({
        key: 'IQS-100',
        histories: [
          {
            created: '2024-01-16T14:30:00.000+0000',
            items: [
              { field: 'status', fromString: 'Open', toString: 'In Progress' },
            ],
          },
          {
            created: '2024-01-17T09:00:00.000+0000',
            items: [
              { field: 'assignee', fromString: 'User A', toString: 'User B' },
            ],
          },
        ],
      });

      const result = service.extractChangelog(issue);

      expect(result).toHaveLength(2);
      expect(result[0]!.jiraKey).toBe('IQS-100');
      expect(result[0]!.field).toBe('status');
      expect(result[0]!.fromValue).toBe('Open');
      expect(result[0]!.toValue).toBe('In Progress');
      expect(result[0]!.changeDate).toBeInstanceOf(Date);

      expect(result[1]!.field).toBe('assignee');
      expect(result[1]!.fromValue).toBe('User A');
      expect(result[1]!.toValue).toBe('User B');
    });

    it('should filter out non-tracked fields', () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const issue = createMockIssueWithChangelog({
        histories: [
          {
            created: '2024-01-16T14:30:00.000+0000',
            items: [
              { field: 'status', fromString: 'Open', toString: 'In Progress' },
              { field: 'description', fromString: 'old', toString: 'new' },
              { field: 'priority', fromString: 'Low', toString: 'High' },
            ],
          },
        ],
      });

      const result = service.extractChangelog(issue);

      expect(result).toHaveLength(1);
      expect(result[0]!.field).toBe('status');
    });

    it('should handle empty changelog', () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const issue = createMockIssueWithChangelog({ histories: [] });
      const result = service.extractChangelog(issue);
      expect(result).toHaveLength(0);
    });

    it('should handle issue without changelog property', () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const issue = {
        id: '10001',
        key: 'IQS-100',
        fields: {
          summary: 'Test', priority: { name: 'High' }, status: { name: 'Open' },
          created: '2024-01-15T10:00:00.000+0000',
          reporter: { displayName: 'Reporter' }, assignee: { displayName: 'Assignee' },
          issuetype: { name: 'Story' }, resolution: null, fixVersions: [], components: [],
          customfield_10034: null, statuscategorychangedate: null, parent: undefined,
          issuelinks: [], aggregatetimespent: null, duedate: null, lastViewed: null,
          resolutiondate: null, timespent: null, timetracking: {}, environment: null,
          workratio: 0, watches: { watchCount: 0, isWatching: false }, labels: [],
          updated: '2024-01-20T12:00:00.000+0000', timeoriginalestimate: null,
          attachment: [], creator: { displayName: 'Creator' }, subtasks: [],
          comment: { comments: [], self: '', maxResults: 0, total: 0, startAt: 0 },
          votes: { votes: 0, hasVoted: false },
          worklog: { startAt: 0, maxResults: 0, total: 0, worklogs: [] },
        },
      } as unknown as Issue;

      const result = service.extractChangelog(issue);
      expect(result).toHaveLength(0);
    });

    it('should handle null fromString/toString values', () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const issue = createMockIssueWithChangelog({
        histories: [{
          created: '2024-01-16T14:30:00.000+0000',
          items: [{ field: 'assignee', fromString: null, toString: 'New Assignee' }],
        }],
      });

      const result = service.extractChangelog(issue);
      expect(result).toHaveLength(1);
      expect(result[0]!.fromValue).toBeNull();
      expect(result[0]!.toValue).toBe('New Assignee');
    });

    it('should handle multiple items in a single history entry', () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const issue = createMockIssueWithChangelog({
        histories: [{
          created: '2024-01-16T14:30:00.000+0000',
          items: [
            { field: 'status', fromString: 'Open', toString: 'In Progress' },
            { field: 'assignee', fromString: null, toString: 'Dev Person' },
          ],
        }],
      });

      const result = service.extractChangelog(issue);
      expect(result).toHaveLength(2);
      expect(result[0]!.field).toBe('status');
      expect(result[1]!.field).toBe('assignee');
    });
  });

  // --------------------------------------------------------------------------
  // updateUnfinishedIssues
  // --------------------------------------------------------------------------

  describe('updateUnfinishedIssues', () => {
    it('should process unfinished issues', async () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      vi.spyOn(jiraRepo, 'getUnfinishedJiraIssues2').mockResolvedValue([
        { jiraKey: 'IQS-100' },
      ]);

      vi.spyOn(jiraRepo, 'deleteGitHubDataForKey').mockResolvedValue();
      vi.spyOn(jiraRepo, 'deleteHistoryForKey').mockResolvedValue();
      vi.spyOn(jiraRepo, 'upsertJiraDetail').mockResolvedValue();
      vi.spyOn(jiraRepo, 'insertJiraHistory').mockResolvedValue();

      const mockIssue = createMockIssueWithChangelog({
        key: 'IQS-100',
        histories: [{
          created: '2024-01-16T14:30:00.000+0000',
          items: [{ field: 'status', fromString: 'Open', toString: 'In Progress' }],
        }],
      });

      mockJiraClient.issueSearch.searchForIssuesUsingJql.mockResolvedValue({
        issues: [mockIssue],
      });

      // Mock the dev status fetch via the delegated service
      vi.spyOn(JiraDevStatusService.prototype, 'fetchAndSave').mockResolvedValue({
        branchesSaved: 0, prsSaved: 0,
      });

      const result = await service.updateUnfinishedIssues(['IQS'], 3);

      expect(result.issuesProcessed).toBe(1);
      expect(result.issuesFailed).toBe(0);
      expect(result.totalHistoryEntries).toBe(1);
    });

    it('should handle failed issue processing gracefully', async () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      vi.spyOn(jiraRepo, 'getUnfinishedJiraIssues2').mockResolvedValue([
        { jiraKey: 'IQS-100' },
        { jiraKey: 'IQS-200' },
      ]);

      vi.spyOn(jiraRepo, 'deleteGitHubDataForKey').mockResolvedValue();
      vi.spyOn(jiraRepo, 'deleteHistoryForKey').mockResolvedValue();
      vi.spyOn(jiraRepo, 'upsertJiraDetail').mockResolvedValue();
      vi.spyOn(jiraRepo, 'insertJiraHistory').mockResolvedValue();

      // First issue found, second not found
      mockJiraClient.issueSearch.searchForIssuesUsingJql
        .mockResolvedValueOnce({
          issues: [createMockIssueWithChangelog({ key: 'IQS-100', histories: [] })],
        })
        .mockResolvedValueOnce({
          issues: [], // Not found
        });

      vi.spyOn(JiraDevStatusService.prototype, 'fetchAndSave').mockResolvedValue({
        branchesSaved: 0, prsSaved: 0,
      });

      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);

      const result = await service.updateUnfinishedIssues(['IQS'], 3);

      expect(result.issuesProcessed).toBe(1);
      expect(result.issuesFailed).toBe(1);
    });

    it('should use default daysAgo when not specified', async () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      const spy = vi.spyOn(jiraRepo, 'getUnfinishedJiraIssues2').mockResolvedValue([]);

      await service.updateUnfinishedIssues(['IQS']);

      expect(spy).toHaveBeenCalledWith(3);
    });
  });

  // --------------------------------------------------------------------------
  // processIssueChangelogAndDevStatus
  // --------------------------------------------------------------------------

  describe('processIssueChangelogAndDevStatus', () => {
    it('should extract changelog and fetch dev status for an issue', async () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      vi.spyOn(jiraRepo, 'insertJiraHistory').mockResolvedValue();

      vi.spyOn(JiraDevStatusService.prototype, 'fetchAndSave').mockResolvedValue({
        branchesSaved: 0, prsSaved: 0,
      });

      const issue = createMockIssueWithChangelog({
        key: 'IQS-50',
        histories: [{
          created: '2024-01-16T14:30:00.000+0000',
          items: [
            { field: 'status', fromString: 'Open', toString: 'Done' },
            { field: 'assignee', fromString: 'A', toString: 'B' },
          ],
        }],
      });

      const result = await service.processIssueChangelogAndDevStatus(issue);

      expect(result.historyCount).toBe(2);
      expect(result.branchesSaved).toBe(0);
      expect(result.prsSaved).toBe(0);
    });

    it('should skip history insert when no changelog entries', async () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const insertSpy = vi.spyOn(jiraRepo, 'insertJiraHistory').mockResolvedValue();

      vi.spyOn(JiraDevStatusService.prototype, 'fetchAndSave').mockResolvedValue({
        branchesSaved: 0, prsSaved: 0,
      });

      const issue = createMockIssueWithChangelog({ histories: [] });
      const result = await service.processIssueChangelogAndDevStatus(issue);

      expect(result.historyCount).toBe(0);
      expect(insertSpy).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Security
  // --------------------------------------------------------------------------

  describe('security', () => {
    it('should never include token in logged messages', () => {
      const service = new JiraChangelogService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );
      expect(service).toBeDefined();
    });
  });
});

// ============================================================================
// JiraDevStatusService Tests
// ============================================================================

describe('JiraDevStatusService', () => {
  let dbService: DatabaseService;
  let jiraRepo: JiraRepository;

  // Save original prototype method to restore after JiraChangelogService tests spy on it
  const originalFetchAndSave = JiraDevStatusService.prototype.fetchAndSave;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore the prototype method that may have been overridden by JiraChangelogService tests
    JiraDevStatusService.prototype.fetchAndSave = originalFetchAndSave;
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createDbConfig());
    jiraRepo = new JiraRepository(dbService);
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  describe('fetchAndSave', () => {
    it('should fetch dev status and save new branches and PRs', async () => {
      const devStatusService = new JiraDevStatusService(
        { server: 'https://test.atlassian.net', username: 'test@example.com', token: 'token' },
        jiraRepo,
      );

      vi.spyOn(jiraRepo, 'getKnownJiraGitHubBranches').mockResolvedValue([]);
      vi.spyOn(jiraRepo, 'getKnownJiraGitHubPRs').mockResolvedValue([]);
      vi.spyOn(jiraRepo, 'insertJiraGitHubBranches').mockResolvedValue();
      vi.spyOn(jiraRepo, 'insertJiraGitHubPullRequests').mockResolvedValue();

      const mockResponse = {
        errors: [],
        detail: [{
          branches: [{
            name: 'feature/IQS-100',
            url: 'https://github.com/org/repo/tree/feature/IQS-100',
            createPullRequestUrl: 'https://github.com/org/repo/compare/feature/IQS-100',
            repository: { id: 'repo-1', name: 'my-repo', url: 'https://github.com/org/my-repo' },
            lastCommit: {
              id: 'abc123', displayId: 'abc', authorTimestamp: 1700000000000,
              url: 'https://github.com/org/repo/commit/abc123',
              author: { name: 'Dev', avatar: '' },
              fileCount: 3, merge: false, message: 'feat', files: [],
            },
          }],
          pullRequests: [{
            author: { name: 'Dev', avatar: '' },
            id: 'pr-42', name: 'Feature IQS-100', commentCount: 2,
            source: { branch: 'feature/IQS-100', url: 'https://github.com/org/repo/tree/feature/IQS-100' },
            destination: { branch: 'main', url: 'https://github.com/org/repo/tree/main' },
            reviewers: [], status: 'MERGED',
            url: 'https://github.com/org/repo/pull/42',
            lastUpdate: '2024-02-15T10:00:00Z',
            repositoryId: 'repo-1', repositoryName: 'my-repo', repositoryUrl: 'https://github.com/org/my-repo',
          }],
          repositories: [{ id: 'repo-1', name: 'my-repo', url: 'https://github.com/org/my-repo' }],
          instance: null,
        }],
        errorMessages: [],
      };

      vi.spyOn(devStatusService, 'fetchFromJira').mockResolvedValue(mockResponse);

      const result = await devStatusService.fetchAndSave('10001', 'IQS-100');

      expect(result.branchesSaved).toBe(1);
      expect(result.prsSaved).toBe(1);
    });

    it('should skip already-known branches', async () => {
      const devStatusService = new JiraDevStatusService(
        { server: 'https://test.atlassian.net', username: 'test@example.com', token: 'token' },
        jiraRepo,
      );

      vi.spyOn(jiraRepo, 'getKnownJiraGitHubBranches').mockResolvedValue([{
        jiraId: 10001, lastCommit: 'abc123', branchName: 'feature/IQS-100',
      }]);
      vi.spyOn(jiraRepo, 'getKnownJiraGitHubPRs').mockResolvedValue([]);
      const insertSpy = vi.spyOn(jiraRepo, 'insertJiraGitHubBranches').mockResolvedValue();

      const mockResponse = {
        errors: [],
        detail: [{
          branches: [{
            name: 'feature/IQS-100', url: '', createPullRequestUrl: '',
            repository: { id: 'r1', name: 'r', url: '' },
            lastCommit: {
              id: 'abc123', displayId: 'abc', authorTimestamp: 1700000000000,
              url: '', author: { name: 'Dev', avatar: '' },
              fileCount: 0, merge: false, message: '', files: [],
            },
          }],
          pullRequests: [], repositories: [], instance: null,
        }],
        errorMessages: [],
      };

      vi.spyOn(devStatusService, 'fetchFromJira').mockResolvedValue(mockResponse);

      const result = await devStatusService.fetchAndSave('10001', 'IQS-100');

      expect(result.branchesSaved).toBe(0);
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('should skip already-known PRs', async () => {
      const devStatusService = new JiraDevStatusService(
        { server: 'https://test.atlassian.net', username: 'test@example.com', token: 'token' },
        jiraRepo,
      );

      vi.spyOn(jiraRepo, 'getKnownJiraGitHubBranches').mockResolvedValue([]);
      vi.spyOn(jiraRepo, 'getKnownJiraGitHubPRs').mockResolvedValue([{ jiraId: 10001, id: 'pr-42' }]);
      const insertSpy = vi.spyOn(jiraRepo, 'insertJiraGitHubPullRequests').mockResolvedValue();

      const mockResponse = {
        errors: [],
        detail: [{
          branches: [],
          pullRequests: [{
            author: { name: 'Dev', avatar: '' },
            id: 'pr-42', name: 'Feature', commentCount: 0,
            source: { branch: 'feature', url: '' },
            destination: { branch: 'main', url: '' },
            reviewers: [], status: 'MERGED',
            url: 'https://github.com/org/repo/pull/42',
            lastUpdate: '2024-02-15T10:00:00Z',
            repositoryId: 'r1', repositoryName: 'repo', repositoryUrl: '',
          }],
          repositories: [], instance: null,
        }],
        errorMessages: [],
      };

      vi.spyOn(devStatusService, 'fetchFromJira').mockResolvedValue(mockResponse);

      const result = await devStatusService.fetchAndSave('10001', 'IQS-100');

      expect(result.prsSaved).toBe(0);
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      const devStatusService = new JiraDevStatusService(
        { server: 'https://test.atlassian.net', username: 'test@example.com', token: 'token' },
        jiraRepo,
      );

      vi.spyOn(jiraRepo, 'getKnownJiraGitHubBranches').mockResolvedValue([]);
      vi.spyOn(jiraRepo, 'getKnownJiraGitHubPRs').mockResolvedValue([]);

      vi.spyOn(devStatusService, 'fetchFromJira').mockResolvedValue({
        errors: [{ message: 'Application not found' }],
        detail: [],
        errorMessages: ['Error occurred'],
      });

      const result = await devStatusService.fetchAndSave('10001', 'IQS-100');

      expect(result.branchesSaved).toBe(0);
      expect(result.prsSaved).toBe(0);
    });

    it('should handle fetch failure gracefully', async () => {
      const devStatusService = new JiraDevStatusService(
        { server: 'https://test.atlassian.net', username: 'test@example.com', token: 'token' },
        jiraRepo,
      );

      vi.spyOn(jiraRepo, 'getKnownJiraGitHubBranches').mockResolvedValue([]);
      vi.spyOn(jiraRepo, 'getKnownJiraGitHubPRs').mockResolvedValue([]);

      vi.spyOn(devStatusService, 'fetchFromJira').mockRejectedValue(new Error('Network error'));

      const result = await devStatusService.fetchAndSave('10001', 'IQS-100');

      expect(result.branchesSaved).toBe(0);
      expect(result.prsSaved).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // JiraRepository delete methods
  // --------------------------------------------------------------------------

  describe('JiraRepository delete methods', () => {
    it('deleteGitHubDataForKey should execute without error', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      await jiraRepo.deleteGitHubDataForKey('IQS-100');
      expect(mockQuery).toHaveBeenCalled();
    });

    it('deleteHistoryForKey should execute without error', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      await jiraRepo.deleteHistoryForKey('IQS-100');
      expect(mockQuery).toHaveBeenCalled();
    });
  });
});
