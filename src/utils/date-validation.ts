/**
 * Date validation utilities for the Gitr extension.
 *
 * Provides date string validation for chart data queries.
 * Extracted from architecture-data-service.ts in IQS-893.
 */

/**
 * Validate a date string for use in database queries.
 *
 * @param dateStr - A date string to validate
 * @returns true if the date is valid YYYY-MM-DD format within reasonable range
 */
export function isValidDateString(dateStr: string): boolean {
  // Format check: must be YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    return false;
  }

  // Parse check: must produce a valid Date
  const parsed = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(parsed.getTime())) {
    return false;
  }

  // Range check: 1970-01-01 to 1 year from now
  const minDate = new Date('1970-01-01T00:00:00Z');
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 1);

  if (parsed < minDate || parsed > maxDate) {
    return false;
  }

  // Verify the parsed date matches the input (catches invalid dates like 2024-02-30)
  const year = parsed.getUTCFullYear().toString().padStart(4, '0');
  const month = (parsed.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = parsed.getUTCDate().toString().padStart(2, '0');
  const reconstructed = `${year}-${month}-${day}`;

  return reconstructed === dateStr;
}
