-- Rollback Migration 025: Revert to vw_sprint_velocity_vs_loc without dual story points
-- Ticket: IQS-944
-- Purpose: Restore the original view from migration 022 that uses COALESCE only

-- This rollback restores the view from migration 022_velocity_view_jira_support.sql
-- which uses COALESCE(calculated_story_points, points) without separate columns

CREATE OR REPLACE VIEW vw_sprint_velocity_vs_loc AS

WITH jira_story_points AS (
  SELECT
    DATE_TRUNC('week', jd.status_change_date)::DATE AS week_start,
    NULL::TEXT AS team,
    jd.project,
    SUM(COALESCE(jd.calculated_story_points, jd.points))::INTEGER AS total_story_points,
    COUNT(DISTINCT jd.jira_key)::INTEGER AS issue_count
  FROM jira_detail jd
  WHERE jd.status_change_date IS NOT NULL
    AND (jd.calculated_story_points IS NOT NULL OR jd.points IS NOT NULL)
    AND jd.status IN ('Done', 'Closed', 'Resolved')
  GROUP BY DATE_TRUNC('week', jd.status_change_date)::DATE, jd.project
),

linear_story_points AS (
  SELECT
    DATE_TRUNC('week', ld.completed_date)::DATE AS week_start,
    ld.team,
    ld.project,
    SUM(ld.calculated_story_points)::INTEGER AS total_story_points,
    COUNT(DISTINCT ld.linear_key)::INTEGER AS issue_count
  FROM linear_detail ld
  WHERE ld.completed_date IS NOT NULL
    AND ld.calculated_story_points IS NOT NULL
    AND ld.state IN ('Done', 'Completed')
  GROUP BY DATE_TRUNC('week', ld.completed_date)::DATE, ld.team, ld.project
),

all_story_points AS (
  SELECT * FROM jira_story_points
  UNION ALL
  SELECT * FROM linear_story_points
),

weekly_story_points AS (
  SELECT
    week_start,
    team,
    project,
    SUM(total_story_points)::INTEGER AS total_story_points,
    SUM(issue_count)::INTEGER AS issue_count
  FROM all_story_points
  GROUP BY week_start, team, project
),

jira_loc AS (
  SELECT
    DATE_TRUNC('week', ch.commit_date)::DATE AS week_start,
    ch.repository,
    SUM(cf.line_diff)::INTEGER AS total_loc_changed,
    SUM(cf.line_inserts)::INTEGER AS total_lines_added,
    SUM(cf.line_deletes)::INTEGER AS total_lines_deleted,
    COUNT(DISTINCT ch.sha)::INTEGER AS commit_count
  FROM commit_history ch
  INNER JOIN commit_files cf ON ch.sha = cf.sha
  INNER JOIN commit_jira cj ON ch.sha = cj.sha
  WHERE ch.commit_date IS NOT NULL AND ch.is_merge = FALSE
  GROUP BY DATE_TRUNC('week', ch.commit_date)::DATE, ch.repository
),

linear_loc AS (
  SELECT
    DATE_TRUNC('week', ch.commit_date)::DATE AS week_start,
    ch.repository,
    SUM(cf.line_diff)::INTEGER AS total_loc_changed,
    SUM(cf.line_inserts)::INTEGER AS total_lines_added,
    SUM(cf.line_deletes)::INTEGER AS total_lines_deleted,
    COUNT(DISTINCT ch.sha)::INTEGER AS commit_count
  FROM commit_history ch
  INNER JOIN commit_files cf ON ch.sha = cf.sha
  INNER JOIN commit_linear cl ON ch.sha = cl.sha
  WHERE ch.commit_date IS NOT NULL AND ch.is_merge = FALSE
  GROUP BY DATE_TRUNC('week', ch.commit_date)::DATE, ch.repository
),

all_loc AS (
  SELECT * FROM jira_loc
  UNION ALL
  SELECT * FROM linear_loc
),

weekly_loc AS (
  SELECT
    week_start,
    repository,
    SUM(total_loc_changed)::INTEGER AS total_loc_changed,
    SUM(total_lines_added)::INTEGER AS total_lines_added,
    SUM(total_lines_deleted)::INTEGER AS total_lines_deleted,
    SUM(commit_count)::INTEGER AS commit_count
  FROM all_loc
  GROUP BY week_start, repository
)

SELECT
  COALESCE(wsp.week_start, wloc.week_start) AS week_start,
  wsp.team,
  wsp.project,
  wloc.repository,
  COALESCE(wsp.total_story_points, 0) AS total_story_points,
  COALESCE(wsp.issue_count, 0) AS issue_count,
  COALESCE(wloc.total_loc_changed, 0) AS total_loc_changed,
  COALESCE(wloc.total_lines_added, 0) AS total_lines_added,
  COALESCE(wloc.total_lines_deleted, 0) AS total_lines_deleted,
  COALESCE(wloc.commit_count, 0) AS commit_count
FROM weekly_story_points wsp
FULL OUTER JOIN weekly_loc wloc ON wsp.week_start = wloc.week_start
WHERE COALESCE(wsp.week_start, wloc.week_start) IS NOT NULL
ORDER BY week_start DESC;

COMMENT ON VIEW vw_sprint_velocity_vs_loc IS 'Sprint velocity (story points from Jira + Linear) vs LOC (commits linked to Jira + Linear issues). Ticket: IQS-937';
