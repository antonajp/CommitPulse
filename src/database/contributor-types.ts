/**
 * TypeScript interfaces for contributor-related database data shapes.
 *
 * Maps column-by-column from the legacy Python PostgresDB.py and
 * GitjaTeamContributor.py classes. Covers commit_contributors and
 * gitja_team_contributor tables.
 *
 * Ticket: IQS-853
 */

// ============================================================================
// commit_contributors table
// ============================================================================

/**
 * Row shape for inserting/updating commit_contributors table.
 * Maps from PostgresDB.py create_contributor_insert_or_update_statements().
 */
export interface CommitContributorRow {
  readonly login: string;
  readonly username: string | null;
  readonly email: string | null;
  readonly bio: string | null;
  readonly userLocation: string | null;
  readonly publicRepos: string | null;
  readonly followers: string | null;
  readonly followingUsers: string | null;
  readonly vendor: string | null;
  readonly repo: string | null;
  readonly team: string | null;
  readonly fullName: string | null;
  readonly jiraName: string | null;
  readonly isCompanyAccount: boolean | null;
}

// ============================================================================
// gitja_team_contributor table
// ============================================================================

/**
 * Row shape for inserting into gitja_team_contributor table.
 * Maps from GitjaTeamContributor.py reset_author_teams().
 */
export interface TeamContributorRow {
  readonly login: string;
  readonly fullName: string;
  readonly team: string;
  readonly numCount: number;
}

// ============================================================================
// Query result types for contributor operations
// ============================================================================

/**
 * Result shape for getCurrentContributors().
 * Maps from PostgresDB.py get_current_contributors().
 * Returns Map<login, repo>.
 */
export interface ContributorLogin {
  readonly login: string;
  readonly repo: string;
}

/**
 * Result shape for getCommitContributorsDf().
 * Maps from PostgresDB.py get_commit_contributors_df().
 */
export interface ContributorDetail {
  readonly login: string;
  readonly vendor: string | null;
  readonly team: string | null;
  readonly fullName: string | null;
}
