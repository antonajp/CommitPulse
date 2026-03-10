import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  DatabaseService,
  type DatabaseServiceConfig,
} from '../../database/database-service.js';
import { CommitHygieneDataService } from '../../services/commit-hygiene-service.js';

/**
 * Integration tests for CommitHygieneDataService with a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema from migration files,
 * then exercises the data service methods against the real database.
 *
 * Ticket: IQS-915
 *
 * Test coverage includes:
 * - View correctness with sample data
 * - Hygiene score calculations
 * - Quality tier thresholds
 * - Conventional commit pattern detection
 * - Author aggregation
 * - Weekly trend aggregation
 * - Filter combinations
 */

const PG_DATABASE = 'gitrx_hygiene_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let hygieneService: CommitHygieneDataService;

/**
 * Helper: Create schema from migration files.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply migrations in order (dependencies first)
  const migrations = [
    '001_create_tables.sql',
    '002_create_views.sql',
    '004_add_linear_support.sql',
    '010_dev_pipeline_baseline.sql',
    '020_commit_hygiene.sql',
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert test data for hygiene analysis.
 */
async function insertTestData(dbService: DatabaseService): Promise<void> {
  // Insert commit_contributors
  await dbService.query(`
    INSERT INTO commit_contributors (login, full_name, email, team)
    VALUES
      ('good_dev', 'Good Developer', 'good@test.com', 'Engineering'),
      ('fair_dev', 'Fair Developer', 'fair@test.com', 'Engineering'),
      ('poor_dev', 'Poor Developer', 'poor@test.com', 'Platform')
    ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name
  `);

  // Insert commits with excellent hygiene (conventional, scoped, body, proper formatting)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      ('excellent_sha_001', 'https://github.com/org/repo/commit/excellent_sha_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'good_dev', NOW() - INTERVAL '1 day', 'feat(auth): Add OAuth2 authentication support

This commit adds OAuth2 authentication support with:
- Google provider integration
- Token refresh handling
- Session management

BREAKING CHANGE: Auth API endpoints changed', 5, 200, 30, FALSE, FALSE, 'TestOrg'),

      ('excellent_sha_002', 'https://github.com/org/repo/commit/excellent_sha_002', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'good_dev', NOW() - INTERVAL '2 days', 'fix(api): Resolve race condition in data sync

Fixed the race condition by implementing proper mutex locks.

Fixes: TEST-456', 3, 50, 20, FALSE, FALSE, 'TestOrg'),

      ('excellent_sha_003', 'https://github.com/org/repo/commit/excellent_sha_003', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'good_dev', NOW() - INTERVAL '3 days', 'docs(readme): Update installation instructions

Updated the README with clearer installation steps.', 1, 30, 10, FALSE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commits with good hygiene (conventional, no scope, short body)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      ('good_sha_001', 'https://github.com/org/repo/commit/good_sha_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'fair_dev', NOW() - INTERVAL '4 days', 'feat: Add user profile page', 4, 150, 20, FALSE, FALSE, 'TestOrg'),

      ('good_sha_002', 'https://github.com/org/repo/commit/good_sha_002', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'fair_dev', NOW() - INTERVAL '5 days', 'fix: Correct validation error message', 2, 15, 5, FALSE, FALSE, 'TestOrg'),

      ('good_sha_003', 'https://github.com/org/repo/commit/good_sha_003', 'feature', 'test-repo', 'https://github.com/org/test-repo.git', 'fair_dev', NOW() - INTERVAL '6 days', 'refactor: Extract utility functions', 3, 80, 60, FALSE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commits with fair hygiene (some issues)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      ('fair_sha_001', 'https://github.com/org/repo/commit/fair_sha_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'fair_dev', NOW() - INTERVAL '7 days', 'feat: add some new feature stuff here that is quite long and needs to be shortened.', 5, 100, 30, FALSE, FALSE, 'TestOrg'),

      ('fair_sha_002', 'https://github.com/org/repo/commit/fair_sha_002', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'poor_dev', NOW() - INTERVAL '8 days', 'fix: bug', 1, 5, 2, FALSE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commits with poor hygiene (no conventional prefix, bad formatting)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      ('poor_sha_001', 'https://github.com/org/repo/commit/poor_sha_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'poor_dev', NOW() - INTERVAL '9 days', 'fixed stuff.', 3, 40, 15, FALSE, FALSE, 'TestOrg'),

      ('poor_sha_002', 'https://github.com/org/repo/commit/poor_sha_002', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'poor_dev', NOW() - INTERVAL '10 days', 'wip', 2, 20, 5, FALSE, FALSE, 'TestOrg'),

      ('poor_sha_003', 'https://github.com/org/repo/commit/poor_sha_003', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'poor_dev', NOW() - INTERVAL '11 days', 'asdfasdf', 1, 10, 2, FALSE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commit_files for all commits
  const commits = [
    'excellent_sha_001', 'excellent_sha_002', 'excellent_sha_003',
    'good_sha_001', 'good_sha_002', 'good_sha_003',
    'fair_sha_001', 'fair_sha_002',
    'poor_sha_001', 'poor_sha_002', 'poor_sha_003',
  ];

  for (const sha of commits) {
    await dbService.query(`
      INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
      VALUES ($1, 'src/file.ts', 50, 10, 10, 100, 10, FALSE)
      ON CONFLICT (sha, filename) DO NOTHING
    `, [sha]);
  }
}

describe('CommitHygieneDataService Integration Tests', () => {
  beforeAll(async () => {
    // Reset logger for clean test state
    try {
      LoggerService.getInstance().dispose();
    } catch {
      /* ignore */
    }
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

    config = {
      host,
      port: mappedPort,
      database: PG_DATABASE,
      user: PG_USER,
      password: PG_PASSWORD,
      maxPoolSize: 3,
      connectionTimeoutMs: 10_000,
      idleTimeoutMs: 5_000,
    };

    // Initialize database service
    service = new DatabaseService();
    await service.initialize(config);

    // Create schema
    await createSchema(service);

    // Create data service
    hygieneService = new CommitHygieneDataService(service);
  }, 120_000); // 2 minute timeout for container startup

  afterAll(async () => {
    if (service?.isInitialized()) {
      await service.shutdown();
    }
    if (container) {
      await container.stop();
    }
    try {
      LoggerService.getInstance().dispose();
    } catch {
      /* ignore */
    }
    LoggerService.resetInstance();
  }, 30_000);

  beforeEach(async () => {
    // Clear test data before each test
    await service.query('DELETE FROM commit_jira');
    await service.query('DELETE FROM commit_linear');
    await service.query('DELETE FROM commit_files');
    await service.query('DELETE FROM commit_history');
    await service.query('DELETE FROM commit_contributors');
  });

  describe('checkHygieneViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await hygieneService.checkHygieneViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('checkAuthorHygieneViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await hygieneService.checkAuthorHygieneViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('checkWeeklyHygieneViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await hygieneService.checkWeeklyHygieneViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('getCommitHygiene', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return commits ordered by date descending', async () => {
      const result = await hygieneService.getCommitHygiene();

      // Should have commits
      expect(result.length).toBeGreaterThan(0);

      // Verify date ordering
      for (let i = 1; i < result.length; i++) {
        const prevDate = result[i - 1]?.commitDate ?? '';
        const currDate = result[i]?.commitDate ?? '';
        expect(prevDate >= currDate).toBe(true);
      }
    });

    it('should detect conventional commit prefix correctly', async () => {
      const result = await hygieneService.getCommitHygiene();

      // Find commits with conventional prefix
      const conventionalCommits = result.filter((r) => r.hasConventionalPrefix);
      expect(conventionalCommits.length).toBeGreaterThan(0);

      // All conventional commits should have a commit type
      for (const commit of conventionalCommits) {
        expect(commit.commitType).not.toBeNull();
        expect(['feat', 'fix', 'docs', 'refactor']).toContain(commit.commitType);
      }

      // Find commits without conventional prefix (poor commits)
      const nonConventionalCommits = result.filter((r) => !r.hasConventionalPrefix);
      expect(nonConventionalCommits.length).toBeGreaterThan(0);

      // Non-conventional commits should have null commit type
      for (const commit of nonConventionalCommits) {
        expect(commit.commitType).toBeNull();
      }
    });

    it('should detect scope correctly', async () => {
      const result = await hygieneService.getCommitHygiene();

      // Find commits with scope
      const scopedCommits = result.filter((r) => r.hasScope);
      expect(scopedCommits.length).toBeGreaterThan(0);

      // All scoped commits should have a scope value
      for (const commit of scopedCommits) {
        expect(commit.scope).not.toBeNull();
      }

      // Excellent commits should have scope
      const excellentCommit = result.find((r) => r.sha === 'excellent_sha_001');
      expect(excellentCommit?.hasScope).toBe(true);
      expect(excellentCommit?.scope).toBe('auth');
    });

    it('should detect body correctly', async () => {
      const result = await hygieneService.getCommitHygiene();

      // Excellent commits should have body
      const excellentCommit = result.find((r) => r.sha === 'excellent_sha_001');
      expect(excellentCommit?.hasBody).toBe(true);
      expect(excellentCommit?.messageLineCount).toBeGreaterThan(1);

      // Poor commits should not have body
      const poorCommit = result.find((r) => r.sha === 'poor_sha_001');
      expect(poorCommit?.hasBody).toBe(false);
    });

    it('should calculate hygiene scores correctly', async () => {
      const result = await hygieneService.getCommitHygiene();

      // All commits should have a hygiene score
      for (const commit of result) {
        expect(commit.hygieneScore).toBeGreaterThanOrEqual(0);
        expect(commit.hygieneScore).toBeLessThanOrEqual(100);
      }

      // Excellent commits should have high scores
      const excellentCommit = result.find((r) => r.sha === 'excellent_sha_001');
      expect(excellentCommit?.hygieneScore).toBeGreaterThanOrEqual(80);

      // Poor commits should have low scores
      const poorCommit = result.find((r) => r.sha === 'poor_sha_001');
      expect(poorCommit?.hygieneScore).toBeLessThan(40);
    });

    it('should assign quality tiers correctly', async () => {
      const result = await hygieneService.getCommitHygiene();

      // Verify quality tiers match hygiene scores
      for (const commit of result) {
        if (commit.hygieneScore >= 80) {
          expect(commit.qualityTier).toBe('excellent');
        } else if (commit.hygieneScore >= 60) {
          expect(commit.qualityTier).toBe('good');
        } else if (commit.hygieneScore >= 40) {
          expect(commit.qualityTier).toBe('fair');
        } else {
          expect(commit.qualityTier).toBe('poor');
        }
      }
    });

    it('should filter by repository', async () => {
      const result = await hygieneService.getCommitHygiene({ repository: 'test-repo' });

      for (const commit of result) {
        expect(commit.repository).toBe('test-repo');
      }
    });

    it('should filter by quality tier', async () => {
      const result = await hygieneService.getCommitHygiene({ qualityTier: 'excellent' });

      for (const commit of result) {
        expect(commit.qualityTier).toBe('excellent');
        expect(commit.hygieneScore).toBeGreaterThanOrEqual(80);
      }
    });

    it('should filter by commit type', async () => {
      const result = await hygieneService.getCommitHygiene({ commitType: 'feat' });

      for (const commit of result) {
        expect(commit.commitType).toBe('feat');
      }
    });

    it('should return empty for non-existent repository', async () => {
      const result = await hygieneService.getCommitHygiene({ repository: 'non-existent' });
      expect(result.length).toBe(0);
    });
  });

  describe('getAuthorSummaries', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should aggregate hygiene metrics by author', async () => {
      const result = await hygieneService.getAuthorSummaries();

      // Should have author summaries
      expect(result.length).toBeGreaterThan(0);

      // Each summary should have valid data
      for (const summary of result) {
        expect(summary.author).toBeDefined();
        expect(summary.totalCommits).toBeGreaterThan(0);
        expect(summary.avgHygieneScore).toBeGreaterThanOrEqual(0);
        expect(summary.avgHygieneScore).toBeLessThanOrEqual(100);
      }
    });

    it('should include quality tier distribution', async () => {
      const result = await hygieneService.getAuthorSummaries();

      for (const summary of result) {
        // Distribution should sum to total commits
        const totalDistribution =
          summary.excellentCount +
          summary.goodCount +
          summary.fairCount +
          summary.poorCount;
        expect(totalDistribution).toBe(summary.totalCommits);
      }
    });

    it('should include conventional commit percentage', async () => {
      const result = await hygieneService.getAuthorSummaries();

      // good_dev should have high conventional percentage
      const goodDevSummary = result.find((s) => s.author === 'good_dev');
      expect(goodDevSummary?.conventionalPct).toBeGreaterThanOrEqual(90);

      // poor_dev should have lower conventional percentage
      const poorDevSummary = result.find((s) => s.author === 'poor_dev');
      expect(poorDevSummary?.conventionalPct).toBeLessThan(50);
    });

    it('should filter by repository', async () => {
      const result = await hygieneService.getAuthorSummaries({ repository: 'test-repo' });

      for (const summary of result) {
        expect(summary.repository).toBe('test-repo');
      }
    });

    it('should filter by team', async () => {
      const result = await hygieneService.getAuthorSummaries({ team: 'Engineering' });

      for (const summary of result) {
        expect(summary.team).toBe('Engineering');
      }
    });
  });

  describe('getWeeklyTrends', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should aggregate hygiene metrics by week', async () => {
      const result = await hygieneService.getWeeklyTrends();

      // Should have weekly trends
      expect(result.length).toBeGreaterThan(0);

      // Each trend should have valid data
      for (const trend of result) {
        expect(trend.week).toBeDefined();
        expect(trend.repository).toBeDefined();
        expect(trend.totalCommits).toBeGreaterThan(0);
        expect(trend.avgHygieneScore).toBeGreaterThanOrEqual(0);
        expect(trend.avgHygieneScore).toBeLessThanOrEqual(100);
      }
    });

    it('should include quality tier distribution per week', async () => {
      const result = await hygieneService.getWeeklyTrends();

      for (const trend of result) {
        // Distribution should sum to total commits
        const totalDistribution =
          trend.excellentCount +
          trend.goodCount +
          trend.fairCount +
          trend.poorCount;
        expect(totalDistribution).toBe(trend.totalCommits);
      }
    });

    it('should filter by repository', async () => {
      const result = await hygieneService.getWeeklyTrends({ repository: 'test-repo' });

      for (const trend of result) {
        expect(trend.repository).toBe('test-repo');
      }
    });
  });

  describe('getCommitHygieneChartData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return chart data with view existence check', async () => {
      const result = await hygieneService.getCommitHygieneChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.commits.length).toBeGreaterThan(0);
    });

    it('should return empty data when no commits match filters', async () => {
      const result = await hygieneService.getCommitHygieneChartData({
        repository: 'non-existent-repo',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.commits.length).toBe(0);
    });
  });

  describe('getAuthorSummaryData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return summary data with view existence check', async () => {
      const result = await hygieneService.getAuthorSummaryData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.summaries.length).toBeGreaterThan(0);
    });

    it('should return empty data when no authors match filters', async () => {
      const result = await hygieneService.getAuthorSummaryData({
        team: 'non-existent-team',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.summaries.length).toBe(0);
    });
  });

  describe('getWeeklyTrendData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return trend data with view existence check', async () => {
      const result = await hygieneService.getWeeklyTrendData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.trends.length).toBeGreaterThan(0);
    });

    it('should return empty data when no trends match filters', async () => {
      const result = await hygieneService.getWeeklyTrendData({
        repository: 'non-existent-repo',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.trends.length).toBe(0);
    });
  });

  describe('quality tier thresholds', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should categorize commits correctly by hygiene score', async () => {
      const result = await hygieneService.getCommitHygiene();

      for (const commit of result) {
        // Verify quality tier matches thresholds
        if (commit.qualityTier === 'excellent') {
          expect(commit.hygieneScore).toBeGreaterThanOrEqual(80);
        } else if (commit.qualityTier === 'good') {
          expect(commit.hygieneScore).toBeGreaterThanOrEqual(60);
          expect(commit.hygieneScore).toBeLessThan(80);
        } else if (commit.qualityTier === 'fair') {
          expect(commit.hygieneScore).toBeGreaterThanOrEqual(40);
          expect(commit.hygieneScore).toBeLessThan(60);
        } else {
          expect(commit.hygieneScore).toBeLessThan(40);
        }
      }
    });
  });

  describe('performance', () => {
    it('should handle large commit sets efficiently', async () => {
      // Insert 200 commits
      for (let commitIdx = 0; commitIdx < 200; commitIdx++) {
        const sha = `perf_sha${String(commitIdx).padStart(4, '0')}`;
        const isConventional = commitIdx % 3 !== 0; // 2/3 are conventional
        const message = isConventional
          ? `feat: Performance commit ${commitIdx}`
          : `wip commit ${commitIdx}`;

        await service.query(`
          INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
          VALUES ($1, $2, 'main', 'perf-repo', 'https://github.com/org/perf-repo.git', 'perfuser', NOW() - INTERVAL '${commitIdx} hours', $3, 3, 30, 10, FALSE, FALSE, 'TestOrg')
        `, [sha, `https://github.com/org/repo/commit/${sha}`, message]);

        await service.query(`
          INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
          VALUES ($1, 'src/perf/file.ts', 20, 5, 15, 100, 10, FALSE)
        `, [sha]);
      }

      // Insert contributor
      await service.query(`
        INSERT INTO commit_contributors (login, full_name, email, team)
        VALUES ('perfuser', 'Perf User', 'perf@test.com', 'Engineering')
        ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name
      `);

      const start = Date.now();
      const result = await hygieneService.getCommitHygiene();
      const elapsed = Date.now() - start;

      // Should return data
      expect(result.length).toBeGreaterThan(0);
      // Query should complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);
    }, 60_000);
  });
});
