import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DevPipelineDataService } from '../../services/dev-pipeline-data-service.js';
import { DEV_PIPELINE_MAX_FILTER_LENGTH } from '../../services/dev-pipeline-data-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for DevPipelineDataService (IQS-896).
 * Tests the data service layer for the Development Pipeline dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - Date validation (reject malformed dates, reversed ranges)
 * - String filter length validation (DoS prevention)
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 * - Primary ticket ID extraction
 */
describe('DevPipelineDataService', () => {
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

      const service = new DevPipelineDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getBaselineStats', () => {
    it('should return baseline population statistics', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{
          total_commits: 100,
          commits_with_baseline: 85,
          baseline_coverage_ratio: 0.85,
        }],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getBaselineStats();

      expect(result).not.toBeNull();
      expect(result?.total_commits).toBe(100);
      expect(result?.commits_with_baseline).toBe(85);
      expect(result?.baseline_coverage_ratio).toBeCloseTo(0.85);
    });

    it('should return null when no stats available', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getBaselineStats();

      expect(result).toBeNull();
    });
  });

  describe('getDevPipelineMetrics', () => {
    it('should return mapped delta data points', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: '2024-06-10',
            author: 'testuser',
            branch: 'main',
            repository: 'gitr',
            commit_message: 'feat: Add new feature\n\nDetailed description',
            is_merge: false,
            full_name: 'Test User',
            team: 'Engineering',
            ticket_id: 'IQS-100',
            ticket_project: 'gitrx',
            ticket_type: 'Linear',
            complexity_delta: 15,
            loc_delta: 250,
            comments_delta: 10,
            tests_delta: 50,
            file_count: 5,
            test_file_count: 2,
            baseline_sha: 'def456',
            total_complexity: 100,
            total_code_lines: 1000,
            total_comment_lines: 150,
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        sha: 'abc123',
        commitDate: '2024-06-10',
        author: 'testuser',
        branch: 'main',
        repository: 'gitr',
        commitMessageSummary: 'feat: Add new feature',
        fullName: 'Test User',
        team: 'Engineering',
        ticketId: 'IQS-100',
        ticketProject: 'gitrx',
        ticketType: 'Linear',
        complexityDelta: 15,
        locDelta: 250,
        commentsDelta: 10,
        testsDelta: 50,
        fileCount: 5,
        testFileCount: 2,
        baselineSha: 'def456',
        totalComplexity: 100,
        totalCodeLines: 1000,
        totalCommentLines: 150,
      });
    });

    it('should handle Date objects in commit_date column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: new Date('2024-06-10T00:00:00Z'),
            author: 'testuser',
            branch: null,
            repository: 'gitr',
            commit_message: null,
            is_merge: false,
            full_name: null,
            team: null,
            ticket_id: null,
            ticket_project: null,
            ticket_type: null,
            complexity_delta: 0,
            loc_delta: 100,
            comments_delta: 0,
            tests_delta: 0,
            file_count: 3,
            test_file_count: 0,
            baseline_sha: null,
            total_complexity: 50,
            total_code_lines: 500,
            total_comment_lines: 50,
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.commitDate).toBe('2024-06-10');
      expect(result[0]?.branch).toBeNull();
      expect(result[0]?.team).toBeNull();
      expect(result[0]?.ticketId).toBeNull();
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result).toHaveLength(0);
    });

    it('should apply default 3-week date range when no filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      await service.getDevPipelineMetrics();

      expect(mockDb.query).toHaveBeenCalledTimes(1);
      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      // Should use date range query with 2 date params
      expect(call?.[1]).toHaveLength(2);
      // Start date should be ~21 days ago
      const startDate = new Date(call?.[1][0] as string);
      const endDate = new Date(call?.[1][1] as string);
      const daysDiff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBe(21);
    });

    it('should throw on invalid start date format', async () => {
      const service = new DevPipelineDataService(mockDb);
      await expect(
        service.getDevPipelineMetrics({ startDate: 'bad-date', endDate: '2024-12-31' }),
      ).rejects.toThrow('Invalid start date format');
    });

    it('should throw on invalid end date format', async () => {
      const service = new DevPipelineDataService(mockDb);
      await expect(
        service.getDevPipelineMetrics({ startDate: '2024-01-01', endDate: 'bad-date' }),
      ).rejects.toThrow('Invalid end date format');
    });

    it('should throw on invalid date (e.g., 2024-02-30)', async () => {
      const service = new DevPipelineDataService(mockDb);
      await expect(
        service.getDevPipelineMetrics({ startDate: '2024-02-30', endDate: '2024-12-31' }),
      ).rejects.toThrow('Invalid start date format');
    });

    it('should throw on reversed date range', async () => {
      const service = new DevPipelineDataService(mockDb);
      await expect(
        service.getDevPipelineMetrics({ startDate: '2024-12-31', endDate: '2024-01-01' }),
      ).rejects.toThrow('Invalid date range');
    });

    it('should throw on team filter exceeding max length', async () => {
      const service = new DevPipelineDataService(mockDb);
      const longTeam = 'a'.repeat(DEV_PIPELINE_MAX_FILTER_LENGTH + 1);
      await expect(
        service.getDevPipelineMetrics({ team: longTeam }),
      ).rejects.toThrow(`team exceeds maximum length of ${DEV_PIPELINE_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw on repository filter exceeding max length', async () => {
      const service = new DevPipelineDataService(mockDb);
      const longRepo = 'r'.repeat(DEV_PIPELINE_MAX_FILTER_LENGTH + 1);
      await expect(
        service.getDevPipelineMetrics({ repository: longRepo }),
      ).rejects.toThrow(`repository exceeds maximum length of ${DEV_PIPELINE_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw on ticketId filter exceeding max length', async () => {
      const service = new DevPipelineDataService(mockDb);
      const longTicketId = 'T'.repeat(DEV_PIPELINE_MAX_FILTER_LENGTH + 1);
      await expect(
        service.getDevPipelineMetrics({ ticketId: longTicketId }),
      ).rejects.toThrow(`ticketId exceeds maximum length of ${DEV_PIPELINE_MAX_FILTER_LENGTH} characters`);
    });

    it('should use date range query when both dates provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      await service.getDevPipelineMetrics({ startDate: '2024-01-01', endDate: '2024-06-30' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('commit_date >= $1'),
        ['2024-01-01', '2024-06-30'],
      );
    });

    it('should use team query when team provided with explicit date range', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      // When only team is provided, default date range is applied, so use combined query
      await service.getDevPipelineMetrics({ team: 'Engineering', startDate: '2024-01-01', endDate: '2024-06-30' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('team = $3 OR $3 IS NULL'),
        ['2024-01-01', '2024-06-30', 'Engineering', null],
      );
    });

    it('should use repository query when repository provided with explicit date range', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      // When only repository is provided, default date range is applied, so use combined query
      await service.getDevPipelineMetrics({ repository: 'gitr', startDate: '2024-01-01', endDate: '2024-06-30' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $4 OR $4 IS NULL'),
        ['2024-01-01', '2024-06-30', null, 'gitr'],
      );
    });

    it('should use ticket query when ticketId provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      await service.getDevPipelineMetrics({ ticketId: 'IQS-123' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ticket_id = $1'),
        ['IQS-123'],
      );
    });

    it('should use combined query when date range and team provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      await service.getDevPipelineMetrics({
        startDate: '2024-01-01',
        endDate: '2024-06-30',
        team: 'Engineering',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('team = $3 OR $3 IS NULL'),
        ['2024-01-01', '2024-06-30', 'Engineering', null],
      );
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: '2024-06-10',
            author: 'testuser',
            branch: 'main',
            repository: 'gitr',
            commit_message: 'fix: bug fix',
            is_merge: false,
            full_name: 'Test User',
            team: 'Eng',
            ticket_id: 'IQS-100',
            ticket_project: 'gitrx',
            ticket_type: 'Linear',
            complexity_delta: '25',
            loc_delta: '300',
            comments_delta: '15',
            tests_delta: '75',
            file_count: '8',
            test_file_count: '3',
            baseline_sha: 'def456',
            total_complexity: '120',
            total_code_lines: '1200',
            total_comment_lines: '180',
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(typeof result[0]?.complexityDelta).toBe('number');
      expect(result[0]?.complexityDelta).toBe(25);
      expect(typeof result[0]?.locDelta).toBe('number');
      expect(result[0]?.locDelta).toBe(300);
      expect(typeof result[0]?.fileCount).toBe('number');
      expect(result[0]?.fileCount).toBe(8);
    });
  });

  describe('getDevPipelineMetricsByTicket', () => {
    it('should return aggregated data by ticket', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'IQS-100',
            ticket_project: 'gitrx',
            ticket_type: 'Linear',
            team: 'Engineering',
            repository: 'gitr',
            commit_count: 5,
            total_complexity_delta: 50,
            total_loc_delta: 1000,
            total_comments_delta: 100,
            total_tests_delta: 200,
            total_file_count: 25,
            total_test_file_count: 10,
            first_commit_date: '2024-06-01',
            last_commit_date: '2024-06-10',
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getDevPipelineMetricsByTicket();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        ticketId: 'IQS-100',
        ticketProject: 'gitrx',
        ticketType: 'Linear',
        team: 'Engineering',
        repository: 'gitr',
        commitCount: 5,
        totalComplexityDelta: 50,
        totalLocDelta: 1000,
        totalCommentsDelta: 100,
        totalTestsDelta: 200,
        totalFileCount: 25,
        totalTestFileCount: 10,
        firstCommitDate: '2024-06-01',
        lastCommitDate: '2024-06-10',
      });
    });

    it('should pass date filters to query', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      await service.getDevPipelineMetricsByTicket({
        startDate: '2024-01-01',
        endDate: '2024-06-30',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('commit_date >= $1'),
        ['2024-01-01', '2024-06-30'],
      );
    });
  });

  describe('getDevPipelineMetricsByAuthor', () => {
    it('should return aggregated data by author', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'testuser',
            full_name: 'Test User',
            team: 'Engineering',
            commit_count: 20,
            ticket_count: 8,
            total_complexity_delta: 100,
            total_loc_delta: 2000,
            total_comments_delta: 200,
            total_tests_delta: 400,
            total_file_count: 50,
            total_test_file_count: 20,
            first_commit_date: '2024-01-15',
            last_commit_date: '2024-06-20',
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getDevPipelineMetricsByAuthor();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        author: 'testuser',
        fullName: 'Test User',
        team: 'Engineering',
        commitCount: 20,
        ticketCount: 8,
        totalComplexityDelta: 100,
        totalLocDelta: 2000,
        totalCommentsDelta: 200,
        totalTestsDelta: 400,
        totalFileCount: 50,
        totalTestFileCount: 20,
        firstCommitDate: '2024-01-15',
        lastCommitDate: '2024-06-20',
      });
    });
  });

  describe('getChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.rows).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getDevPipelineMetrics
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: '2024-06-10',
            author: 'testuser',
            branch: 'main',
            repository: 'gitr',
            commit_message: 'feat: Add new feature',
            is_merge: false,
            full_name: 'Test User',
            team: 'Engineering',
            ticket_id: 'IQS-100',
            ticket_project: 'gitrx',
            ticket_type: 'Linear',
            complexity_delta: 15,
            loc_delta: 250,
            comments_delta: 10,
            tests_delta: 50,
            file_count: 5,
            test_file_count: 2,
            baseline_sha: 'def456',
            total_complexity: 100,
            total_code_lines: 1000,
            total_comment_lines: 150,
          },
        ],
        rowCount: 1,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.sha).toBe('abc123');
    });

    it('should return hasData false when view exists but no data', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getDevPipelineMetrics
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(true);
      expect(result.rows).toHaveLength(0);
    });

    it('should pass filters to getDevPipelineMetrics', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getDevPipelineMetrics with filters
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DevPipelineDataService(mockDb);
      await service.getChartData({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        team: 'Engineering',
      });

      // Second query should have combined filter params
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      const secondCall = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall?.[1]).toEqual(['2024-01-01', '2024-12-31', 'Engineering', null]);
    });
  });
});
