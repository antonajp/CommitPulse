/**
 * LOC drill-down functionality for the Sprint Velocity chart.
 * Generates JavaScript source for:
 * - LOC week drill-down modal interactions
 * - Data request and response handling
 * - Loading, error, and empty states
 * - Commit detail display with SHA navigation
 * - Focus trap for WCAG 2.1 compliance
 * - Disabled state for unconfigured repository URLs
 * - Provider-specific commit URL construction (GitHub, Bitbucket, GitLab)
 *
 * Ticket: GITX-149, GITX-150, GITX-151, GITX-160
 */

/**
 * Trusted domains for commit URL navigation.
 * Only URLs matching these domains will be opened.
 * Ticket: GITX-150
 */
const TRUSTED_COMMIT_DOMAINS = ['github.com', 'gitlab.com', 'bitbucket.org'];

/**
 * Git provider type for URL construction.
 * Ticket: GITX-160
 */
type GitProviderType = 'github' | 'bitbucket' | 'gitlab' | 'unknown';

/**
 * Provider-specific commit URL path segments.
 * - GitHub: /commit/{sha}
 * - Bitbucket: /commits/{sha}
 * - GitLab: /-/commit/{sha}
 * Ticket: GITX-160
 */
const COMMIT_PATH_SEGMENTS: Record<GitProviderType, string> = {
  github: '/commit/',
  bitbucket: '/commits/',
  gitlab: '/-/commit/',
  unknown: '/commit/', // Default to GitHub pattern
};

/**
 * Detect git provider from repository URL.
 * Supports GitHub, Bitbucket, and GitLab (including Enterprise/self-hosted).
 * Ticket: GITX-160
 *
 * @param repoUrl - Repository URL
 * @returns Detected provider type
 */
function detectProviderFromUrl(repoUrl: string): GitProviderType {
  if (!repoUrl) {
    return 'unknown';
  }
  const lower = repoUrl.toLowerCase();
  if (lower.includes('bitbucket.')) {
    return 'bitbucket';
  }
  if (lower.includes('gitlab.')) {
    return 'gitlab';
  }
  if (lower.includes('github.')) {
    return 'github';
  }
  return 'unknown';
}

/**
 * Build provider-specific commit URL.
 * Ticket: GITX-160
 *
 * @param repoUrl - Repository base URL
 * @param sha - Commit SHA
 * @returns Provider-appropriate commit URL
 */
export function buildProviderCommitUrl(repoUrl: string, sha: string): string {
  const provider = detectProviderFromUrl(repoUrl);
  const pathSegment = COMMIT_PATH_SEGMENTS[provider];
  // Clean trailing slashes and .git suffix
  const baseUrl = repoUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  return `${baseUrl}${pathSegment}${encodeURIComponent(sha)}`;
}

/**
 * Generate the JavaScript source for LOC drill-down functionality.
 * Returns a string to be embedded in a <script> block.
 *
 * @returns JavaScript source for LOC drill-down functions
 * Ticket: GITX-149, GITX-150, GITX-151
 */
export function generateLocDrillDownScript(): string {
  // Export trusted domains and provider path segments to webview script
  const trustedDomainsJson = JSON.stringify(TRUSTED_COMMIT_DOMAINS);
  const commitPathSegmentsJson = JSON.stringify(COMMIT_PATH_SEGMENTS);

  return `
      // ======================================================================
      // LOC Week Drill-Down (GITX-149, GITX-150, GITX-151, GITX-160)
      // ======================================================================

      var locDrillDownPending = null; // Track pending drill-down request
      var locDrillDownRepoUrl = null; // Repository URL for SHA navigation (GITX-150)
      var locDrillDownRepoUrlMap = null; // Map of repo name -> URL for multi-repo drill-down
      var locDrillDownPreviousFocus = null; // Element focused before modal opened (GITX-151)
      var TRUSTED_COMMIT_DOMAINS = ${trustedDomainsJson}; // Trusted domains for URL validation
      var COMMIT_PATH_SEGMENTS = ${commitPathSegmentsJson}; // Provider-specific path segments (GITX-160)

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
       * GITX-160: Renders disabled state when repoUrl is not configured.
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
        // Store repoUrlMap for multi-repo drill-down
        locDrillDownRepoUrlMap = message.repoUrlMap || null;

        // GITX-160: Determine if SHA cells should be disabled
        // SHA links are enabled if we have repoUrl OR repoUrlMap
        var hasAnyRepoUrls = locDrillDownRepoUrl || (locDrillDownRepoUrlMap && Object.keys(locDrillDownRepoUrlMap).length > 0);
        var shaDisabled = !hasAnyRepoUrls;

        if (!message.commits || message.commits.length === 0) {
          empty.style.display = 'block';
          // GITX-160: Hide footer hint when no commits
          var emptyFooterHint = document.getElementById('locDrillDownFooterHint');
          if (emptyFooterHint) {
            emptyFooterHint.innerHTML = '';
          }
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

        // GITX-160: Render commit rows with disabled state when repoUrl not configured
        tbody.innerHTML = message.commits.map(function(c) {
          var msgTrunc = c.message.length > 80 ? c.message.slice(0, 77) + '...' : c.message;
          var dateStr = c.commitDate.split('T')[0];
          // Check if this specific commit's repository has a URL configured
          var commitRepoUrl = locDrillDownRepoUrl;
          if (!commitRepoUrl && locDrillDownRepoUrlMap && c.repository) {
            commitRepoUrl = locDrillDownRepoUrlMap[c.repository] || null;
          }
          var commitDisabled = !commitRepoUrl;
          // GITX-160: Apply disabled styling when no repoUrl for this commit
          var shaCellClass = commitDisabled ? 'sha-cell sha-cell-disabled' : 'sha-cell';
          var shaCellAttrs = commitDisabled
            ? 'aria-disabled="true"'
            : 'tabindex="0" role="button"';
          return '<tr>' +
            '<td class="' + shaCellClass + '" data-sha="' + escapeHtml(c.fullSha || c.sha) + '" data-repo="' + escapeHtml(c.repository || '') + '" ' + shaCellAttrs + '>' +
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

        // GITX-160: Show/hide footer hint based on repoUrl availability
        var footerHint = document.getElementById('locDrillDownFooterHint');
        if (footerHint) {
          if (shaDisabled) {
            footerHint.innerHTML = '<span class="drill-down-footer-hint">' +
              'Commit links unavailable. ' +
              '<a href="#" id="configureRepoUrlLink" class="drill-down-configure-link">' +
              'Configure repository URL</a></span>';
            // Add click handler for configure link
            var configLink = document.getElementById('configureRepoUrlLink');
            if (configLink) {
              configLink.addEventListener('click', function(e) {
                e.preventDefault();
                vscode.postMessage({
                  type: 'openSettings',
                  query: 'gitr.repositories'
                });
              });
            }
          } else {
            footerHint.innerHTML = '';
          }
        }
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
        locDrillDownRepoUrlMap = null; // Clear repo URL map

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
       * Detect git provider from repository URL.
       * Ticket: GITX-160
       *
       * @param {string} repoUrl - Repository URL
       * @returns {string} - Detected provider type
       */
      function detectProvider(repoUrl) {
        if (!repoUrl) {
          return 'unknown';
        }
        var lower = repoUrl.toLowerCase();
        if (lower.indexOf('bitbucket.') !== -1) {
          return 'bitbucket';
        }
        if (lower.indexOf('gitlab.') !== -1) {
          return 'gitlab';
        }
        if (lower.indexOf('github.') !== -1) {
          return 'github';
        }
        return 'unknown';
      }

      /**
       * Build provider-specific commit URL.
       * Ticket: GITX-160
       *
       * @param {string} repoUrl - Repository base URL
       * @param {string} sha - Commit SHA
       * @returns {string} - Provider-appropriate commit URL
       */
      function buildCommitUrl(repoUrl, sha) {
        var provider = detectProvider(repoUrl);
        var pathSegment = COMMIT_PATH_SEGMENTS[provider] || '/commit/';
        // Clean trailing slashes and .git suffix
        var baseUrl = repoUrl.trim().replace(/\\/+$/, '').replace(/\\.git$/i, '');
        return baseUrl + pathSegment + encodeURIComponent(sha);
      }

      /**
       * Show a toast notification for user feedback.
       * Ticket: GITX-160
       *
       * @param {string} message - The message to display
       * @param {string} type - Toast type ('error', 'warning', 'info')
       */
      function showDrillDownToast(message, type) {
        var toastContainer = document.getElementById('drillDownToastContainer');
        if (!toastContainer) {
          // Create toast container if it doesn't exist
          toastContainer = document.createElement('div');
          toastContainer.id = 'drillDownToastContainer';
          toastContainer.className = 'toast-container';
          toastContainer.setAttribute('role', 'alert');
          toastContainer.setAttribute('aria-live', 'polite');
          document.body.appendChild(toastContainer);
        }

        var toast = document.createElement('div');
        toast.className = 'toast toast-' + (type || 'info');
        toast.textContent = message;

        toastContainer.appendChild(toast);

        // Trigger reflow for animation
        void toast.offsetWidth;
        toast.classList.add('toast-visible');

        // Auto-dismiss after 4 seconds
        setTimeout(function() {
          toast.classList.remove('toast-visible');
          setTimeout(function() {
            if (toast.parentNode) {
              toast.parentNode.removeChild(toast);
            }
          }, 300);
        }, 4000);
      }

      /**
       * Open a commit in the browser via the extension host.
       * Validates URL before sending to ensure it points to a trusted domain.
       * Shows toast notification when repoUrl is not configured.
       * Ticket: GITX-150, GITX-160
       *
       * @param {string} sha - The commit SHA to open
       * @param {string} repository - The repository name this commit belongs to
       */
      function openCommitInBrowser(sha, repository) {
        // Look up repoUrl: first check single-repo URL, then check map
        var repoUrl = locDrillDownRepoUrl;
        if (!repoUrl && locDrillDownRepoUrlMap && repository) {
          repoUrl = locDrillDownRepoUrlMap[repository] || null;
        }

        if (!repoUrl) {
          console.warn('Cannot open commit: no repository URL configured for', repository || 'unknown repo');
          // GITX-160: Show toast notification for missing repoUrl
          showDrillDownToast('Cannot open commit: repository URL not configured', 'warning');
          return;
        }
        if (!sha) {
          console.warn('Cannot open commit: no SHA provided');
          return;
        }
        // GITX-160: Build provider-specific commit URL
        var commitUrl = buildCommitUrl(repoUrl, sha);

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
            var repo = shaCell.getAttribute('data-repo');
            openCommitInBrowser(sha, repo);
          }
        });

        // GITX-150: Keyboard accessibility - Enter/Space on focused SHA cell
        tbody.addEventListener('keydown', function(event) {
          if (event.key === 'Enter' || event.key === ' ') {
            var shaCell = event.target.closest('.sha-cell');
            if (shaCell) {
              event.preventDefault();
              var sha = shaCell.getAttribute('data-sha');
              var repo = shaCell.getAttribute('data-repo');
              openCommitInBrowser(sha, repo);
            }
          }
        });
      }
  `;
}
