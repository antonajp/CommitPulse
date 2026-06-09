/**
 * D3.js velocity chart rendering functions for the Developer Profile Dashboard.
 * Contains inline JavaScript code for rendering the dual-axis velocity vs LOC chart.
 * Extracted from dev-profile-charts.ts to keep files under 600 lines.
 * Ticket: GITX-157
 */

/**
 * Generate the JavaScript code for the GITX-157 velocity chart and lazy loading.
 */
export function generateVelocityChartScript(): string {
  return `
      // ======================================================================
      // GITX-157: Sprint Velocity vs LOC Dual-Axis Chart
      // ======================================================================
      // NOTE: cachedVelocityData and velocityDataAvailable are declared in the parent scope
      // (dev-profile-html.ts) to avoid duplicate declaration errors (GITX-161)

      function renderVelocityChart(data) {
        hideSkeleton('velocitySkeleton');
        cachedVelocityData = data;

        if (!data || data.length === 0 || !velocityDataAvailable) {
          document.getElementById('velocityChart').classList.add('hidden');
          document.getElementById('velocityEmpty').classList.remove('hidden');
          document.getElementById('velocityHint').classList.add('hidden');
          return;
        }

        document.getElementById('velocityChart').classList.remove('hidden');
        document.getElementById('velocityEmpty').classList.add('hidden');
        document.getElementById('velocityHint').classList.remove('hidden');

        var container = document.getElementById('velocityChart');
        container.innerHTML = '';
        var margin = { top: 30, right: 60, bottom: 60, left: 60 };
        var width = container.clientWidth - margin.left - margin.right;
        var height = 320 - margin.top - margin.bottom;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // X scale - weeks
        var x = d3.scaleBand()
          .domain(data.map(function(d) { return d.weekStart; }))
          .range([0, width])
          .padding(0.2);

        // Y scale left - story points
        var maxSP = d3.max(data, function(d) { return d.storyPoints; }) || 10;
        var yLeft = d3.scaleLinear()
          .domain([0, maxSP])
          .nice()
          .range([height, 0]);

        // Y scale right - lines of code
        var maxLoc = d3.max(data, function(d) { return d.linesOfCode; }) || 1000;
        var yRight = d3.scaleLinear()
          .domain([0, maxLoc])
          .nice()
          .range([height, 0]);

        // Draw bars for story points (left axis)
        svg.selectAll('.bar-sp')
          .data(data)
          .enter()
          .append('rect')
          .attr('class', 'bar-sp')
          .attr('x', function(d) { return x(d.weekStart); })
          .attr('y', function(d) { return yLeft(d.storyPoints); })
          .attr('width', x.bandwidth() / 2)
          .attr('height', function(d) { return height - yLeft(d.storyPoints); })
          .attr('fill', CHART_COLORS[0])
          .attr('tabindex', 0)
          .attr('role', 'img')
          .attr('aria-label', function(d) {
            return 'Week ' + d.weekStart + ': ' + d.storyPoints + ' story points, ' + d.issueCount + ' issues';
          })
          .append('title')
          .text(function(d) {
            return d.weekStart + '\\nStory Points: ' + d.storyPoints + '\\nIssues: ' + d.issueCount;
          });

        // Draw LOC line (right axis)
        var line = d3.line()
          .x(function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
          .y(function(d) { return yRight(d.linesOfCode); })
          .curve(d3.curveMonotoneX);

        svg.append('path')
          .datum(data)
          .attr('fill', 'none')
          .attr('stroke', CHART_COLORS[1])
          .attr('stroke-width', 2.5)
          .attr('d', line);

        // Draw LOC data points
        svg.selectAll('.point-loc')
          .data(data)
          .enter()
          .append('circle')
          .attr('class', 'point-loc')
          .attr('cx', function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
          .attr('cy', function(d) { return yRight(d.linesOfCode); })
          .attr('r', 5)
          .attr('fill', CHART_COLORS[1])
          .attr('stroke', 'var(--vscode-editor-background)')
          .attr('stroke-width', 2)
          .attr('tabindex', 0)
          .attr('role', 'img')
          .attr('aria-label', function(d) {
            return 'Week ' + d.weekStart + ': ' + formatNumber(d.linesOfCode) + ' lines of code, ' + d.commitCount + ' commits';
          })
          .append('title')
          .text(function(d) {
            return d.weekStart + '\\nLOC: ' + formatNumber(d.linesOfCode) + '\\nCommits: ' + d.commitCount;
          });

        // X axis
        svg.append('g')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickFormat(function(d) { return d.slice(5); }))
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        // Y axis left (story points)
        svg.append('g')
          .call(d3.axisLeft(yLeft).ticks(5))
          .append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -margin.left + 15)
          .attr('x', -height / 2)
          .attr('text-anchor', 'middle')
          .style('fill', CHART_COLORS[0])
          .style('font-weight', '600')
          .text('Story Points');

        // Y axis right (lines of code)
        svg.append('g')
          .attr('transform', 'translate(' + width + ',0)')
          .call(d3.axisRight(yRight).ticks(5).tickFormat(d3.format('.2s')))
          .append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', margin.right - 15)
          .attr('x', -height / 2)
          .attr('text-anchor', 'middle')
          .style('fill', CHART_COLORS[1])
          .style('font-weight', '600')
          .text('Lines of Code');

        // Legend
        var legend = svg.append('g')
          .attr('transform', 'translate(' + (width / 2 - 80) + ',-15)');

        legend.append('rect').attr('width', 12).attr('height', 12).attr('fill', CHART_COLORS[0]);
        legend.append('text').attr('x', 16).attr('y', 10).style('fill', 'var(--vscode-foreground)').style('font-size', '11px').text('Story Points');

        legend.append('rect').attr('x', 100).attr('width', 12).attr('height', 12).attr('fill', CHART_COLORS[1]);
        legend.append('text').attr('x', 116).attr('y', 10).style('fill', 'var(--vscode-foreground)').style('font-size', '11px').text('Lines of Code');
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
