-- Rollback Migration 018: Release Risk Gauge Dashboard
-- Ticket: IQS-911
--
-- Drops the release risk views and associated indexes.
-- Safe to run multiple times.

-- Drop views in reverse dependency order
DROP VIEW IF EXISTS vw_release_risk CASCADE;
DROP VIEW IF EXISTS vw_commit_risk CASCADE;
DROP VIEW IF EXISTS vw_author_experience CASCADE;

-- Drop indexes (if they were only created for this feature)
-- Note: These indexes may be useful for other queries, so we leave them
-- DROP INDEX IF EXISTS idx_commit_history_author_date;
-- DROP INDEX IF EXISTS idx_commit_history_branch;
-- DROP INDEX IF EXISTS idx_commit_history_repo_branch;
