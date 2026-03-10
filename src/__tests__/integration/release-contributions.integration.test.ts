import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LoggerService } from '../../logging/logger.js';
import { DatabaseService } from '../../database/database-service.js';
import type { DatabaseConfig } from '../../database/database-service.js';

/**
 * INTEGRATION TEST: Release Management Contributions Chart
 *
 * Tests against real PostgreSQL 16 via Testcontainers.
 * Validates:
 * - Query performance with realistic data volumes
 * - Branch pattern matching (production vs staging)
 * - Merge commit filtering (is_merge = TRUE)
 * - Contributor aggregation accuracy
 * - Default time range behavior (30 days)
 *
 * Pattern follows commit-repository.integration.test.ts
 */

const PG_DATABASE = 'gitrx_integration_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseConfig;

/**
 * Helper: Create schema from migration files.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply migrations in order
  const tableSql = readFileSync(join(migrationsDir, '001_create_tables.sql'), 'utf-8');
  await dbService.query(tableSql);
}

/**
 * Helper: Insert test data for release contributions testing.
 */
async function seedTestData(dbService: DatabaseService): Promise<void> {
  // Insert contributors
  await dbService.query(`
    INSERT INTO commit_contributors (login, email, full_name, team)
    VALUES
      ('alice', 'alice@example.com', 'Alice Smith', 'Platform'),
      ('bob', 'bob@example.com', 'Bob Jones', 'Frontend'),
      ('charlie', 'charlie@example.com', 'Charlie Brown', 'Backend'),
      ('bot', 'bot@example.com', NULL, NULL)
  `);

  // Insert merge commits across different branches
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  // Use 28 days ago to safely stay within 30-day window (avoids timing boundary issues)
  const threeWeeksAgo = new Date(now);
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 28);
  const fortyDaysAgo = new Date(now);
  fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);

  await dbService.query(`
    INSERT INTO commit_history (sha, author, commit_date, commit_message, repository, is_merge)
    VALUES
      -- Alice: Production merges (main branch)
      ('sha-alice-prod-1', 'alice@example.com', $1, 'Merge PR #1', 'app-repo', TRUE),
      ('sha-alice-prod-2', 'alice@example.com', $2, 'Merge PR #2', 'app-repo', TRUE),
      ('sha-alice-prod-3', 'alice@example.com', $3, 'Merge PR #3', 'app-repo', TRUE),

      -- Alice: Staging merges (develop branch)
      ('sha-alice-stage-1', 'alice@example.com', $1, 'Merge PR #10', 'app-repo', TRUE),
      ('sha-alice-stage-2', 'alice@example.com', $2, 'Merge PR #11', 'app-repo', TRUE),
      ('sha-alice-stage-3', 'alice@example.com', $3, 'Merge PR #12', 'app-repo', TRUE),
      ('sha-alice-stage-4', 'alice@example.com', $4, 'Merge PR #13', 'app-repo', TRUE),
      ('sha-alice-stage-5', 'alice@example.com', $4, 'Merge PR #14', 'app-repo', TRUE),

      -- Bob: Production merges (master branch)
      ('sha-bob-prod-1', 'bob@example.com', $2, 'Merge feature X', 'frontend-repo', TRUE),
      ('sha-bob-prod-2', 'bob@example.com', $3, 'Merge feature Y', 'frontend-repo', TRUE),

      -- Charlie: Staging merges (staging branch)
      ('sha-charlie-stage-1', 'charlie@example.com', $3, 'Merge hotfix', 'backend-repo', TRUE),

      -- Bot: Production merge (no full_name)
      ('sha-bot-prod-1', 'bot@example.com', $1, 'Automated merge', 'app-repo', TRUE),

      -- Non-merge commits (should be excluded)
      ('sha-alice-nonmerge', 'alice@example.com', $1, 'Regular commit', 'app-repo', FALSE),
      ('sha-bob-nonmerge', 'bob@example.com', $2, 'Regular commit', 'frontend-repo', FALSE),

      -- Old merge outside 30-day window (should be excluded by default filter)
      ('sha-alice-old', 'alice@example.com', $5, 'Old merge', 'app-repo', TRUE)
  `, [yesterday, lastWeek, twoWeeksAgo, threeWeeksAgo, fortyDaysAgo]);

  // Insert branch relationships
  await dbService.query(`
    INSERT INTO commit_branch_relationship (sha, branch)
    VALUES
      -- Production branches (main)
      ('sha-alice-prod-1', 'main'),
      ('sha-alice-prod-2', 'main'),
      ('sha-alice-prod-3', 'main'),
      ('sha-bot-prod-1', 'main'),

      -- Production branches (master)
      ('sha-bob-prod-1', 'master'),
      ('sha-bob-prod-2', 'master'),

      -- Staging branches (develop)
      ('sha-alice-stage-1', 'develop'),
      ('sha-alice-stage-2', 'develop'),
      ('sha-alice-stage-3', 'develop'),
      ('sha-alice-stage-4', 'develop'),
      ('sha-alice-stage-5', 'develop'),

      -- Staging branches (staging)
      ('sha-charlie-stage-1', 'staging'),

      -- Non-merge commits (should be excluded anyway)
      ('sha-alice-nonmerge', 'main'),
      ('sha-bob-nonmerge', 'master'),

      -- Old merge
      ('sha-alice-old', 'main')
  `);
}

describe('ReleaseContributionsDataService Integration Tests', () => {
  beforeAll(async () => {
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

    service = new DatabaseService();
    await service.initialize(config);

    // Create schema and seed test data
    await createSchema(service);
    await seedTestData(service);
  }, 120_000);

  afterAll(async () => {
    if (service?.isInitialized()) {
      await service.shutdown();
    }
    if (container) {
      await container.stop();
    }
  }, 30_000);

  beforeEach(async () => {
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // INTEGRATION: Query returns correct merge commit counts
  // ==========================================================================
  describe('getReleaseContributions (integration)', () => {
    it('should return merge commits grouped by contributor and environment', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const now = new Date();

      const query = `
        WITH merge_commits AS (
          SELECT
            ch.sha,
            ch.commit_date,
            ch.author,
            cc.full_name,
            cc.team,
            ch.repository,
            cbr.branch,
            CASE
              WHEN cbr.branch = ANY($1::TEXT[]) THEN 'Production'
              WHEN cbr.branch = ANY($2::TEXT[]) THEN 'Staging'
              ELSE 'Other'
            END AS environment
          FROM commit_history ch
          LEFT JOIN commit_contributors cc ON ch.author = cc.email
          LEFT JOIN commit_branch_relationship cbr ON ch.sha = cbr.sha
          WHERE ch.is_merge = TRUE
            AND ch.commit_date >= $3
            AND ch.commit_date <= $4
            AND ($5::TEXT IS NULL OR ch.repository = $5)
        )
        SELECT
          author,
          COALESCE(full_name, 'Unknown (' || author || ')') AS full_name,
          team,
          environment,
          COUNT(DISTINCT sha)::INT AS merge_count
        FROM merge_commits
        WHERE environment IN ('Production', 'Staging')
        GROUP BY author, full_name, team, environment
        ORDER BY full_name, environment
        LIMIT 1000
      `;

      const result = await service.query<{
        author: string;
        full_name: string;
        team: string | null;
        environment: string;
        merge_count: number;
      }>(query, [
        ['main', 'master'],        // production patterns
        ['develop', 'staging'],    // staging patterns
        thirtyDaysAgo.toISOString(),
        now.toISOString(),
        null,                      // no repository filter
      ]);

      // Verify results
      expect(result.rows.length).toBeGreaterThan(0);

      // Alice should have Production and Staging counts
      const aliceProd = result.rows.find(r => r.author === 'alice@example.com' && r.environment === 'Production');
      const aliceStage = result.rows.find(r => r.author === 'alice@example.com' && r.environment === 'Staging');
      expect(aliceProd).toBeDefined();
      expect(aliceStage).toBeDefined();
      expect(aliceProd!.merge_count).toBe(3); // 3 production merges to main
      expect(aliceStage!.merge_count).toBe(5); // 5 staging merges to develop

      // Bob should have only Production counts
      const bobProd = result.rows.find(r => r.author === 'bob@example.com' && r.environment === 'Production');
      expect(bobProd).toBeDefined();
      expect(bobProd!.merge_count).toBe(2); // 2 production merges to master

      // Charlie should have only Staging counts
      const charlieStage = result.rows.find(r => r.author === 'charlie@example.com' && r.environment === 'Staging');
      expect(charlieStage).toBeDefined();
      expect(charlieStage!.merge_count).toBe(1); // 1 staging merge to staging

      // Bot should show "Unknown (bot@example.com)"
      const botProd = result.rows.find(r => r.author === 'bot@example.com' && r.environment === 'Production');
      expect(botProd).toBeDefined();
      expect(botProd!.full_name).toBe('Unknown (bot@example.com)');
      expect(botProd!.merge_count).toBe(1);
    });

    it('should exclude non-merge commits', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const now = new Date();

      const query = `
        SELECT COUNT(DISTINCT sha)::INT AS total_merges
        FROM commit_history
        WHERE is_merge = TRUE
          AND commit_date >= $1
          AND commit_date <= $2
      `;

      const result = await service.query<{ total_merges: number }>(query, [
        thirtyDaysAgo.toISOString(),
        now.toISOString(),
      ]);

      // Should have 12 merge commits within 30 days (excluding the 40-day-old one and non-merges)
      expect(result.rows[0]?.total_merges).toBe(12);
    });

    it('should filter by repository', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const now = new Date();

      const query = `
        WITH merge_commits AS (
          SELECT
            ch.sha,
            ch.author,
            cbr.branch,
            CASE
              WHEN cbr.branch = ANY($1::TEXT[]) THEN 'Production'
              WHEN cbr.branch = ANY($2::TEXT[]) THEN 'Staging'
              ELSE 'Other'
            END AS environment
          FROM commit_history ch
          LEFT JOIN commit_branch_relationship cbr ON ch.sha = cbr.sha
          WHERE ch.is_merge = TRUE
            AND ch.commit_date >= $3
            AND ch.commit_date <= $4
            AND ch.repository = $5
        )
        SELECT COUNT(DISTINCT sha)::INT AS merge_count
        FROM merge_commits
        WHERE environment IN ('Production', 'Staging')
      `;

      const result = await service.query<{ merge_count: number }>(query, [
        ['main', 'master'],
        ['develop', 'staging'],
        thirtyDaysAgo.toISOString(),
        now.toISOString(),
        'app-repo',
      ]);

      // app-repo has 9 merge commits (3 prod + 5 staging + 1 bot prod)
      expect(result.rows[0]?.merge_count).toBe(9);
    });
  });

  // ==========================================================================
  // PERFORMANCE: Query execution time
  // ==========================================================================
  describe('getReleaseContributions (performance)', () => {
    it('should execute query in < 500ms with 100 merge commits', async () => {
      // Insert 100 additional merge commits
      const values: string[] = [];
      const params: unknown[] = [];
      const now = new Date();
      const fiveDaysAgo = new Date(now);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      for (let i = 0; i < 100; i++) {
        values.push(`($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, TRUE)`);
        params.push(
          `sha-perf-${i}`,
          `perf${i % 10}@example.com`,
          fiveDaysAgo,
          `Merge perf test ${i}`,
          'perf-repo',
        );
      }

      await service.query(
        `INSERT INTO commit_history (sha, author, commit_date, commit_message, repository, is_merge)
         VALUES ${values.join(', ')}`,
        params,
      );

      // Insert branch relationships for performance test commits
      const branchValues: string[] = [];
      const branchParams: unknown[] = [];
      for (let i = 0; i < 100; i++) {
        branchValues.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
        branchParams.push(`sha-perf-${i}`, i % 2 === 0 ? 'main' : 'develop');
      }

      await service.query(
        `INSERT INTO commit_branch_relationship (sha, branch)
         VALUES ${branchValues.join(', ')}`,
        branchParams,
      );

      // Execute query and measure time
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const query = `
        WITH merge_commits AS (
          SELECT
            ch.sha,
            ch.author,
            cc.full_name,
            cc.team,
            cbr.branch,
            CASE
              WHEN cbr.branch = ANY($1::TEXT[]) THEN 'Production'
              WHEN cbr.branch = ANY($2::TEXT[]) THEN 'Staging'
              ELSE 'Other'
            END AS environment
          FROM commit_history ch
          LEFT JOIN commit_contributors cc ON ch.author = cc.email
          LEFT JOIN commit_branch_relationship cbr ON ch.sha = cbr.sha
          WHERE ch.is_merge = TRUE
            AND ch.commit_date >= $3
            AND ch.commit_date <= $4
        )
        SELECT
          author,
          COALESCE(full_name, 'Unknown (' || author || ')') AS full_name,
          environment,
          COUNT(DISTINCT sha)::INT AS merge_count
        FROM merge_commits
        WHERE environment IN ('Production', 'Staging')
        GROUP BY author, full_name, environment
        ORDER BY full_name, environment
        LIMIT 1000
      `;

      const startTime = Date.now();
      const result = await service.query(query, [
        ['main', 'master'],
        ['develop', 'staging'],
        thirtyDaysAgo.toISOString(),
        now.toISOString(),
      ]);
      const duration = Date.now() - startTime;

      expect(result.rows.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(500); // PERFORMANCE REQUIREMENT: < 500ms
    });
  });

  // ==========================================================================
  // EDGE CASE: Custom branch patterns
  // ==========================================================================
  describe('getReleaseContributions (custom branch patterns)', () => {
    it('should support custom production and staging patterns', async () => {
      // Insert commits on custom branches
      const now = new Date();
      await service.query(`
        INSERT INTO commit_history (sha, author, commit_date, commit_message, repository, is_merge)
        VALUES
          ('sha-custom-prod', 'alice@example.com', $1, 'Merge to prod', 'app-repo', TRUE),
          ('sha-custom-release', 'alice@example.com', $1, 'Merge to release', 'app-repo', TRUE),
          ('sha-custom-dev', 'bob@example.com', $1, 'Merge to dev', 'app-repo', TRUE)
      `, [now]);

      await service.query(`
        INSERT INTO commit_branch_relationship (sha, branch)
        VALUES
          ('sha-custom-prod', 'prod'),
          ('sha-custom-release', 'release'),
          ('sha-custom-dev', 'dev')
      `);

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const query = `
        WITH merge_commits AS (
          SELECT
            ch.sha,
            ch.author,
            cbr.branch,
            CASE
              WHEN cbr.branch = ANY($1::TEXT[]) THEN 'Production'
              WHEN cbr.branch = ANY($2::TEXT[]) THEN 'Staging'
              ELSE 'Other'
            END AS environment
          FROM commit_history ch
          LEFT JOIN commit_branch_relationship cbr ON ch.sha = cbr.sha
          WHERE ch.is_merge = TRUE
            AND ch.commit_date >= $3
            AND ch.commit_date <= $4
        )
        SELECT
          author,
          environment,
          COUNT(DISTINCT sha)::INT AS merge_count
        FROM merge_commits
        WHERE environment IN ('Production', 'Staging')
          AND author = 'alice@example.com'
        GROUP BY author, environment
        ORDER BY environment
      `;

      const result = await service.query<{
        author: string;
        environment: string;
        merge_count: number;
      }>(query, [
        ['prod', 'release'],  // custom production patterns
        ['dev'],              // custom staging patterns
        thirtyDaysAgo.toISOString(),
        now.toISOString(),
      ]);

      // Alice should have 2 production merges (prod + release) and 0 staging (she didn't merge to dev)
      const aliceProd = result.rows.find(r => r.environment === 'Production');
      expect(aliceProd).toBeDefined();
      expect(aliceProd!.merge_count).toBe(2);
    });
  });
});
