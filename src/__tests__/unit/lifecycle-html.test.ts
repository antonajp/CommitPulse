/**
 * Unit tests for the Ticket Lifecycle dashboard HTML generator.
 * Tests HTML content generation, CSP configuration, and filter elements.
 *
 * Ticket: IQS-906
 */

import { describe, it, expect } from 'vitest';
import { generateLifecycleHtml, type LifecycleHtmlConfig } from '../../views/webview/lifecycle-html.js';

/**
 * Mock vscode.Uri interface for testing.
 */
interface MockUri {
  toString(): string;
}

/**
 * Create a mock config for testing.
 */
function createMockConfig(overrides?: Partial<LifecycleHtmlConfig>): LifecycleHtmlConfig {
  const defaultD3Uri: MockUri = {
    toString: () => 'vscode-webview://d3.min.js',
  };
  const defaultStyleUri: MockUri = {
    toString: () => 'vscode-webview://lifecycle.css',
  };

  return {
    nonce: 'test-nonce-12345',
    d3Uri: defaultD3Uri as unknown as import('vscode').Uri,
    styleUri: defaultStyleUri as unknown as import('vscode').Uri,
    cspSource: 'vscode-webview:',
    ...overrides,
  };
}

describe('generateLifecycleHtml', () => {
  describe('HTML structure', () => {
    it('should generate valid HTML5 document', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include proper meta tags', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('<meta charset="UTF-8">');
      expect(html).toContain('<meta name="viewport"');
    });

    it('should include title', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('<title>Ticket Lifecycle</title>');
    });

    it('should include chart header with title', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('<h1>Ticket Lifecycle</h1>');
    });
  });

  describe('Content Security Policy', () => {
    it('should include CSP meta tag with nonce', () => {
      const config = createMockConfig({ nonce: 'unique-nonce-abc123' });
      const html = generateLifecycleHtml(config);

      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(html).toContain("'nonce-unique-nonce-abc123'");
    });

    it('should include CSP source in policy', () => {
      const config = createMockConfig({ cspSource: 'vscode-webview:' });
      const html = generateLifecycleHtml(config);

      expect(html).toContain('vscode-webview:');
    });

    it('should set default-src to none', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain("default-src 'none'");
    });
  });

  describe('Resource loading', () => {
    it('should include D3.js script tag with nonce', () => {
      const config = createMockConfig({ nonce: 'test-nonce' });
      const html = generateLifecycleHtml(config);

      expect(html).toContain('nonce="test-nonce"');
      expect(html).toContain('src="vscode-webview://d3.min.js"');
    });

    it('should include stylesheet link', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('rel="stylesheet"');
      expect(html).toContain('href="vscode-webview://lifecycle.css"');
    });
  });

  describe('Filter controls', () => {
    it('should include start date filter', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="startDate"');
      expect(html).toContain('type="date"');
      expect(html).toContain('Start Date');
    });

    it('should include end date filter', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="endDate"');
      expect(html).toContain('End Date');
    });

    it('should include ticket type filter', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="ticketTypeFilter"');
      expect(html).toContain('Ticket Source');
      expect(html).toContain('>Jira<');
      expect(html).toContain('>Linear<');
    });

    it('should include issue type filter', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="issueTypeFilter"');
      expect(html).toContain('Issue Type');
    });

    it('should include rework toggle', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="reworkToggle"');
      expect(html).toContain('Show Rework');
      expect(html).toContain('Highlight Rework');
      expect(html).toContain('Hide Rework');
    });

    it('should include apply filter button', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="applyFilterBtn"');
      expect(html).toContain('Apply');
    });

    it('should include export CSV button', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="exportCsvBtn"');
      expect(html).toContain('Export CSV');
    });
  });

  describe('Chart areas', () => {
    it('should include SVG chart container', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="chartSvg"');
      expect(html).toContain('class="chart-svg-container"');
    });

    it('should include loading state', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="loadingState"');
      expect(html).toContain('class="loading-overlay"');
      expect(html).toContain('Loading ticket lifecycle data');
    });

    it('should include error state container', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="errorState"');
    });

    it('should include empty state container', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="emptyState"');
    });

    it('should include summary stats container', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="summaryStats"');
      expect(html).toContain('class="summary-stats"');
    });
  });

  describe('Drill-down panel', () => {
    it('should include drill-down panel', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="drillDownPanel"');
      expect(html).toContain('class="drill-down-panel"');
    });

    it('should include drill-down title', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="drillDownTitle"');
    });

    it('should include drill-down content area', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="drillDownContent"');
    });

    it('should include close button', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="closeDrillDown"');
    });
  });

  describe('Bottlenecks table', () => {
    it('should include bottlenecks container', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="bottlenecksContainer"');
      expect(html).toContain('Top Bottleneck Transitions');
    });

    it('should include bottlenecks table', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="bottlenecksTable"');
      expect(html).toContain('From');
      expect(html).toContain('To');
      expect(html).toContain('Count');
      expect(html).toContain('Avg Dwell (hrs)');
      expect(html).toContain('Rework %');
    });
  });

  describe('Accessibility', () => {
    it('should include aria labels on interactive elements', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('aria-label="Start date filter"');
      expect(html).toContain('aria-label="End date filter"');
      expect(html).toContain('aria-label="Ticket type filter"');
      expect(html).toContain('aria-label="Issue type filter"');
      expect(html).toContain('aria-label="Rework visibility toggle"');
      expect(html).toContain('aria-label="Apply filters"');
      expect(html).toContain('aria-label="Export chart data as CSV"');
    });

    it('should include role attributes', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('role="status"');
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('role="img"');
    });

    it('should include tabindex for keyboard navigation', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('tabindex="0"');
    });

    it('should include aria-live for dynamic content', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('aria-live="polite"');
    });
  });

  describe('Legend', () => {
    it('should include legend container', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="legendContainer"');
      expect(html).toContain('class="chart-legend sankey-legend"');
    });
  });

  describe('Tooltip', () => {
    it('should include tooltip element', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('id="tooltip"');
      expect(html).toContain('class="chart-tooltip"');
      expect(html).toContain('aria-hidden="true"');
    });
  });

  describe('Chart instructions', () => {
    it('should include usage instructions', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('class="chart-instructions"');
      expect(html).toContain('Hover over nodes');
      expect(html).toContain('Click a link');
    });
  });

  describe('JavaScript functionality', () => {
    it('should include escapeHtml function', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('function escapeHtml(str)');
    });

    it('should include VS Code API acquisition', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('acquireVsCodeApi()');
    });

    it('should include message handling', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain("window.addEventListener('message'");
      expect(html).toContain("case 'sankeyData'");
      expect(html).toContain("case 'matrixData'");
      expect(html).toContain("case 'lifecycleError'");
    });

    it('should include CSV export functionality', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('exportCsvFromData');
    });

    it('should include Sankey rendering', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('function renderSankey');
    });

    it('should include category colors', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('CATEGORY_COLORS');
      expect(html).toContain('backlog');
      expect(html).toContain('in_progress');
      expect(html).toContain('review');
      expect(html).toContain('done');
    });

    it('should include rework color', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('REWORK_COLOR');
      expect(html).toContain('#ef4444');
    });

    it('should include tooltip functions', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('function showNodeTooltip');
      expect(html).toContain('function showLinkTooltip');
      expect(html).toContain('function hideTooltip');
    });

    it('should include drill-down request functions', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('function requestTransitionDrillDown');
      expect(html).toContain('function requestStatusDrillDown');
    });

    it('should include initial data request', () => {
      const config = createMockConfig();
      const html = generateLifecycleHtml(config);

      expect(html).toContain('requestData()');
    });
  });
});
