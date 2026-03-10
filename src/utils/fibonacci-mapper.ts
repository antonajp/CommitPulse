/**
 * Pure-function utility to map issue duration (in calendar days)
 * to Fibonacci-scale story points.
 *
 * Mapping:
 *   0 days       -> 1 point
 *   1-2 days     -> 2 points
 *   3-4 days     -> 3 points
 *   5-7 days     -> 5 points
 *   8-12 days    -> 8 points
 *   13-20 days   -> 13 points
 *   21+ days     -> 21 points
 *
 * Negative durations return null (invalid data).
 *
 * Ticket: IQS-884
 */

/**
 * Fibonacci thresholds ordered by upper bound.
 * Each entry: [maxDays (inclusive), storyPoints].
 * The final entry covers anything above 20 days.
 */
const FIBONACCI_THRESHOLDS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [2, 2],
  [4, 3],
  [7, 5],
  [12, 8],
  [20, 13],
] as const;

/**
 * The maximum Fibonacci story point value (for durations >= 21 days).
 */
const MAX_STORY_POINTS = 21;

/**
 * Map a duration in calendar days to Fibonacci-scale story points.
 *
 * @param durationDays - Number of calendar days between issue creation and completion
 * @returns The Fibonacci story point value, or null if durationDays is negative (invalid data)
 */
export function mapDurationToStoryPoints(durationDays: number): number | null {
  // Negative durations are invalid data
  if (durationDays < 0) {
    return null;
  }

  // Walk through thresholds to find the matching bucket
  for (const [maxDays, points] of FIBONACCI_THRESHOLDS) {
    if (durationDays <= maxDays) {
      return points;
    }
  }

  // Duration exceeds all thresholds -> cap at maximum
  return MAX_STORY_POINTS;
}
