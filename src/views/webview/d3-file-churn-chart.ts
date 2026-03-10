/**
 * D3.js horizontal stacked bar chart renderer for the Top Files by Churn chart.
 * Renders files on the Y-axis (sorted by total churn descending) and churn on
 * the X-axis, with bar segments colored by team or contributor.
 *
 * Includes drill-down modal for viewing commits when a bar segment is clicked.
 *
 * Extracted to a separate file to respect the 600-line file limit.
 *
 * Ticket: IQS-895
 */

/**
 * Generate the JavaScript source for the Top Files by Churn horizontal stacked
 * bar chart renderer. Renders files on Y-axis, churn on X-axis, with bar segments
 * colored by team/contributor.
 *
 * Depends on: d3, CHART_COLORS, chartDefaults, escapeHtml, showTooltip,
 * moveTooltip, hideTooltip, vscode (from d3-chart-scripts.ts and webview context).
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateFileChurnChartScript(): string {
  return `
      // ======================================================================
      // Top Files by Churn Horizontal Stacked Bar Chart (D3.js) (IQS-895)
      // ======================================================================

      /**
       * Extend color palette with HSL generation for many contributors.
       * Used when contributor count exceeds the base CHART_COLORS array.
       */
      function getFileChurnExtendedColor(index, total) {
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
      function truncateChurnFilePath(path, maxLen) {
        if (!path || path.length <= maxLen) { return path || ''; }
        return '...' + path.slice(-(maxLen - 3));
      }

      /**
       * Format churn value with k suffix for thousands.
       */
      function formatChurnValue(val) {
        if (val >= 1000) {
          return (val / 1000).toFixed(1) + 'k';
        }
        return val.toString();
      }

      /**
       * Show the drill-down modal with commit details.
       */
      function showFileChurnDrillDown(filename, contributor, commits) {
        var modal = document.getElementById('fileChurnDrillDownModal');
        var title = document.getElementById('fileChurnDrillDownTitle');
        var tbody = document.getElementById('fileChurnDrillDownBody');
        var emptyMsg = document.getElementById('fileChurnDrillDownEmpty');

        if (!modal || !title || !tbody) { return; }

        title.textContent = truncateChurnFilePath(filename, 50) + ' - ' + contributor;

        if (!commits || commits.length === 0) {
          tbody.innerHTML = '';
          if (emptyMsg) { emptyMsg.style.display = 'block'; }
        } else {
          if (emptyMsg) { emptyMsg.style.display = 'none'; }
          tbody.innerHTML = commits.map(function(c) {
            var shortSha = c.sha.slice(0, 7);
            var date = c.commitDate.split('T')[0];
            var msgTrunc = c.message.length > 60 ? c.message.slice(0, 57) + '...' : c.message;
            return '<tr>' +
              '<td class="sha-cell">' + escapeHtml(shortSha) + '</td>' +
              '<td>' + escapeHtml(date) + '</td>' +
              '<td>' + escapeHtml(c.author) + '</td>' +
              '<td class="message-cell" title="' + escapeHtml(c.message) + '">' + escapeHtml(msgTrunc) + '</td>' +
              '<td class="churn-cell">+' + c.linesAdded + ' / -' + c.linesDeleted + '</td>' +
            '</tr>';
          }).join('');
        }

        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
      }

      /**
       * Close the drill-down modal.
       */
      function closeFileChurnDrillDown() {
        var modal = document.getElementById('fileChurnDrillDownModal');
        if (modal) {
          modal.style.display = 'none';
          modal.setAttribute('aria-hidden', 'true');
        }
      }

      /**
       * Render the Top Files by Churn horizontal stacked bar chart.
       *
       * @param dataPoints - Array of FileChurnPoint objects
       * @param groupBy - 'team' or 'individual'
       */
      function renderFileChurnChart(dataPoints, groupBy) {
        var container = document.getElementById('fileChurnChart');
        var emptyMsg = document.getElementById('fileChurnEmpty');
        if (!dataPoints || dataPoints.length === 0) {
          container.style.display = 'none';
          if (emptyMsg) { emptyMsg.style.display = 'block'; }
          return;
        }
        container.style.display = 'block';
        if (emptyMsg) { emptyMsg.style.display = 'none'; }
        container.innerHTML = '';

        // Build file -> contributor -> churn mapping
        var fileMap = {};
        var contributors = [];
        var contributorSet = {};
        var fileOrder = [];
        var fileOrderSet = {};

        dataPoints.forEach(function(d) {
          // Track file order (first occurrence determines position)
          if (!fileOrderSet[d.filename]) {
            fileOrderSet[d.filename] = true;
            fileOrder.push({ filename: d.filename, totalChurn: d.totalChurn });
          }
          // Build contributor mapping
          if (!fileMap[d.filename]) {
            fileMap[d.filename] = { totalChurn: d.totalChurn };
          }
          fileMap[d.filename][d.contributor] = d.churn;
          // Track unique contributors
          if (!contributorSet[d.contributor]) {
            contributorSet[d.contributor] = true;
            contributors.push(d.contributor);
          }
        });

        // Sort contributors by total churn descending for legend/color consistency
        contributors.sort(function(a, b) {
          var totalA = Object.keys(fileMap).reduce(function(sum, f) {
            return sum + (fileMap[f][a] || 0);
          }, 0);
          var totalB = Object.keys(fileMap).reduce(function(sum, f) {
            return sum + (fileMap[f][b] || 0);
          }, 0);
          return totalB - totalA;
        });

        // Files are already in churn-descending order from server
        var files = fileOrder.map(function(f) { return f.filename; });

        // Build stack data
        var stackData = files.map(function(filename) {
          var entry = { filename: filename, totalChurn: fileMap[filename].totalChurn };
          contributors.forEach(function(c) {
            entry[c] = fileMap[filename][c] || 0;
          });
          return entry;
        });

        // Dynamic chart dimensions
        var barHeight = 20;
        var maxLabelLen = Math.min(40, files.reduce(function(m, f) { return Math.max(m, f.length); }, 0));
        var margin = { top: 40, right: 150, bottom: 60, left: Math.min(240, Math.max(140, maxLabelLen * 5.5)) };
        var width = Math.max(500, container.clientWidth) - margin.left - margin.right;
        var height = Math.max(200, files.length * (barHeight + 4)) + 20;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom);
        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var y = d3.scaleBand().domain(files).range([0, height]).padding(0.12);
        var color = d3.scaleOrdinal().domain(contributors).range(contributors.map(function(_, i) {
          return getFileChurnExtendedColor(i, contributors.length);
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
          g.selectAll('.hbar-churn-' + contribSeries.key.replace(/[^a-zA-Z0-9]/g, '_'))
            .data(contribSeries).enter().append('rect')
            .attr('y', function(d) { return y(d.data.filename); })
            .attr('x', function(d) { return x(d[0]); })
            .attr('height', y.bandwidth())
            .attr('width', function(d) { return Math.max(0, x(d[1]) - x(d[0])); })
            .attr('fill', color(contribSeries.key) + '88')
            .attr('stroke', color(contribSeries.key)).attr('stroke-width', 1)
            .attr('class', 'churn-bar-segment')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', function(d) {
              var churn = d[1] - d[0];
              var pct = d.data.totalChurn > 0 ? ((churn / d.data.totalChurn) * 100).toFixed(1) : '0';
              return escapeHtml(contribSeries.key) + ' / ' + truncateChurnFilePath(d.data.filename, 30) + ': ' + formatChurnValue(churn) + ' churn (' + pct + '%)';
            })
            .on('mouseover', function(event, d) {
              var churn = d[1] - d[0];
              var pct = d.data.totalChurn > 0 ? ((churn / d.data.totalChurn) * 100).toFixed(1) : '0';
              showTooltip(event,
                '<strong>' + escapeHtml(contribSeries.key) + '</strong><br>' +
                escapeHtml(truncateChurnFilePath(d.data.filename, 40)) + '<br>' +
                formatChurnValue(churn) + ' churn (' + pct + '%)<br>' +
                '<small>Total: ' + formatChurnValue(d.data.totalChurn) + '</small><br>' +
                '<small style="opacity:0.7;">Click to see commits</small>'
              );
            })
            .on('mousemove', moveTooltip)
            .on('mouseout', hideTooltip)
            .on('click', function(event, d) {
              // Request drill-down data from extension host
              var filename = d.data.filename;
              var contributor = contribSeries.key;
              fileChurnPendingDrillDown = { filename: filename, contributor: contributor };
              vscode.postMessage({
                type: 'requestFileChurnDrillDown',
                filename: filename,
                contributor: contributor,
                groupBy: fileChurnCurrentGroupBy,
                filters: getFilters()
              });
            })
            .on('keydown', function(event, d) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                var filename = d.data.filename;
                var contributor = contribSeries.key;
                fileChurnPendingDrillDown = { filename: filename, contributor: contributor };
                vscode.postMessage({
                  type: 'requestFileChurnDrillDown',
                  filename: filename,
                  contributor: contributor,
                  groupBy: fileChurnCurrentGroupBy,
                  filters: getFilters()
                });
              }
            });
        });

        // Y axis (file names, truncated)
        g.append('g').call(d3.axisLeft(y))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px')
          .each(function() {
            var t = d3.select(this);
            var txt = t.text();
            t.text(truncateChurnFilePath(txt, 38));
          })
          .append('title').text(function(d) { return d; }); // Full path on hover

        // X axis (churn values with k suffix)
        g.append('g').attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).ticks(6).tickFormat(function(d) {
            return formatChurnValue(d);
          }))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px');

        // X axis label
        svg.append('text')
          .attr('x', margin.left + width / 2)
          .attr('y', height + margin.top + 40)
          .attr('text-anchor', 'middle')
          .attr('fill', chartDefaults.color)
          .attr('font-size', '11px')
          .text('Lines Changed (Additions + Deletions)');

        // Chart title
        var titleText = groupBy === 'team' ? 'Top Files by Churn (by Team)' : 'Top Files by Churn (by Contributor)';
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
        var totalChurn = contributors.reduce(function(sum, c) {
          return sum + Object.keys(fileMap).reduce(function(s, f) { return s + (fileMap[f][c] || 0); }, 0);
        }, 0);

        displayContributors.forEach(function(contrib, i) {
          var contribChurn = Object.keys(fileMap).reduce(function(s, f) { return s + (fileMap[f][contrib] || 0); }, 0);
          var pct = totalChurn > 0 ? ((contribChurn / totalChurn) * 100).toFixed(0) : '0';
          var lg = legendG.append('g').attr('transform', 'translate(0,' + (i * 18) + ')');
          lg.append('rect').attr('width', 10).attr('height', 10).attr('fill', color(contrib));
          lg.append('text').attr('x', 13).attr('y', 9).attr('fill', chartDefaults.color).attr('font-size', '10px')
            .text(contrib.length > 15 ? contrib.slice(0, 14) + '...' : contrib)
            .append('title').text(contrib + ': ' + formatChurnValue(contribChurn) + ' (' + pct + '%)');
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
