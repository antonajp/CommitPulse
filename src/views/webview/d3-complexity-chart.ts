/**
 * D3.js horizontal stacked bar chart renderer for the Top Complex Files chart.
 * Renders files on the Y-axis (sorted by complexity descending) and LOC on
 * the X-axis, with bar segments colored by contributor or team.
 *
 * Extracted to a separate file to respect the 600-line file limit.
 *
 * Ticket: IQS-894
 */

/**
 * Generate the JavaScript source for the Top Complex Files horizontal stacked
 * bar chart renderer. Renders files on Y-axis, LOC on X-axis, with bar segments
 * colored by contributor/team.
 *
 * Depends on: d3, CHART_COLORS, chartDefaults, escapeHtml, showTooltip,
 * moveTooltip, hideTooltip (all from d3-chart-scripts.ts).
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateTopComplexFilesChartScript(): string {
  return `
      // ======================================================================
      // Top Complex Files Horizontal Stacked Bar Chart (D3.js) (IQS-894)
      // ======================================================================

      /**
       * Extend color palette with HSL generation for many contributors.
       * Used when contributor count exceeds the base CHART_COLORS array.
       */
      function getExtendedColor(index, total) {
        if (index < CHART_COLORS.length) {
          return CHART_COLORS[index];
        }
        // Generate additional colors using HSL with varying hue
        var hue = (index * 137.508) % 360; // Golden angle approximation
        return 'hsl(' + hue + ', 65%, 55%)';
      }

      /**
       * Truncate file path for Y-axis display.
       * Shows only the last N characters with ellipsis if needed.
       */
      function truncateFilePath(path, maxLen) {
        if (!path || path.length <= maxLen) { return path || ''; }
        return '...' + path.slice(-(maxLen - 3));
      }

      /**
       * Render the Top Complex Files horizontal stacked bar chart.
       *
       * @param dataPoints - Array of TopComplexFilePoint objects
       * @param groupBy - 'team' or 'individual'
       */
      function renderTopComplexFilesChart(dataPoints, groupBy) {
        var container = document.getElementById('complexityChart');
        var emptyMsg = document.getElementById('complexityEmpty');
        if (!dataPoints || dataPoints.length === 0) {
          container.style.display = 'none';
          if (emptyMsg) { emptyMsg.style.display = 'block'; }
          return;
        }
        container.style.display = 'block';
        if (emptyMsg) { emptyMsg.style.display = 'none'; }
        container.innerHTML = '';

        // Build file -> contributor -> LOC mapping
        var fileMap = {};
        var contributors = [];
        var contributorSet = {};
        var fileOrder = [];
        var fileOrderSet = {};

        dataPoints.forEach(function(d) {
          // Track file order (first occurrence determines position)
          if (!fileOrderSet[d.filename]) {
            fileOrderSet[d.filename] = true;
            fileOrder.push({ filename: d.filename, complexity: d.complexity });
          }
          // Build contributor mapping
          if (!fileMap[d.filename]) {
            fileMap[d.filename] = { complexity: d.complexity };
          }
          fileMap[d.filename][d.contributor] = d.loc;
          // Track unique contributors
          if (!contributorSet[d.contributor]) {
            contributorSet[d.contributor] = true;
            contributors.push(d.contributor);
          }
        });

        // Sort contributors by total LOC descending for legend/color consistency
        contributors.sort(function(a, b) {
          var totalA = Object.keys(fileMap).reduce(function(sum, f) {
            return sum + (fileMap[f][a] || 0);
          }, 0);
          var totalB = Object.keys(fileMap).reduce(function(sum, f) {
            return sum + (fileMap[f][b] || 0);
          }, 0);
          return totalB - totalA;
        });

        // Files are already in complexity-descending order from server
        var files = fileOrder.map(function(f) { return f.filename; });

        // Build stack data
        var stackData = files.map(function(filename) {
          var entry = { filename: filename, complexity: fileMap[filename].complexity };
          contributors.forEach(function(c) {
            entry[c] = fileMap[filename][c] || 0;
          });
          return entry;
        });

        // Dynamic chart dimensions
        var barHeight = 20;
        var maxLabelLen = Math.min(40, files.reduce(function(m, f) { return Math.max(m, f.length); }, 0));
        var margin = { top: 40, right: 150, bottom: 60, left: Math.min(220, Math.max(140, maxLabelLen * 5.5)) };
        var width = Math.max(500, container.clientWidth) - margin.left - margin.right;
        var height = Math.max(200, files.length * (barHeight + 4)) + 20;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom);
        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var y = d3.scaleBand().domain(files).range([0, height]).padding(0.12);
        var color = d3.scaleOrdinal().domain(contributors).range(contributors.map(function(_, i) {
          return getExtendedColor(i, contributors.length);
        }));

        var stack = d3.stack().keys(contributors);
        var series = stack(stackData);
        var maxVal = d3.max(series, function(s) { return d3.max(s, function(d) { return d[1]; }); }) || 1;
        var x = d3.scaleLinear().domain([0, maxVal]).nice().range([0, width]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisBottom(x).tickSize(height).tickFormat(''))
          .selectAll('line').attr('stroke', chartDefaults.borderColor + '33').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // Render stacked horizontal bars
        series.forEach(function(contribSeries) {
          g.selectAll('.hbar-' + contribSeries.key.replace(/[^a-zA-Z0-9]/g, '_'))
            .data(contribSeries).enter().append('rect')
            .attr('y', function(d) { return y(d.data.filename); })
            .attr('x', function(d) { return x(d[0]); })
            .attr('height', y.bandwidth())
            .attr('width', function(d) { return Math.max(0, x(d[1]) - x(d[0])); })
            .attr('fill', color(contribSeries.key) + '88')
            .attr('stroke', color(contribSeries.key)).attr('stroke-width', 1)
            .attr('aria-label', function(d) {
              var loc = d[1] - d[0];
              var pct = maxVal > 0 ? ((loc / maxVal) * 100).toFixed(1) : '0';
              return escapeHtml(contribSeries.key) + ' / ' + truncateFilePath(d.data.filename, 30) + ': ' + loc.toLocaleString() + ' LOC (' + pct + '%)';
            })
            .on('mouseover', function(event, d) {
              var loc = d[1] - d[0];
              var pct = maxVal > 0 ? ((loc / maxVal) * 100).toFixed(1) : '0';
              showTooltip(event,
                '<strong>' + escapeHtml(contribSeries.key) + '</strong><br>' +
                escapeHtml(truncateFilePath(d.data.filename, 40)) + '<br>' +
                loc.toLocaleString() + ' LOC (' + pct + '%)<br>' +
                '<small>Complexity: ' + d.data.complexity.toLocaleString() + '</small>'
              );
            })
            .on('mousemove', moveTooltip)
            .on('mouseout', hideTooltip);
        });

        // Y axis (file names, truncated)
        g.append('g').call(d3.axisLeft(y))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px')
          .each(function() {
            var t = d3.select(this);
            var txt = t.text();
            t.text(truncateFilePath(txt, 35));
          })
          .append('title').text(function(d) { return d; }); // Full path on hover

        // X axis (LOC values with k suffix)
        g.append('g').attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).ticks(6).tickFormat(function(d) {
            return d >= 1000 ? (d / 1000).toFixed(0) + 'k' : d;
          }))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px');

        // X axis label
        svg.append('text')
          .attr('x', margin.left + width / 2)
          .attr('y', height + margin.top + 40)
          .attr('text-anchor', 'middle')
          .attr('fill', chartDefaults.color)
          .attr('font-size', '11px')
          .text('Lines of Code Contributed');

        // Chart title
        var titleText = groupBy === 'team' ? 'Top Complex Files by Team' : 'Top Complex Files by Contributor';
        svg.append('text').attr('x', margin.left + width / 2).attr('y', 20)
          .attr('text-anchor', 'middle').attr('fill', chartDefaults.color)
          .attr('font-size', '13px').attr('font-weight', '600')
          .text(titleText);

        // Legend (right side, scrollable area if many contributors)
        var legendX = margin.left + width + 10;
        var legendY = margin.top;
        var legendG = svg.append('g').attr('transform', 'translate(' + legendX + ',' + legendY + ')');

        // Only show top 12 contributors in legend to avoid overflow
        var displayContributors = contributors.slice(0, 12);
        var totalLoc = contributors.reduce(function(sum, c) {
          return sum + Object.keys(fileMap).reduce(function(s, f) { return s + (fileMap[f][c] || 0); }, 0);
        }, 0);

        displayContributors.forEach(function(contrib, i) {
          var contribLoc = Object.keys(fileMap).reduce(function(s, f) { return s + (fileMap[f][contrib] || 0); }, 0);
          var pct = totalLoc > 0 ? ((contribLoc / totalLoc) * 100).toFixed(0) : '0';
          var lg = legendG.append('g').attr('transform', 'translate(0,' + (i * 18) + ')');
          lg.append('rect').attr('width', 10).attr('height', 10).attr('fill', color(contrib));
          lg.append('text').attr('x', 13).attr('y', 9).attr('fill', chartDefaults.color).attr('font-size', '10px')
            .text(contrib.length > 15 ? contrib.slice(0, 14) + '...' : contrib)
            .append('title').text(contrib + ': ' + contribLoc.toLocaleString() + ' LOC (' + pct + '%)');
        });

        // Show "and X more..." if there are additional contributors
        if (contributors.length > 12) {
          var moreCount = contributors.length - 12;
          legendG.append('text')
            .attr('x', 0).attr('y', displayContributors.length * 18 + 12)
            .attr('fill', chartDefaults.color).attr('font-size', '10px').attr('font-style', 'italic')
            .text('and ' + moreCount + ' more...');
        }
      }
  `;
}
