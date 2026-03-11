import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { CommitRepository } from '../../database/commit-repository.js';
import { ContributorRepository } from '../../database/contributor-repository.js';
import { CommitJiraRepository } from '../../database/commit-jira-repository.js';
import { JiraRepository } from '../../database/jira-repository.js';
import { PipelineRepository } from '../../database/pipeline-repository.js';
import { GitAnalysisService } from '../../services/git-analysis-service.js';
import { GitHubService } from '../../services/github-service.js';
import { JiraService, type JiraServiceConfig } from '../../services/jira-service.js';
import { JiraChangelogService } from '../../services/jira-changelog-service.js';
import { JiraIncrementalLoader } from '../../services/jira-incremental-loader.js';
import { DataEnhancerService } from '../../services/data-enhancer-service.js';
import { TeamAssignmentService } from '../../services/team-assignment-service.js';
import {
  PipelineService,
  ALL_PIPELINE_STEPS,
  PIPELINE_STEP_LABELS,
  type PipelineConfig,
} from '../../services/pipeline-service.js';
import type { RepositoryEntry } from '../../config/settings.js';
import type { AnalysisRunResult } from '../../services/git-analysis-types.js';
import type { GitHubSyncResult } from '../../services/github-service-types.js';
import type { IncrementalLoadResult } from '../../services/jira-incremental-loader.js';
import type { DataEnhancerResult } from '../../services/data-enhancer-service.js';
import type { TeamAssignmentResult } from '../../services/team-assignment-service.js';
import type { PipelineProgressCallback, PipelineCancellationToken } from '../../services/pipeline-service.js';

/**
 * Unit tests for PipelineService.
 *
 * Tests:
 * - Full pipeline orchestration (all 6 steps)
 * - Configurable step subset
 * - Graceful degradation (error in one step does not abort pipeline)
 * - Cancellation support
 * - Pipeline run tracking (start/stop/error in gitr_pipeline_run)
 * - Progress reporting
 * - buildConfig defaults and validation
 * - validateSteps filtering
 * - Table count logging at end of run
 * - Null service handling (GitHub/Jira not configured)
 *
 * Ticket: IQS-864
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

vi.mock('simple-git', () => ({
  default: vi.fn(),
}));

vi.mock('jira.js', () => ({
  Version3Client: vi.fn().mockImplementation(() => ({
    issueSearch: { searchForIssuesUsingJqlEnhancedSearch: vi.fn() },
  })),
  Version3Models: {},
}));

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    repos: { listContributors: vi.fn(), getCommit: vi.fn() },
    users: { getByUsername: vi.fn() },
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

function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

function createMockRepositories(): readonly RepositoryEntry[] {
  return [
    { path: '/repos/app1', name: 'app1', organization: 'TestOrg' },
    { path: '/repos/app2', name: 'app2', organization: 'TestOrg' },
  ];
}

function createDefaultConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return PipelineService.buildConfig(
    overrides?.steps,
    overrides?.jiraIncrement,
    overrides?.jiraDaysAgo,
    overrides?.jiraAdditionalProjects,
    overrides?.jiraKeyAliases,
    overrides?.linearTeamKeys,
  );
}

function createMockGitAnalysisResult(): AnalysisRunResult {
  return {
    pipelineRunId: 1,
    repoResults: [
      { repoName: 'app1', branchesProcessed: 5, commitsInserted: 20, branchRelationshipsRecorded: 10, durationMs: 1000 },
    ],
    totalDurationMs: 1000,
    status: 'SUCCESS',
  };
}

function createMockGithubSyncResult(): GitHubSyncResult {
  return {
    contributorResults: [
      { repoName: 'app1', contributorsInserted: 3, contributorsUpdated: 1, contributorsSkipped: 5, errorCount: 0, durationMs: 500 },
    ],
    unknownAuthorResults: [],
    commitUrlResults: [],
    totalDurationMs: 500,
  };
}

function createMockJiraLoadResult(): IncrementalLoadResult {
  return {
    projectResults: [{ projectKey: 'PROJ', startKey: 100, endKey: 300, issuesInserted: 10, issuesSkipped: 5, issuesFailed: 0, durationMs: 800 }],
    unfinishedResult: null,
    totalInserted: 10,
    totalSkipped: 5,
    totalFailed: 0,
    durationMs: 800,
    projectCount: 1,
  };
}

function createMockDataEnhancerResult(): DataEnhancerResult {
  return {
    authorsProcessed: 5,
    commitsScanned: 100,
    linksInserted: 25,
    refsUpdated: 80,
    durationMs: 600,
  };
}

function createMockTeamAssignmentResult(): TeamAssignmentResult {
  return {
    authorsProcessed: 5,
    primaryTeamsUpdated: 3,
    durationMs: 400,
  };
}

function createMockProgress(): PipelineProgressCallback {
  return { report: vi.fn() };
}

function createMockCancellationToken(cancelled = false): PipelineCancellationToken {
  return { isCancellationRequested: cancelled };
}

// ============================================================================
// Tests
// ============================================================================

describe('PipelineService', () => {
  let dbService: DatabaseService;
  let pipelineRepo: PipelineRepository;
  let gitAnalysisService: GitAnalysisService;
  let githubService: GitHubService;
  let jiraIncrementalLoader: JiraIncrementalLoader;
  let dataEnhancerService: DataEnhancerService;
  let teamAssignmentService: TeamAssignmentService;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createDbConfig());

    const commitRepo = new CommitRepository(dbService);
    const contributorRepo = new ContributorRepository(dbService);
    const commitJiraRepo = new CommitJiraRepository(dbService);
    const jiraRepo = new JiraRepository(dbService);
    pipelineRepo = new PipelineRepository(dbService);

    gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo);

    const mockOctokit = {
      repos: { listContributors: vi.fn(), getCommit: vi.fn() },
      users: { getByUsername: vi.fn() },
    };
    githubService = new GitHubService(
      { token: 'test-token', organization: 'TestOrg' },
      contributorRepo, commitRepo, pipelineRepo,
      mockOctokit as never,
    );

    const jiraConfig: JiraServiceConfig = {
      server: 'https://test.atlassian.net',
      username: 'test@example.com',
      token: 'jira-token',
      pointsField: 'customfield_10034',
    };
    const mockJiraClient = { issueSearch: { searchForIssuesUsingJqlEnhancedSearch: vi.fn() } };
    const jiraService = new JiraService(jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never);
    const changelogService = new JiraChangelogService(jiraConfig, jiraRepo, pipelineRepo, mockJiraClient as never);
    const loaderConfig = JiraIncrementalLoader.buildConfig(200, 2, []);
    jiraIncrementalLoader = new JiraIncrementalLoader(loaderConfig, jiraService, changelogService, jiraRepo, pipelineRepo);

    dataEnhancerService = new DataEnhancerService(commitRepo, commitJiraRepo, {});
    teamAssignmentService = new TeamAssignmentService(contributorRepo, commitJiraRepo, pipelineRepo);
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
    it('should create PipelineService with all dependencies', () => {
      const config = createDefaultConfig();
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService,
        jiraIncrementalLoader, null, dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );
      expect(service).toBeDefined();
    });

    it('should accept null GitHub and Jira services', () => {
      const config = createDefaultConfig();
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, null, null, null,
        dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );
      expect(service).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // buildConfig
  // --------------------------------------------------------------------------

  describe('buildConfig', () => {
    it('should default to all steps when steps not provided', () => {
      const config = PipelineService.buildConfig();
      expect(config.steps).toEqual(ALL_PIPELINE_STEPS);
    });

    it('should default to all steps when empty array provided', () => {
      const config = PipelineService.buildConfig([]);
      expect(config.steps).toEqual(ALL_PIPELINE_STEPS);
    });

    it('should accept custom step subset', () => {
      const steps = ['gitCommitExtraction', 'teamAssignment'] as const;
      const config = PipelineService.buildConfig(steps);
      expect(config.steps).toEqual(steps);
    });

    it('should apply default Jira increment (200)', () => {
      const config = PipelineService.buildConfig();
      expect(config.jiraIncrement).toBe(200);
    });

    it('should apply default Jira daysAgo (2)', () => {
      const config = PipelineService.buildConfig();
      expect(config.jiraDaysAgo).toBe(2);
    });

    it('should accept custom Jira settings', () => {
      const config = PipelineService.buildConfig(undefined, 500, 7, ['PROJ1'], { PROJ: 'PROJ2' });
      expect(config.jiraIncrement).toBe(500);
      expect(config.jiraDaysAgo).toBe(7);
      expect(config.jiraAdditionalProjects).toEqual(['PROJ1']);
      expect(config.jiraKeyAliases).toEqual({ PROJ: 'PROJ2' });
    });

    it('should use defaults for invalid increment', () => {
      expect(PipelineService.buildConfig(undefined, 0).jiraIncrement).toBe(200);
      expect(PipelineService.buildConfig(undefined, -5).jiraIncrement).toBe(200);
    });

    it('should accept sinceDate parameter (IQS-931)', () => {
      const config = PipelineService.buildConfig(
        undefined, undefined, undefined, undefined, undefined, undefined, '2023-01-01',
      );
      expect(config.sinceDate).toBe('2023-01-01');
    });

    it('should leave sinceDate undefined when not provided (IQS-931)', () => {
      const config = PipelineService.buildConfig();
      expect(config.sinceDate).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // validateSteps
  // --------------------------------------------------------------------------

  describe('validateSteps', () => {
    it('should filter valid step IDs', () => {
      const result = PipelineService.validateSteps(['gitCommitExtraction', 'teamAssignment']);
      expect(result).toEqual(['gitCommitExtraction', 'teamAssignment']);
    });

    it('should filter out invalid step IDs', () => {
      const result = PipelineService.validateSteps(['gitCommitExtraction', 'invalidStep', 'teamAssignment']);
      expect(result).toEqual(['gitCommitExtraction', 'teamAssignment']);
    });

    it('should return empty array for all invalid steps', () => {
      const result = PipelineService.validateSteps(['invalid1', 'invalid2']);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      const result = PipelineService.validateSteps([]);
      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // runPipeline - Full orchestration
  // --------------------------------------------------------------------------

  describe('runPipeline', () => {
    it('should execute all 6 steps and return SUCCESS when all pass', async () => {
      const config = createDefaultConfig();
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService,
        jiraIncrementalLoader, null, dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      // Mock all step services
      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();
      vi.spyOn(gitAnalysisService, 'analyzeRepositories').mockResolvedValue(createMockGitAnalysisResult());
      vi.spyOn(githubService, 'syncAll').mockResolvedValue(createMockGithubSyncResult());
      vi.spyOn(jiraIncrementalLoader, 'runIncrementalLoad').mockResolvedValue(createMockJiraLoadResult());
      vi.spyOn(dataEnhancerService, 'enhanceCommitJiraLinks').mockResolvedValue(createMockDataEnhancerResult());
      vi.spyOn(teamAssignmentService, 'updateTeamAssignmentsWithPipeline').mockResolvedValue(createMockTeamAssignmentResult());

      const result = await service.runPipeline();

      expect(result.status).toBe('SUCCESS');
      expect(result.stepResults).toHaveLength(9);
      expect(result.stepResults.every((r) => r.status === 'SUCCESS')).toBe(true);
      expect(result.pipelineRunId).toBe(1);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track pipeline run start and finish', async () => {
      const config = createDefaultConfig();
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService,
        jiraIncrementalLoader, null, dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      const startSpy = vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(42);
      const updateSpy = vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();
      vi.spyOn(gitAnalysisService, 'analyzeRepositories').mockResolvedValue(createMockGitAnalysisResult());
      vi.spyOn(githubService, 'syncAll').mockResolvedValue(createMockGithubSyncResult());
      vi.spyOn(jiraIncrementalLoader, 'runIncrementalLoad').mockResolvedValue(createMockJiraLoadResult());
      vi.spyOn(dataEnhancerService, 'enhanceCommitJiraLinks').mockResolvedValue(createMockDataEnhancerResult());
      vi.spyOn(teamAssignmentService, 'updateTeamAssignmentsWithPipeline').mockResolvedValue(createMockTeamAssignmentResult());

      const result = await service.runPipeline();

      expect(startSpy).toHaveBeenCalledOnce();
      expect(updateSpy).toHaveBeenCalledWith(42, 'FINISHED');
      expect(result.pipelineRunId).toBe(42);
    });

    it('should report progress for each step', async () => {
      const config = createDefaultConfig();
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService,
        jiraIncrementalLoader, null, dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();
      vi.spyOn(gitAnalysisService, 'analyzeRepositories').mockResolvedValue(createMockGitAnalysisResult());
      vi.spyOn(githubService, 'syncAll').mockResolvedValue(createMockGithubSyncResult());
      vi.spyOn(jiraIncrementalLoader, 'runIncrementalLoad').mockResolvedValue(createMockJiraLoadResult());
      vi.spyOn(dataEnhancerService, 'enhanceCommitJiraLinks').mockResolvedValue(createMockDataEnhancerResult());
      vi.spyOn(teamAssignmentService, 'updateTeamAssignmentsWithPipeline').mockResolvedValue(createMockTeamAssignmentResult());

      const progress = createMockProgress();
      await service.runPipeline(progress);

      expect(progress.report).toHaveBeenCalledTimes(9);
      // First call should be step 1/9
      expect(progress.report).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Step 1/9') }),
      );
    });

    it('should handle cancellation before a step', async () => {
      const config = createDefaultConfig();
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService,
        jiraIncrementalLoader, null, dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();
      const gitSpy = vi.spyOn(gitAnalysisService, 'analyzeRepositories');

      const cancellationToken = createMockCancellationToken(true);

      const result = await service.runPipeline(undefined, cancellationToken);

      // All steps should be SKIPPED
      expect(result.stepResults.every((r) => r.status === 'SKIPPED')).toBe(true);
      expect(gitSpy).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // runPipeline - Graceful degradation
  // --------------------------------------------------------------------------

  describe('runPipeline - graceful degradation', () => {
    it('should return PARTIAL when one step fails and others succeed', async () => {
      const config = createDefaultConfig();
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService,
        jiraIncrementalLoader, null, dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);
      vi.spyOn(gitAnalysisService, 'analyzeRepositories').mockResolvedValue(createMockGitAnalysisResult());
      vi.spyOn(githubService, 'syncAll').mockRejectedValue(new Error('GitHub rate limit exceeded'));
      vi.spyOn(jiraIncrementalLoader, 'runIncrementalLoad').mockResolvedValue(createMockJiraLoadResult());
      vi.spyOn(dataEnhancerService, 'enhanceCommitJiraLinks').mockResolvedValue(createMockDataEnhancerResult());
      vi.spyOn(teamAssignmentService, 'updateTeamAssignmentsWithPipeline').mockResolvedValue(createMockTeamAssignmentResult());

      const result = await service.runPipeline();

      expect(result.status).toBe('PARTIAL');
      const errorStep = result.stepResults.find((r) => r.stepId === 'githubContributorSync');
      expect(errorStep?.status).toBe('ERROR');
      expect(errorStep?.error).toContain('GitHub rate limit exceeded');

      // Other steps should still succeed
      const otherSteps = result.stepResults.filter((r) => r.stepId !== 'githubContributorSync');
      expect(otherSteps.every((r) => r.status === 'SUCCESS')).toBe(true);
    });

    it('should return FAILED when all service-backed steps fail', async () => {
      // Use only the 6 original steps that have real service dependencies
      const config = PipelineService.buildConfig(
        ['gitCommitExtraction', 'githubContributorSync', 'jiraIssueLoading',
         'jiraChangelogUpdate', 'commitJiraLinking', 'teamAssignment'],
      );
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService,
        jiraIncrementalLoader, null, dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);
      vi.spyOn(gitAnalysisService, 'analyzeRepositories').mockRejectedValue(new Error('Git error'));
      vi.spyOn(githubService, 'syncAll').mockRejectedValue(new Error('GitHub error'));
      vi.spyOn(jiraIncrementalLoader, 'runIncrementalLoad').mockRejectedValue(new Error('Jira error'));
      vi.spyOn(dataEnhancerService, 'enhanceCommitJiraLinks').mockRejectedValue(new Error('Enhancer error'));
      vi.spyOn(teamAssignmentService, 'updateTeamAssignmentsWithPipeline').mockRejectedValue(new Error('Team error'));

      const result = await service.runPipeline();

      expect(result.status).toBe('FAILED');
      expect(result.stepResults.every((r) => r.status === 'ERROR')).toBe(true);
    });

    it('should update pipeline run to ERROR status when all service-backed steps fail', async () => {
      // Use only the 6 original steps that have real service dependencies
      const config = PipelineService.buildConfig(
        ['gitCommitExtraction', 'githubContributorSync', 'jiraIssueLoading',
         'jiraChangelogUpdate', 'commitJiraLinking', 'teamAssignment'],
      );
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService,
        jiraIncrementalLoader, null, dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      const updateSpy = vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'insertPipelineLog').mockResolvedValue(1);
      vi.spyOn(gitAnalysisService, 'analyzeRepositories').mockRejectedValue(new Error('fail'));
      vi.spyOn(githubService, 'syncAll').mockRejectedValue(new Error('fail'));
      vi.spyOn(jiraIncrementalLoader, 'runIncrementalLoad').mockRejectedValue(new Error('fail'));
      vi.spyOn(dataEnhancerService, 'enhanceCommitJiraLinks').mockRejectedValue(new Error('fail'));
      vi.spyOn(teamAssignmentService, 'updateTeamAssignmentsWithPipeline').mockRejectedValue(new Error('fail'));

      await service.runPipeline();

      expect(updateSpy).toHaveBeenCalledWith(1, 'ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // runPipeline - Configurable steps
  // --------------------------------------------------------------------------

  describe('runPipeline - configurable steps', () => {
    it('should only execute specified steps', async () => {
      const config = PipelineService.buildConfig(
        ['gitCommitExtraction', 'teamAssignment'],
      );
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService,
        jiraIncrementalLoader, null, dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();
      const gitSpy = vi.spyOn(gitAnalysisService, 'analyzeRepositories').mockResolvedValue(createMockGitAnalysisResult());
      const githubSpy = vi.spyOn(githubService, 'syncAll');
      const jiraSpy = vi.spyOn(jiraIncrementalLoader, 'runIncrementalLoad');
      const enhancerSpy = vi.spyOn(dataEnhancerService, 'enhanceCommitJiraLinks');
      const teamSpy = vi.spyOn(teamAssignmentService, 'updateTeamAssignmentsWithPipeline').mockResolvedValue(createMockTeamAssignmentResult());

      const result = await service.runPipeline();

      expect(result.stepResults).toHaveLength(2);
      expect(result.stepResults[0]!.stepId).toBe('gitCommitExtraction');
      expect(result.stepResults[1]!.stepId).toBe('teamAssignment');
      expect(gitSpy).toHaveBeenCalledOnce();
      expect(teamSpy).toHaveBeenCalledOnce();
      expect(githubSpy).not.toHaveBeenCalled();
      expect(jiraSpy).not.toHaveBeenCalled();
      expect(enhancerSpy).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // runPipeline - Null service handling
  // --------------------------------------------------------------------------

  describe('runPipeline - null services', () => {
    it('should handle null GitHub service gracefully', async () => {
      const config = PipelineService.buildConfig(['githubContributorSync']);
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, null, jiraIncrementalLoader, null,
        dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      const result = await service.runPipeline();

      expect(result.stepResults).toHaveLength(1);
      // The step should succeed (the method logs a warning and returns a skipped message)
      expect(result.stepResults[0]!.status).toBe('SUCCESS');
      expect(result.stepResults[0]!.summary).toContain('not configured');
    });

    it('should handle null Jira service gracefully', async () => {
      const config = PipelineService.buildConfig(['jiraIssueLoading', 'jiraChangelogUpdate']);
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService, null, null,
        dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      const result = await service.runPipeline();

      expect(result.stepResults).toHaveLength(2);
      // Both should succeed with skipped messages
      expect(result.stepResults.every((r) => r.status === 'SUCCESS')).toBe(true);
      expect(result.stepResults[0]!.summary).toContain('not configured');
    });

    it('should handle null Linear service gracefully for all Linear steps', async () => {
      const config = PipelineService.buildConfig(['linearIssueLoading', 'linearChangelogUpdate', 'commitLinearLinking']);
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService, jiraIncrementalLoader, null,
        dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      const result = await service.runPipeline();

      expect(result.stepResults).toHaveLength(3);
      // All three should succeed with skipped messages
      expect(result.stepResults.every((r) => r.status === 'SUCCESS')).toBe(true);
      expect(result.stepResults[0]!.summary).toContain('not configured');
      expect(result.stepResults[1]!.summary).toContain('not configured');
      expect(result.stepResults[2]!.summary).toContain('No Linear team keys');
    });

    it('should handle empty repositories for git extraction', async () => {
      const config = PipelineService.buildConfig(['gitCommitExtraction']);
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService, jiraIncrementalLoader, null,
        dataEnhancerService, teamAssignmentService,
        [], // No repositories
        config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();

      const result = await service.runPipeline();

      expect(result.stepResults).toHaveLength(1);
      expect(result.stepResults[0]!.status).toBe('SUCCESS');
      expect(result.stepResults[0]!.summary).toContain('No repositories configured');
    });
  });

  // --------------------------------------------------------------------------
  // PIPELINE_STEP_LABELS
  // --------------------------------------------------------------------------

  describe('PIPELINE_STEP_LABELS', () => {
    it('should have labels for all step IDs', () => {
      for (const stepId of ALL_PIPELINE_STEPS) {
        expect(PIPELINE_STEP_LABELS[stepId]).toBeDefined();
        expect(PIPELINE_STEP_LABELS[stepId].length).toBeGreaterThan(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // ALL_PIPELINE_STEPS
  // --------------------------------------------------------------------------

  describe('ALL_PIPELINE_STEPS', () => {
    it('should contain 9 steps in execution order', () => {
      expect(ALL_PIPELINE_STEPS).toHaveLength(9);
      expect(ALL_PIPELINE_STEPS[0]).toBe('gitCommitExtraction');
      expect(ALL_PIPELINE_STEPS[1]).toBe('githubContributorSync');
      expect(ALL_PIPELINE_STEPS[2]).toBe('jiraIssueLoading');
      expect(ALL_PIPELINE_STEPS[3]).toBe('jiraChangelogUpdate');
      expect(ALL_PIPELINE_STEPS[4]).toBe('commitJiraLinking');
      expect(ALL_PIPELINE_STEPS[5]).toBe('linearIssueLoading');
      expect(ALL_PIPELINE_STEPS[6]).toBe('linearChangelogUpdate');
      expect(ALL_PIPELINE_STEPS[7]).toBe('commitLinearLinking');
      expect(ALL_PIPELINE_STEPS[8]).toBe('teamAssignment');
    });
  });

  // --------------------------------------------------------------------------
  // Table counts logging
  // --------------------------------------------------------------------------

  describe('table counts logging', () => {
    it('should log table counts at end of pipeline run', async () => {
      const config = PipelineService.buildConfig(['gitCommitExtraction']);
      const service = new PipelineService(
        pipelineRepo, gitAnalysisService, githubService, jiraIncrementalLoader, null,
        dataEnhancerService, teamAssignmentService,
        createMockRepositories(), config,
      );

      vi.spyOn(pipelineRepo, 'insertPipelineStart').mockResolvedValue(1);
      vi.spyOn(pipelineRepo, 'updatePipelineRun').mockResolvedValue();
      const countsSpy = vi.spyOn(pipelineRepo, 'logTableCounts').mockResolvedValue();
      vi.spyOn(gitAnalysisService, 'analyzeRepositories').mockResolvedValue(createMockGitAnalysisResult());

      await service.runPipeline();

      expect(countsSpy).toHaveBeenCalledOnce();
      expect(countsSpy).toHaveBeenCalledWith(1, expect.arrayContaining(['commit_history', 'jira_detail']));
    });
  });
});
