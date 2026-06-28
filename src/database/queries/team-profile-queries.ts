/**
 * SQL queries for Team Profile Dashboard.
 * All queries use parameterized placeholders ($1, $2, $3) - zero string interpolation.
 * Ticket: GITX-185
 */

/**
 * Query to fetch sprint velocity vs LOC data for a team.
 * Correlates story points from Linear/Jira with lines of code committed by all team members.
 * Uses FULL OUTER JOIN to capture periods with only commits or only issues.
 * Filters by commit_contributors.team field.
 *
 * For LOC: join commit_history.author to commit_contributors (full_name with login fallback).
 * For Linear: join linear_detail.assignee to commit_contributors (email, login, or full_name).
 * For Jira: join jira_detail.assignee to COALESCE(cc.jira_name, cc.full_name).
 *
 * Parameters:
 *   $1 - team name (TEXT)
 *   $2 - start date (DATE)
 *   $3 - aggregation period ('week' or 'month') (TEXT)
 * Ticket: GITX-185
 */
export const QUERY_TEAM_PROFILE_VELOCITY_VS_LOC = `
  WITH team_members AS (
    SELECT DISTINCT login, full_name, email, jira_name
    FROM commit_contributors
    WHERE team = $1
  ),
  team_commits AS (
    SELECT
      DATE_TRUNC($3, ch.commit_date)::date AS week_start,
      COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS lines_of_code,
      COUNT(DISTINCT ch.sha)::int AS commit_count
    FROM commit_history ch
    LEFT JOIN commit_files cf ON cf.sha = ch.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE ch.commit_date >= $2
      AND ch.is_merge = FALSE
    GROUP BY week_start
  ),
  team_linear_points AS (
    SELECT
      DATE_TRUNC($3, ld.completed_date)::date AS week_start,
      COALESCE(SUM(ld.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT ld.linear_key)::int AS issue_count
    FROM linear_detail ld
    JOIN team_members tm ON (
      ld.assignee = tm.email OR ld.assignee = tm.login OR ld.assignee = tm.full_name
    )
    WHERE ld.completed_date >= $2
      AND ld.state IN ('Done', 'Completed')
    GROUP BY week_start
  ),
  team_jira_points AS (
    SELECT
      DATE_TRUNC($3, jh.change_date)::date AS week_start,
      COALESCE(SUM(jd.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT jd.jira_key)::int AS issue_count
    FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    JOIN team_members tm ON jd.assignee = COALESCE(tm.jira_name, tm.full_name)
    WHERE jh.change_date >= $2
      AND jh.field = 'status'
      AND jh.to_value IN ('Done', 'Closed', 'Resolved')
    GROUP BY week_start
  ),
  combined_points AS (
    SELECT week_start, story_points, issue_count FROM team_linear_points
    UNION ALL
    SELECT week_start, story_points, issue_count FROM team_jira_points
  ),
  aggregated_points AS (
    SELECT
      week_start,
      SUM(story_points)::int AS story_points,
      SUM(issue_count)::int AS issue_count
    FROM combined_points
    GROUP BY week_start
  )
  SELECT
    COALESCE(tc.week_start, ap.week_start) AS week_start,
    COALESCE(ap.story_points, 0) AS story_points,
    COALESCE(tc.lines_of_code, 0) AS lines_of_code,
    COALESCE(ap.issue_count, 0) AS issue_count,
    COALESCE(tc.commit_count, 0) AS commit_count
  FROM team_commits tc
  FULL OUTER JOIN aggregated_points ap ON tc.week_start = ap.week_start
  WHERE COALESCE(tc.week_start, ap.week_start) IS NOT NULL
  ORDER BY week_start ASC
`;

/**
 * Query to check if a team has any velocity data.
 * Returns true if any team member has Linear/Jira issues they completed.
 * Filters by commit_contributors.team field.
 *
 * For Linear: join linear_detail.assignee to commit_contributors (email, login, or full_name).
 * For Jira: join jira_detail.assignee to COALESCE(cc.jira_name, cc.full_name).
 *
 * Parameters:
 *   $1 - team name (TEXT)
 * Ticket: GITX-185
 */
export const QUERY_TEAM_PROFILE_HAS_VELOCITY_DATA = `
  SELECT EXISTS (
    SELECT 1 FROM linear_detail ld
    JOIN commit_contributors cc ON (
      ld.assignee = cc.email OR ld.assignee = cc.login OR ld.assignee = cc.full_name
    )
    WHERE cc.team = $1
      AND ld.state IN ('Done', 'Completed')
    UNION
    SELECT 1 FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    JOIN commit_contributors cc ON jd.assignee = COALESCE(cc.jira_name, cc.full_name)
    WHERE cc.team = $1
      AND jh.field = 'status'
      AND jh.to_value IN ('Done', 'Closed', 'Resolved')
  ) AS has_data
`;

// ============================================================================
// GITX-188: Hot Spots Queries for Team Profile
// ============================================================================

/**
 * Query to check if the vw_hot_spots view exists.
 * Used for graceful degradation if migration 013 has not been applied.
 * GITX-188: Team Profile uses this to check view availability.
 */
export const QUERY_TEAM_HOT_SPOTS_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_hot_spots'
  ) AS view_exists
`;

/**
 * Query to fetch top 10 hot spots filtered by team members.
 * Returns files ordered by risk_score DESC (highest risk first).
 * GITX-188: Uses vw_hot_spots view and filters to files modified by team members.
 *
 * Parameters:
 *   $1 - team name (TEXT)
 */
export const QUERY_TEAM_PROFILE_HOT_SPOTS = `
  WITH team_members AS (
    SELECT DISTINCT login, full_name
    FROM commit_contributors
    WHERE team = $1
  ),
  team_files AS (
    SELECT DISTINCT cf.filename AS file_path, ch.repository
    FROM commit_files cf
    JOIN commit_history ch ON ch.sha = cf.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE ch.is_merge = FALSE
  )
  SELECT
    hs.file_path,
    hs.repository,
    hs.churn_count,
    hs.complexity,
    hs.loc,
    hs.risk_score,
    hs.risk_tier
  FROM vw_hot_spots hs
  JOIN team_files tf ON hs.file_path = tf.file_path AND hs.repository = tf.repository
  ORDER BY hs.risk_score DESC NULLS LAST
  LIMIT 10
`;

// ============================================================================
// GITX-188: Knowledge Concentration Queries for Team Profile
// ============================================================================

/**
 * Query to check if the vw_knowledge_concentration view exists.
 * Used for graceful degradation if migration 014 has not been applied.
 * GITX-188: Team Profile uses this to check view availability.
 */
export const QUERY_TEAM_KNOWLEDGE_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_knowledge_concentration'
  ) AS view_exists
`;

/**
 * Query to fetch top 30 knowledge concentration files filtered by team members.
 * Returns files ordered by top_contributor_pct DESC (highest concentration first).
 * GITX-188: Uses vw_knowledge_concentration view and filters to files with team member contributions.
 *
 * Parameters:
 *   $1 - team name (TEXT)
 */
export const QUERY_TEAM_PROFILE_KNOWLEDGE_CONCENTRATION = `
  WITH team_members AS (
    SELECT DISTINCT login, full_name
    FROM commit_contributors
    WHERE team = $1
  ),
  team_files AS (
    SELECT DISTINCT cf.filename AS file_path, ch.repository
    FROM commit_files cf
    JOIN commit_history ch ON ch.sha = cf.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE ch.is_merge = FALSE
  )
  SELECT
    kc.file_path,
    kc.repository,
    kc.total_commits,
    kc.total_contributors,
    kc.top_contributor,
    kc.top_contributor_pct,
    kc.concentration_risk
  FROM vw_knowledge_concentration kc
  JOIN team_files tf ON kc.file_path = tf.file_path AND kc.repository = tf.repository
  ORDER BY kc.top_contributor_pct DESC NULLS LAST
  LIMIT 30
`;
