/**
 * Summary statistics and calibration calculations for the Sprint Velocity chart.
 * Generates JavaScript source for:
 * - Summary stats card rendering
 * - Calibration ratio calculation (Human vs AI estimates)
 * - Data table rendering for accessibility
 *
 * Ticket: IQS-888, IQS-944, IQS-946
 */

/**
 * Generate the JavaScript source for summary statistics rendering.
 * Returns a string to be embedded in a <script> block.
 *
 * This includes:
 * - renderSummaryStats(data) - Render stat cards with calibration ratio
 * - createStatCard(value, label) - Create a basic stat card
 * - createStatCardWithSublabel(value, label, sublabel) - Create stat card with sublabel
 *
 * @returns JavaScript source for summary stats functions
 */
export function generateSummaryStatsScript(): string {
  return `
      // ======================================================================
      // Summary Statistics (IQS-944)
      // ======================================================================

      /**
       * Render summary statistics cards including calibration ratio.
       * @param {Array} data - Aggregated velocity data points
       */
      function renderSummaryStats(data) {
        var totalHuman = 0;
        var totalAI = 0;
        var totalLOC = 0;
        var totalIssues = 0;
        var totalCommits = 0;

        data.forEach(function(d) {
          totalHuman += d.humanStoryPoints || 0;
          totalAI += d.aiStoryPoints || 0;
          totalLOC += d.totalLocChanged;
          totalIssues += d.issueCount;
          totalCommits += d.commitCount;
        });

        // Calculate calibration ratio and label
        var calibrationRatio = totalAI > 0 ? (totalHuman / totalAI).toFixed(2) : 'N/A';
        var calibrationLabel = '';
        if (totalAI > 0) {
          var ratio = totalHuman / totalAI;
          if (ratio > 1.2) {
            calibrationLabel = 'Over-estimating';
          } else if (ratio < 0.8) {
            calibrationLabel = 'Under-estimating';
          } else {
            calibrationLabel = 'Well-calibrated';
          }
        }

        var periodLabel = currentAggregation === 'day' ? 'Days' : currentAggregation === 'biweekly' ? 'Bi-weeks' : 'Weeks';

        summaryStats.innerHTML =
          createStatCard(data.length, periodLabel) +
          createStatCard(totalHuman.toLocaleString(), 'Human Est.') +
          createStatCard(totalAI.toLocaleString(), 'AI Calc.') +
          createStatCardWithSublabel(calibrationRatio, 'Calibration', calibrationLabel) +
          createStatCard(totalLOC.toLocaleString(), 'LOC Changed') +
          createStatCard(totalIssues.toLocaleString(), 'Issues') +
          createStatCard(totalCommits.toLocaleString(), 'Commits');
      }

      /**
       * Create a basic stat card HTML.
       * @param {string|number} value - The stat value
       * @param {string} label - The stat label
       * @returns {string} HTML string for the stat card
       */
      function createStatCard(value, label) {
        return '<div class="stat-card"><div class="stat-value">' +
          escapeHtml(String(value)) + '</div><div class="stat-label">' +
          escapeHtml(label) + '</div></div>';
      }

      /**
       * Create a stat card with sublabel for calibration ratio.
       * @param {string|number} value - The stat value
       * @param {string} label - The stat label
       * @param {string} sublabel - Additional context (e.g., "Over-estimating")
       * @returns {string} HTML string for the stat card
       */
      function createStatCardWithSublabel(value, label, sublabel) {
        var sublabelHtml = sublabel
          ? '<div class="stat-sublabel" style="font-size: 10px; color: var(--vscode-descriptionForeground, #888);">' + escapeHtml(sublabel) + '</div>'
          : '';
        return '<div class="stat-card"><div class="stat-value">' +
          escapeHtml(String(value)) + '</div><div class="stat-label">' +
          escapeHtml(label) + '</div>' + sublabelHtml + '</div>';
      }
  `;
}

/**
 * Generate the JavaScript source for data table rendering.
 * Returns a string to be embedded in a <script> block.
 *
 * @returns JavaScript source for renderDataTable function
 */
export function generateDataTableScript(): string {
  return `
      // ======================================================================
      // Data Table (Accessibility Fallback) - IQS-944
      // ======================================================================

      /**
       * Render the data table for accessibility and data inspection.
       * @param {Array} data - Aggregated velocity data points
       */
      function renderDataTable(data) {
        var tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';
        data.forEach(function(d) {
          var tr = document.createElement('tr');
          var tdPeriod = document.createElement('td');
          tdPeriod.textContent = d.weekStart;
          tr.appendChild(tdPeriod);
          var tdHuman = document.createElement('td');
          tdHuman.textContent = String(d.humanStoryPoints || 0);
          tr.appendChild(tdHuman);
          var tdAI = document.createElement('td');
          tdAI.textContent = String(d.aiStoryPoints || 0);
          tr.appendChild(tdAI);
          var tdIssues = document.createElement('td');
          tdIssues.textContent = String(d.issueCount);
          tr.appendChild(tdIssues);
          var tdLOC = document.createElement('td');
          tdLOC.textContent = d.totalLocChanged.toLocaleString();
          tr.appendChild(tdLOC);
          var tdCommits = document.createElement('td');
          tdCommits.textContent = String(d.commitCount);
          tr.appendChild(tdCommits);
          tbody.appendChild(tr);
        });
      }
  `;
}
