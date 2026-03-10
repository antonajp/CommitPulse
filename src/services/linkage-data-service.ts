/**
 * Linkage data service for querying commit-Jira relationship analytics.
 * Provides methods to fetch data for the Commit-Jira Linkage webview:
 * - Linked vs unlinked commit summary (from commit_history.is_jira_ref)
 * - Jira project distribution (from commit_jira.jira_project)
 * - Jira status flow timeline (from vw_jira_history_detail)
 * - Assignment history (from vw_jira_history_assignments)
 * - Unlinked commit drill-down (from commit_history + commit_jira)
 * - Filter options (teams, repos, Jira projects)
 *
 * All queries use parameterized SQL ($1, $2 placeholders).
 *
 * Ticket: IQS-870
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import type {
  LinkageSummary,
  JiraProjectDistribution,
  JiraStatusFlowPoint,
  AssignmentHistoryEntry,
  UnlinkedCommitEntry,
  LinkageFilters,
  LinkageFilterOptions,
} from './linkage-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'LinkageDataService';

/**
 * Default limit for unlinked commit drill-down results.
 */
const DEFAULT_UNLINKED_LIMIT = 200;

/**
 * Service responsible for querying database views and tables,
 * returning typed data for the Commit-Jira Linkage webview panels.
 *
 * Ticket: IQS-870
 */
export class LinkageDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'LinkageDataService created');
  }

  // ==========================================================================
  // Linkage Summary
  // ==========================================================================

  /**
   * Fetch linked vs unlinked commit summary.
   * Queries commit_history using is_jira_ref or is_linear_ref based on trackerType.
   *
   * @param filters - Optional date range, team, repo, and project filters
   * @returns LinkageSummary with counts and percentages
   */
  async getLinkageSummary(filters: LinkageFilters = {}): Promise<LinkageSummary> {
    this.logger.debug(CLASS_NAME, 'getLinkageSummary', `Fetching linkage summary: filters=${JSON.stringify(filters)}`);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.startDate) {
      conditions.push(`ch.commit_date >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`ch.commit_date <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.repository) {
      conditions.push(`ch.repository = $${paramIndex}`);
      params.push(filters.repository);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Use is_linear_ref when trackerType is 'linear', otherwise default to is_jira_ref (IQS-876)
    const refColumn = filters.trackerType === 'linear' ? 'ch.is_linear_ref' : 'ch.is_jira_ref';

    const sql = `
      SELECT
        COUNT(*)::INTEGER AS total_commits,
        COUNT(*) FILTER (WHERE ${refColumn} = true)::INTEGER AS linked_commits,
        COUNT(*) FILTER (WHERE ${refColumn} = false OR ${refColumn} IS NULL)::INTEGER AS unlinked_commits
      FROM commit_history ch
      ${whereClause}
    `;

    this.logger.trace(CLASS_NAME, 'getLinkageSummary', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getLinkageSummary', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      total_commits: number;
      linked_commits: number;
      unlinked_commits: number;
    }>(sql, params);

    const row = result.rows[0];
    if (!row || row.total_commits === 0) {
      this.logger.debug(CLASS_NAME, 'getLinkageSummary', 'No commits found for given filters');
      return {
        totalCommits: 0,
        linkedCommits: 0,
        unlinkedCommits: 0,
        linkedPercent: 0,
        unlinkedPercent: 0,
      };
    }

    const total = row.total_commits;
    const linked = row.linked_commits;
    const unlinked = row.unlinked_commits;
    const linkedPct = total > 0 ? Math.round((linked / total) * 10000) / 100 : 0;
    const unlinkedPct = total > 0 ? Math.round((unlinked / total) * 10000) / 100 : 0;

    this.logger.debug(CLASS_NAME, 'getLinkageSummary', `Summary: total=${total}, linked=${linked} (${linkedPct}%), unlinked=${unlinked} (${unlinkedPct}%)`);

    return {
      totalCommits: total,
      linkedCommits: linked,
      unlinkedCommits: unlinked,
      linkedPercent: linkedPct,
      unlinkedPercent: unlinkedPct,
    };
  }

  // ==========================================================================
  // Jira Project Distribution
  // ==========================================================================

  /**
   * Fetch commit distribution across projects.
   * Queries commit_jira or commit_linear table based on trackerType.
   *
   * @param filters - Optional date range and repo filters
   * @returns Array of JiraProjectDistribution sorted by commit count descending
   */
  async getJiraProjectDistribution(filters: LinkageFilters = {}): Promise<JiraProjectDistribution[]> {
    this.logger.debug(CLASS_NAME, 'getJiraProjectDistribution', `Fetching project distribution: filters=${JSON.stringify(filters)}`);

    const isLinear = filters.trackerType === 'linear';
    const linkTable = isLinear ? 'commit_linear' : 'commit_jira';
    const projectColumn = isLinear ? 'linear_project' : 'jira_project';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.startDate) {
      conditions.push(`ch.commit_date >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`ch.commit_date <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.repository) {
      conditions.push(`ch.repository = $${paramIndex}`);
      params.push(filters.repository);
      paramIndex++;
    }
    if (filters.jiraProject) {
      conditions.push(`cj.${projectColumn} = $${paramIndex}`);
      params.push(filters.jiraProject);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        cj.${projectColumn} AS jira_project,
        COUNT(DISTINCT cj.sha)::INTEGER AS commit_count
      FROM ${linkTable} cj
      JOIN commit_history ch ON cj.sha = ch.sha
      ${whereClause}
      GROUP BY cj.${projectColumn}
      ORDER BY commit_count DESC
    `;

    this.logger.trace(CLASS_NAME, 'getJiraProjectDistribution', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getJiraProjectDistribution', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      jira_project: string;
      commit_count: number;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getJiraProjectDistribution', `Returned ${result.rowCount} project distributions`);

    return result.rows.map((row) => ({
      jiraProject: row.jira_project,
      commitCount: row.commit_count,
    }));
  }

  // ==========================================================================
  // Jira Status Flow
  // ==========================================================================

  /**
   * Fetch Jira status flow timeline from vw_jira_history_detail.
   * Shows status transitions (e.g., in_dev, in_qa) over time.
   *
   * @param filters - Optional date range and Jira project filters
   * @returns Array of JiraStatusFlowPoint sorted by date ascending
   */
  async getJiraStatusFlow(filters: LinkageFilters = {}): Promise<JiraStatusFlowPoint[]> {
    this.logger.debug(CLASS_NAME, 'getJiraStatusFlow', `Fetching status flow: filters=${JSON.stringify(filters)}`);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.startDate) {
      conditions.push(`vjhd.change_date >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`vjhd.change_date <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.jiraProject) {
      conditions.push(`vjhd.jira_project = $${paramIndex}`);
      params.push(filters.jiraProject);
      paramIndex++;
    }

    // Only include status-type changes
    conditions.push(`vjhd.field = 'status'`);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        vjhd.change_date::DATE AS change_date,
        vjhd.to_value AS to_status,
        COUNT(DISTINCT vjhd.jira_key)::INTEGER AS issue_count
      FROM vw_jira_history_detail vjhd
      ${whereClause}
      GROUP BY vjhd.change_date::DATE, vjhd.to_value
      ORDER BY change_date ASC, to_status ASC
    `;

    this.logger.trace(CLASS_NAME, 'getJiraStatusFlow', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getJiraStatusFlow', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      change_date: Date;
      to_status: string;
      issue_count: number;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getJiraStatusFlow', `Returned ${result.rowCount} status flow data points`);

    return result.rows.map((row) => ({
      changeDate: row.change_date instanceof Date ? row.change_date.toISOString().split('T')[0] ?? '' : String(row.change_date),
      toStatus: row.to_status,
      issueCount: row.issue_count,
    }));
  }

  // ==========================================================================
  // Assignment History
  // ==========================================================================

  /**
   * Fetch Jira assignment history from vw_jira_history_assignments.
   * Shows who was assigned to issues and when assignments changed.
   *
   * @param filters - Optional date range and Jira project filters
   * @returns Array of AssignmentHistoryEntry sorted by date descending
   */
  async getAssignmentHistory(filters: LinkageFilters = {}): Promise<AssignmentHistoryEntry[]> {
    this.logger.debug(CLASS_NAME, 'getAssignmentHistory', `Fetching assignment history: filters=${JSON.stringify(filters)}`);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.startDate) {
      conditions.push(`vjha.change_date >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`vjha.change_date <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.jiraProject) {
      conditions.push(`vjha.jira_project = $${paramIndex}`);
      params.push(filters.jiraProject);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        vjha.jira_key,
        vjha.change_date::DATE AS change_date,
        COALESCE(vjha.to_value, '') AS assigned_to,
        COALESCE(vjha.from_value, '') AS assigned_from
      FROM vw_jira_history_assignments vjha
      ${whereClause}
      ORDER BY vjha.change_date DESC, vjha.jira_key ASC
      LIMIT 500
    `;

    this.logger.trace(CLASS_NAME, 'getAssignmentHistory', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getAssignmentHistory', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      jira_key: string;
      change_date: Date;
      assigned_to: string;
      assigned_from: string;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getAssignmentHistory', `Returned ${result.rowCount} assignment history entries`);

    return result.rows.map((row) => ({
      jiraKey: row.jira_key,
      changeDate: row.change_date instanceof Date ? row.change_date.toISOString().split('T')[0] ?? '' : String(row.change_date),
      assignedTo: row.assigned_to,
      assignedFrom: row.assigned_from,
    }));
  }

  // ==========================================================================
  // Unlinked Commits Drill-Down
  // ==========================================================================

  /**
   * Fetch unlinked commits for drill-down display.
   * Returns commits that have no Jira reference (is_jira_ref = false or NULL).
   *
   * @param filters - Optional date range, repo, and team filters
   * @param limit - Maximum number of results to return (default: 200)
   * @returns Array of UnlinkedCommitEntry sorted by date descending
   */
  async getUnlinkedCommits(
    filters: LinkageFilters = {},
    limit: number = DEFAULT_UNLINKED_LIMIT,
  ): Promise<UnlinkedCommitEntry[]> {
    this.logger.debug(CLASS_NAME, 'getUnlinkedCommits', `Fetching unlinked commits: filters=${JSON.stringify(filters)}, limit=${limit}`);

    // Use is_linear_ref when trackerType is 'linear' (IQS-876)
    const refColumn = filters.trackerType === 'linear' ? 'ch.is_linear_ref' : 'ch.is_jira_ref';
    const conditions: string[] = [`(${refColumn} = false OR ${refColumn} IS NULL)`];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.startDate) {
      conditions.push(`ch.commit_date >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`ch.commit_date <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.repository) {
      conditions.push(`ch.repository = $${paramIndex}`);
      params.push(filters.repository);
      paramIndex++;
    }

    params.push(limit);
    const limitParam = `$${paramIndex}`;

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const sql = `
      SELECT
        SUBSTRING(ch.sha, 1, 8) AS sha,
        ch.author,
        ch.commit_message,
        ch.commit_date::DATE AS commit_date,
        ch.repository
      FROM commit_history ch
      ${whereClause}
      ORDER BY ch.commit_date DESC
      LIMIT ${limitParam}
    `;

    this.logger.trace(CLASS_NAME, 'getUnlinkedCommits', `SQL: ${sql.trim()}`);
    this.logger.trace(CLASS_NAME, 'getUnlinkedCommits', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<{
      sha: string;
      author: string;
      commit_message: string;
      commit_date: Date;
      repository: string;
    }>(sql, params);

    this.logger.debug(CLASS_NAME, 'getUnlinkedCommits', `Returned ${result.rowCount} unlinked commits`);

    return result.rows.map((row) => ({
      sha: row.sha,
      author: row.author,
      commitMessage: row.commit_message,
      commitDate: row.commit_date instanceof Date ? row.commit_date.toISOString().split('T')[0] ?? '' : String(row.commit_date),
      repository: row.repository,
    }));
  }

  // ==========================================================================
  // Filter Options
  // ==========================================================================

  /**
   * Fetch available filter options for the linkage webview.
   * Returns teams, repositories, and Jira project keys.
   *
   * @returns LinkageFilterOptions with available filter values
   */
  async getFilterOptions(): Promise<LinkageFilterOptions> {
    this.logger.debug(CLASS_NAME, 'getFilterOptions', 'Fetching linkage filter options');

    // Fetch distinct teams
    const teamsSql = `
      SELECT DISTINCT team
      FROM commit_contributors
      WHERE team IS NOT NULL AND team <> ''
      ORDER BY team ASC
    `;
    const teamsResult = await this.db.query<{ team: string }>(teamsSql);
    const teams = teamsResult.rows.map((r) => r.team);
    this.logger.debug(CLASS_NAME, 'getFilterOptions', `Found ${teams.length} teams`);

    // Fetch distinct repositories
    const reposSql = `
      SELECT DISTINCT repository
      FROM commit_history
      WHERE repository IS NOT NULL AND repository <> ''
      ORDER BY repository ASC
    `;
    const reposResult = await this.db.query<{ repository: string }>(reposSql);
    const repositories = reposResult.rows.map((r) => r.repository);
    this.logger.debug(CLASS_NAME, 'getFilterOptions', `Found ${repositories.length} repositories`);

    // Fetch distinct project keys from both Jira and Linear tables (IQS-876)
    const jiraProjectsSql = `
      SELECT DISTINCT jira_project AS project
      FROM commit_jira
      WHERE jira_project IS NOT NULL AND jira_project <> ''
    `;
    const linearProjectsSql = `
      SELECT DISTINCT linear_project AS project
      FROM commit_linear
      WHERE linear_project IS NOT NULL AND linear_project <> ''
    `;
    const combinedProjectsSql = `
      SELECT DISTINCT project FROM (
        ${jiraProjectsSql}
        UNION
        ${linearProjectsSql}
      ) combined
      ORDER BY project ASC
    `;

    const projectsResult = await this.db.query<{ project: string }>(combinedProjectsSql);
    const jiraProjects = projectsResult.rows.map((r) => r.project);
    this.logger.debug(CLASS_NAME, 'getFilterOptions', `Found ${jiraProjects.length} projects (Jira + Linear)`);

    return { teams, repositories, jiraProjects };
  }
}
