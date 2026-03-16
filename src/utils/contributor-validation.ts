/**
 * Contributor name validation utilities for the Gitr extension.
 *
 * Provides validation for contributor/team member filter inputs to prevent
 * injection attacks and ensure data integrity.
 *
 * Ticket: GITX-121
 */

/**
 * Maximum length for a contributor login/name.
 * GitHub allows up to 39 characters for usernames, but we allow
 * longer for full names and email-style identifiers.
 */
export const MAX_CONTRIBUTOR_NAME_LENGTH = 200;

/**
 * Regular expression for valid contributor names.
 * Matches alphanumeric characters, dots, hyphens, underscores, single spaces, and @.
 * Covers GitHub usernames, full names, and email addresses used as identifiers.
 * NOTE: Uses literal space character instead of \s to avoid matching tabs/newlines.
 */
const CONTRIBUTOR_NAME_REGEX = /^[a-zA-Z0-9._\- @]+$/;

/**
 * Validate a contributor name for use in database queries.
 *
 * Valid contributor names:
 * - Are 1-200 characters long
 * - Contain only alphanumeric characters, dots, hyphens, underscores, spaces, and @
 * - Cover usernames, full names, and email-style identifiers
 *
 * @param contributorName - A contributor login or name to validate
 * @returns true if the contributor name is valid
 *
 * @example
 * ```typescript
 * isValidContributorName('johndoe');                    // true
 * isValidContributorName('John Doe');                   // true
 * isValidContributorName('john.doe');                   // true
 * isValidContributorName('john_doe-123');               // true
 * isValidContributorName('john@example.com');           // true
 * isValidContributorName('');                           // false
 * isValidContributorName('a'.repeat(201));              // false
 * isValidContributorName('<script>');                   // false (contains < and >)
 * isValidContributorName('user; DROP TABLE users;--');  // false (contains ; and -)
 * ```
 */
export function isValidContributorName(contributorName: string): boolean {
  // Null/undefined check
  if (contributorName === null || contributorName === undefined) {
    return false;
  }

  // Type check - must be a string
  if (typeof contributorName !== 'string') {
    return false;
  }

  // Empty string check
  if (contributorName.length === 0) {
    return false;
  }

  // Length check
  if (contributorName.length > MAX_CONTRIBUTOR_NAME_LENGTH) {
    return false;
  }

  // Character validation using regex
  return CONTRIBUTOR_NAME_REGEX.test(contributorName);
}
