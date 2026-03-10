/**
 * Unit tests for the Commit Hygiene Tracker dashboard HTML generator.
 * Tests HTML content generation, CSP configuration, and filter elements.
 *
 * Ticket: IQS-916
 */

import { describe, it, expect } from 'vitest';
import { generateHygieneHtml, type HygieneHtmlConfig } from '../../views/webview/hygiene-html.js';

/**
 * Mock vscode.Uri interface for testing.
 */
interface MockUri {
  toString(): string;
}

/**
 * Create a mock config for testing.
 */
function createMockConfig(overrides?: Partial<HygieneHtmlConfig>): HygieneHtmlConfig {
  const defaultD3Uri: MockUri = {
    toString: () => 'vscode-webview://d3.min.js',
  };
  const defaultStyleUri: MockUri = {
    toString: () => 'vscode-webview://hygiene.css',
  };

  return {
    nonce: 'test-nonce-12345',
    d3Uri: defaultD3Uri as unknown as import('vscode').Uri,
    styleUri: defaultStyleUri as unknown as import('vscode').Uri,
    cspSource: 'vscode-webview:',
    ...overrides,
  };
}

describe('generateHygieneHtml', () => {
  describe('HTML structure', () => {
    it('should generate valid HTML5 document', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include proper meta tags', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('<meta charset="UTF-8">');
      expect(html).toContain('<meta name="viewport"');
    });

    it('should include title', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('<title>Commit Hygiene Tracker</title>');
    });

    it('should include chart header with title', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('<h1>Commit Hygiene Tracker</h1>');
    });
  });

  describe('Content Security Policy', () => {
    it('should include CSP meta tag with nonce', () => {
      const config = createMockConfig({ nonce: 'unique-nonce-abc123' });
      const html = generateHygieneHtml(config);

      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(html).toContain("'nonce-unique-nonce-abc123'");
    });

    it('should include CSP source in policy', () => {
      const config = createMockConfig({ cspSource: 'vscode-webview:' });
      const html = generateHygieneHtml(config);

      expect(html).toContain('vscode-webview:');
    });

    it('should set default-src to none', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain("default-src 'none'");
    });
  });

  describe('Resource loading', () => {
    it('should include D3.js script tag with nonce', () => {
      const config = createMockConfig({ nonce: 'test-nonce' });
      const html = generateHygieneHtml(config);

      expect(html).toContain('nonce="test-nonce"');
      expect(html).toContain('src="vscode-webview://d3.min.js"');
    });

    it('should include stylesheet link', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('rel="stylesheet"');
      expect(html).toContain('href="vscode-webview://hygiene.css"');
    });
  });

  describe('Filter controls', () => {
    it('should include repository filter', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="repositoryFilter"');
      expect(html).toContain('Repository');
    });

    it('should include author filter', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="authorFilter"');
      expect(html).toContain('Author');
    });

    it('should include team filter', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="teamFilter"');
      expect(html).toContain('Team');
    });

    it('should include start date filter', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="startDate"');
      expect(html).toContain('type="date"');
      expect(html).toContain('Start Date');
    });

    it('should include end date filter', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="endDate"');
      expect(html).toContain('End Date');
    });

    it('should include apply filter button', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="applyFilterBtn"');
      expect(html).toContain('Apply');
    });

    it('should include export CSV button', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="exportCsvBtn"');
      expect(html).toContain('Export CSV');
    });
  });

  describe('Summary Metric', () => {
    it('should include summary metric container', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="summaryMetric"');
      expect(html).toContain('class="summary-metric"');
    });
  });

  describe('Tier toggles', () => {
    it('should include excellent tier toggle', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="showExcellentTier"');
      expect(html).toContain('Excellent');
    });

    it('should include good tier toggle', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="showGoodTier"');
      expect(html).toContain('Good');
    });

    it('should include fair tier toggle', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="showFairTier"');
      expect(html).toContain('Fair');
    });

    it('should include poor tier toggle', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="showPoorTier"');
      expect(html).toContain('Poor');
    });
  });

  describe('Charts', () => {
    it('should include stacked bar chart container', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="stackedBarSvg"');
      expect(html).toContain('Weekly Hygiene Trend');
    });

    it('should include donut chart container', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="donutSvg"');
      expect(html).toContain('Quality Distribution');
    });

    it('should include distribution stats container', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="distributionStats"');
    });

    it('should include factor bars container', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="factorBars"');
      expect(html).toContain('Factor Breakdown');
    });
  });

  describe('Leaderboard', () => {
    it('should include author leaderboard section', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('Author Leaderboard');
      expect(html).toContain('id="leaderboardTable"');
    });

    it('should include authors table with headers', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="authorsTable"');
      expect(html).toContain('id="authorsTableBody"');
      expect(html).toContain('<th scope="col">Rank</th>');
      expect(html).toContain('<th scope="col">Avg Score</th>');
    });
  });

  describe('Poor commits table', () => {
    it('should include poor commits section', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('Poor Commits to Fix');
      expect(html).toContain('id="poorCommitsTable"');
    });

    it('should include commits table with headers', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="commitsTable"');
      expect(html).toContain('id="commitsTableBody"');
      expect(html).toContain('<th scope="col">SHA</th>');
      expect(html).toContain('<th scope="col">Score</th>');
      expect(html).toContain('<th scope="col">Issues</th>');
    });
  });

  describe('Loading and error states', () => {
    it('should include loading state', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="loadingState"');
      expect(html).toContain('class="loading-overlay"');
      expect(html).toContain('Loading hygiene data');
    });

    it('should include error state container', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="errorState"');
    });

    it('should include empty state container', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="emptyState"');
    });

    it('should include summary stats container', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="summaryStats"');
      expect(html).toContain('class="summary-stats"');
    });
  });

  describe('Drill-down panel', () => {
    it('should include drill-down panel', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="drillDownPanel"');
      expect(html).toContain('class="drill-down-panel"');
    });

    it('should include drill-down title', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="drillDownTitle"');
      expect(html).toContain('Commit Details');
    });

    it('should include drill-down content area', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="drillDownContent"');
    });

    it('should include close button', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="closeDrillDown"');
    });
  });

  describe('Accessibility', () => {
    it('should include aria labels on interactive elements', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('aria-label="Repository filter"');
      expect(html).toContain('aria-label="Author filter"');
      expect(html).toContain('aria-label="Team filter"');
      expect(html).toContain('aria-label="Start date filter"');
      expect(html).toContain('aria-label="End date filter"');
      expect(html).toContain('aria-label="Apply filters"');
      expect(html).toContain('aria-label="Export chart data as CSV"');
    });

    it('should include role attributes', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('role="status"');
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('role="img"');
      expect(html).toContain('role="group"');
      expect(html).toContain('role="region"');
    });

    it('should include tabindex for keyboard navigation', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('tabindex="0"');
    });

    it('should include aria-live for dynamic content', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('aria-live="polite"');
    });
  });

  describe('Legend', () => {
    it('should include legend container', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="legendContainer"');
      expect(html).toContain('class="chart-legend hygiene-legend"');
    });
  });

  describe('Tooltip', () => {
    it('should include tooltip element', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('id="tooltip"');
      expect(html).toContain('class="chart-tooltip"');
      expect(html).toContain('aria-hidden="true"');
    });
  });

  describe('Chart instructions', () => {
    it('should include usage instructions', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('class="chart-instructions"');
      expect(html).toContain('Click a bar segment');
    });
  });

  describe('JavaScript functionality', () => {
    it('should include escapeHtml function', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('function escapeHtml(str)');
    });

    it('should include VS Code API acquisition', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('acquireVsCodeApi()');
    });

    it('should include message handling', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain("window.addEventListener('message'");
      expect(html).toContain("case 'hygieneData'");
      expect(html).toContain("case 'hygieneError'");
    });

    it('should include CSV export functionality', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('exportCsvFromData');
    });

    it('should include stacked bar chart rendering', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('function renderStackedBarChart');
    });

    it('should include donut chart rendering', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('function renderDonutChart');
    });

    it('should include summary metric rendering', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('function renderSummaryMetric');
    });

    it('should include tier colors', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('TIER_COLORS');
      expect(html).toContain('#16a34a'); // green (excellent)
      expect(html).toContain('#2563eb'); // blue (good)
      expect(html).toContain('#ca8a04'); // yellow (fair)
      expect(html).toContain('#dc2626'); // red (poor)
    });

    it('should include tooltip functions', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('function showBarTooltip');
      expect(html).toContain('function showDonutTooltip');
      expect(html).toContain('function hideTooltip');
      expect(html).toContain('function moveTooltip');
    });

    it('should include drill-down request functions', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('function requestTierDrillDown');
    });

    it('should include commits table rendering', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('function renderCommitsTable');
    });

    it('should include leaderboard rendering', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('function renderLeaderboard');
    });

    it('should include factor breakdown rendering', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('function renderFactorBreakdown');
    });

    it('should include initial data request', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('requestData()');
    });

    it('should include window resize handler', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain("window.addEventListener('resize'");
    });

    it('should include tier visibility state', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('tierVisibility');
    });

    it('should include getCommitIssues function', () => {
      const config = createMockConfig();
      const html = generateHygieneHtml(config);

      expect(html).toContain('function getCommitIssues');
    });
  });
});
