/**
 * Repository name validation utilities for the Gitr extension.
 *
 * Provides validation for repository filter inputs to prevent
 * injection attacks and ensure data integrity.
 *
 * Ticket: IQS-920
 */

/**
 * Maximum length for a repository name.
 * GitHub allows up to 100 characters for repository names.
 */
export const MAX_REPOSITORY_NAME_LENGTH = 100;

/**
 * Regular expression for valid repository names.
 * Matches alphanumeric characters, dots, hyphens, and underscores.
 * Based on GitHub repository naming rules.
 */
const REPOSITORY_NAME_REGEX = /^[a-zA-Z0-9._-]{1,100}$/;

/**
 * Validate a repository name for use in database queries.
 *
 * Valid repository names:
 * - Are 1-100 characters long
 * - Contain only alphanumeric characters, dots, hyphens, and underscores
 * - Follow GitHub repository naming conventions
 *
 * @param repoName - A repository name to validate
 * @returns true if the repository name is valid
 *
 * @example
 * ```typescript
 * isValidRepositoryName('gitr');           // true
 * isValidRepositoryName('my-repo.ts');     // true
 * isValidRepositoryName('repo_name');      // true
 * isValidRepositoryName('');               // false
 * isValidRepositoryName('a'.repeat(101));  // false
 * isValidRepositoryName('repo/name');      // false (contains /)
 * isValidRepositoryName('<script>');       // false (contains < and >)
 * ```
 */
export function isValidRepositoryName(repoName: string): boolean {
  // Null/undefined check
  if (repoName === null || repoName === undefined) {
    return false;
  }

  // Type check - must be a string
  if (typeof repoName !== 'string') {
    return false;
  }

  // Empty string check
  if (repoName.length === 0) {
    return false;
  }

  // Length check
  if (repoName.length > MAX_REPOSITORY_NAME_LENGTH) {
    return false;
  }

  // Character validation using regex
  return REPOSITORY_NAME_REGEX.test(repoName);
}
