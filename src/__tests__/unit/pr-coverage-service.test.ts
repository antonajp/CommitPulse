/**
 * Unit tests for PRCoverageService.
 * Tests coverage calculation, filtering, and data transformation logic.
 *
 * Ticket: GITX-221
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PRCoverageService } from '../../services/pr-coverage-service.js';
import type { DatabaseService } from '../../database/database-service.js';

// Mock LoggerService
vi.mock('../../logging/logger.js', () => ({
  LoggerService: {
    getInstance: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    }),
  },
}));

describe('PRCoverageService', () => {
  let mockDb: DatabaseService;
  let service: PRCoverageService;

  beforeEach(() => {
    // Create mock database service
    mockDb = {
      query: vi.fn(),
    } as unknown as DatabaseService;

    service = new PRCoverageService(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('checkViewExists', () => {
    it('should return true when view exists', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.checkViewExists();
      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.checkViewExists();
      expect(result).toBe(false);
    });

    it('should return false when no rows returned', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.checkViewExists();
      expect(result).toBe(false);
    });
  });

  describe('getOverallCoverage', () => {
    it('should return coverage metrics with date range', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 100,
          pr_linked_commits: 80,
          orphan_commits: 20,
          merge_commits: 10,
          repositories_analyzed: 3,
          coverage_percentage: 80.00,
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getOverallCoverage({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result).toEqual({
        totalCommits: 100,
        prLinkedCommits: 80,
        orphanCommits: 20,
        mergeCommits: 10,
        repositoriesAnalyzed: 3,
        coveragePercentage: 80,
      });
    });

    it('should return zero values when no data found', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getOverallCoverage();

      expect(result).toEqual({
        totalCommits: 0,
        prLinkedCommits: 0,
        orphanCommits: 0,
        mergeCommits: 0,
        repositoriesAnalyzed: 0,
        coveragePercentage: 0,
      });
    });

    it('should apply default date range when no filters provided', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          total_commits: 50,
          pr_linked_commits: 45,
          orphan_commits: 5,
          merge_commits: 3,
          repositories_analyzed: 2,
          coverage_percentage: 90.00,
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await service.getOverallCoverage();

      // Should have been called with date range query
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE commit_date >= $1 AND commit_date <= $2'),
        expect.arrayContaining([expect.any(String), expect.any(String)]),
      );
    });
  });

  describe('getOrphanCommits', () => {
    it('should return mapped orphan commits', async () => {
      const mockDate = new Date('2024-02-15T10:30:00Z');
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          sha: 'abc123def456',
          repository: 'my-repo',
          branch: 'main',
          author: 'developer',
          commit_date: mockDate,
          commit_message: 'Fix bug',
          lines_added: 10,
          lines_removed: 5,
          file_count: 2,
          organization: 'myorg',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getOrphanCommits({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        sha: 'abc123def456',
        repository: 'my-repo',
        branch: 'main',
        author: 'developer',
        commitDate: mockDate.toISOString(),
        commitMessage: 'Fix bug',
        linesAdded: 10,
        linesRemoved: 5,
        fileCount: 2,
        organization: 'myorg',
      });
    });

    it('should handle null values in orphan commits', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{
          sha: 'xyz789',
          repository: 'test-repo',
          branch: null,
          author: 'dev',
          commit_date: new Date('2024-01-01'),
          commit_message: null,
          lines_added: null,
          lines_removed: null,
          file_count: null,
          organization: null,
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getOrphanCommits({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result[0]).toEqual({
        sha: 'xyz789',
        repository: 'test-repo',
        branch: null,
        author: 'dev',
        commitDate: expect.any(String),
        commitMessage: null,
        linesAdded: 0,
        linesRemoved: 0,
        fileCount: 0,
        organization: null,
      });
    });
  });

  describe('getCoverageByBranch', () => {
    it('should return coverage breakdown by branch', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            repository: 'repo1',
            branch: 'main',
            total_commits: 50,
            pr_linked_commits: 45,
            orphan_commits: 5,
            coverage_percentage: 90.00,
          },
          {
            repository: 'repo1',
            branch: 'develop',
            total_commits: 30,
            pr_linked_commits: 20,
            orphan_commits: 10,
            coverage_percentage: 66.67,
          },
        ],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getCoverageByBranch({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        repository: 'repo1',
        branch: 'main',
        totalCommits: 50,
        prLinkedCommits: 45,
        orphanCommits: 5,
        coveragePercentage: 90,
      });
    });
  });

  describe('getCoverageByAuthor', () => {
    it('should return coverage breakdown by author', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            repository: 'repo1',
            author: 'alice',
            total_commits: 40,
            pr_linked_commits: 40,
            orphan_commits: 0,
            coverage_percentage: 100.00,
          },
          {
            repository: 'repo1',
            author: 'bob',
            total_commits: 20,
            pr_linked_commits: 15,
            orphan_commits: 5,
            coverage_percentage: 75.00,
          },
        ],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getCoverageByAuthor({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        repository: 'repo1',
        author: 'alice',
        totalCommits: 40,
        prLinkedCommits: 40,
        orphanCommits: 0,
        coveragePercentage: 100,
      });
    });
  });

  describe('getWeeklyTrend', () => {
    it('should return weekly trend data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            week_start: new Date('2024-01-01'),
            total_commits: 25,
            pr_linked_commits: 20,
            orphan_commits: 5,
            coverage_percentage: 80.00,
          },
          {
            week_start: new Date('2024-01-08'),
            total_commits: 30,
            pr_linked_commits: 27,
            orphan_commits: 3,
            coverage_percentage: 90.00,
          },
        ],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getWeeklyTrend({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        weekStart: '2024-01-01',
        totalCommits: 25,
        prLinkedCommits: 20,
        orphanCommits: 5,
        coveragePercentage: 80,
      });
    });
  });

  describe('getFilterOptions', () => {
    it('should return all filter options', async () => {
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({
          rows: [{ repository: 'repo1' }, { repository: 'repo2' }],
          rowCount: 2,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ author: 'alice' }, { author: 'bob' }],
          rowCount: 2,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [
            { contributor_display: 'Alice Johnson (alice)' },
            { contributor_display: 'Bob Smith (bob)' },
          ],
          rowCount: 2,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ branch: 'main' }, { branch: 'develop' }],
          rowCount: 2,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const result = await service.getFilterOptions();

      expect(result).toEqual({
        repositories: ['repo1', 'repo2'],
        authors: ['alice', 'bob'],
        contributors: ['Alice Johnson (alice)', 'Bob Smith (bob)'],
        branches: ['main', 'develop'],
      });
    });
  });

  describe('getChartData', () => {
    it('should return empty data when view does not exist', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getChartData();

      expect(result.viewExists).toBe(false);
      expect(result.hasData).toBe(false);
      expect(result.overall.totalCommits).toBe(0);
    });
  });

  describe('input validation', () => {
    it('should throw error for invalid start date format', async () => {
      await expect(
        service.getOverallCoverage({ startDate: 'invalid-date' }),
      ).rejects.toThrow('Invalid start date format');
    });

    it('should throw error for invalid end date format', async () => {
      await expect(
        service.getOverallCoverage({ endDate: '2024/01/01' }),
      ).rejects.toThrow('Invalid end date format');
    });

    it('should throw error when start date is after end date', async () => {
      await expect(
        service.getOverallCoverage({
          startDate: '2024-03-31',
          endDate: '2024-01-01',
        }),
      ).rejects.toThrow('Invalid date range');
    });

    it('should throw error for repository filter exceeding max length', async () => {
      const longString = 'a'.repeat(300);
      await expect(
        service.getOrphanCommits({ repository: longString }),
      ).rejects.toThrow('exceeds maximum length');
    });

    it('should throw error for author filter exceeding max length', async () => {
      const longString = 'b'.repeat(300);
      await expect(
        service.getOrphanCommits({ author: longString }),
      ).rejects.toThrow('exceeds maximum length');
    });
  });

  describe('syncCoverageFromMergeSha', () => {
    it('should return number of links created', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 15,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const result = await service.syncCoverageFromMergeSha();
      expect(result).toBe(15);
    });

    it('should handle zero links created', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const result = await service.syncCoverageFromMergeSha();
      expect(result).toBe(0);
    });
  });

  describe('getCoverageByContributor', () => {
    it('should return coverage grouped by contributor name', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            repository: 'repo1',
            contributor_name: 'Alice Johnson',
            login: 'alice',
            total_commits: 50,
            pr_linked_commits: 45,
            orphan_commits: 5,
            coverage_percentage: 90.00,
          },
          {
            repository: 'repo1',
            contributor_name: 'Bob Smith',
            login: 'bob',
            total_commits: 30,
            pr_linked_commits: 25,
            orphan_commits: 5,
            coverage_percentage: 83.33,
          },
        ],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getCoverageByContributor({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        repository: 'repo1',
        contributorName: 'Alice Johnson',
        login: 'alice',
        totalCommits: 50,
        prLinkedCommits: 45,
        orphanCommits: 5,
        coveragePercentage: 90,
      });
    });

    it('should use COALESCE fallback when full_name is NULL', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            repository: 'repo1',
            contributor_name: 'charlie', // Falls back to login
            login: 'charlie',
            total_commits: 10,
            pr_linked_commits: 8,
            orphan_commits: 2,
            coverage_percentage: 80.00,
          },
        ],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getCoverageByContributor({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.contributorName).toBe('charlie');
      expect(result[0]?.login).toBe('charlie');
    });

    it('should apply date range filter', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await service.getCoverageByContributor({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('contributor_name'),
        expect.arrayContaining(['2024-01-01', '2024-03-31']),
      );
    });

    it('should apply repository filter', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await service.getCoverageByContributor({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
        repository: 'my-repo',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $3'),
        expect.arrayContaining(['my-repo']),
      );
    });

    it('should validate string filter length (CWE-20)', async () => {
      const longString = 'a'.repeat(300);
      await expect(
        service.getCoverageByContributor({
          startDate: '2024-01-01',
          endDate: '2024-03-31',
          repository: longString,
        }),
      ).rejects.toThrow('exceeds maximum length');
    });

    it('should apply default date range when not provided', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await service.getCoverageByContributor();

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([expect.any(String), expect.any(String)]),
      );
    });
  });

  describe('getCoverageByTeam', () => {
    it('should return coverage grouped by team name', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            repository: 'repo1',
            team_name: 'Backend Team',
            contributor_count: 5,
            total_commits: 120,
            pr_linked_commits: 110,
            orphan_commits: 10,
            coverage_percentage: 91.67,
          },
          {
            repository: 'repo1',
            team_name: 'Frontend Team',
            contributor_count: 3,
            total_commits: 80,
            pr_linked_commits: 75,
            orphan_commits: 5,
            coverage_percentage: 93.75,
          },
        ],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getCoverageByTeam({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        repository: 'repo1',
        teamName: 'Backend Team',
        contributorCount: 5,
        totalCommits: 120,
        prLinkedCommits: 110,
        orphanCommits: 10,
        coveragePercentage: 91.67,
      });
    });

    it('should exclude teams with zero commits (HAVING filter)', async () => {
      // The view already has HAVING filter, so we verify the response is empty
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getCoverageByTeam({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result).toHaveLength(0);
    });

    it('should fallback to "Unassigned" for NULL team', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            repository: 'repo1',
            team_name: 'Unassigned',
            contributor_count: 2,
            total_commits: 15,
            pr_linked_commits: 10,
            orphan_commits: 5,
            coverage_percentage: 66.67,
          },
        ],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getCoverageByTeam({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result[0]?.teamName).toBe('Unassigned');
    });

    it('should include contributor count per team', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            repository: 'repo1',
            team_name: 'DevOps Team',
            contributor_count: 4,
            total_commits: 60,
            pr_linked_commits: 58,
            orphan_commits: 2,
            coverage_percentage: 96.67,
          },
        ],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.getCoverageByTeam({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result[0]?.contributorCount).toBe(4);
    });

    it('should apply date range filter', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await service.getCoverageByTeam({
        startDate: '2024-02-01',
        endDate: '2024-02-29',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('team_name'),
        expect.arrayContaining(['2024-02-01', '2024-02-29']),
      );
    });

    it('should apply repository filter', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await service.getCoverageByTeam({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
        repository: 'backend-api',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $3'),
        expect.arrayContaining(['backend-api']),
      );
    });

    it('should validate repository filter length (CWE-20)', async () => {
      const longString = 'b'.repeat(300);
      await expect(
        service.getCoverageByTeam({
          startDate: '2024-01-01',
          endDate: '2024-03-31',
          repository: longString,
        }),
      ).rejects.toThrow('exceeds maximum length');
    });
  });

  describe('getChartData - contributor and team data', () => {
    it('should include byContributor in response', async () => {
      // Mock checkViewExists
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Mock parallel queries (overall, weeklyTrend, byAuthor, byBranch, byContributor, byTeam, orphanCommits)
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [{ total_commits: 100, pr_linked_commits: 80, orphan_commits: 20, merge_commits: 5, repositories_analyzed: 2, coverage_percentage: 80 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }) // weeklyTrend
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }) // byAuthor
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }) // byBranch
        .mockResolvedValueOnce({ // byContributor
          rows: [{
            repository: 'repo1',
            contributor_name: 'Alice',
            login: 'alice',
            total_commits: 50,
            pr_linked_commits: 45,
            orphan_commits: 5,
            coverage_percentage: 90,
          }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }) // byTeam
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }); // orphanCommits

      const result = await service.getChartData({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result.byContributor).toBeDefined();
      expect(result.byContributor).toHaveLength(1);
      expect(result.byContributor[0]).toEqual({
        repository: 'repo1',
        contributorName: 'Alice',
        login: 'alice',
        totalCommits: 50,
        prLinkedCommits: 45,
        orphanCommits: 5,
        coveragePercentage: 90,
      });
    });

    it('should include byTeam in response', async () => {
      // Mock checkViewExists
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Mock parallel queries
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [{ total_commits: 100, pr_linked_commits: 80, orphan_commits: 20, merge_commits: 5, repositories_analyzed: 2, coverage_percentage: 80 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }) // weeklyTrend
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }) // byAuthor
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }) // byBranch
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }) // byContributor
        .mockResolvedValueOnce({ // byTeam
          rows: [{
            repository: 'repo1',
            team_name: 'Backend Team',
            contributor_count: 3,
            total_commits: 75,
            pr_linked_commits: 70,
            orphan_commits: 5,
            coverage_percentage: 93.33,
          }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }); // orphanCommits

      const result = await service.getChartData({
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(result.byTeam).toBeDefined();
      expect(result.byTeam).toHaveLength(1);
      expect(result.byTeam[0]).toEqual({
        repository: 'repo1',
        teamName: 'Backend Team',
        contributorCount: 3,
        totalCommits: 75,
        prLinkedCommits: 70,
        orphanCommits: 5,
        coveragePercentage: 93.33,
      });
    });
  });
});
