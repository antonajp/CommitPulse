/**
 * ScheduleRunnerService: Background scheduled pipeline execution.
 *
 * Converts Python GitrScheduleRunner.start_schedule() (lines 102-116) to TypeScript:
 *   Python schedule library -> setInterval with cron-parser for next-run calculation
 *   Python while True loop   -> VS Code setInterval with 60-second tick
 *
 * Key design decisions:
 *   - Uses cron-parser v5 (CronExpressionParser.parse) for cron expression evaluation
 *   - Checks every 60 seconds if the current time matches the next scheduled run
 *   - Status bar item shows next scheduled run time
 *   - Mutual exclusion: skips scheduled run if manual pipeline is in progress
 *   - Respects VS Code Disposable pattern for clean extension deactivation
 *   - Configuration changes are monitored and the schedule is rebuilt automatically
 *
 * Ticket: IQS-865
 */

import * as vscode from 'vscode';
import { CronExpressionParser } from 'cron-parser';
import { LoggerService } from '../logging/logger.js';
import { getSettings, onConfigurationChanged, type ScheduleSettings } from '../config/settings.js';

/**
 * Callback type for triggering a pipeline run from the schedule runner.
 * The schedule runner does not own the pipeline; it delegates execution
 * to the command layer that builds the full PipelineService.
 *
 * @returns A promise that resolves when the pipeline run completes
 */
export type PipelineRunCallback = () => Promise<void>;

/**
 * Callback type for checking whether a manual pipeline run is in progress.
 * Used for mutual exclusion between scheduled and manual runs.
 *
 * @returns true if a pipeline run (manual or scheduled) is currently executing
 */
export type PipelineRunningCheck = () => boolean;

/** Class name for structured logging. */
const CLASS_NAME = 'ScheduleRunnerService';

/** Interval between schedule checks in milliseconds (60 seconds). */
const CHECK_INTERVAL_MS = 60_000;

/**
 * Tolerance window in milliseconds for matching cron times.
 * If the current time is within this window of the next scheduled time,
 * a run is triggered. This prevents off-by-one-second misses.
 */
const CRON_MATCH_TOLERANCE_MS = 59_999;

/**
 * Orchestrates background scheduled pipeline runs.
 *
 * Lifecycle:
 * 1. Created during extension activation
 * 2. start() called if schedule is enabled in settings
 * 3. Every 60 seconds, checks if current time matches the cron schedule
 * 4. If match and no pipeline is running, triggers a pipeline run
 * 5. stop() called on extension deactivation or when schedule is disabled
 *
 * Maps from Python GitrScheduleRunner.start_schedule() (lines 102-116).
 */
export class ScheduleRunnerService implements vscode.Disposable {
  private readonly logger: LoggerService;
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  private checkInterval: ReturnType<typeof setInterval> | undefined;
  private nextRunTime: Date | undefined;
  private isScheduleActive = false;
  private isScheduledRunInProgress = false;
  private lastRunTime: Date | undefined;
  private runCount = 0;

  private pipelineRunCallback: PipelineRunCallback | undefined;
  private pipelineRunningCheck: PipelineRunningCheck | undefined;
  private currentCronExpression: string;
  private currentEnabled: boolean;

  constructor() {
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'Creating ScheduleRunnerService');

    // Read initial settings
    const settings = getSettings();
    this.currentEnabled = settings.schedule.enabled;
    this.currentCronExpression = settings.schedule.cronExpression;

    // Create status bar item (lower priority = further right)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      50,
    );
    this.statusBarItem.command = 'gitr.toggleSchedule';
    this.disposables.push(this.statusBarItem);

    // Listen for configuration changes
    const configDisposable = onConfigurationChanged((newConfig) => {
      this.handleConfigurationChange(newConfig.schedule);
    });
    this.disposables.push(configDisposable);

    this.logger.debug(CLASS_NAME, 'constructor', `Initial schedule config: enabled=${this.currentEnabled}, cron=${this.currentCronExpression}`);
  }

  /**
   * Register the callback that triggers pipeline execution.
   * Must be called before start() for scheduled runs to work.
   *
   * @param callback - Function to call when a scheduled pipeline run should start
   */
  setPipelineRunCallback(callback: PipelineRunCallback): void {
    this.pipelineRunCallback = callback;
    this.logger.debug(CLASS_NAME, 'setPipelineRunCallback', 'Pipeline run callback registered');
  }

  /**
   * Register the callback that checks whether a pipeline run is in progress.
   * Used for mutual exclusion between scheduled and manual runs.
   *
   * @param check - Function that returns true if a pipeline is currently running
   */
  setPipelineRunningCheck(check: PipelineRunningCheck): void {
    this.pipelineRunningCheck = check;
    this.logger.debug(CLASS_NAME, 'setPipelineRunningCheck', 'Pipeline running check registered');
  }

  /**
   * Start the background schedule timer.
   * Computes the next run time from the cron expression and begins
   * the 60-second check interval.
   *
   * No-op if already started or if schedule is disabled in settings.
   */
  start(): void {
    this.logger.info(CLASS_NAME, 'start', 'Starting schedule runner');

    if (this.isScheduleActive) {
      this.logger.debug(CLASS_NAME, 'start', 'Schedule runner already active, ignoring start request');
      return;
    }

    if (!this.currentEnabled) {
      this.logger.info(CLASS_NAME, 'start', 'Schedule is disabled in settings, not starting');
      this.updateStatusBar();
      return;
    }

    if (!this.pipelineRunCallback) {
      this.logger.warn(CLASS_NAME, 'start', 'No pipeline run callback registered, cannot start schedule');
      return;
    }

    // Validate and parse the cron expression
    if (!this.computeNextRunTime()) {
      this.logger.error(CLASS_NAME, 'start', `Invalid cron expression: "${this.currentCronExpression}". Schedule not started.`);
      this.updateStatusBar();
      return;
    }

    // Start the check interval
    this.checkInterval = setInterval(() => {
      this.checkAndRun().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(CLASS_NAME, 'checkAndRun', `Unhandled error in schedule check: ${message}`);
      });
    }, CHECK_INTERVAL_MS);

    this.isScheduleActive = true;
    this.updateStatusBar();

    this.logger.info(CLASS_NAME, 'start', `Schedule runner started. Next run: ${this.nextRunTime?.toLocaleString() ?? 'unknown'}`);
  }

  /**
   * Stop the background schedule timer.
   * Clears the interval and resets the next run time.
   */
  stop(): void {
    this.logger.info(CLASS_NAME, 'stop', 'Stopping schedule runner');

    if (this.checkInterval !== undefined) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    this.isScheduleActive = false;
    this.nextRunTime = undefined;
    this.updateStatusBar();

    this.logger.info(CLASS_NAME, 'stop', 'Schedule runner stopped');
  }

  /**
   * Check whether it is time to run and execute if conditions are met.
   * Called every CHECK_INTERVAL_MS by the setInterval timer.
   */
  private async checkAndRun(): Promise<void> {
    this.logger.trace(CLASS_NAME, 'checkAndRun', `Checking schedule. Next run: ${this.nextRunTime?.toISOString() ?? 'none'}`);

    if (!this.nextRunTime) {
      this.logger.debug(CLASS_NAME, 'checkAndRun', 'No next run time computed, skipping check');
      return;
    }

    const now = new Date();
    const timeDiff = this.nextRunTime.getTime() - now.getTime();

    this.logger.trace(CLASS_NAME, 'checkAndRun', `Time until next run: ${Math.round(timeDiff / 1000)}s`);

    // Check if we are within the tolerance window
    if (timeDiff > CRON_MATCH_TOLERANCE_MS) {
      // Not time yet
      return;
    }

    if (timeDiff < -CHECK_INTERVAL_MS) {
      // We missed the window (e.g., machine was asleep). Recompute next run.
      this.logger.info(CLASS_NAME, 'checkAndRun', `Missed scheduled run at ${this.nextRunTime.toISOString()}, recomputing next run time`);
      this.computeNextRunTime();
      this.updateStatusBar();
      return;
    }

    // Time to run!
    this.logger.info(CLASS_NAME, 'checkAndRun', `Schedule triggered at ${now.toISOString()}`);

    // Mutual exclusion: skip if a manual run is in progress
    if (this.pipelineRunningCheck?.()) {
      this.logger.warn(CLASS_NAME, 'checkAndRun', 'A pipeline run is already in progress (manual or scheduled). Skipping scheduled run.');
      this.computeNextRunTime();
      this.updateStatusBar();
      return;
    }

    // Also skip if a scheduled run is already in progress (re-entrancy guard)
    if (this.isScheduledRunInProgress) {
      this.logger.warn(CLASS_NAME, 'checkAndRun', 'Previous scheduled run still in progress. Skipping.');
      this.computeNextRunTime();
      this.updateStatusBar();
      return;
    }

    await this.executeScheduledRun();
  }

  /**
   * Execute a scheduled pipeline run with proper state management.
   */
  private async executeScheduledRun(): Promise<void> {
    if (!this.pipelineRunCallback) {
      this.logger.error(CLASS_NAME, 'executeScheduledRun', 'No pipeline run callback registered');
      return;
    }

    this.isScheduledRunInProgress = true;
    this.runCount++;
    const runNumber = this.runCount;

    this.logger.critical(CLASS_NAME, 'executeScheduledRun', `Starting scheduled pipeline run #${runNumber}`);
    this.updateStatusBar();

    try {
      await this.pipelineRunCallback();
      this.lastRunTime = new Date();
      this.logger.critical(CLASS_NAME, 'executeScheduledRun', `Scheduled pipeline run #${runNumber} completed successfully`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'executeScheduledRun', `Scheduled pipeline run #${runNumber} failed: ${message}`);
    } finally {
      this.isScheduledRunInProgress = false;
      this.computeNextRunTime();
      this.updateStatusBar();
      this.logger.info(CLASS_NAME, 'executeScheduledRun', `Next scheduled run: ${this.nextRunTime?.toLocaleString() ?? 'unknown'}`);
    }
  }

  /**
   * Compute the next run time from the cron expression.
   *
   * @returns true if the cron expression was parsed successfully
   */
  private computeNextRunTime(): boolean {
    try {
      this.logger.trace(CLASS_NAME, 'computeNextRunTime', `Parsing cron expression: "${this.currentCronExpression}"`);

      const expression = CronExpressionParser.parse(this.currentCronExpression);
      const next = expression.next();
      this.nextRunTime = next.toDate();

      this.logger.debug(CLASS_NAME, 'computeNextRunTime', `Next run time computed: ${this.nextRunTime.toISOString()}`);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'computeNextRunTime', `Failed to parse cron expression "${this.currentCronExpression}": ${message}`);
      this.nextRunTime = undefined;
      return false;
    }
  }

  /**
   * Handle configuration changes for schedule settings.
   * Restarts the schedule if the cron expression or enabled state changes.
   */
  private handleConfigurationChange(newSchedule: ScheduleSettings): void {
    this.logger.info(CLASS_NAME, 'handleConfigurationChange', `Schedule config changed: enabled=${newSchedule.enabled}, cron=${newSchedule.cronExpression}`);

    const enabledChanged = this.currentEnabled !== newSchedule.enabled;
    const cronChanged = this.currentCronExpression !== newSchedule.cronExpression;

    this.currentEnabled = newSchedule.enabled;
    this.currentCronExpression = newSchedule.cronExpression;

    if (!enabledChanged && !cronChanged) {
      this.logger.debug(CLASS_NAME, 'handleConfigurationChange', 'No relevant schedule changes detected');
      return;
    }

    if (enabledChanged) {
      this.logger.info(CLASS_NAME, 'handleConfigurationChange', `Schedule enabled changed to: ${newSchedule.enabled}`);
    }
    if (cronChanged) {
      this.logger.info(CLASS_NAME, 'handleConfigurationChange', `Cron expression changed to: ${newSchedule.cronExpression}`);
    }

    // Stop and optionally restart
    if (this.isScheduleActive) {
      this.stop();
    }

    if (this.currentEnabled) {
      this.start();
    } else {
      this.updateStatusBar();
    }
  }

  /**
   * Update the status bar item to reflect current schedule state.
   */
  private updateStatusBar(): void {
    if (this.isScheduledRunInProgress) {
      this.statusBarItem.text = '$(sync~spin) Gitr: Running...';
      this.statusBarItem.tooltip = `Gitr scheduled pipeline run #${this.runCount} in progress`;
      this.statusBarItem.show();
      return;
    }

    if (!this.currentEnabled) {
      this.statusBarItem.text = '$(clock) Gitr: Schedule Off';
      this.statusBarItem.tooltip = 'Gitr scheduled pipeline is disabled. Click to toggle.';
      this.statusBarItem.show();
      return;
    }

    if (!this.isScheduleActive) {
      this.statusBarItem.text = '$(warning) Gitr: Schedule Error';
      this.statusBarItem.tooltip = `Gitr schedule failed to start. Check cron expression: ${this.currentCronExpression}`;
      this.statusBarItem.show();
      return;
    }

    if (this.nextRunTime) {
      const timeStr = this.formatNextRunTime(this.nextRunTime);
      this.statusBarItem.text = `$(clock) Gitr: Next ${timeStr}`;
      const lastRunStr = this.lastRunTime
        ? `Last run: ${this.lastRunTime.toLocaleString()}`
        : 'No runs yet';
      this.statusBarItem.tooltip = `Gitr scheduled pipeline\nCron: ${this.currentCronExpression}\nNext: ${this.nextRunTime.toLocaleString()}\n${lastRunStr}\nTotal runs: ${this.runCount}\nClick to toggle.`;
      this.statusBarItem.show();
      return;
    }

    this.statusBarItem.text = '$(clock) Gitr: Scheduled';
    this.statusBarItem.tooltip = `Gitr scheduled pipeline\nCron: ${this.currentCronExpression}`;
    this.statusBarItem.show();
  }

  /**
   * Format the next run time for status bar display.
   * Shows relative time (e.g., "in 2h 30m") for nearby times,
   * and absolute time for more distant ones.
   */
  private formatNextRunTime(nextRun: Date): string {
    const now = new Date();
    const diffMs = nextRun.getTime() - now.getTime();

    if (diffMs < 0) {
      return 'now';
    }

    const diffMinutes = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMinutes / 60);
    const remainingMinutes = diffMinutes % 60;

    if (diffHours === 0) {
      return `in ${diffMinutes}m`;
    }

    if (diffHours < 24) {
      return remainingMinutes > 0
        ? `in ${diffHours}h ${remainingMinutes}m`
        : `in ${diffHours}h`;
    }

    // For times more than 24 hours away, show the date/time
    return nextRun.toLocaleDateString(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Get whether the schedule is currently active and running checks.
   */
  get isActive(): boolean {
    return this.isScheduleActive;
  }

  /**
   * Get whether a scheduled run is currently in progress.
   */
  get isRunning(): boolean {
    return this.isScheduledRunInProgress;
  }

  /**
   * Get the next scheduled run time, if computed.
   */
  get nextRun(): Date | undefined {
    return this.nextRunTime;
  }

  /**
   * Get the total number of scheduled runs executed.
   */
  get totalRuns(): number {
    return this.runCount;
  }

  /**
   * Manually trigger a schedule check. Used by unit tests to avoid
   * fake timer issues with async setInterval callbacks.
   *
   * @internal Test-only method. Do not call in production code.
   */
  async _testTick(): Promise<void> {
    await this.checkAndRun();
  }

  /**
   * Dispose all resources: stop the timer, hide the status bar, dispose listeners.
   */
  dispose(): void {
    this.logger.debug(CLASS_NAME, 'dispose', 'Disposing ScheduleRunnerService');
    this.stop();

    for (const disposable of this.disposables) {
      try {
        disposable.dispose();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(CLASS_NAME, 'dispose', `Error disposing resource: ${message}`);
      }
    }
    this.disposables.length = 0;

    this.logger.debug(CLASS_NAME, 'dispose', 'ScheduleRunnerService disposed');
  }
}
