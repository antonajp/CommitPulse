/**
 * Linear issue field extraction functions.
 *
 * Extracts and maps fields from the @linear/sdk Issue type to
 * LinearDetailRow for database persistence. Parallel to
 * jira-issue-extractor.ts with Linear-specific field mappings.
 *
 * Field mapping from Jira -> Linear concepts:
 *   summary    -> title
 *   status     -> state.name
 *   issuetype  -> labels
 *   points     -> estimate (native field)
 *   reporter   -> creator.name
 *   fixversion -> N/A
 *   component  -> labels
 *
 * Ticket: IQS-875
 */

import { LoggerService } from '../logging/logger.js';
import type { LinearDetailRow } from '../database/linear-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'LinearIssueExtractor';

/**
 * Priority mapping from Linear's numeric values to human-readable labels.
 * Linear priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low.
 */
const PRIORITY_MAP: Readonly<Record<number, string>> = {
  0: 'None',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

/**
 * Lightweight interface for the subset of Linear Issue fields we use.
 * This avoids importing the full Linear SDK types at the type level,
 * making the extractor testable without the SDK.
 */
export interface LinearIssueData {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description?: string | null;
  readonly priority: number;
  readonly estimate?: number | null;
  readonly createdAt: Date | string;
  readonly completedAt?: Date | null | string;
  readonly url: string;
  readonly state?: { name: string } | null;
  readonly assignee?: { name: string } | null;
  readonly creator?: { name: string } | null;
  readonly project?: { name: string } | null;
  readonly team?: { key: string; name: string } | null;
  readonly labels?: { nodes: Array<{ name: string }> } | null;
}

/**
 * Extract a LinearDetailRow from a Linear issue object.
 * Maps Linear SDK Issue fields to our database schema.
 *
 * @param issue - The Linear issue data object
 * @returns A LinearDetailRow ready for database upsert
 */
export function extractLinearDetail(issue: LinearIssueData): LinearDetailRow {
  const logger = LoggerService.getInstance();
  logger.trace(CLASS_NAME, 'extractLinearDetail', `Extracting detail for: ${issue.identifier}`);

  const priorityLabel = mapPriority(issue.priority);
  const createdDate = normalizeDate(issue.createdAt);
  const completedDate = issue.completedAt ? normalizeDate(issue.completedAt) : null;
  const stateName = issue.state?.name ?? 'Unknown';
  const assigneeName = issue.assignee?.name ?? null;
  const creatorName = issue.creator?.name ?? null;
  const projectName = issue.project?.name ?? null;
  const teamKey = issue.team?.key ?? '';

  const detail: LinearDetailRow = {
    linearId: issue.id,
    linearKey: issue.identifier,
    priority: priorityLabel,
    createdDate,
    url: issue.url,
    title: issue.title,
    description: truncateDescription(issue.description),
    creator: creatorName,
    state: stateName,
    assignee: assigneeName,
    project: projectName,
    team: teamKey,
    estimate: issue.estimate ?? null,
    statusChangeDate: completedDate, // Use completedAt as status change proxy
    completedDate,
    calculatedStoryPoints: null,
  };

  logger.trace(CLASS_NAME, 'extractLinearDetail', `Extracted: ${issue.identifier} (${stateName})`);
  return detail;
}

/**
 * Map a Linear numeric priority value to its human-readable label.
 *
 * @param priority - Linear priority value (0-4)
 * @returns Human-readable priority string
 */
export function mapPriority(priority: number): string {
  return PRIORITY_MAP[priority] ?? 'None';
}

/**
 * Normalize a date value to a Date object.
 * Handles both Date objects and ISO date strings from Linear SDK.
 *
 * @param dateValue - A Date object or ISO date string
 * @returns A Date object, or current date if unparseable
 */
function normalizeDate(dateValue: Date | string): Date {
  if (dateValue instanceof Date) {
    return dateValue;
  }
  const parsed = new Date(dateValue);
  if (isNaN(parsed.getTime())) {
    const logger = LoggerService.getInstance();
    logger.warn(CLASS_NAME, 'normalizeDate', `Unparseable date: ${String(dateValue)}`);
    return new Date();
  }
  return parsed;
}

/**
 * Truncate description to a reasonable length for database storage.
 * Linear descriptions can be very long markdown documents.
 *
 * @param description - The raw description
 * @returns Truncated description or null
 */
function truncateDescription(description: string | null | undefined): string | null {
  if (!description) {
    return null;
  }
  const maxLength = 10000;
  if (description.length <= maxLength) {
    return description;
  }
  return description.substring(0, maxLength) + '...';
}
