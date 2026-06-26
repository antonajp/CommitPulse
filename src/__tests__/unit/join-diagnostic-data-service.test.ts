import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { JoinDiagnosticDataService } from '../../services/join-diagnostic-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for JoinDiagnosticDataService (GITX-183).
 * Tests diagnostic queries for commit_contributors <-> jira_detail join failures.
 */
describe('JoinDiagnosticDataService', () => {
  let mockDb: DatabaseService;
  let service: JoinDiagnosticDataService;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockResolvedValue(true),
    } as unknown as DatabaseService;

    service = new JoinDiagnosticDataService(mockDb);
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
    it('should create a JoinDiagnosticDataService instance', () => {
      expect(service).toBeDefined();
    });
  });

  // ==========================================================================
  // Input Validation (CWE-20)
  // ==========================================================================
  describe('input validation (CWE-20)', () => {
    it('should reject empty developer identifier', async () => {
      await expect(service.getContributorSummary('')).rejects.toThrow('Developer identifier is required');
      await expect(service.getContributorSummary('   ')).rejects.toThrow('Developer identifier is required');
    });

    it('should reject developer identifier exceeding max length', async () => {
      const longName = 'a'.repeat(201);
      await expect(service.getContributorSummary(longName)).rejects.toThrow('exceeds maximum length');
    });

    it('should accept valid developer identifiers', async () => {
      await service.getContributorSummary('John Doe');
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // getContributorSummary
  // ==========================================================================
  describe('getContributorSummary', () => {
    it('should return null when contributor not found', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await service.getContributorSummary('John Doe');
      expect(result).toBeNull();
    });

    it('should map database row to camelCase interface', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          login: 'john.doe',
          full_name: 'John Doe',
          jira_name: 'John Doe',
          email: 'john.doe@example.com',
          alignment_status: 'Aligned (Same Value)',
        }],
        rowCount: 1,
      } as never);

      const result = await service.getContributorSummary('John Doe');
      expect(result).toEqual({
        login: 'john.doe',
        fullName: 'John Doe',
        jiraName: 'John Doe',
        email: 'john.doe@example.com',
        alignmentStatus: 'Aligned (Same Value)',
      });
    });

    it('should handle null jira_name (not aligned)', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          login: 'jane.smith',
          full_name: 'Jane Smith',
          jira_name: null,
          email: 'jane.smith@example.com',
          alignment_status: 'Not Aligned',
        }],
        rowCount: 1,
      } as never);

      const result = await service.getContributorSummary('Jane Smith');
      expect(result).toEqual({
        login: 'jane.smith',
        fullName: 'Jane Smith',
        jiraName: null,
        email: 'jane.smith@example.com',
        alignmentStatus: 'Not Aligned',
      });
    });

    it('should use parameterized query with developer parameter', async () => {
      await service.getContributorSummary('John Doe');
      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe('John Doe');
    });
  });

  // ==========================================================================
  // getJiraMatchStats
  // ==========================================================================
  describe('getJiraMatchStats', () => {
    it('should return zero stats when no data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await service.getJiraMatchStats('John Doe');
      expect(result).toEqual({
        matchedCount: 0,
        matchedStoryPoints: 0,
        unmatchedCount: 0,
        unmatchedStoryPoints: 0,
      });
    });

    it('should map database row to camelCase interface', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          matched_count: 10,
          matched_story_points: 50,
          unmatched_count: 5,
          unmatched_story_points: 20,
        }],
        rowCount: 1,
      } as never);

      const result = await service.getJiraMatchStats('John Doe');
      expect(result).toEqual({
        matchedCount: 10,
        matchedStoryPoints: 50,
        unmatchedCount: 5,
        unmatchedStoryPoints: 20,
      });
    });

    it('should use parameterized query with developer parameter', async () => {
      await service.getJiraMatchStats('John Doe');
      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe('John Doe');
    });
  });

  // ==========================================================================
  // getUnmatchedIssues
  // ==========================================================================
  describe('getUnmatchedIssues', () => {
    it('should return empty array when no unmatched issues', async () => {
      const result = await service.getUnmatchedIssues('John Doe');
      expect(result).toEqual([]);
    });

    it('should map database rows to camelCase interface', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            jira_key: 'GITX-100',
            summary: 'Fix bug in join logic',
            jira_assignee: 'John Doe',
            contributor_full_name: 'John Doe',
            contributor_jira_name: null,
            calculated_story_points: 5,
            status: 'Done',
            mismatch_reason: 'jira_name not set',
          },
          {
            jira_key: 'GITX-101',
            summary: 'Add diagnostic tool',
            jira_assignee: 'John Doe',
            contributor_full_name: 'John Doe',
            contributor_jira_name: 'J. Doe',
            calculated_story_points: 8,
            status: 'Done',
            mismatch_reason: 'Assignee mismatch',
          },
        ],
        rowCount: 2,
      } as never);

      const result = await service.getUnmatchedIssues('John Doe');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        jiraKey: 'GITX-100',
        summary: 'Fix bug in join logic',
        jiraAssignee: 'John Doe',
        contributorFullName: 'John Doe',
        contributorJiraName: null,
        calculatedStoryPoints: 5,
        status: 'Done',
        mismatchReason: 'jira_name not set',
      });
      expect(result[1]).toEqual({
        jiraKey: 'GITX-101',
        summary: 'Add diagnostic tool',
        jiraAssignee: 'John Doe',
        contributorFullName: 'John Doe',
        contributorJiraName: 'J. Doe',
        calculatedStoryPoints: 8,
        status: 'Done',
        mismatchReason: 'Assignee mismatch',
      });
    });

    it('should use parameterized query with developer parameter', async () => {
      await service.getUnmatchedIssues('John Doe');
      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params[0]).toBe('John Doe');
    });
  });

  // ==========================================================================
  // getAllContributors
  // ==========================================================================
  describe('getAllContributors', () => {
    it('should return empty array when no contributors', async () => {
      const result = await service.getAllContributors();
      expect(result).toEqual([]);
    });

    it('should map database rows to camelCase interface', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            login: 'john.doe',
            full_name: 'John Doe',
            jira_name: 'John Doe',
            alignment_status: 'Aligned (Same)',
            commit_count: 150,
          },
          {
            login: 'jane.smith',
            full_name: 'Jane Smith',
            jira_name: null,
            alignment_status: 'Not Aligned',
            commit_count: 100,
          },
        ],
        rowCount: 2,
      } as never);

      const result = await service.getAllContributors();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        login: 'john.doe',
        fullName: 'John Doe',
        jiraName: 'John Doe',
        alignmentStatus: 'Aligned (Same)',
        commitCount: 150,
      });
      expect(result[1]).toEqual({
        login: 'jane.smith',
        fullName: 'Jane Smith',
        jiraName: null,
        alignmentStatus: 'Not Aligned',
        commitCount: 100,
      });
    });

    it('should call query with no parameters', async () => {
      await service.getAllContributors();
      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      expect(call![1]).toBeUndefined();
    });
  });

  // ==========================================================================
  // getOrphanedAssignees
  // ==========================================================================
  describe('getOrphanedAssignees', () => {
    it('should return empty array when no orphaned assignees', async () => {
      const result = await service.getOrphanedAssignees();
      expect(result).toEqual([]);
    });

    it('should map database rows to camelCase interface', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            assignee: 'External Contractor',
            issue_count: 5,
            total_story_points: 25,
          },
          {
            assignee: 'Old Employee',
            issue_count: 3,
            total_story_points: 15,
          },
        ],
        rowCount: 2,
      } as never);

      const result = await service.getOrphanedAssignees();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        assignee: 'External Contractor',
        issueCount: 5,
        totalStoryPoints: 25,
      });
      expect(result[1]).toEqual({
        assignee: 'Old Employee',
        issueCount: 3,
        totalStoryPoints: 15,
      });
    });

    it('should call query with no parameters', async () => {
      await service.getOrphanedAssignees();
      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      expect(call![1]).toBeUndefined();
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================
  describe('error handling', () => {
    it('should propagate database errors with logging', async () => {
      const dbError = new Error('Database connection failed');
      vi.mocked(mockDb.query).mockRejectedValueOnce(dbError);

      await expect(service.getContributorSummary('John Doe')).rejects.toThrow('Database connection failed');
    });

    it('should handle query errors in all methods', async () => {
      const dbError = new Error('Query timeout');
      vi.mocked(mockDb.query).mockRejectedValue(dbError);

      await expect(service.getJiraMatchStats('John Doe')).rejects.toThrow('Query timeout');
      await expect(service.getUnmatchedIssues('John Doe')).rejects.toThrow('Query timeout');
      await expect(service.getAllContributors()).rejects.toThrow('Query timeout');
      await expect(service.getOrphanedAssignees()).rejects.toThrow('Query timeout');
    });
  });
});
