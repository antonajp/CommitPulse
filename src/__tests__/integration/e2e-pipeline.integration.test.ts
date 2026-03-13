import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Must import vscode mock before the modules under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  DatabaseService,
  type DatabaseServiceConfig,
} from '../../database/database-service.js';
import { CommitRepository } from '../../database/commit-repository.js';
import { CommitJiraRepository } from '../../database/commit-jira-repository.js';
import { PipelineRepository } from '../../database/pipeline-repository.js';
import { GitAnalysisService } from '../../services/git-analysis-service.js';
import { DataEnhancerService } from '../../services/data-enhancer-service.js';
import { TeamAssignmentService } from '../../services/team-assignment-service.js';
import { PipelineService } from '../../services/pipeline-service.js';
import { SccMetricsService } from '../../services/scc-metrics-service.js';
import type { RepositoryEntry } from '../../config/settings.js';
import type { PipelineStepId } from '../../services/pipeline-service-types.js';

/**
 * End-to-end integration tests for the full analytics pipeline.
 *
 * Spins up Docker PostgreSQL via Testcontainers, creates a small test Git
 * repository with known commits (including Jira key references), runs a
 * mini pipeline, and verifies data flows through all stages:
 *   - commit_history populated
 *   - commit_files populated
 *   - commit_jira linked
 *   - pipeline_run logged with correct status
 *
 * Jira and GitHub APIs are mocked for deterministic testing. The Git
 * commit extraction and commit-Jira linking steps use real services
 * against the fixture repository and real PostgreSQL.
 *
 * Ticket: IQS-873
 */

const PG_DATABASE = 'gitrx_e2e_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

/** Class name for debug logging in tests. */
const CLASS_NAME = 'E2EPipelineTest';

let container: StartedTestContainer;
let dbService: DatabaseService;
let dbConfig: DatabaseServiceConfig;
let fixtureRepoPath: string;

// Repositories
let commitRepo: CommitRepository;
let commitJiraRepo: CommitJiraRepository;
let pipelineRepo: PipelineRepository;

/**
 * Create the database schema from migration files.
 */
async function createSchema(db: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');
  const tableSql = readFileSync(join(migrationsDir, '001_create_tables.sql'), 'utf-8');
  await db.query(tableSql);

  // Also create views needed for team assignment table counts
  const viewsSql = readFileSync(join(migrationsDir, '002_create_views.sql'), 'utf-8');
  await db.query(viewsSql);
}

/**
 * Create a small fixture Git repository with known commits.
 *
 * The repository has:
 * - 3 commits with known authors and messages
 * - Commit messages contain Jira key references (PROJ-101, PROJ-202)
 * - Multiple files to verify commit_files population
 * - Fixed commit dates for deterministic ordering
 *
 * Returns the absolute path to the fixture repo.
 */
function createFixtureRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), 'gitrx-e2e-fixture-'));
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'createFixtureRepo', `Creating fixture repo at: ${repoDir}`);

  // Initialize git repo with a default branch name
  execSync('git init --initial-branch=main', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "testdev@example.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "testdev"', { cwd: repoDir, stdio: 'pipe' });

  // Env overrides ensure deterministic author/date regardless of global git config
  const commitEnvBase = {
    ...process.env,
    GIT_AUTHOR_NAME: 'testdev',
    GIT_COMMITTER_NAME: 'testdev',
    GIT_AUTHOR_EMAIL: 'testdev@example.com',
    GIT_COMMITTER_EMAIL: 'testdev@example.com',
  };

  // Commit 1: Initial commit with Jira reference PROJ-101
  mkdirSync(join(repoDir, 'src'), { recursive: true });
  writeFileSync(join(repoDir, 'src', 'main.ts'), 'export function main() { return "hello"; }\n');
  writeFileSync(join(repoDir, 'README.md'), '# Test Project\n');
  execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
  execSync(
    'git commit -m "feat: PROJ-101 initial project setup with main entry point"',
    { cwd: repoDir, stdio: 'pipe', env: { ...commitEnvBase, GIT_AUTHOR_DATE: '2024-06-01T10:00:00Z', GIT_COMMITTER_DATE: '2024-06-01T10:00:00Z' } },
  );

  // Commit 2: Add utility file with Jira reference PROJ-202
  writeFileSync(join(repoDir, 'src', 'utils.ts'), 'export function capitalize(s: string) { return s.toUpperCase(); }\n');
  writeFileSync(join(repoDir, 'src', 'main.ts'), 'import { capitalize } from "./utils";\nexport function main() { return capitalize("hello"); }\n');
  execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
  execSync(
    'git commit -m "feat: PROJ-202 add capitalize utility function"',
    { cwd: repoDir, stdio: 'pipe', env: { ...commitEnvBase, GIT_AUTHOR_DATE: '2024-06-02T10:00:00Z', GIT_COMMITTER_DATE: '2024-06-02T10:00:00Z' } },
  );

  // Commit 3: Bug fix with Jira reference PROJ-101 (second reference to same issue)
  writeFileSync(join(repoDir, 'src', 'main.ts'), 'import { capitalize } from "./utils";\nexport function main() { return capitalize("hello world"); }\n');
  execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
  execSync(
    'git commit -m "fix: PROJ-101 fix main output to include full greeting"',
    { cwd: repoDir, stdio: 'pipe', env: { ...commitEnvBase, GIT_AUTHOR_DATE: '2024-06-03T10:00:00Z', GIT_COMMITTER_DATE: '2024-06-03T10:00:00Z' } },
  );

  logger.debug(CLASS_NAME, 'createFixtureRepo', 'Fixture repo created with 3 commits');
  return repoDir;
}

/**
 * Reset the fixture Git repository to its initial 3-commit state.
 * Removes any commits or branches added during tests.
 * IQS-941: Added to ensure test isolation between tests that modify the repo.
 */
function resetFixtureRepo(repoPath: string): void {
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'resetFixtureRepo', `Resetting fixture repo at: ${repoPath}`);

  try {
    // Checkout main branch first (in case we're on a feature branch)
    execSync('git checkout main', { cwd: repoPath, stdio: 'pipe' });

    // Delete all local branches except main
    const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' });
    const branchLines = branches.split('\n').map((b) => b.trim().replace('* ', ''));
    for (const branch of branchLines) {
      if (branch && branch !== 'main' && branch !== '') {
        execSync(`git branch -D "${branch}"`, { cwd: repoPath, stdio: 'pipe' });
        logger.debug(CLASS_NAME, 'resetFixtureRepo', `Deleted branch: ${branch}`);
      }
    }

    // Hard reset to the 3rd commit (initial state)
    // First, get the SHA of the 3rd commit from the bottom (oldest)
    const logOutput = execSync('git log --oneline --reverse', { cwd: repoPath, encoding: 'utf-8' });
    const commits = logOutput.trim().split('\n');
    if (commits.length >= 3) {
      const thirdCommitSha = commits[2]?.split(' ')[0];
      if (thirdCommitSha) {
        execSync(`git reset --hard ${thirdCommitSha}`, { cwd: repoPath, stdio: 'pipe' });
        logger.debug(CLASS_NAME, 'resetFixtureRepo', `Reset to commit: ${thirdCommitSha}`);
      }
    }

    // Clean up any untracked files
    execSync('git clean -fd', { cwd: repoPath, stdio: 'pipe' });

    logger.debug(CLASS_NAME, 'resetFixtureRepo', 'Fixture repo reset complete');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(CLASS_NAME, 'resetFixtureRepo', `Reset failed (may be expected on first test): ${message}`);
  }
}

/**
 * Clean all test data from the database between tests.
 * Deletes in reverse FK order to avoid constraint violations.
 */
async function cleanDatabase(db: DatabaseService): Promise<void> {
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'cleanDatabase', 'Cleaning all test data');

  // Pipeline tables (depend on pipeline_run, pipeline_log)
  await db.query('DELETE FROM gitja_pipeline_table_counts');
  await db.query('DELETE FROM gitr_pipeline_sha');
  await db.query('DELETE FROM gitr_pipeline_jira');
  await db.query('DELETE FROM gitr_pipeline_log');
  await db.query('DELETE FROM gitr_pipeline_run');

  // Team tables (depend on commit_contributors)
  await db.query('DELETE FROM gitja_team_contributor');

  // Jira GitHub tables (depend on jira_detail)
  await db.query('DELETE FROM jira_github_pullrequest');
  await db.query('DELETE FROM jira_github_branch');

  // Jira tables
  await db.query('DELETE FROM jira_parent');
  await db.query('DELETE FROM jira_issue_link');
  await db.query('DELETE FROM jira_history');

  // Commit-Jira (depends on commit_history and jira_detail)
  await db.query('DELETE FROM commit_jira');

  // Commit detail tables (depend on commit_history)
  await db.query('DELETE FROM commit_msg_words');
  await db.query('DELETE FROM commit_tags');
  await db.query('DELETE FROM commit_branch_relationship');
  await db.query('DELETE FROM commit_directory');
  await db.query('DELETE FROM commit_files_types');
  await db.query('DELETE FROM commit_files');

  // Core tables
  await db.query('DELETE FROM commit_history');
  await db.query('DELETE FROM jira_detail');
  await db.query('DELETE FROM commit_contributors');

  logger.debug(CLASS_NAME, 'cleanDatabase', 'Database cleaned');
}

/**
 * Query helper for counting rows in a table.
 */
async function getRowCount(db: DatabaseService, table: string): Promise<number> {
  const result = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

describe('E2E Pipeline Integration Tests', () => {
  // ========================================================================
  // Setup & Teardown
  // ========================================================================

  beforeAll(async () => {
    // Reset logger for clean test state
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Start PostgreSQL 16 container
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: PG_DATABASE,
        POSTGRES_USER: PG_USER,
        POSTGRES_PASSWORD: PG_PASSWORD,
      })
      .withExposedPorts(PG_PORT)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();

    const mappedPort = container.getMappedPort(PG_PORT);
    const host = container.getHost();

    dbConfig = {
      host,
      port: mappedPort,
      database: PG_DATABASE,
      user: PG_USER,
      password: PG_PASSWORD,
      maxPoolSize: 5,
      connectionTimeoutMs: 15_000,
      idleTimeoutMs: 10_000,
    };

    // Initialize database service and create schema
    dbService = new DatabaseService();
    await dbService.initialize(dbConfig);
    await createSchema(dbService);

    // Create repository instances
    commitRepo = new CommitRepository(dbService);
    commitJiraRepo = new CommitJiraRepository(dbService);
    pipelineRepo = new PipelineRepository(dbService);

    // Create fixture repo (done once for all tests)
    fixtureRepoPath = createFixtureRepo();
  }, 120_000); // Container + repo creation can take up to 2 minutes

  afterAll(async () => {
    // Cleanup fixture repo
    if (fixtureRepoPath) {
      try {
        rmSync(fixtureRepoPath, { recursive: true, force: true });
      } catch { /* ignore cleanup errors */ }
    }

    // Shutdown database
    if (dbService?.isInitialized()) {
      await dbService.shutdown();
    }
    if (container) {
      await container.stop();
    }
  }, 30_000);

  beforeEach(async () => {
    // Reset logger
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Clean database between tests
    await cleanDatabase(dbService);

    // IQS-941: Reset fixture repo to initial 3-commit state for test isolation
    resetFixtureRepo(fixtureRepoPath);
  });

  // ========================================================================
  // Test: Git commit extraction populates commit_history and commit_files
  // ========================================================================

  it('should extract commits from fixture repo into commit_history and commit_files', async () => {
    // Arrange: Create the SCC metrics service (scc CLI may not be available in CI;
    // the service handles missing scc gracefully by returning empty metrics)
    const sccService = new SccMetricsService();
    const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

    const repoEntry: RepositoryEntry = {
      path: fixtureRepoPath,
      name: 'e2e-test-repo',
      organization: 'TestOrg',
      trackerType: 'jira',
    };

    // Act: Run git commit extraction
    const result = await gitAnalysisService.analyzeRepositories([repoEntry]);

    // Assert: Check analysis result
    expect(result.status).toBe('SUCCESS');
    expect(result.repoResults).toHaveLength(1);
    expect(result.repoResults[0]?.repoName).toBe('e2e-test-repo');
    expect(result.repoResults[0]?.commitsInserted).toBe(3);
    expect(result.repoResults[0]?.branchesProcessed).toBeGreaterThanOrEqual(1);

    // Assert: commit_history has 3 rows
    const commitCount = await getRowCount(dbService, 'commit_history');
    expect(commitCount).toBe(3);

    // Assert: commit_files has rows (at least the files we created)
    const fileCount = await getRowCount(dbService, 'commit_files');
    expect(fileCount).toBeGreaterThan(0);

    // Assert: commit_branch_relationship populated
    const branchRelCount = await getRowCount(dbService, 'commit_branch_relationship');
    expect(branchRelCount).toBeGreaterThanOrEqual(3); // At least 3 commits on main

    // Assert: commit messages are correct
    const commits = await dbService.query<{ commit_message: string; author: string }>(
      'SELECT commit_message, author FROM commit_history ORDER BY commit_date ASC',
    );
    expect(commits.rows).toHaveLength(3);
    expect(commits.rows[0]?.commit_message).toContain('PROJ-101 initial project setup');
    expect(commits.rows[1]?.commit_message).toContain('PROJ-202 add capitalize');
    expect(commits.rows[2]?.commit_message).toContain('PROJ-101 fix main output');
    expect(commits.rows[0]?.author).toBe('testdev');

    // Assert: pipeline_run was logged
    const pipelineRunCount = await getRowCount(dbService, 'gitr_pipeline_run');
    expect(pipelineRunCount).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // ========================================================================
  // Test: Commit-Jira linking populates commit_jira
  // ========================================================================

  it('should link commits to Jira issues via commit message regex', async () => {
    // Arrange: First, extract commits
    const sccService = new SccMetricsService();
    const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

    const repoEntry: RepositoryEntry = {
      path: fixtureRepoPath,
      name: 'e2e-test-repo',
      organization: 'TestOrg',
      trackerType: 'jira',
    };

    await gitAnalysisService.analyzeRepositories([repoEntry]);

    // Arrange: Create data enhancer with PROJ as a known key
    // IQS-935: Pass project keys via constructor instead of subclass override
    const dataEnhancer = new DataEnhancerService(
      commitRepo, commitJiraRepo, {}, undefined, ['PROJ'],
    );

    // Act: Run commit-Jira linking
    const enhancerResult = await dataEnhancer.enhanceCommitJiraLinks();

    // Assert: Links were created
    expect(enhancerResult.authorsProcessed).toBeGreaterThanOrEqual(1);
    expect(enhancerResult.linksInserted).toBeGreaterThan(0);

    // Assert: commit_jira has correct rows
    const jiraLinks = await dbService.query<{
      sha: string; jira_key: string; jira_project: string;
    }>(
      'SELECT sha, jira_key, jira_project FROM commit_jira ORDER BY jira_key',
    );
    expect(jiraLinks.rows.length).toBeGreaterThanOrEqual(3);

    // Verify PROJ-101 appears (linked to 2 commits: commit 1 and commit 3)
    const proj101Links = jiraLinks.rows.filter((r) => r.jira_key === 'PROJ-101');
    expect(proj101Links.length).toBe(2);
    expect(proj101Links[0]?.jira_project).toBe('PROJ');

    // Verify PROJ-202 appears (linked to 1 commit: commit 2)
    const proj202Links = jiraLinks.rows.filter((r) => r.jira_key === 'PROJ-202');
    expect(proj202Links.length).toBe(1);
    expect(proj202Links[0]?.jira_project).toBe('PROJ');
  }, 60_000);

  // ========================================================================
  // Test: Full mini pipeline run with selected steps
  // ========================================================================

  it('should run a mini pipeline with git extraction and commit-jira linking', async () => {
    // Arrange: Build services
    const sccService = new SccMetricsService();
    const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

    // IQS-935: Pass project keys via constructor instead of subclass override
    const dataEnhancer = new DataEnhancerService(
      commitRepo, commitJiraRepo, {}, undefined, ['PROJ'],
    );

    // TeamAssignmentService needs ContributorRepository but we won't run that step
    // Mock it as needed
    const teamAssignment = {
      updateTeamAssignmentsWithPipeline: vi.fn().mockResolvedValue({
        authorsProcessed: 0,
        primaryTeamsUpdated: 0,
        teamCountsInserted: 0,
        durationMs: 0,
      }),
    } as unknown as TeamAssignmentService;

    const repoEntry: RepositoryEntry = {
      path: fixtureRepoPath,
      name: 'e2e-test-repo',
      organization: 'TestOrg',
      trackerType: 'jira',
    };

    // Only run git extraction and commit-jira linking (skip GitHub, Jira API steps)
    const selectedSteps: PipelineStepId[] = ['gitCommitExtraction', 'commitJiraLinking'];
    const pipelineConfig = PipelineService.buildConfig(selectedSteps);

    const pipelineService = new PipelineService(
      pipelineRepo,
      gitAnalysisService,
      null, // No GitHub service
      null, // No Jira service
      null, // No Linear service
      dataEnhancer,
      teamAssignment,
      [repoEntry],
      pipelineConfig,
    );

    // Act: Run the pipeline
    const pipelineResult = await pipelineService.runPipeline();

    // Assert: Pipeline completed with at least partial success
    expect(pipelineResult.status).toMatch(/SUCCESS|PARTIAL/);
    expect(pipelineResult.stepResults).toHaveLength(2);

    // Assert: Git extraction step succeeded
    const gitStep = pipelineResult.stepResults.find((s) => s.stepId === 'gitCommitExtraction');
    expect(gitStep).toBeDefined();
    expect(gitStep?.status).toBe('SUCCESS');
    expect(gitStep?.summary).toContain('3 commits');

    // Assert: Commit-Jira linking step succeeded
    const linkStep = pipelineResult.stepResults.find((s) => s.stepId === 'commitJiraLinking');
    expect(linkStep).toBeDefined();
    expect(linkStep?.status).toBe('SUCCESS');
    expect(linkStep?.summary).toContain('links inserted');

    // Assert: pipeline_run was logged with correct status
    const pipelineRuns = await dbService.query<{
      id: number; status: string; class_name: string;
    }>(
      'SELECT id, status, class_name FROM gitr_pipeline_run ORDER BY id DESC LIMIT 5',
    );
    // The PipelineService creates its own pipeline_run, and GitAnalysisService creates another
    expect(pipelineRuns.rows.length).toBeGreaterThanOrEqual(1);
    // The top-level pipeline run should be FINISHED
    const topLevelRun = pipelineRuns.rows.find(
      (r) => r.class_name === 'PipelineService',
    );
    expect(topLevelRun).toBeDefined();
    expect(topLevelRun?.status).toBe('FINISHED');

    // Assert: All data tables populated
    const commitHistoryCount = await getRowCount(dbService, 'commit_history');
    expect(commitHistoryCount).toBe(3);

    const commitFilesCount = await getRowCount(dbService, 'commit_files');
    expect(commitFilesCount).toBeGreaterThan(0);

    const commitJiraCount = await getRowCount(dbService, 'commit_jira');
    expect(commitJiraCount).toBeGreaterThanOrEqual(3); // PROJ-101 x2, PROJ-202 x1

    const pipelineRunCount = await getRowCount(dbService, 'gitr_pipeline_run');
    expect(pipelineRunCount).toBeGreaterThanOrEqual(1);
  }, 90_000);

  // ========================================================================
  // Test: Database cleanup between tests (verify isolation)
  // ========================================================================

  it('should start with empty tables after cleanup (test isolation)', async () => {
    // The beforeEach hook should have cleaned everything
    const commitCount = await getRowCount(dbService, 'commit_history');
    expect(commitCount).toBe(0);

    const fileCount = await getRowCount(dbService, 'commit_files');
    expect(fileCount).toBe(0);

    const jiraCount = await getRowCount(dbService, 'commit_jira');
    expect(jiraCount).toBe(0);

    const pipelineCount = await getRowCount(dbService, 'gitr_pipeline_run');
    expect(pipelineCount).toBe(0);
  });

  // ========================================================================
  // Test: Incremental extraction (re-running adds no duplicates)
  // ========================================================================

  it('should not duplicate data on incremental re-run', async () => {
    // Arrange: Extract commits once
    const sccService = new SccMetricsService();
    const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

    const repoEntry: RepositoryEntry = {
      path: fixtureRepoPath,
      name: 'e2e-test-repo',
      organization: 'TestOrg',
      trackerType: 'jira',
    };

    // First run
    const firstResult = await gitAnalysisService.analyzeRepositories([repoEntry]);
    expect(firstResult.repoResults[0]?.commitsInserted).toBe(3);

    const countAfterFirst = await getRowCount(dbService, 'commit_history');
    expect(countAfterFirst).toBe(3);

    // Second run (incremental - should insert 0 new commits)
    const secondResult = await gitAnalysisService.analyzeRepositories([repoEntry]);
    expect(secondResult.repoResults[0]?.commitsInserted).toBe(0);

    const countAfterSecond = await getRowCount(dbService, 'commit_history');
    expect(countAfterSecond).toBe(3); // No duplicates
  }, 60_000);

  // ========================================================================
  // Test: Pipeline with all steps, GitHub and Jira skipped gracefully
  // ========================================================================

  it('should handle missing GitHub/Jira services gracefully in full pipeline', async () => {
    // Arrange
    const sccService = new SccMetricsService();
    const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

    // IQS-935: Pass project keys via constructor instead of subclass override
    const dataEnhancer = new DataEnhancerService(
      commitRepo, commitJiraRepo, {}, undefined, ['PROJ'],
    );
    const teamAssignment = {
      updateTeamAssignmentsWithPipeline: vi.fn().mockResolvedValue({
        authorsProcessed: 0,
        primaryTeamsUpdated: 0,
        teamCountsInserted: 0,
        durationMs: 0,
      }),
    } as unknown as TeamAssignmentService;

    const repoEntry: RepositoryEntry = {
      path: fixtureRepoPath,
      name: 'e2e-test-repo',
      organization: 'TestOrg',
      trackerType: 'jira',
    };

    // Run ALL pipeline steps (GitHub, Jira, and Linear services are null)
    const pipelineConfig = PipelineService.buildConfig(); // Default = all steps
    const pipelineService = new PipelineService(
      pipelineRepo,
      gitAnalysisService,
      null, // No GitHub
      null, // No Jira
      null, // No Linear
      dataEnhancer,
      teamAssignment,
      [repoEntry],
      pipelineConfig,
    );

    // Act: Run full pipeline
    const result = await pipelineService.runPipeline();

    // Assert: Pipeline reports partial success (GitHub/Jira steps skipped/warned)
    expect(result.stepResults.length).toBe(9); // All 9 steps attempted (6 original + 3 Linear placeholders)

    // Git extraction should succeed
    const gitStep = result.stepResults.find((s) => s.stepId === 'gitCommitExtraction');
    expect(gitStep?.status).toBe('SUCCESS');

    // GitHub and Jira steps should indicate not configured (skipped)
    const githubStep = result.stepResults.find((s) => s.stepId === 'githubContributorSync');
    expect(githubStep?.status).toBe('SUCCESS'); // Returns "not configured" without error
    expect(githubStep?.summary).toContain('not configured');

    const jiraLoadStep = result.stepResults.find((s) => s.stepId === 'jiraIssueLoading');
    expect(jiraLoadStep?.status).toBe('SUCCESS'); // Returns "not configured" without error
    expect(jiraLoadStep?.summary).toContain('not configured');

    // Commit-Jira linking should succeed
    const linkStep = result.stepResults.find((s) => s.stepId === 'commitJiraLinking');
    expect(linkStep?.status).toBe('SUCCESS');

    // Overall status should be SUCCESS (all steps completed, even if some skipped)
    expect(result.status).toBe('SUCCESS');
  }, 90_000);

  // ========================================================================
  // Test: Commit messages and file details are accurately stored
  // ========================================================================

  it('should store accurate commit details including file metadata', async () => {
    // Arrange & Act: Extract commits
    const sccService = new SccMetricsService();
    const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

    const repoEntry: RepositoryEntry = {
      path: fixtureRepoPath,
      name: 'e2e-test-repo',
      organization: 'TestOrg',
      trackerType: 'jira',
    };

    await gitAnalysisService.analyzeRepositories([repoEntry]);

    // Assert: Verify commit details
    const commits = await dbService.query<{
      sha: string;
      repository: string;
      author: string;
      commit_message: string;
      file_count: number;
      is_merge: boolean;
      organization: string;
    }>(
      'SELECT sha, repository, author, commit_message, file_count, is_merge, organization FROM commit_history ORDER BY commit_date ASC',
    );

    expect(commits.rows).toHaveLength(3);

    // First commit: created 2 files (src/main.ts, README.md)
    const firstCommit = commits.rows[0]!;
    expect(firstCommit.repository).toBe('e2e-test-repo');
    expect(firstCommit.author).toBe('testdev');
    expect(firstCommit.is_merge).toBe(false);
    expect(firstCommit.organization).toBe('TestOrg');
    expect(firstCommit.file_count).toBeGreaterThanOrEqual(1);

    // Verify commit_files for second commit (should include src/utils.ts and src/main.ts)
    const secondCommitSha = commits.rows[1]!.sha;
    const filesForSecondCommit = await dbService.query<{
      filename: string;
      file_extension: string;
      parent_directory: string;
      line_inserts: number;
    }>(
      'SELECT filename, file_extension, parent_directory, line_inserts FROM commit_files WHERE sha = $1 ORDER BY filename',
      [secondCommitSha],
    );

    expect(filesForSecondCommit.rows.length).toBeGreaterThanOrEqual(1);
    // At least one .ts file should be present
    const tsFiles = filesForSecondCommit.rows.filter((f) => f.file_extension === '.ts');
    expect(tsFiles.length).toBeGreaterThanOrEqual(1);

    // Verify commit_files_types are populated
    const fileTypesCount = await getRowCount(dbService, 'commit_files_types');
    expect(fileTypesCount).toBeGreaterThan(0);

    // Verify commit_directory populated
    const dirCount = await getRowCount(dbService, 'commit_directory');
    expect(dirCount).toBeGreaterThan(0);

    // Verify commit_msg_words populated
    const wordsCount = await getRowCount(dbService, 'commit_msg_words');
    expect(wordsCount).toBeGreaterThan(0);
  }, 60_000);

  // ========================================================================
  // Test: Incremental detection of NEW commits added after initial extraction
  // Ticket: IQS-941
  // ========================================================================

  it('should detect and extract NEW commits added after initial extraction', async () => {
    // Arrange: Extract initial commits
    const sccService = new SccMetricsService();
    const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo, sccService);
    const logger = LoggerService.getInstance();

    const repoEntry: RepositoryEntry = {
      path: fixtureRepoPath,
      name: 'e2e-test-repo',
      organization: 'TestOrg',
      trackerType: 'jira',
    };

    // First run: Extract initial 3 commits
    const firstResult = await gitAnalysisService.analyzeRepositories([repoEntry]);
    expect(firstResult.repoResults[0]?.commitsInserted).toBe(3);
    logger.debug(CLASS_NAME, 'test', `First run: ${firstResult.repoResults[0]?.commitsInserted} commits inserted`);

    const countAfterFirst = await getRowCount(dbService, 'commit_history');
    expect(countAfterFirst).toBe(3);

    // Add a NEW commit to the fixture repo BETWEEN pipeline runs
    const commitEnvBase = {
      ...process.env,
      GIT_AUTHOR_NAME: 'testdev',
      GIT_COMMITTER_NAME: 'testdev',
      GIT_AUTHOR_EMAIL: 'testdev@example.com',
      GIT_COMMITTER_EMAIL: 'testdev@example.com',
      GIT_AUTHOR_DATE: '2024-06-04T10:00:00Z',
      GIT_COMMITTER_DATE: '2024-06-04T10:00:00Z',
    };

    // Create a new file and commit it
    writeFileSync(join(fixtureRepoPath, 'src', 'helper.ts'), 'export function helper() { return "help"; }\n');
    execSync('git add -A', { cwd: fixtureRepoPath, stdio: 'pipe' });
    execSync(
      'git commit -m "feat: PROJ-303 add helper function for new feature"',
      { cwd: fixtureRepoPath, stdio: 'pipe', env: commitEnvBase },
    );
    logger.debug(CLASS_NAME, 'test', 'Added new commit with PROJ-303');

    // Act: Second run (incremental - should detect and extract the NEW commit)
    const secondResult = await gitAnalysisService.analyzeRepositories([repoEntry]);
    logger.debug(CLASS_NAME, 'test', `Second run: ${secondResult.repoResults[0]?.commitsInserted} commits inserted`);

    // Assert: The new commit should be detected and inserted
    expect(secondResult.repoResults[0]?.commitsInserted).toBe(1);
    expect(secondResult.status).toBe('SUCCESS');

    // Assert: Database now has 4 commits total
    const countAfterSecond = await getRowCount(dbService, 'commit_history');
    expect(countAfterSecond).toBe(4);

    // Assert: The new commit message is in the database
    const allCommits = await dbService.query<{ commit_message: string }>(
      'SELECT commit_message FROM commit_history ORDER BY commit_date ASC',
    );
    expect(allCommits.rows).toHaveLength(4);
    expect(allCommits.rows[3]?.commit_message).toContain('PROJ-303 add helper function');

    // Assert: Commit branch relationship exists for the new commit
    const branchRelCount = await getRowCount(dbService, 'commit_branch_relationship');
    expect(branchRelCount).toBeGreaterThanOrEqual(4); // At least 4 commits on main

    // Assert: Commit files populated for the new commit
    const newCommit = await dbService.query<{ sha: string }>(
      "SELECT sha FROM commit_history WHERE commit_message LIKE '%PROJ-303%'",
    );
    expect(newCommit.rows).toHaveLength(1);
    const newSha = newCommit.rows[0]!.sha;

    const filesForNewCommit = await dbService.query<{ filename: string }>(
      'SELECT filename FROM commit_files WHERE sha = $1',
      [newSha],
    );
    expect(filesForNewCommit.rows.length).toBeGreaterThanOrEqual(1);
    expect(filesForNewCommit.rows.some((f) => f.filename.includes('helper.ts'))).toBe(true);
  }, 90_000);

  // ========================================================================
  // Test: Detect new commits on newly created branches
  // Ticket: IQS-941
  // ========================================================================

  it('should detect new commits on newly created branches', async () => {
    // Arrange: Extract initial commits from main branch
    const sccService = new SccMetricsService();
    const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo, sccService);
    const logger = LoggerService.getInstance();

    const repoEntry: RepositoryEntry = {
      path: fixtureRepoPath,
      name: 'e2e-test-repo',
      organization: 'TestOrg',
      trackerType: 'jira',
    };

    // First run: Extract commits from main branch
    const firstResult = await gitAnalysisService.analyzeRepositories([repoEntry]);
    const initialCommits = firstResult.repoResults[0]?.commitsInserted ?? 0;
    logger.debug(CLASS_NAME, 'test', `First run: ${initialCommits} commits inserted`);

    const countAfterFirst = await getRowCount(dbService, 'commit_history');
    const relCountAfterFirst = await getRowCount(dbService, 'commit_branch_relationship');

    // Create a new branch and add a commit to it
    const commitEnvBase = {
      ...process.env,
      GIT_AUTHOR_NAME: 'testdev',
      GIT_COMMITTER_NAME: 'testdev',
      GIT_AUTHOR_EMAIL: 'testdev@example.com',
      GIT_COMMITTER_EMAIL: 'testdev@example.com',
      GIT_AUTHOR_DATE: '2024-06-05T10:00:00Z',
      GIT_COMMITTER_DATE: '2024-06-05T10:00:00Z',
    };

    // Create feature branch and add new commit
    execSync('git checkout -b feature/new-feature', { cwd: fixtureRepoPath, stdio: 'pipe' });
    writeFileSync(join(fixtureRepoPath, 'src', 'feature.ts'), 'export function feature() { return "feature"; }\n');
    execSync('git add -A', { cwd: fixtureRepoPath, stdio: 'pipe' });
    execSync(
      'git commit -m "feat: PROJ-404 add new feature on feature branch"',
      { cwd: fixtureRepoPath, stdio: 'pipe', env: commitEnvBase },
    );
    logger.debug(CLASS_NAME, 'test', 'Added new commit on feature/new-feature branch');

    // Switch back to main for cleanup purposes
    execSync('git checkout main', { cwd: fixtureRepoPath, stdio: 'pipe' });

    // Act: Second run - should detect the new branch and new commit
    const secondResult = await gitAnalysisService.analyzeRepositories([repoEntry]);
    logger.debug(CLASS_NAME, 'test', `Second run: ${secondResult.repoResults[0]?.commitsInserted} new commits`);
    logger.debug(CLASS_NAME, 'test', `Second run: ${secondResult.repoResults[0]?.branchRelationshipsRecorded} new relationships`);

    // Assert: The new commit on the feature branch should be detected
    expect(secondResult.repoResults[0]?.commitsInserted).toBeGreaterThanOrEqual(1);
    expect(secondResult.status).toBe('SUCCESS');

    // Assert: Database has more commits than before
    const countAfterSecond = await getRowCount(dbService, 'commit_history');
    expect(countAfterSecond).toBeGreaterThan(countAfterFirst);

    // Assert: The new commit message is in the database
    const featureCommit = await dbService.query<{ sha: string; commit_message: string }>(
      "SELECT sha, commit_message FROM commit_history WHERE commit_message LIKE '%PROJ-404%'",
    );
    expect(featureCommit.rows).toHaveLength(1);
    expect(featureCommit.rows[0]?.commit_message).toContain('add new feature on feature branch');

    // Assert: Branch relationship recorded for the feature branch
    const featureRelationships = await dbService.query<{ branch: string }>(
      'SELECT branch FROM commit_branch_relationship WHERE sha = $1',
      [featureCommit.rows[0]!.sha],
    );
    expect(featureRelationships.rows.length).toBeGreaterThanOrEqual(1);
    expect(featureRelationships.rows.some((r) => r.branch === 'feature/new-feature')).toBe(true);

    // Assert: More branch relationships than before
    const relCountAfterSecond = await getRowCount(dbService, 'commit_branch_relationship');
    expect(relCountAfterSecond).toBeGreaterThan(relCountAfterFirst);
  }, 90_000);

  // ========================================================================
  // Test: Unchanged repository reports 0 new commits on re-run
  // Ticket: IQS-941 (AC-2.3)
  // ========================================================================

  it('should report 0 new commits when repository is unchanged', async () => {
    // Arrange: Extract all commits
    const sccService = new SccMetricsService();
    const gitAnalysisService = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

    const repoEntry: RepositoryEntry = {
      path: fixtureRepoPath,
      name: 'e2e-test-repo',
      organization: 'TestOrg',
      trackerType: 'jira',
    };

    // First run
    const firstResult = await gitAnalysisService.analyzeRepositories([repoEntry]);
    const firstCommits = firstResult.repoResults[0]?.commitsInserted ?? 0;
    expect(firstCommits).toBeGreaterThan(0);

    // Second run without any changes to the repo
    const secondResult = await gitAnalysisService.analyzeRepositories([repoEntry]);
    expect(secondResult.repoResults[0]?.commitsInserted).toBe(0);
    expect(secondResult.repoResults[0]?.branchRelationshipsRecorded).toBe(0);

    // Third run - still no changes
    const thirdResult = await gitAnalysisService.analyzeRepositories([repoEntry]);
    expect(thirdResult.repoResults[0]?.commitsInserted).toBe(0);
    expect(thirdResult.repoResults[0]?.branchRelationshipsRecorded).toBe(0);
  }, 60_000);
});
