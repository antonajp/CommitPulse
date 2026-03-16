-- Migration 028: Add index for velocity team member filtering
-- Ticket: GITX-121
--
-- Creates index on commit_contributors.team to optimize:
-- - GITX-121: Team filter queries in Sprint Velocity vs LOC chart
-- - Queries that join commit_contributors with commit_history for team member filtering
--
-- Also adds index on commit_contributors.login for faster contributor lookups.

-- Index on team for team filter performance
CREATE INDEX IF NOT EXISTS idx_commit_contributors_team
  ON commit_contributors (team)
  WHERE team IS NOT NULL;

-- Index on login for team member filter performance
CREATE INDEX IF NOT EXISTS idx_commit_contributors_login
  ON commit_contributors (login)
  WHERE login IS NOT NULL;
