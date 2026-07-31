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
  QUERY_PR_TABLE_COUNT,
  QUERY_PR_COVERAGE_OVERALL,
  QUERY_PR_COVERAGE_OVERALL_DATE_RANGE,
  QUERY_ORPHAN_COMMITS,
  QUERY_ORPHAN_CATEGORY_BREAKDOWN,
  QUERY_PR_COVERAGE_BY_BRANCH,
  QUERY_PR_COVERAGE_BY_AUTHOR,
  QUERY_PR_COVERAGE_BY_CONTRIBUTOR,
  QUERY_PR_COVERAGE_BY_TEAM,
  QUERY_PR_COVERAGE_WEEKLY_TREND,
  QUERY_PR_COVERAGE_REPOSITORIES,
  QUERY_PR_COVERAGE_AUTHORS,
  QUERY_PR_COVERAGE_CONTRIBUTORS,
  QUERY_PR_COVERAGE_BRANCHES,
  QUERY_PR_COVERAGE_TEAMS,
  QUERY_SYNC_PR_COVERAGE_FROM_MERGE_SHA,
  type ViewExistsRow,
  type PRTableCountRow,
  type PRCoverageOverallRow,
  type OrphanCommitRow,
  type OrphanCategoryBreakdownRow,
  type CoverageByBranchRow,
  type CoverageByAuthorRow,
  type CoverageByContributorRow,
  type CoverageByTeamRow,
  type WeeklyTrendRow,
  type RepositoryRow,
  type AuthorRow,
  type ContributorRow,
  type BranchRow,
  type TeamRow,
} from '../database/queries/pr-coverage-queries.js';
import {
  PR_COVERAGE_MAX_FILTER_LENGTH,
  PR_COVERAGE_MAX_ARRAY_LENGTH,
  PR_COVERAGE_DEFAULT_DAYS,
  isValidOrphanCategory,
  type PRCoverageOverall,
  type OrphanCommit,
  type OrphanCategoryBreakdown,
  type OrphanCategory,
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
   * Check if the pull_request table has any data.
   * Used to detect the 0.0% coverage bug when PRs haven't been synced.
   *
   * @returns true if the table has at least one row
   */
  async checkPRTableHasData(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkPRTableHasData', 'Checking pull_request table for data');

    const result = await this.db.query<PRTableCountRow>(QUERY_PR_TABLE_COUNT);
    const count = Number(result.rows[0]?.pr_count ?? 0);
    const hasData = count > 0;

    this.logger.debug(CLASS_NAME, 'checkPRTableHasData', `pull_request table has ${count} rows: ${hasData}`);
    return hasData;
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
   * Validate string array filter inputs (teams, branches).
   * Enforces maximum array length and per-element string length to prevent DoS attacks (CWE-20, CWE-770).
   *
   * @param values - Array of string values to validate
   * @param fieldName - Name of the field for error message
   * @throws Error if array size or any value exceeds maximum length
   */
  private validateStringArrayFilter(values: readonly string[] | undefined, fieldName: string): void {
    if (values) {
      if (values.length > PR_COVERAGE_MAX_ARRAY_LENGTH) {
        this.logger.warn(
          CLASS_NAME,
          'validateStringArrayFilter',
          `${fieldName} array exceeds max length: ${values.length} > ${PR_COVERAGE_MAX_ARRAY_LENGTH}`,
        );
        throw new Error(
          `${fieldName} array exceeds maximum length of ${PR_COVERAGE_MAX_ARRAY_LENGTH} items`,
        );
      }
      for (const value of values) {
        if (value.length > PR_COVERAGE_MAX_FILTER_LENGTH) {
          this.logger.warn(
            CLASS_NAME,
            'validateStringArrayFilter',
            `${fieldName} item exceeds max length: ${value.length} > ${PR_COVERAGE_MAX_FILTER_LENGTH}`,
          );
          throw new Error(
            `${fieldName} item exceeds maximum length of ${PR_COVERAGE_MAX_FILTER_LENGTH} characters`,
          );
        }
      }
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
   * @param filters - Date range, repository, author, branch, team, and category filters
   * @param orphanCategory - Optional filter by specific orphan category (GITX-227)
   * @returns Array of orphan commits
   */
  async getOrphanCommits(
    filters: PRCoverageFilters = {},
    orphanCategory?: OrphanCategory,
  ): Promise<readonly OrphanCommit[]> {
    this.logger.debug(
      CLASS_NAME,
      'getOrphanCommits',
      `Fetching orphan commits: filters=${JSON.stringify(filters)}, category=${orphanCategory ?? 'all'}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringFilter(filters.author, 'author');
    this.validateStringArrayFilter(filters.branches, 'branches');
    this.validateStringArrayFilter(filters.teams, 'teams');
    this.validateDateFilters(filters);

    // Validate orphan category if provided (CWE-20)
    if (orphanCategory !== undefined && !isValidOrphanCategory(orphanCategory)) {
      this.logger.warn(CLASS_NAME, 'getOrphanCommits', `Invalid orphan category rejected: ${orphanCategory}`);
      throw new Error(`Invalid orphan category: ${orphanCategory}`);
    }

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
        effectiveFilters.teams && effectiveFilters.teams.length > 0
          ? effectiveFilters.teams
          : null,
        orphanCategory ?? null,
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
   * Fetch orphan category breakdown.
   * Provides counts and percentages for each orphan category (GITX-227).
   *
   * @param filters - Date range, repository, and team filters
   * @returns Orphan category breakdown with counts and direct push percentage
   */
  async getOrphanBreakdown(filters: PRCoverageFilters = {}): Promise<OrphanCategoryBreakdown> {
    this.logger.debug(
      CLASS_NAME,
      'getOrphanBreakdown',
      `Fetching orphan breakdown: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringArrayFilter(filters.teams, 'teams');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<OrphanCategoryBreakdownRow>(
      QUERY_ORPHAN_CATEGORY_BREAKDOWN,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
        effectiveFilters.teams && effectiveFilters.teams.length > 0
          ? effectiveFilters.teams
          : null,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      this.logger.debug(CLASS_NAME, 'getOrphanBreakdown', 'No orphan breakdown data found');
      return {
        preMergeOnPrBranch: 0,
        directToProtected: 0,
        unlinkedFeatureBranch: 0,
        totalOrphans: 0,
        directPushPercentage: 0,
      };
    }

    const breakdown: OrphanCategoryBreakdown = {
      preMergeOnPrBranch: Number(row.pre_merge_on_pr_branch_count),
      directToProtected: Number(row.direct_to_protected_count),
      unlinkedFeatureBranch: Number(row.unlinked_feature_branch_count),
      totalOrphans: Number(row.total_orphans),
      directPushPercentage: Number(row.direct_push_percentage),
    };

    this.logger.info(
      CLASS_NAME,
      'getOrphanBreakdown',
      `Orphan breakdown: pre-merge=${breakdown.preMergeOnPrBranch}, ` +
      `direct=${breakdown.directToProtected} (${breakdown.directPushPercentage}%), ` +
      `unlinked=${breakdown.unlinkedFeatureBranch}`,
    );

    return breakdown;
  }

  /**
   * Map database row to OrphanCommit interface.
   */
  private mapOrphanCommitRow(row: OrphanCommitRow): OrphanCommit {
    // Validate and map orphan_category (GITX-227)
    let orphanCategory: OrphanCategory | null = null;
    if (row.orphan_category) {
      if (isValidOrphanCategory(row.orphan_category)) {
        orphanCategory = row.orphan_category;
      } else {
        this.logger.warn(
          CLASS_NAME,
          'mapOrphanCommitRow',
          `Invalid orphan_category in database: ${row.orphan_category} for SHA ${row.sha}`,
        );
      }
    }

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
      orphanCategory,
    };
  }

  /**
   * Fetch coverage breakdown by branch.
   *
   * @param filters - Date range, repository, and team filters
   * @returns Array of coverage metrics per branch
   */
  async getCoverageByBranch(filters: PRCoverageFilters = {}): Promise<readonly CoverageByBranch[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCoverageByBranch',
      `Fetching coverage by branch: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringArrayFilter(filters.teams, 'teams');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<CoverageByBranchRow>(
      QUERY_PR_COVERAGE_BY_BRANCH,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
        effectiveFilters.teams && effectiveFilters.teams.length > 0
          ? effectiveFilters.teams
          : null,
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
   * @param filters - Date range, repository, and team filters
   * @returns Array of coverage metrics per author
   */
  async getCoverageByAuthor(filters: PRCoverageFilters = {}): Promise<readonly CoverageByAuthor[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCoverageByAuthor',
      `Fetching coverage by author: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringArrayFilter(filters.teams, 'teams');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<CoverageByAuthorRow>(
      QUERY_PR_COVERAGE_BY_AUTHOR,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
        effectiveFilters.teams && effectiveFilters.teams.length > 0
          ? effectiveFilters.teams
          : null,
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
   * @param filters - Date range, repository, and team filters
   * @returns Array of coverage metrics per contributor
   */
  async getCoverageByContributor(filters: PRCoverageFilters = {}): Promise<readonly CoverageByContributor[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCoverageByContributor',
      `Fetching coverage by contributor: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringArrayFilter(filters.teams, 'teams');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<CoverageByContributorRow>(
      QUERY_PR_COVERAGE_BY_CONTRIBUTOR,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
        effectiveFilters.teams && effectiveFilters.teams.length > 0
          ? effectiveFilters.teams
          : null,
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
   * @param filters - Date range, repository, and team filters
   * @returns Array of coverage metrics per team
   */
  async getCoverageByTeam(filters: PRCoverageFilters = {}): Promise<readonly CoverageByTeam[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCoverageByTeam',
      `Fetching coverage by team: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringArrayFilter(filters.teams, 'teams');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<CoverageByTeamRow>(
      QUERY_PR_COVERAGE_BY_TEAM,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
        effectiveFilters.teams && effectiveFilters.teams.length > 0
          ? effectiveFilters.teams
          : null,
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
   * @param filters - Date range, repository, and team filters
   * @returns Array of weekly trend data points
   */
  async getWeeklyTrend(filters: PRCoverageFilters = {}): Promise<readonly WeeklyTrendPoint[]> {
    this.logger.debug(
      CLASS_NAME,
      'getWeeklyTrend',
      `Fetching weekly trend: filters=${JSON.stringify(filters)}`,
    );

    this.validateStringFilter(filters.repository, 'repository');
    this.validateStringArrayFilter(filters.teams, 'teams');
    this.validateDateFilters(filters);

    const effectiveFilters = this.applyDefaultFilters(filters);

    const result = await this.db.query<WeeklyTrendRow>(
      QUERY_PR_COVERAGE_WEEKLY_TREND,
      [
        effectiveFilters.startDate,
        effectiveFilters.endDate,
        effectiveFilters.repository ?? null,
        effectiveFilters.teams && effectiveFilters.teams.length > 0
          ? effectiveFilters.teams
          : null,
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
   * Fetch available teams from database.
   *
   * @param repository - Optional repository to scope teams
   * @returns Array of team names
   */
  async getTeams(repository?: string): Promise<readonly string[]> {
    this.logger.debug(
      CLASS_NAME,
      'getTeams',
      `Fetching teams: repository=${repository ?? 'all'}`,
    );

    this.validateStringFilter(repository, 'repository');

    const result = await this.db.query<TeamRow>(QUERY_PR_COVERAGE_TEAMS, [repository ?? null]);
    const teams = result.rows.map((r) => r.team_name);

    this.logger.debug(CLASS_NAME, 'getTeams', `Found ${teams.length} teams`);

    return teams;
  }

  /**
   * Fetch available filter options from database.
   *
   * @param repository - Optional repository to filter authors/branches/contributors/teams
   * @returns Lists of available repositories, authors, contributors, branches, and teams
   */
  async getFilterOptions(repository?: string): Promise<PRCoverageFilterOptions> {
    this.logger.debug(
      CLASS_NAME,
      'getFilterOptions',
      `Fetching filter options: repository=${repository ?? 'all'}`,
    );

    this.validateStringFilter(repository, 'repository');

    const [repoResult, authorResult, contributorResult, branchResult, teams] = await Promise.all([
      this.db.query<RepositoryRow>(QUERY_PR_COVERAGE_REPOSITORIES),
      this.db.query<AuthorRow>(QUERY_PR_COVERAGE_AUTHORS, [repository ?? null]),
      this.db.query<ContributorRow>(QUERY_PR_COVERAGE_CONTRIBUTORS, [repository ?? null]),
      this.db.query<BranchRow>(QUERY_PR_COVERAGE_BRANCHES, [repository ?? null]),
      this.getTeams(repository),
    ]);

    const options: PRCoverageFilterOptions = {
      repositories: repoResult.rows.map((r) => r.repository),
      authors: authorResult.rows.map((a) => a.author),
      contributors: contributorResult.rows.map((c) => c.contributor_display),
      branches: branchResult.rows.map((b) => b.branch),
      teams,
    };

    this.logger.debug(
      CLASS_NAME,
      'getFilterOptions',
      `Found ${options.repositories.length} repos, ${options.authors.length} authors, ${options.contributors.length} contributors, ${options.branches.length} branches, ${options.teams.length} teams`,
    );

    return options;
  }

  /**
   * Get complete chart data including all metrics.
   *
   * @param filters - Date range, repository, author, and team filters
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
        orphanBreakdown: {
          preMergeOnPrBranch: 0,
          directToProtected: 0,
          unlinkedFeatureBranch: 0,
          totalOrphans: 0,
          directPushPercentage: 0,
        },
        hasData: false,
        viewExists: false,
        hasPRData: false,
      };
    }

    // Check if pull_request table has data
    const hasPRData = await this.checkPRTableHasData();
    this.logger.debug(CLASS_NAME, 'getChartData', `pull_request table has data: ${hasPRData}`);

    // Fetch all data in parallel for performance (including orphan breakdown - GITX-227)
    const [overall, weeklyTrend, byAuthor, byBranch, byContributor, byTeam, orphanCommits, orphanBreakdown] = await Promise.all([
      this.getOverallCoverage(filters),
      this.getWeeklyTrend(filters),
      this.getCoverageByAuthor(filters),
      this.getCoverageByBranch(filters),
      this.getCoverageByContributor(filters),
      this.getCoverageByTeam(filters),
      this.getOrphanCommits(filters),
      this.getOrphanBreakdown(filters),
    ]);

    const hasData = overall.totalCommits > 0;

    this.logger.info(
      CLASS_NAME,
      'getChartData',
      `Chart data ready: ${overall.totalCommits} commits, ${overall.coveragePercentage}% coverage, ` +
      `directPush=${orphanBreakdown.directPushPercentage}%, hasPRData=${hasPRData}`,
    );

    return {
      overall,
      weeklyTrend,
      byAuthor,
      byBranch,
      byContributor,
      byTeam,
      orphanCommits,
      orphanBreakdown,
      hasData,
      viewExists: true,
      hasPRData,
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
