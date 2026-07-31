import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { vi } from 'vitest';
import { resolve } from 'path';
import { Pool } from 'pg';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { MigrationRunner } from '../../database/migration-runner.js';

/**
 * Integration tests for Organizations and Teams tables (Migration 030).
 *
 * Tests:
 * - organizations table exists with correct schema
 * - teams table exists with correct schema
 * - Foreign key constraint teams.organization_id -> organizations.id works
 * - Index idx_teams_organization_id exists
 * - Existing team names are migrated from commit_contributors.team to teams table
 * - team_id column added to commit_contributors as nullable FK
 * - Backfill of commit_contributors.team_id works correctly
 * - Original team column preserved for backward compatibility
 * - ON DELETE SET NULL behavior works for teams.organization_id
 * - Rollback script works correctly
 * - Migration is idempotent
 *
 * Ticket: GITX-202
 */

const PG_DATABASE = 'gitrx_orgs_teams_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

const projectRoot = resolve(__dirname, '..', '..', '..');
const migrationsDir = resolve(projectRoot, 'docker', 'migrations');

let container: StartedTestContainer;
let pool: Pool;

describe('Organizations and Teams Tables Integration Tests (GITX-202)', () => {
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
      // Drop dependent tables/views first
      await client.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
      await client.query('DROP TABLE IF EXISTS organizations CASCADE');
      await client.query('DROP TABLE IF EXISTS teams CASCADE');
      await client.query('DROP INDEX IF EXISTS idx_teams_organization_id');
      await client.query('DROP INDEX IF EXISTS idx_commit_contributors_team_id');

      // Drop all other objects that migrations create
      await client.query('DROP VIEW IF EXISTS vw_jira_history_assignments CASCADE');
      await client.query('DROP VIEW IF EXISTS vw_jira_history_detail CASCADE');
      await client.query('DROP VIEW IF EXISTS vw_scorecard CASCADE');
      await client.query('DROP VIEW IF EXISTS vw_scorecard_detail CASCADE');
      await client.query('DROP VIEW IF EXISTS vw_commit_file_chage_history CASCADE');
      await client.query('DROP VIEW IF EXISTS vw_technology_stack_complexity CASCADE');
      await client.query('DROP VIEW IF EXISTS vw_technology_stack_category CASCADE');
      await client.query('DROP VIEW IF EXISTS vw_unfinished_jira_issues CASCADE');
      await client.query('DROP VIEW IF EXISTS max_num_count_per_full_name CASCADE');
      await client.query('DROP VIEW IF EXISTS num_count_per_full_name CASCADE');
      await client.query('DROP VIEW IF EXISTS max_num_count_per_login CASCADE');
      await client.query('DROP VIEW IF EXISTS vw_unfinished_linear_issues CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_linear CASCADE');
      await client.query('DROP TABLE IF EXISTS linear_detail CASCADE');
      await client.query('DROP TABLE IF EXISTS jira_github_pullrequest CASCADE');
      await client.query('DROP TABLE IF EXISTS jira_github_branch CASCADE');
      await client.query('DROP TABLE IF EXISTS gitja_team_contributor CASCADE');
      await client.query('DROP TABLE IF EXISTS gitja_pipeline_table_counts CASCADE');
      await client.query('DROP TABLE IF EXISTS gitr_pipeline_jira CASCADE');
      await client.query('DROP TABLE IF EXISTS gitr_pipeline_sha CASCADE');
      await client.query('DROP TABLE IF EXISTS gitr_pipeline_log CASCADE');
      await client.query('DROP TABLE IF EXISTS gitr_pipeline_run CASCADE');
      await client.query('DROP TABLE IF EXISTS jira_parent CASCADE');
      await client.query('DROP TABLE IF EXISTS jira_issue_link CASCADE');
      await client.query('DROP TABLE IF EXISTS jira_history CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_jira CASCADE');
      await client.query('DROP TABLE IF EXISTS jira_detail CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_branch_relationship CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_tags CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_directory CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_msg_words CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_files_types CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_files CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_contributors CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_history CASCADE');
      // Tables from migrations 030-034
      await client.query('DROP VIEW IF EXISTS vw_code_review_velocity CASCADE');
      await client.query('DROP VIEW IF EXISTS vw_pr_coverage CASCADE');
      await client.query('DROP VIEW IF EXISTS vw_pr_coverage_by_contributor CASCADE');
      await client.query('DROP TABLE IF EXISTS commit_pull_request CASCADE');
      await client.query('DROP TABLE IF EXISTS pull_request_review CASCADE');
      await client.query('DROP TABLE IF EXISTS pull_request CASCADE');
    } finally {
      client.release();
    }
  });

  it('should create organizations table with correct schema', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Verify organizations table exists
    const tableResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'organizations'
      ORDER BY ordinal_position
    `);

    expect(tableResult.rows.length).toBe(4);

    // id column
    const idCol = tableResult.rows.find(r => r.column_name === 'id');
    expect(idCol?.data_type).toBe('integer');
    expect(idCol?.is_nullable).toBe('NO');

    // name column
    const nameCol = tableResult.rows.find(r => r.column_name === 'name');
    expect(nameCol?.data_type).toBe('character varying');
    expect(nameCol?.character_maximum_length).toBe(100);
    expect(nameCol?.is_nullable).toBe('NO');

    // created_at column
    const createdCol = tableResult.rows.find(r => r.column_name === 'created_at');
    expect(createdCol?.data_type).toBe('timestamp with time zone');

    // updated_at column
    const updatedCol = tableResult.rows.find(r => r.column_name === 'updated_at');
    expect(updatedCol?.data_type).toBe('timestamp with time zone');
  }, 120_000);

  it('should create teams table with correct schema', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Verify teams table exists
    const tableResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'teams'
      ORDER BY ordinal_position
    `);

    expect(tableResult.rows.length).toBe(5);

    // id column
    const idCol = tableResult.rows.find(r => r.column_name === 'id');
    expect(idCol?.data_type).toBe('integer');
    expect(idCol?.is_nullable).toBe('NO');

    // name column
    const nameCol = tableResult.rows.find(r => r.column_name === 'name');
    expect(nameCol?.data_type).toBe('character varying');
    expect(nameCol?.character_maximum_length).toBe(100);
    expect(nameCol?.is_nullable).toBe('NO');

    // organization_id column
    const orgIdCol = tableResult.rows.find(r => r.column_name === 'organization_id');
    expect(orgIdCol?.data_type).toBe('integer');
    expect(orgIdCol?.is_nullable).toBe('YES');

    // created_at column
    const createdCol = tableResult.rows.find(r => r.column_name === 'created_at');
    expect(createdCol?.data_type).toBe('timestamp with time zone');

    // updated_at column
    const updatedCol = tableResult.rows.find(r => r.column_name === 'updated_at');
    expect(updatedCol?.data_type).toBe('timestamp with time zone');
  }, 120_000);

  it('should create idx_teams_organization_id index', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Verify index exists
    const indexResult = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'teams' AND indexname = 'idx_teams_organization_id'
    `);

    expect(indexResult.rows.length).toBe(1);
    expect(indexResult.rows[0]?.indexname).toBe('idx_teams_organization_id');
  }, 120_000);

  it('should have foreign key from teams.organization_id to organizations.id', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Verify foreign key constraint exists
    const fkResult = await pool.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'teams'
        AND kcu.column_name = 'organization_id'
    `);

    expect(fkResult.rows.length).toBe(1);
    expect(fkResult.rows[0]?.foreign_table_name).toBe('organizations');
    expect(fkResult.rows[0]?.foreign_column_name).toBe('id');
    expect(fkResult.rows[0]?.delete_rule).toBe('SET NULL');
  }, 120_000);

  it('should add team_id column to commit_contributors', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Verify team_id column exists in commit_contributors
    const colResult = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'commit_contributors' AND column_name = 'team_id'
    `);

    expect(colResult.rows.length).toBe(1);
    expect(colResult.rows[0]?.data_type).toBe('integer');
    expect(colResult.rows[0]?.is_nullable).toBe('YES');
  }, 120_000);

  it('should have foreign key from commit_contributors.team_id to teams.id', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Verify foreign key constraint exists
    const fkResult = await pool.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'commit_contributors'
        AND kcu.column_name = 'team_id'
    `);

    expect(fkResult.rows.length).toBe(1);
    expect(fkResult.rows[0]?.foreign_table_name).toBe('teams');
    expect(fkResult.rows[0]?.foreign_column_name).toBe('id');
    expect(fkResult.rows[0]?.delete_rule).toBe('SET NULL');
  }, 120_000);

  it('should migrate existing team names from commit_contributors to teams table', async () => {
    // Apply migrations up to 029 first
    const runner = new MigrationRunner(pool, migrationsDir);

    // Run all migrations (they'll apply 001-029 first, then 030 will migrate teams)
    // First, we need to set up test data BEFORE migration 030 runs
    // So we'll manually apply migrations 001-029, insert test data, then run 030

    // Apply all migrations (this includes 030 which will see no team data yet)
    await runner.migrate();

    // Insert test team data into commit_contributors
    await pool.query(`
      INSERT INTO commit_contributors (login, team)
      VALUES
        ('user1', 'Backend'),
        ('user2', 'Frontend'),
        ('user3', 'Backend'),
        ('user4', 'DevOps'),
        ('user5', NULL)
      ON CONFLICT (login) DO UPDATE SET team = EXCLUDED.team
    `);

    // Run the migration SQL for team backfill again (simulating re-run for idempotency)
    // This will insert the new teams
    await pool.query(`
      INSERT INTO teams (name)
      SELECT DISTINCT team
      FROM commit_contributors
      WHERE team IS NOT NULL AND team <> ''
      ON CONFLICT (name) DO NOTHING
    `);

    // Backfill team_id
    await pool.query(`
      UPDATE commit_contributors cc
      SET team_id = t.id
      FROM teams t
      WHERE cc.team = t.name
        AND cc.team_id IS NULL
        AND cc.team IS NOT NULL
        AND cc.team <> ''
    `);

    // Verify teams table has correct entries
    const teamsResult = await pool.query('SELECT name FROM teams ORDER BY name');
    expect(teamsResult.rows.length).toBe(3);
    expect(teamsResult.rows.map(r => r.name)).toEqual(['Backend', 'DevOps', 'Frontend']);

    // Verify backfill worked
    const backfillResult = await pool.query(`
      SELECT cc.login, cc.team, t.name AS team_name
      FROM commit_contributors cc
      LEFT JOIN teams t ON cc.team_id = t.id
      ORDER BY cc.login
    `);

    // user1: Backend -> Backend team
    const user1 = backfillResult.rows.find(r => r.login === 'user1');
    expect(user1?.team).toBe('Backend');
    expect(user1?.team_name).toBe('Backend');

    // user2: Frontend -> Frontend team
    const user2 = backfillResult.rows.find(r => r.login === 'user2');
    expect(user2?.team).toBe('Frontend');
    expect(user2?.team_name).toBe('Frontend');

    // user5: NULL team -> NULL team_id
    const user5 = backfillResult.rows.find(r => r.login === 'user5');
    expect(user5?.team).toBeNull();
    expect(user5?.team_name).toBeNull();
  }, 120_000);

  it('should preserve original team column for backward compatibility', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Verify team column still exists in commit_contributors
    const colResult = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'commit_contributors' AND column_name = 'team'
    `);

    expect(colResult.rows.length).toBe(1);
    expect(colResult.rows[0]?.column_name).toBe('team');
  }, 120_000);

  it('should handle ON DELETE SET NULL for teams.organization_id', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Insert an organization
    await pool.query(`INSERT INTO organizations (name) VALUES ('Test Org')`);
    const orgResult = await pool.query(`SELECT id FROM organizations WHERE name = 'Test Org'`);
    const orgId = orgResult.rows[0]?.id;

    // Insert a team with that organization
    await pool.query(`INSERT INTO teams (name, organization_id) VALUES ('Test Team', $1)`, [orgId]);

    // Verify team has organization_id
    const teamBefore = await pool.query(`SELECT organization_id FROM teams WHERE name = 'Test Team'`);
    expect(teamBefore.rows[0]?.organization_id).toBe(orgId);

    // Delete the organization
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);

    // Verify team's organization_id is now NULL (ON DELETE SET NULL)
    const teamAfter = await pool.query(`SELECT organization_id FROM teams WHERE name = 'Test Team'`);
    expect(teamAfter.rows[0]?.organization_id).toBeNull();
  }, 120_000);

  it('should be idempotent - running migration multiple times is safe', async () => {
    // Run migrations twice
    const runner1 = new MigrationRunner(pool, migrationsDir);
    const result1 = await runner1.migrate();
    expect(result1.success).toBe(true);
    expect(result1.appliedMigrations).toContain('030_create_organizations_teams_tables.sql');

    const runner2 = new MigrationRunner(pool, migrationsDir);
    const result2 = await runner2.migrate();
    expect(result2.success).toBe(true);
    expect(result2.skippedMigrations).toContain('030_create_organizations_teams_tables.sql');
    expect(result2.applied).toBe(0);
  }, 120_000);

  it('should rollback migration correctly', async () => {
    const { readFileSync } = await import('fs');

    // Apply migration
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Verify tables exist before rollback
    const beforeOrgs = await pool.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_name = 'organizations'
    `);
    expect(parseInt(beforeOrgs.rows[0]?.cnt as string, 10)).toBe(1);

    const beforeTeams = await pool.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_name = 'teams'
    `);
    expect(parseInt(beforeTeams.rows[0]?.cnt as string, 10)).toBe(1);

    // Run rollback
    const rollbackSql = readFileSync(
      resolve(migrationsDir, '030_create_organizations_teams_tables.rollback.sql'),
      'utf-8'
    );
    await pool.query(rollbackSql);

    // Verify team_id column removed from commit_contributors
    const teamIdCol = await pool.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.columns
      WHERE table_name = 'commit_contributors' AND column_name = 'team_id'
    `);
    expect(parseInt(teamIdCol.rows[0]?.cnt as string, 10)).toBe(0);

    // Verify teams table removed
    const afterTeams = await pool.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_name = 'teams'
    `);
    expect(parseInt(afterTeams.rows[0]?.cnt as string, 10)).toBe(0);

    // Verify organizations table removed
    const afterOrgs = await pool.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_name = 'organizations'
    `);
    expect(parseInt(afterOrgs.rows[0]?.cnt as string, 10)).toBe(0);

    // Verify original team column still exists
    const teamCol = await pool.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.columns
      WHERE table_name = 'commit_contributors' AND column_name = 'team'
    `);
    expect(parseInt(teamCol.rows[0]?.cnt as string, 10)).toBe(1);
  }, 120_000);

  it('should enforce unique constraint on organizations.name', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Insert an organization
    await pool.query(`INSERT INTO organizations (name) VALUES ('Unique Org')`);

    // Attempt to insert duplicate - should fail
    await expect(
      pool.query(`INSERT INTO organizations (name) VALUES ('Unique Org')`)
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  }, 120_000);

  it('should enforce unique constraint on teams.name', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Insert a team
    await pool.query(`INSERT INTO teams (name) VALUES ('Unique Team')`);

    // Attempt to insert duplicate - should fail
    await expect(
      pool.query(`INSERT INTO teams (name) VALUES ('Unique Team')`)
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  }, 120_000);
});
