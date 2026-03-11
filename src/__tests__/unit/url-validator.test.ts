/**
 * Unit tests for URL validation utility.
 *
 * Tests security hardening for external links including:
 * - Domain allowlist validation
 * - Protocol/scheme validation
 * - Embedded credentials detection
 * - Ticket ID validation and sanitization
 * - Repository URL validation
 *
 * Ticket: IQS-924
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import {
  validateExternalUrl,
  isValidTicketId,
  sanitizeTicketId,
  validateRepositoryUrl,
  buildJiraTicketUrl,
  buildLinearTicketUrl,
} from '../../utils/url-validator.js';

// Mock vscode module
vi.mock('vscode', () => ({
  Uri: {
    parse: vi.fn((url: string, strict?: boolean) => {
      // Simulate VS Code's Uri.parse behavior
      const match = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]*)(\/.*)?$/);
      if (!match) {
        if (url.startsWith('javascript:') || url.startsWith('data:') || url.startsWith('file:')) {
          return { scheme: url.split(':')[0], authority: '', path: '' };
        }
        throw new Error('Invalid URL');
      }
      return {
        scheme: match[1].toLowerCase(),
        authority: match[2],
        path: match[3] || '',
      };
    }),
  },
}));

// Mock LoggerService
vi.mock('../../logging/logger.js', () => ({
  LoggerService: {
    getInstance: () => ({
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('URL Validator', () => {
  describe('validateExternalUrl', () => {
    describe('GitHub URLs', () => {
      it('should allow github.com URLs', () => {
        const result = validateExternalUrl('https://github.com/user/repo', '');
        expect(result.isValid).toBe(true);
        expect(result.validatedUri).toBeDefined();
      });

      it('should allow GitHub subdomains like gist.github.com', () => {
        const result = validateExternalUrl('https://gist.github.com/user/gist123', '');
        expect(result.isValid).toBe(true);
      });

      it('should reject fake GitHub lookalike domains', () => {
        // Security: github.mycompany.com is NOT a GitHub domain
        const result = validateExternalUrl('https://github.mycompany.com/org/repo', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Untrusted domain');
      });

      it('should allow github.com with port', () => {
        const result = validateExternalUrl('https://github.com:443/user/repo', '');
        expect(result.isValid).toBe(true);
      });

      it('should allow github.com with path and query', () => {
        const result = validateExternalUrl('https://github.com/user/repo/pull/123?diff=unified', '');
        expect(result.isValid).toBe(true);
      });
    });

    describe('Bitbucket URLs', () => {
      it('should allow bitbucket.org URLs', () => {
        const result = validateExternalUrl('https://bitbucket.org/user/repo', '');
        expect(result.isValid).toBe(true);
        expect(result.validatedUri).toBeDefined();
      });

      it('should allow Bitbucket subdomains for enterprise', () => {
        const result = validateExternalUrl('https://bitbucket.mycompany.bitbucket.org/projects/repo', '');
        expect(result.isValid).toBe(true);
      });

      it('should reject fake Bitbucket lookalike domains', () => {
        const result = validateExternalUrl('https://bitbucket.mycompany.com/org/repo', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Untrusted domain');
      });

      it('should allow bitbucket.org commit URLs', () => {
        const result = validateExternalUrl('https://bitbucket.org/user/repo/commits/abc123', '');
        expect(result.isValid).toBe(true);
      });
    });

    describe('GitLab URLs', () => {
      it('should allow gitlab.com URLs', () => {
        const result = validateExternalUrl('https://gitlab.com/user/repo', '');
        expect(result.isValid).toBe(true);
        expect(result.validatedUri).toBeDefined();
      });

      it('should allow GitLab subdomains for self-hosted', () => {
        const result = validateExternalUrl('https://myinstance.gitlab.com/projects/repo', '');
        expect(result.isValid).toBe(true);
      });

      it('should reject fake GitLab lookalike domains', () => {
        const result = validateExternalUrl('https://gitlab.mycompany.com/org/repo', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Untrusted domain');
      });

      it('should allow gitlab.com commit URLs', () => {
        const result = validateExternalUrl('https://gitlab.com/user/repo/-/commit/abc123', '');
        expect(result.isValid).toBe(true);
      });
    });

    describe('Linear URLs', () => {
      it('should allow linear.app URLs', () => {
        const result = validateExternalUrl('https://linear.app/team/issue/TEAM-123', '');
        expect(result.isValid).toBe(true);
      });

      it('should allow linear.app with https scheme', () => {
        const result = validateExternalUrl('https://linear.app/workspace/all', '');
        expect(result.isValid).toBe(true);
      });
    });

    describe('Jira URLs', () => {
      it('should allow configured Jira server URLs', () => {
        const result = validateExternalUrl(
          'https://jira.mycompany.com/browse/PROJ-123',
          'https://jira.mycompany.com',
        );
        expect(result.isValid).toBe(true);
      });

      it('should allow Jira server with trailing slash in config', () => {
        const result = validateExternalUrl(
          'https://jira.mycompany.com/browse/PROJ-123',
          'https://jira.mycompany.com/',
        );
        expect(result.isValid).toBe(true);
      });

      it('should allow Jira server with port', () => {
        const result = validateExternalUrl(
          'https://jira.mycompany.com:8443/browse/PROJ-123',
          'https://jira.mycompany.com:8443',
        );
        expect(result.isValid).toBe(true);
      });

      it('should reject Jira URLs when no server configured', () => {
        const result = validateExternalUrl(
          'https://jira.mycompany.com/browse/PROJ-123',
          '',
        );
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Untrusted domain');
      });
    });

    describe('Untrusted domains', () => {
      it('should reject arbitrary domains', () => {
        const result = validateExternalUrl('https://evil.com/phishing', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Untrusted domain');
      });

      it('should reject domains that look similar to github', () => {
        const result = validateExternalUrl('https://github.com.evil.com/user/repo', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Untrusted domain');
      });
    });

    describe('Invalid schemes', () => {
      it('should reject javascript: URLs', () => {
        const result = validateExternalUrl('javascript:alert(1)', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Invalid scheme');
      });

      it('should reject data: URLs', () => {
        const result = validateExternalUrl('data:text/html,<script>alert(1)</script>', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Invalid scheme');
      });

      it('should reject file: URLs', () => {
        const result = validateExternalUrl('file:///etc/passwd', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Invalid scheme');
      });

      it('should allow http (not just https)', () => {
        const result = validateExternalUrl('http://github.com/user/repo', '');
        expect(result.isValid).toBe(true);
      });
    });

    describe('Embedded credentials', () => {
      it('should reject URLs with user:pass@host', () => {
        const result = validateExternalUrl('https://user:pass@github.com/repo', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('embedded credentials');
      });

      it('should reject URLs with user@host', () => {
        const result = validateExternalUrl('https://user@github.com/repo', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('embedded credentials');
      });
    });

    describe('Edge cases', () => {
      it('should reject empty URLs', () => {
        const result = validateExternalUrl('', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Empty URL');
      });

      it('should reject whitespace-only URLs', () => {
        const result = validateExternalUrl('   ', '');
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Empty URL');
      });

      it('should reject null-ish URLs', () => {
        const result = validateExternalUrl(null as unknown as string, '');
        expect(result.isValid).toBe(false);
      });
    });
  });

  describe('isValidTicketId', () => {
    describe('Valid ticket IDs', () => {
      it('should accept standard format PROJ-123', () => {
        expect(isValidTicketId('PROJ-123')).toBe(true);
      });

      it('should accept single letter project key', () => {
        expect(isValidTicketId('A-1')).toBe(true);
      });

      it('should accept 10 character project key', () => {
        expect(isValidTicketId('ABCDEFGHIJ-99999')).toBe(true);
      });

      it('should accept alphanumeric project keys', () => {
        expect(isValidTicketId('IQS123-456')).toBe(true);
      });

      it('should accept common formats like JIRA-1, IQS-924', () => {
        expect(isValidTicketId('JIRA-1')).toBe(true);
        expect(isValidTicketId('IQS-924')).toBe(true);
        expect(isValidTicketId('PROJ-12345')).toBe(true);
      });
    });

    describe('Invalid ticket IDs', () => {
      it('should reject lowercase project keys', () => {
        expect(isValidTicketId('proj-123')).toBe(false);
      });

      it('should reject missing hyphen', () => {
        expect(isValidTicketId('PROJ123')).toBe(false);
      });

      it('should reject missing issue number', () => {
        expect(isValidTicketId('PROJ-')).toBe(false);
      });

      it('should reject project key starting with number', () => {
        expect(isValidTicketId('1PROJ-123')).toBe(false);
      });

      it('should reject project key longer than 10 chars', () => {
        expect(isValidTicketId('ABCDEFGHIJK-123')).toBe(false);
      });

      it('should reject special characters', () => {
        expect(isValidTicketId('PRO<script>-123')).toBe(false);
        expect(isValidTicketId('PROJ-123<script>')).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isValidTicketId('')).toBe(false);
      });

      it('should reject null', () => {
        expect(isValidTicketId(null as unknown as string)).toBe(false);
      });
    });
  });

  describe('sanitizeTicketId', () => {
    it('should convert to uppercase', () => {
      expect(sanitizeTicketId('proj-123')).toBe('PROJ-123');
    });

    it('should strip special characters', () => {
      expect(sanitizeTicketId('PROJ<script>-123')).toBe('PROJSCRIPT-123');
    });

    it('should keep valid characters', () => {
      expect(sanitizeTicketId('IQS-924')).toBe('IQS-924');
    });

    it('should handle empty string', () => {
      expect(sanitizeTicketId('')).toBe('');
    });

    it('should handle null', () => {
      expect(sanitizeTicketId(null as unknown as string)).toBe('');
    });

    it('should strip spaces', () => {
      expect(sanitizeTicketId('PROJ - 123')).toBe('PROJ-123');
    });
  });

  describe('validateRepositoryUrl', () => {
    describe('Valid URLs', () => {
      it('should accept https URLs', () => {
        const result = validateRepositoryUrl('https://github.com/user/repo.git');
        expect(result.isValid).toBe(true);
      });

      it('should accept http URLs', () => {
        const result = validateRepositoryUrl('http://github.com/user/repo.git');
        expect(result.isValid).toBe(true);
      });

      it('should accept git:// protocol', () => {
        const result = validateRepositoryUrl('git://github.com/user/repo.git');
        expect(result.isValid).toBe(true);
      });

      it('should accept ssh:// protocol', () => {
        const result = validateRepositoryUrl('ssh://git@github.com/user/repo.git');
        expect(result.isValid).toBe(true);
      });

      it('should accept SSH shorthand format', () => {
        const result = validateRepositoryUrl('git@github.com:user/repo.git');
        expect(result.isValid).toBe(true);
      });
    });

    describe('Invalid URLs', () => {
      it('should reject javascript: URLs', () => {
        const result = validateRepositoryUrl('javascript:alert(1)');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Invalid protocol');
      });

      it('should reject data: URLs', () => {
        const result = validateRepositoryUrl('data:text/html,test');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Invalid protocol');
      });

      it('should reject file: URLs', () => {
        const result = validateRepositoryUrl('file:///etc/passwd');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Invalid protocol');
      });

      it('should reject empty URLs', () => {
        const result = validateRepositoryUrl('');
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Empty URL');
      });

      it('should reject URLs without scheme', () => {
        const result = validateRepositoryUrl('github.com/user/repo');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('No scheme');
      });
    });
  });

  describe('buildJiraTicketUrl', () => {
    it('should build valid Jira URL', () => {
      const url = buildJiraTicketUrl('https://jira.mycompany.com', 'PROJ-123');
      expect(url).toBe('https://jira.mycompany.com/browse/PROJ-123');
    });

    it('should strip trailing slash from server', () => {
      const url = buildJiraTicketUrl('https://jira.mycompany.com/', 'PROJ-123');
      expect(url).toBe('https://jira.mycompany.com/browse/PROJ-123');
    });

    it('should return null for invalid ticket ID', () => {
      const url = buildJiraTicketUrl('https://jira.mycompany.com', 'invalid');
      expect(url).toBeNull();
    });

    it('should return null for missing server', () => {
      const url = buildJiraTicketUrl('', 'PROJ-123');
      expect(url).toBeNull();
    });

    it('should return null for missing ticket ID', () => {
      const url = buildJiraTicketUrl('https://jira.mycompany.com', '');
      expect(url).toBeNull();
    });
  });

  describe('buildLinearTicketUrl', () => {
    it('should build valid Linear URL', () => {
      const url = buildLinearTicketUrl('IQS-924');
      expect(url).toBe('https://linear.app/iqs/issue/IQS-924');
    });

    it('should lowercase the team key', () => {
      const url = buildLinearTicketUrl('PROJ-123');
      expect(url).toBe('https://linear.app/proj/issue/PROJ-123');
    });

    it('should return null for invalid ticket ID', () => {
      const url = buildLinearTicketUrl('invalid');
      expect(url).toBeNull();
    });

    it('should return null for empty ticket ID', () => {
      const url = buildLinearTicketUrl('');
      expect(url).toBeNull();
    });
  });
});
