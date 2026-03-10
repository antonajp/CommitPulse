/**
 * HTML content generator for the Commit-Jira Linkage webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Responsive grid layout for linkage panels
 * - Filter controls (date range, team, repo, Jira project)
 * - Linked vs unlinked summary with percentage display
 * - Jira project distribution D3.js arc/pie chart
 * - Jira status flow D3.js stacked bar chart
 * - Assignment history table
 * - Unlinked commits drill-down table (click-to-expand)
 * - CSV export buttons for each chart/table (IQS-871)
 * - Copy-to-clipboard for data tables (IQS-871)
 * - Loading and error states (IQS-871)
 * - Webview state persistence (IQS-871)
 * - Keyboard accessibility (IQS-871)
 *
 * Tickets: IQS-870, IQS-871, IQS-887
 */

import * as vscode from 'vscode';
import { generateAllWebviewUtilityScripts } from './webview-utils.js';
import { generateAllD3ChartScripts } from './d3-chart-scripts.js';

/**
 * Configuration for generating the linkage HTML.
 */
export interface LinkageHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the dashboard CSS stylesheet (shared with Metrics Dashboard) */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Commit-Jira Linkage webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateLinkageHtml(config: LinkageHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
  <title>Gitr Issue Linkage</title>
  <style nonce="${nonce}">
    .summary-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 4px; }
    @media (max-width: 700px) { .summary-cards { grid-template-columns: 1fr; } }
    .summary-stat { text-align: center; padding: 12px 8px; }
    .summary-stat .stat-value { font-size: 2em; font-weight: 700; line-height: 1.2; color: var(--vscode-foreground, #cccccc); }
    .summary-stat .stat-label { font-size: 0.85em; color: var(--vscode-descriptionForeground, #888888); margin-top: 2px; }
    .stat-linked .stat-value { color: #4dc9f6; }
    .stat-unlinked .stat-value { color: #f67019; }
    .drilldown-toggle { cursor: pointer; color: var(--vscode-textLink-foreground, #3794ff); text-decoration: underline; border: none; background: none; font-size: inherit; font-family: inherit; padding: 0; }
    .drilldown-toggle:hover { color: var(--vscode-textLink-activeForeground, #3794ff); }
    .drilldown-toggle:focus { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; }
    .hidden { display: none !important; }
    .commit-msg-cell { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  </style>
</head>
<body>
  <div class="dashboard-container">
    <header class="dashboard-header">
      <h1 id="panelTitle">Issue Linkage</h1>
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
          <label for="jiraProjectFilter">Project:</label>
          <select id="jiraProjectFilter" class="filter-input" aria-label="Project filter">
            <option value="">All Projects</option>
          </select>
        </div>
        <button id="applyFilters" class="filter-btn" aria-label="Apply filters">Apply</button>
      </div>
    </header>

    <main class="dashboard-grid">
      <!-- Linkage Summary -->
      <section class="card card-wide" id="summaryCard" aria-label="Commit Linkage Summary">
        <h2>
          <span>Linkage Summary</span>
          <span class="card-actions">
            <button class="action-btn export-btn" id="exportSummary" aria-label="Export linkage summary as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This summary shows how many commits are linked to Jira tickets versus unlinked. High linkage rates indicate good traceability between code changes and project requirements. Unlinked commits may represent undocumented changes that should be tracked.</p>
          </div>
        </details>
        <div class="summary-cards" id="summaryContainer">
          <div class="summary-stat">
            <div class="stat-value" id="totalCommitsValue">--</div>
            <div class="stat-label">Total Commits</div>
          </div>
          <div class="summary-stat stat-linked">
            <div class="stat-value" id="linkedValue">--</div>
            <div class="stat-label" id="linkedLabel">Linked (--)</div>
          </div>
          <div class="summary-stat stat-unlinked">
            <div class="stat-value" id="unlinkedValue">--</div>
            <div class="stat-label" id="unlinkedLabel">Unlinked (--)</div>
          </div>
        </div>
        <p class="card-empty" id="summaryEmpty" style="display:none;">No commit data available for the selected filters.</p>
      </section>

      <!-- Project Distribution Chart -->
      <section class="card" id="projectDistCard" aria-label="Project Distribution">
        <h2>
          <span id="projectDistTitle">Project Distribution</span>
          <span class="card-actions">
            <button class="action-btn export-btn" id="exportProjectDist" aria-label="Export project distribution data as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This doughnut chart shows how commits are distributed across Jira projects. Use it to understand which projects are receiving the most development attention and identify potential resource allocation imbalances.</p>
          </div>
        </details>
        <div class="chart-container">
          <div id="projectDistChart" class="d3-chart" role="img" aria-label="Doughnut chart showing commits per project"></div>
        </div>
        <p class="card-empty" id="projectDistEmpty" style="display:none;">No project distribution data available.</p>
      </section>

      <!-- Status Flow -->
      <section class="card" id="statusFlowCard" aria-label="Status Flow">
        <h2>
          <span>Status Flow Timeline</span>
          <span class="card-actions">
            <button class="action-btn export-btn" id="exportStatusFlow" aria-label="Export status flow data as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This stacked bar chart shows ticket status transitions over time. Track how tickets move through your workflow stages and identify bottlenecks where tickets accumulate in certain statuses.</p>
          </div>
        </details>
        <div class="chart-container">
          <div id="statusFlowChart" class="d3-chart" role="img" aria-label="Stacked bar chart showing status transitions over time"></div>
        </div>
        <p class="card-empty" id="statusFlowEmpty" style="display:none;">No status flow data available.</p>
      </section>

      <!-- Assignment History -->
      <section class="card card-wide" id="assignmentCard" aria-label="Assignment History">
        <h2>
          <span>Assignment History</span>
          <span class="card-actions">
            <button class="action-btn copy-btn" id="copyAssignment" aria-label="Copy assignment history to clipboard" tabindex="0">Copy</button>
            <button class="action-btn export-btn" id="exportAssignment" aria-label="Export assignment history as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <details class="chart-explanation" open>
          <summary class="explanation-toggle">
            <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>What does this chart show?</span>
          </summary>
          <div class="explanation-content">
            <p>This table shows the history of ticket assignments, tracking when and to whom tickets were assigned. Use it to understand work distribution patterns and identify potential handoff inefficiencies.</p>
          </div>
        </details>
        <div class="table-container" id="assignmentTableContainer">
          <table class="scorecard-table" id="assignmentTable" aria-label="Assignment history table">
            <thead>
              <tr>
                <th>Issue Key</th>
                <th>Date</th>
                <th>Assigned To</th>
                <th>Assigned From</th>
              </tr>
            </thead>
            <tbody id="assignmentBody"></tbody>
          </table>
        </div>
        <p class="card-empty" id="assignmentEmpty" style="display:none;">No assignment history available.</p>
      </section>

      <!-- Unlinked Commits Drill-Down -->
      <section class="card card-wide" id="unlinkedCard" aria-label="Unlinked Commits">
        <h2>
          <span>Unlinked Commits</span>
          <span class="card-actions">
            <button class="drilldown-toggle" id="toggleUnlinked" aria-label="Toggle unlinked commits list" aria-expanded="false" tabindex="0">Show</button>
            <button class="action-btn copy-btn" id="copyUnlinked" aria-label="Copy unlinked commits to clipboard" tabindex="0">Copy</button>
            <button class="action-btn export-btn" id="exportUnlinked" aria-label="Export unlinked commits as CSV" tabindex="0">CSV</button>
          </span>
        </h2>
        <div class="table-container hidden" id="unlinkedTableContainer">
          <table class="scorecard-table" id="unlinkedTable" aria-label="Unlinked commits table">
            <thead>
              <tr>
                <th>SHA</th>
                <th>Author</th>
                <th>Message</th>
                <th>Date</th>
                <th>Repo</th>
              </tr>
            </thead>
            <tbody id="unlinkedBody"></tbody>
          </table>
        </div>
        <p class="card-empty hidden" id="unlinkedEmpty">No unlinked commits found.</p>
      </section>
    </main>
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

      // State and cached data for CSV export
      let unlinkedLoaded = false;
      let unlinkedVisible = false;
      let cachedSummaryData = null;
      let cachedProjectDistData = null;
      let cachedStatusFlowData = null;
      let cachedAssignmentData = null;
      let cachedUnlinkedData = null;

      // Helpers
      function getFilters() {
        return {
          startDate: document.getElementById('startDate').value || undefined,
          endDate: document.getElementById('endDate').value || undefined,
          team: document.getElementById('teamFilter').value || undefined,
          repository: document.getElementById('repoFilter').value || undefined,
          jiraProject: document.getElementById('jiraProjectFilter').value || undefined,
        };
      }

      // Data requests (with loading states)
      function requestAll() {
        const filters = getFilters();
        saveFilterState();
        showLoading('summaryCard');
        showLoading('projectDistCard');
        showLoading('statusFlowCard');
        showLoading('assignmentCard');
        vscode.postMessage({ type: 'requestLinkageFilterOptions' });
        vscode.postMessage({ type: 'requestLinkageSummary', filters: filters });
        vscode.postMessage({ type: 'requestJiraProjectDistribution', filters: filters });
        vscode.postMessage({ type: 'requestJiraStatusFlow', filters: filters });
        vscode.postMessage({ type: 'requestAssignmentHistory', filters: filters });
        // Do NOT auto-load unlinked commits: they are loaded on-demand via drill-down
        unlinkedLoaded = false;
      }

      // ======================================================================
      // D3.js Chart Renderers (IQS-887: migrated from Chart.js)
      // ======================================================================

      function renderSummary(data) {
        hideLoading('summaryCard');
        cachedSummaryData = data;
        const container = document.getElementById('summaryContainer');
        const emptyMsg = document.getElementById('summaryEmpty');

        if (!data || data.totalCommits === 0) {
          container.style.display = 'none';
          emptyMsg.style.display = 'block';
          return;
        }
        container.style.display = 'grid';
        emptyMsg.style.display = 'none';

        document.getElementById('totalCommitsValue').textContent = data.totalCommits.toLocaleString();
        document.getElementById('linkedValue').textContent = data.linkedCommits.toLocaleString();
        document.getElementById('linkedLabel').textContent = 'Linked (' + data.linkedPercent.toFixed(1) + '%)';
        document.getElementById('unlinkedValue').textContent = data.unlinkedCommits.toLocaleString();
        document.getElementById('unlinkedLabel').textContent = 'Unlinked (' + data.unlinkedPercent.toFixed(1) + '%)';
      }

      /**
       * Render Jira Project Distribution using shared arc/pie chart helper.
       */
      function renderProjectDistChart(entries) {
        hideLoading('projectDistCard');
        cachedProjectDistData = entries;
        renderArcChart(
          document.getElementById('projectDistChart'), entries,
          function(e) { return e.jiraProject || e.linearProject; },
          function(e) { return e.commitCount; },
          document.getElementById('projectDistEmpty')
        );
      }

      /**
       * Render Jira Status Flow Timeline using shared stacked bar chart helper.
       */
      function renderStatusFlowChart(dataPoints) {
        hideLoading('statusFlowCard');
        cachedStatusFlowData = dataPoints;
        renderStackedBarChart(
          document.getElementById('statusFlowChart'), dataPoints,
          'changeDate', 'toStatus', 'issueCount',
          document.getElementById('statusFlowEmpty'),
          'Status Transitions Over Time', 'Issues'
        );
      }

      function renderAssignmentHistory(entries) {
        hideLoading('assignmentCard');
        cachedAssignmentData = entries;
        var tbody = document.getElementById('assignmentBody');
        var emptyMsg = document.getElementById('assignmentEmpty');
        var container = document.getElementById('assignmentTableContainer');

        if (!entries || entries.length === 0) {
          container.style.display = 'none';
          emptyMsg.style.display = 'block';
          return;
        }
        container.style.display = 'block';
        emptyMsg.style.display = 'none';

        tbody.innerHTML = entries.map(function(row) {
          return '<tr>' +
            '<td>' + escapeHtml(row.jiraKey) + '</td>' +
            '<td>' + escapeHtml(row.changeDate) + '</td>' +
            '<td>' + escapeHtml(row.assignedTo || '(unassigned)') + '</td>' +
            '<td>' + escapeHtml(row.assignedFrom || '(none)') + '</td>' +
          '</tr>';
        }).join('');
      }

      function renderUnlinkedCommits(entries) {
        cachedUnlinkedData = entries;
        var tbody = document.getElementById('unlinkedBody');
        var emptyMsg = document.getElementById('unlinkedEmpty');
        var container = document.getElementById('unlinkedTableContainer');

        if (!entries || entries.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }
        emptyMsg.classList.add('hidden');
        container.classList.remove('hidden');

        tbody.innerHTML = entries.map(function(row) {
          return '<tr>' +
            '<td><code>' + escapeHtml(row.sha) + '</code></td>' +
            '<td>' + escapeHtml(row.author) + '</td>' +
            '<td class="commit-msg-cell" title="' + escapeHtml(row.commitMessage) + '">' + escapeHtml(row.commitMessage) + '</td>' +
            '<td>' + escapeHtml(row.commitDate) + '</td>' +
            '<td>' + escapeHtml(row.repository) + '</td>' +
          '</tr>';
        }).join('');
      }

      // Filter option population
      function populateFilterOptions(options) {
        function fillSelect(id, items, allLabel) {
          var sel = document.getElementById(id); var cur = sel.value;
          sel.innerHTML = '<option value="">' + allLabel + '</option>';
          (items || []).forEach(function(v) { var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
          if (cur) { sel.value = cur; }
        }
        fillSelect('teamFilter', options.teams, 'All Teams');
        fillSelect('repoFilter', options.repositories, 'All Repos');
        fillSelect('jiraProjectFilter', options.jiraProjects, 'All Projects');
      }

      // Message handler
      window.addEventListener('message', function(event) {
        var msg = event.data;
        switch (msg.type) {
          case 'linkageSummaryData':
            renderSummary(msg.data);
            break;
          case 'jiraProjectDistributionData':
            renderProjectDistChart(msg.data);
            break;
          case 'jiraStatusFlowData':
            renderStatusFlowChart(msg.data);
            break;
          case 'assignmentHistoryData':
            renderAssignmentHistory(msg.data);
            break;
          case 'unlinkedCommitsData':
            hideLoading('unlinkedCard');
            unlinkedLoaded = true;
            renderUnlinkedCommits(msg.data);
            break;
          case 'linkageFilterOptionsData':
            populateFilterOptions(msg.data);
            break;
          case 'linkageError':
            console.error('[Linkage] Error from extension:', msg.source, msg.message);
            // Show error in the relevant card (IQS-871)
            if (msg.source === 'requestLinkageSummary') { hideLoading('summaryCard'); showError('summaryCard', msg.message); }
            else if (msg.source === 'requestJiraProjectDistribution') { hideLoading('projectDistCard'); showError('projectDistCard', msg.message); }
            else if (msg.source === 'requestJiraStatusFlow') { hideLoading('statusFlowCard'); showError('statusFlowCard', msg.message); }
            else if (msg.source === 'requestAssignmentHistory') { hideLoading('assignmentCard'); showError('assignmentCard', msg.message); }
            else if (msg.source === 'requestUnlinkedCommits') { showError('unlinkedCard', msg.message); }
            break;
        }
      });

      // Event listeners
      document.getElementById('applyFilters').addEventListener('click', function() {
        requestAll();
      });

      document.getElementById('toggleUnlinked').addEventListener('click', function() {
        var btn = document.getElementById('toggleUnlinked');
        var container = document.getElementById('unlinkedTableContainer');
        var emptyMsg = document.getElementById('unlinkedEmpty');

        if (unlinkedVisible) {
          container.classList.add('hidden');
          emptyMsg.classList.add('hidden');
          btn.textContent = 'Show';
          btn.setAttribute('aria-expanded', 'false');
          unlinkedVisible = false;
        } else {
          if (!unlinkedLoaded) {
            showLoading('unlinkedCard');
            vscode.postMessage({ type: 'requestUnlinkedCommits', filters: getFilters() });
          } else {
            container.classList.remove('hidden');
          }
          btn.textContent = 'Hide';
          btn.setAttribute('aria-expanded', 'true');
          unlinkedVisible = true;
        }
      });

      // CSV Export & Copy Event Listeners (IQS-871)
      document.getElementById('exportSummary').addEventListener('click', function() {
        if (!cachedSummaryData) { return; }
        exportCsvFromData(['Metric', 'Value'], [
          ['Total Commits', cachedSummaryData.totalCommits], ['Linked Commits', cachedSummaryData.linkedCommits],
          ['Unlinked Commits', cachedSummaryData.unlinkedCommits],
          ['Linked %', cachedSummaryData.linkedPercent.toFixed(1)], ['Unlinked %', cachedSummaryData.unlinkedPercent.toFixed(1)]
        ], 'gitr-linkage-summary.csv');
      });
      document.getElementById('exportProjectDist').addEventListener('click', function() {
        if (!cachedProjectDistData || cachedProjectDistData.length === 0) { return; }
        exportCsvFromData(['Project', 'Commit Count'], cachedProjectDistData.map(function(e) { return [e.jiraProject, e.commitCount]; }), 'gitr-project-distribution.csv');
      });
      document.getElementById('exportStatusFlow').addEventListener('click', function() {
        if (!cachedStatusFlowData || cachedStatusFlowData.length === 0) { return; }
        exportCsvFromData(['Date', 'Status', 'Issue Count'], cachedStatusFlowData.map(function(d) { return [d.changeDate, d.toStatus, d.issueCount]; }), 'gitr-status-flow.csv');
      });
      document.getElementById('exportAssignment').addEventListener('click', function() { exportCsvFromTable('assignmentTable', 'gitr-assignment-history.csv'); });
      document.getElementById('copyAssignment').addEventListener('click', function() { copyTableToClipboard('assignmentTable', this); });
      document.getElementById('exportUnlinked').addEventListener('click', function() { exportCsvFromTable('unlinkedTable', 'gitr-unlinked-commits.csv'); });
      document.getElementById('copyUnlinked').addEventListener('click', function() { copyTableToClipboard('unlinkedTable', this); });

      // Setup keyboard accessibility, restore state, load data (IQS-871)
      setupKeyboardAccessibility();
      restoreFilterState();

      // Chart Explanation Collapse State Persistence (IQS-922)
      function initChartExplanations() {
        var state = loadWebviewState() || {};
        var explanationState = state.explanationState || {};

        document.querySelectorAll('.chart-explanation').forEach(function(details, index) {
          var key = 'explanation_' + index;
          if (explanationState[key] !== undefined) {
            details.open = explanationState[key];
          }
          details.addEventListener('toggle', function() {
            var currentState = loadWebviewState() || {};
            var expState = currentState.explanationState || {};
            expState[key] = details.open;
            saveWebviewState({ explanationState: expState });
          });
        });
      }
      initChartExplanations();

      requestAll();
    })();
  </script>
</body>
</html>`;
}
