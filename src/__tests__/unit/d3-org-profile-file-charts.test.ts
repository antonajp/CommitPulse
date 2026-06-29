import { describe, it, expect } from 'vitest';
import {
  generateOrgProfileFileChartsScript,
  getTeamColorPalette,
} from '../../views/webview/d3-org-profile-file-charts.js';

/**
 * Unit tests for the Organization Profile file charts (GITX-208).
 * Tests team-colored stacked bar charts for complex and frequent files.
 *
 * Test coverage includes:
 * - Extended Okabe-Ito color palette (12 colors)
 * - Max 10 teams with "Other Teams" overflow
 * - Interactive legend toggle functionality
 * - High-contrast mode support with patterns
 * - Tooltip content and positioning
 * - File click to open in VS Code
 * - Accessibility features
 */
describe('d3-org-profile-file-charts (GITX-208)', () => {
  describe('getTeamColorPalette', () => {
    it('should return exactly 12 colors', () => {
      const palette = getTeamColorPalette();
      expect(palette).toHaveLength(12);
    });

    it('should return valid hex color codes', () => {
      const palette = getTeamColorPalette();
      const hexRegex = /^#[0-9A-Fa-f]{6}$/;
      palette.forEach((color) => {
        expect(color).toMatch(hexRegex);
      });
    });

    it('should include the expected Okabe-Ito base colors', () => {
      const palette = getTeamColorPalette();
      // Check first few Okabe-Ito colors
      expect(palette[0]).toBe('#E69F00'); // Orange
      expect(palette[1]).toBe('#56B4E9'); // Sky Blue
      expect(palette[2]).toBe('#009E73'); // Bluish Green
      expect(palette[4]).toBe('#0072B2'); // Blue
    });

    it('should include extended colors for slots 8-11', () => {
      const palette = getTeamColorPalette();
      expect(palette[8]).toBe('#8B4513'); // Saddle Brown
      expect(palette[9]).toBe('#6A5ACD'); // Slate Blue
      expect(palette[10]).toBe('#FF6347'); // Tomato
      expect(palette[11]).toBe('#20B2AA'); // Light Sea Green
    });
  });

  describe('generateOrgProfileFileChartsScript', () => {
    const script = generateOrgProfileFileChartsScript();

    describe('Color palette in generated script', () => {
      it('should include all 12 Okabe-Ito colors', () => {
        expect(script).toContain('#E69F00'); // Orange
        expect(script).toContain('#56B4E9'); // Sky Blue
        expect(script).toContain('#009E73'); // Bluish Green
        expect(script).toContain('#F0E442'); // Yellow
        expect(script).toContain('#0072B2'); // Blue
        expect(script).toContain('#D55E00'); // Vermilion
        expect(script).toContain('#CC79A7'); // Reddish Purple
        expect(script).toContain('#999999'); // Gray
        expect(script).toContain('#8B4513'); // Saddle Brown
        expect(script).toContain('#6A5ACD'); // Slate Blue
        expect(script).toContain('#FF6347'); // Tomato
        expect(script).toContain('#20B2AA'); // Light Sea Green
      });

      it('should define OTHER_TEAMS_COLOR for overflow teams', () => {
        expect(script).toContain("var OTHER_TEAMS_COLOR = '#666666'");
      });

      it('should define MAX_TEAMS_DISPLAYED as 10', () => {
        expect(script).toContain('var MAX_TEAMS_DISPLAYED = 10');
      });
    });

    describe('Team limit and "Other Teams" grouping', () => {
      it('should slice teams to MAX_TEAMS_DISPLAYED', () => {
        expect(script).toContain('allTeams.slice(0, MAX_TEAMS_DISPLAYED)');
      });

      it('should push "Other Teams" when there are overflow teams', () => {
        expect(script).toContain("displayTeams.push('Other Teams')");
      });

      it('should check for hasOtherTeams condition', () => {
        expect(script).toContain('var hasOtherTeams = otherTeams.length > 0');
      });
    });

    describe('High-contrast mode support', () => {
      it('should check for high contrast mode via body class', () => {
        expect(script).toContain("document.body.classList.contains('vscode-high-contrast')");
      });

      it('should define pattern IDs for high contrast mode', () => {
        expect(script).toContain('pattern-stripe');
        expect(script).toContain('pattern-dot');
        expect(script).toContain('pattern-diagonal');
        expect(script).toContain('pattern-cross');
      });

      it('should create SVG pattern definitions', () => {
        expect(script).toContain('createHighContrastPatterns');
        expect(script).toContain("defs.append('pattern')");
      });

      it('should use 2px stroke width in high contrast mode', () => {
        expect(script).toContain('isHighContrastMode() ? 2 : 1');
      });
    });

    describe('Interactive legend functionality', () => {
      it('should track hidden teams with Set for complex files', () => {
        expect(script).toContain('var complexFilesHiddenTeams = new Set()');
      });

      it('should track hidden teams with Set for frequent files', () => {
        expect(script).toContain('var frequentFilesHiddenTeams = new Set()');
      });

      it('should toggle team visibility on click', () => {
        expect(script).toContain('complexFilesHiddenTeams.delete(team)');
        expect(script).toContain('complexFilesHiddenTeams.add(team)');
      });

      it('should re-render chart after legend toggle', () => {
        expect(script).toContain('renderOrgComplexFilesChart(cachedOrgComplexFilesData)');
        expect(script).toContain('renderOrgFrequentFilesChart(cachedOrgFrequentFilesData)');
      });

      it('should support keyboard toggle with Enter and Space', () => {
        expect(script).toContain("event.key === 'Enter'");
        expect(script).toContain("event.key === ' '");
      });

      it('should set aria-checked attribute for legend items', () => {
        expect(script).toContain("attr('aria-checked', !isHidden)");
      });
    });

    describe('Complex files chart rendering', () => {
      it('should define renderOrgComplexFilesChart function', () => {
        expect(script).toContain('function renderOrgComplexFilesChart(data)');
      });

      it('should hide skeleton on render', () => {
        expect(script).toContain("hideSkeleton('orgComplexFilesSkeleton')");
      });

      it('should cache data for re-render on legend toggle', () => {
        expect(script).toContain('cachedOrgComplexFilesData = data');
      });

      it('should show empty state when no data', () => {
        expect(script).toContain("emptyMsg.classList.remove('hidden')");
      });

      it('should create SVG with role="img" for accessibility', () => {
        expect(script).toContain("attr('role', 'img')");
      });

      it('should sort files by complexity descending', () => {
        expect(script).toContain('return b.complexity - a.complexity');
      });
    });

    describe('Frequent files chart rendering', () => {
      it('should define renderOrgFrequentFilesChart function', () => {
        expect(script).toContain('function renderOrgFrequentFilesChart(data)');
      });

      it('should hide skeleton on render', () => {
        expect(script).toContain("hideSkeleton('orgFrequentFilesSkeleton')");
      });

      it('should cache data for re-render', () => {
        expect(script).toContain('cachedOrgFrequentFilesData = data');
      });

      it('should sort files by total churn descending', () => {
        expect(script).toContain('return b.totalChurn - a.totalChurn');
      });

      it('should display "Lines Changed (Churn)" as x-axis label', () => {
        expect(script).toContain('Lines Changed (Churn)');
      });
    });

    describe('Tooltip functionality', () => {
      it('should define showOrgFileTooltip function', () => {
        expect(script).toContain('function showOrgFileTooltip(event, html)');
      });

      it('should define moveOrgFileTooltip function', () => {
        expect(script).toContain('function moveOrgFileTooltip(event)');
      });

      it('should define hideOrgFileTooltip function', () => {
        expect(script).toContain('function hideOrgFileTooltip()');
      });

      it('should use orgFileTooltip element', () => {
        expect(script).toContain("document.getElementById('orgFileTooltip')");
      });

      it('should show team name, file path, contribution value, and percentage', () => {
        // Complex files tooltip
        expect(script).toContain("'<strong>' + escapeHtml(teamName) + '</strong><br>'");
        expect(script).toContain("'LOC: ' + formatOrgLocValue(loc) + ' (' + pct + '%)<br>'");
        expect(script).toContain("'<small>Complexity: '");
      });

      it('should handle viewport boundary detection', () => {
        expect(script).toContain('viewportWidth - 20');
        expect(script).toContain('viewportHeight - 20');
      });
    });

    describe('File click to open in VS Code', () => {
      it('should post openFile message on click', () => {
        expect(script).toContain("vscode.postMessage({");
        expect(script).toContain("type: 'openFile'");
        expect(script).toContain('filePath: d.data.filename');
      });

      it('should handle keyboard activation', () => {
        expect(script).toContain(".on('keydown'");
        expect(script).toContain("event.preventDefault()");
      });

      it('should hint about click-to-open in tooltip', () => {
        expect(script).toContain('Click to open file');
      });
    });

    describe('Accessibility features', () => {
      it('should set role="button" on bar segments', () => {
        expect(script).toContain(".attr('role', 'button')");
      });

      it('should set tabindex for keyboard navigation', () => {
        expect(script).toContain(".attr('tabindex', '0')");
      });

      it('should provide aria-label with context', () => {
        expect(script).toContain(".attr('aria-label'");
      });

      it('should escape HTML in aria-label and tooltip', () => {
        expect(script).toContain('escapeHtml(teamName)');
        expect(script).toContain('escapeHtml(truncateOrgFilePath');
      });

      it('should set aria-hidden on tooltip', () => {
        expect(script).toContain("setAttribute('aria-hidden', 'false')");
        expect(script).toContain("setAttribute('aria-hidden', 'true')");
      });
    });

    describe('Path truncation and formatting', () => {
      it('should define truncateOrgFilePath function', () => {
        expect(script).toContain('function truncateOrgFilePath(path, maxLen)');
      });

      it('should add ellipsis prefix for long paths', () => {
        expect(script).toContain("return '...' + path.slice(-(maxLen - 3))");
      });

      it('should define formatOrgLocValue for large numbers', () => {
        expect(script).toContain('function formatOrgLocValue(val)');
        expect(script).toContain("+ 'M'");
        expect(script).toContain("+ 'k'");
      });
    });

    describe('Chart layout', () => {
      it('should use horizontal stacked bars', () => {
        expect(script).toContain("attr('y', function(d) { return y(d.data.filename); })");
        expect(script).toContain("attr('x', function(d) { return x(d[0]); })");
      });

      it('should define bar height', () => {
        expect(script).toContain('var barHeight = 22');
      });

      it('should define max label length', () => {
        expect(script).toContain('var maxLabelLen = 35');
      });

      it('should add grid lines', () => {
        expect(script).toContain(".attr('class', 'grid')");
        expect(script).toContain("stroke-dasharray', '2,2'");
      });

      it('should position legend on right side', () => {
        expect(script).toContain('var legendX = margin.left + width + 10');
      });
    });

    describe('GITX-208 ticket reference', () => {
      it('should reference GITX-208 in comments', () => {
        expect(script).toContain('GITX-208');
      });
    });
  });
});
