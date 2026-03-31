/**
 * Utility for generating diff previews of settings changes.
 *
 * Used by the Tech Stack Refresh command to show users what mapping
 * changes the AI is suggesting before applying them.
 *
 * GITX-138: Add Refresh Tech Stack Baseline command
 */

import { LoggerService } from '../logging/logger.js';

/**
 * Regex for validating arc component category names (CWE-20: Input Validation).
 * Must match ^[a-zA-Z0-9 /-]+$ to prevent XSS in webview rendering.
 * Originally from arc-component-classifier.ts, moved here after GITX-146 simplification.
 */
export const CATEGORY_NAME_REGEX = /^[a-zA-Z0-9 /-]+$/;

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'SettingsDiff';

/**
 * A single change in a mapping.
 */
export interface MappingChange {
  /** The key being changed (extension or filename) */
  key: string;
  /** The previous value (undefined if new) */
  oldValue: string | undefined;
  /** The new value (undefined if removed) */
  newValue: string | undefined;
  /** Type of change */
  changeType: 'added' | 'modified' | 'removed';
}

/**
 * Summary of changes between two mapping objects.
 */
export interface MappingDiff {
  /** Individual changes */
  changes: MappingChange[];
  /** Count of added keys */
  addedCount: number;
  /** Count of modified keys */
  modifiedCount: number;
  /** Count of removed keys */
  removedCount: number;
  /** Total change count */
  totalChanges: number;
  /** Whether any changes exist */
  hasChanges: boolean;
}

/**
 * Complete diff result for extension and filename mappings.
 */
export interface TechStackDiff {
  /** Changes to extension mappings */
  extensionDiff: MappingDiff;
  /** Changes to filename mappings */
  filenameDiff: MappingDiff;
  /** Total changes across both mappings */
  totalChanges: number;
  /** Whether any changes exist */
  hasChanges: boolean;
}

/**
 * Validation result for Claude API response.
 */
export interface ValidationResult {
  /** Whether the response is valid */
  isValid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Validated extension mapping (if valid) */
  extensionMapping?: Record<string, string>;
  /** Validated filename mapping (if valid) */
  filenameMapping?: Record<string, string>;
  /** Count of invalid categories removed */
  invalidCategoriesRemoved: number;
}

/**
 * Calculate the diff between current and proposed mapping values.
 *
 * @param current - Current mapping values
 * @param proposed - Proposed new values from Claude
 * @returns MappingDiff with all changes
 */
export function calculateMappingDiff(
  current: Readonly<Record<string, string>>,
  proposed: Readonly<Record<string, string>>,
): MappingDiff {
  const logger = LoggerService.getInstance();
  const changes: MappingChange[] = [];

  const currentKeys = new Set(Object.keys(current));
  const proposedKeys = new Set(Object.keys(proposed));

  // Find added keys
  for (const key of proposedKeys) {
    if (!currentKeys.has(key)) {
      changes.push({
        key,
        oldValue: undefined,
        newValue: proposed[key],
        changeType: 'added',
      });
    }
  }

  // Find modified keys
  for (const key of currentKeys) {
    if (proposedKeys.has(key)) {
      const oldVal = current[key];
      const newVal = proposed[key];
      if (oldVal !== newVal) {
        changes.push({
          key,
          oldValue: oldVal,
          newValue: newVal,
          changeType: 'modified',
        });
      }
    }
  }

  // Find removed keys
  for (const key of currentKeys) {
    if (!proposedKeys.has(key)) {
      changes.push({
        key,
        oldValue: current[key],
        newValue: undefined,
        changeType: 'removed',
      });
    }
  }

  // Sort changes by key for consistent display
  changes.sort((a, b) => a.key.localeCompare(b.key));

  const addedCount = changes.filter((c) => c.changeType === 'added').length;
  const modifiedCount = changes.filter((c) => c.changeType === 'modified').length;
  const removedCount = changes.filter((c) => c.changeType === 'removed').length;

  const result: MappingDiff = {
    changes,
    addedCount,
    modifiedCount,
    removedCount,
    totalChanges: changes.length,
    hasChanges: changes.length > 0,
  };

  logger.debug(
    CLASS_NAME,
    'calculateMappingDiff',
    `Diff result: ${addedCount} added, ${modifiedCount} modified, ${removedCount} removed`,
  );

  return result;
}

/**
 * Calculate the complete diff between current and proposed tech stack mappings.
 *
 * @param currentExtensions - Current extension mappings
 * @param currentFilenames - Current filename mappings
 * @param proposedExtensions - Proposed extension mappings from Claude
 * @param proposedFilenames - Proposed filename mappings from Claude
 * @returns TechStackDiff with complete change summary
 */
export function calculateTechStackDiff(
  currentExtensions: Readonly<Record<string, string>>,
  currentFilenames: Readonly<Record<string, string>>,
  proposedExtensions: Readonly<Record<string, string>>,
  proposedFilenames: Readonly<Record<string, string>>,
): TechStackDiff {
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'calculateTechStackDiff', 'Calculating tech stack diff');

  const extensionDiff = calculateMappingDiff(currentExtensions, proposedExtensions);
  const filenameDiff = calculateMappingDiff(currentFilenames, proposedFilenames);

  const totalChanges = extensionDiff.totalChanges + filenameDiff.totalChanges;

  const result: TechStackDiff = {
    extensionDiff,
    filenameDiff,
    totalChanges,
    hasChanges: totalChanges > 0,
  };

  logger.info(
    CLASS_NAME,
    'calculateTechStackDiff',
    `Tech stack diff: ${extensionDiff.totalChanges} extension changes, ${filenameDiff.totalChanges} filename changes`,
  );

  return result;
}

/**
 * Format a diff for display in the VS Code UI.
 *
 * @param diff - The TechStackDiff to format
 * @param maxChangesToShow - Maximum number of changes to show (default: 50)
 * @returns Formatted string for display
 */
export function formatDiffForDisplay(diff: TechStackDiff, maxChangesToShow = 50): string {
  if (!diff.hasChanges) {
    return 'No changes detected. Your current mappings already match the AI suggestions.';
  }

  const lines: string[] = [];
  lines.push(`Total changes: ${diff.totalChanges}`);
  lines.push('');

  let shownCount = 0;

  // Extension changes
  if (diff.extensionDiff.hasChanges) {
    lines.push(`Extension Mappings (${diff.extensionDiff.totalChanges} changes):`);
    lines.push(`  + ${diff.extensionDiff.addedCount} added`);
    lines.push(`  ~ ${diff.extensionDiff.modifiedCount} modified`);
    lines.push(`  - ${diff.extensionDiff.removedCount} removed`);
    lines.push('');

    for (const change of diff.extensionDiff.changes) {
      if (shownCount >= maxChangesToShow) {
        lines.push(`  ... and ${diff.totalChanges - shownCount} more changes`);
        break;
      }
      lines.push(formatSingleChange(change));
      shownCount++;
    }
    lines.push('');
  }

  // Filename changes
  if (diff.filenameDiff.hasChanges && shownCount < maxChangesToShow) {
    lines.push(`Filename Mappings (${diff.filenameDiff.totalChanges} changes):`);
    lines.push(`  + ${diff.filenameDiff.addedCount} added`);
    lines.push(`  ~ ${diff.filenameDiff.modifiedCount} modified`);
    lines.push(`  - ${diff.filenameDiff.removedCount} removed`);
    lines.push('');

    for (const change of diff.filenameDiff.changes) {
      if (shownCount >= maxChangesToShow) {
        lines.push(`  ... and ${diff.totalChanges - shownCount} more changes`);
        break;
      }
      lines.push(formatSingleChange(change));
      shownCount++;
    }
  }

  return lines.join('\n');
}

/**
 * Format a single change for display.
 *
 * @param change - The MappingChange to format
 * @returns Formatted string
 */
function formatSingleChange(change: MappingChange): string {
  switch (change.changeType) {
    case 'added':
      return `  + "${change.key}" -> "${change.newValue}"`;
    case 'modified':
      return `  ~ "${change.key}": "${change.oldValue}" -> "${change.newValue}"`;
    case 'removed':
      return `  - "${change.key}" (was "${change.oldValue}")`;
    default:
      return `  ? "${change.key}"`;
  }
}

/**
 * Validate and sanitize the Claude API response.
 *
 * Ensures:
 * 1. Response has the expected structure
 * 2. All category names match CATEGORY_NAME_REGEX
 * 3. Invalid entries are removed with warning
 *
 * @param response - Raw response from Claude API
 * @returns ValidationResult with validated mappings
 */
export function validateClaudeResponse(response: unknown): ValidationResult {
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'validateClaudeResponse', 'Validating Claude API response');

  // Check basic structure
  if (!response || typeof response !== 'object') {
    return {
      isValid: false,
      error: 'Response is not an object',
      invalidCategoriesRemoved: 0,
    };
  }

  const typedResponse = response as Record<string, unknown>;

  // Check for expected keys
  if (!('extensionMapping' in typedResponse) || !('filenameMapping' in typedResponse)) {
    return {
      isValid: false,
      error: 'Response missing required extensionMapping or filenameMapping',
      invalidCategoriesRemoved: 0,
    };
  }

  const rawExtensions = typedResponse.extensionMapping;
  const rawFilenames = typedResponse.filenameMapping;

  if (!rawExtensions || typeof rawExtensions !== 'object') {
    return {
      isValid: false,
      error: 'extensionMapping is not an object',
      invalidCategoriesRemoved: 0,
    };
  }

  if (!rawFilenames || typeof rawFilenames !== 'object') {
    return {
      isValid: false,
      error: 'filenameMapping is not an object',
      invalidCategoriesRemoved: 0,
    };
  }

  // Validate and sanitize extension mappings
  const extensionMapping: Record<string, string> = {};
  let invalidCount = 0;

  for (const [key, value] of Object.entries(rawExtensions as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      logger.warn(CLASS_NAME, 'validateClaudeResponse', `Invalid extension value for "${key}": not a string`);
      invalidCount++;
      continue;
    }

    if (!CATEGORY_NAME_REGEX.test(value)) {
      logger.warn(CLASS_NAME, 'validateClaudeResponse', `Invalid category name "${value}" for extension "${key}"`);
      invalidCount++;
      continue;
    }

    extensionMapping[key] = value;
  }

  // Validate and sanitize filename mappings
  const filenameMapping: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawFilenames as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      logger.warn(CLASS_NAME, 'validateClaudeResponse', `Invalid filename value for "${key}": not a string`);
      invalidCount++;
      continue;
    }

    if (!CATEGORY_NAME_REGEX.test(value)) {
      logger.warn(CLASS_NAME, 'validateClaudeResponse', `Invalid category name "${value}" for filename "${key}"`);
      invalidCount++;
      continue;
    }

    filenameMapping[key] = value;
  }

  if (invalidCount > 0) {
    logger.warn(CLASS_NAME, 'validateClaudeResponse', `Removed ${invalidCount} invalid entries from Claude response`);
  }

  logger.info(
    CLASS_NAME,
    'validateClaudeResponse',
    `Validation complete: ${Object.keys(extensionMapping).length} extensions, ${Object.keys(filenameMapping).length} filenames`,
  );

  return {
    isValid: true,
    extensionMapping,
    filenameMapping,
    invalidCategoriesRemoved: invalidCount,
  };
}

/**
 * Create a backup of the current mappings as a JSON string.
 *
 * @param extensionMapping - Current extension mappings
 * @param filenameMapping - Current filename mappings
 * @returns JSON string backup
 */
export function createMappingsBackup(
  extensionMapping: Readonly<Record<string, string>>,
  filenameMapping: Readonly<Record<string, string>>,
): string {
  const backup = {
    timestamp: new Date().toISOString(),
    extensionMapping: { ...extensionMapping },
    filenameMapping: { ...filenameMapping },
  };
  return JSON.stringify(backup, null, 2);
}

/**
 * Parse a mappings backup JSON string.
 *
 * @param backupJson - JSON string from createMappingsBackup
 * @returns Parsed backup object, or null if invalid
 */
export function parseMappingsBackup(
  backupJson: string,
): { extensionMapping: Record<string, string>; filenameMapping: Record<string, string>; timestamp: string } | null {
  const logger = LoggerService.getInstance();

  try {
    const parsed = JSON.parse(backupJson) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      logger.warn(CLASS_NAME, 'parseMappingsBackup', 'Backup is not an object');
      return null;
    }

    const backup = parsed as Record<string, unknown>;

    if (
      typeof backup.timestamp !== 'string' ||
      typeof backup.extensionMapping !== 'object' ||
      typeof backup.filenameMapping !== 'object'
    ) {
      logger.warn(CLASS_NAME, 'parseMappingsBackup', 'Backup missing required fields');
      return null;
    }

    return {
      timestamp: backup.timestamp,
      extensionMapping: backup.extensionMapping as Record<string, string>,
      filenameMapping: backup.filenameMapping as Record<string, string>,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(CLASS_NAME, 'parseMappingsBackup', `Failed to parse backup: ${message}`);
    return null;
  }
}
