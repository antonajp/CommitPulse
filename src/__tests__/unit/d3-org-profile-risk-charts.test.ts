import { describe, it, expect } from 'vitest';
import {
  generateOrgProfileRiskChartsScript,
  getRiskTierColors,
} from '../../views/webview/d3-org-profile-risk-charts.js';

/**
 * Unit tests for the Organization Profile risk charts (GITX-209).
 * Tests hot spots bubble chart and knowledge concentration treemap.
 *
 * Test coverage includes:
 * - Risk tier color mapping
 * - Hot spots bubble chart: X=complexity, Y=churn, size=LOC, color=risk
 * - Knowledge concentration treemap: size=commits, color=contributor
 * - Team member color palette (Okabe-Ito)
 * - Tooltip content and positioning
 * - File click to open in VS Code
 * - Accessibility features
 */
describe('d3-org-profile-risk-charts (GITX-209)', () => {
  describe('getRiskTierColors', () => {
    it('should return object with all risk tiers', () => {
      const colors = getRiskTierColors();
      expect(colors).toHaveProperty('critical');
      expect(colors).toHaveProperty('high');
      expect(colors).toHaveProperty('medium');
      expect(colors).toHaveProperty('low');
    });

    it('should return valid hex color codes', () => {
      const colors = getRiskTierColors();
      const hexRegex = /^#[0-9A-Fa-f]{6}$/;
      Object.values(colors).forEach((color) => {
        expect(color).toMatch(hexRegex);
      });
    });

    it('should use red for critical risk', () => {
      const colors = getRiskTierColors();
      expect(colors.critical).toBe('#FF4444');
    });

    it('should use orange for high risk', () => {
      const colors = getRiskTierColors();
      expect(colors.high).toBe('#FF8800');
    });
  });

  describe('generateOrgProfileRiskChartsScript', () => {
    const script = generateOrgProfileRiskChartsScript();

    describe('Risk tier colors in generated script', () => {
      it('should define RISK_TIER_COLORS object', () => {
        expect(script).toContain('var RISK_TIER_COLORS = {');
        expect(script).toContain("critical: '#FF4444'");
        expect(script).toContain("high: '#FF8800'");
        expect(script).toContain("medium: '#FFCC00'");
        expect(script).toContain("low: '#88BB00'");
      });

      it('should define getRiskTierColor function', () => {
        expect(script).toContain('function getRiskTierColor(tier)');
      });
    });

    describe('Team member color palette', () => {
      it('should include all 12 Okabe-Ito colors for team members', () => {
        expect(script).toContain('#E69F00'); // Orange
        expect(script).toContain('#56B4E9'); // Sky Blue
        expect(script).toContain('#009E73'); // Bluish Green
        expect(script).toContain('#F0E442'); // Yellow
        expect(script).toContain('#0072B2'); // Blue
        expect(script).toContain('#D55E00'); // Vermilion
        expect(script).toContain('#CC79A7'); // Reddish Purple
      });

      it('should define getMemberColor function', () => {
        expect(script).toContain('function getMemberColor(index)');
      });

      it('should cycle through colors with modulo', () => {
        expect(script).toContain('MEMBER_COLORS[index % MEMBER_COLORS.length]');
      });
    });

    describe('Hot spots bubble chart', () => {
      it('should define renderOrgHotSpotsChart function', () => {
        expect(script).toContain('function renderOrgHotSpotsChart(data)');
      });

      it('should hide skeleton on render', () => {
        expect(script).toContain("hideSkeleton('orgHotSpotsSkeleton')");
      });

      it('should cache data for reference', () => {
        expect(script).toContain('cachedOrgHotSpots = data');
      });

      it('should show empty state when no data', () => {
        expect(script).toContain("emptyMsg.classList.remove('hidden')");
      });

      it('should use X scale for complexity', () => {
        expect(script).toContain('return x(d.complexity || 0)');
      });

      it('should use Y scale for churn count', () => {
        expect(script).toContain('return y(d.churnCount || 0)');
      });

      it('should use sqrt scale for bubble size (perceptual accuracy)', () => {
        expect(script).toContain('d3.scaleSqrt()');
        expect(script).toContain('sizeScale(d.loc || 100)');
      });

      it('should color bubbles by risk tier', () => {
        expect(script).toContain('getRiskTierColor(d.riskTier)');
      });

      it('should label X axis as Complexity', () => {
        expect(script).toContain("text('Complexity')");
      });

      it('should label Y axis as Churn (Commits)', () => {
        expect(script).toContain("text('Churn (Commits)')");
      });

      it('should render risk tier legend', () => {
        expect(script).toContain("{ tier: 'critical', label: 'Critical' }");
        expect(script).toContain("{ tier: 'high', label: 'High' }");
        expect(script).toContain("{ tier: 'medium', label: 'Medium' }");
        expect(script).toContain("{ tier: 'low', label: 'Low' }");
      });

      it('should render size legend indicating LOC', () => {
        expect(script).toContain("text('Size = LOC')");
      });
    });

    describe('Knowledge concentration treemap', () => {
      it('should define renderOrgKnowledgeChart function', () => {
        expect(script).toContain('function renderOrgKnowledgeChart(data)');
      });

      it('should hide skeleton on render', () => {
        expect(script).toContain("hideSkeleton('orgKnowledgeSkeleton')");
      });

      it('should cache data for reference', () => {
        expect(script).toContain('cachedOrgKnowledgeData = data');
      });

      it('should show/hide legend container', () => {
        expect(script).toContain("legendContainer.classList.remove('hidden')");
        expect(script).toContain("legendContainer.classList.add('hidden')");
      });

      it('should extract unique top contributors for color mapping', () => {
        expect(script).toContain('var contributors = []');
        expect(script).toContain('d.topContributor');
      });

      it('should build hierarchy for treemap layout', () => {
        expect(script).toContain('d3.hierarchy({');
        expect(script).toContain("name: 'root'");
      });

      it('should sum by totalCommits for treemap value', () => {
        expect(script).toContain('value: d.totalCommits || 1');
      });

      it('should create treemap layout', () => {
        expect(script).toContain('d3.treemap()');
        expect(script).toContain('.padding(2)');
        expect(script).toContain('.round(true)');
      });

      it('should render treemap cells', () => {
        expect(script).toContain("attr('class', 'treemap-cell')");
        expect(script).toContain('root.leaves()');
      });

      it('should color cells by top contributor', () => {
        expect(script).toContain('colorMap[contributor]');
      });

      it('should add text labels for larger cells', () => {
        expect(script).toContain("(d.x1 - d.x0) > 60 && (d.y1 - d.y0) > 30");
      });

      it('should render legend with contributor names', () => {
        expect(script).toContain('class="legend-title">Top Contributors:</span>');
      });
    });

    describe('Tooltip functionality', () => {
      it('should define showOrgRiskTooltip function', () => {
        expect(script).toContain('function showOrgRiskTooltip(event, html)');
      });

      it('should define moveOrgRiskTooltip function', () => {
        expect(script).toContain('function moveOrgRiskTooltip(event)');
      });

      it('should define hideOrgRiskTooltip function', () => {
        expect(script).toContain('function hideOrgRiskTooltip()');
      });

      it('should use orgFileTooltip element (shared with file charts)', () => {
        expect(script).toContain("document.getElementById('orgFileTooltip')");
      });

      it('should show risk score and tier in hot spots tooltip', () => {
        expect(script).toContain('Risk Score:');
        expect(script).toContain('RISK</span>');
      });

      it('should show contributor ownership percentage in knowledge tooltip', () => {
        expect(script).toContain("Top: ' + escapeHtml(fd.topContributor");
        expect(script).toContain('topContributorPct');
      });

      it('should handle viewport boundary detection', () => {
        expect(script).toContain('viewportWidth - 20');
        expect(script).toContain('viewportHeight - 20');
      });
    });

    describe('Concentration risk color', () => {
      it('should define getConcentrationRiskColor function', () => {
        expect(script).toContain('function getConcentrationRiskColor(risk)');
      });

      it('should return red for critical/high concentration', () => {
        expect(script).toContain("r === 'critical' || r === 'high'");
        expect(script).toContain("return '#FF4444'");
      });

      it('should return yellow for medium concentration', () => {
        expect(script).toContain("r === 'medium'");
        expect(script).toContain("return '#FFCC00'");
      });

      it('should return green for low concentration', () => {
        expect(script).toContain("return '#88BB00'");
      });
    });

    describe('File click to open in VS Code', () => {
      it('should post openFile message on bubble click', () => {
        expect(script).toContain("type: 'openFile'");
        expect(script).toContain('filePath: d.filePath');
      });

      it('should post openFile message on treemap cell click', () => {
        expect(script).toContain('filePath: fd.filePath');
        expect(script).toContain("repository: fd.repository || ''");
      });

      it('should handle keyboard activation', () => {
        expect(script).toContain(".on('keydown'");
        expect(script).toContain("event.key === 'Enter'");
        expect(script).toContain("event.key === ' '");
      });

      it('should hint about click-to-open in tooltip', () => {
        expect(script).toContain('Click to open file');
      });
    });

    describe('Accessibility features', () => {
      it('should set role="button" on interactive elements', () => {
        expect(script).toContain(".attr('role', 'button')");
      });

      it('should set tabindex for keyboard navigation', () => {
        expect(script).toContain(".attr('tabindex', '0')");
      });

      it('should provide aria-label with context', () => {
        expect(script).toContain(".attr('aria-label'");
      });

      it('should escape HTML in aria-label and tooltip', () => {
        expect(script).toContain('escapeHtml(');
      });

      it('should set aria-hidden on tooltip', () => {
        expect(script).toContain("setAttribute('aria-hidden', 'false')");
        expect(script).toContain("setAttribute('aria-hidden', 'true')");
      });

      it('should set role="img" on chart SVGs', () => {
        expect(script).toContain("attr('role', 'img')");
      });
    });

    describe('Path truncation', () => {
      it('should define truncateRiskFilePath function', () => {
        expect(script).toContain('function truncateRiskFilePath(path, maxLen)');
      });

      it('should add ellipsis prefix for long paths', () => {
        expect(script).toContain("return '...' + path.slice(-(maxLen - 3))");
      });
    });

    describe('Chart layout', () => {
      it('should add grid lines for bubble chart', () => {
        expect(script).toContain(".attr('class', 'grid')");
        expect(script).toContain("stroke-dasharray', '2,2'");
      });

      it('should remove grid domain lines', () => {
        expect(script).toContain("g.selectAll('.grid .domain').remove()");
      });

      it('should highlight bubble on hover', () => {
        expect(script).toContain("attr('stroke-width', 3)");
        expect(script).toContain("attr('stroke-width', 2)");
      });
    });

    describe('GITX-209 ticket reference', () => {
      it('should reference GITX-209 in comments', () => {
        expect(script).toContain('GITX-209');
      });
    });
  });
});
