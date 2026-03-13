-- Rollback Migration 024: Remove Contributor Profile Percentile Rankings
-- Ticket: IQS-942
-- This removes the vw_scorecard_percentiles view created in migration 024

-- Drop the percentile rankings view
DROP VIEW IF EXISTS vw_scorecard_percentiles CASCADE;
