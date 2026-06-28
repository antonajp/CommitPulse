import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { generateTeamProfileHtml, type TeamProfileHtmlConfig } from '../../views/webview/team-profile-html.js';

/**
 * Unit tests for Team Profile HTML generation (GITX-185).
 * Tests for CSP compliance, team selector, and summary cards.
 */
describe('team-profile-html', () => {
  const mockConfig: TeamProfileHtmlConfig = {
    nonce: 'test-nonce-12345',
    d3Uri: { toString: () => 'https://example.com/d3.min.js' } as any,
    styleUri: { toString: () => 'https://example.com/dev-profile.css' } as any,
    cspSource: 'https://example.com',
  };

  describe('generateTeamProfileHtml', () => {
    it('should generate valid HTML document', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include CSP meta tag with nonce', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain(`'nonce-${mockConfig.nonce}'`);
    });

    it('should use script tags with nonce attribute', () => {
      const html = generateTeamProfileHtml(mockConfig);
      const scriptTagPattern = new RegExp(`<script nonce="${mockConfig.nonce}"`, 'g');
      const matches = html.match(scriptTagPattern);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });

    it('should include team selector dropdown', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('<select id="teamSelect"');
      expect(html).toContain('aria-label="Select team"');
      expect(html).toContain('<label for="teamSelect">Team:</label>');
    });

    it('should include timeframe selector', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('<select id="timeframeSelect"');
      expect(html).toContain('aria-label="Select timeframe"');
      expect(html).toContain('<option value="30">Last 30 days</option>');
      expect(html).toContain('<option value="60">Last 60 days</option>');
      expect(html).toContain('<option value="90" selected>Last 90 days</option>');
      expect(html).toContain('<option value="180">Last 6 months</option>');
      expect(html).toContain('<option value="365">Last 1 year</option>');
      expect(html).toContain('<option value="730">Last 2 years</option>');
    });

    it('should include all summary cards', () => {
      const html = generateTeamProfileHtml(mockConfig);

      // Total Commits card
      expect(html).toContain('id="summaryCommits"');
      expect(html).toContain('Total Commits');
      expect(html).toContain('id="summaryCommitsValue"');

      // Total LOC card
      expect(html).toContain('id="summaryLoc"');
      expect(html).toContain('Total LOC');
      expect(html).toContain('id="summaryLocValue"');

      // Avg LOC/Week card
      expect(html).toContain('id="summaryAvgLoc"');
      expect(html).toContain('id="summaryAvgLocLabel"');
      expect(html).toContain('id="summaryAvgLocValue"');

      // Avg SP/Week card
      expect(html).toContain('id="summaryAvgSp"');
      expect(html).toContain('id="summaryAvgSpLabel"');
      expect(html).toContain('id="summaryAvgSpValue"');

      // Avg Complexity card
      expect(html).toContain('id="summaryComplexity"');
      expect(html).toContain('Avg Complexity');
      expect(html).toContain('id="summaryComplexityValue"');

      // Repositories card
      expect(html).toContain('id="summaryRepos"');
      expect(html).toContain('Repositories');
      expect(html).toContain('id="summaryReposValue"');
    });

    it('should include D3 script tag with nonce', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain(`<script nonce="${mockConfig.nonce}" src="${mockConfig.d3Uri.toString()}"></script>`);
    });

    it('should include escapeHtml function', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('function escapeHtml(str)');
      expect(html).toContain('.replace(/&/g, \'&amp;\')');
      expect(html).toContain('.replace(/</g, \'&lt;\')');
      expect(html).toContain('.replace(/>/g, \'&gt;\')');
    });

    it('should NOT have inline style="display:none;" attributes (CSP violation)', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).not.toContain('style="display:none;"');
      expect(html).not.toContain("style='display:none;'");
    });

    it('should use hidden CSS class instead of inline display:none style', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toMatch(/class="[^"]*\bhidden\b[^"]*"/);
    });

    it('should NOT have duplicate HTML class attributes', () => {
      const html = generateTeamProfileHtml(mockConfig);
      const duplicateClassPattern = /class="[^"]*"\s+[^>]*class="/g;
      const matches = html.match(duplicateClassPattern);
      expect(matches).toBeNull();
    });

    it('should include LOC per week chart section', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('id="locWeekCard"');
      expect(html).toContain('Lines of Code');
      expect(html).toContain('id="locWeekChart"');
    });

    // GITX-186: Changed from tables to horizontal stacked bar charts
    it('should include top complex files chart', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('id="complexFilesCard"');
      expect(html).toContain('Top 15 Complex Files');
      expect(html).toContain('id="complexFilesChart"');
    });

    it('should include top frequent files chart', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('id="frequentFilesCard"');
      expect(html).toContain('Top 20 Frequently Modified Files');
      expect(html).toContain('id="frequentFilesChart"');
    });

    it('should include empty state section', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('id="emptyState"');
      expect(html).toContain('id="emptyStateTitle"');
      expect(html).toContain('id="emptyStateMessage"');
    });

    it('should include error banner section', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('id="errorBanner"');
      expect(html).toContain('id="errorMessage"');
      expect(html).toContain('id="errorRetryBtn"');
    });

    // GITX-186: Updated state variables list (removed cachedComplexFiles, cachedFrequentFiles)
    it('should have state variables declared only once', () => {
      const html = generateTeamProfileHtml(mockConfig);
      const stateVars = [
        'currentTeam',
        'currentTimeframe',
        'cachedTeams',
        'cachedLocData',
        'cachedTechStack',
        'cachedCommentsWeek',
        'cachedTestsWeek',
        'cachedHygieneScore',
        'cachedVelocityData',
        'velocityDataAvailable',
        'cachedTestDebtMetrics',
      ];

      for (const varName of stateVars) {
        const letMatches = html.match(new RegExp(`let\\s+${varName}\\s*=`, 'g')) || [];
        const varMatches = html.match(new RegExp(`var\\s+${varName}\\s*=`, 'g')) || [];
        const constMatches = html.match(new RegExp(`const\\s+${varName}\\s*=`, 'g')) || [];
        const totalDeclarations = letMatches.length + varMatches.length + constMatches.length;

        expect(totalDeclarations).toBeLessThanOrEqual(1);
      }
    });

    // GITX-186: Updated to include chart data message handlers
    it('should include message handler for webview communication', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain("window.addEventListener('message'");
      expect(html).toContain("case 'initialState':");
      expect(html).toContain("case 'teamsData':");
      expect(html).toContain("case 'teamSummaryData':");
      expect(html).toContain("case 'teamLocPerWeekData':");
      expect(html).toContain("case 'teamComplexFilesChartData':");
      expect(html).toContain("case 'teamFrequentFilesChartData':");
      expect(html).toContain("case 'error':");
    });

    it('should include event listeners for dropdowns', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain("document.getElementById('teamSelect').addEventListener('change'");
      expect(html).toContain("document.getElementById('timeframeSelect').addEventListener('change'");
    });

    it('should request teams list on initialization', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('requestTeams()');
    });

    it('should include accessibility attributes', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('aria-label=');
      expect(html).toContain('aria-live=');
      expect(html).toContain('role=');
      expect(html).toContain('aria-hidden=');
    });

    it('should have proper page title', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('<title>Team Profile</title>');
    });

    it('should include header with title', () => {
      const html = generateTeamProfileHtml(mockConfig);
      expect(html).toContain('<h1>Team Profile</h1>');
    });
  });
});
