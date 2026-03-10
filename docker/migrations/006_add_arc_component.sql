-- Migration 006: Add arc_component column to commit_files
-- Ticket: IQS-885
-- Purpose: Enable architecture-level analytics by classifying every file
--          in commit_files into an architecture component category.

-- Add arc_component column if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commit_files'
    AND column_name = 'arc_component'
  ) THEN
    ALTER TABLE commit_files ADD COLUMN arc_component VARCHAR(50) NULL;
  END IF;
END $$;

-- Create index for dashboard GROUP BY queries (idempotent)
CREATE INDEX IF NOT EXISTS idx_commit_files_arc_component
  ON commit_files (arc_component);
