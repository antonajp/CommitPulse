/**
 * D3 two-section legend renderer for the multi-axis Development Pipeline chart.
 * Renders a legend with two sections:
 * - Metrics section with line patterns and marker shapes
 * - Team members section with color swatches
 *
 * Ticket: IQS-930 (extracted from d3-dev-pipeline-chart.ts)
 */

/**
 * Generate JavaScript source for the two-section legend renderer.
 * @returns JavaScript source string for embedding in webview
 */
export function generateTwoSectionLegendScript(): string {
  return `
    // ======================================================================
    // Two-Section Legend Rendering (IQS-921, IQS-930)
    // ======================================================================

    /**
     * Render the two-section legend: Metrics + Team Members
     * @param {HTMLElement} container - Legend container element
     * @param {object} seriesConfig - Series configuration
     * @param {object} seriesVisibility - Current visibility state
     * @param {Array} authorList - Sorted author list
     * @param {Array} data - Chart data for author names
     * @param {function} onToggleSeries - Callback for series toggle
     */
    function renderTwoSectionLegend(container, seriesConfig, seriesVisibility, authorList, data, onToggleSeries) {
      container.innerHTML = '';

      // Section 1: Metrics (with line patterns)
      var metricsSection = document.createElement('div');
      metricsSection.className = 'legend-section legend-section-metrics';

      var metricsTitle = document.createElement('div');
      metricsTitle.className = 'legend-section-title';
      metricsTitle.textContent = 'Metrics';
      metricsSection.appendChild(metricsTitle);

      var metricsItems = document.createElement('div');
      metricsItems.className = 'legend-items';

      var seriesKeys = ['complexity', 'loc', 'comments', 'tests'];
      seriesKeys.forEach(function(key) {
        var config = seriesConfig[key];
        var isVisible = seriesVisibility[key];

        var item = document.createElement('div');
        item.className = 'legend-item' + (isVisible ? '' : ' legend-item-hidden');
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'checkbox');
        item.setAttribute('aria-checked', String(isVisible));
        item.setAttribute('aria-label', 'Toggle ' + config.label + ' visibility');

        var svgNS = 'http://www.w3.org/2000/svg';
        var svgElem = document.createElementNS(svgNS, 'svg');
        svgElem.setAttribute('width', '30');
        svgElem.setAttribute('height', '14');

        var lineElem = document.createElementNS(svgNS, 'line');
        lineElem.setAttribute('x1', '0');
        lineElem.setAttribute('y1', '7');
        lineElem.setAttribute('x2', '20');
        lineElem.setAttribute('y2', '7');
        lineElem.setAttribute('stroke', config.color);
        lineElem.setAttribute('stroke-width', '2');
        if (config.strokeDasharray) {
          lineElem.setAttribute('stroke-dasharray', config.strokeDasharray);
        }
        svgElem.appendChild(lineElem);

        // Add marker symbol
        if (config.marker === 'circle') {
          var circle = document.createElementNS(svgNS, 'circle');
          circle.setAttribute('cx', '10');
          circle.setAttribute('cy', '7');
          circle.setAttribute('r', '4');
          circle.setAttribute('fill', config.color);
          circle.setAttribute('stroke', config.color);
          circle.setAttribute('stroke-width', '1');
          svgElem.appendChild(circle);
        } else if (config.marker === 'square') {
          var rect = document.createElementNS(svgNS, 'rect');
          rect.setAttribute('x', '6');
          rect.setAttribute('y', '3');
          rect.setAttribute('width', '8');
          rect.setAttribute('height', '8');
          rect.setAttribute('fill', config.color);
          rect.setAttribute('stroke', config.color);
          rect.setAttribute('stroke-width', '1');
          svgElem.appendChild(rect);
        } else if (config.marker === 'triangle') {
          var tri = document.createElementNS(svgNS, 'polygon');
          tri.setAttribute('points', '10,2 14,12 6,12');
          tri.setAttribute('fill', config.color);
          tri.setAttribute('stroke', config.color);
          tri.setAttribute('stroke-width', '1');
          svgElem.appendChild(tri);
        } else if (config.marker === 'diamond') {
          var diamond = document.createElementNS(svgNS, 'polygon');
          diamond.setAttribute('points', '10,2 14,7 10,12 6,7');
          diamond.setAttribute('fill', config.color);
          diamond.setAttribute('stroke', config.color);
          diamond.setAttribute('stroke-width', '1');
          svgElem.appendChild(diamond);
        }

        item.appendChild(svgElem);

        var labelSpan = document.createElement('span');
        labelSpan.textContent = config.label;
        item.appendChild(labelSpan);

        item.addEventListener('click', function() {
          onToggleSeries(key);
        });
        item.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleSeries(key);
          }
        });

        metricsItems.appendChild(item);
      });

      metricsSection.appendChild(metricsItems);
      container.appendChild(metricsSection);

      // Section 2: Team Members (with color swatches)
      if (authorList && authorList.length > 0) {
        var teamSection = document.createElement('div');
        teamSection.className = 'legend-section legend-section-team';

        var teamTitle = document.createElement('div');
        teamTitle.className = 'legend-section-title';
        teamTitle.textContent = 'Team Members';
        teamSection.appendChild(teamTitle);

        var teamItems = document.createElement('div');
        teamItems.className = 'legend-items legend-items-team';

        // Build author display names map
        var authorDisplayNames = {};
        data.forEach(function(d) {
          var authorId = d.author || UNKNOWN_AUTHOR_NAME;
          if (!authorDisplayNames[authorId]) {
            authorDisplayNames[authorId] = d.fullName || d.author || UNKNOWN_AUTHOR_NAME;
          }
        });

        // Show max 15 team members in legend
        var maxTeamMembers = 15;
        var displayAuthors = authorList.slice(0, maxTeamMembers);

        displayAuthors.forEach(function(authorId) {
          var color = getTeamMemberColor(authorId, authorList);
          var displayName = authorDisplayNames[authorId] || authorId;

          var item = document.createElement('div');
          item.className = 'legend-item legend-item-team-member';

          // Color swatch
          var swatch = document.createElement('span');
          swatch.className = 'legend-color-swatch';
          swatch.style.backgroundColor = color;
          item.appendChild(swatch);

          // Name
          var nameSpan = document.createElement('span');
          nameSpan.className = 'legend-team-name';
          nameSpan.textContent = displayName.length > 20 ? displayName.substring(0, 18) + '...' : displayName;
          nameSpan.title = displayName;
          item.appendChild(nameSpan);

          teamItems.appendChild(item);
        });

        // Show "and N others" if truncated
        if (authorList.length > maxTeamMembers) {
          var moreItem = document.createElement('div');
          moreItem.className = 'legend-item legend-item-more';
          moreItem.textContent = '(and ' + (authorList.length - maxTeamMembers) + ' others)';
          teamItems.appendChild(moreItem);
        }

        teamSection.appendChild(teamItems);
        container.appendChild(teamSection);
      }
    }
  `;
}
