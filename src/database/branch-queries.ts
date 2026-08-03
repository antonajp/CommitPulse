/**
 * SQL query constants for branch tracking operations.
 * All queries use parameterized placeholders ($1, $2) -- zero string interpolation.
 * Ticket: GITX-231
 */

export const SQL_UPSERT_BRANCH = `
  INSERT INTO git_branch
    (branch_name, repository, last_commit_sha, last_commit_date, last_commit_author,
     commit_count, is_merged, merged_into, merged_date, is_orphaned,
     has_open_pr, is_protected, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
  ON CONFLICT (repository, branch_name)
  DO UPDATE SET
    last_commit_sha = EXCLUDED.last_commit_sha,
    last_commit_date = EXCLUDED.last_commit_date,
    last_commit_author = EXCLUDED.last_commit_author,
    commit_count = EXCLUDED.commit_count,
    is_merged = EXCLUDED.is_merged,
    merged_into = EXCLUDED.merged_into,
    merged_date = EXCLUDED.merged_date,
    is_orphaned = EXCLUDED.is_orphaned,
    has_open_pr = EXCLUDED.has_open_pr,
    is_protected = EXCLUDED.is_protected,
    updated_at = CURRENT_TIMESTAMP
`;

export const SQL_GET_BRANCHES_FOR_REPOSITORY = `
  SELECT
    id, branch_name, repository, last_commit_sha, last_commit_date,
    last_commit_author, commit_count, is_merged, merged_into, merged_date,
    is_orphaned, has_open_pr, is_protected, deleted_at, deleted_by,
    created_at, updated_at
  FROM git_branch
  WHERE repository = $1
    AND deleted_at IS NULL
  ORDER BY last_commit_date DESC
`;

export const SQL_GET_DEAD_BRANCH_SUMMARY_BASE = `
  SELECT
    id, branch_name, repository, last_commit_date, last_commit_author,
    last_commit_sha, commit_count, is_merged, merged_into, is_orphaned,
    has_open_pr, is_protected, created_at, updated_at,
    days_since_last_commit, status, risk_level
  FROM vw_dead_branch_summary
`;

export const SQL_MARK_BRANCH_DELETED = `
  UPDATE git_branch
  SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $3, updated_at = CURRENT_TIMESTAMP
  WHERE repository = $1 AND branch_name = $2 AND deleted_at IS NULL
`;

export const SQL_INSERT_OPERATION_AUDIT = `
  INSERT INTO git_operation_audit
    (operation_type, repository, branch_name, branch_sha, operator, result, error_message, metadata)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

export const SQL_GET_BRANCH_STATISTICS = `
  SELECT
    COUNT(*)::int AS total_branches,
    COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS active_count,
    COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted_count,
    COUNT(*) FILTER (WHERE is_protected = TRUE)::int AS protected_count
  FROM git_branch
  WHERE repository = $1
`;

export const SQL_GET_SUMMARY_STATISTICS = `
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE risk_level = 'safe')::int AS safe_count,
    COUNT(*) FILTER (WHERE risk_level = 'low')::int AS low_count,
    COUNT(*) FILTER (WHERE risk_level = 'medium')::int AS medium_count,
    COUNT(*) FILTER (WHERE risk_level = 'high')::int AS high_count,
    COUNT(*) FILTER (WHERE status = 'merged')::int AS merged_count,
    COUNT(*) FILTER (WHERE status = 'stale')::int AS stale_count,
    COUNT(*) FILTER (WHERE status = 'orphaned')::int AS orphaned_count,
    COUNT(*) FILTER (WHERE status = 'active')::int AS active_count
  FROM vw_dead_branch_summary
  WHERE repository = $1
`;

export const SQL_GET_BRANCH_BY_NAME = `
  SELECT
    id, branch_name, repository, last_commit_sha, last_commit_date,
    last_commit_author, commit_count, is_merged, merged_into, merged_date,
    is_orphaned, has_open_pr, is_protected, deleted_at, deleted_by,
    created_at, updated_at
  FROM git_branch
  WHERE repository = $1 AND branch_name = $2
`;

export const SQL_GET_RECENT_AUDIT_LOGS = `
  SELECT
    id, operation_type, repository, branch_name, branch_sha,
    operator, result, error_message, metadata, created_at
  FROM git_operation_audit
  WHERE repository = $1
  ORDER BY created_at DESC
  LIMIT $2
`;

// ============================================================================
// Aggregate Queries (for dashboard)
// ============================================================================

/**
 * Get global summary statistics across all repositories (no filter).
 * Used by DeadBranchesPanel for the KPI cards.
 */
export const SQL_GET_GLOBAL_SUMMARY_STATISTICS = `
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE status = 'merged')::int AS merged_count,
    COUNT(*) FILTER (WHERE status = 'stale')::int AS stale_count,
    COUNT(*) FILTER (WHERE status = 'orphaned')::int AS orphaned_count,
    COUNT(*) FILTER (WHERE status = 'active')::int AS active_count
  FROM vw_dead_branch_summary
`;

/**
 * Get global risk distribution across all repositories (no filter).
 * Used by DeadBranchesPanel for the risk donut chart.
 */
export const SQL_GET_GLOBAL_RISK_DISTRIBUTION = `
  SELECT
    COUNT(*) FILTER (WHERE risk_level = 'safe')::int AS safe_count,
    COUNT(*) FILTER (WHERE risk_level = 'low')::int AS low_count,
    COUNT(*) FILTER (WHERE risk_level = 'medium')::int AS medium_count,
    COUNT(*) FILTER (WHERE risk_level = 'high')::int AS high_count
  FROM vw_dead_branch_summary
`;

/**
 * Get risk breakdown by repository.
 * Used by DeadBranchesPanel for the stacked bar chart.
 *
 * GITX-235: Uses LEFT JOIN to include all repositories, even those with only
 * protected branches (which have zero rows in vw_dead_branch_summary).
 * This ensures all 42 configured repositories appear in the chart, not just
 * the 2 that have non-protected branches.
 */
export const SQL_GET_REPOSITORY_RISK_BREAKDOWN = `
  WITH all_repos AS (
    SELECT DISTINCT repository
    FROM git_branch
    WHERE deleted_at IS NULL
  )
  SELECT
    ar.repository,
    COALESCE(COUNT(*) FILTER (WHERE vdbs.risk_level = 'safe'), 0)::int AS safe_count,
    COALESCE(COUNT(*) FILTER (WHERE vdbs.risk_level = 'low'), 0)::int AS low_count,
    COALESCE(COUNT(*) FILTER (WHERE vdbs.risk_level = 'medium'), 0)::int AS medium_count,
    COALESCE(COUNT(*) FILTER (WHERE vdbs.risk_level = 'high'), 0)::int AS high_count
  FROM all_repos ar
  LEFT JOIN vw_dead_branch_summary vdbs ON ar.repository = vdbs.repository
  GROUP BY ar.repository
  ORDER BY ar.repository
`;

/**
 * Get distinct repositories from the view.
 * Used by DeadBranchesPanel for filter dropdown options.
 *
 * GITX-235: Query git_branch table directly instead of the view to include
 * all repositories, even those with only protected branches.
 */
export const SQL_GET_DISTINCT_REPOSITORIES = `
  SELECT DISTINCT repository
  FROM git_branch
  WHERE deleted_at IS NULL
  ORDER BY repository
`;

/**
 * Get total branch count (all non-deleted branches including protected).
 * Used by DeadBranchesPanel to show accurate total branch counts.
 *
 * GITX-235: Separate query for total branches vs cleanup candidates.
 */
export const SQL_GET_TOTAL_BRANCH_COUNT = `
  SELECT
    COUNT(*)::int AS total_branches,
    COUNT(*) FILTER (WHERE is_protected = FALSE)::int AS cleanup_candidates
  FROM git_branch
  WHERE deleted_at IS NULL
`;

// ============================================================================
// Commit History Based Queries (GITX-237)
// ============================================================================

/**
 * Get branch metadata from commit_history table.
 * Used as an alternative to live git commands when the database is already populated.
 *
 * GITX-237: Extract branches from commit_history instead of requiring git fetches.
 * Normalizes branch names to strip 'origin/' prefix.
 * Calculates days_since_last_commit for staleness analysis.
 *
 * Params: $1 = repository filter (optional, use NULL for all repositories)
 */
export const SQL_GET_BRANCHES_FROM_COMMIT_HISTORY = `
  SELECT
    REGEXP_REPLACE(branch, '^origin/', '') AS branch_name,
    repository,
    MAX(commit_date) AS last_commit_date,
    MAX(author) AS last_commit_author,
    COUNT(DISTINCT sha)::int AS commit_count,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(commit_date)))::int / 86400 AS days_since_last_commit
  FROM commit_history
  WHERE branch IS NOT NULL
    AND branch != ''
    AND ($1::TEXT IS NULL OR repository = $1)
  GROUP BY REGEXP_REPLACE(branch, '^origin/', ''), repository
  ORDER BY repository, last_commit_date DESC
`;

/**
 * Get the most recent commit_date for a repository to show data freshness.
 * Used by DeadBranchesPanel to display when commit_history was last updated.
 *
 * GITX-237: Provides a data freshness indicator for database-driven branch analysis.
 *
 * Params: $1 = repository name
 */
export const SQL_GET_COMMIT_HISTORY_LAST_UPDATED = `
  SELECT MAX(commit_date) AS last_updated
  FROM commit_history
  WHERE repository = $1
`;

/**
 * Get distinct repositories from commit_history table.
 * Used by DeadBranchesPanel when operating in database-driven mode.
 *
 * GITX-237: Alternative to git_branch table when branches are sourced from commit_history.
 */
export const SQL_GET_DISTINCT_REPOSITORIES_FROM_COMMIT_HISTORY = `
  SELECT DISTINCT repository
  FROM commit_history
  WHERE repository IS NOT NULL
    AND repository != ''
  ORDER BY repository
`;

/**
 * Get branches with risk calculation from commit_history table.
 * Used by DeadBranchesPanel for database-driven Dead Branches Report.
 *
 * GITX-237: Full branch risk analysis without requiring live git commands.
 * Note: Without git merge-base, we cannot determine if a branch is merged.
 * Therefore, is_merged defaults to false and risk calculation assumes unmerged.
 *
 * Risk levels (for unmerged branches):
 *   - high: < 90 days since last commit (recent, likely active)
 *   - medium: 90-180 days since last commit (stale)
 *   - medium: > 180 days since last commit (very stale)
 *
 * Status determination:
 *   - stale: > 90 days since last commit
 *   - active: <= 90 days since last commit
 *
 * Params: $1 = repository filter (optional, use NULL for all repositories)
 */
export const SQL_GET_BRANCHES_WITH_RISK_FROM_COMMIT_HISTORY = `
  SELECT
    REGEXP_REPLACE(branch, '^origin/', '') AS branch_name,
    repository,
    MAX(commit_date) AS last_commit_date,
    MAX(author) AS last_commit_author,
    MAX(sha) AS last_commit_sha,
    COUNT(DISTINCT sha)::int AS commit_count,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(commit_date)))::int / 86400 AS days_since_last_commit,
    false AS is_merged,
    NULL::VARCHAR AS merged_into,
    false AS is_orphaned,
    false AS has_open_pr,
    false AS is_protected,
    CASE
      WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(commit_date)))::int / 86400 > 90 THEN 'stale'
      ELSE 'active'
    END AS status,
    CASE
      WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(commit_date)))::int / 86400 < 90 THEN 'high'
      WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(commit_date)))::int / 86400 BETWEEN 90 AND 180 THEN 'medium'
      ELSE 'medium'
    END AS risk_level
  FROM commit_history
  WHERE branch IS NOT NULL
    AND branch != ''
    AND ($1::TEXT IS NULL OR repository = $1)
  GROUP BY REGEXP_REPLACE(branch, '^origin/', ''), repository
  ORDER BY repository, last_commit_date DESC
`;

/**
 * Get the most recent commit_date across all repositories.
 * Used by DeadBranchesPanel when no repository filter is specified.
 *
 * GITX-237: Global data freshness indicator.
 *
 * @returns Single row with last_updated timestamp, or null if no commits exist.
 */
export const SQL_GET_COMMIT_HISTORY_LAST_UPDATED_ALL = `
  SELECT MAX(commit_date) AS last_updated
  FROM commit_history
`;
