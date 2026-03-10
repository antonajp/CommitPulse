import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  DatabaseService,
  buildConfigFromSettings,
  type DatabaseServiceConfig,
} from '../../database/database-service.js';

/**
 * Unit tests for the DatabaseService class.
 *
 * Tests the service interface, config building, error handling, and lifecycle.
 * Uses mock pg.Pool for isolation (no real database needed).
 *
 * Integration tests with a real PostgreSQL container are in
 * src/__tests__/integration/database-service.integration.test.ts
 *
 * Ticket: IQS-851
 */

// Mock pg module
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockOn = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    end: mockEnd,
    on: mockOn,
    query: mockQuery,
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  })),
}));

/**
 * Helper to create a valid config for tests.
 */
function createTestConfig(overrides?: Partial<DatabaseServiceConfig>): DatabaseServiceConfig {
  return {
    host: 'localhost',
    port: 5433,
    database: 'gitrx_test',
    user: 'test_user',
    password: 'test_password',
    ...overrides,
  };
}

/**
 * Helper to set up the mock pool's connect method to return a mock client.
 */
function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  // Default health check response
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

describe('DatabaseService', () => {
  let service: DatabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    service = new DatabaseService();
    setupMockClient();
  });

  afterEach(async () => {
    // Ensure pool is cleaned up
    if (service.isInitialized()) {
      await service.shutdown();
    }
  });

  describe('constructor', () => {
    it('should create service in uninitialized state', () => {
      expect(service.isInitialized()).toBe(false);
    });

    it('should not have a pool before initialization', () => {
      expect(service.getPoolStats()).toBeUndefined();
    });
  });

  describe('initialize', () => {
    it('should initialize the pool with config', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      expect(service.isInitialized()).toBe(true);
    });

    it('should verify connectivity with health check during initialization', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      // connect should be called at least once for the health check
      expect(mockConnect).toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledWith('SELECT 1 AS health');
    });

    it('should throw if health check fails during initialization', async () => {
      mockConnect.mockResolvedValue({
        query: vi.fn().mockRejectedValue(new Error('connection refused')),
        release: mockRelease,
      });

      const config = createTestConfig();
      await expect(service.initialize(config)).rejects.toThrow('Database health check failed');
    });

    it('should throw if already initialized', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      await expect(service.initialize(config)).rejects.toThrow('already initialized');
    });

    it('should register pool event handlers', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      // Should register error, connect, and remove handlers
      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('remove', expect.any(Function));
    });

    it('should use default pool size when not specified', async () => {
      const { Pool } = await import('pg');
      const config = createTestConfig();
      await service.initialize(config);

      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        max: 5,
      }));
    });

    it('should use custom pool size when specified', async () => {
      const { Pool } = await import('pg');
      const config = createTestConfig({ maxPoolSize: 10 });
      await service.initialize(config);

      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        max: 10,
      }));
    });

    it('should use custom timeouts when specified', async () => {
      const { Pool } = await import('pg');
      const config = createTestConfig({
        connectionTimeoutMs: 20_000,
        idleTimeoutMs: 60_000,
      });
      await service.initialize(config);

      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        connectionTimeoutMillis: 20_000,
        idleTimeoutMillis: 60_000,
      }));
    });
  });

  describe('query', () => {
    it('should execute a parameterized query and return results', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      // Reset mock after health check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, name: 'test' }],
        rowCount: 1,
      });

      const result = await service.query('SELECT * FROM test WHERE id = $1', [1]);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({ id: 1, name: 'test' });
      expect(result.rowCount).toBe(1);
    });

    it('should execute a query with no parameters', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      mockQuery.mockResolvedValueOnce({
        rows: [{ count: 42 }],
        rowCount: 1,
      });

      const result = await service.query('SELECT COUNT(*) AS count FROM test');
      expect(result.rows[0]).toEqual({ count: 42 });
    });

    it('should throw if pool is not initialized', async () => {
      await expect(service.query('SELECT 1')).rejects.toThrow('not initialized');
    });

    it('should reject SQL with template literal interpolation', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      await expect(
        service.query('SELECT * FROM test WHERE name = \'${userInput}\''),
      ).rejects.toThrow('SQL injection risk');
    });

    it('should release client back to pool after successful query', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await service.query('SELECT 1');
      // release called for health check + query
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should release client back to pool after failed query', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      mockQuery.mockRejectedValueOnce(new Error('query error'));

      await expect(service.query('SELECT invalid')).rejects.toThrow('query error');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should handle null rowCount from pg', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: null,
      });

      const result = await service.query('INSERT INTO test VALUES ($1)', ['test']);
      expect(result.rowCount).toBe(0);
    });
  });

  describe('transaction', () => {
    it('should execute callback within BEGIN/COMMIT', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      const callOrder: string[] = [];
      mockQuery.mockImplementation(async (sql: string) => {
        callOrder.push(sql);
        return { rows: [], rowCount: 0 };
      });

      await service.transaction(async (client) => {
        await client.query('INSERT INTO test VALUES ($1)', ['hello']);
        return 'done';
      });

      expect(callOrder).toContain('BEGIN');
      expect(callOrder).toContain('INSERT INTO test VALUES ($1)');
      expect(callOrder).toContain('COMMIT');
    });

    it('should return the value from the callback', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await service.transaction(async () => {
        return { success: true, count: 42 };
      });

      expect(result).toEqual({ success: true, count: 42 });
    });

    it('should ROLLBACK on callback error', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      const callOrder: string[] = [];
      mockQuery.mockImplementation(async (sql: string) => {
        callOrder.push(sql);
        if (sql === 'INSERT INTO test VALUES ($1)') {
          throw new Error('insert failed');
        }
        return { rows: [], rowCount: 0 };
      });

      await expect(
        service.transaction(async (client) => {
          await client.query('INSERT INTO test VALUES ($1)', ['bad']);
        }),
      ).rejects.toThrow('insert failed');

      expect(callOrder).toContain('BEGIN');
      expect(callOrder).toContain('ROLLBACK');
      expect(callOrder).not.toContain('COMMIT');
    });

    it('should throw if pool is not initialized', async () => {
      await expect(
        service.transaction(async () => 'never'),
      ).rejects.toThrow('not initialized');
    });

    it('should release client after successful transaction', async () => {
      const config = createTestConfig();
      await service.initialize(config);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.transaction(async () => 'ok');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should release client after failed transaction', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      mockQuery.mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return { rows: [], rowCount: 0 };
        throw new Error('boom');
      });

      await expect(
        service.transaction(async (client) => {
          await client.query('FAIL');
        }),
      ).rejects.toThrow('boom');

      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return true when health check succeeds', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      mockQuery.mockResolvedValueOnce({ rows: [{ health: 1 }], rowCount: 1 });

      const connected = await service.isConnected();
      expect(connected).toBe(true);
    });

    it('should return false when health check fails', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      mockConnect.mockResolvedValueOnce({
        query: vi.fn().mockRejectedValue(new Error('connection lost')),
        release: mockRelease,
      });

      const connected = await service.isConnected();
      expect(connected).toBe(false);
    });

    it('should return false when pool is not initialized', async () => {
      const connected = await service.isConnected();
      expect(connected).toBe(false);
    });
  });

  describe('getPoolStats', () => {
    it('should return pool statistics when initialized', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      const stats = service.getPoolStats();
      expect(stats).toBeDefined();
      expect(stats?.totalCount).toBe(5);
      expect(stats?.idleCount).toBe(3);
      expect(stats?.waitingCount).toBe(0);
    });

    it('should return undefined when not initialized', () => {
      const stats = service.getPoolStats();
      expect(stats).toBeUndefined();
    });
  });

  describe('getPool', () => {
    it('should return the pg Pool when initialized', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      const pool = service.getPool();
      expect(pool).toBeDefined();
    });

    it('should throw when not initialized', () => {
      expect(() => service.getPool()).toThrow('not initialized');
    });
  });

  describe('shutdown', () => {
    it('should drain the pool on shutdown', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      await service.shutdown();

      expect(mockEnd).toHaveBeenCalled();
      expect(service.isInitialized()).toBe(false);
    });

    it('should be safe to call when not initialized', async () => {
      await expect(service.shutdown()).resolves.not.toThrow();
    });

    it('should handle pool.end() errors gracefully', async () => {
      const config = createTestConfig();
      await service.initialize(config);

      mockEnd.mockRejectedValueOnce(new Error('end failed'));

      // Should not throw
      await expect(service.shutdown()).resolves.not.toThrow();
      expect(service.isInitialized()).toBe(false);
    });

    it('should allow reinitialization after shutdown', async () => {
      const config = createTestConfig();
      await service.initialize(config);
      await service.shutdown();

      // Reset mock for reinitialization
      setupMockClient();
      await service.initialize(config);
      expect(service.isInitialized()).toBe(true);
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      expect(service.isInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      const config = createTestConfig();
      await service.initialize(config);
      expect(service.isInitialized()).toBe(true);
    });

    it('should return false after shutdown', async () => {
      const config = createTestConfig();
      await service.initialize(config);
      await service.shutdown();
      expect(service.isInitialized()).toBe(false);
    });
  });
});

describe('buildConfigFromSettings', () => {
  beforeEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  it('should build config from DatabaseSettings and password', () => {
    const settings = {
      host: 'db.example.com',
      port: 5432,
      name: 'mydb',
      user: 'admin',
    };

    const config = buildConfigFromSettings(settings, 'secret123');

    expect(config.host).toBe('db.example.com');
    expect(config.port).toBe(5432);
    expect(config.database).toBe('mydb');
    expect(config.user).toBe('admin');
    expect(config.password).toBe('secret123');
  });

  it('should map settings.name to config.database', () => {
    const settings = {
      host: 'localhost',
      port: 5433,
      name: 'gitrx',
      user: 'gitrx_admin',
    };

    const config = buildConfigFromSettings(settings, 'pw');
    expect(config.database).toBe('gitrx');
  });

  it('should use default values from settings', () => {
    const settings = {
      host: 'localhost',
      port: 5433,
      name: 'gitrx',
      user: 'gitrx_admin',
    };

    const config = buildConfigFromSettings(settings, 'pw');
    expect(config.maxPoolSize).toBeUndefined();
    expect(config.connectionTimeoutMs).toBeUndefined();
    expect(config.idleTimeoutMs).toBeUndefined();
  });
});
