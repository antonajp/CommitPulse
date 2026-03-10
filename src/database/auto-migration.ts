import * as vscode from 'vscode';
import { Pool } from 'pg';
import { LoggerService } from '../logging/logger.js';
import type { DatabaseService } from './database-service.js';
import { MigrationRunner } from './migration-runner.js';
import { getSettings } from '../config/settings.js';
import { SecretStorageService } from '../config/secret-storage.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'AutoMigration';

/**
 * Session-level cache to avoid re-running migrations on every pipeline
 * execution within the same VS Code session. Reset on extension deactivation.
 * (IQS-879)
 */
let migrationsCheckedThisSession = false;

/**
 * Extension URI stored during command registration for migration path resolution.
 * Used to resolve `docker/migrations/` in both dev and packaged VSIX. (IQS-879)
 */
let storedExtensionUri: vscode.Uri | undefined;

/**
 * Store the extension URI for migration path resolution.
 * Called during command registration.
 */
export function setExtensionUri(uri: vscode.Uri): void {
  storedExtensionUri = uri;
}

/**
 * Get the stored extension URI for migration path resolution.
 */
export function getExtensionUri(): vscode.Uri | undefined {
  return storedExtensionUri;
}

/**
 * Reset the session-level migration cache.
 * Called during extension deactivation to ensure migrations are
 * re-checked in the next session. (IQS-879)
 */
export function resetMigrationCache(): void {
  migrationsCheckedThisSession = false;
  storedExtensionUri = undefined;
}

/**
 * Build a pg Pool for migration operations using privilege-separated credentials.
 *
 * If gitrx.database.migrationUser is configured, creates a separate Pool with
 * the migration user's credentials. Otherwise returns undefined, signaling
 * the caller should fall back to the main DatabaseService pool. (IQS-880)
 *
 * @param secretService - SecretStorageService for retrieving migration password
 * @param logger - Logger instance for diagnostic messages
 * @returns A dedicated migration Pool, or undefined if no migration user is configured
 */
async function buildMigrationPool(
  secretService: SecretStorageService | undefined,
  logger: LoggerService,
): Promise<Pool | undefined> {
  const settings = getSettings();
  const migrationUser = settings.database.migrationUser;

  if (!migrationUser) {
    logger.debug(CLASS_NAME, 'buildMigrationPool', 'No migration user configured, will use main DB pool');
    return undefined;
  }

  logger.debug(CLASS_NAME, 'buildMigrationPool', `Migration user configured: ${migrationUser}`);

  // Resolve migration password: SecretStorage > main DB password fallback
  // No plaintext password in settings — SecretStorage only (IQS-880 security audit)
  let migrationPassword: string | undefined;

  if (secretService) {
    migrationPassword = await secretService.getMigrationPassword();
    if (migrationPassword) {
      logger.debug(CLASS_NAME, 'buildMigrationPool', 'Using migration password from SecretStorage');
    }
  }

  if (!migrationPassword) {
    // Fall back to main database password
    if (secretService) {
      migrationPassword = await secretService.getDatabasePassword();
    }
    if (migrationPassword) {
      logger.debug(CLASS_NAME, 'buildMigrationPool', 'Falling back to main DB password for migration user');
    }
  }

  if (!migrationPassword) {
    logger.warn(CLASS_NAME, 'buildMigrationPool', 'No password available for migration user, falling back to main DB pool');
    return undefined;
  }

  const pool = new Pool({
    host: settings.database.host,
    port: settings.database.port,
    database: settings.database.name,
    user: migrationUser,
    password: migrationPassword,
    max: 2, // Migrations are serialized, minimal pool needed
    connectionTimeoutMillis: 3_000, // Fast-fail for local Docker connections (IQS-881)
    idleTimeoutMillis: 5_000,
  });

  logger.debug(CLASS_NAME, 'buildMigrationPool', `Migration pool created: ${settings.database.host}:${settings.database.port}/${settings.database.name} (user: ${migrationUser})`);
  return pool;
}

/**
 * Run pending database migrations if not already checked this session.
 *
 * Resolves the migration directory from the stored extension URI, creates
 * a MigrationRunner, and applies any pending migrations. Results are reported
 * via VS Code notifications and the output channel logger.
 *
 * If a migration-specific database user is configured (IQS-880), a separate
 * connection pool is created for DDL operations and torn down after migration.
 *
 * @param dbService - Initialized DatabaseService with active connection pool
 * @param logger - Logger instance for diagnostic messages
 * @param secretService - Optional SecretStorageService for migration credentials
 * @returns true if pipeline can proceed, false if migrations failed (pipeline blocked)
 */
export async function runAutoMigrations(
  dbService: DatabaseService,
  logger: LoggerService,
  secretService?: SecretStorageService,
): Promise<boolean> {
  if (migrationsCheckedThisSession) {
    logger.debug(CLASS_NAME, 'runAutoMigrations', 'Skipped (already checked this session)');
    return true;
  }

  logger.debug(CLASS_NAME, 'runAutoMigrations', 'Running auto-migration check (first pipeline run this session)');

  // Resolve migrations directory from extension URI
  if (!storedExtensionUri) {
    logger.warn(CLASS_NAME, 'runAutoMigrations', 'Extension URI not available, skipping auto-migration');
    migrationsCheckedThisSession = true;
    return true;
  }

  const migrationsDir = vscode.Uri.joinPath(storedExtensionUri, 'docker', 'migrations').fsPath;
  logger.debug(CLASS_NAME, 'runAutoMigrations', `Migrations directory: ${migrationsDir}`);

  // Build a privilege-separated migration pool if configured (IQS-880)
  let migrationPool: Pool | undefined;
  try {
    migrationPool = await buildMigrationPool(secretService, logger);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(CLASS_NAME, 'runAutoMigrations', `Failed to build migration pool, falling back to main pool: ${message}`);
  }

  const poolToUse = migrationPool ?? dbService.getPool();
  if (migrationPool) {
    logger.info(CLASS_NAME, 'runAutoMigrations', 'Using privilege-separated migration pool for DDL operations');
  }

  try {
    const migrationRunner = new MigrationRunner(poolToUse, migrationsDir);
    const result = await migrationRunner.migrate();

    if (result.success) {
      migrationsCheckedThisSession = true;

      if (result.applied > 0) {
        const appliedList = result.appliedMigrations.join(', ');
        logger.info(CLASS_NAME, 'runAutoMigrations', `Applied ${result.applied} migration(s): ${appliedList}, skipped ${result.skipped}`);
        void vscode.window.showInformationMessage(
          `Gitr: Applied ${result.applied} database migration(s): ${appliedList}`
        );
      } else {
        logger.debug(CLASS_NAME, 'runAutoMigrations', `Database up to date (${result.skipped} skipped)`);
      }
      return true;
    }

    // Migration failed — block pipeline
    logger.critical(CLASS_NAME, 'runAutoMigrations', `Migration failed: ${result.error}`);
    const action = await vscode.window.showErrorMessage(
      `Gitr: Database migration failed — ${result.error}`,
      'View Logs'
    );
    if (action === 'View Logs') {
      logger.show();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.critical(CLASS_NAME, 'runAutoMigrations', `Migration error: ${message}`);
    const action = await vscode.window.showErrorMessage(
      `Gitr: Database migration error — ${message}`,
      'View Logs'
    );
    if (action === 'View Logs') {
      logger.show();
    }
  } finally {
    // Tear down the dedicated migration pool if one was created (IQS-880)
    if (migrationPool) {
      try {
        await migrationPool.end();
        logger.debug(CLASS_NAME, 'runAutoMigrations', 'Migration pool closed');
      } catch {
        // Ignore pool shutdown errors
      }
    }
  }

  // Migration failed or errored — shut down DB and block pipeline
  try {
    await dbService.shutdown();
  } catch {
    // Ignore shutdown errors during migration failure handling
  }
  return false;
}
