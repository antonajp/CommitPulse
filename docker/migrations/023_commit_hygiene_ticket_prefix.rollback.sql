-- Rollback Migration 023: Remove ticket prefix detection enhancements
-- Ticket: IQS-939
-- This restores the original vw_commit_hygiene views from migration 020

-- Drop enhanced views
DROP VIEW IF EXISTS vw_commit_hygiene_weekly CASCADE;
DROP VIEW IF EXISTS vw_commit_hygiene_by_author CASCADE;
DROP VIEW IF EXISTS vw_commit_hygiene CASCADE;

-- Restore original views from migration 020
-- Note: Re-run migration 020 after this rollback to restore original views
