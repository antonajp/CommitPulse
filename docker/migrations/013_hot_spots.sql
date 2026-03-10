-- Migration 013: Hot Spots analysis view for file churn and complexity correlation
-- Ticket: IQS-901
-- Purpose: Identify files that are high risk for bugs based on churn, complexity, and bug history
--
-- Design:
--   - vw_hot_spots: Combines churn count with complexity metrics and bug correlations
--   - Risk score: Weighted composite (churn 40%, complexity 40%, bugs 20%)
--   - Risk tier: critical/high/medium/low categorization
--
-- Key metrics:
--   1. Churn count (distinct commits per file in time window)
--   2. Current complexity (most recent complexity value)
--   3. Bug ticket count (commits linked to bug-type tickets)
--   4. Contributor count (number of distinct authors)
--   5. Risk score (normalized composite)
--
-- This view answers: "Which files need refactoring most urgently?"

-- ============================================================================
-- Performance indexes for hot spots queries
-- ============================================================================

-- Index for file_path and repository lookups in commit_files
CREATE INDEX IF NOT EXISTS idx_commit_files_path_repo ON commit_files(filename, author);

-- Index for commit_date filtering in commit_history
CREATE INDEX IF NOT EXISTS idx_commit_history_commit_date ON commit_history(commit_date);

-- Index for is_merge filtering (exclude merges)
CREATE INDEX IF NOT EXISTS idx_commit_history_is_merge ON commit_history(is_merge);

-- ============================================================================
-- Hot Spots View
-- ============================================================================

CREATE OR REPLACE VIEW vw_hot_spots AS
WITH file_churn AS (
  -- Calculate churn metrics per file
  SELECT
    cf.filename AS file_path,
    ch.repository,
    COUNT(DISTINCT cf.sha) AS churn_count,
    MAX(ch.commit_date) AS last_changed,
    COUNT(DISTINCT ch.author) AS contributor_count
  FROM commit_files cf
  JOIN commit_history ch ON cf.sha = ch.sha
  WHERE ch.commit_date >= CURRENT_DATE - INTERVAL '90 days'
    AND ch.is_merge = FALSE
  GROUP BY cf.filename, ch.repository
),
file_complexity AS (
  -- Get complexity metrics from most recent commits
  SELECT
    cf.filename AS file_path,
    ch.repository,
    MAX(cf.complexity) AS current_complexity,
    MAX(cf.total_code_lines) AS current_loc,
    AVG(cf.complexity)::NUMERIC AS avg_complexity
  FROM commit_files cf
  JOIN commit_history ch ON cf.sha = ch.sha
  WHERE ch.commit_date >= CURRENT_DATE - INTERVAL '90 days'
    AND ch.is_merge = FALSE
  GROUP BY cf.filename, ch.repository
),
bug_associations AS (
  -- Count bug tickets associated with each file
  SELECT
    cf.filename AS file_path,
    ch.repository,
    COUNT(DISTINCT COALESCE(cj.jira_key, cl.linear_key)) AS bug_ticket_count
  FROM commit_files cf
  JOIN commit_history ch ON cf.sha = ch.sha
  LEFT JOIN commit_jira cj ON cf.sha = cj.sha
  LEFT JOIN commit_linear cl ON cf.sha = cl.sha
  LEFT JOIN jira_detail jd ON cj.jira_key = jd.jira_key
  LEFT JOIN linear_detail ld ON cl.linear_key = ld.linear_key
  WHERE (
    (jd.jira_key IS NOT NULL AND LOWER(jd.issuetype) = 'bug')
    OR (ld.linear_key IS NOT NULL AND LOWER(COALESCE(ld.state, '')) LIKE '%bug%')
  )
  GROUP BY cf.filename, ch.repository
),
max_values AS (
  -- Pre-calculate max values for normalization
  SELECT
    MAX(fc.churn_count) AS max_churn,
    MAX(fx.current_complexity) AS max_complexity,
    MAX(ba.bug_ticket_count) AS max_bugs
  FROM file_churn fc
  LEFT JOIN file_complexity fx ON fc.file_path = fx.file_path AND fc.repository = fx.repository
  LEFT JOIN bug_associations ba ON fc.file_path = ba.file_path AND fc.repository = ba.repository
)
SELECT
  fc.file_path,
  fc.repository,
  fc.churn_count::INTEGER,
  fc.last_changed,
  fc.contributor_count::INTEGER,
  COALESCE(fx.current_complexity, 0)::INTEGER AS complexity,
  COALESCE(fx.current_loc, 0)::INTEGER AS loc,
  COALESCE(ba.bug_ticket_count, 0)::INTEGER AS bug_count,

  -- Risk score: normalized composite (churn 40%, complexity 40%, bugs 20%)
  ROUND((
    (fc.churn_count::FLOAT / NULLIF(mv.max_churn, 0)) * 0.4 +
    (COALESCE(fx.current_complexity, 0)::FLOAT / NULLIF(mv.max_complexity, 0)) * 0.4 +
    (COALESCE(ba.bug_ticket_count, 0)::FLOAT / NULLIF(mv.max_bugs, 0)) * 0.2
  )::NUMERIC, 4) AS risk_score,

  -- Risk tier based on thresholds
  CASE
    WHEN fc.churn_count >= 10 AND COALESCE(fx.current_complexity, 0) >= 50 THEN 'critical'
    WHEN fc.churn_count >= 5 AND COALESCE(fx.current_complexity, 0) >= 25 THEN 'high'
    WHEN fc.churn_count >= 3 AND COALESCE(fx.current_complexity, 0) >= 10 THEN 'medium'
    ELSE 'low'
  END AS risk_tier

FROM file_churn fc
CROSS JOIN max_values mv
LEFT JOIN file_complexity fx ON fc.file_path = fx.file_path AND fc.repository = fx.repository
LEFT JOIN bug_associations ba ON fc.file_path = ba.file_path AND fc.repository = ba.repository
ORDER BY risk_score DESC NULLS LAST;

COMMENT ON VIEW vw_hot_spots IS 'Hot Spots analysis view: identifies high-risk files based on churn, complexity, and bug correlation. Ticket: IQS-901';
