import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, TreeItemCollapsibleState } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  PipelineRunTreeProvider,
  PipelineRunTreeItem,
} from '../../providers/pipeline-run-tree-provider.js';
import {
  calculateDuration,
  getStatusIcon,
  formatDateTime,
  getMsgLevelLabel,
} from '../../providers/pipeline-run-utils.js';
import type { SecretStorageService } from '../../config/secret-storage.js';
import type {
  PipelineRunRow,
  PipelineTableCountRow,
} from '../../providers/pipeline-run-tree-types.js';

/**
 * Unit tests for PipelineRunTreeProvider (IQS-868).
 * Tests TreeView data provider for pipeline run history with status,
 * duration, and table counts.
 */
describe('PipelineRunTreeProvider', () => {
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
    it('should create a PipelineRunTreeProvider instance', () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      expect(provider).toBeDefined();
      expect(provider.onDidChangeTreeData).toBeDefined();
      provider.dispose();
    });
  });

  // ==========================================================================
  // getChildren - Root nodes (no DB connection)
  // ==========================================================================

  describe('getChildren (root - no data)', () => {
    it('should return empty placeholder when database password is not set', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.nodeData.type).toBe('empty');
      expect(children[0]?.nodeData.label).toBe('No pipeline runs');
      expect(children[0]?.nodeData.description).toBe('Run pipeline to populate');
      expect(children[0]?.collapsibleState).toBe(TreeItemCollapsibleState.None);

      provider.dispose();
    });
  });

  // ==========================================================================
  // getChildren - With mocked data (inject via private cache)
  // ==========================================================================

  describe('getChildren (with data)', () => {
    const now = new Date('2026-03-05T10:00:00Z');
    const twoMinutesLater = new Date('2026-03-05T10:02:34Z');
    const fiveMinutesLater = new Date('2026-03-05T10:05:00Z');

    const mockRuns: PipelineRunRow[] = [
      {
        id: 100,
        className: 'PipelineService',
        context: 'runAll',
        detail: 'Full pipeline execution',
        status: 'success',
        startTime: now,
        endTime: twoMinutesLater,
      },
      {
        id: 99,
        className: 'PipelineService',
        context: 'runAll',
        detail: 'Pipeline with error',
        status: 'error',
        startTime: new Date('2026-03-04T09:00:00Z'),
        endTime: new Date('2026-03-04T09:01:00Z'),
      },
      {
        id: 98,
        className: 'PipelineService',
        context: 'runAll',
        detail: 'Currently running',
        status: 'running',
        startTime: fiveMinutesLater,
        endTime: null,
      },
    ];

    const mockTableCounts: PipelineTableCountRow[] = [
      { gitrTable: 'commit_history', rowCount: 5000, countDate: twoMinutesLater, pipelineId: 100 },
      { gitrTable: 'jira_detail', rowCount: 1200, countDate: twoMinutesLater, pipelineId: 100 },
    ];

    /**
     * Helper to inject mock data into the provider's private cache.
     */
    function injectMockData(provider: PipelineRunTreeProvider): void {
      const p = provider as unknown as {
        runCache: PipelineRunRow[];
        tableCountCache: Map<number, PipelineTableCountRow[]>;
        dataLoaded: boolean;
      };
      p.runCache = [...mockRuns];
      p.tableCountCache = new Map([[100, [...mockTableCounts]]]);
      p.dataLoaded = true;
    }

    it('should return pipeline run nodes as root nodes', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();

      expect(roots).toHaveLength(3);
      expect(roots[0]?.nodeData.type).toBe('pipelineRun');
      expect(roots[0]?.nodeData.label).toBe('Run #100');
      expect(roots[0]?.nodeData.pipelineRunId).toBe(100);
      expect(roots[0]?.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);

      expect(roots[1]?.nodeData.label).toBe('Run #99');
      expect(roots[2]?.nodeData.label).toBe('Run #98');

      provider.dispose();
    });

    it('should show duration in root node description', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();

      // Run #100: 2m 34s duration
      expect(roots[0]?.nodeData.description).toContain('2m 34s');

      // Run #98: still running
      expect(roots[2]?.nodeData.description).toContain('Still running');

      provider.dispose();
    });

    it('should have click command on run nodes', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const runNode = roots[0];

      expect(runNode?.command).toBeDefined();
      expect(runNode?.command?.command).toBe('gitrx.showPipelineRunLog');
      expect(runNode?.command?.arguments).toEqual([100]);

      provider.dispose();
    });

    it('should return child detail nodes for a pipeline run', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const runNode = roots[0]; // Run #100

      const children = await provider.getChildren(runNode);

      // Expect: Class, Start Time, End Time, Duration, Status, Table Counts
      expect(children.length).toBe(6);
      const labels = children.map((c) => c.nodeData.label);
      expect(labels).toContain('Class');
      expect(labels).toContain('Start Time');
      expect(labels).toContain('End Time');
      expect(labels).toContain('Duration');
      expect(labels).toContain('Status');
      expect(labels).toContain('Table Counts');

      provider.dispose();
    });

    it('should show correct detail values in child nodes', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const runNode = roots[0]; // Run #100
      const children = await provider.getChildren(runNode);

      // Class
      const classNode = children.find((c) => c.nodeData.label === 'Class');
      expect(classNode?.nodeData.description).toBe('PipelineService');
      expect(classNode?.nodeData.type).toBe('runDetail');
      expect(classNode?.collapsibleState).toBe(TreeItemCollapsibleState.None);

      // Duration
      const durationNode = children.find((c) => c.nodeData.label === 'Duration');
      expect(durationNode?.nodeData.description).toBe('2m 34s');

      // Status
      const statusNode = children.find((c) => c.nodeData.label === 'Status');
      expect(statusNode?.nodeData.description).toBe('success');

      provider.dispose();
    });

    it('should show Table Counts group as collapsible when counts exist', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const runNode = roots[0]; // Run #100 (has table counts)
      const children = await provider.getChildren(runNode);

      const tableGroupNode = children.find((c) => c.nodeData.label === 'Table Counts');
      expect(tableGroupNode?.nodeData.type).toBe('tableCountGroup');
      expect(tableGroupNode?.nodeData.description).toBe('2 tables');
      expect(tableGroupNode?.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);

      provider.dispose();
    });

    it('should show Table Counts group as non-collapsible when no counts', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const runNode = roots[1]; // Run #99 (no table counts)
      const children = await provider.getChildren(runNode);

      const tableGroupNode = children.find((c) => c.nodeData.label === 'Table Counts');
      expect(tableGroupNode?.nodeData.description).toBe('No table counts');
      expect(tableGroupNode?.collapsibleState).toBe(TreeItemCollapsibleState.None);

      provider.dispose();
    });

    it('should return table count grandchild nodes', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const runNode = roots[0]; // Run #100
      const children = await provider.getChildren(runNode);
      const tableGroupNode = children.find((c) => c.nodeData.label === 'Table Counts');

      const grandchildren = await provider.getChildren(tableGroupNode);

      expect(grandchildren).toHaveLength(2);
      expect(grandchildren[0]?.nodeData.label).toBe('commit_history');
      expect(grandchildren[0]?.nodeData.description).toBe('5,000');
      expect(grandchildren[0]?.nodeData.type).toBe('tableCount');
      expect(grandchildren[0]?.collapsibleState).toBe(TreeItemCollapsibleState.None);

      expect(grandchildren[1]?.nodeData.label).toBe('jira_detail');
      expect(grandchildren[1]?.nodeData.description).toBe('1,200');

      provider.dispose();
    });

    it('should return empty array for leaf nodes', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const runNode = roots[0];
      const children = await provider.getChildren(runNode);

      // runDetail nodes are leaves
      const classNode = children.find((c) => c.nodeData.label === 'Class');
      const leafChildren = await provider.getChildren(classNode);
      expect(leafChildren).toHaveLength(0);

      provider.dispose();
    });

    it('should handle null endTime as "Still running"', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      injectMockData(provider);

      const roots = await provider.getChildren();
      const runningNode = roots[2]; // Run #98, status=running, endTime=null
      const children = await provider.getChildren(runningNode);

      const endTimeNode = children.find((c) => c.nodeData.label === 'End Time');
      expect(endTimeNode?.nodeData.description).toBe('Still running');

      const durationNode = children.find((c) => c.nodeData.label === 'Duration');
      expect(durationNode?.nodeData.description).toBe('Still running');

      provider.dispose();
    });

    it('should handle null className gracefully', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      const runWithNulls: PipelineRunRow = {
        id: 50,
        className: null,
        context: null,
        detail: null,
        status: null,
        startTime: null,
        endTime: null,
      };
      const p = provider as unknown as {
        runCache: PipelineRunRow[];
        tableCountCache: Map<number, PipelineTableCountRow[]>;
        dataLoaded: boolean;
      };
      p.runCache = [runWithNulls];
      p.tableCountCache = new Map();
      p.dataLoaded = true;

      const roots = await provider.getChildren();
      expect(roots).toHaveLength(1);
      expect(roots[0]?.nodeData.label).toBe('Run #50');

      const children = await provider.getChildren(roots[0]);
      const classNode = children.find((c) => c.nodeData.label === 'Class');
      expect(classNode?.nodeData.description).toBe('N/A');

      provider.dispose();
    });
  });

  // ==========================================================================
  // getTreeItem
  // ==========================================================================

  describe('getTreeItem', () => {
    it('should return the element as-is', () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);
      const item = new PipelineRunTreeItem(
        {
          type: 'pipelineRun',
          label: 'Run #1',
          description: 'test',
          pipelineRunId: 1,
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
      const provider = new PipelineRunTreeProvider(mockSecretService);
      let eventFired = false;

      provider.onDidChangeTreeData(() => {
        eventFired = true;
      });

      provider.refresh();
      expect(eventFired).toBe(true);

      provider.dispose();
    });

    it('should clear data cache on refresh', async () => {
      const provider = new PipelineRunTreeProvider(mockSecretService);

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
      const provider = new PipelineRunTreeProvider(mockSecretService);
      expect(() => provider.dispose()).not.toThrow();
    });
  });

  // ==========================================================================
  // PipelineRunTreeItem
  // ==========================================================================

  describe('PipelineRunTreeItem', () => {
    it('should set contextValue to the node type', () => {
      const item = new PipelineRunTreeItem(
        {
          type: 'pipelineRun',
          label: 'Run #1',
          pipelineRunId: 1,
        },
        TreeItemCollapsibleState.Collapsed,
      );

      expect(item.contextValue).toBe('pipelineRun');
      expect(item.nodeData.type).toBe('pipelineRun');
    });

    it('should set description and tooltip from nodeData', () => {
      const item = new PipelineRunTreeItem(
        {
          type: 'runDetail',
          label: 'Duration',
          description: '5m 30s',
          tooltip: 'Duration: 5m 30s',
          pipelineRunId: 1,
        },
        TreeItemCollapsibleState.None,
      );

      expect(item.description).toBe('5m 30s');
      expect(item.tooltip).toBe('Duration: 5m 30s');
    });

    it('should not set description/tooltip when not provided', () => {
      const item = new PipelineRunTreeItem(
        {
          type: 'empty',
          label: 'No data',
        },
        TreeItemCollapsibleState.None,
      );

      expect(item.nodeData.description).toBeUndefined();
      expect(item.nodeData.tooltip).toBeUndefined();
    });

    it('should carry pipeline run data in nodeData', () => {
      const mockRun: PipelineRunRow = {
        id: 42,
        className: 'TestClass',
        context: 'testContext',
        detail: 'testDetail',
        status: 'success',
        startTime: new Date('2026-03-05T10:00:00Z'),
        endTime: new Date('2026-03-05T10:05:00Z'),
      };

      const item = new PipelineRunTreeItem(
        {
          type: 'pipelineRun',
          label: 'Run #42',
          pipelineRunId: 42,
          runData: mockRun,
        },
        TreeItemCollapsibleState.Collapsed,
      );

      expect(item.nodeData.runData).toEqual(mockRun);
      expect(item.nodeData.pipelineRunId).toBe(42);
    });
  });

  // ==========================================================================
  // Static utility methods
  // ==========================================================================

  describe('static methods', () => {
    describe('calculateDuration', () => {
      it('should calculate hours, minutes, seconds correctly', () => {
        const start = new Date('2026-03-05T10:00:00Z');
        const end = new Date('2026-03-05T11:05:12Z');
        expect(calculateDuration(start, end)).toBe('1h 5m 12s');
      });

      it('should calculate minutes and seconds when under 1 hour', () => {
        const start = new Date('2026-03-05T10:00:00Z');
        const end = new Date('2026-03-05T10:02:34Z');
        expect(calculateDuration(start, end)).toBe('2m 34s');
      });

      it('should calculate seconds only when under 1 minute', () => {
        const start = new Date('2026-03-05T10:00:00Z');
        const end = new Date('2026-03-05T10:00:45Z');
        expect(calculateDuration(start, end)).toBe('45s');
      });

      it('should return "Still running" when endTime is null', () => {
        const start = new Date('2026-03-05T10:00:00Z');
        expect(calculateDuration(start, null)).toBe('Still running');
      });

      it('should return "N/A" when startTime is null', () => {
        expect(calculateDuration(null, null)).toBe('N/A');
      });

      it('should return "0s" for zero duration', () => {
        const same = new Date('2026-03-05T10:00:00Z');
        expect(calculateDuration(same, same)).toBe('0s');
      });

      it('should return "Invalid" for negative duration', () => {
        const start = new Date('2026-03-05T10:05:00Z');
        const end = new Date('2026-03-05T10:00:00Z');
        expect(calculateDuration(start, end)).toBe('Invalid');
      });
    });

    describe('getStatusIcon', () => {
      it('should return success icon for "success"', () => {
        const icon = getStatusIcon('success');
        expect(icon.id).toBe('check');
      });

      it('should return success icon for "completed"', () => {
        const icon = getStatusIcon('completed');
        expect(icon.id).toBe('check');
      });

      it('should return error icon for "error"', () => {
        const icon = getStatusIcon('error');
        expect(icon.id).toBe('error');
      });

      it('should return error icon for "failed"', () => {
        const icon = getStatusIcon('failed');
        expect(icon.id).toBe('error');
      });

      it('should return running icon for "running"', () => {
        const icon = getStatusIcon('running');
        expect(icon.id).toBe('sync~spin');
      });

      it('should return running icon for "started"', () => {
        const icon = getStatusIcon('started');
        expect(icon.id).toBe('sync~spin');
      });

      it('should return unknown icon for unrecognized status', () => {
        const icon = getStatusIcon('unknown_status');
        expect(icon.id).toBe('question');
      });

      it('should handle case-insensitive status', () => {
        const icon = getStatusIcon('SUCCESS');
        expect(icon.id).toBe('check');
      });

      it('should handle status with whitespace', () => {
        const icon = getStatusIcon('  error  ');
        expect(icon.id).toBe('error');
      });
    });

    describe('formatDateTime', () => {
      it('should format a date correctly', () => {
        const date = new Date('2026-03-05T10:15:00Z');
        const formatted = formatDateTime(date);
        // The exact output depends on locale, but should contain the date parts
        expect(formatted).toBeTruthy();
        expect(typeof formatted).toBe('string');
      });
    });

    describe('getMsgLevelLabel', () => {
      it('should return TRACE for level 0', () => {
        expect(getMsgLevelLabel(0)).toBe('TRACE');
      });

      it('should return DEBUG for level 1', () => {
        expect(getMsgLevelLabel(1)).toBe('DEBUG');
      });

      it('should return INFO for level 2', () => {
        expect(getMsgLevelLabel(2)).toBe('INFO');
      });

      it('should return WARN for level 3', () => {
        expect(getMsgLevelLabel(3)).toBe('WARN');
      });

      it('should return ERROR for level 4', () => {
        expect(getMsgLevelLabel(4)).toBe('ERROR');
      });

      it('should return CRITICAL for level 5', () => {
        expect(getMsgLevelLabel(5)).toBe('CRITICAL');
      });

      it('should return LEVEL-N for unknown levels', () => {
        expect(getMsgLevelLabel(99)).toBe('LEVEL-99');
      });
    });
  });
});
