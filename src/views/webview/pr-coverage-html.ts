/**
 * HTML generator for the PR Coverage Report dashboard webview.
 *
 * Generates a complete HTML document with:
 * - Hero metric: Overall PR coverage percentage with trend indicator
 * - KPI cards: Total commits, PR-linked, orphans, repos analyzed
 * - D3.js donut chart for coverage visualization
 * - Line chart for weekly coverage trend
 * - Horizontal stacked bar chart for contributor compliance
 * - Horizontal stacked bar chart for team compliance
 * - Branch compliance breakdown
 * - Methodology explainer (collapsible)
 * - Sortable, paginated orphan commits table
 * - Filter controls (repository, author, branch, date range)
 * - Empty states and error handling
 * - Accessibility features (ARIA labels, keyboard navigation)
 * - VS Code theme integration
 * - CSP compliance via nonce
 *
 * Tickets: GITX-221, GITX-223
 */

import type { Uri } from 'vscode';

/**
 * Parameters for HTML generation.
 */
export interface PRCoverageHtmlParams {
  /** CSP nonce for script authorization */
  readonly nonce: string;
  /** URI to the bundled D3.js library */
  readonly d3Uri: Uri;
  /** URI to the dashboard CSS */
  readonly styleUri: Uri;
  /** CSP source for the webview */
  readonly cspSource: string;
  /** GitHub organization for commit links */
  readonly githubOrg: string;
}

/**
 * Generate the complete HTML for the PR Coverage Report dashboard.
 *
 * @param params - HTML generation parameters
 * @returns Complete HTML document string
 */
export function generatePRCoverageHtml(params: PRCoverageHtmlParams): string {
  const { nonce, d3Uri, styleUri, cspSource, githubOrg } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; font-src ${cspSource};">
  <title>PR Coverage Report</title>
  <link rel="stylesheet" href="${styleUri}">
  <style nonce="${nonce}">
    /* VS Code theme integration */
    :root {
      --vscode-font-family: var(--vscode-editor-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      --coverage-good: #4caf50;
      --coverage-warning: #ff9800;
      --coverage-bad: #f44336;
    }

    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 16px;
      margin: 0;
    }

    .dashboard-container {
      max-width: 1400px;
      margin: 0 auto;
    }

    /* Header */
    .dashboard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }

    .dashboard-title {
      font-size: 24px;
      font-weight: 600;
      margin: 0;
    }

    /* Filters */
    .filters-container {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .filter-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .filter-select, .filter-input {
      padding: 6px 10px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-size: 13px;
      min-width: 140px;
    }

    .filter-select:focus, .filter-input:focus {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    /* Hero Metric */
    .hero-section {
      text-align: center;
      padding: 32px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      margin-bottom: 24px;
    }

    .hero-percentage {
      font-size: 72px;
      font-weight: 700;
      margin: 0;
      line-height: 1;
    }

    .hero-percentage.good { color: var(--coverage-good); }
    .hero-percentage.warning { color: var(--coverage-warning); }
    .hero-percentage.bad { color: var(--coverage-bad); }

    .hero-label {
      font-size: 16px;
      color: var(--vscode-descriptionForeground);
      margin-top: 8px;
    }

    .hero-trend {
      font-size: 14px;
      margin-top: 12px;
    }

    .trend-up { color: var(--coverage-good); }
    .trend-down { color: var(--coverage-bad); }
    .trend-flat { color: var(--vscode-descriptionForeground); }

    /* KPI Cards */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .kpi-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 20px;
      text-align: center;
    }

    .kpi-value {
      font-size: 32px;
      font-weight: 600;
      margin: 0;
    }

    .kpi-label {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }

    /* Charts Grid */
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 24px;
      margin-bottom: 24px;
    }

    .chart-container {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 20px;
    }

    .chart-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }

    .chart-svg {
      width: 100%;
      height: 300px;
    }

    /* Orphan Commits Table */
    .table-section {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }

    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .table-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0;
    }

    .table-actions {
      display: flex;
      gap: 8px;
    }

    .btn {
      padding: 6px 12px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
      transition: background-color 0.1s;
    }

    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .btn:focus {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .data-table th {
      text-align: left;
      padding: 12px 8px;
      border-bottom: 2px solid var(--vscode-panel-border);
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }

    .data-table th:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .data-table th.sorted-asc::after { content: ' \\25B2'; }
    .data-table th.sorted-desc::after { content: ' \\25BC'; }

    .data-table td {
      padding: 10px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      vertical-align: middle;
    }

    .data-table tr:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .sha-link {
      font-family: var(--vscode-editor-font-family);
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      cursor: pointer;
    }

    .sha-link:hover {
      text-decoration: underline;
    }

    .sha-link:focus {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .commit-message {
      max-width: 300px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Pagination */
    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
    }

    .page-info {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }

    /* Empty States */
    .empty-state {
      text-align: center;
      padding: 48px;
      color: var(--vscode-descriptionForeground);
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }

    .empty-state-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 8px 0;
      color: var(--vscode-foreground);
    }

    .empty-state-message {
      margin: 0 0 16px 0;
    }

    /* Loading State */
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px;
    }

    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--vscode-editor-inactiveSelectionBackground);
      border-top-color: var(--vscode-progressBar-background);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-text {
      margin-top: 16px;
      color: var(--vscode-descriptionForeground);
    }

    /* Error Banner */
    .error-banner {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-inputValidation-errorForeground);
      padding: 12px 16px;
      border-radius: 4px;
      margin-bottom: 16px;
      display: none;
    }

    .error-banner.visible {
      display: block;
    }

    /* Success State */
    .success-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--coverage-good);
      color: white;
      border-radius: 20px;
      font-weight: 500;
    }

    /* Methodology Section */
    .methodology-section {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      margin-bottom: 24px;
      overflow: hidden;
    }

    .methodology-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px 20px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
    }

    .methodology-toggle:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .methodology-toggle:focus {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: -2px;
    }

    .toggle-icon {
      transition: transform 0.2s ease;
    }

    .methodology-toggle[aria-expanded="true"] .toggle-icon {
      transform: rotate(90deg);
    }

    .methodology-content {
      padding: 0 20px 20px 20px;
    }

    .methodology-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }

    .methodology-item {
      background: var(--vscode-editor-background);
      padding: 16px;
      border-radius: 6px;
    }

    .methodology-item h3 {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 8px 0;
    }

    .methodology-item p {
      font-size: 13px;
      margin: 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }

    .methodology-item code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }

    /* Accessibility */
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .charts-grid {
        grid-template-columns: 1fr;
      }

      .hero-percentage {
        font-size: 48px;
      }

      .kpi-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  </style>
</head>
<body>
  <div class="dashboard-container" role="main">
    <!-- Error Banner -->
    <div id="errorBanner" class="error-banner" role="alert" aria-live="polite">
      <span id="errorMessage"></span>
    </div>

    <!-- Header with Filters -->
    <header class="dashboard-header">
      <h1 class="dashboard-title">PR Coverage Report</h1>
      <div class="filters-container" role="search" aria-label="Filter controls">
        <div class="filter-group">
          <label class="filter-label" for="repositoryFilter">Repository</label>
          <select id="repositoryFilter" class="filter-select" aria-label="Filter by repository">
            <option value="">All Repositories</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="filter-label" for="authorFilter">Contributor</label>
          <select id="authorFilter" class="filter-select" aria-label="Filter by contributor">
            <option value="">All Contributors</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="filter-label" for="branchFilter">Branch</label>
          <select id="branchFilter" class="filter-select" aria-label="Filter by branch">
            <option value="">All Branches</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="filter-label" for="startDate">Start Date</label>
          <input type="date" id="startDate" class="filter-input" aria-label="Start date">
        </div>
        <div class="filter-group">
          <label class="filter-label" for="endDate">End Date</label>
          <input type="date" id="endDate" class="filter-input" aria-label="End date">
        </div>
        <div class="filter-group" style="justify-content: flex-end;">
          <label class="filter-label">&nbsp;</label>
          <button id="applyFilters" class="btn btn-primary" aria-label="Apply filters">Apply</button>
        </div>
      </div>
    </header>

    <!-- Loading State -->
    <div id="loadingState" class="loading-container">
      <div class="loading-spinner" aria-hidden="true"></div>
      <div class="loading-text" role="status">Loading PR coverage data...</div>
    </div>

    <!-- Empty State: No Commits -->
    <div id="emptyStateNoCommits" class="empty-state" style="display: none;">
      <div class="empty-state-icon" aria-hidden="true">📊</div>
      <h2 class="empty-state-title">No Commit Data</h2>
      <p class="empty-state-message">Run the pipeline to extract commit data from your repositories.</p>
      <button class="btn btn-primary" onclick="vscode.postMessage({type: 'runPipeline'})">Run Pipeline</button>
    </div>

    <!-- Empty State: No PR Data -->
    <div id="emptyStateNoPRs" class="empty-state" style="display: none;">
      <div class="empty-state-icon" aria-hidden="true">🔗</div>
      <h2 class="empty-state-title">No Pull Request Data</h2>
      <p class="empty-state-message">Sync pull requests from GitHub to correlate commits with PRs.</p>
      <button id="syncPRsBtn" class="btn btn-primary">Sync GitHub PRs</button>
    </div>

    <!-- Dashboard Content -->
    <div id="dashboardContent" style="display: none;">
      <!-- Hero Section -->
      <section class="hero-section" aria-label="Overall coverage metric">
        <p id="heroCoverage" class="hero-percentage good" aria-live="polite">--</p>
        <p class="hero-label">PR Coverage</p>
        <p id="heroTrend" class="hero-trend trend-flat" aria-live="polite"></p>
      </section>

      <!-- KPI Cards -->
      <section class="kpi-grid" aria-label="Key metrics">
        <div class="kpi-card">
          <p id="kpiTotalCommits" class="kpi-value" aria-live="polite">--</p>
          <p class="kpi-label">Total Commits</p>
        </div>
        <div class="kpi-card">
          <p id="kpiLinkedCommits" class="kpi-value" aria-live="polite">--</p>
          <p class="kpi-label">PR-Linked</p>
        </div>
        <div class="kpi-card">
          <p id="kpiOrphanCommits" class="kpi-value" aria-live="polite">--</p>
          <p class="kpi-label">Orphan Commits</p>
        </div>
        <div class="kpi-card">
          <p id="kpiReposAnalyzed" class="kpi-value" aria-live="polite">--</p>
          <p class="kpi-label">Repositories</p>
        </div>
      </section>

      <!-- Charts -->
      <section class="charts-grid" aria-label="Charts">
        <div class="chart-container">
          <h2 class="chart-title">Coverage Trend</h2>
          <div id="trendChart" class="chart-svg" role="img" aria-label="Line chart showing weekly PR coverage trend"></div>
        </div>
        <div class="chart-container">
          <h2 class="chart-title">Coverage Distribution</h2>
          <div id="donutChart" class="chart-svg" role="img" aria-label="Donut chart showing PR-linked vs orphan commits"></div>
        </div>
        <div class="chart-container">
          <h2 class="chart-title">Contributor Compliance</h2>
          <div id="authorChart" class="chart-svg" role="img" aria-label="Horizontal bar chart showing PR coverage by contributor"></div>
        </div>
        <div class="chart-container">
          <h2 class="chart-title">Team Compliance</h2>
          <div id="teamChart" class="chart-svg" role="img" aria-label="Horizontal bar chart showing PR coverage by team"></div>
        </div>
        <div class="chart-container">
          <h2 class="chart-title">Coverage by Branch</h2>
          <div id="branchChart" class="chart-svg" role="img" aria-label="Horizontal bar chart showing PR coverage by branch"></div>
        </div>
      </section>

      <!-- Methodology Explainer -->
      <section class="methodology-section" aria-label="Methodology explanation">
        <button
          id="methodologyToggle"
          class="methodology-toggle"
          aria-expanded="false"
          aria-controls="methodologyContent"
        >
          <span class="toggle-icon" aria-hidden="true">▶</span>
          <span>How PR Coverage Works</span>
        </button>
        <div id="methodologyContent" class="methodology-content" hidden>
          <div class="methodology-grid">
            <div class="methodology-item">
              <h3>How Commits are Linked to PRs</h3>
              <p>Commits are linked to pull requests when the commit SHA matches a PR's <code>merge_sha</code> field. This happens when a PR is merged using GitHub's merge button.</p>
            </div>
            <div class="methodology-item">
              <h3>What's Counted</h3>
              <p>Only non-merge commits are included in coverage calculations. Merge commits are auto-generated by Git and don't represent actual code changes.</p>
            </div>
            <div class="methodology-item">
              <h3>Orphan Commits</h3>
              <p>Commits that bypassed the PR workflow and were pushed directly to the branch. These represent code changes that skipped code review.</p>
            </div>
            <div class="methodology-item">
              <h3>Coverage Formula</h3>
              <p><code>Coverage % = (PR-linked commits ÷ Total non-merge commits) × 100</code></p>
            </div>
          </div>
        </div>
      </section>

      <!-- Orphan Commits Table -->
      <section class="table-section" aria-label="Orphan commits">
        <div class="table-header">
          <h2 class="table-title">Orphan Commits</h2>
          <div class="table-actions">
            <button id="exportCsvBtn" class="btn btn-secondary" aria-label="Export orphan commits to CSV">Export CSV</button>
          </div>
        </div>
        <div id="orphanTableContainer" role="region" aria-label="Orphan commits table" tabindex="0">
          <table class="data-table" aria-describedby="tableDescription">
            <caption id="tableDescription" class="visually-hidden">Table of commits that were made without an associated pull request</caption>
            <thead>
              <tr>
                <th scope="col" data-sort="sha" tabindex="0" role="columnheader" aria-sort="none">SHA</th>
                <th scope="col" data-sort="author" tabindex="0" role="columnheader" aria-sort="none">Author</th>
                <th scope="col" data-sort="commitDate" tabindex="0" role="columnheader" aria-sort="none">Date</th>
                <th scope="col" data-sort="branch" tabindex="0" role="columnheader" aria-sort="none">Branch</th>
                <th scope="col" data-sort="repository" tabindex="0" role="columnheader" aria-sort="none">Repository</th>
                <th scope="col" data-sort="commitMessage" tabindex="0" role="columnheader" aria-sort="none">Message</th>
              </tr>
            </thead>
            <tbody id="orphanTableBody">
              <!-- Rows populated by JavaScript -->
            </tbody>
          </table>
        </div>
        <nav class="pagination" aria-label="Table pagination">
          <button id="prevPage" class="btn btn-secondary" aria-label="Previous page">&lt; Prev</button>
          <span id="pageInfo" class="page-info" aria-live="polite">Page 1 of 1</span>
          <button id="nextPage" class="btn btn-secondary" aria-label="Next page">Next &gt;</button>
        </nav>
      </section>

      <!-- 100% Coverage Success State -->
      <div id="successState" class="empty-state" style="display: none;">
        <div class="success-badge" role="status">
          <span aria-hidden="true">✓</span>
          <span>100% PR Coverage!</span>
        </div>
        <p class="empty-state-message" style="margin-top: 16px;">
          All commits in the selected range are associated with pull requests.
        </p>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${d3Uri}"></script>
  <script nonce="${nonce}">
    // VS Code API
    const vscode = acquireVsCodeApi();

    // GitHub org for commit links (JSON.stringify for XSS prevention)
    const githubOrg = ${JSON.stringify(githubOrg)};

    // State
    let coverageData = null;
    let orphanCommits = [];
    let currentPage = 1;
    const pageSize = 20;
    let sortColumn = 'commitDate';
    let sortDirection = 'desc';

    // DOM Elements
    const loadingState = document.getElementById('loadingState');
    const dashboardContent = document.getElementById('dashboardContent');
    const emptyStateNoCommits = document.getElementById('emptyStateNoCommits');
    const emptyStateNoPRs = document.getElementById('emptyStateNoPRs');
    const successState = document.getElementById('successState');
    const errorBanner = document.getElementById('errorBanner');
    const errorMessage = document.getElementById('errorMessage');

    // Initialize
    requestData();
    requestFilterOptions();

    // Event Listeners
    document.getElementById('applyFilters').addEventListener('click', applyFilters);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
    document.getElementById('syncPRsBtn').addEventListener('click', syncPRs);
    document.getElementById('prevPage').addEventListener('click', () => changePage(-1));
    document.getElementById('nextPage').addEventListener('click', () => changePage(1));

    // Methodology toggle
    document.getElementById('methodologyToggle').addEventListener('click', function() {
      const content = document.getElementById('methodologyContent');
      const expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', !expanded);
      content.hidden = expanded;
    });

    // Table header click handlers for sorting
    document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => handleSort(th.dataset.sort));
      th.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSort(th.dataset.sort);
        }
      });
    });

    // Filter change handlers
    document.getElementById('repositoryFilter').addEventListener('change', () => {
      requestFilterOptions(document.getElementById('repositoryFilter').value);
    });

    // Message handler
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'prCoverageData':
          handleCoverageData(message);
          break;
        case 'orphanCommitsData':
          handleOrphanCommitsData(message);
          break;
        case 'filterOptions':
          handleFilterOptions(message);
          break;
        case 'syncResult':
          handleSyncResult(message);
          break;
        case 'prCoverageError':
          showError(message.message);
          break;
      }
    });

    function requestData() {
      const filters = getFilters();
      vscode.postMessage({
        type: 'requestPRCoverageData',
        ...filters
      });
    }

    function requestFilterOptions(repository) {
      vscode.postMessage({
        type: 'requestFilterOptions',
        repository: repository || undefined
      });
    }

    function getFilters() {
      const startDate = document.getElementById('startDate').value || undefined;
      const endDate = document.getElementById('endDate').value || undefined;
      const repository = document.getElementById('repositoryFilter').value || undefined;
      const author = document.getElementById('authorFilter').value || undefined;
      const branch = document.getElementById('branchFilter').value;
      const branches = branch ? [branch] : undefined;

      return { startDate, endDate, repository, author, branches };
    }

    function applyFilters() {
      loadingState.style.display = 'flex';
      dashboardContent.style.display = 'none';
      requestData();
    }

    function handleCoverageData(data) {
      loadingState.style.display = 'none';
      coverageData = data;

      if (!data.viewExists) {
        emptyStateNoPRs.style.display = 'block';
        dashboardContent.style.display = 'none';
        return;
      }

      if (!data.hasData || data.overall.totalCommits === 0) {
        emptyStateNoCommits.style.display = 'block';
        dashboardContent.style.display = 'none';
        return;
      }

      dashboardContent.style.display = 'block';
      emptyStateNoCommits.style.display = 'none';
      emptyStateNoPRs.style.display = 'none';

      // Check for 100% coverage
      if (data.overall.coveragePercentage >= 100 && data.overall.orphanCommits === 0) {
        successState.style.display = 'block';
        document.getElementById('orphanTableContainer').parentElement.style.display = 'none';
      } else {
        successState.style.display = 'none';
        document.getElementById('orphanTableContainer').parentElement.style.display = 'block';
      }

      // Update hero metric
      updateHeroMetric(data.overall);

      // Update KPI cards
      updateKPIs(data.overall);

      // Update charts
      renderDonutChart(data.overall);
      renderTrendChart(data.weeklyTrend);
      renderAuthorChart(data.byContributor || data.byAuthor);
      renderTeamChart(data.byTeam);
      renderBranchChart(data.byBranch);

      // Update orphan commits table
      orphanCommits = data.orphanCommits;
      currentPage = 1;
      renderOrphanTable();
    }

    function handleOrphanCommitsData(data) {
      orphanCommits = data.orphanCommits;
      currentPage = 1;
      renderOrphanTable();
    }

    function handleFilterOptions(options) {
      // Populate repository dropdown
      const repoSelect = document.getElementById('repositoryFilter');
      const currentRepo = repoSelect.value;
      repoSelect.innerHTML = '<option value="">All Repositories</option>';
      options.repositories.forEach(repo => {
        const option = document.createElement('option');
        option.value = repo;
        option.textContent = repo;
        if (repo === currentRepo) option.selected = true;
        repoSelect.appendChild(option);
      });

      // Populate contributor dropdown (renamed from author)
      const authorSelect = document.getElementById('authorFilter');
      const currentAuthor = authorSelect.value;
      authorSelect.innerHTML = '<option value="">All Contributors</option>';

      // If contributors array exists (with display format), use it
      // Otherwise fallback to authors
      const contributorList = options.contributors || options.authors;
      contributorList.forEach(item => {
        const option = document.createElement('option');
        // item can be {displayName: "Full Name (login)", value: "login"} or just string
        if (typeof item === 'object') {
          option.value = item.value;
          option.textContent = item.displayName;
        } else {
          option.value = item;
          option.textContent = item;
        }
        if (option.value === currentAuthor) option.selected = true;
        authorSelect.appendChild(option);
      });

      // Populate branch dropdown
      const branchSelect = document.getElementById('branchFilter');
      const currentBranch = branchSelect.value;
      branchSelect.innerHTML = '<option value="">All Branches</option>';
      options.branches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch;
        option.textContent = branch;
        if (branch === currentBranch) option.selected = true;
        branchSelect.appendChild(option);
      });
    }

    function handleSyncResult(result) {
      if (result.success) {
        vscode.postMessage({ type: 'showInfo', message: 'PR sync complete: ' + result.linksCreated + ' links created' });
        requestData();
      } else {
        showError(result.errorMessage || 'PR sync failed');
      }
    }

    function showError(message) {
      errorMessage.textContent = message;
      errorBanner.classList.add('visible');
      loadingState.style.display = 'none';
      setTimeout(() => {
        errorBanner.classList.remove('visible');
      }, 10000);
    }

    function updateHeroMetric(overall) {
      const heroEl = document.getElementById('heroCoverage');
      const coverage = overall.coveragePercentage;
      heroEl.textContent = coverage.toFixed(1) + '%';

      heroEl.classList.remove('good', 'warning', 'bad');
      if (coverage >= 80) heroEl.classList.add('good');
      else if (coverage >= 50) heroEl.classList.add('warning');
      else heroEl.classList.add('bad');

      // Calculate trend from weekly data if available
      const trendEl = document.getElementById('heroTrend');
      if (coverageData && coverageData.weeklyTrend && coverageData.weeklyTrend.length >= 2) {
        const latest = coverageData.weeklyTrend[coverageData.weeklyTrend.length - 1];
        const previous = coverageData.weeklyTrend[coverageData.weeklyTrend.length - 2];
        const diff = latest.coveragePercentage - previous.coveragePercentage;

        trendEl.classList.remove('trend-up', 'trend-down', 'trend-flat');
        if (diff > 1) {
          trendEl.textContent = '↑ ' + diff.toFixed(1) + '% vs last week';
          trendEl.classList.add('trend-up');
        } else if (diff < -1) {
          trendEl.textContent = '↓ ' + Math.abs(diff).toFixed(1) + '% vs last week';
          trendEl.classList.add('trend-down');
        } else {
          trendEl.textContent = '→ Stable vs last week';
          trendEl.classList.add('trend-flat');
        }
      } else {
        trendEl.textContent = '';
      }
    }

    function updateKPIs(overall) {
      document.getElementById('kpiTotalCommits').textContent = overall.totalCommits.toLocaleString();
      document.getElementById('kpiLinkedCommits').textContent = overall.prLinkedCommits.toLocaleString();
      document.getElementById('kpiOrphanCommits').textContent = overall.orphanCommits.toLocaleString();
      document.getElementById('kpiReposAnalyzed').textContent = overall.repositoriesAnalyzed.toLocaleString();
    }

    function renderDonutChart(overall) {
      const container = document.getElementById('donutChart');
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
        { label: 'PR-Linked', value: overall.prLinkedCommits, color: 'var(--coverage-good)' },
        { label: 'Orphan', value: overall.orphanCommits, color: 'var(--coverage-bad)' }
      ].filter(d => d.value > 0);

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
      svg.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '-0.2em')
        .style('font-size', '24px')
        .style('font-weight', 'bold')
        .style('fill', 'var(--vscode-foreground)')
        .text(overall.coveragePercentage.toFixed(1) + '%');

      svg.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '1.2em')
        .style('font-size', '12px')
        .style('fill', 'var(--vscode-descriptionForeground)')
        .text('Coverage');

      // Legend
      const legend = svg.selectAll('.legend')
        .data(data)
        .enter()
        .append('g')
        .attr('transform', (d, i) => 'translate(' + (radius + 10) + ',' + (i * 20 - 10) + ')');

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

    function renderTrendChart(weeklyTrend) {
      const container = document.getElementById('trendChart');
      container.innerHTML = '';

      if (!weeklyTrend || weeklyTrend.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--vscode-descriptionForeground);">No trend data available</p>';
        return;
      }

      const margin = { top: 20, right: 30, bottom: 40, left: 50 };
      const width = container.clientWidth - margin.left - margin.right;
      const height = 260 - margin.top - margin.bottom;

      const svg = d3.select(container)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

      const parseDate = d3.timeParse('%Y-%m-%d');
      const data = weeklyTrend.map(d => ({
        date: parseDate(d.weekStart),
        coverage: d.coveragePercentage
      }));

      const x = d3.scaleTime()
        .domain(d3.extent(data, d => d.date))
        .range([0, width]);

      const y = d3.scaleLinear()
        .domain([0, 100])
        .range([height, 0]);

      // Area
      const area = d3.area()
        .x(d => x(d.date))
        .y0(height)
        .y1(d => y(d.coverage));

      svg.append('path')
        .datum(data)
        .attr('fill', 'var(--vscode-charts-green)')
        .attr('fill-opacity', 0.2)
        .attr('d', area);

      // Line
      const line = d3.line()
        .x(d => x(d.date))
        .y(d => y(d.coverage));

      svg.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', 'var(--vscode-charts-green)')
        .attr('stroke-width', 2)
        .attr('d', line);

      // X axis
      svg.append('g')
        .attr('transform', 'translate(0,' + height + ')')
        .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%b %d')))
        .selectAll('text')
        .style('fill', 'var(--vscode-foreground)');

      // Y axis
      svg.append('g')
        .call(d3.axisLeft(y).ticks(5).tickFormat(d => d + '%'))
        .selectAll('text')
        .style('fill', 'var(--vscode-foreground)');

      // Target line at 80%
      svg.append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', y(80))
        .attr('y2', y(80))
        .attr('stroke', 'var(--coverage-warning)')
        .attr('stroke-dasharray', '4,4')
        .attr('stroke-width', 1);

      svg.append('text')
        .attr('x', width - 5)
        .attr('y', y(80) - 5)
        .attr('text-anchor', 'end')
        .style('font-size', '10px')
        .style('fill', 'var(--coverage-warning)')
        .text('Target: 80%');
    }

    function renderAuthorChart(byContributor) {
      const container = document.getElementById('authorChart');
      container.innerHTML = '';

      if (!byContributor || byContributor.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--vscode-descriptionForeground);">No contributor data available</p>';
        return;
      }

      const top10 = byContributor.slice(0, 10);

      const margin = { top: 10, right: 30, bottom: 30, left: 120 };
      const width = container.clientWidth - margin.left - margin.right;
      const height = 260 - margin.top - margin.bottom;

      const svg = d3.select(container)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

      // Use contributorName if available, fallback to author
      const y = d3.scaleBand()
        .domain(top10.map(d => d.contributorName || d.author))
        .range([0, height])
        .padding(0.2);

      const x = d3.scaleLinear()
        .domain([0, 100])
        .range([0, width]);

      // Stacked bars
      svg.selectAll('.bar-linked')
        .data(top10)
        .enter()
        .append('rect')
        .attr('class', 'bar-linked')
        .attr('x', 0)
        .attr('y', d => y(d.contributorName || d.author))
        .attr('width', d => x(d.coveragePercentage))
        .attr('height', y.bandwidth())
        .attr('fill', 'var(--coverage-good)');

      svg.selectAll('.bar-orphan')
        .data(top10)
        .enter()
        .append('rect')
        .attr('class', 'bar-orphan')
        .attr('x', d => x(d.coveragePercentage))
        .attr('y', d => y(d.contributorName || d.author))
        .attr('width', d => x(100 - d.coveragePercentage))
        .attr('height', y.bandwidth())
        .attr('fill', 'var(--coverage-bad)');

      // Labels
      svg.selectAll('.label')
        .data(top10)
        .enter()
        .append('text')
        .attr('x', width + 5)
        .attr('y', d => y(d.contributorName || d.author) + y.bandwidth() / 2)
        .attr('dy', '0.35em')
        .style('font-size', '11px')
        .style('fill', 'var(--vscode-foreground)')
        .text(d => d.coveragePercentage.toFixed(0) + '%');

      // Y axis
      svg.append('g')
        .call(d3.axisLeft(y))
        .selectAll('text')
        .style('fill', 'var(--vscode-foreground)')
        .style('font-size', '11px');
    }

    function renderTeamChart(byTeam) {
      const container = document.getElementById('teamChart');
      container.innerHTML = '';

      if (!byTeam || byTeam.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--vscode-descriptionForeground);">No team data available</p>';
        return;
      }

      const top10 = byTeam.slice(0, 10);

      const margin = { top: 10, right: 30, bottom: 30, left: 120 };
      const width = container.clientWidth - margin.left - margin.right;
      const height = 260 - margin.top - margin.bottom;

      const svg = d3.select(container)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

      const y = d3.scaleBand()
        .domain(top10.map(d => d.teamName))
        .range([0, height])
        .padding(0.2);

      const x = d3.scaleLinear()
        .domain([0, 100])
        .range([0, width]);

      // Stacked bars
      svg.selectAll('.bar-linked')
        .data(top10)
        .enter()
        .append('rect')
        .attr('class', 'bar-linked')
        .attr('x', 0)
        .attr('y', d => y(d.team))
        .attr('width', d => x(d.coveragePercentage))
        .attr('height', y.bandwidth())
        .attr('fill', 'var(--coverage-good)');

      svg.selectAll('.bar-orphan')
        .data(top10)
        .enter()
        .append('rect')
        .attr('class', 'bar-orphan')
        .attr('x', d => x(d.coveragePercentage))
        .attr('y', d => y(d.team))
        .attr('width', d => x(100 - d.coveragePercentage))
        .attr('height', y.bandwidth())
        .attr('fill', 'var(--coverage-bad)');

      // Labels
      svg.selectAll('.label')
        .data(top10)
        .enter()
        .append('text')
        .attr('x', width + 5)
        .attr('y', d => y(d.team) + y.bandwidth() / 2)
        .attr('dy', '0.35em')
        .style('font-size', '11px')
        .style('fill', 'var(--vscode-foreground)')
        .text(d => d.coveragePercentage.toFixed(0) + '%');

      // Y axis
      svg.append('g')
        .call(d3.axisLeft(y))
        .selectAll('text')
        .style('fill', 'var(--vscode-foreground)')
        .style('font-size', '11px');
    }

    function renderBranchChart(byBranch) {
      const container = document.getElementById('branchChart');
      container.innerHTML = '';

      if (!byBranch || byBranch.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--vscode-descriptionForeground);">No branch data available</p>';
        return;
      }

      const top10 = byBranch.slice(0, 10);

      const margin = { top: 10, right: 30, bottom: 30, left: 120 };
      const width = container.clientWidth - margin.left - margin.right;
      const height = 260 - margin.top - margin.bottom;

      const svg = d3.select(container)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

      const y = d3.scaleBand()
        .domain(top10.map(d => d.branch))
        .range([0, height])
        .padding(0.2);

      const x = d3.scaleLinear()
        .domain([0, 100])
        .range([0, width]);

      // Stacked bars
      svg.selectAll('.bar-linked')
        .data(top10)
        .enter()
        .append('rect')
        .attr('class', 'bar-linked')
        .attr('x', 0)
        .attr('y', d => y(d.branch))
        .attr('width', d => x(d.coveragePercentage))
        .attr('height', y.bandwidth())
        .attr('fill', 'var(--coverage-good)');

      svg.selectAll('.bar-orphan')
        .data(top10)
        .enter()
        .append('rect')
        .attr('class', 'bar-orphan')
        .attr('x', d => x(d.coveragePercentage))
        .attr('y', d => y(d.branch))
        .attr('width', d => x(100 - d.coveragePercentage))
        .attr('height', y.bandwidth())
        .attr('fill', 'var(--coverage-bad)');

      // Labels
      svg.selectAll('.label')
        .data(top10)
        .enter()
        .append('text')
        .attr('x', width + 5)
        .attr('y', d => y(d.branch) + y.bandwidth() / 2)
        .attr('dy', '0.35em')
        .style('font-size', '11px')
        .style('fill', 'var(--vscode-foreground)')
        .text(d => d.coveragePercentage.toFixed(0) + '%');

      // Y axis
      svg.append('g')
        .call(d3.axisLeft(y))
        .selectAll('text')
        .style('fill', 'var(--vscode-foreground)')
        .style('font-size', '11px');
    }

    function renderOrphanTable() {
      const tbody = document.getElementById('orphanTableBody');
      tbody.innerHTML = '';

      // Sort data
      const sorted = [...orphanCommits].sort((a, b) => {
        let aVal = a[sortColumn];
        let bVal = b[sortColumn];

        if (sortColumn === 'commitDate') {
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
      pageData.forEach(commit => {
        const tr = document.createElement('tr');

        // SHA (clickable)
        const tdSha = document.createElement('td');
        const shaLink = document.createElement('a');
        shaLink.className = 'sha-link';
        shaLink.textContent = commit.sha.substring(0, 7);
        shaLink.href = '#';
        shaLink.tabIndex = 0;
        shaLink.onclick = (e) => {
          e.preventDefault();
          vscode.postMessage({
            type: 'openCommit',
            sha: commit.sha,
            repository: commit.repository
          });
        };
        shaLink.onkeypress = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            vscode.postMessage({
              type: 'openCommit',
              sha: commit.sha,
              repository: commit.repository
            });
          }
        };
        tdSha.appendChild(shaLink);
        tr.appendChild(tdSha);

        // Author
        const tdAuthor = document.createElement('td');
        tdAuthor.textContent = commit.author;
        tr.appendChild(tdAuthor);

        // Date
        const tdDate = document.createElement('td');
        tdDate.textContent = new Date(commit.commitDate).toLocaleDateString();
        tr.appendChild(tdDate);

        // Branch
        const tdBranch = document.createElement('td');
        tdBranch.textContent = commit.branch || 'N/A';
        tr.appendChild(tdBranch);

        // Repository
        const tdRepo = document.createElement('td');
        tdRepo.textContent = commit.repository;
        tr.appendChild(tdRepo);

        // Message
        const tdMsg = document.createElement('td');
        tdMsg.className = 'commit-message';
        tdMsg.textContent = commit.commitMessage || '';
        tdMsg.title = commit.commitMessage || '';
        tr.appendChild(tdMsg);

        tbody.appendChild(tr);
      });

      // Update pagination
      const totalPages = Math.ceil(orphanCommits.length / pageSize);
      document.getElementById('pageInfo').textContent = 'Page ' + currentPage + ' of ' + totalPages;
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
    }

    function handleSort(column) {
      if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = column;
        sortDirection = column === 'commitDate' ? 'desc' : 'asc';
      }
      currentPage = 1;
      renderOrphanTable();
    }

    function changePage(delta) {
      const totalPages = Math.ceil(orphanCommits.length / pageSize);
      currentPage = Math.max(1, Math.min(totalPages, currentPage + delta));
      renderOrphanTable();
    }

    function exportCsv() {
      if (orphanCommits.length === 0) {
        vscode.postMessage({ type: 'showWarning', message: 'No orphan commits to export' });
        return;
      }

      const headers = ['SHA', 'Author', 'Date', 'Branch', 'Repository', 'Message', 'Lines Added', 'Lines Removed'];
      const rows = orphanCommits.map(c => [
        c.sha,
        c.author,
        c.commitDate,
        c.branch || '',
        c.repository,
        '"' + (c.commitMessage || '').replace(/"/g, '""') + '"',
        c.linesAdded,
        c.linesRemoved
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');

      vscode.postMessage({
        type: 'exportCsv',
        filename: 'orphan-commits.csv',
        content: csvContent
      });
    }

    function syncPRs() {
      vscode.postMessage({ type: 'requestSyncCoverage' });
    }
  </script>
</body>
</html>`;
}
