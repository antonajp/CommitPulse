/**
 * D3.js horizontal stacked bar chart renderers for Team Profile Dashboard.
 * Uses Okabe-Ito colorblind-safe palette for per-member contribution coloring.
 * Ticket: GITX-186
 */

/**
 * Generate the JavaScript source for the Team Profile file charts.
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateTeamProfileFileChartsScript(): string {
  return `
      // ======================================================================
      // GITX-186: Team Profile File Charts - Okabe-Ito Color Palette
      // ======================================================================

      // Okabe-Ito colorblind-safe palette (8 base colors)
      var OKABE_ITO_COLORS = [
        '#E69F00', // Orange
        '#56B4E9', // Sky Blue
        '#009E73', // Bluish Green
        '#F0E442', // Yellow
        '#0072B2', // Blue
        '#D55E00', // Vermilion
        '#CC79A7', // Reddish Purple
        '#999999'  // Gray
      ];

      /**
       * Get color for a contributor index.
       * Uses Okabe-Ito palette for first 8, then generates HSL colors.
       * GITX-186: HSL generation for teams with 9+ members.
       *
       * @param {number} index - Contributor index (0-based)
       * @returns {string} Hex or HSL color string
       */
      function getTeamContributorColor(index) {
        if (index < OKABE_ITO_COLORS.length) {
          return OKABE_ITO_COLORS[index];
        }
        // Generate additional colors using HSL with golden angle for even distribution
        var hue = ((index - OKABE_ITO_COLORS.length) * 137.508 + 30) % 360;
        return 'hsl(' + hue + ', 65%, 50%)';
      }

      /**
       * Truncate file path for Y-axis display.
       * Shows the last N characters with ellipsis prefix.
       *
       * @param {string} path - Full file path
       * @param {number} maxLen - Maximum display length
       * @returns {string} Truncated path
       */
      function truncateTeamFilePath(path, maxLen) {
        if (!path || path.length <= maxLen) { return path || ''; }
        return '...' + path.slice(-(maxLen - 3));
      }

      /**
       * Format LOC value with k/M suffix for large numbers.
       *
       * @param {number} val - LOC value
       * @returns {string} Formatted value
       */
      function formatTeamLocValue(val) {
        if (val >= 1000000) {
          return (val / 1000000).toFixed(1) + 'M';
        }
        if (val >= 1000) {
          return (val / 1000).toFixed(1) + 'k';
        }
        return val.toLocaleString();
      }

      // ======================================================================
      // GITX-186: Top Complex Files Horizontal Stacked Bar Chart
      // ======================================================================

      /**
       * Cached data and state for complex files chart.
       */
      var cachedComplexFilesChartData = [];

      /**
       * Render the Top Complex Files horizontal stacked bar chart.
       * GITX-186: Per-member contribution coloring using Okabe-Ito palette.
       *
       * @param {Array} data - Array of TeamProfileComplexFileWithContributors
       */
      function renderTeamComplexFilesChart(data) {
        hideSkeleton('complexFilesSkeleton');
        cachedComplexFilesChartData = data;

        var container = document.getElementById('complexFilesChart');
        var emptyMsg = document.getElementById('complexFilesEmpty');

        if (!data || data.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        container.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        container.innerHTML = '';

        // Extract unique authors across all files and sort by total LOC
        var authorTotals = {};
        data.forEach(function(file) {
          file.authorContributions.forEach(function(contrib) {
            var name = contrib.authorName || 'Unknown';
            authorTotals[name] = (authorTotals[name] || 0) + contrib.loc;
          });
        });

        var authors = Object.keys(authorTotals).sort(function(a, b) {
          return authorTotals[b] - authorTotals[a];
        });

        // Build stack data
        var files = data.map(function(f) { return f.filePath; });
        var stackData = data.map(function(file) {
          var entry = {
            filePath: file.filePath,
            repository: file.repository,
            totalComplexity: file.totalComplexity,
            totalLoc: file.totalLoc
          };
          authors.forEach(function(author) {
            var contrib = file.authorContributions.find(function(c) {
              return (c.authorName || 'Unknown') === author;
            });
            entry[author] = contrib ? contrib.loc : 0;
          });
          return entry;
        });

        // Chart dimensions
        var barHeight = 22;
        var maxLabelLen = 35;
        var margin = { top: 30, right: 160, bottom: 50, left: Math.min(250, Math.max(150, maxLabelLen * 6)) };
        var width = Math.max(500, container.clientWidth) - margin.left - margin.right;
        var height = Math.max(200, files.length * (barHeight + 6)) + 20;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .attr('role', 'img')
          .attr('aria-label', 'Top Complex Files horizontal stacked bar chart showing per-member LOC contributions');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // Scales
        var y = d3.scaleBand().domain(files).range([0, height]).padding(0.15);
        var color = d3.scaleOrdinal().domain(authors).range(authors.map(function(_, i) {
          return getTeamContributorColor(i);
        }));

        // Stack generator
        var stack = d3.stack().keys(authors);
        var series = stack(stackData);
        var maxVal = d3.max(series, function(s) { return d3.max(s, function(d) { return d[1]; }); }) || 1;
        var x = d3.scaleLinear().domain([0, maxVal]).nice().range([0, width]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisBottom(x).tickSize(height).tickFormat(''))
          .selectAll('line')
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // Render stacked horizontal bars
        series.forEach(function(authorSeries) {
          g.selectAll('.hbar-complex-' + authorSeries.key.replace(/[^a-zA-Z0-9]/g, '_'))
            .data(authorSeries).enter().append('rect')
            .attr('y', function(d) { return y(d.data.filePath); })
            .attr('x', function(d) { return x(d[0]); })
            .attr('height', y.bandwidth())
            .attr('width', function(d) { return Math.max(0, x(d[1]) - x(d[0])); })
            .attr('fill', color(authorSeries.key) + 'cc')
            .attr('stroke', color(authorSeries.key))
            .attr('stroke-width', 1)
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('data-filepath', function(d) { return d.data.filePath; })
            .attr('data-repo', function(d) { return d.data.repository; })
            .attr('aria-label', function(d) {
              var loc = d[1] - d[0];
              var pct = d.data.totalLoc > 0 ? ((loc / d.data.totalLoc) * 100).toFixed(1) : '0';
              return escapeHtml(authorSeries.key) + ': ' + formatTeamLocValue(loc) + ' LOC (' + pct + '%) in ' + truncateTeamFilePath(d.data.filePath, 30);
            })
            .on('mouseover', function(event, d) {
              var loc = d[1] - d[0];
              var pct = d.data.totalLoc > 0 ? ((loc / d.data.totalLoc) * 100).toFixed(1) : '0';
              showTeamFileTooltip(event,
                '<strong>' + escapeHtml(authorSeries.key) + '</strong><br>' +
                escapeHtml(truncateTeamFilePath(d.data.filePath, 45)) + '<br>' +
                'LOC: ' + formatTeamLocValue(loc) + ' (' + pct + '%)<br>' +
                '<small>Complexity: ' + escapeHtml(String(d.data.totalComplexity)) + '</small><br>' +
                '<small style="opacity:0.7;">Click to open file</small>'
              );
            })
            .on('mousemove', moveTeamFileTooltip)
            .on('mouseout', hideTeamFileTooltip)
            .on('click', function(event, d) {
              vscode.postMessage({
                type: 'openFile',
                filePath: d.data.filePath,
                repository: d.data.repository
              });
            })
            .on('keydown', function(event, d) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                vscode.postMessage({
                  type: 'openFile',
                  filePath: d.data.filePath,
                  repository: d.data.repository
                });
              }
            });
        });

        // Y axis (file names, truncated)
        var yAxis = g.append('g').call(d3.axisLeft(y));
        yAxis.selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px')
          .each(function(d) {
            var t = d3.select(this);
            var fullPath = t.text();
            t.text(truncateTeamFilePath(fullPath, maxLabelLen));
          });
        // Add full path on hover via title
        yAxis.selectAll('.tick').append('title').text(function(d) { return d; });

        // X axis
        g.append('g').attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).ticks(6).tickFormat(function(d) {
            return formatTeamLocValue(d);
          }))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px');

        // X axis label
        svg.append('text')
          .attr('x', margin.left + width / 2)
          .attr('y', height + margin.top + 40)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Lines of Code');

        // Legend (right side, top 12 contributors)
        var legendX = margin.left + width + 10;
        var legendY = margin.top;
        var legendG = svg.append('g').attr('transform', 'translate(' + legendX + ',' + legendY + ')');

        var displayAuthors = authors.slice(0, 12);

        displayAuthors.forEach(function(author, i) {
          var lg = legendG.append('g').attr('transform', 'translate(0,' + (i * 18) + ')');
          lg.append('rect')
            .attr('width', 12)
            .attr('height', 12)
            .attr('rx', 2)
            .attr('fill', color(author));
          lg.append('text')
            .attr('x', 16)
            .attr('y', 10)
            .attr('fill', 'var(--vscode-foreground, #ccc)')
            .attr('font-size', '10px')
            .text(author.length > 14 ? author.slice(0, 13) + '...' : author)
            .append('title').text(author + ': ' + formatTeamLocValue(authorTotals[author]) + ' LOC total');
        });

        // Show "and X more..." if there are additional contributors
        if (authors.length > 12) {
          var moreCount = authors.length - 12;
          legendG.append('text')
            .attr('x', 0)
            .attr('y', displayAuthors.length * 18 + 12)
            .attr('fill', 'var(--vscode-descriptionForeground, #888)')
            .attr('font-size', '10px')
            .attr('font-style', 'italic')
            .text('and ' + moreCount + ' more...');
        }
      }

      // ======================================================================
      // GITX-186: Top Frequently Modified Files Horizontal Stacked Bar Chart
      // ======================================================================

      /**
       * Cached data and state for frequent files chart.
       */
      var cachedFrequentFilesChartData = [];

      /**
       * Render the Top Frequently Modified Files horizontal stacked bar chart.
       * GITX-186: Per-member contribution coloring using Okabe-Ito palette.
       *
       * @param {Array} data - Array of TeamProfileFrequentFileWithContributors
       */
      function renderTeamFrequentFilesChart(data) {
        hideSkeleton('frequentFilesSkeleton');
        cachedFrequentFilesChartData = data;

        var container = document.getElementById('frequentFilesChart');
        var emptyMsg = document.getElementById('frequentFilesEmpty');

        if (!data || data.length === 0) {
          container.classList.add('hidden');
          emptyMsg.classList.remove('hidden');
          return;
        }

        container.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        container.innerHTML = '';

        // Extract unique authors across all files and sort by total LOC changed
        var authorTotals = {};
        data.forEach(function(file) {
          file.authorContributions.forEach(function(contrib) {
            var name = contrib.authorName || 'Unknown';
            authorTotals[name] = (authorTotals[name] || 0) + contrib.loc;
          });
        });

        var authors = Object.keys(authorTotals).sort(function(a, b) {
          return authorTotals[b] - authorTotals[a];
        });

        // Build stack data
        var files = data.map(function(f) { return f.filePath; });
        var stackData = data.map(function(file) {
          var entry = {
            filePath: file.filePath,
            repository: file.repository,
            totalModifications: file.totalModifications,
            totalLocChanged: file.totalLocChanged
          };
          authors.forEach(function(author) {
            var contrib = file.authorContributions.find(function(c) {
              return (c.authorName || 'Unknown') === author;
            });
            entry[author] = contrib ? contrib.loc : 0;
          });
          return entry;
        });

        // Chart dimensions
        var barHeight = 22;
        var maxLabelLen = 35;
        var margin = { top: 30, right: 160, bottom: 50, left: Math.min(250, Math.max(150, maxLabelLen * 6)) };
        var width = Math.max(500, container.clientWidth) - margin.left - margin.right;
        var height = Math.max(200, files.length * (barHeight + 6)) + 20;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .attr('role', 'img')
          .attr('aria-label', 'Top Frequently Modified Files horizontal stacked bar chart showing per-member LOC contributions');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // Scales
        var y = d3.scaleBand().domain(files).range([0, height]).padding(0.15);
        var color = d3.scaleOrdinal().domain(authors).range(authors.map(function(_, i) {
          return getTeamContributorColor(i);
        }));

        // Stack generator
        var stack = d3.stack().keys(authors);
        var series = stack(stackData);
        var maxVal = d3.max(series, function(s) { return d3.max(s, function(d) { return d[1]; }); }) || 1;
        var x = d3.scaleLinear().domain([0, maxVal]).nice().range([0, width]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisBottom(x).tickSize(height).tickFormat(''))
          .selectAll('line')
          .attr('stroke', 'var(--vscode-panel-border, #444)')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // Render stacked horizontal bars
        series.forEach(function(authorSeries) {
          g.selectAll('.hbar-freq-' + authorSeries.key.replace(/[^a-zA-Z0-9]/g, '_'))
            .data(authorSeries).enter().append('rect')
            .attr('y', function(d) { return y(d.data.filePath); })
            .attr('x', function(d) { return x(d[0]); })
            .attr('height', y.bandwidth())
            .attr('width', function(d) { return Math.max(0, x(d[1]) - x(d[0])); })
            .attr('fill', color(authorSeries.key) + 'cc')
            .attr('stroke', color(authorSeries.key))
            .attr('stroke-width', 1)
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('data-filepath', function(d) { return d.data.filePath; })
            .attr('data-repo', function(d) { return d.data.repository; })
            .attr('aria-label', function(d) {
              var loc = d[1] - d[0];
              var pct = d.data.totalLocChanged > 0 ? ((loc / d.data.totalLocChanged) * 100).toFixed(1) : '0';
              return escapeHtml(authorSeries.key) + ': ' + formatTeamLocValue(loc) + ' LOC changed (' + pct + '%) in ' + truncateTeamFilePath(d.data.filePath, 30);
            })
            .on('mouseover', function(event, d) {
              var loc = d[1] - d[0];
              var pct = d.data.totalLocChanged > 0 ? ((loc / d.data.totalLocChanged) * 100).toFixed(1) : '0';
              showTeamFileTooltip(event,
                '<strong>' + escapeHtml(authorSeries.key) + '</strong><br>' +
                escapeHtml(truncateTeamFilePath(d.data.filePath, 45)) + '<br>' +
                'LOC Changed: ' + formatTeamLocValue(loc) + ' (' + pct + '%)<br>' +
                '<small>Modifications: ' + escapeHtml(String(d.data.totalModifications)) + '</small><br>' +
                '<small style="opacity:0.7;">Click to open file</small>'
              );
            })
            .on('mousemove', moveTeamFileTooltip)
            .on('mouseout', hideTeamFileTooltip)
            .on('click', function(event, d) {
              vscode.postMessage({
                type: 'openFile',
                filePath: d.data.filePath,
                repository: d.data.repository
              });
            })
            .on('keydown', function(event, d) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                vscode.postMessage({
                  type: 'openFile',
                  filePath: d.data.filePath,
                  repository: d.data.repository
                });
              }
            });
        });

        // Y axis (file names, truncated)
        var yAxis = g.append('g').call(d3.axisLeft(y));
        yAxis.selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px')
          .each(function(d) {
            var t = d3.select(this);
            var fullPath = t.text();
            t.text(truncateTeamFilePath(fullPath, maxLabelLen));
          });
        // Add full path on hover via title
        yAxis.selectAll('.tick').append('title').text(function(d) { return d; });

        // X axis
        g.append('g').attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).ticks(6).tickFormat(function(d) {
            return formatTeamLocValue(d);
          }))
          .selectAll('text')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '10px');

        // X axis label
        svg.append('text')
          .attr('x', margin.left + width / 2)
          .attr('y', height + margin.top + 40)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #ccc)')
          .attr('font-size', '11px')
          .text('Lines of Code Changed');

        // Legend (right side, top 12 contributors)
        var legendX = margin.left + width + 10;
        var legendY = margin.top;
        var legendG = svg.append('g').attr('transform', 'translate(' + legendX + ',' + legendY + ')');

        var displayAuthors = authors.slice(0, 12);

        displayAuthors.forEach(function(author, i) {
          var lg = legendG.append('g').attr('transform', 'translate(0,' + (i * 18) + ')');
          lg.append('rect')
            .attr('width', 12)
            .attr('height', 12)
            .attr('rx', 2)
            .attr('fill', color(author));
          lg.append('text')
            .attr('x', 16)
            .attr('y', 10)
            .attr('fill', 'var(--vscode-foreground, #ccc)')
            .attr('font-size', '10px')
            .text(author.length > 14 ? author.slice(0, 13) + '...' : author)
            .append('title').text(author + ': ' + formatTeamLocValue(authorTotals[author]) + ' LOC changed total');
        });

        // Show "and X more..." if there are additional contributors
        if (authors.length > 12) {
          var moreCount = authors.length - 12;
          legendG.append('text')
            .attr('x', 0)
            .attr('y', displayAuthors.length * 18 + 12)
            .attr('fill', 'var(--vscode-descriptionForeground, #888)')
            .attr('font-size', '10px')
            .attr('font-style', 'italic')
            .text('and ' + moreCount + ' more...');
        }
      }

      // ======================================================================
      // GITX-186: Team File Chart Tooltip Functions
      // ======================================================================

      var teamFileTooltip = null;

      /**
       * Show tooltip for team file charts.
       * GITX-186: Security - HTML content is already escaped by callers.
       */
      function showTeamFileTooltip(event, html) {
        if (!teamFileTooltip) {
          teamFileTooltip = document.getElementById('teamFileTooltip');
        }
        if (!teamFileTooltip) { return; }

        teamFileTooltip.innerHTML = html;
        teamFileTooltip.classList.add('visible');
        teamFileTooltip.setAttribute('aria-hidden', 'false');
        moveTeamFileTooltip(event);
      }

      /**
       * Move tooltip to follow cursor with boundary detection.
       */
      function moveTeamFileTooltip(event) {
        if (!teamFileTooltip) { return; }

        var x = event.pageX + 12;
        var y = event.pageY - 28;

        // Viewport boundary detection
        var ttRect = teamFileTooltip.getBoundingClientRect();
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

        teamFileTooltip.style.left = x + 'px';
        teamFileTooltip.style.top = y + 'px';
      }

      /**
       * Hide the team file chart tooltip.
       */
      function hideTeamFileTooltip() {
        if (!teamFileTooltip) {
          teamFileTooltip = document.getElementById('teamFileTooltip');
        }
        if (teamFileTooltip) {
          teamFileTooltip.classList.remove('visible');
          teamFileTooltip.setAttribute('aria-hidden', 'true');
        }
      }
  `;
}
