import { describe, it, expect } from 'vitest';
import { generateVelocityChartScript } from '../../views/webview/d3-chart-scripts.js';

/**
 * Unit tests for the LOC per Week velocity chart in d3-chart-scripts.ts (GITX-177).
 * Tests the zero-value filtering and multi-row legend features.
 *
 * Test coverage includes:
 * - Zero-value handling (null conversion for line gaps)
 * - Data point filtering (only non-zero values get markers)
 * - Multi-row legend with dynamic wrapping
 * - SVG height adjustment for legend rows
 */
describe('d3-chart-scripts generateVelocityChartScript (GITX-177)', () => {
  describe('Zero-value handling', () => {
    it('should convert zero values to null for line gaps', () => {
      const script = generateVelocityChartScript();
      // Check for the transformation logic that creates null for zeros
      // Pattern: value > 0 ? value : null
      expect(script).toContain('value > 0 ? value : null');
    });

    it('should use D3 line.defined() to filter null values', () => {
      const script = generateVelocityChartScript();
      // The .defined() method tells D3 to create gaps in the line
      expect(script).toContain('.defined(function(d) { return d.value !== null; })');
    });

    it('should filter data points to only render non-null values', () => {
      const script = generateVelocityChartScript();
      // Only non-null values get circle markers
      expect(script).toContain('.filter(function(d) { return d.value !== null; })');
    });

    it('should extract locCount and convert to null if zero', () => {
      const script = generateVelocityChartScript();
      // First extract the value, then convert
      expect(script).toContain('var value = pt ? pt.locCount : 0;');
      expect(script).toContain('return { date: date, value: value > 0 ? value : null };');
    });

    it('should reference GITX-177 in comments for zero-value filtering', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('GITX-177');
      expect(script).toContain('null values create gaps');
    });
  });

  describe('Data point rendering', () => {
    it('should only render data points for non-null values', () => {
      const script = generateVelocityChartScript();
      // The forEach should be preceded by a filter for non-null values
      expect(script).toContain("lineData.filter(function(d) { return d.value !== null; }).forEach(function(d)");
    });

    it('should render circles with 3px radius for data points', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain(".attr('r', 3)");
    });

    it('should add click handlers for drill-down functionality', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('requestLocDrillDown');
    });

    it('should add keyboard accessibility with tabindex and role', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain("attr('tabindex', '0')");
      expect(script).toContain("attr('role', 'button')");
    });
  });

  describe('Multi-row legend', () => {
    it('should calculate legendItemsPerRow based on chart width', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('var legendItemsPerRow = Math.max(1, Math.floor(width / legendItemWidth))');
    });

    it('should calculate number of legend rows', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('var legendRows = Math.ceil(repos.length / legendItemsPerRow)');
    });

    it('should define legend item dimensions', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('var legendItemWidth = 120');
      expect(script).toContain('var legendItemHeight = 16');
    });

    it('should position legend items using row and column calculation', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('var row = Math.floor(i / legendItemsPerRow)');
      expect(script).toContain('var col = i % legendItemsPerRow');
    });

    it('should translate legend items to correct position', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain("'translate(' + (col * legendItemWidth) + ',' + (row * legendItemHeight) + ')'");
    });

    it('should adjust SVG height for multi-row legend', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('var totalLegendHeight = legendRows * legendItemHeight');
      expect(script).toContain('var requiredHeight = legendStartY + totalLegendHeight + 10');
      expect(script).toContain("svg.attr('height', requiredHeight)");
    });

    it('should only increase SVG height when needed', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('if (requiredHeight > height + margin.top + margin.bottom)');
    });

    it('should reference GITX-177 in legend comments', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('GITX-177: Multi-row legend with dynamic wrapping');
    });
  });

  describe('Legend item rendering', () => {
    it('should render color box with 10x10px dimensions', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain(".attr('width', 10)");
      expect(script).toContain(".attr('height', 10)");
    });

    it('should position legend text 14px from color box', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain(".attr('x', 14)");
    });

    it('should use 10px font size for legend text', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain(".attr('font-size', '10px')");
    });

    it('should iterate over all repositories for legend', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('repos.forEach(function(repo, i)');
    });
  });

  describe('Line chart behavior preserved', () => {
    it('should use d3.line() for line generation', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('var line = d3.line()');
    });

    it('should set stroke width to 2px for lines', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain(".attr('stroke-width', 2)");
    });

    it('should use color scale for repository colors', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('.attr(\'stroke\', color(repo))');
    });

    it('should render path for each repository', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain("g.append('path').datum(lineData)");
    });
  });

  describe('Tooltip functionality preserved', () => {
    it('should show tooltip on mouseover', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain(".on('mouseover'");
      expect(script).toContain('showTooltip');
    });

    it('should update tooltip position on mousemove', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain(".on('mousemove', moveTooltip)");
    });

    it('should hide tooltip on mouseout', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain(".on('mouseout', hideTooltip)");
    });

    it('should format LOC values in tooltip', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('formatLocTooltip(d.value)');
    });
  });

  describe('Accessibility', () => {
    it('should add aria-label with repository, date, and value', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain("attr('aria-label'");
      expect(script).toContain('escapeHtml(repo)');
      expect(script).toContain('escapeHtml(d.date)');
    });

    it('should escape HTML in tooltip content', () => {
      const script = generateVelocityChartScript();
      // Tooltip should use escapeHtml for repo and date
      expect(script).toContain("escapeHtml(repo) + ' on ' + escapeHtml(d.date)");
    });

    it('should support keyboard navigation with keydown handler', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain(".on('keydown'");
      expect(script).toContain("event.key === 'Enter'");
      expect(script).toContain("event.key === ' '");
    });
  });
});
