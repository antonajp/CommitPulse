import type { PoolClient } from 'pg';
import { DatabaseService, type DatabaseQueryResult } from './database-service.js';
import { LoggerService } from '../logging/logger.js';
import type {
  JiraDetailRow,
  JiraHistoryRow,
  JiraIssueLinkRow,
  JiraParentRow,
  JiraGitHubBranchRow,
  JiraGitHubPullRequestRow,
  JiraProjectMaxIssue,
  UnfinishedJiraIssue,
  UnfinishedJiraIssue2,
  KnownJiraGitHubBranch,
  KnownJiraGitHubPR,
} from './jira-types.js';

// Re-export types so consumers can import from jira-repository directly
export type {
  JiraDetailRow,
  JiraHistoryRow,
  JiraIssueLinkRow,
  JiraParentRow,
  JiraGitHubBranchRow,
  JiraGitHubPullRequestRow,
  JiraProjectMaxIssue,
  UnfinishedJiraIssue,
  UnfinishedJiraIssue2,
  KnownJiraGitHubBranch,
  KnownJiraGitHubPR,
} from './jira-types.js';

/** Class name constant for structured logging context. */
const CLASS_NAME = 'JiraRepository';

// ============================================================================
// SQL Constants - all parameterized, zero string interpolation
// ============================================================================

const SQL_UPSERT_JIRA_DETAIL = `
  INSERT INTO jira_detail
    (jira_id, jira_key, priority, created_date, url, summary, description,
     reporter, issuetype, project, resolution, assignee, status,
     fixversion, component, status_change_date, points)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
  ON CONFLICT (jira_key) DO UPDATE SET
    jira_id = EXCLUDED.jira_id,
    priority = EXCLUDED.priority,
    url = EXCLUDED.url,
    summary = EXCLUDED.summary,
    description = EXCLUDED.description,
    reporter = EXCLUDED.reporter,
    issuetype = EXCLUDED.issuetype,
    project = EXCLUDED.project,
    resolution = EXCLUDED.resolution,
    assignee = EXCLUDED.assignee,
    status = EXCLUDED.status,
    fixversion = EXCLUDED.fixversion,
    component = EXCLUDED.component,
    status_change_date = EXCLUDED.status_change_date,
    points = EXCLUDED.points
`;

const SQL_INSERT_JIRA_HISTORY = `
  INSERT INTO jira_history
    (jira_key, change_date, assignee, field, from_value, to_value)
  VALUES ($1, $2, $3, $4, $5, $6)
`;

const SQL_INSERT_JIRA_ISSUE_LINK = `
  INSERT INTO jira_issue_link
    (jira_key, link_type, link_key, link_status, link_priority, issue_type)
  VALUES ($1, $2, $3, $4, $5, $6)
`;

const SQL_INSERT_JIRA_PARENT = `
  INSERT INTO jira_parent
    (jira_key, parent_key, parent_summary, parent_type)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (jira_key, parent_key) DO NOTHING
`;

const SQL_INSERT_JIRA_GITHUB_BRANCH = `
  INSERT INTO jira_github_branch
    (jira_id, jira_key, branch_name, display_id, last_commit,
     author_date, author, branch_url, pull_url, commit_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (jira_id, last_commit, branch_name) DO NOTHING
`;

const SQL_INSERT_JIRA_GITHUB_PR = `
  INSERT INTO jira_github_pullrequest
    (jira_id, jira_key, id, name, source_branch, source_url,
     destination_branch, destination_url, pull_status, url, last_update)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (jira_id, id) DO NOTHING
`;

const SQL_GET_DISTINCT_JIRA_KEYS_FROM_DETAILS = `
  SELECT DISTINCT jira_key FROM jira_detail
`;

const SQL_GET_DISTINCT_JIRA_PROJ_REFS = `
  SELECT DISTINCT project FROM jira_detail
`;

const SQL_IDENTIFY_JIRA_PROJ_MAX_ISSUE = `
  SELECT split_part(jira_key, '-', 1) AS jira_key,
         MAX(CAST(split_part(jira_key, '-', 2) AS INTEGER)) AS count
  FROM jira_detail
  GROUP BY 1
  ORDER BY count DESC
`;

const SQL_GET_UNFINISHED_JIRA_ISSUES = `
  SELECT jira_key, change_date
  FROM vw_unfinished_jira_issues
`;

const SQL_GET_UNFINISHED_JIRA_ISSUES_2 = `
  SELECT jira_key
  FROM jira_detail
  WHERE NOT status IN ('Done', 'Cancelled')
  UNION
  SELECT jira_key
  FROM jira_detail
  WHERE status IN ('Done', 'Cancelled')
  AND status_change_date >= CURRENT_DATE - $1::int
  ORDER BY jira_key
`;

const SQL_GET_KNOWN_JIRA_GITHUB_BRANCHES = `
  SELECT jira_id, last_commit, branch_name
  FROM jira_github_branch
`;

const SQL_GET_KNOWN_JIRA_GITHUB_PRS = `
  SELECT jira_id, id FROM jira_github_pullrequest
`;

const SQL_DELETE_JIRA_HISTORY_FOR_KEY = `
  DELETE FROM jira_history WHERE jira_key = $1
`;

const SQL_DELETE_JIRA_ISSUE_LINKS_FOR_KEY = `
  DELETE FROM jira_issue_link WHERE jira_key = $1
`;

const SQL_DELETE_JIRA_GITHUB_BRANCH_FOR_KEY = `
  DELETE FROM jira_github_branch WHERE jira_key = $1
`;

const SQL_DELETE_JIRA_GITHUB_PR_FOR_KEY = `
  DELETE FROM jira_github_pullrequest WHERE jira_key = $1
`;

const SQL_GET_JIRA_ISSUES_NEEDING_STORY_POINTS_BACKFILL = `
  SELECT jira_key, created_date, status_change_date
  FROM jira_detail
  WHERE calculated_story_points IS NULL
  AND status_change_date IS NOT NULL
`;

const SQL_UPDATE_JIRA_CALCULATED_STORY_POINTS = `
  UPDATE jira_detail
  SET calculated_story_points = $1
  WHERE jira_key = $2
`;

/**
 * SQL to count rows in jira_detail table for audit logging.
 */
const SQL_COUNT_JIRA_DETAIL = `
  SELECT COUNT(*) AS count FROM jira_detail
`;

/**
 * SQL to truncate all Jira-related tables in FK dependency order.
 * Clears child tables before parent tables to respect foreign key constraints.
 * Does NOT clear commit_jira to preserve commit-to-issue mappings.
 *
 * Tables cleared (in order):
 *   1. gitr_pipeline_jira - pipeline logs referencing Jira issues
 *   2. jira_github_pullrequest - PR links
 *   3. jira_github_branch - branch links
 *   4. jira_parent - parent-child relationships
 *   5. jira_issue_link - issue links
 *   6. jira_history - changelog history
 *   7. jira_detail - main issue details (cleared last)
 *
 * Ticket: IQS-933
 */
const SQL_TRUNCATE_ALL_JIRA_TABLES = `
  TRUNCATE TABLE
    gitr_pipeline_jira,
    jira_github_pullrequest,
    jira_github_branch,
    jira_parent,
    jira_issue_link,
    jira_history,
    jira_detail
  CASCADE
`;

/**
 * Repository for Jira-related database tables. All queries use parameterized
 * SQL ($1, $2 placeholders) -- zero string interpolation. Ticket: IQS-853
 */
export class JiraRepository {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'JiraRepository created');
  }

  // --------------------------------------------------------------------------
  // Insert / Upsert methods
  // --------------------------------------------------------------------------

  /**
   * Upsert a single jira_detail row.
   * Uses ON CONFLICT to update existing records by jira_key.
   *
   * @param detail - The Jira detail data to upsert
   */
  async upsertJiraDetail(detail: JiraDetailRow): Promise<void> {
    this.logger.debug(CLASS_NAME, 'upsertJiraDetail', `Upserting: ${detail.jiraKey}`);

    await this.db.query(SQL_UPSERT_JIRA_DETAIL, [
      detail.jiraId,
      detail.jiraKey,
      detail.priority,
      detail.createdDate,
      detail.url,
      detail.summary,
      detail.description,
      detail.reporter,
      detail.issuetype,
      detail.project,
      detail.resolution,
      detail.assignee,
      detail.status,
      detail.fixversion,
      detail.component,
      detail.statusChangeDate,
      detail.points,
    ]);

    this.logger.trace(CLASS_NAME, 'upsertJiraDetail', `Upserted: ${detail.jiraKey}`);
  }

  /**
   * Batch upsert jira_detail rows within a transaction.
   *
   * @param details - Array of Jira detail rows to upsert
   */
  async batchUpsertJiraDetails(details: readonly JiraDetailRow[]): Promise<void> {
    if (details.length === 0) {
      this.logger.debug(CLASS_NAME, 'batchUpsertJiraDetails', 'No details to upsert');
      return;
    }

    this.logger.debug(CLASS_NAME, 'batchUpsertJiraDetails', `Upserting ${details.length} Jira details`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const detail of details) {
        await client.query(SQL_UPSERT_JIRA_DETAIL, [
          detail.jiraId, detail.jiraKey, detail.priority, detail.createdDate,
          detail.url, detail.summary, detail.description, detail.reporter,
          detail.issuetype, detail.project, detail.resolution, detail.assignee,
          detail.status, detail.fixversion, detail.component,
          detail.statusChangeDate, detail.points,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'batchUpsertJiraDetails', `${details.length} details upserted`);
  }

  /**
   * Insert Jira history rows for a specific key. Deletes existing history
   * first for full replacement, then batch inserts in a transaction.
   *
   * @param jiraKey - The Jira key whose history is being replaced
   * @param history - Array of history rows to insert
   */
  async replaceJiraHistory(jiraKey: string, history: readonly JiraHistoryRow[]): Promise<void> {
    this.logger.debug(CLASS_NAME, 'replaceJiraHistory', `Replacing ${history.length} history entries for: ${jiraKey}`);

    await this.db.transaction(async (client: PoolClient) => {
      await client.query(SQL_DELETE_JIRA_HISTORY_FOR_KEY, [jiraKey]);
      for (const row of history) {
        await client.query(SQL_INSERT_JIRA_HISTORY, [
          row.jiraKey, row.changeDate, row.assignee,
          row.field, row.fromValue, row.toValue,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'replaceJiraHistory', `History replaced for: ${jiraKey}`);
  }

  /**
   * Batch insert jira_history rows within a transaction.
   * Does not delete existing entries -- use replaceJiraHistory for replacement.
   *
   * @param history - Array of history rows to insert
   */
  async insertJiraHistory(history: readonly JiraHistoryRow[]): Promise<void> {
    if (history.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertJiraHistory', 'No history entries to insert');
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertJiraHistory', `Inserting ${history.length} history entries`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const row of history) {
        await client.query(SQL_INSERT_JIRA_HISTORY, [
          row.jiraKey, row.changeDate, row.assignee,
          row.field, row.fromValue, row.toValue,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertJiraHistory', `${history.length} history entries inserted`);
  }

  /**
   * Insert Jira issue links for a specific key. Deletes existing links
   * first for full replacement, then batch inserts in a transaction.
   *
   * @param jiraKey - The Jira key whose links are being replaced
   * @param links - Array of issue link rows to insert
   */
  async replaceJiraIssueLinks(jiraKey: string, links: readonly JiraIssueLinkRow[]): Promise<void> {
    this.logger.debug(CLASS_NAME, 'replaceJiraIssueLinks', `Replacing ${links.length} links for: ${jiraKey}`);

    await this.db.transaction(async (client: PoolClient) => {
      await client.query(SQL_DELETE_JIRA_ISSUE_LINKS_FOR_KEY, [jiraKey]);
      for (const link of links) {
        await client.query(SQL_INSERT_JIRA_ISSUE_LINK, [
          link.jiraKey, link.linkType, link.linkKey,
          link.linkStatus, link.linkPriority, link.issueType,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'replaceJiraIssueLinks', `Links replaced for: ${jiraKey}`);
  }

  /**
   * Batch insert jira_parent rows within a transaction.
   * Uses ON CONFLICT DO NOTHING for idempotency.
   *
   * @param parents - Array of parent rows to insert
   */
  async insertJiraParents(parents: readonly JiraParentRow[]): Promise<void> {
    if (parents.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertJiraParents', 'No parent rows to insert');
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertJiraParents', `Inserting ${parents.length} parent rows`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const parent of parents) {
        await client.query(SQL_INSERT_JIRA_PARENT, [
          parent.jiraKey, parent.parentKey,
          parent.parentSummary, parent.parentType,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertJiraParents', `${parents.length} parent rows inserted`);
  }

  /**
   * Batch insert jira_github_branch rows within a transaction.
   * Uses ON CONFLICT DO NOTHING for idempotency.
   *
   * @param branches - Array of GitHub branch rows to insert
   */
  async insertJiraGitHubBranches(branches: readonly JiraGitHubBranchRow[]): Promise<void> {
    if (branches.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertJiraGitHubBranches', 'No branches to insert');
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertJiraGitHubBranches', `Inserting ${branches.length} GitHub branches`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const branch of branches) {
        await client.query(SQL_INSERT_JIRA_GITHUB_BRANCH, [
          branch.jiraId, branch.jiraKey, branch.branchName,
          branch.displayId, branch.lastCommit, branch.authorDate,
          branch.author, branch.branchUrl, branch.pullUrl, branch.commitUrl,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertJiraGitHubBranches', `${branches.length} branches inserted`);
  }

  /**
   * Batch insert jira_github_pullrequest rows within a transaction.
   * Uses ON CONFLICT DO NOTHING for idempotency.
   *
   * @param prs - Array of GitHub pull request rows to insert
   */
  async insertJiraGitHubPullRequests(prs: readonly JiraGitHubPullRequestRow[]): Promise<void> {
    if (prs.length === 0) {
      this.logger.debug(CLASS_NAME, 'insertJiraGitHubPullRequests', 'No pull requests to insert');
      return;
    }

    this.logger.debug(CLASS_NAME, 'insertJiraGitHubPullRequests', `Inserting ${prs.length} GitHub pull requests`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const pr of prs) {
        await client.query(SQL_INSERT_JIRA_GITHUB_PR, [
          pr.jiraId, pr.jiraKey, pr.id, pr.name,
          pr.sourceBranch, pr.sourceUrl,
          pr.destinationBranch, pr.destinationUrl,
          pr.pullStatus, pr.url, pr.lastUpdate,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'insertJiraGitHubPullRequests', `${prs.length} pull requests inserted`);
  }

  // --------------------------------------------------------------------------
  // Delete methods
  // --------------------------------------------------------------------------

  /** Delete GitHub branch and PR records for a specific Jira key. */
  async deleteGitHubDataForKey(jiraKey: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'deleteGitHubDataForKey', `Deleting GitHub data for: ${jiraKey}`);

    await this.db.transaction(async (client: PoolClient) => {
      await client.query(SQL_DELETE_JIRA_GITHUB_BRANCH_FOR_KEY, [jiraKey]);
      await client.query(SQL_DELETE_JIRA_GITHUB_PR_FOR_KEY, [jiraKey]);
    });

    this.logger.trace(CLASS_NAME, 'deleteGitHubDataForKey', `GitHub data deleted for: ${jiraKey}`);
  }

  /** Delete jira_history records for a specific Jira key. */
  async deleteHistoryForKey(jiraKey: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'deleteHistoryForKey', `Deleting history for: ${jiraKey}`);

    await this.db.query(SQL_DELETE_JIRA_HISTORY_FOR_KEY, [jiraKey]);

    this.logger.trace(CLASS_NAME, 'deleteHistoryForKey', `History deleted for: ${jiraKey}`);
  }

  // --------------------------------------------------------------------------
  // Query methods
  // --------------------------------------------------------------------------

  /**
   * Get distinct Jira keys from the jira_detail table.
   * Maps from Python PostgresDB.py get_distinct_jira_keys_from_details().
   */
  async getDistinctJiraKeysFromDetails(): Promise<Set<string>> {
    this.logger.debug(CLASS_NAME, 'getDistinctJiraKeysFromDetails', 'Querying distinct keys from jira_detail');

    const result: DatabaseQueryResult<{ jira_key: string }> =
      await this.db.query(SQL_GET_DISTINCT_JIRA_KEYS_FROM_DETAILS);

    const keys = new Set<string>();
    for (const row of result.rows) {
      keys.add(row.jira_key);
    }

    this.logger.debug(CLASS_NAME, 'getDistinctJiraKeysFromDetails', `Found ${keys.size} distinct keys`);
    return keys;
  }

  /**
   * Get distinct Jira project references from jira_detail.
   * Maps from Python PostgresDB.py get_distinct_jira_proj_refs().
   *
   * Note: The Python version hardcoded 'PROJ' and 'CRM' additions.
   * In the TypeScript version, extra project refs are configurable
   * via the additionalProjects parameter (externalized from code).
   *
   * @param additionalProjects - Extra project keys to include (replaces hardcoded PROJ/CRM)
   */
  async getDistinctJiraProjectRefs(additionalProjects: readonly string[] = []): Promise<Set<string>> {
    this.logger.debug(CLASS_NAME, 'getDistinctJiraProjectRefs', 'Querying distinct project refs');

    const result: DatabaseQueryResult<{ project: string }> =
      await this.db.query(SQL_GET_DISTINCT_JIRA_PROJ_REFS);

    const projects = new Set<string>();
    for (const row of result.rows) {
      projects.add(row.project);
    }

    // Add configured additional projects (replaces Python's hardcoded PROJ/CRM)
    for (const proj of additionalProjects) {
      projects.add(proj);
    }

    this.logger.debug(CLASS_NAME, 'getDistinctJiraProjectRefs', `Found ${projects.size} project refs (including ${additionalProjects.length} additional)`);
    return projects;
  }

  /**
   * Identify the maximum issue number per Jira project prefix.
   * Maps from Python PostgresDB.py identify_jira_proj_max_issue().
   */
  async identifyJiraProjMaxIssue(): Promise<JiraProjectMaxIssue[]> {
    this.logger.debug(CLASS_NAME, 'identifyJiraProjMaxIssue', 'Querying max issue per project');

    const result: DatabaseQueryResult<{ jira_key: string; count: number }> =
      await this.db.query(SQL_IDENTIFY_JIRA_PROJ_MAX_ISSUE);

    const projects: JiraProjectMaxIssue[] = result.rows.map((row) => ({
      jiraKey: row.jira_key,
      count: row.count,
    }));

    this.logger.debug(CLASS_NAME, 'identifyJiraProjMaxIssue', `Found ${projects.length} projects`);
    return projects;
  }

  /**
   * Get unfinished Jira issues from the vw_unfinished_jira_issues view.
   * Maps from Python PostgresDB.py get_unfinished_jira_issues().
   */
  async getUnfinishedJiraIssues(): Promise<UnfinishedJiraIssue[]> {
    this.logger.debug(CLASS_NAME, 'getUnfinishedJiraIssues', 'Querying unfinished issues from view');

    const result: DatabaseQueryResult<{ jira_key: string; change_date: Date }> =
      await this.db.query(SQL_GET_UNFINISHED_JIRA_ISSUES);

    const issues: UnfinishedJiraIssue[] = result.rows.map((row) => ({
      jiraKey: row.jira_key,
      changeDate: row.change_date,
    }));

    this.logger.debug(CLASS_NAME, 'getUnfinishedJiraIssues', `Found ${issues.length} unfinished issues`);
    return issues;
  }

  /**
   * Get unfinished Jira issues using direct status query.
   * Maps from Python PostgresDB.py get_unfinished_jira_issues2().
   * Returns issues not Done/Cancelled, plus recently completed ones.
   *
   * @param daysAgo - Number of days to look back for recently completed issues (default: 2)
   */
  async getUnfinishedJiraIssues2(daysAgo = 2): Promise<UnfinishedJiraIssue2[]> {
    this.logger.debug(CLASS_NAME, 'getUnfinishedJiraIssues2', `Querying with daysAgo=${daysAgo}`);

    const result: DatabaseQueryResult<{ jira_key: string }> =
      await this.db.query(SQL_GET_UNFINISHED_JIRA_ISSUES_2, [daysAgo]);

    const issues: UnfinishedJiraIssue2[] = result.rows.map((row) => ({
      jiraKey: row.jira_key,
    }));

    this.logger.debug(CLASS_NAME, 'getUnfinishedJiraIssues2', `Found ${issues.length} issues`);
    return issues;
  }

  /**
   * Get known Jira GitHub branch records.
   * Maps from Python PostgresDB.py get_known_jira_github_branches().
   */
  async getKnownJiraGitHubBranches(): Promise<KnownJiraGitHubBranch[]> {
    this.logger.debug(CLASS_NAME, 'getKnownJiraGitHubBranches', 'Querying known branches');

    const result: DatabaseQueryResult<{
      jira_id: number; last_commit: string; branch_name: string;
    }> = await this.db.query(SQL_GET_KNOWN_JIRA_GITHUB_BRANCHES);

    const branches: KnownJiraGitHubBranch[] = result.rows.map((row) => ({
      jiraId: row.jira_id,
      lastCommit: row.last_commit,
      branchName: row.branch_name,
    }));

    this.logger.debug(CLASS_NAME, 'getKnownJiraGitHubBranches', `Found ${branches.length} known branches`);
    return branches;
  }

  /**
   * Get known Jira GitHub pull request records.
   * Maps from Python PostgresDB.py get_known_jira_github_pullrequests().
   */
  async getKnownJiraGitHubPRs(): Promise<KnownJiraGitHubPR[]> {
    this.logger.debug(CLASS_NAME, 'getKnownJiraGitHubPRs', 'Querying known PRs');

    const result: DatabaseQueryResult<{ jira_id: number; id: string }> =
      await this.db.query(SQL_GET_KNOWN_JIRA_GITHUB_PRS);

    const prs: KnownJiraGitHubPR[] = result.rows.map((row) => ({
      jiraId: row.jira_id,
      id: row.id,
    }));

    this.logger.debug(CLASS_NAME, 'getKnownJiraGitHubPRs', `Found ${prs.length} known PRs`);
    return prs;
  }

  // --------------------------------------------------------------------------
  // Story Points Backfill methods (IQS-884)
  // --------------------------------------------------------------------------

  /** Get Jira issues needing calculated story points (WHERE calculated_story_points IS NULL). */
  async getIssuesNeedingStoryPointsBackfill(): Promise<
    Array<{ jira_key: string; created_date: Date | null; status_change_date: Date | null }>
  > {
    this.logger.debug(CLASS_NAME, 'getIssuesNeedingStoryPointsBackfill', 'Querying issues needing story points');
    const result: DatabaseQueryResult<{ jira_key: string; created_date: Date | null; status_change_date: Date | null }> =
      await this.db.query(SQL_GET_JIRA_ISSUES_NEEDING_STORY_POINTS_BACKFILL);
    this.logger.debug(CLASS_NAME, 'getIssuesNeedingStoryPointsBackfill', `Found ${result.rows.length} issues`);
    return result.rows;
  }

  /** Update calculated_story_points for a Jira issue. Parameterized ($1, $2). */
  async updateCalculatedStoryPoints(jiraKey: string, points: number): Promise<void> {
    this.logger.debug(CLASS_NAME, 'updateCalculatedStoryPoints', `Updating ${jiraKey}: ${points} pts`);
    await this.db.query(SQL_UPDATE_JIRA_CALCULATED_STORY_POINTS, [points, jiraKey]);
    this.logger.trace(CLASS_NAME, 'updateCalculatedStoryPoints', `Updated ${jiraKey}`);
  }

  // --------------------------------------------------------------------------
  // Jira Backfill methods (IQS-933)
  // --------------------------------------------------------------------------

  /**
   * Get the count of rows in jira_detail table.
   * Used for audit logging before/after backfill operations.
   *
   * @returns Number of issues in jira_detail
   */
  async getJiraDetailCount(): Promise<number> {
    this.logger.debug(CLASS_NAME, 'getJiraDetailCount', 'Counting jira_detail rows');
    const result: DatabaseQueryResult<{ count: string }> =
      await this.db.query(SQL_COUNT_JIRA_DETAIL);
    const count = parseInt(result.rows[0]?.count ?? '0', 10);
    this.logger.debug(CLASS_NAME, 'getJiraDetailCount', `Count: ${count}`);
    return count;
  }

  /**
   * Clear all Jira-related tables in preparation for a full reload.
   * Truncates tables in FK dependency order to respect foreign key constraints.
   *
   * IMPORTANT: This is a destructive operation. The caller must:
   *   1. Display a confirmation dialog to the user
   *   2. Validate Jira credentials before calling this method
   *
   * Preserves commit_jira table so commits retain their Jira key references.
   *
   * Tables cleared:
   *   - gitr_pipeline_jira (pipeline logs)
   *   - jira_github_pullrequest (PR links)
   *   - jira_github_branch (branch links)
   *   - jira_parent (parent-child relationships)
   *   - jira_issue_link (issue links)
   *   - jira_history (changelog history)
   *   - jira_detail (main issue details)
   *
   * @returns Object with countBefore for audit logging
   * @throws Error if truncation fails
   *
   * Ticket: IQS-933
   */
  async clearAllJiraData(): Promise<{ countBefore: number }> {
    this.logger.info(CLASS_NAME, 'clearAllJiraData', 'Starting Jira data clear operation');

    // Audit: count rows before truncation
    const countBefore = await this.getJiraDetailCount();
    this.logger.info(CLASS_NAME, 'clearAllJiraData', `Clearing ${countBefore} Jira issues and related data`);

    // Execute truncation in a transaction for atomicity
    await this.db.transaction(async (client: PoolClient) => {
      this.logger.debug(CLASS_NAME, 'clearAllJiraData', 'Executing TRUNCATE CASCADE on all Jira tables');
      await client.query(SQL_TRUNCATE_ALL_JIRA_TABLES);
      this.logger.debug(CLASS_NAME, 'clearAllJiraData', 'TRUNCATE completed');
    });

    this.logger.info(CLASS_NAME, 'clearAllJiraData', `Cleared ${countBefore} Jira issues. commit_jira preserved.`);

    return { countBefore };
  }
}
