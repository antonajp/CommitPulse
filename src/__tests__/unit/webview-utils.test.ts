import { describe, it, expect } from 'vitest';

import {
  generateCsvExportScript,
  generateClipboardScript,
  generateLoadingStateScript,
  generateStatePersistenceScript,
  generateKeyboardAccessibilityScript,
  generateAllWebviewUtilityScripts,
} from '../../views/webview/webview-utils.js';

/**
 * Unit tests for shared webview utility functions (IQS-871).
 * Validates that generated JavaScript snippets contain required
 * function declarations and patterns.
 */
describe('webview-utils', () => {
  describe('generateCsvExportScript', () => {
    it('should return a non-empty string', () => {
      const script = generateCsvExportScript();
      expect(script).toBeTruthy();
      expect(typeof script).toBe('string');
    });

    it('should define escapeCsvCell function', () => {
      const script = generateCsvExportScript();
      expect(script).toContain('function escapeCsvCell(');
    });

    it('should define exportCsvFromData function', () => {
      const script = generateCsvExportScript();
      expect(script).toContain('function exportCsvFromData(');
    });

    it('should define exportCsvFromTable function', () => {
      const script = generateCsvExportScript();
      expect(script).toContain('function exportCsvFromTable(');
    });

    it('should define downloadCsvBlob function', () => {
      const script = generateCsvExportScript();
      expect(script).toContain('function downloadCsvBlob(');
    });

    it('should handle RFC 4180 CSV quoting (commas and double-quotes)', () => {
      const script = generateCsvExportScript();
      // Verify the quoting logic exists
      expect(script).toContain('indexOf');
      expect(script).toContain('replace');
    });

    it('should use postMessage for CSV export (GITX-127)', () => {
      const script = generateCsvExportScript();
      // GITX-127: Changed from Blob URLs to postMessage for CSP compatibility
      expect(script).toContain("vscode.postMessage");
      expect(script).toContain("type: 'exportCsv'");
    });

    it('should include formula injection prevention (CWE-1236)', () => {
      const script = generateCsvExportScript();
      // GITX-127, GITX-128: Formula prefix sanitization uses String.fromCharCode
      // to avoid template literal escaping issues with nested templates
      expect(script).toContain("String.fromCharCode(9, 13)");
      expect(script).toContain("formulaChars.indexOf");
      expect(script).toContain("CWE-1236");
      expect(script).toContain("str.trim()"); // Whitespace bypass prevention
    });

    it('should include toast notification functions (GITX-127)', () => {
      const script = generateCsvExportScript();
      expect(script).toContain('function showToast(');
      expect(script).toContain('function showExportSuccess(');
      expect(script).toContain('function showExportError(');
    });
  });

  describe('generateClipboardScript', () => {
    it('should return a non-empty string', () => {
      const script = generateClipboardScript();
      expect(script).toBeTruthy();
    });

    it('should define copyTableToClipboard function', () => {
      const script = generateClipboardScript();
      expect(script).toContain('function copyTableToClipboard(');
    });

    it('should use navigator.clipboard.writeText', () => {
      const script = generateClipboardScript();
      expect(script).toContain('navigator.clipboard.writeText');
    });

    it('should include visual feedback (Copied! text)', () => {
      const script = generateClipboardScript();
      expect(script).toContain('Copied!');
    });

    it('should use tab-separated values', () => {
      const script = generateClipboardScript();
      // GITX-128: Uses String.fromCharCode(9) for tab to avoid escape sequence issues
      expect(script).toContain('String.fromCharCode(9)');
    });
  });

  describe('generateLoadingStateScript', () => {
    it('should return a non-empty string', () => {
      const script = generateLoadingStateScript();
      expect(script).toBeTruthy();
    });

    it('should define showLoading function', () => {
      const script = generateLoadingStateScript();
      expect(script).toContain('function showLoading(');
    });

    it('should define hideLoading function', () => {
      const script = generateLoadingStateScript();
      expect(script).toContain('function hideLoading(');
    });

    it('should define showError function', () => {
      const script = generateLoadingStateScript();
      expect(script).toContain('function showError(');
    });

    it('should define hideError function', () => {
      const script = generateLoadingStateScript();
      expect(script).toContain('function hideError(');
    });

    it('should include loading-overlay CSS class', () => {
      const script = generateLoadingStateScript();
      expect(script).toContain('loading-overlay');
    });

    it('should include loading-spinner CSS class', () => {
      const script = generateLoadingStateScript();
      expect(script).toContain('loading-spinner');
    });

    it('should include error-banner CSS class', () => {
      const script = generateLoadingStateScript();
      expect(script).toContain('error-banner');
    });

    it('should set role=status on loading overlay', () => {
      const script = generateLoadingStateScript();
      expect(script).toContain("'role', 'status'");
    });

    it('should set role=alert on error banner', () => {
      const script = generateLoadingStateScript();
      expect(script).toContain("'role', 'alert'");
    });
  });

  describe('generateStatePersistenceScript', () => {
    it('should return a non-empty string', () => {
      const script = generateStatePersistenceScript();
      expect(script).toBeTruthy();
    });

    it('should define saveWebviewState function', () => {
      const script = generateStatePersistenceScript();
      expect(script).toContain('function saveWebviewState(');
    });

    it('should define loadWebviewState function', () => {
      const script = generateStatePersistenceScript();
      expect(script).toContain('function loadWebviewState(');
    });

    it('should define saveFilterState function', () => {
      const script = generateStatePersistenceScript();
      expect(script).toContain('function saveFilterState(');
    });

    it('should define restoreFilterState function', () => {
      const script = generateStatePersistenceScript();
      expect(script).toContain('function restoreFilterState(');
    });

    it('should use vscode.getState and vscode.setState', () => {
      const script = generateStatePersistenceScript();
      expect(script).toContain('vscode.getState()');
      expect(script).toContain('vscode.setState(');
    });

    it('should handle filter elements by ID', () => {
      const script = generateStatePersistenceScript();
      expect(script).toContain("getElementById('startDate')");
      expect(script).toContain("getElementById('endDate')");
      expect(script).toContain("getElementById('teamFilter')");
      expect(script).toContain("getElementById('repoFilter')");
    });

    it('should support optional jiraProjectFilter element', () => {
      const script = generateStatePersistenceScript();
      expect(script).toContain("getElementById('jiraProjectFilter')");
    });
  });

  describe('generateKeyboardAccessibilityScript', () => {
    it('should return a non-empty string', () => {
      const script = generateKeyboardAccessibilityScript();
      expect(script).toBeTruthy();
    });

    it('should define setupKeyboardAccessibility function', () => {
      const script = generateKeyboardAccessibilityScript();
      expect(script).toContain('function setupKeyboardAccessibility(');
    });

    it('should handle Enter key', () => {
      const script = generateKeyboardAccessibilityScript();
      expect(script).toContain("'Enter'");
    });

    it('should handle Space key', () => {
      const script = generateKeyboardAccessibilityScript();
      expect(script).toContain("' '");
    });

    it('should set tabindex on action buttons', () => {
      const script = generateKeyboardAccessibilityScript();
      expect(script).toContain('tabindex');
    });

    it('should include keyboard shortcut for export (Ctrl+Shift+E)', () => {
      const script = generateKeyboardAccessibilityScript();
      expect(script).toContain('ctrlKey');
      expect(script).toContain('shiftKey');
      expect(script).toContain("'E'");
    });
  });

  describe('generateAllWebviewUtilityScripts', () => {
    it('should return a non-empty combined string', () => {
      const combined = generateAllWebviewUtilityScripts();
      expect(combined).toBeTruthy();
      expect(typeof combined).toBe('string');
    });

    it('should include all individual utility functions', () => {
      const combined = generateAllWebviewUtilityScripts();

      // CSV export functions
      expect(combined).toContain('function escapeCsvCell(');
      expect(combined).toContain('function exportCsvFromData(');
      expect(combined).toContain('function exportCsvFromTable(');

      // Clipboard functions
      expect(combined).toContain('function copyTableToClipboard(');

      // Loading/error state functions
      expect(combined).toContain('function showLoading(');
      expect(combined).toContain('function hideLoading(');
      expect(combined).toContain('function showError(');
      expect(combined).toContain('function hideError(');

      // State persistence functions
      expect(combined).toContain('function saveWebviewState(');
      expect(combined).toContain('function loadWebviewState(');
      expect(combined).toContain('function saveFilterState(');
      expect(combined).toContain('function restoreFilterState(');

      // Keyboard accessibility
      expect(combined).toContain('function setupKeyboardAccessibility(');
    });

    it('should not duplicate function declarations', () => {
      const combined = generateAllWebviewUtilityScripts();
      const matches = combined.match(/function escapeCsvCell\(/g);
      expect(matches).toHaveLength(1);
    });
  });
});
