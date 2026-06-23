/**
 * SQL queries for Developer Profile Dashboard.
 * All queries use parameterized placeholders ($1, $2) - zero string interpolation.
 * Ticket: GITX-155, GITX-156, GITX-157, GITX-170
 */

/**
 * Query to fetch sprint velocity vs LOC data for a developer.
 * Correlates story points from Linear/Jira with lines of code committed.
 * Uses FULL OUTER JOIN to capture weeks with only commits or only issues.
 * Filters by full_name with fallback to login for NULL full_name.
 *
 * GITX-179: For Jira, uses jira_detail.assignee (current assignee) matched against
 * commit_contributors.full_name. The jira_history.assignee column was always NULL
 * (not populated during changelog extraction), causing NO DATA to display.
 *
 * GITX-180: For LOC, join commit_history.author (git author name) to
 * commit_contributors.full_name instead of login. The git author name is typically
 * the developer's full name (e.g., "John Doe"), not their GitHub username.
 *
 * Parameters:
 *   $1 - developer full_name (TEXT)
 *   $2 - start date (DATE)
 * Ticket: GITX-157, GITX-169, GITX-179, GITX-180
 */
export const QUERY_DEV_PROFILE_VELOCITY_VS_LOC = `
  WITH dev_commits AS (
    SELECT
      DATE_TRUNC('week', ch.commit_date)::date AS week_start,
      COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS lines_of_code,
      COUNT(DISTINCT ch.sha)::int AS commit_count
    FROM commit_history ch
    LEFT JOIN commit_files cf ON cf.sha = ch.sha
    -- GITX-180: Join on full_name (git author name) with login fallback
    JOIN commit_contributors cc ON (
      ch.author = cc.full_name
      OR (cc.full_name IS NULL AND ch.author = cc.login)
    )
    WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
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
    WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
      AND ld.completed_date >= $2
      AND ld.state IN ('Done', 'Completed')
    GROUP BY week_start
  ),
  dev_jira_points AS (
    -- GITX-179: Use jira_detail.assignee instead of jira_history.assignee
    -- because jira_history.assignee is always NULL (not populated during extraction).
    -- Match against cc.full_name for consistent contributor identity.
    SELECT
      DATE_TRUNC('week', jh.change_date)::date AS week_start,
      COALESCE(SUM(jd.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT jd.jira_key)::int AS issue_count
    FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    JOIN commit_contributors cc ON jd.assignee = cc.full_name
    WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
      AND jh.change_date >= $2
      AND jh.field = 'status'
      AND jh.to_value IN ('Done', 'Closed', 'Resolved')
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
 * Returns true if the developer has any Linear/Jira issues they completed.
 * Filters by full_name with fallback to login for NULL full_name.
 *
 * GITX-179: For Jira, uses jira_detail.assignee instead of jira_history.assignee
 * because jira_history.assignee is always NULL (not populated during extraction).
 * Match against cc.full_name for consistent contributor identity.
 *
 * Parameters:
 *   $1 - developer full_name (TEXT)
 * Ticket: GITX-157, GITX-169, GITX-179
 */
export const QUERY_DEV_PROFILE_HAS_VELOCITY_DATA = `
  SELECT EXISTS (
    SELECT 1 FROM linear_detail ld
    JOIN commit_contributors cc ON (
      ld.assignee = cc.email OR ld.assignee = cc.login OR ld.assignee = cc.full_name
    )
    WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
      AND ld.state IN ('Done', 'Completed')
    UNION
    -- GITX-179: Use jira_detail.assignee (jira_history.assignee is always NULL)
    SELECT 1 FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    JOIN commit_contributors cc ON jd.assignee = cc.full_name
    WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
      AND jh.field = 'status'
      AND jh.to_value IN ('Done', 'Closed', 'Resolved')
  ) AS has_data
`;
