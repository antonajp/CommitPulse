-- Rollback Migration 031: PR Coverage Tracking
-- Ticket: GITX-221

-- Drop views in reverse order (dependencies first)
DROP VIEW IF EXISTS vw_pr_coverage_weekly_trend;
DROP VIEW IF EXISTS vw_pr_coverage_by_author;
DROP VIEW IF EXISTS vw_pr_coverage_by_branch;
DROP VIEW IF EXISTS vw_pr_coverage_summary;
DROP VIEW IF EXISTS vw_pr_coverage;

-- Drop indexes
DROP INDEX IF EXISTS idx_cpr_sha;
DROP INDEX IF EXISTS idx_cpr_pr_id;
DROP INDEX IF EXISTS idx_cpr_repository;
DROP INDEX IF EXISTS idx_cpr_created_at;

-- Drop junction table
DROP TABLE IF EXISTS commit_pull_request;
