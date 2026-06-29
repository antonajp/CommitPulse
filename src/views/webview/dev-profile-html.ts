/**
 * HTML content generator for the Developer Profile Dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Developer selector dropdown (displays full_name with login, filters by full_name - GITX-169)
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
 * Ticket: GITX-155, GITX-156, GITX-169
 */

import * as vscode from 'vscode';
import { generateLocWeekChartScript, generateTableRenderingScripts, generateGitx156ChartScripts, generateVelocityChartScript } from './dev-profile-charts.js';
import { generateGitx156HtmlSections, generatePrimaryVelocityChartHtml } from './dev-profile-html-sections.js';

/**
 * Configuration for generating the developer profile HTML.
 */
export interface DevProfileHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the developer profile CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Developer Profile Dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateDevProfileHtml(config: DevProfileHtmlConfig): string {
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
  <title>Developer Profile</title>
</head>
<body>
  <div class="devprofile-container">
    <header class="devprofile-header">
      <h1>Developer Profile</h1>
      <div class="filter-bar">
        <div class="filter-group">
          <label for="developerSelect">Developer:</label>
          <select id="developerSelect" class="filter-input" aria-label="Select developer">
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
    <section class="summary-cards" id="summaryCards" aria-label="Developer Summary Statistics">
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
        <p id="emptyStateMessage">Try expanding the date range or selecting a different developer.</p>
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
${generatePrimaryVelocityChartHtml()}
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

      <!-- Top Frequent Files Table (GITX-179: Replaced Repository with Last Modified Date) -->
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

    <!-- GITX-176: Custom tooltip for LOC chart -->
    <div id="locTooltip" class="chart-tooltip" role="tooltip" aria-hidden="true"></div>
  </div>

  <script nonce="${nonce}" src="${d3Uri.toString()}"></script>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // ======================================================================
      // State
      // ======================================================================
      let currentDeveloper = null;
      let currentTimeframe = '90';
      let cachedDevelopers = [];
      let cachedLocData = [];
      let cachedComplexFiles = [];
      let cachedFrequentFiles = [];
      let cachedTechStack = [];
      let cachedCommentsWeek = [];
      let cachedTestsWeek = [];
      let cachedHygieneScore = null;
      let cachedVelocityData = [];
      let velocityDataAvailable = false;
      let complexFilesSortKey = 'complexityScore';
      let complexFilesSortDir = 'desc';
      let frequentFilesSortKey = 'modificationCount';
      let frequentFilesSortDir = 'desc';
      let initialStateReceived = false;
      // GITX-179: Track aggregation period for X-axis formatting
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
          .replace(/'/g, '&#039;');
      }

      function formatNumber(num) {
        if (num === null || num === undefined) { return '0'; }
        return Number(num).toLocaleString();
      }

      function truncatePath(path, maxLen) {
        if (!path || path.length <= maxLen) { return path; }
        return '...' + path.slice(-(maxLen - 3));
      }

      // GITX-179: Format X-axis date label based on aggregation period
      function formatXAxisDate(dateStr) {
        if (!dateStr) { return ''; }
        if (currentAggregationPeriod === 'month') {
          // Monthly: "MMM YYYY" format
          try {
            var date = new Date(dateStr + 'T00:00:00');
            var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return months[date.getMonth()] + ' ' + date.getFullYear().toString().slice(2);
          } catch (e) {
            return dateStr.slice(0, 7);
          }
        }
        // Weekly: "MM-DD" format
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
      function requestDevelopers() {
        vscode.postMessage({ type: 'requestDevelopers' });
      }

      function requestAllData() {
        if (!currentDeveloper) { return; }
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
        document.getElementById('locWeekChart').classList.add('hidden');
        document.getElementById('complexFilesTable').classList.add('hidden');
        document.getElementById('frequentFilesTable').classList.add('hidden');
        document.getElementById('techStackChart').classList.add('hidden');
        document.getElementById('hygieneGauge').classList.add('hidden');
        document.getElementById('hygieneBreakdown').classList.add('hidden');
        document.getElementById('commentsWeekChart').classList.add('hidden');
        document.getElementById('testsWeekChart').classList.add('hidden');
        document.getElementById('velocityChart').classList.add('hidden');
        document.getElementById('locWeekEmpty').classList.add('hidden');
        document.getElementById('complexFilesEmpty').classList.add('hidden');
        document.getElementById('frequentFilesEmpty').classList.add('hidden');
        document.getElementById('techStackEmpty').classList.add('hidden');
        document.getElementById('hygieneEmpty').classList.add('hidden');
        document.getElementById('commentsWeekEmpty').classList.add('hidden');
        document.getElementById('testsWeekEmpty').classList.add('hidden');
        document.getElementById('velocityEmpty').classList.add('hidden');
        document.getElementById('velocityHint').classList.add('hidden');
        hideEmptyState();
        vscode.postMessage({
          type: 'requestAllData',
          developer: currentDeveloper,
          timeframeDays: currentTimeframe
        });
      }

      // ======================================================================
      // Rendering
      // ======================================================================
      function populateDevelopers(developers) {
        cachedDevelopers = developers;
        var select = document.getElementById('developerSelect');
        select.innerHTML = '<option value="">Select a developer</option>';
        developers.forEach(function(dev) {
          var opt = document.createElement('option');
          // Use fullName as value, fallback to login
          opt.value = dev.fullName || dev.login;
          // Display format: "Full Name (@login)" or just "login"
          var displayName = dev.fullName
            ? escapeHtml(dev.fullName) + ' (@' + escapeHtml(dev.login) + ')'
            : escapeHtml(dev.login);
          opt.textContent = displayName + ' - ' + formatNumber(dev.commitCount) + ' commits';
          select.appendChild(opt);
        });
        // If currentDeveloper is set (from initial state), select it
        if (currentDeveloper) {
          select.value = currentDeveloper;
        }
      }

      function renderSummary(summary) {
        hideSummarySkeleton();
        document.getElementById('summaryCommitsValue').textContent = formatNumber(summary.totalCommits);
        document.getElementById('summaryLocValue').textContent = formatNumber(summary.totalLoc);
        document.getElementById('summaryComplexityValue').textContent = summary.avgComplexity.toFixed(2);
        document.getElementById('summaryReposValue').textContent = formatNumber(summary.repositoriesWorkedOn);

        // GITX-179: Store aggregation period for X-axis formatting
        currentAggregationPeriod = summary.aggregationPeriod || 'week';

        // GITX-179: Update average metrics labels based on aggregation period
        var periodLabel = summary.aggregationPeriod === 'month' ? 'Month' : 'Week';
        document.getElementById('summaryAvgLocLabel').textContent = 'Avg LOC/' + periodLabel;
        document.getElementById('summaryAvgSpLabel').textContent = 'Avg SP/' + periodLabel;

        // GITX-179: Display average LOC per period
        if (summary.avgLocPerPeriod !== undefined && summary.avgLocPerPeriod > 0) {
          document.getElementById('summaryAvgLocValue').textContent = formatNumber(summary.avgLocPerPeriod);
        } else {
          document.getElementById('summaryAvgLocValue').textContent = '—';
        }

        // GITX-179: Display average story points per period (null means no Jira/Linear data)
        if (summary.avgStoryPointsPerPeriod !== null && summary.avgStoryPointsPerPeriod !== undefined) {
          document.getElementById('summaryAvgSpValue').textContent = summary.avgStoryPointsPerPeriod.toFixed(1);
        } else {
          document.getElementById('summaryAvgSpValue').textContent = '—';
        }

        if (summary.totalCommits === 0) {
          // Find developer by either fullName or login
          var dev = cachedDevelopers.find(function(d) {
            return (d.fullName && d.fullName === currentDeveloper) || d.login === currentDeveloper;
          });
          var devName = dev ? (dev.fullName || dev.login) : currentDeveloper;
          showEmptyState(
            'No commits found for ' + escapeHtml(devName),
            'Try expanding the date range or selecting a different developer.'
          );
        }
      }

${generateLocWeekChartScript()}
${generateTableRenderingScripts()}
${generateGitx156ChartScripts()}
${generateVelocityChartScript()}

      // ======================================================================
      // Message Handler
      // ======================================================================
      window.addEventListener('message', function(event) {
        var msg = event.data;
        switch (msg.type) {
          case 'initialState':
            // Track if developer changed to trigger data refresh
            var developerChanged = msg.developer && msg.developer !== currentDeveloper;
            if (msg.developer) {
              currentDeveloper = msg.developer;
            }
            if (msg.timeframeDays) {
              currentTimeframe = msg.timeframeDays;
              document.getElementById('timeframeSelect').value = msg.timeframeDays;
            }
            // Always mark as received
            initialStateReceived = true;
            if (developerChanged) {
              // Developer specified or changed: update dropdown and load data
              var select = document.getElementById('developerSelect');
              if (select && select.options.length > 1) {
                // Dropdown already populated, convert login to fullName if needed
                var dev = cachedDevelopers.find(function(d) {
                  return d.login === currentDeveloper || (d.fullName && d.fullName === currentDeveloper);
                });
                if (dev) {
                  currentDeveloper = dev.fullName || dev.login;
                  select.value = currentDeveloper;
                }
                requestAllData();
              }
              // If dropdown not yet populated, developersData handler will load data
            }
            break;
          case 'developersData':
            populateDevelopers(msg.data);
            if (currentDeveloper) {
              // Convert login to fullName if needed
              var dev = cachedDevelopers.find(function(d) {
                return d.login === currentDeveloper || (d.fullName && d.fullName === currentDeveloper);
              });
              if (dev) {
                currentDeveloper = dev.fullName || dev.login;
                document.getElementById('developerSelect').value = currentDeveloper;
              }
              requestAllData();
            }
            break;
          case 'summaryData':
            renderSummary(msg.data);
            break;
          case 'locPerWeekData':
            renderLocWeekChart(msg.data);
            break;
          case 'topComplexFilesData':
            renderComplexFilesTable(msg.data);
            break;
          case 'topFrequentFilesData':
            renderFrequentFilesTable(msg.data);
            break;
          case 'techStackData':
            renderTechStackChart(msg.data);
            break;
          // GITX-214: Tech stack by extension data handler
          case 'techStackByExtensionData':
            handleTechStackByExtensionData(msg.data);
            break;
          case 'hygieneScoreData':
            renderHygieneScore(msg.data);
            break;
          case 'commentsPerWeekData':
            renderCommentsWeekChart(msg.data);
            break;
          case 'testsPerWeekData':
            renderTestsWeekChart(msg.data);
            break;
          case 'velocityVsLocData':
            cachedVelocityData = msg.data;
            renderVelocityChart(msg.data);
            break;
          case 'hasVelocityData':
            velocityDataAvailable = msg.hasData;
            // Re-render velocity chart now that we know data availability
            if (cachedVelocityData.length > 0) {
              renderVelocityChart(cachedVelocityData);
            }
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
            break;
        }
      });

      // ======================================================================
      // Event Listeners
      // ======================================================================
      document.getElementById('developerSelect').addEventListener('change', function(e) {
        currentDeveloper = e.target.value;
        if (currentDeveloper) {
          hideEmptyState();
          requestAllData();
        }
      });

      document.getElementById('timeframeSelect').addEventListener('change', function(e) {
        currentTimeframe = e.target.value;
        if (currentDeveloper) {
          requestAllData();
        }
      });

      document.getElementById('errorRetryBtn').addEventListener('click', function() {
        hideError();
        if (currentDeveloper) {
          requestAllData();
        }
      });

      document.getElementById('retryBtn').addEventListener('click', function() {
        hideEmptyState();
        if (currentDeveloper) {
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
      // Initialization - Request data immediately on load
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

      // GITX-157: Initialize lazy loading for charts
      initLazyLoading();

      // GITX-214: Initialize tech stack toggle and restore state
      initTechStackToggle();
      restoreTechStackToggleState();

      // Request developers list immediately on webview load
      // This ensures data loads even if initialState message is delayed
      requestDevelopers();
    })();
  </script>
</body>
</html>`;
}
