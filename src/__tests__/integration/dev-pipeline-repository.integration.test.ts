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
import { DevPipelineDataService } from '../../services/dev-pipeline-data-service.js';

/**
 * Integration tests for DevPipelineDataService with a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema from migration files,
 * then exercises the data service methods against the real database.
 *
 * Ticket: IQS-896
 *
 * Test coverage includes:
 * - Query execution against Testcontainers PostgreSQL 16
 * - Aggregation correctness (SUM of file-level deltas)
 * - Merge commit exclusion
 * - Performance with 500+ commits
 */

const PG_DATABASE = 'gitrx_dev_pipeline_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let devPipelineService: DevPipelineDataService;

/**
 * Helper: Create schema from migration files.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply migrations in order
  const migrations = [
    '001_create_tables.sql',
    '002_create_views.sql',
    '004_add_linear_support.sql',
    '010_dev_pipeline_baseline.sql',
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert test commit data.
 */
async function insertTestData(dbService: DatabaseService): Promise<void> {
  // Insert commit_contributors for full name and team association
  await dbService.query(`
    INSERT INTO commit_contributors (login, full_name, email, team)
    VALUES
      ('user1', 'User One', 'user1@test.com', 'Engineering'),
      ('user2', 'User Two', 'user2@test.com', 'QA')
    ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name
  `);

  // Insert commit_history (non-merge commits)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      ('sha001', 'https://github.com/org/repo/commit/sha001', 'feature-1', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', '2024-06-01 10:00:00', 'feat: Add feature 1', 3, 100, 10, FALSE, FALSE, 'TestOrg'),
      ('sha002', 'https://github.com/org/repo/commit/sha002', 'feature-2', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', '2024-06-05 14:00:00', 'feat: Add feature 2', 5, 200, 50, FALSE, FALSE, 'TestOrg'),
      ('sha003', 'https://github.com/org/repo/commit/sha003', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user2', '2024-06-10 09:00:00', 'fix: Bug fix', 2, 50, 20, FALSE, FALSE, 'TestOrg'),
      ('sha004', 'https://github.com/org/repo/commit/sha004', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', '2024-06-15 11:00:00', 'Merge branch feature-1', 0, 0, 0, TRUE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commit_files with metrics (using correct column names from schema)
  await dbService.query(`
    INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file, complexity_change, code_change, comments_change)
    VALUES
      ('sha001', 'src/feature1.ts', 80, 0, 10, 80, 5, FALSE, 10, 80, 5),
      ('sha001', 'src/__tests__/feature1.test.ts', 20, 0, 2, 20, 2, TRUE, 2, 20, 2),
      ('sha001', 'src/utils.ts', 10, 5, 3, 50, 3, FALSE, 1, 5, 0),
      ('sha002', 'src/feature2.ts', 150, 0, 20, 150, 10, FALSE, 20, 150, 10),
      ('sha002', 'src/config.ts', 30, 10, 5, 100, 8, FALSE, 2, 20, 3),
      ('sha002', 'src/__tests__/feature2.test.ts', 40, 0, 3, 40, 5, TRUE, 3, 40, 5),
      ('sha003', 'src/bugfix.ts', 30, 15, 5, 80, 4, FALSE, -2, 15, 1),
      ('sha003', 'src/__tests__/bugfix.test.ts', 15, 0, 1, 15, 1, TRUE, 1, 15, 1)
    ON CONFLICT (sha, filename) DO NOTHING
  `);

  // Insert commit_linear for ticket associations
  await dbService.query(`
    INSERT INTO commit_linear (sha, linear_key, linear_project, author)
    VALUES
      ('sha001', 'IQS-100', 'gitrx', 'user1'),
      ('sha002', 'IQS-100', 'gitrx', 'user1'),
      ('sha003', 'IQS-101', 'gitrx', 'user2')
    ON CONFLICT (sha, linear_key) DO NOTHING
  `);
}

describe('DevPipelineDataService Integration Tests', () => {
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
    devPipelineService = new DevPipelineDataService(service);
  }, 120_000); // 2 minute timeout for container startup

  afterAll(async () => {
    if (service?.isInitialized()) {
      await service.shutdown();
    }
    if (container) {
      await container.stop();
    }
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  }, 30_000);

  beforeEach(async () => {
    // Clear test data before each test
    await service.query('DELETE FROM commit_linear');
    await service.query('DELETE FROM commit_jira');
    await service.query('DELETE FROM commit_baseline');
    await service.query('DELETE FROM commit_files');
    await service.query('DELETE FROM commit_history');
    await service.query('DELETE FROM commit_contributors');
  });

  describe('checkViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await devPipelineService.checkViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('getDevPipelineMetrics', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return commits with aggregated deltas', async () => {
      const result = await devPipelineService.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // Should have 3 non-merge commits
      expect(result.length).toBe(3);

      // Find sha001 and verify aggregated deltas
      const commit1 = result.find(r => r.sha === 'sha001');
      expect(commit1).toBeDefined();
      // complexity_delta is calculated as SUM(cf.complexity - baseline_complexity)
      // Since no baseline exists, it equals SUM(cf.complexity) = 10 + 2 + 3 = 15
      expect(commit1?.complexityDelta).toBe(15);
      // loc_delta = SUM(total_code_lines - baseline_code_lines) = 80 + 20 + 50 = 150
      expect(commit1?.locDelta).toBe(150);
      // tests_delta = SUM of total_code_lines for test files = 20
      expect(commit1?.testsDelta).toBe(20);
      // file_count: 3
      expect(commit1?.fileCount).toBe(3);
      // test_file_count: 1
      expect(commit1?.testFileCount).toBe(1);
    });

    it('should exclude merge commits', async () => {
      const result = await devPipelineService.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // sha004 is a merge commit and should be excluded
      const mergeCommit = result.find(r => r.sha === 'sha004');
      expect(mergeCommit).toBeUndefined();
    });

    it('should associate contributor details', async () => {
      const result = await devPipelineService.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      const commit1 = result.find(r => r.sha === 'sha001');
      expect(commit1?.author).toBe('user1');
      expect(commit1?.fullName).toBe('User One');
      expect(commit1?.team).toBe('Engineering');
    });

    it('should associate ticket information', async () => {
      const result = await devPipelineService.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      const commit1 = result.find(r => r.sha === 'sha001');
      expect(commit1?.ticketId).toBe('IQS-100');
      expect(commit1?.ticketProject).toBe('gitrx');
      expect(commit1?.ticketType).toBe('Linear');
    });

    it('should filter by team', async () => {
      const result = await devPipelineService.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        team: 'QA',
      });

      // Only user2 is on QA team, should have 1 commit
      expect(result.length).toBe(1);
      expect(result[0]?.author).toBe('user2');
      expect(result[0]?.team).toBe('QA');
    });

    it('should filter by repository', async () => {
      const result = await devPipelineService.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        repository: 'test-repo',
      });

      // All test commits are in test-repo
      expect(result.length).toBe(3);
    });

    it('should filter by ticketId', async () => {
      const result = await devPipelineService.getDevPipelineMetrics({
        ticketId: 'IQS-100',
      });

      // IQS-100 is associated with sha001 and sha002
      expect(result.length).toBe(2);
      expect(result.map(r => r.sha).sort()).toEqual(['sha001', 'sha002']);
    });

    it('should order by commit date descending', async () => {
      const result = await devPipelineService.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      const dates = result.map(r => r.commitDate);
      // Should be ordered newest first
      expect(dates[0]).toBe('2024-06-10');
      expect(dates[1]).toBe('2024-06-05');
      expect(dates[2]).toBe('2024-06-01');
    });

    it('should apply default 3-week date range when no filters provided', async () => {
      // Insert a commit from 4 weeks ago (should be excluded with default filter)
      await service.query(`
        INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
        VALUES ('sha_old', 'https://github.com/org/repo/commit/sha_old', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '30 days', 'old commit', 1, 10, 0, FALSE, FALSE, 'TestOrg')
      `);
      await service.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file, complexity_change, code_change, comments_change)
        VALUES ('sha_old', 'src/old.ts', 10, 0, 1, 10, 1, FALSE, 1, 10, 1)
      `);

      // Insert a commit from 2 weeks ago (should be included with default filter)
      await service.query(`
        INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
        VALUES ('sha_recent', 'https://github.com/org/repo/commit/sha_recent', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '14 days', 'recent commit', 1, 10, 0, FALSE, FALSE, 'TestOrg')
      `);
      await service.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file, complexity_change, code_change, comments_change)
        VALUES ('sha_recent', 'src/recent.ts', 10, 0, 1, 10, 1, FALSE, 1, 10, 1)
      `);

      const result = await devPipelineService.getDevPipelineMetrics();

      // Should include sha_recent but not sha_old
      const shas = result.map(r => r.sha);
      expect(shas).toContain('sha_recent');
      expect(shas).not.toContain('sha_old');
    });
  });

  describe('getDevPipelineMetricsByTicket', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should aggregate commits by ticket', async () => {
      const result = await devPipelineService.getDevPipelineMetricsByTicket({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // Should have 2 tickets: IQS-100 and IQS-101
      expect(result.length).toBe(2);

      // Find IQS-100 (has 2 commits)
      const ticket100 = result.find(r => r.ticketId === 'IQS-100');
      expect(ticket100).toBeDefined();
      expect(ticket100?.commitCount).toBe(2);
      // Total complexity delta = sha001(15) + sha002(28) = 43 (since no baseline)
      expect(ticket100?.totalComplexityDelta).toBe(43);
      // Total LOC delta = sha001(150) + sha002(290) = 440 (since no baseline)
      expect(ticket100?.totalLocDelta).toBe(440);

      // Find IQS-101 (has 1 commit)
      const ticket101 = result.find(r => r.ticketId === 'IQS-101');
      expect(ticket101).toBeDefined();
      expect(ticket101?.commitCount).toBe(1);
    });
  });

  describe('getDevPipelineMetricsByAuthor', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should aggregate commits by author', async () => {
      const result = await devPipelineService.getDevPipelineMetricsByAuthor({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // Should have 2 authors: user1 and user2
      expect(result.length).toBe(2);

      // Find user1 (has 2 commits)
      const author1 = result.find(r => r.author === 'user1');
      expect(author1).toBeDefined();
      expect(author1?.fullName).toBe('User One');
      expect(author1?.team).toBe('Engineering');
      expect(author1?.commitCount).toBe(2);
      expect(author1?.ticketCount).toBe(1); // Both commits are for IQS-100

      // Find user2 (has 1 commit)
      const author2 = result.find(r => r.author === 'user2');
      expect(author2).toBeDefined();
      expect(author2?.fullName).toBe('User Two');
      expect(author2?.team).toBe('QA');
      expect(author2?.commitCount).toBe(1);
    });
  });

  describe('getChartData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return chart data with view existence check', async () => {
      const result = await devPipelineService.getChartData({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.rows.length).toBe(3);
    });

    it('should return empty data when no commits match filters', async () => {
      const result = await devPipelineService.getChartData({
        startDate: '2023-01-01',
        endDate: '2023-01-31',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.rows.length).toBe(0);
    });
  });

  describe('performance', () => {
    it('should handle 500+ commits efficiently', async () => {
      // Insert 500 commits
      for (let i = 0; i < 500; i++) {
        const sha = `sha${String(i).padStart(6, '0')}`;
        const date = new Date('2024-06-01');
        date.setHours(date.getHours() + i);
        const dateStr = date.toISOString().replace('T', ' ').substring(0, 19);

        await service.query(`
          INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
          VALUES ($1, $2, 'main', 'perf-repo', 'https://github.com/org/perf-repo.git', 'perfuser', $3, 'perf commit', 1, 10, 0, FALSE, FALSE, 'TestOrg')
        `, [sha, `https://github.com/org/repo/commit/${sha}`, dateStr]);

        await service.query(`
          INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file, complexity_change, code_change, comments_change)
          VALUES ($1, 'src/file.ts', 10, 0, 5, 100, 10, FALSE, 1, 10, 1)
        `, [sha]);
      }

      const start = Date.now();
      const result = await devPipelineService.getDevPipelineMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });
      const elapsed = Date.now() - start;

      // Should return data within reasonable time
      expect(result.length).toBeGreaterThanOrEqual(500);
      // Query should complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);
    }, 30_000); // 30 second timeout for bulk insert
  });
});
