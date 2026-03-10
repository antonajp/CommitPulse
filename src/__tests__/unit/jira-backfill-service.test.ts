import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  JiraBackfillService,
  type JiraBackfillResult,
} from '../../services/jira-backfill-service.js';
import type { LoadProjectIssuesResult } from '../../services/jira-service.js';

/**
 * Unit tests for JiraBackfillService.
 *
 * Tests:
 *   - Successful backfill flow (clear + reload)
 *   - Credential validation failure
 *   - Cancellation at various stages
 *   - No project keys configured
 *   - Single and multiple project loading
 *   - Progress reporting
 *   - Error handling
 *
 * Ticket: IQS-933
 */

// Mock JiraRepository
function createMockJiraRepo() {
  return {
    clearAllJiraData: vi.fn(),
    getJiraDetailCount: vi.fn(),
  };
}

// Mock PipelineRepository
function createMockPipelineRepo() {
  return {
    insertPipelineStart: vi.fn().mockResolvedValue(1),
    updatePipelineRun: vi.fn().mockResolvedValue(undefined),
    insertPipelineLog: vi.fn().mockResolvedValue(undefined),
    logTableCounts: vi.fn().mockResolvedValue(undefined),
  };
}

// Mock JiraService
function createMockJiraService() {
  return {
    loadProjectIssues: vi.fn(),
  };
}

// Mock progress reporter
function createMockProgress() {
  return {
    report: vi.fn(),
  };
}

// Mock cancellation token
function createMockToken(cancelled = false) {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(),
  };
}

// Helper to create a successful load result
function createLoadResult(projectKey: string, inserted: number, failed = 0): LoadProjectIssuesResult {
  return {
    projectKey,
    issuesInserted: inserted,
    issuesSkipped: 0,
    linksInserted: inserted,
    parentsInserted: Math.floor(inserted / 2),
    issuesFailed: failed,
    durationMs: 1000,
  };
}

describe('JiraBackfillService', () => {
  let jiraRepo: ReturnType<typeof createMockJiraRepo>;
  let pipelineRepo: ReturnType<typeof createMockPipelineRepo>;
  let jiraService: ReturnType<typeof createMockJiraService>;
  let service: JiraBackfillService;

  beforeEach(() => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    jiraRepo = createMockJiraRepo();
    pipelineRepo = createMockPipelineRepo();
    jiraService = createMockJiraService();
  });

  // --------------------------------------------------------------------------
  // Successful flow tests
  // --------------------------------------------------------------------------

  it('should successfully clear and reload Jira data for a single project', async () => {
    const projectKeys = ['PROJ'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    jiraService.loadProjectIssues
      .mockResolvedValueOnce(createLoadResult('PROJ', 50)) // First call is credential validation
      .mockResolvedValueOnce(createLoadResult('PROJ', 100)); // Second call is actual reload
    jiraRepo.clearAllJiraData.mockResolvedValue({ countBefore: 50 });

    const progress = createMockProgress();
    const token = createMockToken(false);

    const result = await service.runBackfill(
      progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
      token as unknown as import('vscode').CancellationToken,
    );

    expect(result.issuesClearedBefore).toBe(50);
    expect(result.issuesLoaded).toBe(100);
    expect(result.issuesFailed).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(result.projectResults.length).toBe(1);

    // Verify clearAllJiraData was called
    expect(jiraRepo.clearAllJiraData).toHaveBeenCalledTimes(1);

    // Verify loadProjectIssues was called twice (validation + reload)
    expect(jiraService.loadProjectIssues).toHaveBeenCalledTimes(2);
    expect(jiraService.loadProjectIssues).toHaveBeenCalledWith('PROJ', { startKey: 1, maxKeys: 1 });
    expect(jiraService.loadProjectIssues).toHaveBeenCalledWith('PROJ', { startKey: 0, maxKeys: 0 });

    // Verify pipeline tracking
    expect(pipelineRepo.insertPipelineStart).toHaveBeenCalledTimes(1);
    expect(pipelineRepo.updatePipelineRun).toHaveBeenCalledWith(1, 'FINISHED');
  });

  it('should load multiple projects in sequence', async () => {
    const projectKeys = ['PROJ', 'CRM', 'ENG'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    jiraService.loadProjectIssues
      .mockResolvedValueOnce(createLoadResult('PROJ', 1)) // Validation
      .mockResolvedValueOnce(createLoadResult('PROJ', 100))
      .mockResolvedValueOnce(createLoadResult('CRM', 200))
      .mockResolvedValueOnce(createLoadResult('ENG', 50));
    jiraRepo.clearAllJiraData.mockResolvedValue({ countBefore: 100 });

    const progress = createMockProgress();
    const token = createMockToken(false);

    const result = await service.runBackfill(
      progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
      token as unknown as import('vscode').CancellationToken,
    );

    expect(result.issuesLoaded).toBe(350); // 100 + 200 + 50
    expect(result.projectResults.length).toBe(3);
    expect(jiraService.loadProjectIssues).toHaveBeenCalledTimes(4); // 1 validation + 3 projects
  });

  // --------------------------------------------------------------------------
  // Credential validation tests
  // --------------------------------------------------------------------------

  it('should fail if credential validation fails', async () => {
    const projectKeys = ['PROJ'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    // Simulate 401 Unauthorized during validation
    jiraService.loadProjectIssues.mockRejectedValueOnce(new Error('401 Unauthorized'));

    const progress = createMockProgress();
    const token = createMockToken(false);

    await expect(
      service.runBackfill(
        progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
        token as unknown as import('vscode').CancellationToken,
      ),
    ).rejects.toThrow('Jira credential validation failed');

    // Should NOT clear data if validation fails
    expect(jiraRepo.clearAllJiraData).not.toHaveBeenCalled();

    // Pipeline should be marked as error
    expect(pipelineRepo.updatePipelineRun).toHaveBeenCalledWith(1, 'ERROR: Credential validation failed');
  });

  it('should fail validation if no project keys are configured', async () => {
    const projectKeys: string[] = [];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    const progress = createMockProgress();
    const token = createMockToken(false);

    await expect(
      service.runBackfill(
        progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
        token as unknown as import('vscode').CancellationToken,
      ),
    ).rejects.toThrow('Jira credential validation failed');

    // Should NOT clear data if no projects
    expect(jiraRepo.clearAllJiraData).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Cancellation tests
  // --------------------------------------------------------------------------

  it('should return cancelled result if cancelled before validation', async () => {
    const projectKeys = ['PROJ'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    const progress = createMockProgress();
    const token = createMockToken(true); // Already cancelled

    const result = await service.runBackfill(
      progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
      token as unknown as import('vscode').CancellationToken,
    );

    expect(result.cancelled).toBe(true);
    expect(result.issuesLoaded).toBe(0);
    expect(jiraRepo.clearAllJiraData).not.toHaveBeenCalled();
    expect(jiraService.loadProjectIssues).not.toHaveBeenCalled();
    expect(pipelineRepo.updatePipelineRun).toHaveBeenCalledWith(1, 'CANCELLED');
  });

  it('should return cancelled result if cancelled after validation', async () => {
    const projectKeys = ['PROJ'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    jiraService.loadProjectIssues.mockResolvedValueOnce(createLoadResult('PROJ', 1));

    // Cancel after validation check
    let checkCount = 0;
    const token = {
      get isCancellationRequested() {
        checkCount++;
        return checkCount > 1; // Cancel after first check
      },
      onCancellationRequested: vi.fn(),
    };

    const progress = createMockProgress();

    const result = await service.runBackfill(
      progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
      token as unknown as import('vscode').CancellationToken,
    );

    expect(result.cancelled).toBe(true);
    expect(jiraRepo.clearAllJiraData).not.toHaveBeenCalled();
    expect(pipelineRepo.updatePipelineRun).toHaveBeenCalledWith(1, 'CANCELLED');
  });

  // --------------------------------------------------------------------------
  // Progress reporting tests
  // --------------------------------------------------------------------------

  it('should report progress at each stage', async () => {
    const projectKeys = ['PROJ', 'CRM'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    jiraService.loadProjectIssues
      .mockResolvedValueOnce(createLoadResult('PROJ', 1)) // Validation
      .mockResolvedValueOnce(createLoadResult('PROJ', 50))
      .mockResolvedValueOnce(createLoadResult('CRM', 30));
    jiraRepo.clearAllJiraData.mockResolvedValue({ countBefore: 25 });

    const messages: string[] = [];
    const progress = {
      report: vi.fn((msg: { message?: string }) => {
        if (msg.message) messages.push(msg.message);
      }),
    };
    const token = createMockToken(false);

    await service.runBackfill(
      progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
      token as unknown as import('vscode').CancellationToken,
    );

    expect(messages).toContain('Validating Jira credentials...');
    expect(messages).toContain('Clearing Jira tables...');
    expect(messages.some(m => m.includes('Loading PROJ'))).toBe(true);
    expect(messages.some(m => m.includes('Loading CRM'))).toBe(true);
    expect(messages).toContain('Backfill complete!');
  });

  // --------------------------------------------------------------------------
  // Error handling tests
  // --------------------------------------------------------------------------

  it('should handle and report load failures gracefully', async () => {
    const projectKeys = ['PROJ'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    jiraService.loadProjectIssues
      .mockResolvedValueOnce(createLoadResult('PROJ', 1)) // Validation
      .mockResolvedValueOnce(createLoadResult('PROJ', 80, 5)); // 5 failures
    jiraRepo.clearAllJiraData.mockResolvedValue({ countBefore: 100 });

    const progress = createMockProgress();
    const token = createMockToken(false);

    const result = await service.runBackfill(
      progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
      token as unknown as import('vscode').CancellationToken,
    );

    expect(result.issuesLoaded).toBe(80);
    expect(result.issuesFailed).toBe(5);
    expect(result.cancelled).toBe(false);
  });

  it('should track durationMs correctly', async () => {
    const projectKeys = ['PROJ'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    jiraService.loadProjectIssues
      .mockResolvedValueOnce(createLoadResult('PROJ', 1))
      .mockResolvedValueOnce(createLoadResult('PROJ', 10));
    jiraRepo.clearAllJiraData.mockResolvedValue({ countBefore: 5 });

    const progress = createMockProgress();
    const token = createMockToken(false);

    const result = await service.runBackfill(
      progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
      token as unknown as import('vscode').CancellationToken,
    );

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle clearAllJiraData failure', async () => {
    const projectKeys = ['PROJ'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    jiraService.loadProjectIssues.mockResolvedValueOnce(createLoadResult('PROJ', 1)); // Validation
    jiraRepo.clearAllJiraData.mockRejectedValueOnce(new Error('TRUNCATE failed: permission denied'));

    const progress = createMockProgress();
    const token = createMockToken(false);

    await expect(
      service.runBackfill(
        progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
        token as unknown as import('vscode').CancellationToken,
      ),
    ).rejects.toThrow('TRUNCATE failed: permission denied');

    expect(pipelineRepo.updatePipelineRun).toHaveBeenCalledWith(
      1,
      expect.stringContaining('ERROR: TRUNCATE failed'),
    );
  });

  // --------------------------------------------------------------------------
  // Edge case tests
  // --------------------------------------------------------------------------

  it('should handle empty result from clearAllJiraData', async () => {
    const projectKeys = ['PROJ'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    jiraService.loadProjectIssues
      .mockResolvedValueOnce(createLoadResult('PROJ', 1))
      .mockResolvedValueOnce(createLoadResult('PROJ', 0)); // No issues found
    jiraRepo.clearAllJiraData.mockResolvedValue({ countBefore: 0 }); // Already empty

    const progress = createMockProgress();
    const token = createMockToken(false);

    const result = await service.runBackfill(
      progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
      token as unknown as import('vscode').CancellationToken,
    );

    expect(result.issuesClearedBefore).toBe(0);
    expect(result.issuesLoaded).toBe(0);
    expect(result.cancelled).toBe(false);
  });

  it('should log to pipeline for each project', async () => {
    const projectKeys = ['PROJ', 'CRM'];
    service = new JiraBackfillService(
      jiraRepo as unknown as import('../../database/jira-repository.js').JiraRepository,
      pipelineRepo as unknown as import('../../database/pipeline-repository.js').PipelineRepository,
      jiraService as unknown as import('../../services/jira-service.js').JiraService,
      projectKeys,
    );

    jiraService.loadProjectIssues
      .mockResolvedValueOnce(createLoadResult('PROJ', 1))
      .mockResolvedValueOnce(createLoadResult('PROJ', 50))
      .mockResolvedValueOnce(createLoadResult('CRM', 30));
    jiraRepo.clearAllJiraData.mockResolvedValue({ countBefore: 10 });

    const progress = createMockProgress();
    const token = createMockToken(false);

    await service.runBackfill(
      progress as unknown as import('vscode').Progress<{ message?: string; increment?: number }>,
      token as unknown as import('vscode').CancellationToken,
    );

    // Should have logged: clear, PROJ result, CRM result = 3 logs
    expect(pipelineRepo.insertPipelineLog).toHaveBeenCalledTimes(3);
  });
});
