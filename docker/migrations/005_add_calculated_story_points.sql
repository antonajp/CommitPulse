-- Migration 005: Add calculated_story_points column to detail tables
-- Backfill story points from issue duration (creation-to-completion)
-- Ticket: IQS-884
--
-- Uses IF NOT EXISTS guards for idempotency.

-- ============================================================================
-- Add calculated_story_points to jira_detail
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'jira_detail'
        AND column_name = 'calculated_story_points'
    ) THEN
        ALTER TABLE jira_detail ADD COLUMN calculated_story_points SMALLINT;
    END IF;
END $$;

-- ============================================================================
-- Add calculated_story_points to linear_detail
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'linear_detail'
        AND column_name = 'calculated_story_points'
    ) THEN
        ALTER TABLE linear_detail ADD COLUMN calculated_story_points SMALLINT;
    END IF;
END $$;
