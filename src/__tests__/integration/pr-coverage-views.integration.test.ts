/**
 * Integration tests for PR Coverage contributor/team views.
 * Tests database views vw_pr_coverage_by_contributor and vw_pr_coverage_by_team
 * against a real PostgreSQL instance using Testcontainers.
 *
 * Coverage:
 * - vw_pr_coverage_by_contributor: Groups by full_name with login fallback
 * - vw_pr_coverage_by_team: Groups by team name with contributor count
 * - Updated vw_pr_coverage: Includes contributor_name and team_name columns
 *
 * Ticket: GITX-223
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { vi } from 'vitest';
import { resolve } from 'path';
import { Pool } from 'pg';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { MigrationRunner } from '../../database/migration-runner.js';

const PG_DATABASE = 'gitrx_pr_coverage_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

const projectRoot = resolve(__dirname, '..', '..', '..');
const migrationsDir = resolve(projectRoot, 'docker', 'migrations');

let container: StartedTestContainer;
let pool: Pool;

describe('PR Coverage Views Integration Tests (GITX-223)', () => {
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

    pool = new Pool({
      host,
      port: mappedPort,
      database: PG_DATABASE,
      user: PG_USER,
      password: PG_PASSWORD,
      max: 5,
    });

    // Verify connectivity
    const result = await pool.query('SELECT 1 AS health');
    expect(result.rows[0]?.health).toBe(1);
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  }, 30_000);

  beforeEach(async () => {
    // Reset logger
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Drop all tables to start fresh for each test
    const client = await pool.connect();
    try {
      await client.query('DROP SCHEMA public CASCADE');
      await client.query('CREATE SCHEMA public');
      await client.query('GRANT ALL ON SCHEMA public TO PUBLIC');
    } finally {
      client.release();
    }
  });

  describe('vw_pr_coverage_by_contributor view', () => {
    it('should group by full_name when available', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      if (!migrationResult.success) {
        console.error('Migration failed:', migrationResult.error);
      }
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert commit_contributors with full_name
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email)
        VALUES
          ('alice', 'Alice Johnson', 'alice@example.com'),
          ('bob', 'Bob Smith', 'bob@example.com')
      `);

      // Insert commits for these contributors
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha1', 'repo1', 'main', 'alice', '2024-01-15', 'Fix bug', false, 'TestOrg', 10, 5, 2),
          ('sha2', 'repo1', 'main', 'alice', '2024-01-16', 'Add feature', false, 'TestOrg', 20, 3, 3),
          ('sha3', 'repo1', 'main', 'bob', '2024-01-17', 'Update docs', false, 'TestOrg', 5, 2, 1)
      `);

      // Query vw_pr_coverage_by_contributor
      const result = await pool.query(`
        SELECT contributor_name, login, total_commits, coverage_percentage
        FROM vw_pr_coverage_by_contributor
        ORDER BY contributor_name
      `);

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({
        contributor_name: 'Alice Johnson',
        login: 'alice',
        total_commits: expect.any(String),
      });
      expect(result.rows[1]).toMatchObject({
        contributor_name: 'Bob Smith',
        login: 'bob',
        total_commits: '1',
      });
    });

    it('should fallback to login when full_name is NULL', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert commit_contributors with NULL full_name
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email)
        VALUES ('charlie', NULL, 'charlie@example.com')
      `);

      // Insert commits
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha10', 'repo1', 'main', 'charlie', '2024-01-20', 'Commit by charlie', false, 'TestOrg', 10, 5, 2)
      `);

      // Query view
      const result = await pool.query(`
        SELECT contributor_name, login
        FROM vw_pr_coverage_by_contributor
        WHERE login = 'charlie'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        contributor_name: 'charlie',
        login: 'charlie',
      });
    });

    it('should fallback to commit author when contributor not in commit_contributors', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert commits for unknown author (not in commit_contributors)
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha20', 'repo1', 'main', 'unknown', '2024-01-25', 'Random commit', false, 'TestOrg', 5, 2, 1)
      `);

      // Query view
      const result = await pool.query(`
        SELECT contributor_name, login
        FROM vw_pr_coverage_by_contributor
        WHERE login = 'unknown'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        contributor_name: 'unknown',
        login: 'unknown',
      });
    });

    it('should include login column for reference', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert commit_contributors
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email)
        VALUES ('dev1', 'Developer One', 'dev1@example.com')
      `);

      // Insert commits
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha30', 'repo1', 'main', 'dev1', '2024-02-01', 'Test', false, 'TestOrg', 1, 1, 1)
      `);

      // Query view columns
      const result = await pool.query(`
        SELECT contributor_name, login
        FROM vw_pr_coverage_by_contributor
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toHaveProperty('contributor_name');
      expect(result.rows[0]).toHaveProperty('login');
      expect(result.rows[0]?.contributor_name).toBe('Developer One');
      expect(result.rows[0]?.login).toBe('dev1');
    });

    it('should calculate coverage percentage correctly', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert commit_contributors
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email)
        VALUES ('testdev', 'Test Developer', 'test@example.com')
      `);

      // Insert commits (mix of PR-linked and orphan)
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha40', 'repo1', 'main', 'testdev', '2024-02-10', 'PR commit 1', false, 'TestOrg', 10, 5, 2),
          ('sha41', 'repo1', 'main', 'testdev', '2024-02-11', 'PR commit 2', false, 'TestOrg', 20, 3, 3),
          ('sha42', 'repo1', 'main', 'testdev', '2024-02-12', 'Orphan commit', false, 'TestOrg', 5, 2, 1),
          ('sha43', 'repo1', 'main', 'testdev', '2024-02-13', 'Orphan commit 2', false, 'TestOrg', 3, 1, 1)
      `);

      // Insert pull requests
      await pool.query(`
        INSERT INTO pull_request (
          id, repository, pr_number, title, author, state, created_at, updated_at, merged_at
        )
        VALUES
          (1, 'repo1', 100, 'PR 100', 'testdev', 'merged', '2024-02-10', '2024-02-10', '2024-02-10'),
          (2, 'repo1', 101, 'PR 101', 'testdev', 'merged', '2024-02-11', '2024-02-11', '2024-02-11')
      `);

      // Link commits to PRs
      await pool.query(`
        INSERT INTO commit_pull_request (sha, pull_request_id, repository, link_source, created_at)
        VALUES
          ('sha40', 1, 'repo1', 'merge_sha', NOW()),
          ('sha41', 2, 'repo1', 'merge_sha', NOW())
      `);

      // Query view
      const result = await pool.query(`
        SELECT
          contributor_name,
          total_commits,
          pr_linked_commits,
          orphan_commits,
          coverage_percentage
        FROM vw_pr_coverage_by_contributor
        WHERE login = 'testdev'
      `);

      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row?.total_commits).toBe('4');
      expect(row?.pr_linked_commits).toBe('2');
      expect(row?.orphan_commits).toBe('2');
      expect(row?.coverage_percentage).toBe('50.00'); // 2/4 * 100 = 50%
    });
  });

  describe('vw_pr_coverage_by_team view', () => {
    it('should group by team name from teams table', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert teams
      await pool.query(`
        INSERT INTO teams (id, name, organization_id)
        VALUES
          (1, 'Backend Team', 1),
          (2, 'Frontend Team', 1)
      `);

      // Insert commit_contributors with team_id
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email, team_id)
        VALUES
          ('alice', 'Alice Johnson', 'alice@example.com', 1),
          ('bob', 'Bob Smith', 'bob@example.com', 1),
          ('charlie', 'Charlie Brown', 'charlie@example.com', 2)
      `);

      // Insert commits
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha50', 'repo1', 'main', 'alice', '2024-03-01', 'Backend work', false, 'TestOrg', 10, 5, 2),
          ('sha51', 'repo1', 'main', 'bob', '2024-03-02', 'Backend work', false, 'TestOrg', 20, 3, 3),
          ('sha52', 'repo1', 'main', 'charlie', '2024-03-03', 'Frontend work', false, 'TestOrg', 5, 2, 1)
      `);

      // Query view
      const result = await pool.query(`
        SELECT team_name, contributor_count, total_commits
        FROM vw_pr_coverage_by_team
        ORDER BY team_name
      `);

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({
        team_name: 'Backend Team',
        contributor_count: '2',
        total_commits: expect.any(String),
      });
      expect(result.rows[1]).toMatchObject({
        team_name: 'Frontend Team',
        contributor_count: '1',
        total_commits: '1',
      });
    });

    it('should exclude teams with zero commits (HAVING filter)', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert teams
      await pool.query(`
        INSERT INTO teams (id, name, organization_id)
        VALUES
          (1, 'Active Team', 1),
          (2, 'Inactive Team', 1)
      `);

      // Insert commit_contributors (team 2 has no commits)
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email, team_id)
        VALUES
          ('alice', 'Alice', 'alice@example.com', 1),
          ('bob', 'Bob', 'bob@example.com', 2)
      `);

      // Insert commits only for team 1
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha60', 'repo1', 'main', 'alice', '2024-03-10', 'Work', false, 'TestOrg', 10, 5, 2)
      `);

      // Query view
      const result = await pool.query(`
        SELECT team_name
        FROM vw_pr_coverage_by_team
      `);

      // Only Active Team should appear
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.team_name).toBe('Active Team');
    });

    it('should count contributors per team', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert teams
      await pool.query(`
        INSERT INTO teams (id, name, organization_id)
        VALUES (1, 'Engineering Team', 1)
      `);

      // Insert commit_contributors with multiple members in same team
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email, team_id)
        VALUES
          ('dev1', 'Developer One', 'dev1@example.com', 1),
          ('dev2', 'Developer Two', 'dev2@example.com', 1),
          ('dev3', 'Developer Three', 'dev3@example.com', 1)
      `);

      // Insert commits from each contributor
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha70', 'repo1', 'main', 'dev1', '2024-03-15', 'Work', false, 'TestOrg', 10, 5, 2),
          ('sha71', 'repo1', 'main', 'dev2', '2024-03-16', 'Work', false, 'TestOrg', 20, 3, 3),
          ('sha72', 'repo1', 'main', 'dev3', '2024-03-17', 'Work', false, 'TestOrg', 5, 2, 1)
      `);

      // Query view
      const result = await pool.query(`
        SELECT team_name, contributor_count
        FROM vw_pr_coverage_by_team
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.contributor_count).toBe('3');
    });

    it('should group NULL team as "Unassigned"', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert commit_contributors with NULL team_id and NULL team
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email, team_id, team)
        VALUES ('freelancer', 'Freelancer Dev', 'free@example.com', NULL, NULL)
      `);

      // Insert commits
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha80', 'repo1', 'main', 'freelancer', '2024-03-20', 'Independent work', false, 'TestOrg', 10, 5, 2)
      `);

      // Query view
      const result = await pool.query(`
        SELECT team_name
        FROM vw_pr_coverage_by_team
        WHERE team_name = 'Unassigned'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.team_name).toBe('Unassigned');
    });

    it('should calculate team coverage percentage correctly', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert teams
      await pool.query(`
        INSERT INTO teams (id, name, organization_id)
        VALUES (1, 'QA Team', 1)
      `);

      // Insert commit_contributors
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email, team_id)
        VALUES
          ('qa1', 'QA One', 'qa1@example.com', 1),
          ('qa2', 'QA Two', 'qa2@example.com', 1)
      `);

      // Insert commits (mix of PR-linked and orphan)
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha90', 'repo1', 'main', 'qa1', '2024-04-01', 'PR commit', false, 'TestOrg', 10, 5, 2),
          ('sha91', 'repo1', 'main', 'qa1', '2024-04-02', 'Orphan commit', false, 'TestOrg', 5, 2, 1),
          ('sha92', 'repo1', 'main', 'qa2', '2024-04-03', 'PR commit', false, 'TestOrg', 20, 3, 3),
          ('sha93', 'repo1', 'main', 'qa2', '2024-04-04', 'PR commit', false, 'TestOrg', 15, 4, 2)
      `);

      // Insert pull requests
      await pool.query(`
        INSERT INTO pull_request (
          id, repository, pr_number, title, author, state, created_at, updated_at, merged_at
        )
        VALUES
          (10, 'repo1', 200, 'PR 200', 'qa1', 'merged', '2024-04-01', '2024-04-01', '2024-04-01'),
          (11, 'repo1', 201, 'PR 201', 'qa2', 'merged', '2024-04-03', '2024-04-03', '2024-04-03'),
          (12, 'repo1', 202, 'PR 202', 'qa2', 'merged', '2024-04-04', '2024-04-04', '2024-04-04')
      `);

      // Link commits to PRs
      await pool.query(`
        INSERT INTO commit_pull_request (sha, pull_request_id, repository, link_source, created_at)
        VALUES
          ('sha90', 10, 'repo1', 'merge_sha', NOW()),
          ('sha92', 11, 'repo1', 'merge_sha', NOW()),
          ('sha93', 12, 'repo1', 'merge_sha', NOW())
      `);

      // Query view
      const result = await pool.query(`
        SELECT
          team_name,
          total_commits,
          pr_linked_commits,
          orphan_commits,
          coverage_percentage
        FROM vw_pr_coverage_by_team
        WHERE team_name = 'QA Team'
      `);

      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row?.total_commits).toBe('4');
      expect(row?.pr_linked_commits).toBe('3');
      expect(row?.orphan_commits).toBe('1');
      expect(row?.coverage_percentage).toBe('75.00'); // 3/4 * 100 = 75%
    });
  });

  describe('updated vw_pr_coverage view', () => {
    it('should include contributor_name column', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert commit_contributors
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email)
        VALUES ('testuser', 'Test User', 'test@example.com')
      `);

      // Insert commits
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha100', 'repo1', 'main', 'testuser', '2024-05-01', 'Test commit', false, 'TestOrg', 10, 5, 2)
      `);

      // Query vw_pr_coverage
      const result = await pool.query(`
        SELECT contributor_name, author
        FROM vw_pr_coverage
        WHERE sha = 'sha100'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        contributor_name: 'Test User',
        author: 'testuser',
      });
    });

    it('should include team_name column', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert teams
      await pool.query(`
        INSERT INTO teams (id, name, organization_id)
        VALUES (1, 'Data Team', 1)
      `);

      // Insert commit_contributors
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email, team_id)
        VALUES ('datadev', 'Data Developer', 'data@example.com', 1)
      `);

      // Insert commits
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha110', 'repo1', 'main', 'datadev', '2024-05-05', 'Data work', false, 'TestOrg', 10, 5, 2)
      `);

      // Query vw_pr_coverage
      const result = await pool.query(`
        SELECT team_name, author
        FROM vw_pr_coverage
        WHERE sha = 'sha110'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        team_name: 'Data Team',
        author: 'datadev',
      });
    });

    it('should fallback team_name to commit_contributors.team when team_id is NULL', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert commit_contributors with legacy team field but NULL team_id
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email, team_id, team)
        VALUES ('legacydev', 'Legacy Developer', 'legacy@example.com', NULL, 'Legacy Team')
      `);

      // Insert commits
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha120', 'repo1', 'main', 'legacydev', '2024-05-10', 'Legacy work', false, 'TestOrg', 10, 5, 2)
      `);

      // Query vw_pr_coverage
      const result = await pool.query(`
        SELECT team_name, author
        FROM vw_pr_coverage
        WHERE sha = 'sha120'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        team_name: 'Legacy Team',
        author: 'legacydev',
      });
    });
  });

  describe('edge cases and data validation', () => {
    it('should handle large result sets with LIMIT', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert many contributors
      const contributors = Array.from({ length: 100 }, (_, i) => `('dev${i}', 'Developer ${i}', 'dev${i}@example.com')`).join(',');
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email)
        VALUES ${contributors}
      `);

      // Insert commits for each
      const commits = Array.from({ length: 100 }, (_, i) => `('sha${i}', 'repo1', 'main', 'dev${i}', '2024-06-01', 'Commit ${i}', false, 'TestOrg', 10, 5, 2)`).join(',');
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES ${commits}
      `);

      // Query view - the view itself has ORDER BY but no LIMIT in the view definition
      // The LIMIT is applied in the application query
      const result = await pool.query(`
        SELECT COUNT(*) as total
        FROM vw_pr_coverage_by_contributor
      `);

      expect(Number(result.rows[0]?.total)).toBeGreaterThan(0);
    });

    it('should exclude merge commits from contributor totals', async () => {
      const runner = new MigrationRunner(pool, migrationsDir);
      const migrationResult = await runner.migrate();
      expect(migrationResult.success).toBe(true);

      // Insert organizations
      await pool.query(`
        INSERT INTO organizations (id, name)
        VALUES (1, 'TestOrg')
      `);

      // Insert commit_contributors
      await pool.query(`
        INSERT INTO commit_contributors (login, full_name, email)
        VALUES ('merger', 'Merge Master', 'merge@example.com')
      `);

      // Insert commits including merge commits
      await pool.query(`
        INSERT INTO commit_history (
          sha, repository, branch, author, commit_date, commit_message,
          is_merge, organization, lines_added, lines_removed, file_count
          
        )
        VALUES
          ('sha200', 'repo1', 'main', 'merger', '2024-07-01', 'Normal commit', false, 'TestOrg', 10, 5, 2),
          ('sha201', 'repo1', 'main', 'merger', '2024-07-02', 'Merge pull request', true, 'TestOrg', 0, 0, 0),
          ('sha202', 'repo1', 'main', 'merger', '2024-07-03', 'Another normal', false, 'TestOrg', 15, 3, 1)
      `);

      // Query view
      const result = await pool.query(`
        SELECT total_commits
        FROM vw_pr_coverage_by_contributor
        WHERE login = 'merger'
      `);

      expect(result.rows).toHaveLength(1);
      // Should only count non-merge commits
      expect(result.rows[0]?.total_commits).toBe('2');
    });
  });
});
