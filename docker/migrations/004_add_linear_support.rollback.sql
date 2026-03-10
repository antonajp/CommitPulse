-- Rollback for Migration 004: Remove Linear support tables
-- Ticket: IQS-875
--
-- Drops tables in reverse dependency order, then removes the column.

DROP TABLE IF EXISTS gitr_pipeline_linear CASCADE;
DROP TABLE IF EXISTS commit_linear CASCADE;
DROP TABLE IF EXISTS linear_history CASCADE;
DROP TABLE IF EXISTS linear_detail CASCADE;

-- Remove is_linear_ref column from commit_history if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'commit_history'
        AND column_name = 'is_linear_ref'
    ) THEN
        ALTER TABLE commit_history DROP COLUMN is_linear_ref;
    END IF;
END $$;
