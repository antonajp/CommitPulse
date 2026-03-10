import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, Uri } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { generateDashboardHtml } from '../../views/webview/dashboard-html.js';
import type { DashboardHtmlConfig } from '../../views/webview/dashboard-html.js';

/**
 * Unit tests for dashboard HTML generation (IQS-869, IQS-871, IQS-887).
 * Validates CSP, structure, theme integration, export buttons,
 * copy-to-clipboard, loading states, state persistence, and
 * keyboard accessibility. Charts now use D3.js (IQS-887).
 */
describe('generateDashboardHtml', () => {
  let config: DashboardHtmlConfig;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    config = {
      nonce: 'test-nonce-12345678',
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
    const html = generateDashboardHtml(config);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
  });

  it('should include Content Security Policy with nonce', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain("content=\"default-src 'none'");
    expect(html).toContain(`'nonce-${config.nonce}'`);
    expect(html).toContain(config.cspSource);
  });

  it('should reference D3.js with nonce attribute', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain(`nonce="${config.nonce}"`);
    expect(html).toContain('d3.min.js');
  });

  it('should reference the CSS stylesheet', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('dashboard.css');
    expect(html).toContain('rel="stylesheet"');
  });

  it('should include filter controls', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('id="startDate"');
    expect(html).toContain('id="endDate"');
    expect(html).toContain('id="teamFilter"');
    expect(html).toContain('id="repoFilter"');
    expect(html).toContain('id="granularity"');
    expect(html).toContain('id="applyFilters"');
  });

  it('should include D3 chart containers', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('id="velocityChart"');
    expect(html).toContain('id="techStackChart"');
    expect(html).toContain('id="complexityChart"');
    // Charts now use div containers instead of canvas (IQS-887)
    expect(html).not.toContain('<canvas id="velocityChart"');
    expect(html).not.toContain('<canvas id="techStackChart"');
    expect(html).not.toContain('<canvas id="complexityChart"');
  });

  it('should include scorecard table structure with sortable columns (IQS-892)', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('id="scorecardBody"');
    // IQS-892: Sortable headers with 7 columns
    expect(html).toContain('class="sortable-header"');
    expect(html).toContain('data-sort-key="fullName"');
    expect(html).toContain('data-sort-key="team"');
    expect(html).toContain('data-sort-key="releaseAssistScore"');
    expect(html).toContain('data-sort-key="testScore"');
    expect(html).toContain('data-sort-key="complexityScore"');
    expect(html).toContain('data-sort-key="commentsScore"');
    expect(html).toContain('data-sort-key="totalScore"');
    // Column headers with weight percentages
    expect(html).toContain('Contributor</span>');
    expect(html).toContain('Team</span>');
    expect(html).toContain('Release Assist (10%)</span>');
    expect(html).toContain('Test (35%)</span>');
    expect(html).toContain('Complexity (45%)</span>');
    expect(html).toContain('Comments (10%)</span>');
    expect(html).toContain('Total Score</span>');
  });

  it('should include aria-labels for accessibility', () => {
    const html = generateDashboardHtml(config);

    // IQS-919: Renamed from Commit Velocity to LOC per Week
    expect(html).toContain('aria-label="LOC per Week Chart"');
    expect(html).toContain('aria-label="Technology Stack Distribution"');
    expect(html).toContain('aria-label="Team Scorecard"');
    // IQS-894: Renamed from File Complexity Trends to Top Complex Files Chart
    expect(html).toContain('aria-label="Top Complex Files Chart"');
    expect(html).toContain('aria-label="Start date filter"');
    expect(html).toContain('aria-label="Repository filter"');
  });

  it('should include acquireVsCodeApi call', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('acquireVsCodeApi()');
  });

  it('should include message handler for all response types', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain("case 'commitVelocityData'");
    expect(html).toContain("case 'techStackData'");
    // IQS-892: Changed from scorecardData to scorecardDetailData
    expect(html).toContain("case 'scorecardDetailData'");
    // IQS-894: Renamed message type from fileComplexityData to topComplexFilesData
    expect(html).toContain("case 'topComplexFilesData'");
    expect(html).toContain("case 'filterOptionsData'");
    expect(html).toContain("case 'error'");
  });

  it('should include postMessage calls for data requests', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain("type: 'requestCommitVelocity'");
    expect(html).toContain("type: 'requestTechStack'");
    // IQS-892: Changed from requestScorecard to requestScorecardDetail
    expect(html).toContain("type: 'requestScorecardDetail'");
    // IQS-894: Renamed request type from requestFileComplexity to requestTopComplexFiles
    expect(html).toContain("type: 'requestTopComplexFiles'");
    expect(html).toContain("type: 'requestFilterOptions'");
  });

  it('should not contain inline styles that bypass CSP', () => {
    const html = generateDashboardHtml(config);

    // The only inline style attributes should be display:none on empty messages
    // which are controlled by JS and are acceptable
    const scriptBlocks = html.split('<script');
    // First element is before any script tag, should not contain onclick handlers etc.
    const preScript = scriptBlocks[0] ?? '';
    expect(preScript).not.toContain('onclick');
    expect(preScript).not.toContain('onerror');
    expect(preScript).not.toContain('onload');
  });

  // ===========================================================================
  // IQS-871: CSV Export Buttons
  // ===========================================================================
  it('should include CSV export buttons for each chart/table', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('id="exportVelocity"');
    expect(html).toContain('id="exportTechStack"');
    expect(html).toContain('id="exportScorecard"');
    expect(html).toContain('id="exportComplexity"');
  });

  it('should include export button aria-labels', () => {
    const html = generateDashboardHtml(config);

    // IQS-919: Updated aria-label to reference LOC instead of commit velocity
    expect(html).toContain('aria-label="Export lines of code data as CSV"');
    expect(html).toContain('aria-label="Export technology stack data as CSV"');
    expect(html).toContain('aria-label="Export scorecard data as CSV"');
    expect(html).toContain('aria-label="Export file complexity data as CSV"');
  });

  it('should include CSV export event listeners for all charts', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain("getElementById('exportVelocity')");
    expect(html).toContain("getElementById('exportTechStack')");
    expect(html).toContain("getElementById('exportScorecard')");
    expect(html).toContain("getElementById('exportComplexity')");
  });

  it('should include CSV filenames for each export', () => {
    const html = generateDashboardHtml(config);

    // IQS-919: Renamed CSV file from gitr-commit-velocity.csv to gitr-loc-per-week.csv
    expect(html).toContain('gitr-loc-per-week.csv');
    expect(html).toContain('gitr-tech-stack.csv');
    expect(html).toContain('gitr-team-scorecard.csv');
    // IQS-894: Renamed CSV file from gitr-file-complexity.csv to gitr-top-complex-files.csv
    expect(html).toContain('gitr-top-complex-files.csv');
  });

  // ===========================================================================
  // IQS-871: Copy-to-Clipboard
  // ===========================================================================
  it('should include copy-to-clipboard button for scorecard table', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('id="copyScorecard"');
    expect(html).toContain('aria-label="Copy scorecard table to clipboard"');
  });

  it('should include copyTableToClipboard function call', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain("copyTableToClipboard('scorecardTable'");
  });

  // ===========================================================================
  // IQS-871: Loading & Error States
  // ===========================================================================
  it('should include loading state functions', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('function showLoading(');
    expect(html).toContain('function hideLoading(');
  });

  it('should include error state functions', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('function showError(');
    expect(html).toContain('function hideError(');
  });

  it('should show loading state when requesting data', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain("showLoading('velocityCard')");
    expect(html).toContain("showLoading('techStackCard')");
    expect(html).toContain("showLoading('scorecardCard')");
    expect(html).toContain("showLoading('complexityCard')");
  });

  it('should hide loading state when data is received', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain("hideLoading('velocityCard')");
    expect(html).toContain("hideLoading('techStackCard')");
    expect(html).toContain("hideLoading('scorecardCard')");
    expect(html).toContain("hideLoading('complexityCard')");
  });

  it('should show error in card when error message received', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain("showError('velocityCard'");
    expect(html).toContain("showError('techStackCard'");
    expect(html).toContain("showError('scorecardCard'");
    expect(html).toContain("showError('complexityCard'");
  });

  it('should include card IDs for loading/error targets', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('id="velocityCard"');
    expect(html).toContain('id="techStackCard"');
    expect(html).toContain('id="scorecardCard"');
    expect(html).toContain('id="complexityCard"');
  });

  // ===========================================================================
  // IQS-871: State Persistence
  // ===========================================================================
  it('should include state persistence functions', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('function saveWebviewState(');
    expect(html).toContain('function loadWebviewState(');
    expect(html).toContain('function saveFilterState(');
    expect(html).toContain('function restoreFilterState(');
  });

  it('should call restoreFilterState before initial data load', () => {
    const html = generateDashboardHtml(config);

    // restoreFilterState should appear before the final requestAll() call
    const restoreIndex = html.indexOf('restoreFilterState()');
    const requestAllIndex = html.lastIndexOf('requestAll()');
    expect(restoreIndex).toBeGreaterThan(-1);
    expect(requestAllIndex).toBeGreaterThan(restoreIndex);
  });

  it('should call saveFilterState when requesting data', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('saveFilterState()');
  });

  // ===========================================================================
  // IQS-871: Keyboard Accessibility
  // ===========================================================================
  it('should include keyboard accessibility setup', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('function setupKeyboardAccessibility(');
    expect(html).toContain('setupKeyboardAccessibility()');
  });

  it('should include tabindex on export buttons', () => {
    const html = generateDashboardHtml(config);

    // All action buttons should have tabindex="0"
    expect(html).toContain('tabindex="0"');
  });

  // ===========================================================================
  // IQS-871: Shared Utility Scripts
  // ===========================================================================
  it('should include shared CSV export utility scripts', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('function exportCsvFromData(');
    expect(html).toContain('function exportCsvFromTable(');
    expect(html).toContain('function downloadCsvBlob(');
  });

  it('should include shared clipboard utility scripts', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('function copyTableToClipboard(');
    expect(html).toContain('navigator.clipboard.writeText');
  });

  it('should include scorecard table with id for export/copy', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('id="scorecardTable"');
  });

  // ===========================================================================
  // IQS-892: Sortable Scorecard Columns
  // ===========================================================================
  it('should include scorecard sorting functions', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('function calculateTotalScore(');
    expect(html).toContain('function sortScorecardData(');
    expect(html).toContain('function updateScorecardSortIndicators(');
    expect(html).toContain('function handleScorecardSort(');
    expect(html).toContain('function renderScorecardRows(');
  });

  it('should include sort state variables', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain("scorecardSortKey = 'totalScore'");
    expect(html).toContain("scorecardSortDirection = 'desc'");
  });

  it('should include sortable header event listeners', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain("#scorecardTable .sortable-header");
    expect(html).toContain("handleScorecardSort(key)");
  });

  it('should include ARIA sort attributes on headers', () => {
    const html = generateDashboardHtml(config);

    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('role="columnheader"');
  });

  it('should include sort indicator characters', () => {
    const html = generateDashboardHtml(config);

    // Neutral indicator
    expect(html).toContain('⇅');
    // Descending indicator (default for Total Score)
    expect(html).toContain('▼');
  });

  it('should include keyboard support for sortable headers', () => {
    const html = generateDashboardHtml(config);

    // Headers should have tabindex for keyboard focus
    expect(html).toContain('tabindex="0"');
    // Enter/Space key handling
    expect(html).toContain("e.key === 'Enter'");
    expect(html).toContain("e.key === ' '");
  });

  it('should export scorecard with all 7 columns', () => {
    const html = generateDashboardHtml(config);

    // CSV export with weighted column headers
    expect(html).toContain("'Release Assist (10%)'");
    expect(html).toContain("'Test (35%)'");
    expect(html).toContain("'Complexity (45%)'");
    expect(html).toContain("'Comments (10%)'");
    expect(html).toContain("'Total Score'");
  });
});
