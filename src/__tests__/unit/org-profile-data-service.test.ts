import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { OrganizationProfileDataService } from '../../services/org-profile-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for OrganizationProfileDataService (GITX-204).
 * Tests validation, utility methods, and period calculations.
 */
describe('OrganizationProfileDataService', () => {
  let mockDb: DatabaseService;
  let service: OrganizationProfileDataService;

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

    service = new OrganizationProfileDataService(mockDb);
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // validateOrganizationId tests
  // ==========================================================================
  describe('validateOrganizationId', () => {
    it('should reject non-integer organization IDs', () => {
      expect(() => service.validateOrganizationId(1.5, 'test'))
        .toThrow('Organization ID must be an integer.');
    });

    it('should reject zero organization ID', () => {
      expect(() => service.validateOrganizationId(0, 'test'))
        .toThrow('Organization ID must be a positive integer.');
    });

    it('should reject negative organization IDs', () => {
      expect(() => service.validateOrganizationId(-1, 'test'))
        .toThrow('Organization ID must be a positive integer.');
    });

    it('should reject NaN organization ID', () => {
      expect(() => service.validateOrganizationId(NaN, 'test'))
        .toThrow('Organization ID must be an integer.');
    });

    it('should reject Infinity organization ID', () => {
      expect(() => service.validateOrganizationId(Infinity, 'test'))
        .toThrow('Organization ID must be an integer.');
    });

    it('should reject string coerced to number', () => {
      expect(() => service.validateOrganizationId('1' as unknown as number, 'test'))
        .toThrow('Organization ID must be an integer.');
    });

    it('should accept valid positive integer ID', () => {
      expect(() => service.validateOrganizationId(1, 'test')).not.toThrow();
      expect(() => service.validateOrganizationId(100, 'test')).not.toThrow();
      expect(() => service.validateOrganizationId(999999, 'test')).not.toThrow();
    });
  });

  // ==========================================================================
  // validateTimeframe tests
  // ==========================================================================
  describe('validateTimeframe', () => {
    it('should reject invalid timeframes', () => {
      expect(() => service.validateTimeframe('45', 'test'))
        .toThrow('Invalid timeframe: 45. Allowed values: 30, 60, 90, 180, 365, 730.');
    });

    it('should reject empty timeframe', () => {
      expect(() => service.validateTimeframe('', 'test'))
        .toThrow('Invalid timeframe');
    });

    it('should reject numeric timeframe', () => {
      expect(() => service.validateTimeframe('7', 'test'))
        .toThrow('Invalid timeframe');
    });

    it('should accept "30" as a valid timeframe', () => {
      expect(() => service.validateTimeframe('30', 'test')).not.toThrow();
    });

    it('should accept "60" as a valid timeframe', () => {
      expect(() => service.validateTimeframe('60', 'test')).not.toThrow();
    });

    it('should accept "90" as a valid timeframe', () => {
      expect(() => service.validateTimeframe('90', 'test')).not.toThrow();
    });

    it('should accept "180" as a valid timeframe', () => {
      expect(() => service.validateTimeframe('180', 'test')).not.toThrow();
    });

    it('should accept "365" as a valid timeframe', () => {
      expect(() => service.validateTimeframe('365', 'test')).not.toThrow();
    });

    it('should accept "730" as a valid timeframe', () => {
      expect(() => service.validateTimeframe('730', 'test')).not.toThrow();
    });
  });

  // ==========================================================================
  // getAggregationPeriod tests
  // ==========================================================================
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

  // ==========================================================================
  // getSummary tests - GITX-206: Updated for new KPI card fields
  // ==========================================================================
  describe('getSummary', () => {
    it('should reject invalid organization ID', async () => {
      await expect(
        service.getSummary({ organizationId: 0, timeframeDays: '90' })
      ).rejects.toThrow('Organization ID must be a positive integer.');
    });

    it('should reject invalid timeframe', async () => {
      await expect(
        service.getSummary({ organizationId: 1, timeframeDays: '45' as '90' })
      ).rejects.toThrow('Invalid timeframe');
    });

    it('should return empty summary when no data', async () => {
      // GITX-206: getSummary now makes 2 parallel queries
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total_story_points: null }], rowCount: 1 });

      const result = await service.getSummary({ organizationId: 1, timeframeDays: '90' });

      expect(result.organizationId).toBe(1);
      expect(result.organizationName).toBe('');
      expect(result.teamCount).toBe(0);
      expect(result.totalCommits).toBe(0);
      expect(result.totalLoc).toBe(0);
      expect(result.avgComplexity).toBe(0);
      expect(result.avgLocPerPeriod).toBe(0);
      expect(result.avgStoryPointsPerPeriod).toBeNull();
      expect(result.repositoriesWorkedOn).toBe(0);
    });

    it('should return correct summary when data exists', async () => {
      // GITX-206: getSummary now makes 2 parallel queries
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({
          rows: [{
            organization_id: 1,
            organization_name: 'Test Org',
            team_count: 3,
            contributor_count: 15,
            total_loc: '10000',
            total_commits: 500,
            avg_complexity: '12.5',
            repos_worked_on: 5,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ total_story_points: 130 }],
          rowCount: 1,
        });

      const result = await service.getSummary({ organizationId: 1, timeframeDays: '90' });

      expect(result.organizationId).toBe(1);
      expect(result.organizationName).toBe('Test Org');
      expect(result.teamCount).toBe(3);
      expect(result.contributorCount).toBe(15);
      expect(result.totalCommits).toBe(500);
      expect(result.totalLoc).toBe(10000);
      expect(result.avgComplexity).toBe(12.5);
      expect(result.aggregationPeriod).toBe('week');
      expect(result.repositoriesWorkedOn).toBe(5);
      // 130 story points / 13 weeks = 10.0
      expect(result.avgStoryPointsPerPeriod).toBe(10.0);
    });

    it('should return null avgStoryPointsPerPeriod when no Jira/Linear data', async () => {
      // GITX-206: Test case for no velocity data
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({
          rows: [{
            organization_id: 1,
            organization_name: 'No Velocity Org',
            team_count: 2,
            contributor_count: 10,
            total_loc: '5000',
            total_commits: 200,
            avg_complexity: '8.0',
            repos_worked_on: 3,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ total_story_points: null }],
          rowCount: 1,
        });

      const result = await service.getSummary({ organizationId: 1, timeframeDays: '90' });

      expect(result.avgStoryPointsPerPeriod).toBeNull();
    });
  });

  // ==========================================================================
  // getOrganizations tests
  // ==========================================================================
  describe('getOrganizations', () => {
    it('should return empty array when no organizations', async () => {
      const result = await service.getOrganizations();
      expect(result).toEqual([]);
    });

    it('should return organizations when data exists', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: 'Org A',
            team_count: 3,
            created_at: new Date('2024-01-01'),
            updated_at: new Date('2024-06-01'),
          },
          {
            id: 2,
            name: 'Org B',
            team_count: 5,
            created_at: new Date('2024-02-01'),
            updated_at: new Date('2024-06-15'),
          },
        ],
        rowCount: 2,
      });

      const result = await service.getOrganizations();

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe(1);
      expect(result[0]?.name).toBe('Org A');
      expect(result[0]?.teamCount).toBe(3);
      expect(result[1]?.id).toBe(2);
      expect(result[1]?.name).toBe('Org B');
      expect(result[1]?.teamCount).toBe(5);
    });
  });

  // ==========================================================================
  // getOrganizationById tests
  // ==========================================================================
  describe('getOrganizationById', () => {
    it('should reject invalid organization ID', async () => {
      await expect(
        service.getOrganizationById(0)
      ).rejects.toThrow('Organization ID must be a positive integer.');
    });

    it('should return null when organization not found', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.getOrganizationById(999);
      expect(result).toBeNull();
    });

    it('should return organization when found', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          id: 1,
          name: 'Test Org',
          team_count: 3,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-06-01'),
        }],
        rowCount: 1,
      });

      const result = await service.getOrganizationById(1);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(1);
      expect(result?.name).toBe('Test Org');
      expect(result?.teamCount).toBe(3);
    });
  });

  // ==========================================================================
  // createOrganization tests
  // ==========================================================================
  describe('createOrganization', () => {
    it('should reject empty organization name', async () => {
      await expect(
        service.createOrganization({ name: '' })
      ).rejects.toThrow('Organization name is required.');
    });

    it('should reject whitespace-only organization name', async () => {
      await expect(
        service.createOrganization({ name: '   ' })
      ).rejects.toThrow('Organization name is required.');
    });

    it('should reject organization name over 100 characters', async () => {
      const longName = 'a'.repeat(101);
      await expect(
        service.createOrganization({ name: longName })
      ).rejects.toThrow('Organization name exceeds maximum length of 100 characters.');
    });

    it('should reject organization name with invalid characters', async () => {
      await expect(
        service.createOrganization({ name: 'Org<script>' })
      ).rejects.toThrow('Organization name contains invalid characters.');
    });

    it('should create organization with valid name', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          id: 1,
          name: 'New Org',
          created_at: new Date('2024-06-29'),
          updated_at: new Date('2024-06-29'),
        }],
        rowCount: 1,
      });

      const result = await service.createOrganization({ name: 'New Org' });

      expect(result.id).toBe(1);
      expect(result.name).toBe('New Org');
      expect(result.teamCount).toBe(0);
    });
  });

  // ==========================================================================
  // updateOrganization tests
  // ==========================================================================
  describe('updateOrganization', () => {
    it('should reject invalid organization ID', async () => {
      await expect(
        service.updateOrganization(0, { name: 'Updated' })
      ).rejects.toThrow('Organization ID must be a positive integer.');
    });

    it('should reject empty organization name', async () => {
      await expect(
        service.updateOrganization(1, { name: '' })
      ).rejects.toThrow('Organization name is required.');
    });

    it('should return null when organization not found', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.updateOrganization(999, { name: 'Updated' });
      expect(result).toBeNull();
    });

    it('should update organization when found', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          id: 1,
          name: 'Updated Org',
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-06-29'),
        }],
        rowCount: 1,
      });

      const result = await service.updateOrganization(1, { name: 'Updated Org' });

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Updated Org');
    });
  });

  // ==========================================================================
  // deleteOrganization tests
  // ==========================================================================
  describe('deleteOrganization', () => {
    it('should reject invalid organization ID', async () => {
      await expect(
        service.deleteOrganization(0)
      ).rejects.toThrow('Organization ID must be a positive integer.');
    });

    it('should return false when organization not found', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.deleteOrganization(999);
      expect(result).toBe(false);
    });

    it('should return true when organization deleted', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      });

      const result = await service.deleteOrganization(1);
      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // assignTeamToOrganization tests
  // ==========================================================================
  describe('assignTeamToOrganization', () => {
    it('should reject invalid team ID', async () => {
      await expect(
        service.assignTeamToOrganization(0, 1)
      ).rejects.toThrow('Team ID must be a positive integer.');
    });

    it('should reject invalid organization ID', async () => {
      await expect(
        service.assignTeamToOrganization(1, 0)
      ).rejects.toThrow('Organization ID must be a positive integer.');
    });

    it('should return null when team not found', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.assignTeamToOrganization(999, 1);
      expect(result).toBeNull();
    });

    it('should assign team when both exist', async () => {
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            name: 'Team A',
            organization_id: 1,
            created_at: new Date('2024-01-01'),
            updated_at: new Date('2024-06-29'),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ name: 'Org A' }],
          rowCount: 1,
        });

      const result = await service.assignTeamToOrganization(1, 1);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(1);
      expect(result?.organizationId).toBe(1);
      expect(result?.organizationName).toBe('Org A');
    });
  });

  // ==========================================================================
  // removeTeamFromOrganization tests
  // ==========================================================================
  describe('removeTeamFromOrganization', () => {
    it('should reject invalid team ID', async () => {
      await expect(
        service.removeTeamFromOrganization(0)
      ).rejects.toThrow('Team ID must be a positive integer.');
    });

    it('should return null when team not found', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.removeTeamFromOrganization(999);
      expect(result).toBeNull();
    });

    it('should remove team from organization when found', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          id: 1,
          name: 'Team A',
          organization_id: null,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-06-29'),
        }],
        rowCount: 1,
      });

      const result = await service.removeTeamFromOrganization(1);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(1);
      expect(result?.organizationId).toBeNull();
      expect(result?.organizationName).toBeNull();
    });
  });

  // ==========================================================================
  // getTeams tests
  // ==========================================================================
  describe('getTeams', () => {
    it('should return empty array when no teams', async () => {
      const result = await service.getTeams();
      expect(result).toEqual([]);
    });

    it('should return teams with organization info', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: 'Team A',
            organization_id: 1,
            organization_name: 'Org A',
            created_at: new Date('2024-01-01'),
            updated_at: new Date('2024-06-01'),
          },
          {
            id: 2,
            name: 'Team B',
            organization_id: null,
            organization_name: null,
            created_at: new Date('2024-02-01'),
            updated_at: new Date('2024-06-15'),
          },
        ],
        rowCount: 2,
      });

      const result = await service.getTeams();

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('Team A');
      expect(result[0]?.organizationId).toBe(1);
      expect(result[0]?.organizationName).toBe('Org A');
      expect(result[1]?.name).toBe('Team B');
      expect(result[1]?.organizationId).toBeNull();
      expect(result[1]?.organizationName).toBeNull();
    });
  });

  // ==========================================================================
  // getLocPerWeek tests
  // ==========================================================================
  describe('getLocPerWeek', () => {
    it('should reject invalid organization ID', async () => {
      await expect(
        service.getLocPerWeek({ organizationId: 0, timeframeDays: '90' })
      ).rejects.toThrow('Organization ID must be a positive integer.');
    });

    it('should reject invalid timeframe', async () => {
      await expect(
        service.getLocPerWeek({ organizationId: 1, timeframeDays: '45' as '90' })
      ).rejects.toThrow('Invalid timeframe');
    });

    it('should return empty array when no data', async () => {
      const result = await service.getLocPerWeek({ organizationId: 1, timeframeDays: '90' });
      expect(result).toEqual([]);
    });

    it('should return LOC per week data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-06-10'),
            lines_added: '500',
            lines_deleted: '100',
            net_lines: '400',
            commit_count: 25,
          },
          {
            week_start: new Date('2024-06-17'),
            lines_added: '750',
            lines_deleted: '200',
            net_lines: '550',
            commit_count: 35,
          },
        ],
        rowCount: 2,
      });

      const result = await service.getLocPerWeek({ organizationId: 1, timeframeDays: '90' });

      expect(result).toHaveLength(2);
      expect(result[0]?.weekStart).toBe('2024-06-10');
      expect(result[0]?.linesAdded).toBe(500);
      expect(result[0]?.linesDeleted).toBe(100);
      expect(result[0]?.netLines).toBe(400);
      expect(result[0]?.commitCount).toBe(25);
    });
  });

  // ==========================================================================
  // getHygieneScore tests
  // ==========================================================================
  describe('getHygieneScore', () => {
    it('should reject invalid organization ID', async () => {
      await expect(
        service.getHygieneScore(0)
      ).rejects.toThrow('Organization ID must be a positive integer.');
    });

    it('should return zero hygiene score when no data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          avg_hygiene_score: '0',
          total_commits: 0,
          conventional_commits: 0,
          conventional_pct: '0',
        }],
        rowCount: 1,
      });

      const result = await service.getHygieneScore(1);

      expect(result.avgHygieneScore).toBe(0);
      expect(result.totalCommits).toBe(0);
      expect(result.conventionalCommits).toBe(0);
      expect(result.conventionalPct).toBe(0);
    });

    it('should return hygiene score when data exists', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          avg_hygiene_score: '85.5',
          total_commits: 100,
          conventional_commits: 80,
          conventional_pct: '80.0',
        }],
        rowCount: 1,
      });

      const result = await service.getHygieneScore(1);

      expect(result.avgHygieneScore).toBe(85.5);
      expect(result.totalCommits).toBe(100);
      expect(result.conventionalCommits).toBe(80);
      expect(result.conventionalPct).toBe(80.0);
    });
  });

  // ==========================================================================
  // isOrganizationsTableAvailable tests
  // ==========================================================================
  describe('isOrganizationsTableAvailable', () => {
    it('should return false when table does not exist', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ table_exists: false }],
        rowCount: 1,
      });

      const result = await service.isOrganizationsTableAvailable();
      expect(result).toBe(false);
    });

    it('should return true when table exists', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ table_exists: true }],
        rowCount: 1,
      });

      const result = await service.isOrganizationsTableAvailable();
      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // getDataCoverage tests - GITX-210: Partial data coverage handling
  // ==========================================================================
  describe('getDataCoverage', () => {
    it('should reject invalid organization ID', async () => {
      await expect(
        service.getDataCoverage({ organizationId: 0, timeframeDays: '90' })
      ).rejects.toThrow('Organization ID must be a positive integer.');
    });

    it('should reject invalid timeframe', async () => {
      await expect(
        service.getDataCoverage({ organizationId: 1, timeframeDays: '45' as '90' })
      ).rejects.toThrow('Invalid timeframe');
    });

    it('should return empty coverage when no teams', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await service.getDataCoverage({ organizationId: 1, timeframeDays: '90' });

      expect(result.totalTeams).toBe(0);
      expect(result.teamsWithData).toBe(0);
      expect(result.teamsWithJiraData).toBe(0);
      expect(result.isPartial).toBe(false);
      expect(result.isJiraPartial).toBe(false);
      expect(result.teamStatus).toEqual([]);
    });

    it('should return full coverage when all teams have data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { team_id: 1, team_name: 'Team A', commit_count: 50, has_jira_data: true },
          { team_id: 2, team_name: 'Team B', commit_count: 30, has_jira_data: true },
        ],
        rowCount: 2,
      });

      const result = await service.getDataCoverage({ organizationId: 1, timeframeDays: '90' });

      expect(result.totalTeams).toBe(2);
      expect(result.teamsWithData).toBe(2);
      expect(result.teamsWithJiraData).toBe(2);
      expect(result.isPartial).toBe(false);
      expect(result.isJiraPartial).toBe(false);
      expect(result.teamStatus).toHaveLength(2);
      expect(result.teamStatus[0]?.hasData).toBe(true);
      expect(result.teamStatus[1]?.hasData).toBe(true);
    });

    it('should detect partial data coverage', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { team_id: 1, team_name: 'Team A', commit_count: 50, has_jira_data: true },
          { team_id: 2, team_name: 'Team B', commit_count: 0, has_jira_data: false },
          { team_id: 3, team_name: 'Team C', commit_count: 25, has_jira_data: true },
        ],
        rowCount: 3,
      });

      const result = await service.getDataCoverage({ organizationId: 1, timeframeDays: '90' });

      expect(result.totalTeams).toBe(3);
      expect(result.teamsWithData).toBe(2);
      expect(result.teamsWithJiraData).toBe(2);
      expect(result.isPartial).toBe(true);
      expect(result.isJiraPartial).toBe(true);
      expect(result.teamStatus).toHaveLength(3);

      // Verify individual team status
      const teamB = result.teamStatus.find(t => t.teamName === 'Team B');
      expect(teamB?.hasData).toBe(false);
      expect(teamB?.commitCount).toBe(0);
      expect(teamB?.hasJiraData).toBe(false);
    });

    it('should detect partial Jira coverage even with full commit data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { team_id: 1, team_name: 'Team A', commit_count: 50, has_jira_data: true },
          { team_id: 2, team_name: 'Team B', commit_count: 30, has_jira_data: false },
        ],
        rowCount: 2,
      });

      const result = await service.getDataCoverage({ organizationId: 1, timeframeDays: '90' });

      expect(result.totalTeams).toBe(2);
      expect(result.teamsWithData).toBe(2);
      expect(result.teamsWithJiraData).toBe(1);
      expect(result.isPartial).toBe(false);
      expect(result.isJiraPartial).toBe(true);
    });
  });

  // ==========================================================================
  // Edge cases tests - GITX-206: Updated for new KPI card fields
  // ==========================================================================
  describe('edge cases', () => {
    it('should handle null values in database results gracefully', async () => {
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({
          rows: [{
            organization_id: 1,
            organization_name: 'Test',
            team_count: 0,
            contributor_count: 0,
            total_loc: '0',
            total_commits: 0,
            avg_complexity: '0',
            repos_worked_on: 0,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ total_story_points: null }],
          rowCount: 1,
        });

      const result = await service.getSummary({ organizationId: 1, timeframeDays: '90' });

      expect(result.totalLoc).toBe(0);
      expect(result.avgLocPerPeriod).toBe(0);
      expect(result.avgComplexity).toBe(0);
      expect(result.avgStoryPointsPerPeriod).toBeNull();
      expect(result.repositoriesWorkedOn).toBe(0);
    });

    it('should handle large numbers correctly', async () => {
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({
          rows: [{
            organization_id: 1,
            organization_name: 'Large Org',
            team_count: 50,
            contributor_count: 500,
            total_loc: '10000000',
            total_commits: 100000,
            avg_complexity: '25.75',
            repos_worked_on: 100,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ total_story_points: 2600 }],
          rowCount: 1,
        });

      const result = await service.getSummary({ organizationId: 1, timeframeDays: '90' });

      expect(result.totalLoc).toBe(10000000);
      expect(result.totalCommits).toBe(100000);
      expect(result.avgComplexity).toBe(25.75);
      expect(result.repositoriesWorkedOn).toBe(100);
      // 10000000 / 13 weeks = ~769230
      expect(result.avgLocPerPeriod).toBeGreaterThan(0);
      // 2600 / 13 weeks = 200
      expect(result.avgStoryPointsPerPeriod).toBe(200);
    });
  });
});
