-- Migration 023: Expand Commit Hygiene prefix detection to include Jira ticket prefixes
-- Ticket: IQS-939
-- Purpose: Recognize commits with Jira ticket prefixes (e.g., [AST4-902]:, JIRA-123:) as valid
--
-- Design:
--   - Extends prefix detection to include Jira ticket patterns
--   - Adds has_ticket_prefix field to vw_commit_hygiene view
--   - Adds ticket_reference field to extract the ticket ID
--   - Updates prefix_score to award 30 points for EITHER conventional OR ticket prefix
--
-- Pattern matches:
--   - Standard conventional: feat:, fix:, docs:, style:, refactor:, test:, chore:, build:, ci:, perf:, revert:
--   - Jira ticket: [PROJ-123]:, PROJ-123:, PROJ-123 :, [PROJ-123] :
--   - Branch-style: [bugfix/PROJ-123]:, [feature/ABC-456]:
--
-- Dependencies:
--   - Migration 001: commit_history, commit_files tables
--   - Migration 010: commit_contributors table
--   - Migration 020: Original vw_commit_hygiene view
--
-- Security Note:
--   - Regex is bounded to prevent ReDoS attacks (max 10 letter prefix, max 7 digit number)
--   - No nested quantifiers used

-- ============================================================================
-- Drop dependent views first (must recreate in dependency order)
-- ============================================================================
DROP VIEW IF EXISTS vw_commit_hygiene_weekly CASCADE;
DROP VIEW IF EXISTS vw_commit_hygiene_by_author CASCADE;
DROP VIEW IF EXISTS vw_commit_hygiene CASCADE;

-- ============================================================================
-- Commit Hygiene View (Enhanced with Ticket Prefix Detection)
-- ============================================================================
-- Calculates hygiene score for each commit based on multiple factors:
--   1. Conventional commit prefix OR Jira ticket prefix - 30 points
--   2. Message length (50-72 chars for subject) - 20 points
--   3. Proper capitalization (subject starts with capital) - 10 points
--   4. No trailing period in subject - 5 points
--   5. Scope present (feat(scope):) - 10 points
--   6. Body present (multi-line message) - 15 points
--   7. Breaking change notation (!: or BREAKING CHANGE:) - 10 points (bonus if applicable)
--
-- Total max: 100 points (with some bonus potential for special cases)

CREATE OR REPLACE VIEW vw_commit_hygiene AS
WITH commit_analysis AS (
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

    -- Extract first line (subject)
    SPLIT_PART(ch.commit_message, E'\n', 1) AS subject_line,

    -- Check for conventional commit prefix (case-insensitive)
    -- Matches: feat:, fix:, docs:, style:, refactor:, test:, chore:, build:, ci:, perf:, revert:
    CASE
      WHEN ch.commit_message ~* '^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\(.+?\))?!?:'
      THEN TRUE
      ELSE FALSE
    END AS has_conventional_prefix,

    -- Check for Jira/Linear ticket prefix (case-insensitive)
    -- Pattern: [PROJ-123]:, PROJ-123:, PROJ-123 :, [bugfix/PROJ-123]:, [feature/ABC-456]:
    -- Project keys can be alphanumeric (e.g., AST4, ABC123)
    -- Bounded: 2-10 characters, 1-7 digits to prevent ReDoS
    CASE
      WHEN ch.commit_message ~* '^\[?([a-z/_-]*)?[A-Z0-9]{2,10}-[1-9][0-9]{0,6}\]?\s*:'
      THEN TRUE
      ELSE FALSE
    END AS has_ticket_prefix,

    -- Extract the ticket reference if present (for display purposes)
    (regexp_match(ch.commit_message, '^\[?(?:[a-z/_-]*)?([A-Z0-9]{2,10}-[1-9][0-9]{0,6})\]?\s*:', 'i'))[1] AS ticket_reference,

    -- Extract the conventional commit type
    CASE
      WHEN ch.commit_message ~* '^feat(\(.+?\))?!?:' THEN 'feat'
      WHEN ch.commit_message ~* '^fix(\(.+?\))?!?:' THEN 'fix'
      WHEN ch.commit_message ~* '^docs(\(.+?\))?!?:' THEN 'docs'
      WHEN ch.commit_message ~* '^style(\(.+?\))?!?:' THEN 'style'
      WHEN ch.commit_message ~* '^refactor(\(.+?\))?!?:' THEN 'refactor'
      WHEN ch.commit_message ~* '^test(\(.+?\))?!?:' THEN 'test'
      WHEN ch.commit_message ~* '^chore(\(.+?\))?!?:' THEN 'chore'
      WHEN ch.commit_message ~* '^build(\(.+?\))?!?:' THEN 'build'
      WHEN ch.commit_message ~* '^ci(\(.+?\))?!?:' THEN 'ci'
      WHEN ch.commit_message ~* '^perf(\(.+?\))?!?:' THEN 'perf'
      WHEN ch.commit_message ~* '^revert(\(.+?\))?!?:' THEN 'revert'
      ELSE NULL
    END AS commit_type,

    -- Check for scope in parentheses: feat(scope): or fix(api):
    CASE
      WHEN ch.commit_message ~* '^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)\(.+?\)!?:'
      THEN TRUE
      ELSE FALSE
    END AS has_scope,

    -- Extract scope if present
    (regexp_match(ch.commit_message, '^\w+\((.+?)\)!?:', 'i'))[1] AS scope,

    -- Check for breaking change indicator (! before :)
    CASE
      WHEN ch.commit_message ~ '^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\(.+?\))?!:'
        OR ch.commit_message ~* 'BREAKING CHANGE:'
      THEN TRUE
      ELSE FALSE
    END AS is_breaking_change,

    -- Subject line length
    LENGTH(SPLIT_PART(ch.commit_message, E'\n', 1)) AS subject_length,

    -- Check if subject starts with capital after prefix (for conventional commits)
    -- or after ticket prefix (for ticket-prefixed commits)
    CASE
      WHEN SPLIT_PART(ch.commit_message, E'\n', 1) ~ ':\s*[A-Z]'
        OR (NOT ch.commit_message ~* '^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)'
            AND NOT ch.commit_message ~* '^\[?([a-z/_-]*)?[A-Z]{2,10}-[1-9][0-9]{0,6}\]?\s*:'
            AND SPLIT_PART(ch.commit_message, E'\n', 1) ~ '^[A-Z]')
      THEN TRUE
      ELSE FALSE
    END AS has_proper_capitalization,

    -- Check if subject ends with period (it shouldn't)
    CASE
      WHEN TRIM(SPLIT_PART(ch.commit_message, E'\n', 1)) ~ '\.$'
      THEN FALSE
      ELSE TRUE
    END AS no_trailing_period,

    -- Check for body (more than one line with content after blank line)
    CASE
      WHEN ch.commit_message ~ E'\n\n.+'
      THEN TRUE
      ELSE FALSE
    END AS has_body,

    -- Count total lines in message
    ARRAY_LENGTH(STRING_TO_ARRAY(ch.commit_message, E'\n'), 1) AS message_line_count,

    -- Join with contributor info
    cc.full_name,
    cc.team

  FROM commit_history ch
  LEFT JOIN commit_contributors cc ON ch.author = cc.login
  WHERE ch.is_merge = FALSE
),
scored_commits AS (
  SELECT
    ca.*,

    -- Calculate individual scores
    -- Prefix score: 30 points for EITHER conventional prefix OR ticket prefix
    CASE WHEN ca.has_conventional_prefix OR ca.has_ticket_prefix THEN 30 ELSE 0 END AS prefix_score,

    -- Subject length score: ideal is 50-72 characters
    CASE
      WHEN ca.subject_length BETWEEN 10 AND 50 THEN 20
      WHEN ca.subject_length BETWEEN 51 AND 72 THEN 20
      WHEN ca.subject_length BETWEEN 73 AND 100 THEN 10
      WHEN ca.subject_length > 100 THEN 0
      ELSE 5  -- Very short messages
    END AS length_score,

    CASE WHEN ca.has_proper_capitalization THEN 10 ELSE 0 END AS capitalization_score,
    CASE WHEN ca.no_trailing_period THEN 5 ELSE 0 END AS period_score,
    CASE WHEN ca.has_scope THEN 10 ELSE 0 END AS scope_score,
    CASE WHEN ca.has_body THEN 15 ELSE 0 END AS body_score,

    -- Breaking change is a bonus for proper notation when applicable
    CASE WHEN ca.is_breaking_change THEN 10 ELSE 0 END AS breaking_change_score

  FROM commit_analysis ca
)
SELECT
  sc.sha,
  sc.commit_date,
  sc.author,
  sc.repository,
  sc.branch,
  sc.subject_line AS commit_message_subject,
  sc.file_count,
  sc.lines_added,
  sc.lines_removed,
  sc.full_name,
  sc.team,

  -- Conventional commit details
  sc.has_conventional_prefix,
  sc.has_ticket_prefix,
  sc.ticket_reference,
  sc.commit_type,
  sc.has_scope,
  sc.scope,
  sc.is_breaking_change,
  sc.has_body,
  sc.subject_length,
  sc.has_proper_capitalization,
  sc.no_trailing_period,
  sc.message_line_count,

  -- Individual scores
  sc.prefix_score,
  sc.length_score,
  sc.capitalization_score,
  sc.period_score,
  sc.scope_score,
  sc.body_score,
  sc.breaking_change_score,

  -- Total hygiene score (capped at 100)
  LEAST(
    sc.prefix_score + sc.length_score + sc.capitalization_score +
    sc.period_score + sc.scope_score + sc.body_score + sc.breaking_change_score,
    100
  ) AS hygiene_score,

  -- Quality tier based on hygiene score
  CASE
    WHEN (sc.prefix_score + sc.length_score + sc.capitalization_score +
          sc.period_score + sc.scope_score + sc.body_score + sc.breaking_change_score) >= 80
    THEN 'excellent'
    WHEN (sc.prefix_score + sc.length_score + sc.capitalization_score +
          sc.period_score + sc.scope_score + sc.body_score + sc.breaking_change_score) >= 60
    THEN 'good'
    WHEN (sc.prefix_score + sc.length_score + sc.capitalization_score +
          sc.period_score + sc.scope_score + sc.body_score + sc.breaking_change_score) >= 40
    THEN 'fair'
    ELSE 'poor'
  END AS quality_tier,

  -- Linked ticket (Jira or Linear)
  (SELECT cj.jira_key FROM commit_jira cj WHERE cj.sha = sc.sha LIMIT 1) AS jira_ticket_id,
  (SELECT cl.linear_key FROM commit_linear cl WHERE cl.sha = sc.sha LIMIT 1) AS linear_ticket_id

FROM scored_commits sc
ORDER BY sc.commit_date DESC;

COMMENT ON VIEW vw_commit_hygiene IS 'Hygiene score per commit (0-100) with quality tier. Supports conventional commits and Jira ticket prefixes. Ticket: IQS-939';

-- ============================================================================
-- Commit Hygiene Summary View (by author)
-- ============================================================================
-- Aggregates hygiene metrics by author for team-level analysis.

CREATE OR REPLACE VIEW vw_commit_hygiene_by_author AS
SELECT
  author,
  full_name,
  team,
  repository,

  -- Commit counts
  COUNT(*) AS total_commits,
  COUNT(*) FILTER (WHERE has_conventional_prefix) AS conventional_commits,
  COUNT(*) FILTER (WHERE has_ticket_prefix) AS ticket_prefix_commits,
  COUNT(*) FILTER (WHERE has_conventional_prefix OR has_ticket_prefix) AS any_prefix_commits,
  COUNT(*) FILTER (WHERE has_scope) AS scoped_commits,
  COUNT(*) FILTER (WHERE has_body) AS commits_with_body,
  COUNT(*) FILTER (WHERE is_breaking_change) AS breaking_changes,

  -- Quality tier distribution
  COUNT(*) FILTER (WHERE quality_tier = 'excellent') AS excellent_count,
  COUNT(*) FILTER (WHERE quality_tier = 'good') AS good_count,
  COUNT(*) FILTER (WHERE quality_tier = 'fair') AS fair_count,
  COUNT(*) FILTER (WHERE quality_tier = 'poor') AS poor_count,

  -- Commit type distribution
  COUNT(*) FILTER (WHERE commit_type = 'feat') AS feat_count,
  COUNT(*) FILTER (WHERE commit_type = 'fix') AS fix_count,
  COUNT(*) FILTER (WHERE commit_type = 'docs') AS docs_count,
  COUNT(*) FILTER (WHERE commit_type = 'refactor') AS refactor_count,
  COUNT(*) FILTER (WHERE commit_type = 'test') AS test_count,
  COUNT(*) FILTER (WHERE commit_type = 'chore') AS chore_count,
  COUNT(*) FILTER (WHERE commit_type IN ('style', 'build', 'ci', 'perf', 'revert')) AS other_count,

  -- Average metrics
  ROUND(AVG(hygiene_score)::NUMERIC, 2) AS avg_hygiene_score,
  ROUND(AVG(subject_length)::NUMERIC, 1) AS avg_subject_length,

  -- Percentage metrics
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_conventional_prefix OR has_ticket_prefix) / NULLIF(COUNT(*), 0), 1) AS any_prefix_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_conventional_prefix) / NULLIF(COUNT(*), 0), 1) AS conventional_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier IN ('excellent', 'good')) / NULLIF(COUNT(*), 0), 1) AS good_or_better_pct

FROM vw_commit_hygiene
GROUP BY author, full_name, team, repository
ORDER BY avg_hygiene_score DESC;

COMMENT ON VIEW vw_commit_hygiene_by_author IS 'Aggregated hygiene metrics by author for team-level commit quality analysis. Ticket: IQS-939';

-- ============================================================================
-- Weekly Hygiene Trend View
-- ============================================================================
-- Shows hygiene trends over time by week for trend analysis.

CREATE OR REPLACE VIEW vw_commit_hygiene_weekly AS
SELECT
  DATE_TRUNC('week', commit_date)::DATE AS week,
  repository,

  -- Commit counts
  COUNT(*) AS total_commits,
  COUNT(*) FILTER (WHERE has_conventional_prefix) AS conventional_commits,
  COUNT(*) FILTER (WHERE has_ticket_prefix) AS ticket_prefix_commits,
  COUNT(*) FILTER (WHERE has_conventional_prefix OR has_ticket_prefix) AS any_prefix_commits,

  -- Quality tier distribution
  COUNT(*) FILTER (WHERE quality_tier = 'excellent') AS excellent_count,
  COUNT(*) FILTER (WHERE quality_tier = 'good') AS good_count,
  COUNT(*) FILTER (WHERE quality_tier = 'fair') AS fair_count,
  COUNT(*) FILTER (WHERE quality_tier = 'poor') AS poor_count,

  -- Commit type distribution
  COUNT(*) FILTER (WHERE commit_type = 'feat') AS feat_count,
  COUNT(*) FILTER (WHERE commit_type = 'fix') AS fix_count,
  COUNT(*) FILTER (WHERE commit_type IN ('docs', 'style', 'refactor', 'test', 'chore', 'build', 'ci', 'perf', 'revert')) AS other_type_count,

  -- Average hygiene score
  ROUND(AVG(hygiene_score)::NUMERIC, 2) AS avg_hygiene_score,

  -- Percentage of any prefix commits (conventional OR ticket)
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_conventional_prefix OR has_ticket_prefix) / NULLIF(COUNT(*), 0), 1) AS any_prefix_pct,

  -- Legacy: conventional_pct for backwards compatibility
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_conventional_prefix) / NULLIF(COUNT(*), 0), 1) AS conventional_pct,

  -- Percentage of good or excellent commits
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier IN ('excellent', 'good')) / NULLIF(COUNT(*), 0), 1) AS good_or_better_pct

FROM vw_commit_hygiene
GROUP BY DATE_TRUNC('week', commit_date), repository
ORDER BY week DESC, repository;

COMMENT ON VIEW vw_commit_hygiene_weekly IS 'Weekly hygiene trends for commit quality trend analysis. Ticket: IQS-939';
