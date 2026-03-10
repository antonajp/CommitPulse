/**
 * Data mapping utilities for Development Pipeline data service.
 * Provides functions to transform database rows to typed data points.
 *
 * Ticket: IQS-930 (extracted from dev-pipeline-data-service.ts)
 */

import { LoggerService } from '../logging/logger.js';
import type { RepositoryEntry } from '../config/settings.js';
import type { DevPipelineDelta } from '../database/queries/dev-pipeline-queries.js';
import type { DevPipelineDeltaPoint } from './dev-pipeline-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DevPipelineMappers';

/**
 * Map database row to DevPipelineDeltaPoint.
 * Converts Date objects to ISO strings and snake_case to camelCase.
 *
 * @param row - Database row from vw_dev_pipeline_deltas
 * @returns Typed DevPipelineDeltaPoint
 */
export function mapRowToDeltaPoint(row: DevPipelineDelta): DevPipelineDeltaPoint {
  const commitDate =
    row.commit_date instanceof Date
      ? row.commit_date.toISOString().split('T')[0] ?? ''
      : String(row.commit_date);

  // Extract first line of commit message as summary
  const commitMessageSummary = row.commit_message
    ? row.commit_message.split('\n')[0] ?? null
    : null;

  return {
    sha: row.sha,
    commitDate,
    author: row.author,
    branch: row.branch,
    repository: row.repository,
    commitMessageSummary,
    fullName: row.full_name,
    team: row.team,
    ticketId: row.ticket_id,
    ticketProject: row.ticket_project,
    ticketType: row.ticket_type,
    complexityDelta: Number(row.complexity_delta),
    locDelta: Number(row.loc_delta),
    commentsDelta: Number(row.comments_delta),
    testsDelta: Number(row.tests_delta),
    fileCount: Number(row.file_count),
    testFileCount: Number(row.test_file_count),
    baselineSha: row.baseline_sha,
    totalComplexity: Number(row.total_complexity),
    totalCodeLines: Number(row.total_code_lines),
    totalCommentLines: Number(row.total_comment_lines),
  };
}

/**
 * Build a lookup map from repository name to repoUrl from settings.
 *
 * @param repositories - Repository entries from VS Code settings
 * @param logger - Logger instance for trace logging
 * @returns Map of repository name to repoUrl (https URL)
 */
export function buildRepoUrlMap(
  repositories: readonly RepositoryEntry[],
  logger: LoggerService
): Map<string, string> {
  const map = new Map<string, string>();
  for (const repo of repositories) {
    if (repo.name && repo.repoUrl) {
      map.set(repo.name, repo.repoUrl);
      logger.trace(CLASS_NAME, 'buildRepoUrlMap', `Mapped ${repo.name} -> ${repo.repoUrl}`);
    }
  }
  logger.debug(CLASS_NAME, 'buildRepoUrlMap', `Built repoUrl map with ${map.size} entries`);
  return map;
}

/**
 * Get default date range (last 3 weeks).
 *
 * @param weeks - Number of weeks to include (default: 3)
 * @returns Object with startDate and endDate as ISO strings
 */
export function getDefaultDateRange(weeks = 3): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - weeks * 7);

  return {
    startDate: startDate.toISOString().split('T')[0] ?? '',
    endDate: endDate.toISOString().split('T')[0] ?? '',
  };
}
