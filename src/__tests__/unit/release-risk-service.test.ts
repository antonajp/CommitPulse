import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { ReleaseRiskService } from '../../services/release-risk-service.js';
import { RELEASE_RISK_MAX_FILTER_LENGTH } from '../../services/release-risk-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for ReleaseRiskService (IQS-911).
 * Tests the data service layer for the Release Risk Gauge Dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - Risk category validation
 * - String filter length validation (DoS prevention)
 * - Date filter validation
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 */
describe('ReleaseRiskService', () => {
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

  describe('checkCommitRiskViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.checkCommitRiskViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.checkCommitRiskViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.checkCommitRiskViewExists();

      expect(result).toBe(false);
    });
  });

  describe('checkReleaseRiskViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.checkReleaseRiskViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.checkReleaseRiskViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getCommitRisks', () => {
    it('should return mapped commit risk data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: '2024-06-15',
            author: 'developer1',
            branch: 'main',
            repository: 'test-repo',
            commit_message: 'feat: Add new feature\n\nDetailed description',
            full_name: 'Developer One',
            team: 'Engineering',
            ticket_id: 'TEST-123',
            complexity_delta: 25,
            loc_delta: 150,
            file_count: 5,
            test_file_count: 2,
            complexity_risk: 0.45,
            test_coverage_risk: 0.6,
            experience_risk: 0.3,
            hotspot_risk: 0.2,
            total_risk: 0.4,
            risk_category: 'medium',
          },
        ],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getCommitRisks();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        sha: 'abc123',
        commitDate: '2024-06-15',
        author: 'developer1',
        branch: 'main',
        repository: 'test-repo',
        commitMessageSummary: 'feat: Add new feature',
        fullName: 'Developer One',
        team: 'Engineering',
        ticketId: 'TEST-123',
        complexityDelta: 25,
        locDelta: 150,
        fileCount: 5,
        testFileCount: 2,
        complexityRisk: 0.45,
        testCoverageRisk: 0.6,
        experienceRisk: 0.3,
        hotspotRisk: 0.2,
        totalRisk: 0.4,
        riskCategory: 'medium',
      });
    });

    it('should handle Date objects in commit_date column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'def456',
            commit_date: new Date('2024-06-10T00:00:00Z'),
            author: 'developer2',
            branch: 'feature',
            repository: 'test-repo',
            commit_message: 'fix: Bug fix',
            full_name: 'Developer Two',
            team: 'Engineering',
            ticket_id: 'TEST-456',
            complexity_delta: 5,
            loc_delta: 20,
            file_count: 2,
            test_file_count: 1,
            complexity_risk: 0.1,
            test_coverage_risk: 0.5,
            experience_risk: 0.2,
            hotspot_risk: 0.0,
            total_risk: 0.2,
            risk_category: 'low',
          },
        ],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getCommitRisks();

      expect(result).toHaveLength(1);
      expect(result[0]?.commitDate).toBe('2024-06-10');
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getCommitRisks();

      expect(result).toHaveLength(0);
    });

    it('should use date range query when startDate and endDate provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      await service.getCommitRisks({
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

      const service = new ReleaseRiskService(mockDb);
      await service.getCommitRisks({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['test-repo']
      );
    });

    it('should use branch query when branch provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      await service.getCommitRisks({ branch: 'main' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('branch = $1'),
        ['main']
      );
    });

    it('should use risk category query when riskCategory provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      await service.getCommitRisks({ riskCategory: 'critical' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('risk_category = $1'),
        ['critical']
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      await service.getCommitRisks({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        repository: 'test-repo',
        branch: 'main',
        riskCategory: 'high',
        team: 'Engineering',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $3 OR $3 IS NULL'),
        ['2024-06-01', '2024-06-30', 'test-repo', 'main', 'high', 'Engineering']
      );
    });

    it('should throw on repository filter exceeding max length', async () => {
      const service = new ReleaseRiskService(mockDb);
      const longRepo = 'r'.repeat(RELEASE_RISK_MAX_FILTER_LENGTH + 1);

      await expect(service.getCommitRisks({ repository: longRepo })).rejects.toThrow(
        `repository exceeds maximum length of ${RELEASE_RISK_MAX_FILTER_LENGTH} characters`
      );
    });

    it('should throw on branch filter exceeding max length', async () => {
      const service = new ReleaseRiskService(mockDb);
      const longBranch = 'b'.repeat(RELEASE_RISK_MAX_FILTER_LENGTH + 1);

      await expect(service.getCommitRisks({ branch: longBranch })).rejects.toThrow(
        `branch exceeds maximum length of ${RELEASE_RISK_MAX_FILTER_LENGTH} characters`
      );
    });

    it('should throw on invalid risk category', async () => {
      const service = new ReleaseRiskService(mockDb);

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.getCommitRisks({ riskCategory: 'invalid' as any })
      ).rejects.toThrow('Invalid risk category: invalid');
    });

    it('should throw on invalid start date format', async () => {
      const service = new ReleaseRiskService(mockDb);

      await expect(
        service.getCommitRisks({ startDate: 'not-a-date', endDate: '2024-06-30' })
      ).rejects.toThrow('Invalid start date format: not-a-date');
    });

    it('should throw on invalid end date format', async () => {
      const service = new ReleaseRiskService(mockDb);

      await expect(
        service.getCommitRisks({ startDate: '2024-06-01', endDate: 'not-a-date' })
      ).rejects.toThrow('Invalid end date format: not-a-date');
    });

    it('should throw on start date after end date', async () => {
      const service = new ReleaseRiskService(mockDb);

      await expect(
        service.getCommitRisks({ startDate: '2024-06-30', endDate: '2024-06-01' })
      ).rejects.toThrow('Invalid date range: start date (2024-06-30) must be before end date (2024-06-01)');
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'ghi789',
            commit_date: '2024-06-20',
            author: 'developer3',
            branch: 'develop',
            repository: 'test-repo',
            commit_message: 'refactor: Code cleanup',
            full_name: 'Developer Three',
            team: 'Platform',
            ticket_id: null,
            complexity_delta: '10',
            loc_delta: '50',
            file_count: '3',
            test_file_count: '1',
            complexity_risk: '0.25',
            test_coverage_risk: '0.67',
            experience_risk: '0.15',
            hotspot_risk: '0.1',
            total_risk: '0.35',
            risk_category: 'medium',
          },
        ],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getCommitRisks();

      expect(typeof result[0]?.complexityDelta).toBe('number');
      expect(result[0]?.complexityDelta).toBe(10);
      expect(typeof result[0]?.totalRisk).toBe('number');
      expect(result[0]?.totalRisk).toBe(0.35);
    });
  });

  describe('getReleaseRisks', () => {
    it('should return mapped release risk summary data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            repository: 'test-repo',
            branch: 'main',
            commit_count: 25,
            first_commit_date: '2024-06-01',
            last_commit_date: '2024-06-30',
            release_risk_score: 0.45,
            risk_category: 'medium',
            avg_complexity_risk: 0.35,
            avg_test_coverage_risk: 0.55,
            avg_experience_risk: 0.25,
            avg_hotspot_risk: 0.15,
            critical_commit_count: 2,
            high_commit_count: 5,
            medium_commit_count: 10,
            low_commit_count: 8,
            max_risk: 0.85,
          },
        ],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getReleaseRisks();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        repository: 'test-repo',
        branch: 'main',
        commitCount: 25,
        firstCommitDate: '2024-06-01',
        lastCommitDate: '2024-06-30',
        releaseRiskScore: 0.45,
        riskCategory: 'medium',
        riskBreakdown: {
          avgComplexityRisk: 0.35,
          avgTestCoverageRisk: 0.55,
          avgExperienceRisk: 0.25,
          avgHotspotRisk: 0.15,
        },
        riskDistribution: {
          criticalCount: 2,
          highCount: 5,
          mediumCount: 10,
          lowCount: 8,
        },
        maxRisk: 0.85,
      });
    });

    it('should handle Date objects in date columns', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            repository: 'test-repo',
            branch: 'feature',
            commit_count: 10,
            first_commit_date: new Date('2024-06-15T00:00:00Z'),
            last_commit_date: new Date('2024-06-20T00:00:00Z'),
            release_risk_score: 0.3,
            risk_category: 'medium',
            avg_complexity_risk: 0.2,
            avg_test_coverage_risk: 0.4,
            avg_experience_risk: 0.2,
            avg_hotspot_risk: 0.1,
            critical_commit_count: 0,
            high_commit_count: 2,
            medium_commit_count: 5,
            low_commit_count: 3,
            max_risk: 0.6,
          },
        ],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getReleaseRisks();

      expect(result[0]?.firstCommitDate).toBe('2024-06-15');
      expect(result[0]?.lastCommitDate).toBe('2024-06-20');
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getReleaseRisks();

      expect(result).toHaveLength(0);
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      await service.getReleaseRisks({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['test-repo']
      );
    });

    it('should use branch query when branch provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      await service.getReleaseRisks({ branch: 'main' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('branch = $1'),
        ['main']
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      await service.getReleaseRisks({
        repository: 'test-repo',
        branch: 'main',
        riskCategory: 'high',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1 OR $1 IS NULL'),
        ['test-repo', 'main', 'high']
      );
    });
  });

  describe('getCommitRiskChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getCommitRiskChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.commits).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // 1. checkCommitRiskViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getCommitRisks
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: '2024-06-15',
            author: 'developer1',
            branch: 'main',
            repository: 'test-repo',
            commit_message: 'feat: New feature',
            full_name: 'Developer One',
            team: 'Engineering',
            ticket_id: 'TEST-123',
            complexity_delta: 20,
            loc_delta: 100,
            file_count: 4,
            test_file_count: 2,
            complexity_risk: 0.4,
            test_coverage_risk: 0.5,
            experience_risk: 0.2,
            hotspot_risk: 0.1,
            total_risk: 0.35,
            risk_category: 'medium',
          },
        ],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getCommitRiskChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.commits).toHaveLength(1);
      expect(result.commits[0]?.sha).toBe('abc123');
    });

    it('should return hasData false when view exists but no data', async () => {
      // 1. checkCommitRiskViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getCommitRisks
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getCommitRiskChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(true);
      expect(result.commits).toHaveLength(0);
    });

    it('should pass filters to getCommitRisks', async () => {
      // 1. checkCommitRiskViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getCommitRisks with filters
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new ReleaseRiskService(mockDb);
      await service.getCommitRiskChartData({
        repository: 'test-repo',
        riskCategory: 'critical',
      });

      // Second query should have combined filter params
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      const secondCall = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall?.[1]).toEqual([null, null, 'test-repo', null, 'critical', null]);
    });
  });

  describe('getReleaseRiskSummaryData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getReleaseRiskSummaryData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.summaries).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // 1. checkReleaseRiskViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getReleaseRisks
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            repository: 'test-repo',
            branch: 'main',
            commit_count: 20,
            first_commit_date: '2024-06-01',
            last_commit_date: '2024-06-30',
            release_risk_score: 0.5,
            risk_category: 'high',
            avg_complexity_risk: 0.4,
            avg_test_coverage_risk: 0.6,
            avg_experience_risk: 0.3,
            avg_hotspot_risk: 0.2,
            critical_commit_count: 3,
            high_commit_count: 7,
            medium_commit_count: 6,
            low_commit_count: 4,
            max_risk: 0.9,
          },
        ],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getReleaseRiskSummaryData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.summaries).toHaveLength(1);
      expect(result.summaries[0]?.repository).toBe('test-repo');
    });
  });

  describe('risk category handling', () => {
    it('should correctly map critical risk category', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'critical123',
            commit_date: '2024-06-25',
            author: 'dev-critical',
            branch: 'main',
            repository: 'test-repo',
            commit_message: 'critical change',
            full_name: null,
            team: null,
            ticket_id: null,
            complexity_delta: 100,
            loc_delta: 500,
            file_count: 20,
            test_file_count: 0,
            complexity_risk: 0.9,
            test_coverage_risk: 1.0,
            experience_risk: 0.8,
            hotspot_risk: 0.9,
            total_risk: 0.9,
            risk_category: 'critical',
          },
        ],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getCommitRisks({ riskCategory: 'critical' });

      expect(result[0]?.riskCategory).toBe('critical');
      expect(result[0]?.totalRisk).toBeGreaterThanOrEqual(0.75);
    });

    it('should correctly map low risk category', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'low123',
            commit_date: '2024-06-25',
            author: 'dev-low',
            branch: 'main',
            repository: 'test-repo',
            commit_message: 'minor change',
            full_name: 'Developer Low',
            team: 'Engineering',
            ticket_id: 'TEST-789',
            complexity_delta: 1,
            loc_delta: 5,
            file_count: 1,
            test_file_count: 1,
            complexity_risk: 0.05,
            test_coverage_risk: 0.0,
            experience_risk: 0.1,
            hotspot_risk: 0.0,
            total_risk: 0.05,
            risk_category: 'low',
          },
        ],
        rowCount: 1,
      });

      const service = new ReleaseRiskService(mockDb);
      const result = await service.getCommitRisks({ riskCategory: 'low' });

      expect(result[0]?.riskCategory).toBe('low');
      expect(result[0]?.totalRisk).toBeLessThan(0.25);
    });
  });
});
