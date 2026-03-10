import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { createTrackerService } from '../../services/issue-tracker-factory.js';
import type { JiraTrackerDependencies, LinearTrackerDependencies } from '../../services/issue-tracker-factory.js';
import { NullTrackerService } from '../../services/issue-tracker-interface.js';
import { JiraTrackerAdapter } from '../../services/jira-tracker-adapter.js';
import { LinearTrackerAdapter } from '../../services/linear-tracker-adapter.js';
import type { JiraSettings, LinearSettings } from '../../config/settings.js';
import type { JiraIncrementalLoader } from '../../services/jira-incremental-loader.js';
import type { LinearIncrementalLoader } from '../../services/linear-incremental-loader.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for the IssueTrackerFactory.
 *
 * Validates:
 * - createTrackerService dispatches to JiraTrackerAdapter for 'jira'
 * - createTrackerService dispatches to LinearTrackerAdapter for 'linear' (IQS-875)
 * - createTrackerService returns NullTrackerService for 'none'
 * - Graceful fallback when dependencies are missing
 *
 * Ticket: IQS-874, IQS-875
 */

/**
 * Create mock Jira dependencies for testing.
 */
function createMockJiraDeps(): JiraTrackerDependencies {
  return {
    jiraLoader: {
      runIncrementalLoad: vi.fn(),
    } as unknown as JiraIncrementalLoader,
    jiraSettings: {
      server: 'https://test.atlassian.net',
      username: 'test@example.com',
      projectKeys: ['PROJ'],
      keyAliases: {},
      pointsField: 'customfield_10034',
      maxKeys: 0,
      increment: 200,
      daysAgo: 2,
    } as JiraSettings,
  };
}

/**
 * Create mock Linear dependencies for testing.
 */
function createMockLinearDeps(): LinearTrackerDependencies {
  return {
    linearLoader: {
      runIncrementalLoad: vi.fn(),
    } as unknown as LinearIncrementalLoader,
    linearSettings: {
      teamKeys: ['IQS'],
      keyAliases: {},
      maxKeys: 0,
      increment: 200,
      daysAgo: 2,
    } as LinearSettings,
  };
}

describe('IssueTrackerFactory', () => {
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

  describe('createTrackerService', () => {
    it('should create JiraTrackerAdapter for trackerType "jira"', () => {
      const jiraDeps = createMockJiraDeps();
      const service = createTrackerService('jira', jiraDeps);

      expect(service).toBeInstanceOf(JiraTrackerAdapter);
      expect(service.trackerType).toBe('jira');
    });

    it('should create NullTrackerService for trackerType "jira" when dependencies missing', () => {
      const service = createTrackerService('jira');

      expect(service).toBeInstanceOf(NullTrackerService);
      expect(service.trackerType).toBe('none');
    });

    it('should create LinearTrackerAdapter for trackerType "linear"', () => {
      const linearDeps = createMockLinearDeps();
      const service = createTrackerService('linear', undefined, linearDeps);

      expect(service).toBeInstanceOf(LinearTrackerAdapter);
      expect(service.trackerType).toBe('linear');
    });

    it('should create NullTrackerService for trackerType "linear" when dependencies missing', () => {
      const service = createTrackerService('linear');

      expect(service).toBeInstanceOf(NullTrackerService);
      expect(service.trackerType).toBe('none');
    });

    it('should create NullTrackerService for trackerType "none"', () => {
      const service = createTrackerService('none');

      expect(service).toBeInstanceOf(NullTrackerService);
      expect(service.trackerType).toBe('none');
    });

    it('should return services with correct interface methods', () => {
      const jiraDeps = createMockJiraDeps();
      const linearDeps = createMockLinearDeps();
      const jiraService = createTrackerService('jira', jiraDeps);
      const linearService = createTrackerService('linear', undefined, linearDeps);
      const noneService = createTrackerService('none');

      // Verify interface shape
      for (const service of [jiraService, linearService, noneService]) {
        expect(typeof service.loadIssues).toBe('function');
        expect(typeof service.getValidKeys).toBe('function');
        expect(typeof service.isValidIdentifier).toBe('function');
        expect(service.trackerType).toBeDefined();
      }
    });
  });
});
