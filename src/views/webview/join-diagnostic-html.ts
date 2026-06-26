/**
 * HTML content generator for the Join Diagnostic Tool webview.
 * Produces the full HTML document with:
 * - Content Security Policy (nonce-based, no inline scripts)
 * - VS Code theme integration via CSS variables
 * - Developer selector dropdown
 * - Summary cards showing match rate and story points
 * - Table of unmatched issues with mismatch reasons
 * - Export CSV functionality
 * - Loading and error states
 * - Keyboard accessibility
 *
 * Ticket: GITX-183
 */

/**
 * Generate the full HTML document for the Join Diagnostic Tool webview.
 *
 * @param nonce - CSP nonce for script/style authorization
 * @param cspSource - The CSP source string for the webview
 * @returns Complete HTML string for the webview
 */
export function generateJoinDiagnosticHtml(nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${cspSource} 'nonce-${nonce}';
             script-src 'nonce-${nonce}';
             font-src ${cspSource};
             img-src ${cspSource} data:;
             connect-src 'none';
             form-action 'none';
             frame-ancestors 'none';
             base-uri 'none';">
  <title>Join Diagnostic Tool</title>
  <style nonce="${nonce}">
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      line-height: 1.6;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--vscode-foreground);
    }

    .subtitle {
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
      margin-bottom: 16px;
    }

    .controls {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    .control-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    label {
      font-size: 13px;
      color: var(--vscode-foreground);
    }

    select, button {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      padding: 6px 12px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
      cursor: pointer;
    }

    select:focus, button:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    button {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }

    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .card {
      background-color: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 4px;
      padding: 16px;
    }

    .card-title {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .card-value {
      font-size: 32px;
      font-weight: 600;
      color: var(--vscode-foreground);
      display: block;
    }

    .card-subtitle {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }

    .card-success {
      color: var(--vscode-testing-iconPassed);
    }

    .card-warning {
      color: var(--vscode-editorWarning-foreground);
    }

    .card-error {
      color: var(--vscode-editorError-foreground);
    }

    .section {
      margin-bottom: 24px;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
    }

    thead {
      background-color: var(--vscode-editorGroupHeader-tabsBackground);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    th {
      text-align: left;
      padding: 12px;
      font-weight: 600;
      font-size: 13px;
      color: var(--vscode-foreground);
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    td {
      padding: 12px;
      font-size: 13px;
      color: var(--vscode-foreground);
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    tbody tr:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-info {
      background-color: var(--vscode-editorInfo-background);
      color: var(--vscode-editorInfo-foreground);
    }

    .badge-warning {
      background-color: var(--vscode-editorWarning-background);
      color: var(--vscode-editorWarning-foreground);
    }

    .badge-error {
      background-color: var(--vscode-editorError-background);
      color: var(--vscode-editorError-foreground);
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
    }

    .error {
      padding: 16px;
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-inputValidation-errorForeground);
      border-radius: 4px;
      margin-bottom: 16px;
    }

    .empty-state {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
    }

    .hidden {
      display: none;
    }

    .monospace {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }

    .text-muted {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Join Diagnostic Tool</h1>
      <p class="subtitle">
        Diagnose why Developer Profile story points aren't showing by examining contributor identity alignment and Jira join statistics.
      </p>
      <div class="controls">
        <div class="control-group">
          <label for="developerSelect">Developer:</label>
          <select id="developerSelect" aria-label="Select developer">
            <option value="">Loading...</option>
          </select>
        </div>
        <button id="runDiagnosticsBtn" disabled>Run Diagnostics</button>
        <button id="exportCsvBtn" class="hidden">Export CSV</button>
      </div>
    </header>

    <div id="errorContainer" aria-live="assertive" role="alert"></div>
    <div id="loadingContainer" class="loading hidden" aria-live="polite" role="status">
      <p>Loading diagnostic data...</p>
    </div>

    <div id="resultsContainer" class="hidden" aria-live="polite">
      <!-- Contributor Info -->
      <div class="card" style="margin-bottom: 24px;">
        <div class="card-title">Contributor Identity Mapping</div>
        <table>
          <tbody>
            <tr>
              <td><strong>Jira Identity (Join Key):</strong></td>
              <td id="contributorJiraIdentity" class="monospace" style="font-weight: bold;"></td>
            </tr>
            <tr>
              <td><strong>Login (GitHub):</strong></td>
              <td id="contributorLogin" class="monospace"></td>
            </tr>
            <tr>
              <td><strong>Full Name (Git Author):</strong></td>
              <td id="contributorFullName"></td>
            </tr>
            <tr>
              <td><strong>Jira Name (Aligned Value):</strong></td>
              <td id="contributorJiraName" class="monospace"></td>
            </tr>
            <tr>
              <td><strong>Email:</strong></td>
              <td id="contributorEmail" class="monospace"></td>
            </tr>
            <tr>
              <td><strong>Alignment Status:</strong></td>
              <td id="contributorAlignment"></td>
            </tr>
          </tbody>
        </table>
        <p style="margin-top: 12px; font-size: 12px; color: var(--vscode-descriptionForeground);">
          <strong>How it works:</strong> The join uses <code>COALESCE(jira_name, full_name)</code> to match against <code>jira_detail.assignee</code>.
          If jira_name is set, it's used; otherwise full_name is used.
        </p>
      </div>

      <!-- Summary Cards -->
      <div class="summary-cards">
        <div class="card">
          <div class="card-title">Match Rate</div>
          <span id="matchRate" class="card-value">-</span>
          <div class="card-subtitle">Percentage of matched issues</div>
        </div>
        <div class="card">
          <div class="card-title">Matched Issues</div>
          <span id="matchedIssues" class="card-value card-success">0</span>
          <div class="card-subtitle"><span id="matchedPoints">0</span> story points</div>
        </div>
        <div class="card">
          <div class="card-title">Potential Unmatched</div>
          <span id="unmatchedIssues" class="card-value card-warning">0</span>
          <div class="card-subtitle"><span id="unmatchedPoints">0</span> story points may be missing</div>
        </div>
      </div>

      <!-- Potential Unmatched Issues Table -->
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">Potential Unmatched Issues</h2>
        </div>
        <p style="margin-bottom: 12px; color: var(--vscode-descriptionForeground); font-size: 13px;">
          These issues have assignees that look like they might belong to this contributor but don't match the Jira Identity join key.
          If the Jira Assignee should match, update <code>commit_contributors.jira_name</code> to match the Jira Assignee value.
        </p>
        <div id="unmatchedTableContainer">
          <table id="unmatchedTable">
            <thead>
              <tr>
                <th scope="col">Jira Key</th>
                <th scope="col">Summary</th>
                <th scope="col">Jira Assignee</th>
                <th scope="col">Full Name</th>
                <th scope="col">Jira Name</th>
                <th scope="col">Story Points</th>
                <th scope="col">Status</th>
                <th scope="col">Why Not Matched</th>
              </tr>
            </thead>
            <tbody id="unmatchedTableBody">
            </tbody>
          </table>
          <div id="emptyUnmatched" class="empty-state hidden" role="status">
            No potential matches found. The Jira Identity join is working correctly for this contributor.
          </div>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      let currentContributor = null;
      let currentStats = null;
      let currentUnmatchedIssues = [];

      // DOM elements
      const developerSelect = document.getElementById('developerSelect');
      const runDiagnosticsBtn = document.getElementById('runDiagnosticsBtn');
      const exportCsvBtn = document.getElementById('exportCsvBtn');
      const errorContainer = document.getElementById('errorContainer');
      const loadingContainer = document.getElementById('loadingContainer');
      const resultsContainer = document.getElementById('resultsContainer');
      const unmatchedTableBody = document.getElementById('unmatchedTableBody');
      const emptyUnmatched = document.getElementById('emptyUnmatched');

      // Request all contributors on load
      vscode.postMessage({ type: 'requestAllContributors' });

      // Event listeners
      developerSelect.addEventListener('change', () => {
        runDiagnosticsBtn.disabled = !developerSelect.value;
      });

      runDiagnosticsBtn.addEventListener('click', () => {
        const developer = developerSelect.value;
        if (developer) {
          vscode.postMessage({ type: 'requestDiagnostics', developer });
        }
      });

      exportCsvBtn.addEventListener('click', () => {
        if (currentUnmatchedIssues.length === 0) {
          showError('No data to export', 'export');
          return;
        }

        const csv = generateCsv(currentUnmatchedIssues);
        const today = new Date().toISOString().split('T')[0];
        const filename = 'join-diagnostic-' + developerSelect.value + '-' + today + '.csv';
        vscode.postMessage({ type: 'exportCsv', data: csv, filename });
      });

      // Message handler
      window.addEventListener('message', (event) => {
        const message = event.data;

        switch (message.type) {
          case 'allContributors':
            populateDeveloperSelect(message.contributors);
            break;

          case 'diagnosticsData':
            currentContributor = message.contributor;
            currentStats = message.stats;
            currentUnmatchedIssues = message.unmatchedIssues;
            renderDiagnostics();
            break;

          case 'loading':
            if (message.isLoading) {
              showLoading();
            } else {
              hideLoading();
            }
            break;

          case 'error':
            showError(message.message, message.source);
            hideLoading();
            break;
        }
      });

      function populateDeveloperSelect(contributors) {
        developerSelect.innerHTML = '<option value="">-- Select a developer --</option>';

        // Use jiraIdentity as the selection value (COALESCE of jira_name, full_name)
        // This is the actual value used in the Jira join
        contributors
          .sort((a, b) => (a.jiraIdentity || '').localeCompare(b.jiraIdentity || ''))
          .forEach(contributor => {
            const option = document.createElement('option');
            // Use jiraIdentity as the value - this is what the join uses
            option.value = contributor.jiraIdentity;
            // Display format: jiraIdentity (login) [N issues]
            let displayText = contributor.jiraIdentity;
            if (contributor.login && contributor.login !== contributor.jiraIdentity) {
              displayText += ' (' + contributor.login + ')';
            }
            if (contributor.matchedIssueCount > 0) {
              displayText += ' [' + contributor.matchedIssueCount + ' issues]';
            }
            option.textContent = displayText;
            developerSelect.appendChild(option);
          });

        runDiagnosticsBtn.disabled = true;
      }

      function renderDiagnostics() {
        hideLoading();
        clearError();
        resultsContainer.classList.remove('hidden');
        exportCsvBtn.classList.remove('hidden');

        // Render contributor info
        document.getElementById('contributorJiraIdentity').textContent = currentContributor.jiraIdentity || '(not available)';
        document.getElementById('contributorLogin').textContent = currentContributor.login;
        document.getElementById('contributorFullName').textContent = currentContributor.fullName;
        document.getElementById('contributorJiraName').textContent = currentContributor.jiraName || '(not set)';
        document.getElementById('contributorEmail').textContent = currentContributor.email || '(not set)';

        const alignmentEl = document.getElementById('contributorAlignment');
        alignmentEl.textContent = currentContributor.alignmentStatus;
        alignmentEl.className = '';
        if (currentContributor.alignmentStatus.includes('Not Aligned') || currentContributor.alignmentStatus.includes('using full_name')) {
          alignmentEl.innerHTML = '<span class="badge badge-warning">Using full_name (jira_name not set)</span>';
        } else if (currentContributor.alignmentStatus.includes('= full_name') || currentContributor.alignmentStatus.includes('Same')) {
          alignmentEl.innerHTML = '<span class="badge badge-info">jira_name = full_name</span>';
        } else {
          alignmentEl.innerHTML = '<span class="badge badge-info">jira_name differs from full_name</span>';
        }

        // Render stats
        const totalIssues = currentStats.matchedCount + currentStats.unmatchedCount;
        const matchRate = totalIssues > 0
          ? Math.round((currentStats.matchedCount / totalIssues) * 100)
          : 0;

        document.getElementById('matchRate').textContent = matchRate + '%';
        document.getElementById('matchRate').className = 'card-value ' +
          (matchRate >= 90 ? 'card-success' : matchRate >= 70 ? 'card-warning' : 'card-error');

        document.getElementById('matchedIssues').textContent = currentStats.matchedCount;
        document.getElementById('matchedPoints').textContent = currentStats.matchedStoryPoints;
        document.getElementById('unmatchedIssues').textContent = currentStats.unmatchedCount;
        document.getElementById('unmatchedPoints').textContent = currentStats.unmatchedStoryPoints;

        // Render unmatched issues table
        renderUnmatchedTable();
      }

      function renderUnmatchedTable() {
        if (currentUnmatchedIssues.length === 0) {
          unmatchedTableBody.innerHTML = '';
          emptyUnmatched.classList.remove('hidden');
          document.getElementById('unmatchedTable').classList.add('hidden');
          return;
        }

        emptyUnmatched.classList.add('hidden');
        document.getElementById('unmatchedTable').classList.remove('hidden');

        unmatchedTableBody.innerHTML = currentUnmatchedIssues.map(issue => {
          // Dynamic badge based on mismatch reason
          let reasonBadge;
          const reason = issue.mismatchReason || '';
          if (reason.includes('need to set jira_name')) {
            reasonBadge = '<span class="badge badge-error">' + escapeHtml(reason) + '</span>';
          } else if (reason.includes('contains')) {
            reasonBadge = '<span class="badge badge-warning">' + escapeHtml(reason) + '</span>';
          } else {
            reasonBadge = '<span class="badge badge-info">' + escapeHtml(reason) + '</span>';
          }

          return '<tr>' +
            '<td class="monospace">' + escapeHtml(issue.jiraKey) + '</td>' +
            '<td>' + escapeHtml(issue.summary || '') + '</td>' +
            '<td class="monospace">' + escapeHtml(issue.jiraAssignee) + '</td>' +
            '<td>' + escapeHtml(issue.contributorFullName || '') + '</td>' +
            '<td class="monospace text-muted">' + (issue.contributorJiraName ? escapeHtml(issue.contributorJiraName) : '(not set)') + '</td>' +
            '<td>' + (issue.storyPoints ?? '-') + '</td>' +
            '<td>' + escapeHtml(issue.status) + '</td>' +
            '<td>' + reasonBadge + '</td>' +
            '</tr>';
        }).join('');
      }

      function generateCsv(issues) {
        const headers = ['Jira Key', 'Summary', 'Jira Assignee', 'Contributor Name', 'Contributor Jira Name', 'Story Points', 'Status', 'Mismatch Reason'];
        const rows = issues.map(issue => [
          issue.jiraKey,
          issue.summary,
          issue.jiraAssignee,
          issue.contributorFullName,
          issue.contributorJiraName || '',
          issue.storyPoints ?? '',
          issue.status,
          issue.mismatchReason
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(','))
        ].join('\\n');

        return csvContent;
      }

      function showLoading() {
        loadingContainer.classList.remove('hidden');
        resultsContainer.classList.add('hidden');
      }

      function hideLoading() {
        loadingContainer.classList.add('hidden');
      }

      function showError(message, source) {
        errorContainer.innerHTML = '<div class="error"><strong>Error (' + source + '):</strong> ' + escapeHtml(message) + '</div>';
      }

      function clearError() {
        errorContainer.innerHTML = '';
      }

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }
    })();
  </script>
</body>
</html>`;
}
