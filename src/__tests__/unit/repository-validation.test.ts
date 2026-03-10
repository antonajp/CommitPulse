import { describe, it, expect } from 'vitest';
import {
  isValidRepositoryName,
  MAX_REPOSITORY_NAME_LENGTH,
} from '../../utils/repository-validation.js';

/**
 * Unit tests for repository validation utilities (IQS-920).
 * Tests the validation logic for repository name inputs.
 */
describe('repository-validation', () => {
  describe('isValidRepositoryName', () => {
    describe('valid repository names', () => {
      it('should accept simple alphanumeric names', () => {
        expect(isValidRepositoryName('gitr')).toBe(true);
        expect(isValidRepositoryName('myrepo')).toBe(true);
        expect(isValidRepositoryName('repo123')).toBe(true);
      });

      it('should accept names with hyphens', () => {
        expect(isValidRepositoryName('my-repo')).toBe(true);
        expect(isValidRepositoryName('gitr-extension')).toBe(true);
        expect(isValidRepositoryName('a-b-c-d')).toBe(true);
      });

      it('should accept names with underscores', () => {
        expect(isValidRepositoryName('my_repo')).toBe(true);
        expect(isValidRepositoryName('gitr_extension')).toBe(true);
        expect(isValidRepositoryName('a_b_c_d')).toBe(true);
      });

      it('should accept names with dots', () => {
        expect(isValidRepositoryName('my.repo')).toBe(true);
        expect(isValidRepositoryName('gitr.config')).toBe(true);
        expect(isValidRepositoryName('a.b.c.d')).toBe(true);
      });

      it('should accept names with mixed valid characters', () => {
        expect(isValidRepositoryName('my-repo_v1.2')).toBe(true);
        expect(isValidRepositoryName('UPPERCASE')).toBe(true);
        expect(isValidRepositoryName('MixedCase123')).toBe(true);
        expect(isValidRepositoryName('a-b_c.d')).toBe(true);
      });

      it('should accept single character names', () => {
        expect(isValidRepositoryName('a')).toBe(true);
        expect(isValidRepositoryName('Z')).toBe(true);
        expect(isValidRepositoryName('1')).toBe(true);
      });

      it('should accept names at maximum length (100 chars)', () => {
        const maxLengthName = 'a'.repeat(MAX_REPOSITORY_NAME_LENGTH);
        expect(isValidRepositoryName(maxLengthName)).toBe(true);
      });
    });

    describe('invalid repository names', () => {
      it('should reject empty strings', () => {
        expect(isValidRepositoryName('')).toBe(false);
      });

      it('should reject names exceeding max length', () => {
        const tooLongName = 'a'.repeat(MAX_REPOSITORY_NAME_LENGTH + 1);
        expect(isValidRepositoryName(tooLongName)).toBe(false);
      });

      it('should reject names with slashes', () => {
        expect(isValidRepositoryName('path/repo')).toBe(false);
        expect(isValidRepositoryName('org/repo')).toBe(false);
        expect(isValidRepositoryName('/repo')).toBe(false);
        expect(isValidRepositoryName('repo/')).toBe(false);
      });

      it('should reject names with spaces', () => {
        expect(isValidRepositoryName('my repo')).toBe(false);
        expect(isValidRepositoryName(' repo')).toBe(false);
        expect(isValidRepositoryName('repo ')).toBe(false);
        expect(isValidRepositoryName('my  repo')).toBe(false);
      });

      it('should reject names with special characters (XSS prevention)', () => {
        expect(isValidRepositoryName('<script>')).toBe(false);
        expect(isValidRepositoryName('repo<script>alert(1)</script>')).toBe(false);
        expect(isValidRepositoryName('<img src=x onerror=alert(1)>')).toBe(false);
        expect(isValidRepositoryName('repo&name')).toBe(false);
        expect(isValidRepositoryName('"repo"')).toBe(false);
        expect(isValidRepositoryName("'repo'")).toBe(false);
      });

      it('should reject names with SQL injection characters', () => {
        expect(isValidRepositoryName("repo'; DROP TABLE--")).toBe(false);
        expect(isValidRepositoryName('repo" OR "1"="1')).toBe(false);
        expect(isValidRepositoryName('repo; --')).toBe(false);
        expect(isValidRepositoryName('repo/*comment*/')).toBe(false);
      });

      it('should reject names with shell metacharacters', () => {
        expect(isValidRepositoryName('repo; rm -rf /')).toBe(false);
        expect(isValidRepositoryName('repo$(command)')).toBe(false);
        expect(isValidRepositoryName('repo`command`')).toBe(false);
        expect(isValidRepositoryName('repo|cat /etc/passwd')).toBe(false);
        expect(isValidRepositoryName('repo > /tmp/file')).toBe(false);
      });

      it('should reject null and undefined', () => {
        expect(isValidRepositoryName(null as unknown as string)).toBe(false);
        expect(isValidRepositoryName(undefined as unknown as string)).toBe(false);
      });

      it('should reject non-string types', () => {
        expect(isValidRepositoryName(123 as unknown as string)).toBe(false);
        expect(isValidRepositoryName({} as unknown as string)).toBe(false);
        expect(isValidRepositoryName([] as unknown as string)).toBe(false);
      });

      it('should reject names with newlines', () => {
        expect(isValidRepositoryName('repo\nname')).toBe(false);
        expect(isValidRepositoryName('repo\rname')).toBe(false);
        expect(isValidRepositoryName('repo\tname')).toBe(false);
      });

      it('should reject names with unicode characters', () => {
        expect(isValidRepositoryName('repo\u0000name')).toBe(false);
        expect(isValidRepositoryName('repo\u200bname')).toBe(false); // zero-width space
      });
    });
  });

  describe('MAX_REPOSITORY_NAME_LENGTH', () => {
    it('should be 100 characters', () => {
      expect(MAX_REPOSITORY_NAME_LENGTH).toBe(100);
    });
  });
});
