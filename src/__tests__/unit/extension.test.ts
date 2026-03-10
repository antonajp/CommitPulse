import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, commands } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';

describe('Extension Lifecycle', () => {
  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  it('should export activate and deactivate functions', async () => {
    const extension = await import('../../extension.js');
    expect(typeof extension.activate).toBe('function');
    expect(typeof extension.deactivate).toBe('function');
  });

  it('should register commands on activation', async () => {
    const extension = await import('../../extension.js');

    // Create a mock context
    const context = createMockContext();
    extension.activate(context);

    // Verify commands are registered
    const registeredCommands = commands.getRegisteredCommands();
    expect(registeredCommands.has('gitr.runPipeline')).toBe(true);
    expect(registeredCommands.has('gitr.startDatabase')).toBe(true);
    expect(registeredCommands.has('gitr.stopDatabase')).toBe(true);
    expect(registeredCommands.has('gitrx.setDatabasePassword')).toBe(true);
    expect(registeredCommands.has('gitrx.setJiraToken')).toBe(true);
    expect(registeredCommands.has('gitrx.setGitHubToken')).toBe(true);
    expect(registeredCommands.has('gitrx.openLinkageView')).toBe(true);

    // Clean up
    extension.deactivate();
  });

  it('should add disposables to context subscriptions on activation', async () => {
    const extension = await import('../../extension.js');
    const context = createMockContext();

    extension.activate(context);

    // 3 original commands + 1 SecretStorageService + 4 secret commands + 1 config listener = 9 disposables
    expect(context.subscriptions.length).toBeGreaterThanOrEqual(9);

    extension.deactivate();
  });

  it('should clean up on deactivation', async () => {
    const extension = await import('../../extension.js');
    const context = createMockContext();

    extension.activate(context);
    extension.deactivate();

    // Deactivation should not throw
    expect(true).toBe(true);
  });

  it('should handle deactivation when not activated', async () => {
    const extension = await import('../../extension.js');

    // Should not throw even if called without prior activation
    expect(() => extension.deactivate()).not.toThrow();
  });
});

/**
 * Create a mock ExtensionContext for testing.
 */
function createMockContext(): {
  subscriptions: { dispose: () => void }[];
  extensionPath: string;
  globalState: { get: () => undefined; update: () => Promise<void> };
  workspaceState: { get: () => undefined; update: () => Promise<void> };
  secrets: { get: () => Promise<undefined>; store: () => Promise<void>; delete: () => Promise<void> };
  extensionUri: { scheme: string; path: string };
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
      get: async () => undefined,
      store: async () => { /* noop */ },
      delete: async () => { /* noop */ },
    },
    extensionUri: { scheme: 'file', path: '/mock/extension' },
  };
}
