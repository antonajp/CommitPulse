-- Migration 015: Ticket Lifecycle Sankey Dashboard views for status transition analysis
-- Ticket: IQS-905
-- Purpose: Aggregate status transitions from Jira and Linear for Sankey visualization
--
-- Design:
--   - status_order: Reference table for canonical status ordering (rework detection)
--   - vw_ticket_transitions: Individual transitions with dwell time and rework flags
--   - vw_transition_matrix: Aggregated FROM -> TO counts for Sankey nodes/links
--
-- Key metrics:
--   1. Dwell time: Time spent in each status before transitioning (hours)
--   2. Rework detection: Transitions that go "backwards" in the workflow
--   3. Transition counts: Volume of tickets following each path
--   4. Status categories: Group statuses into backlog/in_progress/review/done
--
-- This dashboard answers: "Where does work get stuck?"

-- ============================================================================
-- Status Order Reference Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS status_order (
  status_name VARCHAR(100) PRIMARY KEY,
  ordinal INTEGER NOT NULL,
  status_category VARCHAR(50) -- backlog, in_progress, review, done
);

-- Insert canonical status ordering
-- ON CONFLICT ensures idempotency for re-running migration
INSERT INTO status_order (status_name, ordinal, status_category) VALUES
  -- Backlog statuses (ordinal 1-10)
  ('Backlog', 1, 'backlog'),
  ('Todo', 2, 'backlog'),
  ('To Do', 2, 'backlog'),
  ('Open', 3, 'backlog'),
  ('New', 3, 'backlog'),
  ('Defined', 4, 'backlog'),
  ('Ready', 5, 'backlog'),
  ('Ready for Dev', 5, 'backlog'),

  -- In Progress statuses (ordinal 11-20)
  ('Analysis', 11, 'in_progress'),
  ('In Progress', 12, 'in_progress'),
  ('In Dev', 12, 'in_progress'),
  ('In Development', 12, 'in_progress'),
  ('In Progress/Development', 12, 'in_progress'),
  ('Development', 13, 'in_progress'),
  ('Coding', 13, 'in_progress'),

  -- Review statuses (ordinal 21-30)
  ('Code Review', 21, 'review'),
  ('In Review', 22, 'review'),
  ('PR Review', 22, 'review'),
  ('Ready for QA', 23, 'review'),
  ('In QA', 24, 'review'),
  ('QA', 24, 'review'),
  ('Testing', 24, 'review'),
  ('In UAT', 25, 'review'),
  ('In UAT Env', 25, 'review'),
  ('UAT', 25, 'review'),

  -- Done statuses (ordinal 31-40)
  ('Done', 31, 'done'),
  ('Closed', 32, 'done'),
  ('Complete', 32, 'done'),
  ('Completed', 32, 'done'),
  ('Resolved', 33, 'done'),
  ('Deployed', 34, 'done'),
  ('Released', 35, 'done'),
  ('Cancelled', 36, 'done'),
  ('Canceled', 36, 'done'),
  ('Won''t Do', 37, 'done'),
  ('Won''t Fix', 37, 'done'),
  ('Duplicate', 38, 'done')
ON CONFLICT (status_name) DO NOTHING;

COMMENT ON TABLE status_order IS 'Canonical status ordering for ticket lifecycle rework detection. Ticket: IQS-905';

-- ============================================================================
-- Performance indexes for lifecycle queries
-- ============================================================================

-- Index for status field filter in jira_history
CREATE INDEX IF NOT EXISTS idx_jira_history_field_status ON jira_history(field) WHERE field = 'status';

-- Index for field filter in linear_history
CREATE INDEX IF NOT EXISTS idx_linear_history_field_status ON linear_history(field) WHERE field = 'status';

-- Index for change_date ordering
CREATE INDEX IF NOT EXISTS idx_jira_history_change_date ON jira_history(jira_key, change_date);
CREATE INDEX IF NOT EXISTS idx_linear_history_change_date ON linear_history(linear_key, change_date);

-- ============================================================================
-- Ticket Transitions View
-- ============================================================================

CREATE OR REPLACE VIEW vw_ticket_transitions AS
WITH jira_transitions AS (
  SELECT
    jh.jira_key AS ticket_id,
    'jira' AS ticket_type,
    jh.from_value AS from_status,
    jh.to_value AS to_status,
    jh.change_date AS transition_time,
    LAG(jh.change_date) OVER (
      PARTITION BY jh.jira_key
      ORDER BY jh.change_date
    ) AS previous_transition,
    jd.assignee,
    jd.issuetype AS issue_type
  FROM jira_history jh
  JOIN jira_detail jd ON jh.jira_key = jd.jira_key
  WHERE jh.field = 'status'
),
linear_transitions AS (
  SELECT
    lh.linear_key AS ticket_id,
    'linear' AS ticket_type,
    lh.from_value AS from_status,
    lh.to_value AS to_status,
    lh.change_date AS transition_time,
    LAG(lh.change_date) OVER (
      PARTITION BY lh.linear_key
      ORDER BY lh.change_date
    ) AS previous_transition,
    ld.assignee,
    'Story' AS issue_type -- Linear doesn't have issue types
  FROM linear_history lh
  JOIN linear_detail ld ON lh.linear_key = ld.linear_key
  WHERE lh.field = 'status'
),
all_transitions AS (
  SELECT * FROM jira_transitions
  UNION ALL
  SELECT * FROM linear_transitions
)
SELECT
  t.ticket_id,
  t.ticket_type,
  t.from_status,
  t.to_status,
  t.transition_time,
  t.assignee,
  t.issue_type,

  -- Dwell time in previous status (hours)
  -- NULL for first transition (no previous status)
  CASE
    WHEN t.previous_transition IS NOT NULL
    THEN ROUND((EXTRACT(EPOCH FROM (t.transition_time - t.previous_transition)) / 3600)::NUMERIC, 2)
    ELSE NULL
  END AS dwell_hours,

  -- Is this a rework transition? (moving backwards in status order)
  CASE
    WHEN so_from.ordinal IS NOT NULL
      AND so_to.ordinal IS NOT NULL
      AND so_from.ordinal > so_to.ordinal
    THEN TRUE
    ELSE FALSE
  END AS is_rework,

  -- Status categories for grouping
  COALESCE(so_from.status_category, 'unknown') AS from_category,
  COALESCE(so_to.status_category, 'unknown') AS to_category

FROM all_transitions t
LEFT JOIN status_order so_from ON LOWER(TRIM(t.from_status)) = LOWER(so_from.status_name)
LEFT JOIN status_order so_to ON LOWER(TRIM(t.to_status)) = LOWER(so_to.status_name)
WHERE t.from_status IS NOT NULL
  AND t.to_status IS NOT NULL
  AND t.from_status <> t.to_status;

COMMENT ON VIEW vw_ticket_transitions IS 'Individual ticket status transitions with dwell time and rework detection. Ticket: IQS-905';

-- ============================================================================
-- Transition Matrix View (Sankey Aggregation)
-- ============================================================================

CREATE OR REPLACE VIEW vw_transition_matrix AS
SELECT
  from_status,
  to_status,
  from_category,
  to_category,
  COUNT(*) AS transition_count,
  ROUND(AVG(dwell_hours)::NUMERIC, 2) AS avg_dwell_hours,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dwell_hours)::NUMERIC, 2) AS median_dwell_hours,
  COUNT(*) FILTER (WHERE is_rework) AS rework_count,
  COUNT(DISTINCT ticket_id) AS unique_tickets
FROM vw_ticket_transitions
WHERE transition_time >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY from_status, to_status, from_category, to_category
ORDER BY transition_count DESC;

COMMENT ON VIEW vw_transition_matrix IS 'Aggregated transition matrix for Sankey diagram: FROM -> TO with counts and dwell times. Ticket: IQS-905';
