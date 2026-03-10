-- Rollback Migration 020: Commit Hygiene Tracker Dashboard
-- Ticket: IQS-915
--
-- Drops the commit hygiene views and associated indexes.
-- Safe to run multiple times.

-- Drop views in reverse dependency order
DROP VIEW IF EXISTS vw_commit_hygiene_weekly CASCADE;
DROP VIEW IF EXISTS vw_commit_hygiene_by_author CASCADE;
DROP VIEW IF EXISTS vw_commit_hygiene CASCADE;

-- Drop indexes (if they were only created for this feature)
-- Note: These indexes may be useful for other queries, so we comment them out
-- DROP INDEX IF EXISTS idx_commit_history_commit_date_author;
-- DROP INDEX IF EXISTS idx_commit_history_is_merge;
