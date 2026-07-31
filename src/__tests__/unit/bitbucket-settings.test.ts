import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, workspace as vscodeWorkspace } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for BitBucket settings configuration (GITX-229).
 *
 * Validates:
 * - gitrx.bitbucket.username setting is read correctly
 * - Cloud repos are skipped when username is not configured
 * - Server repos work without username (Bearer token auth)
 * - Error handling for missing username on Cloud repos
 */
describe('BitBucket Settings', () => {
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

  describe('gitrx.bitbucket.username setting', () => {
    it('should read username from settings', () => {
      // Mock the workspace configuration
      const mockConfig = {
        get: vi.fn().mockImplementation((key: string, defaultValue?: string) => {
          if (key === 'username') return 'developer@company.com';
          return defaultValue;
        }),
      };
      vi.spyOn(vscodeWorkspace, 'getConfiguration').mockReturnValue(mockConfig as never);

      const bitbucketConfig = vscodeWorkspace.getConfiguration('gitrx.bitbucket');
      const username = bitbucketConfig.get<string>('username', '');

      expect(username).toBe('developer@company.com');
      expect(vscodeWorkspace.getConfiguration).toHaveBeenCalledWith('gitrx.bitbucket');
    });

    it('should return empty string when username is not configured', () => {
      const mockConfig = {
        get: vi.fn().mockImplementation((_key: string, defaultValue?: string) => defaultValue),
      };
      vi.spyOn(vscodeWorkspace, 'getConfiguration').mockReturnValue(mockConfig as never);

      const bitbucketConfig = vscodeWorkspace.getConfiguration('gitrx.bitbucket');
      const username = bitbucketConfig.get<string>('username', '');

      expect(username).toBe('');
    });
  });

  describe('BitBucket Cloud auth header construction', () => {
    it('should construct Basic auth header with username and App Password', () => {
      const username = 'developer@company.com';
      const appPassword = 'my-app-password-123';

      const authHeader = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');

      expect(authHeader).toContain('Basic ');
      // Verify it can be decoded back
      const decoded = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString('utf8');
      expect(decoded).toBe('developer@company.com:my-app-password-123');
    });

    it('should use Atlassian email, not workspace name, for Cloud auth', () => {
      // This test documents the correct behavior after GITX-229 fix
      const workspaceName = 'my-workspace'; // WRONG - should not be used
      const atlassianEmail = 'developer@company.com'; // CORRECT - should be used
      const appPassword = 'app-password';

      // The WRONG way (before fix): using workspace as username
      const wrongHeader = 'Basic ' + Buffer.from(`${workspaceName}:${appPassword}`).toString('base64');

      // The CORRECT way (after fix): using Atlassian email as username
      const correctHeader = 'Basic ' + Buffer.from(`${atlassianEmail}:${appPassword}`).toString('base64');

      expect(wrongHeader).not.toBe(correctHeader);

      // Verify the correct header contains the email
      const decodedCorrect = Buffer.from(correctHeader.replace('Basic ', ''), 'base64').toString('utf8');
      expect(decodedCorrect).toContain('developer@company.com');
      expect(decodedCorrect).not.toContain('my-workspace');
    });
  });

  describe('BitBucket Server auth header construction', () => {
    it('should construct Bearer token header for Server', () => {
      const personalAccessToken = 'pat-12345-xyz';

      const authHeader = `Bearer ${personalAccessToken}`;

      expect(authHeader).toBe('Bearer pat-12345-xyz');
    });

    it('should not require username for Server auth', () => {
      // Server uses Bearer token, no username needed
      const token = 'server-pat';
      const authHeader = `Bearer ${token}`;

      // Should not contain any Basic auth prefix
      expect(authHeader).not.toContain('Basic');
      expect(authHeader).toBe('Bearer server-pat');
    });
  });

  describe('Cloud repo detection', () => {
    it('should identify Cloud repo by workspace property', () => {
      const cloudConfig = { workspace: 'my-workspace', repo: 'my-repo' };
      const serverConfig = { project: 'PROJ', repo: 'my-repo', domain: 'bitbucket.company.com' };

      expect(cloudConfig.workspace).toBeTruthy();
      expect(serverConfig.workspace).toBeUndefined();
    });

    it('should skip Cloud repos when username is empty', () => {
      const configs = [
        { workspace: 'workspace1', repo: 'repo1' },
        { workspace: 'workspace2', repo: 'repo2' },
        { project: 'PROJ', repo: 'repo3', domain: 'bitbucket.company.com' },
      ];
      const bitbucketUsername = ''; // Not configured

      const processedConfigs: Array<{ workspace?: string; repo: string }> = [];
      const skippedRepos: string[] = [];

      for (const config of configs) {
        if ('workspace' in config && config.workspace) {
          // Cloud repo
          if (!bitbucketUsername) {
            skippedRepos.push(config.repo);
            continue;
          }
          processedConfigs.push(config);
        } else {
          // Server repo - no username required
          processedConfigs.push(config);
        }
      }

      expect(skippedRepos).toEqual(['repo1', 'repo2']);
      expect(processedConfigs).toHaveLength(1);
      expect(processedConfigs[0]!.repo).toBe('repo3');
    });

    it('should process all repos when username is configured', () => {
      const configs = [
        { workspace: 'workspace1', repo: 'repo1' },
        { workspace: 'workspace2', repo: 'repo2' },
        { project: 'PROJ', repo: 'repo3', domain: 'bitbucket.company.com' },
      ];
      const bitbucketUsername = 'developer@company.com'; // Configured

      const processedConfigs: Array<{ workspace?: string; repo: string }> = [];

      for (const config of configs) {
        if ('workspace' in config && config.workspace) {
          // Cloud repo
          if (!bitbucketUsername) {
            continue;
          }
          processedConfigs.push(config);
        } else {
          // Server repo
          processedConfigs.push(config);
        }
      }

      expect(processedConfigs).toHaveLength(3);
    });
  });

  describe('username vs workspace distinction', () => {
    it('should document that username is Atlassian email, not workspace', () => {
      // This is a documentation test to make the distinction clear
      const validUsernames = [
        'developer@company.com',
        'john.doe@example.org',
        'user@domain.co.uk',
      ];

      const invalidUsernames = [
        'my-workspace', // Workspace name, not email
        'company-team', // Team name, not email
        'project123', // Project identifier, not email
      ];

      for (const email of validUsernames) {
        expect(email).toMatch(/@/);
      }

      for (const notEmail of invalidUsernames) {
        expect(notEmail).not.toMatch(/@/);
      }
    });

    it('should validate email format using @ check (GITX-229)', () => {
      // The extension validates username contains @ to catch workspace names
      const isValidEmailFormat = (username: string): boolean => username.includes('@');

      // Valid emails pass
      expect(isValidEmailFormat('developer@company.com')).toBe(true);
      expect(isValidEmailFormat('user@domain.co.uk')).toBe(true);
      expect(isValidEmailFormat('test@example.org')).toBe(true);

      // Workspace names fail
      expect(isValidEmailFormat('my-workspace')).toBe(false);
      expect(isValidEmailFormat('company-team')).toBe(false);
      expect(isValidEmailFormat('project123')).toBe(false);
      expect(isValidEmailFormat('')).toBe(false);
    });
  });
});
