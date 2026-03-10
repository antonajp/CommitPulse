/**
 * HTML content generator for the Test Debt Predictor dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Dual-axis chart: stacked bars (commit count by test tier) + line overlay (bug rate)
 * - Correlation scatter plot with trend line and R² value
 * - ROI headline metric ("Low-test commits cause 3.2x more bugs")
 * - Click bar segment to view commits in that tier
 * - Click commit to open diff
 * - Tier visibility toggles, date range filter
 * - Risky low-test commits list
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-914
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the test debt HTML.
 */
export interface TestDebtHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the test-debt CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Test Debt Predictor dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateTestDebtHtml(config: TestDebtHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Test Debt Predictor</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Test Debt Predictor</h1>
      <div class="controls">
        <div class="filter-group">
          <label for="repositoryFilter">Repository</label>
          <select id="repositoryFilter" aria-label="Repository filter" tabindex="0">
            <option value="">All Repositories</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="authorFilter">Author</label>
          <select id="authorFilter" aria-label="Author filter" tabindex="0">
            <option value="">All Authors</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="startDate">Start Date</label>
          <input type="date" id="startDate" aria-label="Start date filter" tabindex="0">
        </div>
        <div class="filter-group">
          <label for="endDate">End Date</label>
          <input type="date" id="endDate" aria-label="End date filter" tabindex="0">
        </div>
        <button class="action-btn" id="applyFilterBtn" aria-label="Apply filters" tabindex="0">Apply</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="roiMetric" class="roi-metric" role="status" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading test debt data...</span>
    </div>

    <div id="errorState" style="display:none;"></div>

    <div id="emptyState" style="display:none;"></div>

    <div id="chartArea" style="display:none;">
      <div class="tier-toggles" role="group" aria-label="Test coverage tier visibility toggles">
        <label class="tier-toggle">
          <input type="checkbox" id="showLowTier" checked aria-label="Show low coverage commits">
          <span class="tier-swatch tier-low"></span>
          <span>Low Coverage</span>
        </label>
        <label class="tier-toggle">
          <input type="checkbox" id="showMediumTier" checked aria-label="Show medium coverage commits">
          <span class="tier-swatch tier-medium"></span>
          <span>Medium Coverage</span>
        </label>
        <label class="tier-toggle">
          <input type="checkbox" id="showHighTier" checked aria-label="Show high coverage commits">
          <span class="tier-swatch tier-high"></span>
          <span>High Coverage</span>
        </label>
      </div>

      <div class="charts-grid">
        <div class="chart-section">
          <h2>Weekly Test Debt Trend</h2>
          <details class="chart-explanation" open>
            <summary class="explanation-toggle">
              <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>What does this chart show?</span>
            </summary>
            <div class="explanation-content">
              <p>This stacked bar chart shows weekly commit counts by test coverage tier (Low, Medium, High), with a dashed line showing the bug rate. Track how test debt accumulates over time and correlate low-coverage commits with subsequent bugs.</p>
            </div>
          </details>
          <div class="stacked-bar-container" role="img" aria-label="Stacked bar chart showing commits by test coverage tier with bug rate overlay">
            <svg id="stackedBarSvg"></svg>
          </div>
          <div class="chart-instructions">
            <p>Click a bar segment to view commits in that tier. The line shows bug rate.</p>
          </div>
        </div>

        <div class="chart-section">
          <h2>Test Coverage vs Bug Rate</h2>
          <details class="chart-explanation" open>
            <summary class="explanation-toggle">
              <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>What does this chart show?</span>
            </summary>
            <div class="explanation-content">
              <p>This scatter plot visualizes the correlation between test coverage ratio and bug rate. A negative trend line indicates that higher test coverage leads to fewer bugs. The R-squared value shows how strongly test coverage predicts bug occurrence.</p>
            </div>
          </details>
          <div class="scatter-container" role="img" aria-label="Scatter plot showing correlation between test coverage and bug rate">
            <svg id="scatterSvg"></svg>
          </div>
          <div id="correlationStats" class="correlation-stats" aria-live="polite"></div>
        </div>
      </div>

      <div class="risky-commits-section">
        <h2>Risky Low-Test Commits</h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This table lists commits with low test coverage that are most likely to introduce bugs, sorted by subsequent bug count. Prioritize adding tests to these commits to reduce technical debt and prevent future regressions.</p>
          </div>
        </details>
        <div id="riskyCommitsTable" class="commits-table-container" role="region" aria-label="Table of risky low-test commits">
          <table id="commitsTable" class="data-table">
            <thead>
              <tr>
                <th scope="col">SHA</th>
                <th scope="col">Date</th>
                <th scope="col">Author</th>
                <th scope="col">Repository</th>
                <th scope="col">Test Ratio</th>
                <th scope="col">Tier</th>
                <th scope="col">Bugs</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody id="commitsTableBody"></tbody>
          </table>
        </div>
      </div>

      <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

      <div id="legendContainer" class="chart-legend test-debt-legend" role="img" aria-label="Test coverage tier legend"></div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div id="drillDownPanel" class="drill-down-panel" style="display:none;">
      <div class="drill-down-header">
        <h2 id="drillDownTitle">Commit Details</h2>
        <button class="close-btn" id="closeDrillDown" aria-label="Close drill-down panel" tabindex="0">&times;</button>
      </div>
      <div id="drillDownContent" class="drill-down-content"></div>
    </div>
  </div>

  <script nonce="${nonce}" src="${d3Uri.toString()}"></script>
  <script nonce="${nonce}">
    (function() {
      'use strict';

      // ======================================================================
      // VS Code API
      // ======================================================================
      var vscode = acquireVsCodeApi();

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
      var weeksData = null;
      var commitsData = null;
      var roiMetricData = null;
      var correlationData = null;

      // Test coverage tier colors (colorblind-accessible)
      var TIER_COLORS = {
        low: '#dc2626',     // red-600 (high risk)
        medium: '#ca8a04',  // yellow-600 (medium risk)
        high: '#16a34a',    // green-600 (low risk)
      };

      // Tier visibility state
      var tierVisibility = {
        low: true,
        medium: true,
        high: true,
      };

      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('applyFilterBtn');
      var repositoryFilter = document.getElementById('repositoryFilter');
      var authorFilter = document.getElementById('authorFilter');
      var startDateInput = document.getElementById('startDate');
      var endDateInput = document.getElementById('endDate');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var roiMetric = document.getElementById('roiMetric');
      var summaryStats = document.getElementById('summaryStats');
      var legendContainer = document.getElementById('legendContainer');
      var correlationStats = document.getElementById('correlationStats');
      var drillDownPanel = document.getElementById('drillDownPanel');
      var drillDownTitle = document.getElementById('drillDownTitle');
      var drillDownContent = document.getElementById('drillDownContent');
      var closeDrillDown = document.getElementById('closeDrillDown');
      var tooltip = document.getElementById('tooltip');
      var commitsTableBody = document.getElementById('commitsTableBody');
      var showLowTier = document.getElementById('showLowTier');
      var showMediumTier = document.getElementById('showMediumTier');
      var showHighTier = document.getElementById('showHighTier');

      // Set default date range (last 90 days)
      var today = new Date();
      var ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
      endDateInput.value = today.toISOString().split('T')[0];
      startDateInput.value = ninetyDaysAgo.toISOString().split('T')[0];

      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', function() {
        if (!weeksData || weeksData.length === 0) { return; }
        var headers = ['Week', 'Repository', 'Low Test Commits', 'Medium Test Commits', 'High Test Commits',
                       'Total Commits', 'Bugs from Low', 'Bugs from Medium', 'Bugs from High',
                       'Total Bugs', 'Low Bug Rate', 'Medium Bug Rate', 'High Bug Rate', 'Avg Test Ratio'];
        var rows = weeksData.map(function(w) {
          return [w.week, w.repository, w.lowTestCommits, w.mediumTestCommits, w.highTestCommits,
                  w.totalCommits, w.bugsFromLowTest, w.bugsFromMediumTest, w.bugsFromHighTest,
                  w.totalBugs, w.lowTestBugRate.toFixed(3), w.mediumTestBugRate.toFixed(3),
                  w.highTestBugRate.toFixed(3), w.avgTestRatio ? w.avgTestRatio.toFixed(3) : ''];
        });
        exportCsvFromData(headers, rows, 'test-debt.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        requestData();
      });

      closeDrillDown.addEventListener('click', function() {
        drillDownPanel.style.display = 'none';
      });

      // Tier visibility toggles
      showLowTier.addEventListener('change', function() {
        tierVisibility.low = this.checked;
        if (weeksData) { renderStackedBarChart(weeksData); }
      });

      showMediumTier.addEventListener('change', function() {
        tierVisibility.medium = this.checked;
        if (weeksData) { renderStackedBarChart(weeksData); }
      });

      showHighTier.addEventListener('change', function() {
        tierVisibility.high = this.checked;
        if (weeksData) { renderStackedBarChart(weeksData); }
      });

      // ======================================================================
      // Message Handling
      // ======================================================================
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'testDebtData':
            handleTestDebtData(message);
            break;
          case 'lowTestCommitsData':
            handleLowTestCommitsData(message);
            break;
          case 'testDebtFilterOptions':
            handleFilterOptions(message);
            break;
          case 'tierDrillDown':
            handleTierDrillDown(message);
            break;
          case 'commitDrillDown':
            handleCommitDrillDown(message);
            break;
          case 'testDebtError':
            showError(escapeHtml(message.message));
            break;
          case 'testDebtLoading':
            if (message.isLoading) { showLoading(); } else { hideLoading(); }
            break;
        }
      });

      function handleTestDebtData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Test Debt View Not Available',
            'The vw_test_debt database view has not been created yet. Run the database migration (019) to enable this chart.'
          );
          return;
        }

        if (!message.hasData || message.weeks.length === 0) {
          showEmpty(
            'No Test Debt Data Available',
            'No test debt data found. Run the pipeline to analyze test coverage and bug correlation.'
          );
          return;
        }

        weeksData = message.weeks;
        roiMetricData = message.roiMetric;
        correlationData = message.correlation;

        renderRoiMetric(message.roiMetric);
        renderStackedBarChart(weeksData);
        renderScatterPlot(weeksData, message.correlation);
        renderCorrelationStats(message.correlation);
        renderSummaryStats(weeksData);
        renderLegend();

        chartArea.style.display = 'block';

        // Also request low test commits for the table
        requestLowTestCommits();
      }

      function handleLowTestCommitsData(message) {
        if (!message.viewExists || !message.hasData) {
          commitsTableBody.innerHTML = '<tr><td colspan="8" class="empty-text">No low-test commits found.</td></tr>';
          return;
        }

        commitsData = message.commits;
        renderCommitsTable(message.commits);
      }

      function handleFilterOptions(message) {
        // Populate repository filter
        while (repositoryFilter.options.length > 1) {
          repositoryFilter.remove(1);
        }
        (message.repositories || []).forEach(function(repo) {
          var option = document.createElement('option');
          option.value = repo;
          option.textContent = repo;
          repositoryFilter.appendChild(option);
        });

        // Populate author filter
        while (authorFilter.options.length > 1) {
          authorFilter.remove(1);
        }
        (message.authors || []).forEach(function(author) {
          var option = document.createElement('option');
          option.value = author;
          option.textContent = author;
          authorFilter.appendChild(option);
        });
      }

      function handleTierDrillDown(message) {
        if (!message.hasData || message.commits.length === 0) {
          drillDownContent.innerHTML = '<p class="empty-text">No commits found for this tier and week.</p>';
          drillDownPanel.style.display = 'block';
          return;
        }

        drillDownTitle.textContent = formatTierLabel(message.tier) + ' Coverage Commits - Week of ' + formatDate(message.week);

        var html = '<div class="tier-commits-list">';
        message.commits.forEach(function(commit) {
          html += createCommitCard(commit);
        });
        html += '</div>';

        drillDownContent.innerHTML = html;
        attachCommitCardEvents();
        drillDownPanel.style.display = 'block';
      }

      function handleCommitDrillDown(message) {
        if (!message.hasData || !message.commit) {
          drillDownContent.innerHTML = '<p class="empty-text">Commit details not found.</p>';
          drillDownPanel.style.display = 'block';
          return;
        }

        var commit = message.commit;
        drillDownTitle.textContent = 'Commit: ' + escapeHtml(commit.sha.substring(0, 8));

        var tierClass = 'tier-' + commit.testCoverageTier;
        var html = '';
        html += '<div class="commit-detail-header">';
        html += '<div class="commit-sha">' + escapeHtml(commit.sha) + '</div>';
        html += '<div class="commit-meta">';
        html += '<span class="commit-author">' + escapeHtml(commit.author) + '</span>';
        html += ' on <span class="commit-date">' + formatDate(commit.commitDate) + '</span>';
        html += '</div>';
        if (commit.commitMessage) {
          html += '<div class="commit-message">' + escapeHtml(commit.commitMessage) + '</div>';
        }
        html += '</div>';

        html += '<div class="test-ratio-large ' + tierClass + '">';
        html += '<span class="ratio-value">' + (commit.testRatio !== null ? (commit.testRatio * 100).toFixed(1) + '%' : 'N/A') + '</span>';
        html += '<span class="ratio-label">Test Ratio</span>';
        html += '</div>';

        html += '<div class="commit-stats">';
        html += '<h3>Code Changes</h3>';
        html += '<div class="stats-grid">';
        html += '<div class="stat-item"><span class="stat-val">' + commit.prodLocChanged + '</span><span class="stat-lbl">Prod LOC</span></div>';
        html += '<div class="stat-item"><span class="stat-val">' + commit.testLocChanged + '</span><span class="stat-lbl">Test LOC</span></div>';
        html += '<div class="stat-item"><span class="stat-val">' + commit.prodFilesChanged + '</span><span class="stat-lbl">Prod Files</span></div>';
        html += '<div class="stat-item"><span class="stat-val">' + commit.testFilesChanged + '</span><span class="stat-lbl">Test Files</span></div>';
        html += '</div></div>';

        html += '<div class="bug-correlation">';
        html += '<h3>Bug Correlation</h3>';
        html += '<div class="bugs-count ' + (commit.subsequentBugs > 0 ? 'has-bugs' : '') + '">';
        html += '<span class="bugs-value">' + commit.subsequentBugs + '</span>';
        html += '<span class="bugs-label">Subsequent Bug' + (commit.subsequentBugs !== 1 ? 's' : '') + '</span>';
        html += '</div></div>';

        if (commit.jiraTicketId || commit.linearTicketId) {
          html += '<div class="commit-ticket">';
          if (commit.jiraTicketId) {
            html += '<span class="ticket-label">Jira:</span>';
            html += '<span class="ticket-id">' + escapeHtml(commit.jiraTicketId) + '</span>';
          }
          if (commit.linearTicketId) {
            html += '<span class="ticket-label">Linear:</span>';
            html += '<span class="ticket-id">' + escapeHtml(commit.linearTicketId) + '</span>';
          }
          html += '</div>';
        }

        html += '<div class="drill-down-actions">';
        html += '<button class="action-btn open-diff-btn" data-sha="' + escapeHtml(commit.sha) + '" data-repo="' + escapeHtml(commit.repository) + '">View Diff</button>';
        html += '</div>';

        drillDownContent.innerHTML = html;

        // Attach event to diff button
        var diffBtn = drillDownContent.querySelector('.open-diff-btn');
        if (diffBtn) {
          diffBtn.addEventListener('click', function() {
            vscode.postMessage({
              type: 'requestOpenDiff',
              sha: this.getAttribute('data-sha'),
              repository: this.getAttribute('data-repo'),
            });
          });
        }

        drillDownPanel.style.display = 'block';
      }

      function createCommitCard(commit) {
        var tierClass = 'tier-' + commit.testCoverageTier;
        return '<div class="commit-card ' + tierClass + '" data-sha="' + escapeHtml(commit.sha) + '" data-repo="' + escapeHtml(commit.repository) + '">' +
               '<div class="commit-card-header">' +
               '<span class="commit-sha-short">' + escapeHtml(commit.sha.substring(0, 8)) + '</span>' +
               '<span class="commit-tier-badge ' + tierClass + '">' + formatTierLabel(commit.testCoverageTier) + '</span>' +
               '</div>' +
               '<div class="commit-card-meta">' + escapeHtml(commit.author) + ' - ' + formatDate(commit.commitDate) + '</div>' +
               '<div class="commit-card-stats">' +
               '<span>Test Ratio: ' + (commit.testRatio !== null ? (commit.testRatio * 100).toFixed(1) + '%' : 'N/A') + '</span>' +
               '<span>Bugs: ' + commit.subsequentBugs + '</span>' +
               '</div>' +
               '</div>';
      }

      function attachCommitCardEvents() {
        var cards = drillDownContent.querySelectorAll('.commit-card');
        cards.forEach(function(card) {
          card.addEventListener('click', function() {
            vscode.postMessage({
              type: 'requestCommitDrillDown',
              sha: this.getAttribute('data-sha'),
              repository: this.getAttribute('data-repo'),
            });
          });
        });
      }

      // ======================================================================
      // ROI Metric Rendering
      // ======================================================================
      function renderRoiMetric(metric) {
        if (!metric || metric.multiplier <= 0) {
          roiMetric.style.display = 'none';
          return;
        }

        var multiplierText = metric.multiplier.toFixed(1) + 'x';
        roiMetric.innerHTML = '<div class="roi-content">' +
          '<span class="roi-value">' + multiplierText + '</span>' +
          '<span class="roi-text">Low-test commits cause <strong>' + multiplierText + '</strong> more bugs</span>' +
          '<span class="roi-details">Low-test bug rate: ' + (metric.lowTestRate * 100).toFixed(1) + '% | High-test bug rate: ' + (metric.baseRate * 100).toFixed(1) + '%</span>' +
          '</div>';
        roiMetric.style.display = 'block';
      }

      // ======================================================================
      // Stacked Bar Chart Rendering with D3.js
      // ======================================================================
      function renderStackedBarChart(weeks) {
        var svg = d3.select('#stackedBarSvg');
        svg.selectAll('*').remove();

        // Reverse to show oldest first (left to right)
        var sortedWeeks = weeks.slice().reverse();

        var containerWidth = Math.max(600, document.querySelector('.stacked-bar-container').clientWidth - 24);
        var width = containerWidth;
        var height = 320;
        var margin = { top: 20, right: 60, bottom: 60, left: 60 };

        svg.attr('width', width).attr('height', height);

        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        var g = svg.append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // X scale
        var xScale = d3.scaleBand()
          .domain(sortedWeeks.map(function(w) { return w.week; }))
          .range([0, innerWidth])
          .padding(0.2);

        // Build stack data based on visibility
        var stackKeys = [];
        if (tierVisibility.high) { stackKeys.push('highTestCommits'); }
        if (tierVisibility.medium) { stackKeys.push('mediumTestCommits'); }
        if (tierVisibility.low) { stackKeys.push('lowTestCommits'); }

        // Calculate max for visible tiers
        var maxCommits = d3.max(sortedWeeks, function(w) {
          var total = 0;
          if (tierVisibility.low) { total += w.lowTestCommits; }
          if (tierVisibility.medium) { total += w.mediumTestCommits; }
          if (tierVisibility.high) { total += w.highTestCommits; }
          return total;
        });

        var yScaleLeft = d3.scaleLinear()
          .domain([0, Math.max(maxCommits || 1, 1)])
          .range([innerHeight, 0]);

        // Y scale for bug rate (right axis)
        var maxBugRate = d3.max(sortedWeeks, function(w) {
          return Math.max(w.lowTestBugRate, w.mediumTestBugRate, w.highTestBugRate);
        });
        var yScaleRight = d3.scaleLinear()
          .domain([0, Math.max(maxBugRate || 0.5, 0.1)])
          .range([innerHeight, 0]);

        // Stack generator
        var stack = d3.stack()
          .keys(stackKeys)
          .order(d3.stackOrderNone)
          .offset(d3.stackOffsetNone);

        var stackedData = stack(sortedWeeks);

        // Color mapping
        var colorMap = {
          lowTestCommits: TIER_COLORS.low,
          mediumTestCommits: TIER_COLORS.medium,
          highTestCommits: TIER_COLORS.high,
        };

        var tierMap = {
          lowTestCommits: 'low',
          mediumTestCommits: 'medium',
          highTestCommits: 'high',
        };

        // Draw stacked bars
        stackedData.forEach(function(layer) {
          g.selectAll('.bar-' + layer.key)
            .data(layer)
            .enter()
            .append('rect')
            .attr('class', 'bar bar-' + layer.key)
            .attr('x', function(d) { return xScale(d.data.week); })
            .attr('y', function(d) { return yScaleLeft(d[1]); })
            .attr('width', xScale.bandwidth())
            .attr('height', function(d) { return yScaleLeft(d[0]) - yScaleLeft(d[1]); })
            .attr('fill', colorMap[layer.key])
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', function(d) {
              var tier = tierMap[layer.key];
              var count = d[1] - d[0];
              return formatTierLabel(tier) + ' commits: ' + count + ' for week of ' + d.data.week;
            })
            .on('mouseover', function(event, d) {
              var tier = tierMap[layer.key];
              showBarTooltip(event, d.data, tier);
              d3.select(this).attr('opacity', 0.8);
            })
            .on('mouseout', function() {
              hideTooltip();
              d3.select(this).attr('opacity', 1);
            })
            .on('click', function(event, d) {
              var tier = tierMap[layer.key];
              requestTierDrillDown(tier, d.data.week);
            })
            .on('keydown', function(event, d) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                var tier = tierMap[layer.key];
                requestTierDrillDown(tier, d.data.week);
              }
            });
        });

        // Draw bug rate line (using low-test bug rate as primary)
        var line = d3.line()
          .x(function(d) { return xScale(d.week) + xScale.bandwidth() / 2; })
          .y(function(d) { return yScaleRight(d.lowTestBugRate); })
          .curve(d3.curveMonotoneX);

        g.append('path')
          .datum(sortedWeeks)
          .attr('class', 'bug-rate-line')
          .attr('fill', 'none')
          .attr('stroke', '#f97316')
          .attr('stroke-width', 2.5)
          .attr('stroke-dasharray', '5,3')
          .attr('d', line);

        // Draw data points on the line
        g.selectAll('.bug-rate-point')
          .data(sortedWeeks)
          .enter()
          .append('circle')
          .attr('class', 'bug-rate-point')
          .attr('cx', function(d) { return xScale(d.week) + xScale.bandwidth() / 2; })
          .attr('cy', function(d) { return yScaleRight(d.lowTestBugRate); })
          .attr('r', 4)
          .attr('fill', '#f97316')
          .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
          .attr('stroke-width', 2);

        // Draw axes
        g.append('g')
          .attr('class', 'x-axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(xScale).tickFormat(function(d) {
            return formatWeekLabel(d);
          }))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        g.append('g')
          .attr('class', 'y-axis')
          .call(d3.axisLeft(yScaleLeft).ticks(5))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)');

        g.append('g')
          .attr('class', 'y-axis-right')
          .attr('transform', 'translate(' + innerWidth + ', 0)')
          .call(d3.axisRight(yScaleRight).ticks(5).tickFormat(function(d) {
            return (d * 100).toFixed(0) + '%';
          }))
          .selectAll('text')
          .attr('fill', '#f97316');

        // Y-axis labels
        g.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -45)
          .attr('x', -innerHeight / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Commits');

        g.append('text')
          .attr('transform', 'rotate(90)')
          .attr('y', -innerWidth - 45)
          .attr('x', innerHeight / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', '#f97316')
          .attr('font-size', '11px')
          .text('Bug Rate');
      }

      // ======================================================================
      // Scatter Plot Rendering
      // ======================================================================
      function renderScatterPlot(weeks, correlation) {
        var svg = d3.select('#scatterSvg');
        svg.selectAll('*').remove();

        // Filter weeks with valid test ratio
        var validWeeks = weeks.filter(function(w) {
          return w.avgTestRatio !== null && w.totalCommits > 0;
        });

        if (validWeeks.length < 2) {
          svg.append('text')
            .attr('x', 200)
            .attr('y', 100)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--vscode-descriptionForeground, #999)')
            .text('Not enough data points for correlation analysis.');
          return;
        }

        var containerWidth = Math.max(400, document.querySelector('.scatter-container').clientWidth - 24);
        var width = containerWidth;
        var height = 280;
        var margin = { top: 20, right: 30, bottom: 50, left: 60 };

        svg.attr('width', width).attr('height', height);

        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        var g = svg.append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // X scale (test ratio)
        var xExtent = d3.extent(validWeeks, function(w) { return w.avgTestRatio; });
        var xScale = d3.scaleLinear()
          .domain([0, Math.max(xExtent[1] || 1, 0.5)])
          .range([0, innerWidth]);

        // Y scale (bug rate)
        var bugRates = validWeeks.map(function(w) { return w.totalBugs / w.totalCommits; });
        var yMax = d3.max(bugRates) || 0.5;
        var yScale = d3.scaleLinear()
          .domain([0, Math.max(yMax, 0.1)])
          .range([innerHeight, 0]);

        // Draw trend line if correlation exists
        if (correlation && correlation.rSquared > 0) {
          var x1 = 0;
          var x2 = xScale.domain()[1];
          var y1 = correlation.intercept;
          var y2 = correlation.slope * x2 + correlation.intercept;

          g.append('line')
            .attr('class', 'trend-line')
            .attr('x1', xScale(x1))
            .attr('y1', yScale(Math.max(0, y1)))
            .attr('x2', xScale(x2))
            .attr('y2', yScale(Math.max(0, y2)))
            .attr('stroke', 'var(--vscode-textLink-foreground, #3794ff)')
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '8,4')
            .attr('opacity', 0.7);
        }

        // Draw data points
        g.selectAll('.scatter-point')
          .data(validWeeks)
          .enter()
          .append('circle')
          .attr('class', 'scatter-point')
          .attr('cx', function(d) { return xScale(d.avgTestRatio); })
          .attr('cy', function(d) { return yScale(d.totalBugs / d.totalCommits); })
          .attr('r', 6)
          .attr('fill', function(d) {
            // Color based on which tier dominates
            var maxTier = Math.max(d.lowTestCommits, d.mediumTestCommits, d.highTestCommits);
            if (maxTier === d.lowTestCommits) { return TIER_COLORS.low; }
            if (maxTier === d.mediumTestCommits) { return TIER_COLORS.medium; }
            return TIER_COLORS.high;
          })
          .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
          .attr('stroke-width', 2)
          .attr('opacity', 0.8)
          .on('mouseover', function(event, d) {
            showScatterTooltip(event, d);
            d3.select(this).attr('r', 8).attr('opacity', 1);
          })
          .on('mouseout', function() {
            hideTooltip();
            d3.select(this).attr('r', 6).attr('opacity', 0.8);
          });

        // Draw axes
        g.append('g')
          .attr('class', 'x-axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(xScale).ticks(5).tickFormat(function(d) {
            return (d * 100).toFixed(0) + '%';
          }))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)');

        g.append('g')
          .attr('class', 'y-axis')
          .call(d3.axisLeft(yScale).ticks(5).tickFormat(function(d) {
            return (d * 100).toFixed(0) + '%';
          }))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)');

        // Axis labels
        g.append('text')
          .attr('x', innerWidth / 2)
          .attr('y', innerHeight + 40)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Average Test Ratio');

        g.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -45)
          .attr('x', -innerHeight / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Bug Rate');
      }

      // ======================================================================
      // Correlation Stats
      // ======================================================================
      function renderCorrelationStats(correlation) {
        if (!correlation) {
          correlationStats.innerHTML = '<span class="no-correlation">Not enough data for correlation analysis.</span>';
          return;
        }

        var rSquaredPercent = (correlation.rSquared * 100).toFixed(1);
        var relationshipClass = correlation.slope < 0 ? 'negative' : 'positive';
        var relationshipText = correlation.slope < 0 ? 'Higher test coverage correlates with fewer bugs' : 'Unexpected: Higher coverage correlates with more bugs';

        correlationStats.innerHTML = '<div class="correlation-value">' +
          '<span class="r-squared">R\\u00B2 = ' + rSquaredPercent + '%</span>' +
          '<span class="relationship ' + relationshipClass + '">' + relationshipText + '</span>' +
          '</div>';
      }

      // ======================================================================
      // Commits Table
      // ======================================================================
      function renderCommitsTable(commits) {
        if (!commits || commits.length === 0) {
          commitsTableBody.innerHTML = '<tr><td colspan="8" class="empty-text">No low-test commits found.</td></tr>';
          return;
        }

        // Sort by subsequent bugs descending, take top 20
        var sortedCommits = commits.slice().sort(function(a, b) {
          return b.subsequentBugs - a.subsequentBugs;
        }).slice(0, 20);

        commitsTableBody.innerHTML = sortedCommits.map(function(commit) {
          var tierClass = 'tier-' + commit.testCoverageTier;
          return '<tr class="' + tierClass + '">' +
            '<td class="sha-cell">' +
            '<a href="#" class="commit-link" data-sha="' + escapeHtml(commit.sha) + '" data-repo="' + escapeHtml(commit.repository) + '">' +
            escapeHtml(commit.sha.substring(0, 8)) + '</a></td>' +
            '<td>' + formatDate(commit.commitDate) + '</td>' +
            '<td>' + escapeHtml(commit.author) + '</td>' +
            '<td>' + escapeHtml(commit.repository) + '</td>' +
            '<td>' + (commit.testRatio !== null ? (commit.testRatio * 100).toFixed(1) + '%' : 'N/A') + '</td>' +
            '<td><span class="tier-badge ' + tierClass + '">' + formatTierLabel(commit.testCoverageTier) + '</span></td>' +
            '<td class="bugs-cell ' + (commit.subsequentBugs > 0 ? 'has-bugs' : '') + '">' + commit.subsequentBugs + '</td>' +
            '<td><button class="action-btn-small view-diff-btn" data-sha="' + escapeHtml(commit.sha) + '" data-repo="' + escapeHtml(commit.repository) + '">Diff</button></td>' +
            '</tr>';
        }).join('');

        // Attach click handlers
        var commitLinks = commitsTableBody.querySelectorAll('.commit-link');
        commitLinks.forEach(function(link) {
          link.addEventListener('click', function(e) {
            e.preventDefault();
            vscode.postMessage({
              type: 'requestCommitDrillDown',
              sha: this.getAttribute('data-sha'),
              repository: this.getAttribute('data-repo'),
            });
          });
        });

        var diffBtns = commitsTableBody.querySelectorAll('.view-diff-btn');
        diffBtns.forEach(function(btn) {
          btn.addEventListener('click', function() {
            vscode.postMessage({
              type: 'requestOpenDiff',
              sha: this.getAttribute('data-sha'),
              repository: this.getAttribute('data-repo'),
            });
          });
        });
      }

      // ======================================================================
      // Tooltip Functions
      // ======================================================================
      function showBarTooltip(event, week, tier) {
        var tierLabel = formatTierLabel(tier);
        var count = tier === 'low' ? week.lowTestCommits :
                    tier === 'medium' ? week.mediumTestCommits : week.highTestCommits;
        var bugRate = tier === 'low' ? week.lowTestBugRate :
                      tier === 'medium' ? week.mediumTestBugRate : week.highTestBugRate;

        var html =
          '<div class="tt-title"><strong>Week of ' + formatDate(week.week) + '</strong></div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-stat"><span class="tier-badge tier-' + tier + '">' + tierLabel + '</span></div>' +
          '<div class="tt-stat">Commits: <strong>' + count + '</strong></div>' +
          '<div class="tt-stat">Bug Rate: <strong>' + (bugRate * 100).toFixed(1) + '%</strong></div>' +
          '<div class="tt-action">[Click for details]</div>';

        tooltip.innerHTML = html;
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        moveTooltip(event);
      }

      function showScatterTooltip(event, week) {
        var bugRate = week.totalBugs / week.totalCommits;
        var html =
          '<div class="tt-title"><strong>Week of ' + formatDate(week.week) + '</strong></div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-stat">Avg Test Ratio: <strong>' + (week.avgTestRatio * 100).toFixed(1) + '%</strong></div>' +
          '<div class="tt-stat">Bug Rate: <strong>' + (bugRate * 100).toFixed(1) + '%</strong></div>' +
          '<div class="tt-stat">Total Commits: ' + week.totalCommits + '</div>' +
          '<div class="tt-stat">Total Bugs: ' + week.totalBugs + '</div>';

        tooltip.innerHTML = html;
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        moveTooltip(event);
      }

      function moveTooltip(event) {
        var x = event.pageX + 12;
        var y = event.pageY - 28;
        var ttRect = tooltip.getBoundingClientRect();
        if (x + ttRect.width > window.innerWidth - 20) {
          x = event.pageX - ttRect.width - 12;
        }
        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
      }

      function hideTooltip() {
        tooltip.classList.remove('visible');
        tooltip.setAttribute('aria-hidden', 'true');
      }

      // ======================================================================
      // Drill-Down Requests
      // ======================================================================
      function requestTierDrillDown(tier, week) {
        vscode.postMessage({
          type: 'requestTierDrillDown',
          tier: tier,
          week: week,
          filters: getFilters(),
        });
      }

      // ======================================================================
      // Summary Stats
      // ======================================================================
      function renderSummaryStats(weeks) {
        var totalLow = 0, totalMedium = 0, totalHigh = 0, totalBugs = 0;

        weeks.forEach(function(w) {
          totalLow += w.lowTestCommits;
          totalMedium += w.mediumTestCommits;
          totalHigh += w.highTestCommits;
          totalBugs += w.totalBugs;
        });

        var html = '';
        html += createStatCard(weeks.length.toString(), 'Weeks');
        html += createStatCard(totalLow.toString(), 'Low Coverage', 'low');
        html += createStatCard(totalMedium.toString(), 'Medium Coverage', 'medium');
        html += createStatCard(totalHigh.toString(), 'High Coverage', 'high');
        html += createStatCard(totalBugs.toString(), 'Total Bugs');

        summaryStats.innerHTML = html;
      }

      function createStatCard(value, label, tier) {
        var tierClass = tier ? ' stat-' + tier : '';
        return '<div class="stat-card' + tierClass + '">' +
               '<div class="stat-value">' + escapeHtml(String(value)) + '</div>' +
               '<div class="stat-label">' + escapeHtml(label) + '</div></div>';
      }

      // ======================================================================
      // Legend
      // ======================================================================
      function renderLegend() {
        legendContainer.innerHTML = '';

        var tiers = [
          { key: 'high', label: 'High Coverage (\\u2265 50%)', color: TIER_COLORS.high },
          { key: 'medium', label: 'Medium Coverage (10-50%)', color: TIER_COLORS.medium },
          { key: 'low', label: 'Low Coverage (< 10%)', color: TIER_COLORS.low },
        ];

        tiers.forEach(function(tier) {
          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = tier.color;
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.textContent = tier.label;
          item.appendChild(label);

          legendContainer.appendChild(item);
        });

        // Add bug rate legend
        var bugItem = document.createElement('div');
        bugItem.className = 'legend-item';
        bugItem.innerHTML = '<span class="legend-line" style="background: #f97316;"></span><span>Bug Rate (line)</span>';
        legendContainer.appendChild(bugItem);
      }

      // ======================================================================
      // Utility Functions
      // ======================================================================
      function formatTierLabel(tier) {
        var labels = {
          low: 'Low',
          medium: 'Medium',
          high: 'High',
        };
        return labels[tier] || tier;
      }

      function formatDate(dateString) {
        if (!dateString) { return ''; }
        var d = new Date(dateString);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      function formatWeekLabel(dateString) {
        if (!dateString) { return ''; }
        var d = new Date(dateString);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }

      function getFilters() {
        var filters = {};
        if (repositoryFilter.value) { filters.repository = repositoryFilter.value; }
        if (authorFilter.value) { filters.author = authorFilter.value; }
        if (startDateInput.value) { filters.startDate = startDateInput.value; }
        if (endDateInput.value) { filters.endDate = endDateInput.value; }
        return filters;
      }

      // ======================================================================
      // State Management
      // ======================================================================
      function showLoading() {
        loadingState.style.display = 'flex';
        errorState.style.display = 'none';
        emptyState.style.display = 'none';
        chartArea.style.display = 'none';
        roiMetric.style.display = 'none';
        drillDownPanel.style.display = 'none';
      }

      function hideLoading() {
        loadingState.style.display = 'none';
      }

      function showError(msg) {
        hideLoading();
        errorState.innerHTML = '<div class="error-banner" role="alert"><span>&#9888;</span> ' + msg + '</div>';
        errorState.style.display = 'block';
        chartArea.style.display = 'none';
      }

      function hideError() {
        errorState.style.display = 'none';
        errorState.innerHTML = '';
      }

      function showEmpty(title, desc) {
        hideLoading();
        emptyState.innerHTML = '<div class="empty-state"><h2>' + escapeHtml(title) +
          '</h2><p>' + escapeHtml(desc) + '</p></div>';
        emptyState.style.display = 'block';
        chartArea.style.display = 'none';
      }

      function hideEmpty() {
        emptyState.style.display = 'none';
        emptyState.innerHTML = '';
      }

      // ======================================================================
      // Data Requests
      // ======================================================================
      function requestData() {
        showLoading();
        vscode.postMessage({
          type: 'requestTestDebtData',
          filters: getFilters(),
        });
      }

      function requestLowTestCommits() {
        vscode.postMessage({
          type: 'requestLowTestCommits',
          filters: getFilters(),
        });
      }

      // ======================================================================
      // Window Resize Handler
      // ======================================================================
      var resizeTimeout;
      window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function() {
          if (weeksData && weeksData.length > 0) {
            renderStackedBarChart(weeksData);
            renderScatterPlot(weeksData, correlationData);
          }
        }, 200);
      });

      // ======================================================================
      // Chart Explanation Collapse State Persistence (IQS-922)
      // ======================================================================
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

      // ======================================================================
      // Initial Load
      // ======================================================================
      requestData();

    })();
  </script>
</body>
</html>`;
}
