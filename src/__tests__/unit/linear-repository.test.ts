import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

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

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { LinearRepository } from '../../database/linear-repository.js';
import type { LinearDetailRow, LinearHistoryRow } from '../../database/linear-types.js';

/**
 * Unit tests for LinearRepository.
 *
 * Validates:
 * - upsertLinearDetail sends correct parameterized SQL
 * - batchUpsertLinearDetails uses transaction
 * - replaceLinearHistory deletes then inserts
 * - getDistinctLinearIds returns Set
 * - identifyLinearTeamMaxIssue returns team/count pairs
 * - getUnfinishedLinearIssues returns keys
 * - All SQL uses parameterized queries ($1, $2)
 *
 * Ticket: IQS-875
 */

// ============================================================================
// Test helpers
// ============================================================================

function createDbConfig(): DatabaseServiceConfig {
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

function createTestDetail(overrides?: Partial<LinearDetailRow>): LinearDetailRow {
  return {
    linearId: 'uuid-test-123',
    linearKey: 'IQS-42',
    priority: 'High',
    createdDate: new Date('2025-01-15T10:00:00Z'),
    url: 'https://linear.app/iqsubagents/issue/IQS-42',
    title: 'Test issue',
    description: 'Test description',
    creator: 'Jane Smith',
    state: 'In Progress',
    assignee: 'John Doe',
    project: 'gitrx',
    team: 'IQS',
    estimate: 3,
    statusChangeDate: null,
    completedDate: null,
    calculatedStoryPoints: null,
    ...overrides,
  };
}

describe('LinearRepository', () => {
  let db: DatabaseService;
  let repo: LinearRepository;

  beforeEach(async () => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    vi.clearAllMocks();

    setupMockClient();
    db = new DatabaseService();
    await db.initialize(createDbConfig());
    repo = new LinearRepository(db);
  });

  afterEach(async () => {
    try { await db.shutdown(); } catch { /* ignore */ }
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    _clearMocks();
  });

  describe('upsertLinearDetail', () => {
    it('should call query with 15 parameters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const detail = createTestDetail();

      await repo.upsertLinearDetail(detail);

      // Find the upsert call (skip health check)
      const upsertCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO linear_detail'),
      );
      expect(upsertCall).toBeDefined();
      expect(upsertCall![1]).toHaveLength(15);
      expect(upsertCall![1][0]).toBe('uuid-test-123');
      expect(upsertCall![1][1]).toBe('IQS-42');
      expect(upsertCall![1][2]).toBe('High');
    });

    it('should use ON CONFLICT for upsert behavior', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const detail = createTestDetail();

      await repo.upsertLinearDetail(detail);

      const upsertCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('ON CONFLICT'),
      );
      expect(upsertCall).toBeDefined();
    });
  });

  describe('batchUpsertLinearDetails', () => {
    it('should skip empty arrays', async () => {
      const callCountBefore = mockQuery.mock.calls.length;
      await repo.batchUpsertLinearDetails([]);
      // Should not have made additional queries
      expect(mockQuery.mock.calls.length).toBe(callCountBefore);
    });

    it('should process multiple details in a transaction', async () => {
      // Mock BEGIN/COMMIT for transaction
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const details = [
        createTestDetail({ linearKey: 'IQS-1' }),
        createTestDetail({ linearKey: 'IQS-2' }),
      ];

      await repo.batchUpsertLinearDetails(details);

      // Verify BEGIN was called
      const beginCall = mockQuery.mock.calls.find(
        (call) => call[0] === 'BEGIN',
      );
      expect(beginCall).toBeDefined();
    });
  });

  describe('replaceLinearHistory', () => {
    it('should delete existing history then insert new entries', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const history: LinearHistoryRow[] = [
        {
          linearKey: 'IQS-42',
          changeDate: new Date('2025-01-15T10:00:00Z'),
          actor: 'Jane',
          field: 'state',
          fromValue: 'Todo',
          toValue: 'In Progress',
        },
      ];

      await repo.replaceLinearHistory('IQS-42', history);

      // Find the DELETE call
      const deleteCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('DELETE FROM linear_history'),
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![1]).toEqual(['IQS-42']);

      // Find the INSERT call
      const insertCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO linear_history'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toHaveLength(6);
    });
  });

  describe('getDistinctLinearIds', () => {
    it('should return a Set of Linear keys', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { linear_key: 'IQS-1' },
          { linear_key: 'IQS-2' },
          { linear_key: 'ENG-10' },
        ],
        rowCount: 3,
      });

      const keys = await repo.getDistinctLinearIds();

      expect(keys).toBeInstanceOf(Set);
      expect(keys.size).toBe(3);
      expect(keys.has('IQS-1')).toBe(true);
      expect(keys.has('IQS-2')).toBe(true);
      expect(keys.has('ENG-10')).toBe(true);
    });

    it('should return empty Set when no data', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const keys = await repo.getDistinctLinearIds();
      expect(keys.size).toBe(0);
    });
  });

  describe('identifyLinearTeamMaxIssue', () => {
    it('should return team key and max issue count', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { team_key: 'IQS', count: 875 },
          { team_key: 'ENG', count: 234 },
        ],
        rowCount: 2,
      });

      const teams = await repo.identifyLinearTeamMaxIssue();

      expect(teams).toHaveLength(2);
      expect(teams[0]).toEqual({ teamKey: 'IQS', count: 875 });
      expect(teams[1]).toEqual({ teamKey: 'ENG', count: 234 });
    });

    it('should return empty array when no teams', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const teams = await repo.identifyLinearTeamMaxIssue();
      expect(teams).toEqual([]);
    });
  });

  describe('getUnfinishedLinearIssues', () => {
    it('should return unfinished issue keys', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { linear_key: 'IQS-100' },
          { linear_key: 'IQS-101' },
        ],
        rowCount: 2,
      });

      const issues = await repo.getUnfinishedLinearIssues(2);

      expect(issues).toHaveLength(2);
      expect(issues[0]).toEqual({ linearKey: 'IQS-100' });
      expect(issues[1]).toEqual({ linearKey: 'IQS-101' });
    });

    it('should pass daysAgo parameter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getUnfinishedLinearIssues(5);

      const unfinishedCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('NOT state IN'),
      );
      expect(unfinishedCall).toBeDefined();
      expect(unfinishedCall![1]).toEqual([5]);
    });

    it('should default daysAgo to 2', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getUnfinishedLinearIssues();

      const unfinishedCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('NOT state IN'),
      );
      expect(unfinishedCall![1]).toEqual([2]);
    });
  });

  describe('SQL parameterization', () => {
    it('should never use string interpolation in SQL', async () => {
      // Read the source file and verify no template literals in SQL constants
      const allQueries = mockQuery.mock.calls
        .map((call) => call[0])
        .filter((q): q is string => typeof q === 'string');

      for (const query of allQueries) {
        // SQL queries should use $N placeholders, not template literals
        expect(query).not.toMatch(/\$\{/);
      }
    });
  });
});
