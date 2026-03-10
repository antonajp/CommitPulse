-- Migration 004: Add Linear issue tracker support tables
-- Parallel tables to Jira counterparts for clean separation
-- Ticket: IQS-875
--
-- All tables use IF NOT EXISTS guards for idempotency.

-- ============================================================================
-- Linear detail table (parallel to jira_detail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS linear_detail (
    linear_id TEXT,
    linear_key TEXT PRIMARY KEY,
    priority TEXT,
    created_date TIMESTAMP WITH TIME ZONE,
    url TEXT,
    title TEXT,
    description TEXT,
    creator TEXT,
    state TEXT,
    assignee TEXT,
    project TEXT,
    team TEXT,
    estimate DECIMAL,
    status_change_date TIMESTAMP WITH TIME ZONE,
    completed_date TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- Linear history table (parallel to jira_history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS linear_history (
    linear_key TEXT,
    change_date TIMESTAMP WITH TIME ZONE,
    actor TEXT,
    field TEXT,
    from_value TEXT,
    to_value TEXT,
    CONSTRAINT fk_linear_history
        FOREIGN KEY (linear_key)
        REFERENCES linear_detail (linear_key)
);

-- ============================================================================
-- Commit-to-Linear linking table (parallel to commit_jira)
-- ============================================================================

CREATE TABLE IF NOT EXISTS commit_linear (
    sha TEXT,
    linear_key TEXT,
    author TEXT,
    linear_project TEXT,
    PRIMARY KEY (sha, linear_key),
    CONSTRAINT fk_sha_linear
        FOREIGN KEY (sha)
        REFERENCES commit_history (sha)
);

-- ============================================================================
-- Pipeline Linear tracking table (parallel to gitr_pipeline_jira)
-- ============================================================================

CREATE TABLE IF NOT EXISTS gitr_pipeline_linear (
    pipeline_id INT,
    linear_key TEXT,
    PRIMARY KEY (pipeline_id, linear_key),
    CONSTRAINT fk_pipeline_lid
        FOREIGN KEY (pipeline_id)
        REFERENCES gitr_pipeline_log (id),
    CONSTRAINT fk_pipeline_linear
        FOREIGN KEY (linear_key)
        REFERENCES linear_detail (linear_key)
);

-- ============================================================================
-- Add is_linear_ref column to commit_history
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'commit_history'
        AND column_name = 'is_linear_ref'
    ) THEN
        ALTER TABLE commit_history ADD COLUMN is_linear_ref BOOLEAN;
    END IF;
END $$;
