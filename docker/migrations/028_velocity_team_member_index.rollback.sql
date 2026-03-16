-- Rollback Migration 028: Remove velocity team member filtering indexes
-- Ticket: GITX-121

DROP INDEX IF EXISTS idx_commit_contributors_team;
DROP INDEX IF EXISTS idx_commit_contributors_login;
