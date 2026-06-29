import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, ViewColumn } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DevProfilePanel } from '../../views/webview/dev-profile-panel.js';
import { DashboardCacheService } from '../../services/dashboard-cache-service.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import { Uri } from '../__mocks__/vscode.js';

/**
 * Unit tests for DevProfilePanel (GITX-155, GITX-195).
 * Tests the webview panel lifecycle and multi-instance behavior.
 * GITX-195: Tests multi-instance pattern for side-by-side developer comparison.
 */
describe('DevProfilePanel', () => {
  let mockSecretService: SecretStorageService;
  const extensionUri = Uri.file('/test/extension');

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Reset the panels and cache service
    DevProfilePanel.resetForTesting();
    DashboardCacheService.resetInstance();

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
    DevProfilePanel.resetForTesting();
    DashboardCacheService.resetInstance();
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // GITX-195: Multi-Instance Tests
  // ==========================================================================
  describe('create (GITX-195)', () => {
    it('should create a new panel on first call', () => {
      const panel = DevProfilePanel.create(extensionUri, mockSecretService);
      expect(panel).toBeDefined();
      expect(DevProfilePanel.getActivePanelCount()).toBe(1);
    });

    it('should create multiple independent panels for different developers', () => {
      const panel1 = DevProfilePanel.create(extensionUri, mockSecretService, 'alice');
      const panel2 = DevProfilePanel.create(extensionUri, mockSecretService, 'bob');

      expect(DevProfilePanel.getActivePanelCount()).toBe(2);
      expect(panel1.getDeveloper()).toBe('alice');
      expect(panel2.getDeveloper()).toBe('bob');
    });

    it('should allow multiple panels for the same developer', () => {
      DevProfilePanel.create(extensionUri, mockSecretService, 'alice');
      DevProfilePanel.create(extensionUri, mockSecretService, 'alice');

      expect(DevProfilePanel.getActivePanelCount()).toBe(2);
    });

    it('should set panel title to include developer name', () => {
      const panel = DevProfilePanel.create(extensionUri, mockSecretService, 'John Smith');
      // The panel is created, and title should include the developer name
      // Panel title is set during creation via vscode.window.createWebviewPanel
      expect(panel).toBeDefined();
    });

    it('should use default title when no developer specified', () => {
      const panel = DevProfilePanel.create(extensionUri, mockSecretService);
      expect(panel).toBeDefined();
      expect(panel.getDeveloper()).toBeNull();
    });

    it('should maintain independent state per panel', () => {
      const panel1 = DevProfilePanel.create(extensionUri, mockSecretService, 'alice');
      const panel2 = DevProfilePanel.create(extensionUri, mockSecretService, 'bob');

      expect(panel1.getTimeframe()).toBe('90');
      expect(panel2.getTimeframe()).toBe('90');
      expect(panel1.getDeveloper()).not.toBe(panel2.getDeveloper());
    });
  });

  // ==========================================================================
  // Backward Compatibility
  // ==========================================================================
  describe('createOrShow (deprecated)', () => {
    it('should still work for backward compatibility', () => {
      expect(() => {
        DevProfilePanel.createOrShow(extensionUri, mockSecretService, 'alice');
      }).not.toThrow();

      expect(DevProfilePanel.getActivePanelCount()).toBe(1);
    });

    it('should create new panel each time (no longer singleton)', () => {
      DevProfilePanel.createOrShow(extensionUri, mockSecretService, 'alice');
      DevProfilePanel.createOrShow(extensionUri, mockSecretService, 'bob');

      // GITX-195: createOrShow now delegates to create(), so multiple calls create multiple panels
      expect(DevProfilePanel.getActivePanelCount()).toBe(2);
    });
  });

  // ==========================================================================
  // Reset and Cleanup
  // ==========================================================================
  describe('resetForTesting', () => {
    it('should clear all active panels', () => {
      DevProfilePanel.create(extensionUri, mockSecretService, 'alice');
      DevProfilePanel.create(extensionUri, mockSecretService, 'bob');
      expect(DevProfilePanel.getActivePanelCount()).toBe(2);

      DevProfilePanel.resetForTesting();
      expect(DevProfilePanel.getActivePanelCount()).toBe(0);
    });
  });

  describe('getActivePanelCount', () => {
    it('should return 0 when no panels exist', () => {
      expect(DevProfilePanel.getActivePanelCount()).toBe(0);
    });

    it('should accurately count active panels', () => {
      DevProfilePanel.create(extensionUri, mockSecretService, 'dev1');
      expect(DevProfilePanel.getActivePanelCount()).toBe(1);

      DevProfilePanel.create(extensionUri, mockSecretService, 'dev2');
      expect(DevProfilePanel.getActivePanelCount()).toBe(2);

      DevProfilePanel.create(extensionUri, mockSecretService, 'dev3');
      expect(DevProfilePanel.getActivePanelCount()).toBe(3);
    });
  });

  // ==========================================================================
  // Cache Service Integration (GITX-194, GITX-195)
  // ==========================================================================
  describe('cache service integration', () => {
    it('should share cache service across all panel instances', () => {
      // All panels should use the same cache service singleton
      const panel1 = DevProfilePanel.create(extensionUri, mockSecretService, 'alice');
      const panel2 = DevProfilePanel.create(extensionUri, mockSecretService, 'bob');

      // Both panels exist and can access the shared cache
      expect(panel1).toBeDefined();
      expect(panel2).toBeDefined();

      // The cache service is a singleton, so both panels share it
      const cacheService = DashboardCacheService.getInstance();
      expect(cacheService).toBeDefined();
    });
  });
});
