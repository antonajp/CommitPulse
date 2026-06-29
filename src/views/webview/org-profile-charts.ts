/**
 * D3.js chart rendering functions for the Organization Profile Dashboard.
 * Contains inline JavaScript code for rendering charts in the webview.
 * GITX-207, GITX-201, GITX-216: Sprint Velocity & Lines of Code Charts.
 *
 * Charts implemented (from d3-org-velocity-chart.ts):
 * - Sprint Velocity vs Lines of Code: Team-colored stacked bars with LOC trend line
 * - Lines of Code by Team: Team-colored line chart
 *
 * Secondary charts are in org-profile-charts-secondary.ts:
 * - Technology Stack doughnut chart
 * - Comments Added line chart
 * - Test Files Modified line chart
 * - Commit Hygiene gauge
 *
 * All charts:
 * - Use dynamic aggregation (weekly for <=365 days, monthly for >365 days)
 * - Respect VS Code theme (light/dark/high-contrast)
 * - Have D3 tooltips with detailed values
 * - Display empty state when no data available
 */

import { generateOrgProfileSecondaryChartScripts } from './org-profile-charts-secondary.js';
import { generateOrgProfileFileChartsScript } from './d3-org-profile-file-charts.js';
import { generateOrgProfileRiskChartsScript } from './d3-org-profile-risk-charts.js';
import { generateOrgVelocityWithTeamsChartScript, generateOrgLocByTeamChartScript } from './d3-org-velocity-chart.js';

/**
 * Generate the JavaScript code for shared utility functions.
 * GITX-207: Shared utilities used by secondary charts.
 */
export function generateOrgSharedUtilitiesScript(): string {
  return `
      // ======================================================================
      // GITX-207: Shared Utility Functions for Org Profile Charts
      // ======================================================================
      function formatWeekDate(weekStr) {
        try {
          var date = new Date(weekStr + 'T00:00:00');
          var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          if (currentAggregationPeriod === 'month') {
            return months[date.getMonth()] + ' ' + date.getFullYear();
          }
          return 'Week of ' + months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
        } catch (e) {
          return weekStr;
        }
      }
`;
}

/**
 * Generate all chart rendering scripts combined.
 * GITX-201: Added generateOrgVelocityWithTeamsChartScript for team-colored velocity chart.
 * GITX-201: Added generateOrgLocByTeamChartScript for team-colored LOC line chart.
 * GITX-208: Added generateOrgProfileFileChartsScript for team-colored file charts.
 * GITX-209: Added generateOrgProfileRiskChartsScript for hot spots and knowledge concentration.
 * GITX-216: Removed old generateOrgVelocityChartScript (superseded by team-colored version).
 */
export function generateOrgProfileChartScripts(): string {
  return generateOrgSharedUtilitiesScript() +
    generateOrgVelocityWithTeamsChartScript() +
    generateOrgLocByTeamChartScript() +
    generateOrgProfileSecondaryChartScripts() +
    generateOrgProfileFileChartsScript() +
    generateOrgProfileRiskChartsScript();
}
