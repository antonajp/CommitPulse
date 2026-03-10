/**
 * Linear incremental loading orchestrator.
 *
 * Parallel to JiraIncrementalLoader -- combines auto-discovered team list
 * with configurable incremental ranges and unfinished issue refresh.
 *
 * Pattern:
 *   1. identifyLinearTeamMaxIssue() -> list of (team, maxIssueNum)
 *   2. For each team: loadTeamIssues(team, startKey, startKey+increment)
 *   3. Refresh unfinished issues (those not Done/Canceled)
 *
 * Ticket: IQS-875
 */

import { LoggerService } from '../logging/logger.js';
import { LinearRepository } from '../database/linear-repository.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import { LinearService } from './linear-service.js';
import type { LoadTeamIssuesResult } from './linear-service.js';
import type { LinearTeamMaxIssue } from '../database/linear-types.js';

// ============================================================================
// Configuration types
// ============================================================================

/**
 * Configuration for the Linear incremental loader.
 * Composed from VS Code settings.
 */
export interface LinearIncrementalLoaderConfig {
  /** Number of issues to scan beyond current max per team. Default: 200. */
  readonly increment: number;
  /** Days to look back for recently completed issues. Default: 2. */
  readonly daysAgo: number;
  /** Additional team keys to include in auto-discovery. */
  readonly additionalTeams: readonly string[];
}

/**
 * Result summary for a single team's incremental load.
 */
export interface LinearIncrementalTeamResult {
  readonly teamKey: string;
  readonly startKey: number;
  readonly endKey: number;
  readonly issuesInserted: number;
  readonly issuesSkipped: number;
  readonly issuesFailed: number;
  readonly durationMs: number;
}

/**
 * Result summary for the full incremental load run.
 */
export interface LinearIncrementalLoadResult {
  readonly teamResults: readonly LinearIncrementalTeamResult[];
  readonly unfinishedRefreshed: number;
  readonly totalInserted: number;
  readonly totalSkipped: number;
  readonly totalFailed: number;
  readonly durationMs: number;
  readonly teamCount: number;
}

// ============================================================================
// Constants
// ============================================================================

const CLASS_NAME = 'LinearIncrementalLoader';
const DEFAULT_INCREMENT = 200;
const DEFAULT_DAYS_AGO = 2;

// ============================================================================
// LinearIncrementalLoader implementation
// ============================================================================

/**
 * Orchestrates incremental Linear issue loading across all discovered teams.
 *
 * Combines:
 * - Auto-discovery: teams derived from existing data in linear_detail table
 * - Incremental loading: only fetches issues from max+1 to max+increment
 * - Unfinished refresh: re-fetches recently changed/completed issues
 *
 * Ticket: IQS-875
 */
export class LinearIncrementalLoader {
  private readonly logger: LoggerService;
  private readonly linearService: LinearService;
  private readonly linearRepo: LinearRepository;
  private readonly pipelineRepo: PipelineRepository;
  private readonly config: LinearIncrementalLoaderConfig;

  constructor(
    loaderConfig: LinearIncrementalLoaderConfig,
    linearService: LinearService,
    linearRepo: LinearRepository,
    pipelineRepo: PipelineRepository,
  ) {
    this.config = loaderConfig;
    this.linearService = linearService;
    this.linearRepo = linearRepo;
    this.pipelineRepo = pipelineRepo;
    this.logger = LoggerService.getInstance();

    this.logger.debug(CLASS_NAME, 'constructor', `LinearIncrementalLoader created: increment=${loaderConfig.increment}, daysAgo=${loaderConfig.daysAgo}`);
    this.logger.debug(CLASS_NAME, 'constructor', `Additional teams: [${loaderConfig.additionalTeams.join(', ')}]`);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Run the full incremental load: discover teams, load new issues,
   * then refresh unfinished issues.
   *
   * @param skipUnfinishedRefresh - If true, skip the unfinished issue refresh step
   * @returns Summary of the entire incremental load run
   */
  async runIncrementalLoad(skipUnfinishedRefresh = false): Promise<LinearIncrementalLoadResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'runIncrementalLoad', `Starting incremental load: increment=${this.config.increment}, daysAgo=${this.config.daysAgo}`);

    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'runIncrementalLoad',
      detail: `Incremental load: increment=${this.config.increment}, daysAgo=${this.config.daysAgo}`,
      status: 'START',
    });
    this.logger.info(CLASS_NAME, 'runIncrementalLoad', `Pipeline run started with id=${pipelineRunId}`);

    const teamResults: LinearIncrementalTeamResult[] = [];
    let unfinishedRefreshed = 0;

    try {
      // Step 1: Discover teams from DB
      const dbTeams = await this.linearRepo.identifyLinearTeamMaxIssue();
      this.logger.info(CLASS_NAME, 'runIncrementalLoad', `Discovered ${dbTeams.length} teams from database`);
      this.logDiscoveredTeams(dbTeams);

      // Step 1b: Merge configured additionalTeams (from settings.linear.teamKeys)
      // so that first-run bootstrapping works even when the DB is empty.
      const teamMaxIssues = this.mergeAdditionalTeams(dbTeams);
      this.logger.info(CLASS_NAME, 'runIncrementalLoad', `Total teams after merging configured keys: ${teamMaxIssues.length}`);

      // Step 2: Load new issues for each team incrementally
      for (const teamMax of teamMaxIssues) {
        const result = await this.loadTeamIncremental(teamMax);
        teamResults.push(result);
      }

      // Step 3: Refresh unfinished issues
      if (!skipUnfinishedRefresh) {
        this.logger.info(CLASS_NAME, 'runIncrementalLoad', `Refreshing unfinished issues (daysAgo=${this.config.daysAgo})`);
        const unfinished = await this.linearRepo.getUnfinishedLinearIssues(this.config.daysAgo);
        this.logger.info(CLASS_NAME, 'runIncrementalLoad', `Found ${unfinished.length} unfinished issues to refresh`);

        // For unfinished issues, we re-load them from the API to get updated state
        // This is done by loading each team that has unfinished issues
        const teamsToRefresh = new Set(unfinished.map((u) => u.linearKey.split('-')[0]).filter(Boolean));
        for (const teamKey of teamsToRefresh) {
          if (teamKey) {
            this.logger.debug(CLASS_NAME, 'runIncrementalLoad', `Refreshing unfinished for team: ${teamKey}`);
            // The loadTeamIssues method with startKey=0 maxKeys=0 will re-fetch
            // and the upsert will update existing records
            await this.linearService.loadTeamIssues(teamKey, { startKey: 0, maxKeys: 0 });
          }
        }
        unfinishedRefreshed = unfinished.length;
      } else {
        this.logger.info(CLASS_NAME, 'runIncrementalLoad', 'Unfinished issue refresh skipped');
      }

      await this.pipelineRepo.updatePipelineRun(pipelineRunId, 'FINISHED');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'runIncrementalLoad', `Fatal error: ${message}`);
      await this.pipelineRepo.updatePipelineRun(pipelineRunId, `ERROR: ${message.substring(0, 200)}`);
    }

    const durationMs = Date.now() - startTime;
    const totalInserted = teamResults.reduce((sum, r) => sum + r.issuesInserted, 0);
    const totalSkipped = teamResults.reduce((sum, r) => sum + r.issuesSkipped, 0);
    const totalFailed = teamResults.reduce((sum, r) => sum + r.issuesFailed, 0);

    this.logger.info(
      CLASS_NAME, 'runIncrementalLoad',
      `Incremental load complete: ${teamResults.length} teams, ${totalInserted} inserted, ${totalSkipped} skipped, ${totalFailed} failed (${durationMs}ms)`,
    );

    return {
      teamResults,
      unfinishedRefreshed,
      totalInserted,
      totalSkipped,
      totalFailed,
      durationMs,
      teamCount: teamResults.length,
    };
  }

  // --------------------------------------------------------------------------
  // Private: Team incremental loading
  // --------------------------------------------------------------------------

  private async loadTeamIncremental(teamMax: LinearTeamMaxIssue): Promise<LinearIncrementalTeamResult> {
    const startKey = teamMax.count;
    const endKey = startKey + this.config.increment;
    const teamKey = teamMax.teamKey;

    this.logger.info(
      CLASS_NAME, 'loadTeamIncremental',
      `Loading ${teamKey}: issues ${startKey} to ${endKey} (increment=${this.config.increment})`,
    );

    const loadResult: LoadTeamIssuesResult = await this.linearService.loadTeamIssues(
      teamKey,
      { startKey, maxKeys: endKey },
    );

    this.logger.info(
      CLASS_NAME, 'loadTeamIncremental',
      `${teamKey}: ${loadResult.issuesInserted} inserted, ${loadResult.issuesSkipped} skipped, ${loadResult.issuesFailed} failed (${loadResult.durationMs}ms)`,
    );

    return {
      teamKey,
      startKey,
      endKey,
      issuesInserted: loadResult.issuesInserted,
      issuesSkipped: loadResult.issuesSkipped,
      issuesFailed: loadResult.issuesFailed,
      durationMs: loadResult.durationMs,
    };
  }

  // --------------------------------------------------------------------------
  // Private: Team merging
  // --------------------------------------------------------------------------

  /**
   * Merge configured additionalTeams into the DB-discovered list.
   *
   * Any team key present in additionalTeams but NOT already discovered from
   * the database is added with count=0, causing a full initial load from
   * issue 0 to 0+increment. This solves the bootstrapping problem where a
   * fresh database has no teams to discover.
   */
  private mergeAdditionalTeams(dbTeams: readonly LinearTeamMaxIssue[]): LinearTeamMaxIssue[] {
    const discoveredKeys = new Set(dbTeams.map((t) => t.teamKey));
    const merged: LinearTeamMaxIssue[] = [...dbTeams];

    for (const teamKey of this.config.additionalTeams) {
      if (!discoveredKeys.has(teamKey)) {
        this.logger.info(
          CLASS_NAME, 'mergeAdditionalTeams',
          `Adding configured team ${teamKey} (not yet in database, will bootstrap from issue 0)`,
        );
        merged.push({ teamKey, count: 0 });
      } else {
        this.logger.debug(
          CLASS_NAME, 'mergeAdditionalTeams',
          `Configured team ${teamKey} already discovered from database`,
        );
      }
    }

    return merged;
  }

  // --------------------------------------------------------------------------
  // Private: Logging helpers
  // --------------------------------------------------------------------------

  private logDiscoveredTeams(teams: readonly LinearTeamMaxIssue[]): void {
    for (const team of teams) {
      this.logger.debug(
        CLASS_NAME, 'logDiscoveredTeams',
        `Team ${team.teamKey}: max issue = ${team.count}, will scan ${team.count} to ${team.count + this.config.increment}`,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Static: Config builder
  // --------------------------------------------------------------------------

  /**
   * Build a LinearIncrementalLoaderConfig from raw values, applying defaults.
   */
  static buildConfig(
    increment?: number,
    daysAgo?: number,
    additionalTeams?: readonly string[],
  ): LinearIncrementalLoaderConfig {
    return {
      increment: (increment !== undefined && increment > 0) ? increment : DEFAULT_INCREMENT,
      daysAgo: (daysAgo !== undefined && daysAgo >= 0) ? daysAgo : DEFAULT_DAYS_AGO,
      additionalTeams: additionalTeams ?? [],
    };
  }
}
