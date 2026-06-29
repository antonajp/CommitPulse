/**
 * D3.js Sprint Velocity chart with team colors for Organization Profile Dashboard.
 * GITX-201: Renders stacked bar chart showing story points per team
 * with LOC trend line overlay. Follows Okabe-Ito colorblind-safe palette.
 *
 * Features:
 * - Stacked bars: One color per team (max 10, others grouped as "Other Teams")
 * - LOC trend line overlay (dual-axis)
 * - Okabe-Ito colorblind-friendly 12-color palette
 * - Deterministic color assignment based on sorted team names
 * - Interactive legend with click-to-toggle visibility
 * - High-contrast mode with pattern fills
 * - Graceful degradation when no Jira data
 * - VS Code theme integration
 *
 * Ticket: GITX-201
 */

/**
 * Generate the JavaScript code for the Organization Sprint Velocity chart with team colors.
 * GITX-201: Primary chart showing stacked bars per team with LOC overlay.
 */
export function generateOrgVelocityWithTeamsChartScript(): string {
  return `
      // ======================================================================
      // GITX-201: Organization Sprint Velocity Chart with Team Colors
      // ======================================================================
      // Okabe-Ito colorblind-safe palette (12 colors for up to 10 teams + Other)
      var ORG_VELOCITY_TEAM_COLORS = [
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
        '#999999'   // Gray (Other Teams)
      ];
      var ORG_LOC_LINE_COLOR = '#56B4E9';  // Sky Blue for LOC line
      var ORG_MAX_LEGEND_TEAMS = 10;

      // State for team visibility toggle
      var orgTeamVisibility = {};
      // NOTE: cachedOrgVelocityWithTeams is declared in org-profile-html.ts main scope
      var sortedOrgTeams = [];

      /**
       * Get deterministic color for a team based on sorted name index.
       */
      function getOrgVelocityTeamColor(teamName, allTeams) {
        var idx = allTeams.indexOf(teamName);
        if (idx === -1 || idx >= ORG_MAX_LEGEND_TEAMS) {
          return ORG_VELOCITY_TEAM_COLORS[11]; // Gray for "Other Teams"
        }
        return ORG_VELOCITY_TEAM_COLORS[idx % (ORG_VELOCITY_TEAM_COLORS.length - 1)];
      }

      /**
       * Get pattern ID for high-contrast mode.
       */
      function getOrgVelocityPatternId(teamName, allTeams) {
        var idx = allTeams.indexOf(teamName);
        if (idx === -1 || idx >= ORG_MAX_LEGEND_TEAMS) {
          return 'org-velocity-pattern-other';
        }
        return 'org-velocity-pattern-' + idx;
      }

      /**
       * Define SVG patterns for high-contrast mode.
       */
      function defineOrgVelocityPatterns(svg) {
        var defs = svg.append('defs');
        var patternTypes = ['diagonal', 'horizontal', 'vertical', 'dots', 'cross', 'diamond', 'zigzag', 'wave', 'grid', 'dash', 'circle', 'solid'];

        patternTypes.forEach(function(type, i) {
          var pattern = defs.append('pattern')
            .attr('id', 'org-velocity-pattern-' + i)
            .attr('patternUnits', 'userSpaceOnUse')
            .attr('width', 8)
            .attr('height', 8);

          switch (type) {
            case 'diagonal':
              pattern.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 8).attr('y2', 8).attr('stroke', ORG_VELOCITY_TEAM_COLORS[i]).attr('stroke-width', 2);
              break;
            case 'horizontal':
              pattern.append('line').attr('x1', 0).attr('y1', 4).attr('x2', 8).attr('y2', 4).attr('stroke', ORG_VELOCITY_TEAM_COLORS[i]).attr('stroke-width', 2);
              break;
            case 'vertical':
              pattern.append('line').attr('x1', 4).attr('y1', 0).attr('x2', 4).attr('y2', 8).attr('stroke', ORG_VELOCITY_TEAM_COLORS[i]).attr('stroke-width', 2);
              break;
            case 'dots':
              pattern.append('circle').attr('cx', 4).attr('cy', 4).attr('r', 2).attr('fill', ORG_VELOCITY_TEAM_COLORS[i]);
              break;
            case 'cross':
              pattern.append('line').attr('x1', 0).attr('y1', 4).attr('x2', 8).attr('y2', 4).attr('stroke', ORG_VELOCITY_TEAM_COLORS[i]).attr('stroke-width', 1);
              pattern.append('line').attr('x1', 4).attr('y1', 0).attr('x2', 4).attr('y2', 8).attr('stroke', ORG_VELOCITY_TEAM_COLORS[i]).attr('stroke-width', 1);
              break;
            default:
              pattern.append('rect').attr('width', 8).attr('height', 8).attr('fill', ORG_VELOCITY_TEAM_COLORS[i]);
          }
        });

        // Pattern for "Other Teams"
        var otherPattern = defs.append('pattern')
          .attr('id', 'org-velocity-pattern-other')
          .attr('patternUnits', 'userSpaceOnUse')
          .attr('width', 8)
          .attr('height', 8);
        otherPattern.append('rect').attr('width', 8).attr('height', 8).attr('fill', ORG_VELOCITY_TEAM_COLORS[11]);
      }

      /**
       * Render the Organization Sprint Velocity chart with team-colored stacked bars.
       * GITX-201: Primary chart position (below KPI cards, before LOC chart).
       */
      function renderOrgVelocityWithTeamsChart(data) {
        hideSkeleton('orgVelocityTeamsSkeleton');
        cachedOrgVelocityWithTeams = data;

        var chartEl = document.getElementById('orgVelocityTeamsChart');
        var emptyEl = document.getElementById('orgVelocityTeamsEmpty');
        var hintEl = document.getElementById('orgVelocityTeamsHint');
        var noJiraEl = document.getElementById('orgVelocityTeamsNoJira');

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

        // Build sorted team list for deterministic color assignment
        var teamSet = new Set();
        data.forEach(function(period) {
          (period.teamContributions || []).forEach(function(tc) {
            teamSet.add(tc.teamName);
          });
        });
        sortedOrgTeams = Array.from(teamSet).sort();

        // Initialize visibility for all teams
        sortedOrgTeams.forEach(function(t) {
          if (orgTeamVisibility[t] === undefined) {
            orgTeamVisibility[t] = true;
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
        defineOrgVelocityPatterns(svg);

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
          var row = { weekStart: period.weekStart, linesOfCode: period.linesOfCode, totalStoryPoints: period.totalStoryPoints };
          var otherTeamsPoints = 0;

          // Top 10 teams get individual colors, rest are "Other"
          var topTeams = sortedOrgTeams.slice(0, ORG_MAX_LEGEND_TEAMS);
          var otherTeams = sortedOrgTeams.slice(ORG_MAX_LEGEND_TEAMS);

          topTeams.forEach(function(t) {
            var tc = (period.teamContributions || []).find(function(c) { return c.teamName === t; });
            row[t] = tc && orgTeamVisibility[t] ? tc.storyPoints : 0;
          });

          otherTeams.forEach(function(t) {
            var tc = (period.teamContributions || []).find(function(c) { return c.teamName === t; });
            if (tc && orgTeamVisibility[t]) {
              otherTeamsPoints += tc.storyPoints;
            }
          });

          if (otherTeams.length > 0) {
            row['Other Teams'] = otherTeamsPoints;
          }

          return row;
        });

        // Stack keys: top teams + "Other Teams" if needed
        var stackKeys = sortedOrgTeams.slice(0, ORG_MAX_LEGEND_TEAMS);
        if (sortedOrgTeams.length > ORG_MAX_LEGEND_TEAMS) {
          stackKeys.push('Other Teams');
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
            .attr('fill', function(d) { return getOrgVelocityTeamColor(d.key, sortedOrgTeams); })
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
              showOrgVelocityTeamsTooltip(event, d, sortedOrgTeams);
            })
            .on('mousemove', function(event) {
              moveOrgVelocityTeamsTooltip(event);
            })
            .on('mouseleave', function() {
              hideOrgVelocityTeamsTooltip();
            })
            .on('focus', function(event, d) {
              var rect = this.getBoundingClientRect();
              var syntheticEvent = { pageX: rect.left + rect.width / 2, pageY: rect.top };
              showOrgVelocityTeamsTooltip(syntheticEvent, d, sortedOrgTeams);
            })
            .on('blur', function() {
              hideOrgVelocityTeamsTooltip();
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
            .attr('fill', ORG_LOC_LINE_COLOR)
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
            .attr('stroke', ORG_LOC_LINE_COLOR)
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
            .attr('fill', ORG_LOC_LINE_COLOR)
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
            .style('fill', ORG_VELOCITY_TEAM_COLORS[0])
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
              .style('fill', ORG_LOC_LINE_COLOR)
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
            .style('fill', ORG_LOC_LINE_COLOR)
            .style('font-weight', '600')
            .text('Lines of Code');
        }

        // Render interactive legend below chart
        renderOrgVelocityLegend(svg, width, height, stackKeys, hasLocData, hasStoryPoints);
      }

      /**
       * Render interactive legend with click-to-toggle functionality.
       */
      function renderOrgVelocityLegend(svg, width, height, stackKeys, hasLocData, hasStoryPoints) {
        var legendItems = [];

        // Add team items
        if (hasStoryPoints) {
          stackKeys.forEach(function(key, i) {
            legendItems.push({
              key: key,
              color: getOrgVelocityTeamColor(key, sortedOrgTeams),
              isLine: false
            });
          });
        }

        // Add LOC line to legend if both data types exist
        if (hasStoryPoints && hasLocData) {
          legendItems.push({
            key: 'Lines of Code',
            color: ORG_LOC_LINE_COLOR,
            isLine: true
          });
        } else if (!hasStoryPoints && hasLocData) {
          legendItems.push({
            key: 'Lines of Code',
            color: ORG_LOC_LINE_COLOR,
            isLine: false
          });
        }

        // Calculate legend layout (horizontal, wrapped)
        var itemWidth = 120;
        var itemHeight = 18;
        var itemsPerRow = Math.floor(width / itemWidth);
        var legendStartY = height + 55;

        var legend = svg.append('g')
          .attr('class', 'org-velocity-legend')
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
            .attr('aria-pressed', orgTeamVisibility[item.key] !== false ? 'true' : 'false')
            .attr('aria-label', 'Toggle ' + item.key + ' visibility')
            .style('cursor', item.isLine ? 'default' : 'pointer')
            .style('opacity', orgTeamVisibility[item.key] === false ? 0.4 : 1);

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
              orgTeamVisibility[item.key] = !orgTeamVisibility[item.key];
              renderOrgVelocityWithTeamsChart(cachedOrgVelocityWithTeams);
            });
            g.on('keydown', function(e) {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                orgTeamVisibility[item.key] = !orgTeamVisibility[item.key];
                renderOrgVelocityWithTeamsChart(cachedOrgVelocityWithTeams);
              }
            });
          }
        });
      }

      // ======================================================================
      // Tooltip helpers for Organization Velocity Teams Chart
      // ======================================================================
      var orgVelocityTeamsTooltip = null;

      function showOrgVelocityTeamsTooltip(event, d, allTeams) {
        if (!orgVelocityTeamsTooltip) {
          orgVelocityTeamsTooltip = document.getElementById('orgVelocityTeamsTooltip');
        }
        if (!orgVelocityTeamsTooltip) return;

        var val = d[1] - d[0];
        var total = d.data.totalStoryPoints || d[1] || 1;
        var pct = total > 0 ? Math.round((val / total) * 100) : 0;
        var loc = d.data.linesOfCode || 0;

        orgVelocityTeamsTooltip.innerHTML =
          '<div class="tt-period">' + formatXAxisDate(d.data.weekStart) + '</div>' +
          '<div class="tt-team">' + escapeHtml(d.key) + '</div>' +
          '<div class="tt-value">' + val + ' SP (' + pct + '% of org)</div>' +
          '<div class="tt-loc">Org LOC: ' + formatNumber(loc) + '</div>';

        orgVelocityTeamsTooltip.classList.add('visible');
        orgVelocityTeamsTooltip.setAttribute('aria-hidden', 'false');
        moveOrgVelocityTeamsTooltip(event);
      }

      function moveOrgVelocityTeamsTooltip(event) {
        if (!orgVelocityTeamsTooltip) return;

        var x = event.pageX + 12;
        var y = event.pageY - 28;

        var ttRect = orgVelocityTeamsTooltip.getBoundingClientRect();
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

        orgVelocityTeamsTooltip.style.left = x + 'px';
        orgVelocityTeamsTooltip.style.top = y + 'px';
      }

      function hideOrgVelocityTeamsTooltip() {
        if (!orgVelocityTeamsTooltip) {
          orgVelocityTeamsTooltip = document.getElementById('orgVelocityTeamsTooltip');
        }
        if (orgVelocityTeamsTooltip) {
          orgVelocityTeamsTooltip.classList.remove('visible');
          orgVelocityTeamsTooltip.setAttribute('aria-hidden', 'true');
        }
      }
`;
}

/**
 * Generate the JavaScript code for the LOC by Team line chart.
 * GITX-201: Each team as a separate colored line.
 */
export function generateOrgLocByTeamChartScript(): string {
  return `
      // ======================================================================
      // GITX-201: LOC by Team Line Chart
      // ======================================================================
      var cachedOrgLocByTeamData = [];
      var orgLocTeamVisibility = {};
      var sortedOrgLocTeams = [];

      /**
       * Render the LOC by Team line chart.
       * GITX-201: Each team as a separate colored line.
       */
      function renderOrgLocByTeamChart(data) {
        hideSkeleton('orgLocByTeamSkeleton');
        cachedOrgLocByTeamData = data;

        var container = document.getElementById('orgLocByTeamChart');
        var emptyMsg = document.getElementById('orgLocByTeamEmpty');

        if (!data || data.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        // Check if all values are zero
        var hasNonZero = data.some(function(d) { return d.linesAdded > 0; });
        if (!hasNonZero) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        container.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        container.innerHTML = '';

        // Build sorted team list
        var teamSet = new Set();
        data.forEach(function(d) { teamSet.add(d.teamName); });
        sortedOrgLocTeams = Array.from(teamSet).sort();

        // Initialize visibility
        sortedOrgLocTeams.forEach(function(t) {
          if (orgLocTeamVisibility[t] === undefined) {
            orgLocTeamVisibility[t] = true;
          }
        });

        // Get unique weeks
        var weeks = Array.from(new Set(data.map(function(d) { return d.weekStart; }))).sort();

        // Build line data per team with null for zero values (creates gaps)
        var teamData = sortedOrgLocTeams.map(function(team) {
          return {
            team: team,
            values: weeks.map(function(week) {
              var point = data.find(function(d) { return d.weekStart === week && d.teamName === team; });
              var linesAdded = point ? point.linesAdded : 0;
              return {
                week: week,
                value: linesAdded > 0 && orgLocTeamVisibility[team] ? linesAdded : null
              };
            })
          };
        });

        // Chart dimensions
        var margin = { top: 30, right: 150, bottom: 60, left: 60 };
        var width = container.clientWidth - margin.left - margin.right;
        var height = 300 - margin.top - margin.bottom;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // X scale
        var x = d3.scaleBand()
          .domain(weeks)
          .range([0, width])
          .padding(0.1);

        // Y scale
        var visibleData = data.filter(function(d) { return orgLocTeamVisibility[d.teamName]; });
        var maxY = d3.max(visibleData, function(d) { return d.linesAdded; }) || 100;
        var y = d3.scaleLinear()
          .domain([0, maxY])
          .nice()
          .range([height, 0]);

        // Color function using the same palette
        function getTeamColor(teamName) {
          var idx = sortedOrgLocTeams.indexOf(teamName);
          if (idx === -1 || idx >= ORG_MAX_LEGEND_TEAMS) {
            return ORG_VELOCITY_TEAM_COLORS[11];
          }
          return ORG_VELOCITY_TEAM_COLORS[idx % (ORG_VELOCITY_TEAM_COLORS.length - 1)];
        }

        // Line generator with .defined() for zero-value filtering
        var line = d3.line()
          .defined(function(d) { return d.value !== null; })
          .x(function(d) { return x(d.week) + x.bandwidth() / 2; })
          .y(function(d) { return y(d.value); })
          .curve(d3.curveMonotoneX);

        // Draw lines for each team
        teamData.forEach(function(td) {
          if (!orgLocTeamVisibility[td.team]) return;

          svg.append('path')
            .datum(td.values)
            .attr('fill', 'none')
            .attr('stroke', getTeamColor(td.team))
            .attr('stroke-width', 2)
            .attr('d', line);

          // Add data points at non-zero values
          svg.selectAll('.point-' + td.team.replace(/[^a-zA-Z0-9]/g, '-'))
            .data(td.values.filter(function(d) { return d.value !== null; }))
            .enter()
            .append('circle')
            .attr('class', 'point')
            .attr('cx', function(d) { return x(d.week) + x.bandwidth() / 2; })
            .attr('cy', function(d) { return y(d.value); })
            .attr('r', 4)
            .attr('fill', getTeamColor(td.team))
            .attr('tabindex', 0)
            .attr('role', 'img')
            .attr('aria-label', function(d) {
              return td.team + ': ' + formatNumber(d.value) + ' lines for ' + d.week;
            })
            .on('mouseenter', function(event, d) {
              showLocTooltip(event, td.team, d.week, d.value);
            })
            .on('mousemove', function(event) {
              moveLocTooltip(event);
            })
            .on('mouseleave', function() {
              hideLocTooltip();
            })
            .on('focus', function(event, d) {
              var rect = this.getBoundingClientRect();
              var syntheticEvent = { pageX: rect.left + rect.width / 2, pageY: rect.top };
              showLocTooltip(syntheticEvent, td.team, d.week, d.value);
            })
            .on('blur', function() {
              hideLocTooltip();
            });
        });

        // X axis
        svg.append('g')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickFormat(function(d) {
            return formatXAxisDate(d);
          }))
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        // Y axis
        svg.append('g')
          .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.2s')));

        // Y axis label
        svg.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -margin.left + 15)
          .attr('x', -height / 2)
          .attr('text-anchor', 'middle')
          .style('fill', 'var(--vscode-foreground)')
          .text('Lines Added');

        // Interactive Legend
        var legend = svg.append('g')
          .attr('transform', 'translate(' + (width + 10) + ',0)');

        sortedOrgLocTeams.slice(0, ORG_MAX_LEGEND_TEAMS).forEach(function(team, i) {
          var isHidden = !orgLocTeamVisibility[team];
          var g = legend.append('g')
            .attr('transform', 'translate(0,' + (i * 20) + ')')
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'checkbox')
            .attr('aria-checked', !isHidden)
            .attr('aria-label', 'Toggle ' + team + ' visibility')
            .style('opacity', isHidden ? 0.4 : 1);

          g.append('rect')
            .attr('width', 12)
            .attr('height', 12)
            .attr('fill', isHidden ? 'transparent' : getTeamColor(team))
            .attr('stroke', getTeamColor(team))
            .attr('stroke-width', 2);

          g.append('text')
            .attr('x', 16)
            .attr('y', 10)
            .style('fill', 'var(--vscode-foreground)')
            .style('font-size', '11px')
            .text(team.length > 15 ? team.slice(0, 12) + '...' : team)
            .append('title').text(team);

          g.on('click', function() {
            orgLocTeamVisibility[team] = !orgLocTeamVisibility[team];
            renderOrgLocByTeamChart(cachedOrgLocByTeamData);
          });
          g.on('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              orgLocTeamVisibility[team] = !orgLocTeamVisibility[team];
              renderOrgLocByTeamChart(cachedOrgLocByTeamData);
            }
          });
        });

        // "Other Teams" legend item if needed
        if (sortedOrgLocTeams.length > ORG_MAX_LEGEND_TEAMS) {
          var otherG = legend.append('g')
            .attr('transform', 'translate(0,' + (ORG_MAX_LEGEND_TEAMS * 20) + ')');
          otherG.append('rect')
            .attr('width', 12)
            .attr('height', 12)
            .attr('fill', ORG_VELOCITY_TEAM_COLORS[11]);
          otherG.append('text')
            .attr('x', 16)
            .attr('y', 10)
            .style('fill', 'var(--vscode-foreground)')
            .style('font-size', '11px')
            .text('Other Teams (' + (sortedOrgLocTeams.length - ORG_MAX_LEGEND_TEAMS) + ')');
        }
      }
`;
}
