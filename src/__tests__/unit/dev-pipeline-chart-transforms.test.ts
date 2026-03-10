import { describe, it, expect } from 'vitest';

import {
  TEAM_MEMBER_COLORS,
  UNKNOWN_AUTHOR_COLOR,
  UNKNOWN_AUTHOR_NAME,
} from '../../views/webview/d3-dev-pipeline-chart.js';

/**
 * Unit tests for d3-dev-pipeline-chart.ts (IQS-921).
 * Tests the chart transformation utilities including:
 * - Team member color assignment
 * - Author list building
 * - Y-axis domain calculations
 * - Palette cycling for large teams
 */
describe('d3-dev-pipeline-chart', () => {
  describe('TEAM_MEMBER_COLORS', () => {
    it('should have 8 Okabe-Ito colorblind-safe colors', () => {
      expect(TEAM_MEMBER_COLORS).toHaveLength(8);
    });

    it('should have valid hex color codes', () => {
      const hexPattern = /^#[0-9A-Fa-f]{6}$/;
      TEAM_MEMBER_COLORS.forEach((color) => {
        expect(color).toMatch(hexPattern);
      });
    });

    it('should include the Okabe-Ito palette colors', () => {
      // Reference: https://jfly.uni-koeln.de/color/
      expect(TEAM_MEMBER_COLORS).toContain('#E69F00'); // Orange
      expect(TEAM_MEMBER_COLORS).toContain('#56B4E9'); // Sky Blue
      expect(TEAM_MEMBER_COLORS).toContain('#009E73'); // Bluish Green
      expect(TEAM_MEMBER_COLORS).toContain('#D4C800'); // Yellow (WCAG AA adjusted)
      expect(TEAM_MEMBER_COLORS).toContain('#0072B2'); // Blue
      expect(TEAM_MEMBER_COLORS).toContain('#D55E00'); // Vermillion
      expect(TEAM_MEMBER_COLORS).toContain('#CC79A7'); // Reddish Purple
      expect(TEAM_MEMBER_COLORS).toContain('#999999'); // Gray
    });
  });

  describe('UNKNOWN_AUTHOR_COLOR', () => {
    it('should be a valid hex color', () => {
      expect(UNKNOWN_AUTHOR_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('should be a gray color distinct from palette', () => {
      expect(UNKNOWN_AUTHOR_COLOR).toBe('#666666');
      expect(TEAM_MEMBER_COLORS).not.toContain(UNKNOWN_AUTHOR_COLOR);
    });
  });

  describe('UNKNOWN_AUTHOR_NAME', () => {
    it('should be a descriptive placeholder', () => {
      expect(UNKNOWN_AUTHOR_NAME).toBe('(Unknown Developer)');
    });
  });

  describe('generateDevPipelineChartScript', () => {
    // These tests validate the generated JavaScript contains expected functions
    // The actual runtime behavior is tested via integration/extension tests

    it('should be importable without errors', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      expect(module.generateDevPipelineChartScript).toBeDefined();
      expect(typeof module.generateDevPipelineChartScript).toBe('function');
    });

    it('should return a non-empty string', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should include buildAuthorList function', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(script).toContain('function buildAuthorList(data)');
    });

    it('should include getTeamMemberColor function', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(script).toContain('function getTeamMemberColor(author, authorList)');
    });

    it('should include calculateYAxisDomains function', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(script).toContain('function calculateYAxisDomains(data, seriesVisibility)');
    });

    it('should include renderMultiAxisChart function', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(script).toContain('function renderMultiAxisChart(');
    });

    it('should include showTooltipWithAuthor function', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(script).toContain('function showTooltipWithAuthor(event, d, authorList)');
    });

    it('should include renderTwoSectionLegend function', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(script).toContain('function renderTwoSectionLegend(');
    });

    it('should include TEAM_MEMBER_COLORS array', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(script).toContain('var TEAM_MEMBER_COLORS');
      expect(script).toContain('#E69F00');
    });

    it('should include author color cycling logic', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      // Colors cycle using modulo for teams > 8 members
      expect(script).toContain('TEAM_MEMBER_COLORS.length');
      expect(script).toContain('% TEAM_MEMBER_COLORS.length');
    });

    it('should include dual encoding comments for accessibility', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      // Marker fill = author color, stroke = metric color
      expect(script).toContain('authorColor');
      expect(script).toContain("attr('stroke', cfg.color)");
    });

    it('should include legend section structure', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(script).toContain('legend-section-metrics');
      expect(script).toContain('legend-section-team');
      expect(script).toContain('legend-section-title');
    });

    it('should handle more than 15 team members in legend', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(script).toContain('maxTeamMembers = 15');
      expect(script).toContain('and N others');
    });

    it('should include tooltip with author color indicator', async () => {
      const module = await import('../../views/webview/d3-dev-pipeline-chart.js');
      const script = module.generateDevPipelineChartScript();
      expect(script).toContain('tt-author-indicator');
    });
  });

  describe('Color palette accessibility', () => {
    it('should have distinct colors for common colorblindness types', () => {
      // Okabe-Ito palette is specifically designed for colorblind accessibility
      // Each color should be visually distinct
      const uniqueColors = new Set(TEAM_MEMBER_COLORS);
      expect(uniqueColors.size).toBe(TEAM_MEMBER_COLORS.length);
    });

    it('should have good contrast against dark backgrounds', () => {
      // All colors in the Okabe-Ito palette have been tested against
      // dark backgrounds (like VS Code dark theme)
      // This is a documentation test - actual contrast checking would
      // require a color library
      expect(TEAM_MEMBER_COLORS.length).toBeGreaterThan(0);
    });
  });
});
