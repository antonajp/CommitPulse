-- Migration 007: Create vw_component_snapshot_by_team view
-- Ticket: IQS-886
-- Purpose: Provide a date-based snapshot of codebase size by architecture
--          component and team ownership. Used by the Architecture Component
--          LOC chart in the Charts webview.
--
-- Privacy note: This view joins commit_contributors for team assignment only.
-- Raw emails are never exposed; only the computed primary_team column is used.

-- Performance index on commit_history.commit_date for date-range filtering
CREATE INDEX IF NOT EXISTS idx_commit_history_commit_date
  ON commit_history (commit_date);

-- Performance index on commit_files(sha, filename) for join optimization
CREATE INDEX IF NOT EXISTS idx_commit_files_sha_filename
  ON commit_files (sha, filename);

-- Create the component snapshot view
-- For a given date, returns the latest version of each file with its
-- arc_component classification and team ownership, using ROW_NUMBER()
-- to deduplicate files (latest commit per file before the selected date).
CREATE OR REPLACE VIEW vw_component_snapshot_by_team AS
SELECT
  cf.filename,
  ch.repository,
  cf.arc_component,
  cf.total_code_lines,
  cf.total_comment_lines,
  cf.complexity AS total_complexity,
  ch.commit_date,
  ch.sha,
  cc.team
FROM commit_files cf
INNER JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE cf.total_code_lines IS NOT NULL;
