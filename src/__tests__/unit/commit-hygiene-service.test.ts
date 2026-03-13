import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { CommitHygieneDataService } from '../../services/commit-hygiene-service.js';
import { COMMIT_HYGIENE_MAX_FILTER_LENGTH } from '../../services/commit-hygiene-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for CommitHygieneDataService (IQS-915).
 * Tests the data service layer for the Commit Hygiene Tracker Dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - Quality tier validation
 * - Commit type validation
 * - String filter length validation (DoS prevention)
 * - Date filter validation
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 */
describe('CommitHygieneDataService', () => {
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

  describe('checkHygieneViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.checkHygieneViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.checkHygieneViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.checkHygieneViewExists();

      expect(result).toBe(false);
    });
  });

  describe('checkAuthorHygieneViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.checkAuthorHygieneViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.checkAuthorHygieneViewExists();

      expect(result).toBe(false);
    });
  });

  describe('checkWeeklyHygieneViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.checkWeeklyHygieneViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.checkWeeklyHygieneViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getCommitHygiene', () => {
    it('should return mapped commit hygiene data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: '2024-06-15',
            author: 'developer1',
            repository: 'test-repo',
            branch: 'main',
            commit_message_subject: 'feat(auth): Add login functionality',
            file_count: 5,
            lines_added: 150,
            lines_removed: 20,
            full_name: 'Developer One',
            team: 'Engineering',
            has_conventional_prefix: true,
            has_ticket_prefix: false,
            ticket_reference: null,
            commit_type: 'feat',
            has_scope: true,
            scope: 'auth',
            is_breaking_change: false,
            has_body: true,
            subject_length: 36,
            has_proper_capitalization: true,
            no_trailing_period: true,
            message_line_count: 5,
            prefix_score: 30,
            length_score: 20,
            capitalization_score: 10,
            period_score: 5,
            scope_score: 10,
            body_score: 15,
            breaking_change_score: 0,
            hygiene_score: 90,
            quality_tier: 'excellent',
            jira_ticket_id: 'TEST-123',
            linear_ticket_id: null,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getCommitHygiene();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        sha: 'abc123',
        commitDate: '2024-06-15',
        author: 'developer1',
        repository: 'test-repo',
        branch: 'main',
        commitMessageSubject: 'feat(auth): Add login functionality',
        fileCount: 5,
        linesAdded: 150,
        linesRemoved: 20,
        fullName: 'Developer One',
        team: 'Engineering',
        hasConventionalPrefix: true,
        hasTicketPrefix: false,
        ticketReference: null,
        commitType: 'feat',
        hasScope: true,
        scope: 'auth',
        isBreakingChange: false,
        hasBody: true,
        subjectLength: 36,
        hasProperCapitalization: true,
        noTrailingPeriod: true,
        messageLineCount: 5,
        prefixScore: 30,
        lengthScore: 20,
        capitalizationScore: 10,
        periodScore: 5,
        scopeScore: 10,
        bodyScore: 15,
        breakingChangeScore: 0,
        hygieneScore: 90,
        qualityTier: 'excellent',
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
            commit_message_subject: 'fix: Bug fix',
            file_count: 2,
            lines_added: 30,
            lines_removed: 5,
            full_name: 'Developer Two',
            team: 'Engineering',
            has_conventional_prefix: true,
            has_ticket_prefix: false,
            ticket_reference: null,
            commit_type: 'fix',
            has_scope: false,
            scope: null,
            is_breaking_change: false,
            has_body: false,
            subject_length: 12,
            has_proper_capitalization: true,
            no_trailing_period: true,
            message_line_count: 1,
            prefix_score: 30,
            length_score: 20,
            capitalization_score: 10,
            period_score: 5,
            scope_score: 0,
            body_score: 0,
            breaking_change_score: 0,
            hygiene_score: 65,
            quality_tier: 'good',
            jira_ticket_id: null,
            linear_ticket_id: null,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getCommitHygiene();

      expect(result).toHaveLength(1);
      expect(result[0]?.commitDate).toBe('2024-06-10');
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getCommitHygiene();

      expect(result).toHaveLength(0);
    });

    it('should use date range query when startDate and endDate provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      await service.getCommitHygiene({
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

      const service = new CommitHygieneDataService(mockDb);
      await service.getCommitHygiene({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['test-repo']
      );
    });

    it('should use quality tier query when qualityTier provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      await service.getCommitHygiene({ qualityTier: 'excellent' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('quality_tier = $1'),
        ['excellent']
      );
    });

    it('should use commit type query when commitType provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      await service.getCommitHygiene({ commitType: 'feat' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('commit_type = $1'),
        ['feat']
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      await service.getCommitHygiene({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        repository: 'test-repo',
        branch: 'main',
        qualityTier: 'excellent',
        commitType: 'feat',
        author: 'developer1',
        team: 'Engineering',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $3 OR $3 IS NULL'),
        ['2024-06-01', '2024-06-30', 'test-repo', 'main', 'excellent', 'feat', 'developer1', 'Engineering']
      );
    });

    it('should throw on repository filter exceeding max length', async () => {
      const service = new CommitHygieneDataService(mockDb);
      const longRepo = 'r'.repeat(COMMIT_HYGIENE_MAX_FILTER_LENGTH + 1);

      await expect(service.getCommitHygiene({ repository: longRepo })).rejects.toThrow(
        `repository exceeds maximum length of ${COMMIT_HYGIENE_MAX_FILTER_LENGTH} characters`
      );
    });

    it('should throw on branch filter exceeding max length', async () => {
      const service = new CommitHygieneDataService(mockDb);
      const longBranch = 'b'.repeat(COMMIT_HYGIENE_MAX_FILTER_LENGTH + 1);

      await expect(service.getCommitHygiene({ branch: longBranch })).rejects.toThrow(
        `branch exceeds maximum length of ${COMMIT_HYGIENE_MAX_FILTER_LENGTH} characters`
      );
    });

    it('should throw on invalid quality tier', async () => {
      const service = new CommitHygieneDataService(mockDb);

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.getCommitHygiene({ qualityTier: 'invalid' as any })
      ).rejects.toThrow('Invalid quality tier: invalid');
    });

    it('should throw on invalid commit type', async () => {
      const service = new CommitHygieneDataService(mockDb);

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.getCommitHygiene({ commitType: 'invalid' as any })
      ).rejects.toThrow('Invalid commit type: invalid');
    });

    it('should throw on invalid start date format', async () => {
      const service = new CommitHygieneDataService(mockDb);

      await expect(
        service.getCommitHygiene({ startDate: 'not-a-date', endDate: '2024-06-30' })
      ).rejects.toThrow('Invalid start date format: not-a-date');
    });

    it('should throw on invalid end date format', async () => {
      const service = new CommitHygieneDataService(mockDb);

      await expect(
        service.getCommitHygiene({ startDate: '2024-06-01', endDate: 'not-a-date' })
      ).rejects.toThrow('Invalid end date format: not-a-date');
    });

    it('should throw on start date after end date', async () => {
      const service = new CommitHygieneDataService(mockDb);

      await expect(
        service.getCommitHygiene({ startDate: '2024-06-30', endDate: '2024-06-01' })
      ).rejects.toThrow('Invalid date range: start date (2024-06-30) must be before end date (2024-06-01)');
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'ghi789',
            commit_date: '2024-06-20',
            author: 'developer3',
            repository: 'test-repo',
            branch: 'develop',
            commit_message_subject: 'refactor: Code cleanup',
            file_count: '3',
            lines_added: '50',
            lines_removed: '10',
            full_name: 'Developer Three',
            team: 'Platform',
            has_conventional_prefix: true,
            has_ticket_prefix: false,
            ticket_reference: null,
            commit_type: 'refactor',
            has_scope: false,
            scope: null,
            is_breaking_change: false,
            has_body: false,
            subject_length: '19',
            has_proper_capitalization: true,
            no_trailing_period: true,
            message_line_count: '1',
            prefix_score: '30',
            length_score: '20',
            capitalization_score: '10',
            period_score: '5',
            scope_score: '0',
            body_score: '0',
            breaking_change_score: '0',
            hygiene_score: '65',
            quality_tier: 'good',
            jira_ticket_id: null,
            linear_ticket_id: null,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getCommitHygiene();

      expect(typeof result[0]?.fileCount).toBe('number');
      expect(result[0]?.fileCount).toBe(3);
      expect(typeof result[0]?.hygieneScore).toBe('number');
      expect(result[0]?.hygieneScore).toBe(65);
    });
  });

  describe('getAuthorSummaries', () => {
    it('should return mapped author summary data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'developer1',
            full_name: 'Developer One',
            team: 'Engineering',
            repository: 'test-repo',
            total_commits: 50,
            conventional_commits: 45,
            scoped_commits: 30,
            commits_with_body: 25,
            breaking_changes: 2,
            excellent_count: 20,
            good_count: 20,
            fair_count: 8,
            poor_count: 2,
            feat_count: 25,
            fix_count: 15,
            docs_count: 3,
            refactor_count: 5,
            test_count: 2,
            chore_count: 0,
            other_count: 0,
            avg_hygiene_score: 78.5,
            avg_subject_length: 42.3,
            conventional_pct: 90.0,
            good_or_better_pct: 80.0,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getAuthorSummaries();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        author: 'developer1',
        fullName: 'Developer One',
        team: 'Engineering',
        repository: 'test-repo',
        totalCommits: 50,
        conventionalCommits: 45,
        scopedCommits: 30,
        commitsWithBody: 25,
        breakingChanges: 2,
        excellentCount: 20,
        goodCount: 20,
        fairCount: 8,
        poorCount: 2,
        featCount: 25,
        fixCount: 15,
        docsCount: 3,
        refactorCount: 5,
        testCount: 2,
        choreCount: 0,
        otherCount: 0,
        avgHygieneScore: 78.5,
        avgSubjectLength: 42.3,
        conventionalPct: 90.0,
        goodOrBetterPct: 80.0,
      });
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getAuthorSummaries();

      expect(result).toHaveLength(0);
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      await service.getAuthorSummaries({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['test-repo']
      );
    });

    it('should use team query when team provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      await service.getAuthorSummaries({ team: 'Engineering' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('team = $1'),
        ['Engineering']
      );
    });
  });

  describe('getWeeklyTrends', () => {
    it('should return mapped weekly trend data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week: '2024-06-10',
            repository: 'test-repo',
            total_commits: 25,
            conventional_commits: 20,
            excellent_count: 10,
            good_count: 8,
            fair_count: 5,
            poor_count: 2,
            feat_count: 12,
            fix_count: 8,
            other_type_count: 5,
            avg_hygiene_score: 72.5,
            conventional_pct: 80.0,
            good_or_better_pct: 72.0,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getWeeklyTrends();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        week: '2024-06-10',
        repository: 'test-repo',
        totalCommits: 25,
        conventionalCommits: 20,
        excellentCount: 10,
        goodCount: 8,
        fairCount: 5,
        poorCount: 2,
        featCount: 12,
        fixCount: 8,
        otherTypeCount: 5,
        avgHygieneScore: 72.5,
        conventionalPct: 80.0,
        goodOrBetterPct: 72.0,
      });
    });

    it('should handle Date objects in week column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week: new Date('2024-06-17T00:00:00Z'),
            repository: 'test-repo',
            total_commits: 30,
            conventional_commits: 28,
            excellent_count: 15,
            good_count: 10,
            fair_count: 4,
            poor_count: 1,
            feat_count: 14,
            fix_count: 10,
            other_type_count: 6,
            avg_hygiene_score: 82.0,
            conventional_pct: 93.3,
            good_or_better_pct: 83.3,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getWeeklyTrends();

      expect(result[0]?.week).toBe('2024-06-17');
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getWeeklyTrends();

      expect(result).toHaveLength(0);
    });

    it('should use repository query when repository provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      await service.getWeeklyTrends({ repository: 'test-repo' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $1'),
        ['test-repo']
      );
    });
  });

  describe('getCommitHygieneChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getCommitHygieneChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.commits).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // 1. checkHygieneViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getCommitHygiene
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'abc123',
            commit_date: '2024-06-15',
            author: 'developer1',
            repository: 'test-repo',
            branch: 'main',
            commit_message_subject: 'feat: New feature',
            file_count: 4,
            lines_added: 100,
            lines_removed: 10,
            full_name: 'Developer One',
            team: 'Engineering',
            has_conventional_prefix: true,
            has_ticket_prefix: false,
            ticket_reference: null,
            commit_type: 'feat',
            has_scope: false,
            scope: null,
            is_breaking_change: false,
            has_body: true,
            subject_length: 17,
            has_proper_capitalization: true,
            no_trailing_period: true,
            message_line_count: 3,
            prefix_score: 30,
            length_score: 20,
            capitalization_score: 10,
            period_score: 5,
            scope_score: 0,
            body_score: 15,
            breaking_change_score: 0,
            hygiene_score: 80,
            quality_tier: 'excellent',
            jira_ticket_id: null,
            linear_ticket_id: null,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getCommitHygieneChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.commits).toHaveLength(1);
      expect(result.commits[0]?.sha).toBe('abc123');
    });

    it('should return hasData false when view exists but no data', async () => {
      // 1. checkHygieneViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getCommitHygiene
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getCommitHygieneChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(true);
      expect(result.commits).toHaveLength(0);
    });

    it('should pass filters to getCommitHygiene', async () => {
      // 1. checkHygieneViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getCommitHygiene with filters
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new CommitHygieneDataService(mockDb);
      await service.getCommitHygieneChartData({
        repository: 'test-repo',
        qualityTier: 'excellent',
      });

      // Second query should have combined filter params
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      const secondCall = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall?.[1]).toEqual([null, null, 'test-repo', null, 'excellent', null, null, null]);
    });
  });

  describe('getAuthorSummaryData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getAuthorSummaryData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.summaries).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // 1. checkAuthorHygieneViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getAuthorSummaries
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            author: 'developer1',
            full_name: 'Developer One',
            team: 'Engineering',
            repository: 'test-repo',
            total_commits: 30,
            conventional_commits: 28,
            scoped_commits: 20,
            commits_with_body: 15,
            breaking_changes: 1,
            excellent_count: 15,
            good_count: 10,
            fair_count: 4,
            poor_count: 1,
            feat_count: 15,
            fix_count: 10,
            docs_count: 2,
            refactor_count: 3,
            test_count: 0,
            chore_count: 0,
            other_count: 0,
            avg_hygiene_score: 82.0,
            avg_subject_length: 45.0,
            conventional_pct: 93.3,
            good_or_better_pct: 83.3,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getAuthorSummaryData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.summaries).toHaveLength(1);
      expect(result.summaries[0]?.author).toBe('developer1');
    });
  });

  describe('getWeeklyTrendData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getWeeklyTrendData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.trends).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // 1. checkWeeklyHygieneViewExists
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });
      // 2. getWeeklyTrends
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            week: '2024-06-10',
            repository: 'test-repo',
            total_commits: 20,
            conventional_commits: 18,
            excellent_count: 10,
            good_count: 6,
            fair_count: 3,
            poor_count: 1,
            feat_count: 10,
            fix_count: 6,
            other_type_count: 4,
            avg_hygiene_score: 78.0,
            conventional_pct: 90.0,
            good_or_better_pct: 80.0,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getWeeklyTrendData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.trends).toHaveLength(1);
      expect(result.trends[0]?.week).toBe('2024-06-10');
    });
  });

  describe('quality tier handling', () => {
    it('should correctly map excellent quality tier', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'excellent123',
            commit_date: '2024-06-25',
            author: 'dev-excellent',
            repository: 'test-repo',
            branch: 'main',
            commit_message_subject: 'feat(auth): Add OAuth2 support',
            file_count: 10,
            lines_added: 300,
            lines_removed: 50,
            full_name: null,
            team: null,
            has_conventional_prefix: true,
            has_ticket_prefix: false,
            ticket_reference: null,
            commit_type: 'feat',
            has_scope: true,
            scope: 'auth',
            is_breaking_change: false,
            has_body: true,
            subject_length: 30,
            has_proper_capitalization: true,
            no_trailing_period: true,
            message_line_count: 8,
            prefix_score: 30,
            length_score: 20,
            capitalization_score: 10,
            period_score: 5,
            scope_score: 10,
            body_score: 15,
            breaking_change_score: 0,
            hygiene_score: 90,
            quality_tier: 'excellent',
            jira_ticket_id: null,
            linear_ticket_id: null,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getCommitHygiene({ qualityTier: 'excellent' });

      expect(result[0]?.qualityTier).toBe('excellent');
      expect(result[0]?.hygieneScore).toBeGreaterThanOrEqual(80);
    });

    it('should correctly map poor quality tier', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            sha: 'poor123',
            commit_date: '2024-06-25',
            author: 'dev-poor',
            repository: 'test-repo',
            branch: 'main',
            commit_message_subject: 'fixed stuff.',
            file_count: 5,
            lines_added: 50,
            lines_removed: 10,
            full_name: 'Developer Poor',
            team: 'Engineering',
            has_conventional_prefix: false,
            has_ticket_prefix: false,
            ticket_reference: null,
            commit_type: null,
            has_scope: false,
            scope: null,
            is_breaking_change: false,
            has_body: false,
            subject_length: 13,
            has_proper_capitalization: false,
            no_trailing_period: false,
            message_line_count: 1,
            prefix_score: 0,
            length_score: 20,
            capitalization_score: 0,
            period_score: 0,
            scope_score: 0,
            body_score: 0,
            breaking_change_score: 0,
            hygiene_score: 20,
            quality_tier: 'poor',
            jira_ticket_id: null,
            linear_ticket_id: null,
          },
        ],
        rowCount: 1,
      });

      const service = new CommitHygieneDataService(mockDb);
      const result = await service.getCommitHygiene({ qualityTier: 'poor' });

      expect(result[0]?.qualityTier).toBe('poor');
      expect(result[0]?.hygieneScore).toBeLessThan(40);
    });
  });
});
