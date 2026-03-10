/**
 * D3 multi-axis chart renderer for the Development Pipeline dashboard.
 * Renders 4 metric series (Complexity, LOC, Comments, Tests) with:
 * - Independent Y-axes per metric (2 left, 2 right)
 * - Team member coloring using Okabe-Ito colorblind-safe palette
 * - Dual encoding: marker fill = author color, marker stroke = metric color
 * - Distinct marker shapes preserved for accessibility
 *
 * Ticket: IQS-921, IQS-930
 */

/**
 * Generate JavaScript source for Y-axis domain calculation.
 * @returns JavaScript source string
 */
export function generateYAxisDomainScript(): string {
  return `
    // ======================================================================
    // Y-Axis Domain Calculation (IQS-921)
    // ======================================================================

    /**
     * Calculate independent Y-axis domains for each metric.
     * Each metric gets its own scale to show relative changes clearly.
     * @param {Array} data - Array of DevPipelineDeltaPoint objects
     * @param {object} seriesVisibility - Series visibility state
     * @returns {object} Object with min/max for each metric
     */
    function calculateYAxisDomains(data, seriesVisibility) {
      var domains = {
        complexity: { min: 0, max: 0 },
        loc: { min: 0, max: 0 },
        comments: { min: 0, max: 0 },
        tests: { min: 0, max: 0 },
      };

      if (!data || data.length === 0) return domains;

      data.forEach(function(d) {
        if (seriesVisibility.complexity) {
          domains.complexity.min = Math.min(domains.complexity.min, d.complexityDelta);
          domains.complexity.max = Math.max(domains.complexity.max, d.complexityDelta);
        }
        if (seriesVisibility.loc) {
          domains.loc.min = Math.min(domains.loc.min, d.locDelta);
          domains.loc.max = Math.max(domains.loc.max, d.locDelta);
        }
        if (seriesVisibility.comments) {
          domains.comments.min = Math.min(domains.comments.min, d.commentsDelta);
          domains.comments.max = Math.max(domains.comments.max, d.commentsDelta);
        }
        if (seriesVisibility.tests) {
          domains.tests.min = Math.min(domains.tests.min, d.testsDelta);
          domains.tests.max = Math.max(domains.tests.max, d.testsDelta);
        }
      });

      // Add padding to each domain
      Object.keys(domains).forEach(function(key) {
        var padding = Math.max(1, (domains[key].max - domains[key].min) * 0.1);
        domains[key].min -= padding;
        domains[key].max += padding;
      });

      return domains;
    }
  `;
}

/**
 * Generate JavaScript source for the multi-axis chart renderer.
 * @returns JavaScript source string
 */
export function generateMultiAxisChartScript(): string {
  return `
    // ======================================================================
    // Multi-Axis Chart Rendering (IQS-921)
    // ======================================================================

    /**
     * Render the multi-axis development pipeline chart.
     * Creates 4 independent Y-axes and colors points by team member.
     *
     * @param {Array} data - Chart data array
     * @param {HTMLElement} svg - D3 selection of the SVG element
     * @param {object} seriesVisibility - Series visibility state
     * @param {object} config - Series configuration
     * @param {function} showTooltip - Tooltip show function
     * @param {function} moveTooltip - Tooltip move function
     * @param {function} hideTooltip - Tooltip hide function
     * @param {function} openCommitDiff - Commit diff action
     */
    function renderMultiAxisChart(data, svg, seriesVisibility, config, showTooltip, moveTooltip, hideTooltip, openCommitDiff) {
      if (!data || data.length === 0) return;

      svg.selectAll('*').remove();

      // Build author list for consistent coloring
      var authorList = buildAuthorList(data);

      // Chart dimensions - increased margins for 4 Y-axes
      var margin = { top: 30, right: 140, bottom: 60, left: 140 };
      var containerWidth = Math.max(700, document.querySelector('.chart-svg-container').clientWidth - 24);
      var width = containerWidth;
      var height = 400;
      var innerWidth = width - margin.left - margin.right;
      var innerHeight = height - margin.top - margin.bottom;

      svg.attr('width', width).attr('height', height)
         .attr('role', 'img')
         .attr('aria-label', 'Multi-axis chart: Complexity, LOC, Comments, and Tests deltas by commit with team member coloring');

      var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

      // X Scale: commit dates
      var parseDate = d3.timeParse('%Y-%m-%d');
      var dates = data.map(function(d) { return parseDate(d.commitDate); });
      var x = d3.scaleTime()
        .domain(d3.extent(dates))
        .range([0, innerWidth]);

      // Calculate independent Y-axis domains
      var domains = calculateYAxisDomains(data, seriesVisibility);

      // Create 4 independent Y scales
      var yScales = {
        complexity: d3.scaleLinear()
          .domain([domains.complexity.min, domains.complexity.max])
          .nice()
          .range([innerHeight, 0]),
        loc: d3.scaleLinear()
          .domain([domains.loc.min, domains.loc.max])
          .nice()
          .range([innerHeight, 0]),
        comments: d3.scaleLinear()
          .domain([domains.comments.min, domains.comments.max])
          .nice()
          .range([innerHeight, 0]),
        tests: d3.scaleLinear()
          .domain([domains.tests.min, domains.tests.max])
          .nice()
          .range([innerHeight, 0]),
      };

      // Grid lines (only for primary axis - complexity)
      if (seriesVisibility.complexity) {
        g.append('g').attr('class', 'grid')
          .call(d3.axisLeft(yScales.complexity).tickSize(-innerWidth).tickFormat(''))
          .selectAll('line').attr('stroke-dasharray', '2,2');
        g.selectAll('.grid .domain').remove();
      }

      // Zero line
      var primaryScale = seriesVisibility.complexity ? yScales.complexity :
                        seriesVisibility.loc ? yScales.loc :
                        seriesVisibility.comments ? yScales.comments :
                        yScales.tests;
      g.append('line')
        .attr('class', 'zero-line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', primaryScale(0))
        .attr('y2', primaryScale(0))
        .attr('stroke', 'var(--vscode-foreground, #888)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .attr('opacity', 0.5);

      // X Axis
      g.append('g').attr('class', 'axis')
        .attr('transform', 'translate(0,' + innerHeight + ')')
        .call(d3.axisBottom(x).ticks(Math.min(data.length, 10)).tickFormat(d3.timeFormat('%m/%d')))
        .selectAll('text')
        .attr('transform', 'rotate(-35)')
        .attr('text-anchor', 'end')
        .attr('font-size', '10px');

      // Y Axes - Left side: Complexity (outer) and LOC (inner)
      var axisOffsets = {
        complexity: -70,
        loc: 0,
        comments: innerWidth,
        tests: innerWidth + 70,
      };

      // Render Y-axes with color-coded labels
      var seriesKeys = ['complexity', 'loc', 'comments', 'tests'];
      var seriesFields = {
        complexity: 'complexityDelta',
        loc: 'locDelta',
        comments: 'commentsDelta',
        tests: 'testsDelta',
      };

      seriesKeys.forEach(function(key) {
        if (!seriesVisibility[key]) return;

        var offset = axisOffsets[key];
        var isLeft = (key === 'complexity' || key === 'loc');
        var axisFn = isLeft ? d3.axisLeft : d3.axisRight;

        var axisG = g.append('g')
          .attr('class', 'axis axis-' + key)
          .attr('transform', 'translate(' + offset + ',0)')
          .call(axisFn(yScales[key]).ticks(6));

        // Color-code axis labels
        axisG.selectAll('text').attr('fill', config[key].color);
        axisG.selectAll('line').attr('stroke', config[key].color);
        axisG.select('.domain').attr('stroke', config[key].color);

        // Y axis label
        var labelX = isLeft ? -25 : 25;
        axisG.append('text')
          .attr('transform', 'rotate(-90)')
          .attr('y', labelX)
          .attr('x', -innerHeight / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', config[key].color)
          .attr('font-size', '10px')
          .text(config[key].label);
      });

      // Draw each series with team member coloring
      seriesKeys.forEach(function(key) {
        if (!seriesVisibility[key]) return;

        var cfg = config[key];
        var field = seriesFields[key];
        var yScale = yScales[key];

        // Line path - uses metric color
        var line = d3.line()
          .x(function(d) { return x(parseDate(d.commitDate)); })
          .y(function(d) { return yScale(d[field]); })
          .curve(d3.curveMonotoneX);

        g.append('path').datum(data)
          .attr('fill', 'none')
          .attr('stroke', cfg.color)
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', cfg.strokeDasharray)
          .attr('d', line);

        // Data points with dual encoding (IQS-921):
        // - Fill = team member color
        // - Stroke = metric color
        data.forEach(function(d, i) {
          var cx = x(parseDate(d.commitDate));
          var cy = yScale(d[field]);
          var authorId = getAuthorId(d);
          var authorColor = getTeamMemberColor(authorId, authorList);
          var marker;

          if (cfg.marker === 'circle') {
            marker = g.append('circle')
              .attr('cx', cx)
              .attr('cy', cy)
              .attr('r', cfg.markerSize)
              .attr('fill', authorColor);
          } else if (cfg.marker === 'square') {
            var size = cfg.markerSize * 2;
            marker = g.append('rect')
              .attr('x', cx - cfg.markerSize)
              .attr('y', cy - cfg.markerSize)
              .attr('width', size)
              .attr('height', size)
              .attr('fill', authorColor);
          } else if (cfg.marker === 'triangle') {
            var triangleSymbol = d3.symbol().type(d3.symbolTriangle).size(cfg.markerSize * cfg.markerSize * 3);
            marker = g.append('path')
              .attr('d', triangleSymbol())
              .attr('transform', 'translate(' + cx + ',' + cy + ')')
              .attr('fill', authorColor);
          } else if (cfg.marker === 'diamond') {
            var diamondSymbol = d3.symbol().type(d3.symbolDiamond).size(cfg.markerSize * cfg.markerSize * 3);
            marker = g.append('path')
              .attr('d', diamondSymbol())
              .attr('transform', 'translate(' + cx + ',' + cy + ')')
              .attr('fill', authorColor);
          }

          if (marker) {
            // Dual encoding: stroke uses metric color
            marker
              .attr('stroke', cfg.color)
              .attr('stroke-width', 2)
              .attr('tabindex', '0')
              .attr('role', 'button')
              .attr('aria-label', 'Commit ' + escapeHtml(d.sha.substring(0, 7)) + ' by ' + escapeHtml(getAuthorDisplayName(d)) + ': ' + cfg.label + ' ' + d[field])
              .attr('cursor', 'pointer')
              .attr('data-author', authorId)
              .attr('data-metric', key)
              .on('mouseover', function(event) { showTooltipWithAuthor(event, d, authorList); })
              .on('mousemove', function(event) { moveTooltip(event); })
              .on('mouseout', hideTooltip)
              .on('click', function() { openCommitDiff(d.sha); })
              .on('keydown', function(event) {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openCommitDiff(d.sha);
                }
              });
          }
        });
      });

      // Add ticket labels at top of chart (sparse, avoid overlap)
      var ticketLabelsData = data.filter(function(d) { return d.ticketId; });
      var lastLabelX = -Infinity;
      var labelMinGap = 80;

      ticketLabelsData.forEach(function(d) {
        var labelX = x(parseDate(d.commitDate));
        if (labelX - lastLabelX < labelMinGap) return;
        lastLabelX = labelX;

        var ticketLabel = g.append('text')
          .attr('x', labelX)
          .attr('y', -10)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('fill', 'var(--vscode-textLink-foreground, #3794ff)')
          .attr('cursor', 'pointer')
          .attr('tabindex', '0')
          .attr('role', 'link')
          .attr('aria-label', 'Open ticket ' + escapeHtml(d.ticketId))
          .text(escapeHtml(d.ticketId))
          .on('click', function() { openTicket(d.ticketId, d.ticketType); })
          .on('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openTicket(d.ticketId, d.ticketType);
            }
          });

        ticketLabel
          .on('mouseover', function() { d3.select(this).attr('text-decoration', 'underline'); })
          .on('mouseout', function() { d3.select(this).attr('text-decoration', 'none'); });
      });

      // Announce update to screen readers
      var liveRegion = document.getElementById('summaryStats');
      if (liveRegion) {
        liveRegion.setAttribute('aria-live', 'polite');
      }

      return authorList;
    }
  `;
}

/**
 * Generate JavaScript source for the tooltip with author color.
 * @returns JavaScript source string
 */
export function generateTooltipWithAuthorScript(): string {
  return `
    // ======================================================================
    // Tooltip with Author Color (IQS-921)
    // ======================================================================

    /**
     * Show tooltip with author color indicator.
     * Format: "Author: [bullet] John Smith (jsmith)"
     */
    function showTooltipWithAuthor(event, d, authorList) {
      var authorId = getAuthorId(d);
      var authorColor = getTeamMemberColor(authorId, authorList);
      var authorDisplay = getAuthorDisplayName(d);
      var authorUsername = d.author || '';

      // Build author line with color indicator
      var authorLine = '<span class="tt-author-indicator" style="color:' + authorColor + '">\\u25cf</span> ';
      if (authorUsername && authorDisplay !== authorUsername) {
        authorLine += escapeHtml(authorDisplay) + ' (' + escapeHtml(authorUsername) + ')';
      } else {
        authorLine += escapeHtml(authorDisplay);
      }

      tooltip.innerHTML =
        '<div class="tt-component"><strong>Commit: ' + escapeHtml(d.sha.substring(0, 7)) + '</strong></div>' +
        '<div class="tt-date">' + escapeHtml(d.commitDate) + '</div>' +
        '<div class="tt-author">Author: ' + authorLine + '</div>' +
        '<div class="tt-message">' + escapeHtml(d.commitMessageSummary || '(No message)') + '</div>' +
        '<hr class="tt-divider">' +
        '<div class="tt-value" style="color:' + SERIES_CONFIG.complexity.color + '">Complexity: ' + formatDelta(d.complexityDelta) + '</div>' +
        '<div class="tt-value" style="color:' + SERIES_CONFIG.loc.color + '">LOC: ' + formatDelta(d.locDelta) + '</div>' +
        '<div class="tt-value" style="color:' + SERIES_CONFIG.comments.color + '">Comments: ' + formatDelta(d.commentsDelta) + '</div>' +
        '<div class="tt-value" style="color:' + SERIES_CONFIG.tests.color + '">Tests: ' + formatDelta(d.testsDelta) + '</div>' +
        (d.ticketId ? '<div class="tt-ticket">Ticket: <a href="#" class="ticket-link" data-ticket="' + escapeHtml(d.ticketId) + '" data-type="' + escapeHtml(d.ticketType || '') + '">' + escapeHtml(d.ticketId) + '</a></div>' : '') +
        '<div class="tt-hint">[Click to view diff]</div>';
      tooltip.classList.add('visible');
      tooltip.setAttribute('aria-hidden', 'false');
      moveTooltip(event);

      // Attach click handler to ticket link in tooltip
      var ticketLink = tooltip.querySelector('.ticket-link');
      if (ticketLink) {
        ticketLink.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          openTicket(ticketLink.getAttribute('data-ticket'), ticketLink.getAttribute('data-type'));
        });
      }
    }
  `;
}
