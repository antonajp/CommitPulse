/**
 * D3 chart common utilities shared across dashboard charts.
 * Provides chart dimension calculations, theme color helpers, and GitHub navigation.
 *
 * Ticket: IQS-930 (extracted from d3-dev-pipeline-section.ts)
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
    // GitHub Commit Navigation (IQS-930)
    // ======================================================================

    /**
     * Build the GitHub URL for a commit.
     * Returns null if repoUrl or latestSha is missing.
     * @param {object} d - Data point with repoUrl and latestSha
     * @returns {string|null} GitHub commit URL or null
     */
    function buildGitHubCommitUrl(d) {
      if (!d.repoUrl || !d.latestSha) return null;
      var baseUrl = d.repoUrl.replace(/\\/$/, '');
      return baseUrl + '/commit/' + d.latestSha;
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
        '<div class="tt-hint">Click point or link to open in GitHub</div>';
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
