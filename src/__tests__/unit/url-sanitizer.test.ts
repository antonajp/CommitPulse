import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import {
  sanitizeUrlForLogging,
  hasEmbeddedCredentials,
} from '../../utils/url-sanitizer.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for the URL sanitizer utility (IQS-936).
 *
 * Security-critical tests for credential redaction:
 * - HTTPS URLs with user:pass credentials
 * - HTTPS URLs with token-only credentials
 * - SSH shorthand format (git@host:path)
 * - SSH protocol URLs (ssh://user@host/path)
 * - Git protocol URLs (git://host/path)
 * - Edge cases: empty, null, malformed URLs
 */

describe('URL Sanitizer Utility', () => {
  beforeEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  afterEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('sanitizeUrlForLogging', () => {
    describe('HTTPS URLs with credentials', () => {
      it('should redact user:pass credentials from HTTPS URL', () => {
        const url = 'https://user:password@github.com/org/repo.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('https://***:***@github.com/org/repo.git');
      });

      it('should redact token:x-oauth-basic credentials from HTTPS URL', () => {
        const url = 'https://ghp_xxxxxxxxxxxx:x-oauth-basic@github.com/org/repo.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('https://***:***@github.com/org/repo.git');
      });

      it('should redact user-only credentials from HTTPS URL', () => {
        const url = 'https://user@github.com/org/repo.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('https://***@github.com/org/repo.git');
      });

      it('should redact credentials from HTTP URL', () => {
        const url = 'http://user:pass@internal.git.local/repo';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('http://***:***@internal.git.local/repo');
      });

      it('should preserve URL path after credentials', () => {
        const url = 'https://token:x@github.com/org/repo/path/to/file.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('https://***:***@github.com/org/repo/path/to/file.git');
      });

      it('should handle complex password with special characters', () => {
        // Password contains @ which could confuse naive parsing
        const url = 'https://user:p%40ss%21word@github.com/org/repo.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('https://***:***@github.com/org/repo.git');
      });
    });

    describe('URLs without credentials', () => {
      it('should return HTTPS URL without credentials unchanged', () => {
        const url = 'https://github.com/org/repo.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('https://github.com/org/repo.git');
      });

      it('should return HTTP URL without credentials unchanged', () => {
        const url = 'http://internal.git.local/repo';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('http://internal.git.local/repo');
      });
    });

    describe('SSH URLs', () => {
      it('should preserve SSH shorthand format (git@host:path)', () => {
        const url = 'git@github.com:org/repo.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('git@github.com:org/repo.git');
      });

      it('should preserve SSH shorthand with deploy key username', () => {
        const url = 'deploy@gitlab.company.com:group/project.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('deploy@gitlab.company.com:group/project.git');
      });

      it('should preserve SSH protocol URL', () => {
        const url = 'ssh://git@github.com/org/repo.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('ssh://git@github.com/org/repo.git');
      });

      it('should preserve SSH protocol URL with port', () => {
        const url = 'ssh://deploy@gitlab.company.com:2222/project.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('ssh://deploy@gitlab.company.com:2222/project.git');
      });
    });

    describe('Git protocol URLs', () => {
      it('should preserve git:// URL unchanged', () => {
        const url = 'git://github.com/org/repo.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('git://github.com/org/repo.git');
      });
    });

    describe('Edge cases', () => {
      it('should return empty string for null input', () => {
        const sanitized = sanitizeUrlForLogging(null as unknown as string);
        expect(sanitized).toBe('');
      });

      it('should return empty string for undefined input', () => {
        const sanitized = sanitizeUrlForLogging(undefined as unknown as string);
        expect(sanitized).toBe('');
      });

      it('should return empty string for empty string input', () => {
        const sanitized = sanitizeUrlForLogging('');
        expect(sanitized).toBe('');
      });

      it('should trim whitespace from URL', () => {
        const url = '  https://github.com/org/repo.git  ';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('https://github.com/org/repo.git');
      });

      it('should handle non-URL strings gracefully', () => {
        const notAUrl = 'this is not a url';
        const sanitized = sanitizeUrlForLogging(notAUrl);
        expect(sanitized).toBe('this is not a url');
      });

      it('should handle file:// URLs (no credentials)', () => {
        const url = 'file:///path/to/repo.git';
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).toBe('file:///path/to/repo.git');
      });
    });
  });

  describe('hasEmbeddedCredentials', () => {
    it('should return true for HTTPS URL with user:pass', () => {
      expect(hasEmbeddedCredentials('https://user:pass@github.com/repo')).toBe(true);
    });

    it('should return true for HTTPS URL with user only', () => {
      expect(hasEmbeddedCredentials('https://user@github.com/repo')).toBe(true);
    });

    it('should return false for HTTPS URL without credentials', () => {
      expect(hasEmbeddedCredentials('https://github.com/repo')).toBe(false);
    });

    it('should return false for SSH shorthand', () => {
      expect(hasEmbeddedCredentials('git@github.com:org/repo')).toBe(false);
    });

    it('should return false for SSH protocol URL', () => {
      expect(hasEmbeddedCredentials('ssh://git@github.com/repo')).toBe(false);
    });

    it('should return false for git:// URL', () => {
      expect(hasEmbeddedCredentials('git://github.com/repo')).toBe(false);
    });

    it('should return false for null', () => {
      expect(hasEmbeddedCredentials(null as unknown as string)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(hasEmbeddedCredentials('')).toBe(false);
    });
  });
});
