/**
 * Unit tests for the Release Risk Gauge dashboard HTML generator.
 * Tests HTML content generation, CSP configuration, and filter elements.
 *
 * Ticket: IQS-912
 */

import { describe, it, expect } from 'vitest';
import { generateReleaseRiskHtml, type ReleaseRiskHtmlConfig } from '../../views/webview/release-risk-html.js';

/**
 * Mock vscode.Uri interface for testing.
 */
interface MockUri {
  toString(): string;
}

/**
 * Create a mock config for testing.
 */
function createMockConfig(overrides?: Partial<ReleaseRiskHtmlConfig>): ReleaseRiskHtmlConfig {
  const defaultD3Uri: MockUri = {
    toString: () => 'vscode-webview://d3.min.js',
  };
  const defaultStyleUri: MockUri = {
    toString: () => 'vscode-webview://release-risk.css',
  };

  return {
    nonce: 'test-nonce-12345',
    d3Uri: defaultD3Uri as unknown as import('vscode').Uri,
    styleUri: defaultStyleUri as unknown as import('vscode').Uri,
    cspSource: 'vscode-webview:',
    ...overrides,
  };
}

describe('generateReleaseRiskHtml', () => {
  describe('HTML structure', () => {
    it('should generate valid HTML5 document', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include proper meta tags', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('<meta charset="UTF-8">');
      expect(html).toContain('<meta name="viewport"');
    });

    it('should include title', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('<title>Release Risk Gauge</title>');
    });

    it('should include chart header with title', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('<h1>Release Risk Gauge</h1>');
    });
  });

  describe('Content Security Policy', () => {
    it('should include CSP meta tag with nonce', () => {
      const config = createMockConfig({ nonce: 'unique-nonce-abc123' });
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(html).toContain("'nonce-unique-nonce-abc123'");
    });

    it('should include CSP source in policy', () => {
      const config = createMockConfig({ cspSource: 'vscode-webview:' });
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('vscode-webview:');
    });

    it('should set default-src to none', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain("default-src 'none'");
    });
  });

  describe('Resource loading', () => {
    it('should include D3.js script tag with nonce', () => {
      const config = createMockConfig({ nonce: 'test-nonce' });
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('nonce="test-nonce"');
      expect(html).toContain('src="vscode-webview://d3.min.js"');
    });

    it('should include stylesheet link', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('rel="stylesheet"');
      expect(html).toContain('href="vscode-webview://release-risk.css"');
    });
  });

  describe('Filter controls', () => {
    it('should include repository filter', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="repositoryFilter"');
      expect(html).toContain('Repository');
    });

    it('should include branch filter', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="branchFilter"');
      expect(html).toContain('Branch');
    });

    it('should include start date filter', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="startDate"');
      expect(html).toContain('type="date"');
      expect(html).toContain('Start Date');
    });

    it('should include end date filter', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="endDate"');
      expect(html).toContain('End Date');
    });

    it('should include apply filter button', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="applyFilterBtn"');
      expect(html).toContain('Apply');
    });

    it('should include export CSV button', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="exportCsvBtn"');
      expect(html).toContain('Export CSV');
    });
  });

  describe('Gauge areas', () => {
    it('should include main gauge SVG container', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="mainGaugeSvg"');
      expect(html).toContain('class="gauge-svg-container"');
    });

    it('should include gauge value display', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="gaugeValue"');
      expect(html).toContain('class="gauge-value"');
    });

    it('should include gauge label', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="gaugeLabel"');
      expect(html).toContain('Risk Score');
    });

    it('should include complexity mini gauge', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="complexityGaugeSvg"');
      expect(html).toContain('id="complexityValue"');
      expect(html).toContain('Complexity');
    });

    it('should include test coverage mini gauge', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="testGaugeSvg"');
      expect(html).toContain('id="testValue"');
      expect(html).toContain('Tests');
    });

    it('should include experience mini gauge', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="experienceGaugeSvg"');
      expect(html).toContain('id="experienceValue"');
      expect(html).toContain('Experience');
    });

    it('should include hotspot mini gauge', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="hotspotGaugeSvg"');
      expect(html).toContain('id="hotspotValue"');
      expect(html).toContain('Hotspots');
    });
  });

  describe('Risk badge', () => {
    it('should include risk badge element', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="riskBadge"');
      expect(html).toContain('class="risk-badge"');
    });
  });

  describe('Commits bar chart', () => {
    it('should include riskiest commits section', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('Top 5 Riskiest Commits');
      expect(html).toContain('id="riskiestCommitsChart"');
    });

    it('should include commits bar chart SVG', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="commitsBarSvg"');
    });
  });

  describe('Loading and error states', () => {
    it('should include loading state', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="loadingState"');
      expect(html).toContain('class="loading-overlay"');
      expect(html).toContain('Loading release risk data');
    });

    it('should include error state container', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="errorState"');
    });

    it('should include empty state container', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="emptyState"');
    });

    it('should include summary stats container', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="summaryStats"');
      expect(html).toContain('class="summary-stats"');
    });
  });

  describe('Drill-down panel', () => {
    it('should include drill-down panel', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="drillDownPanel"');
      expect(html).toContain('class="drill-down-panel"');
    });

    it('should include drill-down title', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="drillDownTitle"');
      expect(html).toContain('Commit Details');
    });

    it('should include drill-down content area', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="drillDownContent"');
    });

    it('should include close button', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="closeDrillDown"');
    });
  });

  describe('Accessibility', () => {
    it('should include aria labels on interactive elements', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('aria-label="Repository filter"');
      expect(html).toContain('aria-label="Branch filter"');
      expect(html).toContain('aria-label="Start date filter"');
      expect(html).toContain('aria-label="End date filter"');
      expect(html).toContain('aria-label="Apply filters"');
      expect(html).toContain('aria-label="Export chart data as CSV"');
    });

    it('should include role attributes', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('role="status"');
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('role="img"');
    });

    it('should include tabindex for keyboard navigation', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('tabindex="0"');
    });

    it('should include aria-live for dynamic content', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('aria-live="polite"');
    });
  });

  describe('Legend', () => {
    it('should include legend container', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="legendContainer"');
      expect(html).toContain('class="chart-legend risk-legend"');
    });
  });

  describe('Tooltip', () => {
    it('should include tooltip element', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('id="tooltip"');
      expect(html).toContain('class="chart-tooltip"');
      expect(html).toContain('aria-hidden="true"');
    });
  });

  describe('Chart instructions', () => {
    it('should include usage instructions', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('class="chart-instructions"');
      expect(html).toContain('Click a commit bar');
    });
  });

  describe('JavaScript functionality', () => {
    it('should include escapeHtml function', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('function escapeHtml(str)');
    });

    it('should include VS Code API acquisition', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('acquireVsCodeApi()');
    });

    it('should include message handling', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain("window.addEventListener('message'");
      expect(html).toContain("case 'releaseRiskData'");
      expect(html).toContain("case 'releaseRiskError'");
    });

    it('should include CSV export functionality', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('exportCsvFromData');
    });

    it('should include gauge rendering functions', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('function renderMainGauge');
      expect(html).toContain('function renderMiniGauge');
      expect(html).toContain('function renderBreakdownGauges');
    });

    it('should include risk zones', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('RISK_ZONES');
      expect(html).toContain('critical');
      expect(html).toContain('high');
      expect(html).toContain('medium');
      expect(html).toContain('low');
    });

    it('should include risk colors', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('RISK_COLORS');
      expect(html).toContain('#dc2626'); // red
      expect(html).toContain('#ea580c'); // orange
      expect(html).toContain('#ca8a04'); // yellow
      expect(html).toContain('#16a34a'); // green
    });

    it('should include risk badge configurations', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('RISK_BADGES');
      expect(html).toContain('Ship it');
      expect(html).toContain('Review recommended');
      expect(html).toContain('Review required');
      expect(html).toContain('High risk - escalate');
    });

    it('should include tooltip functions', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('function showCommitTooltip');
      expect(html).toContain('function hideTooltip');
      expect(html).toContain('function moveTooltip');
    });

    it('should include drill-down request functions', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('function requestCommitDrillDown');
    });

    it('should include bar chart rendering', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('function renderRiskiestCommits');
    });

    it('should include initial data request', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain('requestData()');
    });

    it('should include window resize handler', () => {
      const config = createMockConfig();
      const html = generateReleaseRiskHtml(config);

      expect(html).toContain("window.addEventListener('resize'");
    });
  });
});
