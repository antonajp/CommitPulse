import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  DatabaseService,
  type DatabaseServiceConfig,
} from '../../database/database-service.js';

/**
 * Integration tests for DatabaseService with a real PostgreSQL container.
 *
 * Uses Testcontainers to spin up a PostgreSQL 16 Docker container,
 * then exercises the full DatabaseService lifecycle:
 * - Pool initialization with real connectivity
 * - Parameterized queries against a real database
 * - Transactions with real BEGIN/COMMIT/ROLLBACK
 * - Health checks against a real running database
 * - Graceful shutdown
 *
 * Ticket: IQS-851
 */

const PG_DATABASE = 'gitrx_integration_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;

describe('DatabaseService Integration Tests', () => {
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
  }, 120_000); // Container startup can take up to 2 minutes

  afterAll(async () => {
    if (service?.isInitialized()) {
      await service.shutdown();
    }
    if (container) {
      await container.stop();
    }
  }, 30_000);

  beforeEach(async () => {
    // Reset logger
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Ensure service is fresh for each test
    if (service?.isInitialized()) {
      await service.shutdown();
    }
    service = new DatabaseService();
  });

  it('should initialize and connect to PostgreSQL container', async () => {
    await service.initialize(config);
    expect(service.isInitialized()).toBe(true);
  });

  it('should pass health check against running container', async () => {
    await service.initialize(config);

    const connected = await service.isConnected();
    expect(connected).toBe(true);
  });

  it('should execute a simple parameterized query', async () => {
    await service.initialize(config);

    const result = await service.query<{ result: number }>('SELECT $1::int AS result', [42]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.result).toBe(42);
    expect(result.rowCount).toBe(1);
  });

  it('should execute parameterized query with multiple parameters', async () => {
    await service.initialize(config);

    const result = await service.query<{ sum: number }>(
      'SELECT ($1::int + $2::int) AS sum',
      [10, 32],
    );
    expect(result.rows[0]?.sum).toBe(42);
  });

  it('should execute a transaction with CREATE TABLE and INSERT', async () => {
    await service.initialize(config);

    // Create a test table and insert data in a transaction
    const insertedId = await service.transaction(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS integration_test_table (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          value INT NOT NULL
        )
      `);

      const result = await client.query(
        'INSERT INTO integration_test_table (name, value) VALUES ($1, $2) RETURNING id',
        ['test_item', 100],
      );

      return result.rows[0]?.id as number;
    });

    expect(insertedId).toBeGreaterThan(0);

    // Verify the data persisted after the transaction
    const selectResult = await service.query<{ name: string; value: number }>(
      'SELECT name, value FROM integration_test_table WHERE id = $1',
      [insertedId],
    );
    expect(selectResult.rows[0]?.name).toBe('test_item');
    expect(selectResult.rows[0]?.value).toBe(100);
  });

  it('should rollback transaction on error', async () => {
    await service.initialize(config);

    // Create a clean test table
    await service.query(`
      CREATE TABLE IF NOT EXISTS rollback_test_table (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      )
    `);

    // Insert initial data
    await service.query(
      'INSERT INTO rollback_test_table (name) VALUES ($1) ON CONFLICT DO NOTHING',
      ['existing_item'],
    );

    // Attempt a transaction that should fail (duplicate unique constraint)
    await expect(
      service.transaction(async (client) => {
        await client.query(
          'INSERT INTO rollback_test_table (name) VALUES ($1)',
          ['new_item_1'],
        );
        // This should fail due to unique constraint violation
        await client.query(
          'INSERT INTO rollback_test_table (name) VALUES ($1)',
          ['existing_item'],
        );
      }),
    ).rejects.toThrow();

    // Verify rollback: new_item_1 should NOT be present
    const result = await service.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM rollback_test_table WHERE name = $1',
      ['new_item_1'],
    );
    expect(parseInt(result.rows[0]?.count ?? '0', 10)).toBe(0);
  });

  it('should return pool statistics', async () => {
    await service.initialize(config);

    const stats = service.getPoolStats();
    expect(stats).toBeDefined();
    expect(stats!.totalCount).toBeGreaterThanOrEqual(0);
    expect(stats!.idleCount).toBeGreaterThanOrEqual(0);
    expect(stats!.waitingCount).toBeGreaterThanOrEqual(0);
  });

  it('should provide pool access for MigrationRunner', async () => {
    await service.initialize(config);

    const pool = service.getPool();
    expect(pool).toBeDefined();

    // Verify pool is functional
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT 1 AS test');
      expect(result.rows[0]?.test).toBe(1);
    } finally {
      client.release();
    }
  });

  it('should reject SQL with template literal interpolation', async () => {
    await service.initialize(config);

    await expect(
      service.query('SELECT * FROM test WHERE name = \'${injection}\''),
    ).rejects.toThrow('SQL injection risk');
  });

  it('should gracefully shut down the pool', async () => {
    await service.initialize(config);
    expect(service.isInitialized()).toBe(true);

    await service.shutdown();
    expect(service.isInitialized()).toBe(false);
  });

  it('should fail health check after shutdown', async () => {
    await service.initialize(config);
    await service.shutdown();

    const connected = await service.isConnected();
    expect(connected).toBe(false);
  });

  it('should allow reinitialization after shutdown', async () => {
    await service.initialize(config);
    await service.shutdown();

    // Reset logger for reinitialization
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    await service.initialize(config);
    expect(service.isInitialized()).toBe(true);

    const connected = await service.isConnected();
    expect(connected).toBe(true);
  });

  it('should throw when querying without initialization', async () => {
    await expect(service.query('SELECT 1')).rejects.toThrow('not initialized');
  });

  it('should throw when starting transaction without initialization', async () => {
    await expect(
      service.transaction(async () => 'never'),
    ).rejects.toThrow('not initialized');
  });

  it('should handle query errors gracefully', async () => {
    await service.initialize(config);

    await expect(
      service.query('SELECT * FROM nonexistent_table_xyz'),
    ).rejects.toThrow();

    // Service should still be functional after a query error
    const connected = await service.isConnected();
    expect(connected).toBe(true);
  });

  it('should handle concurrent queries', async () => {
    await service.initialize(config);

    // Execute multiple queries concurrently
    const promises = Array.from({ length: 10 }, (_, i) =>
      service.query<{ result: number }>('SELECT $1::int AS result', [i]),
    );

    const results = await Promise.all(promises);

    for (let i = 0; i < results.length; i++) {
      expect(results[i]?.rows[0]?.result).toBe(i);
    }
  });
});
