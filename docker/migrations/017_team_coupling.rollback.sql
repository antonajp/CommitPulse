-- Rollback Migration 017: Cross-Team Coupling Dashboard
-- Ticket: IQS-909
-- Purpose: Remove team coupling views and indexes

-- Drop views in reverse dependency order
DROP VIEW IF EXISTS vw_team_shared_files CASCADE;
DROP VIEW IF EXISTS vw_team_coupling CASCADE;
DROP VIEW IF EXISTS vw_file_team_ownership CASCADE;
DROP VIEW IF EXISTS vw_contributor_team CASCADE;

-- Drop indexes (if they were only created for this feature)
-- Note: These indexes may be useful for other queries, so we leave them
-- DROP INDEX IF EXISTS idx_commit_files_filename;
-- DROP INDEX IF EXISTS idx_gitja_team_contributor_login;
-- DROP INDEX IF EXISTS idx_commit_contributors_login_email;
