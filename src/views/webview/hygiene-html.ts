/**
 * HTML content generator for the Commit Hygiene Tracker dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Stacked bar chart: commit counts by quality tier (excellent/good/fair/poor)
 * - Average score trend line overlay
 * - Donut chart showing current distribution
 * - Factor breakdown bars (linkage, conventional, co-author, length)
 * - Author leaderboard with best hygiene scores
 * - Click bar segment to view commits in that tier
 * - Author filter, quality tier toggles, date range filter
 * - "Poor commits to fix" actionable list
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-916
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the hygiene HTML.
 */
export interface HygieneHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the hygiene CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Commit Hygiene Tracker dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateHygieneHtml(config: HygieneHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Commit Hygiene Tracker</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Commit Hygiene Tracker</h1>
      <div class="controls">
        <div class="filter-group">
          <label for="repositoryFilter">Repository</label>
          <select id="repositoryFilter" aria-label="Repository filter" tabindex="0">
            <option value="">All Repositories</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="authorFilter">Author</label>
          <select id="authorFilter" aria-label="Author filter" tabindex="0">
            <option value="">All Authors</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="teamFilter">Team</label>
          <select id="teamFilter" aria-label="Team filter" tabindex="0">
            <option value="">All Teams</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="startDate">Start Date</label>
          <input type="date" id="startDate" aria-label="Start date filter" tabindex="0">
        </div>
        <div class="filter-group">
          <label for="endDate">End Date</label>
          <input type="date" id="endDate" aria-label="End date filter" tabindex="0">
        </div>
        <button class="action-btn" id="applyFilterBtn" aria-label="Apply filters" tabindex="0">Apply</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="summaryMetric" class="summary-metric" role="status" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading hygiene data...</span>
    </div>

    <div id="errorState" style="display:none;"></div>

    <div id="emptyState" style="display:none;"></div>

    <div id="chartArea" style="display:none;">
      <div class="tier-toggles" role="group" aria-label="Quality tier visibility toggles">
        <label class="tier-toggle">
          <input type="checkbox" id="showExcellentTier" checked aria-label="Show excellent commits">
          <span class="tier-swatch tier-excellent"></span>
          <span>Excellent</span>
        </label>
        <label class="tier-toggle">
          <input type="checkbox" id="showGoodTier" checked aria-label="Show good commits">
          <span class="tier-swatch tier-good"></span>
          <span>Good</span>
        </label>
        <label class="tier-toggle">
          <input type="checkbox" id="showFairTier" checked aria-label="Show fair commits">
          <span class="tier-swatch tier-fair"></span>
          <span>Fair</span>
        </label>
        <label class="tier-toggle">
          <input type="checkbox" id="showPoorTier" checked aria-label="Show poor commits">
          <span class="tier-swatch tier-poor"></span>
          <span>Poor</span>
        </label>
      </div>

      <div class="charts-grid">
        <div class="chart-section">
          <h2>Weekly Hygiene Trend</h2>
          <details class="chart-explanation" open>
            <summary class="explanation-toggle">
              <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>What does this chart show?</span>
            </summary>
            <div class="explanation-content">
              <p>This stacked bar chart shows the weekly distribution of commits by quality tier (Poor, Fair, Good, Excellent), with a line overlay showing the average hygiene score. Track whether commit quality is improving over time and identify periods needing attention.</p>
            </div>
          </details>
          <div class="stacked-bar-container" role="img" aria-label="Stacked bar chart showing commits by quality tier with average score overlay">
            <svg id="stackedBarSvg"></svg>
          </div>
          <div class="chart-instructions">
            <p>Click a bar segment to view commits in that tier. The line shows average hygiene score.</p>
          </div>
        </div>

        <div class="chart-section">
          <h2>Quality Distribution</h2>
          <details class="chart-explanation" open>
            <summary class="explanation-toggle">
              <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>What does this chart show?</span>
            </summary>
            <div class="explanation-content">
              <p>This donut chart shows the overall distribution of commit quality across all selected commits. A healthy codebase should have most commits in the Good or Excellent tiers, with minimal Poor commits requiring remediation.</p>
            </div>
          </details>
          <div class="donut-container" role="img" aria-label="Donut chart showing quality tier distribution">
            <svg id="donutSvg"></svg>
          </div>
          <div id="distributionStats" class="distribution-stats" aria-live="polite"></div>
        </div>
      </div>

      <div class="charts-grid">
        <div class="chart-section">
          <h2>Factor Breakdown</h2>
          <details class="chart-explanation" open>
            <summary class="explanation-toggle">
              <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>What does this chart show?</span>
            </summary>
            <div class="explanation-content">
              <p>This breakdown shows compliance rates for each hygiene factor: conventional format, ticket reference, message length, body presence, and scope usage. Identify which specific practices need the most improvement across your team.</p>
            </div>
          </details>
          <div class="factor-bars-container" role="img" aria-label="Horizontal bars showing factor compliance rates">
            <div id="factorBars" class="factor-bars"></div>
          </div>
        </div>

        <div class="chart-section leaderboard-section">
          <h2>Author Leaderboard</h2>
          <details class="chart-explanation" open>
            <summary class="explanation-toggle">
              <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>What does this chart show?</span>
            </summary>
            <div class="explanation-content">
              <p>This leaderboard ranks authors by average commit hygiene score. Use it to recognize top performers and identify contributors who may benefit from coaching on commit message best practices.</p>
            </div>
          </details>
          <div id="leaderboardTable" class="leaderboard-container" role="region" aria-label="Top authors by hygiene score">
            <table id="authorsTable" class="data-table">
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Author</th>
                  <th scope="col">Avg Score</th>
                  <th scope="col">Commits</th>
                  <th scope="col">Conventional %</th>
                </tr>
              </thead>
              <tbody id="authorsTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="poor-commits-section">
        <h2>Poor Commits to Fix</h2>
        <div id="poorCommitsTable" class="commits-table-container" role="region" aria-label="Table of commits needing improvement">
          <table id="commitsTable" class="data-table">
            <thead>
              <tr>
                <th scope="col">SHA</th>
                <th scope="col">Date</th>
                <th scope="col">Author</th>
                <th scope="col">Message</th>
                <th scope="col">Score</th>
                <th scope="col">Issues</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody id="commitsTableBody"></tbody>
          </table>
        </div>
      </div>

      <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

      <div id="legendContainer" class="chart-legend hygiene-legend" role="img" aria-label="Quality tier legend"></div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div id="drillDownPanel" class="drill-down-panel" style="display:none;">
      <div class="drill-down-header">
        <h2 id="drillDownTitle">Commit Details</h2>
        <button class="close-btn" id="closeDrillDown" aria-label="Close drill-down panel" tabindex="0">&times;</button>
      </div>
      <div id="drillDownContent" class="drill-down-content"></div>
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
      var weeksData = null;
      var poorCommitsData = null;
      var authorSummaryData = null;
      var summaryMetricData = null;

      // Quality tier colors (colorblind-accessible)
      var TIER_COLORS = {
        excellent: '#16a34a',  // green-600
        good: '#2563eb',       // blue-600
        fair: '#ca8a04',       // yellow-600
        poor: '#dc2626',       // red-600
      };

      // Tier visibility state
      var tierVisibility = {
        excellent: true,
        good: true,
        fair: true,
        poor: true,
      };

      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('applyFilterBtn');
      var repositoryFilter = document.getElementById('repositoryFilter');
      var authorFilter = document.getElementById('authorFilter');
      var teamFilter = document.getElementById('teamFilter');
      var startDateInput = document.getElementById('startDate');
      var endDateInput = document.getElementById('endDate');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var summaryMetric = document.getElementById('summaryMetric');
      var summaryStats = document.getElementById('summaryStats');
      var legendContainer = document.getElementById('legendContainer');
      var distributionStats = document.getElementById('distributionStats');
      var drillDownPanel = document.getElementById('drillDownPanel');
      var drillDownTitle = document.getElementById('drillDownTitle');
      var drillDownContent = document.getElementById('drillDownContent');
      var closeDrillDown = document.getElementById('closeDrillDown');
      var tooltip = document.getElementById('tooltip');
      var commitsTableBody = document.getElementById('commitsTableBody');
      var authorsTableBody = document.getElementById('authorsTableBody');
      var factorBars = document.getElementById('factorBars');
      var showExcellentTier = document.getElementById('showExcellentTier');
      var showGoodTier = document.getElementById('showGoodTier');
      var showFairTier = document.getElementById('showFairTier');
      var showPoorTier = document.getElementById('showPoorTier');

      // Set default date range (last 90 days)
      var today = new Date();
      var ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
      endDateInput.value = today.toISOString().split('T')[0];
      startDateInput.value = ninetyDaysAgo.toISOString().split('T')[0];

      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', function() {
        if (!weeksData || weeksData.length === 0) { return; }
        var headers = ['Week', 'Repository', 'Total Commits', 'Excellent', 'Good', 'Fair', 'Poor',
                       'Conventional', 'Avg Score', 'Conventional %', 'Good+ %'];
        var rows = weeksData.map(function(w) {
          return [w.week, w.repository, w.totalCommits, w.excellentCount, w.goodCount,
                  w.fairCount, w.poorCount, w.conventionalCommits, w.avgHygieneScore.toFixed(1),
                  w.conventionalPct.toFixed(1), w.goodOrBetterPct.toFixed(1)];
        });
        exportCsvFromData(headers, rows, 'commit-hygiene.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        requestData();
      });

      closeDrillDown.addEventListener('click', function() {
        drillDownPanel.style.display = 'none';
      });

      // Tier visibility toggles
      showExcellentTier.addEventListener('change', function() {
        tierVisibility.excellent = this.checked;
        if (weeksData) { renderStackedBarChart(weeksData); renderDonutChart(weeksData); }
      });

      showGoodTier.addEventListener('change', function() {
        tierVisibility.good = this.checked;
        if (weeksData) { renderStackedBarChart(weeksData); renderDonutChart(weeksData); }
      });

      showFairTier.addEventListener('change', function() {
        tierVisibility.fair = this.checked;
        if (weeksData) { renderStackedBarChart(weeksData); renderDonutChart(weeksData); }
      });

      showPoorTier.addEventListener('change', function() {
        tierVisibility.poor = this.checked;
        if (weeksData) { renderStackedBarChart(weeksData); renderDonutChart(weeksData); }
      });

      // ======================================================================
      // Message Handling
      // ======================================================================
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'hygieneData':
            handleHygieneData(message);
            break;
          case 'poorCommitsData':
            handlePoorCommitsData(message);
            break;
          case 'authorSummaryData':
            handleAuthorSummaryData(message);
            break;
          case 'hygieneFilterOptions':
            handleFilterOptions(message);
            break;
          case 'tierDrillDown':
            handleTierDrillDown(message);
            break;
          case 'commitDrillDown':
            handleCommitDrillDown(message);
            break;
          case 'hygieneError':
            showError(escapeHtml(message.message));
            break;
          case 'hygieneLoading':
            if (message.isLoading) { showLoading(); } else { hideLoading(); }
            break;
        }
      });

      function handleHygieneData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Hygiene View Not Available',
            'The vw_commit_hygiene_weekly database view has not been created yet. Run the database migration (020) to enable this chart.'
          );
          return;
        }

        if (!message.hasData || message.weeks.length === 0) {
          showEmpty(
            'No Hygiene Data Available',
            'No commit hygiene data found. Run the pipeline to analyze commit messages.'
          );
          return;
        }

        weeksData = message.weeks;
        summaryMetricData = message.summaryMetric;

        renderSummaryMetric(message.summaryMetric);
        renderStackedBarChart(weeksData);
        renderDonutChart(weeksData);
        renderFactorBreakdown(weeksData);
        renderSummaryStats(weeksData);
        renderLegend();

        chartArea.style.display = 'block';
      }

      function handlePoorCommitsData(message) {
        if (!message.viewExists || !message.hasData) {
          commitsTableBody.innerHTML = '<tr><td colspan="7" class="empty-text">No poor commits found.</td></tr>';
          return;
        }

        poorCommitsData = message.commits;
        renderCommitsTable(message.commits);
      }

      function handleAuthorSummaryData(message) {
        if (!message.viewExists || !message.hasData) {
          authorsTableBody.innerHTML = '<tr><td colspan="5" class="empty-text">No author data found.</td></tr>';
          return;
        }

        authorSummaryData = message.summaries;
        renderLeaderboard(message.summaries);
      }

      function handleFilterOptions(message) {
        // Populate repository filter
        while (repositoryFilter.options.length > 1) {
          repositoryFilter.remove(1);
        }
        (message.repositories || []).forEach(function(repo) {
          var option = document.createElement('option');
          option.value = repo;
          option.textContent = repo;
          repositoryFilter.appendChild(option);
        });

        // Populate author filter
        while (authorFilter.options.length > 1) {
          authorFilter.remove(1);
        }
        (message.authors || []).forEach(function(author) {
          var option = document.createElement('option');
          option.value = author;
          option.textContent = author;
          authorFilter.appendChild(option);
        });

        // Populate team filter
        while (teamFilter.options.length > 1) {
          teamFilter.remove(1);
        }
        (message.teams || []).forEach(function(team) {
          var option = document.createElement('option');
          option.value = team;
          option.textContent = team;
          teamFilter.appendChild(option);
        });
      }

      function handleTierDrillDown(message) {
        if (!message.hasData || message.commits.length === 0) {
          drillDownContent.innerHTML = '<p class="empty-text">No commits found for this tier and week.</p>';
          drillDownPanel.style.display = 'block';
          return;
        }

        drillDownTitle.textContent = formatTierLabel(message.tier) + ' Commits - Week of ' + formatDate(message.week);

        var html = '<div class="tier-commits-list">';
        message.commits.forEach(function(commit) {
          html += createCommitCard(commit);
        });
        html += '</div>';

        drillDownContent.innerHTML = html;
        attachCommitCardEvents();
        drillDownPanel.style.display = 'block';
      }

      function handleCommitDrillDown(message) {
        if (!message.hasData || !message.commit) {
          drillDownContent.innerHTML = '<p class="empty-text">Commit details not found.</p>';
          drillDownPanel.style.display = 'block';
          return;
        }

        var commit = message.commit;
        drillDownTitle.textContent = 'Commit: ' + escapeHtml(commit.sha.substring(0, 8));

        var tierClass = 'tier-' + commit.qualityTier;
        var html = '';
        html += '<div class="commit-detail-header">';
        html += '<div class="commit-sha">' + escapeHtml(commit.sha) + '</div>';
        html += '<div class="commit-meta">';
        html += '<span class="commit-author">' + escapeHtml(commit.author) + '</span>';
        html += ' on <span class="commit-date">' + formatDate(commit.commitDate) + '</span>';
        html += '</div>';
        html += '<div class="commit-message">' + escapeHtml(commit.commitMessageSubject) + '</div>';
        html += '</div>';

        html += '<div class="hygiene-score-large ' + tierClass + '">';
        html += '<span class="score-value">' + commit.hygieneScore.toFixed(0) + '</span>';
        html += '<span class="score-label">Hygiene Score</span>';
        html += '</div>';

        html += '<div class="commit-factors">';
        html += '<h3>Score Breakdown</h3>';
        html += '<div class="factors-grid">';
        html += createFactorItem('Conventional Prefix', commit.prefixScore, 30, commit.hasConventionalPrefix);
        html += createFactorItem('Subject Length', commit.lengthScore, 20, commit.subjectLength >= 10 && commit.subjectLength <= 72);
        html += createFactorItem('Has Body', commit.bodyScore, 15, commit.hasBody);
        html += createFactorItem('Has Scope', commit.scopeScore, 10, commit.hasScope);
        html += createFactorItem('Capitalization', commit.capitalizationScore, 10, commit.hasProperCapitalization);
        html += createFactorItem('No Period', commit.periodScore, 5, commit.noTrailingPeriod);
        if (commit.isBreakingChange) {
          html += createFactorItem('Breaking Change', commit.breakingChangeScore, 10, true);
        }
        html += '</div></div>';

        if (commit.commitType) {
          html += '<div class="commit-type-badge">';
          html += '<span class="type-label">Type:</span>';
          html += '<span class="type-value">' + escapeHtml(commit.commitType) + '</span>';
          if (commit.scope) {
            html += '<span class="scope-value">(' + escapeHtml(commit.scope) + ')</span>';
          }
          html += '</div>';
        }

        if (commit.jiraTicketId || commit.linearTicketId) {
          html += '<div class="commit-ticket">';
          if (commit.jiraTicketId) {
            html += '<span class="ticket-label">Jira:</span>';
            html += '<span class="ticket-id">' + escapeHtml(commit.jiraTicketId) + '</span>';
          }
          if (commit.linearTicketId) {
            html += '<span class="ticket-label">Linear:</span>';
            html += '<span class="ticket-id">' + escapeHtml(commit.linearTicketId) + '</span>';
          }
          html += '</div>';
        }

        html += '<div class="drill-down-actions">';
        html += '<button class="action-btn open-diff-btn" data-sha="' + escapeHtml(commit.sha) + '" data-repo="' + escapeHtml(commit.repository) + '">View Diff</button>';
        html += '</div>';

        drillDownContent.innerHTML = html;

        // Attach event to diff button
        var diffBtn = drillDownContent.querySelector('.open-diff-btn');
        if (diffBtn) {
          diffBtn.addEventListener('click', function() {
            vscode.postMessage({
              type: 'requestOpenDiff',
              sha: this.getAttribute('data-sha'),
              repository: this.getAttribute('data-repo'),
            });
          });
        }

        drillDownPanel.style.display = 'block';
      }

      function createFactorItem(label, score, maxScore, passed) {
        var pct = (score / maxScore) * 100;
        var statusClass = passed ? 'factor-pass' : 'factor-fail';
        return '<div class="factor-item ' + statusClass + '">' +
               '<span class="factor-label">' + escapeHtml(label) + '</span>' +
               '<span class="factor-score">' + score + '/' + maxScore + '</span>' +
               '<div class="factor-bar-mini"><div class="factor-bar-fill" style="width: ' + pct + '%;"></div></div>' +
               '</div>';
      }

      function createCommitCard(commit) {
        var tierClass = 'tier-' + commit.qualityTier;
        var issues = getCommitIssues(commit);
        return '<div class="commit-card ' + tierClass + '" data-sha="' + escapeHtml(commit.sha) + '" data-repo="' + escapeHtml(commit.repository) + '">' +
               '<div class="commit-card-header">' +
               '<span class="commit-sha-short">' + escapeHtml(commit.sha.substring(0, 8)) + '</span>' +
               '<span class="commit-tier-badge ' + tierClass + '">' + commit.hygieneScore.toFixed(0) + '</span>' +
               '</div>' +
               '<div class="commit-card-message">' + escapeHtml(commit.commitMessageSubject.substring(0, 50)) + (commit.commitMessageSubject.length > 50 ? '...' : '') + '</div>' +
               '<div class="commit-card-meta">' + escapeHtml(commit.author) + ' - ' + formatDate(commit.commitDate) + '</div>' +
               '<div class="commit-card-issues">' + escapeHtml(issues) + '</div>' +
               '</div>';
      }

      function getCommitIssues(commit) {
        var issues = [];
        // IQS-939: Check for either conventional prefix OR ticket prefix
        var hasAnyPrefix = commit.hasConventionalPrefix || commit.hasTicketPrefix;
        if (!hasAnyPrefix) { issues.push('No conventional prefix'); }
        if (commit.subjectLength > 72) { issues.push('Subject too long'); }
        if (commit.subjectLength < 10) { issues.push('Subject too short'); }
        if (!commit.hasProperCapitalization) { issues.push('Bad capitalization'); }
        if (!commit.noTrailingPeriod) { issues.push('Trailing period'); }
        return issues.length > 0 ? issues.join(', ') : 'Minor issues';
      }

      function attachCommitCardEvents() {
        var cards = drillDownContent.querySelectorAll('.commit-card');
        cards.forEach(function(card) {
          card.addEventListener('click', function() {
            vscode.postMessage({
              type: 'requestCommitDrillDown',
              sha: this.getAttribute('data-sha'),
              repository: this.getAttribute('data-repo'),
            });
          });
        });
      }

      // ======================================================================
      // Summary Metric Rendering
      // ======================================================================
      function renderSummaryMetric(metric) {
        if (!metric) {
          summaryMetric.style.display = 'none';
          return;
        }

        var scoreClass = metric.avgScore >= 80 ? 'excellent' :
                         metric.avgScore >= 60 ? 'good' :
                         metric.avgScore >= 40 ? 'fair' : 'poor';

        summaryMetric.innerHTML = '<div class="summary-metric-content">' +
          '<div class="metric-primary ' + scoreClass + '">' +
          '<span class="metric-value">' + metric.avgScore.toFixed(0) + '</span>' +
          '<span class="metric-label">Avg Hygiene Score</span>' +
          '</div>' +
          '<div class="metric-secondary">' +
          '<div class="metric-item">' +
          '<span class="metric-value">' + metric.goodOrBetterPct.toFixed(0) + '%</span>' +
          '<span class="metric-label">Good or Better</span>' +
          '</div>' +
          '<div class="metric-item">' +
          '<span class="metric-value">' + metric.conventionalPct.toFixed(0) + '%</span>' +
          '<span class="metric-label">Conventional</span>' +
          '</div>' +
          '</div>' +
          '</div>';
        summaryMetric.style.display = 'block';
      }

      // ======================================================================
      // Stacked Bar Chart Rendering with D3.js
      // ======================================================================
      function renderStackedBarChart(weeks) {
        var svg = d3.select('#stackedBarSvg');
        svg.selectAll('*').remove();

        // Reverse to show oldest first (left to right)
        var sortedWeeks = weeks.slice().reverse();

        var containerWidth = Math.max(600, document.querySelector('.stacked-bar-container').clientWidth - 24);
        var width = containerWidth;
        var height = 320;
        var margin = { top: 20, right: 60, bottom: 60, left: 60 };

        svg.attr('width', width).attr('height', height);

        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        var g = svg.append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // X scale
        var xScale = d3.scaleBand()
          .domain(sortedWeeks.map(function(w) { return w.week; }))
          .range([0, innerWidth])
          .padding(0.2);

        // Build stack data based on visibility
        var stackKeys = [];
        if (tierVisibility.excellent) { stackKeys.push('excellentCount'); }
        if (tierVisibility.good) { stackKeys.push('goodCount'); }
        if (tierVisibility.fair) { stackKeys.push('fairCount'); }
        if (tierVisibility.poor) { stackKeys.push('poorCount'); }

        // Calculate max for visible tiers
        var maxCommits = d3.max(sortedWeeks, function(w) {
          var total = 0;
          if (tierVisibility.excellent) { total += w.excellentCount; }
          if (tierVisibility.good) { total += w.goodCount; }
          if (tierVisibility.fair) { total += w.fairCount; }
          if (tierVisibility.poor) { total += w.poorCount; }
          return total;
        });

        var yScaleLeft = d3.scaleLinear()
          .domain([0, Math.max(maxCommits || 1, 1)])
          .range([innerHeight, 0]);

        // Y scale for avg score (right axis)
        var yScaleRight = d3.scaleLinear()
          .domain([0, 100])
          .range([innerHeight, 0]);

        // Stack generator
        var stack = d3.stack()
          .keys(stackKeys)
          .order(d3.stackOrderNone)
          .offset(d3.stackOffsetNone);

        var stackedData = stack(sortedWeeks);

        // Color mapping
        var colorMap = {
          excellentCount: TIER_COLORS.excellent,
          goodCount: TIER_COLORS.good,
          fairCount: TIER_COLORS.fair,
          poorCount: TIER_COLORS.poor,
        };

        var tierMap = {
          excellentCount: 'excellent',
          goodCount: 'good',
          fairCount: 'fair',
          poorCount: 'poor',
        };

        // Draw stacked bars
        stackedData.forEach(function(layer) {
          g.selectAll('.bar-' + layer.key)
            .data(layer)
            .enter()
            .append('rect')
            .attr('class', 'bar bar-' + layer.key)
            .attr('x', function(d) { return xScale(d.data.week); })
            .attr('y', function(d) { return yScaleLeft(d[1]); })
            .attr('width', xScale.bandwidth())
            .attr('height', function(d) { return yScaleLeft(d[0]) - yScaleLeft(d[1]); })
            .attr('fill', colorMap[layer.key])
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', function(d) {
              var tier = tierMap[layer.key];
              var count = d[1] - d[0];
              return formatTierLabel(tier) + ' commits: ' + count + ' for week of ' + d.data.week;
            })
            .on('mouseover', function(event, d) {
              var tier = tierMap[layer.key];
              showBarTooltip(event, d.data, tier);
              d3.select(this).attr('opacity', 0.8);
            })
            .on('mouseout', function() {
              hideTooltip();
              d3.select(this).attr('opacity', 1);
            })
            .on('click', function(event, d) {
              var tier = tierMap[layer.key];
              requestTierDrillDown(tier, d.data.week);
            })
            .on('keydown', function(event, d) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                var tier = tierMap[layer.key];
                requestTierDrillDown(tier, d.data.week);
              }
            });
        });

        // Draw avg score line
        var line = d3.line()
          .x(function(d) { return xScale(d.week) + xScale.bandwidth() / 2; })
          .y(function(d) { return yScaleRight(d.avgHygieneScore); })
          .curve(d3.curveMonotoneX);

        g.append('path')
          .datum(sortedWeeks)
          .attr('class', 'score-line')
          .attr('fill', 'none')
          .attr('stroke', '#f97316')
          .attr('stroke-width', 2.5)
          .attr('stroke-dasharray', '5,3')
          .attr('d', line);

        // Draw data points on the line
        g.selectAll('.score-point')
          .data(sortedWeeks)
          .enter()
          .append('circle')
          .attr('class', 'score-point')
          .attr('cx', function(d) { return xScale(d.week) + xScale.bandwidth() / 2; })
          .attr('cy', function(d) { return yScaleRight(d.avgHygieneScore); })
          .attr('r', 4)
          .attr('fill', '#f97316')
          .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
          .attr('stroke-width', 2);

        // Draw axes
        g.append('g')
          .attr('class', 'x-axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(xScale).tickFormat(function(d) {
            return formatWeekLabel(d);
          }))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        g.append('g')
          .attr('class', 'y-axis')
          .call(d3.axisLeft(yScaleLeft).ticks(5))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)');

        g.append('g')
          .attr('class', 'y-axis-right')
          .attr('transform', 'translate(' + innerWidth + ', 0)')
          .call(d3.axisRight(yScaleRight).ticks(5))
          .selectAll('text')
          .attr('fill', '#f97316');

        // Y-axis labels
        g.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -45)
          .attr('x', -innerHeight / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Commits');

        g.append('text')
          .attr('transform', 'rotate(90)')
          .attr('y', -innerWidth - 45)
          .attr('x', innerHeight / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', '#f97316')
          .attr('font-size', '11px')
          .text('Avg Score');
      }

      // ======================================================================
      // Donut Chart Rendering
      // ======================================================================
      function renderDonutChart(weeks) {
        var svg = d3.select('#donutSvg');
        svg.selectAll('*').remove();

        // Aggregate totals
        var totals = { excellent: 0, good: 0, fair: 0, poor: 0 };
        weeks.forEach(function(w) {
          if (tierVisibility.excellent) totals.excellent += w.excellentCount;
          if (tierVisibility.good) totals.good += w.goodCount;
          if (tierVisibility.fair) totals.fair += w.fairCount;
          if (tierVisibility.poor) totals.poor += w.poorCount;
        });

        var total = totals.excellent + totals.good + totals.fair + totals.poor;
        if (total === 0) {
          distributionStats.innerHTML = '<span class="no-data">No commits to display.</span>';
          return;
        }

        var data = [
          { tier: 'excellent', count: totals.excellent, color: TIER_COLORS.excellent },
          { tier: 'good', count: totals.good, color: TIER_COLORS.good },
          { tier: 'fair', count: totals.fair, color: TIER_COLORS.fair },
          { tier: 'poor', count: totals.poor, color: TIER_COLORS.poor },
        ].filter(function(d) { return d.count > 0; });

        var containerWidth = Math.max(200, document.querySelector('.donut-container').clientWidth - 24);
        var size = Math.min(containerWidth, 250);
        var radius = size / 2;
        var innerRadius = radius * 0.6;

        svg.attr('width', size).attr('height', size);

        var g = svg.append('g')
          .attr('transform', 'translate(' + radius + ',' + radius + ')');

        var pie = d3.pie()
          .value(function(d) { return d.count; })
          .sort(null);

        var arc = d3.arc()
          .innerRadius(innerRadius)
          .outerRadius(radius - 10);

        var arcs = g.selectAll('.arc')
          .data(pie(data))
          .enter()
          .append('g')
          .attr('class', 'arc');

        arcs.append('path')
          .attr('d', arc)
          .attr('fill', function(d) { return d.data.color; })
          .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
          .attr('stroke-width', 2)
          .on('mouseover', function(event, d) {
            showDonutTooltip(event, d.data, total);
            d3.select(this).attr('opacity', 0.8);
          })
          .on('mouseout', function() {
            hideTooltip();
            d3.select(this).attr('opacity', 1);
          });

        // Center text
        g.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '-0.2em')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '24px')
          .attr('font-weight', '700')
          .text(total);

        g.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '1.2em')
          .attr('fill', 'var(--vscode-descriptionForeground, #999)')
          .attr('font-size', '12px')
          .text('commits');

        // Distribution stats
        var goodPct = ((totals.excellent + totals.good) / total * 100).toFixed(0);
        distributionStats.innerHTML = '<div class="dist-stat">' +
          '<span class="dist-value">' + goodPct + '%</span>' +
          '<span class="dist-label">Good or Better</span>' +
          '</div>';
      }

      // ======================================================================
      // Factor Breakdown Rendering
      // ======================================================================
      function renderFactorBreakdown(weeks) {
        if (!weeks || weeks.length === 0) {
          factorBars.innerHTML = '<p class="empty-text">No data for factor breakdown.</p>';
          return;
        }

        // Calculate factor compliance rates from weekly data
        var totalCommits = 0;
        var totalConventional = 0;

        weeks.forEach(function(w) {
          totalCommits += w.totalCommits;
          totalConventional += w.conventionalCommits;
        });

        if (totalCommits === 0) {
          factorBars.innerHTML = '<p class="empty-text">No commits to analyze.</p>';
          return;
        }

        var factors = [
          { name: 'Conventional Prefix', pct: (totalConventional / totalCommits) * 100 },
        ];

        // If we have author data, calculate more factors
        if (authorSummaryData && authorSummaryData.length > 0) {
          var totalFromAuthors = 0;
          var withScope = 0;
          var withBody = 0;

          authorSummaryData.forEach(function(a) {
            totalFromAuthors += a.totalCommits;
            withScope += a.scopedCommits;
            withBody += a.commitsWithBody;
          });

          if (totalFromAuthors > 0) {
            factors.push({ name: 'Has Scope', pct: (withScope / totalFromAuthors) * 100 });
            factors.push({ name: 'Has Body', pct: (withBody / totalFromAuthors) * 100 });
          }
        }

        var html = '';
        factors.forEach(function(f) {
          var colorClass = f.pct >= 80 ? 'bar-excellent' :
                           f.pct >= 60 ? 'bar-good' :
                           f.pct >= 40 ? 'bar-fair' : 'bar-poor';
          html += '<div class="factor-row">' +
                  '<span class="factor-name">' + escapeHtml(f.name) + '</span>' +
                  '<div class="factor-bar-outer">' +
                  '<div class="factor-bar-inner ' + colorClass + '" style="width: ' + f.pct.toFixed(0) + '%;"></div>' +
                  '</div>' +
                  '<span class="factor-pct">' + f.pct.toFixed(0) + '%</span>' +
                  '</div>';
        });

        factorBars.innerHTML = html;
      }

      // ======================================================================
      // Leaderboard Rendering
      // ======================================================================
      function renderLeaderboard(summaries) {
        if (!summaries || summaries.length === 0) {
          authorsTableBody.innerHTML = '<tr><td colspan="5" class="empty-text">No author data found.</td></tr>';
          return;
        }

        // Sort by avgHygieneScore descending, take top 10
        var sorted = summaries.slice().sort(function(a, b) {
          return b.avgHygieneScore - a.avgHygieneScore;
        }).slice(0, 10);

        authorsTableBody.innerHTML = sorted.map(function(author, index) {
          var scoreClass = author.avgHygieneScore >= 80 ? 'tier-excellent' :
                           author.avgHygieneScore >= 60 ? 'tier-good' :
                           author.avgHygieneScore >= 40 ? 'tier-fair' : 'tier-poor';
          var medal = index === 0 ? '&#129351;' : index === 1 ? '&#129352;' : index === 2 ? '&#129353;' : (index + 1);
          return '<tr class="' + scoreClass + '">' +
            '<td class="rank-cell">' + medal + '</td>' +
            '<td>' + escapeHtml(author.fullName || author.author) + '</td>' +
            '<td><span class="score-badge ' + scoreClass + '">' + author.avgHygieneScore.toFixed(0) + '</span></td>' +
            '<td>' + author.totalCommits + '</td>' +
            '<td>' + author.conventionalPct.toFixed(0) + '%</td>' +
            '</tr>';
        }).join('');
      }

      // ======================================================================
      // Commits Table
      // ======================================================================
      function renderCommitsTable(commits) {
        if (!commits || commits.length === 0) {
          commitsTableBody.innerHTML = '<tr><td colspan="7" class="empty-text">No poor commits found.</td></tr>';
          return;
        }

        // Sort by hygiene score ascending (worst first), take top 20
        var sortedCommits = commits.slice().sort(function(a, b) {
          return a.hygieneScore - b.hygieneScore;
        }).slice(0, 20);

        commitsTableBody.innerHTML = sortedCommits.map(function(commit) {
          var tierClass = 'tier-' + commit.qualityTier;
          var issues = getCommitIssues(commit);
          return '<tr class="' + tierClass + '">' +
            '<td class="sha-cell">' +
            '<a href="#" class="commit-link" data-sha="' + escapeHtml(commit.sha) + '" data-repo="' + escapeHtml(commit.repository) + '">' +
            escapeHtml(commit.sha.substring(0, 8)) + '</a></td>' +
            '<td>' + formatDate(commit.commitDate) + '</td>' +
            '<td>' + escapeHtml(commit.author) + '</td>' +
            '<td class="message-cell">' + escapeHtml(commit.commitMessageSubject.substring(0, 40)) + (commit.commitMessageSubject.length > 40 ? '...' : '') + '</td>' +
            '<td><span class="score-badge ' + tierClass + '">' + commit.hygieneScore.toFixed(0) + '</span></td>' +
            '<td class="issues-cell" tabindex="0" data-full-issues="' + escapeHtml(issues) + '" aria-label="Issues: ' + escapeHtml(issues) + '">' + escapeHtml(issues) + '</td>' +
            '<td><button class="action-btn-small view-diff-btn" data-sha="' + escapeHtml(commit.sha) + '" data-repo="' + escapeHtml(commit.repository) + '">Diff</button></td>' +
            '</tr>';
        }).join('');

        // Attach click handlers
        var commitLinks = commitsTableBody.querySelectorAll('.commit-link');
        commitLinks.forEach(function(link) {
          link.addEventListener('click', function(e) {
            e.preventDefault();
            vscode.postMessage({
              type: 'requestCommitDrillDown',
              sha: this.getAttribute('data-sha'),
              repository: this.getAttribute('data-repo'),
            });
          });
        });

        var diffBtns = commitsTableBody.querySelectorAll('.view-diff-btn');
        diffBtns.forEach(function(btn) {
          btn.addEventListener('click', function() {
            vscode.postMessage({
              type: 'requestOpenDiff',
              sha: this.getAttribute('data-sha'),
              repository: this.getAttribute('data-repo'),
            });
          });
        });

        // Attach Issues cell tooltip handlers
        attachIssuesTooltipHandlers();
      }

      // ======================================================================
      // Issues Column Tooltip (IQS-939)
      // ======================================================================
      var issuesTooltipTimeout = null;

      function attachIssuesTooltipHandlers() {
        var issuesCells = document.querySelectorAll('.issues-cell[data-full-issues]');
        issuesCells.forEach(function(cell) {
          // Mouse events
          cell.addEventListener('mouseenter', function(e) {
            var fullIssues = this.getAttribute('data-full-issues');
            if (fullIssues) {
              issuesTooltipTimeout = setTimeout(function() {
                showIssuesTooltip(e, fullIssues);
              }, 200); // 200ms debounce delay
            }
          });

          cell.addEventListener('mouseleave', function() {
            clearTimeout(issuesTooltipTimeout);
            hideTooltip();
          });

          cell.addEventListener('mousemove', function(e) {
            if (tooltip.classList.contains('visible')) {
              moveTooltip(e);
            }
          });

          // Keyboard accessibility - show tooltip on focus
          cell.addEventListener('focus', function(e) {
            var fullIssues = this.getAttribute('data-full-issues');
            if (fullIssues) {
              showIssuesTooltip(e, fullIssues);
            }
          });

          cell.addEventListener('blur', function() {
            hideTooltip();
          });
        });
      }

      function showIssuesTooltip(event, issues) {
        // Split issues by comma for better readability
        var issuesList = issues.split(', ');
        var html = '<div class="tt-title"><strong>Commit Issues</strong></div>' +
                   '<hr class="tt-divider">' +
                   '<ul class="issues-list">';
        issuesList.forEach(function(issue) {
          html += '<li>' + escapeHtml(issue.trim()) + '</li>';
        });
        html += '</ul>';

        tooltip.innerHTML = html;
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        moveTooltip(event);
      }

      // ======================================================================
      // Tooltip Functions
      // ======================================================================
      function showBarTooltip(event, week, tier) {
        var tierLabel = formatTierLabel(tier);
        var count = tier === 'excellent' ? week.excellentCount :
                    tier === 'good' ? week.goodCount :
                    tier === 'fair' ? week.fairCount : week.poorCount;

        var html =
          '<div class="tt-title"><strong>Week of ' + formatDate(week.week) + '</strong></div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-stat"><span class="tier-badge tier-' + tier + '">' + tierLabel + '</span></div>' +
          '<div class="tt-stat">Commits: <strong>' + count + '</strong></div>' +
          '<div class="tt-stat">Avg Score: <strong>' + week.avgHygieneScore.toFixed(1) + '</strong></div>' +
          '<div class="tt-action">[Click for details]</div>';

        tooltip.innerHTML = html;
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        moveTooltip(event);
      }

      function showDonutTooltip(event, data, total) {
        var pct = (data.count / total * 100).toFixed(1);
        var html =
          '<div class="tt-title"><strong>' + formatTierLabel(data.tier) + '</strong></div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-stat">Commits: <strong>' + data.count + '</strong></div>' +
          '<div class="tt-stat">Percentage: <strong>' + pct + '%</strong></div>';

        tooltip.innerHTML = html;
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
      // Drill-Down Requests
      // ======================================================================
      function requestTierDrillDown(tier, week) {
        vscode.postMessage({
          type: 'requestTierDrillDown',
          tier: tier,
          week: week,
          filters: getFilters(),
        });
      }

      // ======================================================================
      // Summary Stats
      // ======================================================================
      function renderSummaryStats(weeks) {
        var totalExcellent = 0, totalGood = 0, totalFair = 0, totalPoor = 0;

        weeks.forEach(function(w) {
          totalExcellent += w.excellentCount;
          totalGood += w.goodCount;
          totalFair += w.fairCount;
          totalPoor += w.poorCount;
        });

        var html = '';
        html += createStatCard(weeks.length.toString(), 'Weeks');
        html += createStatCard(totalExcellent.toString(), 'Excellent', 'excellent');
        html += createStatCard(totalGood.toString(), 'Good', 'good');
        html += createStatCard(totalFair.toString(), 'Fair', 'fair');
        html += createStatCard(totalPoor.toString(), 'Poor', 'poor');

        summaryStats.innerHTML = html;
      }

      function createStatCard(value, label, tier) {
        var tierClass = tier ? ' stat-' + tier : '';
        return '<div class="stat-card' + tierClass + '">' +
               '<div class="stat-value">' + escapeHtml(String(value)) + '</div>' +
               '<div class="stat-label">' + escapeHtml(label) + '</div></div>';
      }

      // ======================================================================
      // Legend
      // ======================================================================
      function renderLegend() {
        legendContainer.innerHTML = '';

        var tiers = [
          { key: 'excellent', label: 'Excellent (>= 80)', color: TIER_COLORS.excellent },
          { key: 'good', label: 'Good (60-79)', color: TIER_COLORS.good },
          { key: 'fair', label: 'Fair (40-59)', color: TIER_COLORS.fair },
          { key: 'poor', label: 'Poor (< 40)', color: TIER_COLORS.poor },
        ];

        tiers.forEach(function(tier) {
          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = tier.color;
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.textContent = tier.label;
          item.appendChild(label);

          legendContainer.appendChild(item);
        });

        // Add avg score legend
        var scoreItem = document.createElement('div');
        scoreItem.className = 'legend-item';
        scoreItem.innerHTML = '<span class="legend-line" style="background: #f97316;"></span><span>Avg Score (line)</span>';
        legendContainer.appendChild(scoreItem);
      }

      // ======================================================================
      // Utility Functions
      // ======================================================================
      function formatTierLabel(tier) {
        var labels = {
          excellent: 'Excellent',
          good: 'Good',
          fair: 'Fair',
          poor: 'Poor',
        };
        return labels[tier] || tier;
      }

      function formatDate(dateString) {
        if (!dateString) { return ''; }
        var d = new Date(dateString);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      function formatWeekLabel(dateString) {
        if (!dateString) { return ''; }
        var d = new Date(dateString);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }

      function getFilters() {
        var filters = {};
        if (repositoryFilter.value) { filters.repository = repositoryFilter.value; }
        if (authorFilter.value) { filters.author = authorFilter.value; }
        if (teamFilter.value) { filters.team = teamFilter.value; }
        if (startDateInput.value) { filters.startDate = startDateInput.value; }
        if (endDateInput.value) { filters.endDate = endDateInput.value; }
        return filters;
      }

      // ======================================================================
      // State Management
      // ======================================================================
      function showLoading() {
        loadingState.style.display = 'flex';
        errorState.style.display = 'none';
        emptyState.style.display = 'none';
        chartArea.style.display = 'none';
        summaryMetric.style.display = 'none';
        drillDownPanel.style.display = 'none';
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
      // Data Requests
      // ======================================================================
      function requestData() {
        showLoading();
        vscode.postMessage({
          type: 'requestHygieneData',
          filters: getFilters(),
        });
      }

      // ======================================================================
      // Window Resize Handler
      // ======================================================================
      var resizeTimeout;
      window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function() {
          if (weeksData && weeksData.length > 0) {
            renderStackedBarChart(weeksData);
            renderDonutChart(weeksData);
          }
        }, 200);
      });

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
