import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, ViewColumn } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DashboardPanel } from '../../views/webview/dashboard-panel.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import { Uri } from '../__mocks__/vscode.js';

/**
 * Unit tests for DashboardPanel (IQS-869).
 * Tests the webview panel lifecycle and singleton behavior.
 */
describe('DashboardPanel', () => {
  let mockSecretService: SecretStorageService;
  const extensionUri = Uri.file('/test/extension');

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Reset the singleton
    DashboardPanel.resetForTesting();

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
    DashboardPanel.resetForTesting();
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('createOrShow', () => {
    it('should create a new panel on first call', () => {
      // Should not throw
      expect(() => {
        DashboardPanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });

    it('should reveal existing panel on subsequent calls (singleton)', () => {
      DashboardPanel.createOrShow(extensionUri, mockSecretService);

      // Second call should not throw (reveals existing)
      expect(() => {
        DashboardPanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });

  describe('resetForTesting', () => {
    it('should clear the singleton reference', () => {
      DashboardPanel.createOrShow(extensionUri, mockSecretService);
      DashboardPanel.resetForTesting();

      // Should create a fresh panel after reset
      expect(() => {
        DashboardPanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });
});
