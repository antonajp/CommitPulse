/**
 * Git commit data extraction and transformation utilities.
 *
 * Provides pure data extraction functions that convert simple-git
 * log entries into typed data structures for database persistence.
 * These functions are stateless and deterministic -- they contain
 * no I/O, database calls, or side effects.
 *
 * Separated from GitAnalysisService to keep both modules under the
 * 600-line limit per CLAUDE.md modular design guidelines.
 *
 * Maps from Python GitCommitHistorySql.py helper methods:
 *   _is_merge              -> isMergeCommit
 *   write_commit_words     -> extractCommitWords
 *   _get_subdir            -> getParentDirectory
 *   _get_subsubdir         -> getSubDirectory
 *   write_commit_to_file   -> buildCommitHistoryRow
 *   get_commit_diff_details -> parseDiffFiles
 *   create_commit_df       -> extractCommitData
 *
 * Ticket: IQS-854
 */

import type { DefaultLogFields } from 'simple-git';
import { LoggerService } from '../logging/logger.js';
import type {
  CommitHistoryRow,
  CommitWordRow,
} from '../database/commit-types.js';
import type {
  RepoContext,
  ExtractedCommit,
  ExtractedFileDiff,
} from './git-analysis-types.js';
import { buildCommitUrl } from '../utils/git-provider-detector.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'GitCommitExtractor';

/**
 * Merge detection keywords matching Python _is_merge() regex patterns.
 * Each keyword is checked case-insensitively against both commit message and branch name.
 *
 * From Python GitCommitHistorySql.py lines 166-180:
 *   merge, uat, QAFull, revert, release, prod, backup
 */
const MERGE_KEYWORDS: readonly string[] = [
  'merge',
  'uat',
  'qafull',
  'revert',
  'release',
  'prod',
  'backup',
];

/**
 * Regex pattern for splitting commit messages into words.
 * Matches Python: re.split(r"[ /.,]", commit_msg.lower())
 */
const WORD_SPLIT_PATTERN = /[ /.,]+/;

// ============================================================================
// Merge detection
// ============================================================================

/**
 * Detect whether a commit is a merge commit based on keywords.
 * Maps from Python _is_merge() method.
 *
 * Checks both commit message and branch name for any of the
 * merge keywords: merge, uat, QAFull, revert, release, prod, backup.
 * All checks are case-insensitive.
 *
 * @param commitMessage - Cleaned commit message
 * @param branchName - Branch name the commit is on
 * @returns true if merge detected
 */
export function isMergeCommit(commitMessage: string, branchName: string): boolean {
  const logger = LoggerService.getInstance();
  const msgLower = commitMessage.toLowerCase();
  const branchLower = branchName.toLowerCase();

  for (const keyword of MERGE_KEYWORDS) {
    if (msgLower.includes(keyword) || branchLower.includes(keyword)) {
      logger.trace(CLASS_NAME, 'isMergeCommit', `Merge detected via keyword '${keyword}'`);
      return true;
    }
  }

  return false;
}

// ============================================================================
// Word extraction
// ============================================================================

/**
 * Extract words from a commit message for the commit_msg_words table.
 * Maps from Python write_commit_words_to_file().
 *
 * Splits on spaces, slashes, periods, and commas (matching Python regex).
 * Filters out empty strings.
 *
 * @param sha - Commit SHA
 * @param commitMessage - Cleaned commit message
 * @param author - Commit author name
 * @returns Array of CommitWordRow objects
 */
export function extractCommitWords(sha: string, commitMessage: string, author: string): CommitWordRow[] {
  const logger = LoggerService.getInstance();
  const words = commitMessage.toLowerCase().split(WORD_SPLIT_PATTERN);
  const wordRows: CommitWordRow[] = [];

  for (const word of words) {
    const trimmed = word.trim();
    if (trimmed.length > 0) {
      wordRows.push({ sha, word: trimmed, author });
    }
  }

  logger.trace(CLASS_NAME, 'extractCommitWords', `Extracted ${wordRows.length} words from ${sha.substring(0, 8)}`);
  return wordRows;
}

// ============================================================================
// Directory parsing
// ============================================================================

/**
 * Get the parent (first-level) directory from a file path.
 * Maps from Python _get_subdir().
 *
 * @param filePath - File path relative to repo root
 * @returns First directory segment, or "root" if no directory
 */
export function getParentDirectory(filePath: string): string {
  const slashIndex = filePath.indexOf('/');
  if (slashIndex > 0) {
    return filePath.substring(0, slashIndex);
  }
  return 'root';
}

/**
 * Get the sub-directory (second-level) from a file path.
 * Maps from Python _get_subsubdir().
 *
 * @param filePath - File path relative to repo root
 * @returns Second directory segment, or empty string if none
 */
export function getSubDirectory(filePath: string): string {
  const firstSlash = filePath.indexOf('/');
  if (firstSlash < 0) {
    return '';
  }
  const secondSlash = filePath.indexOf('/', firstSlash + 1);
  if (secondSlash > firstSlash) {
    return filePath.substring(firstSlash + 1, secondSlash);
  }
  return '';
}

// ============================================================================
// File extension parsing
// ============================================================================

/**
 * Get the file extension from a file path.
 * Handles edge cases like dotfiles and paths without extensions.
 *
 * @param filePath - File path
 * @returns File extension including dot, or empty string
 */
export function getFileExtension(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  const fileName = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return '';
  }
  return fileName.substring(dotIndex);
}

// ============================================================================
// Diff file parsing
// ============================================================================

/**
 * Parse file diff information from a simple-git log entry.
 * Maps from Python get_commit_diff_details() and create_commit_df().
 *
 * @param logEntry - Raw log entry from simple-git
 * @returns Array of file diff data
 */
export function parseDiffFiles(logEntry: DefaultLogFields & { diff?: { files?: Array<{ file: string; changes: number; insertions: number; deletions: number; binary: boolean }> } }): ExtractedFileDiff[] {
  const logger = LoggerService.getInstance();
  const files: ExtractedFileDiff[] = [];
  const diff = logEntry.diff;

  if (!diff || !diff.files) {
    logger.trace(CLASS_NAME, 'parseDiffFiles', `No diff data for ${logEntry.hash.substring(0, 8)}`);
    return files;
  }

  for (const fileDiff of diff.files) {
    const filePath = fileDiff.file;
    const extension = getFileExtension(filePath);
    const insertions = fileDiff.insertions ?? 0;
    const deletions = fileDiff.deletions ?? 0;

    files.push({
      filePath,
      fileExtension: extension,
      insertions,
      deletions,
      delta: insertions - deletions,
      parentDirectory: getParentDirectory(filePath),
      subDirectory: getSubDirectory(filePath),
      isTestFile: filePath.toUpperCase().includes('TEST'),
    });
  }

  return files;
}

// ============================================================================
// Commit data extraction
// ============================================================================

/**
 * Extract structured commit data from a simple-git log entry.
 * Transforms the simple-git output into our ExtractedCommit interface.
 *
 * @param logEntry - Raw log entry from simple-git
 * @param branchName - Branch this commit was found on
 * @returns Extracted commit data
 */
export function extractCommitData(
  logEntry: DefaultLogFields,
  branchName: string,
): ExtractedCommit {
  const logger = LoggerService.getInstance();
  logger.trace(CLASS_NAME, 'extractCommitData', `Extracting data for ${logEntry.hash.substring(0, 8)}`);

  // Clean commit message (matches Python: strip, replace \r, \n, ')
  const cleanedMessage = logEntry.message
    .trim()
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .replace(/'/g, '');

  // Parse diff stats from the log entry
  const files = parseDiffFiles(logEntry);

  // Calculate totals from file diffs
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const file of files) {
    totalAdded += file.insertions;
    totalRemoved += file.deletions;
  }

  const merge = isMergeCommit(cleanedMessage, branchName);

  logger.trace(CLASS_NAME, 'extractCommitData', `Commit ${logEntry.hash.substring(0, 8)}: ${files.length} files, +${totalAdded}/-${totalRemoved}, merge=${merge}`);

  return {
    sha: logEntry.hash,
    author: logEntry.author_name,
    authorEmail: logEntry.author_email,
    date: logEntry.date,
    message: cleanedMessage,
    branch: branchName,
    fileCount: files.length,
    linesAdded: totalAdded,
    linesRemoved: totalRemoved,
    isMerge: merge,
    files,
  };
}

// ============================================================================
// CommitHistoryRow builder
// ============================================================================

/**
 * Build a CommitHistoryRow for database insertion.
 * Maps from Python write_commit_to_file().
 *
 * @param extracted - Extracted commit data
 * @param repoContext - Repository context
 * @returns CommitHistoryRow ready for insertion
 */
export function buildCommitHistoryRow(
  extracted: ExtractedCommit,
  repoContext: RepoContext,
): CommitHistoryRow {
  // Use provider-aware URL building (IQS-938)
  // Supports GitHub, Bitbucket, and GitLab URL formats
  const urlResult = buildCommitUrl(repoContext.repositoryUrl, extracted.sha);
  const commitUrl = urlResult.url ?? `${repoContext.repositoryUrl.replace('.git', '')}/commit/${extracted.sha}`;

  return {
    sha: extracted.sha,
    url: commitUrl,
    branch: extracted.branch,
    repository: repoContext.name,
    repositoryUrl: repoContext.repositoryUrl,
    author: extracted.author,
    commitDate: new Date(extracted.date),
    commitMessage: extracted.message,
    fileCount: extracted.fileCount,
    linesAdded: extracted.linesAdded,
    linesRemoved: extracted.linesRemoved,
    isMerge: extracted.isMerge,
    isJiraRef: null, // Jira ref detection handled by IQS-855/IQS-856
    organization: repoContext.organization,
  };
}
