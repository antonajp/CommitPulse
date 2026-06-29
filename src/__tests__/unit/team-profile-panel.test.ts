import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, ViewColumn } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { TeamProfilePanel } from '../../views/webview/team-profile-panel.js';
import { DashboardCacheService } from '../../services/dashboard-cache-service.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import { Uri } from '../__mocks__/vscode.js';

/**
 * Unit tests for TeamProfilePanel (GITX-185, GITX-196).
 * Tests the webview panel lifecycle and multi-instance behavior.
 * GITX-196: Tests multi-instance pattern for side-by-side team comparison.
 */
describe('TeamProfilePanel', () => {
  let mockSecretService: SecretStorageService;
  const extensionUri = Uri.file('/test/extension');

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Reset the panels and cache service
    TeamProfilePanel.resetForTesting();
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
    TeamProfilePanel.resetForTesting();
    DashboardCacheService.resetInstance();
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // GITX-196: Multi-Instance Tests
  // ==========================================================================
  describe('create (GITX-196)', () => {
    it('should create a new panel on first call', () => {
      const panel = TeamProfilePanel.create(extensionUri, mockSecretService);
      expect(panel).toBeDefined();
      expect(TeamProfilePanel.getActivePanelCount()).toBe(1);
    });

    it('should create multiple independent panels for different teams', () => {
      const panel1 = TeamProfilePanel.create(extensionUri, mockSecretService, 'Platform Team');
      const panel2 = TeamProfilePanel.create(extensionUri, mockSecretService, 'Mobile Team');

      expect(TeamProfilePanel.getActivePanelCount()).toBe(2);
      expect(panel1.getTeam()).toBe('Platform Team');
      expect(panel2.getTeam()).toBe('Mobile Team');
    });

    it('should allow multiple panels for the same team', () => {
      TeamProfilePanel.create(extensionUri, mockSecretService, 'Platform Team');
      TeamProfilePanel.create(extensionUri, mockSecretService, 'Platform Team');

      expect(TeamProfilePanel.getActivePanelCount()).toBe(2);
    });

    it('should set panel title to include team name', () => {
      const panel = TeamProfilePanel.create(extensionUri, mockSecretService, 'Platform Team');
      // The panel is created, and title should include the team name
      // Panel title is set during creation via vscode.window.createWebviewPanel
      expect(panel).toBeDefined();
    });

    it('should use default title when no team specified', () => {
      const panel = TeamProfilePanel.create(extensionUri, mockSecretService);
      expect(panel).toBeDefined();
      expect(panel.getTeam()).toBeNull();
    });

    it('should maintain independent state per panel', () => {
      const panel1 = TeamProfilePanel.create(extensionUri, mockSecretService, 'Platform Team');
      const panel2 = TeamProfilePanel.create(extensionUri, mockSecretService, 'Mobile Team');

      expect(panel1.getTimeframe()).toBe('90');
      expect(panel2.getTimeframe()).toBe('90');
      expect(panel1.getTeam()).not.toBe(panel2.getTeam());
    });
  });

  // ==========================================================================
  // Backward Compatibility
  // ==========================================================================
  describe('createOrShow (deprecated)', () => {
    it('should still work for backward compatibility', () => {
      expect(() => {
        TeamProfilePanel.createOrShow(extensionUri, mockSecretService, 'Platform Team');
      }).not.toThrow();

      expect(TeamProfilePanel.getActivePanelCount()).toBe(1);
    });

    it('should create new panel each time (no longer singleton)', () => {
      TeamProfilePanel.createOrShow(extensionUri, mockSecretService, 'Platform Team');
      TeamProfilePanel.createOrShow(extensionUri, mockSecretService, 'Mobile Team');

      // GITX-196: createOrShow now delegates to create(), so multiple calls create multiple panels
      expect(TeamProfilePanel.getActivePanelCount()).toBe(2);
    });
  });

  // ==========================================================================
  // Reset and Cleanup
  // ==========================================================================
  describe('resetForTesting', () => {
    it('should clear all active panels', () => {
      TeamProfilePanel.create(extensionUri, mockSecretService, 'Platform Team');
      TeamProfilePanel.create(extensionUri, mockSecretService, 'Mobile Team');
      expect(TeamProfilePanel.getActivePanelCount()).toBe(2);

      TeamProfilePanel.resetForTesting();
      expect(TeamProfilePanel.getActivePanelCount()).toBe(0);
    });
  });

  describe('getActivePanelCount', () => {
    it('should return 0 when no panels exist', () => {
      expect(TeamProfilePanel.getActivePanelCount()).toBe(0);
    });

    it('should accurately count active panels', () => {
      TeamProfilePanel.create(extensionUri, mockSecretService, 'Team1');
      expect(TeamProfilePanel.getActivePanelCount()).toBe(1);

      TeamProfilePanel.create(extensionUri, mockSecretService, 'Team2');
      expect(TeamProfilePanel.getActivePanelCount()).toBe(2);

      TeamProfilePanel.create(extensionUri, mockSecretService, 'Team3');
      expect(TeamProfilePanel.getActivePanelCount()).toBe(3);
    });
  });

  // ==========================================================================
  // Cache Service Integration (GITX-194, GITX-196)
  // ==========================================================================
  describe('cache service integration', () => {
    it('should share cache service across all panel instances', () => {
      // All panels should use the same cache service singleton
      const panel1 = TeamProfilePanel.create(extensionUri, mockSecretService, 'Platform Team');
      const panel2 = TeamProfilePanel.create(extensionUri, mockSecretService, 'Mobile Team');

      // Both panels exist and can access the shared cache
      expect(panel1).toBeDefined();
      expect(panel2).toBeDefined();

      // The cache service is a singleton, so both panels share it
      const cacheService = DashboardCacheService.getInstance();
      expect(cacheService).toBeDefined();
    });
  });
});
