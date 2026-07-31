-- Migration 033: PR Coverage Report - Orphan Commit Categorization
-- Ticket: GITX-227
-- Purpose: Categorize orphan commits into three distinct categories to provide
--          actionable insights into which orphans represent real process gaps
--          vs. expected git workflow artifacts.
--
-- Categories:
--   1. pre_merge_on_pr_branch: Commits on branches that have merged PRs
--      (incremental commits before squash-merge - expected workflow)
--   2. direct_to_protected: Commits pushed directly to protected branches
--      (main/master/develop - compliance issues, bypassed code review)
--   3. unlinked_feature_branch: Commits on feature branches with no matching PR
--      (old PRs outside sync window or abandoned branches)
--
-- Design:
--   - is_protected_branch(): Helper function for branch detection
--   - vw_pr_coverage: Updated with orphan_category column
--   - vw_pr_coverage_orphan_breakdown: Summary view for category breakdown
--   - Performance indexes for EXISTS subquery optimization
--
-- Dependencies:
--   - Migration 032: vw_pr_coverage with contributor/team support
--   - Migration 031: commit_pull_request junction table
--   - Migration 012: pull_request table

-- ============================================================================
-- Helper Function: is_protected_branch
-- ============================================================================

CREATE OR REPLACE FUNCTION is_protected_branch(branch_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Normalize branch name: strip refs/heads/ prefix if present
    -- Handle both 'main' and 'refs/heads/main' formats
    RETURN REGEXP_REPLACE(LOWER(COALESCE(branch_name, '')), '^refs/heads/', '')
           IN ('main', 'master', 'develop');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_protected_branch(TEXT) IS 'Returns true if the branch is a protected branch (main, master, or develop). Handles refs/heads/ prefix normalization.';

-- ============================================================================
-- Performance Indexes for EXISTS Subquery
-- ============================================================================

-- Index for looking up PRs by head_branch and state
CREATE INDEX IF NOT EXISTS idx_pr_head_branch_repo_state
ON pull_request(LOWER(head_branch), state, LOWER(repository));

-- Index for commit_history branch lookups
CREATE INDEX IF NOT EXISTS idx_commit_history_branch
ON commit_history(LOWER(branch));

-- ============================================================================
-- Update PR Coverage Base View - Add orphan_category column
-- ============================================================================

-- Drop dependent views first (CASCADE handles this, but explicit is clearer)
DROP VIEW IF EXISTS vw_pr_coverage_by_team CASCADE;
DROP VIEW IF EXISTS vw_pr_coverage_by_contributor CASCADE;
DROP VIEW IF EXISTS vw_pr_coverage CASCADE;

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
    END AS has_pr,

    -- Orphan category classification (NULL for non-orphans)
    -- Only evaluated when commit is an orphan (coverage_status = 'orphan')
    CASE
        -- Merge commits and PR-linked commits have no orphan category
        WHEN ch.is_merge = true THEN NULL
        WHEN cpr.pull_request_id IS NOT NULL THEN NULL
        -- Check if commit is on a branch that has a merged PR
        -- (pre-merge commits on PR branches - expected workflow)
        WHEN EXISTS (
            SELECT 1 FROM pull_request pr_branch
            WHERE LOWER(pr_branch.head_branch) = LOWER(ch.branch)
              AND pr_branch.state = 'merged'
              AND (LOWER(pr_branch.repository) = LOWER(ch.repository)
                   OR LOWER(ch.repository) = LOWER(SPLIT_PART(pr_branch.repository, '/', 2)))
        ) THEN 'pre_merge_on_pr_branch'
        -- Check if commit was pushed directly to a protected branch
        -- (bypassed code review - compliance issue)
        WHEN is_protected_branch(ch.branch) THEN 'direct_to_protected'
        -- Feature branch commits with no matching PR found
        -- (old PRs outside sync window or abandoned branches)
        ELSE 'unlinked_feature_branch'
    END AS orphan_category

FROM commit_history ch
LEFT JOIN commit_pull_request cpr ON ch.sha = cpr.sha AND ch.repository = cpr.repository
LEFT JOIN pull_request pr ON cpr.pull_request_id = pr.id
LEFT JOIN commit_contributors cc ON ch.author = cc.login
LEFT JOIN teams t ON cc.team_id = t.id;

COMMENT ON VIEW vw_pr_coverage IS 'PR Coverage dashboard view: shows each commit with its PR linkage status and orphan categorization (GITX-227).';
COMMENT ON COLUMN vw_pr_coverage.orphan_category IS 'Category of orphan commit: pre_merge_on_pr_branch (expected), direct_to_protected (compliance issue), unlinked_feature_branch (process gap). NULL for non-orphans.';

-- ============================================================================
-- Recreate PR Coverage by Contributor View (dropped by CASCADE)
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

COMMENT ON VIEW vw_pr_coverage_by_contributor IS 'PR Coverage breakdown by contributor: groups by full_name.';

-- ============================================================================
-- Recreate PR Coverage by Team View (dropped by CASCADE)
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

COMMENT ON VIEW vw_pr_coverage_by_team IS 'PR Coverage breakdown by team: provides organization-level visibility into PR compliance.';

-- ============================================================================
-- Create Orphan Category Breakdown View
-- ============================================================================

CREATE VIEW vw_pr_coverage_orphan_breakdown AS
SELECT
    repository,
    COUNT(*) FILTER (WHERE orphan_category = 'pre_merge_on_pr_branch') AS pre_merge_on_pr_branch_count,
    COUNT(*) FILTER (WHERE orphan_category = 'direct_to_protected') AS direct_to_protected_count,
    COUNT(*) FILTER (WHERE orphan_category = 'unlinked_feature_branch') AS unlinked_feature_branch_count,
    COUNT(*) FILTER (WHERE orphan_category IS NOT NULL) AS total_orphans,

    -- Percentage calculations
    CASE
        WHEN COUNT(*) FILTER (WHERE orphan_category IS NOT NULL) > 0
        THEN ROUND(
            (COUNT(*) FILTER (WHERE orphan_category = 'pre_merge_on_pr_branch')::NUMERIC /
             COUNT(*) FILTER (WHERE orphan_category IS NOT NULL)::NUMERIC) * 100,
            1
        )
        ELSE 0
    END AS pre_merge_percentage,

    CASE
        WHEN COUNT(*) FILTER (WHERE orphan_category IS NOT NULL) > 0
        THEN ROUND(
            (COUNT(*) FILTER (WHERE orphan_category = 'direct_to_protected')::NUMERIC /
             COUNT(*) FILTER (WHERE orphan_category IS NOT NULL)::NUMERIC) * 100,
            1
        )
        ELSE 0
    END AS direct_to_protected_percentage,

    CASE
        WHEN COUNT(*) FILTER (WHERE orphan_category IS NOT NULL) > 0
        THEN ROUND(
            (COUNT(*) FILTER (WHERE orphan_category = 'unlinked_feature_branch')::NUMERIC /
             COUNT(*) FILTER (WHERE orphan_category IS NOT NULL)::NUMERIC) * 100,
            1
        )
        ELSE 0
    END AS unlinked_feature_percentage

FROM vw_pr_coverage
GROUP BY repository;

COMMENT ON VIEW vw_pr_coverage_orphan_breakdown IS 'Orphan commit category breakdown by repository: shows counts and percentages for each orphan category (GITX-227).';
