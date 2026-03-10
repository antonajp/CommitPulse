/**
 * URL builder utilities for constructing clickable issue links in webviews.
 *
 * Provides centralized URL construction for Jira and Linear issues with:
 * - URL prefix validation (http/https schemes only)
 * - Issue key validation (prevents XSS/injection)
 * - URL encoding of all dynamic components
 * - Fallback to legacy patterns when settings not configured
 * - User notification when URL prefix not configured
 *
 * Security references:
 * - CWE-601: URL Redirection to Untrusted Site (Open Redirect)
 * - CWE-79: Cross-Site Scripting (XSS)
 * - CWE-116: Improper Encoding or Escaping of Output
 *
 * Ticket: IQS-926
 */

import { LoggerService } from '../logging/logger.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'UrlBuilder';

/**
 * Issue key validation pattern.
 * Matches standard issue tracker formats: PROJECT-123
 * - 1-20 uppercase letters for project/team key (expanded for long team names)
 * - Hyphen separator
 * - 1-10 digits for issue number
 */
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]{0,19}-\d{1,10}$/;

/**
 * Allowed URL schemes for issue navigation.
 * Only http and https are permitted to prevent javascript:, data: attacks.
 */
const ALLOWED_SCHEMES = ['http:', 'https:'];

/**
 * Result of URL building operation.
 */
export interface UrlBuildResult {
  /** Whether URL was successfully built */
  readonly success: boolean;
  /** The constructed URL (only set when success is true) */
  readonly url?: string;
  /** Reason for failure (only set when success is false) */
  readonly reason?: string;
  /** Whether the URL prefix setting is not configured */
  readonly notConfigured?: boolean;
}

/**
 * Validate that an issue key matches the expected format.
 *
 * Security: Prevents XSS by rejecting keys with special characters.
 *
 * @param issueKey - The issue key to validate (e.g., IQS-926, PROJ-123)
 * @returns true if the key matches the safe pattern
 */
export function isSafeIssueKey(issueKey: string): boolean {
  if (!issueKey || typeof issueKey !== 'string') {
    return false;
  }
  return ISSUE_KEY_PATTERN.test(issueKey);
}

/**
 * Validate a URL prefix setting.
 *
 * Checks:
 * - URL can be parsed
 * - Scheme is http or https (not javascript:, data:, etc.)
 * - URL has a valid hostname
 *
 * @param urlPrefix - The URL prefix to validate
 * @returns true if the URL prefix is valid
 */
export function isValidUrlPrefix(urlPrefix: string): boolean {
  if (!urlPrefix || typeof urlPrefix !== 'string' || urlPrefix.trim().length === 0) {
    return false;
  }

  try {
    const parsed = new URL(urlPrefix.trim());

    // Check scheme
    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
      return false;
    }

    // Check hostname exists
    if (!parsed.hostname) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Build a Jira issue URL using configured URL prefix.
 *
 * URL Format: {urlPrefix}/browse/{ISSUE-KEY}
 *
 * Falls back to jiraServer/browse/{key} when urlPrefix is empty.
 *
 * @param urlPrefix - The configured gitrx.jira.urlPrefix
 * @param jiraServer - The configured gitrx.jira.server (fallback)
 * @param issueKey - The Jira issue key (e.g., PROJ-123)
 * @returns Result with URL or failure reason
 */
export function buildJiraIssueUrl(
  urlPrefix: string,
  jiraServer: string,
  issueKey: string,
): UrlBuildResult {
  const logger = LoggerService.getInstance();
  logger.trace(CLASS_NAME, 'buildJiraIssueUrl', `Building URL for: ${issueKey}`);

  // Validate issue key first
  if (!isSafeIssueKey(issueKey)) {
    logger.debug(CLASS_NAME, 'buildJiraIssueUrl', `Invalid issue key: ${issueKey}`);
    return { success: false, reason: 'Invalid issue key format' };
  }

  // Determine base URL (prefer urlPrefix, fall back to server)
  const baseUrl = urlPrefix.trim() || jiraServer.trim();

  if (!baseUrl) {
    logger.debug(CLASS_NAME, 'buildJiraIssueUrl', 'No Jira URL prefix or server configured');
    return {
      success: false,
      reason: 'Jira URL not configured',
      notConfigured: true,
    };
  }

  // Validate the base URL
  if (!isValidUrlPrefix(baseUrl)) {
    logger.warn(CLASS_NAME, 'buildJiraIssueUrl', `Invalid base URL: ${baseUrl}`);
    return { success: false, reason: 'Invalid URL prefix' };
  }

  // Strip trailing slashes from base URL
  const normalizedBase = baseUrl.replace(/\/+$/, '');

  // URL-encode the issue key (defense in depth)
  const encodedKey = encodeURIComponent(issueKey);

  // Construct URL
  const url = `${normalizedBase}/browse/${encodedKey}`;

  logger.debug(CLASS_NAME, 'buildJiraIssueUrl', `Built URL: ${url}`);
  return { success: true, url };
}

/**
 * Build a Linear issue URL using configured URL prefix.
 *
 * URL Format: {urlPrefix}/issue/{ISSUE-KEY}
 *
 * Falls back to https://linear.app/{team}/issue/{key} when urlPrefix is empty,
 * extracting the team key from the issue ID (e.g., IQS from IQS-123).
 *
 * @param urlPrefix - The configured gitrx.linear.urlPrefix
 * @param issueKey - The Linear issue key (e.g., IQS-123)
 * @returns Result with URL or failure reason
 */
export function buildLinearIssueUrl(
  urlPrefix: string,
  issueKey: string,
): UrlBuildResult {
  const logger = LoggerService.getInstance();
  logger.trace(CLASS_NAME, 'buildLinearIssueUrl', `Building URL for: ${issueKey}`);

  // Validate issue key first
  if (!isSafeIssueKey(issueKey)) {
    logger.debug(CLASS_NAME, 'buildLinearIssueUrl', `Invalid issue key: ${issueKey}`);
    return { success: false, reason: 'Invalid issue key format' };
  }

  // URL-encode the issue key (defense in depth)
  const encodedKey = encodeURIComponent(issueKey);

  // If URL prefix is configured, use it
  if (urlPrefix && urlPrefix.trim()) {
    if (!isValidUrlPrefix(urlPrefix)) {
      logger.warn(CLASS_NAME, 'buildLinearIssueUrl', `Invalid URL prefix: ${urlPrefix}`);
      return { success: false, reason: 'Invalid URL prefix' };
    }

    const normalizedBase = urlPrefix.trim().replace(/\/+$/, '');
    const url = `${normalizedBase}/issue/${encodedKey}`;

    logger.debug(CLASS_NAME, 'buildLinearIssueUrl', `Built URL with prefix: ${url}`);
    return { success: true, url };
  }

  // Fall back to default Linear URL pattern
  // Extract team key from issue ID (e.g., IQS from IQS-123)
  const match = issueKey.match(/^([A-Z][A-Z0-9]{0,19})-\d+$/);
  if (!match || !match[1]) {
    logger.debug(CLASS_NAME, 'buildLinearIssueUrl', `Could not extract team key from: ${issueKey}`);
    return { success: false, reason: 'Could not extract team key' };
  }

  const teamKey = match[1].toLowerCase();
  const url = `https://linear.app/${teamKey}/issue/${encodedKey}`;

  logger.debug(CLASS_NAME, 'buildLinearIssueUrl', `Built URL with default pattern: ${url}`);
  return { success: true, url };
}

/**
 * Build an issue URL based on tracker type.
 *
 * Dispatches to the appropriate URL builder based on the ticket type.
 *
 * @param ticketType - The tracker type ('jira', 'linear', or 'Jira', 'Linear')
 * @param issueKey - The issue key
 * @param jiraUrlPrefix - The configured gitrx.jira.urlPrefix
 * @param jiraServer - The configured gitrx.jira.server (fallback for Jira)
 * @param linearUrlPrefix - The configured gitrx.linear.urlPrefix
 * @returns Result with URL or failure reason
 */
export function buildIssueUrl(
  ticketType: string,
  issueKey: string,
  jiraUrlPrefix: string,
  jiraServer: string,
  linearUrlPrefix: string,
): UrlBuildResult {
  const logger = LoggerService.getInstance();
  const normalizedType = ticketType?.toLowerCase() ?? '';

  if (normalizedType === 'jira') {
    return buildJiraIssueUrl(jiraUrlPrefix, jiraServer, issueKey);
  }

  if (normalizedType === 'linear') {
    return buildLinearIssueUrl(linearUrlPrefix, issueKey);
  }

  logger.debug(CLASS_NAME, 'buildIssueUrl', `Unknown ticket type: ${ticketType}`);
  return { success: false, reason: `Unknown tracker type: ${ticketType}` };
}
