/**
 * Extension tests for the FocusPanel webview.
 * Tests panel creation, message handling, and disposal.
 *
 * Note: These tests use mocked VS Code APIs since we can't run
 * the actual extension host in unit tests.
 *
 * Ticket: IQS-908
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
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn(),
      })),
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

// Mock developer focus data service
vi.mock('../../services/developer-focus-service.js', () => ({
  DeveloperFocusDataService: vi.fn().mockImplementation(() => ({
    getChartData: vi.fn().mockResolvedValue({
      focusData: [],
      trends: {
        weeks: [],
        developers: [],
        teamAvgByWeek: [],
        overallTeamAvg: 0,
      },
      teamSummary: {
        avgFocusScore: 0,
        deepFocusCount: 0,
        moderateFocusCount: 0,
        fragmentedCount: 0,
        highlyFragmentedCount: 0,
        totalDevelopers: 0,
      },
      hasData: false,
      viewExists: true,
    }),
    getFocusScores: vi.fn().mockResolvedValue([]),
    getFocusTrends: vi.fn().mockResolvedValue({
      weeks: [],
      developers: [],
      teamAvgByWeek: [],
      overallTeamAvg: 0,
    }),
    getTeamSummary: vi.fn().mockResolvedValue({
      avgFocusScore: 0,
      deepFocusCount: 0,
      moderateFocusCount: 0,
      fragmentedCount: 0,
      highlyFragmentedCount: 0,
      totalDevelopers: 0,
    }),
    getDailyActivities: vi.fn().mockResolvedValue([]),
    getDailyActivityChartData: vi.fn().mockResolvedValue({
      activities: [],
      hasData: false,
      viewExists: true,
    }),
    checkFocusViewExists: vi.fn().mockResolvedValue(true),
    checkDailyActivityViewExists: vi.fn().mockResolvedValue(true),
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
    repositories: [],
  })),
}));

import { FocusPanel } from '../../views/webview/focus-panel.js';
import * as vscode from 'vscode';

describe('FocusPanel', () => {
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
    FocusPanel.resetForTesting();
    vi.clearAllMocks();
  });

  afterEach(() => {
    FocusPanel.resetForTesting();
  });

  describe('createOrShow', () => {
    it('should create a new panel when none exists', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      FocusPanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as import('../../config/secret-storage.js').SecretStorageService
      );

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'gitrx.focusPanel',
        'Gitr: Developer Focus',
        vscode.ViewColumn.One,
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        })
      );
    });

    it('should reveal existing panel instead of creating new one', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      // Create first panel
      FocusPanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as import('../../config/secret-storage.js').SecretStorageService
      );

      // Reset the mock call count
      vi.mocked(vscode.window.createWebviewPanel).mockClear();

      // Try to create second panel
      FocusPanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as import('../../config/secret-storage.js').SecretStorageService
      );

      // Should not create a new panel
      expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it('should verify D3.js integrity', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      FocusPanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as import('../../config/secret-storage.js').SecretStorageService
      );

      // Check that fs.readFileSync was called for D3 verification
      expect(fs.readFileSync).toHaveBeenCalled();
    });
  });

  describe('webview content', () => {
    it('should set webview HTML content', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      FocusPanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as import('../../config/secret-storage.js').SecretStorageService
      );

      const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]?.value;
      expect(panel?.webview.html).toBeTruthy();
      expect(panel?.webview.html).toContain('<!DOCTYPE html>');
    });

    it('should resolve D3.js URI', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      FocusPanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as import('../../config/secret-storage.js').SecretStorageService
      );

      expect(vscode.Uri.joinPath).toHaveBeenCalledWith(
        extensionUri,
        'media',
        'd3.min.js'
      );
    });

    it('should resolve stylesheet URI', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      FocusPanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as import('../../config/secret-storage.js').SecretStorageService
      );

      expect(vscode.Uri.joinPath).toHaveBeenCalledWith(
        extensionUri,
        'media',
        'focus.css'
      );
    });
  });

  describe('resetForTesting', () => {
    it('should allow creating new panel after reset', () => {
      const extensionUri = vscode.Uri.file('/test/extension');

      // Create first panel
      FocusPanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as import('../../config/secret-storage.js').SecretStorageService
      );

      // Reset
      FocusPanel.resetForTesting();
      vi.mocked(vscode.window.createWebviewPanel).mockClear();

      // Create new panel
      FocusPanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as import('../../config/secret-storage.js').SecretStorageService
      );

      // Should create a new panel
      expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
    });
  });
});
