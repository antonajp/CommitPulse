-- Migration 008: Create vw_sprint_velocity_vs_loc view and performance indexes
-- Ticket: IQS-888
-- Purpose: Provide a weekly view comparing sprint velocity (story points from
--          linear_detail) against lines of code committed (from commit_files),
--          linked by ISO week. Used by the Sprint Velocity vs LOC dual-axis chart.
--
-- Design notes:
--   - DATE_TRUNC('week', ...) returns Monday (ISO 8601) in PostgreSQL
--   - Story points de-duplicated via COUNT(DISTINCT linear_key) per week
--   - LOC only from non-merge commits linked to Linear issues via commit_linear
--   - FULL OUTER JOIN ensures weeks with only commits OR only issues appear

-- Performance index on linear_detail(completed_date) for date-range filtering
CREATE INDEX IF NOT EXISTS idx_linear_detail_completed_date
  ON linear_detail (completed_date);

-- Performance index on commit_linear(linear_key) for join optimization
CREATE INDEX IF NOT EXISTS idx_commit_linear_linear_key
  ON commit_linear (linear_key);

-- Create the sprint velocity vs LOC view
CREATE OR REPLACE VIEW vw_sprint_velocity_vs_loc AS
WITH weekly_story_points AS (
  SELECT DATE_TRUNC('week', ld.completed_date)::DATE AS week_start,
         ld.team, ld.project,
         SUM(ld.calculated_story_points)::INTEGER AS total_story_points,
         COUNT(DISTINCT ld.linear_key)::INTEGER AS issue_count
  FROM linear_detail ld
  WHERE ld.completed_date IS NOT NULL
    AND ld.calculated_story_points IS NOT NULL
    AND ld.state IN ('Done', 'Completed')
  GROUP BY DATE_TRUNC('week', ld.completed_date)::DATE, ld.team, ld.project
),
weekly_loc AS (
  SELECT DATE_TRUNC('week', ch.commit_date)::DATE AS week_start,
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
)
SELECT COALESCE(wsp.week_start, wloc.week_start) AS week_start,
       wsp.team, wsp.project, wloc.repository,
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
