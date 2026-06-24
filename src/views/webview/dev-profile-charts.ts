/**
 * D3.js chart rendering functions for the Developer Profile Dashboard.
 * Contains inline JavaScript code for rendering charts in the webview.
 * Extracted from dev-profile-html.ts to keep files under 600 lines.
 * Ticket: GITX-155, GITX-156, GITX-157, GITX-172, GITX-174, GITX-176, GITX-179
 */

/**
 * Generate the JavaScript code for the LOC week chart (GITX-155, GITX-174, GITX-176).
 * GITX-174: Converted from stacked bar chart to multi-line chart with zero-value filtering.
 * GITX-176: Custom D3.js tooltips with viewport boundary detection and keyboard accessibility.
 */
export function generateLocWeekChartScript(): string {
  return `
      // ======================================================================
      // GITX-176: Tooltip helper functions for LOC chart
      // ======================================================================
      var locTooltip = null;

      function formatWeekDate(weekStr) {
        // Convert YYYY-MM-DD to "Week of Mon DD, YYYY"
        try {
          var date = new Date(weekStr + 'T00:00:00');
          var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          return 'Week of ' + months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
        } catch (e) {
          return weekStr;
        }
      }

      function truncateRepoName(name, maxLen) {
        if (!name || name.length <= maxLen) { return name; }
        return name.slice(0, maxLen - 3) + '...';
      }

      function showLocTooltip(event, repoName, weekStr, value) {
        if (!locTooltip) {
          locTooltip = document.getElementById('locTooltip');
        }
        if (!locTooltip) { return; }

        var displayRepo = truncateRepoName(escapeHtml(repoName), 40);
        var displayWeek = formatWeekDate(weekStr);
        var displayValue = formatNumber(value);

        locTooltip.innerHTML =
          '<div class="tt-repo">' + displayRepo + '</div>' +
          '<div class="tt-week">' + displayWeek + '</div>' +
          '<div class="tt-value">Lines Added: ' + displayValue + '</div>';

        locTooltip.classList.add('visible');
        locTooltip.setAttribute('aria-hidden', 'false');
        moveLocTooltip(event);
      }

      function moveLocTooltip(event) {
        if (!locTooltip) { return; }

        var x = event.pageX + 12;
        var y = event.pageY - 28;

        // GITX-176: Viewport boundary detection
        var ttRect = locTooltip.getBoundingClientRect();
        var viewportWidth = window.innerWidth;
        var viewportHeight = window.innerHeight;

        // Check right boundary
        if (x + ttRect.width > viewportWidth - 20) {
          x = event.pageX - ttRect.width - 12;
        }
        // Check left boundary
        if (x < 10) {
          x = 10;
        }
        // Check bottom boundary
        if (y + ttRect.height > viewportHeight - 20) {
          y = event.pageY - ttRect.height - 12;
        }
        // Check top boundary
        if (y < 10) {
          y = event.pageY + 20;
        }

        locTooltip.style.left = x + 'px';
        locTooltip.style.top = y + 'px';
      }

      function hideLocTooltip() {
        if (!locTooltip) {
          locTooltip = document.getElementById('locTooltip');
        }
        if (locTooltip) {
          locTooltip.classList.remove('visible');
          locTooltip.setAttribute('aria-hidden', 'true');
        }
      }

      function renderLocWeekChart(data) {
        hideSkeleton('locWeekSkeleton');
        cachedLocData = data;

        if (!data || data.length === 0) {
          document.getElementById('locWeekChart').classList.add('hidden');
          document.getElementById('locWeekEmpty').classList.remove('hidden');
          return;
        }

        // GITX-174: Check if all values are zero (empty state)
        var hasNonZero = data.some(function(d) { return d.linesAdded > 0; });
        if (!hasNonZero) {
          document.getElementById('locWeekChart').classList.add('hidden');
          document.getElementById('locWeekEmpty').classList.remove('hidden');
          return;
        }

        document.getElementById('locWeekChart').classList.remove('hidden');
        document.getElementById('locWeekEmpty').classList.add('hidden');

        // Get unique weeks and repos
        var weeks = Array.from(new Set(data.map(function(d) { return d.weekStart; }))).sort();
        var repos = Array.from(new Set(data.map(function(d) { return d.repository; })));

        // GITX-174: Build line data per repository with null for zero values
        var repoData = repos.map(function(repo) {
          return {
            repo: repo,
            values: weeks.map(function(week) {
              var point = data.find(function(d) { return d.weekStart === week && d.repository === repo; });
              var linesAdded = point ? point.linesAdded : 0;
              return {
                week: week,
                value: linesAdded > 0 ? linesAdded : null // null for zero values to create gaps
              };
            })
          };
        });

        // Chart dimensions
        var container = document.getElementById('locWeekChart');
        container.innerHTML = '';
        var margin = { top: 20, right: 120, bottom: 60, left: 60 };
        var width = container.clientWidth - margin.left - margin.right;
        var height = 300 - margin.top - margin.bottom;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        // Scales
        var x = d3.scaleBand()
          .domain(weeks)
          .range([0, width])
          .padding(0.1);

        var maxY = d3.max(data, function(d) { return d.linesAdded; }) || 100;
        var y = d3.scaleLinear()
          .domain([0, maxY])
          .nice()
          .range([height, 0]);

        var color = d3.scaleOrdinal(d3.schemeCategory10).domain(repos);

        // GITX-174: Line generator with .defined() for zero-value filtering
        var line = d3.line()
          .defined(function(d) { return d.value !== null; })
          .x(function(d) { return x(d.week) + x.bandwidth() / 2; })
          .y(function(d) { return y(d.value); })
          .curve(d3.curveMonotoneX);

        // GITX-174: Draw lines for each repository
        repoData.forEach(function(rd) {
          svg.append('path')
            .datum(rd.values)
            .attr('fill', 'none')
            .attr('stroke', color(rd.repo))
            .attr('stroke-width', 2)
            .attr('d', line);

          // GITX-174, GITX-176: Add data points at non-zero values (4px radius)
          // GITX-176: Custom tooltip with mouse and keyboard event handlers
          svg.selectAll('.point-' + rd.repo.replace(/[^a-zA-Z0-9]/g, '-'))
            .data(rd.values.filter(function(d) { return d.value !== null; }))
            .enter()
            .append('circle')
            .attr('class', 'point')
            .attr('cx', function(d) { return x(d.week) + x.bandwidth() / 2; })
            .attr('cy', function(d) { return y(d.value); })
            .attr('r', 4)
            .attr('fill', color(rd.repo))
            .attr('tabindex', 0)
            .attr('role', 'img')
            .attr('aria-label', function(d) {
              return rd.repo + ': ' + formatNumber(d.value) + ' lines for week ' + d.week;
            })
            // GITX-176: Mouse event handlers for custom tooltip
            .on('mouseenter', function(event, d) {
              showLocTooltip(event, rd.repo, d.week, d.value);
            })
            .on('mousemove', function(event) {
              moveLocTooltip(event);
            })
            .on('mouseleave', function() {
              hideLocTooltip();
            })
            // GITX-176: Keyboard event handlers for accessibility
            .on('focus', function(event, d) {
              // Create synthetic event for tooltip positioning
              var rect = this.getBoundingClientRect();
              var syntheticEvent = {
                pageX: rect.left + rect.width / 2,
                pageY: rect.top
              };
              showLocTooltip(syntheticEvent, rd.repo, d.week, d.value);
            })
            .on('blur', function() {
              hideLocTooltip();
            });
        });

        // X axis - GITX-179: Use formatXAxisDate for dynamic week/month formatting
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

        // Legend
        var legend = svg.append('g')
          .attr('transform', 'translate(' + (width + 10) + ',0)');

        repos.forEach(function(repo, i) {
          var g = legend.append('g')
            .attr('transform', 'translate(0,' + (i * 20) + ')');
          g.append('rect')
            .attr('width', 12)
            .attr('height', 12)
            .attr('fill', color(repo));
          g.append('text')
            .attr('x', 16)
            .attr('y', 10)
            .style('fill', 'var(--vscode-foreground)')
            .style('font-size', '11px')
            .text(truncatePath(repo, 15));
        });
      }
`;
}

/**
 * Generate the JavaScript code for the GITX-156 charts (tech stack, hygiene, comments, tests).
 */
/**
 * Generate the JavaScript code for table rendering functions (GITX-155).
 */
export function generateTableRenderingScripts(): string {
  return `
      function sortTableData(data, sortKey, sortDir) {
        return data.slice().sort(function(a, b) {
          var aVal = a[sortKey];
          var bVal = b[sortKey];
          if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = (bVal || '').toLowerCase();
          }
          if (aVal < bVal) { return sortDir === 'asc' ? -1 : 1; }
          if (aVal > bVal) { return sortDir === 'asc' ? 1 : -1; }
          return 0;
        });
      }

      function renderComplexFilesTable(data) {
        hideSkeleton('complexFilesSkeleton');
        cachedComplexFiles = data;
        if (!data || data.length === 0) {
          document.getElementById('complexFilesTable').classList.add('hidden');
          document.getElementById('complexFilesEmpty').classList.remove('hidden');
          return;
        }
        document.getElementById('complexFilesTable').classList.remove('hidden');
        document.getElementById('complexFilesEmpty').classList.add('hidden');
        renderComplexFilesRows();
      }

      function renderComplexFilesRows() {
        var sortedData = sortTableData(cachedComplexFiles, complexFilesSortKey, complexFilesSortDir);
        var tbody = document.getElementById('complexFilesBody');
        tbody.innerHTML = sortedData.map(function(row) {
          return '<tr class="clickable-row" data-filepath="' + escapeHtml(row.filePath) + '" data-repo="' + escapeHtml(row.repository) + '" tabindex="0" role="button" aria-label="Open ' + escapeHtml(row.filePath) + ' in editor">' +
            '<td title="' + escapeHtml(row.filePath) + '">' + escapeHtml(truncatePath(row.filePath, 50)) + '</td>' +
            '<td class="numeric">' + formatNumber(row.complexityScore) + '</td>' +
            '<td>' + escapeHtml(row.repository) + '</td>' +
            '<td>' + escapeHtml(row.lastModified) + '</td>' +
          '</tr>';
        }).join('');
        attachRowClickHandlers('complexFilesBody');
        updateSortIndicators('complexFilesTable', complexFilesSortKey, complexFilesSortDir);
      }

      function renderFrequentFilesTable(data) {
        hideSkeleton('frequentFilesSkeleton');
        cachedFrequentFiles = data;
        if (!data || data.length === 0) {
          document.getElementById('frequentFilesTable').classList.add('hidden');
          document.getElementById('frequentFilesEmpty').classList.remove('hidden');
          return;
        }
        document.getElementById('frequentFilesTable').classList.remove('hidden');
        document.getElementById('frequentFilesEmpty').classList.add('hidden');
        renderFrequentFilesRows();
      }

      // GITX-179: Replaced repository with lastModified in frequent files table
      function renderFrequentFilesRows() {
        var sortedData = sortTableData(cachedFrequentFiles, frequentFilesSortKey, frequentFilesSortDir);
        var tbody = document.getElementById('frequentFilesBody');
        tbody.innerHTML = sortedData.map(function(row) {
          return '<tr class="clickable-row" data-filepath="' + escapeHtml(row.filePath) + '" tabindex="0" role="button" aria-label="Open ' + escapeHtml(row.filePath) + ' in editor">' +
            '<td title="' + escapeHtml(row.filePath) + '">' + escapeHtml(truncatePath(row.filePath, 50)) + '</td>' +
            '<td class="numeric">' + formatNumber(row.modificationCount) + '</td>' +
            '<td class="numeric">' + formatNumber(row.totalLocChanged) + '</td>' +
            '<td>' + escapeHtml(row.lastModified || '—') + '</td>' +
          '</tr>';
        }).join('');
        attachRowClickHandlers('frequentFilesBody');
        updateSortIndicators('frequentFilesTable', frequentFilesSortKey, frequentFilesSortDir);
      }

      function attachRowClickHandlers(tbodyId) {
        var tbody = document.getElementById(tbodyId);
        tbody.querySelectorAll('.clickable-row').forEach(function(row) {
          row.addEventListener('click', function() {
            var filePath = row.getAttribute('data-filepath');
            var repository = row.getAttribute('data-repo');
            vscode.postMessage({ type: 'openFile', filePath: filePath, repository: repository });
          });
          row.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              row.click();
            }
          });
        });
      }

      function updateSortIndicators(tableId, sortKey, sortDir) {
        var headers = document.querySelectorAll('#' + tableId + ' .sortable-header');
        headers.forEach(function(header) {
          var key = header.getAttribute('data-sort-key');
          var indicator = header.querySelector('.sort-indicator');
          if (key === sortKey) {
            header.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
            indicator.textContent = sortDir === 'asc' ? '\\u25B2' : '\\u25BC';
          } else {
            header.setAttribute('aria-sort', 'none');
            indicator.textContent = '\\u21C5';
          }
        });
      }
`;
}

// Re-export velocity chart script from separate module (GITX-157)
export { generateVelocityChartScript } from './dev-profile-velocity-chart.js';

// Re-export test debt chart script from separate module (GITX-172)
export { generateTestDebtChartScript } from './dev-profile-test-debt-chart.js';

/**
 * Generate the JavaScript code for the GITX-156 charts (tech stack, hygiene, comments, tests).
 */
export function generateGitx156ChartScripts(): string {
  return `
      // ======================================================================
      // GITX-156: Technology Stack Doughnut Chart
      // ======================================================================
      function renderTechStackChart(data) {
        hideSkeleton('techStackSkeleton');
        cachedTechStack = data;

        if (!data || data.length === 0) {
          document.getElementById('techStackChart').classList.add('hidden');
          document.getElementById('techStackEmpty').classList.remove('hidden');
          return;
        }

        document.getElementById('techStackChart').classList.remove('hidden');
        document.getElementById('techStackEmpty').classList.add('hidden');

        // Aggregate by category (sum across repositories)
        var categoryMap = {};
        data.forEach(function(d) {
          if (!categoryMap[d.category]) {
            categoryMap[d.category] = 0;
          }
          categoryMap[d.category] += d.locCount;
        });

        var categories = Object.keys(categoryMap);
        var totalLoc = categories.reduce(function(sum, cat) { return sum + categoryMap[cat]; }, 0);
        var chartData = categories.map(function(cat, i) {
          return {
            category: cat,
            locCount: categoryMap[cat],
            percentage: totalLoc > 0 ? (categoryMap[cat] * 100 / totalLoc).toFixed(1) : 0
          };
        }).sort(function(a, b) { return b.locCount - a.locCount; });

        var container = document.getElementById('techStackChart');
        container.innerHTML = '';
        var width = container.clientWidth;
        var height = 280;
        var radius = Math.min(width, height) / 2 - 40;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width)
          .attr('height', height)
          .append('g')
          .attr('transform', 'translate(' + (width / 3) + ',' + (height / 2) + ')');

        var color = d3.scaleOrdinal().domain(chartData.map(function(d) { return d.category; })).range(CHART_COLORS);

        var pie = d3.pie().value(function(d) { return d.locCount; }).sort(null);
        var arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius);
        var labelArc = d3.arc().innerRadius(radius * 0.75).outerRadius(radius * 0.75);

        var arcs = svg.selectAll('.arc')
          .data(pie(chartData))
          .enter()
          .append('g')
          .attr('class', 'arc');

        arcs.append('path')
          .attr('d', arc)
          .attr('fill', function(d) { return color(d.data.category); })
          .attr('stroke', 'var(--vscode-editor-background)')
          .attr('stroke-width', 2)
          .attr('tabindex', 0)
          .attr('role', 'img')
          .attr('aria-label', function(d) {
            return d.data.category + ': ' + formatNumber(d.data.locCount) + ' lines (' + d.data.percentage + '%)';
          })
          .append('title')
          .text(function(d) {
            return d.data.category + '\\n' + formatNumber(d.data.locCount) + ' lines\\n' + d.data.percentage + '%';
          });

        // Add percentage labels on segments (only for segments > 5%)
        arcs.filter(function(d) { return d.data.percentage > 5; })
          .append('text')
          .attr('transform', function(d) { return 'translate(' + labelArc.centroid(d) + ')'; })
          .attr('text-anchor', 'middle')
          .style('fill', 'var(--vscode-editor-background)')
          .style('font-size', '11px')
          .style('font-weight', '600')
          .text(function(d) { return d.data.percentage + '%'; });

        // Legend
        var legend = svg.append('g')
          .attr('transform', 'translate(' + (radius + 20) + ',' + (-chartData.length * 10) + ')');

        chartData.forEach(function(d, i) {
          var g = legend.append('g').attr('transform', 'translate(0,' + (i * 20) + ')');
          g.append('rect').attr('width', 12).attr('height', 12).attr('fill', color(d.category));
          g.append('text')
            .attr('x', 16).attr('y', 10)
            .style('fill', 'var(--vscode-foreground)')
            .style('font-size', '11px')
            .text(truncatePath(d.category, 12) + ' (' + d.percentage + '%)');
        });
      }

      // ======================================================================
      // GITX-156: Commit Hygiene Score Gauge
      // ======================================================================
      function renderHygieneScore(data) {
        hideSkeleton('hygieneSkeleton');
        cachedHygieneScore = data;

        if (!data || data.totalCommits === 0) {
          document.getElementById('hygieneGauge').classList.add('hidden');
          document.getElementById('hygieneBreakdown').classList.add('hidden');
          document.getElementById('hygieneEmpty').classList.remove('hidden');
          return;
        }

        document.getElementById('hygieneGauge').classList.remove('hidden');
        document.getElementById('hygieneBreakdown').classList.remove('hidden');
        document.getElementById('hygieneEmpty').classList.add('hidden');

        // Update score display
        var scoreValue = document.getElementById('hygieneScoreValue');
        scoreValue.textContent = data.overallScore.toFixed(0);

        // Color code based on score
        if (data.overallScore >= 80) {
          scoreValue.style.color = 'var(--vscode-testing-iconPassed, #4ec9b0)';
        } else if (data.overallScore >= 60) {
          scoreValue.style.color = 'var(--vscode-editorWarning-foreground, #cca700)';
        } else {
          scoreValue.style.color = 'var(--vscode-testing-iconFailed, #f48771)';
        }

        // Update tier badge
        var tierBadge = document.getElementById('hygieneTierBadge');
        tierBadge.textContent = data.qualityTier.charAt(0).toUpperCase() + data.qualityTier.slice(1);
        tierBadge.className = 'hygiene-tier-badge tier-' + data.qualityTier;

        // Update breakdown bars
        document.getElementById('jiraRefBar').style.width = data.jiraRefPercentage + '%';
        document.getElementById('jiraRefValue').textContent = data.jiraRefPercentage.toFixed(1) + '%';

        document.getElementById('meaningfulMsgBar').style.width = data.meaningfulMsgPercentage + '%';
        document.getElementById('meaningfulMsgValue').textContent = data.meaningfulMsgPercentage.toFixed(1) + '%';

        document.getElementById('nonMergeBar').style.width = data.nonMergePercentage + '%';
        document.getElementById('nonMergeValue').textContent = data.nonMergePercentage.toFixed(1) + '%';

        document.getElementById('hygieneTotalCommits').textContent = 'Based on ' + formatNumber(data.totalCommits) + ' commits';
      }

      // ======================================================================
      // GITX-156: Comments Per Week Line Chart
      // ======================================================================
      function renderCommentsWeekChart(data) {
        hideSkeleton('commentsWeekSkeleton');
        cachedCommentsWeek = data;

        if (!data || data.length === 0) {
          document.getElementById('commentsWeekChart').classList.add('hidden');
          document.getElementById('commentsWeekEmpty').classList.remove('hidden');
          return;
        }

        document.getElementById('commentsWeekChart').classList.remove('hidden');
        document.getElementById('commentsWeekEmpty').classList.add('hidden');

        var container = document.getElementById('commentsWeekChart');
        container.innerHTML = '';
        var margin = { top: 20, right: 30, bottom: 60, left: 50 };
        var width = container.clientWidth - margin.left - margin.right;
        var height = 250 - margin.top - margin.bottom;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var x = d3.scaleBand()
          .domain(data.map(function(d) { return d.weekStart; }))
          .range([0, width])
          .padding(0.1);

        var maxY = d3.max(data, function(d) { return d.commentsAdded; }) || 10;
        var y = d3.scaleLinear()
          .domain([0, maxY])
          .nice()
          .range([height, 0]);

        // Line
        var line = d3.line()
          .x(function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
          .y(function(d) { return y(d.commentsAdded); })
          .curve(d3.curveMonotoneX);

        svg.append('path')
          .datum(data)
          .attr('fill', 'none')
          .attr('stroke', CHART_COLORS[1])
          .attr('stroke-width', 2)
          .attr('d', line);

        // Data points
        svg.selectAll('.point')
          .data(data)
          .enter()
          .append('circle')
          .attr('class', 'point')
          .attr('cx', function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
          .attr('cy', function(d) { return y(d.commentsAdded); })
          .attr('r', 4)
          .attr('fill', CHART_COLORS[1])
          .attr('tabindex', 0)
          .attr('role', 'img')
          .attr('aria-label', function(d) { return 'Week ' + d.weekStart + ': ' + formatNumber(d.commentsAdded) + ' comments'; })
          .append('title')
          .text(function(d) { return d.weekStart + '\\n' + formatNumber(d.commentsAdded) + ' comments'; });

        // X axis - GITX-179: Use formatXAxisDate for dynamic week/month formatting
        svg.append('g')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickFormat(function(d) { return formatXAxisDate(d); }))
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        // Y axis
        svg.append('g').call(d3.axisLeft(y).ticks(5));

        // Y axis label
        svg.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -margin.left + 15)
          .attr('x', -height / 2)
          .attr('text-anchor', 'middle')
          .style('fill', 'var(--vscode-foreground)')
          .text('Comments Added');
      }

      // ======================================================================
      // GITX-156: Tests Per Week Line Chart
      // ======================================================================
      function renderTestsWeekChart(data) {
        hideSkeleton('testsWeekSkeleton');
        cachedTestsWeek = data;

        if (!data || data.length === 0) {
          document.getElementById('testsWeekChart').classList.add('hidden');
          document.getElementById('testsWeekEmpty').classList.remove('hidden');
          return;
        }

        document.getElementById('testsWeekChart').classList.remove('hidden');
        document.getElementById('testsWeekEmpty').classList.add('hidden');

        var container = document.getElementById('testsWeekChart');
        container.innerHTML = '';
        var margin = { top: 20, right: 30, bottom: 60, left: 50 };
        var width = container.clientWidth - margin.left - margin.right;
        var height = 250 - margin.top - margin.bottom;

        var svg = d3.select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var x = d3.scaleBand()
          .domain(data.map(function(d) { return d.weekStart; }))
          .range([0, width])
          .padding(0.1);

        var maxY = d3.max(data, function(d) { return d.testFilesModified; }) || 5;
        var y = d3.scaleLinear()
          .domain([0, maxY])
          .nice()
          .range([height, 0]);

        // Line
        var line = d3.line()
          .x(function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
          .y(function(d) { return y(d.testFilesModified); })
          .curve(d3.curveMonotoneX);

        svg.append('path')
          .datum(data)
          .attr('fill', 'none')
          .attr('stroke', CHART_COLORS[2])
          .attr('stroke-width', 2)
          .attr('d', line);

        // Data points
        svg.selectAll('.point')
          .data(data)
          .enter()
          .append('circle')
          .attr('class', 'point')
          .attr('cx', function(d) { return x(d.weekStart) + x.bandwidth() / 2; })
          .attr('cy', function(d) { return y(d.testFilesModified); })
          .attr('r', 4)
          .attr('fill', CHART_COLORS[2])
          .attr('tabindex', 0)
          .attr('role', 'img')
          .attr('aria-label', function(d) { return 'Week ' + d.weekStart + ': ' + d.testFilesModified + ' test files'; })
          .append('title')
          .text(function(d) { return d.weekStart + '\\n' + d.testFilesModified + ' test files\\n' + formatNumber(d.testLinesAdded) + ' lines'; });

        // X axis - GITX-179: Use formatXAxisDate for dynamic week/month formatting
        svg.append('g')
          .attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickFormat(function(d) { return formatXAxisDate(d); }))
          .selectAll('text')
          .attr('transform', 'rotate(-45)')
          .style('text-anchor', 'end');

        // Y axis
        svg.append('g').call(d3.axisLeft(y).ticks(5));

        // Y axis label
        svg.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', -margin.left + 15)
          .attr('x', -height / 2)
          .attr('text-anchor', 'middle')
          .style('fill', 'var(--vscode-foreground)')
          .text('Test Files');
      }
`;
}
