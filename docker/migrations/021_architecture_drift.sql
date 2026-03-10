-- Migration 021: Architecture Drift Heat Map Dashboard views
-- Ticket: IQS-917
-- Purpose: Track cross-component architecture violations through heat map visualization
--
-- Design:
--   - vw_component_changes: Maps each commit to its touched components
--   - vw_cross_component_commits: Identifies commits touching 2+ components
--   - vw_architecture_drift: Calculates drift severity and heat map data
--   - vw_architecture_drift_weekly: Component x week matrix with intensity values
--
-- Dependencies:
--   - Migration 001: commit_history, commit_files tables
--   - Migration 006: arc_component column on commit_files
--   - Migration 010: commit_contributors table
--
-- This dashboard answers: "Where are cross-component dependencies emerging?"

-- ============================================================================
-- Component Changes View
-- ============================================================================
-- Maps each commit to its touched components based on arc_component classification.
-- Only includes commits that touch files with assigned components.

CREATE OR REPLACE VIEW vw_component_changes AS
SELECT
  ch.sha,
  ch.commit_date,
  ch.author,
  ch.repository,
  ch.branch,
  ch.commit_message,
  ch.file_count,
  ch.lines_added,
  ch.lines_removed,
  ch.is_merge,
  cf.arc_component,
  COUNT(DISTINCT cf.filename) AS component_file_count,
  SUM(cf.line_inserts) AS component_lines_added,
  SUM(cf.line_deletes) AS component_lines_removed,
  cc.full_name,
  cc.team
FROM commit_history ch
JOIN commit_files cf ON ch.sha = cf.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE cf.arc_component IS NOT NULL
  AND ch.is_merge = FALSE
GROUP BY
  ch.sha,
  ch.commit_date,
  ch.author,
  ch.repository,
  ch.branch,
  ch.commit_message,
  ch.file_count,
  ch.lines_added,
  ch.lines_removed,
  ch.is_merge,
  cf.arc_component,
  cc.full_name,
  cc.team;

COMMENT ON VIEW vw_component_changes IS 'Maps commits to touched architecture components for drift analysis. Ticket: IQS-917';

-- ============================================================================
-- Cross-Component Commits View
-- ============================================================================
-- Identifies commits that touch 2+ architecture components (potential drift).
-- Includes component list and severity based on number of components touched.

CREATE OR REPLACE VIEW vw_cross_component_commits AS
WITH commit_component_counts AS (
  SELECT
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team,
    COUNT(DISTINCT arc_component) AS component_count,
    ARRAY_AGG(DISTINCT arc_component ORDER BY arc_component) AS components_touched,
    SUM(component_file_count) AS total_files_changed,
    SUM(component_lines_added) AS total_lines_added,
    SUM(component_lines_removed) AS total_lines_removed
  FROM vw_component_changes
  GROUP BY
    sha,
    commit_date,
    author,
    repository,
    branch,
    commit_message,
    file_count,
    lines_added,
    lines_removed,
    full_name,
    team
)
SELECT
  sha,
  commit_date,
  author,
  repository,
  branch,
  commit_message,
  file_count,
  lines_added,
  lines_removed,
  full_name,
  team,
  component_count,
  components_touched,
  total_files_changed,
  total_lines_added,
  total_lines_removed,
  -- Drift severity based on number of components touched
  CASE
    WHEN component_count >= 5 THEN 'critical'
    WHEN component_count >= 4 THEN 'high'
    WHEN component_count >= 3 THEN 'medium'
    WHEN component_count >= 2 THEN 'low'
    ELSE 'none'
  END AS drift_severity,
  -- Drift score: higher when more components touched with more changes
  CASE
    WHEN component_count >= 5 THEN 100
    WHEN component_count >= 4 THEN 75
    WHEN component_count >= 3 THEN 50
    WHEN component_count >= 2 THEN 25
    ELSE 0
  END AS drift_score
FROM commit_component_counts
WHERE component_count >= 2  -- Only cross-component commits
ORDER BY commit_date DESC, component_count DESC;

COMMENT ON VIEW vw_cross_component_commits IS 'Commits touching 2+ architecture components with drift severity. Ticket: IQS-917';

-- ============================================================================
-- Architecture Drift View
-- ============================================================================
-- Aggregates drift metrics by component for the heat map visualization.
-- Shows which components are most frequently involved in cross-component changes.

CREATE OR REPLACE VIEW vw_architecture_drift AS
WITH component_drift_stats AS (
  SELECT
    UNNEST(components_touched) AS component,
    repository,
    COUNT(*) AS cross_component_commits,
    SUM(total_lines_added + total_lines_removed) AS total_churn,
    AVG(component_count) AS avg_components_per_commit,
    COUNT(*) FILTER (WHERE drift_severity = 'critical') AS critical_count,
    COUNT(*) FILTER (WHERE drift_severity = 'high') AS high_count,
    COUNT(*) FILTER (WHERE drift_severity = 'medium') AS medium_count,
    COUNT(*) FILTER (WHERE drift_severity = 'low') AS low_count,
    COUNT(DISTINCT author) AS unique_authors,
    COUNT(DISTINCT team) AS unique_teams,
    MIN(commit_date) AS first_drift_date,
    MAX(commit_date) AS last_drift_date
  FROM vw_cross_component_commits
  GROUP BY UNNEST(components_touched), repository
),
total_commits_per_component AS (
  SELECT
    arc_component AS component,
    repository,
    COUNT(DISTINCT sha) AS total_commits
  FROM vw_component_changes
  GROUP BY arc_component, repository
)
SELECT
  cds.component,
  cds.repository,
  cds.cross_component_commits,
  tc.total_commits,
  ROUND(100.0 * cds.cross_component_commits / NULLIF(tc.total_commits, 0), 2) AS drift_percentage,
  cds.total_churn,
  ROUND(cds.avg_components_per_commit::NUMERIC, 2) AS avg_components_per_commit,
  cds.critical_count,
  cds.high_count,
  cds.medium_count,
  cds.low_count,
  cds.unique_authors,
  cds.unique_teams,
  cds.first_drift_date,
  cds.last_drift_date,
  -- Heat intensity: 0-100 based on drift percentage and severity distribution
  LEAST(
    100,
    ROUND(
      (
        COALESCE(100.0 * cds.cross_component_commits / NULLIF(tc.total_commits, 0), 0) * 0.4 +
        COALESCE(cds.critical_count * 20 + cds.high_count * 10 + cds.medium_count * 5 + cds.low_count * 2, 0) * 0.6
      )::NUMERIC,
      2
    )
  ) AS heat_intensity
FROM component_drift_stats cds
LEFT JOIN total_commits_per_component tc
  ON cds.component = tc.component AND cds.repository = tc.repository
ORDER BY heat_intensity DESC, cross_component_commits DESC;

COMMENT ON VIEW vw_architecture_drift IS 'Component-level drift metrics with heat intensity for visualization. Ticket: IQS-917';

-- ============================================================================
-- Architecture Drift Weekly View
-- ============================================================================
-- Component x week matrix for heat map time series visualization.
-- Shows drift intensity trends over time per component.

CREATE OR REPLACE VIEW vw_architecture_drift_weekly AS
WITH weekly_drift AS (
  SELECT
    DATE_TRUNC('week', commit_date)::DATE AS week,
    UNNEST(components_touched) AS component,
    repository,
    COUNT(*) AS cross_component_commits,
    SUM(total_lines_added + total_lines_removed) AS weekly_churn,
    AVG(component_count) AS avg_components,
    COUNT(*) FILTER (WHERE drift_severity = 'critical') AS critical_count,
    COUNT(*) FILTER (WHERE drift_severity = 'high') AS high_count,
    COUNT(*) FILTER (WHERE drift_severity = 'medium') AS medium_count,
    COUNT(*) FILTER (WHERE drift_severity = 'low') AS low_count,
    COUNT(DISTINCT author) AS unique_authors
  FROM vw_cross_component_commits
  GROUP BY DATE_TRUNC('week', commit_date), UNNEST(components_touched), repository
),
weekly_totals AS (
  SELECT
    DATE_TRUNC('week', commit_date)::DATE AS week,
    arc_component AS component,
    repository,
    COUNT(DISTINCT sha) AS total_commits
  FROM vw_component_changes
  GROUP BY DATE_TRUNC('week', commit_date), arc_component, repository
)
SELECT
  wd.week,
  wd.component,
  wd.repository,
  wd.cross_component_commits,
  wt.total_commits,
  ROUND(100.0 * wd.cross_component_commits / NULLIF(wt.total_commits, 0), 2) AS drift_percentage,
  wd.weekly_churn,
  ROUND(wd.avg_components::NUMERIC, 2) AS avg_components,
  wd.critical_count,
  wd.high_count,
  wd.medium_count,
  wd.low_count,
  wd.unique_authors,
  -- Weekly heat intensity
  LEAST(
    100,
    ROUND(
      (
        COALESCE(100.0 * wd.cross_component_commits / NULLIF(wt.total_commits, 0), 0) * 0.4 +
        COALESCE(wd.critical_count * 20 + wd.high_count * 10 + wd.medium_count * 5 + wd.low_count * 2, 0) * 0.6
      )::NUMERIC,
      2
    )
  ) AS heat_intensity
FROM weekly_drift wd
LEFT JOIN weekly_totals wt
  ON wd.week = wt.week AND wd.component = wt.component AND wd.repository = wt.repository
ORDER BY wd.week DESC, heat_intensity DESC;

COMMENT ON VIEW vw_architecture_drift_weekly IS 'Component x week matrix for heat map time series. Ticket: IQS-917';

-- ============================================================================
-- Component Pair Coupling View
-- ============================================================================
-- Shows which pairs of components frequently change together in cross-component commits.
-- Useful for identifying architectural coupling patterns.

CREATE OR REPLACE VIEW vw_component_pair_coupling AS
WITH component_pairs AS (
  SELECT
    sha,
    commit_date,
    repository,
    author,
    team,
    components_touched,
    drift_severity
  FROM vw_cross_component_commits
),
pair_combinations AS (
  SELECT
    sha,
    commit_date,
    repository,
    author,
    team,
    drift_severity,
    CASE
      WHEN a.component < b.component THEN a.component
      ELSE b.component
    END AS component_a,
    CASE
      WHEN a.component < b.component THEN b.component
      ELSE a.component
    END AS component_b
  FROM component_pairs cp
  CROSS JOIN LATERAL UNNEST(cp.components_touched) AS a(component)
  CROSS JOIN LATERAL UNNEST(cp.components_touched) AS b(component)
  WHERE a.component < b.component  -- Only unique pairs
)
SELECT
  component_a,
  component_b,
  repository,
  COUNT(*) AS coupling_count,
  COUNT(DISTINCT sha) AS unique_commits,
  COUNT(DISTINCT author) AS unique_authors,
  COUNT(DISTINCT team) AS unique_teams,
  COUNT(*) FILTER (WHERE drift_severity = 'critical') AS critical_count,
  COUNT(*) FILTER (WHERE drift_severity = 'high') AS high_count,
  MIN(commit_date) AS first_coupling_date,
  MAX(commit_date) AS last_coupling_date,
  -- Coupling strength: based on frequency and severity
  ROUND(
    (COUNT(*) +
     COUNT(*) FILTER (WHERE drift_severity = 'critical') * 3 +
     COUNT(*) FILTER (WHERE drift_severity = 'high') * 2)::NUMERIC,
    2
  ) AS coupling_strength
FROM pair_combinations
GROUP BY component_a, component_b, repository
ORDER BY coupling_count DESC, coupling_strength DESC;

COMMENT ON VIEW vw_component_pair_coupling IS 'Component pair coupling frequency for architecture drift analysis. Ticket: IQS-917';

-- ============================================================================
-- Performance Indexes
-- ============================================================================

-- Index for faster component filtering
CREATE INDEX IF NOT EXISTS idx_commit_files_arc_component_sha
ON commit_files(arc_component, sha);

-- Index for faster commit date range queries on drift data
CREATE INDEX IF NOT EXISTS idx_commit_history_commit_date_repository
ON commit_history(commit_date, repository);
