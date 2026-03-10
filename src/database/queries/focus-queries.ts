/**
 * Parameterized SQL queries for the Developer Focus Score Dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against the vw_developer_daily_activity and vw_developer_focus
 * views created by migration 016_developer_focus.sql.
 *
 * The views calculate:
 *   1. Daily developer activity aggregation
 *   2. Weekly focus scores based on context switching
 *   3. Focus category classification
 *   4. Week-over-week trend analysis
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-907
 */

import type { FocusCategory } from '../../services/developer-focus-types.js';

/**
 * Maximum number of result rows returned to prevent memory exhaustion.
 * Applied as LIMIT in each query.
 */
export const FOCUS_QUERY_MAX_ROWS = 1000;

// ============================================================================
// View Existence Checks
// ============================================================================

/**
 * Query to check if the vw_developer_daily_activity view exists.
 * Used for graceful degradation if migration 016 has not been applied.
 */
export const QUERY_DAILY_ACTIVITY_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_developer_daily_activity'
  ) AS view_exists
`;

/**
 * Query to check if the vw_developer_focus view exists.
 * Used for graceful degradation if migration 016 has not been applied.
 */
export const QUERY_FOCUS_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_developer_focus'
  ) AS view_exists
`;

// ============================================================================
// Daily Activity Queries
// ============================================================================

/**
 * Query to fetch all daily activities from the view.
 * Returns activities ordered by commit_day DESC.
 * Limited to FOCUS_QUERY_MAX_ROWS for safety.
 */
export const QUERY_DAILY_ACTIVITY_ALL = `
  SELECT
    author,
    commit_day,
    repository,
    commit_count,
    unique_tickets,
    unique_files,
    total_loc_changed,
    ticket_switches
  FROM vw_developer_daily_activity
  ORDER BY commit_day DESC
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch daily activities with date range filter.
 * Parameters:
 *   $1 - start_date (DATE) - start of date range
 *   $2 - end_date (DATE) - end of date range
 */
export const QUERY_DAILY_ACTIVITY_BY_DATE_RANGE = `
  SELECT
    author,
    commit_day,
    repository,
    commit_count,
    unique_tickets,
    unique_files,
    total_loc_changed,
    ticket_switches
  FROM vw_developer_daily_activity
  WHERE commit_day >= $1::DATE
    AND commit_day <= $2::DATE
  ORDER BY commit_day DESC
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch daily activities with author filter.
 * Parameters:
 *   $1 - author (TEXT) - author to filter by
 */
export const QUERY_DAILY_ACTIVITY_BY_AUTHOR = `
  SELECT
    author,
    commit_day,
    repository,
    commit_count,
    unique_tickets,
    unique_files,
    total_loc_changed,
    ticket_switches
  FROM vw_developer_daily_activity
  WHERE LOWER(author) = LOWER($1)
  ORDER BY commit_day DESC
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch daily activities with combined filters.
 * NULL values are treated as "no filter" via COALESCE/OR patterns.
 *
 * Parameters:
 *   $1 - start_date (DATE) - start of date range (nullable)
 *   $2 - end_date (DATE) - end of date range (nullable)
 *   $3 - author (TEXT) - author filter (nullable)
 */
export const QUERY_DAILY_ACTIVITY_COMBINED = `
  SELECT
    author,
    commit_day,
    repository,
    commit_count,
    unique_tickets,
    unique_files,
    total_loc_changed,
    ticket_switches
  FROM vw_developer_daily_activity
  WHERE (commit_day >= $1::DATE OR $1 IS NULL)
    AND (commit_day <= $2::DATE OR $2 IS NULL)
    AND (LOWER(author) = LOWER($3) OR $3 IS NULL)
  ORDER BY commit_day DESC
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

// ============================================================================
// Focus Score Queries
// ============================================================================

/**
 * Query to fetch all focus scores from the view.
 * Returns scores ordered by week_start DESC, author ASC.
 * Limited to FOCUS_QUERY_MAX_ROWS for safety.
 */
export const QUERY_FOCUS_ALL = `
  SELECT
    author,
    week_start,
    total_commits,
    total_unique_tickets,
    total_unique_files,
    total_loc,
    active_days,
    avg_tickets_per_day,
    focus_score,
    loc_per_commit,
    commits_per_ticket,
    focus_category,
    focus_score_delta
  FROM vw_developer_focus
  ORDER BY week_start DESC, author
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch focus scores with date range filter.
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range
 *   $2 - end_date (TIMESTAMP) - end of date range
 */
export const QUERY_FOCUS_BY_DATE_RANGE = `
  SELECT
    author,
    week_start,
    total_commits,
    total_unique_tickets,
    total_unique_files,
    total_loc,
    active_days,
    avg_tickets_per_day,
    focus_score,
    loc_per_commit,
    commits_per_ticket,
    focus_category,
    focus_score_delta
  FROM vw_developer_focus
  WHERE week_start >= $1::TIMESTAMP
    AND week_start <= $2::TIMESTAMP
  ORDER BY week_start DESC, author
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch focus scores with author filter.
 * Parameters:
 *   $1 - author (TEXT) - author to filter by
 */
export const QUERY_FOCUS_BY_AUTHOR = `
  SELECT
    author,
    week_start,
    total_commits,
    total_unique_tickets,
    total_unique_files,
    total_loc,
    active_days,
    avg_tickets_per_day,
    focus_score,
    loc_per_commit,
    commits_per_ticket,
    focus_category,
    focus_score_delta
  FROM vw_developer_focus
  WHERE LOWER(author) = LOWER($1)
  ORDER BY week_start DESC, author
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch focus scores with focus category filter.
 * Parameters:
 *   $1 - focus_category (TEXT) - category to filter by
 */
export const QUERY_FOCUS_BY_CATEGORY = `
  SELECT
    author,
    week_start,
    total_commits,
    total_unique_tickets,
    total_unique_files,
    total_loc,
    active_days,
    avg_tickets_per_day,
    focus_score,
    loc_per_commit,
    commits_per_ticket,
    focus_category,
    focus_score_delta
  FROM vw_developer_focus
  WHERE focus_category = $1
  ORDER BY week_start DESC, author
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

/**
 * Query to fetch focus scores with combined filters.
 * NULL values are treated as "no filter" via COALESCE/OR patterns.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range (nullable)
 *   $2 - end_date (TIMESTAMP) - end of date range (nullable)
 *   $3 - author (TEXT) - author filter (nullable)
 *   $4 - focus_category (TEXT) - focus category filter (nullable)
 */
export const QUERY_FOCUS_COMBINED = `
  SELECT
    author,
    week_start,
    total_commits,
    total_unique_tickets,
    total_unique_files,
    total_loc,
    active_days,
    avg_tickets_per_day,
    focus_score,
    loc_per_commit,
    commits_per_ticket,
    focus_category,
    focus_score_delta
  FROM vw_developer_focus
  WHERE (week_start >= $1::TIMESTAMP OR $1 IS NULL)
    AND (week_start <= $2::TIMESTAMP OR $2 IS NULL)
    AND (LOWER(author) = LOWER($3) OR $3 IS NULL)
    AND (focus_category = $4 OR $4 IS NULL)
  ORDER BY week_start DESC, author
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

// ============================================================================
// Summary and Statistics Queries
// ============================================================================

/**
 * Query to get focus summary statistics.
 * Returns aggregate counts by focus category.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range (nullable)
 *   $2 - end_date (TIMESTAMP) - end of date range (nullable)
 */
export const QUERY_FOCUS_SUMMARY = `
  WITH latest_week AS (
    SELECT MAX(week_start) AS latest_week_start
    FROM vw_developer_focus
    WHERE (week_start >= $1::TIMESTAMP OR $1 IS NULL)
      AND (week_start <= $2::TIMESTAMP OR $2 IS NULL)
  ),
  latest_scores AS (
    SELECT
      author,
      focus_score,
      focus_category
    FROM vw_developer_focus f
    CROSS JOIN latest_week lw
    WHERE f.week_start = lw.latest_week_start
      AND (f.week_start >= $1::TIMESTAMP OR $1 IS NULL)
      AND (f.week_start <= $2::TIMESTAMP OR $2 IS NULL)
  )
  SELECT
    ROUND(AVG(focus_score)::NUMERIC, 2) AS avg_focus_score,
    COUNT(*) FILTER (WHERE focus_category = 'deep_focus') AS deep_focus_count,
    COUNT(*) FILTER (WHERE focus_category = 'moderate_focus') AS moderate_focus_count,
    COUNT(*) FILTER (WHERE focus_category = 'fragmented') AS fragmented_count,
    COUNT(*) FILTER (WHERE focus_category = 'highly_fragmented') AS highly_fragmented_count,
    COUNT(DISTINCT author) AS total_developers
  FROM latest_scores
`;

/**
 * Query to get developer summary for the most recent weeks.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range (nullable)
 *   $2 - end_date (TIMESTAMP) - end of date range (nullable)
 */
export const QUERY_DEVELOPER_SUMMARY = `
  WITH filtered_focus AS (
    SELECT
      author,
      week_start,
      focus_score,
      focus_category,
      total_commits,
      total_unique_tickets,
      focus_score_delta,
      ROW_NUMBER() OVER (PARTITION BY author ORDER BY week_start DESC) AS rn
    FROM vw_developer_focus
    WHERE (week_start >= $1::TIMESTAMP OR $1 IS NULL)
      AND (week_start <= $2::TIMESTAMP OR $2 IS NULL)
  )
  SELECT
    author,
    ROUND(AVG(focus_score)::NUMERIC, 2) AS avg_focus_score,
    MAX(CASE WHEN rn = 1 THEN focus_category END) AS current_category,
    SUM(total_commits) AS total_commits,
    SUM(total_unique_tickets) AS total_tickets,
    ROUND(AVG(focus_score_delta)::NUMERIC, 2) AS trend,
    COUNT(*) AS weeks_analyzed
  FROM filtered_focus
  GROUP BY author
  ORDER BY avg_focus_score DESC
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

/**
 * Query to get trend data for time series visualization.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range (nullable)
 *   $2 - end_date (TIMESTAMP) - end of date range (nullable)
 */
export const QUERY_FOCUS_TRENDS = `
  SELECT
    author,
    week_start,
    focus_score
  FROM vw_developer_focus
  WHERE (week_start >= $1::TIMESTAMP OR $1 IS NULL)
    AND (week_start <= $2::TIMESTAMP OR $2 IS NULL)
  ORDER BY week_start ASC, author
  LIMIT ${FOCUS_QUERY_MAX_ROWS}
`;

/**
 * Query to get team average focus score by week.
 *
 * Parameters:
 *   $1 - start_date (TIMESTAMP) - start of date range (nullable)
 *   $2 - end_date (TIMESTAMP) - end of date range (nullable)
 */
export const QUERY_TEAM_AVG_BY_WEEK = `
  SELECT
    week_start,
    ROUND(AVG(focus_score)::NUMERIC, 2) AS team_avg_focus_score
  FROM vw_developer_focus
  WHERE (week_start >= $1::TIMESTAMP OR $1 IS NULL)
    AND (week_start <= $2::TIMESTAMP OR $2 IS NULL)
  GROUP BY week_start
  ORDER BY week_start ASC
`;

// ============================================================================
// Database Row Types
// ============================================================================

/**
 * TypeScript interface for daily activity row from database.
 * Maps 1:1 to vw_developer_daily_activity view columns (snake_case).
 */
export interface DailyActivityDbRow {
  readonly author: string;
  readonly commit_day: Date | string;
  readonly repository: string;
  readonly commit_count: number | string;
  readonly unique_tickets: number | string;
  readonly unique_files: number | string;
  readonly total_loc_changed: number | string;
  readonly ticket_switches: number | string;
}

/**
 * TypeScript interface for focus score row from database.
 * Maps 1:1 to vw_developer_focus view columns (snake_case).
 */
export interface FocusDbRow {
  readonly author: string;
  readonly week_start: Date | string;
  readonly total_commits: number | string;
  readonly total_unique_tickets: number | string;
  readonly total_unique_files: number | string;
  readonly total_loc: number | string;
  readonly active_days: number | string;
  readonly avg_tickets_per_day: number | string;
  readonly focus_score: number | string;
  readonly loc_per_commit: number | string;
  readonly commits_per_ticket: number | string;
  readonly focus_category: FocusCategory;
  readonly focus_score_delta: number | string | null;
}

/**
 * TypeScript interface for focus summary row.
 */
export interface FocusSummaryDbRow {
  readonly avg_focus_score: number | string | null;
  readonly deep_focus_count: number | string;
  readonly moderate_focus_count: number | string;
  readonly fragmented_count: number | string;
  readonly highly_fragmented_count: number | string;
  readonly total_developers: number | string;
}

/**
 * TypeScript interface for developer summary row.
 */
export interface DeveloperSummaryDbRow {
  readonly author: string;
  readonly avg_focus_score: number | string | null;
  readonly current_category: FocusCategory | null;
  readonly total_commits: number | string;
  readonly total_tickets: number | string;
  readonly trend: number | string | null;
  readonly weeks_analyzed: number | string;
}

/**
 * TypeScript interface for trend data row.
 */
export interface TrendDbRow {
  readonly author: string;
  readonly week_start: Date | string;
  readonly focus_score: number | string;
}

/**
 * TypeScript interface for team average row.
 */
export interface TeamAvgDbRow {
  readonly week_start: Date | string;
  readonly team_avg_focus_score: number | string;
}
