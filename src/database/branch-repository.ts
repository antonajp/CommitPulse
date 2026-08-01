import type { PoolClient } from 'pg';
import { DatabaseService, type DatabaseQueryResult } from './database-service.js';
import { LoggerService } from '../logging/logger.js';
import type {
  GitBranchRow,
  DeadBranchSummaryRow,
  DeadBranchFilters,
  BranchOperationAudit,
  BranchStatistics,
  BranchSummaryStats,
  RiskDistributionStats,
  RepositoryRiskBreakdown,
} from './branch-types.js';
import {
  SQL_UPSERT_BRANCH,
  SQL_GET_BRANCHES_FOR_REPOSITORY,
  SQL_GET_DEAD_BRANCH_SUMMARY_BASE,
  SQL_MARK_BRANCH_DELETED,
  SQL_INSERT_OPERATION_AUDIT,
  SQL_GET_BRANCH_STATISTICS,
  SQL_GET_SUMMARY_STATISTICS,
  SQL_GET_BRANCH_BY_NAME,
  SQL_GET_RECENT_AUDIT_LOGS,
  SQL_GET_GLOBAL_SUMMARY_STATISTICS,
  SQL_GET_GLOBAL_RISK_DISTRIBUTION,
  SQL_GET_REPOSITORY_RISK_BREAKDOWN,
  SQL_GET_DISTINCT_REPOSITORIES,
} from './branch-queries.js';

// Re-export types so consumers can import from branch-repository directly
export type {
  GitBranchRow,
  DeadBranchSummaryRow,
  DeadBranchFilters,
  BranchOperationAudit,
  BranchStatistics,
  BranchSummaryStats,
  RiskDistributionStats,
  RepositoryRiskBreakdown,
} from './branch-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'BranchRepository';

// ============================================================================
// BranchRepository implementation
// ============================================================================

/**
 * Repository for branch tracking and dead branch analysis.
 * All queries use parameterized placeholders ($1, $2) -- zero string interpolation.
 * Ticket: GITX-231
 */
export class BranchRepository {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'BranchRepository created');
  }

  /**
   * Upsert a git_branch row. Uses ON CONFLICT to update existing branches.
   * Automatically sets updated_at to CURRENT_TIMESTAMP.
   *
   * @param branch - The branch data to insert or update
   */
  async upsertBranch(branch: GitBranchRow): Promise<void> {
    this.logger.debug(
      CLASS_NAME,
      'upsertBranch',
      `[${branch.repository}] Upserting branch: ${branch.branchName}`,
    );

    await this.db.query(SQL_UPSERT_BRANCH, [
      branch.branchName,
      branch.repository,
      branch.lastCommitSha,
      branch.lastCommitDate,
      branch.lastCommitAuthor,
      branch.commitCount,
      branch.isMerged,
      branch.mergedInto,
      branch.mergedDate,
      branch.isOrphaned,
      branch.hasOpenPr,
      branch.isProtected,
    ]);

    this.logger.trace(
      CLASS_NAME,
      'upsertBranch',
      `[${branch.repository}] Branch ${branch.branchName} upserted`,
    );
  }

  /**
   * Batch upsert branches within a transaction.
   *
   * @param branches - Array of branch rows to upsert
   */
  async batchUpsertBranches(branches: readonly GitBranchRow[]): Promise<void> {
    if (branches.length === 0) {
      this.logger.debug(CLASS_NAME, 'batchUpsertBranches', 'No branches to upsert');
      return;
    }

    const repo = branches[0]?.repository ?? 'unknown';
    this.logger.debug(
      CLASS_NAME,
      'batchUpsertBranches',
      `[${repo}] Batch upserting ${branches.length} branches`,
    );

    await this.db.transaction(async (client: PoolClient) => {
      for (const branch of branches) {
        await client.query(SQL_UPSERT_BRANCH, [
          branch.branchName,
          branch.repository,
          branch.lastCommitSha,
          branch.lastCommitDate,
          branch.lastCommitAuthor,
          branch.commitCount,
          branch.isMerged,
          branch.mergedInto,
          branch.mergedDate,
          branch.isOrphaned,
          branch.hasOpenPr,
          branch.isProtected,
        ]);
      }
    });

    this.logger.debug(
      CLASS_NAME,
      'batchUpsertBranches',
      `[${repo}] Upserted ${branches.length} branches`,
    );
  }

  /**
   * Get all non-deleted branches for a repository.
   *
   * @param repository - Repository name
   * @returns Array of branch rows
   */
  async getBranchesForRepository(repository: string): Promise<GitBranchRow[]> {
    this.logger.debug(
      CLASS_NAME,
      'getBranchesForRepository',
      `[${repository}] Querying branches`,
    );

    const result: DatabaseQueryResult<{
      id: number;
      branch_name: string;
      repository: string;
      last_commit_sha: string | null;
      last_commit_date: Date | null;
      last_commit_author: string | null;
      commit_count: number;
      is_merged: boolean;
      merged_into: string | null;
      merged_date: Date | null;
      is_orphaned: boolean;
      has_open_pr: boolean;
      is_protected: boolean;
      deleted_at: Date | null;
      deleted_by: string | null;
      created_at: Date;
      updated_at: Date;
    }> = await this.db.query(SQL_GET_BRANCHES_FOR_REPOSITORY, [repository]);

    const branches = result.rows.map(this.mapToBranchRow);

    this.logger.debug(
      CLASS_NAME,
      'getBranchesForRepository',
      `[${repository}] Found ${branches.length} branches`,
    );

    return branches;
  }

  /**
   * Get branch by repository and name.
   *
   * @param repository - Repository name
   * @param branchName - Branch name
   * @returns Branch row or null if not found
   */
  async getBranchByName(
    repository: string,
    branchName: string,
  ): Promise<GitBranchRow | null> {
    this.logger.debug(
      CLASS_NAME,
      'getBranchByName',
      `[${repository}] Querying branch: ${branchName}`,
    );

    const result: DatabaseQueryResult<{
      id: number;
      branch_name: string;
      repository: string;
      last_commit_sha: string | null;
      last_commit_date: Date | null;
      last_commit_author: string | null;
      commit_count: number;
      is_merged: boolean;
      merged_into: string | null;
      merged_date: Date | null;
      is_orphaned: boolean;
      has_open_pr: boolean;
      is_protected: boolean;
      deleted_at: Date | null;
      deleted_by: string | null;
      created_at: Date;
      updated_at: Date;
    }> = await this.db.query(SQL_GET_BRANCH_BY_NAME, [repository, branchName]);

    const row = result.rows[0];
    if (!row) {
      this.logger.debug(
        CLASS_NAME,
        'getBranchByName',
        `[${repository}] Branch not found: ${branchName}`,
      );
      return null;
    }

    return this.mapToBranchRow(row);
  }

  /**
   * Get dead branch summary with optional filters.
   * Uses the vw_dead_branch_summary view for risk categorization.
   *
   * @param filters - Optional filters for repository, risk level, status, etc.
   * @returns Array of dead branch summary rows
   */
  async getDeadBranchSummary(filters: DeadBranchFilters = {}): Promise<DeadBranchSummaryRow[]> {
    this.logger.debug(
      CLASS_NAME,
      'getDeadBranchSummary',
      `Querying with filters: ${JSON.stringify(filters)}`,
    );

    // Build dynamic WHERE clause based on filters
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.repository) {
      whereClauses.push(`repository = $${paramIndex}`);
      params.push(filters.repository);
      paramIndex++;
    }

    if (filters.riskLevels && filters.riskLevels.length > 0) {
      whereClauses.push(`risk_level = ANY($${paramIndex})`);
      params.push(filters.riskLevels);
      paramIndex++;
    }

    if (filters.statuses && filters.statuses.length > 0) {
      whereClauses.push(`status = ANY($${paramIndex})`);
      params.push(filters.statuses);
      paramIndex++;
    }

    if (filters.minDaysSinceLastCommit !== undefined) {
      whereClauses.push(`days_since_last_commit >= $${paramIndex}`);
      params.push(filters.minDaysSinceLastCommit);
      paramIndex++;
    }

    if (filters.maxDaysSinceLastCommit !== undefined) {
      whereClauses.push(`days_since_last_commit <= $${paramIndex}`);
      params.push(filters.maxDaysSinceLastCommit);
      paramIndex++;
    }

    if (filters.isMerged !== undefined) {
      whereClauses.push(`is_merged = $${paramIndex}`);
      params.push(filters.isMerged);
      paramIndex++;
    }

    if (filters.hasOpenPr !== undefined) {
      whereClauses.push(`has_open_pr = $${paramIndex}`);
      params.push(filters.hasOpenPr);
      paramIndex++;
    }

    if (filters.search) {
      whereClauses.push(`branch_name ILIKE $${paramIndex}`);
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const sql = `${SQL_GET_DEAD_BRANCH_SUMMARY_BASE} ${whereClause} ORDER BY days_since_last_commit DESC, branch_name ASC`;

    const result: DatabaseQueryResult<{
      id: number;
      branch_name: string;
      repository: string;
      last_commit_date: Date | null;
      last_commit_author: string | null;
      last_commit_sha: string | null;
      commit_count: number;
      is_merged: boolean;
      merged_into: string | null;
      is_orphaned: boolean;
      has_open_pr: boolean;
      is_protected: boolean;
      created_at: Date;
      updated_at: Date;
      days_since_last_commit: number | null;
      status: 'merged' | 'stale' | 'orphaned' | 'active';
      risk_level: 'safe' | 'low' | 'medium' | 'high';
    }> = await this.db.query(sql, params);

    const summary = result.rows.map(this.mapToSummaryRow);

    this.logger.debug(
      CLASS_NAME,
      'getDeadBranchSummary',
      `Found ${summary.length} branches matching filters`,
    );

    return summary;
  }

  /**
   * Mark a branch as deleted (soft delete).
   * Sets deleted_at to current timestamp and records who deleted it.
   *
   * @param repository - Repository name
   * @param branchName - Branch name to mark as deleted
   * @param deletedBy - User who deleted the branch
   */
  async markBranchDeleted(
    repository: string,
    branchName: string,
    deletedBy: string,
  ): Promise<void> {
    this.logger.info(
      CLASS_NAME,
      'markBranchDeleted',
      `[${repository}] Marking branch as deleted: ${branchName} by ${deletedBy}`,
    );

    const result = await this.db.query(SQL_MARK_BRANCH_DELETED, [
      repository,
      branchName,
      deletedBy,
    ]);

    if (result.rowCount === 0) {
      this.logger.warn(
        CLASS_NAME,
        'markBranchDeleted',
        `[${repository}] Branch not found or already deleted: ${branchName}`,
      );
    } else {
      this.logger.debug(
        CLASS_NAME,
        'markBranchDeleted',
        `[${repository}] Branch marked as deleted: ${branchName}`,
      );
    }
  }

  /**
   * Log a branch operation to the audit table.
   * Used for all destructive operations (delete, batch delete, restore).
   *
   * @param audit - Audit log entry
   */
  async logBranchOperation(audit: BranchOperationAudit): Promise<void> {
    this.logger.debug(
      CLASS_NAME,
      'logBranchOperation',
      `[${audit.repository}] Logging operation: ${audit.operationType} - ${audit.result}`,
    );

    await this.db.query(SQL_INSERT_OPERATION_AUDIT, [
      audit.operationType,
      audit.repository,
      audit.branchName,
      audit.branchSha,
      audit.operator,
      audit.result,
      audit.errorMessage ?? null,
      audit.metadata ? JSON.stringify(audit.metadata) : null,
    ]);

    this.logger.trace(
      CLASS_NAME,
      'logBranchOperation',
      `[${audit.repository}] Operation logged: ${audit.operationType}`,
    );
  }

  /**
   * Get branch statistics for a repository.
   * Includes counts by risk level, status, and protection status.
   *
   * @param repository - Repository name
   * @returns Branch statistics object
   */
  async getBranchStatistics(repository: string): Promise<BranchStatistics> {
    this.logger.debug(
      CLASS_NAME,
      'getBranchStatistics',
      `[${repository}] Querying statistics`,
    );

    // Get base statistics from git_branch
    const baseResult: DatabaseQueryResult<{
      total_branches: number;
      active_count: number;
      deleted_count: number;
      protected_count: number;
    }> = await this.db.query(SQL_GET_BRANCH_STATISTICS, [repository]);

    // Get summary statistics from view
    const summaryResult: DatabaseQueryResult<{
      total: number;
      safe_count: number;
      low_count: number;
      medium_count: number;
      high_count: number;
      merged_count: number;
      stale_count: number;
      orphaned_count: number;
      active_count: number;
    }> = await this.db.query(SQL_GET_SUMMARY_STATISTICS, [repository]);

    const base = baseResult.rows[0];
    const summary = summaryResult.rows[0];

    const statistics: BranchStatistics = {
      totalBranches: base?.total_branches ?? 0,
      safeBranches: summary?.safe_count ?? 0,
      lowRiskBranches: summary?.low_count ?? 0,
      mediumRiskBranches: summary?.medium_count ?? 0,
      highRiskBranches: summary?.high_count ?? 0,
      mergedBranches: summary?.merged_count ?? 0,
      staleBranches: summary?.stale_count ?? 0,
      orphanedBranches: summary?.orphaned_count ?? 0,
      activeBranches: summary?.active_count ?? 0,
      protectedBranches: base?.protected_count ?? 0,
      deletedBranches: base?.deleted_count ?? 0,
    };

    this.logger.debug(
      CLASS_NAME,
      'getBranchStatistics',
      `[${repository}] Statistics: total=${statistics.totalBranches}, safe=${statistics.safeBranches}, low=${statistics.lowRiskBranches}, medium=${statistics.mediumRiskBranches}, high=${statistics.highRiskBranches}`,
    );

    return statistics;
  }

  /**
   * Get recent audit logs for a repository.
   *
   * @param repository - Repository name
   * @param limit - Maximum number of logs to return (default: 100)
   * @returns Array of audit log entries
   */
  async getRecentAuditLogs(
    repository: string,
    limit = 100,
  ): Promise<Array<BranchOperationAudit & { id: number; createdAt: Date }>> {
    this.logger.debug(
      CLASS_NAME,
      'getRecentAuditLogs',
      `[${repository}] Querying recent audit logs (limit: ${limit})`,
    );

    const result: DatabaseQueryResult<{
      id: number;
      operation_type: 'branch_delete' | 'branch_batch_delete' | 'branch_restore';
      repository: string;
      branch_name: string | null;
      branch_sha: string | null;
      operator: string | null;
      result: 'success' | 'failed' | 'rejected';
      error_message: string | null;
      metadata: string | null;
      created_at: Date;
    }> = await this.db.query(SQL_GET_RECENT_AUDIT_LOGS, [repository, limit]);

    const logs = result.rows.map((row) => ({
      id: row.id,
      operationType: row.operation_type,
      repository: row.repository,
      branchName: row.branch_name,
      branchSha: row.branch_sha,
      operator: row.operator,
      result: row.result,
      errorMessage: row.error_message,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
    }));

    this.logger.debug(
      CLASS_NAME,
      'getRecentAuditLogs',
      `[${repository}] Found ${logs.length} audit logs`,
    );

    return logs;
  }

  // ============================================================================
  // Dashboard Aggregate Methods
  // ============================================================================

  /**
   * Get global summary statistics (total, merged, stale, orphaned, active counts).
   * No repository filter - returns aggregates across all branches.
   *
   * @returns Summary statistics object
   */
  async getGlobalSummaryStatistics(): Promise<BranchSummaryStats> {
    this.logger.debug(CLASS_NAME, 'getGlobalSummaryStatistics', 'Querying global summary statistics');

    const result: DatabaseQueryResult<{
      total: number;
      merged_count: number;
      stale_count: number;
      orphaned_count: number;
      active_count: number;
    }> = await this.db.query(SQL_GET_GLOBAL_SUMMARY_STATISTICS);

    const row = result.rows[0];

    const stats: BranchSummaryStats = {
      total: row?.total ?? 0,
      merged: row?.merged_count ?? 0,
      stale: row?.stale_count ?? 0,
      orphaned: row?.orphaned_count ?? 0,
      active: row?.active_count ?? 0,
    };

    this.logger.debug(
      CLASS_NAME,
      'getGlobalSummaryStatistics',
      `Global stats: total=${stats.total}, merged=${stats.merged}, stale=${stats.stale}, orphaned=${stats.orphaned}, active=${stats.active}`,
    );

    return stats;
  }

  /**
   * Get global risk distribution (safe, low, medium, high counts).
   * No repository filter - returns aggregates across all branches.
   *
   * @returns Risk distribution object
   */
  async getGlobalRiskDistribution(): Promise<RiskDistributionStats> {
    this.logger.debug(CLASS_NAME, 'getGlobalRiskDistribution', 'Querying global risk distribution');

    const result: DatabaseQueryResult<{
      safe_count: number;
      low_count: number;
      medium_count: number;
      high_count: number;
    }> = await this.db.query(SQL_GET_GLOBAL_RISK_DISTRIBUTION);

    const row = result.rows[0];

    const distribution: RiskDistributionStats = {
      safe: row?.safe_count ?? 0,
      low: row?.low_count ?? 0,
      medium: row?.medium_count ?? 0,
      high: row?.high_count ?? 0,
    };

    this.logger.debug(
      CLASS_NAME,
      'getGlobalRiskDistribution',
      `Risk distribution: safe=${distribution.safe}, low=${distribution.low}, medium=${distribution.medium}, high=${distribution.high}`,
    );

    return distribution;
  }

  /**
   * Get risk breakdown by repository for stacked bar chart.
   *
   * @returns Array of repository risk breakdowns
   */
  async getRepositoryRiskBreakdown(): Promise<RepositoryRiskBreakdown[]> {
    this.logger.debug(CLASS_NAME, 'getRepositoryRiskBreakdown', 'Querying repository risk breakdown');

    const result: DatabaseQueryResult<{
      repository: string;
      safe_count: number;
      low_count: number;
      medium_count: number;
      high_count: number;
    }> = await this.db.query(SQL_GET_REPOSITORY_RISK_BREAKDOWN);

    const breakdown: RepositoryRiskBreakdown[] = result.rows.map((row) => ({
      repository: row.repository,
      safe: row.safe_count,
      low: row.low_count,
      medium: row.medium_count,
      high: row.high_count,
    }));

    this.logger.debug(
      CLASS_NAME,
      'getRepositoryRiskBreakdown',
      `Found ${breakdown.length} repositories with risk data`,
    );

    return breakdown;
  }

  /**
   * Get distinct repository names from the dead branch summary view.
   * Used for filter dropdown options.
   *
   * @returns Array of repository names
   */
  async getDistinctRepositories(): Promise<string[]> {
    this.logger.debug(CLASS_NAME, 'getDistinctRepositories', 'Querying distinct repositories');

    const result: DatabaseQueryResult<{
      repository: string;
    }> = await this.db.query(SQL_GET_DISTINCT_REPOSITORIES);

    const repositories = result.rows.map((row) => row.repository);

    this.logger.debug(
      CLASS_NAME,
      'getDistinctRepositories',
      `Found ${repositories.length} distinct repositories`,
    );

    return repositories;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Map database row to GitBranchRow type.
   */
  private mapToBranchRow(row: {
    id: number;
    branch_name: string;
    repository: string;
    last_commit_sha: string | null;
    last_commit_date: Date | null;
    last_commit_author: string | null;
    commit_count: number;
    is_merged: boolean;
    merged_into: string | null;
    merged_date: Date | null;
    is_orphaned: boolean;
    has_open_pr: boolean;
    is_protected: boolean;
    deleted_at: Date | null;
    deleted_by: string | null;
    created_at: Date;
    updated_at: Date;
  }): GitBranchRow {
    return {
      id: row.id,
      branchName: row.branch_name,
      repository: row.repository,
      lastCommitSha: row.last_commit_sha,
      lastCommitDate: row.last_commit_date,
      lastCommitAuthor: row.last_commit_author,
      commitCount: row.commit_count,
      isMerged: row.is_merged,
      mergedInto: row.merged_into,
      mergedDate: row.merged_date,
      isOrphaned: row.is_orphaned,
      hasOpenPr: row.has_open_pr,
      isProtected: row.is_protected,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Map database row to DeadBranchSummaryRow type.
   */
  private mapToSummaryRow(row: {
    id: number;
    branch_name: string;
    repository: string;
    last_commit_date: Date | null;
    last_commit_author: string | null;
    last_commit_sha: string | null;
    commit_count: number;
    is_merged: boolean;
    merged_into: string | null;
    is_orphaned: boolean;
    has_open_pr: boolean;
    is_protected: boolean;
    created_at: Date;
    updated_at: Date;
    days_since_last_commit: number | null;
    status: 'merged' | 'stale' | 'orphaned' | 'active';
    risk_level: 'safe' | 'low' | 'medium' | 'high';
  }): DeadBranchSummaryRow {
    return {
      id: row.id,
      branchName: row.branch_name,
      repository: row.repository,
      lastCommitDate: row.last_commit_date,
      lastCommitAuthor: row.last_commit_author,
      lastCommitSha: row.last_commit_sha,
      commitCount: row.commit_count,
      isMerged: row.is_merged,
      mergedInto: row.merged_into,
      isOrphaned: row.is_orphaned,
      hasOpenPr: row.has_open_pr,
      isProtected: row.is_protected,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      daysSinceLastCommit: row.days_since_last_commit,
      status: row.status,
      riskLevel: row.risk_level,
    };
  }
}
