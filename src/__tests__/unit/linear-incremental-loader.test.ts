import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// Mock pg module
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockOn = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    end: mockEnd,
    on: mockOn,
    query: mockQuery,
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  })),
}));

// Mock @linear/sdk
vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    teams: vi.fn(),
    team: vi.fn(),
  })),
}));

import { LoggerService } from '../../logging/logger.js';
import {
  LinearIncrementalLoader,
  type LinearIncrementalLoaderConfig,
} from '../../services/linear-incremental-loader.js';
import type { LinearService, LoadTeamIssuesResult } from '../../services/linear-service.js';
import type { LinearRepository } from '../../database/linear-repository.js';
import type { PipelineRepository } from '../../database/pipeline-repository.js';
import type { LinearTeamMaxIssue, UnfinishedLinearIssue } from '../../database/linear-types.js';

/**
 * Unit tests for LinearIncrementalLoader.
 *
 * Validates:
 * - runIncrementalLoad orchestrates discover/load/refresh
 * - Team discovery from database
 * - Incremental loading per team
 * - Unfinished issue refresh
 * - buildConfig applies defaults
 *
 * Ticket: IQS-875
 */

// ============================================================================
// Test helpers
// ============================================================================

function createMockLinearService(): {
  loadTeamIssues: ReturnType<typeof vi.fn>;
} {
  return {
    loadTeamIssues: vi.fn(),
  };
}

function createMockLinearRepo(): {
  identifyLinearTeamMaxIssue: ReturnType<typeof vi.fn>;
  getUnfinishedLinearIssues: ReturnType<typeof vi.fn>;
} {
  return {
    identifyLinearTeamMaxIssue: vi.fn(),
    getUnfinishedLinearIssues: vi.fn(),
  };
}

function createMockPipelineRepo(): {
  insertPipelineStart: ReturnType<typeof vi.fn>;
  updatePipelineRun: ReturnType<typeof vi.fn>;
} {
  return {
    insertPipelineStart: vi.fn(),
    updatePipelineRun: vi.fn(),
  };
}

function createTestConfig(overrides?: Partial<LinearIncrementalLoaderConfig>): LinearIncrementalLoaderConfig {
  return {
    increment: 200,
    daysAgo: 2,
    additionalTeams: [],
    ...overrides,
  };
}

describe('LinearIncrementalLoader', () => {
  let mockLinearService: ReturnType<typeof createMockLinearService>;
  let mockLinearRepo: ReturnType<typeof createMockLinearRepo>;
  let mockPipelineRepo: ReturnType<typeof createMockPipelineRepo>;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    vi.clearAllMocks();

    mockLinearService = createMockLinearService();
    mockLinearRepo = createMockLinearRepo();
    mockPipelineRepo = createMockPipelineRepo();

    // Default mock responses
    mockPipelineRepo.insertPipelineStart.mockResolvedValue(1);
    mockPipelineRepo.updatePipelineRun.mockResolvedValue(undefined);
  });

  afterEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    _clearMocks();
  });

  describe('runIncrementalLoad', () => {
    it('should discover teams and load issues incrementally', async () => {
      const teams: LinearTeamMaxIssue[] = [
        { teamKey: 'IQS', count: 100 },
        { teamKey: 'ENG', count: 50 },
      ];
      mockLinearRepo.identifyLinearTeamMaxIssue.mockResolvedValue(teams);
      mockLinearRepo.getUnfinishedLinearIssues.mockResolvedValue([]);

      const loadResult: LoadTeamIssuesResult = {
        teamKey: 'IQS',
        issuesInserted: 5,
        issuesSkipped: 2,
        issuesFailed: 0,
        durationMs: 500,
      };
      mockLinearService.loadTeamIssues.mockResolvedValue(loadResult);

      const loader = new LinearIncrementalLoader(
        createTestConfig(),
        mockLinearService as unknown as LinearService,
        mockLinearRepo as unknown as LinearRepository,
        mockPipelineRepo as unknown as PipelineRepository,
      );

      const result = await loader.runIncrementalLoad();

      expect(result.teamCount).toBe(2);
      expect(result.teamResults).toHaveLength(2);
      expect(result.totalInserted).toBe(10); // 5 * 2 teams
      expect(result.totalSkipped).toBe(4); // 2 * 2 teams

      // Verify loadTeamIssues was called with correct ranges
      expect(mockLinearService.loadTeamIssues).toHaveBeenCalledWith(
        'IQS', { startKey: 100, maxKeys: 300 },
      );
      expect(mockLinearService.loadTeamIssues).toHaveBeenCalledWith(
        'ENG', { startKey: 50, maxKeys: 250 },
      );
    });

    it('should refresh unfinished issues', async () => {
      mockLinearRepo.identifyLinearTeamMaxIssue.mockResolvedValue([]);

      const unfinished: UnfinishedLinearIssue[] = [
        { linearKey: 'IQS-42' },
        { linearKey: 'IQS-99' },
        { linearKey: 'ENG-10' },
      ];
      mockLinearRepo.getUnfinishedLinearIssues.mockResolvedValue(unfinished);
      mockLinearService.loadTeamIssues.mockResolvedValue({
        teamKey: '', issuesInserted: 0, issuesSkipped: 0, issuesFailed: 0, durationMs: 0,
      });

      const loader = new LinearIncrementalLoader(
        createTestConfig(),
        mockLinearService as unknown as LinearService,
        mockLinearRepo as unknown as LinearRepository,
        mockPipelineRepo as unknown as PipelineRepository,
      );

      const result = await loader.runIncrementalLoad();

      expect(result.unfinishedRefreshed).toBe(3);

      // loadTeamIssues should be called for each unique team prefix (IQS, ENG)
      expect(mockLinearService.loadTeamIssues).toHaveBeenCalledWith(
        'IQS', { startKey: 0, maxKeys: 0 },
      );
      expect(mockLinearService.loadTeamIssues).toHaveBeenCalledWith(
        'ENG', { startKey: 0, maxKeys: 0 },
      );
    });

    it('should skip unfinished refresh when requested', async () => {
      mockLinearRepo.identifyLinearTeamMaxIssue.mockResolvedValue([]);

      const loader = new LinearIncrementalLoader(
        createTestConfig(),
        mockLinearService as unknown as LinearService,
        mockLinearRepo as unknown as LinearRepository,
        mockPipelineRepo as unknown as PipelineRepository,
      );

      const result = await loader.runIncrementalLoad(true);

      expect(result.unfinishedRefreshed).toBe(0);
      expect(mockLinearRepo.getUnfinishedLinearIssues).not.toHaveBeenCalled();
    });

    it('should handle errors and record pipeline failure', async () => {
      mockLinearRepo.identifyLinearTeamMaxIssue.mockRejectedValue(new Error('DB connection lost'));

      const loader = new LinearIncrementalLoader(
        createTestConfig(),
        mockLinearService as unknown as LinearService,
        mockLinearRepo as unknown as LinearRepository,
        mockPipelineRepo as unknown as PipelineRepository,
      );

      const result = await loader.runIncrementalLoad();

      // Should not throw, but should record error
      expect(result.totalInserted).toBe(0);
      expect(result.totalFailed).toBe(0);

      // Pipeline should have been updated with ERROR status
      expect(mockPipelineRepo.updatePipelineRun).toHaveBeenCalledWith(
        1,
        expect.stringContaining('ERROR'),
      );
    });

    it('should bootstrap configured additionalTeams on empty database', async () => {
      // DB returns no teams (fresh database)
      mockLinearRepo.identifyLinearTeamMaxIssue.mockResolvedValue([]);
      mockLinearRepo.getUnfinishedLinearIssues.mockResolvedValue([]);

      const loadResult: LoadTeamIssuesResult = {
        teamKey: 'IQS',
        issuesInserted: 15,
        issuesSkipped: 0,
        issuesFailed: 0,
        durationMs: 300,
      };
      mockLinearService.loadTeamIssues.mockResolvedValue(loadResult);

      const loader = new LinearIncrementalLoader(
        createTestConfig({ additionalTeams: ['IQS', 'ENG'] }),
        mockLinearService as unknown as LinearService,
        mockLinearRepo as unknown as LinearRepository,
        mockPipelineRepo as unknown as PipelineRepository,
      );

      const result = await loader.runIncrementalLoad();

      // Both configured teams should be loaded even though DB was empty
      expect(result.teamCount).toBe(2);
      expect(result.totalInserted).toBe(30); // 15 * 2 teams

      // Should start from 0 since no prior data exists
      expect(mockLinearService.loadTeamIssues).toHaveBeenCalledWith(
        'IQS', { startKey: 0, maxKeys: 200 },
      );
      expect(mockLinearService.loadTeamIssues).toHaveBeenCalledWith(
        'ENG', { startKey: 0, maxKeys: 200 },
      );
    });

    it('should not duplicate teams already discovered from database', async () => {
      const teams: LinearTeamMaxIssue[] = [
        { teamKey: 'IQS', count: 100 },
      ];
      mockLinearRepo.identifyLinearTeamMaxIssue.mockResolvedValue(teams);
      mockLinearRepo.getUnfinishedLinearIssues.mockResolvedValue([]);

      const loadResult: LoadTeamIssuesResult = {
        teamKey: 'IQS',
        issuesInserted: 5,
        issuesSkipped: 0,
        issuesFailed: 0,
        durationMs: 200,
      };
      mockLinearService.loadTeamIssues.mockResolvedValue(loadResult);

      const loader = new LinearIncrementalLoader(
        createTestConfig({ additionalTeams: ['IQS', 'NEW'] }),
        mockLinearService as unknown as LinearService,
        mockLinearRepo as unknown as LinearRepository,
        mockPipelineRepo as unknown as PipelineRepository,
      );

      const result = await loader.runIncrementalLoad();

      // IQS from DB + NEW from additionalTeams (IQS not duplicated)
      expect(result.teamCount).toBe(2);

      // IQS should use DB-discovered count (100), not 0
      expect(mockLinearService.loadTeamIssues).toHaveBeenCalledWith(
        'IQS', { startKey: 100, maxKeys: 300 },
      );
      // NEW should bootstrap from 0
      expect(mockLinearService.loadTeamIssues).toHaveBeenCalledWith(
        'NEW', { startKey: 0, maxKeys: 200 },
      );
    });

    it('should track pipeline run with start and finish', async () => {
      mockLinearRepo.identifyLinearTeamMaxIssue.mockResolvedValue([]);
      mockLinearRepo.getUnfinishedLinearIssues.mockResolvedValue([]);

      const loader = new LinearIncrementalLoader(
        createTestConfig(),
        mockLinearService as unknown as LinearService,
        mockLinearRepo as unknown as LinearRepository,
        mockPipelineRepo as unknown as PipelineRepository,
      );

      await loader.runIncrementalLoad();

      expect(mockPipelineRepo.insertPipelineStart).toHaveBeenCalledOnce();
      expect(mockPipelineRepo.updatePipelineRun).toHaveBeenCalledWith(1, 'FINISHED');
    });
  });

  describe('buildConfig', () => {
    it('should apply defaults when no values provided', () => {
      const config = LinearIncrementalLoader.buildConfig();

      expect(config.increment).toBe(200);
      expect(config.daysAgo).toBe(2);
      expect(config.additionalTeams).toEqual([]);
    });

    it('should use provided values', () => {
      const config = LinearIncrementalLoader.buildConfig(100, 5, ['EXTRA']);

      expect(config.increment).toBe(100);
      expect(config.daysAgo).toBe(5);
      expect(config.additionalTeams).toEqual(['EXTRA']);
    });

    it('should use defaults for invalid values', () => {
      const config = LinearIncrementalLoader.buildConfig(0, -1);

      expect(config.increment).toBe(200); // 0 is not > 0
      expect(config.daysAgo).toBe(2); // -1 is not >= 0
    });

    it('should allow daysAgo of 0', () => {
      const config = LinearIncrementalLoader.buildConfig(undefined, 0);

      expect(config.daysAgo).toBe(0);
    });
  });
});
