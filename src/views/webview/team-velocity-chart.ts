/**
 * D3.js Sprint Velocity chart with member colors for Team Profile Dashboard.
 * GITX-200: Renders stacked bar chart showing story points per team member
 * with LOC trend line overlay. Follows Okabe-Ito colorblind-safe palette.
 *
 * Features:
 * - Stacked bars: One color per team member (max 10, others grouped as "Other Members")
 * - LOC trend line overlay (dual-axis)
 * - Okabe-Ito colorblind-friendly 12-color palette
 * - Deterministic color assignment based on sorted member names
 * - Interactive legend with click-to-toggle visibility
 * - High-contrast mode with pattern fills
 * - Graceful degradation when no Jira data
 * - VS Code theme integration
 *
 * Ticket: GITX-200
 */

/**
 * Generate the JavaScript code for the Team Sprint Velocity chart with member colors.
 * GITX-200: Primary chart showing stacked bars per team member with LOC overlay.
 */
export function generateTeamVelocityChartScript(): string {
  return `
      // ======================================================================
      // GITX-200: Team Sprint Velocity Chart with Member Colors
      // ======================================================================
      // Okabe-Ito colorblind-safe palette (12 colors for up to 10 members + Other)
      var MEMBER_COLORS = [
        '#E69F00',  // Orange
        '#56B4E9',  // Sky Blue
        '#009E73',  // Bluish Green
        '#D4C800',  // Yellow (WCAG adjusted)
        '#0072B2',  // Blue
        '#D55E00',  // Vermillion
        '#CC79A7',  // Reddish Purple
        '#F0E442',  // Bright Yellow
        '#88CCEE',  // Light Cyan
        '#44AA99',  // Teal
        '#117733',  // Dark Green
        '#999999'   // Gray (Other Members)
      ];
      var LOC_LINE_COLOR = '#56B4E9';  // Sky Blue for LOC line
      var MAX_LEGEND_MEMBERS = 10;

      // State for member visibility toggle
      var memberVisibility = {};
      // NOTE: cachedVelocityWithMembers is declared in team-profile-html.ts main scope
      var sortedMembers = [];

      /**
       * Get deterministic color for a member based on sorted name index.
       */
      function getMemberColor(memberName, allMembers) {
        var idx = allMembers.indexOf(memberName);
        if (idx === -1 || idx >= MAX_LEGEND_MEMBERS) {
          return MEMBER_COLORS[11]; // Gray for "Other Members"
        }
        return MEMBER_COLORS[idx % (MEMBER_COLORS.length - 1)];
      }

      /**
       * Get pattern ID for high-contrast mode.
       */
      function getMemberPatternId(memberName, allMembers) {
        var idx = allMembers.indexOf(memberName);
        if (idx === -1 || idx >= MAX_LEGEND_MEMBERS) {
          return 'pattern-other';
        }
        return 'pattern-' + idx;
      }

      /**
       * Define SVG patterns for high-contrast mode.
       */
      function definePatterns(svg) {
        var defs = svg.append('defs');
        var patternTypes = ['diagonal', 'horizontal', 'vertical', 'dots', 'cross', 'diamond', 'zigzag', 'wave', 'grid', 'dash', 'circle', 'solid'];

        patternTypes.forEach(function(type, i) {
          var pattern = defs.append('pattern')
            .attr('id', 'pattern-' + i)
            .attr('patternUnits', 'userSpaceOnUse')
            .attr('width', 8)
            .attr('height', 8);

          switch (type) {
            case 'diagonal':
              pattern.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 8).attr('y2', 8).attr('stroke', MEMBER_COLORS[i]).attr('stroke-width', 2);
              break;
            case 'horizontal':
              pattern.append('line').attr('x1', 0).attr('y1', 4).attr('x2', 8).attr('y2', 4).attr('stroke', MEMBER_COLORS[i]).attr('stroke-width', 2);
              break;
            case 'vertical':
              pattern.append('line').attr('x1', 4).attr('y1', 0).attr('x2', 4).attr('y2', 8).attr('stroke', MEMBER_COLORS[i]).attr('stroke-width', 2);
              break;
            case 'dots':
              pattern.append('circle').attr('cx', 4).attr('cy', 4).attr('r', 2).attr('fill', MEMBER_COLORS[i]);
              break;
            case 'cross':
              pattern.append('line').attr('x1', 0).attr('y1', 4).attr('x2', 8).attr('y2', 4).attr('stroke', MEMBER_COLORS[i]).attr('stroke-width', 1);
              pattern.append('line').attr('x1', 4).attr('y1', 0).attr('x2', 4).attr('y2', 8).attr('stroke', MEMBER_COLORS[i]).attr('stroke-width', 1);
              break;
            default:
              pattern.append('rect').attr('width', 8).attr('height', 8).attr('fill', MEMBER_COLORS[i]);
          }
        });

        // Pattern for "Other Members"
        var otherPattern = defs.append('pattern')
          .attr('id', 'pattern-other')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 8)
          .attr('height', 8);
        otherPattern.append('rect').attr('width', 8).attr('height', 8).attr('fill', MEMBER_COLORS[11]);
      }

      /**
       * Render the Team Sprint Velocity chart with member-colored stacked bars.
       */
      function renderTeamVelocityChart(data) {
        hideSkeleton('sprintVelocitySkeleton');
        cachedVelocityWithMembers = data;

        var chartEl = document.getElementById('sprintVelocityChart');
        var emptyEl = document.getElementById('sprintVelocityEmpty');
        var hintEl = document.getElementById('sprintVelocityHint');
        var noJiraEl = document.getElementById('sprintVelocityNoJira');

        // Check data availability
        var hasStoryPoints = data && data.some(function(d) { return d.totalStoryPoints > 0; });
        var hasLocData = data && data.some(function(d) { return d.linesOfCode > 0; });

        if (!data || data.length === 0 || (!hasStoryPoints && !hasLocData)) {
          chartEl.classList.add('hidden');
          emptyEl.classList.remove('hidden');
          if (hintEl) hintEl.classList.add('hidden');
          if (noJiraEl) noJiraEl.classList.add('hidden');
          return;
        }

        chartEl.classList.remove('hidden');
        emptyEl.classList.add('hidden');

        // Show appropriate hint
        if (!hasStoryPoints && hasLocData) {
          if (hintEl) hintEl.classList.add('hidden');
          if (noJiraEl) noJiraEl.classList.remove('hidden');
        } else {
          if (hintEl) hintEl.classList.remove('hidden');
          if (noJiraEl) noJiraEl.classList.add('hidden');
        }

        // Build sorted member list for deterministic color assignment
        var memberSet = new Set();
        data.forEach(function(period) {
          (period.memberContributions || []).forEach(function(mc) {
            memberSet.add(mc.memberName);
          });
        });
        sortedMembers = Array.from(memberSet).sort();

        // Initialize visibility for all members
        sortedMembers.forEach(function(m) {
          if (memberVisibility[m] === undefined) {
            memberVisibility[m] = true;
          }
        });

        // Prepare chart dimensions
        var container = chartEl;
        container.innerHTML = '';
        var margin = { top: 50, right: 80, bottom: 80, left: 60 };
        var width = container.clientWidth - margin.left - margin.right;
        var height = 360 - margin.top - margin.bottom;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom + 60) // Extra space for legend
          .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // Define patterns for high-contrast mode
        definePatterns(svg);

        // X scale - periods (weeks/months)
        var x = d3.scaleBand()
          .domain(data.map(function(d) { return d.weekStart; }))
          .range([0, width])
          .padding(0.15);

        // Y scale left - story points
        var maxSP = d3.max(data, function(d) { return d.totalStoryPoints; }) || 10;
        var yLeft = d3.scaleLinear()
          .domain([0, maxSP])
          .nice()
          .range([height, 0]);

        // Y scale right - LOC
        var maxLoc = d3.max(data, function(d) { return d.linesOfCode; }) || 1000;
        var yRight = d3.scaleLinear()
          .domain([0, maxLoc])
          .nice()
          .range([height, 0]);

        // Build stacked data
        var stackData = data.map(function(period) {
          var row = { weekStart: period.weekStart, linesOfCode: period.linesOfCode };
          var totalStacked = 0;
          var otherMembersPoints = 0;

          // Top 10 members get individual colors, rest are "Other"
          var topMembers = sortedMembers.slice(0, MAX_LEGEND_MEMBERS);
          var otherMembers = sortedMembers.slice(MAX_LEGEND_MEMBERS);

          topMembers.forEach(function(m) {
            var mc = (period.memberContributions || []).find(function(c) { return c.memberName === m; });
            row[m] = mc && memberVisibility[m] ? mc.storyPoints : 0;
            totalStacked += row[m];
          });

          otherMembers.forEach(function(m) {
            var mc = (period.memberContributions || []).find(function(c) { return c.memberName === m; });
            if (mc && memberVisibility[m]) {
              otherMembersPoints += mc.storyPoints;
            }
          });

          if (otherMembers.length > 0) {
            row['Other Members'] = otherMembersPoints;
          }

          return row;
        });

        // Stack keys: top members + "Other Members" if needed
        var stackKeys = sortedMembers.slice(0, MAX_LEGEND_MEMBERS);
        if (sortedMembers.length > MAX_LEGEND_MEMBERS) {
          stackKeys.push('Other Members');
        }

        var stack = d3.stack().keys(stackKeys);
        var series = stack(stackData);

        // Draw stacked bars
        if (hasStoryPoints) {
          svg.selectAll('.layer')
            .data(series)
            .enter()
            .append('g')
            .attr('class', 'layer')
            .attr('fill', function(d) { return getMemberColor(d.key, sortedMembers); })
            .selectAll('rect')
            .data(function(d) { return d.map(function(dd) { dd.key = d.key; return dd; }); })
            .enter()
            .append('rect')
            .attr('x', function(d) { return x(d.data.weekStart); })
            .attr('y', function(d) { return yLeft(d[1]); })
            .attr('height', function(d) { return yLeft(d[0]) - yLeft(d[1]); })
            .attr('width', x.bandwidth())
            .attr('tabindex', 0)
            .attr('role', 'img')
            .attr('aria-label', function(d) {
              var val = d[1] - d[0];
              var total = d.data.totalStoryPoints || d[1];
              var pct = total > 0 ? Math.round((val / total) * 100) : 0;
              return d.key + ': ' + val + ' SP (' + pct + '%) for ' + formatXAxisDate(d.data.weekStart);
            })
            .on('mouseenter', function(event, d) {
              showTeamVelocityTooltip(event, d, sortedMembers);
            })
            .on('mousemove', function(event) {
              moveTeamVelocityTooltip(event);
            })
            .on('mouseleave', function() {
              hideTeamVelocityTooltip();
            })
            .on('focus', function(event, d) {
              var rect = this.getBoundingClientRect();
              var syntheticEvent = { pageX: rect.left + rect.width / 2, pageY: rect.top };
              showTeamVelocityTooltip(syntheticEvent, d, sortedMembers);
            })
            .on('blur', function() {
              hideTeamVelocityTooltip();
            });
        } else {
          // Graceful degradation: show LOC as bars when no Jira data
          svg.selectAll('.bar-loc-fallback')
            .data(data)
            .enter()
            .append('rect')
            .attr('class', 'bar-loc-fallback')
            .attr('x', function(d) { return x(d.weekStart); })
            .attr('y', function(d) { return yRight(d.linesOfCode || 0); })
            .attr('width', x.bandwidth())
            .attr('height', function(d) { return height - yRight(d.linesOfCode || 0); })
            .attr('fill', LOC_LINE_COLOR)
            .attr('opacity', 0.7)
            .attr('tabindex', 0)
            .attr('role', 'img')
            .attr('aria-label', function(d) {
              return formatXAxisDate(d.weekStart) + ': ' + formatNumber(d.linesOfCode) + ' lines of code';
            });
        }

        // Draw LOC line (if story point data exists)
        if (hasStoryPoints && hasLocData) {
          var line = d3.line()
            .x(function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
            .y(function(d) { return yRight(d.linesOfCode); })
            .curve(d3.curveMonotoneX);

          svg.append('path')
            .datum(data)
            .attr('fill', 'none')
            .attr('stroke', LOC_LINE_COLOR)
            .attr('stroke-width', 2.5)
            .attr('d', line);

          // LOC data points
          svg.selectAll('.point-loc')
            .data(data)
            .enter()
            .append('circle')
            .attr('class', 'point-loc')
            .attr('cx', function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
            .attr('cy', function(d) { return yRight(d.linesOfCode); })
            .attr('r', 5)
            .attr('fill', LOC_LINE_COLOR)
            .attr('stroke', 'var(--vscode-editor-background)')
            .attr('stroke-width', 2)
            .attr('tabindex', 0)
            .attr('role', 'img')
            .attr('aria-label', function(d) {
              return formatXAxisDate(d.weekStart) + ': ' + formatNumber(d.linesOfCode) + ' lines of code';
            });
        }

        // X axis
        svg.append('g')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickFormat(function(d) { return formatXAxisDate(d); }))
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        // Y axis left (story points)
        if (hasStoryPoints) {
          svg.append('g')
            .call(d3.axisLeft(yLeft).ticks(5))
            .append('text')
            .attr('transform', 'rotate(-90)')
            .attr('y', -margin.left + 15)
            .attr('x', -height / 2)
            .attr('text-anchor', 'middle')
            .style('fill', MEMBER_COLORS[0])
            .style('font-weight', '600')
            .text('Story Points');

          // Y axis right (LOC)
          if (hasLocData) {
            svg.append('g')
              .attr('transform', 'translate(' + width + ',0)')
              .call(d3.axisRight(yRight).ticks(5).tickFormat(d3.format('.2s')))
              .append('text')
              .attr('transform', 'rotate(-90)')
              .attr('y', margin.right - 15)
              .attr('x', -height / 2)
              .attr('text-anchor', 'middle')
              .style('fill', LOC_LINE_COLOR)
              .style('font-weight', '600')
              .text('Lines of Code');
          }
        } else {
          // LOC only axis
          svg.append('g')
            .call(d3.axisLeft(yRight).ticks(5).tickFormat(d3.format('.2s')))
            .append('text')
            .attr('transform', 'rotate(-90)')
            .attr('y', -margin.left + 15)
            .attr('x', -height / 2)
            .attr('text-anchor', 'middle')
            .style('fill', LOC_LINE_COLOR)
            .style('font-weight', '600')
            .text('Lines of Code');
        }

        // Render interactive legend below chart
        renderTeamVelocityLegend(svg, width, height, stackKeys, hasLocData, hasStoryPoints);
      }

      /**
       * Render interactive legend with click-to-toggle functionality.
       */
      function renderTeamVelocityLegend(svg, width, height, stackKeys, hasLocData, hasStoryPoints) {
        var legendItems = [];

        // Add member items
        if (hasStoryPoints) {
          stackKeys.forEach(function(key, i) {
            legendItems.push({
              key: key,
              color: getMemberColor(key, sortedMembers),
              isLine: false
            });
          });
        }

        // Add LOC line to legend if both data types exist
        if (hasStoryPoints && hasLocData) {
          legendItems.push({
            key: 'Lines of Code',
            color: LOC_LINE_COLOR,
            isLine: true
          });
        } else if (!hasStoryPoints && hasLocData) {
          legendItems.push({
            key: 'Lines of Code',
            color: LOC_LINE_COLOR,
            isLine: false
          });
        }

        // Calculate legend layout (horizontal, wrapped)
        var itemWidth = 120;
        var itemHeight = 18;
        var itemsPerRow = Math.floor(width / itemWidth);
        var legendStartY = height + 55;

        var legend = svg.append('g')
          .attr('class', 'team-velocity-legend')
          .attr('transform', 'translate(0,' + legendStartY + ')');

        legendItems.forEach(function(item, i) {
          var row = Math.floor(i / itemsPerRow);
          var col = i % itemsPerRow;
          var xPos = col * itemWidth;
          var yPos = row * itemHeight;

          var g = legend.append('g')
            .attr('transform', 'translate(' + xPos + ',' + yPos + ')')
            .attr('class', 'legend-item')
            .attr('tabindex', 0)
            .attr('role', 'button')
            .attr('aria-pressed', memberVisibility[item.key] !== false ? 'true' : 'false')
            .attr('aria-label', 'Toggle ' + item.key + ' visibility')
            .style('cursor', item.isLine ? 'default' : 'pointer')
            .style('opacity', memberVisibility[item.key] === false ? 0.4 : 1);

          if (item.isLine) {
            // Line symbol for LOC
            g.append('line')
              .attr('x1', 0).attr('y1', 6).attr('x2', 15).attr('y2', 6)
              .attr('stroke', item.color)
              .attr('stroke-width', 2.5);
            g.append('circle')
              .attr('cx', 7.5).attr('cy', 6).attr('r', 3)
              .attr('fill', item.color);
          } else {
            // Rect for bar items
            g.append('rect')
              .attr('width', 12).attr('height', 12)
              .attr('fill', item.color);
          }

          g.append('text')
            .attr('x', 18).attr('y', 10)
            .style('fill', 'var(--vscode-foreground)')
            .style('font-size', '10px')
            .text(item.key.length > 14 ? item.key.slice(0, 12) + '...' : item.key);

          // Click handler for toggle (not for LOC line)
          if (!item.isLine) {
            g.on('click', function() {
              memberVisibility[item.key] = !memberVisibility[item.key];
              renderTeamVelocityChart(cachedVelocityWithMembers);
            });
            g.on('keydown', function(e) {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                memberVisibility[item.key] = !memberVisibility[item.key];
                renderTeamVelocityChart(cachedVelocityWithMembers);
              }
            });
          }
        });
      }

      // ======================================================================
      // Tooltip helpers for Team Velocity Chart
      // ======================================================================
      var teamVelocityTooltip = null;

      function showTeamVelocityTooltip(event, d, allMembers) {
        if (!teamVelocityTooltip) {
          teamVelocityTooltip = document.getElementById('teamVelocityTooltip');
        }
        if (!teamVelocityTooltip) return;

        var val = d[1] - d[0];
        var total = d.data.totalStoryPoints || d[1] || 1;
        var pct = total > 0 ? Math.round((val / total) * 100) : 0;
        var loc = d.data.linesOfCode || 0;

        teamVelocityTooltip.innerHTML =
          '<div class="tt-period">' + formatXAxisDate(d.data.weekStart) + '</div>' +
          '<div class="tt-member">' + escapeHtml(d.key) + '</div>' +
          '<div class="tt-value">' + val + ' SP (' + pct + '% of team)</div>' +
          '<div class="tt-loc">Team LOC: ' + formatNumber(loc) + '</div>';

        teamVelocityTooltip.classList.add('visible');
        teamVelocityTooltip.setAttribute('aria-hidden', 'false');
        moveTeamVelocityTooltip(event);
      }

      function moveTeamVelocityTooltip(event) {
        if (!teamVelocityTooltip) return;

        var x = event.pageX + 12;
        var y = event.pageY - 28;

        var ttRect = teamVelocityTooltip.getBoundingClientRect();
        var viewportWidth = window.innerWidth;
        var viewportHeight = window.innerHeight;

        if (x + ttRect.width > viewportWidth - 20) {
          x = event.pageX - ttRect.width - 12;
        }
        if (x < 10) x = 10;
        if (y + ttRect.height > viewportHeight - 20) {
          y = event.pageY - ttRect.height - 12;
        }
        if (y < 10) y = event.pageY + 20;

        teamVelocityTooltip.style.left = x + 'px';
        teamVelocityTooltip.style.top = y + 'px';
      }

      function hideTeamVelocityTooltip() {
        if (!teamVelocityTooltip) {
          teamVelocityTooltip = document.getElementById('teamVelocityTooltip');
        }
        if (teamVelocityTooltip) {
          teamVelocityTooltip.classList.remove('visible');
          teamVelocityTooltip.setAttribute('aria-hidden', 'true');
        }
      }
`;
}

/**
 * Generate the JavaScript code for the standalone LOC by Repository chart.
 * GITX-200: Moved below Sprint Velocity chart, each repo as a separate colored line.
 * Reuses existing renderLocWeekChart logic but with explicit "LOC by Repository" naming.
 */
export function generateLocByRepoChartScript(): string {
  return `
      // ======================================================================
      // GITX-200: LOC by Repository Chart (moved after Sprint Velocity)
      // Reuses existing LOC chart rendering with repo-colored lines.
      // The renderLocWeekChart function is already defined in dev-profile-charts.ts
      // ======================================================================
`;
}
