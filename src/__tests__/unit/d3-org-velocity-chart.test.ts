/**
 * Unit tests for d3-org-velocity-chart.ts
 * GITX-201: Sprint Velocity chart with team colors for Organization Profile Dashboard.
 */

import { describe, it, expect } from 'vitest';
import {
  generateOrgVelocityWithTeamsChartScript,
  generateOrgLocByTeamChartScript,
} from '../../views/webview/d3-org-velocity-chart.js';

describe('d3-org-velocity-chart', () => {
  describe('generateOrgVelocityWithTeamsChartScript', () => {
    it('returns non-empty string', () => {
      const result = generateOrgVelocityWithTeamsChartScript();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('includes Okabe-Ito colorblind-safe palette', () => {
      const result = generateOrgVelocityWithTeamsChartScript();
      expect(result).toContain('ORG_VELOCITY_TEAM_COLORS');
      expect(result).toContain('#E69F00'); // Orange
      expect(result).toContain('#56B4E9'); // Sky Blue
      expect(result).toContain('#009E73'); // Bluish Green
    });

    it('includes renderOrgVelocityWithTeamsChart function', () => {
      const result = generateOrgVelocityWithTeamsChartScript();
      expect(result).toContain('function renderOrgVelocityWithTeamsChart(data)');
    });

    it('includes tooltip functions', () => {
      const result = generateOrgVelocityWithTeamsChartScript();
      expect(result).toContain('showOrgVelocityTeamsTooltip');
      expect(result).toContain('moveOrgVelocityTeamsTooltip');
      expect(result).toContain('hideOrgVelocityTeamsTooltip');
    });

    it('includes interactive legend with toggle functionality', () => {
      const result = generateOrgVelocityWithTeamsChartScript();
      expect(result).toContain('renderOrgVelocityLegend');
      expect(result).toContain('orgTeamVisibility');
      expect(result).toContain('Toggle');
    });

    it('includes graceful degradation for missing Jira data', () => {
      const result = generateOrgVelocityWithTeamsChartScript();
      expect(result).toContain('hasStoryPoints');
      expect(result).toContain('hasLocData');
      expect(result).toContain('orgVelocityTeamsNoJira');
    });

    it('includes LOC trend line overlay', () => {
      const result = generateOrgVelocityWithTeamsChartScript();
      expect(result).toContain('ORG_LOC_LINE_COLOR');
      expect(result).toContain('Lines of Code');
    });

    it('includes accessibility attributes', () => {
      const result = generateOrgVelocityWithTeamsChartScript();
      expect(result).toContain('tabindex');
      expect(result).toContain('role');
      expect(result).toContain('aria-label');
    });

    it('includes high-contrast mode support', () => {
      const result = generateOrgVelocityWithTeamsChartScript();
      expect(result).toContain('defineOrgVelocityPatterns');
      expect(result).toContain('org-velocity-pattern-');
    });

    it('limits teams to 10 with Other Teams grouping', () => {
      const result = generateOrgVelocityWithTeamsChartScript();
      expect(result).toContain('ORG_MAX_LEGEND_TEAMS');
      expect(result).toContain('Other Teams');
    });
  });

  describe('generateOrgLocByTeamChartScript', () => {
    it('returns non-empty string', () => {
      const result = generateOrgLocByTeamChartScript();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('includes renderOrgLocByTeamChart function', () => {
      const result = generateOrgLocByTeamChartScript();
      expect(result).toContain('function renderOrgLocByTeamChart(data)');
    });

    it('includes interactive legend with toggle functionality', () => {
      const result = generateOrgLocByTeamChartScript();
      expect(result).toContain('orgLocTeamVisibility');
      expect(result).toContain('Toggle');
    });

    it('includes accessibility attributes', () => {
      const result = generateOrgLocByTeamChartScript();
      expect(result).toContain('tabindex');
      expect(result).toContain('role');
      expect(result).toContain('aria-label');
    });

    it('uses d3.line with defined() for zero-value filtering', () => {
      const result = generateOrgLocByTeamChartScript();
      expect(result).toContain('.defined(');
      expect(result).toContain('d3.line');
    });

    it('uses same color palette as velocity chart', () => {
      const result = generateOrgLocByTeamChartScript();
      expect(result).toContain('ORG_VELOCITY_TEAM_COLORS');
    });
  });
});
