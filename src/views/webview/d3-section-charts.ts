/**
 * D3 individual chart renderers for the Development Pipeline section.
 * Each function generates JavaScript source for a specific chart type:
 * - LOC Chart (connected line chart)
 * - Complexity Chart (connected scatter)
 * - Comments Chart (line chart)
 * - Tests Chart (stacked bar chart)
 *
 * Ticket: IQS-930 (extracted from d3-dev-pipeline-section.ts)
 */

/**
 * Generate JavaScript source for the LOC chart renderer.
 * @returns JavaScript source string
 */
export function generateLocChartScript(): string {
  return `
    // ======================================================================
    // LOC Chart (Connected Line Chart)
    // ======================================================================

    function renderLocChart(data, authorList) {
      var svg = d3.select('#locChart');
      svg.selectAll('*').remove();

      var dims = getChartDimensions('locChart');
      svg.attr('width', dims.width).attr('height', dims.height);

      var g = svg.append('g').attr('transform', 'translate(' + dims.margin.left + ',' + dims.margin.top + ')');

      var parseDate = d3.timeParse('%Y-%m-%d');
      var xExtent = d3.extent(data, function(d) { return parseDate(d.weekStart); });
      var x = d3.scaleTime().domain(xExtent).range([0, dims.innerWidth]);

      var yExtent = d3.extent(data, function(d) { return d.totalLocDelta; });
      var yPadding = Math.max(1, (yExtent[1] - yExtent[0]) * 0.1);
      var y = d3.scaleLinear()
        .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
        .nice()
        .range([dims.innerHeight, 0]);

      var gridColor = getVSCodeThemeColor('--vscode-panel-border', '#444444');
      g.append('g').attr('class', 'grid')
        .call(d3.axisLeft(y).tickSize(-dims.innerWidth).tickFormat(''))
        .selectAll('line').attr('stroke', gridColor).attr('stroke-opacity', 0.15);
      g.selectAll('.grid .domain').remove();

      var foregroundColor = getVSCodeThemeColor('--vscode-foreground', '#cccccc');
      g.append('line')
        .attr('x1', 0).attr('x2', dims.innerWidth)
        .attr('y1', y(0)).attr('y2', y(0))
        .attr('stroke', foregroundColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .attr('opacity', 0.5);

      g.append('g').attr('class', 'axis')
        .attr('transform', 'translate(0,' + dims.innerHeight + ')')
        .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%m/%d')))
        .selectAll('text').attr('transform', 'rotate(-35)').attr('text-anchor', 'end');

      g.append('g').attr('class', 'axis')
        .call(d3.axisLeft(y).ticks(6));

      g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -60)
        .attr('x', -dims.innerHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', foregroundColor)
        .attr('font-size', '12px')
        .text('LOC Delta');

      var dataByAuthor = {};
      data.forEach(function(d) {
        var authorId = getAuthorId(d);
        if (!dataByAuthor[authorId]) dataByAuthor[authorId] = [];
        dataByAuthor[authorId].push(d);
      });

      Object.keys(dataByAuthor).forEach(function(authorId) {
        var authorData = dataByAuthor[authorId].sort(function(a, b) {
          return a.weekStart < b.weekStart ? -1 : 1;
        });
        var color = getDeveloperColor(authorId, authorList);

        var line = d3.line()
          .x(function(d) { return x(parseDate(d.weekStart)); })
          .y(function(d) { return y(d.totalLocDelta); })
          .curve(d3.curveMonotoneX);

        g.append('path')
          .datum(authorData)
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', 2)
          .attr('opacity', 0.6)
          .attr('d', line);

        authorData.forEach(function(d) {
          var cx = x(parseDate(d.weekStart));
          var cy = y(d.totalLocDelta);

          g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', 5)
            .attr('fill', color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1.5)
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', 'Week ' + d.weekStart + ', ' + getAuthorDisplayName(d) + ': ' + d.totalLocDelta + ' LOC')
            .on('mouseover', function(event) { showLocTooltip(event, d, color); })
            .on('mousemove', moveTooltip)
            .on('mouseout', hideTooltip)
            .on('click', function(event) { handlePointClick(event, d); });
        });
      });
    }

    function showLocTooltip(event, d, color) {
      var authorDisplay = getAuthorDisplayName(d);
      var authorLine = '<span style="color:' + color + '">\\u25cf</span> ' + escapeHtml(authorDisplay);
      var commitLink = buildCommitLink(d);

      tooltip.innerHTML =
        '<div><strong>Week: ' + escapeHtml(d.weekStart) + '</strong></div>' +
        '<div>Developer: ' + authorLine + '</div>' +
        '<hr style="margin: 4px 0; border: none; border-top: 1px solid var(--vscode-panel-border, #444);">' +
        '<div><strong>LOC Delta:</strong> ' + formatDelta(d.totalLocDelta) + '</div>' +
        '<div>Commits: ' + d.commitCount + '</div>' +
        commitLink;
      tooltip.classList.add('visible');
      tooltip.setAttribute('aria-hidden', 'false');
    }
  `;
}

/**
 * Generate JavaScript source for the Complexity chart renderer.
 * @returns JavaScript source string
 */
export function generateComplexityChartScript(): string {
  return `
    // ======================================================================
    // Complexity Chart (Connected Scatter)
    // ======================================================================

    function renderComplexityChart(data, authorList) {
      var svg = d3.select('#complexityChart');
      svg.selectAll('*').remove();

      var dims = getChartDimensions('complexityChart');
      svg.attr('width', dims.width).attr('height', dims.height);

      var g = svg.append('g').attr('transform', 'translate(' + dims.margin.left + ',' + dims.margin.top + ')');

      var parseDate = d3.timeParse('%Y-%m-%d');
      var xExtent = d3.extent(data, function(d) { return parseDate(d.weekStart); });
      var x = d3.scaleTime().domain(xExtent).range([0, dims.innerWidth]);

      var yExtent = d3.extent(data, function(d) { return d.totalComplexityDelta; });
      var yPadding = Math.max(1, (yExtent[1] - yExtent[0]) * 0.1);
      var y = d3.scaleLinear()
        .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
        .nice()
        .range([dims.innerHeight, 0]);

      var gridColor = getVSCodeThemeColor('--vscode-panel-border', '#444444');
      g.append('g').attr('class', 'grid')
        .call(d3.axisLeft(y).tickSize(-dims.innerWidth).tickFormat(''))
        .selectAll('line').attr('stroke', gridColor).attr('stroke-opacity', 0.15);
      g.selectAll('.grid .domain').remove();

      var foregroundColor = getVSCodeThemeColor('--vscode-foreground', '#cccccc');
      g.append('line')
        .attr('x1', 0).attr('x2', dims.innerWidth)
        .attr('y1', y(0)).attr('y2', y(0))
        .attr('stroke', foregroundColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .attr('opacity', 0.5);

      g.append('g').attr('class', 'axis')
        .attr('transform', 'translate(0,' + dims.innerHeight + ')')
        .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%m/%d')))
        .selectAll('text').attr('transform', 'rotate(-35)').attr('text-anchor', 'end');

      g.append('g').attr('class', 'axis')
        .call(d3.axisLeft(y).ticks(6));

      g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -60)
        .attr('x', -dims.innerHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', foregroundColor)
        .attr('font-size', '12px')
        .text('Complexity Delta');

      var dataByAuthor = {};
      data.forEach(function(d) {
        var authorId = getAuthorId(d);
        if (!dataByAuthor[authorId]) dataByAuthor[authorId] = [];
        dataByAuthor[authorId].push(d);
      });

      Object.keys(dataByAuthor).forEach(function(authorId) {
        var authorData = dataByAuthor[authorId].sort(function(a, b) {
          return a.weekStart < b.weekStart ? -1 : 1;
        });
        var color = getDeveloperColor(authorId, authorList);

        var line = d3.line()
          .x(function(d) { return x(parseDate(d.weekStart)); })
          .y(function(d) { return y(d.totalComplexityDelta); })
          .curve(d3.curveMonotoneX);

        g.append('path')
          .datum(authorData)
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', 2)
          .attr('opacity', 0.6)
          .attr('d', line);

        authorData.forEach(function(d) {
          var cx = x(parseDate(d.weekStart));
          var cy = y(d.totalComplexityDelta);

          g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', 4)
            .attr('fill', color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1.5)
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', 'Week ' + d.weekStart + ', ' + getAuthorDisplayName(d) + ': ' + d.totalComplexityDelta + ' complexity')
            .on('mouseover', function(event) { showComplexityTooltip(event, d, color); })
            .on('mousemove', moveTooltip)
            .on('mouseout', hideTooltip)
            .on('click', function(event) { handlePointClick(event, d); });
        });
      });
    }

    function showComplexityTooltip(event, d, color) {
      var authorDisplay = getAuthorDisplayName(d);
      var authorLine = '<span style="color:' + color + '">\\u25cf</span> ' + escapeHtml(authorDisplay);
      var commitLink = buildCommitLink(d);

      tooltip.innerHTML =
        '<div><strong>Week: ' + escapeHtml(d.weekStart) + '</strong></div>' +
        '<div>Developer: ' + authorLine + '</div>' +
        '<hr style="margin: 4px 0; border: none; border-top: 1px solid var(--vscode-panel-border, #444);">' +
        '<div><strong>Complexity Delta:</strong> ' + formatDelta(d.totalComplexityDelta) + '</div>' +
        '<div>Commits: ' + d.commitCount + '</div>' +
        commitLink;
      tooltip.classList.add('visible');
      tooltip.setAttribute('aria-hidden', 'false');
    }
  `;
}

/**
 * Generate JavaScript source for the Comments chart renderer.
 * @returns JavaScript source string
 */
export function generateCommentsChartScript(): string {
  return `
    // ======================================================================
    // Comments Ratio Chart (Line Chart)
    // ======================================================================

    function renderCommentsChart(data, authorList) {
      var svg = d3.select('#commentsChart');
      svg.selectAll('*').remove();

      var dims = getChartDimensions('commentsChart');
      svg.attr('width', dims.width).attr('height', dims.height);

      var g = svg.append('g').attr('transform', 'translate(' + dims.margin.left + ',' + dims.margin.top + ')');

      var parseDate = d3.timeParse('%Y-%m-%d');
      var xExtent = d3.extent(data, function(d) { return parseDate(d.weekStart); });
      var x = d3.scaleTime().domain(xExtent).range([0, dims.innerWidth]);

      var yExtent = d3.extent(data, function(d) { return d.commentsRatio; });
      var y = d3.scaleLinear()
        .domain([0, Math.max(100, yExtent[1] * 1.1)])
        .range([dims.innerHeight, 0]);

      var gridColor = getVSCodeThemeColor('--vscode-panel-border', '#444444');
      g.append('g').attr('class', 'grid')
        .call(d3.axisLeft(y).tickSize(-dims.innerWidth).tickFormat(''))
        .selectAll('line').attr('stroke', gridColor).attr('stroke-opacity', 0.15);
      g.selectAll('.grid .domain').remove();

      var foregroundColor = getVSCodeThemeColor('--vscode-foreground', '#cccccc');
      g.append('g').attr('class', 'axis')
        .attr('transform', 'translate(0,' + dims.innerHeight + ')')
        .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%m/%d')))
        .selectAll('text').attr('transform', 'rotate(-35)').attr('text-anchor', 'end');

      g.append('g').attr('class', 'axis')
        .call(d3.axisLeft(y).ticks(6).tickFormat(function(d) { return d + '%'; }));

      g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -60)
        .attr('x', -dims.innerHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', foregroundColor)
        .attr('font-size', '12px')
        .text('Comments Ratio (%)');

      var dataByAuthor = {};
      data.forEach(function(d) {
        var authorId = getAuthorId(d);
        if (!dataByAuthor[authorId]) dataByAuthor[authorId] = [];
        dataByAuthor[authorId].push(d);
      });

      Object.keys(dataByAuthor).forEach(function(authorId) {
        var authorData = dataByAuthor[authorId].sort(function(a, b) {
          return a.weekStart < b.weekStart ? -1 : 1;
        });
        var color = getDeveloperColor(authorId, authorList);

        var line = d3.line()
          .x(function(d) { return x(parseDate(d.weekStart)); })
          .y(function(d) { return y(d.commentsRatio); })
          .curve(d3.curveMonotoneX);

        g.append('path')
          .datum(authorData)
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', 2)
          .attr('d', line);

        authorData.forEach(function(d) {
          var cx = x(parseDate(d.weekStart));
          var cy = y(d.commentsRatio);

          g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', 4)
            .attr('fill', color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1.5)
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', 'Week ' + d.weekStart + ', ' + getAuthorDisplayName(d) + ': ' + d.commentsRatio.toFixed(1) + '% comments')
            .on('mouseover', function(event) { showCommentsTooltip(event, d, color); })
            .on('mousemove', moveTooltip)
            .on('mouseout', hideTooltip)
            .on('click', function(event) { handlePointClick(event, d); });
        });
      });
    }

    function showCommentsTooltip(event, d, color) {
      var authorDisplay = getAuthorDisplayName(d);
      var authorLine = '<span style="color:' + color + '">\\u25cf</span> ' + escapeHtml(authorDisplay);
      var commitLink = buildCommitLink(d);

      tooltip.innerHTML =
        '<div><strong>Week: ' + escapeHtml(d.weekStart) + '</strong></div>' +
        '<div>Developer: ' + authorLine + '</div>' +
        '<hr style="margin: 4px 0; border: none; border-top: 1px solid var(--vscode-panel-border, #444);">' +
        '<div><strong>Comments Ratio:</strong> ' + d.commentsRatio.toFixed(1) + '%</div>' +
        '<div>Comment Lines: ' + d.totalCommentLines + '</div>' +
        '<div>Code Lines: ' + d.totalCodeLines + '</div>' +
        '<div>Commits: ' + d.commitCount + '</div>' +
        commitLink;
      tooltip.classList.add('visible');
      tooltip.setAttribute('aria-hidden', 'false');
    }
  `;
}

/**
 * Generate JavaScript source for the Tests chart renderer.
 * @returns JavaScript source string
 */
export function generateTestsChartScript(): string {
  return `
    // ======================================================================
    // Tests Chart (Stacked Bar Chart)
    // ======================================================================

    function renderTestsChart(data, authorList) {
      var svg = d3.select('#testsChart');
      svg.selectAll('*').remove();

      var dims = getChartDimensions('testsChart');
      svg.attr('width', dims.width).attr('height', dims.height);

      var g = svg.append('g').attr('transform', 'translate(' + dims.margin.left + ',' + dims.margin.top + ')');

      var dataByWeek = {};
      data.forEach(function(d) {
        if (!dataByWeek[d.weekStart]) dataByWeek[d.weekStart] = [];
        dataByWeek[d.weekStart].push(d);
      });

      var weeks = Object.keys(dataByWeek).sort();

      var x = d3.scaleBand()
        .domain(weeks)
        .range([0, dims.innerWidth])
        .padding(0.2);

      var maxStack = 0;
      weeks.forEach(function(week) {
        var total = dataByWeek[week].reduce(function(sum, d) {
          return sum + Math.max(0, d.totalTestsDelta);
        }, 0);
        maxStack = Math.max(maxStack, total);
      });

      var y = d3.scaleLinear()
        .domain([0, maxStack * 1.1])
        .nice()
        .range([dims.innerHeight, 0]);

      var gridColor = getVSCodeThemeColor('--vscode-panel-border', '#444444');
      g.append('g').attr('class', 'grid')
        .call(d3.axisLeft(y).tickSize(-dims.innerWidth).tickFormat(''))
        .selectAll('line').attr('stroke', gridColor).attr('stroke-opacity', 0.15);
      g.selectAll('.grid .domain').remove();

      var foregroundColor = getVSCodeThemeColor('--vscode-foreground', '#cccccc');
      g.append('g').attr('class', 'axis')
        .attr('transform', 'translate(0,' + dims.innerHeight + ')')
        .call(d3.axisBottom(x).tickFormat(function(d) { return d.substring(5); }))
        .selectAll('text').attr('transform', 'rotate(-35)').attr('text-anchor', 'end');

      g.append('g').attr('class', 'axis')
        .call(d3.axisLeft(y).ticks(6));

      g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -60)
        .attr('x', -dims.innerHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', foregroundColor)
        .attr('font-size', '12px')
        .text('Test LOC Delta');

      weeks.forEach(function(week) {
        var weekData = dataByWeek[week];
        var yOffset = 0;

        weekData.forEach(function(d) {
          if (d.totalTestsDelta <= 0) return;

          var authorId = getAuthorId(d);
          var color = getDeveloperColor(authorId, authorList);
          var barHeight = dims.innerHeight - y(d.totalTestsDelta);

          g.append('rect')
            .attr('x', x(week))
            .attr('y', y(yOffset + d.totalTestsDelta))
            .attr('width', x.bandwidth())
            .attr('height', barHeight)
            .attr('fill', color)
            .attr('stroke', 'var(--vscode-editor-background, #1e1e1e)')
            .attr('stroke-width', 1)
            .attr('cursor', 'pointer')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', 'Week ' + week + ', ' + getAuthorDisplayName(d) + ': ' + d.totalTestsDelta + ' test LOC')
            .on('mouseover', function(event) { showTestsTooltip(event, d, color); })
            .on('mousemove', moveTooltip)
            .on('mouseout', hideTooltip)
            .on('click', function(event) { handlePointClick(event, d); });

          yOffset += d.totalTestsDelta;
        });
      });
    }

    function showTestsTooltip(event, d, color) {
      var authorDisplay = getAuthorDisplayName(d);
      var authorLine = '<span style="color:' + color + '">\\u25cf</span> ' + escapeHtml(authorDisplay);
      var commitLink = buildCommitLink(d);

      tooltip.innerHTML =
        '<div><strong>Week: ' + escapeHtml(d.weekStart) + '</strong></div>' +
        '<div>Developer: ' + authorLine + '</div>' +
        '<hr style="margin: 4px 0; border: none; border-top: 1px solid var(--vscode-panel-border, #444);">' +
        '<div><strong>Test LOC Delta:</strong> ' + formatDelta(d.totalTestsDelta) + '</div>' +
        '<div>Commits: ' + d.commitCount + '</div>' +
        commitLink;
      tooltip.classList.add('visible');
      tooltip.setAttribute('aria-hidden', 'false');
    }
  `;
}

/**
 * Generate JavaScript source for the developer legend renderer.
 * @returns JavaScript source string
 */
export function generateDeveloperLegendScript(): string {
  return `
    // ======================================================================
    // Developer Legend
    // ======================================================================

    function renderDeveloperLegend(authorList, data) {
      developerLegend.innerHTML = '';

      var authorDisplayNames = {};
      data.forEach(function(d) {
        var authorId = getAuthorId(d);
        if (!authorDisplayNames[authorId]) {
          authorDisplayNames[authorId] = getAuthorDisplayName(d);
        }
      });

      var maxDevelopers = 15;
      var displayAuthors = authorList.slice(0, maxDevelopers);

      displayAuthors.forEach(function(authorId) {
        var color = getDeveloperColor(authorId, authorList);
        var displayName = authorDisplayNames[authorId] || authorId;

        var item = document.createElement('div');
        item.className = 'legend-item';

        var swatch = document.createElement('span');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = color;
        item.appendChild(swatch);

        var nameSpan = document.createElement('span');
        nameSpan.textContent = displayName.length > 25 ? displayName.substring(0, 23) + '...' : displayName;
        nameSpan.title = displayName;
        item.appendChild(nameSpan);

        developerLegend.appendChild(item);
      });

      if (authorList.length > maxDevelopers) {
        var moreItem = document.createElement('div');
        moreItem.className = 'legend-item';
        moreItem.style.fontStyle = 'italic';
        moreItem.style.color = 'var(--vscode-descriptionForeground, #888)';
        moreItem.textContent = '(and ' + (authorList.length - maxDevelopers) + ' others)';
        developerLegend.appendChild(moreItem);
      }
    }
  `;
}
