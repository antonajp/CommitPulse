import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, Uri } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { generateDevPipelineHtml } from '../../views/webview/dev-pipeline-html.js';
import type { DevPipelineHtmlConfig } from '../../views/webview/dev-pipeline-html.js';

/**
 * Unit tests for dev-pipeline-html.ts (IQS-897, IQS-921, IQS-929).
 * Tests HTML generation for the Development Pipeline dashboard webview.
 *
 * Test coverage includes:
 * - CSP nonce presence on all scripts
 * - Required HTML elements for 4 separate chart rendering (IQS-929)
 * - Team filter dropdown (required)
 * - Accessibility attributes (ARIA labels, roles)
 * - Loading, empty, and error state elements
 * - Date filter inputs
 * - Developer legend shared across all charts
 * - Okabe-Ito colorblind-safe palette
 * - Jira/Linear URL prefix injection
 */
describe('generateDevPipelineHtml', () => {
  let config: DevPipelineHtmlConfig;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    config = {
      nonce: 'test-nonce-12345',
      d3Uri: Uri.file('/test/d3.min.js'),
      styleUri: Uri.file('/test/dev-pipeline.css'),
      cspSource: 'vscode-webview:',
      jiraUrlPrefix: 'https://test.atlassian.net',
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
      const html = generateDevPipelineHtml(config);
      expect(html).toContain(`nonce="${config.nonce}"`);
    });

    it('should include nonce in CSP meta tag', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain(`'nonce-${config.nonce}'`);
    });

    it('should include cspSource in CSP meta tag', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain(config.cspSource);
    });

    it('should not contain unsafe-inline or unsafe-eval', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).not.toContain('unsafe-inline');
      expect(html).not.toContain('unsafe-eval');
    });
  });

  describe('HTML Structure', () => {
    it('should have proper DOCTYPE and html lang attribute', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
    });

    it('should include the D3.js script URI', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('d3.min.js');
    });

    it('should include the stylesheet URI', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('dev-pipeline.css');
    });

    it('should have the page title', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('<title>Development Pipeline</title>');
    });

    it('should have the dashboard header with metrics title', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('Development Pipeline Metrics');
    });
  });

  describe('Four Separate Charts (IQS-929)', () => {
    it('should have LOC chart container', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="locChartCard"');
      expect(html).toContain('id="locChart"');
      expect(html).toContain('Lines of Code');
    });

    it('should have Complexity chart container', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="complexityChartCard"');
      expect(html).toContain('id="complexityChart"');
      expect(html).toContain('Code Complexity');
    });

    it('should have Comments Ratio chart container', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="commentsChartCard"');
      expect(html).toContain('id="commentsChart"');
      expect(html).toContain('Comments Ratio');
    });

    it('should have Tests chart container', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="testsChartCard"');
      expect(html).toContain('id="testsChart"');
      expect(html).toContain('Test Coverage');
    });

    it('should have chart area container for all charts', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="chartArea"');
      expect(html).toContain('class="dev-pipeline-charts"');
    });

    it('should have summary stats container', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="summaryStats"');
      expect(html).toContain('class="summary-stats"');
    });
  });

  describe('Team Filter (IQS-929)', () => {
    it('should have team filter dropdown', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="devPipelineTeamFilter"');
      expect(html).toContain('Select Team');
    });

    it('should mark team filter as required', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('devPipelineTeamFilter');
      expect(html).toContain('required');
    });

    it('should have team filter label', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('for="devPipelineTeamFilter"');
      expect(html).toContain('Team:');
    });
  });

  describe('Date Filters', () => {
    it('should have start date input', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="devPipelineStartDate"');
      expect(html).toContain('type="date"');
    });

    it('should have end date input', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="devPipelineEndDate"');
    });

    it('should have apply filter button', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="devPipelineApplyBtn"');
    });
  });

  describe('State Elements', () => {
    it('should have loading state element', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="loadingState"');
      expect(html).toContain('class="loading-overlay"');
      expect(html).toContain('Loading development pipeline data...');
    });

    it('should have error state element', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="errorState"');
    });

    it('should have empty state element', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="emptyState"');
      expect(html).toContain('No commits found');
    });

    it('should have chart area element', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="chartArea"');
    });
  });

  describe('Developer Legend (IQS-929)', () => {
    it('should have shared developer legend container', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="devPipelineDeveloperLegend"');
      expect(html).toContain('class="developer-legend"');
    });

    it('should have ARIA label on legend', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('aria-label="Developer color legend"');
    });
  });

  describe('Export Functionality', () => {
    it('should have export CSV button', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="exportCsvBtn"');
      expect(html).toContain('Export CSV');
    });

    it('should include CSV export script', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('exportCsvFromData');
    });
  });

  describe('Accessibility', () => {
    it('should have ARIA labels on filter inputs', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('aria-label="Start date filter"');
      expect(html).toContain('aria-label="End date filter"');
      expect(html).toContain('aria-label="Apply filters"');
      expect(html).toContain('aria-label="Team filter (required)"');
    });

    it('should have role attributes on state elements', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('role="status"');
      expect(html).toContain('role="img"');
    });

    it('should have aria-live on summary stats', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('aria-live="polite"');
    });

    it('should have ARIA labels on chart SVGs', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('aria-label="Weekly LOC delta by developer"');
      expect(html).toContain('aria-label="Weekly complexity delta by developer"');
      expect(html).toContain('aria-label="Weekly comments ratio by developer"');
      expect(html).toContain('aria-label="Weekly test LOC delta by developer"');
    });
  });

  describe('URL Prefix Configuration (IQS-926)', () => {
    it('should inject Jira URL prefix into script', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('https://test.atlassian.net');
      expect(html).toContain('JIRA_URL_PREFIX');
    });

    it('should inject Linear URL prefix into script', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('https://linear.company.com');
      expect(html).toContain('LINEAR_URL_PREFIX');
    });

    it('should handle empty URL prefixes', () => {
      const emptyConfig = { ...config, jiraUrlPrefix: '', linearUrlPrefix: '' };
      const html = generateDevPipelineHtml(emptyConfig);
      expect(html).toContain('JIRA_URL_PREFIX');
      expect(html).toContain('LINEAR_URL_PREFIX');
    });
  });

  describe('Message Protocol (IQS-929)', () => {
    it('should handle requestDevPipelineTeamList message type', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain("type: 'requestDevPipelineTeamList'");
    });

    it('should handle requestDevPipelineWeeklyMetrics message type', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain("type: 'requestDevPipelineWeeklyMetrics'");
    });

    it('should handle devPipelineTeamList response type', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain("case 'devPipelineTeamList':");
    });

    it('should handle devPipelineWeeklyMetrics response type', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain("case 'devPipelineWeeklyMetrics':");
    });
  });

  describe('HTML Escape Utility', () => {
    it('should include escapeHtml function for XSS prevention', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('function escapeHtml(str)');
      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });
  });

  describe('Chart Explanation', () => {
    it('should include collapsible explanation section', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('class="chart-explanation"');
      expect(html).toContain('What does this dashboard show?');
    });

    it('should explain the dashboard purpose', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('four key code quality metrics');
      expect(html).toContain('aggregated weekly');
    });
  });

  describe('Developer Coloring (IQS-921)', () => {
    it('should include Okabe-Ito colorblind-safe palette', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('DEVELOPER_COLORS');
    });

    it('should include getDeveloperColor function', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('getDeveloperColor');
    });
  });

  describe('Chart Rendering Functions (IQS-929)', () => {
    it('should include LOC chart rendering function', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('renderLocChart');
    });

    it('should include Complexity chart rendering function', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('renderComplexityChart');
    });

    it('should include Comments chart rendering function', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('renderCommentsChart');
    });

    it('should include Tests chart rendering function', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('renderTestsChart');
    });

    it('should include developer legend rendering function', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('renderDeveloperLegend');
    });
  });

  describe('Tooltip', () => {
    it('should have tooltip element', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('id="tooltip"');
      expect(html).toContain('class="chart-tooltip"');
    });

    it('should have tooltip accessibility attributes', () => {
      const html = generateDevPipelineHtml(config);
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('aria-hidden="true"');
    });
  });
});
