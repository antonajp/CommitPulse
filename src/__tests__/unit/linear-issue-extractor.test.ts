import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { extractLinearDetail, mapPriority } from '../../services/linear-issue-extractor.js';
import type { LinearIssueData } from '../../services/linear-issue-extractor.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for LinearIssueExtractor.
 *
 * Validates:
 * - extractLinearDetail field mapping from Linear SDK to LinearDetailRow
 * - mapPriority conversion (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)
 * - Null/undefined field handling
 * - Date normalization (Date objects and ISO strings)
 * - Description truncation (10000 char max)
 *
 * Ticket: IQS-875
 */

// ============================================================================
// Test helpers
// ============================================================================

function createMockIssue(overrides?: Partial<LinearIssueData>): LinearIssueData {
  return {
    id: 'uuid-abc-123',
    identifier: 'IQS-42',
    title: 'Test issue title',
    description: 'This is a test description.',
    priority: 2,
    estimate: 3,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    completedAt: null,
    url: 'https://linear.app/iqsubagents/issue/IQS-42',
    state: { name: 'In Progress' },
    assignee: { name: 'John Doe' },
    creator: { name: 'Jane Smith' },
    project: { name: 'gitrx' },
    team: { key: 'IQS', name: 'iqsubagents' },
    labels: { nodes: [{ name: 'feature' }, { name: 'backend' }] },
    ...overrides,
  };
}

describe('LinearIssueExtractor', () => {
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

  describe('extractLinearDetail', () => {
    it('should extract all fields from a fully populated issue', () => {
      const issue = createMockIssue();
      const detail = extractLinearDetail(issue);

      expect(detail.linearId).toBe('uuid-abc-123');
      expect(detail.linearKey).toBe('IQS-42');
      expect(detail.title).toBe('Test issue title');
      expect(detail.description).toBe('This is a test description.');
      expect(detail.priority).toBe('High');
      expect(detail.estimate).toBe(3);
      expect(detail.createdDate).toBeInstanceOf(Date);
      expect(detail.url).toBe('https://linear.app/iqsubagents/issue/IQS-42');
      expect(detail.state).toBe('In Progress');
      expect(detail.assignee).toBe('John Doe');
      expect(detail.creator).toBe('Jane Smith');
      expect(detail.project).toBe('gitrx');
      expect(detail.team).toBe('IQS');
      expect(detail.completedDate).toBeNull();
      expect(detail.statusChangeDate).toBeNull();
    });

    it('should handle null/undefined optional fields', () => {
      const issue = createMockIssue({
        description: null,
        estimate: null,
        completedAt: null,
        state: null,
        assignee: null,
        creator: null,
        project: null,
        team: null,
      });

      const detail = extractLinearDetail(issue);

      expect(detail.description).toBeNull();
      expect(detail.estimate).toBeNull();
      expect(detail.completedDate).toBeNull();
      expect(detail.state).toBe('Unknown');
      expect(detail.assignee).toBeNull();
      expect(detail.creator).toBeNull();
      expect(detail.project).toBeNull();
      expect(detail.team).toBe('');
    });

    it('should handle undefined optional fields', () => {
      const issue = createMockIssue({
        description: undefined,
        estimate: undefined,
        completedAt: undefined,
        state: undefined,
        assignee: undefined,
        creator: undefined,
        project: undefined,
        team: undefined,
      });

      const detail = extractLinearDetail(issue);

      expect(detail.description).toBeNull();
      expect(detail.estimate).toBeNull();
      expect(detail.completedDate).toBeNull();
    });

    it('should handle completedAt as Date object', () => {
      const completedDate = new Date('2025-02-01T15:30:00Z');
      const issue = createMockIssue({ completedAt: completedDate });

      const detail = extractLinearDetail(issue);

      expect(detail.completedDate).toEqual(completedDate);
      expect(detail.statusChangeDate).toEqual(completedDate);
    });

    it('should handle completedAt as ISO string', () => {
      const issue = createMockIssue({
        completedAt: '2025-02-01T15:30:00Z' as unknown as Date,
      });

      const detail = extractLinearDetail(issue);

      expect(detail.completedDate).toBeInstanceOf(Date);
      expect(detail.completedDate!.toISOString()).toBe('2025-02-01T15:30:00.000Z');
    });

    it('should handle createdAt as ISO string', () => {
      const issue = createMockIssue({
        createdAt: '2025-01-15T10:00:00Z',
      });

      const detail = extractLinearDetail(issue);

      expect(detail.createdDate).toBeInstanceOf(Date);
      expect(detail.createdDate.toISOString()).toBe('2025-01-15T10:00:00.000Z');
    });

    it('should truncate description longer than 10000 characters', () => {
      const longDescription = 'A'.repeat(15000);
      const issue = createMockIssue({ description: longDescription });

      const detail = extractLinearDetail(issue);

      expect(detail.description!.length).toBe(10003); // 10000 + '...'
      expect(detail.description!.endsWith('...')).toBe(true);
    });

    it('should not truncate description at exactly 10000 characters', () => {
      const exactDescription = 'B'.repeat(10000);
      const issue = createMockIssue({ description: exactDescription });

      const detail = extractLinearDetail(issue);

      expect(detail.description!.length).toBe(10000);
      expect(detail.description!.endsWith('...')).toBe(false);
    });

    it('should handle empty description as null', () => {
      const issue = createMockIssue({ description: '' });
      const detail = extractLinearDetail(issue);

      // empty string is falsy, so truncateDescription returns null
      expect(detail.description).toBeNull();
    });
  });

  describe('mapPriority', () => {
    it('should map 0 to None', () => {
      expect(mapPriority(0)).toBe('None');
    });

    it('should map 1 to Urgent', () => {
      expect(mapPriority(1)).toBe('Urgent');
    });

    it('should map 2 to High', () => {
      expect(mapPriority(2)).toBe('High');
    });

    it('should map 3 to Medium', () => {
      expect(mapPriority(3)).toBe('Medium');
    });

    it('should map 4 to Low', () => {
      expect(mapPriority(4)).toBe('Low');
    });

    it('should map unknown values to None', () => {
      expect(mapPriority(5)).toBe('None');
      expect(mapPriority(-1)).toBe('None');
      expect(mapPriority(100)).toBe('None');
    });
  });
});
