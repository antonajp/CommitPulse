/**
 * Repository path validation utilities for security.
 *
 * Validates repository paths against configured whitelist to prevent:
 * - CWE-22: Path Traversal
 * - CWE-20: Improper Input Validation
 * - CWE-284: Improper Access Control
 *
 * Ticket: GITX-130
 */

import { existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { LoggerService } from '../logging/logger.js';
import type { RepositoryEntry } from '../config/settings.js';

const CLASS_NAME = 'RepositoryPathValidator';

/**
 * Result of repository path validation.
 */
export interface PathValidationResult {
  readonly isValid: boolean;
  readonly canonicalPath?: string;
  readonly reason?: string;
}

/**
 * Validate a repository path for security.
 *
 * Checks:
 * 1. Path is absolute (prevents relative path tricks)
 * 2. Path exists and is a directory
 * 3. Path is a git repository (.git subdirectory exists)
 * 4. Path resolves to canonical form (eliminates .., symlinks)
 * 5. Path matches one of the configured repositories (whitelist)
 *
 * Security Note (CWE-367 TOCTOU):
 * There is a time-of-check/time-of-use gap between validation and actual use.
 * A malicious actor with filesystem access could theoretically swap the directory
 * after validation but before use. This is acceptable risk for a local VS Code
 * extension operating on the user's own filesystem. For stricter security,
 * validation should be performed atomically with use.
 *
 * @param requestedPath - Path from user selection or repository entry
 * @param configuredRepos - List of allowed repository entries from settings
 * @returns Validation result with canonical path or rejection reason
 */
export function validateRepositoryPath(
  requestedPath: string,
  configuredRepos: readonly RepositoryEntry[],
): PathValidationResult {
  const logger = LoggerService.getInstance();

  // Type check first
  if (typeof requestedPath !== 'string') {
    return { isValid: false, reason: 'Invalid path type' };
  }

  // Security: Reject empty or whitespace-only paths
  const trimmed = requestedPath.trim();
  if (trimmed.length === 0) {
    return { isValid: false, reason: 'Empty path' };
  }

  // Security: Reject relative paths (must be absolute)
  // Check for Unix-style absolute path (starts with /) or Windows-style (C:\, D:\, etc.)
  if (!trimmed.startsWith(sep) && !trimmed.match(/^[A-Za-z]:\\/)) {
    logger.warn(CLASS_NAME, 'validateRepositoryPath', `Rejected relative path: ${trimmed}`);
    return { isValid: false, reason: 'Relative paths not allowed' };
  }

  let canonicalPath: string;
  try {
    // Security: Resolve path to canonical form (eliminates ., .., symlinks)
    canonicalPath = realpathSync(trimmed);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(CLASS_NAME, 'validateRepositoryPath', `Path resolution failed for ${trimmed}: ${msg}`);
    return { isValid: false, reason: 'Path does not exist or is inaccessible' };
  }

  // Verify path exists and is a directory
  try {
    const stats = statSync(canonicalPath);
    if (!stats.isDirectory()) {
      logger.warn(CLASS_NAME, 'validateRepositoryPath', `Rejected non-directory path: ${canonicalPath}`);
      return { isValid: false, reason: 'Path is not a directory' };
    }
  } catch {
    return { isValid: false, reason: 'Path is not accessible' };
  }

  // Verify it's a git repository (.git subdirectory exists)
  const gitDir = resolve(canonicalPath, '.git');
  if (!existsSync(gitDir)) {
    logger.warn(CLASS_NAME, 'validateRepositoryPath', `Rejected non-git directory: ${canonicalPath}`);
    return { isValid: false, reason: 'Not a git repository' };
  }

  // Security: Whitelist check - canonicalPath must match a configured repo
  const allowedPaths = new Set<string>();
  for (const repo of configuredRepos) {
    try {
      const canonicalConfigPath = realpathSync(repo.path);
      allowedPaths.add(canonicalConfigPath);
    } catch {
      // Skip repos with invalid paths in config
      logger.debug(CLASS_NAME, 'validateRepositoryPath', `Configured repository has invalid path: ${repo.name}`);
    }
  }

  if (!allowedPaths.has(canonicalPath)) {
    logger.warn(CLASS_NAME, 'validateRepositoryPath', `Rejected path not in configured repositories: ${canonicalPath}`);
    return {
      isValid: false,
      reason: 'Path is not in the list of configured repositories'
    };
  }

  logger.debug(CLASS_NAME, 'validateRepositoryPath', `Validated repository path: ${canonicalPath}`);
  return { isValid: true, canonicalPath };
}

/**
 * Find a repository entry by name, with path validation.
 *
 * @param repoName - Repository name to find
 * @param configuredRepos - List of configured repository entries
 * @returns The matching repository entry with validated path, or null if not found/invalid
 */
export function findValidRepository(
  repoName: string,
  configuredRepos: readonly RepositoryEntry[],
): RepositoryEntry | null {
  const logger = LoggerService.getInstance();

  if (!repoName || typeof repoName !== 'string') {
    return null;
  }

  // Find by exact name match
  const repo = configuredRepos.find(r => r.name === repoName);
  if (!repo) {
    logger.debug(CLASS_NAME, 'findValidRepository', `Repository not found by name: ${repoName}`);
    return null;
  }

  // Validate the path
  const validation = validateRepositoryPath(repo.path, configuredRepos);
  if (!validation.isValid) {
    logger.warn(CLASS_NAME, 'findValidRepository', `Repository ${repo.name} has invalid path: ${validation.reason}`);
    return null;
  }

  return repo;
}
