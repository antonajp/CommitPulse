import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, TreeItemCollapsibleState } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { ChartTreeProvider, ChartTreeItem, CHART_CATALOG } from '../../providers/chart-tree-provider.js';

/**
 * Unit tests for ChartTreeProvider (IQS-886).
 * Tests TreeView data provider for chart catalog.
 */
describe('ChartTreeProvider', () => {
  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('constructor', () => {
    it('should create a ChartTreeProvider instance', () => {
      const provider = new ChartTreeProvider();
      expect(provider).toBeDefined();
      expect(provider.onDidChangeTreeData).toBeDefined();
      provider.dispose();
    });
  });

  describe('CHART_CATALOG', () => {
    it('should contain expected chart entries', () => {
      // Note: architectureComponentLoc removed in IQS-893
      expect(CHART_CATALOG.length).toBeGreaterThanOrEqual(7);

      const types = CHART_CATALOG.map(c => c.type);
      expect(types).toContain('allMetricsDashboard');
      expect(types).toContain('commitVelocity');
      expect(types).toContain('teamScorecard');
      expect(types).toContain('fileComplexity');
      expect(types).toContain('techStack');
      expect(types).toContain('locCommitted');
      expect(types).toContain('commitIssueLinkage');
      expect(types).toContain('sprintVelocityVsLoc');
    });

    it('should map sprint velocity chart to correct command', () => {
      const velocityChart = CHART_CATALOG.find(c => c.type === 'sprintVelocityVsLoc');
      expect(velocityChart?.command).toBe('gitrx.openSprintVelocityChart');
      expect(velocityChart?.category).toBe('Productivity');
      expect(velocityChart?.icon).toBe('graph-line');
    });

    it('should have valid categories for all charts', () => {
      // Note: Architecture category removed in IQS-893, re-added in IQS-910.
      // Team category added in IQS-904, Process category added in IQS-906.
      const validCategories = ['Overview', 'Productivity', 'Quality', 'Team', 'Process', 'Architecture', 'Traceability'];
      for (const chart of CHART_CATALOG) {
        expect(validCategories).toContain(chart.category);
      }
    });

    it('should have commands for all charts', () => {
      for (const chart of CHART_CATALOG) {
        expect(chart.command).toBeTruthy();
        expect(typeof chart.command).toBe('string');
      }
    });
  });

  describe('getChildren (root nodes)', () => {
    it('should return category nodes at root level', () => {
      const provider = new ChartTreeProvider();
      const children = provider.getChildren();

      // Should have 7 categories (Architecture re-added in IQS-910, Team added in IQS-904, Process added in IQS-906)
      expect(children.length).toBe(7);

      const labels = children.map(c => c.nodeData.label);
      expect(labels).toContain('Overview');
      expect(labels).toContain('Productivity');
      expect(labels).toContain('Quality');
      expect(labels).toContain('Team');
      expect(labels).toContain('Process');
      expect(labels).toContain('Architecture');
      expect(labels).toContain('Traceability');

      // Categories should be expanded by default
      for (const child of children) {
        expect(child.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
        expect(child.nodeData.type).toBe('category');
      }

      provider.dispose();
    });
  });

  describe('getChildren (chart nodes)', () => {
    // Note: Architecture category tests removed in IQS-893

    it('should return Sprint Velocity chart in Productivity category', () => {
      const provider = new ChartTreeProvider();
      const categories = provider.getChildren();
      const productivityCategory = categories.find(c => c.nodeData.label === 'Productivity');
      expect(productivityCategory).toBeDefined();

      const charts = provider.getChildren(productivityCategory);
      expect(charts.length).toBeGreaterThanOrEqual(3);

      const velocityChart = charts.find(c => c.nodeData.label === 'Sprint Velocity vs LOC');
      expect(velocityChart).toBeDefined();
      expect(velocityChart?.nodeData.type).toBe('chart');
      expect(velocityChart?.command?.command).toBe('gitrx.openSprintVelocityChart');

      provider.dispose();
    });

    it('should return chart items for Overview category', () => {
      const provider = new ChartTreeProvider();
      const categories = provider.getChildren();
      const overviewCategory = categories.find(c => c.nodeData.label === 'Overview');

      const charts = provider.getChildren(overviewCategory);
      expect(charts.length).toBeGreaterThanOrEqual(1);

      const dashboardChart = charts.find(c => c.nodeData.label === 'All Metrics Dashboard');
      expect(dashboardChart).toBeDefined();
      expect(dashboardChart?.command?.command).toBe('gitrx.openDashboard');

      provider.dispose();
    });

    it('should return empty array for leaf chart nodes', () => {
      const provider = new ChartTreeProvider();
      const chartNode = new ChartTreeItem(
        {
          type: 'chart',
          label: 'Test Chart',
        },
        TreeItemCollapsibleState.None,
      );
      const children = provider.getChildren(chartNode);
      expect(children).toHaveLength(0);

      provider.dispose();
    });
  });

  describe('getTreeItem', () => {
    it('should return the same element', () => {
      const provider = new ChartTreeProvider();
      const item = new ChartTreeItem(
        { type: 'category', label: 'Test', category: 'Overview' },
        TreeItemCollapsibleState.Expanded,
      );
      expect(provider.getTreeItem(item)).toBe(item);
      provider.dispose();
    });
  });

  describe('refresh', () => {
    it('should fire onDidChangeTreeData event', () => {
      const provider = new ChartTreeProvider();
      const handler = vi.fn();
      provider.onDidChangeTreeData(handler);

      provider.refresh();

      expect(handler).toHaveBeenCalledTimes(1);
      provider.dispose();
    });
  });

  describe('ChartTreeItem', () => {
    it('should set contextValue from node type', () => {
      const item = new ChartTreeItem(
        { type: 'category', label: 'Test Category', category: 'Overview' },
        TreeItemCollapsibleState.Expanded,
      );
      expect(item.contextValue).toBe('category');
    });

    it('should set description and tooltip when provided', () => {
      const item = new ChartTreeItem(
        {
          type: 'chart',
          label: 'Test Chart',
          description: 'A test chart',
          tooltip: 'Tooltip text',
        },
        TreeItemCollapsibleState.None,
      );
      expect(item.description).toBe('A test chart');
      expect(item.tooltip).toBe('Tooltip text');
    });
  });
});
