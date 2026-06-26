/**
 * GITX-183: Join Diagnostic Tool queries
 *
 * Queries to diagnose why Developer Profile story points aren't showing
 * by examining contributor identity alignment and Jira join statistics.
 *
 * Key concept: The join between Git and Jira uses:
 *   jira_detail.assignee = COALESCE(commit_contributors.jira_name, commit_contributors.full_name)
 *
 * This file provides diagnostics to understand why that join succeeds or fails.
 */

/**
 * Get contributor identity information and alignment status.
 *
 * Shows the contributor's identities and what value is used for Jira joins.
 * The "jira_identity" column shows COALESCE(jira_name, full_name) which is
 * the actual value used in joins.
 *
 * @param $1 - Contributor jira_identity (COALESCE of jira_name, full_name)
 */
export const QUERY_DIAGNOSTIC_CONTRIBUTOR_SUMMARY = `
SELECT
  cc.login,
  cc.full_name,
  cc.jira_name,
  cc.email,
  COALESCE(cc.jira_name, cc.full_name) AS jira_identity,
  CASE
    WHEN cc.jira_name IS NULL THEN 'Not Aligned (using full_name)'
    WHEN cc.jira_name = cc.full_name THEN 'Aligned (jira_name = full_name)'
    ELSE 'Aligned (jira_name differs from full_name)'
  END AS alignment_status
FROM commit_contributors cc
WHERE COALESCE(cc.jira_name, cc.full_name) = $1
`;

/**
 * Get Jira join statistics for a contributor.
 *
 * Shows:
 * - Matched: Issues where jira_detail.assignee = contributor's jira_identity
 * - Potential: Issues where assignee ILIKE contributor names (possible mismatches)
 *
 * @param $1 - Contributor jira_identity (COALESCE of jira_name, full_name)
 */
export const QUERY_DIAGNOSTIC_JIRA_MATCH_STATS = `
WITH target_contributor AS (
  SELECT
    cc.login,
    cc.full_name,
    cc.jira_name,
    COALESCE(cc.jira_name, cc.full_name) AS jira_identity
  FROM commit_contributors cc
  WHERE COALESCE(cc.jira_name, cc.full_name) = $1
),
-- Issues that successfully match via the COALESCE join
matched_issues AS (
  SELECT DISTINCT jd.jira_key, jd.calculated_story_points
  FROM jira_detail jd
  CROSS JOIN target_contributor tc
  WHERE jd.assignee = tc.jira_identity
    AND jd.status IN ('Done', 'Closed', 'Resolved')
    AND jd.calculated_story_points IS NOT NULL
),
-- Issues that DON'T match the jira_identity but DO match full_name or login
-- These indicate a potential alignment problem
potential_matches AS (
  SELECT DISTINCT jd.jira_key, jd.calculated_story_points
  FROM jira_detail jd
  CROSS JOIN target_contributor tc
  WHERE jd.assignee != tc.jira_identity
    AND (
      jd.assignee = tc.full_name
      OR jd.assignee = tc.login
      OR jd.assignee ILIKE '%' || tc.login || '%'
      OR (tc.full_name IS NOT NULL AND jd.assignee ILIKE '%' || SPLIT_PART(tc.full_name, ' ', 1) || '%')
    )
    AND jd.status IN ('Done', 'Closed', 'Resolved')
    AND jd.calculated_story_points IS NOT NULL
    AND jd.jira_key NOT IN (SELECT jira_key FROM matched_issues)
)
SELECT
  (SELECT COUNT(*) FROM matched_issues)::int AS matched_count,
  (SELECT COALESCE(SUM(calculated_story_points), 0) FROM matched_issues)::int AS matched_story_points,
  (SELECT COUNT(*) FROM potential_matches)::int AS unmatched_count,
  (SELECT COALESCE(SUM(calculated_story_points), 0) FROM potential_matches)::int AS unmatched_story_points
`;

/**
 * List Jira issues that might belong to this contributor but don't match.
 *
 * Shows issues where:
 * - Assignee matches full_name but NOT jira_identity (alignment issue)
 * - Assignee contains login or first name (possible match)
 *
 * Limited to 50 results for UI performance.
 *
 * @param $1 - Contributor jira_identity (COALESCE of jira_name, full_name)
 */
export const QUERY_DIAGNOSTIC_UNMATCHED_ISSUES = `
WITH target_contributor AS (
  SELECT
    cc.login,
    cc.full_name,
    cc.jira_name,
    COALESCE(cc.jira_name, cc.full_name) AS jira_identity
  FROM commit_contributors cc
  WHERE COALESCE(cc.jira_name, cc.full_name) = $1
),
matched_keys AS (
  SELECT jd.jira_key
  FROM jira_detail jd
  CROSS JOIN target_contributor tc
  WHERE jd.assignee = tc.jira_identity
)
SELECT
  jd.jira_key,
  jd.summary,
  jd.assignee AS jira_assignee,
  tc.full_name AS contributor_full_name,
  tc.jira_name AS contributor_jira_name,
  jd.calculated_story_points,
  jd.status,
  CASE
    WHEN jd.assignee = tc.full_name THEN 'Assignee = full_name (need to set jira_name)'
    WHEN jd.assignee = tc.login THEN 'Assignee = login (need to set jira_name)'
    WHEN tc.full_name IS NOT NULL AND jd.assignee ILIKE '%' || SPLIT_PART(tc.full_name, ' ', 1) || '%'
      THEN 'Assignee contains first name'
    WHEN jd.assignee ILIKE '%' || tc.login || '%' THEN 'Assignee contains login'
    ELSE 'Possible match'
  END AS mismatch_reason
FROM jira_detail jd
CROSS JOIN target_contributor tc
WHERE jd.assignee != tc.jira_identity
  AND (
    jd.assignee = tc.full_name
    OR jd.assignee = tc.login
    OR jd.assignee ILIKE '%' || tc.login || '%'
    OR (tc.full_name IS NOT NULL AND jd.assignee ILIKE '%' || SPLIT_PART(tc.full_name, ' ', 1) || '%')
  )
  AND jd.status IN ('Done', 'Closed', 'Resolved')
  AND jd.jira_key NOT IN (SELECT jira_key FROM matched_keys)
ORDER BY jd.calculated_story_points DESC NULLS LAST, jd.jira_key
LIMIT 50
`;

/**
 * List all contributors with their alignment status.
 *
 * Returns COALESCE(jira_name, full_name) as the primary selection key,
 * since that's the value used for Jira joins. This is what the dropdown
 * should display and use for selection.
 *
 * Includes matched issue count to help identify data quality issues.
 */
export const QUERY_DIAGNOSTIC_ALL_CONTRIBUTORS = `
SELECT
  cc.login,
  cc.full_name,
  cc.jira_name,
  COALESCE(cc.jira_name, cc.full_name) AS jira_identity,
  CASE
    WHEN cc.jira_name IS NULL THEN 'Not Aligned'
    WHEN cc.jira_name = cc.full_name THEN 'Aligned (Same)'
    ELSE 'Aligned (Different)'
  END AS alignment_status,
  (
    SELECT COUNT(DISTINCT jd.jira_key)
    FROM jira_detail jd
    WHERE jd.assignee = COALESCE(cc.jira_name, cc.full_name)
      AND jd.status IN ('Done', 'Closed', 'Resolved')
  )::int AS matched_issue_count
FROM commit_contributors cc
WHERE cc.full_name IS NOT NULL OR cc.jira_name IS NOT NULL
ORDER BY COALESCE(cc.jira_name, cc.full_name)
`;

/**
 * Find Jira assignees not in commit_contributors table.
 *
 * These are "orphaned" assignees - they have completed Jira issues with story
 * points but no matching Git contributor. They may be:
 * - External contributors
 * - Team members who work on other repos
 * - Data quality issues (typos, name changes)
 * - Contributors whose jira_name needs to be set
 *
 * Limited to top 20 by story points for UI performance.
 */
export const QUERY_DIAGNOSTIC_ORPHANED_ASSIGNEES = `
SELECT DISTINCT
  jd.assignee,
  COUNT(DISTINCT jd.jira_key)::int AS issue_count,
  COALESCE(SUM(jd.calculated_story_points), 0)::int AS total_story_points
FROM jira_detail jd
LEFT JOIN commit_contributors cc ON (
  jd.assignee = COALESCE(cc.jira_name, cc.full_name)
)
WHERE jd.status IN ('Done', 'Closed', 'Resolved')
  AND jd.calculated_story_points IS NOT NULL
  AND cc.login IS NULL
GROUP BY jd.assignee
ORDER BY total_story_points DESC
LIMIT 20
`;

/**
 * TypeScript interfaces for query result types
 */

export interface ContributorSummary {
  login: string;
  full_name: string;
  jira_name: string | null;
  email: string;
  jira_identity: string;
  alignment_status: 'Not Aligned (using full_name)' | 'Aligned (jira_name = full_name)' | 'Aligned (jira_name differs from full_name)';
}

export interface JiraMatchStats {
  matched_count: number;
  matched_story_points: number;
  unmatched_count: number;
  unmatched_story_points: number;
}

export interface UnmatchedIssue {
  jira_key: string;
  summary: string;
  jira_assignee: string;
  contributor_full_name: string;
  contributor_jira_name: string | null;
  calculated_story_points: number;
  status: string;
  mismatch_reason: string;
}

export interface ContributorAlignment {
  login: string;
  full_name: string;
  jira_name: string | null;
  jira_identity: string;
  alignment_status: 'Not Aligned' | 'Aligned (Same)' | 'Aligned (Different)';
  matched_issue_count: number;
}

export interface OrphanedAssignee {
  assignee: string;
  issue_count: number;
  total_story_points: number;
}
