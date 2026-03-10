import { describe, it, expect } from 'vitest';
import {
  TEAM_MEMBER_COLORS,
  UNKNOWN_AUTHOR_COLOR,
  UNKNOWN_AUTHOR_NAME,
} from '../../../views/webview/d3-dev-pipeline-chart.js';
import type { DevPipelineWeeklyDataPoint } from '../../../services/dev-pipeline-data-types.js';

/**
 * Unit tests for Developer Pipeline chart data transformers (IQS-929).
 * Tests chart utility functions and data transformation logic for the
 * 4 separate metric charts with team filter.
 *
 * Test coverage includes:
 * - Developer color assignment using Okabe-Ito palette
 * - Color cycling for more than 8 developers
 * - Data grouping by week
 * - Scatter plot data transformation
 * - Comments ratio calculation
 * - Date range validation
 */
describe('DevPipelineSection - Chart Transformers', () => {
  // ==========================================================================
  // getDeveloperColor
  // ==========================================================================
  describe('getDeveloperColor', () => {
    /**
     * Simulates the getTeamMemberColor function from the chart script.
     * Assigns consistent colors to developers using Okabe-Ito palette.
     */
    function getDeveloperColor(author: string, authors: string[]): string {
      if (!author) return UNKNOWN_AUTHOR_COLOR;
      const index = authors.indexOf(author);
      if (index === -1) return UNKNOWN_AUTHOR_COLOR;
      return TEAM_MEMBER_COLORS[index % TEAM_MEMBER_COLORS.length];
    }

    it('should assign consistent colors to developers', () => {
      const authors = ['Alice', 'Bob', 'Charlie'];

      // Same author always gets same color
      expect(getDeveloperColor('Alice', authors)).toBe(TEAM_MEMBER_COLORS[0]);
      expect(getDeveloperColor('Alice', authors)).toBe(TEAM_MEMBER_COLORS[0]);
      expect(getDeveloperColor('Bob', authors)).toBe(TEAM_MEMBER_COLORS[1]);
      expect(getDeveloperColor('Charlie', authors)).toBe(TEAM_MEMBER_COLORS[2]);
    });

    it('should cycle colors when more than 8 developers', () => {
      const authors = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

      // First 8 get unique colors
      expect(getDeveloperColor('A', authors)).toBe(TEAM_MEMBER_COLORS[0]);
      expect(getDeveloperColor('H', authors)).toBe(TEAM_MEMBER_COLORS[7]);

      // 9th developer (I) gets 1st color again (0 % 8 = 0)
      expect(getDeveloperColor('I', authors)).toBe(TEAM_MEMBER_COLORS[0]);

      // 10th developer (J) gets 2nd color (1 % 8 = 1)
      expect(getDeveloperColor('J', authors)).toBe(TEAM_MEMBER_COLORS[1]);
    });

    it('should return unknown color for author not in list', () => {
      const authors = ['Alice', 'Bob'];

      expect(getDeveloperColor('Charlie', authors)).toBe(UNKNOWN_AUTHOR_COLOR);
      expect(getDeveloperColor('Unknown', authors)).toBe(UNKNOWN_AUTHOR_COLOR);
    });

    it('should return unknown color for empty author', () => {
      const authors = ['Alice', 'Bob'];

      expect(getDeveloperColor('', authors)).toBe(UNKNOWN_AUTHOR_COLOR);
    });

    it('should handle empty author list', () => {
      const authors: string[] = [];

      expect(getDeveloperColor('Alice', authors)).toBe(UNKNOWN_AUTHOR_COLOR);
    });

    it('should use all 8 Okabe-Ito colors', () => {
      const authors = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

      const colors = authors.map(author => getDeveloperColor(author, authors));

      // All colors should be unique
      expect(new Set(colors).size).toBe(8);

      // All colors should be from TEAM_MEMBER_COLORS
      colors.forEach(color => {
        expect(TEAM_MEMBER_COLORS).toContain(color);
      });
    });
  });

  // ==========================================================================
  // groupDataByWeek
  // ==========================================================================
  describe('groupDataByWeek', () => {
    /**
     * Groups weekly data points by week start date.
     */
    function groupDataByWeek(
      data: DevPipelineWeeklyDataPoint[]
    ): Record<string, DevPipelineWeeklyDataPoint[]> {
      const grouped: Record<string, DevPipelineWeeklyDataPoint[]> = {};

      data.forEach(point => {
        if (!grouped[point.weekStart]) {
          grouped[point.weekStart] = [];
        }
        grouped[point.weekStart]!.push(point);
      });

      return grouped;
    }

    it('should group data points by week start date', () => {
      const data: DevPipelineWeeklyDataPoint[] = [
        {
          weekStart: '2024-01-01',
          author: 'Alice',
          fullName: 'Alice Smith',
          team: 'Engineering',
          totalLocDelta: 100,
          totalComplexityDelta: 10,
          totalCommentsDelta: 20,
          totalTestsDelta: 30,
          totalCommentLines: 50,
          totalCodeLines: 400,
          commitCount: 5,
          commentsRatio: 12.5,
        },
        {
          weekStart: '2024-01-01',
          author: 'Bob',
          fullName: 'Bob Jones',
          team: 'Engineering',
          totalLocDelta: 50,
          totalComplexityDelta: 5,
          totalCommentsDelta: 10,
          totalTestsDelta: 15,
          totalCommentLines: 25,
          totalCodeLines: 200,
          commitCount: 3,
          commentsRatio: 12.5,
        },
        {
          weekStart: '2024-01-08',
          author: 'Alice',
          fullName: 'Alice Smith',
          team: 'Engineering',
          totalLocDelta: 75,
          totalComplexityDelta: 8,
          totalCommentsDelta: 15,
          totalTestsDelta: 20,
          totalCommentLines: 40,
          totalCodeLines: 300,
          commitCount: 4,
          commentsRatio: 13.33,
        },
      ];

      const grouped = groupDataByWeek(data);

      expect(grouped['2024-01-01']).toHaveLength(2);
      expect(grouped['2024-01-08']).toHaveLength(1);
      expect(grouped['2024-01-01']?.[0]?.author).toBe('Alice');
      expect(grouped['2024-01-01']?.[1]?.author).toBe('Bob');
      expect(grouped['2024-01-08']?.[0]?.author).toBe('Alice');
    });

    it('should handle empty data array', () => {
      const data: DevPipelineWeeklyDataPoint[] = [];
      const grouped = groupDataByWeek(data);

      expect(Object.keys(grouped)).toHaveLength(0);
    });

    it('should handle single data point', () => {
      const data: DevPipelineWeeklyDataPoint[] = [
        {
          weekStart: '2024-01-01',
          author: 'Alice',
          fullName: 'Alice Smith',
          team: 'Engineering',
          totalLocDelta: 100,
          totalComplexityDelta: 10,
          totalCommentsDelta: 20,
          totalTestsDelta: 30,
          totalCommentLines: 50,
          totalCodeLines: 400,
          commitCount: 5,
          commentsRatio: 12.5,
        },
      ];

      const grouped = groupDataByWeek(data);

      expect(Object.keys(grouped)).toHaveLength(1);
      expect(grouped['2024-01-01']).toHaveLength(1);
    });

    it('should maintain all fields in grouped data', () => {
      const data: DevPipelineWeeklyDataPoint[] = [
        {
          weekStart: '2024-01-01',
          author: 'Alice',
          fullName: 'Alice Smith',
          team: 'Engineering',
          totalLocDelta: 100,
          totalComplexityDelta: 10,
          totalCommentsDelta: 20,
          totalTestsDelta: 30,
          totalCommentLines: 50,
          totalCodeLines: 400,
          commitCount: 5,
          commentsRatio: 12.5,
        },
      ];

      const grouped = groupDataByWeek(data);
      const point = grouped['2024-01-01']?.[0];

      expect(point?.weekStart).toBe('2024-01-01');
      expect(point?.author).toBe('Alice');
      expect(point?.fullName).toBe('Alice Smith');
      expect(point?.team).toBe('Engineering');
      expect(point?.totalLocDelta).toBe(100);
      expect(point?.totalComplexityDelta).toBe(10);
      expect(point?.totalCommentsDelta).toBe(20);
      expect(point?.totalTestsDelta).toBe(30);
      expect(point?.totalCommentLines).toBe(50);
      expect(point?.totalCodeLines).toBe(400);
      expect(point?.commitCount).toBe(5);
      expect(point?.commentsRatio).toBe(12.5);
    });
  });

  // ==========================================================================
  // transformToScatterData
  // ==========================================================================
  describe('transformToScatterData', () => {
    interface ScatterPoint {
      x: Date;
      y: number;
      author: string;
    }

    /**
     * Transforms weekly data to scatter plot format.
     * Extracts a specific metric for the Y-axis.
     */
    function transformToScatterData(
      data: DevPipelineWeeklyDataPoint[],
      metric: keyof Pick<
        DevPipelineWeeklyDataPoint,
        'totalLocDelta' | 'totalComplexityDelta' | 'totalCommentsDelta' | 'totalTestsDelta' | 'commentsRatio'
      >
    ): ScatterPoint[] {
      return data.map(point => ({
        x: new Date(point.weekStart),
        y: point[metric] as number,
        author: point.author,
      }));
    }

    it('should transform weekly data to scatter plot format for LOC delta', () => {
      const data: DevPipelineWeeklyDataPoint[] = [
        {
          weekStart: '2024-01-01',
          author: 'Alice',
          fullName: 'Alice Smith',
          team: 'Engineering',
          totalLocDelta: 100,
          totalComplexityDelta: 10,
          totalCommentsDelta: 20,
          totalTestsDelta: 30,
          totalCommentLines: 50,
          totalCodeLines: 400,
          commitCount: 5,
          commentsRatio: 12.5,
        },
      ];

      const scatterData = transformToScatterData(data, 'totalLocDelta');

      expect(scatterData).toHaveLength(1);
      expect(scatterData[0]?.x).toEqual(new Date('2024-01-01'));
      expect(scatterData[0]?.y).toBe(100);
      expect(scatterData[0]?.author).toBe('Alice');
    });

    it('should transform weekly data to scatter plot format for complexity delta', () => {
      const data: DevPipelineWeeklyDataPoint[] = [
        {
          weekStart: '2024-01-01',
          author: 'Bob',
          fullName: 'Bob Jones',
          team: 'Engineering',
          totalLocDelta: 100,
          totalComplexityDelta: 25,
          totalCommentsDelta: 20,
          totalTestsDelta: 30,
          totalCommentLines: 50,
          totalCodeLines: 400,
          commitCount: 5,
          commentsRatio: 12.5,
        },
      ];

      const scatterData = transformToScatterData(data, 'totalComplexityDelta');

      expect(scatterData[0]?.y).toBe(25);
    });

    it('should transform weekly data to scatter plot format for comments delta', () => {
      const data: DevPipelineWeeklyDataPoint[] = [
        {
          weekStart: '2024-01-01',
          author: 'Charlie',
          fullName: 'Charlie Brown',
          team: 'Engineering',
          totalLocDelta: 100,
          totalComplexityDelta: 10,
          totalCommentsDelta: 40,
          totalTestsDelta: 30,
          totalCommentLines: 50,
          totalCodeLines: 400,
          commitCount: 5,
          commentsRatio: 12.5,
        },
      ];

      const scatterData = transformToScatterData(data, 'totalCommentsDelta');

      expect(scatterData[0]?.y).toBe(40);
    });

    it('should transform weekly data to scatter plot format for tests delta', () => {
      const data: DevPipelineWeeklyDataPoint[] = [
        {
          weekStart: '2024-01-01',
          author: 'Dave',
          fullName: 'Dave Wilson',
          team: 'Engineering',
          totalLocDelta: 100,
          totalComplexityDelta: 10,
          totalCommentsDelta: 20,
          totalTestsDelta: 60,
          totalCommentLines: 50,
          totalCodeLines: 400,
          commitCount: 5,
          commentsRatio: 12.5,
        },
      ];

      const scatterData = transformToScatterData(data, 'totalTestsDelta');

      expect(scatterData[0]?.y).toBe(60);
    });

    it('should transform weekly data to scatter plot format for comments ratio', () => {
      const data: DevPipelineWeeklyDataPoint[] = [
        {
          weekStart: '2024-01-01',
          author: 'Eve',
          fullName: 'Eve Martinez',
          team: 'Engineering',
          totalLocDelta: 100,
          totalComplexityDelta: 10,
          totalCommentsDelta: 20,
          totalTestsDelta: 30,
          totalCommentLines: 50,
          totalCodeLines: 400,
          commitCount: 5,
          commentsRatio: 12.5,
        },
      ];

      const scatterData = transformToScatterData(data, 'commentsRatio');

      expect(scatterData[0]?.y).toBe(12.5);
    });

    it('should handle multiple data points', () => {
      const data: DevPipelineWeeklyDataPoint[] = [
        {
          weekStart: '2024-01-01',
          author: 'Alice',
          fullName: 'Alice Smith',
          team: 'Engineering',
          totalLocDelta: 100,
          totalComplexityDelta: 10,
          totalCommentsDelta: 20,
          totalTestsDelta: 30,
          totalCommentLines: 50,
          totalCodeLines: 400,
          commitCount: 5,
          commentsRatio: 12.5,
        },
        {
          weekStart: '2024-01-08',
          author: 'Bob',
          fullName: 'Bob Jones',
          team: 'Engineering',
          totalLocDelta: 200,
          totalComplexityDelta: 20,
          totalCommentsDelta: 40,
          totalTestsDelta: 60,
          totalCommentLines: 100,
          totalCodeLines: 800,
          commitCount: 10,
          commentsRatio: 12.5,
        },
      ];

      const scatterData = transformToScatterData(data, 'totalLocDelta');

      expect(scatterData).toHaveLength(2);
      expect(scatterData[0]?.y).toBe(100);
      expect(scatterData[1]?.y).toBe(200);
    });

    it('should handle empty data array', () => {
      const data: DevPipelineWeeklyDataPoint[] = [];
      const scatterData = transformToScatterData(data, 'totalLocDelta');

      expect(scatterData).toHaveLength(0);
    });
  });

  // ==========================================================================
  // calculateCommentsRatio
  // ==========================================================================
  describe('calculateCommentsRatio', () => {
    /**
     * Calculate comments ratio as percentage.
     * Formula: (comment_lines / code_lines) * 100
     */
    function calculateCommentsRatio(
      commentLines: number | null,
      codeLines: number | null
    ): number | null {
      if (commentLines === null || codeLines === null) {
        return null;
      }
      if (codeLines === 0) {
        return null;
      }
      return (commentLines / codeLines) * 100;
    }

    it('should calculate ratio as percentage', () => {
      // 20 comment lines, 80 code lines = 25%
      expect(calculateCommentsRatio(20, 80)).toBe(25);

      // 50 comment lines, 200 code lines = 25%
      expect(calculateCommentsRatio(50, 200)).toBe(25);

      // 100 comment lines, 400 code lines = 25%
      expect(calculateCommentsRatio(100, 400)).toBe(25);
    });

    it('should return null for zero code lines', () => {
      expect(calculateCommentsRatio(10, 0)).toBeNull();
      expect(calculateCommentsRatio(100, 0)).toBeNull();
    });

    it('should handle null comment lines', () => {
      expect(calculateCommentsRatio(null, 100)).toBeNull();
    });

    it('should handle null code lines', () => {
      expect(calculateCommentsRatio(10, null)).toBeNull();
    });

    it('should handle both null inputs', () => {
      expect(calculateCommentsRatio(null, null)).toBeNull();
    });

    it('should handle zero comment lines', () => {
      // 0 comment lines, 100 code lines = 0%
      expect(calculateCommentsRatio(0, 100)).toBe(0);
    });

    it('should calculate various ratios correctly', () => {
      // 10% ratio
      expect(calculateCommentsRatio(10, 100)).toBe(10);

      // 50% ratio
      expect(calculateCommentsRatio(50, 100)).toBe(50);

      // 100% ratio
      expect(calculateCommentsRatio(100, 100)).toBe(100);

      // >100% ratio (more comments than code)
      expect(calculateCommentsRatio(150, 100)).toBe(150);

      // Low ratio
      expect(calculateCommentsRatio(1, 1000)).toBe(0.1);
    });

    it('should handle fractional results', () => {
      // 1 comment line, 3 code lines = 33.333...%
      const ratio = calculateCommentsRatio(1, 3);
      expect(ratio).toBeCloseTo(33.333333, 5);
    });
  });

  // ==========================================================================
  // validateDateRange
  // ==========================================================================
  describe('validateDateRange', () => {
    /**
     * Validate date range inputs.
     * Checks format, range order, and maximum range.
     */
    function validateDateRange(startDate: string, endDate: string): boolean {
      // Check format: YYYY-MM-DD
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      if (!datePattern.test(startDate) || !datePattern.test(endDate)) {
        throw new Error('Invalid date format. Expected YYYY-MM-DD.');
      }

      // Check if dates are valid
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error('Invalid date format. Expected YYYY-MM-DD.');
      }

      // Check range order
      if (start > end) {
        throw new Error(`Invalid date range: start date (${startDate}) must be before end date (${endDate})`);
      }

      // Check maximum range (365 days)
      const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > 365) {
        throw new Error(`Date range exceeds maximum of 365 days. Requested range: ${daysDiff.toFixed(0)} days.`);
      }

      return true;
    }

    it('should accept valid date range', () => {
      expect(validateDateRange('2024-01-01', '2024-06-01')).toBe(true);
      expect(validateDateRange('2024-01-01', '2024-01-31')).toBe(true);
      expect(validateDateRange('2024-06-01', '2024-06-30')).toBe(true);
    });

    it('should reject range exceeding 365 days', () => {
      expect(() => validateDateRange('2024-01-01', '2025-02-01')).toThrow('Date range exceeds maximum of 365 days');
      expect(() => validateDateRange('2024-01-01', '2025-12-31')).toThrow('Date range exceeds maximum of 365 days');
    });

    it('should accept range of exactly 365 days', () => {
      expect(validateDateRange('2024-01-01', '2024-12-31')).toBe(true);
    });

    it('should reject invalid date format', () => {
      expect(() => validateDateRange('01-01-2024', '2024-06-01')).toThrow('Invalid date format');
      expect(() => validateDateRange('2024-01-01', '06-01-2024')).toThrow('Invalid date format');
      expect(() => validateDateRange('2024/01/01', '2024/06/01')).toThrow('Invalid date format');
      expect(() => validateDateRange('bad-date', '2024-06-01')).toThrow('Invalid date format');
    });

    it('should reject invalid dates', () => {
      // Note: JavaScript Date constructor is permissive and allows invalid dates like 2024-02-30
      // (it auto-converts to 2024-03-02), so our simple validation may not catch all invalid dates.
      // The real validation happens in the service layer with isValidDateString.
      // For this test, we verify that malformed formats are rejected.
      expect(() => validateDateRange('2024-13-01', '2024-06-01')).toThrow('Invalid date format');
    });

    it('should reject end date before start date', () => {
      expect(() => validateDateRange('2024-06-01', '2024-01-01')).toThrow('Invalid date range: start date (2024-06-01) must be before end date (2024-01-01)');
      expect(() => validateDateRange('2024-12-31', '2024-01-01')).toThrow('Invalid date range');
    });

    it('should accept same start and end date', () => {
      expect(validateDateRange('2024-06-01', '2024-06-01')).toBe(true);
    });

    it('should handle leap year dates', () => {
      expect(validateDateRange('2024-02-29', '2024-06-01')).toBe(true);
    });
  });

  // ==========================================================================
  // Protocol Type Validation
  // ==========================================================================
  describe('Protocol Types', () => {
    it('should validate DevPipelineWeeklyDataPoint has all required fields', () => {
      const dataPoint: DevPipelineWeeklyDataPoint = {
        weekStart: '2024-01-01',
        author: 'test@example.com',
        fullName: 'Test User',
        team: 'Engineering',
        totalLocDelta: 100,
        totalComplexityDelta: 5,
        totalCommentsDelta: 10,
        totalTestsDelta: 20,
        totalCommentLines: 25,
        totalCodeLines: 200,
        commitCount: 3,
        commentsRatio: 12.5,
      };

      // Validate all fields are defined
      expect(dataPoint.weekStart).toBeDefined();
      expect(dataPoint.author).toBeDefined();
      expect(dataPoint.fullName).toBeDefined();
      expect(dataPoint.team).toBeDefined();
      expect(dataPoint.totalLocDelta).toBeDefined();
      expect(dataPoint.totalComplexityDelta).toBeDefined();
      expect(dataPoint.totalCommentsDelta).toBeDefined();
      expect(dataPoint.totalTestsDelta).toBeDefined();
      expect(dataPoint.totalCommentLines).toBeDefined();
      expect(dataPoint.totalCodeLines).toBeDefined();
      expect(dataPoint.commitCount).toBeDefined();
      expect(dataPoint.commentsRatio).toBeDefined();

      // Validate types
      expect(typeof dataPoint.weekStart).toBe('string');
      expect(typeof dataPoint.author).toBe('string');
      expect(typeof dataPoint.totalLocDelta).toBe('number');
      expect(typeof dataPoint.totalComplexityDelta).toBe('number');
      expect(typeof dataPoint.totalCommentsDelta).toBe('number');
      expect(typeof dataPoint.totalTestsDelta).toBe('number');
      expect(typeof dataPoint.totalCommentLines).toBe('number');
      expect(typeof dataPoint.totalCodeLines).toBe('number');
      expect(typeof dataPoint.commitCount).toBe('number');
      expect(typeof dataPoint.commentsRatio).toBe('number');
    });

    it('should allow null for optional fields in DevPipelineWeeklyDataPoint', () => {
      const dataPoint: DevPipelineWeeklyDataPoint = {
        weekStart: '2024-01-01',
        author: 'test@example.com',
        fullName: null, // Optional
        team: null,     // Optional
        totalLocDelta: 100,
        totalComplexityDelta: 5,
        totalCommentsDelta: 10,
        totalTestsDelta: 20,
        totalCommentLines: 25,
        totalCodeLines: 200,
        commitCount: 3,
        commentsRatio: 12.5,
      };

      expect(dataPoint.fullName).toBeNull();
      expect(dataPoint.team).toBeNull();
    });
  });

  // ==========================================================================
  // Color Palette Constants
  // ==========================================================================
  describe('Color Palette Constants', () => {
    it('should define 8 colors in TEAM_MEMBER_COLORS palette', () => {
      expect(TEAM_MEMBER_COLORS).toHaveLength(8);
    });

    it('should have all valid hex color codes', () => {
      const hexPattern = /^#[0-9A-Fa-f]{6}$/;

      TEAM_MEMBER_COLORS.forEach(color => {
        expect(color).toMatch(hexPattern);
      });

      expect(UNKNOWN_AUTHOR_COLOR).toMatch(hexPattern);
    });

    it('should have unique colors in palette', () => {
      const uniqueColors = new Set(TEAM_MEMBER_COLORS);
      expect(uniqueColors.size).toBe(8);
    });

    it('should define UNKNOWN_AUTHOR_COLOR constant', () => {
      expect(UNKNOWN_AUTHOR_COLOR).toBeDefined();
      expect(typeof UNKNOWN_AUTHOR_COLOR).toBe('string');
      expect(UNKNOWN_AUTHOR_COLOR).toBe('#666666');
    });

    it('should define UNKNOWN_AUTHOR_NAME constant', () => {
      expect(UNKNOWN_AUTHOR_NAME).toBeDefined();
      expect(typeof UNKNOWN_AUTHOR_NAME).toBe('string');
      expect(UNKNOWN_AUTHOR_NAME).toBe('(Unknown Developer)');
    });

    it('should use Okabe-Ito colorblind-safe colors', () => {
      // Verify specific Okabe-Ito colors are present
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
});
