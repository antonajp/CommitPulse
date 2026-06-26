/**
 * GITX-183: Join Diagnostic Tool queries
 *
 * Queries to help diagnose why Developer Profile story points aren't showing
 * by examining contributor identity alignment and Jira join statistics.
 */

/**
 * Get contributor identity information and alignment status.
 *
 * Shows how a contributor's Git identity (full_name, login) maps to their
 * Jira identity (jira_name), which is critical for the join to jira_detail.
 *
 * @param $1 - Contributor name (full_name or login)
 */
export const QUERY_DIAGNOSTIC_CONTRIBUTOR_SUMMARY = `
SELECT
  cc.login,
  cc.full_name,
  cc.jira_name,
  cc.email,
  CASE
    WHEN cc.jira_name IS NULL THEN 'Not Aligned'
    WHEN cc.jira_name = cc.full_name THEN 'Aligned (Same Value)'
    ELSE 'Aligned (Different Value)'
  END AS alignment_status
FROM commit_contributors cc
WHERE cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1)
`;

/**
 * Get Jira join statistics for a contributor.
 *
 * Compares matched vs unmatched Jira issues:
 * - Matched: Issues where jira_detail.assignee = commit_contributors.jira_name
 * - Unmatched: Issues where assignee = full_name but jira_name is different
 *
 * This reveals story points that would appear if jira_name was properly aligned.
 *
 * @param $1 - Contributor name (full_name or login)
 */
export const QUERY_DIAGNOSTIC_JIRA_MATCH_STATS = `
WITH target_contributor AS (
  SELECT cc.login, cc.full_name, cc.jira_name
  FROM commit_contributors cc
  WHERE cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1)
),
matched_issues AS (
  SELECT DISTINCT jd.jira_key
  FROM jira_detail jd
  CROSS JOIN target_contributor tc
  WHERE jd.assignee = COALESCE(tc.jira_name, tc.full_name)
    AND jd.status IN ('Done', 'Closed', 'Resolved')
    AND jd.calculated_story_points IS NOT NULL
),
unmatched_by_full_name AS (
  SELECT DISTINCT jd.jira_key, jd.assignee, jd.calculated_story_points
  FROM jira_detail jd
  CROSS JOIN target_contributor tc
  WHERE jd.assignee = tc.full_name
    AND jd.status IN ('Done', 'Closed', 'Resolved')
    AND jd.calculated_story_points IS NOT NULL
    AND tc.jira_name IS NOT NULL
    AND jd.assignee != tc.jira_name
)
SELECT
  (SELECT COUNT(*) FROM matched_issues)::int AS matched_count,
  (SELECT COALESCE(SUM(jd.calculated_story_points), 0) FROM jira_detail jd WHERE jd.jira_key IN (SELECT jira_key FROM matched_issues))::int AS matched_story_points,
  (SELECT COUNT(*) FROM unmatched_by_full_name)::int AS unmatched_count,
  (SELECT COALESCE(SUM(calculated_story_points), 0) FROM unmatched_by_full_name)::int AS unmatched_story_points
`;

/**
 * List Jira issues that don't match due to alignment problems.
 *
 * Shows issues where the assignee matches full_name but not jira_name,
 * indicating missing story points that would appear with proper alignment.
 *
 * Limited to 50 results for UI display performance.
 *
 * @param $1 - Contributor name (full_name or login)
 */
export const QUERY_DIAGNOSTIC_UNMATCHED_ISSUES = `
WITH target_contributor AS (
  SELECT cc.login, cc.full_name, cc.jira_name
  FROM commit_contributors cc
  WHERE cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1)
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
    WHEN tc.jira_name IS NULL THEN 'jira_name not set'
    WHEN jd.assignee != tc.jira_name THEN 'Assignee mismatch'
    ELSE 'Unknown'
  END AS mismatch_reason
FROM jira_detail jd
CROSS JOIN target_contributor tc
WHERE jd.assignee = tc.full_name
  AND jd.status IN ('Done', 'Closed', 'Resolved')
  AND tc.jira_name IS NOT NULL
  AND jd.assignee != tc.jira_name
ORDER BY jd.jira_key
LIMIT 50
`;

/**
 * List all contributors with their alignment status.
 *
 * Useful for a full team audit to identify which contributors need
 * their jira_name aligned. Includes commit count to prioritize by activity.
 */
export const QUERY_DIAGNOSTIC_ALL_CONTRIBUTORS = `
SELECT
  cc.login,
  cc.full_name,
  cc.jira_name,
  CASE
    WHEN cc.jira_name IS NULL THEN 'Not Aligned'
    WHEN cc.jira_name = cc.full_name THEN 'Aligned (Same)'
    ELSE 'Aligned (Different)'
  END AS alignment_status,
  (SELECT COUNT(*) FROM commit_history ch WHERE ch.author = cc.full_name OR ch.author = cc.login) AS commit_count
FROM commit_contributors cc
WHERE cc.full_name IS NOT NULL
ORDER BY cc.full_name
`;

/**
 * Find Jira assignees not in commit_contributors table.
 *
 * These are "orphaned" assignees - they have completed Jira issues with story
 * points but no Git commits in the repository. They may be:
 * - External contributors
 * - Team members who work on other repos
 * - Data quality issues (typos, name changes)
 *
 * Limited to top 20 by story points for UI performance.
 */
export const QUERY_DIAGNOSTIC_ORPHANED_ASSIGNEES = `
SELECT DISTINCT
  jd.assignee,
  COUNT(DISTINCT jd.jira_key) AS issue_count,
  COALESCE(SUM(jd.calculated_story_points), 0)::int AS total_story_points
FROM jira_detail jd
LEFT JOIN commit_contributors cc ON (
  jd.assignee = cc.full_name OR jd.assignee = cc.jira_name
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
  alignment_status: 'Not Aligned' | 'Aligned (Same Value)' | 'Aligned (Different Value)';
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
  mismatch_reason: 'jira_name not set' | 'Assignee mismatch' | 'Unknown';
}

export interface ContributorAlignment {
  login: string;
  full_name: string;
  jira_name: string | null;
  alignment_status: 'Not Aligned' | 'Aligned (Same)' | 'Aligned (Different)';
  commit_count: number;
}

export interface OrphanedAssignee {
  assignee: string;
  issue_count: number;
  total_story_points: number;
}
