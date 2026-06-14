import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, TreeItemCollapsibleState } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  ContributorTreeProvider,
  ContributorTreeItem,
} from '../../providers/contributor-tree-provider.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { ContributorSummaryRow } from '../../providers/contributor-tree-types.js';

/**
 * Unit tests for ContributorTreeProvider (IQS-867).
 * Tests TreeView data provider for contributors organized by team.
 */
describe('ContributorTreeProvider', () => {
  let mockSecretService: SecretStorageService;

  beforeEach(() => {
    _clearMocks();
    try {
      LoggerService.getInstance().dispose();
    } catch {
      /* ignore */
    }
    LoggerService.resetInstance();

    // Create mock SecretStorageService - default: no password = empty tree
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
    try {
      LoggerService.getInstance().dispose();
    } catch {
      /* ignore */
    }
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    it('should create a ContributorTreeProvider instance', () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      expect(provider).toBeDefined();
      expect(provider.onDidChangeTreeData).toBeDefined();
      provider.dispose();
    });

    it('should default to grouped view mode', () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      expect(provider.getViewMode()).toBe('grouped');
      provider.dispose();
    });
  });

  // ==========================================================================
  // getChildren - Root nodes (no DB connection)
  // ==========================================================================

  describe('getChildren (root - no data)', () => {
    it('should return empty placeholder when database password is not set', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.nodeData.type).toBe('empty');
      expect(children[0]?.nodeData.label).toBe('No contributor data');
      expect(children[0]?.nodeData.description).toBe('Run pipeline to populate');
      expect(children[0]?.collapsibleState).toBe(TreeItemCollapsibleState.None);

      provider.dispose();
    });
  });

  // ==========================================================================
  // getChildren - With mocked data (inject via private cache)
  // ==========================================================================

  describe('getChildren (grouped mode - with data)', () => {
    const mockContributors: ContributorSummaryRow[] = [
      {
        fullName: 'Alice Smith',
        logins: 'alice,alice.smith',
        vendor: 'Company',
        team: 'Engineering',
        repoList: 'repo-a,repo-b',
        commitCount: 150,
      },
      {
        fullName: 'Bob Jones',
        logins: 'bob',
        vendor: 'Acme Corp',
        team: 'Engineering',
        repoList: 'repo-a',
        commitCount: 80,
      },
      {
        fullName: 'Charlie Brown',
        logins: 'charlie',
        vendor: 'Company',
        team: 'Data',
        repoList: 'repo-c',
        commitCount: 50,
      },
      {
        fullName: null,
        logins: 'dave',
        vendor: null,
        team: null,
        repoList: null,
        commitCount: 5,
      },
    ];

    /**
     * Helper to inject mock data into the provider's private cache.
     */
    function injectMockData(provider: ContributorTreeProvider): void {
      // Access private properties for testing
      const p = provider as unknown as {
        contributorCache: ContributorSummaryRow[];
        dataLoaded: boolean;
      };
      p.contributorCache = [...mockContributors];
      p.dataLoaded = true;
    }

    it('should return team nodes as root in grouped mode', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();

      // Expect 3 teams: Data, Engineering, (Unassigned) - sorted alphabetically with unassigned last
      expect(roots).toHaveLength(3);
      expect(roots[0]?.nodeData.label).toBe('Data');
      expect(roots[0]?.nodeData.type).toBe('team');
      expect(roots[0]?.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);

      expect(roots[1]?.nodeData.label).toBe('Engineering');
      expect(roots[1]?.nodeData.type).toBe('team');

      expect(roots[2]?.nodeData.label).toBe('(Unassigned)');
      expect(roots[2]?.nodeData.type).toBe('team');

      provider.dispose();
    });

    it('should show contributor count and commit count in team description', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();

      // Engineering has 2 contributors, 230 commits
      const engNode = roots.find((r) => r.nodeData.label === 'Engineering');
      expect(engNode?.nodeData.description).toContain('2 contributors');
      expect(engNode?.nodeData.description).toContain('230 commits');

      // Data has 1 contributor, 50 commits
      const dataNode = roots.find((r) => r.nodeData.label === 'Data');
      expect(dataNode?.nodeData.description).toContain('1 contributor');
      expect(dataNode?.nodeData.description).toContain('50 commits');

      provider.dispose();
    });

    it('should return contributor nodes as children of a team', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const engNode = roots.find((r) => r.nodeData.label === 'Engineering');
      expect(engNode).toBeDefined();

      const children = await provider.getChildren(engNode);

      // Engineering team has 2 contributors, sorted by commit count desc
      expect(children).toHaveLength(2);
      // GITX-169: contributorLogin now contains fullName or logins
      expect(children[0]?.nodeData.contributorLogin).toMatch(/Alice Smith|alice/); // 150 commits
      expect(children[1]?.nodeData.contributorLogin).toMatch(/Bob Jones|bob/); // 80 commits

      provider.dispose();
    });

    it('should show contributor details in contributor node', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const engNode = roots.find((r) => r.nodeData.label === 'Engineering');
      const children = await provider.getChildren(engNode);

      const aliceNode = children[0];
      // GITX-169: Label should now be "Alice Smith (@alice)" format
      expect(aliceNode?.nodeData.label).toContain('Alice Smith');
      expect(aliceNode?.nodeData.description).toContain('150 commits');
      expect(aliceNode?.nodeData.description).toContain('Engineering');
      // Vendor is in tooltip, not description
      expect(aliceNode?.nodeData.tooltip).toContain('Company');
      expect(aliceNode?.nodeData.type).toBe('contributor');
      expect(aliceNode?.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);

      provider.dispose();
    });

    it('should return detail leaf nodes for a contributor', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const engNode = roots.find((r) => r.nodeData.label === 'Engineering');
      const teamChildren = await provider.getChildren(engNode);
      const aliceNode = teamChildren[0];

      const details = await provider.getChildren(aliceNode);

      // Expect: Name, Vendor, Commits, Repositories
      expect(details.length).toBeGreaterThanOrEqual(4);
      const types = details.map((d) => d.nodeData.label);
      expect(types).toContain('Name');
      expect(types).toContain('Vendor');
      expect(types).toContain('Commits');
      expect(types).toContain('Repositories');

      // Each detail is a leaf
      for (const detail of details) {
        expect(detail.collapsibleState).toBe(TreeItemCollapsibleState.None);
        expect(detail.nodeData.type).toBe('detail');
      }

      provider.dispose();
    });

    it('should return empty array for detail leaf nodes', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const engNode = roots.find((r) => r.nodeData.label === 'Engineering');
      const teamChildren = await provider.getChildren(engNode);
      const aliceNode = teamChildren[0];
      const details = await provider.getChildren(aliceNode);

      // Detail nodes are leaves, should have no children
      const grandchildren = await provider.getChildren(details[0]);
      expect(grandchildren).toHaveLength(0);

      provider.dispose();
    });

    it('should handle unassigned team correctly', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const unassignedNode = roots.find((r) => r.nodeData.label === '(Unassigned)');
      expect(unassignedNode).toBeDefined();

      const children = await provider.getChildren(unassignedNode);
      expect(children).toHaveLength(1);
      // GITX-169: contributorLogin is now fullName or logins
      expect(children[0]?.nodeData.contributorLogin).toBe('dave');

      provider.dispose();
    });

    it('should omit Name detail when fullName is null', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const unassignedNode = roots.find((r) => r.nodeData.label === '(Unassigned)');
      const children = await provider.getChildren(unassignedNode);
      const daveNode = children[0];

      const details = await provider.getChildren(daveNode);
      const labels = details.map((d) => d.nodeData.label);
      expect(labels).not.toContain('Name');
      // Should still have Vendor, Commits
      expect(labels).toContain('Vendor');
      expect(labels).toContain('Commits');

      provider.dispose();
    });

    it('should omit Repositories detail when repoList is null', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const unassignedNode = roots.find((r) => r.nodeData.label === '(Unassigned)');
      const children = await provider.getChildren(unassignedNode);
      const daveNode = children[0];

      const details = await provider.getChildren(daveNode);
      const labels = details.map((d) => d.nodeData.label);
      expect(labels).not.toContain('Repositories');

      provider.dispose();
    });
  });

  // ==========================================================================
  // Flat mode
  // ==========================================================================

  describe('getChildren (flat mode)', () => {
    const mockContributors: ContributorSummaryRow[] = [
      {
        fullName: 'Bob Jones',
        logins: 'bob',
        vendor: 'Acme Corp',
        team: 'Engineering',
        repoList: 'repo-a',
        commitCount: 80,
      },
      {
        fullName: 'Alice Smith',
        logins: 'alice',
        vendor: 'Company',
        team: 'Data',
        repoList: 'repo-b',
        commitCount: 150,
      },
    ];

    function injectMockData(provider: ContributorTreeProvider): void {
      const p = provider as unknown as {
        contributorCache: ContributorSummaryRow[];
        dataLoaded: boolean;
      };
      p.contributorCache = [...mockContributors];
      p.dataLoaded = true;
    }

    it('should return contributor nodes alphabetically in flat mode', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);
      provider.toggleViewMode(); // Switch to flat

      const roots = await provider.getChildren();

      // GITX-169: Flat mode now sorts by fullName instead of login
      expect(roots).toHaveLength(2);
      expect(roots[0]?.nodeData.label).toContain('Alice Smith'); // A comes before B
      expect(roots[1]?.nodeData.label).toContain('Bob Jones');
      expect(roots[0]?.nodeData.type).toBe('contributor');

      provider.dispose();
    });

    it('should have contributor nodes as collapsible in flat mode', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);
      provider.toggleViewMode();

      const roots = await provider.getChildren();
      expect(roots[0]?.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);

      provider.dispose();
    });
  });

  // ==========================================================================
  // toggleViewMode
  // ==========================================================================

  describe('toggleViewMode', () => {
    it('should toggle from grouped to flat', () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      expect(provider.getViewMode()).toBe('grouped');

      const result = provider.toggleViewMode();
      expect(provider.getViewMode()).toBe('flat');
      expect(result).toBe('Flat List');

      provider.dispose();
    });

    it('should toggle from flat back to grouped', () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      provider.toggleViewMode(); // grouped -> flat
      const result = provider.toggleViewMode(); // flat -> grouped
      expect(provider.getViewMode()).toBe('grouped');
      expect(result).toBe('Group by Team');

      provider.dispose();
    });

    it('should fire onDidChangeTreeData event', () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      let eventFired = false;

      provider.onDidChangeTreeData(() => {
        eventFired = true;
      });

      provider.toggleViewMode();
      expect(eventFired).toBe(true);

      provider.dispose();
    });
  });

  // ==========================================================================
  // getTreeItem
  // ==========================================================================

  describe('getTreeItem', () => {
    it('should return the element as-is', () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      const item = new ContributorTreeItem(
        {
          type: 'team',
          label: 'Engineering',
          description: '5 contributors',
          teamName: 'Engineering',
        },
        TreeItemCollapsibleState.Collapsed,
      );

      const result = provider.getTreeItem(item);
      expect(result).toBe(item);

      provider.dispose();
    });
  });

  // ==========================================================================
  // refresh
  // ==========================================================================

  describe('refresh', () => {
    it('should fire onDidChangeTreeData event', () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      let eventFired = false;

      provider.onDidChangeTreeData(() => {
        eventFired = true;
      });

      provider.refresh();
      expect(eventFired).toBe(true);

      provider.dispose();
    });

    it('should clear data cache on refresh', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);

      // Load initial data (will be empty since no DB password)
      await provider.getChildren();

      // Refresh should clear cache and re-query
      provider.refresh();

      // Next getChildren call should attempt to load again
      await provider.getChildren();
      expect(mockSecretService.getDatabasePassword).toHaveBeenCalledTimes(2);

      provider.dispose();
    });
  });

  // ==========================================================================
  // dispose
  // ==========================================================================

  describe('dispose', () => {
    it('should dispose without errors', () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      expect(() => provider.dispose()).not.toThrow();
    });
  });

  // ==========================================================================
  // GITX-169: Contributor display format and grouping
  // ==========================================================================

  describe('GITX-169: Contributor display format', () => {
    const mockContributorsWithMultipleLogins: ContributorSummaryRow[] = [
      {
        fullName: 'Alice Smith',
        logins: 'alice,alice.smith',
        vendor: 'Company',
        team: 'Engineering',
        repoList: 'repo-a,repo-b',
        commitCount: 150,
      },
      {
        fullName: null,
        logins: 'bot-user',
        vendor: null,
        team: null,
        repoList: null,
        commitCount: 5,
      },
    ];

    function injectMockData(provider: ContributorTreeProvider): void {
      const p = provider as unknown as {
        contributorCache: ContributorSummaryRow[];
        dataLoaded: boolean;
      };
      p.contributorCache = [...mockContributorsWithMultipleLogins];
      p.dataLoaded = true;
    }

    it('should display "Full Name (@login)" when fullName exists', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const engNode = roots.find((r) => r.nodeData.label === 'Engineering');
      expect(engNode).toBeDefined();

      const children = await provider.getChildren(engNode);
      expect(children).toHaveLength(1);

      const aliceNode = children[0];
      // Format should be "Alice Smith (@alice)"
      expect(aliceNode?.nodeData.label).toContain('Alice Smith');
      expect(aliceNode?.nodeData.label).toMatch(/@alice/);

      provider.dispose();
    });

    it('should display login only when fullName is NULL', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const unassignedNode = roots.find((r) => r.nodeData.label === '(Unassigned)');
      expect(unassignedNode).toBeDefined();

      const children = await provider.getChildren(unassignedNode);
      expect(children).toHaveLength(1);

      const botNode = children[0];
      // When fullName is null, just show login
      expect(botNode?.nodeData.label).toBe('bot-user');
      expect(botNode?.nodeData.label).not.toContain('@');

      provider.dispose();
    });

    it('should show all logins in tooltip', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const engNode = roots.find((r) => r.nodeData.label === 'Engineering');
      const children = await provider.getChildren(engNode);

      const aliceNode = children[0];
      // Tooltip should include all logins
      expect(aliceNode?.nodeData.tooltip).toContain('alice');
      expect(aliceNode?.nodeData.tooltip).toContain('alice.smith');

      provider.dispose();
    });

    it('should sort by fullName in flat mode', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      const p = provider as unknown as {
        contributorCache: ContributorSummaryRow[];
        dataLoaded: boolean;
      };
      p.contributorCache = [
        {
          fullName: 'Zebra User',
          logins: 'zebra',
          vendor: 'Company',
          team: 'Engineering',
          repoList: 'repo-a',
          commitCount: 100,
        },
        {
          fullName: 'Alice Smith',
          logins: 'alice',
          vendor: 'Company',
          team: 'Engineering',
          repoList: 'repo-a',
          commitCount: 150,
        },
        {
          fullName: null,
          logins: 'aaa-bot',
          vendor: null,
          team: null,
          repoList: null,
          commitCount: 5,
        },
      ];
      p.dataLoaded = true;

      provider.toggleViewMode(); // Switch to flat

      const roots = await provider.getChildren();

      // Should be sorted: aaa-bot, Alice Smith, Zebra User
      expect(roots).toHaveLength(3);
      expect(roots[0]?.nodeData.label).toBe('aaa-bot');
      expect(roots[1]?.nodeData.label).toContain('Alice Smith');
      expect(roots[2]?.nodeData.label).toContain('Zebra User');

      provider.dispose();
    });

    it('should show Logins detail node with all associated logins', async () => {
      const provider = new ContributorTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const engNode = roots.find((r) => r.nodeData.label === 'Engineering');
      const children = await provider.getChildren(engNode);
      const aliceNode = children[0];

      const details = await provider.getChildren(aliceNode);

      // Should include a Logins detail node
      const loginsDetail = details.find((d) => d.nodeData.label === 'Logins');
      expect(loginsDetail).toBeDefined();
      // Description shows count when multiple logins
      expect(loginsDetail?.nodeData.description).toBe('2 logins');
      // Tooltip has the full list
      expect(loginsDetail?.nodeData.tooltip).toContain('alice');
      expect(loginsDetail?.nodeData.tooltip).toContain('alice.smith');

      provider.dispose();
    });
  });

  // ==========================================================================
  // ContributorTreeItem
  // ==========================================================================

  describe('ContributorTreeItem', () => {
    it('should set contextValue to the node type', () => {
      const item = new ContributorTreeItem(
        {
          type: 'team',
          label: 'Engineering',
          teamName: 'Engineering',
        },
        TreeItemCollapsibleState.Collapsed,
      );

      expect(item.contextValue).toBe('team');
      expect(item.nodeData.type).toBe('team');
    });

    it('should set description and tooltip from nodeData', () => {
      const item = new ContributorTreeItem(
        {
          type: 'detail',
          label: 'Commits',
          description: '100',
          tooltip: '100 total commits',
          contributorLogin: 'alice',
        },
        TreeItemCollapsibleState.None,
      );

      expect(item.description).toBe('100');
      expect(item.tooltip).toBe('100 total commits');
    });

    it('should not set description/tooltip when not provided', () => {
      const item = new ContributorTreeItem(
        {
          type: 'empty',
          label: 'No data',
        },
        TreeItemCollapsibleState.None,
      );

      expect(item.nodeData.description).toBeUndefined();
      expect(item.nodeData.tooltip).toBeUndefined();
    });

    it('should carry contributor data in nodeData', () => {
      const mockData: ContributorSummaryRow = {
        fullName: 'Test User',
        logins: 'test-user',
        vendor: 'TestCorp',
        team: 'QA',
        repoList: 'repo-1',
        commitCount: 42,
      };

      const item = new ContributorTreeItem(
        {
          type: 'contributor',
          label: 'test-user',
          contributorLogin: 'test-user',
          contributorData: mockData,
        },
        TreeItemCollapsibleState.Collapsed,
      );

      expect(item.nodeData.contributorData).toEqual(mockData);
      expect(item.nodeData.contributorLogin).toBe('test-user');
    });
  });
});
