-- Migration 019: Test Debt Predictor Dashboard views for test coverage analysis
-- Ticket: IQS-913
-- Purpose: Correlate low-test commits with subsequent bugs to predict technical debt
--
-- Design:
--   - vw_commit_test_ratio: Test coverage ratio per commit (test LOC / prod LOC)
--   - vw_subsequent_bugs: Bug tickets filed after commits within correlation window
--   - vw_test_debt: Test debt summary with weekly aggregation and bug rates by tier
--
-- Dependencies:
--   - Migration 001: commit_history, commit_files tables
--   - Migration 004: linear_detail, commit_linear tables
--
-- This dashboard answers: "Which untested changes will cause bugs?"

-- ============================================================================
-- Commit Test Ratio View
-- ============================================================================
-- Calculates test coverage ratio for each commit based on lines of code changed.
-- Test ratio = test LOC changed / production LOC changed
-- Commits with only test files or no production changes have NULL ratio.

CREATE OR REPLACE VIEW vw_commit_test_ratio AS
SELECT
  ch.sha,
  ch.commit_date,
  ch.author,
  ch.repository,
  ch.branch,
  SPLIT_PART(ch.commit_message, E'\n', 1) AS commit_message,

  -- LOC metrics: sum of insertions + deletions
  COALESCE(SUM(cf.line_inserts + cf.line_deletes) FILTER (WHERE NOT cf.is_test_file), 0) AS prod_loc_changed,
  COALESCE(SUM(cf.line_inserts + cf.line_deletes) FILTER (WHERE cf.is_test_file), 0) AS test_loc_changed,

  -- File counts
  COUNT(*) FILTER (WHERE NOT cf.is_test_file) AS prod_files_changed,
  COUNT(*) FILTER (WHERE cf.is_test_file) AS test_files_changed,

  -- Test ratio (test LOC / prod LOC)
  -- NULL when no production code changed (avoiding divide by zero)
  CASE
    WHEN COALESCE(SUM(cf.line_inserts + cf.line_deletes) FILTER (WHERE NOT cf.is_test_file), 0) > 0
    THEN ROUND(
      (COALESCE(SUM(cf.line_inserts + cf.line_deletes) FILTER (WHERE cf.is_test_file), 0)::NUMERIC /
       SUM(cf.line_inserts + cf.line_deletes) FILTER (WHERE NOT cf.is_test_file))::NUMERIC,
      4
    )
    ELSE NULL
  END AS test_ratio,

  -- Linked ticket (Jira or Linear)
  (SELECT cj.jira_key FROM commit_jira cj WHERE cj.sha = ch.sha LIMIT 1) AS jira_ticket_id,
  (SELECT cl.linear_key FROM commit_linear cl WHERE cl.sha = ch.sha LIMIT 1) AS linear_ticket_id

FROM commit_history ch
JOIN commit_files cf ON ch.sha = cf.sha
WHERE ch.is_merge = FALSE
GROUP BY ch.sha, ch.commit_date, ch.author, ch.repository, ch.branch, ch.commit_message;

COMMENT ON VIEW vw_commit_test_ratio IS 'Test coverage ratio per commit (test LOC / prod LOC). Ticket: IQS-913';

-- ============================================================================
-- Subsequent Bugs View
-- ============================================================================
-- Correlates commits with bug tickets filed within 28 days of the commit.
-- A bug is considered related if it touches the same files as the original commit.
-- This is a heuristic: not all bugs are caused by the commit, but high correlation
-- suggests low-test commits lead to more bugs.

CREATE OR REPLACE VIEW vw_subsequent_bugs AS
WITH commit_file_paths AS (
  -- Get all file paths touched by each commit
  SELECT DISTINCT
    cf.sha,
    cf.filename
  FROM commit_files cf
),
jira_bug_commits AS (
  -- Find Jira bug tickets and their associated commits
  SELECT DISTINCT
    cj.sha AS bug_sha,
    jd.jira_key,
    jd.created_date AS bug_created_date
  FROM commit_jira cj
  JOIN jira_detail jd ON cj.jira_key = jd.jira_key
  WHERE LOWER(jd.issuetype) = 'bug'
),
linear_bug_commits AS (
  -- Find Linear bug tickets and their associated commits
  -- Linear bugs are identified by state containing 'bug' pattern
  -- or by having labels that include 'bug'
  SELECT DISTINCT
    cl.sha AS bug_sha,
    ld.linear_key,
    ld.created_date AS bug_created_date
  FROM commit_linear cl
  JOIN linear_detail ld ON cl.linear_key = ld.linear_key
  WHERE LOWER(ld.state) LIKE '%bug%'
     OR LOWER(ld.title) LIKE '%bug%'
     OR LOWER(ld.title) LIKE '%fix%'
)
SELECT
  ctr.sha AS original_sha,
  ctr.commit_date AS original_commit_date,
  ctr.author,
  ctr.repository,
  ctr.test_ratio,
  ctr.prod_loc_changed,
  ctr.test_loc_changed,

  -- Count Jira bugs filed 1-28 days after commit that touch same files
  (SELECT COUNT(DISTINCT jbc.jira_key)
   FROM jira_bug_commits jbc
   JOIN commit_file_paths cfp_bug ON jbc.bug_sha = cfp_bug.sha
   JOIN commit_file_paths cfp_orig ON cfp_orig.sha = ctr.sha
   WHERE cfp_bug.filename = cfp_orig.filename
     AND jbc.bug_created_date > ctr.commit_date
     AND jbc.bug_created_date <= ctr.commit_date + INTERVAL '28 days'
  ) AS jira_bugs_filed,

  -- Count Linear bugs filed 1-28 days after commit that touch same files
  (SELECT COUNT(DISTINCT lbc.linear_key)
   FROM linear_bug_commits lbc
   JOIN commit_file_paths cfp_bug ON lbc.bug_sha = cfp_bug.sha
   JOIN commit_file_paths cfp_orig ON cfp_orig.sha = ctr.sha
   WHERE cfp_bug.filename = cfp_orig.filename
     AND lbc.bug_created_date > ctr.commit_date
     AND lbc.bug_created_date <= ctr.commit_date + INTERVAL '28 days'
  ) AS linear_bugs_filed

FROM vw_commit_test_ratio ctr
WHERE ctr.prod_loc_changed >= 50;  -- Focus on significant changes (50+ LOC)

COMMENT ON VIEW vw_subsequent_bugs IS 'Bug tickets filed within 28 days of commits, correlated by file paths. Ticket: IQS-913';

-- ============================================================================
-- Test Debt Summary View
-- ============================================================================
-- Aggregates test debt metrics by week and repository.
-- Categorizes commits into tiers based on test ratio:
--   - Low test: ratio NULL or < 0.1 (no tests or minimal)
--   - Medium test: ratio 0.1 - 0.5
--   - High test: ratio >= 0.5 (good test coverage)
-- Calculates bug rate per tier to show correlation.

CREATE OR REPLACE VIEW vw_test_debt AS
SELECT
  DATE_TRUNC('week', sb.original_commit_date)::DATE AS week,
  sb.repository,

  -- Commits by test coverage tier
  COUNT(*) FILTER (WHERE sb.test_ratio IS NULL OR sb.test_ratio < 0.1) AS low_test_commits,
  COUNT(*) FILTER (WHERE sb.test_ratio >= 0.1 AND sb.test_ratio < 0.5) AS medium_test_commits,
  COUNT(*) FILTER (WHERE sb.test_ratio >= 0.5) AS high_test_commits,

  -- Total commits
  COUNT(*) AS total_commits,

  -- Bugs by test coverage tier (sum of jira + linear bugs)
  COALESCE(SUM(sb.jira_bugs_filed + sb.linear_bugs_filed)
    FILTER (WHERE sb.test_ratio IS NULL OR sb.test_ratio < 0.1), 0)::INTEGER AS bugs_from_low_test,
  COALESCE(SUM(sb.jira_bugs_filed + sb.linear_bugs_filed)
    FILTER (WHERE sb.test_ratio >= 0.1 AND sb.test_ratio < 0.5), 0)::INTEGER AS bugs_from_medium_test,
  COALESCE(SUM(sb.jira_bugs_filed + sb.linear_bugs_filed)
    FILTER (WHERE sb.test_ratio >= 0.5), 0)::INTEGER AS bugs_from_high_test,

  -- Total bugs
  COALESCE(SUM(sb.jira_bugs_filed + sb.linear_bugs_filed), 0)::INTEGER AS total_bugs,

  -- Bug rate by tier (bugs per commit)
  ROUND(
    CASE
      WHEN COUNT(*) FILTER (WHERE sb.test_ratio IS NULL OR sb.test_ratio < 0.1) > 0
      THEN COALESCE(SUM(sb.jira_bugs_filed + sb.linear_bugs_filed)
             FILTER (WHERE sb.test_ratio IS NULL OR sb.test_ratio < 0.1), 0)::NUMERIC /
           COUNT(*) FILTER (WHERE sb.test_ratio IS NULL OR sb.test_ratio < 0.1)
      ELSE 0
    END, 4
  ) AS low_test_bug_rate,

  ROUND(
    CASE
      WHEN COUNT(*) FILTER (WHERE sb.test_ratio >= 0.1 AND sb.test_ratio < 0.5) > 0
      THEN COALESCE(SUM(sb.jira_bugs_filed + sb.linear_bugs_filed)
             FILTER (WHERE sb.test_ratio >= 0.1 AND sb.test_ratio < 0.5), 0)::NUMERIC /
           COUNT(*) FILTER (WHERE sb.test_ratio >= 0.1 AND sb.test_ratio < 0.5)
      ELSE 0
    END, 4
  ) AS medium_test_bug_rate,

  ROUND(
    CASE
      WHEN COUNT(*) FILTER (WHERE sb.test_ratio >= 0.5) > 0
      THEN COALESCE(SUM(sb.jira_bugs_filed + sb.linear_bugs_filed)
             FILTER (WHERE sb.test_ratio >= 0.5), 0)::NUMERIC /
           COUNT(*) FILTER (WHERE sb.test_ratio >= 0.5)
      ELSE 0
    END, 4
  ) AS high_test_bug_rate,

  -- Average test ratio for the week
  ROUND(AVG(sb.test_ratio)::NUMERIC, 4) AS avg_test_ratio

FROM vw_subsequent_bugs sb
GROUP BY DATE_TRUNC('week', sb.original_commit_date), sb.repository
ORDER BY week DESC, repository;

COMMENT ON VIEW vw_test_debt IS 'Weekly test debt summary with bug rates by test coverage tier. Ticket: IQS-913';

-- ============================================================================
-- Performance Indexes
-- ============================================================================

-- Index for faster commit date filtering and ordering
CREATE INDEX IF NOT EXISTS idx_commit_history_commit_date_repo
ON commit_history(commit_date, repository);

-- Index for faster is_test_file filtering
CREATE INDEX IF NOT EXISTS idx_commit_files_is_test_file
ON commit_files(is_test_file);

-- Index for faster bug type lookup in Jira
CREATE INDEX IF NOT EXISTS idx_jira_detail_issuetype
ON jira_detail(issuetype);
