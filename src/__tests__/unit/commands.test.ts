import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _clearMocks, commands } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { registerCommands } from '../../commands/index.js';
import { LoggerService } from '../../logging/logger.js';

describe('Command Registration', () => {
  beforeEach(() => {
    _clearMocks();
    // Reset logger singleton
    try {
      LoggerService.getInstance().dispose();
    } catch {
      // Ignore
    }
    LoggerService.resetInstance();
  });

  it('should register all expected commands', () => {
    const context = createMockContext();
    const disposables = registerCommands(context);

    // 5 pipeline/database commands + 1 SecretStorageService disposable + 5 secret commands = 11
    expect(disposables.length).toBe(11);

    const registeredCommands = commands.getRegisteredCommands();
    expect(registeredCommands.has('gitr.runPipeline')).toBe(true);
    expect(registeredCommands.has('gitr.runGitExtraction')).toBe(true);
    expect(registeredCommands.has('gitr.startDatabase')).toBe(true);
    expect(registeredCommands.has('gitr.stopDatabase')).toBe(true);
    expect(registeredCommands.has('gitr.resetDatabase')).toBe(true);
    expect(registeredCommands.has('gitrx.setDatabasePassword')).toBe(true);
    expect(registeredCommands.has('gitrx.setJiraToken')).toBe(true);
    expect(registeredCommands.has('gitrx.setGitHubToken')).toBe(true);
    expect(registeredCommands.has('gitrx.setLinearToken')).toBe(true);
    expect(registeredCommands.has('gitrx.setMigrationPassword')).toBe(true);

    LoggerService.getInstance().dispose();
  });

  it('should return disposables for cleanup', () => {
    const context = createMockContext();
    const disposables = registerCommands(context);

    for (const disposable of disposables) {
      expect(typeof disposable.dispose).toBe('function');
    }

    // Dispose all
    for (const disposable of disposables) {
      disposable.dispose();
    }

    LoggerService.getInstance().dispose();
  });

  it('should execute runPipeline command without error', async () => {
    const context = createMockContext();
    registerCommands(context);

    // Execute the command
    await expect(commands.executeCommand('gitr.runPipeline')).resolves.not.toThrow();

    LoggerService.getInstance().dispose();
  });

  it('should execute startDatabase command without error', async () => {
    const context = createMockContext();
    registerCommands(context);

    await expect(commands.executeCommand('gitr.startDatabase')).resolves.not.toThrow();

    LoggerService.getInstance().dispose();
  });

  it('should execute stopDatabase command without error', async () => {
    const context = createMockContext();
    registerCommands(context);

    await expect(commands.executeCommand('gitr.stopDatabase')).resolves.not.toThrow();

    LoggerService.getInstance().dispose();
  });

  it('should execute gitrx.setDatabasePassword command without error', async () => {
    const context = createMockContext();
    registerCommands(context);

    await expect(commands.executeCommand('gitrx.setDatabasePassword')).resolves.not.toThrow();

    LoggerService.getInstance().dispose();
  });

  it('should execute gitrx.setJiraToken command without error', async () => {
    const context = createMockContext();
    registerCommands(context);

    await expect(commands.executeCommand('gitrx.setJiraToken')).resolves.not.toThrow();

    LoggerService.getInstance().dispose();
  });

  it('should execute gitrx.setGitHubToken command without error', async () => {
    const context = createMockContext();
    registerCommands(context);

    await expect(commands.executeCommand('gitrx.setGitHubToken')).resolves.not.toThrow();

    LoggerService.getInstance().dispose();
  });

  it('should execute gitrx.setMigrationPassword command without error (IQS-880)', async () => {
    const context = createMockContext();
    registerCommands(context);

    await expect(commands.executeCommand('gitrx.setMigrationPassword')).resolves.not.toThrow();

    LoggerService.getInstance().dispose();
  });

  it('should execute gitr.runGitExtraction command without error (IQS-949)', async () => {
    const context = createMockContext();
    registerCommands(context);

    // Command should show warning because no repositories are configured
    await expect(commands.executeCommand('gitr.runGitExtraction')).resolves.not.toThrow();

    LoggerService.getInstance().dispose();
  });
});

describe('Settings', () => {
  beforeEach(() => {
    _clearMocks();
    try {
      LoggerService.getInstance().dispose();
    } catch {
      // Ignore
    }
    LoggerService.resetInstance();
  });

  it('should load settings without error', async () => {
    const { getSettings } = await import('../../config/settings.js');

    const settings = getSettings();

    expect(settings).toBeDefined();
    expect(settings.repositories).toEqual([]);
    expect(settings.jira.server).toBe('');
    expect(settings.schedule.enabled).toBe(false);
    expect(settings.logLevel).toBe('INFO');
    expect(settings.database.port).toBe(5433);
    expect(settings.docker.postgresVersion).toBe('16');

    LoggerService.getInstance().dispose();
  });

  it('should return frozen settings object', async () => {
    const { getSettings } = await import('../../config/settings.js');

    const settings = getSettings();
    expect(Object.isFrozen(settings)).toBe(true);

    LoggerService.getInstance().dispose();
  });
});

/**
 * Create a mock ExtensionContext for testing.
 */
function createMockContext(): {
  subscriptions: { dispose: () => void }[];
  extensionPath: string;
  extensionUri: { scheme: string; path: string; fsPath: string };
  globalState: { get: () => undefined; update: () => Promise<void> };
  secrets: { get: () => Promise<undefined>; store: () => Promise<void>; delete: () => Promise<void> };
} {
  return {
    subscriptions: [],
    extensionPath: '/mock/extension/path',
    extensionUri: { scheme: 'file', path: '/mock/extension/path', fsPath: '/mock/extension/path' },
    globalState: {
      get: () => undefined,
      update: async () => { /* noop */ },
    },
    secrets: {
      get: async () => undefined,
      store: async () => { /* noop */ },
      delete: async () => { /* noop */ },
    },
  };
}
