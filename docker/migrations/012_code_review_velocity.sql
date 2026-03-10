-- Migration 012: Code Review Velocity tables and view
-- Ticket: IQS-899
-- Purpose: Track PR metadata and review events for Code Review Velocity dashboard
--          answering "Where are PRs getting stuck in review?"
--
-- Design:
--   - pull_request: PR metadata from GitHub API (title, author, state, timestamps)
--   - pull_request_review: Review events (approved, changes_requested, commented)
--   - vw_code_review_velocity: Calculated metrics (time to first review, time to merge)
--
-- Key metrics:
--   1. Hours to first review (created_at -> first_review_at)
--   2. Hours to merge (created_at -> merged_at)
--   3. Hours review to merge (first_review_at -> merged_at)
--   4. Review cycles (count of CHANGES_REQUESTED events)
--   5. Size category (XS/S/M/L/XL based on lines changed)

-- ============================================================================
-- Pull Request table
-- ============================================================================

CREATE TABLE IF NOT EXISTS pull_request (
    id SERIAL PRIMARY KEY,
    repository VARCHAR(255) NOT NULL,
    pr_number INTEGER NOT NULL,
    github_id BIGINT,
    title TEXT NOT NULL,
    author VARCHAR(255) NOT NULL,
    state VARCHAR(50) NOT NULL, -- open, closed, merged
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE,
    first_review_at TIMESTAMP WITH TIME ZONE,
    merged_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    merge_sha VARCHAR(40),
    head_branch VARCHAR(255),
    base_branch VARCHAR(255),
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    changed_files INTEGER NOT NULL DEFAULT 0,
    review_cycles INTEGER NOT NULL DEFAULT 0,
    linked_ticket_id VARCHAR(50),
    linked_ticket_type VARCHAR(10), -- jira, linear
    CONSTRAINT uq_pull_request_repo_number UNIQUE (repository, pr_number)
);

COMMENT ON TABLE pull_request IS 'Pull request metadata from GitHub API. Tracks PR lifecycle for Code Review Velocity dashboard.';
COMMENT ON COLUMN pull_request.repository IS 'Repository name in format owner/repo';
COMMENT ON COLUMN pull_request.pr_number IS 'GitHub PR number';
COMMENT ON COLUMN pull_request.github_id IS 'GitHub internal PR ID';
COMMENT ON COLUMN pull_request.state IS 'PR state: open, closed, or merged';
COMMENT ON COLUMN pull_request.first_review_at IS 'Timestamp of first review event';
COMMENT ON COLUMN pull_request.review_cycles IS 'Count of CHANGES_REQUESTED review events';
COMMENT ON COLUMN pull_request.linked_ticket_id IS 'Extracted ticket ID from branch name';
COMMENT ON COLUMN pull_request.linked_ticket_type IS 'Ticket system: jira or linear';

-- ============================================================================
-- Pull Request Review table
-- ============================================================================

CREATE TABLE IF NOT EXISTS pull_request_review (
    id SERIAL PRIMARY KEY,
    pull_request_id INTEGER NOT NULL REFERENCES pull_request(id) ON DELETE CASCADE,
    github_id BIGINT,
    reviewer VARCHAR(255) NOT NULL,
    state VARCHAR(50) NOT NULL, -- approved, changes_requested, commented, dismissed
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    body TEXT,
    CONSTRAINT uq_pr_review_github_id UNIQUE (github_id)
);

COMMENT ON TABLE pull_request_review IS 'PR review events from GitHub API. Tracks review activity for velocity metrics.';
COMMENT ON COLUMN pull_request_review.pull_request_id IS 'Foreign key to pull_request table';
COMMENT ON COLUMN pull_request_review.state IS 'Review state: approved, changes_requested, commented, dismissed';
COMMENT ON COLUMN pull_request_review.submitted_at IS 'When the review was submitted';

-- ============================================================================
-- Performance indexes
-- ============================================================================

-- pull_request indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_pr_created_at ON pull_request(created_at);
CREATE INDEX IF NOT EXISTS idx_pr_repository ON pull_request(repository);
CREATE INDEX IF NOT EXISTS idx_pr_author ON pull_request(author);
CREATE INDEX IF NOT EXISTS idx_pr_state ON pull_request(state);
CREATE INDEX IF NOT EXISTS idx_pr_merged_at ON pull_request(merged_at);
CREATE INDEX IF NOT EXISTS idx_pr_base_branch ON pull_request(base_branch);

-- pull_request_review indexes
CREATE INDEX IF NOT EXISTS idx_pr_review_pull_request_id ON pull_request_review(pull_request_id);
CREATE INDEX IF NOT EXISTS idx_pr_review_reviewer ON pull_request_review(reviewer);
CREATE INDEX IF NOT EXISTS idx_pr_review_submitted_at ON pull_request_review(submitted_at);
CREATE INDEX IF NOT EXISTS idx_pr_review_state ON pull_request_review(state);

-- ============================================================================
-- Code Review Velocity View
-- ============================================================================

CREATE OR REPLACE VIEW vw_code_review_velocity AS
SELECT
    pr.id,
    pr.repository,
    pr.pr_number,
    pr.title,
    pr.author,
    pr.state,
    pr.created_at,
    pr.updated_at,
    pr.first_review_at,
    pr.merged_at,
    pr.closed_at,
    pr.head_branch,
    pr.base_branch,
    pr.additions,
    pr.deletions,
    pr.additions + pr.deletions AS loc_changed,
    pr.changed_files,
    pr.review_cycles,
    pr.linked_ticket_id,
    pr.linked_ticket_type,

    -- Calculated metrics (in hours)
    CASE
        WHEN pr.first_review_at IS NOT NULL AND pr.created_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (pr.first_review_at - pr.created_at)) / 3600.0
        ELSE NULL
    END AS hours_to_first_review,

    CASE
        WHEN pr.merged_at IS NOT NULL AND pr.created_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (pr.merged_at - pr.created_at)) / 3600.0
        ELSE NULL
    END AS hours_to_merge,

    CASE
        WHEN pr.merged_at IS NOT NULL AND pr.first_review_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (pr.merged_at - pr.first_review_at)) / 3600.0
        ELSE NULL
    END AS hours_review_to_merge,

    -- Size category based on total lines changed
    CASE
        WHEN pr.additions + pr.deletions < 50 THEN 'XS'
        WHEN pr.additions + pr.deletions < 200 THEN 'S'
        WHEN pr.additions + pr.deletions < 500 THEN 'M'
        WHEN pr.additions + pr.deletions < 1000 THEN 'L'
        ELSE 'XL'
    END AS size_category,

    -- First reviewer (subquery for the earliest review)
    (
        SELECT prr.reviewer
        FROM pull_request_review prr
        WHERE prr.pull_request_id = pr.id
        ORDER BY prr.submitted_at ASC
        LIMIT 1
    ) AS first_reviewer

FROM pull_request pr;

COMMENT ON VIEW vw_code_review_velocity IS 'Code Review Velocity dashboard view: calculated metrics for PR review times, size categories, and reviewer data.';
