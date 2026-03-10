import { readFileSync } from 'fs';
import { basename, resolve, isAbsolute } from 'path';
import type { Pool, PoolClient } from 'pg';
import { LoggerService } from '../logging/logger.js';
import {
  type MigrationFile,
  discoverMigrations,
  findRollbackFile,
  computeChecksum,
  isLegacyChecksum,
} from './migration-utils.js';

// Re-export utilities for backward compatibility with existing imports
export { type MigrationFile, discoverMigrations, findRollbackFile, computeChecksum, isLegacyChecksum };

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'MigrationRunner';

/**
 * Represents a migration that has been applied to the database.
 */
export interface AppliedMigration {
  /** Version prefix (e.g., "001"). */
  readonly version: string;
  /** Original filename. */
  readonly filename: string;
  /** Timestamp when the migration was applied. */
  readonly appliedAt: Date;
  /** MD5 checksum of the migration file at time of application. */
  readonly checksum: string;
}

/**
 * Result of a migration run.
 */
export interface MigrationResult {
  /** Total number of migrations applied in this run. */
  readonly applied: number;
  /** Total number of migrations skipped (already applied). */
  readonly skipped: number;
  /** Details of each migration that was applied. */
  readonly appliedMigrations: readonly string[];
  /** Details of each migration that was skipped. */
  readonly skippedMigrations: readonly string[];
  /** Whether the run completed without errors. */
  readonly success: boolean;
  /** Error message if the run failed. */
  readonly error?: string;
}

/**
 * Result of a rollback operation.
 */
export interface RollbackResult {
  /** The migration version that was rolled back. */
  readonly version: string;
  /** The rollback filename that was executed. */
  readonly filename: string;
  /** Whether the rollback completed without errors. */
  readonly success: boolean;
  /** Error message if the rollback failed. */
  readonly error?: string;
}

/**
 * Advisory lock ID for serializing concurrent migration runs.
 * Uses a fixed integer instead of hashtext() for cross-PG-version compatibility.
 * Value chosen from CRC32('gitrx_migrations') to avoid collisions. (IQS-879)
 */
const MIGRATION_ADVISORY_LOCK_ID = 283745692;

/**
 * TypeScript migration runner for the gitrx VS Code extension.
 *
 * Executes versioned SQL migration files against a PostgreSQL database.
 * Tracks applied migrations in a `schema_migrations` table to ensure
 * idempotency and supports rollback via companion .rollback.sql files.
 *
 * This runner is the programmatic equivalent of the Docker init script
 * (docker/init/01_run_migrations.sh) but can be invoked from within
 * the VS Code extension for migration management operations.
 *
 * Design decisions:
 * - Each migration runs inside a database transaction for atomicity.
 * - The schema_migrations table uses version as primary key.
 * - Rollback files follow the NNN_description.rollback.sql naming convention.
 * - All SQL is read from files; no string interpolation for SQL queries.
 *
 * Ticket: IQS-850
 */
export class MigrationRunner {
  private readonly logger: LoggerService;
  private readonly pool: Pool;
  private readonly migrationsDir: string;

  /**
   * Create a new MigrationRunner.
   *
   * @param pool - The pg Pool instance for database connections
   * @param migrationsDir - Absolute path to the directory containing migration SQL files
   * @throws Error if migrationsDir contains path traversal sequences
   */
  constructor(pool: Pool, migrationsDir: string) {
    this.logger = LoggerService.getInstance();
    this.pool = pool;

    // Security: normalize first, then validate the resolved path (IQS-879, IQS-881)
    // Validates the normalized path rather than the original input to catch
    // encoded or indirect traversal sequences that survive resolve().
    const normalizedPath = resolve(migrationsDir);

    if (normalizedPath.includes('..')) {
      this.logger.critical(CLASS_NAME, 'constructor', `SECURITY: Rejected migrations path with traversal after normalization: ${normalizedPath}`);
      throw new Error('Migration directory path must not contain path traversal sequences (..)');
    }
    if (!isAbsolute(normalizedPath)) {
      this.logger.critical(CLASS_NAME, 'constructor', `SECURITY: Rejected non-absolute migrations path: ${normalizedPath}`);
      throw new Error('Migration directory path must be absolute');
    }

    // Additional check: ensure original input doesn't contain traversal (defense in depth)
    if (migrationsDir.includes('..')) {
      this.logger.critical(CLASS_NAME, 'constructor', `SECURITY: Rejected migrations path with traversal in original input: ${migrationsDir}`);
      throw new Error('Migration directory path must not contain path traversal sequences (..)');
    }

    this.migrationsDir = normalizedPath;
    this.logger.debug(CLASS_NAME, 'constructor', `MigrationRunner initialized with dir: ${normalizedPath}`);
  }

  /**
   * Ensure the schema_migrations tracking table exists.
   * Uses IF NOT EXISTS for idempotency.
   *
   * @param client - The database client to use
   */
  async ensureTrackingTable(client: PoolClient): Promise<void> {
    this.logger.debug(CLASS_NAME, 'ensureTrackingTable', 'Creating schema_migrations table if not exists');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        checksum TEXT
      )
    `);

    this.logger.debug(CLASS_NAME, 'ensureTrackingTable', 'schema_migrations table ready');
  }

  /**
   * Get all migrations that have been applied to the database.
   *
   * @returns Array of applied migrations, sorted by version
   */
  async getAppliedMigrations(): Promise<AppliedMigration[]> {
    this.logger.debug(CLASS_NAME, 'getAppliedMigrations', 'Querying applied migrations');

    const client = await this.pool.connect();
    try {
      await this.ensureTrackingTable(client);

      const result = await client.query(
        'SELECT version, filename, applied_at, checksum FROM schema_migrations ORDER BY version ASC'
      );

      const applied: AppliedMigration[] = result.rows.map((row: { version: string; filename: string; applied_at: Date; checksum: string }) => ({
        version: row.version,
        filename: row.filename,
        appliedAt: row.applied_at,
        checksum: row.checksum,
      }));

      this.logger.debug(CLASS_NAME, 'getAppliedMigrations', `Found ${applied.length} applied migrations`);
      return applied;
    } finally {
      client.release();
    }
  }

  /**
   * Get pending migrations that have not yet been applied.
   *
   * @returns Array of pending migration files, sorted by version
   */
  async getPendingMigrations(): Promise<MigrationFile[]> {
    this.logger.debug(CLASS_NAME, 'getPendingMigrations', 'Calculating pending migrations');

    const allMigrations = discoverMigrations(this.migrationsDir);
    const applied = await this.getAppliedMigrations();

    const appliedVersions = new Set(applied.map(m => m.version));
    const pending = allMigrations.filter(m => !appliedVersions.has(m.version));

    this.logger.debug(CLASS_NAME, 'getPendingMigrations', `Pending: ${pending.length}, Applied: ${applied.length}, Total: ${allMigrations.length}`);
    return pending;
  }

  /**
   * Run all pending migrations in order.
   *
   * Each migration is executed inside a transaction. If any migration fails,
   * that specific migration's transaction is rolled back and the run stops.
   * Previously applied migrations in this run are NOT rolled back.
   *
   * Uses pg_advisory_lock to prevent concurrent migration runs from multiple
   * VS Code windows targeting the same database. (IQS-879)
   *
   * @returns The result of the migration run
   */
  async migrate(): Promise<MigrationResult> {
    this.logger.info(CLASS_NAME, 'migrate', 'Starting migration run');

    const appliedMigrations: string[] = [];
    const skippedMigrations: string[] = [];

    const client = await this.pool.connect();
    try {
      // Acquire advisory lock to prevent concurrent migrations (IQS-879)
      this.logger.debug(CLASS_NAME, 'migrate', `Acquiring advisory lock (ID: ${MIGRATION_ADVISORY_LOCK_ID})`);
      const lockStart = Date.now();
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
      const lockDuration = Date.now() - lockStart;
      this.logger.debug(CLASS_NAME, 'migrate', `Advisory lock acquired in ${lockDuration}ms`);
      if (lockDuration > 1000) {
        this.logger.info(CLASS_NAME, 'migrate', `Advisory lock took ${lockDuration}ms — another migration may have been in progress`);
      }

      try {
        await this.ensureTrackingTable(client);

        const allMigrations = discoverMigrations(this.migrationsDir);
        this.logger.debug(CLASS_NAME, 'migrate', `Found ${allMigrations.length} total migration files`);

        for (const migration of allMigrations) {
          // Check if already applied
          const existsResult = await client.query(
            'SELECT COUNT(*) AS count FROM schema_migrations WHERE version = $1',
            [migration.version]
          );

          const alreadyApplied = parseInt(existsResult.rows[0]?.count as string, 10) > 0;

          if (alreadyApplied) {
            this.logger.debug(CLASS_NAME, 'migrate', `SKIP: ${migration.filename} (already applied)`);
            skippedMigrations.push(migration.filename);
            continue;
          }

          this.logger.info(CLASS_NAME, 'migrate', `APPLYING: ${migration.filename}`);

          // Read and execute the migration SQL within a transaction
          this.logger.trace(CLASS_NAME, 'migrate', `Reading migration file: ${migration.filepath}`);
          const sql = readFileSync(migration.filepath, 'utf-8');
          this.logger.trace(CLASS_NAME, 'migrate', `Migration file read: ${sql.length} bytes`);
          const checksum = computeChecksum(sql);
          this.logger.trace(CLASS_NAME, 'migrate', `Computed checksum: ${checksum}`);

          try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query(
              'INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)',
              [migration.version, migration.filename, checksum]
            );
            await client.query('COMMIT');

            this.logger.info(CLASS_NAME, 'migrate', `APPLIED: ${migration.filename} (checksum: ${checksum})`);
            appliedMigrations.push(migration.filename);
          } catch (error: unknown) {
            await client.query('ROLLBACK');
            const message = error instanceof Error ? error.message : String(error);
            this.logger.critical(CLASS_NAME, 'migrate', `FAILED: ${migration.filename} - ${message}`);

            return {
              applied: appliedMigrations.length,
              skipped: skippedMigrations.length,
              appliedMigrations,
              skippedMigrations,
              success: false,
              error: `Migration ${migration.filename} failed: ${message}`,
            };
          }
        }

        this.logger.info(CLASS_NAME, 'migrate', `Migration run complete. Applied: ${appliedMigrations.length}, Skipped: ${skippedMigrations.length}`);

        return {
          applied: appliedMigrations.length,
          skipped: skippedMigrations.length,
          appliedMigrations,
          skippedMigrations,
          success: true,
        };
      } finally {
        // Release advisory lock (IQS-879)
        this.logger.debug(CLASS_NAME, 'migrate', `Releasing advisory lock (ID: ${MIGRATION_ADVISORY_LOCK_ID})`);
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
          this.logger.debug(CLASS_NAME, 'migrate', 'Advisory lock released');
        } catch (unlockError: unknown) {
          const unlockMsg = unlockError instanceof Error ? unlockError.message : String(unlockError);
          this.logger.warn(CLASS_NAME, 'migrate', `Advisory lock release failed (will auto-release on disconnect): ${unlockMsg}`);
        }
      }
    } finally {
      client.release();
    }
  }

  /**
   * Roll back the most recently applied migration.
   *
   * Finds the latest applied migration, locates its .rollback.sql companion file,
   * and executes the rollback SQL within a transaction. The migration record is
   * removed from schema_migrations upon successful rollback.
   *
   * @returns The result of the rollback operation
   */
  async rollback(): Promise<RollbackResult> {
    this.logger.info(CLASS_NAME, 'rollback', 'Starting rollback of most recent migration');

    const applied = await this.getAppliedMigrations();
    if (applied.length === 0) {
      this.logger.warn(CLASS_NAME, 'rollback', 'No migrations to roll back');
      return {
        version: '',
        filename: '',
        success: false,
        error: 'No migrations have been applied',
      };
    }

    // Get the most recently applied migration (highest version)
    const latest = applied[applied.length - 1];
    if (!latest) {
      return {
        version: '',
        filename: '',
        success: false,
        error: 'No migrations have been applied',
      };
    }
    this.logger.info(CLASS_NAME, 'rollback', `Rolling back: ${latest.filename} (version ${latest.version})`);

    // Find the rollback file
    const rollbackPath = findRollbackFile(this.migrationsDir, latest.version);
    if (!rollbackPath) {
      this.logger.error(CLASS_NAME, 'rollback', `No rollback file found for version ${latest.version}`);
      return {
        version: latest.version,
        filename: latest.filename,
        success: false,
        error: `No rollback file found for migration ${latest.filename}`,
      };
    }

    const rollbackFilename = basename(rollbackPath);
    this.logger.debug(CLASS_NAME, 'rollback', `Using rollback file: ${rollbackFilename}`);

    const client = await this.pool.connect();
    try {
      const sql = readFileSync(rollbackPath, 'utf-8');

      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'DELETE FROM schema_migrations WHERE version = $1',
        [latest.version]
      );
      await client.query('COMMIT');

      this.logger.info(CLASS_NAME, 'rollback', `Rolled back: ${latest.filename} successfully`);
      return {
        version: latest.version,
        filename: rollbackFilename,
        success: true,
      };
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(() => {
        // Ignore rollback error during error handling
      });
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'rollback', `Rollback failed for ${latest.filename}: ${message}`);
      return {
        version: latest.version,
        filename: rollbackFilename,
        success: false,
        error: `Rollback of ${latest.filename} failed: ${message}`,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Roll back to a specific migration version (exclusive).
   *
   * Rolls back all migrations that were applied after the specified version.
   * For example, rollbackTo("001") would roll back versions 003, 002 (in that order),
   * leaving only version 001 applied.
   *
   * @param targetVersion - The version to roll back to (this version stays applied)
   * @returns Array of rollback results for each migration rolled back
   */
  async rollbackTo(targetVersion: string): Promise<RollbackResult[]> {
    this.logger.info(CLASS_NAME, 'rollbackTo', `Rolling back to version ${targetVersion}`);

    const applied = await this.getAppliedMigrations();
    const results: RollbackResult[] = [];

    // Find migrations to roll back (those with version > targetVersion)
    const toRollback = applied
      .filter(m => m.version > targetVersion)
      .sort((a, b) => b.version.localeCompare(a.version)); // Reverse order

    if (toRollback.length === 0) {
      this.logger.info(CLASS_NAME, 'rollbackTo', `No migrations to roll back (already at or before version ${targetVersion})`);
      return results;
    }

    this.logger.info(CLASS_NAME, 'rollbackTo', `Rolling back ${toRollback.length} migrations`);

    for (const migration of toRollback) {
      const result = await this.rollback();
      results.push(result);

      if (!result.success) {
        this.logger.error(CLASS_NAME, 'rollbackTo', `Rollback stopped due to failure at version ${migration.version}`);
        break;
      }
    }

    return results;
  }

  /**
   * Validate that migration files on disk match the applied checksums.
   *
   * Detects if migration files have been modified after being applied.
   * This is a safety check to prevent schema drift.
   *
   * @returns Array of version numbers with checksum mismatches
   */
  async validateChecksums(): Promise<string[]> {
    this.logger.debug(CLASS_NAME, 'validateChecksums', 'Validating migration checksums');

    const applied = await this.getAppliedMigrations();
    const allMigrations = discoverMigrations(this.migrationsDir);

    const migrationMap = new Map(allMigrations.map(m => [m.version, m]));
    const mismatches: string[] = [];

    for (const appliedMigration of applied) {
      const diskMigration = migrationMap.get(appliedMigration.version);
      if (!diskMigration) {
        this.logger.warn(CLASS_NAME, 'validateChecksums', `Migration file for version ${appliedMigration.version} not found on disk`);
        mismatches.push(appliedMigration.version);
        continue;
      }

      // Skip validation for legacy DJB2 checksums (pre-IQS-880).
      // These 8-char hashes were computed with a different algorithm, so
      // comparing them against the current SHA-256 output would always fail.
      if (isLegacyChecksum(appliedMigration.checksum)) {
        this.logger.debug(
          CLASS_NAME,
          'validateChecksums',
          `Skipping version ${appliedMigration.version}: legacy DJB2 checksum (${appliedMigration.checksum})`
        );
        continue;
      }

      const content = readFileSync(diskMigration.filepath, 'utf-8');
      const currentChecksum = computeChecksum(content);

      if (currentChecksum !== appliedMigration.checksum) {
        this.logger.warn(
          CLASS_NAME,
          'validateChecksums',
          `Checksum mismatch for version ${appliedMigration.version}: applied=${appliedMigration.checksum}, current=${currentChecksum}`
        );
        mismatches.push(appliedMigration.version);
      }
    }

    this.logger.debug(CLASS_NAME, 'validateChecksums', `Validation complete. Mismatches: ${mismatches.length}`);
    return mismatches;
  }
}
