import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import type { PipelineLogRow } from './pipeline-run-tree-types.js';
import { PipelineRepository } from '../database/pipeline-repository.js';
import { DatabaseService, buildConfigFromSettings } from '../database/database-service.js';
import { SecretStorageService } from '../config/secret-storage.js';
import { getSettings } from '../config/settings.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'PipelineRunUtils';

// ============================================================================
// ThemeIcon constants for pipeline run status
// ============================================================================

/**
 * ThemeIcon identifiers used for tree nodes.
 * Using built-in VS Code codicons for consistent theming.
 *
 * Ticket: IQS-868
 */
export const PIPELINE_ICONS = {
  /** Green check for successful runs. */
  success: new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')),
  /** Red error for failed runs. */
  error: new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')),
  /** Yellow sync/running indicator. */
  running: new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('debugIcon.pauseForeground')),
  /** Unknown/other status. */
  unknown: new vscode.ThemeIcon('question'),
  /** Class name icon. */
  className: new vscode.ThemeIcon('symbol-class'),
  /** Clock icon for start/end time. */
  clock: new vscode.ThemeIcon('clock'),
  /** Duration icon. */
  duration: new vscode.ThemeIcon('watch'),
  /** Table counts group icon. */
  tableGroup: new vscode.ThemeIcon('database'),
  /** Individual table count icon. */
  tableCount: new vscode.ThemeIcon('table'),
  /** Empty placeholder icon. */
  info: new vscode.ThemeIcon('info'),
  /** Warning icon. */
  warning: new vscode.ThemeIcon('warning'),
} as const;

// ============================================================================
// Static utility functions
// ============================================================================

/**
 * Get the appropriate ThemeIcon for a pipeline run status.
 * Green check for success, red error for error, yellow spin for running.
 *
 * @param status - The status string from the database
 * @returns ThemeIcon with appropriate color coding
 */
export function getStatusIcon(status: string): vscode.ThemeIcon {
  const normalized = status.toLowerCase().trim();
  if (normalized === 'success' || normalized === 'completed') {
    return PIPELINE_ICONS.success;
  }
  if (normalized === 'error' || normalized === 'failed') {
    return PIPELINE_ICONS.error;
  }
  if (normalized === 'running' || normalized === 'in_progress' || normalized === 'started') {
    return PIPELINE_ICONS.running;
  }
  return PIPELINE_ICONS.unknown;
}

/**
 * Format a Date to a human-readable date/time string.
 *
 * @param date - The Date to format
 * @returns Formatted string like "Mar 4, 2026 9:15 AM"
 */
export function formatDateTime(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Calculate human-readable duration between two timestamps.
 * Returns "Still running" if endTime is null.
 *
 * @param startTime - Start timestamp
 * @param endTime - End timestamp, or null if still running
 * @returns Duration string like "2m 34s" or "1h 5m 12s"
 */
export function calculateDuration(startTime: Date | null, endTime: Date | null): string {
  if (!startTime) {
    return 'N/A';
  }
  if (!endTime) {
    return 'Still running';
  }

  const diffMs = endTime.getTime() - startTime.getTime();
  if (diffMs < 0) {
    return 'Invalid';
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Convert a numeric message level to a human-readable label.
 *
 * @param level - Numeric message level
 * @returns Human-readable level label
 */
export function getMsgLevelLabel(level: number): string {
  switch (level) {
    case 0: return 'TRACE';
    case 1: return 'DEBUG';
    case 2: return 'INFO';
    case 3: return 'WARN';
    case 4: return 'ERROR';
    case 5: return 'CRITICAL';
    default: return `LEVEL-${level}`;
  }
}

// ============================================================================
// Pipeline run log viewer
// ============================================================================

/**
 * Show pipeline run log entries in the output channel.
 * Opens a short-lived database connection, fetches log entries,
 * and formats them to the Gitr output channel.
 *
 * @param pipelineRunId - The pipeline run ID to show logs for
 * @param secretService - SecretStorageService for database password
 */
export async function showPipelineRunLog(
  pipelineRunId: number,
  secretService: SecretStorageService,
): Promise<void> {
  const logger = LoggerService.getInstance();
  logger.info(CLASS_NAME, 'showPipelineRunLog', `Showing log entries for pipeline run #${pipelineRunId}`);

  let dbService: DatabaseService | undefined;

  try {
    const settings = getSettings();
    const dbPassword = await secretService.getDatabasePassword();
    if (!dbPassword) {
      logger.warn(CLASS_NAME, 'showPipelineRunLog', 'Database password not configured');
      void vscode.window.showWarningMessage('Gitr: Database password not configured. Use "Gitr: Set Database Password" first.');
      return;
    }

    dbService = new DatabaseService();
    const dbConfig = buildConfigFromSettings(settings.database, dbPassword);
    await dbService.initialize(dbConfig);

    const pipelineRepo = new PipelineRepository(dbService);
    const logEntries: PipelineLogRow[] = await pipelineRepo.getPipelineLogEntries(pipelineRunId);

    if (logEntries.length === 0) {
      logger.info(CLASS_NAME, 'showPipelineRunLog', `No log entries found for run #${pipelineRunId}`);
      void vscode.window.showInformationMessage(`Gitr: No log entries found for pipeline run #${pipelineRunId}.`);
      return;
    }

    // Format log entries to the output channel
    const separator = '='.repeat(80);
    logger.info('PipelineRunLog', `run-${pipelineRunId}`, separator);
    logger.info('PipelineRunLog', `run-${pipelineRunId}`, `Pipeline Run #${pipelineRunId} - Log Entries (${logEntries.length} total)`);
    logger.info('PipelineRunLog', `run-${pipelineRunId}`, separator);

    for (const entry of logEntries) {
      const timestamp = entry.transactionDate ? formatDateTime(entry.transactionDate) : 'N/A';
      const levelLabel = getMsgLevelLabel(entry.msgLevel);
      const logLine = `[${timestamp}] [${levelLabel}] ${entry.className ?? ''}.${entry.context ?? ''}: ${entry.detail ?? ''}`;
      logger.info('PipelineRunLog', `run-${pipelineRunId}`, logLine);
    }

    logger.info('PipelineRunLog', `run-${pipelineRunId}`, separator);

    // Show the output channel
    logger.show();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(CLASS_NAME, 'showPipelineRunLog', `Failed to load log entries: ${message}`);
    void vscode.window.showErrorMessage(`Gitr: Failed to load pipeline run log: ${message}`);
  } finally {
    if (dbService) {
      try {
        await dbService.shutdown();
      } catch (shutdownError: unknown) {
        const msg = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
        logger.warn(CLASS_NAME, 'showPipelineRunLog', `Database shutdown warning: ${msg}`);
      }
    }
  }
}
