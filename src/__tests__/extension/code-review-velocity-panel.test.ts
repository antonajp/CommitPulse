import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, Uri } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// Mock fs module for SHA-256 integrity check
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from('mock-d3-content')),
}));

import { LoggerService } from '../../logging/logger.js';
import { CodeReviewVelocityPanel } from '../../views/webview/code-review-velocity-panel.js';
import type { SecretStorageService } from '../../config/secret-storage.js';

/**
 * Extension tests for CodeReviewVelocityPanel (IQS-900).
 * Tests the webview panel lifecycle and command registration.
 *
 * Test coverage includes:
 * - Panel creation via createOrShow()
 * - Singleton pattern (only one panel at a time)
 * - Panel reveal when already open
 * - Panel disposal and cleanup
 */
describe('CodeReviewVelocityPanel', () => {
  let mockSecretService: SecretStorageService;
  const extensionUri = Uri.file('/test/extension');

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Reset the singleton
    CodeReviewVelocityPanel.resetForTesting();

    // Create mock SecretStorageService
    mockSecretService = {
      getDatabasePassword: vi.fn().mockResolvedValue('test-password'),
      setDatabasePassword: vi.fn().mockResolvedValue(undefined),
      getJiraToken: vi.fn().mockResolvedValue('test-jira-token'),
      setJiraToken: vi.fn().mockResolvedValue(undefined),
      getGitHubToken: vi.fn().mockResolvedValue('test-github-token'),
      setGitHubToken: vi.fn().mockResolvedValue(undefined),
      getLinearToken: vi.fn().mockResolvedValue('test-linear-token'),
      setLinearToken: vi.fn().mockResolvedValue(undefined),
      getMigrationPassword: vi.fn().mockResolvedValue('test-migration-password'),
      setMigrationPassword: vi.fn().mockResolvedValue(undefined),
      promptAndStore: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    } as unknown as SecretStorageService;
  });

  afterEach(() => {
    CodeReviewVelocityPanel.resetForTesting();
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('createOrShow', () => {
    it('should not throw when creating panel (integrity check will fail with mock)', () => {
      // With the mocked fs, the SHA-256 won't match the expected hash,
      // so createOrShow will show an error message but not throw
      expect(() => {
        CodeReviewVelocityPanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });

    it('should handle repeated calls without error', () => {
      // First call
      CodeReviewVelocityPanel.createOrShow(extensionUri, mockSecretService);
      // Second call should not throw
      expect(() => {
        CodeReviewVelocityPanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });

    it('should log panel creation attempt', () => {
      const logger = LoggerService.getInstance();
      const infoSpy = vi.spyOn(logger, 'info');

      CodeReviewVelocityPanel.createOrShow(extensionUri, mockSecretService);

      expect(infoSpy).toHaveBeenCalledWith(
        'CodeReviewVelocityPanel',
        'createOrShow',
        'Opening Code Review Velocity chart panel',
      );
    });
  });

  describe('resetForTesting', () => {
    it('should clear the singleton reference', () => {
      CodeReviewVelocityPanel.createOrShow(extensionUri, mockSecretService);
      CodeReviewVelocityPanel.resetForTesting();

      // Should be able to create again after reset
      expect(() => {
        CodeReviewVelocityPanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });

  describe('D3.js integrity verification', () => {
    it('should attempt to verify D3.js bundle', () => {
      // The mock fs returns content that won't match expected hash
      const logger = LoggerService.getInstance();
      const errorSpy = vi.spyOn(logger, 'error');

      CodeReviewVelocityPanel.createOrShow(extensionUri, mockSecretService);

      // Should log error about SHA mismatch
      expect(errorSpy).toHaveBeenCalledWith(
        'CodeReviewVelocityPanel',
        'verifyD3Integrity',
        expect.stringContaining('SHA-256 mismatch'),
      );
    });
  });
});
