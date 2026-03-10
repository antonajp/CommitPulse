-- Rollback Migration 016: Developer Focus Score Dashboard
-- Ticket: IQS-907
-- Purpose: Remove focus score views and indexes

-- Drop views
DROP VIEW IF EXISTS vw_developer_focus CASCADE;
DROP VIEW IF EXISTS vw_developer_daily_activity CASCADE;

-- Drop indexes (if they were only created for this feature)
-- Note: These indexes may be useful for other queries, so we leave them
-- DROP INDEX IF EXISTS idx_commit_history_author_date;
-- DROP INDEX IF EXISTS idx_commit_history_commit_date;
