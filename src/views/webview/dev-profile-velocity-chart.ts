/**
 * D3.js velocity chart rendering functions for the Developer Profile Dashboard.
 * Contains inline JavaScript code for rendering the dual-axis velocity vs LOC chart.
 * Extracted from dev-profile-charts.ts to keep files under 600 lines.
 * Ticket: GITX-157, GITX-199
 */

/**
 * Generate the JavaScript code for the GITX-157/GITX-199 velocity chart and lazy loading.
 * GITX-199: Primary chart showing stacked bars (developer contribution vs team total)
 * with LOC as trend line overlay. Includes proper legend, tooltips, and graceful degradation.
 */
export function generateVelocityChartScript(): string {
  return `
      // ======================================================================
      // GITX-157, GITX-199: Sprint Velocity vs LOC Dual-Axis Chart
      // GITX-199: Primary chart with stacked bars showing developer vs team
      // ======================================================================
      // NOTE: cachedVelocityData and velocityDataAvailable are declared in the parent scope
      // (dev-profile-html.ts) to avoid duplicate declaration errors (GITX-161)

      // GITX-199: Color constants for velocity chart
      var VELOCITY_COLOR_DEV = '#E69F00';      // Okabe-Ito orange - Your Contribution
      var VELOCITY_COLOR_TEAM = '#999999';      // Muted gray - Rest of Team
      var VELOCITY_COLOR_LOC = '#56B4E9';       // Okabe-Ito sky blue - Lines of Code

      function renderVelocityChart(data) {
        hideSkeleton('velocitySkeleton');
        cachedVelocityData = data;

        // GITX-199: Check if there's any story point data (Jira connected)
        var hasStoryPointData = data && data.some(function(d) {
          return d.storyPoints > 0 || d.teamStoryPoints > 0;
        });
        var hasLocData = data && data.some(function(d) {
          return d.linesOfCode > 0;
        });

        // No data at all - show empty state
        if (!data || data.length === 0 || (!hasStoryPointData && !hasLocData)) {
          document.getElementById('velocityChart').classList.add('hidden');
          document.getElementById('velocityEmpty').classList.remove('hidden');
          document.getElementById('velocityHint').classList.add('hidden');
          var noJiraMsg = document.getElementById('velocityNoJira');
          if (noJiraMsg) { noJiraMsg.classList.add('hidden'); }
          return;
        }

        document.getElementById('velocityChart').classList.remove('hidden');
        document.getElementById('velocityEmpty').classList.add('hidden');

        // GITX-199: Show appropriate hint based on data availability
        var hintEl = document.getElementById('velocityHint');
        var noJiraEl = document.getElementById('velocityNoJira');

        if (!hasStoryPointData && hasLocData) {
          // No Jira data - graceful degradation: show LOC only with message
          if (hintEl) { hintEl.classList.add('hidden'); }
          if (noJiraEl) { noJiraEl.classList.remove('hidden'); }
        } else {
          // Has story point data - show full chart with hint
          if (hintEl) { hintEl.classList.remove('hidden'); }
          if (noJiraEl) { noJiraEl.classList.add('hidden'); }
        }

        var container = document.getElementById('velocityChart');
        container.innerHTML = '';
        var margin = { top: 40, right: 70, bottom: 60, left: 60 };
        var width = container.clientWidth - margin.left - margin.right;
        var height = 320 - margin.top - margin.bottom;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // X scale - weeks/months
        var x = d3.scaleBand()
          .domain(data.map(function(d) { return d.weekStart; }))
          .range([0, width])
          .padding(0.2);

        // Y scale left - story points (team total as max)
        var maxTeamSP = d3.max(data, function(d) { return d.teamStoryPoints || d.storyPoints; }) || 10;
        var yLeft = d3.scaleLinear()
          .domain([0, maxTeamSP])
          .nice()
          .range([height, 0]);

        // Y scale right - lines of code
        var maxLoc = d3.max(data, function(d) { return d.linesOfCode; }) || 1000;
        var yRight = d3.scaleLinear()
          .domain([0, maxLoc])
          .nice()
          .range([height, 0]);

        // GITX-199: Draw stacked bars - Rest of Team (bottom/muted) + Your Contribution (top/colored)
        if (hasStoryPointData) {
          // Draw "rest of team" bars first (full height = team total)
          svg.selectAll('.bar-team')
            .data(data)
            .enter()
            .append('rect')
            .attr('class', 'bar-team')
            .attr('x', function(d) { return x(d.weekStart); })
            .attr('y', function(d) { return yLeft(d.teamStoryPoints || 0); })
            .attr('width', x.bandwidth() * 0.6)
            .attr('height', function(d) { return height - yLeft(d.teamStoryPoints || 0); })
            .attr('fill', VELOCITY_COLOR_TEAM)
            .attr('opacity', 0.6);

          // Draw "your contribution" bars on top (stacked from bottom)
          svg.selectAll('.bar-dev')
            .data(data)
            .enter()
            .append('rect')
            .attr('class', 'bar-dev')
            .attr('x', function(d) { return x(d.weekStart); })
            .attr('y', function(d) { return yLeft(d.storyPoints || 0); })
            .attr('width', x.bandwidth() * 0.6)
            .attr('height', function(d) { return height - yLeft(d.storyPoints || 0); })
            .attr('fill', VELOCITY_COLOR_DEV)
            .attr('tabindex', 0)
            .attr('role', 'img')
            .attr('aria-label', function(d) {
              var pct = d.teamStoryPoints > 0 ? Math.round((d.storyPoints / d.teamStoryPoints) * 100) : 0;
              return formatXAxisDate(d.weekStart) + ': ' + d.storyPoints + ' of ' + d.teamStoryPoints + ' story points (' + pct + '% of team)';
            })
            .append('title')
            .text(function(d) {
              var pct = d.teamStoryPoints > 0 ? Math.round((d.storyPoints / d.teamStoryPoints) * 100) : 0;
              return formatXAxisDate(d.weekStart) +
                '\\nYour SP: ' + d.storyPoints +
                '\\nTeam Total: ' + d.teamStoryPoints +
                '\\nYour Share: ' + pct + '%' +
                '\\nIssues: ' + d.issueCount;
            });
        } else {
          // GITX-199: Graceful degradation - show LOC as bars when no Jira data
          svg.selectAll('.bar-loc-fallback')
            .data(data)
            .enter()
            .append('rect')
            .attr('class', 'bar-loc-fallback')
            .attr('x', function(d) { return x(d.weekStart); })
            .attr('y', function(d) { return yRight(d.linesOfCode || 0); })
            .attr('width', x.bandwidth() * 0.6)
            .attr('height', function(d) { return height - yRight(d.linesOfCode || 0); })
            .attr('fill', VELOCITY_COLOR_LOC)
            .attr('opacity', 0.7)
            .attr('tabindex', 0)
            .attr('role', 'img')
            .attr('aria-label', function(d) {
              return formatXAxisDate(d.weekStart) + ': ' + formatNumber(d.linesOfCode) + ' lines of code';
            })
            .append('title')
            .text(function(d) {
              return formatXAxisDate(d.weekStart) +
                '\\nLOC: ' + formatNumber(d.linesOfCode) +
                '\\nCommits: ' + d.commitCount;
            });
        }

        // Draw LOC line (right axis) - only if we have story point data
        if (hasStoryPointData && hasLocData) {
          var line = d3.line()
            .x(function(d) { return x(d.weekStart) + x.bandwidth() * 0.3; })
            .y(function(d) { return yRight(d.linesOfCode); })
            .curve(d3.curveMonotoneX);

          svg.append('path')
            .datum(data)
            .attr('fill', 'none')
            .attr('stroke', VELOCITY_COLOR_LOC)
            .attr('stroke-width', 2.5)
            .attr('d', line);

          // Draw LOC data points
          svg.selectAll('.point-loc')
            .data(data)
            .enter()
            .append('circle')
            .attr('class', 'point-loc')
            .attr('cx', function(d) { return x(d.weekStart) + x.bandwidth() * 0.3; })
            .attr('cy', function(d) { return yRight(d.linesOfCode); })
            .attr('r', 5)
            .attr('fill', VELOCITY_COLOR_LOC)
            .attr('stroke', 'var(--vscode-editor-background)')
            .attr('stroke-width', 2)
            .attr('tabindex', 0)
            .attr('role', 'img')
            .attr('aria-label', function(d) {
              return formatXAxisDate(d.weekStart) + ': ' + formatNumber(d.linesOfCode) + ' lines of code, ' + d.commitCount + ' commits';
            })
            .append('title')
            .text(function(d) {
              return formatXAxisDate(d.weekStart) + '\\nLOC: ' + formatNumber(d.linesOfCode) + '\\nCommits: ' + d.commitCount;
            });
        }

        // X axis - GITX-179: Use formatXAxisDate for dynamic week/month formatting
        svg.append('g')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickFormat(function(d) { return formatXAxisDate(d); }))
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        // Y axis left (story points) - only if we have story point data
        if (hasStoryPointData) {
          svg.append('g')
            .call(d3.axisLeft(yLeft).ticks(5))
            .append('text')
            .attr('transform', 'rotate(-90)')
            .attr('y', -margin.left + 15)
            .attr('x', -height / 2)
            .attr('text-anchor', 'middle')
            .style('fill', VELOCITY_COLOR_DEV)
            .style('font-weight', '600')
            .text('Story Points');

          // Y axis right (lines of code) - only when showing LOC line
          if (hasLocData) {
            svg.append('g')
              .attr('transform', 'translate(' + width + ',0)')
              .call(d3.axisRight(yRight).ticks(5).tickFormat(d3.format('.2s')))
              .append('text')
              .attr('transform', 'rotate(-90)')
              .attr('y', margin.right - 15)
              .attr('x', -height / 2)
              .attr('text-anchor', 'middle')
              .style('fill', VELOCITY_COLOR_LOC)
              .style('font-weight', '600')
              .text('Lines of Code');
          }
        } else {
          // GITX-199: When no story points, show LOC axis on left
          svg.append('g')
            .call(d3.axisLeft(yRight).ticks(5).tickFormat(d3.format('.2s')))
            .append('text')
            .attr('transform', 'rotate(-90)')
            .attr('y', -margin.left + 15)
            .attr('x', -height / 2)
            .attr('text-anchor', 'middle')
            .style('fill', VELOCITY_COLOR_LOC)
            .style('font-weight', '600')
            .text('Lines of Code');
        }

        // GITX-199: Legend with "Your Contribution", "Team Total", "Lines of Code"
        var legend = svg.append('g')
          .attr('transform', 'translate(' + (width / 2 - 140) + ',-25)');

        if (hasStoryPointData) {
          // Full legend with all three items
          legend.append('rect').attr('width', 12).attr('height', 12).attr('fill', VELOCITY_COLOR_DEV);
          legend.append('text').attr('x', 16).attr('y', 10).style('fill', 'var(--vscode-foreground)').style('font-size', '11px').text('Your Contribution');

          legend.append('rect').attr('x', 120).attr('width', 12).attr('height', 12).attr('fill', VELOCITY_COLOR_TEAM).attr('opacity', 0.6);
          legend.append('text').attr('x', 136).attr('y', 10).style('fill', 'var(--vscode-foreground)').style('font-size', '11px').text('Team Total');

          if (hasLocData) {
            legend.append('line').attr('x1', 210).attr('y1', 6).attr('x2', 230).attr('y2', 6).attr('stroke', VELOCITY_COLOR_LOC).attr('stroke-width', 2.5);
            legend.append('circle').attr('cx', 220).attr('cy', 6).attr('r', 4).attr('fill', VELOCITY_COLOR_LOC);
            legend.append('text').attr('x', 236).attr('y', 10).style('fill', 'var(--vscode-foreground)').style('font-size', '11px').text('Lines of Code');
          }
        } else {
          // LOC only legend
          legend.append('rect').attr('width', 12).attr('height', 12).attr('fill', VELOCITY_COLOR_LOC).attr('opacity', 0.7);
          legend.append('text').attr('x', 16).attr('y', 10).style('fill', 'var(--vscode-foreground)').style('font-size', '11px').text('Lines of Code');
        }
      }

      // ======================================================================
      // GITX-157: Intersection Observer for Lazy Loading
      // ======================================================================
      var lazyLoadObserver = null;
      var lazyLoadedCharts = {};

      function initLazyLoading() {
        if (!('IntersectionObserver' in window)) {
          // Fallback: load all charts immediately if IntersectionObserver not supported
          return;
        }

        lazyLoadObserver = new IntersectionObserver(function(entries) {
          entries.forEach(function(entry) {
            if (entry.isIntersecting) {
              var chartId = entry.target.getAttribute('data-chart-id');
              if (chartId && !lazyLoadedCharts[chartId]) {
                lazyLoadedCharts[chartId] = true;
                loadChartOnDemand(chartId);
                lazyLoadObserver.unobserve(entry.target);
              }
            }
          });
        }, { rootMargin: '100px', threshold: 0.1 });

        document.querySelectorAll('.chart-lazy').forEach(function(el) {
          lazyLoadObserver.observe(el);
        });
      }

      function loadChartOnDemand(chartId) {
        // Charts are loaded via requestAllData, this function is for future individual loading
        // For now, it's a placeholder for per-chart lazy loading if needed
      }

      // ======================================================================
      // GITX-157: Keyboard Navigation for Chart Sections
      // ======================================================================
      function initKeyboardNavigation() {
        var chartSections = [
          { key: '1', id: 'summaryCards', label: 'Summary Statistics' },
          { key: '2', id: 'locWeekCard', label: 'LOC per Week' },
          { key: '3', id: 'complexFilesCard', label: 'Complex Files' },
          { key: '4', id: 'frequentFilesCard', label: 'Frequent Files' },
          { key: '5', id: 'velocityCard', label: 'Sprint Velocity' },
          { key: '6', id: 'techStackCard', label: 'Technology Stack' },
          { key: '7', id: 'hygieneCard', label: 'Commit Hygiene' },
          { key: '8', id: 'commentsWeekCard', label: 'Comments per Week' }
        ];

        document.addEventListener('keydown', function(e) {
          // Only handle number keys 1-8 without modifiers
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return; }

          // Don't handle if focus is in an input or select
          var activeTag = document.activeElement.tagName.toLowerCase();
          if (activeTag === 'input' || activeTag === 'select' || activeTag === 'textarea') {
            return;
          }

          var section = chartSections.find(function(s) { return s.key === e.key; });
          if (section) {
            var el = document.getElementById(section.id);
            if (el) {
              e.preventDefault();
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              // Focus the first focusable element in the section
              var focusable = el.querySelector('[tabindex], button, a, input, select, [role="button"], [role="img"]');
              if (focusable) {
                focusable.focus();
              }
              // Announce section to screen readers
              announceToScreenReader('Navigated to ' + section.label);
            }
          }
        });
      }

      function announceToScreenReader(message) {
        var announcement = document.getElementById('sr-announcements');
        if (!announcement) {
          announcement = document.createElement('div');
          announcement.id = 'sr-announcements';
          announcement.setAttribute('role', 'status');
          announcement.setAttribute('aria-live', 'polite');
          announcement.setAttribute('aria-atomic', 'true');
          announcement.className = 'sr-only';
          document.body.appendChild(announcement);
        }
        announcement.textContent = message;
        // Clear after announcement
        setTimeout(function() { announcement.textContent = ''; }, 1000);
      }

      // Initialize keyboard navigation
      initKeyboardNavigation();
`;
}
