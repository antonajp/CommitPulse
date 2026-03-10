-- Migration 011 Rollback: Release Management Contribution views
-- Ticket: IQS-898
--
-- Drops all views and indexes created by migration 011.

-- Drop indexes
DROP INDEX IF EXISTS idx_commit_history_repo_branch_merge_date;
DROP INDEX IF EXISTS idx_commit_tags_tag;
DROP INDEX IF EXISTS idx_commit_branch_relationship_branch;
DROP INDEX IF EXISTS idx_commit_history_merge_date;
DROP INDEX IF EXISTS idx_commit_history_is_merge;

-- Drop views (order matters due to dependencies)
DROP VIEW IF EXISTS vw_release_contributions_summary;
DROP VIEW IF EXISTS vw_release_contributions;
DROP VIEW IF EXISTS vw_merge_commits_by_environment;
DROP VIEW IF EXISTS vw_release_tags;
DROP VIEW IF EXISTS vw_release_environment_mapping;
