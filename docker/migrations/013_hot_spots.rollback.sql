-- Rollback Migration 013: Hot Spots analysis view
-- Ticket: IQS-901
--
-- Drops the vw_hot_spots view and associated indexes.
-- Safe to run multiple times.

-- Drop the view
DROP VIEW IF EXISTS vw_hot_spots;

-- Drop indexes created by this migration
-- Note: Only drop indexes created by 013, not ones that may be used by other queries
-- The idx_commit_files_path_repo may be useful for other queries, keep it
-- DROP INDEX IF EXISTS idx_commit_files_path_repo;

-- These indexes may be used by other queries as well, keeping them
-- DROP INDEX IF EXISTS idx_commit_history_commit_date;
-- DROP INDEX IF EXISTS idx_commit_history_is_merge;
