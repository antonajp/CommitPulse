-- Migration 030: Create Organizations and Teams Tables
-- Ticket: GITX-202
-- Purpose: Create normalized organizations and teams tables for proper
--          team-organization relationship modeling
--
-- Design:
--   - organizations: id (SERIAL PK), name (VARCHAR 100 UNIQUE NOT NULL), created_at, updated_at
--   - teams: id (SERIAL PK), name (VARCHAR 100 UNIQUE NOT NULL), organization_id (FK nullable), created_at, updated_at
--   - Foreign key: teams.organization_id REFERENCES organizations(id) ON DELETE SET NULL
--   - Index: idx_teams_organization_id on teams.organization_id
--   - Migrate existing team names from commit_contributors.team into teams table
--   - Add team_id column to commit_contributors as nullable FK to teams.id
--   - Backfill commit_contributors.team_id from existing team column values
--   - Keep original team column for backward compatibility (deprecate later)
--
-- All operations use IF NOT EXISTS / IF EXISTS guards for idempotency.

-- ============================================================================
-- Create Organizations Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE organizations IS 'Normalized organizations table for team-organization relationship modeling. Ticket: GITX-202';
COMMENT ON COLUMN organizations.id IS 'Auto-incrementing primary key';
COMMENT ON COLUMN organizations.name IS 'Organization name (max 100 chars, unique)';
COMMENT ON COLUMN organizations.created_at IS 'Record creation timestamp';
COMMENT ON COLUMN organizations.updated_at IS 'Record last update timestamp';

-- ============================================================================
-- Create Teams Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE teams IS 'Normalized teams table for team-organization relationship modeling. Ticket: GITX-202';
COMMENT ON COLUMN teams.id IS 'Auto-incrementing primary key';
COMMENT ON COLUMN teams.name IS 'Team name (max 100 chars, unique)';
COMMENT ON COLUMN teams.organization_id IS 'Foreign key to organizations table (nullable)';
COMMENT ON COLUMN teams.created_at IS 'Record creation timestamp';
COMMENT ON COLUMN teams.updated_at IS 'Record last update timestamp';

-- ============================================================================
-- Create Index on teams.organization_id
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_teams_organization_id ON teams(organization_id);

-- ============================================================================
-- Migrate Existing Team Names from commit_contributors.team into teams table
-- ============================================================================

-- Insert distinct team names from commit_contributors.team into teams table
-- Uses ON CONFLICT DO NOTHING to handle idempotency (safe to run multiple times)
INSERT INTO teams (name)
SELECT DISTINCT team
FROM commit_contributors
WHERE team IS NOT NULL AND team <> ''
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- Add team_id Column to commit_contributors
-- ============================================================================

-- Add team_id column as nullable FK to teams.id
ALTER TABLE commit_contributors
ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;

COMMENT ON COLUMN commit_contributors.team_id IS 'Foreign key to teams table. Replaces team column (deprecated). Ticket: GITX-202';

-- Create index on team_id for efficient joins
CREATE INDEX IF NOT EXISTS idx_commit_contributors_team_id ON commit_contributors(team_id);

-- ============================================================================
-- Backfill commit_contributors.team_id from existing team column values
-- ============================================================================

-- Update team_id based on team name lookup
-- Only updates rows where team_id is NULL and team is not NULL/empty
-- This ensures idempotency - already backfilled rows are not modified
UPDATE commit_contributors cc
SET team_id = t.id
FROM teams t
WHERE cc.team = t.name
  AND cc.team_id IS NULL
  AND cc.team IS NOT NULL
  AND cc.team <> '';

-- ============================================================================
-- Note: Original team column is kept for backward compatibility
-- ============================================================================
-- The team column in commit_contributors is preserved and will be deprecated later.
-- New code should use team_id FK instead.
-- To be removed in a future migration after all dependent code is updated.
