-- Rollback Migration 019: Test Debt Predictor Dashboard
-- Ticket: IQS-913
--
-- Drops the test debt views and associated indexes.
-- Safe to run multiple times.

-- Drop views in reverse dependency order
DROP VIEW IF EXISTS vw_test_debt CASCADE;
DROP VIEW IF EXISTS vw_subsequent_bugs CASCADE;
DROP VIEW IF EXISTS vw_commit_test_ratio CASCADE;

-- Drop indexes (if they were only created for this feature)
-- Note: These indexes may be useful for other queries, so we comment them out
-- DROP INDEX IF EXISTS idx_commit_history_commit_date_repo;
-- DROP INDEX IF EXISTS idx_commit_files_is_test_file;
-- DROP INDEX IF EXISTS idx_jira_detail_issuetype;
