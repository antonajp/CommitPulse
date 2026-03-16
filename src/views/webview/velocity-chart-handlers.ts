/**
 * Event handlers and state management for the Sprint Velocity chart.
 * Generates JavaScript source for:
 * - Message handling (velocityData, velocityError, filterOptions)
 * - Filter state management and persistence
 * - Team, team member, and repository filter population
 * - UI state transitions (loading, error, empty, chart)
 * - CSV export handler
 *
 * Ticket: IQS-888, IQS-920, IQS-944, IQS-946, GITX-121
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
          // Different empty state message based on active filters (IQS-920, GITX-121)
          var activeFilters = [];
          if (currentTeam) { activeFilters.push('Team: ' + escapeHtml(currentTeam)); }
          if (currentTeamMember) { activeFilters.push('Member: ' + escapeHtml(currentTeamMember)); }
          if (currentRepository) { activeFilters.push('Repository: ' + escapeHtml(currentRepository)); }

          if (activeFilters.length > 0) {
            showEmpty(
              'No Data for Selected Filters',
              'No sprint velocity data found for the selected filters (' + activeFilters.join(', ') + '). Try adjusting or clearing filters.'
            );
          } else {
            showEmpty(
              'No Velocity Data Available',
              'No sprint velocity data found. Ensure the pipeline has been run with commitLinearLinking enabled and that "Gitr: Backfill Story Points" has been executed.'
            );
          }
          return;
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
      // Filter State Management (IQS-920, IQS-944, GITX-121)
      // ======================================================================

      /**
       * Request filter options from the extension host.
       * GITX-121: Fetches distinct teams, team members, and repositories.
       */
      function requestFilterOptions() {
        vscode.postMessage({ type: 'requestFilterOptions' });
      }

      /**
       * Request velocity data from the extension host.
       */
      function requestData() {
        showLoading();
        var message = { type: 'requestVelocityData' };
        if (currentTeam) {
          message.team = currentTeam;
        }
        if (currentTeamMember) {
          message.teamMember = currentTeamMember;
        }
        if (currentRepository) {
          message.repository = currentRepository;
        }
        if (currentAggregation) {
          message.aggregation = currentAggregation;
        }
        vscode.postMessage(message);
      }

      /**
       * Handle filter options response from the extension host.
       * GITX-121: Populates team, member, and repository dropdowns.
       * @param {Object} message - filterOptions message with teams, teamMembers, repositories
       */
      function handleFilterOptions(message) {
        availableTeams = message.teams || [];
        availableTeamMembers = message.teamMembers || [];
        availableRepositories = message.repositories || [];
        filterOptionsLoaded = true;

        populateTeamFilter();
        populateMemberFilter();
        populateRepositoryFilter();
      }

      /**
       * Populate the team filter dropdown.
       * GITX-121
       */
      function populateTeamFilter() {
        // Clear existing options except "All Teams"
        while (teamFilter.options.length > 1) {
          teamFilter.remove(1);
        }

        // Add team options with HTML escaping
        availableTeams.forEach(function(team) {
          var option = document.createElement('option');
          option.value = team;
          option.textContent = team; // textContent auto-escapes
          teamFilter.appendChild(option);
        });

        // Restore selected value from state
        if (currentTeam && availableTeams.indexOf(currentTeam) >= 0) {
          teamFilter.value = currentTeam;
        } else {
          currentTeam = '';
          teamFilter.value = '';
        }

        // Hide filter group if only 1 team (progressive disclosure)
        if (availableTeams.length <= 1) {
          teamFilterGroup.style.display = 'none';
        } else {
          teamFilterGroup.style.display = 'flex';
        }
      }

      /**
       * Populate the team member filter dropdown.
       * GITX-121
       */
      function populateMemberFilter() {
        // Clear existing options except "All Members"
        while (memberFilter.options.length > 1) {
          memberFilter.remove(1);
        }

        // Add member options with HTML escaping
        availableTeamMembers.forEach(function(member) {
          var option = document.createElement('option');
          option.value = member;
          option.textContent = member; // textContent auto-escapes
          memberFilter.appendChild(option);
        });

        // Restore selected value from state
        if (currentTeamMember && availableTeamMembers.indexOf(currentTeamMember) >= 0) {
          memberFilter.value = currentTeamMember;
        } else {
          currentTeamMember = '';
          memberFilter.value = '';
        }

        // Hide filter group if only 1 member (progressive disclosure)
        if (availableTeamMembers.length <= 1) {
          memberFilterGroup.style.display = 'none';
        } else {
          memberFilterGroup.style.display = 'flex';
        }
      }

      /**
       * Populate the repository filter dropdown.
       * GITX-121: Refactored to use filter options instead of raw data.
       */
      function populateRepositoryFilter() {
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
       * Update the chart title to reflect active filters.
       * GITX-121: Extended to show team and member filters.
       */
      function updateChartTitle() {
        var filterParts = [];
        if (currentTeam) { filterParts.push('Team: ' + escapeHtml(currentTeam)); }
        if (currentTeamMember) { filterParts.push('Member: ' + escapeHtml(currentTeamMember)); }
        if (currentRepository) { filterParts.push('Repo: ' + escapeHtml(currentRepository)); }

        if (filterParts.length > 0) {
          chartTitle.innerHTML = 'Sprint Velocity vs LOC <span class="filter-badge">[' + filterParts.join(' | ') + ']</span>';
        } else {
          chartTitle.textContent = 'Sprint Velocity vs LOC';
        }
      }

      /**
       * Update Clear Filters button visibility.
       * GITX-121: Show button when any filter is active.
       */
      function updateClearFiltersButton() {
        var hasActiveFilter = currentTeam || currentTeamMember || currentRepository;
        clearFiltersBtn.style.display = hasActiveFilter ? 'inline-block' : 'none';
      }

      /**
       * Save filter state to VS Code webview state.
       * GITX-121: Extended to save team and member filters.
       */
      function saveFilterState() {
        var currentState = vscode.getState() || {};
        vscode.setState(Object.assign({}, currentState, {
          team: currentTeam,
          teamMember: currentTeamMember,
          repository: currentRepository,
          aggregation: currentAggregation
        }));
      }

      /**
       * Restore filter state from VS Code webview state.
       * GITX-121: Extended to restore team and member filters.
       */
      function restoreFilterState() {
        var state = vscode.getState();
        if (state) {
          if (state.team) {
            currentTeam = state.team;
          }
          if (state.teamMember) {
            currentTeamMember = state.teamMember;
          }
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
      // CSV Export Handler (IQS-944, GITX-121)
      // ======================================================================

      /**
       * Handle CSV export button click.
       * Exports aggregated chart data with current filters.
       * GITX-121: Extended to include team and team member filters in export.
       */
      function handleCsvExport() {
        if (!chartData || !chartData.aggregated || chartData.aggregated.length === 0) { return; }
        // IQS-944, GITX-121: Include both human and AI story points in export, plus filter context
        var headers = ['Period', 'Human Estimate', 'AI Calculated', 'Issue Count', 'LOC Changed', 'Lines Added', 'Lines Deleted', 'Commit Count'];
        if (currentTeam) {
          headers.push('Team');
        }
        if (currentTeamMember) {
          headers.push('Team Member');
        }
        if (currentRepository) {
          headers.push('Repository');
        }
        headers.push('Aggregation');
        var rows = chartData.aggregated.map(function(d) {
          var row = [d.weekStart, d.humanStoryPoints, d.aiStoryPoints, d.issueCount, d.totalLocChanged, d.totalLinesAdded, d.totalLinesDeleted, d.commitCount];
          if (currentTeam) {
            row.push(currentTeam);
          }
          if (currentTeamMember) {
            row.push(currentTeamMember);
          }
          if (currentRepository) {
            row.push(currentRepository);
          }
          row.push(currentAggregation);
          return row;
        });
        // Include filter context in filename (IQS-920, IQS-944, GITX-121)
        var filenameParts = ['sprint-velocity-vs-loc'];
        if (currentAggregation !== 'week') {
          filenameParts.push(currentAggregation);
        }
        if (currentTeam) {
          filenameParts.push(currentTeam.replace(/[^a-zA-Z0-9._-]/g, '_'));
        }
        if (currentTeamMember) {
          filenameParts.push(currentTeamMember.replace(/[^a-zA-Z0-9._-]/g, '_'));
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
