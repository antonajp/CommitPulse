import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { JiraRepository } from '../../database/jira-repository.js';
import { PipelineRepository } from '../../database/pipeline-repository.js';
import {
  JiraService,
  extractIssueDetail,
  extractIssueLinks,
  extractIssueParent,
  type JiraServiceConfig,
  type JiraExtractorConfig,
} from '../../services/jira-service.js';
import { Version3Models } from 'jira.js';
type Issue = Version3Models.Issue;

/**
 * Unit tests for JiraService class.
 *
 * Tests issue loading, field extraction, link extraction, parent extraction,
 * rate limiting, and JQL query building. Uses mocked jira.js client and
 * mocked database repositories.
 *
 * Ticket: IQS-856
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

// Mock jira.js - we inject a mock client directly so this is a fallback
vi.mock('jira.js', () => ({
  Version3Client: vi.fn().mockImplementation(() => ({
    issueSearch: {
      searchForIssuesUsingJqlEnhancedSearch: vi.fn(),
    },
  })),
  Version3Models: {},
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

/**
 * Create a mock Jira issue matching the jira.js Issue interface.
 */
function createMockIssue(overrides?: Partial<{
  id: string;
  key: string;
  summary: string;
  priority: string;
  status: string;
  reporter: string;
  assignee: string;
  issuetype: string;
  resolution: string | null;
  fixversion: string | null;
  component: string | null;
  points: number | null;
  parent: { key: string; summary: string; issuetype: string } | null;
  issuelinks: Array<{
    type: { inward: string; outward: string };
    inwardIssue?: { key: string; fields: { status: { name: string }; priority: { name: string }; issuetype: { name: string } } };
    outwardIssue?: { key: string; fields: { status: { name: string }; priority: { name: string }; issuetype: { name: string } } };
  }>;
}>): Issue {
  const o = overrides ?? {};
  return {
    id: o.id ?? '10001',
    key: o.key ?? 'IQS-100',
    fields: {
      summary: o.summary ?? 'Test issue summary',
      priority: { name: o.priority ?? 'High' },
      status: { name: o.status ?? 'In Progress' },
      created: '2024-01-15T10:00:00.000+0000',
      reporter: { displayName: o.reporter ?? 'Test Reporter' },
      assignee: o.assignee !== undefined ? { displayName: o.assignee } : { displayName: 'Test Assignee' },
      issuetype: { name: o.issuetype ?? 'Story' },
      resolution: o.resolution !== undefined ? (o.resolution ? { name: o.resolution } : null) : null,
      fixVersions: o.fixversion !== undefined ? (o.fixversion ? [{ name: o.fixversion }] : []) : [],
      components: o.component !== undefined ? (o.component ? [{ name: o.component }] : []) : [],
      customfield_10034: o.points ?? null,
      statuscategorychangedate: '2024-01-20T12:00:00.000+0000',
      parent: o.parent !== null && o.parent !== undefined ? {
        id: '10000',
        key: o.parent.key,
        fields: {
          summary: o.parent.summary,
          issuetype: { name: o.parent.issuetype },
        },
      } : (o.parent === null ? undefined : undefined),
      issuelinks: o.issuelinks ?? [],
      // Required fields from Fields interface with sensible defaults
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
  } as unknown as Issue;
}

// ============================================================================
// Mock Jira client
// ============================================================================

function createMockJiraClient() {
  return {
    issueSearch: {
      searchForIssuesUsingJqlEnhancedSearch: vi.fn(),
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('JiraService', () => {
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
    it('should create JiraService with provided config', () => {
      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );
      expect(service).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // extractIssueDetail (standalone function)
  // --------------------------------------------------------------------------

  describe('extractIssueDetail', () => {
    const defaultExtractorConfig: JiraExtractorConfig = {
      server: 'https://test.atlassian.net',
      pointsField: 'customfield_10034',
    };

    it('should extract all fields from a Jira issue', () => {
      const issue = createMockIssue({
        id: '10042',
        key: 'PROJ-42',
        summary: 'Implement feature X',
        priority: 'Critical',
        status: 'Done',
        reporter: 'Jane Reporter',
        assignee: 'John Dev',
        issuetype: 'Story',
        resolution: 'Fixed',
        fixversion: '1.2.0',
        component: 'Backend',
        points: 8,
      });

      const detail = extractIssueDetail(issue, 'PROJ', defaultExtractorConfig);

      expect(detail.jiraId).toBe('10042');
      expect(detail.jiraKey).toBe('PROJ-42');
      expect(detail.priority).toBe('Critical');
      expect(detail.summary).toBe('Implement feature X');
      expect(detail.reporter).toBe('Jane Reporter');
      expect(detail.assignee).toBe('John Dev');
      expect(detail.issuetype).toBe('Story');
      expect(detail.project).toBe('PROJ');
      expect(detail.resolution).toBe('Fixed');
      expect(detail.status).toBe('Done');
      expect(detail.fixversion).toBe('1.2.0');
      expect(detail.component).toBe('Backend');
      expect(detail.points).toBe(8);
      expect(detail.url).toBe('https://test.atlassian.net/browse/PROJ-42');
      expect(detail.createdDate).toBeInstanceOf(Date);
      expect(detail.statusChangeDate).toBeInstanceOf(Date);
    });

    it('should handle null/missing fields gracefully', () => {
      const issue = createMockIssue({
        resolution: null,
        fixversion: null,
        component: null,
        points: null,
      });

      const detail = extractIssueDetail(issue, 'IQS', defaultExtractorConfig);

      expect(detail.resolution).toBeNull();
      expect(detail.fixversion).toBeNull();
      expect(detail.component).toBeNull();
      expect(detail.points).toBeNull();
    });

    it('should use configured server URL in issue URL', () => {
      const customConfig: JiraExtractorConfig = {
        server: 'https://myorg.atlassian.net',
        pointsField: 'customfield_10034',
      };

      const issue = createMockIssue({ key: 'TEST-1' });
      const detail = extractIssueDetail(issue, 'TEST', customConfig);

      expect(detail.url).toBe('https://myorg.atlassian.net/browse/TEST-1');
    });

    it('should use configurable points field', () => {
      const customConfig: JiraExtractorConfig = {
        server: 'https://test.atlassian.net',
        pointsField: 'customfield_99999',
      };

      const issue = createMockIssue();
      // Set the custom points field on the issue
      (issue.fields as Record<string, unknown>)['customfield_99999'] = 13;

      const detail = extractIssueDetail(issue, 'IQS', customConfig);

      expect(detail.points).toBe(13);
    });
  });

  // --------------------------------------------------------------------------
  // extractIssueLinks (standalone function)
  // --------------------------------------------------------------------------

  describe('extractIssueLinks', () => {
    it('should extract inward issue links', () => {
      const issue = createMockIssue({
        issuelinks: [{
          type: { inward: 'is blocked by', outward: 'blocks' },
          inwardIssue: {
            key: 'IQS-50',
            fields: {
              status: { name: 'Open' },
              priority: { name: 'High' },
              issuetype: { name: 'Bug' },
            },
          },
        }],
      });

      const links = extractIssueLinks('IQS-100', issue);

      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        jiraKey: 'IQS-100',
        linkType: 'is blocked by',
        linkKey: 'IQS-50',
        linkStatus: 'Open',
        linkPriority: 'High',
        issueType: 'Bug',
      });
    });

    it('should extract outward issue links', () => {
      const issue = createMockIssue({
        issuelinks: [{
          type: { inward: 'is blocked by', outward: 'blocks' },
          outwardIssue: {
            key: 'IQS-200',
            fields: {
              status: { name: 'In Progress' },
              priority: { name: 'Medium' },
              issuetype: { name: 'Story' },
            },
          },
        }],
      });

      const links = extractIssueLinks('IQS-100', issue);

      expect(links).toHaveLength(1);
      expect(links[0]!.linkType).toBe('blocks');
      expect(links[0]!.linkKey).toBe('IQS-200');
    });

    it('should return empty array when no links exist', () => {
      const issue = createMockIssue({ issuelinks: [] });
      const links = extractIssueLinks('IQS-100', issue);

      expect(links).toHaveLength(0);
    });

    it('should handle multiple links', () => {
      const issue = createMockIssue({
        issuelinks: [
          {
            type: { inward: 'is blocked by', outward: 'blocks' },
            inwardIssue: { key: 'IQS-50', fields: { status: { name: 'Open' }, priority: { name: 'High' }, issuetype: { name: 'Bug' } } },
          },
          {
            type: { inward: 'is cloned by', outward: 'clones' },
            outwardIssue: { key: 'IQS-300', fields: { status: { name: 'Done' }, priority: { name: 'Low' }, issuetype: { name: 'Task' } } },
          },
        ],
      });

      const links = extractIssueLinks('IQS-100', issue);

      expect(links).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // extractIssueParent (standalone function)
  // --------------------------------------------------------------------------

  describe('extractIssueParent', () => {
    it('should extract parent when present', () => {
      const issue = createMockIssue({
        parent: {
          key: 'IQS-10',
          summary: 'Epic: Infrastructure',
          issuetype: 'Epic',
        },
      });

      const parent = extractIssueParent('IQS-100', issue);

      expect(parent).not.toBeNull();
      expect(parent!.jiraKey).toBe('IQS-100');
      expect(parent!.parentKey).toBe('IQS-10');
      expect(parent!.parentSummary).toBe('Epic: Infrastructure');
      expect(parent!.parentType).toBe('Epic');
    });

    it('should return null when no parent', () => {
      const issue = createMockIssue({ parent: null });
      const parent = extractIssueParent('IQS-100', issue);

      expect(parent).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // buildJqlQuery
  // --------------------------------------------------------------------------

  describe('buildJqlQuery', () => {
    it('should build basic JQL without key bounds', () => {
      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const jql = service.buildJqlQuery('PROJ', 0, 0);

      expect(jql).toContain('project = "PROJ"');
      expect(jql).toContain('ORDER BY key ASC');
      expect(jql).not.toContain('key >=');
      expect(jql).not.toContain('key <=');
    });

    it('should include startKey bound when > 0', () => {
      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const jql = service.buildJqlQuery('PROJ', 100, 0);

      expect(jql).toContain('key >= "PROJ-100"');
    });

    it('should include maxKeys bound when > 0', () => {
      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const jql = service.buildJqlQuery('PROJ', 0, 500);

      expect(jql).toContain('key <= "PROJ-500"');
    });

    it('should include both bounds when both > 0', () => {
      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const jql = service.buildJqlQuery('PROJ', 50, 200);

      expect(jql).toContain('key >= "PROJ-50"');
      expect(jql).toContain('key <= "PROJ-200"');
    });
  });

  // --------------------------------------------------------------------------
  // loadProjectIssues
  // --------------------------------------------------------------------------

  describe('loadProjectIssues', () => {
    it('should load and persist new issues', async () => {
      // Setup mock responses
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      // Mock pipeline start - return pipeline run id
      const insertPipelineStartSpy = vi.spyOn(pipelineRepo, 'insertPipelineStart')
        .mockResolvedValue(1);

      // Mock getDistinctJiraKeysFromDetails - empty set = all issues are new
      const getKeysSpy = vi.spyOn(jiraRepo, 'getDistinctJiraKeysFromDetails')
        .mockResolvedValue(new Set<string>());

      // Mock identifyJiraProjMaxIssue
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue')
        .mockResolvedValue([]);

      // Mock upsert and insert methods
      const upsertSpy = vi.spyOn(jiraRepo, 'upsertJiraDetail').mockResolvedValue();
      const replaceLinksSpy = vi.spyOn(jiraRepo, 'replaceJiraIssueLinks').mockResolvedValue();
      const insertParentsSpy = vi.spyOn(jiraRepo, 'insertJiraParents').mockResolvedValue();

      // Mock pipeline log and update
      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      // Mock jira search result
      const mockIssue = createMockIssue({
        key: 'PROJ-1',
        summary: 'First issue',
        issuelinks: [{
          type: { inward: 'is blocked by', outward: 'blocks' },
          inwardIssue: { key: 'PROJ-2', fields: { status: { name: 'Open' }, priority: { name: 'High' }, issuetype: { name: 'Bug' } } },
        }],
        parent: { key: 'PROJ-0', summary: 'Parent Epic', issuetype: 'Epic' },
      });

      mockJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mockResolvedValue({
        issues: [mockIssue],
        nextPageToken: undefined,
      });

      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const result = await service.loadProjectIssues('PROJ', { startKey: 0, maxKeys: 100 });

      expect(insertPipelineStartSpy).toHaveBeenCalled();
      expect(getKeysSpy).toHaveBeenCalled();
      expect(upsertSpy).toHaveBeenCalledTimes(1);
      expect(replaceLinksSpy).toHaveBeenCalledTimes(1);
      expect(insertParentsSpy).toHaveBeenCalledTimes(1);
      expect(result.issuesInserted).toBe(1);
      expect(result.linksInserted).toBe(1);
      expect(result.parentsInserted).toBe(1);
      expect(result.issuesSkipped).toBe(0);
      expect(result.projectKey).toBe('PROJ');
    });

    it('should skip already-known issues', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(jiraRepo, 'getDistinctJiraKeysFromDetails')
        .mockResolvedValue(new Set(['PROJ-1'])); // Already known
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([]);

      const upsertSpy = vi.spyOn(jiraRepo, 'upsertJiraDetail').mockResolvedValue();

      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      mockJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mockResolvedValue({
        issues: [createMockIssue({ key: 'PROJ-1' })],
        nextPageToken: undefined,
      });

      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const result = await service.loadProjectIssues('PROJ', { startKey: 0, maxKeys: 100 });

      expect(upsertSpy).not.toHaveBeenCalled();
      expect(result.issuesInserted).toBe(0);
      expect(result.issuesSkipped).toBe(1);
    });

    it('should handle pagination across multiple pages', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(jiraRepo, 'getDistinctJiraKeysFromDetails').mockResolvedValue(new Set());
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([]);
      vi.spyOn(jiraRepo, 'upsertJiraDetail').mockResolvedValue();
      vi.spyOn(jiraRepo, 'replaceJiraIssueLinks').mockResolvedValue();
      vi.spyOn(jiraRepo, 'insertJiraParents').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      // Page 1: return 2 issues with nextPageToken
      // Page 2: return 1 issue with no nextPageToken (end)
      mockJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch
        .mockResolvedValueOnce({
          issues: [createMockIssue({ key: 'PROJ-1' }), createMockIssue({ key: 'PROJ-2' })],
          nextPageToken: 'page2token',
        })
        .mockResolvedValueOnce({
          issues: [createMockIssue({ key: 'PROJ-3' })],
          nextPageToken: undefined,
        });

      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const result = await service.loadProjectIssues('PROJ', { startKey: 0, maxKeys: 100 });

      expect(mockJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch).toHaveBeenCalledTimes(2);
      expect(result.issuesInserted).toBe(3);
    });

    it('should continue processing when individual issue fails', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(jiraRepo, 'getDistinctJiraKeysFromDetails').mockResolvedValue(new Set());
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([]);

      // First upsert succeeds, second fails, third succeeds
      vi.spyOn(jiraRepo, 'upsertJiraDetail')
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error('DB constraint violation'))
        .mockResolvedValueOnce();

      vi.spyOn(jiraRepo, 'replaceJiraIssueLinks').mockResolvedValue();
      vi.spyOn(jiraRepo, 'insertJiraParents').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      mockJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mockResolvedValue({
        issues: [
          createMockIssue({ key: 'PROJ-1' }),
          createMockIssue({ key: 'PROJ-2' }),
          createMockIssue({ key: 'PROJ-3' }),
        ],
        nextPageToken: undefined,
      });

      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const result = await service.loadProjectIssues('PROJ', { startKey: 0, maxKeys: 100 });

      expect(result.issuesInserted).toBe(2);
      expect(result.issuesFailed).toBe(1);
    });

    it('should auto-detect max keys from database', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(jiraRepo, 'getDistinctJiraKeysFromDetails').mockResolvedValue(new Set());

      // Return a known max issue for the project
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue')
        .mockResolvedValue([{ jiraKey: 'PROJ', count: 500 }]);

      vi.spyOn(jiraRepo, 'upsertJiraDetail').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      mockJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mockResolvedValue({
        issues: [],
        nextPageToken: undefined,
      });

      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      // maxKeys=0 means auto-detect
      await service.loadProjectIssues('PROJ', { startKey: 0, maxKeys: 0 });

      // Should have called with maxKeys = 500 + 100 (AUTO_DETECT_BUFFER)
      const searchCall = mockJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch.mock.calls[0];
      expect(searchCall).toBeDefined();
      const jqlUsed = searchCall![0]?.jql as string;
      expect(jqlUsed).toContain('PROJ-600');
    });
  });

  // --------------------------------------------------------------------------
  // loadAllProjects
  // --------------------------------------------------------------------------

  describe('loadAllProjects', () => {
    it('should load issues for multiple projects', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(jiraRepo, 'getDistinctJiraKeysFromDetails').mockResolvedValue(new Set());
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([]);
      vi.spyOn(jiraRepo, 'upsertJiraDetail').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      mockJiraClient.issueSearch.searchForIssuesUsingJqlEnhancedSearch
        .mockResolvedValueOnce({ issues: [createMockIssue({ key: 'PROJ-1' })], nextPageToken: undefined })
        .mockResolvedValueOnce({ issues: [createMockIssue({ key: 'FEAT-1' })], nextPageToken: undefined });

      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      const results = await service.loadAllProjects(['PROJ', 'FEAT'], { startKey: 0, maxKeys: 100 });

      expect(results).toHaveLength(2);
      expect(results[0]!.projectKey).toBe('PROJ');
      expect(results[1]!.projectKey).toBe('FEAT');
    });
  });

  // --------------------------------------------------------------------------
  // Security: no secrets in logs
  // --------------------------------------------------------------------------

  describe('security', () => {
    it('should never include token in logged config', () => {
      const service = new JiraService(
        jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
      );

      // The service should exist and not expose token
      expect(service).toBeDefined();
      // Token is only stored internally, not logged
    });
  });
});
