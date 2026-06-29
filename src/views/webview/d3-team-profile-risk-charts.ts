/**
 * D3.js chart renderers for Team Profile Dashboard - Risk charts.
 * GITX-188: Hot Spots bubble chart and Knowledge Concentration treemap.
 * GITX-193: Knowledge Concentration treemap color-coded by developer.
 *
 * Features:
 * - Hot Spots Bubble Chart: X=complexity, Y=churn, size=LOC, color=risk tier
 * - Knowledge Concentration Treemap: Size=commits, color=top contributor
 * - Developer color palette using Okabe-Ito colorblind-safe colors (12 distinct)
 * - Interactive legend: Click to toggle developer visibility (filter from chart)
 * - High contrast mode support with pattern fills
 * - Max 10 developers displayed, remaining grouped as "Other Developers"
 * - Click handlers to open files in VS Code editor
 *
 * Ticket: GITX-188, GITX-193
 */

import { OKABE_ITO_COLORS, UNKNOWN_DEVELOPER_COLOR } from './okabe-ito-palette.js';

/**
 * Extended Okabe-Ito colorblind-safe palette with 12 distinct colors.
 * Used for developer identification in Knowledge Concentration treemap.
 * GITX-193: 10 developers max displayed + 2 reserve colors.
 */
export const DEVELOPER_PALETTE: readonly string[] = [
  ...OKABE_ITO_COLORS.slice(0, 8),
  '#8B4513', // Saddle Brown
  '#6A5ACD', // Slate Blue
  '#FF6347', // Tomato
  '#20B2AA', // Light Sea Green
];

/**
 * Maximum number of developers to display individually.
 * GITX-193: Remaining developers grouped as "Other Developers".
 */
export const MAX_DEVELOPERS_DISPLAYED = 10;

/**
 * Color for grouped "Other Developers" category.
 */
export const OTHER_DEVELOPERS_COLOR = UNKNOWN_DEVELOPER_COLOR;

/**
 * Get color for a developer based on their index in the sorted developer list.
 * GITX-193: Colors assigned deterministically based on sorted developer names.
 *
 * @param developerIndex - Index in the sorted developer list (0-based)
 * @returns Hex color string
 */
export function getDeveloperColorByIndex(developerIndex: number): string {
  if (developerIndex < 0 || developerIndex >= MAX_DEVELOPERS_DISPLAYED) {
    return OTHER_DEVELOPERS_COLOR;
  }
  return DEVELOPER_PALETTE[developerIndex % DEVELOPER_PALETTE.length] ?? OTHER_DEVELOPERS_COLOR;
}

/**
 * Generate the JavaScript source for the Team Profile risk charts.
 * GITX-188: Hot Spots bubble chart and Knowledge Concentration treemap.
 * GITX-193: Developer color coding with interactive legend.
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateTeamProfileRiskChartsScript(): string {
  return `
      // ======================================================================
      // GITX-188: Hot Spots Bubble Chart for Team Profile
      // ======================================================================

      // Risk tier colors (colorblind-accessible palette)
      var HOT_SPOT_TIER_COLORS = {
        critical: '#e63946',  // red
        high: '#f67019',      // orange
        medium: '#f9c74f',    // yellow
        low: '#2a9d8f',       // teal
      };

      // Note: cachedHotSpotsData is declared in team-profile-html.ts main script block

      /**
       * Render the Hot Spots bubble chart.
       * GITX-188: X=complexity, Y=churn, size=LOC, color=risk tier.
       *
       * @param {Array} data - Array of TeamProfileHotSpot
       */
      function renderTeamHotSpotsChart(data) {
        hideSkeleton('hotSpotsSkeleton');
        cachedHotSpotsData = data;

        var container = document.getElementById('hotSpotsChart');
        var emptyMsg = document.getElementById('hotSpotsEmpty');

        if (!data || data.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        container.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        container.innerHTML = '';

        // Chart dimensions
        var margin = { top: 40, right: 120, bottom: 60, left: 80 };
        var width = Math.max(500, container.clientWidth) - margin.left - margin.right;
        var height = 350;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .attr('role', 'img')
          .attr('aria-label', 'Hot Spots bubble chart: X=complexity, Y=churn, size=LOC, color=risk tier');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // X Scale: Complexity (log scale for wide range)
        var xExtent = d3.extent(data, function(d) { return Math.max(1, d.complexity); });
        var x = d3.scaleLog()
          .domain([Math.max(1, xExtent[0] * 0.8), Math.max(10, xExtent[1] * 1.2)])
          .range([0, width])
          .nice();

        // Y Scale: Churn count (linear)
        var yMax = d3.max(data, function(d) { return d.churnCount; }) || 1;
        var y = d3.scaleLinear()
          .domain([0, yMax * 1.1])
          .nice()
          .range([height, 0]);

        // Bubble size scale: LOC
        var locExtent = d3.extent(data, function(d) { return Math.max(1, d.loc); });
        var rScale = d3.scaleSqrt()
          .domain([0, locExtent[1]])
          .range([6, 28]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
          .selectAll('line')
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // X Axis (Complexity - Log Scale)
        g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).ticks(5).tickFormat(function(d) { return d.toLocaleString(); }))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px');

        // X Axis Label
        g.append('text')
          .attr('x', width / 2)
          .attr('y', height + 45)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Complexity (log scale)');

        // Y Axis (Churn Count)
        g.append('g').attr('class', 'axis')
          .call(d3.axisLeft(y).ticks(6))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px');

        // Y Axis Label
        g.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -60)
          .attr('x', -height / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Churn (commits)');

        // Render bubbles
        data.forEach(function(d) {
          var cx = x(Math.max(1, d.complexity));
          var cy = y(d.churnCount);
          var r = rScale(Math.max(1, d.loc));
          var color = HOT_SPOT_TIER_COLORS[d.riskTier] || '#888';

          g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', r)
            .attr('fill', color)
            .attr('fill-opacity', 0.7)
            .attr('stroke', color)
            .attr('stroke-width', 1)
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', truncateTeamFilePath(d.filePath, 30) + ': ' + d.churnCount + ' commits, complexity ' + d.complexity)
            .on('mouseover', function(event) {
              showTeamFileTooltip(event,
                '<strong>' + escapeHtml(truncateTeamFilePath(d.filePath, 40)) + '</strong><br>' +
                'Repository: ' + escapeHtml(d.repository) + '<br>' +
                'Churn: ' + d.churnCount + ' commits<br>' +
                'Complexity: ' + d.complexity + '<br>' +
                'LOC: ' + formatTeamLocValue(d.loc) + '<br>' +
                '<span style="color:' + color + '">Risk: ' + d.riskTier.toUpperCase() + ' (' + (d.riskScore * 100).toFixed(0) + '%)</span><br>' +
                '<small style="opacity:0.7;">Click to open file</small>'
              );
            })
            .on('mousemove', moveTeamFileTooltip)
            .on('mouseout', hideTeamFileTooltip)
            .on('click', function() {
              vscode.postMessage({
                type: 'openFile',
                filePath: d.filePath,
                repository: d.repository
              });
            })
            .on('keydown', function(event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                vscode.postMessage({
                  type: 'openFile',
                  filePath: d.filePath,
                  repository: d.repository
                });
              }
            });

          // GITX-216: Add permanent file name label to bubble (no truncation)
          var path = d.filePath || '';
          var parts = path.split('/');
          var filename = parts[parts.length - 1] || path;

          g.append('text')
            .attr('class', 'bubble-label')
            .attr('x', cx)
            .attr('y', cy + 4)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('font-size', '9px')
            .attr('font-weight', 'bold')
            .attr('pointer-events', 'none')
            .text(filename);
        });

        // Legend (right side)
        var legendX = width + 10;
        var legendY = 0;
        var legendG = svg.append('g').attr('transform', 'translate(' + (margin.left + legendX) + ',' + (margin.top + legendY) + ')');

        var tiers = ['critical', 'high', 'medium', 'low'];
        var tierLabels = {
          critical: 'Critical',
          high: 'High',
          medium: 'Medium',
          low: 'Low'
        };

        tiers.forEach(function(tier, i) {
          var lg = legendG.append('g').attr('transform', 'translate(0,' + (i * 22) + ')');
          lg.append('circle')
            .attr('cx', 8)
            .attr('cy', 8)
            .attr('r', 8)
            .attr('fill', HOT_SPOT_TIER_COLORS[tier])
            .attr('fill-opacity', 0.7);
          lg.append('text')
            .attr('x', 22)
            .attr('y', 12)
            .attr('fill', 'var(--vscode-foreground, #ccc)')
            .attr('font-size', '10px')
            .text(tierLabels[tier]);
        });

        // Size legend
        legendG.append('text')
          .attr('x', 0)
          .attr('y', tiers.length * 22 + 15)
          .attr('fill', 'var(--vscode-descriptionForeground, #888)')
          .attr('font-size', '9px')
          .text('Size = LOC');
      }

      // ======================================================================
      // GITX-188/GITX-193: Knowledge Concentration Treemap for Team Profile
      // GITX-193: Color-coded by developer with interactive legend
      // ======================================================================

      // Extended Okabe-Ito colorblind-safe palette for developers (12 colors)
      // GITX-193: Max 10 developers displayed, remaining grouped as "Other Developers"
      var DEVELOPER_COLORS = [
        '#E69F00', // Orange
        '#56B4E9', // Sky Blue
        '#009E73', // Bluish Green
        '#D4C800', // Yellow (WCAG AA adjusted)
        '#0072B2', // Blue
        '#D55E00', // Vermilion
        '#CC79A7', // Reddish Purple
        '#999999', // Gray
        '#8B4513', // Saddle Brown
        '#6A5ACD', // Slate Blue
        '#FF6347', // Tomato
        '#20B2AA'  // Light Sea Green
      ];

      var OTHER_DEVELOPERS_COLOR = '#666666';
      var OTHER_DEVELOPERS_NAME = 'Other Developers';
      var MAX_DEVELOPERS = 10;

      // GITX-193: State for developer visibility filtering
      var knowledgeHiddenDevelopers = {};

      // Concentration risk colors (for tooltip only now)
      var CONCENTRATION_RISK_COLORS = {
        critical: '#dc2626',  // red-600
        high: '#ea580c',      // orange-600
        medium: '#ca8a04',    // yellow-600
        low: '#16a34a',       // green-600
      };

      // Note: cachedKnowledgeData is declared in team-profile-html.ts main script block

      /**
       * Get initials from a contributor name.
       */
      function getContributorInitials(name) {
        if (!name) { return '??'; }
        var parts = name.split(/[\\s._-]+/);
        if (parts.length === 1) {
          return name.slice(0, 2).toUpperCase();
        }
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }

      /**
       * Get developer color by sorted index.
       * GITX-193: Colors assigned deterministically based on sorted developer names.
       *
       * @param {number} index - Index in sorted developer list (0-based)
       * @returns {string} Hex color
       */
      function getKnowledgeDeveloperColor(index) {
        if (index < 0 || index >= MAX_DEVELOPERS) {
          return OTHER_DEVELOPERS_COLOR;
        }
        return DEVELOPER_COLORS[index % DEVELOPER_COLORS.length];
      }

      /**
       * Check if high contrast mode is active.
       * @returns {boolean}
       */
      function isHighContrastMode() {
        return window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches;
      }

      /**
       * Get SVG pattern ID for a developer index (high contrast mode).
       * GITX-193: Pattern fills as secondary differentiator for accessibility.
       *
       * @param {number} index - Developer index
       * @returns {string} Pattern ID
       */
      function getKnowledgePatternId(index) {
        var patterns = ['diagonal', 'dots', 'horizontal', 'vertical', 'cross', 'zigzag'];
        return 'knowledge-pattern-' + patterns[index % patterns.length];
      }

      /**
       * Create SVG pattern definitions for high contrast mode.
       * GITX-193: Pattern fills as secondary differentiator.
       *
       * @param {Object} svg - D3 SVG selection
       */
      function createKnowledgePatterns(svg) {
        var defs = svg.append('defs');

        // Diagonal stripes pattern
        var diagonal = defs.append('pattern')
          .attr('id', 'knowledge-pattern-diagonal')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 8)
          .attr('height', 8);
        diagonal.append('path')
          .attr('d', 'M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4')
          .attr('stroke', '#000')
          .attr('stroke-width', 1.5)
          .attr('stroke-opacity', 0.3);

        // Dots pattern
        var dots = defs.append('pattern')
          .attr('id', 'knowledge-pattern-dots')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 6)
          .attr('height', 6);
        dots.append('circle')
          .attr('cx', 3)
          .attr('cy', 3)
          .attr('r', 1.5)
          .attr('fill', '#000')
          .attr('fill-opacity', 0.3);

        // Horizontal lines pattern
        var horizontal = defs.append('pattern')
          .attr('id', 'knowledge-pattern-horizontal')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 8)
          .attr('height', 4);
        horizontal.append('line')
          .attr('x1', 0)
          .attr('y1', 2)
          .attr('x2', 8)
          .attr('y2', 2)
          .attr('stroke', '#000')
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.3);

        // Vertical lines pattern
        var vertical = defs.append('pattern')
          .attr('id', 'knowledge-pattern-vertical')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 4)
          .attr('height', 8);
        vertical.append('line')
          .attr('x1', 2)
          .attr('y1', 0)
          .attr('x2', 2)
          .attr('y2', 8)
          .attr('stroke', '#000')
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.3);

        // Cross pattern
        var cross = defs.append('pattern')
          .attr('id', 'knowledge-pattern-cross')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 8)
          .attr('height', 8);
        cross.append('line')
          .attr('x1', 0)
          .attr('y1', 4)
          .attr('x2', 8)
          .attr('y2', 4)
          .attr('stroke', '#000')
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.25);
        cross.append('line')
          .attr('x1', 4)
          .attr('y1', 0)
          .attr('x2', 4)
          .attr('y2', 8)
          .attr('stroke', '#000')
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.25);

        // Zigzag pattern
        var zigzag = defs.append('pattern')
          .attr('id', 'knowledge-pattern-zigzag')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 8)
          .attr('height', 8);
        zigzag.append('path')
          .attr('d', 'M0,4 L2,2 L4,4 L6,2 L8,4')
          .attr('fill', 'none')
          .attr('stroke', '#000')
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.3);
      }

      /**
       * Render the Knowledge Concentration treemap.
       * GITX-188: Tile size = commits.
       * GITX-193: Color = developer (Okabe-Ito palette), interactive legend.
       *
       * @param {Array} data - Array of TeamProfileKnowledgeConcentration
       */
      function renderTeamKnowledgeChart(data) {
        hideSkeleton('knowledgeSkeleton');
        cachedKnowledgeData = data;

        var container = document.getElementById('knowledgeChart');
        var legendContainer = document.getElementById('knowledgeLegend');
        var emptyMsg = document.getElementById('knowledgeEmpty');

        if (!data || data.length === 0) {
          container.classList.add('hidden');
          if (legendContainer) legendContainer.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        container.classList.remove('hidden');
        if (legendContainer) legendContainer.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        container.innerHTML = '';
        if (legendContainer) legendContainer.innerHTML = '';

        // GITX-193: Extract and sort unique top contributors deterministically
        var contributorCounts = {};
        data.forEach(function(d) {
          var name = d.topContributor || '(Unknown)';
          contributorCounts[name] = (contributorCounts[name] || 0) + d.totalCommits;
        });

        // Sort by total commits descending, then alphabetically for ties
        var sortedContributors = Object.keys(contributorCounts).sort(function(a, b) {
          var diff = contributorCounts[b] - contributorCounts[a];
          if (diff !== 0) return diff;
          return a.localeCompare(b);
        });

        // GITX-193: Limit to MAX_DEVELOPERS, group remaining as "Other"
        var displayedContributors = sortedContributors.slice(0, MAX_DEVELOPERS);
        var hasOtherDevelopers = sortedContributors.length > MAX_DEVELOPERS;
        var otherContributors = sortedContributors.slice(MAX_DEVELOPERS);

        // Build color map based on sorted order
        var colorMap = {};
        displayedContributors.forEach(function(name, i) {
          colorMap[name] = getKnowledgeDeveloperColor(i);
        });
        otherContributors.forEach(function(name) {
          colorMap[name] = OTHER_DEVELOPERS_COLOR;
        });

        // Chart dimensions
        var width = Math.max(500, container.clientWidth);
        var height = 350;

        var svg = d3.select(container).append('svg')
          .attr('width', width)
          .attr('height', height)
          .attr('role', 'img')
          .attr('aria-label', 'Knowledge Concentration treemap: tile size = commits, color = developer');

        // GITX-193: Create pattern definitions for high contrast mode
        if (isHighContrastMode()) {
          createKnowledgePatterns(svg);
        }

        // Build hierarchy (flat - just files)
        var hierarchyData = {
          name: 'root',
          children: data.map(function(d) {
            return {
              name: d.filePath.split('/').pop() || d.filePath,
              filePath: d.filePath,
              repository: d.repository,
              totalCommits: d.totalCommits,
              totalContributors: d.totalContributors,
              topContributor: d.topContributor,
              topContributorPct: d.topContributorPct,
              concentrationRisk: d.concentrationRisk,
              value: Math.max(1, d.totalCommits)
            };
          })
        };

        var root = d3.hierarchy(hierarchyData)
          .sum(function(d) { return d.value || 0; })
          .sort(function(a, b) { return b.value - a.value; });

        d3.treemap()
          .size([width, height])
          .paddingOuter(2)
          .paddingInner(1)
          .round(true)(root);

        // GITX-193: Filter function for hidden developers
        function isFileVisible(fileData) {
          var contributor = fileData.topContributor || '(Unknown)';
          // Check if this specific contributor is hidden
          if (knowledgeHiddenDevelopers[contributor]) {
            return false;
          }
          // Check if "Other Developers" is hidden and this is an "other" developer
          if (knowledgeHiddenDevelopers[OTHER_DEVELOPERS_NAME] &&
              otherContributors.indexOf(contributor) !== -1) {
            return false;
          }
          return true;
        }

        // Render file rectangles
        root.leaves().forEach(function(leaf) {
          var d = leaf.data;
          if (!d.filePath) { return; }

          var rx = leaf.x0;
          var ry = leaf.y0;
          var rw = leaf.x1 - leaf.x0;
          var rh = leaf.y1 - leaf.y0;

          if (rw < 4 || rh < 4) { return; } // Skip tiny rectangles

          // GITX-193: Get developer color instead of risk color
          var contributor = d.topContributor || '(Unknown)';
          var color = colorMap[contributor] || OTHER_DEVELOPERS_COLOR;
          var riskColor = CONCENTRATION_RISK_COLORS[d.concentrationRisk] || '#888';
          var developerIndex = displayedContributors.indexOf(contributor);

          // GITX-193: Check visibility based on legend filter
          var isVisible = isFileVisible(d);
          var fillOpacity = isVisible ? 0.75 : 0.15;
          var strokeOpacity = isVisible ? 1 : 0.3;

          // File rectangle
          var rect = svg.append('rect')
            .attr('class', 'knowledge-tile')
            .attr('data-contributor', contributor)
            .attr('x', rx)
            .attr('y', ry)
            .attr('width', rw)
            .attr('height', rh)
            .attr('fill', color)
            .attr('fill-opacity', fillOpacity)
            .attr('stroke', color)
            .attr('stroke-width', 0.5)
            .attr('stroke-opacity', strokeOpacity)
            .attr('cursor', isVisible ? 'pointer' : 'default')
            .attr('tabindex', isVisible ? '0' : '-1')
            .attr('role', 'button')
            .attr('aria-label', escapeHtml(d.filePath) + ': ' + d.topContributorPct + '% owned by ' + escapeHtml(contributor));

          // GITX-193: Add pattern overlay for high contrast mode
          if (isHighContrastMode() && developerIndex >= 0 && isVisible) {
            svg.append('rect')
              .attr('class', 'knowledge-tile-pattern')
              .attr('data-contributor', contributor)
              .attr('x', rx)
              .attr('y', ry)
              .attr('width', rw)
              .attr('height', rh)
              .attr('fill', 'url(#' + getKnowledgePatternId(developerIndex) + ')')
              .attr('pointer-events', 'none');
          }

          if (isVisible) {
            rect.on('mouseover', function(event) {
              d3.select(this).attr('stroke-width', 2);
              // GITX-193: Enhanced tooltip with developer color swatch
              showTeamFileTooltip(event,
                '<strong>' + escapeHtml(truncateTeamFilePath(d.filePath, 45)) + '</strong><br>' +
                'Repository: ' + escapeHtml(d.repository) + '<br>' +
                '<span style="display:inline-block;width:10px;height:10px;background:' + color + ';border-radius:2px;margin-right:4px;"></span>' +
                'Owner: ' + escapeHtml(contributor) + ' (' + d.topContributorPct + '%)<br>' +
                'Contributors: ' + d.totalContributors + '<br>' +
                'Commits: ' + d.totalCommits + '<br>' +
                '<span style="color:' + riskColor + '">Risk: ' + d.concentrationRisk.toUpperCase() + '</span><br>' +
                '<small style="opacity:0.7;">Click to open file</small>'
              );
            })
            .on('mousemove', moveTeamFileTooltip)
            .on('mouseout', function() {
              d3.select(this).attr('stroke-width', 0.5);
              hideTeamFileTooltip();
            })
            .on('click', function() {
              vscode.postMessage({
                type: 'openFile',
                filePath: d.filePath,
                repository: d.repository
              });
            })
            .on('keydown', function(event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                vscode.postMessage({
                  type: 'openFile',
                  filePath: d.filePath,
                  repository: d.repository
                });
              }
            });
          }

          // File label (if rectangle is big enough and visible)
          if (rw > 50 && rh > 22 && isVisible) {
            var fileName = d.name || d.filePath.split('/').pop();
            var initials = getContributorInitials(contributor);
            var labelMaxChars = Math.floor(rw / 7);
            var displayName = fileName.length > labelMaxChars ? fileName.slice(0, labelMaxChars - 3) + '...' : fileName;

            svg.append('text')
              .attr('class', 'knowledge-label')
              .attr('data-contributor', contributor)
              .attr('x', rx + 4)
              .attr('y', ry + 12)
              .attr('fill', '#fff')
              .attr('font-size', '9px')
              .attr('pointer-events', 'none')
              .text(displayName);

            if (rh > 34) {
              svg.append('text')
                .attr('class', 'knowledge-label')
                .attr('data-contributor', contributor)
                .attr('x', rx + 4)
                .attr('y', ry + 24)
                .attr('fill', '#fff')
                .attr('fill-opacity', 0.8)
                .attr('font-size', '8px')
                .attr('pointer-events', 'none')
                .text('[' + initials + '] ' + d.topContributorPct + '%');
            }
          }
        });

        // GITX-193: Render interactive legend
        if (legendContainer) {
          renderKnowledgeLegend(legendContainer, displayedContributors, colorMap, hasOtherDevelopers);
        }
      }

      /**
       * Render the interactive developer legend for Knowledge Concentration chart.
       * GITX-193: Click to toggle developer visibility (filter from chart).
       *
       * @param {HTMLElement} container - Legend container element
       * @param {Array} developers - Sorted list of displayed developer names
       * @param {Object} colorMap - Developer name to color mapping
       * @param {boolean} hasOtherDevelopers - Whether "Other Developers" category exists
       */
      function renderKnowledgeLegend(container, developers, colorMap, hasOtherDevelopers) {
        var legendHtml = '<span class="legend-title">Top Contributors:</span> ';

        // GITX-193: Create clickable legend items for each developer
        developers.forEach(function(name, i) {
          var color = colorMap[name];
          var isHidden = knowledgeHiddenDevelopers[name];
          var itemClass = 'legend-item' + (isHidden ? ' legend-item-hidden' : '');
          var truncatedName = name.length > 15 ? name.slice(0, 14) + '...' : name;

          legendHtml += '<span class="' + itemClass + '" ' +
            'data-developer="' + escapeHtml(name) + '" ' +
            'role="button" tabindex="0" ' +
            'aria-pressed="' + (!isHidden) + '" ' +
            'title="Click to ' + (isHidden ? 'show' : 'hide') + ' ' + escapeHtml(name) + '">' +
            '<span class="legend-swatch" style="background-color:' + color + ';' +
            (isHidden ? 'opacity:0.4;' : '') + '"></span>' +
            '<span class="legend-name">' + escapeHtml(truncatedName) + '</span>' +
            '</span>';
        });

        // GITX-193: Add "Other Developers" legend item if needed
        if (hasOtherDevelopers) {
          var isOtherHidden = knowledgeHiddenDevelopers[OTHER_DEVELOPERS_NAME];
          var otherClass = 'legend-item' + (isOtherHidden ? ' legend-item-hidden' : '');

          legendHtml += '<span class="' + otherClass + '" ' +
            'data-developer="' + OTHER_DEVELOPERS_NAME + '" ' +
            'role="button" tabindex="0" ' +
            'aria-pressed="' + (!isOtherHidden) + '" ' +
            'title="Click to ' + (isOtherHidden ? 'show' : 'hide') + ' other developers">' +
            '<span class="legend-swatch" style="background-color:' + OTHER_DEVELOPERS_COLOR + ';' +
            (isOtherHidden ? 'opacity:0.4;' : '') + '"></span>' +
            '<span class="legend-name">+Others</span>' +
            '</span>';
        }

        container.innerHTML = legendHtml;

        // GITX-193: Add click handlers for legend items
        container.querySelectorAll('.legend-item').forEach(function(item) {
          item.addEventListener('click', function() {
            var developer = item.getAttribute('data-developer');
            toggleKnowledgeDeveloperVisibility(developer);
          });

          item.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              var developer = item.getAttribute('data-developer');
              toggleKnowledgeDeveloperVisibility(developer);
            }
          });
        });
      }

      /**
       * Toggle visibility of a developer in the Knowledge Concentration chart.
       * GITX-193: Interactive legend filtering.
       *
       * @param {string} developer - Developer name to toggle
       */
      function toggleKnowledgeDeveloperVisibility(developer) {
        // Toggle hidden state
        knowledgeHiddenDevelopers[developer] = !knowledgeHiddenDevelopers[developer];

        // Re-render chart with updated visibility
        if (cachedKnowledgeData && cachedKnowledgeData.length > 0) {
          renderTeamKnowledgeChart(cachedKnowledgeData);
        }
      }
  `;
}
