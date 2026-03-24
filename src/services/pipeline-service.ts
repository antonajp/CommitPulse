/**
 * PipelineService: Full analytics pipeline orchestrator.
 *
 * Converts Python GitrScheduleRunner.run_gitja() to TypeScript:
 *   run_gitja           -> runPipeline
 *   _run_gitr            -> step: gitCommitExtraction
 *   GitHubRelate         -> step: githubContributorSync
 *   _run_jira_update     -> steps: jiraIssueLoading + jiraChangelogUpdate
 *   _run_gitja_data_enhancements -> steps: commitJiraLinking + teamAssignment
 *
 * Key differences from Python:
 *   - VS Code command + vscode.window.withProgress replaces schedule library
 *   - Configurable step subset via gitrx.pipeline.steps setting
 *   - Graceful degradation: error in one step does not abort others
 *   - Pipeline run tracking in gitr_pipeline_run table
 *   - Table counts logged at end of run
 *   - Structured logging throughout with level controls
 *
 * Ticket: IQS-864
 */

import { LoggerService } from '../logging/logger.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import { GitAnalysisService } from './git-analysis-service.js';
import { GitHubService } from './github-service.js';
import { JiraIncrementalLoader } from './jira-incremental-loader.js';
import { LinearIncrementalLoader } from './linear-incremental-loader.js';
import type { LinearIncrementalLoadResult } from './linear-incremental-loader.js';
import { DataEnhancerService } from './data-enhancer-service.js';
import { TeamAssignmentService } from './team-assignment-service.js';
import type { RepositoryEntry } from '../config/settings.js';
import type { AnalysisRunResult } from './git-analysis-types.js';
import type { GitHubSyncResult } from './github-service-types.js';
import type { IncrementalLoadResult } from './jira-incremental-loader.js';
import type { DataEnhancerResult } from './data-enhancer-service.js';
import type { TeamAssignmentResult } from './team-assignment-service.js';
import {
  ALL_PIPELINE_STEPS,
  PIPELINE_STEP_LABELS,
  type PipelineStepId,
  type PipelineConfig,
  type PipelineStepResult,
  type PipelineStepStatus,
  type PipelineRunResult,
  type PipelineRunStatus,
} from './pipeline-service-types.js';

// Re-export types for consumers
export type {
  PipelineStepId,
  PipelineConfig,
  PipelineStepResult,
  PipelineRunResult,
  PipelineRunStatus,
} from './pipeline-service-types.js';

export {
  ALL_PIPELINE_STEPS,
  PIPELINE_STEP_LABELS,
} from './pipeline-service-types.js';

/** Class name for structured logging. */
const CLASS_NAME = 'PipelineService';

/** Tables to count at end of pipeline run. Matches Python log_table_counts(). */
const PIPELINE_TABLE_COUNTS: readonly string[] = [
  'commit_history', 'commit_contributors', 'commit_directory',
  'commit_files', 'commit_files_types', 'commit_branch_relationship',
  'commit_jira', 'commit_linear', 'commit_msg_words', 'commit_tags',
  'jira_detail', 'jira_history', 'linear_detail',
  'gitr_pipeline_run', 'gitr_pipeline_log', 'gitja_team_contributor',
];

/** Progress callback for VS Code. Maps to vscode.Progress<{ message?, increment? }>. */
export interface PipelineProgressCallback {
  report(value: { message?: string; increment?: number }): void;
}

/** Cancellation token for user abort. Maps to vscode.CancellationToken. */
export interface PipelineCancellationToken {
  readonly isCancellationRequested: boolean;
}

/**
 * Orchestrates the full analytics pipeline sequence:
 * 1. Git commit extraction (per configured repo)
 * 2. GitHub contributor sync (per configured repo)
 * 3. Jira issue loading (incremental)
 * 4. Jira changelog/unfinished update
 * 5. Commit-Jira linking
 * 6. Team assignment calculation
 *
 * Each step is executed independently with error isolation.
 * A failure in one step logs the error and continues with the next step.
 *
 * Maps from Python GitrScheduleRunner.run_gitja().
 */
export class PipelineService {
  private readonly logger: LoggerService;
  private readonly pipelineRepo: PipelineRepository;
  private readonly gitAnalysisService: GitAnalysisService;
  private readonly githubService: GitHubService | null;
  private readonly jiraIncrementalLoader: JiraIncrementalLoader | null;
  private readonly linearIncrementalLoader: LinearIncrementalLoader | null;
  private readonly dataEnhancerService: DataEnhancerService;
  private readonly teamAssignmentService: TeamAssignmentService;
  private readonly repositories: readonly RepositoryEntry[];
  private readonly config: PipelineConfig;

  constructor(
    pipelineRepo: PipelineRepository,
    gitAnalysisService: GitAnalysisService,
    githubService: GitHubService | null,
    jiraIncrementalLoader: JiraIncrementalLoader | null,
    linearIncrementalLoader: LinearIncrementalLoader | null,
    dataEnhancerService: DataEnhancerService,
    teamAssignmentService: TeamAssignmentService,
    repositories: readonly RepositoryEntry[],
    config: PipelineConfig,
  ) {
    this.pipelineRepo = pipelineRepo;
    this.gitAnalysisService = gitAnalysisService;
    this.githubService = githubService;
    this.jiraIncrementalLoader = jiraIncrementalLoader;
    this.linearIncrementalLoader = linearIncrementalLoader;
    this.dataEnhancerService = dataEnhancerService;
    this.teamAssignmentService = teamAssignmentService;
    this.repositories = repositories;
    this.config = config;
    this.logger = LoggerService.getInstance();

    this.logger.debug(CLASS_NAME, 'constructor', `PipelineService created with ${config.steps.length} steps enabled`);
    this.logger.debug(CLASS_NAME, 'constructor', `Steps: [${config.steps.join(', ')}]`);
    this.logger.debug(CLASS_NAME, 'constructor', `Repositories: ${repositories.length}`);
    this.logger.debug(CLASS_NAME, 'constructor', `Linear loader: ${linearIncrementalLoader ? 'enabled' : 'disabled'}`);
  }

  /**
   * Execute the full pipeline run. Maps from Python GitrScheduleRunner.run_gitja().
   */
  async runPipeline(
    progress?: PipelineProgressCallback,
    cancellationToken?: PipelineCancellationToken,
  ): Promise<PipelineRunResult> {
    const startTime = Date.now();
    this.logger.critical(CLASS_NAME, 'runPipeline', 'Starting full pipeline run');
    this.logger.info(CLASS_NAME, 'runPipeline', `Steps to execute: [${this.config.steps.join(', ')}]`);

    // Start pipeline run tracking
    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'runPipeline',
      detail: `Full pipeline run: ${this.config.steps.length} steps, ${this.repositories.length} repos`,
      status: 'START',
    });
    this.logger.info(CLASS_NAME, 'runPipeline', `Pipeline run started with id=${pipelineRunId}`);
    this.logger.setPipelineRunId(pipelineRunId);

    const stepResults: PipelineStepResult[] = [];
    let gitAnalysisResult: AnalysisRunResult | null = null;
    let githubSyncResult: GitHubSyncResult | null = null;
    let jiraLoadResult: IncrementalLoadResult | null = null;
    let linearLoadResult: LinearIncrementalLoadResult | null = null;
    let dataEnhancerResult: DataEnhancerResult | null = null;
    let teamAssignmentResult: TeamAssignmentResult | null = null;

    const totalSteps = this.config.steps.length;
    const incrementPerStep = totalSteps > 0 ? Math.floor(100 / totalSteps) : 0;

    // Execute each enabled step sequentially
    for (let i = 0; i < this.config.steps.length; i++) {
      const stepId = this.config.steps[i]!;

      // Check cancellation before each step
      if (cancellationToken?.isCancellationRequested) {
        this.logger.warn(CLASS_NAME, 'runPipeline', `Pipeline cancelled by user before step: ${stepId}`);
        const remainingSteps = this.config.steps.slice(i);
        for (const skippedStep of remainingSteps) {
          stepResults.push(this.buildSkippedResult(skippedStep, 'Cancelled by user'));
        }
        break;
      }

      const label = PIPELINE_STEP_LABELS[stepId];
      this.logger.info(CLASS_NAME, 'runPipeline', `Step ${i + 1}/${totalSteps}: ${label}`);
      progress?.report({ message: `Step ${i + 1}/${totalSteps}: ${label}`, increment: incrementPerStep });

      const stepResult = await this.executeStep(stepId, pipelineRunId);
      stepResults.push(stepResult);

      // Store detailed results based on step
      switch (stepId) {
        case 'gitCommitExtraction':
          if (stepResult.status === 'SUCCESS') {
            gitAnalysisResult = this.lastGitAnalysisResult;
          }
          break;
        case 'githubContributorSync':
          if (stepResult.status === 'SUCCESS') {
            githubSyncResult = this.lastGithubSyncResult;
          }
          break;
        case 'jiraIssueLoading':
        case 'jiraChangelogUpdate':
          if (stepResult.status === 'SUCCESS') {
            jiraLoadResult = this.lastJiraLoadResult;
          }
          break;
        case 'commitJiraLinking':
          if (stepResult.status === 'SUCCESS') {
            dataEnhancerResult = this.lastDataEnhancerResult;
          }
          break;
        case 'linearIssueLoading':
        case 'linearChangelogUpdate':
          if (stepResult.status === 'SUCCESS') {
            linearLoadResult = this.lastLinearLoadResult;
          }
          break;
        case 'commitLinearLinking':
          if (stepResult.status === 'SUCCESS') {
            dataEnhancerResult = this.lastDataEnhancerResult;
          }
          break;
        case 'teamAssignment':
          if (stepResult.status === 'SUCCESS') {
            teamAssignmentResult = this.lastTeamAssignmentResult;
          }
          break;
      }

      this.logger.info(CLASS_NAME, 'runPipeline', `Step ${stepId}: ${stepResult.status} (${stepResult.durationMs}ms) - ${stepResult.summary}`);
    }

    // Log table counts at end of run
    const tableCounts = await this.safeLogTableCounts(pipelineRunId);

    // Determine overall status
    const status = this.determineOverallStatus(stepResults);

    // Update pipeline run status
    const pipelineStatus = status === 'FAILED' ? 'ERROR' : 'FINISHED';
    await this.pipelineRepo.updatePipelineRun(pipelineRunId, pipelineStatus);

    const totalDurationMs = Date.now() - startTime;

    this.logFinalSummary(stepResults, tableCounts, totalDurationMs);

    this.logger.critical(CLASS_NAME, 'runPipeline', `Pipeline run complete: status=${status}, duration=${totalDurationMs}ms`);

    return {
      pipelineRunId,
      status,
      stepResults,
      totalDurationMs,
      tableCounts,
      gitAnalysisResult,
      githubSyncResult,
      jiraLoadResult,
      linearLoadResult,
      dataEnhancerResult,
      teamAssignmentResult,
    };
  }

  /** Build a PipelineConfig from raw configuration values. GITX-130: Added selectedRepository parameter. GITX-131: Added useGitLogAll. */
  static buildConfig(
    steps?: readonly PipelineStepId[],
    jiraIncrement?: number,
    jiraDaysAgo?: number,
    jiraAdditionalProjects?: readonly string[],
    jiraKeyAliases?: Readonly<Record<string, string>>,
    linearTeamKeys?: readonly string[],
    sinceDate?: string,
    forceFullExtraction?: boolean,
    selectedRepository?: string,
    useGitLogAll?: boolean,
  ): PipelineConfig {
    const effectiveSteps = (steps && steps.length > 0) ? steps : ALL_PIPELINE_STEPS;
    return {
      steps: effectiveSteps,
      jiraIncrement: (jiraIncrement !== undefined && jiraIncrement > 0) ? jiraIncrement : 200,
      jiraDaysAgo: (jiraDaysAgo !== undefined && jiraDaysAgo >= 0) ? jiraDaysAgo : 2,
      jiraAdditionalProjects: jiraAdditionalProjects ?? [],
      jiraKeyAliases: jiraKeyAliases ?? {},
      linearTeamKeys: linearTeamKeys ?? [],
      sinceDate,
      forceFullExtraction,
      selectedRepository,
      useGitLogAll,
    };
  }

  /** Validate a list of step IDs, filtering out any invalid entries. */
  static validateSteps(steps: readonly string[]): PipelineStepId[] {
    const validSet = new Set<string>(ALL_PIPELINE_STEPS);
    return steps.filter((s) => validSet.has(s)) as PipelineStepId[];
  }

  /** Temporary storage for detailed step results. */
  private lastGitAnalysisResult: AnalysisRunResult | null = null;
  private lastGithubSyncResult: GitHubSyncResult | null = null;
  private lastJiraLoadResult: IncrementalLoadResult | null = null;
  private lastLinearLoadResult: LinearIncrementalLoadResult | null = null;
  private lastDataEnhancerResult: DataEnhancerResult | null = null;
  private lastTeamAssignmentResult: TeamAssignmentResult | null = null;

  /** Execute a single pipeline step with error isolation. Errors do NOT propagate. */
  private async executeStep(
    stepId: PipelineStepId,
    pipelineRunId: number,
  ): Promise<PipelineStepResult> {
    const startTime = Date.now();
    const label = PIPELINE_STEP_LABELS[stepId];

    this.logger.debug(CLASS_NAME, 'executeStep', `Executing step: ${stepId} (${label})`);

    try {
      const summary = await this.dispatchStep(stepId, pipelineRunId);
      const durationMs = Date.now() - startTime;

      this.logger.debug(CLASS_NAME, 'executeStep', `Step ${stepId} completed successfully in ${durationMs}ms`);

      return {
        stepId,
        label,
        status: 'SUCCESS' as PipelineStepStatus,
        durationMs,
        summary,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(CLASS_NAME, 'executeStep', `Step ${stepId} failed after ${durationMs}ms: ${message}`);
      if (error instanceof Error && error.stack) {
        this.logger.debug(CLASS_NAME, 'executeStep', `Stack trace: ${error.stack}`);
      }

      // Log error to pipeline run
      try {
        await this.pipelineRepo.insertPipelineLog({
          parentId: pipelineRunId,
          className: CLASS_NAME,
          context: `executeStep.${stepId}`,
          detail: `Step failed: ${message.substring(0, 500)}`,
          msgLevel: 4, // ERROR level
        });
      } catch (logError: unknown) {
        const logMsg = logError instanceof Error ? logError.message : String(logError);
        this.logger.warn(CLASS_NAME, 'executeStep', `Failed to log step error to pipeline: ${logMsg}`);
      }

      return {
        stepId,
        label,
        status: 'ERROR' as PipelineStepStatus,
        durationMs,
        summary: `Failed: ${message.substring(0, 200)}`,
        error: message,
      };
    }
  }

  /** Dispatch execution to the appropriate service for a step. */
  private async dispatchStep(
    stepId: PipelineStepId,
    _pipelineRunId: number,
  ): Promise<string> {
    switch (stepId) {
      case 'gitCommitExtraction':
        return this.runGitCommitExtraction();
      case 'githubContributorSync':
        return this.runGithubContributorSync();
      case 'jiraIssueLoading':
        return this.runJiraIssueLoading();
      case 'jiraChangelogUpdate':
        return this.runJiraChangelogUpdate();
      case 'commitJiraLinking':
        return this.runCommitJiraLinking();
      case 'linearIssueLoading':
        return this.runLinearIssueLoading();
      case 'linearChangelogUpdate':
        return this.runLinearChangelogUpdate();
      case 'commitLinearLinking':
        return this.runCommitLinearLinking();
      case 'teamAssignment':
        return this.runTeamAssignment();
      default: {
        // Exhaustive check
        const _exhaustive: never = stepId;
        throw new Error(`Unknown pipeline step: ${_exhaustive}`);
      }
    }
  }

  /**
   * Step 1: Git commit extraction. Maps from Python _run_gitr().
   * IQS-931: Pass global sinceDate to GitAnalysisService. Per-repo startDate
   * is handled inside GitAnalysisService.analyzeRepository().
   * GITX-123: Pass forceFullExtraction to ignore database watermarks.
   * GITX-130: Filter to selected repository when specified in config.
   */
  private async runGitCommitExtraction(): Promise<string> {
    const modeLabel = this.config.forceFullExtraction ? 'Full' : 'Incremental';

    // GITX-130: Filter to selected repository if specified
    let reposToProcess = this.repositories;
    if (this.config.selectedRepository) {
      const targetRepo = this.repositories.find(r => r.name === this.config.selectedRepository);
      if (!targetRepo) {
        this.logger.error(CLASS_NAME, 'runGitCommitExtraction', `Selected repository not found: ${this.config.selectedRepository}`);
        return `Repository not found: ${this.config.selectedRepository}`;
      }
      reposToProcess = [targetRepo];
      this.logger.info(CLASS_NAME, 'runGitCommitExtraction', `Filtering to single repository: ${this.config.selectedRepository}`);
    }

    this.logger.info(CLASS_NAME, 'runGitCommitExtraction', `Extracting commits from ${reposToProcess.length} repositories (mode: ${modeLabel})`);

    if (reposToProcess.length === 0) {
      this.logger.warn(CLASS_NAME, 'runGitCommitExtraction', 'No repositories configured in gitrx.repositories setting');
      return 'No repositories configured (skipped)';
    }

    // IQS-931: Pass global sinceDate from pipeline config
    // GITX-123: Pass forceFullExtraction to ignore database watermarks
    // GITX-131: Pass useGitLogAll for fast extraction mode
    const options: { sinceDate?: string; forceFullExtraction?: boolean; useGitLogAll?: boolean } = {};
    if (this.config.sinceDate) {
      options.sinceDate = this.config.sinceDate;
    }
    if (this.config.forceFullExtraction) {
      options.forceFullExtraction = true;
      this.logger.info(CLASS_NAME, 'runGitCommitExtraction', 'Full extraction mode: ignoring database watermarks');
    }
    if (this.config.useGitLogAll) {
      options.useGitLogAll = true;
      this.logger.info(CLASS_NAME, 'runGitCommitExtraction', 'Fast extraction mode: using git log --all');
    }
    this.logger.debug(CLASS_NAME, 'runGitCommitExtraction', `Global sinceDate: ${this.config.sinceDate ?? '(none)'}, forceFullExtraction: ${this.config.forceFullExtraction ?? false}, useGitLogAll: ${this.config.useGitLogAll ?? false}`);

    const result: AnalysisRunResult = await this.gitAnalysisService.analyzeRepositories(reposToProcess, options);
    this.lastGitAnalysisResult = result;

    const totalCommits = result.repoResults.reduce((sum, r) => sum + r.commitsInserted, 0);
    const totalBranches = result.repoResults.reduce((sum, r) => sum + r.branchesProcessed, 0);

    this.logger.info(CLASS_NAME, 'runGitCommitExtraction', `Extracted ${totalCommits} new commits from ${totalBranches} branches across ${result.repoResults.length} repos (mode: ${modeLabel})`);

    const repoLabel = this.config.selectedRepository ? ` (${this.config.selectedRepository})` : '';
    return `${totalCommits} commits from ${totalBranches} branches across ${result.repoResults.length} repos${repoLabel} (${result.status}, ${modeLabel})`;
  }

  /** Step 2: GitHub contributor sync. GITX-130: Filter to selected repository when specified. */
  private async runGithubContributorSync(): Promise<string> {
    if (!this.githubService) {
      this.logger.warn(CLASS_NAME, 'runGithubContributorSync', 'GitHub service not available (token or org not configured)');
      return 'GitHub service not configured (skipped)';
    }

    // GITX-130: Filter to selected repository if specified
    let reposToProcess = this.repositories;
    if (this.config.selectedRepository) {
      const targetRepo = this.repositories.find(r => r.name === this.config.selectedRepository);
      if (!targetRepo) {
        this.logger.warn(CLASS_NAME, 'runGithubContributorSync', `Selected repository not found: ${this.config.selectedRepository}, skipping GitHub sync`);
        return `Repository not found: ${this.config.selectedRepository} (skipped)`;
      }
      reposToProcess = [targetRepo];
      this.logger.info(CLASS_NAME, 'runGithubContributorSync', `Filtering to single repository: ${this.config.selectedRepository}`);
    }

    const repoNames = reposToProcess.map((r) => r.name);
    if (repoNames.length === 0) {
      this.logger.warn(CLASS_NAME, 'runGithubContributorSync', 'No repositories configured for GitHub sync');
      return 'No repositories configured (skipped)';
    }

    this.logger.info(CLASS_NAME, 'runGithubContributorSync', `Syncing GitHub contributors for ${repoNames.length} repos: [${repoNames.join(', ')}]`);

    const result: GitHubSyncResult = await this.githubService.syncAll(repoNames);
    this.lastGithubSyncResult = result;

    const totalInserted = result.contributorResults.reduce((sum, r) => sum + r.contributorsInserted, 0);
    const totalUpdated = result.contributorResults.reduce((sum, r) => sum + r.contributorsUpdated, 0);

    this.logger.info(CLASS_NAME, 'runGithubContributorSync', `GitHub sync complete: ${totalInserted} inserted, ${totalUpdated} updated`);

    return `${totalInserted} contributors inserted, ${totalUpdated} updated (${result.totalDurationMs}ms)`;
  }

  /** Step 3: Jira issue loading (incremental, without unfinished refresh). */
  private async runJiraIssueLoading(): Promise<string> {
    if (!this.jiraIncrementalLoader) {
      this.logger.warn(CLASS_NAME, 'runJiraIssueLoading', 'Jira incremental loader not available (Jira not configured)');
      return 'Jira not configured (skipped)';
    }

    this.logger.info(CLASS_NAME, 'runJiraIssueLoading', `Loading Jira issues incrementally (increment=${this.config.jiraIncrement})`);

    // Run incremental load but SKIP the unfinished refresh (handled in next step)
    const result: IncrementalLoadResult = await this.jiraIncrementalLoader.runIncrementalLoad(
      /* skipUnfinishedRefresh= */ true,
    );
    this.lastJiraLoadResult = result;

    this.logger.info(CLASS_NAME, 'runJiraIssueLoading', `Jira loading complete: ${result.totalInserted} inserted, ${result.totalSkipped} skipped across ${result.projectCount} projects`);

    return `${result.totalInserted} issues inserted, ${result.totalSkipped} skipped across ${result.projectCount} projects`;
  }

  /** Step 4: Jira changelog/unfinished update (refreshes recently changed issues). */
  private async runJiraChangelogUpdate(): Promise<string> {
    if (!this.jiraIncrementalLoader) {
      this.logger.warn(CLASS_NAME, 'runJiraChangelogUpdate', 'Jira incremental loader not available (Jira not configured)');
      return 'Jira not configured (skipped)';
    }

    this.logger.info(CLASS_NAME, 'runJiraChangelogUpdate', `Refreshing unfinished Jira issues (daysAgo=${this.config.jiraDaysAgo})`);

    // Run only the unfinished refresh part (no incremental loading)
    // We run the full incremental loader but it will find 0 new issues
    // since step 3 already loaded them. The important part is the unfinished refresh.
    const result: IncrementalLoadResult = await this.jiraIncrementalLoader.runIncrementalLoad(
      /* skipUnfinishedRefresh= */ false,
    );
    // Overwrite the last result to include unfinished data
    this.lastJiraLoadResult = result;

    const unfinishedMsg = result.unfinishedResult
      ? `${result.unfinishedResult.issuesProcessed} issues refreshed`
      : 'no unfinished refresh data';

    this.logger.info(CLASS_NAME, 'runJiraChangelogUpdate', `Changelog update complete: ${unfinishedMsg}`);

    return unfinishedMsg;
  }

  /** Step 5: Commit-Jira linking via regex pattern matching. */
  private async runCommitJiraLinking(): Promise<string> {
    this.logger.info(CLASS_NAME, 'runCommitJiraLinking', 'Linking commits to Jira issues via regex pattern matching');

    const result: DataEnhancerResult = await this.dataEnhancerService.enhanceCommitJiraLinks();
    this.lastDataEnhancerResult = result;

    this.logger.info(CLASS_NAME, 'runCommitJiraLinking', `Commit-Jira linking complete: ${result.linksInserted} links, ${result.refsUpdated} refs updated`);

    return `${result.linksInserted} links inserted, ${result.refsUpdated} refs updated from ${result.authorsProcessed} authors`;
  }

  /** Step 6: Team assignment calculation. */
  private async runTeamAssignment(): Promise<string> {
    this.logger.info(CLASS_NAME, 'runTeamAssignment', 'Calculating team assignments');

    const result: TeamAssignmentResult = await this.teamAssignmentService.updateTeamAssignmentsWithPipeline();
    this.lastTeamAssignmentResult = result;

    this.logger.info(CLASS_NAME, 'runTeamAssignment', `Team assignment complete: ${result.authorsProcessed} authors, ${result.primaryTeamsUpdated} teams updated`);

    return `${result.primaryTeamsUpdated} primary teams updated from ${result.authorsProcessed} authors`;
  }

  /** Step 6: Linear issue loading (incremental, without unfinished refresh). Ticket: IQS-876. */
  private async runLinearIssueLoading(): Promise<string> {
    if (!this.linearIncrementalLoader) {
      this.logger.warn(CLASS_NAME, 'runLinearIssueLoading', 'Linear incremental loader not available (Linear not configured). Run "Gitr: Set Linear API Key" to configure.');
      return 'Linear not configured (skipped)';
    }

    this.logger.info(CLASS_NAME, 'runLinearIssueLoading', 'Loading Linear issues incrementally');

    const result: LinearIncrementalLoadResult = await this.linearIncrementalLoader.runIncrementalLoad(
      /* skipUnfinishedRefresh= */ true,
    );
    this.lastLinearLoadResult = result;

    this.logger.info(CLASS_NAME, 'runLinearIssueLoading', `Linear loading complete: ${result.totalInserted} inserted, ${result.totalSkipped} skipped across ${result.teamCount} teams`);

    return `${result.totalInserted} issues inserted, ${result.totalSkipped} skipped across ${result.teamCount} teams`;
  }

  /** Step 7: Linear changelog/unfinished update (refreshes recently changed issues). Ticket: IQS-876. */
  private async runLinearChangelogUpdate(): Promise<string> {
    if (!this.linearIncrementalLoader) {
      this.logger.warn(CLASS_NAME, 'runLinearChangelogUpdate', 'Linear incremental loader not available (Linear not configured)');
      return 'Linear not configured (skipped)';
    }

    this.logger.info(CLASS_NAME, 'runLinearChangelogUpdate', 'Refreshing unfinished Linear issues');

    const result: LinearIncrementalLoadResult = await this.linearIncrementalLoader.runIncrementalLoad(
      /* skipUnfinishedRefresh= */ false,
    );
    this.lastLinearLoadResult = result;

    const unfinishedMsg = `${result.unfinishedRefreshed} issues refreshed, ${result.totalInserted} new across ${result.teamCount} teams`;

    this.logger.info(CLASS_NAME, 'runLinearChangelogUpdate', `Linear changelog update complete: ${unfinishedMsg}`);

    return unfinishedMsg;
  }

  /** Step 8: Commit-Linear linking via regex pattern matching. Ticket: IQS-876. */
  private async runCommitLinearLinking(): Promise<string> {
    this.logger.info(CLASS_NAME, 'runCommitLinearLinking', 'Linking commits to Linear issues via regex pattern matching');

    // Get Linear team keys from config or auto-discover from repositories
    const linearKeys = this.config.linearTeamKeys;
    if (linearKeys.length === 0) {
      this.logger.warn(CLASS_NAME, 'runCommitLinearLinking', 'No Linear team keys configured in gitrx.linear.teamKeys');
      return 'No Linear team keys configured (skipped)';
    }

    this.logger.debug(CLASS_NAME, 'runCommitLinearLinking', `Linear team keys: [${linearKeys.join(', ')}]`);

    const result: DataEnhancerResult = await this.dataEnhancerService.enhanceCommitLinearLinks(linearKeys);
    this.lastDataEnhancerResult = result;

    this.logger.info(CLASS_NAME, 'runCommitLinearLinking', `Commit-Linear linking complete: ${result.linksInserted} links, ${result.refsUpdated} refs updated`);

    return `${result.linksInserted} links inserted, ${result.refsUpdated} refs updated from ${result.authorsProcessed} authors`;
  }

  /** Build a SKIPPED step result. */
  private buildSkippedResult(stepId: PipelineStepId, reason: string): PipelineStepResult {
    return {
      stepId,
      label: PIPELINE_STEP_LABELS[stepId],
      status: 'SKIPPED',
      durationMs: 0,
      summary: reason,
    };
  }

  /** Determine overall pipeline status from step results. */
  private determineOverallStatus(stepResults: readonly PipelineStepResult[]): PipelineRunStatus {
    const hasError = stepResults.some((r) => r.status === 'ERROR');
    const hasSuccess = stepResults.some((r) => r.status === 'SUCCESS');

    if (!hasError) {
      return 'SUCCESS';
    }
    if (hasSuccess) {
      return 'PARTIAL';
    }
    return 'FAILED';
  }

  /** Log table counts at end of pipeline run. Errors do not abort the pipeline. */
  private async safeLogTableCounts(pipelineRunId: number): Promise<Readonly<Record<string, number>>> {
    const counts: Record<string, number> = {};

    try {
      this.logger.debug(CLASS_NAME, 'safeLogTableCounts', 'Logging table counts at end of pipeline run');
      await this.pipelineRepo.logTableCounts(pipelineRunId, PIPELINE_TABLE_COUNTS);

      // For the return value, we don't re-query. The counts are logged by PipelineRepository.
      // We provide an empty map since the counts are in the database.
      this.logger.debug(CLASS_NAME, 'safeLogTableCounts', 'Table counts logged successfully');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'safeLogTableCounts', `Failed to log table counts: ${message}`);
    }

    return Object.freeze(counts);
  }

  /** Log a final summary of all step results. */
  private logFinalSummary(
    stepResults: readonly PipelineStepResult[],
    _tableCounts: Readonly<Record<string, number>>,
    totalDurationMs: number,
  ): void {
    this.logger.critical(CLASS_NAME, 'logFinalSummary', '=== Pipeline Run Summary ===');

    for (const result of stepResults) {
      const statusIcon = result.status === 'SUCCESS' ? 'OK'
        : result.status === 'ERROR' ? 'FAIL'
        : 'SKIP';
      this.logger.info(CLASS_NAME, 'logFinalSummary', `  [${statusIcon}] ${result.label}: ${result.summary} (${result.durationMs}ms)`);
    }

    const successCount = stepResults.filter((r) => r.status === 'SUCCESS').length;
    const errorCount = stepResults.filter((r) => r.status === 'ERROR').length;
    const skippedCount = stepResults.filter((r) => r.status === 'SKIPPED').length;

    this.logger.critical(CLASS_NAME, 'logFinalSummary', `Total: ${successCount} succeeded, ${errorCount} failed, ${skippedCount} skipped (${totalDurationMs}ms)`);
  }
}
