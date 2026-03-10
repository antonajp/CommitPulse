import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { HotSpotsDataService } from '../../services/hot-spots-data-service.js';
import { HOT_SPOTS_MAX_FILTER_LENGTH } from '../../services/hot-spots-data-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for HotSpotsDataService (IQS-901).
 * Tests the data service layer for the Hot Spots dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - Risk tier validation
 * - Numeric filter validation (minChurn, minComplexity)
 * - String filter length validation (DoS prevention)
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 */
describe('HotSpotsDataService', () => {
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

      const service = new HotSpotsDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.checkViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getHotSpots', () => {
    it('should return mapped hot spot data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/services/complex-service.ts',
            repository: 'gitr',
            churn_count: 15,
            last_changed: '2024-06-15',
            contributor_count: 4,
            complexity: 75,
            loc: 500,
            bug_count: 3,
            risk_score: 0.85,
            risk_tier: 'critical',
          },
        ],
        rowCount: 1,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.getHotSpots();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        filePath: 'src/services/complex-service.ts',
        repository: 'gitr',
        churnCount: 15,
        lastChanged: '2024-06-15',
        contributorCount: 4,
        complexity: 75,
        loc: 500,
        bugCount: 3,
        riskScore: 0.85,
        riskTier: 'critical',
      });
    });

    it('should handle Date objects in last_changed column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/utils/helper.ts',
            repository: 'gitr',
            churn_count: 5,
            last_changed: new Date('2024-06-10T00:00:00Z'),
            contributor_count: 2,
            complexity: 20,
            loc: 150,
            bug_count: 0,
            risk_score: 0.35,
            risk_tier: 'medium',
          },
        ],
        rowCount: 1,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.getHotSpots();

      expect(result).toHaveLength(1);
      expect(result[0]?.lastChanged).toBe('2024-06-10');
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.getHotSpots();

      expect(result).toHaveLength(0);
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new HotSpotsDataService(mockDb);
      await service.getHotSpots({ repository: 'gitr' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['gitr'],
      );
    });

    it('should use risk tier query when riskTier provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new HotSpotsDataService(mockDb);
      await service.getHotSpots({ riskTier: 'critical' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('risk_tier = $1'),
        ['critical'],
      );
    });

    it('should use min churn query when minChurn provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new HotSpotsDataService(mockDb);
      await service.getHotSpots({ minChurn: 5 });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('churn_count >= $1'),
        [5],
      );
    });

    it('should use min complexity query when minComplexity provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new HotSpotsDataService(mockDb);
      await service.getHotSpots({ minComplexity: 25 });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('complexity >= $1'),
        [25],
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new HotSpotsDataService(mockDb);
      await service.getHotSpots({
        repository: 'gitr',
        riskTier: 'high',
        minChurn: 3,
        minComplexity: 10,
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1 OR $1 IS NULL'),
        ['gitr', 'high', 3, 10],
      );
    });

    it('should throw on repository filter exceeding max length', async () => {
      const service = new HotSpotsDataService(mockDb);
      const longRepo = 'r'.repeat(HOT_SPOTS_MAX_FILTER_LENGTH + 1);

      await expect(
        service.getHotSpots({ repository: longRepo }),
      ).rejects.toThrow(`repository exceeds maximum length of ${HOT_SPOTS_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw on invalid risk tier', async () => {
      const service = new HotSpotsDataService(mockDb);

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.getHotSpots({ riskTier: 'invalid' as any }),
      ).rejects.toThrow('Invalid risk tier: invalid');
    });

    it('should throw on negative minChurn', async () => {
      const service = new HotSpotsDataService(mockDb);

      await expect(
        service.getHotSpots({ minChurn: -1 }),
      ).rejects.toThrow('minChurn must be a non-negative integer');
    });

    it('should throw on non-integer minChurn', async () => {
      const service = new HotSpotsDataService(mockDb);

      await expect(
        service.getHotSpots({ minChurn: 3.5 }),
      ).rejects.toThrow('minChurn must be a non-negative integer');
    });

    it('should throw on negative minComplexity', async () => {
      const service = new HotSpotsDataService(mockDb);

      await expect(
        service.getHotSpots({ minComplexity: -10 }),
      ).rejects.toThrow('minComplexity must be a non-negative integer');
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/legacy/old-code.ts',
            repository: 'gitr',
            churn_count: '20',
            last_changed: '2024-06-01',
            contributor_count: '5',
            complexity: '100',
            loc: '800',
            bug_count: '7',
            risk_score: '0.92',
            risk_tier: 'critical',
          },
        ],
        rowCount: 1,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.getHotSpots();

      expect(typeof result[0]?.churnCount).toBe('number');
      expect(result[0]?.churnCount).toBe(20);
      expect(typeof result[0]?.complexity).toBe('number');
      expect(result[0]?.complexity).toBe(100);
      expect(typeof result[0]?.riskScore).toBe('number');
      expect(result[0]?.riskScore).toBe(0.92);
    });
  });

  describe('getHotSpotsSummary', () => {
    it('should return summary statistics by risk tier', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            risk_tier: 'critical',
            file_count: 5,
            avg_churn: 15.5,
            avg_complexity: 80.0,
            total_bugs: 12,
          },
          {
            risk_tier: 'high',
            file_count: 15,
            avg_churn: 8.2,
            avg_complexity: 45.0,
            total_bugs: 8,
          },
          {
            risk_tier: 'medium',
            file_count: 30,
            avg_churn: 4.5,
            avg_complexity: 18.0,
            total_bugs: 3,
          },
          {
            risk_tier: 'low',
            file_count: 100,
            avg_churn: 1.8,
            avg_complexity: 5.0,
            total_bugs: 0,
          },
        ],
        rowCount: 4,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.getHotSpotsSummary();

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({
        risk_tier: 'critical',
        file_count: 5,
        avg_churn: 15.5,
        avg_complexity: 80.0,
        total_bugs: 12,
      });
    });

    it('should handle empty summary', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.getHotSpotsSummary();

      expect(result).toHaveLength(0);
    });
  });

  describe('getChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new HotSpotsDataService(mockDb);
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
      // 2. getHotSpots
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/complex-module.ts',
            repository: 'gitr',
            churn_count: 12,
            last_changed: '2024-06-20',
            contributor_count: 3,
            complexity: 65,
            loc: 450,
            bug_count: 2,
            risk_score: 0.78,
            risk_tier: 'high',
          },
        ],
        rowCount: 1,
      });

      const service = new HotSpotsDataService(mockDb);
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
      // 2. getHotSpots
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(true);
      expect(result.rows).toHaveLength(0);
    });

    it('should pass filters to getHotSpots', async () => {
      // 1. checkViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getHotSpots with filters
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new HotSpotsDataService(mockDb);
      await service.getChartData({
        repository: 'gitr',
        riskTier: 'critical',
      });

      // Second query should have combined filter params
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      const secondCall = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall?.[1]).toEqual(['gitr', 'critical', null, null]);
    });
  });

  describe('risk score calculation', () => {
    it('should handle zero values in risk score', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/new-file.ts',
            repository: 'gitr',
            churn_count: 1,
            last_changed: '2024-06-25',
            contributor_count: 1,
            complexity: 0,
            loc: 10,
            bug_count: 0,
            risk_score: 0.0,
            risk_tier: 'low',
          },
        ],
        rowCount: 1,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.getHotSpots();

      expect(result[0]?.riskScore).toBe(0);
      expect(result[0]?.riskTier).toBe('low');
    });
  });

  describe('risk tier categorization', () => {
    it('should return correct risk tier for critical files', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/critical-module.ts',
            repository: 'gitr',
            churn_count: 15,
            last_changed: '2024-06-25',
            contributor_count: 6,
            complexity: 100,
            loc: 800,
            bug_count: 5,
            risk_score: 0.95,
            risk_tier: 'critical',
          },
        ],
        rowCount: 1,
      });

      const service = new HotSpotsDataService(mockDb);
      const result = await service.getHotSpots({ riskTier: 'critical' });

      expect(result[0]?.riskTier).toBe('critical');
      // Critical: churn >= 10 AND complexity >= 50
      expect(result[0]?.churnCount).toBeGreaterThanOrEqual(10);
      expect(result[0]?.complexity).toBeGreaterThanOrEqual(50);
    });
  });
});
