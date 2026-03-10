import type { PoolClient } from 'pg';
import { DatabaseService, type DatabaseQueryResult } from './database-service.js';
import { LoggerService } from '../logging/logger.js';
import type {
  CommitContributorRow,
  TeamContributorRow,
  ContributorLogin,
  ContributorDetail,
} from './contributor-types.js';
import type { ContributorSummaryRow } from '../providers/contributor-tree-types.js';

// Re-export types so consumers can import from contributor-repository directly
export type {
  CommitContributorRow,
  TeamContributorRow,
  ContributorLogin,
  ContributorDetail,
} from './contributor-types.js';
export type { ContributorSummaryRow } from '../providers/contributor-tree-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ContributorRepository';

// ============================================================================
// SQL Constants - all parameterized, zero string interpolation
// ============================================================================

const SQL_GET_CURRENT_CONTRIBUTORS = `
  SELECT DISTINCT login, repo
  FROM commit_contributors
  ORDER BY login
`;

const SQL_GET_COMMIT_CONTRIBUTORS_DF = `
  SELECT login, vendor, team, full_name
  FROM commit_contributors
`;

const SQL_INSERT_COMMIT_CONTRIBUTOR = `
  INSERT INTO commit_contributors
    (login, username, email, bio, user_location, public_repos,
     followers, following_users, vendor, repo, team, full_name,
     jira_name, is_company_account)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  ON CONFLICT (login) DO NOTHING
`;

const SQL_UPDATE_COMMIT_CONTRIBUTOR = `
  UPDATE commit_contributors SET
    vendor = COALESCE($2, vendor),
    team = COALESCE($3, team),
    full_name = COALESCE($4, full_name),
    jira_name = COALESCE($5, jira_name),
    is_company_account = COALESCE($6, is_company_account)
  WHERE login = $1
`;

const SQL_UPDATE_CONTRIBUTOR_TEAM = `
  UPDATE commit_contributors SET team = $1
  WHERE full_name = $2 AND login = $3
`;

const SQL_INSERT_TEAM_CONTRIBUTOR = `
  INSERT INTO gitja_team_contributor (login, full_name, team, num_count)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (login, team, full_name) DO UPDATE SET
    num_count = EXCLUDED.num_count
`;

const SQL_DELETE_ALL_AUTHOR_TEAMS = `
  DELETE FROM gitja_team_contributor
`;

const SQL_DELETE_AUTHOR_TEAMS = `
  DELETE FROM gitja_team_contributor WHERE login = $1
`;

const SQL_GET_UNIQUE_CONTRIBUTOR_TEAMS = `
  SELECT DISTINCT team FROM commit_contributors
`;

const SQL_GET_UNIQUE_JIRA_PROJECTS = `
  SELECT DISTINCT project FROM jira_detail
`;

const SQL_GET_PRIMARY_TEAM_ASSIGNMENT = `
  SELECT team FROM max_num_count_per_full_name WHERE full_name = $1
`;

const SQL_UPDATE_CONTRIBUTOR_REPO = `
  UPDATE commit_contributors SET repo = $2
  WHERE login = $1
`;

/**
 * Query to get contributor summaries for the Contributors/Teams TreeView.
 * Joins commit_contributors with commit_history (for commit counts) and
 * max_num_count_per_login (for primary team assignment).
 *
 * Returns one row per contributor with login, full_name, vendor,
 * primary team, repo list, and commit count.
 *
 * Ticket: IQS-867
 */
const SQL_GET_CONTRIBUTOR_SUMMARIES = `
  SELECT
    cc.login,
    cc.full_name,
    cc.vendor,
    COALESCE(m.team, cc.team) AS team,
    cc.repo AS repo_list,
    COALESCE(ch_counts.commit_count, 0)::int AS commit_count
  FROM commit_contributors cc
  LEFT JOIN max_num_count_per_login m ON m.login = cc.login
  LEFT JOIN (
    SELECT author, COUNT(DISTINCT sha) AS commit_count
    FROM commit_history
    GROUP BY author
  ) ch_counts ON ch_counts.author = cc.login
  ORDER BY COALESCE(m.team, cc.team) NULLS LAST, cc.login
`;

// ============================================================================
// ContributorRepository implementation
// ============================================================================

/**
 * Repository class for contributor-related database tables.
 *
 * Provides methods for querying and managing commit_contributors and
 * gitja_team_contributor tables. Includes team assignment logic that
 * maps from Python's GitjaTeamContributor.py.
 *
 * Maps from Python PostgresDB.py methods with CRITICAL difference:
 * Python used f-string SQL (SQL injection risk). This TypeScript version
 * uses ONLY parameterized queries with $1, $2 placeholders.
 *
 * Ticket: IQS-853
 */
export class ContributorRepository {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'ContributorRepository created');
  }

  // --------------------------------------------------------------------------
  // commit_contributors: Query methods
  // --------------------------------------------------------------------------

  /**
   * Get current contributors as a login-to-repo map.
   * Maps from Python PostgresDB.py get_current_contributors().
   */
  async getCurrentContributors(): Promise<Map<string, string>> {
    this.logger.debug(CLASS_NAME, 'getCurrentContributors', 'Querying current contributors');

    const result: DatabaseQueryResult<ContributorLogin> =
      await this.db.query(SQL_GET_CURRENT_CONTRIBUTORS);

    const contributors = new Map<string, string>();
    for (const row of result.rows) {
      contributors.set(row.login, row.repo);
    }

    this.logger.debug(CLASS_NAME, 'getCurrentContributors', `Found ${contributors.size} contributors`);
    return contributors;
  }

  /**
   * Get all contributors with detail fields.
   * Maps from Python PostgresDB.py get_commit_contributors_df().
   * Returns array instead of DataFrame.
   */
  async getCommitContributors(): Promise<ContributorDetail[]> {
    this.logger.debug(CLASS_NAME, 'getCommitContributors', 'Querying contributor details');

    const result: DatabaseQueryResult<{
      login: string; vendor: string | null;
      team: string | null; full_name: string | null;
    }> = await this.db.query(SQL_GET_COMMIT_CONTRIBUTORS_DF);

    const contributors: ContributorDetail[] = result.rows.map((row) => ({
      login: row.login,
      vendor: row.vendor,
      team: row.team,
      fullName: row.full_name,
    }));

    this.logger.debug(CLASS_NAME, 'getCommitContributors', `Found ${contributors.length} contributors`);
    return contributors;
  }

  // --------------------------------------------------------------------------
  // commit_contributors: Insert / Update methods
  // --------------------------------------------------------------------------

  /**
   * Insert a new commit contributor.
   * Uses ON CONFLICT DO NOTHING for idempotency.
   *
   * @param contributor - The contributor data to insert
   */
  async insertCommitContributor(contributor: CommitContributorRow): Promise<void> {
    this.logger.debug(CLASS_NAME, 'insertCommitContributor', `Inserting contributor: ${contributor.login}`);

    await this.db.query(SQL_INSERT_COMMIT_CONTRIBUTOR, [
      contributor.login, contributor.username, contributor.email,
      contributor.bio, contributor.userLocation, contributor.publicRepos,
      contributor.followers, contributor.followingUsers,
      contributor.vendor, contributor.repo, contributor.team,
      contributor.fullName, contributor.jiraName, contributor.isCompanyAccount,
    ]);

    this.logger.trace(CLASS_NAME, 'insertCommitContributor', `Inserted: ${contributor.login}`);
  }

  /**
   * Update an existing commit contributor's mutable fields.
   * Uses COALESCE to preserve existing values when null is passed.
   *
   * @param login - The contributor login to update
   * @param vendor - New vendor value (null to keep existing)
   * @param team - New team value (null to keep existing)
   * @param fullName - New full name (null to keep existing)
   * @param jiraName - New Jira name (null to keep existing)
   * @param isCompanyAccount - New company account flag (null to keep existing)
   */
  async updateCommitContributor(
    login: string,
    vendor: string | null,
    team: string | null,
    fullName: string | null,
    jiraName: string | null,
    isCompanyAccount: boolean | null,
  ): Promise<void> {
    this.logger.debug(CLASS_NAME, 'updateCommitContributor', `Updating contributor: ${login}`);

    await this.db.query(SQL_UPDATE_COMMIT_CONTRIBUTOR, [
      login, vendor, team, fullName, jiraName, isCompanyAccount,
    ]);

    this.logger.trace(CLASS_NAME, 'updateCommitContributor', `Updated: ${login}`);
  }

  /**
   * Update a contributor's primary team assignment.
   * Maps from Python GitjaTeamContributor.py update_contributor_primary_team().
   *
   * @param login - The contributor login
   * @param fullName - The contributor full name
   * @param team - The primary team to set
   */
  async updateContributorTeam(login: string, fullName: string, team: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'updateContributorTeam', `Setting team=${team} for ${login} (${fullName})`);

    await this.db.query(SQL_UPDATE_CONTRIBUTOR_TEAM, [team, fullName, login]);

    this.logger.trace(CLASS_NAME, 'updateContributorTeam', `Team updated for: ${login}`);
  }

  /**
   * Update a contributor's repo field.
   * Used by GitHubService to append additional repos to a contributor's record.
   * Maps from Python GitHubRelate.py repo update in get_contributors_details().
   *
   * @param login - The contributor login
   * @param repo - The updated repo string (comma-separated list of repos)
   *
   * Ticket: IQS-859
   */
  async updateContributorRepo(login: string, repo: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'updateContributorRepo', `Updating repo for ${login}: ${repo}`);

    await this.db.query(SQL_UPDATE_CONTRIBUTOR_REPO, [login, repo]);

    this.logger.trace(CLASS_NAME, 'updateContributorRepo', `Repo updated for: ${login}`);
  }

  // --------------------------------------------------------------------------
  // gitja_team_contributor: CRUD methods
  // --------------------------------------------------------------------------

  /**
   * Insert or update a team contributor record.
   * Uses ON CONFLICT to update num_count.
   *
   * @param row - The team contributor data to upsert
   */
  async upsertTeamContributor(row: TeamContributorRow): Promise<void> {
    this.logger.debug(CLASS_NAME, 'upsertTeamContributor', `Upserting: ${row.login} -> ${row.team} (${row.numCount})`);

    await this.db.query(SQL_INSERT_TEAM_CONTRIBUTOR, [
      row.login, row.fullName, row.team, row.numCount,
    ]);

    this.logger.trace(CLASS_NAME, 'upsertTeamContributor', `Upserted: ${row.login} -> ${row.team}`);
  }

  /**
   * Batch insert/update team contributor records within a transaction.
   *
   * @param rows - Array of team contributor rows to upsert
   */
  async batchUpsertTeamContributors(rows: readonly TeamContributorRow[]): Promise<void> {
    if (rows.length === 0) {
      this.logger.debug(CLASS_NAME, 'batchUpsertTeamContributors', 'No team contributors to upsert');
      return;
    }

    this.logger.debug(CLASS_NAME, 'batchUpsertTeamContributors', `Upserting ${rows.length} team contributors`);

    await this.db.transaction(async (client: PoolClient) => {
      for (const row of rows) {
        await client.query(SQL_INSERT_TEAM_CONTRIBUTOR, [
          row.login, row.fullName, row.team, row.numCount,
        ]);
      }
    });

    this.logger.trace(CLASS_NAME, 'batchUpsertTeamContributors', `${rows.length} team contributors upserted`);
  }

  /**
   * Delete all team contributor records.
   * Maps from Python PostgresDB.py delete_all_author_teams().
   */
  async deleteAllAuthorTeams(): Promise<number> {
    this.logger.debug(CLASS_NAME, 'deleteAllAuthorTeams', 'Deleting all author team records');

    const result = await this.db.query(SQL_DELETE_ALL_AUTHOR_TEAMS);

    this.logger.debug(CLASS_NAME, 'deleteAllAuthorTeams', `Deleted ${result.rowCount} records`);
    return result.rowCount;
  }

  /**
   * Delete team contributor records for a specific author.
   * Maps from Python PostgresDB.py delete_author_teams().
   *
   * @param login - The contributor login to delete team records for
   */
  async deleteAuthorTeams(login: string): Promise<number> {
    this.logger.debug(CLASS_NAME, 'deleteAuthorTeams', `Deleting team records for: ${login}`);

    const result = await this.db.query(SQL_DELETE_AUTHOR_TEAMS, [login]);

    this.logger.debug(CLASS_NAME, 'deleteAuthorTeams', `Deleted ${result.rowCount} records for: ${login}`);
    return result.rowCount;
  }

  // --------------------------------------------------------------------------
  // Team query methods
  // --------------------------------------------------------------------------

  /**
   * Get unique list of contributor teams from both commit_contributors
   * and jira_detail tables.
   * Maps from Python PostgresDB.py get_unique_list_of_contributor_teams().
   */
  async getUniqueListOfContributorTeams(): Promise<string[]> {
    this.logger.debug(CLASS_NAME, 'getUniqueListOfContributorTeams', 'Querying unique teams');

    // Query teams from commit_contributors
    const teamResult: DatabaseQueryResult<{ team: string | null }> =
      await this.db.query(SQL_GET_UNIQUE_CONTRIBUTOR_TEAMS);

    const teams = new Set<string>();
    for (const row of teamResult.rows) {
      if (row.team !== null) {
        teams.add(row.team);
      }
    }

    // Also query distinct projects from jira_detail (matching Python behavior)
    const projectResult: DatabaseQueryResult<{ project: string }> =
      await this.db.query(SQL_GET_UNIQUE_JIRA_PROJECTS);

    for (const row of projectResult.rows) {
      teams.add(row.project);
    }

    const teamList = Array.from(teams);
    this.logger.debug(CLASS_NAME, 'getUniqueListOfContributorTeams', `Found ${teamList.length} unique teams`);
    return teamList;
  }

  /**
   * Get the primary team assignment for a contributor by full name.
   * Maps from Python PostgresDB.py get_primary_team_assignment().
   * Queries the max_num_count_per_full_name view.
   *
   * @param fullName - The contributor full name to look up
   * @returns The primary team name, or null if not found
   */
  async getPrimaryTeamAssignment(fullName: string): Promise<string | null> {
    this.logger.debug(CLASS_NAME, 'getPrimaryTeamAssignment', `Querying for: ${fullName}`);

    const result: DatabaseQueryResult<{ team: string }> =
      await this.db.query(SQL_GET_PRIMARY_TEAM_ASSIGNMENT, [fullName]);

    if (result.rows.length === 1) {
      const team = result.rows[0]!.team;
      this.logger.debug(CLASS_NAME, 'getPrimaryTeamAssignment', `Primary team for ${fullName}: ${team}`);
      return team;
    }

    this.logger.debug(CLASS_NAME, 'getPrimaryTeamAssignment', `No unique primary team for: ${fullName} (${result.rows.length} results)`);
    return null;
  }

  // --------------------------------------------------------------------------
  // TreeView query methods (IQS-867)
  // --------------------------------------------------------------------------

  /**
   * Get contributor summaries for the Contributors/Teams TreeView.
   * Returns all contributors with their primary team, commit count, vendor,
   * and repo list. Ordered by team then login for grouped display.
   *
   * Joins commit_contributors + max_num_count_per_login (primary team) +
   * commit_history (commit count aggregation).
   *
   * Ticket: IQS-867
   *
   * @returns Array of ContributorSummaryRow, ordered by team then login
   */
  async getContributorSummaries(): Promise<ContributorSummaryRow[]> {
    this.logger.debug(CLASS_NAME, 'getContributorSummaries', 'Querying contributor summaries for TreeView');

    const result: DatabaseQueryResult<{
      login: string;
      full_name: string | null;
      vendor: string | null;
      team: string | null;
      repo_list: string | null;
      commit_count: number;
    }> = await this.db.query(SQL_GET_CONTRIBUTOR_SUMMARIES);

    const summaries: ContributorSummaryRow[] = result.rows.map((row) => ({
      login: row.login,
      fullName: row.full_name,
      vendor: row.vendor,
      team: row.team,
      repoList: row.repo_list,
      commitCount: row.commit_count,
    }));

    this.logger.debug(
      CLASS_NAME,
      'getContributorSummaries',
      `Loaded ${summaries.length} contributor summaries`,
    );
    return summaries;
  }
}
