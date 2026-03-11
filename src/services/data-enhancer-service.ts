/**
 * DataEnhancerService: Commit-to-issue-tracker linking via regex pattern matching.
 * Supports both Jira and Linear trackers. Converts Python GitjaDataEnhancer.py.
 * Ticket: IQS-861, IQS-875
 */

import { LoggerService } from '../logging/logger.js';
import { CommitRepository } from '../database/commit-repository.js';
import { CommitJiraRepository } from '../database/commit-jira-repository.js';
import { CommitLinearRepository } from '../database/commit-linear-repository.js';
import type { CommitJiraRow } from '../database/commit-types.js';
import type { CommitLinearRow } from '../database/linear-types.js';
// IssueTrackerService types available for future use when trackerType parameter is added
// import type { TrackerTypeId } from './issue-tracker-interface.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DataEnhancerService';

/**
 * Options for data enhancement operations.
 */
export interface DataEnhancerOptions {
  /** When true, re-process all commits (delete existing links first). Default: false. */
  readonly refresh: boolean;
  /** When true, combine commit message + branch name for scanning. Default: false. */
  readonly combine: boolean;
}

/**
 * Default options for data enhancement.
 */
const DEFAULT_OPTIONS: DataEnhancerOptions = {
  refresh: false,
  combine: false,
};

/**
 * Result of a data enhancement run.
 */
export interface DataEnhancerResult {
  /** Number of authors processed. */
  readonly authorsProcessed: number;
  /** Number of commits scanned. */
  readonly commitsScanned: number;
  /** Number of commit-jira links inserted. */
  readonly linksInserted: number;
  /** Number of is_jira_ref flags updated. */
  readonly refsUpdated: number;
  /** Processing time in milliseconds. */
  readonly durationMs: number;
}

/**
 * Links commits to Jira/Linear issues by scanning commit messages for key patterns.
 * Maps from Python GitjaDataEnhancer class. Ticket: IQS-861, IQS-875, IQS-935
 */
export class DataEnhancerService {
  private readonly logger: LoggerService;
  private readonly commitRepo: CommitRepository;
  private readonly commitJiraRepo: CommitJiraRepository;
  private readonly commitLinearRepo: CommitLinearRepository | null;

  /** Key aliases from VS Code settings (e.g., { PROJ: "PROJ2", CRM: "CRMREO" }). */
  private readonly keyAliases: Readonly<Record<string, string>>;

  /** IQS-935: Jira project keys from VS Code settings (e.g., ["IQS", "PROJ"]). */
  private readonly projectKeys: readonly string[];

  constructor(
    commitRepo: CommitRepository,
    commitJiraRepo: CommitJiraRepository,
    keyAliases: Readonly<Record<string, string>> = {},
    commitLinearRepo?: CommitLinearRepository,
    projectKeys: readonly string[] = [],
  ) {
    this.logger = LoggerService.getInstance();
    this.commitRepo = commitRepo;
    this.commitJiraRepo = commitJiraRepo;
    this.commitLinearRepo = commitLinearRepo ?? null;
    this.keyAliases = keyAliases;
    this.projectKeys = projectKeys;

    this.logger.debug(CLASS_NAME, 'constructor', `DataEnhancerService created with ${Object.keys(keyAliases).length} key aliases`);
    this.logger.debug(CLASS_NAME, 'constructor', `Key aliases: ${JSON.stringify(keyAliases)}`);
    this.logger.debug(CLASS_NAME, 'constructor', `Project keys: [${projectKeys.join(', ')}]`);
    this.logger.debug(CLASS_NAME, 'constructor', `Linear support: ${commitLinearRepo ? 'enabled' : 'disabled'}`);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /** Run the full commit-to-Jira linking process. */
  async enhanceCommitJiraLinks(options: Partial<DataEnhancerOptions> = {}): Promise<DataEnhancerResult> {
    const opts: DataEnhancerOptions = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    this.logger.critical(CLASS_NAME, 'enhanceCommitJiraLinks', `Starting commit-Jira linking (refresh=${opts.refresh}, combine=${opts.combine})`);

    // Step 1: Build the project key list
    const jiraKeys = await this.buildJiraKeyList();
    this.logger.info(CLASS_NAME, 'enhanceCommitJiraLinks', `Jira project keys to scan: [${jiraKeys.join(', ')}]`);

    // Step 2: Get all commit authors
    const authors = await this.commitRepo.getCommitContributorLogins();
    this.logger.info(CLASS_NAME, 'enhanceCommitJiraLinks', `Processing ${authors.length} commit authors`);

    let totalCommitsScanned = 0;
    let totalLinksInserted = 0;
    let totalRefsUpdated = 0;

    // Step 3: Process each author (transaction isolation per author)
    for (const author of authors) {
      this.logger.debug(CLASS_NAME, 'enhanceCommitJiraLinks', `Processing author: ${author}`);

      // Step 3a: Update is_jira_ref flags
      const refsResult = await this.identifyCommitMsgJiraRef(author, jiraKeys, opts.refresh);
      totalRefsUpdated += refsResult.refsUpdated;

      // Step 3b: Insert commit-jira links
      const linksResult = await this.identifyCommitMsgJiraRelationship(
        author, jiraKeys, opts.refresh, opts.combine,
      );
      totalCommitsScanned += linksResult.commitsScanned;
      totalLinksInserted += linksResult.linksInserted;
    }

    const durationMs = Date.now() - startTime;

    this.logger.critical(CLASS_NAME, 'enhanceCommitJiraLinks', `Commit-Jira linking complete: ${totalLinksInserted} links inserted, ${totalRefsUpdated} refs updated in ${durationMs}ms`);

    return {
      authorsProcessed: authors.length,
      commitsScanned: totalCommitsScanned,
      linksInserted: totalLinksInserted,
      refsUpdated: totalRefsUpdated,
      durationMs,
    };
  }

  /** Run the full commit-to-Linear linking process. Ticket: IQS-875 */
  async enhanceCommitLinearLinks(
    linearKeys: readonly string[],
    options: Partial<DataEnhancerOptions> = {},
  ): Promise<DataEnhancerResult> {
    if (!this.commitLinearRepo) {
      this.logger.error(CLASS_NAME, 'enhanceCommitLinearLinks', 'CommitLinearRepository not provided');
      return { authorsProcessed: 0, commitsScanned: 0, linksInserted: 0, refsUpdated: 0, durationMs: 0 };
    }

    const opts: DataEnhancerOptions = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    this.logger.critical(CLASS_NAME, 'enhanceCommitLinearLinks', `Starting commit-Linear linking (refresh=${opts.refresh}, combine=${opts.combine})`);
    this.logger.info(CLASS_NAME, 'enhanceCommitLinearLinks', `Linear team keys to scan: [${linearKeys.join(', ')}]`);

    const authors = await this.commitRepo.getCommitContributorLogins();
    this.logger.info(CLASS_NAME, 'enhanceCommitLinearLinks', `Processing ${authors.length} commit authors`);

    let totalCommitsScanned = 0;
    let totalLinksInserted = 0;
    let totalRefsUpdated = 0;

    for (const author of authors) {
      this.logger.debug(CLASS_NAME, 'enhanceCommitLinearLinks', `Processing author: ${author}`);

      // Step 1: Update is_linear_ref flags
      const refsResult = await this.identifyCommitMsgLinearRef(author, linearKeys, opts.refresh);
      totalRefsUpdated += refsResult.refsUpdated;

      // Step 2: Insert commit-linear links
      const linksResult = await this.identifyCommitMsgLinearRelationship(
        author, linearKeys, opts.refresh, opts.combine,
      );
      totalCommitsScanned += linksResult.commitsScanned;
      totalLinksInserted += linksResult.linksInserted;
    }

    const durationMs = Date.now() - startTime;

    this.logger.critical(CLASS_NAME, 'enhanceCommitLinearLinks', `Commit-Linear linking complete: ${totalLinksInserted} links inserted, ${totalRefsUpdated} refs updated in ${durationMs}ms`);

    return {
      authorsProcessed: authors.length,
      commitsScanned: totalCommitsScanned,
      linksInserted: totalLinksInserted,
      refsUpdated: totalRefsUpdated,
      durationMs,
    };
  }

  /** Set is_linear_ref flag on commits containing Linear key references. IQS-875 */
  async identifyCommitMsgLinearRef(
    author: string,
    linearKeys: readonly string[],
    refresh: boolean,
  ): Promise<{ refsUpdated: number }> {
    if (!this.commitLinearRepo) {
      return { refsUpdated: 0 };
    }

    this.logger.debug(CLASS_NAME, 'identifyCommitMsgLinearRef', `Scanning linear refs for author: ${author} (refresh=${refresh})`);

    const commits = await this.commitLinearRepo.getCommitMsgForLinearRef(author, refresh);
    this.logger.debug(CLASS_NAME, 'identifyCommitMsgLinearRef', `Found ${commits.length} commits to scan for author: ${author}`);

    if (commits.length === 0) {
      return { refsUpdated: 0 };
    }

    const updates: Array<{ sha: string; isLinearRef: boolean }> = [];

    for (const commit of commits) {
      const upperMsg = commit.commitMessage.toUpperCase();
      let isLinearRef = false;

      for (const key of linearKeys) {
        if (upperMsg.includes(`${key.toUpperCase()}-`)) {
          isLinearRef = true;
          break;
        }
      }

      updates.push({ sha: commit.sha, isLinearRef });
      this.logger.trace(CLASS_NAME, 'identifyCommitMsgLinearRef', `sha=${commit.sha.substring(0, 8)} is_linear_ref=${isLinearRef}`);
    }

    await this.commitLinearRepo.batchUpdateIsLinearRef(updates);

    this.logger.debug(CLASS_NAME, 'identifyCommitMsgLinearRef', `Updated ${updates.length} is_linear_ref flags for author: ${author}`);
    return { refsUpdated: updates.length };
  }

  /** Scan commit messages for Linear key patterns and insert commit_linear links. IQS-875 */
  async identifyCommitMsgLinearRelationship(
    author: string,
    linearKeys: readonly string[],
    refresh: boolean,
    combine: boolean,
  ): Promise<{ commitsScanned: number; linksInserted: number }> {
    if (!this.commitLinearRepo) {
      return { commitsScanned: 0, linksInserted: 0 };
    }

    this.logger.debug(CLASS_NAME, 'identifyCommitMsgLinearRelationship', `Processing commit-to-linear links for author: ${author}`);

    if (refresh) {
      const deleted = await this.commitLinearRepo.deleteAuthorCommitLinear(author);
      this.logger.debug(CLASS_NAME, 'identifyCommitMsgLinearRelationship', `Deleted ${deleted} existing links for author: ${author}`);
    }

    const commits = await this.commitLinearRepo.getAuthorUnlinkedCommits(author, refresh, combine);
    this.logger.debug(CLASS_NAME, 'identifyCommitMsgLinearRelationship', `Processing ${commits.length} commits for author: ${author}`);

    if (commits.length === 0) {
      return { commitsScanned: 0, linksInserted: 0 };
    }

    const allRows: CommitLinearRow[] = [];

    for (const commit of commits) {
      this.logger.trace(CLASS_NAME, 'identifyCommitMsgLinearRelationship', `Scanning commit: ${commit.sha.substring(0, 8)}`);

      const matches = this.findJiraProjectRefsInText(linearKeys, commit.msg);

      const uniqueMatches = new Set<string>();
      for (const rawMatch of matches) {
        if (this.shouldExcludeMatch(rawMatch, linearKeys)) {
          continue;
        }
        const cleanedMatch = this.cleanupJiraKeyMatch(rawMatch, linearKeys);
        uniqueMatches.add(cleanedMatch);
      }

      for (const linearKey of uniqueMatches) {
        const dashIdx = linearKey.indexOf('-');
        const linearProject = dashIdx > 0 ? linearKey.substring(0, dashIdx) : linearKey;

        allRows.push({
          sha: commit.sha,
          linearKey,
          author,
          linearProject,
        });
        this.logger.debug(CLASS_NAME, 'identifyCommitMsgLinearRelationship', `Link: ${commit.sha.substring(0, 8)} -> ${linearKey}`);
      }
    }

    if (allRows.length > 0) {
      await this.commitLinearRepo.insertCommitLinear(allRows);
    }

    this.logger.debug(CLASS_NAME, 'identifyCommitMsgLinearRelationship', `Inserted ${allRows.length} commit-linear links for author: ${author}`);
    return { commitsScanned: commits.length, linksInserted: allRows.length };
  }

  // --------------------------------------------------------------------------
  // Step 1: is_jira_ref flag processing
  // --------------------------------------------------------------------------

  /**
   * Set is_jira_ref flag on commits containing Jira key references.
   * Maps from Python GitjaDataEnhancer.identify_commit_msg_jira_ref().
   */
  async identifyCommitMsgJiraRef(
    author: string,
    jiraKeys: readonly string[],
    refresh: boolean,
  ): Promise<{ refsUpdated: number }> {
    this.logger.debug(CLASS_NAME, 'identifyCommitMsgJiraRef', `Scanning jira refs for author: ${author} (refresh=${refresh})`);

    const commits = await this.commitJiraRepo.getCommitMsgForJiraRef(author, refresh);
    this.logger.debug(CLASS_NAME, 'identifyCommitMsgJiraRef', `Found ${commits.length} commits to scan for author: ${author}`);

    if (commits.length === 0) {
      return { refsUpdated: 0 };
    }

    // Build batch of updates
    const updates: Array<{ sha: string; isJiraRef: boolean }> = [];

    for (const commit of commits) {
      const upperMsg = commit.commitMessage.toUpperCase();
      let isJiraRef = false;

      // Check if any jira key followed by hyphen appears in the message
      for (const key of jiraKeys) {
        if (upperMsg.includes(`${key.toUpperCase()}-`)) {
          isJiraRef = true;
          break;
        }
      }

      updates.push({ sha: commit.sha, isJiraRef });
      this.logger.trace(CLASS_NAME, 'identifyCommitMsgJiraRef', `sha=${commit.sha.substring(0, 8)} is_jira_ref=${isJiraRef}`);
    }

    // Batch update in a transaction
    await this.commitRepo.batchUpdateIsJiraRef(updates);

    this.logger.debug(CLASS_NAME, 'identifyCommitMsgJiraRef', `Updated ${updates.length} is_jira_ref flags for author: ${author}`);
    return { refsUpdated: updates.length };
  }

  // --------------------------------------------------------------------------
  // Step 2: commit_jira relationship processing
  // --------------------------------------------------------------------------

  /**
   * Scan commit messages for Jira key patterns and insert commit_jira links.
   * Maps from Python GitjaDataEnhancer.identify_commit_msg_jira_relationship().
   */
  async identifyCommitMsgJiraRelationship(
    author: string,
    jiraKeys: readonly string[],
    refresh: boolean,
    combine: boolean,
  ): Promise<{ commitsScanned: number; linksInserted: number }> {
    this.logger.debug(CLASS_NAME, 'identifyCommitMsgJiraRelationship', `Processing commit-to-jira links for author: ${author} (refresh=${refresh}, combine=${combine})`);

    // In refresh mode, delete existing links for this author first
    if (refresh) {
      const deleted = await this.commitJiraRepo.deleteAuthorCommitJira(author);
      this.logger.debug(CLASS_NAME, 'identifyCommitMsgJiraRelationship', `Deleted ${deleted} existing links for author: ${author}`);
    }

    // Get unlinked (or all) commits for this author
    const commits = await this.commitJiraRepo.getAuthorUnlinkedCommits(author, refresh, combine);
    this.logger.debug(CLASS_NAME, 'identifyCommitMsgJiraRelationship', `Processing ${commits.length} commits for author: ${author}`);

    if (commits.length === 0) {
      return { commitsScanned: 0, linksInserted: 0 };
    }

    // Collect all commit_jira rows to insert
    const allRows: CommitJiraRow[] = [];

    for (const commit of commits) {
      this.logger.trace(CLASS_NAME, 'identifyCommitMsgJiraRelationship', `Scanning commit: ${commit.sha.substring(0, 8)}`);

      // Find all Jira key pattern matches in the text
      const matches = this.findJiraProjectRefsInText(jiraKeys, commit.msg);

      // De-duplicate after exclusion and cleanup
      const uniqueMatches = new Set<string>();
      for (const rawMatch of matches) {
        this.logger.trace(CLASS_NAME, 'identifyCommitMsgJiraRelationship', `Raw match: ${rawMatch}`);

        if (this.shouldExcludeMatch(rawMatch, jiraKeys)) {
          this.logger.trace(CLASS_NAME, 'identifyCommitMsgJiraRelationship', `Excluded match: ${rawMatch}`);
          continue;
        }

        const cleanedMatch = this.cleanupJiraKeyMatch(rawMatch, jiraKeys);
        uniqueMatches.add(cleanedMatch);
        this.logger.trace(CLASS_NAME, 'identifyCommitMsgJiraRelationship', `Cleaned match: ${rawMatch} -> ${cleanedMatch}`);
      }

      // Create commit_jira rows for unique matches
      for (const jiraKey of uniqueMatches) {
        // Extract project key from the jira key (e.g., "PROJ-123" -> "PROJ")
        const dashIdx = jiraKey.indexOf('-');
        const jiraProject = dashIdx > 0 ? jiraKey.substring(0, dashIdx) : jiraKey;

        allRows.push({
          sha: commit.sha,
          jiraKey,
          author,
          jiraProject,
        });
        this.logger.debug(CLASS_NAME, 'identifyCommitMsgJiraRelationship', `Link: ${commit.sha.substring(0, 8)} -> ${jiraKey}`);
      }
    }

    // Batch insert all rows
    if (allRows.length > 0) {
      await this.commitJiraRepo.insertCommitJira(allRows);
    }

    this.logger.debug(CLASS_NAME, 'identifyCommitMsgJiraRelationship', `Inserted ${allRows.length} commit-jira links for author: ${author}`);
    return { commitsScanned: commits.length, linksInserted: allRows.length };
  }

  // --------------------------------------------------------------------------
  // Regex pattern matching (public for testing)
  // --------------------------------------------------------------------------

  /**
   * Find all project key references in text (PROJ-123 patterns).
   * Maps from Python find_jira_project_refs_in_text(). Uses regex (?:KEY1|KEY2|...)(?:[-.\s]*\d+).
   */
  findJiraProjectRefsInText(projectKeys: readonly string[], text: string): string[] {
    if (projectKeys.length === 0 || text.length === 0) {
      this.logger.trace(CLASS_NAME, 'findJiraProjectRefsInText', 'Empty keys or text, returning no matches');
      return [];
    }

    // Escape special regex characters in project keys (matching Python re.escape)
    const escapedKeys = projectKeys.map((key) => this.escapeRegExp(key));

    // Build the pattern: (?:KEY1|KEY2|...)(?:[-.\s]*\d+)
    // Matches a project key followed by optional separators (hyphen, dot, space) and one or more digits
    const patternStr = `(?:${escapedKeys.join('|')})(?:[-\\.\\s]*\\d+)`;

    this.logger.trace(CLASS_NAME, 'findJiraProjectRefsInText', `Regex pattern: ${patternStr}`);

    const regex = new RegExp(patternStr, 'gi');
    const matches: string[] = [];

    for (const match of text.matchAll(regex)) {
      matches.push(match[0]);
    }

    this.logger.trace(CLASS_NAME, 'findJiraProjectRefsInText', `Found ${matches.length} matches in text`);
    return matches;
  }

  // --------------------------------------------------------------------------
  // Exclusion logic (public for testing)
  // --------------------------------------------------------------------------

  /**
   * Determine if a matched string should be excluded from linking.
   * Excludes: release tags (SFDC.20), bare keys, padded zeros (CPD-20).
   * Maps from Python _should_exclude_match().
   */
  shouldExcludeMatch(targetString: string, projectKeys: readonly string[]): boolean {
    // Rule 1: Release tags (SFDC.20 pattern)
    if (/SFDC\.20/i.test(targetString)) {
      this.logger.trace(CLASS_NAME, 'shouldExcludeMatch', `Excluding release tag: ${targetString}`);
      return true;
    }

    // Rule 2: No numeric suffix
    if (!/\d+/.test(targetString)) {
      this.logger.trace(CLASS_NAME, 'shouldExcludeMatch', `Excluding no-numeric: ${targetString}`);
      return true;
    }

    // Rule 3: Target is exactly a project key
    const upperTarget = targetString.toUpperCase();
    if (projectKeys.some((key) => key.toUpperCase() === upperTarget)) {
      this.logger.trace(CLASS_NAME, 'shouldExcludeMatch', `Excluding bare project key: ${targetString}`);
      return true;
    }

    // Rule 4: Target without hyphens is exactly a project key
    const noHyphenTarget = upperTarget.replace(/-/g, '');
    if (projectKeys.some((key) => key.toUpperCase() === noHyphenTarget)) {
      this.logger.trace(CLASS_NAME, 'shouldExcludeMatch', `Excluding bare project key (no hyphen): ${targetString}`);
      return true;
    }

    // Rule 5: Padded zero pattern (CPD-20)
    if (/CPD-20/i.test(targetString)) {
      this.logger.trace(CLASS_NAME, 'shouldExcludeMatch', `Excluding padded zero: ${targetString}`);
      return true;
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Cleanup logic (public for testing)
  // --------------------------------------------------------------------------

  /**
   * Clean up matched key string: normalize spacing, apply aliases, fix hyphens.
   * Maps from Python _cleanup_jira_key_match().
   */
  cleanupJiraKeyMatch(targetString: string, projectKeys: readonly string[]): string {
    let result = targetString;

    // Step 1: Replace spaces with hyphens
    result = result.replace(/ /g, '-');

    // Step 2: Apply key aliases from settings
    for (const [source, target] of Object.entries(this.keyAliases)) {
      result = result.replace(new RegExp(`${this.escapeRegExp(source)}-`, 'g'), `${target}-`);
    }

    // Step 3: Fix triple hyphens
    result = result.replace(/---/g, '-');

    // Step 4: Fix double hyphens
    result = result.replace(/--/g, '-');

    // Step 5: Fix padded zeros (CDP-0 -> CDP-)
    result = result.replace(/CDP-0/g, 'CDP-');

    // Step 6: Fix missing hyphens between project key and number
    result = this.replaceRefWithoutHyphen(projectKeys, result);

    this.logger.trace(CLASS_NAME, 'cleanupJiraKeyMatch', `Cleanup: "${targetString}" -> "${result}"`);
    return result;
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  /** Insert hyphen between project key and number if missing. Maps from Python _replace_ref_without_hyphen(). */
  private replaceRefWithoutHyphen(projectKeys: readonly string[], targetString: string): string {
    for (const proj of projectKeys) {
      for (let i = 1; i <= 9; i++) {
        const pattern = `${proj}${i}`;
        if (targetString.includes(pattern) && !/PROJ2/i.test(targetString)) {
          const result = targetString.replace(pattern, `${proj}-${i}`);
          this.logger.trace(CLASS_NAME, 'replaceRefWithoutHyphen', `Fixed missing hyphen: "${targetString}" -> "${result}"`);
          return result;
        }
      }
    }
    return targetString;
  }

  /**
   * Build deduplicated Jira key list from configured project keys + alias source keys.
   * IQS-935: Now uses projectKeys from constructor instead of stub getContributorTeams().
   */
  private async buildJiraKeyList(): Promise<string[]> {
    this.logger.debug(CLASS_NAME, 'buildJiraKeyList', 'Building Jira project key list');

    // IQS-935: Use project keys from settings (passed via constructor)
    const keySet = new Set<string>(this.projectKeys);
    this.logger.debug(CLASS_NAME, 'buildJiraKeyList', `Project keys from settings: [${this.projectKeys.join(', ')}]`);

    // Add source keys from aliases (these are the keys to scan for,
    // which will be replaced during cleanup)
    for (const sourceKey of Object.keys(this.keyAliases)) {
      keySet.add(sourceKey);
      this.logger.trace(CLASS_NAME, 'buildJiraKeyList', `Added alias source key: ${sourceKey}`);
    }

    const result = Array.from(keySet);
    this.logger.debug(CLASS_NAME, 'buildJiraKeyList', `Final key list (${result.length} keys): [${result.join(', ')}]`);

    if (result.length === 0) {
      this.logger.warn(CLASS_NAME, 'buildJiraKeyList', 'No Jira project keys configured. Set gitrx.jira.projectKeys in VS Code settings.');
    }

    return result;
  }

  /** Escape special regex characters. Maps from Python re.escape(). */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
