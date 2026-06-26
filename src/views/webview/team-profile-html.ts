/**
 * HTML content generator for the Team Profile Dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Team selector dropdown
 * - Timeframe selector
 * - Summary cards
 * - LOC per week stacked bar chart
 * - Top complex files table
 * - Top frequent files table
 * - Technology stack doughnut chart (GITX-156)
 * - Comments per week line chart (GITX-156)
 * - Tests per week line chart (GITX-156)
 * - Commit hygiene score gauge (GITX-156)
 * - Loading and error states
 * - Keyboard accessibility
 *
 * Ticket: GITX-185
 */

import * as vscode from 'vscode';
import { generateLocWeekChartScript, generateTableRenderingScripts, generateGitx156ChartScripts, generateVelocityChartScript, generateTestDebtChartScript } from './dev-profile-charts.js';
import { generateGitx156HtmlSections } from './dev-profile-html-sections.js';

/**
 * Configuration for generating the team profile HTML.
 */
export interface TeamProfileHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the developer profile CSS stylesheet (reused for team profile) */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Team Profile Dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateTeamProfileHtml(config: TeamProfileHtmlConfig): string {
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
  <title>Team Profile</title>
</head>
<body>
  <div class="devprofile-container">
    <header class="devprofile-header">
      <h1>Team Profile</h1>
      <div class="filter-bar">
        <div class="filter-group">
          <label for="teamSelect">Team:</label>
          <select id="teamSelect" class="filter-input" aria-label="Select team">
            <option value="">Loading...</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="timeframeSelect">Timeframe:</label>
          <select id="timeframeSelect" class="filter-input" aria-label="Select timeframe">
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90" selected>Last 90 days</option>
            <option value="180">Last 6 months</option>
            <option value="365">Last 1 year</option>
            <option value="730">Last 2 years</option>
          </select>
        </div>
      </div>
    </header>

    <!-- Summary Cards -->
    <section class="summary-cards" id="summaryCards" aria-label="Team Summary Statistics">
      <div class="summary-card" id="summaryCommits">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label">Total Commits</span>
          <span class="summary-value" id="summaryCommitsValue">0</span>
        </div>
      </div>
      <div class="summary-card" id="summaryLoc">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label">Total LOC</span>
          <span class="summary-value" id="summaryLocValue">0</span>
        </div>
      </div>
      <div class="summary-card" id="summaryAvgLoc">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label" id="summaryAvgLocLabel">Avg LOC/Week</span>
          <span class="summary-value" id="summaryAvgLocValue">—</span>
        </div>
      </div>
      <div class="summary-card" id="summaryAvgSp">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label" id="summaryAvgSpLabel">Avg SP/Week</span>
          <span class="summary-value" id="summaryAvgSpValue">—</span>
        </div>
      </div>
      <div class="summary-card" id="summaryComplexity">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label">Avg Complexity</span>
          <span class="summary-value" id="summaryComplexityValue">0</span>
        </div>
      </div>
      <div class="summary-card" id="summaryRepos">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label">Repositories</span>
          <span class="summary-value" id="summaryReposValue">0</span>
        </div>
      </div>
    </section>

    <!-- Empty State -->
    <section class="empty-state hidden" id="emptyState" aria-live="polite">
      <div class="empty-state-content">
        <span class="empty-state-icon" aria-hidden="true">📊</span>
        <h2 id="emptyStateTitle">No commits found</h2>
        <p id="emptyStateMessage">Try expanding the date range or selecting a different team.</p>
        <button class="retry-btn hidden" id="retryBtn">Retry</button>
      </div>
    </section>

    <!-- Error Banner -->
    <section class="error-banner hidden" id="errorBanner" role="alert" aria-live="assertive">
      <span class="error-icon" aria-hidden="true">⚠️</span>
      <span class="error-message" id="errorMessage">An error occurred.</span>
      <button class="error-retry-btn" id="errorRetryBtn">Retry</button>
    </section>

    <main class="devprofile-grid" id="mainContent">
      <!-- LOC per Week Chart -->
      <section class="card card-wide" id="locWeekCard" aria-label="Lines of Code Chart">
        <h2>Lines of Code</h2>
        <div class="chart-container">
          <div class="chart-skeleton" id="locWeekSkeleton" aria-hidden="true"></div>
          <div id="locWeekChart" class="d3-chart hidden" role="img" aria-label="Line chart showing lines of code by repository"></div>
        </div>
        <p class="card-empty hidden" id="locWeekEmpty">No LOC data available for the selected timeframe.</p>
      </section>

      <!-- Top Complex Files Table -->
      <section class="card" id="complexFilesCard" aria-label="Top Complex Files">
        <h2>Top 15 Complex Files</h2>
        <div class="table-container">
          <div class="table-skeleton" id="complexFilesSkeleton" aria-hidden="true"></div>
          <table class="data-table hidden" id="complexFilesTable" aria-label="Complex files table with sortable columns">
            <thead>
              <tr>
                <th class="sortable-header" data-sort-key="filePath" data-sort-type="text" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">File Path</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header" data-sort-key="complexityScore" data-sort-type="number" tabindex="0" role="columnheader" aria-sort="descending">
                  <span class="header-text">Complexity</span>
                  <span class="sort-indicator" aria-hidden="true">▼</span>
                </th>
                <th class="sortable-header" data-sort-key="repository" data-sort-type="text" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Repository</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header" data-sort-key="lastModified" data-sort-type="text" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Last Modified</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
              </tr>
            </thead>
            <tbody id="complexFilesBody"></tbody>
          </table>
        </div>
        <p class="card-empty hidden" id="complexFilesEmpty">No complex files found for the selected timeframe.</p>
      </section>

      <!-- Top Frequent Files Table -->
      <section class="card" id="frequentFilesCard" aria-label="Top Frequent Files">
        <h2>Top 20 Frequently Modified Files</h2>
        <div class="table-container">
          <div class="table-skeleton" id="frequentFilesSkeleton" aria-hidden="true"></div>
          <table class="data-table hidden" id="frequentFilesTable" aria-label="Frequent files table with sortable columns">
            <thead>
              <tr>
                <th class="sortable-header" data-sort-key="filePath" data-sort-type="text" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">File Path</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header" data-sort-key="modificationCount" data-sort-type="number" tabindex="0" role="columnheader" aria-sort="descending">
                  <span class="header-text">Modifications</span>
                  <span class="sort-indicator" aria-hidden="true">▼</span>
                </th>
                <th class="sortable-header" data-sort-key="totalLocChanged" data-sort-type="number" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Total LOC Changed</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
                <th class="sortable-header" data-sort-key="lastModified" data-sort-type="text" tabindex="0" role="columnheader" aria-sort="none">
                  <span class="header-text">Last Modified</span>
                  <span class="sort-indicator" aria-hidden="true">⇅</span>
                </th>
              </tr>
            </thead>
            <tbody id="frequentFilesBody"></tbody>
          </table>
        </div>
        <p class="card-empty hidden" id="frequentFilesEmpty">No frequently modified files found for the selected timeframe.</p>
      </section>
${generateGitx156HtmlSections()}
    </main>

    <!-- Custom tooltip for LOC chart -->
    <div id="locTooltip" class="chart-tooltip" role="tooltip" aria-hidden="true"></div>
  </div>

  <script nonce="${nonce}" src="${d3Uri.toString()}"></script>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // ======================================================================
      // State
      // ======================================================================
      let currentTeam = null;
      let currentTimeframe = '90';
      let cachedTeams = [];
      let cachedLocData = [];
      let cachedComplexFiles = [];
      let cachedFrequentFiles = [];
      let cachedTechStack = [];
      let cachedCommentsWeek = [];
      let cachedTestsWeek = [];
      let cachedHygieneScore = null;
      let cachedVelocityData = [];
      let velocityDataAvailable = false;
      let cachedTestDebtMetrics = null;
      let complexFilesSortKey = 'complexityScore';
      let complexFilesSortDir = 'desc';
      let frequentFilesSortKey = 'modificationCount';
      let frequentFilesSortDir = 'desc';
      let initialStateReceived = false;
      let currentAggregationPeriod = 'week';

      // Okabe-Ito colorblind-safe palette for charts (GITX-156)
      var CHART_COLORS = ['#E69F00', '#56B4E9', '#009E73', '#D4C800', '#0072B2', '#D55E00', '#CC79A7', '#999999'];

      // ======================================================================
      // Utility Functions
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

      function formatNumber(num) {
        if (num === null || num === undefined) { return '0'; }
        return Number(num).toLocaleString();
      }

      function truncatePath(path, maxLen) {
        if (!path || path.length <= maxLen) { return path; }
        return '...' + path.slice(-(maxLen - 3));
      }

      function formatXAxisDate(dateStr) {
        if (!dateStr) { return ''; }
        if (currentAggregationPeriod === 'month') {
          try {
            var date = new Date(dateStr + 'T00:00:00');
            var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return months[date.getMonth()] + ' ' + date.getFullYear().toString().slice(2);
          } catch (e) {
            return dateStr.slice(0, 7);
          }
        }
        return dateStr.slice(5);
      }

      // ======================================================================
      // Loading/Error States
      // ======================================================================
      function showSkeleton(id) {
        var skeleton = document.getElementById(id);
        if (skeleton) { skeleton.classList.remove('hidden'); }
      }

      function hideSkeleton(id) {
        var skeleton = document.getElementById(id);
        if (skeleton) { skeleton.classList.add('hidden'); }
      }

      function showSummarySkeleton() {
        document.querySelectorAll('.summary-card-skeleton').forEach(function(el) {
          el.classList.remove('hidden');
        });
        document.querySelectorAll('.summary-card-content').forEach(function(el) {
          el.classList.add('hidden');
        });
      }

      function hideSummarySkeleton() {
        document.querySelectorAll('.summary-card-skeleton').forEach(function(el) {
          el.classList.add('hidden');
        });
        document.querySelectorAll('.summary-card-content').forEach(function(el) {
          el.classList.remove('hidden');
        });
      }

      function showEmptyState(title, message) {
        document.getElementById('emptyStateTitle').textContent = title;
        document.getElementById('emptyStateMessage').textContent = message;
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('mainContent').classList.add('hidden');
      }

      function hideEmptyState() {
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('mainContent').classList.remove('hidden');
      }

      function showError(message) {
        document.getElementById('errorMessage').textContent = message;
        document.getElementById('errorBanner').classList.remove('hidden');
      }

      function hideError() {
        document.getElementById('errorBanner').classList.add('hidden');
      }

      // ======================================================================
      // Data Requests
      // ======================================================================
      function requestTeams() {
        vscode.postMessage({ type: 'requestTeams' });
      }

      function requestAllData() {
        if (!currentTeam) { return; }
        hideError();
        showSummarySkeleton();
        showSkeleton('locWeekSkeleton');
        showSkeleton('complexFilesSkeleton');
        showSkeleton('frequentFilesSkeleton');
        showSkeleton('techStackSkeleton');
        showSkeleton('hygieneSkeleton');
        showSkeleton('commentsWeekSkeleton');
        showSkeleton('testsWeekSkeleton');
        showSkeleton('velocitySkeleton');
        showSkeleton('testDebtSkeleton');
        document.getElementById('locWeekChart').classList.add('hidden');
        document.getElementById('complexFilesTable').classList.add('hidden');
        document.getElementById('frequentFilesTable').classList.add('hidden');
        document.getElementById('techStackChart').classList.add('hidden');
        document.getElementById('hygieneGauge').classList.add('hidden');
        document.getElementById('hygieneBreakdown').classList.add('hidden');
        document.getElementById('commentsWeekChart').classList.add('hidden');
        document.getElementById('testsWeekChart').classList.add('hidden');
        document.getElementById('velocityChart').classList.add('hidden');
        document.getElementById('testDebtChart').classList.add('hidden');
        document.getElementById('testDebtMetrics').classList.add('hidden');
        document.getElementById('locWeekEmpty').classList.add('hidden');
        document.getElementById('complexFilesEmpty').classList.add('hidden');
        document.getElementById('frequentFilesEmpty').classList.add('hidden');
        document.getElementById('techStackEmpty').classList.add('hidden');
        document.getElementById('hygieneEmpty').classList.add('hidden');
        document.getElementById('commentsWeekEmpty').classList.add('hidden');
        document.getElementById('testsWeekEmpty').classList.add('hidden');
        document.getElementById('velocityEmpty').classList.add('hidden');
        document.getElementById('velocityHint').classList.add('hidden');
        document.getElementById('testDebtEmpty').classList.add('hidden');
        document.getElementById('testDebtSuccess').classList.add('hidden');
        hideEmptyState();
        vscode.postMessage({
          type: 'requestTeamAllData',
          team: currentTeam,
          timeframeDays: currentTimeframe
        });
      }

      // ======================================================================
      // Rendering
      // ======================================================================
      function populateTeams(teams) {
        cachedTeams = teams;
        var select = document.getElementById('teamSelect');
        select.innerHTML = '<option value="">Select a team</option>';
        teams.forEach(function(team) {
          var opt = document.createElement('option');
          opt.value = team.team;
          opt.textContent = escapeHtml(team.team) + ' - ' + formatNumber(team.totalCommits) + ' commits';
          select.appendChild(opt);
        });
        if (currentTeam) {
          select.value = currentTeam;
        }
      }

      function renderSummary(summary) {
        hideSummarySkeleton();
        document.getElementById('summaryCommitsValue').textContent = formatNumber(summary.totalCommits);
        document.getElementById('summaryLocValue').textContent = formatNumber(summary.totalLoc);
        document.getElementById('summaryComplexityValue').textContent = summary.avgComplexity.toFixed(2);
        document.getElementById('summaryReposValue').textContent = formatNumber(summary.repositoriesWorkedOn);

        currentAggregationPeriod = summary.aggregationPeriod || 'week';

        var periodLabel = summary.aggregationPeriod === 'month' ? 'Month' : 'Week';
        document.getElementById('summaryAvgLocLabel').textContent = 'Avg LOC/' + periodLabel;
        document.getElementById('summaryAvgSpLabel').textContent = 'Avg SP/' + periodLabel;

        if (summary.avgLocPerPeriod !== undefined && summary.avgLocPerPeriod > 0) {
          document.getElementById('summaryAvgLocValue').textContent = formatNumber(summary.avgLocPerPeriod);
        } else {
          document.getElementById('summaryAvgLocValue').textContent = '—';
        }

        if (summary.avgStoryPointsPerPeriod !== null && summary.avgStoryPointsPerPeriod !== undefined) {
          document.getElementById('summaryAvgSpValue').textContent = summary.avgStoryPointsPerPeriod.toFixed(1);
        } else {
          document.getElementById('summaryAvgSpValue').textContent = '—';
        }

        if (summary.totalCommits === 0) {
          var teamName = currentTeam || 'selected team';
          showEmptyState(
            'No commits found for ' + escapeHtml(teamName),
            'Try expanding the date range or selecting a different team.'
          );
        }
      }

${generateLocWeekChartScript()}
${generateTableRenderingScripts()}
${generateGitx156ChartScripts()}
${generateVelocityChartScript()}
${generateTestDebtChartScript()}

      // ======================================================================
      // Message Handler
      // ======================================================================
      window.addEventListener('message', function(event) {
        var msg = event.data;
        switch (msg.type) {
          case 'initialState':
            var teamChanged = msg.team && msg.team !== currentTeam;
            if (msg.team) {
              currentTeam = msg.team;
            }
            if (msg.timeframeDays) {
              currentTimeframe = msg.timeframeDays;
              document.getElementById('timeframeSelect').value = msg.timeframeDays;
            }
            initialStateReceived = true;
            if (teamChanged) {
              var select = document.getElementById('teamSelect');
              if (select && select.options.length > 1) {
                select.value = currentTeam;
                requestAllData();
              }
            }
            break;
          case 'teamsData':
            populateTeams(msg.data);
            if (currentTeam) {
              document.getElementById('teamSelect').value = currentTeam;
              requestAllData();
            }
            break;
          case 'teamSummaryData':
            renderSummary(msg.data);
            break;
          case 'teamLocPerWeekData':
            renderLocWeekChart(msg.data);
            break;
          case 'teamTopComplexFilesData':
            renderComplexFilesTable(msg.data);
            break;
          case 'teamTopFrequentFilesData':
            renderFrequentFilesTable(msg.data);
            break;
          case 'teamTechStackData':
            renderTechStackChart(msg.data);
            break;
          case 'teamHygieneScoreData':
            renderHygieneScore(msg.data);
            break;
          case 'teamCommentsPerWeekData':
            renderCommentsWeekChart(msg.data);
            break;
          case 'teamTestsPerWeekData':
            renderTestsWeekChart(msg.data);
            break;
          case 'teamVelocityVsLocData':
            cachedVelocityData = msg.data;
            renderVelocityChart(msg.data);
            break;
          case 'teamHasVelocityData':
            velocityDataAvailable = msg.hasData;
            if (cachedVelocityData.length > 0) {
              renderVelocityChart(cachedVelocityData);
            }
            break;
          case 'teamTestDebtMetricsData':
            cachedTestDebtMetrics = msg.data;
            renderTestDebtChart(msg.data);
            break;
          case 'error':
            hideEmptyState();
            showError(msg.message);
            hideSummarySkeleton();
            hideSkeleton('locWeekSkeleton');
            hideSkeleton('complexFilesSkeleton');
            hideSkeleton('frequentFilesSkeleton');
            hideSkeleton('techStackSkeleton');
            hideSkeleton('hygieneSkeleton');
            hideSkeleton('commentsWeekSkeleton');
            hideSkeleton('testsWeekSkeleton');
            hideSkeleton('velocitySkeleton');
            hideSkeleton('testDebtSkeleton');
            break;
        }
      });

      // ======================================================================
      // Event Listeners
      // ======================================================================
      document.getElementById('teamSelect').addEventListener('change', function(e) {
        currentTeam = e.target.value;
        if (currentTeam) {
          hideEmptyState();
          requestAllData();
        }
      });

      document.getElementById('timeframeSelect').addEventListener('change', function(e) {
        currentTimeframe = e.target.value;
        if (currentTeam) {
          requestAllData();
        }
      });

      document.getElementById('errorRetryBtn').addEventListener('click', function() {
        hideError();
        if (currentTeam) {
          requestAllData();
        }
      });

      document.getElementById('retryBtn').addEventListener('click', function() {
        hideEmptyState();
        if (currentTeam) {
          requestAllData();
        }
      });

      // Complex Files Sort Headers
      document.querySelectorAll('#complexFilesTable .sortable-header').forEach(function(header) {
        header.addEventListener('click', function() {
          var key = header.getAttribute('data-sort-key');
          if (complexFilesSortKey === key) {
            complexFilesSortDir = complexFilesSortDir === 'asc' ? 'desc' : 'asc';
          } else {
            complexFilesSortKey = key;
            complexFilesSortDir = 'asc';
          }
          renderComplexFilesRows();
        });
        header.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            header.click();
          }
        });
      });

      // Frequent Files Sort Headers
      document.querySelectorAll('#frequentFilesTable .sortable-header').forEach(function(header) {
        header.addEventListener('click', function() {
          var key = header.getAttribute('data-sort-key');
          if (frequentFilesSortKey === key) {
            frequentFilesSortDir = frequentFilesSortDir === 'asc' ? 'desc' : 'asc';
          } else {
            frequentFilesSortKey = key;
            frequentFilesSortDir = 'asc';
          }
          renderFrequentFilesRows();
        });
        header.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            header.click();
          }
        });
      });

      // ======================================================================
      // Initialization
      // ======================================================================
      showSummarySkeleton();
      showSkeleton('locWeekSkeleton');
      showSkeleton('complexFilesSkeleton');
      showSkeleton('frequentFilesSkeleton');
      showSkeleton('techStackSkeleton');
      showSkeleton('hygieneSkeleton');
      showSkeleton('commentsWeekSkeleton');
      showSkeleton('testsWeekSkeleton');
      showSkeleton('velocitySkeleton');
      showSkeleton('testDebtSkeleton');

      requestTeams();
    })();
  </script>
</body>
</html>`;
}
