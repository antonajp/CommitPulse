/**
 * Client-side JavaScript helper functions for the File Churn chart.
 * These are injected into the dashboard webview HTML.
 *
 * Ticket: IQS-895
 */

/**
 * Generate the JavaScript source for file churn state variables
 * and helper functions in the dashboard webview.
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateFileChurnStateScript(): string {
  return `
      // File Churn state (IQS-895)
      let cachedFileChurnData = null;
      let fileChurnCurrentGroupBy = 'team';
      let fileChurnCurrentTopN = 20;
      let fileChurnPendingDrillDown = null;
      var FILE_CHURN_DEFAULT_TOP_N = 20;
  `;
}

/**
 * Generate the JavaScript source for file churn data request
 * and rendering helper functions.
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateFileChurnHelperFunctions(): string {
  return `
      // ======================================================================
      // File Churn helpers (IQS-895)
      // ======================================================================
      function requestFileChurn() {
        showLoading('fileChurnCard');
        vscode.postMessage({
          type: 'requestFileChurn',
          groupBy: fileChurnCurrentGroupBy,
          topN: fileChurnCurrentTopN,
          filters: getFilters()
        });
      }

      function renderFileChurnData(data, groupBy) {
        hideLoading('fileChurnCard');
        cachedFileChurnData = data;
        fileChurnCurrentGroupBy = groupBy;
        // Persist toggle selection
        saveWebviewState({ fileChurnGroupBy: fileChurnCurrentGroupBy, fileChurnTopN: fileChurnCurrentTopN });
        renderFileChurnChart(data, groupBy);
      }

      function handleFileChurnDrillDownData(data, filename, contributor) {
        if (fileChurnPendingDrillDown && fileChurnPendingDrillDown.filename === filename && fileChurnPendingDrillDown.contributor === contributor) {
          showFileChurnDrillDown(filename, contributor, data);
          fileChurnPendingDrillDown = null;
        }
      }
  `;
}

/**
 * Generate the JavaScript source for file churn event listeners.
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateFileChurnEventListeners(): string {
  return `
      // ======================================================================
      // File Churn Event Listeners (IQS-895)
      // ======================================================================

      // Tab switch (groupBy) -- triggers server re-query
      document.querySelectorAll('#fileChurnCard .tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('#fileChurnCard .tab-btn').forEach(function(b) {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
          fileChurnCurrentGroupBy = btn.getAttribute('data-group');
          requestFileChurn();
        });
      });

      // TopN selector change -- triggers server re-query
      document.getElementById('fileChurnTopN').addEventListener('change', function() {
        fileChurnCurrentTopN = parseInt(this.value, 10) || FILE_CHURN_DEFAULT_TOP_N;
        requestFileChurn();
      });

      // CSV export for File Churn
      document.getElementById('exportFileChurn').addEventListener('click', function() {
        if (!cachedFileChurnData || cachedFileChurnData.length === 0) { return; }
        var headers = ['Filename', 'Total Churn', 'Contributor', 'Team', 'Churn', 'Percentage'];
        var rows = cachedFileChurnData.map(function(d) {
          return [d.filename, d.totalChurn, d.contributor, d.team || '', d.churn, d.percentage];
        });
        exportCsvFromData(headers, rows, 'gitr-top-files-by-churn.csv');
      });

      // Drill-down modal close button
      document.getElementById('fileChurnDrillDownClose').addEventListener('click', closeFileChurnDrillDown);

      // Close drill-down on Escape key
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
          closeFileChurnDrillDown();
        }
      });

      // Close drill-down when clicking outside modal content
      document.getElementById('fileChurnDrillDownModal').addEventListener('click', function(event) {
        if (event.target === this) {
          closeFileChurnDrillDown();
        }
      });
  `;
}

/**
 * Generate the JavaScript source for file churn state restoration.
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateFileChurnStateRestoration(): string {
  return `
        // Restore File Churn state (IQS-895)
        if (savedState.fileChurnGroupBy) {
          fileChurnCurrentGroupBy = savedState.fileChurnGroupBy;
          document.querySelectorAll('#fileChurnCard .tab-btn').forEach(function(b) {
            var isActive = b.getAttribute('data-group') === fileChurnCurrentGroupBy;
            b.classList.toggle('active', isActive);
            b.setAttribute('aria-selected', isActive ? 'true' : 'false');
          });
        }
        if (savedState.fileChurnTopN) {
          fileChurnCurrentTopN = savedState.fileChurnTopN;
          document.getElementById('fileChurnTopN').value = fileChurnCurrentTopN.toString();
        }
  `;
}
