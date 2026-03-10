/**
 * TypeScript interfaces for pipeline-related database data shapes.
 *
 * Maps column-by-column from the legacy Python PostgresDB.py
 * insert_gitr_pipeline_start(), insert_gitr_pipeline_log(),
 * update_gitr_pipeline_run(), and log_table_counts() methods.
 * Covers gitr_pipeline_run, gitr_pipeline_log, gitr_pipeline_sha,
 * gitr_pipeline_jira, and gitja_pipeline_table_counts tables.
 *
 * Ticket: IQS-853
 */

// ============================================================================
// gitr_pipeline_run table
// ============================================================================

/**
 * Row shape for inserting a pipeline run start record.
 * Maps from PostgresDB.py insert_gitr_pipeline_start().
 */
export interface PipelineRunStart {
  readonly className: string;
  readonly context: string;
  readonly detail: string;
  readonly status: string;
}

// ============================================================================
// gitr_pipeline_log table
// ============================================================================

/**
 * Row shape for inserting a pipeline log entry.
 * Maps from PostgresDB.py insert_gitr_pipeline_log().
 */
export interface PipelineLogEntry {
  readonly parentId: number;
  readonly className: string;
  readonly context: string;
  readonly detail: string;
  readonly msgLevel: number;
}

// ============================================================================
// gitja_pipeline_table_counts table
// ============================================================================

/**
 * Row shape for inserting pipeline table count snapshots.
 * Maps from PostgresDB.py log_table_counts().
 */
export interface PipelineTableCount {
  readonly gitrTable: string;
  readonly rowCount: number;
  readonly countDate: Date;
  readonly pipelineId: number;
}
