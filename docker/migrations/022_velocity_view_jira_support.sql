-- Migration 022: Fix vw_sprint_velocity_vs_loc to support both Jira and Linear data
-- Ticket: IQS-937
-- Purpose: The Sprint Velocity vs LOC chart only queries Linear data, ignoring Jira data.
--          This migration recreates the view with UNION pattern to include both trackers.
--
-- Root cause: Migration 008 hardcoded queries against linear_detail and commit_linear,
--             causing "No Velocity Data Available" for Jira-only installations.
--
-- Design notes:
--   - Uses separate CTEs for Jira and Linear story points, then UNION ALL
--   - Uses separate CTEs for Jira and Linear LOC, then UNION ALL
--   - Jira uses status_change_date (no completed_date field exists in Jira)
--   - Jira team is NULL (Jira schema lacks team field)
--   - Jira done states: 'Done', 'Closed', 'Resolved'
--   - Linear done states: 'Done', 'Completed' (unchanged from 008)
--   - Uses COALESCE for Jira story points to prefer calculated_story_points over points
--   - Preserves all existing columns for backward compatibility
--   - Final aggregation groups by week_start, team, project, repository to combine data

-- ============================================================================
-- Performance index on jira_detail(status_change_date) for date-range filtering
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_jira_detail_status_change_date
  ON jira_detail (status_change_date);

-- Performance index on commit_jira(jira_key) for join optimization
CREATE INDEX IF NOT EXISTS idx_commit_jira_jira_key
  ON commit_jira (jira_key);

-- ============================================================================
-- Recreate the sprint velocity vs LOC view with Jira + Linear support
-- ============================================================================

CREATE OR REPLACE VIEW vw_sprint_velocity_vs_loc AS

-- CTE for Jira story points (from jira_detail)
WITH jira_story_points AS (
  SELECT
    DATE_TRUNC('week', jd.status_change_date)::DATE AS week_start,
    NULL::TEXT AS team,  -- Jira has no team field
    jd.project,
    SUM(COALESCE(jd.calculated_story_points, jd.points))::INTEGER AS total_story_points,
    COUNT(DISTINCT jd.jira_key)::INTEGER AS issue_count
  FROM jira_detail jd
  WHERE jd.status_change_date IS NOT NULL
    AND (jd.calculated_story_points IS NOT NULL OR jd.points IS NOT NULL)
    AND jd.status IN ('Done', 'Closed', 'Resolved')
  GROUP BY DATE_TRUNC('week', jd.status_change_date)::DATE, jd.project
),

-- CTE for Linear story points (from linear_detail, unchanged from migration 008)
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

-- Combined story points from both trackers
all_story_points AS (
  SELECT * FROM jira_story_points
  UNION ALL
  SELECT * FROM linear_story_points
),

-- Aggregated story points (groups by week/team/project to handle overlaps)
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

-- CTE for Jira-linked LOC (from commit_jira)
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

-- CTE for Linear-linked LOC (from commit_linear, unchanged from migration 008)
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

-- Combined LOC from both trackers
all_loc AS (
  SELECT * FROM jira_loc
  UNION ALL
  SELECT * FROM linear_loc
),

-- Aggregated LOC (groups by week/repository to handle overlaps)
-- Note: A single commit may be linked to both Jira AND Linear issues
-- We use SUM which may double-count such commits, but this is acceptable
-- as the alternative (DISTINCT) loses accurate LOC attribution
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

-- Final output: FULL OUTER JOIN to include weeks with only commits OR only issues
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
