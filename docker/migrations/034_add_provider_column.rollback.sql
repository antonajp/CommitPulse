-- Rollback Migration 034: Remove provider column and revert github_id rename
-- Ticket: GITX-228

-- ============================================================================
-- Drop provider index
-- ============================================================================

DROP INDEX IF EXISTS idx_pr_provider;

-- ============================================================================
-- Restore original unique constraint
-- ============================================================================

-- Drop multi-provider constraint
ALTER TABLE pull_request
  DROP CONSTRAINT IF EXISTS uq_pull_request_repo_pr_provider;

-- Restore original constraint (repository, pr_number only)
ALTER TABLE pull_request
  ADD CONSTRAINT uq_pull_request_repo_number
    UNIQUE (repository, pr_number);

-- ============================================================================
-- Rename provider_id back to github_id
-- ============================================================================

ALTER TABLE pull_request
  RENAME COLUMN provider_id TO github_id;

COMMENT ON COLUMN pull_request.github_id IS 'GitHub internal PR ID';

-- Restore original comment on pull_request_review.github_id
COMMENT ON COLUMN pull_request_review.github_id IS 'GitHub internal review ID';

-- ============================================================================
-- Drop provider column
-- ============================================================================

ALTER TABLE pull_request
  DROP COLUMN IF EXISTS provider;

-- ============================================================================
-- Restore original vw_code_review_velocity view (without provider)
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
