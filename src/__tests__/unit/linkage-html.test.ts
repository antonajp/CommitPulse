import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, Uri } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { generateLinkageHtml } from '../../views/webview/linkage-html.js';
import type { LinkageHtmlConfig } from '../../views/webview/linkage-html.js';

/**
 * Unit tests for linkage HTML generation (IQS-870, IQS-871, IQS-887).
 * Validates CSP, structure, filters, theme integration, export buttons,
 * copy-to-clipboard, loading states, state persistence, and
 * keyboard accessibility. Charts now use D3.js (IQS-887).
 */
describe('generateLinkageHtml', () => {
  let config: LinkageHtmlConfig;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    config = {
      nonce: 'test-nonce-linkage-12345678',
      d3Uri: Uri.file('/ext/media/d3.min.js'),
      styleUri: Uri.file('/ext/media/dashboard.css'),
      cspSource: 'https://test.vscode-resource.vscode-cdn.net',
    };
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  it('should return valid HTML document', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
  });

  it('should include Content Security Policy with nonce', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain("content=\"default-src 'none'");
    expect(html).toContain(`'nonce-${config.nonce}'`);
    expect(html).toContain(config.cspSource);
  });

  it('should reference D3.js with nonce attribute', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain(`nonce="${config.nonce}"`);
    expect(html).toContain('d3.min.js');
  });

  it('should reference the CSS stylesheet', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('dashboard.css');
    expect(html).toContain('rel="stylesheet"');
  });

  it('should include filter controls with Jira project filter', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('id="startDate"');
    expect(html).toContain('id="endDate"');
    expect(html).toContain('id="teamFilter"');
    expect(html).toContain('id="repoFilter"');
    expect(html).toContain('id="jiraProjectFilter"');
    expect(html).toContain('id="applyFilters"');
  });

  it('should include linkage summary section', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('id="totalCommitsValue"');
    expect(html).toContain('id="linkedValue"');
    expect(html).toContain('id="unlinkedValue"');
    expect(html).toContain('Linkage Summary');
  });

  it('should include D3 chart containers', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('id="projectDistChart"');
    expect(html).toContain('id="statusFlowChart"');
    // Charts now use div containers instead of canvas (IQS-887)
    expect(html).not.toContain('<canvas id="projectDistChart"');
    expect(html).not.toContain('<canvas id="statusFlowChart"');
  });

  it('should include assignment history table', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('id="assignmentBody"');
    expect(html).toContain('<th>Issue Key</th>');
    expect(html).toContain('<th>Assigned To</th>');
    expect(html).toContain('<th>Assigned From</th>');
  });

  it('should include unlinked commits drill-down section', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('id="toggleUnlinked"');
    expect(html).toContain('id="unlinkedBody"');
    expect(html).toContain('Unlinked Commits');
  });

  it('should include aria-labels for accessibility', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('aria-label="Commit Linkage Summary"');
    expect(html).toContain('aria-label="Project Distribution"');
    expect(html).toContain('aria-label="Status Flow"');
    expect(html).toContain('aria-label="Assignment History"');
    expect(html).toContain('aria-label="Unlinked Commits"');
    expect(html).toContain('aria-label="Start date filter"');
    expect(html).toContain('aria-label="Project filter"');
  });

  it('should include acquireVsCodeApi call', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('acquireVsCodeApi()');
  });

  it('should include message handler for all response types', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain("case 'linkageSummaryData'");
    expect(html).toContain("case 'jiraProjectDistributionData'");
    expect(html).toContain("case 'jiraStatusFlowData'");
    expect(html).toContain("case 'assignmentHistoryData'");
    expect(html).toContain("case 'unlinkedCommitsData'");
    expect(html).toContain("case 'linkageFilterOptionsData'");
    expect(html).toContain("case 'linkageError'");
  });

  it('should include postMessage calls for data requests', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain("type: 'requestLinkageSummary'");
    expect(html).toContain("type: 'requestJiraProjectDistribution'");
    expect(html).toContain("type: 'requestJiraStatusFlow'");
    expect(html).toContain("type: 'requestAssignmentHistory'");
    expect(html).toContain("type: 'requestLinkageFilterOptions'");
  });

  it('should not contain inline event handlers that bypass CSP', () => {
    const html = generateLinkageHtml(config);

    const scriptBlocks = html.split('<script');
    const preScript = scriptBlocks[0] ?? '';
    expect(preScript).not.toContain('onclick');
    expect(preScript).not.toContain('onerror');
    expect(preScript).not.toContain('onload');
  });

  it('should include drill-down toggle with aria-expanded attribute', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('toggleUnlinked');
  });

  // ===========================================================================
  // IQS-871: CSV Export Buttons
  // ===========================================================================
  it('should include CSV export buttons for each section', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('id="exportSummary"');
    expect(html).toContain('id="exportProjectDist"');
    expect(html).toContain('id="exportStatusFlow"');
    expect(html).toContain('id="exportAssignment"');
    expect(html).toContain('id="exportUnlinked"');
  });

  it('should include export button aria-labels', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('aria-label="Export linkage summary as CSV"');
    expect(html).toContain('aria-label="Export project distribution data as CSV"');
    expect(html).toContain('aria-label="Export status flow data as CSV"');
    expect(html).toContain('aria-label="Export assignment history as CSV"');
    expect(html).toContain('aria-label="Export unlinked commits as CSV"');
  });

  it('should include CSV filenames for each export', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('gitr-linkage-summary.csv');
    expect(html).toContain('gitr-project-distribution.csv');
    expect(html).toContain('gitr-status-flow.csv');
    expect(html).toContain('gitr-assignment-history.csv');
    expect(html).toContain('gitr-unlinked-commits.csv');
  });

  // ===========================================================================
  // IQS-871: Copy-to-Clipboard
  // ===========================================================================
  it('should include copy buttons for tables', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('id="copyAssignment"');
    expect(html).toContain('id="copyUnlinked"');
  });

  it('should include table IDs for export and copy operations', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('id="assignmentTable"');
    expect(html).toContain('id="unlinkedTable"');
  });

  // ===========================================================================
  // IQS-871: Loading & Error States
  // ===========================================================================
  it('should include loading state functions', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('function showLoading(');
    expect(html).toContain('function hideLoading(');
  });

  it('should include error state functions', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('function showError(');
    expect(html).toContain('function hideError(');
  });

  it('should show loading state when requesting data', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain("showLoading('summaryCard')");
    expect(html).toContain("showLoading('projectDistCard')");
    expect(html).toContain("showLoading('statusFlowCard')");
    expect(html).toContain("showLoading('assignmentCard')");
  });

  it('should hide loading state when data is received', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain("hideLoading('summaryCard')");
    expect(html).toContain("hideLoading('projectDistCard')");
    expect(html).toContain("hideLoading('statusFlowCard')");
    expect(html).toContain("hideLoading('assignmentCard')");
  });

  it('should include card IDs for loading/error targets', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('id="summaryCard"');
    expect(html).toContain('id="projectDistCard"');
    expect(html).toContain('id="statusFlowCard"');
    expect(html).toContain('id="assignmentCard"');
    expect(html).toContain('id="unlinkedCard"');
  });

  // ===========================================================================
  // IQS-871: State Persistence
  // ===========================================================================
  it('should include state persistence functions', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('function saveWebviewState(');
    expect(html).toContain('function loadWebviewState(');
    expect(html).toContain('function saveFilterState(');
    expect(html).toContain('function restoreFilterState(');
  });

  it('should call restoreFilterState before initial data load', () => {
    const html = generateLinkageHtml(config);

    const restoreIndex = html.indexOf('restoreFilterState()');
    const requestAllIndex = html.lastIndexOf('requestAll()');
    expect(restoreIndex).toBeGreaterThan(-1);
    expect(requestAllIndex).toBeGreaterThan(restoreIndex);
  });

  // ===========================================================================
  // IQS-871: Keyboard Accessibility
  // ===========================================================================
  it('should include keyboard accessibility setup', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('function setupKeyboardAccessibility(');
    expect(html).toContain('setupKeyboardAccessibility()');
  });

  it('should include tabindex on action buttons', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('tabindex="0"');
  });

  // ===========================================================================
  // IQS-871: Shared Utility Scripts
  // ===========================================================================
  it('should include shared CSV export utility scripts', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('function exportCsvFromData(');
    expect(html).toContain('function exportCsvFromTable(');
  });

  it('should include shared clipboard utility scripts', () => {
    const html = generateLinkageHtml(config);

    expect(html).toContain('function copyTableToClipboard(');
  });
});
