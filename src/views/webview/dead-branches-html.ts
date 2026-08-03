/**
 * HTML generator for the Dead Branches Report dashboard webview.
 *
 * Generates a complete HTML document with:
 * - Risk Level Legend (collapsible) with safety guidance
 * - Summary KPI cards (Total, Merged, Stale, Orphaned)
 * - D3.js donut chart for risk distribution
 * - Horizontal stacked bar chart for repository breakdown
 * - Sortable, filterable branches table with multi-select
 * - Filter controls (repository, risk, status, min age, search)
 * - Action buttons (Delete Selected, Export CSV, Select All)
 * - Status tooltips with contextual help
 * - Empty states and error handling
 * - Accessibility features (ARIA labels, keyboard navigation)
 * - VS Code theme integration
 * - CSP compliance via nonce
 *
 * Ticket: GITX-231
 */

import type { Uri } from 'vscode';

/**
 * Parameters for HTML generation.
 */
export interface DeadBranchesHtmlParams {
  /** CSP nonce for script authorization */
  readonly nonce: string;
  /** URI to the bundled D3.js library */
  readonly d3Uri: Uri;
  /** URI to the dashboard CSS */
  readonly styleUri: Uri;
  /** CSP source for the webview */
  readonly cspSource: string;
  /** GitHub organization for branch/commit links */
  readonly githubOrg: string;
}

/**
 * Generate the complete HTML for the Dead Branches Report dashboard.
 *
 * @param params - HTML generation parameters
 * @returns Complete HTML document string
 */
export function generateDeadBranchesHtml(params: DeadBranchesHtmlParams): string {
  const { nonce, d3Uri, styleUri, cspSource, githubOrg } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; font-src ${cspSource};">
  <title>Dead Branches Report</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div class="dashboard-container" role="main">
    <!-- Error Banner -->
    <div id="errorBanner" class="error-banner" role="alert" aria-live="polite">
      <span id="errorMessage"></span>
    </div>

    <!-- Header -->
    <header class="dashboard-header">
      <div class="header-title-section">
        <h1 class="dashboard-title">Dead Branches Report</h1>
        <!-- Data Freshness Indicator -->
        <div id="dataFreshness" class="data-freshness" hidden>
          <span id="lastUpdated" class="freshness-text">Last updated: --</span>
          <span id="freshnessIndicator" class="freshness-badge"></span>
        </div>
      </div>
      <div class="header-actions">
        <button id="refreshBtn" class="btn btn-primary" aria-label="Refresh data from database (fast)">
          <span id="refreshBtnText">Refresh</span>
        </button>
        <button id="scanBtn" class="btn btn-secondary" aria-label="Sync from Git repositories (slow)">
          <span id="scanBtnText">Sync from Git</span>
          <span id="scanSpinner" class="spinner" hidden aria-hidden="true"></span>
        </button>
      </div>
      <!-- Screen reader announcements for scan status -->
      <div id="scanStatus" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"></div>
    </header>

    <!-- Risk Level Legend (Collapsible) -->
    <section class="legend-section" aria-label="Risk level legend">
      <button
        id="legendToggle"
        class="legend-toggle"
        aria-expanded="false"
        aria-controls="legendContent"
      >
        <span class="toggle-icon" aria-hidden="true">▶</span>
        <span>Risk Level Guide</span>
      </button>
      <div id="legendContent" class="legend-content" hidden>
        <div class="legend-grid">
          <div class="legend-item risk-safe">
            <div class="legend-header">
              <span class="risk-badge risk-safe">Safe Delete</span>
              <span class="legend-label">Merged + Old (>90 days)</span>
            </div>
            <p class="legend-description">Branch is fully merged into a protected branch and has not been touched in over 90 days. Safe to delete immediately with no data loss risk.</p>
          </div>
          <div class="legend-item risk-low">
            <div class="legend-header">
              <span class="risk-badge risk-low">Low Risk</span>
              <span class="legend-label">Merged + Recent (<90 days)</span>
            </div>
            <p class="legend-description">Branch is merged but was recently active. Review with author before deletion, but low risk since all changes are already in the protected branch.</p>
          </div>
          <div class="legend-item risk-medium">
            <div class="legend-header">
              <span class="risk-badge risk-medium">Medium Risk</span>
              <span class="legend-label">Unmerged + Stale (90-180 days)</span>
            </div>
            <p class="legend-description">Branch has unmerged commits and has been inactive for 90-180 days. Verify with the author before deletion — may contain work-in-progress or abandoned features.</p>
          </div>
          <div class="legend-item risk-high">
            <div class="legend-header">
              <span class="risk-badge risk-high">High Risk</span>
              <span class="legend-label">Unmerged Recent OR Open PR</span>
            </div>
            <p class="legend-description">Branch has unmerged commits and is recent, or has an open PR. Investigate before deletion — active work may be lost. Coordinate with the branch author.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Loading State -->
    <div id="loadingState" class="loading-container">
      <div class="loading-spinner" aria-hidden="true"></div>
      <div class="loading-text" role="status">Analyzing branches...</div>
    </div>

    <!-- Empty State: No Branches -->
    <div id="emptyState" class="empty-state" style="display: none;">
      <div class="empty-state-icon" aria-hidden="true">🌿</div>
      <h2 class="empty-state-title">No Cleanup Candidates Found</h2>
      <p class="empty-state-message">All branches are either protected, active, or don't match the selected filters.</p>
      <div class="empty-state-suggestions">
        <p><strong>Suggestions:</strong></p>
        <ul>
          <li>Adjust the staleness threshold (currently: 90 days)</li>
          <li>Clear active filters to see all branches</li>
          <li>Check if protected branch patterns are excluding too many branches</li>
        </ul>
      </div>
    </div>

    <!-- Dashboard Content -->
    <div id="dashboardContent" style="display: none;">
      <!-- Summary KPI Cards -->
      <section class="kpi-grid" aria-label="Branch summary statistics">
        <div class="kpi-card">
          <p id="kpiTotal" class="kpi-value" aria-live="polite">--</p>
          <p class="kpi-label">Total Branches</p>
          <p class="kpi-sublabel">(excluding protected)</p>
        </div>
        <div class="kpi-card">
          <p id="kpiMerged" class="kpi-value" aria-live="polite">--</p>
          <p class="kpi-label">Merged</p>
        </div>
        <div class="kpi-card">
          <p id="kpiStale" class="kpi-value" aria-live="polite">--</p>
          <p class="kpi-label">Stale</p>
        </div>
        <div class="kpi-card">
          <p id="kpiOrphaned" class="kpi-value" aria-live="polite">--</p>
          <p class="kpi-label">Orphaned</p>
        </div>
      </section>

      <!-- Charts Grid -->
      <section class="charts-grid" aria-label="Branch distribution charts">
        <div class="chart-container">
          <h2 class="chart-title">Risk Distribution</h2>
          <div id="riskDonutChart" class="chart-svg" role="img" aria-label="Donut chart showing branch count by risk level"></div>
        </div>
        <div class="chart-container">
          <h2 class="chart-title">Repository Breakdown</h2>
          <div id="repoBarChart" class="chart-svg" role="img" aria-label="Horizontal stacked bar chart showing risk levels per repository"></div>
        </div>
      </section>

      <!-- Filters and Actions -->
      <section class="table-section" aria-label="Branch table and filters">
        <div class="table-header">
          <h2 class="table-title">Branches</h2>
          <div class="table-actions">
            <button id="selectAllBtn" class="btn btn-secondary" aria-label="Select all visible branches">Select All</button>
            <button id="deselectAllBtn" class="btn btn-secondary" aria-label="Deselect all branches">Deselect All</button>
            <button id="deleteSelectedBtn" class="btn btn-danger" aria-label="Delete selected branches" disabled>Delete Selected</button>
            <button id="exportCsvBtn" class="btn btn-secondary" aria-label="Export branches to CSV">Export CSV</button>
          </div>
        </div>

        <!-- Filter Controls -->
        <div class="filters-container" role="search" aria-label="Branch filters">
          <div class="filter-group">
            <label class="filter-label" for="repositoryFilter">Repository</label>
            <select id="repositoryFilter" class="filter-select" aria-label="Filter by repository">
              <option value="">All Repositories</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="filter-label" for="riskFilter">Risk Level</label>
            <select id="riskFilter" class="filter-select" aria-label="Filter by risk level">
              <option value="">All Risk Levels</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="filter-label" for="statusFilter">Status</label>
            <select id="statusFilter" class="filter-select" aria-label="Filter by status">
              <option value="">All Statuses</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="filter-label" for="minAgeFilter">Min Age (days)</label>
            <input type="number" id="minAgeFilter" class="filter-input" min="0" placeholder="0" aria-label="Minimum branch age in days">
          </div>
          <div class="filter-group filter-search">
            <label class="filter-label" for="searchFilter">Search</label>
            <input type="text" id="searchFilter" class="filter-input" placeholder="Branch name..." aria-label="Search branches by name">
          </div>
        </div>

        <!-- Branches Table -->
        <div id="branchTableContainer" role="region" aria-label="Branches table" tabindex="0">
          <table class="data-table" aria-describedby="tableDescription">
            <caption id="tableDescription" class="visually-hidden">Table of dead/stale branches with risk levels and metadata</caption>
            <thead>
              <tr>
                <th scope="col" class="col-checkbox">
                  <input type="checkbox" id="selectAllCheckbox" aria-label="Select all visible branches" />
                </th>
                <th scope="col" data-sort="branchName" tabindex="0" role="columnheader" aria-sort="none">Branch Name</th>
                <th scope="col" data-sort="repository" tabindex="0" role="columnheader" aria-sort="none">Repository</th>
                <th scope="col" data-sort="riskLevel" tabindex="0" role="columnheader" aria-sort="none">Risk Level</th>
                <th scope="col" data-sort="status" tabindex="0" role="columnheader" aria-sort="none">
                  Status
                  <span class="info-icon" title="Hover over status badges for details" aria-label="Information">ℹ</span>
                </th>
                <th scope="col" data-sort="daysSinceLastCommit" tabindex="0" role="columnheader" aria-sort="descending">Days Inactive</th>
                <th scope="col" data-sort="lastCommitAuthor" tabindex="0" role="columnheader" aria-sort="none">Last Author</th>
                <th scope="col" data-sort="lastCommitDate" tabindex="0" role="columnheader" aria-sort="none">Last Commit</th>
              </tr>
            </thead>
            <tbody id="branchTableBody">
              <!-- Rows populated by JavaScript -->
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <nav class="pagination" aria-label="Table pagination">
          <button id="prevPage" class="btn btn-secondary" aria-label="Previous page">&lt; Prev</button>
          <span id="pageInfo" class="page-info" aria-live="polite">Page 1 of 1</span>
          <button id="nextPage" class="btn btn-secondary" aria-label="Next page">Next &gt;</button>
        </nav>
      </section>
    </div>
  </div>

  <script nonce="${nonce}" src="${d3Uri}"></script>
  <script nonce="${nonce}">
    // VS Code API
    const vscode = acquireVsCodeApi();

    // GitHub org for commit links (JSON.stringify for XSS prevention)
    const githubOrg = ${JSON.stringify(githubOrg)};

    // State
    let branchData = null;
    let filteredBranches = [];
    let selectedBranches = new Set();
    let currentPage = 1;
    const pageSize = 50;
    let sortColumn = 'daysSinceLastCommit';
    let sortDirection = 'desc';

    // DOM Elements
    const loadingState = document.getElementById('loadingState');
    const dashboardContent = document.getElementById('dashboardContent');
    const emptyState = document.getElementById('emptyState');
    const errorBanner = document.getElementById('errorBanner');
    const errorMessage = document.getElementById('errorMessage');

    // Initialize
    requestData();
    requestFilterOptions();

    // Event Listeners
    document.getElementById('refreshBtn').addEventListener('click', () => {
      // Fast refresh from database only (no git operations)
      vscode.postMessage({ type: 'refreshFromDb' });
    });

    document.getElementById('scanBtn').addEventListener('click', () => {
      // Slow sync from Git (live git operations)
      startScan();
    });

    document.getElementById('legendToggle').addEventListener('click', function() {
      const content = document.getElementById('legendContent');
      const expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', !expanded);
      content.hidden = expanded;
    });

    document.getElementById('selectAllBtn').addEventListener('click', selectAllVisible);
    document.getElementById('deselectAllBtn').addEventListener('click', deselectAll);
    document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelected);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
    document.getElementById('prevPage').addEventListener('click', () => changePage(-1));
    document.getElementById('nextPage').addEventListener('click', () => changePage(1));

    // Filter change handlers
    document.getElementById('repositoryFilter').addEventListener('change', applyFilters);
    document.getElementById('riskFilter').addEventListener('change', applyFilters);
    document.getElementById('statusFilter').addEventListener('change', applyFilters);
    document.getElementById('minAgeFilter').addEventListener('input', debounce(applyFilters, 500));
    document.getElementById('searchFilter').addEventListener('input', debounce(applyFilters, 300));

    // Table header sorting
    document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => handleSort(th.dataset.sort));
      th.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSort(th.dataset.sort);
        }
      });
    });

    // Select all checkbox
    document.getElementById('selectAllCheckbox').addEventListener('change', (e) => {
      if (e.target.checked) {
        selectAllVisible();
      } else {
        deselectAll();
      }
    });

    // Message handler
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'branchData':
          handleBranchData(message);
          break;
        case 'filterOptions':
          handleFilterOptions(message);
          break;
        case 'deleteResult':
          handleDeleteResult(message);
          break;
        case 'scanProgress':
          handleScanProgress(message);
          break;
        case 'scanComplete':
          handleScanComplete(message);
          break;
        case 'error':
          showError(message.message);
          break;
      }
    });

    function requestData() {
      loadingState.style.display = 'flex';
      dashboardContent.style.display = 'none';
      emptyState.style.display = 'none';
      vscode.postMessage({ type: 'requestBranchData' });
    }

    function requestFilterOptions() {
      vscode.postMessage({ type: 'requestFilterOptions' });
    }

    function startScan() {
      const scanBtn = document.getElementById('scanBtn');
      const scanBtnText = document.getElementById('scanBtnText');
      const scanSpinner = document.getElementById('scanSpinner');
      const scanStatus = document.getElementById('scanStatus');

      // Disable button and show spinner with accessibility attributes
      scanBtn.disabled = true;
      scanBtn.setAttribute('aria-busy', 'true');
      scanBtnText.textContent = 'Scanning...';
      scanSpinner.hidden = false;
      scanStatus.textContent = 'Scanning repositories for branches...';

      vscode.postMessage({ type: 'scanBranches' });
    }

    function handleScanProgress(message) {
      const scanBtnText = document.getElementById('scanBtnText');
      const scanStatus = document.getElementById('scanStatus');
      const statusText = 'Scanning ' + message.current + '/' + message.total + '...';
      scanBtnText.textContent = statusText;
      scanStatus.textContent = statusText;
    }

    function handleScanComplete(message) {
      const scanBtn = document.getElementById('scanBtn');
      const scanBtnText = document.getElementById('scanBtnText');
      const scanSpinner = document.getElementById('scanSpinner');
      const scanStatus = document.getElementById('scanStatus');

      // Re-enable button and hide spinner
      scanBtn.disabled = false;
      scanBtn.removeAttribute('aria-busy');
      scanBtnText.textContent = 'Sync from Git';
      scanSpinner.hidden = true;

      if (message.success) {
        // GITX-235: Show both total branches and cleanup candidates in success message
        // Format: "Scan complete: X total branches in Y repositories (Z cleanup candidates)"
        let successMsg = 'Scan complete: ' + message.branchesFound + ' total branches in ' + message.repositoriesScanned + ' repositories';
        if (typeof message.cleanupCandidates === 'number') {
          successMsg += ' (' + message.cleanupCandidates + ' cleanup candidates)';
        }
        scanStatus.textContent = successMsg;
        showSuccess(successMsg);
        console.log(successMsg);
      } else if (message.error) {
        scanStatus.textContent = 'Scan failed: ' + message.error;
        showError(message.error);
      }
    }

    function handleBranchData(data) {
      loadingState.style.display = 'none';
      branchData = data;

      // Update data freshness indicator
      if (data.lastUpdated) {
        updateDataFreshness(data.lastUpdated);
      }

      if (!data.hasData || data.branches.length === 0) {
        emptyState.style.display = 'block';
        dashboardContent.style.display = 'none';
        return;
      }

      dashboardContent.style.display = 'block';
      emptyState.style.display = 'none';

      // Update KPIs
      updateKPIs(data.summary);

      // Render charts
      renderRiskDonutChart(data.riskDistribution);
      renderRepoBarChart(data.repositoryBreakdown);

      // Apply filters and render table
      applyFilters();
    }

    function updateDataFreshness(lastUpdatedIso) {
      const dataFreshness = document.getElementById('dataFreshness');
      const lastUpdatedEl = document.getElementById('lastUpdated');
      const freshnessIndicator = document.getElementById('freshnessIndicator');

      if (!lastUpdatedIso) {
        dataFreshness.hidden = true;
        return;
      }

      dataFreshness.hidden = false;

      const lastUpdated = new Date(lastUpdatedIso);
      const now = new Date();
      const hoursAgo = (now - lastUpdated) / (1000 * 60 * 60);

      // Format the timestamp
      const timeAgo = formatTimeAgo(lastUpdated);
      lastUpdatedEl.textContent = 'Data from: ' + timeAgo;

      // Color-code freshness (green: <1 hour, yellow: 1-24 hours, red: >24 hours)
      freshnessIndicator.className = 'freshness-badge';
      if (hoursAgo < 1) {
        freshnessIndicator.classList.add('freshness-green');
        freshnessIndicator.textContent = 'Fresh';
        freshnessIndicator.title = 'Data is less than 1 hour old';
      } else if (hoursAgo < 24) {
        freshnessIndicator.classList.add('freshness-yellow');
        freshnessIndicator.textContent = 'Recent';
        freshnessIndicator.title = 'Data is ' + Math.round(hoursAgo) + ' hours old';
      } else {
        freshnessIndicator.classList.add('freshness-red');
        freshnessIndicator.textContent = 'Stale';
        freshnessIndicator.title = 'Data is ' + Math.round(hoursAgo / 24) + ' days old - consider syncing from Git';
      }
    }

    function formatTimeAgo(date) {
      const now = new Date();
      const seconds = Math.floor((now - date) / 1000);

      if (seconds < 60) {
        return 'just now';
      }

      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) {
        return minutes + ' minute' + (minutes === 1 ? '' : 's') + ' ago';
      }

      const hours = Math.floor(minutes / 60);
      if (hours < 24) {
        return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
      }

      const days = Math.floor(hours / 24);
      if (days < 7) {
        return days + ' day' + (days === 1 ? '' : 's') + ' ago';
      }

      const weeks = Math.floor(days / 7);
      if (weeks < 4) {
        return weeks + ' week' + (weeks === 1 ? '' : 's') + ' ago';
      }

      const months = Math.floor(days / 30);
      return months + ' month' + (months === 1 ? '' : 's') + ' ago';
    }

    function handleFilterOptions(options) {
      // Populate repository filter
      const repoSelect = document.getElementById('repositoryFilter');
      repoSelect.innerHTML = '<option value="">All Repositories</option>';
      options.repositories.forEach(repo => {
        const option = document.createElement('option');
        option.value = repo;
        option.textContent = repo;
        repoSelect.appendChild(option);
      });

      // Populate risk level filter
      const riskSelect = document.getElementById('riskFilter');
      riskSelect.innerHTML = '<option value="">All Risk Levels</option>';
      options.riskLevels.forEach(risk => {
        const option = document.createElement('option');
        option.value = risk;
        option.textContent = formatRiskLevel(risk);
        riskSelect.appendChild(option);
      });

      // Populate status filter
      const statusSelect = document.getElementById('statusFilter');
      statusSelect.innerHTML = '<option value="">All Statuses</option>';
      options.statuses.forEach(status => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = formatStatus(status);
        statusSelect.appendChild(option);
      });
    }

    function handleDeleteResult(result) {
      if (result.success) {
        showSuccess('Branches deleted successfully');
        selectedBranches.clear();
        requestData(); // Refresh data
      } else {
        const failed = result.results.filter(r => !r.success);
        const errorMsg = 'Failed to delete ' + failed.length + ' branch(es): ' +
          failed.map(r => r.branchName + ' (' + r.error + ')').join(', ');
        showError(errorMsg);
      }
    }

    function updateKPIs(summary) {
      document.getElementById('kpiTotal').textContent = summary.total.toLocaleString();
      document.getElementById('kpiMerged').textContent = summary.merged.toLocaleString();
      document.getElementById('kpiStale').textContent = summary.stale.toLocaleString();
      document.getElementById('kpiOrphaned').textContent = summary.orphaned.toLocaleString();
    }

    function renderRiskDonutChart(distribution) {
      const container = document.getElementById('riskDonutChart');
      container.innerHTML = '';

      const width = container.clientWidth;
      const height = 300;
      const radius = Math.min(width, height) / 2 - 20;

      const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', 'translate(' + width/2 + ',' + height/2 + ')');

      const data = [
        { label: 'Safe', value: distribution.safe, color: '#28a745' },
        { label: 'Low', value: distribution.low, color: '#5cb85c' },
        { label: 'Medium', value: distribution.medium, color: '#f0ad4e' },
        { label: 'High', value: distribution.high, color: '#d9534f' }
      ].filter(d => d.value > 0);

      if (data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--vscode-descriptionForeground); padding: 40px;">No branches to display</p>';
        return;
      }

      const pie = d3.pie().value(d => d.value).sort(null);
      const arc = d3.arc().innerRadius(radius * 0.6).outerRadius(radius);

      const arcs = svg.selectAll('arc')
        .data(pie(data))
        .enter()
        .append('g');

      arcs.append('path')
        .attr('d', arc)
        .attr('fill', d => d.data.color)
        .attr('stroke', 'var(--vscode-editor-background)')
        .attr('stroke-width', 2);

      // Center text
      const total = data.reduce((sum, d) => sum + d.value, 0);
      svg.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '-0.2em')
        .style('font-size', '24px')
        .style('font-weight', 'bold')
        .style('fill', 'var(--vscode-foreground)')
        .text(total);

      svg.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '1.2em')
        .style('font-size', '12px')
        .style('fill', 'var(--vscode-descriptionForeground)')
        .text('Total Branches');

      // Legend
      const legend = svg.selectAll('.legend')
        .data(data)
        .enter()
        .append('g')
        .attr('transform', (d, i) => 'translate(' + (radius + 10) + ',' + (i * 20 - data.length * 10) + ')');

      legend.append('rect')
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', d => d.color);

      legend.append('text')
        .attr('x', 18)
        .attr('y', 10)
        .style('font-size', '12px')
        .style('fill', 'var(--vscode-foreground)')
        .text(d => d.label + ' (' + d.value + ')');
    }

    function renderRepoBarChart(breakdown) {
      const container = document.getElementById('repoBarChart');
      container.innerHTML = '';

      if (!breakdown || breakdown.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--vscode-descriptionForeground); padding: 40px;">No data available</p>';
        return;
      }

      const margin = { top: 20, right: 100, bottom: 40, left: 150 };
      const width = container.clientWidth - margin.left - margin.right;
      const height = Math.max(breakdown.length * 40, 200);

      const svg = d3.select(container)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

      const y = d3.scaleBand()
        .domain(breakdown.map(d => d.repository))
        .range([0, height])
        .padding(0.2);

      const maxTotal = d3.max(breakdown, d => d.safe + d.low + d.medium + d.high);
      const x = d3.scaleLinear()
        .domain([0, maxTotal])
        .range([0, width]);

      // Stacked bars
      const colors = {
        safe: '#28a745',
        low: '#5cb85c',
        medium: '#f0ad4e',
        high: '#d9534f'
      };

      breakdown.forEach(repo => {
        let xOffset = 0;

        ['safe', 'low', 'medium', 'high'].forEach(risk => {
          const value = repo[risk];
          if (value > 0) {
            svg.append('rect')
              .attr('x', x(xOffset))
              .attr('y', y(repo.repository))
              .attr('width', x(value))
              .attr('height', y.bandwidth())
              .attr('fill', colors[risk]);

            // Add count label if segment is wide enough
            if (x(value) > 30) {
              svg.append('text')
                .attr('x', x(xOffset) + x(value) / 2)
                .attr('y', y(repo.repository) + y.bandwidth() / 2)
                .attr('dy', '0.35em')
                .attr('text-anchor', 'middle')
                .style('font-size', '11px')
                .style('font-weight', '500')
                .style('fill', 'white')
                .text(value);
            }

            xOffset += value;
          }
        });
      });

      // Y axis (repository names)
      svg.append('g')
        .call(d3.axisLeft(y))
        .selectAll('text')
        .style('fill', 'var(--vscode-foreground)')
        .style('font-size', '12px');

      // X axis
      svg.append('g')
        .attr('transform', 'translate(0,' + height + ')')
        .call(d3.axisBottom(x))
        .selectAll('text')
        .style('fill', 'var(--vscode-foreground)');

      // Legend
      const legend = svg.selectAll('.legend')
        .data(['safe', 'low', 'medium', 'high'])
        .enter()
        .append('g')
        .attr('transform', (d, i) => 'translate(' + (width + 10) + ',' + (i * 20) + ')');

      legend.append('rect')
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', d => colors[d]);

      legend.append('text')
        .attr('x', 18)
        .attr('y', 10)
        .style('font-size', '11px')
        .style('fill', 'var(--vscode-foreground)')
        .text(d => formatRiskLevel(d));
    }

    function applyFilters() {
      if (!branchData) return;

      const repoFilter = document.getElementById('repositoryFilter').value;
      const riskFilter = document.getElementById('riskFilter').value;
      const statusFilter = document.getElementById('statusFilter').value;
      const minAge = parseInt(document.getElementById('minAgeFilter').value) || 0;
      const search = document.getElementById('searchFilter').value.toLowerCase();

      filteredBranches = branchData.branches.filter(branch => {
        if (repoFilter && branch.repository !== repoFilter) return false;
        if (riskFilter && branch.riskLevel !== riskFilter) return false;
        if (statusFilter && branch.status !== statusFilter) return false;
        if (branch.daysSinceLastCommit < minAge) return false;
        if (search && !branch.branchName.toLowerCase().includes(search)) return false;
        return true;
      });

      currentPage = 1;
      renderBranchTable();
    }

    function renderBranchTable() {
      const tbody = document.getElementById('branchTableBody');
      tbody.innerHTML = '';

      // Sort data
      const sorted = [...filteredBranches].sort((a, b) => {
        let aVal = a[sortColumn];
        let bVal = b[sortColumn];

        if (sortColumn === 'lastCommitDate') {
          aVal = new Date(aVal);
          bVal = new Date(bVal);
        }

        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });

      // Paginate
      const start = (currentPage - 1) * pageSize;
      const pageData = sorted.slice(start, start + pageSize);

      // Render rows
      pageData.forEach(branch => {
        const tr = document.createElement('tr');

        // Checkbox
        const tdCheck = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = branch.branchName;
        checkbox.dataset.repository = branch.repository;
        checkbox.checked = selectedBranches.has(branch.branchName + '|' + branch.repository);
        checkbox.addEventListener('change', (e) => {
          const key = branch.branchName + '|' + branch.repository;
          if (e.target.checked) {
            selectedBranches.add(key);
          } else {
            selectedBranches.delete(key);
          }
          updateDeleteButton();
        });
        tdCheck.appendChild(checkbox);
        tr.appendChild(tdCheck);

        // Branch name
        const tdName = document.createElement('td');
        tdName.textContent = branch.branchName;
        tdName.className = 'branch-name';
        tr.appendChild(tdName);

        // Repository
        const tdRepo = document.createElement('td');
        tdRepo.textContent = branch.repository;
        tr.appendChild(tdRepo);

        // Risk level badge
        const tdRisk = document.createElement('td');
        const riskBadge = document.createElement('span');
        riskBadge.className = 'risk-badge risk-' + branch.riskLevel;
        riskBadge.textContent = formatRiskLevel(branch.riskLevel);
        tdRisk.appendChild(riskBadge);
        tr.appendChild(tdRisk);

        // Status badge with tooltip
        const tdStatus = document.createElement('td');
        const statusBadge = document.createElement('span');
        statusBadge.className = 'status-badge status-' + branch.status;
        statusBadge.textContent = formatStatus(branch.status);
        statusBadge.title = branch.tooltip;
        tdStatus.appendChild(statusBadge);
        tr.appendChild(tdStatus);

        // Days inactive
        const tdDays = document.createElement('td');
        tdDays.textContent = branch.daysSinceLastCommit;
        tr.appendChild(tdDays);

        // Last author
        const tdAuthor = document.createElement('td');
        tdAuthor.textContent = branch.lastCommitAuthor;
        tr.appendChild(tdAuthor);

        // Last commit (date + SHA link)
        const tdCommit = document.createElement('td');
        const commitDate = new Date(branch.lastCommitDate).toLocaleDateString();
        const shaLink = document.createElement('a');
        shaLink.className = 'sha-link';
        shaLink.textContent = branch.lastCommitSha.substring(0, 7);
        shaLink.href = '#';
        shaLink.title = 'View commit ' + branch.lastCommitSha.substring(0, 7);
        shaLink.onclick = (e) => {
          e.preventDefault();
          const url = 'https://github.com/' + githubOrg + '/' + branch.repository + '/commit/' + branch.lastCommitSha;
          vscode.postMessage({ type: 'openExternal', url });
        };
        tdCommit.textContent = commitDate + ' ';
        tdCommit.appendChild(shaLink);
        tr.appendChild(tdCommit);

        tbody.appendChild(tr);
      });

      // Update pagination
      const totalPages = Math.ceil(filteredBranches.length / pageSize);
      document.getElementById('pageInfo').textContent = 'Page ' + currentPage + ' of ' + Math.max(totalPages, 1) + ' (' + filteredBranches.length + ' branches)';
      document.getElementById('prevPage').disabled = currentPage <= 1;
      document.getElementById('nextPage').disabled = currentPage >= totalPages;

      // Update sort indicators
      document.querySelectorAll('.data-table th').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        th.setAttribute('aria-sort', 'none');
        if (th.dataset.sort === sortColumn) {
          th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
          th.setAttribute('aria-sort', sortDirection === 'asc' ? 'ascending' : 'descending');
        }
      });

      updateDeleteButton();
    }

    function handleSort(column) {
      if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = column;
        sortDirection = column === 'daysSinceLastCommit' || column === 'lastCommitDate' ? 'desc' : 'asc';
      }
      currentPage = 1;
      renderBranchTable();
    }

    function changePage(delta) {
      const totalPages = Math.ceil(filteredBranches.length / pageSize);
      currentPage = Math.max(1, Math.min(totalPages, currentPage + delta));
      renderBranchTable();
    }

    function selectAllVisible() {
      filteredBranches.forEach(branch => {
        selectedBranches.add(branch.branchName + '|' + branch.repository);
      });
      renderBranchTable();
    }

    function deselectAll() {
      selectedBranches.clear();
      renderBranchTable();
    }

    function deleteSelected() {
      if (selectedBranches.size === 0) return;

      const branches = Array.from(selectedBranches).map(key => {
        const [name, repo] = key.split('|');
        return { name, repo };
      });

      // Group by repository
      const byRepo = {};
      branches.forEach(b => {
        if (!byRepo[b.repo]) byRepo[b.repo] = [];
        byRepo[b.repo].push(b.name);
      });

      // Confirm deletion
      const count = selectedBranches.size;
      const repoList = Object.keys(byRepo).map(repo => repo + ': ' + byRepo[repo].join(', ')).join('\\n');
      const message = 'Delete ' + count + ' branch(es)?\\n\\n' + repoList + '\\n\\nThis action cannot be undone.';

      if (!confirm(message)) return;

      // Send deletion request for each repository
      Object.entries(byRepo).forEach(([repo, branchNames]) => {
        vscode.postMessage({
          type: 'deleteBranches',
          branches: branchNames,
          repository: repo,
          force: false
        });
      });
    }

    function exportCsv() {
      if (filteredBranches.length === 0) {
        showError('No branches to export');
        return;
      }

      // CSV headers matching branch data fields
      const headers = [
        'Branch Name',
        'Repository',
        'Risk Level',
        'Status',
        'Days Inactive',
        'Last Author',
        'Last Commit Date',
        'Last Commit SHA',
        'Commit Count',
        'Merged Into'
      ];

      // RFC 4180 CSV escape function
      function escapeCsvField(value) {
        const s = String(value ?? '');
        // If field contains comma, quote, or newline, wrap in quotes and escape quotes
        if (s.includes(',') || s.includes('"') || s.includes('\\n') || s.includes('\\r')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }

      // Convert branch data to CSV rows
      const rows = filteredBranches.map(function(b) {
        return [
          escapeCsvField(b.branchName),
          escapeCsvField(b.repository),
          escapeCsvField(formatRiskLevel(b.riskLevel)),
          escapeCsvField(formatStatus(b.status)),
          escapeCsvField(b.daysSinceLastCommit),
          escapeCsvField(b.lastCommitAuthor),
          escapeCsvField(new Date(b.lastCommitDate).toISOString()),
          escapeCsvField(b.lastCommitSha),
          escapeCsvField(b.commitCount ?? ''),
          escapeCsvField(b.mergedInto ?? '')
        ].join(',');
      });

      // Combine headers and rows into CSV content
      const csvContent = [headers.join(',')].concat(rows).join('\\n');

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = 'dead-branches-' + timestamp + '.csv';

      // Send message with correct format expected by shared-message-handlers.ts
      vscode.postMessage({
        type: 'exportCsv',
        csvContent: csvContent,
        filename: filename,
        source: 'dead-branches'
      });
    }

    function clearFilters() {
      document.getElementById('repositoryFilter').value = '';
      document.getElementById('riskFilter').value = '';
      document.getElementById('statusFilter').value = '';
      document.getElementById('minAgeFilter').value = '';
      document.getElementById('searchFilter').value = '';
    }

    function updateDeleteButton() {
      const btn = document.getElementById('deleteSelectedBtn');
      btn.disabled = selectedBranches.size === 0;
      if (selectedBranches.size > 0) {
        btn.textContent = 'Delete Selected (' + selectedBranches.size + ')';
      } else {
        btn.textContent = 'Delete Selected';
      }
    }

    function formatRiskLevel(risk) {
      const map = {
        safe: 'Safe',
        low: 'Low',
        medium: 'Medium',
        high: 'High'
      };
      return map[risk] || risk;
    }

    function formatStatus(status) {
      const map = {
        merged: 'Merged',
        stale: 'Stale',
        orphaned: 'Orphaned',
        active: 'Active'
      };
      return map[status] || status;
    }

    function showError(message) {
      errorMessage.textContent = message;
      errorBanner.classList.add('visible');
      setTimeout(() => {
        errorBanner.classList.remove('visible');
      }, 10000);
    }

    function showSuccess(message) {
      // Use info banner if available, otherwise reuse error banner with different styling
      errorMessage.textContent = message;
      errorBanner.style.backgroundColor = 'var(--vscode-statusBarItem-prominentBackground)';
      errorBanner.classList.add('visible');
      setTimeout(() => {
        errorBanner.classList.remove('visible');
        errorBanner.style.backgroundColor = '';
      }, 5000);
    }

    function debounce(func, wait) {
      let timeout;
      return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }
  </script>
</body>
</html>`;
}
