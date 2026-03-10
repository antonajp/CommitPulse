import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import {
  JiraRepository,
  type JiraDetailRow,
  type JiraHistoryRow,
  type JiraIssueLinkRow,
  type JiraParentRow,
  type JiraGitHubBranchRow,
  type JiraGitHubPullRequestRow,
} from '../../database/jira-repository.js';

/**
 * Unit tests for JiraRepository class.
 *
 * Tests all insert/upsert and query methods using a mocked DatabaseService.
 * Verifies parameterized SQL for all operations. No real database required.
 *
 * Ticket: IQS-853
 */

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

function createTestConfig(): DatabaseServiceConfig {
  return {
    host: 'localhost',
    port: 5433,
    database: 'gitrx_test',
    user: 'test_user',
    password: 'test_password',
  };
}

function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

function createSampleDetail(overrides?: Partial<JiraDetailRow>): JiraDetailRow {
  return {
    jiraId: '10001',
    jiraKey: 'IQS-100',
    priority: 'High',
    createdDate: new Date('2024-01-15T10:00:00Z'),
    url: 'https://jira.example.com/browse/IQS-100',
    summary: 'Test issue summary',
    description: 'Test description',
    reporter: 'reporter@example.com',
    issuetype: 'Story',
    project: 'IQS',
    resolution: null,
    assignee: 'dev@example.com',
    status: 'In Progress',
    fixversion: '1.0',
    component: 'Backend',
    statusChangeDate: new Date('2024-01-20T12:00:00Z'),
    points: 5,
    calculatedStoryPoints: null,
    ...overrides,
  };
}

describe('JiraRepository', () => {
  let dbService: DatabaseService;
  let repo: JiraRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createTestConfig());
    repo = new JiraRepository(dbService);
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // --------------------------------------------------------------------------
  // Insert / Upsert methods
  // --------------------------------------------------------------------------

  describe('upsertJiraDetail', () => {
    it('should upsert a Jira detail with parameterized SQL', async () => {
      const detail = createSampleDetail();
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await repo.upsertJiraDetail(detail);

      const upsertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO jira_detail'),
      );
      expect(upsertCall).toBeDefined();
      expect(upsertCall![1]).toEqual([
        detail.jiraId, detail.jiraKey, detail.priority, detail.createdDate,
        detail.url, detail.summary, detail.description, detail.reporter,
        detail.issuetype, detail.project, detail.resolution, detail.assignee,
        detail.status, detail.fixversion, detail.component,
        detail.statusChangeDate, detail.points,
      ]);
    });

    it('should use ON CONFLICT for update', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await repo.upsertJiraDetail(createSampleDetail());

      const upsertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('ON CONFLICT'),
      );
      expect(upsertCall).toBeDefined();
    });
  });

  describe('batchUpsertJiraDetails', () => {
    it('should batch upsert in a transaction', async () => {
      const callOrder: string[] = [];
      mockQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string') {
          callOrder.push(sql.trim().substring(0, 20));
        }
        return { rows: [], rowCount: 1 };
      });

      const details = [createSampleDetail(), createSampleDetail({ jiraKey: 'IQS-101' })];
      await repo.batchUpsertJiraDetails(details);

      expect(callOrder.some((s) => s.includes('BEGIN'))).toBe(true);
      expect(callOrder.some((s) => s.includes('COMMIT'))).toBe(true);
    });

    it('should skip when empty array', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.batchUpsertJiraDetails([]);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('replaceJiraHistory', () => {
    it('should delete and reinsert history in a transaction', async () => {
      const callOrder: string[] = [];
      mockQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string') {
          callOrder.push(sql.trim().substring(0, 30));
        }
        return { rows: [], rowCount: 1 };
      });

      const history: JiraHistoryRow[] = [{
        jiraKey: 'IQS-100',
        changeDate: new Date('2024-01-20T12:00:00Z'),
        assignee: 'dev@example.com',
        field: 'status',
        fromValue: 'Open',
        toValue: 'In Progress',
      }];

      await repo.replaceJiraHistory('IQS-100', history);

      expect(callOrder.some((s) => s.includes('BEGIN'))).toBe(true);
      expect(callOrder.some((s) => s.includes('DELETE FROM jira_history'))).toBe(true);
      expect(callOrder.some((s) => s.includes('INSERT INTO jira_history'))).toBe(true);
      expect(callOrder.some((s) => s.includes('COMMIT'))).toBe(true);
    });

    it('should pass jiraKey as parameterized delete value', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      await repo.replaceJiraHistory('IQS-200', []);

      const deleteCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM jira_history'),
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![1]).toEqual(['IQS-200']);
    });
  });

  describe('insertJiraHistory', () => {
    it('should batch insert history rows', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const history: JiraHistoryRow[] = [
        { jiraKey: 'IQS-100', changeDate: new Date(), assignee: 'dev', field: 'status', fromValue: 'Open', toValue: 'Done' },
        { jiraKey: 'IQS-100', changeDate: new Date(), assignee: 'dev', field: 'assignee', fromValue: null, toValue: 'dev' },
      ];

      await repo.insertJiraHistory(history);

      const insertCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO jira_history'),
      );
      expect(insertCalls.length).toBe(2);
    });

    it('should skip when empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.insertJiraHistory([]);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('replaceJiraIssueLinks', () => {
    it('should delete and reinsert links in a transaction', async () => {
      const callOrder: string[] = [];
      mockQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string') {
          callOrder.push(sql.trim().substring(0, 30));
        }
        return { rows: [], rowCount: 1 };
      });

      const links: JiraIssueLinkRow[] = [{
        jiraKey: 'IQS-100',
        linkType: 'blocks',
        linkKey: 'IQS-200',
        linkStatus: 'Open',
        linkPriority: 'High',
        issueType: 'Bug',
      }];

      await repo.replaceJiraIssueLinks('IQS-100', links);

      expect(callOrder.some((s) => s.includes('DELETE FROM jira_issue_link'))).toBe(true);
      expect(callOrder.some((s) => s.includes('INSERT INTO jira_issue_link'))).toBe(true);
    });
  });

  describe('insertJiraParents', () => {
    it('should batch insert parent rows', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const parents: JiraParentRow[] = [
        { jiraKey: 'IQS-101', parentKey: 'IQS-100', parentSummary: 'Parent story', parentType: 'Story' },
      ];

      await repo.insertJiraParents(parents);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO jira_parent'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toEqual(['IQS-101', 'IQS-100', 'Parent story', 'Story']);
    });

    it('should skip when empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.insertJiraParents([]);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('insertJiraGitHubBranches', () => {
    it('should batch insert GitHub branches', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const branches: JiraGitHubBranchRow[] = [{
        jiraId: 10001,
        jiraKey: 'IQS-100',
        branchName: 'feature/IQS-100',
        displayId: 'IQS-100',
        lastCommit: 'abc123',
        authorDate: new Date(),
        author: 'developer',
        branchUrl: 'https://github.com/org/repo/tree/feature/IQS-100',
        pullUrl: null,
        commitUrl: 'https://github.com/org/repo/commit/abc123',
      }];

      await repo.insertJiraGitHubBranches(branches);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO jira_github_branch'),
      );
      expect(insertCall).toBeDefined();
    });

    it('should skip when empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.insertJiraGitHubBranches([]);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('insertJiraGitHubPullRequests', () => {
    it('should batch insert GitHub PRs', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const prs: JiraGitHubPullRequestRow[] = [{
        jiraId: 10001,
        jiraKey: 'IQS-100',
        id: 'pr-42',
        name: 'Feature IQS-100',
        sourceBranch: 'feature/IQS-100',
        sourceUrl: 'https://github.com/org/repo/tree/feature/IQS-100',
        destinationBranch: 'main',
        destinationUrl: 'https://github.com/org/repo/tree/main',
        pullStatus: 'merged',
        url: 'https://github.com/org/repo/pull/42',
        lastUpdate: new Date(),
      }];

      await repo.insertJiraGitHubPullRequests(prs);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO jira_github_pullrequest'),
      );
      expect(insertCall).toBeDefined();
    });

    it('should skip when empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.insertJiraGitHubPullRequests([]);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  // --------------------------------------------------------------------------
  // Query methods
  // --------------------------------------------------------------------------

  describe('getDistinctJiraKeysFromDetails', () => {
    it('should return set of Jira keys from jira_detail', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ jira_key: 'IQS-100' }, { jira_key: 'IQS-200' }, { jira_key: 'PROJ-50' }],
        rowCount: 3,
      });

      const result = await repo.getDistinctJiraKeysFromDetails();

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(3);
      expect(result.has('IQS-100')).toBe(true);
      expect(result.has('PROJ-50')).toBe(true);
    });

    it('should return empty set when no keys exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await repo.getDistinctJiraKeysFromDetails();
      expect(result.size).toBe(0);
    });
  });

  describe('getDistinctJiraProjectRefs', () => {
    it('should return projects from DB plus additional projects', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ project: 'IQS' }, { project: 'PROJ' }],
        rowCount: 2,
      });

      const result = await repo.getDistinctJiraProjectRefs(['PROJ', 'CRM']);

      // Set deduplicates: IQS (from DB), PROJ (from DB & additional), CRM (from additional) = 3 unique
      expect(result.size).toBe(3);
      expect(result.has('IQS')).toBe(true);
      expect(result.has('PROJ')).toBe(true);
      expect(result.has('CRM')).toBe(true);
    });

    it('should work without additional projects', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ project: 'IQS' }],
        rowCount: 1,
      });

      const result = await repo.getDistinctJiraProjectRefs();
      expect(result.size).toBe(1);
    });
  });

  describe('identifyJiraProjMaxIssue', () => {
    it('should return project-to-max-issue mapping', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { jira_key: 'IQS', count: 853 },
          { jira_key: 'PROJ', count: 250 },
        ],
        rowCount: 2,
      });

      const result = await repo.identifyJiraProjMaxIssue();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ jiraKey: 'IQS', count: 853 });
      expect(result[1]).toEqual({ jiraKey: 'PROJ', count: 250 });
    });
  });

  describe('getUnfinishedJiraIssues', () => {
    it('should return unfinished issues from view', async () => {
      const changeDate = new Date('2024-03-01T10:00:00Z');
      mockQuery.mockResolvedValueOnce({
        rows: [{ jira_key: 'IQS-100', change_date: changeDate }],
        rowCount: 1,
      });

      const result = await repo.getUnfinishedJiraIssues();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ jiraKey: 'IQS-100', changeDate });
    });
  });

  describe('getUnfinishedJiraIssues2', () => {
    it('should pass daysAgo as parameterized value', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ jira_key: 'IQS-100' }],
        rowCount: 1,
      });

      const result = await repo.getUnfinishedJiraIssues2(5);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ jiraKey: 'IQS-100' });

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('CURRENT_DATE'),
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual([5]);
    });

    it('should default daysAgo to 2', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getUnfinishedJiraIssues2();

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('CURRENT_DATE'),
      );
      expect(selectCall![1]).toEqual([2]);
    });
  });

  describe('getKnownJiraGitHubBranches', () => {
    it('should return known branch records', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { jira_id: 10001, last_commit: 'abc123', branch_name: 'feature/IQS-100' },
          { jira_id: 10002, last_commit: 'def456', branch_name: 'feature/IQS-200' },
        ],
        rowCount: 2,
      });

      const result = await repo.getKnownJiraGitHubBranches();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ jiraId: 10001, lastCommit: 'abc123', branchName: 'feature/IQS-100' });
    });
  });

  describe('getKnownJiraGitHubPRs', () => {
    it('should return known PR records', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { jira_id: 10001, id: 'pr-42' },
          { jira_id: 10002, id: 'pr-43' },
        ],
        rowCount: 2,
      });

      const result = await repo.getKnownJiraGitHubPRs();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ jiraId: 10001, id: 'pr-42' });
    });

    it('should return empty array when no PRs exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await repo.getKnownJiraGitHubPRs();
      expect(result).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // SQL injection prevention
  // --------------------------------------------------------------------------

  describe('SQL injection prevention', () => {
    it('should never interpolate jiraKey into upsert SQL', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const malicious = createSampleDetail({ jiraKey: "'; DROP TABLE jira_detail; --" });
      await repo.upsertJiraDetail(malicious);

      const upsertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO jira_detail'),
      );
      expect(upsertCall).toBeDefined();
      expect((upsertCall![0] as string)).not.toContain('DROP TABLE');
      expect(upsertCall![1][1]).toBe("'; DROP TABLE jira_detail; --");
    });

    it('should never interpolate daysAgo into SQL', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await repo.getUnfinishedJiraIssues2(999);

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('CURRENT_DATE'),
      );
      expect(selectCall).toBeDefined();
      expect((selectCall![0] as string)).not.toContain('999');
      expect(selectCall![1]).toEqual([999]);
    });
  });
});
