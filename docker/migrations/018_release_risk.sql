-- Migration 018: Release Risk Gauge Dashboard views for release risk analysis
-- Ticket: IQS-911
-- Purpose: Calculate per-commit and aggregate release risk based on multiple factors
--
-- Design:
--   - vw_author_experience: Author experience score based on commit history
--   - vw_commit_risk: Per-commit risk calculation with individual risk factors
--   - vw_release_risk: Aggregate release risk with score and category
--
-- Risk Factors (per-commit):
--   1. Complexity risk: Based on complexity_delta from vw_dev_pipeline_deltas
--   2. Test coverage risk: Based on ratio of test files to total files changed
--   3. Experience risk: Based on author's commit history (from vw_author_experience)
--   4. Hotspot risk: Based on whether files touched are in vw_hot_spots
--
-- Dependencies:
--   - Migration 010: vw_dev_pipeline_deltas view
--   - Migration 013: vw_hot_spots view
--
-- This dashboard answers: "How risky is this release based on commit characteristics?"

-- ============================================================================
-- Author Experience View
-- ============================================================================
-- Calculates experience score for each author based on their commit history.
-- Higher experience = lower risk. Score is based on:
--   - Total commits in last 180 days
--   - Distinct repositories worked on
--   - Days since first commit (tenure)

CREATE OR REPLACE VIEW vw_author_experience AS
WITH author_stats AS (
  SELECT
    ch.author,
    COUNT(DISTINCT ch.sha) AS total_commits,
    COUNT(DISTINCT ch.repository) AS repo_count,
    MIN(ch.commit_date) AS first_commit_date,
    MAX(ch.commit_date) AS last_commit_date,
    COUNT(DISTINCT DATE_TRUNC('day', ch.commit_date)) AS active_days
  FROM commit_history ch
  WHERE ch.commit_date >= CURRENT_DATE - INTERVAL '180 days'
    AND ch.is_merge = FALSE
  GROUP BY ch.author
),
max_stats AS (
  SELECT
    MAX(total_commits) AS max_commits,
    MAX(repo_count) AS max_repos,
    MAX(active_days) AS max_active_days
  FROM author_stats
)
SELECT
  ast.author,
  ast.total_commits,
  ast.repo_count,
  ast.active_days,
  ast.first_commit_date,
  ast.last_commit_date,
  -- Experience score: normalized composite (commits 50%, repos 25%, active days 25%)
  -- Scale 0-1 where 1 = most experienced
  ROUND((
    (ast.total_commits::FLOAT / NULLIF(ms.max_commits, 0)) * 0.5 +
    (ast.repo_count::FLOAT / NULLIF(ms.max_repos, 0)) * 0.25 +
    (ast.active_days::FLOAT / NULLIF(ms.max_active_days, 0)) * 0.25
  )::NUMERIC, 4) AS experience_score
FROM author_stats ast
CROSS JOIN max_stats ms;

COMMENT ON VIEW vw_author_experience IS 'Author experience score based on commit history over 180 days. Higher score = more experienced. Ticket: IQS-911';

-- ============================================================================
-- Commit Risk View
-- ============================================================================
-- Calculates per-commit risk scores based on multiple factors.
-- Each factor contributes to the total risk score (0-1 scale).

CREATE OR REPLACE VIEW vw_commit_risk AS
WITH pipeline_commits AS (
  -- Get commit-level metrics from dev pipeline view
  SELECT
    dpd.sha,
    dpd.commit_date,
    dpd.author,
    dpd.branch,
    dpd.repository,
    dpd.commit_message,
    dpd.full_name,
    dpd.team,
    dpd.ticket_id,
    dpd.complexity_delta,
    dpd.loc_delta,
    dpd.comments_delta,
    dpd.tests_delta,
    dpd.file_count,
    dpd.test_file_count,
    dpd.total_complexity
  FROM vw_dev_pipeline_deltas dpd
  WHERE dpd.commit_date >= CURRENT_DATE - INTERVAL '90 days'
),
commit_hotspot_files AS (
  -- Count hotspot files touched by each commit
  SELECT
    cf.sha,
    COUNT(DISTINCT hs.file_path) AS hotspot_file_count,
    MAX(hs.risk_score) AS max_hotspot_risk
  FROM commit_files cf
  LEFT JOIN vw_hot_spots hs ON cf.filename = hs.file_path
  WHERE hs.risk_tier IN ('critical', 'high')
  GROUP BY cf.sha
),
max_values AS (
  -- Pre-calculate max values for normalization
  SELECT
    MAX(ABS(complexity_delta)) AS max_complexity_delta,
    MAX(loc_delta) AS max_loc_delta,
    MAX(file_count) AS max_file_count
  FROM pipeline_commits
  WHERE complexity_delta != 0 OR loc_delta != 0
)
SELECT
  pc.sha,
  pc.commit_date,
  pc.author,
  pc.branch,
  pc.repository,
  pc.commit_message,
  pc.full_name,
  pc.team,
  pc.ticket_id,
  pc.complexity_delta,
  pc.loc_delta,
  pc.file_count,
  pc.test_file_count,

  -- Complexity Risk (0-1): Based on complexity delta magnitude
  -- Higher complexity increase = higher risk
  ROUND(
    CASE
      WHEN mv.max_complexity_delta = 0 THEN 0
      ELSE LEAST(ABS(pc.complexity_delta)::FLOAT / NULLIF(mv.max_complexity_delta, 0), 1)
    END::NUMERIC, 4
  ) AS complexity_risk,

  -- Test Coverage Risk (0-1): Inverse of test coverage ratio
  -- No tests = high risk (1.0), good test coverage = low risk
  ROUND(
    CASE
      WHEN pc.file_count = 0 THEN 0
      WHEN pc.test_file_count >= pc.file_count THEN 0.0  -- All files are tests = low risk
      ELSE 1.0 - (pc.test_file_count::FLOAT / NULLIF(pc.file_count, 0))
    END::NUMERIC, 4
  ) AS test_coverage_risk,

  -- Experience Risk (0-1): Inverse of author experience
  -- Low experience = high risk
  ROUND(
    COALESCE(1.0 - ae.experience_score, 0.5)::NUMERIC, 4
  ) AS experience_risk,

  -- Hotspot Risk (0-1): Based on hotspot files touched
  -- Touching critical/high hotspots = high risk
  ROUND(
    CASE
      WHEN chf.hotspot_file_count IS NULL OR chf.hotspot_file_count = 0 THEN 0
      WHEN chf.hotspot_file_count >= 3 THEN 1.0
      ELSE (chf.hotspot_file_count::FLOAT / 3.0)
    END::NUMERIC, 4
  ) AS hotspot_risk,

  -- Total Risk (0-1): Weighted composite of all factors
  -- Weights: complexity 30%, test coverage 30%, experience 20%, hotspot 20%
  ROUND((
    (CASE
      WHEN mv.max_complexity_delta = 0 THEN 0
      ELSE LEAST(ABS(pc.complexity_delta)::FLOAT / NULLIF(mv.max_complexity_delta, 0), 1)
    END) * 0.30 +
    (CASE
      WHEN pc.file_count = 0 THEN 0
      WHEN pc.test_file_count >= pc.file_count THEN 0.0
      ELSE 1.0 - (pc.test_file_count::FLOAT / NULLIF(pc.file_count, 0))
    END) * 0.30 +
    COALESCE(1.0 - ae.experience_score, 0.5) * 0.20 +
    (CASE
      WHEN chf.hotspot_file_count IS NULL OR chf.hotspot_file_count = 0 THEN 0
      WHEN chf.hotspot_file_count >= 3 THEN 1.0
      ELSE (chf.hotspot_file_count::FLOAT / 3.0)
    END) * 0.20
  )::NUMERIC, 4) AS total_risk,

  -- Risk Category based on total risk score
  CASE
    WHEN (
      (CASE
        WHEN mv.max_complexity_delta = 0 THEN 0
        ELSE LEAST(ABS(pc.complexity_delta)::FLOAT / NULLIF(mv.max_complexity_delta, 0), 1)
      END) * 0.30 +
      (CASE
        WHEN pc.file_count = 0 THEN 0
        WHEN pc.test_file_count >= pc.file_count THEN 0.0
        ELSE 1.0 - (pc.test_file_count::FLOAT / NULLIF(pc.file_count, 0))
      END) * 0.30 +
      COALESCE(1.0 - ae.experience_score, 0.5) * 0.20 +
      (CASE
        WHEN chf.hotspot_file_count IS NULL OR chf.hotspot_file_count = 0 THEN 0
        WHEN chf.hotspot_file_count >= 3 THEN 1.0
        ELSE (chf.hotspot_file_count::FLOAT / 3.0)
      END) * 0.20
    ) >= 0.75 THEN 'critical'
    WHEN (
      (CASE
        WHEN mv.max_complexity_delta = 0 THEN 0
        ELSE LEAST(ABS(pc.complexity_delta)::FLOAT / NULLIF(mv.max_complexity_delta, 0), 1)
      END) * 0.30 +
      (CASE
        WHEN pc.file_count = 0 THEN 0
        WHEN pc.test_file_count >= pc.file_count THEN 0.0
        ELSE 1.0 - (pc.test_file_count::FLOAT / NULLIF(pc.file_count, 0))
      END) * 0.30 +
      COALESCE(1.0 - ae.experience_score, 0.5) * 0.20 +
      (CASE
        WHEN chf.hotspot_file_count IS NULL OR chf.hotspot_file_count = 0 THEN 0
        WHEN chf.hotspot_file_count >= 3 THEN 1.0
        ELSE (chf.hotspot_file_count::FLOAT / 3.0)
      END) * 0.20
    ) >= 0.5 THEN 'high'
    WHEN (
      (CASE
        WHEN mv.max_complexity_delta = 0 THEN 0
        ELSE LEAST(ABS(pc.complexity_delta)::FLOAT / NULLIF(mv.max_complexity_delta, 0), 1)
      END) * 0.30 +
      (CASE
        WHEN pc.file_count = 0 THEN 0
        WHEN pc.test_file_count >= pc.file_count THEN 0.0
        ELSE 1.0 - (pc.test_file_count::FLOAT / NULLIF(pc.file_count, 0))
      END) * 0.30 +
      COALESCE(1.0 - ae.experience_score, 0.5) * 0.20 +
      (CASE
        WHEN chf.hotspot_file_count IS NULL OR chf.hotspot_file_count = 0 THEN 0
        WHEN chf.hotspot_file_count >= 3 THEN 1.0
        ELSE (chf.hotspot_file_count::FLOAT / 3.0)
      END) * 0.20
    ) >= 0.25 THEN 'medium'
    ELSE 'low'
  END AS risk_category

FROM pipeline_commits pc
CROSS JOIN max_values mv
LEFT JOIN vw_author_experience ae ON pc.author = ae.author
LEFT JOIN commit_hotspot_files chf ON pc.sha = chf.sha
ORDER BY commit_date DESC, total_risk DESC;

COMMENT ON VIEW vw_commit_risk IS 'Per-commit risk analysis with complexity, test coverage, experience, and hotspot factors. Ticket: IQS-911';

-- ============================================================================
-- Release Risk View
-- ============================================================================
-- Aggregates commit risks into release-level risk summaries.
-- Groups by repository and branch for release context.

CREATE OR REPLACE VIEW vw_release_risk AS
WITH commit_risk_data AS (
  SELECT
    cr.repository,
    cr.branch,
    cr.sha,
    cr.commit_date,
    cr.total_risk,
    cr.complexity_risk,
    cr.test_coverage_risk,
    cr.experience_risk,
    cr.hotspot_risk,
    cr.risk_category
  FROM vw_commit_risk cr
),
release_stats AS (
  SELECT
    repository,
    branch,
    COUNT(DISTINCT sha) AS commit_count,
    MIN(commit_date) AS first_commit_date,
    MAX(commit_date) AS last_commit_date,
    AVG(total_risk) AS avg_risk,
    MAX(total_risk) AS max_risk,
    AVG(complexity_risk) AS avg_complexity_risk,
    AVG(test_coverage_risk) AS avg_test_coverage_risk,
    AVG(experience_risk) AS avg_experience_risk,
    AVG(hotspot_risk) AS avg_hotspot_risk,
    COUNT(CASE WHEN risk_category = 'critical' THEN 1 END) AS critical_commit_count,
    COUNT(CASE WHEN risk_category = 'high' THEN 1 END) AS high_commit_count,
    COUNT(CASE WHEN risk_category = 'medium' THEN 1 END) AS medium_commit_count,
    COUNT(CASE WHEN risk_category = 'low' THEN 1 END) AS low_commit_count
  FROM commit_risk_data
  GROUP BY repository, branch
)
SELECT
  rs.repository,
  rs.branch,
  rs.commit_count::INTEGER,
  rs.first_commit_date,
  rs.last_commit_date,

  -- Release Risk Score: Weighted by critical/high commit presence
  -- Base: avg risk, boosted by presence of critical/high risk commits
  ROUND((
    rs.avg_risk * 0.6 +
    (rs.critical_commit_count::FLOAT / NULLIF(rs.commit_count, 0)) * 0.25 +
    (rs.high_commit_count::FLOAT / NULLIF(rs.commit_count, 0)) * 0.15
  )::NUMERIC, 4) AS release_risk_score,

  -- Risk Category based on release risk score
  CASE
    WHEN (
      rs.avg_risk * 0.6 +
      (rs.critical_commit_count::FLOAT / NULLIF(rs.commit_count, 0)) * 0.25 +
      (rs.high_commit_count::FLOAT / NULLIF(rs.commit_count, 0)) * 0.15
    ) >= 0.6 THEN 'critical'
    WHEN (
      rs.avg_risk * 0.6 +
      (rs.critical_commit_count::FLOAT / NULLIF(rs.commit_count, 0)) * 0.25 +
      (rs.high_commit_count::FLOAT / NULLIF(rs.commit_count, 0)) * 0.15
    ) >= 0.4 THEN 'high'
    WHEN (
      rs.avg_risk * 0.6 +
      (rs.critical_commit_count::FLOAT / NULLIF(rs.commit_count, 0)) * 0.25 +
      (rs.high_commit_count::FLOAT / NULLIF(rs.commit_count, 0)) * 0.15
    ) >= 0.2 THEN 'medium'
    ELSE 'low'
  END AS risk_category,

  -- Risk breakdown averages
  ROUND(rs.avg_complexity_risk::NUMERIC, 4) AS avg_complexity_risk,
  ROUND(rs.avg_test_coverage_risk::NUMERIC, 4) AS avg_test_coverage_risk,
  ROUND(rs.avg_experience_risk::NUMERIC, 4) AS avg_experience_risk,
  ROUND(rs.avg_hotspot_risk::NUMERIC, 4) AS avg_hotspot_risk,

  -- Risk commit counts
  rs.critical_commit_count::INTEGER,
  rs.high_commit_count::INTEGER,
  rs.medium_commit_count::INTEGER,
  rs.low_commit_count::INTEGER,

  -- Additional context
  ROUND(rs.max_risk::NUMERIC, 4) AS max_risk

FROM release_stats rs
ORDER BY release_risk_score DESC NULLS LAST;

COMMENT ON VIEW vw_release_risk IS 'Release-level risk aggregation by repository and branch with breakdown by risk factors. Ticket: IQS-911';

-- ============================================================================
-- Performance Indexes
-- ============================================================================

-- Index for faster author lookups in experience calculation
CREATE INDEX IF NOT EXISTS idx_commit_history_author_date
ON commit_history(author, commit_date);

-- Index for branch filtering in release risk queries
CREATE INDEX IF NOT EXISTS idx_commit_history_branch
ON commit_history(branch);

-- Index for repository + branch combination lookups
CREATE INDEX IF NOT EXISTS idx_commit_history_repo_branch
ON commit_history(repository, branch);
