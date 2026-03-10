import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, Uri } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { generateKnowledgeHtml } from '../../views/webview/knowledge-html.js';
import type { KnowledgeHtmlConfig } from '../../views/webview/knowledge-html.js';

/**
 * Unit tests for knowledge-html.ts (IQS-904).
 * Tests HTML generation for the Knowledge Concentration dashboard webview.
 *
 * Test coverage includes:
 * - CSP nonce presence on all scripts
 * - Required HTML elements for treemap rendering
 * - Accessibility attributes (ARIA labels, roles)
 * - Loading, empty, and error state elements
 * - Filter inputs (repository, concentration risk, contributor)
 * - Legend container with risk tiers
 * - Breadcrumb navigation
 * - At-risk departures table
 * - Data table structures
 * - File action functions (open, filter by contributor)
 */
describe('generateKnowledgeHtml', () => {
  let config: KnowledgeHtmlConfig;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    config = {
      nonce: 'test-nonce-12345',
      d3Uri: Uri.file('/test/d3.min.js'),
      styleUri: Uri.file('/test/knowledge.css'),
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
      const html = generateKnowledgeHtml(config);
      expect(html).toContain(`nonce="${config.nonce}"`);
    });

    it('should include nonce in CSP meta tag', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain(`'nonce-${config.nonce}'`);
    });

    it('should include cspSource in CSP meta tag', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain(config.cspSource);
    });

    it('should not contain unsafe-inline or unsafe-eval', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).not.toContain('unsafe-inline');
      expect(html).not.toContain('unsafe-eval');
    });
  });

  describe('HTML Structure', () => {
    it('should have proper DOCTYPE and html lang attribute', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
    });

    it('should include the D3.js script URI', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('d3.min.js');
    });

    it('should include the stylesheet URI', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('knowledge.css');
    });

    it('should have the page title', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('<title>Knowledge Concentration</title>');
    });

    it('should have the chart header with title', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('<h1>Knowledge Concentration</h1>');
    });
  });

  describe('Chart Elements', () => {
    it('should have chart SVG container', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="chartSvg"');
      expect(html).toContain('class="chart-svg-container"');
    });

    it('should have legend container with treemap-legend class', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="legendContainer"');
      expect(html).toContain('treemap-legend');
    });

    it('should have tooltip element', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="tooltip"');
      expect(html).toContain('class="chart-tooltip"');
    });

    it('should have summary stats container', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="summaryStats"');
      expect(html).toContain('class="summary-stats"');
    });

    it('should have breadcrumb navigation', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="breadcrumb"');
      expect(html).toContain('class="breadcrumb"');
      expect(html).toContain('All Files');
    });
  });

  describe('Filter Controls', () => {
    it('should have repository filter dropdown', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="repoFilter"');
      expect(html).toContain('All Repositories');
    });

    it('should have concentration risk filter dropdown', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="riskFilter"');
      expect(html).toContain('All Risks');
      expect(html).toContain('value="critical"');
      expect(html).toContain('value="high"');
      expect(html).toContain('value="medium"');
      expect(html).toContain('value="low"');
    });

    it('should have contributor filter dropdown', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="contributorFilter"');
      expect(html).toContain('All Contributors');
    });

    it('should have apply filter button', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="applyFilterBtn"');
      expect(html).toContain('Apply');
    });
  });

  describe('State Elements', () => {
    it('should have loading state element', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="loadingState"');
      expect(html).toContain('class="loading-overlay"');
      expect(html).toContain('Loading knowledge concentration data...');
    });

    it('should have error state element', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="errorState"');
    });

    it('should have empty state element', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="emptyState"');
    });

    it('should have chart area element', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="chartArea"');
    });
  });

  describe('At-Risk Departures Table', () => {
    it('should have at-risk container', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="atRiskContainer"');
      expect(html).toContain('At-Risk Departures');
    });

    it('should have at-risk table with correct headers', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="atRiskTable"');
      expect(html).toContain('<th scope="col">Contributor</th>');
      expect(html).toContain('<th scope="col">Critical Files</th>');
      expect(html).toContain('<th scope="col">High Risk Files</th>');
      expect(html).toContain('<th scope="col">Total Files</th>');
      expect(html).toContain('<th scope="col">Actions</th>');
    });
  });

  describe('Full Data Table', () => {
    it('should have data table container', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="dataTableContainer"');
    });

    it('should have data table with correct headers', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="dataTable"');
      expect(html).toContain('<th scope="col">File</th>');
      expect(html).toContain('<th scope="col">Top Owner</th>');
      expect(html).toContain('<th scope="col">Ownership %</th>');
      expect(html).toContain('<th scope="col">Bus Factor</th>');
      expect(html).toContain('<th scope="col">Contributors</th>');
      expect(html).toContain('<th scope="col">Risk</th>');
    });

    it('should have toggle button for table', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="toggleTableBtn"');
      expect(html).toContain('Show all files');
    });
  });

  describe('Export Functionality', () => {
    it('should have export CSV button', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('id="exportCsvBtn"');
      expect(html).toContain('Export CSV');
    });

    it('should include CSV export script', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('exportCsvFromData');
      expect(html).toContain('escapeCsvCell');
    });
  });

  describe('Accessibility', () => {
    it('should have ARIA labels on filter inputs', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('aria-label="Repository filter"');
      expect(html).toContain('aria-label="Concentration risk filter"');
      expect(html).toContain('aria-label="Contributor filter"');
      expect(html).toContain('aria-label="Apply filters"');
      expect(html).toContain('aria-label="Export chart data as CSV"');
    });

    it('should have role attributes on state elements', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('role="status"');
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('role="img"');
      expect(html).toContain('role="navigation"');
    });

    it('should have aria-live on summary stats', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('aria-live="polite"');
    });

    it('should have aria-hidden on tooltip', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('aria-hidden="true"');
    });

    it('should have aria-expanded on table toggle button', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('aria-expanded="false"');
    });

    it('should have tabindex on interactive elements', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('tabindex="0"');
    });
  });

  describe('Risk Tier Colors', () => {
    it('should define colorblind-accessible colors for all risk tiers', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain("critical: '#dc2626'");  // red-600
      expect(html).toContain("high: '#ea580c'");      // orange-600
      expect(html).toContain("medium: '#ca8a04'");    // yellow-600
      expect(html).toContain("low: '#16a34a'");       // green-600
    });
  });

  describe('Message Protocol', () => {
    it('should handle requestFileOwnershipData message type', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain("type: 'requestFileOwnershipData'");
    });

    it('should handle fileOwnershipData response type', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain("case 'fileOwnershipData':");
    });

    it('should handle knowledgeError response type', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain("case 'knowledgeError':");
    });

    it('should handle repositories response type', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain("case 'repositories':");
    });

    it('should handle contributors response type', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain("case 'contributors':");
    });
  });

  describe('File Actions', () => {
    it('should have openFile function', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('function openFile(filePath, repository)');
      expect(html).toContain("type: 'openFile'");
    });

    it('should have filterByContributor function', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('window.filterByContributor = function(contributor)');
      expect(html).toContain("type: 'filterByContributor'");
    });
  });

  describe('HTML Escape Utility', () => {
    it('should include escapeHtml function for XSS prevention', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('function escapeHtml(str)');
      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });
  });

  describe('Chart Instructions', () => {
    it('should include usage instructions', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('Click a file to open it');
      expect(html).toContain('Click contributor name to filter');
      expect(html).toContain('Click module to zoom in');
      expect(html).toContain('Use breadcrumb to zoom out');
    });
  });

  describe('Treemap Features', () => {
    it('should use d3.treemap layout', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('d3.treemap()');
    });

    it('should use d3.hierarchy for data structure', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('d3.hierarchy');
    });

    it('should have zoom navigation functions', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('function zoomTo(path)');
      expect(html).toContain('function updateBreadcrumb(path)');
      expect(html).toContain('currentZoomPath');
    });

    it('should have hierarchy builder function', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('function buildHierarchy(data, zoomPath)');
    });
  });

  describe('Utility Functions', () => {
    it('should have truncateText utility', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('function truncateText(text, maxWidth, fontSize)');
    });

    it('should have getInitials utility for contributor labels', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('function getInitials(name)');
    });
  });

  describe('Summary Statistics', () => {
    it('should render bus factor = 1 count', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('Bus Factor = 1');
    });

    it('should count files by risk level', () => {
      const html = generateKnowledgeHtml(config);
      expect(html).toContain('riskCounts');
      expect(html).toContain('critical: 0, high: 0, medium: 0, low: 0');
    });
  });
});
