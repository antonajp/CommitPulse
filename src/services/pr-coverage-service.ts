/**
 * Data service for the PR Coverage Report dashboard.
 * Provides methods to fetch PR coverage metrics from the
 * vw_pr_coverage database views, with optional filtering
 * by date range, repository, author, and branches.
 *
 * The PR Coverage Report helps engineering managers identify:
 *   - Which commits bypassed the PR workflow?
 *   - What is the overall code review compliance rate?
 *   - Are certain authors or branches more likely to skip PRs?
 *   - Is coverage improving or declining over time?
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: GITX-221
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import {
  QUERY_PR_COVERAGE_VIEW_EXISTS,
  QUERY_PR_COVERAGE_OVERALL,
  QUERY_PR_COVERAGE_OVERALL_DATE_RANGE,
  QUERY_ORPHAN_COMMITS,
  QUERY_PR_COVERAGE_BY_BRANCH,
  QUERY_PR_COVERAGE_BY_AUTHOR,
  QUERY_PR_COVERAGE_BY_CONTRIBUTOR,
  QUERY_PR_COVERAGE_BY_TEAM,
  QUERY_PR_COVERAGE_WEEKLY_TREND,
  QUERY_PR_COVERAGE_REPOSITORIES,
  QUERY_PR_COVERAGE_AUTHORS,
  QUERY_PR_COVERAGE_CONTRIBUTORS,
  QUERY_PR_COVERAGE_BRANCHES,
  QUERY_SYNC_PR_COVERAGE_FROM_MERGE_SHA,
  type ViewExistsRow,
  type PRCoverageOverallRow,
  type OrphanCommitRow,
  type CoverageByBranchRow,
  type CoverageByAuthorRow,
  type CoverageByContributorRow,
  type CoverageByTeamRow,
  type WeeklyTrendRow,
  type RepositoryRow,
  type AuthorRow,
  type ContributorRow,
  type BranchRow,
} from '../database/queries/pr-coverage-queries.js';
import {
  PR_COVERAGE_MAX_FILTER_LENGTH,
  PR_COVERAGE_DEFAULT_DAYS,
  type PRCoverageOverall,
  type OrphanCommit,
  type CoverageByBranch,
  type CoverageByAuthor,
  type CoverageByContributor,
  type CoverageByTeam,
  type WeeklyTrendPoint,
  type PRCoverageFilters,
  type PRCoverageChartData,
  type PRCoverageFilterOptions,
} from './pr-coverage-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'PRCoverageService';

/**
 * Service responsible for querying the vw_pr_coverage database
 * views and returning typed data for the PR Coverage Report dashboard.
 *
 * Ticket: GITX-221
 */
export class PRCoverageService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'PRCoverageService created');
  }

  /**
   * Check if the vw_pr_coverage view exists.
   * Used for graceful degradation when migration 031 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkViewExists', 'Checking vw_pr_coverage existence');

    const result = await this.db.query<ViewExistsRow>(QUERY_PR_COVERAGE_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkViewExists', `vw_pr_coverage exists: ${exists}`);
    return exists;
  }

  /**
   * Validate string filter inputs.
   * Enforces maximum length to prevent DoS attacks (CWE-20).
   *
   * @param value - String value to validate
   * @param fieldName - Name of the field for error message
   * @throws Error if value exceeds maximum length
   */
  private validateStringFilter(value: string | undefined, fieldName: string): void {
    if (value && value.length > PR_COVERAGE_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${PR_COVERAGE_MAX_FILTER_LENGTH}`,
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${PR_COVERAGE_MAX_FILTER_LENGTH} characters`,
      );
    }
  }

  /**
   * Validate date filter inputs.
   * Validates format and rejects malformed dates (CWE-20).
   *
   * @param filters - Filters to validate
   * @throws Error if dates are invalid
   */
  private validateDateFilters(filters: PRCoverageFilters): void {
    if (filters.startDate && !isValidDateString(filters.startDate)) {
      this.logger.warn(CLASS_NAME, 'validateDateFilters', `Invalid start date rejected: ${filters.startDate}`);
      throw new Error(`Invalid start date format: ${filters.startDate}. Expected YYYY-MM-DD.`);
    }
    if (filters.endDate && !isValidDateString(filters.endDate)) {
      this.logger.warn(CLASS_NAME, 'validateDateFilters', `Invalid end date rejected: ${filters.endDate}`);
      throw new Error(`Invalid end date format: ${filters.endDate}. Expected YYYY-MM-DD.`);
    }
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
      this.logger.warn(
        CLASS_NAME,
        'validateDateFilters',
        `Invalid date range: ${filters.startDate} > ${filters.endDate}`,
      );
      throw new Error(
        `Invalid date range: start date (${filters.startDate}) must be before end date (${filters.endDate})`,
      );
    }
  }

  /**
   * Get default date range (last N days based on PR_COVERAGE_DEFAULT_DAYS).
   *
   * @returns Object with startDate and endDate as ISO strings
   */
  private getDefaultDateRange(): { startDate: string; endDate: string } {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - PR_COVERAGE_DEFAULT_DAYS);

    return {
      startDate: startDate.toISOString().split('T')[0] ?? '',
      endDate: endDate.toISOString().split('T')[0] ?? '',
    };
  }

  /**
   * Apply default date range if not provided in filters.
   */
  private applyDefaultFilters(filters: PRCoverageFilters): PRCoverageFilters {
    const effectiveFilters = { ...filters };
    if (!effectiveFilters.startDate || !effectiveFilters.endDate) {
      const defaultRange = this.getDefaultDateRange();
      effectiveFilters.startDate = effectiveFilters.startDate ?? defaultRange.startDate;
      effectiveFilters.endDate = effectiveFilters.endDate ?? defaultRange.endDate;
      this.logger.debug(
        CLASS_NAME,
        'applyDefaultFilters',
        `Applied default date range: ${effectiveFilters.startDate} to ${effectiveFilters.endDate}`,
      );
    }
    return effectiveFilters;
  }

  /**
   * Fetch overall PR coverage metrics.
   *
   * @param filters - Optional date range filters
   * @returns Overall coverage metrics
   */
  async getOverallCoverage(filters: PRCoverageFilters = {}): Promise<PRCoverageOverall> {
    this.logger.debug(
      CLASS_NAME,
      'getOverallCoverage',
      `Fetching overall coverage: filters=${JSON.stringify(filters)}`,
    );

    this.validateDateFilters(filters);
    const effectiveFilters = this.applyDefaultFilters(filters);

    let result;
    if (effectiveFilters.startDate && effectiveFilters.endDate) {
      result = await this.db.query<PRCoverageOverallRow>(
        QUERY_PR_COVERAGE_OVERALL_DATE_RANGE,
        [effectiveFilters.startDate, effectiveFilters.endDate],
      );
    } else {
      result = await this.db.query<PRCoverageOverallRow>(QUERY_PR_COVERAGE_OVERALL);
    }

    const row = result.rows[0];
    if (!row) {
      this.logger.debug(CLASS_NAME, 'getOverallCoverage', 'No coverage data found');
      return {
        totalCommits: 0,
        prLinkedCommits: 0,
        orphanCommits: 0,
        mergeCommits: 0,
        repositoriesAnalyzed: 0,
        coveragePercentage: 0,
      };
    }

    this.logger.info(
      CLASS_NAME,
      'getOverallCoverage',
      `Coverage: ${row.coverage_percentage}% (${row.pr_linked_commits}/${row.total_commits} commits)`,
    );

    return {
      totalCommits: Number(row.total_commits),
      prLinkedCommits: Number(row.pr_linked_commits),
      orphanCommits: Number(row.orphan_commits),
      mergeCommits: Number(row.merge_commits),
      repositoriesAnalyzed: Number(row.repositories_analyzed),
      coveragePercentage: Number(row.coverage_percentage),
    };
  }

  /**
   * Fetch orphan commits (commits without PRs).
   *
   * @param filters - Date range, repository, author, and branch filters
   * @returns Array of orphan commits
   */
  async getOrphanCommits(filters: PRCoverageFilters = {}): Promise<readonly OrphanCommit[]> {
    this.logger.debug(
      CLASS_NAME,
      'getOrphanCommits',
      `Fetching orphan commits: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.author, 'author');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<OrphanCommitRow>(
      QUERY_ORPHAN_COMMITS,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
        effectiveFilters.author ?? null,
        effectiveFilters.branches && effectiveFilters.branches.length > 0
          ? effectiveFilters.branches
          : null,
      ],
    );

    this.logger.debug(
      CLASS_NAME,
      'getOrphanCommits',
      `Found ${result.rows.length} orphan commits`,
    );

    return result.rows.map((row) => this.mapOrphanCommitRow(row));
  }

  /**
   * Map database row to OrphanCommit interface.
   */
  private mapOrphanCommitRow(row: OrphanCommitRow): OrphanCommit {
    return {
      sha: row.sha,
      repository: row.repository,
      branch: row.branch,
      author: row.author,
      commitDate: row.commit_date instanceof Date
        ? row.commit_date.toISOString()
        : String(row.commit_date),
      commitMessage: row.commit_message,
      linesAdded: Number(row.lines_added ?? 0),
      linesRemoved: Number(row.lines_removed ?? 0),
      fileCount: Number(row.file_count ?? 0),
      organization: row.organization,
    };
  }

  /**
   * Fetch coverage breakdown by branch.
   *
   * @param filters - Date range and repository filters
   * @returns Array of coverage metrics per branch
   */
  async getCoverageByBranch(filters: PRCoverageFilters = {}): Promise<readonly CoverageByBranch[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCoverageByBranch',
      `Fetching coverage by branch: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<CoverageByBranchRow>(
      QUERY_PR_COVERAGE_BY_BRANCH,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
      ],
    );

    this.logger.debug(
      CLASS_NAME,
      'getCoverageByBranch',
      `Found ${result.rows.length} branches`,
    );

    return result.rows.map((row) => ({
      repository: row.repository,
      branch: row.branch,
      totalCommits: Number(row.total_commits),
      prLinkedCommits: Number(row.pr_linked_commits),
      orphanCommits: Number(row.orphan_commits),
      coveragePercentage: Number(row.coverage_percentage),
    }));
  }

  /**
   * Fetch coverage breakdown by author.
   *
   * @param filters - Date range and repository filters
   * @returns Array of coverage metrics per author
   */
  async getCoverageByAuthor(filters: PRCoverageFilters = {}): Promise<readonly CoverageByAuthor[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCoverageByAuthor',
      `Fetching coverage by author: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<CoverageByAuthorRow>(
      QUERY_PR_COVERAGE_BY_AUTHOR,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
      ],
    );

    this.logger.debug(
      CLASS_NAME,
      'getCoverageByAuthor',
      `Found ${result.rows.length} authors`,
    );

    return result.rows.map((row) => ({
      repository: row.repository,
      author: row.author,
      totalCommits: Number(row.total_commits),
      prLinkedCommits: Number(row.pr_linked_commits),
      orphanCommits: Number(row.orphan_commits),
      coveragePercentage: Number(row.coverage_percentage),
    }));
  }

  /**
   * Fetch coverage breakdown by contributor (full_name).
   *
   * @param filters - Date range and repository filters
   * @returns Array of coverage metrics per contributor
   */
  async getCoverageByContributor(filters: PRCoverageFilters = {}): Promise<readonly CoverageByContributor[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCoverageByContributor',
      `Fetching coverage by contributor: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<CoverageByContributorRow>(
      QUERY_PR_COVERAGE_BY_CONTRIBUTOR,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
      ],
    );

    this.logger.debug(
      CLASS_NAME,
      'getCoverageByContributor',
      `Found ${result.rows.length} contributors`,
    );

    return result.rows.map((row) => ({
      repository: row.repository,
      contributorName: row.contributor_name,
      login: row.login,
      totalCommits: Number(row.total_commits),
      prLinkedCommits: Number(row.pr_linked_commits),
      orphanCommits: Number(row.orphan_commits),
      coveragePercentage: Number(row.coverage_percentage),
    }));
  }

  /**
   * Fetch coverage breakdown by team.
   *
   * @param filters - Date range and repository filters
   * @returns Array of coverage metrics per team
   */
  async getCoverageByTeam(filters: PRCoverageFilters = {}): Promise<readonly CoverageByTeam[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCoverageByTeam',
      `Fetching coverage by team: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<CoverageByTeamRow>(
      QUERY_PR_COVERAGE_BY_TEAM,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
      ],
    );

    this.logger.debug(
      CLASS_NAME,
      'getCoverageByTeam',
      `Found ${result.rows.length} teams`,
    );

    return result.rows.map((row) => ({
      repository: row.repository,
      teamName: row.team_name,
      contributorCount: Number(row.contributor_count),
      totalCommits: Number(row.total_commits),
      prLinkedCommits: Number(row.pr_linked_commits),
      orphanCommits: Number(row.orphan_commits),
      coveragePercentage: Number(row.coverage_percentage),
    }));
  }

  /**
   * Fetch weekly coverage trend.
   *
   * @param filters - Date range and repository filters
   * @returns Array of weekly trend data points
   */
  async getWeeklyTrend(filters: PRCoverageFilters = {}): Promise<readonly WeeklyTrendPoint[]> {
    this.logger.debug(
      CLASS_NAME,
      'getWeeklyTrend',
      `Fetching weekly trend: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<WeeklyTrendRow>(
      QUERY_PR_COVERAGE_WEEKLY_TREND,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
      ],
    );

    this.logger.debug(
      CLASS_NAME,
      'getWeeklyTrend',
      `Found ${result.rows.length} weeks of data`,
    );

    return result.rows.map((row) => ({
      weekStart: row.week_start instanceof Date
        ? row.week_start.toISOString().split('T')[0] ?? ''
        : String(row.week_start),
      totalCommits: Number(row.total_commits),
      prLinkedCommits: Number(row.pr_linked_commits),
      orphanCommits: Number(row.orphan_commits),
      coveragePercentage: Number(row.coverage_percentage),
    }));
  }

  /**
   * Fetch available filter options from database.
   *
   * @param repository - Optional repository to filter authors/branches/contributors
   * @returns Lists of available repositories, authors, contributors, and branches
   */
  async getFilterOptions(repository?: string): Promise<PRCoverageFilterOptions> {
    this.logger.debug(
      CLASS_NAME,
      'getFilterOptions',
      `Fetching filter options: repository=${repository ?? 'all'}`,
    );

    this.validateStringFilter(repository, 'repository');

    const [repoResult, authorResult, contributorResult, branchResult] = await Promise.all([
      this.db.query<RepositoryRow>(QUERY_PR_COVERAGE_REPOSITORIES),
      this.db.query<AuthorRow>(QUERY_PR_COVERAGE_AUTHORS, [repository ?? null]),
      this.db.query<ContributorRow>(QUERY_PR_COVERAGE_CONTRIBUTORS, [repository ?? null]),
      this.db.query<BranchRow>(QUERY_PR_COVERAGE_BRANCHES, [repository ?? null]),
    ]);

    const options: PRCoverageFilterOptions = {
      repositories: repoResult.rows.map((r) => r.repository),
      authors: authorResult.rows.map((a) => a.author),
      contributors: contributorResult.rows.map((c) => c.contributor_display),
      branches: branchResult.rows.map((b) => b.branch),
    };

    this.logger.debug(
      CLASS_NAME,
      'getFilterOptions',
      `Found ${options.repositories.length} repos, ${options.authors.length} authors, ${options.contributors.length} contributors, ${options.branches.length} branches`,
    );

    return options;
  }

  /**
   * Get complete chart data including all metrics.
   *
   * @param filters - Date range, repository, author filters
   * @returns Complete PR coverage chart data
   */
  async getChartData(filters: PRCoverageFilters = {}): Promise<PRCoverageChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getChartData',
      `Fetching chart data: filters=${JSON.stringify(filters)}`,
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getChartData',
        'vw_pr_coverage view not found -- returning empty data',
      );
      return {
        overall: {
          totalCommits: 0,
          prLinkedCommits: 0,
          orphanCommits: 0,
          mergeCommits: 0,
          repositoriesAnalyzed: 0,
          coveragePercentage: 0,
        },
        weeklyTrend: [],
        byAuthor: [],
        byBranch: [],
        byContributor: [],
        byTeam: [],
        orphanCommits: [],
        hasData: false,
        viewExists: false,
      };
    }

    // Fetch all data in parallel for performance
    const [overall, weeklyTrend, byAuthor, byBranch, byContributor, byTeam, orphanCommits] = await Promise.all([
      this.getOverallCoverage(filters),
      this.getWeeklyTrend(filters),
      this.getCoverageByAuthor(filters),
      this.getCoverageByBranch(filters),
      this.getCoverageByContributor(filters),
      this.getCoverageByTeam(filters),
      this.getOrphanCommits(filters),
    ]);

    const hasData = overall.totalCommits > 0;

    this.logger.info(
      CLASS_NAME,
      'getChartData',
      `Chart data ready: ${overall.totalCommits} commits, ${overall.coveragePercentage}% coverage`,
    );

    return {
      overall,
      weeklyTrend,
      byAuthor,
      byBranch,
      byContributor,
      byTeam,
      orphanCommits,
      hasData,
      viewExists: true,
    };
  }

  /**
   * Sync commit-PR links using merge_sha correlation.
   * Creates links in commit_pull_request for all commits that match
   * a PR's merge_sha.
   *
   * @returns Number of links created
   */
  async syncCoverageFromMergeSha(): Promise<number> {
    this.logger.debug(CLASS_NAME, 'syncCoverageFromMergeSha', 'Syncing coverage from merge_sha');

    const result = await this.db.query(QUERY_SYNC_PR_COVERAGE_FROM_MERGE_SHA);
    const linksCreated = result.rowCount ?? 0;

    this.logger.info(
      CLASS_NAME,
      'syncCoverageFromMergeSha',
      `Created ${linksCreated} commit-PR links from merge_sha correlation`,
    );

    return linksCreated;
  }
}
