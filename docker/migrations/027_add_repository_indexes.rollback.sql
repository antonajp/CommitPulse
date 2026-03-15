-- Rollback Migration 027: Remove repository indexes
-- Ticket: GITX-1
-- Purpose: Rollback the repository indexes added for multi-repo extraction performance.
--
-- CAUTION: Rolling back these indexes will degrade multi-repo extraction performance.
-- Only rollback if the indexes cause unexpected issues.

-- ============================================================================
-- Remove composite index on (repository, commit_date DESC)
-- ============================================================================
DROP INDEX IF EXISTS idx_commit_history_repository_commit_date;

-- ============================================================================
-- Remove index on repository column
-- ============================================================================
DROP INDEX IF EXISTS idx_commit_history_repository;
