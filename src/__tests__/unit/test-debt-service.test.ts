import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { TestDebtService } from '../../services/test-debt-service.js';
import { TEST_DEBT_MAX_FILTER_LENGTH, getTestCoverageTier } from '../../services/test-debt-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for TestDebtService (IQS-913).
 * Tests the data service layer for the Test Debt Predictor Dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - String filter length validation (DoS prevention)
 * - Date filter validation
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 * - Test coverage tier calculation
 */
describe('TestDebtService', () => {
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

  describe('checkTestDebtViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.checkTestDebtViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.checkTestDebtViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.checkTestDebtViewExists();

      expect(result).toBe(false);
    });
  });

  describe('checkCommitTestRatioViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.checkCommitTestRatioViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.checkCommitTestRatioViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getTestDebtTrend', () => {
    it('should return mapped weekly test debt data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week: '2024-06-10',
            repository: 'test-repo',
            low_test_commits: 5,
            medium_test_commits: 10,
            high_test_commits: 15,
            total_commits: 30,
            bugs_from_low_test: 3,
            bugs_from_medium_test: 1,
            bugs_from_high_test: 0,
            total_bugs: 4,
            low_test_bug_rate: 0.6,
            medium_test_bug_rate: 0.1,
            high_test_bug_rate: 0,
            avg_test_ratio: 0.35,
          },
        ],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getTestDebtTrend();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        week: '2024-06-10',
        repository: 'test-repo',
        lowTestCommits: 5,
        mediumTestCommits: 10,
        highTestCommits: 15,
        totalCommits: 30,
        bugsFromLowTest: 3,
        bugsFromMediumTest: 1,
        bugsFromHighTest: 0,
        totalBugs: 4,
        lowTestBugRate: 0.6,
        mediumTestBugRate: 0.1,
        highTestBugRate: 0,
        avgTestRatio: 0.35,
      });
    });

    it('should handle Date objects in week column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week: new Date('2024-06-10T00:00:00Z'),
            repository: 'test-repo',
            low_test_commits: 3,
            medium_test_commits: 5,
            high_test_commits: 7,
            total_commits: 15,
            bugs_from_low_test: 2,
            bugs_from_medium_test: 0,
            bugs_from_high_test: 0,
            total_bugs: 2,
            low_test_bug_rate: 0.67,
            medium_test_bug_rate: 0,
            high_test_bug_rate: 0,
            avg_test_ratio: 0.4,
          },
        ],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getTestDebtTrend();

      expect(result).toHaveLength(1);
      expect(result[0]?.week).toBe('2024-06-10');
    });

    it('should handle null avg_test_ratio', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week: '2024-06-10',
            repository: 'test-repo',
            low_test_commits: 5,
            medium_test_commits: 0,
            high_test_commits: 0,
            total_commits: 5,
            bugs_from_low_test: 2,
            bugs_from_medium_test: 0,
            bugs_from_high_test: 0,
            total_bugs: 2,
            low_test_bug_rate: 0.4,
            medium_test_bug_rate: null,
            high_test_bug_rate: null,
            avg_test_ratio: null,
          },
        ],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getTestDebtTrend();

      expect(result).toHaveLength(1);
      expect(result[0]?.avgTestRatio).toBeNull();
      expect(result[0]?.mediumTestBugRate).toBe(0);
      expect(result[0]?.highTestBugRate).toBe(0);
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getTestDebtTrend();

      expect(result).toHaveLength(0);
    });

    it('should use date range query when startDate and endDate provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      await service.getTestDebtTrend({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('week >= $1::DATE AND week <= $2::DATE'),
        ['2024-06-01', '2024-06-30']
      );
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      await service.getTestDebtTrend({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['test-repo']
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      await service.getTestDebtTrend({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        repository: 'test-repo',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $3 OR $3 IS NULL'),
        ['2024-06-01', '2024-06-30', 'test-repo']
      );
    });

    it('should throw on repository filter exceeding max length', async () => {
      const service = new TestDebtService(mockDb);
      const longRepo = 'r'.repeat(TEST_DEBT_MAX_FILTER_LENGTH + 1);

      await expect(service.getTestDebtTrend({ repository: longRepo })).rejects.toThrow(
        `repository exceeds maximum length of ${TEST_DEBT_MAX_FILTER_LENGTH} characters`
      );
    });

    it('should throw on invalid start date format', async () => {
      const service = new TestDebtService(mockDb);

      await expect(
        service.getTestDebtTrend({ startDate: 'not-a-date', endDate: '2024-06-30' })
      ).rejects.toThrow('Invalid start date format: not-a-date');
    });

    it('should throw on invalid end date format', async () => {
      const service = new TestDebtService(mockDb);

      await expect(
        service.getTestDebtTrend({ startDate: '2024-06-01', endDate: 'not-a-date' })
      ).rejects.toThrow('Invalid end date format: not-a-date');
    });

    it('should throw on start date after end date', async () => {
      const service = new TestDebtService(mockDb);

      await expect(
        service.getTestDebtTrend({ startDate: '2024-06-30', endDate: '2024-06-01' })
      ).rejects.toThrow(
        'Invalid date range: start date (2024-06-30) must be before end date (2024-06-01)'
      );
    });
  });

  describe('getLowTestCommits', () => {
    it('should return mapped commit test detail data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: '2024-06-15',
            author: 'developer1',
            repository: 'test-repo',
            branch: 'main',
            commit_message: 'feat: Add new feature without tests',
            prod_loc_changed: 150,
            test_loc_changed: 0,
            prod_files_changed: 5,
            test_files_changed: 0,
            test_ratio: null,
            jira_ticket_id: 'TEST-123',
            linear_ticket_id: null,
            subsequent_bugs: 3,
          },
        ],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getLowTestCommits();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        sha: 'abc123',
        commitDate: '2024-06-15',
        author: 'developer1',
        repository: 'test-repo',
        branch: 'main',
        commitMessage: 'feat: Add new feature without tests',
        prodLocChanged: 150,
        testLocChanged: 0,
        prodFilesChanged: 5,
        testFilesChanged: 0,
        testRatio: null,
        testCoverageTier: 'low',
        subsequentBugs: 3,
        jiraTicketId: 'TEST-123',
        linearTicketId: null,
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
            prod_loc_changed: 80,
            test_loc_changed: 5,
            prod_files_changed: 3,
            test_files_changed: 1,
            test_ratio: 0.06,
            jira_ticket_id: null,
            linear_ticket_id: 'LIN-456',
            subsequent_bugs: 1,
          },
        ],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getLowTestCommits();

      expect(result).toHaveLength(1);
      expect(result[0]?.commitDate).toBe('2024-06-10');
    });

    it('should calculate correct test coverage tier for low ratio', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'ghi789',
            commit_date: '2024-06-20',
            author: 'developer3',
            repository: 'test-repo',
            branch: 'develop',
            commit_message: 'refactor: Code cleanup',
            prod_loc_changed: 100,
            test_loc_changed: 5,
            prod_files_changed: 4,
            test_files_changed: 1,
            test_ratio: 0.05,
            jira_ticket_id: null,
            linear_ticket_id: null,
            subsequent_bugs: 0,
          },
        ],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getLowTestCommits();

      expect(result[0]?.testCoverageTier).toBe('low');
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getLowTestCommits();

      expect(result).toHaveLength(0);
    });

    it('should use date range query when startDate and endDate provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      await service.getLowTestCommits({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ctr.commit_date >= $1::DATE AND ctr.commit_date <= $2::DATE'),
        ['2024-06-01', '2024-06-30']
      );
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      await service.getLowTestCommits({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ctr.repository = $1'),
        ['test-repo']
      );
    });

    it('should use author query when author provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      await service.getLowTestCommits({ author: 'developer1' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ctr.author = $1'),
        ['developer1']
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      await service.getLowTestCommits({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        repository: 'test-repo',
        author: 'developer1',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ctr.repository = $3 OR $3 IS NULL'),
        ['2024-06-01', '2024-06-30', 'test-repo', 'developer1']
      );
    });

    it('should throw on author filter exceeding max length', async () => {
      const service = new TestDebtService(mockDb);
      const longAuthor = 'a'.repeat(TEST_DEBT_MAX_FILTER_LENGTH + 1);

      await expect(service.getLowTestCommits({ author: longAuthor })).rejects.toThrow(
        `author exceeds maximum length of ${TEST_DEBT_MAX_FILTER_LENGTH} characters`
      );
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'jkl012',
            commit_date: '2024-06-25',
            author: 'developer4',
            repository: 'test-repo',
            branch: 'main',
            commit_message: 'chore: Update deps',
            prod_loc_changed: '200',
            test_loc_changed: '10',
            prod_files_changed: '8',
            test_files_changed: '2',
            test_ratio: '0.05',
            jira_ticket_id: 'TEST-789',
            linear_ticket_id: null,
            subsequent_bugs: '2',
          },
        ],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getLowTestCommits();

      expect(typeof result[0]?.prodLocChanged).toBe('number');
      expect(result[0]?.prodLocChanged).toBe(200);
      expect(typeof result[0]?.testRatio).toBe('number');
      expect(result[0]?.testRatio).toBe(0.05);
      expect(typeof result[0]?.subsequentBugs).toBe('number');
      expect(result[0]?.subsequentBugs).toBe(2);
    });
  });

  describe('getTestDebtTrendData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getTestDebtTrendData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.weeks).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // 1. checkTestDebtViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getTestDebtTrend
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week: '2024-06-10',
            repository: 'test-repo',
            low_test_commits: 5,
            medium_test_commits: 10,
            high_test_commits: 15,
            total_commits: 30,
            bugs_from_low_test: 3,
            bugs_from_medium_test: 1,
            bugs_from_high_test: 0,
            total_bugs: 4,
            low_test_bug_rate: 0.6,
            medium_test_bug_rate: 0.1,
            high_test_bug_rate: 0,
            avg_test_ratio: 0.35,
          },
        ],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getTestDebtTrendData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.weeks).toHaveLength(1);
      expect(result.weeks[0]?.week).toBe('2024-06-10');
    });

    it('should return hasData false when view exists but no data', async () => {
      // 1. checkTestDebtViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getTestDebtTrend
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getTestDebtTrendData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(true);
      expect(result.weeks).toHaveLength(0);
    });

    it('should pass filters to getTestDebtTrend', async () => {
      // 1. checkTestDebtViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getTestDebtTrend with filters
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TestDebtService(mockDb);
      await service.getTestDebtTrendData({
        repository: 'test-repo',
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // Second query should have combined filter params
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      const secondCall = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall?.[1]).toEqual(['2024-06-01', '2024-06-30', 'test-repo']);
    });
  });

  describe('getLowTestCommitsData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getLowTestCommitsData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.commits).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // 1. checkCommitTestRatioViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getLowTestCommits
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: '2024-06-15',
            author: 'developer1',
            repository: 'test-repo',
            branch: 'main',
            commit_message: 'feat: Add new feature',
            prod_loc_changed: 150,
            test_loc_changed: 0,
            prod_files_changed: 5,
            test_files_changed: 0,
            test_ratio: null,
            jira_ticket_id: 'TEST-123',
            linear_ticket_id: null,
            subsequent_bugs: 3,
          },
        ],
        rowCount: 1,
      });

      const service = new TestDebtService(mockDb);
      const result = await service.getLowTestCommitsData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.commits).toHaveLength(1);
      expect(result.commits[0]?.sha).toBe('abc123');
    });
  });

  describe('getTestCoverageTier', () => {
    it('should return low for null ratio', () => {
      expect(getTestCoverageTier(null)).toBe('low');
    });

    it('should return low for ratio < 0.1', () => {
      expect(getTestCoverageTier(0)).toBe('low');
      expect(getTestCoverageTier(0.05)).toBe('low');
      expect(getTestCoverageTier(0.09)).toBe('low');
    });

    it('should return medium for ratio >= 0.1 and < 0.5', () => {
      expect(getTestCoverageTier(0.1)).toBe('medium');
      expect(getTestCoverageTier(0.25)).toBe('medium');
      expect(getTestCoverageTier(0.49)).toBe('medium');
    });

    it('should return high for ratio >= 0.5', () => {
      expect(getTestCoverageTier(0.5)).toBe('high');
      expect(getTestCoverageTier(0.75)).toBe('high');
      expect(getTestCoverageTier(1.0)).toBe('high');
      expect(getTestCoverageTier(1.5)).toBe('high'); // More test code than prod
    });
  });
});
