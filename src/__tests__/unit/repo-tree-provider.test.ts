import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, _setMockConfig, TreeItemCollapsibleState } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { RepoTreeProvider, RepoTreeItem } from '../../providers/repo-tree-provider.js';
import type { SecretStorageService } from '../../config/secret-storage.js';

/**
 * Unit tests for RepoTreeProvider (IQS-866).
 * Tests TreeView data provider for configured repositories.
 */
describe('RepoTreeProvider', () => {
  let mockSecretService: SecretStorageService;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Create mock SecretStorageService
    mockSecretService = {
      getDatabasePassword: vi.fn().mockResolvedValue(undefined),
      getJiraToken: vi.fn().mockResolvedValue(undefined),
      getGitHubToken: vi.fn().mockResolvedValue(undefined),
      promptAndStore: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    } as unknown as SecretStorageService;
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('constructor', () => {
    it('should create a RepoTreeProvider instance', () => {
      const provider = new RepoTreeProvider(mockSecretService);
      expect(provider).toBeDefined();
      expect(provider.onDidChangeTreeData).toBeDefined();
      provider.dispose();
    });
  });

  describe('getChildren (root nodes)', () => {
    it('should return info node when no repositories are configured', async () => {
      // No repositories configured (empty default)
      const provider = new RepoTreeProvider(mockSecretService);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.nodeData.label).toBe('No repositories configured');
      expect(children[0]?.nodeData.type).toBe('repository');
      expect(children[0]?.collapsibleState).toBe(TreeItemCollapsibleState.None);

      provider.dispose();
    });

    it('should return root nodes for configured repositories', async () => {
      // Configure repositories in mock settings
      _setMockConfig('gitrx.repositories', [
        { path: '/repos/app1', name: 'App One', organization: 'Engineering' },
        { path: '/repos/app2', name: 'App Two', organization: '' },
      ]);

      const provider = new RepoTreeProvider(mockSecretService);
      const children = await provider.getChildren();

      expect(children).toHaveLength(2);
      expect(children[0]?.nodeData.label).toBe('App One');
      expect(children[0]?.nodeData.type).toBe('repository');
      expect(children[0]?.nodeData.repository).toBe('App One');
      expect(children[0]?.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(children[1]?.nodeData.label).toBe('App Two');

      provider.dispose();
    });

    it('should show "No sync data" description when DB password is not set', async () => {
      _setMockConfig('gitrx.repositories', [
        { path: '/repos/app1', name: 'TestRepo', organization: '' },
      ]);

      const provider = new RepoTreeProvider(mockSecretService);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.nodeData.description).toBe('[Jira] No sync data');

      provider.dispose();
    });

    it('should show [Linear] badge for linear tracker type (IQS-876)', async () => {
      _setMockConfig('gitrx.repositories', [
        { path: '/repos/app1', name: 'LinearRepo', organization: '', trackerType: 'linear' },
      ]);

      const provider = new RepoTreeProvider(mockSecretService);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.nodeData.description).toBe('[Linear] No sync data');

      provider.dispose();
    });

    it('should show [No Tracker] badge for none tracker type (IQS-876)', async () => {
      _setMockConfig('gitrx.repositories', [
        { path: '/repos/app1', name: 'NoneRepo', organization: '', trackerType: 'none' },
      ]);

      const provider = new RepoTreeProvider(mockSecretService);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.nodeData.description).toBe('[No Tracker] No sync data');

      provider.dispose();
    });
  });

  describe('getChildren (child nodes)', () => {
    it('should return "No data available" node when stats are not loaded', async () => {
      _setMockConfig('gitrx.repositories', [
        { path: '/repos/app1', name: 'MyRepo', organization: '' },
      ]);

      const provider = new RepoTreeProvider(mockSecretService);

      // Get root nodes first
      const roots = await provider.getChildren();
      expect(roots).toHaveLength(1);

      // Get children of the first root node
      const children = await provider.getChildren(roots[0]);

      expect(children).toHaveLength(1);
      expect(children[0]?.nodeData.label).toBe('No data available');
      expect(children[0]?.nodeData.description).toBe('Run pipeline to sync');

      provider.dispose();
    });

    it('should return empty array for leaf nodes', async () => {
      _setMockConfig('gitrx.repositories', [
        { path: '/repos/app1', name: 'MyRepo', organization: '' },
      ]);

      const provider = new RepoTreeProvider(mockSecretService);
      const roots = await provider.getChildren();
      const children = await provider.getChildren(roots[0]);

      // The "No data available" node is a leaf
      const grandchildren = await provider.getChildren(children[0]);
      expect(grandchildren).toHaveLength(0);

      provider.dispose();
    });
  });

  describe('getTreeItem', () => {
    it('should return the element as-is', () => {
      const provider = new RepoTreeProvider(mockSecretService);
      const item = new RepoTreeItem(
        {
          type: 'repository',
          repository: 'test-repo',
          label: 'Test Repo',
          description: '42 commits',
        },
        TreeItemCollapsibleState.Collapsed,
      );

      const result = provider.getTreeItem(item);
      expect(result).toBe(item);

      provider.dispose();
    });
  });

  describe('refresh', () => {
    it('should fire onDidChangeTreeData event', () => {
      const provider = new RepoTreeProvider(mockSecretService);
      let eventFired = false;

      provider.onDidChangeTreeData(() => {
        eventFired = true;
      });

      provider.refresh();
      expect(eventFired).toBe(true);

      provider.dispose();
    });

    it('should clear stats cache on refresh', async () => {
      _setMockConfig('gitrx.repositories', [
        { path: '/repos/app1', name: 'MyRepo', organization: '' },
      ]);

      const provider = new RepoTreeProvider(mockSecretService);

      // Load initial data
      await provider.getChildren();

      // Refresh should clear cache
      provider.refresh();

      // Next getChildren call should re-load stats
      const roots = await provider.getChildren();
      expect(roots).toHaveLength(1);
      // getDatabasePassword was called again (second time after refresh)
      expect(mockSecretService.getDatabasePassword).toHaveBeenCalledTimes(2);

      provider.dispose();
    });
  });

  describe('dispose', () => {
    it('should dispose without errors', () => {
      const provider = new RepoTreeProvider(mockSecretService);
      expect(() => provider.dispose()).not.toThrow();
    });
  });

  describe('RepoTreeItem', () => {
    it('should set contextValue to the node type', () => {
      const item = new RepoTreeItem(
        {
          type: 'repository',
          repository: 'test',
          label: 'Test',
        },
        TreeItemCollapsibleState.Collapsed,
      );

      expect(item.contextValue).toBe('repository');
      expect(item.nodeData.type).toBe('repository');
    });

    it('should set description and tooltip from nodeData', () => {
      const item = new RepoTreeItem(
        {
          type: 'totalCommits',
          repository: 'test',
          label: 'Total Commits',
          description: '100',
          tooltip: '100 commits in test',
        },
        TreeItemCollapsibleState.None,
      );

      expect(item.description).toBe('100');
      expect(item.tooltip).toBe('100 commits in test');
    });

    it('should not set description/tooltip when not provided', () => {
      const item = new RepoTreeItem(
        {
          type: 'branches',
          repository: 'test',
          label: 'Branches',
        },
        TreeItemCollapsibleState.None,
      );

      // description and tooltip should be undefined (not set)
      expect(item.nodeData.description).toBeUndefined();
      expect(item.nodeData.tooltip).toBeUndefined();
    });
  });
});
