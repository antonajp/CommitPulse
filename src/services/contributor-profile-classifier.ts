/**
 * Contributor Profile Classification Algorithm.
 *
 * Analyzes scorecard metrics to assign developer profile badges.
 * Uses team medians for normalization and quartile-based thresholds.
 *
 * Algorithm priority:
 * 1. commitCount < 5 → "Emerging Talent"
 * 2. releaseAssist in top quartile AND complexity in top quartile → "Coordinator"
 * 3. complexity score > 2x team median → "Architect"
 * 4. test AND comments scores > 2x team median → "Quality Guardian"
 * 5. comments score > 2x team median → "Documentation Champion"
 * 6. Otherwise check for lean variations based on highest normalized metric
 *
 * Edge cases:
 * - Team with 1 contributor → "Emerging Talent"
 * - All identical scores → "Pragmatic Engineer"
 * - Division by zero when team median is 0 → uses score absolute value
 * - Negative complexity scores (complexity reduction) → uses absolute value
 *
 * Ticket: IQS-942
 */

import type { ContributorProfile } from './dashboard-data-types.js';
import { LoggerService } from '../logging/logger.js';

const CLASS_NAME = 'ContributorProfileClassifier';

/**
 * Minimum commit count threshold for non-emerging talent classification.
 */
const MIN_COMMIT_COUNT = 5;

/**
 * Multiplier threshold for specialist profiles (2x team median).
 */
const SPECIALIST_MULTIPLIER = 2.0;

/**
 * Percentage threshold for "close enough" to be balanced (within 20%).
 */
const BALANCE_THRESHOLD = 0.20;

/**
 * Contributor scorecard metrics for profile classification.
 */
export interface ContributorMetrics {
  /** Contributor full name for logging */
  readonly fullName: string;
  /** Team assignment */
  readonly team: string;
  /** Release assist score (merge-based) */
  readonly releaseAssistScore: number;
  /** Test change score */
  readonly testScore: number;
  /** Complexity change score */
  readonly complexityScore: number;
  /** Comments change score */
  readonly commentsScore: number;
  /** Total commit count */
  readonly commitCount: number;
}

/**
 * Team-level percentile statistics for normalization.
 */
export interface TeamPercentiles {
  /** Team name */
  readonly team: string;
  /** 50th percentile (median) for release assist score */
  readonly releaseAssistMedian: number;
  /** 50th percentile (median) for test score */
  readonly testMedian: number;
  /** 50th percentile (median) for complexity score */
  readonly complexityMedian: number;
  /** 50th percentile (median) for comments score */
  readonly commentsMedian: number;
  /** 75th percentile for release assist score (top quartile threshold) */
  readonly releaseAssistP75: number;
  /** 75th percentile for complexity score (top quartile threshold) */
  readonly complexityP75: number;
  /** Total contributor count in this team */
  readonly contributorCount: number;
}

/**
 * Normalized metrics for balanced vs lean detection.
 */
interface NormalizedMetrics {
  /** Normalized test score (score / median) */
  readonly test: number;
  /** Normalized complexity score (score / median) */
  readonly complexity: number;
  /** Normalized release assist score (score / median) */
  readonly releaseAssist: number;
}

/**
 * Classify a contributor's profile based on scorecard metrics and team percentiles.
 *
 * @param contributor - Contributor's scorecard metrics
 * @param teamStats - Team-level percentile statistics
 * @returns ContributorProfile classification
 */
export function classifyProfile(
  contributor: ContributorMetrics,
  teamStats: TeamPercentiles,
): ContributorProfile {
  const logger = LoggerService.getInstance();

  logger.debug(
    CLASS_NAME,
    'classifyProfile',
    `Classifying ${contributor.fullName} (team: ${contributor.team}, commits: ${contributor.commitCount})`
  );

  // Rule 1: Emerging Talent (< 5 commits)
  if (contributor.commitCount < MIN_COMMIT_COUNT) {
    logger.debug(
      CLASS_NAME,
      'classifyProfile',
      `${contributor.fullName} → Emerging Talent (commitCount=${contributor.commitCount} < ${MIN_COMMIT_COUNT})`
    );
    return 'Emerging Talent';
  }

  // Rule 1a: Team with 1 contributor → Emerging Talent
  if (teamStats.contributorCount === 1) {
    logger.debug(
      CLASS_NAME,
      'classifyProfile',
      `${contributor.fullName} → Emerging Talent (solo team, contributorCount=${teamStats.contributorCount})`
    );
    return 'Emerging Talent';
  }

  // Rule 2: Coordinator (top quartile in both releaseAssist AND complexity)
  if (
    contributor.releaseAssistScore >= teamStats.releaseAssistP75 &&
    contributor.complexityScore >= teamStats.complexityP75
  ) {
    logger.debug(
      CLASS_NAME,
      'classifyProfile',
      `${contributor.fullName} → Coordinator (releaseAssist=${contributor.releaseAssistScore} >= ${teamStats.releaseAssistP75}, complexity=${contributor.complexityScore} >= ${teamStats.complexityP75})`
    );
    return 'Coordinator';
  }

  // Use absolute value for complexity to handle complexity reduction (negative scores)
  const absComplexity = Math.abs(contributor.complexityScore);
  const complexityMedian = Math.abs(teamStats.complexityMedian);

  // Rule 3: Architect (complexity > 2x team median)
  if (absComplexity > SPECIALIST_MULTIPLIER * complexityMedian && complexityMedian > 0) {
    logger.debug(
      CLASS_NAME,
      'classifyProfile',
      `${contributor.fullName} → Architect (absComplexity=${absComplexity} > ${SPECIALIST_MULTIPLIER * complexityMedian})`
    );
    return 'Architect';
  }

  // Rule 4: Quality Guardian (test AND comments > 2x team median)
  const testExceedsThreshold = contributor.testScore > SPECIALIST_MULTIPLIER * teamStats.testMedian && teamStats.testMedian > 0;
  const commentsExceedsThreshold = contributor.commentsScore > SPECIALIST_MULTIPLIER * teamStats.commentsMedian && teamStats.commentsMedian > 0;

  if (testExceedsThreshold && commentsExceedsThreshold) {
    logger.debug(
      CLASS_NAME,
      'classifyProfile',
      `${contributor.fullName} → Quality Guardian (test=${contributor.testScore} > ${SPECIALIST_MULTIPLIER * teamStats.testMedian}, comments=${contributor.commentsScore} > ${SPECIALIST_MULTIPLIER * teamStats.commentsMedian})`
    );
    return 'Quality Guardian';
  }

  // Rule 5: Documentation Champion (comments > 2x team median)
  if (commentsExceedsThreshold) {
    logger.debug(
      CLASS_NAME,
      'classifyProfile',
      `${contributor.fullName} → Documentation Champion (comments=${contributor.commentsScore} > ${SPECIALIST_MULTIPLIER * teamStats.commentsMedian})`
    );
    return 'Documentation Champion';
  }

  // Rule 6: Pragmatic Engineer with lean variations
  // Normalize metrics (handle division by zero)
  const normalized = normalizeMetrics(contributor, teamStats);

  logger.trace(
    CLASS_NAME,
    'classifyProfile',
    `${contributor.fullName} normalized metrics: test=${normalized.test.toFixed(2)}, complexity=${normalized.complexity.toFixed(2)}, releaseAssist=${normalized.releaseAssist.toFixed(2)}`
  );

  // Find the highest normalized metric
  const maxMetric = Math.max(normalized.test, normalized.complexity, normalized.releaseAssist);
  const minMetric = Math.min(normalized.test, normalized.complexity, normalized.releaseAssist);

  // Check if all metrics are within 20% of each other (balanced)
  const isBalanced = maxMetric === 0 || (maxMetric - minMetric) / maxMetric <= BALANCE_THRESHOLD;

  if (isBalanced) {
    logger.debug(
      CLASS_NAME,
      'classifyProfile',
      `${contributor.fullName} → Pragmatic Engineer (balanced, maxMetric=${maxMetric.toFixed(2)}, minMetric=${minMetric.toFixed(2)})`
    );
    return 'Pragmatic Engineer';
  }

  // Determine lean based on highest normalized metric
  if (normalized.test === maxMetric) {
    logger.debug(
      CLASS_NAME,
      'classifyProfile',
      `${contributor.fullName} → Pragmatic Engineer (leans quality) (test=${normalized.test.toFixed(2)} is max)`
    );
    return 'Pragmatic Engineer (leans quality)';
  } else if (normalized.complexity === maxMetric) {
    logger.debug(
      CLASS_NAME,
      'classifyProfile',
      `${contributor.fullName} → Pragmatic Engineer (leans architecture) (complexity=${normalized.complexity.toFixed(2)} is max)`
    );
    return 'Pragmatic Engineer (leans architecture)';
  } else {
    logger.debug(
      CLASS_NAME,
      'classifyProfile',
      `${contributor.fullName} → Pragmatic Engineer (leans delivery) (releaseAssist=${normalized.releaseAssist.toFixed(2)} is max)`
    );
    return 'Pragmatic Engineer (leans delivery)';
  }
}

/**
 * Normalize contributor metrics by team medians.
 * Handles division by zero by using absolute score when median is 0.
 *
 * @param contributor - Contributor metrics
 * @param teamStats - Team percentile statistics
 * @returns Normalized metrics
 */
function normalizeMetrics(
  contributor: ContributorMetrics,
  teamStats: TeamPercentiles,
): NormalizedMetrics {
  const logger = LoggerService.getInstance();

  // Normalize test score
  const test = teamStats.testMedian > 0
    ? contributor.testScore / teamStats.testMedian
    : Math.abs(contributor.testScore);

  // Normalize complexity score (use absolute values for comparison)
  const complexity = Math.abs(teamStats.complexityMedian) > 0
    ? Math.abs(contributor.complexityScore) / Math.abs(teamStats.complexityMedian)
    : Math.abs(contributor.complexityScore);

  // Normalize release assist score
  const releaseAssist = teamStats.releaseAssistMedian > 0
    ? contributor.releaseAssistScore / teamStats.releaseAssistMedian
    : Math.abs(contributor.releaseAssistScore);

  logger.trace(
    CLASS_NAME,
    'normalizeMetrics',
    `${contributor.fullName}: raw=(test=${contributor.testScore}, complexity=${contributor.complexityScore}, releaseAssist=${contributor.releaseAssistScore}), medians=(test=${teamStats.testMedian}, complexity=${teamStats.complexityMedian}, releaseAssist=${teamStats.releaseAssistMedian}), normalized=(test=${test.toFixed(2)}, complexity=${complexity.toFixed(2)}, releaseAssist=${releaseAssist.toFixed(2)})`
  );

  return { test, complexity, releaseAssist };
}
