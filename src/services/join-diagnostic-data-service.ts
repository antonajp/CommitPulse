/**
 * Data service for Join Diagnostic Tool.
 * Executes diagnostic queries to identify join failures between
 * commit_contributors and jira_detail tables.
 *
 * Ticket: GITX-183
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import {
  QUERY_DIAGNOSTIC_CONTRIBUTOR_SUMMARY,
  QUERY_DIAGNOSTIC_JIRA_MATCH_STATS,
  QUERY_DIAGNOSTIC_UNMATCHED_ISSUES,
  QUERY_DIAGNOSTIC_ALL_CONTRIBUTORS,
  QUERY_DIAGNOSTIC_ORPHANED_ASSIGNEES,
  type ContributorSummary as DbContributorSummary,
  type JiraMatchStats as DbJiraMatchStats,
  type UnmatchedIssue as DbUnmatchedIssue,
  type ContributorAlignment as DbContributorAlignment,
  type OrphanedAssignee as DbOrphanedAssignee,
} from '../database/queries/join-diagnostic-queries.js';

const CLASS_NAME = 'JoinDiagnosticDataService';
const MAX_DEVELOPER_NAME_LENGTH = 200; // CWE-20: Input validation

/**
 * Mapped types with camelCase property names for UI layer.
 * Database query types use snake_case (from join-diagnostic-queries.ts).
 */
export interface ContributorSummary {
  login: string;
  fullName: string;
  jiraName: string | null;
  email: string;
  alignmentStatus: 'Not Aligned' | 'Aligned (Same Value)' | 'Aligned (Different Value)';
}

export interface JiraMatchStats {
  matchedCount: number;
  matchedStoryPoints: number;
  unmatchedCount: number;
  unmatchedStoryPoints: number;
}

export interface UnmatchedIssue {
  jiraKey: string;
  summary: string;
  jiraAssignee: string;
  contributorFullName: string;
  contributorJiraName: string | null;
  calculatedStoryPoints: number;
  status: string;
  mismatchReason: 'jira_name not set' | 'Assignee mismatch' | 'Unknown';
}

export interface ContributorAlignment {
  login: string;
  fullName: string;
  jiraName: string | null;
  alignmentStatus: 'Not Aligned' | 'Aligned (Same)' | 'Aligned (Different)';
  commitCount: number;
}

export interface OrphanedAssignee {
  assignee: string;
  issueCount: number;
  totalStoryPoints: number;
}

/**
 * Data service for Join Diagnostic Tool queries.
 * Provides diagnostic data to help identify why Developer Profile story points
 * may be missing due to commit_contributors <-> jira_detail join failures.
 *
 * Ticket: GITX-183
 */
export class JoinDiagnosticDataService {
  private readonly db: DatabaseService;
  private readonly logger: LoggerService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'JoinDiagnosticDataService created');
  }

  /**
   * Validate developer identifier at runtime.
   * Security: CWE-20 input validation for SQL injection prevention (defense-in-depth).
   *
   * @param developer - The developer identifier (full_name or login) to validate
   * @param methodName - Calling method name for log context
   */
  private validateDeveloper(developer: string, methodName: string): void {
    if (!developer || developer.trim().length === 0) {
      this.logger.warn(CLASS_NAME, methodName, 'Empty developer identifier rejected');
      throw new Error('Developer identifier is required.');
    }
    if (developer.length > MAX_DEVELOPER_NAME_LENGTH) {
      this.logger.warn(CLASS_NAME, methodName, `Developer identifier exceeds max length: ${developer.length} > ${MAX_DEVELOPER_NAME_LENGTH}`);
      throw new Error(`Developer identifier exceeds maximum length of ${MAX_DEVELOPER_NAME_LENGTH} characters.`);
    }
  }

  /**
   * Get contributor summary including alignment status.
   * Shows how a contributor's Git identity maps to their Jira identity.
   *
   * @param developer - Developer identifier (full_name or login)
   * @returns Contributor summary or null if not found
   */
  async getContributorSummary(developer: string): Promise<ContributorSummary | null> {
    this.validateDeveloper(developer, 'getContributorSummary');
    this.logger.debug(CLASS_NAME, 'getContributorSummary', `Fetching contributor summary for: ${developer}`);

    try {
      const result = await this.db.query<DbContributorSummary>(
        QUERY_DIAGNOSTIC_CONTRIBUTOR_SUMMARY,
        [developer]
      );

      if (result.rowCount === 0 || !result.rows[0]) {
        this.logger.debug(CLASS_NAME, 'getContributorSummary', `No contributor found for: ${developer}`);
        return null;
      }

      const row = result.rows[0];
      this.logger.debug(CLASS_NAME, 'getContributorSummary', `Found contributor: ${row.full_name}, status: ${row.alignment_status}`);

      return {
        login: row.login,
        fullName: row.full_name,
        jiraName: row.jira_name,
        email: row.email,
        alignmentStatus: row.alignment_status,
      };
    } catch (error) {
      this.logger.error(CLASS_NAME, 'getContributorSummary', `Failed to fetch contributor summary: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get Jira join match statistics for a developer.
   * Compares matched vs unmatched Jira issues to reveal missing story points.
   *
   * @param developer - Developer identifier (full_name or login)
   * @returns Match statistics with matched/unmatched counts and story points
   */
  async getJiraMatchStats(developer: string): Promise<JiraMatchStats> {
    this.validateDeveloper(developer, 'getJiraMatchStats');
    this.logger.debug(CLASS_NAME, 'getJiraMatchStats', `Fetching Jira match stats for: ${developer}`);

    try {
      const result = await this.db.query<DbJiraMatchStats>(
        QUERY_DIAGNOSTIC_JIRA_MATCH_STATS,
        [developer]
      );

      const row = result.rows[0];
      if (!row) {
        this.logger.debug(CLASS_NAME, 'getJiraMatchStats', `No match stats found for: ${developer}`);
        return {
          matchedCount: 0,
          matchedStoryPoints: 0,
          unmatchedCount: 0,
          unmatchedStoryPoints: 0,
        };
      }

      this.logger.debug(
        CLASS_NAME,
        'getJiraMatchStats',
        `Matched: ${row.matched_count} issues (${row.matched_story_points} pts), Unmatched: ${row.unmatched_count} issues (${row.unmatched_story_points} pts)`
      );

      return {
        matchedCount: row.matched_count,
        matchedStoryPoints: row.matched_story_points,
        unmatchedCount: row.unmatched_count,
        unmatchedStoryPoints: row.unmatched_story_points,
      };
    } catch (error) {
      this.logger.error(CLASS_NAME, 'getJiraMatchStats', `Failed to fetch Jira match stats: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get list of unmatched Jira issues for a developer.
   * Shows issues where assignee matches full_name but not jira_name.
   * Limited to 50 issues for UI performance.
   *
   * @param developer - Developer identifier (full_name or login)
   * @returns Array of unmatched issues with mismatch reasons
   */
  async getUnmatchedIssues(developer: string): Promise<UnmatchedIssue[]> {
    this.validateDeveloper(developer, 'getUnmatchedIssues');
    this.logger.debug(CLASS_NAME, 'getUnmatchedIssues', `Fetching unmatched issues for: ${developer}`);

    try {
      const result = await this.db.query<DbUnmatchedIssue>(
        QUERY_DIAGNOSTIC_UNMATCHED_ISSUES,
        [developer]
      );

      this.logger.debug(CLASS_NAME, 'getUnmatchedIssues', `Found ${result.rowCount} unmatched issues`);

      return result.rows.map((row) => ({
        jiraKey: row.jira_key,
        summary: row.summary,
        jiraAssignee: row.jira_assignee,
        contributorFullName: row.contributor_full_name,
        contributorJiraName: row.contributor_jira_name,
        calculatedStoryPoints: row.calculated_story_points,
        status: row.status,
        mismatchReason: row.mismatch_reason,
      }));
    } catch (error) {
      this.logger.error(CLASS_NAME, 'getUnmatchedIssues', `Failed to fetch unmatched issues: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get all contributors with alignment status.
   * Useful for team-wide audit to identify which contributors need alignment.
   * Ordered by full_name for easy scanning.
   *
   * @returns Array of all contributors with alignment status and commit count
   */
  async getAllContributors(): Promise<ContributorAlignment[]> {
    this.logger.debug(CLASS_NAME, 'getAllContributors', 'Fetching all contributors');

    try {
      const result = await this.db.query<DbContributorAlignment>(
        QUERY_DIAGNOSTIC_ALL_CONTRIBUTORS
      );

      this.logger.debug(CLASS_NAME, 'getAllContributors', `Found ${result.rowCount} contributors`);

      return result.rows.map((row) => ({
        login: row.login,
        fullName: row.full_name,
        jiraName: row.jira_name,
        alignmentStatus: row.alignment_status,
        commitCount: row.commit_count,
      }));
    } catch (error) {
      this.logger.error(CLASS_NAME, 'getAllContributors', `Failed to fetch all contributors: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get orphaned Jira assignees not in commit_contributors.
   * These are assignees with completed Jira issues but no Git commits.
   * Limited to top 20 by story points for UI performance.
   *
   * @returns Array of orphaned assignees with issue count and story points
   */
  async getOrphanedAssignees(): Promise<OrphanedAssignee[]> {
    this.logger.debug(CLASS_NAME, 'getOrphanedAssignees', 'Fetching orphaned assignees');

    try {
      const result = await this.db.query<DbOrphanedAssignee>(
        QUERY_DIAGNOSTIC_ORPHANED_ASSIGNEES
      );

      this.logger.debug(CLASS_NAME, 'getOrphanedAssignees', `Found ${result.rowCount} orphaned assignees`);

      return result.rows.map((row) => ({
        assignee: row.assignee,
        issueCount: row.issue_count,
        totalStoryPoints: row.total_story_points,
      }));
    } catch (error) {
      this.logger.error(CLASS_NAME, 'getOrphanedAssignees', `Failed to fetch orphaned assignees: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
