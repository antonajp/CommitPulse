/**
 * URL sanitization utility for secure logging.
 *
 * Provides URL sanitization to prevent credential exposure in logs:
 * - Redacts embedded credentials from HTTPS URLs (user:pass@host)
 * - Redacts embedded tokens from HTTPS URLs (token@host)
 * - Handles Git SSH shorthand format (git@host:path)
 * - Handles SSH protocol URLs (ssh://user@host/path)
 * - Handles Git protocol URLs (git://host/path)
 *
 * Security references:
 * - CWE-200: Exposure of Sensitive Information
 * - CWE-532: Insertion of Sensitive Information into Log File
 *
 * Ticket: IQS-936
 */

import { LoggerService } from '../logging/logger.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'UrlSanitizer';

/**
 * Regex pattern to match HTTPS/HTTP URLs with embedded credentials.
 * Captures: protocol, credentials, host, and rest of URL.
 *
 * Examples matched:
 * - https://user:pass@github.com/repo.git
 * - https://token:x-oauth-basic@github.com/repo.git
 * - http://user@internal.git.local/repo
 */
const HTTPS_CREDENTIALS_REGEX = /^(https?:\/\/)([^@]+)@(.+)$/i;

/**
 * Regex pattern to match SSH shorthand format (git@host:path).
 * This format doesn't have embedded credentials but may expose usernames.
 *
 * Examples matched:
 * - git@github.com:user/repo.git
 * - deploy@gitlab.company.com:group/project.git
 */
const SSH_SHORTHAND_REGEX = /^([a-zA-Z0-9._-]+)@([a-zA-Z0-9._-]+):(.+)$/;

/**
 * Regex pattern to match SSH protocol URLs with optional user.
 *
 * Examples matched:
 * - ssh://git@github.com/user/repo.git
 * - ssh://deploy@gitlab.company.com:2222/project.git
 */
const SSH_PROTOCOL_REGEX = /^(ssh:\/\/)([^@]+)@(.+)$/i;

/**
 * Sanitize a URL for safe logging by redacting embedded credentials.
 *
 * Transforms URLs containing credentials into safe forms:
 * - `https://user:token@github.com/repo` → `https://***:***@github.com/repo`
 * - `https://token@github.com/repo` → `https://***@github.com/repo`
 * - `git@github.com:user/repo` → (unchanged, no credentials embedded)
 * - `ssh://git@github.com/repo` → (unchanged, username only)
 *
 * @param url - The URL to sanitize (may contain embedded credentials)
 * @returns The sanitized URL safe for logging
 */
export function sanitizeUrlForLogging(url: string): string {
  const logger = LoggerService.getInstance();

  if (!url || typeof url !== 'string') {
    return '';
  }

  const trimmed = url.trim();

  // Handle HTTPS/HTTP URLs with embedded credentials
  const httpsMatch = trimmed.match(HTTPS_CREDENTIALS_REGEX);
  if (httpsMatch) {
    const [, protocol, credentials, hostAndPath] = httpsMatch;
    if (protocol && hostAndPath) {
      // Check if credentials contain both user and password (user:pass)
      const hasPassword = credentials?.includes(':') ?? false;
      const sanitized = hasPassword
        ? `${protocol}***:***@${hostAndPath}`
        : `${protocol}***@${hostAndPath}`;

      logger.trace(CLASS_NAME, 'sanitizeUrlForLogging', 'HTTPS credentials redacted');
      return sanitized;
    }
  }

  // Handle SSH protocol URLs - these typically don't have secrets but log them as-is
  // The username in SSH URLs (e.g., git@) is not a secret
  if (SSH_PROTOCOL_REGEX.test(trimmed)) {
    logger.trace(CLASS_NAME, 'sanitizeUrlForLogging', 'SSH protocol URL (no secrets to redact)');
    return trimmed;
  }

  // Handle SSH shorthand format - typically safe (git@host:path)
  if (SSH_SHORTHAND_REGEX.test(trimmed)) {
    logger.trace(CLASS_NAME, 'sanitizeUrlForLogging', 'SSH shorthand format (no secrets to redact)');
    return trimmed;
  }

  // Handle Git protocol URLs (git://host/path) - no credentials
  if (trimmed.toLowerCase().startsWith('git://')) {
    logger.trace(CLASS_NAME, 'sanitizeUrlForLogging', 'Git protocol URL (no secrets to redact)');
    return trimmed;
  }

  // For other URLs, return as-is (they don't match credential patterns)
  logger.trace(CLASS_NAME, 'sanitizeUrlForLogging', 'URL has no detected credentials');
  return trimmed;
}

/**
 * Check if a URL contains embedded credentials that should be sanitized.
 *
 * Useful for conditional logging - skip debug logging if URL would expose secrets.
 *
 * @param url - The URL to check
 * @returns true if the URL contains embedded credentials
 */
export function hasEmbeddedCredentials(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const trimmed = url.trim();
  return HTTPS_CREDENTIALS_REGEX.test(trimmed);
}
