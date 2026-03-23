/**
 * Date validation utilities for git command parameters.
 *
 * Provides strict validation of date strings to prevent command injection
 * when dates are passed to git subprocess calls.
 *
 * Security: Dates passed to `git log --since` and `--until` must be strictly
 * validated to prevent argument injection attacks (CWE-88).
 *
 * Ticket: GITX-131
 */

/**
 * Result of date validation.
 */
export interface DateValidationResult {
  readonly isValid: boolean;
  readonly reason?: string;
}

/**
 * Validate a date string for use in git commands.
 *
 * Accepts:
 * - YYYY-MM-DD format (ISO date)
 * - Undefined/null (optional dates are valid)
 *
 * Rejects:
 * - Strings with spaces (could contain additional arguments)
 * - Strings starting with - (could be interpreted as flags)
 * - Strings with special shell characters
 * - Invalid date values (e.g., 2024-13-45)
 *
 * @param date - Date string to validate
 * @returns Validation result with reason if invalid
 *
 * Security: CWE-88 Argument Injection prevention
 */
export function validateDateParameter(date: string | undefined | null): DateValidationResult {
  // Undefined/null dates are valid (means no date filter)
  if (date === undefined || date === null) {
    return { isValid: true };
  }

  // Must be a string
  if (typeof date !== 'string') {
    return { isValid: false, reason: 'Date must be a string' };
  }

  // Empty string is valid (means no date filter)
  if (date.trim().length === 0) {
    return { isValid: true };
  }

  // SECURITY: Reject strings starting with - (could be git flags)
  if (date.startsWith('-')) {
    return { isValid: false, reason: 'Date cannot start with dash (potential argument injection)' };
  }

  // SECURITY: Reject strings with spaces (could contain multiple arguments)
  if (date.includes(' ')) {
    return { isValid: false, reason: 'Date cannot contain spaces' };
  }

  // SECURITY: Reject strings with shell metacharacters
  const dangerousChars = /[;&|`$(){}[\]\\<>'"!]/;
  if (dangerousChars.test(date)) {
    return { isValid: false, reason: 'Date contains invalid characters' };
  }

  // Strict YYYY-MM-DD format validation
  const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = date.match(datePattern);
  if (!match) {
    return { isValid: false, reason: 'Date must be in YYYY-MM-DD format' };
  }

  // Extract and validate date components
  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const day = parseInt(match[3]!, 10);

  // Validate year range (reasonable range for git repositories)
  if (year < 1970 || year > 2100) {
    return { isValid: false, reason: `Invalid year: ${year}. Must be between 1970 and 2100` };
  }

  // Validate month
  if (month < 1 || month > 12) {
    return { isValid: false, reason: `Invalid month: ${month}. Must be between 1 and 12` };
  }

  // Validate day based on month
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return { isValid: false, reason: `Invalid day: ${day}. Month ${month} has ${daysInMonth} days` };
  }

  return { isValid: true };
}

/**
 * Validate a date string and throw if invalid.
 *
 * @param date - Date string to validate
 * @param paramName - Parameter name for error message
 * @throws Error if date is invalid
 */
export function assertValidDate(date: string | undefined | null, paramName: string): void {
  const result = validateDateParameter(date);
  if (!result.isValid) {
    throw new Error(`Invalid ${paramName}: ${result.reason}`);
  }
}
