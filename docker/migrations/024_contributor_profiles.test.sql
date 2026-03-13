-- Test Migration 024: Contributor Profile Percentile Rankings
-- Ticket: IQS-942
-- Purpose: Validate the vw_scorecard_percentiles view calculates percentiles correctly
--
-- Test cases:
--   1. View exists and returns data
--   2. Percentile values are between 0.0 and 1.0
--   3. Commit count is correctly calculated
--   4. Team medians are calculated (excluding contributors with <5 commits)
--   5. All expected columns are present

-- ============================================================================
-- Test 1: View exists and returns data
-- ============================================================================
\echo 'Test 1: Checking if vw_scorecard_percentiles view exists and returns data...'

SELECT COUNT(*) AS total_contributors
FROM vw_scorecard_percentiles;

-- ============================================================================
-- Test 2: Percentile values are in valid range (0.0 - 1.0)
-- ============================================================================
\echo 'Test 2: Validating percentile values are between 0.0 and 1.0...'

SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE release_assist_percentile < 0 OR release_assist_percentile > 1) AS invalid_release_assist,
  COUNT(*) FILTER (WHERE test_percentile < 0 OR test_percentile > 1) AS invalid_test,
  COUNT(*) FILTER (WHERE complexity_percentile < 0 OR complexity_percentile > 1) AS invalid_complexity,
  COUNT(*) FILTER (WHERE comments_percentile < 0 OR comments_percentile > 1) AS invalid_comments
FROM vw_scorecard_percentiles;

-- Expected: All invalid_* columns should be 0

-- ============================================================================
-- Test 3: Commit count validation
-- ============================================================================
\echo 'Test 3: Checking commit count distribution...'

SELECT
  COUNT(*) AS total_contributors,
  COUNT(*) FILTER (WHERE commit_count >= 5) AS contributors_5plus_commits,
  COUNT(*) FILTER (WHERE commit_count < 5) AS contributors_under_5_commits,
  ROUND(AVG(commit_count)::NUMERIC, 2) AS avg_commit_count,
  MAX(commit_count) AS max_commit_count,
  MIN(commit_count) AS min_commit_count
FROM vw_scorecard_percentiles;

-- ============================================================================
-- Test 4: Team median calculation (should only include contributors with >=5 commits)
-- ============================================================================
\echo 'Test 4: Validating team medians are calculated...'

SELECT
  team,
  COUNT(*) AS team_size,
  COUNT(*) FILTER (WHERE commit_count >= 5) AS eligible_for_median,
  team_release_assist_median,
  team_test_median,
  team_complexity_median,
  team_comments_median
FROM vw_scorecard_percentiles
GROUP BY team, team_release_assist_median, team_test_median, team_complexity_median, team_comments_median
ORDER BY team;

-- ============================================================================
-- Test 5: Column existence check
-- ============================================================================
\echo 'Test 5: Verifying all expected columns exist...'

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
  release_assist_percentile,
  test_percentile,
  complexity_percentile,
  comments_percentile,
  team_release_assist_median,
  team_test_median,
  team_complexity_median,
  team_comments_median
FROM vw_scorecard_percentiles
LIMIT 1;

-- ============================================================================
-- Test 6: Percentile ranking verification (spot check)
-- ============================================================================
\echo 'Test 6: Spot checking percentile rankings for a single team...'

WITH team_sample AS (
  SELECT team
  FROM vw_scorecard_percentiles
  GROUP BY team
  HAVING COUNT(*) > 3  -- Pick a team with at least 4 contributors
  LIMIT 1
)
SELECT
  vsp.full_name,
  vsp.team,
  vsp.commit_count,
  vsp.test_score,
  vsp.test_percentile,
  CASE
    WHEN vsp.test_percentile >= 0.75 THEN 'Top 25%'
    WHEN vsp.test_percentile >= 0.50 THEN 'Top 50%'
    WHEN vsp.test_percentile >= 0.25 THEN 'Top 75%'
    ELSE 'Bottom 25%'
  END AS performance_tier
FROM vw_scorecard_percentiles vsp
INNER JOIN team_sample ts ON vsp.team = ts.team
WHERE vsp.commit_count >= 5  -- Only show contributors with sufficient data
ORDER BY vsp.test_percentile DESC;

-- ============================================================================
-- Test 7: Verify PERCENT_RANK() behavior (edge cases)
-- ============================================================================
\echo 'Test 7: Checking edge cases - teams with single contributor...'

SELECT
  team,
  COUNT(*) AS team_size,
  MAX(release_assist_percentile) AS max_percentile,
  MIN(release_assist_percentile) AS min_percentile
FROM vw_scorecard_percentiles
GROUP BY team
HAVING COUNT(*) = 1;

-- Expected: For teams with 1 contributor, percentile should be 0.0 (PERCENT_RANK behavior)

-- ============================================================================
-- Test 8: Compare median with manual calculation (sample team)
-- ============================================================================
\echo 'Test 8: Validating median calculation against manual PERCENTILE_CONT...'

WITH team_sample AS (
  SELECT team
  FROM vw_scorecard_percentiles
  WHERE commit_count >= 5
  GROUP BY team
  HAVING COUNT(*) >= 5
  LIMIT 1
),
manual_median AS (
  SELECT
    vsp.team,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY vsp.test_score) AS manual_test_median
  FROM vw_scorecard_percentiles vsp
  INNER JOIN team_sample ts ON vsp.team = ts.team
  WHERE vsp.commit_count >= 5
  GROUP BY vsp.team
)
SELECT
  vsp.team,
  vsp.team_test_median AS view_test_median,
  mm.manual_test_median,
  ABS(vsp.team_test_median - mm.manual_test_median) AS median_diff
FROM vw_scorecard_percentiles vsp
INNER JOIN manual_median mm ON vsp.team = mm.team
LIMIT 1;

-- Expected: median_diff should be 0.00 or very close to 0

\echo 'All tests complete.'
