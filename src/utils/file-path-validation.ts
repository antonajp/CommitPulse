/**
 * File path validation utilities for the Gitr extension.
 *
 * Provides security-focused validation for file path inputs to prevent:
 * - Path traversal attacks (CWE-22)
 * - Null byte injection
 * - Excessively long paths
 * - Invalid characters
 *
 * Ticket: GITX-128
 */

/**
 * Maximum allowed length for a single file path.
 */
export const MAX_FILE_PATH_LENGTH = 1024;

/**
 * Maximum number of files allowed in a single query.
 */
export const MAX_FILE_COUNT = 100;

/**
 * Characters that are not allowed in file paths.
 * Includes null byte and common shell metacharacters.
 */
const FORBIDDEN_CHARS_REGEX = /[\x00-\x1f\x7f<>:"|?*]/;

/**
 * Path traversal patterns to detect and reject.
 * Matches sequences like '../', '..\\', or paths starting with '/' or '\'.
 */
const PATH_TRAVERSAL_REGEX = /(?:^|[/\\])\.\.(?:[/\\]|$)|^[/\\]/;

/**
 * Result of validating a file path.
 */
export interface FilePathValidationResult {
  /** Whether the path is valid */
  readonly valid: boolean;
  /** Error message if invalid */
  readonly error?: string;
  /** Normalized path (forward slashes, trimmed) */
  readonly normalizedPath?: string;
}

/**
 * Result of validating a list of file paths.
 */
export interface FilePathsValidationResult {
  /** Whether all paths are valid */
  readonly valid: boolean;
  /** List of validated and normalized paths */
  readonly paths: readonly string[];
  /** List of errors for invalid paths */
  readonly errors: readonly string[];
}

/**
 * Validate a single file path for use in database queries.
 *
 * Security checks (CWE-22, CWE-20):
 * - Length limit enforcement
 * - Null byte rejection
 * - Path traversal pattern detection
 * - Forbidden character rejection
 * - Empty path rejection
 *
 * @param filePath - The file path to validate
 * @returns Validation result with normalized path or error
 */
export function validateFilePath(filePath: string): FilePathValidationResult {
  // Check for empty or whitespace-only paths
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'File path cannot be empty' };
  }

  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'File path cannot be empty' };
  }

  // Length check
  if (trimmed.length > MAX_FILE_PATH_LENGTH) {
    return {
      valid: false,
      error: `File path exceeds maximum length of ${MAX_FILE_PATH_LENGTH} characters`,
    };
  }

  // Null byte check (CWE-20)
  if (trimmed.includes('\0')) {
    return { valid: false, error: 'File path contains null byte' };
  }

  // Forbidden characters check
  if (FORBIDDEN_CHARS_REGEX.test(trimmed)) {
    return { valid: false, error: 'File path contains forbidden characters' };
  }

  // Normalize path separators to forward slash
  const normalized = trimmed.replace(/\\/g, '/');

  // Path traversal check (CWE-22)
  if (PATH_TRAVERSAL_REGEX.test(normalized)) {
    return { valid: false, error: 'Path traversal patterns not allowed' };
  }

  // Remove leading/trailing slashes and collapse multiple slashes
  const cleaned = normalized
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/');

  if (cleaned.length === 0) {
    return { valid: false, error: 'File path resolves to empty after normalization' };
  }

  return { valid: true, normalizedPath: cleaned };
}

/**
 * Validate a list of file paths.
 *
 * @param filePaths - Array of file paths to validate
 * @returns Validation result with normalized paths and any errors
 */
export function validateFilePaths(filePaths: readonly string[]): FilePathsValidationResult {
  if (!Array.isArray(filePaths)) {
    return {
      valid: false,
      paths: [],
      errors: ['Input must be an array of file paths'],
    };
  }

  // Check file count limit
  if (filePaths.length > MAX_FILE_COUNT) {
    return {
      valid: false,
      paths: [],
      errors: [`Too many files: ${filePaths.length} exceeds maximum of ${MAX_FILE_COUNT}`],
    };
  }

  if (filePaths.length === 0) {
    return {
      valid: false,
      paths: [],
      errors: ['At least one file path is required'],
    };
  }

  const validPaths: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < filePaths.length; i++) {
    const result = validateFilePath(filePaths[i] ?? '');
    if (result.valid && result.normalizedPath) {
      // Check for duplicates
      if (!validPaths.includes(result.normalizedPath)) {
        validPaths.push(result.normalizedPath);
      }
    } else {
      errors.push(`Path ${i + 1}: ${result.error ?? 'Unknown error'}`);
    }
  }

  return {
    valid: errors.length === 0,
    paths: validPaths,
    errors,
  };
}

/**
 * Parse a multi-line or comma-separated file path input.
 * Supports both newline and comma as delimiters.
 *
 * @param input - Raw input string from user
 * @returns Array of individual file paths (not yet validated)
 */
export function parseFilePathInput(input: string): string[] {
  if (!input || typeof input !== 'string') {
    return [];
  }

  // Split by newlines first, then by commas
  // This allows users to paste multi-line input or comma-separated lists
  return input
    .split(/[\n,]/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Check if a path contains glob patterns.
 * Glob patterns are allowed but should be handled by the caller.
 *
 * @param path - File path to check
 * @returns true if path contains glob wildcards
 */
export function containsGlobPattern(path: string): boolean {
  // Common glob wildcards: *, **, ?, [...]
  return /[*?]|\[.+\]/.test(path);
}

/**
 * Sanitize a filename for display (truncate and escape).
 *
 * @param filename - File path to sanitize
 * @param maxLength - Maximum length for display
 * @returns Truncated and escaped filename
 */
export function sanitizeFilenameForDisplay(filename: string, maxLength = 50): string {
  if (!filename) {
    return '';
  }

  // Truncate from the beginning if too long
  if (filename.length > maxLength) {
    const parts = filename.split('/');
    if (parts.length > 2) {
      const first = parts[0] ?? '';
      const last = parts[parts.length - 1] ?? '';
      const truncated = `${first}/.../${last}`;
      if (truncated.length <= maxLength) {
        return truncated;
      }
    }
    return '...' + filename.slice(-(maxLength - 3));
  }

  return filename;
}
