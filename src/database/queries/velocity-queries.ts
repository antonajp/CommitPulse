/**
 * Parameterized SQL queries for the Sprint Velocity vs LOC chart.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against the vw_sprint_velocity_vs_loc view created
 * by migration 008_sprint_velocity_loc_view.sql and updated in
 * migration 025_velocity_dual_story_points.sql.
 *
 * Ticket: IQS-888, IQS-944, GITX-121
 */

/**
 * Query to fetch sprint velocity vs LOC data from the database view.
 * Aggregates weekly story points and LOC by ISO week.
 *
 * The view uses FULL OUTER JOIN so weeks with only commits (no issues)
 * or only issues (no commits) are both included.
 *
 * Returns rows ordered by week_start ASC for chronological charting.
 * Limited to 200 weeks (~4 years) for safety.
 *
 * IQS-944: Now includes human_story_points and ai_story_points for comparison.
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC = `
  SELECT
    week_start,
    team,
    project,
    repository,
    human_story_points,
    ai_story_points,
    total_story_points,
    issue_count,
    total_loc_changed,
    total_lines_added,
    total_lines_deleted,
    commit_count
  FROM vw_sprint_velocity_vs_loc
  ORDER BY week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with date range filter.
 * Parameters:
 *   $1 - start_date (DATE) - beginning of date range
 *   $2 - end_date (DATE) - end of date range
 *
 * IQS-944: Now includes human_story_points and ai_story_points for comparison.
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE = `
  SELECT
    week_start,
    team,
    project,
    repository,
    human_story_points,
    ai_story_points,
    total_story_points,
    issue_count,
    total_loc_changed,
    total_lines_added,
    total_lines_deleted,
    commit_count
  FROM vw_sprint_velocity_vs_loc
  WHERE week_start >= $1 AND week_start <= $2
  ORDER BY week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with team filter.
 * Parameters:
 *   $1 - team (TEXT) - team name to filter by
 *
 * IQS-944: Now includes human_story_points and ai_story_points for comparison.
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_TEAM = `
  SELECT
    week_start,
    team,
    project,
    repository,
    human_story_points,
    ai_story_points,
    total_story_points,
    issue_count,
    total_loc_changed,
    total_lines_added,
    total_lines_deleted,
    commit_count
  FROM vw_sprint_velocity_vs_loc
  WHERE team = $1
  ORDER BY week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with date range AND team filter.
 * Parameters:
 *   $1 - start_date (DATE) - beginning of date range
 *   $2 - end_date (DATE) - end of date range
 *   $3 - team (TEXT) - team name to filter by
 *
 * IQS-944: Now includes human_story_points and ai_story_points for comparison.
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM = `
  SELECT
    week_start,
    team,
    project,
    repository,
    human_story_points,
    ai_story_points,
    total_story_points,
    issue_count,
    total_loc_changed,
    total_lines_added,
    total_lines_deleted,
    commit_count
  FROM vw_sprint_velocity_vs_loc
  WHERE week_start >= $1 AND week_start <= $2
    AND team = $3
  ORDER BY week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with repository filter.
 * Parameters:
 *   $1 - repository (TEXT) - repository name to filter by
 *
 * Ticket: IQS-920, IQS-944
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_REPOSITORY = `
  SELECT
    week_start,
    team,
    project,
    repository,
    human_story_points,
    ai_story_points,
    total_story_points,
    issue_count,
    total_loc_changed,
    total_lines_added,
    total_lines_deleted,
    commit_count
  FROM vw_sprint_velocity_vs_loc
  WHERE repository = $1
  ORDER BY week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with date range AND repository filter.
 * Parameters:
 *   $1 - start_date (DATE) - beginning of date range
 *   $2 - end_date (DATE) - end of date range
 *   $3 - repository (TEXT) - repository name to filter by
 *
 * Ticket: IQS-920, IQS-944
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_REPOSITORY = `
  SELECT
    week_start,
    team,
    project,
    repository,
    human_story_points,
    ai_story_points,
    total_story_points,
    issue_count,
    total_loc_changed,
    total_lines_added,
    total_lines_deleted,
    commit_count
  FROM vw_sprint_velocity_vs_loc
  WHERE week_start >= $1 AND week_start <= $2
    AND repository = $3
  ORDER BY week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with team AND repository filter.
 * Parameters:
 *   $1 - team (TEXT) - team name to filter by
 *   $2 - repository (TEXT) - repository name to filter by
 *
 * Ticket: IQS-920, IQS-944
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_REPOSITORY = `
  SELECT
    week_start,
    team,
    project,
    repository,
    human_story_points,
    ai_story_points,
    total_story_points,
    issue_count,
    total_loc_changed,
    total_lines_added,
    total_lines_deleted,
    commit_count
  FROM vw_sprint_velocity_vs_loc
  WHERE team = $1
    AND repository = $2
  ORDER BY week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with date range, team, AND repository filter.
 * Parameters:
 *   $1 - start_date (DATE) - beginning of date range
 *   $2 - end_date (DATE) - end of date range
 *   $3 - team (TEXT) - team name to filter by
 *   $4 - repository (TEXT) - repository name to filter by
 *
 * Ticket: IQS-920, IQS-944
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_REPOSITORY = `
  SELECT
    week_start,
    team,
    project,
    repository,
    human_story_points,
    ai_story_points,
    total_story_points,
    issue_count,
    total_loc_changed,
    total_lines_added,
    total_lines_deleted,
    commit_count
  FROM vw_sprint_velocity_vs_loc
  WHERE week_start >= $1 AND week_start <= $2
    AND team = $3
    AND repository = $4
  ORDER BY week_start ASC
  LIMIT 200
`;

/**
 * Query to check if the vw_sprint_velocity_vs_loc view exists.
 * Used for graceful degradation if migration 008 has not been applied.
 */
export const QUERY_VELOCITY_VIEW_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'vw_sprint_velocity_vs_loc'
  ) AS view_exists
`;

// ============================================================================
// Filter Options Queries (GITX-121)
// ============================================================================

/**
 * Query to get unique teams from commit_contributors for filter dropdown.
 * Returns distinct non-null team values sorted alphabetically.
 * Limited to 1000 results for safety (GITX-129).
 * Ticket: GITX-121, GITX-129
 */
export const QUERY_VELOCITY_UNIQUE_TEAMS = `
  SELECT DISTINCT team
  FROM commit_contributors
  WHERE team IS NOT NULL AND team <> ''
  ORDER BY team ASC
  LIMIT 1000
`;

/**
 * Query to get unique contributors from commit_contributors for filter dropdown.
 * Returns distinct login values sorted alphabetically.
 * Limited to 5000 results for safety (GITX-129).
 * Ticket: GITX-121, GITX-129
 */
export const QUERY_VELOCITY_UNIQUE_CONTRIBUTORS = `
  SELECT DISTINCT login
  FROM commit_contributors
  WHERE login IS NOT NULL AND login <> ''
  ORDER BY login ASC
  LIMIT 5000
`;

/**
 * Query to get unique repositories from commit_history for filter dropdown.
 * Returns distinct repository values sorted alphabetically.
 * Limited to 500 results for safety (GITX-129).
 * Ticket: GITX-121, GITX-129
 */
export const QUERY_VELOCITY_UNIQUE_REPOSITORIES = `
  SELECT DISTINCT repository
  FROM commit_history
  WHERE repository IS NOT NULL AND repository <> ''
  ORDER BY repository ASC
  LIMIT 500
`;

// ============================================================================
// Team Member Filtered Queries (GITX-121)
// ============================================================================

/**
 * Query to fetch sprint velocity vs LOC data with team member filter.
 * Requires JOIN to commit_history to match contributor login with author.
 * Parameters:
 *   $1 - teamMember (TEXT) - contributor login to filter by
 *
 * Ticket: GITX-121
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_MEMBER = `
  SELECT
    v.week_start,
    v.team,
    v.project,
    v.repository,
    v.human_story_points,
    v.ai_story_points,
    v.total_story_points,
    v.issue_count,
    v.total_loc_changed,
    v.total_lines_added,
    v.total_lines_deleted,
    v.commit_count
  FROM vw_sprint_velocity_vs_loc v
  INNER JOIN commit_history ch ON v.repository = ch.repo
    AND DATE_TRUNC('week', ch.commit_date)::DATE = v.week_start
  INNER JOIN commit_contributors cc ON ch.author = cc.login
  WHERE cc.login = $1
  GROUP BY v.week_start, v.team, v.project, v.repository,
    v.human_story_points, v.ai_story_points, v.total_story_points,
    v.issue_count, v.total_loc_changed, v.total_lines_added,
    v.total_lines_deleted, v.commit_count
  ORDER BY v.week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with team AND team member filter.
 * Parameters:
 *   $1 - team (TEXT) - team name to filter by
 *   $2 - teamMember (TEXT) - contributor login to filter by
 *
 * Ticket: GITX-121
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_MEMBER_COMBINED = `
  SELECT
    v.week_start,
    v.team,
    v.project,
    v.repository,
    v.human_story_points,
    v.ai_story_points,
    v.total_story_points,
    v.issue_count,
    v.total_loc_changed,
    v.total_lines_added,
    v.total_lines_deleted,
    v.commit_count
  FROM vw_sprint_velocity_vs_loc v
  INNER JOIN commit_history ch ON v.repository = ch.repo
    AND DATE_TRUNC('week', ch.commit_date)::DATE = v.week_start
  INNER JOIN commit_contributors cc ON ch.author = cc.login
  WHERE v.team = $1 AND cc.login = $2
  GROUP BY v.week_start, v.team, v.project, v.repository,
    v.human_story_points, v.ai_story_points, v.total_story_points,
    v.issue_count, v.total_loc_changed, v.total_lines_added,
    v.total_lines_deleted, v.commit_count
  ORDER BY v.week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with team member AND repository filter.
 * Parameters:
 *   $1 - teamMember (TEXT) - contributor login to filter by
 *   $2 - repository (TEXT) - repository name to filter by
 *
 * Ticket: GITX-121
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_MEMBER_REPOSITORY = `
  SELECT
    v.week_start,
    v.team,
    v.project,
    v.repository,
    v.human_story_points,
    v.ai_story_points,
    v.total_story_points,
    v.issue_count,
    v.total_loc_changed,
    v.total_lines_added,
    v.total_lines_deleted,
    v.commit_count
  FROM vw_sprint_velocity_vs_loc v
  INNER JOIN commit_history ch ON v.repository = ch.repo
    AND DATE_TRUNC('week', ch.commit_date)::DATE = v.week_start
  INNER JOIN commit_contributors cc ON ch.author = cc.login
  WHERE cc.login = $1 AND v.repository = $2
  GROUP BY v.week_start, v.team, v.project, v.repository,
    v.human_story_points, v.ai_story_points, v.total_story_points,
    v.issue_count, v.total_loc_changed, v.total_lines_added,
    v.total_lines_deleted, v.commit_count
  ORDER BY v.week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with team, team member, AND repository filter.
 * Parameters:
 *   $1 - team (TEXT) - team name to filter by
 *   $2 - teamMember (TEXT) - contributor login to filter by
 *   $3 - repository (TEXT) - repository name to filter by
 *
 * Ticket: GITX-121
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_ALL_FILTERS = `
  SELECT
    v.week_start,
    v.team,
    v.project,
    v.repository,
    v.human_story_points,
    v.ai_story_points,
    v.total_story_points,
    v.issue_count,
    v.total_loc_changed,
    v.total_lines_added,
    v.total_lines_deleted,
    v.commit_count
  FROM vw_sprint_velocity_vs_loc v
  INNER JOIN commit_history ch ON v.repository = ch.repo
    AND DATE_TRUNC('week', ch.commit_date)::DATE = v.week_start
  INNER JOIN commit_contributors cc ON ch.author = cc.login
  WHERE v.team = $1 AND cc.login = $2 AND v.repository = $3
  GROUP BY v.week_start, v.team, v.project, v.repository,
    v.human_story_points, v.ai_story_points, v.total_story_points,
    v.issue_count, v.total_loc_changed, v.total_lines_added,
    v.total_lines_deleted, v.commit_count
  ORDER BY v.week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with date range AND team member filter.
 * Parameters:
 *   $1 - start_date (DATE) - beginning of date range
 *   $2 - end_date (DATE) - end of date range
 *   $3 - teamMember (TEXT) - contributor login to filter by
 *
 * Ticket: GITX-121
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_MEMBER = `
  SELECT
    v.week_start,
    v.team,
    v.project,
    v.repository,
    v.human_story_points,
    v.ai_story_points,
    v.total_story_points,
    v.issue_count,
    v.total_loc_changed,
    v.total_lines_added,
    v.total_lines_deleted,
    v.commit_count
  FROM vw_sprint_velocity_vs_loc v
  INNER JOIN commit_history ch ON v.repository = ch.repo
    AND DATE_TRUNC('week', ch.commit_date)::DATE = v.week_start
  INNER JOIN commit_contributors cc ON ch.author = cc.login
  WHERE v.week_start >= $1 AND v.week_start <= $2 AND cc.login = $3
  GROUP BY v.week_start, v.team, v.project, v.repository,
    v.human_story_points, v.ai_story_points, v.total_story_points,
    v.issue_count, v.total_loc_changed, v.total_lines_added,
    v.total_lines_deleted, v.commit_count
  ORDER BY v.week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with date range, team, AND team member filter.
 * Parameters:
 *   $1 - start_date (DATE) - beginning of date range
 *   $2 - end_date (DATE) - end of date range
 *   $3 - team (TEXT) - team name to filter by
 *   $4 - teamMember (TEXT) - contributor login to filter by
 *
 * Ticket: GITX-121
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_MEMBER_COMBINED = `
  SELECT
    v.week_start,
    v.team,
    v.project,
    v.repository,
    v.human_story_points,
    v.ai_story_points,
    v.total_story_points,
    v.issue_count,
    v.total_loc_changed,
    v.total_lines_added,
    v.total_lines_deleted,
    v.commit_count
  FROM vw_sprint_velocity_vs_loc v
  INNER JOIN commit_history ch ON v.repository = ch.repo
    AND DATE_TRUNC('week', ch.commit_date)::DATE = v.week_start
  INNER JOIN commit_contributors cc ON ch.author = cc.login
  WHERE v.week_start >= $1 AND v.week_start <= $2 AND v.team = $3 AND cc.login = $4
  GROUP BY v.week_start, v.team, v.project, v.repository,
    v.human_story_points, v.ai_story_points, v.total_story_points,
    v.issue_count, v.total_loc_changed, v.total_lines_added,
    v.total_lines_deleted, v.commit_count
  ORDER BY v.week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with date range, team member, AND repository filter.
 * Parameters:
 *   $1 - start_date (DATE) - beginning of date range
 *   $2 - end_date (DATE) - end of date range
 *   $3 - teamMember (TEXT) - contributor login to filter by
 *   $4 - repository (TEXT) - repository name to filter by
 *
 * Ticket: GITX-121
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_MEMBER_REPOSITORY = `
  SELECT
    v.week_start,
    v.team,
    v.project,
    v.repository,
    v.human_story_points,
    v.ai_story_points,
    v.total_story_points,
    v.issue_count,
    v.total_loc_changed,
    v.total_lines_added,
    v.total_lines_deleted,
    v.commit_count
  FROM vw_sprint_velocity_vs_loc v
  INNER JOIN commit_history ch ON v.repository = ch.repo
    AND DATE_TRUNC('week', ch.commit_date)::DATE = v.week_start
  INNER JOIN commit_contributors cc ON ch.author = cc.login
  WHERE v.week_start >= $1 AND v.week_start <= $2 AND cc.login = $3 AND v.repository = $4
  GROUP BY v.week_start, v.team, v.project, v.repository,
    v.human_story_points, v.ai_story_points, v.total_story_points,
    v.issue_count, v.total_loc_changed, v.total_lines_added,
    v.total_lines_deleted, v.commit_count
  ORDER BY v.week_start ASC
  LIMIT 200
`;

/**
 * Query to fetch sprint velocity vs LOC data with date range, team, team member, AND repository filter.
 * Parameters:
 *   $1 - start_date (DATE) - beginning of date range
 *   $2 - end_date (DATE) - end of date range
 *   $3 - team (TEXT) - team name to filter by
 *   $4 - teamMember (TEXT) - contributor login to filter by
 *   $5 - repository (TEXT) - repository name to filter by
 *
 * Ticket: GITX-121
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_ALL_FILTERS = `
  SELECT
    v.week_start,
    v.team,
    v.project,
    v.repository,
    v.human_story_points,
    v.ai_story_points,
    v.total_story_points,
    v.issue_count,
    v.total_loc_changed,
    v.total_lines_added,
    v.total_lines_deleted,
    v.commit_count
  FROM vw_sprint_velocity_vs_loc v
  INNER JOIN commit_history ch ON v.repository = ch.repo
    AND DATE_TRUNC('week', ch.commit_date)::DATE = v.week_start
  INNER JOIN commit_contributors cc ON ch.author = cc.login
  WHERE v.week_start >= $1 AND v.week_start <= $2
    AND v.team = $3 AND cc.login = $4 AND v.repository = $5
  GROUP BY v.week_start, v.team, v.project, v.repository,
    v.human_story_points, v.ai_story_points, v.total_story_points,
    v.issue_count, v.total_loc_changed, v.total_lines_added,
    v.total_lines_deleted, v.commit_count
  ORDER BY v.week_start ASC
  LIMIT 200
`;
