-- Migration 027: Add repository indexes for multi-repo extraction performance
-- Ticket: GITX-1
-- Purpose: Fix multi-repo extraction issues where only one repo extracts commits
--          and subsequent incremental runs fail to find new commits.
--
-- Root Cause Analysis:
--   1. Missing index on repository column causes full table scans in getKnownShasForRepo()
--   2. Per-repo queries timeout or perform poorly without indexed lookups
--   3. Incremental watermark queries need efficient date-based lookups per repository
--
-- Fix:
--   Add two indexes to commit_history table:
--   - idx_commit_history_repository: B-tree index on repository for WHERE clauses
--   - idx_commit_history_repository_commit_date: Composite index for MAX(commit_date) queries
--
-- Expected Result:
--   - getKnownShasForRepo() performs fast indexed lookups
--   - getLastCommitDateForRepo() can efficiently find latest commit per repo
--   - Multi-repo extraction processes each repo independently without state leakage

-- ============================================================================
-- Add index on repository column for efficient per-repo SHA lookups
-- ============================================================================
-- Used by: getKnownShasForRepo(), getKnownCommitBranchRelationships(),
--          identifyUnknownCommitAuthors()
CREATE INDEX IF NOT EXISTS idx_commit_history_repository
ON commit_history(repository);

COMMENT ON INDEX idx_commit_history_repository IS 'B-tree index for per-repository queries. GITX-1: Fixes multi-repo extraction by enabling fast SHA lookups per repository.';

-- ============================================================================
-- Add composite index on (repository, commit_date DESC) for watermark queries
-- ============================================================================
-- Used by: getLastCommitDateForRepo() - finds MAX(commit_date) for incremental extraction
-- DESC ordering optimizes MAX() queries by placing newest commits first in index
CREATE INDEX IF NOT EXISTS idx_commit_history_repository_commit_date
ON commit_history(repository, commit_date DESC);

COMMENT ON INDEX idx_commit_history_repository_commit_date IS 'Composite index for per-repo watermark queries (MAX commit_date). GITX-1: Enables efficient incremental extraction by finding latest commit date per repository.';
