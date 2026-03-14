/**
 * D3.js chart rendering logic for the Sprint Velocity vs LOC chart.
 * Generates JavaScript source for the dual-axis line chart with:
 * - Human Estimate line (left Y-axis)
 * - AI Measurement line (left Y-axis)
 * - LOC Changed line (right Y-axis)
 * - Interactive tooltips with variance calculation
 * - Colorblind-accessible markers (circle, square, triangle)
 *
 * Ticket: IQS-888, IQS-944, IQS-946
 */

/**
 * Generate the JavaScript source for D3.js chart rendering.
 * Returns a string to be embedded in a <script> block.
 *
 * This includes:
 * - renderChart(data) - Main chart rendering function
 * - renderLegend() - Legend with marker icons
 * - showTooltip/moveTooltip/hideTooltip - Tooltip interaction
 *
 * @returns JavaScript source for D3 chart rendering
 */
export function generateD3ChartScript(): string {
  return `
      // ======================================================================
      // D3.js Chart Rendering (IQS-888, IQS-944)
      // ======================================================================

      /**
       * Render the dual-axis line chart with three series.
       * @param {Array} data - Aggregated velocity data points
       */
      function renderChart(data) {
        if (!data || data.length === 0) { return; }

        // Render legend first
        renderLegend();

        // Chart dimensions
        var margin = { top: 30, right: 70, bottom: 50, left: 60 };
        var containerWidth = Math.max(500, document.querySelector('.chart-svg-container').clientWidth - 24);
        var width = containerWidth;
        var height = 360;

        var svg = d3.select('#chartSvg');
        svg.selectAll('*').remove();
        svg.attr('width', width).attr('height', height)
           .attr('role', 'img')
           .attr('aria-label', 'Dual-axis line chart: Human vs AI Story Points (left) and LOC Changed (right) by period');

        var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
        var innerWidth = width - margin.left - margin.right;
        var innerHeight = height - margin.top - margin.bottom;

        // X Scale: period dates
        var periods = data.map(function(d) { return d.weekStart; });
        var x = d3.scalePoint().domain(periods).range([0, innerWidth]).padding(0.5);

        // Left Y Scale: Story Points (shared for Human and AI)
        var maxSP = d3.max(data, function(d) {
          return Math.max(d.humanStoryPoints || 0, d.aiStoryPoints || 0);
        }) || 1;
        var yLeft = d3.scaleLinear().domain([0, maxSP]).nice().range([innerHeight, 0]);

        // Right Y Scale: LOC Changed
        var maxLOC = d3.max(data, function(d) { return d.totalLocChanged; }) || 1;
        var yRight = d3.scaleLinear().domain([0, maxLOC]).nice().range([innerHeight, 0]);

        // Grid lines
        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(yLeft).tickSize(-innerWidth).tickFormat(''))
          .selectAll('line').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();

        // X Axis
        var tickValues = periods;
        if (periods.length > 15) {
          var step = Math.ceil(periods.length / 15);
          tickValues = periods.filter(function(_, i) { return i % step === 0; });
        }
        g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(0,' + innerHeight + ')')
          .call(d3.axisBottom(x).tickValues(tickValues))
          .selectAll('text')
          .attr('transform', 'rotate(-35)')
          .attr('text-anchor', 'end')
          .attr('font-size', '10px');

        // Left Y Axis (Story Points) - neutral color since two series share it
        var leftAxis = g.append('g').attr('class', 'axis')
          .call(d3.axisLeft(yLeft).ticks(6));
        leftAxis.selectAll('text').attr('fill', 'var(--vscode-foreground, #cccccc)');
        leftAxis.selectAll('line').attr('stroke', 'var(--vscode-foreground, #cccccc)44');
        leftAxis.select('.domain').attr('stroke', 'var(--vscode-foreground, #cccccc)66');

        // Left Y Axis Label
        g.append('text').attr('transform', 'rotate(-90)')
          .attr('y', -45).attr('x', -innerHeight / 2).attr('text-anchor', 'middle')
          .attr('fill', 'var(--vscode-foreground, #cccccc)').attr('font-size', '11px')
          .text('Story Points');

        // Right Y Axis (LOC) - colored to match series
        var rightAxis = g.append('g').attr('class', 'axis')
          .attr('transform', 'translate(' + innerWidth + ',0)')
          .call(d3.axisRight(yRight).ticks(6).tickFormat(function(d) {
            if (d >= 1000000) { return (d / 1000000).toFixed(1) + 'M'; }
            if (d >= 1000) { return (d / 1000).toFixed(0) + 'K'; }
            return d;
          }));
        rightAxis.selectAll('text').attr('fill', SERIES_CONFIG.locChanged.color);
        rightAxis.selectAll('line').attr('stroke', SERIES_CONFIG.locChanged.color + '44');
        rightAxis.select('.domain').attr('stroke', SERIES_CONFIG.locChanged.color + '66');

        // Right Y Axis Label
        g.append('text').attr('transform', 'rotate(90)')
          .attr('y', -(innerWidth + 55)).attr('x', innerHeight / 2).attr('text-anchor', 'middle')
          .attr('fill', SERIES_CONFIG.locChanged.color).attr('font-size', '11px')
          .text('LOC Changed');

        // ---- Human Estimate Line (Left Y) ----
        var humanLine = d3.line()
          .x(function(d) { return x(d.weekStart); })
          .y(function(d) { return yLeft(d.humanStoryPoints || 0); })
          .curve(d3.curveMonotoneX);

        g.append('path').datum(data)
          .attr('fill', 'none')
          .attr('stroke', SERIES_CONFIG.humanEstimate.color)
          .attr('stroke-width', 2.5)
          .attr('d', humanLine);

        // Circle markers for human estimates
        data.forEach(function(d) {
          g.append('circle')
            .attr('cx', x(d.weekStart))
            .attr('cy', yLeft(d.humanStoryPoints || 0))
            .attr('r', SERIES_CONFIG.humanEstimate.markerSize)
            .attr('fill', SERIES_CONFIG.humanEstimate.color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1.5)
            .attr('aria-label', 'Period ' + escapeHtml(d.weekStart) + ': ' + (d.humanStoryPoints || 0) + ' human estimate points')
            .on('mouseover', function(event) { showTooltip(event, d); })
            .on('mousemove', function(event) { moveTooltip(event); })
            .on('mouseout', hideTooltip);
        });

        // ---- AI Measurement Line (Left Y) ----
        var aiLine = d3.line()
          .x(function(d) { return x(d.weekStart); })
          .y(function(d) { return yLeft(d.aiStoryPoints || 0); })
          .curve(d3.curveMonotoneX);

        g.append('path').datum(data)
          .attr('fill', 'none')
          .attr('stroke', SERIES_CONFIG.aiMeasurement.color)
          .attr('stroke-width', 2.5)
          .attr('d', aiLine);

        // Square markers for AI measurements
        var squareSymbol = d3.symbol().type(d3.symbolSquare).size(50);
        data.forEach(function(d) {
          g.append('path')
            .attr('d', squareSymbol())
            .attr('transform', 'translate(' + x(d.weekStart) + ',' + yLeft(d.aiStoryPoints || 0) + ')')
            .attr('fill', SERIES_CONFIG.aiMeasurement.color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1.5)
            .attr('aria-label', 'Period ' + escapeHtml(d.weekStart) + ': ' + (d.aiStoryPoints || 0) + ' AI calculated points')
            .on('mouseover', function(event) { showTooltip(event, d); })
            .on('mousemove', function(event) { moveTooltip(event); })
            .on('mouseout', hideTooltip);
        });

        // ---- LOC Line (Right Y) ----
        var locLine = d3.line()
          .x(function(d) { return x(d.weekStart); })
          .y(function(d) { return yRight(d.totalLocChanged); })
          .curve(d3.curveMonotoneX);

        g.append('path').datum(data)
          .attr('fill', 'none')
          .attr('stroke', SERIES_CONFIG.locChanged.color)
          .attr('stroke-width', 2.5)
          .attr('d', locLine);

        // Triangle markers for LOC
        var triangleSymbol = d3.symbol().type(d3.symbolTriangle).size(60);
        data.forEach(function(d) {
          g.append('path')
            .attr('d', triangleSymbol())
            .attr('transform', 'translate(' + x(d.weekStart) + ',' + yRight(d.totalLocChanged) + ')')
            .attr('fill', SERIES_CONFIG.locChanged.color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1.5)
            .attr('aria-label', 'Period ' + escapeHtml(d.weekStart) + ': ' + d.totalLocChanged.toLocaleString() + ' LOC changed')
            .on('mouseover', function(event) { showTooltip(event, d); })
            .on('mousemove', function(event) { moveTooltip(event); })
            .on('mouseout', hideTooltip);
        });

        // Announce update to screen readers
        var liveRegion = document.getElementById('summaryStats');
        if (liveRegion) {
          liveRegion.setAttribute('aria-live', 'polite');
        }
      }
  `;
}

/**
 * Generate the JavaScript source for legend rendering.
 * Returns a string to be embedded in a <script> block.
 *
 * @returns JavaScript source for renderLegend function
 */
export function generateLegendScript(): string {
  return `
      // ======================================================================
      // Legend Rendering (IQS-944)
      // ======================================================================

      /**
       * Render the chart legend with marker icons for each series.
       */
      function renderLegend() {
        legendContainer.innerHTML = '';

        // Human Estimate legend entry with circle marker
        var humanItem = document.createElement('div');
        humanItem.className = 'legend-item';
        var humanSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        humanSvg.setAttribute('width', '30');
        humanSvg.setAttribute('height', '14');
        var humanLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        humanLine.setAttribute('x1', '0');
        humanLine.setAttribute('y1', '7');
        humanLine.setAttribute('x2', '20');
        humanLine.setAttribute('y2', '7');
        humanLine.setAttribute('stroke', SERIES_CONFIG.humanEstimate.color);
        humanLine.setAttribute('stroke-width', '2');
        humanSvg.appendChild(humanLine);
        var humanCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        humanCircle.setAttribute('cx', '10');
        humanCircle.setAttribute('cy', '7');
        humanCircle.setAttribute('r', '4');
        humanCircle.setAttribute('fill', SERIES_CONFIG.humanEstimate.color);
        humanSvg.appendChild(humanCircle);
        humanItem.appendChild(humanSvg);
        var humanLabel = document.createElement('span');
        humanLabel.textContent = SERIES_CONFIG.humanEstimate.label;
        humanItem.appendChild(humanLabel);
        legendContainer.appendChild(humanItem);

        // AI Measurement legend entry with square marker
        var aiItem = document.createElement('div');
        aiItem.className = 'legend-item';
        var aiSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        aiSvg.setAttribute('width', '30');
        aiSvg.setAttribute('height', '14');
        var aiLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        aiLine.setAttribute('x1', '0');
        aiLine.setAttribute('y1', '7');
        aiLine.setAttribute('x2', '20');
        aiLine.setAttribute('y2', '7');
        aiLine.setAttribute('stroke', SERIES_CONFIG.aiMeasurement.color);
        aiLine.setAttribute('stroke-width', '2');
        aiSvg.appendChild(aiLine);
        var aiSquare = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        aiSquare.setAttribute('x', '6');
        aiSquare.setAttribute('y', '3');
        aiSquare.setAttribute('width', '8');
        aiSquare.setAttribute('height', '8');
        aiSquare.setAttribute('fill', SERIES_CONFIG.aiMeasurement.color);
        aiSvg.appendChild(aiSquare);
        aiItem.appendChild(aiSvg);
        var aiLabel = document.createElement('span');
        aiLabel.textContent = SERIES_CONFIG.aiMeasurement.label;
        aiItem.appendChild(aiLabel);
        legendContainer.appendChild(aiItem);

        // LOC legend entry with triangle marker
        var locItem = document.createElement('div');
        locItem.className = 'legend-item';
        var locSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        locSvg.setAttribute('width', '30');
        locSvg.setAttribute('height', '14');
        var locLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        locLine.setAttribute('x1', '0');
        locLine.setAttribute('y1', '7');
        locLine.setAttribute('x2', '20');
        locLine.setAttribute('y2', '7');
        locLine.setAttribute('stroke', SERIES_CONFIG.locChanged.color);
        locLine.setAttribute('stroke-width', '2');
        locSvg.appendChild(locLine);
        var locTriangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        locTriangle.setAttribute('points', '10,2 14,12 6,12');
        locTriangle.setAttribute('fill', SERIES_CONFIG.locChanged.color);
        locSvg.appendChild(locTriangle);
        locItem.appendChild(locSvg);
        var locLabel = document.createElement('span');
        locLabel.textContent = SERIES_CONFIG.locChanged.label;
        locItem.appendChild(locLabel);
        legendContainer.appendChild(locItem);
      }
  `;
}

/**
 * Generate the JavaScript source for tooltip interactions.
 * Returns a string to be embedded in a <script> block.
 *
 * @returns JavaScript source for tooltip functions
 */
export function generateTooltipScript(): string {
  return `
      // ======================================================================
      // Tooltip Functions (IQS-944)
      // ======================================================================

      /**
       * Show tooltip with variance calculation for a data point.
       * @param {Event} event - Mouse event
       * @param {Object} d - Data point
       */
      function showTooltip(event, d) {
        var humanPts = d.humanStoryPoints || 0;
        var aiPts = d.aiStoryPoints || 0;
        var delta = humanPts - aiPts;
        var deltaPercent = aiPts > 0 ? ((Math.abs(delta) / aiPts) * 100).toFixed(0) : (humanPts > 0 ? '100' : '0');
        var deltaLabel = delta > 0 ? 'overestimated' : delta < 0 ? 'underestimated' : 'matched';

        var periodLabel = currentAggregation === 'day' ? 'Day' : currentAggregation === 'biweekly' ? 'Bi-week of' : 'Week of';

        tooltip.innerHTML =
          '<div class="tt-component"><strong>' + periodLabel + ' ' + escapeHtml(d.weekStart) + '</strong></div>' +
          '<div class="tt-value" style="color:' + SERIES_CONFIG.humanEstimate.color + '">' +
            'Human: ' + escapeHtml(String(humanPts)) + ' points (' + escapeHtml(String(d.issueCount)) + ' issues)</div>' +
          '<div class="tt-value" style="color:' + SERIES_CONFIG.aiMeasurement.color + '">' +
            'AI: ' + escapeHtml(String(aiPts)) + ' points (calculated)</div>' +
          '<hr style="border-color: var(--vscode-panel-border, #444); margin: 4px 0;">' +
          '<div class="tt-variance"><strong>Variance:</strong> ' + Math.abs(delta) + ' points (' + deltaPercent + '%) ' + deltaLabel + '</div>' +
          '<div class="tt-value" style="color:' + SERIES_CONFIG.locChanged.color + '">' +
            escapeHtml(d.totalLocChanged.toLocaleString()) + ' LOC changed (' + escapeHtml(String(d.commitCount)) + ' commits)</div>' +
          '<div class="tt-team">+' + escapeHtml(d.totalLinesAdded.toLocaleString()) + ' / -' +
            escapeHtml(d.totalLinesDeleted.toLocaleString()) + ' lines</div>';
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        moveTooltip(event);
      }

      /**
       * Update tooltip position to follow mouse.
       * @param {Event} event - Mouse event
       */
      function moveTooltip(event) {
        tooltip.style.left = (event.pageX + 12) + 'px';
        tooltip.style.top = (event.pageY - 28) + 'px';
      }

      /**
       * Hide the tooltip.
       */
      function hideTooltip() {
        tooltip.classList.remove('visible');
        tooltip.setAttribute('aria-hidden', 'true');
      }
  `;
}
