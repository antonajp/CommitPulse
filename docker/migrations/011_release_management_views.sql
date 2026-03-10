-- Migration 011: Release Management Contribution views
-- Ticket: IQS-898
--
-- Creates views for tracking release management contributions:
--   1. vw_release_environment_mapping - Maps branches to environments (Production/Staging/Dev)
--   2. vw_release_contributions - Aggregates release activity by contributor and environment
--
-- The views support the "Release Management Contributions" chart:
--   - Track merge commits per team member by environment
--   - Track release tags and release branch creation
--   - Convention-based branch categorization with configurable overrides
--
-- All views use CREATE OR REPLACE for idempotency.

-- ============================================================================
-- Branch to Environment Mapping View
-- ============================================================================

-- Maps branch names to deployment environments using convention-based rules.
-- These conventions match common Git flow patterns:
--   - Production: main, master, prod, production, release/*
--   - Staging: staging, stage, uat, preprod, pre-production, develop, dev
--   - Dev: feature/*, bugfix/*, hotfix/*, dev/*, all other branches
--
-- Override via application-level configuration if needed (see settings.ts).
CREATE OR REPLACE VIEW vw_release_environment_mapping AS
SELECT
  DISTINCT branch,
  CASE
    -- Production branches (main/master/prod/release)
    WHEN branch IN ('main', 'master', 'prod', 'production') THEN 'Production'
    WHEN branch LIKE 'release/%' THEN 'Production'

    -- Staging branches (staging/uat/develop)
    WHEN branch IN ('staging', 'stage', 'uat', 'preprod', 'pre-production', 'develop', 'dev') THEN 'Staging'

    -- Everything else is Dev (feature branches, bugfix, hotfix, etc.)
    ELSE 'Dev'
  END AS environment
FROM commit_branch_relationship
WHERE branch IS NOT NULL;

-- ============================================================================
-- Release Tag Analysis View
-- ============================================================================

-- Identifies commits that created release tags.
-- Release tags typically follow semantic versioning patterns: v1.0.0, release-2024-03-07, etc.
CREATE OR REPLACE VIEW vw_release_tags AS
SELECT
  ct.sha,
  ct.tag,
  ct.author,
  ch.commit_date,
  ch.branch,
  ch.repository,
  cc.full_name,
  cc.team,
  CASE
    -- Semantic versioning tags (v1.0.0, 1.0.0)
    WHEN ct.tag ~ '^v?[0-9]+\.[0-9]+\.[0-9]+' THEN 'Semantic Version'

    -- Date-based release tags (release-2024-03-07, rel-20240307)
    WHEN ct.tag ~ '^(release|rel)-[0-9]{4}' THEN 'Date Release'

    -- Named releases (production-rollout, hotfix-auth)
    WHEN ct.tag ~ '^(production|prod|hotfix|release)' THEN 'Named Release'

    -- All other tags
    ELSE 'Other Tag'
  END AS tag_type
FROM commit_tags ct
  INNER JOIN commit_history ch ON ct.sha = ch.sha
  LEFT JOIN commit_contributors cc ON ct.author = cc.login
WHERE ct.tag IS NOT NULL;

-- ============================================================================
-- Merge Commit Analysis View
-- ============================================================================

-- Identifies merge commits and categorizes them by target environment.
-- Merge commits are the primary indicator of release activity.
CREATE OR REPLACE VIEW vw_merge_commits_by_environment AS
SELECT
  ch.sha,
  ch.author,
  ch.commit_date,
  ch.branch,
  ch.repository,
  ch.commit_message,
  cc.full_name,
  cc.team,
  COALESCE(env.environment, 'Unknown') AS environment
FROM commit_history ch
  LEFT JOIN commit_contributors cc ON ch.author = cc.login
  LEFT JOIN vw_release_environment_mapping env ON ch.branch = env.branch
WHERE ch.is_merge = TRUE;

-- ============================================================================
-- Release Contributions Aggregation View
-- ============================================================================

-- Aggregates all release-related activity by contributor and environment.
-- Combines merge commits and release tag creation.
-- This is the primary view for the Release Management Contributions chart.
CREATE OR REPLACE VIEW vw_release_contributions AS
WITH merge_activity AS (
  -- Merge commits grouped by author, team, environment
  SELECT
    author,
    full_name,
    team,
    environment,
    repository,
    COUNT(*)::INT AS merge_count,
    MIN(commit_date) AS first_merge_date,
    MAX(commit_date) AS last_merge_date
  FROM vw_merge_commits_by_environment
  GROUP BY author, full_name, team, environment, repository
),
tag_activity AS (
  -- Release tags grouped by author, team
  SELECT
    author,
    full_name,
    team,
    repository,
    COUNT(*)::INT AS tag_count,
    MIN(commit_date) AS first_tag_date,
    MAX(commit_date) AS last_tag_date
  FROM vw_release_tags
  WHERE tag_type IN ('Semantic Version', 'Date Release', 'Named Release')
  GROUP BY author, full_name, team, repository
)
-- Combine merge and tag activity
SELECT
  COALESCE(ma.author, ta.author) AS author,
  COALESCE(ma.full_name, ta.full_name) AS full_name,
  COALESCE(ma.team, ta.team) AS team,
  COALESCE(ma.repository, ta.repository) AS repository,
  ma.environment,
  COALESCE(ma.merge_count, 0) AS merge_count,
  COALESCE(ta.tag_count, 0) AS tag_count,
  ma.first_merge_date,
  ma.last_merge_date,
  ta.first_tag_date,
  ta.last_tag_date
FROM merge_activity ma
  FULL OUTER JOIN tag_activity ta
    ON ma.author = ta.author
    AND ma.repository = ta.repository;

-- ============================================================================
-- Release Contributions Summary by Team Member (Time-Boxed)
-- ============================================================================

-- Time-boxed summary for chart rendering (default 30-day window).
-- This view will be queried with date range parameters from the TypeScript layer.
CREATE OR REPLACE VIEW vw_release_contributions_summary AS
SELECT
  rc.author,
  rc.full_name,
  rc.team,
  rc.environment,
  SUM(rc.merge_count)::INT AS total_merge_count,
  SUM(rc.tag_count)::INT AS total_tag_count,
  COUNT(DISTINCT rc.repository)::INT AS repository_count,
  MIN(LEAST(rc.first_merge_date, rc.first_tag_date)) AS earliest_activity,
  MAX(GREATEST(rc.last_merge_date, rc.last_tag_date)) AS latest_activity
FROM vw_release_contributions rc
GROUP BY rc.author, rc.full_name, rc.team, rc.environment
ORDER BY total_merge_count DESC, total_tag_count DESC;

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Index on commit_history.is_merge for fast merge commit filtering
CREATE INDEX IF NOT EXISTS idx_commit_history_is_merge
  ON commit_history (is_merge)
  WHERE is_merge = TRUE;

-- Index on commit_history(commit_date, is_merge) for time-range queries
CREATE INDEX IF NOT EXISTS idx_commit_history_merge_date
  ON commit_history (commit_date, is_merge)
  WHERE is_merge = TRUE;

-- Index on commit_branch_relationship.branch for environment mapping
CREATE INDEX IF NOT EXISTS idx_commit_branch_relationship_branch
  ON commit_branch_relationship (branch);

-- Index on commit_tags.tag for release tag filtering
CREATE INDEX IF NOT EXISTS idx_commit_tags_tag
  ON commit_tags (tag);

-- Composite index on commit_history(repository, branch, is_merge, commit_date)
-- Supports queries filtered by repository and time range
CREATE INDEX IF NOT EXISTS idx_commit_history_repo_branch_merge_date
  ON commit_history (repository, branch, is_merge, commit_date)
  WHERE is_merge = TRUE;
