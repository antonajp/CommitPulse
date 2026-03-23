/**
 * Integration tests for GITX-131 incremental extraction optimization.
 *
 * Tests the performance optimizations:
 * - Phase 1: git for-each-ref bulk branch discovery
 * - Phase 2: skipScc option for fast extraction
 * - Phase 3: useGitLogAll option for single-query extraction
 *
 * Uses Testcontainers with PostgreSQL 16 and creates a fixture Git repository
 * to validate that optimized extraction produces identical results to the
 * standard branch iteration approach.
 *
 * Ticket: GITX-131
 */

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
import { PipelineRepository } from '../../database/pipeline-repository.js';
import { GitAnalysisService } from '../../services/git-analysis-service.js';
import { SccMetricsService } from '../../services/scc-metrics-service.js';
import type { RepositoryEntry } from '../../config/settings.js';
import type { GitAnalysisOptions } from '../../services/git-analysis-types.js';

const PG_DATABASE = 'gitrx_incr_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

const CLASS_NAME = 'IncrementalExtractionTest';

let container: StartedTestContainer;
let dbService: DatabaseService;
let dbConfig: DatabaseServiceConfig;
let fixtureRepoPath: string;
let commitRepo: CommitRepository;
let pipelineRepo: PipelineRepository;

/**
 * Create the database schema from migration files.
 */
async function createSchema(db: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');
  const tableSql = readFileSync(join(migrationsDir, '001_create_tables.sql'), 'utf-8');
  await db.query(tableSql);
  const viewsSql = readFileSync(join(migrationsDir, '002_create_views.sql'), 'utf-8');
  await db.query(viewsSql);
}

/**
 * Create a fixture Git repository with multiple branches and commits.
 *
 * Structure:
 * - main branch: 5 commits
 * - feature/auth branch: 3 commits (2 unique, 1 shared with main)
 * - feature/ui branch: 2 commits (1 unique, 1 shared with main)
 *
 * This structure tests:
 * - Branch discovery optimization
 * - Multi-branch commit handling
 * - Branch relationship recording
 */
function createFixtureRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), 'gitrx-incr-fixture-'));
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'createFixtureRepo', `Creating fixture repo at: ${repoDir}`);

  // Initialize git repo
  execSync('git init --initial-branch=main', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "dev@example.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Developer"', { cwd: repoDir, stdio: 'pipe' });

  const commitEnv = {
    GIT_AUTHOR_NAME: 'Developer',
    GIT_AUTHOR_EMAIL: 'dev@example.com',
    GIT_COMMITTER_NAME: 'Developer',
    GIT_COMMITTER_EMAIL: 'dev@example.com',
  };

  // Commit 1: Initial commit on main
  writeFileSync(join(repoDir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "Initial commit PROJ-100"', {
    cwd: repoDir,
    stdio: 'pipe',
    env: { ...process.env, ...commitEnv, GIT_AUTHOR_DATE: '2024-01-01T10:00:00', GIT_COMMITTER_DATE: '2024-01-01T10:00:00' },
  });

  // Commit 2: Add src directory
  mkdirSync(join(repoDir, 'src'), { recursive: true });
  writeFileSync(join(repoDir, 'src', 'index.ts'), 'export const version = "1.0.0";\n');
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "feat(PROJ-101): Add src directory"', {
    cwd: repoDir,
    stdio: 'pipe',
    env: { ...process.env, ...commitEnv, GIT_AUTHOR_DATE: '2024-01-02T10:00:00', GIT_COMMITTER_DATE: '2024-01-02T10:00:00' },
  });

  // Create feature/auth branch
  execSync('git checkout -b feature/auth', { cwd: repoDir, stdio: 'pipe' });

  // Commit 3: Auth feature (on feature/auth)
  writeFileSync(join(repoDir, 'src', 'auth.ts'), 'export function login() {}\n');
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "feat(PROJ-102): Add auth module"', {
    cwd: repoDir,
    stdio: 'pipe',
    env: { ...process.env, ...commitEnv, GIT_AUTHOR_DATE: '2024-01-03T10:00:00', GIT_COMMITTER_DATE: '2024-01-03T10:00:00' },
  });

  // Commit 4: Auth tests (on feature/auth)
  mkdirSync(join(repoDir, 'tests'), { recursive: true });
  writeFileSync(join(repoDir, 'tests', 'auth.test.ts'), 'describe("auth", () => {});\n');
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "test(PROJ-102): Add auth tests"', {
    cwd: repoDir,
    stdio: 'pipe',
    env: { ...process.env, ...commitEnv, GIT_AUTHOR_DATE: '2024-01-04T10:00:00', GIT_COMMITTER_DATE: '2024-01-04T10:00:00' },
  });

  // Switch back to main
  execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });

  // Commit 5: Main continues (on main only)
  writeFileSync(join(repoDir, 'src', 'utils.ts'), 'export function helper() {}\n');
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "feat(PROJ-103): Add utils"', {
    cwd: repoDir,
    stdio: 'pipe',
    env: { ...process.env, ...commitEnv, GIT_AUTHOR_DATE: '2024-01-05T10:00:00', GIT_COMMITTER_DATE: '2024-01-05T10:00:00' },
  });

  // Create feature/ui branch from main
  execSync('git checkout -b feature/ui', { cwd: repoDir, stdio: 'pipe' });

  // Commit 6: UI feature (on feature/ui)
  writeFileSync(join(repoDir, 'src', 'ui.ts'), 'export function render() {}\n');
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "feat(PROJ-104): Add UI module"', {
    cwd: repoDir,
    stdio: 'pipe',
    env: { ...process.env, ...commitEnv, GIT_AUTHOR_DATE: '2024-01-06T10:00:00', GIT_COMMITTER_DATE: '2024-01-06T10:00:00' },
  });

  // Switch back to main for final state
  execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });

  logger.info(CLASS_NAME, 'createFixtureRepo', `Created fixture repo with 6 commits across 3 branches`);
  return repoDir;
}

/**
 * Clean up the fixture repository.
 */
function cleanupFixtureRepo(repoDir: string): void {
  try {
    rmSync(repoDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Incremental Extraction Optimization (GITX-131)', () => {
  // Increase timeout for container startup
  beforeAll(async () => {
    // Start PostgreSQL container
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
    };

    // Create fixture repo
    fixtureRepoPath = createFixtureRepo();
  }, 120000);

  afterAll(async () => {
    // Cleanup - dbService may already be shutdown by afterEach
    try {
      if (dbService) {
        await dbService.shutdown();
      }
    } catch {
      // Ignore - may already be shutdown
    }
    if (container) {
      await container.stop({ timeout: 30000 });
    }
    if (fixtureRepoPath) {
      cleanupFixtureRepo(fixtureRepoPath);
    }
  }, 30000);

  beforeEach(async () => {
    // Fresh database connection and schema for each test
    dbService = new DatabaseService();
    await dbService.initialize(dbConfig);

    // Drop and recreate tables
    await dbService.query('DROP SCHEMA public CASCADE');
    await dbService.query('CREATE SCHEMA public');
    await createSchema(dbService);

    // Create repositories
    commitRepo = new CommitRepository(dbService);
    pipelineRepo = new PipelineRepository(dbService);
  });

  afterEach(async () => {
    // Shutdown database connection after each test
    if (dbService) {
      await dbService.shutdown();
    }
  });

  describe('Phase 1: Branch Discovery Optimization', () => {
    it('should discover all branches using git for-each-ref', async () => {
      const sccService = new SccMetricsService();
      const service = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

      const repoEntry: RepositoryEntry = {
        name: 'test-repo',
        path: fixtureRepoPath,
        organization: 'TestOrg',
        trackerType: 'jira',
      };

      const options: GitAnalysisOptions = {
        debugLogging: true,
        skipScc: true, // Skip SCC to focus on branch discovery
      };

      const result = await service.analyzeRepositories([repoEntry], options);

      // Verify extraction succeeded
      expect(result.status).toBe('SUCCESS');
      expect(result.repoResults).toHaveLength(1);
      expect(result.repoResults[0]!.error).toBeUndefined();

      // Should have processed all 3 branches
      expect(result.repoResults[0]!.branchesProcessed).toBe(3);

      // Should have 6 unique commits
      expect(result.repoResults[0]!.commitsInserted).toBe(6);

      // Verify commits in database
      const commits = await dbService.query('SELECT COUNT(DISTINCT sha) as count FROM commit_history');
      expect(commits.rows[0].count).toBe('6');

      // Verify branch relationships recorded
      const relationships = await dbService.query('SELECT COUNT(*) as count FROM commit_branch_relationship');
      // 3 commits on main, 2 on feature/auth, 1 on feature/ui = 6 relationships
      expect(parseInt(relationships.rows[0].count, 10)).toBeGreaterThanOrEqual(6);
    });
  });

  describe('Phase 2: skipScc Option', () => {
    it('should extract commits with zero SCC metrics when skipScc=true', async () => {
      const sccService = new SccMetricsService();
      const service = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

      const repoEntry: RepositoryEntry = {
        name: 'test-repo',
        path: fixtureRepoPath,
        organization: 'TestOrg',
        trackerType: 'jira',
      };

      const options: GitAnalysisOptions = {
        skipScc: true,
      };

      const result = await service.analyzeRepositories([repoEntry], options);

      expect(result.status).toBe('SUCCESS');
      expect(result.repoResults[0]!.commitsInserted).toBe(6);

      // Verify commit_files have zero SCC metrics
      const files = await dbService.query(`
        SELECT total_lines, total_code_lines, complexity
        FROM commit_files
        LIMIT 5
      `);

      expect(files.rows.length).toBeGreaterThan(0);
      for (const row of files.rows) {
        expect(row.total_lines).toBe(0);
        expect(row.total_code_lines).toBe(0);
        expect(row.complexity).toBe(0);
      }
    });

    it('should extract commits with actual SCC metrics when skipScc=false', async () => {
      const sccService = new SccMetricsService();
      const service = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

      const repoEntry: RepositoryEntry = {
        name: 'test-repo',
        path: fixtureRepoPath,
        organization: 'TestOrg',
        trackerType: 'jira',
      };

      const options: GitAnalysisOptions = {
        skipScc: false,
      };

      const result = await service.analyzeRepositories([repoEntry], options);

      expect(result.status).toBe('SUCCESS');

      // Check if SCC is available before verifying metrics
      const sccAvailable = await sccService.isSccAvailable();
      if (sccAvailable) {
        // Verify some commit_files have non-zero SCC metrics
        const files = await dbService.query(`
          SELECT total_lines, total_code_lines
          FROM commit_files
          WHERE total_lines > 0
          LIMIT 1
        `);

        expect(files.rows.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Phase 3: useGitLogAll Option', () => {
    it('should extract all commits with single git log --all query', async () => {
      const sccService = new SccMetricsService();
      const service = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

      const repoEntry: RepositoryEntry = {
        name: 'test-repo',
        path: fixtureRepoPath,
        organization: 'TestOrg',
        trackerType: 'jira',
      };

      const options: GitAnalysisOptions = {
        useGitLogAll: true,
        skipScc: true, // Faster test
        debugLogging: true,
      };

      const result = await service.analyzeRepositories([repoEntry], options);

      expect(result.status).toBe('SUCCESS');
      expect(result.repoResults[0]!.error).toBeUndefined();

      // Should have all 6 commits
      expect(result.repoResults[0]!.commitsInserted).toBe(6);

      // Verify commits in database
      const commits = await dbService.query('SELECT COUNT(DISTINCT sha) as count FROM commit_history');
      expect(commits.rows[0].count).toBe('6');

      // Verify branch relationships are correctly recorded
      // With git log --all, each commit gets relationships for all containing branches
      const relationships = await dbService.query(`
        SELECT sha, COUNT(DISTINCT branch) as branch_count
        FROM commit_branch_relationship
        GROUP BY sha
      `);

      // Initial commit should be on all 3 branches (main, feature/auth, feature/ui)
      // or at least on main
      expect(relationships.rows.length).toBe(6);
    });

    it('should produce identical results to branch iteration', async () => {
      // First extraction using standard branch iteration
      const sccService1 = new SccMetricsService();
      const service1 = new GitAnalysisService(commitRepo, pipelineRepo, sccService1);

      const repoEntry: RepositoryEntry = {
        name: 'test-repo',
        path: fixtureRepoPath,
        organization: 'TestOrg',
        trackerType: 'jira',
      };

      const standardOptions: GitAnalysisOptions = {
        useGitLogAll: false,
        skipScc: true,
      };

      const standardResult = await service1.analyzeRepositories([repoEntry], standardOptions);
      expect(standardResult.status).toBe('SUCCESS');

      // Get commit SHAs from standard extraction
      const standardCommits = await dbService.query(`
        SELECT DISTINCT sha FROM commit_history ORDER BY sha
      `);

      // Reset database (gitr_pipeline_sha references commit_history, so delete it first)
      await dbService.query('DELETE FROM commit_branch_relationship');
      await dbService.query('DELETE FROM commit_files');
      await dbService.query('DELETE FROM commit_files_types');
      await dbService.query('DELETE FROM commit_directory');
      await dbService.query('DELETE FROM commit_msg_words');
      await dbService.query('DELETE FROM commit_tags');
      await dbService.query('DELETE FROM gitr_pipeline_sha');
      await dbService.query('DELETE FROM commit_history');

      // Second extraction using git log --all
      const sccService2 = new SccMetricsService();
      const service2 = new GitAnalysisService(commitRepo, pipelineRepo, sccService2);

      const fastOptions: GitAnalysisOptions = {
        useGitLogAll: true,
        skipScc: true,
      };

      const fastResult = await service2.analyzeRepositories([repoEntry], fastOptions);
      expect(fastResult.status).toBe('SUCCESS');

      // Get commit SHAs from fast extraction
      const fastCommits = await dbService.query(`
        SELECT DISTINCT sha FROM commit_history ORDER BY sha
      `);

      // Verify identical commits extracted
      expect(fastCommits.rows.length).toBe(standardCommits.rows.length);

      const standardSHAs = standardCommits.rows.map((r: { sha: string }) => r.sha);
      const fastSHAs = fastCommits.rows.map((r: { sha: string }) => r.sha);

      for (const sha of standardSHAs) {
        expect(fastSHAs).toContain(sha);
      }
    });
  });

  describe('Incremental Extraction', () => {
    it('should only extract new commits on subsequent runs', async () => {
      const sccService = new SccMetricsService();
      const service = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

      const repoEntry: RepositoryEntry = {
        name: 'test-repo',
        path: fixtureRepoPath,
        organization: 'TestOrg',
        trackerType: 'jira',
      };

      // First extraction - all commits
      const firstResult = await service.analyzeRepositories([repoEntry], { skipScc: true });
      expect(firstResult.status).toBe('SUCCESS');
      expect(firstResult.repoResults[0]!.commitsInserted).toBe(6);

      // Second extraction - should skip existing commits
      const secondResult = await service.analyzeRepositories([repoEntry], { skipScc: true });
      expect(secondResult.status).toBe('SUCCESS');
      expect(secondResult.repoResults[0]!.commitsInserted).toBe(0);

      // Verify still 6 commits in database
      const commits = await dbService.query('SELECT COUNT(DISTINCT sha) as count FROM commit_history');
      expect(commits.rows[0].count).toBe('6');
    });

    it('should complete quickly when no new commits', async () => {
      const sccService = new SccMetricsService();
      const service = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

      const repoEntry: RepositoryEntry = {
        name: 'test-repo',
        path: fixtureRepoPath,
        organization: 'TestOrg',
        trackerType: 'jira',
      };

      // First extraction
      await service.analyzeRepositories([repoEntry], { skipScc: true });

      // Second extraction - time it
      const startTime = Date.now();
      const secondResult = await service.analyzeRepositories([repoEntry], { skipScc: true });
      const elapsedMs = Date.now() - startTime;

      expect(secondResult.status).toBe('SUCCESS');
      expect(secondResult.repoResults[0]!.commitsInserted).toBe(0);

      // Should complete in under 5 seconds for a re-run with no changes
      // This is a generous threshold for CI environments
      expect(elapsedMs).toBeLessThan(5000);
    });
  });

  describe('Performance', () => {
    it('should measure branch discovery time', async () => {
      const sccService = new SccMetricsService();
      const service = new GitAnalysisService(commitRepo, pipelineRepo, sccService);

      const repoEntry: RepositoryEntry = {
        name: 'test-repo',
        path: fixtureRepoPath,
        organization: 'TestOrg',
        trackerType: 'jira',
      };

      const startTime = Date.now();
      const result = await service.analyzeRepositories([repoEntry], { skipScc: true });
      const totalMs = Date.now() - startTime;

      expect(result.status).toBe('SUCCESS');
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);

      // The result.totalDurationMs should be close to our measured time
      expect(Math.abs(result.totalDurationMs - totalMs)).toBeLessThan(500);
    });
  });
});
