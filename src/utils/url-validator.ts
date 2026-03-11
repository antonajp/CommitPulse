/**
 * URL validation utility for security hardening of external links.
 *
 * Provides centralized URL validation to prevent:
 * - XSS attacks via javascript: or data: URLs
 * - Phishing via untrusted domains
 * - URL injection via malformed URLs
 * - Credential leakage via embedded user info
 *
 * Only allowlisted domains are permitted:
 * - GitHub (github.com and *.github.com for enterprise)
 * - Bitbucket (bitbucket.org and *.bitbucket.org for enterprise)
 * - GitLab (gitlab.com and *.gitlab.com for self-hosted)
 * - Linear (linear.app)
 * - Configured Jira server
 *
 * Security references:
 * - CWE-601: URL Redirection to Untrusted Site
 * - CWE-79: Cross-Site Scripting (XSS)
 * - OWASP A01:2021: Broken Access Control
 *
 * Ticket: IQS-924
 */

import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import { sanitizeUrlForLogging } from './url-sanitizer.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'UrlValidator';

/**
 * Result of URL validation with detailed reason for failures.
 */
export interface UrlValidationResult {
  /** Whether the URL passed validation */
  readonly isValid: boolean;
  /** Human-readable reason for rejection (only set when isValid is false) */
  readonly reason?: string;
  /** Validated URI (only set when isValid is true) */
  readonly validatedUri?: vscode.Uri;
}

/**
 * Allowed URL schemes for external navigation.
 * Only http and https are permitted to prevent javascript:, data:, file: attacks.
 */
const ALLOWED_SCHEMES = new Set(['http', 'https']);

/**
 * Allowed protocols for repository URLs.
 * Supports http, https, git, and ssh for clone URLs.
 */
const ALLOWED_REPO_PROTOCOLS = new Set(['http', 'https', 'git', 'ssh']);

/**
 * Ticket ID validation pattern.
 * Matches standard issue tracker formats: PROJECT-123
 * - 1-10 uppercase letters for project key
 * - Hyphen separator
 * - 1 or more digits for issue number
 */
const TICKET_ID_PATTERN = /^[A-Z][A-Z0-9]{0,9}-\d+$/;

/**
 * Characters that are NOT valid in a ticket ID.
 * Used for sanitization.
 */
const INVALID_TICKET_CHARS = /[^A-Z0-9-]/gi;

/**
 * Validate an external URL for safe navigation.
 *
 * Checks:
 * 1. URL can be parsed without errors
 * 2. Scheme is http or https (not javascript:, data:, file:)
 * 3. No embedded credentials (user:pass@host)
 * 4. Domain is in allowlist (GitHub, Linear, or configured Jira server)
 *
 * @param url - The URL string to validate
 * @param jiraServer - The configured Jira server URL (from settings)
 * @returns Validation result with reason for failure
 */
export function validateExternalUrl(url: string, jiraServer: string): UrlValidationResult {
  const logger = LoggerService.getInstance();
  logger.trace(CLASS_NAME, 'validateExternalUrl', `Validating URL: ${url}`);

  // Guard: empty or whitespace URL
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    logger.debug(CLASS_NAME, 'validateExternalUrl', 'Empty or invalid URL provided');
    return { isValid: false, reason: 'Empty URL' };
  }

  try {
    // Parse URL using VS Code's strict URI parser
    const parsed = vscode.Uri.parse(url, true);

    // Check scheme
    const scheme = parsed.scheme.toLowerCase();
    if (!ALLOWED_SCHEMES.has(scheme)) {
      logger.debug(CLASS_NAME, 'validateExternalUrl', `Invalid scheme: ${scheme}`);
      return { isValid: false, reason: `Invalid scheme: ${scheme}` };
    }

    // Check for embedded credentials (security: CWE-200)
    // VS Code Uri doesn't expose userinfo, so check the raw URL
    const urlLower = url.toLowerCase();
    const schemeEnd = urlLower.indexOf('://');
    if (schemeEnd !== -1) {
      const afterScheme = url.substring(schemeEnd + 3);
      const atIndex = afterScheme.indexOf('@');
      const slashIndex = afterScheme.indexOf('/');
      // If @ appears before the first slash (or no slash), it's embedded credentials
      if (atIndex !== -1 && (slashIndex === -1 || atIndex < slashIndex)) {
        logger.warn(CLASS_NAME, 'validateExternalUrl', 'URL contains embedded credentials');
        return { isValid: false, reason: 'URL contains embedded credentials' };
      }
    }

    // Check authority (domain)
    const authority = parsed.authority.toLowerCase();
    if (!authority) {
      logger.debug(CLASS_NAME, 'validateExternalUrl', 'Missing domain');
      return { isValid: false, reason: 'Missing domain' };
    }

    // Strip port from authority for domain matching
    const domain = authority.includes(':') ? (authority.split(':')[0] ?? authority) : authority;

    // Check allowlist: GitHub
    if (domain === 'github.com' || domain.endsWith('.github.com')) {
      logger.trace(CLASS_NAME, 'validateExternalUrl', 'Domain allowed: GitHub');
      return { isValid: true, validatedUri: parsed };
    }

    // Check allowlist: Bitbucket
    if (domain === 'bitbucket.org' || domain.endsWith('.bitbucket.org')) {
      logger.trace(CLASS_NAME, 'validateExternalUrl', 'Domain allowed: Bitbucket');
      return { isValid: true, validatedUri: parsed };
    }

    // Check allowlist: GitLab
    if (domain === 'gitlab.com' || domain.endsWith('.gitlab.com')) {
      logger.trace(CLASS_NAME, 'validateExternalUrl', 'Domain allowed: GitLab');
      return { isValid: true, validatedUri: parsed };
    }

    // Check allowlist: Linear
    if (domain === 'linear.app') {
      logger.trace(CLASS_NAME, 'validateExternalUrl', 'Domain allowed: Linear');
      return { isValid: true, validatedUri: parsed };
    }

    // Check allowlist: Configured Jira server
    if (jiraServer && jiraServer.trim().length > 0) {
      try {
        const jiraUri = vscode.Uri.parse(jiraServer, true);
        const jiraDomain = jiraUri.authority.toLowerCase();
        // Strip port from Jira domain too
        const jiraDomainClean = jiraDomain.includes(':') ? jiraDomain.split(':')[0] : jiraDomain;
        if (domain === jiraDomainClean) {
          logger.trace(CLASS_NAME, 'validateExternalUrl', 'Domain allowed: configured Jira server');
          return { isValid: true, validatedUri: parsed };
        }
      } catch {
        logger.warn(CLASS_NAME, 'validateExternalUrl', 'Failed to parse configured Jira server URL');
      }
    }

    // Domain not in allowlist
    logger.debug(CLASS_NAME, 'validateExternalUrl', `Untrusted domain: ${domain}`);
    return { isValid: false, reason: `Untrusted domain: ${domain}` };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.debug(CLASS_NAME, 'validateExternalUrl', `URL parse error: ${msg}`);
    return { isValid: false, reason: 'URL parse error' };
  }
}

/**
 * Validate a ticket ID format.
 *
 * Ensures the ticket ID matches the expected pattern for issue trackers:
 * - Starts with 1-10 uppercase letters (project key)
 * - Followed by a hyphen
 * - Ends with one or more digits (issue number)
 *
 * Examples of valid IDs: IQS-924, JIRA-1, PROJECT123-99999
 *
 * @param ticketId - The ticket ID to validate
 * @returns true if the ticket ID matches the expected format
 */
export function isValidTicketId(ticketId: string): boolean {
  if (!ticketId || typeof ticketId !== 'string') {
    return false;
  }
  return TICKET_ID_PATTERN.test(ticketId);
}

/**
 * Sanitize a ticket ID by removing invalid characters.
 *
 * Strips any characters that are not uppercase letters, digits, or hyphens.
 * Converts lowercase letters to uppercase.
 *
 * Note: The result may not be a valid ticket ID (e.g., if the input was
 * completely malformed). Use isValidTicketId() to verify after sanitization.
 *
 * @param ticketId - The ticket ID to sanitize
 * @returns Sanitized string with only valid ticket ID characters
 */
export function sanitizeTicketId(ticketId: string): string {
  if (!ticketId || typeof ticketId !== 'string') {
    return '';
  }
  return ticketId.toUpperCase().replace(INVALID_TICKET_CHARS, '');
}

/**
 * Validate a repository remote URL.
 *
 * Checks that the URL uses an allowed protocol:
 * - http/https: Standard web URLs
 * - git: Git protocol (git://github.com/...)
 * - ssh: SSH URLs (ssh://git@github.com/... or git@github.com:...)
 *
 * Rejects:
 * - javascript: URLs
 * - data: URLs
 * - file: URLs (local file access)
 * - Malformed URLs
 *
 * @param repoUrl - The repository URL to validate
 * @returns Validation result with reason for failure
 */
export function validateRepositoryUrl(repoUrl: string): UrlValidationResult {
  const logger = LoggerService.getInstance();
  // IQS-936: Sanitize URL before logging to prevent credential exposure
  const sanitizedUrl = sanitizeUrlForLogging(repoUrl);
  logger.trace(CLASS_NAME, 'validateRepositoryUrl', `Validating repo URL: ${sanitizedUrl}`);

  if (!repoUrl || typeof repoUrl !== 'string' || repoUrl.trim().length === 0) {
    logger.debug(CLASS_NAME, 'validateRepositoryUrl', 'Empty or invalid URL provided');
    return { isValid: false, reason: 'Empty URL' };
  }

  const trimmed = repoUrl.trim();

  // Handle SSH shorthand format: git@github.com:user/repo.git
  // This doesn't have a :// so can't be parsed as a URL
  if (trimmed.match(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:[^/]/)) {
    logger.trace(CLASS_NAME, 'validateRepositoryUrl', 'SSH shorthand format detected, allowed');
    return { isValid: true };
  }

  // Extract scheme from URL
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!schemeMatch) {
    // No scheme - could be a relative path or malformed
    logger.debug(CLASS_NAME, 'validateRepositoryUrl', 'No scheme in URL');
    return { isValid: false, reason: 'No scheme in URL' };
  }

  const scheme = (schemeMatch[1] ?? '').toLowerCase();
  if (!ALLOWED_REPO_PROTOCOLS.has(scheme)) {
    logger.warn(CLASS_NAME, 'validateRepositoryUrl', `Invalid protocol: ${scheme}`);
    return { isValid: false, reason: `Invalid protocol: ${scheme}` };
  }

  logger.trace(CLASS_NAME, 'validateRepositoryUrl', `Valid repo URL with protocol: ${scheme}`);
  return { isValid: true };
}

/**
 * Build a safe Jira ticket URL.
 *
 * Constructs a URL to view a Jira ticket, with validation on both
 * the server URL and ticket ID to prevent injection attacks.
 *
 * @param jiraServer - The configured Jira server URL
 * @param ticketId - The ticket ID to link to
 * @returns The constructed URL, or null if validation fails
 */
export function buildJiraTicketUrl(jiraServer: string, ticketId: string): string | null {
  const logger = LoggerService.getInstance();

  if (!jiraServer || !ticketId) {
    logger.debug(CLASS_NAME, 'buildJiraTicketUrl', 'Missing server or ticket ID');
    return null;
  }

  // Validate ticket ID
  if (!isValidTicketId(ticketId)) {
    logger.debug(CLASS_NAME, 'buildJiraTicketUrl', `Invalid ticket ID: ${ticketId}`);
    return null;
  }

  // Sanitize (should be no-op for valid tickets, but defense in depth)
  const safeTicketId = sanitizeTicketId(ticketId);

  // Build URL - strip trailing slash from server
  const serverBase = jiraServer.replace(/\/+$/, '');
  const url = `${serverBase}/browse/${safeTicketId}`;

  // Validate the constructed URL
  const validation = validateExternalUrl(url, jiraServer);
  if (!validation.isValid) {
    logger.debug(CLASS_NAME, 'buildJiraTicketUrl', `Constructed URL failed validation: ${validation.reason}`);
    return null;
  }

  return url;
}

/**
 * Build a safe Linear ticket URL.
 *
 * Constructs a URL to view a Linear issue, with validation on the
 * ticket ID to prevent injection attacks.
 *
 * @param ticketId - The Linear ticket ID (e.g., IQS-924)
 * @returns The constructed URL, or null if validation fails
 */
export function buildLinearTicketUrl(ticketId: string): string | null {
  const logger = LoggerService.getInstance();

  if (!ticketId) {
    logger.debug(CLASS_NAME, 'buildLinearTicketUrl', 'Missing ticket ID');
    return null;
  }

  // Validate ticket ID
  if (!isValidTicketId(ticketId)) {
    logger.debug(CLASS_NAME, 'buildLinearTicketUrl', `Invalid ticket ID: ${ticketId}`);
    return null;
  }

  // Extract team key from ticket ID (e.g., IQS from IQS-924)
  const match = ticketId.match(/^([A-Z][A-Z0-9]{0,9})-\d+$/);
  if (!match) {
    logger.debug(CLASS_NAME, 'buildLinearTicketUrl', `Could not extract team key from: ${ticketId}`);
    return null;
  }

  const teamKey = (match[1] ?? '').toLowerCase();
  const url = `https://linear.app/${teamKey}/issue/${ticketId}`;

  // Validate the constructed URL
  const validation = validateExternalUrl(url, '');
  if (!validation.isValid) {
    logger.debug(CLASS_NAME, 'buildLinearTicketUrl', `Constructed URL failed validation: ${validation.reason}`);
    return null;
  }

  return url;
}
