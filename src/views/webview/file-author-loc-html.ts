/**
 * HTML content generator for the File Author LOC Contribution webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Interactive horizontal stacked bar chart
 * - Sortable data table with export capability
 * - Input form for file paths and timeframe selection
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: GITX-128
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the file author LOC HTML.
 */
export interface FileAuthorLocHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the File Author LOC Contribution webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateFileAuthorLocHtml(config: FileAuthorLocHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>File Contribution Report</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>File Author LOC Contribution Report</h1>
      <p class="chart-subtitle">Analyze contributor ownership by file</p>
    </div>

    <div class="input-section" id="inputSection">
      <div class="input-form">
        <div class="form-group">
          <label for="filePathInput">File Paths</label>
          <textarea
            id="filePathInput"
            rows="5"
            placeholder="Enter file paths (one per line or comma-separated)&#10;Examples:&#10;src/extension.ts&#10;src/services/*.ts&#10;src/views/**/*.ts"
            aria-label="File paths to analyze"
            tabindex="0"
          ></textarea>
          <div class="input-help">
            <span id="fileCount">0 files</span> | Max 100 files | Glob patterns supported (*, **)
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="timeframeSelect">Timeframe</label>
            <select id="timeframeSelect" aria-label="Select timeframe" tabindex="0">
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d" selected>Last 90 days</option>
              <option value="6m">Last 6 months</option>
              <option value="custom">Custom range</option>
            </select>
          </div>

          <div class="form-group date-range" id="customDateRange" style="display:none;">
            <label for="startDate">Start Date</label>
            <input type="date" id="startDate" aria-label="Start date" tabindex="0">
          </div>

          <div class="form-group date-range" id="customDateRangeEnd" style="display:none;">
            <label for="endDate">End Date</label>
            <input type="date" id="endDate" aria-label="End date" tabindex="0">
          </div>

          <div class="form-group">
            <label for="repoFilter">Repository</label>
            <select id="repoFilter" aria-label="Repository filter" tabindex="0">
              <option value="">All Repositories</option>
            </select>
          </div>
        </div>

        <div class="form-actions">
          <button class="action-btn primary" id="analyzeBtn" aria-label="Analyze file contributions" tabindex="0">
            Analyze Contributions
          </button>
        </div>
      </div>
    </div>

    <div id="loadingState" class="loading-overlay" style="display:none;" role="status" aria-label="Loading">
      <div class="loading-spinner"></div>
      <span class="loading-text">Analyzing file contributions...</span>
      <button class="cancel-btn" id="cancelBtn" aria-label="Cancel" tabindex="0">Cancel</button>
    </div>

    <div id="errorState" style="display:none;"></div>

    <div id="emptyState" style="display:none;"></div>

    <div id="resultsSection" style="display:none;">
      <div class="results-header">
        <div class="results-summary" id="resultsSummary"></div>
        <div class="controls">
          <div class="filter-group">
            <label for="metricSelect">Metric</label>
            <select id="metricSelect" aria-label="Select metric" tabindex="0">
              <option value="totalChurn" selected>Total Churn</option>
              <option value="linesAdded">Lines Added</option>
              <option value="netLines">Net Lines</option>
            </select>
          </div>
          <div class="filter-group">
            <label for="chartTypeSelect">Chart Type</label>
            <select id="chartTypeSelect" aria-label="Select chart type" tabindex="0">
              <option value="stacked" selected>Stacked Bars</option>
              <option value="grouped">Grouped Bars</option>
            </select>
          </div>
          <button class="export-btn" id="exportCsvBtn" aria-label="Export as CSV" tabindex="0">Export CSV</button>
        </div>
      </div>

      <details class="chart-explanation" open>
        <summary class="explanation-toggle">
          <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>What does this chart show?</span>
        </summary>
        <div class="explanation-content">
          <p>This horizontal stacked bar chart shows LOC (lines of code) contributions per file. Each bar represents a file, with colored segments showing each author's contribution. Click a segment to see individual commits. Use the metric dropdown to switch between Total Churn, Lines Added, or Net Lines.</p>
        </div>
      </details>

      <div id="legendContainer" class="chart-legend author-legend" role="img" aria-label="Author legend"></div>

      <div id="chartArea">
        <div class="chart-svg-container" role="img" aria-label="Stacked bar chart showing file contributions">
          <svg id="chartSvg"></svg>
        </div>
      </div>

      <div class="chart-instructions">
        <p>Click a bar segment to see commit details. Hover for author info. Use Tab/Enter for keyboard navigation.</p>
      </div>

      <div class="data-table-container" id="dataTableContainer">
        <h2>Contribution Details</h2>
        <table class="data-table sortable" id="dataTable">
          <thead>
            <tr>
              <th scope="col" data-sort="filename">File <span class="sort-indicator"></span></th>
              <th scope="col" data-sort="authorName">Author <span class="sort-indicator"></span></th>
              <th scope="col" data-sort="team">Team <span class="sort-indicator"></span></th>
              <th scope="col" data-sort="linesAdded">Lines Added <span class="sort-indicator"></span></th>
              <th scope="col" data-sort="linesDeleted">Lines Deleted <span class="sort-indicator"></span></th>
              <th scope="col" data-sort="netLines">Net Lines <span class="sort-indicator"></span></th>
              <th scope="col" data-sort="totalChurn">Total Churn <span class="sort-indicator"></span></th>
              <th scope="col" data-sort="commitCount">Commits <span class="sort-indicator"></span></th>
              <th scope="col" data-sort="lastCommit">Last Commit <span class="sort-indicator"></span></th>
            </tr>
          </thead>
          <tbody id="dataTableBody"></tbody>
        </table>
      </div>

      <div id="drillDownModal" class="modal" style="display:none;" role="dialog" aria-labelledby="drillDownTitle">
        <div class="modal-content">
          <div class="modal-header">
            <h3 id="drillDownTitle">Commit Details</h3>
            <button class="close-btn" id="closeDrillDown" aria-label="Close" tabindex="0">&times;</button>
          </div>
          <div class="modal-body">
            <table class="data-table" id="drillDownTable">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">SHA</th>
                  <th scope="col">Message</th>
                  <th scope="col">+Lines</th>
                  <th scope="col">-Lines</th>
                </tr>
              </thead>
              <tbody id="drillDownTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
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
      var currentFilters = {
        filePaths: [],
        startDate: null,
        endDate: null,
        repository: ''
      };
      var currentMetric = 'totalChurn';
      var currentChartType = 'stacked';
      var sortColumn = 'totalChurn';
      var sortDirection = 'desc';

      // Okabe-Ito colorblind-safe palette
      var AUTHOR_COLORS = [
        '#E69F00', // orange
        '#56B4E9', // sky blue
        '#009E73', // bluish green
        '#F0E442', // yellow
        '#0072B2', // blue
        '#D55E00', // vermillion
        '#CC79A7', // reddish purple
        '#999999', // gray
      ];
      var authorColorMap = {};
      var colorIndex = 0;

      function getAuthorColor(author) {
        if (!authorColorMap[author]) {
          authorColorMap[author] = AUTHOR_COLORS[colorIndex % AUTHOR_COLORS.length];
          colorIndex++;
        }
        return authorColorMap[author];
      }

      // ======================================================================
      // DOM References
      // ======================================================================
      var filePathInput = document.getElementById('filePathInput');
      var timeframeSelect = document.getElementById('timeframeSelect');
      var startDateInput = document.getElementById('startDate');
      var endDateInput = document.getElementById('endDate');
      var customDateRange = document.getElementById('customDateRange');
      var customDateRangeEnd = document.getElementById('customDateRangeEnd');
      var repoFilter = document.getElementById('repoFilter');
      var analyzeBtn = document.getElementById('analyzeBtn');
      var cancelBtn = document.getElementById('cancelBtn');
      var metricSelect = document.getElementById('metricSelect');
      var chartTypeSelect = document.getElementById('chartTypeSelect');
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var closeDrillDown = document.getElementById('closeDrillDown');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var resultsSection = document.getElementById('resultsSection');
      var inputSection = document.getElementById('inputSection');
      var legendContainer = document.getElementById('legendContainer');
      var tooltip = document.getElementById('tooltip');
      var drillDownModal = document.getElementById('drillDownModal');
      var fileCountEl = document.getElementById('fileCount');
      var resultsSummary = document.getElementById('resultsSummary');

      // ======================================================================
      // Event Handlers
      // ======================================================================
      filePathInput.addEventListener('input', updateFileCount);

      timeframeSelect.addEventListener('change', function() {
        var isCustom = timeframeSelect.value === 'custom';
        customDateRange.style.display = isCustom ? 'block' : 'none';
        customDateRangeEnd.style.display = isCustom ? 'block' : 'none';
      });

      analyzeBtn.addEventListener('click', function() {
        requestData();
      });

      cancelBtn.addEventListener('click', function() {
        hideLoading();
      });

      metricSelect.addEventListener('change', function() {
        currentMetric = metricSelect.value;
        if (chartData) { renderChart(chartData); }
      });

      chartTypeSelect.addEventListener('change', function() {
        currentChartType = chartTypeSelect.value;
        if (chartData) { renderChart(chartData); }
      });

      exportCsvBtn.addEventListener('click', function() {
        if (!chartData || chartData.length === 0) { return; }
        var headers = ['File', 'Author', 'Team', 'Lines Added', 'Lines Deleted', 'Net Lines', 'Total Churn', 'Commits', 'First Commit', 'Last Commit'];
        var rows = chartData.map(function(d) {
          return [d.filename, d.authorName, d.team || '', d.linesAdded, d.linesDeleted, d.netLines, d.totalChurn, d.commitCount, d.firstCommit, d.lastCommit];
        });
        exportCsvFromData(headers, rows, 'file-contributions.csv');
      });

      closeDrillDown.addEventListener('click', function() {
        drillDownModal.style.display = 'none';
      });

      // Close modal on backdrop click
      drillDownModal.addEventListener('click', function(e) {
        if (e.target === drillDownModal) {
          drillDownModal.style.display = 'none';
        }
      });

      // Table sorting
      document.querySelectorAll('#dataTable th[data-sort]').forEach(function(th) {
        th.addEventListener('click', function() {
          var col = th.getAttribute('data-sort');
          if (sortColumn === col) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            sortColumn = col;
            sortDirection = 'desc';
          }
          updateSortIndicators();
          renderDataTable(chartData);
        });
        th.style.cursor = 'pointer';
      });

      // ======================================================================
      // Message Handling
      // ======================================================================
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'fileAuthorLocData':
            handleFileAuthorLocData(message);
            break;
          case 'repositories':
            handleRepositories(message.repositories);
            break;
          case 'fileAuthorDrillDownData':
            handleDrillDownData(message);
            break;
          case 'fileAuthorLocError':
            showError(escapeHtml(message.message));
            break;
          case 'fileAuthorLocLoading':
            if (message.isLoading) { showLoading(); } else { hideLoading(); }
            break;
          case 'exportCsvSuccess':
            showToast('Exported to ' + message.filename, 'success');
            break;
          case 'exportCsvError':
            if (!message.cancelled) {
              showToast('Export failed: ' + message.message, 'error');
            }
            break;
        }
      });

      function handleFileAuthorLocData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.hasData || message.rows.length === 0) {
          showEmpty(
            'No Contribution Data Found',
            'No commits found for the specified files in this timeframe. Try expanding the date range or checking the file paths.'
          );
          return;
        }

        chartData = message.rows;
        currentFilters.startDate = message.dateRange.startDate;
        currentFilters.endDate = message.dateRange.endDate;

        // Reset color mapping for new data
        authorColorMap = {};
        colorIndex = 0;

        updateResultsSummary(message);
        renderChart(chartData);
        renderLegend(message.authors);
        renderDataTable(chartData);

        inputSection.style.display = 'none';
        resultsSection.style.display = 'block';
      }

      function handleRepositories(repos) {
        while (repoFilter.options.length > 1) {
          repoFilter.remove(1);
        }
        (repos || []).forEach(function(repo) {
          var option = document.createElement('option');
          option.value = repo;
          option.textContent = repo;
          repoFilter.appendChild(option);
        });
      }

      function handleDrillDownData(message) {
        var tbody = document.getElementById('drillDownTableBody');
        tbody.innerHTML = '';

        document.getElementById('drillDownTitle').textContent =
          'Commits: ' + truncatePath(message.filename, 40) + ' by ' + escapeHtml(message.author);

        message.commits.forEach(function(commit) {
          var tr = document.createElement('tr');

          var tdDate = document.createElement('td');
          tdDate.textContent = commit.commitDate;
          tr.appendChild(tdDate);

          var tdSha = document.createElement('td');
          tdSha.textContent = commit.sha.substring(0, 7);
          tdSha.title = commit.sha;
          tr.appendChild(tdSha);

          var tdMsg = document.createElement('td');
          tdMsg.textContent = truncateMessage(commit.message, 60);
          tdMsg.title = commit.message;
          tr.appendChild(tdMsg);

          var tdAdd = document.createElement('td');
          tdAdd.textContent = '+' + commit.linesAdded;
          tdAdd.className = 'text-positive';
          tr.appendChild(tdAdd);

          var tdDel = document.createElement('td');
          tdDel.textContent = '-' + commit.linesDeleted;
          tdDel.className = 'text-negative';
          tr.appendChild(tdDel);

          tbody.appendChild(tr);
        });

        drillDownModal.style.display = 'flex';
      }

      // ======================================================================
      // Data Request
      // ======================================================================
      function requestData() {
        var paths = parseFilePaths(filePathInput.value);
        if (paths.length === 0) {
          showError('Please enter at least one file path');
          return;
        }
        if (paths.length > 100) {
          showError('Maximum 100 files allowed');
          return;
        }

        currentFilters.filePaths = paths;

        var dateRange = getDateRange();
        currentFilters.startDate = dateRange.startDate;
        currentFilters.endDate = dateRange.endDate;
        currentFilters.repository = repoFilter.value;

        showLoading();

        vscode.postMessage({
          type: 'requestFileAuthorLocData',
          filePaths: paths,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          repository: currentFilters.repository || undefined,
          timeframePreset: timeframeSelect.value
        });
      }

      function parseFilePaths(input) {
        if (!input) { return []; }
        return input.split(/[\\n,]/)
          .map(function(p) { return p.trim(); })
          .filter(function(p) { return p.length > 0; });
      }

      function getDateRange() {
        var now = new Date();
        var end = now.toISOString().split('T')[0];
        var start;

        switch (timeframeSelect.value) {
          case '7d':
            start = new Date(now.setDate(now.getDate() - 7)).toISOString().split('T')[0];
            break;
          case '30d':
            start = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
            break;
          case '90d':
            start = new Date(now.setDate(now.getDate() - 90)).toISOString().split('T')[0];
            break;
          case '6m':
            start = new Date(now.setMonth(now.getMonth() - 6)).toISOString().split('T')[0];
            break;
          case 'custom':
            start = startDateInput.value;
            end = endDateInput.value || end;
            break;
          default:
            start = new Date(now.setDate(now.getDate() - 90)).toISOString().split('T')[0];
        }

        return { startDate: start, endDate: end };
      }

      function updateFileCount() {
        var paths = parseFilePaths(filePathInput.value);
        fileCountEl.textContent = paths.length + ' file' + (paths.length === 1 ? '' : 's');
      }

      // ======================================================================
      // Chart Rendering with D3.js
      // ======================================================================
      function renderChart(data) {
        if (!data || data.length === 0) { return; }

        // Aggregate data by file
        var fileMap = {};
        data.forEach(function(d) {
          if (!fileMap[d.filename]) {
            fileMap[d.filename] = { filename: d.filename, total: 0, authors: [] };
          }
          var value = getMetricValue(d);
          fileMap[d.filename].total += value;
          fileMap[d.filename].authors.push({
            author: d.authorName,
            value: value,
            row: d
          });
        });

        // Convert to array and sort by total
        var files = Object.values(fileMap)
          .sort(function(a, b) { return b.total - a.total; })
          .slice(0, 50); // Limit to top 50 files

        // Chart dimensions
        var margin = { top: 20, right: 30, bottom: 40, left: 200 };
        var containerWidth = Math.max(600, document.querySelector('.chart-svg-container').clientWidth - 24);
        var barHeight = 28;
        var height = margin.top + margin.bottom + files.length * barHeight;
        var width = containerWidth;

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height);

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        // X Scale
        var maxValue = d3.max(files, function(d) { return d.total; }) || 1;
        var x = d3.scaleLinear()
          .domain([0, maxValue])
          .nice()
          .range([0, innerWidth]);

        // Y Scale
        var y = d3.scaleBand()
          .domain(files.map(function(d) { return d.filename; }))
          .range([0, innerHeight])
          .padding(0.15);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisBottom(x).tickSize(innerHeight).tickFormat(''))
          .selectAll('line').attr('stroke-dasharray', '2,2').attr('stroke-opacity', 0.3);
        g.selectAll('.grid .domain').remove();

        // X Axis
        g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format(',.0f')));

        // Y Axis
        g.append('g').attr('class', 'axis')
          .call(d3.axisLeft(y).tickFormat(function(d) { return truncatePath(d, 30); }));

        // Draw bars
        files.forEach(function(file, fileIndex) {
          var yPos = y(file.filename);
          var barStartX = 0;

          if (currentChartType === 'stacked') {
            // Stacked bars
            file.authors.forEach(function(author) {
              var barWidth = x(author.value);
              var color = getAuthorColor(author.author);

              g.append('rect')
                .attr('x', barStartX)
                .attr('y', yPos)
                .attr('width', barWidth)
                .attr('height', y.bandwidth())
                .attr('fill', color)
                .attr('stroke', 'var(--vscode-editor-background)')
                .attr('stroke-width', 1)
                .attr('cursor', 'pointer')
                .attr('tabindex', '0')
                .attr('role', 'button')
                .attr('aria-label', escapeHtml(author.author) + ': ' + author.value + ' ' + getMetricLabel())
                .on('mouseover', function(event) { showTooltip(event, author.row); })
                .on('mousemove', function(event) { moveTooltip(event); })
                .on('mouseout', hideTooltip)
                .on('click', function() { requestDrillDown(author.row); })
                .on('keydown', function(event) {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    requestDrillDown(author.row);
                  }
                });

              barStartX += barWidth;
            });
          } else {
            // Grouped bars
            var groupHeight = y.bandwidth() / file.authors.length;
            file.authors.forEach(function(author, authorIndex) {
              var barWidth = x(author.value);
              var color = getAuthorColor(author.author);

              g.append('rect')
                .attr('x', 0)
                .attr('y', yPos + authorIndex * groupHeight)
                .attr('width', barWidth)
                .attr('height', groupHeight - 2)
                .attr('fill', color)
                .attr('cursor', 'pointer')
                .attr('tabindex', '0')
                .attr('role', 'button')
                .attr('aria-label', escapeHtml(author.author) + ': ' + author.value + ' ' + getMetricLabel())
                .on('mouseover', function(event) { showTooltip(event, author.row); })
                .on('mousemove', function(event) { moveTooltip(event); })
                .on('mouseout', hideTooltip)
                .on('click', function() { requestDrillDown(author.row); })
                .on('keydown', function(event) {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    requestDrillDown(author.row);
                  }
                });
            });
          }
        });
      }

      function getMetricValue(row) {
        switch (currentMetric) {
          case 'linesAdded': return row.linesAdded;
          case 'netLines': return Math.abs(row.netLines);
          case 'totalChurn':
          default: return row.totalChurn;
        }
      }

      function getMetricLabel() {
        switch (currentMetric) {
          case 'linesAdded': return 'lines added';
          case 'netLines': return 'net lines';
          case 'totalChurn':
          default: return 'total churn';
        }
      }

      // ======================================================================
      // Tooltip
      // ======================================================================
      function showTooltip(event, row) {
        tooltip.innerHTML =
          '<div class="tt-component"><strong>' + escapeHtml(row.authorName) + '</strong></div>' +
          (row.team ? '<div class="tt-team">Team: ' + escapeHtml(row.team) + '</div>' : '') +
          '<hr class="tt-divider">' +
          '<div class="tt-value">Lines Added: <span class="text-positive">+' + row.linesAdded.toLocaleString() + '</span></div>' +
          '<div class="tt-value">Lines Deleted: <span class="text-negative">-' + row.linesDeleted.toLocaleString() + '</span></div>' +
          '<div class="tt-value">Net Lines: ' + row.netLines.toLocaleString() + '</div>' +
          '<div class="tt-value">Total Churn: ' + row.totalChurn.toLocaleString() + '</div>' +
          '<div class="tt-value">Commits: ' + row.commitCount + '</div>' +
          '<div class="tt-value">Last Commit: ' + escapeHtml(row.lastCommit) + '</div>' +
          '<div class="tt-action">[Click to see commits]</div>';
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
      // Legend
      // ======================================================================
      function renderLegend(authors) {
        legendContainer.innerHTML = '';
        authors.forEach(function(author) {
          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = getAuthorColor(author);
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.textContent = author;
          item.appendChild(label);

          legendContainer.appendChild(item);
        });
      }

      // ======================================================================
      // Data Table
      // ======================================================================
      function renderDataTable(data) {
        var tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';

        // Sort data
        var sorted = data.slice().sort(function(a, b) {
          var aVal = a[sortColumn];
          var bVal = b[sortColumn];
          if (typeof aVal === 'string') {
            return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
          }
          return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });

        sorted.forEach(function(row) {
          var tr = document.createElement('tr');

          var tdFile = document.createElement('td');
          var fileLink = document.createElement('a');
          fileLink.href = '#';
          fileLink.textContent = truncatePath(row.filename, 40);
          fileLink.title = row.filename;
          fileLink.onclick = function(e) { e.preventDefault(); openFile(row.filename); };
          tdFile.appendChild(fileLink);
          tr.appendChild(tdFile);

          var tdAuthor = document.createElement('td');
          tdAuthor.textContent = row.authorName;
          tr.appendChild(tdAuthor);

          var tdTeam = document.createElement('td');
          tdTeam.textContent = row.team || '-';
          tr.appendChild(tdTeam);

          var tdAdded = document.createElement('td');
          tdAdded.textContent = '+' + row.linesAdded.toLocaleString();
          tdAdded.className = 'text-positive';
          tr.appendChild(tdAdded);

          var tdDeleted = document.createElement('td');
          tdDeleted.textContent = '-' + row.linesDeleted.toLocaleString();
          tdDeleted.className = 'text-negative';
          tr.appendChild(tdDeleted);

          var tdNet = document.createElement('td');
          tdNet.textContent = row.netLines.toLocaleString();
          tr.appendChild(tdNet);

          var tdChurn = document.createElement('td');
          tdChurn.textContent = row.totalChurn.toLocaleString();
          tr.appendChild(tdChurn);

          var tdCommits = document.createElement('td');
          tdCommits.textContent = row.commitCount;
          tr.appendChild(tdCommits);

          var tdLast = document.createElement('td');
          tdLast.textContent = row.lastCommit;
          tr.appendChild(tdLast);

          tr.onclick = function() { requestDrillDown(row); };
          tr.style.cursor = 'pointer';

          tbody.appendChild(tr);
        });
      }

      function updateSortIndicators() {
        document.querySelectorAll('#dataTable th[data-sort]').forEach(function(th) {
          var indicator = th.querySelector('.sort-indicator');
          if (th.getAttribute('data-sort') === sortColumn) {
            indicator.textContent = sortDirection === 'asc' ? ' \\u25B2' : ' \\u25BC';
          } else {
            indicator.textContent = '';
          }
        });
      }

      // ======================================================================
      // Summary
      // ======================================================================
      function updateResultsSummary(message) {
        var totalFiles = message.files.length;
        var totalAuthors = message.authors.length;
        var totalChurn = message.rows.reduce(function(sum, r) { return sum + r.totalChurn; }, 0);

        resultsSummary.innerHTML =
          '<span>' + totalFiles + ' file' + (totalFiles === 1 ? '' : 's') + '</span>' +
          '<span class="separator">|</span>' +
          '<span>' + totalAuthors + ' author' + (totalAuthors === 1 ? '' : 's') + '</span>' +
          '<span class="separator">|</span>' +
          '<span>' + totalChurn.toLocaleString() + ' total churn</span>' +
          '<span class="separator">|</span>' +
          '<span>' + message.dateRange.startDate + ' to ' + message.dateRange.endDate + '</span>' +
          '<span class="separator">|</span>' +
          '<a href="#" id="newAnalysisLink">New Analysis</a>';

        document.getElementById('newAnalysisLink').onclick = function(e) {
          e.preventDefault();
          resultsSection.style.display = 'none';
          inputSection.style.display = 'block';
        };
      }

      // ======================================================================
      // Actions
      // ======================================================================
      function requestDrillDown(row) {
        vscode.postMessage({
          type: 'requestFileAuthorDrillDown',
          filename: row.filename,
          author: row.author,
          startDate: currentFilters.startDate,
          endDate: currentFilters.endDate
        });
      }

      function openFile(filePath) {
        vscode.postMessage({
          type: 'openFile',
          filePath: filePath,
          repository: currentFilters.repository
        });
      }

      // ======================================================================
      // State Management
      // ======================================================================
      function showLoading() {
        loadingState.style.display = 'flex';
        errorState.style.display = 'none';
        emptyState.style.display = 'none';
      }

      function hideLoading() {
        loadingState.style.display = 'none';
      }

      function showError(msg) {
        hideLoading();
        errorState.innerHTML = '<div class="error-banner" role="alert"><span>&#9888;</span> ' + escapeHtml(msg) + '</div>';
        errorState.style.display = 'block';
      }

      function hideError() {
        errorState.style.display = 'none';
        errorState.innerHTML = '';
      }

      function showEmpty(title, desc) {
        hideLoading();
        emptyState.innerHTML = '<div class="empty-state"><h2>' + escapeHtml(title) +
          '</h2><p>' + escapeHtml(desc) + '</p>' +
          '<button class="action-btn" onclick="document.getElementById(\\'inputSection\\').style.display=\\'block\\';document.getElementById(\\'emptyState\\').style.display=\\'none\\';">Try Again</button></div>';
        emptyState.style.display = 'block';
      }

      function hideEmpty() {
        emptyState.style.display = 'none';
        emptyState.innerHTML = '';
      }

      // ======================================================================
      // Utilities
      // ======================================================================
      function truncatePath(path, maxLen) {
        if (!path || path.length <= maxLen) { return path || ''; }
        var parts = path.split('/');
        if (parts.length > 2) {
          var first = parts[0];
          var last = parts[parts.length - 1];
          var truncated = first + '/.../' + last;
          if (truncated.length <= maxLen) { return truncated; }
        }
        return '...' + path.slice(-maxLen + 3);
      }

      function truncateMessage(msg, maxLen) {
        if (!msg || msg.length <= maxLen) { return msg || ''; }
        return msg.slice(0, maxLen - 3) + '...';
      }

      function showToast(message, type) {
        var container = document.getElementById('toastContainer');
        if (!container) {
          container = document.createElement('div');
          container.id = 'toastContainer';
          container.className = 'toast-container';
          document.body.appendChild(container);
        }
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(function() { toast.classList.add('toast-visible'); }, 10);
        setTimeout(function() {
          toast.classList.remove('toast-visible');
          setTimeout(function() { toast.remove(); }, 300);
        }, 4000);
      }

      // ======================================================================
      // Chart Explanation Collapse State Persistence
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
      // Request repositories for dropdown
      vscode.postMessage({ type: 'requestRepositories' });

    })();
  </script>
</body>
</html>`;
}
