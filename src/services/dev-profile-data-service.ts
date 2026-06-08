/**
 * Data service for Developer Profile Dashboard. Queries commit data for developer metrics.
 * Security: CWE-89 (SQL Injection), CWE-20 (Input validation). Ticket: GITX-155, GITX-156
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import {
  QUERY_DEV_PROFILE_VELOCITY_VS_LOC,
  QUERY_DEV_PROFILE_HAS_VELOCITY_DATA,
} from '../database/queries/dev-profile-queries.js';
import type {
  DevProfileSummary,
  DevProfileLocWeekly,
  DevProfileComplexFile,
  DevProfileFrequentFile,
  DevProfileTechStack,
  DevProfileCommentsWeekly,
  DevProfileTestsWeekly,
  DevProfileHygieneScore,
  DevProfileDeveloper,
  DevProfileFilters,
  DevProfileVelocityPoint,
} from './dev-profile-data-types.js';

// Re-export types for convenience
export type {
  DevProfileSummary,
  DevProfileLocWeekly,
  DevProfileComplexFile,
  DevProfileFrequentFile,
  DevProfileTechStack,
  DevProfileCommentsWeekly,
  DevProfileTestsWeekly,
  DevProfileHygieneScore,
  DevProfileDeveloper,
  DevProfileTimeframe,
  DevProfileFilters,
  DevProfileVelocityPoint,
} from './dev-profile-data-types.js';

const CLASS_NAME = 'DevProfileDataService';
const MAX_FILTER_STRING_LENGTH = 200; // CWE-20: Input validation

/** Service for querying developer profile metrics. Ticket: GITX-155, GITX-156 */
export class DevProfileDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'DevProfileDataService created');
  }

  /**
   * Validate developer login string at runtime.
   *
   * @param developer - The developer login to validate
   * @param methodName - Calling method name for log context
   */
  private validateDeveloper(developer: string, methodName: string): void {
    if (!developer || developer.trim().length === 0) {
      this.logger.warn(CLASS_NAME, methodName, 'Empty developer login rejected');
      throw new Error('Developer login is required.');
    }
    if (developer.length > MAX_FILTER_STRING_LENGTH) {
      this.logger.warn(CLASS_NAME, methodName, `Developer login exceeds max length: ${developer.length} > ${MAX_FILTER_STRING_LENGTH}`);
      throw new Error(`Developer login exceeds maximum length of ${MAX_FILTER_STRING_LENGTH} characters.`);
    }
  }

  /**
   * Validate timeframe string at runtime.
   *
   * @param timeframeDays - The timeframe value to validate
   * @param methodName - Calling method name for log context
   */
  private validateTimeframe(timeframeDays: string, methodName: string): void {
    const allowedTimeframes = ['30', '60', '90', '180', '365'];
    if (!allowedTimeframes.includes(timeframeDays)) {
      this.logger.warn(CLASS_NAME, methodName, `Invalid timeframe rejected: ${timeframeDays}`);
      throw new Error(`Invalid timeframe: ${timeframeDays}. Allowed values: ${allowedTimeframes.join(', ')}.`);
    }
  }

  /**
   * Calculate the start date based on timeframe days.
   *
   * @param timeframeDays - Number of days to go back
   * @returns ISO date string YYYY-MM-DD
   */
  private getStartDate(timeframeDays: string): string {
    const days = parseInt(timeframeDays, 10);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0] ?? '';
  }

  /**
   * Get list of all developers for the dropdown selector.
   * Sorted by commit count descending.
   *
   * @returns Array of developer options
   */
  async getDevelopers(): Promise<DevProfileDeveloper[]> {
    this.logger.debug(CLASS_NAME, 'getDevelopers', 'Fetching developer list');

    const sql = `
      SELECT
        cc.login,
        cc.full_name,
        COUNT(DISTINCT ch.sha)::int AS commit_count
      FROM commit_contributors cc
      LEFT JOIN commit_history ch ON ch.author = cc.login
      GROUP BY cc.login, cc.full_name
      ORDER BY commit_count DESC
    `;

    const result = await this.db.query<{
      login: string;
      full_name: string | null;
      commit_count: number;
    }>(sql);

    this.logger.debug(CLASS_NAME, 'getDevelopers', `Found ${result.rowCount} developers`);

    return result.rows.map((row) => ({
      login: row.login,
      fullName: row.full_name,
      commitCount: row.commit_count,
    }));
  }

  /**
   * Get summary statistics for a developer.
   *
   * @param filters - Developer and timeframe filters
   * @returns Summary statistics
   */
  async getSummary(filters: DevProfileFilters): Promise<DevProfileSummary> {
    this.validateDeveloper(filters.developer, 'getSummary');
    this.validateTimeframe(filters.timeframeDays, 'getSummary');

    this.logger.debug(CLASS_NAME, 'getSummary', `Fetching summary for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const sql = `
      SELECT
        COUNT(DISTINCT ch.sha)::int AS total_commits,
        COALESCE(SUM(cf.line_inserts), 0)::bigint AS total_loc_added,
        COALESCE(AVG(NULLIF(cf.complexity, 0)), 0)::numeric AS avg_complexity,
        COUNT(DISTINCT ch.repository)::int AS repos_worked_on
      FROM commit_history ch
      LEFT JOIN commit_files cf ON cf.sha = ch.sha
      WHERE ch.author = $1
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
    `;

    const result = await this.db.query<{
      total_commits: number;
      total_loc_added: string;
      avg_complexity: string;
      repos_worked_on: number;
    }>(sql, [filters.developer, startDate]);

    const row = result.rows[0];
    if (!row) {
      return {
        totalCommits: 0,
        totalLoc: 0,
        avgComplexity: 0,
        repositoriesWorkedOn: 0,
      };
    }

    this.logger.debug(CLASS_NAME, 'getSummary', `Summary: ${row.total_commits} commits, ${row.total_loc_added} LOC`);

    return {
      totalCommits: row.total_commits,
      totalLoc: Number(row.total_loc_added),
      avgComplexity: Number(parseFloat(row.avg_complexity).toFixed(2)),
      repositoriesWorkedOn: row.repos_worked_on,
    };
  }

  /**
   * Get LOC per week data for the stacked bar chart.
   *
   * @param filters - Developer and timeframe filters
   * @returns Array of weekly LOC data points by repository
   */
  async getLocPerWeek(filters: DevProfileFilters): Promise<DevProfileLocWeekly[]> {
    this.validateDeveloper(filters.developer, 'getLocPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getLocPerWeek');

    this.logger.debug(CLASS_NAME, 'getLocPerWeek', `Fetching LOC per week for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const sql = `
      SELECT
        DATE_TRUNC('week', ch.commit_date)::date AS week_start,
        ch.repository,
        COALESCE(SUM(cf.line_inserts), 0)::bigint AS lines_added,
        COALESCE(SUM(cf.line_deletes), 0)::bigint AS lines_removed,
        COALESCE(SUM(cf.line_inserts - cf.line_deletes), 0)::bigint AS net_lines
      FROM commit_history ch
      LEFT JOIN commit_files cf ON cf.sha = ch.sha
      WHERE ch.author = $1
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
        AND cf.line_inserts IS NOT NULL
      GROUP BY week_start, ch.repository
      ORDER BY week_start ASC, ch.repository
    `;

    const result = await this.db.query<{
      week_start: Date;
      repository: string;
      lines_added: string;
      lines_removed: string;
      net_lines: string;
    }>(sql, [filters.developer, startDate]);

    this.logger.debug(CLASS_NAME, 'getLocPerWeek', `Found ${result.rowCount} weekly data points`);

    return result.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      repository: row.repository,
      linesAdded: Number(row.lines_added),
      linesRemoved: Number(row.lines_removed),
      netLines: Number(row.net_lines),
    }));
  }

  /**
   * Get top 15 most complex files modified by the developer.
   *
   * @param filters - Developer and timeframe filters
   * @returns Array of complex file data points
   */
  async getTopComplexFiles(filters: DevProfileFilters): Promise<DevProfileComplexFile[]> {
    this.validateDeveloper(filters.developer, 'getTopComplexFiles');
    this.validateTimeframe(filters.timeframeDays, 'getTopComplexFiles');

    this.logger.debug(CLASS_NAME, 'getTopComplexFiles', `Fetching top complex files for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const sql = `
      SELECT
        cf.filename AS file_path,
        MAX(cf.complexity)::int AS complexity_score,
        ch.repository,
        MAX(ch.commit_date)::date AS last_modified
      FROM commit_files cf
      JOIN commit_history ch ON ch.sha = cf.sha
      WHERE ch.author = $1
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
        AND cf.complexity IS NOT NULL
        AND cf.complexity > 0
      GROUP BY cf.filename, ch.repository
      ORDER BY complexity_score DESC
      LIMIT 15
    `;

    const result = await this.db.query<{
      file_path: string;
      complexity_score: number;
      repository: string;
      last_modified: Date;
    }>(sql, [filters.developer, startDate]);

    this.logger.debug(CLASS_NAME, 'getTopComplexFiles', `Found ${result.rowCount} complex files`);

    return result.rows.map((row) => ({
      filePath: row.file_path,
      complexityScore: row.complexity_score,
      repository: row.repository,
      lastModified: row.last_modified.toISOString().split('T')[0] ?? '',
    }));
  }

  /**
   * Get top 20 most frequently modified files by the developer.
   *
   * @param filters - Developer and timeframe filters
   * @returns Array of frequent file data points
   */
  async getTopFrequentFiles(filters: DevProfileFilters): Promise<DevProfileFrequentFile[]> {
    this.validateDeveloper(filters.developer, 'getTopFrequentFiles');
    this.validateTimeframe(filters.timeframeDays, 'getTopFrequentFiles');

    this.logger.debug(CLASS_NAME, 'getTopFrequentFiles', `Fetching top frequent files for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const sql = `
      SELECT
        cf.filename AS file_path,
        COUNT(DISTINCT cf.sha)::int AS modification_count,
        COALESCE(SUM(ABS(cf.line_inserts) + ABS(COALESCE(cf.line_deletes, 0))), 0)::bigint AS total_loc_changed,
        ch.repository
      FROM commit_files cf
      JOIN commit_history ch ON ch.sha = cf.sha
      WHERE ch.author = $1
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
      GROUP BY cf.filename, ch.repository
      ORDER BY modification_count DESC
      LIMIT 20
    `;

    const result = await this.db.query<{
      file_path: string;
      modification_count: number;
      total_loc_changed: string;
      repository: string;
    }>(sql, [filters.developer, startDate]);

    this.logger.debug(CLASS_NAME, 'getTopFrequentFiles', `Found ${result.rowCount} frequent files`);

    return result.rows.map((row) => ({
      filePath: row.file_path,
      modificationCount: row.modification_count,
      totalLocChanged: Number(row.total_loc_changed),
      repository: row.repository,
    }));
  }

  /**
   * Get technology stack contributions by category for the doughnut chart.
   * Ticket: GITX-156
   *
   * @param filters - Developer and timeframe filters
   * @returns Array of tech stack data points with percentages
   */
  async getTechStack(filters: DevProfileFilters): Promise<DevProfileTechStack[]> {
    this.validateDeveloper(filters.developer, 'getTechStack');
    this.validateTimeframe(filters.timeframeDays, 'getTechStack');

    this.logger.debug(CLASS_NAME, 'getTechStack', `Fetching tech stack for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // Query aggregates LOC by technology stack category using the view
    const sql = `
      WITH dev_contributions AS (
        SELECT
          vtsc.category,
          ch.repository,
          COALESCE(SUM(cf.line_inserts), 0)::bigint AS loc_count
        FROM commit_files cf
        JOIN commit_history ch ON cf.sha = ch.sha
        JOIN vw_technology_stack_category vtsc ON cf.file_extension = vtsc.file_extension
        WHERE ch.author = $1
          AND ch.commit_date >= $2
          AND ch.is_merge = FALSE
          AND cf.line_inserts IS NOT NULL
        GROUP BY vtsc.category, ch.repository
      ),
      total_loc AS (
        SELECT COALESCE(SUM(loc_count), 0) AS total FROM dev_contributions
      )
      SELECT
        dc.category,
        dc.repository,
        dc.loc_count,
        CASE
          WHEN tl.total > 0 THEN ROUND((dc.loc_count * 100.0 / tl.total)::numeric, 2)
          ELSE 0
        END AS percentage
      FROM dev_contributions dc
      CROSS JOIN total_loc tl
      WHERE dc.loc_count > 0
      ORDER BY dc.loc_count DESC
    `;

    const result = await this.db.query<{
      category: string;
      repository: string;
      loc_count: string;
      percentage: string;
    }>(sql, [filters.developer, startDate]);

    this.logger.debug(CLASS_NAME, 'getTechStack', `Found ${result.rowCount} tech stack categories`);

    return result.rows.map((row) => ({
      category: row.category,
      repository: row.repository,
      locCount: Number(row.loc_count),
      percentage: Number(row.percentage),
    }));
  }

  /**
   * Get comments added per week for the line chart.
   * Uses comments_change column with fallback to total_comment_lines for older commits.
   * Ticket: GITX-156
   *
   * @param filters - Developer and timeframe filters
   * @returns Array of weekly comment data points
   */
  async getCommentsPerWeek(filters: DevProfileFilters): Promise<DevProfileCommentsWeekly[]> {
    this.validateDeveloper(filters.developer, 'getCommentsPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getCommentsPerWeek');

    this.logger.debug(CLASS_NAME, 'getCommentsPerWeek', `Fetching comments per week for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // Use COALESCE to handle NULL comments_change (from older commits before migration 026)
    const sql = `
      SELECT
        DATE_TRUNC('week', ch.commit_date)::date AS week_start,
        COALESCE(SUM(COALESCE(cf.comments_change, 0)), 0)::int AS comments_added
      FROM commit_files cf
      JOIN commit_history ch ON cf.sha = ch.sha
      WHERE ch.author = $1
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
      GROUP BY week_start
      ORDER BY week_start ASC
    `;

    const result = await this.db.query<{
      week_start: Date;
      comments_added: number;
    }>(sql, [filters.developer, startDate]);

    this.logger.debug(CLASS_NAME, 'getCommentsPerWeek', `Found ${result.rowCount} weekly comment data points`);

    return result.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      commentsAdded: row.comments_added,
    }));
  }

  /**
   * Get tests modified per week for the line chart.
   * Filters by is_test_file = TRUE.
   * Ticket: GITX-156
   *
   * @param filters - Developer and timeframe filters
   * @returns Array of weekly test data points
   */
  async getTestsPerWeek(filters: DevProfileFilters): Promise<DevProfileTestsWeekly[]> {
    this.validateDeveloper(filters.developer, 'getTestsPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getTestsPerWeek');

    this.logger.debug(CLASS_NAME, 'getTestsPerWeek', `Fetching tests per week for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const sql = `
      SELECT
        DATE_TRUNC('week', ch.commit_date)::date AS week_start,
        COUNT(DISTINCT cf.filename)::int AS test_files_modified,
        COALESCE(SUM(cf.line_inserts), 0)::int AS test_lines_added
      FROM commit_files cf
      JOIN commit_history ch ON cf.sha = ch.sha
      WHERE ch.author = $1
        AND ch.commit_date >= $2
        AND ch.is_merge = FALSE
        AND cf.is_test_file = TRUE
      GROUP BY week_start
      ORDER BY week_start ASC
    `;

    const result = await this.db.query<{
      week_start: Date;
      test_files_modified: number;
      test_lines_added: number;
    }>(sql, [filters.developer, startDate]);

    this.logger.debug(CLASS_NAME, 'getTestsPerWeek', `Found ${result.rowCount} weekly test data points`);

    return result.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      testFilesModified: row.test_files_modified,
      testLinesAdded: row.test_lines_added,
    }));
  }

  /**
   * Get commit hygiene score from vw_commit_hygiene view.
   * Calculates weighted score: (jira_ref * 0.4) + (meaningful_msg * 0.4) + (non_merge * 0.2)
   * Ticket: GITX-156
   *
   * @param filters - Developer and timeframe filters
   * @returns Hygiene score breakdown
   */
  async getHygieneScore(filters: DevProfileFilters): Promise<DevProfileHygieneScore> {
    this.validateDeveloper(filters.developer, 'getHygieneScore');
    this.validateTimeframe(filters.timeframeDays, 'getHygieneScore');

    this.logger.debug(CLASS_NAME, 'getHygieneScore', `Fetching hygiene score for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    // Query the vw_commit_hygiene view and calculate component percentages
    const sql = `
      WITH hygiene_stats AS (
        SELECT
          COUNT(*)::int AS total_commits,
          ROUND(AVG(hygiene_score)::numeric, 2) AS avg_hygiene_score,
          -- Jira reference percentage: commits with linked ticket
          ROUND(100.0 * COUNT(*) FILTER (WHERE jira_ticket_id IS NOT NULL OR linear_ticket_id IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS jira_ref_pct,
          -- Meaningful message percentage: commits with conventional prefix OR good length
          ROUND(100.0 * COUNT(*) FILTER (WHERE has_conventional_prefix = TRUE OR subject_length BETWEEN 20 AND 72) / NULLIF(COUNT(*), 0), 1) AS meaningful_msg_pct,
          -- Quality tier counts for determining overall tier
          COUNT(*) FILTER (WHERE quality_tier = 'excellent') AS excellent_count,
          COUNT(*) FILTER (WHERE quality_tier = 'good') AS good_count,
          COUNT(*) FILTER (WHERE quality_tier = 'fair') AS fair_count,
          COUNT(*) FILTER (WHERE quality_tier = 'poor') AS poor_count
        FROM vw_commit_hygiene
        WHERE author = $1
          AND commit_date >= $2
      )
      SELECT
        total_commits,
        avg_hygiene_score,
        COALESCE(jira_ref_pct, 0) AS jira_ref_pct,
        COALESCE(meaningful_msg_pct, 0) AS meaningful_msg_pct,
        -- Non-merge is always 100% since the view already excludes merges
        100.0 AS non_merge_pct,
        excellent_count,
        good_count,
        fair_count,
        poor_count
      FROM hygiene_stats
    `;

    const result = await this.db.query<{
      total_commits: number;
      avg_hygiene_score: string | null;
      jira_ref_pct: string;
      meaningful_msg_pct: string;
      non_merge_pct: string;
      excellent_count: number;
      good_count: number;
      fair_count: number;
      poor_count: number;
    }>(sql, [filters.developer, startDate]);

    const row = result.rows[0];
    if (!row || row.total_commits === 0) {
      this.logger.debug(CLASS_NAME, 'getHygieneScore', 'No commits found for hygiene calculation');
      return {
        overallScore: 0,
        jiraRefPercentage: 0,
        meaningfulMsgPercentage: 0,
        nonMergePercentage: 100,
        totalCommits: 0,
        qualityTier: 'poor',
      };
    }

    // Calculate weighted overall score
    const jiraRefPct = Number(row.jira_ref_pct);
    const meaningfulMsgPct = Number(row.meaningful_msg_pct);
    const nonMergePct = Number(row.non_merge_pct);

    // Use the average hygiene score from the view directly
    const overallScore = Number(row.avg_hygiene_score ?? 0);

    // Determine quality tier based on distribution
    let qualityTier: 'excellent' | 'good' | 'fair' | 'poor';
    const totalCommits = row.total_commits;
    const excellentGoodRatio = (row.excellent_count + row.good_count) / totalCommits;

    if (excellentGoodRatio >= 0.8) {
      qualityTier = 'excellent';
    } else if (excellentGoodRatio >= 0.6) {
      qualityTier = 'good';
    } else if (excellentGoodRatio >= 0.4) {
      qualityTier = 'fair';
    } else {
      qualityTier = 'poor';
    }

    this.logger.debug(CLASS_NAME, 'getHygieneScore', `Hygiene score: ${overallScore}, tier: ${qualityTier}`);

    return {
      overallScore,
      jiraRefPercentage: jiraRefPct,
      meaningfulMsgPercentage: meaningfulMsgPct,
      nonMergePercentage: nonMergePct,
      totalCommits,
      qualityTier,
    };
  }

  /**
   * Get sprint velocity vs LOC data for the dual-axis chart.
   * Correlates story points from Linear/Jira with lines of code committed.
   * Uses commit_contributors.email -> Linear/Jira assignee mapping.
   * Ticket: GITX-157
   *
   * @param filters - Developer and timeframe filters
   * @returns Array of velocity data points per week
   */
  async getVelocityVsLoc(filters: DevProfileFilters): Promise<DevProfileVelocityPoint[]> {
    this.validateDeveloper(filters.developer, 'getVelocityVsLoc');
    this.validateTimeframe(filters.timeframeDays, 'getVelocityVsLoc');

    this.logger.debug(CLASS_NAME, 'getVelocityVsLoc', `Fetching velocity vs LOC for ${filters.developer}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<{
      week_start: Date;
      story_points: number;
      lines_of_code: string;
      issue_count: number;
      commit_count: number;
    }>(QUERY_DEV_PROFILE_VELOCITY_VS_LOC, [filters.developer, startDate]);

    this.logger.debug(CLASS_NAME, 'getVelocityVsLoc', `Found ${result.rowCount} weekly velocity data points`);

    return result.rows.map((row) => ({
      weekStart: row.week_start.toISOString().split('T')[0] ?? '',
      storyPoints: row.story_points,
      linesOfCode: Number(row.lines_of_code),
      issueCount: row.issue_count,
      commitCount: row.commit_count,
    }));
  }

  /**
   * Check if velocity data is available for a developer.
   * Returns true if the developer has any Linear/Jira issues assigned.
   * Ticket: GITX-157
   *
   * @param developer - Developer login
   * @returns true if velocity data exists
   */
  async hasVelocityData(developer: string): Promise<boolean> {
    this.validateDeveloper(developer, 'hasVelocityData');

    this.logger.debug(CLASS_NAME, 'hasVelocityData', `Checking velocity data availability for ${developer}`);

    const result = await this.db.query<{ has_data: boolean }>(
      QUERY_DEV_PROFILE_HAS_VELOCITY_DATA,
      [developer]
    );
    const hasData = result.rows[0]?.has_data ?? false;

    this.logger.debug(CLASS_NAME, 'hasVelocityData', `Velocity data available: ${hasData}`);
    return hasData;
  }
}
