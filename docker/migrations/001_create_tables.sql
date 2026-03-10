-- Migration 001: Create all tables for gitrx schema
-- Ported from legacy/sql/createCommitHistory.sql
-- Ticket: IQS-850
--
-- All tables use IF NOT EXISTS guards for idempotency.
-- Foreign key constraints and primary keys preserved exactly from legacy schema.

-- ============================================================================
-- Core commit tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS commit_contributors (
    login TEXT PRIMARY KEY,
    username TEXT,
    email TEXT,
    bio TEXT,
    user_location TEXT,
    public_repos TEXT,
    followers TEXT,
    following_users TEXT,
    vendor TEXT,
    repo TEXT,
    team TEXT,
    full_name TEXT,
    jira_name TEXT NULL,
    is_company_account BOOLEAN NULL
);

CREATE TABLE IF NOT EXISTS commit_history (
    sha TEXT PRIMARY KEY,
    url TEXT,
    branch TEXT,
    repository TEXT,
    repository_url TEXT,
    author TEXT,
    commit_date TIMESTAMP WITH TIME ZONE,
    commit_message TEXT,
    file_count INT,
    lines_added INT,
    lines_removed INT,
    is_merge BOOLEAN,
    is_jira_ref BOOLEAN,
    organization TEXT
);

CREATE TABLE IF NOT EXISTS commit_files (
    sha TEXT,
    filename TEXT,
    file_extension TEXT,
    line_inserts INT,
    line_deletes INT,
    line_diff INT,
    total_lines INT,
    total_code_lines INT,
    total_comment_lines INT,
    complexity INT,
    weighted_complexity INT,
    author TEXT,
    parent_directory TEXT,
    sub_directory TEXT,
    is_test_file BOOLEAN,
    complexity_change INT4 NULL,
    comments_change INT4 NULL,
    code_change INT4 NULL,
    PRIMARY KEY (sha, filename),
    CONSTRAINT fk_sha_files
        FOREIGN KEY (sha)
        REFERENCES commit_history (sha)
);

CREATE TABLE IF NOT EXISTS commit_files_types (
    sha TEXT,
    file_extension TEXT,
    num_count INT,
    author TEXT,
    parent_directory TEXT,
    sub_directory TEXT,
    PRIMARY KEY (sha, file_extension, parent_directory, sub_directory),
    CONSTRAINT fk_sha_file_types
        FOREIGN KEY (sha)
        REFERENCES commit_history (sha)
);

CREATE TABLE IF NOT EXISTS commit_msg_words (
    sha TEXT,
    word TEXT,
    author TEXT,
    CONSTRAINT fk_sha_words
        FOREIGN KEY (sha)
        REFERENCES commit_history (sha)
);

CREATE TABLE IF NOT EXISTS commit_directory (
    sha TEXT,
    directory TEXT,
    subdirectory TEXT,
    author TEXT,
    PRIMARY KEY (sha, directory, subdirectory),
    CONSTRAINT fk_sha_directory
        FOREIGN KEY (sha)
        REFERENCES commit_history (sha)
);

CREATE TABLE IF NOT EXISTS commit_tags (
    sha TEXT,
    tag TEXT,
    author TEXT,
    CONSTRAINT fk_sha_tags
        FOREIGN KEY (sha)
        REFERENCES commit_history (sha)
);

CREATE TABLE IF NOT EXISTS commit_branch_relationship (
    sha TEXT,
    branch TEXT,
    author TEXT,
    commit_date TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (sha, branch),
    CONSTRAINT fk_sha_branch_relationship
        FOREIGN KEY (sha)
        REFERENCES commit_history (sha)
);

CREATE TABLE IF NOT EXISTS commit_jira (
    sha TEXT,
    jira_key TEXT,
    author TEXT,
    jira_project TEXT,
    PRIMARY KEY (sha, jira_key),
    CONSTRAINT fk_sha_jira
        FOREIGN KEY (sha)
        REFERENCES commit_history (sha)
);

-- ============================================================================
-- Jira tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS jira_detail (
    jira_id TEXT,
    jira_key TEXT PRIMARY KEY,
    priority TEXT,
    created_date TIMESTAMP WITH TIME ZONE,
    url TEXT,
    summary TEXT,
    description TEXT,
    reporter TEXT,
    issuetype TEXT,
    project TEXT,
    resolution TEXT,
    assignee TEXT,
    status TEXT,
    fixversion TEXT,
    component TEXT,
    status_change_date TIMESTAMP WITH TIME ZONE,
    points DECIMAL
);

CREATE TABLE IF NOT EXISTS jira_history (
    jira_key TEXT,
    change_date TIMESTAMP WITH TIME ZONE,
    assignee TEXT,
    field TEXT,
    from_value TEXT,
    to_value TEXT,
    CONSTRAINT fk_jira_history
        FOREIGN KEY (jira_key)
        REFERENCES jira_detail (jira_key)
);

CREATE TABLE IF NOT EXISTS jira_issue_link (
    jira_key TEXT,
    link_type TEXT,
    link_key TEXT,
    link_status TEXT,
    link_priority TEXT,
    issue_type TEXT,
    CONSTRAINT fk_jira_issue
        FOREIGN KEY (jira_key)
        REFERENCES jira_detail (jira_key)
);

CREATE TABLE IF NOT EXISTS jira_parent (
    jira_key TEXT,
    parent_key TEXT,
    parent_summary TEXT,
    parent_type TEXT,
    PRIMARY KEY (jira_key, parent_key),
    CONSTRAINT fk_jira_parent
        FOREIGN KEY (jira_key)
        REFERENCES jira_detail (jira_key)
);

-- ============================================================================
-- Pipeline tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS gitr_pipeline_run (
    id SERIAL PRIMARY KEY,
    class_name TEXT,
    context TEXT,
    detail TEXT,
    status TEXT,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS gitr_pipeline_log (
    parent_id INT,
    id SERIAL PRIMARY KEY,
    class_name TEXT,
    context TEXT,
    msg_level INT,
    detail TEXT,
    transaction_date TIMESTAMP WITH TIME ZONE,
    CONSTRAINT fk_parent_pipeline
        FOREIGN KEY (parent_id)
        REFERENCES gitr_pipeline_run (id)
);

CREATE TABLE IF NOT EXISTS gitr_pipeline_sha (
    pipeline_id INT,
    sha TEXT,
    PRIMARY KEY (pipeline_id, sha),
    CONSTRAINT fk_pipeline_id
        FOREIGN KEY (pipeline_id)
        REFERENCES gitr_pipeline_log (id),
    CONSTRAINT fk_pipeline_sha
        FOREIGN KEY (sha)
        REFERENCES commit_history (sha)
);

CREATE TABLE IF NOT EXISTS gitr_pipeline_jira (
    pipeline_id INT,
    jira_key TEXT,
    PRIMARY KEY (pipeline_id, jira_key),
    CONSTRAINT fk_pipeline_jid
        FOREIGN KEY (pipeline_id)
        REFERENCES gitr_pipeline_log (id),
    CONSTRAINT fk_pipeline_jira
        FOREIGN KEY (jira_key)
        REFERENCES jira_detail (jira_key)
);

CREATE TABLE IF NOT EXISTS gitja_pipeline_table_counts (
    gitr_table TEXT,
    row_count INT,
    count_date TIMESTAMP WITH TIME ZONE,
    pipeline_id INT,
    CONSTRAINT fk_pipeline_count
        FOREIGN KEY (pipeline_id)
        REFERENCES gitr_pipeline_run (id)
);

-- ============================================================================
-- Team and GitHub integration tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS gitja_team_contributor (
    login TEXT,
    full_name TEXT,
    team TEXT,
    num_count INT,
    PRIMARY KEY (login, team, full_name),
    CONSTRAINT fk_team_contributor
        FOREIGN KEY (login)
        REFERENCES commit_contributors (login)
);

CREATE TABLE IF NOT EXISTS jira_github_branch (
    jira_id INT,
    jira_key TEXT,
    branch_name TEXT,
    display_id TEXT,
    last_commit TEXT,
    author_date TIMESTAMP WITH TIME ZONE,
    author TEXT,
    branch_url TEXT,
    pull_url TEXT,
    commit_url TEXT,
    PRIMARY KEY (jira_id, last_commit, branch_name),
    CONSTRAINT fk_jira_github_key
        FOREIGN KEY (jira_key)
        REFERENCES jira_detail (jira_key)
);

CREATE TABLE IF NOT EXISTS jira_github_pullrequest (
    jira_id INT,
    jira_key TEXT,
    id TEXT,
    name TEXT,
    source_branch TEXT,
    source_url TEXT,
    destination_branch TEXT,
    destination_url TEXT,
    pull_status TEXT,
    url TEXT,
    last_update TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (jira_id, id),
    CONSTRAINT fk_jira_github_key
        FOREIGN KEY (jira_key)
        REFERENCES jira_detail (jira_key)
);
