import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// Mock fs module for SHA-256 integrity check
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from('mock-d3-content')),
}));

import { LoggerService } from '../../logging/logger.js';
import { StoryPointsTrendPanel } from '../../views/webview/story-points-trend-panel.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import { Uri } from '../__mocks__/vscode.js';

/**
 * Unit tests for StoryPointsTrendPanel (IQS-940).
 * Tests the webview panel lifecycle and singleton behavior.
 */
describe('StoryPointsTrendPanel', () => {
  let mockSecretService: SecretStorageService;
  const extensionUri = Uri.file('/test/extension');

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Reset the singleton
    StoryPointsTrendPanel.resetForTesting();

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
    StoryPointsTrendPanel.resetForTesting();
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('createOrShow', () => {
    it('should not throw when creating panel (integrity check will fail with mock)', () => {
      // With the mocked fs, the SHA-256 won't match the expected hash,
      // so createOrShow will show an error message but not throw
      expect(() => {
        StoryPointsTrendPanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });

    it('should handle repeated calls without error', () => {
      // First call
      StoryPointsTrendPanel.createOrShow(extensionUri, mockSecretService);
      // Second call should not throw
      expect(() => {
        StoryPointsTrendPanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });

  describe('resetForTesting', () => {
    it('should clear the singleton reference', () => {
      StoryPointsTrendPanel.createOrShow(extensionUri, mockSecretService);
      StoryPointsTrendPanel.resetForTesting();

      // Should be able to create again after reset
      expect(() => {
        StoryPointsTrendPanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });
});
