import { createHash } from 'crypto';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { LoggerService } from '../logging/logger.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'MigrationUtils';

/**
 * Represents a single migration file discovered on disk.
 */
export interface MigrationFile {
  /** Version prefix extracted from the filename (e.g., "001"). */
  readonly version: string;
  /** Full filename (e.g., "001_create_tables.sql"). */
  readonly filename: string;
  /** Absolute path to the migration file. */
  readonly filepath: string;
}

/**
 * Regex pattern that matches migration SQL files.
 * Expects format: NNN_description.sql (e.g., 001_create_tables.sql).
 * Excludes rollback files (*.rollback.sql) and test files (*.test.sql).
 */
const MIGRATION_FILE_PATTERN = /^(\d{3})_(?!.*\.(rollback|test)\.sql$).+\.sql$/;

/**
 * Regex pattern that matches rollback SQL files.
 * Expects format: NNN_description.rollback.sql.
 */
const ROLLBACK_FILE_PATTERN = /^(\d{3})_.+\.rollback\.sql$/;

/**
 * Discovers migration files in the specified directory.
 *
 * Scans the directory for SQL files matching the NNN_*.sql naming pattern
 * and returns them sorted by version number in ascending order.
 * Rollback files (*.rollback.sql) are excluded.
 *
 * @param migrationsDir - Absolute path to the migrations directory
 * @returns Array of migration files sorted by version
 */
export function discoverMigrations(migrationsDir: string): MigrationFile[] {
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'discoverMigrations', `Scanning directory: ${migrationsDir}`);

  if (!existsSync(migrationsDir)) {
    logger.warn(CLASS_NAME, 'discoverMigrations', `Migrations directory does not exist: ${migrationsDir}`);
    return [];
  }

  const files = readdirSync(migrationsDir);
  logger.trace(CLASS_NAME, 'discoverMigrations', `Found ${files.length} files in migrations directory`);

  const migrations: MigrationFile[] = [];

  for (const file of files) {
    // Skip rollback files
    if (ROLLBACK_FILE_PATTERN.test(file)) {
      logger.trace(CLASS_NAME, 'discoverMigrations', `Skipping rollback file: ${file}`);
      continue;
    }

    const match = MIGRATION_FILE_PATTERN.exec(file);
    if (match?.[1]) {
      migrations.push({
        version: match[1],
        filename: file,
        filepath: join(migrationsDir, file),
      });
      logger.trace(CLASS_NAME, 'discoverMigrations', `Discovered migration: ${file} (version ${match[1]})`);
    } else {
      logger.trace(CLASS_NAME, 'discoverMigrations', `Skipping non-migration file: ${file}`);
    }
  }

  // Sort by version number ascending
  migrations.sort((a, b) => a.version.localeCompare(b.version));

  logger.debug(CLASS_NAME, 'discoverMigrations', `Discovered ${migrations.length} migration files`);
  return migrations;
}

/**
 * Finds the rollback file for a given migration version.
 *
 * @param migrationsDir - Absolute path to the migrations directory
 * @param version - The migration version to find a rollback for
 * @returns The rollback file path, or undefined if none exists
 */
export function findRollbackFile(migrationsDir: string, version: string): string | undefined {
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'findRollbackFile', `Looking for rollback file for version ${version}`);

  if (!existsSync(migrationsDir)) {
    logger.warn(CLASS_NAME, 'findRollbackFile', `Migrations directory does not exist: ${migrationsDir}`);
    return undefined;
  }

  const files = readdirSync(migrationsDir);
  for (const file of files) {
    if (ROLLBACK_FILE_PATTERN.test(file) && file.startsWith(version)) {
      const filepath = join(migrationsDir, file);
      logger.debug(CLASS_NAME, 'findRollbackFile', `Found rollback file: ${file}`);
      return filepath;
    }
  }

  logger.debug(CLASS_NAME, 'findRollbackFile', `No rollback file found for version ${version}`);
  return undefined;
}

/**
 * Compute a SHA-256 checksum of file content for migration integrity tracking.
 *
 * Upgraded from DJB2 (non-cryptographic, collision-prone) to SHA-256 for
 * stronger tamper detection. (IQS-880)
 *
 * @param content - The file content to checksum
 * @returns A 64-character lowercase hex string (SHA-256 digest)
 */
export function computeChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Check whether a stored checksum looks like a legacy DJB2 hash.
 *
 * DJB2 checksums are exactly 8 hex characters. SHA-256 checksums are 64 hex
 * characters. This heuristic allows validateChecksums() to skip comparison
 * for migrations applied before the SHA-256 upgrade, avoiding false-positive
 * checksum mismatch warnings. (IQS-880)
 *
 * @param checksum - The stored checksum string to test
 * @returns true if the checksum appears to be a legacy DJB2 hash
 */
export function isLegacyChecksum(checksum: string): boolean {
  return /^[0-9a-f]{8}$/.test(checksum);
}
