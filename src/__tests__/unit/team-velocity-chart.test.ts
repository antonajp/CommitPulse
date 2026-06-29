import { describe, it, expect } from 'vitest';
import { generateTeamVelocityChartScript, generateLocByRepoChartScript } from '../../views/webview/team-velocity-chart.js';

/**
 * Unit tests for the Team Sprint Velocity chart (GITX-200).
 * Tests stacked bar chart with member colors and LOC overlay.
 *
 * Test coverage includes:
 * - Okabe-Ito colorblind-safe palette (12 colors)
 * - Deterministic color assignment by sorted member names
 * - Max 10 members in legend, "Other Members" grouping
 * - Interactive legend with toggle visibility
 * - Graceful degradation when no Jira data
 * - Dual-axis (story points left, LOC right)
 * - Tooltip content with member name and percentage
 * - Accessibility features
 *
 * Ticket: GITX-200
 */
describe('team-velocity-chart (GITX-200)', () => {
  describe('generateTeamVelocityChartScript', () => {
    it('should return a non-empty string', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toBeDefined();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should include Okabe-Ito color palette', () => {
      const script = generateTeamVelocityChartScript();
      // Check for Okabe-Ito base colors
      expect(script).toContain('#E69F00'); // Orange
      expect(script).toContain('#56B4E9'); // Sky Blue
      expect(script).toContain('#009E73'); // Bluish Green
      expect(script).toContain('#0072B2'); // Blue
      expect(script).toContain('#D55E00'); // Vermillion
      expect(script).toContain('#CC79A7'); // Reddish Purple
    });

    it('should include MEMBER_COLORS array with 12 colors', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('var MEMBER_COLORS = [');
      // Count the number of hex colors in the array
      const colorMatches = script.match(/'#[A-Fa-f0-9]{6}'/g);
      expect(colorMatches).toBeDefined();
      expect(colorMatches!.length).toBeGreaterThanOrEqual(12);
    });

    it('should define MAX_LEGEND_MEMBERS as 10', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('var MAX_LEGEND_MEMBERS = 10');
    });

    it('should define renderTeamVelocityChart function', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('function renderTeamVelocityChart(data)');
    });

    it('should define renderTeamVelocityLegend function', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('function renderTeamVelocityLegend(svg, width, height, stackKeys, hasLocData, hasStoryPoints)');
    });

    it('should define getMemberColor function', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('function getMemberColor(memberName, allMembers)');
    });

    it('should include LOC_LINE_COLOR constant', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('var LOC_LINE_COLOR');
      expect(script).toContain('#56B4E9'); // Sky Blue for LOC line
    });

    it('should include graceful degradation for no Jira data', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('hasStoryPoints');
      expect(script).toContain('bar-loc-fallback');
    });

    it('should include dual-axis labels', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('Story Points');
      expect(script).toContain('Lines of Code');
    });

    it('should include tooltip helper functions', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('function showTeamVelocityTooltip');
      expect(script).toContain('function moveTeamVelocityTooltip');
      expect(script).toContain('function hideTeamVelocityTooltip');
    });

    it('should escape HTML in tooltip member name', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('escapeHtml(d.key)');
    });

    it('should include accessibility attributes', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('tabindex');
      expect(script).toContain('role');
      expect(script).toContain('aria-label');
      expect(script).toContain('aria-pressed');
    });

    it('should include keyboard event handlers for legend', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain("e.key === 'Enter'");
      expect(script).toContain("e.key === ' '");
    });

    it('should include pattern definitions for high-contrast mode', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('function definePatterns(svg)');
      expect(script).toContain('defs.append');
      expect(script).toContain('pattern-');
    });

    it('should include memberVisibility state', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('var memberVisibility = {}');
    });

    it('should include sorted members for deterministic color assignment', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('sortedMembers = Array.from(memberSet).sort()');
    });

    it('should include "Other Members" grouping', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain("'Other Members'");
      expect(script).toContain('pattern-other');
    });

    it('should reference skeleton and chart element IDs', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('sprintVelocitySkeleton');
      expect(script).toContain('sprintVelocityChart');
      expect(script).toContain('sprintVelocityEmpty');
      expect(script).toContain('sprintVelocityHint');
      expect(script).toContain('sprintVelocityNoJira');
    });

    it('should reference tooltip element ID', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('teamVelocityTooltip');
    });

    it('should include click handler for legend toggle', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain("g.on('click'");
      expect(script).toContain('memberVisibility[item.key] = !memberVisibility[item.key]');
    });

    it('should include D3 stack layout', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('d3.stack()');
      expect(script).toContain('.keys(stackKeys)');
    });

    it('should include D3 line for LOC trend', () => {
      const script = generateTeamVelocityChartScript();
      expect(script).toContain('d3.line()');
      expect(script).toContain('d3.curveMonotoneX');
    });
  });

  describe('generateLocByRepoChartScript', () => {
    it('should return a string', () => {
      const script = generateLocByRepoChartScript();
      expect(typeof script).toBe('string');
    });

    it('should include GITX-200 comment', () => {
      const script = generateLocByRepoChartScript();
      expect(script).toContain('GITX-200');
    });
  });
});
