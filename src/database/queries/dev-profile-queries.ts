/**
 * SQL queries for Developer Profile Dashboard.
 * All queries use parameterized placeholders ($1, $2, $3) - zero string interpolation.
 * Ticket: GITX-155, GITX-156, GITX-157, GITX-170, GITX-179, GITX-180, GITX-183
 */

/**
 * Query to fetch sprint velocity vs LOC data for a developer.
 * Correlates story points from Linear/Jira with lines of code committed.
 * Uses FULL OUTER JOIN to capture periods with only commits or only issues.
 * Filters by full_name with fallback to login for NULL full_name.
 *
 * GITX-179: For Jira, uses jira_detail.assignee (current assignee) matched against
 * commit_contributors.full_name. The jira_history.assignee column was always NULL
 * (not populated during changelog extraction), causing NO DATA to display.
 *
 * GITX-179: Added $3 parameter for dynamic aggregation period ('week' or 'month').
 *
 * GITX-180: For LOC, join commit_history.author (git author name) to
 * commit_contributors.full_name instead of login. The git author name is typically
 * the developer's full name (e.g., "John Doe"), not their GitHub username.
 *
 * GITX-183: For Jira, join on COALESCE(cc.jira_name, cc.full_name) instead of just
 * cc.full_name. The jira_name column is the canonical alignment field for matching
 * commit contributors to Jira assignees. Falls back to full_name for backwards
 * compatibility when jira_name is NULL.
 *
 * Parameters:
 *   $1 - developer full_name (TEXT)
 *   $2 - start date (DATE)
 *   $3 - aggregation period ('week' or 'month') (TEXT)
 * Ticket: GITX-157, GITX-169, GITX-179, GITX-180, GITX-183
 */
export const QUERY_DEV_PROFILE_VELOCITY_VS_LOC = `
  WITH dev_commits AS (
    SELECT
      DATE_TRUNC($3, ch.commit_date)::date AS week_start,
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
      DATE_TRUNC($3, ld.completed_date)::date AS week_start,
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
    -- GITX-183: Join on COALESCE(cc.jira_name, cc.full_name) for proper name alignment.
    -- The jira_name column is the canonical field for matching contributors to Jira.
    SELECT
      DATE_TRUNC($3, jh.change_date)::date AS week_start,
      COALESCE(SUM(jd.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT jd.jira_key)::int AS issue_count
    FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    JOIN commit_contributors cc ON jd.assignee = COALESCE(cc.jira_name, cc.full_name)
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
 * Query to fetch sprint velocity vs LOC data for a developer WITH team totals.
 * GITX-199: Adds team_story_points column showing total team story points per period
 * for stacked bar visualization where developer's contribution is highlighted against team total.
 *
 * Parameters:
 *   $1 - developer full_name (TEXT)
 *   $2 - start date (DATE)
 *   $3 - aggregation period ('week' or 'month') (TEXT)
 * Ticket: GITX-199
 */
export const QUERY_DEV_PROFILE_VELOCITY_VS_LOC_WITH_TEAM = `
  WITH dev_commits AS (
    SELECT
      DATE_TRUNC($3, ch.commit_date)::date AS week_start,
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
      DATE_TRUNC($3, ld.completed_date)::date AS week_start,
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
    SELECT
      DATE_TRUNC($3, jh.change_date)::date AS week_start,
      COALESCE(SUM(jd.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT jd.jira_key)::int AS issue_count
    FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    JOIN commit_contributors cc ON jd.assignee = COALESCE(cc.jira_name, cc.full_name)
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
  ),
  -- GITX-199: Team totals (all developers) for the same time periods
  team_linear_points AS (
    SELECT
      DATE_TRUNC($3, ld.completed_date)::date AS week_start,
      COALESCE(SUM(ld.calculated_story_points), 0)::int AS team_story_points
    FROM linear_detail ld
    WHERE ld.completed_date >= $2
      AND ld.state IN ('Done', 'Completed')
    GROUP BY week_start
  ),
  team_jira_points AS (
    SELECT
      DATE_TRUNC($3, jh.change_date)::date AS week_start,
      COALESCE(SUM(jd.calculated_story_points), 0)::int AS team_story_points
    FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    WHERE jh.change_date >= $2
      AND jh.field = 'status'
      AND jh.to_value IN ('Done', 'Closed', 'Resolved')
    GROUP BY week_start
  ),
  combined_team_points AS (
    SELECT week_start, team_story_points FROM team_linear_points
    UNION ALL
    SELECT week_start, team_story_points FROM team_jira_points
  ),
  aggregated_team_points AS (
    SELECT
      week_start,
      SUM(team_story_points)::int AS team_story_points
    FROM combined_team_points
    GROUP BY week_start
  )
  SELECT
    COALESCE(dc.week_start, ap.week_start, atp.week_start) AS week_start,
    COALESCE(ap.story_points, 0) AS story_points,
    COALESCE(atp.team_story_points, 0) AS team_story_points,
    COALESCE(dc.lines_of_code, 0) AS lines_of_code,
    COALESCE(ap.issue_count, 0) AS issue_count,
    COALESCE(dc.commit_count, 0) AS commit_count
  FROM dev_commits dc
  FULL OUTER JOIN aggregated_points ap ON dc.week_start = ap.week_start
  FULL OUTER JOIN aggregated_team_points atp ON COALESCE(dc.week_start, ap.week_start) = atp.week_start
  WHERE COALESCE(dc.week_start, ap.week_start, atp.week_start) IS NOT NULL
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
 * GITX-183: For Jira, join on COALESCE(cc.jira_name, cc.full_name) instead of just
 * cc.full_name. The jira_name column is the canonical alignment field for matching
 * commit contributors to Jira assignees. Falls back to full_name for backwards
 * compatibility when jira_name is NULL.
 *
 * Parameters:
 *   $1 - developer full_name (TEXT)
 * Ticket: GITX-157, GITX-169, GITX-179, GITX-183
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
    -- GITX-183: Join on COALESCE(cc.jira_name, cc.full_name) for proper name alignment
    SELECT 1 FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    JOIN commit_contributors cc ON jd.assignee = COALESCE(cc.jira_name, cc.full_name)
    WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
      AND jh.field = 'status'
      AND jh.to_value IN ('Done', 'Closed', 'Resolved')
  ) AS has_data
`;

// ============================================================================
// GITX-219: Team Average Queries for Developer Profile
// ============================================================================

/**
 * Query to fetch the team name for a developer.
 * Returns the team column from commit_contributors for the given developer.
 *
 * Parameters:
 *   $1 - developer full_name (TEXT)
 * Ticket: GITX-219
 */
export const QUERY_DEV_PROFILE_GET_TEAM = `
  SELECT team
  FROM commit_contributors
  WHERE (full_name = $1 OR (full_name IS NULL AND login = $1))
  LIMIT 1
`;

/**
 * Query to fetch team average summary statistics.
 * Calculates averages across all team members with commits in the timeframe.
 * Team average = SUM(team member values) / COUNT(active team members in timeframe).
 * GITX-219: Used for KPI cards team comparison display.
 *
 * Parameters:
 *   $1 - team name (TEXT)
 *   $2 - start date (DATE)
 * Ticket: GITX-219
 */
export const QUERY_DEV_PROFILE_TEAM_AVERAGES = `
  WITH team_members AS (
    SELECT DISTINCT login, full_name
    FROM commit_contributors
    WHERE team = $1
  ),
  member_stats AS (
    SELECT
      tm.full_name,
      tm.login,
      COUNT(DISTINCT ch.sha)::int AS total_commits,
      COALESCE(SUM(cf.line_inserts), 0)::bigint AS total_loc,
      COALESCE(AVG(NULLIF(cf.complexity, 0)), 0)::numeric AS avg_complexity,
      COUNT(DISTINCT ch.repository)::int AS repos_worked_on
    FROM team_members tm
    LEFT JOIN commit_history ch ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    LEFT JOIN commit_files cf ON cf.sha = ch.sha
    WHERE (ch.commit_date >= $2 OR ch.commit_date IS NULL)
      AND (ch.is_merge = FALSE OR ch.is_merge IS NULL)
    GROUP BY tm.full_name, tm.login
  ),
  active_members AS (
    SELECT * FROM member_stats WHERE total_commits > 0
  )
  SELECT
    COUNT(*)::int AS member_count,
    COALESCE(AVG(total_commits), 0)::numeric AS avg_commits,
    COALESCE(AVG(total_loc), 0)::numeric AS avg_loc,
    COALESCE(AVG(avg_complexity), 0)::numeric AS avg_complexity,
    COALESCE(AVG(repos_worked_on), 0)::numeric AS avg_repos
  FROM active_members
`;

/**
 * Query to fetch team average story points per period.
 * Calculates mean story points across active team members with Jira/Linear data.
 * GITX-219: Used for Avg SP/Period team comparison.
 *
 * Parameters:
 *   $1 - team name (TEXT)
 *   $2 - start date (DATE)
 * Ticket: GITX-219
 */
export const QUERY_DEV_PROFILE_TEAM_AVG_STORY_POINTS = `
  WITH team_members AS (
    SELECT DISTINCT login, full_name, email, jira_name
    FROM commit_contributors
    WHERE team = $1
  ),
  linear_points AS (
    SELECT
      COALESCE(tm.full_name, tm.login) AS member_name,
      COALESCE(SUM(ld.calculated_story_points), 0)::int AS points
    FROM team_members tm
    JOIN linear_detail ld ON (
      ld.assignee = tm.email OR ld.assignee = tm.login OR ld.assignee = tm.full_name
    )
    WHERE ld.completed_date >= $2
      AND ld.state IN ('Done', 'Completed')
    GROUP BY member_name
  ),
  jira_points AS (
    SELECT
      COALESCE(tm.full_name, tm.login) AS member_name,
      COALESCE(SUM(jd.calculated_story_points), 0)::int AS points
    FROM team_members tm
    JOIN jira_history jh ON TRUE
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
      AND jd.assignee = COALESCE(tm.jira_name, tm.full_name)
    WHERE jh.change_date >= $2
      AND jh.field = 'status'
      AND jh.to_value IN ('Done', 'Closed', 'Resolved')
    GROUP BY member_name
  ),
  combined_points AS (
    SELECT member_name, SUM(points)::int AS total_points
    FROM (
      SELECT member_name, points FROM linear_points
      UNION ALL
      SELECT member_name, points FROM jira_points
    ) sub
    GROUP BY member_name
  ),
  members_with_points AS (
    SELECT * FROM combined_points WHERE total_points > 0
  )
  SELECT
    COUNT(*)::int AS member_count,
    COALESCE(AVG(total_points), 0)::numeric AS avg_story_points
  FROM members_with_points
`;
