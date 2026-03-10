-- Rollback Migration 012: Code Review Velocity tables and view
-- Ticket: IQS-899

-- Drop view first (depends on tables)
DROP VIEW IF EXISTS vw_code_review_velocity;

-- Drop tables (pull_request_review first due to FK dependency)
DROP TABLE IF EXISTS pull_request_review;
DROP TABLE IF EXISTS pull_request;

-- Indexes are automatically dropped with the tables
