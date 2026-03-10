import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { LoggerService } from '../logging/logger.js';
import { DatabaseSettings } from '../config/settings.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DatabaseService';

/**
 * Default connection pool size.
 * Matches a reasonable default for a VS Code extension workload.
 */
const DEFAULT_POOL_SIZE = 5;

/**
 * Default connection timeout in milliseconds (10 seconds).
 */
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Default idle timeout in milliseconds (30 seconds).
 * Idle connections are released after this period.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/**
 * Delay between reconnection attempts in milliseconds (5 seconds).
 */
const RECONNECT_DELAY_MS = 5_000;

/**
 * Maximum number of consecutive reconnection attempts before giving up.
 */
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Health check SQL query. Uses a lightweight SELECT 1 for minimal overhead.
 */
const HEALTH_CHECK_SQL = 'SELECT 1 AS health';

/**
 * Configuration for the DatabaseService connection pool.
 * Combines VS Code settings with SecretStorage password.
 */
export interface DatabaseServiceConfig {
  /** PostgreSQL host. */
  readonly host: string;
  /** PostgreSQL port. */
  readonly port: number;
  /** PostgreSQL database name. */
  readonly database: string;
  /** PostgreSQL user. */
  readonly user: string;
  /** PostgreSQL password (from SecretStorage). */
  readonly password: string;
  /** Maximum number of clients in the pool. Default: 5. */
  readonly maxPoolSize?: number;
  /** Connection timeout in milliseconds. Default: 10000. */
  readonly connectionTimeoutMs?: number;
  /** Idle timeout in milliseconds. Default: 30000. */
  readonly idleTimeoutMs?: number;
}

/**
 * Result of a parameterized query execution.
 * Wraps pg's QueryResult with a cleaner interface.
 */
export interface DatabaseQueryResult<T extends QueryResultRow = QueryResultRow> {
  /** Array of result rows. */
  readonly rows: T[];
  /** Number of rows returned or affected. */
  readonly rowCount: number;
}

/**
 * Callback type for transaction operations.
 * Receives a PoolClient for executing queries within the transaction.
 * The transaction is automatically committed on success or rolled back on error.
 */
export type TransactionCallback<T> = (client: PoolClient) => Promise<T>;

/**
 * Build a DatabaseServiceConfig from VS Code settings and a password.
 *
 * @param settings - Database settings from VS Code configuration
 * @param password - Database password from SecretStorage
 * @returns A DatabaseServiceConfig ready for pool initialization
 */
export function buildConfigFromSettings(
  settings: DatabaseSettings,
  password: string,
): DatabaseServiceConfig {
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'buildConfigFromSettings', `Building config: ${settings.host}:${settings.port}/${settings.name}`);

  return {
    host: settings.host,
    port: settings.port,
    database: settings.name,
    user: settings.user,
    password,
  };
}

/**
 * DatabaseService provides a managed PostgreSQL connection pool for the gitr extension.
 *
 * Maps from Python's PostgresDB.__init__() (legacy/python/PostgresDB.py lines 12-46),
 * replacing the single psycopg connection with a pg.Pool for better concurrency
 * and resource management.
 *
 * CRITICAL: The Python version uses string interpolation for SQL (SQL injection risk).
 * This TypeScript version MUST use parameterized queries exclusively via $1, $2 placeholders.
 *
 * Features:
 * - Connection pool with configurable size (default 5)
 * - Parameterized query execution (no string interpolation)
 * - Transaction support with automatic BEGIN/COMMIT/ROLLBACK
 * - Health check via lightweight SELECT 1
 * - Auto-reconnection on connection loss
 * - Graceful shutdown on extension deactivation
 * - Debug logging throughout for LLM interaction transparency
 *
 * Ticket: IQS-851
 */
export class DatabaseService {
  private readonly logger: LoggerService;
  private pool: Pool | undefined;
  private config: DatabaseServiceConfig | undefined;
  private isShuttingDown = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'DatabaseService created (pool not yet initialized)');
  }

  /**
   * Initialize the connection pool with the provided configuration.
   * Must be called before any query or transaction operations.
   *
   * Maps from PostgresDB.__init__() psycopg.connect() call.
   *
   * @param config - Database connection configuration
   * @throws Error if the pool is already initialized
   */
  async initialize(config: DatabaseServiceConfig): Promise<void> {
    this.logger.info(CLASS_NAME, 'initialize', `Initializing pool: ${config.host}:${config.port}/${config.database} (user: ${config.user})`);

    if (this.pool) {
      this.logger.warn(CLASS_NAME, 'initialize', 'Pool already initialized. Call shutdown() first to reinitialize.');
      throw new Error('DatabaseService is already initialized. Call shutdown() before reinitializing.');
    }

    this.config = config;
    this.isShuttingDown = false;
    this.reconnectAttempts = 0;

    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.maxPoolSize ?? DEFAULT_POOL_SIZE,
      connectionTimeoutMillis: config.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    };

    this.logger.debug(CLASS_NAME, 'initialize', `Pool config: max=${poolConfig.max}, connectTimeout=${poolConfig.connectionTimeoutMillis}ms, idleTimeout=${poolConfig.idleTimeoutMillis}ms`);

    this.pool = new Pool(poolConfig);

    // Register pool-level error handler for unexpected disconnections
    this.pool.on('error', (err: Error) => {
      this.logger.error(CLASS_NAME, 'pool.on(error)', `Unexpected pool error: ${err.message}`, err);
      void this.handleConnectionLoss();
    });

    // Register connect event for logging
    this.pool.on('connect', () => {
      this.logger.trace(CLASS_NAME, 'pool.on(connect)', 'New client connected to pool');
      this.reconnectAttempts = 0;
    });

    // Register remove event for logging
    this.pool.on('remove', () => {
      this.logger.trace(CLASS_NAME, 'pool.on(remove)', 'Client removed from pool');
    });

    // Verify connectivity with a health check
    this.logger.debug(CLASS_NAME, 'initialize', 'Verifying connectivity with initial health check...');
    const healthy = await this.isConnected();
    if (!healthy) {
      this.logger.error(CLASS_NAME, 'initialize', 'Initial health check failed. Pool created but database may be unreachable.');
      throw new Error('Database health check failed during initialization. Verify the database is running and connection settings are correct.');
    }

    this.logger.info(CLASS_NAME, 'initialize', 'DatabaseService initialized successfully. Pool is healthy.');
  }

  /**
   * Execute a parameterized SQL query.
   *
   * CRITICAL: All SQL MUST use $1, $2 placeholders. String interpolation is forbidden.
   * This replaces the Python version's cursor.execute(f"...") calls which were
   * vulnerable to SQL injection.
   *
   * @param sql - SQL query with $1, $2 parameter placeholders
   * @param params - Array of parameter values (positional, matching $1, $2, etc.)
   * @returns Query result with rows and row count
   * @throws Error if the pool is not initialized
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<DatabaseQueryResult<T>> {
    this.ensureInitialized();

    this.logger.trace(CLASS_NAME, 'query', `Executing query: ${this.truncateSql(sql)} with ${params.length} parameter(s)`);

    // Safety check: warn if SQL appears to contain string interpolation
    if (sql.includes('${')) {
      this.logger.critical(CLASS_NAME, 'query', 'SECURITY: SQL contains template literal interpolation. Use parameterized queries with $1, $2 placeholders.');
      throw new Error('SQL injection risk detected: query contains template literal interpolation. Use parameterized queries.');
    }

    const client = await this.pool!.connect();
    try {
      this.logger.trace(CLASS_NAME, 'query', 'Client acquired from pool');
      const result: QueryResult<T> = await client.query<T>(sql, params as unknown[]);
      this.logger.trace(CLASS_NAME, 'query', `Query complete: ${result.rowCount ?? 0} row(s) affected/returned`);

      return {
        rows: result.rows,
        rowCount: result.rowCount ?? 0,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'query', `Query failed: ${message}`);
      throw error;
    } finally {
      client.release();
      this.logger.trace(CLASS_NAME, 'query', 'Client released back to pool');
    }
  }

  /**
   * Execute a series of operations within a database transaction.
   *
   * Automatically issues BEGIN before the callback, COMMIT on success,
   * and ROLLBACK on error. Maps from Python's execute_sql_file_with_rollback()
   * but with proper transaction semantics.
   *
   * @param callback - Async function receiving a PoolClient for executing queries
   * @returns The value returned by the callback
   * @throws Error if the pool is not initialized or if the transaction fails
   */
  async transaction<T>(callback: TransactionCallback<T>): Promise<T> {
    this.ensureInitialized();

    this.logger.debug(CLASS_NAME, 'transaction', 'Beginning transaction');

    const client = await this.pool!.connect();
    try {
      this.logger.trace(CLASS_NAME, 'transaction', 'Client acquired, issuing BEGIN');
      await client.query('BEGIN');

      const result = await callback(client);

      this.logger.trace(CLASS_NAME, 'transaction', 'Callback completed, issuing COMMIT');
      await client.query('COMMIT');
      this.logger.debug(CLASS_NAME, 'transaction', 'Transaction committed successfully');

      return result;
    } catch (error: unknown) {
      this.logger.debug(CLASS_NAME, 'transaction', 'Transaction failed, issuing ROLLBACK');
      try {
        await client.query('ROLLBACK');
        this.logger.debug(CLASS_NAME, 'transaction', 'ROLLBACK completed');
      } catch (rollbackError: unknown) {
        const rollbackMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        this.logger.error(CLASS_NAME, 'transaction', `ROLLBACK failed: ${rollbackMsg}`);
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'transaction', `Transaction failed: ${message}`);
      throw error;
    } finally {
      client.release();
      this.logger.trace(CLASS_NAME, 'transaction', 'Client released back to pool');
    }
  }

  /**
   * Check whether the database connection is healthy.
   *
   * Executes a lightweight SELECT 1 query. If it succeeds, the connection is healthy.
   * This is used for initial connectivity verification and periodic health monitoring.
   *
   * @returns true if the database is reachable and responding
   */
  async isConnected(): Promise<boolean> {
    if (!this.pool) {
      this.logger.debug(CLASS_NAME, 'isConnected', 'Pool not initialized, returning false');
      return false;
    }

    this.logger.trace(CLASS_NAME, 'isConnected', 'Executing health check query');

    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query(HEALTH_CHECK_SQL);
      this.logger.trace(CLASS_NAME, 'isConnected', 'Health check passed');
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'isConnected', `Health check failed: ${message}`);
      return false;
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Get the current pool statistics for monitoring.
   *
   * @returns Pool statistics or undefined if not initialized
   */
  getPoolStats(): PoolStats | undefined {
    if (!this.pool) {
      return undefined;
    }

    const stats: PoolStats = {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };

    this.logger.trace(CLASS_NAME, 'getPoolStats', `Pool stats: total=${stats.totalCount}, idle=${stats.idleCount}, waiting=${stats.waitingCount}`);
    return stats;
  }

  /**
   * Get the underlying pg Pool instance.
   * Use sparingly -- prefer query() and transaction() for standard operations.
   * Required by MigrationRunner which needs direct pool access.
   *
   * @returns The pg Pool instance
   * @throws Error if the pool is not initialized
   */
  getPool(): Pool {
    this.ensureInitialized();
    return this.pool!;
  }

  /**
   * Gracefully shut down the connection pool.
   * Waits for active queries to complete, then drains all connections.
   *
   * Maps from Python's PostgresDB.__del__() which calls self.conn.close().
   * Called during extension deactivation.
   */
  async shutdown(): Promise<void> {
    this.logger.info(CLASS_NAME, 'shutdown', 'Shutting down DatabaseService...');

    this.isShuttingDown = true;

    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      this.logger.debug(CLASS_NAME, 'shutdown', 'Cleared pending reconnection timer');
    }

    if (!this.pool) {
      this.logger.debug(CLASS_NAME, 'shutdown', 'Pool was not initialized, nothing to shut down');
      return;
    }

    try {
      const stats = this.getPoolStats();
      this.logger.debug(CLASS_NAME, 'shutdown', `Pool stats before drain: total=${stats?.totalCount}, idle=${stats?.idleCount}, waiting=${stats?.waitingCount}`);

      await this.pool.end();
      this.logger.info(CLASS_NAME, 'shutdown', 'Connection pool drained successfully');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'shutdown', `Error draining pool: ${message}`);
    } finally {
      this.pool = undefined;
      this.config = undefined;
      this.reconnectAttempts = 0;
    }
  }

  /**
   * Whether the service has been initialized with a pool.
   */
  isInitialized(): boolean {
    return this.pool !== undefined;
  }

  /**
   * Handle connection loss by attempting auto-reconnection.
   *
   * Uses exponential backoff with a maximum of MAX_RECONNECT_ATTEMPTS.
   * If all attempts fail, the service remains in a disconnected state
   * and callers will receive errors on subsequent operations.
   */
  private async handleConnectionLoss(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.debug(CLASS_NAME, 'handleConnectionLoss', 'Shutdown in progress, skipping reconnection');
      return;
    }

    if (!this.config) {
      this.logger.error(CLASS_NAME, 'handleConnectionLoss', 'No config available for reconnection');
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.logger.critical(CLASS_NAME, 'handleConnectionLoss', `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Manual intervention required.`);
      return;
    }

    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;
    this.logger.warn(CLASS_NAME, 'handleConnectionLoss', `Connection lost. Reconnection attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

    // Clear existing pool before reconnecting
    if (this.pool) {
      try {
        await this.pool.end();
      } catch {
        // Ignore errors when ending a broken pool
      }
      this.pool = undefined;
    }

    // Schedule reconnection with delay
    this.reconnectTimer = setTimeout(() => {
      this.logger.info(CLASS_NAME, 'handleConnectionLoss', `Attempting reconnection (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      const savedConfig = this.config;
      if (!savedConfig) {
        this.logger.error(CLASS_NAME, 'handleConnectionLoss', 'Config lost during reconnection delay');
        return;
      }
      this.config = undefined; // Clear so initialize() doesn't reject
      this.initialize(savedConfig).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(CLASS_NAME, 'handleConnectionLoss', `Reconnection attempt ${this.reconnectAttempts} failed: ${message}`);
        this.config = savedConfig; // Restore config for next attempt
        void this.handleConnectionLoss();
      });
    }, delay);
  }

  /**
   * Ensure the pool is initialized before executing operations.
   *
   * @throws Error if the pool has not been initialized
   */
  private ensureInitialized(): void {
    if (!this.pool) {
      this.logger.error(CLASS_NAME, 'ensureInitialized', 'DatabaseService not initialized. Call initialize() first.');
      throw new Error('DatabaseService is not initialized. Call initialize() with a valid configuration before performing database operations.');
    }
  }

  /**
   * Truncate SQL for logging to avoid logging sensitive or overly long queries.
   *
   * @param sql - The SQL string to truncate
   * @returns A truncated version safe for logging
   */
  private truncateSql(sql: string): string {
    const maxLength = 200;
    const trimmed = sql.replace(/\s+/g, ' ').trim();
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    return trimmed.substring(0, maxLength) + '...';
  }
}

/**
 * Pool statistics for monitoring.
 */
export interface PoolStats {
  /** Total number of clients in the pool (active + idle). */
  readonly totalCount: number;
  /** Number of idle clients ready for use. */
  readonly idleCount: number;
  /** Number of queued requests waiting for a client. */
  readonly waitingCount: number;
}
