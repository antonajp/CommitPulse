/**
 * Git commit extraction service using simple-git.
 *
 * Iterates through configured Git repositories, extracts commit history
 * (SHA, author, date, message, files, branch), and persists to PostgreSQL
 * via CommitRepository. Orchestrates the analysis pipeline including
 * branch discovery, incremental processing, and pipeline run tracking.
 *
 * Maps from Python GitCommitHistorySql.py methods:
 *   get_commit_history     -> analyzeRepositories / analyzeRepository
 *   find_recent_branches   -> findRecentBranches
 *   get_branch_details     -> processBranch
 *   get_all_tags_by_commit -> buildTagMap
 *
 * Data extraction/transformation functions are in git-commit-extractor.ts.
 *
 * CRITICAL differences from Python:
 *   - Python writes SQL files then executes them => TypeScript uses parameterized inserts directly
 *   - Python uses f-string SQL (injection risk) => TypeScript uses CommitRepository with $1, $2 placeholders
 *   - Python uses gitpython Repo => TypeScript uses simple-git
 *   - Python uses pandas DataFrames => TypeScript uses typed arrays
 *
 * Ticket: IQS-854, IQS-855 (scc integration + file/directory/file-type inserts)
 */

import simpleGit, { type SimpleGit, type LogResult, type DefaultLogFields } from 'simple-git';
import { LoggerService } from '../logging/logger.js';
import { CommitRepository } from '../database/commit-repository.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import { SccMetricsService, type SccFileMetrics } from './scc-metrics-service.js';
import type { CommitTagRow } from '../database/commit-types.js';
import type { RepositoryEntry } from '../config/settings.js';
import type {
  GitAnalysisOptions,
  RepoContext,
  BranchInfo,
  TagMap,
  RepoAnalysisResult,
  AnalysisRunResult,
} from './git-analysis-types.js';
import {
  extractCommitData,
  extractCommitWords,
  buildCommitHistoryRow,
} from './git-commit-extractor.js';
import { validateRepositoryUrl } from '../utils/url-validator.js';
import { sanitizeUrlForLogging } from '../utils/url-sanitizer.js';

// Re-export extractor functions for backward compatibility and convenience
export {
  isMergeCommit,
  extractCommitWords,
  extractCommitData,
  buildCommitHistoryRow,
  parseDiffFiles,
  getParentDirectory,
  getSubDirectory,
  getFileExtension,
} from './git-commit-extractor.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'GitAnalysisService';

/**
 * GitAnalysisService extracts commit history from Git repositories
 * and persists it to PostgreSQL via CommitRepository and PipelineRepository.
 *
 * Supports:
 * - Multi-repo processing from gitrx.repositories setting
 * - Incremental processing (skips already-known SHAs)
 * - Date range filtering for branches and commits
 * - Merge commit detection via keyword regex
 * - Tag extraction mapped to commit SHAs
 * - Per-file scc metrics (lines, code, comments, complexity) via SccMetricsService
 * - Pipeline run start/stop tracking
 * - Debug logging throughout
 */
export class GitAnalysisService {
  private readonly logger: LoggerService;
  private readonly commitRepo: CommitRepository;
  private readonly pipelineRepo: PipelineRepository;
  private readonly sccService: SccMetricsService;

  constructor(
    commitRepo: CommitRepository,
    pipelineRepo: PipelineRepository,
    sccService?: SccMetricsService,
  ) {
    this.commitRepo = commitRepo;
    this.pipelineRepo = pipelineRepo;
    this.sccService = sccService ?? new SccMetricsService();
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'GitAnalysisService created');
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Analyze all configured repositories.
   * Maps from Python GitCommitHistorySql.get_commit_history() orchestration.
   *
   * @param repositories - List of repository entries from gitrx.repositories setting
   * @param options - Optional date range filtering
   * @returns Summary of the analysis run
   */
  async analyzeRepositories(
    repositories: readonly RepositoryEntry[],
    options: GitAnalysisOptions = {},
  ): Promise<AnalysisRunResult> {
    const startTime = Date.now();
    const debugLogging = options.debugLogging ?? false;
    this.logger.info(CLASS_NAME, 'analyzeRepositories', `Starting analysis of ${repositories.length} repository(ies)`);
    this.logger.debug(CLASS_NAME, 'analyzeRepositories', `Options: sinceDate=${options.sinceDate ?? 'all'}, untilDate=${options.untilDate ?? 'now'}, debugLogging=${debugLogging}`);

    // IQS-936: Debug logging for Git extraction operations
    if (debugLogging) {
      this.logger.debug(CLASS_NAME, 'analyzeRepositories', `[GIT DEBUG] Starting Git extraction for ${repositories.length} repositories`);
      for (const repo of repositories) {
        this.logger.debug(CLASS_NAME, 'analyzeRepositories', `[GIT DEBUG] Repository: ${repo.name} (${repo.path}), organization=${repo.organization || '(none)'}`);
      }
    }

    // Start pipeline run tracking
    const pipelineRunId = await this.pipelineRepo.insertPipelineStart({
      className: CLASS_NAME,
      context: 'analyzeRepositories',
      detail: `Processing ${repositories.length} repositories`,
      status: 'START',
    });
    this.logger.info(CLASS_NAME, 'analyzeRepositories', `Pipeline run started with id=${pipelineRunId}`);
    this.logger.setPipelineRunId(pipelineRunId);

    const repoResults: RepoAnalysisResult[] = [];
    let hasFailure = false;
    let hasSuccess = false;

    for (const repoEntry of repositories) {
      this.logger.info(CLASS_NAME, 'analyzeRepositories', `Processing repository: ${repoEntry.name} at ${repoEntry.path}`);

      // GITX-130: Validate repository path before processing (defense-in-depth)
      const { validateRepositoryPath } = await import('../utils/repository-path-validator.js');
      const validation = validateRepositoryPath(repoEntry.path, repositories);
      if (!validation.isValid) {
        const errorMsg = `Security: Invalid repository path for ${repoEntry.name}: ${validation.reason}`;
        this.logger.error(CLASS_NAME, 'analyzeRepositories', errorMsg);
        hasFailure = true;
        repoResults.push({
          repoName: repoEntry.name,
          commitsInserted: 0,
          branchesProcessed: 0,
          branchRelationshipsRecorded: 0,
          durationMs: 0,
          error: errorMsg,
        });
        continue;
      }

      try {
        const result = await this.analyzeRepository(repoEntry, options, pipelineRunId);
        repoResults.push(result);
        if (result.error) {
          hasFailure = true;
          this.logger.warn(CLASS_NAME, 'analyzeRepositories', `Repository ${repoEntry.name} completed with error: ${result.error}`);
        } else {
          hasSuccess = true;
          this.logger.info(CLASS_NAME, 'analyzeRepositories', `Repository ${repoEntry.name} completed: ${result.commitsInserted} commits, ${result.branchRelationshipsRecorded} relationships`);
        }
      } catch (error: unknown) {
        hasFailure = true;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(CLASS_NAME, 'analyzeRepositories', `Failed to process ${repoEntry.name}: ${message}`);
        repoResults.push({
          repoName: repoEntry.name, branchesProcessed: 0,
          commitsInserted: 0, branchRelationshipsRecorded: 0,
          durationMs: 0, error: message,
        });
      }
    }

    // Log table counts (matches Python log_table_counts call)
    await this.safeLogTableCounts(pipelineRunId);

    // Determine overall status and update pipeline run
    const status = this.determineStatus(hasFailure, hasSuccess);
    const pipelineStatus = status === 'FAILED' ? 'ERROR' : 'FINISHED';
    await this.pipelineRepo.updatePipelineRun(pipelineRunId, pipelineStatus);

    const totalDurationMs = Date.now() - startTime;
    this.logger.info(CLASS_NAME, 'analyzeRepositories', `Analysis complete in ${totalDurationMs}ms. Status: ${status}`);

    return { pipelineRunId, repoResults, totalDurationMs, status };
  }

  /**
   * Analyze a single repository.
   * Maps from Python GitCommitHistorySql.__init__() + get_commit_history() for one repo.
   *
   * IQS-931: Computes effective since date from per-repo startDate and global sinceDate.
   * Per-repo startDate takes precedence; when both are set, uses the later date.
   *
   * GITX-131 Phase 3: When options.useGitLogAll is true, delegates to analyzeRepositoryFast()
   * which uses a single git log --all query instead of per-branch iteration.
   */
  async analyzeRepository(
    repoEntry: RepositoryEntry,
    options: GitAnalysisOptions,
    pipelineRunId: number,
  ): Promise<RepoAnalysisResult> {
    const startTime = Date.now();
    const repoName = repoEntry.name;
    const debugLogging = options.debugLogging ?? false;
    this.logger.info(CLASS_NAME, 'analyzeRepository', `Starting analysis for: ${repoName}`);
    this.logger.debug(CLASS_NAME, 'analyzeRepository', `Repo path: ${repoEntry.path}`);

    // IQS-936: Debug logging for repository initialization
    if (debugLogging) {
      this.logger.debug(CLASS_NAME, 'analyzeRepository', `[GIT DEBUG] Initializing repository: ${repoName}`);
      this.logger.debug(CLASS_NAME, 'analyzeRepository', `[GIT DEBUG]   Path: ${repoEntry.path}`);
      this.logger.debug(CLASS_NAME, 'analyzeRepository', `[GIT DEBUG]   Organization: ${repoEntry.organization || '(none)'}`);
      this.logger.debug(CLASS_NAME, 'analyzeRepository', `[GIT DEBUG]   Tracker: ${repoEntry.trackerType}`);
    }

    // IQS-931: Compute effective since date (per-repo startDate overrides global sinceDate)
    let effectiveSinceDate = computeEffectiveSinceDate(repoEntry.startDate, options.sinceDate);

    const git: SimpleGit = simpleGit(repoEntry.path);

    // IQS-923: Use configured repoUrl if provided, otherwise fall back to auto-detection
    const repositoryUrl = repoEntry.repoUrl ?? await this.deriveRepositoryUrl(git, repoName);
    this.logger.debug(
      CLASS_NAME,
      'analyzeRepository',
      repoEntry.repoUrl
        ? `Using configured repoUrl: ${repositoryUrl}`
        : `Auto-detected repo URL: ${repositoryUrl}`,
    );

    // IQS-936: Sanitize URL before storing in database and logging to prevent credential exposure
    const sanitizedRepoUrl = sanitizeUrlForLogging(repositoryUrl);
    const repoContext: RepoContext = {
      path: repoEntry.path,
      name: repoName,
      organization: repoEntry.organization,
      repositoryUrl: sanitizedRepoUrl, // Store sanitized URL in database
    };
    this.logger.debug(CLASS_NAME, 'analyzeRepository', `Repo URL: ${sanitizedRepoUrl}`);

    // GITX-1: Auto-incremental extraction using per-repo watermark
    // GITX-123: Unless user explicitly requests full extraction via forceFullExtraction flag
    // When no explicit sinceDate is configured and forceFullExtraction is false/undefined,
    // use the last commit date from the database for automatic incremental updates
    if (!effectiveSinceDate && !options.forceFullExtraction) {
      const lastCommitDate = await this.commitRepo.getLastCommitDateForRepo(repoName, sanitizedRepoUrl);
      if (lastCommitDate) {
        // Use the day of the last commit as the watermark
        // Format as YYYY-MM-DD for consistent date filtering
        effectiveSinceDate = lastCommitDate.toISOString().split('T')[0];
        this.logger.info(
          CLASS_NAME,
          'analyzeRepository',
          `Auto-incremental: extracting commits since ${effectiveSinceDate} (last commit date for ${repoName})`,
        );
      } else {
        this.logger.debug(
          CLASS_NAME,
          'analyzeRepository',
          `No existing commits found for ${repoName}, will extract full history`,
        );
      }
    } else if (options.forceFullExtraction) {
      // GITX-123: User explicitly requested full extraction mode
      this.logger.info(
        CLASS_NAME,
        'analyzeRepository',
        `Full extraction mode: ignoring watermarks and extracting entire history for ${repoName}`,
      );
    }

    const effectiveOptions: GitAnalysisOptions = {
      ...options,
      sinceDate: effectiveSinceDate,
    };
    this.logger.debug(
      CLASS_NAME,
      'analyzeRepository',
      `Effective sinceDate for ${repoName}: ${effectiveSinceDate ?? '(all history)'}` +
      ` (repo startDate: ${repoEntry.startDate ?? 'none'}, global: ${options.sinceDate ?? 'none'})`,
    );

    // IQS-936: Debug logging for repository URL (sanitized for security)
    if (debugLogging) {
      const sanitizedUrl = sanitizeUrlForLogging(repositoryUrl);
      this.logger.debug(CLASS_NAME, 'analyzeRepository', `[GIT DEBUG] Repository URL (sanitized): ${sanitizedUrl}`);
    }

    // GITX-131 Phase 3: Use optimized git log --all path when enabled
    if (options.useGitLogAll === true) {
      this.logger.info(CLASS_NAME, 'analyzeRepository', `Using optimized git log --all extraction for ${repoName}`);
      return await this.analyzeRepositoryFast(git, repoContext, effectiveOptions, pipelineRunId);
    }

    // Standard path: per-branch iteration
    const tagMap = await this.buildTagMap(git, debugLogging);
    this.logger.debug(CLASS_NAME, 'analyzeRepository', `Tag map built: ${tagMap.size} tagged commits`);

    // IQS-936: Debug logging for tag extraction
    if (debugLogging) {
      this.logger.debug(CLASS_NAME, 'analyzeRepository', `[GIT DEBUG] Tag extraction complete: ${tagMap.size} commits have tags`);
    }

    const knownRelationships = await this.commitRepo.getKnownCommitBranchRelationships(repoContext.name);
    this.logger.info(CLASS_NAME, 'analyzeRepository', `Known SHA-branch relationships: ${knownRelationships.size}`);

    const branches = effectiveOptions.sinceDate
      ? await this.findRecentBranches(git, effectiveOptions.sinceDate, debugLogging)
      : await this.getAllBranches(git, debugLogging);
    this.logger.info(CLASS_NAME, 'analyzeRepository', `Found ${branches.length} branches to process`);

    // IQS-936: Debug logging for branch discovery
    if (debugLogging) {
      this.logger.debug(CLASS_NAME, 'analyzeRepository', `[GIT DEBUG] Branch discovery: ${branches.length} branches found`);
      for (const branch of branches.slice(0, 10)) {
        const lastDate = new Date(branch.lastCommitTimestamp * 1000).toISOString();
        this.logger.debug(CLASS_NAME, 'analyzeRepository', `[GIT DEBUG]   Branch: ${branch.name} (last commit: ${lastDate})`);
      }
      if (branches.length > 10) {
        this.logger.debug(CLASS_NAME, 'analyzeRepository', `[GIT DEBUG]   ... and ${branches.length - 10} more branches`);
      }
    }

    let commitsInserted = 0;
    let branchRelationshipsRecorded = 0;
    let branchesProcessed = 0;

    for (const branch of branches) {
      this.logger.debug(CLASS_NAME, 'analyzeRepository', `Processing branch: ${branch.name}${branch.isRemote ? ' (remote)' : ''}`);
      try {
        // GITX-2: Pass isRemote flag to processBranch for correct ref resolution
        const result = await this.processBranch(
          git, repoContext, branch.name, effectiveOptions,
          knownRelationships, tagMap, pipelineRunId, branch.isRemote ?? false,
        );
        commitsInserted += result.newCommits;
        branchRelationshipsRecorded += result.newRelationships;
        branchesProcessed++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(CLASS_NAME, 'analyzeRepository', `Error processing branch ${branch.name}: ${message}`);
      }
    }

    const durationMs = Date.now() - startTime;
    this.logger.info(CLASS_NAME, 'analyzeRepository', `Repository ${repoName} complete: ${branchesProcessed} branches, ${commitsInserted} commits in ${durationMs}ms`);
    return { repoName, branchesProcessed, commitsInserted, branchRelationshipsRecorded, durationMs };
  }

  /**
   * GITX-131 Phase 3: Fast repository analysis using git log --all.
   *
   * Instead of iterating through branches one-by-one, this method:
   * 1. Uses a single `git log --all --since=<date> --numstat` query
   * 2. Deduplicates commits by SHA (each commit processed exactly once)
   * 3. For each commit, queries `git branch --contains <sha>` to find all branches
   * 4. Records branch relationships for all containing branches
   *
   * This eliminates redundant commit processing when commits appear on multiple branches.
   *
   * @param git - SimpleGit instance for the repository
   * @param repoContext - Repository metadata (name, URL, organization)
   * @param options - Analysis options including date range and skipScc flag
   * @param pipelineRunId - Pipeline run ID for tracking
   * @returns Analysis results matching analyzeRepository output format
   */
  private async analyzeRepositoryFast(
    git: SimpleGit,
    repoContext: RepoContext,
    options: GitAnalysisOptions,
    pipelineRunId: number,
  ): Promise<RepoAnalysisResult> {
    const startTime = Date.now();
    const debugLogging = options.debugLogging ?? false;
    const repoName = repoContext.name;

    this.logger.info(CLASS_NAME, 'analyzeRepositoryFast', `Starting optimized extraction for ${repoName}`);

    // Build tag map (needed for all commits)
    const tagMap = await this.buildTagMap(git, debugLogging);
    this.logger.debug(CLASS_NAME, 'analyzeRepositoryFast', `Tag map built: ${tagMap.size} tagged commits`);

    // Get known relationships for incremental processing
    const knownRelationships = await this.commitRepo.getKnownCommitBranchRelationships(repoName);
    this.logger.info(CLASS_NAME, 'analyzeRepositoryFast', `Known SHA-branch relationships: ${knownRelationships.size}`);

    // Execute single git log --all query with date filtering
    // SECURITY (GITX-131): Validate date parameters before passing to git (CWE-88)
    const { validateDateParameter } = await import('../utils/date-validator.js');
    const sinceDateValidation = validateDateParameter(options.sinceDate);
    const untilDateValidation = validateDateParameter(options.untilDate);

    if (!sinceDateValidation.isValid) {
      const errorMsg = `Invalid sinceDate: ${sinceDateValidation.reason}`;
      this.logger.error(CLASS_NAME, 'analyzeRepositoryFast', errorMsg);
      return { repoName, branchesProcessed: 0, commitsInserted: 0, branchRelationshipsRecorded: 0, durationMs: Date.now() - startTime, error: errorMsg };
    }
    if (!untilDateValidation.isValid) {
      const errorMsg = `Invalid untilDate: ${untilDateValidation.reason}`;
      this.logger.error(CLASS_NAME, 'analyzeRepositoryFast', errorMsg);
      return { repoName, branchesProcessed: 0, commitsInserted: 0, branchRelationshipsRecorded: 0, durationMs: Date.now() - startTime, error: errorMsg };
    }

    const logArgs = ['--all', '--numstat', '--date=iso'];
    if (options.sinceDate) {
      logArgs.push(`--since=${options.sinceDate}`);
    }
    if (options.untilDate) {
      logArgs.push(`--until=${options.untilDate}`);
    }

    this.logger.debug(CLASS_NAME, 'analyzeRepositoryFast', `Running: git log ${logArgs.join(' ')}`);
    const logQueryStart = Date.now();

    let logResult: LogResult<DefaultLogFields>;
    try {
      logResult = await git.log(logArgs);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'analyzeRepositoryFast', `git log --all failed: ${message}`);
      const durationMs = Date.now() - startTime;
      return { repoName, branchesProcessed: 0, commitsInserted: 0, branchRelationshipsRecorded: 0, durationMs, error: message };
    }

    const logQueryDuration = Date.now() - logQueryStart;
    const totalCommitsFound = logResult.all.length;
    this.logger.info(CLASS_NAME, 'analyzeRepositoryFast', `git log --all found ${totalCommitsFound} commits in ${logQueryDuration}ms`);

    if (debugLogging) {
      this.logger.debug(CLASS_NAME, 'analyzeRepositoryFast', `[GIT DEBUG] git log --all returned ${totalCommitsFound} commits`);
    }

    // Deduplicate commits by SHA (git log --all may return same commit multiple times)
    const uniqueCommits = new Map<string, DefaultLogFields>();
    for (const commit of logResult.all) {
      if (!uniqueCommits.has(commit.hash)) {
        uniqueCommits.set(commit.hash, commit);
      }
    }

    this.logger.info(CLASS_NAME, 'analyzeRepositoryFast', `Deduplicated to ${uniqueCommits.size} unique commits`);

    let commitsInserted = 0;
    let commitsSkipped = 0;
    let branchRelationshipsRecorded = 0;
    const processedBranches = new Set<string>();

    // Process each unique commit
    for (const [sha, logEntry] of uniqueCommits) {
      this.logger.trace(CLASS_NAME, 'analyzeRepositoryFast', `Processing commit ${sha.substring(0, 8)}`);

      // Get all branches containing this commit
      const branchesContaining = await this.getBranchesContainingCommit(git, sha);

      // Filter out stash refs
      const validBranches = branchesContaining.filter(branch => !branch.startsWith('stash'));

      if (validBranches.length === 0) {
        this.logger.trace(CLASS_NAME, 'analyzeRepositoryFast', `Skipping ${sha.substring(0, 8)} - only on stash refs`);
        commitsSkipped++;
        continue;
      }

      if (debugLogging) {
        this.logger.debug(CLASS_NAME, 'analyzeRepositoryFast', `[GIT DEBUG] Commit ${sha.substring(0, 8)} on ${validBranches.length} branches: ${validBranches.slice(0, 3).join(', ')}${validBranches.length > 3 ? '...' : ''}`);
      }

      // Track unique branches
      validBranches.forEach(b => processedBranches.add(b));

      // Check if this is a new commit or just new branch relationships
      const existingBranches = knownRelationships.get(sha);
      const isNewCommit = existingBranches === undefined;

      if (isNewCommit) {
        // New commit - full processing
        this.logger.debug(CLASS_NAME, 'analyzeRepositoryFast', `New commit: ${sha.substring(0, 8)} by ${logEntry.author_name}`);

        // Use the first branch for extraction (all branches contain the same commit)
        const primaryBranch = validBranches[0] ?? 'unknown';
        const extracted = extractCommitData(logEntry, primaryBranch);
        const commitHistoryRow = buildCommitHistoryRow(extracted, repoContext);
        await this.commitRepo.insertCommitHistory(commitHistoryRow);

        if (debugLogging) {
          this.logger.debug(CLASS_NAME, 'analyzeRepositoryFast', `[GIT DEBUG] Commit: ${sha.substring(0, 8)} | Author: ${logEntry.author_name} | Date: ${logEntry.date}`);
          this.logger.debug(CLASS_NAME, 'analyzeRepositoryFast', `[GIT DEBUG]   Files: ${extracted.fileCount} | +${extracted.linesAdded}/-${extracted.linesRemoved} | Merge: ${extracted.isMerge}`);
        }

        // Process files (scc metrics, file types, directories)
        if (extracted.files.length > 0) {
          const filePaths = extracted.files.map((f) => f.filePath);

          let sccMetrics: ReadonlyMap<string, SccFileMetrics>;
          if (options.skipScc === true) {
            sccMetrics = new Map();
            this.logger.debug(CLASS_NAME, 'analyzeRepositoryFast', `Skipping SCC metrics for ${sha.substring(0, 8)} (skipScc=true)`);
          } else {
            sccMetrics = await this.sccService.getFileMetricsViaScc(git, sha, filePaths);
            this.logger.debug(CLASS_NAME, 'analyzeRepositoryFast', `scc metrics collected for ${sccMetrics.size} of ${filePaths.length} files`);
          }

          const fileRows = this.sccService.buildCommitFileRows(sha, logEntry.author_name, extracted.files, sccMetrics);
          await this.commitRepo.insertCommitFiles(sha, fileRows);

          const fileTypeRows = this.sccService.buildFileTypeRows(sha, logEntry.author_name, extracted.files);
          await this.commitRepo.insertCommitFileTypes(sha, fileTypeRows);

          const dirRows = this.sccService.buildDirectoryRows(sha, logEntry.author_name, extracted.files);
          await this.commitRepo.insertCommitDirectories(sha, dirRows);
        }

        // Insert tags if present
        const tags = tagMap.get(sha);
        if (tags && tags.length > 0) {
          const tagRows: CommitTagRow[] = tags.map((tag) => ({ sha, tag, author: logEntry.author_name }));
          await this.commitRepo.insertCommitTags(sha, tagRows);
        }

        // Insert commit words
        const wordRows = extractCommitWords(sha, extracted.message, logEntry.author_name);
        if (wordRows.length > 0) {
          await this.commitRepo.insertCommitWords(sha, wordRows);
        }

        // Initialize known relationships with empty array
        knownRelationships.set(sha, []);
        commitsInserted++;
      } else {
        commitsSkipped++;
      }

      // Record branch relationships for all containing branches
      for (const branch of validBranches) {
        const existingBranches = knownRelationships.get(sha) ?? [];
        if (!existingBranches.includes(branch)) {
          await this.commitRepo.insertCommitBranchRelationship(
            sha, branch, logEntry.author_name, new Date(logEntry.date),
          );
          existingBranches.push(branch);
          branchRelationshipsRecorded++;
        }
      }

      // Log to pipeline (fire-and-forget)
      this.logPipelineCommit(pipelineRunId, sha, validBranches.join(','));
    }

    const durationMs = Date.now() - startTime;
    const branchesProcessed = processedBranches.size;

    this.logger.info(
      CLASS_NAME,
      'analyzeRepositoryFast',
      `Repository ${repoName} complete: ${totalCommitsFound} total commits, ${uniqueCommits.size} unique, ` +
      `${commitsInserted} new, ${commitsSkipped} existing, ${branchRelationshipsRecorded} relationships, ` +
      `${branchesProcessed} branches touched in ${durationMs}ms`
    );

    return { repoName, branchesProcessed, commitsInserted, branchRelationshipsRecorded, durationMs };
  }

  // --------------------------------------------------------------------------
  // Branch discovery
  // --------------------------------------------------------------------------

  /**
   * Find branches that have had commits since a given date.
   * Maps from Python find_recent_branches().
   * @param debugLogging - Enable verbose debug logging (IQS-936)
   */
  async findRecentBranches(git: SimpleGit, sinceDate: string, debugLogging = false): Promise<BranchInfo[]> {
    this.logger.debug(CLASS_NAME, 'findRecentBranches', `Finding branches since ${sinceDate}`);
    const sinceTimestamp = new Date(sinceDate).getTime() / 1000;
    const allBranches = await this.getAllBranches(git, debugLogging);
    const recentBranches = allBranches.filter((b) => b.lastCommitTimestamp > sinceTimestamp);
    this.logger.debug(CLASS_NAME, 'findRecentBranches', `Filtered ${allBranches.length} -> ${recentBranches.length} recent`);

    // IQS-936: Debug logging for date range filtering
    if (debugLogging) {
      this.logger.debug(CLASS_NAME, 'findRecentBranches', `[GIT DEBUG] Date filter: since ${sinceDate} (timestamp ${sinceTimestamp})`);
      this.logger.debug(CLASS_NAME, 'findRecentBranches', `[GIT DEBUG] Branches filtered: ${allBranches.length} total -> ${recentBranches.length} with recent activity`);
    }

    return recentBranches;
  }

  /**
   * Get all local and remote branches with their latest commit timestamps.
   *
   * GITX-2: Extended to include remote branches alongside local branches.
   * This ensures commits on remote-only branches (CI/CD branches, feature branches
   * not checked out locally) are captured during extraction.
   *
   * @param debugLogging - Enable verbose debug logging (IQS-936)
   */
  async getAllBranches(git: SimpleGit, debugLogging = false): Promise<BranchInfo[]> {
    this.logger.debug(CLASS_NAME, 'getAllBranches', 'Listing all local and remote branches');

    // GITX-131 Phase 1: Use single git for-each-ref command instead of N subprocess calls
    // Format: refname:short|committerdate:iso|reftype (where reftype is heads or remotes)
    const startTime = Date.now();

    let output = '';
    try {
      output = await git.raw([
        'for-each-ref',
        '--format=%(refname:short)|%(committerdate:iso)|%(refname:lstrip=1)',
        'refs/heads/',
        'refs/remotes/'
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'getAllBranches', `Failed to list branches: ${message}`);
      return [];
    }

    const branches: BranchInfo[] = [];
    const localBranchNames = new Set<string>();
    const lines = output.trim().split('\n').filter(line => line.length > 0);

    if (debugLogging) {
      this.logger.debug(CLASS_NAME, 'getAllBranches', `[GIT DEBUG] Processing ${lines.length} total refs`);
    }

    // First pass: collect all local branches
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length < 3) {
        this.logger.warn(CLASS_NAME, 'getAllBranches', `Malformed for-each-ref output: ${line}`);
        continue;
      }

      const branchName = parts[0] ?? '';
      const refType = parts[2] ?? '';

      // Skip HEAD references (e.g., origin/HEAD)
      if (branchName.includes('HEAD')) {
        continue;
      }

      const isRemote = refType.startsWith('remotes/');

      // Only collect local branch names in first pass
      if (!isRemote) {
        localBranchNames.add(branchName);
      }
    }

    // Second pass: build branch info array
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length < 3) {
        continue;
      }

      const branchName = parts[0] ?? '';
      const dateStr = parts[1] ?? '';
      const refType = parts[2] ?? '';

      // Skip HEAD references
      if (branchName.includes('HEAD')) {
        continue;
      }

      const isRemote = refType.startsWith('remotes/');

      // GITX-2: For remote branches, skip if local branch with same name exists
      if (isRemote) {
        // Remote branches come as "origin/branchName" - extract the local name part
        const remoteParts = branchName.split('/');
        const localEquivalent = remoteParts.length > 1 ? remoteParts.slice(1).join('/') : branchName;

        if (localBranchNames.has(localEquivalent)) {
          this.logger.trace(CLASS_NAME, 'getAllBranches', `Skipping remote ${branchName} (local branch exists)`);
          continue;
        }
      }

      // Parse timestamp
      const timestamp = dateStr ? new Date(dateStr).getTime() / 1000 : 0;

      branches.push({
        name: branchName,
        lastCommitTimestamp: timestamp,
        isRemote
      });

      this.logger.trace(
        CLASS_NAME,
        'getAllBranches',
        `${isRemote ? 'Remote' : 'Local'} branch ${branchName}: last commit ${dateStr ?? 'unknown'}`
      );
    }

    const elapsedMs = Date.now() - startTime;
    const localCount = branches.filter(b => !b.isRemote).length;
    const remoteCount = branches.filter(b => b.isRemote).length;

    this.logger.debug(
      CLASS_NAME,
      'getAllBranches',
      `Found ${localCount} local + ${remoteCount} remote branches (${branches.length} total) in ${elapsedMs}ms using single git for-each-ref call`
    );

    if (debugLogging) {
      this.logger.debug(CLASS_NAME, 'getAllBranches', `[GIT DEBUG] Found ${localCount} local branches`);
      this.logger.debug(CLASS_NAME, 'getAllBranches', `[GIT DEBUG] Found ${remoteCount} remote branches`);
    }

    return branches;
  }

  // --------------------------------------------------------------------------
  // Branch processing
  // --------------------------------------------------------------------------

  /**
   * Process all commits on a branch, inserting new commits and branch relationships.
   * Maps from Python get_branch_details().
   *
   * Incremental: known SHAs only get branch relationships; new SHAs get full processing.
   */
  async processBranch(
    git: SimpleGit,
    repoContext: RepoContext,
    branchName: string,
    options: GitAnalysisOptions,
    knownRelationships: Map<string, string[]>,
    tagMap: TagMap,
    pipelineRunId: number,
    isRemote = false,
  ): Promise<{ newCommits: number; newRelationships: number }> {
    const debugLogging = options.debugLogging ?? false;
    this.logger.debug(CLASS_NAME, 'processBranch', `Processing branch: ${branchName}${isRemote ? ' (remote)' : ''}`);

    // GITX-2: Pass isRemote flag to getBranchLog for correct ref resolution
    const logResult = await this.getBranchLog(git, branchName, options, isRemote);
    if (!logResult) {
      return { newCommits: 0, newRelationships: 0 };
    }

    const totalInRange = logResult.all.length;
    this.logger.debug(CLASS_NAME, 'processBranch', `Branch ${branchName}: ${totalInRange} commits in range`);

    // IQS-936: Debug logging for commit range
    if (debugLogging) {
      this.logger.debug(CLASS_NAME, 'processBranch', `[GIT DEBUG] Processing branch: ${branchName}`);
      this.logger.debug(CLASS_NAME, 'processBranch', `[GIT DEBUG]   Commits in range: ${totalInRange}`);
    }

    let newCommits = 0;
    let existingCommits = 0;
    let newRelationships = 0;

    for (const logEntry of logResult.all) {
      const sha = logEntry.hash;
      this.logger.trace(CLASS_NAME, 'processBranch', `Processing ${sha.substring(0, 8)} on ${branchName}`);

      const existingBranches = knownRelationships.get(sha);
      if (existingBranches !== undefined) {
        // Known SHA - only record new branch relationship
        existingCommits++;
        if (!existingBranches.includes(branchName)) {
          await this.commitRepo.insertCommitBranchRelationship(
            sha, branchName, logEntry.author_name, new Date(logEntry.date),
          );
          existingBranches.push(branchName);
          newRelationships++;
        }
        continue;
      }

      // New commit - full processing
      this.logger.debug(CLASS_NAME, 'processBranch', `New commit: ${sha.substring(0, 8)} by ${logEntry.author_name}`);
      const extracted = extractCommitData(logEntry, branchName);
      const commitHistoryRow = buildCommitHistoryRow(extracted, repoContext);
      await this.commitRepo.insertCommitHistory(commitHistoryRow);

      // IQS-936: Debug logging for commit processing
      if (debugLogging) {
        this.logger.debug(CLASS_NAME, 'processBranch', `[GIT DEBUG] Commit: ${sha.substring(0, 8)} | Author: ${logEntry.author_name} | Date: ${logEntry.date}`);
        this.logger.debug(CLASS_NAME, 'processBranch', `[GIT DEBUG]   Files: ${extracted.fileCount} | +${extracted.linesAdded}/-${extracted.linesRemoved} | Merge: ${extracted.isMerge}`);
      }

      await this.commitRepo.insertCommitBranchRelationship(
        sha, branchName, logEntry.author_name, new Date(logEntry.date),
      );
      newRelationships++;

      // Collect scc file metrics and insert commit_files, commit_files_types, commit_directory
      // Maps from Python write_file_details_to_file() which calls create_commit_df, write_details_to_sql,
      // write_file_types_to_sql, and write_directories_to_sql
      //
      // GITX-131 Phase 2: Support skipScc option for fast incremental extraction
      if (extracted.files.length > 0) {
        const filePaths = extracted.files.map((f) => f.filePath);

        // GITX-131: Skip SCC call when skipScc option is enabled (defer to backfill)
        let sccMetrics: ReadonlyMap<string, SccFileMetrics>;
        if (options.skipScc === true) {
          // Empty map causes buildCommitFileRows to use zeros for all SCC fields
          sccMetrics = new Map();
          this.logger.debug(CLASS_NAME, 'processBranch', `Skipping SCC metrics for ${sha.substring(0, 8)} (skipScc=true, will backfill later)`);
        } else {
          sccMetrics = await this.sccService.getFileMetricsViaScc(git, sha, filePaths);
          this.logger.debug(CLASS_NAME, 'processBranch', `scc metrics collected for ${sccMetrics.size} of ${filePaths.length} files`);
        }

        // IQS-936: Debug logging for file diffs (TRACE level to prevent flooding)
        if (debugLogging) {
          this.logger.trace(CLASS_NAME, 'processBranch', `[GIT DEBUG] File details for ${sha.substring(0, 8)}:`);
          for (const file of extracted.files.slice(0, 10)) {
            this.logger.trace(CLASS_NAME, 'processBranch', `[GIT DEBUG]   ${file.filePath} | ${file.fileExtension} | +${file.insertions}/-${file.deletions}`);
          }
          if (extracted.files.length > 10) {
            this.logger.trace(CLASS_NAME, 'processBranch', `[GIT DEBUG]   ... and ${extracted.files.length - 10} more files`);
          }
        }

        const fileRows = this.sccService.buildCommitFileRows(sha, logEntry.author_name, extracted.files, sccMetrics);
        await this.commitRepo.insertCommitFiles(sha, fileRows);

        const fileTypeRows = this.sccService.buildFileTypeRows(sha, logEntry.author_name, extracted.files);
        await this.commitRepo.insertCommitFileTypes(sha, fileTypeRows);

        const dirRows = this.sccService.buildDirectoryRows(sha, logEntry.author_name, extracted.files);
        await this.commitRepo.insertCommitDirectories(sha, dirRows);
      }

      // Insert tags if present
      const tags = tagMap.get(sha);
      if (tags && tags.length > 0) {
        const tagRows: CommitTagRow[] = tags.map((tag) => ({ sha, tag, author: logEntry.author_name }));
        await this.commitRepo.insertCommitTags(sha, tagRows);
        this.logger.trace(CLASS_NAME, 'processBranch', `Inserted ${tagRows.length} tags for ${sha.substring(0, 8)}`);
      }

      // Insert commit words
      const wordRows = extractCommitWords(sha, extracted.message, logEntry.author_name);
      if (wordRows.length > 0) {
        await this.commitRepo.insertCommitWords(sha, wordRows);
      }

      // Update in-memory map
      knownRelationships.set(sha, [branchName]);

      // Log to pipeline (fire-and-forget)
      this.logPipelineCommit(pipelineRunId, sha, branchName);

      newCommits++;
      this.logger.debug(CLASS_NAME, 'processBranch', `Committed ${sha.substring(0, 8)} (${newCommits} new so far)`);
    }

    // IQS-950: Log accurate commit breakdown (total = new + existing)
    this.logger.info(
      CLASS_NAME,
      'processBranch',
      `Branch ${branchName}: ${totalInRange} commits in range (${newCommits} new, ${existingCommits} existing), ${newRelationships} new relationships`,
    );
    return { newCommits, newRelationships };
  }

  // --------------------------------------------------------------------------
  // Tag extraction
  // --------------------------------------------------------------------------

  /**
   * Build a map of commit SHA -> tag names for the repository.
   * Maps from Python get_all_tags_by_commit_sha().
   * @param debugLogging - Enable verbose debug logging (IQS-936)
   */
  async buildTagMap(git: SimpleGit, debugLogging = false): Promise<TagMap> {
    this.logger.debug(CLASS_NAME, 'buildTagMap', 'Building tag map');
    const tagMap = new Map<string, string[]>();

    try {
      const tags = await git.tags();
      this.logger.debug(CLASS_NAME, 'buildTagMap', `Found ${tags.all.length} tags`);

      // IQS-936: Debug logging for tag discovery
      if (debugLogging) {
        this.logger.debug(CLASS_NAME, 'buildTagMap', `[GIT DEBUG] Tag extraction: ${tags.all.length} total tags found`);
      }

      for (const tagName of tags.all) {
        try {
          const sha = await git.revparse([`${tagName}^{commit}`]);
          const trimmedSha = sha.trim();
          const existing = tagMap.get(trimmedSha);
          if (existing) {
            existing.push(tagName);
          } else {
            tagMap.set(trimmedSha, [tagName]);
          }
          this.logger.trace(CLASS_NAME, 'buildTagMap', `Tag ${tagName} -> ${trimmedSha.substring(0, 8)}`);

          // IQS-936: Debug logging for tag-commit mapping (trace level for per-tag detail)
          if (debugLogging) {
            this.logger.trace(CLASS_NAME, 'buildTagMap', `[GIT DEBUG] Tag mapped: ${tagName} -> ${trimmedSha.substring(0, 8)}`);
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(CLASS_NAME, 'buildTagMap', `Could not resolve tag ${tagName}: ${message}`);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'buildTagMap', `Failed to list tags: ${message}`);
    }

    this.logger.debug(CLASS_NAME, 'buildTagMap', `Tag map complete: ${tagMap.size} commits with tags`);
    return tagMap;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Get the commit log for a branch with optional date filtering.
   * Returns null on error (branch not found, etc).
   *
   * IQS-950: Uses refs/heads/ prefix to explicitly reference local branches and avoid
   * ambiguity when a tag has the same name as a branch. Without this prefix,
   * Git may interpret the name as a tag reference instead of a branch, which
   * can result in missing commits during extraction.
   *
   * GITX-2: Added support for remote branches (refs/remotes/ prefix).
   * The isRemote flag explicitly indicates whether the branch is remote or local,
   * since local branch names can also contain "/" (e.g., "feature/new-feature").
   */
  private async getBranchLog(
    git: SimpleGit,
    branchName: string,
    options: GitAnalysisOptions,
    isRemote = false,
  ): Promise<LogResult<DefaultLogFields> | null> {
    const logOptions: Record<string, string> = {};
    if (options.sinceDate) {
      logOptions['--after'] = options.sinceDate;
    }
    if (options.untilDate) {
      logOptions['--before'] = options.untilDate;
    }

    try {
      // Build raw args for git log. We pass the branch name as a positional
      // revision argument (not as 'from') because simple-git's 'from' option
      // generates "from.." which means "commits reachable from HEAD but not
      // from the branch" -- giving 0 results when HEAD is on that branch.
      // Using '--numstat' only (not --stat) since they are mutually exclusive.
      // Ticket: IQS-873 (discovered via E2E test)
      //
      // IQS-950: Use refs/heads/ prefix to explicitly reference local branches.
      // Without this prefix, Git may interpret branch names as tag references
      // when a tag with the same name exists, causing commits to be filtered
      // incorrectly (only tagged commits would be returned).
      //
      // GITX-2: Support both local and remote branch refs using isRemote flag.
      // We cannot rely on "/" in the name since local branches can have "/" too
      // (e.g., "feature/new-feature" is a local branch name).
      const branchRef = isRemote
        ? `refs/remotes/${branchName}`
        : `refs/heads/${branchName}`;
      const rawArgs: string[] = [branchRef, '--numstat'];
      if (options.sinceDate) {
        rawArgs.push(`--after=${options.sinceDate}`);
      }
      if (options.untilDate) {
        rawArgs.push(`--before=${options.untilDate}`);
      }
      this.logger.trace(CLASS_NAME, 'getBranchLog', `Querying log for branch ref: ${branchRef}`);
      return await git.log(rawArgs);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'getBranchLog', `Could not get log for ${branchName}: ${message}`);
      return null;
    }
  }

  /**
   * GITX-131 Phase 3: Get all branches containing a specific commit.
   *
   * Uses `git branch --all --contains <sha>` to find all local and remote branches
   * that contain the given commit. Strips the refs/heads/ and refs/remotes/ prefixes
   * to normalize branch names for database storage.
   *
   * @param git - SimpleGit instance
   * @param sha - Commit SHA to query
   * @returns Array of branch names (both local and remote)
   */
  private async getBranchesContainingCommit(git: SimpleGit, sha: string): Promise<string[]> {
    // SECURITY (GITX-131): Validate SHA format to prevent command injection (CWE-78)
    // Git SHAs are 40-character hexadecimal strings (full SHA) or 7+ chars (short SHA)
    if (!sha || typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(sha)) {
      this.logger.warn(CLASS_NAME, 'getBranchesContainingCommit', `Invalid SHA format rejected: ${sha?.substring(0, 20) ?? 'undefined'}`);
      return [];
    }

    try {
      // Use git branch --all --contains to get both local and remote branches
      const output = await git.raw(['branch', '--all', '--contains', sha]);

      // Parse output: each line is a branch name, possibly with "* " prefix for current branch
      // Format:
      //   * main
      //     feature/test
      //     remotes/origin/main
      const branches = output
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
          // Remove "* " prefix if present (current branch indicator)
          let branch = line.startsWith('* ') ? line.substring(2).trim() : line;

          // Strip refs/ prefix if present (shouldn't be, but be defensive)
          if (branch.startsWith('refs/heads/')) {
            branch = branch.substring('refs/heads/'.length);
          } else if (branch.startsWith('refs/remotes/')) {
            branch = branch.substring('refs/remotes/'.length);
          } else if (branch.startsWith('remotes/')) {
            // git branch --all output uses "remotes/" prefix, not "refs/remotes/"
            branch = branch.substring('remotes/'.length);
          }

          return branch;
        })
        // Filter out HEAD and stash refs (we'll filter stash in caller)
        .filter(branch => !branch.includes('HEAD'));

      this.logger.trace(CLASS_NAME, 'getBranchesContainingCommit', `Commit ${sha.substring(0, 8)} on ${branches.length} branches`);
      return branches;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'getBranchesContainingCommit', `Failed to get branches for ${sha.substring(0, 8)}: ${message}`);
      return [];
    }
  }

  /**
   * Derive the repository URL from git remote configuration.
   * Validates the URL to ensure it uses an allowed protocol (IQS-924).
   *
   * Security: Rejects malicious remote URLs with javascript:, data:, or file: protocols.
   */
  private async deriveRepositoryUrl(git: SimpleGit, repoName: string): Promise<string> {
    const fallback = `https://github.com/unknown/${repoName}.git`;

    try {
      const remotes = await git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin');
      if (origin?.refs?.fetch) {
        const remoteUrl = origin.refs.fetch;
        // IQS-936: Sanitize URL before logging to prevent credential exposure
        const sanitizedRemote = sanitizeUrlForLogging(remoteUrl);
        this.logger.trace(CLASS_NAME, 'deriveRepositoryUrl', `Checking origin fetch URL: ${sanitizedRemote}`);

        // Validate the repository URL (IQS-924 security hardening)
        const validation = validateRepositoryUrl(remoteUrl);
        if (!validation.isValid) {
          this.logger.warn(CLASS_NAME, 'deriveRepositoryUrl',
            `Rejected malicious repository URL: ${validation.reason} - URL: ${sanitizedRemote}`);
          // Fall through to use safe fallback
        } else {
          this.logger.trace(CLASS_NAME, 'deriveRepositoryUrl', `Using validated origin URL: ${sanitizedRemote}`);
          return remoteUrl;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'deriveRepositoryUrl', `Could not read remotes: ${message}`);
    }

    this.logger.debug(CLASS_NAME, 'deriveRepositoryUrl', `Using fallback URL: ${fallback}`);
    return fallback;
  }

  /**
   * Log pipeline commit entry (fire-and-forget, errors suppressed).
   */
  private logPipelineCommit(pipelineRunId: number, sha: string, branchName: string): void {
    this.pipelineRepo.insertPipelineLog({
      parentId: pipelineRunId,
      className: CLASS_NAME,
      context: 'processBranch',
      detail: `Committed ${sha.substring(0, 8)} on ${branchName}`,
      msgLevel: 5, // CRITICAL level matching Python logging.CRITICAL
    }, sha).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'logPipelineCommit', `Pipeline log insert failed: ${msg}`);
    });
  }

  /**
   * Log table counts with error handling.
   */
  private async safeLogTableCounts(pipelineRunId: number): Promise<void> {
    try {
      await this.pipelineRepo.logTableCounts(pipelineRunId, [
        'commit_history', 'commit_contributors', 'commit_directory', 'commit_files',
        'commit_files_types', 'commit_branch_relationship', 'commit_jira', 'commit_msg_words',
        'commit_tags', 'gitr_pipeline_jira', 'gitr_pipeline_log', 'gitr_pipeline_run',
        'gitr_pipeline_sha',
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(CLASS_NAME, 'safeLogTableCounts', `Failed to log table counts: ${message}`);
    }
  }

  /**
   * Determine overall analysis status from per-repo results.
   */
  private determineStatus(hasFailure: boolean, hasSuccess: boolean): 'SUCCESS' | 'PARTIAL' | 'FAILED' {
    if (!hasFailure) { return 'SUCCESS'; }
    if (hasSuccess) { return 'PARTIAL'; }
    return 'FAILED';
  }
}

/**
 * Compute the effective since date for a repository.
 *
 * Priority:
 * 1. If only repo startDate is set, use it
 * 2. If only global sinceDate is set, use it
 * 3. If both are set, use the LATER of the two dates
 * 4. If neither is set, return undefined (extract all history)
 *
 * @param repoStartDate - Per-repository startDate from settings (YYYY-MM-DD)
 * @param globalSinceDate - Global sinceDate from pipeline config (YYYY-MM-DD)
 * @returns The effective since date to use, or undefined for all history
 *
 * Ticket: IQS-931
 */
export function computeEffectiveSinceDate(
  repoStartDate: string | undefined,
  globalSinceDate: string | undefined,
): string | undefined {
  // If neither is set, return undefined (extract all history)
  if (!repoStartDate && !globalSinceDate) {
    return undefined;
  }

  // If only one is set, use it
  if (!repoStartDate) {
    return globalSinceDate;
  }
  if (!globalSinceDate) {
    return repoStartDate;
  }

  // Both are set - use the later date (more restrictive)
  // Compare as strings since YYYY-MM-DD format sorts lexicographically
  return repoStartDate >= globalSinceDate ? repoStartDate : globalSinceDate;
}
