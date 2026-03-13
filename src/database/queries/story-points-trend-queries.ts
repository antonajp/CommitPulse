/**
 * Parameterized SQL queries for the Story Points Trend chart.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against jira_history and jira_detail tables to
 * reconstruct daily status snapshots from transition history.
 *
 * Ticket: IQS-940
 */

/**
 * Query to fetch story points trend data from status transitions.
 * Aggregates story points by day and status category.
 *
 * Status categories:
 * - Development: 'CODE REVIEW', 'IN PROGRESS', 'IN DEV', 'IN DEVELOPMENT'
 * - QA: 'IN QA', 'READY FOR QA', 'IN UAT', 'QA'
 *
 * Parameters:
 *   $1 - start_date (DATE) - beginning of date range
 *   $2 - end_date (DATE) - end of date range
 *
 * Returns rows ordered by transition_date ASC for chronological charting.
 * Limited to 1000 rows for safety.
 */
export const QUERY_STORY_POINTS_TREND = `
  WITH daily_status_transitions AS (
    SELECT
      DATE(jh.change_date) AS transition_date,
      jd.jira_key,
      jh.to_value AS status,
      COALESCE(jd.calculated_story_points, jd.points, 0) AS story_points,
      CASE
        WHEN UPPER(jh.to_value) IN ('CODE REVIEW', 'IN PROGRESS', 'IN DEV', 'IN DEVELOPMENT')
        THEN 'Development'
        WHEN UPPER(jh.to_value) IN ('IN QA', 'READY FOR QA', 'IN UAT', 'QA')
        THEN 'QA'
        ELSE 'Other'
      END AS status_category
    FROM jira_history jh
    INNER JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    WHERE jh.field = 'status'
      AND DATE(jh.change_date) >= $1::DATE
      AND DATE(jh.change_date) <= $2::DATE
  )
  SELECT
    transition_date,
    status_category,
    SUM(story_points) AS total_story_points,
    COUNT(DISTINCT jira_key) AS ticket_count
  FROM daily_status_transitions
  WHERE status_category IN ('Development', 'QA')
  GROUP BY transition_date, status_category
  ORDER BY transition_date ASC
  LIMIT 1000
`;

/**
 * Query to fetch story points trend data with team filter.
 * Uses commit_jira -> commit_history -> commit_contributors to filter by team.
 *
 * Parameters:
 *   $1 - start_date (DATE) - beginning of date range
 *   $2 - end_date (DATE) - end of date range
 *   $3 - team (TEXT) - team name to filter by
 */
export const QUERY_STORY_POINTS_TREND_TEAM = `
  WITH team_jira_keys AS (
    SELECT DISTINCT cj.jira_key
    FROM commit_jira cj
    INNER JOIN commit_history ch ON cj.sha = ch.sha
    INNER JOIN commit_contributors cc ON ch.author = cc.login
    WHERE cc.team = $3
  ),
  daily_status_transitions AS (
    SELECT
      DATE(jh.change_date) AS transition_date,
      jd.jira_key,
      jh.to_value AS status,
      COALESCE(jd.calculated_story_points, jd.points, 0) AS story_points,
      CASE
        WHEN UPPER(jh.to_value) IN ('CODE REVIEW', 'IN PROGRESS', 'IN DEV', 'IN DEVELOPMENT')
        THEN 'Development'
        WHEN UPPER(jh.to_value) IN ('IN QA', 'READY FOR QA', 'IN UAT', 'QA')
        THEN 'QA'
        ELSE 'Other'
      END AS status_category
    FROM jira_history jh
    INNER JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    WHERE jh.field = 'status'
      AND DATE(jh.change_date) >= $1::DATE
      AND DATE(jh.change_date) <= $2::DATE
      AND jh.jira_key IN (SELECT jira_key FROM team_jira_keys)
  )
  SELECT
    transition_date,
    status_category,
    SUM(story_points) AS total_story_points,
    COUNT(DISTINCT jira_key) AS ticket_count
  FROM daily_status_transitions
  WHERE status_category IN ('Development', 'QA')
  GROUP BY transition_date, status_category
  ORDER BY transition_date ASC
  LIMIT 1000
`;

/**
 * Query to check if jira_history table has status data.
 * Used for graceful degradation when no Jira data is available.
 */
export const QUERY_STORY_POINTS_TREND_DATA_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM jira_history
    WHERE field = 'status'
    LIMIT 1
  ) AS data_exists
`;

/**
 * Query to fetch distinct teams for the filter dropdown.
 * Returns teams that have commits linked to Jira issues.
 */
export const QUERY_STORY_POINTS_TREND_TEAMS = `
  SELECT DISTINCT cc.team
  FROM commit_contributors cc
  INNER JOIN commit_history ch ON cc.login = ch.author
  INNER JOIN commit_jira cj ON ch.sha = cj.sha
  WHERE cc.team IS NOT NULL
    AND cc.team != ''
  ORDER BY cc.team ASC
  LIMIT 100
`;
