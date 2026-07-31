-- Migration 034: Add Provider Column for Multi-SCM Support
-- Ticket: GITX-228
-- Purpose: Add provider column to support BitBucket in addition to GitHub for PR Coverage Report.
--          Rename github_id to provider_id for consistency across providers.
--
-- Changes:
--   1. Add provider column (github or bitbucket) with default 'github'
--   2. Rename github_id to provider_id in pull_request table
--   3. Update unique constraint to support same pr_number from different providers
--   4. Add index on provider column for filtering
--   5. Update vw_code_review_velocity view to include provider
--   6. Update pull_request_review comments for provider_id rename
--
-- Dependencies:
--   - Migration 012: pull_request and pull_request_review tables
--
-- Backward Compatibility:
--   - DEFAULT 'github' ensures existing data remains valid
--   - Column rename preserves data, only changes name

-- ============================================================================
-- Add provider column to pull_request
-- ============================================================================

ALTER TABLE pull_request
  ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'github';

COMMENT ON COLUMN pull_request.provider IS 'SCM provider: github or bitbucket';

-- ============================================================================
-- Rename github_id to provider_id for multi-provider support
-- ============================================================================

-- Rename in pull_request table (idempotent: only if github_id exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pull_request' AND column_name = 'github_id'
  ) THEN
    ALTER TABLE pull_request RENAME COLUMN github_id TO provider_id;
  END IF;

  -- Add comment on provider_id column (only if column exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pull_request' AND column_name = 'provider_id'
  ) THEN
    COMMENT ON COLUMN pull_request.provider_id IS 'Provider-specific PR ID (GitHub ID or BitBucket ID)';
  END IF;
END $$;

-- Update comment on pull_request_review.github_id to reflect FK target rename
-- Note: FK is to pull_request(id), not github_id, so no FK change needed
-- Wrapped in DO block for idempotency
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pull_request_review' AND column_name = 'github_id'
  ) THEN
    COMMENT ON COLUMN pull_request_review.github_id IS 'Provider-specific review ID (GitHub review ID or BitBucket review ID)';
  END IF;
END $$;

-- ============================================================================
-- Update unique constraint for multi-provider support
-- ============================================================================

-- Drop old constraint (repository, pr_number only)
ALTER TABLE pull_request
  DROP CONSTRAINT IF EXISTS uq_pull_request_repo_number;

-- Create new composite constraint (repository, pr_number, provider)
-- This allows same pr_number from different providers in the same repository
-- Idempotent: use DO block to check if constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'uq_pull_request_repo_pr_provider'
      AND table_name = 'pull_request'
  ) THEN
    ALTER TABLE pull_request
      ADD CONSTRAINT uq_pull_request_repo_pr_provider
        UNIQUE (repository, pr_number, provider);
  END IF;
END $$;

-- ============================================================================
-- Create index on provider column
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_pr_provider ON pull_request(provider);

-- ============================================================================
-- Update vw_code_review_velocity view to include provider
-- DROP and recreate required because we're adding a column in a new position
-- ============================================================================

DROP VIEW IF EXISTS vw_code_review_velocity;

CREATE OR REPLACE VIEW vw_code_review_velocity AS
SELECT
    pr.id,
    pr.repository,
    pr.pr_number,
    pr.provider,  -- NEW: Provider column
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

COMMENT ON VIEW vw_code_review_velocity IS 'Code Review Velocity dashboard view: calculated metrics for PR review times, size categories, and reviewer data. Supports multiple SCM providers (GitHub, BitBucket).';
