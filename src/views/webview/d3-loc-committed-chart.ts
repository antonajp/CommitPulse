/**
 * D3.js horizontal stacked bar chart renderer for the LOC Committed chart.
 * Renders groups (repos/teams/engineers) on the Y-axis and LOC values on
 * the X-axis, with bar segments colored by architecture component.
 *
 * Extracted from d3-chart-scripts.ts to respect the 600-line file limit.
 *
 * Ticket: IQS-889
 */

/**
 * Generate the JavaScript source for the LOC Committed horizontal stacked bar
 * chart renderer. Renders groups on the Y-axis, LOC on the X-axis, with
 * bar segments colored by arc_component.
 *
 * Depends on: d3, CHART_COLORS, chartDefaults, escapeHtml, showTooltip,
 * moveTooltip, hideTooltip, LOC_DEFAULT_TOP_N (all from d3-chart-scripts.ts).
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateLocCommittedChartScript(): string {
  return `
      // ======================================================================
      // LOC Committed Horizontal Stacked Bar Chart (D3.js) (IQS-889)
      // ======================================================================
      function renderLocCommittedHorizontalStackedBar(dataPoints, metric, topN) {
        var container = document.getElementById('locCommittedChart');
        var emptyMsg = document.getElementById('locCommittedEmpty');
        var expansion = document.getElementById('locExpansion');
        if (!dataPoints || dataPoints.length === 0) {
          container.style.display = 'none';
          if (emptyMsg) { emptyMsg.style.display = 'block'; }
          if (expansion) { expansion.style.display = 'none'; }
          return;
        }
        container.style.display = 'block';
        if (emptyMsg) { emptyMsg.style.display = 'none'; }
        container.innerHTML = '';

        // Aggregate by groupKey: build map of group -> component -> metric value
        var groupMap = {};
        var components = []; var compSet = {};
        dataPoints.forEach(function(d) {
          if (!groupMap[d.groupKey]) { groupMap[d.groupKey] = {}; }
          groupMap[d.groupKey][d.arcComponent] = d[metric] || 0;
          if (!compSet[d.arcComponent]) { compSet[d.arcComponent] = true; components.push(d.arcComponent); }
        });

        // Sort groups by total metric value descending
        var groups = Object.keys(groupMap).sort(function(a, b) {
          var totalA = Object.values(groupMap[a]).reduce(function(s, v) { return s + Math.abs(v); }, 0);
          var totalB = Object.values(groupMap[b]).reduce(function(s, v) { return s + Math.abs(v); }, 0);
          return totalB - totalA;
        });

        var totalGroups = groups.length;
        if (topN > 0 && groups.length > topN) { groups = groups.slice(0, topN); }
        if (expansion) { expansion.style.display = totalGroups > LOC_DEFAULT_TOP_N ? 'block' : 'none'; }

        // Use absolute values for stacking (net lines can be negative)
        var stackData = groups.map(function(group) {
          var entry = { group: group };
          components.forEach(function(comp) { entry[comp] = Math.abs(groupMap[group][comp] || 0); });
          return entry;
        });

        var barHeight = 22;
        var maxLabelLen = groups.reduce(function(m, g) { return Math.max(m, g.length); }, 0);
        var margin = { top: 30, right: 20, bottom: 40, left: Math.min(180, Math.max(100, maxLabelLen * 7)) };
        var width = Math.max(400, container.clientWidth) - margin.left - margin.right;
        var height = Math.max(120, groups.length * (barHeight + 4)) + 10;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom);
        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var y = d3.scaleBand().domain(groups).range([0, height]).padding(0.15);
        var color = d3.scaleOrdinal().domain(components).range(CHART_COLORS);
        var stack = d3.stack().keys(components);
        var series = stack(stackData);
        var maxVal = d3.max(series, function(s) { return d3.max(s, function(d) { return d[1]; }); }) || 1;
        var x = d3.scaleLinear().domain([0, maxVal]).nice().range([0, width]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisBottom(x).tickSize(height).tickFormat(''))
          .selectAll('line').attr('stroke', chartDefaults.borderColor + '33').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        var metricLabels = { linesAdded: 'Lines Added', netLines: 'Net Lines', totalChurn: 'Total Churn' };

        // Render stacked horizontal bars
        series.forEach(function(compSeries) {
          g.selectAll('.hbar-' + compSeries.key.replace(/[^a-zA-Z0-9]/g, '_'))
            .data(compSeries).enter().append('rect')
            .attr('y', function(d) { return y(d.data.group); })
            .attr('x', function(d) { return x(d[0]); })
            .attr('height', y.bandwidth())
            .attr('width', function(d) { return Math.max(0, x(d[1]) - x(d[0])); })
            .attr('fill', color(compSeries.key) + '88')
            .attr('stroke', color(compSeries.key)).attr('stroke-width', 1)
            .attr('aria-label', function(d) {
              return escapeHtml(compSeries.key) + ' / ' + escapeHtml(d.data.group) + ': ' + (d[1] - d[0]).toLocaleString();
            })
            .on('mouseover', function(event, d) {
              showTooltip(event, '<strong>' + escapeHtml(compSeries.key) + '</strong><br>' + escapeHtml(d.data.group) + '<br>' + (d[1] - d[0]).toLocaleString() + ' ' + (metricLabels[metric] || metric));
            })
            .on('mousemove', moveTooltip)
            .on('mouseout', hideTooltip);
        });

        // Y axis (group labels, truncated for long names)
        g.append('g').call(d3.axisLeft(y))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px')
          .each(function() {
            var t = d3.select(this); var txt = t.text();
            if (txt.length > 24) { t.text(txt.slice(0, 22) + '...'); }
          });

        // X axis (LOC values with k suffix for thousands)
        g.append('g').attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).ticks(6).tickFormat(function(d) {
            return d >= 1000 ? (d / 1000).toFixed(0) + 'k' : d;
          }))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px');

        // Chart title
        svg.append('text').attr('x', margin.left + width / 2).attr('y', 16)
          .attr('text-anchor', 'middle').attr('fill', chartDefaults.color)
          .attr('font-size', '12px').attr('font-weight', '600')
          .text('LOC Committed by Architecture Component (' + (metricLabels[metric] || metric) + ')');

        // Legend
        var legendY = height + margin.top + 24;
        var legendG = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + legendY + ')');
        var xOff = 0;
        components.forEach(function(comp) {
          var lg = legendG.append('g').attr('transform', 'translate(' + xOff + ',0)');
          lg.append('rect').attr('width', 10).attr('height', 10).attr('fill', color(comp));
          lg.append('text').attr('x', 13).attr('y', 9).attr('fill', chartDefaults.color).attr('font-size', '10px').text(comp);
          xOff += Math.min(comp.length * 7 + 22, 140);
        });
      }
  `;
}
