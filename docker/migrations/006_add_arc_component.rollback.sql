-- Rollback for Migration 006: Remove arc_component column from commit_files
-- Ticket: IQS-885

-- Drop the index first
DROP INDEX IF EXISTS idx_commit_files_arc_component;

-- Remove the column
ALTER TABLE commit_files DROP COLUMN IF EXISTS arc_component;
