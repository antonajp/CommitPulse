/**
 * HTML content generator for the Sprint Velocity vs LOC chart webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Dual-axis line chart with independent Y scales
 * - Tooltips, legend, CSV export, data table fallback
 * - ARIA accessibility and colorblind-accessible markers
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-888, IQS-944, IQS-946
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';
import { generateSeriesConfigScript } from './velocity-chart-series-config.js';
import {
  generateD3ChartScript,
  generateLegendScript,
  generateTooltipScript,
} from './velocity-chart-d3-renderer.js';
import {
  generateSummaryStatsScript,
  generateDataTableScript,
} from './velocity-chart-stats.js';
import {
  generateDataHandlerScript,
  generateUIStateScript,
  generateFilterStateScript,
  generateCsvExportHandlerScript,
  generateChartExplanationScript,
} from './velocity-chart-handlers.js';

/**
 * Configuration for generating the velocity chart HTML.
 */
export interface VelocityChartHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the velocity chart CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the HTML document structure for the velocity chart.
 * This contains the static HTML elements that the JavaScript will populate.
 *
 * @param styleUri - URI to the velocity chart CSS stylesheet
 * @param cspSource - CSP source string for the webview
 * @param nonce - CSP nonce for script/style authorization
 * @returns HTML string for the document body
 */
function generateHtmlStructure(
  styleUri: vscode.Uri,
  cspSource: string,
  nonce: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--
    Content Security Policy - Strict webview security (IQS-947)
    - connect-src 'none': Webview uses postMessage API only, no direct network access
    - script-src with nonce: Only extension-controlled scripts can execute
    See CSP documentation comments above for full security model explanation.
  -->
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Sprint Velocity vs LOC</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1 id="chartTitle">Sprint Velocity vs LOC</h1>
      <div class="controls">
        <div class="filter-group" id="aggregationFilterGroup">
          <label for="aggregationFilter">Group By</label>
          <select id="aggregationFilter" aria-label="Aggregation period" tabindex="0">
            <option value="day">Daily</option>
            <option value="week" selected>Weekly</option>
            <option value="biweekly">Bi-weekly</option>
          </select>
        </div>
        <div class="filter-group" id="repoFilterGroup">
          <label for="repoFilter">Repository</label>
          <select id="repoFilter" aria-label="Repository filter" tabindex="0">
            <option value="">All Repositories</option>
          </select>
        </div>
        <button class="apply-btn" id="applyFiltersBtn" aria-label="Apply selected filters" tabindex="0">Apply</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading velocity data...</span>
    </div>

    <div id="errorState" style="display:none;"></div>

    <div id="emptyState" style="display:none;"></div>

    <div id="chartArea" style="display:none;">
      <details class="chart-explanation" open>
        <summary class="explanation-toggle">
          <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>What does this chart show?</span>
        </summary>
        <div class="explanation-content">
          <p>This dual-axis chart compares <strong>human story point estimates</strong> (assigned during planning) against <strong>AI-measured story points</strong> (calculated from actual issue duration) over time. The LOC line provides context for code output.</p>
          <p><strong>Interpretation:</strong> When the human line consistently exceeds the AI line, your team may be over-estimating. When the AI line is higher, you're under-estimating. Use this to calibrate future sprint planning.</p>
        </div>
      </details>
      <div id="legendContainer" class="chart-legend velocity-legend" role="img" aria-label="Series legend"></div>
      <div class="chart-svg-container" role="img" aria-label="Dual-axis line chart showing sprint velocity and lines of code over time">
        <svg id="chartSvg"></svg>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div class="data-table-container" id="dataTableContainer" style="display:none;">
      <button class="data-table-toggle" id="toggleTableBtn" aria-expanded="false" tabindex="0">
        Show data table
      </button>
      <div id="dataTableWrapper" style="display:none;" role="region" aria-label="Sprint velocity data table">
        <table class="data-table" id="dataTable">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Human Est.</th>
              <th scope="col">AI Calc.</th>
              <th scope="col">Issues</th>
              <th scope="col">LOC Changed</th>
              <th scope="col">Commits</th>
            </tr>
          </thead>
          <tbody id="dataTableBody"></tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/**
 * Generate the escape HTML utility function.
 * @returns JavaScript source for escapeHtml function
 */
function generateEscapeHtmlScript(): string {
  return `
      // ======================================================================
      // HTML Escape utility (security: prevent XSS in SVG/DOM)
      // ======================================================================
      function escapeHtml(str) {
        if (str === null || str === undefined) { return ''; }
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;');
      }
  `;
}

/**
 * Generate the DOM references and state initialization script.
 * @returns JavaScript source for DOM refs and state
 */
function generateDomRefsScript(): string {
  return `
      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFiltersBtn = document.getElementById('applyFiltersBtn');
      var repoFilter = document.getElementById('repoFilter');
      var repoFilterGroup = document.getElementById('repoFilterGroup');
      var aggregationFilter = document.getElementById('aggregationFilter');
      var chartTitle = document.getElementById('chartTitle');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var summaryStats = document.getElementById('summaryStats');
      var legendContainer = document.getElementById('legendContainer');
      var toggleTableBtn = document.getElementById('toggleTableBtn');
      var dataTableWrapper = document.getElementById('dataTableWrapper');
      var dataTableContainer = document.getElementById('dataTableContainer');
      var tooltip = document.getElementById('tooltip');

      // ======================================================================
      // State
      // ======================================================================
      var chartData = null;

      // Filter state (IQS-920, IQS-944)
      var currentRepository = '';
      var currentAggregation = 'week';  // IQS-944: default to weekly
      var availableRepositories = [];
  `;
}

/**
 * Generate the event listeners script.
 * @returns JavaScript source for event listeners
 */
function generateEventListenersScript(): string {
  return `
      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', handleCsvExport);

      // Apply filters button handler (IQS-920, IQS-944)
      applyFiltersBtn.addEventListener('click', function() {
        currentRepository = repoFilter.value;
        currentAggregation = aggregationFilter.value;
        saveFilterState();
        updateChartTitle();
        requestData();
      });

      // Allow Enter key on filter dropdowns (IQS-920, IQS-944)
      repoFilter.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
          applyFiltersBtn.click();
        }
      });
      aggregationFilter.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
          applyFiltersBtn.click();
        }
      });

      toggleTableBtn.addEventListener('click', function() {
        var isExpanded = toggleTableBtn.getAttribute('aria-expanded') === 'true';
        toggleTableBtn.setAttribute('aria-expanded', String(!isExpanded));
        toggleTableBtn.textContent = isExpanded ? 'Show data table' : 'Hide data table';
        dataTableWrapper.style.display = isExpanded ? 'none' : 'block';
      });

      // Message Handling
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'velocityData':
            handleVelocityData(message);
            break;
          case 'velocityError':
            showError(escapeHtml(message.message));
            break;
        }
      });
  `;
}

/**
 * Generate the initialization script.
 * @returns JavaScript source for initialization
 */
function generateInitScript(): string {
  return `
      // ======================================================================
      // Initialization
      // ======================================================================
      initChartExplanations();

      // Initial Load
      restoreFilterState();
      updateChartTitle();
      requestData();
  `;
}

/**
 * Generate the full HTML document for the Sprint Velocity vs LOC chart webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateVelocityChartHtml(config: VelocityChartHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  // ============================================================================
  // Content Security Policy (CSP) Documentation - IQS-947
  // ============================================================================
  // This webview uses a strict CSP to prevent security vulnerabilities:
  //
  // - default-src 'none': Block all resources by default (deny-by-default)
  // - style-src ${cspSource} 'nonce-...': Allow styles from extension and nonce-protected inline
  // - script-src 'nonce-...': Only allow scripts with the cryptographic nonce (no eval, no inline)
  // - img-src ${cspSource} data:: Allow images from extension resources and data URIs (for SVG)
  // - connect-src 'none': CRITICAL - The webview CANNOT make network requests.
  //   All data flows through VS Code's postMessage API between webview and extension host.
  //   This prevents XSS attacks from exfiltrating data to external servers.
  // - form-action 'none': Prevent form submissions to external URLs
  // - frame-ancestors 'none': Prevent embedding in external frames
  // - base-uri 'none': Prevent base URL hijacking
  //
  // Data Flow Security Model:
  // 1. Webview sends typed messages via vscode.postMessage()
  // 2. Extension host receives, validates, and processes messages
  // 3. Extension host queries database and sends response via panel.webview.postMessage()
  // 4. Webview receives and renders data locally using D3.js
  //
  // This architecture ensures all data access is controlled by the extension host,
  // and the webview cannot bypass security controls or access network resources directly.
  // ============================================================================

  const htmlStructure = generateHtmlStructure(styleUri, cspSource, nonce);

  // Combine all script modules
  const scriptContent = [
    '(function() {',
    "  'use strict';",
    '',
    '  // VS Code API',
    '  var vscode = acquireVsCodeApi();',
    '',
    generateEscapeHtmlScript(),
    generateCsvExportScript(),
    generateSeriesConfigScript(),
    generateDomRefsScript(),
    generateUIStateScript(),
    generateFilterStateScript(),
    generateCsvExportHandlerScript(),
    generateD3ChartScript(),
    generateLegendScript(),
    generateTooltipScript(),
    generateSummaryStatsScript(),
    generateDataTableScript(),
    generateDataHandlerScript(),
    generateChartExplanationScript(),
    generateEventListenersScript(),
    generateInitScript(),
    '})();',
  ].join('\n');

  return `${htmlStructure}

  <script nonce="${nonce}" src="${d3Uri.toString()}"></script>
  <script nonce="${nonce}">
    ${scriptContent}
  </script>
</body>
</html>`;
}
