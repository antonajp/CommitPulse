/**
 * HTML content generator for the Cross-Team Coupling dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - Chord diagram with team arcs and coupling chords
 * - Hover highlights connected chords
 * - Click chord opens shared files panel
 * - Team visibility toggles
 * - Coupling strength threshold slider
 * - Summary panel with coupling insights
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-910
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the coupling HTML.
 */
export interface CouplingHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the coupling CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
}

/**
 * Generate the full HTML document for the Cross-Team Coupling dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateCouplingHtml(config: CouplingHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Cross-Team Coupling</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Cross-Team Coupling</h1>
      <div class="controls">
        <div class="filter-group">
          <label for="teamFilter">Team</label>
          <select id="teamFilter" aria-label="Team filter" tabindex="0">
            <option value="">All Teams</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="minStrengthFilter">Min Strength</label>
          <input type="range" id="minStrengthFilter" min="0" max="100" value="0"
                 aria-label="Minimum coupling strength filter" tabindex="0">
          <span id="minStrengthValue" class="range-value">0%</span>
        </div>
        <button class="action-btn" id="applyFilterBtn" aria-label="Apply filters" tabindex="0">Apply</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading team coupling data...</span>
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
          <p>This chord diagram visualizes cross-team coupling based on shared file ownership. Thicker chords indicate stronger coupling between teams. High coupling may indicate shared responsibilities that could benefit from clearer ownership boundaries or better coordination practices.</p>
        </div>
      </details>
      <div id="legendContainer" class="chart-legend coupling-legend" role="img" aria-label="Coupling strength legend"></div>
      <div class="chart-svg-container" role="img" aria-label="Chord diagram showing team coupling relationships">
        <svg id="chartSvg"></svg>
      </div>
      <div class="chart-instructions">
        <p>Hover over arcs to see team details. Click on a chord to view shared files between teams.</p>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div id="drillDownPanel" class="drill-down-panel" style="display:none;">
      <div class="drill-down-header">
        <h2 id="drillDownTitle">Shared Files</h2>
        <button class="close-btn" id="closeDrillDown" aria-label="Close drill-down panel" tabindex="0">&times;</button>
      </div>
      <div id="drillDownContent" class="drill-down-content"></div>
    </div>

    <div id="teamVisibilityContainer" class="team-visibility-container" style="display:none;">
      <h3>Team Visibility</h3>
      <div id="teamToggles" class="team-toggles"></div>
    </div>

    <div id="couplingInsights" class="coupling-insights" style="display:none;">
      <h2>Coupling Insights</h2>
      <div class="insights-grid">
        <div class="insight-card" id="mostCoupledPair">
          <h3>Most Coupled Pair</h3>
          <div class="insight-value">-</div>
          <div class="insight-detail">-</div>
        </div>
        <div class="insight-card" id="islandTeams">
          <h3>Island Teams</h3>
          <p class="insight-description">Teams with no coupling</p>
          <ul class="insight-list"></ul>
        </div>
        <div class="insight-card" id="highestConnectors">
          <h3>Most Connected</h3>
          <p class="insight-description">Teams with most cross-dependencies</p>
          <ul class="insight-list"></ul>
        </div>
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
      var couplingData = null;
      var chordData = null;
      var summaryData = null;
      var hiddenTeams = new Set();
      var minStrengthThreshold = 0;

      // Team colors (distinct palette)
      var TEAM_COLORS = [
        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
        '#14b8a6', '#eab308', '#d946ef', '#0ea5e9', '#22d3ee',
      ];

      // Coupling strength colors
      var STRENGTH_COLORS = {
        high: '#ef4444',    // red - high coupling (>= 50%)
        medium: '#f59e0b',  // amber - medium coupling (>= 20%)
        low: '#22c55e',     // green - low coupling (< 20%)
      };

      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('applyFilterBtn');
      var teamFilter = document.getElementById('teamFilter');
      var minStrengthFilter = document.getElementById('minStrengthFilter');
      var minStrengthValue = document.getElementById('minStrengthValue');
      var loadingState = document.getElementById('loadingState');
      var errorState = document.getElementById('errorState');
      var emptyState = document.getElementById('emptyState');
      var chartArea = document.getElementById('chartArea');
      var summaryStats = document.getElementById('summaryStats');
      var legendContainer = document.getElementById('legendContainer');
      var drillDownPanel = document.getElementById('drillDownPanel');
      var drillDownTitle = document.getElementById('drillDownTitle');
      var drillDownContent = document.getElementById('drillDownContent');
      var closeDrillDown = document.getElementById('closeDrillDown');
      var teamVisibilityContainer = document.getElementById('teamVisibilityContainer');
      var teamToggles = document.getElementById('teamToggles');
      var couplingInsights = document.getElementById('couplingInsights');
      var tooltip = document.getElementById('tooltip');

      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', function() {
        if (!couplingData || couplingData.length === 0) { return; }
        var headers = ['Team A', 'Team B', 'Shared Files', 'Total Commits', 'Coupling Strength (%)'];
        var rows = couplingData.map(function(d) {
          return [d.teamA, d.teamB, d.sharedFileCount, d.totalSharedCommits, d.couplingStrength];
        });
        exportCsvFromData(headers, rows, 'team-coupling.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        minStrengthThreshold = parseInt(minStrengthFilter.value, 10) || 0;
        requestData();
      });

      minStrengthFilter.addEventListener('input', function() {
        minStrengthValue.textContent = minStrengthFilter.value + '%';
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
          case 'couplingData':
            handleCouplingData(message);
            break;
          case 'sharedFilesData':
            handleSharedFilesData(message);
            break;
          case 'teamDrillDown':
            handleTeamDrillDown(message);
            break;
          case 'teamPairDrillDown':
            handleTeamPairDrillDown(message);
            break;
          case 'couplingFilterOptions':
            handleFilterOptions(message);
            break;
          case 'couplingError':
            showError(escapeHtml(message.message));
            break;
          case 'couplingLoading':
            if (message.isLoading) { showLoading(); } else { hideLoading(); }
            break;
        }
      });

      function handleCouplingData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Team Coupling View Not Available',
            'The vw_team_coupling database view has not been created yet. Run the database migration (017) to enable this chart.'
          );
          return;
        }

        if (!message.hasData || !message.chordData || message.chordData.teams.length === 0) {
          showEmpty(
            'No Team Coupling Data Available',
            'No coupling data found. Run the pipeline to analyze team file ownership and coupling.'
          );
          return;
        }

        couplingData = message.couplingData;
        chordData = message.chordData;
        summaryData = message.summary;

        renderChordDiagram(chordData);
        renderSummaryStats(summaryData);
        renderLegend();
        renderTeamToggles(chordData.teams);
        renderCouplingInsights(couplingData, summaryData);

        chartArea.style.display = 'block';
        teamVisibilityContainer.style.display = 'block';
        couplingInsights.style.display = 'block';
      }

      function handleSharedFilesData(message) {
        drillDownTitle.textContent = 'Shared Files: ' + escapeHtml(message.teamA) + ' ↔ ' + escapeHtml(message.teamB);

        var html = '';
        if (!message.viewExists) {
          html = '<p class="error-text">Shared files view not available.</p>';
        } else if (!message.hasData || message.sharedFiles.length === 0) {
          html = '<p class="empty-text">No shared files found between these teams.</p>';
        } else {
          html += '<table class="shared-files-table"><thead><tr>';
          html += '<th>File</th><th>' + escapeHtml(message.teamA) + '</th><th>' + escapeHtml(message.teamB) + '</th><th>Total</th>';
          html += '</tr></thead><tbody>';

          message.sharedFiles.forEach(function(file) {
            html += '<tr class="file-row" data-path="' + escapeHtml(file.filePath) + '" data-repo="' + escapeHtml(file.repository) + '">';
            html += '<td class="file-path">' + escapeHtml(truncatePath(file.filePath)) + '</td>';
            html += '<td>' + file.teamACommits + '</td>';
            html += '<td>' + file.teamBCommits + '</td>';
            html += '<td>' + file.totalCommits + '</td>';
            html += '</tr>';
          });
          html += '</tbody></table>';
          html += '<p class="drill-down-hint">Click a file to open it in VS Code</p>';
        }

        drillDownContent.innerHTML = html;

        // Add click handlers for file rows
        var fileRows = drillDownContent.querySelectorAll('.file-row');
        fileRows.forEach(function(row) {
          row.addEventListener('click', function() {
            var filePath = row.getAttribute('data-path');
            var repository = row.getAttribute('data-repo');
            vscode.postMessage({
              type: 'requestOpenFile',
              filePath: filePath,
              repository: repository,
            });
          });
        });

        drillDownPanel.style.display = 'block';
      }

      function handleTeamDrillDown(message) {
        drillDownTitle.textContent = 'Team: ' + escapeHtml(message.team);

        var html = '';
        html += '<div class="team-summary">';
        html += '<div class="stat-mini"><span class="stat-value">' + message.totalSharedFiles + '</span><span class="stat-label">Shared Files</span></div>';
        html += '<div class="stat-mini"><span class="stat-value">' + message.coupledTeams.length + '</span><span class="stat-label">Coupled Teams</span></div>';
        html += '<div class="stat-mini"><span class="stat-value">' + message.avgCouplingStrength.toFixed(1) + '%</span><span class="stat-label">Avg Strength</span></div>';
        html += '</div>';

        if (message.couplingRows.length > 0) {
          html += '<h3>Coupling Details</h3>';
          html += '<table class="coupling-table"><thead><tr>';
          html += '<th>Partner Team</th><th>Shared Files</th><th>Strength</th>';
          html += '</tr></thead><tbody>';

          message.couplingRows.forEach(function(row) {
            var partnerTeam = row.teamA === message.team ? row.teamB : row.teamA;
            var strengthClass = getStrengthClass(row.couplingStrength);
            html += '<tr>';
            html += '<td>' + escapeHtml(partnerTeam) + '</td>';
            html += '<td>' + row.sharedFileCount + '</td>';
            html += '<td class="strength-' + strengthClass + '">' + row.couplingStrength.toFixed(1) + '%</td>';
            html += '</tr>';
          });
          html += '</tbody></table>';
        }

        drillDownContent.innerHTML = html;
        drillDownPanel.style.display = 'block';
      }

      function handleTeamPairDrillDown(message) {
        // This uses shared files data display
        handleSharedFilesData({
          type: 'sharedFilesData',
          teamA: message.teamA,
          teamB: message.teamB,
          sharedFiles: message.sharedFiles,
          hasData: message.sharedFiles.length > 0,
          viewExists: true,
        });
      }

      function handleFilterOptions(message) {
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

      // ======================================================================
      // Chord Diagram Rendering with D3.js
      // ======================================================================
      function renderChordDiagram(data) {
        if (!data || data.teams.length === 0) { return; }

        // Filter by hidden teams and min strength
        var visibleTeamIndices = [];
        var teamIndexMap = new Map();
        data.teams.forEach(function(team, idx) {
          if (!hiddenTeams.has(team)) {
            teamIndexMap.set(team, visibleTeamIndices.length);
            visibleTeamIndices.push(idx);
          }
        });

        if (visibleTeamIndices.length === 0) {
          showEmpty('All Teams Hidden', 'Enable at least one team in the visibility toggles to see the chart.');
          return;
        }

        // Build filtered matrix
        var filteredMatrix = [];
        visibleTeamIndices.forEach(function(i) {
          var row = [];
          visibleTeamIndices.forEach(function(j) {
            var value = data.matrix[i][j] || 0;
            // Apply min strength filter
            if (couplingData) {
              var teamA = data.teams[i];
              var teamB = data.teams[j];
              var coupling = couplingData.find(function(c) {
                return (c.teamA === teamA && c.teamB === teamB) || (c.teamA === teamB && c.teamB === teamA);
              });
              if (coupling && coupling.couplingStrength < minStrengthThreshold) {
                value = 0;
              }
            }
            row.push(value);
          });
          filteredMatrix.push(row);
        });

        var visibleTeams = visibleTeamIndices.map(function(idx) { return data.teams[idx]; });

        // Chart dimensions
        var containerWidth = Math.max(600, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = Math.min(containerWidth, 800);
        var height = width;
        var outerRadius = Math.min(width, height) * 0.5 - 60;
        var innerRadius = outerRadius - 30;

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Chord diagram showing coupling between ' + visibleTeams.length + ' teams');

        var g = svg.append('g')
          .attr('transform', 'translate(' + (width / 2) + ',' + (height / 2) + ')');

        // Create chord layout
        var chord = d3.chord()
          .padAngle(0.05)
          .sortSubgroups(d3.descending)
          .sortChords(d3.descending);

        var chords = chord(filteredMatrix);

        // Create arc generator for team arcs
        var arc = d3.arc()
          .innerRadius(innerRadius)
          .outerRadius(outerRadius);

        // Create ribbon generator for chords
        var ribbon = d3.ribbon()
          .radius(innerRadius);

        // Create color scale
        var color = d3.scaleOrdinal()
          .domain(d3.range(visibleTeams.length))
          .range(TEAM_COLORS.slice(0, visibleTeams.length));

        // Draw team arcs
        var group = g.append('g')
          .attr('class', 'groups')
          .selectAll('g')
          .data(chords.groups)
          .enter().append('g')
          .attr('class', 'group');

        group.append('path')
          .attr('class', 'arc')
          .attr('d', arc)
          .attr('fill', function(d) { return color(d.index); })
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-width', 1)
          .attr('tabindex', '0')
          .attr('role', 'button')
          .attr('aria-label', function(d) {
            return escapeHtml(visibleTeams[d.index]) + ' - click for details';
          })
          .on('mouseover', function(event, d) {
            showArcTooltip(event, d, visibleTeams, chords);
            fadeOtherArcs(d.index, 0.1);
          })
          .on('mouseout', function() {
            hideTooltip();
            resetArcOpacity();
          })
          .on('click', function(event, d) {
            requestTeamDrillDown(visibleTeams[d.index]);
          })
          .on('keydown', function(event, d) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              requestTeamDrillDown(visibleTeams[d.index]);
            }
          });

        // Add team labels
        group.append('text')
          .each(function(d) { d.angle = (d.startAngle + d.endAngle) / 2; })
          .attr('dy', '0.35em')
          .attr('transform', function(d) {
            return 'rotate(' + (d.angle * 180 / Math.PI - 90) + ')' +
                   'translate(' + (outerRadius + 10) + ')' +
                   (d.angle > Math.PI ? 'rotate(180)' : '');
          })
          .attr('text-anchor', function(d) { return d.angle > Math.PI ? 'end' : null; })
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text(function(d) { return truncateText(visibleTeams[d.index], 15); });

        // Draw chords
        g.append('g')
          .attr('class', 'ribbons')
          .selectAll('path')
          .data(chords)
          .enter().append('path')
          .attr('class', 'chord')
          .attr('d', ribbon)
          .attr('fill', function(d) {
            // Blend colors of source and target
            var c1 = d3.color(color(d.source.index));
            var c2 = d3.color(color(d.target.index));
            return d3.interpolateRgb(c1, c2)(0.5);
          })
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-width', 0.5)
          .attr('opacity', 0.7)
          .attr('tabindex', '0')
          .attr('role', 'button')
          .attr('aria-label', function(d) {
            return escapeHtml(visibleTeams[d.source.index]) + ' to ' + escapeHtml(visibleTeams[d.target.index]) + ' - click for shared files';
          })
          .on('mouseover', function(event, d) {
            showChordTooltip(event, d, visibleTeams);
            d3.select(this).attr('opacity', 1);
          })
          .on('mouseout', function() {
            hideTooltip();
            d3.select(this).attr('opacity', 0.7);
          })
          .on('click', function(event, d) {
            requestTeamPairDrillDown(visibleTeams[d.source.index], visibleTeams[d.target.index]);
          })
          .on('keydown', function(event, d) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              requestTeamPairDrillDown(visibleTeams[d.source.index], visibleTeams[d.target.index]);
            }
          });

        // Helper functions for interactivity
        function fadeOtherArcs(index, opacity) {
          g.selectAll('.chord')
            .filter(function(d) {
              return d.source.index !== index && d.target.index !== index;
            })
            .transition()
            .duration(200)
            .attr('opacity', opacity);
        }

        function resetArcOpacity() {
          g.selectAll('.chord')
            .transition()
            .duration(200)
            .attr('opacity', 0.7);
        }
      }

      // ======================================================================
      // Tooltip Functions
      // ======================================================================
      function showArcTooltip(event, d, teams, chords) {
        var team = teams[d.index];

        // Find all coupled teams
        var coupledWith = [];
        chords.forEach(function(chord) {
          if (chord.source.index === d.index && chord.target.index !== d.index) {
            coupledWith.push({ team: teams[chord.target.index], value: chord.source.value });
          } else if (chord.target.index === d.index && chord.source.index !== d.index) {
            coupledWith.push({ team: teams[chord.source.index], value: chord.target.value });
          }
        });

        // Sort by value descending
        coupledWith.sort(function(a, b) { return b.value - a.value; });

        var html =
          '<div class="tt-title"><strong>' + escapeHtml(team) + '</strong></div>' +
          '<hr class="tt-divider">';

        if (coupledWith.length > 0) {
          html += '<div class="tt-stat">Coupled with ' + coupledWith.length + ' team(s)</div>';
          html += '<div class="tt-subtitle">Top Coupling:</div>';
          coupledWith.slice(0, 3).forEach(function(c) {
            html += '<div class="tt-item">' + escapeHtml(c.team) + ': ' + c.value + ' files</div>';
          });
        } else {
          html += '<div class="tt-stat">No coupling detected</div>';
        }

        html += '<div class="tt-action">[Click for details]</div>';

        tooltip.innerHTML = html;
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        moveTooltip(event);
      }

      function showChordTooltip(event, d, teams) {
        var teamA = teams[d.source.index];
        var teamB = teams[d.target.index];
        var sharedFiles = d.source.value;

        // Find coupling data for this pair
        var coupling = couplingData ? couplingData.find(function(c) {
          return (c.teamA === teamA && c.teamB === teamB) || (c.teamA === teamB && c.teamB === teamA);
        }) : null;

        var strength = coupling ? coupling.couplingStrength : 0;
        var totalCommits = coupling ? coupling.totalSharedCommits : 0;

        var html =
          '<div class="tt-title"><strong>' + escapeHtml(teamA) + '</strong> ↔ <strong>' + escapeHtml(teamB) + '</strong></div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-stat">Shared Files: <strong>' + sharedFiles + '</strong></div>' +
          '<div class="tt-stat">Coupling Strength: <strong class="strength-' + getStrengthClass(strength) + '">' + strength.toFixed(1) + '%</strong></div>' +
          '<div class="tt-stat">Total Shared Commits: <strong>' + totalCommits + '</strong></div>';

        if (coupling && coupling.hotspotFiles && coupling.hotspotFiles.length > 0) {
          html += '<div class="tt-subtitle">Top Shared Files:</div>';
          coupling.hotspotFiles.slice(0, 3).forEach(function(file) {
            html += '<div class="tt-item">' + escapeHtml(truncatePath(file)) + '</div>';
          });
        }

        html += '<div class="tt-action">[Click to view all shared files]</div>';

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
      function requestTeamDrillDown(team) {
        vscode.postMessage({
          type: 'requestTeamDrillDown',
          team: team,
          filters: getFilters(),
        });
      }

      function requestTeamPairDrillDown(teamA, teamB) {
        vscode.postMessage({
          type: 'requestTeamPairDrillDown',
          teamA: teamA,
          teamB: teamB,
          filters: getFilters(),
        });
      }

      // ======================================================================
      // Summary Stats
      // ======================================================================
      function renderSummaryStats(summary) {
        if (!summary) { return; }

        var html = '';
        html += createStatCard(summary.uniqueTeams.toString(), 'Teams');
        html += createStatCard(summary.totalTeamPairs.toString(), 'Team Pairs');
        html += createStatCard(summary.totalSharedFiles.toString(), 'Shared Files');
        html += createStatCard(summary.avgCouplingStrength.toFixed(1) + '%', 'Avg Strength');
        html += createStatCard(summary.maxCouplingStrength.toFixed(1) + '%', 'Max Strength', getStrengthClass(summary.maxCouplingStrength));
        summaryStats.innerHTML = html;
      }

      function createStatCard(value, label, strengthClass) {
        var cardClass = strengthClass ? ' stat-' + strengthClass : '';
        return '<div class="stat-card' + cardClass + '">' +
               '<div class="stat-value">' + escapeHtml(String(value)) + '</div>' +
               '<div class="stat-label">' + escapeHtml(label) + '</div></div>';
      }

      // ======================================================================
      // Legend
      // ======================================================================
      function renderLegend() {
        legendContainer.innerHTML = '';

        var strengthLevels = [
          { class: 'high', label: 'High (>=50%)', color: STRENGTH_COLORS.high },
          { class: 'medium', label: 'Medium (20-49%)', color: STRENGTH_COLORS.medium },
          { class: 'low', label: 'Low (<20%)', color: STRENGTH_COLORS.low },
        ];

        strengthLevels.forEach(function(level) {
          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = level.color;
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.textContent = level.label;
          item.appendChild(label);

          legendContainer.appendChild(item);
        });

        var note = document.createElement('div');
        note.className = 'legend-note';
        note.textContent = 'Chord thickness = number of shared files';
        legendContainer.appendChild(note);
      }

      // ======================================================================
      // Team Visibility Toggles
      // ======================================================================
      function renderTeamToggles(teams) {
        teamToggles.innerHTML = '';

        teams.forEach(function(team, idx) {
          var toggle = document.createElement('label');
          toggle.className = 'team-toggle';

          var checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = !hiddenTeams.has(team);
          checkbox.addEventListener('change', function() {
            if (this.checked) {
              hiddenTeams.delete(team);
            } else {
              hiddenTeams.add(team);
            }
            renderChordDiagram(chordData);
          });
          toggle.appendChild(checkbox);

          var swatch = document.createElement('span');
          swatch.className = 'toggle-swatch';
          swatch.style.backgroundColor = TEAM_COLORS[idx % TEAM_COLORS.length];
          toggle.appendChild(swatch);

          var name = document.createElement('span');
          name.className = 'toggle-name';
          name.textContent = team;
          toggle.appendChild(name);

          teamToggles.appendChild(toggle);
        });
      }

      // ======================================================================
      // Coupling Insights
      // ======================================================================
      function renderCouplingInsights(data, summary) {
        // Most coupled pair
        var mostCoupledPairCard = document.querySelector('#mostCoupledPair');
        if (summary.highestCouplingPair) {
          var pair = summary.highestCouplingPair;
          mostCoupledPairCard.querySelector('.insight-value').textContent =
            escapeHtml(pair.teamA) + ' ↔ ' + escapeHtml(pair.teamB);
          mostCoupledPairCard.querySelector('.insight-detail').textContent =
            pair.strength.toFixed(1) + '% coupling strength';
        } else {
          mostCoupledPairCard.querySelector('.insight-value').textContent = 'None';
          mostCoupledPairCard.querySelector('.insight-detail').textContent = '-';
        }

        // Island teams (teams with no coupling)
        var allTeams = new Set(chordData.teams);
        var coupledTeams = new Set();
        data.forEach(function(d) {
          coupledTeams.add(d.teamA);
          coupledTeams.add(d.teamB);
        });
        var islandTeamsList = [];
        allTeams.forEach(function(team) {
          if (!coupledTeams.has(team)) {
            islandTeamsList.push(team);
          }
        });

        var islandTeamsCard = document.querySelector('#islandTeams .insight-list');
        if (islandTeamsList.length > 0) {
          islandTeamsCard.innerHTML = islandTeamsList.map(function(t) {
            return '<li>' + escapeHtml(t) + '</li>';
          }).join('');
        } else {
          islandTeamsCard.innerHTML = '<li class="no-items">None - all teams have coupling</li>';
        }

        // Most connected teams
        var teamConnections = new Map();
        data.forEach(function(d) {
          teamConnections.set(d.teamA, (teamConnections.get(d.teamA) || 0) + 1);
          teamConnections.set(d.teamB, (teamConnections.get(d.teamB) || 0) + 1);
        });

        var sortedConnections = Array.from(teamConnections.entries())
          .sort(function(a, b) { return b[1] - a[1]; })
          .slice(0, 5);

        var highestConnectorsCard = document.querySelector('#highestConnectors .insight-list');
        if (sortedConnections.length > 0) {
          highestConnectorsCard.innerHTML = sortedConnections.map(function(entry) {
            return '<li>' + escapeHtml(entry[0]) + ': ' + entry[1] + ' team(s)</li>';
          }).join('');
        } else {
          highestConnectorsCard.innerHTML = '<li class="no-items">No data</li>';
        }
      }

      // ======================================================================
      // Utility Functions
      // ======================================================================
      function truncateText(text, maxLength) {
        if (!text) { return ''; }
        if (text.length <= maxLength) { return text; }
        return text.slice(0, maxLength - 2) + '..';
      }

      function truncatePath(path) {
        if (!path) { return ''; }
        var parts = path.split('/');
        if (parts.length <= 3) { return path; }
        return '.../' + parts.slice(-2).join('/');
      }

      function getStrengthClass(strength) {
        if (strength >= 50) { return 'high'; }
        if (strength >= 20) { return 'medium'; }
        return 'low';
      }

      function getFilters() {
        var filters = {};
        if (teamFilter.value) { filters.teamA = teamFilter.value; }
        if (minStrengthThreshold > 0) { filters.minCouplingStrength = minStrengthThreshold; }
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
        teamVisibilityContainer.style.display = 'none';
        couplingInsights.style.display = 'none';
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
          type: 'requestCouplingData',
          filters: getFilters(),
        });
      }

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
