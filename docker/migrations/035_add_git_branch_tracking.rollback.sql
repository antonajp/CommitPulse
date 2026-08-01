-- Rollback Migration 035: Remove Git Branch Tracking
-- Ticket: GITX-231

-- ============================================================================
-- Drop indexes
-- ============================================================================

DROP INDEX IF EXISTS idx_git_operation_audit_result;
DROP INDEX IF EXISTS idx_git_operation_audit_type;
DROP INDEX IF EXISTS idx_git_operation_audit_repo;
DROP INDEX IF EXISTS idx_git_operation_audit_created;
DROP INDEX IF EXISTS idx_git_branch_protected;
DROP INDEX IF EXISTS idx_git_branch_deleted;
DROP INDEX IF EXISTS idx_git_branch_last_commit;
DROP INDEX IF EXISTS idx_git_branch_status;
DROP INDEX IF EXISTS idx_git_branch_repository;

-- ============================================================================
-- Drop view
-- ============================================================================

DROP VIEW IF EXISTS vw_dead_branch_summary;

-- ============================================================================
-- Drop tables
-- ============================================================================

DROP TABLE IF EXISTS git_operation_audit;
DROP TABLE IF EXISTS git_branch;
