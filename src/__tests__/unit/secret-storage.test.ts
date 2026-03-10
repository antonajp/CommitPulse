import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, window as vscodeWindow } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { SecretStorageService, SecretKeys } from '../../config/secret-storage.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for SecretStorageService.
 *
 * Validates:
 * - Secret storage and retrieval via VS Code SecretStorage API
 * - Password-masked input prompts for each credential type
 * - Graceful handling when secrets are not set (prompt user)
 * - Error handling for storage failures
 * - Correct secret key constants
 *
 * Ticket: IQS-847
 */

/**
 * Create a mock SecretStorage that stores values in a Map.
 */
function createMockSecretStorage(): {
  get: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  onDidChange: ReturnType<typeof vi.fn>;
  _storage: Map<string, string>;
} {
  const storage = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => storage.get(key)),
    store: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    delete: vi.fn(async (key: string) => { storage.delete(key); }),
    onDidChange: vi.fn(() => ({ dispose: () => { /* noop */ } })),
    _storage: storage,
  };
}

describe('SecretStorageService', () => {
  let service: SecretStorageService;
  let mockStorage: ReturnType<typeof createMockSecretStorage>;

  beforeEach(() => {
    _clearMocks();
    // Reset logger singleton
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    mockStorage = createMockSecretStorage();
    service = new SecretStorageService(mockStorage as never);
  });

  afterEach(() => {
    service.dispose();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    _clearMocks();
  });

  describe('SecretKeys constants', () => {
    it('should define DATABASE_PASSWORD key', () => {
      expect(SecretKeys.DATABASE_PASSWORD).toBe('gitrx.db.password');
    });

    it('should define JIRA_TOKEN key', () => {
      expect(SecretKeys.JIRA_TOKEN).toBe('gitrx.jira.token');
    });

    it('should define GITHUB_TOKEN key', () => {
      expect(SecretKeys.GITHUB_TOKEN).toBe('gitrx.github.token');
    });
  });

  describe('storeSecret', () => {
    it('should store a secret in SecretStorage', async () => {
      await service.storeSecret(SecretKeys.DATABASE_PASSWORD, 'test-password');

      expect(mockStorage.store).toHaveBeenCalledWith('gitrx.db.password', 'test-password');
      expect(mockStorage._storage.get('gitrx.db.password')).toBe('test-password');
    });

    it('should store multiple different secrets independently', async () => {
      await service.storeSecret(SecretKeys.DATABASE_PASSWORD, 'db-pw');
      await service.storeSecret(SecretKeys.JIRA_TOKEN, 'jira-tok');
      await service.storeSecret(SecretKeys.GITHUB_TOKEN, 'gh-pat');

      expect(mockStorage._storage.get('gitrx.db.password')).toBe('db-pw');
      expect(mockStorage._storage.get('gitrx.jira.token')).toBe('jira-tok');
      expect(mockStorage._storage.get('gitrx.github.token')).toBe('gh-pat');
    });

    it('should throw when storage fails', async () => {
      mockStorage.store.mockRejectedValueOnce(new Error('Storage unavailable'));

      await expect(
        service.storeSecret(SecretKeys.DATABASE_PASSWORD, 'val')
      ).rejects.toThrow('Storage unavailable');
    });
  });

  describe('deleteSecret', () => {
    it('should delete a secret from SecretStorage', async () => {
      mockStorage._storage.set('gitrx.db.password', 'to-delete');
      await service.deleteSecret(SecretKeys.DATABASE_PASSWORD);

      expect(mockStorage.delete).toHaveBeenCalledWith('gitrx.db.password');
    });

    it('should throw when delete fails', async () => {
      mockStorage.delete.mockRejectedValueOnce(new Error('Delete failed'));

      await expect(
        service.deleteSecret(SecretKeys.JIRA_TOKEN)
      ).rejects.toThrow('Delete failed');
    });
  });

  describe('hasSecret', () => {
    it('should return true when secret exists', async () => {
      mockStorage._storage.set('gitrx.jira.token', 'some-token');

      const result = await service.hasSecret(SecretKeys.JIRA_TOKEN);
      expect(result).toBe(true);
    });

    it('should return false when secret does not exist', async () => {
      const result = await service.hasSecret(SecretKeys.GITHUB_TOKEN);
      expect(result).toBe(false);
    });
  });

  describe('getDatabasePassword', () => {
    it('should return stored password when present', async () => {
      mockStorage._storage.set('gitrx.db.password', 'my-db-password');

      const result = await service.getDatabasePassword();
      expect(result).toBe('my-db-password');
    });

    it('should prompt user when password is not set and user selects Set Now', async () => {
      const warnSpy = vi.spyOn(vscodeWindow, 'showWarningMessage')
        .mockResolvedValueOnce('Set Now' as never);
      const inputSpy = vi.spyOn(vscodeWindow, 'showInputBox')
        .mockResolvedValueOnce('entered-password');

      const result = await service.getDatabasePassword();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Database Password'),
        'Set Now',
        'Cancel'
      );
      expect(inputSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          password: true,
          ignoreFocusOut: true,
        })
      );
      expect(result).toBe('entered-password');
      expect(mockStorage._storage.get('gitrx.db.password')).toBe('entered-password');
    });

    it('should return undefined when user cancels the warning', async () => {
      vi.spyOn(vscodeWindow, 'showWarningMessage').mockResolvedValueOnce('Cancel' as never);

      const result = await service.getDatabasePassword();
      expect(result).toBeUndefined();
    });

    it('should return undefined when user dismisses the warning', async () => {
      vi.spyOn(vscodeWindow, 'showWarningMessage').mockResolvedValueOnce(undefined as never);

      const result = await service.getDatabasePassword();
      expect(result).toBeUndefined();
    });
  });

  describe('getJiraToken', () => {
    it('should return stored token when present', async () => {
      mockStorage._storage.set('gitrx.jira.token', 'my-jira-token');

      const result = await service.getJiraToken();
      expect(result).toBe('my-jira-token');
    });

    it('should prompt user when token is not set', async () => {
      vi.spyOn(vscodeWindow, 'showWarningMessage').mockResolvedValueOnce('Set Now' as never);
      vi.spyOn(vscodeWindow, 'showInputBox').mockResolvedValueOnce('jira-entered');

      const result = await service.getJiraToken();
      expect(result).toBe('jira-entered');
      expect(mockStorage._storage.get('gitrx.jira.token')).toBe('jira-entered');
    });
  });

  describe('getGitHubToken', () => {
    it('should return stored token when present', async () => {
      mockStorage._storage.set('gitrx.github.token', 'my-gh-pat');

      const result = await service.getGitHubToken();
      expect(result).toBe('my-gh-pat');
    });

    it('should prompt user when token is not set', async () => {
      vi.spyOn(vscodeWindow, 'showWarningMessage').mockResolvedValueOnce('Set Now' as never);
      vi.spyOn(vscodeWindow, 'showInputBox').mockResolvedValueOnce('gh-entered');

      const result = await service.getGitHubToken();
      expect(result).toBe('gh-entered');
      expect(mockStorage._storage.get('gitrx.github.token')).toBe('gh-entered');
    });
  });

  describe('promptAndStore', () => {
    it('should present a password-masked input box', async () => {
      const inputSpy = vi.spyOn(vscodeWindow, 'showInputBox')
        .mockResolvedValueOnce('some-value');

      await service.promptAndStore(SecretKeys.DATABASE_PASSWORD);

      expect(inputSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          password: true,
          ignoreFocusOut: true,
          prompt: expect.stringContaining('database password'),
          placeHolder: 'Database Password',
        })
      );
    });

    it('should store the entered value', async () => {
      vi.spyOn(vscodeWindow, 'showInputBox').mockResolvedValueOnce('stored-value');

      const result = await service.promptAndStore(SecretKeys.JIRA_TOKEN);

      expect(result).toBe('stored-value');
      expect(mockStorage._storage.get('gitrx.jira.token')).toBe('stored-value');
    });

    it('should show success notification after storing', async () => {
      const infoSpy = vi.spyOn(vscodeWindow, 'showInformationMessage');
      vi.spyOn(vscodeWindow, 'showInputBox').mockResolvedValueOnce('value');

      await service.promptAndStore(SecretKeys.GITHUB_TOKEN);

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('saved securely')
      );
    });

    it('should return undefined when user cancels input', async () => {
      vi.spyOn(vscodeWindow, 'showInputBox').mockResolvedValueOnce(undefined);

      const result = await service.promptAndStore(SecretKeys.DATABASE_PASSWORD);
      expect(result).toBeUndefined();
    });

    it('should validate that input is not empty', async () => {
      let capturedValidateInput: ((input: string) => string | undefined) | undefined;

      vi.spyOn(vscodeWindow, 'showInputBox').mockImplementationOnce(async (options: { validateInput?: (input: string) => string | undefined }) => {
        capturedValidateInput = options?.validateInput;
        return undefined;
      });

      await service.promptAndStore(SecretKeys.DATABASE_PASSWORD);

      expect(capturedValidateInput).toBeDefined();
      // Empty string should return error
      expect(capturedValidateInput!('')).toBeTruthy();
      expect(capturedValidateInput!('   ')).toBeTruthy();
      // Non-empty string should return undefined (valid)
      expect(capturedValidateInput!('valid-input')).toBeUndefined();
    });
  });

  describe('session rate limiting (IQS-881)', () => {
    it('should not re-prompt for the same key within the same session', async () => {
      const warnSpy = vi.spyOn(vscodeWindow, 'showWarningMessage')
        .mockResolvedValue('Cancel' as never);

      // First call: should prompt
      await service.getDatabasePassword();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Second call: should NOT prompt (rate-limited)
      const result = await service.getDatabasePassword();
      expect(warnSpy).toHaveBeenCalledTimes(1); // Still 1, no second prompt
      expect(result).toBeUndefined();
    });

    it('should allow prompts for different keys independently', async () => {
      const warnSpy = vi.spyOn(vscodeWindow, 'showWarningMessage')
        .mockResolvedValue('Cancel' as never);

      // Prompt for database password
      await service.getDatabasePassword();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Prompt for Jira token (different key) - should still prompt
      await service.getJiraToken();
      expect(warnSpy).toHaveBeenCalledTimes(2);

      // Prompt for GitHub token (different key) - should still prompt
      await service.getGitHubToken();
      expect(warnSpy).toHaveBeenCalledTimes(3);
    });

    it('should clear rate-limit after successful store via Set Now', async () => {
      vi.spyOn(vscodeWindow, 'showWarningMessage')
        .mockResolvedValueOnce('Set Now' as never)
        .mockResolvedValueOnce('Cancel' as never);
      vi.spyOn(vscodeWindow, 'showInputBox')
        .mockResolvedValueOnce('my-password');

      // First call: prompts and user stores a value
      const result1 = await service.getDatabasePassword();
      expect(result1).toBe('my-password');

      // Now delete the stored secret to trigger another prompt scenario
      mockStorage._storage.delete('gitrx.db.password');
      mockStorage.get.mockImplementation(async (key: string) => mockStorage._storage.get(key));

      // Second call: should prompt again because the rate-limit was cleared
      // after successful store
      const warnSpy = vi.spyOn(vscodeWindow, 'showWarningMessage')
        .mockResolvedValueOnce('Cancel' as never);
      await service.getDatabasePassword();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('should keep rate-limit when user cancels the prompt input', async () => {
      vi.spyOn(vscodeWindow, 'showWarningMessage')
        .mockResolvedValueOnce('Set Now' as never);
      vi.spyOn(vscodeWindow, 'showInputBox')
        .mockResolvedValueOnce(undefined); // User cancels input

      // First call: prompts, user cancels input
      const result1 = await service.getDatabasePassword();
      expect(result1).toBeUndefined();

      // Second call: should NOT prompt again (rate-limited)
      const warnSpy = vi.spyOn(vscodeWindow, 'showWarningMessage');
      const result2 = await service.getDatabasePassword();
      expect(result2).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should still return stored secret even if rate-limited', async () => {
      // Trigger rate limit
      vi.spyOn(vscodeWindow, 'showWarningMessage')
        .mockResolvedValueOnce('Cancel' as never);
      await service.getDatabasePassword();

      // Now store a secret directly
      mockStorage._storage.set('gitrx.db.password', 'stored-later');

      // Should return the stored value even though key was rate-limited
      const result = await service.getDatabasePassword();
      expect(result).toBe('stored-later');
    });

    it('should clear all rate-limits on dispose', async () => {
      const warnSpy = vi.spyOn(vscodeWindow, 'showWarningMessage')
        .mockResolvedValue('Cancel' as never);

      // Trigger rate limit
      await service.getDatabasePassword();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Dispose and recreate
      service.dispose();
      service = new SecretStorageService(mockStorage as never);

      // Should prompt again after re-creation (new instance, new Set)
      await service.getDatabasePassword();
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should handle SecretStorage.get failure gracefully', async () => {
      mockStorage.get.mockRejectedValueOnce(new Error('Access denied'));
      const errorSpy = vi.spyOn(vscodeWindow, 'showErrorMessage');

      const result = await service.getDatabasePassword();

      expect(result).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to access')
      );
    });
  });

  describe('dispose', () => {
    it('should dispose without error', () => {
      expect(() => service.dispose()).not.toThrow();
    });
  });
});
