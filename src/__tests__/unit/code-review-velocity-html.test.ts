import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, Uri } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { generateCodeReviewVelocityHtml } from '../../views/webview/code-review-velocity-html.js';
import type { CodeReviewVelocityHtmlConfig } from '../../views/webview/code-review-velocity-html.js';

/**
 * Unit tests for code-review-velocity-html.ts (IQS-900).
 * Tests HTML generation for the Code Review Velocity dashboard webview.
 *
 * Test coverage includes:
 * - CSP nonce presence on all scripts
 * - Required HTML elements for scatter plot rendering
 * - Accessibility attributes (ARIA labels, roles)
 * - Loading, empty, and error state elements
 * - Filter inputs (date range, repository, size category)
 * - Legend container with size categories
 * - Quadrant zone indicators
 * - Data table structure
 * - GitHub organization injection for PR links
 */
describe('generateCodeReviewVelocityHtml', () => {
  let config: CodeReviewVelocityHtmlConfig;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    config = {
      nonce: 'test-nonce-12345',
      d3Uri: Uri.file('/test/d3.min.js'),
      styleUri: Uri.file('/test/code-review-velocity.css'),
      cspSource: 'vscode-webview:',
      githubOrg: 'test-org',
      jiraUrlPrefix: 'https://jira.company.com',
      linearUrlPrefix: 'https://linear.company.com',
    };
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('Content Security Policy', () => {
    it('should include nonce in script tags', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain(`nonce="${config.nonce}"`);
    });

    it('should include nonce in CSP meta tag', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain(`'nonce-${config.nonce}'`);
    });

    it('should include cspSource in CSP meta tag', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain(config.cspSource);
    });

    it('should not contain unsafe-inline or unsafe-eval', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).not.toContain('unsafe-inline');
      expect(html).not.toContain('unsafe-eval');
    });
  });

  describe('HTML Structure', () => {
    it('should have proper DOCTYPE and html lang attribute', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
    });

    it('should include the D3.js script URI', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('d3.min.js');
    });

    it('should include the stylesheet URI', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('code-review-velocity.css');
    });

    it('should have the page title', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('<title>Code Review Velocity</title>');
    });

    it('should have the chart header with title', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('<h1>Code Review Velocity</h1>');
    });
  });

  describe('Chart Elements', () => {
    it('should have chart SVG container', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="chartSvg"');
      expect(html).toContain('class="chart-svg-container"');
    });

    it('should have legend container with scatter-legend class', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="legendContainer"');
      expect(html).toContain('scatter-legend');
    });

    it('should have tooltip element', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="tooltip"');
      expect(html).toContain('class="chart-tooltip"');
    });

    it('should have summary stats container', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="summaryStats"');
      expect(html).toContain('class="summary-stats"');
    });

    it('should have quadrant legend with zone indicators', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('class="quadrant-legend"');
      expect(html).toContain('green-zone');
      expect(html).toContain('red-zone');
      expect(html).toContain('Fast & Small (ideal)');
      expect(html).toContain('Slow & Large (needs attention)');
    });
  });

  describe('Filter Controls', () => {
    it('should have start date input', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="startDate"');
      expect(html).toContain('type="date"');
    });

    it('should have end date input', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="endDate"');
    });

    it('should have repository filter dropdown', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="repoFilter"');
      expect(html).toContain('All Repositories');
    });

    it('should have size category filter dropdown', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="sizeFilter"');
      expect(html).toContain('All Sizes');
      expect(html).toContain('XS (1-10 LOC)');
      expect(html).toContain('S (11-50 LOC)');
      expect(html).toContain('M (51-250 LOC)');
      expect(html).toContain('L (251-1000 LOC)');
      expect(html).toContain('XL (1000+ LOC)');
    });

    it('should have apply filter button', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="applyFilterBtn"');
      expect(html).toContain('Apply');
    });
  });

  describe('State Elements', () => {
    it('should have loading state element', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="loadingState"');
      expect(html).toContain('class="loading-overlay"');
      expect(html).toContain('Loading code review velocity data...');
    });

    it('should have error state element', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="errorState"');
    });

    it('should have empty state element', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="emptyState"');
    });

    it('should have chart area element', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="chartArea"');
    });
  });

  describe('Data Table', () => {
    it('should have data table container', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="dataTableContainer"');
    });

    it('should have data table with correct headers', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="dataTable"');
      expect(html).toContain('<th scope="col">PR</th>');
      expect(html).toContain('<th scope="col">Title</th>');
      expect(html).toContain('<th scope="col">Author</th>');
      expect(html).toContain('<th scope="col">Repository</th>');
      expect(html).toContain('<th scope="col">LOC</th>');
      expect(html).toContain('<th scope="col">Hrs to Review</th>');
      expect(html).toContain('<th scope="col">Hrs to Merge</th>');
      expect(html).toContain('<th scope="col">Review Cycles</th>');
      expect(html).toContain('<th scope="col">Size</th>');
      expect(html).toContain('<th scope="col">Ticket</th>');
    });

    it('should have toggle button for table', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="toggleTableBtn"');
      expect(html).toContain('Show data table');
    });
  });

  describe('Export Functionality', () => {
    it('should have export CSV button', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('id="exportCsvBtn"');
      expect(html).toContain('Export CSV');
    });

    it('should include CSV export script', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('exportCsvFromData');
      expect(html).toContain('escapeCsvCell');
    });
  });

  describe('Accessibility', () => {
    it('should have ARIA labels on filter inputs', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('aria-label="Start date filter"');
      expect(html).toContain('aria-label="End date filter"');
      expect(html).toContain('aria-label="Repository filter"');
      expect(html).toContain('aria-label="Size category filter"');
      expect(html).toContain('aria-label="Apply filters"');
      expect(html).toContain('aria-label="Export chart data as CSV"');
    });

    it('should have role attributes on state elements', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('role="status"');
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('role="img"');
    });

    it('should have aria-live on summary stats', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('aria-live="polite"');
    });

    it('should have aria-hidden on tooltip', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('aria-hidden="true"');
    });

    it('should have aria-expanded on table toggle button', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('aria-expanded="false"');
    });

    it('should have tabindex on interactive elements', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('tabindex="0"');
    });
  });

  describe('Size Category Colors', () => {
    it('should define colorblind-accessible colors for all size categories', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain("XS: '#4dc9f6'");  // cyan
      expect(html).toContain("S: '#2a9d8f'");   // teal
      expect(html).toContain("M: '#f9c74f'");   // yellow
      expect(html).toContain("L: '#f67019'");   // orange
      expect(html).toContain("XL: '#e63946'");  // red
    });
  });

  describe('GitHub Organization Configuration', () => {
    it('should inject GitHub organization into script', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('var GITHUB_ORG = "test-org"');
    });

    it('should handle empty GitHub organization', () => {
      const emptyOrgConfig = { ...config, githubOrg: '' };
      const html = generateCodeReviewVelocityHtml(emptyOrgConfig);
      expect(html).toContain('var GITHUB_ORG = ""');
    });
  });

  describe('Message Protocol', () => {
    it('should handle requestCodeReviewData message type', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain("type: 'requestCodeReviewData'");
    });

    it('should handle codeReviewData response type', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain("case 'codeReviewData':");
    });

    it('should handle codeReviewError response type', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain("case 'codeReviewError':");
    });
  });

  describe('Click Actions', () => {
    it('should have openPR function using message protocol (IQS-926)', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('function openPR(repository, prNumber)');
      // Now uses message protocol instead of window.open
      expect(html).toContain("type: 'openExternal'");
    });

    it('should have openTicket function for linked tickets', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('window.openTicket = function(ticketId, ticketType)');
    });

    it('should use message protocol for ticket links (IQS-926)', () => {
      const html = generateCodeReviewVelocityHtml(config);
      // Ticket links now use message protocol instead of direct URL construction
      expect(html).toContain("type: 'openTicket'");
      expect(html).toContain('ticketId: ticketId');
      expect(html).toContain('ticketType: ticketType');
      expect(html).toContain('jiraUrlPrefix: JIRA_URL_PREFIX');
      expect(html).toContain('linearUrlPrefix: LINEAR_URL_PREFIX');
    });

    it('should inject URL prefix configuration', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('var JIRA_URL_PREFIX');
      expect(html).toContain('var LINEAR_URL_PREFIX');
      expect(html).toContain('https://jira.company.com');
      expect(html).toContain('https://linear.company.com');
    });
  });

  describe('HTML Escape Utility', () => {
    it('should include escapeHtml function for XSS prevention', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('function escapeHtml(str)');
      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });
  });

  describe('Chart Instructions', () => {
    it('should include usage instructions', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('Click a data point to open the PR in GitHub');
      expect(html).toContain('Use Tab/Enter for keyboard navigation');
    });
  });

  describe('Scatter Plot Features', () => {
    it('should use log scale for X axis (LOC)', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('d3.scaleLog()');
      expect(html).toContain('Lines of Code Changed (log scale)');
    });

    it('should have trend line calculation', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('slope');
      expect(html).toContain('intercept');
    });

    it('should have outlier detection', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('isOutlier');
      expect(html).toContain('residualStd');
    });

    it('should scale point size by review cycles', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('rScale');
      expect(html).toContain('d3.scaleSqrt()');
    });
  });

  describe('Default Date Range', () => {
    it('should have function to set default date range', () => {
      const html = generateCodeReviewVelocityHtml(config);
      expect(html).toContain('function setDefaultDateRange()');
      expect(html).toContain('setDate(startDate.getDate() - 90)');
    });
  });
});
