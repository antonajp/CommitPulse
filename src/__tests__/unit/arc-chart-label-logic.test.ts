import { describe, it, expect, beforeAll } from 'vitest';
import { generateArcChartScript } from '../../views/webview/d3-chart-scripts.js';

/**
 * Unit tests for arc chart percentage label logic (GITX-148).
 * Tests the helper functions embedded in generateArcChartScript():
 * - getContrastColor(): Calculates text color based on background luminance
 * - getLabelPlacement(): Determines label visibility and placement by percentage
 * - formatPercentageLabel(): Formats percentage as integer with % suffix
 */
describe('Arc Chart Percentage Labels (GITX-148)', () => {
  /**
   * Helper to evaluate JavaScript code in a simple sandbox.
   * Extracts the function definition from generated script and executes it.
   */
  function evalFunction(fnName: string, script: string): (...args: unknown[]) => unknown {
    // Extract function definition from script
    const fnMatch = script.match(new RegExp(`function ${fnName}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\s*\\}`));
    if (!fnMatch) {
      throw new Error(`Function ${fnName} not found in script`);
    }
    // Create and return the function
    return new Function(`return ${fnMatch[0]}`)() as (...args: unknown[]) => unknown;
  }

  describe('generateArcChartScript', () => {
    it('should include getContrastColor function', () => {
      const script = generateArcChartScript();
      expect(script).toContain('function getContrastColor(hexColor)');
    });

    it('should include getLabelPlacement function', () => {
      const script = generateArcChartScript();
      expect(script).toContain('function getLabelPlacement(percentage)');
    });

    it('should include formatPercentageLabel function', () => {
      const script = generateArcChartScript();
      expect(script).toContain('function formatPercentageLabel(percentage)');
    });

    it('should include arc-label CSS classes', () => {
      const script = generateArcChartScript();
      // Classes are used in D3.js attr() calls
      expect(script).toContain('arc-label');
      expect(script).toContain('arc-label-inner');
      expect(script).toContain('arc-label-outer');
      expect(script).toContain('arc-label-line');
    });

    it('should include aria-hidden attribute for accessibility', () => {
      const script = generateArcChartScript();
      expect(script).toContain("attr('aria-hidden', 'true')");
    });

    it('should include pointer-events:none for non-interference with hover', () => {
      const script = generateArcChartScript();
      expect(script).toContain("attr('pointer-events', 'none')");
    });
  });

  describe('getContrastColor', () => {
    let getContrastColor: (hexColor: string) => string;

    beforeAll(() => {
      const script = generateArcChartScript();
      getContrastColor = evalFunction('getContrastColor', script) as (hexColor: string) => string;
    });

    it('should return white for dark colors', () => {
      // Dark colors should use white text
      expect(getContrastColor('#000000')).toBe('#ffffff');
      expect(getContrastColor('#1e1e1e')).toBe('#ffffff');
      expect(getContrastColor('#166a8f')).toBe('#ffffff'); // Dark teal from CHART_COLORS
    });

    it('should return black for light colors', () => {
      // Light colors should use black text
      expect(getContrastColor('#ffffff')).toBe('#000000');
      expect(getContrastColor('#ffe119')).toBe('#000000'); // Yellow from CHART_COLORS
      expect(getContrastColor('#acc236')).toBe('#000000'); // Lime green from CHART_COLORS
    });

    it('should return white for medium-bright colors that need contrast', () => {
      // These colors from CHART_COLORS are darker/cooler
      expect(getContrastColor('#4dc9f6')).toBe('#000000'); // Cyan - actually light
      expect(getContrastColor('#537bc4')).toBe('#ffffff'); // Blue - darker
    });

    it('should handle invalid input gracefully', () => {
      expect(getContrastColor('')).toBe('#ffffff');
      expect(getContrastColor('#abc')).toBe('#ffffff'); // Too short
    });
  });

  describe('getLabelPlacement', () => {
    let getLabelPlacement: (percentage: number) => string;

    beforeAll(() => {
      const script = generateArcChartScript();
      getLabelPlacement = evalFunction('getLabelPlacement', script) as (percentage: number) => string;
    });

    it('should return "inner" for segments >= 15%', () => {
      expect(getLabelPlacement(15)).toBe('inner');
      expect(getLabelPlacement(50)).toBe('inner');
      expect(getLabelPlacement(100)).toBe('inner');
    });

    it('should return "outer" for segments 5-14%', () => {
      expect(getLabelPlacement(5)).toBe('outer');
      expect(getLabelPlacement(10)).toBe('outer');
      expect(getLabelPlacement(14)).toBe('outer');
      expect(getLabelPlacement(14.9)).toBe('outer');
    });

    it('should return "none" for segments < 5%', () => {
      expect(getLabelPlacement(0)).toBe('none');
      expect(getLabelPlacement(1)).toBe('none');
      expect(getLabelPlacement(4)).toBe('none');
      expect(getLabelPlacement(4.9)).toBe('none');
    });
  });

  describe('formatPercentageLabel', () => {
    let formatPercentageLabel: (percentage: number) => string;

    beforeAll(() => {
      const script = generateArcChartScript();
      formatPercentageLabel = evalFunction('formatPercentageLabel', script) as (percentage: number) => string;
    });

    it('should format integer percentages correctly', () => {
      expect(formatPercentageLabel(50)).toBe('50%');
      expect(formatPercentageLabel(100)).toBe('100%');
      expect(formatPercentageLabel(0)).toBe('0%');
    });

    it('should round decimal percentages to integers', () => {
      expect(formatPercentageLabel(42.3)).toBe('42%');
      expect(formatPercentageLabel(42.7)).toBe('43%');
      expect(formatPercentageLabel(33.33)).toBe('33%');
    });

    it('should handle edge cases for rounding', () => {
      expect(formatPercentageLabel(0.4)).toBe('0%');
      expect(formatPercentageLabel(0.5)).toBe('1%');
      expect(formatPercentageLabel(99.5)).toBe('100%');
    });
  });

  describe('Label Visibility Edge Cases', () => {
    it('should include threshold constants in script', () => {
      const script = generateArcChartScript();
      // 15% threshold for inner labels
      expect(script).toContain('percentage >= 15');
      // 5% threshold for outer labels
      expect(script).toContain('percentage >= 5');
    });

    describe('TC-001: Visibility Threshold - Labels Appear for Dominant Segments', () => {
      /**
       * Test data:
       * - TypeScript: 50% -> should show inner label
       * - JavaScript: 30% -> should show inner label
       * - Python: 10% -> should show outer label
       * - SQL: 8% -> should show outer label
       * - Shell: 2% -> should NOT show label
       */
      let getLabelPlacement: (percentage: number) => string;

      beforeAll(() => {
        const script = generateArcChartScript();
        getLabelPlacement = evalFunction('getLabelPlacement', script) as (percentage: number) => string;
      });

      it('should show inner label for TypeScript (50%)', () => {
        expect(getLabelPlacement(50)).toBe('inner');
      });

      it('should show inner label for JavaScript (30%)', () => {
        expect(getLabelPlacement(30)).toBe('inner');
      });

      it('should show outer label for Python (10%)', () => {
        expect(getLabelPlacement(10)).toBe('outer');
      });

      it('should show outer label for SQL (8%)', () => {
        expect(getLabelPlacement(8)).toBe('outer');
      });

      it('should NOT show label for Shell (2%)', () => {
        expect(getLabelPlacement(2)).toBe('none');
      });
    });

    describe('TC-002: Correct Percentage Calculation', () => {
      let formatPercentageLabel: (percentage: number) => string;

      beforeAll(() => {
        const script = generateArcChartScript();
        formatPercentageLabel = evalFunction('formatPercentageLabel', script) as (percentage: number) => string;
      });

      it('should display correct percentages for equal-ish distribution', () => {
        // 33/100 = 33%, 33/100 = 33%, 34/100 = 34%
        expect(formatPercentageLabel(33)).toBe('33%');
        expect(formatPercentageLabel(33)).toBe('33%');
        expect(formatPercentageLabel(34)).toBe('34%');
      });

      it('should handle floating point precision', () => {
        // 333/1000 = 33.3%
        expect(formatPercentageLabel(33.3)).toBe('33%');
        // 334/1000 = 33.4%
        expect(formatPercentageLabel(33.4)).toBe('33%');
      });
    });

    describe('EC-001: Zero Percentage Segments', () => {
      let getLabelPlacement: (percentage: number) => string;

      beforeAll(() => {
        const script = generateArcChartScript();
        getLabelPlacement = evalFunction('getLabelPlacement', script) as (percentage: number) => string;
      });

      it('should return "none" for 0%', () => {
        expect(getLabelPlacement(0)).toBe('none');
      });
    });

    describe('EC-002: Single Segment (100%)', () => {
      let getLabelPlacement: (percentage: number) => string;
      let formatPercentageLabel: (percentage: number) => string;

      beforeAll(() => {
        const script = generateArcChartScript();
        getLabelPlacement = evalFunction('getLabelPlacement', script) as (percentage: number) => string;
        formatPercentageLabel = evalFunction('formatPercentageLabel', script) as (percentage: number) => string;
      });

      it('should show inner label for 100%', () => {
        expect(getLabelPlacement(100)).toBe('inner');
      });

      it('should format 100% correctly', () => {
        expect(formatPercentageLabel(100)).toBe('100%');
      });
    });

    describe('EC-003: All Segments Below Threshold', () => {
      let getLabelPlacement: (percentage: number) => string;

      beforeAll(() => {
        const script = generateArcChartScript();
        getLabelPlacement = evalFunction('getLabelPlacement', script) as (percentage: number) => string;
      });

      it('should return "none" for all segments < 5%', () => {
        // 4/10, 3/10, 2/10, 1/10 = 40%, 30%, 20%, 10%
        // Wait, the test says all below 5%: 4%, 3%, 2%, 1%
        expect(getLabelPlacement(4)).toBe('none');
        expect(getLabelPlacement(3)).toBe('none');
        expect(getLabelPlacement(2)).toBe('none');
        expect(getLabelPlacement(1)).toBe('none');
      });
    });

    describe('EC-004: Equal Segments Near Threshold', () => {
      let getLabelPlacement: (percentage: number) => string;

      beforeAll(() => {
        const script = generateArcChartScript();
        getLabelPlacement = evalFunction('getLabelPlacement', script) as (percentage: number) => string;
      });

      it('should show outer label for segments exactly at 6%', () => {
        // 60/1000 = 6% (if there are ~16 equal segments)
        expect(getLabelPlacement(6)).toBe('outer');
        expect(getLabelPlacement(6.25)).toBe('outer');
      });
    });
  });

  describe('TC-008: Screen Reader Accessibility', () => {
    it('should include aria-hidden on percentage labels', () => {
      const script = generateArcChartScript();
      // Labels should be aria-hidden to avoid double-announcement
      expect(script).toContain("attr('aria-hidden', 'true')");
    });

    it('should preserve existing aria-label on arc paths', () => {
      const script = generateArcChartScript();
      // Existing aria-label with percentage should still be present
      expect(script).toContain("attr('aria-label'");
      // Tooltip shows pct + '%)'
      expect(script).toContain("pct + '%)'");
    });
  });
});
