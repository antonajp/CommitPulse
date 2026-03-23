/**
 * TypeScript interfaces for the GitAnalysisService.
 *
 * Defines data shapes for commit extraction results, branch info,
 * tag mappings, and processing options. These types bridge between
 * the simple-git library output and the CommitRepository insert shapes.
 *
 * Maps from Python GitCommitHistorySql.py data structures.
 *
 * Ticket: IQS-854
 */

// ============================================================================
// Processing options
// ============================================================================

/**
 * Options for a git analysis run.
 * Controls date filtering, branch selection, and incremental behavior.
 */
export interface GitAnalysisOptions {
  /** Start date for commit filtering (ISO format YYYY-MM-DD). Undefined = all history. */
  readonly sinceDate?: string;
  /** End date for commit filtering (ISO format YYYY-MM-DD). Undefined = now. */
  readonly untilDate?: string;
  /**
   * Enable verbose debug logging for Git extraction operations.
   * When enabled, logs detailed info about repository init, branch discovery,
   * tag extraction, commit processing, and file diffs.
   * Ticket: IQS-936
   */
  readonly debugLogging?: boolean;
  /**
   * Force full extraction mode, ignoring database watermarks.
   * When true, extracts entire repository history regardless of existing data.
   * When false/undefined, uses auto-incremental mode (GITX-1 watermarks).
   * Ticket: GITX-123
   */
  readonly forceFullExtraction?: boolean;
  /**
   * Skip SCC metrics during extraction for faster incremental updates.
   * When true, commit_files rows are inserted with zero metrics (for later backfill).
   * When false/undefined, runs SCC for each new commit (standard behavior).
   * Ticket: GITX-131 Phase 2
   */
  readonly skipScc?: boolean;
  /**
   * Use optimized git log --all extraction instead of per-branch iteration.
   * When true, uses a single git log query with branch relationship detection.
   * When false/undefined, uses standard branch iteration (backward compatible).
   * Ticket: GITX-131 Phase 3
   */
  readonly useGitLogAll?: boolean;
}

/**
 * Options for fast/optimized extraction mode.
 * Ticket: GITX-131
 */
export interface FastExtractionOptions extends GitAnalysisOptions {
  /** Use git log --all instead of per-branch iteration */
  readonly useGitLogAll?: boolean;
  /** Collect performance metrics */
  readonly collectMetrics?: boolean;
}

/**
 * Extraction mode for git analysis operations.
 * Used by Quick Pick UI to let users choose between incremental and full extraction.
 * Ticket: GITX-123
 */
export type ExtractionMode = 'incremental' | 'full';

/**
 * Fast extraction mode for optimized incremental extraction.
 * - 'fast': Skip SCC metrics, use git log --all --since, rely on backfill
 * - 'incremental': Standard watermark-based extraction (current default)
 * - 'full': Complete history extraction
 * Ticket: GITX-131
 */
export type FastExtractionMode = 'fast' | 'incremental' | 'full';

/**
 * Quick Pick item for extraction mode selection.
 * Includes label, description, detail, and the mode value.
 * Ticket: GITX-123
 */
export interface ExtractionModeQuickPickItem {
  /** Display label with icon (e.g., "$(sync) Incremental Extraction") */
  readonly label: string;
  /** Short description shown next to label */
  readonly description: string;
  /** Detailed explanation shown below */
  readonly detail: string;
  /** The extraction mode value */
  readonly mode: ExtractionMode;
}

// ============================================================================
// Repository context
// ============================================================================

/**
 * Context for a single repository being processed.
 * Combines config with runtime state like the repo name and URL.
 */
export interface RepoContext {
  /** Absolute path to the Git repository. */
  readonly path: string;
  /** Display name for this repository (from settings). */
  readonly name: string;
  /** Organization or team that owns this repository (from settings). */
  readonly organization: string;
  /** Derived repository URL (e.g., https://github.com/org/repo.git). */
  readonly repositoryUrl: string;
}

// ============================================================================
// Commit extraction results
// ============================================================================

/**
 * Raw commit data extracted from simple-git log.
 * This is the intermediate shape before transformation into CommitHistoryRow.
 *
 * Maps from Python commit object fields accessed in get_branch_details().
 */
export interface ExtractedCommit {
  /** Full 40-character commit SHA. */
  readonly sha: string;
  /** Commit author name. */
  readonly author: string;
  /** Commit author email. */
  readonly authorEmail: string;
  /** Commit date as ISO string. */
  readonly date: string;
  /** Cleaned commit message (newlines/carriage returns removed). */
  readonly message: string;
  /** Branch this commit was found on. */
  readonly branch: string;
  /** Number of files changed in this commit. */
  readonly fileCount: number;
  /** Total lines added. */
  readonly linesAdded: number;
  /** Total lines removed. */
  readonly linesRemoved: number;
  /** Whether this is a merge commit (detected via regex). */
  readonly isMerge: boolean;
  /** Diff file details for this commit. */
  readonly files: readonly ExtractedFileDiff[];
}

/**
 * File-level diff data from a single commit.
 * Maps from Python commit.stats.files items.
 */
export interface ExtractedFileDiff {
  /** File path relative to repo root. */
  readonly filePath: string;
  /** File extension including dot (e.g., ".ts"). */
  readonly fileExtension: string;
  /** Lines inserted in this file. */
  readonly insertions: number;
  /** Lines deleted in this file. */
  readonly deletions: number;
  /** Net line change (insertions - deletions). */
  readonly delta: number;
  /** Parent directory (first path segment, or "root"). */
  readonly parentDirectory: string;
  /** Sub-directory (second path segment, or ""). */
  readonly subDirectory: string;
  /** Whether this file is a test file. */
  readonly isTestFile: boolean;
}

// ============================================================================
// Branch info
// ============================================================================

/**
 * Information about a git branch with its latest commit date.
 * Used for filtering branches by recency.
 *
 * GITX-2: Added isRemote flag to distinguish local from remote branches.
 * This is needed because local branch names can contain "/" (e.g., "feature/foo"),
 * so we cannot rely on the presence of "/" to detect remote branches.
 */
export interface BranchInfo {
  /** Branch name (e.g., "main", "feature/foo", "origin/main"). */
  readonly name: string;
  /** Timestamp of the latest commit on this branch (epoch seconds). */
  readonly lastCommitTimestamp: number;
  /**
   * Whether this branch is a remote branch (GITX-2).
   * Remote branches use refs/remotes/ prefix, local use refs/heads/.
   */
  readonly isRemote?: boolean;
}

// ============================================================================
// Tag mapping
// ============================================================================

/**
 * Mapping from commit SHA to array of tag names.
 * Maps from Python get_all_tags_by_commit_sha().
 */
export type TagMap = ReadonlyMap<string, readonly string[]>;

// ============================================================================
// Processing results
// ============================================================================

/**
 * Performance metrics collected during extraction for benchmarking.
 * Ticket: GITX-131
 */
export interface ExtractionPerformanceMetrics {
  /** Time spent on branch discovery (ms) */
  readonly branchDiscoveryMs: number;
  /** Time spent on commit processing (ms) */
  readonly commitProcessingMs: number;
  /** Time spent on SCC analysis (ms) */
  readonly sccAnalysisMs: number;
  /** Total extraction time (ms) */
  readonly totalMs: number;
  /** Number of git subprocess calls made */
  readonly gitSubprocessCalls: number;
  /** Number of SCC subprocess calls made */
  readonly sccSubprocessCalls: number;
  /** Number of commits processed */
  readonly commitsProcessed: number;
  /** Number of new commits inserted */
  readonly newCommitsInserted: number;
}

/**
 * Summary statistics for a completed repository analysis run.
 */
export interface RepoAnalysisResult {
  /** Repository name. */
  readonly repoName: string;
  /** Number of branches processed. */
  readonly branchesProcessed: number;
  /** Number of new commits inserted. */
  readonly commitsInserted: number;
  /** Number of branch relationships recorded. */
  readonly branchRelationshipsRecorded: number;
  /** Total processing time in milliseconds. */
  readonly durationMs: number;
  /** Error message if processing failed, undefined on success. */
  readonly error?: string;
}

/**
 * Summary of a full pipeline analysis run across all repositories.
 */
export interface AnalysisRunResult {
  /** Pipeline run ID from the database. */
  readonly pipelineRunId: number;
  /** Results per repository. */
  readonly repoResults: readonly RepoAnalysisResult[];
  /** Total processing time in milliseconds. */
  readonly totalDurationMs: number;
  /** Overall status. */
  readonly status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}
