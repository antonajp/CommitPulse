/**
 * D3.js test debt chart rendering functions for the Developer Profile Dashboard.
 * Contains inline JavaScript code for rendering the test debt stacked bar chart.
 * Extracted from dev-profile-charts.ts to keep files under 600 lines.
 * Ticket: GITX-172
 */

/**
 * Generate the JavaScript code for the GITX-172 Test Debt chart.
 */
export function generateTestDebtChartScript(): string {
  return `
      // ======================================================================
      // GITX-172: Test Debt Risk Analysis Stacked Bar Chart
      // ======================================================================
      // NOTE: cachedTestDebtMetrics is declared in the parent scope
      // (dev-profile-html.ts) to avoid duplicate declaration errors

      // Test Debt tier colors (colorblind-safe)
      var TEST_DEBT_COLORS = {
        low: '#dc2626',    // Red - high risk
        medium: '#ca8a04', // Yellow/Amber - moderate risk
        high: '#16a34a'    // Green - low risk
      };

      function renderTestDebtChart(data) {
        hideSkeleton('testDebtSkeleton');
        cachedTestDebtMetrics = data;

        var weeklyData = data.weeklyData || [];
        var totalCommits = data.totalCommits || 0;
        var lowTestCommits = data.lowTestCommits || 0;
        var roiMultiplier = data.roiMultiplier || 0;
        var teamAvgRoi = data.teamAvgRoiMultiplier;

        // Empty state: no data
        if (!weeklyData || weeklyData.length === 0 || totalCommits === 0) {
          document.getElementById('testDebtChart').classList.add('hidden');
          document.getElementById('testDebtMetrics').classList.add('hidden');
          document.getElementById('testDebtSuccess').classList.add('hidden');
          document.getElementById('testDebtEmpty').classList.remove('hidden');
          return;
        }

        // Success state: all commits have good coverage (no low-test commits)
        if (lowTestCommits === 0) {
          document.getElementById('testDebtChart').classList.add('hidden');
          document.getElementById('testDebtMetrics').classList.add('hidden');
          document.getElementById('testDebtEmpty').classList.add('hidden');
          document.getElementById('testDebtSuccess').classList.remove('hidden');
          return;
        }

        // Normal state: show chart and metrics
        document.getElementById('testDebtChart').classList.remove('hidden');
        document.getElementById('testDebtMetrics').classList.remove('hidden');
        document.getElementById('testDebtEmpty').classList.add('hidden');
        document.getElementById('testDebtSuccess').classList.add('hidden');

        // Update ROI metrics
        document.getElementById('roiMultiplier').textContent = roiMultiplier.toFixed(1);
        document.getElementById('roiValue').textContent = roiMultiplier.toFixed(1) + 'x';
        document.getElementById('lowTestCount').textContent = formatNumber(lowTestCommits);
        document.getElementById('totalTestCommits').textContent = formatNumber(totalCommits);

        // Team comparison
        var comparisonEl = document.getElementById('testDebtComparison');
        if (teamAvgRoi !== null && teamAvgRoi > 0) {
          document.getElementById('teamAvgRoi').textContent = teamAvgRoi.toFixed(1);
          comparisonEl.classList.remove('hidden');
        } else {
          comparisonEl.classList.add('hidden');
        }

        // Render stacked bar chart
        var container = document.getElementById('testDebtChart');
        container.innerHTML = '';
        var margin = { top: 20, right: 120, bottom: 60, left: 50 };
        var width = container.clientWidth - margin.left - margin.right;
        var height = 280 - margin.top - margin.bottom;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var weeks = weeklyData.map(function(d) { return d.weekStart; });
        var tiers = ['lowTestCommits', 'mediumTestCommits', 'highTestCommits'];
        var tierLabels = { lowTestCommits: 'Low', mediumTestCommits: 'Medium', highTestCommits: 'High' };
        var tierColors = { lowTestCommits: TEST_DEBT_COLORS.low, mediumTestCommits: TEST_DEBT_COLORS.medium, highTestCommits: TEST_DEBT_COLORS.high };

        // X scale
        var x = d3.scaleBand()
          .domain(weeks)
          .range([0, width])
          .padding(0.2);

        // Y scale
        var maxY = d3.max(weeklyData, function(d) {
          return d.lowTestCommits + d.mediumTestCommits + d.highTestCommits;
        });
        var y = d3.scaleLinear()
          .domain([0, maxY || 10])
          .nice()
          .range([height, 0]);

        // Stack generator
        var stack = d3.stack()
          .keys(tiers)
          .order(d3.stackOrderNone)
          .offset(d3.stackOffsetNone);

        var series = stack(weeklyData);

        // Draw stacked bars
        svg.selectAll('.serie')
          .data(series)
          .enter()
          .append('g')
          .attr('class', 'serie')
          .attr('fill', function(d) { return tierColors[d.key]; })
          .selectAll('rect')
          .data(function(d) { return d.map(function(point) { return { ...point, key: d.key }; }); })
          .enter()
          .append('rect')
          .attr('x', function(d) { return x(d.data.weekStart); })
          .attr('y', function(d) { return y(d[1]); })
          .attr('height', function(d) { return y(d[0]) - y(d[1]); })
          .attr('width', x.bandwidth())
          .attr('tabindex', '0')
          .attr('role', 'img')
          .attr('aria-label', function(d) {
            var count = d[1] - d[0];
            return tierLabels[d.key] + ' test: ' + count + ' commits for week ' + d.data.weekStart;
          })
          .append('title')
          .text(function(d) {
            var count = d[1] - d[0];
            return d.data.weekStart + '\\n' + tierLabels[d.key] + ' test: ' + count + ' commits';
          });

        // X axis
        svg.append('g')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickFormat(function(d) {
            return d.slice(5); // MM-DD
          }))
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        // Y axis
        svg.append('g')
          .call(d3.axisLeft(y).ticks(5));

        // Y axis label
        svg.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -margin.left + 15)
          .attr('x', -height / 2)
          .attr('text-anchor', 'middle')
          .style('fill', 'var(--vscode-foreground)')
          .text('Commits');

        // Legend
        var legend = svg.append('g')
          .attr('transform', 'translate(' + (width + 10) + ',0)');

        var legendItems = [
          { key: 'lowTestCommits', label: 'Low (<10%)', color: TEST_DEBT_COLORS.low },
          { key: 'mediumTestCommits', label: 'Medium (10-50%)', color: TEST_DEBT_COLORS.medium },
          { key: 'highTestCommits', label: 'High (>50%)', color: TEST_DEBT_COLORS.high }
        ];

        legendItems.forEach(function(item, i) {
          var g = legend.append('g')
            .attr('transform', 'translate(0,' + (i * 22) + ')');
          g.append('rect')
            .attr('width', 14)
            .attr('height', 14)
            .attr('fill', item.color)
            .attr('rx', 2);
          g.append('text')
            .attr('x', 18)
            .attr('y', 11)
            .style('fill', 'var(--vscode-foreground)')
            .style('font-size', '11px')
            .text(item.label);
        });
      }
`;
}
