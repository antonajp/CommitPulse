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
import { ReleaseRiskService } from '../../services/release-risk-service.js';

/**
 * Integration tests for ReleaseRiskService with a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema from migration files,
 * then exercises the data service methods against the real database.
 *
 * Ticket: IQS-911
 *
 * Test coverage includes:
 * - View correctness with sample data
 * - Risk factor calculations
 * - Risk category thresholds
 * - Release risk aggregation
 * - Filter combinations
 */

const PG_DATABASE = 'gitrx_release_risk_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let releaseRiskService: ReleaseRiskService;

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
    '013_hot_spots.sql',
    '018_release_risk.sql',
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert test data for release risk analysis.
 */
async function insertTestData(dbService: DatabaseService): Promise<void> {
  // Insert commit_contributors with varying experience
  await dbService.query(`
    INSERT INTO commit_contributors (login, full_name, email, team)
    VALUES
      ('experienced_dev', 'Experienced Developer', 'exp@test.com', 'Engineering'),
      ('junior_dev', 'Junior Developer', 'junior@test.com', 'Engineering'),
      ('new_dev', 'New Developer', 'new@test.com', 'Platform')
    ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name
  `);

  // Insert commit_history with varying dates for experience calculation
  // Experienced dev: many commits over 90 days
  for (let i = 0; i < 30; i++) {
    const sha = `exp_sha_${String(i).padStart(3, '0')}`;
    const daysAgo = Math.floor(i * 3); // Every 3 days
    await dbService.query(`
      INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
      VALUES ($1, $2, 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'experienced_dev', NOW() - INTERVAL '${daysAgo} days', 'Regular commit', 2, 50, 10, FALSE, FALSE, 'TestOrg')
      ON CONFLICT (sha) DO NOTHING
    `, [sha, `https://github.com/org/repo/commit/${sha}`]);
  }

  // Junior dev: fewer commits
  for (let i = 0; i < 10; i++) {
    const sha = `jr_sha_${String(i).padStart(3, '0')}`;
    const daysAgo = Math.floor(i * 5);
    await dbService.query(`
      INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
      VALUES ($1, $2, 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'junior_dev', NOW() - INTERVAL '${daysAgo} days', 'Junior commit', 2, 30, 5, FALSE, FALSE, 'TestOrg')
      ON CONFLICT (sha) DO NOTHING
    `, [sha, `https://github.com/org/repo/commit/${sha}`]);
  }

  // New dev: very few commits (high experience risk)
  const newDevSha = 'new_sha_001';
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES ($1, $2, 'feature', 'test-repo', 'https://github.com/org/test-repo.git', 'new_dev', NOW() - INTERVAL '5 days', 'New developer first commit', 10, 500, 0, FALSE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `, [newDevSha, `https://github.com/org/repo/commit/${newDevSha}`]);

  // Insert commit_files with varying complexity
  // Experienced dev commits: low complexity changes
  for (let i = 0; i < 30; i++) {
    const sha = `exp_sha_${String(i).padStart(3, '0')}`;
    await dbService.query(`
      INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
      VALUES
        ($1, 'src/module/file.ts', 25, 5, 10, 100, 10, FALSE),
        ($1, 'src/__tests__/file.test.ts', 25, 5, 5, 50, 5, TRUE)
      ON CONFLICT (sha, filename) DO NOTHING
    `, [sha]);
  }

  // Junior dev commits: medium complexity, some test coverage
  for (let i = 0; i < 10; i++) {
    const sha = `jr_sha_${String(i).padStart(3, '0')}`;
    await dbService.query(`
      INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
      VALUES
        ($1, 'src/services/service.ts', 20, 3, 25, 150, 15, FALSE),
        ($1, 'src/__tests__/service.test.ts', 10, 2, 5, 30, 3, TRUE)
      ON CONFLICT (sha, filename) DO NOTHING
    `, [sha]);
  }

  // New dev commit: high complexity, no tests (high risk)
  await dbService.query(`
    INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
    VALUES
      ('new_sha_001', 'src/complex/feature.ts', 200, 0, 80, 200, 5, FALSE),
      ('new_sha_001', 'src/complex/utils.ts', 100, 0, 50, 100, 2, FALSE),
      ('new_sha_001', 'src/complex/types.ts', 50, 0, 10, 50, 5, FALSE)
    ON CONFLICT (sha, filename) DO NOTHING
  `);

  // Insert commit_baseline for delta calculations
  // Some commits have baselines (for proper delta calculation)
  for (let i = 0; i < 10; i++) {
    const sha = `exp_sha_${String(i).padStart(3, '0')}`;
    await dbService.query(`
      INSERT INTO commit_baseline (sha, filename, baseline_sha, baseline_complexity, baseline_code_lines, baseline_comment_lines, baseline_is_test_file)
      VALUES
        ($1, 'src/module/file.ts', 'baseline_sha', 8, 90, 8, FALSE),
        ($1, 'src/__tests__/file.test.ts', 'baseline_sha', 4, 40, 4, TRUE)
      ON CONFLICT (sha, filename) DO NOTHING
    `, [sha]);
  }

  // Add a high-risk hotspot file that new_dev touched
  // First ensure there's a file with high churn and complexity for hot spots
  for (let i = 0; i < 15; i++) {
    const sha = `hotspot_sha_${String(i).padStart(3, '0')}`;
    await dbService.query(`
      INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
      VALUES ($1, $2, 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'experienced_dev', NOW() - INTERVAL '${i * 5} days', 'Hotspot update', 1, 20, 10, FALSE, FALSE, 'TestOrg')
      ON CONFLICT (sha) DO NOTHING
    `, [sha, `https://github.com/org/repo/commit/${sha}`]);

    await dbService.query(`
      INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
      VALUES ($1, 'src/complex/feature.ts', 20, 10, 75, 400, 20, FALSE)
      ON CONFLICT (sha, filename) DO NOTHING
    `, [sha]);
  }
}

describe('ReleaseRiskService Integration Tests', () => {
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
    releaseRiskService = new ReleaseRiskService(service);
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
    await service.query('DELETE FROM commit_baseline');
    await service.query('DELETE FROM commit_jira');
    await service.query('DELETE FROM commit_linear');
    await service.query('DELETE FROM commit_files');
    await service.query('DELETE FROM commit_history');
    await service.query('DELETE FROM commit_contributors');
    await service.query('DELETE FROM jira_detail');
    await service.query('DELETE FROM linear_detail');
  });

  describe('checkCommitRiskViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await releaseRiskService.checkCommitRiskViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('checkReleaseRiskViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await releaseRiskService.checkReleaseRiskViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('getCommitRisks', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return commits ordered by date descending', async () => {
      const result = await releaseRiskService.getCommitRisks();

      // Should have commits
      expect(result.length).toBeGreaterThan(0);

      // Verify date ordering
      for (let i = 1; i < result.length; i++) {
        const prevDate = result[i - 1]?.commitDate ?? '';
        const currDate = result[i]?.commitDate ?? '';
        expect(prevDate >= currDate).toBe(true);
      }
    });

    it('should calculate experience risk correctly', async () => {
      const result = await releaseRiskService.getCommitRisks();

      // Find new dev commit - should have higher experience risk
      const newDevCommit = result.find((r) => r.author === 'new_dev');
      expect(newDevCommit).toBeDefined();
      // New dev has very few commits, so experience risk should be relatively high
      // (experience_risk = 1 - experience_score, where experience_score is low for new devs)

      // Find experienced dev commit - should have lower experience risk
      const expDevCommit = result.find((r) => r.author === 'experienced_dev');
      expect(expDevCommit).toBeDefined();

      // Experienced dev should have lower experience risk than new dev
      if (newDevCommit && expDevCommit) {
        expect(expDevCommit.experienceRisk).toBeLessThan(newDevCommit.experienceRisk);
      }
    });

    it('should calculate test coverage risk correctly', async () => {
      const result = await releaseRiskService.getCommitRisks();

      // New dev commit has no test files -> high test coverage risk
      const newDevCommit = result.find((r) => r.author === 'new_dev');
      expect(newDevCommit).toBeDefined();
      if (newDevCommit) {
        // New dev has 3 non-test files and 0 test files
        expect(newDevCommit.testFileCount).toBe(0);
        // Test coverage risk should be high (close to 1.0) since no tests
        expect(newDevCommit.testCoverageRisk).toBeGreaterThan(0.5);
      }

      // For experienced devs, we verify the test coverage risk is calculated
      // The view joins with vw_dev_pipeline_deltas which requires baselines
      // Find a commit with baseline data (first 10 exp commits have baselines)
      const expDevCommits = result.filter((r) => r.author === 'experienced_dev');
      expect(expDevCommits.length).toBeGreaterThan(0);
      // All experienced dev commits should have a calculated test coverage risk
      for (const commit of expDevCommits) {
        // Test coverage risk should be between 0 and 1
        expect(commit.testCoverageRisk).toBeGreaterThanOrEqual(0);
        expect(commit.testCoverageRisk).toBeLessThanOrEqual(1.0);
      }
    });

    it('should filter by repository', async () => {
      const result = await releaseRiskService.getCommitRisks({ repository: 'test-repo' });

      for (const commit of result) {
        expect(commit.repository).toBe('test-repo');
      }
    });

    it('should filter by branch', async () => {
      const result = await releaseRiskService.getCommitRisks({ branch: 'feature' });

      // Only new_dev commit is on feature branch
      expect(result.length).toBe(1);
      expect(result[0]?.branch).toBe('feature');
      expect(result[0]?.author).toBe('new_dev');
    });

    it('should return empty for non-existent repository', async () => {
      const result = await releaseRiskService.getCommitRisks({ repository: 'non-existent' });
      expect(result.length).toBe(0);
    });
  });

  describe('getReleaseRisks', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should aggregate commit risks by repository and branch', async () => {
      const result = await releaseRiskService.getReleaseRisks();

      // Should have release summaries
      expect(result.length).toBeGreaterThan(0);

      // Each summary should have valid data
      for (const summary of result) {
        expect(summary.repository).toBeDefined();
        expect(summary.branch).toBeDefined();
        expect(summary.commitCount).toBeGreaterThan(0);
        expect(summary.releaseRiskScore).toBeGreaterThanOrEqual(0);
        expect(summary.releaseRiskScore).toBeLessThanOrEqual(1);
        expect(['critical', 'high', 'medium', 'low']).toContain(summary.riskCategory);
      }
    });

    it('should include risk breakdown in summaries', async () => {
      const result = await releaseRiskService.getReleaseRisks();

      for (const summary of result) {
        expect(summary.riskBreakdown).toBeDefined();
        expect(typeof summary.riskBreakdown.avgComplexityRisk).toBe('number');
        expect(typeof summary.riskBreakdown.avgTestCoverageRisk).toBe('number');
        expect(typeof summary.riskBreakdown.avgExperienceRisk).toBe('number');
        expect(typeof summary.riskBreakdown.avgHotspotRisk).toBe('number');
      }
    });

    it('should include risk distribution in summaries', async () => {
      const result = await releaseRiskService.getReleaseRisks();

      for (const summary of result) {
        expect(summary.riskDistribution).toBeDefined();
        expect(typeof summary.riskDistribution.criticalCount).toBe('number');
        expect(typeof summary.riskDistribution.highCount).toBe('number');
        expect(typeof summary.riskDistribution.mediumCount).toBe('number');
        expect(typeof summary.riskDistribution.lowCount).toBe('number');

        // Distribution should sum to commit count
        const totalDistribution =
          summary.riskDistribution.criticalCount +
          summary.riskDistribution.highCount +
          summary.riskDistribution.mediumCount +
          summary.riskDistribution.lowCount;
        expect(totalDistribution).toBe(summary.commitCount);
      }
    });

    it('should filter by repository', async () => {
      const result = await releaseRiskService.getReleaseRisks({ repository: 'test-repo' });

      for (const summary of result) {
        expect(summary.repository).toBe('test-repo');
      }
    });

    it('should filter by branch', async () => {
      const result = await releaseRiskService.getReleaseRisks({ branch: 'main' });

      for (const summary of result) {
        expect(summary.branch).toBe('main');
      }
    });
  });

  describe('getCommitRiskChartData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return chart data with view existence check', async () => {
      const result = await releaseRiskService.getCommitRiskChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.commits.length).toBeGreaterThan(0);
    });

    it('should return empty data when no commits match filters', async () => {
      const result = await releaseRiskService.getCommitRiskChartData({
        repository: 'non-existent-repo',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.commits.length).toBe(0);
    });
  });

  describe('getReleaseRiskSummaryData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return summary data with view existence check', async () => {
      const result = await releaseRiskService.getReleaseRiskSummaryData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.summaries.length).toBeGreaterThan(0);
    });

    it('should return empty data when no releases match filters', async () => {
      const result = await releaseRiskService.getReleaseRiskSummaryData({
        repository: 'non-existent-repo',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.summaries.length).toBe(0);
    });
  });

  describe('risk category thresholds', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should categorize commits correctly by total risk', async () => {
      const result = await releaseRiskService.getCommitRisks();

      for (const commit of result) {
        // Verify risk category matches thresholds
        if (commit.riskCategory === 'critical') {
          expect(commit.totalRisk).toBeGreaterThanOrEqual(0.75);
        } else if (commit.riskCategory === 'high') {
          expect(commit.totalRisk).toBeGreaterThanOrEqual(0.5);
          expect(commit.totalRisk).toBeLessThan(0.75);
        } else if (commit.riskCategory === 'medium') {
          expect(commit.totalRisk).toBeGreaterThanOrEqual(0.25);
          expect(commit.totalRisk).toBeLessThan(0.5);
        } else {
          expect(commit.totalRisk).toBeLessThan(0.25);
        }
      }
    });
  });

  describe('performance', () => {
    it('should handle large commit sets efficiently', async () => {
      // Insert 200 commits
      for (let commitIdx = 0; commitIdx < 200; commitIdx++) {
        const sha = `perf_sha${String(commitIdx).padStart(4, '0')}`;
        const daysAgo = commitIdx % 90;

        await service.query(`
          INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
          VALUES ($1, $2, 'main', 'perf-repo', 'https://github.com/org/perf-repo.git', 'perfuser', NOW() - INTERVAL '${daysAgo} days', 'perf commit', 3, 30, 10, FALSE, FALSE, 'TestOrg')
        `, [sha, `https://github.com/org/repo/commit/${sha}`]);

        await service.query(`
          INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
          VALUES
            ($1, 'src/perf/file.ts', 20, 5, 15, 100, 10, FALSE),
            ($1, 'src/__tests__/perf.test.ts', 10, 5, 5, 30, 5, TRUE)
        `, [sha]);

        await service.query(`
          INSERT INTO commit_baseline (sha, filename, baseline_sha, baseline_complexity, baseline_code_lines, baseline_comment_lines, baseline_is_test_file)
          VALUES
            ($1, 'src/perf/file.ts', 'baseline', 10, 80, 8, FALSE),
            ($1, 'src/__tests__/perf.test.ts', 'baseline', 3, 20, 3, TRUE)
        `, [sha]);
      }

      // Insert contributor
      await service.query(`
        INSERT INTO commit_contributors (login, full_name, email, team)
        VALUES ('perfuser', 'Perf User', 'perf@test.com', 'Engineering')
        ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name
      `);

      const start = Date.now();
      const result = await releaseRiskService.getCommitRisks();
      const elapsed = Date.now() - start;

      // Should return data
      expect(result.length).toBeGreaterThan(0);
      // Query should complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);
    }, 60_000);
  });
});
