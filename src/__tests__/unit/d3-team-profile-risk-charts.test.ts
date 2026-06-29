import { describe, it, expect } from 'vitest';
import {
  generateTeamProfileRiskChartsScript,
  DEVELOPER_PALETTE,
  MAX_DEVELOPERS_DISPLAYED,
  OTHER_DEVELOPERS_COLOR,
  getDeveloperColorByIndex,
} from '../../views/webview/d3-team-profile-risk-charts.js';

/**
 * Unit tests for the Team Profile risk charts (GITX-188, GITX-193).
 * Tests hot spots bubble chart and knowledge concentration treemap
 * with developer color coding.
 *
 * Test coverage includes:
 * - Hot spots bubble chart: X=complexity, Y=churn, size=LOC, color=risk
 * - Knowledge concentration treemap: size=commits, color=developer
 * - Developer color palette (Okabe-Ito extended to 12 colors)
 * - Max 10 developers displayed, remaining as "Other Developers"
 * - Interactive legend with click-to-toggle visibility
 * - High contrast mode pattern fills
 * - Tooltip content with developer color swatch
 * - File click to open in VS Code
 * - Accessibility features
 *
 * Ticket: GITX-188, GITX-193
 */
describe('d3-team-profile-risk-charts (GITX-188, GITX-193)', () => {
  describe('DEVELOPER_PALETTE', () => {
    it('should have 12 distinct colors', () => {
      expect(DEVELOPER_PALETTE).toHaveLength(12);
    });

    it('should include Okabe-Ito base colors', () => {
      expect(DEVELOPER_PALETTE).toContain('#E69F00'); // Orange
      expect(DEVELOPER_PALETTE).toContain('#56B4E9'); // Sky Blue
      expect(DEVELOPER_PALETTE).toContain('#009E73'); // Bluish Green
      expect(DEVELOPER_PALETTE).toContain('#0072B2'); // Blue
    });

    it('should include extended colors', () => {
      expect(DEVELOPER_PALETTE).toContain('#8B4513'); // Saddle Brown
      expect(DEVELOPER_PALETTE).toContain('#6A5ACD'); // Slate Blue
      expect(DEVELOPER_PALETTE).toContain('#FF6347'); // Tomato
      expect(DEVELOPER_PALETTE).toContain('#20B2AA'); // Light Sea Green
    });

    it('should have all valid hex color codes', () => {
      const hexRegex = /^#[0-9A-Fa-f]{6}$/;
      DEVELOPER_PALETTE.forEach((color) => {
        expect(color).toMatch(hexRegex);
      });
    });
  });

  describe('MAX_DEVELOPERS_DISPLAYED', () => {
    it('should be 10', () => {
      expect(MAX_DEVELOPERS_DISPLAYED).toBe(10);
    });
  });

  describe('OTHER_DEVELOPERS_COLOR', () => {
    it('should be a valid hex color', () => {
      expect(OTHER_DEVELOPERS_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('should be gray (#666666)', () => {
      expect(OTHER_DEVELOPERS_COLOR).toBe('#666666');
    });
  });

  describe('getDeveloperColorByIndex', () => {
    it('should return first palette color for index 0', () => {
      expect(getDeveloperColorByIndex(0)).toBe(DEVELOPER_PALETTE[0]);
    });

    it('should return correct colors for valid indices', () => {
      for (let i = 0; i < MAX_DEVELOPERS_DISPLAYED; i++) {
        expect(getDeveloperColorByIndex(i)).toBe(DEVELOPER_PALETTE[i % DEVELOPER_PALETTE.length]);
      }
    });

    it('should return OTHER_DEVELOPERS_COLOR for index >= MAX_DEVELOPERS_DISPLAYED', () => {
      expect(getDeveloperColorByIndex(10)).toBe(OTHER_DEVELOPERS_COLOR);
      expect(getDeveloperColorByIndex(11)).toBe(OTHER_DEVELOPERS_COLOR);
      expect(getDeveloperColorByIndex(100)).toBe(OTHER_DEVELOPERS_COLOR);
    });

    it('should return OTHER_DEVELOPERS_COLOR for negative index', () => {
      expect(getDeveloperColorByIndex(-1)).toBe(OTHER_DEVELOPERS_COLOR);
    });
  });

  describe('generateTeamProfileRiskChartsScript', () => {
    const script = generateTeamProfileRiskChartsScript();

    describe('Hot Spots Bubble Chart (GITX-188)', () => {
      it('should define renderTeamHotSpotsChart function', () => {
        expect(script).toContain('function renderTeamHotSpotsChart(data)');
      });

      it('should define HOT_SPOT_TIER_COLORS', () => {
        expect(script).toContain('var HOT_SPOT_TIER_COLORS = {');
        expect(script).toContain("critical: '#e63946'");
        expect(script).toContain("high: '#f67019'");
        expect(script).toContain("medium: '#f9c74f'");
        expect(script).toContain("low: '#2a9d8f'");
      });

      it('should hide skeleton on render', () => {
        expect(script).toContain("hideSkeleton('hotSpotsSkeleton')");
      });

      it('should use log scale for X axis (complexity)', () => {
        expect(script).toContain('d3.scaleLog()');
      });

      it('should use sqrt scale for bubble size', () => {
        expect(script).toContain('d3.scaleSqrt()');
      });

      it('should render risk tier legend', () => {
        expect(script).toContain("tiers.forEach(function(tier, i)");
      });
    });

    describe('Knowledge Concentration Developer Color Coding (GITX-193)', () => {
      it('should define DEVELOPER_COLORS array with 12 colors', () => {
        expect(script).toContain('var DEVELOPER_COLORS = [');
        expect(script).toContain("'#E69F00'"); // Orange
        expect(script).toContain("'#56B4E9'"); // Sky Blue
        expect(script).toContain("'#8B4513'"); // Saddle Brown
        expect(script).toContain("'#6A5ACD'"); // Slate Blue
      });

      it('should define MAX_DEVELOPERS constant as 10', () => {
        expect(script).toContain('var MAX_DEVELOPERS = 10');
      });

      it('should define OTHER_DEVELOPERS_COLOR', () => {
        expect(script).toContain("var OTHER_DEVELOPERS_COLOR = '#666666'");
      });

      it('should define OTHER_DEVELOPERS_NAME', () => {
        expect(script).toContain("var OTHER_DEVELOPERS_NAME = 'Other Developers'");
      });

      it('should define renderTeamKnowledgeChart function', () => {
        expect(script).toContain('function renderTeamKnowledgeChart(data)');
      });

      it('should define getKnowledgeDeveloperColor function', () => {
        expect(script).toContain('function getKnowledgeDeveloperColor(index)');
      });

      it('should cycle through colors with modulo', () => {
        expect(script).toContain('DEVELOPER_COLORS[index % DEVELOPER_COLORS.length]');
      });

      it('should extract and sort unique top contributors', () => {
        expect(script).toContain('var contributorCounts = {}');
        expect(script).toContain('var sortedContributors = Object.keys(contributorCounts).sort');
      });

      it('should sort by total commits descending then alphabetically', () => {
        expect(script).toContain('contributorCounts[b] - contributorCounts[a]');
        expect(script).toContain('a.localeCompare(b)');
      });

      it('should limit displayed contributors to MAX_DEVELOPERS', () => {
        expect(script).toContain('displayedContributors = sortedContributors.slice(0, MAX_DEVELOPERS)');
      });

      it('should track other developers', () => {
        expect(script).toContain('hasOtherDevelopers = sortedContributors.length > MAX_DEVELOPERS');
        expect(script).toContain('otherContributors = sortedContributors.slice(MAX_DEVELOPERS)');
      });

      it('should build color map based on sorted order', () => {
        expect(script).toContain('var colorMap = {}');
        expect(script).toContain('colorMap[name] = getKnowledgeDeveloperColor(i)');
      });

      it('should assign OTHER_DEVELOPERS_COLOR to overflow contributors', () => {
        expect(script).toContain('colorMap[name] = OTHER_DEVELOPERS_COLOR');
      });
    });

    describe('Interactive Legend (GITX-193)', () => {
      it('should define knowledgeHiddenDevelopers state', () => {
        expect(script).toContain('var knowledgeHiddenDevelopers = {}');
      });

      it('should define renderKnowledgeLegend function', () => {
        expect(script).toContain('function renderKnowledgeLegend(container, developers, colorMap, hasOtherDevelopers)');
      });

      it('should define toggleKnowledgeDeveloperVisibility function', () => {
        expect(script).toContain('function toggleKnowledgeDeveloperVisibility(developer)');
      });

      it('should toggle hidden state when clicking legend item', () => {
        expect(script).toContain('knowledgeHiddenDevelopers[developer] = !knowledgeHiddenDevelopers[developer]');
      });

      it('should re-render chart after toggle', () => {
        expect(script).toContain('renderTeamKnowledgeChart(cachedKnowledgeData)');
      });

      it('should render legend items with data-developer attribute', () => {
        expect(script).toContain("data-developer=\"' + escapeHtml(name) + '\"");
      });

      it('should add legend-item-hidden class when developer is hidden', () => {
        expect(script).toContain("isHidden ? ' legend-item-hidden' : ''");
      });

      it('should add click event listeners to legend items', () => {
        expect(script).toContain("item.addEventListener('click'");
      });

      it('should add keyboard event listeners to legend items', () => {
        expect(script).toContain("item.addEventListener('keydown'");
        expect(script).toContain("event.key === 'Enter'");
        expect(script).toContain("event.key === ' '");
      });

      it('should render +Others legend item when hasOtherDevelopers', () => {
        expect(script).toContain("'<span class=\"legend-name\">+Others</span>'");
      });

      it('should set aria-pressed attribute for accessibility', () => {
        expect(script).toContain("aria-pressed=\"' + (!isHidden) + '\"");
      });

      it('should set role=button on legend items', () => {
        expect(script).toContain('role="button"');
      });

      it('should set tabindex=0 for keyboard navigation', () => {
        expect(script).toContain('tabindex="0"');
      });
    });

    describe('Developer Visibility Filtering (GITX-193)', () => {
      it('should define isFileVisible function', () => {
        expect(script).toContain('function isFileVisible(fileData)');
      });

      it('should check if contributor is hidden', () => {
        expect(script).toContain('knowledgeHiddenDevelopers[contributor]');
      });

      it('should check if "Other Developers" is hidden for overflow contributors', () => {
        expect(script).toContain('knowledgeHiddenDevelopers[OTHER_DEVELOPERS_NAME]');
        expect(script).toContain('otherContributors.indexOf(contributor) !== -1');
      });

      it('should adjust opacity for hidden tiles', () => {
        expect(script).toContain('fillOpacity = isVisible ? 0.75 : 0.15');
        expect(script).toContain('strokeOpacity = isVisible ? 1 : 0.3');
      });

      it('should disable interaction for hidden tiles', () => {
        expect(script).toContain("cursor', isVisible ? 'pointer' : 'default'");
        expect(script).toContain("tabindex', isVisible ? '0' : '-1'");
      });

      it('should only add event handlers when visible', () => {
        expect(script).toContain('if (isVisible)');
      });

      it('should only render labels when visible', () => {
        expect(script).toContain('if (rw > 50 && rh > 22 && isVisible)');
      });
    });

    describe('High Contrast Mode Support (GITX-193)', () => {
      it('should define isHighContrastMode function', () => {
        expect(script).toContain('function isHighContrastMode()');
      });

      it('should check prefers-contrast media query', () => {
        expect(script).toContain("window.matchMedia('(prefers-contrast: more)')");
      });

      it('should define getKnowledgePatternId function', () => {
        expect(script).toContain('function getKnowledgePatternId(index)');
      });

      it('should have 6 distinct patterns', () => {
        expect(script).toContain("var patterns = ['diagonal', 'dots', 'horizontal', 'vertical', 'cross', 'zigzag']");
      });

      it('should define createKnowledgePatterns function', () => {
        expect(script).toContain('function createKnowledgePatterns(svg)');
      });

      it('should create SVG defs with patterns', () => {
        expect(script).toContain("var defs = svg.append('defs')");
      });

      it('should create diagonal stripes pattern', () => {
        expect(script).toContain("attr('id', 'knowledge-pattern-diagonal')");
      });

      it('should create dots pattern', () => {
        expect(script).toContain("attr('id', 'knowledge-pattern-dots')");
      });

      it('should create horizontal lines pattern', () => {
        expect(script).toContain("attr('id', 'knowledge-pattern-horizontal')");
      });

      it('should create vertical lines pattern', () => {
        expect(script).toContain("attr('id', 'knowledge-pattern-vertical')");
      });

      it('should create cross pattern', () => {
        expect(script).toContain("attr('id', 'knowledge-pattern-cross')");
      });

      it('should create zigzag pattern', () => {
        expect(script).toContain("attr('id', 'knowledge-pattern-zigzag')");
      });

      it('should add pattern overlay in high contrast mode', () => {
        expect(script).toContain("if (isHighContrastMode() && developerIndex >= 0 && isVisible)");
        expect(script).toContain("attr('class', 'knowledge-tile-pattern')");
      });
    });

    describe('Tooltip with Developer Color (GITX-193)', () => {
      it('should include color swatch in tooltip', () => {
        expect(script).toContain("display:inline-block;width:10px;height:10px;background:' + color");
      });

      it('should show owner name with percentage', () => {
        expect(script).toContain("'Owner: ' + escapeHtml(contributor) + ' (' + d.topContributorPct + '%)<br>'");
      });

      it('should show concentration risk with color', () => {
        expect(script).toContain("'<span style=\"color:' + riskColor + '\">Risk: ' + d.concentrationRisk.toUpperCase()");
      });

      it('should show click hint', () => {
        expect(script).toContain("'<small style=\"opacity:0.7;\">Click to open file</small>'");
      });
    });

    describe('File Click to Open (GITX-193)', () => {
      it('should post openFile message on click', () => {
        expect(script).toContain("type: 'openFile'");
        expect(script).toContain('filePath: d.filePath');
        expect(script).toContain('repository: d.repository');
      });

      it('should handle keyboard activation', () => {
        expect(script).toContain(".on('keydown'");
        expect(script).toContain("event.key === 'Enter'");
        expect(script).toContain("event.key === ' '");
      });
    });

    describe('Accessibility (GITX-193)', () => {
      it('should set role=img on SVG', () => {
        expect(script).toContain("attr('role', 'img')");
      });

      it('should set aria-label on SVG with description', () => {
        expect(script).toContain("'Knowledge Concentration treemap: tile size = commits, color = developer'");
      });

      it('should set role=button on treemap tiles', () => {
        expect(script).toContain(".attr('role', 'button')");
      });

      it('should set descriptive aria-label on tiles', () => {
        expect(script).toContain("escapeHtml(d.filePath) + ': ' + d.topContributorPct + '% owned by ' + escapeHtml(contributor)");
      });

      it('should escape HTML in all user-provided content', () => {
        expect(script).toContain('escapeHtml(');
      });
    });

    describe('Legend Container (GITX-193)', () => {
      it('should get knowledgeLegend container', () => {
        expect(script).toContain("var legendContainer = document.getElementById('knowledgeLegend')");
      });

      it('should show/hide legend container based on data', () => {
        expect(script).toContain("legendContainer.classList.add('hidden')");
        expect(script).toContain("legendContainer.classList.remove('hidden')");
      });

      it('should clear legend container before re-rendering', () => {
        expect(script).toContain("legendContainer.innerHTML = ''");
      });

      it('should render legend title', () => {
        expect(script).toContain("'<span class=\"legend-title\">Top Contributors:</span> '");
      });

      it('should render legend swatches with developer colors', () => {
        expect(script).toContain("'<span class=\"legend-swatch\" style=\"background-color:' + color");
      });

      it('should truncate long developer names', () => {
        expect(script).toContain("name.length > 15 ? name.slice(0, 14) + '...' : name");
      });
    });

    describe('Contributor Initials (GITX-193)', () => {
      it('should define getContributorInitials function', () => {
        expect(script).toContain('function getContributorInitials(name)');
      });

      it('should return ?? for empty name', () => {
        expect(script).toContain("if (!name) { return '??'; }");
      });

      it('should split name on whitespace and special chars', () => {
        // In the template string, \\s becomes \s in the output
        expect(script).toContain('name.split(/[');
        expect(script).toContain('._-]+/)');
      });

      it('should return first two chars for single-part names', () => {
        expect(script).toContain('name.slice(0, 2).toUpperCase()');
      });

      it('should return first and last initial for multi-part names', () => {
        expect(script).toContain('parts[0][0] + parts[parts.length - 1][0]');
      });
    });

    describe('GITX-193 Ticket Reference', () => {
      it('should reference GITX-193 in comments', () => {
        expect(script).toContain('GITX-193');
      });
    });
  });
});
