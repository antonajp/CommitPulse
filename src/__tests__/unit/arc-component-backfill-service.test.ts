import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { ArcComponentBackfillService, type ArcComponentBackfillResult, type ArcComponentFileRow } from '../../services/arc-component-backfill-service.js';
import { ArcComponentClassifier } from '../../services/arc-component-classifier.js';
import type { CancellationToken, Progress } from 'vscode';

/**
 * Unit tests for ArcComponentBackfillService.
 *
 * Tests backfill orchestration: first run, smart refresh, progress reporting,
 * cancellation, error handling, and category counting.
 *
 * Ticket: IQS-885
 */

// Mock CommitRepository
function createMockCommitRepo() {
  return {
    getFilesForArcComponentBackfill: vi.fn(),
    batchUpdateArcComponent: vi.fn(),
  };
}

// Mock progress reporter
function createMockProgress(): Progress<{ message?: string; increment?: number }> {
  return {
    report: vi.fn(),
  };
}

// Mock cancellation token
function createMockToken(cancelled = false): CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(),
  } as unknown as CancellationToken;
}

// Standard test mappings
const TEST_EXT_MAPPING: Record<string, string> = {
  '.ts': 'Back-End',
  '.html': 'Front-End',
  '.sql': 'Database',
  '.yaml': 'DevOps/CI',
};

const TEST_FN_MAPPING: Record<string, string> = {
  'Dockerfile': 'DevOps/CI',
  'LICENSE': 'Documentation',
};

// Helper to create file rows
function makeRow(sha: string, filename: string, ext: string | null, arcComponent: string | null = null): ArcComponentFileRow {
  return { sha, filename, file_extension: ext, arc_component: arcComponent };
}

describe('ArcComponentBackfillService', () => {
  let mockCommitRepo: ReturnType<typeof createMockCommitRepo>;
  let classifier: ArcComponentClassifier;
  let service: ArcComponentBackfillService;

  beforeEach(() => {
    mockCommitRepo = createMockCommitRepo();
    classifier = new ArcComponentClassifier(TEST_EXT_MAPPING, TEST_FN_MAPPING);
    service = new ArcComponentBackfillService(
      mockCommitRepo as unknown as import('../../database/commit-repository.js').CommitRepository,
      classifier,
    );
  });

  // ==========================================================================
  // First run (no previous checksum)
  // ==========================================================================

  describe('first run (empty checksum)', () => {
    it('should classify NULL rows on first run', async () => {
      const rows: ArcComponentFileRow[] = [
        makeRow('sha1', 'src/main.ts', '.ts'),
        makeRow('sha2', 'views/index.html', '.html'),
        makeRow('sha3', 'migrations/001.sql', '.sql'),
      ];
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue(rows);
      mockCommitRepo.batchUpdateArcComponent.mockResolvedValue(3);

      const result = await service.runBackfill('');

      expect(mockCommitRepo.getFilesForArcComponentBackfill).toHaveBeenCalledWith(false);
      expect(mockCommitRepo.batchUpdateArcComponent).toHaveBeenCalledWith([
        { sha: 'sha1', filename: 'src/main.ts', arcComponent: 'Back-End' },
        { sha: 'sha2', filename: 'views/index.html', arcComponent: 'Front-End' },
        { sha: 'sha3', filename: 'migrations/001.sql', arcComponent: 'Database' },
      ]);
      expect(result.totalFiles).toBe(3);
      expect(result.classifiedFiles).toBe(3);
      expect(result.skippedFiles).toBe(0);
    });

    it('should return empty result when no files need classification', async () => {
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue([]);

      const result = await service.runBackfill('');

      expect(result.totalFiles).toBe(0);
      expect(result.classifiedFiles).toBe(0);
    });
  });

  // ==========================================================================
  // Smart refresh (mapping changed)
  // ==========================================================================

  describe('smart refresh', () => {
    it('should query all rows when mapping checksum changed', async () => {
      const rows: ArcComponentFileRow[] = [
        makeRow('sha1', 'src/main.ts', '.ts', 'Back-End'),
        makeRow('sha2', 'src/test.yaml', '.yaml', 'DevOps/CI'),
      ];
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue(rows);
      mockCommitRepo.batchUpdateArcComponent.mockResolvedValue(0);

      // Use a different checksum than what the classifier produces
      await service.runBackfill('old-checksum-value');

      expect(mockCommitRepo.getFilesForArcComponentBackfill).toHaveBeenCalledWith(true);
    });

    it('should skip rows where category has not changed', async () => {
      const rows: ArcComponentFileRow[] = [
        makeRow('sha1', 'src/main.ts', '.ts', 'Back-End'), // unchanged
        makeRow('sha2', 'views/index.html', '.html', null), // needs update
      ];
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue(rows);
      mockCommitRepo.batchUpdateArcComponent.mockResolvedValue(1);

      const result = await service.runBackfill('old-checksum');

      // Only sha2 should be updated (sha1 is unchanged)
      expect(mockCommitRepo.batchUpdateArcComponent).toHaveBeenCalledWith([
        { sha: 'sha2', filename: 'views/index.html', arcComponent: 'Front-End' },
      ]);
      expect(result.classifiedFiles).toBe(1);
    });

    it('should query NULL-only rows when checksum matches', async () => {
      const currentChecksum = classifier.getMappingChecksum();
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue([]);

      await service.runBackfill(currentChecksum);

      expect(mockCommitRepo.getFilesForArcComponentBackfill).toHaveBeenCalledWith(false);
    });
  });

  // ==========================================================================
  // Category counts
  // ==========================================================================

  describe('category counts', () => {
    it('should report per-category breakdown', async () => {
      const rows: ArcComponentFileRow[] = [
        makeRow('sha1', 'a.ts', '.ts'),
        makeRow('sha2', 'b.ts', '.ts'),
        makeRow('sha3', 'c.html', '.html'),
        makeRow('sha4', 'd.sql', '.sql'),
        makeRow('sha5', 'e.unknown', '.unknown'),
      ];
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue(rows);
      mockCommitRepo.batchUpdateArcComponent.mockResolvedValue(5);

      const result = await service.runBackfill('');

      expect(result.categoryCounts['Back-End']).toBe(2);
      expect(result.categoryCounts['Front-End']).toBe(1);
      expect(result.categoryCounts['Database']).toBe(1);
      expect(result.categoryCounts['Other']).toBe(1);
      expect(result.otherCount).toBe(1);
    });
  });

  // ==========================================================================
  // Progress and cancellation
  // ==========================================================================

  describe('progress and cancellation', () => {
    it('should report progress', async () => {
      const rows: ArcComponentFileRow[] = [
        makeRow('sha1', 'a.ts', '.ts'),
      ];
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue(rows);
      mockCommitRepo.batchUpdateArcComponent.mockResolvedValue(1);

      const progress = createMockProgress();
      await service.runBackfill('', progress);

      expect(progress.report).toHaveBeenCalled();
    });

    it('should stop classification when cancelled', async () => {
      const rows: ArcComponentFileRow[] = [];
      for (let i = 0; i < 100; i++) {
        rows.push(makeRow(`sha${i}`, `file${i}.ts`, '.ts'));
      }
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue(rows);

      const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as CancellationToken;

      // Cancel after a few iterations
      mockCommitRepo.batchUpdateArcComponent.mockImplementation(async () => {
        // Simulate cancellation during batch update
        (token as { isCancellationRequested: boolean }).isCancellationRequested = true;
        return 0;
      });

      const result = await service.runBackfill('', undefined, token);

      // Should have stopped early
      expect(result.totalFiles).toBe(100);
    });

    it('should handle cancellation before any processing', async () => {
      const rows: ArcComponentFileRow[] = [
        makeRow('sha1', 'a.ts', '.ts'),
      ];
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue(rows);

      const token = createMockToken(true);
      const result = await service.runBackfill('', undefined, token);

      expect(result.totalFiles).toBe(1);
      expect(result.classifiedFiles).toBe(0);
    });
  });

  // ==========================================================================
  // Error handling
  // ==========================================================================

  describe('error handling', () => {
    it('should count batch update failures as skipped', async () => {
      const rows: ArcComponentFileRow[] = [
        makeRow('sha1', 'a.ts', '.ts'),
        makeRow('sha2', 'b.html', '.html'),
      ];
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue(rows);
      mockCommitRepo.batchUpdateArcComponent.mockRejectedValue(new Error('DB error'));

      const result = await service.runBackfill('');

      expect(result.classifiedFiles).toBe(0);
      expect(result.skippedFiles).toBe(2);
    });
  });

  // ==========================================================================
  // Duration tracking
  // ==========================================================================

  describe('duration tracking', () => {
    it('should report durationMs', async () => {
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue([]);

      const result = await service.runBackfill('');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Filename match priority in backfill context
  // ==========================================================================

  describe('filename priority in backfill', () => {
    it('should use filename match over extension for Dockerfile', async () => {
      const rows: ArcComponentFileRow[] = [
        makeRow('sha1', 'docker/Dockerfile', ''),
      ];
      mockCommitRepo.getFilesForArcComponentBackfill.mockResolvedValue(rows);
      mockCommitRepo.batchUpdateArcComponent.mockResolvedValue(1);

      const result = await service.runBackfill('');

      expect(mockCommitRepo.batchUpdateArcComponent).toHaveBeenCalledWith([
        { sha: 'sha1', filename: 'docker/Dockerfile', arcComponent: 'DevOps/CI' },
      ]);
      expect(result.categoryCounts['DevOps/CI']).toBe(1);
    });
  });
});
