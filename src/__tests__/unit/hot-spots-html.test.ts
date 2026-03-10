import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, Uri } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { generateHotSpotsHtml } from '../../views/webview/hot-spots-html.js';
import type { HotSpotsHtmlConfig } from '../../views/webview/hot-spots-html.js';

/**
 * Unit tests for hot-spots-html.ts (IQS-902).
 * Tests HTML generation for the Hot Spots dashboard webview.
 *
 * Test coverage includes:
 * - CSP nonce presence on all scripts
 * - Required HTML elements for bubble chart rendering
 * - Accessibility attributes (ARIA labels, roles)
 * - Loading, empty, and error state elements
 * - Filter inputs (repository, risk tier)
 * - Legend container with risk tiers
 * - Quadrant zone indicators
 * - Data table structures (top 5 and full table)
 * - File action functions (open, history, bugs)
 */
describe('generateHotSpotsHtml', () => {
  let config: HotSpotsHtmlConfig;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    config = {
      nonce: 'test-nonce-12345',
      d3Uri: Uri.file('/test/d3.min.js'),
      styleUri: Uri.file('/test/hot-spots.css'),
      cspSource: 'vscode-webview:',
    };
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('Content Security Policy', () => {
    it('should include nonce in script tags', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain(`nonce="${config.nonce}"`);
    });

    it('should include nonce in CSP meta tag', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain(`'nonce-${config.nonce}'`);
    });

    it('should include cspSource in CSP meta tag', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain(config.cspSource);
    });

    it('should not contain unsafe-inline or unsafe-eval', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).not.toContain('unsafe-inline');
      expect(html).not.toContain('unsafe-eval');
    });
  });

  describe('HTML Structure', () => {
    it('should have proper DOCTYPE and html lang attribute', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
    });

    it('should include the D3.js script URI', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('d3.min.js');
    });

    it('should include the stylesheet URI', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('hot-spots.css');
    });

    it('should have the page title', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('<title>Hot Spots</title>');
    });

    it('should have the chart header with title', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('<h1>Hot Spots</h1>');
    });
  });

  describe('Chart Elements', () => {
    it('should have chart SVG container', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="chartSvg"');
      expect(html).toContain('class="chart-svg-container"');
    });

    it('should have legend container with bubble-legend class', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="legendContainer"');
      expect(html).toContain('bubble-legend');
    });

    it('should have tooltip element', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="tooltip"');
      expect(html).toContain('class="chart-tooltip"');
    });

    it('should have summary stats container', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="summaryStats"');
      expect(html).toContain('class="summary-stats"');
    });

    it('should have quadrant legend with zone indicators', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('class="quadrant-legend"');
      expect(html).toContain('green-zone');
      expect(html).toContain('yellow-zone');
      expect(html).toContain('orange-zone');
      expect(html).toContain('red-zone');
      expect(html).toContain('Low Risk (stable)');
      expect(html).toContain('Critical (refactor urgently)');
    });
  });

  describe('Filter Controls', () => {
    it('should have repository filter dropdown', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="repoFilter"');
      expect(html).toContain('All Repositories');
    });

    it('should have risk tier filter dropdown', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="riskTierFilter"');
      expect(html).toContain('All Tiers');
      expect(html).toContain('value="critical"');
      expect(html).toContain('value="high"');
      expect(html).toContain('value="medium"');
      expect(html).toContain('value="low"');
    });

    it('should have apply filter button', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="applyFilterBtn"');
      expect(html).toContain('Apply');
    });
  });

  describe('State Elements', () => {
    it('should have loading state element', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="loadingState"');
      expect(html).toContain('class="loading-overlay"');
      expect(html).toContain('Loading hot spots data...');
    });

    it('should have error state element', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="errorState"');
    });

    it('should have empty state element', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="emptyState"');
    });

    it('should have chart area element', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="chartArea"');
    });
  });

  describe('Top 5 Hot Spots Table', () => {
    it('should have top 5 container', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="top5Container"');
      expect(html).toContain('Top 5 Hot Spots');
    });

    it('should have top 5 table with correct headers', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="top5Table"');
      expect(html).toContain('<th scope="col">File</th>');
      expect(html).toContain('<th scope="col">Repository</th>');
      expect(html).toContain('<th scope="col">Churn</th>');
      expect(html).toContain('<th scope="col">Complexity</th>');
      expect(html).toContain('<th scope="col">LOC</th>');
      expect(html).toContain('<th scope="col">Bugs</th>');
      expect(html).toContain('<th scope="col">Risk</th>');
    });
  });

  describe('Full Data Table', () => {
    it('should have data table container', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="dataTableContainer"');
    });

    it('should have data table with correct headers', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="dataTable"');
      expect(html).toContain('<th scope="col">Contributors</th>');
      expect(html).toContain('<th scope="col">Last Changed</th>');
      expect(html).toContain('<th scope="col">Risk Tier</th>');
    });

    it('should have toggle button for table', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="toggleTableBtn"');
      expect(html).toContain('Show all hot spots');
    });
  });

  describe('Export Functionality', () => {
    it('should have export CSV button', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('id="exportCsvBtn"');
      expect(html).toContain('Export CSV');
    });

    it('should include CSV export script', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('exportCsvFromData');
      expect(html).toContain('escapeCsvCell');
    });
  });

  describe('Accessibility', () => {
    it('should have ARIA labels on filter inputs', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('aria-label="Repository filter"');
      expect(html).toContain('aria-label="Risk tier filter"');
      expect(html).toContain('aria-label="Apply filters"');
      expect(html).toContain('aria-label="Export chart data as CSV"');
    });

    it('should have role attributes on state elements', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('role="status"');
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('role="img"');
    });

    it('should have aria-live on summary stats', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('aria-live="polite"');
    });

    it('should have aria-hidden on tooltip', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('aria-hidden="true"');
    });

    it('should have aria-expanded on table toggle button', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('aria-expanded="false"');
    });

    it('should have tabindex on interactive elements', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('tabindex="0"');
    });
  });

  describe('Risk Tier Colors', () => {
    it('should define colorblind-accessible colors for all risk tiers', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain("critical: '#e63946'");  // red
      expect(html).toContain("high: '#f67019'");      // orange
      expect(html).toContain("medium: '#f9c74f'");    // yellow
      expect(html).toContain("low: '#2a9d8f'");       // teal
    });
  });

  describe('Message Protocol', () => {
    it('should handle requestHotSpotsData message type', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain("type: 'requestHotSpotsData'");
    });

    it('should handle hotSpotsData response type', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain("case 'hotSpotsData':");
    });

    it('should handle hotSpotsError response type', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain("case 'hotSpotsError':");
    });

    it('should handle repositories response type', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain("case 'repositories':");
    });
  });

  describe('File Actions', () => {
    it('should have openFile function', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('function openFile(filePath, repository)');
      expect(html).toContain("type: 'openFile'");
    });

    it('should have viewHistory function', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('function viewHistory(filePath, repository)');
      expect(html).toContain("type: 'viewHistory'");
    });

    it('should have viewBugs function', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('window.viewBugs = function(filePath, repository, bugCount)');
      expect(html).toContain("type: 'viewBugs'");
    });
  });

  describe('HTML Escape Utility', () => {
    it('should include escapeHtml function for XSS prevention', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('function escapeHtml(str)');
      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });
  });

  describe('Chart Instructions', () => {
    it('should include usage instructions', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('Click a bubble to open the file');
      expect(html).toContain('Right-click for history');
      expect(html).toContain('Use Tab/Enter for keyboard navigation');
    });
  });

  describe('Bubble Chart Features', () => {
    it('should use log scale for X axis (complexity)', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('d3.scaleLog()');
      expect(html).toContain('Cyclomatic Complexity (log scale)');
    });

    it('should have Y axis for churn', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('Churn (commits in last 90 days)');
    });

    it('should scale bubble size by LOC', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('rScale');
      expect(html).toContain('d3.scaleSqrt()');
      expect(html).toContain('d.loc');
    });

    it('should have quadrant zone rendering', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain('medianComplexity');
      expect(html).toContain('medianChurn');
      // Check all four zones are created
      expect(html).toContain('#2a9d8f');  // green zone
      expect(html).toContain('#f9c74f');  // yellow zone
      expect(html).toContain('#f67019');  // orange zone
      expect(html).toContain('#e63946');  // red zone
    });
  });

  describe('Context Menu', () => {
    it('should handle right-click for history view', () => {
      const html = generateHotSpotsHtml(config);
      expect(html).toContain("on('contextmenu'");
      expect(html).toContain('viewHistory(d.filePath, d.repository)');
    });
  });
});
