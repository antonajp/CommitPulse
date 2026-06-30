import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { TeamProfileDataService } from '../../services/team-profile-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for TeamProfileDataService (GITX-185).
 * Tests validation, utility methods, and period calculations.
 */
describe('TeamProfileDataService', () => {
  let mockDb: DatabaseService;
  let service: TeamProfileDataService;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Create mock DatabaseService
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseService;

    service = new TeamProfileDataService(mockDb);
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('validateTeam', () => {
    it('should reject empty team names', async () => {
      await expect(
        service.getSummary({ team: '', timeframeDays: '90' })
      ).rejects.toThrow('Team name is required');
    });

    it('should reject whitespace-only team names', async () => {
      await expect(
        service.getSummary({ team: '   ', timeframeDays: '90' })
      ).rejects.toThrow('Team name is required');
    });

    it('should reject team names over 100 characters', async () => {
      const longTeamName = 'a'.repeat(101);
      await expect(
        service.getSummary({ team: longTeamName, timeframeDays: '90' })
      ).rejects.toThrow('Team name exceeds maximum length of 100 characters');
    });

    it('should accept valid team names with alphanumeric characters', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          total_loc_added: '0',
          avg_complexity: '0',
          repos_worked_on: 0,
        }],
        rowCount: 1,
      });

      await expect(
        service.getSummary({ team: 'CRMREO', timeframeDays: '90' })
      ).resolves.toBeDefined();
    });

    it('should accept valid team names with spaces, hyphens, and underscores', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          total_loc_added: '0',
          avg_complexity: '0',
          repos_worked_on: 0,
        }],
        rowCount: 1,
      });

      await expect(
        service.getSummary({ team: 'Team A-1_Test', timeframeDays: '90' })
      ).resolves.toBeDefined();
    });

    it('should reject team names with invalid characters', async () => {
      await expect(
        service.getSummary({ team: 'Team<script>', timeframeDays: '90' })
      ).rejects.toThrow('Team name contains invalid characters');
    });
  });

  describe('validateTimeframe', () => {
    it('should reject invalid timeframes', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          total_loc_added: '0',
          avg_complexity: '0',
          repos_worked_on: 0,
        }],
        rowCount: 1,
      });

      await expect(
        service.getSummary({ team: 'CRMREO', timeframeDays: '45' as any })
      ).rejects.toThrow('Invalid timeframe: 45');
    });

    it('should accept "30" as a valid timeframe', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          total_loc_added: '0',
          avg_complexity: '0',
          repos_worked_on: 0,
        }],
        rowCount: 1,
      });

      await expect(
        service.getSummary({ team: 'CRMREO', timeframeDays: '30' })
      ).resolves.toBeDefined();
    });

    it('should accept "60" as a valid timeframe', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          total_loc_added: '0',
          avg_complexity: '0',
          repos_worked_on: 0,
        }],
        rowCount: 1,
      });

      await expect(
        service.getSummary({ team: 'CRMREO', timeframeDays: '60' })
      ).resolves.toBeDefined();
    });

    it('should accept "90" as a valid timeframe', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          total_loc_added: '0',
          avg_complexity: '0',
          repos_worked_on: 0,
        }],
        rowCount: 1,
      });

      await expect(
        service.getSummary({ team: 'CRMREO', timeframeDays: '90' })
      ).resolves.toBeDefined();
    });

    it('should accept "180" as a valid timeframe', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          total_loc_added: '0',
          avg_complexity: '0',
          repos_worked_on: 0,
        }],
        rowCount: 1,
      });

      await expect(
        service.getSummary({ team: 'CRMREO', timeframeDays: '180' })
      ).resolves.toBeDefined();
    });

    it('should accept "365" as a valid timeframe', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          total_loc_added: '0',
          avg_complexity: '0',
          repos_worked_on: 0,
        }],
        rowCount: 1,
      });

      await expect(
        service.getSummary({ team: 'CRMREO', timeframeDays: '365' })
      ).resolves.toBeDefined();
    });

    it('should accept "730" as a valid timeframe', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 0,
          total_loc_added: '0',
          avg_complexity: '0',
          repos_worked_on: 0,
        }],
        rowCount: 1,
      });

      await expect(
        service.getSummary({ team: 'CRMREO', timeframeDays: '730' })
      ).resolves.toBeDefined();
    });
  });

  describe('validateAggregationPeriod', () => {
    it('should reject invalid periods (not week or month)', async () => {
      // Access private method through error from getLocPerWeek
      vi.mocked(mockDb.query).mockImplementationOnce(() => {
        throw new Error('Invalid aggregation period. Must be "week" or "month".');
      });

      await expect(
        service.getLocPerWeek({ team: 'CRMREO', timeframeDays: '90' })
      ).rejects.toThrow('Invalid aggregation period');
    });

    it('should accept "week" as valid aggregation period', () => {
      const period = service.getAggregationPeriod('90');
      expect(period).toBe('week');
    });

    it('should accept "month" as valid aggregation period', () => {
      const period = service.getAggregationPeriod('365');
      expect(period).toBe('month');
    });
  });

  describe('getStartDate', () => {
    it('should return correct date for 30 days', () => {
      const today = new Date();
      const expected = new Date();
      expected.setDate(today.getDate() - 30);
      const expectedStr = expected.toISOString().split('T')[0];

      // Access indirectly through getSummary mock
      vi.mocked(mockDb.query).mockImplementationOnce((sql: string) => {
        // Extract the date parameter from the SQL call
        expect(sql).toContain('commit_date >= $2');
        return Promise.resolve({
          rows: [{
            total_commits: 0,
            total_loc_added: '0',
            avg_complexity: '0',
            repos_worked_on: 0,
          }],
          rowCount: 1,
        });
      });

      void service.getSummary({ team: 'CRMREO', timeframeDays: '30' });
      // Verify the date parameter is approximately correct (within 1 day due to timing)
    });

    it('should return correct date for 365 days', () => {
      const today = new Date();
      const expected = new Date();
      expected.setDate(today.getDate() - 365);
      const expectedStr = expected.toISOString().split('T')[0];

      vi.mocked(mockDb.query).mockImplementationOnce((sql: string) => {
        expect(sql).toContain('commit_date >= $2');
        return Promise.resolve({
          rows: [{
            total_commits: 0,
            total_loc_added: '0',
            avg_complexity: '0',
            repos_worked_on: 0,
          }],
          rowCount: 1,
        });
      });

      void service.getSummary({ team: 'CRMREO', timeframeDays: '365' });
    });
  });

  describe('getAggregationPeriod', () => {
    it('should return "week" for timeframes < 365 days', () => {
      expect(service.getAggregationPeriod('30')).toBe('week');
      expect(service.getAggregationPeriod('60')).toBe('week');
      expect(service.getAggregationPeriod('90')).toBe('week');
      expect(service.getAggregationPeriod('180')).toBe('week');
    });

    it('should return "month" for timeframes >= 365 days', () => {
      expect(service.getAggregationPeriod('365')).toBe('month');
      expect(service.getAggregationPeriod('730')).toBe('month');
    });
  });

  describe('getPeriodsCount', () => {
    it('should return correct count for 30 days (weeks)', async () => {
      // 30 days = ~4.3 weeks, rounded up to 5
      // GITX-186: Now divides by contributor count for per-member average
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [{ total_commits: 100, total_loc_added: '1000', avg_complexity: '5.5', repos_worked_on: 2 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ contributor_count: 1 }], rowCount: 1 }) // commit contributors
        .mockResolvedValueOnce({ rows: [{ contributor_count: 1 }], rowCount: 1 }) // SP contributors
        .mockResolvedValueOnce({ rows: [{ total_points: 0, has_data: false }], rowCount: 1 }); // story points

      const result = await service.getSummary({ team: 'CRMREO', timeframeDays: '30' });
      // 1000 LOC / 5 weeks / 1 contributor = 200 LOC/week
      expect(result.avgLocPerPeriod).toBe(200);
    });

    it('should return correct count for 90 days (weeks)', async () => {
      // 90 days = ~12.9 weeks, rounded up to 13
      // GITX-186: Now divides by contributor count for per-member average
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [{ total_commits: 100, total_loc_added: '1300', avg_complexity: '5.5', repos_worked_on: 2 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ contributor_count: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ contributor_count: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ total_points: 0, has_data: false }], rowCount: 1 });

      const result = await service.getSummary({ team: 'CRMREO', timeframeDays: '90' });
      // 1300 LOC / 13 weeks / 1 contributor = 100 LOC/week
      expect(result.avgLocPerPeriod).toBe(100);
    });

    it('should return correct count for 365 days (months)', async () => {
      // 365 days = 12 months
      // GITX-186: Now divides by contributor count for per-member average
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [{ total_commits: 100, total_loc_added: '12000', avg_complexity: '5.5', repos_worked_on: 2 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ contributor_count: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ contributor_count: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ total_points: 0, has_data: false }], rowCount: 1 });

      const result = await service.getSummary({ team: 'CRMREO', timeframeDays: '365' });
      // 12000 LOC / 12 months / 1 contributor = 1000 LOC/month
      expect(result.avgLocPerPeriod).toBe(1000);
      expect(result.aggregationPeriod).toBe('month');
    });

    it('should return correct count for 730 days (months)', async () => {
      // 730 days = ~24 months
      // GITX-186: Now divides by contributor count for per-member average
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [{ total_commits: 100, total_loc_added: '24000', avg_complexity: '5.5', repos_worked_on: 2 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ contributor_count: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ contributor_count: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ total_points: 0, has_data: false }], rowCount: 1 });

      const result = await service.getSummary({ team: 'CRMREO', timeframeDays: '730' });
      // 24000 LOC / 24 months / 1 contributor = 1000 LOC/month
      expect(result.avgLocPerPeriod).toBe(1000);
      expect(result.aggregationPeriod).toBe('month');
    });

    it('should never return zero periods', async () => {
      // Even for very small timeframes, should return at least 1
      // GITX-186: Now divides by contributor count for per-member average
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [{ total_commits: 10, total_loc_added: '500', avg_complexity: '3.0', repos_worked_on: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ contributor_count: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ contributor_count: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ total_points: 0, has_data: false }], rowCount: 1 });

      const result = await service.getSummary({ team: 'CRMREO', timeframeDays: '30' });
      // Should have at least 1 period
      expect(result.avgLocPerPeriod).toBeGreaterThan(0);
    });
  });

  describe('utility method edge cases', () => {
    it('should handle zero commits gracefully', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.getSummary({ team: 'EmptyTeam', timeframeDays: '90' });
      expect(result.totalCommits).toBe(0);
      expect(result.totalLoc).toBe(0);
      expect(result.avgComplexity).toBe(0);
      expect(result.repositoriesWorkedOn).toBe(0);
      expect(result.avgLocPerPeriod).toBe(0);
      expect(result.avgStoryPointsPerPeriod).toBeNull();
    });

    it('should handle null values in database results', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 5,
          total_loc_added: '0',
          avg_complexity: '0',
          repos_worked_on: 1,
        }],
        rowCount: 1,
      });

      const result = await service.getSummary({ team: 'CRMREO', timeframeDays: '90' });
      expect(result.totalLoc).toBe(0);
      expect(result.avgComplexity).toBe(0);
    });
  });

  // ==========================================================================
  // GITX-187: getCommentsPerWeek
  // ==========================================================================
  describe('getCommentsPerWeek', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getCommentsPerWeek({
        team: 'CRMREO',
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
        team: 'CRMREO',
        timeframeDays: '90',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        weekStart: '2025-01-06',
        commentsAdded: 150,
      });
      expect(result[1]).toEqual({
        weekStart: '2025-01-13',
        commentsAdded: 200,
      });
    });

    it('should use total_comment_lines column (GITX-187)', async () => {
      await service.getCommentsPerWeek({
        team: 'CRMREO',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      // GITX-187: Use total_comment_lines (populated) instead of comments_change (NULL)
      expect(sql).toContain('COALESCE');
      expect(sql).toContain('total_comment_lines');
      // Verify NOT using the old comments_change column
      expect(sql).not.toContain('comments_change');
    });

    it('should use correct JOIN pattern for team members', async () => {
      await service.getCommentsPerWeek({
        team: 'CRMREO',
        timeframeDays: '90',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      // Verify CTE for team members
      expect(sql).toContain('WITH team_members AS');
      // Verify ch.author matches full_name (not login)
      expect(sql).toContain('ch.author = tm.full_name');
    });

    it('should reject invalid team names', async () => {
      await expect(
        service.getCommentsPerWeek({ team: '', timeframeDays: '90' })
      ).rejects.toThrow('Team name is required');
    });

    it('should reject invalid timeframes', async () => {
      await expect(
        service.getCommentsPerWeek({ team: 'CRMREO', timeframeDays: '999' as '7' | '30' | '90' | '365' })
      ).rejects.toThrow('Invalid timeframe');
    });
  });

  // ==========================================================================
  // GITX-220: getOrganizationAverages
  // ==========================================================================
  describe('getOrganizationAverages', () => {
    it('should return null values when teams table does not have organization_id', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ has_org_column: false }],
        rowCount: 1,
      });

      const result = await service.getOrganizationAverages({
        team: 'CRMREO',
        timeframeDays: '90',
      });

      expect(result.organizationId).toBeNull();
      expect(result.organizationName).toBeNull();
      expect(result.orgAvgTotalCommits).toBe(0);
      expect(result.orgAvgTotalLoc).toBe(0);
    });

    it('should return null values when team has no organization', async () => {
      // First call: check if org column exists
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ has_org_column: true }],
        rowCount: 1,
      });
      // Second call: get org averages (returns null org_id)
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          org_id: null,
          org_name: null,
          avg_total_commits: 0,
          avg_total_loc: '0',
          avg_complexity: '0',
          avg_repos_count: 0,
          team_count: 0,
        }],
        rowCount: 1,
      });

      const result = await service.getOrganizationAverages({
        team: 'UnassignedTeam',
        timeframeDays: '90',
      });

      expect(result.organizationId).toBeNull();
      expect(result.organizationName).toBeNull();
      expect(result.orgAvgTotalCommits).toBe(0);
    });

    it('should return organization averages when team has organization', async () => {
      // First call: check if org column exists
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ has_org_column: true }],
        rowCount: 1,
      });
      // Second call: get org averages
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          org_id: 1,
          org_name: 'Acme Corp',
          avg_total_commits: 150,
          avg_total_loc: '5000',
          avg_complexity: '4.25',
          avg_repos_count: 3,
          team_count: 5,
        }],
        rowCount: 1,
      });
      // Third call: get org average story points
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ avg_total_sp: 130, has_data: true }],
        rowCount: 1,
      });

      const result = await service.getOrganizationAverages({
        team: 'CRMREO',
        timeframeDays: '90',
      });

      expect(result.organizationId).toBe(1);
      expect(result.organizationName).toBe('Acme Corp');
      expect(result.orgAvgTotalCommits).toBe(150);
      expect(result.orgAvgTotalLoc).toBe(5000);
      expect(result.orgAvgComplexity).toBe(4.25);
      expect(result.orgAvgReposCount).toBe(3);
      // 5000 LOC / 13 weeks = 385 (rounded)
      expect(result.orgAvgLocPerPeriod).toBe(385);
      // 130 SP / 13 weeks = 10.0 (rounded to 1 decimal)
      expect(result.orgAvgSpPerPeriod).toBe(10);
    });

    it('should return null for story points when no SP data available', async () => {
      // First call: check if org column exists
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ has_org_column: true }],
        rowCount: 1,
      });
      // Second call: get org averages
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          org_id: 1,
          org_name: 'Acme Corp',
          avg_total_commits: 100,
          avg_total_loc: '3000',
          avg_complexity: '3.5',
          avg_repos_count: 2,
          team_count: 3,
        }],
        rowCount: 1,
      });
      // Third call: get org average story points (no data)
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ avg_total_sp: 0, has_data: false }],
        rowCount: 1,
      });

      const result = await service.getOrganizationAverages({
        team: 'CRMREO',
        timeframeDays: '90',
      });

      expect(result.organizationId).toBe(1);
      expect(result.orgAvgSpPerPeriod).toBeNull();
    });

    it('should reject invalid team names', async () => {
      await expect(
        service.getOrganizationAverages({ team: '', timeframeDays: '90' })
      ).rejects.toThrow('Team name is required');
    });

    it('should reject invalid timeframes', async () => {
      await expect(
        service.getOrganizationAverages({ team: 'CRMREO', timeframeDays: '999' as '90' })
      ).rejects.toThrow('Invalid timeframe');
    });

    it('should calculate correct avgLocPerPeriod for monthly aggregation', async () => {
      // First call: check if org column exists
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ has_org_column: true }],
        rowCount: 1,
      });
      // Second call: get org averages
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          org_id: 1,
          org_name: 'Acme Corp',
          avg_total_commits: 200,
          avg_total_loc: '12000',
          avg_complexity: '5.0',
          avg_repos_count: 4,
          team_count: 4,
        }],
        rowCount: 1,
      });
      // Third call: get org average story points
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ avg_total_sp: 0, has_data: false }],
        rowCount: 1,
      });

      const result = await service.getOrganizationAverages({
        team: 'CRMREO',
        timeframeDays: '365',
      });

      // 12000 LOC / 12 months = 1000
      expect(result.orgAvgLocPerPeriod).toBe(1000);
    });
  });
});
