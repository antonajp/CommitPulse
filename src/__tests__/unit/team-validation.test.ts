import { describe, it, expect } from 'vitest';
import { isValidTeamName } from '../../utils/team-validation.js';

/**
 * Unit tests for team-validation utilities (IQS-940).
 */
describe('team-validation', () => {
  describe('isValidTeamName', () => {
    it('should accept simple alphabetic team names', () => {
      expect(isValidTeamName('Platform')).toBe(true);
      expect(isValidTeamName('Frontend')).toBe(true);
      expect(isValidTeamName('Backend')).toBe(true);
    });

    it('should accept team names with spaces', () => {
      expect(isValidTeamName('Platform Team')).toBe(true);
      expect(isValidTeamName('Quality Assurance')).toBe(true);
    });

    it('should accept team names with hyphens', () => {
      expect(isValidTeamName('Front-End')).toBe(true);
      expect(isValidTeamName('Back-End')).toBe(true);
    });

    it('should accept team names with underscores', () => {
      expect(isValidTeamName('QA_Leads')).toBe(true);
      expect(isValidTeamName('Dev_Ops')).toBe(true);
    });

    it('should accept team names with periods', () => {
      expect(isValidTeamName('Team.Alpha')).toBe(true);
      expect(isValidTeamName('Corp.Dev')).toBe(true);
    });

    it('should accept team names with numbers', () => {
      expect(isValidTeamName('Team1')).toBe(true);
      expect(isValidTeamName('Platform2023')).toBe(true);
    });

    it('should reject empty strings', () => {
      expect(isValidTeamName('')).toBe(false);
    });

    it('should reject strings over 100 characters', () => {
      const longName = 'A'.repeat(101);
      expect(isValidTeamName(longName)).toBe(false);
    });

    it('should accept strings at exactly 100 characters', () => {
      const maxName = 'A'.repeat(100);
      expect(isValidTeamName(maxName)).toBe(true);
    });

    it('should reject team names with script tags', () => {
      expect(isValidTeamName('<script>alert(1)</script>')).toBe(false);
    });

    it('should reject team names with special characters', () => {
      expect(isValidTeamName('Team@Work')).toBe(false);
      expect(isValidTeamName('Team#1')).toBe(false);
      expect(isValidTeamName('Team!!')).toBe(false);
      expect(isValidTeamName('Team$Money')).toBe(false);
    });

    it('should reject team names with quotes', () => {
      expect(isValidTeamName('Team"Name"')).toBe(false);
      expect(isValidTeamName("Team'Name")).toBe(false);
    });
  });
});
