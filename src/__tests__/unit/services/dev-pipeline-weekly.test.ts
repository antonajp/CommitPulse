import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { LoggerService } from '../../../logging/logger.js';
import { DevPipelineDataService } from '../../../services/dev-pipeline-data-service.js';
import { DEV_PIPELINE_MAX_FILTER_LENGTH } from '../../../services/dev-pipeline-data-types.js';
import type { DatabaseService } from '../../../database/database-service.js';
import type { RepositoryEntry } from '../../../config/settings.js';

/**
 * Unit tests for DevPipelineDataService weekly aggregation methods (IQS-929).
 * Tests the data service layer for the Developer Pipeline weekly metrics dashboard.
 *
 * Test coverage includes:
 * - getUniqueTeams: fetching and sorting team list
 * - getWeeklyMetrics: weekly aggregation with team filter
 * - Comments ratio calculation
 * - Input validation (team, date format, date range)
 * - Error handling for edge cases
 * - repoUrl lookup from VS Code settings (IQS-929 fix)
 */
describe('DevPipelineDataService - Weekly Metrics', () => {
  let mockDb: DatabaseService;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as DatabaseService;
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // getUniqueTeams
  // ==========================================================================
  describe('getUniqueTeams', () => {
    it('should return sorted list of unique teams', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { team: 'Engineering' },
          { team: 'Data Science' },
          { team: 'Product' },
        ],
        rowCount: 3,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getUniqueTeams();

      expect(result).toEqual(['Engineering', 'Data Science', 'Product']);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
      // Verify the query uses ORDER BY team ASC
      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call?.[0]).toContain('ORDER BY team ASC');
    });

    it('should return empty array when no teams exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getUniqueTeams();

      expect(result).toEqual([]);
    });

    it('should exclude null teams (query filters them)', async () => {
      // The SQL query has WHERE team IS NOT NULL, so null teams
      // should never be returned. Test that the service handles it correctly.
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { team: 'Engineering' },
          { team: 'Data Science' },
        ],
        rowCount: 2,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getUniqueTeams();

      expect(result).toEqual(['Engineering', 'Data Science']);
      expect(result).not.toContain(null);
    });

    it('should handle database query errors gracefully', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const service = new DevPipelineDataService(mockDb);

      await expect(service.getUniqueTeams()).rejects.toThrow('Database connection failed');
    });
  });

  // ==========================================================================
  // getWeeklyMetrics
  // ==========================================================================
  describe('getWeeklyMetrics', () => {
    it('should return weekly aggregated data for a team', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'), // Monday
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 500,
            total_complexity_delta: 25,
            total_comments_delta: 50,
            total_tests_delta: 100,
            total_comment_lines: 120,
            total_code_lines: 800,
            commit_count: 5,
            latest_sha: 'abc1234',
            repository: 'test-repo',
          },
          {
            week_start: new Date('2024-06-03T00:00:00Z'), // Same week, different author
            author: 'anotheruser',
            full_name: 'Another User',
            team: 'Engineering',
            total_loc_delta: 300,
            total_complexity_delta: 15,
            total_comments_delta: 30,
            total_tests_delta: 60,
            total_comment_lines: 80,
            total_code_lines: 600,
            commit_count: 3,
            latest_sha: 'def5678',
            repository: 'test-repo',
          },
        ],
        rowCount: 2,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        weekStart: '2024-06-03',
        author: 'testuser',
        fullName: 'Test User',
        team: 'Engineering',
        totalLocDelta: 500,
        totalComplexityDelta: 25,
        totalCommentsDelta: 50,
        totalTestsDelta: 100,
        totalCommentLines: 120,
        totalCodeLines: 800,
        commitCount: 5,
        latestSha: 'abc1234',
      });
      expect(result[1]).toMatchObject({
        weekStart: '2024-06-03',
        author: 'anotheruser',
        fullName: 'Another User',
        team: 'Engineering',
      });
    });

    it('should calculate commentsRatio correctly', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 500,
            total_complexity_delta: 25,
            total_comments_delta: 50,
            total_tests_delta: 100,
            total_comment_lines: 200, // 20% of total code lines
            total_code_lines: 1000,
            commit_count: 5,
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toHaveLength(1);
      // commentsRatio = (200 / 1000) * 100 = 20
      expect(result[0]?.commentsRatio).toBe(20);
    });

    it('should handle zero code lines in commentsRatio calculation', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 0,
            total_complexity_delta: 0,
            total_comments_delta: 0,
            total_tests_delta: 0,
            total_comment_lines: 10,
            total_code_lines: 0, // Division by zero scenario
            commit_count: 1,
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toHaveLength(1);
      // Should default to 0 when code_lines is 0
      expect(result[0]?.commentsRatio).toBe(0);
    });

    it('should handle Date objects in week_start column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-10T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 25,
            total_code_lines: 200,
            commit_count: 2,
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toHaveLength(1);
      expect(result[0]?.weekStart).toBe('2024-06-10');
    });

    it('should handle string week_start values', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: '2024-06-10', // String instead of Date
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 25,
            total_code_lines: 200,
            commit_count: 2,
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toHaveLength(1);
      expect(result[0]?.weekStart).toBe('2024-06-10');
    });

    it('should throw error when team is empty', async () => {
      const service = new DevPipelineDataService(mockDb);

      await expect(
        service.getWeeklyMetrics('', '2024-06-01', '2024-06-30')
      ).rejects.toThrow('Team parameter is required and must be non-empty');

      await expect(
        service.getWeeklyMetrics('   ', '2024-06-01', '2024-06-30')
      ).rejects.toThrow('Team parameter is required and must be non-empty');
    });

    it('should throw error when team exceeds max length', async () => {
      const service = new DevPipelineDataService(mockDb);
      const longTeam = 'a'.repeat(DEV_PIPELINE_MAX_FILTER_LENGTH + 1);

      await expect(
        service.getWeeklyMetrics(longTeam, '2024-06-01', '2024-06-30')
      ).rejects.toThrow(`team exceeds maximum length of ${DEV_PIPELINE_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw error when date range exceeds 365 days', async () => {
      const service = new DevPipelineDataService(mockDb);

      await expect(
        service.getWeeklyMetrics('Engineering', '2024-01-01', '2025-02-01') // 397 days
      ).rejects.toThrow('Date range exceeds maximum of 365 days');
    });

    it('should accept date range of exactly 365 days', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);

      // Should not throw
      await expect(
        service.getWeeklyMetrics('Engineering', '2024-01-01', '2024-12-31') // 365 days
      ).resolves.toEqual([]);
    });

    it('should throw error for invalid start date format', async () => {
      const service = new DevPipelineDataService(mockDb);

      await expect(
        service.getWeeklyMetrics('Engineering', 'bad-date', '2024-06-30')
      ).rejects.toThrow('Invalid start date format');

      await expect(
        service.getWeeklyMetrics('Engineering', '06/01/2024', '2024-06-30')
      ).rejects.toThrow('Invalid start date format');

      await expect(
        service.getWeeklyMetrics('Engineering', '2024-13-01', '2024-06-30')
      ).rejects.toThrow('Invalid start date format');
    });

    it('should throw error for invalid end date format', async () => {
      const service = new DevPipelineDataService(mockDb);

      await expect(
        service.getWeeklyMetrics('Engineering', '2024-06-01', 'bad-date')
      ).rejects.toThrow('Invalid end date format');

      await expect(
        service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-02-30')
      ).rejects.toThrow('Invalid end date format');
    });

    it('should throw error when start date is after end date', async () => {
      const service = new DevPipelineDataService(mockDb);

      await expect(
        service.getWeeklyMetrics('Engineering', '2024-12-31', '2024-01-01')
      ).rejects.toThrow('Invalid date range: start date (2024-12-31) must be before end date (2024-01-01)');
    });

    it('should return empty array when no data matches filters', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toEqual([]);
    });

    it('should pass correct parameters to database query', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(mockDb.query).toHaveBeenCalledTimes(1);
      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];

      // Verify SQL query contains required elements (with table alias v.)
      expect(call?.[0]).toContain('DATE_TRUNC');
      expect(call?.[0]).toContain('week');
      expect(call?.[0]).toContain('WHERE v.team = $1');
      expect(call?.[0]).toContain('v.commit_date >= $2');
      expect(call?.[0]).toContain('v.commit_date <= $3');

      // Verify parameters
      expect(call?.[1]).toEqual(['Engineering', '2024-06-01', '2024-06-30']);
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: '500', // String
            total_complexity_delta: '25', // String
            total_comments_delta: '50', // String
            total_tests_delta: '100', // String
            total_comment_lines: '120', // String
            total_code_lines: '800', // String
            commit_count: '5', // String
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toHaveLength(1);
      expect(typeof result[0]?.totalLocDelta).toBe('number');
      expect(result[0]?.totalLocDelta).toBe(500);
      expect(typeof result[0]?.totalComplexityDelta).toBe('number');
      expect(result[0]?.totalComplexityDelta).toBe(25);
      expect(typeof result[0]?.commitCount).toBe('number');
      expect(result[0]?.commitCount).toBe(5);
    });

    it('should handle multiple weeks of data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 500,
            total_complexity_delta: 25,
            total_comments_delta: 50,
            total_tests_delta: 100,
            total_comment_lines: 120,
            total_code_lines: 800,
            commit_count: 5,
          },
          {
            week_start: new Date('2024-06-10T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 300,
            total_complexity_delta: 15,
            total_comments_delta: 30,
            total_tests_delta: 60,
            total_comment_lines: 80,
            total_code_lines: 600,
            commit_count: 3,
          },
          {
            week_start: new Date('2024-06-17T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 200,
            total_complexity_delta: 10,
            total_comments_delta: 20,
            total_tests_delta: 40,
            total_comment_lines: 50,
            total_code_lines: 400,
            commit_count: 2,
          },
        ],
        rowCount: 3,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toHaveLength(3);
      expect(result[0]?.weekStart).toBe('2024-06-03');
      expect(result[1]?.weekStart).toBe('2024-06-10');
      expect(result[2]?.weekStart).toBe('2024-06-17');
    });

    it('should handle null full_name gracefully', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'testuser',
            full_name: null, // No display name
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 25,
            total_code_lines: 200,
            commit_count: 2,
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toHaveLength(1);
      expect(result[0]?.fullName).toBeNull();
      expect(result[0]?.author).toBe('testuser');
    });

    it('should calculate correct commentsRatio with various comment/code ratios', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'user1',
            full_name: 'User One',
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 50, // 10% ratio
            total_code_lines: 500,
            commit_count: 2,
            latest_sha: null,
            repository: null,
          },
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'user2',
            full_name: 'User Two',
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 250, // 50% ratio
            total_code_lines: 500,
            commit_count: 2,
            latest_sha: null,
            repository: null,
          },
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'user3',
            full_name: 'User Three',
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 1, // 1% ratio
            total_code_lines: 100,
            commit_count: 2,
            latest_sha: null,
            repository: null,
          },
        ],
        rowCount: 3,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toHaveLength(3);
      expect(result[0]?.commentsRatio).toBe(10); // (50/500)*100
      expect(result[1]?.commentsRatio).toBe(50); // (250/500)*100
      expect(result[2]?.commentsRatio).toBe(1);  // (1/100)*100
    });

    it('should look up repoUrl from settings based on repository name', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 25,
            total_code_lines: 200,
            commit_count: 2,
            latest_sha: 'abc1234567890',
            repository: 'my-project',
          },
        ],
        rowCount: 1,
      });

      const repositories: RepositoryEntry[] = [
        {
          path: '/path/to/my-project',
          name: 'my-project',
          organization: 'myorg',
          trackerType: 'jira',
          repoUrl: 'https://github.com/myorg/my-project',
        },
      ];

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30', repositories);

      expect(result).toHaveLength(1);
      expect(result[0]?.repoUrl).toBe('https://github.com/myorg/my-project');
      expect(result[0]?.latestSha).toBe('abc1234567890');
    });

    it('should return null repoUrl when repository not in settings', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 25,
            total_code_lines: 200,
            commit_count: 2,
            latest_sha: 'abc1234567890',
            repository: 'unknown-repo', // Not in settings
          },
        ],
        rowCount: 1,
      });

      const repositories: RepositoryEntry[] = [
        {
          path: '/path/to/other-project',
          name: 'other-project',
          organization: 'myorg',
          trackerType: 'jira',
          repoUrl: 'https://github.com/myorg/other-project',
        },
      ];

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30', repositories);

      expect(result).toHaveLength(1);
      expect(result[0]?.repoUrl).toBeNull();
    });

    it('should return null repoUrl when repository has no repoUrl in settings', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 25,
            total_code_lines: 200,
            commit_count: 2,
            latest_sha: 'abc1234567890',
            repository: 'my-project',
          },
        ],
        rowCount: 1,
      });

      const repositories: RepositoryEntry[] = [
        {
          path: '/path/to/my-project',
          name: 'my-project',
          organization: 'myorg',
          trackerType: 'jira',
          // No repoUrl defined
        },
      ];

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30', repositories);

      expect(result).toHaveLength(1);
      expect(result[0]?.repoUrl).toBeNull();
    });

    it('should return null repoUrl when no repositories provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 25,
            total_code_lines: 200,
            commit_count: 2,
            latest_sha: 'abc1234567890',
            repository: 'my-project',
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      // No repositories parameter (uses default empty array)
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30');

      expect(result).toHaveLength(1);
      expect(result[0]?.repoUrl).toBeNull();
    });

    it('should return null repoUrl when repository is null', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-03T00:00:00Z'),
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            total_loc_delta: 100,
            total_complexity_delta: 5,
            total_comments_delta: 10,
            total_tests_delta: 20,
            total_comment_lines: 25,
            total_code_lines: 200,
            commit_count: 2,
            latest_sha: 'abc1234567890',
            repository: null, // Null repository
          },
        ],
        rowCount: 1,
      });

      const repositories: RepositoryEntry[] = [
        {
          path: '/path/to/my-project',
          name: 'my-project',
          organization: 'myorg',
          trackerType: 'jira',
          repoUrl: 'https://github.com/myorg/my-project',
        },
      ];

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getWeeklyMetrics('Engineering', '2024-06-01', '2024-06-30', repositories);

      expect(result).toHaveLength(1);
      expect(result[0]?.repoUrl).toBeNull();
    });
  });
});
