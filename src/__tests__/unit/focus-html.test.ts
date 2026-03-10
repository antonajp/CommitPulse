/**
 * Unit tests for the Developer Focus Score dashboard HTML generator.
 * Tests HTML content generation, CSP configuration, and filter elements.
 *
 * Ticket: IQS-908
 */

import { describe, it, expect } from 'vitest';
import { generateFocusHtml, type FocusHtmlConfig } from '../../views/webview/focus-html.js';

/**
 * Mock vscode.Uri interface for testing.
 */
interface MockUri {
  toString(): string;
}

/**
 * Create a mock config for testing.
 */
function createMockConfig(overrides?: Partial<FocusHtmlConfig>): FocusHtmlConfig {
  const defaultD3Uri: MockUri = {
    toString: () => 'vscode-webview://d3.min.js',
  };
  const defaultStyleUri: MockUri = {
    toString: () => 'vscode-webview://focus.css',
  };

  return {
    nonce: 'test-nonce-12345',
    d3Uri: defaultD3Uri as unknown as import('vscode').Uri,
    styleUri: defaultStyleUri as unknown as import('vscode').Uri,
    cspSource: 'vscode-webview:',
    ...overrides,
  };
}

describe('generateFocusHtml', () => {
  describe('HTML structure', () => {
    it('should generate valid HTML5 document', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include proper meta tags', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('<meta charset="UTF-8">');
      expect(html).toContain('<meta name="viewport"');
    });

    it('should include title', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('<title>Developer Focus</title>');
    });

    it('should include chart header with title', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('<h1>Developer Focus Score</h1>');
    });
  });

  describe('Content Security Policy', () => {
    it('should include CSP meta tag with nonce', () => {
      const config = createMockConfig({ nonce: 'unique-nonce-abc123' });
      const html = generateFocusHtml(config);

      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(html).toContain("'nonce-unique-nonce-abc123'");
    });

    it('should include CSP source in policy', () => {
      const config = createMockConfig({ cspSource: 'vscode-webview:' });
      const html = generateFocusHtml(config);

      expect(html).toContain('vscode-webview:');
    });

    it('should set default-src to none', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain("default-src 'none'");
    });
  });

  describe('Resource loading', () => {
    it('should include D3.js script tag with nonce', () => {
      const config = createMockConfig({ nonce: 'test-nonce' });
      const html = generateFocusHtml(config);

      expect(html).toContain('nonce="test-nonce"');
      expect(html).toContain('src="vscode-webview://d3.min.js"');
    });

    it('should include stylesheet link', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('rel="stylesheet"');
      expect(html).toContain('href="vscode-webview://focus.css"');
    });
  });

  describe('Filter controls', () => {
    it('should include start date filter', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="startDate"');
      expect(html).toContain('type="date"');
      expect(html).toContain('Start Date');
    });

    it('should include end date filter', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="endDate"');
      expect(html).toContain('End Date');
    });

    it('should include developer filter', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="developerFilter"');
      expect(html).toContain('multiple');
      expect(html).toContain('Developers');
    });

    it('should include focus category filter', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="focusCategoryFilter"');
      expect(html).toContain('Focus Category');
      expect(html).toContain('Deep Focus');
      expect(html).toContain('Moderate Focus');
      expect(html).toContain('Fragmented');
      expect(html).toContain('Highly Fragmented');
    });

    it('should include apply filter button', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="applyFilterBtn"');
      expect(html).toContain('Apply');
    });

    it('should include export CSV button', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="exportCsvBtn"');
      expect(html).toContain('Export CSV');
    });
  });

  describe('Chart areas', () => {
    it('should include SVG chart container', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="chartSvg"');
      expect(html).toContain('class="chart-svg-container"');
    });

    it('should include loading state', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="loadingState"');
      expect(html).toContain('class="loading-overlay"');
      expect(html).toContain('Loading developer focus data');
    });

    it('should include error state container', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="errorState"');
    });

    it('should include empty state container', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="emptyState"');
    });

    it('should include summary stats container', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="summaryStats"');
      expect(html).toContain('class="summary-stats"');
    });
  });

  describe('Drill-down panel', () => {
    it('should include drill-down panel', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="drillDownPanel"');
      expect(html).toContain('class="drill-down-panel"');
    });

    it('should include drill-down title', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="drillDownTitle"');
    });

    it('should include drill-down content area', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="drillDownContent"');
    });

    it('should include close button', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="closeDrillDown"');
    });
  });

  describe('Alerts container', () => {
    it('should include alerts container', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="alertsContainer"');
      expect(html).toContain('Declining Focus Alerts');
    });

    it('should include alerts list', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="alertsList"');
      expect(html).toContain('3+ consecutive weeks');
    });
  });

  describe('Top developers container', () => {
    it('should include top developers container', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="topDevelopersContainer"');
      expect(html).toContain('Team Focus Summary');
    });

    it('should include most focused list', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="mostFocusedList"');
      expect(html).toContain('Most Focused');
    });

    it('should include needs attention list', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="needsAttentionList"');
      expect(html).toContain('Needs Attention');
    });
  });

  describe('Accessibility', () => {
    it('should include aria labels on interactive elements', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('aria-label="Start date filter"');
      expect(html).toContain('aria-label="End date filter"');
      expect(html).toContain('aria-label="Developer filter"');
      expect(html).toContain('aria-label="Focus category filter"');
      expect(html).toContain('aria-label="Apply filters"');
      expect(html).toContain('aria-label="Export chart data as CSV"');
    });

    it('should include role attributes', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('role="status"');
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('role="img"');
    });

    it('should include tabindex for keyboard navigation', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('tabindex="0"');
    });

    it('should include aria-live for dynamic content', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('aria-live="polite"');
    });
  });

  describe('Legend', () => {
    it('should include legend container', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="legendContainer"');
      expect(html).toContain('class="chart-legend focus-legend"');
    });
  });

  describe('Tooltip', () => {
    it('should include tooltip element', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('id="tooltip"');
      expect(html).toContain('class="chart-tooltip"');
      expect(html).toContain('aria-hidden="true"');
    });
  });

  describe('Chart instructions', () => {
    it('should include usage instructions', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('class="chart-instructions"');
      expect(html).toContain('Hover over lines');
      expect(html).toContain('Click a data point');
    });
  });

  describe('JavaScript functionality', () => {
    it('should include escapeHtml function', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('function escapeHtml(str)');
    });

    it('should include VS Code API acquisition', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('acquireVsCodeApi()');
    });

    it('should include message handling', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain("window.addEventListener('message'");
      expect(html).toContain("case 'focusData'");
      expect(html).toContain("case 'focusTrendData'");
      expect(html).toContain("case 'focusError'");
    });

    it('should include CSV export functionality', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('exportCsvFromData');
    });

    it('should include chart rendering', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('function renderChart');
    });

    it('should include focus zones', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('FOCUS_ZONES');
      expect(html).toContain('deep_focus');
      expect(html).toContain('moderate_focus');
      expect(html).toContain('fragmented');
      expect(html).toContain('highly_fragmented');
    });

    it('should include category colors', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('CATEGORY_COLORS');
      expect(html).toContain('#22c55e'); // green
      expect(html).toContain('#f59e0b'); // amber
      expect(html).toContain('#f97316'); // orange
      expect(html).toContain('#ef4444'); // red
    });

    it('should include tooltip functions', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('function showPointTooltip');
      expect(html).toContain('function hideTooltip');
      expect(html).toContain('function moveTooltip');
    });

    it('should include drill-down request functions', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('function requestDeveloperDrillDown');
      expect(html).toContain('function requestWeekDrillDown');
    });

    it('should include alerts rendering', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('function renderAlerts');
    });

    it('should include top developers rendering', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('function renderTopDevelopers');
    });

    it('should include initial data request', () => {
      const config = createMockConfig();
      const html = generateFocusHtml(config);

      expect(html).toContain('requestData()');
    });
  });
});
