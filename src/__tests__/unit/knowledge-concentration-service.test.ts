import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { KnowledgeConcentrationDataService } from '../../services/knowledge-concentration-service.js';
import { KNOWLEDGE_MAX_FILTER_LENGTH } from '../../services/knowledge-concentration-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for KnowledgeConcentrationDataService (IQS-903).
 * Tests the data service layer for the Knowledge Concentration dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - Concentration risk validation
 * - Bus factor calculation edge cases
 * - Numeric filter validation
 * - String filter length validation (DoS prevention)
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 */
describe('KnowledgeConcentrationDataService', () => {
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

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });
  });

  describe('checkModuleViewExists', () => {
    it('should return true when module view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.checkModuleViewExists();

      expect(result).toBe(true);
    });

    it('should return false when module view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.checkModuleViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getFileOwnership', () => {
    it('should return mapped file ownership data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/services/complex-service.ts',
            repository: 'gitr',
            total_commits: 20,
            total_contributors: 3,
            top_contributor: 'user1',
            top_contributor_pct: 85.0,
            top_contributor_last_active: '2024-06-15',
            second_contributor: 'user2',
            second_contributor_pct: 10.0,
            concentration_risk: 'high',
            bus_factor: 1,
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        filePath: 'src/services/complex-service.ts',
        repository: 'gitr',
        totalCommits: 20,
        totalContributors: 3,
        topContributor: 'user1',
        topContributorPct: 85.0,
        topContributorLastActive: '2024-06-15',
        secondContributor: 'user2',
        secondContributorPct: 10.0,
        concentrationRisk: 'high',
        busFactor: 1,
      });
    });

    it('should handle Date objects in top_contributor_last_active column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/utils/helper.ts',
            repository: 'gitr',
            total_commits: 10,
            total_contributors: 2,
            top_contributor: 'user1',
            top_contributor_pct: 70.0,
            top_contributor_last_active: new Date('2024-06-10T00:00:00Z'),
            second_contributor: 'user2',
            second_contributor_pct: 30.0,
            concentration_risk: 'medium',
            bus_factor: 2,
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership();

      expect(result).toHaveLength(1);
      expect(result[0]?.topContributorLastActive).toBe('2024-06-10');
    });

    it('should handle null second contributor', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/solo-file.ts',
            repository: 'gitr',
            total_commits: 5,
            total_contributors: 1,
            top_contributor: 'user1',
            top_contributor_pct: 100.0,
            top_contributor_last_active: '2024-06-20',
            second_contributor: null,
            second_contributor_pct: null,
            concentration_risk: 'critical',
            bus_factor: 1,
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership();

      expect(result).toHaveLength(1);
      expect(result[0]?.secondContributor).toBeNull();
      expect(result[0]?.secondContributorPct).toBeNull();
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership();

      expect(result).toHaveLength(0);
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      await service.getFileOwnership({ repository: 'gitr' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['gitr'],
      );
    });

    it('should use concentration risk query when concentrationRisk provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      await service.getFileOwnership({ concentrationRisk: 'critical' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('concentration_risk = $1'),
        ['critical'],
      );
    });

    it('should use contributor query when contributor provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      await service.getFileOwnership({ contributor: 'user1' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('top_contributor = $1 OR second_contributor = $1'),
        ['user1'],
      );
    });

    it('should use max bus factor query when maxBusFactor provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      await service.getFileOwnership({ maxBusFactor: 1 });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('bus_factor <= $1'),
        [1],
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      await service.getFileOwnership({
        repository: 'gitr',
        concentrationRisk: 'high',
        contributor: 'user1',
        maxBusFactor: 2,
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1 OR $1 IS NULL'),
        ['gitr', 'high', 'user1', 2],
      );
    });

    it('should throw on repository filter exceeding max length', async () => {
      const service = new KnowledgeConcentrationDataService(mockDb);
      const longRepo = 'r'.repeat(KNOWLEDGE_MAX_FILTER_LENGTH + 1);

      await expect(
        service.getFileOwnership({ repository: longRepo }),
      ).rejects.toThrow(`repository exceeds maximum length of ${KNOWLEDGE_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw on contributor filter exceeding max length', async () => {
      const service = new KnowledgeConcentrationDataService(mockDb);
      const longContributor = 'c'.repeat(KNOWLEDGE_MAX_FILTER_LENGTH + 1);

      await expect(
        service.getFileOwnership({ contributor: longContributor }),
      ).rejects.toThrow(`contributor exceeds maximum length of ${KNOWLEDGE_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw on invalid concentration risk', async () => {
      const service = new KnowledgeConcentrationDataService(mockDb);

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.getFileOwnership({ concentrationRisk: 'invalid' as any }),
      ).rejects.toThrow('Invalid concentration risk: invalid');
    });

    it('should throw on negative maxBusFactor', async () => {
      const service = new KnowledgeConcentrationDataService(mockDb);

      await expect(
        service.getFileOwnership({ maxBusFactor: -1 }),
      ).rejects.toThrow('maxBusFactor must be a non-negative integer');
    });

    it('should throw on non-integer maxBusFactor', async () => {
      const service = new KnowledgeConcentrationDataService(mockDb);

      await expect(
        service.getFileOwnership({ maxBusFactor: 1.5 }),
      ).rejects.toThrow('maxBusFactor must be a non-negative integer');
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/legacy/old-code.ts',
            repository: 'gitr',
            total_commits: '25',
            total_contributors: '5',
            top_contributor: 'user1',
            top_contributor_pct: '92.5',
            top_contributor_last_active: '2024-06-01',
            second_contributor: 'user2',
            second_contributor_pct: '5.0',
            concentration_risk: 'critical',
            bus_factor: '1',
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership();

      expect(typeof result[0]?.totalCommits).toBe('number');
      expect(result[0]?.totalCommits).toBe(25);
      expect(typeof result[0]?.topContributorPct).toBe('number');
      expect(result[0]?.topContributorPct).toBe(92.5);
      expect(typeof result[0]?.busFactor).toBe('number');
      expect(result[0]?.busFactor).toBe(1);
    });
  });

  describe('getSummary', () => {
    it('should return summary statistics by concentration risk', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            concentration_risk: 'critical',
            file_count: 5,
            avg_bus_factor: 1.0,
            avg_contributors: 1.2,
            avg_top_contributor_pct: 95.0,
          },
          {
            concentration_risk: 'high',
            file_count: 15,
            avg_bus_factor: 1.3,
            avg_contributors: 2.1,
            avg_top_contributor_pct: 82.0,
          },
          {
            concentration_risk: 'medium',
            file_count: 30,
            avg_bus_factor: 2.0,
            avg_contributors: 3.5,
            avg_top_contributor_pct: 65.0,
          },
          {
            concentration_risk: 'low',
            file_count: 100,
            avg_bus_factor: 3.0,
            avg_contributors: 5.0,
            avg_top_contributor_pct: 35.0,
          },
        ],
        rowCount: 4,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getSummary();

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({
        concentration_risk: 'critical',
        file_count: 5,
        avg_bus_factor: 1.0,
        avg_contributors: 1.2,
        avg_top_contributor_pct: 95.0,
      });
    });

    it('should handle empty summary', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getSummary();

      expect(result).toHaveLength(0);
    });
  });

  describe('getModuleBusFactor', () => {
    it('should return mapped module bus factor data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            repository: 'gitr',
            module_path: 'src/services',
            file_count: 15,
            avg_bus_factor: 1.5,
            min_bus_factor: 1,
            high_risk_files: 5,
            critical_risk_files: 2,
            avg_contributors: 2.5,
            primary_owner: 'user1',
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getModuleBusFactor();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        repository: 'gitr',
        modulePath: 'src/services',
        fileCount: 15,
        avgBusFactor: 1.5,
        minBusFactor: 1,
        highRiskFiles: 5,
        criticalRiskFiles: 2,
        avgContributors: 2.5,
        primaryOwner: 'user1',
      });
    });

    it('should use repository filter when provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      await service.getModuleBusFactor({ repository: 'gitr' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['gitr'],
      );
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getModuleBusFactor();

      expect(result).toHaveLength(0);
    });
  });

  describe('getHighRiskModules', () => {
    it('should return only modules with high-risk files', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            repository: 'gitr',
            module_path: 'src/legacy',
            file_count: 10,
            avg_bus_factor: 1.2,
            min_bus_factor: 1,
            high_risk_files: 8,
            critical_risk_files: 5,
            avg_contributors: 1.5,
            primary_owner: 'user1',
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getHighRiskModules();

      expect(result).toHaveLength(1);
      expect(result[0]?.highRiskFiles).toBeGreaterThan(0);
    });
  });

  describe('getChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
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
      // 2. getFileOwnership
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/complex-module.ts',
            repository: 'gitr',
            total_commits: 50,
            total_contributors: 4,
            top_contributor: 'user1',
            top_contributor_pct: 75.0,
            top_contributor_last_active: '2024-06-20',
            second_contributor: 'user2',
            second_contributor_pct: 15.0,
            concentration_risk: 'medium',
            bus_factor: 2,
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.filePath).toBe('src/complex-module.ts');
    });

    it('should return hasData false when view exists but no data', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getFileOwnership
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(true);
      expect(result.rows).toHaveLength(0);
    });

    it('should pass filters to getFileOwnership', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getFileOwnership with filters
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      await service.getChartData({
        repository: 'gitr',
        concentrationRisk: 'critical',
      });

      // Second query should have combined filter params
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      const secondCall = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall?.[1]).toEqual(['gitr', 'critical', null, null]);
    });
  });

  describe('getModuleChartData', () => {
    it('should return empty data when module view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getModuleChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.rows).toHaveLength(0);
    });

    it('should return data when module view exists and has data', async () => {
      // 1. checkModuleViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getModuleBusFactor
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            repository: 'gitr',
            module_path: 'src/services',
            file_count: 20,
            avg_bus_factor: 1.8,
            min_bus_factor: 1,
            high_risk_files: 6,
            critical_risk_files: 2,
            avg_contributors: 3.0,
            primary_owner: 'user1',
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getModuleChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.modulePath).toBe('src/services');
    });
  });

  describe('bus factor calculation edge cases', () => {
    it('should handle single contributor (bus factor = 1)', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/new-file.ts',
            repository: 'gitr',
            total_commits: 5,
            total_contributors: 1,
            top_contributor: 'user1',
            top_contributor_pct: 100.0,
            top_contributor_last_active: '2024-06-25',
            second_contributor: null,
            second_contributor_pct: null,
            concentration_risk: 'critical',
            bus_factor: 1,
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership();

      expect(result[0]?.busFactor).toBe(1);
      expect(result[0]?.totalContributors).toBe(1);
      expect(result[0]?.concentrationRisk).toBe('critical');
    });

    it('should handle equal contributor split (bus factor > 1)', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/shared-file.ts',
            repository: 'gitr',
            total_commits: 20,
            total_contributors: 4,
            top_contributor: 'user1',
            top_contributor_pct: 30.0,
            top_contributor_last_active: '2024-06-25',
            second_contributor: 'user2',
            second_contributor_pct: 25.0,
            concentration_risk: 'low',
            bus_factor: 3,
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership();

      expect(result[0]?.busFactor).toBe(3);
      expect(result[0]?.concentrationRisk).toBe('low');
    });
  });

  describe('concentration risk categorization', () => {
    it('should return correct risk for critical files (>= 90%)', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/critical-file.ts',
            repository: 'gitr',
            total_commits: 10,
            total_contributors: 1,
            top_contributor: 'user1',
            top_contributor_pct: 95.0,
            top_contributor_last_active: '2024-06-25',
            second_contributor: null,
            second_contributor_pct: null,
            concentration_risk: 'critical',
            bus_factor: 1,
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership({ concentrationRisk: 'critical' });

      expect(result[0]?.concentrationRisk).toBe('critical');
      expect(result[0]?.topContributorPct).toBeGreaterThanOrEqual(90);
    });

    it('should return correct risk for high files (>= 80%, < 90%)', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/high-risk-file.ts',
            repository: 'gitr',
            total_commits: 20,
            total_contributors: 2,
            top_contributor: 'user1',
            top_contributor_pct: 85.0,
            top_contributor_last_active: '2024-06-25',
            second_contributor: 'user2',
            second_contributor_pct: 15.0,
            concentration_risk: 'high',
            bus_factor: 1,
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership({ concentrationRisk: 'high' });

      expect(result[0]?.concentrationRisk).toBe('high');
      expect(result[0]?.topContributorPct).toBeGreaterThanOrEqual(80);
      expect(result[0]?.topContributorPct).toBeLessThan(90);
    });

    it('should return correct risk for medium files (>= 60%, < 80%)', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/medium-risk-file.ts',
            repository: 'gitr',
            total_commits: 30,
            total_contributors: 3,
            top_contributor: 'user1',
            top_contributor_pct: 70.0,
            top_contributor_last_active: '2024-06-25',
            second_contributor: 'user2',
            second_contributor_pct: 20.0,
            concentration_risk: 'medium',
            bus_factor: 2,
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership({ concentrationRisk: 'medium' });

      expect(result[0]?.concentrationRisk).toBe('medium');
      expect(result[0]?.topContributorPct).toBeGreaterThanOrEqual(60);
      expect(result[0]?.topContributorPct).toBeLessThan(80);
    });

    it('should return correct risk for low files (< 60%)', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/well-distributed-file.ts',
            repository: 'gitr',
            total_commits: 50,
            total_contributors: 5,
            top_contributor: 'user1',
            top_contributor_pct: 40.0,
            top_contributor_last_active: '2024-06-25',
            second_contributor: 'user2',
            second_contributor_pct: 25.0,
            concentration_risk: 'low',
            bus_factor: 3,
          },
        ],
        rowCount: 1,
      });

      const service = new KnowledgeConcentrationDataService(mockDb);
      const result = await service.getFileOwnership({ concentrationRisk: 'low' });

      expect(result[0]?.concentrationRisk).toBe('low');
      expect(result[0]?.topContributorPct).toBeLessThan(60);
    });
  });
});
