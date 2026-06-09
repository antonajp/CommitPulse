/**
 * Unit tests for velocity-chart-drill-down.ts SHA navigation and accessibility.
 * Tests URL validation, commit navigation logic, focus trap functionality,
 * provider-specific URL construction, and disabled state handling.
 *
 * Ticket: GITX-150, GITX-151, GITX-160
 */

import { describe, it, expect } from 'vitest';
import {
  generateLocDrillDownScript,
  buildProviderCommitUrl,
} from '../../views/webview/velocity-chart-drill-down.js';

describe('velocity-chart-drill-down', () => {
  describe('generateLocDrillDownScript', () => {
    it('should return a non-empty script string', () => {
      const script = generateLocDrillDownScript();
      expect(script).toBeTruthy();
      expect(typeof script).toBe('string');
    });

    it('should include locDrillDownRepoUrl variable for SHA navigation', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('locDrillDownRepoUrl');
    });

    it('should include TRUSTED_COMMIT_DOMAINS array', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('TRUSTED_COMMIT_DOMAINS');
      expect(script).toContain('github.com');
      expect(script).toContain('gitlab.com');
      expect(script).toContain('bitbucket.org');
    });

    it('should include isValidCommitUrl function for URL validation', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('function isValidCommitUrl');
      // Should check for HTTPS protocol
      expect(script).toContain("protocol !== 'https:'");
    });

    it('should include openCommitInBrowser function', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('function openCommitInBrowser');
      // Should construct commit URL using buildCommitUrl (GITX-160)
      expect(script).toContain('buildCommitUrl(locDrillDownRepoUrl, sha)');
      // Should call vscode.postMessage
      expect(script).toContain("type: 'openExternal'");
    });

    it('should handle click and keyboard events on SHA cells', () => {
      const script = generateLocDrillDownScript();
      // Should have click handler
      expect(script).toContain("tbody.addEventListener('click'");
      expect(script).toContain('openCommitInBrowser(sha)');
      // Should have keyboard handler
      expect(script).toContain("tbody.addEventListener('keydown'");
      expect(script).toContain("event.key === 'Enter'");
      expect(script).toContain("event.key === ' '");
    });

    it('should store repoUrl from drill-down response', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('locDrillDownRepoUrl = message.repoUrl');
    });

    it('should clear repoUrl when modal is closed', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('locDrillDownRepoUrl = null');
    });

    it('should validate URL before opening external link', () => {
      const script = generateLocDrillDownScript();
      // Should call isValidCommitUrl before posting message
      expect(script).toContain('if (!isValidCommitUrl(commitUrl))');
    });

    it('should URL-encode SHA in commit URL', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('encodeURIComponent(sha)');
    });

    it('should check for subdomain matches in trusted domains', () => {
      const script = generateLocDrillDownScript();
      // Should support subdomains like 'company.github.com'
      expect(script).toContain("hostname.endsWith('.' + domain)");
    });
  });

  describe('URL validation patterns in generated script', () => {
    // Since the script is embedded as a string for webview execution,
    // we test that the generated script contains proper security patterns
    // rather than attempting to execute the generated JavaScript in Node

    it('should check HTTPS protocol in validation', () => {
      const script = generateLocDrillDownScript();
      // Verify the validation checks for HTTPS
      expect(script).toContain("parsed.protocol !== 'https:'");
      expect(script).toContain('Blocked non-HTTPS commit URL');
    });

    it('should check hostname against trusted domains', () => {
      const script = generateLocDrillDownScript();
      // Verify domain validation logic
      expect(script).toContain('hostname.toLowerCase()');
      expect(script).toContain('TRUSTED_COMMIT_DOMAINS.some');
      expect(script).toContain('Blocked commit URL from untrusted domain');
    });

    it('should handle URL parsing errors gracefully', () => {
      const script = generateLocDrillDownScript();
      // Verify try-catch error handling
      expect(script).toContain('try {');
      expect(script).toContain('} catch (e) {');
      expect(script).toContain('Invalid commit URL');
    });

    it('should log blocked URLs for debugging', () => {
      const script = generateLocDrillDownScript();
      // Verify logging for security monitoring
      expect(script).toContain('console.warn');
      expect(script).toContain('console.error');
    });

    it('should guard against missing repoUrl', () => {
      const script = generateLocDrillDownScript();
      // Verify null check before constructing URL
      expect(script).toContain('if (!locDrillDownRepoUrl)');
      expect(script).toContain('Cannot open commit: no repository URL configured');
    });

    it('should guard against missing SHA', () => {
      const script = generateLocDrillDownScript();
      // Verify null check for SHA
      expect(script).toContain('if (!sha)');
      expect(script).toContain('Cannot open commit: no SHA provided');
    });

    it('should call validation before posting message', () => {
      const script = generateLocDrillDownScript();
      // Verify validation is called before opening URL
      expect(script).toContain('if (!isValidCommitUrl(commitUrl))');
      expect(script).toContain('Commit URL validation failed');
    });
  });

  describe('Focus trap for WCAG 2.1 compliance (GITX-151)', () => {
    it('should include locDrillDownPreviousFocus variable for focus restoration', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('locDrillDownPreviousFocus');
    });

    it('should include FOCUSABLE_SELECTORS for finding focusable elements', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('FOCUSABLE_SELECTORS');
      // Verify it includes common focusable element selectors
      expect(script).toContain('button:not([disabled])');
      expect(script).toContain('[tabindex]:not([tabindex="-1"])');
    });

    it('should include getFocusableElements function', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('function getFocusableElements');
      // Should filter out hidden elements
      expect(script).toContain("style.display !== 'none'");
      expect(script).toContain("style.visibility !== 'hidden'");
    });

    it('should include handleFocusTrap function', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('function handleFocusTrap');
      // Should handle Tab key
      expect(script).toContain("event.key !== 'Tab'");
      // Should handle Shift+Tab for backward navigation
      expect(script).toContain('event.shiftKey');
    });

    it('should save focused element when modal opens', () => {
      const script = generateLocDrillDownScript();
      // Verify focus is saved before modal opens
      expect(script).toContain('locDrillDownPreviousFocus = document.activeElement');
    });

    it('should restore focus when modal closes', () => {
      const script = generateLocDrillDownScript();
      // Verify focus is restored on close
      expect(script).toContain('locDrillDownPreviousFocus.focus()');
      // Should clear the stored reference
      expect(script).toContain('locDrillDownPreviousFocus = null');
    });

    it('should call handleFocusTrap on Tab key in modal', () => {
      const script = generateLocDrillDownScript();
      // Verify Tab key triggers focus trap handler
      expect(script).toContain("event.key === 'Tab'");
      expect(script).toContain('handleFocusTrap(event, modalContent)');
    });

    it('should wrap focus from last to first element on Tab', () => {
      const script = generateLocDrillDownScript();
      // Verify wrapping to first element
      expect(script).toContain('activeElement === lastFocusable');
      expect(script).toContain('firstFocusable.focus()');
    });

    it('should wrap focus from first to last element on Shift+Tab', () => {
      const script = generateLocDrillDownScript();
      // Verify wrapping to last element
      expect(script).toContain('activeElement === firstFocusable');
      expect(script).toContain('lastFocusable.focus()');
    });

    it('should prevent default when wrapping focus', () => {
      const script = generateLocDrillDownScript();
      // Verify event.preventDefault() is called when wrapping
      expect(script).toContain('event.preventDefault()');
    });

    it('should handle case when no focusable elements exist', () => {
      const script = generateLocDrillDownScript();
      // Verify handling of empty focusable elements array
      expect(script).toContain('focusableElements.length === 0');
    });

    it('should get modal content element for focus trap scope', () => {
      const script = generateLocDrillDownScript();
      // Verify the focus trap is scoped to modal content
      expect(script).toContain("modal.querySelector('.drill-down-modal-content')");
    });
  });

  // GITX-160: Provider-specific URL construction tests
  describe('Provider-specific URL construction (GITX-160)', () => {
    it('should include COMMIT_PATH_SEGMENTS object', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('COMMIT_PATH_SEGMENTS');
      expect(script).toContain('/commit/');
      expect(script).toContain('/commits/');
      expect(script).toContain('/-/commit/');
    });

    it('should include detectProvider function', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('function detectProvider');
      expect(script).toContain('bitbucket.');
      expect(script).toContain('gitlab.');
      expect(script).toContain('github.');
    });

    it('should include buildCommitUrl function', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('function buildCommitUrl');
      expect(script).toContain('detectProvider(repoUrl)');
      expect(script).toContain('COMMIT_PATH_SEGMENTS[provider]');
    });

    it('should use buildCommitUrl instead of hardcoded /commit/ path', () => {
      const script = generateLocDrillDownScript();
      // Verify openCommitInBrowser calls buildCommitUrl
      expect(script).toContain('buildCommitUrl(locDrillDownRepoUrl, sha)');
    });
  });

  // GITX-160: Disabled state and toast notification tests
  describe('Disabled state and toast notification (GITX-160)', () => {
    it('should include showDrillDownToast function', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('function showDrillDownToast');
      expect(script).toContain('drillDownToastContainer');
      expect(script).toContain('toast-visible');
    });

    it('should call toast notification when repoUrl is missing', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('showDrillDownToast(');
      expect(script).toContain('Cannot open commit: repository URL not configured');
    });

    it('should render disabled SHA cells when repoUrl is null', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('sha-cell-disabled');
      expect(script).toContain('aria-disabled="true"');
    });

    it('should not add tabindex or role to disabled SHA cells', () => {
      const script = generateLocDrillDownScript();
      // When disabled, tabindex and role should NOT be added
      expect(script).toContain('shaDisabled');
      // When enabled, tabindex and role should be added
      expect(script).toContain('tabindex="0" role="button"');
    });

    it('should show footer hint when repoUrl is not configured', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain('locDrillDownFooterHint');
      expect(script).toContain('Commit links unavailable');
      expect(script).toContain('Configure repository URL');
    });

    it('should include openSettings message for configure link', () => {
      const script = generateLocDrillDownScript();
      expect(script).toContain("type: 'openSettings'");
      expect(script).toContain('gitr.repositories');
    });
  });
});

// GITX-160: Tests for the exported buildProviderCommitUrl function
describe('buildProviderCommitUrl (GITX-160)', () => {
  describe('GitHub URLs', () => {
    it('should use /commit/ path for github.com', () => {
      const url = buildProviderCommitUrl('https://github.com/user/repo', 'abc1234');
      expect(url).toBe('https://github.com/user/repo/commit/abc1234');
    });

    it('should use /commit/ path for GitHub Enterprise', () => {
      const url = buildProviderCommitUrl('https://github.mycompany.com/org/repo', 'def5678');
      expect(url).toBe('https://github.mycompany.com/org/repo/commit/def5678');
    });

    it('should strip .git suffix', () => {
      const url = buildProviderCommitUrl('https://github.com/user/repo.git', 'abc1234');
      expect(url).toBe('https://github.com/user/repo/commit/abc1234');
    });

    it('should strip trailing slashes', () => {
      const url = buildProviderCommitUrl('https://github.com/user/repo/', 'abc1234');
      expect(url).toBe('https://github.com/user/repo/commit/abc1234');
    });
  });

  describe('Bitbucket URLs', () => {
    it('should use /commits/ path for bitbucket.org', () => {
      const url = buildProviderCommitUrl('https://bitbucket.org/user/repo', 'abc1234');
      expect(url).toBe('https://bitbucket.org/user/repo/commits/abc1234');
    });

    it('should use /commits/ path for Bitbucket Server', () => {
      const url = buildProviderCommitUrl('https://bitbucket.mycompany.com/projects/PROJ/repos/repo', 'def5678');
      expect(url).toBe('https://bitbucket.mycompany.com/projects/PROJ/repos/repo/commits/def5678');
    });
  });

  describe('GitLab URLs', () => {
    it('should use /-/commit/ path for gitlab.com', () => {
      const url = buildProviderCommitUrl('https://gitlab.com/user/repo', 'abc1234');
      expect(url).toBe('https://gitlab.com/user/repo/-/commit/abc1234');
    });

    it('should use /-/commit/ path for self-hosted GitLab', () => {
      const url = buildProviderCommitUrl('https://gitlab.mycompany.com/group/project', 'def5678');
      expect(url).toBe('https://gitlab.mycompany.com/group/project/-/commit/def5678');
    });
  });

  describe('Unknown provider URLs', () => {
    it('should default to /commit/ path for unknown domains', () => {
      const url = buildProviderCommitUrl('https://git.mycompany.com/repo', 'abc1234');
      expect(url).toBe('https://git.mycompany.com/repo/commit/abc1234');
    });

    it('should default to /commit/ path for localhost', () => {
      const url = buildProviderCommitUrl('http://localhost:3000/repo', 'abc1234');
      expect(url).toBe('http://localhost:3000/repo/commit/abc1234');
    });
  });

  describe('URL encoding', () => {
    it('should URL-encode the SHA', () => {
      const url = buildProviderCommitUrl('https://github.com/user/repo', 'abc<script>');
      expect(url).toContain('abc%3Cscript%3E');
    });
  });
});
