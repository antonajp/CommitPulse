/**
 * Type definitions for the PipelineService orchestrator.
 *
 * Defines configuration, step results, and overall pipeline run results
 * used by PipelineService to coordinate the full analytics pipeline.
 *
 * Ticket: IQS-864
 */

import type { AnalysisRunResult } from './git-analysis-types.js';
import type { GitHubSyncResult } from './github-service-types.js';
import type { IncrementalLoadResult } from './jira-incremental-loader.js';
import type { LinearIncrementalLoadResult } from './linear-incremental-loader.js';
import type { DataEnhancerResult } from './data-enhancer-service.js';
import type { TeamAssignmentResult } from './team-assignment-service.js';

// ============================================================================
// Pipeline step definitions
// ============================================================================

/**
 * Identifiers for each pipeline step.
 * Used for configuring which steps to run and for progress reporting.
 */
export type PipelineStepId =
  | 'gitCommitExtraction'
  | 'githubContributorSync'
  | 'jiraIssueLoading'
  | 'jiraChangelogUpdate'
  | 'commitJiraLinking'
  | 'linearIssueLoading'
  | 'linearChangelogUpdate'
  | 'commitLinearLinking'
  | 'teamAssignment';

/**
 * All available pipeline step IDs, in execution order.
 */
export const ALL_PIPELINE_STEPS: readonly PipelineStepId[] = [
  'gitCommitExtraction',
  'githubContributorSync',
  'jiraIssueLoading',
  'jiraChangelogUpdate',
  'commitJiraLinking',
  'linearIssueLoading',
  'linearChangelogUpdate',
  'commitLinearLinking',
  'teamAssignment',
] as const;

/**
 * Human-readable labels for each pipeline step.
 * Used in VS Code progress notifications.
 */
export const PIPELINE_STEP_LABELS: Readonly<Record<PipelineStepId, string>> = {
  gitCommitExtraction: 'Git Commit Extraction',
  githubContributorSync: 'GitHub Contributor Sync',
  jiraIssueLoading: 'Jira Issue Loading',
  jiraChangelogUpdate: 'Jira Changelog/Unfinished Update',
  commitJiraLinking: 'Commit-Jira Linking',
  linearIssueLoading: 'Linear Issue Loading',
  linearChangelogUpdate: 'Linear Changelog/Unfinished Update',
  commitLinearLinking: 'Commit-Linear Linking',
  teamAssignment: 'Team Assignment Calculation',
};

// ============================================================================
// Pipeline configuration
// ============================================================================

/**
 * Configuration for a pipeline run.
 * Composed from VS Code settings at command invocation time.
 */
export interface PipelineConfig {
  /**
   * Which pipeline steps to execute.
   * Defaults to ALL_PIPELINE_STEPS if empty or not specified.
   */
  readonly steps: readonly PipelineStepId[];

  /**
   * Jira incremental load increment (issues beyond current max per project).
   * From gitrx.jira.increment setting.
   */
  readonly jiraIncrement: number;

  /**
   * Days to look back for unfinished Jira issue refresh.
   * From gitrx.jira.daysAgo setting.
   */
  readonly jiraDaysAgo: number;

  /**
   * Additional Jira project keys from gitrx.jira.projectKeys setting.
   */
  readonly jiraAdditionalProjects: readonly string[];

  /**
   * Jira key aliases from gitrx.jira.keyAliases setting.
   */
  readonly jiraKeyAliases: Readonly<Record<string, string>>;

  /**
   * Linear team keys from gitrx.linear.teamKeys setting.
   * Used for commit-Linear linking step.
   */
  readonly linearTeamKeys: readonly string[];

  /**
   * Global cutoff date for git commit extraction (ISO YYYY-MM-DD).
   * Commits before this date are ignored. Per-repo startDate takes precedence.
   * From gitrx.pipeline.sinceDate setting.
   * Ticket: IQS-931
   */
  readonly sinceDate?: string;

  /**
   * Force full extraction mode, ignoring database watermarks.
   * When true, extracts entire repository history regardless of existing data.
   * When false/undefined, uses auto-incremental mode (GITX-1 watermarks).
   * Ticket: GITX-123
   */
  readonly forceFullExtraction?: boolean;
}

// ============================================================================
// Step results
// ============================================================================

/**
 * Status of an individual pipeline step.
 */
export type PipelineStepStatus = 'SUCCESS' | 'ERROR' | 'SKIPPED';

/**
 * Result of a single pipeline step execution.
 */
export interface PipelineStepResult {
  /** Step identifier. */
  readonly stepId: PipelineStepId;
  /** Step display label. */
  readonly label: string;
  /** Step execution status. */
  readonly status: PipelineStepStatus;
  /** Duration in milliseconds. */
  readonly durationMs: number;
  /** Summary message for logging. */
  readonly summary: string;
  /** Error message if status is ERROR. */
  readonly error?: string;
}

// ============================================================================
// Overall pipeline result
// ============================================================================

/**
 * Overall status of the pipeline run.
 */
export type PipelineRunStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

/**
 * Complete result of a pipeline run.
 */
export interface PipelineRunResult {
  /** Pipeline run ID from gitr_pipeline_run table. */
  readonly pipelineRunId: number;
  /** Overall pipeline status. */
  readonly status: PipelineRunStatus;
  /** Results for each step that was executed. */
  readonly stepResults: readonly PipelineStepResult[];
  /** Total duration in milliseconds. */
  readonly totalDurationMs: number;
  /** Table counts logged at end of run. */
  readonly tableCounts: Readonly<Record<string, number>>;

  // Detailed results from each step (null if step was not run)
  /** Git analysis results. */
  readonly gitAnalysisResult: AnalysisRunResult | null;
  /** GitHub sync results. */
  readonly githubSyncResult: GitHubSyncResult | null;
  /** Jira incremental load results. */
  readonly jiraLoadResult: IncrementalLoadResult | null;
  /** Linear incremental load results. Ticket: IQS-876. */
  readonly linearLoadResult: LinearIncrementalLoadResult | null;
  /** Data enhancer results (commit-Jira or commit-Linear linking). */
  readonly dataEnhancerResult: DataEnhancerResult | null;
  /** Team assignment results. */
  readonly teamAssignmentResult: TeamAssignmentResult | null;
}

