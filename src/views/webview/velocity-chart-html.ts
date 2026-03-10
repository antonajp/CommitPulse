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
 * Ticket: IQS-888
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

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
 * Generate the full HTML document for the Sprint Velocity vs LOC chart webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateVelocityChartHtml(config: VelocityChartHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
          <p>This dual-axis chart compares sprint velocity (story points and issues completed) against lines of code changed over time. Use it to understand if velocity metrics align with actual code output and identify periods where story point estimates may be miscalibrated.</p>
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
              <th scope="col">Week</th>
              <th scope="col">Story Points</th>
              <th scope="col">Issues</th>
              <th scope="col">LOC Changed</th>
              <th scope="col">Commits</th>
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

      // Series Configuration (colorblind-accessible: distinct color + marker)
      var SERIES_CONFIG = {
        storyPoints: {
          color: '#4dc9f6',
          label: 'Story Points',
          marker: 'circle',
          markerSize: 5,
        },
        locChanged: {
          color: '#f67019',
          label: 'LOC Changed',
          marker: 'triangle',
          markerSize: 6,
        },
      };

      // DOM References
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFiltersBtn = document.getElementById('applyFiltersBtn');
      var repoFilter = document.getElementById('repoFilter');
      var repoFilterGroup = document.getElementById('repoFilterGroup');
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

      // Filter state (IQS-920)
      var currentRepository = '';
      var availableRepositories = [];

      // Event Handlers
      exportCsvBtn.addEventListener('click', function() {
        if (!chartData || !chartData.aggregated || chartData.aggregated.length === 0) { return; }
        var headers = ['Week', 'Story Points', 'Issue Count', 'LOC Changed', 'Lines Added', 'Lines Deleted', 'Commit Count'];
        if (currentRepository) {
          headers.push('Repository');
        }
        var rows = chartData.aggregated.map(function(d) {
          var row = [d.weekStart, d.totalStoryPoints, d.issueCount, d.totalLocChanged, d.totalLinesAdded, d.totalLinesDeleted, d.commitCount];
          if (currentRepository) {
            row.push(currentRepository);
          }
          return row;
        });
        // Include repository context in filename when filtered (IQS-920)
        var filename = currentRepository
          ? 'sprint-velocity-vs-loc-' + currentRepository.replace(/[^a-zA-Z0-9._-]/g, '_') + '.csv'
          : 'sprint-velocity-vs-loc.csv';
        exportCsvFromData(headers, rows, filename);
      });

      // Apply filters button handler (IQS-920)
      applyFiltersBtn.addEventListener('click', function() {
        currentRepository = repoFilter.value;
        saveFilterState();
        updateChartTitle();
        requestData();
      });

      // Allow Enter key on filter dropdown (IQS-920)
      repoFilter.addEventListener('keydown', function(event) {
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

      function handleVelocityData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Velocity View Not Available',
            'The vw_sprint_velocity_vs_loc database view has not been created yet. Run the database migration to enable this chart.'
          );
          return;
        }

        if (!message.rows || message.rows.length === 0) {
          // Different empty state message when repository filter is active (IQS-920)
          if (currentRepository) {
            showEmpty(
              'No Data for Selected Repository',
              'No sprint velocity data found for repository "' + escapeHtml(currentRepository) + '". Try selecting a different repository or "All Repositories".'
            );
          } else {
            showEmpty(
              'No Velocity Data Available',
              'No sprint velocity data found. Ensure the pipeline has been run with commitLinearLinking enabled and that "Gitr: Backfill Story Points" has been executed.'
            );
          }
          return;
        }

        // Populate repository filter dropdown on first load (IQS-920)
        // Only populate from unfiltered data to get all available repos
        if (!currentRepository) {
          populateRepositoryFilter(message.rows);
        }

        // Aggregate rows by week (sum across teams/projects/repos)
        var weekMap = {};
        message.rows.forEach(function(r) {
          if (!weekMap[r.weekStart]) {
            weekMap[r.weekStart] = {
              weekStart: r.weekStart,
              totalStoryPoints: 0,
              issueCount: 0,
              totalLocChanged: 0,
              totalLinesAdded: 0,
              totalLinesDeleted: 0,
              commitCount: 0,
            };
          }
          weekMap[r.weekStart].totalStoryPoints += r.totalStoryPoints;
          weekMap[r.weekStart].issueCount += r.issueCount;
          weekMap[r.weekStart].totalLocChanged += r.totalLocChanged;
          weekMap[r.weekStart].totalLinesAdded += r.totalLinesAdded;
          weekMap[r.weekStart].totalLinesDeleted += r.totalLinesDeleted;
          weekMap[r.weekStart].commitCount += r.commitCount;
        });

        var aggregated = Object.values(weekMap);
        aggregated.sort(function(a, b) { return a.weekStart < b.weekStart ? -1 : 1; });

        chartData = { raw: message.rows, aggregated: aggregated };
        renderChart(aggregated);
        renderSummaryStats(aggregated);
        renderDataTable(aggregated);
        chartArea.style.display = 'block';
        dataTableContainer.style.display = 'block';
      }

      // Dual-Axis Line Chart Rendering with D3.js
      function renderChart(data) {
        if (!data || data.length === 0) { return; }

        // Render legend first
        renderLegend();

        // Chart dimensions
        var margin = { top: 30, right: 70, bottom: 50, left: 60 };
        var containerWidth = Math.max(500, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var height = 360;

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Dual-axis line chart: Story Points (left) vs LOC Changed (right) by week');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        // X Scale: week dates
        var weeks = data.map(function(d) { return d.weekStart; });
        var x = d3.scalePoint().domain(weeks).range([0, innerWidth]).padding(0.5);

        // Left Y Scale: Story Points
        var maxSP = d3.max(data, function(d) { return d.totalStoryPoints; }) || 1;
        var yLeft = d3.scaleLinear().domain([0, maxSP]).nice().range([innerHeight, 0]);

        // Right Y Scale: LOC Changed
        var maxLOC = d3.max(data, function(d) { return d.totalLocChanged; }) || 1;
        var yRight = d3.scaleLinear().domain([0, maxLOC]).nice().range([innerHeight, 0]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(yLeft).tickSize(-innerWidth).tickFormat(''))
          .selectAll('line').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // X Axis
        var tickValues = weeks;
        if (weeks.length > 15) {
          var step = Math.ceil(weeks.length / 15);
          tickValues = weeks.filter(function(_, i) { return i % step === 0; });
        }
        g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(x).tickValues(tickValues))
          .selectAll('text')
          .attr('transform', 'rotate(-35)')
          .attr('text-anchor', 'end')
          .attr('font-size', '10px');

        // Left Y Axis (Story Points) - colored to match series
        var leftAxis = g.append('g').attr('class', 'axis')
          .call(d3.axisLeft(yLeft).ticks(6));
        leftAxis.selectAll('text').attr('fill', SERIES_CONFIG.storyPoints.color);
        leftAxis.selectAll('line').attr('stroke', SERIES_CONFIG.storyPoints.color + '44');
        leftAxis.select('.domain').attr('stroke', SERIES_CONFIG.storyPoints.color + '66');

        // Left Y Axis Label
        g.append('text').attr('transform', 'rotate(-90)')
          .attr('y', -45).attr('x', -innerHeight / 2).attr('text-anchor', 'middle')
          .attr('fill', SERIES_CONFIG.storyPoints.color).attr('font-size', '11px')
          .text('Story Points');

        // Right Y Axis (LOC) - colored to match series
        var rightAxis = g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(' + innerWidth + ',0)')
          .call(d3.axisRight(yRight).ticks(6).tickFormat(function(d) {
            if (d >= 1000000) { return (d / 1000000).toFixed(1) + 'M'; }
            if (d >= 1000) { return (d / 1000).toFixed(0) + 'K'; }
            return d;
          }));
        rightAxis.selectAll('text').attr('fill', SERIES_CONFIG.locChanged.color);
        rightAxis.selectAll('line').attr('stroke', SERIES_CONFIG.locChanged.color + '44');
        rightAxis.select('.domain').attr('stroke', SERIES_CONFIG.locChanged.color + '66');

        // Right Y Axis Label
        g.append('text').attr('transform', 'rotate(90)')
          .attr('y', -(innerWidth + 55)).attr('x', innerHeight / 2).attr('text-anchor', 'middle')
          .attr('fill', SERIES_CONFIG.locChanged.color).attr('font-size', '11px')
          .text('LOC Changed');

        // ---- Story Points Line (Left Y) ----
        var spLine = d3.line()
          .x(function(d) { return x(d.weekStart); })
          .y(function(d) { return yLeft(d.totalStoryPoints); })
          .curve(d3.curveMonotoneX);

        g.append('path').datum(data)
          .attr('fill', 'none')
          .attr('stroke', SERIES_CONFIG.storyPoints.color)
          .attr('stroke-width', 2.5)
          .attr('d', spLine);

        // Circle markers for story points
        data.forEach(function(d) {
          g.append('circle')
            .attr('cx', x(d.weekStart))
            .attr('cy', yLeft(d.totalStoryPoints))
            .attr('r', SERIES_CONFIG.storyPoints.markerSize)
            .attr('fill', SERIES_CONFIG.storyPoints.color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1.5)
            .attr('aria-label', 'Week ' + escapeHtml(d.weekStart) + ': ' + d.totalStoryPoints + ' story points')
            .on('mouseover', function(event) {
              showTooltip(event, d);
            })
            .on('mousemove', function(event) { moveTooltip(event); })
            .on('mouseout', hideTooltip);
        });

        // ---- LOC Line (Right Y) ----
        var locLine = d3.line()
          .x(function(d) { return x(d.weekStart); })
          .y(function(d) { return yRight(d.totalLocChanged); })
          .curve(d3.curveMonotoneX);

        g.append('path').datum(data)
          .attr('fill', 'none')
          .attr('stroke', SERIES_CONFIG.locChanged.color)
          .attr('stroke-width', 2.5)
          .attr('d', locLine);

        // Triangle markers for LOC
        var triangleSymbol = d3.symbol().type(d3.symbolTriangle).size(60);
        data.forEach(function(d) {
          g.append('path')
            .attr('d', triangleSymbol())
            .attr('transform', 'translate(' + x(d.weekStart) + ',' + yRight(d.totalLocChanged) + ')')
            .attr('fill', SERIES_CONFIG.locChanged.color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1.5)
            .attr('aria-label', 'Week ' + escapeHtml(d.weekStart) + ': ' + d.totalLocChanged.toLocaleString() + ' LOC changed')
            .on('mouseover', function(event) {
              showTooltip(event, d);
            })
            .on('mousemove', function(event) { moveTooltip(event); })
            .on('mouseout', hideTooltip);
        });

        // Announce update to screen readers
        var liveRegion = document.getElementById('summaryStats');
        if (liveRegion) {
          liveRegion.setAttribute('aria-live', 'polite');
        }
      }

      // Tooltip
      function showTooltip(event, d) {
        tooltip.innerHTML =
          '<div class="tt-component"><strong>Week of ' + escapeHtml(d.weekStart) + '</strong></div>' +
          '<div class="tt-value" style="color:' + SERIES_CONFIG.storyPoints.color + '">' +
            escapeHtml(String(d.totalStoryPoints)) + ' story points (' + escapeHtml(String(d.issueCount)) + ' issues)</div>' +
          '<div class="tt-value" style="color:' + SERIES_CONFIG.locChanged.color + '">' +
            escapeHtml(d.totalLocChanged.toLocaleString()) + ' LOC changed (' + escapeHtml(String(d.commitCount)) + ' commits)</div>' +
          '<div class="tt-team">+' + escapeHtml(d.totalLinesAdded.toLocaleString()) + ' / -' +
            escapeHtml(d.totalLinesDeleted.toLocaleString()) + ' lines</div>';
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

        // Story Points legend entry with circle marker
        var spItem = document.createElement('div');
        spItem.className = 'legend-item';
        var spSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        spSvg.setAttribute('width', '30');
        spSvg.setAttribute('height', '14');
        var spLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        spLine.setAttribute('x1', '0');
        spLine.setAttribute('y1', '7');
        spLine.setAttribute('x2', '20');
        spLine.setAttribute('y2', '7');
        spLine.setAttribute('stroke', SERIES_CONFIG.storyPoints.color);
        spLine.setAttribute('stroke-width', '2');
        spSvg.appendChild(spLine);
        var spCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        spCircle.setAttribute('cx', '10');
        spCircle.setAttribute('cy', '7');
        spCircle.setAttribute('r', '4');
        spCircle.setAttribute('fill', SERIES_CONFIG.storyPoints.color);
        spSvg.appendChild(spCircle);
        spItem.appendChild(spSvg);
        var spLabel = document.createElement('span');
        spLabel.textContent = SERIES_CONFIG.storyPoints.label;
        spItem.appendChild(spLabel);
        legendContainer.appendChild(spItem);

        // LOC legend entry with triangle marker
        var locItem = document.createElement('div');
        locItem.className = 'legend-item';
        var locSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        locSvg.setAttribute('width', '30');
        locSvg.setAttribute('height', '14');
        var locLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        locLine.setAttribute('x1', '0');
        locLine.setAttribute('y1', '7');
        locLine.setAttribute('x2', '20');
        locLine.setAttribute('y2', '7');
        locLine.setAttribute('stroke', SERIES_CONFIG.locChanged.color);
        locLine.setAttribute('stroke-width', '2');
        locSvg.appendChild(locLine);
        var locTriangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        locTriangle.setAttribute('points', '10,2 14,12 6,12');
        locTriangle.setAttribute('fill', SERIES_CONFIG.locChanged.color);
        locSvg.appendChild(locTriangle);
        locItem.appendChild(locSvg);
        var locLabel = document.createElement('span');
        locLabel.textContent = SERIES_CONFIG.locChanged.label;
        locItem.appendChild(locLabel);
        legendContainer.appendChild(locItem);
      }

      // Summary Stats
      function renderSummaryStats(data) {
        var totalSP = 0;
        var totalLOC = 0;
        var totalIssues = 0;
        var totalCommits = 0;

        data.forEach(function(d) {
          totalSP += d.totalStoryPoints;
          totalLOC += d.totalLocChanged;
          totalIssues += d.issueCount;
          totalCommits += d.commitCount;
        });

        summaryStats.innerHTML =
          createStatCard(data.length, 'Weeks') +
          createStatCard(totalSP.toLocaleString(), 'Story Points') +
          createStatCard(totalLOC.toLocaleString(), 'LOC Changed') +
          createStatCard(totalIssues.toLocaleString(), 'Issues') +
          createStatCard(totalCommits.toLocaleString(), 'Commits');
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
          var tdWeek = document.createElement('td');
          tdWeek.textContent = d.weekStart;
          tr.appendChild(tdWeek);
          var tdSP = document.createElement('td');
          tdSP.textContent = String(d.totalStoryPoints);
          tr.appendChild(tdSP);
          var tdIssues = document.createElement('td');
          tdIssues.textContent = String(d.issueCount);
          tr.appendChild(tdIssues);
          var tdLOC = document.createElement('td');
          tdLOC.textContent = d.totalLocChanged.toLocaleString();
          tr.appendChild(tdLOC);
          var tdCommits = document.createElement('td');
          tdCommits.textContent = String(d.commitCount);
          tr.appendChild(tdCommits);
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

      // Data Request (IQS-920: include repository filter)
      function requestData() {
        showLoading();
        var message = { type: 'requestVelocityData' };
        if (currentRepository) {
          message.repository = currentRepository;
        }
        vscode.postMessage(message);
      }

      // Populate repository filter dropdown from raw data (IQS-920)
      function populateRepositoryFilter(rawData) {
        var repoSet = {};
        rawData.forEach(function(r) {
          if (r.repository) {
            repoSet[r.repository] = true;
          }
        });

        availableRepositories = Object.keys(repoSet).sort(function(a, b) {
          return a.toLowerCase().localeCompare(b.toLowerCase());
        });

        // Clear existing options except "All Repositories"
        while (repoFilter.options.length > 1) {
          repoFilter.remove(1);
        }

        // Add repository options with HTML escaping
        availableRepositories.forEach(function(repo) {
          var option = document.createElement('option');
          option.value = repo;
          option.textContent = repo; // textContent auto-escapes
          repoFilter.appendChild(option);
        });

        // Restore selected value from state
        if (currentRepository && availableRepositories.indexOf(currentRepository) >= 0) {
          repoFilter.value = currentRepository;
        } else {
          currentRepository = '';
          repoFilter.value = '';
        }

        // Hide filter group if only 1 repository (progressive disclosure)
        if (availableRepositories.length <= 1) {
          repoFilterGroup.style.display = 'none';
        } else {
          repoFilterGroup.style.display = 'flex';
        }
      }

      // Update chart title when filtered (IQS-920)
      function updateChartTitle() {
        if (currentRepository) {
          chartTitle.innerHTML = 'Sprint Velocity vs LOC <span class="filter-badge">[' + escapeHtml(currentRepository) + ']</span>';
        } else {
          chartTitle.textContent = 'Sprint Velocity vs LOC';
        }
      }

      // Save filter state to VS Code (IQS-920)
      function saveFilterState() {
        vscode.setState({ repository: currentRepository });
      }

      // Restore filter state from VS Code (IQS-920)
      function restoreFilterState() {
        var state = vscode.getState();
        if (state && state.repository) {
          currentRepository = state.repository;
        }
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
      restoreFilterState();
      updateChartTitle();
      requestData();

    })();
  </script>
</body>
</html>`;
}
