import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { VelocityDataService } from '../../services/velocity-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for VelocityDataService (IQS-888).
 * Tests the data service layer for the Sprint Velocity vs LOC chart.
 */
describe('VelocityDataService', () => {
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

  describe('checkViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getSprintVelocityVsLoc', () => {
    it('should return mapped velocity data points', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: '2024-06-10',
            team: 'Engineering',
            project: 'gitrx',
            repository: 'gitr',
            total_story_points: 13,
            issue_count: 5,
            total_loc_changed: 1500,
            total_lines_added: 900,
            total_lines_deleted: 600,
            commit_count: 12,
          },
          {
            week_start: '2024-06-17',
            team: 'Engineering',
            project: 'gitrx',
            repository: 'gitr',
            total_story_points: 8,
            issue_count: 3,
            total_loc_changed: 800,
            total_lines_added: 500,
            total_lines_deleted: 300,
            commit_count: 7,
          },
        ],
        rowCount: 2,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.getSprintVelocityVsLoc();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        weekStart: '2024-06-10',
        team: 'Engineering',
        project: 'gitrx',
        repository: 'gitr',
        totalStoryPoints: 13,
        issueCount: 5,
        totalLocChanged: 1500,
        totalLinesAdded: 900,
        totalLinesDeleted: 600,
        commitCount: 12,
      });
      expect(result[1]).toEqual({
        weekStart: '2024-06-17',
        team: 'Engineering',
        project: 'gitrx',
        repository: 'gitr',
        totalStoryPoints: 8,
        issueCount: 3,
        totalLocChanged: 800,
        totalLinesAdded: 500,
        totalLinesDeleted: 300,
        commitCount: 7,
      });
    });

    it('should handle Date objects in week_start column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-10T00:00:00Z'),
            team: null,
            project: null,
            repository: 'gitr',
            total_story_points: 0,
            issue_count: 0,
            total_loc_changed: 500,
            total_lines_added: 300,
            total_lines_deleted: 200,
            commit_count: 5,
          },
        ],
        rowCount: 1,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.getSprintVelocityVsLoc();

      expect(result).toHaveLength(1);
      expect(result[0]?.weekStart).toBe('2024-06-10');
      expect(result[0]?.team).toBeNull();
      expect(result[0]?.totalStoryPoints).toBe(0);
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.getSprintVelocityVsLoc();

      expect(result).toHaveLength(0);
    });

    it('should handle NULL team and project values', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: '2024-06-10',
            team: null,
            project: null,
            repository: null,
            total_story_points: 5,
            issue_count: 2,
            total_loc_changed: 0,
            total_lines_added: 0,
            total_lines_deleted: 0,
            commit_count: 0,
          },
        ],
        rowCount: 1,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.getSprintVelocityVsLoc();

      expect(result).toHaveLength(1);
      expect(result[0]?.team).toBeNull();
      expect(result[0]?.project).toBeNull();
      expect(result[0]?.repository).toBeNull();
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: '2024-06-10',
            team: 'Eng',
            project: 'test',
            repository: 'repo',
            total_story_points: '21',
            issue_count: '8',
            total_loc_changed: '3000',
            total_lines_added: '2000',
            total_lines_deleted: '1000',
            commit_count: '15',
          },
        ],
        rowCount: 1,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.getSprintVelocityVsLoc();

      expect(typeof result[0]?.totalStoryPoints).toBe('number');
      expect(result[0]?.totalStoryPoints).toBe(21);
      expect(typeof result[0]?.totalLocChanged).toBe('number');
      expect(result[0]?.totalLocChanged).toBe(3000);
    });

    it('should throw on invalid start date', async () => {
      const service = new VelocityDataService(mockDb);
      await expect(
        service.getSprintVelocityVsLoc({ startDate: 'bad-date', endDate: '2024-12-31' }),
      ).rejects.toThrow('Invalid start date format');
    });

    it('should throw on invalid end date', async () => {
      const service = new VelocityDataService(mockDb);
      await expect(
        service.getSprintVelocityVsLoc({ startDate: '2024-01-01', endDate: 'bad-date' }),
      ).rejects.toThrow('Invalid end date format');
    });

    it('should use date range query when both dates provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      await service.getSprintVelocityVsLoc({ startDate: '2024-01-01', endDate: '2024-06-30' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('week_start >= $1'),
        ['2024-01-01', '2024-06-30'],
      );
    });

    it('should use team query when team provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      await service.getSprintVelocityVsLoc({ team: 'Engineering' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('team = $1'),
        ['Engineering'],
      );
    });

    it('should use combined query when both date range and team provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      await service.getSprintVelocityVsLoc({
        startDate: '2024-01-01',
        endDate: '2024-06-30',
        team: 'Engineering',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('team = $3'),
        ['2024-01-01', '2024-06-30', 'Engineering'],
      );
    });

    // IQS-920: Repository filter tests
    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      await service.getSprintVelocityVsLoc({ repository: 'gitr' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['gitr'],
      );
    });

    it('should use combined query when date range and repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      await service.getSprintVelocityVsLoc({
        startDate: '2024-01-01',
        endDate: '2024-06-30',
        repository: 'gitr',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $3'),
        ['2024-01-01', '2024-06-30', 'gitr'],
      );
    });

    it('should use combined query when team and repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      await service.getSprintVelocityVsLoc({
        team: 'Engineering',
        repository: 'gitr',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('team = $1'),
        ['Engineering', 'gitr'],
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $2'),
        ['Engineering', 'gitr'],
      );
    });

    it('should use combined query when date range, team, and repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      await service.getSprintVelocityVsLoc({
        startDate: '2024-01-01',
        endDate: '2024-06-30',
        team: 'Engineering',
        repository: 'gitr',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('team = $3'),
        ['2024-01-01', '2024-06-30', 'Engineering', 'gitr'],
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $4'),
        ['2024-01-01', '2024-06-30', 'Engineering', 'gitr'],
      );
    });

    it('should throw on invalid repository name', async () => {
      const service = new VelocityDataService(mockDb);
      await expect(
        service.getSprintVelocityVsLoc({ repository: '<script>alert(1)</script>' }),
      ).rejects.toThrow('Invalid repository name');
    });

    it('should throw on repository name exceeding max length', async () => {
      const service = new VelocityDataService(mockDb);
      const longRepoName = 'a'.repeat(101);
      await expect(
        service.getSprintVelocityVsLoc({ repository: longRepoName }),
      ).rejects.toThrow('Invalid repository name');
    });

    it('should accept valid repository name with special allowed characters', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      await service.getSprintVelocityVsLoc({ repository: 'my-repo_v1.0' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['my-repo_v1.0'],
      );
    });
  });

  describe('getChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.rows).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getSprintVelocityVsLoc
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week_start: '2024-06-10',
            team: 'Eng',
            project: 'test',
            repository: 'repo',
            total_story_points: 13,
            issue_count: 5,
            total_loc_changed: 1500,
            total_lines_added: 900,
            total_lines_deleted: 600,
            commit_count: 12,
          },
        ],
        rowCount: 1,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.weekStart).toBe('2024-06-10');
    });

    it('should return hasData false when view exists but no data', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getSprintVelocityVsLoc
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.rows).toHaveLength(0);
    });

    it('should pass filters to getSprintVelocityVsLoc', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getSprintVelocityVsLoc with filters
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new VelocityDataService(mockDb);
      await service.getChartData({ startDate: '2024-01-01', endDate: '2024-12-31' });

      // Second query should have date filter params
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      const secondCall = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall?.[1]).toEqual(['2024-01-01', '2024-12-31']);
    });
  });
});
