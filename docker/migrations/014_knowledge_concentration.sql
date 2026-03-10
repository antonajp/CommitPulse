-- Migration 014: Knowledge Concentration analysis views for bus factor and ownership tracking
-- Ticket: IQS-903
-- Purpose: Identify knowledge silos and "bus factor" risks by analyzing file ownership concentration
--
-- Design:
--   - vw_knowledge_concentration: Calculates ownership percentages per file by contributor
--   - vw_module_bus_factor: Directory-level aggregation for module-level bus factor analysis
--   - Concentration risk: critical >= 90%, high >= 80%, medium >= 60%, low < 60%
--   - Bus factor: Minimum number of people who need to leave before no one knows the code
--
-- Key metrics:
--   1. Ownership percentage (commits per contributor / total commits per file)
--   2. Top contributor identification
--   3. Second contributor for backup analysis
--   4. Concentration risk categorization
--   5. Bus factor calculation
--
-- This view answers: "What's our knowledge silo risk?"

-- ============================================================================
-- Performance indexes for knowledge concentration queries
-- ============================================================================

-- Index for author lookups in commit_history
CREATE INDEX IF NOT EXISTS idx_commit_history_author ON commit_history(author);

-- Index for file_path grouping in commit_files (if not already exists)
CREATE INDEX IF NOT EXISTS idx_commit_files_filename ON commit_files(filename);

-- ============================================================================
-- Knowledge Concentration View
-- ============================================================================

CREATE OR REPLACE VIEW vw_knowledge_concentration AS
WITH file_contributions AS (
  -- Calculate contribution metrics per file per contributor
  SELECT
    cf.filename AS file_path,
    ch.repository,
    ch.author,
    COUNT(*) AS commit_count,
    SUM(cf.line_inserts + cf.line_deletes) AS lines_touched,
    MAX(ch.commit_date) AS last_contribution
  FROM commit_files cf
  JOIN commit_history ch ON cf.sha = ch.sha
  WHERE ch.is_merge = FALSE
  GROUP BY cf.filename, ch.repository, ch.author
),
file_totals AS (
  -- Calculate totals per file for percentage calculations
  SELECT
    file_path,
    repository,
    SUM(commit_count) AS total_commits,
    COUNT(DISTINCT author) AS total_contributors
  FROM file_contributions
  GROUP BY file_path, repository
),
ranked_contributors AS (
  -- Rank contributors by commit count per file
  SELECT
    fc.file_path,
    fc.repository,
    fc.author,
    fc.commit_count,
    fc.lines_touched,
    fc.last_contribution,
    ft.total_commits,
    ft.total_contributors,
    ROUND(((fc.commit_count::NUMERIC / NULLIF(ft.total_commits, 0)) * 100)::NUMERIC, 2) AS ownership_pct,
    ROW_NUMBER() OVER (
      PARTITION BY fc.file_path, fc.repository
      ORDER BY fc.commit_count DESC, fc.last_contribution DESC
    ) AS contributor_rank
  FROM file_contributions fc
  JOIN file_totals ft ON fc.file_path = ft.file_path AND fc.repository = ft.repository
)
SELECT
  rc.file_path,
  rc.repository,
  rc.total_commits::INTEGER,
  rc.total_contributors::INTEGER,

  -- Top contributor details
  MAX(CASE WHEN contributor_rank = 1 THEN author END) AS top_contributor,
  MAX(CASE WHEN contributor_rank = 1 THEN ownership_pct END) AS top_contributor_pct,
  MAX(CASE WHEN contributor_rank = 1 THEN last_contribution END) AS top_contributor_last_active,

  -- Second contributor (for bus factor analysis)
  MAX(CASE WHEN contributor_rank = 2 THEN author END) AS second_contributor,
  MAX(CASE WHEN contributor_rank = 2 THEN ownership_pct END) AS second_contributor_pct,

  -- Concentration risk categorization
  CASE
    WHEN MAX(CASE WHEN contributor_rank = 1 THEN ownership_pct END) >= 90 THEN 'critical'
    WHEN MAX(CASE WHEN contributor_rank = 1 THEN ownership_pct END) >= 80 THEN 'high'
    WHEN MAX(CASE WHEN contributor_rank = 1 THEN ownership_pct END) >= 60 THEN 'medium'
    ELSE 'low'
  END AS concentration_risk,

  -- Bus factor calculation (minimum people to lose before knowledge is lost)
  CASE
    WHEN rc.total_contributors = 1 THEN 1
    WHEN MAX(CASE WHEN contributor_rank = 1 THEN ownership_pct END) >= 80 THEN 1
    WHEN (MAX(CASE WHEN contributor_rank = 1 THEN ownership_pct END) +
          COALESCE(MAX(CASE WHEN contributor_rank = 2 THEN ownership_pct END), 0)) >= 90 THEN 2
    ELSE LEAST(rc.total_contributors, 3)
  END AS bus_factor

FROM ranked_contributors rc
GROUP BY rc.file_path, rc.repository, rc.total_commits, rc.total_contributors
ORDER BY top_contributor_pct DESC NULLS LAST;

COMMENT ON VIEW vw_knowledge_concentration IS 'Knowledge Concentration analysis view: identifies knowledge silos and bus factor risks per file based on contributor ownership percentages. Ticket: IQS-903';

-- ============================================================================
-- Module Bus Factor View (Directory-level aggregation)
-- ============================================================================

CREATE OR REPLACE VIEW vw_module_bus_factor AS
WITH module_paths AS (
  -- Extract module path (first 2 directory levels)
  SELECT
    repository,
    file_path,
    CASE
      WHEN file_path LIKE '%/%/%' THEN
        SPLIT_PART(file_path, '/', 1) || '/' || SPLIT_PART(file_path, '/', 2)
      WHEN file_path LIKE '%/%' THEN
        SPLIT_PART(file_path, '/', 1)
      ELSE
        'root'
    END AS module_path,
    bus_factor,
    concentration_risk,
    top_contributor,
    top_contributor_pct,
    total_contributors
  FROM vw_knowledge_concentration
)
SELECT
  repository,
  module_path,
  COUNT(*) AS file_count,
  ROUND(AVG(bus_factor)::NUMERIC, 2) AS avg_bus_factor,
  MIN(bus_factor) AS min_bus_factor,
  COUNT(*) FILTER (WHERE concentration_risk IN ('critical', 'high'))::INTEGER AS high_risk_files,
  COUNT(*) FILTER (WHERE concentration_risk = 'critical')::INTEGER AS critical_risk_files,
  ROUND(AVG(total_contributors)::NUMERIC, 2) AS avg_contributors,
  MODE() WITHIN GROUP (ORDER BY top_contributor) AS primary_owner
FROM module_paths
GROUP BY repository, module_path
HAVING COUNT(*) >= 3
ORDER BY avg_bus_factor ASC, high_risk_files DESC;

COMMENT ON VIEW vw_module_bus_factor IS 'Module-level bus factor aggregation: provides directory-level overview of knowledge concentration risk. Ticket: IQS-903';
