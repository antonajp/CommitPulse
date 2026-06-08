/**
 * Unit tests for velocity-chart-drill-down.ts SHA navigation and accessibility.
 * Tests URL validation, commit navigation logic, and focus trap functionality.
 *
 * Ticket: GITX-150, GITX-151
 */

import { describe, it, expect } from 'vitest';
import { generateLocDrillDownScript } from '../../views/webview/velocity-chart-drill-down.js';

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
      // Should construct commit URL
      expect(script).toContain('/commit/');
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
});
