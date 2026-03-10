/**
 * Extension tests for the Architecture Drift Heat Map panel.
 * Tests the DriftPanel class lifecycle and message handling.
 *
 * Note: These tests use mocked VS Code APIs since we can't run
 * the actual extension host in unit tests.
 *
 * Ticket: IQS-918
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock vscode module before importing the panel
vi.mock('vscode', () => {
  const mockWebview = {
    html: '',
    asWebviewUri: vi.fn((uri: { fsPath: string }) => ({
      toString: () => `vscode-webview://${uri.fsPath}`,
    })),
    cspSource: 'vscode-webview:',
    onDidReceiveMessage: vi.fn(),
    postMessage: vi.fn().mockResolvedValue(true),
  };

  const mockPanel = {
    webview: mockWebview,
    reveal: vi.fn(),
    onDidDispose: vi.fn(),
    dispose: vi.fn(),
  };

  return {
    window: {
      createWebviewPanel: vi.fn(() => mockPanel),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
    },
    Uri: {
      joinPath: vi.fn((...args: unknown[]) => ({
        fsPath: args.slice(1).join('/'),
        toString: () => args.slice(1).join('/'),
      })),
      file: vi.fn((path: string) => ({
        fsPath: path,
        toString: () => path,
      })),
    },
    ViewColumn: {
      One: 1,
      Two: 2,
    },
    commands: {
      registerCommand: vi.fn(),
      executeCommand: vi.fn().mockResolvedValue(undefined),
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn(),
      })),
      openTextDocument: vi.fn(),
    },
    ConfigurationTarget: {
      Global: 1,
    },
  };
});

// Mock fs.readFileSync for D3.js integrity check
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    readFileSync: vi.fn(() => Buffer.from('mock-d3-content')),
  };
});

// Mock crypto for nonce generation and hash
vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    randomBytes: vi.fn(() => ({
      toString: () => 'mock-nonce-12345678901234567890123456789012',
    })),
    createHash: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539'),
    })),
  };
});

// Mock the logger
vi.mock('../../logging/logger.js', () => ({
  LoggerService: {
    getInstance: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

// Mock database service
vi.mock('../../database/database-service.js', () => ({
  DatabaseService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
  })),
  buildConfigFromSettings: vi.fn(() => ({
    host: 'localhost',
    port: 5433,
    database: 'gitrx',
    user: 'gitrx_admin',
    password: 'test-password',
  })),
}));

// Mock architecture drift service
vi.mock('../../services/architecture-drift-service.js', () => ({
  ArchitectureDriftDataService: vi.fn().mockImplementation(() => ({
    getHeatMapChartData: vi.fn().mockResolvedValue({
      driftData: [],
      heatMapData: { components: [], weeks: [], cells: [] },
      couplingData: [],
      summary: {
        totalCrossComponentCommits: 0,
        totalComponents: 0,
        avgDriftPercentage: 0,
        highestDriftComponent: null,
        maxHeatIntensity: 0,
        totalCritical: 0,
        totalHigh: 0,
        totalMedium: 0,
        totalLow: 0,
      },
      hasData: false,
      viewExists: true,
    }),
    getUniqueComponents: vi.fn().mockResolvedValue([]),
    getCrossComponentCommitData: vi.fn().mockResolvedValue({
      commits: [],
      hasData: false,
      viewExists: true,
    }),
    getArchitectureDrift: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock settings
vi.mock('../../config/settings.js', () => ({
  getSettings: vi.fn(() => ({
    database: {
      host: 'localhost',
      port: 5433,
      name: 'gitrx',
      user: 'gitrx_admin',
    },
    jira: {
      server: '',
      username: '',
      projectKeys: [],
    },
    linear: {
      teamKeys: [],
    },
    repositories: [
      { name: 'test-repo', path: '/path/to/repo' },
    ],
  })),
}));

import { DriftPanel } from '../../views/webview/drift-panel.js';
import * as vscode from 'vscode';
import * as crypto from 'crypto';

describe('DriftPanel', () => {
  let mockSecretService: {
    getDatabasePassword: ReturnType<typeof vi.fn>;
    getJiraToken: ReturnType<typeof vi.fn>;
    getGitHubToken: ReturnType<typeof vi.fn>;
    getLinearToken: ReturnType<typeof vi.fn>;
    getMigrationPassword: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSecretService = {
      getDatabasePassword: vi.fn().mockResolvedValue('test-password'),
      getJiraToken: vi.fn().mockResolvedValue(null),
      getGitHubToken: vi.fn().mockResolvedValue(null),
      getLinearToken: vi.fn().mockResolvedValue(null),
      getMigrationPassword: vi.fn().mockResolvedValue(null),
    };

    // Reset the singleton
    DriftPanel.resetForTesting();
    vi.clearAllMocks();
  });

  afterEach(() => {
    DriftPanel.resetForTesting();
  });

  describe('createOrShow', () => {
    it('should create a new panel when none exists', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'gitrx.driftPanel',
        'Gitr: Architecture Drift',
        vscode.ViewColumn.One,
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        }),
      );
    });

    it('should reveal existing panel when one exists', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      // Create first panel
      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);

      // Get the panel mock
      const createMock = vi.mocked(vscode.window.createWebviewPanel);
      const mockPanel = createMock.mock.results[0]?.value;

      // Try to create second panel
      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);

      expect(mockPanel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.One);
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    });

    it('should verify D3.js integrity before creating panel', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);

      expect(fs.readFileSync).toHaveBeenCalled();
      expect(crypto.createHash).toHaveBeenCalledWith('sha256');
    });

    it('should show error when D3.js integrity check fails', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      // Make hash mismatch
      const mockHash = vi.mocked(crypto.createHash);
      mockHash.mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        digest: vi.fn(() => 'wrong-hash'),
      } as any);

      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('D3.js bundle integrity check failed'),
      );
      expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });
  });

  describe('resetForTesting', () => {
    it('should reset the singleton instance', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      // Create a panel
      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);

      // Reset
      DriftPanel.resetForTesting();

      // Creating again should call createWebviewPanel again
      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    });
  });

  describe('webview content', () => {
    it('should set webview HTML content', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);

      const createMock = vi.mocked(vscode.window.createWebviewPanel);
      const mockPanel = createMock.mock.results[0]?.value;

      expect(mockPanel.webview.html).toContain('<!DOCTYPE html>');
      expect(mockPanel.webview.html).toContain('Architecture Drift Heat Map');
    });

    it('should include CSP with generated nonce', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);

      const createMock = vi.mocked(vscode.window.createWebviewPanel);
      const mockPanel = createMock.mock.results[0]?.value;

      expect(mockPanel.webview.html).toContain('Content-Security-Policy');
      expect(mockPanel.webview.html).toContain('nonce-mock-nonce-12345678901234567890123456789012');
    });
  });

  describe('message handling', () => {
    it('should register message handler on webview', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);

      const createMock = vi.mocked(vscode.window.createWebviewPanel);
      const mockPanel = createMock.mock.results[0]?.value;

      expect(mockPanel.webview.onDidReceiveMessage).toHaveBeenCalled();
    });
  });

  describe('disposal', () => {
    it('should register disposal handler', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      DriftPanel.createOrShow(extensionUri as any, mockSecretService as any);

      const createMock = vi.mocked(vscode.window.createWebviewPanel);
      const mockPanel = createMock.mock.results[0]?.value;

      expect(mockPanel.onDidDispose).toHaveBeenCalled();
    });
  });
});
