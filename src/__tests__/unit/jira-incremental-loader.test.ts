import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { JiraRepository } from '../../database/jira-repository.js';
import { PipelineRepository } from '../../database/pipeline-repository.js';
import { JiraService, type JiraServiceConfig } from '../../services/jira-service.js';
import { JiraChangelogService } from '../../services/jira-changelog-service.js';
import {
  JiraIncrementalLoader,
  type IncrementalLoaderConfig,
} from '../../services/jira-incremental-loader.js';
import type { JiraProjectMaxIssue } from '../../database/jira-types.js';
import type { UpdateUnfinishedResult } from '../../services/jira-changelog-types.js';

/**
 * Unit tests for JiraIncrementalLoader.
 *
 * Tests:
 * - runIncrementalLoad orchestration (discover + load + refresh)
 * - Incremental range calculation (startKey to startKey+increment)
 * - Project auto-discovery from DB
 * - Configurable increment and daysAgo
 * - Skip unfinished refresh
 * - buildConfig defaults and validation
 * - Logging of skipped vs processed issues
 *
 * Ticket: IQS-860
 */

// ============================================================================
// Mock setup
// ============================================================================

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

vi.mock('jira.js', () => ({
  Version3Client: vi.fn().mockImplementation(() => ({
    issueSearch: {
      searchForIssuesUsingJql: vi.fn(),
    },
  })),
}));

// ============================================================================
// Test helpers
// ============================================================================

function createDbConfig(): DatabaseServiceConfig {
  return {
    host: 'localhost',
    port: 5433,
    database: 'gitrx_test',
    user: 'test_user',
    password: 'test_password',
  };
}

function createJiraConfig(): JiraServiceConfig {
  return {
    server: 'https://test.atlassian.net',
    username: 'test@example.com',
    token: 'test-token-secret',
    pointsField: 'customfield_10034',
  };
}

function createLoaderConfig(overrides?: Partial<IncrementalLoaderConfig>): IncrementalLoaderConfig {
  return {
    increment: overrides?.increment ?? 200,
    daysAgo: overrides?.daysAgo ?? 2,
    additionalProjects: overrides?.additionalProjects ?? [],
  };
}

function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

function createMockJiraClient() {
  return {
    issueSearch: {
      searchForIssuesUsingJql: vi.fn(),
    },
  };
}

function createMockUpdateUnfinishedResult(overrides?: Partial<UpdateUnfinishedResult>): UpdateUnfinishedResult {
  return {
    issuesProcessed: overrides?.issuesProcessed ?? 5,
    issuesFailed: overrides?.issuesFailed ?? 0,
    totalHistoryEntries: overrides?.totalHistoryEntries ?? 10,
    totalBranchesSaved: overrides?.totalBranchesSaved ?? 3,
    totalPrsSaved: overrides?.totalPrsSaved ?? 2,
    durationMs: overrides?.durationMs ?? 1000,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('JiraIncrementalLoader', () => {
  let dbService: DatabaseService;
  let jiraRepo: JiraRepository;
  let pipelineRepo: PipelineRepository;
  let jiraService: JiraService;
  let changelogService: JiraChangelogService;
  let mockJiraClient: ReturnType<typeof createMockJiraClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createDbConfig());
    jiraRepo = new JiraRepository(dbService);
    pipelineRepo = new PipelineRepository(dbService);
    mockJiraClient = createMockJiraClient();

    const jiraConfig = createJiraConfig();
    jiraService = new JiraService(
      jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
    );
    changelogService = new JiraChangelogService(
      jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never,
    );
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create JiraIncrementalLoader with config', () => {
      const config = createLoaderConfig();
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );
      expect(loader).toBeDefined();
    });

    it('should accept additional projects in config', () => {
      const config = createLoaderConfig({ additionalProjects: ['PROJ2', 'CRMREO'] });
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );
      expect(loader).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // buildConfig
  // --------------------------------------------------------------------------

  describe('buildConfig', () => {
    it('should apply default increment (200) when not provided', () => {
      const config = JiraIncrementalLoader.buildConfig();
      expect(config.increment).toBe(200);
    });

    it('should apply default daysAgo (2) when not provided', () => {
      const config = JiraIncrementalLoader.buildConfig();
      expect(config.daysAgo).toBe(2);
    });

    it('should accept custom increment', () => {
      const config = JiraIncrementalLoader.buildConfig(500);
      expect(config.increment).toBe(500);
    });

    it('should accept custom daysAgo', () => {
      const config = JiraIncrementalLoader.buildConfig(undefined, 7);
      expect(config.daysAgo).toBe(7);
    });

    it('should accept daysAgo=0', () => {
      const config = JiraIncrementalLoader.buildConfig(undefined, 0);
      expect(config.daysAgo).toBe(0);
    });

    it('should use default for invalid increment (0 or negative)', () => {
      expect(JiraIncrementalLoader.buildConfig(0).increment).toBe(200);
      expect(JiraIncrementalLoader.buildConfig(-5).increment).toBe(200);
    });

    it('should use default for negative daysAgo', () => {
      expect(JiraIncrementalLoader.buildConfig(undefined, -1).daysAgo).toBe(2);
    });

    it('should accept additional projects', () => {
      const config = JiraIncrementalLoader.buildConfig(200, 2, ['PROJ2', 'CRM']);
      expect(config.additionalProjects).toEqual(['PROJ2', 'CRM']);
    });

    it('should default additional projects to empty array', () => {
      const config = JiraIncrementalLoader.buildConfig();
      expect(config.additionalProjects).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // runIncrementalLoad
  // --------------------------------------------------------------------------

  describe('runIncrementalLoad', () => {
    it('should discover projects and load issues incrementally', async () => {
      const config = createLoaderConfig({ increment: 100 });
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );

      // Mock pipeline start
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      // Mock project discovery: two projects
      const maxIssues: JiraProjectMaxIssue[] = [
        { jiraKey: 'PROJ', count: 500 },
        { jiraKey: 'FEAT', count: 200 },
      ];
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue(maxIssues);

      // Mock loadProjectIssues for each project
      const loadSpy = vi.spyOn(jiraService, 'loadProjectIssues')
        .mockResolvedValueOnce({
          projectKey: 'PROJ',
          issuesInserted: 10,
          issuesSkipped: 5,
          linksInserted: 3,
          parentsInserted: 2,
          issuesFailed: 0,
          durationMs: 500,
        })
        .mockResolvedValueOnce({
          projectKey: 'FEAT',
          issuesInserted: 8,
          issuesSkipped: 2,
          linksInserted: 1,
          parentsInserted: 1,
          issuesFailed: 1,
          durationMs: 300,
        });

      // Mock changelog service for unfinished refresh
      const unfinishedSpy = vi.spyOn(changelogService, 'updateUnfinishedIssues')
        .mockResolvedValue(createMockUpdateUnfinishedResult());

      const result = await loader.runIncrementalLoad();

      // Verify project discovery
      expect(jiraRepo.identifyJiraProjMaxIssue).toHaveBeenCalledOnce();

      // Verify incremental load called with correct ranges
      expect(loadSpy).toHaveBeenCalledTimes(2);

      // PROJ: startKey=500, maxKeys=500+100=600
      expect(loadSpy).toHaveBeenCalledWith('PROJ', { startKey: 500, maxKeys: 600 });

      // FEAT: startKey=200, maxKeys=200+100=300
      expect(loadSpy).toHaveBeenCalledWith('FEAT', { startKey: 200, maxKeys: 300 });

      // Verify unfinished refresh called
      expect(unfinishedSpy).toHaveBeenCalledOnce();
      expect(unfinishedSpy).toHaveBeenCalledWith(['FEAT', 'PROJ'], 2);

      // Verify result aggregation
      expect(result.projectCount).toBe(2);
      expect(result.totalInserted).toBe(18); // 10 + 8
      expect(result.totalSkipped).toBe(7); // 5 + 2
      expect(result.totalFailed).toBe(1); // 0 + 1
      expect(result.projectResults).toHaveLength(2);
      expect(result.unfinishedResult).not.toBeNull();
    });

    it('should use correct startKey and endKey per project', async () => {
      const config = createLoaderConfig({ increment: 250 });
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([
        { jiraKey: 'ABC', count: 1000 },
      ]);

      const loadSpy = vi.spyOn(jiraService, 'loadProjectIssues').mockResolvedValue({
        projectKey: 'ABC',
        issuesInserted: 0,
        issuesSkipped: 0,
        linksInserted: 0,
        parentsInserted: 0,
        issuesFailed: 0,
        durationMs: 100,
      });

      vi.spyOn(changelogService, 'updateUnfinishedIssues')
        .mockResolvedValue(createMockUpdateUnfinishedResult());

      await loader.runIncrementalLoad();

      // ABC: startKey=1000, maxKeys=1000+250=1250
      expect(loadSpy).toHaveBeenCalledWith('ABC', { startKey: 1000, maxKeys: 1250 });
    });

    it('should skip unfinished refresh when flag is true', async () => {
      const config = createLoaderConfig();
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([]);

      const unfinishedSpy = vi.spyOn(changelogService, 'updateUnfinishedIssues')
        .mockResolvedValue(createMockUpdateUnfinishedResult());

      const result = await loader.runIncrementalLoad(true);

      expect(unfinishedSpy).not.toHaveBeenCalled();
      expect(result.unfinishedResult).toBeNull();
    });

    it('should handle zero discovered projects', async () => {
      const config = createLoaderConfig();
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([]);

      vi.spyOn(changelogService, 'updateUnfinishedIssues')
        .mockResolvedValue(createMockUpdateUnfinishedResult({ issuesProcessed: 0 }));

      const result = await loader.runIncrementalLoad();

      expect(result.projectCount).toBe(0);
      expect(result.totalInserted).toBe(0);
      expect(result.projectResults).toHaveLength(0);
    });

    it('should include additional projects in unfinished refresh key list', async () => {
      const config = createLoaderConfig({ additionalProjects: ['PROJ2', 'CRM'] });
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([
        { jiraKey: 'PROJ', count: 100 },
      ]);

      vi.spyOn(jiraService, 'loadProjectIssues').mockResolvedValue({
        projectKey: 'PROJ',
        issuesInserted: 0,
        issuesSkipped: 0,
        linksInserted: 0,
        parentsInserted: 0,
        issuesFailed: 0,
        durationMs: 100,
      });

      const unfinishedSpy = vi.spyOn(changelogService, 'updateUnfinishedIssues')
        .mockResolvedValue(createMockUpdateUnfinishedResult());

      await loader.runIncrementalLoad();

      // Should include discovered + additional projects, sorted alphabetically
      expect(unfinishedSpy).toHaveBeenCalledWith(['CRM', 'PROJ', 'PROJ2'], 2);
    });

    it('should handle errors during incremental load gracefully', async () => {
      const config = createLoaderConfig();
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();

      // Simulate DB error on project discovery
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue')
        .mockRejectedValue(new Error('DB connection lost'));

      const result = await loader.runIncrementalLoad();

      // Should not throw, but return empty results
      expect(result.projectCount).toBe(0);
      expect(result.totalInserted).toBe(0);
      expect(result.unfinishedResult).toBeNull();
    });

    it('should use configured daysAgo for unfinished refresh', async () => {
      const config = createLoaderConfig({ daysAgo: 7 });
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([
        { jiraKey: 'X', count: 50 },
      ]);
      vi.spyOn(jiraService, 'loadProjectIssues').mockResolvedValue({
        projectKey: 'X',
        issuesInserted: 0,
        issuesSkipped: 0,
        linksInserted: 0,
        parentsInserted: 0,
        issuesFailed: 0,
        durationMs: 50,
      });

      const unfinishedSpy = vi.spyOn(changelogService, 'updateUnfinishedIssues')
        .mockResolvedValue(createMockUpdateUnfinishedResult());

      await loader.runIncrementalLoad();

      // daysAgo should be 7
      expect(unfinishedSpy).toHaveBeenCalledWith(['X'], 7);
    });

    it('should track pipeline run start and finish', async () => {
      const config = createLoaderConfig();
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );

      const startSpy = vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(42);
      const updateSpy = vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([]);
      vi.spyOn(changelogService, 'updateUnfinishedIssues')
        .mockResolvedValue(createMockUpdateUnfinishedResult());

      await loader.runIncrementalLoad();

      expect(startSpy).toHaveBeenCalledOnce();
      expect(updateSpy).toHaveBeenCalledWith(42, 'FINISHED');
    });

    it('should record ERROR status in pipeline run on fatal error', async () => {
      const config = createLoaderConfig();
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(99);
      const updateSpy = vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue')
        .mockRejectedValue(new Error('Connection refused'));

      await loader.runIncrementalLoad();

      expect(updateSpy).toHaveBeenCalledWith(99, expect.stringContaining('ERROR: Connection refused'));
    });

    it('should report per-project results with startKey and endKey', async () => {
      const config = createLoaderConfig({ increment: 150 });
      const loader = new JiraIncrementalLoader(
        config, jiraService, changelogService, jiraRepo, pipelineRepo,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(jiraRepo, 'identifyJiraProjMaxIssue').mockResolvedValue([
        { jiraKey: 'DV', count: 3000 },
      ]);

      vi.spyOn(jiraService, 'loadProjectIssues').mockResolvedValue({
        projectKey: 'DV',
        issuesInserted: 15,
        issuesSkipped: 10,
        linksInserted: 5,
        parentsInserted: 3,
        issuesFailed: 2,
        durationMs: 800,
      });

      vi.spyOn(changelogService, 'updateUnfinishedIssues')
        .mockResolvedValue(createMockUpdateUnfinishedResult());

      const result = await loader.runIncrementalLoad();

      expect(result.projectResults).toHaveLength(1);
      const projResult = result.projectResults[0]!;
      expect(projResult.projectKey).toBe('DV');
      expect(projResult.startKey).toBe(3000);
      expect(projResult.endKey).toBe(3150);
      expect(projResult.issuesInserted).toBe(15);
      expect(projResult.issuesSkipped).toBe(10);
      expect(projResult.issuesFailed).toBe(2);
    });
  });
});
