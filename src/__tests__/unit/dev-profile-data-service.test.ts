import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DevProfileDataService } from '../../services/dev-profile-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for DevProfileDataService (GITX-155).
 * Tests data queries for the Developer Profile Dashboard.
 */
describe('DevProfileDataService', () => {
  let mockDb: DatabaseService;
  let service: DevProfileDataService;

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

    service = new DevProfileDataService(mockDb);
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
    it('should create a DevProfileDataService instance', () => {
      expect(service).toBeDefined();
    });
  });

  // ==========================================================================
  // getDevelopers
  // ==========================================================================
  describe('getDevelopers', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getDevelopers();
      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return mapped developer data sorted by commit count', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { full_name: 'John Doe', logins: 'john.doe', commit_count: 150 },
          { full_name: 'Jane Smith', logins: 'jane.smith', commit_count: 100 },
        ],
        rowCount: 2,
      });

      const result = await service.getDevelopers();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        fullName: 'John Doe',
        login: 'john.doe',
        commitCount: 150,
      });
      expect(result[1]).toEqual({
        fullName: 'Jane Smith',
        login: 'jane.smith',
        commitCount: 100,
      });
    });

    it('should handle developers with null full_name', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { full_name: null, logins: 'bot', commit_count: 50 },
        ],
        rowCount: 1,
      });

      const result = await service.getDevelopers();

      expect(result[0]?.fullName).toBeNull();
      expect(result[0]?.login).toBe('bot');
    });

    it('should group multiple logins by full_name (GITX-169)', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { full_name: 'Alice Smith', logins: 'alice,alice.smith', commit_count: 200 },
        ],
        rowCount: 1,
      });

      const result = await service.getDevelopers();

      expect(result).toHaveLength(1);
      expect(result[0]?.fullName).toBe('Alice Smith');
      expect(result[0]?.login).toBe('alice'); // First login used for display
      expect(result[0]?.commitCount).toBe(200);
    });

    it('should use STRING_AGG for logins in SQL (GITX-169)', async () => {
      await service.getDevelopers();

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      expect(sql).toContain('STRING_AGG(DISTINCT cc.login');
      expect(sql).toContain('GROUP BY cc.full_name');
    });
  });

  // ==========================================================================
  // getSummary
  // ==========================================================================
  describe('getSummary', () => {
    it('should return summary statistics for a developer', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            total_commits: 50,
            total_loc_added: '25000',
            avg_complexity: '8.5',
            repos_worked_on: 3,
          },
        ],
        rowCount: 1,
      });

      const result = await service.getSummary({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result).toEqual({
        totalCommits: 50,
        totalLoc: 25000,
        avgComplexity: 8.5,
        repositoriesWorkedOn: 3,
      });
    });

    it('should return zero summary when no data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.getSummary({
        developer: 'new.dev',
        timeframeDays: '30',
      });

      expect(result).toEqual({
        totalCommits: 0,
        totalLoc: 0,
        avgComplexity: 0,
        repositoriesWorkedOn: 0,
      });
    });

    it('should use parameterized queries', async () => {
      await service.getSummary({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(params[0]).toBe('john.doe');
      expect(typeof params[1]).toBe('string'); // date string
    });
  });

  // ==========================================================================
  // getLocPerWeek
  // ==========================================================================
  describe('getLocPerWeek', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getLocPerWeek({
        developer: 'john.doe',
        timeframeDays: '90',
      });
      expect(result).toEqual([]);
    });

    it('should return LOC data grouped by week and repository', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2025-01-06'),
            repository: 'my-app',
            lines_added: '500',
            lines_removed: '200',
            net_lines: '300',
          },
          {
            week_start: new Date('2025-01-13'),
            repository: 'my-app',
            lines_added: '700',
            lines_removed: '100',
            net_lines: '600',
          },
        ],
        rowCount: 2,
      });

      const result = await service.getLocPerWeek({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        weekStart: '2025-01-06',
        repository: 'my-app',
        linesAdded: 500,
        linesRemoved: 200,
        netLines: 300,
      });
    });
  });

  // ==========================================================================
  // getTopComplexFiles
  // ==========================================================================
  describe('getTopComplexFiles', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getTopComplexFiles({
        developer: 'john.doe',
        timeframeDays: '90',
      });
      expect(result).toEqual([]);
    });

    it('should return top 15 complex files', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/services/complex.ts',
            complexity_score: 45,
            repository: 'my-app',
            last_modified: new Date('2025-01-15'),
          },
        ],
        rowCount: 1,
      });

      const result = await service.getTopComplexFiles({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        filePath: 'src/services/complex.ts',
        complexityScore: 45,
        repository: 'my-app',
        lastModified: '2025-01-15',
      });
    });

    it('should include LIMIT 15 in query', async () => {
      await service.getTopComplexFiles({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      expect(sql).toContain('LIMIT 15');
    });
  });

  // ==========================================================================
  // getTopFrequentFiles
  // ==========================================================================
  describe('getTopFrequentFiles', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getTopFrequentFiles({
        developer: 'john.doe',
        timeframeDays: '90',
      });
      expect(result).toEqual([]);
    });

    it('should return top 20 frequently modified files', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/index.ts',
            modification_count: 25,
            total_loc_changed: '1500',
            repository: 'my-app',
          },
        ],
        rowCount: 1,
      });

      const result = await service.getTopFrequentFiles({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        filePath: 'src/index.ts',
        modificationCount: 25,
        totalLocChanged: 1500,
        repository: 'my-app',
      });
    });

    it('should include LIMIT 20 in query', async () => {
      await service.getTopFrequentFiles({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      expect(sql).toContain('LIMIT 20');
    });
  });

  // ==========================================================================
  // Input Validation
  // ==========================================================================
  describe('input validation', () => {
    describe('developer validation', () => {
      it('should reject empty developer string', async () => {
        await expect(service.getSummary({
          developer: '',
          timeframeDays: '90',
        })).rejects.toThrow('Developer login is required');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject whitespace-only developer string', async () => {
        await expect(service.getSummary({
          developer: '   ',
          timeframeDays: '90',
        })).rejects.toThrow('Developer login is required');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject developer string exceeding 200 characters', async () => {
        const longDeveloper = 'A'.repeat(201);
        await expect(service.getSummary({
          developer: longDeveloper,
          timeframeDays: '90',
        })).rejects.toThrow('exceeds maximum length');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });

    describe('timeframe validation', () => {
      it('should accept valid timeframe values', async () => {
        const validTimeframes = ['30', '60', '90', '180', '365', '730'] as const;
        for (const timeframe of validTimeframes) {
          vi.mocked(mockDb.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });
          await service.getSummary({
            developer: 'john.doe',
            timeframeDays: timeframe,
          });
        }
        expect(mockDb.query).toHaveBeenCalledTimes(6);
      });

      it('should reject invalid timeframe value', async () => {
        await expect(service.getSummary({
          developer: 'john.doe',
          timeframeDays: '45' as '30',
        })).rejects.toThrow('Invalid timeframe');
        expect(mockDb.query).not.toHaveBeenCalled();
      });

      it('should reject malicious timeframe value', async () => {
        await expect(service.getSummary({
          developer: 'john.doe',
          timeframeDays: "'; DROP TABLE commit_history; --" as '30',
        })).rejects.toThrow('Invalid timeframe');
        expect(mockDb.query).not.toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // Security
  // ==========================================================================
  describe('security', () => {
    it('should use parameterized queries to prevent SQL injection (CWE-89)', async () => {
      const maliciousInput = "john.doe'; DROP TABLE commit_history; --";

      vi.mocked(mockDb.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.getSummary({
        developer: maliciousInput,
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      // The malicious input should be passed as a parameter, not interpolated
      expect(sql).not.toContain(maliciousInput);
      expect(params[0]).toBe(maliciousInput);
    });

    it('should exclude merge commits from data', async () => {
      await service.getSummary({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      expect(sql).toContain('is_merge = FALSE');
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================
  describe('error handling', () => {
    it('should propagate database query errors', async () => {
      vi.mocked(mockDb.query).mockRejectedValueOnce(new Error('Connection refused'));

      await expect(service.getSummary({
        developer: 'john.doe',
        timeframeDays: '90',
      })).rejects.toThrow('Connection refused');
    });
  });

  // ==========================================================================
  // GITX-156: getTechStack
  // ==========================================================================
  describe('getTechStack', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getTechStack({
        developer: 'john.doe',
        timeframeDays: '90',
      });
      expect(result).toEqual([]);
    });

    it('should return tech stack data with percentages', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { category: 'Backend', repository: 'my-app', loc_count: '5000', percentage: '50.00' },
          { category: 'Frontend', repository: 'my-app', loc_count: '3000', percentage: '30.00' },
          { category: 'Testing', repository: 'my-app', loc_count: '2000', percentage: '20.00' },
        ],
        rowCount: 3,
      });

      const result = await service.getTechStack({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        category: 'Backend',
        repository: 'my-app',
        locCount: 5000,
        percentage: 50.00,
      });
    });

    it('should use parameterized queries', async () => {
      await service.getTechStack({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('vw_technology_stack_category');
    });
  });

  // ==========================================================================
  // GITX-156: getCommentsPerWeek
  // ==========================================================================
  describe('getCommentsPerWeek', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getCommentsPerWeek({
        developer: 'john.doe',
        timeframeDays: '90',
      });
      expect(result).toEqual([]);
    });

    it('should return comments per week data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { week_start: new Date('2025-01-06'), comments_added: 150 },
          { week_start: new Date('2025-01-13'), comments_added: 200 },
        ],
        rowCount: 2,
      });

      const result = await service.getCommentsPerWeek({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        weekStart: '2025-01-06',
        commentsAdded: 150,
      });
    });

    it('should use COALESCE for NULL comments_change', async () => {
      await service.getCommentsPerWeek({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('COALESCE');
      expect(sql).toContain('comments_change');
    });
  });

  // ==========================================================================
  // GITX-156: getTestsPerWeek
  // ==========================================================================
  describe('getTestsPerWeek', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getTestsPerWeek({
        developer: 'john.doe',
        timeframeDays: '90',
      });
      expect(result).toEqual([]);
    });

    it('should return tests per week data filtered by is_test_file', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { week_start: new Date('2025-01-06'), test_files_modified: 5, test_lines_added: 300 },
          { week_start: new Date('2025-01-13'), test_files_modified: 8, test_lines_added: 500 },
        ],
        rowCount: 2,
      });

      const result = await service.getTestsPerWeek({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        weekStart: '2025-01-06',
        testFilesModified: 5,
        testLinesAdded: 300,
      });
    });

    it('should filter by is_test_file = TRUE', async () => {
      await service.getTestsPerWeek({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('is_test_file = TRUE');
    });
  });

  // ==========================================================================
  // GITX-156: getHygieneScore
  // ==========================================================================
  describe('getHygieneScore', () => {
    it('should return zero score when no commits', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          avg_hygiene_score: null,
          jira_ref_pct: '0',
          meaningful_msg_pct: '0',
          non_merge_pct: '100',
          excellent_count: 0,
          good_count: 0,
          fair_count: 0,
          poor_count: 0,
        }],
        rowCount: 1,
      });

      const result = await service.getHygieneScore({
        developer: 'new.dev',
        timeframeDays: '90',
      });

      expect(result).toEqual({
        overallScore: 0,
        jiraRefPercentage: 0,
        meaningfulMsgPercentage: 0,
        nonMergePercentage: 100,
        totalCommits: 0,
        qualityTier: 'poor',
      });
    });

    it('should return hygiene score with breakdown', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 100,
          avg_hygiene_score: '75.50',
          jira_ref_pct: '85.0',
          meaningful_msg_pct: '90.0',
          non_merge_pct: '100.0',
          excellent_count: 30,
          good_count: 50,
          fair_count: 15,
          poor_count: 5,
        }],
        rowCount: 1,
      });

      const result = await service.getHygieneScore({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result.overallScore).toBe(75.5);
      expect(result.jiraRefPercentage).toBe(85.0);
      expect(result.meaningfulMsgPercentage).toBe(90.0);
      expect(result.nonMergePercentage).toBe(100.0);
      expect(result.totalCommits).toBe(100);
      expect(result.qualityTier).toBe('excellent'); // 80% excellent+good
    });

    it('should assign correct quality tier based on distribution', async () => {
      // Test 'good' tier (60-80% excellent+good)
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 100,
          avg_hygiene_score: '65.00',
          jira_ref_pct: '70.0',
          meaningful_msg_pct: '75.0',
          non_merge_pct: '100.0',
          excellent_count: 20,
          good_count: 50,
          fair_count: 20,
          poor_count: 10,
        }],
        rowCount: 1,
      });

      const result = await service.getHygieneScore({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result.qualityTier).toBe('good'); // 70% excellent+good
    });

    it('should query vw_commit_hygiene view', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          avg_hygiene_score: null,
          jira_ref_pct: '0',
          meaningful_msg_pct: '0',
          non_merge_pct: '100',
          excellent_count: 0,
          good_count: 0,
          fair_count: 0,
          poor_count: 0,
        }],
        rowCount: 1,
      });

      await service.getHygieneScore({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      expect(sql).toContain('vw_commit_hygiene');
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
    });
  });

  // ==========================================================================
  // GITX-157: getVelocityVsLoc
  // ==========================================================================
  describe('getVelocityVsLoc', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getVelocityVsLoc({
        developer: 'john.doe',
        timeframeDays: '90',
      });
      expect(result).toEqual([]);
    });

    it('should return velocity vs LOC data points', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2025-01-06'),
            story_points: 13,
            lines_of_code: '2500',
            issue_count: 3,
            commit_count: 15,
          },
          {
            week_start: new Date('2025-01-13'),
            story_points: 8,
            lines_of_code: '1800',
            issue_count: 2,
            commit_count: 10,
          },
        ],
        rowCount: 2,
      });

      const result = await service.getVelocityVsLoc({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        weekStart: '2025-01-06',
        storyPoints: 13,
        linesOfCode: 2500,
        issueCount: 3,
        commitCount: 15,
      });
      expect(result[1]).toEqual({
        weekStart: '2025-01-13',
        storyPoints: 8,
        linesOfCode: 1800,
        issueCount: 2,
        commitCount: 10,
      });
    });

    it('should use parameterized queries', async () => {
      await service.getVelocityVsLoc({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(params[0]).toBe('john.doe');
      expect(typeof params[1]).toBe('string'); // date string
    });

    it('should use FULL OUTER JOIN for weeks with only commits or only issues', async () => {
      await service.getVelocityVsLoc({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      expect(sql).toContain('FULL OUTER JOIN');
    });

    it('should validate developer input', async () => {
      await expect(service.getVelocityVsLoc({
        developer: '',
        timeframeDays: '90',
      })).rejects.toThrow('Developer login is required');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should validate timeframe input', async () => {
      await expect(service.getVelocityVsLoc({
        developer: 'john.doe',
        timeframeDays: '45' as '30',
      })).rejects.toThrow('Invalid timeframe');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    // ========================================================================
    // GITX-170: Story points attribution to assignee at completion time
    // ========================================================================
    describe('GITX-170: assignee at completion time', () => {
      it('should use jira_history table for Jira points attribution', async () => {
        await service.getVelocityVsLoc({
          developer: 'john.doe',
          timeframeDays: '90',
        });

        const call = vi.mocked(mockDb.query).mock.calls[0];
        expect(call).toBeDefined();
        const sql = call![0] as string;

        // Should use jira_history (jh) not jira_detail for attribution
        expect(sql).toContain('jira_history jh');
        // Should join to jira_detail only for story points value
        expect(sql).toContain('jira_detail jd ON jh.jira_key = jd.jira_key');
      });

      it('should use jd.assignee matched against cc.full_name for attribution (GITX-179)', async () => {
        await service.getVelocityVsLoc({
          developer: 'john.doe',
          timeframeDays: '90',
        });

        const call = vi.mocked(mockDb.query).mock.calls[0];
        expect(call).toBeDefined();
        const sql = call![0] as string;

        // GITX-179: The dev_jira_points CTE should join on jd.assignee (from jira_detail)
        // matched against cc.full_name. The jira_history.assignee column was always NULL
        // (not populated during changelog extraction), which caused NO DATA to display.
        expect(sql).toContain('jd.assignee = cc.full_name');
      });

      it('should filter by status field and completion statuses', async () => {
        await service.getVelocityVsLoc({
          developer: 'john.doe',
          timeframeDays: '90',
        });

        const call = vi.mocked(mockDb.query).mock.calls[0];
        expect(call).toBeDefined();
        const sql = call![0] as string;

        // Should filter by field = 'status' for status transitions
        expect(sql).toContain("jh.field = 'status'");
        // Should filter by completion statuses
        expect(sql).toContain("jh.to_value IN ('Done', 'Closed', 'Resolved')");
      });

      it('should use jh.change_date for completion timing', async () => {
        await service.getVelocityVsLoc({
          developer: 'john.doe',
          timeframeDays: '90',
        });

        const call = vi.mocked(mockDb.query).mock.calls[0];
        expect(call).toBeDefined();
        const sql = call![0] as string;

        // Should use jh.change_date (actual completion timestamp)
        // not jd.status_change_date for week_start calculation
        expect(sql).toContain('jh.change_date');
        expect(sql).toContain("DATE_TRUNC('week', jh.change_date)");
      });

      it('should count multiple completions of same ticket (rework)', async () => {
        // This is correct behavior per acceptance criteria:
        // "Multiple 'Done' transitions of same ticket each counted"
        // The query uses COUNT(DISTINCT jd.jira_key) for issue_count,
        // but SUM(story_points) will count each completion transition.
        // If a ticket is moved to Done twice, points are summed twice.
        await service.getVelocityVsLoc({
          developer: 'john.doe',
          timeframeDays: '90',
        });

        const call = vi.mocked(mockDb.query).mock.calls[0];
        expect(call).toBeDefined();
        const sql = call![0] as string;

        // Story points are summed per history record, so multiple
        // "Done" transitions each contribute their story points
        expect(sql).toContain('SUM(jd.calculated_story_points)');
      });
    });
  });

  // ==========================================================================
  // GITX-172: getTestDebtMetrics
  // ==========================================================================
  describe('getTestDebtMetrics', () => {
    it('should return empty metrics when no data', async () => {
      // Mock view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock weekly query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });
      // Mock bugs view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock bug rate query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 0,
          high_test_count: 0,
          low_test_bugs: 0,
          high_test_bugs: 0,
          total_commits: 0,
        }],
        rowCount: 1,
      });
      // Mock team average query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 0,
          high_test_count: 0,
          low_test_bugs: 0,
          high_test_bugs: 0,
        }],
        rowCount: 1,
      });

      const result = await service.getTestDebtMetrics({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result.weeklyData).toEqual([]);
      expect(result.totalCommits).toBe(0);
    });

    it('should return empty metrics when view does not exist', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const result = await service.getTestDebtMetrics({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result.weeklyData).toEqual([]);
      expect(result.totalCommits).toBe(0);
      expect(result.lowTestCommits).toBe(0);
      expect(result.roiMultiplier).toBe(0);
    });

    it('should return weekly test debt data by tier', async () => {
      // Mock view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock weekly query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2025-01-06'),
            low_test_commits: 5,
            medium_test_commits: 3,
            high_test_commits: 2,
            total_commits: 10,
          },
          {
            week_start: new Date('2025-01-13'),
            low_test_commits: 3,
            medium_test_commits: 4,
            high_test_commits: 5,
            total_commits: 12,
          },
        ],
        rowCount: 2,
      });
      // Mock bugs view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock bug rate query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 8,
          high_test_count: 7,
          low_test_bugs: 4,
          high_test_bugs: 1,
          total_commits: 22,
        }],
        rowCount: 1,
      });
      // Mock team average query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 100,
          high_test_count: 50,
          low_test_bugs: 30,
          high_test_bugs: 10,
        }],
        rowCount: 1,
      });

      const result = await service.getTestDebtMetrics({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result.weeklyData).toHaveLength(2);
      expect(result.weeklyData[0]).toEqual({
        weekStart: '2025-01-06',
        lowTestCommits: 5,
        mediumTestCommits: 3,
        highTestCommits: 2,
        totalCommits: 10,
      });
      expect(result.totalCommits).toBe(22);
      expect(result.lowTestCommits).toBe(8);
    });

    it('should calculate ROI multiplier correctly', async () => {
      // Mock view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock weekly query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });
      // Mock bugs view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock bug rate query: low has 4 bugs / 8 commits = 0.5, high has 1 bug / 7 commits = 0.14
      // ROI = 0.5 / 0.14 = 3.5
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 8,
          high_test_count: 7,
          low_test_bugs: 4,
          high_test_bugs: 1,
          total_commits: 22,
        }],
        rowCount: 1,
      });
      // Mock team average query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 100,
          high_test_count: 50,
          low_test_bugs: 30,
          high_test_bugs: 10,
        }],
        rowCount: 1,
      });

      const result = await service.getTestDebtMetrics({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      // ROI = (4/8) / (1/7) = 0.5 / 0.14 = 3.5
      expect(result.roiMultiplier).toBeCloseTo(3.5, 1);
    });

    it('should calculate team average ROI', async () => {
      // Mock view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock weekly query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });
      // Mock bugs view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock bug rate query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 10,
          high_test_count: 10,
          low_test_bugs: 5,
          high_test_bugs: 2,
          total_commits: 20,
        }],
        rowCount: 1,
      });
      // Mock team average query: low has 30/100=0.3, high has 10/50=0.2
      // Team ROI = 0.3 / 0.2 = 1.5
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 100,
          high_test_count: 50,
          low_test_bugs: 30,
          high_test_bugs: 10,
        }],
        rowCount: 1,
      });

      const result = await service.getTestDebtMetrics({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      expect(result.teamAvgRoiMultiplier).toBeCloseTo(1.5, 1);
    });

    it('should filter by full_name with login fallback (GITX-169 pattern)', async () => {
      // Mock view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock weekly query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });
      // Mock bugs view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock bug rate query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 0,
          high_test_count: 0,
          low_test_bugs: 0,
          high_test_bugs: 0,
          total_commits: 0,
        }],
        rowCount: 1,
      });
      // Mock team average query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 0,
          high_test_count: 0,
          low_test_bugs: 0,
          high_test_bugs: 0,
        }],
        rowCount: 1,
      });

      await service.getTestDebtMetrics({
        developer: 'John Doe',
        timeframeDays: '90',
      });

      // Check the weekly query uses the GITX-169 pattern
      const call = vi.mocked(mockDb.query).mock.calls[1];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      expect(sql).toContain('cc.full_name = $1');
      expect(sql).toContain('cc.full_name IS NULL AND cc.login = $1');
      expect(sql).toContain('commit_contributors cc');
    });

    it('should use parameterized queries', async () => {
      // Mock view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock weekly query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });
      // Mock bugs view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock bug rate query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 0,
          high_test_count: 0,
          low_test_bugs: 0,
          high_test_bugs: 0,
          total_commits: 0,
        }],
        rowCount: 1,
      });
      // Mock team average query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 0,
          high_test_count: 0,
          low_test_bugs: 0,
          high_test_bugs: 0,
        }],
        rowCount: 1,
      });

      await service.getTestDebtMetrics({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      // Check the weekly query uses parameterized placeholders
      const call = vi.mocked(mockDb.query).mock.calls[1];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(params[0]).toBe('john.doe');
      expect(typeof params[1]).toBe('string'); // date string
    });

    it('should validate developer input', async () => {
      await expect(service.getTestDebtMetrics({
        developer: '',
        timeframeDays: '90',
      })).rejects.toThrow('Developer login is required');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should validate timeframe input', async () => {
      await expect(service.getTestDebtMetrics({
        developer: 'john.doe',
        timeframeDays: '45' as '30',
      })).rejects.toThrow('Invalid timeframe');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should require minimum 50 LOC for commits', async () => {
      // Mock view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock weekly query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });
      // Mock bugs view exists check
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // Mock bug rate query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 0,
          high_test_count: 0,
          low_test_bugs: 0,
          high_test_bugs: 0,
          total_commits: 0,
        }],
        rowCount: 1,
      });
      // Mock team average query
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          low_test_count: 0,
          high_test_count: 0,
          low_test_bugs: 0,
          high_test_bugs: 0,
        }],
        rowCount: 1,
      });

      await service.getTestDebtMetrics({
        developer: 'john.doe',
        timeframeDays: '90',
      });

      // Check the weekly query filters by prod_loc_changed >= 50
      const call = vi.mocked(mockDb.query).mock.calls[1];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      expect(sql).toContain('prod_loc_changed >= 50');
    });
  });

  // ==========================================================================
  // GITX-157: hasVelocityData
  // ==========================================================================
  describe('hasVelocityData', () => {
    it('should return false when no velocity data exists', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ has_data: false }],
        rowCount: 1,
      });

      const result = await service.hasVelocityData('new.dev');

      expect(result).toBe(false);
    });

    it('should return true when velocity data exists', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ has_data: true }],
        rowCount: 1,
      });

      const result = await service.hasVelocityData('john.doe');

      expect(result).toBe(true);
    });

    it('should check both Linear and Jira sources', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ has_data: false }],
        rowCount: 1,
      });

      await service.hasVelocityData('john.doe');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      expect(sql).toContain('linear_detail');
      // GITX-170: Uses jira_history to check assignee at completion time
      expect(sql).toContain('jira_history');
      expect(sql).toContain('UNION');
    });

    // GITX-170: Verify jira_history is used for assignee at completion time
    it('should use jira_history to check completion (GITX-170)', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ has_data: false }],
        rowCount: 1,
      });

      await service.hasVelocityData('john.doe');

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;

      // Should filter by status field changes to completion statuses
      expect(sql).toContain("jh.field = 'status'");
      expect(sql).toContain("jh.to_value IN ('Done', 'Closed', 'Resolved')");
    });

    it('should validate developer input', async () => {
      await expect(service.hasVelocityData('')).rejects.toThrow('Developer login is required');
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });
});
