-- Migration 029: Group Team dashboard metrics by full_name instead of login
-- Ticket: GITX-171
-- Purpose: Update Knowledge Concentration and Developer Focus views to group by
--          COALESCE(cc.full_name, cc.login) instead of ch.author/login to consolidate
--          the same developer with multiple logins into a single contributor.
--
-- Design:
--   - vw_knowledge_concentration: Update to join commit_contributors and group by full_name
--   - vw_developer_daily_activity: Update to join commit_contributors and output full_name
--   - vw_developer_focus: Inherits changes from vw_developer_daily_activity
--   - COALESCE ensures NULL full_name falls back to login
--   - vw_module_bus_factor: Inherits changes from vw_knowledge_concentration
--
-- Key Changes:
--   1. Knowledge Concentration: top_contributor and second_contributor now display full_name
--   2. Developer Focus: author column now shows COALESCE(full_name, login)
--   3. Bus factor calculations remain accurate with consolidated contributors
--
-- Pattern Reference: file-author-loc-queries.ts lines 36-59 (GITX-169)

-- ============================================================================
-- Update Knowledge Concentration View
-- ============================================================================

-- Drop dependent view first (vw_module_bus_factor depends on vw_knowledge_concentration)
DROP VIEW IF EXISTS vw_module_bus_factor;

CREATE OR REPLACE VIEW vw_knowledge_concentration AS
WITH file_contributions AS (
  -- Calculate contribution metrics per file per contributor (using full_name)
  SELECT
    cf.filename AS file_path,
    ch.repository,
    COALESCE(cc.full_name, cc.login, ch.author) AS contributor_name,
    COUNT(*) AS commit_count,
    SUM(cf.line_inserts + cf.line_deletes) AS lines_touched,
    MAX(ch.commit_date) AS last_contribution
  FROM commit_files cf
  JOIN commit_history ch ON cf.sha = ch.sha
  LEFT JOIN commit_contributors cc ON ch.author = cc.login
  WHERE ch.is_merge = FALSE
  GROUP BY cf.filename, ch.repository, COALESCE(cc.full_name, cc.login, ch.author)
),
file_totals AS (
  -- Calculate totals per file for percentage calculations
  SELECT
    file_path,
    repository,
    SUM(commit_count) AS total_commits,
    COUNT(DISTINCT contributor_name) AS total_contributors
  FROM file_contributions
  GROUP BY file_path, repository
),
ranked_contributors AS (
  -- Rank contributors by commit count per file
  SELECT
    fc.file_path,
    fc.repository,
    fc.contributor_name,
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

  -- Top contributor details (now using full_name via contributor_name)
  MAX(CASE WHEN contributor_rank = 1 THEN contributor_name END) AS top_contributor,
  MAX(CASE WHEN contributor_rank = 1 THEN ownership_pct END) AS top_contributor_pct,
  MAX(CASE WHEN contributor_rank = 1 THEN last_contribution END) AS top_contributor_last_active,

  -- Second contributor (for bus factor analysis)
  MAX(CASE WHEN contributor_rank = 2 THEN contributor_name END) AS second_contributor,
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

COMMENT ON VIEW vw_knowledge_concentration IS 'Knowledge Concentration analysis view: identifies knowledge silos and bus factor risks per file based on contributor ownership percentages. Groups by full_name (GITX-171) instead of login. Ticket: IQS-903, GITX-171';

-- ============================================================================
-- Recreate Module Bus Factor View
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

COMMENT ON VIEW vw_module_bus_factor IS 'Module-level bus factor aggregation: provides directory-level overview of knowledge concentration risk. Groups by full_name (GITX-171). Ticket: IQS-903, GITX-171';

-- ============================================================================
-- Update Developer Daily Activity View
-- ============================================================================

-- Drop dependent view first (vw_developer_focus depends on vw_developer_daily_activity)
DROP VIEW IF EXISTS vw_developer_focus CASCADE;

CREATE OR REPLACE VIEW vw_developer_daily_activity AS
SELECT
  COALESCE(cc.full_name, cc.login, ch.author) AS author,
  DATE(ch.commit_date) AS commit_day,
  ch.repository,
  COUNT(DISTINCT ch.sha) AS commit_count,
  COUNT(DISTINCT COALESCE(cj.jira_key, cl.linear_key)) AS unique_tickets,
  COUNT(DISTINCT cf.filename) AS unique_files,
  SUM(COALESCE(ch.lines_added, 0) + COALESCE(ch.lines_removed, 0)) AS total_loc_changed,

  -- Ticket switches: count of distinct tickets with commits (context indicator)
  COUNT(DISTINCT COALESCE(cj.jira_key, cl.linear_key))
    FILTER (WHERE COALESCE(cj.jira_key, cl.linear_key) IS NOT NULL) AS ticket_switches

FROM commit_history ch
LEFT JOIN commit_jira cj ON ch.sha = cj.sha
LEFT JOIN commit_linear cl ON ch.sha = cl.sha
LEFT JOIN commit_files cf ON ch.sha = cf.sha
LEFT JOIN commit_contributors cc ON ch.author = cc.login
WHERE ch.is_merge = FALSE
GROUP BY COALESCE(cc.full_name, cc.login, ch.author), DATE(ch.commit_date), ch.repository;

COMMENT ON VIEW vw_developer_daily_activity IS 'Daily developer activity aggregation for focus analysis. Groups by full_name (GITX-171) instead of login. Ticket: IQS-907, GITX-171';

-- ============================================================================
-- Recreate Weekly Focus Score View
-- ============================================================================

CREATE OR REPLACE VIEW vw_developer_focus AS
WITH weekly_metrics AS (
  SELECT
    author,
    DATE_TRUNC('week', commit_day) AS week_start,
    SUM(commit_count) AS total_commits,
    SUM(unique_tickets) AS total_unique_tickets,
    SUM(unique_files) AS total_unique_files,
    SUM(total_loc_changed) AS total_loc,
    COUNT(DISTINCT commit_day) AS active_days,
    CASE
      WHEN COUNT(DISTINCT commit_day) > 0
      THEN SUM(unique_tickets)::NUMERIC / COUNT(DISTINCT commit_day)
      ELSE 0
    END AS avg_tickets_per_day
  FROM vw_developer_daily_activity
  GROUP BY author, DATE_TRUNC('week', commit_day)
),
focus_calculation AS (
  SELECT
    wm.*,

    -- Focus score: 100 - (avg tickets per day * 15), clamped 0-100
    -- Developers touching fewer tickets per day get higher focus scores
    GREATEST(0, LEAST(100,
      100 - (wm.avg_tickets_per_day * 15)
    ))::NUMERIC(5,2) AS focus_score,

    -- Productivity indicator: LOC per commit
    CASE WHEN wm.total_commits > 0
      THEN ROUND((wm.total_loc / wm.total_commits)::NUMERIC, 2)
      ELSE 0
    END AS loc_per_commit,

    -- Depth indicator: commits per ticket (higher = deeper work on each ticket)
    CASE WHEN wm.total_unique_tickets > 0
      THEN ROUND((wm.total_commits::NUMERIC / wm.total_unique_tickets), 2)
      ELSE wm.total_commits
    END AS commits_per_ticket

  FROM weekly_metrics wm
)
SELECT
  fc.author,
  fc.week_start,
  fc.total_commits,
  fc.total_unique_tickets,
  fc.total_unique_files,
  fc.total_loc,
  fc.active_days,
  fc.avg_tickets_per_day,
  fc.focus_score,
  fc.loc_per_commit,
  fc.commits_per_ticket,

  -- Focus category
  CASE
    WHEN fc.focus_score >= 80 THEN 'deep_focus'
    WHEN fc.focus_score >= 60 THEN 'moderate_focus'
    WHEN fc.focus_score >= 40 THEN 'fragmented'
    ELSE 'highly_fragmented'
  END AS focus_category,

  -- Week-over-week change in focus score
  fc.focus_score - LAG(fc.focus_score) OVER (
    PARTITION BY fc.author
    ORDER BY fc.week_start
  ) AS focus_score_delta

FROM focus_calculation fc
ORDER BY fc.week_start DESC, fc.author;

COMMENT ON VIEW vw_developer_focus IS 'Weekly developer focus scores with trend analysis. Groups by full_name (GITX-171) instead of login. Ticket: IQS-907, GITX-171';
