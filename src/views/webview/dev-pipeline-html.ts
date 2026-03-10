/**
 * HTML content generator for the Development Pipeline dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - 4 separate metric charts (LOC, Complexity, Comments Ratio, Tests)
 * - Team filter (required) for focused developer analysis
 * - Weekly aggregation with developer-level breakdown
 * - Okabe-Ito colorblind-safe palette for developer coloring
 * - Tooltips, CSV export, date range filter
 * - ARIA accessibility
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-897, IQS-921, IQS-929
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';
import { generateDevPipelineChartScript } from './d3-dev-pipeline-section.js';

/**
 * Configuration for generating the development pipeline HTML.
 */
export interface DevPipelineHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the development pipeline CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
  /**
   * Jira URL prefix for ticket link construction.
   * Falls back to server URL if empty. Ticket: IQS-926
   */
  readonly jiraUrlPrefix: string;
  /**
   * Linear URL prefix for ticket link construction.
   * Falls back to https://linear.app/{team}/ pattern if empty. Ticket: IQS-926
   */
  readonly linearUrlPrefix: string;
}

/**
 * Generate the full HTML document for the Development Pipeline dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateDevPipelineHtml(config: DevPipelineHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource, jiraUrlPrefix, linearUrlPrefix } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Development Pipeline</title>
</head>
<body>
  <div class="dev-pipeline-container">
    <header class="dev-pipeline-header">
      <h1>Development Pipeline Metrics</h1>

      <div class="dev-pipeline-filters">
        <div class="filter-group">
          <label for="devPipelineTeamFilter">Team:</label>
          <select id="devPipelineTeamFilter" required aria-label="Team filter (required)">
            <option value="">-- Select Team --</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="devPipelineStartDate">From:</label>
          <input type="date" id="devPipelineStartDate" aria-label="Start date filter">
        </div>
        <div class="filter-group">
          <label for="devPipelineEndDate">To:</label>
          <input type="date" id="devPipelineEndDate" aria-label="End date filter">
        </div>
        <button id="devPipelineApplyBtn" class="filter-btn" aria-label="Apply filters">Apply</button>
        <button id="exportCsvBtn" class="export-btn" aria-label="Export all metrics as CSV" style="margin-left: auto;">Export CSV</button>
      </div>
    </header>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading development pipeline data...</span>
    </div>

    <div id="errorState" class="error-state" style="display:none;"></div>

    <div id="emptyState" class="empty-state" style="display:none;">
      <p>No commits found for selected team and date range.</p>
      <p>Try selecting a different team or expanding the date range.</p>
    </div>

    <div id="chartArea" class="dev-pipeline-charts" style="display:none;">
      <details class="chart-explanation" open>
        <summary class="explanation-toggle">
          <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>What does this dashboard show?</span>
        </summary>
        <div class="explanation-content">
          <p>This dashboard displays four key code quality metrics aggregated weekly per developer. Select a team to see how developers contribute to lines of code, code complexity, documentation (comments ratio), and test coverage. Each chart uses a colorblind-safe palette to distinguish individual developers, helping identify patterns in code quality practices across the team.</p>
        </div>
      </details>

      <!-- LOC Chart -->
      <div class="chart-card" id="locChartCard">
        <h3>Lines of Code (LOC) Delta</h3>
        <div class="chart-container">
          <svg id="locChart" aria-label="Weekly LOC delta by developer"></svg>
        </div>
      </div>

      <!-- Complexity Chart -->
      <div class="chart-card" id="complexityChartCard">
        <h3>Code Complexity Delta</h3>
        <div class="chart-container">
          <svg id="complexityChart" aria-label="Weekly complexity delta by developer"></svg>
        </div>
      </div>

      <!-- Comments Ratio Chart -->
      <div class="chart-card" id="commentsChartCard">
        <h3>Comments Ratio (%)</h3>
        <div class="chart-container">
          <svg id="commentsChart" aria-label="Weekly comments ratio by developer"></svg>
        </div>
      </div>

      <!-- Tests Chart -->
      <div class="chart-card" id="testsChartCard">
        <h3>Test Coverage (LOC Delta)</h3>
        <div class="chart-container">
          <svg id="testsChart" aria-label="Weekly test LOC delta by developer"></svg>
        </div>
      </div>

      <!-- Shared developer legend -->
      <div id="devPipelineDeveloperLegend" class="developer-legend" role="img" aria-label="Developer color legend"></div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>
  </div>

  <script nonce="${nonce}" src="${d3Uri.toString()}"></script>
  <script nonce="${nonce}">
    (function() {
      'use strict';

      // ======================================================================
      // VS Code API
      // ======================================================================
      console.log('[DevPipeline] Script starting, acquiring VS Code API...');
      var vscode = acquireVsCodeApi();
      console.log('[DevPipeline] VS Code API acquired successfully');

      // ======================================================================
      // Configuration (IQS-926: URL prefixes for issue navigation)
      // ======================================================================
      var JIRA_URL_PREFIX = ${JSON.stringify(jiraUrlPrefix)};
      var LINEAR_URL_PREFIX = ${JSON.stringify(linearUrlPrefix)};

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

      // ======================================================================
      // CSV Export
      // ======================================================================
      ${generateCsvExportScript()}

      // ======================================================================
      // State
      // ======================================================================
      var weeklyData = null;
      var authorList = [];  // Sorted list of authors for consistent coloring
      var teamList = [];    // Available teams

      // DOM References
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('devPipelineApplyBtn');
      var teamFilterSelect = document.getElementById('devPipelineTeamFilter');
      var startDateInput = document.getElementById('devPipelineStartDate');
      var endDateInput = document.getElementById('devPipelineEndDate');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var summaryStats = document.getElementById('summaryStats');
      var developerLegend = document.getElementById('devPipelineDeveloperLegend');
      var tooltip = document.getElementById('tooltip');

      // Set default date range: last 12 weeks
      (function setDefaultDates() {
        var endDate = new Date();
        var startDate = new Date();
        startDate.setDate(startDate.getDate() - 84); // 12 weeks
        startDateInput.value = startDate.toISOString().split('T')[0];
        endDateInput.value = endDate.toISOString().split('T')[0];
      })();

      // Event Handlers
      exportCsvBtn.addEventListener('click', function() {
        if (!weeklyData || weeklyData.length === 0) { return; }
        var headers = ['Week', 'Author', 'Full Name', 'Team', 'LOC Delta', 'Complexity Delta', 'Comments Delta', 'Tests Delta', 'Comments Ratio', 'Commits'];
        var rows = weeklyData.map(function(d) {
          return [d.weekStart, d.author, d.fullName || '', d.team || '', d.totalLocDelta, d.totalComplexityDelta, d.totalCommentsDelta, d.totalTestsDelta, d.commentsRatio.toFixed(2), d.commitCount];
        });
        exportCsvFromData(headers, rows, 'dev-pipeline-weekly.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        loadDevPipelineData();
      });

      // Message Handling
      window.addEventListener('message', function(event) {
        var message = event.data;
        console.log('[DevPipeline] Received message:', message.type, message);
        switch (message.type) {
          case 'devPipelineTeamList':
            console.log('[DevPipeline] Populating team dropdown with', message.teams ? message.teams.length : 0, 'teams');
            populateTeamDropdown(message.teams);
            break;
          case 'devPipelineWeeklyMetrics':
            handleWeeklyMetrics(message);
            break;
          case 'devPipelineError':
            showError(escapeHtml(message.message || message.error));
            break;
        }
      });

      function populateTeamDropdown(teams) {
        teamList = teams || [];
        teamFilterSelect.innerHTML = '<option value="">-- Select Team --</option>';
        teamList.forEach(function(team) {
          var option = document.createElement('option');
          option.value = team;
          option.textContent = team;
          teamFilterSelect.appendChild(option);
        });
      }

      function handleWeeklyMetrics(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (message.error) {
          showError(escapeHtml(message.error));
          return;
        }

        if (!message.data || message.data.length === 0) {
          emptyState.style.display = 'block';
          return;
        }

        weeklyData = message.data;
        renderCharts(weeklyData);
        renderSummaryStats(weeklyData);
        chartArea.style.display = 'block';
      }

      // ======================================================================
      // D3 Chart Rendering Functions (IQS-929)
      // ======================================================================
      ${generateDevPipelineChartScript()}

      function renderCharts(data) {
        if (!data || data.length === 0) { return; }

        // Get unique authors for consistent coloring
        authorList = buildAuthorList(data);

        // Render each chart
        renderLocChart(data, authorList);
        renderComplexityChart(data, authorList);
        renderCommentsChart(data, authorList);
        renderTestsChart(data, authorList);
        renderDeveloperLegend(authorList, data);
      }

      function moveTooltip(event) {
        tooltip.style.left = (event.pageX + 12) + 'px';
        tooltip.style.top = (event.pageY - 28) + 'px';
      }

      function hideTooltip() {
        // Use delayed hide to allow hovering over tooltip to click links
        if (typeof hideTooltipWithDelay === 'function') {
          hideTooltipWithDelay();
        } else {
          tooltip.classList.remove('visible');
          tooltip.setAttribute('aria-hidden', 'true');
        }
      }

      function formatDelta(value) {
        if (value > 0) return '+' + value.toLocaleString();
        return value.toLocaleString();
      }

      // Summary Stats
      function renderSummaryStats(data) {
        var totalComplexity = 0;
        var totalLoc = 0;
        var totalComments = 0;
        var totalTests = 0;
        var totalCommits = 0;

        data.forEach(function(d) {
          totalComplexity += d.totalComplexityDelta;
          totalLoc += d.totalLocDelta;
          totalComments += d.totalCommentsDelta;
          totalTests += d.totalTestsDelta;
          totalCommits += d.commitCount;
        });

        var avgCommentsRatio = 0;
        if (data.length > 0) {
          var totalRatio = data.reduce(function(sum, d) { return sum + d.commentsRatio; }, 0);
          avgCommentsRatio = totalRatio / data.length;
        }

        summaryStats.innerHTML =
          createStatCard(totalCommits, 'Total Commits') +
          createStatCard(formatDelta(totalLoc), 'Total LOC \u0394') +
          createStatCard(formatDelta(totalComplexity), 'Total Complexity \u0394') +
          createStatCard(avgCommentsRatio.toFixed(1) + '%', 'Avg Comments Ratio') +
          createStatCard(formatDelta(totalTests), 'Total Tests \u0394');
      }

      function createStatCard(value, label) {
        return '<div class="stat-card"><div class="stat-value">' +
          escapeHtml(String(value)) + '</div><div class="stat-label">' +
          escapeHtml(label) + '</div></div>';
      }

      // State Management
      function showLoading() {
        loadingState.style.display = 'flex';
        errorState.style.display = 'none';
        emptyState.style.display = 'none';
        chartArea.style.display = 'none';
      }

      function hideLoading() {
        loadingState.style.display = 'none';
      }

      function showError(msg) {
        hideLoading();
        errorState.innerHTML = '<p><span>&#9888;</span> ' + msg + '</p>';
        errorState.style.display = 'block';
        chartArea.style.display = 'none';
      }

      function hideError() {
        errorState.style.display = 'none';
        errorState.innerHTML = '';
      }

      function hideEmpty() {
        emptyState.style.display = 'none';
      }

      // Data Request
      function loadDevPipelineData() {
        var team = teamFilterSelect.value;
        if (!team) {
          showError('Please select a team');
          return;
        }

        showLoading();
        vscode.postMessage({
          type: 'requestDevPipelineWeeklyMetrics',
          team: team,
          startDate: startDateInput.value || undefined,
          endDate: endDateInput.value || undefined,
        });
      }

      // Chart Explanation Collapse State Persistence (IQS-922)
      function initChartExplanations() {
        var state = vscode.getState() || {};
        var explanationState = state.explanationState || {};

        document.querySelectorAll('.chart-explanation').forEach(function(details, index) {
          var key = 'explanation_' + index;
          if (explanationState[key] !== undefined) {
            details.open = explanationState[key];
          }
          details.addEventListener('toggle', function() {
            var currentState = vscode.getState() || {};
            var expState = currentState.explanationState || {};
            expState[key] = details.open;
            vscode.setState(Object.assign({}, currentState, { explanationState: expState }));
          });
        });
      }
      initChartExplanations();

      // Initial Load - Request team list
      console.log('[DevPipeline] Sending initial requestDevPipelineTeamList message...');
      vscode.postMessage({ type: 'requestDevPipelineTeamList' });
      console.log('[DevPipeline] Initial message sent');

    })();
  </script>
</body>
</html>`;
}
