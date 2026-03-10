/**
 * HTML content generator for the Release Management Contributions chart webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Grouped bar chart with Production (blue) and Staging/Dev (orange) bars
 * - Date range picker with 30-day default
 * - Tooltips, legend, CSV export, data table fallback
 * - ARIA accessibility and colorblind-accessible markers
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-898
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the release management chart HTML.
 */
export interface ReleaseMgmtHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the release management CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Release Management Contributions chart webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateReleaseMgmtHtml(config: ReleaseMgmtHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Release Management Contributions</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Release Integration Activity by Team Member</h1>
      <div class="controls">
        <div class="date-controls">
          <label for="startDate">From:</label>
          <input type="date" id="startDate" aria-label="Start date" />
          <label for="endDate">To:</label>
          <input type="date" id="endDate" aria-label="End date" />
          <button class="action-btn" id="applyDateBtn" aria-label="Apply date filter" tabindex="0">Apply</button>
        </div>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading release management data...</span>
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
          <p>This grouped bar chart shows release contributions by team member across environments (Production, Staging/Dev, and Release Tags). Identify who is actively participating in the release process and ensure release responsibilities are well-distributed across the team.</p>
        </div>
      </details>
      <div id="legendContainer" class="chart-legend release-legend" role="img" aria-label="Environment legend"></div>
      <div class="chart-svg-container" role="img" aria-label="Grouped bar chart showing release contributions by team member and environment">
        <svg id="chartSvg"></svg>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div class="data-table-container" id="dataTableContainer" style="display:none;">
      <button class="data-table-toggle" id="toggleTableBtn" aria-expanded="false" tabindex="0">
        Show data table
      </button>
      <div id="dataTableWrapper" style="display:none;" role="region" aria-label="Release contributions data table">
        <table class="data-table" id="dataTable">
          <thead>
            <tr>
              <th scope="col">Contributor</th>
              <th scope="col">Team</th>
              <th scope="col">Production Merges</th>
              <th scope="col">Staging/Dev Merges</th>
              <th scope="col">Release Tags</th>
              <th scope="col">Total Activity</th>
            </tr>
          </thead>
          <tbody id="dataTableBody"></tbody>
        </table>
      </div>
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
      var chartData = null;

      // Color scheme (colorblind-accessible with high contrast)
      var COLORS = {
        production: '#4dc9f6',
        staging: '#f67019',
      };

      // DOM References
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyDateBtn = document.getElementById('applyDateBtn');
      var startDateInput = document.getElementById('startDate');
      var endDateInput = document.getElementById('endDate');
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

      // Initialize default dates (last 30 days)
      function initDefaultDates() {
        var endDate = new Date();
        var startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);

        endDateInput.value = endDate.toISOString().split('T')[0];
        startDateInput.value = startDate.toISOString().split('T')[0];
      }

      // Event Handlers
      exportCsvBtn.addEventListener('click', function() {
        if (!chartData || !chartData.summaries || chartData.summaries.length === 0) { return; }
        var headers = ['Contributor', 'Full Name', 'Team', 'Production Merges', 'Staging/Dev Merges', 'Release Tags', 'Total Activity'];
        var rows = chartData.summaries.map(function(d) {
          return [
            d.author,
            d.fullName || '',
            d.team || '',
            d.productionMerges,
            d.stagingMerges,
            d.totalTags,
            d.totalActivity
          ];
        });
        exportCsvFromData(headers, rows, 'release-contributions.csv');
      });

      applyDateBtn.addEventListener('click', function() {
        requestData();
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
          case 'releaseMgmtData':
            handleReleaseMgmtData(message);
            break;
          case 'releaseMgmtError':
            showError(escapeHtml(message.message));
            break;
        }
      });

      function handleReleaseMgmtData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Release Management View Not Available',
            'The vw_release_contributions database view has not been created yet. Run migration 011 to enable this chart.'
          );
          return;
        }

        if (!message.summaries || message.summaries.length === 0) {
          showEmpty(
            'No Release Activity Found',
            'No release management activity found for the selected date range. Ensure merge commits have been analyzed by the pipeline.'
          );
          return;
        }

        chartData = { summaries: message.summaries, distribution: message.environmentDistribution };
        renderChart(message.summaries);
        renderSummaryStats(message.summaries, message.environmentDistribution);
        renderDataTable(message.summaries);
        chartArea.style.display = 'block';
        dataTableContainer.style.display = 'block';
      }

      // Grouped Bar Chart Rendering with D3.js
      function renderChart(data) {
        if (!data || data.length === 0) { return; }

        // Render legend first
        renderLegend();

        // Chart dimensions
        var margin = { top: 30, right: 30, bottom: 120, left: 60 };
        var containerWidth = Math.max(600, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var barHeight = 35;
        var groupPadding = 10;
        var height = Math.max(400, data.length * (barHeight * 2 + groupPadding) + margin.top + margin.bottom);

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Grouped bar chart: Production merges (blue) vs Staging/Dev merges (orange) by contributor');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        // Y Scale: contributor names
        var contributors = data.map(function(d) { return d.fullName || d.author; });
        var y0 = d3.scaleBand()
          .domain(contributors)
          .range([0, innerHeight])
          .paddingInner(0.2)
          .paddingOuter(0.1);

        // Sub-scale for bar groups (Production, Staging)
        var environments = ['Production', 'Staging'];
        var y1 = d3.scaleBand()
          .domain(environments)
          .range([0, y0.bandwidth()])
          .padding(0.1);

        // X Scale: counts
        var maxCount = d3.max(data, function(d) { return Math.max(d.productionMerges, d.stagingMerges); }) || 1;
        var x = d3.scaleLinear().domain([0, maxCount]).nice().range([0, innerWidth]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisBottom(x).tickSize(innerHeight).tickFormat(''))
          .selectAll('line').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // X Axis
        g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(x).ticks(6));

        // X Axis Label
        g.append('text')
          .attr('x', innerWidth / 2)
          .attr('y', innerHeight + 40)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '12px')
          .text('Number of Merge Commits');

        // Y Axis
        g.append('g').attr('class', 'axis')
          .call(d3.axisLeft(y0))
          .selectAll('text')
          .attr('font-size', '11px');

        // Color scale
        var color = d3.scaleOrdinal()
          .domain(environments)
          .range([COLORS.production, COLORS.staging]);

        // Draw bar groups
        var groups = g.selectAll('.contributor-group')
          .data(data)
          .enter()
          .append('g')
          .attr('class', 'contributor-group')
          .attr('transform', function(d) {
            return 'translate(0,' + y0(d.fullName || d.author) + ')';
          });

        // Production bars
        groups.append('rect')
          .attr('class', 'bar production-bar')
          .attr('y', y1('Production'))
          .attr('x', 0)
          .attr('height', y1.bandwidth())
          .attr('width', function(d) { return x(d.productionMerges); })
          .attr('fill', COLORS.production)
          .attr('aria-label', function(d) {
            return escapeHtml(d.fullName || d.author) + ': ' + d.productionMerges + ' production merges';
          })
          .on('mouseover', function(event, d) { showTooltip(event, d, 'Production'); })
          .on('mousemove', function(event) { moveTooltip(event); })
          .on('mouseout', hideTooltip);

        // Staging bars
        groups.append('rect')
          .attr('class', 'bar staging-bar')
          .attr('y', y1('Staging'))
          .attr('x', 0)
          .attr('height', y1.bandwidth())
          .attr('width', function(d) { return x(d.stagingMerges); })
          .attr('fill', COLORS.staging)
          .attr('aria-label', function(d) {
            return escapeHtml(d.fullName || d.author) + ': ' + d.stagingMerges + ' staging/dev merges';
          })
          .on('mouseover', function(event, d) { showTooltip(event, d, 'Staging'); })
          .on('mousemove', function(event) { moveTooltip(event); })
          .on('mouseout', hideTooltip);

        // Bar value labels (show count on bars if space permits)
        groups.append('text')
          .attr('class', 'bar-label')
          .attr('y', function() { return y1('Production') + y1.bandwidth() / 2 + 4; })
          .attr('x', function(d) { return Math.max(5, x(d.productionMerges) + 5); })
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px')
          .text(function(d) { return d.productionMerges > 0 ? d.productionMerges : ''; });

        groups.append('text')
          .attr('class', 'bar-label')
          .attr('y', function() { return y1('Staging') + y1.bandwidth() / 2 + 4; })
          .attr('x', function(d) { return Math.max(5, x(d.stagingMerges) + 5); })
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px')
          .text(function(d) { return d.stagingMerges > 0 ? d.stagingMerges : ''; });

        // Announce update to screen readers
        var liveRegion = document.getElementById('summaryStats');
        if (liveRegion) {
          liveRegion.setAttribute('aria-live', 'polite');
        }
      }

      // Tooltip
      function showTooltip(event, d, environment) {
        var envColor = environment === 'Production' ? COLORS.production : COLORS.staging;
        var count = environment === 'Production' ? d.productionMerges : d.stagingMerges;
        tooltip.innerHTML =
          '<div class="tt-component"><strong>' + escapeHtml(d.fullName || d.author) + '</strong></div>' +
          '<div class="tt-team">Team: ' + escapeHtml(d.team || 'Unassigned') + '</div>' +
          '<div class="tt-value" style="color:' + envColor + '">' +
            environment + ': ' + count + ' merge' + (count !== 1 ? 's' : '') + '</div>' +
          '<div class="tt-value">Release Tags: ' + d.totalTags + '</div>' +
          '<div class="tt-value">Total Activity: ' + d.totalActivity + '</div>';
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        moveTooltip(event);
      }

      function moveTooltip(event) {
        tooltip.style.left = (event.pageX + 12) + 'px';
        tooltip.style.top = (event.pageY - 28) + 'px';
      }

      function hideTooltip() {
        tooltip.classList.remove('visible');
        tooltip.setAttribute('aria-hidden', 'true');
      }

      // Legend
      function renderLegend() {
        legendContainer.innerHTML = '';

        // Production legend entry
        var prodItem = document.createElement('div');
        prodItem.className = 'legend-item';
        var prodSwatch = document.createElement('span');
        prodSwatch.className = 'legend-swatch';
        prodSwatch.style.backgroundColor = COLORS.production;
        prodItem.appendChild(prodSwatch);
        var prodLabel = document.createElement('span');
        prodLabel.textContent = 'Production (main/master/release)';
        prodItem.appendChild(prodLabel);
        legendContainer.appendChild(prodItem);

        // Staging legend entry
        var stagingItem = document.createElement('div');
        stagingItem.className = 'legend-item';
        var stagingSwatch = document.createElement('span');
        stagingSwatch.className = 'legend-swatch';
        stagingSwatch.style.backgroundColor = COLORS.staging;
        stagingItem.appendChild(stagingSwatch);
        var stagingLabel = document.createElement('span');
        stagingLabel.textContent = 'Staging/Dev (develop/staging/feature)';
        stagingItem.appendChild(stagingLabel);
        legendContainer.appendChild(stagingItem);
      }

      // Summary Stats
      function renderSummaryStats(summaries, distribution) {
        var totalContributors = summaries.length;
        var totalProductionMerges = 0;
        var totalStagingMerges = 0;
        var totalTags = 0;

        summaries.forEach(function(d) {
          totalProductionMerges += d.productionMerges;
          totalStagingMerges += d.stagingMerges;
          totalTags += d.totalTags;
        });

        summaryStats.innerHTML =
          createStatCard(totalContributors, 'Active Contributors') +
          createStatCard(totalProductionMerges.toLocaleString(), 'Production Merges', COLORS.production) +
          createStatCard(totalStagingMerges.toLocaleString(), 'Staging/Dev Merges', COLORS.staging) +
          createStatCard(totalTags.toLocaleString(), 'Release Tags');
      }

      function createStatCard(value, label, color) {
        var colorStyle = color ? ' style="color:' + color + '"' : '';
        return '<div class="stat-card"><div class="stat-value"' + colorStyle + '>' +
          escapeHtml(String(value)) + '</div><div class="stat-label">' +
          escapeHtml(label) + '</div></div>';
      }

      // Data Table (Accessibility Fallback)
      function renderDataTable(data) {
        var tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';
        data.forEach(function(d) {
          var tr = document.createElement('tr');

          var tdName = document.createElement('td');
          tdName.textContent = d.fullName || d.author;
          tr.appendChild(tdName);

          var tdTeam = document.createElement('td');
          tdTeam.textContent = d.team || 'Unassigned';
          tr.appendChild(tdTeam);

          var tdProd = document.createElement('td');
          tdProd.textContent = String(d.productionMerges);
          tr.appendChild(tdProd);

          var tdStaging = document.createElement('td');
          tdStaging.textContent = String(d.stagingMerges);
          tr.appendChild(tdStaging);

          var tdTags = document.createElement('td');
          tdTags.textContent = String(d.totalTags);
          tr.appendChild(tdTags);

          var tdTotal = document.createElement('td');
          tdTotal.textContent = String(d.totalActivity);
          tr.appendChild(tdTotal);

          tbody.appendChild(tr);
        });
      }

      // State Management
      function showLoading() {
        loadingState.style.display = 'flex';
        errorState.style.display = 'none';
        emptyState.style.display = 'none';
        chartArea.style.display = 'none';
        dataTableContainer.style.display = 'none';
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

      // Data Request
      function requestData() {
        showLoading();
        vscode.postMessage({
          type: 'requestReleaseMgmtData',
          startDate: startDateInput.value || undefined,
          endDate: endDateInput.value || undefined
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

      // Initial Load
      initDefaultDates();
      requestData();

    })();
  </script>
</body>
</html>`;
}
