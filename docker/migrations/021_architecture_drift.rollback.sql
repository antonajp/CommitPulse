-- Rollback Migration 021: Architecture Drift Heat Map Dashboard
-- Ticket: IQS-917
--
-- Drops the architecture drift views and associated indexes.
-- Safe to run multiple times.

-- Drop views in reverse dependency order
DROP VIEW IF EXISTS vw_component_pair_coupling CASCADE;
DROP VIEW IF EXISTS vw_architecture_drift_weekly CASCADE;
DROP VIEW IF EXISTS vw_architecture_drift CASCADE;
DROP VIEW IF EXISTS vw_cross_component_commits CASCADE;
DROP VIEW IF EXISTS vw_component_changes CASCADE;

-- Drop indexes (if they were only created for this feature)
-- Note: These indexes may be useful for other queries, so we comment them out
-- DROP INDEX IF EXISTS idx_commit_files_arc_component_sha;
-- DROP INDEX IF EXISTS idx_commit_history_commit_date_repository;
