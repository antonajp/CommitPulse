/**
 * HTML content generator for the Release Risk Gauge dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Speedometer-style gauge (0-100) with color zones (green/yellow/orange/red)
 * - Animated needle pointing to current risk score
 * - Risk breakdown panel with 4 mini gauges (complexity, tests, experience, hotspot)
 * - Bar chart showing top 5 riskiest commits
 * - Click commit to open diff
 * - Branch/repository selectors
 * - Risk badges: "Ship it", "Review recommended", "Review required", "High risk - escalate"
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-912
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the release risk HTML.
 */
export interface ReleaseRiskHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the release-risk CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Release Risk Gauge dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateReleaseRiskHtml(config: ReleaseRiskHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Release Risk Gauge</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Release Risk Gauge</h1>
      <div class="controls">
        <div class="filter-group">
          <label for="repositoryFilter">Repository</label>
          <select id="repositoryFilter" aria-label="Repository filter" tabindex="0">
            <option value="">All Repositories</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="branchFilter">Branch</label>
          <select id="branchFilter" aria-label="Branch filter" tabindex="0">
            <option value="">All Branches</option>
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

    <div id="riskBadge" class="risk-badge" role="status" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading release risk data...</span>
    </div>

    <div id="errorState" style="display:none;"></div>

    <div id="emptyState" style="display:none;"></div>

    <div id="chartArea" style="display:none;">
      <details class="chart-explanation" open>
        <summary class="explanation-toggle">
          <svg class="chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>What does this dashboard show?</span>
        </summary>
        <div class="explanation-content">
          <p>This dashboard calculates release risk based on four factors: code complexity changes, test coverage, author experience, and hot spot file modifications. The main gauge shows overall release risk (0-100), while the breakdown gauges show individual factor contributions. Use the riskiest commits chart to prioritize code review efforts.</p>
        </div>
      </details>
      <div class="gauge-section">
        <div class="main-gauge-container">
          <h2>Overall Release Risk</h2>
          <div class="gauge-svg-container" role="img" aria-label="Speedometer gauge showing overall release risk">
            <svg id="mainGaugeSvg"></svg>
          </div>
          <div id="gaugeValue" class="gauge-value">--</div>
          <div id="gaugeLabel" class="gauge-label">Risk Score</div>
        </div>

        <div class="breakdown-gauges">
          <h2>Risk Breakdown</h2>
          <div class="mini-gauges-grid">
            <div class="mini-gauge-container">
              <div class="mini-gauge-svg" role="img" aria-label="Complexity risk mini gauge">
                <svg id="complexityGaugeSvg" class="mini-gauge"></svg>
              </div>
              <div id="complexityValue" class="mini-gauge-value">--</div>
              <div class="mini-gauge-label">Complexity</div>
            </div>
            <div class="mini-gauge-container">
              <div class="mini-gauge-svg" role="img" aria-label="Test coverage risk mini gauge">
                <svg id="testGaugeSvg" class="mini-gauge"></svg>
              </div>
              <div id="testValue" class="mini-gauge-value">--</div>
              <div class="mini-gauge-label">Tests</div>
            </div>
            <div class="mini-gauge-container">
              <div class="mini-gauge-svg" role="img" aria-label="Experience risk mini gauge">
                <svg id="experienceGaugeSvg" class="mini-gauge"></svg>
              </div>
              <div id="experienceValue" class="mini-gauge-value">--</div>
              <div class="mini-gauge-label">Experience</div>
            </div>
            <div class="mini-gauge-container">
              <div class="mini-gauge-svg" role="img" aria-label="Hotspot risk mini gauge">
                <svg id="hotspotGaugeSvg" class="mini-gauge"></svg>
              </div>
              <div id="hotspotValue" class="mini-gauge-value">--</div>
              <div class="mini-gauge-label">Hotspots</div>
            </div>
          </div>
        </div>
      </div>

      <div class="riskiest-commits-section">
        <h2>Top 5 Riskiest Commits</h2>
        <div id="riskiestCommitsChart" class="bar-chart-container" role="img" aria-label="Bar chart showing riskiest commits">
          <svg id="commitsBarSvg"></svg>
        </div>
        <div class="chart-instructions">
          <p>Click a commit bar to view details. Bars show total risk score.</p>
        </div>
      </div>

      <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

      <div id="legendContainer" class="chart-legend risk-legend" role="img" aria-label="Risk category legend"></div>
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
      var commitsData = null;
      var summaryData = null;

      // Risk category colors (colorblind-accessible)
      var RISK_COLORS = {
        critical: '#dc2626',  // red-600
        high: '#ea580c',      // orange-600
        medium: '#ca8a04',    // yellow-600
        low: '#16a34a',       // green-600
      };

      // Risk zones for gauge
      var RISK_ZONES = [
        { min: 0, max: 25, category: 'low', label: 'Low Risk', color: '#16a34a' },
        { min: 25, max: 50, category: 'medium', label: 'Medium Risk', color: '#ca8a04' },
        { min: 50, max: 75, category: 'high', label: 'High Risk', color: '#ea580c' },
        { min: 75, max: 100, category: 'critical', label: 'Critical Risk', color: '#dc2626' },
      ];

      // Risk badge configurations
      var RISK_BADGES = {
        low: { text: 'Ship it \\u2713', class: 'badge-low', description: 'Low risk - safe to deploy' },
        medium: { text: 'Review recommended', class: 'badge-medium', description: 'Medium risk - review advised' },
        high: { text: 'Review required \\u26A0', class: 'badge-high', description: 'High risk - requires review' },
        critical: { text: 'High risk - escalate', class: 'badge-critical', description: 'Critical risk - needs escalation' },
      };

      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('applyFilterBtn');
      var repositoryFilter = document.getElementById('repositoryFilter');
      var branchFilter = document.getElementById('branchFilter');
      var startDateInput = document.getElementById('startDate');
      var endDateInput = document.getElementById('endDate');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var riskBadge = document.getElementById('riskBadge');
      var summaryStats = document.getElementById('summaryStats');
      var legendContainer = document.getElementById('legendContainer');
      var drillDownPanel = document.getElementById('drillDownPanel');
      var drillDownTitle = document.getElementById('drillDownTitle');
      var drillDownContent = document.getElementById('drillDownContent');
      var closeDrillDown = document.getElementById('closeDrillDown');
      var tooltip = document.getElementById('tooltip');
      var gaugeValue = document.getElementById('gaugeValue');
      var gaugeLabel = document.getElementById('gaugeLabel');
      var complexityValue = document.getElementById('complexityValue');
      var testValue = document.getElementById('testValue');
      var experienceValue = document.getElementById('experienceValue');
      var hotspotValue = document.getElementById('hotspotValue');

      // Set default date range (last 30 days)
      var today = new Date();
      var thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      endDateInput.value = today.toISOString().split('T')[0];
      startDateInput.value = thirtyDaysAgo.toISOString().split('T')[0];

      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', function() {
        if (!commitsData || commitsData.length === 0) { return; }
        var headers = ['SHA', 'Date', 'Author', 'Branch', 'Repository',
                       'Complexity Risk', 'Test Risk', 'Experience Risk', 'Hotspot Risk',
                       'Total Risk', 'Category', 'Ticket'];
        var rows = commitsData.map(function(c) {
          return [c.sha.substring(0, 8), c.commitDate, c.author, c.branch, c.repository,
                  (c.complexityRisk * 100).toFixed(1), (c.testCoverageRisk * 100).toFixed(1),
                  (c.experienceRisk * 100).toFixed(1), (c.hotspotRisk * 100).toFixed(1),
                  (c.totalRisk * 100).toFixed(1), c.riskCategory, c.ticketId || ''];
        });
        exportCsvFromData(headers, rows, 'release-risk.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        requestData();
      });

      closeDrillDown.addEventListener('click', function() {
        drillDownPanel.style.display = 'none';
      });

      // ======================================================================
      // Message Handling
      // ======================================================================
      window.addEventListener('message', function(event) {
        var message = event.data;
        switch (message.type) {
          case 'releaseRiskData':
            handleRiskData(message);
            break;
          case 'releaseRiskFilterOptions':
            handleFilterOptions(message);
            break;
          case 'commitDrillDown':
            handleCommitDrillDown(message);
            break;
          case 'releaseRiskError':
            showError(escapeHtml(message.message));
            break;
          case 'releaseRiskLoading':
            if (message.isLoading) { showLoading(); } else { hideLoading(); }
            break;
        }
      });

      function handleRiskData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Release Risk View Not Available',
            'The vw_commit_risk database view has not been created yet. Run the database migration (018) to enable this chart.'
          );
          return;
        }

        if (!message.hasData || message.commits.length === 0) {
          showEmpty(
            'No Release Risk Data Available',
            'No commit risk data found. Run the pipeline to analyze commit risks.'
          );
          return;
        }

        commitsData = message.commits;
        summaryData = message.summary;

        var riskScore = summaryData ? summaryData.releaseRiskScore * 100 : calculateAverageRisk(commitsData);
        var riskCategory = summaryData ? summaryData.riskCategory : getRiskCategory(riskScore);

        renderMainGauge(riskScore);
        renderBreakdownGauges(summaryData);
        renderRiskBadge(riskCategory, riskScore);
        renderRiskiestCommits(commitsData);
        renderSummaryStats(summaryData, commitsData);
        renderLegend();

        chartArea.style.display = 'block';
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

        // Populate branch filter
        while (branchFilter.options.length > 1) {
          branchFilter.remove(1);
        }
        (message.branches || []).forEach(function(branch) {
          var option = document.createElement('option');
          option.value = branch;
          option.textContent = branch;
          branchFilter.appendChild(option);
        });
      }

      function handleCommitDrillDown(message) {
        if (!message.hasData || !message.commit) {
          drillDownContent.innerHTML = '<p class="empty-text">Commit details not found.</p>';
          drillDownPanel.style.display = 'block';
          return;
        }

        var commit = message.commit;
        drillDownTitle.textContent = 'Commit: ' + escapeHtml(commit.sha.substring(0, 8));

        var categoryClass = 'category-' + commit.riskCategory;
        var html = '';
        html += '<div class="commit-detail-header">';
        html += '<div class="commit-sha">' + escapeHtml(commit.sha) + '</div>';
        html += '<div class="commit-meta">';
        html += '<span class="commit-author">' + escapeHtml(commit.author) + '</span>';
        html += ' on <span class="commit-date">' + formatDate(commit.commitDate) + '</span>';
        html += '</div>';
        if (commit.commitMessageSummary) {
          html += '<div class="commit-message">' + escapeHtml(commit.commitMessageSummary) + '</div>';
        }
        html += '</div>';

        html += '<div class="risk-score-large ' + categoryClass + '">';
        html += '<span class="score-value">' + (commit.totalRisk * 100).toFixed(0) + '</span>';
        html += '<span class="score-label">Total Risk</span>';
        html += '</div>';

        html += '<div class="risk-breakdown-detail">';
        html += '<h3>Risk Factors</h3>';
        html += '<div class="risk-factors-grid">';
        html += createRiskFactor('Complexity', commit.complexityRisk, 'Based on cyclomatic complexity change');
        html += createRiskFactor('Test Coverage', commit.testCoverageRisk, 'Inverse of test file ratio');
        html += createRiskFactor('Experience', commit.experienceRisk, 'Inverse of author experience');
        html += createRiskFactor('Hotspots', commit.hotspotRisk, 'Critical/high hotspot files touched');
        html += '</div></div>';

        html += '<div class="commit-stats">';
        html += '<h3>Commit Stats</h3>';
        html += '<div class="stats-grid">';
        html += '<div class="stat-item"><span class="stat-val">' + commit.fileCount + '</span><span class="stat-lbl">Files</span></div>';
        html += '<div class="stat-item"><span class="stat-val">' + commit.testFileCount + '</span><span class="stat-lbl">Test Files</span></div>';
        html += '<div class="stat-item"><span class="stat-val">' + commit.locDelta + '</span><span class="stat-lbl">LOC Delta</span></div>';
        html += '<div class="stat-item"><span class="stat-val">' + commit.complexityDelta + '</span><span class="stat-lbl">Complexity Delta</span></div>';
        html += '</div></div>';

        if (commit.ticketId) {
          html += '<div class="commit-ticket">';
          html += '<span class="ticket-label">Linked Ticket:</span>';
          html += '<span class="ticket-id">' + escapeHtml(commit.ticketId) + '</span>';
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

      function createRiskFactor(label, value, description) {
        var percent = (value * 100).toFixed(0);
        var category = getRiskCategoryForValue(value);
        return '<div class="risk-factor">' +
               '<div class="factor-header">' +
               '<span class="factor-label">' + escapeHtml(label) + '</span>' +
               '<span class="factor-value category-' + category + '">' + percent + '%</span>' +
               '</div>' +
               '<div class="factor-bar"><div class="factor-fill category-' + category + '" style="width:' + percent + '%"></div></div>' +
               '<div class="factor-desc">' + escapeHtml(description) + '</div>' +
               '</div>';
      }

      // ======================================================================
      // Main Gauge Rendering with D3.js
      // ======================================================================
      function renderMainGauge(riskScore) {
        var svg = d3.select('#mainGaugeSvg');
        svg.selectAll('*').remove();

        var width = 280;
        var height = 160;
        var cx = width / 2;
        var cy = height - 20;
        var outerRadius = 110;
        var innerRadius = 80;

        svg.attr('width', width).attr('height', height);

        var g = svg.append('g')
          .attr('transform', 'translate(' + cx + ',' + cy + ')');

        // Draw background arc zones
        var arcGenerator = d3.arc()
          .innerRadius(innerRadius)
          .outerRadius(outerRadius);

        var totalAngle = Math.PI;
        RISK_ZONES.forEach(function(zone) {
          var startAngle = -Math.PI / 2 + (zone.min / 100) * totalAngle;
          var endAngle = -Math.PI / 2 + (zone.max / 100) * totalAngle;
          g.append('path')
            .attr('d', arcGenerator({ startAngle: startAngle, endAngle: endAngle }))
            .attr('fill', zone.color)
            .attr('opacity', 0.3);
        });

        // Draw gauge track
        g.append('path')
          .attr('d', arcGenerator({ startAngle: -Math.PI / 2, endAngle: Math.PI / 2 }))
          .attr('fill', 'none')
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-width', 2);

        // Draw tick marks
        for (var i = 0; i <= 100; i += 25) {
          var angle = -Math.PI / 2 + (i / 100) * Math.PI;
          var x1 = (outerRadius + 5) * Math.cos(angle);
          var y1 = (outerRadius + 5) * Math.sin(angle);
          var x2 = (outerRadius + 15) * Math.cos(angle);
          var y2 = (outerRadius + 15) * Math.sin(angle);

          g.append('line')
            .attr('x1', x1).attr('y1', y1)
            .attr('x2', x2).attr('y2', y2)
            .attr('stroke', 'var(--vscode-foreground, #ccc)')
            .attr('stroke-width', 2);

          g.append('text')
            .attr('x', (outerRadius + 28) * Math.cos(angle))
            .attr('y', (outerRadius + 28) * Math.sin(angle))
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', 'var(--vscode-foreground, #ccc)')
            .attr('font-size', '10px')
            .text(i);
        }

        // Draw needle
        var needleAngle = -Math.PI / 2 + (riskScore / 100) * Math.PI;
        var needleLength = innerRadius - 10;

        g.append('line')
          .attr('class', 'gauge-needle')
          .attr('x1', 0).attr('y1', 0)
          .attr('x2', 0).attr('y2', -needleLength)
          .attr('stroke', 'var(--vscode-foreground, #fff)')
          .attr('stroke-width', 3)
          .attr('stroke-linecap', 'round')
          .attr('transform', 'rotate(' + (needleAngle * 180 / Math.PI + 90) + ')');

        // Draw center circle
        g.append('circle')
          .attr('cx', 0).attr('cy', 0)
          .attr('r', 8)
          .attr('fill', 'var(--vscode-foreground, #fff)');

        // Update value display
        var category = getRiskCategory(riskScore);
        gaugeValue.textContent = riskScore.toFixed(0);
        gaugeValue.className = 'gauge-value category-' + category;
        gaugeLabel.textContent = formatRiskLabel(category);
      }

      // ======================================================================
      // Mini Gauges Rendering
      // ======================================================================
      function renderBreakdownGauges(summary) {
        if (!summary || !summary.riskBreakdown) {
          complexityValue.textContent = '--';
          testValue.textContent = '--';
          experienceValue.textContent = '--';
          hotspotValue.textContent = '--';
          return;
        }

        var breakdown = summary.riskBreakdown;

        renderMiniGauge('complexityGaugeSvg', breakdown.avgComplexityRisk * 100);
        complexityValue.textContent = (breakdown.avgComplexityRisk * 100).toFixed(0) + '%';
        complexityValue.className = 'mini-gauge-value category-' + getRiskCategoryForValue(breakdown.avgComplexityRisk);

        renderMiniGauge('testGaugeSvg', breakdown.avgTestCoverageRisk * 100);
        testValue.textContent = (breakdown.avgTestCoverageRisk * 100).toFixed(0) + '%';
        testValue.className = 'mini-gauge-value category-' + getRiskCategoryForValue(breakdown.avgTestCoverageRisk);

        renderMiniGauge('experienceGaugeSvg', breakdown.avgExperienceRisk * 100);
        experienceValue.textContent = (breakdown.avgExperienceRisk * 100).toFixed(0) + '%';
        experienceValue.className = 'mini-gauge-value category-' + getRiskCategoryForValue(breakdown.avgExperienceRisk);

        renderMiniGauge('hotspotGaugeSvg', breakdown.avgHotspotRisk * 100);
        hotspotValue.textContent = (breakdown.avgHotspotRisk * 100).toFixed(0) + '%';
        hotspotValue.className = 'mini-gauge-value category-' + getRiskCategoryForValue(breakdown.avgHotspotRisk);
      }

      function renderMiniGauge(svgId, value) {
        var svg = d3.select('#' + svgId);
        svg.selectAll('*').remove();

        var width = 80;
        var height = 50;
        var cx = width / 2;
        var cy = height - 5;
        var outerRadius = 35;
        var innerRadius = 25;

        svg.attr('width', width).attr('height', height);

        var g = svg.append('g')
          .attr('transform', 'translate(' + cx + ',' + cy + ')');

        var arcGenerator = d3.arc()
          .innerRadius(innerRadius)
          .outerRadius(outerRadius);

        // Background arc
        g.append('path')
          .attr('d', arcGenerator({ startAngle: -Math.PI / 2, endAngle: Math.PI / 2 }))
          .attr('fill', 'var(--vscode-panel-border, #444)');

        // Value arc
        var category = getRiskCategory(value);
        var color = RISK_COLORS[category];
        var endAngle = -Math.PI / 2 + (Math.min(value, 100) / 100) * Math.PI;

        g.append('path')
          .attr('d', arcGenerator({ startAngle: -Math.PI / 2, endAngle: endAngle }))
          .attr('fill', color);
      }

      // ======================================================================
      // Risk Badge
      // ======================================================================
      function renderRiskBadge(category, score) {
        var badge = RISK_BADGES[category];
        riskBadge.textContent = badge.text;
        riskBadge.className = 'risk-badge ' + badge.class;
        riskBadge.setAttribute('aria-label', badge.description);
        riskBadge.style.display = 'inline-block';
      }

      // ======================================================================
      // Riskiest Commits Bar Chart
      // ======================================================================
      function renderRiskiestCommits(commits) {
        // Sort by total risk descending and take top 5
        var sortedCommits = commits.slice().sort(function(a, b) {
          return b.totalRisk - a.totalRisk;
        }).slice(0, 5);

        var svg = d3.select('#commitsBarSvg');
        svg.selectAll('*').remove();

        var containerWidth = Math.max(500, document.getElementById('riskiestCommitsChart').clientWidth - 24);
        var width = containerWidth;
        var height = 200;
        var margin = { top: 20, right: 30, bottom: 40, left: 60 };

        svg.attr('width', width).attr('height', height);

        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        var g = svg.append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // X scale
        var xScale = d3.scaleBand()
          .domain(sortedCommits.map(function(c) { return c.sha.substring(0, 7); }))
          .range([0, innerWidth])
          .padding(0.3);

        // Y scale
        var yScale = d3.scaleLinear()
          .domain([0, 100])
          .range([innerHeight, 0]);

        // Draw axes
        g.append('g')
          .attr('class', 'x-axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(xScale))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px');

        g.append('g')
          .attr('class', 'y-axis')
          .call(d3.axisLeft(yScale).ticks(5))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)');

        // Y-axis label
        g.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -45)
          .attr('x', -innerHeight / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Risk Score');

        // Draw bars
        g.selectAll('.bar')
          .data(sortedCommits)
          .enter()
          .append('rect')
          .attr('class', 'bar')
          .attr('x', function(d) { return xScale(d.sha.substring(0, 7)); })
          .attr('y', function(d) { return yScale(d.totalRisk * 100); })
          .attr('width', xScale.bandwidth())
          .attr('height', function(d) { return innerHeight - yScale(d.totalRisk * 100); })
          .attr('fill', function(d) { return RISK_COLORS[d.riskCategory]; })
          .attr('cursor', 'pointer')
          .attr('tabindex', '0')
          .attr('role', 'button')
          .attr('aria-label', function(d) {
            return 'Commit ' + d.sha.substring(0, 7) + ' by ' + d.author + ', risk ' + (d.totalRisk * 100).toFixed(0);
          })
          .on('mouseover', function(event, d) {
            showCommitTooltip(event, d);
            d3.select(this).attr('opacity', 0.8);
          })
          .on('mouseout', function() {
            hideTooltip();
            d3.select(this).attr('opacity', 1);
          })
          .on('click', function(event, d) {
            requestCommitDrillDown(d.sha, d.repository);
          })
          .on('keydown', function(event, d) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              requestCommitDrillDown(d.sha, d.repository);
            }
          });
      }

      // ======================================================================
      // Tooltip Functions
      // ======================================================================
      function showCommitTooltip(event, commit) {
        var html =
          '<div class="tt-title"><strong>' + escapeHtml(commit.sha.substring(0, 8)) + '</strong></div>' +
          '<div class="tt-meta">' + escapeHtml(commit.author) + ' - ' + formatDate(commit.commitDate) + '</div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-stat">Total Risk: <strong class="category-' + commit.riskCategory + '">' + (commit.totalRisk * 100).toFixed(0) + '%</strong></div>' +
          '<div class="tt-stat">Complexity: ' + (commit.complexityRisk * 100).toFixed(0) + '%</div>' +
          '<div class="tt-stat">Tests: ' + (commit.testCoverageRisk * 100).toFixed(0) + '%</div>' +
          '<div class="tt-stat">Experience: ' + (commit.experienceRisk * 100).toFixed(0) + '%</div>' +
          '<div class="tt-stat">Hotspots: ' + (commit.hotspotRisk * 100).toFixed(0) + '%</div>' +
          '<div class="tt-action">[Click for details]</div>';

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
      // Drill-Down Request
      // ======================================================================
      function requestCommitDrillDown(sha, repository) {
        vscode.postMessage({
          type: 'requestCommitDrillDown',
          sha: sha,
          repository: repository,
        });
      }

      // ======================================================================
      // Summary Stats
      // ======================================================================
      function renderSummaryStats(summary, commits) {
        var html = '';

        if (summary) {
          html += createStatCard(summary.commitCount.toString(), 'Commits');
          html += createStatCard((summary.riskDistribution.criticalCount || 0).toString(), 'Critical', 'critical');
          html += createStatCard((summary.riskDistribution.highCount || 0).toString(), 'High', 'high');
          html += createStatCard((summary.riskDistribution.mediumCount || 0).toString(), 'Medium', 'medium');
          html += createStatCard((summary.riskDistribution.lowCount || 0).toString(), 'Low', 'low');
        } else if (commits && commits.length > 0) {
          var counts = { critical: 0, high: 0, medium: 0, low: 0 };
          commits.forEach(function(c) {
            counts[c.riskCategory]++;
          });
          html += createStatCard(commits.length.toString(), 'Commits');
          html += createStatCard(counts.critical.toString(), 'Critical', 'critical');
          html += createStatCard(counts.high.toString(), 'High', 'high');
          html += createStatCard(counts.medium.toString(), 'Medium', 'medium');
          html += createStatCard(counts.low.toString(), 'Low', 'low');
        }

        summaryStats.innerHTML = html;
      }

      function createStatCard(value, label, category) {
        var categoryClass = category ? ' stat-' + category : '';
        return '<div class="stat-card' + categoryClass + '">' +
               '<div class="stat-value">' + escapeHtml(String(value)) + '</div>' +
               '<div class="stat-label">' + escapeHtml(label) + '</div></div>';
      }

      // ======================================================================
      // Legend
      // ======================================================================
      function renderLegend() {
        legendContainer.innerHTML = '';

        RISK_ZONES.forEach(function(zone) {
          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = zone.color;
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.textContent = zone.label + ' (' + zone.min + '-' + zone.max + ')';
          item.appendChild(label);

          legendContainer.appendChild(item);
        });
      }

      // ======================================================================
      // Utility Functions
      // ======================================================================
      function calculateAverageRisk(commits) {
        if (!commits || commits.length === 0) { return 0; }
        var sum = commits.reduce(function(acc, c) { return acc + c.totalRisk; }, 0);
        return (sum / commits.length) * 100;
      }

      function getRiskCategory(score) {
        if (score >= 75) { return 'critical'; }
        if (score >= 50) { return 'high'; }
        if (score >= 25) { return 'medium'; }
        return 'low';
      }

      function getRiskCategoryForValue(value) {
        // Value is 0-1 scale
        return getRiskCategory(value * 100);
      }

      function formatRiskLabel(category) {
        var labels = {
          critical: 'Critical Risk',
          high: 'High Risk',
          medium: 'Medium Risk',
          low: 'Low Risk',
        };
        return labels[category] || 'Risk Score';
      }

      function formatDate(dateString) {
        if (!dateString) { return ''; }
        var d = new Date(dateString);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      function getFilters() {
        var filters = {};
        if (repositoryFilter.value) { filters.repository = repositoryFilter.value; }
        if (branchFilter.value) { filters.branch = branchFilter.value; }
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
        riskBadge.style.display = 'none';
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
      // Data Request
      // ======================================================================
      function requestData() {
        showLoading();
        vscode.postMessage({
          type: 'requestRiskData',
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
          if (commitsData && commitsData.length > 0) {
            renderRiskiestCommits(commitsData);
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
