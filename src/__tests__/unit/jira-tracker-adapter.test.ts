import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { JiraTrackerAdapter } from '../../services/jira-tracker-adapter.js';
import type { JiraSettings } from '../../config/settings.js';
import type { JiraIncrementalLoader, IncrementalLoadResult } from '../../services/jira-incremental-loader.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for JiraTrackerAdapter.
 *
 * Validates:
 * - trackerType is 'jira'
 * - loadIssues delegates to JiraIncrementalLoader.runIncrementalLoad
 * - getValidKeys returns project keys plus alias keys
 * - isValidIdentifier validates Jira key format (PROJ-123)
 *
 * Ticket: IQS-874
 */

/**
 * Create a mock JiraSettings object for testing.
 */
function createMockJiraSettings(overrides?: Partial<JiraSettings>): JiraSettings {
  return {
    server: 'https://test.atlassian.net',
    username: 'test@example.com',
    projectKeys: ['IQS', 'PROJ'],
    keyAliases: { PROJ: 'PROJ2', CRM: 'CRMREO' },
    pointsField: 'customfield_10034',
    maxKeys: 0,
    increment: 200,
    daysAgo: 2,
    ...overrides,
  };
}

/**
 * Create a mock JiraIncrementalLoader.
 */
function createMockLoader(): {
  runIncrementalLoad: ReturnType<typeof vi.fn>;
} {
  return {
    runIncrementalLoad: vi.fn(),
  };
}

describe('JiraTrackerAdapter', () => {
  let adapter: JiraTrackerAdapter;
  let mockLoader: ReturnType<typeof createMockLoader>;
  let mockSettings: JiraSettings;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    mockLoader = createMockLoader();
    mockSettings = createMockJiraSettings();
    adapter = new JiraTrackerAdapter(
      mockLoader as unknown as JiraIncrementalLoader,
      mockSettings,
    );
  });

  afterEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    _clearMocks();
  });

  describe('trackerType', () => {
    it('should be "jira"', () => {
      expect(adapter.trackerType).toBe('jira');
    });
  });

  describe('loadIssues', () => {
    it('should delegate to JiraIncrementalLoader.runIncrementalLoad', async () => {
      const mockResult: IncrementalLoadResult = {
        totalInserted: 15,
        totalSkipped: 3,
        totalFailed: 1,
        projectResults: [],
        unfinishedResult: null,
        durationMs: 2500,
        projectCount: 2,
      };
      mockLoader.runIncrementalLoad.mockResolvedValueOnce(mockResult);

      const result = await adapter.loadIssues();

      expect(mockLoader.runIncrementalLoad).toHaveBeenCalledOnce();
      expect(result.issuesInserted).toBe(15);
      expect(result.issuesSkipped).toBe(3);
      expect(result.issuesFailed).toBe(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should propagate errors from the loader', async () => {
      mockLoader.runIncrementalLoad.mockRejectedValueOnce(new Error('API rate limited'));

      await expect(adapter.loadIssues()).rejects.toThrow('API rate limited');
    });
  });

  describe('getValidKeys', () => {
    it('should return configured project keys', async () => {
      const keys = await adapter.getValidKeys();
      expect(keys).toContain('IQS');
      expect(keys).toContain('PROJ');
    });

    it('should include alias source keys', async () => {
      const keys = await adapter.getValidKeys();
      expect(keys).toContain('PROJ');
      expect(keys).toContain('CRM');
    });

    it('should include alias target keys', async () => {
      const keys = await adapter.getValidKeys();
      expect(keys).toContain('PROJ2');
      expect(keys).toContain('CRMREO');
    });

    it('should return deduplicated keys', async () => {
      // Create settings where a project key also appears as an alias target
      const settings = createMockJiraSettings({
        projectKeys: ['IQS', 'PROJ2'],
        keyAliases: { PROJ: 'PROJ2' },
      });
      const adapterWithDupes = new JiraTrackerAdapter(
        mockLoader as unknown as JiraIncrementalLoader,
        settings,
      );

      const keys = await adapterWithDupes.getValidKeys();
      // PROJ2 appears in both projectKeys and alias targets, should be deduped
      const PROJ2Count = keys.filter((k) => k === 'PROJ2').length;
      expect(PROJ2Count).toBe(1);
    });

    it('should return empty array when no keys configured', async () => {
      const settings = createMockJiraSettings({
        projectKeys: [],
        keyAliases: {},
      });
      const emptyAdapter = new JiraTrackerAdapter(
        mockLoader as unknown as JiraIncrementalLoader,
        settings,
      );

      const keys = await emptyAdapter.getValidKeys();
      expect(keys).toEqual([]);
    });
  });

  describe('isValidIdentifier', () => {
    it('should accept valid Jira identifiers', () => {
      expect(adapter.isValidIdentifier('IQS-123')).toBe(true);
      expect(adapter.isValidIdentifier('PROJ-1')).toBe(true);
      expect(adapter.isValidIdentifier('AB-9999')).toBe(true);
      expect(adapter.isValidIdentifier('ABCDEFGHIJ-1')).toBe(true); // 10 letters (max)
    });

    it('should reject invalid identifiers', () => {
      expect(adapter.isValidIdentifier('')).toBe(false);
      expect(adapter.isValidIdentifier('abc-123')).toBe(false); // lowercase
      expect(adapter.isValidIdentifier('A-123')).toBe(false); // single letter
      expect(adapter.isValidIdentifier('PROJ123')).toBe(false); // no dash
      expect(adapter.isValidIdentifier('PROJ-')).toBe(false); // no number
      expect(adapter.isValidIdentifier('-123')).toBe(false); // no key
      expect(adapter.isValidIdentifier('PROJ-abc')).toBe(false); // non-numeric
    });

    it('should accept keys with up to 10 uppercase letters', () => {
      expect(adapter.isValidIdentifier('ABCDEFGHIJ-1')).toBe(true); // 10 letters
    });

    it('should reject keys with more than 10 uppercase letters', () => {
      expect(adapter.isValidIdentifier('ABCDEFGHIJK-1')).toBe(false); // 11 letters
    });
  });
});
