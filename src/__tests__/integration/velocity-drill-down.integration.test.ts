/**
 * Integration tests for LOC drill-down flow (GITX-152).
 *
 * Uses Testcontainers PostgreSQL to test the full flow from
 * VelocityDataService.getWeekCommitDetails to database query.
 *
 * Test coverage:
 * - Drill-down for week with commits returns correct data
 * - Drill-down for empty week returns empty commits array
 * - Drill-down with repository filter applies correctly
 * - Rapid drill-down requests are rate limited
 * - Week with >500 commits returns exactly 500 (LIMIT validation)
 * - Query completes within 2 seconds for 200 commits (performance)
 *
 * Ticket: GITX-152
 */

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
import { VelocityDataService } from '../../services/velocity-data-service.js';
import { MessageRateLimiter, DEFAULT_RATE_LIMIT_INTERVAL_MS } from '../../views/webview/message-rate-limiter.js';

/**
 * Test database configuration.
 */
const PG_DATABASE = 'gitrx_drill_down_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

/**
 * Fixed test dates for deterministic week boundaries.
 * PostgreSQL weeks start on Monday (ISO 8601).
 *
 * Week 1: 2024-01-08 (Monday) to 2024-01-14 (Sunday)
 * Week 2: 2024-01-15 (Monday) to 2024-01-21 (Sunday)
 * Empty week: 2024-02-05 (Monday) to 2024-02-11 (Sunday)
 */
const WEEK1_START = '2024-01-08';
const WEEK1_COMMIT_DATE_1 = '2024-01-09';
const WEEK1_COMMIT_DATE_2 = '2024-01-10';
const WEEK1_COMMIT_DATE_3 = '2024-01-11';
const WEEK2_START = '2024-01-15';
const WEEK2_COMMIT_DATE_1 = '2024-01-16';
const EMPTY_WEEK_START = '2024-02-05';

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let dataService: VelocityDataService;

/**
 * Helper: Create schema from migration files.
 * Includes all necessary migrations for commit_history and commit_branch_relationship.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply migrations in order (includes all dependencies)
  // Note: commit_branch_relationship is created in 001_create_tables.sql
  const migrations = [
    '001_create_tables.sql',
    '002_create_views.sql',
    '004_add_linear_support.sql',
    '005_add_calculated_story_points.sql',
    '008_sprint_velocity_loc_view.sql',
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert test commits for a specific week.
 *
 * @param dbService - Database service
 * @param commits - Array of commit data
 */
async function insertTestCommits(
  dbService: DatabaseService,
  commits: Array<{
    sha: string;
    commitDate: string;
    author: string;
    repository: string;
    linesAdded: number;
    linesRemoved: number;
    message: string;
    branch?: string;
  }>
): Promise<void> {
  for (const commit of commits) {
    // Insert commit_history record
    await dbService.query(`
      INSERT INTO commit_history (
        sha, url, branch, repository, repository_url, author,
        commit_date, commit_message, file_count, lines_added, lines_removed,
        is_merge, is_jira_ref, organization
      )
      VALUES (
        $1, $2, 'main', $3, 'https://github.com/test', $4,
        $5::DATE, $6, 1, $7, $8,
        FALSE, FALSE, 'test-org'
      )
      ON CONFLICT (sha) DO NOTHING
    `, [
      commit.sha,
      `https://github.com/test/commit/${commit.sha}`,
      commit.repository,
      commit.author,
      commit.commitDate,
      commit.message,
      commit.linesAdded,
      commit.linesRemoved,
    ]);

    // Insert commit_branch_relationship if branch specified
    if (commit.branch) {
      await dbService.query(`
        INSERT INTO commit_branch_relationship (sha, branch)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [commit.sha, commit.branch]);
    }
  }
}

/**
 * Helper: Clear all test data.
 */
async function clearTestData(dbService: DatabaseService): Promise<void> {
  await dbService.query('DELETE FROM commit_branch_relationship');
  await dbService.query('DELETE FROM commit_linear');
  await dbService.query('DELETE FROM commit_jira');
  await dbService.query('DELETE FROM commit_files');
  await dbService.query('DELETE FROM commit_history');
}

describe('LOC Drill-Down Integration Tests (GITX-152)', () => {
  beforeAll(async () => {
    // Reset logger for clean test state
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Start PostgreSQL 16 container with Testcontainers
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
      maxPoolSize: 5,
      connectionTimeoutMs: 10_000,
      idleTimeoutMs: 5_000,
    };

    // Initialize database service
    service = new DatabaseService();
    await service.initialize(config);

    // Create schema with required migrations
    await createSchema(service);

    // Create VelocityDataService
    dataService = new VelocityDataService(service);
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
    await clearTestData(service);
  });

  describe('Drill-down for week with commits', () => {
    it('should return correct commit data for a week with commits', async () => {
      // Arrange: Insert test commits for week 1
      await insertTestCommits(service, [
        {
          sha: 'abc1234567890abcdef1234567890abcdef123456',
          commitDate: WEEK1_COMMIT_DATE_1,
          author: 'developer1',
          repository: 'test-repo',
          linesAdded: 100,
          linesRemoved: 20,
          message: 'GITX-100: Add feature A',
          branch: 'main',
        },
        {
          sha: 'def4567890abcdef1234567890abcdef12345678',
          commitDate: WEEK1_COMMIT_DATE_2,
          author: 'developer2',
          repository: 'test-repo',
          linesAdded: 50,
          linesRemoved: 10,
          message: 'GITX-101: Fix bug B',
          branch: 'feature/fix-b',
        },
        {
          sha: 'ghi7890abcdef1234567890abcdef123456789012',
          commitDate: WEEK1_COMMIT_DATE_3,
          author: 'developer1',
          repository: 'test-repo',
          linesAdded: 200,
          linesRemoved: 50,
          message: 'GITX-102: Refactor module C',
          branch: 'main',
        },
      ]);

      // Act
      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      // Assert
      expect(result.weekStart).toBe(WEEK1_START);
      expect(result.repository).toBeNull();
      expect(result.repoUrl).toBeNull(); // Service returns null, panel populates from settings
      expect(result.commitCount).toBe(3);
      // Total LOC: (100+20) + (50+10) + (200+50) = 430
      expect(result.totalLoc).toBe(430);
      expect(result.commits).toHaveLength(3);

      // Verify commits are sorted by total_loc DESC
      expect(result.commits[0].sha).toBe('ghi7890'); // 250 LOC
      expect(result.commits[0].totalLoc).toBe(250);
      expect(result.commits[0].author).toBe('developer1');
      expect(result.commits[0].message).toBe('GITX-102: Refactor module C');

      expect(result.commits[1].sha).toBe('abc1234'); // 120 LOC
      expect(result.commits[1].totalLoc).toBe(120);

      expect(result.commits[2].sha).toBe('def4567'); // 60 LOC
      expect(result.commits[2].totalLoc).toBe(60);
    });

    it('should truncate SHA to 7 characters', async () => {
      await insertTestCommits(service, [
        {
          sha: 'abcdef1234567890abcdef1234567890abcdef12',
          commitDate: WEEK1_COMMIT_DATE_1,
          author: 'developer1',
          repository: 'test-repo',
          linesAdded: 10,
          linesRemoved: 5,
          message: 'Test commit',
        },
      ]);

      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      expect(result.commits[0].sha).toBe('abcdef1');
      expect(result.commits[0].sha).toHaveLength(7);
    });

    it('should return branch name from commit_branch_relationship', async () => {
      await insertTestCommits(service, [
        {
          sha: 'branch123456789012345678901234567890123456',
          commitDate: WEEK1_COMMIT_DATE_1,
          author: 'developer1',
          repository: 'test-repo',
          linesAdded: 10,
          linesRemoved: 5,
          message: 'Test with branch',
          branch: 'feature/my-feature',
        },
      ]);

      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      expect(result.commits[0].branch).toBe('feature/my-feature');
    });

    it('should prioritize main/master branch when multiple branches exist', async () => {
      // Insert commit first
      await insertTestCommits(service, [
        {
          sha: 'multi12345678901234567890123456789012345678',
          commitDate: WEEK1_COMMIT_DATE_1,
          author: 'developer1',
          repository: 'test-repo',
          linesAdded: 10,
          linesRemoved: 5,
          message: 'Multi-branch commit',
        },
      ]);

      // Add multiple branch relationships
      await service.query(`
        INSERT INTO commit_branch_relationship (sha, branch)
        VALUES
          ('multi12345678901234567890123456789012345678', 'feature/xyz'),
          ('multi12345678901234567890123456789012345678', 'main'),
          ('multi12345678901234567890123456789012345678', 'develop')
      `);

      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      // Should prioritize 'main' over other branches
      expect(result.commits[0].branch).toBe('main');
    });
  });

  describe('Drill-down for empty week', () => {
    it('should return empty commits array for week with no commits', async () => {
      // Arrange: Insert commits in week 1, but query empty week
      await insertTestCommits(service, [
        {
          sha: 'week1only1234567890123456789012345678901234',
          commitDate: WEEK1_COMMIT_DATE_1,
          author: 'developer1',
          repository: 'test-repo',
          linesAdded: 100,
          linesRemoved: 20,
          message: 'Week 1 commit',
        },
      ]);

      // Act: Query empty week
      const result = await dataService.getWeekCommitDetails(EMPTY_WEEK_START);

      // Assert
      expect(result.weekStart).toBe(EMPTY_WEEK_START);
      expect(result.repository).toBeNull();
      expect(result.commitCount).toBe(0);
      expect(result.totalLoc).toBe(0);
      expect(result.commits).toHaveLength(0);
    });

    it('should return empty array for week outside date range', async () => {
      // Insert commit in week 1
      await insertTestCommits(service, [
        {
          sha: 'outofrange12345678901234567890123456789012',
          commitDate: WEEK1_COMMIT_DATE_1,
          author: 'developer1',
          repository: 'test-repo',
          linesAdded: 50,
          linesRemoved: 10,
          message: 'Out of range commit',
        },
      ]);

      // Query a week in the future
      const result = await dataService.getWeekCommitDetails('2025-01-06');

      expect(result.commits).toHaveLength(0);
      expect(result.commitCount).toBe(0);
      expect(result.totalLoc).toBe(0);
    });
  });

  describe('Drill-down with repository filter', () => {
    it('should apply repository filter correctly', async () => {
      // Arrange: Insert commits in different repositories
      await insertTestCommits(service, [
        {
          sha: 'repo1commit12345678901234567890123456789012',
          commitDate: WEEK1_COMMIT_DATE_1,
          author: 'developer1',
          repository: 'repo-alpha',
          linesAdded: 100,
          linesRemoved: 20,
          message: 'Alpha repo commit',
        },
        {
          sha: 'repo2commit12345678901234567890123456789012',
          commitDate: WEEK1_COMMIT_DATE_2,
          author: 'developer2',
          repository: 'repo-beta',
          linesAdded: 50,
          linesRemoved: 10,
          message: 'Beta repo commit',
        },
        {
          sha: 'repo1second12345678901234567890123456789012',
          commitDate: WEEK1_COMMIT_DATE_3,
          author: 'developer1',
          repository: 'repo-alpha',
          linesAdded: 30,
          linesRemoved: 5,
          message: 'Another alpha commit',
        },
      ]);

      // Act: Query with repository filter
      const result = await dataService.getWeekCommitDetails(WEEK1_START, 'repo-alpha');

      // Assert: Should only include repo-alpha commits
      expect(result.repository).toBe('repo-alpha');
      expect(result.commitCount).toBe(2);
      // Total LOC for repo-alpha: (100+20) + (30+5) = 155
      expect(result.totalLoc).toBe(155);
      expect(result.commits).toHaveLength(2);

      // All commits should be from repo-alpha (SHAs are truncated to 7 chars)
      for (const commit of result.commits) {
        expect(['repo1co', 'repo1se']).toContain(commit.sha);
      }
    });

    it('should return empty array when repository has no commits in week', async () => {
      await insertTestCommits(service, [
        {
          sha: 'wrongrepo12345678901234567890123456789012',
          commitDate: WEEK1_COMMIT_DATE_1,
          author: 'developer1',
          repository: 'repo-alpha',
          linesAdded: 100,
          linesRemoved: 20,
          message: 'Alpha repo commit',
        },
      ]);

      // Query with non-existent repository
      const result = await dataService.getWeekCommitDetails(WEEK1_START, 'repo-gamma');

      expect(result.repository).toBe('repo-gamma');
      expect(result.commits).toHaveLength(0);
      expect(result.commitCount).toBe(0);
      expect(result.totalLoc).toBe(0);
    });
  });

  describe('Rate limiting', () => {
    it('should block rapid drill-down requests', async () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: DEFAULT_RATE_LIMIT_INTERVAL_MS, // 500ms
        className: 'TestRateLimiter',
      });

      // First request should be allowed
      const check1 = rateLimiter.checkRateLimit('requestLocWeekDrillDown');
      expect(check1.allowed).toBe(true);

      // Immediate second request should be blocked
      const check2 = rateLimiter.checkRateLimit('requestLocWeekDrillDown');
      expect(check2.allowed).toBe(false);
      expect(check2.waitMs).toBeGreaterThan(0);
      expect(check2.waitMs).toBeLessThanOrEqual(DEFAULT_RATE_LIMIT_INTERVAL_MS);
    });

    it('should allow request after rate limit interval', async () => {
      const shortIntervalMs = 50; // 50ms for testing
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: shortIntervalMs,
        className: 'TestRateLimiter',
      });

      // First request
      const check1 = rateLimiter.checkRateLimit('requestLocWeekDrillDown');
      expect(check1.allowed).toBe(true);

      // Wait for rate limit to expire
      await new Promise(resolve => setTimeout(resolve, shortIntervalMs + 10));

      // Second request should be allowed
      const check2 = rateLimiter.checkRateLimit('requestLocWeekDrillDown');
      expect(check2.allowed).toBe(true);
    });

    it('should track rate limits per message type independently', async () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: DEFAULT_RATE_LIMIT_INTERVAL_MS,
        className: 'TestRateLimiter',
      });

      // Request type A
      const checkA1 = rateLimiter.checkRateLimit('requestLocWeekDrillDown');
      expect(checkA1.allowed).toBe(true);

      // Request type B should be allowed immediately (different type)
      const checkB1 = rateLimiter.checkRateLimit('requestVelocityData');
      expect(checkB1.allowed).toBe(true);

      // Request type A again should be blocked
      const checkA2 = rateLimiter.checkRateLimit('requestLocWeekDrillDown');
      expect(checkA2.allowed).toBe(false);
    });
  });

  describe('LIMIT validation (500 commits)', () => {
    it('should return exactly 500 commits when week has more than 500', async () => {
      // Arrange: Insert 510 commits in week 1
      const commits = [];
      for (let i = 0; i < 510; i++) {
        // Generate unique SHA (40 characters)
        const sha = `commit${i.toString().padStart(4, '0')}${'0'.repeat(30)}`;
        commits.push({
          sha,
          commitDate: WEEK1_COMMIT_DATE_1,
          author: `developer${i % 10}`,
          repository: 'test-repo',
          linesAdded: (i % 100) + 1, // Varying LOC for sorting
          linesRemoved: i % 50,
          message: `Commit ${i}`,
        });
      }
      await insertTestCommits(service, commits);

      // Act
      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      // Assert: Should return exactly 500 commits
      expect(result.commits).toHaveLength(500);
      expect(result.commitCount).toBe(500);

      // Verify commits are sorted by LOC DESC
      for (let i = 1; i < result.commits.length; i++) {
        expect(result.commits[i - 1].totalLoc).toBeGreaterThanOrEqual(result.commits[i].totalLoc);
      }
    }, 60_000); // 60 second timeout for bulk insert

    it('should return all commits when under 500 limit', async () => {
      // Insert 100 commits
      const commits = [];
      for (let i = 0; i < 100; i++) {
        const sha = `underli${i.toString().padStart(4, '0')}${'0'.repeat(29)}`;
        commits.push({
          sha,
          commitDate: WEEK1_COMMIT_DATE_1,
          author: `developer${i % 5}`,
          repository: 'test-repo',
          linesAdded: 10 + i,
          linesRemoved: 5,
          message: `Under limit commit ${i}`,
        });
      }
      await insertTestCommits(service, commits);

      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      expect(result.commits).toHaveLength(100);
      expect(result.commitCount).toBe(100);
    });
  });

  describe('Performance validation', () => {
    it('should complete query within 2 seconds for 200 commits', async () => {
      // Arrange: Insert 200 commits with varying data
      const commits = [];
      for (let i = 0; i < 200; i++) {
        const sha = `perf${i.toString().padStart(4, '0')}${Math.random().toString(36).substring(2).padEnd(32, '0')}`;
        commits.push({
          sha: sha.substring(0, 40), // Ensure exactly 40 chars
          commitDate: WEEK1_COMMIT_DATE_1,
          author: `developer${i % 20}`,
          repository: `repo-${i % 5}`,
          linesAdded: Math.floor(Math.random() * 500) + 1,
          linesRemoved: Math.floor(Math.random() * 200),
          message: `Performance test commit ${i} with some additional text to simulate realistic message lengths`,
        });
      }
      await insertTestCommits(service, commits);

      // Act: Time the query
      const startTime = performance.now();
      const result = await dataService.getWeekCommitDetails(WEEK1_START);
      const endTime = performance.now();
      const durationMs = endTime - startTime;

      // Assert: Query should complete within 2 seconds
      expect(durationMs).toBeLessThan(2000);
      expect(result.commits).toHaveLength(200);

      // Log performance for debugging
      console.log(`[GITX-152] Query for 200 commits completed in ${durationMs.toFixed(2)}ms`);
    }, 30_000);

    it('should maintain performance with repository filter', async () => {
      // Insert 200 commits across multiple repositories
      const commits = [];
      for (let i = 0; i < 200; i++) {
        const sha = `perffi${i.toString().padStart(4, '0')}${Math.random().toString(36).substring(2).padEnd(32, '0')}`;
        commits.push({
          sha: sha.substring(0, 40),
          commitDate: WEEK1_COMMIT_DATE_1,
          author: `developer${i % 10}`,
          repository: i % 2 === 0 ? 'target-repo' : 'other-repo',
          linesAdded: Math.floor(Math.random() * 300) + 1,
          linesRemoved: Math.floor(Math.random() * 100),
          message: `Filtered performance test ${i}`,
        });
      }
      await insertTestCommits(service, commits);

      const startTime = performance.now();
      const result = await dataService.getWeekCommitDetails(WEEK1_START, 'target-repo');
      const endTime = performance.now();
      const durationMs = endTime - startTime;

      // Should complete within 2 seconds
      expect(durationMs).toBeLessThan(2000);
      expect(result.commits).toHaveLength(100); // Half are target-repo
      expect(result.repository).toBe('target-repo');

      console.log(`[GITX-152] Filtered query for 100 commits completed in ${durationMs.toFixed(2)}ms`);
    }, 30_000);
  });

  describe('Input validation', () => {
    it('should reject invalid date format', async () => {
      await expect(
        dataService.getWeekCommitDetails('invalid-date')
      ).rejects.toThrow('Invalid week start date: invalid-date');
    });

    it('should reject invalid repository name', async () => {
      await expect(
        dataService.getWeekCommitDetails('2024-01-08', 'invalid/repo!@#$')
      ).rejects.toThrow('Invalid repository name');
    });

    it('should accept valid repository name with dots and hyphens', async () => {
      await insertTestCommits(service, [
        {
          sha: 'validrepo12345678901234567890123456789012',
          commitDate: WEEK1_COMMIT_DATE_1,
          author: 'developer1',
          repository: 'my-valid.repo_name',
          linesAdded: 50,
          linesRemoved: 10,
          message: 'Valid repo commit',
        },
      ]);

      const result = await dataService.getWeekCommitDetails(WEEK1_START, 'my-valid.repo_name');

      expect(result.repository).toBe('my-valid.repo_name');
      expect(result.commits).toHaveLength(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle commit with NULL author gracefully', async () => {
      // Insert commit with NULL author directly
      await service.query(`
        INSERT INTO commit_history (
          sha, url, branch, repository, repository_url, author,
          commit_date, commit_message, file_count, lines_added, lines_removed,
          is_merge, is_jira_ref, organization
        )
        VALUES (
          'nullauthor1234567890123456789012345678901',
          'https://github.com/test/commit/nullauthor',
          'main',
          'test-repo',
          'https://github.com/test',
          NULL,
          '${WEEK1_COMMIT_DATE_1}'::DATE,
          'Commit without author',
          1,
          20,
          5,
          FALSE,
          FALSE,
          'test-org'
        )
      `);

      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].author).toBe('unknown');
    });

    it('should handle commit with empty message', async () => {
      await service.query(`
        INSERT INTO commit_history (
          sha, url, branch, repository, repository_url, author,
          commit_date, commit_message, file_count, lines_added, lines_removed,
          is_merge, is_jira_ref, organization
        )
        VALUES (
          'emptymsg123456789012345678901234567890',
          'https://github.com/test/commit/emptymsg',
          'main',
          'test-repo',
          'https://github.com/test',
          'developer1',
          '${WEEK1_COMMIT_DATE_1}'::DATE,
          '',
          1,
          10,
          2,
          FALSE,
          FALSE,
          'test-org'
        )
      `);

      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].message).toBe('');
    });

    it('should truncate long commit messages to 1000 characters', async () => {
      const longMessage = 'A'.repeat(1500);

      await service.query(`
        INSERT INTO commit_history (
          sha, url, branch, repository, repository_url, author,
          commit_date, commit_message, file_count, lines_added, lines_removed,
          is_merge, is_jira_ref, organization
        )
        VALUES (
          'longmsg1234567890123456789012345678901234',
          'https://github.com/test/commit/longmsg',
          'main',
          'test-repo',
          'https://github.com/test',
          'developer1',
          '${WEEK1_COMMIT_DATE_1}'::DATE,
          $1,
          1,
          10,
          2,
          FALSE,
          FALSE,
          'test-org'
        )
      `, [longMessage]);

      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].message.length).toBeLessThanOrEqual(1000);
    });

    it('should handle commit with zero LOC', async () => {
      await insertTestCommits(service, [
        {
          sha: 'zeroloc1234567890123456789012345678901234',
          commitDate: WEEK1_COMMIT_DATE_1,
          author: 'developer1',
          repository: 'test-repo',
          linesAdded: 0,
          linesRemoved: 0,
          message: 'Empty commit',
        },
      ]);

      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].linesAdded).toBe(0);
      expect(result.commits[0].linesDeleted).toBe(0);
      expect(result.commits[0].totalLoc).toBe(0);
    });

    it('should use "unknown" branch when no branch relationship exists', async () => {
      // Insert commit without branch relationship
      await service.query(`
        INSERT INTO commit_history (
          sha, url, branch, repository, repository_url, author,
          commit_date, commit_message, file_count, lines_added, lines_removed,
          is_merge, is_jira_ref, organization
        )
        VALUES (
          'nobranch12345678901234567890123456789012',
          'https://github.com/test/commit/nobranch',
          'main',
          'test-repo',
          'https://github.com/test',
          'developer1',
          '${WEEK1_COMMIT_DATE_1}'::DATE,
          'No branch relationship',
          1,
          10,
          2,
          FALSE,
          FALSE,
          'test-org'
        )
      `);

      const result = await dataService.getWeekCommitDetails(WEEK1_START);

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].branch).toBe('unknown');
    });
  });
});
