/**
 * HTML content generator for the Knowledge Concentration dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Interactive treemap: rectangles sized by LOC, colored by risk
 * - Nested grouping by module then file
 * - Tooltips with contributor details and bus factor
 * - Click to open file or filter by contributor
 * - Zoom into module on click, breadcrumb to zoom out
 * - Risk filter toggles visibility
 * - Contributor search/filter
 * - Summary panel with risk breakdown
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-904
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the knowledge concentration HTML.
 */
export interface KnowledgeHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the knowledge concentration CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Knowledge Concentration dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateKnowledgeHtml(config: KnowledgeHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Knowledge Concentration</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Knowledge Concentration</h1>
      <div class="controls">
        <div class="filter-group">
          <label for="repoFilter">Repository</label>
          <select id="repoFilter" aria-label="Repository filter" tabindex="0">
            <option value="">All Repositories</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="riskFilter">Concentration Risk</label>
          <select id="riskFilter" aria-label="Concentration risk filter" tabindex="0">
            <option value="">All Risks</option>
            <option value="critical">Critical (>=90%)</option>
            <option value="high">High (>=80%)</option>
            <option value="medium">Medium (>=60%)</option>
            <option value="low">Low (<60%)</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="contributorFilter">Contributor</label>
          <select id="contributorFilter" aria-label="Contributor filter" tabindex="0">
            <option value="">All Contributors</option>
          </select>
        </div>
        <button class="action-btn" id="applyFilterBtn" aria-label="Apply filters" tabindex="0">Apply</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="breadcrumb" class="breadcrumb" role="navigation" aria-label="Treemap navigation">
      <span class="breadcrumb-item active" data-level="root">All Files</span>
    </div>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading knowledge concentration data...</span>
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
          <p>This treemap visualizes code ownership concentration, with tile size representing file size and color indicating concentration risk. Red tiles indicate files with high single-contributor ownership (bus factor risk). Use this to identify knowledge silos and prioritize cross-training efforts.</p>
        </div>
      </details>
      <div id="legendContainer" class="chart-legend treemap-legend" role="img" aria-label="Concentration risk legend"></div>
      <div class="chart-svg-container" role="img" aria-label="Treemap showing file ownership concentration">
        <svg id="chartSvg"></svg>
      </div>
      <div class="chart-instructions">
        <p>Click a file to open it. Click contributor name to filter. Click module to zoom in. Use breadcrumb to zoom out. Hover for details.</p>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div id="atRiskContainer" class="at-risk-container" style="display:none;">
      <h2>At-Risk Departures</h2>
      <p class="at-risk-description">Contributors who own many critical files (high knowledge concentration)</p>
      <table class="data-table" id="atRiskTable">
        <thead>
          <tr>
            <th scope="col">Contributor</th>
            <th scope="col">Critical Files</th>
            <th scope="col">High Risk Files</th>
            <th scope="col">Total Files</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody id="atRiskTableBody"></tbody>
      </table>
    </div>

    <div class="data-table-container" id="dataTableContainer" style="display:none;">
      <button class="data-table-toggle" id="toggleTableBtn" aria-expanded="false" tabindex="0">
        Show all files
      </button>
      <div id="dataTableWrapper" style="display:none;" role="region" aria-label="File ownership data table">
        <table class="data-table" id="dataTable">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Repository</th>
              <th scope="col">Top Owner</th>
              <th scope="col">Ownership %</th>
              <th scope="col">Bus Factor</th>
              <th scope="col">Contributors</th>
              <th scope="col">Risk</th>
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
      var uniqueContributors = [];
      var currentZoomPath = null;

      // Concentration risk colors (colorblind-accessible palette)
      var RISK_COLORS = {
        critical: '#dc2626',  // red-600
        high: '#ea580c',      // orange-600
        medium: '#ca8a04',    // yellow-600
        low: '#16a34a',       // green-600
      };

      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('applyFilterBtn');
      var repoFilter = document.getElementById('repoFilter');
      var riskFilter = document.getElementById('riskFilter');
      var contributorFilter = document.getElementById('contributorFilter');
      var breadcrumb = document.getElementById('breadcrumb');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var summaryStats = document.getElementById('summaryStats');
      var legendContainer = document.getElementById('legendContainer');
      var toggleTableBtn = document.getElementById('toggleTableBtn');
      var dataTableWrapper = document.getElementById('dataTableWrapper');
      var dataTableContainer = document.getElementById('dataTableContainer');
      var atRiskContainer = document.getElementById('atRiskContainer');
      var tooltip = document.getElementById('tooltip');

      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', function() {
        if (!chartData || chartData.length === 0) { return; }
        var headers = ['File Path', 'Repository', 'Top Contributor', 'Top Contributor %',
                       'Second Contributor', 'Second Contributor %', 'Bus Factor',
                       'Total Contributors', 'Total Commits', 'Concentration Risk'];
        var rows = chartData.map(function(d) {
          return [d.filePath, d.repository, d.topContributor, d.topContributorPct,
                  d.secondContributor || '', d.secondContributorPct || '',
                  d.busFactor, d.totalContributors, d.totalCommits, d.concentrationRisk];
        });
        exportCsvFromData(headers, rows, 'knowledge-concentration.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        currentZoomPath = null;
        updateBreadcrumb(null);
        requestData();
      });

      toggleTableBtn.addEventListener('click', function() {
        var isExpanded = toggleTableBtn.getAttribute('aria-expanded') === 'true';
        toggleTableBtn.setAttribute('aria-expanded', String(!isExpanded));
        toggleTableBtn.textContent = isExpanded ? 'Show all files' : 'Hide all files';
        dataTableWrapper.style.display = isExpanded ? 'none' : 'block';
      });

      // ======================================================================
      // Message Handling
      // ======================================================================
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'fileOwnershipData':
            handleFileOwnershipData(message);
            break;
          case 'repositories':
            handleRepositories(message.repositories);
            break;
          case 'contributors':
            handleContributors(message.contributors);
            break;
          case 'knowledgeError':
            showError(escapeHtml(message.message));
            break;
          case 'knowledgeLoading':
            if (message.isLoading) { showLoading(); } else { hideLoading(); }
            break;
        }
      });

      function handleFileOwnershipData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Knowledge Concentration View Not Available',
            'The vw_knowledge_concentration database view has not been created yet. Run the database migration (014) to enable this chart.'
          );
          return;
        }

        if (!message.rows || message.rows.length === 0) {
          showEmpty(
            'No Knowledge Concentration Data Available',
            'No files with contributor data found. Run the pipeline to analyze your repositories.'
          );
          return;
        }

        chartData = message.rows;
        renderTreemap(chartData);
        renderSummaryStats(chartData);
        renderLegend();
        renderAtRiskTable(chartData);
        renderDataTable(chartData);
        chartArea.style.display = 'block';
        atRiskContainer.style.display = 'block';
        dataTableContainer.style.display = 'block';
      }

      function handleRepositories(repos) {
        uniqueRepos = repos || [];
        populateRepoFilter();
      }

      function handleContributors(contribs) {
        uniqueContributors = contribs || [];
        populateContributorFilter();
      }

      // ======================================================================
      // Populate Filters
      // ======================================================================
      function populateRepoFilter() {
        var currentValue = repoFilter.value;
        while (repoFilter.options.length > 1) {
          repoFilter.remove(1);
        }
        uniqueRepos.forEach(function(repo) {
          var option = document.createElement('option');
          option.value = repo;
          option.textContent = repo;
          repoFilter.appendChild(option);
        });
        if (currentValue && uniqueRepos.indexOf(currentValue) !== -1) {
          repoFilter.value = currentValue;
        }
      }

      function populateContributorFilter() {
        var currentValue = contributorFilter.value;
        while (contributorFilter.options.length > 1) {
          contributorFilter.remove(1);
        }
        uniqueContributors.forEach(function(contrib) {
          var option = document.createElement('option');
          option.value = contrib;
          option.textContent = contrib;
          contributorFilter.appendChild(option);
        });
        if (currentValue && uniqueContributors.indexOf(currentValue) !== -1) {
          contributorFilter.value = currentValue;
        }
      }

      // ======================================================================
      // Treemap Rendering with D3.js
      // ======================================================================
      function renderTreemap(data) {
        if (!data || data.length === 0) { return; }

        // Chart dimensions
        var containerWidth = Math.max(600, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var height = 500;

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Treemap: File size represents LOC, color represents concentration risk');

        // Build hierarchical data structure
        var hierarchyData = buildHierarchy(data, currentZoomPath);

        // Create treemap layout
        var root = d3.hierarchy(hierarchyData)
          .sum(function(d) { return d.loc || 0; })
          .sort(function(a, b) { return b.value - a.value; });

        d3.treemap()
          .size([width, height])
          .paddingOuter(2)
          .paddingInner(1)
          .paddingTop(18)
          .round(true)(root);

        // Render groups (modules)
        var groups = svg.selectAll('g.module')
          .data(root.children || [])
          .enter()
          .append('g')
          .attr('class', 'module')
          .attr('transform', function(d) { return 'translate(' + d.x0 + ',' + d.y0 + ')'; });

        // Module background
        groups.append('rect')
          .attr('width', function(d) { return d.x1 - d.x0; })
          .attr('height', function(d) { return d.y1 - d.y0; })
          .attr('fill', 'var(--vscode-panel-border, #333)')
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('cursor', 'pointer')
          .on('click', function(event, d) {
            if (d.data.name !== '_root' && d.children) {
              zoomTo(d.data.path || d.data.name);
            }
          });

        // Module label
        groups.append('text')
          .attr('x', 4)
          .attr('y', 12)
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px')
          .attr('font-weight', '600')
          .text(function(d) {
            var maxWidth = (d.x1 - d.x0) - 8;
            return truncateText(d.data.name, maxWidth, 10);
          });

        // Render file rectangles within each group
        groups.each(function(group) {
          var g = d3.select(this);
          var leaves = group.leaves();

          leaves.forEach(function(leaf) {
            var fileData = leaf.data;
            if (!fileData.filePath) { return; }

            var rx = leaf.x0 - group.x0;
            var ry = leaf.y0 - group.y0;
            var rw = leaf.x1 - leaf.x0;
            var rh = leaf.y1 - leaf.y0;

            if (rw < 3 || rh < 3) { return; } // Skip tiny rectangles

            var color = RISK_COLORS[fileData.concentrationRisk] || '#888';

            // File rectangle
            g.append('rect')
              .attr('x', rx)
              .attr('y', ry)
              .attr('width', rw)
              .attr('height', rh)
              .attr('fill', color)
              .attr('fill-opacity', 0.75)
              .attr('stroke', color)
              .attr('stroke-width', 0.5)
              .attr('cursor', 'pointer')
              .attr('tabindex', '0')
              .attr('role', 'button')
              .attr('aria-label', escapeHtml(fileData.filePath) + ': ' + fileData.topContributorPct + '% owned by ' + escapeHtml(fileData.topContributor))
              .on('mouseover', function(event) {
                showTooltip(event, fileData);
              })
              .on('mousemove', function(event) { moveTooltip(event); })
              .on('mouseout', hideTooltip)
              .on('click', function() {
                openFile(fileData.filePath, fileData.repository);
              })
              .on('keydown', function(event) {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openFile(fileData.filePath, fileData.repository);
                }
              });

            // File label (if rectangle is big enough)
            if (rw > 40 && rh > 20) {
              var fileName = fileData.filePath.split('/').pop();
              var initials = getInitials(fileData.topContributor);
              var labelText = truncateText(fileName, rw - 8, 9) + ' [' + initials + ']';

              g.append('text')
                .attr('x', rx + 4)
                .attr('y', ry + 12)
                .attr('fill', '#fff')
                .attr('font-size', '9px')
                .attr('pointer-events', 'none')
                .text(labelText);
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
      // Hierarchy Builder
      // ======================================================================
      function buildHierarchy(data, zoomPath) {
        var root = { name: '_root', children: [] };
        var moduleMap = {};

        data.forEach(function(file) {
          var pathParts = file.filePath.split('/');
          var modulePath = pathParts.length > 2
            ? pathParts.slice(0, 2).join('/')
            : pathParts[0];

          // If zoomed, filter to matching module
          if (zoomPath && !file.filePath.startsWith(zoomPath + '/') && modulePath !== zoomPath) {
            return;
          }

          if (!moduleMap[modulePath]) {
            moduleMap[modulePath] = {
              name: modulePath,
              path: modulePath,
              children: [],
            };
            root.children.push(moduleMap[modulePath]);
          }

          moduleMap[modulePath].children.push({
            name: pathParts[pathParts.length - 1],
            filePath: file.filePath,
            repository: file.repository,
            loc: file.totalCommits * 10 || 100, // Use commits as proxy for LOC
            topContributor: file.topContributor,
            topContributorPct: file.topContributorPct,
            topContributorLastActive: file.topContributorLastActive,
            secondContributor: file.secondContributor,
            secondContributorPct: file.secondContributorPct,
            busFactor: file.busFactor,
            totalContributors: file.totalContributors,
            totalCommits: file.totalCommits,
            concentrationRisk: file.concentrationRisk,
          });
        });

        return root;
      }

      // ======================================================================
      // Zoom Navigation
      // ======================================================================
      function zoomTo(path) {
        currentZoomPath = path;
        updateBreadcrumb(path);
        renderTreemap(chartData);
      }

      function updateBreadcrumb(path) {
        breadcrumb.innerHTML = '';

        var rootItem = document.createElement('span');
        rootItem.className = 'breadcrumb-item' + (path ? '' : ' active');
        rootItem.textContent = 'All Files';
        rootItem.setAttribute('tabindex', '0');
        rootItem.setAttribute('role', 'button');
        rootItem.onclick = function() { zoomTo(null); };
        rootItem.onkeydown = function(e) {
          if (e.key === 'Enter' || e.key === ' ') { zoomTo(null); }
        };
        breadcrumb.appendChild(rootItem);

        if (path) {
          var sep = document.createElement('span');
          sep.className = 'breadcrumb-separator';
          sep.textContent = ' > ';
          breadcrumb.appendChild(sep);

          var pathItem = document.createElement('span');
          pathItem.className = 'breadcrumb-item active';
          pathItem.textContent = path;
          breadcrumb.appendChild(pathItem);
        }
      }

      // ======================================================================
      // Tooltip
      // ======================================================================
      function showTooltip(event, d) {
        var secondOwnerInfo = '';
        if (d.secondContributor) {
          secondOwnerInfo = '<div class="tt-secondary">' + escapeHtml(d.secondContributor) + ': ' +
            d.secondContributorPct + '%</div>';
        }

        var busFactor = d.busFactor;
        var busFactorWarning = busFactor === 1 ? ' <span class="bus-factor-warning">Warning</span>' : '';

        tooltip.innerHTML =
          '<div class="tt-component"><strong>' + escapeHtml(d.filePath) + '</strong></div>' +
          '<div class="tt-repo">Repository: ' + escapeHtml(d.repository) + '</div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-section-title">Contributors:</div>' +
          '<div class="tt-primary"><span class="owner-label">TOP</span> ' +
            escapeHtml(d.topContributor) + ': ' + d.topContributorPct + '% (' + d.totalCommits + ' commits)</div>' +
          secondOwnerInfo +
          '<hr class="tt-divider">' +
          '<div class="tt-value">Bus Factor: ' + busFactor + busFactorWarning + '</div>' +
          '<div class="tt-value">Total Contributors: ' + d.totalContributors + '</div>' +
          '<div class="tt-value">Last Active: ' + escapeHtml(d.topContributorLastActive) + '</div>' +
          '<div class="tt-tier tt-tier-' + escapeHtml(d.concentrationRisk) + '">Risk: ' +
            escapeHtml(d.concentrationRisk.toUpperCase()) + '</div>' +
          '<div class="tt-action">[Click to open file] [Click owner name to filter]</div>';
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
      // Utility Functions
      // ======================================================================
      function truncateText(text, maxWidth, fontSize) {
        if (!text) { return ''; }
        var avgCharWidth = fontSize * 0.6;
        var maxChars = Math.floor(maxWidth / avgCharWidth);
        if (text.length <= maxChars) { return text; }
        return text.slice(0, maxChars - 3) + '...';
      }

      function getInitials(name) {
        if (!name) { return '??'; }
        var parts = name.split(/[\\s._-]+/);
        if (parts.length === 1) {
          return name.slice(0, 2).toUpperCase();
        }
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }

      // ======================================================================
      // File Actions
      // ======================================================================
      function openFile(filePath, repository) {
        vscode.postMessage({ type: 'openFile', filePath: filePath, repository: repository });
      }

      window.filterByContributor = function(contributor) {
        contributorFilter.value = contributor;
        vscode.postMessage({ type: 'filterByContributor', contributor: contributor });
      };

      // ======================================================================
      // Legend
      // ======================================================================
      function renderLegend() {
        legendContainer.innerHTML = '';

        var risks = ['critical', 'high', 'medium', 'low'];
        var riskLabels = {
          critical: 'Critical (>=90% ownership)',
          high: 'High (>=80%)',
          medium: 'Medium (>=60%)',
          low: 'Low (<60%)',
        };

        risks.forEach(function(risk) {
          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = RISK_COLORS[risk];
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.textContent = riskLabels[risk];
          item.appendChild(label);

          legendContainer.appendChild(item);
        });

        var sizeNote = document.createElement('div');
        sizeNote.className = 'legend-note';
        sizeNote.textContent = 'Rectangle size = Relative commit activity';
        legendContainer.appendChild(sizeNote);
      }

      // ======================================================================
      // Summary Stats
      // ======================================================================
      function renderSummaryStats(data) {
        var totalFiles = data.length;
        var riskCounts = { critical: 0, high: 0, medium: 0, low: 0 };
        var lowBusFactorCount = 0;

        data.forEach(function(d) {
          if (riskCounts[d.concentrationRisk] !== undefined) {
            riskCounts[d.concentrationRisk]++;
          }
          if (d.busFactor === 1) {
            lowBusFactorCount++;
          }
        });

        summaryStats.innerHTML =
          createStatCard(totalFiles.toLocaleString(), 'Total Files') +
          createStatCard(riskCounts.critical.toString(), 'Critical', 'critical') +
          createStatCard(riskCounts.high.toString(), 'High', 'high') +
          createStatCard(riskCounts.medium.toString(), 'Medium', 'medium') +
          createStatCard(riskCounts.low.toString(), 'Low', 'low') +
          createStatCard(lowBusFactorCount.toLocaleString(), 'Bus Factor = 1');
      }

      function createStatCard(value, label, tierClass) {
        var tierStyle = tierClass ? ' style="border-left: 4px solid ' + RISK_COLORS[tierClass] + ';"' : '';
        return '<div class="stat-card"' + tierStyle + '><div class="stat-value">' +
          escapeHtml(String(value)) + '</div><div class="stat-label">' +
          escapeHtml(label) + '</div></div>';
      }

      // ======================================================================
      // At-Risk Table (Contributors with high ownership)
      // ======================================================================
      function renderAtRiskTable(data) {
        var contributorStats = {};

        data.forEach(function(d) {
          var contrib = d.topContributor;
          if (!contributorStats[contrib]) {
            contributorStats[contrib] = { critical: 0, high: 0, total: 0 };
          }
          contributorStats[contrib].total++;
          if (d.concentrationRisk === 'critical') {
            contributorStats[contrib].critical++;
          } else if (d.concentrationRisk === 'high') {
            contributorStats[contrib].high++;
          }
        });

        // Filter to at-risk (critical + high > 0) and sort by critical desc
        var atRisk = Object.keys(contributorStats)
          .map(function(k) {
            return {
              contributor: k,
              critical: contributorStats[k].critical,
              high: contributorStats[k].high,
              total: contributorStats[k].total,
            };
          })
          .filter(function(c) { return c.critical > 0 || c.high > 0; })
          .sort(function(a, b) { return (b.critical + b.high) - (a.critical + a.high); })
          .slice(0, 10);

        var tbody = document.getElementById('atRiskTableBody');
        tbody.innerHTML = '';

        if (atRisk.length === 0) {
          atRiskContainer.style.display = 'none';
          return;
        }

        atRiskContainer.style.display = 'block';

        atRisk.forEach(function(c) {
          var tr = document.createElement('tr');

          var tdContrib = document.createElement('td');
          tdContrib.textContent = c.contributor;
          tr.appendChild(tdContrib);

          var tdCritical = document.createElement('td');
          tdCritical.textContent = String(c.critical);
          tdCritical.className = c.critical > 0 ? 'tier-critical' : '';
          tr.appendChild(tdCritical);

          var tdHigh = document.createElement('td');
          tdHigh.textContent = String(c.high);
          tdHigh.className = c.high > 0 ? 'tier-high' : '';
          tr.appendChild(tdHigh);

          var tdTotal = document.createElement('td');
          tdTotal.textContent = String(c.total);
          tr.appendChild(tdTotal);

          var tdActions = document.createElement('td');
          var filterLink = document.createElement('a');
          filterLink.href = '#';
          filterLink.textContent = 'Show Files';
          filterLink.onclick = function(e) {
            e.preventDefault();
            window.filterByContributor(c.contributor);
          };
          tdActions.appendChild(filterLink);
          tr.appendChild(tdActions);

          tbody.appendChild(tr);
        });
      }

      // ======================================================================
      // Full Data Table
      // ======================================================================
      function renderDataTable(data) {
        var tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';
        data.forEach(function(d) {
          var tr = document.createElement('tr');

          var tdFile = document.createElement('td');
          var fileLink = document.createElement('a');
          fileLink.href = '#';
          fileLink.textContent = truncateText(d.filePath, 300, 12);
          fileLink.title = d.filePath;
          fileLink.onclick = function(e) { e.preventDefault(); openFile(d.filePath, d.repository); };
          tdFile.appendChild(fileLink);
          tr.appendChild(tdFile);

          var tdRepo = document.createElement('td');
          tdRepo.textContent = d.repository;
          tr.appendChild(tdRepo);

          var tdOwner = document.createElement('td');
          var ownerLink = document.createElement('a');
          ownerLink.href = '#';
          ownerLink.textContent = d.topContributor;
          ownerLink.onclick = function(e) { e.preventDefault(); window.filterByContributor(d.topContributor); };
          tdOwner.appendChild(ownerLink);
          tr.appendChild(tdOwner);

          var tdPct = document.createElement('td');
          tdPct.textContent = d.topContributorPct + '%';
          tr.appendChild(tdPct);

          var tdBus = document.createElement('td');
          tdBus.textContent = String(d.busFactor);
          if (d.busFactor === 1) {
            tdBus.className = 'bus-factor-1';
          }
          tr.appendChild(tdBus);

          var tdContribs = document.createElement('td');
          tdContribs.textContent = String(d.totalContributors);
          tr.appendChild(tdContribs);

          var tdRisk = document.createElement('td');
          tdRisk.textContent = d.concentrationRisk.toUpperCase();
          tdRisk.className = 'tier-' + d.concentrationRisk;
          tr.appendChild(tdRisk);

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
        atRiskContainer.style.display = 'none';
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
          type: 'requestFileOwnershipData',
          repository: repoFilter.value || undefined,
          concentrationRisk: riskFilter.value || undefined,
          contributor: contributorFilter.value || undefined,
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
