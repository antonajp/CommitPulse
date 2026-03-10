import { describe, it, expect } from 'vitest';
import { mapDurationToStoryPoints } from '../../utils/fibonacci-mapper.js';

/**
 * Unit tests for fibonacci-mapper.ts.
 *
 * Tests all Fibonacci boundaries, edge cases, and invalid inputs.
 * Target: 100% coverage of the pure function.
 *
 * Ticket: IQS-884
 */
describe('mapDurationToStoryPoints', () => {
  // --------------------------------------------------------------------------
  // Negative durations -> null (invalid data)
  // --------------------------------------------------------------------------

  describe('negative durations (invalid data)', () => {
    it('should return null for -1 days', () => {
      expect(mapDurationToStoryPoints(-1)).toBeNull();
    });

    it('should return null for -100 days', () => {
      expect(mapDurationToStoryPoints(-100)).toBeNull();
    });

    it('should return null for -0.5 days (fractional negative)', () => {
      expect(mapDurationToStoryPoints(-0.5)).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 0 days -> 1 point
  // --------------------------------------------------------------------------

  describe('0 days -> 1 point', () => {
    it('should return 1 for 0 days (same-day completion)', () => {
      expect(mapDurationToStoryPoints(0)).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 1-2 days -> 2 points
  // --------------------------------------------------------------------------

  describe('1-2 days -> 2 points', () => {
    it('should return 2 for 1 day', () => {
      expect(mapDurationToStoryPoints(1)).toBe(2);
    });

    it('should return 2 for 2 days (upper boundary)', () => {
      expect(mapDurationToStoryPoints(2)).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // 3-4 days -> 3 points
  // --------------------------------------------------------------------------

  describe('3-4 days -> 3 points', () => {
    it('should return 3 for 3 days (lower boundary)', () => {
      expect(mapDurationToStoryPoints(3)).toBe(3);
    });

    it('should return 3 for 4 days (upper boundary)', () => {
      expect(mapDurationToStoryPoints(4)).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // 5-7 days -> 5 points
  // --------------------------------------------------------------------------

  describe('5-7 days -> 5 points', () => {
    it('should return 5 for 5 days (lower boundary)', () => {
      expect(mapDurationToStoryPoints(5)).toBe(5);
    });

    it('should return 5 for 6 days', () => {
      expect(mapDurationToStoryPoints(6)).toBe(5);
    });

    it('should return 5 for 7 days (upper boundary)', () => {
      expect(mapDurationToStoryPoints(7)).toBe(5);
    });
  });

  // --------------------------------------------------------------------------
  // 8-12 days -> 8 points
  // --------------------------------------------------------------------------

  describe('8-12 days -> 8 points', () => {
    it('should return 8 for 8 days (lower boundary)', () => {
      expect(mapDurationToStoryPoints(8)).toBe(8);
    });

    it('should return 8 for 10 days', () => {
      expect(mapDurationToStoryPoints(10)).toBe(8);
    });

    it('should return 8 for 12 days (upper boundary)', () => {
      expect(mapDurationToStoryPoints(12)).toBe(8);
    });
  });

  // --------------------------------------------------------------------------
  // 13-20 days -> 13 points
  // --------------------------------------------------------------------------

  describe('13-20 days -> 13 points', () => {
    it('should return 13 for 13 days (lower boundary)', () => {
      expect(mapDurationToStoryPoints(13)).toBe(13);
    });

    it('should return 13 for 15 days', () => {
      expect(mapDurationToStoryPoints(15)).toBe(13);
    });

    it('should return 13 for 20 days (upper boundary)', () => {
      expect(mapDurationToStoryPoints(20)).toBe(13);
    });
  });

  // --------------------------------------------------------------------------
  // 21+ days -> 21 points
  // --------------------------------------------------------------------------

  describe('21+ days -> 21 points', () => {
    it('should return 21 for 21 days (lower boundary)', () => {
      expect(mapDurationToStoryPoints(21)).toBe(21);
    });

    it('should return 21 for 30 days', () => {
      expect(mapDurationToStoryPoints(30)).toBe(21);
    });

    it('should return 21 for 100 days', () => {
      expect(mapDurationToStoryPoints(100)).toBe(21);
    });

    it('should return 21 for 365 days (very long duration)', () => {
      expect(mapDurationToStoryPoints(365)).toBe(21);
    });

    it('should return 21 for 1000 days (extreme duration)', () => {
      expect(mapDurationToStoryPoints(1000)).toBe(21);
    });
  });

  // --------------------------------------------------------------------------
  // Boundary transitions
  // --------------------------------------------------------------------------

  describe('boundary transitions', () => {
    it('should transition from 1 to 2 at day 1', () => {
      expect(mapDurationToStoryPoints(0)).toBe(1);
      expect(mapDurationToStoryPoints(1)).toBe(2);
    });

    it('should transition from 2 to 3 at day 3', () => {
      expect(mapDurationToStoryPoints(2)).toBe(2);
      expect(mapDurationToStoryPoints(3)).toBe(3);
    });

    it('should transition from 3 to 5 at day 5', () => {
      expect(mapDurationToStoryPoints(4)).toBe(3);
      expect(mapDurationToStoryPoints(5)).toBe(5);
    });

    it('should transition from 5 to 8 at day 8', () => {
      expect(mapDurationToStoryPoints(7)).toBe(5);
      expect(mapDurationToStoryPoints(8)).toBe(8);
    });

    it('should transition from 8 to 13 at day 13', () => {
      expect(mapDurationToStoryPoints(12)).toBe(8);
      expect(mapDurationToStoryPoints(13)).toBe(13);
    });

    it('should transition from 13 to 21 at day 21', () => {
      expect(mapDurationToStoryPoints(20)).toBe(13);
      expect(mapDurationToStoryPoints(21)).toBe(21);
    });
  });
});
