import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { generateDevProfileHtml, type DevProfileHtmlConfig } from '../../views/webview/dev-profile-html.js';
import { generateVelocityChartScript } from '../../views/webview/dev-profile-velocity-chart.js';
import { generateGitx156HtmlSections } from '../../views/webview/dev-profile-html-sections.js';

/**
 * Unit tests for Developer Profile HTML generation (GITX-161).
 * Tests for CSP compliance and JavaScript variable declarations.
 */
describe('dev-profile-html', () => {
  const mockConfig: DevProfileHtmlConfig = {
    nonce: 'test-nonce-12345',
    d3Uri: { toString: () => 'https://example.com/d3.min.js' } as any,
    styleUri: { toString: () => 'https://example.com/dev-profile.css' } as any,
    cspSource: 'https://example.com',
  };

  describe('generateDevProfileHtml', () => {
    it('should generate valid HTML document', () => {
      const html = generateDevProfileHtml(mockConfig);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include CSP meta tag with nonce', () => {
      const html = generateDevProfileHtml(mockConfig);
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain(`'nonce-${mockConfig.nonce}'`);
    });

    it('should use script tags with nonce attribute', () => {
      const html = generateDevProfileHtml(mockConfig);
      const scriptTagPattern = new RegExp(`<script nonce="${mockConfig.nonce}"`, 'g');
      const matches = html.match(scriptTagPattern);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });

    it('should NOT have inline style="display:none;" attributes (CSP violation) (GITX-161)', () => {
      const html = generateDevProfileHtml(mockConfig);
      // Inline styles in HTML attributes violate CSP
      expect(html).not.toContain('style="display:none;"');
      expect(html).not.toContain("style='display:none;'");
    });

    it('should use hidden CSS class instead of inline display:none style (GITX-161)', () => {
      const html = generateDevProfileHtml(mockConfig);
      // Elements should use the .hidden CSS class (either alone or combined with other classes)
      // Pattern matches: class="hidden", class="foo hidden", class="hidden bar", class="foo hidden bar"
      expect(html).toMatch(/class="[^"]*\bhidden\b[^"]*"/);
    });

    it('should NOT have duplicate HTML class attributes (GITX-161)', () => {
      const html = generateDevProfileHtml(mockConfig);
      // Duplicate class attributes are invalid HTML: class="foo" class="bar"
      const duplicateClassPattern = /class="[^"]*"\s+[^>]*class="/g;
      const matches = html.match(duplicateClassPattern);
      expect(matches).toBeNull();
    });

    it('should NOT have duplicate cachedVelocityData variable declaration (GITX-161)', () => {
      const html = generateDevProfileHtml(mockConfig);
      // Count declarations of cachedVelocityData
      // Should only have one "let cachedVelocityData" or one "var cachedVelocityData"
      const letMatches = html.match(/let\s+cachedVelocityData\s*=/g) || [];
      const varMatches = html.match(/var\s+cachedVelocityData\s*=/g) || [];
      const totalDeclarations = letMatches.length + varMatches.length;

      expect(totalDeclarations).toBe(1);
    });

    it('should NOT have duplicate velocityDataAvailable variable declaration (GITX-161)', () => {
      const html = generateDevProfileHtml(mockConfig);
      const letMatches = html.match(/let\s+velocityDataAvailable\s*=/g) || [];
      const varMatches = html.match(/var\s+velocityDataAvailable\s*=/g) || [];
      const totalDeclarations = letMatches.length + varMatches.length;

      expect(totalDeclarations).toBe(1);
    });

    it('should declare state variables only once in the IIFE', () => {
      const html = generateDevProfileHtml(mockConfig);
      // State variables should be declared once
      const stateVars = [
        'currentDeveloper',
        'currentTimeframe',
        'cachedDevelopers',
        'cachedLocData',
        'cachedVelocityData',
        'velocityDataAvailable',
      ];

      for (const varName of stateVars) {
        const letMatches = html.match(new RegExp(`let\\s+${varName}\\s*=`, 'g')) || [];
        const varMatches = html.match(new RegExp(`var\\s+${varName}\\s*=`, 'g')) || [];
        const constMatches = html.match(new RegExp(`const\\s+${varName}\\s*=`, 'g')) || [];
        const totalDeclarations = letMatches.length + varMatches.length + constMatches.length;

        expect(totalDeclarations).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('generateVelocityChartScript', () => {
    it('should NOT declare cachedVelocityData (declared in parent scope) (GITX-161)', () => {
      const script = generateVelocityChartScript();
      // The variable should NOT be declared in this function anymore
      expect(script).not.toMatch(/var\s+cachedVelocityData\s*=/);
      expect(script).not.toMatch(/let\s+cachedVelocityData\s*=/);
      expect(script).not.toMatch(/const\s+cachedVelocityData\s*=/);
    });

    it('should NOT declare velocityDataAvailable (declared in parent scope) (GITX-161)', () => {
      const script = generateVelocityChartScript();
      expect(script).not.toMatch(/var\s+velocityDataAvailable\s*=/);
      expect(script).not.toMatch(/let\s+velocityDataAvailable\s*=/);
      expect(script).not.toMatch(/const\s+velocityDataAvailable\s*=/);
    });

    it('should contain a comment explaining variable scope (GITX-161)', () => {
      const script = generateVelocityChartScript();
      // Should have a comment explaining that variables are in parent scope
      expect(script).toContain('parent scope');
      expect(script).toContain('GITX-161');
    });

    it('should define renderVelocityChart function', () => {
      const script = generateVelocityChartScript();
      expect(script).toContain('function renderVelocityChart(');
    });

    it('should reference cachedVelocityData without declaring it', () => {
      const script = generateVelocityChartScript();
      // Should use the variable (assignment without declaration)
      expect(script).toContain('cachedVelocityData = data');
    });
  });

  describe('generateGitx156HtmlSections', () => {
    it('should NOT have inline style="display:none;" attributes (GITX-161)', () => {
      const html = generateGitx156HtmlSections();
      expect(html).not.toContain('style="display:none;"');
    });

    it('should use hidden CSS class for initially hidden elements', () => {
      const html = generateGitx156HtmlSections();
      expect(html).toMatch(/class="[^"]*hidden[^"]*"/);
    });

    it('should NOT have duplicate class attributes', () => {
      const html = generateGitx156HtmlSections();
      const duplicateClassPattern = /class="[^"]*"\s+class="/g;
      const matches = html.match(duplicateClassPattern);
      expect(matches).toBeNull();
    });
  });
});
