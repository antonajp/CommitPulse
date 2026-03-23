/**
 * Unit tests for date-validator.ts
 *
 * Tests validation of date parameters for git commands to prevent
 * command injection attacks (CWE-88).
 *
 * Ticket: GITX-131
 */

import { describe, it, expect } from 'vitest';
import { validateDateParameter, assertValidDate } from '../../utils/date-validator.js';

describe('date-validator', () => {
  describe('validateDateParameter', () => {
    // Valid cases
    it('should accept valid YYYY-MM-DD date', () => {
      const result = validateDateParameter('2024-01-15');
      expect(result.isValid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept undefined (optional date)', () => {
      const result = validateDateParameter(undefined);
      expect(result.isValid).toBe(true);
    });

    it('should accept null (optional date)', () => {
      const result = validateDateParameter(null);
      expect(result.isValid).toBe(true);
    });

    it('should accept empty string (no date filter)', () => {
      const result = validateDateParameter('');
      expect(result.isValid).toBe(true);
    });

    it('should accept whitespace-only string (no date filter)', () => {
      const result = validateDateParameter('   ');
      expect(result.isValid).toBe(true);
    });

    it('should accept leap year date', () => {
      const result = validateDateParameter('2024-02-29');
      expect(result.isValid).toBe(true);
    });

    it('should accept first day of year', () => {
      const result = validateDateParameter('2024-01-01');
      expect(result.isValid).toBe(true);
    });

    it('should accept last day of year', () => {
      const result = validateDateParameter('2024-12-31');
      expect(result.isValid).toBe(true);
    });

    // Invalid date formats
    it('should reject non-YYYY-MM-DD format (US style)', () => {
      const result = validateDateParameter('01-15-2024');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('YYYY-MM-DD');
    });

    it('should reject date with time', () => {
      const result = validateDateParameter('2024-01-15T10:30:00');
      expect(result.isValid).toBe(false);
    });

    it('should reject date with spaces', () => {
      const result = validateDateParameter('2024-01-15 10:30');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('spaces');
    });

    // Invalid date values
    it('should reject invalid month (13)', () => {
      const result = validateDateParameter('2024-13-01');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Invalid month');
    });

    it('should reject invalid month (00)', () => {
      const result = validateDateParameter('2024-00-15');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Invalid month');
    });

    it('should reject invalid day (32)', () => {
      const result = validateDateParameter('2024-01-32');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Invalid day');
    });

    it('should reject invalid day (00)', () => {
      const result = validateDateParameter('2024-01-00');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Invalid day');
    });

    it('should reject Feb 30', () => {
      const result = validateDateParameter('2024-02-30');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Invalid day');
    });

    it('should reject Feb 29 on non-leap year', () => {
      const result = validateDateParameter('2023-02-29');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Invalid day');
    });

    it('should reject year before 1970', () => {
      const result = validateDateParameter('1969-12-31');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Invalid year');
    });

    it('should reject year after 2100', () => {
      const result = validateDateParameter('2101-01-01');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Invalid year');
    });

    // Security: Command injection prevention
    it('should reject strings starting with dash (potential flag injection)', () => {
      const result = validateDateParameter('--since=2024-01-01');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('dash');
    });

    it('should reject strings with semicolon (shell injection)', () => {
      const result = validateDateParameter('2024-01-01;rm');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('invalid characters');
    });

    it('should reject strings with pipe (shell injection)', () => {
      const result = validateDateParameter('2024-01-01|cat');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('invalid characters');
    });

    it('should reject strings with backtick (command substitution)', () => {
      const result = validateDateParameter('2024-01-01`whoami`');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('invalid characters');
    });

    it('should reject strings with $() (command substitution)', () => {
      const result = validateDateParameter('2024-01-01$(id)');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('invalid characters');
    });

    it('should reject strings with ampersand (background execution)', () => {
      const result = validateDateParameter('2024-01-01&sleep');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('invalid characters');
    });

    it('should reject strings with quotes', () => {
      const result = validateDateParameter('"2024-01-01"');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('invalid characters');
    });

    it('should reject strings with backslash', () => {
      const result = validateDateParameter('2024\\-01-01');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('invalid characters');
    });
  });

  describe('assertValidDate', () => {
    it('should not throw for valid date', () => {
      expect(() => assertValidDate('2024-01-15', 'sinceDate')).not.toThrow();
    });

    it('should not throw for undefined', () => {
      expect(() => assertValidDate(undefined, 'sinceDate')).not.toThrow();
    });

    it('should throw for invalid date with parameter name', () => {
      expect(() => assertValidDate('invalid', 'sinceDate')).toThrow('Invalid sinceDate');
    });

    it('should throw for injection attempt', () => {
      expect(() => assertValidDate('--exec=evil.sh', 'untilDate')).toThrow('Invalid untilDate');
    });
  });
});
