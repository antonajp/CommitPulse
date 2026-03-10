import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DeveloperFocusDataService } from '../../services/developer-focus-service.js';
import { FOCUS_MAX_FILTER_LENGTH } from '../../services/developer-focus-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for DeveloperFocusDataService (IQS-907).
 * Tests the data service layer for the Developer Focus Score dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - Focus category validation
 * - Date filter validation
 * - String filter length validation (DoS prevention)
 * - Focus score calculation mapping
 * - Focus category assignment
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 * - Trend data building
 * - Team summary statistics
 */
describe('DeveloperFocusDataService', () => {
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

  describe('checkFocusViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.checkFocusViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.checkFocusViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.checkFocusViewExists();

      expect(result).toBe(false);
    });
  });

  describe('checkDailyActivityViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.checkDailyActivityViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.checkDailyActivityViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getFocusScores', () => {
    it('should return mapped focus data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user1@example.com',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 15,
            total_unique_tickets: 3,
            total_unique_files: 20,
            total_loc: 500,
            active_days: 5,
            avg_tickets_per_day: 0.6,
            focus_score: 91.0,
            loc_per_commit: 33.33,
            commits_per_ticket: 5.0,
            focus_category: 'deep_focus',
            focus_score_delta: 5.0,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        author: 'user1@example.com',
        weekStart: '2024-06-10T00:00:00Z',
        totalCommits: 15,
        totalUniqueTickets: 3,
        totalUniqueFiles: 20,
        totalLoc: 500,
        activeDays: 5,
        avgTicketsPerDay: 0.6,
        focusScore: 91.0,
        locPerCommit: 33.33,
        commitsPerTicket: 5.0,
        focusCategory: 'deep_focus',
        focusScoreDelta: 5.0,
      });
    });

    it('should handle Date objects in week_start column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user2@example.com',
            week_start: new Date('2024-06-17T00:00:00Z'),
            total_commits: 10,
            total_unique_tickets: 5,
            total_unique_files: 15,
            total_loc: 300,
            active_days: 4,
            avg_tickets_per_day: 1.25,
            focus_score: 81.25,
            loc_per_commit: 30.0,
            commits_per_ticket: 2.0,
            focus_category: 'deep_focus',
            focus_score_delta: null,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result).toHaveLength(1);
      expect(result[0]?.weekStart).toBe('2024-06-17T00:00:00.000Z');
    });

    it('should handle null focus_score_delta for first week', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user3@example.com',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 8,
            total_unique_tickets: 2,
            total_unique_files: 10,
            total_loc: 200,
            active_days: 3,
            avg_tickets_per_day: 0.67,
            focus_score: 90.0,
            loc_per_commit: 25.0,
            commits_per_ticket: 4.0,
            focus_category: 'deep_focus',
            focus_score_delta: null,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result).toHaveLength(1);
      expect(result[0]?.focusScoreDelta).toBeNull();
    });

    it('should handle different focus categories', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user4@example.com',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 20,
            total_unique_tickets: 8,
            total_unique_files: 30,
            total_loc: 800,
            active_days: 5,
            avg_tickets_per_day: 1.6,
            focus_score: 76.0,
            loc_per_commit: 40.0,
            commits_per_ticket: 2.5,
            focus_category: 'moderate_focus',
            focus_score_delta: -5.0,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result).toHaveLength(1);
      expect(result[0]?.focusCategory).toBe('moderate_focus');
    });

    it('should handle fragmented focus category', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user5@example.com',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 25,
            total_unique_tickets: 12,
            total_unique_files: 40,
            total_loc: 1000,
            active_days: 5,
            avg_tickets_per_day: 2.4,
            focus_score: 64.0,
            loc_per_commit: 40.0,
            commits_per_ticket: 2.08,
            focus_category: 'fragmented',
            focus_score_delta: -10.0,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result).toHaveLength(1);
      expect(result[0]?.focusCategory).toBe('fragmented');
    });

    it('should handle highly_fragmented focus category', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user6@example.com',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 30,
            total_unique_tickets: 20,
            total_unique_files: 50,
            total_loc: 1500,
            active_days: 5,
            avg_tickets_per_day: 4.0,
            focus_score: 40.0,
            loc_per_commit: 50.0,
            commits_per_ticket: 1.5,
            focus_category: 'highly_fragmented',
            focus_score_delta: -20.0,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result).toHaveLength(1);
      expect(result[0]?.focusCategory).toBe('highly_fragmented');
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result).toHaveLength(0);
    });

    it('should use date range query when startDate and endDate provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      await service.getFocusScores({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('week_start >= $1::TIMESTAMP'),
        ['2024-06-01', '2024-06-30'],
      );
    });

    it('should use author query when author provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      await service.getFocusScores({ author: 'user1@example.com' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(author) = LOWER($1)'),
        ['user1@example.com'],
      );
    });

    it('should use focus category query when focusCategory provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      await service.getFocusScores({ focusCategory: 'deep_focus' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('focus_category = $1'),
        ['deep_focus'],
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      await service.getFocusScores({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        author: 'user1@example.com',
        focusCategory: 'moderate_focus',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('(week_start >= $1::TIMESTAMP OR $1 IS NULL)'),
        ['2024-06-01', '2024-06-30', 'user1@example.com', 'moderate_focus'],
      );
    });

    it('should throw on author filter exceeding max length', async () => {
      const service = new DeveloperFocusDataService(mockDb);
      const longAuthor = 'a'.repeat(FOCUS_MAX_FILTER_LENGTH + 1);

      await expect(
        service.getFocusScores({ author: longAuthor }),
      ).rejects.toThrow(`author exceeds maximum length of ${FOCUS_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw on invalid focus category', async () => {
      const service = new DeveloperFocusDataService(mockDb);

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.getFocusScores({ focusCategory: 'invalid_category' as any }),
      ).rejects.toThrow('Invalid focus category: invalid_category');
    });

    it('should throw on invalid date format', async () => {
      const service = new DeveloperFocusDataService(mockDb);

      await expect(
        service.getFocusScores({ startDate: 'not-a-date' }),
      ).rejects.toThrow('Invalid date format for startDate: not-a-date');
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user7@example.com',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: '12',
            total_unique_tickets: '3',
            total_unique_files: '18',
            total_loc: '400',
            active_days: '4',
            avg_tickets_per_day: '0.75',
            focus_score: '88.75',
            loc_per_commit: '33.33',
            commits_per_ticket: '4.0',
            focus_category: 'deep_focus',
            focus_score_delta: '3.0',
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(typeof result[0]?.focusScore).toBe('number');
      expect(result[0]?.focusScore).toBe(88.75);
      expect(typeof result[0]?.totalCommits).toBe('number');
      expect(result[0]?.totalCommits).toBe(12);
    });
  });

  describe('getDailyActivities', () => {
    it('should return mapped daily activity data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user1@example.com',
            commit_day: '2024-06-15',
            repository: 'repo1',
            commit_count: 5,
            unique_tickets: 2,
            unique_files: 10,
            total_loc_changed: 150,
            ticket_switches: 2,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getDailyActivities();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        author: 'user1@example.com',
        commitDay: '2024-06-15',
        repository: 'repo1',
        commitCount: 5,
        uniqueTickets: 2,
        uniqueFiles: 10,
        totalLocChanged: 150,
        ticketSwitches: 2,
      });
    });

    it('should handle Date objects in commit_day column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user2@example.com',
            commit_day: new Date('2024-06-16T00:00:00Z'),
            repository: 'repo2',
            commit_count: 3,
            unique_tickets: 1,
            unique_files: 5,
            total_loc_changed: 80,
            ticket_switches: 1,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getDailyActivities();

      expect(result).toHaveLength(1);
      expect(result[0]?.commitDay).toBe('2024-06-16');
    });

    it('should filter by date range', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      await service.getDailyActivities({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('commit_day >= $1::DATE'),
        ['2024-06-01', '2024-06-30'],
      );
    });

    it('should filter by author', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      await service.getDailyActivities({ author: 'user1@example.com' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(author) = LOWER($1)'),
        ['user1@example.com'],
      );
    });
  });

  describe('getFocusTrends', () => {
    it('should build trend data from multiple weeks', async () => {
      // Trend query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { author: 'user1', week_start: '2024-06-10T00:00:00Z', focus_score: 85 },
          { author: 'user1', week_start: '2024-06-17T00:00:00Z', focus_score: 90 },
          { author: 'user2', week_start: '2024-06-10T00:00:00Z', focus_score: 70 },
          { author: 'user2', week_start: '2024-06-17T00:00:00Z', focus_score: 75 },
        ],
        rowCount: 4,
      });

      // Team average query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { week_start: '2024-06-10T00:00:00Z', team_avg_focus_score: 77.5 },
          { week_start: '2024-06-17T00:00:00Z', team_avg_focus_score: 82.5 },
        ],
        rowCount: 2,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusTrends();

      expect(result.weeks).toHaveLength(2);
      expect(result.developers).toHaveLength(2);
      expect(result.teamAvgByWeek).toHaveLength(2);
      expect(result.overallTeamAvg).toBe(80);

      // Check developer trends
      const user1 = result.developers.find(d => d.name === 'user1');
      expect(user1?.scores).toEqual([85, 90]);
      expect(user1?.avgScore).toBe(87.5);

      const user2 = result.developers.find(d => d.name === 'user2');
      expect(user2?.scores).toEqual([70, 75]);
      expect(user2?.avgScore).toBe(72.5);
    });

    it('should handle empty trend data', async () => {
      // Trend query - empty
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // Team average query - empty
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusTrends();

      expect(result.weeks).toHaveLength(0);
      expect(result.developers).toHaveLength(0);
      expect(result.teamAvgByWeek).toHaveLength(0);
      expect(result.overallTeamAvg).toBe(0);
    });
  });

  describe('getTeamSummary', () => {
    it('should return team summary statistics', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            avg_focus_score: 78.5,
            deep_focus_count: 3,
            moderate_focus_count: 5,
            fragmented_count: 2,
            highly_fragmented_count: 1,
            total_developers: 11,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getTeamSummary();

      expect(result).toEqual({
        avgFocusScore: 78.5,
        deepFocusCount: 3,
        moderateFocusCount: 5,
        fragmentedCount: 2,
        highlyFragmentedCount: 1,
        totalDevelopers: 11,
      });
    });

    it('should handle empty summary result', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getTeamSummary();

      expect(result).toEqual({
        avgFocusScore: 0,
        deepFocusCount: 0,
        moderateFocusCount: 0,
        fragmentedCount: 0,
        highlyFragmentedCount: 0,
        totalDevelopers: 0,
      });
    });

    it('should handle null avg_focus_score', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            avg_focus_score: null,
            deep_focus_count: 0,
            moderate_focus_count: 0,
            fragmented_count: 0,
            highly_fragmented_count: 0,
            total_developers: 0,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getTeamSummary();

      expect(result.avgFocusScore).toBe(0);
    });
  });

  describe('getChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.focusData).toHaveLength(0);
      expect(result.trends.developers).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // View existence check
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // Focus scores query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user1@example.com',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 15,
            total_unique_tickets: 3,
            total_unique_files: 20,
            total_loc: 500,
            active_days: 5,
            avg_tickets_per_day: 0.6,
            focus_score: 91.0,
            loc_per_commit: 33.33,
            commits_per_ticket: 5.0,
            focus_category: 'deep_focus',
            focus_score_delta: null,
          },
        ],
        rowCount: 1,
      });

      // Trend query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { author: 'user1@example.com', week_start: '2024-06-10T00:00:00Z', focus_score: 91 },
        ],
        rowCount: 1,
      });

      // Team average query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { week_start: '2024-06-10T00:00:00Z', team_avg_focus_score: 91 },
        ],
        rowCount: 1,
      });

      // Team summary query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            avg_focus_score: 91.0,
            deep_focus_count: 1,
            moderate_focus_count: 0,
            fragmented_count: 0,
            highly_fragmented_count: 0,
            total_developers: 1,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.focusData).toHaveLength(1);
      expect(result.trends.developers).toHaveLength(1);
      expect(result.teamSummary.totalDevelopers).toBe(1);
    });

    it('should return hasData false when view exists but no data', async () => {
      // View existence check
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // All subsequent queries return empty
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [],
        rowCount: 0,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(true);
      expect(result.focusData).toHaveLength(0);
    });
  });

  describe('getDailyActivityChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getDailyActivityChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.activities).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // View existence check
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // Daily activity query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'user1@example.com',
            commit_day: '2024-06-15',
            repository: 'repo1',
            commit_count: 5,
            unique_tickets: 2,
            unique_files: 10,
            total_loc_changed: 150,
            ticket_switches: 2,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getDailyActivityChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.activities).toHaveLength(1);
      expect(result.activities[0]?.author).toBe('user1@example.com');
    });
  });

  describe('focus score calculation', () => {
    it('should correctly calculate focus score for minimal context switching', async () => {
      // Focus score = 100 - (avg_tickets_per_day * 15)
      // For avg_tickets_per_day = 0.5: 100 - (0.5 * 15) = 92.5 -> deep_focus
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'focused_dev',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 10,
            total_unique_tickets: 2,
            total_unique_files: 15,
            total_loc: 300,
            active_days: 4,
            avg_tickets_per_day: 0.5,
            focus_score: 92.5,
            loc_per_commit: 30.0,
            commits_per_ticket: 5.0,
            focus_category: 'deep_focus',
            focus_score_delta: null,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result[0]?.focusScore).toBe(92.5);
      expect(result[0]?.focusCategory).toBe('deep_focus');
    });

    it('should correctly calculate focus score for high context switching', async () => {
      // For avg_tickets_per_day = 5: 100 - (5 * 15) = 25 -> highly_fragmented
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'fragmented_dev',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 25,
            total_unique_tickets: 25,
            total_unique_files: 50,
            total_loc: 1500,
            active_days: 5,
            avg_tickets_per_day: 5.0,
            focus_score: 25.0,
            loc_per_commit: 60.0,
            commits_per_ticket: 1.0,
            focus_category: 'highly_fragmented',
            focus_score_delta: -30.0,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result[0]?.focusScore).toBe(25.0);
      expect(result[0]?.focusCategory).toBe('highly_fragmented');
    });

    it('should handle zero tickets (max focus)', async () => {
      // For avg_tickets_per_day = 0: 100 - (0 * 15) = 100 -> deep_focus
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'refactor_dev',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 5,
            total_unique_tickets: 0,
            total_unique_files: 10,
            total_loc: 100,
            active_days: 2,
            avg_tickets_per_day: 0,
            focus_score: 100,
            loc_per_commit: 20.0,
            commits_per_ticket: 5.0,
            focus_category: 'deep_focus',
            focus_score_delta: 10.0,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result[0]?.focusScore).toBe(100);
      expect(result[0]?.focusCategory).toBe('deep_focus');
    });
  });

  describe('focus category boundaries', () => {
    it('should classify score >= 80 as deep_focus', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'dev1',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 10, total_unique_tickets: 2, total_unique_files: 10,
            total_loc: 200, active_days: 5, avg_tickets_per_day: 0.4,
            focus_score: 80.0, loc_per_commit: 20.0, commits_per_ticket: 5.0,
            focus_category: 'deep_focus',
            focus_score_delta: null,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result[0]?.focusCategory).toBe('deep_focus');
    });

    it('should classify score 60-79 as moderate_focus', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'dev2',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 10, total_unique_tickets: 4, total_unique_files: 10,
            total_loc: 200, active_days: 5, avg_tickets_per_day: 0.8,
            focus_score: 65.0, loc_per_commit: 20.0, commits_per_ticket: 2.5,
            focus_category: 'moderate_focus',
            focus_score_delta: null,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result[0]?.focusCategory).toBe('moderate_focus');
    });

    it('should classify score 40-59 as fragmented', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'dev3',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 10, total_unique_tickets: 8, total_unique_files: 10,
            total_loc: 200, active_days: 5, avg_tickets_per_day: 1.6,
            focus_score: 45.0, loc_per_commit: 20.0, commits_per_ticket: 1.25,
            focus_category: 'fragmented',
            focus_score_delta: null,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result[0]?.focusCategory).toBe('fragmented');
    });

    it('should classify score < 40 as highly_fragmented', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'dev4',
            week_start: '2024-06-10T00:00:00Z',
            total_commits: 10, total_unique_tickets: 12, total_unique_files: 10,
            total_loc: 200, active_days: 5, avg_tickets_per_day: 2.4,
            focus_score: 30.0, loc_per_commit: 20.0, commits_per_ticket: 0.83,
            focus_category: 'highly_fragmented',
            focus_score_delta: null,
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result[0]?.focusCategory).toBe('highly_fragmented');
    });
  });

  describe('delta calculation', () => {
    it('should show positive delta when focus improves', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'improving_dev',
            week_start: '2024-06-17T00:00:00Z',
            total_commits: 10, total_unique_tickets: 2, total_unique_files: 10,
            total_loc: 200, active_days: 5, avg_tickets_per_day: 0.4,
            focus_score: 90.0, loc_per_commit: 20.0, commits_per_ticket: 5.0,
            focus_category: 'deep_focus',
            focus_score_delta: 10.0, // Improved by 10 points from previous week
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result[0]?.focusScoreDelta).toBe(10.0);
    });

    it('should show negative delta when focus degrades', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'degrading_dev',
            week_start: '2024-06-17T00:00:00Z',
            total_commits: 10, total_unique_tickets: 6, total_unique_files: 10,
            total_loc: 200, active_days: 5, avg_tickets_per_day: 1.2,
            focus_score: 60.0, loc_per_commit: 20.0, commits_per_ticket: 1.67,
            focus_category: 'moderate_focus',
            focus_score_delta: -15.0, // Degraded by 15 points from previous week
          },
        ],
        rowCount: 1,
      });

      const service = new DeveloperFocusDataService(mockDb);
      const result = await service.getFocusScores();

      expect(result[0]?.focusScoreDelta).toBe(-15.0);
    });
  });
});
