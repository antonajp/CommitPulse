/**
 * Team name validation utilities for the Gitr extension.
 *
 * Provides team name string validation for chart data queries.
 *
 * Ticket: IQS-940
 */

/**
 * Validate a team name string for use in database queries.
 * Team names must be alphanumeric with spaces, hyphens, and underscores.
 *
 * @param teamName - A team name string to validate
 * @returns true if the team name is valid (1-100 chars, alphanumeric with spaces/hyphens/underscores)
 */
export function isValidTeamName(teamName: string): boolean {
  // Check length
  if (!teamName || teamName.length === 0 || teamName.length > 100) {
    return false;
  }

  // Check for valid characters: alphanumeric, spaces, hyphens, underscores, periods
  // This covers common team name patterns like "Platform Team", "Back-End", "QA_Leads"
  const teamRegex = /^[a-zA-Z0-9\s\-_.]+$/;
  return teamRegex.test(teamName);
}
