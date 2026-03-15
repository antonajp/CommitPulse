/**
 * Git provider detection and URL building utilities.
 *
 * Auto-detects the Git hosting provider (GitHub, Bitbucket, GitLab) from
 * repository URLs and generates provider-specific commit and PR URLs.
 *
 * URL patterns by provider:
 * - GitHub:    /commit/{sha}, /pull/{number}
 * - Bitbucket: /commits/{sha}, /pull-requests/{number}
 * - GitLab:    /-/commit/{sha}, /-/merge_requests/{number}
 *
 * Security considerations:
 * - SHA validation: Only hex characters, 7-40 characters length
 * - URL scheme validation: Only http/https accepted
 * - URL encoding: All dynamic components are URL-encoded
 *
 * Ticket: IQS-938
 */

import { LoggerService } from '../logging/logger.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'GitProviderDetector';

/**
 * Supported Git hosting providers.
 */
export type GitProvider = 'github' | 'bitbucket' | 'gitlab' | 'unknown';

/**
 * Result of provider detection with additional context.
 */
export interface ProviderDetectionResult {
  /** Detected provider type */
  readonly provider: GitProvider;
  /** Whether detection was based on domain pattern (true) or unknown (false) */
  readonly detected: boolean;
  /** Original URL that was analyzed */
  readonly repoUrl: string;
}

/**
 * Result of commit URL building.
 */
export interface CommitUrlResult {
  /** Built commit URL, or null if building failed */
  readonly url: string | null;
  /** Error message if URL building failed */
  readonly error?: string;
}

/**
 * Result of PR URL building.
 */
export interface PrUrlResult {
  /** Built PR URL, or null if building failed */
  readonly url: string | null;
  /** Error message if URL building failed */
  readonly error?: string;
}

/**
 * SHA validation pattern.
 * Matches hexadecimal strings between 7 and 40 characters (abbreviated or full SHA).
 */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * Domain patterns for provider detection.
 * Ordered by specificity - exact matches first, then pattern matches.
 */
const PROVIDER_DOMAINS: ReadonlyArray<{ pattern: RegExp; provider: GitProvider }> = [
  // Bitbucket Cloud and Server
  { pattern: /bitbucket\.org$/i, provider: 'bitbucket' },
  { pattern: /bitbucket\./i, provider: 'bitbucket' },
  // GitLab Cloud and self-hosted
  { pattern: /gitlab\.com$/i, provider: 'gitlab' },
  { pattern: /gitlab\./i, provider: 'gitlab' },
  // GitHub Cloud and Enterprise
  { pattern: /github\.com$/i, provider: 'github' },
  { pattern: /github\./i, provider: 'github' },
];

/**
 * Validate a commit SHA format.
 *
 * Checks that the SHA contains only hexadecimal characters and
 * is between 7 and 40 characters long (supporting abbreviated SHAs).
 *
 * @param sha - The SHA to validate
 * @returns true if the SHA format is valid
 */
export function isValidSha(sha: string): boolean {
  if (!sha || typeof sha !== 'string') {
    return false;
  }
  return SHA_PATTERN.test(sha);
}

/**
 * Detect the Git hosting provider from a repository URL.
 *
 * Analyzes the URL domain to determine the provider:
 * - github.com or github.* -> GitHub (including Enterprise)
 * - bitbucket.org or bitbucket.* -> Bitbucket (Cloud or Server)
 * - gitlab.com or gitlab.* -> GitLab (Cloud or self-hosted)
 *
 * Unknown domains default to 'unknown' (will use GitHub URL format).
 *
 * @param repoUrl - Repository URL (https, http, git, or ssh format)
 * @returns Provider detection result
 */
export function detectGitProvider(repoUrl: string): ProviderDetectionResult {
  const logger = LoggerService.getInstance();

  if (!repoUrl || typeof repoUrl !== 'string') {
    logger.debug(CLASS_NAME, 'detectGitProvider', 'Empty or invalid repoUrl provided');
    return { provider: 'unknown', detected: false, repoUrl: repoUrl || '' };
  }

  const trimmed = repoUrl.trim().toLowerCase();
  logger.trace(CLASS_NAME, 'detectGitProvider', `Detecting provider from: ${trimmed.substring(0, 50)}...`);

  // Extract domain from URL
  let domain: string;

  // Handle SSH shorthand format: git@github.com:user/repo.git
  const sshShorthandMatch = trimmed.match(/^[a-z0-9._-]+@([a-z0-9._-]+):/);
  if (sshShorthandMatch) {
    domain = sshShorthandMatch[1] ?? '';
    logger.trace(CLASS_NAME, 'detectGitProvider', `SSH shorthand detected, domain: ${domain}`);
  } else {
    // Handle SSH URL format with userinfo: ssh://git@github.com/user/repo.git
    const sshUrlMatch = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/[^@]+@([^/:]+)/);
    if (sshUrlMatch) {
      domain = sshUrlMatch[1] ?? '';
      logger.trace(CLASS_NAME, 'detectGitProvider', `SSH URL format detected, domain: ${domain}`);
    } else {
      // Handle standard URL format: https://github.com/user/repo
      const urlMatch = trimmed.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/:@]+)/);
      if (urlMatch) {
        domain = urlMatch[1] ?? '';
        logger.trace(CLASS_NAME, 'detectGitProvider', `URL format detected, domain: ${domain}`);
      } else {
        logger.debug(CLASS_NAME, 'detectGitProvider', 'Could not extract domain from URL');
        return { provider: 'unknown', detected: false, repoUrl };
      }
    }
  }

  // Strip port from domain if present
  const portIndex = domain.indexOf(':');
  if (portIndex > 0) {
    domain = domain.substring(0, portIndex);
  }

  // Match against known provider patterns
  for (const { pattern, provider } of PROVIDER_DOMAINS) {
    if (pattern.test(domain)) {
      logger.debug(CLASS_NAME, 'detectGitProvider', `Detected provider: ${provider} from domain: ${domain}`);
      return { provider, detected: true, repoUrl };
    }
  }

  logger.debug(CLASS_NAME, 'detectGitProvider', `Unknown provider for domain: ${domain}`);
  return { provider: 'unknown', detected: false, repoUrl };
}

/**
 * Get the commit URL path segment for a provider.
 *
 * @param provider - The Git provider
 * @returns The path segment for commit URLs (e.g., '/commit/', '/commits/', '/-/commit/')
 */
export function getCommitPathSegment(provider: GitProvider): string {
  switch (provider) {
    case 'bitbucket':
      return '/commits/';
    case 'gitlab':
      return '/-/commit/';
    case 'github':
    case 'unknown':
    default:
      return '/commit/';
  }
}

/**
 * Get the PR/MR URL path segment for a provider.
 *
 * @param provider - The Git provider
 * @returns The path segment for PR URLs (e.g., '/pull/', '/pull-requests/', '/-/merge_requests/')
 */
export function getPrPathSegment(provider: GitProvider): string {
  switch (provider) {
    case 'bitbucket':
      return '/pull-requests/';
    case 'gitlab':
      return '/-/merge_requests/';
    case 'github':
    case 'unknown':
    default:
      return '/pull/';
  }
}

/**
 * Build a commit URL for the detected provider.
 *
 * Constructs a provider-appropriate commit URL:
 * - GitHub: {baseUrl}/commit/{sha}
 * - Bitbucket: {baseUrl}/commits/{sha}
 * - GitLab: {baseUrl}/-/commit/{sha}
 *
 * Security: Validates SHA format before building URL.
 *
 * @param repoUrl - Repository base URL (e.g., https://github.com/user/repo)
 * @param sha - Commit SHA (7-40 hex characters)
 * @param provider - Optional pre-detected provider (will auto-detect if not provided)
 * @returns Commit URL result
 */
export function buildCommitUrl(
  repoUrl: string,
  sha: string,
  provider?: GitProvider,
): CommitUrlResult {
  const logger = LoggerService.getInstance();

  // Validate inputs
  if (!repoUrl || typeof repoUrl !== 'string' || repoUrl.trim().length === 0) {
    logger.debug(CLASS_NAME, 'buildCommitUrl', 'Empty or invalid repoUrl');
    return { url: null, error: 'Missing repository URL' };
  }

  if (!sha || typeof sha !== 'string') {
    logger.debug(CLASS_NAME, 'buildCommitUrl', 'Empty or invalid sha');
    return { url: null, error: 'Missing commit SHA' };
  }

  // Validate SHA format (security: prevent injection)
  if (!isValidSha(sha)) {
    logger.warn(CLASS_NAME, 'buildCommitUrl', `Invalid SHA format: ${sha.substring(0, 10)}...`);
    return { url: null, error: 'Invalid SHA format (must be 7-40 hex characters)' };
  }

  // Detect provider if not provided
  const detectedProvider = provider ?? detectGitProvider(repoUrl).provider;

  // Clean base URL: remove trailing slashes and .git suffix
  const baseUrl = repoUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '');

  // Get the appropriate path segment for this provider
  const pathSegment = getCommitPathSegment(detectedProvider);

  // Build URL with URL-encoded SHA (defense in depth)
  const commitUrl = `${baseUrl}${pathSegment}${encodeURIComponent(sha)}`;

  logger.trace(CLASS_NAME, 'buildCommitUrl', `Built URL for ${detectedProvider}: ${commitUrl.substring(0, 80)}...`);

  return { url: commitUrl };
}

/**
 * Build a PR/MR URL for the detected provider.
 *
 * Constructs a provider-appropriate PR/MR URL:
 * - GitHub: {baseUrl}/pull/{number}
 * - Bitbucket: {baseUrl}/pull-requests/{number}
 * - GitLab: {baseUrl}/-/merge_requests/{number}
 *
 * @param repoUrl - Repository base URL (e.g., https://github.com/user/repo)
 * @param prNumber - PR/MR number
 * @param provider - Optional pre-detected provider (will auto-detect if not provided)
 * @returns PR URL result
 */
export function buildPrUrl(
  repoUrl: string,
  prNumber: number | string,
  provider?: GitProvider,
): PrUrlResult {
  const logger = LoggerService.getInstance();

  // Validate inputs
  if (!repoUrl || typeof repoUrl !== 'string' || repoUrl.trim().length === 0) {
    logger.debug(CLASS_NAME, 'buildPrUrl', 'Empty or invalid repoUrl');
    return { url: null, error: 'Missing repository URL' };
  }

  // Validate PR number
  const num = typeof prNumber === 'string' ? parseInt(prNumber, 10) : prNumber;
  if (isNaN(num) || num <= 0) {
    logger.debug(CLASS_NAME, 'buildPrUrl', `Invalid PR number: ${prNumber}`);
    return { url: null, error: 'Invalid PR number' };
  }

  // Detect provider if not provided
  const detectedProvider = provider ?? detectGitProvider(repoUrl).provider;

  // Clean base URL: remove trailing slashes and .git suffix
  const baseUrl = repoUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '');

  // Get the appropriate path segment for this provider
  const pathSegment = getPrPathSegment(detectedProvider);

  // Build URL
  const prUrl = `${baseUrl}${pathSegment}${num}`;

  logger.trace(CLASS_NAME, 'buildPrUrl', `Built URL for ${detectedProvider}: ${prUrl}`);

  return { url: prUrl };
}

/**
 * Build a commit URL for webview JavaScript.
 *
 * This function is designed to be called from webview JavaScript code.
 * It handles all the edge cases and provides the correct URL format
 * based on the repository URL domain.
 *
 * @param repoUrl - Repository base URL
 * @param sha - Commit SHA (will be validated)
 * @returns Commit URL or null if inputs are invalid
 */
export function buildCommitUrlForWebview(repoUrl: string | null | undefined, sha: string | null | undefined): string | null {
  if (!repoUrl || !sha) {
    return null;
  }

  const result = buildCommitUrl(repoUrl, sha);
  return result.url;
}

// ============================================================================
// URL Type Detection (GITX-2)
// ============================================================================

/**
 * Regex pattern for Bitbucket URLs.
 *
 * Matches:
 * - bitbucket.org (Bitbucket Cloud)
 * - bitbucket.*.com (custom Bitbucket Server domains)
 * - any domain containing 'bitbucket'
 *
 * @ticket GITX-2
 */
const BITBUCKET_URL_PATTERN = /bitbucket\.(org|com|[a-z]+\.[a-z]+)/i;

/**
 * Regex pattern for SSH URLs.
 *
 * Matches:
 * - git@host:path (SSH shorthand format)
 * - deploy@host:path (any user shorthand format)
 * - ssh://user@host/path (SSH protocol format)
 *
 * @ticket GITX-2
 */
const SSH_URL_PATTERN = /^(?:[a-z0-9._-]+@[a-z0-9._-]+:|ssh:\/\/)/i;

/**
 * Check if a URL points to a Bitbucket repository.
 *
 * Detects both Bitbucket Cloud (bitbucket.org) and Bitbucket Server/Data Center
 * (custom domains containing 'bitbucket').
 *
 * @param url - Repository URL or remote origin URL
 * @returns true if the URL points to a Bitbucket repository
 * @ticket GITX-2
 */
export function isBitbucketUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return BITBUCKET_URL_PATTERN.test(url.trim());
}

/**
 * Check if a URL uses SSH protocol.
 *
 * Detects both SSH shorthand (git@host:path) and SSH protocol URLs (ssh://user@host/path).
 * SSH URLs require pre-loaded SSH keys in ssh-agent for authentication.
 *
 * @param url - Repository URL or remote origin URL
 * @returns true if the URL uses SSH protocol
 * @ticket GITX-2
 */
export function isSshUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return SSH_URL_PATTERN.test(url.trim());
}

/**
 * Check if a URL uses HTTPS protocol.
 *
 * HTTPS URLs can use access tokens for authentication.
 *
 * @param url - Repository URL or remote origin URL
 * @returns true if the URL uses HTTPS protocol
 * @ticket GITX-2
 */
export function isHttpsUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return url.trim().toLowerCase().startsWith('https://');
}
