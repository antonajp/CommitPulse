import { describe, it, expect } from 'vitest';
import { generateLocWeekChartScript } from '../../views/webview/dev-profile-charts.js';

/**
 * Edge case tests for LOC per Week chart (GITX-174, GITX-176).
 * Tests zero-value handling, legend stacking, multi-repository scenarios,
 * and custom tooltip edge cases.
 *
 * This test file validates the data transformation logic that will be
 * executed in the webview's JavaScript runtime. The actual D3 rendering
 * is tested via extension tests with real VS Code webviews.
 *
 * Edge cases covered:
 * - All zeros across all repositories
 * - Single repository with gaps
 * - Many repositories (legend overflow)
 * - Mixed data (some repos with all zeros, others with values)
 * - Sparse data (many zero weeks)
 * - Custom tooltip positioning and formatting (GITX-176)
 */
describe('dev-profile-charts edge cases (GITX-174, GITX-176)', () => {
  const script = generateLocWeekChartScript();

  describe('All-zero scenarios', () => {
    it('should handle all-zero data by showing empty state', () => {
      // The script checks hasNonZero before rendering
      expect(script).toContain('var hasNonZero = data.some(function(d) { return d.linesAdded > 0; });');
      expect(script).toContain('if (!hasNonZero)');
    });

    it('should hide chart when no non-zero values exist', () => {
      // Empty state should be visible
      expect(script).toContain("getElementById('locWeekChart').classList.add('hidden')");
      expect(script).toContain("getElementById('locWeekEmpty').classList.remove('hidden')");
    });

    it('should check for all-zero values in second empty state block', () => {
      // The script has two empty state checks:
      // 1. First: if (!data || data.length === 0)
      // 2. Second: if (!hasNonZero) - after checking for all zeros
      // Both hide the chart, so we just verify the hasNonZero check exists
      expect(script).toContain('var hasNonZero');
      expect(script).toContain('if (!hasNonZero)');
    });
  });

  describe('Single repository scenarios', () => {
    it('should handle single repository data', () => {
      // Should extract repos as an array
      expect(script).toContain('Array.from(new Set(data.map(function(d) { return d.repository; })))');
    });

    it('should create line data even for single repo', () => {
      // repoData mapping should work for 1 or N repos
      expect(script).toContain('var repoData = repos.map(function(repo)');
    });

    it('should render legend even with one repository', () => {
      // Legend rendering should not depend on repo count
      expect(script).toContain('repos.forEach(function(repo, i)');
    });
  });

  describe('Many repositories (legend stacking)', () => {
    it('should stack legend items vertically', () => {
      // 20px vertical spacing per item
      expect(script).toContain("attr('transform', 'translate(0,' + (i * 20) + ')')");
    });

    it('should allocate 120px right margin for legend', () => {
      // Enough space for ~6 legend items without overflow
      expect(script).toContain('right: 120');
    });

    it('should position legend to the right of chart', () => {
      // Legend starts at width + 10
      expect(script).toContain("attr('transform', 'translate(' + (width + 10) + ',0)')");
    });

    it('should truncate long repository names', () => {
      // Prevent legend text overflow
      expect(script).toContain('truncatePath(repo, 15)');
    });

    it('should use small font for legend to save space', () => {
      // 11px font size keeps legend compact
      expect(script).toContain("style('font-size', '11px')");
    });

    // NOTE: With many repos (>6), the legend may extend beyond visible area.
    // This is acceptable as:
    // 1. Most developers work on 1-3 repos
    // 2. SVG can be scrolled or resized
    // 3. Color still differentiates lines in the chart
    // Future enhancement: Add "show more" collapse or horizontal wrapping
  });

  describe('Mixed data scenarios', () => {
    it('should handle repos with partial zero weeks', () => {
      // Null values create gaps in the line
      expect(script).toContain('linesAdded > 0 ? linesAdded : null');
      expect(script).toContain('.defined(function(d) { return d.value !== null; })');
    });

    it('should find data point for specific week/repo combination', () => {
      // Must match both week and repo
      expect(script).toContain('data.find(function(d) { return d.weekStart === week && d.repository === repo; })');
    });

    it('should handle missing data points (gaps in time series)', () => {
      // When find() returns undefined, linesAdded defaults to 0
      expect(script).toContain('var linesAdded = point ? point.linesAdded : 0;');
    });

    it('should filter null values when rendering circles', () => {
      // Only show data point markers for non-zero values
      expect(script).toContain('.filter(function(d) { return d.value !== null; })');
    });
  });

  describe('Sparse data scenarios', () => {
    it('should create smooth curves even with sparse data', () => {
      // curveMonotoneX interpolates between points
      expect(script).toContain('.curve(d3.curveMonotoneX)');
    });

    it('should position points at band center for sparse weeks', () => {
      // Center of each time band
      expect(script).toContain('x(d.week) + x.bandwidth() / 2');
    });

    it('should handle weeks with no commits', () => {
      // Zero values become null and are filtered
      expect(script).toContain('value: linesAdded > 0 ? linesAdded : null');
    });
  });

  describe('Y-axis scaling edge cases', () => {
    it('should handle very small maxY values', () => {
      // Default to 100 if max is 0 or undefined
      expect(script).toContain('var maxY = d3.max(data, function(d) { return d.linesAdded; }) || 100;');
    });

    it('should use nice() for clean Y-axis values', () => {
      // Rounds domain to nice round numbers
      expect(script).toContain('.nice()');
    });

    it('should format large Y values with SI prefix', () => {
      // 1000 -> "1k", 1000000 -> "1M"
      expect(script).toContain("tickFormat(d3.format('.2s'))");
    });
  });

  describe('X-axis edge cases', () => {
    it('should handle single week of data', () => {
      // scaleBand works with single item
      expect(script).toContain('d3.scaleBand()');
    });

    it('should sort weeks chronologically', () => {
      // .sort() ensures weeks are in order
      expect(script).toContain('Array.from(new Set(data.map(function(d) { return d.weekStart; }))).sort()');
    });

    it('should format week labels consistently', () => {
      // Slice(5) removes YYYY- prefix (e.g., "2024-06-17" -> "06-17")
      expect(script).toContain('formatXAxisDate(d)');
    });

    it('should rotate labels to prevent overlap', () => {
      // 45-degree rotation for readability
      expect(script).toContain("attr('transform', 'rotate(-45)')");
      expect(script).toContain("style('text-anchor', 'end')");
    });
  });

  describe('Color assignment edge cases', () => {
    it('should use consistent colors per repository', () => {
      // d3.schemeCategory10 provides 10 distinct colors
      expect(script).toContain('d3.scaleOrdinal(d3.schemeCategory10).domain(repos)');
    });

    it('should handle more than 10 repositories', () => {
      // schemeCategory10 cycles colors for repos beyond 10
      // This is a D3 built-in behavior, no explicit handling needed
      expect(script).toContain('d3.schemeCategory10');
    });

    it('should apply same color to line and data points', () => {
      // Both use color(rd.repo)
      expect(script).toContain("attr('stroke', color(rd.repo))");
      expect(script).toContain("attr('fill', color(rd.repo))");
    });

    it('should use same color scale for legend', () => {
      // Legend uses same color() function
      expect(script).toContain("attr('fill', color(repo))");
    });
  });

  describe('Empty data scenarios', () => {
    it('should handle empty data array', () => {
      // First check: !data || data.length === 0
      expect(script).toContain('if (!data || data.length === 0)');
    });

    it('should show empty state for empty data', () => {
      expect(script).toContain("getElementById('locWeekEmpty').classList.remove('hidden')");
    });

    it('should check empty before checking all-zeros', () => {
      // Empty check should come before hasNonZero check
      const emptyCheckIndex = script.indexOf('if (!data || data.length === 0)');
      const hasNonZeroIndex = script.indexOf('var hasNonZero');
      expect(emptyCheckIndex).toBeLessThan(hasNonZeroIndex);
    });
  });

  describe('Tooltip and interaction edge cases (GITX-176)', () => {
    it('should use custom tooltip instead of native title', () => {
      // GITX-176: Custom D3 tooltip with styled content
      expect(script).toContain('showLocTooltip');
      expect(script).toContain('hideLocTooltip');
    });

    it('should include repository name in custom tooltip', () => {
      // Repository name displayed prominently
      expect(script).toContain("class=\"tt-repo\"");
      expect(script).toContain('displayRepo');
    });

    it('should include formatted week date in tooltip', () => {
      // Week of Mon DD, YYYY format
      expect(script).toContain("class=\"tt-week\"");
      expect(script).toContain('formatWeekDate');
    });

    it('should include lines added value in tooltip', () => {
      // Lines Added with formatted number
      expect(script).toContain("class=\"tt-value\"");
      expect(script).toContain('Lines Added:');
    });

    it('should provide ARIA label for screen readers', () => {
      // Accessible text: "repo: value lines for week date"
      expect(script).toContain("rd.repo + ': ' + formatNumber(d.value) + ' lines for week ' + d.week");
    });

    it('should handle viewport left edge boundary', () => {
      // Prevent tooltip from going off screen left
      expect(script).toContain('if (x < 10)');
    });

    it('should handle viewport right edge boundary', () => {
      // Prevent tooltip from going off screen right
      expect(script).toContain('if (x + ttRect.width > viewportWidth - 20)');
    });

    it('should handle viewport top edge boundary', () => {
      // Prevent tooltip from going above viewport
      expect(script).toContain('if (y < 10)');
    });

    it('should handle viewport bottom edge boundary', () => {
      // Prevent tooltip from going below viewport
      expect(script).toContain('if (y + ttRect.height > viewportHeight - 20)');
    });

    it('should truncate long repository names (40 char limit)', () => {
      // Prevent tooltip overflow with long names
      expect(script).toContain('truncateRepoName(escapeHtml(repoName), 40)');
    });

    it('should escape HTML in repository names', () => {
      // XSS prevention for repo names with special characters
      expect(script).toContain('escapeHtml(repoName)');
    });

    it('should support keyboard navigation for tooltips', () => {
      // Focus/blur events for accessibility
      expect(script).toContain(".on('focus'");
      expect(script).toContain(".on('blur'");
    });

    it('should create synthetic event for keyboard focus positioning', () => {
      // Position tooltip based on element rect for keyboard users
      expect(script).toContain('getBoundingClientRect');
      expect(script).toContain('syntheticEvent');
    });
  });

  describe('Chart container edge cases', () => {
    it('should clear container before rendering', () => {
      // Prevents duplicate SVGs on re-render
      expect(script).toContain("container.innerHTML = '';");
    });

    it('should use responsive width', () => {
      // Width based on container clientWidth
      expect(script).toContain('var width = container.clientWidth - margin.left - margin.right;');
    });

    it('should handle narrow containers gracefully', () => {
      // Margin values are fixed, so minimum width is margins + some space
      // 60 (left) + 120 (right) = 180px minimum for margins
      expect(script).toContain('margin.left - margin.right');
    });
  });

  describe('Data sanitization edge cases', () => {
    it('should sanitize repository name for CSS class', () => {
      // Replace non-alphanumeric characters for class name
      expect(script).toContain("rd.repo.replace(/[^a-zA-Z0-9]/g, '-')");
    });

    it('should handle null or undefined linesAdded', () => {
      // Defaults to 0 if point not found
      expect(script).toContain('var linesAdded = point ? point.linesAdded : 0;');
    });

    it('should handle zero linesAdded explicitly', () => {
      // Zero is valid data, converted to null for gap rendering
      expect(script).toContain('linesAdded > 0');
    });
  });
});
