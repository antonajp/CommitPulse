/**
 * Unit tests for URL builder utility.
 *
 * Tests secure URL construction for Jira and Linear issues including:
 * - Issue key format validation
 * - URL prefix validation (scheme, hostname)
 * - URL building with prefixes and fallbacks
 * - Security edge cases (XSS, injection)
 *
 * Ticket: IQS-926
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isSafeIssueKey,
  isValidUrlPrefix,
  buildJiraIssueUrl,
  buildLinearIssueUrl,
  buildIssueUrl,
} from '../../utils/url-builder.js';

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

describe('URL Builder', () => {
  describe('isSafeIssueKey', () => {
    describe('Valid issue keys', () => {
      it('should accept standard format PROJ-123', () => {
        expect(isSafeIssueKey('PROJ-123')).toBe(true);
      });

      it('should accept single letter project key A-1', () => {
        expect(isSafeIssueKey('A-1')).toBe(true);
      });

      it('should accept long project keys up to 20 chars', () => {
        expect(isSafeIssueKey('ABCDEFGHIJKLMNOPQRST-123')).toBe(true);
      });

      it('should accept alphanumeric project keys', () => {
        expect(isSafeIssueKey('IQS926-456')).toBe(true);
      });

      it('should accept common formats IQS-926, JIRA-1', () => {
        expect(isSafeIssueKey('IQS-926')).toBe(true);
        expect(isSafeIssueKey('JIRA-1')).toBe(true);
      });

      it('should accept issue numbers up to 10 digits', () => {
        expect(isSafeIssueKey('PROJ-1234567890')).toBe(true);
      });
    });

    describe('Invalid issue keys', () => {
      it('should reject lowercase project keys', () => {
        expect(isSafeIssueKey('proj-123')).toBe(false);
      });

      it('should reject mixed case project keys', () => {
        expect(isSafeIssueKey('Proj-123')).toBe(false);
      });

      it('should reject missing hyphen', () => {
        expect(isSafeIssueKey('PROJ123')).toBe(false);
      });

      it('should reject missing issue number', () => {
        expect(isSafeIssueKey('PROJ-')).toBe(false);
      });

      it('should reject project key starting with number', () => {
        expect(isSafeIssueKey('1PROJ-123')).toBe(false);
      });

      it('should reject project key longer than 20 chars', () => {
        expect(isSafeIssueKey('ABCDEFGHIJKLMNOPQRSTU-123')).toBe(false);
      });

      it('should reject issue number longer than 10 digits', () => {
        expect(isSafeIssueKey('PROJ-12345678901')).toBe(false);
      });

      it('should reject special characters (XSS)', () => {
        expect(isSafeIssueKey('PROJ<script>-123')).toBe(false);
        expect(isSafeIssueKey('PROJ-123<script>')).toBe(false);
        expect(isSafeIssueKey("PROJ-123'")).toBe(false);
        expect(isSafeIssueKey('PROJ-123"')).toBe(false);
      });

      it('should reject spaces', () => {
        expect(isSafeIssueKey('PROJ - 123')).toBe(false);
        expect(isSafeIssueKey(' PROJ-123')).toBe(false);
        expect(isSafeIssueKey('PROJ-123 ')).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isSafeIssueKey('')).toBe(false);
      });

      it('should reject null', () => {
        expect(isSafeIssueKey(null as unknown as string)).toBe(false);
      });

      it('should reject undefined', () => {
        expect(isSafeIssueKey(undefined as unknown as string)).toBe(false);
      });

      it('should reject non-string types', () => {
        expect(isSafeIssueKey(123 as unknown as string)).toBe(false);
        expect(isSafeIssueKey({} as unknown as string)).toBe(false);
      });
    });
  });

  describe('isValidUrlPrefix', () => {
    describe('Valid URL prefixes', () => {
      it('should accept https URLs', () => {
        expect(isValidUrlPrefix('https://jira.company.com')).toBe(true);
      });

      it('should accept http URLs', () => {
        expect(isValidUrlPrefix('http://jira.company.com')).toBe(true);
      });

      it('should accept URLs with ports', () => {
        expect(isValidUrlPrefix('https://jira.company.com:8443')).toBe(true);
      });

      it('should accept URLs with paths', () => {
        expect(isValidUrlPrefix('https://jira.company.com/jira')).toBe(true);
      });

      it('should accept URLs with trailing slash', () => {
        expect(isValidUrlPrefix('https://jira.company.com/')).toBe(true);
      });
    });

    describe('Invalid URL prefixes', () => {
      it('should reject javascript: URLs', () => {
        expect(isValidUrlPrefix('javascript:alert(1)')).toBe(false);
      });

      it('should reject data: URLs', () => {
        expect(isValidUrlPrefix('data:text/html,<script>alert(1)</script>')).toBe(false);
      });

      it('should reject file: URLs', () => {
        expect(isValidUrlPrefix('file:///etc/passwd')).toBe(false);
      });

      it('should reject ftp: URLs', () => {
        expect(isValidUrlPrefix('ftp://server.com/file')).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isValidUrlPrefix('')).toBe(false);
      });

      it('should reject whitespace-only string', () => {
        expect(isValidUrlPrefix('   ')).toBe(false);
      });

      it('should reject null', () => {
        expect(isValidUrlPrefix(null as unknown as string)).toBe(false);
      });

      it('should reject undefined', () => {
        expect(isValidUrlPrefix(undefined as unknown as string)).toBe(false);
      });

      it('should reject invalid URL format', () => {
        expect(isValidUrlPrefix('not-a-url')).toBe(false);
      });

      it('should reject URL without hostname', () => {
        expect(isValidUrlPrefix('https://')).toBe(false);
      });
    });
  });

  describe('buildJiraIssueUrl', () => {
    describe('With URL prefix', () => {
      it('should build valid Jira URL with prefix', () => {
        const result = buildJiraIssueUrl('https://jira.company.com', '', 'PROJ-123');
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://jira.company.com/browse/PROJ-123');
      });

      it('should strip trailing slash from prefix', () => {
        const result = buildJiraIssueUrl('https://jira.company.com/', '', 'PROJ-123');
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://jira.company.com/browse/PROJ-123');
      });

      it('should URL-encode the issue key', () => {
        // Even though IQS-926 is safe, it still gets encoded for defense in depth
        const result = buildJiraIssueUrl('https://jira.company.com', '', 'IQS-926');
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://jira.company.com/browse/IQS-926');
      });

      it('should handle prefix with context path', () => {
        const result = buildJiraIssueUrl('https://jira.company.com/jira', '', 'PROJ-123');
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://jira.company.com/jira/browse/PROJ-123');
      });
    });

    describe('With fallback to server', () => {
      it('should use server when prefix is empty', () => {
        const result = buildJiraIssueUrl('', 'https://jira.company.com', 'PROJ-123');
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://jira.company.com/browse/PROJ-123');
      });

      it('should prefer prefix over server', () => {
        const result = buildJiraIssueUrl(
          'https://new-jira.company.com',
          'https://old-jira.company.com',
          'PROJ-123',
        );
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://new-jira.company.com/browse/PROJ-123');
      });
    });

    describe('Error cases', () => {
      it('should fail for invalid issue key', () => {
        const result = buildJiraIssueUrl('https://jira.company.com', '', 'invalid');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Invalid issue key format');
      });

      it('should fail when neither prefix nor server is configured', () => {
        const result = buildJiraIssueUrl('', '', 'PROJ-123');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Jira URL not configured');
        expect(result.notConfigured).toBe(true);
      });

      it('should fail for invalid URL prefix', () => {
        const result = buildJiraIssueUrl('javascript:alert(1)', '', 'PROJ-123');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Invalid URL prefix');
      });
    });
  });

  describe('buildLinearIssueUrl', () => {
    describe('With URL prefix', () => {
      it('should build valid Linear URL with prefix', () => {
        const result = buildLinearIssueUrl('https://linear.company.com', 'IQS-926');
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://linear.company.com/issue/IQS-926');
      });

      it('should strip trailing slash from prefix', () => {
        const result = buildLinearIssueUrl('https://linear.company.com/', 'IQS-926');
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://linear.company.com/issue/IQS-926');
      });
    });

    describe('With fallback to default pattern', () => {
      it('should use default linear.app pattern when prefix is empty', () => {
        const result = buildLinearIssueUrl('', 'IQS-926');
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://linear.app/iqs/issue/IQS-926');
      });

      it('should lowercase the team key in default pattern', () => {
        const result = buildLinearIssueUrl('', 'PROJ-123');
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://linear.app/proj/issue/PROJ-123');
      });

      it('should handle long team keys', () => {
        const result = buildLinearIssueUrl('', 'LONGTEAMNAME-999');
        expect(result.success).toBe(true);
        expect(result.url).toBe('https://linear.app/longteamname/issue/LONGTEAMNAME-999');
      });
    });

    describe('Error cases', () => {
      it('should fail for invalid issue key', () => {
        const result = buildLinearIssueUrl('', 'invalid');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Invalid issue key format');
      });

      it('should fail for invalid URL prefix', () => {
        const result = buildLinearIssueUrl('javascript:alert(1)', 'IQS-926');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('Invalid URL prefix');
      });
    });
  });

  describe('buildIssueUrl', () => {
    const jiraPrefix = 'https://jira.company.com';
    const jiraServer = 'https://old-jira.company.com';
    const linearPrefix = 'https://linear.company.com';

    describe('Jira routing', () => {
      it('should route jira type to buildJiraIssueUrl', () => {
        const result = buildIssueUrl('jira', 'PROJ-123', jiraPrefix, jiraServer, linearPrefix);
        expect(result.success).toBe(true);
        expect(result.url).toContain('jira.company.com');
        expect(result.url).toContain('/browse/');
      });

      it('should be case-insensitive for Jira type', () => {
        const result = buildIssueUrl('Jira', 'PROJ-123', jiraPrefix, jiraServer, linearPrefix);
        expect(result.success).toBe(true);
        expect(result.url).toContain('/browse/');
      });

      it('should handle JIRA uppercase', () => {
        const result = buildIssueUrl('JIRA', 'PROJ-123', jiraPrefix, jiraServer, linearPrefix);
        expect(result.success).toBe(true);
      });
    });

    describe('Linear routing', () => {
      it('should route linear type to buildLinearIssueUrl', () => {
        const result = buildIssueUrl('linear', 'IQS-926', jiraPrefix, jiraServer, linearPrefix);
        expect(result.success).toBe(true);
        expect(result.url).toContain('linear.company.com');
        expect(result.url).toContain('/issue/');
      });

      it('should be case-insensitive for Linear type', () => {
        const result = buildIssueUrl('Linear', 'IQS-926', jiraPrefix, jiraServer, linearPrefix);
        expect(result.success).toBe(true);
        expect(result.url).toContain('/issue/');
      });
    });

    describe('Unknown ticket types', () => {
      it('should fail for unknown ticket type', () => {
        const result = buildIssueUrl('github', 'PROJ-123', jiraPrefix, jiraServer, linearPrefix);
        expect(result.success).toBe(false);
        expect(result.reason).toContain('Unknown tracker type');
      });

      it('should fail for empty ticket type', () => {
        const result = buildIssueUrl('', 'PROJ-123', jiraPrefix, jiraServer, linearPrefix);
        expect(result.success).toBe(false);
        expect(result.reason).toContain('Unknown tracker type');
      });

      it('should fail for null ticket type', () => {
        const result = buildIssueUrl(null as unknown as string, 'PROJ-123', jiraPrefix, jiraServer, linearPrefix);
        expect(result.success).toBe(false);
      });
    });
  });
});
