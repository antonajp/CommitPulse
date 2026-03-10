import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { CodeReviewVelocityDataService } from '../../services/code-review-velocity-service.js';
import { CODE_REVIEW_MAX_FILTER_LENGTH } from '../../services/code-review-velocity-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for CodeReviewVelocityDataService (IQS-899).
 * Tests the data service layer for the Code Review Velocity dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - Date validation (reject malformed dates, reversed ranges)
 * - String filter length validation (DoS prevention)
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 * - PR statistics
 * - Average metrics aggregations
 */
describe('CodeReviewVelocityDataService', () => {
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

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getPRStats', () => {
    it('should return PR statistics', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{
          total_prs: 100,
          merged_prs: 80,
          open_prs: 15,
          closed_prs: 5,
          prs_with_reviews: 90,
        }],
        rowCount: 1,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getPRStats();

      expect(result).not.toBeNull();
      expect(result?.totalPRs).toBe(100);
      expect(result?.mergedPRs).toBe(80);
      expect(result?.openPRs).toBe(15);
      expect(result?.closedPRs).toBe(5);
      expect(result?.prsWithReviews).toBe(90);
    });

    it('should return null when no stats available', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getPRStats();

      expect(result).toBeNull();
    });
  });

  describe('getMetrics', () => {
    it('should return mapped code review metrics', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            repository: 'owner/repo',
            pr_number: 123,
            title: 'feat: Add new feature',
            author: 'testuser',
            state: 'merged',
            created_at: new Date('2024-06-01T10:00:00Z'),
            updated_at: new Date('2024-06-05T14:00:00Z'),
            first_review_at: new Date('2024-06-02T09:00:00Z'),
            merged_at: new Date('2024-06-05T14:00:00Z'),
            closed_at: null,
            head_branch: 'feature/IQS-100-new-feature',
            base_branch: 'main',
            additions: 150,
            deletions: 30,
            loc_changed: 180,
            changed_files: 5,
            review_cycles: 1,
            linked_ticket_id: 'IQS-100',
            linked_ticket_type: 'linear',
            hours_to_first_review: 23.0,
            hours_to_merge: 100.0,
            hours_review_to_merge: 77.0,
            size_category: 'S',
            first_reviewer: 'reviewer1',
          },
        ],
        rowCount: 1,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        repository: 'owner/repo',
        prNumber: 123,
        title: 'feat: Add new feature',
        author: 'testuser',
        state: 'merged',
        createdAt: '2024-06-01T10:00:00.000Z',
        updatedAt: '2024-06-05T14:00:00.000Z',
        firstReviewAt: '2024-06-02T09:00:00.000Z',
        mergedAt: '2024-06-05T14:00:00.000Z',
        closedAt: null,
        headBranch: 'feature/IQS-100-new-feature',
        baseBranch: 'main',
        additions: 150,
        deletions: 30,
        locChanged: 180,
        changedFiles: 5,
        reviewCycles: 1,
        linkedTicketId: 'IQS-100',
        linkedTicketType: 'linear',
        hoursToFirstReview: 23.0,
        hoursToMerge: 100.0,
        hoursReviewToMerge: 77.0,
        sizeCategory: 'S',
        firstReviewer: 'reviewer1',
      });
    });

    it('should handle null values for optional fields', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            repository: 'owner/repo',
            pr_number: 124,
            title: 'WIP: Draft PR',
            author: 'testuser',
            state: 'open',
            created_at: new Date('2024-06-10T10:00:00Z'),
            updated_at: new Date('2024-06-10T10:00:00Z'),
            first_review_at: null,
            merged_at: null,
            closed_at: null,
            head_branch: 'draft-branch',
            base_branch: 'main',
            additions: 10,
            deletions: 0,
            loc_changed: 10,
            changed_files: 1,
            review_cycles: 0,
            linked_ticket_id: null,
            linked_ticket_type: null,
            hours_to_first_review: null,
            hours_to_merge: null,
            hours_review_to_merge: null,
            size_category: 'XS',
            first_reviewer: null,
          },
        ],
        rowCount: 1,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.firstReviewAt).toBeNull();
      expect(result[0]?.mergedAt).toBeNull();
      expect(result[0]?.linkedTicketId).toBeNull();
      expect(result[0]?.hoursToFirstReview).toBeNull();
      expect(result[0]?.hoursToMerge).toBeNull();
      expect(result[0]?.firstReviewer).toBeNull();
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result).toHaveLength(0);
    });

    it('should apply default 90-day date range when no filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      await service.getMetrics();

      expect(mockDb.query).toHaveBeenCalledTimes(1);
      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      // Should use date range query with 2 date params
      expect(call?.[1]).toHaveLength(2);
      // Start date should be ~90 days ago
      const startDate = new Date(call?.[1][0] as string);
      const endDate = new Date(call?.[1][1] as string);
      const daysDiff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBe(90);
    });

    it('should throw on invalid start date format', async () => {
      const service = new CodeReviewVelocityDataService(mockDb);
      await expect(
        service.getMetrics({ startDate: 'bad-date', endDate: '2024-12-31' }),
      ).rejects.toThrow('Invalid start date format');
    });

    it('should throw on invalid end date format', async () => {
      const service = new CodeReviewVelocityDataService(mockDb);
      await expect(
        service.getMetrics({ startDate: '2024-01-01', endDate: 'bad-date' }),
      ).rejects.toThrow('Invalid end date format');
    });

    it('should throw on reversed date range', async () => {
      const service = new CodeReviewVelocityDataService(mockDb);
      await expect(
        service.getMetrics({ startDate: '2024-12-31', endDate: '2024-01-01' }),
      ).rejects.toThrow('Invalid date range');
    });

    it('should throw on repository filter exceeding max length', async () => {
      const service = new CodeReviewVelocityDataService(mockDb);
      const longRepo = 'r'.repeat(CODE_REVIEW_MAX_FILTER_LENGTH + 1);
      await expect(
        service.getMetrics({ repository: longRepo }),
      ).rejects.toThrow(`repository exceeds maximum length of ${CODE_REVIEW_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw on author filter exceeding max length', async () => {
      const service = new CodeReviewVelocityDataService(mockDb);
      const longAuthor = 'a'.repeat(CODE_REVIEW_MAX_FILTER_LENGTH + 1);
      await expect(
        service.getMetrics({ author: longAuthor }),
      ).rejects.toThrow(`author exceeds maximum length of ${CODE_REVIEW_MAX_FILTER_LENGTH} characters`);
    });

    it('should use date range query when both dates provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      await service.getMetrics({ startDate: '2024-01-01', endDate: '2024-06-30' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('created_at >= $1'),
        ['2024-01-01', '2024-06-30'],
      );
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      await service.getMetrics({ repository: 'owner/repo', startDate: '2024-01-01', endDate: '2024-06-30' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $3 OR $3 IS NULL'),
        ['2024-01-01', '2024-06-30', 'owner/repo', null, null],
      );
    });

    it('should use author query when author provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      await service.getMetrics({ author: 'testuser', startDate: '2024-01-01', endDate: '2024-06-30' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('author = $4 OR $4 IS NULL'),
        ['2024-01-01', '2024-06-30', null, 'testuser', null],
      );
    });

    it('should use size category query when sizeCategory provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      await service.getMetrics({ sizeCategory: 'L', startDate: '2024-01-01', endDate: '2024-06-30' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('size_category = $5 OR $5 IS NULL'),
        ['2024-01-01', '2024-06-30', null, null, 'L'],
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      await service.getMetrics({
        startDate: '2024-01-01',
        endDate: '2024-06-30',
        repository: 'owner/repo',
        author: 'testuser',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $3 OR $3 IS NULL'),
        ['2024-01-01', '2024-06-30', 'owner/repo', 'testuser', null],
      );
    });
  });

  describe('getAvgMetricsByRepository', () => {
    it('should return average metrics by repository', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            repository: 'owner/repo1',
            pr_count: 50,
            avg_hours_to_first_review: 12.5,
            avg_hours_to_merge: 48.0,
            avg_review_cycles: 1.2,
            avg_loc_changed: 150,
          },
          {
            repository: 'owner/repo2',
            pr_count: 30,
            avg_hours_to_first_review: 8.0,
            avg_hours_to_merge: 24.0,
            avg_review_cycles: 0.8,
            avg_loc_changed: 80,
          },
        ],
        rowCount: 2,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getAvgMetricsByRepository();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        repository: 'owner/repo1',
        prCount: 50,
        avgHoursToFirstReview: 12.5,
        avgHoursToMerge: 48.0,
        avgReviewCycles: 1.2,
        avgLocChanged: 150,
      });
    });
  });

  describe('getAvgMetricsByAuthor', () => {
    it('should return average metrics by author', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user1',
            pr_count: 20,
            avg_hours_to_first_review: 10.0,
            avg_hours_to_merge: 36.0,
            avg_review_cycles: 1.0,
            avg_loc_changed: 120,
          },
        ],
        rowCount: 1,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getAvgMetricsByAuthor();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        author: 'user1',
        prCount: 20,
        avgHoursToFirstReview: 10.0,
        avgHoursToMerge: 36.0,
        avgReviewCycles: 1.0,
        avgLocChanged: 120,
      });
    });
  });

  describe('getAvgMetricsBySize', () => {
    it('should return average metrics by size category', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            size_category: 'XS',
            pr_count: 100,
            avg_hours_to_first_review: 4.0,
            avg_hours_to_merge: 8.0,
            avg_review_cycles: 0.2,
            avg_loc_changed: 25,
          },
          {
            size_category: 'S',
            pr_count: 80,
            avg_hours_to_first_review: 8.0,
            avg_hours_to_merge: 16.0,
            avg_review_cycles: 0.5,
            avg_loc_changed: 100,
          },
          {
            size_category: 'M',
            pr_count: 50,
            avg_hours_to_first_review: 12.0,
            avg_hours_to_merge: 32.0,
            avg_review_cycles: 1.0,
            avg_loc_changed: 300,
          },
          {
            size_category: 'L',
            pr_count: 20,
            avg_hours_to_first_review: 24.0,
            avg_hours_to_merge: 72.0,
            avg_review_cycles: 2.0,
            avg_loc_changed: 700,
          },
          {
            size_category: 'XL',
            pr_count: 5,
            avg_hours_to_first_review: 48.0,
            avg_hours_to_merge: 120.0,
            avg_review_cycles: 3.5,
            avg_loc_changed: 1500,
          },
        ],
        rowCount: 5,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getAvgMetricsBySize();

      expect(result).toHaveLength(5);
      expect(result[0]?.sizeCategory).toBe('XS');
      expect(result[4]?.sizeCategory).toBe('XL');
      // Verify XL has longest review times
      expect(result[4]?.avgHoursToFirstReview).toBe(48.0);
      expect(result[4]?.avgReviewCycles).toBe(3.5);
    });
  });

  describe('getChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
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
      // 2. getMetrics
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            repository: 'owner/repo',
            pr_number: 123,
            title: 'feat: Add feature',
            author: 'testuser',
            state: 'merged',
            created_at: new Date('2024-06-01T10:00:00Z'),
            updated_at: new Date('2024-06-05T14:00:00Z'),
            first_review_at: new Date('2024-06-02T09:00:00Z'),
            merged_at: new Date('2024-06-05T14:00:00Z'),
            closed_at: null,
            head_branch: 'feature-branch',
            base_branch: 'main',
            additions: 100,
            deletions: 20,
            loc_changed: 120,
            changed_files: 4,
            review_cycles: 1,
            linked_ticket_id: 'IQS-100',
            linked_ticket_type: 'linear',
            hours_to_first_review: 23.0,
            hours_to_merge: 100.0,
            hours_review_to_merge: 77.0,
            size_category: 'S',
            first_reviewer: 'reviewer1',
          },
        ],
        rowCount: 1,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.prNumber).toBe(123);
    });

    it('should return hasData false when view exists but no data', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getMetrics
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(true);
      expect(result.rows).toHaveLength(0);
    });

    it('should pass filters to getMetrics', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getMetrics with filters
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      await service.getChartData({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        repository: 'owner/repo',
      });

      // Second query should have combined filter params
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      const secondCall = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall?.[1]).toEqual(['2024-01-01', '2024-12-31', 'owner/repo', null, null]);
    });
  });

  describe('getMergedPRMetrics', () => {
    it('should return only merged PRs', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            repository: 'owner/repo',
            pr_number: 123,
            title: 'Merged PR',
            author: 'testuser',
            state: 'merged',
            created_at: new Date('2024-06-01T10:00:00Z'),
            updated_at: new Date('2024-06-05T14:00:00Z'),
            first_review_at: new Date('2024-06-02T09:00:00Z'),
            merged_at: new Date('2024-06-05T14:00:00Z'),
            closed_at: null,
            head_branch: 'feature-branch',
            base_branch: 'main',
            additions: 100,
            deletions: 20,
            loc_changed: 120,
            changed_files: 4,
            review_cycles: 1,
            linked_ticket_id: null,
            linked_ticket_type: null,
            hours_to_first_review: 23.0,
            hours_to_merge: 100.0,
            hours_review_to_merge: 77.0,
            size_category: 'S',
            first_reviewer: 'reviewer1',
          },
        ],
        rowCount: 1,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      const result = await service.getMergedPRMetrics();

      expect(result).toHaveLength(1);
      expect(result[0]?.state).toBe('merged');

      // Verify query contains state = 'merged' filter
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("state = 'merged'"),
        [null, null],
      );
    });

    it('should pass date filters', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CodeReviewVelocityDataService(mockDb);
      await service.getMergedPRMetrics({
        startDate: '2024-01-01',
        endDate: '2024-06-30',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("state = 'merged'"),
        ['2024-01-01', '2024-06-30'],
      );
    });
  });
});
