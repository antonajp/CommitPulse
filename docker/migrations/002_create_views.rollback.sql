-- Rollback for Migration 002: Drop all views
-- Ticket: IQS-850
-- Views must be dropped in reverse dependency order.

DROP VIEW IF EXISTS vw_jira_history_assignments;
DROP VIEW IF EXISTS vw_jira_history_detail;
DROP VIEW IF EXISTS vw_scorecard;
DROP VIEW IF EXISTS vw_scorecard_detail;
DROP VIEW IF EXISTS vw_commit_file_chage_history;
DROP VIEW IF EXISTS vw_technology_stack_complexity;
DROP VIEW IF EXISTS vw_technology_stack_category;
DROP VIEW IF EXISTS vw_unfinished_jira_issues;
DROP VIEW IF EXISTS max_num_count_per_full_name;
DROP VIEW IF EXISTS num_count_per_full_name;
DROP VIEW IF EXISTS max_num_count_per_login;
