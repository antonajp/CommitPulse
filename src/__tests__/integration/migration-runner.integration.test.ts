import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { vi } from 'vitest';
import { resolve } from 'path';
import { Pool } from 'pg';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { MigrationRunner, type MigrationResult } from '../../database/migration-runner.js';

/**
 * Integration tests for MigrationRunner with a real PostgreSQL container.
 *
 * Tests auto-migration scenarios:
 * - Fresh database gets all migrations applied
 * - Partially migrated database gets only pending migrations
 * - Fully migrated database triggers no migration execution (idempotent)
 * - Failed migration rolls back cleanly
 * - Docker init script compatibility (Docker-applied migrations skipped by TS runner)
 * - Advisory locking prevents concurrent corruption
 *
 * Ticket: IQS-879
 */

const PG_DATABASE = 'gitrx_migration_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

const projectRoot = resolve(__dirname, '..', '..', '..');
const migrationsDir = resolve(projectRoot, 'docker', 'migrations');

let container: StartedTestContainer;
let pool: Pool;

describe('MigrationRunner Integration Tests', () => {
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

    // Drop schema_migrations and all objects to start fresh
    const client = await pool.connect();
    try {
      await client.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
      // Drop all known tables/views that migrations create, so each test starts clean
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
    } finally {
      client.release();
    }
  });

  it('should apply all migrations to a fresh database', async () => {
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();

    expect(result.success).toBe(true);
    expect(result.applied).toBeGreaterThanOrEqual(4);
    expect(result.skipped).toBe(0);
    expect(result.appliedMigrations).toContain('001_create_tables.sql');
    expect(result.appliedMigrations).toContain('002_create_views.sql');
    expect(result.appliedMigrations).toContain('003_seed_data.sql');
    expect(result.appliedMigrations).toContain('004_add_linear_support.sql');

    // Verify schema_migrations table was created and populated
    const migrationRows = await pool.query(
      'SELECT version, filename FROM schema_migrations ORDER BY version ASC'
    );
    expect(migrationRows.rows.length).toBeGreaterThanOrEqual(4);
    expect(migrationRows.rows[0]?.version).toBe('001');
    expect(migrationRows.rows[1]?.version).toBe('002');
    expect(migrationRows.rows[2]?.version).toBe('003');
    expect(migrationRows.rows[3]?.version).toBe('004');
  }, 30_000);

  it('should apply only pending migrations to a partially migrated database', async () => {
    // First, manually apply only migration 001-003 by running the runner
    const firstRunner = new MigrationRunner(pool, migrationsDir);
    const firstResult = await firstRunner.migrate();
    expect(firstResult.success).toBe(true);

    // Now simulate "partial" by removing migration 004 from schema_migrations
    // (as if it was never applied - simulates a DB that was created before 004 existed)
    await pool.query('DELETE FROM schema_migrations WHERE version = $1', ['004']);

    // Drop the tables that 004 creates so the migration actually has work to do
    await pool.query('DROP TABLE IF EXISTS commit_linear CASCADE');
    await pool.query('DROP TABLE IF EXISTS linear_detail CASCADE');
    // Also need to drop view that depends on linear_detail
    await pool.query('DROP VIEW IF EXISTS vw_unfinished_linear_issues CASCADE');

    // Also remove migration 005 record so it becomes pending too.
    // Drop the column it adds from jira_detail (linear_detail was already dropped above).
    await pool.query('DELETE FROM schema_migrations WHERE version = $1', ['005']);
    await pool.query('ALTER TABLE jira_detail DROP COLUMN IF EXISTS calculated_story_points');

    // Also remove migration 021 record so it becomes pending too.
    // Drop the views FIRST (they depend on arc_component column from 006).
    await pool.query('DELETE FROM schema_migrations WHERE version = $1', ['021']);
    await pool.query('DROP VIEW IF EXISTS vw_component_pair_coupling CASCADE');
    await pool.query('DROP VIEW IF EXISTS vw_architecture_drift_weekly CASCADE');
    await pool.query('DROP VIEW IF EXISTS vw_architecture_drift CASCADE');
    await pool.query('DROP VIEW IF EXISTS vw_cross_component_commits CASCADE');
    await pool.query('DROP VIEW IF EXISTS vw_component_changes CASCADE');

    // Also remove migration 007 record so it becomes pending too.
    // Drop the view (it depends on arc_component column from 006).
    await pool.query('DELETE FROM schema_migrations WHERE version = $1', ['007']);
    await pool.query('DROP VIEW IF EXISTS vw_component_snapshot_by_team CASCADE');
    await pool.query('DROP INDEX IF EXISTS idx_commit_history_commit_date');
    await pool.query('DROP INDEX IF EXISTS idx_commit_files_sha_filename');

    // Also remove migration 006 record so it becomes pending too.
    // Drop the column it adds from commit_files (safe now that views are dropped).
    await pool.query('DELETE FROM schema_migrations WHERE version = $1', ['006']);
    await pool.query('ALTER TABLE commit_files DROP COLUMN IF EXISTS arc_component');
    await pool.query('DROP INDEX IF EXISTS idx_commit_files_arc_component');

    // Run migrations again - should only apply 004, 005, 006, 007, and 021
    // 001-003, 008-020, 022, 023, 024, 025, 026, 027, and 028 were not deleted so they're skipped (23 total)
    const secondRunner = new MigrationRunner(pool, migrationsDir);
    const secondResult = await secondRunner.migrate();

    expect(secondResult.success).toBe(true);
    expect(secondResult.applied).toBe(5);
    expect(secondResult.skipped).toBe(23);
    expect(secondResult.appliedMigrations).toContain('004_add_linear_support.sql');
    expect(secondResult.appliedMigrations).toContain('005_add_calculated_story_points.sql');
    expect(secondResult.appliedMigrations).toContain('006_add_arc_component.sql');
    expect(secondResult.appliedMigrations).toContain('007_component_snapshot_view.sql');
    expect(secondResult.appliedMigrations).toContain('021_architecture_drift.sql');
    expect(secondResult.skippedMigrations).toContain('001_create_tables.sql');
    expect(secondResult.skippedMigrations).toContain('002_create_views.sql');
    expect(secondResult.skippedMigrations).toContain('003_seed_data.sql');
    expect(secondResult.skippedMigrations).toContain('008_sprint_velocity_loc_view.sql');
    expect(secondResult.skippedMigrations).toContain('009_exclude_dependencies_from_loc.sql');
    expect(secondResult.skippedMigrations).toContain('010_dev_pipeline_baseline.sql');
    expect(secondResult.skippedMigrations).toContain('011_release_management_views.sql');
    expect(secondResult.skippedMigrations).toContain('012_code_review_velocity.sql');
    expect(secondResult.skippedMigrations).toContain('013_hot_spots.sql');
    expect(secondResult.skippedMigrations).toContain('014_knowledge_concentration.sql');
    expect(secondResult.skippedMigrations).toContain('015_ticket_lifecycle.sql');
    expect(secondResult.skippedMigrations).toContain('016_developer_focus.sql');
    expect(secondResult.skippedMigrations).toContain('017_team_coupling.sql');
    expect(secondResult.skippedMigrations).toContain('018_release_risk.sql');
    expect(secondResult.skippedMigrations).toContain('019_test_debt.sql');
    expect(secondResult.skippedMigrations).toContain('020_commit_hygiene.sql');
    expect(secondResult.skippedMigrations).toContain('022_velocity_view_jira_support.sql');
    expect(secondResult.skippedMigrations).toContain('023_commit_hygiene_ticket_prefix.sql');
    expect(secondResult.skippedMigrations).toContain('024_contributor_profiles.sql');
    expect(secondResult.skippedMigrations).toContain('025_velocity_dual_story_points.sql');
    expect(secondResult.skippedMigrations).toContain('026_fix_delta_calculation.sql');
    expect(secondResult.skippedMigrations).toContain('027_add_repository_indexes.sql');
  }, 30_000);

  it('should be idempotent - fully migrated database triggers no execution', async () => {
    // Apply all migrations
    const firstRunner = new MigrationRunner(pool, migrationsDir);
    const firstResult = await firstRunner.migrate();
    expect(firstResult.success).toBe(true);
    expect(firstResult.applied).toBeGreaterThanOrEqual(4);

    // Run again - should skip all
    const secondRunner = new MigrationRunner(pool, migrationsDir);
    const secondResult = await secondRunner.migrate();

    expect(secondResult.success).toBe(true);
    expect(secondResult.applied).toBe(0);
    expect(secondResult.skipped).toBeGreaterThanOrEqual(4);
    expect(secondResult.appliedMigrations).toEqual([]);
  }, 30_000);

  it('should roll back failed migration and report error', async () => {
    // Apply all valid migrations first
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();
    expect(result.success).toBe(true);

    // Create a temporary directory with a bad migration
    const { mkdtempSync, writeFileSync, cpSync } = require('fs');
    const { tmpdir } = require('os');
    const tempDir = mkdtempSync(resolve(tmpdir(), 'gitrx-migration-test-'));

    // Copy existing migrations
    cpSync(migrationsDir, tempDir, { recursive: true });

    // Add a bad migration file (use 008 since 001-007 are real migrations)
    writeFileSync(
      resolve(tempDir, '008_bad_migration.sql'),
      'CREATE TABLE this_should_fail (\n  id SERIAL PRIMARY KEY\n);\nINVALID SQL STATEMENT HERE;'
    );

    // Remove the existing schema_migrations entry for 008 if any
    // (shouldn't exist, but be safe)
    await pool.query('DELETE FROM schema_migrations WHERE version = $1', ['008']);

    const badRunner = new MigrationRunner(pool, tempDir);
    const badResult = await badRunner.migrate();

    expect(badResult.success).toBe(false);
    expect(badResult.error).toContain('008_bad_migration.sql');
    // The table should NOT exist because the transaction was rolled back
    const tableCheck = await pool.query(
      "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_name = 'this_should_fail'"
    );
    expect(parseInt(tableCheck.rows[0]?.count as string, 10)).toBe(0);

    // Clean up temp dir
    const { rmSync } = require('fs');
    rmSync(tempDir, { recursive: true, force: true });
  }, 30_000);

  it('should be compatible with Docker init script applied migrations', async () => {
    // Simulate Docker init script having applied migrations 001-003
    // by manually inserting into schema_migrations with md5 checksums (Docker uses md5)
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          checksum TEXT
        )
      `);

      // Insert with md5 checksums (as Docker init script would)
      await client.query(
        "INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)",
        ['001', '001_create_tables.sql', 'docker_md5_checksum_001']
      );
      await client.query(
        "INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)",
        ['002', '002_create_views.sql', 'docker_md5_checksum_002']
      );
      await client.query(
        "INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)",
        ['003', '003_seed_data.sql', 'docker_md5_checksum_003']
      );

      // Manually run the SQL from 001, 002, 003 so the tables/views exist
      const { readFileSync } = require('fs');
      const sql001 = readFileSync(resolve(migrationsDir, '001_create_tables.sql'), 'utf-8');
      const sql002 = readFileSync(resolve(migrationsDir, '002_create_views.sql'), 'utf-8');
      const sql003 = readFileSync(resolve(migrationsDir, '003_seed_data.sql'), 'utf-8');
      await client.query(sql001);
      await client.query(sql002);
      await client.query(sql003);
    } finally {
      client.release();
    }

    // Now run MigrationRunner - it should skip 001-003 (Docker-applied) and apply 004+
    const runner = new MigrationRunner(pool, migrationsDir);
    const result = await runner.migrate();

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(3);
    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(result.skippedMigrations).toContain('001_create_tables.sql');
    expect(result.skippedMigrations).toContain('002_create_views.sql');
    expect(result.skippedMigrations).toContain('003_seed_data.sql');
    expect(result.appliedMigrations).toContain('004_add_linear_support.sql');
  }, 30_000);

  it('should use advisory locking during migration', async () => {
    // Run migrations and verify advisory lock was used by checking
    // that pg_locks had an advisory lock during execution
    // We test this indirectly by running two concurrent migrations
    // and verifying they both succeed without errors

    const runner1 = new MigrationRunner(pool, migrationsDir);
    const runner2 = new MigrationRunner(pool, migrationsDir);

    // Run both concurrently - advisory lock should serialize them
    const [result1, result2] = await Promise.all([
      runner1.migrate(),
      runner2.migrate(),
    ]);

    // Both should succeed
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // One should have applied, the other should have skipped all
    const totalApplied = result1.applied + result2.applied;
    expect(totalApplied).toBeGreaterThanOrEqual(4);

    // Verify no duplicate entries in schema_migrations
    const migrationRows = await pool.query(
      'SELECT version, COUNT(*) AS cnt FROM schema_migrations GROUP BY version HAVING COUNT(*) > 1'
    );
    expect(migrationRows.rows.length).toBe(0);
  }, 60_000);
});
