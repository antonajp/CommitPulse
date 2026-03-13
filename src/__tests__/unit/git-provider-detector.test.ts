/**
 * Unit tests for Git provider detection and URL building utilities.
 *
 * Tests provider detection from repository URLs and commit/PR URL generation
 * for GitHub, Bitbucket, and GitLab.
 *
 * Ticket: IQS-938
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GitProvider,
  isValidSha,
  detectGitProvider,
  getCommitPathSegment,
  getPrPathSegment,
  buildCommitUrl,
  buildPrUrl,
  buildCommitUrlForWebview,
} from '../../utils/git-provider-detector.js';

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

describe('Git Provider Detector', () => {
  describe('isValidSha', () => {
    describe('valid SHAs', () => {
      it('should accept 7-character abbreviated SHA', () => {
        expect(isValidSha('abc1234')).toBe(true);
      });

      it('should accept full 40-character SHA', () => {
        expect(isValidSha('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).toBe(true);
      });

      it('should accept uppercase hex characters', () => {
        expect(isValidSha('ABC1234')).toBe(true);
      });

      it('should accept mixed case hex characters', () => {
        expect(isValidSha('AbCdEf1234567')).toBe(true);
      });

      it('should accept 8-character SHA', () => {
        expect(isValidSha('12345678')).toBe(true);
      });
    });

    describe('invalid SHAs', () => {
      it('should reject SHA shorter than 7 characters', () => {
        expect(isValidSha('abc123')).toBe(false);
      });

      it('should reject SHA longer than 40 characters', () => {
        expect(isValidSha('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2x')).toBe(false);
      });

      it('should reject non-hex characters', () => {
        expect(isValidSha('ghijklm')).toBe(false);
      });

      it('should reject special characters', () => {
        expect(isValidSha('abc123!')).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isValidSha('')).toBe(false);
      });

      it('should reject null', () => {
        expect(isValidSha(null as unknown as string)).toBe(false);
      });

      it('should reject undefined', () => {
        expect(isValidSha(undefined as unknown as string)).toBe(false);
      });

      it('should reject SHA with spaces', () => {
        expect(isValidSha('abc 1234567')).toBe(false);
      });

      it('should reject SHA with newlines', () => {
        expect(isValidSha('abc1234\n')).toBe(false);
      });
    });
  });

  describe('detectGitProvider', () => {
    describe('GitHub detection', () => {
      it('should detect github.com', () => {
        const result = detectGitProvider('https://github.com/user/repo');
        expect(result.provider).toBe('github');
        expect(result.detected).toBe(true);
      });

      it('should detect github.com with .git suffix', () => {
        const result = detectGitProvider('https://github.com/user/repo.git');
        expect(result.provider).toBe('github');
        expect(result.detected).toBe(true);
      });

      it('should detect GitHub Enterprise (github.company.com)', () => {
        const result = detectGitProvider('https://github.mycompany.com/org/repo');
        expect(result.provider).toBe('github');
        expect(result.detected).toBe(true);
      });

      it('should detect GitHub SSH shorthand', () => {
        const result = detectGitProvider('git@github.com:user/repo.git');
        expect(result.provider).toBe('github');
        expect(result.detected).toBe(true);
      });

      it('should detect GitHub SSH URL', () => {
        const result = detectGitProvider('ssh://git@github.com/user/repo.git');
        expect(result.provider).toBe('github');
        expect(result.detected).toBe(true);
      });
    });

    describe('Bitbucket detection', () => {
      it('should detect bitbucket.org', () => {
        const result = detectGitProvider('https://bitbucket.org/user/repo');
        expect(result.provider).toBe('bitbucket');
        expect(result.detected).toBe(true);
      });

      it('should detect bitbucket.org with .git suffix', () => {
        const result = detectGitProvider('https://bitbucket.org/user/repo.git');
        expect(result.provider).toBe('bitbucket');
        expect(result.detected).toBe(true);
      });

      it('should detect Bitbucket Server (bitbucket.company.com)', () => {
        const result = detectGitProvider('https://bitbucket.mycompany.com/projects/PROJ/repos/repo');
        expect(result.provider).toBe('bitbucket');
        expect(result.detected).toBe(true);
      });

      it('should detect Bitbucket SSH shorthand', () => {
        const result = detectGitProvider('git@bitbucket.org:user/repo.git');
        expect(result.provider).toBe('bitbucket');
        expect(result.detected).toBe(true);
      });
    });

    describe('GitLab detection', () => {
      it('should detect gitlab.com', () => {
        const result = detectGitProvider('https://gitlab.com/user/repo');
        expect(result.provider).toBe('gitlab');
        expect(result.detected).toBe(true);
      });

      it('should detect gitlab.com with .git suffix', () => {
        const result = detectGitProvider('https://gitlab.com/user/repo.git');
        expect(result.provider).toBe('gitlab');
        expect(result.detected).toBe(true);
      });

      it('should detect self-hosted GitLab (gitlab.company.com)', () => {
        const result = detectGitProvider('https://gitlab.mycompany.com/group/repo');
        expect(result.provider).toBe('gitlab');
        expect(result.detected).toBe(true);
      });

      it('should detect GitLab SSH shorthand', () => {
        const result = detectGitProvider('git@gitlab.com:user/repo.git');
        expect(result.provider).toBe('gitlab');
        expect(result.detected).toBe(true);
      });
    });

    describe('Unknown provider', () => {
      it('should return unknown for arbitrary domains', () => {
        const result = detectGitProvider('https://git.mycompany.com/repo');
        expect(result.provider).toBe('unknown');
        expect(result.detected).toBe(false);
      });

      it('should return unknown for localhost', () => {
        const result = detectGitProvider('http://localhost:3000/repo');
        expect(result.provider).toBe('unknown');
        expect(result.detected).toBe(false);
      });

      it('should return unknown for IP addresses', () => {
        const result = detectGitProvider('http://192.168.1.1/repo');
        expect(result.provider).toBe('unknown');
        expect(result.detected).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should handle empty string', () => {
        const result = detectGitProvider('');
        expect(result.provider).toBe('unknown');
        expect(result.detected).toBe(false);
      });

      it('should handle null', () => {
        const result = detectGitProvider(null as unknown as string);
        expect(result.provider).toBe('unknown');
        expect(result.detected).toBe(false);
      });

      it('should handle undefined', () => {
        const result = detectGitProvider(undefined as unknown as string);
        expect(result.provider).toBe('unknown');
        expect(result.detected).toBe(false);
      });

      it('should handle URL with port', () => {
        const result = detectGitProvider('https://github.com:443/user/repo');
        expect(result.provider).toBe('github');
        expect(result.detected).toBe(true);
      });

      it('should handle http URLs', () => {
        const result = detectGitProvider('http://github.com/user/repo');
        expect(result.provider).toBe('github');
        expect(result.detected).toBe(true);
      });

      it('should handle git:// protocol', () => {
        const result = detectGitProvider('git://github.com/user/repo');
        expect(result.provider).toBe('github');
        expect(result.detected).toBe(true);
      });
    });
  });

  describe('getCommitPathSegment', () => {
    it('should return /commit/ for github', () => {
      expect(getCommitPathSegment('github')).toBe('/commit/');
    });

    it('should return /commits/ for bitbucket', () => {
      expect(getCommitPathSegment('bitbucket')).toBe('/commits/');
    });

    it('should return /-/commit/ for gitlab', () => {
      expect(getCommitPathSegment('gitlab')).toBe('/-/commit/');
    });

    it('should return /commit/ for unknown (default to GitHub pattern)', () => {
      expect(getCommitPathSegment('unknown')).toBe('/commit/');
    });
  });

  describe('getPrPathSegment', () => {
    it('should return /pull/ for github', () => {
      expect(getPrPathSegment('github')).toBe('/pull/');
    });

    it('should return /pull-requests/ for bitbucket', () => {
      expect(getPrPathSegment('bitbucket')).toBe('/pull-requests/');
    });

    it('should return /-/merge_requests/ for gitlab', () => {
      expect(getPrPathSegment('gitlab')).toBe('/-/merge_requests/');
    });

    it('should return /pull/ for unknown (default to GitHub pattern)', () => {
      expect(getPrPathSegment('unknown')).toBe('/pull/');
    });
  });

  describe('buildCommitUrl', () => {
    describe('GitHub URLs', () => {
      it('should build GitHub commit URL', () => {
        const result = buildCommitUrl('https://github.com/user/repo', 'abc1234def5678');
        expect(result.url).toBe('https://github.com/user/repo/commit/abc1234def5678');
        expect(result.error).toBeUndefined();
      });

      it('should strip .git suffix from repo URL', () => {
        const result = buildCommitUrl('https://github.com/user/repo.git', 'abc1234');
        expect(result.url).toBe('https://github.com/user/repo/commit/abc1234');
      });

      it('should strip trailing slashes from repo URL', () => {
        const result = buildCommitUrl('https://github.com/user/repo/', 'abc1234');
        expect(result.url).toBe('https://github.com/user/repo/commit/abc1234');
      });
    });

    describe('Bitbucket URLs', () => {
      it('should build Bitbucket Cloud commit URL', () => {
        const result = buildCommitUrl('https://bitbucket.org/user/repo', 'abc1234def5678');
        expect(result.url).toBe('https://bitbucket.org/user/repo/commits/abc1234def5678');
      });

      it('should build Bitbucket Server commit URL', () => {
        const result = buildCommitUrl('https://bitbucket.mycompany.com/projects/PROJ/repos/repo', 'abc1234');
        expect(result.url).toBe('https://bitbucket.mycompany.com/projects/PROJ/repos/repo/commits/abc1234');
      });
    });

    describe('GitLab URLs', () => {
      it('should build GitLab commit URL', () => {
        const result = buildCommitUrl('https://gitlab.com/user/repo', 'abc1234def5678');
        expect(result.url).toBe('https://gitlab.com/user/repo/-/commit/abc1234def5678');
      });

      it('should build self-hosted GitLab commit URL', () => {
        const result = buildCommitUrl('https://gitlab.mycompany.com/group/repo', 'abc1234');
        expect(result.url).toBe('https://gitlab.mycompany.com/group/repo/-/commit/abc1234');
      });
    });

    describe('Unknown provider (default to GitHub pattern)', () => {
      it('should use GitHub pattern for unknown domains', () => {
        const result = buildCommitUrl('https://git.mycompany.com/repo', 'abc1234');
        expect(result.url).toBe('https://git.mycompany.com/repo/commit/abc1234');
      });
    });

    describe('With explicit provider', () => {
      it('should use provided provider instead of detecting', () => {
        const result = buildCommitUrl('https://example.com/repo', 'abc1234', 'bitbucket');
        expect(result.url).toBe('https://example.com/repo/commits/abc1234');
      });

      it('should override detection with provided provider', () => {
        const result = buildCommitUrl('https://github.com/repo', 'abc1234', 'gitlab');
        expect(result.url).toBe('https://github.com/repo/-/commit/abc1234');
      });
    });

    describe('Error handling', () => {
      it('should return error for empty repoUrl', () => {
        const result = buildCommitUrl('', 'abc1234');
        expect(result.url).toBeNull();
        expect(result.error).toBe('Missing repository URL');
      });

      it('should return error for null repoUrl', () => {
        const result = buildCommitUrl(null as unknown as string, 'abc1234');
        expect(result.url).toBeNull();
        expect(result.error).toBe('Missing repository URL');
      });

      it('should return error for empty SHA', () => {
        const result = buildCommitUrl('https://github.com/repo', '');
        expect(result.url).toBeNull();
        expect(result.error).toBe('Missing commit SHA');
      });

      it('should return error for null SHA', () => {
        const result = buildCommitUrl('https://github.com/repo', null as unknown as string);
        expect(result.url).toBeNull();
        expect(result.error).toBe('Missing commit SHA');
      });

      it('should return error for invalid SHA format (too short)', () => {
        const result = buildCommitUrl('https://github.com/repo', 'abc');
        expect(result.url).toBeNull();
        expect(result.error).toContain('Invalid SHA format');
      });

      it('should return error for invalid SHA format (non-hex)', () => {
        const result = buildCommitUrl('https://github.com/repo', 'ghijklmnop');
        expect(result.url).toBeNull();
        expect(result.error).toContain('Invalid SHA format');
      });

      it('should return error for SHA with special characters (security)', () => {
        const result = buildCommitUrl('https://github.com/repo', 'abc<script>');
        expect(result.url).toBeNull();
        expect(result.error).toContain('Invalid SHA format');
      });
    });
  });

  describe('buildPrUrl', () => {
    describe('GitHub URLs', () => {
      it('should build GitHub PR URL', () => {
        const result = buildPrUrl('https://github.com/user/repo', 123);
        expect(result.url).toBe('https://github.com/user/repo/pull/123');
      });

      it('should accept string PR number', () => {
        const result = buildPrUrl('https://github.com/user/repo', '456');
        expect(result.url).toBe('https://github.com/user/repo/pull/456');
      });
    });

    describe('Bitbucket URLs', () => {
      it('should build Bitbucket PR URL', () => {
        const result = buildPrUrl('https://bitbucket.org/user/repo', 123);
        expect(result.url).toBe('https://bitbucket.org/user/repo/pull-requests/123');
      });
    });

    describe('GitLab URLs', () => {
      it('should build GitLab MR URL', () => {
        const result = buildPrUrl('https://gitlab.com/user/repo', 123);
        expect(result.url).toBe('https://gitlab.com/user/repo/-/merge_requests/123');
      });
    });

    describe('Error handling', () => {
      it('should return error for empty repoUrl', () => {
        const result = buildPrUrl('', 123);
        expect(result.url).toBeNull();
        expect(result.error).toBe('Missing repository URL');
      });

      it('should return error for invalid PR number (0)', () => {
        const result = buildPrUrl('https://github.com/repo', 0);
        expect(result.url).toBeNull();
        expect(result.error).toBe('Invalid PR number');
      });

      it('should return error for invalid PR number (negative)', () => {
        const result = buildPrUrl('https://github.com/repo', -1);
        expect(result.url).toBeNull();
        expect(result.error).toBe('Invalid PR number');
      });

      it('should return error for invalid PR number (NaN)', () => {
        const result = buildPrUrl('https://github.com/repo', 'abc');
        expect(result.url).toBeNull();
        expect(result.error).toBe('Invalid PR number');
      });
    });
  });

  describe('buildCommitUrlForWebview', () => {
    it('should build commit URL for valid inputs', () => {
      const url = buildCommitUrlForWebview('https://github.com/user/repo', 'abc1234');
      expect(url).toBe('https://github.com/user/repo/commit/abc1234');
    });

    it('should return null for null repoUrl', () => {
      const url = buildCommitUrlForWebview(null, 'abc1234');
      expect(url).toBeNull();
    });

    it('should return null for undefined repoUrl', () => {
      const url = buildCommitUrlForWebview(undefined, 'abc1234');
      expect(url).toBeNull();
    });

    it('should return null for null sha', () => {
      const url = buildCommitUrlForWebview('https://github.com/user/repo', null);
      expect(url).toBeNull();
    });

    it('should return null for undefined sha', () => {
      const url = buildCommitUrlForWebview('https://github.com/user/repo', undefined);
      expect(url).toBeNull();
    });

    it('should return null for invalid SHA format', () => {
      const url = buildCommitUrlForWebview('https://github.com/user/repo', 'invalid');
      expect(url).toBeNull();
    });

    it('should handle Bitbucket URLs', () => {
      const url = buildCommitUrlForWebview('https://bitbucket.org/user/repo', 'abc1234');
      expect(url).toBe('https://bitbucket.org/user/repo/commits/abc1234');
    });

    it('should handle GitLab URLs', () => {
      const url = buildCommitUrlForWebview('https://gitlab.com/user/repo', 'abc1234');
      expect(url).toBe('https://gitlab.com/user/repo/-/commit/abc1234');
    });
  });

  describe('Acceptance Criteria Coverage', () => {
    // AC-1: GitHub commit URLs use /commit/{sha} format
    it('AC-1: GitHub commit URLs use /commit/{sha} format', () => {
      const result = buildCommitUrl('https://github.com/org/repo', 'a1b2c3d');
      expect(result.url).toBe('https://github.com/org/repo/commit/a1b2c3d');
    });

    // AC-2: Bitbucket Cloud URLs use /commits/{sha} format (plural)
    it('AC-2: Bitbucket Cloud URLs use /commits/{sha} format (plural)', () => {
      const result = buildCommitUrl('https://bitbucket.org/org/repo', 'a1b2c3d');
      expect(result.url).toBe('https://bitbucket.org/org/repo/commits/a1b2c3d');
    });

    // AC-3: Bitbucket Server URLs use /commits/{sha} format
    it('AC-3: Bitbucket Server URLs use /commits/{sha} format', () => {
      const result = buildCommitUrl('https://bitbucket.mycompany.com/projects/PROJ/repos/repo', 'a1b2c3d');
      expect(result.url).toBe('https://bitbucket.mycompany.com/projects/PROJ/repos/repo/commits/a1b2c3d');
    });

    // AC-4: GitLab URLs use /-/commit/{sha} format
    it('AC-4: GitLab URLs use /-/commit/{sha} format', () => {
      const result = buildCommitUrl('https://gitlab.com/org/repo', 'a1b2c3d');
      expect(result.url).toBe('https://gitlab.com/org/repo/-/commit/a1b2c3d');
    });

    // AC-5: Auto-detection works from repoUrl domain
    it('AC-5: Auto-detection works from repoUrl domain (github.com)', () => {
      expect(detectGitProvider('https://github.com/repo').provider).toBe('github');
    });

    it('AC-5: Auto-detection works from repoUrl domain (bitbucket.org)', () => {
      expect(detectGitProvider('https://bitbucket.org/repo').provider).toBe('bitbucket');
    });

    it('AC-5: Auto-detection works from repoUrl domain (gitlab.com)', () => {
      expect(detectGitProvider('https://gitlab.com/repo').provider).toBe('gitlab');
    });

    // AC-6: Unknown domains default to GitHub format
    it('AC-6: Unknown domains default to GitHub format', () => {
      const result = buildCommitUrl('https://unknown.example.com/repo', 'a1b2c3d');
      expect(result.url).toBe('https://unknown.example.com/repo/commit/a1b2c3d');
    });

    // AC-7: Missing repoUrl gracefully degrades
    it('AC-7: Missing repoUrl gracefully degrades (returns null, no errors)', () => {
      const result = buildCommitUrl('', 'a1b2c3d');
      expect(result.url).toBeNull();
      expect(result.error).toBe('Missing repository URL');
    });

    it('AC-7: Null repoUrl gracefully degrades', () => {
      const result = buildCommitUrl(null as unknown as string, 'a1b2c3d');
      expect(result.url).toBeNull();
    });

    // AC-8: SHA validated as hex string (7-40 chars)
    it('AC-8: SHA validated - accepts 7 chars', () => {
      expect(isValidSha('1234567')).toBe(true);
    });

    it('AC-8: SHA validated - accepts 40 chars', () => {
      expect(isValidSha('1234567890abcdef1234567890abcdef12345678')).toBe(true);
    });

    it('AC-8: SHA validated - rejects 6 chars', () => {
      expect(isValidSha('123456')).toBe(false);
    });

    it('AC-8: SHA validated - rejects 41 chars', () => {
      expect(isValidSha('1234567890abcdef1234567890abcdef123456789')).toBe(false);
    });

    it('AC-8: SHA validated - rejects non-hex', () => {
      expect(isValidSha('ghijklm')).toBe(false);
    });

    // AC-9: Existing GitHub functionality not regressed
    it('AC-9: GitHub commit URL format unchanged', () => {
      const result = buildCommitUrl('https://github.com/user/repo', 'abc1234def5678');
      expect(result.url).toBe('https://github.com/user/repo/commit/abc1234def5678');
    });

    // AC-10: Unit tests with 100% coverage is validated by running all tests above
  });
});
