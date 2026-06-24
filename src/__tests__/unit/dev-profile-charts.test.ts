import { describe, it, expect } from 'vitest';
import { generateLocWeekChartScript } from '../../views/webview/dev-profile-charts.js';

/**
 * Unit tests for dev-profile-charts.ts (GITX-174, GITX-176).
 * Tests the LOC per Week chart transformation from bar to line chart.
 *
 * Test coverage includes:
 * - Zero-value handling (null conversion for line gaps)
 * - Empty state when all values are zero
 * - Multi-repository line rendering
 * - Legend positioning and wrapping
 * - Data point filtering (only non-zero values get markers)
 * - Custom tooltip functionality (GITX-176)
 */
describe('dev-profile-charts (GITX-174, GITX-176)', () => {
  describe('generateLocWeekChartScript', () => {
    it('should return a non-empty script string', () => {
      const script = generateLocWeekChartScript();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should define renderLocWeekChart function', () => {
      const script = generateLocWeekChartScript();
      expect(script).toContain('function renderLocWeekChart(data)');
    });

    // ====================================================================
    // Zero-value handling (GITX-174)
    // ====================================================================
    describe('Zero-value handling', () => {
      it('should convert zero values to null for line gaps', () => {
        const script = generateLocWeekChartScript();
        // Check for the transformation logic that creates null for zeros
        expect(script).toContain('linesAdded > 0 ? linesAdded : null');
      });

      it('should use D3 line.defined() to filter null values', () => {
        const script = generateLocWeekChartScript();
        // The .defined() method tells D3 to create gaps in the line
        expect(script).toContain('.defined(function(d) { return d.value !== null; })');
      });

      it('should check for all-zero state and show empty message', () => {
        const script = generateLocWeekChartScript();
        // Empty state check
        expect(script).toContain('var hasNonZero = data.some(function(d) { return d.linesAdded > 0; });');
        expect(script).toContain('if (!hasNonZero)');
      });

      it('should hide chart and show empty state when all zeros', () => {
        const script = generateLocWeekChartScript();
        // Should hide chart container
        expect(script).toContain("getElementById('locWeekChart').classList.add('hidden')");
        // Should show empty state
        expect(script).toContain("getElementById('locWeekEmpty').classList.remove('hidden')");
      });

      it('should filter data points to only render non-null values', () => {
        const script = generateLocWeekChartScript();
        // Only non-null values get circle markers
        expect(script).toContain('.filter(function(d) { return d.value !== null; })');
      });
    });

    // ====================================================================
    // Line chart rendering (GITX-174)
    // ====================================================================
    describe('Line chart rendering', () => {
      it('should use curveMonotoneX for smooth lines', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('.curve(d3.curveMonotoneX)');
      });

      it('should render separate line per repository', () => {
        const script = generateLocWeekChartScript();
        // Each repo gets its own line path
        expect(script).toContain('repoData.forEach(function(rd)');
        expect(script).toContain("svg.append('path')");
      });

      it('should set stroke width to 2px for lines', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("attr('stroke-width', 2)");
      });

      it('should use d3.schemeCategory10 for repository colors', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('d3.scaleOrdinal(d3.schemeCategory10)');
      });

      it('should add 4px radius data points at non-zero values', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("attr('r', 4)");
      });

      it('should position data points at center of band', () => {
        const script = generateLocWeekChartScript();
        // Line should be centered on band (not at edge)
        expect(script).toContain('x(d.week) + x.bandwidth() / 2');
      });
    });

    // ====================================================================
    // Legend rendering (GITX-174)
    // ====================================================================
    describe('Legend rendering', () => {
      it('should position legend to the right of chart', () => {
        const script = generateLocWeekChartScript();
        // Legend should be offset to the right
        expect(script).toContain("'translate(' + (width + 10) + ',0)'");
      });

      it('should allocate right margin space for legend', () => {
        const script = generateLocWeekChartScript();
        // 120px right margin for legend
        expect(script).toContain('right: 120');
      });

      it('should stack legend items vertically with 20px spacing', () => {
        const script = generateLocWeekChartScript();
        // Each legend item offset by 20px
        expect(script).toContain('(i * 20)');
      });

      it('should render legend item per repository', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('repos.forEach(function(repo, i)');
      });

      it('should use 12x12px color boxes in legend', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("attr('width', 12)");
        expect(script).toContain("attr('height', 12)");
      });

      it('should truncate long repository names in legend', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('truncatePath(repo, 15)');
      });
    });

    // ====================================================================
    // Accessibility (GITX-174, GITX-176)
    // ====================================================================
    describe('Accessibility', () => {
      it('should add ARIA labels to data points', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("attr('aria-label'");
        expect(script).toContain('lines for week');
      });

      it('should make data points keyboard accessible', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("attr('tabindex', 0)");
      });

      it('should use role="img" for data points', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("attr('role', 'img')");
      });

      // GITX-176: Keyboard accessibility for tooltips
      it('should show tooltip on keyboard focus', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain(".on('focus'");
        expect(script).toContain('showLocTooltip');
      });

      it('should hide tooltip on keyboard blur', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain(".on('blur'");
        expect(script).toContain('hideLocTooltip');
      });
    });

    // ====================================================================
    // Custom Tooltip (GITX-176)
    // ====================================================================
    describe('Custom Tooltip (GITX-176)', () => {
      it('should define tooltip helper functions', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('function showLocTooltip');
        expect(script).toContain('function moveLocTooltip');
        expect(script).toContain('function hideLocTooltip');
      });

      it('should format week date as human-readable', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('function formatWeekDate');
        expect(script).toContain("'Week of '");
      });

      it('should truncate long repository names', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('function truncateRepoName');
        expect(script).toContain('maxLen');
      });

      it('should use locTooltip element for custom tooltip', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("getElementById('locTooltip')");
      });

      it('should add mouseenter event handler', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain(".on('mouseenter'");
      });

      it('should add mousemove event handler', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain(".on('mousemove'");
      });

      it('should add mouseleave event handler', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain(".on('mouseleave'");
      });

      it('should implement viewport boundary detection', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('Viewport boundary detection');
        expect(script).toContain('viewportWidth');
        expect(script).toContain('viewportHeight');
      });

      it('should toggle visible class for tooltip', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("classList.add('visible')");
        expect(script).toContain("classList.remove('visible')");
      });

      it('should set aria-hidden attribute for accessibility', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("setAttribute('aria-hidden', 'false')");
        expect(script).toContain("setAttribute('aria-hidden', 'true')");
      });

      it('should display repository name in tooltip', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("class=\"tt-repo\"");
      });

      it('should display week date in tooltip', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("class=\"tt-week\"");
      });

      it('should display lines added value in tooltip', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("class=\"tt-value\"");
        expect(script).toContain('Lines Added:');
      });

      it('should escape HTML in repository names for XSS prevention', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('escapeHtml(repoName)');
      });

      it('should use formatNumber for thousands separators', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('formatNumber(value)');
      });

      it('should create synthetic event for keyboard focus tooltip positioning', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('syntheticEvent');
        expect(script).toContain('getBoundingClientRect');
      });
    });

    // ====================================================================
    // Data structure validation
    // ====================================================================
    describe('Data structure', () => {
      it('should build line data with week and value properties', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('week: week');
        expect(script).toContain('value: linesAdded');
      });

      it('should extract unique weeks and sort them', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('Array.from(new Set(data.map(function(d) { return d.weekStart; }))).sort()');
      });

      it('should extract unique repositories', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('Array.from(new Set(data.map(function(d) { return d.repository; })))');
      });

      it('should map weeks to values per repository', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('weeks.map(function(week)');
        expect(script).toContain('data.find(function(d) { return d.weekStart === week && d.repository === repo; })');
      });
    });

    // ====================================================================
    // Chart dimensions and axes
    // ====================================================================
    describe('Chart dimensions and axes', () => {
      it('should use 300px total height', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('var height = 300 - margin.top - margin.bottom');
      });

      it('should use scaleBand for X axis', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('d3.scaleBand()');
      });

      it('should use scaleLinear for Y axis', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('d3.scaleLinear()');
      });

      it('should format X axis ticks as MM-DD', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('formatXAxisDate(d)'); // Skip YYYY- prefix
      });

      it('should rotate X axis labels 45 degrees', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("attr('transform', 'rotate(-45)')");
      });

      it('should add Y axis label "Lines Added"', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain("text('Lines Added')");
      });
    });

    // ====================================================================
    // Comment documentation
    // ====================================================================
    describe('Comment documentation', () => {
      it('should reference GITX-174 in comments', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('GITX-174');
      });

      it('should reference GITX-176 in comments', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('GITX-176');
      });

      it('should document zero-value filtering', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('null for zero values to create gaps');
      });

      it('should document line generator usage', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('Line generator with .defined() for zero-value filtering');
      });

      it('should document tooltip functionality', () => {
        const script = generateLocWeekChartScript();
        expect(script).toContain('Custom tooltip with mouse and keyboard event handlers');
      });
    });
  });
});
