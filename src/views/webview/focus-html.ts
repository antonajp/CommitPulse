/**
 * HTML content generator for the Developer Focus Score dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Multi-line chart with one line per developer
 * - Team average dashed line overlay
 * - Background zones for focus categories (green/yellow/orange/red)
 * - Hover shows weekly summary tooltip
 * - Click data point opens week/developer details panel
 * - Developer and team multi-select filters
 * - Declining trend alerts (3+ week downtrend)
 * - Summary panel with team health metrics
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-908
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the developer focus HTML.
 */
export interface FocusHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the focus CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Developer Focus dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateFocusHtml(config: FocusHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Developer Focus</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Developer Focus Score</h1>
      <div class="controls">
        <div class="filter-group">
          <label for="startDate">Start Date</label>
          <input type="date" id="startDate" aria-label="Start date filter" tabindex="0">
        </div>
        <div class="filter-group">
          <label for="endDate">End Date</label>
          <input type="date" id="endDate" aria-label="End date filter" tabindex="0">
        </div>
        <div class="filter-group">
          <label for="developerFilter">Developers</label>
          <select id="developerFilter" multiple aria-label="Developer filter" tabindex="0">
            <option value="">All Developers</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="focusCategoryFilter">Focus Category</label>
          <select id="focusCategoryFilter" aria-label="Focus category filter" tabindex="0">
            <option value="">All Categories</option>
            <option value="deep_focus">Deep Focus (80+)</option>
            <option value="moderate_focus">Moderate Focus (60-79)</option>
            <option value="fragmented">Fragmented (40-59)</option>
            <option value="highly_fragmented">Highly Fragmented (&lt;40)</option>
          </select>
        </div>
        <button class="action-btn" id="applyFilterBtn" aria-label="Apply filters" tabindex="0">Apply</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading developer focus data...</span>
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
          <p>This multi-line chart tracks each developer's focus score over time. Higher scores indicate concentrated work on fewer tickets, while lower scores suggest fragmented attention. Background zones classify focus levels from Deep Focus (green) to Highly Fragmented (red).</p>
        </div>
      </details>
      <div id="legendContainer" class="chart-legend focus-legend" role="img" aria-label="Focus category legend"></div>
      <div class="chart-svg-container" role="img" aria-label="Multi-line chart showing developer focus scores over time">
        <svg id="chartSvg"></svg>
      </div>
      <div class="chart-instructions">
        <p>Hover over lines to see focus details. Click a data point to drill down. Background zones indicate focus categories.</p>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div id="drillDownPanel" class="drill-down-panel" style="display:none;">
      <div class="drill-down-header">
        <h2 id="drillDownTitle">Focus Details</h2>
        <button class="close-btn" id="closeDrillDown" aria-label="Close drill-down panel" tabindex="0">&times;</button>
      </div>
      <div id="drillDownContent" class="drill-down-content"></div>
    </div>

    <div id="alertsContainer" class="alerts-container" style="display:none;">
      <h2>Declining Focus Alerts</h2>
      <p class="alerts-description">Developers with 3+ consecutive weeks of declining focus scores</p>
      <div id="alertsList" class="alerts-list"></div>
    </div>

    <div id="topDevelopersContainer" class="top-developers-container" style="display:none;">
      <h2>Team Focus Summary</h2>
      <div class="top-developers-grid">
        <div class="top-card">
          <h3>Most Focused (Top 3)</h3>
          <ul id="mostFocusedList" class="developer-list"></ul>
        </div>
        <div class="top-card attention-card">
          <h3>Needs Attention</h3>
          <p class="attention-criteria">Score &lt; 40 or declining trend</p>
          <ul id="needsAttentionList" class="developer-list"></ul>
        </div>
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
      var trendData = null;
      var focusData = null;
      var teamSummary = null;
      var selectedDevelopers = [];

      // Focus category colors (colorblind-accessible)
      var CATEGORY_COLORS = {
        deep_focus: '#22c55e',       // green-500
        moderate_focus: '#f59e0b',   // amber-500
        fragmented: '#f97316',       // orange-500
        highly_fragmented: '#ef4444', // red-500
      };

      // Focus zone boundaries
      var FOCUS_ZONES = [
        { min: 80, max: 100, category: 'deep_focus', label: 'Deep Focus', color: 'rgba(34, 197, 94, 0.15)' },
        { min: 60, max: 80, category: 'moderate_focus', label: 'Moderate Focus', color: 'rgba(245, 158, 11, 0.15)' },
        { min: 40, max: 60, category: 'fragmented', label: 'Fragmented', color: 'rgba(249, 115, 22, 0.15)' },
        { min: 0, max: 40, category: 'highly_fragmented', label: 'Highly Fragmented', color: 'rgba(239, 68, 68, 0.15)' },
      ];

      // Developer line colors (distinct palette)
      var LINE_COLORS = [
        '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
        '#f43f5e', '#6366f1', '#14b8a6', '#eab308', '#a855f7',
        '#0ea5e9', '#22d3ee', '#d946ef', '#fb7185', '#4ade80',
      ];

      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('applyFilterBtn');
      var startDateInput = document.getElementById('startDate');
      var endDateInput = document.getElementById('endDate');
      var developerFilter = document.getElementById('developerFilter');
      var focusCategoryFilter = document.getElementById('focusCategoryFilter');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var summaryStats = document.getElementById('summaryStats');
      var legendContainer = document.getElementById('legendContainer');
      var drillDownPanel = document.getElementById('drillDownPanel');
      var drillDownTitle = document.getElementById('drillDownTitle');
      var drillDownContent = document.getElementById('drillDownContent');
      var closeDrillDown = document.getElementById('closeDrillDown');
      var alertsContainer = document.getElementById('alertsContainer');
      var alertsList = document.getElementById('alertsList');
      var topDevelopersContainer = document.getElementById('topDevelopersContainer');
      var mostFocusedList = document.getElementById('mostFocusedList');
      var needsAttentionList = document.getElementById('needsAttentionList');
      var tooltip = document.getElementById('tooltip');

      // Set default date range (last 12 weeks)
      var today = new Date();
      var twelveWeeksAgo = new Date(today.getTime() - 84 * 24 * 60 * 60 * 1000);
      endDateInput.value = today.toISOString().split('T')[0];
      startDateInput.value = twelveWeeksAgo.toISOString().split('T')[0];

      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', function() {
        if (!focusData || focusData.length === 0) { return; }
        var headers = ['Developer', 'Week Start', 'Focus Score', 'Category',
                       'Commits', 'Unique Tickets', 'Active Days', 'Avg Tickets/Day',
                       'Score Delta'];
        var rows = focusData.map(function(d) {
          return [d.author, d.weekStart, d.focusScore, d.focusCategory,
                  d.totalCommits, d.totalUniqueTickets, d.activeDays, d.avgTicketsPerDay,
                  d.focusScoreDelta !== null ? d.focusScoreDelta : ''];
        });
        exportCsvFromData(headers, rows, 'developer-focus.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        // Capture selected developers from multi-select
        selectedDevelopers = Array.from(developerFilter.selectedOptions).map(function(opt) {
          return opt.value;
        }).filter(function(v) { return v !== ''; });
        requestData();
      });

      closeDrillDown.addEventListener('click', function() {
        drillDownPanel.style.display = 'none';
      });

      // ======================================================================
      // Message Handling
      // ======================================================================
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'focusData':
            handleFocusData(message);
            break;
          case 'focusTrendData':
            handleFocusTrendData(message);
            break;
          case 'focusFilterOptions':
            handleFilterOptions(message);
            break;
          case 'developerDrillDown':
            handleDeveloperDrillDown(message);
            break;
          case 'weekDrillDown':
            handleWeekDrillDown(message);
            break;
          case 'focusError':
            showError(escapeHtml(message.message));
            break;
          case 'focusLoading':
            if (message.isLoading) { showLoading(); } else { hideLoading(); }
            break;
        }
      });

      function handleFocusData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Developer Focus View Not Available',
            'The vw_developer_focus database view has not been created yet. Run the database migration (016) to enable this chart.'
          );
          return;
        }

        if (!message.hasData || !message.trends || message.trends.developers.length === 0) {
          showEmpty(
            'No Developer Focus Data Available',
            'No focus data found. Run the pipeline to analyze developer activity.'
          );
          return;
        }

        focusData = message.focusData;
        trendData = message.trends;
        teamSummary = message.teamSummary;

        renderChart(trendData);
        renderSummaryStats(teamSummary);
        renderLegend();
        renderAlerts(trendData);
        renderTopDevelopers(trendData, teamSummary);
        chartArea.style.display = 'block';
      }

      function handleFocusTrendData(message) {
        if (!message.hasData || !message.trends) { return; }
        trendData = message.trends;
        renderChart(trendData);
      }

      function handleFilterOptions(message) {
        // Populate developer filter
        var currentSelection = Array.from(developerFilter.selectedOptions).map(function(opt) {
          return opt.value;
        });

        while (developerFilter.options.length > 1) {
          developerFilter.remove(1);
        }

        (message.authors || []).forEach(function(author) {
          var option = document.createElement('option');
          option.value = author;
          option.textContent = author;
          if (currentSelection.indexOf(author) !== -1) {
            option.selected = true;
          }
          developerFilter.appendChild(option);
        });
      }

      function handleDeveloperDrillDown(message) {
        drillDownTitle.textContent = 'Developer: ' + escapeHtml(message.author);

        var html = '';
        html += '<div class="developer-summary">';
        html += '<div class="stat-mini"><span class="stat-value">' + message.avgFocusScore.toFixed(1) + '</span><span class="stat-label">Avg Score</span></div>';
        html += '<div class="stat-mini"><span class="stat-value category-' + escapeHtml(message.currentCategory) + '">' + formatCategory(message.currentCategory) + '</span><span class="stat-label">Current</span></div>';
        html += '<div class="stat-mini"><span class="stat-value ' + (message.trend >= 0 ? 'trend-up' : 'trend-down') + '">' + (message.trend >= 0 ? '+' : '') + message.trend.toFixed(1) + '</span><span class="stat-label">Trend</span></div>';
        html += '</div>';

        if (message.focusRows.length > 0) {
          html += '<h3>Weekly Focus Scores</h3>';
          html += '<table class="drill-down-table"><thead><tr>';
          html += '<th>Week</th><th>Score</th><th>Category</th><th>Commits</th><th>Tickets</th><th>Delta</th>';
          html += '</tr></thead><tbody>';

          message.focusRows.forEach(function(row) {
            html += '<tr>';
            html += '<td>' + formatWeek(row.weekStart) + '</td>';
            html += '<td>' + row.focusScore.toFixed(1) + '</td>';
            html += '<td class="category-' + escapeHtml(row.focusCategory) + '">' + formatCategory(row.focusCategory) + '</td>';
            html += '<td>' + row.totalCommits + '</td>';
            html += '<td>' + row.totalUniqueTickets + '</td>';
            html += '<td class="' + (row.focusScoreDelta !== null && row.focusScoreDelta >= 0 ? 'trend-up' : 'trend-down') + '">' +
                    (row.focusScoreDelta !== null ? (row.focusScoreDelta >= 0 ? '+' : '') + row.focusScoreDelta.toFixed(1) : '-') + '</td>';
            html += '</tr>';
          });
          html += '</tbody></table>';
        }

        drillDownContent.innerHTML = html;
        drillDownPanel.style.display = 'block';
      }

      function handleWeekDrillDown(message) {
        drillDownTitle.textContent = 'Week of ' + formatWeek(message.weekStart);

        var html = '';
        html += '<div class="week-summary">';
        html += '<div class="stat-mini"><span class="stat-value">' + message.teamAvgScore.toFixed(1) + '</span><span class="stat-label">Team Avg</span></div>';
        html += '<div class="stat-mini"><span class="stat-value">' + message.focusRows.length + '</span><span class="stat-label">Developers</span></div>';
        html += '</div>';

        html += '<div class="category-breakdown">';
        html += '<h3>Category Breakdown</h3>';
        html += '<div class="breakdown-grid">';

        html += '<div class="breakdown-item category-deep_focus">';
        html += '<span class="breakdown-count">' + message.categoryBreakdown.deepFocus.length + '</span>';
        html += '<span class="breakdown-label">Deep Focus</span>';
        if (message.categoryBreakdown.deepFocus.length > 0) {
          html += '<ul class="breakdown-names">' + message.categoryBreakdown.deepFocus.map(function(n) { return '<li>' + escapeHtml(n) + '</li>'; }).join('') + '</ul>';
        }
        html += '</div>';

        html += '<div class="breakdown-item category-moderate_focus">';
        html += '<span class="breakdown-count">' + message.categoryBreakdown.moderateFocus.length + '</span>';
        html += '<span class="breakdown-label">Moderate Focus</span>';
        if (message.categoryBreakdown.moderateFocus.length > 0) {
          html += '<ul class="breakdown-names">' + message.categoryBreakdown.moderateFocus.map(function(n) { return '<li>' + escapeHtml(n) + '</li>'; }).join('') + '</ul>';
        }
        html += '</div>';

        html += '<div class="breakdown-item category-fragmented">';
        html += '<span class="breakdown-count">' + message.categoryBreakdown.fragmented.length + '</span>';
        html += '<span class="breakdown-label">Fragmented</span>';
        if (message.categoryBreakdown.fragmented.length > 0) {
          html += '<ul class="breakdown-names">' + message.categoryBreakdown.fragmented.map(function(n) { return '<li>' + escapeHtml(n) + '</li>'; }).join('') + '</ul>';
        }
        html += '</div>';

        html += '<div class="breakdown-item category-highly_fragmented">';
        html += '<span class="breakdown-count">' + message.categoryBreakdown.highlyFragmented.length + '</span>';
        html += '<span class="breakdown-label">Highly Fragmented</span>';
        if (message.categoryBreakdown.highlyFragmented.length > 0) {
          html += '<ul class="breakdown-names">' + message.categoryBreakdown.highlyFragmented.map(function(n) { return '<li>' + escapeHtml(n) + '</li>'; }).join('') + '</ul>';
        }
        html += '</div>';

        html += '</div></div>';

        drillDownContent.innerHTML = html;
        drillDownPanel.style.display = 'block';
      }

      // ======================================================================
      // Multi-Line Chart Rendering with D3.js
      // ======================================================================
      function renderChart(data) {
        if (!data || data.developers.length === 0) { return; }

        // Filter developers if selection is active
        var displayDevelopers = data.developers;
        if (selectedDevelopers.length > 0) {
          displayDevelopers = data.developers.filter(function(d) {
            return selectedDevelopers.indexOf(d.name) !== -1;
          });
        }

        // Chart dimensions
        var containerWidth = Math.max(800, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var height = 450;
        var margin = { top: 30, right: 150, bottom: 50, left: 60 };

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Multi-line chart showing focus scores over time by developer');

        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        var g = svg.append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // Create scales
        var xScale = d3.scalePoint()
          .domain(data.weeks.map(function(w) { return formatWeek(w); }))
          .range([0, innerWidth])
          .padding(0.5);

        var yScale = d3.scaleLinear()
          .domain([0, 100])
          .range([innerHeight, 0]);

        // Draw background zones
        FOCUS_ZONES.forEach(function(zone) {
          g.append('rect')
            .attr('x', 0)
            .attr('y', yScale(zone.max))
            .attr('width', innerWidth)
            .attr('height', yScale(zone.min) - yScale(zone.max))
            .attr('fill', zone.color)
            .attr('class', 'focus-zone zone-' + zone.category);
        });

        // Draw grid lines
        g.append('g')
          .attr('class', 'grid-lines')
          .selectAll('line')
          .data([20, 40, 60, 80])
          .enter()
          .append('line')
          .attr('x1', 0)
          .attr('x2', innerWidth)
          .attr('y1', function(d) { return yScale(d); })
          .attr('y2', function(d) { return yScale(d); })
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-dasharray', '3,3')
          .attr('stroke-opacity', 0.5);

        // Draw axes
        var xAxis = d3.axisBottom(xScale);
        var yAxis = d3.axisLeft(yScale).ticks(5);

        g.append('g')
          .attr('class', 'x-axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(xAxis)
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end')
          .attr('dx', '-0.5em')
          .attr('dy', '0.5em');

        g.append('g')
          .attr('class', 'y-axis')
          .call(yAxis);

        // Y-axis label
        g.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -45)
          .attr('x', -innerHeight / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '12px')
          .text('Focus Score');

        // Line generator
        var line = d3.line()
          .x(function(d, i) { return xScale(formatWeek(data.weeks[i])); })
          .y(function(d) { return yScale(d); })
          .defined(function(d) { return d > 0; }); // Skip weeks with no data

        // Draw developer lines
        displayDevelopers.forEach(function(dev, devIndex) {
          var lineColor = LINE_COLORS[devIndex % LINE_COLORS.length];

          // Draw the line
          g.append('path')
            .datum(dev.scores)
            .attr('class', 'developer-line')
            .attr('fill', 'none')
            .attr('stroke', lineColor)
            .attr('stroke-width', 2)
            .attr('stroke-opacity', 0.8)
            .attr('d', line)
            .attr('data-developer', dev.name);

          // Draw data points
          dev.scores.forEach(function(score, weekIndex) {
            if (score === 0) { return; } // Skip empty weeks

            var cx = xScale(formatWeek(data.weeks[weekIndex]));
            var cy = yScale(score);

            g.append('circle')
              .attr('class', 'data-point')
              .attr('cx', cx)
              .attr('cy', cy)
              .attr('r', 5)
              .attr('fill', lineColor)
              .attr('stroke', '#fff')
              .attr('stroke-width', 1)
              .attr('cursor', 'pointer')
              .attr('tabindex', '0')
              .attr('role', 'button')
              .attr('aria-label', escapeHtml(dev.name) + ' - ' + formatWeek(data.weeks[weekIndex]) + ': ' + score.toFixed(1))
              .on('mouseover', function(event) {
                showPointTooltip(event, dev, score, data.weeks[weekIndex], weekIndex, data);
                d3.select(this).attr('r', 7);
              })
              .on('mousemove', function(event) { moveTooltip(event); })
              .on('mouseout', function() {
                hideTooltip();
                d3.select(this).attr('r', 5);
              })
              .on('click', function() {
                requestDeveloperDrillDown(dev.name);
              })
              .on('keydown', function(event) {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  requestDeveloperDrillDown(dev.name);
                }
              });
          });
        });

        // Draw team average dashed line
        if (data.teamAvgByWeek && data.teamAvgByWeek.length > 0) {
          g.append('path')
            .datum(data.teamAvgByWeek)
            .attr('class', 'team-avg-line')
            .attr('fill', 'none')
            .attr('stroke', '#9ca3af')
            .attr('stroke-width', 3)
            .attr('stroke-dasharray', '8,4')
            .attr('stroke-opacity', 0.9)
            .attr('d', line);
        }

        // Draw developer legend on the right
        var legendY = 10;
        displayDevelopers.slice(0, 10).forEach(function(dev, i) {
          var lineColor = LINE_COLORS[i % LINE_COLORS.length];

          var legendItem = g.append('g')
            .attr('transform', 'translate(' + (innerWidth + 15) + ',' + legendY + ')');

          legendItem.append('line')
            .attr('x1', 0)
            .attr('x2', 20)
            .attr('y1', 0)
            .attr('y2', 0)
            .attr('stroke', lineColor)
            .attr('stroke-width', 2);

          legendItem.append('text')
            .attr('x', 25)
            .attr('y', 4)
            .attr('fill', 'var(--vscode-foreground, #ccc)')
            .attr('font-size', '11px')
            .text(truncateText(dev.name, 16));

          legendY += 18;
        });

        // Team average legend entry
        var teamLegendItem = g.append('g')
          .attr('transform', 'translate(' + (innerWidth + 15) + ',' + (legendY + 10) + ')');

        teamLegendItem.append('line')
          .attr('x1', 0)
          .attr('x2', 20)
          .attr('y1', 0)
          .attr('y2', 0)
          .attr('stroke', '#9ca3af')
          .attr('stroke-width', 3)
          .attr('stroke-dasharray', '8,4');

        teamLegendItem.append('text')
          .attr('x', 25)
          .attr('y', 4)
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .attr('font-style', 'italic')
          .text('Team Avg');
      }

      // ======================================================================
      // Tooltip Functions
      // ======================================================================
      function showPointTooltip(event, developer, score, weekStart, weekIndex, data) {
        var prevScore = weekIndex > 0 ? developer.scores[weekIndex - 1] : null;
        var delta = prevScore !== null && prevScore > 0 ? score - prevScore : null;

        var category = getCategoryForScore(score);
        var html =
          '<div class="tt-title"><strong>' + escapeHtml(developer.name) + '</strong></div>' +
          '<div class="tt-week">Week of ' + formatWeek(weekStart) + '</div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-stat">Focus Score: <strong>' + score.toFixed(1) + '</strong></div>' +
          '<div class="tt-category category-' + category + '">' + formatCategory(category) + '</div>';

        if (delta !== null) {
          html += '<div class="tt-stat">Change: <span class="' + (delta >= 0 ? 'trend-up' : 'trend-down') + '">' +
                  (delta >= 0 ? '+' : '') + delta.toFixed(1) + '</span></div>';
        }

        html += '<div class="tt-stat">Avg Score: <strong>' + developer.avgScore.toFixed(1) + '</strong></div>';
        html += '<div class="tt-action">[Click for details]</div>';

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
      function requestDeveloperDrillDown(author) {
        vscode.postMessage({
          type: 'requestDeveloperDrillDown',
          author: author,
          filters: getFilters(),
        });
      }

      function requestWeekDrillDown(weekStart) {
        vscode.postMessage({
          type: 'requestWeekDrillDown',
          weekStart: weekStart,
          filters: getFilters(),
        });
      }

      // ======================================================================
      // Summary Stats
      // ======================================================================
      function renderSummaryStats(summary) {
        if (!summary) { return; }

        var html = '';
        html += createStatCard(summary.avgFocusScore.toFixed(1), 'Team Avg Score');
        html += createStatCard(summary.totalDevelopers.toString(), 'Developers');
        html += createStatCard(summary.deepFocusCount.toString(), 'Deep Focus', 'deep_focus');
        html += createStatCard(summary.moderateFocusCount.toString(), 'Moderate', 'moderate_focus');
        html += createStatCard(summary.fragmentedCount.toString(), 'Fragmented', 'fragmented');
        html += createStatCard(summary.highlyFragmentedCount.toString(), 'Highly Frag.', 'highly_fragmented');
        summaryStats.innerHTML = html;
      }

      function createStatCard(value, label, category) {
        var categoryClass = category ? ' stat-' + category : '';
        return '<div class="stat-card' + categoryClass + '">' +
               '<div class="stat-value">' + escapeHtml(String(value)) + '</div>' +
               '<div class="stat-label">' + escapeHtml(label) + '</div></div>';
      }

      // ======================================================================
      // Legend
      // ======================================================================
      function renderLegend() {
        legendContainer.innerHTML = '';

        FOCUS_ZONES.forEach(function(zone) {
          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = CATEGORY_COLORS[zone.category];
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.textContent = zone.label + ' (' + zone.min + '-' + zone.max + ')';
          item.appendChild(label);

          legendContainer.appendChild(item);
        });

        var note = document.createElement('div');
        note.className = 'legend-note';
        note.textContent = 'Dashed line = Team average';
        legendContainer.appendChild(note);
      }

      // ======================================================================
      // Alerts (Declining Trends)
      // ======================================================================
      function renderAlerts(data) {
        if (!data || data.developers.length === 0) {
          alertsContainer.style.display = 'none';
          return;
        }

        var decliningDevs = [];

        data.developers.forEach(function(dev) {
          // Check for 3+ consecutive declining weeks
          var declineStreak = 0;
          var maxDeclineStreak = 0;

          for (var i = 1; i < dev.scores.length; i++) {
            if (dev.scores[i] > 0 && dev.scores[i - 1] > 0) {
              if (dev.scores[i] < dev.scores[i - 1]) {
                declineStreak++;
                maxDeclineStreak = Math.max(maxDeclineStreak, declineStreak);
              } else {
                declineStreak = 0;
              }
            }
          }

          if (maxDeclineStreak >= 2) { // 2 declines = 3 consecutive weeks
            var recentScores = dev.scores.filter(function(s) { return s > 0; }).slice(-3);
            var avgRecent = recentScores.length > 0
              ? recentScores.reduce(function(a, b) { return a + b; }, 0) / recentScores.length
              : 0;

            decliningDevs.push({
              name: dev.name,
              declineWeeks: maxDeclineStreak + 1,
              recentAvg: avgRecent,
            });
          }
        });

        if (decliningDevs.length === 0) {
          alertsContainer.style.display = 'none';
          return;
        }

        // Sort by decline severity
        decliningDevs.sort(function(a, b) { return b.declineWeeks - a.declineWeeks; });

        var html = '';
        decliningDevs.forEach(function(dev) {
          html += '<div class="alert-item">';
          html += '<span class="alert-icon">&#9660;</span>';
          html += '<span class="alert-name">' + escapeHtml(dev.name) + '</span>';
          html += '<span class="alert-detail">' + dev.declineWeeks + '-week decline, avg ' + dev.recentAvg.toFixed(1) + '</span>';
          html += '</div>';
        });

        alertsList.innerHTML = html;
        alertsContainer.style.display = 'block';
      }

      // ======================================================================
      // Top Developers
      // ======================================================================
      function renderTopDevelopers(data, summary) {
        if (!data || data.developers.length === 0) {
          topDevelopersContainer.style.display = 'none';
          return;
        }

        // Sort by average score descending
        var sorted = data.developers.slice().sort(function(a, b) {
          return b.avgScore - a.avgScore;
        });

        // Top 3 most focused
        var mostFocused = sorted.slice(0, 3);
        var mostFocusedHtml = '';
        mostFocused.forEach(function(dev) {
          var category = getCategoryForScore(dev.avgScore);
          mostFocusedHtml += '<li class="developer-item category-' + category + '">';
          mostFocusedHtml += '<span class="dev-name">' + escapeHtml(dev.name) + '</span>';
          mostFocusedHtml += '<span class="dev-score">' + dev.avgScore.toFixed(1) + '</span>';
          mostFocusedHtml += '</li>';
        });
        mostFocusedList.innerHTML = mostFocusedHtml;

        // Needs attention: score < 40 or declining
        var needsAttention = data.developers.filter(function(dev) {
          if (dev.avgScore < 40) { return true; }

          // Check for declining trend
          var recentScores = dev.scores.filter(function(s) { return s > 0; }).slice(-3);
          if (recentScores.length >= 3) {
            return recentScores[2] < recentScores[1] && recentScores[1] < recentScores[0];
          }
          return false;
        });

        var needsAttentionHtml = '';
        if (needsAttention.length === 0) {
          needsAttentionHtml = '<li class="no-attention">No developers currently need attention</li>';
        } else {
          needsAttention.slice(0, 5).forEach(function(dev) {
            var category = getCategoryForScore(dev.avgScore);
            needsAttentionHtml += '<li class="developer-item category-' + category + '">';
            needsAttentionHtml += '<span class="dev-name">' + escapeHtml(dev.name) + '</span>';
            needsAttentionHtml += '<span class="dev-score">' + dev.avgScore.toFixed(1) + '</span>';
            needsAttentionHtml += '</li>';
          });
        }
        needsAttentionList.innerHTML = needsAttentionHtml;

        topDevelopersContainer.style.display = 'block';
      }

      // ======================================================================
      // Utility Functions
      // ======================================================================
      function truncateText(text, maxLength) {
        if (!text) { return ''; }
        if (text.length <= maxLength) { return text; }
        return text.slice(0, maxLength - 2) + '..';
      }

      function formatWeek(isoString) {
        if (!isoString) { return ''; }
        var d = new Date(isoString);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }

      function formatCategory(category) {
        var labels = {
          deep_focus: 'Deep Focus',
          moderate_focus: 'Moderate',
          fragmented: 'Fragmented',
          highly_fragmented: 'Highly Frag.',
        };
        return labels[category] || category;
      }

      function getCategoryForScore(score) {
        if (score >= 80) { return 'deep_focus'; }
        if (score >= 60) { return 'moderate_focus'; }
        if (score >= 40) { return 'fragmented'; }
        return 'highly_fragmented';
      }

      function getFilters() {
        var filters = {};
        if (startDateInput.value) { filters.startDate = startDateInput.value; }
        if (endDateInput.value) { filters.endDate = endDateInput.value; }
        if (focusCategoryFilter.value) { filters.focusCategory = focusCategoryFilter.value; }
        if (selectedDevelopers.length === 1) { filters.author = selectedDevelopers[0]; }
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
        drillDownPanel.style.display = 'none';
        alertsContainer.style.display = 'none';
        topDevelopersContainer.style.display = 'none';
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
        vscode.postMessage({
          type: 'requestFocusData',
          filters: getFilters(),
        });
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
      requestData();

    })();
  </script>
</body>
</html>`;
}
