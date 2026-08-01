/**
 * Dead branches detection and cleanup service.
 *
 * Identifies merged, stale, and orphaned Git branches across repositories,
 * calculates risk levels for safe deletion, and provides branch cleanup
 * operations with security validation.
 *
 * Key features:
 * - Detect merged branches using git merge-base ancestry checks
 * - Identify stale branches (>90 days old, configurable)
 * - Find orphaned branches (local-only or tracking deleted remotes)
 * - Calculate risk levels (safe, low, medium, high) for deletion safety
 * - Validate branch names to prevent command injection (CWE-78)
 * - Respect protected branch patterns (never delete main/master/develop)
 * - Rate-limit deletions for safety (max 10 per batch, 1s delay)
 * - Audit all operations to git_operation_audit table
 *
 * Ticket: GITX-231
 */

import simpleGit, { type SimpleGit } from 'simple-git';
import { LoggerService } from '../logging/logger.js';
import type {
  BranchStatus,
  BranchRiskLevel,
  DetectedBranch,
  BranchAnalysisResult,
  BranchDeletionResult,
  DeadBranchesConfig,
} from './dead-branches-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DeadBranchesService';

/**
 * Hard-coded protected branch names.
 * These branches can never be deleted regardless of configuration.
 */
const PROTECTED_BRANCH_NAMES = ['main', 'master', 'develop', 'staging', 'production'];

/**
 * Hard-coded protected branch patterns.
 * Branches matching these patterns cannot be deleted.
 */
const PROTECTED_BRANCH_PATTERNS = ['release/*', 'hotfix/*'];

/**
 * Regex pattern for valid Git branch names.
 * Prevents command injection by rejecting shell metacharacters.
 * Allows: letters, numbers, dots, underscores, hyphens, forward slashes.
 * Security: CWE-78 (OS Command Injection)
 */
const VALID_BRANCH_NAME_REGEX = /^[a-zA-Z0-9._/-]+$/;

/**
 * Default stale days threshold (90 days).
 */
const DEFAULT_STALE_DAYS = 90;

/**
 * Maximum number of branches to delete in a single batch.
 * Prevents accidental mass deletion.
 */
const MAX_BATCH_DELETE_SIZE = 10;

/**
 * Delay between deletions in milliseconds (rate limiting).
 */
const DELETE_DELAY_MS = 1000;

/**
 * Repository interface for database operations.
 * Implemented by BranchRepository.
 */
export interface IBranchRepository {
  /**
   * Upsert branch metadata into git_branch table.
   */
  upsertBranch(branch: {
    branchName: string;
    repository: string;
    lastCommitSha: string | null;
    lastCommitDate: Date | null;
    lastCommitAuthor: string | null;
    commitCount: number;
    isMerged: boolean;
    mergedInto: string | null;
    mergedDate: Date | null;
    isOrphaned: boolean;
    hasOpenPr: boolean;
    isProtected: boolean;
  }): Promise<void>;

  /**
   * Log branch operation to git_operation_audit table.
   */
  logBranchOperation(audit: {
    operationType: 'branch_delete' | 'branch_batch_delete' | 'branch_restore';
    repository: string;
    branchName: string | null;
    branchSha: string | null;
    operator: string | null;
    result: 'success' | 'failed' | 'rejected';
    errorMessage?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void>;
}

/**
 * Service for detecting and cleaning up dead/stale Git branches.
 *
 * Analyzes branches to identify candidates for deletion based on merge status,
 * age, and activity. Provides safe deletion workflows with validation,
 * rate limiting, and audit logging.
 */
export class DeadBranchesService {
  private readonly logger: LoggerService;
  private readonly git: SimpleGit;

  constructor(
    private readonly repoPath: string,
    private readonly branchRepo: IBranchRepository,
    private readonly config: DeadBranchesConfig,
  ) {
    this.logger = LoggerService.getInstance();
    this.git = simpleGit(repoPath);
    this.logger.debug(CLASS_NAME, 'constructor', `DeadBranchesService created for ${repoPath}`);
  }

  // ==========================================================================
  // Public API - Branch Analysis
  // ==========================================================================

  /**
   * Analyze all branches in the repository.
   *
   * Iterates through local branches, checks merge status, calculates
   * risk levels, and returns comprehensive analysis results.
   *
   * Performance: Optimized for repositories with <200 branches.
   * For larger repos, consider caching merge-base results.
   *
   * @returns Analysis results with branch metadata and summary statistics
   */
  async analyzeBranches(): Promise<BranchAnalysisResult> {
    this.logger.info(CLASS_NAME, 'analyzeBranches', 'Starting branch analysis');

    const branches: DetectedBranch[] = [];
    const summary = { total: 0, merged: 0, stale: 0, orphaned: 0, active: 0 };
    const riskDistribution = { safe: 0, low: 0, medium: 0, high: 0 };
    const repositoryBreakdown = new Map<string, { safe: number; low: number; medium: number; high: number }>();

    try {
      // Get all local branches
      const branchSummary = await this.git.branchLocal();
      const branchNames = branchSummary.all;

      this.logger.debug(CLASS_NAME, 'analyzeBranches', `Found ${branchNames.length} local branches`);

      // Get orphaned branches (local-only or tracking deleted remotes)
      const orphanedBranches = await this.detectOrphanedBranches();
      this.logger.debug(CLASS_NAME, 'analyzeBranches', `Found ${orphanedBranches.length} orphaned branches`);

      // Analyze each branch
      for (const branchName of branchNames) {
        // Security: Validate branch name before using in git commands (CWE-78)
        const validation = this.validateBranchName(branchName);
        if (!validation.isValid) {
          this.logger.warn(
            CLASS_NAME,
            'analyzeBranches',
            `Skipping invalid branch name: ${branchName} - ${validation.reason}`
          );
          continue;
        }

        // Skip protected branches
        if (this.isProtectedBranch(branchName)) {
          this.logger.debug(CLASS_NAME, 'analyzeBranches', `Skipping protected branch: ${branchName}`);
          continue;
        }

        try {
          // Get last commit info
          const log = await this.git.log({ maxCount: 1, [branchName]: null });
          const lastCommit = log.latest;

          if (!lastCommit) {
            this.logger.warn(CLASS_NAME, 'analyzeBranches', `No commits found for branch: ${branchName}`);
            continue;
          }

          const lastCommitDate = new Date(lastCommit.date);
          const daysSinceLastCommit = Math.floor(
            (Date.now() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Get commit count (approximate via log)
          const fullLog = await this.git.log({ [branchName]: null });
          const commitCount = fullLog.total;

          // Check merge status
          const mergeStatus = await this.checkMergeStatus(branchName);

          // Determine if orphaned
          const isOrphaned = orphanedBranches.includes(branchName);

          // Determine status
          let status: BranchStatus;
          if (mergeStatus.isMerged) {
            status = 'merged';
          } else if (daysSinceLastCommit > this.config.staleDaysThreshold) {
            status = 'stale';
          } else if (isOrphaned) {
            status = 'orphaned';
          } else {
            status = 'active';
          }

          // Build branch object
          const branch: DetectedBranch = {
            name: branchName,
            repository: this.getRepositoryName(),
            lastCommitSha: lastCommit.hash,
            lastCommitDate,
            lastCommitAuthor: lastCommit.author_name,
            commitCount,
            isMerged: mergeStatus.isMerged,
            mergedInto: mergeStatus.mergedInto,
            isOrphaned,
            hasOpenPR: false, // TODO: Implement PR detection in Phase 2
            isProtected: false, // Already filtered out protected branches
            status,
            riskLevel: 'low', // Placeholder, will be calculated next
            daysSinceLastCommit,
          };

          // Calculate risk level
          branch.riskLevel = this.calculateRiskLevel(branch);

          // Apply mergedOnly filter if configured
          if (this.config.mergedOnly && !branch.isMerged) {
            this.logger.debug(
              CLASS_NAME,
              'analyzeBranches',
              `Skipping unmerged branch (mergedOnly=true): ${branchName}`
            );
            continue;
          }

          branches.push(branch);

          // Update summary
          summary.total++;
          summary[status]++;
          riskDistribution[branch.riskLevel]++;

          this.logger.debug(
            CLASS_NAME,
            'analyzeBranches',
            `Branch: ${branchName} | Status: ${status} | Risk: ${branch.riskLevel} | Days: ${daysSinceLastCommit}`
          );
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(CLASS_NAME, 'analyzeBranches', `Failed to analyze branch ${branchName}: ${message}`);
        }
      }

      // Build repository breakdown
      const repoName = this.getRepositoryName();
      repositoryBreakdown.set(repoName, { ...riskDistribution });

      this.logger.info(
        CLASS_NAME,
        'analyzeBranches',
        `Analysis complete: ${summary.total} branches | Safe: ${riskDistribution.safe} | Low: ${riskDistribution.low} | Medium: ${riskDistribution.medium} | High: ${riskDistribution.high}`
      );

      return { branches, summary, riskDistribution, repositoryBreakdown };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'analyzeBranches', `Branch analysis failed: ${message}`);
      throw new Error(`Branch analysis failed: ${message}`);
    }
  }

  /**
   * Check if a branch is merged into any protected branch.
   *
   * Uses git merge-base to check if the branch is an ancestor of
   * main/master/develop. A branch is considered merged if:
   *   merge-base(branch, target) == branch_tip_sha
   *
   * This means all commits on the branch are reachable from target.
   *
   * @param branchName - Name of branch to check
   * @returns Merge status with target branch name if merged
   */
  async checkMergeStatus(branchName: string): Promise<{ isMerged: boolean; mergedInto: string | null }> {
    this.logger.debug(CLASS_NAME, 'checkMergeStatus', `Checking merge status for: ${branchName}`);

    const targetBranches = ['main', 'master', 'develop'];

    for (const target of targetBranches) {
      try {
        // Check if target branch exists
        const branches = await this.git.branchLocal();
        if (!branches.all.includes(target)) {
          this.logger.debug(CLASS_NAME, 'checkMergeStatus', `Target branch ${target} does not exist, skipping`);
          continue;
        }

        // Get branch tip SHA
        const branchLog = await this.git.log({ maxCount: 1, [branchName]: null });
        const branchTipSha = branchLog.latest?.hash;

        if (!branchTipSha) {
          this.logger.warn(CLASS_NAME, 'checkMergeStatus', `No commits found for ${branchName}`);
          return { isMerged: false, mergedInto: null };
        }

        // Get merge-base SHA
        const mergeBaseSha = await this.git.raw(['merge-base', branchName, target]);
        const trimmedMergeBase = mergeBaseSha.trim();

        // If merge-base equals branch tip, branch is merged
        if (trimmedMergeBase === branchTipSha) {
          this.logger.debug(
            CLASS_NAME,
            'checkMergeStatus',
            `Branch ${branchName} is merged into ${target}`
          );
          return { isMerged: true, mergedInto: target };
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.debug(
          CLASS_NAME,
          'checkMergeStatus',
          `Could not check merge status against ${target}: ${message}`
        );
      }
    }

    this.logger.debug(CLASS_NAME, 'checkMergeStatus', `Branch ${branchName} is not merged`);
    return { isMerged: false, mergedInto: null };
  }

  /**
   * Detect orphaned branches (local-only or tracking deleted remotes).
   *
   * Uses `git branch -vv` to check tracking status.
   * Branches with "[gone]" indicator have deleted remotes.
   * Branches with no remote tracking are local-only.
   *
   * @returns Array of orphaned branch names
   */
  async detectOrphanedBranches(): Promise<string[]> {
    this.logger.debug(CLASS_NAME, 'detectOrphanedBranches', 'Detecting orphaned branches');

    try {
      // Run git branch -vv to get verbose branch list with tracking info
      const output = await this.git.raw(['branch', '-vv']);

      const orphaned: string[] = [];
      const lines = output.split('\n').filter((line) => line.trim().length > 0);

      for (const line of lines) {
        // Parse branch name (first field after optional *)
        const match = line.match(/^[\s*]+([^\s]+)/);
        if (!match) {
          continue;
        }

        const branchName = match[1];
        if (!branchName) {
          continue;
        }

        // Check for [gone] indicator (deleted remote)
        if (line.includes('[gone]')) {
          orphaned.push(branchName);
          this.logger.debug(CLASS_NAME, 'detectOrphanedBranches', `Orphaned (gone): ${branchName}`);
        }
        // Check for no remote tracking (no [...] section)
        else if (!line.includes('[')) {
          orphaned.push(branchName);
          this.logger.debug(CLASS_NAME, 'detectOrphanedBranches', `Orphaned (local-only): ${branchName}`);
        }
      }

      this.logger.debug(CLASS_NAME, 'detectOrphanedBranches', `Found ${orphaned.length} orphaned branches`);
      return orphaned;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'detectOrphanedBranches', `Failed to detect orphaned branches: ${message}`);
      return [];
    }
  }

  /**
   * Calculate risk level for a branch based on merge status, age, and activity.
   *
   * Risk levels:
   * - **Safe**: Merged AND >90 days old (safe to delete)
   * - **Low**: Merged AND <90 days old
   * - **Medium**: Unmerged AND 90-180 days old
   * - **High**: Unmerged AND (<90 days OR has open PR)
   *
   * @param branch - Branch metadata
   * @returns Calculated risk level
   */
  calculateRiskLevel(branch: DetectedBranch): BranchRiskLevel {
    // Safe: merged and old
    if (branch.isMerged && branch.daysSinceLastCommit > DEFAULT_STALE_DAYS) {
      return 'safe';
    }

    // Low: merged and recent
    if (branch.isMerged) {
      return 'low';
    }

    // High: unmerged with open PR (preserve active work)
    if (branch.hasOpenPR) {
      return 'high';
    }

    // High: unmerged and very recent (<90 days)
    if (branch.daysSinceLastCommit < DEFAULT_STALE_DAYS) {
      return 'high';
    }

    // Medium: unmerged and moderately old (90-180 days)
    if (branch.daysSinceLastCommit < 180) {
      return 'medium';
    }

    // Default to medium for edge cases
    return 'medium';
  }

  // ==========================================================================
  // Public API - Branch Deletion
  // ==========================================================================

  /**
   * Delete a single branch (local only).
   *
   * Validates branch name, checks protection status, and executes
   * git branch -d (or -D if force=true). Logs operation to audit table.
   *
   * Security: Validates branch name to prevent command injection (CWE-78).
   *
   * @param branchName - Name of branch to delete
   * @param force - If true, use git branch -D (force delete unmerged)
   * @returns Deletion result with success status and SHA for recovery
   */
  async deleteBranch(branchName: string, force = false): Promise<BranchDeletionResult> {
    this.logger.info(CLASS_NAME, 'deleteBranch', `Deleting branch: ${branchName} (force=${force})`);

    // Validate branch name
    const validation = this.validateBranchName(branchName);
    if (!validation.isValid) {
      this.logger.warn(CLASS_NAME, 'deleteBranch', `Invalid branch name rejected: ${validation.reason}`);
      return {
        success: false,
        branchName,
        sha: '',
        error: `Invalid branch name: ${validation.reason}`,
      };
    }

    // Check if protected
    if (this.isProtectedBranch(branchName)) {
      this.logger.warn(CLASS_NAME, 'deleteBranch', `Attempted to delete protected branch: ${branchName}`);
      return {
        success: false,
        branchName,
        sha: '',
        error: 'Cannot delete protected branch',
      };
    }

    try {
      // Get SHA before deletion (for recovery)
      const log = await this.git.log({ maxCount: 1, [branchName]: null });
      const sha = log.latest?.hash ?? '';

      // Delete branch
      const deleteFlag = force ? '-D' : '-d';
      await this.git.raw(['branch', deleteFlag, branchName]);

      // Log to audit table
      await this.branchRepo.logBranchOperation({
        operationType: 'branch_delete',
        repository: this.getRepositoryName(),
        branchName,
        branchSha: sha,
        operator: null, // Could be set from extension context
        result: 'success',
        metadata: { force },
      });

      this.logger.info(CLASS_NAME, 'deleteBranch', `Successfully deleted branch: ${branchName} (SHA: ${sha})`);

      return {
        success: true,
        branchName,
        sha,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'deleteBranch', `Failed to delete branch ${branchName}: ${message}`);
      return {
        success: false,
        branchName,
        sha: '',
        error: message,
      };
    }
  }

  /**
   * Delete multiple branches with rate limiting and safety checks.
   *
   * Limits batch size to MAX_BATCH_DELETE_SIZE (10) and adds 1 second
   * delay between deletions to prevent accidental mass deletion.
   *
   * @param branchNames - Array of branch names to delete
   * @param force - If true, use git branch -D for all branches
   * @returns Array of deletion results (one per branch)
   */
  async deleteBranches(branchNames: string[], force = false): Promise<BranchDeletionResult[]> {
    this.logger.info(CLASS_NAME, 'deleteBranches', `Deleting ${branchNames.length} branches (force=${force})`);

    if (branchNames.length > MAX_BATCH_DELETE_SIZE) {
      this.logger.warn(
        CLASS_NAME,
        'deleteBranches',
        `Batch size ${branchNames.length} exceeds limit ${MAX_BATCH_DELETE_SIZE}`
      );
      throw new Error(`Cannot delete more than ${MAX_BATCH_DELETE_SIZE} branches at once`);
    }

    const results: BranchDeletionResult[] = [];

    for (const branchName of branchNames) {
      const result = await this.deleteBranch(branchName, force);
      results.push(result);

      // Rate limiting: delay between deletions
      if (branchNames.length > 1) {
        await this.sleep(DELETE_DELAY_MS);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.info(
      CLASS_NAME,
      'deleteBranches',
      `Batch deletion complete: ${successCount}/${branchNames.length} succeeded`
    );

    return results;
  }

  // ==========================================================================
  // Public API - Validation and Protection
  // ==========================================================================

  /**
   * Validate branch name against Git ref format rules.
   *
   * Prevents command injection by rejecting shell metacharacters.
   * Allows: letters, numbers, dots, underscores, hyphens, forward slashes.
   *
   * Security: CWE-78 (OS Command Injection)
   *
   * @param name - Branch name to validate
   * @returns Validation result with reason if invalid
   */
  validateBranchName(name: string): { isValid: boolean; reason?: string } {
    if (!name || name.length === 0) {
      return { isValid: false, reason: 'Branch name is empty' };
    }

    if (!VALID_BRANCH_NAME_REGEX.test(name)) {
      return { isValid: false, reason: 'Branch name contains invalid characters' };
    }

    if (name.startsWith('-')) {
      return { isValid: false, reason: 'Branch name cannot start with hyphen' };
    }

    if (name.includes('..')) {
      return { isValid: false, reason: 'Branch name cannot contain ..' };
    }

    if (name.endsWith('.lock')) {
      return { isValid: false, reason: 'Branch name cannot end with .lock' };
    }

    return { isValid: true };
  }

  /**
   * Check if branch is protected (matches hard-coded names or patterns).
   *
   * Protected branches:
   * - Hard-coded: main, master, develop, staging, production
   * - Patterns: release/*, hotfix/*
   * - User-configured: gitr.deadBranches.excludePatterns
   *
   * @param name - Branch name to check
   * @returns True if branch is protected
   */
  isProtectedBranch(name: string): boolean {
    // Check hard-coded names
    if (PROTECTED_BRANCH_NAMES.includes(name)) {
      return true;
    }

    // Check hard-coded patterns
    for (const pattern of PROTECTED_BRANCH_PATTERNS) {
      if (this.matchesGlobPattern(name, pattern)) {
        return true;
      }
    }

    // Check user-configured patterns
    for (const pattern of this.config.excludePatterns) {
      if (this.matchesGlobPattern(name, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Simple glob pattern matching for branch names.
   * Supports wildcards: * (any characters), ? (single character).
   * Does not support advanced minimatch features like braces or character ranges.
   *
   * @param name - Branch name to test
   * @param pattern - Glob pattern (e.g., "release/*", "feature-*")
   * @returns True if name matches pattern
   */
  private matchesGlobPattern(name: string, pattern: string): boolean {
    // Convert glob pattern to regex
    // Escape special regex characters except * and ?
    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*') // * -> .*
      .replace(/\?/g, '.'); // ? -> .

    // Anchor pattern to start and end
    regexPattern = `^${regexPattern}$`;

    const regex = new RegExp(regexPattern);
    return regex.test(name);
  }

  // ==========================================================================
  // Public API - Database Sync
  // ==========================================================================

  /**
   * Sync branch metadata to database.
   *
   * Analyzes all branches and inserts/updates branch records in
   * the branches table for persistence and reporting.
   *
   * @returns Number of branches synced
   */
  async syncBranchesToDatabase(): Promise<number> {
    this.logger.info(CLASS_NAME, 'syncBranchesToDatabase', 'Syncing branches to database');

    const result = await this.analyzeBranches();

    for (const branch of result.branches) {
      try {
        await this.branchRepo.upsertBranch({
          branchName: branch.name,
          repository: branch.repository,
          lastCommitSha: branch.lastCommitSha,
          lastCommitDate: branch.lastCommitDate,
          lastCommitAuthor: branch.lastCommitAuthor,
          commitCount: branch.commitCount,
          isMerged: branch.isMerged,
          mergedInto: branch.mergedInto,
          mergedDate: null, // Could be set if merge date tracking is implemented
          isOrphaned: branch.isOrphaned,
          hasOpenPr: branch.hasOpenPR,
          isProtected: branch.isProtected,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(CLASS_NAME, 'syncBranchesToDatabase', `Failed to upsert branch ${branch.name}: ${message}`);
      }
    }

    this.logger.info(CLASS_NAME, 'syncBranchesToDatabase', `Synced ${result.branches.length} branches to database`);
    return result.branches.length;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Get repository name from repo path.
   * Extracts last directory name from path.
   */
  private getRepositoryName(): string {
    const parts = this.repoPath.split('/');
    return parts[parts.length - 1] ?? 'unknown';
  }

  /**
   * Sleep for specified milliseconds (rate limiting helper).
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
