-- Migration 031: PR Coverage Tracking tables and views
-- Ticket: GITX-221
-- Purpose: Track commit-to-PR correlation for PR Coverage Report dashboard
--          answering "Which commits bypassed the pull request workflow?"
--
-- Design:
--   - commit_pull_request: Junction table linking commits to PRs
--   - vw_pr_coverage: Shows PR-linked vs orphan commits
--   - vw_pr_coverage_summary: Aggregated coverage metrics
--   - vw_pr_coverage_by_branch: Coverage breakdown by branch
--   - vw_pr_coverage_by_author: Coverage breakdown by author
--
-- Key metrics:
--   1. PR coverage percentage: (PR-linked commits / total commits) * 100
--   2. Orphan commits: Commits without associated PRs
--   3. Coverage trends over time (weekly aggregation)
--
-- Dependencies:
--   - Migration 001: commit_history table
--   - Migration 012: pull_request table

-- ============================================================================
-- Commit-Pull Request Junction Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS commit_pull_request (
    id SERIAL PRIMARY KEY,
    sha VARCHAR(40) NOT NULL,
    pull_request_id INTEGER NOT NULL,
    repository VARCHAR(255) NOT NULL,
    link_source VARCHAR(50) NOT NULL DEFAULT 'merge_sha', -- merge_sha, pr_commits, manual
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_commit_pr_sha_pr UNIQUE (sha, pull_request_id),
    CONSTRAINT fk_cpr_sha FOREIGN KEY (sha) REFERENCES commit_history(sha) ON DELETE CASCADE,
    CONSTRAINT fk_cpr_pr FOREIGN KEY (pull_request_id) REFERENCES pull_request(id) ON DELETE CASCADE
);

COMMENT ON TABLE commit_pull_request IS 'Junction table linking commits to pull requests. Tracks which commits were introduced via PRs.';
COMMENT ON COLUMN commit_pull_request.sha IS 'Commit SHA from commit_history';
COMMENT ON COLUMN commit_pull_request.pull_request_id IS 'Foreign key to pull_request table';
COMMENT ON COLUMN commit_pull_request.repository IS 'Repository name for denormalized queries';
COMMENT ON COLUMN commit_pull_request.link_source IS 'How the link was established: merge_sha (PR merge commit), pr_commits (GitHub PR commits API), manual (user-created)';

-- ============================================================================
-- Performance indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cpr_sha ON commit_pull_request(sha);
CREATE INDEX IF NOT EXISTS idx_cpr_pr_id ON commit_pull_request(pull_request_id);
CREATE INDEX IF NOT EXISTS idx_cpr_repository ON commit_pull_request(repository);
CREATE INDEX IF NOT EXISTS idx_cpr_created_at ON commit_pull_request(created_at);

-- ============================================================================
-- PR Coverage View - Shows commit-level PR linkage status
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

-- ============================================================================
-- PR Coverage Summary View - Aggregated metrics
-- ============================================================================

CREATE OR REPLACE VIEW vw_pr_coverage_summary AS
SELECT
    repository,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'merge_commit') AS merge_commits,

    -- Coverage percentage (excluding merge commits from calculation)
    CASE
        WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
        THEN ROUND(
            (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
             COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
            2
        )
        ELSE 0
    END AS coverage_percentage

FROM vw_pr_coverage
GROUP BY repository;

COMMENT ON VIEW vw_pr_coverage_summary IS 'PR Coverage summary metrics by repository: total commits, PR-linked commits, orphan commits, and coverage percentage.';

-- ============================================================================
-- PR Coverage by Branch View
-- ============================================================================

CREATE OR REPLACE VIEW vw_pr_coverage_by_branch AS
SELECT
    repository,
    branch,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,

    -- Coverage percentage for this branch
    CASE
        WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
        THEN ROUND(
            (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
             COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
            2
        )
        ELSE 0
    END AS coverage_percentage

FROM vw_pr_coverage
GROUP BY repository, branch
ORDER BY repository, total_commits DESC;

COMMENT ON VIEW vw_pr_coverage_by_branch IS 'PR Coverage breakdown by branch: shows coverage metrics for each branch in each repository.';

-- ============================================================================
-- PR Coverage by Author View
-- ============================================================================

CREATE OR REPLACE VIEW vw_pr_coverage_by_author AS
SELECT
    repository,
    author,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,

    -- Coverage percentage for this author
    CASE
        WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
        THEN ROUND(
            (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
             COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
            2
        )
        ELSE 0
    END AS coverage_percentage

FROM vw_pr_coverage
GROUP BY repository, author
ORDER BY repository, total_commits DESC;

COMMENT ON VIEW vw_pr_coverage_by_author IS 'PR Coverage breakdown by author: shows coverage metrics for each contributor in each repository.';

-- ============================================================================
-- PR Coverage Weekly Trend View
-- ============================================================================

CREATE OR REPLACE VIEW vw_pr_coverage_weekly_trend AS
SELECT
    repository,
    DATE_TRUNC('week', commit_date)::DATE AS week_start,
    COUNT(*) FILTER (WHERE is_merge = false) AS total_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'pr_linked') AS pr_linked_commits,
    COUNT(*) FILTER (WHERE coverage_status = 'orphan') AS orphan_commits,

    -- Coverage percentage for this week
    CASE
        WHEN COUNT(*) FILTER (WHERE is_merge = false) > 0
        THEN ROUND(
            (COUNT(*) FILTER (WHERE coverage_status = 'pr_linked')::NUMERIC /
             COUNT(*) FILTER (WHERE is_merge = false)::NUMERIC) * 100,
            2
        )
        ELSE 0
    END AS coverage_percentage

FROM vw_pr_coverage
WHERE commit_date IS NOT NULL
GROUP BY repository, DATE_TRUNC('week', commit_date)
ORDER BY repository, week_start DESC;

COMMENT ON VIEW vw_pr_coverage_weekly_trend IS 'PR Coverage trend by week: shows weekly coverage metrics for trend analysis.';
