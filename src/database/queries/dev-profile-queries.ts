/**
 * SQL queries for Developer Profile Dashboard.
 * All queries use parameterized placeholders ($1, $2) - zero string interpolation.
 * Ticket: GITX-155, GITX-156, GITX-157
 */

/**
 * Query to fetch sprint velocity vs LOC data for a developer.
 * Correlates story points from Linear/Jira with lines of code committed.
 * Uses FULL OUTER JOIN to capture weeks with only commits or only issues.
 * Parameters:
 *   $1 - developer login (TEXT)
 *   $2 - start date (DATE)
 * Ticket: GITX-157
 */
export const QUERY_DEV_PROFILE_VELOCITY_VS_LOC = `
  WITH dev_commits AS (
    SELECT
      DATE_TRUNC('week', ch.commit_date)::date AS week_start,
      COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS lines_of_code,
      COUNT(DISTINCT ch.sha)::int AS commit_count
    FROM commit_history ch
    LEFT JOIN commit_files cf ON cf.sha = ch.sha
    WHERE ch.author = $1
      AND ch.commit_date >= $2
      AND ch.is_merge = FALSE
    GROUP BY week_start
  ),
  dev_linear_points AS (
    SELECT
      DATE_TRUNC('week', ld.completed_date)::date AS week_start,
      COALESCE(SUM(ld.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT ld.linear_key)::int AS issue_count
    FROM linear_detail ld
    JOIN commit_contributors cc ON (
      ld.assignee = cc.email OR ld.assignee = cc.login OR ld.assignee = cc.full_name
    )
    WHERE cc.login = $1
      AND ld.completed_date >= $2
      AND ld.state IN ('Done', 'Completed')
    GROUP BY week_start
  ),
  dev_jira_points AS (
    SELECT
      DATE_TRUNC('week', jd.status_change_date)::date AS week_start,
      COALESCE(SUM(jd.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT jd.jira_key)::int AS issue_count
    FROM jira_detail jd
    JOIN commit_contributors cc ON (
      jd.assignee = cc.email OR jd.assignee = cc.login OR jd.assignee = cc.full_name
    )
    WHERE cc.login = $1
      AND jd.status_change_date >= $2
      AND jd.status IN ('Done', 'Closed', 'Resolved')
    GROUP BY week_start
  ),
  combined_points AS (
    SELECT week_start, story_points, issue_count FROM dev_linear_points
    UNION ALL
    SELECT week_start, story_points, issue_count FROM dev_jira_points
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
    COALESCE(dc.week_start, ap.week_start) AS week_start,
    COALESCE(ap.story_points, 0) AS story_points,
    COALESCE(dc.lines_of_code, 0) AS lines_of_code,
    COALESCE(ap.issue_count, 0) AS issue_count,
    COALESCE(dc.commit_count, 0) AS commit_count
  FROM dev_commits dc
  FULL OUTER JOIN aggregated_points ap ON dc.week_start = ap.week_start
  WHERE COALESCE(dc.week_start, ap.week_start) IS NOT NULL
  ORDER BY week_start ASC
`;

/**
 * Query to check if a developer has any velocity data.
 * Returns true if the developer has any Linear/Jira issues assigned.
 * Parameters:
 *   $1 - developer login (TEXT)
 * Ticket: GITX-157
 */
export const QUERY_DEV_PROFILE_HAS_VELOCITY_DATA = `
  SELECT EXISTS (
    SELECT 1 FROM linear_detail ld
    JOIN commit_contributors cc ON (
      ld.assignee = cc.email OR ld.assignee = cc.login OR ld.assignee = cc.full_name
    )
    WHERE cc.login = $1 AND ld.state IN ('Done', 'Completed')
    UNION
    SELECT 1 FROM jira_detail jd
    JOIN commit_contributors cc ON (
      jd.assignee = cc.email OR jd.assignee = cc.login OR jd.assignee = cc.full_name
    )
    WHERE cc.login = $1 AND jd.status IN ('Done', 'Closed', 'Resolved')
  ) AS has_data
`;
