-- Rollback Migration 015: Ticket Lifecycle Sankey Dashboard
-- Ticket: IQS-905
--
-- Drops the vw_transition_matrix, vw_ticket_transitions views, and status_order table.
-- Safe to run multiple times.

-- Drop the aggregated matrix view first (depends on vw_ticket_transitions)
DROP VIEW IF EXISTS vw_transition_matrix;

-- Drop the transitions view
DROP VIEW IF EXISTS vw_ticket_transitions;

-- Drop the status order reference table
DROP TABLE IF EXISTS status_order;

-- Note: Indexes created by this migration may be useful for other queries.
-- Only drop them if explicitly needed:
-- DROP INDEX IF EXISTS idx_jira_history_field_status;
-- DROP INDEX IF EXISTS idx_linear_history_field_status;
-- DROP INDEX IF EXISTS idx_jira_history_change_date;
-- DROP INDEX IF EXISTS idx_linear_history_change_date;
