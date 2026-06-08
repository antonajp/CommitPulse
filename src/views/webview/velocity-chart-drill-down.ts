/**
 * LOC drill-down functionality for the Sprint Velocity chart.
 * Generates JavaScript source for:
 * - LOC week drill-down modal interactions
 * - Data request and response handling
 * - Loading, error, and empty states
 * - Commit detail display with SHA navigation
 * - Focus trap for WCAG 2.1 compliance
 *
 * Ticket: GITX-149, GITX-150, GITX-151
 */

/**
 * Trusted domains for commit URL navigation.
 * Only URLs matching these domains will be opened.
 * Ticket: GITX-150
 */
const TRUSTED_COMMIT_DOMAINS = ['github.com', 'gitlab.com', 'bitbucket.org'];

/**
 * Generate the JavaScript source for LOC drill-down functionality.
 * Returns a string to be embedded in a <script> block.
 *
 * @returns JavaScript source for LOC drill-down functions
 * Ticket: GITX-149, GITX-150, GITX-151
 */
export function generateLocDrillDownScript(): string {
  // Export trusted domains to webview script
  const trustedDomainsJson = JSON.stringify(TRUSTED_COMMIT_DOMAINS);

  return `
      // ======================================================================
      // LOC Week Drill-Down (GITX-149, GITX-150, GITX-151)
      // ======================================================================

      var locDrillDownPending = null; // Track pending drill-down request
      var locDrillDownRepoUrl = null; // Repository URL for SHA navigation (GITX-150)
      var locDrillDownPreviousFocus = null; // Element focused before modal opened (GITX-151)
      var TRUSTED_COMMIT_DOMAINS = ${trustedDomainsJson}; // Trusted domains for URL validation

      // GITX-151: Selector for focusable elements within a container
      var FOCUSABLE_SELECTORS = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

      /**
       * Get all focusable elements within a container.
       * Used for focus trap implementation (WCAG 2.1 compliance).
       * Ticket: GITX-151
       *
       * @param {HTMLElement} container - Container element to search within
       * @returns {HTMLElement[]} - Array of focusable elements
       */
      function getFocusableElements(container) {
        var elements = container.querySelectorAll(FOCUSABLE_SELECTORS);
        // Filter out elements that are not visible (display: none, visibility: hidden, or zero dimensions)
        return Array.prototype.filter.call(elements, function(el) {
          var style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
        });
      }

      /**
       * Handle Tab key to trap focus within the modal.
       * Implements WCAG 2.1 Success Criterion 2.1.2 (No Keyboard Trap) by
       * cycling focus within the modal while it's open.
       * Ticket: GITX-151
       *
       * @param {KeyboardEvent} event - The keydown event
       * @param {HTMLElement} modalContent - The modal content container
       */
      function handleFocusTrap(event, modalContent) {
        if (event.key !== 'Tab') {
          return;
        }

        var focusableElements = getFocusableElements(modalContent);
        if (focusableElements.length === 0) {
          // No focusable elements, prevent tab from leaving modal
          event.preventDefault();
          return;
        }

        var firstFocusable = focusableElements[0];
        var lastFocusable = focusableElements[focusableElements.length - 1];
        var activeElement = document.activeElement;

        if (event.shiftKey) {
          // Shift+Tab: if on first element, wrap to last
          if (activeElement === firstFocusable) {
            event.preventDefault();
            lastFocusable.focus();
          }
        } else {
          // Tab: if on last element, wrap to first
          if (activeElement === lastFocusable) {
            event.preventDefault();
            firstFocusable.focus();
          }
        }
      }

      /**
       * Request drill-down data for a specific week.
       */
      function requestLocDrillDown(weekStart) {
        locDrillDownPending = { weekStart: weekStart };
        showLocDrillDownLoading(weekStart);
        vscode.postMessage({
          type: 'requestLocWeekDrillDown',
          weekStart: weekStart,
          repository: currentRepository || undefined
        });
      }

      /**
       * Show the drill-down modal in loading state.
       * GITX-151: Saves previously focused element for focus restoration.
       */
      function showLocDrillDownLoading(weekStart) {
        var modal = document.getElementById('locDrillDownModal');
        var title = document.getElementById('locDrillDownTitle');
        var summary = document.getElementById('locDrillDownSummary');
        var loading = document.getElementById('locDrillDownLoading');
        var error = document.getElementById('locDrillDownError');
        var empty = document.getElementById('locDrillDownEmpty');
        var table = document.getElementById('locDrillDownTable');
        var tbody = document.getElementById('locDrillDownBody');
        var retry = document.getElementById('locDrillDownRetry');

        // GITX-151: Save currently focused element for restoration on close
        locDrillDownPreviousFocus = document.activeElement;

        var titleText = 'Commits for Week of ' + escapeHtml(weekStart);
        if (currentRepository) {
          titleText += ' (' + escapeHtml(currentRepository) + ')';
        }
        title.textContent = titleText;
        summary.innerHTML = '';
        tbody.innerHTML = '';
        loading.style.display = 'flex';
        error.style.display = 'none';
        empty.style.display = 'none';
        table.style.display = 'none';
        retry.style.display = 'none';

        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');

        // Focus management for accessibility
        document.getElementById('locDrillDownClose').focus();
      }

      /**
       * Handle successful drill-down response.
       * GITX-150: Stores repoUrl for SHA navigation.
       */
      function handleLocDrillDownData(message) {
        var loading = document.getElementById('locDrillDownLoading');
        var empty = document.getElementById('locDrillDownEmpty');
        var table = document.getElementById('locDrillDownTable');
        var tbody = document.getElementById('locDrillDownBody');
        var summary = document.getElementById('locDrillDownSummary');

        loading.style.display = 'none';

        // GITX-150: Store repository URL for SHA navigation
        locDrillDownRepoUrl = message.repoUrl || null;

        if (!message.commits || message.commits.length === 0) {
          empty.style.display = 'block';
          return;
        }

        // Render summary stats
        summary.innerHTML =
          '<div class="drill-down-summary-stats">' +
          '<div class="drill-down-stat"><span class="drill-down-stat-value">' +
            escapeHtml(message.totalLoc.toLocaleString()) + '</span>' +
            '<span class="drill-down-stat-label">Total LOC</span></div>' +
          '<div class="drill-down-stat"><span class="drill-down-stat-value">' +
            escapeHtml(String(message.commitCount)) + '</span>' +
            '<span class="drill-down-stat-label">Commits</span></div>' +
          (message.repository ?
            '<div class="drill-down-stat"><span class="drill-down-stat-value">' +
            escapeHtml(message.repository) + '</span>' +
            '<span class="drill-down-stat-label">Repository</span></div>' : '') +
          '</div>';

        // Render commit rows
        tbody.innerHTML = message.commits.map(function(c) {
          var msgTrunc = c.message.length > 80 ? c.message.slice(0, 77) + '...' : c.message;
          var dateStr = c.commitDate.split('T')[0];
          return '<tr>' +
            '<td class="sha-cell" data-sha="' + escapeHtml(c.sha) + '" tabindex="0" role="button">' +
              escapeHtml(c.sha) + '</td>' +
            '<td>' + escapeHtml(dateStr) + '</td>' +
            '<td>' + escapeHtml(c.author) + '</td>' +
            '<td>' + escapeHtml(c.branch) + '</td>' +
            '<td class="message-cell" title="' + escapeHtml(c.message) + '">' +
              escapeHtml(msgTrunc) + '</td>' +
            '<td class="loc-cell-positive">+' + c.linesAdded.toLocaleString() + '</td>' +
            '<td class="loc-cell-negative">-' + c.linesDeleted.toLocaleString() + '</td>' +
            '<td>' + c.totalLoc.toLocaleString() + '</td>' +
          '</tr>';
        }).join('');

        table.style.display = 'table';
        empty.style.display = 'none';
      }

      /**
       * Handle drill-down error response.
       */
      function handleLocDrillDownError(message) {
        var loading = document.getElementById('locDrillDownLoading');
        var error = document.getElementById('locDrillDownError');
        var retry = document.getElementById('locDrillDownRetry');

        loading.style.display = 'none';
        error.textContent = escapeHtml(message.message);
        error.style.display = 'block';
        retry.style.display = 'inline-block';
      }

      /**
       * Close the drill-down modal.
       * GITX-150: Clears repoUrl state.
       * GITX-151: Restores focus to previously focused element.
       */
      function closeLocDrillDown() {
        var modal = document.getElementById('locDrillDownModal');
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        locDrillDownPending = null;
        locDrillDownRepoUrl = null; // GITX-150: Clear repo URL

        // GITX-151: Restore focus to element that was focused before modal opened
        if (locDrillDownPreviousFocus && typeof locDrillDownPreviousFocus.focus === 'function') {
          locDrillDownPreviousFocus.focus();
        }
        locDrillDownPreviousFocus = null;
      }

      /**
       * Validate that a URL points to a trusted domain for commit navigation.
       * Only allows HTTPS URLs on trusted domains (github.com, gitlab.com, bitbucket.org).
       * Ticket: GITX-150
       *
       * @param {string} url - The URL to validate
       * @returns {boolean} - True if URL is safe to open
       */
      function isValidCommitUrl(url) {
        try {
          var parsed = new URL(url);
          // Only allow HTTPS
          if (parsed.protocol !== 'https:') {
            console.warn('Blocked non-HTTPS commit URL:', url);
            return false;
          }
          // Check against trusted domains
          var hostname = parsed.hostname.toLowerCase();
          var isTrusted = TRUSTED_COMMIT_DOMAINS.some(function(domain) {
            return hostname === domain || hostname.endsWith('.' + domain);
          });
          if (!isTrusted) {
            console.warn('Blocked commit URL from untrusted domain:', hostname);
            return false;
          }
          return true;
        } catch (e) {
          console.error('Invalid commit URL:', url, e);
          return false;
        }
      }

      /**
       * Open a commit in the browser via the extension host.
       * Validates URL before sending to ensure it points to a trusted domain.
       * Ticket: GITX-150
       *
       * @param {string} sha - The commit SHA to open
       */
      function openCommitInBrowser(sha) {
        if (!locDrillDownRepoUrl) {
          console.warn('Cannot open commit: no repository URL configured');
          return;
        }
        if (!sha) {
          console.warn('Cannot open commit: no SHA provided');
          return;
        }
        // Construct the commit URL: {repoUrl}/commit/{sha}
        var commitUrl = locDrillDownRepoUrl + '/commit/' + encodeURIComponent(sha);

        // Validate URL before opening
        if (!isValidCommitUrl(commitUrl)) {
          console.error('Commit URL validation failed:', commitUrl);
          return;
        }

        console.log('Opening commit in browser:', commitUrl);
        vscode.postMessage({
          type: 'openExternal',
          url: commitUrl
        });
      }

      /**
       * Initialize drill-down event listeners.
       * GITX-150: Implements SHA navigation via click and keyboard.
       * GITX-151: Implements focus trap for WCAG 2.1 compliance.
       */
      function initLocDrillDown() {
        var closeBtn = document.getElementById('locDrillDownClose');
        var retryBtn = document.getElementById('locDrillDownRetry');
        var modal = document.getElementById('locDrillDownModal');
        var modalContent = modal.querySelector('.drill-down-modal-content');
        var tbody = document.getElementById('locDrillDownBody');

        // Close button
        closeBtn.addEventListener('click', closeLocDrillDown);

        // Retry button
        retryBtn.addEventListener('click', function() {
          if (locDrillDownPending) {
            requestLocDrillDown(locDrillDownPending.weekStart);
          }
        });

        // GITX-151: Focus trap and Escape key handling
        modal.addEventListener('keydown', function(event) {
          // Escape key closes modal
          if (event.key === 'Escape') {
            closeLocDrillDown();
            return;
          }

          // GITX-151: Focus trap - cycle Tab/Shift+Tab within modal
          if (event.key === 'Tab') {
            handleFocusTrap(event, modalContent);
          }
        });

        // Click outside modal content closes it
        modal.addEventListener('click', function(event) {
          if (event.target === modal) {
            closeLocDrillDown();
          }
        });

        // GITX-150: SHA cell click to open commit in browser
        tbody.addEventListener('click', function(event) {
          var shaCell = event.target.closest('.sha-cell');
          if (shaCell) {
            var sha = shaCell.getAttribute('data-sha');
            openCommitInBrowser(sha);
          }
        });

        // GITX-150: Keyboard accessibility - Enter/Space on focused SHA cell
        tbody.addEventListener('keydown', function(event) {
          if (event.key === 'Enter' || event.key === ' ') {
            var shaCell = event.target.closest('.sha-cell');
            if (shaCell) {
              event.preventDefault();
              var sha = shaCell.getAttribute('data-sha');
              openCommitInBrowser(sha);
            }
          }
        });
      }
  `;
}
