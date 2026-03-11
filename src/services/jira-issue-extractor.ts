/**
 * Jira issue field extraction functions.
 *
 * Converts Python JiraApi.py field extraction to TypeScript.
 * Separated from JiraService for the 600-line file limit.
 *
 * Maps:
 *   save_issue_details -> extractIssueDetail
 *   save_issue_link    -> extractIssueLinks
 *   save_issue_parent  -> extractIssueParent
 *
 * Ticket: IQS-856
 */

import { Version3Models } from 'jira.js';

// Type alias for cleaner code
type Issue = Version3Models.Issue;
import { LoggerService } from '../logging/logger.js';
import type {
  JiraDetailRow,
  JiraIssueLinkRow,
  JiraParentRow,
} from '../database/jira-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'JiraIssueExtractor';

// ============================================================================
// Configuration type
// ============================================================================

/**
 * Configuration needed for field extraction.
 */
export interface JiraExtractorConfig {
  /** Jira server URL for constructing issue URLs. */
  readonly server: string;
  /** Custom field ID for story points (default: customfield_10034). */
  readonly pointsField: string;
}

// ============================================================================
// Issue detail extraction
// ============================================================================

/**
 * Extract a JiraDetailRow from a jira.js Issue object.
 * Maps from Python JiraApi.save_issue_details().
 *
 * CRITICAL: The Python version hardcoded the Jira server URL in the URL field.
 * This TypeScript version uses the configured server URL.
 *
 * @param issue - The jira.js Issue object
 * @param projectKey - The project key for URL construction
 * @param config - Extraction configuration
 * @returns A JiraDetailRow ready for database upsert
 */
export function extractIssueDetail(
  issue: Issue,
  projectKey: string,
  config: JiraExtractorConfig,
): JiraDetailRow {
  const logger = LoggerService.getInstance();
  logger.trace(CLASS_NAME, 'extractIssueDetail', `Extracting detail for: ${issue.key}`);

  const fields = issue.fields;

  // Extract fixversion - first version name, matching Python behavior
  const fixversion = extractFixVersion(fields);

  // Extract component - first component name, matching Python behavior
  const component = extractComponent(fields);

  // Extract points from configurable custom field
  const points = extractPoints(fields, config.pointsField);

  // Extract reporter display name
  const reporter = extractDisplayName(fields.reporter);

  // Extract assignee display name
  const assignee = extractDisplayName(fields.assignee);

  // Construct URL using configured server (replaces Python hardcoded URL)
  const url = `${config.server}/browse/${issue.key}`;

  // Extract resolution as string
  const resolution = fields.resolution?.name ?? null;

  // Extract status category change date
  const statusChangeDate = parseJiraDate(fields.statuscategorychangedate as string | undefined);

  const detail: JiraDetailRow = {
    jiraId: issue.id,
    jiraKey: issue.key,
    priority: fields.priority?.name ?? 'None',
    createdDate: new Date(fields.created),
    url,
    summary: fields.summary ?? '',
    description: null, // Description is a Document type in V3, not a simple string
    reporter,
    issuetype: fields.issuetype?.name ?? fields.issueType?.name ?? 'Unknown',
    project: projectKey,
    resolution,
    assignee,
    status: fields.status?.name ?? 'Unknown',
    fixversion,
    component,
    statusChangeDate,
    points,
    calculatedStoryPoints: null,
  };

  logger.trace(CLASS_NAME, 'extractIssueDetail', `Extracted: ${issue.key} (${detail.status})`);
  return detail;
}

// ============================================================================
// Issue link extraction
// ============================================================================

/**
 * Extract issue links from a jira.js Issue.
 * Maps from Python JiraApi.save_issue_link().
 *
 * @param jiraKey - The key of the issue containing the links
 * @param issue - The jira.js Issue object
 * @returns Array of JiraIssueLinkRow ready for database insertion
 */
export function extractIssueLinks(jiraKey: string, issue: Issue): JiraIssueLinkRow[] {
  const logger = LoggerService.getInstance();
  logger.trace(CLASS_NAME, 'extractIssueLinks', `Extracting links for: ${jiraKey}`);

  const issueLinks = issue.fields.issuelinks;
  if (!issueLinks || issueLinks.length === 0) {
    logger.trace(CLASS_NAME, 'extractIssueLinks', `No links found for: ${jiraKey}`);
    return [];
  }

  const links: JiraIssueLinkRow[] = [];
  for (const link of issueLinks) {
    try {
      // Determine direction - inward or outward
      // Maps from Python's try/except KeyError pattern for inwardIssue/outwardIssue
      let linkType: string;
      let linkKey: string;
      let linkStatus: string | null;
      let linkPriority: string | null;
      let issueType: string | null;

      if (link.inwardIssue) {
        linkType = link.type?.inward ?? 'unknown';
        linkKey = link.inwardIssue.key ?? '';
        linkStatus = link.inwardIssue.fields?.status?.name ?? null;
        linkPriority = link.inwardIssue.fields?.priority?.name ?? null;
        issueType = link.inwardIssue.fields?.issuetype?.name
          ?? link.inwardIssue.fields?.issueType?.name ?? null;
      } else if (link.outwardIssue) {
        linkType = link.type?.outward ?? 'unknown';
        linkKey = link.outwardIssue.key ?? '';
        linkStatus = link.outwardIssue.fields?.status?.name ?? null;
        linkPriority = link.outwardIssue.fields?.priority?.name ?? null;
        issueType = link.outwardIssue.fields?.issuetype?.name
          ?? link.outwardIssue.fields?.issueType?.name ?? null;
      } else {
        logger.warn(CLASS_NAME, 'extractIssueLinks', `Link for ${jiraKey} has neither inward nor outward issue, skipping`);
        continue;
      }

      links.push({
        jiraKey,
        linkType,
        linkKey,
        linkStatus,
        linkPriority,
        issueType,
      });

      logger.trace(CLASS_NAME, 'extractIssueLinks', `Link: ${jiraKey} -[${linkType}]-> ${linkKey}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(CLASS_NAME, 'extractIssueLinks', `Error extracting link for ${jiraKey}: ${message}`);
    }
  }

  logger.debug(CLASS_NAME, 'extractIssueLinks', `Extracted ${links.length} links for: ${jiraKey}`);
  return links;
}

// ============================================================================
// Parent extraction
// ============================================================================

/**
 * Extract parent issue information from a jira.js Issue.
 * Maps from Python JiraApi.save_issue_parent().
 *
 * @param jiraKey - The key of the child issue
 * @param issue - The jira.js Issue object
 * @returns JiraParentRow if the issue has a parent, null otherwise
 */
export function extractIssueParent(jiraKey: string, issue: Issue): JiraParentRow | null {
  const logger = LoggerService.getInstance();
  logger.trace(CLASS_NAME, 'extractIssueParent', `Extracting parent for: ${jiraKey}`);

  const parent = issue.fields.parent;
  if (!parent) {
    logger.trace(CLASS_NAME, 'extractIssueParent', `No parent found for: ${jiraKey}`);
    return null;
  }

  const parentRow: JiraParentRow = {
    jiraKey,
    parentKey: parent.key,
    parentSummary: parent.fields?.summary ?? null,
    parentType: parent.fields?.issuetype?.name
      ?? parent.fields?.issueType?.name ?? null,
  };

  logger.trace(CLASS_NAME, 'extractIssueParent', `Parent: ${jiraKey} -> ${parentRow.parentKey}`);
  return parentRow;
}

// ============================================================================
// Field extraction helpers
// ============================================================================

/**
 * Extract the first fix version name from the issue fields.
 * Matches Python behavior: takes only the first fixVersion.
 */
function extractFixVersion(fields: Issue['fields']): string | null {
  const fixVersions = fields.fixVersions;
  if (fixVersions && fixVersions.length > 0 && fixVersions[0]) {
    return fixVersions[0].name ?? null;
  }
  return null;
}

/**
 * Extract the first component name from the issue fields.
 * Matches Python behavior: takes only the first component.
 */
function extractComponent(fields: Issue['fields']): string | null {
  const components = fields.components;
  if (components && components.length > 0 && components[0]) {
    return components[0].name ?? null;
  }
  return null;
}

/**
 * Extract story points from the configurable custom field.
 * Matches Python's customfield_10034 handling.
 */
function extractPoints(fields: Issue['fields'], pointsFieldId: string): number | null {
  const rawPoints = fields[pointsFieldId] as number | null | undefined;
  if (rawPoints !== null && rawPoints !== undefined && typeof rawPoints === 'number') {
    return rawPoints;
  }
  return null;
}

/**
 * Extract display name from a user-like object.
 * Handles both User and UserDetails types from jira.js.
 */
function extractDisplayName(user: { displayName?: string } | null | undefined): string | null {
  if (user && user.displayName) {
    return user.displayName;
  }
  return null;
}

/**
 * Parse a Jira date string to a Date object.
 * Returns null if the input is null, undefined, or unparseable.
 */
export function parseJiraDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) {
    return null;
  }
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    const logger = LoggerService.getInstance();
    logger.warn(CLASS_NAME, 'parseJiraDate', `Unparseable date: ${dateStr}`);
    return null;
  }
  return parsed;
}
