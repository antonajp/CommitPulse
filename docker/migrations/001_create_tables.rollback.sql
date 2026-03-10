-- Rollback for Migration 001: Drop all tables
-- Ticket: IQS-850
-- Tables must be dropped in reverse dependency order to satisfy foreign key constraints.

DROP TABLE IF EXISTS jira_github_pullrequest;
DROP TABLE IF EXISTS jira_github_branch;
DROP TABLE IF EXISTS gitja_team_contributor;
DROP TABLE IF EXISTS gitja_pipeline_table_counts;
DROP TABLE IF EXISTS gitr_pipeline_jira;
DROP TABLE IF EXISTS gitr_pipeline_sha;
DROP TABLE IF EXISTS gitr_pipeline_log;
DROP TABLE IF EXISTS gitr_pipeline_run;
DROP TABLE IF EXISTS jira_parent;
DROP TABLE IF EXISTS jira_issue_link;
DROP TABLE IF EXISTS jira_history;
DROP TABLE IF EXISTS commit_jira;
DROP TABLE IF EXISTS commit_branch_relationship;
DROP TABLE IF EXISTS commit_tags;
DROP TABLE IF EXISTS commit_directory;
DROP TABLE IF EXISTS commit_msg_words;
DROP TABLE IF EXISTS commit_files_types;
DROP TABLE IF EXISTS commit_files;
DROP TABLE IF EXISTS jira_detail;
DROP TABLE IF EXISTS commit_history;
DROP TABLE IF EXISTS commit_contributors;
