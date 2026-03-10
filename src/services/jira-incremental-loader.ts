/**
 * Jira incremental loading orchestrator.
 *
 * Converts the Python GitrScheduleRunner._run_jira_update() logic (lines 130-145)
 * to TypeScript, combining auto-discovered project list with configurable
 * incremental ranges and unfinished issue refresh.
 *
 * Python pattern:
 *   1. identify_jira_proj_max_issue() -> list of (project, maxIssueNum)
 *   2. For each project: load_all_project_issues(proj, startKey, startKey+increment)
 *   3. update_unfinished_change_logs2(days_ago) -> refresh recently changed issues
 *
 * TypeScript improvements:
 *   - JQL search instead of sequential key iteration
 *   - Configurable increment and daysAgo via VS Code settings
 *   - Auto-discover projects from DB data (no hardcoded project list)
 *   - Parameterized SQL (no f-string injection)
 *   - Structured logging with level controls
 *
 * Ticket: IQS-860
 */

import { LoggerService } from '../logging/logger.js';
import { JiraRepository } from '../database/jira-repository.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import { JiraService } from './jira-service.js';
import { JiraChangelogService } from './jira-changelog-service.js';
import type { LoadProjectIssuesResult } from './jira-service.js';
import type { JiraProjectMaxIssue } from '../database/jira-types.js';
import type { UpdateUnfinishedResult } from './jira-changelog-types.js';

// ============================================================================
// Configuration types
// ============================================================================

/**
 * Configuration for the incremental loader.
 * Composed from VS Code settings.
 */
export interface IncrementalLoaderConfig {
  /**
   * Number of issues to scan beyond the current max per project.
   * Maps from Python increment parameter (default 200).
   */
  readonly increment: number;

  /**
   * Number of days to look back for recently completed issues
   * during the unfinished issue refresh step.
   * Maps from Python days_ago parameter (default 2).
   */
  readonly daysAgo: number;

  /**
   * Additional Jira project keys to include in auto-discovery.
   * Replaces Python's hardcoded PROJ/CRM additions.
   */
  readonly additionalProjects: readonly string[];
}

/**
 * Result summary for a single project's incremental load.
 */
export interface IncrementalProjectResult {
  /** The project key processed. */
  readonly projectKey: string;
  /** Max issue number found in the DB before loading. */
  readonly startKey: number;
  /** Max issue number scanned up to (startKey + increment). */
  readonly endKey: number;
  /** Issues newly inserted. */
  readonly issuesInserted: number;
  /** Issues skipped (already known). */
  readonly issuesSkipped: number;
  /** Issues that failed to load. */
  readonly issuesFailed: number;
  /** Duration in milliseconds. */
  readonly durationMs: number;
}

/**
 * Result summary for the full incremental load run.
 */
export interface IncrementalLoadResult {
  /** Results per project. */
  readonly projectResults: readonly IncrementalProjectResult[];
  /** Unfinished issue refresh results (null if skipped). */
  readonly unfinishedResult: UpdateUnfinishedResult | null;
  /** Total issues inserted across all projects. */
  readonly totalInserted: number;
  /** Total issues skipped across all projects. */
  readonly totalSkipped: number;
  /** Total issues failed across all projects. */
  readonly totalFailed: number;
  /** Total duration in milliseconds. */
  readonly durationMs: number;
  /** Number of projects auto-discovered. */
  readonly projectCount: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Class name for structured logging. */
const CLASS_NAME = 'JiraIncrementalLoader';

/** Default increment if not configured. */
const DEFAULT_INCREMENT = 200;

/** Default daysAgo if not configured. */
const DEFAULT_DAYS_AGO = 2;

// ============================================================================
// JiraIncrementalLoader implementation
// ============================================================================

/**
 * Orchestrates incremental Jira issue loading across all discovered projects.
 *
 * Combines:
 * - Auto-discovery: projects derived from existing data in jira_detail table
 * - Incremental loading: only fetches issues from max+1 to max+increment
 * - Unfinished refresh: re-fetches recently changed/completed issues
 *
 * Maps from Python GitrScheduleRunner._run_jira_update() with configurable
 * increment and daysAgo parameters from VS Code settings.
 */
export class JiraIncrementalLoader {
  private readonly logger: LoggerService;
  private readonly jiraService: JiraService;
  private readonly changelogService: JiraChangelogService;
  private readonly jiraRepo: JiraRepository;
  private readonly pipelineRepo: PipelineRepository;
  private readonly config: IncrementalLoaderConfig;

  constructor(
    loaderConfig: IncrementalLoaderConfig,
    jiraService: JiraService,
    changelogService: JiraChangelogService,
    jiraRepo: JiraRepository,
    pipelineRepo: PipelineRepository,
  ) {
    this.config = loaderConfig;
    this.jiraService = jiraService;
    this.changelogService = changelogService;
    this.jiraRepo = jiraRepo;
    this.pipelineRepo = pipelineRepo;
    this.logger = LoggerService.getInstance();

    this.logger.debug(CLASS_NAME, 'constructor', `JiraIncrementalLoader created: increment=${loaderConfig.increment}, daysAgo=${loaderConfig.daysAgo}`);
    this.logger.debug(CLASS_NAME, 'constructor', `Additional projects: [${loaderConfig.additionalProjects.join(', ')}]`);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Run the full incremental load: discover projects, load new issues,
   * then refresh unfinished issues.
   *
   * Maps from Python GitrScheduleRunner._run_jira_update(increment, days_ago).
   *
   * @param skipUnfinishedRefresh - If true, skip the unfinished issue refresh step
   * @returns Summary of the entire incremental load run
   */
  async runIncrementalLoad(skipUnfinishedRefresh = false): Promise<IncrementalLoadResult> {
    const startTime = Date.now();
    this.logger.info(CLASS_NAME, 'runIncrementalLoad', `Starting incremental load: increment=${this.config.increment}, daysAgo=${this.config.daysAgo}`);

    // Start pipeline tracking
    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'runIncrementalLoad',
      detail: `Incremental load: increment=${this.config.increment}, daysAgo=${this.config.daysAgo}`,
      status: 'START',
    });
    this.logger.info(CLASS_NAME, 'runIncrementalLoad', `Pipeline run started with id=${pipelineRunId}`);

    const projectResults: IncrementalProjectResult[] = [];
    let unfinishedResult: UpdateUnfinishedResult | null = null;

    try {
      // Step 1: Discover projects from DB
      // Maps from Python: jira_projs = self.conn.identify_jira_proj_max_issue()
      const projectMaxIssues = await this.jiraRepo.identifyJiraProjMaxIssue();
      this.logger.info(CLASS_NAME, 'runIncrementalLoad', `Discovered ${projectMaxIssues.length} projects from database`);

      this.logDiscoveredProjects(projectMaxIssues);

      // Step 2: Load new issues for each project incrementally
      // Maps from Python: for project in jira_projs: ja.load_all_project_issues(proj, startKey, startKey+increment)
      for (const projectMax of projectMaxIssues) {
        const result = await this.loadProjectIncremental(projectMax);
        projectResults.push(result);
      }

      // Step 3: Refresh unfinished issues (changelog + dev status)
      // Maps from Python: ja.update_unfinished_change_logs2(days_ago)
      if (!skipUnfinishedRefresh) {
        this.logger.info(CLASS_NAME, 'runIncrementalLoad', `Refreshing unfinished issues (daysAgo=${this.config.daysAgo})`);

        // Build project key list from discovered + additional projects
        const projectKeys = this.buildProjectKeyList(projectMaxIssues);
        this.logger.debug(CLASS_NAME, 'runIncrementalLoad', `Project keys for unfinished refresh: [${projectKeys.join(', ')}]`);

        unfinishedResult = await this.changelogService.updateUnfinishedIssues(
          projectKeys,
          this.config.daysAgo,
        );

        this.logger.info(
          CLASS_NAME, 'runIncrementalLoad',
          `Unfinished refresh complete: ${unfinishedResult.issuesProcessed} processed, ${unfinishedResult.issuesFailed} failed`,
        );
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
    const totalInserted = projectResults.reduce((sum, r) => sum + r.issuesInserted, 0);
    const totalSkipped = projectResults.reduce((sum, r) => sum + r.issuesSkipped, 0);
    const totalFailed = projectResults.reduce((sum, r) => sum + r.issuesFailed, 0);

    this.logger.info(
      CLASS_NAME, 'runIncrementalLoad',
      `Incremental load complete: ${projectResults.length} projects, ${totalInserted} inserted, ${totalSkipped} skipped, ${totalFailed} failed (${durationMs}ms)`,
    );

    return {
      projectResults,
      unfinishedResult,
      totalInserted,
      totalSkipped,
      totalFailed,
      durationMs,
      projectCount: projectResults.length,
    };
  }

  // --------------------------------------------------------------------------
  // Private: Project incremental loading
  // --------------------------------------------------------------------------

  /**
   * Load new issues for a single project using the incremental range.
   *
   * Maps from Python:
   *   startKey = int(project['count'])
   *   ja.load_all_project_issues(proj, startKey, startKey+increment)
   *
   * @param projectMax - The project key and its current max issue number
   * @returns Results for this project's incremental load
   */
  private async loadProjectIncremental(projectMax: JiraProjectMaxIssue): Promise<IncrementalProjectResult> {
    const startKey = projectMax.count;
    const endKey = startKey + this.config.increment;
    const projectKey = projectMax.jiraKey;

    this.logger.info(
      CLASS_NAME, 'loadProjectIncremental',
      `Loading ${projectKey}: issues ${startKey} to ${endKey} (increment=${this.config.increment})`,
    );

    const loadResult: LoadProjectIssuesResult = await this.jiraService.loadProjectIssues(
      projectKey,
      { startKey, maxKeys: endKey },
    );

    this.logger.info(
      CLASS_NAME, 'loadProjectIncremental',
      `${projectKey}: ${loadResult.issuesInserted} inserted, ${loadResult.issuesSkipped} skipped, ${loadResult.issuesFailed} failed (${loadResult.durationMs}ms)`,
    );

    return {
      projectKey,
      startKey,
      endKey,
      issuesInserted: loadResult.issuesInserted,
      issuesSkipped: loadResult.issuesSkipped,
      issuesFailed: loadResult.issuesFailed,
      durationMs: loadResult.durationMs,
    };
  }

  // --------------------------------------------------------------------------
  // Private: Project key list building
  // --------------------------------------------------------------------------

  /**
   * Build a project key list from discovered projects and additional configured projects.
   * Used for the unfinished issue refresh step.
   *
   * @param projectMaxIssues - Discovered projects from the database
   * @returns Deduplicated sorted list of project keys
   */
  private buildProjectKeyList(projectMaxIssues: readonly JiraProjectMaxIssue[]): string[] {
    const keySet = new Set<string>();

    for (const projectMax of projectMaxIssues) {
      keySet.add(projectMax.jiraKey);
    }

    for (const additional of this.config.additionalProjects) {
      keySet.add(additional);
    }

    const keys = Array.from(keySet).sort();
    this.logger.debug(CLASS_NAME, 'buildProjectKeyList', `Built project key list: [${keys.join(', ')}] (${keys.length} total)`);
    return keys;
  }

  // --------------------------------------------------------------------------
  // Private: Logging helpers
  // --------------------------------------------------------------------------

  /**
   * Log details of discovered projects for diagnostic visibility.
   */
  private logDiscoveredProjects(projects: readonly JiraProjectMaxIssue[]): void {
    for (const proj of projects) {
      this.logger.debug(
        CLASS_NAME, 'logDiscoveredProjects',
        `Project ${proj.jiraKey}: max issue = ${proj.count}, will scan ${proj.count} to ${proj.count + this.config.increment}`,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Static: Config builder
  // --------------------------------------------------------------------------

  /**
   * Build an IncrementalLoaderConfig from raw values, applying defaults.
   *
   * @param increment - Issue scan increment (default 200)
   * @param daysAgo - Days to look back for unfinished refresh (default 2)
   * @param additionalProjects - Extra project keys to include
   * @returns A validated IncrementalLoaderConfig
   */
  static buildConfig(
    increment?: number,
    daysAgo?: number,
    additionalProjects?: readonly string[],
  ): IncrementalLoaderConfig {
    return {
      increment: (increment !== undefined && increment > 0) ? increment : DEFAULT_INCREMENT,
      daysAgo: (daysAgo !== undefined && daysAgo >= 0) ? daysAgo : DEFAULT_DAYS_AGO,
      additionalProjects: additionalProjects ?? [],
    };
  }
}
