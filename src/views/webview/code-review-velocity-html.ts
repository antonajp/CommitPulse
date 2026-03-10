/**
 * HTML content generator for the Code Review Velocity chart webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Interactive scatter plot: X=LOC (log scale), Y=hours to merge
 * - Point size = review cycles, point color = repository/size
 * - Tooltips with PR details, click to open in GitHub
 * - Filters for size category, date range, repository
 * - Summary statistics panel with averages
 * - Trend line showing expected review time
 * - Outlier detection (> 2σ from trend)
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-900
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the code review velocity chart HTML.
 */
export interface CodeReviewVelocityHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the code review velocity CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
  /** GitHub organization for PR link generation */
  readonly githubOrg: string;
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
 * Generate the full HTML document for the Code Review Velocity chart webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateCodeReviewVelocityHtml(config: CodeReviewVelocityHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource, githubOrg, jiraUrlPrefix, linearUrlPrefix } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Code Review Velocity</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Code Review Velocity</h1>
      <div class="controls">
        <div class="filter-group">
          <label for="startDate">From</label>
          <input type="date" id="startDate" aria-label="Start date filter" tabindex="0">
        </div>
        <div class="filter-group">
          <label for="endDate">To</label>
          <input type="date" id="endDate" aria-label="End date filter" tabindex="0">
        </div>
        <div class="filter-group">
          <label for="repoFilter">Repository</label>
          <select id="repoFilter" aria-label="Repository filter" tabindex="0">
            <option value="">All Repositories</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="sizeFilter">Size</label>
          <select id="sizeFilter" aria-label="Size category filter" tabindex="0">
            <option value="">All Sizes</option>
            <option value="XS">XS (1-10 LOC)</option>
            <option value="S">S (11-50 LOC)</option>
            <option value="M">M (51-250 LOC)</option>
            <option value="L">L (251-1000 LOC)</option>
            <option value="XL">XL (1000+ LOC)</option>
          </select>
        </div>
        <button class="action-btn" id="applyFilterBtn" aria-label="Apply filters" tabindex="0">Apply</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading code review velocity data...</span>
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
          <p>This scatter plot shows each pull request by size (LOC) versus time to merge. Smaller PRs that merge quickly appear in the green zone. Larger PRs taking longer to merge appear in the red zone. Use this to identify review bottlenecks and encourage smaller, more frequent PRs.</p>
        </div>
      </details>
      <div class="quadrant-legend">
        <span class="quadrant-label green-zone">Fast & Small (ideal)</span>
        <span class="quadrant-label red-zone">Slow & Large (needs attention)</span>
      </div>
      <div id="legendContainer" class="chart-legend scatter-legend" role="img" aria-label="Series legend"></div>
      <div class="chart-svg-container" role="img" aria-label="Scatter plot showing PR size vs time to merge">
        <svg id="chartSvg"></svg>
      </div>
      <div class="chart-instructions">
        <p>Click a data point to open the PR in GitHub. Hover for details. Use Tab/Enter for keyboard navigation.</p>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div class="data-table-container" id="dataTableContainer" style="display:none;">
      <button class="data-table-toggle" id="toggleTableBtn" aria-expanded="false" tabindex="0">
        Show data table
      </button>
      <div id="dataTableWrapper" style="display:none;" role="region" aria-label="Code review velocity data table">
        <table class="data-table" id="dataTable">
          <thead>
            <tr>
              <th scope="col">PR</th>
              <th scope="col">Title</th>
              <th scope="col">Author</th>
              <th scope="col">Repository</th>
              <th scope="col">LOC</th>
              <th scope="col">Hrs to Review</th>
              <th scope="col">Hrs to Merge</th>
              <th scope="col">Review Cycles</th>
              <th scope="col">Size</th>
              <th scope="col">Ticket</th>
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
      // Configuration
      // ======================================================================
      var GITHUB_ORG = "${githubOrg}";

      // IQS-926: URL prefixes for issue navigation
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
      var chartData = null;
      var uniqueRepos = [];

      // Size category colors (colorblind-accessible palette)
      var SIZE_COLORS = {
        XS: '#4dc9f6',  // cyan
        S: '#2a9d8f',   // teal
        M: '#f9c74f',   // yellow
        L: '#f67019',   // orange
        XL: '#e63946',  // red
      };

      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('applyFilterBtn');
      var startDateInput = document.getElementById('startDate');
      var endDateInput = document.getElementById('endDate');
      var repoFilter = document.getElementById('repoFilter');
      var sizeFilter = document.getElementById('sizeFilter');
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
      // Set default date range (last 90 days)
      // ======================================================================
      function setDefaultDateRange() {
        var endDate = new Date();
        var startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        startDateInput.value = startDate.toISOString().split('T')[0];
        endDateInput.value = endDate.toISOString().split('T')[0];
      }

      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', function() {
        if (!chartData || chartData.length === 0) { return; }
        var headers = ['PR #', 'Title', 'Author', 'Repository', 'LOC Changed', 'Hours to First Review',
                       'Hours to Merge', 'Review Cycles', 'Size Category', 'Ticket ID', 'Created At'];
        var rows = chartData.map(function(d) {
          return [d.prNumber, d.title, d.author, d.repository, d.locChanged,
                  d.hoursToFirstReview, d.hoursToMerge, d.reviewCycles,
                  d.sizeCategory, d.linkedTicketId || '', d.createdAt];
        });
        exportCsvFromData(headers, rows, 'code-review-velocity.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        requestData();
      });

      toggleTableBtn.addEventListener('click', function() {
        var isExpanded = toggleTableBtn.getAttribute('aria-expanded') === 'true';
        toggleTableBtn.setAttribute('aria-expanded', String(!isExpanded));
        toggleTableBtn.textContent = isExpanded ? 'Show data table' : 'Hide data table';
        dataTableWrapper.style.display = isExpanded ? 'none' : 'block';
      });

      // ======================================================================
      // Message Handling
      // ======================================================================
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'codeReviewData':
            handleCodeReviewData(message);
            break;
          case 'codeReviewError':
            showError(escapeHtml(message.message));
            break;
        }
      });

      function handleCodeReviewData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Code Review View Not Available',
            'The vw_code_review_velocity database view has not been created yet. Run the database migration (012) to enable this chart.'
          );
          return;
        }

        if (!message.rows || message.rows.length === 0) {
          showEmpty(
            'No Code Review Data Available',
            'No PR data found for the selected date range. Ensure PRs have been synced from GitHub using the pipeline.'
          );
          return;
        }

        // Filter to only merged PRs with valid hours to merge
        chartData = message.rows.filter(function(r) {
          return r.hoursToMerge !== null && r.hoursToMerge > 0;
        });

        if (chartData.length === 0) {
          showEmpty(
            'No Merged PRs Found',
            'No merged PRs with time-to-merge data found. Ensure PRs have been synced and have merge timestamps.'
          );
          return;
        }

        // Extract unique repositories for filter dropdown
        uniqueRepos = [];
        var repoSet = {};
        chartData.forEach(function(d) {
          if (d.repository && !repoSet[d.repository]) {
            repoSet[d.repository] = true;
            uniqueRepos.push(d.repository);
          }
        });
        uniqueRepos.sort();
        populateRepoFilter();

        renderChart(chartData);
        renderSummaryStats(chartData);
        renderLegend();
        renderDataTable(chartData);
        chartArea.style.display = 'block';
        dataTableContainer.style.display = 'block';
      }

      // ======================================================================
      // Populate Repository Filter
      // ======================================================================
      function populateRepoFilter() {
        var currentValue = repoFilter.value;
        // Clear existing options except "All"
        while (repoFilter.options.length > 1) {
          repoFilter.remove(1);
        }
        uniqueRepos.forEach(function(repo) {
          var option = document.createElement('option');
          option.value = repo;
          option.textContent = repo;
          repoFilter.appendChild(option);
        });
        // Restore selection if still valid
        if (currentValue && uniqueRepos.indexOf(currentValue) !== -1) {
          repoFilter.value = currentValue;
        }
      }

      // ======================================================================
      // Scatter Plot Rendering with D3.js
      // ======================================================================
      function renderChart(data) {
        if (!data || data.length === 0) { return; }

        // Chart dimensions
        var margin = { top: 40, right: 40, bottom: 60, left: 80 };
        var containerWidth = Math.max(600, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var height = 450;

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Scatter plot: PR size (LOC) vs time to merge (hours)');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        // X Scale: LOC Changed (log scale)
        var xExtent = d3.extent(data, function(d) { return Math.max(1, d.locChanged); });
        var x = d3.scaleLog()
          .domain([Math.max(1, xExtent[0] * 0.5), xExtent[1] * 1.5])
          .range([0, innerWidth])
          .nice();

        // Y Scale: Hours to Merge (linear)
        var yMax = d3.max(data, function(d) { return d.hoursToMerge; }) || 1;
        var y = d3.scaleLinear()
          .domain([0, yMax * 1.1])
          .nice()
          .range([innerHeight, 0]);

        // Point size scale: Review Cycles (1-5+ cycles)
        var rScale = d3.scaleSqrt()
          .domain([0, 5])
          .range([4, 16]);

        // ---- Quadrant Zones (visual guide) ----
        var medianLOC = d3.median(data, function(d) { return d.locChanged; }) || 100;
        var medianHours = d3.median(data, function(d) { return d.hoursToMerge; }) || 24;

        // Green zone: small & fast (bottom-left)
        g.append('rect')
          .attr('x', 0)
          .attr('y', y(medianHours))
          .attr('width', x(medianLOC))
          .attr('height', innerHeight - y(medianHours))
          .attr('fill', '#2a9d8f')
          .attr('fill-opacity', 0.08);

        // Red zone: large & slow (top-right)
        g.append('rect')
          .attr('x', x(medianLOC))
          .attr('y', 0)
          .attr('width', innerWidth - x(medianLOC))
          .attr('height', y(medianHours))
          .attr('fill', '#e63946')
          .attr('fill-opacity', 0.08);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(y).tickSize(-innerWidth).tickFormat(''))
          .selectAll('line').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // ---- X Axis (LOC Changed - Log Scale) ----
        g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(x)
            .tickValues([1, 10, 50, 100, 250, 500, 1000, 5000])
            .tickFormat(function(d) { return d.toLocaleString(); }))
          .selectAll('text')
          .attr('font-size', '11px');

        // X Axis Label
        g.append('text')
          .attr('x', innerWidth / 2)
          .attr('y', innerHeight + 45)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #cccccc)')
          .attr('font-size', '12px')
          .text('Lines of Code Changed (log scale)');

        // ---- Y Axis (Hours to Merge) ----
        g.append('g').attr('class', 'axis')
          .call(d3.axisLeft(y).ticks(8).tickFormat(function(d) {
            if (d >= 168) { return (d / 168).toFixed(1) + 'w'; }
            if (d >= 24) { return (d / 24).toFixed(0) + 'd'; }
            return d + 'h';
          }));

        // Y Axis Label
        g.append('text').attr('transform', 'rotate(-90)')
          .attr('y', -60).attr('x', -innerHeight / 2).attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #cccccc)').attr('font-size', '12px')
          .text('Time to Merge');

        // ---- Trend Line (linear regression in log space) ----
        var logData = data.map(function(d) {
          return { x: Math.log(Math.max(1, d.locChanged)), y: d.hoursToMerge };
        });
        var meanX = d3.mean(logData, function(d) { return d.x; });
        var meanY = d3.mean(logData, function(d) { return d.y; });
        var ssXX = d3.sum(logData, function(d) { return Math.pow(d.x - meanX, 2); });
        var ssXY = d3.sum(logData, function(d) { return (d.x - meanX) * (d.y - meanY); });
        var slope = ssXX > 0 ? ssXY / ssXX : 0;
        var intercept = meanY - slope * meanX;

        // Calculate residuals and std dev for outlier detection
        var residuals = logData.map(function(d) {
          return d.y - (slope * d.x + intercept);
        });
        var residualStd = d3.deviation(residuals) || 1;

        // Draw trend line
        var trendLine = d3.line()
          .x(function(d) { return x(d); })
          .y(function(d) { return y(slope * Math.log(d) + intercept); });
        var trendXValues = [xExtent[0], xExtent[1]];
        g.append('path')
          .datum(trendXValues)
          .attr('fill', 'none')
          .attr('stroke', 'var(--vscode-charts-lines, #888)')
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '6,4')
          .attr('d', trendLine)
          .attr('aria-hidden', 'true');

        // ---- Data Points ----
        data.forEach(function(d, i) {
          var cx = x(Math.max(1, d.locChanged));
          var cy = y(d.hoursToMerge);
          var r = rScale(Math.min(d.reviewCycles, 5));
          var color = SIZE_COLORS[d.sizeCategory] || '#888';

          // Check if outlier (> 2σ from trend)
          var expectedY = slope * Math.log(Math.max(1, d.locChanged)) + intercept;
          var isOutlier = Math.abs(d.hoursToMerge - expectedY) > 2 * residualStd;

          var circle = g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', r)
            .attr('fill', color)
            .attr('fill-opacity', 0.7)
            .attr('stroke', isOutlier ? '#fff' : color)
            .attr('stroke-width', isOutlier ? 2 : 1)
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', 'PR #' + d.prNumber + ': ' + d.locChanged + ' LOC, ' +
                   d.hoursToMerge.toFixed(1) + ' hours to merge')
            .on('mouseover', function(event) {
              showTooltip(event, d);
            })
            .on('mousemove', function(event) { moveTooltip(event); })
            .on('mouseout', hideTooltip)
            .on('click', function() {
              openPR(d.repository, d.prNumber);
            })
            .on('keydown', function(event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openPR(d.repository, d.prNumber);
              }
            });

          // Outlier warning badge
          if (isOutlier) {
            g.append('text')
              .attr('x', cx + r + 2)
              .attr('y', cy - r)
              .attr('fill', '#e63946')
              .attr('font-size', '14px')
              .attr('font-weight', 'bold')
              .text('⚠')
              .attr('aria-hidden', 'true');
          }
        });

        // Announce update to screen readers
        var liveRegion = document.getElementById('summaryStats');
        if (liveRegion) {
          liveRegion.setAttribute('aria-live', 'polite');
        }
      }

      // ======================================================================
      // Tooltip
      // ======================================================================
      function showTooltip(event, d) {
        var ticketLink = '';
        if (d.linkedTicketId && d.linkedTicketType) {
          ticketLink = '<div class="tt-ticket"><a href="#" onclick="openTicket(\\'' +
            escapeHtml(d.linkedTicketId) + '\\', \\'' + escapeHtml(d.linkedTicketType) + '\\'); return false;">' +
            escapeHtml(d.linkedTicketId) + '</a> (click to open)</div>';
        }

        tooltip.innerHTML =
          '<div class="tt-component"><strong>PR #' + escapeHtml(String(d.prNumber)) + ': ' +
            escapeHtml(d.title.substring(0, 60)) + (d.title.length > 60 ? '...' : '') + '</strong></div>' +
          '<div class="tt-author">Author: ' + escapeHtml(d.author) + '</div>' +
          '<div class="tt-repo">Repository: ' + escapeHtml(d.repository) + '</div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-value">LOC Changed: ' + escapeHtml(d.locChanged.toLocaleString()) + '</div>' +
          '<div class="tt-value">Hours to First Review: ' +
            (d.hoursToFirstReview !== null ? escapeHtml(d.hoursToFirstReview.toFixed(1)) : 'N/A') + '</div>' +
          '<div class="tt-value">Hours to Merge: ' + escapeHtml(d.hoursToMerge.toFixed(1)) + '</div>' +
          '<div class="tt-value">Review Cycles: ' + escapeHtml(String(d.reviewCycles)) + '</div>' +
          '<div class="tt-size">Size Category: ' + escapeHtml(d.sizeCategory) + '</div>' +
          ticketLink +
          '<div class="tt-action">[Click to view PR in GitHub]</div>';
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        moveTooltip(event);
      }

      function moveTooltip(event) {
        var x = event.pageX + 12;
        var y = event.pageY - 28;
        // Keep tooltip within viewport
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
      // Open PR in GitHub (IQS-926: use message protocol for security)
      // ======================================================================
      function openPR(repository, prNumber) {
        // Delegate URL opening to extension host for validation
        var url = 'https://github.com/' + encodeURIComponent(repository) + '/pull/' + encodeURIComponent(String(prNumber));
        vscode.postMessage({ type: 'openExternal', url: url });
      }

      // ======================================================================
      // Open Linked Ticket (IQS-926: use message protocol for secure URL building)
      // ======================================================================
      window.openTicket = function(ticketId, ticketType) {
        if (!ticketId) return;
        // Delegate URL construction to extension host for security validation
        vscode.postMessage({
          type: 'openTicket',
          ticketId: ticketId,
          ticketType: ticketType,
          jiraUrlPrefix: JIRA_URL_PREFIX,
          linearUrlPrefix: LINEAR_URL_PREFIX,
        });
      };

      // ======================================================================
      // Legend
      // ======================================================================
      function renderLegend() {
        legendContainer.innerHTML = '';

        // Size category legend
        var sizes = ['XS', 'S', 'M', 'L', 'XL'];
        var sizeLabels = {
          XS: '1-10 LOC',
          S: '11-50 LOC',
          M: '51-250 LOC',
          L: '251-1000 LOC',
          XL: '1000+ LOC'
        };

        sizes.forEach(function(size) {
          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = SIZE_COLORS[size];
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.textContent = size + ' (' + sizeLabels[size] + ')';
          item.appendChild(label);

          legendContainer.appendChild(item);
        });

        // Point size legend
        var sizeNote = document.createElement('div');
        sizeNote.className = 'legend-note';
        sizeNote.textContent = 'Point size = Review cycles (larger = more rounds of review)';
        legendContainer.appendChild(sizeNote);
      }

      // ======================================================================
      // Summary Stats
      // ======================================================================
      function renderSummaryStats(data) {
        var totalPRs = data.length;
        var avgHoursToFirstReview = 0;
        var avgHoursToMerge = 0;
        var avgReviewCycles = 0;
        var countWithFirstReview = 0;

        data.forEach(function(d) {
          if (d.hoursToFirstReview !== null) {
            avgHoursToFirstReview += d.hoursToFirstReview;
            countWithFirstReview++;
          }
          avgHoursToMerge += d.hoursToMerge;
          avgReviewCycles += d.reviewCycles;
        });

        avgHoursToFirstReview = countWithFirstReview > 0 ? avgHoursToFirstReview / countWithFirstReview : 0;
        avgHoursToMerge = totalPRs > 0 ? avgHoursToMerge / totalPRs : 0;
        avgReviewCycles = totalPRs > 0 ? avgReviewCycles / totalPRs : 0;

        // Count by size category
        var sizeCounts = { XS: 0, S: 0, M: 0, L: 0, XL: 0 };
        data.forEach(function(d) {
          if (sizeCounts[d.sizeCategory] !== undefined) {
            sizeCounts[d.sizeCategory]++;
          }
        });

        summaryStats.innerHTML =
          createStatCard(totalPRs.toLocaleString(), 'Merged PRs') +
          createStatCard(formatHours(avgHoursToFirstReview), 'Avg Time to First Review') +
          createStatCard(formatHours(avgHoursToMerge), 'Avg Time to Merge') +
          createStatCard(avgReviewCycles.toFixed(1), 'Avg Review Cycles') +
          createSizeBreakdown(sizeCounts);
      }

      function formatHours(hours) {
        if (hours >= 168) {
          return (hours / 168).toFixed(1) + 'w';
        }
        if (hours >= 24) {
          return (hours / 24).toFixed(1) + 'd';
        }
        return hours.toFixed(1) + 'h';
      }

      function createStatCard(value, label) {
        return '<div class="stat-card"><div class="stat-value">' +
          escapeHtml(String(value)) + '</div><div class="stat-label">' +
          escapeHtml(label) + '</div></div>';
      }

      function createSizeBreakdown(counts) {
        var html = '<div class="stat-card size-breakdown"><div class="stat-label">PRs by Size</div>';
        ['XS', 'S', 'M', 'L', 'XL'].forEach(function(size) {
          html += '<span class="size-count" style="color:' + SIZE_COLORS[size] + '">' +
                  size + ': ' + counts[size] + '</span>';
        });
        html += '</div>';
        return html;
      }

      // ======================================================================
      // Data Table (Accessibility Fallback)
      // ======================================================================
      function renderDataTable(data) {
        var tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';
        data.forEach(function(d) {
          var tr = document.createElement('tr');

          var tdPR = document.createElement('td');
          var prLink = document.createElement('a');
          prLink.href = '#';
          prLink.textContent = '#' + d.prNumber;
          prLink.onclick = function(e) { e.preventDefault(); openPR(d.repository, d.prNumber); };
          tdPR.appendChild(prLink);
          tr.appendChild(tdPR);

          var tdTitle = document.createElement('td');
          tdTitle.textContent = d.title.substring(0, 40) + (d.title.length > 40 ? '...' : '');
          tdTitle.title = d.title;
          tr.appendChild(tdTitle);

          var tdAuthor = document.createElement('td');
          tdAuthor.textContent = d.author;
          tr.appendChild(tdAuthor);

          var tdRepo = document.createElement('td');
          tdRepo.textContent = d.repository;
          tr.appendChild(tdRepo);

          var tdLOC = document.createElement('td');
          tdLOC.textContent = d.locChanged.toLocaleString();
          tr.appendChild(tdLOC);

          var tdFirstReview = document.createElement('td');
          tdFirstReview.textContent = d.hoursToFirstReview !== null ? d.hoursToFirstReview.toFixed(1) : 'N/A';
          tr.appendChild(tdFirstReview);

          var tdMerge = document.createElement('td');
          tdMerge.textContent = d.hoursToMerge.toFixed(1);
          tr.appendChild(tdMerge);

          var tdCycles = document.createElement('td');
          tdCycles.textContent = String(d.reviewCycles);
          tr.appendChild(tdCycles);

          var tdSize = document.createElement('td');
          tdSize.textContent = d.sizeCategory;
          tdSize.style.color = SIZE_COLORS[d.sizeCategory];
          tr.appendChild(tdSize);

          var tdTicket = document.createElement('td');
          if (d.linkedTicketId) {
            var ticketLink = document.createElement('a');
            ticketLink.href = '#';
            ticketLink.textContent = d.linkedTicketId;
            ticketLink.onclick = function(e) {
              e.preventDefault();
              window.openTicket(d.linkedTicketId, d.linkedTicketType);
            };
            tdTicket.appendChild(ticketLink);
          } else {
            tdTicket.textContent = '-';
          }
          tr.appendChild(tdTicket);

          tbody.appendChild(tr);
        });
      }

      // ======================================================================
      // State Management
      // ======================================================================
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

      // ======================================================================
      // Data Request
      // ======================================================================
      function requestData() {
        showLoading();
        var message = {
          type: 'requestCodeReviewData',
          startDate: startDateInput.value || undefined,
          endDate: endDateInput.value || undefined,
          repository: repoFilter.value || undefined,
          sizeCategory: sizeFilter.value || undefined,
        };
        vscode.postMessage(message);
      }

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
      setDefaultDateRange();
      requestData();

    })();
  </script>
</body>
</html>`;
}
