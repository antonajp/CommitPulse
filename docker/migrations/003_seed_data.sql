-- Migration 003: Seed data for gitrx schema
-- Ported from legacy/sql/createCommitHistory.sql
-- Ticket: IQS-850
--
-- Initial pipeline_run row for database logging bootstrap.
-- Uses a conditional insert to ensure idempotency.

-- Insert the initial pipeline_run row only if the table is empty.
-- This prevents duplicate seed rows on repeated migrations.
INSERT INTO gitr_pipeline_run (class_name, context, detail, start_time)
SELECT 'PostgresDB', 'Db internal logging function', 'initializing db for logging', NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM gitr_pipeline_run WHERE class_name = 'PostgresDB' AND context = 'Db internal logging function'
);
