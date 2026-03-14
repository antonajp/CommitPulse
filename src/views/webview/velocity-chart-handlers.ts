/**
 * Event handlers and state management for the Sprint Velocity chart.
 * Generates JavaScript source for:
 * - Message handling (velocityData, velocityError)
 * - Filter state management and persistence
 * - Repository filter population
 * - UI state transitions (loading, error, empty, chart)
 * - CSV export handler
 *
 * Ticket: IQS-888, IQS-920, IQS-944, IQS-946
 */

/**
 * Generate the JavaScript source for message and data handling.
 * Returns a string to be embedded in a <script> block.
 *
 * This includes:
 * - handleVelocityData(message) - Process incoming velocity data
 * - Data aggregation by period (day/week/biweekly)
 *
 * @returns JavaScript source for data handling functions
 */
export function generateDataHandlerScript(): string {
  return `
      // ======================================================================
      // Data Handling (IQS-888, IQS-944)
      // ======================================================================

      /**
       * Handle incoming velocity data from the extension host.
       * Aggregates data by period and triggers chart rendering.
       * @param {Object} message - velocityData message with rows
       */
      function handleVelocityData(message) {
        hideLoading();
        hideError();
        hideEmpty();

        if (!message.viewExists) {
          showEmpty(
            'Velocity View Not Available',
            'The vw_sprint_velocity_vs_loc database view has not been created yet. Run the database migration to enable this chart.'
          );
          return;
        }

        if (!message.rows || message.rows.length === 0) {
          // Different empty state message when repository filter is active (IQS-920)
          if (currentRepository) {
            showEmpty(
              'No Data for Selected Repository',
              'No sprint velocity data found for repository "' + escapeHtml(currentRepository) + '". Try selecting a different repository or "All Repositories".'
            );
          } else {
            showEmpty(
              'No Velocity Data Available',
              'No sprint velocity data found. Ensure the pipeline has been run with commitLinearLinking enabled and that "Gitr: Backfill Story Points" has been executed.'
            );
          }
          return;
        }

        // Populate repository filter dropdown on first load (IQS-920)
        // Only populate from unfiltered data to get all available repos
        if (!currentRepository) {
          populateRepositoryFilter(message.rows);
        }

        // Aggregate rows by period (sum across teams/projects/repos)
        // IQS-944: Now includes humanStoryPoints and aiStoryPoints
        var periodMap = {};
        message.rows.forEach(function(r) {
          // Apply aggregation based on currentAggregation setting
          var periodKey = r.weekStart;
          if (currentAggregation === 'biweekly') {
            // Group into 2-week periods (round down to nearest 2-week boundary)
            var d = new Date(r.weekStart);
            var weekOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
            var biweeklyStart = weekOfYear - (weekOfYear % 2);
            var yearStart = new Date(d.getFullYear(), 0, 1);
            var biweeklyDate = new Date(yearStart.getTime() + biweeklyStart * 7 * 24 * 60 * 60 * 1000);
            periodKey = biweeklyDate.toISOString().split('T')[0];
          }
          // 'day' and 'week' use the weekStart as-is (server already aggregates appropriately)

          if (!periodMap[periodKey]) {
            periodMap[periodKey] = {
              weekStart: periodKey,
              humanStoryPoints: 0,
              aiStoryPoints: 0,
              totalStoryPoints: 0,
              issueCount: 0,
              totalLocChanged: 0,
              totalLinesAdded: 0,
              totalLinesDeleted: 0,
              commitCount: 0,
            };
          }
          periodMap[periodKey].humanStoryPoints += r.humanStoryPoints || 0;
          periodMap[periodKey].aiStoryPoints += r.aiStoryPoints || 0;
          periodMap[periodKey].totalStoryPoints += r.totalStoryPoints;
          periodMap[periodKey].issueCount += r.issueCount;
          periodMap[periodKey].totalLocChanged += r.totalLocChanged;
          periodMap[periodKey].totalLinesAdded += r.totalLinesAdded;
          periodMap[periodKey].totalLinesDeleted += r.totalLinesDeleted;
          periodMap[periodKey].commitCount += r.commitCount;
        });

        var aggregated = Object.values(periodMap);
        aggregated.sort(function(a, b) { return a.weekStart < b.weekStart ? -1 : 1; });

        chartData = { raw: message.rows, aggregated: aggregated };
        renderChart(aggregated);
        renderSummaryStats(aggregated);
        renderDataTable(aggregated);
        chartArea.style.display = 'block';
        dataTableContainer.style.display = 'block';
      }
  `;
}

/**
 * Generate the JavaScript source for UI state management.
 * Returns a string to be embedded in a <script> block.
 *
 * @returns JavaScript source for UI state functions
 */
export function generateUIStateScript(): string {
  return `
      // ======================================================================
      // UI State Management (IQS-888)
      // ======================================================================

      /**
       * Show the loading overlay.
       */
      function showLoading() {
        loadingState.style.display = 'flex';
        errorState.style.display = 'none';
        emptyState.style.display = 'none';
        chartArea.style.display = 'none';
        dataTableContainer.style.display = 'none';
      }

      /**
       * Hide the loading overlay.
       */
      function hideLoading() {
        loadingState.style.display = 'none';
      }

      /**
       * Show an error message banner.
       * @param {string} msg - Error message (will be HTML escaped)
       */
      function showError(msg) {
        hideLoading();
        errorState.innerHTML = '<div class="error-banner" role="alert"><span>&#9888;</span> ' + msg + '</div>';
        errorState.style.display = 'block';
        chartArea.style.display = 'none';
      }

      /**
       * Hide the error banner.
       */
      function hideError() {
        errorState.style.display = 'none';
        errorState.innerHTML = '';
      }

      /**
       * Show an empty state message.
       * @param {string} title - Empty state title
       * @param {string} desc - Empty state description
       */
      function showEmpty(title, desc) {
        hideLoading();
        emptyState.innerHTML = '<div class="empty-state"><h2>' + escapeHtml(title) +
          '</h2><p>' + escapeHtml(desc) + '</p></div>';
        emptyState.style.display = 'block';
        chartArea.style.display = 'none';
      }

      /**
       * Hide the empty state.
       */
      function hideEmpty() {
        emptyState.style.display = 'none';
        emptyState.innerHTML = '';
      }
  `;
}

/**
 * Generate the JavaScript source for filter state management.
 * Returns a string to be embedded in a <script> block.
 *
 * @returns JavaScript source for filter functions
 */
export function generateFilterStateScript(): string {
  return `
      // ======================================================================
      // Filter State Management (IQS-920, IQS-944)
      // ======================================================================

      /**
       * Request velocity data from the extension host.
       */
      function requestData() {
        showLoading();
        var message = { type: 'requestVelocityData' };
        if (currentRepository) {
          message.repository = currentRepository;
        }
        if (currentAggregation) {
          message.aggregation = currentAggregation;
        }
        vscode.postMessage(message);
      }

      /**
       * Populate the repository filter dropdown from raw data.
       * @param {Array} rawData - Raw velocity data rows
       */
      function populateRepositoryFilter(rawData) {
        var repoSet = {};
        rawData.forEach(function(r) {
          if (r.repository) {
            repoSet[r.repository] = true;
          }
        });

        availableRepositories = Object.keys(repoSet).sort(function(a, b) {
          return a.toLowerCase().localeCompare(b.toLowerCase());
        });

        // Clear existing options except "All Repositories"
        while (repoFilter.options.length > 1) {
          repoFilter.remove(1);
        }

        // Add repository options with HTML escaping
        availableRepositories.forEach(function(repo) {
          var option = document.createElement('option');
          option.value = repo;
          option.textContent = repo; // textContent auto-escapes
          repoFilter.appendChild(option);
        });

        // Restore selected value from state
        if (currentRepository && availableRepositories.indexOf(currentRepository) >= 0) {
          repoFilter.value = currentRepository;
        } else {
          currentRepository = '';
          repoFilter.value = '';
        }

        // Hide filter group if only 1 repository (progressive disclosure)
        if (availableRepositories.length <= 1) {
          repoFilterGroup.style.display = 'none';
        } else {
          repoFilterGroup.style.display = 'flex';
        }
      }

      /**
       * Update the chart title to reflect current filter.
       */
      function updateChartTitle() {
        if (currentRepository) {
          chartTitle.innerHTML = 'Sprint Velocity vs LOC <span class="filter-badge">[' + escapeHtml(currentRepository) + ']</span>';
        } else {
          chartTitle.textContent = 'Sprint Velocity vs LOC';
        }
      }

      /**
       * Save filter state to VS Code webview state.
       */
      function saveFilterState() {
        vscode.setState({ repository: currentRepository, aggregation: currentAggregation });
      }

      /**
       * Restore filter state from VS Code webview state.
       */
      function restoreFilterState() {
        var state = vscode.getState();
        if (state) {
          if (state.repository) {
            currentRepository = state.repository;
          }
          if (state.aggregation) {
            currentAggregation = state.aggregation;
            aggregationFilter.value = currentAggregation;
          }
        }
      }
  `;
}

/**
 * Generate the JavaScript source for CSV export.
 * Returns a string to be embedded in a <script> block.
 *
 * @returns JavaScript source for CSV export handler
 */
export function generateCsvExportHandlerScript(): string {
  return `
      // ======================================================================
      // CSV Export Handler (IQS-944)
      // ======================================================================

      /**
       * Handle CSV export button click.
       * Exports aggregated chart data with current filters.
       */
      function handleCsvExport() {
        if (!chartData || !chartData.aggregated || chartData.aggregated.length === 0) { return; }
        // IQS-944: Include both human and AI story points in export
        var headers = ['Period', 'Human Estimate', 'AI Calculated', 'Issue Count', 'LOC Changed', 'Lines Added', 'Lines Deleted', 'Commit Count'];
        if (currentRepository) {
          headers.push('Repository');
        }
        headers.push('Aggregation');
        var rows = chartData.aggregated.map(function(d) {
          var row = [d.weekStart, d.humanStoryPoints, d.aiStoryPoints, d.issueCount, d.totalLocChanged, d.totalLinesAdded, d.totalLinesDeleted, d.commitCount];
          if (currentRepository) {
            row.push(currentRepository);
          }
          row.push(currentAggregation);
          return row;
        });
        // Include repository and aggregation context in filename (IQS-920, IQS-944)
        var filenameParts = ['sprint-velocity-vs-loc'];
        if (currentAggregation !== 'week') {
          filenameParts.push(currentAggregation);
        }
        if (currentRepository) {
          filenameParts.push(currentRepository.replace(/[^a-zA-Z0-9._-]/g, '_'));
        }
        var filename = filenameParts.join('-') + '.csv';
        exportCsvFromData(headers, rows, filename);
      }
  `;
}

/**
 * Generate the JavaScript source for chart explanation collapse state.
 * Returns a string to be embedded in a <script> block.
 *
 * @returns JavaScript source for chart explanation initialization
 */
export function generateChartExplanationScript(): string {
  return `
      // ======================================================================
      // Chart Explanation Collapse State Persistence (IQS-922)
      // ======================================================================

      /**
       * Initialize chart explanation collapse state persistence.
       * Restores and saves expand/collapse state for explanation sections.
       */
      function initChartExplanations() {
        var state = vscode.getState() || {};
        var explanationState = state.explanationState || {};

        document.querySelectorAll('.chart-explanation').forEach(function(details, index) {
          var key = 'explanation_' + index;
          if (explanationState[key] !== undefined) {
            details.open = explanationState[key];
          }
          details.addEventListener('toggle', function() {
            var currentState = vscode.getState() || {};
            var expState = currentState.explanationState || {};
            expState[key] = details.open;
            vscode.setState(Object.assign({}, currentState, { explanationState: expState }));
          });
        });
      }
  `;
}
