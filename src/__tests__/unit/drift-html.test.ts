/**
 * Unit tests for the Architecture Drift Heat Map dashboard HTML generator.
 * Tests HTML content generation, CSP configuration, and filter elements.
 *
 * Ticket: IQS-918
 */

import { describe, it, expect } from 'vitest';
import { generateDriftHtml, type DriftHtmlConfig } from '../../views/webview/drift-html.js';

/**
 * Mock vscode.Uri interface for testing.
 */
interface MockUri {
  toString(): string;
}

/**
 * Create a mock config for testing.
 */
function createMockConfig(overrides?: Partial<DriftHtmlConfig>): DriftHtmlConfig {
  const defaultD3Uri: MockUri = {
    toString: () => 'vscode-webview://d3.min.js',
  };
  const defaultStyleUri: MockUri = {
    toString: () => 'vscode-webview://drift.css',
  };

  return {
    nonce: 'test-nonce-12345',
    d3Uri: defaultD3Uri as unknown as import('vscode').Uri,
    styleUri: defaultStyleUri as unknown as import('vscode').Uri,
    cspSource: 'vscode-webview:',
    ...overrides,
  };
}

describe('generateDriftHtml', () => {
  describe('HTML structure', () => {
    it('should generate valid HTML5 document', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include proper meta tags', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('<meta charset="UTF-8">');
      expect(html).toContain('<meta name="viewport"');
    });

    it('should include title', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('<title>Architecture Drift Heat Map</title>');
    });

    it('should include chart header with title', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('<h1>Architecture Drift Heat Map</h1>');
    });
  });

  describe('Content Security Policy', () => {
    it('should include CSP meta tag with nonce', () => {
      const config = createMockConfig({ nonce: 'unique-nonce-abc123' });
      const html = generateDriftHtml(config);

      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(html).toContain("'nonce-unique-nonce-abc123'");
    });

    it('should include CSP source in policy', () => {
      const config = createMockConfig({ cspSource: 'vscode-webview:' });
      const html = generateDriftHtml(config);

      expect(html).toContain('vscode-webview:');
    });

    it('should set default-src to none', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain("default-src 'none'");
    });
  });

  describe('Resource loading', () => {
    it('should include D3.js script tag with nonce', () => {
      const config = createMockConfig({ nonce: 'test-nonce' });
      const html = generateDriftHtml(config);

      expect(html).toContain('nonce="test-nonce"');
      expect(html).toContain('src="vscode-webview://d3.min.js"');
    });

    it('should include stylesheet link', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('rel="stylesheet"');
      expect(html).toContain('href="vscode-webview://drift.css"');
    });
  });

  describe('Filter controls', () => {
    it('should include repository filter', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="repositoryFilter"');
      expect(html).toContain('Repository');
    });

    it('should include component filter', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="componentFilter"');
      expect(html).toContain('Component');
    });

    it('should include severity filter', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="severityFilter"');
      expect(html).toContain('Severity');
      expect(html).toContain('value="critical"');
      expect(html).toContain('value="high"');
      expect(html).toContain('value="medium"');
      expect(html).toContain('value="low"');
    });

    it('should include apply filter button', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="applyFilterBtn"');
      expect(html).toContain('Apply');
    });

    it('should include export CSV button', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="exportCsvBtn"');
      expect(html).toContain('Export CSV');
    });
  });

  describe('Cross-component filter toggle', () => {
    it('should include cross-component only checkbox', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="showCrossComponentOnly"');
      expect(html).toContain('Show Cross-Component Only');
    });
  });

  describe('Heat map section', () => {
    it('should include heat map section', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('Component x Week Heat Map');
      expect(html).toContain('class="heat-map-section"');
    });

    it('should include heat map SVG container', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="heatMapSvg"');
      expect(html).toContain('class="heat-map-container"');
    });

    it('should include chart instructions', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('class="chart-instructions"');
      expect(html).toContain('Hover over cells');
      expect(html).toContain('Warning badges');
    });
  });

  describe('Component toggles section', () => {
    it('should include component toggles section', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="componentTogglesSection"');
      expect(html).toContain('Component Visibility');
    });

    it('should include component toggles container', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="componentToggles"');
      expect(html).toContain('class="component-toggles"');
    });
  });

  describe('Coupling section', () => {
    it('should include coupling pairs section', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('Most Coupled Component Pairs');
      expect(html).toContain('class="coupling-section"');
    });

    it('should include coupling table with headers', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="pairsTable"');
      expect(html).toContain('id="pairsTableBody"');
      expect(html).toContain('<th scope="col">Component A</th>');
      expect(html).toContain('<th scope="col">Component B</th>');
      expect(html).toContain('<th scope="col">Coupling Count</th>');
      expect(html).toContain('<th scope="col">Strength</th>');
    });
  });

  describe('Drift insights section', () => {
    it('should include drift insights section', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('Drift Insights');
      expect(html).toContain('id="driftInsights"');
    });

    it('should include highest drift component card', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="highestDriftCard"');
      expect(html).toContain('Highest Drift Component');
    });

    it('should include severity breakdown card', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="severityBreakdown"');
      expect(html).toContain('Severity Breakdown');
    });

    it('should include trend card', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="trendCard"');
      expect(html).toContain('Drift Trend');
    });
  });

  describe('Loading and error states', () => {
    it('should include loading state', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="loadingState"');
      expect(html).toContain('class="loading-overlay"');
      expect(html).toContain('Loading architecture drift data');
    });

    it('should include error state container', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="errorState"');
    });

    it('should include empty state container', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="emptyState"');
    });

    it('should include summary stats container', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="summaryStats"');
      expect(html).toContain('class="summary-stats"');
    });
  });

  describe('Drill-down panel', () => {
    it('should include drill-down panel', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="drillDownPanel"');
      expect(html).toContain('class="drill-down-panel"');
    });

    it('should include drill-down title', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="drillDownTitle"');
      expect(html).toContain('Commits');
    });

    it('should include drill-down content area', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="drillDownContent"');
    });

    it('should include close button', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="closeDrillDown"');
    });
  });

  describe('Accessibility', () => {
    it('should include aria labels on interactive elements', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('aria-label="Repository filter"');
      expect(html).toContain('aria-label="Component filter"');
      expect(html).toContain('aria-label="Severity filter"');
      expect(html).toContain('aria-label="Apply filters"');
      expect(html).toContain('aria-label="Export chart data as CSV"');
      expect(html).toContain('aria-label="Show only cross-component commits"');
    });

    it('should include role attributes', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('role="status"');
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('role="img"');
      expect(html).toContain('role="group"');
      expect(html).toContain('role="region"');
    });

    it('should include tabindex for keyboard navigation', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('tabindex="0"');
    });

    it('should include aria-live for dynamic content', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('aria-live="polite"');
    });
  });

  describe('Legend', () => {
    it('should include legend container', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="legendContainer"');
      expect(html).toContain('class="chart-legend drift-legend"');
    });
  });

  describe('Tooltip', () => {
    it('should include tooltip element', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('id="tooltip"');
      expect(html).toContain('class="chart-tooltip"');
      expect(html).toContain('aria-hidden="true"');
    });
  });

  describe('JavaScript functionality', () => {
    it('should include escapeHtml function', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('function escapeHtml(str)');
    });

    it('should include VS Code API acquisition', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('acquireVsCodeApi()');
    });

    it('should include message handling', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain("window.addEventListener('message'");
      expect(html).toContain("case 'driftData'");
      expect(html).toContain("case 'driftError'");
    });

    it('should include CSV export functionality', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('exportCsvFromData');
    });

    it('should include heat map rendering', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('function renderHeatMap');
    });

    it('should include intensity colors', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('INTENSITY_COLORS');
      expect(html).toContain('#ffffff'); // white (0)
      expect(html).toContain('#3b82f6'); // blue
      expect(html).toContain('#ef4444'); // red (high)
    });

    it('should include severity colors', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('SEVERITY_COLORS');
      expect(html).toContain('#dc2626'); // critical
      expect(html).toContain('#f97316'); // high
      expect(html).toContain('#eab308'); // medium
      expect(html).toContain('#22c55e'); // low
    });

    it('should include tooltip functions', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('function showCellTooltip');
      expect(html).toContain('function hideTooltip');
      expect(html).toContain('function moveTooltip');
    });

    it('should include drill-down request functions', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('function requestCellDrillDown');
      expect(html).toContain('function requestComponentDrillDown');
    });

    it('should include coupling table rendering', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('function renderCouplingTable');
    });

    it('should include component toggles rendering', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('function renderComponentToggles');
    });

    it('should include drift insights rendering', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('function renderDriftInsights');
    });

    it('should include summary stats rendering', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('function renderSummaryStats');
    });

    it('should include initial data request', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('requestData()');
    });

    it('should include window resize handler', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain("window.addEventListener('resize'");
    });

    it('should include hidden components state', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('hiddenComponents');
    });

    it('should include cross-component filter state', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('showCrossComponentOnly');
    });

    it('should include getIntensityColor function', () => {
      const config = createMockConfig();
      const html = generateDriftHtml(config);

      expect(html).toContain('function getIntensityColor');
    });
  });
});
