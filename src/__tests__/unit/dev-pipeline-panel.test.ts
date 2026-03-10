import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// Mock fs module for SHA-256 integrity check
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from('mock-d3-content')),
}));

import { LoggerService } from '../../logging/logger.js';
import { DevPipelinePanel } from '../../views/webview/dev-pipeline-panel.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import { Uri } from '../__mocks__/vscode.js';

/**
 * Unit tests for DevPipelinePanel (IQS-897).
 * Tests the webview panel lifecycle and singleton behavior.
 */
describe('DevPipelinePanel', () => {
  let mockSecretService: SecretStorageService;
  const extensionUri = Uri.file('/test/extension');

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Reset the singleton
    DevPipelinePanel.resetForTesting();

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
    DevPipelinePanel.resetForTesting();
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('createOrShow', () => {
    it('should not throw when creating panel (integrity check will fail with mock)', () => {
      // With the mocked fs, the SHA-256 won't match the expected hash,
      // so createOrShow will show an error message but not throw
      expect(() => {
        DevPipelinePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });

    it('should handle repeated calls without error', () => {
      // First call
      DevPipelinePanel.createOrShow(extensionUri, mockSecretService);
      // Second call should not throw
      expect(() => {
        DevPipelinePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });

  describe('resetForTesting', () => {
    it('should clear the singleton reference', () => {
      DevPipelinePanel.createOrShow(extensionUri, mockSecretService);
      DevPipelinePanel.resetForTesting();

      // Should be able to create again after reset
      expect(() => {
        DevPipelinePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });
});
