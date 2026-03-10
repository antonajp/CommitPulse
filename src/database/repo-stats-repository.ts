import { DatabaseService } from './database-service.js';
import { LoggerService } from '../logging/logger.js';
import type { RepoStats } from '../providers/repo-tree-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'RepoStatsRepository';

// ============================================================================
// SQL Constants - all parameterized, zero string interpolation
// ============================================================================

/**
 * Aggregate repository statistics from commit_history.
 * Returns one row per repository with:
 *  - last_sync_date: most recent commit_date
 *  - total_commits: count of distinct SHAs
 *  - unique_contributors: count of distinct authors
 *
 * Implementation note from ticket IQS-866:
 *   SELECT repository, MAX(commit_date), COUNT(DISTINCT sha), COUNT(DISTINCT author)
 *   FROM commit_history GROUP BY repository
 */
const SQL_GET_REPO_STATS = `
  SELECT
    repository,
    MAX(commit_date) AS last_sync_date,
    COUNT(DISTINCT sha)::int AS total_commits,
    COUNT(DISTINCT author)::int AS unique_contributors
  FROM commit_history
  GROUP BY repository
  ORDER BY repository
`;

/**
 * Get the count of distinct branches per repository from commit_branch_relationship.
 * This is a separate query because branch data lives in a different table.
 */
const SQL_GET_BRANCH_COUNTS = `
  SELECT
    ch.repository,
    COUNT(DISTINCT cbr.branch)::int AS branch_count
  FROM commit_branch_relationship cbr
  INNER JOIN commit_history ch ON cbr.sha = ch.sha
  GROUP BY ch.repository
  ORDER BY ch.repository
`;

// ============================================================================
// Row types for raw query results
// ============================================================================

interface RepoStatsRow {
  repository: string;
  last_sync_date: Date | null;
  total_commits: number;
  unique_contributors: number;
}

interface BranchCountRow {
  repository: string;
  branch_count: number;
}

// ============================================================================
// RepoStatsRepository implementation
// ============================================================================

/**
 * Repository for querying aggregate repository statistics from the database.
 * Provides data for the Repos TreeView (IQS-866).
 *
 * All queries use parameterized placeholders ($1, $2) -- zero string interpolation.
 * Ticket: IQS-866
 */
export class RepoStatsRepository {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'RepoStatsRepository created');
  }

  /**
   * Get aggregate statistics for all repositories with data in commit_history.
   * Combines commit stats with branch counts from commit_branch_relationship.
   *
   * @returns Array of RepoStats, one per repository, sorted by repository name
   */
  async getRepoStats(): Promise<RepoStats[]> {
    this.logger.debug(CLASS_NAME, 'getRepoStats', 'Querying aggregate repository statistics');

    // Execute both queries
    const [statsResult, branchResult] = await Promise.all([
      this.db.query<RepoStatsRow>(SQL_GET_REPO_STATS),
      this.db.query<BranchCountRow>(SQL_GET_BRANCH_COUNTS),
    ]);

    this.logger.debug(CLASS_NAME, 'getRepoStats', `Stats query returned ${statsResult.rowCount} repositories`);
    this.logger.debug(CLASS_NAME, 'getRepoStats', `Branch query returned ${branchResult.rowCount} repositories`);

    // Build a map of branch counts keyed by repository
    const branchCountMap = new Map<string, number>();
    for (const row of branchResult.rows) {
      branchCountMap.set(row.repository, row.branch_count);
    }

    // Combine stats with branch counts
    const repoStats: RepoStats[] = statsResult.rows.map((row) => {
      const stats: RepoStats = {
        repository: row.repository,
        lastSyncDate: row.last_sync_date,
        totalCommits: row.total_commits,
        uniqueContributors: row.unique_contributors,
        branchCount: branchCountMap.get(row.repository) ?? 0,
      };

      this.logger.trace(
        CLASS_NAME,
        'getRepoStats',
        `Repo: ${stats.repository}, commits=${stats.totalCommits}, contributors=${stats.uniqueContributors}, branches=${stats.branchCount}`,
      );

      return stats;
    });

    this.logger.info(CLASS_NAME, 'getRepoStats', `Loaded stats for ${repoStats.length} repositories`);
    return repoStats;
  }

  /**
   * Get statistics for a single repository by name.
   * Returns null if the repository has no data in commit_history.
   *
   * @param repository - The repository name to query
   * @returns RepoStats for the repository, or null if not found
   */
  async getRepoStatsByName(repository: string): Promise<RepoStats | null> {
    this.logger.debug(CLASS_NAME, 'getRepoStatsByName', `Querying stats for: ${repository}`);

    const allStats = await this.getRepoStats();
    const match = allStats.find((s) => s.repository === repository);

    if (!match) {
      this.logger.debug(CLASS_NAME, 'getRepoStatsByName', `No stats found for: ${repository}`);
      return null;
    }

    this.logger.debug(CLASS_NAME, 'getRepoStatsByName', `Found stats for: ${repository}`);
    return match;
  }
}
