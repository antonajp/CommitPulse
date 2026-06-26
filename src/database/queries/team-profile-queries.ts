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
