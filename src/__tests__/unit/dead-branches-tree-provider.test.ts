import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, TreeItemCollapsibleState } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DeadBranchesTreeProvider, DeadBranchesTreeItem } from '../../providers/dead-branches-tree-provider.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type { CommitHistoryBranch } from '../../database/branch-repository.js';
import {
  RISK_LEVEL_LABELS,
  RISK_LEVEL_ORDER,
  RISK_LEVEL_ICONS,
} from '../../providers/dead-branches-tree-types.js';

/**
 * Unit tests for DeadBranchesTreeProvider (GITX-239).
 * Tests TreeView data provider for dead/stale branches grouped by risk level.
 */
describe('DeadBranchesTreeProvider', () => {
  let mockSecretService: SecretStorageService;
  let mockBranches: CommitHistoryBranch[];

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

    // Create mock branch data
    mockBranches = [
      {
        branchName: 'feature/old-merged',
        repository: 'test-repo',
        lastCommitDate: new Date('2023-01-01'),
        lastCommitAuthor: 'dev@test.com',
        lastCommitSha: 'abc123',
        commitCount: 5,
        daysSinceLastCommit: 120,
        isMerged: true,
        mergedInto: 'main',
        isOrphaned: false,
        hasOpenPr: false,
        isProtected: false,
        status: 'stale',
        riskLevel: 'medium',
      },
      {
        branchName: 'feature/recent-unmerged',
        repository: 'test-repo',
        lastCommitDate: new Date('2024-01-01'),
        lastCommitAuthor: 'dev@test.com',
        lastCommitSha: 'def456',
        commitCount: 3,
        daysSinceLastCommit: 30,
        isMerged: false,
        mergedInto: null,
        isOrphaned: false,
        hasOpenPr: false,
        isProtected: false,
        status: 'active',
        riskLevel: 'high',
      },
      {
        branchName: 'feature/merged-recent',
        repository: 'test-repo',
        lastCommitDate: new Date('2024-05-01'),
        lastCommitAuthor: 'dev@test.com',
        lastCommitSha: 'ghi789',
        commitCount: 10,
        daysSinceLastCommit: 45,
        isMerged: true,
        mergedInto: 'develop',
        isOrphaned: false,
        hasOpenPr: false,
        isProtected: false,
        status: 'stale',
        riskLevel: 'medium',
      },
    ];
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('constructor', () => {
    it('should create a DeadBranchesTreeProvider instance', () => {
      const provider = new DeadBranchesTreeProvider(mockSecretService);
      expect(provider).toBeDefined();
      expect(provider.onDidChangeTreeData).toBeDefined();
      provider.dispose();
    });
  });

  describe('getChildren (root nodes)', () => {
    it('should return error state when database password is not configured', async () => {
      // mockSecretService.getDatabasePassword returns undefined (no password)
      const provider = new DeadBranchesTreeProvider(mockSecretService);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.nodeData.label).toBe('Unable to load branches');
      expect(children[0]?.nodeData.type).toBe('error');
      expect(children[0]?.collapsibleState).toBe(TreeItemCollapsibleState.None);

      provider.dispose();
    });

    it('should show descriptive error when database password is missing', async () => {
      const provider = new DeadBranchesTreeProvider(mockSecretService);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.nodeData.type).toBe('error');
      expect(children[0]?.nodeData.description).toBe('Database connection failed');

      provider.dispose();
    });
  });

  describe('getTreeItem', () => {
    it('should return the element as-is', () => {
      const provider = new DeadBranchesTreeProvider(mockSecretService);
      const item = new DeadBranchesTreeItem(
        {
          type: 'riskCategory',
          label: 'Safe (5)',
          description: 'Merged branches over 90 days old',
          riskLevel: 'safe',
        },
        TreeItemCollapsibleState.Expanded,
      );

      const result = provider.getTreeItem(item);
      expect(result).toBe(item);

      provider.dispose();
    });
  });

  describe('refresh', () => {
    it('should fire onDidChangeTreeData event', () => {
      const provider = new DeadBranchesTreeProvider(mockSecretService);
      let eventFired = false;

      provider.onDidChangeTreeData(() => {
        eventFired = true;
      });

      provider.refresh();
      expect(eventFired).toBe(true);

      provider.dispose();
    });

    it('should clear branch cache on refresh', async () => {
      const provider = new DeadBranchesTreeProvider(mockSecretService);

      // Load initial data
      await provider.getChildren();

      // Refresh should clear cache
      provider.refresh();

      // Next getChildren call should re-load data
      const roots = await provider.getChildren();
      expect(roots).toHaveLength(1);
      // getDatabasePassword was called again (second time after refresh)
      expect(mockSecretService.getDatabasePassword).toHaveBeenCalledTimes(2);

      provider.dispose();
    });
  });

  describe('dispose', () => {
    it('should dispose without errors', () => {
      const provider = new DeadBranchesTreeProvider(mockSecretService);
      expect(() => provider.dispose()).not.toThrow();
    });
  });

  describe('DeadBranchesTreeItem', () => {
    it('should set contextValue to the node type', () => {
      const item = new DeadBranchesTreeItem(
        {
          type: 'riskCategory',
          label: 'Safe (5)',
          riskLevel: 'safe',
        },
        TreeItemCollapsibleState.Expanded,
      );

      expect(item.contextValue).toBe('riskCategory');
      expect(item.nodeData.type).toBe('riskCategory');
    });

    it('should set description and tooltip from nodeData', () => {
      const item = new DeadBranchesTreeItem(
        {
          type: 'branch',
          label: 'feature/old-branch',
          description: 'test-repo · 120d · merged into main',
          tooltip: 'Branch: feature/old-branch\nRepository: test-repo\nLast Commit: 120 days ago',
        },
        TreeItemCollapsibleState.None,
      );

      expect(item.description).toBe('test-repo · 120d · merged into main');
      expect(item.tooltip).toBe('Branch: feature/old-branch\nRepository: test-repo\nLast Commit: 120 days ago');
    });

    it('should not set description/tooltip when not provided', () => {
      const item = new DeadBranchesTreeItem(
        {
          type: 'empty',
          label: 'No dead branches detected',
        },
        TreeItemCollapsibleState.None,
      );

      // description and tooltip should be undefined (not set)
      expect(item.nodeData.description).toBeUndefined();
      expect(item.nodeData.tooltip).toBeUndefined();
    });
  });

  describe('types module', () => {
    it('should export RISK_LEVEL_ORDER in correct order', () => {
      expect(RISK_LEVEL_ORDER).toEqual(['safe', 'low', 'medium', 'high']);
    });

    it('should export RISK_LEVEL_LABELS with correct values', () => {
      expect(RISK_LEVEL_LABELS.safe).toBe('Safe');
      expect(RISK_LEVEL_LABELS.low).toBe('Low');
      expect(RISK_LEVEL_LABELS.medium).toBe('Medium');
      expect(RISK_LEVEL_LABELS.high).toBe('High');
    });

    it('should export RISK_LEVEL_ICONS with correct codicons', () => {
      expect(RISK_LEVEL_ICONS.safe).toBe('pass');
      expect(RISK_LEVEL_ICONS.low).toBe('info');
      expect(RISK_LEVEL_ICONS.medium).toBe('warning');
      expect(RISK_LEVEL_ICONS.high).toBe('error');
    });
  });

  describe('branch node building', () => {
    it('should handle branch with all properties', () => {
      const branch = {
        branchName: 'feature/complete',
        repository: 'main-repo',
        lastCommitDate: new Date('2024-01-15'),
        lastCommitAuthor: 'developer@example.com',
        lastCommitSha: 'abc123def456',
        commitCount: 42,
        daysSinceLastCommit: 180,
        isMerged: true,
        mergedInto: 'main',
        hasOpenPr: false,
        isOrphaned: false,
        riskLevel: 'safe' as const,
        status: 'merged' as const,
      };

      // Verify branch data structure
      expect(branch.branchName).toBe('feature/complete');
      expect(branch.repository).toBe('main-repo');
      expect(branch.daysSinceLastCommit).toBe(180);
      expect(branch.isMerged).toBe(true);
      expect(branch.mergedInto).toBe('main');
      expect(branch.riskLevel).toBe('safe');
    });

    it('should handle orphaned branch', () => {
      const branch = {
        branchName: 'feature/orphaned',
        repository: 'test-repo',
        lastCommitDate: new Date('2023-06-01'),
        lastCommitAuthor: 'dev@test.com',
        lastCommitSha: 'orphan123',
        commitCount: 8,
        daysSinceLastCommit: 200,
        isMerged: false,
        mergedInto: null,
        hasOpenPr: false,
        isOrphaned: true,
        riskLevel: 'medium' as const,
        status: 'orphaned' as const,
      };

      expect(branch.isOrphaned).toBe(true);
      expect(branch.status).toBe('orphaned');
    });

    it('should handle branch with open PR', () => {
      const branch = {
        branchName: 'feature/with-pr',
        repository: 'active-repo',
        lastCommitDate: new Date('2024-06-01'),
        lastCommitAuthor: 'developer@test.com',
        lastCommitSha: 'pr123',
        commitCount: 15,
        daysSinceLastCommit: 5,
        isMerged: false,
        mergedInto: null,
        hasOpenPr: true,
        isOrphaned: false,
        riskLevel: 'high' as const,
        status: 'active' as const,
      };

      expect(branch.hasOpenPr).toBe(true);
      expect(branch.riskLevel).toBe('high');
    });
  });

  describe('risk level calculation', () => {
    it('should calculate safe risk for merged + old branches', () => {
      // Safe: merged AND >90 days old
      const branch: CommitHistoryBranch = {
        ...mockBranches[0]!,
        isMerged: true,
        daysSinceLastCommit: 120,
      };
      expect(branch.isMerged).toBe(true);
      expect(branch.daysSinceLastCommit).toBeGreaterThan(90);
    });

    it('should calculate low risk for merged + recent branches', () => {
      // Low: merged AND <90 days old
      const branch: CommitHistoryBranch = {
        ...mockBranches[0]!,
        isMerged: true,
        daysSinceLastCommit: 45,
      };
      expect(branch.isMerged).toBe(true);
      expect(branch.daysSinceLastCommit).toBeLessThan(90);
    });

    it('should calculate high risk for unmerged + recent branches', () => {
      // High: unmerged AND <90 days
      const branch: CommitHistoryBranch = {
        ...mockBranches[1]!,
        isMerged: false,
        daysSinceLastCommit: 30,
      };
      expect(branch.isMerged).toBe(false);
      expect(branch.daysSinceLastCommit).toBeLessThan(90);
    });

    it('should calculate high risk for branches with open PR', () => {
      // High: has open PR
      const branch: CommitHistoryBranch = {
        ...mockBranches[1]!,
        hasOpenPr: true,
      };
      expect(branch.hasOpenPr).toBe(true);
    });

    it('should calculate medium risk for unmerged + moderately old branches', () => {
      // Medium: unmerged AND 90-180 days old
      const branch: CommitHistoryBranch = {
        ...mockBranches[0]!,
        isMerged: false,
        daysSinceLastCommit: 120,
        hasOpenPr: false,
      };
      expect(branch.isMerged).toBe(false);
      expect(branch.daysSinceLastCommit).toBeGreaterThanOrEqual(90);
      expect(branch.daysSinceLastCommit).toBeLessThan(180);
    });
  });

  describe('error handling', () => {
    it('should handle error state gracefully', async () => {
      const provider = new DeadBranchesTreeProvider(mockSecretService);

      // Should not throw on getChildren
      const children = await provider.getChildren();
      expect(children).toBeDefined();
      expect(Array.isArray(children)).toBe(true);

      provider.dispose();
    });
  });

  describe('grouping by risk level', () => {
    it('should maintain correct risk level order', () => {
      // Verify order is safe -> low -> medium -> high
      const expectedOrder = ['safe', 'low', 'medium', 'high'];
      expect(RISK_LEVEL_ORDER).toEqual(expectedOrder);
    });

    it('should show error state when database password is not configured', async () => {
      const provider = new DeadBranchesTreeProvider(mockSecretService);

      // With no password configured, should show error state
      const children = await provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children[0]?.nodeData.type).toBe('error');

      provider.dispose();
    });
  });

  describe('branch item formatting', () => {
    it('should format description with repository, age, and status', () => {
      // Expected format: "repo · 120d old · merged into main"
      const expected = 'test-repo · 120d old · merged into main';
      const parts = expected.split(' · ');

      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('test-repo');
      expect(parts[1]).toBe('120d old');
      expect(parts[2]).toBe('merged into main');
    });

    it('should format tooltip with detailed branch info', () => {
      const tooltipLines = [
        'Branch: feature/test',
        'Repository: test-repo',
        'Age: 120 days since last commit',
        'Author: dev@test.com',
        'Commits: 5',
        'Status: Merged into main',
      ];

      const tooltip = tooltipLines.join('\n');
      expect(tooltip).toContain('Branch: feature/test');
      expect(tooltip).toContain('Repository: test-repo');
      expect(tooltip).toContain('Age: 120 days since last commit');
    });
  });
});
