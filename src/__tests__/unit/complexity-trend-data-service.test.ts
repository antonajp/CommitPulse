import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { ComplexityTrendDataService } from '../../services/complexity-trend-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';
import type { ComplexityTrendFilters, ComplexityTrendViewMode } from '../../views/webview/complexity-trend-protocol.js';

/**
 * Unit tests for ComplexityTrendDataService (GITX-133, GITX-134, GITX-136).
 * Tests data queries for the Complexity Trend chart including:
 * - Filter validation
 * - viewMode query selection (GITX-136)
 * - Tech stack filtering
 * - Date range validation
 * - SQL injection prevention
 * - Entity ranking queries (GITX-136)
 */
describe('ComplexityTrendDataService', () => {
  let mockDb: DatabaseService;
  let service: ComplexityTrendDataService;

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

    service = new ComplexityTrendDataService(mockDb);
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
    it('should create a ComplexityTrendDataService instance', () => {
      expect(service).toBeDefined();
    });
  });

  // ==========================================================================
  // checkDataExists
  // ==========================================================================
  describe('checkDataExists', () => {
    it('should return true when complexity data exists', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ data_exists: true }],
        rowCount: 1,
      });

      const result = await service.checkDataExists();
      expect(result).toBe(true);
    });

    it('should return false when no complexity data exists', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ data_exists: false }],
        rowCount: 1,
      });

      const result = await service.checkDataExists();
      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      vi.mocked(mockDb.query).mockRejectedValueOnce(new Error('Connection failed'));

      const result = await service.checkDataExists();
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // getFilterOptions (GITX-134)
  // ==========================================================================
  describe('getFilterOptions', () => {
    it('should return filter options including techStacks', async () => {
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [{ team: 'Platform' }, { team: 'Frontend' }], rowCount: 2 })
        .mockResolvedValueOnce({ rows: [{ contributor: 'Alice' }, { contributor: 'Bob' }], rowCount: 2 })
        .mockResolvedValueOnce({ rows: [{ repository: 'app' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ category: 'Frontend' }, { category: 'Backend' }], rowCount: 2 });

      const result = await service.getFilterOptions();

      expect(result.teams).toEqual(['Platform', 'Frontend']);
      expect(result.contributors).toEqual(['Alice', 'Bob']);
      expect(result.repositories).toEqual(['app']);
      expect(result.techStacks).toEqual(['Frontend', 'Backend']);
    });

    it('should return empty arrays on database error', async () => {
      vi.mocked(mockDb.query).mockRejectedValue(new Error('Connection failed'));

      const result = await service.getFilterOptions();

      expect(result).toEqual({
        teams: [],
        contributors: [],
        repositories: [],
        techStacks: [],
      });
    });
  });

  // ==========================================================================
  // getComplexityTrend - Basic functionality
  // ==========================================================================
  describe('getComplexityTrend', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getComplexityTrend({
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });
      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return mapped complexity data', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            date: '2025-01-15',
            group_key: 'Alice',
            avg_complexity: '12.5',
            total_complexity: '125',
            complexity_delta: '5',
            max_complexity: '20',
            commit_count: '3',
            file_count: '7',
          },
        ],
        rowCount: 1,
      });

      const result = await service.getComplexityTrend({
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        date: '2025-01-15',
        groupKey: 'Alice',
        avgComplexity: 12.5,
        totalComplexity: 125,
        complexityDelta: 5,
        maxComplexity: 20,
        commitCount: 3,
        fileCount: 7,
      });
    });

    it('should handle Date objects in result', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          {
            date: new Date('2025-01-15T00:00:00Z'),
            group_key: 'Bob',
            avg_complexity: 8.2,
            complexity_delta: -2,
            max_complexity: 15,
            commit_count: 2,
            file_count: 4,
          },
        ],
        rowCount: 1,
      });

      const result = await service.getComplexityTrend({
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      expect(result[0]?.date).toBe('2025-01-15');
    });
  });

  // ==========================================================================
  // getComplexityTrend - viewMode parameter (GITX-136)
  // ==========================================================================
  describe('viewMode parameter', () => {
    const testCases: { viewMode: ComplexityTrendViewMode; expectedFragment: string }[] = [
      { viewMode: 'contributor', expectedFragment: 'COALESCE(cc.full_name, ch.author)' },
      { viewMode: 'team', expectedFragment: "COALESCE(cc.team, 'Unassigned')" },
      { viewMode: 'repository', expectedFragment: 'ch.repository' },
      { viewMode: 'archLayer', expectedFragment: 'vtsc.category' },
    ];

    testCases.forEach(({ viewMode, expectedFragment }) => {
      it(`should use correct group_key expression for viewMode="${viewMode}"`, async () => {
        await service.getComplexityTrend({
          viewMode,
          startDate: '2025-01-01',
          endDate: '2025-03-01',
        });

        const call = vi.mocked(mockDb.query).mock.calls[0];
        expect(call).toBeDefined();
        const sql = call![0] as string;
        expect(sql).toContain(expectedFragment);
      });
    });

    it('should include tech stack JOIN when viewMode is archLayer', async () => {
      await service.getComplexityTrend({
        viewMode: 'archLayer',
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain('vw_technology_stack_category');
    });

    it('should include tech stack JOIN when techStack filter is set', async () => {
      await service.getComplexityTrend({
        viewMode: 'contributor',
        techStack: 'Frontend',
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain('vw_technology_stack_category');
    });

    it('should reject invalid viewMode values', async () => {
      const invalidViewMode = "'; DROP TABLE commit_files; --" as ComplexityTrendViewMode;

      await expect(
        service.getComplexityTrend({
          viewMode: invalidViewMode,
          startDate: '2025-01-01',
          endDate: '2025-03-01',
        }),
      ).rejects.toThrow('Invalid viewMode');
    });
  });

  // ==========================================================================
  // getComplexityTrend - techStack filter validation (GITX-134)
  // ==========================================================================
  describe('techStack filter validation', () => {
    const validTechStacks = [
      'Audio',
      'Backend',
      'Configuration',
      'Database',
      'Dev Ops',
      'Document',
      'Frontend',
      'Image',
      'Multimedia',
      'Other',
      'Process Automation',
      'Reports',
      'Testing',
    ];

    validTechStacks.forEach((techStack) => {
      it(`should accept valid techStack "${techStack}"`, async () => {
        await service.getComplexityTrend({
          techStack,
          startDate: '2025-01-01',
          endDate: '2025-03-01',
        });
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });
    });

    it('should reject invalid techStack category', async () => {
      await expect(
        service.getComplexityTrend({
          techStack: 'InvalidCategory',
          startDate: '2025-01-01',
          endDate: '2025-03-01',
        }),
      ).rejects.toThrow('Invalid tech stack category');
    });

    it('should reject SQL injection in techStack', async () => {
      await expect(
        service.getComplexityTrend({
          techStack: "Frontend'; DROP TABLE--",
          startDate: '2025-01-01',
          endDate: '2025-03-01',
        }),
      ).rejects.toThrow('Invalid tech stack category');
    });

    it('should reject techStack exceeding max length', async () => {
      const longTechStack = 'A'.repeat(201);
      await expect(
        service.getComplexityTrend({
          techStack: longTechStack,
          startDate: '2025-01-01',
          endDate: '2025-03-01',
        }),
      ).rejects.toThrow('Tech stack filter exceeds maximum length');
    });

    it('should include techStack filter as parameterized value', async () => {
      await service.getComplexityTrend({
        techStack: 'Frontend',
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];
      expect(params).toContain('Frontend');
    });
  });

  // ==========================================================================
  // getComplexityTrend - period parameter (GITX-136: weekly, monthly, annual)
  // ==========================================================================
  describe('period parameter', () => {
    it('should use weekly aggregation for period=weekly', async () => {
      await service.getComplexityTrend({
        period: 'weekly',
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain("DATE_TRUNC('week'");
    });

    it('should use monthly aggregation for period=monthly', async () => {
      await service.getComplexityTrend({
        period: 'monthly',
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain("DATE_TRUNC('month'");
    });

    it('should use annual aggregation for period=annual', async () => {
      await service.getComplexityTrend({
        period: 'annual',
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain("DATE_TRUNC('year'");
    });

    it('should reject invalid period values', async () => {
      await expect(
        service.getComplexityTrend({
          period: 'invalid' as 'weekly',
          startDate: '2025-01-01',
          endDate: '2025-03-01',
        }),
      ).rejects.toThrow('Invalid period');
    });

    it('should reject daily period (removed in GITX-136)', async () => {
      await expect(
        service.getComplexityTrend({
          period: 'daily' as 'weekly',
          startDate: '2025-01-01',
          endDate: '2025-03-01',
        }),
      ).rejects.toThrow('Invalid period');
    });
  });

  // ==========================================================================
  // Input Validation (CWE-20, CWE-89)
  // ==========================================================================
  describe('input validation', () => {
    describe('date validation', () => {
      it('should accept valid date strings', async () => {
        await service.getComplexityTrend({
          startDate: '2025-01-01',
          endDate: '2025-12-31',
        });
        expect(mockDb.query).toHaveBeenCalledTimes(1);
      });

      it('should reject malformed startDate', async () => {
        await expect(
          service.getComplexityTrend({
            startDate: 'not-a-date',
          }),
        ).rejects.toThrow('Invalid start date');
      });

      it('should reject malformed endDate', async () => {
        await expect(
          service.getComplexityTrend({
            endDate: '2025/13/45',
          }),
        ).rejects.toThrow('Invalid end date');
      });

      it('should reject reversed date range', async () => {
        await expect(
          service.getComplexityTrend({
            startDate: '2025-12-31',
            endDate: '2025-01-01',
          }),
        ).rejects.toThrow('Start date must be before');
      });

      it('should reject date range exceeding 730 days', async () => {
        await expect(
          service.getComplexityTrend({
            startDate: '2022-01-01',
            endDate: '2025-12-31',
          }),
        ).rejects.toThrow('Date range exceeds maximum');
      });
    });

    describe('filter string validation', () => {
      it('should reject team filter exceeding 200 characters', async () => {
        const longTeam = 'A'.repeat(201);
        await expect(
          service.getComplexityTrend({
            team: longTeam,
            startDate: '2025-01-01',
            endDate: '2025-03-01',
          }),
        ).rejects.toThrow('Team filter exceeds maximum length');
      });

      it('should reject contributor filter exceeding 200 characters', async () => {
        const longContributor = 'B'.repeat(201);
        await expect(
          service.getComplexityTrend({
            contributor: longContributor,
            startDate: '2025-01-01',
            endDate: '2025-03-01',
          }),
        ).rejects.toThrow('Contributor filter exceeds maximum length');
      });

      it('should reject repository filter exceeding 200 characters', async () => {
        const longRepo = 'C'.repeat(201);
        await expect(
          service.getComplexityTrend({
            repository: longRepo,
            startDate: '2025-01-01',
            endDate: '2025-03-01',
          }),
        ).rejects.toThrow('Repository filter exceeds maximum length');
      });
    });
  });

  // ==========================================================================
  // Query builder - parameterized queries
  // ==========================================================================
  describe('parameterized queries', () => {
    it('should pass date filters as parameterized values', async () => {
      await service.getComplexityTrend({
        startDate: '2025-01-01',
        endDate: '2025-06-30',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];
      expect(params).toContain('2025-01-01');
      expect(params).toContain('2025-06-30');
    });

    it('should pass team filter as parameterized value', async () => {
      await service.getComplexityTrend({
        team: 'Platform',
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];
      expect(params).toContain('Platform');
    });

    it('should pass contributor filter as parameterized value', async () => {
      await service.getComplexityTrend({
        contributor: 'Alice',
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];
      expect(params).toContain('Alice');
    });

    it('should pass repository filter as parameterized value', async () => {
      await service.getComplexityTrend({
        repository: 'my-app',
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];
      expect(params).toContain('my-app');
    });

    it('should combine multiple filters correctly', async () => {
      await service.getComplexityTrend({
        team: 'Platform',
        techStack: 'Frontend',
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      // Both filters should be present as parameters
      expect(params).toContain('Platform');
      expect(params).toContain('Frontend');

      // SQL should contain both filter clauses
      expect(sql).toContain('cc.team');
      expect(sql).toContain('vtsc.category');
    });
  });

  // ==========================================================================
  // getChartData
  // ==========================================================================
  describe('getChartData', () => {
    it('should return empty data when complexity data does not exist', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [{ data_exists: false }],
        rowCount: 1,
      });

      const result = await service.getChartData({
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      expect(result).toEqual({ data: [], hasData: false });
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return data when complexity data exists', async () => {
      vi.mocked(mockDb.query)
        .mockResolvedValueOnce({ rows: [{ data_exists: true }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            {
              date: '2025-01-15',
              group_key: 'Alice',
              avg_complexity: 12.5,
              total_complexity: 125,
              complexity_delta: 5,
              max_complexity: 20,
              commit_count: 3,
              file_count: 7,
            },
          ],
          rowCount: 1,
        });

      const result = await service.getChartData({
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      expect(result.hasData).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  // ==========================================================================
  // getEntityRankings (GITX-136)
  // ==========================================================================
  describe('getEntityRankings', () => {
    it('should return entity rankings sorted by total complexity', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { entity: 'Alice', total_complexity: 500 },
          { entity: 'Bob', total_complexity: 300 },
          { entity: 'Charlie', total_complexity: 200 },
        ],
        rowCount: 3,
      });

      const result = await service.getEntityRankings('contributor', {
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ entity: 'Alice', totalComplexity: 500 });
      expect(result[1]).toEqual({ entity: 'Bob', totalComplexity: 300 });
      expect(result[2]).toEqual({ entity: 'Charlie', totalComplexity: 200 });
    });

    it('should use correct entity expression for contributor viewMode', async () => {
      await service.getEntityRankings('contributor', {
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain('COALESCE(cc.full_name, ch.author)');
    });

    it('should use correct entity expression for team viewMode', async () => {
      await service.getEntityRankings('team', {
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain("COALESCE(cc.team, 'Unassigned')");
    });

    it('should use correct entity expression for repository viewMode', async () => {
      await service.getEntityRankings('repository', {
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain('ch.repository');
    });

    it('should use correct entity expression for archLayer viewMode', async () => {
      await service.getEntityRankings('archLayer', {
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain('vtsc.category');
    });

    it('should include tech stack JOIN for archLayer viewMode', async () => {
      await service.getEntityRankings('archLayer', {
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain('vw_technology_stack_category');
    });

    it('should apply pre-filters to ranking query', async () => {
      await service.getEntityRankings('contributor', {
        startDate: '2025-01-01',
        endDate: '2025-03-01',
        team: 'Platform',
        repository: 'my-app',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];
      expect(params).toContain('2025-01-01');
      expect(params).toContain('2025-03-01');
      expect(params).toContain('Platform');
      expect(params).toContain('my-app');
    });

    it('should throw error on database error', async () => {
      vi.mocked(mockDb.query).mockRejectedValueOnce(new Error('Connection failed'));

      await expect(
        service.getEntityRankings('contributor', {
          startDate: '2025-01-01',
          endDate: '2025-03-01',
        }),
      ).rejects.toThrow('Connection failed');
    });

    it('should reject invalid viewMode', async () => {
      const invalidViewMode = "'; DROP TABLE--" as ComplexityTrendViewMode;

      await expect(
        service.getEntityRankings(invalidViewMode, {
          startDate: '2025-01-01',
          endDate: '2025-03-01',
        }),
      ).rejects.toThrow('Invalid viewMode');
    });
  });
});
