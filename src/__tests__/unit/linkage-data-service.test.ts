import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { LinkageDataService } from '../../services/linkage-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for LinkageDataService (IQS-870).
 * Tests data queries for the Commit-Jira Linkage webview.
 */
describe('LinkageDataService', () => {
  let mockDb: DatabaseService;
  let service: LinkageDataService;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Create mock DatabaseService
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockResolvedValue(true),
    } as unknown as DatabaseService;

    service = new LinkageDataService(mockDb);
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================
  describe('constructor', () => {
    it('should create a LinkageDataService instance', () => {
      expect(service).toBeDefined();
    });
  });

  // ==========================================================================
  // getLinkageSummary
  // ==========================================================================
  describe('getLinkageSummary', () => {
    it('should return zero summary when no data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ total_commits: 0, linked_commits: 0, unlinked_commits: 0 }],
        rowCount: 1,
      });

      const result = await service.getLinkageSummary();

      expect(result).toEqual({
        totalCommits: 0,
        linkedCommits: 0,
        unlinkedCommits: 0,
        linkedPercent: 0,
        unlinkedPercent: 0,
      });
    });

    it('should return correct percentages', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ total_commits: 100, linked_commits: 75, unlinked_commits: 25 }],
        rowCount: 1,
      });

      const result = await service.getLinkageSummary();

      expect(result.totalCommits).toBe(100);
      expect(result.linkedCommits).toBe(75);
      expect(result.unlinkedCommits).toBe(25);
      expect(result.linkedPercent).toBe(75);
      expect(result.unlinkedPercent).toBe(25);
    });

    it('should pass date range filters as parameterized values', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ total_commits: 50, linked_commits: 30, unlinked_commits: 20 }],
        rowCount: 1,
      });

      await service.getLinkageSummary({
        startDate: '2025-01-01',
        endDate: '2025-06-30',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(params).toEqual(['2025-01-01', '2025-06-30']);
    });

    it('should pass repository filter as parameterized value', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ total_commits: 10, linked_commits: 8, unlinked_commits: 2 }],
        rowCount: 1,
      });

      await service.getLinkageSummary({ repository: 'my-app' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain('my-app');
    });

    it('should return zero summary when no rows returned', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.getLinkageSummary();
      expect(result.totalCommits).toBe(0);
      expect(result.linkedPercent).toBe(0);
    });

    it('should use is_linear_ref when trackerType is linear (IQS-876)', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ total_commits: 100, linked_commits: 40, unlinked_commits: 60 }],
        rowCount: 1,
      });

      await service.getLinkageSummary({ trackerType: 'linear' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('ch.is_linear_ref');
      expect(sql).not.toContain('ch.is_jira_ref');
    });

    it('should default to is_jira_ref when trackerType is not set (IQS-876)', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ total_commits: 100, linked_commits: 75, unlinked_commits: 25 }],
        rowCount: 1,
      });

      await service.getLinkageSummary();

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('ch.is_jira_ref');
      expect(sql).not.toContain('ch.is_linear_ref');
    });
  });

  // ==========================================================================
  // getJiraProjectDistribution
  // ==========================================================================
  describe('getJiraProjectDistribution', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getJiraProjectDistribution();
      expect(result).toEqual([]);
    });

    it('should return mapped project distribution entries', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { jira_project: 'PROJ', commit_count: 120 },
          { jira_project: 'FEAT', commit_count: 45 },
        ],
        rowCount: 2,
      });

      const result = await service.getJiraProjectDistribution();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ jiraProject: 'PROJ', commitCount: 120 });
      expect(result[1]).toEqual({ jiraProject: 'FEAT', commitCount: 45 });
    });

    it('should apply Jira project filter as parameterized value', async () => {
      await service.getJiraProjectDistribution({ jiraProject: 'PROJ' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).toContain('cj.jira_project = $');
      expect(params).toContain('PROJ');
    });

    it('should query commit_linear table when trackerType is linear (IQS-876)', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ jira_project: 'IQS', commit_count: 30 }],
        rowCount: 1,
      });

      await service.getJiraProjectDistribution({ trackerType: 'linear' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('FROM commit_linear cj');
      expect(sql).toContain('cj.linear_project');
    });

    it('should query commit_jira table when trackerType is not set (IQS-876)', async () => {
      await service.getJiraProjectDistribution();

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('FROM commit_jira cj');
      expect(sql).toContain('cj.jira_project');
    });
  });

  // ==========================================================================
  // getJiraStatusFlow
  // ==========================================================================
  describe('getJiraStatusFlow', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getJiraStatusFlow();
      expect(result).toEqual([]);
    });

    it('should return mapped status flow data points', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { change_date: new Date('2025-03-01'), to_status: 'In Development', issue_count: 5 },
          { change_date: new Date('2025-03-01'), to_status: 'In QA', issue_count: 3 },
        ],
        rowCount: 2,
      });

      const result = await service.getJiraStatusFlow();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        changeDate: '2025-03-01',
        toStatus: 'In Development',
        issueCount: 5,
      });
    });

    it('should filter by status field', async () => {
      await service.getJiraStatusFlow();

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain("field = 'status'");
    });

    it('should apply date range and Jira project filters', async () => {
      await service.getJiraStatusFlow({
        startDate: '2025-01-01',
        jiraProject: 'PROJ',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain('2025-01-01');
      expect(params).toContain('PROJ');
    });
  });

  // ==========================================================================
  // getAssignmentHistory
  // ==========================================================================
  describe('getAssignmentHistory', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getAssignmentHistory();
      expect(result).toEqual([]);
    });

    it('should return mapped assignment history entries', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            jira_key: 'PROJ-123',
            change_date: new Date('2025-03-01'),
            assigned_to: 'jane.doe',
            assigned_from: 'john.smith',
          },
        ],
        rowCount: 1,
      });

      const result = await service.getAssignmentHistory();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        jiraKey: 'PROJ-123',
        changeDate: '2025-03-01',
        assignedTo: 'jane.doe',
        assignedFrom: 'john.smith',
      });
    });
  });

  // ==========================================================================
  // getUnlinkedCommits
  // ==========================================================================
  describe('getUnlinkedCommits', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getUnlinkedCommits();
      expect(result).toEqual([]);
    });

    it('should return mapped unlinked commit entries', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc12345',
            author: 'dev1',
            commit_message: 'Fix styling issue',
            commit_date: new Date('2025-03-01'),
            repository: 'my-app',
          },
        ],
        rowCount: 1,
      });

      const result = await service.getUnlinkedCommits();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        sha: 'abc12345',
        author: 'dev1',
        commitMessage: 'Fix styling issue',
        commitDate: '2025-03-01',
        repository: 'my-app',
      });
    });

    it('should filter for unlinked commits only', async () => {
      await service.getUnlinkedCommits();

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('is_jira_ref = false');
      expect(sql).toContain('is_jira_ref IS NULL');
    });

    it('should respect the limit parameter', async () => {
      await service.getUnlinkedCommits({}, 50);

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params).toContain(50);
    });

    it('should use is_linear_ref when trackerType is linear (IQS-876)', async () => {
      await service.getUnlinkedCommits({ trackerType: 'linear' });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('is_linear_ref = false');
      expect(sql).toContain('is_linear_ref IS NULL');
      expect(sql).not.toContain('is_jira_ref');
    });
  });

  // ==========================================================================
  // getFilterOptions
  // ==========================================================================
  describe('getFilterOptions', () => {
    it('should return empty arrays when no data', async () => {
      const result = await service.getFilterOptions();

      expect(result.teams).toEqual([]);
      expect(result.repositories).toEqual([]);
      expect(result.jiraProjects).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(3);
    });

    it('should return mapped filter options', async () => {
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({
          rows: [{ team: 'Platform' }, { team: 'Product' }],
          rowCount: 2,
        })
        .mockResolvedValueOnce({
          rows: [{ repository: 'app1' }, { repository: 'app2' }],
          rowCount: 2,
        })
        .mockResolvedValueOnce({
          rows: [{ project: 'FEAT' }, { project: 'PROJ' }],
          rowCount: 2,
        });

      const result = await service.getFilterOptions();

      expect(result.teams).toEqual(['Platform', 'Product']);
      expect(result.repositories).toEqual(['app1', 'app2']);
      expect(result.jiraProjects).toEqual(['FEAT', 'PROJ']);
    });

    it('should use UNION query combining Jira and Linear projects (IQS-876)', async () => {
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // teams
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // repos
        .mockResolvedValueOnce({ rows: [{ project: 'IQS' }, { project: 'PROJ' }], rowCount: 2 }); // combined

      await service.getFilterOptions();

      const calls = vi.mocked(mockDb.query).mock.calls;
      const projectsSql = calls[2]![0] as string;
      // Verify the UNION pattern
      expect(projectsSql).toContain('commit_jira');
      expect(projectsSql).toContain('commit_linear');
      expect(projectsSql).toContain('UNION');
    });
  });

  // ==========================================================================
  // Error handling
  // ==========================================================================
  describe('error handling', () => {
    it('should propagate database query errors', async () => {
      vi.mocked(mockDb.query).mockRejectedValueOnce(new Error('Connection refused'));

      await expect(service.getLinkageSummary()).rejects.toThrow('Connection refused');
    });
  });
});
