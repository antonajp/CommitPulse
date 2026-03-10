/**
 * Shared D3.js chart rendering scripts for webview panels.
 * Provides reusable JavaScript snippets injected into webview HTML for:
 * - XSS-safe HTML escaping
 * - Tooltip creation and management
 * - Color palette and theme integration
 * - Chart rendering: bar, line, arc/pie, stacked bar
 *
 * These functions are injected as inline script into webview HTML.
 * They rely on D3.js being loaded and `chartDefaults` / `CHART_COLORS` being defined.
 *
 * Ticket: IQS-887
 */

import { generateLocCommittedChartScript } from './d3-loc-committed-chart.js';
import { generateTopComplexFilesChartScript } from './d3-complexity-chart.js';
import { generateFileChurnChartScript } from './d3-file-churn-chart.js';

// ============================================================================
// Shared D3.js Initialization Script
// ============================================================================

/**
 * Generate the JavaScript source for shared D3.js chart infrastructure.
 * Includes: escapeHtml, tooltip, color palette, theme defaults.
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateD3ChartInfraScript(): string {
  return `
      // ======================================================================
      // Color palette using VS Code theme CSS variables (IQS-887)
      // ======================================================================
      var CHART_COLORS = [
        '#4dc9f6', '#f67019', '#f53794', '#537bc4',
        '#acc236', '#166a8f', '#00a950', '#58595b',
        '#8549ba', '#e6194b', '#3cb44b', '#ffe119',
      ];

      function getThemeColor(varName, fallback) {
        var style = getComputedStyle(document.body);
        return style.getPropertyValue(varName).trim() || fallback;
      }

      var chartDefaults = {
        color: getThemeColor('--vscode-foreground', '#cccccc'),
        borderColor: getThemeColor('--vscode-panel-border', '#444444'),
        backgroundColor: getThemeColor('--vscode-editor-background', '#1e1e1e'),
      };

      // ======================================================================
      // HTML Escape utility (security: prevent XSS in SVG/DOM) (IQS-887)
      // ======================================================================
      function escapeHtml(text) {
        if (text === null || text === undefined) { return ''; }
        return String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;');
      }

      // ======================================================================
      // D3.js Tooltip (IQS-887)
      // ======================================================================
      var tooltipDiv = document.createElement('div');
      tooltipDiv.className = 'd3-tooltip';
      tooltipDiv.style.cssText = 'position:absolute;padding:6px 10px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-panel-border,#444);border-radius:3px;color:var(--vscode-foreground,#ccc);font-size:12px;pointer-events:none;opacity:0;transition:opacity 0.15s;z-index:100;white-space:nowrap;';
      document.body.appendChild(tooltipDiv);

      function showTooltip(event, html) {
        tooltipDiv.innerHTML = html;
        tooltipDiv.style.opacity = '1';
        tooltipDiv.style.left = (event.pageX + 12) + 'px';
        tooltipDiv.style.top = (event.pageY - 28) + 'px';
      }

      function moveTooltip(event) {
        tooltipDiv.style.left = (event.pageX + 12) + 'px';
        tooltipDiv.style.top = (event.pageY - 28) + 'px';
      }

      function hideTooltip() {
        tooltipDiv.style.opacity = '0';
      }
  `;
}

// ============================================================================
// D3.js Bar/Line LOC per Week Chart Script (IQS-919)
// ============================================================================

/**
 * Generate the JavaScript source for the LOC per Week chart renderer.
 * Renders as grouped bar chart (day granularity) or multi-line chart (week/month).
 *
 * IQS-919: Changed from commit counts to LOC (lines of code) with K/M formatting.
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateVelocityChartScript(): string {
  return `
      // ======================================================================
      // LOC per Week Chart (D3.js bar/line) (IQS-919)
      // ======================================================================

      /**
       * Format a number with K/M suffix for Y-axis labels (IQS-919).
       * @param {number} value - The numeric value to format
       * @returns {string} Formatted string (e.g., "15K", "1.2M")
       */
      function formatLocAxis(value) {
        if (value >= 1000000) {
          return (value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1) + 'M';
        } else if (value >= 1000) {
          return (value / 1000).toFixed(value % 1000 === 0 ? 0 : 1) + 'K';
        }
        return String(value);
      }

      /**
       * Format a number with locale-aware thousand separators for tooltips (IQS-919).
       * @param {number} value - The numeric value to format
       * @returns {string} Formatted string (e.g., "2,450 LOC")
       */
      function formatLocTooltip(value) {
        return value.toLocaleString() + ' LOC';
      }

      function renderVelocityChart(dataPoints, granularity) {
        hideLoading('velocityCard');
        cachedVelocityData = dataPoints;
        cachedVelocityGranularity = granularity;
        var container = document.getElementById('velocityChart');
        var emptyMsg = document.getElementById('velocityEmpty');

        if (!dataPoints || dataPoints.length === 0) {
          container.style.display = 'none';
          emptyMsg.style.display = 'block';
          return;
        }
        container.style.display = 'block';
        emptyMsg.style.display = 'none';
        container.innerHTML = '';

        var repos = [];
        var repoSet = {};
        var dates = [];
        var dateSet = {};
        dataPoints.forEach(function(d) {
          if (!repoSet[d.repository]) { repoSet[d.repository] = true; repos.push(d.repository); }
          if (!dateSet[d.date]) { dateSet[d.date] = true; dates.push(d.date); }
        });
        dates.sort();

        var margin = { top: 30, right: 20, bottom: 50, left: 60 };
        var width = Math.max(400, container.clientWidth) - margin.left - margin.right;
        var height = 280 - margin.top - margin.bottom;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom);
        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var x = d3.scaleBand().domain(dates).range([0, width]).padding(0.15);
        var maxVal = d3.max(dates, function(date) {
          return repos.reduce(function(sum, repo) {
            var pt = dataPoints.find(function(d) { return d.date === date && d.repository === repo; });
            return sum + (pt ? pt.locCount : 0);
          }, 0);
        });
        var y = d3.scaleLinear().domain([0, maxVal || 1]).nice().range([height, 0]);
        var color = d3.scaleOrdinal().domain(repos).range(CHART_COLORS);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
          .selectAll('line').attr('stroke', chartDefaults.borderColor + '33').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // X Axis
        g.append('g').attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickValues(dates.filter(function(_, i) {
            return dates.length <= 15 || i % Math.ceil(dates.length / 15) === 0;
          })))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px')
          .attr('transform', 'rotate(-35)').attr('text-anchor', 'end');

        // Y Axis with K/M formatting (IQS-919)
        g.append('g').call(d3.axisLeft(y).ticks(6).tickFormat(formatLocAxis))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px');

        if (granularity === 'day') {
          // Grouped bar chart
          var x1 = d3.scaleBand().domain(repos).range([0, x.bandwidth()]).padding(0.05);
          dates.forEach(function(date) {
            repos.forEach(function(repo) {
              var pt = dataPoints.find(function(d) { return d.date === date && d.repository === repo; });
              var val = pt ? pt.locCount : 0;
              if (val <= 0) { return; }
              g.append('rect')
                .attr('x', x(date) + x1(repo))
                .attr('y', y(val))
                .attr('width', x1.bandwidth())
                .attr('height', height - y(val))
                .attr('fill', color(repo) + '88')
                .attr('stroke', color(repo))
                .attr('stroke-width', 1)
                .attr('aria-label', escapeHtml(repo) + ' on ' + escapeHtml(date) + ': ' + formatLocTooltip(val))
                .on('mouseover', function(event) { showTooltip(event, '<strong>' + escapeHtml(repo) + '</strong><br>' + escapeHtml(date) + '<br>' + formatLocTooltip(val)); })
                .on('mousemove', moveTooltip)
                .on('mouseout', hideTooltip);
            });
          });
        } else {
          // Line chart
          repos.forEach(function(repo) {
            var lineData = dates.map(function(date) {
              var pt = dataPoints.find(function(d) { return d.date === date && d.repository === repo; });
              return { date: date, value: pt ? pt.locCount : 0 };
            });
            var line = d3.line()
              .x(function(d) { return x(d.date) + x.bandwidth() / 2; })
              .y(function(d) { return y(d.value); })
              .defined(function(d) { return d.value !== null; });

            g.append('path').datum(lineData)
              .attr('fill', 'none').attr('stroke', color(repo)).attr('stroke-width', 2).attr('d', line);

            lineData.forEach(function(d) {
              g.append('circle')
                .attr('cx', x(d.date) + x.bandwidth() / 2).attr('cy', y(d.value)).attr('r', 3).attr('fill', color(repo))
                .attr('aria-label', escapeHtml(repo) + ' on ' + escapeHtml(d.date) + ': ' + formatLocTooltip(d.value))
                .on('mouseover', function(event) { showTooltip(event, '<strong>' + escapeHtml(repo) + '</strong><br>' + escapeHtml(d.date) + '<br>' + formatLocTooltip(d.value)); })
                .on('mousemove', moveTooltip).on('mouseout', hideTooltip);
            });
          });
        }

        // Title (IQS-919: Changed from "Commits per" to "LOC per")
        svg.append('text').attr('x', margin.left + width / 2).attr('y', 16)
          .attr('text-anchor', 'middle').attr('fill', chartDefaults.color)
          .attr('font-size', '12px').attr('font-weight', '600').text('LOC per ' + granularity);

        // Legend
        var legend = svg.append('g').attr('transform', 'translate(' + (margin.left + 10) + ',' + (height + margin.top + 36) + ')');
        repos.forEach(function(repo, i) {
          var lg = legend.append('g').attr('transform', 'translate(' + (i * 120) + ',0)');
          lg.append('rect').attr('width', 10).attr('height', 10).attr('fill', color(repo));
          lg.append('text').attr('x', 14).attr('y', 9).attr('fill', chartDefaults.color).attr('font-size', '10px').text(repo);
        });
      }
  `;
}

// ============================================================================
// D3.js Arc/Pie Chart Script
// ============================================================================

/**
 * Generate the JavaScript source for an arc/pie (doughnut) chart renderer.
 * Used by both Tech Stack Distribution and Jira Project Distribution.
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateArcChartScript(): string {
  return `
      // ======================================================================
      // Arc/Pie (Doughnut) Chart Helper (D3.js) (IQS-887)
      // ======================================================================
      function renderArcChart(container, entries, labelFn, valueFn, emptyMsg) {
        if (!entries || entries.length === 0) {
          container.style.display = 'none';
          if (emptyMsg) { emptyMsg.style.display = 'block'; }
          return;
        }
        container.style.display = 'block';
        if (emptyMsg) { emptyMsg.style.display = 'none'; }
        container.innerHTML = '';

        var containerWidth = Math.max(300, container.clientWidth);
        var chartWidth = Math.min(containerWidth * 0.6, 240);
        var totalHeight = Math.max(250, entries.length * 22);
        var radius = Math.min(chartWidth, totalHeight) / 2 - 10;

        var svg = d3.select(container).append('svg').attr('width', containerWidth).attr('height', totalHeight);

        var labels = entries.map(labelFn);
        var colors = labels.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length]; });
        var color = d3.scaleOrdinal().domain(labels).range(colors);

        var pie = d3.pie().value(valueFn).sort(null);
        var arcGen = d3.arc().innerRadius(radius * 0.5).outerRadius(radius);
        var arcHover = d3.arc().innerRadius(radius * 0.5).outerRadius(radius + 6);

        var chartG = svg.append('g').attr('transform', 'translate(' + (chartWidth / 2) + ',' + (totalHeight / 2) + ')');
        var total = entries.reduce(function(s, e) { return s + valueFn(e); }, 0);

        chartG.selectAll('path').data(pie(entries)).enter().append('path')
          .attr('d', arcGen)
          .attr('fill', function(d) { return color(labelFn(d.data)); })
          .attr('stroke', chartDefaults.backgroundColor).attr('stroke-width', 2)
          .attr('aria-label', function(d) {
            var pct = total > 0 ? ((valueFn(d.data) / total) * 100).toFixed(1) : '0';
            return escapeHtml(labelFn(d.data)) + ': ' + valueFn(d.data) + ' (' + pct + '%)';
          })
          .on('mouseover', function(event, d) {
            d3.select(this).attr('d', arcHover);
            var pct = total > 0 ? ((valueFn(d.data) / total) * 100).toFixed(1) : '0';
            showTooltip(event, '<strong>' + escapeHtml(labelFn(d.data)) + '</strong><br>' + valueFn(d.data) + ' (' + pct + '%)');
          })
          .on('mousemove', moveTooltip)
          .on('mouseout', function() { d3.select(this).attr('d', arcGen); hideTooltip(); });

        // Legend (right side)
        var legendG = svg.append('g').attr('transform', 'translate(' + (chartWidth + 10) + ',10)');
        entries.forEach(function(entry, i) {
          var name = labelFn(entry);
          var item = legendG.append('g').attr('transform', 'translate(0,' + (i * 20) + ')');
          item.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', color(name));
          item.append('text').attr('x', 14).attr('y', 9).attr('fill', chartDefaults.color).attr('font-size', '11px')
            .text(name + ' (' + valueFn(entry) + ')');
        });
      }
  `;
}

// ============================================================================
// D3.js Complexity Line Chart Script
// ============================================================================

/**
 * Generate the JavaScript source for the File Complexity Trends chart renderer.
 * Multi-line chart showing complexity over time for top N files.
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateComplexityChartScript(): string {
  return `
      // ======================================================================
      // File Complexity Trends Chart (D3.js multi-line) (IQS-887)
      // ======================================================================
      function renderComplexityChart(dataPoints) {
        hideLoading('complexityCard');
        cachedComplexityData = dataPoints;
        var container = document.getElementById('complexityChart');
        var emptyMsg = document.getElementById('complexityEmpty');

        if (!dataPoints || dataPoints.length === 0) {
          container.style.display = 'none';
          emptyMsg.style.display = 'block';
          return;
        }
        container.style.display = 'block';
        emptyMsg.style.display = 'none';
        container.innerHTML = '';

        var files = []; var fileSet = {}; var dates = []; var dateSet = {};
        dataPoints.forEach(function(d) {
          if (!fileSet[d.filename]) { fileSet[d.filename] = true; files.push(d.filename); }
          if (!dateSet[d.commitDate]) { dateSet[d.commitDate] = true; dates.push(d.commitDate); }
        });
        dates.sort();
        var displayFiles = files.slice(0, 10);

        var margin = { top: 30, right: 20, bottom: 70, left: 55 };
        var width = Math.max(400, container.clientWidth) - margin.left - margin.right;
        var height = 300 - margin.top - margin.bottom;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom);
        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var x = d3.scalePoint().domain(dates).range([0, width]);
        var maxC = d3.max(dataPoints, function(d) { return d.complexity; }) || 1;
        var y = d3.scaleLinear().domain([0, maxC]).nice().range([height, 0]);
        var color = d3.scaleOrdinal().domain(displayFiles).range(CHART_COLORS);

        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
          .selectAll('line').attr('stroke', chartDefaults.borderColor + '33').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        g.append('g').attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickValues(dates.filter(function(_, i) {
            return dates.length <= 10 || i % Math.ceil(dates.length / 10) === 0;
          })))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px')
          .attr('transform', 'rotate(-45)').attr('text-anchor', 'end');

        g.append('g').call(d3.axisLeft(y).ticks(6))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px');

        g.append('text').attr('transform', 'rotate(-90)')
          .attr('y', -40).attr('x', -height / 2).attr('text-anchor', 'middle')
          .attr('fill', chartDefaults.color).attr('font-size', '11px').text('Complexity');

        displayFiles.forEach(function(file) {
          var shortName = file.split('/').pop() || file;
          var lineData = dates.map(function(date) {
            var pt = dataPoints.find(function(d) { return d.commitDate === date && d.filename === file; });
            return { date: date, value: pt ? pt.complexity : null };
          });
          var line = d3.line()
            .defined(function(d) { return d.value !== null; })
            .x(function(d) { return x(d.date); })
            .y(function(d) { return y(d.value); })
            .curve(d3.curveMonotoneX);

          g.append('path').datum(lineData)
            .attr('fill', 'none').attr('stroke', color(file)).attr('stroke-width', 2).attr('d', line);

          lineData.forEach(function(d) {
            if (d.value === null) { return; }
            g.append('circle').attr('cx', x(d.date)).attr('cy', y(d.value)).attr('r', 2.5).attr('fill', color(file))
              .attr('aria-label', escapeHtml(shortName) + ' on ' + escapeHtml(d.date) + ': ' + d.value)
              .on('mouseover', function(event) { showTooltip(event, '<strong>' + escapeHtml(shortName) + '</strong><br>' + escapeHtml(d.date) + '<br>Complexity: ' + d.value); })
              .on('mousemove', moveTooltip).on('mouseout', hideTooltip);
          });
        });

        svg.append('text').attr('x', margin.left + width / 2).attr('y', 16)
          .attr('text-anchor', 'middle').attr('fill', chartDefaults.color)
          .attr('font-size', '12px').attr('font-weight', '600').text('File Complexity Over Time (Top Files)');

        var legendY = height + margin.top + 52;
        var legendG = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + legendY + ')');
        var xOffset = 0;
        displayFiles.forEach(function(file) {
          var shortName = file.split('/').pop() || file;
          var lg = legendG.append('g').attr('transform', 'translate(' + xOffset + ',0)');
          lg.append('rect').attr('width', 10).attr('height', 10).attr('fill', color(file));
          lg.append('text').attr('x', 13).attr('y', 9).attr('fill', chartDefaults.color).attr('font-size', '10px').text(shortName);
          xOffset += Math.min(shortName.length * 7 + 22, 120);
        });
      }
  `;
}

// ============================================================================
// D3.js Stacked Bar Chart Script
// ============================================================================

/**
 * Generate the JavaScript source for the Status Flow Timeline chart renderer.
 * Stacked bar chart showing status transitions over time.
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateStackedBarChartScript(): string {
  return `
      // ======================================================================
      // Status Flow Stacked Bar Chart (D3.js) (IQS-887)
      // ======================================================================
      function renderStackedBarChart(container, dataPoints, dateKey, categoryKey, valueKey, emptyMsg, title, yLabel) {
        if (!dataPoints || dataPoints.length === 0) {
          container.style.display = 'none';
          if (emptyMsg) { emptyMsg.style.display = 'block'; }
          return;
        }
        container.style.display = 'block';
        if (emptyMsg) { emptyMsg.style.display = 'none'; }
        container.innerHTML = '';

        var categories = []; var catSet = {}; var dates = []; var dateSetLocal = {};
        dataPoints.forEach(function(d) {
          if (!catSet[d[categoryKey]]) { catSet[d[categoryKey]] = true; categories.push(d[categoryKey]); }
          if (!dateSetLocal[d[dateKey]]) { dateSetLocal[d[dateKey]] = true; dates.push(d[dateKey]); }
        });
        dates.sort();

        var stackData = dates.map(function(date) {
          var entry = { date: date };
          categories.forEach(function(cat) {
            var pt = dataPoints.find(function(d) { return d[dateKey] === date && d[categoryKey] === cat; });
            entry[cat] = pt ? pt[valueKey] : 0;
          });
          return entry;
        });

        var margin = { top: 30, right: 20, bottom: 50, left: 50 };
        var containerWidth = Math.max(300, container.clientWidth);
        var width = containerWidth - margin.left - margin.right;
        var height = 250 - margin.top - margin.bottom;

        var svg = d3.select(container).append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom);
        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var x = d3.scaleBand().domain(dates).range([0, width]).padding(0.15);
        var color = d3.scaleOrdinal().domain(categories).range(CHART_COLORS);
        var stack = d3.stack().keys(categories);
        var series = stack(stackData);
        var maxVal = d3.max(series, function(s) { return d3.max(s, function(d) { return d[1]; }); }) || 1;
        var y = d3.scaleLinear().domain([0, maxVal]).nice().range([height, 0]);

        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
          .selectAll('line').attr('stroke', chartDefaults.borderColor + '33').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        series.forEach(function(catSeries) {
          g.selectAll('.bar-' + catSeries.key.replace(/[^a-zA-Z0-9]/g, '_'))
            .data(catSeries).enter().append('rect')
            .attr('x', function(d) { return x(d.data.date); })
            .attr('y', function(d) { return y(d[1]); })
            .attr('width', x.bandwidth())
            .attr('height', function(d) { return Math.max(0, y(d[0]) - y(d[1])); })
            .attr('fill', color(catSeries.key) + '88')
            .attr('stroke', color(catSeries.key)).attr('stroke-width', 1)
            .attr('aria-label', function(d) { return escapeHtml(catSeries.key) + ' on ' + escapeHtml(d.data.date) + ': ' + (d[1] - d[0]); })
            .on('mouseover', function(event, d) { showTooltip(event, '<strong>' + escapeHtml(catSeries.key) + '</strong><br>' + escapeHtml(d.data.date) + '<br>' + (d[1] - d[0]) + ' ' + yLabel); })
            .on('mousemove', moveTooltip).on('mouseout', hideTooltip);
        });

        g.append('g').attr('transform', 'translate(0,' + height + ')')
          .call(d3.axisBottom(x).tickValues(dates.filter(function(_, i) {
            return dates.length <= 10 || i % Math.ceil(dates.length / 10) === 0;
          })))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px')
          .attr('transform', 'rotate(-45)').attr('text-anchor', 'end');

        g.append('g').call(d3.axisLeft(y).ticks(6))
          .selectAll('text').attr('fill', chartDefaults.color).attr('font-size', '10px');

        g.append('text').attr('transform', 'rotate(-90)')
          .attr('y', -38).attr('x', -height / 2).attr('text-anchor', 'middle')
          .attr('fill', chartDefaults.color).attr('font-size', '11px').text(yLabel);

        svg.append('text').attr('x', margin.left + width / 2).attr('y', 16)
          .attr('text-anchor', 'middle').attr('fill', chartDefaults.color)
          .attr('font-size', '12px').attr('font-weight', '600').text(title);

        var legendArea = svg.append('g').attr('transform', 'translate(' + (margin.left + 10) + ',' + (height + margin.top + 40) + ')');
        var xOff = 0;
        categories.forEach(function(cat) {
          var lg = legendArea.append('g').attr('transform', 'translate(' + xOff + ',0)');
          lg.append('rect').attr('width', 10).attr('height', 10).attr('fill', color(cat));
          lg.append('text').attr('x', 13).attr('y', 9).attr('fill', chartDefaults.color).attr('font-size', '10px').text(cat);
          xOff += Math.min(cat.length * 7 + 22, 120);
        });
      }
  `;
}

// ============================================================================
// Combined D3 Chart Script Generator
// ============================================================================

/**
 * Generate all D3.js chart scripts combined into a single block.
 * Main entry point for webview HTML generators.
 *
 * @returns Combined JavaScript source for all D3.js chart utilities
 */
export function generateAllD3ChartScripts(): string {
  return [
    generateD3ChartInfraScript(),
    generateArcChartScript(),
    generateVelocityChartScript(),
    generateComplexityChartScript(),
    generateStackedBarChartScript(),
    generateLocCommittedChartScript(),
    generateTopComplexFilesChartScript(),
    generateFileChurnChartScript(),
  ].join('\n');
}
