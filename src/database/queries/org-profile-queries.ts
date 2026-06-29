/**
 * SQL queries for Organization Profile Dashboard.
 * All queries use parameterized placeholders ($1, $2, $3) - zero string interpolation.
 * Ticket: GITX-203
 *
 * These queries aggregate metrics across all teams in an organization.
 * Key join pattern:
 *   organizations -> teams (via organization_id FK)
 *   teams -> commit_contributors (via team_id FK)
 *
 * CRITICAL: For Jira velocity queries, join on:
 *   jira_detail.assignee = COALESCE(cc.jira_name, cc.full_name)
 * NOT: assignee = cc.email OR assignee = cc.login (incorrect pattern)
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum number of result rows for organization queries.
 */
export const ORG_PROFILE_MAX_ROWS = 500;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Organization summary row from database.
 * GITX-206: Added avg_complexity and repos_worked_on for KPI cards.
 */
export interface OrgSummaryDbRow {
  readonly organization_id: number;
  readonly organization_name: string;
  readonly team_count: number;
  readonly contributor_count: number;
  readonly total_loc: number | string;
  readonly total_commits: number;
  readonly avg_complexity: number | string;
  readonly repos_worked_on: number;
}

/**
 * Organization with team count row from database.
 */
export interface OrgWithTeamCountDbRow {
  readonly id: number;
  readonly name: string;
  readonly team_count: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

/**
 * Weekly LOC data row from database.
 */
export interface OrgLocPerWeekDbRow {
  readonly week_start: Date | string;
  readonly lines_added: number | string;
  readonly lines_deleted: number | string;
  readonly net_lines: number | string;
  readonly commit_count: number;
}

/**
 * Complex file with team breakdown row from database.
 */
export interface OrgComplexFileDbRow {
  readonly filename: string;
  readonly complexity: number;
  readonly team_name: string;
  readonly loc: number | string;
  readonly percentage: number | string;
}

/**
 * Frequently modified file with team breakdown row from database.
 */
export interface OrgFrequentFileDbRow {
  readonly filename: string;
  readonly total_churn: number | string;
  readonly team_name: string;
  readonly churn: number | string;
  readonly percentage: number | string;
}

/**
 * Technology stack percentage row from database.
 */
export interface OrgTechStackDbRow {
  readonly category: string;
  readonly repository: string;
  readonly loc_count: number | string;
  readonly percentage: number | string;
}

/**
 * Technology stack by file extension row from database.
 * GITX-214: Aggregates LOC by file extension.
 */
export interface OrgTechStackByExtensionDbRow {
  readonly extension: string;
  readonly repository: string;
  readonly loc_count: number | string;
  readonly percentage: number | string;
}

/**
 * Comments per week row from database.
 */
export interface OrgCommentsPerWeekDbRow {
  readonly week_start: Date | string;
  readonly comments_added: number | string;
  readonly total_files: number;
}

/**
 * Tests per week row from database.
 */
export interface OrgTestsPerWeekDbRow {
  readonly week_start: Date | string;
  readonly test_files_modified: number;
  readonly test_lines_added: number | string;
}

/**
 * Hygiene score row from database.
 */
export interface OrgHygieneScoreDbRow {
  readonly avg_hygiene_score: number | string;
  readonly total_commits: number;
  readonly conventional_commits: number;
  readonly conventional_pct: number | string;
  // GITX-216: Enhanced hygiene metrics matching Developer Profile
  readonly quality_tier: string;
  readonly jira_ref_pct: number | string;
  readonly meaningful_msg_pct: number | string;
  readonly non_merge_pct: number | string;
}

/**
 * Velocity vs LOC row from database.
 */
export interface OrgVelocityVsLocDbRow {
  readonly week_start: Date | string;
  readonly story_points: number;
  readonly lines_of_code: number | string;
  readonly issue_count: number;
  readonly commit_count: number;
}

/**
 * Hot spot row from database.
 */
export interface OrgHotSpotDbRow {
  readonly file_path: string;
  readonly repository: string;
  readonly team_name: string;
  readonly churn_count: number;
  readonly complexity: number;
  readonly loc: number;
  readonly risk_score: number | string;
  readonly risk_tier: string;
}

/**
 * Knowledge concentration row from database.
 */
export interface OrgKnowledgeConcentrationDbRow {
  readonly file_path: string;
  readonly repository: string;
  readonly team_name: string;
  readonly total_commits: number;
  readonly total_contributors: number;
  readonly top_contributor: string;
  readonly top_contributor_pct: number | string;
  readonly concentration_risk: string;
}

// ============================================================================
// Query: QUERY_ALL_ORGANIZATIONS
// ============================================================================

/**
 * Get all organizations with team counts.
 * Returns organizations ordered by name ascending.
 *
 * No parameters required.
 */
export const QUERY_ALL_ORGANIZATIONS = `
  SELECT
    o.id,
    o.name,
    COUNT(DISTINCT t.id)::int AS team_count,
    o.created_at,
    o.updated_at
  FROM organizations o
  LEFT JOIN teams t ON t.organization_id = o.id
  GROUP BY o.id, o.name, o.created_at, o.updated_at
  ORDER BY o.name ASC
  LIMIT ${ORG_PROFILE_MAX_ROWS}
`;

// ============================================================================
// Query: QUERY_ORG_SUMMARY_STATS
// ============================================================================

/**
 * Get summary metrics for an organization.
 * Returns team count, contributor count, total LOC, total commits, avg complexity, repos worked on.
 * GITX-206: Added avg_complexity and repos_worked_on for KPI cards.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *
 * Key Pattern:
 *   org_teams CTE: SELECT teams WHERE organization_id = $1
 *   team_members CTE: SELECT DISTINCT contributors via team_id FK
 */
export const QUERY_ORG_SUMMARY_STATS = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name, cc.jira_name, t.team_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  ),
  team_commits AS (
    SELECT DISTINCT ch.sha, ch.lines_added, ch.lines_removed, ch.repository
    FROM commit_history ch
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE ch.is_merge = FALSE
  ),
  file_complexity AS (
    SELECT AVG(NULLIF(cf.complexity, 0))::numeric AS avg_complexity
    FROM commit_files cf
    WHERE cf.sha IN (SELECT sha FROM team_commits)
      AND cf.complexity IS NOT NULL
  )
  SELECT
    $1::int AS organization_id,
    (SELECT name FROM organizations WHERE id = $1) AS organization_name,
    (SELECT COUNT(*)::int FROM org_teams) AS team_count,
    (SELECT COUNT(*)::int FROM team_members) AS contributor_count,
    COALESCE(SUM(tc.lines_added), 0)::bigint AS total_loc,
    COUNT(tc.sha)::int AS total_commits,
    COALESCE((SELECT avg_complexity FROM file_complexity), 0)::numeric AS avg_complexity,
    COUNT(DISTINCT tc.repository)::int AS repos_worked_on
  FROM team_commits tc
`;

// ============================================================================
// Query: QUERY_ORG_LOC_PER_WEEK
// ============================================================================

/**
 * Get LOC aggregated weekly for an organization.
 * Returns weekly breakdown of lines added, deleted, and net lines.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 *   $3 - aggregation period ('week' or 'month') (TEXT)
 */
export const QUERY_ORG_LOC_PER_WEEK = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  )
  SELECT
    DATE_TRUNC($3, ch.commit_date)::date AS week_start,
    COALESCE(SUM(cf.line_inserts), 0)::bigint AS lines_added,
    COALESCE(SUM(cf.line_deletes), 0)::bigint AS lines_deleted,
    COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS net_lines,
    COUNT(DISTINCT ch.sha)::int AS commit_count
  FROM commit_history ch
  LEFT JOIN commit_files cf ON cf.sha = ch.sha
  JOIN team_members tm ON (
    ch.author = tm.full_name
    OR (tm.full_name IS NULL AND ch.author = tm.login)
  )
  WHERE ch.commit_date >= $2
    AND ch.is_merge = FALSE
  GROUP BY week_start
  ORDER BY week_start ASC
  LIMIT ${ORG_PROFILE_MAX_ROWS}
`;

// ============================================================================
// Query: QUERY_ORG_LOC_BY_REPOSITORY
// GITX-207: LOC by repository for stacked bar chart
// ============================================================================

/**
 * Database row for LOC by repository.
 */
export interface OrgLocByRepositoryDbRow {
  readonly week_start: Date | string;
  readonly repository: string;
  readonly lines_added: number | string;
}

/**
 * Get LOC aggregated by repository for stacked bar chart.
 * GITX-207: Sum across all teams, group by repository.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 *   $3 - aggregation period ('week' or 'month') (TEXT)
 */
export const QUERY_ORG_LOC_BY_REPOSITORY = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  )
  SELECT
    DATE_TRUNC($3, ch.commit_date)::date AS week_start,
    ch.repository,
    COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS lines_added
  FROM commit_history ch
  LEFT JOIN commit_files cf ON cf.sha = ch.sha
  JOIN team_members tm ON (
    ch.author = tm.full_name
    OR (tm.full_name IS NULL AND ch.author = tm.login)
  )
  WHERE ch.commit_date >= $2
    AND ch.is_merge = FALSE
    AND ch.repository IS NOT NULL
  GROUP BY week_start, ch.repository
  ORDER BY week_start ASC, lines_added DESC
  LIMIT ${ORG_PROFILE_MAX_ROWS}
`;

// ============================================================================
// Query: QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM
// ============================================================================

/**
 * Get top 15 complex files with team breakdown for an organization.
 * Returns files ordered by complexity descending with team LOC contributions.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 */
export const QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name, t.team_name, t.team_id
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  ),
  latest_file_state AS (
    SELECT DISTINCT ON (cf.filename)
      cf.filename,
      COALESCE(cf.complexity, cf.weighted_complexity, cf.total_code_lines, 0) AS complexity,
      cf.sha
    FROM commit_files cf
    INNER JOIN commit_history ch ON cf.sha = ch.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE cf.complexity IS NOT NULL OR cf.weighted_complexity IS NOT NULL OR cf.total_code_lines IS NOT NULL
    ORDER BY cf.filename, ch.commit_date DESC
  ),
  top_files AS (
    SELECT filename, complexity
    FROM latest_file_state
    ORDER BY complexity DESC
    LIMIT 15
  ),
  team_loc AS (
    SELECT
      cf.filename,
      COALESCE(t.team_name, '(Unassigned)') AS team_name,
      COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS loc
    FROM commit_files cf
    INNER JOIN commit_history ch ON cf.sha = ch.sha
    LEFT JOIN commit_contributors cc ON ch.author = cc.login OR ch.author = cc.full_name
    LEFT JOIN org_teams t ON cc.team_id = t.team_id
    WHERE cf.filename IN (SELECT filename FROM top_files)
      AND cf.line_inserts IS NOT NULL
      AND ch.is_merge = FALSE
    GROUP BY cf.filename, COALESCE(t.team_name, '(Unassigned)')
  )
  SELECT
    tf.filename,
    tf.complexity,
    tl.team_name,
    tl.loc,
    CASE
      WHEN SUM(tl.loc) OVER (PARTITION BY tf.filename) > 0
      THEN ROUND((tl.loc::NUMERIC / SUM(tl.loc) OVER (PARTITION BY tf.filename)) * 100, 1)
      ELSE 0
    END AS percentage
  FROM top_files tf
  INNER JOIN team_loc tl ON tf.filename = tl.filename
  WHERE tl.loc > 0
  ORDER BY tf.complexity DESC, tl.loc DESC
`;

// ============================================================================
// Query: QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM
// ============================================================================

/**
 * Get top 20 most frequently modified files with team breakdown for an organization.
 * Returns files ordered by total churn descending with team contributions.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 */
export const QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name, t.team_name, t.team_id
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  ),
  org_files AS (
    SELECT cf.filename, SUM(cf.line_inserts + COALESCE(cf.line_deletes, 0))::bigint AS total_churn
    FROM commit_files cf
    INNER JOIN commit_history ch ON cf.sha = ch.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE cf.line_inserts IS NOT NULL
      AND ch.is_merge = FALSE
      AND cf.filename NOT LIKE 'node_modules/%'
      AND cf.filename NOT LIKE '%/node_modules/%'
      AND cf.filename NOT LIKE 'vendor/%'
      AND cf.filename NOT LIKE '%/vendor/%'
    GROUP BY cf.filename
    ORDER BY total_churn DESC
    LIMIT 20
  ),
  team_churn AS (
    SELECT
      cf.filename,
      COALESCE(t.team_name, '(Unassigned)') AS team_name,
      SUM(cf.line_inserts + COALESCE(cf.line_deletes, 0))::bigint AS churn
    FROM commit_files cf
    INNER JOIN commit_history ch ON cf.sha = ch.sha
    LEFT JOIN commit_contributors cc ON ch.author = cc.login OR ch.author = cc.full_name
    LEFT JOIN org_teams t ON cc.team_id = t.team_id
    WHERE cf.filename IN (SELECT filename FROM org_files)
      AND cf.line_inserts IS NOT NULL
      AND ch.is_merge = FALSE
    GROUP BY cf.filename, COALESCE(t.team_name, '(Unassigned)')
  )
  SELECT
    of.filename,
    of.total_churn,
    tc.team_name,
    tc.churn,
    CASE
      WHEN of.total_churn > 0
      THEN ROUND((tc.churn::NUMERIC / of.total_churn) * 100, 1)
      ELSE 0
    END AS percentage
  FROM org_files of
  INNER JOIN team_churn tc ON of.filename = tc.filename
  WHERE tc.churn > 0
  ORDER BY of.total_churn DESC, tc.churn DESC
`;

// ============================================================================
// Query: QUERY_ORG_TECH_STACK
// ============================================================================

/**
 * Get technology stack percentages for an organization.
 * Returns technology categories with LOC counts and percentages.
 * Uses vw_technology_stack_category view to map file extensions to categories.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 */
export const QUERY_ORG_TECH_STACK = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  ),
  org_contributions AS (
    SELECT
      vtsc.category,
      ch.repository,
      COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS loc_count
    FROM commit_files cf
    JOIN commit_history ch ON cf.sha = ch.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    JOIN vw_technology_stack_category vtsc ON cf.file_extension = vtsc.file_extension
    WHERE ch.commit_date >= $2
      AND ch.is_merge = FALSE
      AND cf.line_inserts IS NOT NULL
    GROUP BY vtsc.category, ch.repository
  ),
  total_loc AS (
    SELECT COALESCE(SUM(loc_count), 0) AS total FROM org_contributions
  )
  SELECT
    oc.category,
    oc.repository,
    oc.loc_count,
    CASE
      WHEN tl.total > 0 THEN ROUND((oc.loc_count * 100.0 / tl.total)::numeric, 2)
      ELSE 0
    END AS percentage
  FROM org_contributions oc
  CROSS JOIN total_loc tl
  WHERE oc.loc_count > 0
  ORDER BY oc.loc_count DESC
  LIMIT 20
`;

// ============================================================================
// Query: QUERY_ORG_TECH_STACK_BY_EXTENSION
// GITX-214: Technology stack by file extension for toggle view
// ============================================================================

/**
 * Get technology stack by file extension for an organization.
 * GITX-214: Returns file extensions with LOC counts and percentages.
 * Aggregates directly by cf.file_extension without joining to category view.
 * Handles files without extensions (e.g., Dockerfile, Makefile) as-is.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 */
export const QUERY_ORG_TECH_STACK_BY_EXTENSION = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  ),
  org_contributions AS (
    SELECT
      LOWER(COALESCE(NULLIF(cf.file_extension, ''),
        CASE
          WHEN cf.filename LIKE '%Dockerfile%' THEN 'Dockerfile'
          WHEN cf.filename LIKE '%Makefile%' THEN 'Makefile'
          WHEN cf.filename LIKE '%.gitignore' THEN '.gitignore'
          WHEN cf.filename LIKE '%.env%' THEN '.env'
          ELSE '(no extension)'
        END
      )) AS extension,
      ch.repository,
      COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS loc_count
    FROM commit_files cf
    JOIN commit_history ch ON cf.sha = ch.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE ch.commit_date >= $2
      AND ch.is_merge = FALSE
      AND cf.line_inserts IS NOT NULL
    GROUP BY extension, ch.repository
  ),
  total_loc AS (
    SELECT COALESCE(SUM(loc_count), 0) AS total FROM org_contributions
  )
  SELECT
    oc.extension,
    oc.repository,
    oc.loc_count,
    CASE
      WHEN tl.total > 0 THEN ROUND((oc.loc_count * 100.0 / tl.total)::numeric, 2)
      ELSE 0
    END AS percentage
  FROM org_contributions oc
  CROSS JOIN total_loc tl
  WHERE oc.loc_count > 0
  ORDER BY oc.loc_count DESC
  LIMIT 20
`;

// ============================================================================
// Query: QUERY_ORG_COMMENTS_PER_WEEK
// ============================================================================

/**
 * Get comments added per period for an organization.
 * Returns periodic breakdown of comment lines added.
 * Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 *   $3 - aggregation_period ('week' | 'month')
 */
export const QUERY_ORG_COMMENTS_PER_WEEK = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  )
  SELECT
    DATE_TRUNC($3, ch.commit_date)::date AS week_start,
    COALESCE(SUM(cf.total_comment_lines), 0)::bigint AS comments_added,
    COUNT(DISTINCT cf.filename)::int AS total_files
  FROM commit_history ch
  JOIN commit_files cf ON cf.sha = ch.sha
  JOIN team_members tm ON (
    ch.author = tm.full_name
    OR (tm.full_name IS NULL AND ch.author = tm.login)
  )
  WHERE ch.commit_date >= $2
    AND ch.is_merge = FALSE
  GROUP BY week_start
  ORDER BY week_start ASC
  LIMIT ${ORG_PROFILE_MAX_ROWS}
`;

// ============================================================================
// Query: QUERY_ORG_TESTS_PER_WEEK
// ============================================================================

/**
 * Get test files modified per period for an organization.
 * Returns periodic breakdown of test file modifications.
 * Uses dynamic aggregation (week for < 365 days, month for >= 365 days).
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 *   $3 - aggregation_period ('week' | 'month')
 */
export const QUERY_ORG_TESTS_PER_WEEK = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  )
  SELECT
    DATE_TRUNC($3, ch.commit_date)::date AS week_start,
    COUNT(DISTINCT cf.filename)::int AS test_files_modified,
    COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS test_lines_added
  FROM commit_history ch
  LEFT JOIN commit_files cf ON cf.sha = ch.sha
  JOIN team_members tm ON (
    ch.author = tm.full_name
    OR (tm.full_name IS NULL AND ch.author = tm.login)
  )
  WHERE ch.commit_date >= $2
    AND ch.is_merge = FALSE
    AND (
      cf.filename LIKE '%test%'
      OR cf.filename LIKE '%spec%'
      OR cf.filename LIKE '%__tests__%'
    )
  GROUP BY week_start
  ORDER BY week_start ASC
  LIMIT ${ORG_PROFILE_MAX_ROWS}
`;

// ============================================================================
// Query: QUERY_ORG_HYGIENE_SCORE
// ============================================================================

/**
 * Get average commit hygiene score for an organization.
 * Returns aggregate hygiene metrics across all team members.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 */
export const QUERY_ORG_HYGIENE_SCORE = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  )
  SELECT
    COALESCE(AVG(vh.hygiene_score), 0)::numeric(5,2) AS avg_hygiene_score,
    COUNT(*)::int AS total_commits,
    COUNT(*) FILTER (WHERE vh.has_conventional_prefix = TRUE)::int AS conventional_commits,
    CASE
      WHEN COUNT(*) > 0
      THEN ROUND((COUNT(*) FILTER (WHERE vh.has_conventional_prefix = TRUE)::NUMERIC / COUNT(*)) * 100, 1)
      ELSE 0
    END AS conventional_pct,
    -- GITX-216: Enhanced hygiene metrics matching Developer Profile
    CASE
      WHEN AVG(vh.hygiene_score) >= 80 THEN 'excellent'
      WHEN AVG(vh.hygiene_score) >= 60 THEN 'good'
      WHEN AVG(vh.hygiene_score) >= 40 THEN 'fair'
      ELSE 'poor'
    END AS quality_tier,
    CASE
      WHEN COUNT(*) > 0
      THEN ROUND((COUNT(*) FILTER (WHERE vh.jira_ticket_id IS NOT NULL OR vh.linear_ticket_id IS NOT NULL)::NUMERIC / COUNT(*)) * 100, 1)
      ELSE 0
    END AS jira_ref_pct,
    CASE
      WHEN COUNT(*) > 0
      THEN ROUND((COUNT(*) FILTER (WHERE vh.has_proper_capitalization = TRUE AND vh.subject_length BETWEEN 10 AND 72)::NUMERIC / COUNT(*)) * 100, 1)
      ELSE 0
    END AS meaningful_msg_pct,
    100.0 AS non_merge_pct  -- Always 100% since we filter out merge commits in the view
  FROM vw_commit_hygiene vh
  JOIN team_members tm ON (
    vh.author = tm.full_name
    OR (tm.full_name IS NULL AND vh.author = tm.login)
  )
`;

// ============================================================================
// Query: QUERY_ORG_VELOCITY_VS_LOC
// ============================================================================

/**
 * Get sprint velocity vs LOC for an organization.
 * CRITICAL: Uses COALESCE(jira_name, full_name) for Jira assignee matching.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 *   $3 - aggregation period ('week' or 'month') (TEXT)
 */
export const QUERY_ORG_VELOCITY_VS_LOC = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name, cc.email, cc.jira_name, t.team_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  ),
  team_commits AS (
    SELECT
      DATE_TRUNC($3, ch.commit_date)::date AS week_start,
      COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS lines_of_code,
      COUNT(DISTINCT ch.sha)::int AS commit_count
    FROM commit_history ch
    LEFT JOIN commit_files cf ON cf.sha = ch.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE ch.commit_date >= $2
      AND ch.is_merge = FALSE
    GROUP BY week_start
  ),
  team_linear_points AS (
    SELECT
      DATE_TRUNC($3, ld.completed_date)::date AS week_start,
      COALESCE(SUM(ld.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT ld.linear_key)::int AS issue_count
    FROM linear_detail ld
    JOIN team_members tm ON (
      ld.assignee = tm.email OR ld.assignee = tm.login OR ld.assignee = tm.full_name
    )
    WHERE ld.completed_date >= $2
      AND ld.state IN ('Done', 'Completed')
    GROUP BY week_start
  ),
  team_jira_points AS (
    -- CRITICAL: Join on COALESCE(jira_name, full_name) - NOT email or login
    SELECT
      DATE_TRUNC($3, jh.change_date)::date AS week_start,
      COALESCE(SUM(jd.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT jd.jira_key)::int AS issue_count
    FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    JOIN team_members tm ON jd.assignee = COALESCE(tm.jira_name, tm.full_name)
    WHERE jh.change_date >= $2
      AND jh.field = 'status'
      AND jh.to_value IN ('Done', 'Closed', 'Resolved')
    GROUP BY week_start
  ),
  combined_points AS (
    SELECT week_start, story_points, issue_count FROM team_linear_points
    UNION ALL
    SELECT week_start, story_points, issue_count FROM team_jira_points
  ),
  aggregated_points AS (
    SELECT
      week_start,
      SUM(story_points)::int AS story_points,
      SUM(issue_count)::int AS issue_count
    FROM combined_points
    GROUP BY week_start
  )
  SELECT
    COALESCE(tc.week_start, ap.week_start) AS week_start,
    COALESCE(ap.story_points, 0) AS story_points,
    COALESCE(tc.lines_of_code, 0) AS lines_of_code,
    COALESCE(ap.issue_count, 0) AS issue_count,
    COALESCE(tc.commit_count, 0) AS commit_count
  FROM team_commits tc
  FULL OUTER JOIN aggregated_points ap ON tc.week_start = ap.week_start
  WHERE COALESCE(tc.week_start, ap.week_start) IS NOT NULL
  ORDER BY week_start ASC
  LIMIT ${ORG_PROFILE_MAX_ROWS}
`;

// ============================================================================
// Query: QUERY_ORG_VELOCITY_BY_TEAM
// GITX-201: Sprint Velocity with team breakdown for stacked bar chart
// ============================================================================

/**
 * Velocity by team per period row from database.
 * GITX-201: Used for team-colored stacked bar chart.
 */
export interface OrgVelocityByTeamDbRow {
  readonly week_start: Date | string;
  readonly team_name: string;
  readonly story_points: number;
  readonly issue_count: number;
  readonly lines_of_code: number | string;
  readonly commit_count: number;
}

/**
 * Get sprint velocity broken down by team for stacked bar chart.
 * CRITICAL: Uses COALESCE(jira_name, full_name) for Jira assignee matching.
 * GITX-201: Team-colored bars with LOC trend line overlay.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 *   $3 - aggregation period ('week' or 'month') (TEXT)
 */
export const QUERY_ORG_VELOCITY_BY_TEAM = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name, cc.email, cc.jira_name, t.team_name, t.team_id
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  ),
  team_commits AS (
    SELECT
      DATE_TRUNC($3, ch.commit_date)::date AS week_start,
      tm.team_name,
      COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS lines_of_code,
      COUNT(DISTINCT ch.sha)::int AS commit_count
    FROM commit_history ch
    LEFT JOIN commit_files cf ON cf.sha = ch.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE ch.commit_date >= $2
      AND ch.is_merge = FALSE
    GROUP BY week_start, tm.team_name
  ),
  team_linear_points AS (
    SELECT
      DATE_TRUNC($3, ld.completed_date)::date AS week_start,
      tm.team_name,
      COALESCE(SUM(ld.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT ld.linear_key)::int AS issue_count
    FROM linear_detail ld
    JOIN team_members tm ON (
      ld.assignee = tm.email OR ld.assignee = tm.login OR ld.assignee = tm.full_name
    )
    WHERE ld.completed_date >= $2
      AND ld.state IN ('Done', 'Completed')
    GROUP BY week_start, tm.team_name
  ),
  team_jira_points AS (
    -- CRITICAL: Join on COALESCE(jira_name, full_name) - NOT email or login
    SELECT
      DATE_TRUNC($3, jh.change_date)::date AS week_start,
      tm.team_name,
      COALESCE(SUM(jd.calculated_story_points), 0)::int AS story_points,
      COUNT(DISTINCT jd.jira_key)::int AS issue_count
    FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    JOIN team_members tm ON jd.assignee = COALESCE(tm.jira_name, tm.full_name)
    WHERE jh.change_date >= $2
      AND jh.field = 'status'
      AND jh.to_value IN ('Done', 'Closed', 'Resolved')
    GROUP BY week_start, tm.team_name
  ),
  combined_points AS (
    SELECT week_start, team_name, story_points, issue_count FROM team_linear_points
    UNION ALL
    SELECT week_start, team_name, story_points, issue_count FROM team_jira_points
  ),
  aggregated_team_points AS (
    SELECT
      week_start,
      team_name,
      SUM(story_points)::int AS story_points,
      SUM(issue_count)::int AS issue_count
    FROM combined_points
    GROUP BY week_start, team_name
  )
  SELECT
    COALESCE(tc.week_start, ap.week_start) AS week_start,
    COALESCE(tc.team_name, ap.team_name) AS team_name,
    COALESCE(ap.story_points, 0) AS story_points,
    COALESCE(ap.issue_count, 0) AS issue_count,
    COALESCE(tc.lines_of_code, 0) AS lines_of_code,
    COALESCE(tc.commit_count, 0) AS commit_count
  FROM team_commits tc
  FULL OUTER JOIN aggregated_team_points ap ON tc.week_start = ap.week_start AND tc.team_name = ap.team_name
  WHERE COALESCE(tc.week_start, ap.week_start) IS NOT NULL
  ORDER BY week_start ASC, team_name ASC
  LIMIT ${ORG_PROFILE_MAX_ROWS}
`;

// ============================================================================
// Query: QUERY_ORG_LOC_BY_TEAM
// GITX-201: LOC by team for team-colored line chart
// ============================================================================

/**
 * LOC by team per period row from database.
 * GITX-201: Used for team-colored LOC line chart.
 */
export interface OrgLocByTeamDbRow {
  readonly week_start: Date | string;
  readonly team_name: string;
  readonly lines_added: number | string;
}

/**
 * Get LOC aggregated by team for team-colored line chart.
 * GITX-201: Each team as a separate colored line on the LOC chart.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 *   $3 - aggregation period ('week' or 'month') (TEXT)
 */
export const QUERY_ORG_LOC_BY_TEAM = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name, t.team_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  )
  SELECT
    DATE_TRUNC($3, ch.commit_date)::date AS week_start,
    tm.team_name,
    COALESCE(SUM(cf.line_inserts - COALESCE(cf.line_deletes, 0)), 0)::bigint AS lines_added
  FROM commit_history ch
  LEFT JOIN commit_files cf ON cf.sha = ch.sha
  JOIN team_members tm ON (
    ch.author = tm.full_name
    OR (tm.full_name IS NULL AND ch.author = tm.login)
  )
  WHERE ch.commit_date >= $2
    AND ch.is_merge = FALSE
  GROUP BY week_start, tm.team_name
  ORDER BY week_start ASC, tm.team_name ASC
  LIMIT ${ORG_PROFILE_MAX_ROWS}
`;

// ============================================================================
// Query: QUERY_ORG_HOT_SPOTS
// ============================================================================

/**
 * Get top 10 hot spots across all teams in an organization.
 * Returns files ordered by risk_score descending.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 */
export const QUERY_ORG_HOT_SPOTS = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name, t.team_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  ),
  team_files AS (
    SELECT DISTINCT cf.filename AS file_path, ch.repository, tm.team_name
    FROM commit_files cf
    JOIN commit_history ch ON ch.sha = cf.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE ch.is_merge = FALSE
  )
  SELECT
    hs.file_path,
    hs.repository,
    tf.team_name,
    hs.churn_count,
    hs.complexity,
    hs.loc,
    hs.risk_score,
    hs.risk_tier
  FROM vw_hot_spots hs
  JOIN team_files tf ON hs.file_path = tf.file_path AND hs.repository = tf.repository
  ORDER BY hs.risk_score DESC NULLS LAST
  LIMIT 10
`;

// ============================================================================
// Query: QUERY_ORG_KNOWLEDGE_CONCENTRATION
// ============================================================================

/**
 * Get org-wide knowledge concentration risks.
 * Returns files with high knowledge concentration filtered by org teams.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 */
export const QUERY_ORG_KNOWLEDGE_CONCENTRATION = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name, t.team_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  ),
  team_files AS (
    SELECT DISTINCT cf.filename AS file_path, ch.repository, tm.team_name
    FROM commit_files cf
    JOIN commit_history ch ON ch.sha = cf.sha
    JOIN team_members tm ON (
      ch.author = tm.full_name
      OR (tm.full_name IS NULL AND ch.author = tm.login)
    )
    WHERE ch.is_merge = FALSE
  )
  SELECT
    kc.file_path,
    kc.repository,
    tf.team_name,
    kc.total_commits,
    kc.total_contributors,
    kc.top_contributor,
    kc.top_contributor_pct,
    kc.concentration_risk
  FROM vw_knowledge_concentration kc
  JOIN team_files tf ON kc.file_path = tf.file_path AND kc.repository = tf.repository
  ORDER BY kc.top_contributor_pct DESC NULLS LAST
  LIMIT 30
`;

// ============================================================================
// Query: QUERY_ORG_TOTAL_STORY_POINTS
// GITX-206: Added for Avg SP/Period KPI card
// ============================================================================

/**
 * Type definition for story points database row.
 */
export interface OrgTotalStoryPointsDbRow {
  readonly total_story_points: number | null;
}

/**
 * Get total story points completed by organization members within a date range.
 * CRITICAL: Uses COALESCE(jira_name, full_name) for Jira assignee matching.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 */
export const QUERY_ORG_TOTAL_STORY_POINTS = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_members AS (
    SELECT DISTINCT cc.login, cc.full_name, cc.email, cc.jira_name
    FROM commit_contributors cc
    INNER JOIN org_teams t ON cc.team_id = t.team_id
  ),
  linear_points AS (
    SELECT COALESCE(SUM(ld.calculated_story_points), 0)::int AS story_points
    FROM linear_detail ld
    JOIN team_members tm ON (
      ld.assignee = tm.email OR ld.assignee = tm.login OR ld.assignee = tm.full_name
    )
    WHERE ld.completed_date >= $2
      AND ld.state IN ('Done', 'Completed')
  ),
  jira_points AS (
    -- CRITICAL: Join on COALESCE(jira_name, full_name) - NOT email or login
    SELECT COALESCE(SUM(jd.calculated_story_points), 0)::int AS story_points
    FROM jira_history jh
    JOIN jira_detail jd ON jh.jira_key = jd.jira_key
    JOIN team_members tm ON jd.assignee = COALESCE(tm.jira_name, tm.full_name)
    WHERE jh.change_date >= $2
      AND jh.field = 'status'
      AND jh.to_value IN ('Done', 'Closed', 'Resolved')
  )
  SELECT
    CASE
      WHEN (SELECT story_points FROM linear_points) = 0
        AND (SELECT story_points FROM jira_points) = 0
      THEN NULL
      ELSE ((SELECT story_points FROM linear_points) + (SELECT story_points FROM jira_points))
    END AS total_story_points
`;

// ============================================================================
// View Existence Check Queries
// ============================================================================

// ============================================================================
// Query: QUERY_ORG_TEAM_DATA_COVERAGE
// GITX-210: Partial Data Coverage Handling - Get team commit counts
// ============================================================================

/**
 * Type definition for team data coverage row.
 * GITX-210: Shows which teams have data in the selected timeframe.
 */
export interface OrgTeamDataCoverageDbRow {
  readonly team_id: number;
  readonly team_name: string;
  readonly commit_count: number;
  readonly has_jira_data: boolean;
}

/**
 * Get commit counts and Jira data availability per team within an organization.
 * GITX-210: Used to show "Showing data for X of Y teams" warning banner.
 *
 * Parameters:
 *   $1 - organization_id (INTEGER)
 *   $2 - start_date (DATE)
 */
export const QUERY_ORG_TEAM_DATA_COVERAGE = `
  WITH org_teams AS (
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    WHERE t.organization_id = $1
  ),
  team_member_counts AS (
    SELECT
      t.team_id,
      t.team_name,
      ARRAY_AGG(DISTINCT cc.login) AS member_logins,
      ARRAY_AGG(DISTINCT cc.full_name) AS member_full_names,
      ARRAY_AGG(DISTINCT COALESCE(cc.jira_name, cc.full_name)) AS member_jira_names
    FROM org_teams t
    LEFT JOIN commit_contributors cc ON cc.team_id = t.team_id
    GROUP BY t.team_id, t.team_name
  ),
  team_commits AS (
    SELECT
      tmc.team_id,
      tmc.team_name,
      COUNT(DISTINCT ch.sha)::int AS commit_count
    FROM team_member_counts tmc
    LEFT JOIN commit_history ch ON (
      ch.author = ANY(tmc.member_full_names)
      OR (tmc.member_full_names IS NULL AND ch.author = ANY(tmc.member_logins))
    )
    WHERE ch.is_merge = FALSE
      AND ch.commit_date >= $2
    GROUP BY tmc.team_id, tmc.team_name
  ),
  team_jira AS (
    SELECT
      tmc.team_id,
      CASE
        WHEN COUNT(DISTINCT jd.jira_key) > 0 THEN TRUE
        ELSE FALSE
      END AS has_jira_data
    FROM team_member_counts tmc
    LEFT JOIN jira_detail jd ON jd.assignee = ANY(tmc.member_jira_names)
    LEFT JOIN jira_history jh ON jh.jira_key = jd.jira_key AND jh.change_date >= $2
    GROUP BY tmc.team_id
  )
  SELECT
    ot.team_id,
    ot.team_name,
    COALESCE(tc.commit_count, 0)::int AS commit_count,
    COALESCE(tj.has_jira_data, FALSE) AS has_jira_data
  FROM org_teams ot
  LEFT JOIN team_commits tc ON ot.team_id = tc.team_id
  LEFT JOIN team_jira tj ON ot.team_id = tj.team_id
  ORDER BY ot.team_name ASC
`;

/**
 * Check if the organizations table exists.
 * Used for graceful degradation if migration 030 has not been applied.
 */
export const QUERY_ORG_TABLE_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'organizations'
  ) AS table_exists
`;

/**
 * Check if the teams table has organization_id column.
 * Used for graceful degradation if migration 030 has not been applied.
 */
export const QUERY_TEAMS_ORG_FK_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teams'
      AND column_name = 'organization_id'
  ) AS column_exists
`;
