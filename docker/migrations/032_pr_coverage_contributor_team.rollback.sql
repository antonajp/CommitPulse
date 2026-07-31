-- Migration 032 Rollback: PR Coverage Report - Remove contributor/team grouping
-- Ticket: GITX-223
-- Purpose: Roll back the PR Coverage contributor/team grouping enhancements
--          and restore the original vw_pr_coverage base view
--
-- This rollback:
--   1. Drops vw_pr_coverage_by_team view
--   2. Drops vw_pr_coverage_by_contributor view
--   3. Restores vw_pr_coverage to its original state (without contributor_name and team_name columns)

-- ============================================================================
-- Drop Team and Contributor Views
-- ============================================================================

DROP VIEW IF EXISTS vw_pr_coverage_by_team;
DROP VIEW IF EXISTS vw_pr_coverage_by_contributor;

-- ============================================================================
-- Restore Original PR Coverage Base View
-- ============================================================================

CREATE OR REPLACE VIEW vw_pr_coverage AS
SELECT
    ch.sha,
    ch.repository,
    ch.branch,
    ch.author,
    ch.commit_date,
    ch.commit_message,
    ch.is_merge,
    ch.organization,
    ch.lines_added,
    ch.lines_removed,
    ch.file_count,

    -- PR linkage information
    cpr.pull_request_id,
    pr.pr_number,
    pr.title AS pr_title,
    pr.author AS pr_author,
    pr.merged_at AS pr_merged_at,
    pr.state AS pr_state,
    cpr.link_source,

    -- Coverage classification
    CASE
        WHEN ch.is_merge = true THEN 'merge_commit'
        WHEN cpr.pull_request_id IS NOT NULL THEN 'pr_linked'
        ELSE 'orphan'
    END AS coverage_status,

    -- Boolean flag for filtering
    CASE
        WHEN ch.is_merge = true THEN false
        WHEN cpr.pull_request_id IS NOT NULL THEN true
        ELSE false
    END AS has_pr

FROM commit_history ch
LEFT JOIN commit_pull_request cpr ON ch.sha = cpr.sha AND ch.repository = cpr.repository
LEFT JOIN pull_request pr ON cpr.pull_request_id = pr.id;

COMMENT ON VIEW vw_pr_coverage IS 'PR Coverage dashboard view: shows each commit with its PR linkage status (pr_linked, orphan, merge_commit).';
