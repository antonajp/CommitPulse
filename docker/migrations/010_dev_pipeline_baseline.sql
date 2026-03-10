-- Migration 010: Development Pipeline baseline tracking
-- Ticket: IQS-896
-- Purpose: Support commit-level delta calculations against merge-base with main/develop
--          for the Development Pipeline dashboard showing complexity, LOC, comments, tests deltas.
--
-- Design:
--   - commit_baseline stores pre-computed file metrics at the merge-base commit
--   - Populated during pipeline ingestion after calculating merge-base via Git
--   - vw_dev_pipeline_deltas joins commits against baseline to compute deltas
--
-- Delta metrics:
--   1. Complexity delta per commit (sum of file complexity changes vs baseline)
--   2. LOC delta per commit (net lines vs baseline)
--   3. Comments delta per commit (comment lines vs baseline)
--   4. Tests delta per commit (LOC in test files vs baseline)

-- ============================================================================
-- commit_baseline table
-- ============================================================================

CREATE TABLE IF NOT EXISTS commit_baseline (
    sha TEXT NOT NULL,
    filename TEXT NOT NULL,
    baseline_sha TEXT NOT NULL,
    baseline_complexity INT NOT NULL DEFAULT 0,
    baseline_code_lines INT NOT NULL DEFAULT 0,
    baseline_comment_lines INT NOT NULL DEFAULT 0,
    baseline_is_test_file BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (sha, filename),
    CONSTRAINT fk_baseline_sha
        FOREIGN KEY (sha)
        REFERENCES commit_history (sha)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_commit_baseline_sha
    ON commit_baseline (sha);

CREATE INDEX IF NOT EXISTS idx_commit_baseline_baseline_sha
    ON commit_baseline (baseline_sha);

COMMENT ON TABLE commit_baseline IS 'Pre-computed baseline metrics for each file at the merge-base commit. Used for delta calculations in Development Pipeline dashboard.';
COMMENT ON COLUMN commit_baseline.sha IS 'The commit SHA for which this baseline applies';
COMMENT ON COLUMN commit_baseline.filename IS 'The file path';
COMMENT ON COLUMN commit_baseline.baseline_sha IS 'The merge-base SHA used as baseline (typically main/develop branch head)';
COMMENT ON COLUMN commit_baseline.baseline_complexity IS 'Cyclomatic complexity at baseline';
COMMENT ON COLUMN commit_baseline.baseline_code_lines IS 'Lines of code at baseline';
COMMENT ON COLUMN commit_baseline.baseline_comment_lines IS 'Comment lines at baseline';
COMMENT ON COLUMN commit_baseline.baseline_is_test_file IS 'Whether file was a test file at baseline';

-- ============================================================================
-- Development Pipeline deltas view
-- ============================================================================

CREATE OR REPLACE VIEW vw_dev_pipeline_deltas AS
SELECT
    ch.sha,
    ch.commit_date,
    ch.author,
    ch.branch,
    ch.repository,
    ch.commit_message,
    ch.is_merge,
    cc.full_name,
    cc.team,
    -- Ticket associations (Linear OR Jira)
    COALESCE(cl.linear_key, cj.jira_key) AS ticket_id,
    COALESCE(cl.linear_project, cj.jira_project) AS ticket_project,
    CASE
        WHEN cl.linear_key IS NOT NULL THEN 'Linear'
        WHEN cj.jira_key IS NOT NULL THEN 'Jira'
        ELSE NULL
    END AS ticket_type,
    -- Aggregate deltas across all files in the commit
    COALESCE(SUM(cf.complexity - COALESCE(cb.baseline_complexity, 0)), 0)::INT AS complexity_delta,
    COALESCE(SUM(cf.total_code_lines - COALESCE(cb.baseline_code_lines, 0)), 0)::INT AS loc_delta,
    COALESCE(SUM(cf.total_comment_lines - COALESCE(cb.baseline_comment_lines, 0)), 0)::INT AS comments_delta,
    COALESCE(
        SUM(
            CASE
                WHEN cf.is_test_file = TRUE
                THEN cf.total_code_lines - COALESCE(cb.baseline_code_lines, 0)
                ELSE 0
            END
        ),
        0
    )::INT AS tests_delta,
    -- File count metrics
    COUNT(DISTINCT cf.filename)::INT AS file_count,
    COUNT(DISTINCT CASE WHEN cf.is_test_file THEN cf.filename END)::INT AS test_file_count,
    -- Baseline SHA for transparency (should be same for all files in commit)
    MAX(cb.baseline_sha) AS baseline_sha,
    -- Raw totals (not deltas) for additional context
    COALESCE(SUM(cf.complexity), 0)::INT AS total_complexity,
    COALESCE(SUM(cf.total_code_lines), 0)::INT AS total_code_lines,
    COALESCE(SUM(cf.total_comment_lines), 0)::INT AS total_comment_lines
FROM commit_history ch
INNER JOIN commit_files cf ON ch.sha = cf.sha
LEFT JOIN commit_baseline cb ON cf.sha = cb.sha AND cf.filename = cb.filename
LEFT JOIN commit_contributors cc ON ch.author = cc.login
LEFT JOIN commit_linear cl ON ch.sha = cl.sha
LEFT JOIN commit_jira cj ON ch.sha = cj.sha
WHERE ch.is_merge = FALSE
  -- Exclude dependency directories (aligned with migration 009)
  AND NOT (cf.filename LIKE '%/node_modules/%' OR cf.filename LIKE 'node_modules/%')
  AND NOT (cf.filename LIKE '%/vendor/%' OR cf.filename LIKE 'vendor/%')
  AND NOT (cf.filename LIKE '%/dist/%' OR cf.filename LIKE 'dist/%')
  AND NOT (cf.filename LIKE '%/build/%' OR cf.filename LIKE 'build/%')
  AND NOT (cf.filename LIKE '%/.venv/%' OR cf.filename LIKE '.venv/%')
GROUP BY
    ch.sha,
    ch.commit_date,
    ch.author,
    ch.branch,
    ch.repository,
    ch.commit_message,
    ch.is_merge,
    cc.full_name,
    cc.team,
    cl.linear_key,
    cl.linear_project,
    cj.jira_key,
    cj.jira_project
ORDER BY ch.commit_date DESC;

COMMENT ON VIEW vw_dev_pipeline_deltas IS 'Development Pipeline dashboard view: per-commit deltas for complexity, LOC, comments, and tests relative to merge-base baseline. Linked to Linear/Jira tickets.';

-- ============================================================================
-- Performance indexes for the view query
-- ============================================================================

-- commit_history already has PK on sha, but add index on commit_date for date filtering
CREATE INDEX IF NOT EXISTS idx_commit_history_commit_date
    ON commit_history (commit_date);

-- commit_history index on is_merge for filtering
CREATE INDEX IF NOT EXISTS idx_commit_history_is_merge
    ON commit_history (is_merge);

-- commit_files already has composite PK (sha, filename), sufficient for joins

-- commit_linear already has index from migration 008
-- commit_jira needs matching index
CREATE INDEX IF NOT EXISTS idx_commit_jira_sha
    ON commit_jira (sha);
