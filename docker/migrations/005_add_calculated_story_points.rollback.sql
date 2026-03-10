-- Rollback for Migration 005: Remove calculated_story_points columns
-- Ticket: IQS-884
--
-- Drops columns with IF EXISTS guards for safety.

-- Remove calculated_story_points from jira_detail
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'jira_detail'
        AND column_name = 'calculated_story_points'
    ) THEN
        ALTER TABLE jira_detail DROP COLUMN calculated_story_points;
    END IF;
END $$;

-- Remove calculated_story_points from linear_detail
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'linear_detail'
        AND column_name = 'calculated_story_points'
    ) THEN
        ALTER TABLE linear_detail DROP COLUMN calculated_story_points;
    END IF;
END $$;
