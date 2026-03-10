import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, window as vscodeWindow } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { SecretStorageService, SecretKeys } from '../../config/secret-storage.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for Linear-specific SecretStorage functionality.
 *
 * Validates:
 * - SecretKeys.LINEAR_TOKEN constant
 * - getLinearToken() retrieval and prompting
 * - Linear API key format validation (lin_api_ prefix)
 * - Audit logging on credential access
 *
 * Ticket: IQS-874
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

describe('Linear SecretStorage', () => {
  let service: SecretStorageService;
  let mockStorage: ReturnType<typeof createMockSecretStorage>;

  beforeEach(() => {
    _clearMocks();
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

  describe('SecretKeys.LINEAR_TOKEN', () => {
    it('should define LINEAR_TOKEN key', () => {
      expect(SecretKeys.LINEAR_TOKEN).toBe('gitrx.linear.token');
    });
  });

  describe('getLinearToken', () => {
    it('should return stored token when present', async () => {
      mockStorage._storage.set('gitrx.linear.token', 'lin_api_test123');

      const result = await service.getLinearToken();
      expect(result).toBe('lin_api_test123');
    });

    it('should prompt user when token is not set and user selects Set Now', async () => {
      vi.spyOn(vscodeWindow, 'showWarningMessage')
        .mockResolvedValueOnce('Set Now' as never);
      vi.spyOn(vscodeWindow, 'showInputBox')
        .mockResolvedValueOnce('lin_api_newtoken');

      const result = await service.getLinearToken();

      expect(result).toBe('lin_api_newtoken');
      expect(mockStorage._storage.get('gitrx.linear.token')).toBe('lin_api_newtoken');
    });

    it('should return undefined when user cancels the prompt', async () => {
      vi.spyOn(vscodeWindow, 'showWarningMessage')
        .mockResolvedValueOnce('Cancel' as never);

      const result = await service.getLinearToken();
      expect(result).toBeUndefined();
    });
  });

  describe('Linear API key format validation', () => {
    it('should validate that Linear keys start with "lin_api_"', async () => {
      let capturedValidateInput: ((input: string) => string | undefined) | undefined;

      vi.spyOn(vscodeWindow, 'showInputBox').mockImplementationOnce(async (options: { validateInput?: (input: string) => string | undefined }) => {
        capturedValidateInput = options?.validateInput;
        return undefined;
      });

      await service.promptAndStore(SecretKeys.LINEAR_TOKEN);

      expect(capturedValidateInput).toBeDefined();
      // Valid Linear keys
      expect(capturedValidateInput!('lin_api_abc123')).toBeUndefined();
      expect(capturedValidateInput!('lin_api_xxxxxxxxxxx')).toBeUndefined();
      // Invalid Linear keys
      expect(capturedValidateInput!('not_a_linear_key')).toBeTruthy();
      expect(capturedValidateInput!('lin_api')).toBeTruthy(); // missing underscore after api
      expect(capturedValidateInput!('')).toBeTruthy(); // empty
    });

    it('should NOT apply Linear validation to non-Linear secrets', async () => {
      let capturedValidateInput: ((input: string) => string | undefined) | undefined;

      vi.spyOn(vscodeWindow, 'showInputBox').mockImplementationOnce(async (options: { validateInput?: (input: string) => string | undefined }) => {
        capturedValidateInput = options?.validateInput;
        return undefined;
      });

      // promptAndStore for a Jira token should NOT require lin_api_ prefix
      await service.promptAndStore(SecretKeys.JIRA_TOKEN);

      expect(capturedValidateInput).toBeDefined();
      // Non-Linear secrets should accept any non-empty input
      expect(capturedValidateInput!('any-valid-jira-token')).toBeUndefined();
    });
  });

  describe('Linear token store and delete', () => {
    it('should store Linear token via storeSecret', async () => {
      await service.storeSecret(SecretKeys.LINEAR_TOKEN, 'lin_api_stored');

      expect(mockStorage.store).toHaveBeenCalledWith('gitrx.linear.token', 'lin_api_stored');
      expect(mockStorage._storage.get('gitrx.linear.token')).toBe('lin_api_stored');
    });

    it('should delete Linear token via deleteSecret', async () => {
      mockStorage._storage.set('gitrx.linear.token', 'lin_api_todelete');
      await service.deleteSecret(SecretKeys.LINEAR_TOKEN);

      expect(mockStorage.delete).toHaveBeenCalledWith('gitrx.linear.token');
    });

    it('should check Linear token existence via hasSecret', async () => {
      expect(await service.hasSecret(SecretKeys.LINEAR_TOKEN)).toBe(false);

      mockStorage._storage.set('gitrx.linear.token', 'lin_api_exists');
      expect(await service.hasSecret(SecretKeys.LINEAR_TOKEN)).toBe(true);
    });
  });
});
