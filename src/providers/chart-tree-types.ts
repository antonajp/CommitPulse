/**
 * TypeScript interfaces for the Charts TreeView data shapes.
 *
 * Defines the data model for chart items displayed in the gitrx-charts
 * TreeView sidebar. Charts are organized by category (Overview, Productivity,
 * Quality, Architecture, Traceability).
 *
 * Ticket: IQS-886
 */

/**
 * Chart type identifiers matching available visualizations.
 * Note: 'architectureComponentLoc' removed in IQS-893 (duplicate of LOC Committed).
 * 'ticketLifecycle' added in IQS-906 for status transition Sankey diagram.
 * 'teamCoupling' added in IQS-910 for cross-team coupling chord diagram.
 * 'architectureDrift' added in IQS-918 for architecture drift heat map.
 */
export type ChartType =
  | 'allMetricsDashboard'
  | 'commitVelocity'
  | 'teamScorecard'
  | 'fileComplexity'
  | 'techStack'
  | 'locCommitted'
  | 'commitIssueLinkage'
  | 'sprintVelocityVsLoc'
  | 'topFilesByChurn'
  | 'developmentPipeline'
  | 'releaseManagementContributions'
  | 'codeReviewVelocity'
  | 'hotSpots'
  | 'knowledgeConcentration'
  | 'ticketLifecycle'
  | 'developerFocus'
  | 'teamCoupling'
  | 'releaseRisk'
  | 'testDebt'
  | 'commitHygiene'
  | 'architectureDrift'
  | 'storyPointsTrend';

/**
 * Chart category for grouping in the TreeView.
 * Note: 'Architecture' category removed in IQS-893 (no charts remain).
 * 'Team' category added in IQS-904 for knowledge/contributor charts.
 * 'Process' category added in IQS-906 for workflow analysis charts.
 * 'Architecture' category re-added in IQS-910 for team coupling analysis.
 */
export type ChartCategory =
  | 'Overview'
  | 'Productivity'
  | 'Quality'
  | 'Team'
  | 'Process'
  | 'Architecture'
  | 'Traceability';

/**
 * Definition for a single chart entry in the catalog.
 */
export interface ChartDefinition {
  /** Unique chart type identifier. */
  readonly type: ChartType;
  /** Display label in the TreeView. */
  readonly label: string;
  /** Category for grouping. */
  readonly category: ChartCategory;
  /** VS Code command to execute when clicked. */
  readonly command: string;
  /** Description shown alongside the label. */
  readonly description: string;
  /** Codicon ID for the TreeView icon. */
  readonly icon: string;
}

/**
 * Discriminated union for TreeView node types.
 * Used by ChartTreeProvider to differentiate category headers and chart items.
 */
export type ChartTreeNodeType = 'category' | 'chart';

/**
 * Data model for a single node in the Charts TreeView.
 */
export interface ChartTreeNodeData {
  /** The type of this tree node. */
  readonly type: ChartTreeNodeType;
  /** Display label for this node. */
  readonly label: string;
  /** Optional description shown alongside the label. */
  readonly description?: string;
  /** Optional tooltip shown on hover. */
  readonly tooltip?: string;
  /** The chart definition (only for chart nodes). */
  readonly chartDefinition?: ChartDefinition;
  /** The category name (only for category nodes). */
  readonly category?: ChartCategory;
}
