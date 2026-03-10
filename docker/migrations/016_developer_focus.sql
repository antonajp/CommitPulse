-- Migration 016: Developer Focus Score Dashboard views for focus analysis
-- Ticket: IQS-907
-- Purpose: Calculate developer focus scores based on context switching patterns
--
-- Design:
--   - vw_developer_daily_activity: Daily developer activity aggregation
--   - vw_developer_focus: Weekly focus scores with trend analysis
--
-- Key metrics:
--   1. Unique tickets touched: How many different tickets per time period
--   2. Context switches: Number of different tickets worked in same day
--   3. Focus score: Inverse of context switches (high = fewer distractions)
--   4. Focus category: Classification of focus level
--
-- This dashboard answers: "Are developers context-switching too much?"

-- ============================================================================
-- Daily Developer Activity View
-- ============================================================================

CREATE OR REPLACE VIEW vw_developer_daily_activity AS
SELECT
  ch.author,
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
WHERE ch.is_merge = FALSE
GROUP BY ch.author, DATE(ch.commit_date), ch.repository;

COMMENT ON VIEW vw_developer_daily_activity IS 'Daily developer activity aggregation for focus analysis. Ticket: IQS-907';

-- ============================================================================
-- Weekly Focus Score View
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

COMMENT ON VIEW vw_developer_focus IS 'Weekly developer focus scores with trend analysis. Ticket: IQS-907';

-- ============================================================================
-- Performance Indexes
-- ============================================================================

-- Index for author + commit_date queries (used by daily activity aggregation)
CREATE INDEX IF NOT EXISTS idx_commit_history_author_date
ON commit_history(author, commit_date);

-- Index for faster commit lookups by date
CREATE INDEX IF NOT EXISTS idx_commit_history_commit_date
ON commit_history(commit_date);
