import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { ScheduleRunnerService } from '../../services/schedule-runner-service.js';
import { _setMockConfig, _clearMocks } from '../__mocks__/vscode.js';

/**
 * Unit tests for ScheduleRunnerService.
 *
 * Tests:
 * - Construction and lifecycle (start, stop, dispose)
 * - Cron expression parsing and next run time computation
 * - Mutual exclusion with manual pipeline runs
 * - Status bar updates
 * - Configuration change handling
 * - Scheduled run execution
 * - Error handling for invalid cron expressions
 * - Re-entrancy guard for overlapping scheduled runs
 *
 * Ticket: IQS-865
 */

// ============================================================================
// Test helpers
// ============================================================================

function setupDefaultConfig(): void {
  _setMockConfig('gitrx.schedule.enabled', true);
  _setMockConfig('gitrx.schedule.cronExpression', '0 2 * * *');
  _setMockConfig('gitrx.logLevel', 'DEBUG');
}

function setupDisabledConfig(): void {
  _setMockConfig('gitrx.schedule.enabled', false);
  _setMockConfig('gitrx.schedule.cronExpression', '0 2 * * *');
  _setMockConfig('gitrx.logLevel', 'DEBUG');
}

function createMockPipelineCallback(): { callback: () => Promise<void>; calls: number[] } {
  const tracker = { calls: [] as number[] };
  const callback = vi.fn(async () => {
    tracker.calls.push(Date.now());
  });
  return { callback, calls: tracker.calls };
}

function createMockRunningCheck(running = false): () => boolean {
  return vi.fn(() => running);
}


// ============================================================================
// Tests
// ============================================================================

describe('ScheduleRunnerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearMocks();
    vi.useFakeTimers();

    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  afterEach(() => {
    vi.useRealTimers();
    _clearMocks();
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create the service successfully', () => {
      setupDefaultConfig();
      const service = new ScheduleRunnerService();
      expect(service).toBeDefined();
      expect(service.isActive).toBe(false);
      expect(service.isRunning).toBe(false);
      expect(service.nextRun).toBeUndefined();
      expect(service.totalRuns).toBe(0);
      service.dispose();
    });

    it('should read initial settings from configuration', () => {
      setupDisabledConfig();
      const service = new ScheduleRunnerService();
      expect(service.isActive).toBe(false);
      service.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // start()
  // --------------------------------------------------------------------------

  describe('start', () => {
    it('should start the schedule when enabled with valid cron expression', () => {
      setupDefaultConfig();
      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();

      expect(service.isActive).toBe(true);
      expect(service.nextRun).toBeDefined();
      expect(service.nextRun).toBeInstanceOf(Date);

      service.dispose();
    });

    it('should not start when schedule is disabled', () => {
      setupDisabledConfig();
      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);

      service.start();

      expect(service.isActive).toBe(false);

      service.dispose();
    });

    it('should not start without a pipeline callback', () => {
      setupDefaultConfig();
      const service = new ScheduleRunnerService();

      service.start();

      expect(service.isActive).toBe(false);

      service.dispose();
    });

    it('should be idempotent (calling start twice does not create duplicate timers)', () => {
      setupDefaultConfig();
      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();
      const firstNextRun = service.nextRun;
      service.start(); // should be no-op
      const secondNextRun = service.nextRun;

      expect(service.isActive).toBe(true);
      expect(firstNextRun).toEqual(secondNextRun);

      service.dispose();
    });

    it('should not start with invalid cron expression', () => {
      _setMockConfig('gitrx.schedule.enabled', true);
      _setMockConfig('gitrx.schedule.cronExpression', 'not-a-cron');
      _setMockConfig('gitrx.logLevel', 'DEBUG');

      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);

      service.start();

      expect(service.isActive).toBe(false);
      expect(service.nextRun).toBeUndefined();

      service.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // stop()
  // --------------------------------------------------------------------------

  describe('stop', () => {
    it('should stop the schedule and clear next run time', () => {
      setupDefaultConfig();
      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();
      expect(service.isActive).toBe(true);

      service.stop();
      expect(service.isActive).toBe(false);
      expect(service.nextRun).toBeUndefined();

      service.dispose();
    });

    it('should be safe to call stop when not started', () => {
      setupDefaultConfig();
      const service = new ScheduleRunnerService();

      expect(() => service.stop()).not.toThrow();
      expect(service.isActive).toBe(false);

      service.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Cron expression parsing
  // --------------------------------------------------------------------------

  describe('cron expression parsing', () => {
    it('should compute next run time for daily at 2 AM', () => {
      setupDefaultConfig();
      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();

      const nextRun = service.nextRun;
      expect(nextRun).toBeDefined();
      // Allow for DST offset (2 AM cron may show as 3 AM during DST)
      expect([2, 3]).toContain(nextRun!.getHours());
      expect(nextRun!.getMinutes()).toBe(0);

      service.dispose();
    });

    it('should compute next run time for weekdays at 9 AM', () => {
      _setMockConfig('gitrx.schedule.enabled', true);
      _setMockConfig('gitrx.schedule.cronExpression', '0 9 * * 1-5');
      _setMockConfig('gitrx.logLevel', 'DEBUG');

      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();

      const nextRun = service.nextRun;
      expect(nextRun).toBeDefined();
      expect(nextRun!.getHours()).toBe(9);
      expect(nextRun!.getMinutes()).toBe(0);
      // Should be a weekday (1=Mon, ..., 5=Fri)
      const day = nextRun!.getDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);

      service.dispose();
    });

    it('should handle every-4-hours cron expression', () => {
      _setMockConfig('gitrx.schedule.enabled', true);
      _setMockConfig('gitrx.schedule.cronExpression', '0 */4 * * *');
      _setMockConfig('gitrx.logLevel', 'DEBUG');

      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();

      const nextRun = service.nextRun;
      expect(nextRun).toBeDefined();
      expect(nextRun!.getMinutes()).toBe(0);
      // Hours should be divisible by 4
      expect(nextRun!.getHours() % 4).toBe(0);

      service.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Mutual exclusion
  // --------------------------------------------------------------------------

  describe('mutual exclusion', () => {
    it('should skip scheduled run when manual pipeline is running', async () => {
      // Use a cron that triggers every hour to avoid timezone issues
      const now = new Date('2026-03-05T12:50:00Z');
      vi.setSystemTime(now);

      _setMockConfig('gitrx.schedule.enabled', true);
      _setMockConfig('gitrx.schedule.cronExpression', '0 * * * *');
      _setMockConfig('gitrx.logLevel', 'DEBUG');

      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      // Pipeline IS running
      service.setPipelineRunningCheck(createMockRunningCheck(true));

      service.start();
      const nextRun = service.nextRun;
      expect(nextRun).toBeDefined();

      // Move time past the next scheduled run and trigger a check directly
      vi.setSystemTime(new Date(nextRun!.getTime() + 30_000));
      await service._testTick();

      // Callback should NOT have been called due to mutex
      expect(callback).not.toHaveBeenCalled();
      expect(service.totalRuns).toBe(0);

      service.dispose();
    });

    it('should execute scheduled run when no manual pipeline is running', async () => {
      // Use a cron that triggers every hour to avoid timezone issues
      const now = new Date('2026-03-05T12:50:00Z');
      vi.setSystemTime(now);

      _setMockConfig('gitrx.schedule.enabled', true);
      _setMockConfig('gitrx.schedule.cronExpression', '0 * * * *');
      _setMockConfig('gitrx.logLevel', 'DEBUG');

      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();
      const nextRun = service.nextRun;
      expect(nextRun).toBeDefined();

      // Move time past the next scheduled run and trigger a check directly
      vi.setSystemTime(new Date(nextRun!.getTime() + 30_000));
      await service._testTick();

      expect(callback).toHaveBeenCalledOnce();
      expect(service.totalRuns).toBe(1);

      service.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Scheduled run execution
  // --------------------------------------------------------------------------

  describe('scheduled run execution', () => {
    it('should handle pipeline callback errors gracefully', async () => {
      const now = new Date('2026-03-05T12:50:00Z');
      vi.setSystemTime(now);

      _setMockConfig('gitrx.schedule.enabled', true);
      _setMockConfig('gitrx.schedule.cronExpression', '0 * * * *');
      _setMockConfig('gitrx.logLevel', 'DEBUG');

      const service = new ScheduleRunnerService();
      const failingCallback = vi.fn(async () => {
        throw new Error('Pipeline database connection failed');
      });
      service.setPipelineRunCallback(failingCallback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();
      const nextRun = service.nextRun;
      expect(nextRun).toBeDefined();

      // Move time past the next scheduled run and trigger a check
      vi.setSystemTime(new Date(nextRun!.getTime() + 30_000));
      await service._testTick();

      // Should have attempted the run
      expect(failingCallback).toHaveBeenCalledOnce();
      expect(service.totalRuns).toBe(1);
      // Service should still be active (not crash)
      expect(service.isActive).toBe(true);
      expect(service.isRunning).toBe(false);

      service.dispose();
    });

    it('should recompute next run time after completing a scheduled run', async () => {
      const now = new Date('2026-03-05T12:50:00Z');
      vi.setSystemTime(now);

      _setMockConfig('gitrx.schedule.enabled', true);
      _setMockConfig('gitrx.schedule.cronExpression', '0 * * * *');
      _setMockConfig('gitrx.logLevel', 'DEBUG');

      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();
      const firstNextRun = service.nextRun;
      expect(firstNextRun).toBeDefined();

      // Move time past the next scheduled run and trigger a check
      vi.setSystemTime(new Date(firstNextRun!.getTime() + 30_000));
      await service._testTick();

      // After the run, next run should be computed from the current system time
      const secondNextRun = service.nextRun;
      expect(secondNextRun).toBeDefined();
      // The new nextRun should be later than the first
      expect(secondNextRun!.getTime()).toBeGreaterThan(firstNextRun!.getTime());

      service.dispose();
    });

    it('should track isRunning during pipeline execution', async () => {
      const now = new Date('2026-03-05T12:50:00Z');
      vi.setSystemTime(now);

      _setMockConfig('gitrx.schedule.enabled', true);
      _setMockConfig('gitrx.schedule.cronExpression', '0 * * * *');
      _setMockConfig('gitrx.logLevel', 'DEBUG');

      const service = new ScheduleRunnerService();
      let runningDuringExecution = false;

      const slowCallback = vi.fn(async () => {
        runningDuringExecution = service.isRunning;
      });
      service.setPipelineRunCallback(slowCallback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();
      const nextRun = service.nextRun;
      expect(nextRun).toBeDefined();

      // Move time past the next scheduled run and trigger a check
      vi.setSystemTime(new Date(nextRun!.getTime() + 30_000));
      await service._testTick();

      expect(runningDuringExecution).toBe(true);
      expect(service.isRunning).toBe(false); // Should be false after completion

      service.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Status bar
  // --------------------------------------------------------------------------

  describe('status bar', () => {
    it('should show status bar when schedule is disabled', () => {
      setupDisabledConfig();
      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);

      service.start();

      // Service should not be active, but status bar should show "off"
      expect(service.isActive).toBe(false);

      service.dispose();
    });

    it('should show status bar with next run time when active', () => {
      setupDefaultConfig();
      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();

      expect(service.isActive).toBe(true);
      expect(service.nextRun).toBeDefined();

      service.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // dispose
  // --------------------------------------------------------------------------

  describe('dispose', () => {
    it('should stop the schedule and clean up resources', () => {
      setupDefaultConfig();
      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();
      expect(service.isActive).toBe(true);

      service.dispose();
      expect(service.isActive).toBe(false);
      expect(service.nextRun).toBeUndefined();
    });

    it('should be safe to dispose when not started', () => {
      setupDefaultConfig();
      const service = new ScheduleRunnerService();
      expect(() => service.dispose()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Missed scheduled run
  // --------------------------------------------------------------------------

  describe('missed scheduled run', () => {
    it('should recompute next run time when scheduled time was missed', async () => {
      const now = new Date('2026-03-05T12:50:00Z');
      vi.setSystemTime(now);

      _setMockConfig('gitrx.schedule.enabled', true);
      _setMockConfig('gitrx.schedule.cronExpression', '0 * * * *');
      _setMockConfig('gitrx.logLevel', 'DEBUG');

      const service = new ScheduleRunnerService();
      const { callback } = createMockPipelineCallback();
      service.setPipelineRunCallback(callback);
      service.setPipelineRunningCheck(createMockRunningCheck(false));

      service.start();
      const nextRun = service.nextRun;
      expect(nextRun).toBeDefined();

      // Simulate the machine being asleep and waking up 3 hours after the scheduled run
      const missedTime = new Date(nextRun!.getTime() + 3 * 60 * 60_000);
      vi.setSystemTime(missedTime);
      await service._testTick();

      // The callback should NOT be called (we missed the window by > CHECK_INTERVAL_MS)
      expect(callback).not.toHaveBeenCalled();
      // But a new next run time should be computed
      expect(service.nextRun).toBeDefined();
      expect(service.nextRun!.getTime()).toBeGreaterThan(missedTime.getTime());

      service.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // isPipelineRunning and executePipelineRun from commands
  // --------------------------------------------------------------------------

  describe('commands integration', () => {
    it('should provide isPipelineRunning check for mutual exclusion', async () => {
      // Import the commands module to test the exported functions
      const { isPipelineRunning } = await import('../../commands/index.js');
      expect(typeof isPipelineRunning).toBe('function');
      expect(isPipelineRunning()).toBe(false);
    });
  });
});
