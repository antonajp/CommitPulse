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
          { login: 'john.doe', full_name: 'John Doe', commit_count: 150 },
          { login: 'jane.smith', full_name: 'Jane Smith', commit_count: 100 },
        ],
        rowCount: 2,
      });

      const result = await service.getDevelopers();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        login: 'john.doe',
        fullName: 'John Doe',
        commitCount: 150,
      });
      expect(result[1]).toEqual({
        login: 'jane.smith',
        fullName: 'Jane Smith',
        commitCount: 100,
      });
    });

    it('should handle developers with null full_name', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { login: 'bot', full_name: null, commit_count: 50 },
        ],
        rowCount: 1,
      });

      const result = await service.getDevelopers();

      expect(result[0]?.fullName).toBeNull();
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
        const validTimeframes = ['30', '60', '90', '180', '365'] as const;
        for (const timeframe of validTimeframes) {
          vi.mocked(mockDb.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });
          await service.getSummary({
            developer: 'john.doe',
            timeframeDays: timeframe,
          });
        }
        expect(mockDb.query).toHaveBeenCalledTimes(5);
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
      expect(sql).toContain('jira_detail');
      expect(sql).toContain('UNION');
    });

    it('should validate developer input', async () => {
      await expect(service.hasVelocityData('')).rejects.toThrow('Developer login is required');
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });
});
