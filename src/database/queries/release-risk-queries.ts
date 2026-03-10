/**
 * Parameterized SQL queries for the Release Risk Gauge Dashboard.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against views created by migration 018_release_risk.sql:
 *   - vw_author_experience: Author experience scores
 *   - vw_commit_risk: Per-commit risk factors
 *   - vw_release_risk: Release-level risk aggregation
 *
 * The views calculate risk based on:
 *   1. Complexity risk - complexity delta magnitude
 *   2. Test coverage risk - inverse of test file ratio
 *   3. Experience risk - inverse of author experience
 *   4. Hotspot risk - critical/high hotspot files touched
 *
 * Security: CWE-89 (SQL Injection) -- all user inputs are parameterized.
 *
 * Ticket: IQS-911
 */

import type { RiskCategory } from '../../services/release-risk-types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum number of commit rows returned to prevent memory exhaustion.
 */
export const RELEASE_RISK_QUERY_MAX_COMMIT_ROWS = 500;

/**
 * Maximum number of release summary rows returned.
 */
export const RELEASE_RISK_QUERY_MAX_SUMMARY_ROWS = 100;

// ============================================================================
// View Existence Queries
// ============================================================================

/**
 * Query to check if the vw_commit_risk view exists.
 * Used for graceful degradation if migration 018 has not been applied.
 */
export const QUERY_COMMIT_RISK_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_commit_risk'
  ) AS view_exists
`;

/**
 * Query to check if the vw_release_risk view exists.
 */
export const QUERY_RELEASE_RISK_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_release_risk'
  ) AS view_exists
`;

/**
 * Query to check if the vw_author_experience view exists.
 */
export const QUERY_AUTHOR_EXPERIENCE_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_author_experience'
  ) AS view_exists
`;

// ============================================================================
// Commit Risk Queries
// ============================================================================

/**
 * Query to fetch all commit risks from the view.
 * Returns commits ordered by commit_date DESC, total_risk DESC.
 * Limited to RELEASE_RISK_QUERY_MAX_COMMIT_ROWS for safety.
 */
export const QUERY_COMMIT_RISKS_ALL = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    full_name,
    team,
    ticket_id,
    complexity_delta,
    loc_delta,
    file_count,
    test_file_count,
    complexity_risk,
    test_coverage_risk,
    experience_risk,
    hotspot_risk,
    total_risk,
    risk_category
  FROM vw_commit_risk
  ORDER BY commit_date DESC, total_risk DESC
  LIMIT ${RELEASE_RISK_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch commit risks with date range filter.
 * Parameters:
 *   $1 - start_date (DATE) - start of date range
 *   $2 - end_date (DATE) - end of date range
 */
export const QUERY_COMMIT_RISKS_DATE_RANGE = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    full_name,
    team,
    ticket_id,
    complexity_delta,
    loc_delta,
    file_count,
    test_file_count,
    complexity_risk,
    test_coverage_risk,
    experience_risk,
    hotspot_risk,
    total_risk,
    risk_category
  FROM vw_commit_risk
  WHERE commit_date >= $1::DATE AND commit_date <= $2::DATE
  ORDER BY commit_date DESC, total_risk DESC
  LIMIT ${RELEASE_RISK_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch commit risks with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_COMMIT_RISKS_BY_REPOSITORY = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    full_name,
    team,
    ticket_id,
    complexity_delta,
    loc_delta,
    file_count,
    test_file_count,
    complexity_risk,
    test_coverage_risk,
    experience_risk,
    hotspot_risk,
    total_risk,
    risk_category
  FROM vw_commit_risk
  WHERE repository = $1
  ORDER BY commit_date DESC, total_risk DESC
  LIMIT ${RELEASE_RISK_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch commit risks with branch filter.
 * Parameters:
 *   $1 - branch (TEXT) - branch name to filter by
 */
export const QUERY_COMMIT_RISKS_BY_BRANCH = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    full_name,
    team,
    ticket_id,
    complexity_delta,
    loc_delta,
    file_count,
    test_file_count,
    complexity_risk,
    test_coverage_risk,
    experience_risk,
    hotspot_risk,
    total_risk,
    risk_category
  FROM vw_commit_risk
  WHERE branch = $1
  ORDER BY commit_date DESC, total_risk DESC
  LIMIT ${RELEASE_RISK_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch commit risks with risk category filter.
 * Parameters:
 *   $1 - risk_category (TEXT) - risk category to filter by
 */
export const QUERY_COMMIT_RISKS_BY_CATEGORY = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    full_name,
    team,
    ticket_id,
    complexity_delta,
    loc_delta,
    file_count,
    test_file_count,
    complexity_risk,
    test_coverage_risk,
    experience_risk,
    hotspot_risk,
    total_risk,
    risk_category
  FROM vw_commit_risk
  WHERE risk_category = $1
  ORDER BY commit_date DESC, total_risk DESC
  LIMIT ${RELEASE_RISK_QUERY_MAX_COMMIT_ROWS}
`;

/**
 * Query to fetch commit risks with combined filters.
 * Supports date range, repository, branch, and risk category.
 * NULL values are treated as "no filter" via COALESCE/OR patterns.
 *
 * Parameters:
 *   $1 - start_date (DATE) - start of date range (nullable)
 *   $2 - end_date (DATE) - end of date range (nullable)
 *   $3 - repository (TEXT) - repository name (nullable)
 *   $4 - branch (TEXT) - branch name (nullable)
 *   $5 - risk_category (TEXT) - risk category (nullable)
 *   $6 - team (TEXT) - team name (nullable)
 */
export const QUERY_COMMIT_RISKS_COMBINED = `
  SELECT
    sha,
    commit_date,
    author,
    branch,
    repository,
    commit_message,
    full_name,
    team,
    ticket_id,
    complexity_delta,
    loc_delta,
    file_count,
    test_file_count,
    complexity_risk,
    test_coverage_risk,
    experience_risk,
    hotspot_risk,
    total_risk,
    risk_category
  FROM vw_commit_risk
  WHERE (commit_date >= $1::DATE OR $1 IS NULL)
    AND (commit_date <= $2::DATE OR $2 IS NULL)
    AND (repository = $3 OR $3 IS NULL)
    AND (branch = $4 OR $4 IS NULL)
    AND (risk_category = $5 OR $5 IS NULL)
    AND (team = $6 OR $6 IS NULL)
  ORDER BY commit_date DESC, total_risk DESC
  LIMIT ${RELEASE_RISK_QUERY_MAX_COMMIT_ROWS}
`;

// ============================================================================
// Release Risk Summary Queries
// ============================================================================

/**
 * Query to fetch all release risk summaries from the view.
 * Returns releases ordered by release_risk_score DESC.
 */
export const QUERY_RELEASE_RISKS_ALL = `
  SELECT
    repository,
    branch,
    commit_count,
    first_commit_date,
    last_commit_date,
    release_risk_score,
    risk_category,
    avg_complexity_risk,
    avg_test_coverage_risk,
    avg_experience_risk,
    avg_hotspot_risk,
    critical_commit_count,
    high_commit_count,
    medium_commit_count,
    low_commit_count,
    max_risk
  FROM vw_release_risk
  ORDER BY release_risk_score DESC NULLS LAST
  LIMIT ${RELEASE_RISK_QUERY_MAX_SUMMARY_ROWS}
`;

/**
 * Query to fetch release risk summaries with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 */
export const QUERY_RELEASE_RISKS_BY_REPOSITORY = `
  SELECT
    repository,
    branch,
    commit_count,
    first_commit_date,
    last_commit_date,
    release_risk_score,
    risk_category,
    avg_complexity_risk,
    avg_test_coverage_risk,
    avg_experience_risk,
    avg_hotspot_risk,
    critical_commit_count,
    high_commit_count,
    medium_commit_count,
    low_commit_count,
    max_risk
  FROM vw_release_risk
  WHERE repository = $1
  ORDER BY release_risk_score DESC NULLS LAST
  LIMIT ${RELEASE_RISK_QUERY_MAX_SUMMARY_ROWS}
`;

/**
 * Query to fetch release risk summaries with branch filter.
 * Parameters:
 *   $1 - branch (TEXT) - branch name to filter by
 */
export const QUERY_RELEASE_RISKS_BY_BRANCH = `
  SELECT
    repository,
    branch,
    commit_count,
    first_commit_date,
    last_commit_date,
    release_risk_score,
    risk_category,
    avg_complexity_risk,
    avg_test_coverage_risk,
    avg_experience_risk,
    avg_hotspot_risk,
    critical_commit_count,
    high_commit_count,
    medium_commit_count,
    low_commit_count,
    max_risk
  FROM vw_release_risk
  WHERE branch = $1
  ORDER BY release_risk_score DESC NULLS LAST
  LIMIT ${RELEASE_RISK_QUERY_MAX_SUMMARY_ROWS}
`;

/**
 * Query to fetch release risk summaries with combined filters.
 * Parameters:
 *   $1 - repository (TEXT) - repository name (nullable)
 *   $2 - branch (TEXT) - branch name (nullable)
 *   $3 - risk_category (TEXT) - risk category (nullable)
 */
export const QUERY_RELEASE_RISKS_COMBINED = `
  SELECT
    repository,
    branch,
    commit_count,
    first_commit_date,
    last_commit_date,
    release_risk_score,
    risk_category,
    avg_complexity_risk,
    avg_test_coverage_risk,
    avg_experience_risk,
    avg_hotspot_risk,
    critical_commit_count,
    high_commit_count,
    medium_commit_count,
    low_commit_count,
    max_risk
  FROM vw_release_risk
  WHERE (repository = $1 OR $1 IS NULL)
    AND (branch = $2 OR $2 IS NULL)
    AND (risk_category = $3 OR $3 IS NULL)
  ORDER BY release_risk_score DESC NULLS LAST
  LIMIT ${RELEASE_RISK_QUERY_MAX_SUMMARY_ROWS}
`;

// ============================================================================
// Author Experience Queries
// ============================================================================

/**
 * Query to fetch author experience data.
 * Returns authors ordered by experience_score DESC.
 */
export const QUERY_AUTHOR_EXPERIENCE_ALL = `
  SELECT
    author,
    total_commits,
    repo_count,
    active_days,
    first_commit_date,
    last_commit_date,
    experience_score
  FROM vw_author_experience
  ORDER BY experience_score DESC NULLS LAST
  LIMIT 200
`;

/**
 * Query to fetch experience for a specific author.
 * Parameters:
 *   $1 - author (TEXT) - author login/username
 */
export const QUERY_AUTHOR_EXPERIENCE_BY_AUTHOR = `
  SELECT
    author,
    total_commits,
    repo_count,
    active_days,
    first_commit_date,
    last_commit_date,
    experience_score
  FROM vw_author_experience
  WHERE author = $1
`;

// ============================================================================
// TypeScript Interfaces for Database Rows
// ============================================================================

/**
 * TypeScript interface for commit risk row from database.
 * Maps 1:1 to vw_commit_risk view columns (snake_case).
 */
export interface CommitRiskDbRow {
  readonly sha: string;
  readonly commit_date: Date | string;
  readonly author: string;
  readonly branch: string;
  readonly repository: string;
  readonly commit_message: string | null;
  readonly full_name: string | null;
  readonly team: string | null;
  readonly ticket_id: string | null;
  readonly complexity_delta: number | string;
  readonly loc_delta: number | string;
  readonly file_count: number | string;
  readonly test_file_count: number | string;
  readonly complexity_risk: number | string;
  readonly test_coverage_risk: number | string;
  readonly experience_risk: number | string;
  readonly hotspot_risk: number | string;
  readonly total_risk: number | string;
  readonly risk_category: RiskCategory;
}

/**
 * TypeScript interface for release risk summary row from database.
 * Maps 1:1 to vw_release_risk view columns (snake_case).
 */
export interface ReleaseRiskDbRow {
  readonly repository: string;
  readonly branch: string;
  readonly commit_count: number | string;
  readonly first_commit_date: Date | string;
  readonly last_commit_date: Date | string;
  readonly release_risk_score: number | string;
  readonly risk_category: RiskCategory;
  readonly avg_complexity_risk: number | string;
  readonly avg_test_coverage_risk: number | string;
  readonly avg_experience_risk: number | string;
  readonly avg_hotspot_risk: number | string;
  readonly critical_commit_count: number | string;
  readonly high_commit_count: number | string;
  readonly medium_commit_count: number | string;
  readonly low_commit_count: number | string;
  readonly max_risk: number | string;
}

/**
 * TypeScript interface for author experience row from database.
 * Maps 1:1 to vw_author_experience view columns (snake_case).
 */
export interface AuthorExperienceDbRow {
  readonly author: string;
  readonly total_commits: number | string;
  readonly repo_count: number | string;
  readonly active_days: number | string;
  readonly first_commit_date: Date | string;
  readonly last_commit_date: Date | string;
  readonly experience_score: number | string;
}
