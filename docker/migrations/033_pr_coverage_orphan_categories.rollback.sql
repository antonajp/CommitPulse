-- Rollback Migration 033: PR Coverage Report - Orphan Commit Categorization
-- Ticket: GITX-227
--
-- Restores the vw_pr_coverage view to its 032 state (without orphan_category)
-- Drops orphan breakdown view and helper function

-- ============================================================================
-- Drop new views
-- ============================================================================

DROP VIEW IF EXISTS vw_pr_coverage_orphan_breakdown;

-- ============================================================================
-- Drop dependent views before recreating base view
-- ============================================================================

DROP VIEW IF EXISTS vw_pr_coverage_by_team CASCADE;
DROP VIEW IF EXISTS vw_pr_coverage_by_contributor CASCADE;
DROP VIEW IF EXISTS vw_pr_coverage CASCADE;

-- ============================================================================
-- Restore vw_pr_coverage to 032 state (without orphan_category)
-- ============================================================================

CREATE VIEW vw_pr_coverage AS
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

    -- Contributor information (using full_name pattern from GITX-171)
    COALESCE(cc.full_name, cc.login, ch.author) AS contributor_name,
    COALESCE(t.name, cc.team) AS team_name,

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
LEFT JOIN pull_request pr ON cpr.pull_request_id = pr.id
LEFT JOIN commit_contributors cc ON ch.author = cc.login
LEFT JOIN teams t ON cc.team_id = t.id;

COMMENT ON VIEW vw_pr_coverage IS 'PR Coverage dashboard view: shows each commit with its PR linkage status (pr_linked, orphan, merge_commit). Enhanced with contributor_name and team_name (GITX-223).';

-- ============================================================================
-- Restore PR Coverage by Contributor View
-- ============================================================================

CREATE VIEW vw_pr_coverage_by_contributor AS
SELECT
    repository,
    COALESCE(cc.full_name, cc.login, vpc.author) AS contributor_name,
    vpc.author AS login,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,

    -- Coverage percentage for this contributor
    CASE
        WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
        THEN ROUND(
            (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
             COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
            2
        )
        ELSE 0
    END AS coverage_percentage

FROM vw_pr_coverage vpc
LEFT JOIN commit_contributors cc ON vpc.author = cc.login
GROUP BY repository, COALESCE(cc.full_name, cc.login, vpc.author), vpc.author
HAVING COUNT(*) FILTER (WHERE is_merge = false) > 0
ORDER BY repository, total_commits DESC;

COMMENT ON VIEW vw_pr_coverage_by_contributor IS 'PR Coverage breakdown by contributor: groups by full_name (COALESCE(full_name, login)) instead of raw Git login. Replaces vw_pr_coverage_by_author for GITX-223.';

-- ============================================================================
-- Restore PR Coverage by Team View
-- ============================================================================

CREATE VIEW vw_pr_coverage_by_team AS
SELECT
    repository,
    COALESCE(t.name, cc.team, 'Unassigned') AS team_name,
    COUNT(DISTINCT COALESCE(cc.full_name, cc.login, vpc.author)) AS contributor_count,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,

    -- Coverage percentage for this team
    CASE
        WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
        THEN ROUND(
            (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
             COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
            2
        )
        ELSE 0
    END AS coverage_percentage

FROM vw_pr_coverage vpc
LEFT JOIN commit_contributors cc ON vpc.author = cc.login
LEFT JOIN teams t ON cc.team_id = t.id
GROUP BY repository, COALESCE(t.name, cc.team, 'Unassigned')
HAVING COUNT(*) FILTER (WHERE is_merge = false) > 0
ORDER BY repository, total_commits DESC;

COMMENT ON VIEW vw_pr_coverage_by_team IS 'PR Coverage breakdown by team: provides organization-level visibility into PR compliance by team. Uses teams table FK (GITX-223).';

-- ============================================================================
-- Drop helper function
-- ============================================================================

DROP FUNCTION IF EXISTS is_protected_branch(TEXT);

-- ============================================================================
-- Drop performance indexes
-- ============================================================================

DROP INDEX IF EXISTS idx_pr_head_branch_repo_state;
DROP INDEX IF EXISTS idx_commit_history_branch;
