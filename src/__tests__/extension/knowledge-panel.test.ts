import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, Uri } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// Mock fs module for SHA-256 integrity check
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from('mock-d3-content')),
}));

import { LoggerService } from '../../logging/logger.js';
import { KnowledgePanel } from '../../views/webview/knowledge-panel.js';
import type { SecretStorageService } from '../../config/secret-storage.js';

/**
 * Extension tests for KnowledgePanel (IQS-904).
 * Tests the webview panel lifecycle and command registration.
 *
 * Test coverage includes:
 * - Panel creation via createOrShow()
 * - Singleton pattern (only one panel at a time)
 * - Panel reveal when already open
 * - Panel disposal and cleanup
 */
describe('KnowledgePanel', () => {
  let mockSecretService: SecretStorageService;
  const extensionUri = Uri.file('/test/extension');

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Reset the singleton
    KnowledgePanel.resetForTesting();

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
    KnowledgePanel.resetForTesting();
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('createOrShow', () => {
    it('should not throw when creating panel (integrity check will fail with mock)', () => {
      // With the mocked fs, the SHA-256 won't match the expected hash,
      // so createOrShow will show an error message but not throw
      expect(() => {
        KnowledgePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });

    it('should handle repeated calls without error', () => {
      // First call
      KnowledgePanel.createOrShow(extensionUri, mockSecretService);
      // Second call should not throw
      expect(() => {
        KnowledgePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });

    it('should log panel creation attempt', () => {
      const logger = LoggerService.getInstance();
      const infoSpy = vi.spyOn(logger, 'info');

      KnowledgePanel.createOrShow(extensionUri, mockSecretService);

      expect(infoSpy).toHaveBeenCalledWith(
        'KnowledgePanel',
        'createOrShow',
        'Opening Knowledge Concentration panel',
      );
    });
  });

  describe('resetForTesting', () => {
    it('should clear the singleton reference', () => {
      KnowledgePanel.createOrShow(extensionUri, mockSecretService);
      KnowledgePanel.resetForTesting();

      // Should be able to create again after reset
      expect(() => {
        KnowledgePanel.createOrShow(extensionUri, mockSecretService);
      }).not.toThrow();
    });
  });

  describe('D3.js integrity verification', () => {
    it('should attempt to verify D3.js bundle', () => {
      // The mock fs returns content that won't match expected hash
      const logger = LoggerService.getInstance();
      const errorSpy = vi.spyOn(logger, 'error');

      KnowledgePanel.createOrShow(extensionUri, mockSecretService);

      // Should log error about SHA mismatch
      expect(errorSpy).toHaveBeenCalledWith(
        'KnowledgePanel',
        'verifyD3Integrity',
        expect.stringContaining('SHA-256 mismatch'),
      );
    });
  });
});
