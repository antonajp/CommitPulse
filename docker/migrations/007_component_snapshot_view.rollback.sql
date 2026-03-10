-- Rollback for Migration 007: Remove vw_component_snapshot_by_team view
-- Ticket: IQS-886

-- Drop the view
DROP VIEW IF EXISTS vw_component_snapshot_by_team;

-- Note: Indexes are NOT dropped in rollback because they benefit other queries.
-- If needed, drop manually:
-- DROP INDEX IF EXISTS idx_commit_history_commit_date;
-- DROP INDEX IF EXISTS idx_commit_files_sha_filename;
