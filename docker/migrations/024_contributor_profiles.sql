-- Migration 024: Add Contributor Profile Percentile Rankings
-- Ticket: IQS-942
-- Purpose: Calculate contributor percentile rankings within their team for scorecard badges
--
-- Design:
--   - Creates vw_scorecard_percentiles view using PERCENT_RANK() window function
--   - Partitions by team for relative ranking within team
--   - Calculates team median for each metric
--   - Includes commit count per contributor for minimum threshold filtering
--   - Excludes contributors with <5 commits from median calculations
--
-- Output columns:
--   - full_name, team, vendor (from vw_scorecard_detail)
--   - commit_count - number of commits by this contributor
--   - release_assist_percentile, test_percentile, complexity_percentile, comments_percentile
--   - team_release_assist_median, team_test_median, team_complexity_median, team_comments_median
--
-- Dependencies:
--   - Migration 001: commit_history, commit_files, commit_contributors tables
--   - Migration 002: vw_scorecard_detail view
--
-- Performance Note:
--   - PERCENT_RANK() is computed over team partitions (typically <50 rows each)
--   - PERCENTILE_CONT() for median calculation is efficient with team-level aggregation
--   - View materializes only on query - consider creating materialized view if performance issues arise
--
-- Usage Example:
--   SELECT * FROM vw_scorecard_percentiles WHERE commit_count >= 5 ORDER BY team, full_name;

-- ============================================================================
-- Scorecard Percentile Rankings View
-- ============================================================================
-- Calculates percentile rankings for each contributor within their team
-- and provides team median values for comparison.
--
-- Percentile interpretation:
--   - 0.0 = lowest performer in the team
--   - 0.5 = median performer
--   - 1.0 = highest performer in the team
--
-- Badge thresholds (recommended):
--   - Top 10%: percentile >= 0.90 (🏆 Elite)
--   - Top 25%: percentile >= 0.75 (⭐ Star)
--   - Top 50%: percentile >= 0.50 (👍 Above Average)
--   - Bottom 50%: percentile < 0.50 (📊 Needs Improvement)

CREATE OR REPLACE VIEW vw_scorecard_percentiles AS
WITH contributor_commits AS (
  -- Count commits per contributor (using commit_history + commit_contributors join)
  SELECT
    cc.full_name,
    cc.team,
    COUNT(DISTINCT ch.sha) AS commit_count
  FROM commit_history ch
  INNER JOIN commit_contributors cc ON ch.author = cc.login
  WHERE cc.full_name IS NOT NULL
    AND cc.team IS NOT NULL
  GROUP BY cc.full_name, cc.team
),
scorecard_with_commits AS (
  -- Join scorecard detail with commit counts
  SELECT
    vsd.full_name,
    vsd.team,
    vsd.vendor,
    vsd.release_assist_score,
    vsd.test_score,
    vsd.complexity_score,
    vsd.comments_score,
    vsd.code_score,
    COALESCE(ccom.commit_count, 0) AS commit_count
  FROM vw_scorecard_detail vsd
  LEFT JOIN contributor_commits ccom
    ON vsd.full_name = ccom.full_name
    AND vsd.team = ccom.team
),
percentile_rankings AS (
  -- Calculate percentile rank within team for each metric
  SELECT
    full_name,
    team,
    vendor,
    commit_count,
    release_assist_score,
    test_score,
    complexity_score,
    comments_score,
    code_score,

    -- Percentile rankings (0.0 = lowest, 1.0 = highest within team)
    PERCENT_RANK() OVER (
      PARTITION BY team
      ORDER BY release_assist_score
    ) AS release_assist_percentile,

    PERCENT_RANK() OVER (
      PARTITION BY team
      ORDER BY test_score
    ) AS test_percentile,

    PERCENT_RANK() OVER (
      PARTITION BY team
      ORDER BY complexity_score
    ) AS complexity_percentile,

    PERCENT_RANK() OVER (
      PARTITION BY team
      ORDER BY comments_score
    ) AS comments_percentile

  FROM scorecard_with_commits
),
team_medians AS (
  -- Calculate team medians, excluding contributors with <5 commits
  SELECT
    team,

    -- PERCENTILE_CONT(0.5) calculates the median (50th percentile)
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY release_assist_score)::NUMERIC(10,2)
      AS team_release_assist_median,

    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY test_score)::NUMERIC(10,2)
      AS team_test_median,

    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY complexity_score)::NUMERIC(10,2)
      AS team_complexity_median,

    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY comments_score)::NUMERIC(10,2)
      AS team_comments_median

  FROM scorecard_with_commits
  WHERE commit_count >= 5  -- Exclude low-activity contributors from median calculation
  GROUP BY team
)
SELECT
  pr.full_name,
  pr.team,
  pr.vendor,
  pr.commit_count,

  -- Individual scores (for reference)
  pr.release_assist_score,
  pr.test_score,
  pr.complexity_score,
  pr.comments_score,
  pr.code_score,

  -- Percentile rankings within team (0.0 - 1.0)
  ROUND(pr.release_assist_percentile::NUMERIC, 3) AS release_assist_percentile,
  ROUND(pr.test_percentile::NUMERIC, 3) AS test_percentile,
  ROUND(pr.complexity_percentile::NUMERIC, 3) AS complexity_percentile,
  ROUND(pr.comments_percentile::NUMERIC, 3) AS comments_percentile,

  -- Team medians (for comparison)
  tm.team_release_assist_median,
  tm.team_test_median,
  tm.team_complexity_median,
  tm.team_comments_median

FROM percentile_rankings pr
LEFT JOIN team_medians tm ON pr.team = tm.team
ORDER BY pr.team, pr.full_name;

COMMENT ON VIEW vw_scorecard_percentiles IS 'Contributor percentile rankings within team with team medians. Excludes contributors with <5 commits from median calculation. Ticket: IQS-942';
