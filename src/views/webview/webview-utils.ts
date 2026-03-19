/**
 * Shared utility functions for webview panels.
 * Provides reusable JavaScript snippets for:
 * - CSV export from chart/table data
 * - Copy-to-clipboard for data tables
 * - Loading and error state management
 * - Webview state persistence via getState()/setState()
 * - Keyboard accessibility helpers
 *
 * These functions are injected as inline script into webview HTML.
 * They rely on the VS Code API (`acquireVsCodeApi()`) already being called.
 *
 * Ticket: IQS-871
 */

// ============================================================================
// CSV Export Utility (injected into webview script)
// ============================================================================

/**
 * Generate the JavaScript source for CSV export functionality.
 * Returns a string to be embedded in a <script> block.
 *
 * The generated code provides:
 * - `exportCsvFromData(headers, rows, filename)` - Export array data as CSV
 * - `exportCsvFromTable(tableId, filename)` - Export HTML table contents as CSV
 *
 * CSV generation follows RFC 4180:
 * - Values containing commas, quotes, or newlines are quoted
 * - Quotes within values are escaped by doubling
 */
export function generateCsvExportScript(): string {
  return `
      // ======================================================================
      // CSV Export Utilities (IQS-871)
      // ======================================================================

      /**
       * Escape a CSV cell value per RFC 4180 + formula injection prevention.
       * Values containing commas, double-quotes, or newlines are wrapped in
       * double-quotes, with internal double-quotes doubled.
       *
       * Security (GITX-127, CWE-1236): Cells starting with formula characters
       * (=, +, -, @, |, %) are prefixed with a single quote to prevent
       * Excel/Sheets macro injection attacks.
       */
      function escapeCsvCell(value) {
        if (value === null || value === undefined) { return ''; }
        var str = String(value);

        // Formula injection prevention (CWE-1236)
        // Prefix formula-triggering characters with single quote
        // Check trimmed string to prevent bypass via leading whitespace
        // Include tab (\t) and carriage return (\r) which can trigger formulas
        var trimmed = str.trim();
        if (trimmed.length > 0 && '=+-@|%\\t\\r'.indexOf(trimmed.charAt(0)) !== -1) {
          str = "'" + str;
        }

        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\\n') !== -1) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      }

      /**
       * Export tabular data as a CSV file download.
       * Creates a temporary anchor element to trigger the browser download.
       *
       * @param {string[]} headers - Column header names
       * @param {Array<Array<string|number>>} rows - Row data arrays
       * @param {string} filename - Desired filename (should end in .csv)
       */
      function exportCsvFromData(headers, rows, filename) {
        var csvLines = [];
        csvLines.push(headers.map(escapeCsvCell).join(','));
        for (var i = 0; i < rows.length; i++) {
          csvLines.push(rows[i].map(escapeCsvCell).join(','));
        }
        var csvContent = csvLines.join('\\n');
        downloadCsvBlob(csvContent, filename);
      }

      /**
       * Export an HTML table's visible content as CSV.
       *
       * @param {string} tableId - The DOM id of the <table> element
       * @param {string} filename - Desired filename (should end in .csv)
       */
      function exportCsvFromTable(tableId, filename) {
        var table = document.getElementById(tableId);
        if (!table) { return; }
        var csvLines = [];
        var headerRow = table.querySelector('thead tr');
        if (headerRow) {
          var headers = [];
          var ths = headerRow.querySelectorAll('th');
          for (var h = 0; h < ths.length; h++) {
            headers.push(escapeCsvCell(ths[h].textContent || ''));
          }
          csvLines.push(headers.join(','));
        }
        var bodyRows = table.querySelectorAll('tbody tr');
        for (var r = 0; r < bodyRows.length; r++) {
          var cells = [];
          var tds = bodyRows[r].querySelectorAll('td');
          for (var c = 0; c < tds.length; c++) {
            cells.push(escapeCsvCell(tds[c].textContent || ''));
          }
          csvLines.push(cells.join(','));
        }
        var csvContent = csvLines.join('\\n');
        downloadCsvBlob(csvContent, filename);
      }

      /**
       * Trigger a CSV file download by sending content to extension host.
       * Uses postMessage to work around VS Code webview CSP restrictions
       * that prevent Blob URLs from working in production.
       *
       * Security (GITX-127):
       * - Data size validated (max 100K rows)
       * - Extension host sanitizes filename (path traversal prevention)
       * - Extension host shows native save dialog
       *
       * @param {string} csvContent - The CSV string
       * @param {string} filename - The suggested filename for download
       * @param {string} [source] - Optional source identifier for logging
       */
      function downloadCsvBlob(csvContent, filename, source) {
        // Data size validation - count rows (rough check)
        var rowCount = csvContent.split('\\n').length;
        if (rowCount > 100000) {
          console.error('[Webview] CSV export rejected: too many rows (' + rowCount + ')');
          showExportError('Export failed: data has too many rows (' + rowCount.toLocaleString() + ')');
          return;
        }

        // Send to extension host via postMessage
        vscode.postMessage({
          type: 'exportCsv',
          csvContent: csvContent,
          filename: filename,
          source: source || 'unknown'
        });
      }

      /**
       * Show a toast notification for export success.
       * @param {string} filename - The filename that was saved
       */
      function showExportSuccess(filename) {
        showToast('Exported to ' + filename, 'success');
      }

      /**
       * Show a toast notification for export error.
       * @param {string} message - The error message to display
       */
      function showExportError(message) {
        showToast(message, 'error');
      }

      /**
       * Show a toast notification with specified type.
       * Creates toast container if it doesn't exist.
       * @param {string} message - The message to display
       * @param {string} type - 'success' or 'error'
       */
      function showToast(message, type) {
        var container = document.getElementById('toastContainer');
        if (!container) {
          container = document.createElement('div');
          container.id = 'toastContainer';
          container.className = 'toast-container';
          container.setAttribute('aria-live', 'polite');
          container.setAttribute('aria-atomic', 'true');
          document.body.appendChild(container);
        }

        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.textContent = message;

        container.appendChild(toast);

        // Trigger animation
        setTimeout(function() { toast.classList.add('toast-visible'); }, 10);

        // Auto-remove after 4 seconds
        setTimeout(function() {
          toast.classList.remove('toast-visible');
          setTimeout(function() { toast.remove(); }, 300);
        }, 4000);
      }
  `;
}

// ============================================================================
// Copy-to-Clipboard Utility (injected into webview script)
// ============================================================================

/**
 * Generate the JavaScript source for copy-to-clipboard functionality.
 * Returns a string to be embedded in a <script> block.
 *
 * The generated code provides:
 * - `copyTableToClipboard(tableId, buttonEl)` - Copy table contents as
 *   tab-separated text suitable for pasting into spreadsheet applications
 */
export function generateClipboardScript(): string {
  return `
      // ======================================================================
      // Copy-to-Clipboard Utilities (IQS-871)
      // ======================================================================

      /**
       * Copy HTML table contents to clipboard as tab-separated values.
       * Shows brief visual feedback on the button element.
       *
       * @param {string} tableId - The DOM id of the <table> element
       * @param {HTMLElement} buttonEl - The button element for visual feedback
       */
      function copyTableToClipboard(tableId, buttonEl) {
        var table = document.getElementById(tableId);
        if (!table) { return; }
        var lines = [];
        var headerRow = table.querySelector('thead tr');
        if (headerRow) {
          var headers = [];
          var ths = headerRow.querySelectorAll('th');
          for (var h = 0; h < ths.length; h++) {
            headers.push(ths[h].textContent || '');
          }
          lines.push(headers.join('\\t'));
        }
        var bodyRows = table.querySelectorAll('tbody tr');
        for (var r = 0; r < bodyRows.length; r++) {
          var cells = [];
          var tds = bodyRows[r].querySelectorAll('td');
          for (var c = 0; c < tds.length; c++) {
            cells.push(tds[c].textContent || '');
          }
          lines.push(cells.join('\\t'));
        }
        var text = lines.join('\\n');
        navigator.clipboard.writeText(text).then(function() {
          if (buttonEl) {
            var original = buttonEl.textContent;
            buttonEl.textContent = 'Copied!';
            buttonEl.setAttribute('aria-label', 'Copied to clipboard');
            setTimeout(function() {
              buttonEl.textContent = original;
              buttonEl.setAttribute('aria-label', 'Copy table to clipboard');
            }, 2000);
          }
        }).catch(function(err) {
          console.error('[Webview] Clipboard write failed:', err);
        });
      }
  `;
}

// ============================================================================
// Loading & Error State Utilities (injected into webview script)
// ============================================================================

/**
 * Generate the JavaScript source for loading and error state management.
 * Returns a string to be embedded in a <script> block.
 *
 * The generated code provides:
 * - `showLoading(cardId)` - Display a loading spinner in a card
 * - `hideLoading(cardId)` - Remove the loading spinner
 * - `showError(cardId, message)` - Display an error message in a card
 * - `hideError(cardId)` - Remove the error message
 */
export function generateLoadingStateScript(): string {
  return `
      // ======================================================================
      // Loading & Error State Utilities (IQS-871)
      // ======================================================================

      /**
       * Show a loading spinner inside a card section.
       *
       * @param {string} cardId - The DOM id of the card section element
       */
      function showLoading(cardId) {
        var card = document.getElementById(cardId);
        if (!card) { return; }
        hideError(cardId);
        var existing = card.querySelector('.loading-overlay');
        if (existing) { return; }
        var overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-label', 'Loading data');
        overlay.innerHTML = '<div class="loading-spinner"></div><span class="loading-text">Loading...</span>';
        card.appendChild(overlay);
      }

      /**
       * Hide the loading spinner from a card section.
       *
       * @param {string} cardId - The DOM id of the card section element
       */
      function hideLoading(cardId) {
        var card = document.getElementById(cardId);
        if (!card) { return; }
        var overlay = card.querySelector('.loading-overlay');
        if (overlay) { overlay.remove(); }
      }

      /**
       * Show an error message inside a card section.
       *
       * @param {string} cardId - The DOM id of the card section element
       * @param {string} message - The error description to display
       */
      function showError(cardId, message) {
        var card = document.getElementById(cardId);
        if (!card) { return; }
        hideLoading(cardId);
        var existing = card.querySelector('.error-banner');
        if (existing) { existing.remove(); }
        var banner = document.createElement('div');
        banner.className = 'error-banner';
        banner.setAttribute('role', 'alert');
        banner.innerHTML = '<span class="error-icon">&#9888;</span> ' + escapeHtml(message);
        card.appendChild(banner);
      }

      /**
       * Hide the error message from a card section.
       *
       * @param {string} cardId - The DOM id of the card section element
       */
      function hideError(cardId) {
        var card = document.getElementById(cardId);
        if (!card) { return; }
        var banner = card.querySelector('.error-banner');
        if (banner) { banner.remove(); }
      }
  `;
}

// ============================================================================
// State Persistence Utilities (injected into webview script)
// ============================================================================

/**
 * Generate the JavaScript source for webview state persistence.
 * Returns a string to be embedded in a <script> block.
 *
 * The generated code provides:
 * - `saveWebviewState(state)` - Save state via the VS Code webview API
 * - `loadWebviewState()` - Load previously saved state
 * - `saveFilterState()` - Save current filter input values
 * - `restoreFilterState()` - Restore filter input values from saved state
 *
 * State is persisted via `vscode.setState()` / `vscode.getState()` which
 * survives panel hide/reveal cycles (when retainContextWhenHidden is true)
 * and VS Code restarts (for serializable panels).
 */
export function generateStatePersistenceScript(): string {
  return `
      // ======================================================================
      // Webview State Persistence (IQS-871)
      // ======================================================================

      /**
       * Save the webview state using the VS Code webview API.
       * Merges with existing state.
       *
       * @param {Object} state - Key-value pairs to persist
       */
      function saveWebviewState(state) {
        var currentState = vscode.getState() || {};
        var newState = Object.assign({}, currentState, state);
        vscode.setState(newState);
      }

      /**
       * Load the webview state saved by a prior session.
       *
       * @returns {Object|null} Previously saved state, or null
       */
      function loadWebviewState() {
        return vscode.getState() || null;
      }

      /**
       * Persist the current filter input values to webview state.
       * Called whenever filters change.
       */
      function saveFilterState() {
        var filterState = {};
        var startDateEl = document.getElementById('startDate');
        var endDateEl = document.getElementById('endDate');
        var teamEl = document.getElementById('teamFilter');
        var repoEl = document.getElementById('repoFilter');
        var granularityEl = document.getElementById('granularity');
        var jiraProjectEl = document.getElementById('jiraProjectFilter');

        if (startDateEl) { filterState.startDate = startDateEl.value; }
        if (endDateEl) { filterState.endDate = endDateEl.value; }
        if (teamEl) { filterState.team = teamEl.value; }
        if (repoEl) { filterState.repository = repoEl.value; }
        if (granularityEl) { filterState.granularity = granularityEl.value; }
        if (jiraProjectEl) { filterState.jiraProject = jiraProjectEl.value; }

        saveWebviewState({ filters: filterState });
      }

      /**
       * Restore filter input values from saved webview state.
       * Called on initial load before requesting data.
       */
      function restoreFilterState() {
        var state = loadWebviewState();
        if (!state || !state.filters) { return; }
        var f = state.filters;
        var startDateEl = document.getElementById('startDate');
        var endDateEl = document.getElementById('endDate');
        var teamEl = document.getElementById('teamFilter');
        var repoEl = document.getElementById('repoFilter');
        var granularityEl = document.getElementById('granularity');
        var jiraProjectEl = document.getElementById('jiraProjectFilter');

        if (startDateEl && f.startDate) { startDateEl.value = f.startDate; }
        if (endDateEl && f.endDate) { endDateEl.value = f.endDate; }
        if (teamEl && f.team) { teamEl.value = f.team; }
        if (repoEl && f.repository) { repoEl.value = f.repository; }
        if (granularityEl && f.granularity) { granularityEl.value = f.granularity; }
        if (jiraProjectEl && f.jiraProject) { jiraProjectEl.value = f.jiraProject; }
      }
  `;
}

// ============================================================================
// Keyboard Accessibility Utilities (injected into webview script)
// ============================================================================

/**
 * Generate the JavaScript source for keyboard accessibility helpers.
 * Returns a string to be embedded in a <script> block.
 *
 * The generated code provides:
 * - `setupKeyboardAccessibility()` - Set up keyboard event handlers for
 *   interactive elements (buttons, export controls, drill-down toggles)
 */
export function generateKeyboardAccessibilityScript(): string {
  return `
      // ======================================================================
      // Keyboard Accessibility (IQS-871)
      // ======================================================================

      /**
       * Set up keyboard event handlers for webview interactive elements.
       * Ensures all clickable controls respond to Enter and Space keys.
       * Adds skip-to-content and focus management.
       */
      function setupKeyboardAccessibility() {
        // Make all action buttons keyboard-accessible
        var actionButtons = document.querySelectorAll('.action-btn, .export-btn, .copy-btn');
        for (var i = 0; i < actionButtons.length; i++) {
          var btn = actionButtons[i];
          if (!btn.getAttribute('tabindex')) {
            btn.setAttribute('tabindex', '0');
          }
          btn.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.target.click();
            }
          });
        }

        // Global keyboard shortcut: Ctrl+Shift+E for export
        document.addEventListener('keydown', function(e) {
          if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
            e.preventDefault();
            // Focus the first visible export button
            var firstExport = document.querySelector('.export-btn:not(.hidden)');
            if (firstExport) { firstExport.focus(); }
          }
        });
      }
  `;
}

// ============================================================================
// Git URL Navigation Utilities (injected into webview script)
// ============================================================================

/**
 * Generate the JavaScript source for Git URL navigation functionality.
 * Returns a string to be embedded in a <script> block.
 *
 * The generated code provides:
 * - `detectGitProviderFromUrl(repoUrl)` - Detect provider from URL
 * - `isValidCommitSha(sha)` - Validate SHA format
 * - `buildCommitUrlForProvider(repoUrl, sha)` - Build commit URL for provider
 * - `openCommit(repository, sha, commitUrl)` - Open a commit in the browser
 * - `openPr(repository, prNumber)` - Open a PR in the browser
 * - `openBranch(repository, branch)` - Open a branch in the browser
 *
 * All functions use vscode.postMessage() to send URLs to the extension host,
 * which validates and opens them securely (IQS-926 security pattern).
 *
 * Security:
 * - URLs are validated by the extension host before opening
 * - SHA format validated (hex, 7-40 chars)
 * - Rate limiting prevents URL flooding
 * - Domain allowlist ensures only trusted hosts
 *
 * Ticket: IQS-925, IQS-938 (multi-provider support)
 */
export function generateGitHubUrlNavigationScript(): string {
  return `
      // ======================================================================
      // Git URL Navigation (IQS-925, IQS-938)
      // ======================================================================

      /**
       * Detect Git provider from repository URL.
       * @param {string} repoUrl - Repository URL
       * @returns {string} Provider: 'github', 'bitbucket', 'gitlab', or 'unknown'
       */
      function detectGitProviderFromUrl(repoUrl) {
        if (!repoUrl) return 'unknown';
        var url = repoUrl.toLowerCase();
        if (url.indexOf('bitbucket.org') !== -1 || url.indexOf('bitbucket.') !== -1) return 'bitbucket';
        if (url.indexOf('gitlab.com') !== -1 || url.indexOf('gitlab.') !== -1) return 'gitlab';
        if (url.indexOf('github.com') !== -1 || url.indexOf('github.') !== -1) return 'github';
        return 'unknown';
      }

      /**
       * Validate SHA format (hex string, 7-40 characters).
       * @param {string} sha - Commit SHA to validate
       * @returns {boolean} true if valid SHA format
       */
      function isValidCommitSha(sha) {
        if (!sha || typeof sha !== 'string') return false;
        return /^[0-9a-f]{7,40}$/i.test(sha);
      }

      /**
       * Build commit URL for the detected provider.
       * @param {string} repoUrl - Repository URL
       * @param {string} sha - Commit SHA
       * @returns {string|null} Commit URL or null if invalid
       */
      function buildCommitUrlForProvider(repoUrl, sha) {
        if (!repoUrl || !sha || !isValidCommitSha(sha)) return null;
        var baseUrl = repoUrl.replace(/\\/$/, '').replace(/\\.git$/i, '');
        var provider = detectGitProviderFromUrl(repoUrl);
        var encodedSha = encodeURIComponent(sha);
        switch (provider) {
          case 'bitbucket':
            return baseUrl + '/commits/' + encodedSha;
          case 'gitlab':
            return baseUrl + '/-/commit/' + encodedSha;
          case 'github':
          case 'unknown':
          default:
            return baseUrl + '/commit/' + encodedSha;
        }
      }

      /**
       * Open a commit in the external browser.
       * Uses vscode.postMessage to send URL to extension host for validation.
       *
       * @param {string} repository - Repository URL or 'owner/repo' format
       * @param {string} sha - The commit SHA (full or abbreviated)
       * @param {string} [commitUrl] - Optional pre-built commit URL
       */
      function openCommit(repository, sha, commitUrl) {
        if (!repository || !sha) {
          console.warn('[Webview] openCommit: missing repository or sha');
          return;
        }
        // Use pre-built URL if provided, otherwise build for the provider
        var url = commitUrl;
        if (!url) {
          // Check if repository is a full URL or owner/repo format
          if (repository.indexOf('://') !== -1 || repository.indexOf('@') !== -1) {
            // Full URL - use provider detection
            url = buildCommitUrlForProvider(repository, sha);
          } else {
            // owner/repo format - default to GitHub
            url = 'https://github.com/' + encodeURIComponent(repository) + '/commit/' + encodeURIComponent(sha);
          }
        }
        if (!url) {
          console.warn('[Webview] openCommit: could not build URL');
          return;
        }
        vscode.postMessage({ type: 'openExternal', url: url });
      }

      /**
       * Open a pull request in the external browser.
       * Uses vscode.postMessage to send URL to extension host for validation.
       *
       * @param {string} repository - Repository in 'owner/repo' format
       * @param {number|string} prNumber - The pull request number
       */
      function openPr(repository, prNumber) {
        if (!repository || !prNumber) {
          console.warn('[Webview] openPr: missing repository or prNumber');
          return;
        }
        var url = 'https://github.com/' + encodeURIComponent(repository) + '/pull/' + encodeURIComponent(String(prNumber));
        vscode.postMessage({ type: 'openExternal', url: url });
      }

      /**
       * Open a branch in the external browser.
       * Uses vscode.postMessage to send URL to extension host for validation.
       *
       * @param {string} repository - Repository in 'owner/repo' format
       * @param {string} branch - The branch name
       */
      function openBranch(repository, branch) {
        if (!repository || !branch) {
          console.warn('[Webview] openBranch: missing repository or branch');
          return;
        }
        var url = 'https://github.com/' + encodeURIComponent(repository) + '/tree/' + encodeURIComponent(branch);
        vscode.postMessage({ type: 'openExternal', url: url });
      }

      /**
       * Render a commit SHA as a clickable link.
       * Returns HTML string with proper keyboard accessibility.
       *
       * @param {string} sha - The full commit SHA
       * @param {string} repository - Repository in 'owner/repo' format (or empty for disabled)
       * @param {number} [displayLength=7] - Number of characters to display
       * @returns {string} HTML string for the commit link
       */
      function renderCommitLink(sha, repository, displayLength) {
        if (!sha) { return ''; }
        var len = displayLength || 7;
        var shortSha = sha.substring(0, len);

        if (!repository) {
          // No repository configured - show disabled link with tooltip
          return '<span class="commit-link commit-link-disabled" ' +
                 'title="Repository URL not configured" ' +
                 'aria-label="Commit ' + escapeHtml(shortSha) + ' - repository URL not configured">' +
                 escapeHtml(shortSha) +
                 '</span>';
        }

        return '<span class="commit-link" ' +
               'tabindex="0" ' +
               'role="link" ' +
               'aria-label="Open commit ' + escapeHtml(shortSha) + ' in browser" ' +
               'onclick="openCommit(\\'' + escapeHtml(repository) + '\\', \\'' + escapeHtml(sha) + '\\')" ' +
               'onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();openCommit(\\'' + escapeHtml(repository) + '\\', \\'' + escapeHtml(sha) + '\\');}">' +
               escapeHtml(shortSha) +
               '<span class="external-icon" aria-hidden="true">&#8599;</span>' +
               '</span>';
      }

      /**
       * Render a PR number as a clickable link.
       * Returns HTML string with proper keyboard accessibility.
       *
       * @param {number|string} prNumber - The pull request number
       * @param {string} repository - Repository in 'owner/repo' format (or empty for disabled)
       * @returns {string} HTML string for the PR link
       */
      function renderPrLink(prNumber, repository) {
        if (!prNumber) { return ''; }
        var prStr = String(prNumber);

        if (!repository) {
          return '<span class="commit-link commit-link-disabled" ' +
                 'title="Repository URL not configured" ' +
                 'aria-label="PR #' + escapeHtml(prStr) + ' - repository URL not configured">' +
                 '#' + escapeHtml(prStr) +
                 '</span>';
        }

        return '<span class="commit-link" ' +
               'tabindex="0" ' +
               'role="link" ' +
               'aria-label="Open pull request #' + escapeHtml(prStr) + ' in browser" ' +
               'onclick="openPr(\\'' + escapeHtml(repository) + '\\', ' + parseInt(prStr, 10) + ')" ' +
               'onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();openPr(\\'' + escapeHtml(repository) + '\\', ' + parseInt(prStr, 10) + ');}">' +
               '#' + escapeHtml(prStr) +
               '<span class="external-icon" aria-hidden="true">&#8599;</span>' +
               '</span>';
      }
  `;
}

// ============================================================================
// Combined Script Generator
// ============================================================================

/**
 * Generate all shared utility scripts combined into a single block.
 * This is the main entry point for webview HTML generators to use.
 *
 * @returns Combined JavaScript source for all webview utilities
 */
export function generateAllWebviewUtilityScripts(): string {
  return [
    generateCsvExportScript(),
    generateClipboardScript(),
    generateLoadingStateScript(),
    generateStatePersistenceScript(),
    generateKeyboardAccessibilityScript(),
    generateGitHubUrlNavigationScript(),
  ].join('\n');
}
