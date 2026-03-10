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
import { CodeReviewVelocityDataService } from '../../services/code-review-velocity-service.js';

/**
 * Integration tests for CodeReviewVelocityDataService with a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema from migration files,
 * then exercises the data service methods against the real database.
 *
 * Ticket: IQS-899
 *
 * Test coverage includes:
 * - Query execution against Testcontainers PostgreSQL 16
 * - View calculation correctness (hours_to_first_review, size_category)
 * - Filter combinations
 * - Aggregation queries
 */

const PG_DATABASE = 'gitrx_code_review_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let codeReviewService: CodeReviewVelocityDataService;

/**
 * Helper: Create schema from migration files.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply migrations in order
  const migrations = [
    '001_create_tables.sql',
    '012_code_review_velocity.sql',
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert test PR data.
 */
async function insertTestData(dbService: DatabaseService): Promise<void> {
  // Insert pull requests
  await dbService.query(`
    INSERT INTO pull_request (
      repository, pr_number, github_id, title, author, state,
      created_at, updated_at, first_review_at, merged_at, closed_at,
      merge_sha, head_branch, base_branch,
      additions, deletions, changed_files, review_cycles,
      linked_ticket_id, linked_ticket_type
    ) VALUES
      ('owner/repo1', 1, 1001, 'feat: Add feature 1', 'user1', 'merged',
       '2024-06-01 10:00:00+00', '2024-06-05 14:00:00+00', '2024-06-02 09:00:00+00', '2024-06-05 14:00:00+00', NULL,
       'abc123', 'feature/IQS-100-feature', 'main',
       100, 20, 5, 1,
       'IQS-100', 'linear'),
      ('owner/repo1', 2, 1002, 'feat: Add feature 2', 'user1', 'merged',
       '2024-06-05 10:00:00+00', '2024-06-10 14:00:00+00', '2024-06-06 10:00:00+00', '2024-06-10 14:00:00+00', NULL,
       'def456', 'feature/IQS-101-feature', 'main',
       250, 50, 8, 2,
       'IQS-101', 'linear'),
      ('owner/repo1', 3, 1003, 'fix: Bug fix', 'user2', 'merged',
       '2024-06-08 10:00:00+00', '2024-06-09 14:00:00+00', '2024-06-08 12:00:00+00', '2024-06-09 14:00:00+00', NULL,
       'ghi789', 'bugfix/fix-issue', 'main',
       30, 10, 2, 0,
       NULL, NULL),
      ('owner/repo2', 1, 2001, 'feat: Large PR', 'user3', 'merged',
       '2024-06-10 10:00:00+00', '2024-06-20 14:00:00+00', '2024-06-15 10:00:00+00', '2024-06-20 14:00:00+00', NULL,
       'jkl012', 'feature/large-change', 'main',
       800, 200, 25, 3,
       'PROJ-500', 'jira'),
      ('owner/repo1', 4, 1004, 'WIP: Draft PR', 'user1', 'open',
       '2024-06-15 10:00:00+00', '2024-06-15 10:00:00+00', NULL, NULL, NULL,
       NULL, 'draft-branch', 'main',
       10, 0, 1, 0,
       NULL, NULL)
    ON CONFLICT (repository, pr_number) DO NOTHING
  `);

  // Insert reviews
  await dbService.query(`
    INSERT INTO pull_request_review (pull_request_id, github_id, reviewer, state, submitted_at, body)
    SELECT
      pr.id,
      rev.github_id,
      rev.reviewer,
      rev.state,
      rev.submitted_at,
      rev.body
    FROM (
      VALUES
        (1001, 5001, 'reviewer1', 'approved', '2024-06-02 09:00:00+00'::TIMESTAMPTZ, 'LGTM'),
        (1002, 5002, 'reviewer1', 'changes_requested', '2024-06-06 10:00:00+00'::TIMESTAMPTZ, 'Please fix'),
        (1002, 5003, 'reviewer1', 'approved', '2024-06-08 10:00:00+00'::TIMESTAMPTZ, 'LGTM'),
        (1003, 5004, 'reviewer2', 'approved', '2024-06-08 12:00:00+00'::TIMESTAMPTZ, 'LGTM'),
        (2001, 5005, 'reviewer1', 'changes_requested', '2024-06-15 10:00:00+00'::TIMESTAMPTZ, 'Too many changes'),
        (2001, 5006, 'reviewer2', 'changes_requested', '2024-06-16 10:00:00+00'::TIMESTAMPTZ, 'Needs tests'),
        (2001, 5007, 'reviewer1', 'approved', '2024-06-18 10:00:00+00'::TIMESTAMPTZ, 'LGTM')
    ) AS rev(pr_github_id, github_id, reviewer, state, submitted_at, body)
    INNER JOIN pull_request pr ON pr.github_id = rev.pr_github_id
    ON CONFLICT (github_id) DO NOTHING
  `);
}

describe('CodeReviewVelocityDataService Integration Tests', () => {
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
    codeReviewService = new CodeReviewVelocityDataService(service);
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
    await service.query('DELETE FROM pull_request_review');
    await service.query('DELETE FROM pull_request');
  });

  describe('checkViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await codeReviewService.checkViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('getMetrics', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return PRs with calculated metrics', async () => {
      const result = await codeReviewService.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // Should have 5 PRs
      expect(result.length).toBe(5);

      // Find PR #1 and verify metrics
      const pr1 = result.find(r => r.prNumber === 1 && r.repository === 'owner/repo1');
      expect(pr1).toBeDefined();
      expect(pr1?.author).toBe('user1');
      expect(pr1?.state).toBe('merged');
      expect(pr1?.locChanged).toBe(120); // 100 + 20
      expect(pr1?.sizeCategory).toBe('S'); // 120 < 200
      expect(pr1?.linkedTicketId).toBe('IQS-100');
      expect(pr1?.linkedTicketType).toBe('linear');

      // Verify hours_to_first_review calculation
      // created_at: 2024-06-01 10:00, first_review_at: 2024-06-02 09:00
      // Difference: 23 hours
      expect(pr1?.hoursToFirstReview).toBeCloseTo(23.0, 0);
    });

    it('should calculate size categories correctly', async () => {
      const result = await codeReviewService.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // PR #3: 30+10=40 -> XS
      const pr3 = result.find(r => r.prNumber === 3 && r.repository === 'owner/repo1');
      expect(pr3?.sizeCategory).toBe('XS');

      // PR #2: 250+50=300 -> M
      const pr2 = result.find(r => r.prNumber === 2 && r.repository === 'owner/repo1');
      expect(pr2?.sizeCategory).toBe('M');

      // repo2 PR #1: 800+200=1000 -> XL
      const largePR = result.find(r => r.prNumber === 1 && r.repository === 'owner/repo2');
      expect(largePR?.sizeCategory).toBe('XL');
    });

    it('should filter by repository', async () => {
      const result = await codeReviewService.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        repository: 'owner/repo1',
      });

      // Should have 4 PRs (all from repo1)
      expect(result.length).toBe(4);
      expect(result.every(r => r.repository === 'owner/repo1')).toBe(true);
    });

    it('should filter by author', async () => {
      const result = await codeReviewService.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        author: 'user1',
      });

      // user1 has 3 PRs
      expect(result.length).toBe(3);
      expect(result.every(r => r.author === 'user1')).toBe(true);
    });

    it('should filter by size category', async () => {
      const result = await codeReviewService.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        sizeCategory: 'XS',
      });

      // Only PR #3 and PR #4 are XS
      expect(result.length).toBe(2);
      expect(result.every(r => r.sizeCategory === 'XS')).toBe(true);
    });

    it('should order by created_at descending', async () => {
      const result = await codeReviewService.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      const dates = result.map(r => new Date(r.createdAt).getTime());
      // Should be in descending order
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i] ?? 0);
      }
    });

    it('should handle null first_review_at for open PRs', async () => {
      const result = await codeReviewService.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // PR #4 is open, should have null metrics
      const openPR = result.find(r => r.prNumber === 4 && r.repository === 'owner/repo1');
      expect(openPR?.state).toBe('open');
      expect(openPR?.firstReviewAt).toBeNull();
      expect(openPR?.hoursToFirstReview).toBeNull();
      expect(openPR?.mergedAt).toBeNull();
      expect(openPR?.hoursToMerge).toBeNull();
    });
  });

  describe('getMergedPRMetrics', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return only merged PRs', async () => {
      const result = await codeReviewService.getMergedPRMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // 4 merged PRs (excluding open PR #4)
      expect(result.length).toBe(4);
      expect(result.every(r => r.state === 'merged')).toBe(true);
    });
  });

  describe('getAvgMetricsByRepository', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return average metrics by repository', async () => {
      const result = await codeReviewService.getAvgMetricsByRepository({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // 2 repositories with merged PRs
      expect(result.length).toBe(2);

      // Find repo1 averages
      const repo1 = result.find(r => r.repository === 'owner/repo1');
      expect(repo1).toBeDefined();
      expect(repo1?.prCount).toBe(3); // 3 merged PRs in repo1
    });
  });

  describe('getAvgMetricsByAuthor', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return average metrics by author', async () => {
      const result = await codeReviewService.getAvgMetricsByAuthor({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // 3 authors with merged PRs (user1, user2, user3)
      expect(result.length).toBe(3);

      // Find user1 averages
      const user1 = result.find(r => r.author === 'user1');
      expect(user1).toBeDefined();
      expect(user1?.prCount).toBe(2); // 2 merged PRs by user1
    });
  });

  describe('getAvgMetricsBySize', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return average metrics by size category', async () => {
      const result = await codeReviewService.getAvgMetricsBySize({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // Should have categories: XS (1), S (1), M (1), XL (1)
      expect(result.length).toBe(4);

      // XL PRs should have higher avg hours
      const xl = result.find(r => r.sizeCategory === 'XL');
      const xs = result.find(r => r.sizeCategory === 'XS');
      expect(xl).toBeDefined();
      expect(xs).toBeDefined();

      // XL PR took longer to get first review (5 days vs 2 hours)
      expect(xl?.avgHoursToFirstReview).toBeGreaterThan(xs?.avgHoursToFirstReview ?? 0);
    });

    it('should order by size category from XS to XL', async () => {
      const result = await codeReviewService.getAvgMetricsBySize({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      const expectedOrder = ['XS', 'S', 'M', 'XL'];
      const actualOrder = result.map(r => r.sizeCategory);

      // Filter to only include categories present in test data
      const filteredExpected = expectedOrder.filter(c => actualOrder.includes(c));
      expect(actualOrder).toEqual(filteredExpected);
    });
  });

  describe('getPRStats', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return correct PR statistics', async () => {
      const stats = await codeReviewService.getPRStats();

      expect(stats).not.toBeNull();
      expect(stats?.totalPRs).toBe(5);
      expect(stats?.mergedPRs).toBe(4);
      expect(stats?.openPRs).toBe(1);
      expect(stats?.closedPRs).toBe(0); // No closed-but-not-merged PRs
      expect(stats?.prsWithReviews).toBe(4); // All merged PRs have reviews
    });
  });

  describe('getChartData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return chart data with view existence check', async () => {
      const result = await codeReviewService.getChartData({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.rows.length).toBe(5);
    });

    it('should return empty data when no PRs match filters', async () => {
      const result = await codeReviewService.getChartData({
        startDate: '2023-01-01',
        endDate: '2023-01-31',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.rows.length).toBe(0);
    });
  });

  describe('performance', () => {
    it('should handle 100+ PRs efficiently', async () => {
      // Insert 100 PRs
      for (let i = 0; i < 100; i++) {
        const date = new Date('2024-06-01');
        date.setHours(date.getHours() + i);
        const dateStr = date.toISOString();

        await service.query(`
          INSERT INTO pull_request (
            repository, pr_number, github_id, title, author, state,
            created_at, updated_at, merged_at,
            head_branch, base_branch,
            additions, deletions, changed_files, review_cycles
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `, [
          'perf-repo',
          i + 1,
          3000 + i,
          `PR ${i + 1}`,
          `user${i % 10}`,
          'merged',
          dateStr,
          dateStr,
          dateStr,
          `branch-${i}`,
          'main',
          Math.floor(Math.random() * 500),
          Math.floor(Math.random() * 100),
          Math.floor(Math.random() * 20),
          Math.floor(Math.random() * 3),
        ]);
      }

      const start = Date.now();
      const result = await codeReviewService.getMetrics({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });
      const elapsed = Date.now() - start;

      // Should return data within reasonable time
      expect(result.length).toBeGreaterThanOrEqual(100);
      // Query should complete in under 2 seconds
      expect(elapsed).toBeLessThan(2000);
    }, 30_000); // 30 second timeout for bulk insert
  });
});
