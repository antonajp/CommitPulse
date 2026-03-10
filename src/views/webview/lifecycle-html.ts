/**
 * HTML content generator for the Ticket Lifecycle Sankey dashboard webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - D3.js v7 loaded from local bundled resource
 * - D3-sankey layout for status flow visualization
 * - Interactive Sankey diagram with tooltips
 * - Node hover shows dwell time summary
 * - Link hover shows transition details
 * - Click link to drill down to ticket list
 * - Click ticket to open in Jira/Linear browser
 * - Rework toggle highlights backward transitions
 * - Date range and ticket type filters
 * - Summary panel with cycle time and bottlenecks
 * - ARIA accessibility and colorblind-accessible patterns
 * - All data values HTML-escaped before SVG/DOM insertion
 *
 * Ticket: IQS-906
 */

import type * as vscode from 'vscode';
import { generateCsvExportScript } from './webview-utils.js';

/**
 * Configuration for generating the ticket lifecycle HTML.
 */
export interface LifecycleHtmlConfig {
  /** CSP nonce for script/style authorization */
  readonly nonce: string;
  /** URI for the D3.js v7 library bundled in the extension */
  readonly d3Uri: vscode.Uri;
  /** URI for the lifecycle CSS stylesheet */
  readonly styleUri: vscode.Uri;
  /** The CSP source string for the webview */
  readonly cspSource: string;
  /**
   * Jira URL prefix for ticket link construction.
   * Falls back to server URL if empty. Ticket: IQS-926
   */
  readonly jiraUrlPrefix: string;
  /**
   * Linear URL prefix for ticket link construction.
   * Falls back to https://linear.app/{team}/ pattern if empty. Ticket: IQS-926
   */
  readonly linearUrlPrefix: string;
}

/**
 * Generate the full HTML document for the Ticket Lifecycle dashboard webview.
 *
 * @param config - HTML generation configuration with nonces and URIs
 * @returns Complete HTML string for the webview
 */
export function generateLifecycleHtml(config: LifecycleHtmlConfig): string {
  const { nonce, d3Uri, styleUri, cspSource, jiraUrlPrefix, linearUrlPrefix } = config;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Ticket Lifecycle</title>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <h1>Ticket Lifecycle</h1>
      <div class="controls">
        <div class="filter-group">
          <label for="startDate">Start Date</label>
          <input type="date" id="startDate" aria-label="Start date filter" tabindex="0">
        </div>
        <div class="filter-group">
          <label for="endDate">End Date</label>
          <input type="date" id="endDate" aria-label="End date filter" tabindex="0">
        </div>
        <div class="filter-group">
          <label for="ticketTypeFilter">Ticket Source</label>
          <select id="ticketTypeFilter" aria-label="Ticket type filter" tabindex="0">
            <option value="">All Sources</option>
            <option value="jira">Jira</option>
            <option value="linear">Linear</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="issueTypeFilter">Issue Type</label>
          <select id="issueTypeFilter" aria-label="Issue type filter" tabindex="0">
            <option value="">All Types</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="reworkToggle">Show Rework</label>
          <select id="reworkToggle" aria-label="Rework visibility toggle" tabindex="0">
            <option value="show">Show All</option>
            <option value="highlight">Highlight Rework</option>
            <option value="hide">Hide Rework</option>
          </select>
        </div>
        <button class="action-btn" id="applyFilterBtn" aria-label="Apply filters" tabindex="0">Apply</button>
        <button class="export-btn" id="exportCsvBtn" aria-label="Export chart data as CSV" tabindex="0">Export CSV</button>
      </div>
    </div>

    <div id="summaryStats" class="summary-stats" aria-live="polite"></div>

    <div id="loadingState" class="loading-overlay" role="status" aria-label="Loading chart data">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading ticket lifecycle data...</span>
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
          <p>This Sankey diagram visualizes how tickets flow through workflow statuses. Link width represents the number of tickets taking that path. Identify bottlenecks where tickets accumulate, and spot unexpected rework flows (tickets moving backward in the workflow).</p>
        </div>
      </details>
      <div id="legendContainer" class="chart-legend sankey-legend" role="img" aria-label="Status category legend"></div>
      <div class="chart-svg-container" role="img" aria-label="Sankey diagram showing ticket status flow">
        <svg id="chartSvg"></svg>
      </div>
      <div class="chart-instructions">
        <p>Hover over nodes to see dwell time. Hover over links to see transition details. Click a link to drill down to individual tickets. Click a ticket to open in browser.</p>
      </div>
    </div>

    <div class="chart-tooltip" id="tooltip" role="tooltip" aria-hidden="true"></div>

    <div id="drillDownPanel" class="drill-down-panel" style="display:none;">
      <div class="drill-down-header">
        <h2 id="drillDownTitle">Transition Details</h2>
        <button class="close-btn" id="closeDrillDown" aria-label="Close drill-down panel" tabindex="0">&times;</button>
      </div>
      <div id="drillDownContent" class="drill-down-content"></div>
    </div>

    <div id="bottlenecksContainer" class="bottlenecks-container" style="display:none;">
      <h2>Top Bottleneck Transitions</h2>
      <p class="bottleneck-description">Transitions with longest average dwell time</p>
      <table class="data-table" id="bottlenecksTable">
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Count</th>
            <th scope="col">Avg Dwell (hrs)</th>
            <th scope="col">Rework %</th>
          </tr>
        </thead>
        <tbody id="bottlenecksTableBody"></tbody>
      </table>
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
      // Configuration (IQS-926: URL prefixes for issue navigation)
      // ======================================================================
      var JIRA_URL_PREFIX = ${JSON.stringify(jiraUrlPrefix)};
      var LINEAR_URL_PREFIX = ${JSON.stringify(linearUrlPrefix)};

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
      var sankeyData = null;
      var matrixData = null;
      var reworkMode = 'show';

      // Status category colors (colorblind-accessible)
      var CATEGORY_COLORS = {
        backlog: '#6366f1',     // indigo-500
        in_progress: '#0ea5e9', // sky-500
        review: '#f59e0b',      // amber-500
        done: '#22c55e',        // green-500
        unknown: '#6b7280',     // gray-500
      };

      // Rework link color
      var REWORK_COLOR = '#ef4444'; // red-500

      // ======================================================================
      // DOM References
      // ======================================================================
      var exportCsvBtn = document.getElementById('exportCsvBtn');
      var applyFilterBtn = document.getElementById('applyFilterBtn');
      var startDateInput = document.getElementById('startDate');
      var endDateInput = document.getElementById('endDate');
      var ticketTypeFilter = document.getElementById('ticketTypeFilter');
      var issueTypeFilter = document.getElementById('issueTypeFilter');
      var reworkToggle = document.getElementById('reworkToggle');
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
      var bottlenecksContainer = document.getElementById('bottlenecksContainer');
      var tooltip = document.getElementById('tooltip');

      // Set default date range (last 90 days)
      var today = new Date();
      var ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
      endDateInput.value = today.toISOString().split('T')[0];
      startDateInput.value = ninetyDaysAgo.toISOString().split('T')[0];

      // ======================================================================
      // Event Handlers
      // ======================================================================
      exportCsvBtn.addEventListener('click', function() {
        if (!matrixData || matrixData.length === 0) { return; }
        var headers = ['From Status', 'To Status', 'From Category', 'To Category',
                       'Transition Count', 'Avg Dwell Hours', 'Median Dwell Hours',
                       'Rework Count', 'Unique Tickets'];
        var rows = matrixData.map(function(d) {
          return [d.fromStatus, d.toStatus, d.fromCategory, d.toCategory,
                  d.transitionCount, d.avgDwellHours || '', d.medianDwellHours || '',
                  d.reworkCount, d.uniqueTickets];
        });
        exportCsvFromData(headers, rows, 'ticket-lifecycle.csv');
      });

      applyFilterBtn.addEventListener('click', function() {
        requestData();
      });

      reworkToggle.addEventListener('change', function() {
        reworkMode = reworkToggle.value;
        if (sankeyData) {
          renderSankey(sankeyData);
        }
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
          case 'sankeyData':
            handleSankeyData(message);
            break;
          case 'matrixData':
            handleMatrixData(message);
            break;
          case 'filterOptions':
            handleFilterOptions(message);
            break;
          case 'transitionDrillDown':
            handleTransitionDrillDown(message);
            break;
          case 'statusDrillDown':
            handleStatusDrillDown(message);
            break;
          case 'lifecycleError':
            showError(escapeHtml(message.message));
            break;
          case 'lifecycleLoading':
            if (message.isLoading) { showLoading(); } else { hideLoading(); }
            break;
        }
      });

      function handleSankeyData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Ticket Lifecycle View Not Available',
            'The vw_ticket_transitions database view has not been created yet. Run the database migration (015) to enable this chart.'
          );
          return;
        }

        if (!message.hasData || !message.sankey || message.sankey.nodes.length === 0) {
          showEmpty(
            'No Ticket Lifecycle Data Available',
            'No status transitions found. Run the pipeline to analyze your tickets.'
          );
          return;
        }

        sankeyData = message.sankey;
        renderSankey(sankeyData);
        renderSummaryStats(sankeyData);
        renderLegend();
        chartArea.style.display = 'block';

        // Request matrix data for bottlenecks table
        vscode.postMessage({
          type: 'requestMatrixData',
          filters: getFilters(),
        });
      }

      function handleMatrixData(message) {
        if (!message.hasData || !message.matrix || message.matrix.length === 0) {
          bottlenecksContainer.style.display = 'none';
          return;
        }

        matrixData = message.matrix;
        renderBottlenecksTable(matrixData);
        bottlenecksContainer.style.display = 'block';
      }

      function handleFilterOptions(message) {
        // Populate issue type filter
        var currentIssueType = issueTypeFilter.value;
        while (issueTypeFilter.options.length > 1) {
          issueTypeFilter.remove(1);
        }
        (message.issueTypes || []).forEach(function(issueType) {
          var option = document.createElement('option');
          option.value = issueType;
          option.textContent = issueType;
          issueTypeFilter.appendChild(option);
        });
        if (currentIssueType && message.issueTypes.indexOf(currentIssueType) !== -1) {
          issueTypeFilter.value = currentIssueType;
        }
      }

      function handleTransitionDrillDown(message) {
        drillDownTitle.textContent = escapeHtml(message.fromStatus) + ' -> ' + escapeHtml(message.toStatus);

        var html = '';
        if (message.isRework) {
          html += '<div class="rework-indicator">This is a rework (backward) transition</div>';
        }

        html += '<p class="ticket-count">' + message.tickets.length + ' tickets followed this path</p>';

        if (message.tickets.length === 0) {
          html += '<p class="no-tickets">No individual ticket records available for this transition.</p>';
        } else {
          html += '<table class="drill-down-table"><thead><tr>';
          html += '<th>Ticket</th><th>Type</th><th>Assignee</th><th>Transition Time</th><th>Dwell (hrs)</th>';
          html += '</tr></thead><tbody>';

          message.tickets.forEach(function(ticket) {
            var ticketUrl = ticket.ticketType === 'linear'
              ? 'https://linear.app/issue/' + encodeURIComponent(ticket.ticketId)
              : '#'; // Jira URL would need the server URL from settings

            html += '<tr>';
            html += '<td><a href="' + ticketUrl + '" class="ticket-link" data-ticket="' +
                    escapeHtml(ticket.ticketId) + '" data-type="' + escapeHtml(ticket.ticketType) + '">' +
                    escapeHtml(ticket.ticketId) + '</a></td>';
            html += '<td>' + escapeHtml(ticket.issueType) + '</td>';
            html += '<td>' + escapeHtml(ticket.assignee || 'Unassigned') + '</td>';
            html += '<td>' + formatDate(ticket.transitionTime) + '</td>';
            html += '<td>' + (ticket.dwellHours !== null ? ticket.dwellHours.toFixed(1) : '-') + '</td>';
            html += '</tr>';
          });

          html += '</tbody></table>';
        }

        drillDownContent.innerHTML = html;

        // Add click handlers for ticket links
        var ticketLinks = drillDownContent.querySelectorAll('.ticket-link');
        ticketLinks.forEach(function(link) {
          link.addEventListener('click', function(e) {
            e.preventDefault();
            var ticketId = link.getAttribute('data-ticket');
            var ticketType = link.getAttribute('data-type');
            openTicketInBrowser(ticketId, ticketType);
          });
        });

        drillDownPanel.style.display = 'block';
      }

      function handleStatusDrillDown(message) {
        drillDownTitle.textContent = 'Status: ' + escapeHtml(message.status);

        var html = '<div class="status-summary">';
        html += '<div class="stat-mini"><span class="stat-value">' + message.ticketCount + '</span><span class="stat-label">Tickets</span></div>';
        html += '<div class="stat-mini"><span class="stat-value">' + message.avgDwellHours.toFixed(1) + '</span><span class="stat-label">Avg Hours</span></div>';
        html += '<div class="stat-mini"><span class="stat-value category-' + escapeHtml(message.category) + '">' + escapeHtml(message.category) + '</span><span class="stat-label">Category</span></div>';
        html += '</div>';

        if (message.incomingTransitions.length > 0) {
          html += '<h3>Incoming Transitions</h3>';
          html += '<ul class="transition-list">';
          message.incomingTransitions.forEach(function(t) {
            html += '<li>' + escapeHtml(t.fromStatus) + ' -> here (' + t.transitionCount + ' tickets)</li>';
          });
          html += '</ul>';
        }

        if (message.outgoingTransitions.length > 0) {
          html += '<h3>Outgoing Transitions</h3>';
          html += '<ul class="transition-list">';
          message.outgoingTransitions.forEach(function(t) {
            html += '<li>here -> ' + escapeHtml(t.toStatus) + ' (' + t.transitionCount + ' tickets)</li>';
          });
          html += '</ul>';
        }

        drillDownContent.innerHTML = html;
        drillDownPanel.style.display = 'block';
      }

      // ======================================================================
      // Sankey Diagram Rendering with D3.js
      // ======================================================================
      function renderSankey(data) {
        if (!data || data.nodes.length === 0) { return; }

        // Chart dimensions
        var containerWidth = Math.max(800, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var height = 500;
        var margin = { top: 20, right: 180, bottom: 20, left: 20 };

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Sankey diagram: nodes are statuses, link width shows ticket volume');

        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        var g = svg.append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // Prepare data for D3 sankey
        // Since d3-sankey isn't bundled, we'll create a simplified sankey-like layout manually
        var nodeMap = {};
        var nodeList = [];
        var links = [];

        // Group nodes by category and assign x positions
        var categoryOrder = ['backlog', 'in_progress', 'review', 'done', 'unknown'];
        var categoryPositions = {};
        categoryOrder.forEach(function(cat, i) {
          categoryPositions[cat] = (i / (categoryOrder.length - 1)) * innerWidth;
        });

        // Create nodes
        data.nodes.forEach(function(n, i) {
          var node = {
            id: n.status,
            status: n.status,
            category: n.category,
            ticketCount: n.ticketCount,
            avgDwellHours: n.avgDwellHours,
            x: categoryPositions[n.category] || 0,
            index: i,
          };
          nodeList.push(node);
          nodeMap[n.status] = node;
        });

        // Sort nodes within each category by ticket count
        var nodesByCategory = {};
        nodeList.forEach(function(n) {
          if (!nodesByCategory[n.category]) {
            nodesByCategory[n.category] = [];
          }
          nodesByCategory[n.category].push(n);
        });

        Object.keys(nodesByCategory).forEach(function(cat) {
          nodesByCategory[cat].sort(function(a, b) { return b.ticketCount - a.ticketCount; });
        });

        // Assign y positions within categories
        var nodeHeight = 30;
        var nodeSpacing = 10;

        Object.keys(nodesByCategory).forEach(function(cat) {
          var nodes = nodesByCategory[cat];
          var totalHeight = nodes.length * nodeHeight + (nodes.length - 1) * nodeSpacing;
          var startY = (innerHeight - totalHeight) / 2;

          nodes.forEach(function(n, i) {
            n.y = startY + i * (nodeHeight + nodeSpacing);
            n.height = nodeHeight;
          });
        });

        // Create links
        var maxLinkCount = Math.max.apply(null, data.links.map(function(l) { return l.count; })) || 1;

        data.links.forEach(function(l) {
          var sourceNode = nodeMap[l.source];
          var targetNode = nodeMap[l.target];
          if (!sourceNode || !targetNode) { return; }

          // Filter based on rework mode
          if (reworkMode === 'hide' && l.isRework) { return; }

          links.push({
            source: sourceNode,
            target: targetNode,
            count: l.count,
            avgDwellHours: l.avgDwellHours,
            isRework: l.isRework,
            width: Math.max(2, (l.count / maxLinkCount) * 20),
          });
        });

        // Draw links
        var linkGroup = g.append('g').attr('class', 'links');

        links.forEach(function(link) {
          var sourceX = link.source.x + 100; // node width
          var sourceY = link.source.y + link.source.height / 2;
          var targetX = link.target.x;
          var targetY = link.target.y + link.target.height / 2;

          // Bezier curve for smooth flow
          var midX = (sourceX + targetX) / 2;

          var pathData = 'M' + sourceX + ',' + sourceY +
                         ' C' + midX + ',' + sourceY +
                         ' ' + midX + ',' + targetY +
                         ' ' + targetX + ',' + targetY;

          var linkColor = link.isRework ? REWORK_COLOR : CATEGORY_COLORS[link.source.category] || '#888';
          var linkOpacity = (reworkMode === 'highlight' && link.isRework) ? 1 : 0.5;
          var dashStyle = link.isRework ? '5,3' : 'none';

          var path = linkGroup.append('path')
            .attr('d', pathData)
            .attr('fill', 'none')
            .attr('stroke', linkColor)
            .attr('stroke-width', link.width)
            .attr('stroke-opacity', linkOpacity)
            .attr('stroke-dasharray', dashStyle)
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', escapeHtml(link.source.status) + ' to ' + escapeHtml(link.target.status) + ': ' + link.count + ' tickets');

          path.on('mouseover', function(event) {
            showLinkTooltip(event, link);
            d3.select(this).attr('stroke-opacity', 1);
          })
          .on('mousemove', function(event) { moveTooltip(event); })
          .on('mouseout', function() {
            hideTooltip();
            d3.select(this).attr('stroke-opacity', linkOpacity);
          })
          .on('click', function() {
            requestTransitionDrillDown(link.source.status, link.target.status);
          })
          .on('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              requestTransitionDrillDown(link.source.status, link.target.status);
            }
          });
        });

        // Draw nodes
        var nodeGroup = g.append('g').attr('class', 'nodes');

        nodeList.forEach(function(node) {
          var nodeG = nodeGroup.append('g')
            .attr('transform', 'translate(' + node.x + ',' + node.y + ')');

          // Node rectangle
          nodeG.append('rect')
            .attr('width', 100)
            .attr('height', node.height)
            .attr('fill', CATEGORY_COLORS[node.category] || '#888')
            .attr('fill-opacity', 0.85)
            .attr('stroke', CATEGORY_COLORS[node.category] || '#888')
            .attr('stroke-width', 1)
            .attr('rx', 4)
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', escapeHtml(node.status) + ': ' + node.ticketCount + ' tickets, ' + node.avgDwellHours.toFixed(1) + ' hours avg dwell')
            .on('mouseover', function(event) {
              showNodeTooltip(event, node);
            })
            .on('mousemove', function(event) { moveTooltip(event); })
            .on('mouseout', hideTooltip)
            .on('click', function() {
              requestStatusDrillDown(node.status);
            })
            .on('keydown', function(event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                requestStatusDrillDown(node.status);
              }
            });

          // Node label
          nodeG.append('text')
            .attr('x', 50)
            .attr('y', node.height / 2)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('fill', '#fff')
            .attr('font-size', '11px')
            .attr('font-weight', '500')
            .attr('pointer-events', 'none')
            .text(truncateText(node.status, 14));

          // Ticket count label
          nodeG.append('text')
            .attr('x', 108)
            .attr('y', node.height / 2)
            .attr('dy', '0.35em')
            .attr('fill', 'var(--vscode-foreground, #ccc)')
            .attr('font-size', '10px')
            .attr('pointer-events', 'none')
            .text('(' + node.ticketCount + ')');
        });
      }

      // ======================================================================
      // Tooltip Functions
      // ======================================================================
      function showNodeTooltip(event, node) {
        var html =
          '<div class="tt-title"><strong>' + escapeHtml(node.status) + '</strong></div>' +
          '<div class="tt-category category-' + escapeHtml(node.category) + '">' + escapeHtml(node.category) + '</div>' +
          '<hr class="tt-divider">' +
          '<div class="tt-stat">Total Tickets: <strong>' + node.ticketCount + '</strong></div>' +
          '<div class="tt-stat">Avg Dwell Time: <strong>' + node.avgDwellHours.toFixed(1) + ' hours</strong></div>' +
          '<div class="tt-action">[Click for details]</div>';
        tooltip.innerHTML = html;
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        moveTooltip(event);
      }

      function showLinkTooltip(event, link) {
        var reworkTag = link.isRework
          ? '<div class="tt-rework">Rework Transition</div>'
          : '';
        var html =
          '<div class="tt-title"><strong>' + escapeHtml(link.source.status) + ' -> ' + escapeHtml(link.target.status) + '</strong></div>' +
          reworkTag +
          '<hr class="tt-divider">' +
          '<div class="tt-stat">Tickets: <strong>' + link.count + '</strong></div>' +
          '<div class="tt-stat">Avg Time in "' + escapeHtml(link.source.status) + '": <strong>' +
            (link.avgDwellHours !== null ? link.avgDwellHours.toFixed(1) + ' hours' : 'N/A') + '</strong></div>' +
          '<div class="tt-action">[Click to view tickets]</div>';
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
      function requestTransitionDrillDown(fromStatus, toStatus) {
        vscode.postMessage({
          type: 'requestDrillDown',
          drillDownType: 'transition',
          fromStatus: fromStatus,
          toStatus: toStatus,
          filters: getFilters(),
        });
      }

      function requestStatusDrillDown(status) {
        vscode.postMessage({
          type: 'requestDrillDown',
          drillDownType: 'status',
          status: status,
          filters: getFilters(),
        });
      }

      // ======================================================================
      // Open Ticket in Browser (IQS-926: use message protocol for secure URL building)
      // ======================================================================
      function openTicketInBrowser(ticketId, ticketType) {
        if (!ticketId) return;
        // Delegate URL construction to extension host for security validation
        // The extension uses the url-builder utility with proper validation
        vscode.postMessage({
          type: 'openTicket',
          ticketId: ticketId,
          ticketType: ticketType,
          jiraUrlPrefix: JIRA_URL_PREFIX,
          linearUrlPrefix: LINEAR_URL_PREFIX,
        });
      }

      // ======================================================================
      // Summary Stats
      // ======================================================================
      function renderSummaryStats(data) {
        var html = '';
        html += createStatCard(data.totalTickets.toLocaleString(), 'Total Tickets');
        html += createStatCard(data.totalRework.toLocaleString(), 'Rework Transitions', 'rework');
        html += createStatCard(data.reworkPct.toFixed(1) + '%', 'Rework Rate');
        html += createStatCard(data.nodes.length.toString(), 'Statuses');
        html += createStatCard(data.links.length.toString(), 'Transition Paths');
        summaryStats.innerHTML = html;
      }

      function createStatCard(value, label, highlight) {
        var highlightClass = highlight === 'rework' ? ' stat-rework' : '';
        return '<div class="stat-card' + highlightClass + '">' +
               '<div class="stat-value">' + escapeHtml(String(value)) + '</div>' +
               '<div class="stat-label">' + escapeHtml(label) + '</div></div>';
      }

      // ======================================================================
      // Legend
      // ======================================================================
      function renderLegend() {
        legendContainer.innerHTML = '';

        var categories = ['backlog', 'in_progress', 'review', 'done'];
        var categoryLabels = {
          backlog: 'Backlog',
          in_progress: 'In Progress',
          review: 'Review',
          done: 'Done',
        };

        categories.forEach(function(cat) {
          var item = document.createElement('div');
          item.className = 'legend-item';

          var swatch = document.createElement('span');
          swatch.className = 'legend-swatch';
          swatch.style.backgroundColor = CATEGORY_COLORS[cat];
          item.appendChild(swatch);

          var label = document.createElement('span');
          label.textContent = categoryLabels[cat];
          item.appendChild(label);

          legendContainer.appendChild(item);
        });

        // Add rework legend item
        var reworkItem = document.createElement('div');
        reworkItem.className = 'legend-item';

        var reworkSwatch = document.createElement('span');
        reworkSwatch.className = 'legend-swatch legend-rework';
        reworkSwatch.style.backgroundColor = REWORK_COLOR;
        reworkItem.appendChild(reworkSwatch);

        var reworkLabel = document.createElement('span');
        reworkLabel.textContent = 'Rework (dashed)';
        reworkItem.appendChild(reworkLabel);

        legendContainer.appendChild(reworkItem);

        var note = document.createElement('div');
        note.className = 'legend-note';
        note.textContent = 'Link width = Ticket volume';
        legendContainer.appendChild(note);
      }

      // ======================================================================
      // Bottlenecks Table
      // ======================================================================
      function renderBottlenecksTable(data) {
        // Sort by avg dwell hours descending
        var sorted = data.slice().sort(function(a, b) {
          return (b.avgDwellHours || 0) - (a.avgDwellHours || 0);
        }).slice(0, 5);

        var tbody = document.getElementById('bottlenecksTableBody');
        tbody.innerHTML = '';

        sorted.forEach(function(d) {
          var tr = document.createElement('tr');

          var tdFrom = document.createElement('td');
          tdFrom.textContent = d.fromStatus;
          tr.appendChild(tdFrom);

          var tdTo = document.createElement('td');
          tdTo.textContent = d.toStatus;
          tr.appendChild(tdTo);

          var tdCount = document.createElement('td');
          tdCount.textContent = String(d.transitionCount);
          tr.appendChild(tdCount);

          var tdDwell = document.createElement('td');
          tdDwell.textContent = d.avgDwellHours !== null ? d.avgDwellHours.toFixed(1) : '-';
          tr.appendChild(tdDwell);

          var tdRework = document.createElement('td');
          var reworkPct = d.transitionCount > 0 ? (d.reworkCount / d.transitionCount * 100) : 0;
          tdRework.textContent = reworkPct.toFixed(1) + '%';
          if (reworkPct > 0) {
            tdRework.className = 'rework-highlight';
          }
          tr.appendChild(tdRework);

          tbody.appendChild(tr);
        });
      }

      // ======================================================================
      // Utility Functions
      // ======================================================================
      function truncateText(text, maxLength) {
        if (!text) { return ''; }
        if (text.length <= maxLength) { return text; }
        return text.slice(0, maxLength - 2) + '..';
      }

      function formatDate(isoString) {
        if (!isoString) { return '-'; }
        var d = new Date(isoString);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      function getFilters() {
        var filters = {};
        if (startDateInput.value) { filters.startDate = startDateInput.value; }
        if (endDateInput.value) { filters.endDate = endDateInput.value; }
        if (ticketTypeFilter.value) { filters.ticketType = ticketTypeFilter.value; }
        if (issueTypeFilter.value) { filters.issueType = issueTypeFilter.value; }
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
        drillDownPanel.style.display = 'none';
        bottlenecksContainer.style.display = 'none';
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
          type: 'requestSankeyData',
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
