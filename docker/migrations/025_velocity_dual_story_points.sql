-- Migration 025: Add dual story points columns to vw_sprint_velocity_vs_loc
-- Ticket: IQS-944
-- Purpose: Enable comparison between human story point estimates and AI-calculated estimates.
--
-- Changes:
--   - Adds human_story_points column (from jira_detail.points)
--   - Adds ai_story_points column (from calculated_story_points)
--   - Preserves existing total_story_points for backward compatibility
--   - Jira: has both points (human) and calculated_story_points (AI)
--   - Linear: only has calculated_story_points (no human estimates)
--
-- Design notes:
--   - Uses separate CTEs for clarity
--   - Human estimates come from jira_detail.points only (Linear has no equivalent)
--   - AI estimates come from calculated_story_points (both Jira and Linear)
--   - COALESCE(calculated, points) preserved in total_story_points for backward compatibility

-- ============================================================================
-- Recreate the sprint velocity vs LOC view with dual story points
-- ============================================================================

-- Must DROP the view because CREATE OR REPLACE cannot add columns in the middle
-- or change column order. The new columns (human_story_points, ai_story_points)
-- are inserted before total_story_points.
DROP VIEW IF EXISTS vw_sprint_velocity_vs_loc;

CREATE VIEW vw_sprint_velocity_vs_loc AS

-- CTE for Jira story points (from jira_detail) with both human and AI columns
WITH jira_story_points AS (
  SELECT
    DATE_TRUNC('week', jd.status_change_date)::DATE AS week_start,
    NULL::TEXT AS team,  -- Jira has no team field
    jd.project,
    -- Human estimates: original story points assigned by team
    SUM(COALESCE(jd.points, 0))::INTEGER AS human_story_points,
    -- AI estimates: calculated from issue duration
    SUM(COALESCE(jd.calculated_story_points, 0))::INTEGER AS ai_story_points,
    -- Combined total for backward compatibility
    SUM(COALESCE(jd.calculated_story_points, jd.points, 0))::INTEGER AS total_story_points,
    COUNT(DISTINCT jd.jira_key)::INTEGER AS issue_count
  FROM jira_detail jd
  WHERE jd.status_change_date IS NOT NULL
    AND (jd.calculated_story_points IS NOT NULL OR jd.points IS NOT NULL)
    AND jd.status IN ('Done', 'Closed', 'Resolved')
  GROUP BY DATE_TRUNC('week', jd.status_change_date)::DATE, jd.project
),

-- CTE for Linear story points (from linear_detail)
-- Note: Linear only has calculated_story_points, no human estimates
linear_story_points AS (
  SELECT
    DATE_TRUNC('week', ld.completed_date)::DATE AS week_start,
    ld.team,
    ld.project,
    -- Human estimates: Linear has no equivalent, always 0
    0::INTEGER AS human_story_points,
    -- AI estimates: calculated from issue duration
    SUM(COALESCE(ld.calculated_story_points, 0))::INTEGER AS ai_story_points,
    -- Combined total (same as AI for Linear)
    SUM(COALESCE(ld.calculated_story_points, 0))::INTEGER AS total_story_points,
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
    SUM(human_story_points)::INTEGER AS human_story_points,
    SUM(ai_story_points)::INTEGER AS ai_story_points,
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

-- CTE for Linear-linked LOC (from commit_linear)
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
  -- IQS-944: Dual story point columns for Human vs AI comparison
  COALESCE(wsp.human_story_points, 0) AS human_story_points,
  COALESCE(wsp.ai_story_points, 0) AS ai_story_points,
  -- Backward compatible total (COALESCE of calculated, human)
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

COMMENT ON VIEW vw_sprint_velocity_vs_loc IS 'Sprint velocity (story points from Jira + Linear) vs LOC (commits linked to Jira + Linear issues). Includes human_story_points and ai_story_points for estimation comparison. Ticket: IQS-944';
