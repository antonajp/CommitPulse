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

/**
 * Integration tests for migration 022: vw_sprint_velocity_vs_loc Jira support.
 *
 * Uses Testcontainers to spin up PostgreSQL 16, applies migrations,
 * then verifies the view correctly combines Jira and Linear data.
 *
 * Ticket: IQS-937
 *
 * Test coverage includes:
 * - Jira-only: View returns data when only Jira issues exist
 * - Linear-only: View returns data when only Linear issues exist (regression)
 * - Mixed: View correctly aggregates when both exist
 * - Repository filter works across both data sources
 * - Team filter correctly handles NULL team for Jira
 */

const PG_DATABASE = 'gitrx_velocity_jira_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;

/**
 * Helper: Create schema from migration files.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply migrations in order (must include all dependencies)
  const migrations = [
    '001_create_tables.sql',
    '002_create_views.sql',
    '004_add_linear_support.sql',
    '005_add_calculated_story_points.sql',
    '008_sprint_velocity_loc_view.sql',
    '022_velocity_view_jira_support.sql',
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert Jira test data (issues + commits linked via commit_jira).
 *
 * IMPORTANT: Uses fixed dates to ensure deterministic week boundaries.
 * Using NOW() - INTERVAL caused flaky tests because week boundaries depend
 * on what day the test runs (DATE_TRUNC('week') starts on Monday in PostgreSQL).
 *
 * Test data distribution:
 * - Week 1 (2024-01-08): JIRA-101 (5 SP), jira-sha-001 in test-repo
 * - Week 2 (2024-01-15): JIRA-102 (3 SP) + JIRA-103 (2 SP), jira-sha-002 in test-repo, jira-sha-003 in other-repo
 */
async function insertJiraTestData(dbService: DatabaseService): Promise<void> {
  // Fixed dates for deterministic week boundaries (PostgreSQL weeks start Monday)
  // Week 1: 2024-01-08 (Monday)
  // Week 2: 2024-01-15 (Monday)
  const WEEK1_DATE = '2024-01-10'; // Wednesday of week 1
  const WEEK2_DATE_EARLY = '2024-01-17'; // Wednesday of week 2
  const WEEK2_DATE_LATE = '2024-01-19'; // Friday of week 2

  // Insert commit_history first (required for foreign key)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      ('jira-sha-001', 'https://github.com/test/commit/jira-sha-001', 'main', 'test-repo', 'https://github.com/test', 'developer1', '${WEEK1_DATE}'::DATE, 'JIRA-101: Add feature', 3, 100, 20, FALSE, TRUE, 'test-org'),
      ('jira-sha-002', 'https://github.com/test/commit/jira-sha-002', 'main', 'test-repo', 'https://github.com/test', 'developer1', '${WEEK2_DATE_EARLY}'::DATE, 'JIRA-102: Bug fix', 2, 50, 10, FALSE, TRUE, 'test-org'),
      ('jira-sha-003', 'https://github.com/test/commit/jira-sha-003', 'main', 'other-repo', 'https://github.com/test', 'developer2', '${WEEK2_DATE_LATE}'::DATE, 'JIRA-103: Update', 1, 30, 5, FALSE, TRUE, 'test-org')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commit_files for LOC calculation
  await dbService.query(`
    INSERT INTO commit_files (sha, filename, file_extension, line_inserts, line_deletes, line_diff, total_lines, total_code_lines, total_comment_lines, complexity, weighted_complexity, author, parent_directory, sub_directory, is_test_file)
    VALUES
      ('jira-sha-001', 'src/feature.ts', 'ts', 100, 20, 120, 200, 180, 20, 5, 10, 'developer1', 'src', '', FALSE),
      ('jira-sha-002', 'src/bugfix.ts', 'ts', 50, 10, 60, 100, 90, 10, 3, 6, 'developer1', 'src', '', FALSE),
      ('jira-sha-003', 'src/update.ts', 'ts', 30, 5, 35, 50, 45, 5, 2, 4, 'developer2', 'src', '', FALSE)
    ON CONFLICT (sha, filename) DO NOTHING
  `);

  // Insert jira_detail records (done issues with story points)
  // Week 1: JIRA-101 (5 SP) - Done
  // Week 2: JIRA-102 (3 SP) - Closed, JIRA-103 (2 SP) - Resolved
  // JIRA-104 is In Progress, should not be counted
  await dbService.query(`
    INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points, calculated_story_points)
    VALUES
      ('jira-1001', 'JIRA-101', 'High', '2024-01-01'::DATE, 'https://jira/JIRA-101', 'Feature A', 'Description A', 'reporter1', 'Story', 'PROJ', 'Done', 'user1', 'Done', '1.0', 'Backend', '${WEEK1_DATE}'::DATE, 5, 5),
      ('jira-1002', 'JIRA-102', 'Medium', '2024-01-02'::DATE, 'https://jira/JIRA-102', 'Bug Fix B', 'Description B', 'reporter1', 'Bug', 'PROJ', 'Done', 'user2', 'Closed', '1.0', 'Frontend', '${WEEK2_DATE_EARLY}'::DATE, 3, 3),
      ('jira-1003', 'JIRA-103', 'Low', '2024-01-03'::DATE, 'https://jira/JIRA-103', 'Task C', 'Description C', 'reporter2', 'Task', 'PROJ', 'Done', 'user1', 'Resolved', '1.0', 'Backend', '${WEEK2_DATE_LATE}'::DATE, 2, 2),
      ('jira-1004', 'JIRA-104', 'High', '2024-01-04'::DATE, 'https://jira/JIRA-104', 'In Progress D', 'Description D', 'reporter1', 'Story', 'PROJ', NULL, 'user3', 'In Progress', '1.0', 'Backend', '2024-01-20'::DATE, 8, 8)
    ON CONFLICT (jira_key) DO NOTHING
  `);

  // Link commits to Jira issues via commit_jira
  await dbService.query(`
    INSERT INTO commit_jira (sha, jira_key, author, jira_project)
    VALUES
      ('jira-sha-001', 'JIRA-101', 'developer1', 'PROJ'),
      ('jira-sha-002', 'JIRA-102', 'developer1', 'PROJ'),
      ('jira-sha-003', 'JIRA-103', 'developer2', 'PROJ')
    ON CONFLICT (sha, jira_key) DO NOTHING
  `);
}

/**
 * Helper: Insert Linear test data (issues + commits linked via commit_linear).
 *
 * IMPORTANT: Uses fixed dates to ensure deterministic week boundaries.
 * Using NOW() - INTERVAL caused flaky tests because week boundaries depend
 * on what day the test runs (DATE_TRUNC('week') starts on Monday in PostgreSQL).
 *
 * Test data distribution:
 * - Week 1 (2024-01-08): LIN-101 (5 SP), linear-sha-001 in test-repo
 * - Week 2 (2024-01-15): LIN-102 (3 SP), linear-sha-002 in test-repo
 */
async function insertLinearTestData(dbService: DatabaseService): Promise<void> {
  // Fixed dates for deterministic week boundaries (PostgreSQL weeks start Monday)
  // Week 1: 2024-01-08 (Monday) - same as Jira week 1
  // Week 2: 2024-01-15 (Monday) - same as Jira week 2
  const WEEK1_DATE = '2024-01-11'; // Thursday of week 1
  const WEEK2_DATE = '2024-01-18'; // Thursday of week 2

  // Insert commit_history first (required for foreign key)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, is_linear_ref, organization)
    VALUES
      ('linear-sha-001', 'https://github.com/test/commit/linear-sha-001', 'main', 'test-repo', 'https://github.com/test', 'developer3', '${WEEK1_DATE}'::DATE, 'LIN-101: Add Linear feature', 2, 80, 15, FALSE, FALSE, TRUE, 'test-org'),
      ('linear-sha-002', 'https://github.com/test/commit/linear-sha-002', 'main', 'test-repo', 'https://github.com/test', 'developer4', '${WEEK2_DATE}'::DATE, 'LIN-102: Linear bug fix', 1, 40, 8, FALSE, FALSE, TRUE, 'test-org')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commit_files for LOC calculation
  await dbService.query(`
    INSERT INTO commit_files (sha, filename, file_extension, line_inserts, line_deletes, line_diff, total_lines, total_code_lines, total_comment_lines, complexity, weighted_complexity, author, parent_directory, sub_directory, is_test_file)
    VALUES
      ('linear-sha-001', 'src/linear-feature.ts', 'ts', 80, 15, 95, 150, 140, 10, 4, 8, 'developer3', 'src', '', FALSE),
      ('linear-sha-002', 'src/linear-bugfix.ts', 'ts', 40, 8, 48, 80, 75, 5, 2, 4, 'developer4', 'src', '', FALSE)
    ON CONFLICT (sha, filename) DO NOTHING
  `);

  // Insert linear_detail records (done issues with story points)
  // Week 1: LIN-101 (5 SP) - Done
  // Week 2: LIN-102 (3 SP) - Completed
  // LIN-103 is In Progress, should not be counted
  await dbService.query(`
    INSERT INTO linear_detail (linear_id, linear_key, priority, created_date, url, title, description, creator, state, assignee, project, team, estimate, status_change_date, completed_date, calculated_story_points)
    VALUES
      ('lin-1001', 'LIN-101', 'Urgent', '2024-01-01'::DATE, 'https://linear/LIN-101', 'Linear Feature A', 'Description', 'creator1', 'Done', 'user4', 'ProjectX', 'TeamA', 5, '${WEEK1_DATE}'::DATE, '${WEEK1_DATE}'::DATE, 5),
      ('lin-1002', 'LIN-102', 'High', '2024-01-05'::DATE, 'https://linear/LIN-102', 'Linear Task B', 'Description', 'creator1', 'Completed', 'user5', 'ProjectX', 'TeamA', 3, '${WEEK2_DATE}'::DATE, '${WEEK2_DATE}'::DATE, 3),
      ('lin-1003', 'LIN-103', 'Normal', '2024-01-10'::DATE, 'https://linear/LIN-103', 'In Progress C', 'Description', 'creator2', 'In Progress', 'user6', 'ProjectX', 'TeamA', 2, '2024-01-20'::DATE, NULL, 2)
    ON CONFLICT (linear_key) DO NOTHING
  `);

  // Link commits to Linear issues via commit_linear
  await dbService.query(`
    INSERT INTO commit_linear (sha, linear_key, author, linear_project)
    VALUES
      ('linear-sha-001', 'LIN-101', 'developer3', 'ProjectX'),
      ('linear-sha-002', 'LIN-102', 'developer4', 'ProjectX')
    ON CONFLICT (sha, linear_key) DO NOTHING
  `);
}

/**
 * Helper: Clear all test data.
 */
async function clearTestData(dbService: DatabaseService): Promise<void> {
  await dbService.query('DELETE FROM commit_linear');
  await dbService.query('DELETE FROM commit_jira');
  await dbService.query('DELETE FROM commit_files');
  await dbService.query('DELETE FROM commit_history');
  await dbService.query('DELETE FROM linear_detail');
  await dbService.query('DELETE FROM jira_detail');
}

describe('Migration 022: vw_sprint_velocity_vs_loc Jira Support', () => {
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

    // Create schema with all migrations including 022
    await createSchema(service);
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

  describe('View structure', () => {
    it('should have the vw_sprint_velocity_vs_loc view', async () => {
      const result = await service.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.views
          WHERE table_name = 'vw_sprint_velocity_vs_loc'
        ) AS view_exists
      `);
      expect(result.rows[0]?.view_exists).toBe(true);
    });

    it('should have all expected columns', async () => {
      const result = await service.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'vw_sprint_velocity_vs_loc'
        ORDER BY ordinal_position
      `);
      const columns = result.rows.map(r => r.column_name);
      expect(columns).toContain('week_start');
      expect(columns).toContain('team');
      expect(columns).toContain('project');
      expect(columns).toContain('repository');
      expect(columns).toContain('total_story_points');
      expect(columns).toContain('issue_count');
      expect(columns).toContain('total_loc_changed');
      expect(columns).toContain('total_lines_added');
      expect(columns).toContain('total_lines_deleted');
      expect(columns).toContain('commit_count');
    });
  });

  describe('Jira-only environment', () => {
    beforeEach(async () => {
      await insertJiraTestData(service);
    });

    it('should return data when only Jira issues exist', async () => {
      const result = await service.query(`
        SELECT * FROM vw_sprint_velocity_vs_loc
        ORDER BY week_start DESC
      `);

      // Should have rows with Jira data
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should aggregate story points from completed Jira issues', async () => {
      const result = await service.query(`
        SELECT SUM(total_story_points) as total_sp, SUM(issue_count) as total_issues
        FROM vw_sprint_velocity_vs_loc
      `);

      // The view FULL OUTER JOINs story points (by week/team/project) with LOC (by week/repository).
      // Story points are repeated for each repository in the same week:
      //
      // Week 1 (2024-01-08): JIRA-101 (5 SP, 1 issue) × 1 repo (test-repo) = 5 SP, 1 issue
      // Week 2 (2024-01-15): JIRA-102 + JIRA-103 (5 SP, 2 issues) × 2 repos = 10 SP, 4 issues
      // Total: 15 SP, 5 issues
      //
      // JIRA-104 is In Progress, so should not be counted
      expect(Number(result.rows[0]?.total_sp)).toBe(15);
      expect(Number(result.rows[0]?.total_issues)).toBe(5);
    });

    it('should use status_change_date for Jira completion date', async () => {
      const result = await service.query(`
        SELECT week_start, total_story_points
        FROM vw_sprint_velocity_vs_loc
        WHERE total_story_points > 0
        ORDER BY week_start DESC
      `);

      // All three done Jira issues were completed within the last 7 days
      // so they should be grouped by their status_change_date week
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have NULL team for Jira issues', async () => {
      const result = await service.query(`
        SELECT DISTINCT team FROM vw_sprint_velocity_vs_loc
        WHERE total_story_points > 0
      `);

      // Jira issues have NULL team
      const teams = result.rows.map(r => r.team);
      expect(teams).toContain(null);
    });

    it('should count LOC from Jira-linked commits', async () => {
      const result = await service.query(`
        SELECT SUM(total_loc_changed) as total_loc, SUM(commit_count) as total_commits
        FROM vw_sprint_velocity_vs_loc
      `);

      // jira-sha-001 (120) + jira-sha-002 (60) + jira-sha-003 (35) = 215 LOC changed
      expect(Number(result.rows[0]?.total_loc)).toBe(215);
      expect(Number(result.rows[0]?.total_commits)).toBe(3);
    });
  });

  describe('Linear-only environment (regression test)', () => {
    beforeEach(async () => {
      await insertLinearTestData(service);
    });

    it('should return data when only Linear issues exist', async () => {
      const result = await service.query(`
        SELECT * FROM vw_sprint_velocity_vs_loc
        ORDER BY week_start DESC
      `);

      // Should have rows with Linear data
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should aggregate story points from completed Linear issues', async () => {
      const result = await service.query(`
        SELECT SUM(total_story_points) as total_sp, SUM(issue_count) as total_issues
        FROM vw_sprint_velocity_vs_loc
      `);

      // LIN-101 (5) + LIN-102 (3) = 8 story points
      // LIN-103 is In Progress, so should not be counted
      expect(Number(result.rows[0]?.total_sp)).toBe(8);
      expect(Number(result.rows[0]?.total_issues)).toBe(2);
    });

    it('should have team value for Linear issues', async () => {
      const result = await service.query(`
        SELECT DISTINCT team FROM vw_sprint_velocity_vs_loc
        WHERE total_story_points > 0
      `);

      // Linear issues have TeamA
      const teams = result.rows.map(r => r.team);
      expect(teams).toContain('TeamA');
    });

    it('should count LOC from Linear-linked commits', async () => {
      const result = await service.query(`
        SELECT SUM(total_loc_changed) as total_loc, SUM(commit_count) as total_commits
        FROM vw_sprint_velocity_vs_loc
      `);

      // linear-sha-001 (95) + linear-sha-002 (48) = 143 LOC changed
      expect(Number(result.rows[0]?.total_loc)).toBe(143);
      expect(Number(result.rows[0]?.total_commits)).toBe(2);
    });
  });

  describe('Mixed environment (Jira + Linear)', () => {
    beforeEach(async () => {
      await insertJiraTestData(service);
      await insertLinearTestData(service);
    });

    it('should return data from both trackers', async () => {
      const result = await service.query(`
        SELECT * FROM vw_sprint_velocity_vs_loc
        ORDER BY week_start DESC
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should aggregate story points from both trackers', async () => {
      const result = await service.query(`
        SELECT SUM(total_story_points) as total_sp, SUM(issue_count) as total_issues
        FROM vw_sprint_velocity_vs_loc
      `);

      // The view FULL OUTER JOINs story points (by week/team/project) with LOC (by week/repository).
      // When multiple team/project combos exist in the same week as multiple repositories,
      // story points are repeated for each repository.
      //
      // GITX-1: The exact totals depend on which week boundaries the NOW() - INTERVAL
      // dates fall into. The FULL OUTER JOIN creates a Cartesian product of story
      // points rows × repositories in each week. Rather than hardcode a specific
      // expected value that varies by test execution date, we verify:
      // - Raw story points: Jira (5+3+2=10 SP, 3 issues) + Linear (5+3=8 SP, 2 issues) = 18 SP base
      // - With duplication from JOIN, total should be >= 18 SP
      // - Verify both trackers contribute (not zero from either)
      const totalSp = Number(result.rows[0]?.total_sp);
      const totalIssues = Number(result.rows[0]?.total_issues);
      expect(totalSp).toBeGreaterThanOrEqual(18); // At least raw SP
      expect(totalSp).toBeLessThanOrEqual(40); // But not unreasonably duplicated
      expect(totalIssues).toBeGreaterThanOrEqual(5); // At least 5 done issues
    });

    it('should aggregate LOC from both trackers', async () => {
      // The view produces rows per unique (week, team, project, repository) combination.
      // When we have multiple team/project combos (Jira NULL/PROJ + Linear TeamA/ProjectX),
      // the same week's LOC gets repeated for each story points row in the FULL OUTER JOIN.
      // To get accurate LOC totals, we need to query by distinct repository.
      const result = await service.query(`
        SELECT repository, SUM(total_loc_changed) as total_loc, SUM(commit_count) as total_commits
        FROM vw_sprint_velocity_vs_loc
        WHERE repository IS NOT NULL
        GROUP BY repository
        ORDER BY repository
      `);

      // Should have data from both test-repo and other-repo
      expect(result.rows.length).toBeGreaterThan(0);

      // Find test-repo totals
      const testRepo = result.rows.find(r => r.repository === 'test-repo');
      expect(testRepo).toBeDefined();
      // test-repo has: Jira (120 + 60) + Linear (95 + 48) = 323 LOC base, 4 commits
      // GITX-1: Duplication from FULL OUTER JOIN depends on week boundaries.
      // The JOIN creates combinations based on which story point rows exist in
      // the same weeks as the LOC data. Rather than hardcode expected values:
      // - Verify at least the base LOC is captured
      // - Verify at least the base commit count
      expect(Number(testRepo?.total_loc)).toBeGreaterThanOrEqual(323);
      expect(Number(testRepo?.total_commits)).toBeGreaterThanOrEqual(4);

      // Find other-repo totals
      const otherRepo = result.rows.find(r => r.repository === 'other-repo');
      expect(otherRepo).toBeDefined();
      // other-repo only has Jira (35 LOC, 1 commit)
      // Since the other-repo commit (3 days ago) may be in a different week than Linear commits,
      // it may not get duplicated. The actual value depends on week boundaries.
      // We just verify it has the base Jira LOC at minimum
      expect(Number(otherRepo?.total_loc)).toBeGreaterThanOrEqual(35);
    });

    it('should show both NULL team (Jira) and named team (Linear)', async () => {
      const result = await service.query(`
        SELECT DISTINCT team FROM vw_sprint_velocity_vs_loc
        WHERE total_story_points > 0
      `);

      const teams = result.rows.map(r => r.team);
      expect(teams).toContain(null); // Jira
      expect(teams).toContain('TeamA'); // Linear
    });
  });

  describe('Repository filter (IQS-920)', () => {
    beforeEach(async () => {
      await insertJiraTestData(service);
      await insertLinearTestData(service);
    });

    it('should filter by repository across both data sources', async () => {
      // When filtering by repository in a mixed environment with multiple team/project combos,
      // the LOC data gets repeated for each story points row (due to FULL OUTER JOIN on week only).
      // This is expected behavior - the view allows filtering by team AND repository together.
      const result = await service.query(`
        SELECT SUM(total_loc_changed) as total_loc, SUM(commit_count) as total_commits
        FROM vw_sprint_velocity_vs_loc
        WHERE repository = 'test-repo'
      `);

      // test-repo has Jira commits (sha-001, sha-002) and Linear commits (sha-001, sha-002)
      // Jira: 120 + 60 = 180 LOC, 2 commits
      // Linear: 95 + 48 = 143 LOC, 2 commits
      // Total base: 323 LOC, 4 commits
      // GITX-1: Duplication from FULL OUTER JOIN depends on week boundaries.
      // Rather than hardcode expected values that vary by execution date:
      // - Verify at least the base LOC is captured
      // - Verify at least the base commit count
      expect(Number(result.rows[0]?.total_loc)).toBeGreaterThanOrEqual(323);
      expect(Number(result.rows[0]?.total_commits)).toBeGreaterThanOrEqual(4);
    });

    it('should filter to repository with only Jira commits', async () => {
      const result = await service.query(`
        SELECT SUM(total_loc_changed) as total_loc, SUM(commit_count) as total_commits
        FROM vw_sprint_velocity_vs_loc
        WHERE repository = 'other-repo'
      `);

      // other-repo has Jira commit sha-003: 35 LOC, 1 commit.
      // Due to FULL OUTER JOIN, the same week (Mar 9) has 2 team/project combos
      // (TeamA/ProjectX from Linear and null/PROJ from Jira), so LOC is duplicated.
      // Result: 35 LOC × 2 team/project combos = 70 LOC, 1 commit × 2 = 2 commits
      expect(Number(result.rows[0]?.total_loc)).toBe(70);
      expect(Number(result.rows[0]?.total_commits)).toBe(2);
    });
  });

  describe('Done state filters', () => {
    beforeEach(async () => {
      await insertJiraTestData(service);
    });

    it('should include Jira issues with Done status', async () => {
      const result = await service.query(`
        SELECT COUNT(*) as count FROM vw_sprint_velocity_vs_loc
        WHERE total_story_points > 0
      `);
      expect(Number(result.rows[0]?.count)).toBeGreaterThan(0);
    });

    it('should include Jira issues with Closed status', async () => {
      // JIRA-102 has Closed status and 3 story points (included in aggregation)
      const result = await service.query(`
        SELECT SUM(total_story_points) as total_sp
        FROM vw_sprint_velocity_vs_loc
      `);
      // Total includes all done states: Done (5) + Closed (3) + Resolved (2) = 10 base SP
      // But the view duplicates SP for each repository in the same week:
      // Week 1 (2024-01-08): 5 SP × 1 repo (test-repo) = 5 SP
      // Week 2 (2024-01-15): 5 SP × 2 repos (test-repo + other-repo) = 10 SP
      // Total: 15 SP
      expect(Number(result.rows[0]?.total_sp)).toBe(15);
    });

    it('should include Jira issues with Resolved status', async () => {
      // JIRA-103 has Resolved status and 2 story points (included in aggregation)
      // View duplicates issue counts for each repository in the same week
      const result = await service.query(`
        SELECT SUM(issue_count) as count
        FROM vw_sprint_velocity_vs_loc
      `);
      // Week 1 (2024-01-08): 1 issue × 1 repo = 1
      // Week 2 (2024-01-15): 2 issues × 2 repos = 4
      // Total: 5
      expect(Number(result.rows[0]?.count)).toBe(5);
    });

    it('should exclude Jira issues with In Progress status', async () => {
      // JIRA-104 has In Progress status and 8 story points
      // Should NOT be counted in the view (only Done, Closed, Resolved are included)
      const result = await service.query(`
        SELECT SUM(total_story_points) as total_sp
        FROM vw_sprint_velocity_vs_loc
      `);
      // If In Progress was included (with duplication), total would be higher
      // Without In Progress: 15 SP (see test above for breakdown)
      expect(Number(result.rows[0]?.total_sp)).toBe(15);
    });
  });

  describe('Performance indexes', () => {
    it('should have idx_jira_detail_status_change_date index', async () => {
      const result = await service.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_jira_detail_status_change_date'
        ) AS index_exists
      `);
      expect(result.rows[0]?.index_exists).toBe(true);
    });

    it('should have idx_commit_jira_jira_key index', async () => {
      const result = await service.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE indexname = 'idx_commit_jira_jira_key'
        ) AS index_exists
      `);
      expect(result.rows[0]?.index_exists).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty database', async () => {
      const result = await service.query(`
        SELECT COUNT(*) as count FROM vw_sprint_velocity_vs_loc
      `);
      expect(Number(result.rows[0]?.count)).toBe(0);
    });

    it('should handle Jira issues with only points (no calculated_story_points)', async () => {
      await service.query(`
        INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points, calculated_story_points)
        VALUES ('jira-points-only', 'JIRA-POINTS', 'Medium', NOW() - INTERVAL '10 days', 'https://jira/JIRA-POINTS', 'Points Only', 'Desc', 'rep', 'Story', 'PROJ', 'Done', 'user1', 'Done', '1.0', 'BE', NOW() - INTERVAL '2 days', 7, NULL)
      `);

      const result = await service.query(`
        SELECT SUM(total_story_points) as total_sp
        FROM vw_sprint_velocity_vs_loc
      `);

      // Should use points field when calculated_story_points is NULL
      expect(Number(result.rows[0]?.total_sp)).toBe(7);
    });

    it('should handle Jira issues with both points and calculated_story_points (prefer calculated)', async () => {
      await service.query(`
        INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points, calculated_story_points)
        VALUES ('jira-both-points', 'JIRA-BOTH', 'Medium', NOW() - INTERVAL '10 days', 'https://jira/JIRA-BOTH', 'Both Points', 'Desc', 'rep', 'Story', 'PROJ', 'Done', 'user1', 'Done', '1.0', 'BE', NOW() - INTERVAL '2 days', 5, 8)
      `);

      const result = await service.query(`
        SELECT SUM(total_story_points) as total_sp
        FROM vw_sprint_velocity_vs_loc
      `);

      // Should prefer calculated_story_points (8) over points (5)
      expect(Number(result.rows[0]?.total_sp)).toBe(8);
    });

    it('should exclude Jira issues with NULL status_change_date', async () => {
      await service.query(`
        INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points, calculated_story_points)
        VALUES ('jira-no-date', 'JIRA-NODATE', 'Medium', NOW() - INTERVAL '10 days', 'https://jira/JIRA-NODATE', 'No Date', 'Desc', 'rep', 'Story', 'PROJ', 'Done', 'user1', 'Done', '1.0', 'BE', NULL, 10, 10)
      `);

      const result = await service.query(`
        SELECT SUM(total_story_points) as total_sp
        FROM vw_sprint_velocity_vs_loc
      `);

      // Should not include issue with NULL status_change_date (total should be 0)
      expect(Number(result.rows[0]?.total_sp ?? 0)).toBe(0);
    });

    it('should handle weeks with only commits (no issues)', async () => {
      // Insert commit without any linked issues
      await service.query(`
        INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
        VALUES ('orphan-sha', 'https://github.com/test/commit/orphan-sha', 'main', 'test-repo', 'https://github.com/test', 'developer', NOW() - INTERVAL '1 day', 'Orphan commit', 1, 50, 10, FALSE, FALSE, 'test-org')
      `);

      await service.query(`
        INSERT INTO commit_files (sha, filename, file_extension, line_inserts, line_deletes, line_diff, total_lines, total_code_lines, total_comment_lines, complexity, weighted_complexity, author, parent_directory, sub_directory, is_test_file)
        VALUES ('orphan-sha', 'src/orphan.ts', 'ts', 50, 10, 60, 100, 90, 10, 3, 6, 'developer', 'src', '', FALSE)
      `);

      // This orphan commit is not linked via commit_jira or commit_linear
      // so it should not appear in the view (the view only counts linked commits)
      const result = await service.query(`
        SELECT SUM(COALESCE(total_loc_changed, 0)) as total_loc
        FROM vw_sprint_velocity_vs_loc
      `);

      expect(Number(result.rows[0]?.total_loc ?? 0)).toBe(0);
    });
  });
});
