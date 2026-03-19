/**
 * HTML content generator for the Metrics Dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Responsive grid layout for dashboard panels
 * - Filter controls (date range, team, repo)
 * - Client-side D3.js SVG rendering with postMessage data flow
 * - CSV export buttons for each chart/table (IQS-871)
 * - Copy-to-clipboard for data tables (IQS-871)
 * - Loading and error states (IQS-871)
 * - Webview state persistence (IQS-871)
 * - Keyboard accessibility (IQS-871)
 *
 * Tickets: IQS-869, IQS-871, IQS-887
 */

import * as vscode from 'vscode';
import { generateAllWebviewUtilityScripts } from './webview-utils.js';
import { generateAllD3ChartScripts } from './d3-chart-scripts.js';
import {
  generateFileChurnStateScript,
  generateFileChurnHelperFunctions,
  generateFileChurnEventListeners,
  generateFileChurnStateRestoration,
} from './file-churn-helpers.js';

/**
 * Configuration for generating the dashboard HTML.
 */
export interface DashboardHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the dashboard CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Metrics Dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateDashboardHtml(config: DashboardHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  // ============================================================================
  // Content Security Policy (CSP) Documentation - IQS-947
  // ============================================================================
  // This webview uses a strict CSP to prevent security vulnerabilities:
  //
  // - default-src 'none': Block all resources by default (deny-by-default)
  // - style-src ${cspSource} 'nonce-...': Allow styles from extension and nonce-protected inline
  // - script-src 'nonce-...': Only allow scripts with the cryptographic nonce (no eval, no inline)
  // - font-src ${cspSource}: Allow fonts from extension resources only
  // - img-src ${cspSource} data:: Allow images from extension resources and data URIs (for SVG/charts)
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
    See CSP documentation comments in dashboard-html.ts for full security model explanation.
  -->
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${cspSource} 'nonce-${nonce}';
             script-src 'nonce-${nonce}';
             font-src ${cspSource};
             img-src ${cspSource} data:;
             connect-src 'none';
             form-action 'none';
             frame-ancestors 'none';
             base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Gitr Metrics Dashboard</title>
</head>
<body>
  <div class="dashboard-container">
    <header class="dashboard-header">
      <h1>Gitr Metrics Dashboard</h1>
      <div class="filter-bar" id="filterBar">
        <div class="filter-group">
          <label for="startDate">From:</label>
          <input type="date" id="startDate" class="filter-input" aria-label="Start date filter">
        </div>
        <div class="filter-group">
          <label for="endDate">To:</label>
          <input type="date" id="endDate" class="filter-input" aria-label="End date filter">
        </div>
        <div class="filter-group">
          <label for="teamFilter">Team:</label>
          <select id="teamFilter" class="filter-input" aria-label="Team filter">
            <option value="">All Teams</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="repoFilter">Repo:</label>
          <select id="repoFilter" class="filter-input" aria-label="Repository filter">
            <option value="">All Repos</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="granularity">Group by:</label>
          <select id="granularity" class="filter-input" aria-label="Time granularity">
            <option value="week">Week</option>
            <option value="day">Day</option>
          </select>
        </div>
        <button id="applyFilters" class="filter-btn" aria-label="Apply filters">Apply</button>
      </div>
    </header>

    <main class="dashboard-grid">
      <!-- LOC per Week Chart (IQS-919: renamed from Commit Velocity) -->
      <section class="card card-wide" id="velocityCard" aria-label="LOC per Week Chart">
        <h2>
          <span>LOC per Week</span>
          <span class="card-actions">
            <button class="action-btn export-btn" id="exportVelocity" aria-label="Export lines of code data as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This stacked bar chart displays the total lines of code (LOC) changed each week, broken down by repository. It helps identify development velocity trends and periods of high activity. Use this to understand which repositories are seeing the most active development and spot patterns in team productivity over time.</p>
          </div>
        </details>
        <div class="chart-container">
          <div id="velocityChart" class="d3-chart" role="img" aria-label="Bar chart showing lines of code changed over time by repository"></div>
        </div>
        <p class="card-empty" id="velocityEmpty" style="display:none;">No LOC data available for the selected filters.</p>
      </section>

      <!-- Technology Stack Distribution -->
      <section class="card" id="techStackCard" aria-label="Technology Stack Distribution">
        <h2>
          <span>Technology Stack</span>
          <span class="card-actions">
            <button class="action-btn export-btn" id="exportTechStack" aria-label="Export technology stack data as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This doughnut chart shows the distribution of file types across your codebase by technology category. It helps visualize the technical composition of your project, revealing which languages and frameworks dominate development efforts.</p>
          </div>
        </details>
        <div class="chart-container">
          <div id="techStackChart" class="d3-chart" role="img" aria-label="Doughnut chart showing technology categories"></div>
        </div>
        <p class="card-empty" id="techStackEmpty" style="display:none;">No technology stack data available.</p>
      </section>

      <!-- Team Scorecard (IQS-892: Enhanced with sortable columns) -->
      <section class="card card-wide" id="scorecardCard" aria-label="Team Scorecard">
        <h2>
          <span>Team Scorecard</span>
          <span class="card-actions">
            <button class="action-btn copy-btn" id="copyScorecard" aria-label="Copy scorecard table to clipboard" tabindex="0">Copy</button>
            <button class="action-btn export-btn" id="exportScorecard" aria-label="Export scorecard data as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This table ranks contributors by a weighted quality score combining Release Assist (10%), Test Coverage (35%), Complexity Management (45%), and Code Comments (10%). Click column headers to sort. Higher scores indicate contributors who balance code quality practices alongside feature delivery.</p>
          </div>
        </details>
        <div class="table-container" id="scorecardTableContainer">
          <table class="scorecard-table scorecard-table-detailed" id="scorecardTable" aria-label="Team scorecard table with sortable columns">
            <thead>
              <tr>
                <th class="sortable-header" data-sort-key="fullName" data-sort-type="text" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Contributor</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header" data-sort-key="profile" data-sort-type="text" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Profile</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header" data-sort-key="team" data-sort-type="text" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Team</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header" data-sort-key="releaseAssistScore" data-sort-type="number" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Release Assist (10%)</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header" data-sort-key="testScore" data-sort-type="number" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Test (35%)</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header" data-sort-key="complexityScore" data-sort-type="number" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Complexity (45%)</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header" data-sort-key="commentsScore" data-sort-type="number" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Comments (10%)</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header score-total-header" data-sort-key="totalScore" data-sort-type="number" tabindex="0" role="columnheader" aria-sort="descending">
                  <span class="header-text">Total Score</span>
                  <span class="sort-indicator" aria-hidden="true">▼</span>
                </th>
              </tr>
            </thead>
            <tbody id="scorecardBody"></tbody>
          </table>
        </div>
        <p class="card-empty" id="scorecardEmpty" style="display:none;">No scorecard data available.</p>
      </section>

      <!-- LOC Committed (IQS-889) -->
      <section class="card card-wide" id="locCommittedCard" aria-label="LOC Committed Chart">
        <h2>
          <span>LOC Committed</span>
          <span class="card-actions">
            <button class="action-btn export-btn" id="exportLocCommitted" aria-label="Export LOC committed data as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This horizontal stacked bar chart shows lines of code contributed, segmented by architecture component. Toggle between grouping by Repository, Team, or Engineer, and select different metrics (Lines Added, Net Lines, Total Churn) to understand contribution patterns and identify which architectural areas receive the most attention.</p>
          </div>
        </details>
        <div class="chart-controls" role="toolbar" aria-label="LOC Committed chart controls">
          <div class="tab-group" role="tablist" aria-label="Grouping dimension">
            <button class="tab-btn active" role="tab" aria-selected="true" data-group="repository" id="locTabRepo" aria-label="Group by repository">By Repo</button>
            <button class="tab-btn" role="tab" aria-selected="false" data-group="team" id="locTabTeam" aria-label="Group by team">By Team</button>
            <button class="tab-btn" role="tab" aria-selected="false" data-group="author" id="locTabEngineer" aria-label="Group by engineer">By Engineer</button>
          </div>
          <div class="metric-toggle" role="radiogroup" aria-label="LOC metric selection">
            <button class="metric-btn active" role="radio" aria-checked="true" data-metric="linesAdded" id="locMetricAdded" aria-label="Lines Added metric">Lines Added</button>
            <button class="metric-btn" role="radio" aria-checked="false" data-metric="netLines" id="locMetricNet" aria-label="Net Lines metric">Net Lines</button>
            <button class="metric-btn" role="radio" aria-checked="false" data-metric="totalChurn" id="locMetricChurn" aria-label="Total Churn metric">Total Churn</button>
          </div>
          <div class="chart-date-controls">
            <label for="locStartDate">From:</label>
            <input type="date" id="locStartDate" class="filter-input" aria-label="LOC start date">
            <label for="locEndDate">To:</label>
            <input type="date" id="locEndDate" class="filter-input" aria-label="LOC end date">
          </div>
        </div>
        <div class="chart-container chart-container-tall">
          <div id="locCommittedChart" class="d3-chart" role="img" aria-label="Horizontal stacked bar chart showing lines of code committed by architecture component"></div>
        </div>
        <div class="loc-expansion" id="locExpansion" style="display:none;">
          <button class="action-btn" id="locShowAll" aria-label="Show all groups" tabindex="0">Show All</button>
        </div>
        <p class="card-empty" id="locCommittedEmpty" style="display:none;">No LOC data available for the selected filters.</p>
      </section>

      <!-- Top Complex Files (IQS-894) -->
      <section class="card card-wide" id="complexityCard" aria-label="Top Complex Files Chart">
        <h2>
          <span>Top Complex Files</span>
          <span class="card-actions">
            <button class="action-btn export-btn" id="exportComplexity" aria-label="Export file complexity data as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This chart ranks files by cyclomatic complexity, highlighting the most intricate parts of your codebase. High-complexity files are harder to maintain and more prone to bugs. Toggle between Individual and Team views to identify who is responsible for managing complex code and prioritize refactoring efforts.</p>
          </div>
        </details>
        <div class="chart-controls" role="toolbar" aria-label="Top Complex Files chart controls">
          <div class="tab-group" role="tablist" aria-label="Contributor grouping">
            <button class="tab-btn active" role="tab" aria-selected="true" data-group="individual" id="complexityTabIndividual" aria-label="Group by individual contributor">By Individual</button>
            <button class="tab-btn" role="tab" aria-selected="false" data-group="team" id="complexityTabTeam" aria-label="Group by team">By Team</button>
          </div>
        </div>
        <div class="chart-container chart-container-tall">
          <div id="complexityChart" class="d3-chart" role="img" aria-label="Horizontal stacked bar chart showing top complex files by contributor"></div>
        </div>
        <p class="card-empty" id="complexityEmpty" style="display:none;">No file complexity data available for the selected filters.</p>
      </section>

      <!-- Top Files by Churn (IQS-895) -->
      <section class="card card-wide" id="fileChurnCard" aria-label="Top Files by Churn Chart">
        <h2>
          <span>Top Files by Churn</span>
          <span class="card-actions">
            <button class="action-btn export-btn" id="exportFileChurn" aria-label="Export file churn data as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This chart shows files with the highest code churn (frequent additions and deletions), broken down by contributor. High-churn files often indicate unstable code, ongoing refactoring, or areas needing architectural attention. Click on a bar segment to drill down into the specific commits affecting that file.</p>
          </div>
        </details>
        <div class="chart-controls" role="toolbar" aria-label="Top Files by Churn chart controls">
          <div class="tab-group" role="tablist" aria-label="Churn grouping">
            <button class="tab-btn active" role="tab" aria-selected="true" data-group="team" id="fileChurnTabTeam" aria-label="Group by team">By Team</button>
            <button class="tab-btn" role="tab" aria-selected="false" data-group="individual" id="fileChurnTabIndividual" aria-label="Group by individual contributor">By Individual</button>
          </div>
          <div class="filter-group">
            <label for="fileChurnTopN">Top:</label>
            <select id="fileChurnTopN" class="filter-input" aria-label="Number of files to show">
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20" selected>20</option>
              <option value="50">50</option>
            </select>
          </div>
        </div>
        <div class="chart-container chart-container-tall">
          <div id="fileChurnChart" class="d3-chart" role="img" aria-label="Horizontal stacked bar chart showing top files by churn"></div>
        </div>
        <p class="card-empty" id="fileChurnEmpty" style="display:none;">No file churn data available for the selected filters.</p>
      </section>
    </main>

    <!-- File Churn Drill-Down Modal (IQS-895) -->
    <div id="fileChurnDrillDownModal" class="drilldown-modal" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="fileChurnDrillDownTitle" aria-hidden="true">
      <div class="drilldown-modal-content">
        <div class="drilldown-modal-header">
          <h3 id="fileChurnDrillDownTitle">File Churn Details</h3>
          <button class="drilldown-close-btn" id="fileChurnDrillDownClose" aria-label="Close drill-down modal" tabindex="0">&times;</button>
        </div>
        <div class="drilldown-modal-body">
          <div class="drilldown-table-container">
            <table class="drilldown-table" id="fileChurnDrillDownTable" aria-label="Commit details table">
              <thead>
                <tr>
                  <th>SHA</th>
                  <th>Date</th>
                  <th>Author</th>
                  <th>Message</th>
                  <th>+/-</th>
                </tr>
              </thead>
              <tbody id="fileChurnDrillDownBody"></tbody>
            </table>
          </div>
          <p class="card-empty" id="fileChurnDrillDownEmpty" style="display:none;">No commits found for this selection.</p>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${d3Uri.toString()}"></script>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // ======================================================================
      // Shared Webview Utilities (IQS-871)
      // ======================================================================
${generateAllWebviewUtilityScripts()}

      // ======================================================================
      // D3.js Chart Infrastructure and Renderers (IQS-887)
      // ======================================================================
${generateAllD3ChartScripts()}

      // ======================================================================
      // Cached data for CSV export (IQS-871)
      // ======================================================================
      let cachedVelocityData = null;
      let cachedVelocityGranularity = null;
      let cachedTechStackData = null;
      let cachedScorecardData = null;
      let cachedComplexityData = null;

      // Scorecard sorting state (IQS-892)
      let scorecardSortKey = 'totalScore';
      let scorecardSortDirection = 'desc';

      // LOC Committed state (IQS-889)
      let cachedLocCommittedData = null;
      let locCurrentGroupBy = 'repository';
      let locCurrentMetric = 'linesAdded';
      let locShowAllGroups = false;
      var LOC_DEFAULT_TOP_N = 15;

      // Top Complex Files state (IQS-894)
      let cachedTopComplexFilesData = null;
      let complexityCurrentGroupBy = 'individual';
      var COMPLEXITY_DEFAULT_TOP_N = 20;

${generateFileChurnStateScript()}

      // ======================================================================
      // Helpers
      // ======================================================================
      function getFilters() {
        return {
          startDate: document.getElementById('startDate').value || undefined,
          endDate: document.getElementById('endDate').value || undefined,
          team: document.getElementById('teamFilter').value || undefined,
          repository: document.getElementById('repoFilter').value || undefined,
        };
      }

      function getGranularity() {
        return document.getElementById('granularity').value;
      }

      // ======================================================================
      // Data requests (with loading states - IQS-871)
      // ======================================================================
      function requestAll() {
        const filters = getFilters();
        saveFilterState();
        showLoading('velocityCard');
        showLoading('techStackCard');
        showLoading('scorecardCard');
        showLoading('locCommittedCard');
        showLoading('complexityCard');
        showLoading('fileChurnCard');
        vscode.postMessage({ type: 'requestFilterOptions' });
        vscode.postMessage({ type: 'requestCommitVelocity', granularity: getGranularity(), filters });
        vscode.postMessage({ type: 'requestTechStack' });
        vscode.postMessage({ type: 'requestScorecardDetail', filters });
        vscode.postMessage({ type: 'requestLocCommitted', groupBy: locCurrentGroupBy, filters: getLocFilters() });
        vscode.postMessage({ type: 'requestTopComplexFiles', groupBy: complexityCurrentGroupBy, topN: COMPLEXITY_DEFAULT_TOP_N, filters });
        vscode.postMessage({ type: 'requestFileChurn', groupBy: fileChurnCurrentGroupBy, topN: fileChurnCurrentTopN, filters });
      }

      // ======================================================================
      // Dashboard-specific renderers (use shared D3 chart utils)
      // ======================================================================
      function renderTechStackChart(entries) {
        hideLoading('techStackCard');
        cachedTechStackData = entries;
        renderArcChart(
          document.getElementById('techStackChart'), entries,
          function(e) { return e.category; },
          function(e) { return e.fileCount; },
          document.getElementById('techStackEmpty')
        );
      }

      /**
       * Calculate total score from component scores using the weighted formula.
       * Formula: 10% Release Assist + 35% Test + 45% Complexity + 10% Comments
       * @param {Object} row - Scorecard detail row
       * @returns {number} Weighted total score
       */
      function calculateTotalScore(row) {
        return (Number(row.releaseAssistScore || 0) * 0.10) +
               (Number(row.testScore || 0) * 0.35) +
               (Number(row.complexityScore || 0) * 0.45) +
               (Number(row.commentsScore || 0) * 0.10);
      }

      /**
       * Sort scorecard data by the current sort key and direction (IQS-892).
       * Handles both text (case-insensitive) and numeric sorting.
       * @param {Array} data - The scorecard data array
       * @returns {Array} Sorted data array (new array, does not mutate original)
       */
      function sortScorecardData(data) {
        if (!data || data.length === 0) return data;
        return data.slice().sort(function(a, b) {
          var aVal, bVal;
          if (scorecardSortKey === 'totalScore') {
            aVal = calculateTotalScore(a);
            bVal = calculateTotalScore(b);
          } else {
            aVal = a[scorecardSortKey];
            bVal = b[scorecardSortKey];
          }
          // Determine sort type from current sort key
          var sortType = 'number';
          if (scorecardSortKey === 'fullName' || scorecardSortKey === 'team') {
            sortType = 'text';
          }
          if (sortType === 'text') {
            aVal = String(aVal || '').toLowerCase();
            bVal = String(bVal || '').toLowerCase();
            if (aVal < bVal) return scorecardSortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return scorecardSortDirection === 'asc' ? 1 : -1;
            return 0;
          } else {
            aVal = Number(aVal) || 0;
            bVal = Number(bVal) || 0;
            return scorecardSortDirection === 'asc' ? (aVal - bVal) : (bVal - aVal);
          }
        });
      }

      /**
       * Update the sort indicators in the scorecard table headers (IQS-892).
       */
      function updateScorecardSortIndicators() {
        var headers = document.querySelectorAll('#scorecardTable .sortable-header');
        headers.forEach(function(header) {
          var key = header.getAttribute('data-sort-key');
          var indicator = header.querySelector('.sort-indicator');
          if (key === scorecardSortKey) {
            header.setAttribute('aria-sort', scorecardSortDirection === 'asc' ? 'ascending' : 'descending');
            indicator.textContent = scorecardSortDirection === 'asc' ? '▲' : '▼';
          } else {
            header.setAttribute('aria-sort', 'none');
            indicator.textContent = '⇅';
          }
        });
      }

      /**
       * Handle click on a sortable scorecard header (IQS-892).
       * @param {string} key - The data key to sort by
       */
      function handleScorecardSort(key) {
        if (scorecardSortKey === key) {
          // Toggle direction
          scorecardSortDirection = scorecardSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          // New column: start with ascending
          scorecardSortKey = key;
          scorecardSortDirection = 'asc';
        }
        updateScorecardSortIndicators();
        renderScorecardRows();
      }

      /**
       * Get profile icon for a given profile type (IQS-942).
       * @param {string} profile - The contributor profile name
       * @returns {string} Unicode emoji icon
       */
      function getProfileIcon(profile) {
        if (!profile) { return ''; }
        if (profile === 'Quality Guardian') { return '🛡️'; }
        if (profile === 'Architect') { return '🏗️'; }
        if (profile === 'Coordinator') { return '🚂'; }
        if (profile === 'Documentation Champion') { return '📚'; }
        if (profile === 'Emerging Talent') { return '🌱'; }
        // All Pragmatic Engineer variations
        return '🎯';
      }

      /**
       * Get CSS class for profile badge styling (IQS-942).
       * @param {string} profile - The contributor profile name
       * @returns {string} CSS class name
       */
      function getProfileClass(profile) {
        if (!profile) { return ''; }
        if (profile === 'Quality Guardian') { return 'profile-quality'; }
        if (profile === 'Architect') { return 'profile-architect'; }
        if (profile === 'Coordinator') { return 'profile-coordinator'; }
        if (profile === 'Documentation Champion') { return 'profile-documentation'; }
        if (profile === 'Emerging Talent') { return 'profile-emerging'; }
        return 'profile-pragmatic';
      }

      /**
       * Get tooltip description for a profile (IQS-942).
       * @param {string} profile - The contributor profile name
       * @returns {string} Description text for tooltip
       */
      function getProfileDescription(profile) {
        if (!profile) { return ''; }
        switch (profile) {
          case 'Pragmatic Engineer':
            return 'Balanced across all metrics - solid all-around contributor';
          case 'Pragmatic Engineer (leans quality)':
            return 'Balanced with focus on quality practices (Test + Comments)';
          case 'Pragmatic Engineer (leans delivery)':
            return 'Balanced with focus on shipping features (Release Assist)';
          case 'Pragmatic Engineer (leans architecture)':
            return 'Balanced with focus on architectural concerns (Complexity)';
          case 'Quality Guardian':
            return 'High Test + Comments scores - focused on quality and maintainability';
          case 'Architect':
            return 'High Complexity score - tackles complex problems and manages technical debt';
          case 'Coordinator':
            return 'High Release Assist + Complexity - keeps the trains moving, strong in integration work';
          case 'Documentation Champion':
            return 'High Comments score - invests in code documentation and clarity';
          case 'Emerging Talent':
            return 'New or part-time contributor building their track record';
          default:
            return '';
        }
      }

      /**
       * Render profile badge HTML (IQS-942).
       * @param {string} profile - The contributor profile name
       * @returns {string} HTML for profile badge with tooltip
       */
      function renderProfileBadge(profile) {
        if (!profile) {
          return '<td class="profile-cell" aria-label="No profile assigned"><span class="profile-empty">—</span></td>';
        }
        var icon = getProfileIcon(profile);
        var cssClass = getProfileClass(profile);
        var description = getProfileDescription(profile);
        var ariaLabel = escapeHtml(profile) + ' profile';

        return '<td class="profile-cell" aria-label="' + ariaLabel + '" title="' + escapeHtml(description) + '">' +
          '<span class="profile-badge ' + cssClass + '">' +
          '<span class="profile-icon" aria-hidden="true">' + icon + '</span>' +
          '<span class="profile-label">' + escapeHtml(profile) + '</span>' +
          '</span>' +
          '</td>';
      }

      /**
       * Render just the scorecard table body rows (IQS-892, IQS-942).
       * Uses cached data with current sort applied.
       */
      function renderScorecardRows() {
        var sortedData = sortScorecardData(cachedScorecardData);
        var tbody = document.getElementById('scorecardBody');
        tbody.innerHTML = sortedData.map(function(row) {
          var totalScore = calculateTotalScore(row);
          return '<tr>' +
            '<td>' + escapeHtml(row.fullName || 'Unknown') + '</td>' +
            renderProfileBadge(row.profile) +
            '<td>' + escapeHtml(row.team || 'Unassigned') + '</td>' +
            '<td class="score-cell">' + Number(row.releaseAssistScore || 0).toFixed(2) + '</td>' +
            '<td class="score-cell">' + Number(row.testScore || 0).toFixed(2) + '</td>' +
            '<td class="score-cell">' + Number(row.complexityScore || 0).toFixed(2) + '</td>' +
            '<td class="score-cell">' + Number(row.commentsScore || 0).toFixed(2) + '</td>' +
            '<td class="score-cell score-total">' + totalScore.toFixed(2) + '</td>' +
          '</tr>';
        }).join('');
      }

      /**
       * Render the scorecard with detailed component scores (IQS-892).
       * Now uses scorecardDetailData instead of scorecardData.
       */
      function renderScorecard(rows) {
        hideLoading('scorecardCard');
        cachedScorecardData = rows;
        var emptyMsg = document.getElementById('scorecardEmpty');
        var container = document.getElementById('scorecardTableContainer');

        if (!rows || rows.length === 0) {
          container.style.display = 'none';
          emptyMsg.style.display = 'block';
          return;
        }
        container.style.display = 'block';
        emptyMsg.style.display = 'none';

        // Reset to default sort on new data
        scorecardSortKey = 'totalScore';
        scorecardSortDirection = 'desc';
        updateScorecardSortIndicators();
        renderScorecardRows();
      }

      // ======================================================================
      // Filter option population
      // ======================================================================
      function populateFilterOptions(options) {
        const teamSelect = document.getElementById('teamFilter');
        const repoSelect = document.getElementById('repoFilter');

        // Preserve current selections
        const currentTeam = teamSelect.value;
        const currentRepo = repoSelect.value;

        // Clear and rebuild team options
        teamSelect.innerHTML = '<option value="">All Teams</option>';
        (options.teams || []).forEach(function(team) {
          const opt = document.createElement('option');
          opt.value = team;
          opt.textContent = team;
          teamSelect.appendChild(opt);
        });
        if (currentTeam) { teamSelect.value = currentTeam; }

        // Clear and rebuild repo options
        repoSelect.innerHTML = '<option value="">All Repos</option>';
        (options.repositories || []).forEach(function(repo) {
          const opt = document.createElement('option');
          opt.value = repo;
          opt.textContent = repo;
          repoSelect.appendChild(opt);
        });
        if (currentRepo) { repoSelect.value = currentRepo; }
      }

      // ======================================================================
      // LOC Committed helpers (IQS-889)
      // ======================================================================
      function getLocFilters() {
        var filters = getFilters();
        var locStart = document.getElementById('locStartDate').value;
        var locEnd = document.getElementById('locEndDate').value;
        if (locStart) { filters.startDate = locStart; }
        if (locEnd) { filters.endDate = locEnd; }
        return filters;
      }

      function requestLocCommitted() {
        showLoading('locCommittedCard');
        vscode.postMessage({
          type: 'requestLocCommitted',
          groupBy: locCurrentGroupBy,
          filters: getLocFilters()
        });
      }

      function renderLocCommittedData(data, groupBy) {
        hideLoading('locCommittedCard');
        cachedLocCommittedData = data;
        locCurrentGroupBy = groupBy;
        // Persist tab/metric selection
        saveWebviewState({
          locGroupBy: locCurrentGroupBy,
          locMetric: locCurrentMetric,
          locShowAll: locShowAllGroups
        });
        renderLocCommittedHorizontalStackedBar(
          data,
          locCurrentMetric,
          locShowAllGroups ? 0 : LOC_DEFAULT_TOP_N
        );
      }

      function reRenderLocMetric() {
        if (!cachedLocCommittedData) { return; }
        saveWebviewState({ locMetric: locCurrentMetric });
        renderLocCommittedHorizontalStackedBar(
          cachedLocCommittedData,
          locCurrentMetric,
          locShowAllGroups ? 0 : LOC_DEFAULT_TOP_N
        );
      }

      // ======================================================================
      // Top Complex Files helpers (IQS-894)
      // ======================================================================
      function requestTopComplexFiles() {
        showLoading('complexityCard');
        vscode.postMessage({
          type: 'requestTopComplexFiles',
          groupBy: complexityCurrentGroupBy,
          topN: COMPLEXITY_DEFAULT_TOP_N,
          filters: getFilters()
        });
      }

      function renderTopComplexFilesData(data, groupBy) {
        hideLoading('complexityCard');
        cachedTopComplexFilesData = data;
        cachedComplexityData = data; // For CSV export compatibility
        complexityCurrentGroupBy = groupBy;
        // Persist toggle selection
        saveWebviewState({ complexityGroupBy: complexityCurrentGroupBy });
        renderTopComplexFilesChart(data, groupBy);
      }

${generateFileChurnHelperFunctions()}

      // ======================================================================
      // Message handler
      // ======================================================================
      window.addEventListener('message', function(event) {
        const msg = event.data;
        switch (msg.type) {
          case 'commitVelocityData':
            renderVelocityChart(msg.data, msg.granularity);
            break;
          case 'techStackData':
            renderTechStackChart(msg.data);
            break;
          case 'scorecardDetailData':
            renderScorecard(msg.data);
            break;
          case 'topComplexFilesData':
            renderTopComplexFilesData(msg.data, msg.groupBy);
            break;
          case 'locCommittedData':
            renderLocCommittedData(msg.data, msg.groupBy);
            break;
          case 'filterOptionsData':
            populateFilterOptions(msg.data);
            break;
          case 'fileChurnData':
            renderFileChurnData(msg.data, msg.groupBy);
            break;
          case 'fileChurnDrillDownData':
            handleFileChurnDrillDownData(msg.data, msg.filename, msg.contributor);
            break;
          case 'exportCsvSuccess':
            // CSV export succeeded (GITX-127)
            showExportSuccess(msg.filename);
            break;
          case 'exportCsvError':
            // CSV export failed or was cancelled (GITX-127)
            if (!msg.cancelled) {
              showExportError(msg.message);
            }
            // If cancelled, no notification needed
            break;
          case 'error':
            console.error('[Dashboard] Error from extension:', msg.source, msg.message);
            // Show error in the relevant card (IQS-871)
            if (msg.source === 'requestCommitVelocity') { hideLoading('velocityCard'); showError('velocityCard', msg.message); }
            else if (msg.source === 'requestTechStack') { hideLoading('techStackCard'); showError('techStackCard', msg.message); }
            else if (msg.source === 'requestScorecardDetail') { hideLoading('scorecardCard'); showError('scorecardCard', msg.message); }
            else if (msg.source === 'requestLocCommitted') { hideLoading('locCommittedCard'); showError('locCommittedCard', msg.message); }
            else if (msg.source === 'requestTopComplexFiles') { hideLoading('complexityCard'); showError('complexityCard', msg.message); }
            else if (msg.source === 'requestFileChurn') { hideLoading('fileChurnCard'); showError('fileChurnCard', msg.message); }
            else if (msg.source === 'requestFileChurnDrillDown') { console.error('[Dashboard] Drill-down error:', msg.message); }
            break;
        }
      });

      // ======================================================================
      // Event listeners
      // ======================================================================
      document.getElementById('applyFilters').addEventListener('click', function() {
        requestAll();
      });

      // ======================================================================
      // Scorecard Sortable Headers (IQS-892)
      // ======================================================================
      document.querySelectorAll('#scorecardTable .sortable-header').forEach(function(header) {
        header.addEventListener('click', function() {
          var key = header.getAttribute('data-sort-key');
          if (key) { handleScorecardSort(key); }
        });
        header.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            var key = header.getAttribute('data-sort-key');
            if (key) { handleScorecardSort(key); }
          }
        });
      });

      // ======================================================================
      // CSV Export Event Listeners (IQS-871)
      // ======================================================================
      // IQS-919: CSV export updated to use LOC instead of commit count
      document.getElementById('exportVelocity').addEventListener('click', function() {
        if (!cachedVelocityData || cachedVelocityData.length === 0) { return; }
        var headers = ['Date', 'Repository', 'Lines of Code'];
        var rows = cachedVelocityData.map(function(d) { return [d.date, d.repository, d.locCount]; });
        exportCsvFromData(headers, rows, 'gitr-loc-per-week.csv');
      });

      document.getElementById('exportTechStack').addEventListener('click', function() {
        if (!cachedTechStackData || cachedTechStackData.length === 0) { return; }
        var headers = ['Category', 'Extension Count', 'File Count'];
        var rows = cachedTechStackData.map(function(e) { return [e.category, e.extensionCount, e.fileCount]; });
        exportCsvFromData(headers, rows, 'gitr-tech-stack.csv');
      });

      document.getElementById('exportScorecard').addEventListener('click', function() {
        // IQS-892, IQS-942: Export with all 8 columns (including Profile) and current sort order
        if (!cachedScorecardData || cachedScorecardData.length === 0) { return; }
        var sortedData = sortScorecardData(cachedScorecardData);
        var headers = [
          'Contributor',
          'Profile',
          'Team',
          'Release Assist (10%)',
          'Test (35%)',
          'Complexity (45%)',
          'Comments (10%)',
          'Total Score'
        ];
        var rows = sortedData.map(function(row) {
          var totalScore = calculateTotalScore(row);
          return [
            row.fullName || 'Unknown',
            row.profile || '',
            row.team || 'Unassigned',
            Number(row.releaseAssistScore || 0).toFixed(2),
            Number(row.testScore || 0).toFixed(2),
            Number(row.complexityScore || 0).toFixed(2),
            Number(row.commentsScore || 0).toFixed(2),
            totalScore.toFixed(2)
          ];
        });
        exportCsvFromData(headers, rows, 'gitr-team-scorecard.csv');
      });

      document.getElementById('copyScorecard').addEventListener('click', function() {
        copyTableToClipboard('scorecardTable', this);
      });

      document.getElementById('exportComplexity').addEventListener('click', function() {
        if (!cachedTopComplexFilesData || cachedTopComplexFilesData.length === 0) { return; }
        var headers = ['Filename', 'Complexity', 'Contributor', 'Team', 'LOC', 'Percentage'];
        var rows = cachedTopComplexFilesData.map(function(d) {
          return [d.filename, d.complexity, d.contributor, d.team || '', d.loc, d.percentage];
        });
        exportCsvFromData(headers, rows, 'gitr-top-complex-files.csv');
      });

      // ======================================================================
      // LOC Committed Event Listeners (IQS-889)
      // ======================================================================

      // Tab switch (groupBy) -- triggers server re-query
      document.querySelectorAll('#locCommittedCard .tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('#locCommittedCard .tab-btn').forEach(function(b) {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
          locCurrentGroupBy = btn.getAttribute('data-group');
          locShowAllGroups = false;
          var showAllBtn = document.getElementById('locShowAll');
          if (showAllBtn) { showAllBtn.textContent = 'Show All'; }
          requestLocCommitted();
        });
      });

      // Metric toggle -- client-side only, no re-query
      document.querySelectorAll('#locCommittedCard .metric-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('#locCommittedCard .metric-btn').forEach(function(b) {
            b.classList.remove('active');
            b.setAttribute('aria-checked', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-checked', 'true');
          locCurrentMetric = btn.getAttribute('data-metric');
          reRenderLocMetric();
        });
      });

      // LOC date range change -- triggers re-query
      document.getElementById('locStartDate').addEventListener('change', function() { requestLocCommitted(); });
      document.getElementById('locEndDate').addEventListener('change', function() { requestLocCommitted(); });

      // CSV export for LOC Committed
      document.getElementById('exportLocCommitted').addEventListener('click', function() {
        if (!cachedLocCommittedData || cachedLocCommittedData.length === 0) { return; }
        var headers = ['Group', 'Arc Component', 'Lines Added', 'Net Lines', 'Total Churn'];
        var rows = cachedLocCommittedData.map(function(d) {
          return [d.groupKey, d.arcComponent, d.linesAdded, d.netLines, d.totalChurn];
        });
        exportCsvFromData(headers, rows, 'gitr-loc-committed.csv');
      });

      // Show All / Show Top 15 toggle
      document.getElementById('locShowAll').addEventListener('click', function() {
        locShowAllGroups = !locShowAllGroups;
        this.textContent = locShowAllGroups ? 'Show Top 15' : 'Show All';
        reRenderLocMetric();
      });

      // ======================================================================
      // Top Complex Files Event Listeners (IQS-894)
      // ======================================================================

      // Tab switch (groupBy) -- triggers server re-query
      document.querySelectorAll('#complexityCard .tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('#complexityCard .tab-btn').forEach(function(b) {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
          complexityCurrentGroupBy = btn.getAttribute('data-group');
          requestTopComplexFiles();
        });
      });

${generateFileChurnEventListeners()}

      // ======================================================================
      // Chart Explanation Collapse State Persistence (IQS-922)
      // ======================================================================
      function initChartExplanations() {
        var savedState = loadWebviewState() || {};
        var explanationState = savedState.explanationState || {};

        document.querySelectorAll('.chart-explanation').forEach(function(details, index) {
          var key = 'explanation_' + index;
          // Restore state (default to open if not set)
          if (explanationState[key] !== undefined) {
            details.open = explanationState[key];
          }
          // Save state on toggle
          details.addEventListener('toggle', function() {
            var currentState = loadWebviewState() || {};
            var expState = currentState.explanationState || {};
            expState[key] = details.open;
            saveWebviewState({ explanationState: expState });
          });
        });
      }
      initChartExplanations();

      // ======================================================================
      // Keyboard accessibility setup (IQS-871)
      // ======================================================================
      setupKeyboardAccessibility();

      // ======================================================================
      // State restoration and initial data load (IQS-871)
      // ======================================================================
      restoreFilterState();

      // Restore LOC Committed state (IQS-889)
      var savedState = loadWebviewState();
      if (savedState) {
        if (savedState.locGroupBy) {
          locCurrentGroupBy = savedState.locGroupBy;
          document.querySelectorAll('#locCommittedCard .tab-btn').forEach(function(b) {
            var isActive = b.getAttribute('data-group') === locCurrentGroupBy;
            b.classList.toggle('active', isActive);
            b.setAttribute('aria-selected', isActive ? 'true' : 'false');
          });
        }
        if (savedState.locMetric) {
          locCurrentMetric = savedState.locMetric;
          document.querySelectorAll('#locCommittedCard .metric-btn').forEach(function(b) {
            var isActive = b.getAttribute('data-metric') === locCurrentMetric;
            b.classList.toggle('active', isActive);
            b.setAttribute('aria-checked', isActive ? 'true' : 'false');
          });
        }
        if (savedState.locShowAll) {
          locShowAllGroups = savedState.locShowAll;
          var showAllBtn = document.getElementById('locShowAll');
          if (showAllBtn) { showAllBtn.textContent = locShowAllGroups ? 'Show Top 15' : 'Show All'; }
        }
        // Restore Top Complex Files state (IQS-894)
        if (savedState.complexityGroupBy) {
          complexityCurrentGroupBy = savedState.complexityGroupBy;
          document.querySelectorAll('#complexityCard .tab-btn').forEach(function(b) {
            var isActive = b.getAttribute('data-group') === complexityCurrentGroupBy;
            b.classList.toggle('active', isActive);
            b.setAttribute('aria-selected', isActive ? 'true' : 'false');
          });
        }
${generateFileChurnStateRestoration()}
      }

      requestAll();
    })();
  </script>
</body>
</html>`;
}
