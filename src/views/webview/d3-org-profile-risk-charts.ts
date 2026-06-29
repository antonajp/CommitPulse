/**
 * D3.js chart renderers for Organization Profile risk visualizations.
 * Hot Spots bubble chart and Knowledge Concentration treemap.
 *
 * Ticket: GITX-209
 *
 * Features:
 * - Hot Spots Bubble Chart: X=complexity, Y=churn, size=LOC, color=risk tier
 * - Knowledge Concentration Treemap: Size=commits, color=top contributor
 * - Team-based color palette using extended Okabe-Ito colorblind-safe colors
 * - Click handlers to open files in VS Code editor
 * - Tooltip with file details
 * - High contrast mode support
 * - WCAG 2.1 AA accessibility compliance
 */

/**
 * Risk tier color mapping for hot spots.
 * Returns JavaScript source for embedding in webview.
 */
export function getRiskTierColors(): Record<string, string> {
  return {
    critical: '#FF4444', // Bright red
    high: '#FF8800', // Orange
    medium: '#FFCC00', // Yellow
    low: '#88BB00', // Yellow-green
  };
}

/**
 * Generate the JavaScript source for the Organization Profile risk charts.
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateOrgProfileRiskChartsScript(): string {
  return `
      // ======================================================================
      // GITX-209: Organization Profile Risk Charts - Hot Spots & Knowledge
      // ======================================================================

      // Risk tier color mapping
      var RISK_TIER_COLORS = {
        critical: '#FF4444',
        high: '#FF8800',
        medium: '#FFCC00',
        low: '#88BB00'
      };

      // Extended Okabe-Ito colorblind-safe palette for team members (12 colors)
      var MEMBER_COLORS = [
        '#E69F00', // Orange
        '#56B4E9', // Sky Blue
        '#009E73', // Bluish Green
        '#F0E442', // Yellow
        '#0072B2', // Blue
        '#D55E00', // Vermilion
        '#CC79A7', // Reddish Purple
        '#999999', // Gray
        '#8B4513', // Saddle Brown
        '#6A5ACD', // Slate Blue
        '#FF6347', // Tomato
        '#20B2AA'  // Light Sea Green
      ];

      // ======================================================================
      // GITX-209: Tooltip Functions for Risk Charts
      // ======================================================================

      var orgRiskTooltip = null;

      /**
       * Show tooltip for org risk charts.
       * GITX-209: Security - HTML content is already escaped by callers.
       */
      function showOrgRiskTooltip(event, html) {
        if (!orgRiskTooltip) {
          orgRiskTooltip = document.getElementById('orgFileTooltip');
        }
        if (!orgRiskTooltip) { return; }

        orgRiskTooltip.innerHTML = html;
        orgRiskTooltip.classList.add('visible');
        orgRiskTooltip.setAttribute('aria-hidden', 'false');
        moveOrgRiskTooltip(event);
      }

      /**
       * Move tooltip to follow cursor with boundary detection.
       */
      function moveOrgRiskTooltip(event) {
        if (!orgRiskTooltip) { return; }

        var x = event.pageX + 12;
        var y = event.pageY - 28;

        // Viewport boundary detection
        var ttRect = orgRiskTooltip.getBoundingClientRect();
        var viewportWidth = window.innerWidth;
        var viewportHeight = window.innerHeight;

        if (x + ttRect.width > viewportWidth - 20) {
          x = event.pageX - ttRect.width - 12;
        }
        if (x < 10) { x = 10; }
        if (y + ttRect.height > viewportHeight - 20) {
          y = event.pageY - ttRect.height - 12;
        }
        if (y < 10) { y = event.pageY + 20; }

        orgRiskTooltip.style.left = x + 'px';
        orgRiskTooltip.style.top = y + 'px';
      }

      /**
       * Hide the org risk chart tooltip.
       */
      function hideOrgRiskTooltip() {
        if (!orgRiskTooltip) {
          orgRiskTooltip = document.getElementById('orgFileTooltip');
        }
        if (orgRiskTooltip) {
          orgRiskTooltip.classList.remove('visible');
          orgRiskTooltip.setAttribute('aria-hidden', 'true');
        }
      }

      /**
       * Truncate file path for display.
       * Shows the last N characters with ellipsis prefix.
       *
       * @param {string} path - Full file path
       * @param {number} maxLen - Maximum display length
       * @returns {string} Truncated path
       */
      function truncateRiskFilePath(path, maxLen) {
        if (!path || path.length <= maxLen) { return path || ''; }
        return '...' + path.slice(-(maxLen - 3));
      }

      /**
       * Get color for a risk tier.
       *
       * @param {string} tier - Risk tier (critical, high, medium, low)
       * @returns {string} Hex color string
       */
      function getRiskTierColor(tier) {
        var t = (tier || '').toLowerCase();
        return RISK_TIER_COLORS[t] || RISK_TIER_COLORS.low;
      }

      /**
       * Get color for a team member index.
       *
       * @param {number} index - Member index (0-based)
       * @returns {string} Hex color string
       */
      function getMemberColor(index) {
        return MEMBER_COLORS[index % MEMBER_COLORS.length];
      }

      // ======================================================================
      // GITX-209: Hot Spots Bubble Chart
      // X = Complexity, Y = Churn Count, Size = LOC, Color = Risk Tier
      // ======================================================================

      /**
       * Render the Hot Spots bubble chart.
       *
       * @param {Array} data - Array of OrgProfileHotSpot objects
       */
      function renderOrgHotSpotsChart(data) {
        hideSkeleton('orgHotSpotsSkeleton');
        cachedOrgHotSpots = data;

        var container = document.getElementById('orgHotSpotsChart');
        var emptyMsg = document.getElementById('orgHotSpotsEmpty');

        if (!data || data.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        container.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        container.innerHTML = '';

        // Chart dimensions
        var margin = { top: 40, right: 120, bottom: 60, left: 60 };
        var width = Math.max(500, container.clientWidth) - margin.left - margin.right;
        var height = 350 - margin.top - margin.bottom;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .attr('role', 'img')
          .attr('aria-label', 'Hot spots bubble chart: X=complexity, Y=churn, size=LOC, color=risk tier');

        var g = svg.append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // Scales
        var maxComplexity = d3.max(data, function(d) { return d.complexity || 1; }) || 1;
        var maxChurn = d3.max(data, function(d) { return d.churnCount || 1; }) || 1;
        var maxLoc = d3.max(data, function(d) { return d.loc || 100; }) || 100;

        var x = d3.scaleLinear()
          .domain([0, maxComplexity * 1.1])
          .nice()
          .range([0, width]);

        var y = d3.scaleLinear()
          .domain([0, maxChurn * 1.1])
          .nice()
          .range([height, 0]);

        // Bubble size scale (area-based for perceptual accuracy)
        var sizeScale = d3.scaleSqrt()
          .domain([0, maxLoc])
          .range([6, 40]);

        // Grid lines
        g.append('g')
          .attr('class', 'grid')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickSize(-height).tickFormat(''))
          .selectAll('line')
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-dasharray', '2,2');

        g.append('g')
          .attr('class', 'grid')
          .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
          .selectAll('line')
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-dasharray', '2,2');

        g.selectAll('.grid .domain').remove();

        // Bubbles
        g.selectAll('.bubble')
          .data(data)
          .enter()
          .append('circle')
          .attr('class', 'bubble')
          .attr('cx', function(d) { return x(d.complexity || 0); })
          .attr('cy', function(d) { return y(d.churnCount || 0); })
          .attr('r', function(d) { return sizeScale(d.loc || 100); })
          .attr('fill', function(d) { return getRiskTierColor(d.riskTier) + 'cc'; })
          .attr('stroke', function(d) { return getRiskTierColor(d.riskTier); })
          .attr('stroke-width', 2)
          .attr('tabindex', '0')
          .attr('role', 'button')
          .attr('aria-label', function(d) {
            return escapeHtml(truncateRiskFilePath(d.filePath, 30)) +
              ': Complexity=' + d.complexity +
              ', Churn=' + d.churnCount +
              ', LOC=' + formatNumber(d.loc) +
              ', Risk=' + (d.riskTier || 'unknown');
          })
          .on('mouseover', function(event, d) {
            d3.select(this).attr('stroke-width', 3);
            showOrgRiskTooltip(event,
              '<strong>' + escapeHtml(truncateRiskFilePath(d.filePath, 50)) + '</strong><br>' +
              'Team: ' + escapeHtml(d.teamName || '(Unknown)') + '<br>' +
              'Complexity: ' + escapeHtml(String(d.complexity)) + '<br>' +
              'Churn: ' + escapeHtml(String(d.churnCount)) + ' commits<br>' +
              'LOC: ' + formatNumber(d.loc) + '<br>' +
              'Risk Score: ' + (d.riskScore !== undefined ? d.riskScore.toFixed(1) : 'N/A') + '<br>' +
              '<span style="color:' + getRiskTierColor(d.riskTier) + ';font-weight:bold;">' +
              escapeHtml((d.riskTier || 'unknown').toUpperCase()) + ' RISK</span><br>' +
              '<small style="opacity:0.7;">Click to open file</small>'
            );
          })
          .on('mousemove', moveOrgRiskTooltip)
          .on('mouseout', function() {
            d3.select(this).attr('stroke-width', 2);
            hideOrgRiskTooltip();
          })
          .on('click', function(event, d) {
            vscode.postMessage({
              type: 'openFile',
              filePath: d.filePath,
              repository: d.repository || ''
            });
          })
          .on('keydown', function(event, d) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              vscode.postMessage({
                type: 'openFile',
                filePath: d.filePath,
                repository: d.repository || ''
              });
            }
          });

        // GITX-216: Add permanent file name labels to bubbles (no truncation)
        g.selectAll('.bubble-label')
          .data(data)
          .enter()
          .append('text')
          .attr('class', 'bubble-label')
          .attr('x', function(d) { return x(d.complexity || 0); })
          .attr('y', function(d) { return y(d.churnCount || 0) + 4; })
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-editor-background, #1e1e1e)')
          .attr('font-size', '9px')
          .attr('font-weight', 'bold')
          .attr('pointer-events', 'none')
          .text(function(d) {
            // Extract just the filename from the full path (no truncation)
            var path = d.filePath || '';
            var parts = path.split('/');
            return parts[parts.length - 1] || path;
          });

        // X Axis
        g.append('g')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).ticks(6))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px');

        // X Axis Label
        svg.append('text')
          .attr('x', margin.left + width / 2)
          .attr('y', height + margin.top + 45)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Complexity');

        // Y Axis
        g.append('g')
          .call(d3.axisLeft(y).ticks(6))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px');

        // Y Axis Label
        svg.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('x', -(margin.top + height / 2))
          .attr('y', 15)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Churn (Commits)');

        // Legend (risk tiers)
        var legendData = [
          { tier: 'critical', label: 'Critical' },
          { tier: 'high', label: 'High' },
          { tier: 'medium', label: 'Medium' },
          { tier: 'low', label: 'Low' }
        ];

        var legendG = svg.append('g')
          .attr('class', 'risk-legend')
          .attr('transform', 'translate(' + (margin.left + width + 15) + ',' + margin.top + ')');

        legendG.append('text')
          .attr('x', 0)
          .attr('y', -5)
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .attr('font-weight', 'bold')
          .text('Risk Tier');

        legendData.forEach(function(item, i) {
          var lg = legendG.append('g')
            .attr('transform', 'translate(0,' + (i * 22 + 10) + ')');

          lg.append('circle')
            .attr('cx', 7)
            .attr('cy', 7)
            .attr('r', 7)
            .attr('fill', getRiskTierColor(item.tier) + 'cc')
            .attr('stroke', getRiskTierColor(item.tier))
            .attr('stroke-width', 1.5);

          lg.append('text')
            .attr('x', 20)
            .attr('y', 11)
            .attr('fill', 'var(--vscode-foreground, #ccc)')
            .attr('font-size', '10px')
            .text(item.label);
        });

        // Size legend
        var sizeLegendG = svg.append('g')
          .attr('class', 'size-legend')
          .attr('transform', 'translate(' + (margin.left + width + 15) + ',' + (margin.top + 115) + ')');

        sizeLegendG.append('text')
          .attr('x', 0)
          .attr('y', -5)
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .attr('font-weight', 'bold')
          .text('Size = LOC');
      }

      // ======================================================================
      // GITX-209: Knowledge Concentration Treemap
      // Size = Total Commits, Color = Top Contributor
      // ======================================================================

      /**
       * Render the Knowledge Concentration treemap.
       *
       * @param {Array} data - Array of OrgProfileKnowledgeConcentration objects
       */
      function renderOrgKnowledgeChart(data) {
        hideSkeleton('orgKnowledgeSkeleton');
        cachedOrgKnowledgeData = data;

        var container = document.getElementById('orgKnowledgeChart');
        var legendContainer = document.getElementById('orgKnowledgeLegend');
        var emptyMsg = document.getElementById('orgKnowledgeEmpty');

        if (!data || data.length === 0) {
          container.classList.add('hidden');
          legendContainer.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        container.classList.remove('hidden');
        legendContainer.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        container.innerHTML = '';
        legendContainer.innerHTML = '';

        // Extract unique top contributors for color mapping
        var contributors = [];
        var contributorSet = {};
        data.forEach(function(d) {
          var name = d.topContributor || '(Unknown)';
          if (!contributorSet[name]) {
            contributorSet[name] = true;
            contributors.push(name);
          }
        });

        // Build color map
        var colorMap = {};
        contributors.forEach(function(name, i) {
          colorMap[name] = getMemberColor(i);
        });

        // Chart dimensions
        var width = Math.max(500, container.clientWidth);
        var height = 350;

        var svg = d3.select(container).append('svg')
          .attr('width', width)
          .attr('height', height)
          .attr('role', 'img')
          .attr('aria-label', 'Knowledge concentration treemap: size=commits, color=top contributor');

        // Build hierarchy for treemap
        var root = d3.hierarchy({
          name: 'root',
          children: data.map(function(d) {
            return {
              name: d.filePath,
              value: d.totalCommits || 1,
              data: d
            };
          })
        })
        .sum(function(d) { return d.value || 1; })
        .sort(function(a, b) { return b.value - a.value; });

        // Create treemap layout
        var treemap = d3.treemap()
          .size([width, height])
          .padding(2)
          .round(true);

        treemap(root);

        // Render cells
        var cells = svg.selectAll('.treemap-cell')
          .data(root.leaves())
          .enter()
          .append('g')
          .attr('class', 'treemap-cell')
          .attr('transform', function(d) {
            return 'translate(' + d.x0 + ',' + d.y0 + ')';
          });

        cells.append('rect')
          .attr('width', function(d) { return Math.max(0, d.x1 - d.x0); })
          .attr('height', function(d) { return Math.max(0, d.y1 - d.y0); })
          .attr('fill', function(d) {
            var contributor = d.data.data.topContributor || '(Unknown)';
            return colorMap[contributor] + 'cc';
          })
          .attr('stroke', function(d) {
            var contributor = d.data.data.topContributor || '(Unknown)';
            return colorMap[contributor];
          })
          .attr('stroke-width', 1)
          .attr('tabindex', '0')
          .attr('role', 'button')
          .attr('aria-label', function(d) {
            var fd = d.data.data;
            return escapeHtml(truncateRiskFilePath(fd.filePath, 30)) +
              ': ' + fd.totalCommits + ' commits, ' +
              escapeHtml(fd.topContributor || 'Unknown') + ' owns ' +
              (fd.topContributorPct !== undefined ? fd.topContributorPct.toFixed(0) : '?') + '%';
          })
          .on('mouseover', function(event, d) {
            var fd = d.data.data;
            d3.select(this).attr('stroke-width', 2);
            showOrgRiskTooltip(event,
              '<strong>' + escapeHtml(truncateRiskFilePath(fd.filePath, 50)) + '</strong><br>' +
              'Team: ' + escapeHtml(fd.teamName || '(Unknown)') + '<br>' +
              'Repository: ' + escapeHtml(fd.repository || '(Unknown)') + '<br>' +
              'Total Commits: ' + formatNumber(fd.totalCommits) + '<br>' +
              'Contributors: ' + formatNumber(fd.totalContributors) + '<br>' +
              '<span style="font-weight:bold;">Top: ' + escapeHtml(fd.topContributor || 'Unknown') +
              ' (' + (fd.topContributorPct !== undefined ? fd.topContributorPct.toFixed(0) : '?') + '%)</span><br>' +
              '<span style="color:' + getConcentrationRiskColor(fd.concentrationRisk) + ';font-weight:bold;">' +
              escapeHtml((fd.concentrationRisk || 'unknown').toUpperCase()) + ' RISK</span><br>' +
              '<small style="opacity:0.7;">Click to open file</small>'
            );
          })
          .on('mousemove', moveOrgRiskTooltip)
          .on('mouseout', function() {
            d3.select(this).attr('stroke-width', 1);
            hideOrgRiskTooltip();
          })
          .on('click', function(event, d) {
            var fd = d.data.data;
            vscode.postMessage({
              type: 'openFile',
              filePath: fd.filePath,
              repository: fd.repository || ''
            });
          })
          .on('keydown', function(event, d) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              var fd = d.data.data;
              vscode.postMessage({
                type: 'openFile',
                filePath: fd.filePath,
                repository: fd.repository || ''
              });
            }
          });

        // Add labels for larger cells
        cells.filter(function(d) {
          return (d.x1 - d.x0) > 60 && (d.y1 - d.y0) > 30;
        })
        .append('text')
          .attr('x', 4)
          .attr('y', 14)
          .attr('fill', 'var(--vscode-editor-background, #1e1e1e)')
          .attr('font-size', '10px')
          .attr('font-weight', 'bold')
          .text(function(d) {
            var fd = d.data.data;
            var maxLen = Math.floor((d.x1 - d.x0 - 8) / 6);
            return truncateRiskFilePath(fd.filePath, Math.max(10, maxLen));
          });

        cells.filter(function(d) {
          return (d.x1 - d.x0) > 80 && (d.y1 - d.y0) > 45;
        })
        .append('text')
          .attr('x', 4)
          .attr('y', 26)
          .attr('fill', 'var(--vscode-editor-background, #1e1e1e)')
          .attr('font-size', '9px')
          .text(function(d) {
            var fd = d.data.data;
            return escapeHtml(fd.topContributor || '?') + ' ' +
              (fd.topContributorPct !== undefined ? fd.topContributorPct.toFixed(0) : '?') + '%';
          });

        // Render legend
        var legendHtml = '<span class="legend-title">Top Contributors:</span> ';
        contributors.slice(0, 8).forEach(function(name, i) {
          legendHtml += '<span class="legend-item">' +
            '<span class="legend-swatch" style="background-color:' + colorMap[name] + ';"></span>' +
            escapeHtml(name.length > 15 ? name.slice(0, 14) + '...' : name) +
            '</span>';
        });
        if (contributors.length > 8) {
          legendHtml += '<span class="legend-item">+' + (contributors.length - 8) + ' more</span>';
        }
        legendContainer.innerHTML = legendHtml;
      }

      /**
       * Get color for concentration risk level.
       *
       * @param {string} risk - Concentration risk level
       * @returns {string} Hex color string
       */
      function getConcentrationRiskColor(risk) {
        var r = (risk || '').toLowerCase();
        if (r === 'critical' || r === 'high') { return '#FF4444'; }
        if (r === 'medium') { return '#FFCC00'; }
        return '#88BB00';
      }
  `;
}
