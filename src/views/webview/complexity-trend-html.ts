/**
 * HTML content generator for the Complexity Trend chart webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Multi-line chart with contributor/team/repo series
 * - Filters for time period, date range, team, contributor, repository
 * - Tooltips, legend, CSV export, data table fallback
 * - ARIA accessibility and colorblind-accessible markers
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: GITX-133
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the complexity trend chart HTML.
 */
export interface ComplexityTrendHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the complexity trend chart CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Complexity Trend chart webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateComplexityTrendHtml(config: ComplexityTrendHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--
    Content Security Policy - Strict webview security (GITX-133)
    - connect-src 'none': Webview uses postMessage API only, no direct network access
    - script-src with nonce: Only extension-controlled scripts can execute
  -->
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Complexity Trend</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1 id="chartTitle">Complexity Trend Over Time</h1>
      <div class="controls">
        <div class="filter-group" id="periodFilterGroup">
          <label for="periodFilter">Period</label>
          <select id="periodFilter" aria-label="Time period granularity" tabindex="0">
            <option value="daily">Daily</option>
            <option value="weekly" selected>Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div class="filter-group" id="startDateFilterGroup">
          <label for="startDateFilter">From</label>
          <input type="date" id="startDateFilter" aria-label="Start date filter" tabindex="0">
        </div>
        <div class="filter-group" id="endDateFilterGroup">
          <label for="endDateFilter">To</label>
          <input type="date" id="endDateFilter" aria-label="End date filter" tabindex="0">
        </div>
        <div class="filter-group" id="teamFilterGroup">
          <label for="teamFilter">Team</label>
          <select id="teamFilter" aria-label="Team filter" tabindex="0">
            <option value="">All Teams</option>
          </select>
        </div>
        <div class="filter-group" id="contributorFilterGroup">
          <label for="contributorFilter">Contributor</label>
          <select id="contributorFilter" aria-label="Contributor filter" tabindex="0">
            <option value="">All Contributors</option>
          </select>
        </div>
        <div class="filter-group" id="repoFilterGroup">
          <label for="repoFilter">Repository</label>
          <select id="repoFilter" aria-label="Repository filter" tabindex="0">
            <option value="">All Repositories</option>
          </select>
        </div>
        <button class="apply-btn" id="applyFiltersBtn" aria-label="Apply selected filters" tabindex="0">Apply</button>
        <button class="clear-btn" id="clearFiltersBtn" aria-label="Clear all filters" tabindex="0">Clear</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading complexity trend data...</span>
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
          <p>This line chart shows <strong>code complexity trends over time</strong>, grouped by contributor. The Y-axis displays the average cyclomatic complexity, and the X-axis shows the time period (day/week/month). Use this chart to identify when complexity is increasing and which team members or repositories are contributing to technical debt. High complexity often correlates with maintenance difficulty and bug rates.</p>
        </div>
      </details>
      <div id="legendContainer" class="chart-legend complexity-legend" role="img" aria-label="Contributor legend"></div>
      <div class="chart-svg-container" role="img" aria-label="Line chart showing complexity trends over time">
        <svg id="chartSvg"></svg>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div class="data-table-container" id="dataTableContainer" style="display:none;">
      <button class="data-table-toggle" id="toggleTableBtn" aria-expanded="false" tabindex="0">
        Show data table
      </button>
      <div id="dataTableWrapper" style="display:none;" role="region" aria-label="Complexity trend data table">
        <table class="data-table" id="dataTable">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Contributor</th>
              <th scope="col">Avg Complexity</th>
              <th scope="col">Complexity Delta</th>
              <th scope="col">Commits</th>
              <th scope="col">Files</th>
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
      // HTML Escape utilities (security: prevent XSS in SVG/DOM)
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

      // Escape for HTML attribute values (extra defense-in-depth)
      function escapeHtmlAttribute(str) {
        if (str === null || str === undefined) { return ''; }
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;')
          .replace(/[/]/g, '&#x2F;');
      }

      // ======================================================================
      // CSV Export
      // ======================================================================
      ${generateCsvExportScript()}

      // ======================================================================
      // Okabe-Ito Colorblind-Safe Palette
      // ======================================================================
      var COLORS = [
        '#E69F00', // Orange
        '#56B4E9', // Sky Blue
        '#009E73', // Bluish Green
        '#F0E442', // Yellow
        '#0072B2', // Blue
        '#D55E00', // Vermillion
        '#CC79A7', // Reddish Purple
        '#999999'  // Gray
      ];

      function getContributorColor(index) {
        return COLORS[index % COLORS.length];
      }

      // ======================================================================
      // State
      // ======================================================================
      var chartData = null;
      var allContributors = [];
      var filterOptions = { teams: [], contributors: [], repositories: [] };

      // Filter state
      var currentFilters = {
        period: 'weekly',
        startDate: '',
        endDate: '',
        team: '',
        contributor: '',
        repository: ''
      };

      // DOM References
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFiltersBtn = document.getElementById('applyFiltersBtn');
      var clearFiltersBtn = document.getElementById('clearFiltersBtn');
      var periodFilter = document.getElementById('periodFilter');
      var startDateFilter = document.getElementById('startDateFilter');
      var endDateFilter = document.getElementById('endDateFilter');
      var teamFilter = document.getElementById('teamFilter');
      var contributorFilter = document.getElementById('contributorFilter');
      var repoFilter = document.getElementById('repoFilter');
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

      // Set default date range (last 90 days)
      function setDefaultDateRange() {
        var today = new Date();
        var ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(today.getDate() - 90);

        endDateFilter.value = today.toISOString().split('T')[0];
        startDateFilter.value = ninetyDaysAgo.toISOString().split('T')[0];

        currentFilters.endDate = endDateFilter.value;
        currentFilters.startDate = startDateFilter.value;
      }

      // Event Handlers
      exportCsvBtn.addEventListener('click', function() {
        if (!chartData || chartData.length === 0) { return; }
        var headers = ['Date', 'Contributor', 'Avg Complexity', 'Complexity Delta', 'Max Complexity', 'Commits', 'Files'];
        var rows = chartData.map(function(d) {
          return [d.date, d.groupKey, d.avgComplexity.toFixed(2), d.complexityDelta, d.maxComplexity, d.commitCount, d.fileCount];
        });
        var filename = 'complexity-trend-' + new Date().toISOString().split('T')[0] + '.csv';
        exportCsvFromData(headers, rows, filename);
      });

      applyFiltersBtn.addEventListener('click', function() {
        collectFilters();
        saveFilterState();
        updateChartTitle();
        requestData();
      });

      clearFiltersBtn.addEventListener('click', function() {
        periodFilter.value = 'weekly';
        teamFilter.value = '';
        contributorFilter.value = '';
        repoFilter.value = '';
        setDefaultDateRange();
        currentFilters = {
          period: 'weekly',
          startDate: startDateFilter.value,
          endDate: endDateFilter.value,
          team: '',
          contributor: '',
          repository: ''
        };
        saveFilterState();
        updateChartTitle();
        requestData();
      });

      toggleTableBtn.addEventListener('click', function() {
        var isExpanded = toggleTableBtn.getAttribute('aria-expanded') === 'true';
        toggleTableBtn.setAttribute('aria-expanded', String(!isExpanded));
        toggleTableBtn.textContent = isExpanded ? 'Show data table' : 'Hide data table';
        dataTableWrapper.style.display = isExpanded ? 'none' : 'block';
      });

      // Collect current filter values
      function collectFilters() {
        currentFilters.period = periodFilter.value || 'weekly';
        currentFilters.startDate = startDateFilter.value || '';
        currentFilters.endDate = endDateFilter.value || '';
        currentFilters.team = teamFilter.value || '';
        currentFilters.contributor = contributorFilter.value || '';
        currentFilters.repository = repoFilter.value || '';
      }

      // Message Handling
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'complexityTrendData':
            handleTrendData(message);
            break;
          case 'complexityTrendFilterOptions':
            handleFilterOptions(message);
            break;
          case 'complexityTrendError':
            showError(escapeHtml(message.message));
            break;
        }
      });

      function handleFilterOptions(message) {
        filterOptions = message.options || { teams: [], contributors: [], repositories: [] };

        // Populate team dropdown
        while (teamFilter.options.length > 1) { teamFilter.remove(1); }
        filterOptions.teams.forEach(function(team) {
          var option = document.createElement('option');
          option.value = team;
          option.textContent = team;
          teamFilter.appendChild(option);
        });

        // Populate contributor dropdown
        while (contributorFilter.options.length > 1) { contributorFilter.remove(1); }
        filterOptions.contributors.forEach(function(contributor) {
          var option = document.createElement('option');
          option.value = contributor;
          option.textContent = contributor;
          contributorFilter.appendChild(option);
        });

        // Populate repository dropdown
        while (repoFilter.options.length > 1) { repoFilter.remove(1); }
        filterOptions.repositories.forEach(function(repo) {
          var option = document.createElement('option');
          option.value = repo;
          option.textContent = repo;
          repoFilter.appendChild(option);
        });

        // Restore filter selections
        if (currentFilters.team && filterOptions.teams.indexOf(currentFilters.team) >= 0) {
          teamFilter.value = currentFilters.team;
        }
        if (currentFilters.contributor && filterOptions.contributors.indexOf(currentFilters.contributor) >= 0) {
          contributorFilter.value = currentFilters.contributor;
        }
        if (currentFilters.repository && filterOptions.repositories.indexOf(currentFilters.repository) >= 0) {
          repoFilter.value = currentFilters.repository;
        }
      }

      function handleTrendData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.dataExists) {
          showEmpty(
            'No Complexity Data Available',
            'No complexity data found in the database. Run the pipeline to extract commit data with complexity metrics.'
          );
          return;
        }

        if (!message.data || message.data.length === 0) {
          var filterDesc = [];
          if (currentFilters.team) { filterDesc.push('team "' + escapeHtml(currentFilters.team) + '"'); }
          if (currentFilters.contributor) { filterDesc.push('contributor "' + escapeHtml(currentFilters.contributor) + '"'); }
          if (currentFilters.repository) { filterDesc.push('repository "' + escapeHtml(currentFilters.repository) + '"'); }

          var filterMsg = filterDesc.length > 0 ? filterDesc.join(', ') : 'the selected date range';
          showEmpty(
            'No Data for Selected Filters',
            'No complexity data found for ' + filterMsg + '. Try adjusting the filters or date range.'
          );
          return;
        }

        chartData = message.data;

        // Get unique contributors for coloring
        allContributors = [];
        var seenContributors = {};
        chartData.forEach(function(d) {
          if (!seenContributors[d.groupKey]) {
            seenContributors[d.groupKey] = true;
            allContributors.push(d.groupKey);
          }
        });
        allContributors.sort();

        renderChart(chartData);
        renderSummaryStats(chartData);
        renderLegend();
        renderDataTable(chartData);
        chartArea.style.display = 'block';
        dataTableContainer.style.display = 'block';
      }

      // Line Chart Rendering with D3.js
      function renderChart(data) {
        if (!data || data.length === 0) { return; }

        // Chart dimensions
        var margin = { top: 30, right: 100, bottom: 60, left: 70 };
        var containerWidth = Math.max(600, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var height = 400;

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Line chart showing complexity trends by contributor over time');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        // Group data by contributor
        var dataByContributor = {};
        data.forEach(function(d) {
          if (!dataByContributor[d.groupKey]) {
            dataByContributor[d.groupKey] = [];
          }
          dataByContributor[d.groupKey].push(d);
        });

        // Get unique dates for X scale
        var allDates = [];
        var seenDates = {};
        data.forEach(function(d) {
          if (!seenDates[d.date]) {
            seenDates[d.date] = true;
            allDates.push(d.date);
          }
        });
        allDates.sort();

        // X Scale: dates
        var x = d3.scalePoint().domain(allDates).range([0, innerWidth]).padding(0.5);

        // Y Scale: complexity
        var maxComplexity = d3.max(data, function(d) { return d.avgComplexity; }) || 1;
        var y = d3.scaleLinear().domain([0, maxComplexity]).nice().range([innerHeight, 0]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(y).tickSize(-innerWidth).tickFormat(''))
          .selectAll('line').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // X Axis
        var tickValues = allDates;
        if (allDates.length > 20) {
          var step = Math.ceil(allDates.length / 20);
          tickValues = allDates.filter(function(_, i) { return i % step === 0; });
        }
        g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(x).tickValues(tickValues))
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .attr('text-anchor', 'end')
          .attr('font-size', '10px');

        // Y Axis
        g.append('g').attr('class', 'axis')
          .call(d3.axisLeft(y).ticks(8));

        // Y Axis Label
        g.append('text').attr('transform', 'rotate(-90)')
          .attr('y', -55).attr('x', -innerHeight / 2).attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #cccccc)').attr('font-size', '12px')
          .text('Average Complexity');

        // Render lines for each contributor
        Object.keys(dataByContributor).forEach(function(contributor) {
          var contributorData = dataByContributor[contributor].sort(function(a, b) {
            return a.date < b.date ? -1 : 1;
          });

          var colorIndex = allContributors.indexOf(contributor);
          var color = getContributorColor(colorIndex);

          var line = d3.line()
            .x(function(d) { return x(d.date); })
            .y(function(d) { return y(d.avgComplexity); })
            .curve(d3.curveMonotoneX);

          // Line path
          g.append('path')
            .datum(contributorData)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 2)
            .attr('opacity', 0.8)
            .attr('d', line);

          // Data point markers
          contributorData.forEach(function(d) {
            g.append('circle')
              .attr('cx', x(d.date))
              .attr('cy', y(d.avgComplexity))
              .attr('r', 4)
              .attr('fill', color)
              .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
              .attr('stroke-width', 1.5)
              .attr('aria-label', escapeHtmlAttribute(contributor) + ' on ' + escapeHtmlAttribute(d.date) + ': ' + d.avgComplexity.toFixed(2))
              .on('mouseover', function(event) {
                showTooltip(event, d, color, contributor);
              })
              .on('mousemove', function(event) { moveTooltip(event); })
              .on('mouseout', hideTooltip);
          });
        });
      }

      // Tooltip
      function showTooltip(event, d, color, contributor) {
        var deltaPrefix = d.complexityDelta >= 0 ? '+' : '';
        tooltip.innerHTML =
          '<div class="tt-date"><strong>' + escapeHtml(d.date) + '</strong></div>' +
          '<div class="tt-contributor" style="color:' + color + '"><span style="color:' + color + '">&#9632;</span> ' + escapeHtml(contributor) + '</div>' +
          '<hr>' +
          '<div class="tt-row"><span>Avg Complexity:</span> <strong>' + escapeHtml(d.avgComplexity.toFixed(2)) + '</strong></div>' +
          '<div class="tt-row"><span>Complexity Delta:</span> <strong>' + deltaPrefix + escapeHtml(String(d.complexityDelta)) + '</strong></div>' +
          '<div class="tt-row"><span>Max Complexity:</span> <strong>' + escapeHtml(String(d.maxComplexity)) + '</strong></div>' +
          '<div class="tt-row"><span>Commits:</span> <strong>' + escapeHtml(String(d.commitCount)) + '</strong></div>' +
          '<div class="tt-row"><span>Files Modified:</span> <strong>' + escapeHtml(String(d.fileCount)) + '</strong></div>';
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        moveTooltip(event);
      }

      function moveTooltip(event) {
        var tooltipRect = tooltip.getBoundingClientRect();
        var x = event.pageX + 12;
        var y = event.pageY - 28;

        // Keep tooltip within viewport
        if (x + tooltipRect.width > window.innerWidth - 20) {
          x = event.pageX - tooltipRect.width - 12;
        }
        if (y < 10) {
          y = event.pageY + 20;
        }

        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
      }

      function hideTooltip() {
        tooltip.classList.remove('visible');
        tooltip.setAttribute('aria-hidden', 'true');
      }

      // Legend
      function renderLegend() {
        legendContainer.innerHTML = '';

        allContributors.forEach(function(contributor, index) {
          var color = getContributorColor(index);

          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = color;
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.className = 'legend-label';
          label.textContent = contributor;
          item.appendChild(label);

          legendContainer.appendChild(item);
        });
      }

      // Summary Stats
      function renderSummaryStats(data) {
        var totalCommits = 0;
        var totalFiles = 0;
        var totalDelta = 0;
        var avgComplexitySum = 0;

        data.forEach(function(d) {
          totalCommits += d.commitCount;
          totalFiles += d.fileCount;
          totalDelta += d.complexityDelta;
          avgComplexitySum += d.avgComplexity;
        });

        var overallAvg = data.length > 0 ? (avgComplexitySum / data.length).toFixed(2) : 0;
        var deltaPrefix = totalDelta >= 0 ? '+' : '';

        summaryStats.innerHTML =
          createStatCard(data.length.toLocaleString(), 'Data Points') +
          createStatCard(overallAvg, 'Avg Complexity') +
          createStatCard(deltaPrefix + totalDelta.toLocaleString(), 'Net Delta') +
          createStatCard(totalCommits.toLocaleString(), 'Total Commits') +
          createStatCard(allContributors.length.toLocaleString(), 'Contributors');
      }

      function createStatCard(value, label) {
        return '<div class="stat-card"><div class="stat-value">' +
          escapeHtml(String(value)) + '</div><div class="stat-label">' +
          escapeHtml(label) + '</div></div>';
      }

      // Data Table (Accessibility Fallback)
      function renderDataTable(data) {
        var tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';
        data.forEach(function(d) {
          var tr = document.createElement('tr');

          var tdDate = document.createElement('td');
          tdDate.textContent = d.date;
          tr.appendChild(tdDate);

          var tdContributor = document.createElement('td');
          tdContributor.textContent = d.groupKey;
          tr.appendChild(tdContributor);

          var tdAvgComplexity = document.createElement('td');
          tdAvgComplexity.textContent = d.avgComplexity.toFixed(2);
          tr.appendChild(tdAvgComplexity);

          var tdDelta = document.createElement('td');
          tdDelta.textContent = String(d.complexityDelta);
          tr.appendChild(tdDelta);

          var tdCommits = document.createElement('td');
          tdCommits.textContent = String(d.commitCount);
          tr.appendChild(tdCommits);

          var tdFiles = document.createElement('td');
          tdFiles.textContent = String(d.fileCount);
          tr.appendChild(tdFiles);

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
        errorState.innerHTML = '<div class="error-banner" role="alert"><span>&#9888;</span> ' + msg + '<button class="retry-btn" onclick="requestData()">Retry</button></div>';
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
        var filters = {
          period: currentFilters.period,
          startDate: currentFilters.startDate || undefined,
          endDate: currentFilters.endDate || undefined,
          team: currentFilters.team || undefined,
          contributor: currentFilters.contributor || undefined,
          repository: currentFilters.repository || undefined
        };
        vscode.postMessage({ type: 'requestComplexityTrendData', filters: filters });
      }
      // Expose for retry button
      window.requestData = requestData;

      // Request filter options
      function requestFilterOptions() {
        vscode.postMessage({ type: 'requestComplexityTrendFilterOptions' });
      }

      // Update chart title
      function updateChartTitle() {
        var badges = [];
        if (currentFilters.team) { badges.push(escapeHtml(currentFilters.team)); }
        if (currentFilters.contributor) { badges.push(escapeHtml(currentFilters.contributor)); }
        if (currentFilters.repository) { badges.push(escapeHtml(currentFilters.repository)); }

        if (badges.length > 0) {
          chartTitle.innerHTML = 'Complexity Trend Over Time <span class="filter-badge">[' + badges.join(', ') + ']</span>';
        } else {
          chartTitle.textContent = 'Complexity Trend Over Time';
        }
      }

      // Save filter state to VS Code
      function saveFilterState() {
        vscode.setState({
          filters: currentFilters
        });
      }

      // Restore filter state from VS Code
      function restoreFilterState() {
        var state = vscode.getState();
        if (state && state.filters) {
          currentFilters = state.filters;
          periodFilter.value = currentFilters.period || 'weekly';
          startDateFilter.value = currentFilters.startDate || '';
          endDateFilter.value = currentFilters.endDate || '';
          // Team, contributor, repo are restored after filter options are loaded
        }
      }

      // Chart Explanation Collapse State Persistence
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
      restoreFilterState();
      if (!currentFilters.startDate || !currentFilters.endDate) {
        setDefaultDateRange();
      }
      updateChartTitle();
      requestFilterOptions();
      requestData();

    })();
  </script>
</body>
</html>`;
}
