/**
 * D3.js chart renderer for the Development Pipeline dashboard (IQS-929).
 * Renders 4 separate metric charts with weekly aggregation:
 * - LOC Delta (scatter plot)
 * - Complexity Delta (connected scatter)
 * - Comments Ratio % (line chart)
 * - Test Coverage Delta (stacked bar chart)
 *
 * Each chart uses Okabe-Ito colorblind-safe palette for developer coloring.
 * All charts share a common developer legend.
 *
 * Ticket: IQS-929, IQS-930
 */

import {
  OKABE_ITO_COLORS,
  UNKNOWN_DEVELOPER_COLOR,
  UNKNOWN_DEVELOPER_NAME,
} from './okabe-ito-palette.js';
import { generateAuthorColorScript } from './d3-author-utils.js';
import { generateChartCommonScript, generateTooltipHoverScript } from './d3-chart-common.js';
import {
  generateLocChartScript,
  generateComplexityChartScript,
  generateCommentsChartScript,
  generateTestsChartScript,
  generateDeveloperLegendScript,
} from './d3-section-charts.js';

// Re-export for backward compatibility
export const DEVELOPER_COLORS = OKABE_ITO_COLORS;
export { UNKNOWN_DEVELOPER_COLOR, UNKNOWN_DEVELOPER_NAME };

// ============================================================================
// D3 Chart Script Generator
// ============================================================================

/**
 * Generate the JavaScript source for the 4-chart Development Pipeline section.
 *
 * @returns JavaScript source string for embedding in a <script> block
 */
export function generateDevPipelineChartScript(): string {
  // Combine all extracted scripts into a single output
  const authorScript = generateAuthorColorScript();
  const commonScript = generateChartCommonScript();
  const tooltipScript = generateTooltipHoverScript();
  const locScript = generateLocChartScript();
  const complexityScript = generateComplexityChartScript();
  const commentsScript = generateCommentsChartScript();
  const testsScript = generateTestsChartScript();
  const legendScript = generateDeveloperLegendScript();

  return `
    ${authorScript}
    ${commonScript}
    ${tooltipScript}
    ${locScript}
    ${complexityScript}
    ${commentsScript}
    ${testsScript}
    ${legendScript}
  `;
}
