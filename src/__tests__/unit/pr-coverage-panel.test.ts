/**
 * Unit tests for PRCoveragePanel.
 * Tests webview panel creation, message handling, and lifecycle.
 *
 * Ticket: GITX-221
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs';

// Mock vscode before importing the panel
vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(() => ({
      webview: {
        html: '',
        asWebviewUri: vi.fn((uri) => uri),
        cspSource: 'test-source',
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
    })),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  Uri: {
    joinPath: vi.fn((base, ...parts) => ({
      fsPath: `${base}/${parts.join('/')}`,
      toString: () => `${base}/${parts.join('/')}`,
    })),
  },
  ViewColumn: {
    One: 1,
    Two: 2,
    Three: 3,
  },
  env: {
    openExternal: vi.fn(),
  },
}));

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => Buffer.from('test-content')),
}));

// Mock crypto
vi.mock('crypto', () => ({
  randomBytes: vi.fn(() => ({ toString: () => 'test-nonce-123' })),
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539'),
  })),
}));

// Mock LoggerService
vi.mock('../../logging/logger.js', () => ({
  LoggerService: {
    getInstance: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    }),
  },
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
    github: {
      organization: 'test-org',
    },
    jira: {},
    linear: {},
  })),
}));

// Mock database service
vi.mock('../../database/database-service.js', () => ({
  DatabaseService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    query: vi.fn(),
    shutdown: vi.fn(),
  })),
  buildConfigFromSettings: vi.fn(() => ({})),
}));

// Mock PRCoverageService
vi.mock('../../services/pr-coverage-service.js', () => ({
  PRCoverageService: vi.fn().mockImplementation(() => ({
    checkViewExists: vi.fn().mockResolvedValue(true),
    getChartData: vi.fn().mockResolvedValue({
      overall: {
        totalCommits: 100,
        prLinkedCommits: 80,
        orphanCommits: 20,
        mergeCommits: 5,
        repositoriesAnalyzed: 2,
        coveragePercentage: 80,
      },
      weeklyTrend: [],
      byAuthor: [],
      byBranch: [],
      orphanCommits: [],
      hasData: true,
      viewExists: true,
    }),
    getOrphanCommits: vi.fn().mockResolvedValue([]),
    getFilterOptions: vi.fn().mockResolvedValue({
      repositories: ['repo1'],
      authors: ['alice'],
      branches: ['main'],
    }),
    syncCoverageFromMergeSha: vi.fn().mockResolvedValue(10),
  })),
}));

// Mock URL validator
vi.mock('../../utils/url-validator.js', () => ({
  validateExternalUrl: vi.fn(() => ({
    isValid: true,
    validatedUri: vscode.Uri.parse('https://github.com/test/repo'),
  })),
}));

// Mock rate limiter
vi.mock('../../views/webview/message-rate-limiter.js', () => ({
  MessageRateLimiter: vi.fn().mockImplementation(() => ({
    checkRateLimit: vi.fn(() => ({ allowed: true, waitMs: 0 })),
    reset: vi.fn(),
  })),
  DEFAULT_RATE_LIMIT_INTERVAL_MS: 500,
}));

// Mock shared message handlers
vi.mock('../../views/webview/shared-message-handlers.js', () => ({
  handleSharedMessage: vi.fn(),
}));

// Mock PR coverage HTML generator
vi.mock('../../views/webview/pr-coverage-html.js', () => ({
  generatePRCoverageHtml: vi.fn(() => '<html><body>PR Coverage Report</body></html>'),
}));

import { PRCoveragePanel } from '../../views/webview/pr-coverage-panel.js';

describe('PRCoveragePanel', () => {
  let mockSecretService: { getDatabasePassword: () => Promise<string | undefined> };

  beforeEach(() => {
    // Reset singleton
    PRCoveragePanel.resetForTesting();

    mockSecretService = {
      getDatabasePassword: vi.fn().mockResolvedValue('test-password'),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    PRCoveragePanel.resetForTesting();
  });

  describe('createOrShow', () => {
    it('should create a new panel when none exists', () => {
      const extensionUri = { fsPath: '/test/extension' } as vscode.Uri;

      PRCoveragePanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as Parameters<typeof PRCoveragePanel.createOrShow>[1],
      );

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'gitrx.prCoveragePanel',
        'Gitr: PR Coverage Report',
        vscode.ViewColumn.One,
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        }),
      );
    });

    it('should reveal existing panel when one exists', () => {
      const extensionUri = { fsPath: '/test/extension' } as vscode.Uri;

      // Create first panel
      PRCoveragePanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as Parameters<typeof PRCoveragePanel.createOrShow>[1],
      );

      // Reset the mock to check if it's called again
      vi.mocked(vscode.window.createWebviewPanel).mockClear();

      // Try to create another panel
      PRCoveragePanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as Parameters<typeof PRCoveragePanel.createOrShow>[1],
      );

      // Should not create a new panel
      expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it('should show error when D3 integrity check fails', async () => {
      const extensionUri = { fsPath: '/test/extension' } as vscode.Uri;

      // Mock D3 hash mismatch
      const crypto = await import('crypto');
      vi.mocked(crypto.createHash).mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        digest: vi.fn(() => 'wrong-hash'),
      } as unknown as ReturnType<typeof crypto.createHash>);

      PRCoveragePanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as Parameters<typeof PRCoveragePanel.createOrShow>[1],
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('D3.js bundle integrity check failed'),
      );
    });

    it('should handle missing D3 file gracefully', () => {
      const extensionUri = { fsPath: '/test/extension' } as vscode.Uri;

      // Mock file read error
      vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
        throw new Error('File not found');
      });

      PRCoveragePanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as Parameters<typeof PRCoveragePanel.createOrShow>[1],
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });
  });

  describe('resetForTesting', () => {
    it('should allow creating a new panel after reset', () => {
      const extensionUri = { fsPath: '/test/extension' } as vscode.Uri;

      // Create first panel
      PRCoveragePanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as Parameters<typeof PRCoveragePanel.createOrShow>[1],
      );

      // Reset
      PRCoveragePanel.resetForTesting();

      // Clear mock
      vi.mocked(vscode.window.createWebviewPanel).mockClear();

      // Should create a new panel now
      PRCoveragePanel.createOrShow(
        extensionUri,
        mockSecretService as unknown as Parameters<typeof PRCoveragePanel.createOrShow>[1],
      );

      expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
    });
  });
});
