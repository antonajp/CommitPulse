/**
 * D3 chart common utilities shared across dashboard charts.
 * Provides chart dimension calculations, theme color helpers, and Git commit navigation.
 *
 * Supports multiple Git providers:
 * - GitHub: /commit/{sha}
 * - Bitbucket: /commits/{sha}
 * - GitLab: /-/commit/{sha}
 *
 * Ticket: IQS-930 (extracted from d3-dev-pipeline-section.ts)
 * Ticket: IQS-938 (multi-provider support)
 */

/**
 * Generate JavaScript source for common chart utilities.
 * These functions are shared between different chart renderers.
 *
 * @returns JavaScript source string for embedding in webview
 */
export function generateChartCommonScript(): string {
  return `
    // ======================================================================
    // Common Chart Setup (IQS-930)
    // ======================================================================

    /**
     * Get chart dimensions based on container size.
     * @param {string} svgId - ID of the SVG element
     * @returns {object} Object with width, height, margin, innerWidth, innerHeight
     */
    function getChartDimensions(svgId) {
      var container = document.getElementById(svgId).parentElement;
      var containerWidth = container.clientWidth;
      var margin = { top: 20, right: 80, bottom: 60, left: 80 };
      var width = Math.max(600, containerWidth);
      var height = 300;
      var innerWidth = width - margin.left - margin.right;
      var innerHeight = height - margin.top - margin.bottom;
      return { width: width, height: height, margin: margin, innerWidth: innerWidth, innerHeight: innerHeight };
    }

    /**
     * Get VS Code theme color from CSS variable.
     * @param {string} variable - CSS variable name (e.g., '--vscode-foreground')
     * @param {string} fallback - Fallback color if variable not set
     * @returns {string} Color value
     */
    function getVSCodeThemeColor(variable, fallback) {
      var value = getComputedStyle(document.body).getPropertyValue(variable).trim();
      return value || fallback;
    }

    // ======================================================================
    // Git Commit Navigation (IQS-930, IQS-938)
    // ======================================================================

    /**
     * Detect Git provider from repository URL.
     * Supports GitHub, Bitbucket, GitLab, and enterprise instances.
     * @param {string} repoUrl - Repository URL
     * @returns {string} Provider type: 'github', 'bitbucket', 'gitlab', or 'unknown'
     */
    function detectGitProvider(repoUrl) {
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
    function isValidSha(sha) {
      if (!sha || typeof sha !== 'string') return false;
      return /^[0-9a-f]{7,40}$/i.test(sha);
    }

    /**
     * Build the commit URL for a Git provider.
     * Returns null if repoUrl or latestSha is missing or invalid.
     * @param {object} d - Data point with repoUrl and latestSha
     * @returns {string|null} Commit URL or null
     */
    function buildGitHubCommitUrl(d) {
      if (!d.repoUrl || !d.latestSha) return null;
      if (!isValidSha(d.latestSha)) return null;

      var baseUrl = d.repoUrl.replace(/\\/$/, '').replace(/\\.git$/i, '');
      var provider = detectGitProvider(d.repoUrl);
      var sha = encodeURIComponent(d.latestSha);

      switch (provider) {
        case 'bitbucket':
          return baseUrl + '/commits/' + sha;
        case 'gitlab':
          return baseUrl + '/-/commit/' + sha;
        case 'github':
        case 'unknown':
        default:
          return baseUrl + '/commit/' + sha;
      }
    }

    /**
     * Build HTML for a clickable commit link.
     * Returns empty string if no commit info available.
     * @param {object} d - Data point with commit info
     * @returns {string} HTML string for commit link
     */
    function buildCommitLink(d) {
      var url = buildGitHubCommitUrl(d);
      if (!url) return '';
      var shortSha = d.latestSha.substring(0, 7);
      return '<div class="tt-ticket" style="margin-top: 8px;">' +
        '<span class="ticket-link" data-commit-url="' + escapeHtml(url) + '" style="cursor: pointer;">' +
        '\\ud83d\\udd17 View latest commit (' + escapeHtml(shortSha) + ')' +
        '</span></div>' +
        '<div class="tt-hint">Click point or link to open in browser</div>';
    }

    /**
     * Handle click on a chart point - opens the commit in GitHub.
     * @param {Event} event - Click event
     * @param {object} d - Data point with commit info
     */
    function handlePointClick(event, d) {
      var url = buildGitHubCommitUrl(d);
      if (url) {
        vscode.postMessage({
          type: 'openExternal',
          url: url
        });
      }
    }
  `;
}

/**
 * Generate JavaScript source for tooltip hover tracking.
 * Keeps tooltip visible when hovering over it.
 *
 * @returns JavaScript source string for embedding in webview
 */
export function generateTooltipHoverScript(): string {
  return `
    // ======================================================================
    // Tooltip Hover Tracking (IQS-930)
    // ======================================================================

    var tooltipHovered = false;
    var hideTooltipTimeout = null;

    tooltip.addEventListener('mouseenter', function() {
      tooltipHovered = true;
      if (hideTooltipTimeout) {
        clearTimeout(hideTooltipTimeout);
        hideTooltipTimeout = null;
      }
    });

    tooltip.addEventListener('mouseleave', function() {
      tooltipHovered = false;
      hideTooltipWithDelay();
    });

    function hideTooltipWithDelay() {
      if (hideTooltipTimeout) {
        clearTimeout(hideTooltipTimeout);
      }
      hideTooltipTimeout = setTimeout(function() {
        if (!tooltipHovered) {
          tooltip.classList.remove('visible');
          tooltip.setAttribute('aria-hidden', 'true');
        }
      }, 100);
    }

    // Set up tooltip link click handler
    document.addEventListener('click', function(event) {
      var target = event.target;
      if (target && target.classList && target.classList.contains('ticket-link')) {
        var url = target.getAttribute('data-commit-url');
        if (url) {
          vscode.postMessage({
            type: 'openExternal',
            url: url
          });
        }
      }
    });
  `;
}
