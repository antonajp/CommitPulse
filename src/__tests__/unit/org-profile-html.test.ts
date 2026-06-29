import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { generateOrgProfileHtml } from '../../views/webview/org-profile-html.js';

/**
 * Unit tests for generateOrgProfileHtml (GITX-206).
 * Tests HTML generation with KPI cards, skeleton states, and accessibility.
 */
describe('generateOrgProfileHtml', () => {
  let mockConfig: {
    nonce: string;
    d3Uri: vscode.Uri;
    styleUri: vscode.Uri;
    cspSource: string;
  };

  beforeEach(() => {
    _clearMocks();
    mockConfig = {
      nonce: 'test-nonce-12345',
      d3Uri: vscode.Uri.parse('vscode-resource://test/media/d3.min.js'),
      styleUri: vscode.Uri.parse('vscode-resource://test/media/dev-profile.css'),
      cspSource: 'vscode-resource:',
    };
  });

  afterEach(() => {
    _clearMocks();
  });

  describe('basic HTML structure', () => {
    it('should generate valid HTML document', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include CSP nonce in script tags', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain(`nonce="${mockConfig.nonce}"`);
    });

    it('should include Content-Security-Policy meta tag', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(html).toContain(`script-src 'nonce-${mockConfig.nonce}'`);
    });

    it('should include D3.js script reference', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain(mockConfig.d3Uri.toString());
    });

    it('should include stylesheet reference', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain(mockConfig.styleUri.toString());
    });
  });

  describe('GITX-206: Organization Profile KPI cards', () => {
    it('should include Organization selector dropdown', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="orgSelect"');
      expect(html).toContain('Select an organization');
    });

    it('should include Date range selector with all timeframe options', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="timeframeSelect"');
      expect(html).toContain('value="30"');
      expect(html).toContain('value="60"');
      expect(html).toContain('value="90"');
      expect(html).toContain('value="180"');
      expect(html).toContain('value="365"');
      expect(html).toContain('value="730"');
    });

    it('should include Total Teams KPI card', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="summaryTeams"');
      expect(html).toContain('id="summaryTeamsValue"');
      expect(html).toContain('Total Teams');
    });

    it('should include Total Contributors KPI card', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="summaryContributors"');
      expect(html).toContain('id="summaryContributorsValue"');
      expect(html).toContain('Total Contributors');
    });

    it('should include Total Commits KPI card', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="summaryCommits"');
      expect(html).toContain('id="summaryCommitsValue"');
      expect(html).toContain('Total Commits');
    });

    it('should include Total LOC KPI card', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="summaryLoc"');
      expect(html).toContain('id="summaryLocValue"');
      expect(html).toContain('Total LOC');
    });

    it('should include Avg Complexity KPI card', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="summaryComplexity"');
      expect(html).toContain('id="summaryComplexityValue"');
      expect(html).toContain('Avg Complexity');
    });

    it('should include Avg LOC/Period KPI card with dynamic label', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="summaryAvgLoc"');
      expect(html).toContain('id="summaryAvgLocLabel"');
      expect(html).toContain('id="summaryAvgLocValue"');
      expect(html).toContain('Avg LOC/Week');
    });

    it('should include Avg SP/Period KPI card with dynamic label', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="summaryAvgSp"');
      expect(html).toContain('id="summaryAvgSpLabel"');
      expect(html).toContain('id="summaryAvgSpValue"');
      expect(html).toContain('Avg SP/Week');
    });

    it('should include Repositories KPI card', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="summaryRepos"');
      expect(html).toContain('id="summaryReposValue"');
      expect(html).toContain('Repositories');
    });

    it('should include 8 summary cards total', () => {
      const html = generateOrgProfileHtml(mockConfig);

      // Count the number of summary-card divs
      const matches = html.match(/class="summary-card"/g);
      expect(matches?.length).toBe(8);
    });
  });

  describe('loading skeleton states', () => {
    it('should include skeleton elements for all KPI cards', () => {
      const html = generateOrgProfileHtml(mockConfig);

      // Each KPI card should have a skeleton
      const skeletonMatches = html.match(/class="summary-card-skeleton"/g);
      expect(skeletonMatches?.length).toBe(8);
    });

    it('should have showSummarySkeleton function', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('function showSummarySkeleton()');
    });

    it('should have hideSummarySkeleton function', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('function hideSummarySkeleton()');
    });
  });

  describe('accessibility', () => {
    it('should include aria-label for summary cards section', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('aria-label="Organization Summary Statistics"');
    });

    it('should include aria-label for organization selector', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('aria-label="Select organization"');
    });

    it('should include aria-label for timeframe selector', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('aria-label="Select timeframe"');
    });

    it('should include aria-live for empty state', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="emptyState"');
      expect(html).toContain('aria-live="polite"');
    });

    it('should include role="alert" for error banner', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="errorBanner"');
      expect(html).toContain('role="alert"');
    });
  });

  describe('GITX-206: Aggregation period label adaptation', () => {
    it('should have JavaScript to update period labels dynamically', () => {
      const html = generateOrgProfileHtml(mockConfig);

      // Check for the code that updates labels based on aggregationPeriod
      expect(html).toContain('currentAggregationPeriod');
      expect(html).toContain('summaryAvgLocLabel');
      expect(html).toContain('summaryAvgSpLabel');
      expect(html).toContain("'Avg LOC/' + periodLabel");
      expect(html).toContain("'Avg SP/' + periodLabel");
    });
  });

  describe('organization selector format', () => {
    it('should format organization dropdown with teams and contributors count', () => {
      const html = generateOrgProfileHtml(mockConfig);

      // Check for the format function
      expect(html).toContain('populateOrganizations');
      // Check format includes teams and contributors
      expect(html).toContain("' teams, '");
      expect(html).toContain("' contributors)'");
    });
  });

  describe('error handling', () => {
    it('should include error banner element', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="errorBanner"');
      expect(html).toContain('id="errorMessage"');
      expect(html).toContain('id="errorRetryBtn"');
    });

    it('should have showError function', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('function showError(message)');
    });

    it('should have hideError function', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('function hideError()');
    });
  });

  describe('empty state', () => {
    it('should include empty state element', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('id="emptyState"');
      expect(html).toContain('id="emptyStateTitle"');
      expect(html).toContain('id="emptyStateMessage"');
    });

    it('should have showEmptyState function', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('function showEmptyState(title, message)');
    });

    it('should have hideEmptyState function', () => {
      const html = generateOrgProfileHtml(mockConfig);

      expect(html).toContain('function hideEmptyState()');
    });
  });
});
