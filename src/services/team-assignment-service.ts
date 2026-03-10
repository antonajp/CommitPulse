/**
 * TeamAssignmentService: Primary team assignment for commit contributors.
 *
 * Converts Python GitjaTeamContributor.py (111 lines) to TypeScript:
 *   - reset_all_known_author_teams   -> resetAllKnownAuthorTeams
 *   - reset_author_teams             -> resetAuthorTeams
 *   - get_count_of_matching_commit_info_from_project_list
 *                                     -> getCountOfMatchingCommitInfoFromProjectList
 *   - _filter_series                  -> (inline filter in counting method)
 *   - update_contributor_primary_team -> updateContributorPrimaryTeam
 *   - update_all_contributors_primary_team
 *                                     -> updateAllContributorsPrimaryTeam
 *   - update_team_assignments         -> updateTeamAssignments
 *
 * Key differences from Python:
 *   - Parameterized SQL via ContributorRepository (no f-strings or SQL files)
 *   - TypeScript Map/reduce replaces pandas value_counts() and groupby
 *   - Transaction-based batch inserts replace SQL file generation
 *   - Pipeline run tracking via PipelineRepository
 *   - Debug logging throughout for troubleshooting transparency
 *
 * Processing flow:
 * 1. Get known teams from the database (contributor teams + jira projects)
 * 2. For each contributor, count Jira project key references in commit messages
 * 3. Persist counts to gitja_team_contributor table
 * 4. Determine primary team (highest count) via max_num_count_per_full_name view
 * 5. Update commit_contributors.team with primary team assignment
 *
 * Ticket: IQS-862
 */

import { LoggerService } from '../logging/logger.js';
import { ContributorRepository } from '../database/contributor-repository.js';
import { CommitJiraRepository } from '../database/commit-jira-repository.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import type { TeamContributorRow } from '../database/contributor-types.js';
import type { CommitMessageBranch } from '../database/commit-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'TeamAssignmentService';

/**
 * Table names to count after team assignment operations.
 * Matches Python GitjaTeamContributor.py line 64-66.
 */
const TEAM_ASSIGNMENT_TABLE_COUNTS: readonly string[] = [
  'gitr_pipeline_log',
  'gitr_pipeline_run',
  'gitja_team_contributor',
  'max_num_count_per_login',
  'max_num_count_per_full_name',
  'num_count_per_full_name',
];

/**
 * Result of a team assignment run.
 */
export interface TeamAssignmentResult {
  /** Number of contributor authors processed. */
  readonly authorsProcessed: number;
  /** Number of primary team updates applied. */
  readonly primaryTeamsUpdated: number;
  /** Processing time in milliseconds. */
  readonly durationMs: number;
  /** Pipeline run ID if pipeline tracking was used. */
  readonly pipelineRunId?: number;
}

/**
 * TeamAssignmentService identifies the primary Jira project team for each
 * commit contributor based on commit message patterns.
 *
 * Maps from Python GitjaTeamContributor class.
 *
 * Ticket: IQS-862
 */
export class TeamAssignmentService {
  private readonly logger: LoggerService;
  private readonly contributorRepo: ContributorRepository;
  private readonly commitJiraRepo: CommitJiraRepository;
  private readonly pipelineRepo: PipelineRepository;

  constructor(
    contributorRepo: ContributorRepository,
    commitJiraRepo: CommitJiraRepository,
    pipelineRepo: PipelineRepository,
  ) {
    this.logger = LoggerService.getInstance();
    this.contributorRepo = contributorRepo;
    this.commitJiraRepo = commitJiraRepo;
    this.pipelineRepo = pipelineRepo;

    this.logger.debug(CLASS_NAME, 'constructor', 'TeamAssignmentService created');
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Full team assignment orchestration: reset all author teams, then
   * update all contributors' primary team.
   *
   * Maps from Python GitjaTeamContributor.update_team_assignments().
   *
   * @returns Summary of the team assignment run
   */
  async updateTeamAssignments(): Promise<TeamAssignmentResult> {
    const startTime = Date.now();

    this.logger.critical(CLASS_NAME, 'updateTeamAssignments', 'Starting team assignment process');

    // Step 1: Get known teams from the database
    const knownTeams = await this.contributorRepo.getUniqueListOfContributorTeams();
    this.logger.info(CLASS_NAME, 'updateTeamAssignments', `Known teams (${knownTeams.length}): [${knownTeams.join(', ')}]`);

    // Step 2: Reset all author teams (delete and recalculate counts)
    const authorsProcessed = await this.resetAllKnownAuthorTeams(knownTeams);

    // Step 3: Update primary team for all contributors
    const primaryTeamsUpdated = await this.updateAllContributorsPrimaryTeam();

    const durationMs = Date.now() - startTime;

    this.logger.critical(CLASS_NAME, 'updateTeamAssignments', `Team assignment complete: ${authorsProcessed} authors processed, ${primaryTeamsUpdated} primary teams updated in ${durationMs}ms`);

    return {
      authorsProcessed,
      primaryTeamsUpdated,
      durationMs,
    };
  }

  /**
   * Full team assignment with pipeline run tracking.
   *
   * Wraps updateTeamAssignments() with pipeline start/end tracking
   * and table count logging.
   *
   * Maps from Python GitjaTeamContributor.__init__() pipeline start
   * and __del__() pipeline end.
   *
   * @returns Summary of the team assignment run (includes pipelineRunId)
   */
  async updateTeamAssignmentsWithPipeline(): Promise<TeamAssignmentResult> {
    this.logger.debug(CLASS_NAME, 'updateTeamAssignmentsWithPipeline', 'Starting with pipeline tracking');

    // Start pipeline run
    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'updateTeamAssignments',
      detail: 'TeamAssignmentService',
      status: 'START',
    });

    this.logger.info(CLASS_NAME, 'updateTeamAssignmentsWithPipeline', `Pipeline run started: id=${pipelineRunId}`);

    let result: TeamAssignmentResult;

    try {
      // Execute team assignment
      result = await this.updateTeamAssignments();

      // Log table counts
      this.logger.debug(CLASS_NAME, 'updateTeamAssignmentsWithPipeline', 'Logging table counts');
      await this.pipelineRepo.logTableCounts(pipelineRunId, TEAM_ASSIGNMENT_TABLE_COUNTS);

      // Update pipeline run to FINISHED
      await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FINISHED');

      this.logger.info(CLASS_NAME, 'updateTeamAssignmentsWithPipeline', `Pipeline run ${pipelineRunId} completed successfully`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'updateTeamAssignmentsWithPipeline', `Pipeline run ${pipelineRunId} failed: ${message}`);

      // Update pipeline run to FAILED
      try {
        await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FAILED');
      } catch (updateError: unknown) {
        const updateMsg = updateError instanceof Error ? updateError.message : String(updateError);
        this.logger.error(CLASS_NAME, 'updateTeamAssignmentsWithPipeline', `Failed to update pipeline status: ${updateMsg}`);
      }

      throw error;
    }

    return {
      ...result,
      pipelineRunId,
    };
  }

  // --------------------------------------------------------------------------
  // Reset operations
  // --------------------------------------------------------------------------

  /**
   * Reset teams for all known contributors.
   *
   * For each contributor in commit_contributors, deletes their existing
   * team records and recalculates based on commit message patterns.
   *
   * Maps from Python GitjaTeamContributor.reset_all_known_author_teams().
   *
   * @param knownTeams - Array of known Jira project team keys
   * @returns Number of authors processed
   */
  async resetAllKnownAuthorTeams(knownTeams: readonly string[]): Promise<number> {
    this.logger.debug(CLASS_NAME, 'resetAllKnownAuthorTeams', 'Querying all contributors for team reset');

    const contributors = await this.contributorRepo.getCommitContributors();
    this.logger.info(CLASS_NAME, 'resetAllKnownAuthorTeams', `Processing ${contributors.length} contributors`);

    let processedCount = 0;
    for (const contributor of contributors) {
      const login = contributor.login;
      const fullName = contributor.fullName ?? login;

      this.logger.debug(CLASS_NAME, 'resetAllKnownAuthorTeams', `Processing contributor: ${login} (${fullName})`);

      await this.resetAuthorTeams(login, fullName, knownTeams);
      processedCount++;
    }

    this.logger.critical(CLASS_NAME, 'resetAllKnownAuthorTeams', `Primary team assignments re-calculated for ${processedCount} contributors`);
    return processedCount;
  }

  /**
   * Reset team assignment counts for a single author.
   *
   * 1. Delete existing team contributor records for the author
   * 2. Get the author's commit messages and branch names
   * 3. Count Jira project key references in commit messages
   * 4. Filter counts to only known teams
   * 5. Insert new team contributor records
   *
   * Maps from Python GitjaTeamContributor.reset_author_teams().
   *
   * CRITICAL: Python used f-string SQL injection. This TypeScript version
   * uses parameterized queries through ContributorRepository.
   *
   * @param login - The contributor login
   * @param fullName - The contributor full name
   * @param knownTeams - Array of known Jira project team keys
   */
  async resetAuthorTeams(
    login: string,
    fullName: string,
    knownTeams: readonly string[],
  ): Promise<void> {
    this.logger.debug(CLASS_NAME, 'resetAuthorTeams', `Resetting teams for: ${login} (${fullName})`);

    // Step 1: Delete existing team records
    const deletedCount = await this.contributorRepo.deleteAuthorTeams(login);
    this.logger.debug(CLASS_NAME, 'resetAuthorTeams', `Deleted ${deletedCount} existing team records for: ${login}`);

    // Step 2: Get commit messages and branches for this author
    const commits = await this.commitJiraRepo.getCommitMsgBranchForAuthor(login);
    this.logger.debug(CLASS_NAME, 'resetAuthorTeams', `Found ${commits.length} non-merge commits for: ${login}`);

    if (commits.length === 0) {
      this.logger.debug(CLASS_NAME, 'resetAuthorTeams', `No commits to process for: ${login}`);
      return;
    }

    // Step 3: Count Jira project key references
    const counts = this.getCountOfMatchingCommitInfoFromProjectList(
      commits, knownTeams,
    );

    if (counts.size === 0) {
      this.logger.debug(CLASS_NAME, 'resetAuthorTeams', `No matching project keys found for: ${login}`);
      return;
    }

    // Step 4: Build team contributor rows for batch insert
    const rows: TeamContributorRow[] = [];
    for (const [prefix, count] of counts.entries()) {
      this.logger.debug(CLASS_NAME, 'resetAuthorTeams', `${login} has ${count} of Jira project ${prefix}`);
      rows.push({
        login,
        fullName,
        team: prefix,
        numCount: count,
      });
    }

    // Step 5: Batch insert
    await this.contributorRepo.batchUpsertTeamContributors(rows);
    this.logger.debug(CLASS_NAME, 'resetAuthorTeams', `Inserted ${rows.length} team records for: ${login}`);
  }

  // --------------------------------------------------------------------------
  // Primary team update
  // --------------------------------------------------------------------------

  /**
   * Update a single contributor's primary team assignment.
   *
   * Queries the max_num_count_per_full_name view to determine the team
   * with the highest commit reference count, then updates the contributor's
   * team field in commit_contributors.
   *
   * Maps from Python GitjaTeamContributor.update_contributor_primary_team().
   *
   * CRITICAL: Python used f-string SQL. This TypeScript version uses
   * parameterized queries.
   *
   * @param login - The contributor login
   * @param fullName - The contributor full name
   * @returns true if a primary team was found and applied, false otherwise
   */
  async updateContributorPrimaryTeam(
    login: string,
    fullName: string,
  ): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'updateContributorPrimaryTeam', `Looking up primary team for: ${fullName} (${login})`);

    const primaryTeam = await this.contributorRepo.getPrimaryTeamAssignment(fullName);

    if (primaryTeam === null) {
      this.logger.debug(CLASS_NAME, 'updateContributorPrimaryTeam', `No primary team found for: ${fullName}`);
      return false;
    }

    this.logger.debug(CLASS_NAME, 'updateContributorPrimaryTeam', `Primary team for ${fullName}: ${primaryTeam}`);
    await this.contributorRepo.updateContributorTeam(login, fullName, primaryTeam);

    this.logger.info(CLASS_NAME, 'updateContributorPrimaryTeam', `Updated team=${primaryTeam} for ${login} (${fullName})`);
    return true;
  }

  /**
   * Update primary team assignment for all contributors.
   *
   * Iterates through all contributors in commit_contributors and applies
   * the primary team from the max_num_count_per_full_name view.
   *
   * Maps from Python GitjaTeamContributor.update_all_contributors_primary_team().
   *
   * @returns Number of contributors whose primary team was updated
   */
  async updateAllContributorsPrimaryTeam(): Promise<number> {
    this.logger.debug(CLASS_NAME, 'updateAllContributorsPrimaryTeam', 'Querying all contributors for primary team update');

    const contributors = await this.contributorRepo.getCommitContributors();
    this.logger.info(CLASS_NAME, 'updateAllContributorsPrimaryTeam', `Processing ${contributors.length} contributors for primary team update`);

    let updatedCount = 0;

    for (const contributor of contributors) {
      const login = contributor.login;
      const fullName = contributor.fullName ?? login;

      const updated = await this.updateContributorPrimaryTeam(login, fullName);
      if (updated) {
        updatedCount++;
      }
    }

    this.logger.critical(CLASS_NAME, 'updateAllContributorsPrimaryTeam', `Primary team assignments applied: ${updatedCount}/${contributors.length}`);
    return updatedCount;
  }

  // --------------------------------------------------------------------------
  // Jira key counting (public for testing)
  // --------------------------------------------------------------------------

  /**
   * Count Jira project key references in commit messages, filtered to
   * only known teams/projects.
   *
   * Maps from Python GitjaTeamContributor.get_count_of_matching_commit_info_from_project_list()
   * and _filter_series().
   *
   * Python algorithm (lines 94-110):
   *   For each row in commit messages:
   *     For each project key in projectList:
   *       If KEY+"-" appears in the commit message (case-insensitive):
   *         Record the match for that row
   *         Break (only first match per row)
   *   Return value_counts() of the matched column
   *
   * Key design decision: Python only counts from commit messages (msg_match),
   * NOT from branch names. The branch matching code is commented out in the
   * Python source (lines 105-108). We preserve this exact behavior.
   *
   * @param commits - Array of commit message + branch objects
   * @param projectList - Array of known Jira project keys
   * @returns Map of project key to count (only keys in projectList)
   */
  getCountOfMatchingCommitInfoFromProjectList(
    commits: readonly Pick<CommitMessageBranch, 'commitMessage'>[] ,
    projectList: readonly string[],
  ): Map<string, number> {
    this.logger.debug(CLASS_NAME, 'getCountOfMatchingCommitInfoFromProjectList', `Counting refs in ${commits.length} commits across ${projectList.length} projects`);

    if (commits.length === 0 || projectList.length === 0) {
      this.logger.debug(CLASS_NAME, 'getCountOfMatchingCommitInfoFromProjectList', 'Empty input, returning empty counts');
      return new Map();
    }

    // Track matches per commit message (only first match per row)
    const matchResults: string[] = [];

    for (const commit of commits) {
      const upperMsg = commit.commitMessage.toUpperCase();

      let matched = false;
      for (const proj of projectList) {
        // Python: str(s).upper()+"-" in str(row['commit_message']).upper()
        if (upperMsg.includes(`${proj.toUpperCase()}-`)) {
          matchResults.push(proj);
          matched = true;
          this.logger.trace(CLASS_NAME, 'getCountOfMatchingCommitInfoFromProjectList', `Matched ${proj} in: ${commit.commitMessage.substring(0, 60)}`);
          break; // Only first match per row (matching Python break behavior)
        }
      }

      if (!matched) {
        this.logger.trace(CLASS_NAME, 'getCountOfMatchingCommitInfoFromProjectList', `No match in: ${commit.commitMessage.substring(0, 60)}`);
      }
    }

    // Count occurrences (equivalent to pandas value_counts())
    const counts = new Map<string, number>();
    for (const match of matchResults) {
      counts.set(match, (counts.get(match) ?? 0) + 1);
    }

    // Filter to only known teams (equivalent to Python _filter_series)
    // Since we only search for keys in projectList, the result is already filtered.
    // However, we log the results for transparency.
    this.logger.debug(CLASS_NAME, 'getCountOfMatchingCommitInfoFromProjectList', `Found ${counts.size} unique project matches from ${matchResults.length} total matches`);
    for (const [key, count] of counts.entries()) {
      this.logger.trace(CLASS_NAME, 'getCountOfMatchingCommitInfoFromProjectList', `  ${key}: ${count}`);
    }

    return counts;
  }
}
