import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  StoryPointsBackfillService,
  type StoryPointsBackfillResult,
  type JiraBackfillRow,
  type LinearBackfillRow,
} from '../../services/story-points-backfill-service.js';

/**
 * Unit tests for StoryPointsBackfillService.
 *
 * Tests edge cases: no issues, Jira-only, Linear-only, mixed,
 * null dates, negative durations, cancellation, idempotency,
 * DB errors, very long durations, and partial results.
 *
 * Ticket: IQS-884
 */

// Mock JiraRepository
function createMockJiraRepo() {
  return {
    getIssuesNeedingStoryPointsBackfill: vi.fn(),
    updateCalculatedStoryPoints: vi.fn(),
  };
}

// Mock LinearRepository
function createMockLinearRepo() {
  return {
    getIssuesNeedingStoryPointsBackfill: vi.fn(),
    updateCalculatedStoryPoints: vi.fn(),
  };
}

/**
 * Helper to create a date at a specific offset from a base date.
 */
function daysOffset(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

const BASE_DATE = new Date('2025-01-01T00:00:00Z');

describe('StoryPointsBackfillService', () => {
  let jiraRepo: ReturnType<typeof createMockJiraRepo>;
  let linearRepo: ReturnType<typeof createMockLinearRepo>;
  let service: StoryPointsBackfillService;

  beforeEach(() => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    jiraRepo = createMockJiraRepo();
    linearRepo = createMockLinearRepo();
    service = new StoryPointsBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      linearRepo as unknown as import('../../database/linear-repository.js').LinearRepository,
    );
  });

  it('should return early when no issues need backfill', async () => {
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);

    const result = await service.runBackfill();

    expect(result.totalIssues).toBe(0);
    expect(result.jiraUpdated).toBe(0);
    expect(result.linearUpdated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(jiraRepo.updateCalculatedStoryPoints).not.toHaveBeenCalled();
    expect(linearRepo.updateCalculatedStoryPoints).not.toHaveBeenCalled();
  });

  it('should process Jira issues and calculate correct story points', async () => {
    const jiraRows: JiraBackfillRow[] = [
      { jira_key: 'PROJ-1', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 0) },  // 0d -> 1pt
      { jira_key: 'PROJ-2', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 3) },  // 3d -> 3pt
      { jira_key: 'PROJ-3', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 10) }, // 10d -> 8pt
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(jiraRows);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);
    jiraRepo.updateCalculatedStoryPoints.mockResolvedValue(undefined);

    const result = await service.runBackfill();

    expect(result.totalIssues).toBe(3);
    expect(result.jiraUpdated).toBe(3);
    expect(result.linearUpdated).toBe(0);
    expect(result.skipped).toBe(0);

    expect(jiraRepo.updateCalculatedStoryPoints).toHaveBeenCalledWith('PROJ-1', 1);
    expect(jiraRepo.updateCalculatedStoryPoints).toHaveBeenCalledWith('PROJ-2', 3);
    expect(jiraRepo.updateCalculatedStoryPoints).toHaveBeenCalledWith('PROJ-3', 8);
  });

  it('should process Linear issues with COALESCE end_date', async () => {
    const linearRows: LinearBackfillRow[] = [
      { linear_key: 'ENG-1', created_date: BASE_DATE, end_date: daysOffset(BASE_DATE, 5) },  // 5d -> 5pt
      { linear_key: 'ENG-2', created_date: BASE_DATE, end_date: daysOffset(BASE_DATE, 21) }, // 21d -> 21pt
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(linearRows);
    linearRepo.updateCalculatedStoryPoints.mockResolvedValue(undefined);

    const result = await service.runBackfill();

    expect(result.totalIssues).toBe(2);
    expect(result.jiraUpdated).toBe(0);
    expect(result.linearUpdated).toBe(2);
    expect(result.skipped).toBe(0);

    expect(linearRepo.updateCalculatedStoryPoints).toHaveBeenCalledWith('ENG-1', 5);
    expect(linearRepo.updateCalculatedStoryPoints).toHaveBeenCalledWith('ENG-2', 21);
  });

  it('should process mixed Jira and Linear issues', async () => {
    const jiraRows: JiraBackfillRow[] = [
      { jira_key: 'PROJ-1', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 1) }, // 1d -> 2pt
    ];
    const linearRows: LinearBackfillRow[] = [
      { linear_key: 'ENG-1', created_date: BASE_DATE, end_date: daysOffset(BASE_DATE, 13) }, // 13d -> 13pt
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(jiraRows);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(linearRows);
    jiraRepo.updateCalculatedStoryPoints.mockResolvedValue(undefined);
    linearRepo.updateCalculatedStoryPoints.mockResolvedValue(undefined);

    const result = await service.runBackfill();

    expect(result.totalIssues).toBe(2);
    expect(result.jiraUpdated).toBe(1);
    expect(result.linearUpdated).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('should skip Jira issues with null created_date', async () => {
    const jiraRows: JiraBackfillRow[] = [
      { jira_key: 'PROJ-1', created_date: null, status_change_date: BASE_DATE },
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(jiraRows);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);

    const result = await service.runBackfill();

    expect(result.totalIssues).toBe(1);
    expect(result.jiraUpdated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(jiraRepo.updateCalculatedStoryPoints).not.toHaveBeenCalled();
  });

  it('should skip Jira issues with null status_change_date', async () => {
    const jiraRows: JiraBackfillRow[] = [
      { jira_key: 'PROJ-1', created_date: BASE_DATE, status_change_date: null },
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(jiraRows);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);

    const result = await service.runBackfill();

    expect(result.totalIssues).toBe(1);
    expect(result.jiraUpdated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should skip Linear issues with null end_date', async () => {
    const linearRows: LinearBackfillRow[] = [
      { linear_key: 'ENG-1', created_date: BASE_DATE, end_date: null },
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(linearRows);

    const result = await service.runBackfill();

    expect(result.totalIssues).toBe(1);
    expect(result.linearUpdated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should skip issues with negative duration (start > end)', async () => {
    const jiraRows: JiraBackfillRow[] = [
      { jira_key: 'PROJ-1', created_date: daysOffset(BASE_DATE, 10), status_change_date: BASE_DATE }, // -10d
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(jiraRows);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);

    const result = await service.runBackfill();

    expect(result.totalIssues).toBe(1);
    expect(result.jiraUpdated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(jiraRepo.updateCalculatedStoryPoints).not.toHaveBeenCalled();
  });

  it('should respect cancellation token', async () => {
    const jiraRows: JiraBackfillRow[] = [
      { jira_key: 'PROJ-1', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 1) },
      { jira_key: 'PROJ-2', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 2) },
      { jira_key: 'PROJ-3', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 3) },
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(jiraRows);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);

    // Already cancelled
    const token = { isCancellationRequested: true, onCancellationRequested: vi.fn() };

    const result = await service.runBackfill(
      undefined,
      token as unknown as import('vscode').CancellationToken,
    );

    // Should not process any issues
    expect(result.jiraUpdated).toBe(0);
    expect(jiraRepo.updateCalculatedStoryPoints).not.toHaveBeenCalled();
  });

  it('should handle database update failures gracefully', async () => {
    const jiraRows: JiraBackfillRow[] = [
      { jira_key: 'PROJ-1', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 1) },
      { jira_key: 'PROJ-2', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 2) },
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(jiraRows);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);

    // First update fails, second succeeds
    jiraRepo.updateCalculatedStoryPoints
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce(undefined);

    const result = await service.runBackfill();

    expect(result.totalIssues).toBe(2);
    expect(result.jiraUpdated).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('should report progress messages', async () => {
    const jiraRows: JiraBackfillRow[] = [
      { jira_key: 'PROJ-1', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 1) },
    ];
    const linearRows: LinearBackfillRow[] = [
      { linear_key: 'ENG-1', created_date: BASE_DATE, end_date: daysOffset(BASE_DATE, 5) },
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(jiraRows);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(linearRows);
    jiraRepo.updateCalculatedStoryPoints.mockResolvedValue(undefined);
    linearRepo.updateCalculatedStoryPoints.mockResolvedValue(undefined);

    const messages: string[] = [];
    const progress = {
      report: vi.fn((msg: { message?: string }) => {
        if (msg.message) messages.push(msg.message);
      }),
    };

    await service.runBackfill(progress);

    expect(messages).toContain('Jira 1/1: PROJ-1');
    expect(messages).toContain('Linear 1/1: ENG-1');
  });

  it('should handle very long durations (> 365 days) by capping at 21', async () => {
    const jiraRows: JiraBackfillRow[] = [
      { jira_key: 'PROJ-1', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 500) }, // 500d -> 21pt
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(jiraRows);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);
    jiraRepo.updateCalculatedStoryPoints.mockResolvedValue(undefined);

    const result = await service.runBackfill();

    expect(result.jiraUpdated).toBe(1);
    expect(jiraRepo.updateCalculatedStoryPoints).toHaveBeenCalledWith('PROJ-1', 21);
  });

  it('should return correct durationMs', async () => {
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue([]);

    const result = await service.runBackfill();

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should not process Linear issues if cancelled during Jira processing', async () => {
    const jiraRows: JiraBackfillRow[] = [
      { jira_key: 'PROJ-1', created_date: BASE_DATE, status_change_date: daysOffset(BASE_DATE, 1) },
    ];
    const linearRows: LinearBackfillRow[] = [
      { linear_key: 'ENG-1', created_date: BASE_DATE, end_date: daysOffset(BASE_DATE, 5) },
    ];
    jiraRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(jiraRows);
    linearRepo.getIssuesNeedingStoryPointsBackfill.mockResolvedValue(linearRows);
    jiraRepo.updateCalculatedStoryPoints.mockResolvedValue(undefined);

    // Cancel after first Jira issue is processed (simulate cancel during iteration)
    let callCount = 0;
    const token = {
      get isCancellationRequested() {
        callCount++;
        // Cancel after the first Jira issue check passes (callCount > 1)
        return callCount > 1;
      },
      onCancellationRequested: vi.fn(),
    };

    const result = await service.runBackfill(
      undefined,
      token as unknown as import('vscode').CancellationToken,
    );

    // Should have processed 1 Jira issue, 0 Linear
    expect(result.jiraUpdated).toBe(1);
    expect(result.linearUpdated).toBe(0);
    expect(linearRepo.updateCalculatedStoryPoints).not.toHaveBeenCalled();
  });
});
