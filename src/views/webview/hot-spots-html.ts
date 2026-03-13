/**
 * HTML content generator for the Hot Spots dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Interactive bubble chart: X=complexity, Y=churn
 * - Bubble size = LOC, bubble color = risk tier
 * - Quadrant background zones for visual interpretation
 * - Tooltips with file details, contributors, and bug count
 * - Click to open file, view history, or view bugs
 * - Filters for risk tier and repository
 * - Summary panel with tier counts and top 5 hot spots
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-902
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the hot spots chart HTML.
 */
export interface HotSpotsHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the hot spots CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Hot Spots dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateHotSpotsHtml(config: HotSpotsHtmlConfig): string {
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
    See CSP documentation comments in hot-spots-html.ts for full security model explanation.
  -->
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Hot Spots</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Hot Spots</h1>
      <div class="controls">
        <div class="filter-group">
          <label for="repoFilter">Repository</label>
          <select id="repoFilter" aria-label="Repository filter" tabindex="0">
            <option value="">All Repositories</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="riskTierFilter">Risk Tier</label>
          <select id="riskTierFilter" aria-label="Risk tier filter" tabindex="0">
            <option value="">All Tiers</option>
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
      <span class="loading-text">Loading hot spots data...</span>
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
          <p>This bubble chart plots files by complexity (X-axis) versus code churn (Y-axis). Bubble size represents lines of code, and color indicates risk tier. Files in the upper-right quadrant are high-complexity, high-churn hot spots that should be prioritized for refactoring. Click any bubble to open the file directly.</p>
        </div>
      </details>
      <div class="quadrant-legend">
        <span class="quadrant-label green-zone">Low Risk (stable)</span>
        <span class="quadrant-label yellow-zone">Moderate Risk</span>
        <span class="quadrant-label orange-zone">High Risk</span>
        <span class="quadrant-label red-zone">Critical (refactor urgently)</span>
      </div>
      <div id="legendContainer" class="chart-legend bubble-legend" role="img" aria-label="Risk tier legend"></div>
      <div class="chart-svg-container" role="img" aria-label="Bubble chart showing file complexity vs churn">
        <svg id="chartSvg"></svg>
      </div>
      <div class="chart-instructions">
        <p>Click a bubble to open the file. Right-click for history. Hover for details. Use Tab/Enter for keyboard navigation.</p>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div id="top5Container" class="top5-container" style="display:none;">
      <h2>Top 5 Hot Spots</h2>
      <table class="data-table" id="top5Table">
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col">Repository</th>
            <th scope="col">Churn</th>
            <th scope="col">Complexity</th>
            <th scope="col">LOC</th>
            <th scope="col">Bugs</th>
            <th scope="col">Risk</th>
          </tr>
        </thead>
        <tbody id="top5TableBody"></tbody>
      </table>
    </div>

    <div class="data-table-container" id="dataTableContainer" style="display:none;">
      <button class="data-table-toggle" id="toggleTableBtn" aria-expanded="false" tabindex="0">
        Show all hot spots
      </button>
      <div id="dataTableWrapper" style="display:none;" role="region" aria-label="Hot spots data table">
        <table class="data-table" id="dataTable">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Repository</th>
              <th scope="col">Churn</th>
              <th scope="col">Complexity</th>
              <th scope="col">LOC</th>
              <th scope="col">Bugs</th>
              <th scope="col">Contributors</th>
              <th scope="col">Last Changed</th>
              <th scope="col">Risk Tier</th>
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
      var uniqueRepos = [];

      // Risk tier colors (colorblind-accessible palette)
      var TIER_COLORS = {
        critical: '#e63946',  // red
        high: '#f67019',      // orange
        medium: '#f9c74f',    // yellow
        low: '#2a9d8f',       // teal
      };

      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('applyFilterBtn');
      var repoFilter = document.getElementById('repoFilter');
      var riskTierFilter = document.getElementById('riskTierFilter');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var summaryStats = document.getElementById('summaryStats');
      var legendContainer = document.getElementById('legendContainer');
      var toggleTableBtn = document.getElementById('toggleTableBtn');
      var dataTableWrapper = document.getElementById('dataTableWrapper');
      var dataTableContainer = document.getElementById('dataTableContainer');
      var top5Container = document.getElementById('top5Container');
      var tooltip = document.getElementById('tooltip');

      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', function() {
        if (!chartData || chartData.length === 0) { return; }
        var headers = ['File Path', 'Repository', 'Churn', 'Complexity', 'LOC', 'Bug Count',
                       'Contributors', 'Last Changed', 'Risk Score', 'Risk Tier'];
        var rows = chartData.map(function(d) {
          return [d.filePath, d.repository, d.churnCount, d.complexity, d.loc,
                  d.bugCount, d.contributorCount, d.lastChanged, d.riskScore, d.riskTier];
        });
        exportCsvFromData(headers, rows, 'hot-spots.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        requestData();
      });

      toggleTableBtn.addEventListener('click', function() {
        var isExpanded = toggleTableBtn.getAttribute('aria-expanded') === 'true';
        toggleTableBtn.setAttribute('aria-expanded', String(!isExpanded));
        toggleTableBtn.textContent = isExpanded ? 'Show all hot spots' : 'Hide all hot spots';
        dataTableWrapper.style.display = isExpanded ? 'none' : 'block';
      });

      // ======================================================================
      // Message Handling
      // ======================================================================
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'hotSpotsData':
            handleHotSpotsData(message);
            break;
          case 'repositories':
            handleRepositories(message.repositories);
            break;
          case 'hotSpotsError':
            showError(escapeHtml(message.message));
            break;
          case 'hotSpotsLoading':
            if (message.isLoading) { showLoading(); } else { hideLoading(); }
            break;
        }
      });

      function handleHotSpotsData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Hot Spots View Not Available',
            'The vw_hot_spots database view has not been created yet. Run the database migration (013) to enable this chart.'
          );
          return;
        }

        if (!message.rows || message.rows.length === 0) {
          showEmpty(
            'No Hot Spots Data Available',
            'No files with churn and complexity data found. Run the pipeline to analyze your repositories.'
          );
          return;
        }

        chartData = message.rows;
        renderChart(chartData);
        renderSummaryStats(chartData);
        renderLegend();
        renderTop5Table(chartData.slice(0, 5));
        renderDataTable(chartData);
        chartArea.style.display = 'block';
        top5Container.style.display = 'block';
        dataTableContainer.style.display = 'block';
      }

      function handleRepositories(repos) {
        uniqueRepos = repos || [];
        populateRepoFilter();
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
      // Bubble Chart Rendering with D3.js
      // ======================================================================
      function renderChart(data) {
        if (!data || data.length === 0) { return; }

        // Chart dimensions
        var margin = { top: 40, right: 40, bottom: 60, left: 80 };
        var containerWidth = Math.max(600, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var height = 500;

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Bubble chart: File complexity (X) vs churn count (Y)');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        // X Scale: Complexity (log scale for wide range)
        var xExtent = d3.extent(data, function(d) { return Math.max(1, d.complexity); });
        var x = d3.scaleLog()
          .domain([Math.max(1, xExtent[0] * 0.5), Math.max(10, xExtent[1] * 1.5)])
          .range([0, innerWidth])
          .nice();

        // Y Scale: Churn count (linear)
        var yMax = d3.max(data, function(d) { return d.churnCount; }) || 1;
        var y = d3.scaleLinear()
          .domain([0, yMax * 1.1])
          .nice()
          .range([innerHeight, 0]);

        // Bubble size scale: LOC
        var locExtent = d3.extent(data, function(d) { return Math.max(1, d.loc); });
        var rScale = d3.scaleSqrt()
          .domain([0, locExtent[1]])
          .range([4, 24]);

        // ---- Quadrant Zones (visual guide) ----
        var medianComplexity = d3.median(data, function(d) { return d.complexity; }) || 10;
        var medianChurn = d3.median(data, function(d) { return d.churnCount; }) || 5;

        // Green zone: low complexity, low churn (bottom-left)
        g.append('rect')
          .attr('x', 0)
          .attr('y', y(medianChurn))
          .attr('width', x(medianComplexity))
          .attr('height', innerHeight - y(medianChurn))
          .attr('fill', '#2a9d8f')
          .attr('fill-opacity', 0.08);

        // Yellow zone: high complexity, low churn (bottom-right)
        g.append('rect')
          .attr('x', x(medianComplexity))
          .attr('y', y(medianChurn))
          .attr('width', innerWidth - x(medianComplexity))
          .attr('height', innerHeight - y(medianChurn))
          .attr('fill', '#f9c74f')
          .attr('fill-opacity', 0.08);

        // Orange zone: low complexity, high churn (top-left)
        g.append('rect')
          .attr('x', 0)
          .attr('y', 0)
          .attr('width', x(medianComplexity))
          .attr('height', y(medianChurn))
          .attr('fill', '#f67019')
          .attr('fill-opacity', 0.08);

        // Red zone: high complexity, high churn (top-right) - REFACTOR URGENTLY
        g.append('rect')
          .attr('x', x(medianComplexity))
          .attr('y', 0)
          .attr('width', innerWidth - x(medianComplexity))
          .attr('height', y(medianChurn))
          .attr('fill', '#e63946')
          .attr('fill-opacity', 0.08);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(y).tickSize(-innerWidth).tickFormat(''))
          .selectAll('line').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // ---- X Axis (Complexity - Log Scale) ----
        g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(x)
            .tickValues([1, 5, 10, 25, 50, 100, 250, 500])
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
          .text('Cyclomatic Complexity (log scale)');

        // ---- Y Axis (Churn Count) ----
        g.append('g').attr('class', 'axis')
          .call(d3.axisLeft(y).ticks(8));

        // Y Axis Label
        g.append('text').attr('transform', 'rotate(-90)')
          .attr('y', -60).attr('x', -innerHeight / 2).attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #cccccc)').attr('font-size', '12px')
          .text('Churn (commits in last 90 days)');

        // ---- Data Points (Bubbles) ----
        data.forEach(function(d, i) {
          var cx = x(Math.max(1, d.complexity));
          var cy = y(d.churnCount);
          var r = rScale(Math.max(1, d.loc));
          var color = TIER_COLORS[d.riskTier] || '#888';

          var circle = g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', r)
            .attr('fill', color)
            .attr('fill-opacity', 0.7)
            .attr('stroke', color)
            .attr('stroke-width', 1)
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', escapeHtml(d.filePath) + ': ' + d.churnCount + ' commits, complexity ' + d.complexity)
            .on('mouseover', function(event) {
              showTooltip(event, d);
            })
            .on('mousemove', function(event) { moveTooltip(event); })
            .on('mouseout', hideTooltip)
            .on('click', function() {
              openFile(d.filePath, d.repository);
            })
            .on('contextmenu', function(event) {
              event.preventDefault();
              viewHistory(d.filePath, d.repository);
            })
            .on('keydown', function(event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openFile(d.filePath, d.repository);
              }
            });
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
        var bugInfo = '';
        if (d.bugCount > 0) {
          bugInfo = '<div class="tt-bugs"><a href="#" onclick="viewBugs(\\'' +
            escapeHtml(d.filePath) + '\\', \\'' + escapeHtml(d.repository) + '\\', ' + d.bugCount + '); return false;">' +
            d.bugCount + ' bug ticket' + (d.bugCount === 1 ? '' : 's') + '</a></div>';
        }

        tooltip.innerHTML =
          '<div class="tt-component"><strong>' + escapeHtml(truncatePath(d.filePath, 50)) + '</strong></div>' +
          '<div class="tt-repo">Repository: ' + escapeHtml(d.repository) + '</div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-value">Churn: ' + d.churnCount + ' commits</div>' +
          '<div class="tt-value">Complexity: ' + d.complexity + '</div>' +
          '<div class="tt-value">LOC: ' + d.loc.toLocaleString() + '</div>' +
          '<div class="tt-value">Contributors: ' + d.contributorCount + '</div>' +
          '<div class="tt-value">Last Changed: ' + escapeHtml(d.lastChanged) + '</div>' +
          bugInfo +
          '<div class="tt-tier tt-tier-' + escapeHtml(d.riskTier) + '">Risk: ' +
            escapeHtml(d.riskTier.toUpperCase()) + ' (' + (d.riskScore * 100).toFixed(0) + '%)</div>' +
          '<div class="tt-action">[Click to open file] [Right-click for history]</div>';
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

      function truncatePath(path, maxLen) {
        if (path.length <= maxLen) { return path; }
        var parts = path.split('/');
        if (parts.length <= 2) { return '...' + path.slice(-maxLen + 3); }
        return parts[0] + '/.../' + parts[parts.length - 1];
      }

      // ======================================================================
      // File Actions
      // ======================================================================
      function openFile(filePath, repository) {
        vscode.postMessage({ type: 'openFile', filePath: filePath, repository: repository });
      }

      function viewHistory(filePath, repository) {
        vscode.postMessage({ type: 'viewHistory', filePath: filePath, repository: repository });
      }

      window.viewBugs = function(filePath, repository, bugCount) {
        vscode.postMessage({ type: 'viewBugs', filePath: filePath, repository: repository, bugCount: bugCount });
      };

      // ======================================================================
      // Legend
      // ======================================================================
      function renderLegend() {
        legendContainer.innerHTML = '';

        // Risk tier legend
        var tiers = ['critical', 'high', 'medium', 'low'];
        var tierLabels = {
          critical: 'Critical Risk',
          high: 'High Risk',
          medium: 'Medium Risk',
          low: 'Low Risk',
        };

        tiers.forEach(function(tier) {
          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = TIER_COLORS[tier];
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.textContent = tierLabels[tier];
          item.appendChild(label);

          legendContainer.appendChild(item);
        });

        // Bubble size legend
        var sizeNote = document.createElement('div');
        sizeNote.className = 'legend-note';
        sizeNote.textContent = 'Bubble size = Lines of code (larger = more LOC)';
        legendContainer.appendChild(sizeNote);
      }

      // ======================================================================
      // Summary Stats
      // ======================================================================
      function renderSummaryStats(data) {
        var totalFiles = data.length;
        var totalBugs = 0;
        var tierCounts = { critical: 0, high: 0, medium: 0, low: 0 };

        data.forEach(function(d) {
          totalBugs += d.bugCount;
          if (tierCounts[d.riskTier] !== undefined) {
            tierCounts[d.riskTier]++;
          }
        });

        summaryStats.innerHTML =
          createStatCard(totalFiles.toLocaleString(), 'Total Hot Spots') +
          createStatCard(tierCounts.critical.toString(), 'Critical', 'critical') +
          createStatCard(tierCounts.high.toString(), 'High', 'high') +
          createStatCard(tierCounts.medium.toString(), 'Medium', 'medium') +
          createStatCard(tierCounts.low.toString(), 'Low', 'low') +
          createStatCard(totalBugs.toLocaleString(), 'Total Bugs');
      }

      function createStatCard(value, label, tierClass) {
        var tierStyle = tierClass ? ' style="border-left: 4px solid ' + TIER_COLORS[tierClass] + ';"' : '';
        return '<div class="stat-card"' + tierStyle + '><div class="stat-value">' +
          escapeHtml(String(value)) + '</div><div class="stat-label">' +
          escapeHtml(label) + '</div></div>';
      }

      // ======================================================================
      // Top 5 Hot Spots Table
      // ======================================================================
      function renderTop5Table(data) {
        var tbody = document.getElementById('top5TableBody');
        tbody.innerHTML = '';
        data.forEach(function(d) {
          var tr = document.createElement('tr');
          tr.className = 'tier-row tier-' + d.riskTier;

          var tdFile = document.createElement('td');
          var fileLink = document.createElement('a');
          fileLink.href = '#';
          fileLink.textContent = truncatePath(d.filePath, 40);
          fileLink.title = d.filePath;
          fileLink.onclick = function(e) { e.preventDefault(); openFile(d.filePath, d.repository); };
          tdFile.appendChild(fileLink);
          tr.appendChild(tdFile);

          var tdRepo = document.createElement('td');
          tdRepo.textContent = d.repository;
          tr.appendChild(tdRepo);

          var tdChurn = document.createElement('td');
          tdChurn.textContent = String(d.churnCount);
          tr.appendChild(tdChurn);

          var tdComplexity = document.createElement('td');
          tdComplexity.textContent = String(d.complexity);
          tr.appendChild(tdComplexity);

          var tdLoc = document.createElement('td');
          tdLoc.textContent = d.loc.toLocaleString();
          tr.appendChild(tdLoc);

          var tdBugs = document.createElement('td');
          if (d.bugCount > 0) {
            var bugLink = document.createElement('a');
            bugLink.href = '#';
            bugLink.textContent = String(d.bugCount);
            bugLink.onclick = function(e) { e.preventDefault(); window.viewBugs(d.filePath, d.repository, d.bugCount); };
            tdBugs.appendChild(bugLink);
          } else {
            tdBugs.textContent = '0';
          }
          tr.appendChild(tdBugs);

          var tdRisk = document.createElement('td');
          tdRisk.textContent = d.riskTier.toUpperCase();
          tdRisk.className = 'tier-' + d.riskTier;
          tr.appendChild(tdRisk);

          tbody.appendChild(tr);
        });
      }

      // ======================================================================
      // Full Data Table (Accessibility Fallback)
      // ======================================================================
      function renderDataTable(data) {
        var tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';
        data.forEach(function(d) {
          var tr = document.createElement('tr');

          var tdFile = document.createElement('td');
          var fileLink = document.createElement('a');
          fileLink.href = '#';
          fileLink.textContent = truncatePath(d.filePath, 50);
          fileLink.title = d.filePath;
          fileLink.onclick = function(e) { e.preventDefault(); openFile(d.filePath, d.repository); };
          tdFile.appendChild(fileLink);
          tr.appendChild(tdFile);

          var tdRepo = document.createElement('td');
          tdRepo.textContent = d.repository;
          tr.appendChild(tdRepo);

          var tdChurn = document.createElement('td');
          tdChurn.textContent = String(d.churnCount);
          tr.appendChild(tdChurn);

          var tdComplexity = document.createElement('td');
          tdComplexity.textContent = String(d.complexity);
          tr.appendChild(tdComplexity);

          var tdLoc = document.createElement('td');
          tdLoc.textContent = d.loc.toLocaleString();
          tr.appendChild(tdLoc);

          var tdBugs = document.createElement('td');
          tdBugs.textContent = String(d.bugCount);
          tr.appendChild(tdBugs);

          var tdContrib = document.createElement('td');
          tdContrib.textContent = String(d.contributorCount);
          tr.appendChild(tdContrib);

          var tdLastChanged = document.createElement('td');
          tdLastChanged.textContent = d.lastChanged;
          tr.appendChild(tdLastChanged);

          var tdTier = document.createElement('td');
          tdTier.textContent = d.riskTier.toUpperCase();
          tdTier.className = 'tier-' + d.riskTier;
          tr.appendChild(tdTier);

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
        top5Container.style.display = 'none';
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
          type: 'requestHotSpotsData',
          repository: repoFilter.value || undefined,
          riskTier: riskTierFilter.value || undefined,
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
      requestData();

    })();
  </script>
</body>
</html>`;
}
