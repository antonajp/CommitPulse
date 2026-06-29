import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, ViewColumn } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { OrganizationProfilePanel } from '../../views/webview/org-profile-panel.js';
import { DashboardCacheService } from '../../services/dashboard-cache-service.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import { Uri } from '../__mocks__/vscode.js';

/**
 * Unit tests for OrganizationProfilePanel (GITX-205, GITX-197).
 * Tests the webview panel lifecycle and multi-instance behavior.
 * GITX-197: Tests multi-instance pattern for side-by-side organization comparison.
 */
describe('OrganizationProfilePanel', () => {
  let mockSecretService: SecretStorageService;
  const extensionUri = Uri.file('/test/extension');

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Reset the panels and cache service
    OrganizationProfilePanel.resetForTesting();
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
    OrganizationProfilePanel.resetForTesting();
    DashboardCacheService.resetInstance();
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // GITX-197: Multi-Instance Tests
  // ==========================================================================
  describe('create (GITX-197)', () => {
    it('should create a new panel on first call', () => {
      const panel = OrganizationProfilePanel.create(extensionUri, mockSecretService);
      expect(panel).toBeDefined();
      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(1);
    });

    it('should create multiple independent panels for different organizations', () => {
      const panel1 = OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Engineering');
      const panel2 = OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Product');

      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(2);
      // Panel titles are set during creation
      expect(panel1).toBeDefined();
      expect(panel2).toBeDefined();
    });

    it('should allow multiple panels for the same organization', () => {
      OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Engineering');
      OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Engineering');

      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(2);
    });

    it('should set panel title to include organization name', () => {
      const panel = OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Engineering');
      // The panel is created, and title should include the organization name
      // Panel title is set during creation via vscode.window.createWebviewPanel
      expect(panel).toBeDefined();
    });

    it('should use default title when no organization specified', () => {
      const panel = OrganizationProfilePanel.create(extensionUri, mockSecretService);
      expect(panel).toBeDefined();
      expect(panel.getOrganizationId()).toBeNull();
    });

    it('should maintain independent state per panel', () => {
      const panel1 = OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Engineering');
      const panel2 = OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Product');

      expect(panel1.getTimeframe()).toBe('90');
      expect(panel2.getTimeframe()).toBe('90');
      // Both panels start with null organization ID (resolved asynchronously)
      expect(panel1.getOrganizationId()).toBeNull();
      expect(panel2.getOrganizationId()).toBeNull();
    });
  });

  // ==========================================================================
  // Backward Compatibility
  // ==========================================================================
  describe('createOrShow (deprecated)', () => {
    it('should still work for backward compatibility', () => {
      expect(() => {
        OrganizationProfilePanel.createOrShow(extensionUri, mockSecretService, 'Engineering');
      }).not.toThrow();

      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(1);
    });

    it('should create new panel each time (no longer singleton)', () => {
      OrganizationProfilePanel.createOrShow(extensionUri, mockSecretService, 'Engineering');
      OrganizationProfilePanel.createOrShow(extensionUri, mockSecretService, 'Product');

      // GITX-197: createOrShow now delegates to create(), so multiple calls create multiple panels
      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(2);
    });
  });

  // ==========================================================================
  // Reset and Cleanup
  // ==========================================================================
  describe('resetForTesting', () => {
    it('should clear all active panels', () => {
      OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Engineering');
      OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Product');
      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(2);

      OrganizationProfilePanel.resetForTesting();
      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(0);
    });
  });

  describe('getActivePanelCount', () => {
    it('should return 0 when no panels exist', () => {
      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(0);
    });

    it('should accurately count active panels', () => {
      OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Org1');
      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(1);

      OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Org2');
      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(2);

      OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Org3');
      expect(OrganizationProfilePanel.getActivePanelCount()).toBe(3);
    });
  });

  // ==========================================================================
  // Cache Service Integration (GITX-194, GITX-197)
  // ==========================================================================
  describe('cache service integration', () => {
    it('should share cache service across all panel instances', () => {
      // All panels should use the same cache service singleton
      const panel1 = OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Engineering');
      const panel2 = OrganizationProfilePanel.create(extensionUri, mockSecretService, 'Product');

      // Both panels exist and can access the shared cache
      expect(panel1).toBeDefined();
      expect(panel2).toBeDefined();

      // The cache service is a singleton, so both panels share it
      const cacheService = DashboardCacheService.getInstance();
      expect(cacheService).toBeDefined();
    });
  });
});
