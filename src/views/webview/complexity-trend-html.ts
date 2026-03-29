/**
 * HTML content generator for the Complexity Trend chart webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Multi-series line chart comparing entities side-by-side (GITX-136)
 * - View Mode toggle tabs: By Contributor | By Team | By Repo | By Arch Layer
 * - Metric toggle: Average Complexity | Total Complexity
 * - Period toggle: Weekly | Monthly | Annual
 * - Top N dropdown and multi-select entity picker
 * - Pre-filters (team, contributor, repository, tech stack) applied before breakdown
 * - Interactive clickable legend for series toggling
 * - Tooltips, legend, CSV export, data table fallback
 * - ARIA accessibility and colorblind-accessible markers
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: GITX-133, GITX-134, GITX-136
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
    Content Security Policy - Strict webview security (GITX-133, GITX-134)
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
        <!-- Pre-filters (GITX-136: applied before viewMode breakdown) -->
        <div class="filter-group" id="teamFilterGroup">
          <label for="teamFilter">Team</label>
          <select id="teamFilter" aria-label="Team pre-filter" tabindex="0">
            <option value="">All Teams</option>
          </select>
        </div>
        <div class="filter-group" id="contributorFilterGroup">
          <label for="contributorFilter">Contributor</label>
          <select id="contributorFilter" aria-label="Contributor pre-filter" tabindex="0">
            <option value="">All Contributors</option>
          </select>
        </div>
        <div class="filter-group" id="repoFilterGroup">
          <label for="repoFilter">Repository</label>
          <select id="repoFilter" aria-label="Repository pre-filter" tabindex="0">
            <option value="">All Repositories</option>
          </select>
        </div>
        <div class="filter-group" id="techStackFilterGroup">
          <label for="techStackFilter">Arch Layer</label>
          <select id="techStackFilter" aria-label="Architectural layer pre-filter" tabindex="0">
            <option value="">All Layers</option>
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
        <button class="apply-btn" id="applyFiltersBtn" aria-label="Apply selected filters" tabindex="0">Apply</button>
        <button class="clear-btn" id="clearFiltersBtn" aria-label="Clear all filters" tabindex="0">Clear</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <!-- Chart Controls: View Mode, Metric, Period, Top N, Entity Picker (GITX-136) -->
    <div class="chart-controls">
      <!-- View Mode Toggle Tabs -->
      <div class="control-section">
        <span class="control-label">View Mode</span>
        <div class="tab-group" id="viewModeGroup" role="tablist" aria-label="Select chart grouping dimension">
          <button class="tab-btn active" data-value="contributor" role="tab" aria-selected="true" tabindex="0">By Contributor</button>
          <button class="tab-btn" data-value="team" role="tab" aria-selected="false" tabindex="-1">By Team</button>
          <button class="tab-btn" data-value="repository" role="tab" aria-selected="false" tabindex="-1">By Repo</button>
          <button class="tab-btn" data-value="archLayer" role="tab" aria-selected="false" tabindex="-1">By Arch Layer</button>
        </div>
      </div>

      <!-- Metric Toggle -->
      <div class="control-section">
        <span class="control-label">Metric</span>
        <div class="metric-toggle" id="metricToggleGroup" role="radiogroup" aria-label="Select complexity metric">
          <button class="metric-btn active" data-value="average" role="radio" aria-checked="true" tabindex="0">Average</button>
          <button class="metric-btn" data-value="total" role="radio" aria-checked="false" tabindex="-1">Total</button>
        </div>
      </div>

      <!-- Period Toggle -->
      <div class="control-section">
        <span class="control-label">Period</span>
        <div class="period-toggle" id="periodToggleGroup" role="radiogroup" aria-label="Select time period aggregation">
          <button class="period-btn active" data-value="weekly" role="radio" aria-checked="true" tabindex="0">Weekly</button>
          <button class="period-btn" data-value="monthly" role="radio" aria-checked="false" tabindex="-1">Monthly</button>
          <button class="period-btn" data-value="annual" role="radio" aria-checked="false" tabindex="-1">Annual</button>
        </div>
      </div>

      <!-- Top N Selection -->
      <div class="control-section topn-group">
        <label for="topNSelect" class="control-label">Top N</label>
        <select id="topNSelect" aria-label="Select number of entities to display" tabindex="0">
          <option value="5">Top 5</option>
          <option value="10" selected>Top 10</option>
          <option value="20">Top 20</option>
        </select>
      </div>

      <!-- Entity Multi-Select Picker -->
      <div class="control-section entity-select-group">
        <button class="entity-picker-toggle" id="entityPickerToggle" aria-expanded="false" aria-haspopup="listbox" tabindex="0">
          <span id="entityPickerLabel">Select Entities...</span>
          <svg class="picker-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="entity-picker-panel" id="entityPickerPanel" role="listbox" aria-multiselectable="true" style="display: none;">
          <div class="entity-picker-header">
            <button class="entity-picker-action" id="entitySelectAll" tabindex="0">Select All</button>
            <button class="entity-picker-action" id="entityClearAll" tabindex="0">Clear All</button>
          </div>
          <div class="entity-picker-list" id="entityPickerList"></div>
        </div>
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
          <p>This line chart shows <strong>code complexity trends over time</strong>, grouped by the selected dimension (contributor, team, repository, or tech stack). The Y-axis displays the average cyclomatic complexity, and the X-axis shows the time period (day/week/month). Use this chart to identify when complexity is increasing and which groups are contributing to technical debt. High complexity often correlates with maintenance difficulty and bug rates.</p>
        </div>
      </details>
      <!-- Interactive Legend (GITX-134) -->
      <div class="legend-controls">
        <button class="legend-select-all-btn" id="legendSelectAll" aria-label="Show all series" tabindex="0">Select All</button>
        <button class="legend-clear-all-btn" id="legendClearAll" aria-label="Hide all series" tabindex="0">Clear All</button>
      </div>
      <div id="legendContainer" class="chart-legend complexity-legend" role="group" aria-label="Series legend - click to toggle visibility"></div>
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
              <th scope="col" id="groupKeyHeader">Contributor</th>
              <th scope="col">Avg Complexity</th>
              <th scope="col">Total Complexity</th>
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

      function getSeriesColor(index) {
        return COLORS[index % COLORS.length];
      }

      // ======================================================================
      // State
      // ======================================================================
      var chartData = null;
      var allGroupKeys = [];
      var hiddenSeries = new Set(); // GITX-134: Track hidden series for interactive legend
      var filterOptions = { teams: [], contributors: [], repositories: [], techStacks: [] };

      // View Mode labels for display (GITX-136)
      var viewModeLabels = {
        contributor: 'Contributor',
        team: 'Team',
        repository: 'Repository',
        archLayer: 'Arch Layer'
      };

      // Entity rankings for multi-select picker (GITX-136)
      var entityRankings = [];

      // Filter state (GITX-136: viewMode, metric, topN, selectedEntities)
      var currentFilters = {
        period: 'weekly',
        viewMode: 'contributor',
        metric: 'average',
        topN: 10,
        selectedEntities: [], // Empty means use Top N
        startDate: '',
        endDate: '',
        team: '',
        contributor: '',
        repository: '',
        techStack: ''
      };

      // DOM References
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFiltersBtn = document.getElementById('applyFiltersBtn');
      var clearFiltersBtn = document.getElementById('clearFiltersBtn');
      var startDateFilter = document.getElementById('startDateFilter');
      var endDateFilter = document.getElementById('endDateFilter');
      var teamFilter = document.getElementById('teamFilter');
      var contributorFilter = document.getElementById('contributorFilter');
      var repoFilter = document.getElementById('repoFilter');
      var techStackFilter = document.getElementById('techStackFilter');
      var chartTitle = document.getElementById('chartTitle');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var summaryStats = document.getElementById('summaryStats');
      var legendContainer = document.getElementById('legendContainer');
      var legendSelectAll = document.getElementById('legendSelectAll');
      var legendClearAll = document.getElementById('legendClearAll');
      var toggleTableBtn = document.getElementById('toggleTableBtn');
      var dataTableWrapper = document.getElementById('dataTableWrapper');
      var dataTableContainer = document.getElementById('dataTableContainer');
      var groupKeyHeader = document.getElementById('groupKeyHeader');
      var tooltip = document.getElementById('tooltip');

      // GITX-136: New chart control DOM references
      var viewModeGroup = document.getElementById('viewModeGroup');
      var metricToggleGroup = document.getElementById('metricToggleGroup');
      var periodToggleGroup = document.getElementById('periodToggleGroup');
      var topNSelect = document.getElementById('topNSelect');
      var entityPickerToggle = document.getElementById('entityPickerToggle');
      var entityPickerPanel = document.getElementById('entityPickerPanel');
      var entityPickerLabel = document.getElementById('entityPickerLabel');
      var entityPickerList = document.getElementById('entityPickerList');
      var entitySelectAll = document.getElementById('entitySelectAll');
      var entityClearAll = document.getElementById('entityClearAll');

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

      // Date range validation (GITX-134)
      function validateDateRange() {
        var start = startDateFilter.value;
        var end = endDateFilter.value;
        if (start && end) {
          var startDate = new Date(start);
          var endDate = new Date(end);
          if (startDate > endDate) {
            alert('Start date must be before or equal to end date.');
            return false;
          }
          var daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
          if (daysDiff > 730) {
            alert('Date range cannot exceed 730 days (2 years).');
            return false;
          }
        }
        return true;
      }

      // Event Handlers
      exportCsvBtn.addEventListener('click', function() {
        if (!chartData || chartData.length === 0) { return; }
        var groupLabel = viewModeLabels[currentFilters.viewMode] || 'Group';
        var headers = ['Date', groupLabel, 'Avg Complexity', 'Total Complexity', 'Complexity Delta', 'Max Complexity', 'Commits', 'Files'];
        var rows = chartData.map(function(d) {
          return [d.date, d.groupKey, d.avgComplexity.toFixed(2), d.totalComplexity || 0, d.complexityDelta, d.maxComplexity, d.commitCount, d.fileCount];
        });
        var filename = 'complexity-trend-' + new Date().toISOString().split('T')[0] + '.csv';
        exportCsvFromData(headers, rows, filename);
      });

      applyFiltersBtn.addEventListener('click', function() {
        if (!validateDateRange()) { return; }
        collectFilters();
        hiddenSeries.clear(); // Reset hidden series when filters change
        saveFilterState();
        updateChartTitle();
        requestData();
      });

      clearFiltersBtn.addEventListener('click', function() {
        // Reset pre-filters
        teamFilter.value = '';
        contributorFilter.value = '';
        repoFilter.value = '';
        techStackFilter.value = '';
        setDefaultDateRange();
        hiddenSeries.clear();

        // Reset chart control UI (GITX-136)
        setActiveToggle(viewModeGroup, 'contributor', 'tab-btn');
        setActiveToggle(metricToggleGroup, 'average', 'metric-btn');
        setActiveToggle(periodToggleGroup, 'weekly', 'period-btn');
        topNSelect.value = '10';

        // Reset state
        currentFilters = {
          period: 'weekly',
          viewMode: 'contributor',
          metric: 'average',
          topN: 10,
          selectedEntities: [],
          startDate: startDateFilter.value,
          endDate: endDateFilter.value,
          team: '',
          contributor: '',
          repository: '',
          techStack: ''
        };
        updateEntityPickerLabel();
        saveFilterState();
        updateChartTitle();
        requestEntityRankings();
        requestData();
      });

      // Helper to set active toggle button (GITX-136)
      function setActiveToggle(group, value, btnClass) {
        group.querySelectorAll('.' + btnClass).forEach(function(b) {
          var isActive = b.getAttribute('data-value') === value;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-selected', String(isActive));
          b.setAttribute('aria-checked', String(isActive));
          b.setAttribute('tabindex', isActive ? '0' : '-1');
        });
      }

      toggleTableBtn.addEventListener('click', function() {
        var isExpanded = toggleTableBtn.getAttribute('aria-expanded') === 'true';
        toggleTableBtn.setAttribute('aria-expanded', String(!isExpanded));
        toggleTableBtn.textContent = isExpanded ? 'Show data table' : 'Hide data table';
        dataTableWrapper.style.display = isExpanded ? 'none' : 'block';
      });

      // ======================================================================
      // GITX-136: Chart Control Event Handlers
      // ======================================================================

      // View Mode Toggle Tabs
      viewModeGroup.addEventListener('click', function(e) {
        var btn = e.target.closest('.tab-btn');
        if (!btn) return;
        var newViewMode = btn.getAttribute('data-value');
        if (newViewMode === currentFilters.viewMode) return;

        // Update UI
        viewModeGroup.querySelectorAll('.tab-btn').forEach(function(b) {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
          b.setAttribute('tabindex', '-1');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        btn.setAttribute('tabindex', '0');

        // Update state
        currentFilters.viewMode = newViewMode;
        currentFilters.selectedEntities = []; // Reset entity selection
        hiddenSeries.clear();
        updateEntityPickerLabel();
        saveFilterState();
        updateChartTitle();
        requestEntityRankings();
        requestData();
      });

      // Metric Toggle
      metricToggleGroup.addEventListener('click', function(e) {
        var btn = e.target.closest('.metric-btn');
        if (!btn) return;
        var newMetric = btn.getAttribute('data-value');
        if (newMetric === currentFilters.metric) return;

        // Update UI
        metricToggleGroup.querySelectorAll('.metric-btn').forEach(function(b) {
          b.classList.remove('active');
          b.setAttribute('aria-checked', 'false');
          b.setAttribute('tabindex', '-1');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
        btn.setAttribute('tabindex', '0');

        // Update state
        currentFilters.metric = newMetric;
        saveFilterState();
        requestData();
      });

      // Period Toggle
      periodToggleGroup.addEventListener('click', function(e) {
        var btn = e.target.closest('.period-btn');
        if (!btn) return;
        var newPeriod = btn.getAttribute('data-value');
        if (newPeriod === currentFilters.period) return;

        // Update UI
        periodToggleGroup.querySelectorAll('.period-btn').forEach(function(b) {
          b.classList.remove('active');
          b.setAttribute('aria-checked', 'false');
          b.setAttribute('tabindex', '-1');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
        btn.setAttribute('tabindex', '0');

        // Update state
        currentFilters.period = newPeriod;
        saveFilterState();
        requestData();
      });

      // Top N Select
      topNSelect.addEventListener('change', function() {
        var newTopN = parseInt(topNSelect.value, 10);
        if (newTopN === currentFilters.topN) return;

        currentFilters.topN = newTopN;
        // Clear selected entities to use Top N
        currentFilters.selectedEntities = [];
        hiddenSeries.clear();
        updateEntityPickerLabel();
        saveFilterState();
        requestData();
      });

      // Entity Picker Toggle
      entityPickerToggle.addEventListener('click', function() {
        var isExpanded = entityPickerToggle.getAttribute('aria-expanded') === 'true';
        entityPickerToggle.setAttribute('aria-expanded', String(!isExpanded));
        entityPickerPanel.style.display = isExpanded ? 'none' : 'block';
      });

      // Close entity picker when clicking outside
      document.addEventListener('click', function(e) {
        if (!e.target.closest('.entity-select-group')) {
          entityPickerToggle.setAttribute('aria-expanded', 'false');
          entityPickerPanel.style.display = 'none';
        }
      });

      // Entity Select All
      entitySelectAll.addEventListener('click', function() {
        currentFilters.selectedEntities = entityRankings.map(function(r) { return r.entity; });
        renderEntityPickerList();
        updateEntityPickerLabel();
        hiddenSeries.clear();
        saveFilterState();
        requestData();
      });

      // Entity Clear All
      entityClearAll.addEventListener('click', function() {
        currentFilters.selectedEntities = [];
        renderEntityPickerList();
        updateEntityPickerLabel();
        hiddenSeries.clear();
        saveFilterState();
        requestData();
      });

      // Interactive Legend Controls (GITX-134)
      legendSelectAll.addEventListener('click', function() {
        hiddenSeries.clear();
        renderLegend();
        renderChart(chartData);
      });

      legendClearAll.addEventListener('click', function() {
        allGroupKeys.forEach(function(key) {
          hiddenSeries.add(key);
        });
        renderLegend();
        renderChart(chartData);
      });

      // Collect current filter values (GITX-136: period, viewMode, metric, topN from chart controls)
      function collectFilters() {
        // period, viewMode, metric, topN, selectedEntities are managed by chart controls
        currentFilters.startDate = startDateFilter.value || '';
        currentFilters.endDate = endDateFilter.value || '';
        currentFilters.team = teamFilter.value || '';
        currentFilters.contributor = contributorFilter.value || '';
        currentFilters.repository = repoFilter.value || '';
        currentFilters.techStack = techStackFilter.value || '';
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
          case 'complexityTrendEntityRanking':
            handleEntityRanking(message);
            break;
          case 'complexityTrendError':
            showError(escapeHtml(message.message));
            break;
        }
      });

      // Handle entity ranking response (GITX-136)
      function handleEntityRanking(message) {
        if (message.viewMode !== currentFilters.viewMode) {
          // Stale response, ignore
          return;
        }
        entityRankings = message.rankings || [];
        renderEntityPickerList();
        updateEntityPickerLabel();
      }

      // Render entity picker list (GITX-136)
      function renderEntityPickerList() {
        entityPickerList.innerHTML = '';
        entityRankings.forEach(function(ranking) {
          var isSelected = currentFilters.selectedEntities.indexOf(ranking.entity) >= 0;
          var item = document.createElement('div');
          item.className = 'entity-picker-item' + (isSelected ? ' selected' : '');
          item.setAttribute('role', 'option');
          item.setAttribute('aria-selected', String(isSelected));
          item.setAttribute('tabindex', '0');
          item.setAttribute('data-entity', ranking.entity);

          var checkbox = document.createElement('span');
          checkbox.className = 'entity-checkbox';
          checkbox.textContent = isSelected ? '\u2713' : '';
          item.appendChild(checkbox);

          var label = document.createElement('span');
          label.className = 'entity-label';
          label.textContent = ranking.entity;
          item.appendChild(label);

          var complexity = document.createElement('span');
          complexity.className = 'entity-complexity';
          complexity.textContent = ranking.totalComplexity.toLocaleString();
          item.appendChild(complexity);

          item.addEventListener('click', function() {
            toggleEntitySelection(ranking.entity);
          });

          item.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleEntitySelection(ranking.entity);
            }
          });

          entityPickerList.appendChild(item);
        });
      }

      // Toggle entity selection (GITX-136)
      function toggleEntitySelection(entity) {
        var idx = currentFilters.selectedEntities.indexOf(entity);
        if (idx >= 0) {
          currentFilters.selectedEntities = currentFilters.selectedEntities.filter(function(e) { return e !== entity; });
        } else {
          currentFilters.selectedEntities = currentFilters.selectedEntities.concat([entity]);
        }
        renderEntityPickerList();
        updateEntityPickerLabel();
        hiddenSeries.clear();
        saveFilterState();
        requestData();
      }

      // Update entity picker label (GITX-136)
      function updateEntityPickerLabel() {
        var count = currentFilters.selectedEntities.length;
        if (count === 0) {
          entityPickerLabel.textContent = 'Using Top ' + currentFilters.topN;
        } else if (count === 1) {
          entityPickerLabel.textContent = currentFilters.selectedEntities[0];
        } else {
          entityPickerLabel.textContent = count + ' selected';
        }
      }

      // Request entity rankings (GITX-136)
      function requestEntityRankings() {
        vscode.postMessage({
          type: 'requestComplexityTrendEntityRanking',
          viewMode: currentFilters.viewMode,
          filters: {
            startDate: currentFilters.startDate || undefined,
            endDate: currentFilters.endDate || undefined,
            team: currentFilters.team || undefined,
            contributor: currentFilters.contributor || undefined,
            repository: currentFilters.repository || undefined,
            techStack: currentFilters.techStack || undefined
          }
        });
      }

      function handleFilterOptions(message) {
        filterOptions = message.options || { teams: [], contributors: [], repositories: [], techStacks: [] };

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

        // Populate tech stack dropdown (GITX-134)
        while (techStackFilter.options.length > 1) { techStackFilter.remove(1); }
        (filterOptions.techStacks || []).forEach(function(techStack) {
          var option = document.createElement('option');
          option.value = techStack;
          option.textContent = techStack;
          techStackFilter.appendChild(option);
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
        if (currentFilters.techStack && (filterOptions.techStacks || []).indexOf(currentFilters.techStack) >= 0) {
          techStackFilter.value = currentFilters.techStack;
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
          if (currentFilters.techStack) { filterDesc.push('tech stack "' + escapeHtml(currentFilters.techStack) + '"'); }

          var filterMsg = filterDesc.length > 0 ? filterDesc.join(', ') : 'the selected date range';
          showEmpty(
            'No Data for Selected Filters',
            'No complexity data found for ' + filterMsg + '. Try adjusting the filters or date range.'
          );
          return;
        }

        chartData = message.data;

        // Get unique group keys for coloring
        allGroupKeys = [];
        var seenGroupKeys = {};
        chartData.forEach(function(d) {
          if (!seenGroupKeys[d.groupKey]) {
            seenGroupKeys[d.groupKey] = true;
            allGroupKeys.push(d.groupKey);
          }
        });
        allGroupKeys.sort();

        // Update data table header based on viewMode (GITX-136)
        groupKeyHeader.textContent = viewModeLabels[currentFilters.viewMode] || 'Group';

        renderChart(chartData);
        renderSummaryStats(chartData);
        renderLegend();
        renderDataTable(chartData);
        chartArea.style.display = 'block';
        dataTableContainer.style.display = 'block';
      }

      // Line Chart Rendering with D3.js (GITX-136: metric toggle support)
      function renderChart(data) {
        if (!data || data.length === 0) { return; }

        // Filter data based on hiddenSeries (GITX-134)
        var visibleData = data.filter(function(d) {
          return !hiddenSeries.has(d.groupKey);
        });

        // Determine which metric to use (GITX-136)
        var useAverage = currentFilters.metric === 'average';
        var metricLabel = useAverage ? 'Average Complexity' : 'Total Complexity';
        function getMetricValue(d) {
          return useAverage ? d.avgComplexity : (d.totalComplexity || 0);
        }

        // Chart dimensions
        var margin = { top: 30, right: 100, bottom: 60, left: 70 };
        var containerWidth = Math.max(600, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var height = 400;

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Line chart showing complexity trends by ' + (viewModeLabels[currentFilters.viewMode] || 'group') + ' over time');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        // If no visible data, show message
        if (visibleData.length === 0) {
          g.append('text')
            .attr('x', innerWidth / 2)
            .attr('y', innerHeight / 2)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--vscode-descriptionForeground, #999)')
            .text('No series visible. Click legend items to show series.');
          return;
        }

        // Group data by group key
        var dataByGroupKey = {};
        visibleData.forEach(function(d) {
          if (!dataByGroupKey[d.groupKey]) {
            dataByGroupKey[d.groupKey] = [];
          }
          dataByGroupKey[d.groupKey].push(d);
        });

        // Get unique dates for X scale from visible data
        var allDates = [];
        var seenDates = {};
        visibleData.forEach(function(d) {
          if (!seenDates[d.date]) {
            seenDates[d.date] = true;
            allDates.push(d.date);
          }
        });
        allDates.sort();

        // X Scale: dates
        var x = d3.scalePoint().domain(allDates).range([0, innerWidth]).padding(0.5);

        // Y Scale: complexity (GITX-136: use selected metric)
        var maxComplexity = d3.max(visibleData, function(d) { return getMetricValue(d); }) || 1;
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

        // Y Axis Label (GITX-136: dynamic based on metric)
        g.append('text').attr('transform', 'rotate(-90)')
          .attr('y', -55).attr('x', -innerHeight / 2).attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #cccccc)').attr('font-size', '12px')
          .text(metricLabel);

        // Render lines for each visible group key (GITX-136: use getMetricValue)
        Object.keys(dataByGroupKey).forEach(function(groupKey) {
          var groupData = dataByGroupKey[groupKey].sort(function(a, b) {
            return a.date < b.date ? -1 : 1;
          });

          var colorIndex = allGroupKeys.indexOf(groupKey);
          var color = getSeriesColor(colorIndex);

          var line = d3.line()
            .x(function(d) { return x(d.date); })
            .y(function(d) { return y(getMetricValue(d)); })
            .curve(d3.curveMonotoneX);

          // Line path
          g.append('path')
            .datum(groupData)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 2)
            .attr('opacity', 0.8)
            .attr('d', line)
            .attr('data-group-key', groupKey);

          // Data point markers
          groupData.forEach(function(d) {
            var metricVal = getMetricValue(d);
            g.append('circle')
              .attr('cx', x(d.date))
              .attr('cy', y(metricVal))
              .attr('r', 4)
              .attr('fill', color)
              .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
              .attr('stroke-width', 1.5)
              .attr('data-group-key', groupKey)
              .attr('aria-label', escapeHtmlAttribute(groupKey) + ' on ' + escapeHtmlAttribute(d.date) + ': ' + metricVal.toFixed(2))
              .on('mouseover', function(event) {
                showTooltip(event, d, color, groupKey, metricLabel);
              })
              .on('mousemove', function(event) { moveTooltip(event); })
              .on('mouseout', hideTooltip);
          });
        });
      }

      // Tooltip (GITX-136: show both avg and total complexity)
      function showTooltip(event, d, color, groupKey, metricLabel) {
        var deltaPrefix = d.complexityDelta >= 0 ? '+' : '';
        var useAverage = currentFilters.metric === 'average';
        tooltip.innerHTML =
          '<div class="tt-date"><strong>' + escapeHtml(d.date) + '</strong></div>' +
          '<div class="tt-contributor" style="color:' + color + '"><span style="color:' + color + '">&#9632;</span> ' + escapeHtml(groupKey) + '</div>' +
          '<hr>' +
          '<div class="tt-row' + (useAverage ? ' tt-highlight' : '') + '"><span>Avg Complexity:</span> <strong>' + escapeHtml(d.avgComplexity.toFixed(2)) + '</strong></div>' +
          '<div class="tt-row' + (!useAverage ? ' tt-highlight' : '') + '"><span>Total Complexity:</span> <strong>' + escapeHtml(String(d.totalComplexity || 0)) + '</strong></div>' +
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

      // Interactive Legend (GITX-134)
      function renderLegend() {
        legendContainer.innerHTML = '';

        allGroupKeys.forEach(function(groupKey, index) {
          var color = getSeriesColor(index);
          var isHidden = hiddenSeries.has(groupKey);

          var item = document.createElement('div');
          item.className = 'legend-item' + (isHidden ? ' disabled' : '');
          item.setAttribute('role', 'checkbox');
          item.setAttribute('aria-checked', String(!isHidden));
          item.setAttribute('tabindex', '0');
          item.setAttribute('data-group-key', groupKey);

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = isHidden ? 'var(--vscode-disabledForeground, #666)' : color;
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.className = 'legend-label';
          label.textContent = groupKey;
          item.appendChild(label);

          // Click handler for toggling series visibility
          item.addEventListener('click', function() {
            toggleSeriesVisibility(groupKey);
          });

          // Keyboard accessibility (GITX-134)
          item.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleSeriesVisibility(groupKey);
            }
          });

          legendContainer.appendChild(item);
        });
      }

      // Toggle series visibility (GITX-134)
      function toggleSeriesVisibility(groupKey) {
        if (hiddenSeries.has(groupKey)) {
          hiddenSeries.delete(groupKey);
        } else {
          hiddenSeries.add(groupKey);
        }
        renderLegend();
        renderChart(chartData);
        saveFilterState();
      }

      // Summary Stats
      function renderSummaryStats(data) {
        // Only count visible series data
        var visibleData = data.filter(function(d) {
          return !hiddenSeries.has(d.groupKey);
        });

        var totalCommits = 0;
        var totalFiles = 0;
        var totalDelta = 0;
        var avgComplexitySum = 0;

        visibleData.forEach(function(d) {
          totalCommits += d.commitCount;
          totalFiles += d.fileCount;
          totalDelta += d.complexityDelta;
          avgComplexitySum += d.avgComplexity;
        });

        var overallAvg = visibleData.length > 0 ? (avgComplexitySum / visibleData.length).toFixed(2) : 0;
        var deltaPrefix = totalDelta >= 0 ? '+' : '';

        var visibleGroupKeys = allGroupKeys.filter(function(key) {
          return !hiddenSeries.has(key);
        });

        var groupLabel = viewModeLabels[currentFilters.viewMode] || 'Groups';
        // Pluralize label
        if (groupLabel.endsWith('y')) {
          groupLabel = groupLabel.slice(0, -1) + 'ies';
        } else if (!groupLabel.endsWith('s')) {
          groupLabel = groupLabel + 's';
        }

        summaryStats.innerHTML =
          createStatCard(visibleData.length.toLocaleString(), 'Data Points') +
          createStatCard(overallAvg, 'Avg Complexity') +
          createStatCard(deltaPrefix + totalDelta.toLocaleString(), 'Net Delta') +
          createStatCard(totalCommits.toLocaleString(), 'Total Commits') +
          createStatCard(visibleGroupKeys.length.toLocaleString(), groupLabel);
      }

      function createStatCard(value, label) {
        return '<div class="stat-card"><div class="stat-value">' +
          escapeHtml(String(value)) + '</div><div class="stat-label">' +
          escapeHtml(label) + '</div></div>';
      }

      // Data Table (Accessibility Fallback) - GITX-136: Added total complexity
      function renderDataTable(data) {
        var tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';

        // Only show visible series
        var visibleData = data.filter(function(d) {
          return !hiddenSeries.has(d.groupKey);
        });

        visibleData.forEach(function(d) {
          var tr = document.createElement('tr');

          var tdDate = document.createElement('td');
          tdDate.textContent = d.date;
          tr.appendChild(tdDate);

          var tdGroupKey = document.createElement('td');
          tdGroupKey.textContent = d.groupKey;
          tr.appendChild(tdGroupKey);

          var tdAvgComplexity = document.createElement('td');
          tdAvgComplexity.textContent = d.avgComplexity.toFixed(2);
          tr.appendChild(tdAvgComplexity);

          var tdTotalComplexity = document.createElement('td');
          tdTotalComplexity.textContent = String(d.totalComplexity || 0);
          tr.appendChild(tdTotalComplexity);

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

      // Data Request (GITX-136: viewMode, metric, topN, selectedEntities)
      function requestData() {
        showLoading();
        var filters = {
          period: currentFilters.period,
          viewMode: currentFilters.viewMode,
          metric: currentFilters.metric,
          topN: currentFilters.topN,
          selectedEntities: currentFilters.selectedEntities.length > 0 ? currentFilters.selectedEntities : undefined,
          startDate: currentFilters.startDate || undefined,
          endDate: currentFilters.endDate || undefined,
          team: currentFilters.team || undefined,
          contributor: currentFilters.contributor || undefined,
          repository: currentFilters.repository || undefined,
          techStack: currentFilters.techStack || undefined
        };
        vscode.postMessage({ type: 'requestComplexityTrendData', filters: filters });
      }
      // Expose for retry button
      window.requestData = requestData;

      // Request filter options
      function requestFilterOptions() {
        vscode.postMessage({ type: 'requestComplexityTrendFilterOptions' });
      }

      // Update chart title with active filters (GITX-136: viewMode)
      function updateChartTitle() {
        var badges = [];
        if (currentFilters.viewMode && currentFilters.viewMode !== 'contributor') {
          badges.push('by ' + viewModeLabels[currentFilters.viewMode]);
        }
        if (currentFilters.team) { badges.push(escapeHtml(currentFilters.team)); }
        if (currentFilters.contributor) { badges.push(escapeHtml(currentFilters.contributor)); }
        if (currentFilters.repository) { badges.push(escapeHtml(currentFilters.repository)); }
        if (currentFilters.techStack) { badges.push(escapeHtml(currentFilters.techStack)); }

        if (badges.length > 0) {
          chartTitle.innerHTML = 'Complexity Trend Over Time <span class="filter-badge">[' + badges.join(', ') + ']</span>';
        } else {
          chartTitle.textContent = 'Complexity Trend Over Time';
        }
      }

      // Save filter state to VS Code
      function saveFilterState() {
        vscode.setState({
          filters: currentFilters,
          hiddenSeries: Array.from(hiddenSeries)
        });
      }

      // Restore filter state from VS Code (GITX-136: restore chart controls)
      function restoreFilterState() {
        var state = vscode.getState();
        if (state && state.filters) {
          currentFilters = Object.assign({
            period: 'weekly',
            viewMode: 'contributor',
            metric: 'average',
            topN: 10,
            selectedEntities: []
          }, state.filters);

          // Restore chart control UI
          setActiveToggle(viewModeGroup, currentFilters.viewMode, 'tab-btn');
          setActiveToggle(metricToggleGroup, currentFilters.metric, 'metric-btn');
          setActiveToggle(periodToggleGroup, currentFilters.period, 'period-btn');
          topNSelect.value = String(currentFilters.topN);
          startDateFilter.value = currentFilters.startDate || '';
          endDateFilter.value = currentFilters.endDate || '';
          // Team, contributor, repo, techStack are restored after filter options are loaded
        }
        if (state && state.hiddenSeries) {
          hiddenSeries = new Set(state.hiddenSeries);
        }
        updateEntityPickerLabel();
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

      // Initial Load (GITX-136: also request entity rankings)
      restoreFilterState();
      if (!currentFilters.startDate || !currentFilters.endDate) {
        setDefaultDateRange();
      }
      updateChartTitle();
      requestFilterOptions();
      requestEntityRankings();
      requestData();

    })();
  </script>
</body>
</html>`;
}
