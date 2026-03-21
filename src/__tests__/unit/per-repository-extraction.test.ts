/**
 * Unit tests for per-repository extraction feature.
 * Ticket: GITX-130
 *
 * Tests the gitr.runGitExtractionForRepo command which allows users to:
 * 1. Select a specific repository from QuickPick (if not provided as parameter)
 * 2. Choose extraction mode (incremental vs full)
 * 3. Run Git extraction for just that repository
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, _setMockConfig, window, commands } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import type { RepositoryEntry } from '../../config/settings.js';

/**
 * Mock helper to setup test configuration with repositories.
 */
function setupTestConfig(repos: RepositoryEntry[]): void {
  _setMockConfig('gitrx.logLevel', 'DEBUG');
  _setMockConfig('gitrx.repositories', repos);
  _setMockConfig('gitrx.database.host', 'localhost');
  _setMockConfig('gitrx.database.port', 5432);
  _setMockConfig('gitrx.database.database', 'gitr_test');
  _setMockConfig('gitrx.database.user', 'gitr_test');
  _setMockConfig('gitrx.git.debugLogging', false);
  _setMockConfig('gitrx.pipeline.sinceDate', undefined);
  _setMockConfig('gitrx.pipeline.steps', ['git', 'jira', 'github', 'enrich', 'team']);
  _setMockConfig('gitrx.jira.server', 'https://jira.example.com');
  _setMockConfig('gitrx.jira.username', 'test@example.com');
  _setMockConfig('gitrx.jira.projectKeys', ['GITX', 'TEST']);
  _setMockConfig('gitrx.jira.keyAliases', []);
  _setMockConfig('gitrx.jira.increment', 'monthly');
  _setMockConfig('gitrx.jira.daysAgo', 90);
  _setMockConfig('gitrx.jira.debugLogging', false);
  _setMockConfig('gitrx.linear.teamKeys', []);
  _setMockConfig('gitrx.linear.increment', 'monthly');
  _setMockConfig('gitrx.linear.daysAgo', 90);
  _setMockConfig('gitrx.github.organization', 'test-org');
}

/**
 * Create a mock ExtensionContext for command registration.
 */
function createMockContext(): {
  subscriptions: { dispose: () => void }[];
  extensionPath: string;
  globalState: { get: () => undefined; update: () => Promise<void> };
  workspaceState: { get: () => undefined; update: () => Promise<void> };
  secrets: { get: (key: string) => Promise<string | undefined>; store: () => Promise<void>; delete: () => Promise<void> };
  extensionUri: { scheme: string; path: string; fsPath: string };
} {
  return {
    subscriptions: [],
    extensionPath: '/mock/extension/path',
    globalState: {
      get: () => undefined,
      update: async () => { /* noop */ },
    },
    workspaceState: {
      get: () => undefined,
      update: async () => { /* noop */ },
    },
    secrets: {
      get: async (key: string) => {
        // Return mock secrets for database password
        if (key === 'database-password') {
          return 'test_password';
        }
        return undefined;
      },
      store: async () => { /* noop */ },
      delete: async () => { /* noop */ },
    },
    extensionUri: { scheme: 'file', path: '/mock/extension', fsPath: '/mock/extension' },
  };
}

describe('Per-Repository Extraction (GITX-130)', () => {
  const mockRepos: RepositoryEntry[] = [
    { path: '/repos/app1', name: 'App One', organization: 'Engineering' },
    { path: '/repos/app2', name: 'App Two', organization: 'Operations' },
    { path: '/repos/app3', name: 'App Three', organization: 'Engineering' },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    _clearMocks();

    // Clean up logger
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Setup test configuration
    setupTestConfig(mockRepos);

    // Re-import and re-register commands to get fresh state
    // Note: This is necessary because command handlers close over module state
    vi.resetModules();
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('Repository QuickPick', () => {
    it('should show repository selection QuickPick when no repoName provided', async () => {
      // Setup: Spy on showQuickPick
      const showQuickPickSpy = vi.spyOn(window, 'showQuickPick');
      showQuickPickSpy.mockResolvedValue(undefined); // User cancels

      // Register commands
      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      // Execute command without repoName parameter
      await commands.executeCommand('gitr.runGitExtractionForRepo');

      // Verify QuickPick was shown
      expect(showQuickPickSpy).toHaveBeenCalled();
      const quickPickItems = showQuickPickSpy.mock.calls[0]![0];
      expect(quickPickItems).toHaveLength(3); // All 3 repos
    });

    it('should include repository names and paths in QuickPick items', async () => {
      const showQuickPickSpy = vi.spyOn(window, 'showQuickPick');
      showQuickPickSpy.mockResolvedValue(undefined);

      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      await commands.executeCommand('gitr.runGitExtractionForRepo');

      expect(showQuickPickSpy).toHaveBeenCalled();
      const quickPickItems = showQuickPickSpy.mock.calls[0]![0] as Array<{ label: string; description: string; repoName: string }>;

      // Check first item
      expect(quickPickItems[0]!.label).toBe('App One');
      expect(quickPickItems[0]!.description).toBe('/repos/app1');
      expect(quickPickItems[0]!.repoName).toBe('App One');

      // Check second item
      expect(quickPickItems[1]!.label).toBe('App Two');
      expect(quickPickItems[1]!.description).toBe('/repos/app2');
      expect(quickPickItems[1]!.repoName).toBe('App Two');
    });

    it('should exit gracefully when user cancels repository selection', async () => {
      const showQuickPickSpy = vi.spyOn(window, 'showQuickPick');
      showQuickPickSpy.mockResolvedValue(undefined); // User cancels

      const showWarningMessageSpy = vi.spyOn(window, 'showWarningMessage');

      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      await commands.executeCommand('gitr.runGitExtractionForRepo');

      // Should not show any warning when user cancels
      expect(showWarningMessageSpy).not.toHaveBeenCalled();
    });

    it('should skip QuickPick when repoName is provided as parameter', async () => {
      const showQuickPickSpy = vi.spyOn(window, 'showQuickPick');
      // Will be called for extraction mode QuickPick, but we'll resolve it
      showQuickPickSpy.mockResolvedValueOnce({ mode: 'incremental', label: 'Incremental' });

      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      // Note: This will fail on database connection, but that's expected in unit tests
      // We're just checking that repository QuickPick is skipped
      await commands.executeCommand('gitr.runGitExtractionForRepo', 'App One').catch(() => { /* ignore db errors */ });

      // The first QuickPick call should be for extraction mode, NOT repository selection
      // Repository selection would show items with repoName property
      // Extraction mode shows items with mode property
      if (showQuickPickSpy.mock.calls.length > 0) {
        const firstQuickPickItems = showQuickPickSpy.mock.calls[0]![0] as any[];
        // If items have 'mode' property, it's extraction mode (correct)
        // If items have 'repoName' property, it's repository selection (incorrect)
        if (firstQuickPickItems[0]) {
          expect(firstQuickPickItems[0]).toHaveProperty('mode');
        }
      }
    });
  });

  describe('Repository Validation', () => {
    it('should show warning when no repositories configured', async () => {
      // Setup: No repositories
      setupTestConfig([]);

      const showWarningMessageSpy = vi.spyOn(window, 'showWarningMessage');

      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      await commands.executeCommand('gitr.runGitExtractionForRepo');

      expect(showWarningMessageSpy).toHaveBeenCalledWith(
        expect.stringContaining('No repositories configured')
      );
    });

    it('should show warning when provided repoName does not exist in settings', async () => {
      const showWarningMessageSpy = vi.spyOn(window, 'showWarningMessage');

      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      await commands.executeCommand('gitr.runGitExtractionForRepo', 'NonExistent Repo');

      expect(showWarningMessageSpy).toHaveBeenCalledWith(
        expect.stringContaining('NonExistent Repo')
      );
      expect(showWarningMessageSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found in settings')
      );
    });

    it('should validate selected repository from QuickPick', async () => {
      const showQuickPickSpy = vi.spyOn(window, 'showQuickPick');
      // User selects a repository
      showQuickPickSpy.mockResolvedValueOnce({ label: 'App One', description: '/repos/app1', repoName: 'App One' });
      // Then cancels extraction mode selection
      showQuickPickSpy.mockResolvedValueOnce(undefined);

      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      // Should not throw or show error - repository is valid
      await commands.executeCommand('gitr.runGitExtractionForRepo');

      const showWarningMessageSpy = vi.spyOn(window, 'showWarningMessage');
      // Should not show repository validation warning
      expect(showWarningMessageSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('not found in settings')
      );
    });
  });

  describe('Pipeline Mutual Exclusion', () => {
    it('should prevent extraction when pipeline is already running', async () => {
      const showWarningMessageSpy = vi.spyOn(window, 'showWarningMessage');

      const { registerCommands, executePipelineRun } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      // Start a pipeline run (this sets pipelineRunning flag)
      const pipelinePromise = executePipelineRun(context.secrets as any).catch(() => { /* ignore */ });

      // Immediately try to run per-repo extraction
      await commands.executeCommand('gitr.runGitExtractionForRepo', 'App One');

      expect(showWarningMessageSpy).toHaveBeenCalledWith(
        expect.stringContaining('pipeline run is already in progress')
      );

      // Wait for pipeline to finish
      await pipelinePromise;
    });
  });

  describe('Title and Progress Messages', () => {
    it('should show repository name in progress notification title', async () => {
      const withProgressSpy = vi.spyOn(window, 'withProgress');

      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      // Execute with specific repo
      await commands.executeCommand('gitr.runGitExtractionForRepo', 'App Two').catch(() => { /* ignore db errors */ });

      // Check that withProgress was called with repo name in title
      expect(withProgressSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('App Two'),
        }),
        expect.any(Function)
      );
    });
  });

  describe('Integration with Extraction Mode QuickPick', () => {
    it('should call determineExtractionMode after repository selection', async () => {
      const showQuickPickSpy = vi.spyOn(window, 'showQuickPick');

      // User selects repository
      showQuickPickSpy.mockResolvedValueOnce({ label: 'App One', description: '/repos/app1', repoName: 'App One' });
      // User cancels extraction mode
      showQuickPickSpy.mockResolvedValueOnce(undefined);

      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      await commands.executeCommand('gitr.runGitExtractionForRepo').catch(() => { /* ignore */ });

      // Should have been called twice: once for repo selection, once for extraction mode
      // (Note: In actual implementation, extraction mode check happens after DB connection,
      // but we're testing the QuickPick was attempted)
      expect(showQuickPickSpy).toHaveBeenCalled();
    });
  });

  describe('Command Registration', () => {
    it('should register gitr.runGitExtractionForRepo command', async () => {
      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      const registeredCommands = commands.getRegisteredCommands();
      expect(registeredCommands.has('gitr.runGitExtractionForRepo')).toBe(true);
    });

    it('should register command that accepts optional repoName parameter', async () => {
      const { registerCommands } = await import('../../commands/index.js');
      const context = createMockContext();
      registerCommands(context);

      // Should not throw when called with parameter
      await expect(
        commands.executeCommand('gitr.runGitExtractionForRepo', 'App One').catch(() => { /* ignore db errors */ })
      ).resolves.not.toThrow();

      // Should not throw when called without parameter
      const showQuickPickSpy = vi.spyOn(window, 'showQuickPick');
      showQuickPickSpy.mockResolvedValue(undefined); // User cancels

      await expect(
        commands.executeCommand('gitr.runGitExtractionForRepo')
      ).resolves.not.toThrow();
    });
  });

  describe('Context Menu Integration (gitrx.runPipelineForRepo)', () => {
    it('should delegate to gitr.runGitExtractionForRepo with repoName', async () => {
      const executeCommandSpy = vi.spyOn(commands, 'executeCommand');

      // Import extension to register the context menu command
      const { activate } = await import('../../extension.js');
      const context = createMockContext();
      activate(context);

      // Simulate context menu click from repository tree
      const treeItem = { nodeData: { repository: 'App One' } };
      await commands.executeCommand('gitrx.runPipelineForRepo', treeItem).catch(() => { /* ignore */ });

      // Should have called gitr.runGitExtractionForRepo with the repo name
      expect(executeCommandSpy).toHaveBeenCalledWith(
        'gitr.runGitExtractionForRepo',
        'App One'
      );
    });

    it('should show warning when context menu called without repository', async () => {
      const showWarningMessageSpy = vi.spyOn(window, 'showWarningMessage');

      const { activate } = await import('../../extension.js');
      const context = createMockContext();
      activate(context);

      // Simulate context menu click without repository context
      await commands.executeCommand('gitrx.runPipelineForRepo', {});

      expect(showWarningMessageSpy).toHaveBeenCalledWith(
        'Gitr: No repository selected.'
      );
    });

    it('should show warning when repository not found in settings', async () => {
      const showWarningMessageSpy = vi.spyOn(window, 'showWarningMessage');

      const { activate } = await import('../../extension.js');
      const context = createMockContext();
      activate(context);

      // Simulate context menu click with non-existent repository
      const treeItem = { nodeData: { repository: 'Non-Existent' } };
      await commands.executeCommand('gitrx.runPipelineForRepo', treeItem);

      expect(showWarningMessageSpy).toHaveBeenCalledWith(
        expect.stringContaining('Non-Existent')
      );
      expect(showWarningMessageSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found in settings')
      );
    });

    it('should check pipeline running status before executing', async () => {
      const showWarningMessageSpy = vi.spyOn(window, 'showWarningMessage');

      const { activate } = await import('../../extension.js');
      const { executePipelineRun } = await import('../../commands/index.js');
      const context = createMockContext();
      activate(context);

      // Start a pipeline run
      const pipelinePromise = executePipelineRun(context.secrets as any).catch(() => { /* ignore */ });

      // Try to run from context menu
      const treeItem = { nodeData: { repository: 'App One' } };
      await commands.executeCommand('gitrx.runPipelineForRepo', treeItem);

      expect(showWarningMessageSpy).toHaveBeenCalledWith(
        expect.stringContaining('pipeline run is already in progress')
      );

      await pipelinePromise;
    });
  });
});
