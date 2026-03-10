import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { NullTrackerService } from '../../services/issue-tracker-interface.js';
import type {
  IssueTrackerService,
  TrackerLoadResult,
  TrackerTypeId,
} from '../../services/issue-tracker-interface.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for the IssueTrackerService interface and NullTrackerService.
 *
 * Validates:
 * - IssueTrackerService interface shape (via NullTrackerService implementation)
 * - NullTrackerService returns no-op results for all methods
 * - TrackerTypeId type covers expected values
 * - TrackerLoadResult shape
 *
 * Ticket: IQS-874
 */

describe('IssueTrackerInterface', () => {
  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  afterEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    _clearMocks();
  });

  describe('NullTrackerService', () => {
    let service: NullTrackerService;

    beforeEach(() => {
      service = new NullTrackerService();
    });

    it('should have trackerType "none"', () => {
      expect(service.trackerType).toBe('none');
    });

    it('should implement IssueTrackerService interface', () => {
      // Verify all interface methods exist
      const tracker: IssueTrackerService = service;
      expect(typeof tracker.loadIssues).toBe('function');
      expect(typeof tracker.getValidKeys).toBe('function');
      expect(typeof tracker.isValidIdentifier).toBe('function');
      expect(tracker.trackerType).toBeDefined();
    });

    it('loadIssues should return zero counts', async () => {
      const result: TrackerLoadResult = await service.loadIssues();
      expect(result.issuesInserted).toBe(0);
      expect(result.issuesSkipped).toBe(0);
      expect(result.issuesFailed).toBe(0);
      expect(result.durationMs).toBe(0);
    });

    it('getValidKeys should return empty array', async () => {
      const keys = await service.getValidKeys();
      expect(keys).toEqual([]);
    });

    it('isValidIdentifier should return false for any input', () => {
      expect(service.isValidIdentifier('PROJ-123')).toBe(false);
      expect(service.isValidIdentifier('IQS-1')).toBe(false);
      expect(service.isValidIdentifier('')).toBe(false);
      expect(service.isValidIdentifier('anything')).toBe(false);
    });
  });

  describe('TrackerTypeId type', () => {
    it('should accept valid tracker type values', () => {
      const types: TrackerTypeId[] = ['jira', 'linear', 'none'];
      expect(types).toHaveLength(3);
      expect(types).toContain('jira');
      expect(types).toContain('linear');
      expect(types).toContain('none');
    });
  });

  describe('TrackerLoadResult shape', () => {
    it('should have all required fields', () => {
      const result: TrackerLoadResult = {
        issuesInserted: 10,
        issuesSkipped: 5,
        issuesFailed: 2,
        durationMs: 1500,
      };

      expect(result).toHaveProperty('issuesInserted');
      expect(result).toHaveProperty('issuesSkipped');
      expect(result).toHaveProperty('issuesFailed');
      expect(result).toHaveProperty('durationMs');
    });
  });
});
