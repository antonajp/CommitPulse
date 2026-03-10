import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LinearTrackerAdapter } from '../../services/linear-tracker-adapter.js';
import type { LinearSettings } from '../../config/settings.js';
import type { LinearIncrementalLoader, LinearIncrementalLoadResult } from '../../services/linear-incremental-loader.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for LinearTrackerAdapter.
 *
 * Validates:
 * - trackerType is 'linear'
 * - loadIssues delegates to LinearIncrementalLoader.runIncrementalLoad
 * - getValidKeys returns team keys plus alias keys
 * - isValidIdentifier validates Linear key format (TEAM-123)
 * - isValidIdentifier checks against configured team keys whitelist
 *
 * Ticket: IQS-875
 */

// ============================================================================
// Test helpers
// ============================================================================

function createMockLinearSettings(overrides?: Partial<LinearSettings>): LinearSettings {
  return {
    teamKeys: ['IQS', 'ENG'],
    keyAliases: { PLAT: 'PLATFORM' },
    maxKeys: 0,
    increment: 200,
    daysAgo: 2,
    ...overrides,
  };
}

function createMockLoader(): {
  runIncrementalLoad: ReturnType<typeof vi.fn>;
} {
  return {
    runIncrementalLoad: vi.fn(),
  };
}

describe('LinearTrackerAdapter', () => {
  let adapter: LinearTrackerAdapter;
  let mockLoader: ReturnType<typeof createMockLoader>;
  let mockSettings: LinearSettings;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    mockLoader = createMockLoader();
    mockSettings = createMockLinearSettings();
    adapter = new LinearTrackerAdapter(
      mockLoader as unknown as LinearIncrementalLoader,
      mockSettings,
    );
  });

  afterEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    _clearMocks();
  });

  describe('trackerType', () => {
    it('should be "linear"', () => {
      expect(adapter.trackerType).toBe('linear');
    });
  });

  describe('loadIssues', () => {
    it('should delegate to LinearIncrementalLoader.runIncrementalLoad', async () => {
      const mockResult: LinearIncrementalLoadResult = {
        totalInserted: 10,
        totalSkipped: 5,
        totalFailed: 0,
        teamResults: [],
        unfinishedRefreshed: 3,
        durationMs: 1500,
        teamCount: 2,
      };
      mockLoader.runIncrementalLoad.mockResolvedValueOnce(mockResult);

      const result = await adapter.loadIssues();

      expect(mockLoader.runIncrementalLoad).toHaveBeenCalledOnce();
      expect(result.issuesInserted).toBe(10);
      expect(result.issuesSkipped).toBe(5);
      expect(result.issuesFailed).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should propagate errors from the loader', async () => {
      mockLoader.runIncrementalLoad.mockRejectedValueOnce(new Error('Linear API rate limited'));

      await expect(adapter.loadIssues()).rejects.toThrow('Linear API rate limited');
    });
  });

  describe('getValidKeys', () => {
    it('should return configured team keys', async () => {
      const keys = await adapter.getValidKeys();
      expect(keys).toContain('IQS');
      expect(keys).toContain('ENG');
    });

    it('should include alias source keys', async () => {
      const keys = await adapter.getValidKeys();
      expect(keys).toContain('PLAT');
    });

    it('should include alias target keys', async () => {
      const keys = await adapter.getValidKeys();
      expect(keys).toContain('PLATFORM');
    });

    it('should return deduplicated keys', async () => {
      const settings = createMockLinearSettings({
        teamKeys: ['IQS', 'PLATFORM'],
        keyAliases: { PLAT: 'PLATFORM' },
      });
      const adapterWithDupes = new LinearTrackerAdapter(
        mockLoader as unknown as LinearIncrementalLoader,
        settings,
      );

      const keys = await adapterWithDupes.getValidKeys();
      const platformCount = keys.filter((k) => k === 'PLATFORM').length;
      expect(platformCount).toBe(1);
    });

    it('should return empty array when no keys configured', async () => {
      const settings = createMockLinearSettings({
        teamKeys: [],
        keyAliases: {},
      });
      const emptyAdapter = new LinearTrackerAdapter(
        mockLoader as unknown as LinearIncrementalLoader,
        settings,
      );

      const keys = await emptyAdapter.getValidKeys();
      expect(keys).toEqual([]);
    });
  });

  describe('isValidIdentifier', () => {
    it('should accept valid Linear identifiers for configured teams', () => {
      expect(adapter.isValidIdentifier('IQS-123')).toBe(true);
      expect(adapter.isValidIdentifier('ENG-1')).toBe(true);
      expect(adapter.isValidIdentifier('PLAT-456')).toBe(true); // alias source key
      expect(adapter.isValidIdentifier('PLATFORM-789')).toBe(true); // alias target key
    });

    it('should reject identifiers not in configured team keys', () => {
      expect(adapter.isValidIdentifier('UNKNOWN-123')).toBe(false);
      expect(adapter.isValidIdentifier('ABC-456')).toBe(false);
    });

    it('should reject invalid format identifiers', () => {
      expect(adapter.isValidIdentifier('')).toBe(false);
      expect(adapter.isValidIdentifier('abc-123')).toBe(false); // lowercase
      expect(adapter.isValidIdentifier('A-123')).toBe(false); // single letter
      expect(adapter.isValidIdentifier('IQS123')).toBe(false); // no dash
      expect(adapter.isValidIdentifier('IQS-')).toBe(false); // no number
      expect(adapter.isValidIdentifier('-123')).toBe(false); // no key
      expect(adapter.isValidIdentifier('IQS-abc')).toBe(false); // non-numeric
    });

    it('should accept keys with alphanumeric prefix', () => {
      const settings = createMockLinearSettings({
        teamKeys: ['AB2C'],
        keyAliases: {},
      });
      const adapterAlpha = new LinearTrackerAdapter(
        mockLoader as unknown as LinearIncrementalLoader,
        settings,
      );
      expect(adapterAlpha.isValidIdentifier('AB2C-99')).toBe(true);
    });

    it('should reject keys with more than 11 characters before dash', () => {
      expect(adapter.isValidIdentifier('ABCDEFGHIJKL-1')).toBe(false); // 12 chars
    });

    it('should reject identifiers with more than 6 digits', () => {
      expect(adapter.isValidIdentifier('IQS-1234567')).toBe(false); // 7 digits
    });

    it('should accept identifiers with up to 6 digits', () => {
      expect(adapter.isValidIdentifier('IQS-123456')).toBe(true);
    });
  });
});
