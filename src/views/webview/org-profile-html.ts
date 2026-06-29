/**
 * HTML content generator for the Organization Profile Dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Organization selector dropdown with format: "Org Name (X teams, Y contributors)"
 * - Date range selector: 30/60/90/180/365/730 days (dynamic aggregation week/month)
 * - KPI Cards styled consistently with Team Profile:
 *   - Total Teams, Total Contributors, Total Commits, Total LOC
 *   - Avg Complexity, Avg LOC/Period, Avg SP/Period, Repositories
 * - Loading skeleton states for all cards
 * - VS Code theme-aware colors
 * - Keyboard accessibility
 * - GITX-207: Lines of Code & Sprint Velocity Charts:
 *   - Lines of Code chart: Stacked bar chart by REPOSITORY
 *   - Sprint Velocity vs LOC chart: Dual-axis (LOC bars, story points line)
 *   - Technology Stack doughnut chart
 *   - Commit Hygiene gauge
 *   - Comments Added line chart
 *   - Test Files Modified line chart
 * - GITX-208: Team-Colored File Charts:
 *   - Top Complex Files: Horizontal stacked bar by TEAM
 *   - Top Frequently Modified Files: Horizontal stacked bar by TEAM
 *   - Interactive legend with team visibility toggle
 *   - High-contrast mode support
 *
 * Ticket: GITX-206, GITX-207, GITX-208
 */

import * as vscode from 'vscode';
import { generateOrgProfileChartSections } from './org-profile-html-sections.js';
import { generateOrgProfileChartScripts } from './org-profile-charts.js';

/**
 * Configuration for generating the organization profile HTML.
 */
export interface OrgProfileHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the developer profile CSS stylesheet (reused for org profile) */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Organization Profile Dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateOrgProfileHtml(config: OrgProfileHtmlConfig): string {
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
  <title>Organization Profile</title>
</head>
<body>
  <div class="devprofile-container">
    <header class="devprofile-header">
      <h1>Organization Profile</h1>
      <div class="filter-bar">
        <div class="filter-group">
          <label for="orgSelect">Organization:</label>
          <select id="orgSelect" class="filter-input" aria-label="Select organization">
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

    <!-- GITX-210: Data Coverage Warning Banner -->
    <section class="data-coverage-banner hidden" id="dataCoverageBanner" role="alert" aria-live="polite">
      <div class="coverage-summary">
        <span class="coverage-icon warning-icon" aria-hidden="true">&#9888;</span>
        <span class="coverage-message" id="coverageMessage">Showing data for 0 of 0 teams in this timeframe</span>
        <button class="coverage-details-btn" id="coverageDetailsBtn" aria-expanded="false" aria-controls="coverageDetails">
          <span id="coverageDetailsBtnText">Show Details</span>
          <span class="coverage-chevron" id="coverageChevron" aria-hidden="true">&#9660;</span>
        </button>
      </div>
      <div class="coverage-details hidden" id="coverageDetails">
        <ul class="coverage-team-list" id="coverageTeamList" role="list">
          <!-- Team status items populated by JavaScript -->
        </ul>
        <p class="coverage-jira-note hidden" id="coverageJiraNote">
          <span class="jira-coverage-icon" aria-hidden="true">&#128196;</span>
          <span id="coverageJiraMessage">0 of 0 teams have Jira data</span>
        </p>
      </div>
    </section>

    <!-- Summary Cards - GITX-206: 8 KPI cards matching Team Profile style -->
    <section class="summary-cards" id="summaryCards" aria-label="Organization Summary Statistics">
      <div class="summary-card" id="summaryTeams">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label">Total Teams</span>
          <span class="summary-value" id="summaryTeamsValue">0</span>
        </div>
      </div>
      <div class="summary-card" id="summaryContributors">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label">Total Contributors</span>
          <span class="summary-value" id="summaryContributorsValue">0</span>
        </div>
      </div>
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
      <div class="summary-card" id="summaryComplexity">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label">Avg Complexity</span>
          <span class="summary-value" id="summaryComplexityValue">0</span>
        </div>
      </div>
      <div class="summary-card" id="summaryAvgLoc">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label" id="summaryAvgLocLabel">Avg LOC/Week</span>
          <span class="summary-value" id="summaryAvgLocValue">---</span>
        </div>
      </div>
      <div class="summary-card" id="summaryAvgSp">
        <div class="summary-card-skeleton" aria-hidden="true"></div>
        <div class="summary-card-content hidden">
          <span class="summary-label" id="summaryAvgSpLabel">Avg SP/Week</span>
          <span class="summary-value" id="summaryAvgSpValue">---</span>
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
        <span class="empty-state-icon" aria-hidden="true">&#128202;</span>
        <h2 id="emptyStateTitle">No data found</h2>
        <p id="emptyStateMessage">Try expanding the date range or selecting a different organization.</p>
        <button class="retry-btn hidden" id="retryBtn">Retry</button>
      </div>
    </section>

    <!-- Error Banner -->
    <section class="error-banner hidden" id="errorBanner" role="alert" aria-live="assertive">
      <span class="error-icon" aria-hidden="true">&#9888;</span>
      <span class="error-message" id="errorMessage">An error occurred.</span>
      <button class="error-retry-btn" id="errorRetryBtn">Retry</button>
    </section>

    <main class="devprofile-grid" id="mainContent">
${generateOrgProfileChartSections()}
    </main>

    <!-- Tooltips for charts -->
    <!-- GITX-208: Tooltip for organization file charts -->
    <div id="orgFileTooltip" class="chart-tooltip" role="tooltip" aria-hidden="true"></div>
    <!-- GITX-201: Tooltip for organization velocity teams chart -->
    <div id="orgVelocityTeamsTooltip" class="chart-tooltip" role="tooltip" aria-hidden="true"></div>
  </div>

  <script nonce="${nonce}" src="${d3Uri.toString()}"></script>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // ======================================================================
      // State
      // ======================================================================
      let currentOrgId = null;
      let currentTimeframe = '90';
      let cachedOrganizations = [];
      let initialStateReceived = false;
      let currentAggregationPeriod = 'week';
      // GITX-207: Cached chart data
      let cachedTechStack = [];
      // GITX-201: Cached velocity with teams and LOC by team data
      let cachedOrgVelocityWithTeams = [];
      let cachedOrgLocByTeam = [];
      let cachedCommentsWeek = [];
      let cachedTestsWeek = [];
      let cachedHygieneScore = null;
      // GITX-209: Cached data for hot spots and knowledge concentration
      let cachedOrgHotSpots = [];
      let cachedOrgKnowledgeData = [];
      // GITX-210: Data coverage state
      let cachedDataCoverage = null;
      let coverageDetailsExpanded = false;
      // Okabe-Ito colorblind-safe palette for charts
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
      // GITX-210: Data Coverage Functions
      // ======================================================================
      function renderDataCoverage(coverage) {
        cachedDataCoverage = coverage;
        var banner = document.getElementById('dataCoverageBanner');
        var message = document.getElementById('coverageMessage');
        var teamList = document.getElementById('coverageTeamList');
        var jiraNote = document.getElementById('coverageJiraNote');
        var jiraMessage = document.getElementById('coverageJiraMessage');

        // Hide banner if all teams have data
        if (!coverage.isPartial) {
          banner.classList.add('hidden');
          return;
        }

        // Show banner with message
        banner.classList.remove('hidden');
        message.textContent = 'Showing data for ' + coverage.teamsWithData + ' of ' + coverage.totalTeams + ' teams in this timeframe';

        // Build team status list
        teamList.innerHTML = '';
        coverage.teamStatus.forEach(function(team) {
          var li = document.createElement('li');
          li.className = 'coverage-team-item';
          if (team.hasData) {
            li.innerHTML = '<span class="team-status-icon status-ok" aria-hidden="true">&#10003;</span>' +
              '<span class="team-name">' + escapeHtml(team.teamName) + '</span>' +
              '<span class="team-commits">(' + formatNumber(team.commitCount) + ' commits)</span>';
          } else {
            li.innerHTML = '<span class="team-status-icon status-warning" aria-hidden="true">&#9888;</span>' +
              '<span class="team-name">' + escapeHtml(team.teamName) + '</span>' +
              '<span class="team-commits">(no data)</span>';
          }
          teamList.appendChild(li);
        });

        // Show Jira coverage note if relevant
        if (coverage.isJiraPartial) {
          jiraNote.classList.remove('hidden');
          jiraMessage.textContent = coverage.teamsWithJiraData + ' of ' + coverage.totalTeams + ' teams have Jira data';
        } else {
          jiraNote.classList.add('hidden');
        }
      }

      function toggleCoverageDetails() {
        var details = document.getElementById('coverageDetails');
        var btn = document.getElementById('coverageDetailsBtn');
        var btnText = document.getElementById('coverageDetailsBtnText');
        var chevron = document.getElementById('coverageChevron');

        coverageDetailsExpanded = !coverageDetailsExpanded;

        if (coverageDetailsExpanded) {
          details.classList.remove('hidden');
          btn.setAttribute('aria-expanded', 'true');
          btnText.textContent = 'Hide Details';
          chevron.innerHTML = '&#9650;'; // Up arrow
        } else {
          details.classList.add('hidden');
          btn.setAttribute('aria-expanded', 'false');
          btnText.textContent = 'Show Details';
          chevron.innerHTML = '&#9660;'; // Down arrow
        }
      }

      function hideCoverageBanner() {
        document.getElementById('dataCoverageBanner').classList.add('hidden');
        // Reset details state
        coverageDetailsExpanded = false;
        document.getElementById('coverageDetails').classList.add('hidden');
        document.getElementById('coverageDetailsBtn').setAttribute('aria-expanded', 'false');
        document.getElementById('coverageDetailsBtnText').textContent = 'Show Details';
        document.getElementById('coverageChevron').innerHTML = '&#9660;';
      }

      // ======================================================================
      // Data Requests
      // ======================================================================
      function requestOrganizations() {
        console.log('[OrgProfile] Sending requestOrganizations');
        vscode.postMessage({ type: 'requestOrganizations' });
      }

      function requestAllData() {
        if (!currentOrgId) { return; }
        hideError();
        hideCoverageBanner(); // GITX-210: Hide coverage banner while loading
        showSummarySkeleton();
        hideEmptyState();
        // GITX-201: Show new velocity and LOC by team chart skeletons
        showSkeleton('orgVelocityTeamsSkeleton');
        showSkeleton('orgLocByTeamSkeleton');
        // GITX-207: Show all chart skeletons
        showSkeleton('techStackSkeleton');
        showSkeleton('hygieneSkeleton');
        showSkeleton('commentsWeekSkeleton');
        showSkeleton('testsWeekSkeleton');
        // GITX-208: Show file chart skeletons
        showSkeleton('orgComplexFilesSkeleton');
        showSkeleton('orgFrequentFilesSkeleton');
        // GITX-209: Show hot spots and knowledge concentration skeletons
        showSkeleton('orgHotSpotsSkeleton');
        showSkeleton('orgKnowledgeSkeleton');
        // GITX-201: Hide new velocity and LOC by team charts and empty states
        document.getElementById('orgVelocityTeamsChart').classList.add('hidden');
        document.getElementById('orgVelocityTeamsEmpty').classList.add('hidden');
        document.getElementById('orgVelocityTeamsHint').classList.add('hidden');
        document.getElementById('orgVelocityTeamsNoJira').classList.add('hidden');
        document.getElementById('orgLocByTeamChart').classList.add('hidden');
        document.getElementById('orgLocByTeamEmpty').classList.add('hidden');
        // Hide charts and empty states
        document.getElementById('techStackChart').classList.add('hidden');
        document.getElementById('hygieneGauge').classList.add('hidden');
        document.getElementById('hygieneBreakdown').classList.add('hidden');
        document.getElementById('commentsWeekChart').classList.add('hidden');
        document.getElementById('testsWeekChart').classList.add('hidden');
        document.getElementById('techStackEmpty').classList.add('hidden');
        document.getElementById('hygieneEmpty').classList.add('hidden');
        document.getElementById('commentsWeekEmpty').classList.add('hidden');
        document.getElementById('testsWeekEmpty').classList.add('hidden');
        // GITX-208: Hide file charts and empty states
        document.getElementById('orgComplexFilesChart').classList.add('hidden');
        document.getElementById('orgFrequentFilesChart').classList.add('hidden');
        document.getElementById('orgComplexFilesEmpty').classList.add('hidden');
        document.getElementById('orgFrequentFilesEmpty').classList.add('hidden');
        // GITX-209: Hide hot spots and knowledge concentration charts and empty states
        document.getElementById('orgHotSpotsChart').classList.add('hidden');
        document.getElementById('orgHotSpotsEmpty').classList.add('hidden');
        document.getElementById('orgKnowledgeChart').classList.add('hidden');
        document.getElementById('orgKnowledgeLegend').classList.add('hidden');
        document.getElementById('orgKnowledgeEmpty').classList.add('hidden');
        vscode.postMessage({
          type: 'requestOrgAllData',
          organizationId: currentOrgId,
          timeframeDays: currentTimeframe
        });
      }

      // ======================================================================
      // Rendering
      // ======================================================================
      // GITX-206: Organization selector shows "Org Name (X teams, Y contributors)"
      function populateOrganizations(organizations) {
        cachedOrganizations = organizations;
        var select = document.getElementById('orgSelect');
        select.innerHTML = '<option value="">Select an organization</option>';
        organizations.forEach(function(org) {
          var opt = document.createElement('option');
          opt.value = org.id;
          opt.textContent = escapeHtml(org.name) + ' (' + formatNumber(org.teamCount) + ' teams, ' + formatNumber(org.contributorCount) + ' contributors)';
          select.appendChild(opt);
        });
        if (currentOrgId) {
          select.value = currentOrgId;
        } else {
          // No organization selected - hide all skeletons so user sees they need to select
          hideAllSkeletons();
        }
      }

      // Hide all loading skeletons when no organization is selected
      function hideAllSkeletons() {
        hideSummarySkeleton();
        // GITX-201: Hide new velocity and LOC by team chart skeletons
        hideSkeleton('orgVelocityTeamsSkeleton');
        hideSkeleton('orgLocByTeamSkeleton');
        hideSkeleton('techStackSkeleton');
        hideSkeleton('hygieneSkeleton');
        hideSkeleton('commentsWeekSkeleton');
        hideSkeleton('testsWeekSkeleton');
        hideSkeleton('orgComplexFilesSkeleton');
        hideSkeleton('orgFrequentFilesSkeleton');
        hideSkeleton('orgHotSpotsSkeleton');
        hideSkeleton('orgKnowledgeSkeleton');
      }

      // GITX-206: Render all 8 KPI cards with loading skeleton states
      function renderSummary(summary) {
        hideSummarySkeleton();

        // Update values
        document.getElementById('summaryTeamsValue').textContent = formatNumber(summary.teamCount);
        document.getElementById('summaryContributorsValue').textContent = formatNumber(summary.contributorCount);
        document.getElementById('summaryCommitsValue').textContent = formatNumber(summary.totalCommits);
        document.getElementById('summaryLocValue').textContent = formatNumber(summary.totalLoc);
        document.getElementById('summaryComplexityValue').textContent = summary.avgComplexity !== undefined ? summary.avgComplexity.toFixed(2) : '0.00';
        document.getElementById('summaryReposValue').textContent = formatNumber(summary.repositoriesWorkedOn);

        // GITX-206: Aggregation period label adapts: "per week" or "per month" based on timeframe
        currentAggregationPeriod = summary.aggregationPeriod || 'week';
        var periodLabel = summary.aggregationPeriod === 'month' ? 'Month' : 'Week';
        document.getElementById('summaryAvgLocLabel').textContent = 'Avg LOC/' + periodLabel;
        document.getElementById('summaryAvgSpLabel').textContent = 'Avg SP/' + periodLabel;

        // Avg LOC per period
        if (summary.avgLocPerPeriod !== undefined && summary.avgLocPerPeriod > 0) {
          document.getElementById('summaryAvgLocValue').textContent = formatNumber(summary.avgLocPerPeriod);
        } else {
          document.getElementById('summaryAvgLocValue').textContent = '---';
        }

        // Avg Story Points per period (excluded if no Jira/Linear data)
        if (summary.avgStoryPointsPerPeriod !== null && summary.avgStoryPointsPerPeriod !== undefined) {
          document.getElementById('summaryAvgSpValue').textContent = summary.avgStoryPointsPerPeriod.toFixed(1);
        } else {
          document.getElementById('summaryAvgSpValue').textContent = '---';
        }

        // Show empty state if no commits
        if (summary.totalCommits === 0) {
          showEmptyState(
            'No commits found for ' + escapeHtml(summary.organizationName),
            'Try expanding the date range or selecting a different organization.'
          );
        }
      }

${generateOrgProfileChartScripts()}

      // ======================================================================
      // Message Handler
      // ======================================================================
      window.addEventListener('message', function(event) {
        var msg = event.data;
        console.log('[OrgProfile] Received message:', msg.type, msg);
        switch (msg.type) {
          case 'initialState':
            if (msg.organizationId) {
              currentOrgId = msg.organizationId;
            }
            if (msg.timeframeDays) {
              currentTimeframe = msg.timeframeDays;
              document.getElementById('timeframeSelect').value = msg.timeframeDays;
            }
            initialStateReceived = true;
            // Request organizations if not already loaded
            if (cachedOrganizations.length === 0) {
              requestOrganizations();
            }
            break;
          case 'organizationsData':
            populateOrganizations(msg.data);
            if (currentOrgId) {
              document.getElementById('orgSelect').value = currentOrgId;
              requestAllData();
            }
            break;
          case 'orgSummaryData':
            renderSummary(msg.data);
            break;
          // GITX-207: Chart data handlers
          case 'orgTechStackData':
            renderTechStackChart(msg.data);
            break;
          // GITX-214: Tech stack by extension data handler
          case 'orgTechStackByExtensionData':
            handleTechStackByExtensionData(msg.data);
            break;
          case 'orgHygieneScoreData':
            renderHygieneScore(msg.data);
            break;
          case 'orgCommentsPerWeekData':
            renderCommentsWeekChart(msg.data);
            break;
          case 'orgTestsPerWeekData':
            renderTestsWeekChart(msg.data);
            break;
          // GITX-208: File chart data handlers
          case 'orgTopComplexFilesData':
            renderOrgComplexFilesChart(msg.data);
            break;
          case 'orgTopFrequentFilesData':
            renderOrgFrequentFilesChart(msg.data);
            break;
          // GITX-209: Hot spots and knowledge concentration data handlers
          case 'orgHotSpotsData':
            renderOrgHotSpotsChart(msg.data);
            break;
          case 'orgKnowledgeConcentrationData':
            renderOrgKnowledgeChart(msg.data);
            break;
          // GITX-201: Velocity with teams and LOC by team data handlers
          case 'orgVelocityWithTeamsData':
            renderOrgVelocityWithTeamsChart(msg.data);
            break;
          case 'orgLocByTeamData':
            renderOrgLocByTeamChart(msg.data);
            break;
          // GITX-210: Data coverage handler
          case 'orgDataCoverageData':
            renderDataCoverage(msg.data);
            break;
          case 'error':
            hideEmptyState();
            showError(msg.message);
            hideSummarySkeleton();
            // GITX-201: Hide new velocity and LOC by team chart skeletons on error
            hideSkeleton('orgVelocityTeamsSkeleton');
            hideSkeleton('orgLocByTeamSkeleton');
            // GITX-207: Hide all chart skeletons on error
            hideSkeleton('techStackSkeleton');
            hideSkeleton('hygieneSkeleton');
            hideSkeleton('commentsWeekSkeleton');
            hideSkeleton('testsWeekSkeleton');
            // GITX-208: Hide file chart skeletons on error
            hideSkeleton('orgComplexFilesSkeleton');
            hideSkeleton('orgFrequentFilesSkeleton');
            // GITX-209: Hide hot spots and knowledge concentration skeletons on error
            hideSkeleton('orgHotSpotsSkeleton');
            hideSkeleton('orgKnowledgeSkeleton');
            break;
        }
      });

      // ======================================================================
      // Event Listeners
      // ======================================================================
      document.getElementById('orgSelect').addEventListener('change', function(e) {
        var orgId = parseInt(e.target.value, 10);
        if (!isNaN(orgId) && orgId > 0) {
          currentOrgId = orgId;
          hideEmptyState();
          requestAllData();
        }
      });

      document.getElementById('timeframeSelect').addEventListener('change', function(e) {
        currentTimeframe = e.target.value;
        if (currentOrgId) {
          requestAllData();
        }
      });

      document.getElementById('errorRetryBtn').addEventListener('click', function() {
        hideError();
        if (currentOrgId) {
          requestAllData();
        }
      });

      document.getElementById('retryBtn').addEventListener('click', function() {
        hideEmptyState();
        if (currentOrgId) {
          requestAllData();
        }
      });

      // GITX-210: Coverage details toggle button
      document.getElementById('coverageDetailsBtn').addEventListener('click', function() {
        toggleCoverageDetails();
      });

      // ======================================================================
      // Initialization
      // ======================================================================
      showSummarySkeleton();
      // GITX-201: Show new velocity and LOC by team chart skeletons on init
      showSkeleton('orgVelocityTeamsSkeleton');
      showSkeleton('orgLocByTeamSkeleton');
      // GITX-207: Show all chart skeletons on init
      showSkeleton('techStackSkeleton');
      showSkeleton('hygieneSkeleton');
      showSkeleton('commentsWeekSkeleton');
      showSkeleton('testsWeekSkeleton');
      // GITX-208: Show file chart skeletons on init
      showSkeleton('orgComplexFilesSkeleton');
      showSkeleton('orgFrequentFilesSkeleton');
      // GITX-209: Show hot spots and knowledge concentration skeletons on init
      showSkeleton('orgHotSpotsSkeleton');
      showSkeleton('orgKnowledgeSkeleton');
      // GITX-214: Initialize tech stack toggle and restore state
      initTechStackToggle();
      restoreTechStackToggleState();
      requestOrganizations();
    })();
  </script>
</body>
</html>`;
}
