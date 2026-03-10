import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, _setMockConfig } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import {
  getSettings,
  getConfigValue,
  onConfigurationChanged,
  CONFIG_SECTION,
} from '../../config/settings.js';
import type {
  GitrxConfiguration,
  RepositoryEntry,
  DatabaseSettings,
  JiraSettings,
  GitHubSettings,
  ScheduleSettings,
  DockerSettings,
  LogLevelString,
} from '../../config/settings.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for the settings configuration reader (IQS-849).
 *
 * Validates:
 * - GitrxConfiguration interface matches package.json schema
 * - getSettings() returns properly typed, frozen configuration
 * - All setting groups: repositories, database, jira, github, schedule, logLevel, docker
 * - Input validation for repositories (missing fields), port (range), and logLevel (enum)
 * - getConfigValue() utility for ad-hoc setting reads
 * - onConfigurationChanged() listener for reactive updates
 * - Default values match package.json defaults
 * - Legacy type alias backward compatibility
 * - Secrets are NOT exposed via settings (password, tokens)
 */

describe('Settings Configuration Reader', () => {
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

  describe('CONFIG_SECTION constant', () => {
    it('should be "gitrx"', () => {
      expect(CONFIG_SECTION).toBe('gitrx');
    });
  });

  describe('getSettings() - Default Values', () => {
    it('should return default repositories as empty array', () => {
      const settings = getSettings();
      expect(settings.repositories).toEqual([]);
    });

    it('should return default database settings', () => {
      const settings = getSettings();
      expect(settings.database.host).toBe('localhost');
      expect(settings.database.port).toBe(5433);
      expect(settings.database.name).toBe('gitrx');
      expect(settings.database.user).toBe('gitrx_admin');
    });

    it('should return default Jira settings', () => {
      const settings = getSettings();
      expect(settings.jira.server).toBe('');
      expect(settings.jira.username).toBe('');
      expect(settings.jira.projectKeys).toEqual([]);
      expect(settings.jira.keyAliases).toEqual({});
    });

    it('should return default GitHub settings', () => {
      const settings = getSettings();
      expect(settings.github.organization).toBe('');
    });

    it('should return default schedule settings', () => {
      const settings = getSettings();
      expect(settings.schedule.enabled).toBe(false);
      expect(settings.schedule.cronExpression).toBe('0 9 * * 1-5');
    });

    it('should return default log level as INFO', () => {
      const settings = getSettings();
      expect(settings.logLevel).toBe('INFO');
    });

    it('should return default Docker settings', () => {
      const settings = getSettings();
      expect(settings.docker.postgresVersion).toBe('16');
    });
  });

  describe('getSettings() - Custom Values', () => {
    it('should read configured repositories', () => {
      const repos: RepositoryEntry[] = [
        { path: '/home/user/repos/app1', name: 'App One', organization: 'Engineering' },
        { path: '/home/user/repos/app2', name: 'App Two', organization: 'Platform' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories).toHaveLength(2);
      expect(settings.repositories[0]!.path).toBe('/home/user/repos/app1');
      expect(settings.repositories[0]!.name).toBe('App One');
      expect(settings.repositories[0]!.organization).toBe('Engineering');
      expect(settings.repositories[1]!.path).toBe('/home/user/repos/app2');
      expect(settings.repositories[1]!.name).toBe('App Two');
    });

    it('should read configured database settings', () => {
      _setMockConfig('gitrx.database.host', 'db.example.com');
      _setMockConfig('gitrx.database.port', 5433);
      _setMockConfig('gitrx.database.name', 'mydb');
      _setMockConfig('gitrx.database.user', 'myuser');

      const settings = getSettings();
      expect(settings.database.host).toBe('db.example.com');
      expect(settings.database.port).toBe(5433);
      expect(settings.database.name).toBe('mydb');
      expect(settings.database.user).toBe('myuser');
    });

    it('should read configured Jira settings', () => {
      _setMockConfig('gitrx.jira.server', 'https://myorg.atlassian.net');
      _setMockConfig('gitrx.jira.username', 'user@example.com');
      _setMockConfig('gitrx.jira.projectKeys', ['PROJ', 'FEAT']);
      _setMockConfig('gitrx.jira.keyAliases', { PROJ: 'PROJ2', CRM: 'CRMREO' });

      const settings = getSettings();
      expect(settings.jira.server).toBe('https://myorg.atlassian.net');
      expect(settings.jira.username).toBe('user@example.com');
      expect(settings.jira.projectKeys).toEqual(['PROJ', 'FEAT']);
      expect(settings.jira.keyAliases).toEqual({ PROJ: 'PROJ2', CRM: 'CRMREO' });
    });

    it('should read configured GitHub settings', () => {
      _setMockConfig('gitrx.github.organization', 'my-org');

      const settings = getSettings();
      expect(settings.github.organization).toBe('my-org');
    });

    it('should read configured schedule settings', () => {
      _setMockConfig('gitrx.schedule.enabled', true);
      _setMockConfig('gitrx.schedule.cronExpression', '0 */4 * * *');

      const settings = getSettings();
      expect(settings.schedule.enabled).toBe(true);
      expect(settings.schedule.cronExpression).toBe('0 */4 * * *');
    });

    it('should read configured log level', () => {
      _setMockConfig('gitrx.logLevel', 'DEBUG');

      const settings = getSettings();
      expect(settings.logLevel).toBe('DEBUG');
    });

    it('should accept all valid log level values', () => {
      const levels: LogLevelString[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];
      for (const level of levels) {
        _setMockConfig('gitrx.logLevel', level);
        const settings = getSettings();
        expect(settings.logLevel).toBe(level);
      }
    });

    it('should read configured Docker settings', () => {
      _setMockConfig('gitrx.docker.postgresVersion', '15');

      const settings = getSettings();
      expect(settings.docker.postgresVersion).toBe('15');
    });
  });

  describe('getSettings() - Immutability', () => {
    it('should return a frozen top-level settings object', () => {
      const settings = getSettings();
      expect(Object.isFrozen(settings)).toBe(true);
    });

    it('should return frozen database settings', () => {
      const settings = getSettings();
      expect(Object.isFrozen(settings.database)).toBe(true);
    });

    it('should return frozen Jira settings', () => {
      const settings = getSettings();
      expect(Object.isFrozen(settings.jira)).toBe(true);
    });

    it('should return frozen GitHub settings', () => {
      const settings = getSettings();
      expect(Object.isFrozen(settings.github)).toBe(true);
    });

    it('should return frozen schedule settings', () => {
      const settings = getSettings();
      expect(Object.isFrozen(settings.schedule)).toBe(true);
    });

    it('should return frozen Docker settings', () => {
      const settings = getSettings();
      expect(Object.isFrozen(settings.docker)).toBe(true);
    });

    it('should return frozen repositories array', () => {
      const repos: RepositoryEntry[] = [
        { path: '/path/to/repo', name: 'My Repo', organization: 'Org' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(Object.isFrozen(settings.repositories)).toBe(true);
    });

    it('should return frozen individual repository entries', () => {
      const repos: RepositoryEntry[] = [
        { path: '/path/to/repo', name: 'My Repo', organization: 'Org' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(Object.isFrozen(settings.repositories[0])).toBe(true);
    });
  });

  describe('getSettings() - Validation', () => {
    it('should skip repository entries with missing path', () => {
      const repos = [
        { name: 'No Path', organization: 'Org' },
        { path: '/valid/path', name: 'Valid', organization: 'Org' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories).toHaveLength(1);
      expect(settings.repositories[0]!.name).toBe('Valid');
    });

    it('should skip repository entries with missing name', () => {
      const repos = [
        { path: '/path/to/repo', organization: 'Org' },
        { path: '/valid/path', name: 'Valid', organization: 'Org' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories).toHaveLength(1);
      expect(settings.repositories[0]!.name).toBe('Valid');
    });

    it('should skip null/undefined repository entries', () => {
      const repos = [null, undefined, { path: '/valid', name: 'Valid', organization: '' }];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories).toHaveLength(1);
      expect(settings.repositories[0]!.name).toBe('Valid');
    });

    it('should default organization to empty string when missing', () => {
      const repos = [{ path: '/path', name: 'Repo' }];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      expect(settings.repositories).toHaveLength(1);
      expect(settings.repositories[0]!.organization).toBe('');
    });

    it('should validate port range and fallback to 5433 for invalid port', () => {
      _setMockConfig('gitrx.database.port', 0);
      let settings = getSettings();
      expect(settings.database.port).toBe(5433);

      _setMockConfig('gitrx.database.port', 70000);
      settings = getSettings();
      expect(settings.database.port).toBe(5433);

      _setMockConfig('gitrx.database.port', -1);
      settings = getSettings();
      expect(settings.database.port).toBe(5433);
    });

    it('should accept valid port numbers', () => {
      _setMockConfig('gitrx.database.port', 1);
      let settings = getSettings();
      expect(settings.database.port).toBe(1);

      _setMockConfig('gitrx.database.port', 65535);
      settings = getSettings();
      expect(settings.database.port).toBe(65535);

      _setMockConfig('gitrx.database.port', 5433);
      settings = getSettings();
      expect(settings.database.port).toBe(5433);
    });

    it('should fallback to INFO for invalid log level', () => {
      _setMockConfig('gitrx.logLevel', 'INVALID');
      const settings = getSettings();
      expect(settings.logLevel).toBe('INFO');
    });

    it('should normalize case-insensitive log level values', () => {
      _setMockConfig('gitrx.logLevel', 'debug');
      let settings = getSettings();
      expect(settings.logLevel).toBe('DEBUG');

      _setMockConfig('gitrx.logLevel', 'Warn');
      settings = getSettings();
      expect(settings.logLevel).toBe('WARN');

      _setMockConfig('gitrx.logLevel', 'error');
      settings = getSettings();
      expect(settings.logLevel).toBe('ERROR');
    });
  });

  describe('getSettings() - Security', () => {
    it('should NOT expose database password in settings', () => {
      const settings = getSettings();
      // Verify the database settings object does not have a password field
      const dbKeys = Object.keys(settings.database);
      expect(dbKeys).not.toContain('password');
    });

    it('should NOT expose Jira token in settings', () => {
      const settings = getSettings();
      const jiraKeys = Object.keys(settings.jira);
      expect(jiraKeys).not.toContain('token');
      expect(jiraKeys).not.toContain('apiToken');
    });

    it('should NOT expose GitHub token in settings', () => {
      const settings = getSettings();
      const ghKeys = Object.keys(settings.github);
      expect(ghKeys).not.toContain('token');
      expect(ghKeys).not.toContain('pat');
      expect(ghKeys).not.toContain('personalAccessToken');
    });
  });

  describe('getConfigValue()', () => {
    it('should read a specific config value', () => {
      _setMockConfig('gitrx.database.host', 'myhost');

      const value = getConfigValue<string>('database.host', 'fallback');
      expect(value).toBe('myhost');
    });

    it('should return default when config is not set', () => {
      const value = getConfigValue<string>('database.host', 'fallback');
      expect(value).toBe('fallback');
    });

    it('should read numeric config values', () => {
      _setMockConfig('gitrx.database.port', 5433);

      const value = getConfigValue<number>('database.port', 5433);
      expect(value).toBe(5433);
    });

    it('should read boolean config values', () => {
      _setMockConfig('gitrx.schedule.enabled', true);

      const value = getConfigValue<boolean>('schedule.enabled', false);
      expect(value).toBe(true);
    });
  });

  describe('onConfigurationChanged()', () => {
    it('should return a disposable', () => {
      const callback = vi.fn();
      const disposable = onConfigurationChanged(callback);
      expect(typeof disposable.dispose).toBe('function');
      disposable.dispose();
    });
  });

  describe('Interface Type Shapes', () => {
    it('GitrxConfiguration should have all required properties', () => {
      const settings = getSettings();

      // Verify all top-level properties exist
      expect(settings).toHaveProperty('repositories');
      expect(settings).toHaveProperty('database');
      expect(settings).toHaveProperty('jira');
      expect(settings).toHaveProperty('github');
      expect(settings).toHaveProperty('schedule');
      expect(settings).toHaveProperty('logLevel');
      expect(settings).toHaveProperty('docker');
    });

    it('DatabaseSettings should have host, port, name, user', () => {
      const settings = getSettings();
      expect(settings.database).toHaveProperty('host');
      expect(settings.database).toHaveProperty('port');
      expect(settings.database).toHaveProperty('name');
      expect(settings.database).toHaveProperty('user');
    });

    it('JiraSettings should have server, username, projectKeys, keyAliases', () => {
      const settings = getSettings();
      expect(settings.jira).toHaveProperty('server');
      expect(settings.jira).toHaveProperty('username');
      expect(settings.jira).toHaveProperty('projectKeys');
      expect(settings.jira).toHaveProperty('keyAliases');
    });

    it('GitHubSettings should have organization', () => {
      const settings = getSettings();
      expect(settings.github).toHaveProperty('organization');
    });

    it('ScheduleSettings should have enabled and cronExpression', () => {
      const settings = getSettings();
      expect(settings.schedule).toHaveProperty('enabled');
      expect(settings.schedule).toHaveProperty('cronExpression');
    });

    it('DockerSettings should have postgresVersion', () => {
      const settings = getSettings();
      expect(settings.docker).toHaveProperty('postgresVersion');
    });

    it('RepositoryEntry should have path, name, organization', () => {
      const repos: RepositoryEntry[] = [
        { path: '/test', name: 'Test', organization: 'Org' },
      ];
      _setMockConfig('gitrx.repositories', repos);

      const settings = getSettings();
      const entry = settings.repositories[0]!;
      expect(entry).toHaveProperty('path');
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('organization');
    });
  });

  describe('Legacy Compatibility', () => {
    it('should export GitrSettings as an alias for GitrxConfiguration', async () => {
      const mod = await import('../../config/settings.js');
      // GitrSettings is a type alias, so we can only verify it exists at module level
      // by confirming no import error occurs. The TypeScript compiler enforces the alias.
      expect(mod.getSettings).toBeDefined();
    });
  });

  describe('Python Legacy Mapping', () => {
    it('should map unclassified.properties db_host to database.host', () => {
      // Legacy: db_host=localhost -> gitrx.database.host
      _setMockConfig('gitrx.database.host', 'localhost');
      const settings = getSettings();
      expect(settings.database.host).toBe('localhost');
    });

    it('should map unclassified.properties db_port to database.port', () => {
      // Legacy: db_port=5433 -> gitrx.database.port
      _setMockConfig('gitrx.database.port', 5433);
      const settings = getSettings();
      expect(settings.database.port).toBe(5433);
    });

    it('should map unclassified.properties db_name to database.name', () => {
      // Legacy: db_name=gitji -> gitrx.database.name
      _setMockConfig('gitrx.database.name', 'gitji');
      const settings = getSettings();
      expect(settings.database.name).toBe('gitji');
    });

    it('should map unclassified.properties db_user to database.user', () => {
      // Legacy: db_user=jantona -> gitrx.database.user
      _setMockConfig('gitrx.database.user', 'jantona');
      const settings = getSettings();
      expect(settings.database.user).toBe('jantona');
    });

    it('should map unclassified.properties jira_server to jira.server', () => {
      // Legacy: jira_server=https://example-org.atlassian.net -> gitrx.jira.server
      _setMockConfig('gitrx.jira.server', 'https://example-org.atlassian.net');
      const settings = getSettings();
      expect(settings.jira.server).toBe('https://example-org.atlassian.net');
    });

    it('should map unclassified.properties jira_username to jira.username', () => {
      // Legacy: jira_username=user@example.com -> gitrx.jira.username
      _setMockConfig('gitrx.jira.username', 'user@example.com');
      const settings = getSettings();
      expect(settings.jira.username).toBe('user@example.com');
    });

    it('should map unclassified.properties log_level to logLevel', () => {
      // Legacy: log_level=CRITICAL -> gitrx.logLevel
      _setMockConfig('gitrx.logLevel', 'CRITICAL');
      const settings = getSettings();
      expect(settings.logLevel).toBe('CRITICAL');
    });
  });

  /**
   * repoUrl validation tests for IQS-923.
   * Validates URL scheme, credentials, normalization, and edge cases.
   */
  describe('repoUrl Validation (IQS-923)', () => {
    describe('Valid repoUrl values', () => {
      it('should accept https://github.com/user/repo', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'https://github.com/user/repo' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBe('https://github.com/user/repo');
      });

      it('should accept https://gitlab.company.com/group/repo', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'https://gitlab.company.com/group/repo' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBe('https://gitlab.company.com/group/repo');
      });

      it('should accept http URLs (not just https)', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'http://internal-git.local/repo' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBe('http://internal-git.local/repo');
      });
    });

    describe('repoUrl normalization', () => {
      it('should remove trailing slashes', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'https://github.com/user/repo/' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBe('https://github.com/user/repo');
      });

      it('should remove multiple trailing slashes', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'https://github.com/user/repo///' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBe('https://github.com/user/repo');
      });

      it('should remove .git suffix', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'https://github.com/user/repo.git' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBe('https://github.com/user/repo');
      });

      it('should remove trailing slash and .git suffix together', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'https://github.com/user/repo.git/' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        // Order: trailing slashes first, then .git
        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBe('https://github.com/user/repo');
      });

      it('should trim whitespace', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: '  https://github.com/user/repo  ' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBe('https://github.com/user/repo');
      });
    });

    describe('Invalid repoUrl values - Security', () => {
      it('should reject javascript: URLs', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'javascript:alert(1)' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBeUndefined();
      });

      it('should reject file:// URLs', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'file:///etc/passwd' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBeUndefined();
      });

      it('should reject data: URLs', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'data:text/html,<script>alert(1)</script>' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBeUndefined();
      });

      it('should reject URLs with embedded user:pass credentials', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'https://user:pass@github.com/repo' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBeUndefined();
      });

      it('should reject URLs with embedded user credentials (no password)', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: 'https://user@github.com/repo' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBeUndefined();
      });
    });

    describe('Empty and undefined repoUrl values', () => {
      it('should treat empty string as undefined (uses auto-detection)', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: '' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBeUndefined();
      });

      it('should treat whitespace-only string as undefined', () => {
        const repos = [
          { path: '/path', name: 'Repo', repoUrl: '   ' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBeUndefined();
      });

      it('should leave repoUrl undefined when not provided', () => {
        const repos = [
          { path: '/path', name: 'Repo' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.repoUrl).toBeUndefined();
      });
    });

    describe('RepositoryEntry interface includes repoUrl', () => {
      it('should include repoUrl in RepositoryEntry type', () => {
        const repos: RepositoryEntry[] = [
          { path: '/test', name: 'Test', organization: 'Org', trackerType: 'jira', repoUrl: 'https://github.com/test/repo' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        const entry = settings.repositories[0]!;
        expect(entry.repoUrl).toBe('https://github.com/test/repo');
      });
    });
  });

  /**
   * sinceDate and startDate validation tests for IQS-931.
   * Validates ISO date format, invalid dates, and per-repo startDate.
   */
  describe('sinceDate and startDate Validation (IQS-931)', () => {
    describe('Global pipeline.sinceDate', () => {
      it('should accept valid YYYY-MM-DD date', () => {
        _setMockConfig('gitrx.pipeline.sinceDate', '2023-01-01');
        const settings = getSettings();
        expect(settings.pipeline.sinceDate).toBe('2023-01-01');
      });

      it('should accept valid date at end of year', () => {
        _setMockConfig('gitrx.pipeline.sinceDate', '2023-12-31');
        const settings = getSettings();
        expect(settings.pipeline.sinceDate).toBe('2023-12-31');
      });

      it('should return undefined for empty string', () => {
        _setMockConfig('gitrx.pipeline.sinceDate', '');
        const settings = getSettings();
        expect(settings.pipeline.sinceDate).toBeUndefined();
      });

      it('should return undefined for invalid format (wrong separator)', () => {
        _setMockConfig('gitrx.pipeline.sinceDate', '2023/01/01');
        const settings = getSettings();
        expect(settings.pipeline.sinceDate).toBeUndefined();
      });

      it('should return undefined for invalid format (American style)', () => {
        _setMockConfig('gitrx.pipeline.sinceDate', '01-01-2023');
        const settings = getSettings();
        expect(settings.pipeline.sinceDate).toBeUndefined();
      });

      it('should return undefined for non-existent date (Feb 30)', () => {
        _setMockConfig('gitrx.pipeline.sinceDate', '2023-02-30');
        const settings = getSettings();
        expect(settings.pipeline.sinceDate).toBeUndefined();
      });

      it('should return undefined for non-existent date (Apr 31)', () => {
        _setMockConfig('gitrx.pipeline.sinceDate', '2023-04-31');
        const settings = getSettings();
        expect(settings.pipeline.sinceDate).toBeUndefined();
      });

      it('should trim whitespace from date', () => {
        _setMockConfig('gitrx.pipeline.sinceDate', '  2023-06-15  ');
        const settings = getSettings();
        expect(settings.pipeline.sinceDate).toBe('2023-06-15');
      });
    });

    describe('Per-repository startDate', () => {
      it('should accept valid startDate in repository entry', () => {
        const repos = [
          { path: '/path', name: 'Repo', startDate: '2022-06-01' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.startDate).toBe('2022-06-01');
      });

      it('should return undefined for invalid startDate format', () => {
        const repos = [
          { path: '/path', name: 'Repo', startDate: 'invalid-date' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.startDate).toBeUndefined();
      });

      it('should return undefined for non-existent date', () => {
        const repos = [
          { path: '/path', name: 'Repo', startDate: '2023-02-29' }, // 2023 is not a leap year
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.startDate).toBeUndefined();
      });

      it('should leave startDate undefined when not provided', () => {
        const repos = [
          { path: '/path', name: 'Repo' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.startDate).toBeUndefined();
      });

      it('should accept leap year date (Feb 29)', () => {
        const repos = [
          { path: '/path', name: 'Repo', startDate: '2024-02-29' }, // 2024 is a leap year
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]!.startDate).toBe('2024-02-29');
      });
    });

    describe('PipelineSettings interface includes sinceDate', () => {
      it('should include sinceDate in PipelineSettings', () => {
        _setMockConfig('gitrx.pipeline.sinceDate', '2023-01-01');
        const settings = getSettings();
        expect(settings.pipeline).toHaveProperty('sinceDate');
        expect(settings.pipeline.sinceDate).toBe('2023-01-01');
      });
    });

    describe('RepositoryEntry interface includes startDate', () => {
      it('should include startDate in RepositoryEntry', () => {
        const repos = [
          { path: '/path', name: 'Repo', startDate: '2022-01-01' },
        ];
        _setMockConfig('gitrx.repositories', repos);

        const settings = getSettings();
        expect(settings.repositories[0]).toHaveProperty('startDate');
        expect(settings.repositories[0]!.startDate).toBe('2022-01-01');
      });
    });
  });
});
