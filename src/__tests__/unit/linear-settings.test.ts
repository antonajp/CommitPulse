import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, _setMockConfig } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { getSettings } from '../../config/settings.js';
import type { RepositoryEntry, LinearSettings, TrackerType } from '../../config/settings.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for Linear-specific settings and trackerType on repositories.
 *
 * Validates:
 * - LinearSettings interface shape and defaults
 * - Linear settings reading from VS Code configuration
 * - trackerType field on RepositoryEntry
 * - trackerType validation (default, valid values, invalid values)
 * - GitrxConfiguration includes linear settings
 * - Linear settings immutability
 *
 * Ticket: IQS-874
 */

describe('Linear Settings & TrackerType', () => {
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

  describe('Linear Settings Defaults', () => {
    it('should return default linear.teamKeys as empty array', () => {
      const settings = getSettings();
      expect(settings.linear.teamKeys).toEqual([]);
    });

    it('should return default linear.keyAliases as empty object', () => {
      const settings = getSettings();
      expect(settings.linear.keyAliases).toEqual({});
    });

    it('should return default linear.maxKeys as 0', () => {
      const settings = getSettings();
      expect(settings.linear.maxKeys).toBe(0);
    });

    it('should return default linear.increment as 200', () => {
      const settings = getSettings();
      expect(settings.linear.increment).toBe(200);
    });

    it('should return default linear.daysAgo as 2', () => {
      const settings = getSettings();
      expect(settings.linear.daysAgo).toBe(2);
    });
  });

  describe('Linear Settings Custom Values', () => {
    it('should read configured linear.teamKeys', () => {
      _setMockConfig('gitrx.linear.teamKeys', ['IQS', 'ENG', 'PLAT']);

      const settings = getSettings();
      expect(settings.linear.teamKeys).toEqual(['IQS', 'ENG', 'PLAT']);
    });

    it('should read configured linear.keyAliases', () => {
      _setMockConfig('gitrx.linear.keyAliases', { OLD: 'NEW', LEGACY: 'CURRENT' });

      const settings = getSettings();
      expect(settings.linear.keyAliases).toEqual({ OLD: 'NEW', LEGACY: 'CURRENT' });
    });

    it('should read configured linear.maxKeys', () => {
      _setMockConfig('gitrx.linear.maxKeys', 500);

      const settings = getSettings();
      expect(settings.linear.maxKeys).toBe(500);
    });

    it('should read configured linear.increment', () => {
      _setMockConfig('gitrx.linear.increment', 100);

      const settings = getSettings();
      expect(settings.linear.increment).toBe(100);
    });

    it('should read configured linear.daysAgo', () => {
      _setMockConfig('gitrx.linear.daysAgo', 7);

      const settings = getSettings();
      expect(settings.linear.daysAgo).toBe(7);
    });
  });

  describe('Linear Settings Immutability', () => {
    it('should return frozen linear settings', () => {
      const settings = getSettings();
      expect(Object.isFrozen(settings.linear)).toBe(true);
    });
  });

  describe('GitrxConfiguration includes Linear', () => {
    it('should have linear property in settings', () => {
      const settings = getSettings();
      expect(settings).toHaveProperty('linear');
    });

    it('LinearSettings should have all required fields', () => {
      const settings = getSettings();
      expect(settings.linear).toHaveProperty('teamKeys');
      expect(settings.linear).toHaveProperty('keyAliases');
      expect(settings.linear).toHaveProperty('maxKeys');
      expect(settings.linear).toHaveProperty('increment');
      expect(settings.linear).toHaveProperty('daysAgo');
    });
  });

  describe('RepositoryEntry.trackerType', () => {
    it('should default to "jira" when trackerType is not specified', () => {
      const repos = [
        { path: '/path/to/repo', name: 'My Repo', organization: 'Org' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories[0]!.trackerType).toBe('jira');
    });

    it('should accept "jira" trackerType', () => {
      const repos = [
        { path: '/path/to/repo', name: 'Jira Repo', organization: 'Org', trackerType: 'jira' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories[0]!.trackerType).toBe('jira');
    });

    it('should accept "linear" trackerType', () => {
      const repos = [
        { path: '/path/to/repo', name: 'Linear Repo', organization: 'Org', trackerType: 'linear' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories[0]!.trackerType).toBe('linear');
    });

    it('should accept "none" trackerType', () => {
      const repos = [
        { path: '/path/to/repo', name: 'No Tracker', organization: 'Org', trackerType: 'none' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories[0]!.trackerType).toBe('none');
    });

    it('should default invalid trackerType to "jira"', () => {
      const repos = [
        { path: '/path/to/repo', name: 'Bad Tracker', organization: 'Org', trackerType: 'invalid' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories[0]!.trackerType).toBe('jira');
    });

    it('should support mixed trackerTypes across repositories', () => {
      const repos = [
        { path: '/path/jira', name: 'Jira Repo', organization: 'Org', trackerType: 'jira' },
        { path: '/path/linear', name: 'Linear Repo', organization: 'Org', trackerType: 'linear' },
        { path: '/path/none', name: 'No Tracker', organization: 'Org', trackerType: 'none' },
        { path: '/path/default', name: 'Default Repo', organization: 'Org' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories).toHaveLength(4);
      expect(settings.repositories[0]!.trackerType).toBe('jira');
      expect(settings.repositories[1]!.trackerType).toBe('linear');
      expect(settings.repositories[2]!.trackerType).toBe('none');
      expect(settings.repositories[3]!.trackerType).toBe('jira'); // default
    });

    it('should normalize trackerType case (lowercase)', () => {
      const repos = [
        { path: '/path/to/repo', name: 'Uppercased', organization: 'Org', trackerType: 'LINEAR' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories[0]!.trackerType).toBe('linear');
    });
  });

  describe('Security - Linear token not in settings', () => {
    it('should NOT expose Linear token in settings', () => {
      const settings = getSettings();
      const linearKeys = Object.keys(settings.linear);
      expect(linearKeys).not.toContain('token');
      expect(linearKeys).not.toContain('apiKey');
    });
  });
});
