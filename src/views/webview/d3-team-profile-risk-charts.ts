/**
 * D3.js chart renderers for Team Profile Dashboard - Risk charts.
 * GITX-188: Hot Spots bubble chart and Knowledge Concentration treemap.
 *
 * Ticket: GITX-188
 */

/**
 * Generate the JavaScript source for the Team Profile risk charts.
 * GITX-188: Hot Spots bubble chart and Knowledge Concentration treemap.
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
      // GITX-188: Knowledge Concentration Treemap for Team Profile
      // ======================================================================

      // Concentration risk colors (colorblind-accessible palette)
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
       * Render the Knowledge Concentration treemap.
       * GITX-188: Tile size = commits, color = concentration risk.
       *
       * @param {Array} data - Array of TeamProfileKnowledgeConcentration
       */
      function renderTeamKnowledgeChart(data) {
        hideSkeleton('knowledgeSkeleton');
        cachedKnowledgeData = data;

        var container = document.getElementById('knowledgeChart');
        var emptyMsg = document.getElementById('knowledgeEmpty');

        if (!data || data.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        container.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        container.innerHTML = '';

        // Chart dimensions
        var width = Math.max(500, container.clientWidth);
        var height = 350;

        var svg = d3.select(container).append('svg')
          .attr('width', width)
          .attr('height', height)
          .attr('role', 'img')
          .attr('aria-label', 'Knowledge Concentration treemap: tile size = commits, color = concentration risk');

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

        // Render file rectangles
        root.leaves().forEach(function(leaf) {
          var d = leaf.data;
          if (!d.filePath) { return; }

          var rx = leaf.x0;
          var ry = leaf.y0;
          var rw = leaf.x1 - leaf.x0;
          var rh = leaf.y1 - leaf.y0;

          if (rw < 4 || rh < 4) { return; } // Skip tiny rectangles

          var color = CONCENTRATION_RISK_COLORS[d.concentrationRisk] || '#888';

          // File rectangle
          svg.append('rect')
            .attr('x', rx)
            .attr('y', ry)
            .attr('width', rw)
            .attr('height', rh)
            .attr('fill', color)
            .attr('fill-opacity', 0.75)
            .attr('stroke', color)
            .attr('stroke-width', 0.5)
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', escapeHtml(d.filePath) + ': ' + d.topContributorPct + '% owned by ' + escapeHtml(d.topContributor))
            .on('mouseover', function(event) {
              showTeamFileTooltip(event,
                '<strong>' + escapeHtml(truncateTeamFilePath(d.filePath, 45)) + '</strong><br>' +
                'Repository: ' + escapeHtml(d.repository) + '<br>' +
                'Top Owner: ' + escapeHtml(d.topContributor) + ' (' + d.topContributorPct + '%)<br>' +
                'Contributors: ' + d.totalContributors + '<br>' +
                'Commits: ' + d.totalCommits + '<br>' +
                '<span style="color:' + color + '">Risk: ' + d.concentrationRisk.toUpperCase() + '</span><br>' +
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

          // File label (if rectangle is big enough)
          if (rw > 50 && rh > 22) {
            var fileName = d.name || d.filePath.split('/').pop();
            var initials = getContributorInitials(d.topContributor);
            var labelMaxChars = Math.floor(rw / 7);
            var displayName = fileName.length > labelMaxChars ? fileName.slice(0, labelMaxChars - 3) + '...' : fileName;

            svg.append('text')
              .attr('x', rx + 4)
              .attr('y', ry + 12)
              .attr('fill', '#fff')
              .attr('font-size', '9px')
              .attr('pointer-events', 'none')
              .text(displayName);

            if (rh > 34) {
              svg.append('text')
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
      }
  `;
}
