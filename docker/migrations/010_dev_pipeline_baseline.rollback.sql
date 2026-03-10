-- Migration 010 Rollback: Drop Development Pipeline baseline tracking
-- Ticket: IQS-896

-- Drop the view first (depends on table)
DROP VIEW IF EXISTS vw_dev_pipeline_deltas;

-- Drop indexes
DROP INDEX IF EXISTS idx_commit_baseline_sha;
DROP INDEX IF EXISTS idx_commit_baseline_baseline_sha;
DROP INDEX IF EXISTS idx_commit_history_commit_date;
DROP INDEX IF EXISTS idx_commit_history_is_merge;
DROP INDEX IF EXISTS idx_commit_jira_sha;

-- Drop the baseline table
DROP TABLE IF EXISTS commit_baseline;
