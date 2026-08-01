-- Migration 035: Add Git Branch Tracking for Dead Branches Report
-- Ticket: GITX-231
-- Purpose: Track branch metadata and enable risk categorization for dead branch detection.
--          Supports branch deletion operations with full audit logging.
--
-- Changes:
--   1. Create git_branch table to track branch metadata and status
--   2. Create git_operation_audit table for security audit logging
--   3. Create vw_dead_branch_summary view with risk categorization
--   4. Add indexes for performance
--
-- Risk Levels:
--   - Safe: Merged AND >90 days old (safe to delete)
--   - Low: Merged <180 days old OR unmerged with open PR
--   - Medium: 90-180 days old, not merged, no open PR
--   - High: Unmerged with open PR OR <90 days old

-- ============================================================================
-- Create git_branch table
-- ============================================================================

CREATE TABLE IF NOT EXISTS git_branch (
  id SERIAL PRIMARY KEY,
  branch_name VARCHAR(255) NOT NULL,
  repository VARCHAR(255) NOT NULL,
  last_commit_sha VARCHAR(40),
  last_commit_date TIMESTAMP,
  last_commit_author VARCHAR(255),
  commit_count INTEGER DEFAULT 0,
  is_merged BOOLEAN DEFAULT FALSE,
  merged_into VARCHAR(255),
  merged_date TIMESTAMP,
  is_orphaned BOOLEAN DEFAULT FALSE,
  has_open_pr BOOLEAN DEFAULT FALSE,
  is_protected BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(repository, branch_name),
  CONSTRAINT chk_git_branch_merged_into CHECK (
    (is_merged = FALSE AND merged_into IS NULL AND merged_date IS NULL) OR
    (is_merged = TRUE)
  ),
  CONSTRAINT chk_git_branch_deleted CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL) OR
    (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
  )
);

COMMENT ON TABLE git_branch IS 'Branch metadata tracking table for dead branch detection and cleanup operations.';
COMMENT ON COLUMN git_branch.branch_name IS 'Full branch name (e.g., feature/GITX-231)';
COMMENT ON COLUMN git_branch.repository IS 'Repository name matching commit_history.repository';
COMMENT ON COLUMN git_branch.last_commit_sha IS 'SHA of most recent commit on this branch';
COMMENT ON COLUMN git_branch.last_commit_date IS 'Date of most recent commit (used for staleness calculation)';
COMMENT ON COLUMN git_branch.last_commit_author IS 'Author of most recent commit';
COMMENT ON COLUMN git_branch.commit_count IS 'Total number of commits on this branch';
COMMENT ON COLUMN git_branch.is_merged IS 'Whether branch has been merged into another branch';
COMMENT ON COLUMN git_branch.merged_into IS 'Target branch this was merged into (e.g., main)';
COMMENT ON COLUMN git_branch.merged_date IS 'Date when branch was merged';
COMMENT ON COLUMN git_branch.is_orphaned IS 'Whether branch has no parent (detached HEAD state)';
COMMENT ON COLUMN git_branch.has_open_pr IS 'Whether branch has an open pull request (risk downgrade)';
COMMENT ON COLUMN git_branch.is_protected IS 'Whether branch is protected (main, develop, etc.) - excludes from dead branch report';
COMMENT ON COLUMN git_branch.deleted_at IS 'Timestamp when branch was deleted (soft delete)';
COMMENT ON COLUMN git_branch.deleted_by IS 'User who deleted the branch (audit trail)';
COMMENT ON COLUMN git_branch.created_at IS 'Timestamp when branch record was first created';
COMMENT ON COLUMN git_branch.updated_at IS 'Timestamp when branch record was last updated';

-- ============================================================================
-- Create git_operation_audit table
-- ============================================================================

CREATE TABLE IF NOT EXISTS git_operation_audit (
  id SERIAL PRIMARY KEY,
  operation_type VARCHAR(50) NOT NULL,
  repository VARCHAR(255) NOT NULL,
  branch_name VARCHAR(255),
  branch_sha VARCHAR(40),
  operator VARCHAR(255),
  result VARCHAR(20) NOT NULL,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_operation_type CHECK (
    operation_type IN ('branch_delete', 'branch_batch_delete', 'branch_restore')
  ),
  CONSTRAINT chk_result CHECK (
    result IN ('success', 'failed', 'rejected')
  )
);

COMMENT ON TABLE git_operation_audit IS 'Audit log for all destructive Git operations (branch deletions, batch operations).';
COMMENT ON COLUMN git_operation_audit.operation_type IS 'Type of operation: branch_delete, branch_batch_delete, branch_restore';
COMMENT ON COLUMN git_operation_audit.repository IS 'Repository name where operation occurred';
COMMENT ON COLUMN git_operation_audit.branch_name IS 'Branch name affected by operation';
COMMENT ON COLUMN git_operation_audit.branch_sha IS 'SHA of branch tip at operation time (for restore operations)';
COMMENT ON COLUMN git_operation_audit.operator IS 'User who initiated the operation';
COMMENT ON COLUMN git_operation_audit.result IS 'Operation result: success, failed, rejected';
COMMENT ON COLUMN git_operation_audit.error_message IS 'Error details if operation failed';
COMMENT ON COLUMN git_operation_audit.metadata IS 'Additional context (risk level, batch size, confirmation method, etc.)';
COMMENT ON COLUMN git_operation_audit.created_at IS 'Timestamp when operation occurred';

-- ============================================================================
-- Create vw_dead_branch_summary view
-- ============================================================================

CREATE OR REPLACE VIEW vw_dead_branch_summary AS
SELECT
  gb.id,
  gb.branch_name,
  gb.repository,
  gb.last_commit_date,
  gb.last_commit_author,
  gb.last_commit_sha,
  gb.commit_count,
  gb.is_merged,
  gb.merged_into,
  gb.is_orphaned,
  gb.has_open_pr,
  gb.is_protected,
  gb.created_at,
  gb.updated_at,

  -- Days since last commit (for UI display and filtering)
  EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - gb.last_commit_date)) / 86400 AS days_since_last_commit,

  -- Status: merged, stale, orphaned, active
  CASE
    WHEN gb.is_merged THEN 'merged'
    WHEN gb.is_orphaned THEN 'orphaned'
    WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - gb.last_commit_date)) / 86400 > 90 THEN 'stale'
    ELSE 'active'
  END AS status,

  -- Risk level calculation per GITX-231 requirements
  -- Safe: Merged AND >90 days old (safe to delete)
  -- Low: Merged <180 days old OR unmerged with open PR
  -- Medium: 90-180 days old, not merged, no open PR
  -- High: Unmerged with open PR OR <90 days old
  CASE
    -- Safe: Merged AND >90 days old
    WHEN gb.is_merged AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - gb.last_commit_date)) / 86400 > 90 THEN 'safe'

    -- Low: Merged <180 days old
    WHEN gb.is_merged AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - gb.last_commit_date)) / 86400 <= 180 THEN 'low'

    -- Medium: 90-180 days old, not merged, no open PR (downgrade to low if open PR)
    WHEN NOT gb.is_merged
         AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - gb.last_commit_date)) / 86400 BETWEEN 90 AND 180
    THEN
      CASE WHEN gb.has_open_pr THEN 'low' ELSE 'medium' END

    -- High: Unmerged with open PR OR <90 days
    WHEN NOT gb.is_merged
         AND (gb.has_open_pr OR EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - gb.last_commit_date)) / 86400 < 90)
    THEN 'high'

    ELSE 'medium'
  END AS risk_level

FROM git_branch gb
WHERE gb.deleted_at IS NULL
  AND NOT gb.is_protected;

COMMENT ON VIEW vw_dead_branch_summary IS 'Dead branch analysis view with risk categorization (safe, low, medium, high) based on merge status, age, and PR status. Excludes protected branches and deleted branches.';

-- ============================================================================
-- Create indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_git_branch_repository
  ON git_branch(repository);

CREATE INDEX IF NOT EXISTS idx_git_branch_status
  ON git_branch(is_merged, is_orphaned);

CREATE INDEX IF NOT EXISTS idx_git_branch_last_commit
  ON git_branch(last_commit_date);

CREATE INDEX IF NOT EXISTS idx_git_branch_deleted
  ON git_branch(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_git_branch_protected
  ON git_branch(is_protected) WHERE is_protected = TRUE;

CREATE INDEX IF NOT EXISTS idx_git_operation_audit_created
  ON git_operation_audit(created_at);

CREATE INDEX IF NOT EXISTS idx_git_operation_audit_repo
  ON git_operation_audit(repository);

CREATE INDEX IF NOT EXISTS idx_git_operation_audit_type
  ON git_operation_audit(operation_type);

CREATE INDEX IF NOT EXISTS idx_git_operation_audit_result
  ON git_operation_audit(result);

-- ============================================================================
-- Insert protected branches for common patterns
-- ============================================================================

-- Note: This is illustrative - the extension will dynamically detect protected
-- branches using the Git provider API and upsert them. This migration provides
-- the schema foundation.

-- Example (commented out - runtime handles this):
-- INSERT INTO git_branch (branch_name, repository, is_protected)
-- VALUES ('main', 'gitr', TRUE), ('develop', 'gitr', TRUE)
-- ON CONFLICT (repository, branch_name) DO NOTHING;
