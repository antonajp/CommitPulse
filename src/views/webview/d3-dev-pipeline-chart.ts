/**
 * D3.js multi-axis chart renderer for the Development Pipeline dashboard.
 * Renders 4 metric series (Complexity, LOC, Comments, Tests) with:
 * - Independent Y-axes per metric (2 left, 2 right)
 * - Team member coloring using Okabe-Ito colorblind-safe palette
 * - Dual encoding: marker fill = author color, marker stroke = metric color
 * - Distinct marker shapes preserved for accessibility
 *
 * Ticket: IQS-921, IQS-930
 */

import {
  OKABE_ITO_COLORS,
  UNKNOWN_DEVELOPER_COLOR,
  UNKNOWN_DEVELOPER_NAME,
} from './okabe-ito-palette.js';
import { generateAuthorColorScript } from './d3-author-utils.js';
import {
  generateYAxisDomainScript,
  generateMultiAxisChartScript,
  generateTooltipWithAuthorScript,
} from './d3-multi-axis-chart.js';
import { generateTwoSectionLegendScript } from './d3-two-section-legend.js';

// Re-export for backward compatibility with existing code
export const TEAM_MEMBER_COLORS = OKABE_ITO_COLORS;
export const UNKNOWN_AUTHOR_COLOR = UNKNOWN_DEVELOPER_COLOR;
export const UNKNOWN_AUTHOR_NAME = UNKNOWN_DEVELOPER_NAME;

// ============================================================================
// Multi-Axis Chart Script Generator (IQS-921, IQS-930)
// ============================================================================

/**
 * Generate the JavaScript source for the multi-axis development pipeline chart.
 * Implements:
 * - 4 independent Y-axes auto-scaling per metric
 * - Team member coloring with Okabe-Ito palette
 * - Dual encoding (author fill + metric stroke) for accessibility
 * - Two-section legend (metrics + team members)
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateDevPipelineChartScript(): string {
  // Combine all extracted scripts into a single output
  const authorScript = generateAuthorColorScript();
  const yAxisDomainScript = generateYAxisDomainScript();
  const multiAxisChartScript = generateMultiAxisChartScript();
  const tooltipWithAuthorScript = generateTooltipWithAuthorScript();
  const twoSectionLegendScript = generateTwoSectionLegendScript();

  return `
    ${authorScript}
    ${yAxisDomainScript}
    ${multiAxisChartScript}
    ${tooltipWithAuthorScript}
    ${twoSectionLegendScript}
  `;
}
