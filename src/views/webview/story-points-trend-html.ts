/**
 * HTML content generator for the Story Points Trend chart webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Dual-line chart with Development vs QA series
 * - Tooltips, legend, CSV export, data table fallback
 * - ARIA accessibility and colorblind-accessible markers
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-940
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the story points trend chart HTML.
 */
export interface StoryPointsTrendHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the story points trend chart CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Story Points Trend chart webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateStoryPointsTrendHtml(config: StoryPointsTrendHtmlConfig): string {
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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--
    Content Security Policy - Strict webview security (IQS-947)
    - connect-src 'none': Webview uses postMessage API only, no direct network access
    - script-src with nonce: Only extension-controlled scripts can execute
    See CSP documentation comments in story-points-trend-html.ts for full security model explanation.
  -->
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Story Points Trend: Development vs QA</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1 id="chartTitle">Story Points Trend: Development vs QA</h1>
      <div class="controls">
        <div class="filter-group" id="teamFilterGroup">
          <label for="teamFilter">Team</label>
          <select id="teamFilter" aria-label="Team filter" tabindex="0">
            <option value="">All Teams</option>
          </select>
        </div>
        <div class="filter-group" id="periodFilterGroup">
          <label for="periodFilter">Period</label>
          <select id="periodFilter" aria-label="Time period filter" tabindex="0">
            <option value="7">Last 7 days</option>
            <option value="30" selected>Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading story points data...</span>
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
          <p>This dual-line chart shows the daily distribution of story points across Development and QA statuses. The <strong>Development line</strong> (blue) tracks tickets in "Code Review" or "In Progress" statuses. The <strong>QA line</strong> (green) tracks tickets in "In QA", "Ready for QA", or "In UAT" statuses. Use it to identify bottlenecks when one line consistently exceeds the other.</p>
        </div>
      </details>
      <div id="legendContainer" class="chart-legend story-points-legend" role="img" aria-label="Series legend"></div>
      <div class="chart-svg-container" role="img" aria-label="Dual-line chart showing Development vs QA story points over time">
        <svg id="chartSvg"></svg>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div class="data-table-container" id="dataTableContainer" style="display:none;">
      <button class="data-table-toggle" id="toggleTableBtn" aria-expanded="false" tabindex="0">
        Show data table
      </button>
      <div id="dataTableWrapper" style="display:none;" role="region" aria-label="Story points trend data table">
        <table class="data-table" id="dataTable">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Development Points</th>
              <th scope="col">Dev Tickets</th>
              <th scope="col">QA Points</th>
              <th scope="col">QA Tickets</th>
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
      var debounceTimer = null;

      // Series Configuration (Okabe-Ito colorblind-accessible colors)
      var SERIES_CONFIG = {
        development: {
          color: '#0072B2',  // Blue (Okabe-Ito)
          label: 'Development',
          marker: 'circle',
          markerSize: 5,
        },
        qa: {
          color: '#009E73',  // Green (Okabe-Ito)
          label: 'QA',
          marker: 'triangle',
          markerSize: 6,
        },
      };

      // DOM References
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var teamFilter = document.getElementById('teamFilter');
      var periodFilter = document.getElementById('periodFilter');
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

      // Filter state
      var currentTeam = '';
      var currentPeriod = 30;

      // Event Handlers
      exportCsvBtn.addEventListener('click', function() {
        if (!chartData || !chartData.aggregated || chartData.aggregated.length === 0) { return; }
        var headers = ['Date', 'Development Points', 'Development Tickets', 'QA Points', 'QA Tickets'];
        if (currentTeam) {
          headers.push('Team');
        }
        var rows = chartData.aggregated.map(function(d) {
          var row = [d.date, d.developmentPoints, d.developmentTickets, d.qaPoints, d.qaTickets];
          if (currentTeam) {
            row.push(currentTeam);
          }
          return row;
        });
        var filename = currentTeam
          ? 'story-points-trend-' + currentTeam.replace(/[^a-zA-Z0-9._-]/g, '_') + '.csv'
          : 'story-points-trend.csv';
        exportCsvFromData(headers, rows, filename);
      });

      // Auto-apply filters with 300ms debounce
      teamFilter.addEventListener('change', function() {
        currentTeam = teamFilter.value;
        saveFilterState();
        updateChartTitle();
        debounceRequestData();
      });

      periodFilter.addEventListener('change', function() {
        currentPeriod = parseInt(periodFilter.value, 10) || 30;
        saveFilterState();
        debounceRequestData();
      });

      toggleTableBtn.addEventListener('click', function() {
        var isExpanded = toggleTableBtn.getAttribute('aria-expanded') === 'true';
        toggleTableBtn.setAttribute('aria-expanded', String(!isExpanded));
        toggleTableBtn.textContent = isExpanded ? 'Show data table' : 'Hide data table';
        dataTableWrapper.style.display = isExpanded ? 'none' : 'block';
      });

      // Debounced data request
      function debounceRequestData() {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(function() {
          requestData();
        }, 300);
      }

      // Message Handling
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'storyPointsTrendData':
            handleTrendData(message);
            break;
          case 'storyPointsTrendTeams':
            handleTeamsData(message);
            break;
          case 'storyPointsTrendError':
            showError(escapeHtml(message.message));
            break;
        }
      });

      function handleTeamsData(message) {
        if (!message.teams || message.teams.length === 0) { return; }

        // Clear existing options except "All Teams"
        while (teamFilter.options.length > 1) {
          teamFilter.remove(1);
        }

        // Add team options with HTML escaping
        message.teams.forEach(function(team) {
          var option = document.createElement('option');
          option.value = team;
          option.textContent = team; // textContent auto-escapes
          teamFilter.appendChild(option);
        });

        // Restore selected value from state
        if (currentTeam && message.teams.indexOf(currentTeam) >= 0) {
          teamFilter.value = currentTeam;
        } else {
          currentTeam = '';
          teamFilter.value = '';
        }
      }

      function handleTrendData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.dataExists) {
          showEmpty(
            'Jira History Not Available',
            'No Jira status transition history found. Ensure the pipeline has been run with jiraChangelogUpdate enabled to populate the jira_history table.'
          );
          return;
        }

        if (!message.rows || message.rows.length === 0) {
          if (currentTeam) {
            showEmpty(
              'No Data for Selected Team',
              'No story points data found for team "' + escapeHtml(currentTeam) + '". Try selecting a different team or "All Teams".'
            );
          } else {
            showEmpty(
              'No Story Points Data Available',
              'No story points trend data found for the selected period. Ensure tickets have story points assigned and have transitioned through Development or QA statuses.'
            );
          }
          return;
        }

        // Aggregate rows by date (combine Development and QA)
        var dateMap = {};
        message.rows.forEach(function(r) {
          if (!dateMap[r.transitionDate]) {
            dateMap[r.transitionDate] = {
              date: r.transitionDate,
              developmentPoints: 0,
              qaPoints: 0,
              developmentTickets: 0,
              qaTickets: 0,
            };
          }
          if (r.statusCategory === 'Development') {
            dateMap[r.transitionDate].developmentPoints += r.totalStoryPoints;
            dateMap[r.transitionDate].developmentTickets += r.ticketCount;
          } else if (r.statusCategory === 'QA') {
            dateMap[r.transitionDate].qaPoints += r.totalStoryPoints;
            dateMap[r.transitionDate].qaTickets += r.ticketCount;
          }
        });

        var aggregated = Object.values(dateMap);
        aggregated.sort(function(a, b) { return a.date < b.date ? -1 : 1; });

        chartData = { raw: message.rows, aggregated: aggregated };
        renderChart(aggregated);
        renderSummaryStats(aggregated);
        renderDataTable(aggregated);
        chartArea.style.display = 'block';
        dataTableContainer.style.display = 'block';
      }

      // Dual-Line Chart Rendering with D3.js
      function renderChart(data) {
        if (!data || data.length === 0) { return; }

        // Render legend first
        renderLegend();

        // Chart dimensions
        var margin = { top: 30, right: 50, bottom: 50, left: 60 };
        var containerWidth = Math.max(500, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var height = 360;

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Dual-line chart: Development vs QA story points by day');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        // X Scale: dates
        var dates = data.map(function(d) { return d.date; });
        var x = d3.scalePoint().domain(dates).range([0, innerWidth]).padding(0.5);

        // Y Scale: shared for both series
        var maxPoints = d3.max(data, function(d) {
          return Math.max(d.developmentPoints, d.qaPoints);
        }) || 1;
        var y = d3.scaleLinear().domain([0, maxPoints]).nice().range([innerHeight, 0]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(y).tickSize(-innerWidth).tickFormat(''))
          .selectAll('line').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // X Axis
        var tickValues = dates;
        if (dates.length > 15) {
          var step = Math.ceil(dates.length / 15);
          tickValues = dates.filter(function(_, i) { return i % step === 0; });
        }
        g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(x).tickValues(tickValues))
          .selectAll('text')
          .attr('transform', 'rotate(-35)')
          .attr('text-anchor', 'end')
          .attr('font-size', '10px');

        // Y Axis
        g.append('g').attr('class', 'axis')
          .call(d3.axisLeft(y).ticks(6));

        // Y Axis Label
        g.append('text').attr('transform', 'rotate(-90)')
          .attr('y', -45).attr('x', -innerHeight / 2).attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #cccccc)').attr('font-size', '11px')
          .text('Story Points');

        // ---- Development Line ----
        var devLine = d3.line()
          .x(function(d) { return x(d.date); })
          .y(function(d) { return y(d.developmentPoints); })
          .curve(d3.curveMonotoneX);

        g.append('path').datum(data)
          .attr('fill', 'none')
          .attr('stroke', SERIES_CONFIG.development.color)
          .attr('stroke-width', 2.5)
          .attr('d', devLine);

        // Circle markers for development
        data.forEach(function(d) {
          g.append('circle')
            .attr('cx', x(d.date))
            .attr('cy', y(d.developmentPoints))
            .attr('r', SERIES_CONFIG.development.markerSize)
            .attr('fill', SERIES_CONFIG.development.color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1.5)
            .attr('aria-label', escapeHtml(d.date) + ': ' + d.developmentPoints + ' development points')
            .on('mouseover', function(event) {
              showTooltip(event, d);
            })
            .on('mousemove', function(event) { moveTooltip(event); })
            .on('mouseout', hideTooltip);
        });

        // ---- QA Line ----
        var qaLine = d3.line()
          .x(function(d) { return x(d.date); })
          .y(function(d) { return y(d.qaPoints); })
          .curve(d3.curveMonotoneX);

        g.append('path').datum(data)
          .attr('fill', 'none')
          .attr('stroke', SERIES_CONFIG.qa.color)
          .attr('stroke-width', 2.5)
          .attr('d', qaLine);

        // Triangle markers for QA
        var triangleSymbol = d3.symbol().type(d3.symbolTriangle).size(60);
        data.forEach(function(d) {
          g.append('path')
            .attr('d', triangleSymbol())
            .attr('transform', 'translate(' + x(d.date) + ',' + y(d.qaPoints) + ')')
            .attr('fill', SERIES_CONFIG.qa.color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1.5)
            .attr('aria-label', escapeHtml(d.date) + ': ' + d.qaPoints + ' QA points')
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
          '<div class="tt-component"><strong>' + escapeHtml(d.date) + '</strong></div>' +
          '<div class="tt-value" style="color:' + SERIES_CONFIG.development.color + '">' +
            escapeHtml(String(d.developmentPoints)) + ' points in Development (' + escapeHtml(String(d.developmentTickets)) + ' tickets)</div>' +
          '<div class="tt-value" style="color:' + SERIES_CONFIG.qa.color + '">' +
            escapeHtml(String(d.qaPoints)) + ' points in QA (' + escapeHtml(String(d.qaTickets)) + ' tickets)</div>';
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

        // Development legend entry with circle marker
        var devItem = document.createElement('div');
        devItem.className = 'legend-item';
        var devSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        devSvg.setAttribute('width', '30');
        devSvg.setAttribute('height', '14');
        var devLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        devLine.setAttribute('x1', '0');
        devLine.setAttribute('y1', '7');
        devLine.setAttribute('x2', '20');
        devLine.setAttribute('y2', '7');
        devLine.setAttribute('stroke', SERIES_CONFIG.development.color);
        devLine.setAttribute('stroke-width', '2');
        devSvg.appendChild(devLine);
        var devCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        devCircle.setAttribute('cx', '10');
        devCircle.setAttribute('cy', '7');
        devCircle.setAttribute('r', '4');
        devCircle.setAttribute('fill', SERIES_CONFIG.development.color);
        devSvg.appendChild(devCircle);
        devItem.appendChild(devSvg);
        var devLabel = document.createElement('span');
        devLabel.textContent = SERIES_CONFIG.development.label;
        devItem.appendChild(devLabel);
        legendContainer.appendChild(devItem);

        // QA legend entry with triangle marker
        var qaItem = document.createElement('div');
        qaItem.className = 'legend-item';
        var qaSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        qaSvg.setAttribute('width', '30');
        qaSvg.setAttribute('height', '14');
        var qaLineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        qaLineEl.setAttribute('x1', '0');
        qaLineEl.setAttribute('y1', '7');
        qaLineEl.setAttribute('x2', '20');
        qaLineEl.setAttribute('y2', '7');
        qaLineEl.setAttribute('stroke', SERIES_CONFIG.qa.color);
        qaLineEl.setAttribute('stroke-width', '2');
        qaSvg.appendChild(qaLineEl);
        var qaTriangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        qaTriangle.setAttribute('points', '10,2 14,12 6,12');
        qaTriangle.setAttribute('fill', SERIES_CONFIG.qa.color);
        qaSvg.appendChild(qaTriangle);
        qaItem.appendChild(qaSvg);
        var qaLabel = document.createElement('span');
        qaLabel.textContent = SERIES_CONFIG.qa.label;
        qaItem.appendChild(qaLabel);
        legendContainer.appendChild(qaItem);
      }

      // Summary Stats
      function renderSummaryStats(data) {
        var totalDevPoints = 0;
        var totalQaPoints = 0;
        var totalDevTickets = 0;
        var totalQaTickets = 0;

        data.forEach(function(d) {
          totalDevPoints += d.developmentPoints;
          totalQaPoints += d.qaPoints;
          totalDevTickets += d.developmentTickets;
          totalQaTickets += d.qaTickets;
        });

        // Calculate average points per day
        var avgDevPoints = data.length > 0 ? (totalDevPoints / data.length).toFixed(1) : 0;
        var avgQaPoints = data.length > 0 ? (totalQaPoints / data.length).toFixed(1) : 0;

        summaryStats.innerHTML =
          createStatCard(data.length, 'Days') +
          createStatCard(avgDevPoints, 'Avg Dev Points') +
          createStatCard(avgQaPoints, 'Avg QA Points') +
          createStatCard(totalDevTickets.toLocaleString(), 'Dev Transitions') +
          createStatCard(totalQaTickets.toLocaleString(), 'QA Transitions');
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
          var tdDevPoints = document.createElement('td');
          tdDevPoints.textContent = String(d.developmentPoints);
          tr.appendChild(tdDevPoints);
          var tdDevTickets = document.createElement('td');
          tdDevTickets.textContent = String(d.developmentTickets);
          tr.appendChild(tdDevTickets);
          var tdQaPoints = document.createElement('td');
          tdQaPoints.textContent = String(d.qaPoints);
          tr.appendChild(tdQaPoints);
          var tdQaTickets = document.createElement('td');
          tdQaTickets.textContent = String(d.qaTickets);
          tr.appendChild(tdQaTickets);
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
        var message = { type: 'requestStoryPointsTrendData', daysBack: currentPeriod };
        if (currentTeam) {
          message.team = currentTeam;
        }
        vscode.postMessage(message);
      }

      // Request teams for dropdown
      function requestTeams() {
        vscode.postMessage({ type: 'requestStoryPointsTrendTeams' });
      }

      // Update chart title when filtered
      function updateChartTitle() {
        if (currentTeam) {
          chartTitle.innerHTML = 'Story Points Trend: Development vs QA <span class="filter-badge">[' + escapeHtml(currentTeam) + ']</span>';
        } else {
          chartTitle.textContent = 'Story Points Trend: Development vs QA';
        }
      }

      // Save filter state to VS Code
      function saveFilterState() {
        vscode.setState({ team: currentTeam, period: currentPeriod });
      }

      // Restore filter state from VS Code
      function restoreFilterState() {
        var state = vscode.getState();
        if (state) {
          if (state.team) {
            currentTeam = state.team;
          }
          if (state.period) {
            currentPeriod = state.period;
            periodFilter.value = String(currentPeriod);
          }
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
      updateChartTitle();
      requestTeams();
      requestData();

    })();
  </script>
</body>
</html>`;
}
