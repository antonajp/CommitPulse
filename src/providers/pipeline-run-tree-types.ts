/**
 * TypeScript interfaces for the Pipeline Runs TreeView data shapes.
 *
 * Defines the data model for pipeline run history displayed in the
 * gitrx-pipeline-runs TreeView sidebar. Sourced from gitr_pipeline_run,
 * gitr_pipeline_log, and gitja_pipeline_table_counts database tables.
 *
 * Ticket: IQS-868
 */

// ============================================================================
// Database result types for TreeView queries
// ============================================================================

/**
 * Row shape returned by the recent pipeline runs query.
 * One row per gitr_pipeline_run record, sorted by start_time DESC.
 */
export interface PipelineRunRow {
  /** Pipeline run ID (primary key). */
  readonly id: number;
  /** Class name that initiated the pipeline run. */
  readonly className: string | null;
  /** Run context description. */
  readonly context: string | null;
  /** Run detail text. */
  readonly detail: string | null;
  /** Run status: e.g., 'running', 'success', 'error'. */
  readonly status: string | null;
  /** Pipeline start timestamp. */
  readonly startTime: Date | null;
  /** Pipeline end timestamp, null if still running. */
  readonly endTime: Date | null;
}

/**
 * Row shape returned by the pipeline log entries query.
 * One row per gitr_pipeline_log record for a given pipeline run.
 */
export interface PipelineLogRow {
  /** Log entry ID. */
  readonly id: number;
  /** Parent pipeline run ID. */
  readonly parentId: number;
  /** Class name that generated the log entry. */
  readonly className: string | null;
  /** Log context. */
  readonly context: string | null;
  /** Log detail message. */
  readonly detail: string | null;
  /** Message severity level (numeric). */
  readonly msgLevel: number;
  /** Log entry timestamp. */
  readonly transactionDate: Date | null;
}

/**
 * Row shape returned by the pipeline table counts query.
 * One row per gitja_pipeline_table_counts record for a given pipeline run.
 */
export interface PipelineTableCountRow {
  /** Table or view name. */
  readonly gitrTable: string;
  /** Row count at snapshot time. */
  readonly rowCount: number;
  /** When the count was taken. */
  readonly countDate: Date | null;
  /** Associated pipeline run ID. */
  readonly pipelineId: number;
}

// ============================================================================
// TreeView node types
// ============================================================================

/**
 * Discriminated union for Pipeline Runs TreeView node types.
 * Used by PipelineRunTreeProvider to differentiate root, child, and leaf nodes.
 *
 * - 'pipelineRun': Root node representing a single pipeline run
 * - 'runDetail': Child node showing a run attribute (class_name, times, status)
 * - 'tableCountGroup': Child node acting as a collapsible group for table counts
 * - 'tableCount': Grandchild leaf node showing a single table's row count
 * - 'empty': Placeholder node when no data is available
 */
export type PipelineRunTreeNodeType =
  | 'pipelineRun'
  | 'runDetail'
  | 'tableCountGroup'
  | 'tableCount'
  | 'empty';

/**
 * Data model for a single node in the Pipeline Runs TreeView.
 * Carried by PipelineRunTreeItem for rendering and child resolution.
 */
export interface PipelineRunTreeNodeData {
  /** The type of this tree node for discrimination. */
  readonly type: PipelineRunTreeNodeType;
  /** Display label for this node. */
  readonly label: string;
  /** Optional description shown alongside the label. */
  readonly description?: string;
  /** Optional tooltip shown on hover with full details. */
  readonly tooltip?: string;
  /** Pipeline run ID this node belongs to (for all node types except empty). */
  readonly pipelineRunId?: number;
  /** Full pipeline run data (for pipelineRun nodes). */
  readonly runData?: PipelineRunRow;
}

/**
 * Maximum number of recent pipeline runs to display in the TreeView.
 */
export const MAX_RECENT_RUNS = 20;
