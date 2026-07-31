-- Rollback Migration 030: Remove Organizations and Teams Tables
-- Ticket: GITX-202
--
-- This rollback removes the organizations and teams tables and the team_id column
-- from commit_contributors. The original team column is preserved.
--
-- Safe to run multiple times (uses IF EXISTS guards).

-- ============================================================================
-- Drop Dependent Views from Migration 032 (GITX-223)
-- ============================================================================
-- These views depend on team_id column and must be dropped before removing it

DROP VIEW IF EXISTS vw_pr_coverage_by_team CASCADE;
DROP VIEW IF EXISTS vw_pr_coverage_by_contributor CASCADE;
DROP VIEW IF EXISTS vw_pr_coverage CASCADE;

-- ============================================================================
-- Remove team_id Column from commit_contributors
-- ============================================================================

-- Drop index first
DROP INDEX IF EXISTS idx_commit_contributors_team_id;

-- Drop the team_id column
-- Note: This preserves the original team column for backward compatibility
ALTER TABLE commit_contributors
DROP COLUMN IF EXISTS team_id;

-- ============================================================================
-- Drop Teams Table
-- ============================================================================

-- Drop index first
DROP INDEX IF EXISTS idx_teams_organization_id;

-- Drop the teams table
DROP TABLE IF EXISTS teams;

-- ============================================================================
-- Drop Organizations Table
-- ============================================================================

DROP TABLE IF EXISTS organizations;
