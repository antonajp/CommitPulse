-- Migration 017: Cross-Team Coupling Dashboard views for team coupling analysis
-- Ticket: IQS-909
-- Purpose: Calculate cross-team file overlap to identify architectural coupling
--
-- Design:
--   - vw_contributor_team: Resolve team from contributor
--   - vw_file_team_ownership: File ownership by team
--   - vw_team_coupling: Cross-team coupling matrix with coupling strength
--   - vw_team_shared_files: Detailed shared files for drill-down
--
-- Key metrics:
--   1. Shared file count: Number of files modified by both teams
--   2. Total shared commits: Sum of commits by both teams on shared files
--   3. Coupling strength: Percentage of overlap (0-100 scale)
--   4. Hotspot files: Most frequently co-modified files
--
-- This dashboard answers: "Which teams are architecturally entangled?"

-- ============================================================================
-- Contributor Team Resolution View
-- ============================================================================

CREATE OR REPLACE VIEW vw_contributor_team AS
SELECT
  cc.login AS contributor,
  COALESCE(
    tc.team,
    cc.team,
    CASE
      WHEN cc.email LIKE '%@vendor1.com' THEN 'Vendor1'
      WHEN cc.email LIKE '%@vendor2.com' THEN 'Vendor2'
      ELSE 'Internal'
    END
  ) AS team_name
FROM commit_contributors cc
LEFT JOIN gitja_team_contributor tc ON cc.login = tc.login;

COMMENT ON VIEW vw_contributor_team IS 'Resolves team name from contributor login using team mappings or email domain. Ticket: IQS-909';

-- ============================================================================
-- File Team Ownership View
-- ============================================================================

CREATE OR REPLACE VIEW vw_file_team_ownership AS
SELECT
  cf.filename AS file_path,
  ch.repository,
  ct.team_name,
  COUNT(DISTINCT cf.sha) AS commit_count,
  COUNT(DISTINCT ch.author) AS contributor_count,
  MAX(ch.commit_date) AS last_modified
FROM commit_files cf
JOIN commit_history ch ON cf.sha = ch.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login OR ch.author = cc.email
LEFT JOIN vw_contributor_team ct ON (cc.login = ct.contributor OR ch.author = ct.contributor)
WHERE ch.is_merge = FALSE
  AND ch.commit_date >= CURRENT_DATE - INTERVAL '90 days'
  AND ct.team_name IS NOT NULL
GROUP BY cf.filename, ch.repository, ct.team_name;

COMMENT ON VIEW vw_file_team_ownership IS 'File ownership aggregation by team within last 90 days. Ticket: IQS-909';

-- ============================================================================
-- Cross-Team Coupling Matrix View
-- ============================================================================

CREATE OR REPLACE VIEW vw_team_coupling AS
WITH team_pairs AS (
  SELECT
    t1.file_path,
    t1.repository,
    t1.team_name AS team_a,
    t2.team_name AS team_b,
    t1.commit_count AS team_a_commits,
    t2.commit_count AS team_b_commits,
    t1.commit_count + t2.commit_count AS total_shared_commits
  FROM vw_file_team_ownership t1
  JOIN vw_file_team_ownership t2
    ON t1.file_path = t2.file_path
    AND t1.repository = t2.repository
    AND t1.team_name < t2.team_name  -- Avoid duplicates and self-pairs
),
team_totals AS (
  SELECT
    team_a,
    team_b,
    COUNT(DISTINCT file_path) AS shared_file_count,
    SUM(total_shared_commits) AS total_shared_commits
  FROM team_pairs
  GROUP BY team_a, team_b
),
team_file_counts AS (
  SELECT team_name, COUNT(DISTINCT file_path) AS total_files
  FROM vw_file_team_ownership
  GROUP BY team_name
)
SELECT
  tt.team_a,
  tt.team_b,
  tt.shared_file_count,
  tt.total_shared_commits,

  -- Coupling strength: shared files / min team file count * 100 (0-100 scale)
  ROUND(
    (tt.shared_file_count::NUMERIC / GREATEST(
      LEAST(COALESCE(tfc_a.total_files, 1), COALESCE(tfc_b.total_files, 1)),
      1
    )) * 100,
    2
  ) AS coupling_strength,

  -- Most coupled files (top 10 by shared commits)
  (
    SELECT ARRAY_AGG(tp.file_path ORDER BY tp.total_shared_commits DESC)
    FROM (
      SELECT file_path, total_shared_commits
      FROM team_pairs tp_inner
      WHERE tp_inner.team_a = tt.team_a AND tp_inner.team_b = tt.team_b
      ORDER BY total_shared_commits DESC
      LIMIT 10
    ) tp
  ) AS hotspot_files

FROM team_totals tt
LEFT JOIN team_file_counts tfc_a ON tt.team_a = tfc_a.team_name
LEFT JOIN team_file_counts tfc_b ON tt.team_b = tfc_b.team_name
WHERE tt.shared_file_count >= 2  -- At least 2 shared files to be significant
ORDER BY tt.shared_file_count DESC, tt.total_shared_commits DESC;

COMMENT ON VIEW vw_team_coupling IS 'Cross-team coupling matrix showing file overlap between teams. Ticket: IQS-909';

-- ============================================================================
-- Team Shared Files Detail View
-- ============================================================================

CREATE OR REPLACE VIEW vw_team_shared_files AS
SELECT
  t1.file_path,
  t1.repository,
  t1.team_name AS team_a,
  t2.team_name AS team_b,
  t1.commit_count AS team_a_commits,
  t2.commit_count AS team_b_commits,
  t1.contributor_count AS team_a_contributors,
  t2.contributor_count AS team_b_contributors,
  GREATEST(t1.last_modified, t2.last_modified) AS last_modified,
  t1.commit_count + t2.commit_count AS total_commits
FROM vw_file_team_ownership t1
JOIN vw_file_team_ownership t2
  ON t1.file_path = t2.file_path
  AND t1.repository = t2.repository
  AND t1.team_name < t2.team_name
ORDER BY (t1.commit_count + t2.commit_count) DESC;

COMMENT ON VIEW vw_team_shared_files IS 'Detailed shared files for drill-down analysis between team pairs. Ticket: IQS-909';

-- ============================================================================
-- Performance Indexes
-- ============================================================================

-- Index for faster file ownership lookups
CREATE INDEX IF NOT EXISTS idx_commit_files_filename
ON commit_files(filename);

-- Index for team contributor lookups
CREATE INDEX IF NOT EXISTS idx_gitja_team_contributor_login
ON gitja_team_contributor(login);

-- Index for commit contributor joins
CREATE INDEX IF NOT EXISTS idx_commit_contributors_login_email
ON commit_contributors(login, email);
