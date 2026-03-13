-- Migration 026 Rollback: Restore original delta calculation in dev pipeline view
-- Ticket: IQS-945
-- Purpose: Rollback to baseline-based calculation (reverts the fix)
--
-- Note: This restores the buggy behavior where deltas equal total file size
--       when baseline is missing. Only use if fix causes issues.

-- ============================================================================
-- Restore the original Development Pipeline deltas view
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
    -- Aggregate deltas across all files in the commit (original baseline-based calculation)
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
