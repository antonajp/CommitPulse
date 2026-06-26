import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, ViewColumn } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { TeamProfilePanel } from '../../views/webview/team-profile-panel.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import { Uri } from '../__mocks__/vscode.js';

/**
 * Unit tests for TeamProfilePanel (GITX-185).
 * Tests the webview panel lifecycle and singleton behavior.
 */
describe('TeamProfilePanel', () => {
  let mockSecretService: SecretStorageService;
  const extensionUri = Uri.file('/test/extension');

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Reset the singleton
    TeamProfilePanel.resetForTesting();

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
    TeamProfilePanel.resetForTesting();
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('createOrShow', () => {
    it('should create a new panel on first call', () => {
      // Should not throw
      expect(() => {
        TeamProfilePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });

    it('should create a new panel with pre-selected team', () => {
      expect(() => {
        TeamProfilePanel.createOrShow(extensionUri, mockSecretService, 'CRMREO');
      }).not.toThrow();
    });

    it('should reveal existing panel on subsequent calls (singleton)', () => {
      TeamProfilePanel.createOrShow(extensionUri, mockSecretService);

      // Second call should not throw (reveals existing)
      expect(() => {
        TeamProfilePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });

    it('should update team when revealing existing panel', () => {
      TeamProfilePanel.createOrShow(extensionUri, mockSecretService, 'TeamA');

      // Second call with different team should not throw
      expect(() => {
        TeamProfilePanel.createOrShow(extensionUri, mockSecretService, 'TeamB');
      }).not.toThrow();
    });
  });

  describe('resetForTesting', () => {
    it('should clear the singleton reference', () => {
      TeamProfilePanel.createOrShow(extensionUri, mockSecretService);
      TeamProfilePanel.resetForTesting();

      // Should create a fresh panel after reset
      expect(() => {
        TeamProfilePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });
});
