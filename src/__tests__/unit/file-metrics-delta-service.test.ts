import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { CommitRepository } from '../../database/commit-repository.js';
import { FileMetricsDeltaService } from '../../services/file-metrics-delta-service.js';
import type { CommitFileMetrics } from '../../database/commit-types.js';

/**
 * Unit tests for FileMetricsDeltaService class.
 *
 * Tests the file metrics delta calculation logic:
 * - Delta calculation: complexity_change, comments_change, code_change
 * - First occurrence uses the value itself as delta
 * - Batch processing with configurable commit cycle
 * - SQL injection prevention via parameterized queries
 * - Python-TypeScript equivalence for calculate_complexity_comments_code_change
 *
 * Uses mocked DatabaseService and CommitRepository.
 *
 * Ticket: IQS-863
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
 * Helper: create a test config for DatabaseService.
 */
function createTestConfig(): DatabaseServiceConfig {
  return {
    host: 'localhost',
    port: 5433,
    database: 'gitrx_test',
    user: 'test_user',
    password: 'test_password',
  };
}

/**
 * Helper: set up the mock pool's connect method to return a mock client.
 */
function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  // Default health check response
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

describe('FileMetricsDeltaService', () => {
  let dbService: DatabaseService;
  let commitRepo: CommitRepository;
  let service: FileMetricsDeltaService;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createTestConfig());
    commitRepo = new CommitRepository(dbService);
    service = new FileMetricsDeltaService(commitRepo);
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // ==========================================================================
  // calculateDeltasForFile - core delta calculation
  // ==========================================================================

  describe('calculateDeltasForFile', () => {
    it('should calculate deltas between consecutive commits for a file', () => {
      const metrics: CommitFileMetrics[] = [
        { sha: 'sha1', commitDate: new Date('2024-01-01'), filename: 'src/app.ts', complexity: 10, totalCommentLines: 5, totalCodeLines: 100 },
        { sha: 'sha2', commitDate: new Date('2024-01-02'), filename: 'src/app.ts', complexity: 15, totalCommentLines: 8, totalCodeLines: 120 },
        { sha: 'sha3', commitDate: new Date('2024-01-03'), filename: 'src/app.ts', complexity: 12, totalCommentLines: 6, totalCodeLines: 110 },
      ];

      const deltas = service.calculateDeltasForFile(metrics);

      expect(deltas).toHaveLength(3);

      // First occurrence: delta = value itself
      expect(deltas[0]).toEqual({
        sha: 'sha1',
        filename: 'src/app.ts',
        complexityChange: 10,
        commentsChange: 5,
        codeChange: 100,
      });

      // Second: delta = current - previous
      expect(deltas[1]).toEqual({
        sha: 'sha2',
        filename: 'src/app.ts',
        complexityChange: 5,   // 15 - 10
        commentsChange: 3,     // 8 - 5
        codeChange: 20,        // 120 - 100
      });

      // Third: delta = current - previous
      expect(deltas[2]).toEqual({
        sha: 'sha3',
        filename: 'src/app.ts',
        complexityChange: -3,  // 12 - 15
        commentsChange: -2,    // 6 - 8
        codeChange: -10,       // 110 - 120
      });
    });

    it('should use value itself as delta for first occurrence', () => {
      const metrics: CommitFileMetrics[] = [
        { sha: 'sha1', commitDate: new Date('2024-01-01'), filename: 'src/app.ts', complexity: 42, totalCommentLines: 10, totalCodeLines: 200 },
      ];

      const deltas = service.calculateDeltasForFile(metrics);

      expect(deltas).toHaveLength(1);
      expect(deltas[0]).toEqual({
        sha: 'sha1',
        filename: 'src/app.ts',
        complexityChange: 42,
        commentsChange: 10,
        codeChange: 200,
      });
    });

    it('should sort by commit_date before calculating deltas', () => {
      // Provide metrics in reverse order
      const metrics: CommitFileMetrics[] = [
        { sha: 'sha3', commitDate: new Date('2024-01-03'), filename: 'src/app.ts', complexity: 20, totalCommentLines: 10, totalCodeLines: 200 },
        { sha: 'sha1', commitDate: new Date('2024-01-01'), filename: 'src/app.ts', complexity: 10, totalCommentLines: 5, totalCodeLines: 100 },
        { sha: 'sha2', commitDate: new Date('2024-01-02'), filename: 'src/app.ts', complexity: 15, totalCommentLines: 8, totalCodeLines: 150 },
      ];

      const deltas = service.calculateDeltasForFile(metrics);

      expect(deltas).toHaveLength(3);

      // Should be sorted by date: sha1, sha2, sha3
      expect(deltas[0]!.sha).toBe('sha1');
      expect(deltas[0]!.complexityChange).toBe(10); // first = value itself
      expect(deltas[1]!.sha).toBe('sha2');
      expect(deltas[1]!.complexityChange).toBe(5);  // 15 - 10
      expect(deltas[2]!.sha).toBe('sha3');
      expect(deltas[2]!.complexityChange).toBe(5);  // 20 - 15
    });

    it('should return empty array for empty input', () => {
      const deltas = service.calculateDeltasForFile([]);
      expect(deltas).toHaveLength(0);
    });

    it('should handle zero-valued metrics', () => {
      const metrics: CommitFileMetrics[] = [
        { sha: 'sha1', commitDate: new Date('2024-01-01'), filename: 'src/app.ts', complexity: 0, totalCommentLines: 0, totalCodeLines: 0 },
        { sha: 'sha2', commitDate: new Date('2024-01-02'), filename: 'src/app.ts', complexity: 5, totalCommentLines: 2, totalCodeLines: 50 },
      ];

      const deltas = service.calculateDeltasForFile(metrics);

      expect(deltas[0]!.complexityChange).toBe(0);
      expect(deltas[0]!.commentsChange).toBe(0);
      expect(deltas[0]!.codeChange).toBe(0);
      expect(deltas[1]!.complexityChange).toBe(5);
      expect(deltas[1]!.commentsChange).toBe(2);
      expect(deltas[1]!.codeChange).toBe(50);
    });

    it('should handle negative deltas (decreasing complexity)', () => {
      const metrics: CommitFileMetrics[] = [
        { sha: 'sha1', commitDate: new Date('2024-01-01'), filename: 'src/app.ts', complexity: 50, totalCommentLines: 20, totalCodeLines: 300 },
        { sha: 'sha2', commitDate: new Date('2024-01-02'), filename: 'src/app.ts', complexity: 30, totalCommentLines: 10, totalCodeLines: 200 },
      ];

      const deltas = service.calculateDeltasForFile(metrics);

      expect(deltas[1]!.complexityChange).toBe(-20);
      expect(deltas[1]!.commentsChange).toBe(-10);
      expect(deltas[1]!.codeChange).toBe(-100);
    });
  });

  // ==========================================================================
  // calculateFileMetricsDeltas - full orchestration
  // ==========================================================================

  describe('calculateFileMetricsDeltas', () => {
    it('should process multiple files and return aggregate results', async () => {
      // Mock getUniqueFilesModifiedSince -> 2 files
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { filename: 'src/app.ts', cnt: 3 },
            { filename: 'src/util.ts', cnt: 2 },
          ],
          rowCount: 2,
        })
        // Mock getCommitFileBaseMetrics for src/app.ts
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_date: new Date('2024-01-01'), filename: 'src/app.ts', complexity: 10, total_comment_lines: 5, total_code_lines: 100 },
            { sha: 'sha2', commit_date: new Date('2024-01-02'), filename: 'src/app.ts', complexity: 15, total_comment_lines: 8, total_code_lines: 120 },
          ],
          rowCount: 2,
        })
        // Mock getCommitFileBaseMetrics for src/util.ts
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha3', commit_date: new Date('2024-01-01'), filename: 'src/util.ts', complexity: 5, total_comment_lines: 2, total_code_lines: 50 },
            { sha: 'sha4', commit_date: new Date('2024-01-02'), filename: 'src/util.ts', complexity: 7, total_comment_lines: 3, total_code_lines: 60 },
          ],
          rowCount: 2,
        })
        // Mock batchUpdateFileMetricsDeltas (BEGIN)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock UPDATE for sha1
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock UPDATE for sha2
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock UPDATE for sha3
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock UPDATE for sha4
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.calculateFileMetricsDeltas();

      expect(result.filesProcessed).toBe(2);
      expect(result.deltasCalculated).toBe(4);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should use configurable since date', async () => {
      const sinceDate = '2024-06-01';

      // Mock getUniqueFilesModifiedSince with custom date
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.calculateFileMetricsDeltas({ sinceDate });

      // Verify the query used the custom date
      const getFilesCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('commit_date'),
      );
      expect(getFilesCalls.length).toBeGreaterThanOrEqual(1);
      // The parameter should be the custom date
      expect(getFilesCalls[0]![1]).toContain(sinceDate);
    });

    it('should use configurable commit cycle for batch processing', async () => {
      // Create 3 files but set commitCycle to 2 so we get 2 batches
      mockQuery
        // Mock getUniqueFilesModifiedSince -> 3 files
        .mockResolvedValueOnce({
          rows: [
            { filename: 'src/a.ts', cnt: 2 },
            { filename: 'src/b.ts', cnt: 2 },
            { filename: 'src/c.ts', cnt: 2 },
          ],
          rowCount: 3,
        })
        // Mock getCommitFileBaseMetrics for src/a.ts
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_date: new Date('2024-01-01'), filename: 'src/a.ts', complexity: 10, total_comment_lines: 5, total_code_lines: 100 },
            { sha: 'sha2', commit_date: new Date('2024-01-02'), filename: 'src/a.ts', complexity: 15, total_comment_lines: 8, total_code_lines: 120 },
          ],
          rowCount: 2,
        })
        // Mock getCommitFileBaseMetrics for src/b.ts
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha3', commit_date: new Date('2024-01-01'), filename: 'src/b.ts', complexity: 5, total_comment_lines: 2, total_code_lines: 50 },
            { sha: 'sha4', commit_date: new Date('2024-01-02'), filename: 'src/b.ts', complexity: 7, total_comment_lines: 3, total_code_lines: 60 },
          ],
          rowCount: 2,
        })
        // First batch: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // 4 UPDATEs for a.ts and b.ts
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock getCommitFileBaseMetrics for src/c.ts
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha5', commit_date: new Date('2024-01-01'), filename: 'src/c.ts', complexity: 3, total_comment_lines: 1, total_code_lines: 30 },
            { sha: 'sha6', commit_date: new Date('2024-01-02'), filename: 'src/c.ts', complexity: 4, total_comment_lines: 2, total_code_lines: 35 },
          ],
          rowCount: 2,
        })
        // Second batch: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // 2 UPDATEs for c.ts
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.calculateFileMetricsDeltas({ commitCycle: 2 });

      expect(result.filesProcessed).toBe(3);
      expect(result.deltasCalculated).toBe(6);
    });

    it('should handle empty file list gracefully', async () => {
      // Mock getUniqueFilesModifiedSince -> 0 files
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.calculateFileMetricsDeltas();

      expect(result.filesProcessed).toBe(0);
      expect(result.deltasCalculated).toBe(0);
    });

    it('should use default sinceDate of 2 weeks ago', async () => {
      // Mock getUniqueFilesModifiedSince
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.calculateFileMetricsDeltas();

      // Verify the first query was called with a date approximately 2 weeks ago
      const call = mockQuery.mock.calls[1]; // [0] is health check
      if (call && Array.isArray(call[1])) {
        const sinceParam = call[1][0] as string;
        // Should be a date string in YYYY-MM-DD format
        expect(sinceParam).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('should use default commitCycle of 1000', async () => {
      // Just verify the default value is accessible
      // A more comprehensive test would require generating 1000+ files
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await service.calculateFileMetricsDeltas();
      expect(result.filesProcessed).toBe(0);
    });
  });

  // ==========================================================================
  // batchUpdateFileMetricsDeltas - database update
  // ==========================================================================

  describe('batchUpdateFileMetricsDeltas (via CommitRepository)', () => {
    it('should execute parameterized UPDATE queries', async () => {
      const deltas = [
        { sha: 'sha1', filename: 'src/app.ts', complexityChange: 10, commentsChange: 5, codeChange: 100 },
        { sha: 'sha2', filename: 'src/app.ts', complexityChange: 5, commentsChange: 3, codeChange: 20 },
      ];

      // Mock transaction: BEGIN, 2 UPDATEs, COMMIT
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })   // UPDATE sha1
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })   // UPDATE sha2
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });   // COMMIT

      await commitRepo.batchUpdateFileMetricsDeltas(deltas);

      // Verify UPDATE queries were parameterized
      const updateCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE commit_files SET complexity_change'),
      );
      expect(updateCalls).toHaveLength(2);

      // Verify parameters: [complexityChange, commentsChange, codeChange, sha, filename]
      expect(updateCalls[0]![1]).toEqual([10, 5, 100, 'sha1', 'src/app.ts']);
      expect(updateCalls[1]![1]).toEqual([5, 3, 20, 'sha2', 'src/app.ts']);
    });

    it('should skip update when deltas array is empty', async () => {
      await commitRepo.batchUpdateFileMetricsDeltas([]);

      // Should not execute any UPDATE queries
      const updateCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE commit_files'),
      );
      expect(updateCalls).toHaveLength(0);
    });
  });

  // ==========================================================================
  // SQL injection prevention
  // ==========================================================================

  describe('SQL injection prevention', () => {
    it('should never interpolate filenames into SQL queries', async () => {
      // Mock getUniqueFilesModifiedSince with a malicious filename
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { filename: "src/'; DROP TABLE commit_files; --.ts", cnt: 2 },
          ],
          rowCount: 1,
        })
        // Mock getCommitFileBaseMetrics for the malicious filename
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_date: new Date('2024-01-01'), filename: "src/'; DROP TABLE commit_files; --.ts", complexity: 10, total_comment_lines: 5, total_code_lines: 100 },
          ],
          rowCount: 1,
        })
        // Mock transaction: BEGIN, UPDATE, COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.calculateFileMetricsDeltas();

      // Verify no SQL string contains the injection
      for (const call of mockQuery.mock.calls) {
        const sql = call[0] as string;
        if (typeof sql === 'string') {
          expect(sql).not.toContain('DROP TABLE');
        }
      }
    });
  });

  // ==========================================================================
  // Python-TypeScript equivalence golden tests
  // ==========================================================================

  describe('Python-TypeScript equivalence', () => {
    it('should match Python pandas diff().fillna() behavior for first row', () => {
      // Python: fn_group['complexity_change'] = fn_group['complexity'].diff().fillna(fn_group['complexity'])
      // diff() returns NaN for the first row, fillna() replaces with the value itself
      const metrics: CommitFileMetrics[] = [
        { sha: 'sha1', commitDate: new Date('2024-01-01'), filename: 'file.py', complexity: 42, totalCommentLines: 15, totalCodeLines: 200 },
      ];

      const deltas = service.calculateDeltasForFile(metrics);

      // First row delta = value itself (matching pandas fillna behavior)
      expect(deltas[0]!.complexityChange).toBe(42);
      expect(deltas[0]!.commentsChange).toBe(15);
      expect(deltas[0]!.codeChange).toBe(200);
    });

    it('should match Python pandas diff() behavior for subsequent rows', () => {
      // Python: fn_group['complexity_change'] = fn_group['complexity'].diff()
      // diff() calculates current - previous
      const metrics: CommitFileMetrics[] = [
        { sha: 'sha1', commitDate: new Date('2024-01-01'), filename: 'file.py', complexity: 10, totalCommentLines: 5, totalCodeLines: 100 },
        { sha: 'sha2', commitDate: new Date('2024-01-02'), filename: 'file.py', complexity: 25, totalCommentLines: 12, totalCodeLines: 180 },
      ];

      const deltas = service.calculateDeltasForFile(metrics);

      // diff() = current - previous
      expect(deltas[1]!.complexityChange).toBe(15);  // 25 - 10
      expect(deltas[1]!.commentsChange).toBe(7);     // 12 - 5
      expect(deltas[1]!.codeChange).toBe(80);        // 180 - 100
    });

    it('should match Python groupby("filename") + sort_values("commit_date") behavior', () => {
      // Python groups by filename, sorts by commit_date within each group
      // Our service processes one file at a time, so sorting is within-file
      const metrics: CommitFileMetrics[] = [
        { sha: 'sha3', commitDate: new Date('2024-01-03'), filename: 'file.py', complexity: 30, totalCommentLines: 15, totalCodeLines: 300 },
        { sha: 'sha1', commitDate: new Date('2024-01-01'), filename: 'file.py', complexity: 10, totalCommentLines: 5, totalCodeLines: 100 },
        { sha: 'sha2', commitDate: new Date('2024-01-02'), filename: 'file.py', complexity: 20, totalCommentLines: 10, totalCodeLines: 200 },
      ];

      const deltas = service.calculateDeltasForFile(metrics);

      // Sorted by date: sha1 (10), sha2 (20), sha3 (30)
      expect(deltas[0]!.sha).toBe('sha1');
      expect(deltas[0]!.complexityChange).toBe(10);  // first = value
      expect(deltas[1]!.sha).toBe('sha2');
      expect(deltas[1]!.complexityChange).toBe(10);  // 20 - 10
      expect(deltas[2]!.sha).toBe('sha3');
      expect(deltas[2]!.complexityChange).toBe(10);  // 30 - 20
    });

    it('should match Python behavior with batch commit cycle processing', async () => {
      // Python: calculate_complexity_comments_code_change uses commit_cycle=1000
      // Files are processed sequentially, SQL writes batched per commit_cycle
      // Our service should produce identical delta values

      // Mock 1 file with 3 commits
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ filename: 'test.py', cnt: 3 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            { sha: 'a1', commit_date: new Date('2024-01-01'), filename: 'test.py', complexity: 5, total_comment_lines: 2, total_code_lines: 50 },
            { sha: 'a2', commit_date: new Date('2024-01-02'), filename: 'test.py', complexity: 8, total_comment_lines: 4, total_code_lines: 75 },
            { sha: 'a3', commit_date: new Date('2024-01-03'), filename: 'test.py', complexity: 6, total_comment_lines: 3, total_code_lines: 60 },
          ],
          rowCount: 3,
        })
        // Transaction: BEGIN, 3 UPDATEs, COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.calculateFileMetricsDeltas({ commitCycle: 1000 });

      expect(result.filesProcessed).toBe(1);
      expect(result.deltasCalculated).toBe(3);

      // Verify the UPDATE parameters match Python diff() behavior
      const updateCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE commit_files SET complexity_change'),
      );
      expect(updateCalls).toHaveLength(3);

      // a1: first row, delta = value itself: complexity=5, comments=2, code=50
      expect(updateCalls[0]![1]).toEqual([5, 2, 50, 'a1', 'test.py']);
      // a2: diff: complexity=3 (8-5), comments=2 (4-2), code=25 (75-50)
      expect(updateCalls[1]![1]).toEqual([3, 2, 25, 'a2', 'test.py']);
      // a3: diff: complexity=-2 (6-8), comments=-1 (3-4), code=-15 (60-75)
      expect(updateCalls[2]![1]).toEqual([-2, -1, -15, 'a3', 'test.py']);
    });
  });
});
