import { describe, it, expect } from 'vitest';
import {
  isValidContributorName,
  MAX_CONTRIBUTOR_NAME_LENGTH,
} from '../../utils/contributor-validation.js';

/**
 * Unit tests for contributor-validation utilities (GITX-121).
 */
describe('contributor-validation', () => {
  describe('isValidContributorName', () => {
    it('should accept simple alphanumeric logins', () => {
      expect(isValidContributorName('johndoe')).toBe(true);
      expect(isValidContributorName('user123')).toBe(true);
      expect(isValidContributorName('JohnDoe')).toBe(true);
    });

    it('should accept logins with dots', () => {
      expect(isValidContributorName('john.doe')).toBe(true);
      expect(isValidContributorName('j.doe.dev')).toBe(true);
    });

    it('should accept logins with hyphens', () => {
      expect(isValidContributorName('john-doe')).toBe(true);
      expect(isValidContributorName('john-doe-123')).toBe(true);
    });

    it('should accept logins with underscores', () => {
      expect(isValidContributorName('john_doe')).toBe(true);
      expect(isValidContributorName('john_doe_123')).toBe(true);
    });

    it('should accept full names with spaces', () => {
      expect(isValidContributorName('John Doe')).toBe(true);
      expect(isValidContributorName('Jean-Paul Antona')).toBe(true);
      expect(isValidContributorName('John W. Doe III')).toBe(true);
    });

    it('should accept email-style identifiers', () => {
      expect(isValidContributorName('john@example.com')).toBe(true);
      expect(isValidContributorName('john.doe@company.com')).toBe(true);
    });

    it('should reject empty strings', () => {
      expect(isValidContributorName('')).toBe(false);
    });

    it('should reject null and undefined', () => {
      expect(isValidContributorName(null as unknown as string)).toBe(false);
      expect(isValidContributorName(undefined as unknown as string)).toBe(false);
    });

    it('should reject non-string types', () => {
      expect(isValidContributorName(123 as unknown as string)).toBe(false);
      expect(isValidContributorName({} as unknown as string)).toBe(false);
    });

    it('should reject strings over MAX_CONTRIBUTOR_NAME_LENGTH characters', () => {
      const longName = 'a'.repeat(MAX_CONTRIBUTOR_NAME_LENGTH + 1);
      expect(isValidContributorName(longName)).toBe(false);
    });

    it('should accept strings at exactly MAX_CONTRIBUTOR_NAME_LENGTH characters', () => {
      const maxName = 'a'.repeat(MAX_CONTRIBUTOR_NAME_LENGTH);
      expect(isValidContributorName(maxName)).toBe(true);
    });

    it('should reject names with script tags', () => {
      expect(isValidContributorName('<script>alert(1)</script>')).toBe(false);
    });

    it('should reject names with SQL injection attempts', () => {
      expect(isValidContributorName("user'; DROP TABLE users;--")).toBe(false);
      expect(isValidContributorName('user" OR 1=1--')).toBe(false);
    });

    it('should reject names with special characters', () => {
      expect(isValidContributorName('user#1')).toBe(false);
      expect(isValidContributorName('user$money')).toBe(false);
      expect(isValidContributorName('user%value')).toBe(false);
      expect(isValidContributorName('user^power')).toBe(false);
      expect(isValidContributorName('user&company')).toBe(false);
      expect(isValidContributorName('user*wild')).toBe(false);
    });

    it('should reject names with parentheses', () => {
      expect(isValidContributorName('user(admin)')).toBe(false);
      expect(isValidContributorName('John (Jr.)')).toBe(false);
    });

    it('should reject names with quotes', () => {
      expect(isValidContributorName('user"name"')).toBe(false);
      expect(isValidContributorName("user'name")).toBe(false);
      expect(isValidContributorName('user`name`')).toBe(false);
    });

    it('should reject names with slashes', () => {
      expect(isValidContributorName('user/admin')).toBe(false);
      expect(isValidContributorName('domain\\user')).toBe(false);
    });

    it('should reject names with newlines or tabs', () => {
      expect(isValidContributorName('user\nname')).toBe(false);
      expect(isValidContributorName('user\tname')).toBe(false);
      expect(isValidContributorName('user\r\nname')).toBe(false);
    });
  });

  describe('MAX_CONTRIBUTOR_NAME_LENGTH', () => {
    it('should be 200', () => {
      expect(MAX_CONTRIBUTOR_NAME_LENGTH).toBe(200);
    });
  });
});
