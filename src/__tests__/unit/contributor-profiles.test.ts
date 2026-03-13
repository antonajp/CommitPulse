import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import {
  classifyProfile,
  type ContributorMetrics,
  type TeamPercentiles,
} from '../../services/contributor-profile-classifier.js';
import type { ContributorProfile } from '../../services/dashboard-data-types.js';

/**
 * Unit tests for Contributor Profile Classification Algorithm.
 *
 * Tests all 6 profile types, lean variations, boundary conditions, edge cases,
 * precedence rules, and performance requirements.
 *
 * Algorithm priority:
 * 1. commitCount < 5 → "Emerging Talent"
 * 2. releaseAssist in top quartile AND complexity in top quartile → "Coordinator"
 * 3. complexity score > 2x team median → "Architect"
 * 4. test AND comments scores > 2x team median → "Quality Guardian"
 * 5. comments score > 2x team median → "Documentation Champion"
 * 6. Otherwise check for lean variations based on highest normalized metric
 *
 * Ticket: IQS-942
 */

// =============================================================================
// Test Data Helpers
// =============================================================================

/**
 * Create a contributor with specified metrics.
 * Defaults to balanced scores in the middle range.
 */
function createContributor(overrides?: Partial<ContributorMetrics>): ContributorMetrics {
  return {
    fullName: 'Test Contributor',
    team: 'TestTeam',
    releaseAssistScore: 50,
    testScore: 50,
    complexityScore: 50,
    commentsScore: 50,
    commitCount: 10,
    ...overrides,
  };
}

/**
 * Create team statistics with specified medians and percentiles.
 * Defaults to median=50, P75=75, contributorCount=10.
 */
function createTeamStats(overrides?: Partial<TeamPercentiles>): TeamPercentiles {
  return {
    team: 'TestTeam',
    releaseAssistMedian: 50,
    testMedian: 50,
    complexityMedian: 50,
    commentsMedian: 50,
    releaseAssistP75: 75,
    complexityP75: 75,
    contributorCount: 10,
    ...overrides,
  };
}

// =============================================================================
// Profile Assignment Tests - All 6 Profiles
// =============================================================================

describe('classifyProfile', () => {
  describe('specialist profiles', () => {
    it('classifies Coordinator when release assist and complexity both in top quartile', () => {
      const contributor = createContributor({
        releaseAssistScore: 80, // >= P75 (75)
        complexityScore: 80,    // >= P75 (75)
        testScore: 40,
        commentsScore: 40,
      });
      const teamStats = createTeamStats();

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Coordinator');
    });

    it('classifies Coordinator at exactly P75 threshold', () => {
      const contributor = createContributor({
        releaseAssistScore: 75, // Exactly P75
        complexityScore: 75,    // Exactly P75
      });
      const teamStats = createTeamStats();

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Coordinator');
    });

    it('classifies Architect when complexity > 2x median', () => {
      const contributor = createContributor({
        complexityScore: 101, // > 2 * 50 (median)
        testScore: 40,
        commentsScore: 40,
        releaseAssistScore: 40,
      });
      const teamStats = createTeamStats();

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Architect');
    });

    it('classifies Architect with negative complexity scores (complexity reduction)', () => {
      const contributor = createContributor({
        complexityScore: -101, // Absolute value = 101 > 2 * 50
        testScore: 40,
        commentsScore: 40,
        releaseAssistScore: 40,
      });
      const teamStats = createTeamStats();

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Architect');
    });

    it('classifies Quality Guardian when test AND comments both > 2x median', () => {
      const contributor = createContributor({
        testScore: 101,     // > 2 * 50 (median)
        commentsScore: 101, // > 2 * 50 (median)
        complexityScore: 40,
        releaseAssistScore: 40,
      });
      const teamStats = createTeamStats();

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Quality Guardian');
    });

    it('classifies Documentation Champion when comments > 2x median', () => {
      const contributor = createContributor({
        commentsScore: 101, // > 2 * 50 (median)
        testScore: 40,
        complexityScore: 40,
        releaseAssistScore: 40,
      });
      const teamStats = createTeamStats();

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Documentation Champion');
    });

    it('classifies Pragmatic Engineer with balanced scores', () => {
      const contributor = createContributor({
        testScore: 50,
        commentsScore: 50,
        complexityScore: 50,
        releaseAssistScore: 50,
      });
      const teamStats = createTeamStats();

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Pragmatic Engineer');
    });

    it('classifies Emerging Talent with <5 commits', () => {
      const contributor = createContributor({
        commitCount: 4,
      });
      const teamStats = createTeamStats();

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Emerging Talent');
    });
  });

  // =============================================================================
  // Lean Variations Tests
  // =============================================================================

  describe('lean variations', () => {
    it('classifies Pragmatic Engineer (leans quality) when test score is highest', () => {
      const contributor = createContributor({
        testScore: 60,           // Highest
        complexityScore: 45,
        releaseAssistScore: 40,
        commentsScore: 30,
      });
      const teamStats = createTeamStats({
        testMedian: 50,
        complexityMedian: 50,
        releaseAssistMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Pragmatic Engineer (leans quality)');
    });

    it('classifies Pragmatic Engineer (leans delivery) when release assist is highest', () => {
      const contributor = createContributor({
        releaseAssistScore: 60,  // Highest
        testScore: 45,
        complexityScore: 40,
        commentsScore: 30,
      });
      const teamStats = createTeamStats({
        releaseAssistMedian: 50,
        testMedian: 50,
        complexityMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Pragmatic Engineer (leans delivery)');
    });

    it('classifies Pragmatic Engineer (leans architecture) when complexity is highest', () => {
      const contributor = createContributor({
        complexityScore: 60,     // Highest
        testScore: 45,
        releaseAssistScore: 40,
        commentsScore: 30,
      });
      const teamStats = createTeamStats({
        complexityMedian: 50,
        testMedian: 50,
        releaseAssistMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Pragmatic Engineer (leans architecture)');
    });

    it('classifies balanced Pragmatic Engineer when metrics are within 20% threshold', () => {
      const contributor = createContributor({
        testScore: 50,
        complexityScore: 52,     // Within 20% of 50
        releaseAssistScore: 48,  // Within 20% of 50
        commentsScore: 30,
      });
      const teamStats = createTeamStats({
        testMedian: 50,
        complexityMedian: 50,
        releaseAssistMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Pragmatic Engineer');
    });
  });

  // =============================================================================
  // Boundary Tests
  // =============================================================================

  describe('boundary conditions', () => {
    it('classifies non-Emerging Talent at exactly 5 commits', () => {
      const contributor = createContributor({
        commitCount: 5, // Exactly at threshold (should NOT be Emerging Talent)
        testScore: 50,
        complexityScore: 50,
        releaseAssistScore: 50,
        commentsScore: 50,
      });
      const teamStats = createTeamStats();

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).not.toBe('Emerging Talent');
      expect(profile).toBe('Pragmatic Engineer'); // Should be classified normally
    });

    it('classifies Emerging Talent at exactly 4 commits', () => {
      const contributor = createContributor({
        commitCount: 4, // Just below threshold
      });
      const teamStats = createTeamStats();

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Emerging Talent');
    });

    it('classifies Architect at exactly 2x median threshold', () => {
      const contributor = createContributor({
        complexityScore: 100, // Exactly 2 * 50 (NOT greater than, should NOT be Architect)
        testScore: 40,
        commentsScore: 40,
        releaseAssistScore: 40,
      });
      const teamStats = createTeamStats({
        complexityMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).not.toBe('Architect'); // Must be > 2x, not >=
    });

    it('classifies Architect just above 2x median threshold', () => {
      const contributor = createContributor({
        complexityScore: 100.1, // Just above 2 * 50
        testScore: 40,
        commentsScore: 40,
        releaseAssistScore: 40,
      });
      const teamStats = createTeamStats({
        complexityMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Architect');
    });

    it('classifies Quality Guardian at exactly 2x median threshold', () => {
      const contributor = createContributor({
        testScore: 100,     // Exactly 2 * 50 (NOT greater than)
        commentsScore: 100, // Exactly 2 * 50 (NOT greater than)
        complexityScore: 40,
        releaseAssistScore: 40,
      });
      const teamStats = createTeamStats({
        testMedian: 50,
        commentsMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).not.toBe('Quality Guardian'); // Must be > 2x, not >=
    });

    it('does not classify Documentation Champion when comments exactly at 2x median', () => {
      const contributor = createContributor({
        commentsScore: 100, // Exactly 2 * 50 (NOT greater than)
        testScore: 40,
        complexityScore: 40,
        releaseAssistScore: 40,
      });
      const teamStats = createTeamStats({
        commentsMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).not.toBe('Documentation Champion'); // Must be > 2x
    });
  });

  // =============================================================================
  // Edge Case Tests
  // =============================================================================

  describe('edge cases', () => {
    it('classifies single contributor team as Emerging Talent', () => {
      const contributor = createContributor({
        commitCount: 100, // Many commits
      });
      const teamStats = createTeamStats({
        contributorCount: 1, // Solo team
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Emerging Talent');
    });

    it('classifies Pragmatic Engineer when all scores are identical', () => {
      const contributor = createContributor({
        testScore: 42,
        complexityScore: 42,
        releaseAssistScore: 42,
        commentsScore: 42,
      });
      const teamStats = createTeamStats({
        testMedian: 42,
        complexityMedian: 42,
        releaseAssistMedian: 42,
        commentsMedian: 42,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Pragmatic Engineer');
    });

    it('handles all metrics at zero gracefully', () => {
      const contributor = createContributor({
        testScore: 0,
        complexityScore: 0,
        releaseAssistScore: 0,
        commentsScore: 0,
      });
      const teamStats = createTeamStats({
        testMedian: 0,
        complexityMedian: 0,
        releaseAssistMedian: 0,
        commentsMedian: 0,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Pragmatic Engineer'); // Balanced when all zero
    });

    it('handles all metrics at maximum values correctly', () => {
      const contributor = createContributor({
        testScore: 1000,
        complexityScore: 1000,
        releaseAssistScore: 1000,
        commentsScore: 1000,
        commitCount: 1000,
      });
      const teamStats = createTeamStats({
        testMedian: 100,
        complexityMedian: 100,
        releaseAssistMedian: 100,
        commentsMedian: 100,
        releaseAssistP75: 150,
        complexityP75: 150,
      });

      const profile = classifyProfile(contributor, teamStats);

      // Should be Coordinator (top quartile in both releaseAssist and complexity)
      expect(profile).toBe('Coordinator');
    });

    it('handles negative complexity values (complexity reduction)', () => {
      const contributor = createContributor({
        complexityScore: -120, // Absolute value = 120 > 2 * 50
        testScore: 40,
        commentsScore: 40,
        releaseAssistScore: 40,
      });
      const teamStats = createTeamStats({
        complexityMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Architect'); // Uses absolute value
    });

    it('handles division by zero when team median is zero (test metric)', () => {
      const contributor = createContributor({
        testScore: 100,
        complexityScore: 40,
        releaseAssistScore: 40,
        commentsScore: 40,
      });
      const teamStats = createTeamStats({
        testMedian: 0, // Division by zero scenario
        complexityMedian: 50,
        releaseAssistMedian: 50,
      });

      // Should not crash, should use absolute value for normalization
      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBeDefined();
      expect(typeof profile).toBe('string');
    });

    it('handles division by zero when team median is zero (complexity metric)', () => {
      const contributor = createContributor({
        complexityScore: 100,
        testScore: 40,
        releaseAssistScore: 40,
        commentsScore: 40,
      });
      const teamStats = createTeamStats({
        complexityMedian: 0, // Division by zero scenario
        testMedian: 50,
        releaseAssistMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBeDefined();
      expect(typeof profile).toBe('string');
    });

    it('handles two-way tie between metrics (test and complexity)', () => {
      const contributor = createContributor({
        testScore: 60,
        complexityScore: 60,    // Tied with test
        releaseAssistScore: 40,
        commentsScore: 30,
      });
      const teamStats = createTeamStats({
        testMedian: 50,
        complexityMedian: 50,
        releaseAssistMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      // Should pick one of the tied values (test or complexity)
      expect(profile).toMatch(/Pragmatic Engineer \(leans (quality|architecture)\)/);
    });

    it('handles three-way tie between all normalized metrics', () => {
      const contributor = createContributor({
        testScore: 55,
        complexityScore: 55,
        releaseAssistScore: 55,
        commentsScore: 30,
      });
      const teamStats = createTeamStats({
        testMedian: 50,
        complexityMedian: 50,
        releaseAssistMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      // All three metrics are equal (1.1x median each), so they're within 20% of each other
      // This is considered balanced
      expect(profile).toBe('Pragmatic Engineer');
    });

    it('handles two-way tie resolved by first match (test and complexity equal)', () => {
      const contributor = createContributor({
        testScore: 60,           // 60/30 = 2.0 (highest)
        complexityScore: 60,     // 60/30 = 2.0 (tied highest)
        releaseAssistScore: 70,  // 70/50 = 1.4 (significantly lower, >20% diff)
        commentsScore: 30,
      });
      const teamStats = createTeamStats({
        testMedian: 30,
        complexityMedian: 30,
        releaseAssistMedian: 50,
        complexityP75: 70,       // Above complexity, so not Coordinator
        releaseAssistP75: 110,   // Above releaseAssist, so not Coordinator
      });

      const profile = classifyProfile(contributor, teamStats);

      // Test and complexity both have max normalized value (2.0)
      // releaseAssist is 1.4, difference is 0.6/2.0 = 30% > 20%, so NOT balanced
      // Algorithm picks first match when there's a tie: test
      expect(profile).toBe('Pragmatic Engineer (leans quality)');
    });

    it('handles NaN values gracefully (contributor score is NaN)', () => {
      const contributor = createContributor({
        testScore: NaN,
        complexityScore: 50,
        releaseAssistScore: 50,
        commentsScore: 50,
      });
      const teamStats = createTeamStats();

      // Should not crash
      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBeDefined();
    });

    it('handles undefined values treated as 0', () => {
      const contributor = createContributor({
        testScore: undefined as unknown as number,
        complexityScore: 50,
        releaseAssistScore: 50,
        commentsScore: 50,
      });
      const teamStats = createTeamStats();

      // Should not crash, undefined coerces to NaN/0 in arithmetic
      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBeDefined();
    });
  });

  // =============================================================================
  // Precedence Tests
  // =============================================================================

  describe('precedence rules', () => {
    it('prioritizes Emerging Talent over all other profiles', () => {
      const contributor = createContributor({
        commitCount: 3,         // < 5, should be Emerging Talent
        releaseAssistScore: 100, // Would qualify for Coordinator
        complexityScore: 100,    // Would qualify for Coordinator
        testScore: 200,          // Would qualify for Quality Guardian
        commentsScore: 200,      // Would qualify for Quality Guardian
      });
      const teamStats = createTeamStats({
        releaseAssistP75: 75,
        complexityP75: 75,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Emerging Talent'); // Emerging Talent has highest priority
    });

    it('prioritizes Coordinator over Architect', () => {
      const contributor = createContributor({
        commitCount: 10,
        releaseAssistScore: 80,  // >= P75, qualifies for Coordinator
        complexityScore: 120,    // >= P75 AND > 2x median, qualifies for both
        testScore: 40,
        commentsScore: 40,
      });
      const teamStats = createTeamStats({
        releaseAssistP75: 75,
        complexityP75: 75,
        complexityMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Coordinator'); // Coordinator has priority over Architect
    });

    it('prioritizes Coordinator over Quality Guardian', () => {
      const contributor = createContributor({
        commitCount: 10,
        releaseAssistScore: 80,  // >= P75, qualifies for Coordinator
        complexityScore: 80,     // >= P75, qualifies for Coordinator
        testScore: 120,          // > 2x median, qualifies for Quality Guardian
        commentsScore: 120,      // > 2x median, qualifies for Quality Guardian
      });
      const teamStats = createTeamStats({
        releaseAssistP75: 75,
        complexityP75: 75,
        testMedian: 50,
        commentsMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Coordinator'); // Coordinator has priority
    });

    it('prioritizes Architect over Quality Guardian', () => {
      const contributor = createContributor({
        commitCount: 10,
        releaseAssistScore: 40,
        complexityScore: 120,    // > 2x median, qualifies for Architect
        testScore: 120,          // > 2x median, qualifies for Quality Guardian
        commentsScore: 120,      // > 2x median, qualifies for Quality Guardian
      });
      const teamStats = createTeamStats({
        complexityMedian: 50,
        testMedian: 50,
        commentsMedian: 50,
        releaseAssistP75: 75,
        complexityP75: 75,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Architect'); // Architect has priority over Quality Guardian
    });

    it('prioritizes Quality Guardian over Documentation Champion', () => {
      const contributor = createContributor({
        commitCount: 10,
        testScore: 120,         // > 2x median, qualifies for Quality Guardian
        commentsScore: 120,     // > 2x median, qualifies for both
        complexityScore: 40,
        releaseAssistScore: 40,
      });
      const teamStats = createTeamStats({
        testMedian: 50,
        commentsMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Quality Guardian'); // QG has priority over Doc Champion
    });

    it('prioritizes Documentation Champion over Pragmatic Engineer', () => {
      const contributor = createContributor({
        commitCount: 10,
        commentsScore: 120,     // > 2x median, qualifies for Documentation Champion
        testScore: 50,          // Balanced with other metrics
        complexityScore: 50,
        releaseAssistScore: 50,
      });
      const teamStats = createTeamStats({
        commentsMedian: 50,
        testMedian: 50,
        complexityMedian: 50,
        releaseAssistMedian: 50,
      });

      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Documentation Champion'); // Doc Champion has priority
    });
  });

  // =============================================================================
  // Performance Test
  // =============================================================================

  describe('performance', () => {
    it('classifies 100 contributors in <100ms', () => {
      const contributors: ContributorMetrics[] = [];

      // Generate 100 contributors with varying metrics
      for (let i = 0; i < 100; i++) {
        contributors.push(createContributor({
          fullName: `Contributor ${i}`,
          commitCount: 5 + (i % 50),
          testScore: 30 + (i % 70),
          complexityScore: 20 + (i % 80),
          releaseAssistScore: 40 + (i % 60),
          commentsScore: 25 + (i % 75),
        }));
      }

      const teamStats = createTeamStats();

      const startTime = Date.now();

      for (const contributor of contributors) {
        const profile = classifyProfile(contributor, teamStats);
        expect(profile).toBeDefined();
      }

      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100); // Should complete in <100ms
    });
  });

  // =============================================================================
  // Additional Edge Cases
  // =============================================================================

  describe('additional edge cases', () => {
    it('handles very large metric values without overflow', () => {
      const contributor = createContributor({
        testScore: Number.MAX_SAFE_INTEGER / 2,
        complexityScore: 100,
        releaseAssistScore: 100,
        commentsScore: 100,
        commitCount: 100,
      });
      const teamStats = createTeamStats({
        testMedian: Number.MAX_SAFE_INTEGER / 10,
        complexityMedian: 50,
        releaseAssistMedian: 50,
        commentsMedian: 50,
      });

      // Should not crash or overflow
      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBeDefined();
      expect(typeof profile).toBe('string');
    });

    it('classifies correctly when all team medians are zero', () => {
      const contributor = createContributor({
        testScore: 10,
        complexityScore: 20,
        releaseAssistScore: 5,   // Lower to avoid Coordinator classification
        commentsScore: 5,
        commitCount: 10,
      });
      const teamStats = createTeamStats({
        testMedian: 0,
        complexityMedian: 0,
        releaseAssistMedian: 0,
        commentsMedian: 0,
        releaseAssistP75: 25,    // Above releaseAssist to avoid Coordinator
        complexityP75: 25,       // Above complexity to avoid Coordinator
      });

      // When all medians are zero, normalization uses absolute values
      // complexity (20) is highest
      const profile = classifyProfile(contributor, teamStats);

      expect(profile).toBe('Pragmatic Engineer (leans architecture)');
    });
  });

  // =============================================================================
  // Integration-Style Tests (Multiple Scenarios)
  // =============================================================================

  describe('realistic scenarios', () => {
    it('classifies a diverse team correctly', () => {
      const teamStats = createTeamStats({
        testMedian: 45,
        complexityMedian: 55,
        releaseAssistMedian: 50,
        commentsMedian: 40,
        releaseAssistP75: 80,
        complexityP75: 85,
        contributorCount: 8,
      });

      // Junior developer
      const junior = createContributor({
        fullName: 'Junior Dev',
        commitCount: 3,
        testScore: 20,
        complexityScore: 30,
        releaseAssistScore: 25,
        commentsScore: 15,
      });
      expect(classifyProfile(junior, teamStats)).toBe('Emerging Talent');

      // Coordinator (high release assist + high complexity)
      const coordinator = createContributor({
        fullName: 'Coordinator',
        commitCount: 50,
        releaseAssistScore: 85,
        complexityScore: 90,
        testScore: 40,
        commentsScore: 35,
      });
      expect(classifyProfile(coordinator, teamStats)).toBe('Coordinator');

      // Architect (very high complexity)
      const architect = createContributor({
        fullName: 'Architect',
        commitCount: 45,
        complexityScore: 120, // > 2 * 55
        testScore: 40,
        releaseAssistScore: 50,
        commentsScore: 30,
      });
      expect(classifyProfile(architect, teamStats)).toBe('Architect');

      // Quality Guardian (high test + high comments)
      const qualityGuardian = createContributor({
        fullName: 'QA Engineer',
        commitCount: 30,
        testScore: 95,  // > 2 * 45
        commentsScore: 85, // > 2 * 40
        complexityScore: 40,
        releaseAssistScore: 35,
      });
      expect(classifyProfile(qualityGuardian, teamStats)).toBe('Quality Guardian');

      // Documentation Champion (high comments only)
      const docChampion = createContributor({
        fullName: 'Tech Writer',
        commitCount: 25,
        commentsScore: 90, // > 2 * 40
        testScore: 30,
        complexityScore: 35,
        releaseAssistScore: 40,
      });
      expect(classifyProfile(docChampion, teamStats)).toBe('Documentation Champion');

      // Pragmatic Engineer (balanced)
      const pragmatic = createContributor({
        fullName: 'Balanced Dev',
        commitCount: 40,
        testScore: 48,
        complexityScore: 52,
        releaseAssistScore: 50,
        commentsScore: 42,
      });
      expect(classifyProfile(pragmatic, teamStats)).toBe('Pragmatic Engineer');

      // Pragmatic Engineer (leans quality)
      const qualityLean = createContributor({
        fullName: 'Quality-Focused Dev',
        commitCount: 35,
        testScore: 60,
        complexityScore: 45,
        releaseAssistScore: 42,
        commentsScore: 38,
      });
      expect(classifyProfile(qualityLean, teamStats)).toBe('Pragmatic Engineer (leans quality)');

      // Pragmatic Engineer (leans delivery)
      const deliveryLean = createContributor({
        fullName: 'Delivery-Focused Dev',
        commitCount: 38,
        releaseAssistScore: 65,
        testScore: 45,
        complexityScore: 48,
        commentsScore: 40,
      });
      expect(classifyProfile(deliveryLean, teamStats)).toBe('Pragmatic Engineer (leans delivery)');
    });
  });
});
