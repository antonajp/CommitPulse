/**
 * Unit tests for the Test Debt Predictor dashboard HTML generator.
 * Tests HTML content generation, CSP configuration, and filter elements.
 *
 * Ticket: IQS-914
 */

import { describe, it, expect } from 'vitest';
import { generateTestDebtHtml, type TestDebtHtmlConfig } from '../../views/webview/test-debt-html.js';

/**
 * Mock vscode.Uri interface for testing.
 */
interface MockUri {
  toString(): string;
}

/**
 * Create a mock config for testing.
 */
function createMockConfig(overrides?: Partial<TestDebtHtmlConfig>): TestDebtHtmlConfig {
  const defaultD3Uri: MockUri = {
    toString: () => 'vscode-webview://d3.min.js',
  };
  const defaultStyleUri: MockUri = {
    toString: () => 'vscode-webview://test-debt.css',
  };

  return {
    nonce: 'test-nonce-12345',
    d3Uri: defaultD3Uri as unknown as import('vscode').Uri,
    styleUri: defaultStyleUri as unknown as import('vscode').Uri,
    cspSource: 'vscode-webview:',
    ...overrides,
  };
}

describe('generateTestDebtHtml', () => {
  describe('HTML structure', () => {
    it('should generate valid HTML5 document', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include proper meta tags', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('<meta charset="UTF-8">');
      expect(html).toContain('<meta name="viewport"');
    });

    it('should include title', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('<title>Test Debt Predictor</title>');
    });

    it('should include chart header with title', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('<h1>Test Debt Predictor</h1>');
    });
  });

  describe('Content Security Policy', () => {
    it('should include CSP meta tag with nonce', () => {
      const config = createMockConfig({ nonce: 'unique-nonce-abc123' });
      const html = generateTestDebtHtml(config);

      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(html).toContain("'nonce-unique-nonce-abc123'");
    });

    it('should include CSP source in policy', () => {
      const config = createMockConfig({ cspSource: 'vscode-webview:' });
      const html = generateTestDebtHtml(config);

      expect(html).toContain('vscode-webview:');
    });

    it('should set default-src to none', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain("default-src 'none'");
    });
  });

  describe('Resource loading', () => {
    it('should include D3.js script tag with nonce', () => {
      const config = createMockConfig({ nonce: 'test-nonce' });
      const html = generateTestDebtHtml(config);

      expect(html).toContain('nonce="test-nonce"');
      expect(html).toContain('src="vscode-webview://d3.min.js"');
    });

    it('should include stylesheet link', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('rel="stylesheet"');
      expect(html).toContain('href="vscode-webview://test-debt.css"');
    });
  });

  describe('Filter controls', () => {
    it('should include repository filter', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="repositoryFilter"');
      expect(html).toContain('Repository');
    });

    it('should include author filter', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="authorFilter"');
      expect(html).toContain('Author');
    });

    it('should include start date filter', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="startDate"');
      expect(html).toContain('type="date"');
      expect(html).toContain('Start Date');
    });

    it('should include end date filter', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="endDate"');
      expect(html).toContain('End Date');
    });

    it('should include apply filter button', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="applyFilterBtn"');
      expect(html).toContain('Apply');
    });

    it('should include export CSV button', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="exportCsvBtn"');
      expect(html).toContain('Export CSV');
    });
  });

  describe('ROI Metric', () => {
    it('should include ROI metric container', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="roiMetric"');
      expect(html).toContain('class="roi-metric"');
    });
  });

  describe('Tier toggles', () => {
    it('should include low tier toggle', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="showLowTier"');
      expect(html).toContain('Low Coverage');
    });

    it('should include medium tier toggle', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="showMediumTier"');
      expect(html).toContain('Medium Coverage');
    });

    it('should include high tier toggle', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="showHighTier"');
      expect(html).toContain('High Coverage');
    });
  });

  describe('Charts', () => {
    it('should include stacked bar chart container', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="stackedBarSvg"');
      expect(html).toContain('Weekly Test Debt Trend');
    });

    it('should include scatter plot container', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="scatterSvg"');
      expect(html).toContain('Test Coverage vs Bug Rate');
    });

    it('should include correlation stats container', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="correlationStats"');
    });
  });

  describe('Commits table', () => {
    it('should include risky commits section', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('Risky Low-Test Commits');
      expect(html).toContain('id="riskyCommitsTable"');
    });

    it('should include commits table with headers', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="commitsTable"');
      expect(html).toContain('id="commitsTableBody"');
      expect(html).toContain('<th scope="col">SHA</th>');
      expect(html).toContain('<th scope="col">Test Ratio</th>');
      expect(html).toContain('<th scope="col">Bugs</th>');
    });
  });

  describe('Loading and error states', () => {
    it('should include loading state', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="loadingState"');
      expect(html).toContain('class="loading-overlay"');
      expect(html).toContain('Loading test debt data');
    });

    it('should include error state container', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="errorState"');
    });

    it('should include empty state container', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="emptyState"');
    });

    it('should include summary stats container', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="summaryStats"');
      expect(html).toContain('class="summary-stats"');
    });
  });

  describe('Drill-down panel', () => {
    it('should include drill-down panel', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="drillDownPanel"');
      expect(html).toContain('class="drill-down-panel"');
    });

    it('should include drill-down title', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="drillDownTitle"');
      expect(html).toContain('Commit Details');
    });

    it('should include drill-down content area', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="drillDownContent"');
    });

    it('should include close button', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="closeDrillDown"');
    });
  });

  describe('Accessibility', () => {
    it('should include aria labels on interactive elements', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('aria-label="Repository filter"');
      expect(html).toContain('aria-label="Author filter"');
      expect(html).toContain('aria-label="Start date filter"');
      expect(html).toContain('aria-label="End date filter"');
      expect(html).toContain('aria-label="Apply filters"');
      expect(html).toContain('aria-label="Export chart data as CSV"');
    });

    it('should include role attributes', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('role="status"');
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('role="img"');
      expect(html).toContain('role="group"');
      expect(html).toContain('role="region"');
    });

    it('should include tabindex for keyboard navigation', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('tabindex="0"');
    });

    it('should include aria-live for dynamic content', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('aria-live="polite"');
    });
  });

  describe('Legend', () => {
    it('should include legend container', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="legendContainer"');
      expect(html).toContain('class="chart-legend test-debt-legend"');
    });
  });

  describe('Tooltip', () => {
    it('should include tooltip element', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('id="tooltip"');
      expect(html).toContain('class="chart-tooltip"');
      expect(html).toContain('aria-hidden="true"');
    });
  });

  describe('Chart instructions', () => {
    it('should include usage instructions', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('class="chart-instructions"');
      expect(html).toContain('Click a bar segment');
    });
  });

  describe('JavaScript functionality', () => {
    it('should include escapeHtml function', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('function escapeHtml(str)');
    });

    it('should include VS Code API acquisition', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('acquireVsCodeApi()');
    });

    it('should include message handling', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain("window.addEventListener('message'");
      expect(html).toContain("case 'testDebtData'");
      expect(html).toContain("case 'testDebtError'");
    });

    it('should include CSV export functionality', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('exportCsvFromData');
    });

    it('should include stacked bar chart rendering', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('function renderStackedBarChart');
    });

    it('should include scatter plot rendering', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('function renderScatterPlot');
    });

    it('should include ROI metric rendering', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('function renderRoiMetric');
    });

    it('should include tier colors', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('TIER_COLORS');
      expect(html).toContain('#dc2626'); // red (low)
      expect(html).toContain('#ca8a04'); // yellow (medium)
      expect(html).toContain('#16a34a'); // green (high)
    });

    it('should include tooltip functions', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('function showBarTooltip');
      expect(html).toContain('function showScatterTooltip');
      expect(html).toContain('function hideTooltip');
      expect(html).toContain('function moveTooltip');
    });

    it('should include drill-down request functions', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('function requestTierDrillDown');
    });

    it('should include commits table rendering', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('function renderCommitsTable');
    });

    it('should include initial data request', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('requestData()');
    });

    it('should include window resize handler', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain("window.addEventListener('resize'");
    });

    it('should include tier visibility state', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('tierVisibility');
    });

    it('should include correlation stats rendering', () => {
      const config = createMockConfig();
      const html = generateTestDebtHtml(config);

      expect(html).toContain('function renderCorrelationStats');
    });
  });
});
