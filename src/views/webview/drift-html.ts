/**
 * HTML content generator for the Architecture Drift Heat Map dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Heat map visualization: component rows x week columns
 * - Cell color intensity reflects commit count (white -> blue -> purple -> red)
 * - Warning badge on cells with cross-component commits
 * - Hover cell shows tooltip with commit count, LOC, cross-component count
 * - Click cell opens commit list
 * - Cross-component filter toggle
 * - Component visibility toggles, date range filter
 * - Summary panel with drift trend
 * - Most coupled component pairs list
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-918
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the drift HTML.
 */
export interface DriftHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the drift CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Architecture Drift Heat Map dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateDriftHtml(config: DriftHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Architecture Drift Heat Map</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Architecture Drift Heat Map</h1>
      <div class="controls">
        <div class="filter-group">
          <label for="repositoryFilter">Repository</label>
          <select id="repositoryFilter" aria-label="Repository filter" tabindex="0">
            <option value="">All Repositories</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="componentFilter">Component</label>
          <select id="componentFilter" aria-label="Component filter" tabindex="0">
            <option value="">All Components</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="severityFilter">Severity</label>
          <select id="severityFilter" aria-label="Severity filter" tabindex="0">
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <button class="action-btn" id="applyFilterBtn" aria-label="Apply filters" tabindex="0">Apply</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading architecture drift data...</span>
    </div>

    <div id="errorState" style="display:none;"></div>

    <div id="emptyState" style="display:none;"></div>

    <div id="chartArea" style="display:none;">
      <div id="legendContainer" class="chart-legend drift-legend" role="img" aria-label="Heat intensity legend"></div>

      <div class="cross-component-filter" role="group" aria-label="Cross-component filter">
        <label class="filter-toggle">
          <input type="checkbox" id="showCrossComponentOnly" aria-label="Show only cross-component commits">
          <span>Show Cross-Component Only</span>
        </label>
      </div>

      <div class="heat-map-section">
        <h2>Component x Week Heat Map</h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This heat map visualizes architecture component activity over time. Darker cells indicate more commits affecting that component in a given week. Warning badges highlight cross-component changes that may indicate architecture drift or tightly coupled modules needing refactoring.</p>
          </div>
        </details>
        <div class="heat-map-container" role="img" aria-label="Heat map showing component activity by week">
          <svg id="heatMapSvg"></svg>
        </div>
        <div class="chart-instructions">
          <p>Hover over cells to see details. Click a cell to view commits. Warning badges indicate cross-component changes.</p>
        </div>
      </div>

      <div class="component-toggles-section" id="componentTogglesSection">
        <h3>Component Visibility</h3>
        <div id="componentToggles" class="component-toggles" role="group" aria-label="Component visibility toggles"></div>
      </div>

      <div class="coupling-section">
        <h2>Most Coupled Component Pairs</h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This table ranks component pairs by coupling strength, showing how often changes to one component also require changes to another. High coupling indicates modules that may need to be merged or have clearer interfaces defined.</p>
          </div>
        </details>
        <div id="couplingTable" class="coupling-table-container" role="region" aria-label="Component coupling pairs">
          <table id="pairsTable" class="data-table">
            <thead>
              <tr>
                <th scope="col">Component A</th>
                <th scope="col">Component B</th>
                <th scope="col">Coupling Count</th>
                <th scope="col">Unique Commits</th>
                <th scope="col">Strength</th>
              </tr>
            </thead>
            <tbody id="pairsTableBody"></tbody>
          </table>
        </div>
      </div>

      <div class="drift-insights" id="driftInsights">
        <h2>Drift Insights</h2>
        <div class="insights-grid">
          <div class="insight-card" id="highestDriftCard">
            <h3>Highest Drift Component</h3>
            <div class="insight-value">-</div>
            <div class="insight-detail">-</div>
          </div>
          <div class="insight-card" id="severityBreakdown">
            <h3>Severity Breakdown</h3>
            <div class="severity-bars"></div>
          </div>
          <div class="insight-card" id="trendCard">
            <h3>Drift Trend</h3>
            <div class="insight-value">-</div>
            <div class="insight-detail">-</div>
          </div>
        </div>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div id="drillDownPanel" class="drill-down-panel" style="display:none;">
      <div class="drill-down-header">
        <h2 id="drillDownTitle">Commits</h2>
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
      var heatMapData = null;
      var driftData = null;
      var couplingData = null;
      var summaryData = null;
      var hiddenComponents = new Set();
      var showCrossComponentOnly = false;

      // Heat intensity colors (white -> blue -> purple -> red)
      var INTENSITY_COLORS = [
        '#ffffff',  // 0: white
        '#dbeafe',  // 1-10: light blue
        '#93c5fd',  // 11-25: blue
        '#60a5fa',  // 26-40: medium blue
        '#3b82f6',  // 41-55: darker blue
        '#8b5cf6',  // 56-70: purple
        '#a855f7',  // 71-85: bright purple
        '#ef4444',  // 86-100: red
      ];

      // Severity colors
      var SEVERITY_COLORS = {
        critical: '#dc2626',
        high: '#f97316',
        medium: '#eab308',
        low: '#22c55e',
      };

      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('applyFilterBtn');
      var repositoryFilter = document.getElementById('repositoryFilter');
      var componentFilter = document.getElementById('componentFilter');
      var severityFilter = document.getElementById('severityFilter');
      var showCrossComponentOnlyCheckbox = document.getElementById('showCrossComponentOnly');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var summaryStats = document.getElementById('summaryStats');
      var legendContainer = document.getElementById('legendContainer');
      var componentToggles = document.getElementById('componentToggles');
      var pairsTableBody = document.getElementById('pairsTableBody');
      var driftInsights = document.getElementById('driftInsights');
      var drillDownPanel = document.getElementById('drillDownPanel');
      var drillDownTitle = document.getElementById('drillDownTitle');
      var drillDownContent = document.getElementById('drillDownContent');
      var closeDrillDown = document.getElementById('closeDrillDown');
      var tooltip = document.getElementById('tooltip');

      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', function() {
        if (!driftData || driftData.length === 0) { return; }
        var headers = ['Component', 'Repository', 'Cross-Component Commits', 'Total Commits',
                       'Drift %', 'Heat Intensity', 'Critical', 'High', 'Medium', 'Low'];
        var rows = driftData.map(function(d) {
          return [d.component, d.repository, d.crossComponentCommits, d.totalCommits,
                  d.driftPercentage.toFixed(1), d.heatIntensity.toFixed(1),
                  d.criticalCount, d.highCount, d.mediumCount, d.lowCount];
        });
        exportCsvFromData(headers, rows, 'architecture-drift.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        requestData();
      });

      showCrossComponentOnlyCheckbox.addEventListener('change', function() {
        showCrossComponentOnly = this.checked;
        if (heatMapData) { renderHeatMap(heatMapData); }
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
          case 'driftData':
            handleDriftData(message);
            break;
          case 'driftFilterOptions':
            handleFilterOptions(message);
            break;
          case 'cellDrillDown':
            handleCellDrillDown(message);
            break;
          case 'componentDrillDown':
            handleComponentDrillDown(message);
            break;
          case 'driftError':
            showError(escapeHtml(message.message));
            break;
          case 'driftLoading':
            if (message.isLoading) { showLoading(); } else { hideLoading(); }
            break;
        }
      });

      function handleDriftData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Architecture Drift View Not Available',
            'The vw_architecture_drift database view has not been created yet. Run the database migration (021) to enable this chart.'
          );
          return;
        }

        if (!message.hasData || !message.heatMapData || message.heatMapData.components.length === 0) {
          showEmpty(
            'No Architecture Drift Data Available',
            'No drift data found. Run the pipeline to analyze cross-component commits.'
          );
          return;
        }

        heatMapData = message.heatMapData;
        driftData = message.driftData;
        couplingData = message.couplingData;
        summaryData = message.summary;

        renderHeatMap(heatMapData);
        renderSummaryStats(summaryData);
        renderLegend();
        renderComponentToggles(heatMapData.components);
        renderCouplingTable(couplingData);
        renderDriftInsights(driftData, summaryData);

        chartArea.style.display = 'block';
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

        // Populate component filter
        while (componentFilter.options.length > 1) {
          componentFilter.remove(1);
        }
        (message.components || []).forEach(function(comp) {
          var option = document.createElement('option');
          option.value = comp;
          option.textContent = comp;
          componentFilter.appendChild(option);
        });
      }

      function handleCellDrillDown(message) {
        drillDownTitle.textContent = escapeHtml(message.component) + ' - Week of ' + formatDate(message.week);

        var html = '';
        if (!message.hasData || message.commits.length === 0) {
          html = '<p class="empty-text">No commits found for this cell.</p>';
        } else {
          html += '<div class="cell-summary">';
          html += '<div class="stat-mini"><span class="stat-value">' + message.commits.length + '</span><span class="stat-label">Commits</span></div>';
          var crossCount = message.commits.filter(function(c) { return c.componentCount > 1; }).length;
          html += '<div class="stat-mini"><span class="stat-value">' + crossCount + '</span><span class="stat-label">Cross-Component</span></div>';
          html += '</div>';

          html += '<h3>Commits</h3>';
          html += '<div class="commits-list">';
          message.commits.forEach(function(commit) {
            var severityClass = 'severity-' + commit.driftSeverity;
            var crossBadge = commit.componentCount > 1 ? '<span class="cross-badge" title="' + commit.componentCount + ' components">' + commit.componentCount + '</span>' : '';
            html += '<div class="commit-item ' + severityClass + '">';
            html += '<div class="commit-header">';
            html += '<span class="commit-sha">' + escapeHtml(commit.sha.substring(0, 8)) + '</span>';
            html += crossBadge;
            html += '<span class="commit-severity ' + severityClass + '">' + escapeHtml(commit.driftSeverity) + '</span>';
            html += '</div>';
            html += '<div class="commit-message">' + escapeHtml(truncateText(commit.commitMessage, 60)) + '</div>';
            html += '<div class="commit-meta">' + escapeHtml(commit.author) + ' - ' + formatDate(commit.commitDate) + '</div>';
            if (commit.componentsTouched && commit.componentsTouched.length > 1) {
              html += '<div class="commit-components">Components: ' + escapeHtml(commit.componentsTouched.join(', ')) + '</div>';
            }
            html += '</div>';
          });
          html += '</div>';
        }

        drillDownContent.innerHTML = html;
        drillDownPanel.style.display = 'block';
      }

      function handleComponentDrillDown(message) {
        drillDownTitle.textContent = 'Component: ' + escapeHtml(message.component);

        var drift = message.drift;
        var html = '';

        if (!drift) {
          html = '<p class="empty-text">No drift data found for this component.</p>';
        } else {
          html += '<div class="component-summary">';
          html += '<div class="stat-mini"><span class="stat-value">' + drift.crossComponentCommits + '</span><span class="stat-label">Cross-Component</span></div>';
          html += '<div class="stat-mini"><span class="stat-value">' + drift.totalCommits + '</span><span class="stat-label">Total Commits</span></div>';
          html += '<div class="stat-mini"><span class="stat-value">' + drift.driftPercentage.toFixed(1) + '%</span><span class="stat-label">Drift %</span></div>';
          html += '<div class="stat-mini"><span class="stat-value">' + drift.heatIntensity.toFixed(0) + '</span><span class="stat-label">Heat</span></div>';
          html += '</div>';

          html += '<h3>Severity Breakdown</h3>';
          html += '<div class="severity-summary">';
          html += '<div class="severity-item critical"><span class="count">' + drift.criticalCount + '</span><span class="label">Critical</span></div>';
          html += '<div class="severity-item high"><span class="count">' + drift.highCount + '</span><span class="label">High</span></div>';
          html += '<div class="severity-item medium"><span class="count">' + drift.mediumCount + '</span><span class="label">Medium</span></div>';
          html += '<div class="severity-item low"><span class="count">' + drift.lowCount + '</span><span class="label">Low</span></div>';
          html += '</div>';

          html += '<h3>Details</h3>';
          html += '<div class="component-details">';
          html += '<p><strong>Unique Authors:</strong> ' + drift.uniqueAuthors + '</p>';
          html += '<p><strong>Unique Teams:</strong> ' + drift.uniqueTeams + '</p>';
          html += '<p><strong>Avg Components/Commit:</strong> ' + drift.avgComponentsPerCommit.toFixed(1) + '</p>';
          html += '<p><strong>Total Churn:</strong> ' + drift.totalChurn.toLocaleString() + ' lines</p>';
          if (drift.firstDriftDate) {
            html += '<p><strong>First Drift:</strong> ' + formatDate(drift.firstDriftDate) + '</p>';
          }
          if (drift.lastDriftDate) {
            html += '<p><strong>Last Drift:</strong> ' + formatDate(drift.lastDriftDate) + '</p>';
          }
          html += '</div>';
        }

        drillDownContent.innerHTML = html;
        drillDownPanel.style.display = 'block';
      }

      // ======================================================================
      // Heat Map Rendering with D3.js
      // ======================================================================
      function renderHeatMap(data) {
        if (!data || data.components.length === 0 || data.weeks.length === 0) {
          return;
        }

        // Filter visible components
        var visibleComponents = data.components.filter(function(c) {
          return !hiddenComponents.has(c);
        });

        if (visibleComponents.length === 0) {
          showEmpty('All Components Hidden', 'Enable at least one component in visibility toggles.');
          return;
        }

        // Filter cells based on visibility
        var visibleCells = data.cells.filter(function(cell) {
          if (hiddenComponents.has(cell.component)) { return false; }
          if (showCrossComponentOnly && cell.commitCount === 0) { return false; }
          return true;
        });

        var svg = d3.select('#heatMapSvg');
        svg.selectAll('*').remove();

        // Dimensions
        var containerWidth = Math.max(600, document.querySelector('.heat-map-container').clientWidth - 24);
        var cellSize = Math.min(40, Math.floor((containerWidth - 150) / data.weeks.length));
        var margin = { top: 80, right: 30, bottom: 30, left: 120 };
        var width = margin.left + (data.weeks.length * cellSize) + margin.right;
        var height = margin.top + (visibleComponents.length * cellSize) + margin.bottom;

        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Heat map showing ' + visibleComponents.length + ' components over ' + data.weeks.length + ' weeks');

        var g = svg.append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // Scales
        var xScale = d3.scaleBand()
          .domain(data.weeks)
          .range([0, data.weeks.length * cellSize])
          .padding(0.05);

        var yScale = d3.scaleBand()
          .domain(visibleComponents)
          .range([0, visibleComponents.length * cellSize])
          .padding(0.05);

        // Color scale
        function getIntensityColor(intensity) {
          if (intensity === 0) return INTENSITY_COLORS[0];
          if (intensity <= 10) return INTENSITY_COLORS[1];
          if (intensity <= 25) return INTENSITY_COLORS[2];
          if (intensity <= 40) return INTENSITY_COLORS[3];
          if (intensity <= 55) return INTENSITY_COLORS[4];
          if (intensity <= 70) return INTENSITY_COLORS[5];
          if (intensity <= 85) return INTENSITY_COLORS[6];
          return INTENSITY_COLORS[7];
        }

        // Build lookup map for cells
        var cellMap = new Map();
        visibleCells.forEach(function(cell) {
          var key = cell.component + '|' + cell.week;
          cellMap.set(key, cell);
        });

        // Draw cells
        visibleComponents.forEach(function(component) {
          data.weeks.forEach(function(week) {
            var key = component + '|' + week;
            var cell = cellMap.get(key);
            var intensity = cell ? cell.intensity : 0;
            var commitCount = cell ? cell.commitCount : 0;

            var cellG = g.append('g')
              .attr('class', 'heat-cell')
              .attr('transform', 'translate(' + xScale(week) + ',' + yScale(component) + ')');

            cellG.append('rect')
              .attr('width', xScale.bandwidth())
              .attr('height', yScale.bandwidth())
              .attr('fill', getIntensityColor(intensity))
              .attr('stroke', 'var(--vscode-panel-border, #444)')
              .attr('stroke-width', 0.5)
              .attr('rx', 2)
              .attr('cursor', 'pointer')
              .attr('tabindex', '0')
              .attr('role', 'button')
              .attr('aria-label', component + ', week ' + week + ': ' + commitCount + ' commits, intensity ' + intensity.toFixed(0))
              .on('mouseover', function(event) {
                showCellTooltip(event, component, week, cell);
                d3.select(this).attr('stroke-width', 2).attr('stroke', 'var(--vscode-focusBorder, #007acc)');
              })
              .on('mouseout', function() {
                hideTooltip();
                d3.select(this).attr('stroke-width', 0.5).attr('stroke', 'var(--vscode-panel-border, #444)');
              })
              .on('click', function() {
                requestCellDrillDown(component, week);
              })
              .on('keydown', function(event) {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  requestCellDrillDown(component, week);
                }
              });

            // Warning badge for cross-component cells
            if (commitCount > 0) {
              cellG.append('text')
                .attr('x', xScale.bandwidth() / 2)
                .attr('y', yScale.bandwidth() / 2)
                .attr('dy', '0.35em')
                .attr('text-anchor', 'middle')
                .attr('font-size', Math.min(10, cellSize / 3) + 'px')
                .attr('fill', intensity > 50 ? '#fff' : '#333')
                .attr('pointer-events', 'none')
                .text(commitCount > 0 ? commitCount : '');
            }
          });
        });

        // X-axis (weeks)
        g.append('g')
          .attr('class', 'x-axis')
          .attr('transform', 'translate(0,-5)')
          .selectAll('text')
          .data(data.weeks)
          .enter()
          .append('text')
          .attr('x', function(d) { return xScale(d) + xScale.bandwidth() / 2; })
          .attr('y', -10)
          .attr('text-anchor', 'end')
          .attr('transform', function(d) {
            return 'rotate(-45 ' + (xScale(d) + xScale.bandwidth() / 2) + ' -10)';
          })
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px')
          .text(function(d) { return formatWeekLabel(d); });

        // Y-axis (components)
        g.append('g')
          .attr('class', 'y-axis')
          .attr('transform', 'translate(-5,0)')
          .selectAll('text')
          .data(visibleComponents)
          .enter()
          .append('text')
          .attr('x', -8)
          .attr('y', function(d) { return yScale(d) + yScale.bandwidth() / 2; })
          .attr('dy', '0.35em')
          .attr('text-anchor', 'end')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .attr('cursor', 'pointer')
          .text(function(d) { return truncateText(d, 15); })
          .on('click', function(event, d) {
            requestComponentDrillDown(d);
          });
      }

      // ======================================================================
      // Tooltip Functions
      // ======================================================================
      function showCellTooltip(event, component, week, cell) {
        var commitCount = cell ? cell.commitCount : 0;
        var intensity = cell ? cell.intensity : 0;

        var html =
          '<div class="tt-title"><strong>' + escapeHtml(component) + '</strong></div>' +
          '<div class="tt-stat">Week: ' + formatDate(week) + '</div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-stat">Cross-Component Commits: <strong>' + commitCount + '</strong></div>' +
          '<div class="tt-stat">Heat Intensity: <strong>' + intensity.toFixed(0) + '%</strong></div>' +
          '<div class="tt-action">[Click for details]</div>';

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
      function requestCellDrillDown(component, week) {
        vscode.postMessage({
          type: 'requestCellDrillDown',
          component: component,
          week: week,
          filters: getFilters(),
        });
      }

      function requestComponentDrillDown(component) {
        vscode.postMessage({
          type: 'requestComponentDrillDown',
          component: component,
          filters: getFilters(),
        });
      }

      // ======================================================================
      // Summary Stats
      // ======================================================================
      function renderSummaryStats(summary) {
        if (!summary) { return; }

        var html = '';
        html += createStatCard(summary.totalCrossComponentCommits.toString(), 'Cross-Component Commits');
        html += createStatCard(summary.totalComponents.toString(), 'Components');
        html += createStatCard(summary.avgDriftPercentage.toFixed(1) + '%', 'Avg Drift %');
        html += createStatCard(summary.maxHeatIntensity.toFixed(0), 'Max Heat');
        html += createStatCard(summary.totalCritical.toString(), 'Critical', 'critical');
        html += createStatCard(summary.totalHigh.toString(), 'High', 'high');

        summaryStats.innerHTML = html;
      }

      function createStatCard(value, label, severityClass) {
        var cardClass = severityClass ? ' stat-' + severityClass : '';
        return '<div class="stat-card' + cardClass + '">' +
               '<div class="stat-value">' + escapeHtml(String(value)) + '</div>' +
               '<div class="stat-label">' + escapeHtml(label) + '</div></div>';
      }

      // ======================================================================
      // Legend
      // ======================================================================
      function renderLegend() {
        legendContainer.innerHTML = '';

        var gradientContainer = document.createElement('div');
        gradientContainer.className = 'legend-gradient-container';

        var gradient = document.createElement('div');
        gradient.className = 'legend-gradient';
        gradient.style.background = 'linear-gradient(to right, ' + INTENSITY_COLORS.join(', ') + ')';
        gradientContainer.appendChild(gradient);

        var labels = document.createElement('div');
        labels.className = 'legend-labels';
        labels.innerHTML = '<span>0%</span><span>50%</span><span>100%</span>';
        gradientContainer.appendChild(labels);

        legendContainer.appendChild(gradientContainer);

        var title = document.createElement('div');
        title.className = 'legend-title';
        title.textContent = 'Heat Intensity (cross-component activity)';
        legendContainer.appendChild(title);
      }

      // ======================================================================
      // Component Toggles
      // ======================================================================
      function renderComponentToggles(components) {
        componentToggles.innerHTML = '';

        components.forEach(function(component) {
          var toggle = document.createElement('label');
          toggle.className = 'component-toggle';

          var checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = !hiddenComponents.has(component);
          checkbox.addEventListener('change', function() {
            if (this.checked) {
              hiddenComponents.delete(component);
            } else {
              hiddenComponents.add(component);
            }
            renderHeatMap(heatMapData);
          });
          toggle.appendChild(checkbox);

          var name = document.createElement('span');
          name.className = 'toggle-name';
          name.textContent = component;
          toggle.appendChild(name);

          componentToggles.appendChild(toggle);
        });
      }

      // ======================================================================
      // Coupling Table
      // ======================================================================
      function renderCouplingTable(couplings) {
        if (!couplings || couplings.length === 0) {
          pairsTableBody.innerHTML = '<tr><td colspan="5" class="empty-text">No coupling data found.</td></tr>';
          return;
        }

        // Sort by coupling count descending, take top 10
        var sorted = couplings.slice().sort(function(a, b) {
          return b.couplingCount - a.couplingCount;
        }).slice(0, 10);

        pairsTableBody.innerHTML = sorted.map(function(pair) {
          var strengthClass = pair.couplingStrength >= 70 ? 'strength-high' :
                              pair.couplingStrength >= 40 ? 'strength-medium' : 'strength-low';
          return '<tr>' +
            '<td>' + escapeHtml(pair.componentA) + '</td>' +
            '<td>' + escapeHtml(pair.componentB) + '</td>' +
            '<td>' + pair.couplingCount + '</td>' +
            '<td>' + pair.uniqueCommits + '</td>' +
            '<td class="' + strengthClass + '">' + pair.couplingStrength.toFixed(0) + '%</td>' +
            '</tr>';
        }).join('');
      }

      // ======================================================================
      // Drift Insights
      // ======================================================================
      function renderDriftInsights(drifts, summary) {
        // Highest drift component
        var highestCard = document.querySelector('#highestDriftCard');
        if (summary && summary.highestDriftComponent) {
          highestCard.querySelector('.insight-value').textContent = escapeHtml(summary.highestDriftComponent);
          var highest = drifts.find(function(d) { return d.component === summary.highestDriftComponent; });
          if (highest) {
            highestCard.querySelector('.insight-detail').textContent =
              highest.driftPercentage.toFixed(1) + '% drift, ' + highest.crossComponentCommits + ' commits';
          }
        } else {
          highestCard.querySelector('.insight-value').textContent = 'None';
          highestCard.querySelector('.insight-detail').textContent = '-';
        }

        // Severity breakdown
        var severityCard = document.querySelector('#severityBreakdown .severity-bars');
        if (summary) {
          var total = summary.totalCritical + summary.totalHigh + summary.totalMedium + summary.totalLow;
          if (total > 0) {
            var critPct = (summary.totalCritical / total * 100).toFixed(0);
            var highPct = (summary.totalHigh / total * 100).toFixed(0);
            var medPct = (summary.totalMedium / total * 100).toFixed(0);
            var lowPct = (summary.totalLow / total * 100).toFixed(0);

            severityCard.innerHTML =
              '<div class="severity-bar-row">' +
              '<span class="severity-label">Critical</span>' +
              '<div class="severity-bar"><div class="severity-fill critical" style="width: ' + critPct + '%;"></div></div>' +
              '<span class="severity-count">' + summary.totalCritical + '</span>' +
              '</div>' +
              '<div class="severity-bar-row">' +
              '<span class="severity-label">High</span>' +
              '<div class="severity-bar"><div class="severity-fill high" style="width: ' + highPct + '%;"></div></div>' +
              '<span class="severity-count">' + summary.totalHigh + '</span>' +
              '</div>' +
              '<div class="severity-bar-row">' +
              '<span class="severity-label">Medium</span>' +
              '<div class="severity-bar"><div class="severity-fill medium" style="width: ' + medPct + '%;"></div></div>' +
              '<span class="severity-count">' + summary.totalMedium + '</span>' +
              '</div>' +
              '<div class="severity-bar-row">' +
              '<span class="severity-label">Low</span>' +
              '<div class="severity-bar"><div class="severity-fill low" style="width: ' + lowPct + '%;"></div></div>' +
              '<span class="severity-count">' + summary.totalLow + '</span>' +
              '</div>';
          } else {
            severityCard.innerHTML = '<p class="empty-text">No severity data</p>';
          }
        }

        // Trend card
        var trendCard = document.querySelector('#trendCard');
        if (drifts && drifts.length > 0) {
          var avgDrift = drifts.reduce(function(sum, d) { return sum + d.driftPercentage; }, 0) / drifts.length;
          var trendLabel = avgDrift > 30 ? 'High' : avgDrift > 15 ? 'Moderate' : 'Low';
          var trendClass = avgDrift > 30 ? 'trend-high' : avgDrift > 15 ? 'trend-medium' : 'trend-low';
          trendCard.querySelector('.insight-value').textContent = trendLabel;
          trendCard.querySelector('.insight-value').className = 'insight-value ' + trendClass;
          trendCard.querySelector('.insight-detail').textContent = avgDrift.toFixed(1) + '% average drift';
        } else {
          trendCard.querySelector('.insight-value').textContent = '-';
          trendCard.querySelector('.insight-detail').textContent = '-';
        }
      }

      // ======================================================================
      // Utility Functions
      // ======================================================================
      function truncateText(text, maxLength) {
        if (!text) { return ''; }
        if (text.length <= maxLength) { return text; }
        return text.slice(0, maxLength - 2) + '..';
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
        if (componentFilter.value) { filters.component = componentFilter.value; }
        if (severityFilter.value) { filters.severity = severityFilter.value; }
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
          type: 'requestDriftData',
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
          if (heatMapData && heatMapData.components.length > 0) {
            renderHeatMap(heatMapData);
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
