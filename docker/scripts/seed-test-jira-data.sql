-- Seed test Jira data for local testing of Git-Jira joins
-- This script creates artificial jira_detail and jira_history records
-- that will join to existing commit_contributors data
--
-- Run with: docker exec -i gitrx-postgres psql -U gitrx_admin -d gitrx -f - < docker/scripts/seed-test-jira-data.sql

-- First, let's see what contributors we have to work with
DO $$
DECLARE
    contributor RECORD;
    ticket_num INTEGER := 100;
    story_points INTEGER;
    status_change_date TIMESTAMP WITH TIME ZONE;
BEGIN
    RAISE NOTICE 'Creating test Jira data for contributors...';

    -- Loop through contributors who have commits
    FOR contributor IN
        SELECT DISTINCT
            cc.login,
            cc.full_name,
            cc.jira_name,
            COALESCE(cc.jira_name, cc.full_name) AS jira_identity
        FROM commit_contributors cc
        WHERE cc.full_name IS NOT NULL OR cc.jira_name IS NOT NULL
        LIMIT 10
    LOOP
        RAISE NOTICE 'Creating tickets for: % (jira_identity: %)',
            contributor.login, contributor.jira_identity;

        -- Create 5 completed tickets per contributor
        FOR i IN 1..5 LOOP
            ticket_num := ticket_num + 1;
            story_points := (random() * 8 + 1)::int; -- 1-8 story points
            status_change_date := NOW() - ((random() * 90)::int || ' days')::interval; -- Last 90 days

            -- Insert jira_detail record
            INSERT INTO jira_detail (
                jira_key,
                project,
                summary,
                description,
                status,
                assignee,
                reporter,
                issuetype,
                priority,
                points,
                calculated_story_points,
                created_date,
                status_change_date
            )
            VALUES (
                'GITX-' || ticket_num,
                'GITX',
                'Test ticket ' || ticket_num || ' for ' || contributor.full_name,
                'This is a test ticket for validating Git-Jira joins',
                'Done',
                contributor.jira_identity, -- Use jira_identity as assignee
                'test.user',
                'Story',
                'Medium',
                story_points,
                story_points,
                status_change_date - INTERVAL '14 days', -- Created 2 weeks before completion
                status_change_date
            )
            ON CONFLICT (jira_key) DO UPDATE SET
                assignee = EXCLUDED.assignee,
                status = EXCLUDED.status,
                calculated_story_points = EXCLUDED.calculated_story_points,
                status_change_date = EXCLUDED.status_change_date;

            -- Insert jira_history record for status change to Done
            INSERT INTO jira_history (
                jira_key,
                field,
                from_value,
                to_value,
                change_date,
                assignee
            )
            VALUES (
                'GITX-' || ticket_num,
                'status',
                'In Progress',
                'Done',
                status_change_date,
                contributor.jira_identity
            )
            ON CONFLICT DO NOTHING;

        END LOOP;
    END LOOP;

    RAISE NOTICE 'Test Jira data seeding complete!';
END $$;

-- Show summary of what was created
SELECT
    'jira_detail' AS table_name,
    COUNT(*) AS record_count,
    COUNT(DISTINCT assignee) AS unique_assignees
FROM jira_detail
WHERE jira_key LIKE 'GITX-%' AND jira_key ~ 'GITX-[0-9]{3,}'
UNION ALL
SELECT
    'jira_history' AS table_name,
    COUNT(*) AS record_count,
    COUNT(DISTINCT assignee) AS unique_assignees
FROM jira_history
WHERE jira_key LIKE 'GITX-%' AND jira_key ~ 'GITX-[0-9]{3,}';

-- Show which contributors now have matching Jira data
SELECT
    cc.login,
    cc.full_name,
    cc.jira_name,
    COALESCE(cc.jira_name, cc.full_name) AS jira_identity,
    COUNT(DISTINCT jd.jira_key) AS matched_tickets,
    COALESCE(SUM(jd.calculated_story_points), 0) AS total_story_points
FROM commit_contributors cc
LEFT JOIN jira_detail jd ON jd.assignee = COALESCE(cc.jira_name, cc.full_name)
    AND jd.status IN ('Done', 'Closed', 'Resolved')
WHERE cc.full_name IS NOT NULL
GROUP BY cc.login, cc.full_name, cc.jira_name
ORDER BY matched_tickets DESC, cc.full_name;
