import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import {
  PipelineRepository,
  type PipelineRunStart,
  type PipelineLogEntry,
} from '../../database/pipeline-repository.js';

/**
 * Unit tests for PipelineRepository class.
 *
 * Tests all insert/update and table count methods using a mocked DatabaseService.
 * Verifies parameterized SQL and the table name allowlist security mechanism.
 *
 * Ticket: IQS-853
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

function createTestConfig(): DatabaseServiceConfig {
  return {
    host: 'localhost',
    port: 5433,
    database: 'gitrx_test',
    user: 'test_user',
    password: 'test_password',
  };
}

function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

describe('PipelineRepository', () => {
  let dbService: DatabaseService;
  let repo: PipelineRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createTestConfig());
    repo = new PipelineRepository(dbService);
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // --------------------------------------------------------------------------
  // Pipeline run methods
  // --------------------------------------------------------------------------

  describe('insertPipelineStart', () => {
    it('should insert and return the generated pipeline run ID', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 42 }],
        rowCount: 1,
      });

      const run: PipelineRunStart = {
        className: 'GitCommitPipeline',
        context: 'main',
        detail: 'Full pipeline run',
        status: 'START',
      };

      const id = await repo.insertPipelineStart(run);

      expect(id).toBe(42);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO gitr_pipeline_run'),
      );
      expect(insertCall).toBeDefined();
      // Params: className, context, detail, now, status
      expect(insertCall![1][0]).toBe('GitCommitPipeline');
      expect(insertCall![1][1]).toBe('main');
      expect(insertCall![1][2]).toBe('Full pipeline run');
      expect(insertCall![1][3]).toBeInstanceOf(Date);
      expect(insertCall![1][4]).toBe('START');
    });

    it('should throw when RETURNING id produces no rows', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const run: PipelineRunStart = {
        className: 'Test', context: 'test', detail: 'test', status: 'START',
      };

      await expect(repo.insertPipelineStart(run)).rejects.toThrow('RETURNING id produced no rows');
    });
  });

  describe('insertPipelineLog', () => {
    it('should insert log entry and return generated ID', async () => {
      // Transaction: BEGIN, INSERT log, COMMIT
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }) // INSERT RETURNING
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const entry: PipelineLogEntry = {
        parentId: 42,
        className: 'GitCommitPipeline',
        context: 'processRepo',
        detail: 'Processing repository: test-repo',
        msgLevel: 1, // DEBUG
      };

      const id = await repo.insertPipelineLog(entry);

      expect(id).toBe(99);
    });

    it('should insert SHA link when sha is provided', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }) // INSERT log
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT sha
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const entry: PipelineLogEntry = {
        parentId: 42, className: 'Test', context: 'test',
        detail: 'test', msgLevel: 1,
      };

      await repo.insertPipelineLog(entry, 'abc123def456');

      const shaCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('gitr_pipeline_sha'),
      );
      expect(shaCall).toBeDefined();
      expect(shaCall![1]).toEqual([99, 'abc123def456']);
    });

    it('should insert Jira link when jiraKey is provided', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }) // INSERT log
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT jira
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const entry: PipelineLogEntry = {
        parentId: 42, className: 'Test', context: 'test',
        detail: 'test', msgLevel: 1,
      };

      await repo.insertPipelineLog(entry, undefined, 'IQS-100');

      const jiraCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('gitr_pipeline_jira'),
      );
      expect(jiraCall).toBeDefined();
      expect(jiraCall![1]).toEqual([99, 'IQS-100']);
    });

    it('should insert both SHA and Jira links when both provided', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }) // INSERT log
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT sha
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT jira
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const entry: PipelineLogEntry = {
        parentId: 42, className: 'Test', context: 'test',
        detail: 'test', msgLevel: 1,
      };

      await repo.insertPipelineLog(entry, 'sha123', 'IQS-200');

      const shaCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('gitr_pipeline_sha'),
      );
      const jiraCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('gitr_pipeline_jira'),
      );
      expect(shaCall).toBeDefined();
      expect(jiraCall).toBeDefined();
    });

    it('should throw when RETURNING id produces no rows', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT with no RETURNING
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

      const entry: PipelineLogEntry = {
        parentId: 42, className: 'Test', context: 'test',
        detail: 'test', msgLevel: 1,
      };

      await expect(repo.insertPipelineLog(entry)).rejects.toThrow('RETURNING id produced no rows');
    });
  });

  describe('updatePipelineRun', () => {
    it('should update with parameterized SQL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await repo.updatePipelineRun(42, 'FINISHED');

      const updateCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE gitr_pipeline_run'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1][0]).toBeInstanceOf(Date); // end_time
      expect(updateCall![1][1]).toBe('FINISHED'); // status
      expect(updateCall![1][2]).toBe(42); // id
    });
  });

  // --------------------------------------------------------------------------
  // Table count logging
  // --------------------------------------------------------------------------

  describe('logTableCounts', () => {
    it('should count allowed tables and insert results', async () => {
      // Count query + Insert query for each table
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1 }) // count commit_history
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // insert count
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1 }) // count jira_detail
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // insert count

      await repo.logTableCounts(42, ['commit_history', 'jira_detail']);

      const countCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('COUNT(*)'),
      );
      expect(countCalls.length).toBe(2);

      const insertCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('gitja_pipeline_table_counts'),
      );
      expect(insertCalls.length).toBe(2);
    });

    it('should skip disallowed table names', async () => {
      // No count queries should be made for disallowed tables
      await repo.logTableCounts(42, ['DROP TABLE users', 'malicious_table']);

      const countCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('COUNT(*)'),
      );
      expect(countCalls.length).toBe(0);
    });

    it('should reject SQL injection via table name', async () => {
      await repo.logTableCounts(42, ["commit_history; DROP TABLE commit_history; --"]);

      // Should not have executed any count query
      const countCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('COUNT(*)'),
      );
      expect(countCalls.length).toBe(0);
    });

    it('should reject table names with uppercase or special characters', async () => {
      await repo.logTableCounts(42, ['CommitHistory', 'commit-history', 'commit.history']);

      const countCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('COUNT(*)'),
      );
      expect(countCalls.length).toBe(0);
    });

    it('should continue processing when one table count fails', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('Table not found')) // count fails for first
        .mockResolvedValueOnce({ rows: [{ count: '200' }], rowCount: 1 }) // count succeeds for second
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // insert count for second

      await repo.logTableCounts(42, ['commit_history', 'jira_detail']);

      // Should have attempted both
      const countCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('COUNT(*)'),
      );
      expect(countCalls.length).toBe(2);
    });

    it('should handle empty table list', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.logTableCounts(42, []);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('getAllowedCountTables', () => {
    it('should return all expected tables', async () => {
      const allowed = PipelineRepository.getAllowedCountTables();

      expect(allowed.has('commit_history')).toBe(true);
      expect(allowed.has('jira_detail')).toBe(true);
      expect(allowed.has('gitr_pipeline_run')).toBe(true);
      expect(allowed.has('gitr_pipeline_log')).toBe(true);
      expect(allowed.has('gitja_team_contributor')).toBe(true);
      expect(allowed.has('gitja_pipeline_table_counts')).toBe(true);
    });

    it('should not contain suspicious names', async () => {
      const allowed = PipelineRepository.getAllowedCountTables();

      expect(allowed.has('DROP TABLE')).toBe(false);
      expect(allowed.has('')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // SQL injection prevention
  // --------------------------------------------------------------------------

  describe('SQL injection prevention', () => {
    it('should parameterize pipeline run ID in update', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      await repo.updatePipelineRun(42, "'; DROP TABLE gitr_pipeline_run; --");

      const updateCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE gitr_pipeline_run'),
      );
      expect(updateCall).toBeDefined();
      expect((updateCall![0] as string)).not.toContain('DROP TABLE');
      expect(updateCall![1][1]).toBe("'; DROP TABLE gitr_pipeline_run; --");
    });

    it('should parameterize log entry fields', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // INSERT RETURNING
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const entry: PipelineLogEntry = {
        parentId: 42,
        className: "'; DROP TABLE gitr_pipeline_log; --",
        context: 'test',
        detail: 'test',
        msgLevel: 1,
      };

      await repo.insertPipelineLog(entry);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO gitr_pipeline_log'),
      );
      expect(insertCall).toBeDefined();
      expect((insertCall![0] as string)).not.toContain('DROP TABLE');
    });
  });
});
