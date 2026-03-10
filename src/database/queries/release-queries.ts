/**
 * Parameterized SQL queries for Release Management Contributions chart.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against views created by migration 011_release_management_views.sql:
 *   - vw_release_environment_mapping - Maps branches to environments
 *   - vw_release_tags - Identifies release tags
 *   - vw_merge_commits_by_environment - Merge commits by environment
 *   - vw_release_contributions - Aggregated release activity
 *   - vw_release_contributions_summary - Time-boxed summary
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 * Privacy: Only team names and display names returned, not emails.
 *
 * Ticket: IQS-898
 */

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Applied as LIMIT in each query.
 */
export const RELEASE_MAX_RESULT_ROWS = 500;

/**
 * Default time range for release contributions (30 days).
 */
export const RELEASE_DEFAULT_DAYS = 30;

/**
 * Query to fetch release contributions aggregated by team member and environment.
 * Returns merge counts and tag counts per environment (Production, Staging, Dev).
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE) - beginning of date range
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE) - end of date range
 */
export const QUERY_RELEASE_CONTRIBUTIONS_BY_ENVIRONMENT = `
  WITH time_filtered_merges AS (
    SELECT
      author,
      full_name,
      team,
      environment,
      repository,
      COUNT(*)::INT AS merge_count
    FROM vw_merge_commits_by_environment
    WHERE commit_date >= $1 AND commit_date <= $2
    GROUP BY author, full_name, team, environment, repository
  ),
  time_filtered_tags AS (
    SELECT
      author,
      full_name,
      team,
      repository,
      COUNT(*)::INT AS tag_count
    FROM vw_release_tags
    WHERE tag_type IN ('Semantic Version', 'Date Release', 'Named Release')
      AND commit_date >= $1 AND commit_date <= $2
    GROUP BY author, full_name, team, repository
  )
  SELECT
    COALESCE(m.author, t.author) AS author,
    COALESCE(m.full_name, t.full_name) AS full_name,
    COALESCE(m.team, t.team) AS team,
    COALESCE(m.repository, t.repository) AS repository,
    m.environment,
    COALESCE(m.merge_count, 0) AS merge_count,
    COALESCE(t.tag_count, 0) AS tag_count
  FROM time_filtered_merges m
    FULL OUTER JOIN time_filtered_tags t
      ON m.author = t.author
      AND m.repository = t.repository
  ORDER BY COALESCE(m.merge_count, 0) DESC, COALESCE(t.tag_count, 0) DESC
  LIMIT ${RELEASE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch release contributions with team filter.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE) - beginning of date range
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE) - end of date range
 *   $3 - team (TEXT) - team name to filter by
 */
export const QUERY_RELEASE_CONTRIBUTIONS_BY_TEAM = `
  WITH time_filtered_merges AS (
    SELECT
      author,
      full_name,
      team,
      environment,
      repository,
      COUNT(*)::INT AS merge_count
    FROM vw_merge_commits_by_environment
    WHERE commit_date >= $1 AND commit_date <= $2
      AND team = $3
    GROUP BY author, full_name, team, environment, repository
  ),
  time_filtered_tags AS (
    SELECT
      author,
      full_name,
      team,
      repository,
      COUNT(*)::INT AS tag_count
    FROM vw_release_tags
    WHERE tag_type IN ('Semantic Version', 'Date Release', 'Named Release')
      AND commit_date >= $1 AND commit_date <= $2
      AND team = $3
    GROUP BY author, full_name, team, repository
  )
  SELECT
    COALESCE(m.author, t.author) AS author,
    COALESCE(m.full_name, t.full_name) AS full_name,
    COALESCE(m.team, t.team) AS team,
    COALESCE(m.repository, t.repository) AS repository,
    m.environment,
    COALESCE(m.merge_count, 0) AS merge_count,
    COALESCE(t.tag_count, 0) AS tag_count
  FROM time_filtered_merges m
    FULL OUTER JOIN time_filtered_tags t
      ON m.author = t.author
      AND m.repository = t.repository
  ORDER BY COALESCE(m.merge_count, 0) DESC, COALESCE(t.tag_count, 0) DESC
  LIMIT ${RELEASE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch release contributions with repository filter.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE) - beginning of date range
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE) - end of date range
 *   $3 - repository (TEXT) - repository name to filter by
 */
export const QUERY_RELEASE_CONTRIBUTIONS_BY_REPOSITORY = `
  WITH time_filtered_merges AS (
    SELECT
      author,
      full_name,
      team,
      environment,
      repository,
      COUNT(*)::INT AS merge_count
    FROM vw_merge_commits_by_environment
    WHERE commit_date >= $1 AND commit_date <= $2
      AND repository = $3
    GROUP BY author, full_name, team, environment, repository
  ),
  time_filtered_tags AS (
    SELECT
      author,
      full_name,
      team,
      repository,
      COUNT(*)::INT AS tag_count
    FROM vw_release_tags
    WHERE tag_type IN ('Semantic Version', 'Date Release', 'Named Release')
      AND commit_date >= $1 AND commit_date <= $2
      AND repository = $3
    GROUP BY author, full_name, team, repository
  )
  SELECT
    COALESCE(m.author, t.author) AS author,
    COALESCE(m.full_name, t.full_name) AS full_name,
    COALESCE(m.team, t.team) AS team,
    COALESCE(m.repository, t.repository) AS repository,
    m.environment,
    COALESCE(m.merge_count, 0) AS merge_count,
    COALESCE(t.tag_count, 0) AS tag_count
  FROM time_filtered_merges m
    FULL OUTER JOIN time_filtered_tags t
      ON m.author = t.author
      AND m.repository = t.repository
  ORDER BY COALESCE(m.merge_count, 0) DESC, COALESCE(t.tag_count, 0) DESC
  LIMIT ${RELEASE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch merge commits by environment for a specific author.
 * Useful for drill-down: "Show me all John's production merges in the last 30 days."
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE) - beginning of date range
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE) - end of date range
 *   $3 - author (TEXT) - author login to filter by
 */
export const QUERY_MERGE_COMMITS_BY_AUTHOR = `
  SELECT
    sha,
    author,
    full_name,
    team,
    commit_date,
    branch,
    repository,
    environment,
    commit_message
  FROM vw_merge_commits_by_environment
  WHERE commit_date >= $1 AND commit_date <= $2
    AND author = $3
  ORDER BY commit_date DESC
  LIMIT ${RELEASE_MAX_RESULT_ROWS}
`;

/**
 * Query to fetch release tags created by a specific author.
 * Useful for drill-down: "Show me all release tags John created in the last 30 days."
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE) - beginning of date range
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE) - end of date range
 *   $3 - author (TEXT) - author login to filter by
 */
export const QUERY_RELEASE_TAGS_BY_AUTHOR = `
  SELECT
    sha,
    tag,
    author,
    full_name,
    team,
    commit_date,
    branch,
    repository,
    tag_type
  FROM vw_release_tags
  WHERE tag_type IN ('Semantic Version', 'Date Release', 'Named Release')
    AND commit_date >= $1 AND commit_date <= $2
    AND author = $3
  ORDER BY commit_date DESC
  LIMIT ${RELEASE_MAX_RESULT_ROWS}
`;

/**
 * Query to get environment distribution for the chart legend.
 * Returns count of merge commits by environment for the selected time range.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP WITH TIME ZONE) - beginning of date range
 *   $2 - end_date (TIMESTAMP WITH TIME ZONE) - end of date range
 */
export const QUERY_ENVIRONMENT_DISTRIBUTION = `
  SELECT
    environment,
    COUNT(*)::INT AS merge_count,
    COUNT(DISTINCT author)::INT AS contributor_count,
    COUNT(DISTINCT repository)::INT AS repository_count
  FROM vw_merge_commits_by_environment
  WHERE commit_date >= $1 AND commit_date <= $2
  GROUP BY environment
  ORDER BY merge_count DESC
`;

/**
 * Query to check if the release management views exist.
 * Used for graceful degradation if migration 011 has not been applied.
 */
export const QUERY_RELEASE_VIEWS_EXIST = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_release_contributions'
  ) AS view_exists
`;

/**
 * Query to get branch to environment mapping.
 * Useful for debugging and configuration validation.
 * Returns all distinct branches and their mapped environments.
 */
export const QUERY_BRANCH_ENVIRONMENT_MAPPING = `
  SELECT
    branch,
    environment,
    COUNT(DISTINCT sha)::INT AS commit_count
  FROM vw_release_environment_mapping rem
    INNER JOIN commit_branch_relationship cbr ON rem.branch = cbr.branch
  GROUP BY rem.branch, rem.environment
  ORDER BY commit_count DESC
  LIMIT ${RELEASE_MAX_RESULT_ROWS}
`;

/**
 * TypeScript interface for release contribution row.
 * Maps to the result of QUERY_RELEASE_CONTRIBUTIONS_BY_ENVIRONMENT.
 */
export interface ReleaseContribution {
  readonly author: string;
  readonly full_name: string | null;
  readonly team: string | null;
  readonly repository: string | null;
  readonly environment: string | null;
  readonly merge_count: number;
  readonly tag_count: number;
}

/**
 * TypeScript interface for merge commit detail row.
 * Maps to the result of QUERY_MERGE_COMMITS_BY_AUTHOR.
 */
export interface MergeCommitDetail {
  readonly sha: string;
  readonly author: string;
  readonly full_name: string | null;
  readonly team: string | null;
  readonly commit_date: Date;
  readonly branch: string | null;
  readonly repository: string | null;
  readonly environment: string | null;
  readonly commit_message: string | null;
}

/**
 * TypeScript interface for release tag detail row.
 * Maps to the result of QUERY_RELEASE_TAGS_BY_AUTHOR.
 */
export interface ReleaseTagDetail {
  readonly sha: string;
  readonly tag: string;
  readonly author: string;
  readonly full_name: string | null;
  readonly team: string | null;
  readonly commit_date: Date;
  readonly branch: string | null;
  readonly repository: string | null;
  readonly tag_type: string;
}

/**
 * TypeScript interface for environment distribution row.
 * Maps to the result of QUERY_ENVIRONMENT_DISTRIBUTION.
 */
export interface EnvironmentDistribution {
  readonly environment: string;
  readonly merge_count: number;
  readonly contributor_count: number;
  readonly repository_count: number;
}

/**
 * TypeScript interface for branch environment mapping row.
 * Maps to the result of QUERY_BRANCH_ENVIRONMENT_MAPPING.
 */
export interface BranchEnvironmentMapping {
  readonly branch: string;
  readonly environment: string;
  readonly commit_count: number;
}
