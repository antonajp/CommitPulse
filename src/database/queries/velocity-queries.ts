/**
 * Parameterized SQL queries for the Sprint Velocity vs LOC chart.
 * All queries use $N placeholders -- zero string interpolation.
 *
 * Queries operate against the vw_sprint_velocity_vs_loc view created
 * by migration 008_sprint_velocity_loc_view.sql.
 *
 * Ticket: IQS-888
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
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC = `
  SELECT
    week_start,
    team,
    project,
    repository,
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
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE = `
  SELECT
    week_start,
    team,
    project,
    repository,
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
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_TEAM = `
  SELECT
    week_start,
    team,
    project,
    repository,
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
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM = `
  SELECT
    week_start,
    team,
    project,
    repository,
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
 * Ticket: IQS-920
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_REPOSITORY = `
  SELECT
    week_start,
    team,
    project,
    repository,
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
 * Ticket: IQS-920
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_REPOSITORY = `
  SELECT
    week_start,
    team,
    project,
    repository,
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
 * Ticket: IQS-920
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_TEAM_REPOSITORY = `
  SELECT
    week_start,
    team,
    project,
    repository,
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
 * Ticket: IQS-920
 */
export const QUERY_SPRINT_VELOCITY_VS_LOC_DATE_RANGE_TEAM_REPOSITORY = `
  SELECT
    week_start,
    team,
    project,
    repository,
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
