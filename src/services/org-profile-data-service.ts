/**
 * Data service for Organization Profile Dashboard. Queries commit data for organization-aggregated metrics.
 * Security: CWE-89 (SQL Injection), CWE-20 (Input validation). Ticket: GITX-204
 *
 * This service uses composition with OrganizationCrudService for CRUD operations
 * to keep files under 600 lines.
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import {
  QUERY_ORG_SUMMARY_STATS,
  QUERY_ORG_LOC_PER_WEEK,
  QUERY_ORG_LOC_BY_REPOSITORY,
  QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM,
  QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM,
  QUERY_ORG_TECH_STACK,
  QUERY_ORG_TECH_STACK_BY_EXTENSION,
  QUERY_ORG_COMMENTS_PER_WEEK,
  QUERY_ORG_TESTS_PER_WEEK,
  QUERY_ORG_HYGIENE_SCORE,
  QUERY_ORG_VELOCITY_VS_LOC,
  QUERY_ORG_VELOCITY_BY_TEAM,
  QUERY_ORG_LOC_BY_TEAM,
  QUERY_ORG_HOT_SPOTS,
  QUERY_ORG_KNOWLEDGE_CONCENTRATION,
  QUERY_ORG_TABLE_EXISTS,
  QUERY_TEAMS_ORG_FK_EXISTS,
  QUERY_ORG_TOTAL_STORY_POINTS,
  QUERY_ORG_TEAM_DATA_COVERAGE,
  type OrgSummaryDbRow,
  type OrgLocPerWeekDbRow,
  type OrgLocByRepositoryDbRow,
  type OrgComplexFileDbRow,
  type OrgFrequentFileDbRow,
  type OrgTechStackDbRow,
  type OrgTechStackByExtensionDbRow,
  type OrgCommentsPerWeekDbRow,
  type OrgTestsPerWeekDbRow,
  type OrgHygieneScoreDbRow,
  type OrgVelocityVsLocDbRow,
  type OrgVelocityByTeamDbRow,
  type OrgLocByTeamDbRow,
  type OrgHotSpotDbRow,
  type OrgKnowledgeConcentrationDbRow,
  type OrgTotalStoryPointsDbRow,
  type OrgTeamDataCoverageDbRow,
} from '../database/queries/org-profile-queries.js';
import { OrganizationCrudService } from './org-profile-crud-service.js';
import type {
  Organization,
  Team,
  OrgProfileSummary,
  OrgProfileLocWeekly,
  OrgProfileLocByRepository,
  OrgProfileComplexFile,
  OrgProfileFrequentFile,
  OrgProfileTechStack,
  OrgProfileTechStackByExtension,
  OrgProfileCommentsWeekly,
  OrgProfileTestsWeekly,
  OrgProfileHygieneScore,
  OrgProfileVelocityPoint,
  OrgProfileVelocityWithTeams,
  OrgVelocityTeamContribution,
  OrgProfileLocByTeam,
  OrgProfileHotSpot,
  OrgHotSpotRiskTier,
  OrgProfileKnowledgeConcentration,
  OrgConcentrationRisk,
  OrgProfileFilters,
  CreateOrganizationInput,
  UpdateOrganizationInput,
  OrgDataCoverage,
  OrgTeamDataStatus,
} from './org-profile-data-types.js';

// Re-export types for convenience
export type {
  Organization,
  Team,
  OrgProfileSummary,
  OrgProfileLocWeekly,
  OrgProfileLocByRepository,
  OrgProfileComplexFile,
  OrgProfileFrequentFile,
  OrgProfileTechStack,
  OrgProfileCommentsWeekly,
  OrgProfileTestsWeekly,
  OrgProfileHygieneScore,
  OrgProfileVelocityPoint,
  OrgProfileVelocityWithTeams,
  OrgVelocityTeamContribution,
  OrgProfileLocByTeam,
  OrgProfileHotSpot,
  OrgHotSpotRiskTier,
  OrgProfileKnowledgeConcentration,
  OrgConcentrationRisk,
  OrgProfileTimeframe,
  OrgProfileFilters,
  CreateOrganizationInput,
  UpdateOrganizationInput,
  OrgDataCoverage,
  OrgTeamDataStatus,
} from './org-profile-data-types.js';

// Re-export CRUD service for convenience
export { OrganizationCrudService } from './org-profile-crud-service.js';

const CLASS_NAME = 'OrganizationProfileDataService';
const ALLOWED_TIMEFRAMES = ['30', '60', '90', '180', '365', '730'] as const;

/** Service for querying organization profile metrics. Ticket: GITX-204 */
export class OrganizationProfileDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;
  private readonly crudService: OrganizationCrudService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.crudService = new OrganizationCrudService(db);
    this.logger.debug(CLASS_NAME, 'constructor', 'OrganizationProfileDataService created');
  }

  // ============================================================================
  // Input Validation Methods
  // ============================================================================

  /**
   * Validate organization ID at runtime.
   * CWE-20: Input validation - must be positive integer.
   */
  validateOrganizationId(organizationId: number, methodName: string): void {
    this.crudService.validateOrganizationId(organizationId, methodName);
  }

  /**
   * Validate timeframe string at runtime.
   * CWE-20: Input validation - whitelist approach.
   */
  validateTimeframe(timeframeDays: string, methodName: string): void {
    if (!ALLOWED_TIMEFRAMES.includes(timeframeDays as typeof ALLOWED_TIMEFRAMES[number])) {
      this.logger.warn(CLASS_NAME, methodName, `Invalid timeframe rejected: ${timeframeDays}`);
      throw new Error(`Invalid timeframe: ${timeframeDays}. Allowed values: ${ALLOWED_TIMEFRAMES.join(', ')}.`);
    }
  }

  /**
   * Validate aggregation period parameter before SQL execution.
   * Security: CWE-89 defense-in-depth.
   */
  private validateAggregationPeriod(period: string, methodName: string): void {
    const allowedPeriods = ['week', 'month'];
    if (!allowedPeriods.includes(period)) {
      this.logger.error(CLASS_NAME, methodName, `Invalid aggregation period: ${period}`);
      throw new Error('Invalid aggregation period. Must be "week" or "month".');
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private getStartDate(timeframeDays: string): string {
    const days = parseInt(timeframeDays, 10);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0] ?? '';
  }

  /** For timeframes < 365 days, aggregate by week. For >= 365 days, aggregate by month. */
  getAggregationPeriod(timeframeDays: string): 'week' | 'month' {
    const days = parseInt(timeframeDays, 10);
    return days >= 365 ? 'month' : 'week';
  }

  private static readonly AVERAGE_DAYS_PER_MONTH = 30.44;

  private getPeriodsCount(timeframeDays: string): number {
    const days = parseInt(timeframeDays, 10);
    const period = this.getAggregationPeriod(timeframeDays);
    if (period === 'month') {
      return Math.max(1, Math.ceil(days / OrganizationProfileDataService.AVERAGE_DAYS_PER_MONTH));
    }
    return Math.max(1, Math.ceil(days / 7));
  }

  // ============================================================================
  // CRUD Delegation Methods
  // ============================================================================

  async getOrganizations(): Promise<Organization[]> {
    return this.crudService.getOrganizations();
  }

  async getOrganizationById(organizationId: number): Promise<Organization | null> {
    return this.crudService.getOrganizationById(organizationId);
  }

  async createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    return this.crudService.createOrganization(input);
  }

  async updateOrganization(organizationId: number, input: UpdateOrganizationInput): Promise<Organization | null> {
    return this.crudService.updateOrganization(organizationId, input);
  }

  async deleteOrganization(organizationId: number): Promise<boolean> {
    return this.crudService.deleteOrganization(organizationId);
  }

  async assignTeamToOrganization(teamId: number, organizationId: number): Promise<Team | null> {
    return this.crudService.assignTeamToOrganization(teamId, organizationId);
  }

  async removeTeamFromOrganization(teamId: number): Promise<Team | null> {
    return this.crudService.removeTeamFromOrganization(teamId);
  }

  async getTeams(): Promise<Team[]> {
    return this.crudService.getTeams();
  }

  // ============================================================================
  // Query Methods - Analytics
  // ============================================================================

  async getSummary(filters: OrgProfileFilters): Promise<OrgProfileSummary> {
    this.validateOrganizationId(filters.organizationId, 'getSummary');
    this.validateTimeframe(filters.timeframeDays, 'getSummary');

    this.logger.debug(CLASS_NAME, 'getSummary', `Fetching summary for organization ${filters.organizationId}`);

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    const periodsCount = this.getPeriodsCount(filters.timeframeDays);
    const startDate = this.getStartDate(filters.timeframeDays);

    // Fetch summary stats and story points in parallel
    const [summaryResult, storyPointsResult] = await Promise.all([
      this.db.query<OrgSummaryDbRow>(QUERY_ORG_SUMMARY_STATS, [filters.organizationId]),
      this.db.query<OrgTotalStoryPointsDbRow>(QUERY_ORG_TOTAL_STORY_POINTS, [filters.organizationId, startDate]),
    ]);

    const row = summaryResult.rows[0];
    if (!row) {
      return {
        organizationId: filters.organizationId,
        organizationName: '',
        teamCount: 0,
        contributorCount: 0,
        totalCommits: 0,
        totalLoc: 0,
        avgComplexity: 0,
        avgLocPerPeriod: 0,
        avgStoryPointsPerPeriod: null,
        aggregationPeriod,
        repositoriesWorkedOn: 0,
      };
    }

    const totalLoc = Number(row.total_loc);
    const avgLocPerPeriod = periodsCount > 0 ? Math.round(totalLoc / periodsCount) : 0;
    const avgComplexity = Number(parseFloat(String(row.avg_complexity)).toFixed(2));

    // Calculate average story points per period
    // GITX-206: Story points divided by periods for Avg SP/Period KPI card
    const totalStoryPoints = storyPointsResult.rows[0]?.total_story_points ?? null;
    const avgStoryPointsPerPeriod = totalStoryPoints !== null && periodsCount > 0
      ? Math.round((totalStoryPoints / periodsCount) * 10) / 10
      : null;

    this.logger.debug(CLASS_NAME, 'getSummary', `Summary: ${row.total_commits} commits, ${totalLoc} LOC, avgComplexity: ${avgComplexity}, repos: ${row.repos_worked_on}`);

    return {
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      teamCount: row.team_count,
      contributorCount: row.contributor_count,
      totalCommits: row.total_commits,
      totalLoc,
      avgComplexity,
      avgLocPerPeriod,
      avgStoryPointsPerPeriod,
      aggregationPeriod,
      repositoriesWorkedOn: row.repos_worked_on,
    };
  }

  async getLocPerWeek(filters: OrgProfileFilters): Promise<OrgProfileLocWeekly[]> {
    this.validateOrganizationId(filters.organizationId, 'getLocPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getLocPerWeek');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getLocPerWeek');
    this.logger.debug(CLASS_NAME, 'getLocPerWeek', `Fetching LOC per ${aggregationPeriod} for organization ${filters.organizationId}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<OrgLocPerWeekDbRow>(
      QUERY_ORG_LOC_PER_WEEK,
      [filters.organizationId, startDate, aggregationPeriod]
    );

    this.logger.debug(CLASS_NAME, 'getLocPerWeek', `Found ${result.rowCount} ${aggregationPeriod}ly data points`);

    return result.rows.map((row) => ({
      weekStart: new Date(row.week_start).toISOString().split('T')[0] ?? '',
      linesAdded: Number(row.lines_added),
      linesDeleted: Number(row.lines_deleted),
      netLines: Number(row.net_lines),
      commitCount: row.commit_count,
    }));
  }

  /**
   * Get LOC by repository for stacked bar chart.
   * GITX-207: Lines of Code chart - stacked bar chart by REPOSITORY.
   */
  async getLocByRepository(filters: OrgProfileFilters): Promise<OrgProfileLocByRepository[]> {
    this.validateOrganizationId(filters.organizationId, 'getLocByRepository');
    this.validateTimeframe(filters.timeframeDays, 'getLocByRepository');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getLocByRepository');
    this.logger.debug(CLASS_NAME, 'getLocByRepository', `Fetching LOC by repository for organization ${filters.organizationId}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<OrgLocByRepositoryDbRow>(
      QUERY_ORG_LOC_BY_REPOSITORY,
      [filters.organizationId, startDate, aggregationPeriod]
    );

    this.logger.debug(CLASS_NAME, 'getLocByRepository', `Found ${result.rowCount} repository LOC data points`);

    return result.rows.map((row) => ({
      weekStart: new Date(row.week_start).toISOString().split('T')[0] ?? '',
      repository: row.repository,
      linesAdded: Number(row.lines_added),
    }));
  }

  async getTopComplexFilesByTeam(organizationId: number): Promise<OrgProfileComplexFile[]> {
    this.validateOrganizationId(organizationId, 'getTopComplexFilesByTeam');

    this.logger.debug(CLASS_NAME, 'getTopComplexFilesByTeam', `Fetching complex files for organization ${organizationId}`);

    const result = await this.db.query<OrgComplexFileDbRow>(
      QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM,
      [organizationId]
    );

    this.logger.debug(CLASS_NAME, 'getTopComplexFilesByTeam', `Found ${result.rowCount} complex file records`);

    return result.rows.map((row) => ({
      filename: row.filename,
      complexity: row.complexity,
      teamName: row.team_name,
      loc: Number(row.loc),
      percentage: Number(row.percentage),
    }));
  }

  async getTopFrequentFilesByTeam(organizationId: number): Promise<OrgProfileFrequentFile[]> {
    this.validateOrganizationId(organizationId, 'getTopFrequentFilesByTeam');

    this.logger.debug(CLASS_NAME, 'getTopFrequentFilesByTeam', `Fetching frequent files for organization ${organizationId}`);

    const result = await this.db.query<OrgFrequentFileDbRow>(
      QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM,
      [organizationId]
    );

    this.logger.debug(CLASS_NAME, 'getTopFrequentFilesByTeam', `Found ${result.rowCount} frequent file records`);

    return result.rows.map((row) => ({
      filename: row.filename,
      totalChurn: Number(row.total_churn),
      teamName: row.team_name,
      churn: Number(row.churn),
      percentage: Number(row.percentage),
    }));
  }

  async getTechStack(filters: OrgProfileFilters): Promise<OrgProfileTechStack[]> {
    this.validateOrganizationId(filters.organizationId, 'getTechStack');
    this.validateTimeframe(filters.timeframeDays, 'getTechStack');

    this.logger.debug(CLASS_NAME, 'getTechStack', `Fetching tech stack for organization ${filters.organizationId}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<OrgTechStackDbRow>(QUERY_ORG_TECH_STACK, [filters.organizationId, startDate]);

    this.logger.debug(CLASS_NAME, 'getTechStack', `Found ${result.rowCount} tech stack categories`);

    return result.rows.map((row) => ({
      category: row.category,
      repository: row.repository,
      locCount: Number(row.loc_count),
      percentage: Number(row.percentage),
    }));
  }

  /**
   * Get technology stack by file extension for an organization.
   * GITX-214: Returns file extensions with LOC counts and percentages.
   * Extensions are normalized to lowercase.
   *
   * @param filters - Organization ID and timeframe filters
   * @returns Array of tech stack data points by file extension
   */
  async getTechStackByExtension(filters: OrgProfileFilters): Promise<OrgProfileTechStackByExtension[]> {
    this.validateOrganizationId(filters.organizationId, 'getTechStackByExtension');
    this.validateTimeframe(filters.timeframeDays, 'getTechStackByExtension');

    this.logger.debug(CLASS_NAME, 'getTechStackByExtension', `Fetching tech stack by extension for organization ${filters.organizationId}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<OrgTechStackByExtensionDbRow>(
      QUERY_ORG_TECH_STACK_BY_EXTENSION,
      [filters.organizationId, startDate]
    );

    this.logger.debug(CLASS_NAME, 'getTechStackByExtension', `Found ${result.rowCount} file extensions`);

    return result.rows.map((row) => ({
      extension: row.extension,
      repository: row.repository,
      locCount: Number(row.loc_count),
      percentage: Number(row.percentage),
    }));
  }

  async getCommentsPerWeek(filters: OrgProfileFilters): Promise<OrgProfileCommentsWeekly[]> {
    this.validateOrganizationId(filters.organizationId, 'getCommentsPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getCommentsPerWeek');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getCommentsPerWeek');
    this.logger.debug(CLASS_NAME, 'getCommentsPerWeek', `Fetching comments per ${aggregationPeriod} for organization ${filters.organizationId}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<OrgCommentsPerWeekDbRow>(
      QUERY_ORG_COMMENTS_PER_WEEK,
      [filters.organizationId, startDate, aggregationPeriod]
    );

    this.logger.debug(CLASS_NAME, 'getCommentsPerWeek', `Found ${result.rowCount} ${aggregationPeriod}ly comment data points`);

    return result.rows.map((row) => ({
      weekStart: new Date(row.week_start).toISOString().split('T')[0] ?? '',
      commentLinesAdded: Number(row.comments_added),
      totalFiles: row.total_files,
    }));
  }

  async getTestsPerWeek(filters: OrgProfileFilters): Promise<OrgProfileTestsWeekly[]> {
    this.validateOrganizationId(filters.organizationId, 'getTestsPerWeek');
    this.validateTimeframe(filters.timeframeDays, 'getTestsPerWeek');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getTestsPerWeek');
    this.logger.debug(CLASS_NAME, 'getTestsPerWeek', `Fetching tests per ${aggregationPeriod} for organization ${filters.organizationId}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<OrgTestsPerWeekDbRow>(
      QUERY_ORG_TESTS_PER_WEEK,
      [filters.organizationId, startDate, aggregationPeriod]
    );

    this.logger.debug(CLASS_NAME, 'getTestsPerWeek', `Found ${result.rowCount} ${aggregationPeriod}ly test data points`);

    return result.rows.map((row) => ({
      weekStart: new Date(row.week_start).toISOString().split('T')[0] ?? '',
      testFilesModified: row.test_files_modified,
      testLinesAdded: Number(row.test_lines_added),
    }));
  }

  async getHygieneScore(organizationId: number): Promise<OrgProfileHygieneScore> {
    this.validateOrganizationId(organizationId, 'getHygieneScore');

    this.logger.debug(CLASS_NAME, 'getHygieneScore', `Fetching hygiene score for organization ${organizationId}`);

    const result = await this.db.query<OrgHygieneScoreDbRow>(QUERY_ORG_HYGIENE_SCORE, [organizationId]);

    const row = result.rows[0];
    if (!row || row.total_commits === 0) {
      return {
        avgHygieneScore: 0,
        totalCommits: 0,
        conventionalCommits: 0,
        conventionalPct: 0,
        qualityTier: 'poor',
        jiraRefPercentage: 0,
        meaningfulMsgPercentage: 0,
        nonMergePercentage: 100,
      };
    }

    this.logger.debug(CLASS_NAME, 'getHygieneScore', `Hygiene score: ${row.avg_hygiene_score}`);

    return {
      avgHygieneScore: Number(row.avg_hygiene_score),
      totalCommits: row.total_commits,
      conventionalCommits: row.conventional_commits,
      conventionalPct: Number(row.conventional_pct),
      // GITX-216: Enhanced hygiene metrics
      qualityTier: row.quality_tier || 'poor',
      jiraRefPercentage: Number(row.jira_ref_pct || 0),
      meaningfulMsgPercentage: Number(row.meaningful_msg_pct || 0),
      nonMergePercentage: Number(row.non_merge_pct || 100),
    };
  }

  async getVelocityVsLoc(filters: OrgProfileFilters): Promise<OrgProfileVelocityPoint[]> {
    this.validateOrganizationId(filters.organizationId, 'getVelocityVsLoc');
    this.validateTimeframe(filters.timeframeDays, 'getVelocityVsLoc');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getVelocityVsLoc');
    this.logger.debug(CLASS_NAME, 'getVelocityVsLoc', `Fetching velocity vs LOC for organization ${filters.organizationId}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<OrgVelocityVsLocDbRow>(
      QUERY_ORG_VELOCITY_VS_LOC,
      [filters.organizationId, startDate, aggregationPeriod]
    );

    this.logger.debug(CLASS_NAME, 'getVelocityVsLoc', `Found ${result.rowCount} velocity data points`);

    return result.rows.map((row) => ({
      weekStart: new Date(row.week_start).toISOString().split('T')[0] ?? '',
      storyPoints: row.story_points,
      linesOfCode: Number(row.lines_of_code),
      issueCount: row.issue_count,
      commitCount: row.commit_count,
    }));
  }

  /**
   * Get velocity data with team-level breakdown for stacked bar chart.
   * GITX-201: Team-colored stacked bars with LOC trend line overlay.
   */
  async getVelocityWithTeams(filters: OrgProfileFilters): Promise<OrgProfileVelocityWithTeams[]> {
    this.validateOrganizationId(filters.organizationId, 'getVelocityWithTeams');
    this.validateTimeframe(filters.timeframeDays, 'getVelocityWithTeams');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getVelocityWithTeams');
    this.logger.debug(CLASS_NAME, 'getVelocityWithTeams', `Fetching velocity with teams for organization ${filters.organizationId}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<OrgVelocityByTeamDbRow>(
      QUERY_ORG_VELOCITY_BY_TEAM,
      [filters.organizationId, startDate, aggregationPeriod]
    );

    this.logger.debug(CLASS_NAME, 'getVelocityWithTeams', `Found ${result.rowCount} velocity by team data points`);

    // Group by week_start and aggregate team contributions
    const weekMap = new Map<string, {
      totalStoryPoints: number;
      linesOfCode: number;
      issueCount: number;
      commitCount: number;
      teamContributions: OrgVelocityTeamContribution[];
    }>();

    for (const row of result.rows) {
      const weekStart = new Date(row.week_start).toISOString().split('T')[0] ?? '';

      if (!weekMap.has(weekStart)) {
        weekMap.set(weekStart, {
          totalStoryPoints: 0,
          linesOfCode: 0,
          issueCount: 0,
          commitCount: 0,
          teamContributions: [],
        });
      }

      const weekData = weekMap.get(weekStart);
      if (weekData) {
        weekData.totalStoryPoints += row.story_points;
        weekData.linesOfCode += Number(row.lines_of_code);
        weekData.issueCount += row.issue_count;
        weekData.commitCount += row.commit_count;
        weekData.teamContributions.push({
          teamName: row.team_name,
          storyPoints: row.story_points,
          issueCount: row.issue_count,
        });
      }
    }

    // Convert map to sorted array
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, data]) => ({
        weekStart,
        totalStoryPoints: data.totalStoryPoints,
        linesOfCode: data.linesOfCode,
        issueCount: data.issueCount,
        commitCount: data.commitCount,
        teamContributions: data.teamContributions,
      }));
  }

  /**
   * Get LOC data with team-level breakdown for team-colored line chart.
   * GITX-201: Each team as a separate colored line on the LOC chart.
   */
  async getLocByTeam(filters: OrgProfileFilters): Promise<OrgProfileLocByTeam[]> {
    this.validateOrganizationId(filters.organizationId, 'getLocByTeam');
    this.validateTimeframe(filters.timeframeDays, 'getLocByTeam');

    const aggregationPeriod = this.getAggregationPeriod(filters.timeframeDays);
    this.validateAggregationPeriod(aggregationPeriod, 'getLocByTeam');
    this.logger.debug(CLASS_NAME, 'getLocByTeam', `Fetching LOC by team for organization ${filters.organizationId}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<OrgLocByTeamDbRow>(
      QUERY_ORG_LOC_BY_TEAM,
      [filters.organizationId, startDate, aggregationPeriod]
    );

    this.logger.debug(CLASS_NAME, 'getLocByTeam', `Found ${result.rowCount} LOC by team data points`);

    return result.rows.map((row) => ({
      weekStart: new Date(row.week_start).toISOString().split('T')[0] ?? '',
      teamName: row.team_name,
      linesAdded: Number(row.lines_added),
    }));
  }

  async getHotSpots(organizationId: number): Promise<OrgProfileHotSpot[]> {
    this.validateOrganizationId(organizationId, 'getHotSpots');

    this.logger.debug(CLASS_NAME, 'getHotSpots', `Fetching hot spots for organization ${organizationId}`);

    const result = await this.db.query<OrgHotSpotDbRow>(QUERY_ORG_HOT_SPOTS, [organizationId]);

    this.logger.debug(CLASS_NAME, 'getHotSpots', `Found ${result.rowCount} hot spots`);

    return result.rows.map((row) => ({
      filePath: row.file_path,
      repository: row.repository,
      teamName: row.team_name,
      churnCount: row.churn_count,
      complexity: row.complexity,
      loc: row.loc,
      riskScore: Number(row.risk_score),
      riskTier: row.risk_tier as OrgHotSpotRiskTier,
    }));
  }

  async getKnowledgeConcentration(organizationId: number): Promise<OrgProfileKnowledgeConcentration[]> {
    this.validateOrganizationId(organizationId, 'getKnowledgeConcentration');

    this.logger.debug(CLASS_NAME, 'getKnowledgeConcentration', `Fetching knowledge concentration for organization ${organizationId}`);

    const result = await this.db.query<OrgKnowledgeConcentrationDbRow>(QUERY_ORG_KNOWLEDGE_CONCENTRATION, [organizationId]);

    this.logger.debug(CLASS_NAME, 'getKnowledgeConcentration', `Found ${result.rowCount} knowledge concentration records`);

    return result.rows.map((row) => ({
      filePath: row.file_path,
      repository: row.repository,
      teamName: row.team_name,
      totalCommits: row.total_commits,
      totalContributors: row.total_contributors,
      topContributor: row.top_contributor,
      topContributorPct: Number(row.top_contributor_pct),
      concentrationRisk: row.concentration_risk as OrgConcentrationRisk,
    }));
  }

  /**
   * Get data coverage information for an organization.
   * GITX-210: Shows which teams have data in the selected timeframe.
   */
  async getDataCoverage(filters: OrgProfileFilters): Promise<OrgDataCoverage> {
    this.validateOrganizationId(filters.organizationId, 'getDataCoverage');
    this.validateTimeframe(filters.timeframeDays, 'getDataCoverage');

    this.logger.debug(CLASS_NAME, 'getDataCoverage', `Fetching data coverage for organization ${filters.organizationId}`);

    const startDate = this.getStartDate(filters.timeframeDays);

    const result = await this.db.query<OrgTeamDataCoverageDbRow>(
      QUERY_ORG_TEAM_DATA_COVERAGE,
      [filters.organizationId, startDate]
    );

    const teamStatus: OrgTeamDataStatus[] = result.rows.map((row) => ({
      teamId: row.team_id,
      teamName: row.team_name,
      commitCount: row.commit_count,
      hasJiraData: row.has_jira_data,
      hasData: row.commit_count > 0,
    }));

    const totalTeams = teamStatus.length;
    const teamsWithData = teamStatus.filter((t) => t.hasData).length;
    const teamsWithJiraData = teamStatus.filter((t) => t.hasJiraData).length;

    this.logger.debug(
      CLASS_NAME,
      'getDataCoverage',
      `Coverage: ${teamsWithData}/${totalTeams} teams with data, ${teamsWithJiraData}/${totalTeams} with Jira`
    );

    return {
      totalTeams,
      teamsWithData,
      teamsWithJiraData,
      isPartial: teamsWithData < totalTeams && totalTeams > 0,
      isJiraPartial: teamsWithJiraData < totalTeams && totalTeams > 0,
      teamStatus,
    };
  }

  // ============================================================================
  // Health Check Methods
  // ============================================================================

  async isOrganizationsTableAvailable(): Promise<boolean> {
    const result = await this.db.query<{ table_exists: boolean }>(QUERY_ORG_TABLE_EXISTS);
    return result.rows[0]?.table_exists ?? false;
  }

  async isTeamsOrgFkAvailable(): Promise<boolean> {
    const result = await this.db.query<{ column_exists: boolean }>(QUERY_TEAMS_ORG_FK_EXISTS);
    return result.rows[0]?.column_exists ?? false;
  }
}
