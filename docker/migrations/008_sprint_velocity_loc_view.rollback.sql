-- Rollback for migration 008: Drop vw_sprint_velocity_vs_loc view and indexes
-- Ticket: IQS-888

DROP VIEW IF EXISTS vw_sprint_velocity_vs_loc;
DROP INDEX IF EXISTS idx_linear_detail_completed_date;
DROP INDEX IF EXISTS idx_commit_linear_linear_key;
