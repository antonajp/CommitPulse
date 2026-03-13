-- Migration 026: Fix LOC Delta and Complexity Delta calculations in dev pipeline view
-- Ticket: IQS-945
-- Purpose: Fix inflated delta values (1000-2000% error) by using git diff stats
--          instead of baseline-based calculation that returns 0 when baseline is missing.
--
-- Root Cause:
--   The commit_baseline table is never populated, so the LEFT JOIN always returns NULL.
--   COALESCE(..., 0) then defaults to 0, making deltas equal to total file size.
--
-- Fix:
--   Use cf.line_diff (already populated from git diff) instead of baseline calculation
--   Use cf.complexity_change (populated by FileMetricsDeltaService) for complexity delta
--   Use cf.comments_change for comments delta
--   Use cf.code_change for test LOC delta (when applicable)
--
-- Expected Result:
--   - LOC delta now shows actual lines changed (e.g., +5/-2 = 7), not file size
--   - Complexity delta shows incremental change, not total complexity
--   - Chart values will match GitHub commit diff stats

-- ============================================================================
-- Replace the Development Pipeline deltas view with corrected delta calculation
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
    -- FIX: Use git diff stats (complexity_change) instead of baseline calculation
    COALESCE(SUM(cf.complexity_change), 0)::INT AS complexity_delta,
    -- FIX: Use git diff stats (line_diff) instead of baseline calculation
    COALESCE(SUM(cf.line_diff), 0)::INT AS loc_delta,
    -- FIX: Use git diff stats (comments_change) instead of baseline calculation
    COALESCE(SUM(cf.comments_change), 0)::INT AS comments_delta,
    -- FIX: Use git diff stats for test files instead of baseline calculation
    COALESCE(
        SUM(
            CASE
                WHEN cf.is_test_file = TRUE
                THEN cf.line_diff
                ELSE 0
            END
        ),
        0
    )::INT AS tests_delta,
    -- File count metrics
    COUNT(DISTINCT cf.filename)::INT AS file_count,
    COUNT(DISTINCT CASE WHEN cf.is_test_file THEN cf.filename END)::INT AS test_file_count,
    -- Baseline SHA for transparency (retained for backward compatibility)
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

COMMENT ON VIEW vw_dev_pipeline_deltas IS 'Development Pipeline dashboard view: per-commit deltas for complexity, LOC, comments, and tests using git diff stats. Fixed in IQS-945 to use line_diff/complexity_change instead of missing baseline data.';
