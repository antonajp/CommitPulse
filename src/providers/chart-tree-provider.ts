/**
 * Charts TreeView provider for the gitrx-charts view.
 * Displays available chart visualizations organized by category:
 * Overview, Productivity, Quality, Architecture, Traceability.
 *
 * Each chart item, when clicked, executes the corresponding VS Code command
 * to open the appropriate webview panel.
 *
 * Ticket: IQS-886
 */

import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import type {
  ChartDefinition,
  ChartCategory,
  ChartTreeNodeData,
} from './chart-tree-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ChartTreeProvider';

/**
 * Static catalog of all available charts.
 * Defines the chart type, label, category, command, and icon for each visualization.
 */
export const CHART_CATALOG: readonly ChartDefinition[] = [
  {
    type: 'allMetricsDashboard',
    label: 'All Metrics Dashboard',
    category: 'Overview',
    command: 'gitrx.openDashboard',
    description: 'Unified analytics dashboard',
    icon: 'dashboard',
  },
  {
    type: 'commitVelocity',
    label: 'Commit Velocity',
    category: 'Productivity',
    command: 'gitrx.openDashboard',
    description: 'Commits per day/week by repo',
    icon: 'pulse',
  },
  {
    type: 'teamScorecard',
    label: 'Team Scorecard',
    category: 'Productivity',
    command: 'gitrx.openDashboard',
    description: 'Weighted contributor scores',
    icon: 'people',
  },
  {
    type: 'fileComplexity',
    label: 'File Complexity',
    category: 'Quality',
    command: 'gitrx.openDashboard',
    description: 'Top files by complexity trends',
    icon: 'flame',
  },
  {
    type: 'techStack',
    label: 'Tech Stack',
    category: 'Quality',
    command: 'gitrx.openDashboard',
    description: 'Language distribution by category',
    icon: 'layers',
  },
  {
    type: 'locCommitted',
    label: 'LOC Committed',
    category: 'Productivity',
    command: 'gitrx.openDashboard',
    description: 'Code committed by component',
    icon: 'graph-scatter',
  },
  {
    type: 'commitIssueLinkage',
    label: 'Commit-Issue Linkage',
    category: 'Traceability',
    command: 'gitrx.openLinkageView',
    description: 'Commit-to-issue traceability',
    icon: 'link',
  },
  {
    type: 'sprintVelocityVsLoc',
    label: 'Sprint Velocity vs LOC',
    category: 'Productivity',
    command: 'gitrx.openSprintVelocityChart',
    description: 'Velocity vs code volume by week',
    icon: 'graph-line',
  },
  {
    type: 'topFilesByChurn',
    label: 'Top Files by Churn',
    category: 'Quality',
    command: 'gitrx.openDashboard',
    description: 'Files with most changes by team',
    icon: 'flame',
  },
  {
    type: 'developmentPipeline',
    label: 'Development Pipeline',
    category: 'Quality',
    command: 'gitrx.openDevPipeline',
    description: 'Commit-level quality metrics over time',
    icon: 'timeline-view-icon',
  },
  {
    type: 'releaseManagementContributions',
    label: 'Release Management Contributions',
    category: 'Productivity',
    command: 'gitrx.openReleaseMgmtChart',
    description: 'Release activity by team member',
    icon: 'git-merge',
  },
  {
    type: 'codeReviewVelocity',
    label: 'Code Review Velocity',
    category: 'Quality',
    command: 'gitrx.openCodeReviewVelocity',
    description: 'PR size vs time to merge scatter plot',
    icon: 'git-pull-request',
  },
  {
    type: 'hotSpots',
    label: 'Hot Spots',
    category: 'Quality',
    command: 'gitrx.openHotSpots',
    description: 'File churn vs complexity bubble chart',
    icon: 'flame',
  },
  {
    type: 'knowledgeConcentration',
    label: 'Knowledge Concentration',
    category: 'Team',
    command: 'gitrx.openKnowledgeConcentration',
    description: 'File ownership concentration treemap',
    icon: 'organization',
  },
  {
    type: 'ticketLifecycle',
    label: 'Ticket Lifecycle',
    category: 'Process',
    command: 'gitrx.openTicketLifecycle',
    description: 'Status transition Sankey diagram',
    icon: 'workflow',
  },
  {
    type: 'developerFocus',
    label: 'Developer Focus',
    category: 'Team',
    command: 'gitrx.openDeveloperFocus',
    description: 'Focus scores and context switching analysis',
    icon: 'eye',
  },
  {
    type: 'teamCoupling',
    label: 'Team Coupling',
    category: 'Architecture',
    command: 'gitrx.openTeamCoupling',
    description: 'Cross-team file coupling chord diagram',
    icon: 'link',
  },
  {
    type: 'releaseRisk',
    label: 'Release Risk',
    category: 'Quality',
    command: 'gitrx.openReleaseRisk',
    description: 'Release risk gauge with commit analysis',
    icon: 'warning',
  },
  {
    type: 'testDebt',
    label: 'Test Debt Predictor',
    category: 'Quality',
    command: 'gitrx.openTestDebt',
    description: 'Test coverage vs bug correlation ROI analysis',
    icon: 'beaker',
  },
  {
    type: 'commitHygiene',
    label: 'Commit Hygiene',
    category: 'Quality',
    command: 'gitrx.openCommitHygiene',
    description: 'Commit quality tracking with actionable insights',
    icon: 'checklist',
  },
  {
    type: 'architectureDrift',
    label: 'Architecture Drift',
    category: 'Architecture',
    command: 'gitrx.openArchitectureDrift',
    description: 'Component drift heat map with cross-component analysis',
    icon: 'symbol-structure',
  },
  {
    type: 'storyPointsTrend',
    label: 'Story Points Trend',
    category: 'Productivity',
    command: 'gitrx.openStoryPointsTrend',
    description: 'Development vs QA story points over time',
    icon: 'graph-line',
  },
  {
    type: 'fileContributionReport',
    label: 'File Contribution Report',
    category: 'Team',
    command: 'gitrx.openFileContributionReport',
    description: 'Analyze contributor ownership by file',
    icon: 'file-code',
  },
  {
    type: 'complexityTrend',
    label: 'Complexity Trend',
    category: 'Quality',
    command: 'gitrx.openComplexityTrend',
    description: 'Code complexity over time by contributor',
    icon: 'graph-line',
  },
] as const;

/**
 * Ordered list of categories for consistent TreeView display.
 * Note: Architecture category removed in IQS-893 (no charts remain after
 * Architecture Component LOC chart was removed as duplicate of LOC Committed).
 * Team category added in IQS-904 for knowledge/contributor charts.
 * Process category added in IQS-906 for workflow analysis charts.
 * Architecture category re-added in IQS-910 for team coupling analysis.
 */
const CATEGORY_ORDER: readonly ChartCategory[] = [
  'Overview',
  'Productivity',
  'Quality',
  'Team',
  'Process',
  'Architecture',
  'Traceability',
] as const;

/**
 * ThemeIcon identifiers used for category nodes.
 * Note: Architecture category removed in IQS-893, re-added in IQS-910.
 * Team category added in IQS-904.
 * Process category added in IQS-906.
 */
const CATEGORY_ICONS: Record<ChartCategory, string> = {
  Overview: 'layout',
  Productivity: 'rocket',
  Quality: 'verified',
  Team: 'organization',
  Process: 'workflow',
  Architecture: 'symbol-structure',
  Traceability: 'git-pull-request',
};

/**
 * ChartTreeItem extends vscode.TreeItem with typed node data.
 */
export class ChartTreeItem extends vscode.TreeItem {
  public readonly nodeData: ChartTreeNodeData;

  constructor(
    nodeData: ChartTreeNodeData,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(nodeData.label, collapsibleState);
    this.nodeData = nodeData;
    this.contextValue = nodeData.type;
    if (nodeData.description !== undefined) {
      this.description = nodeData.description;
    }
    if (nodeData.tooltip !== undefined) {
      this.tooltip = nodeData.tooltip;
    }
  }
}

/**
 * ChartTreeProvider implements vscode.TreeDataProvider<ChartTreeItem> for the
 * gitrx-charts TreeView. Displays available chart visualizations organized
 * by category.
 *
 * Root nodes: chart categories (Overview, Productivity, Quality, Architecture, Traceability).
 * Child nodes: individual chart items with click-to-open commands.
 *
 * Ticket: IQS-886
 */
export class ChartTreeProvider implements vscode.TreeDataProvider<ChartTreeItem>, vscode.Disposable {
  private readonly logger: LoggerService;

  /**
   * Event emitter that fires when the tree data changes.
   */
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ChartTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ChartTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor() {
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'ChartTreeProvider created');
  }

  /**
   * Signal the TreeView to refresh its contents.
   */
  refresh(): void {
    this.logger.info(CLASS_NAME, 'refresh', 'Refreshing Charts TreeView');
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get the TreeItem representation for a given element.
   */
  getTreeItem(element: ChartTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get child elements for a given parent, or root elements if parent is undefined.
   */
  getChildren(element?: ChartTreeItem): ChartTreeItem[] {
    this.logger.debug(
      CLASS_NAME,
      'getChildren',
      element ? `Getting children for category: ${element.nodeData.label}` : 'Getting root category nodes',
    );

    if (!element) {
      return this.getCategoryNodes();
    }

    if (element.nodeData.type === 'category' && element.nodeData.category) {
      return this.getChartNodes(element.nodeData.category);
    }

    return [];
  }

  /**
   * Build root-level category nodes.
   */
  private getCategoryNodes(): ChartTreeItem[] {
    const nodes: ChartTreeItem[] = [];

    for (const category of CATEGORY_ORDER) {
      const chartsInCategory = CHART_CATALOG.filter(c => c.category === category);
      if (chartsInCategory.length === 0) {
        continue;
      }

      const node = new ChartTreeItem(
        {
          type: 'category',
          label: category,
          category,
          description: `${chartsInCategory.length} chart${chartsInCategory.length === 1 ? '' : 's'}`,
          tooltip: `${category} charts (${chartsInCategory.length} available)`,
        },
        vscode.TreeItemCollapsibleState.Expanded,
      );
      node.iconPath = new vscode.ThemeIcon(CATEGORY_ICONS[category]);
      nodes.push(node);
    }

    this.logger.debug(CLASS_NAME, 'getCategoryNodes', `Returning ${nodes.length} category nodes`);
    return nodes;
  }

  /**
   * Build chart item nodes for a given category.
   */
  private getChartNodes(category: ChartCategory): ChartTreeItem[] {
    const charts = CHART_CATALOG.filter(c => c.category === category);
    const nodes: ChartTreeItem[] = [];

    for (const chart of charts) {
      const node = new ChartTreeItem(
        {
          type: 'chart',
          label: chart.label,
          description: chart.description,
          tooltip: `${chart.label}: ${chart.description}\nClick to open`,
          chartDefinition: chart,
        },
        vscode.TreeItemCollapsibleState.None,
      );
      node.iconPath = new vscode.ThemeIcon(chart.icon);
      node.command = {
        command: chart.command,
        title: chart.label,
      };
      nodes.push(node);
    }

    this.logger.debug(CLASS_NAME, 'getChartNodes', `Returning ${nodes.length} chart nodes for ${category}`);
    return nodes;
  }

  /**
   * Dispose resources held by this provider.
   */
  dispose(): void {
    this.logger.debug(CLASS_NAME, 'dispose', 'Disposing ChartTreeProvider');
    this._onDidChangeTreeData.dispose();
  }
}
