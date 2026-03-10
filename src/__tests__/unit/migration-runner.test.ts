import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolve } from 'path';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  discoverMigrations,
  findRollbackFile,
  computeChecksum,
  isLegacyChecksum,
} from '../../database/migration-runner.js';

/**
 * Unit tests for the migration runner module.
 * Tests discovery, rollback file lookup, and checksum functions
 * against the actual migration files in docker/migrations/.
 *
 * Ticket: IQS-850
 */

const projectRoot = resolve(__dirname, '..', '..', '..');
const migrationsDir = resolve(projectRoot, 'docker', 'migrations');

describe('discoverMigrations', () => {
  beforeEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  it('should discover migration files from the migrations directory', () => {
    const migrations = discoverMigrations(migrationsDir);

    expect(migrations.length).toBeGreaterThanOrEqual(3);
    expect(migrations[0]?.version).toBe('001');
    expect(migrations[0]?.filename).toBe('001_create_tables.sql');
    expect(migrations[1]?.version).toBe('002');
    expect(migrations[1]?.filename).toBe('002_create_views.sql');
    expect(migrations[2]?.version).toBe('003');
    expect(migrations[2]?.filename).toBe('003_seed_data.sql');
  });

  it('should return migrations sorted by version in ascending order', () => {
    const migrations = discoverMigrations(migrationsDir);

    for (let i = 1; i < migrations.length; i++) {
      const prev = migrations[i - 1];
      const curr = migrations[i];
      if (prev && curr) {
        expect(prev.version < curr.version).toBe(true);
      }
    }
  });

  it('should exclude rollback files from discovered migrations', () => {
    const migrations = discoverMigrations(migrationsDir);

    for (const migration of migrations) {
      expect(migration.filename).not.toContain('.rollback.');
    }
  });

  it('should set absolute file paths for each migration', () => {
    const migrations = discoverMigrations(migrationsDir);

    for (const migration of migrations) {
      expect(migration.filepath).toContain(migrationsDir);
      expect(migration.filepath).toContain(migration.filename);
    }
  });

  it('should return empty array for non-existent directory', () => {
    const migrations = discoverMigrations('/non/existent/path');
    expect(migrations).toEqual([]);
  });
});

describe('findRollbackFile', () => {
  beforeEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  it('should find rollback file for version 001', () => {
    const rollbackPath = findRollbackFile(migrationsDir, '001');

    expect(rollbackPath).toBeDefined();
    expect(rollbackPath).toContain('001_create_tables.rollback.sql');
  });

  it('should find rollback file for version 002', () => {
    const rollbackPath = findRollbackFile(migrationsDir, '002');

    expect(rollbackPath).toBeDefined();
    expect(rollbackPath).toContain('002_create_views.rollback.sql');
  });

  it('should find rollback file for version 003', () => {
    const rollbackPath = findRollbackFile(migrationsDir, '003');

    expect(rollbackPath).toBeDefined();
    expect(rollbackPath).toContain('003_seed_data.rollback.sql');
  });

  it('should return undefined for non-existent version', () => {
    const rollbackPath = findRollbackFile(migrationsDir, '999');
    expect(rollbackPath).toBeUndefined();
  });

  it('should return undefined for non-existent directory', () => {
    const rollbackPath = findRollbackFile('/non/existent/path', '001');
    expect(rollbackPath).toBeUndefined();
  });
});

describe('computeChecksum (SHA-256, IQS-880)', () => {
  it('should produce consistent checksums for the same content', () => {
    const content = 'CREATE TABLE test (id INT PRIMARY KEY);';
    const checksum1 = computeChecksum(content);
    const checksum2 = computeChecksum(content);

    expect(checksum1).toBe(checksum2);
  });

  it('should produce different checksums for different content', () => {
    const checksum1 = computeChecksum('CREATE TABLE a (id INT);');
    const checksum2 = computeChecksum('CREATE TABLE b (id INT);');

    expect(checksum1).not.toBe(checksum2);
  });

  it('should return a 64-character hex string (SHA-256)', () => {
    const checksum = computeChecksum('test content');

    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should handle empty string', () => {
    const checksum = computeChecksum('');
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    // SHA-256 of empty string is a well-known constant
    expect(checksum).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('should handle multi-line SQL content', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS test_table (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;
    const checksum = computeChecksum(sql);
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should not produce legacy 8-char DJB2-format checksums', () => {
    const checksum = computeChecksum('any content');
    expect(checksum.length).toBe(64);
    expect(isLegacyChecksum(checksum)).toBe(false);
  });
});

describe('isLegacyChecksum (IQS-880)', () => {
  it('should identify 8-char hex strings as legacy DJB2 checksums', () => {
    expect(isLegacyChecksum('1a2b3c4d')).toBe(true);
    expect(isLegacyChecksum('00001505')).toBe(true);
    expect(isLegacyChecksum('ffffffff')).toBe(true);
  });

  it('should not identify SHA-256 checksums as legacy', () => {
    const sha256 = computeChecksum('test');
    expect(isLegacyChecksum(sha256)).toBe(false);
  });

  it('should not identify non-hex strings as legacy', () => {
    expect(isLegacyChecksum('ghijklmn')).toBe(false);
    expect(isLegacyChecksum('12345678x')).toBe(false);
  });

  it('should not identify empty string as legacy', () => {
    expect(isLegacyChecksum('')).toBe(false);
  });

  it('should not identify 7-char or 9-char hex strings as legacy', () => {
    expect(isLegacyChecksum('1234567')).toBe(false);
    expect(isLegacyChecksum('123456789')).toBe(false);
  });

  it('should handle Docker md5 checksums as non-legacy (32 chars)', () => {
    expect(isLegacyChecksum('d41d8cd98f00b204e9800998ecf8427e')).toBe(false);
  });
});

describe('Migration SQL File Validation', () => {
  it('should have 001_create_tables.sql that is readable', () => {
    const { readFileSync, existsSync } = require('fs');
    const filePath = resolve(migrationsDir, '001_create_tables.sql');

    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('should have 002_create_views.sql that is readable', () => {
    const { readFileSync, existsSync } = require('fs');
    const filePath = resolve(migrationsDir, '002_create_views.sql');

    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('should have 003_seed_data.sql that is readable', () => {
    const { readFileSync, existsSync } = require('fs');
    const filePath = resolve(migrationsDir, '003_seed_data.sql');

    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('001_create_tables.sql should contain all 20 required tables', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(resolve(migrationsDir, '001_create_tables.sql'), 'utf-8');

    const requiredTables = [
      'commit_contributors',
      'commit_history',
      'commit_files',
      'commit_files_types',
      'commit_msg_words',
      'commit_directory',
      'commit_tags',
      'commit_branch_relationship',
      'commit_jira',
      'jira_detail',
      'jira_history',
      'jira_issue_link',
      'jira_parent',
      'gitr_pipeline_run',
      'gitr_pipeline_log',
      'gitr_pipeline_sha',
      'gitr_pipeline_jira',
      'gitja_pipeline_table_counts',
      'gitja_team_contributor',
      'jira_github_branch',
      'jira_github_pullrequest',
    ];

    for (const table of requiredTables) {
      expect(content).toContain(table);
    }
  });

  it('001_create_tables.sql should use IF NOT EXISTS for all tables', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(resolve(migrationsDir, '001_create_tables.sql'), 'utf-8');

    // Count CREATE TABLE IF NOT EXISTS occurrences
    const ifNotExistsMatches = content.match(/CREATE TABLE IF NOT EXISTS/gi);
    expect(ifNotExistsMatches).not.toBeNull();
    expect(ifNotExistsMatches!.length).toBe(21);
  });

  it('001_create_tables.sql should not use string interpolation', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(resolve(migrationsDir, '001_create_tables.sql'), 'utf-8');

    // Ensure no ${} template literal interpolation in SQL files
    expect(content).not.toContain('${');
  });

  it('001_create_tables.sql should preserve foreign key constraints', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(resolve(migrationsDir, '001_create_tables.sql'), 'utf-8');

    const foreignKeys = [
      'fk_sha_files',
      'fk_sha_file_types',
      'fk_sha_words',
      'fk_sha_directory',
      'fk_sha_tags',
      'fk_sha_branch_relationship',
      'fk_sha_jira',
      'fk_jira_history',
      'fk_jira_issue',
      'fk_jira_parent',
      'fk_parent_pipeline',
      'fk_pipeline_id',
      'fk_pipeline_sha',
      'fk_pipeline_jid',
      'fk_pipeline_jira',
      'fk_pipeline_count',
      'fk_team_contributor',
      'fk_jira_github_key',  // Used by both jira_github_branch and jira_github_pullrequest
    ];

    for (const fk of foreignKeys) {
      expect(content).toContain(fk);
    }
  });

  it('002_create_views.sql should contain all required views', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(resolve(migrationsDir, '002_create_views.sql'), 'utf-8');

    const requiredViews = [
      'max_num_count_per_login',
      'num_count_per_full_name',
      'max_num_count_per_full_name',
      'vw_unfinished_jira_issues',
      'vw_technology_stack_category',
      'vw_technology_stack_complexity',
      'vw_commit_file_chage_history',
      'vw_scorecard_detail',
      'vw_scorecard',
      'vw_jira_history_detail',
      'vw_jira_history_assignments',
    ];

    for (const view of requiredViews) {
      expect(content).toContain(view);
    }
  });

  it('002_create_views.sql should use CREATE OR REPLACE VIEW', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(resolve(migrationsDir, '002_create_views.sql'), 'utf-8');

    const createOrReplaceMatches = content.match(/CREATE OR REPLACE VIEW/gi);
    expect(createOrReplaceMatches).not.toBeNull();
    expect(createOrReplaceMatches!.length).toBe(11);
  });

  it('003_seed_data.sql should contain conditional insert', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(resolve(migrationsDir, '003_seed_data.sql'), 'utf-8');

    expect(content).toContain('INSERT INTO gitr_pipeline_run');
    // Should use WHERE NOT EXISTS for idempotency
    expect(content).toContain('WHERE NOT EXISTS');
  });

  it('rollback files should exist for all migrations', () => {
    const { existsSync } = require('fs');

    expect(existsSync(resolve(migrationsDir, '001_create_tables.rollback.sql'))).toBe(true);
    expect(existsSync(resolve(migrationsDir, '002_create_views.rollback.sql'))).toBe(true);
    expect(existsSync(resolve(migrationsDir, '003_seed_data.rollback.sql'))).toBe(true);
  });

  it('001_create_tables.rollback.sql should drop tables in reverse dependency order', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(resolve(migrationsDir, '001_create_tables.rollback.sql'), 'utf-8');

    // Verify it drops tables
    expect(content).toContain('DROP TABLE IF EXISTS');

    // Verify dependent tables come before their dependencies
    const pullRequestPos = content.indexOf('jira_github_pullrequest');
    const jiraDetailPos = content.indexOf('jira_detail');
    const commitHistoryPos = content.indexOf('commit_history');

    // jira_github_pullrequest depends on jira_detail, so must be dropped first
    expect(pullRequestPos).toBeLessThan(jiraDetailPos);
    // jira_detail should be dropped before commit_history (which it does not depend on,
    // but dependent tables like commit_jira must come first)
    expect(jiraDetailPos).toBeLessThan(commitHistoryPos);
  });

  it('002_create_views.rollback.sql should drop views in reverse dependency order', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(resolve(migrationsDir, '002_create_views.rollback.sql'), 'utf-8');

    expect(content).toContain('DROP VIEW IF EXISTS');

    // vw_scorecard depends on vw_scorecard_detail, so should be dropped first
    const scorecardPos = content.indexOf('vw_scorecard;');
    const scorecardDetailPos = content.indexOf('vw_scorecard_detail');
    expect(scorecardPos).toBeLessThan(scorecardDetailPos);
  });

  it('no migration SQL file should exceed 600 lines', () => {
    const { readFileSync, readdirSync } = require('fs');
    const files = readdirSync(migrationsDir) as string[];

    for (const file of files) {
      if (file.endsWith('.sql')) {
        const content = readFileSync(resolve(migrationsDir, file), 'utf-8');
        const lineCount = content.split('\n').length;
        expect(lineCount).toBeLessThanOrEqual(600);
      }
    }
  });
});

describe('MigrationRunner class (mock pool)', () => {
  beforeEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  it('should be importable and constructable with a mock pool', async () => {
    const { MigrationRunner } = await import('../../database/migration-runner.js');

    const mockPool = {
      connect: vi.fn(),
      query: vi.fn(),
      end: vi.fn(),
    };

    const runner = new MigrationRunner(mockPool as never, migrationsDir);
    expect(runner).toBeDefined();
  });

  it('should expose migrate, rollback, rollbackTo, getAppliedMigrations, getPendingMigrations, validateChecksums methods', async () => {
    const { MigrationRunner } = await import('../../database/migration-runner.js');

    const mockPool = {
      connect: vi.fn(),
      query: vi.fn(),
      end: vi.fn(),
    };

    const runner = new MigrationRunner(mockPool as never, migrationsDir);
    expect(typeof runner.migrate).toBe('function');
    expect(typeof runner.rollback).toBe('function');
    expect(typeof runner.rollbackTo).toBe('function');
    expect(typeof runner.getAppliedMigrations).toBe('function');
    expect(typeof runner.getPendingMigrations).toBe('function');
    expect(typeof runner.validateChecksums).toBe('function');
  });

  it('should reject paths containing path traversal sequences (IQS-879)', async () => {
    const { MigrationRunner } = await import('../../database/migration-runner.js');

    const mockPool = {
      connect: vi.fn(),
      query: vi.fn(),
      end: vi.fn(),
    };

    expect(() => new MigrationRunner(mockPool as never, '/foo/../bar/migrations'))
      .toThrow('Migration directory path must not contain path traversal sequences (..)');
  });

  it('should reject paths with traversal in original input even if normalize resolves them (IQS-881)', async () => {
    const { MigrationRunner } = await import('../../database/migration-runner.js');

    const mockPool = {
      connect: vi.fn(),
      query: vi.fn(),
      end: vi.fn(),
    };

    // Path with .. in the middle that resolve() would normalize away
    expect(() => new MigrationRunner(mockPool as never, '/tmp/safe/../evil'))
      .toThrow('Migration directory path must not contain path traversal sequences (..)');
  });

  it('should normalize the migrations directory path (IQS-879)', async () => {
    const { MigrationRunner } = await import('../../database/migration-runner.js');

    const mockPool = {
      connect: vi.fn(),
      query: vi.fn(),
      end: vi.fn(),
    };

    // A valid absolute path should be accepted
    const runner = new MigrationRunner(mockPool as never, migrationsDir);
    expect(runner).toBeDefined();
  });

  it('should acquire and release advisory lock during migrate (IQS-879)', async () => {
    const { MigrationRunner } = await import('../../database/migration-runner.js');

    const queryCalls: string[] = [];
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        queryCalls.push(typeof sql === 'string' ? sql : 'unknown');
        if (sql.includes('COUNT')) {
          return { rows: [{ count: '1' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn(),
      end: vi.fn(),
    };

    const runner = new MigrationRunner(mockPool as never, migrationsDir);
    const result = await runner.migrate();

    // Verify advisory lock was acquired
    expect(queryCalls.some(q => q.includes('pg_advisory_lock'))).toBe(true);
    // Verify advisory lock was released
    expect(queryCalls.some(q => q.includes('pg_advisory_unlock'))).toBe(true);
    // Lock should come before unlock
    const lockIndex = queryCalls.findIndex(q => q.includes('pg_advisory_lock'));
    const unlockIndex = queryCalls.findIndex(q => q.includes('pg_advisory_unlock'));
    expect(lockIndex).toBeLessThan(unlockIndex);

    expect(result.success).toBe(true);
  });
});

describe('Docker Init Script', () => {
  it('should have an executable init script at docker/init/01_run_migrations.sh', () => {
    const { existsSync, statSync } = require('fs');
    const initScript = resolve(projectRoot, 'docker', 'init', '01_run_migrations.sh');

    expect(existsSync(initScript)).toBe(true);
    const stats = statSync(initScript);
    // Check that the file is executable (at least user execute bit)
    const isExecutable = (stats.mode & 0o100) !== 0;
    expect(isExecutable).toBe(true);
  });

  it('init script should create schema_migrations table', () => {
    const { readFileSync } = require('fs');
    const initScript = resolve(projectRoot, 'docker', 'init', '01_run_migrations.sh');
    const content = readFileSync(initScript, 'utf-8');

    expect(content).toContain('schema_migrations');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS');
  });

  it('init script should skip already-applied migrations', () => {
    const { readFileSync } = require('fs');
    const initScript = resolve(projectRoot, 'docker', 'init', '01_run_migrations.sh');
    const content = readFileSync(initScript, 'utf-8');

    expect(content).toContain('already applied');
  });

  it('init script should run migrations inside transactions', () => {
    const { readFileSync } = require('fs');
    const initScript = resolve(projectRoot, 'docker', 'init', '01_run_migrations.sh');
    const content = readFileSync(initScript, 'utf-8');

    expect(content).toContain('BEGIN');
    expect(content).toContain('COMMIT');
  });

  it('init script should use set -euo pipefail for safety', () => {
    const { readFileSync } = require('fs');
    const initScript = resolve(projectRoot, 'docker', 'init', '01_run_migrations.sh');
    const content = readFileSync(initScript, 'utf-8');

    expect(content).toContain('set -euo pipefail');
  });

  it('init script should use -- separator with basename for safe filename extraction (IQS-880)', () => {
    const { readFileSync } = require('fs');
    const initScript = resolve(projectRoot, 'docker', 'init', '01_run_migrations.sh');
    const content = readFileSync(initScript, 'utf-8');

    // basename should use -- separator to prevent option injection
    expect(content).toContain('basename --');
  });

  it('init script should use -- separator with sha256sum for safe checksum computation (IQS-880)', () => {
    const { readFileSync } = require('fs');
    const initScript = resolve(projectRoot, 'docker', 'init', '01_run_migrations.sh');
    const content = readFileSync(initScript, 'utf-8');

    // sha256sum should use -- separator to prevent option injection
    expect(content).toContain('sha256sum --');
  });

  it('init script should use quoted heredoc (EOSQL) to prevent variable expansion in SQL (IQS-880)', () => {
    const { readFileSync } = require('fs');
    const initScript = resolve(projectRoot, 'docker', 'init', '01_run_migrations.sh');
    const content = readFileSync(initScript, 'utf-8');

    // The migration execution heredoc should use psql variables, not shell expansion
    expect(content).toContain(":'version'");
    expect(content).toContain(":'filename'");
    expect(content).toContain(":'checksum'");
  });

  it('init script should not use unquoted shell variable expansion in SQL (IQS-880)', () => {
    const { readFileSync } = require('fs');
    const initScript = resolve(projectRoot, 'docker', 'init', '01_run_migrations.sh');
    const content = readFileSync(initScript, 'utf-8');

    // Should not have bare ${version} or ${filename} inside SQL INSERT statements
    // (psql -v variables with :'var' syntax are used instead)
    const sqlInsertSection = content.substring(content.indexOf('INSERT INTO schema_migrations'));
    expect(sqlInsertSection).not.toMatch(/'\$\{version\}'/);
    expect(sqlInsertSection).not.toMatch(/'\$\{filename\}'/);
    expect(sqlInsertSection).not.toMatch(/'\$\{checksum\}'/);
  });
});

describe('Docker Compose Migration Volume', () => {
  it('should mount migrations directory in docker-compose.yml', () => {
    const { readFileSync } = require('fs');
    const composePath = resolve(projectRoot, 'docker-compose.yml');
    const content = readFileSync(composePath, 'utf-8');

    expect(content).toContain('./docker/migrations:/migrations:ro');
  });
});

describe('Auto-migration pool connection timeout (IQS-881)', () => {
  it('should configure connectionTimeoutMillis as 3000 in auto-migration.ts', () => {
    const { readFileSync } = require('fs');
    const autoMigrationPath = resolve(projectRoot, 'src', 'database', 'auto-migration.ts');
    const content = readFileSync(autoMigrationPath, 'utf-8');

    // Verify 3-second timeout for local Docker connections
    expect(content).toContain('connectionTimeoutMillis: 3_000');
    // Ensure the old 10-second timeout is no longer present
    expect(content).not.toContain('connectionTimeoutMillis: 10_000');
  });
});
