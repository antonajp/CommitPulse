import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StoryPointsTrendDataService } from '../../services/story-points-trend-data-service.js';
import { DatabaseService } from '../../database/database-service.js';
import { LoggerService } from '../../logging/logger.js';
import type { StoryPointsTrendPoint } from '../../services/story-points-trend-data-types.js';

/**
 * Unit tests for StoryPointsTrendDataService (IQS-940).
 * Tests the data service with mocked database queries.
 */
describe('StoryPointsTrendDataService', () => {
  let mockDb: DatabaseService;
  let service: StoryPointsTrendDataService;

  const mockTrendRows = [
    {
      transition_date: '2025-01-01',
      status_category: 'Development',
      total_story_points: 21,
      ticket_count: 5,
    },
    {
      transition_date: '2025-01-01',
      status_category: 'QA',
      total_story_points: 13,
      ticket_count: 3,
    },
    {
      transition_date: '2025-01-02',
      status_category: 'Development',
      total_story_points: 34,
      ticket_count: 8,
    },
    {
      transition_date: '2025-01-02',
      status_category: 'QA',
      total_story_points: 8,
      ticket_count: 2,
    },
  ];

  beforeEach(() => {
    // Clean up logger
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Create mock database service
    mockDb = {
      query: vi.fn(),
      initialize: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as DatabaseService;

    service = new StoryPointsTrendDataService(mockDb);
  });

  afterEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    vi.clearAllMocks();
  });

  describe('checkDataExists', () => {
    it('should return true when jira_history has status data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ data_exists: true }],
      });

      const exists = await service.checkDataExists();
      expect(exists).toBe(true);
    });

    it('should return false when jira_history has no status data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ data_exists: false }],
      });

      const exists = await service.checkDataExists();
      expect(exists).toBe(false);
    });

    it('should return false on query error', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection failed'));

      const exists = await service.checkDataExists();
      expect(exists).toBe(false);
    });
  });

  describe('getTeams', () => {
    it('should return distinct team names', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ team: 'Platform' }, { team: 'Frontend' }, { team: 'Backend' }],
      });

      const result = await service.getTeams();
      expect(result.teams).toEqual(['Platform', 'Frontend', 'Backend']);
    });

    it('should return empty array on error', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Query failed'));

      const result = await service.getTeams();
      expect(result.teams).toEqual([]);
    });
  });

  describe('getStoryPointsTrend', () => {
    it('should return trend data points', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: mockTrendRows,
      });

      const rows = await service.getStoryPointsTrend();

      expect(rows).toHaveLength(4);
      expect(rows[0]).toEqual({
        transitionDate: '2025-01-01',
        statusCategory: 'Development',
        totalStoryPoints: 21,
        ticketCount: 5,
      });
    });

    it('should use default 30 days when no filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await service.getStoryPointsTrend();

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('daily_status_transitions'),
        expect.arrayContaining([expect.any(String), expect.any(String)]),
      );
    });

    it('should filter by team when provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await service.getStoryPointsTrend({ team: 'Platform' });

      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('team_jira_keys');
      expect(call[1]).toContain('Platform');
    });

    it('should reject invalid start date format', async () => {
      await expect(
        service.getStoryPointsTrend({ startDate: 'invalid-date', endDate: '2025-01-31' }),
      ).rejects.toThrow('Invalid start date format');
    });

    it('should reject invalid end date format', async () => {
      await expect(
        service.getStoryPointsTrend({ startDate: '2025-01-01', endDate: 'not-a-date' }),
      ).rejects.toThrow('Invalid end date format');
    });

    it('should reject invalid team name', async () => {
      await expect(
        service.getStoryPointsTrend({ team: '<script>alert(1)</script>' }),
      ).rejects.toThrow('Invalid team name');
    });

    it('should handle Date objects from database', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{
          transition_date: new Date('2025-01-15T00:00:00Z'),
          status_category: 'Development',
          total_story_points: 13,
          ticket_count: 3,
        }],
      });

      const rows = await service.getStoryPointsTrend();

      expect(rows[0]?.transitionDate).toBe('2025-01-15');
    });
  });

  describe('getChartData', () => {
    it('should return empty data when no jira history exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ data_exists: false }],
      });

      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.rows).toHaveLength(0);
    });

    it('should return full chart data when data exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ data_exists: true }] })
        .mockResolvedValueOnce({ rows: mockTrendRows });

      const result = await service.getChartData();

      expect(result.hasData).toBe(true);
      expect(result.rows).toHaveLength(4);
    });
  });
});
