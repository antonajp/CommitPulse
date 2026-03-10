import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { ArchitectureDriftDataService } from '../../services/architecture-drift-service.js';
import { DRIFT_MAX_FILTER_LENGTH } from '../../services/architecture-drift-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for ArchitectureDriftDataService (IQS-917).
 * Tests the data service layer for the Architecture Drift Heat Map Dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - Drift severity validation
 * - Heat intensity validation
 * - String filter length validation (DoS prevention)
 * - Date filter validation
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 * - Heat map data building
 */
describe('ArchitectureDriftDataService', () => {
  let mockDb: DatabaseService;

  beforeEach(() => {
    _clearMocks();
    try {
      LoggerService.getInstance().dispose();
    } catch {
      /* ignore */
    }
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
    try {
      LoggerService.getInstance().dispose();
    } catch {
      /* ignore */
    }
    LoggerService.resetInstance();
  });

  describe('checkDriftViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.checkDriftViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.checkDriftViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.checkDriftViewExists();

      expect(result).toBe(false);
    });
  });

  describe('checkCrossComponentViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.checkCrossComponentViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.checkCrossComponentViewExists();

      expect(result).toBe(false);
    });
  });

  describe('checkWeeklyDriftViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.checkWeeklyDriftViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.checkWeeklyDriftViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getCrossComponentCommits', () => {
    it('should return mapped cross-component commit data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: '2024-06-15',
            author: 'developer1',
            repository: 'test-repo',
            branch: 'main',
            commit_message: 'feat: Cross-component change',
            file_count: 8,
            lines_added: 200,
            lines_removed: 50,
            full_name: 'Developer One',
            team: 'Engineering',
            component_count: 3,
            components_touched: ['api', 'database', 'auth'],
            total_files_changed: 8,
            total_lines_added: 200,
            total_lines_removed: 50,
            drift_severity: 'medium',
            drift_score: 50,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getCrossComponentCommits();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        sha: 'abc123',
        commitDate: '2024-06-15',
        author: 'developer1',
        repository: 'test-repo',
        branch: 'main',
        commitMessage: 'feat: Cross-component change',
        fileCount: 8,
        linesAdded: 200,
        linesRemoved: 50,
        fullName: 'Developer One',
        team: 'Engineering',
        componentCount: 3,
        componentsTouched: ['api', 'database', 'auth'],
        totalFilesChanged: 8,
        totalLinesAdded: 200,
        totalLinesRemoved: 50,
        driftSeverity: 'medium',
        driftScore: 50,
      });
    });

    it('should handle Date objects in commit_date column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'def456',
            commit_date: new Date('2024-06-10T00:00:00Z'),
            author: 'developer2',
            repository: 'test-repo',
            branch: 'feature',
            commit_message: 'fix: Bug fix',
            file_count: 4,
            lines_added: 30,
            lines_removed: 10,
            full_name: 'Developer Two',
            team: 'Platform',
            component_count: 2,
            components_touched: ['api', 'utils'],
            total_files_changed: 4,
            total_lines_added: 30,
            total_lines_removed: 10,
            drift_severity: 'low',
            drift_score: 25,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getCrossComponentCommits();

      expect(result).toHaveLength(1);
      expect(result[0]?.commitDate).toBe('2024-06-10');
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getCrossComponentCommits();

      expect(result).toHaveLength(0);
    });

    it('should use date range query when startDate and endDate provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getCrossComponentCommits({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('commit_date >= $1::DATE AND commit_date <= $2::DATE'),
        ['2024-06-01', '2024-06-30']
      );
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getCrossComponentCommits({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['test-repo']
      );
    });

    it('should use severity query when severity provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getCrossComponentCommits({ severity: 'critical' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('drift_severity = $1'),
        ['critical']
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getCrossComponentCommits({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        repository: 'test-repo',
        severity: 'high',
        author: 'developer1',
        team: 'Engineering',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $3 OR $3 IS NULL'),
        ['2024-06-01', '2024-06-30', 'test-repo', 'high', 'developer1', 'Engineering']
      );
    });

    it('should throw on repository filter exceeding max length', async () => {
      const service = new ArchitectureDriftDataService(mockDb);
      const longRepo = 'r'.repeat(DRIFT_MAX_FILTER_LENGTH + 1);

      await expect(service.getCrossComponentCommits({ repository: longRepo })).rejects.toThrow(
        `repository exceeds maximum length of ${DRIFT_MAX_FILTER_LENGTH} characters`
      );
    });

    it('should throw on invalid severity', async () => {
      const service = new ArchitectureDriftDataService(mockDb);

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.getCrossComponentCommits({ severity: 'invalid' as any })
      ).rejects.toThrow('Invalid drift severity: invalid');
    });

    it('should throw on invalid start date format', async () => {
      const service = new ArchitectureDriftDataService(mockDb);

      await expect(
        service.getCrossComponentCommits({ startDate: 'not-a-date', endDate: '2024-06-30' })
      ).rejects.toThrow('Invalid start date format: not-a-date');
    });

    it('should throw on invalid end date format', async () => {
      const service = new ArchitectureDriftDataService(mockDb);

      await expect(
        service.getCrossComponentCommits({ startDate: '2024-06-01', endDate: 'not-a-date' })
      ).rejects.toThrow('Invalid end date format: not-a-date');
    });

    it('should throw on start date after end date', async () => {
      const service = new ArchitectureDriftDataService(mockDb);

      await expect(
        service.getCrossComponentCommits({ startDate: '2024-06-30', endDate: '2024-06-01' })
      ).rejects.toThrow('Invalid date range: start date (2024-06-30) must be before end date (2024-06-01)');
    });
  });

  describe('getArchitectureDrift', () => {
    it('should return mapped drift data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            component: 'api',
            repository: 'test-repo',
            cross_component_commits: 15,
            total_commits: 50,
            drift_percentage: 30.0,
            total_churn: 5000,
            avg_components_per_commit: 2.5,
            critical_count: 2,
            high_count: 5,
            medium_count: 5,
            low_count: 3,
            unique_authors: 4,
            unique_teams: 2,
            first_drift_date: '2024-01-15',
            last_drift_date: '2024-06-20',
            heat_intensity: 65.0,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getArchitectureDrift();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        component: 'api',
        repository: 'test-repo',
        crossComponentCommits: 15,
        totalCommits: 50,
        driftPercentage: 30.0,
        totalChurn: 5000,
        avgComponentsPerCommit: 2.5,
        criticalCount: 2,
        highCount: 5,
        mediumCount: 5,
        lowCount: 3,
        uniqueAuthors: 4,
        uniqueTeams: 2,
        firstDriftDate: '2024-01-15',
        lastDriftDate: '2024-06-20',
        heatIntensity: 65.0,
      });
    });

    it('should handle null dates', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            component: 'utils',
            repository: 'test-repo',
            cross_component_commits: 0,
            total_commits: 20,
            drift_percentage: 0,
            total_churn: 0,
            avg_components_per_commit: 0,
            critical_count: 0,
            high_count: 0,
            medium_count: 0,
            low_count: 0,
            unique_authors: 0,
            unique_teams: 0,
            first_drift_date: null,
            last_drift_date: null,
            heat_intensity: 0,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getArchitectureDrift();

      expect(result[0]?.firstDriftDate).toBeNull();
      expect(result[0]?.lastDriftDate).toBeNull();
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getArchitectureDrift({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['test-repo']
      );
    });

    it('should use component query when component provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getArchitectureDrift({ component: 'api' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('component = $1'),
        ['api']
      );
    });

    it('should use min intensity query when minHeatIntensity provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getArchitectureDrift({ minHeatIntensity: 50 });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('heat_intensity >= $1'),
        [50]
      );
    });

    it('should throw on invalid minHeatIntensity (negative)', async () => {
      const service = new ArchitectureDriftDataService(mockDb);

      await expect(
        service.getArchitectureDrift({ minHeatIntensity: -10 })
      ).rejects.toThrow('Invalid minHeatIntensity: must be between 0 and 100');
    });

    it('should throw on invalid minHeatIntensity (over 100)', async () => {
      const service = new ArchitectureDriftDataService(mockDb);

      await expect(
        service.getArchitectureDrift({ minHeatIntensity: 150 })
      ).rejects.toThrow('Invalid minHeatIntensity: must be between 0 and 100');
    });
  });

  describe('getWeeklyDriftTrends', () => {
    it('should return mapped weekly trend data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week: '2024-06-10',
            component: 'api',
            repository: 'test-repo',
            cross_component_commits: 5,
            total_commits: 15,
            drift_percentage: 33.33,
            weekly_churn: 1500,
            avg_components: 2.2,
            critical_count: 1,
            high_count: 2,
            medium_count: 1,
            low_count: 1,
            unique_authors: 3,
            heat_intensity: 55.0,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getWeeklyDriftTrends();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        week: '2024-06-10',
        component: 'api',
        repository: 'test-repo',
        crossComponentCommits: 5,
        totalCommits: 15,
        driftPercentage: 33.33,
        weeklyChurn: 1500,
        avgComponents: 2.2,
        criticalCount: 1,
        highCount: 2,
        mediumCount: 1,
        lowCount: 1,
        uniqueAuthors: 3,
        heatIntensity: 55.0,
      });
    });

    it('should handle Date objects in week column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week: new Date('2024-06-17T00:00:00Z'),
            component: 'database',
            repository: 'test-repo',
            cross_component_commits: 3,
            total_commits: 10,
            drift_percentage: 30.0,
            weekly_churn: 800,
            avg_components: 2.0,
            critical_count: 0,
            high_count: 1,
            medium_count: 1,
            low_count: 1,
            unique_authors: 2,
            heat_intensity: 40.0,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getWeeklyDriftTrends();

      expect(result[0]?.week).toBe('2024-06-17');
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getWeeklyDriftTrends({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['test-repo']
      );
    });

    it('should use component query when component provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getWeeklyDriftTrends({ component: 'api' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('component = $1'),
        ['api']
      );
    });
  });

  describe('getComponentPairCoupling', () => {
    it('should return mapped coupling data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            component_a: 'api',
            component_b: 'database',
            repository: 'test-repo',
            coupling_count: 25,
            unique_commits: 20,
            unique_authors: 5,
            unique_teams: 2,
            critical_count: 3,
            high_count: 7,
            first_coupling_date: '2024-01-10',
            last_coupling_date: '2024-06-25',
            coupling_strength: 45.0,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getComponentPairCoupling();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        componentA: 'api',
        componentB: 'database',
        repository: 'test-repo',
        couplingCount: 25,
        uniqueCommits: 20,
        uniqueAuthors: 5,
        uniqueTeams: 2,
        criticalCount: 3,
        highCount: 7,
        firstCouplingDate: '2024-01-10',
        lastCouplingDate: '2024-06-25',
        couplingStrength: 45.0,
      });
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getComponentPairCoupling({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['test-repo']
      );
    });

    it('should use component query when component provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      await service.getComponentPairCoupling({ component: 'api' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('component_a = $1 OR component_b = $1'),
        ['api']
      );
    });
  });

  describe('getSummary', () => {
    it('should return mapped summary data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            total_cross_component_commits: 150,
            total_components: 12,
            avg_drift_percentage: 28.5,
            max_heat_intensity: 85.0,
            highest_drift_component: 'api',
            total_critical: 15,
            total_high: 35,
            total_medium: 50,
            total_low: 50,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getSummary();

      expect(result).toEqual({
        totalCrossComponentCommits: 150,
        totalComponents: 12,
        avgDriftPercentage: 28.5,
        maxHeatIntensity: 85.0,
        highestDriftComponent: 'api',
        totalCritical: 15,
        totalHigh: 35,
        totalMedium: 50,
        totalLow: 50,
      });
    });

    it('should return default values when no data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getSummary();

      expect(result).toEqual({
        totalCrossComponentCommits: 0,
        totalComponents: 0,
        avgDriftPercentage: 0,
        maxHeatIntensity: 0,
        highestDriftComponent: null,
        totalCritical: 0,
        totalHigh: 0,
        totalMedium: 0,
        totalLow: 0,
      });
    });
  });

  describe('buildHeatMapData', () => {
    it('should build heat map data from weekly trends', () => {
      const service = new ArchitectureDriftDataService(mockDb);
      const trends = [
        {
          week: '2024-06-10',
          component: 'api',
          repository: 'test-repo',
          crossComponentCommits: 5,
          totalCommits: 15,
          driftPercentage: 33.33,
          weeklyChurn: 1500,
          avgComponents: 2.2,
          criticalCount: 1,
          highCount: 2,
          mediumCount: 1,
          lowCount: 1,
          uniqueAuthors: 3,
          heatIntensity: 55.0,
        },
        {
          week: '2024-06-10',
          component: 'database',
          repository: 'test-repo',
          crossComponentCommits: 3,
          totalCommits: 10,
          driftPercentage: 30.0,
          weeklyChurn: 800,
          avgComponents: 2.0,
          criticalCount: 0,
          highCount: 1,
          mediumCount: 1,
          lowCount: 1,
          uniqueAuthors: 2,
          heatIntensity: 40.0,
        },
        {
          week: '2024-06-17',
          component: 'api',
          repository: 'test-repo',
          crossComponentCommits: 7,
          totalCommits: 20,
          driftPercentage: 35.0,
          weeklyChurn: 2000,
          avgComponents: 2.5,
          criticalCount: 2,
          highCount: 3,
          mediumCount: 1,
          lowCount: 1,
          uniqueAuthors: 4,
          heatIntensity: 70.0,
        },
      ];

      const result = service.buildHeatMapData(trends);

      expect(result.components).toEqual(['api', 'database']);
      expect(result.weeks).toEqual(['2024-06-10', '2024-06-17']);
      expect(result.cells).toHaveLength(3);
      expect(result.cells[0]).toEqual({
        component: 'api',
        week: '2024-06-10',
        intensity: 55.0,
        commitCount: 5,
      });
    });

    it('should handle empty trends', () => {
      const service = new ArchitectureDriftDataService(mockDb);
      const result = service.buildHeatMapData([]);

      expect(result.components).toEqual([]);
      expect(result.weeks).toEqual([]);
      expect(result.cells).toEqual([]);
    });
  });

  describe('getArchitectureDriftData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getArchitectureDriftData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.driftData).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // 1. checkDriftViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getArchitectureDrift
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            component: 'api',
            repository: 'test-repo',
            cross_component_commits: 15,
            total_commits: 50,
            drift_percentage: 30.0,
            total_churn: 5000,
            avg_components_per_commit: 2.5,
            critical_count: 2,
            high_count: 5,
            medium_count: 5,
            low_count: 3,
            unique_authors: 4,
            unique_teams: 2,
            first_drift_date: '2024-01-15',
            last_drift_date: '2024-06-20',
            heat_intensity: 65.0,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getArchitectureDriftData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.driftData).toHaveLength(1);
      expect(result.driftData[0]?.component).toBe('api');
    });
  });

  describe('getCrossComponentCommitData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getCrossComponentCommitData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.commits).toHaveLength(0);
    });
  });

  describe('getHeatMapChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getHeatMapChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.driftData).toHaveLength(0);
      expect(result.heatMapData.cells).toHaveLength(0);
    });

    it('should return complete chart data when views exist', async () => {
      // 1. checkDriftViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getArchitectureDrift
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            component: 'api',
            repository: 'test-repo',
            cross_component_commits: 15,
            total_commits: 50,
            drift_percentage: 30.0,
            total_churn: 5000,
            avg_components_per_commit: 2.5,
            critical_count: 2,
            high_count: 5,
            medium_count: 5,
            low_count: 3,
            unique_authors: 4,
            unique_teams: 2,
            first_drift_date: '2024-01-15',
            last_drift_date: '2024-06-20',
            heat_intensity: 65.0,
          },
        ],
        rowCount: 1,
      });
      // 3. getWeeklyDriftTrends
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week: '2024-06-10',
            component: 'api',
            repository: 'test-repo',
            cross_component_commits: 5,
            total_commits: 15,
            drift_percentage: 33.33,
            weekly_churn: 1500,
            avg_components: 2.2,
            critical_count: 1,
            high_count: 2,
            medium_count: 1,
            low_count: 1,
            unique_authors: 3,
            heat_intensity: 55.0,
          },
        ],
        rowCount: 1,
      });
      // 4. getComponentPairCoupling
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            component_a: 'api',
            component_b: 'database',
            repository: 'test-repo',
            coupling_count: 25,
            unique_commits: 20,
            unique_authors: 5,
            unique_teams: 2,
            critical_count: 3,
            high_count: 7,
            first_coupling_date: '2024-01-10',
            last_coupling_date: '2024-06-25',
            coupling_strength: 45.0,
          },
        ],
        rowCount: 1,
      });
      // 5. getSummary
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            total_cross_component_commits: 150,
            total_components: 12,
            avg_drift_percentage: 28.5,
            max_heat_intensity: 85.0,
            highest_drift_component: 'api',
            total_critical: 15,
            total_high: 35,
            total_medium: 50,
            total_low: 50,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getHeatMapChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.driftData).toHaveLength(1);
      expect(result.heatMapData.cells).toHaveLength(1);
      expect(result.couplingData).toHaveLength(1);
      expect(result.summary.totalComponents).toBe(12);
    });
  });

  describe('drift severity handling', () => {
    it('should correctly map critical severity', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'critical123',
            commit_date: '2024-06-25',
            author: 'dev-critical',
            repository: 'test-repo',
            branch: 'main',
            commit_message: 'feat: Major cross-component change',
            file_count: 20,
            lines_added: 500,
            lines_removed: 100,
            full_name: 'Critical Dev',
            team: 'Engineering',
            component_count: 5,
            components_touched: ['api', 'database', 'auth', 'utils', 'core'],
            total_files_changed: 20,
            total_lines_added: 500,
            total_lines_removed: 100,
            drift_severity: 'critical',
            drift_score: 100,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getCrossComponentCommits({ severity: 'critical' });

      expect(result[0]?.driftSeverity).toBe('critical');
      expect(result[0]?.componentCount).toBeGreaterThanOrEqual(5);
    });

    it('should correctly map low severity', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'low123',
            commit_date: '2024-06-25',
            author: 'dev-low',
            repository: 'test-repo',
            branch: 'main',
            commit_message: 'fix: Minor cross-component fix',
            file_count: 4,
            lines_added: 30,
            lines_removed: 10,
            full_name: 'Low Dev',
            team: 'Platform',
            component_count: 2,
            components_touched: ['api', 'utils'],
            total_files_changed: 4,
            total_lines_added: 30,
            total_lines_removed: 10,
            drift_severity: 'low',
            drift_score: 25,
          },
        ],
        rowCount: 1,
      });

      const service = new ArchitectureDriftDataService(mockDb);
      const result = await service.getCrossComponentCommits({ severity: 'low' });

      expect(result[0]?.driftSeverity).toBe('low');
      expect(result[0]?.componentCount).toBe(2);
    });
  });
});
