import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, ViewColumn } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { LinkagePanel } from '../../views/webview/linkage-panel.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import { Uri } from '../__mocks__/vscode.js';

/**
 * Unit tests for LinkagePanel (IQS-870).
 * Tests the webview panel lifecycle and singleton behavior.
 */
describe('LinkagePanel', () => {
  let mockSecretService: SecretStorageService;
  const extensionUri = Uri.file('/test/extension');

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Reset the singleton
    LinkagePanel.resetForTesting();

    // Create mock SecretStorageService
    mockSecretService = {
      getDatabasePassword: vi.fn().mockResolvedValue('test-password'),
      getJiraToken: vi.fn().mockResolvedValue(undefined),
      getGitHubToken: vi.fn().mockResolvedValue(undefined),
      promptAndStore: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    } as unknown as SecretStorageService;
  });

  afterEach(() => {
    LinkagePanel.resetForTesting();
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('createOrShow', () => {
    it('should create a new panel on first call', () => {
      expect(() => {
        LinkagePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });

    it('should reveal existing panel on subsequent calls (singleton)', () => {
      LinkagePanel.createOrShow(extensionUri, mockSecretService);

      // Second call should not throw (reveals existing)
      expect(() => {
        LinkagePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });

  describe('resetForTesting', () => {
    it('should clear the singleton reference', () => {
      LinkagePanel.createOrShow(extensionUri, mockSecretService);
      LinkagePanel.resetForTesting();

      // Should create a fresh panel after reset
      expect(() => {
        LinkagePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });
});
