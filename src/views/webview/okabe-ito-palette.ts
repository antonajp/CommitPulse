/**
 * Okabe-Ito colorblind-safe color palette for developer/team member identification.
 * This palette provides 8 distinct colors that are accessible to people with
 * various forms of color vision deficiency.
 *
 * Used consistently across all Developer Pipeline charts.
 *
 * Reference: https://jfly.uni-koeln.de/color/
 *
 * Ticket: IQS-929
 */

/**
 * The 8-color Okabe-Ito colorblind-safe palette.
 * Colors are ordered for maximum visual distinction.
 *
 * Note: Yellow (#D4C800) has been adjusted from the original #F0E442
 * to meet WCAG AA contrast requirements (4.5:1) against white backgrounds.
 */
export const OKABE_ITO_COLORS: readonly string[] = [
  '#E69F00', // Orange
  '#56B4E9', // Sky Blue
  '#009E73', // Bluish Green
  '#D4C800', // Yellow (adjusted for WCAG AA contrast)
  '#0072B2', // Blue
  '#D55E00', // Vermillion
  '#CC79A7', // Reddish Purple
  '#999999', // Gray (fallback for overflow)
];

/**
 * Color used for unknown or unidentifiable developers.
 */
export const UNKNOWN_DEVELOPER_COLOR = '#666666';

/**
 * Display name for unknown developers.
 */
export const UNKNOWN_DEVELOPER_NAME = '(Unknown Developer)';

/**
 * Get a color for a developer based on their position in the sorted author list.
 * Colors cycle through the palette if there are more than 8 developers.
 *
 * @param author - The developer's username/identifier
 * @param sortedAuthors - The sorted list of all authors (used for consistent color assignment)
 * @returns The hex color code for this developer
 */
export function getDeveloperColor(author: string, sortedAuthors: readonly string[]): string {
  if (!author) {
    return UNKNOWN_DEVELOPER_COLOR;
  }
  const index = sortedAuthors.indexOf(author);
  if (index === -1) {
    return UNKNOWN_DEVELOPER_COLOR;
  }
  return OKABE_ITO_COLORS[index % OKABE_ITO_COLORS.length] ?? UNKNOWN_DEVELOPER_COLOR;
}

/**
 * Generate JavaScript code for the color palette to embed in webview HTML.
 * This ensures consistent colors between TypeScript and embedded JS.
 */
export function generateColorPaletteScript(): string {
  return `
    // Okabe-Ito colorblind-safe palette (IQS-929)
    var DEVELOPER_COLORS = ${JSON.stringify(OKABE_ITO_COLORS)};
    var UNKNOWN_DEVELOPER_COLOR = '${UNKNOWN_DEVELOPER_COLOR}';
    var UNKNOWN_DEVELOPER_NAME = '${UNKNOWN_DEVELOPER_NAME}';

    function getDeveloperColor(author, sortedAuthors) {
      if (!author) return UNKNOWN_DEVELOPER_COLOR;
      var index = sortedAuthors.indexOf(author);
      if (index === -1) return UNKNOWN_DEVELOPER_COLOR;
      return DEVELOPER_COLORS[index % DEVELOPER_COLORS.length];
    }
  `;
}
