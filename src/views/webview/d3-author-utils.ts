/**
 * D3 author/developer color management utilities shared across dashboard charts.
 * Provides consistent author coloring using the Okabe-Ito colorblind-safe palette.
 *
 * Ticket: IQS-930 (extracted from d3-dev-pipeline-chart.ts and d3-dev-pipeline-section.ts)
 */

import {
  OKABE_ITO_COLORS,
  UNKNOWN_DEVELOPER_COLOR,
  UNKNOWN_DEVELOPER_NAME,
} from './okabe-ito-palette.js';

/**
 * Generate JavaScript source for author color management utilities.
 * These functions are shared between the multi-axis chart and the 4-section charts.
 *
 * @returns JavaScript source string for embedding in webview
 */
export function generateAuthorColorScript(): string {
  return `
    // ======================================================================
    // Okabe-Ito Colorblind-Safe Palette for Developers (IQS-930)
    // ======================================================================
    var DEVELOPER_COLORS = ${JSON.stringify(OKABE_ITO_COLORS)};
    var UNKNOWN_DEVELOPER_COLOR = '${UNKNOWN_DEVELOPER_COLOR}';
    var UNKNOWN_DEVELOPER_NAME = '${UNKNOWN_DEVELOPER_NAME}';

    // Aliases for backward compatibility with existing code
    var TEAM_MEMBER_COLORS = DEVELOPER_COLORS;
    var UNKNOWN_AUTHOR_COLOR = UNKNOWN_DEVELOPER_COLOR;
    var UNKNOWN_AUTHOR_NAME = UNKNOWN_DEVELOPER_NAME;

    // ======================================================================
    // Author/Developer Color Management
    // ======================================================================

    /**
     * Build a stable, sorted list of unique authors from the data.
     * Sorted by commit frequency (descending) for consistent color assignment.
     * @param {Array} data - Array of data points with author field
     * @returns {Array} Sorted array of unique author identifiers
     */
    function buildAuthorList(data) {
      if (!data || data.length === 0) return [];

      var authorCounts = {};
      data.forEach(function(d) {
        var author = d.author || UNKNOWN_DEVELOPER_NAME;
        // Use commitCount if available, otherwise count as 1
        var count = d.commitCount ? d.commitCount : 1;
        authorCounts[author] = (authorCounts[author] || 0) + count;
      });

      return Object.keys(authorCounts).sort(function(a, b) {
        var countDiff = authorCounts[b] - authorCounts[a];
        if (countDiff !== 0) return countDiff;
        return a.localeCompare(b);
      });
    }

    /**
     * Get the developer color for an author.
     * Colors cycle if there are more than 8 developers.
     * @param {string} author - Author identifier
     * @param {Array} authorList - Sorted author list from buildAuthorList
     * @returns {string} Hex color code
     */
    function getDeveloperColor(author, authorList) {
      if (!author) return UNKNOWN_DEVELOPER_COLOR;
      var index = authorList.indexOf(author);
      if (index === -1) return UNKNOWN_DEVELOPER_COLOR;
      return DEVELOPER_COLORS[index % DEVELOPER_COLORS.length];
    }

    // Alias for backward compatibility
    function getTeamMemberColor(author, authorList) {
      if (!author) return UNKNOWN_AUTHOR_COLOR;
      var index = authorList.indexOf(author);
      if (index === -1) return UNKNOWN_AUTHOR_COLOR;
      return TEAM_MEMBER_COLORS[index % TEAM_MEMBER_COLORS.length];
    }

    /**
     * Get author display name (prefer fullName over author username).
     * @param {object} d - Data point
     * @returns {string} Display name
     */
    function getAuthorDisplayName(d) {
      return d.fullName || d.author || UNKNOWN_DEVELOPER_NAME;
    }

    /**
     * Get author identifier for color lookup.
     * Uses author field (git username) as the stable identifier.
     * @param {object} d - Data point
     * @returns {string} Author identifier
     */
    function getAuthorId(d) {
      return d.author || UNKNOWN_DEVELOPER_NAME;
    }
  `;
}
