/**
 * Data service for the File Author LOC Contribution Report.
 * Provides methods to fetch file-level author contributions from the database.
 *
 * The report helps engineering teams:
 * - Identify code ownership per file
 * - Plan knowledge transfer
 * - Analyze contributor distribution for code reviews
 * - Understand file expertise patterns
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces limits per CWE-20 requirements.
 *
 * Ticket: GITX-128
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import { validateFilePaths, MAX_FILE_COUNT } from '../utils/file-path-validation.js';
import {
  QUERY_FILE_AUTHOR_LOC,
  QUERY_FILE_AUTHOR_LOC_BY_REPO,
  QUERY_FILE_AUTHOR_COMMITS,
  QUERY_DISTINCT_REPOSITORIES,
} from '../database/queries/file-author-loc-queries.js';
import type {
  FileAuthorLocRow,
  FileAuthorLocDbRow,
  FileAuthorLocFilters,
  FileAuthorLocChartData,
  FileAuthorCommitDetail,
  FileAuthorCommitDbRow,
} from './file-author-loc-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'FileAuthorLocService';

/**
 * Service responsible for querying file author LOC contribution data
 * and returning typed data for the webview visualization.
 *
 * Ticket: GITX-128
 */
export class FileAuthorLocService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'FileAuthorLocService created');
  }

  /**
   * Validate date range filters.
   * Validates format and ensures start date is before end date.
   *
   * @param startDate - Start date string (YYYY-MM-DD)
   * @param endDate - End date string (YYYY-MM-DD)
   * @throws Error if dates are invalid
   */
  private validateDateRange(startDate: string, endDate: string): void {
    if (!isValidDateString(startDate)) {
      this.logger.warn(CLASS_NAME, 'validateDateRange', `Invalid start date: ${startDate}`);
      throw new Error(`Invalid start date format: ${startDate}. Expected YYYY-MM-DD.`);
    }

    if (!isValidDateString(endDate)) {
      this.logger.warn(CLASS_NAME, 'validateDateRange', `Invalid end date: ${endDate}`);
      throw new Error(`Invalid end date format: ${endDate}. Expected YYYY-MM-DD.`);
    }

    if (startDate > endDate) {
      this.logger.warn(CLASS_NAME, 'validateDateRange', `Invalid range: ${startDate} > ${endDate}`);
      throw new Error(`Start date (${startDate}) must be before or equal to end date (${endDate})`);
    }
  }

  /**
   * Calculate default date range based on days ago.
   *
   * @param daysAgo - Number of days to look back
   * @returns Object with startDate and endDate strings
   */
  private getDefaultDateRange(daysAgo = 90): { startDate: string; endDate: string } {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    return {
      startDate: startDate.toISOString().split('T')[0] ?? '',
      endDate: endDate.toISOString().split('T')[0] ?? '',
    };
  }

  /**
   * Map database row to FileAuthorLocRow.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToFileAuthorLoc(row: FileAuthorLocDbRow): FileAuthorLocRow {
    const firstCommit =
      row.first_commit instanceof Date
        ? row.first_commit.toISOString().split('T')[0] ?? ''
        : String(row.first_commit);

    const lastCommit =
      row.last_commit instanceof Date
        ? row.last_commit.toISOString().split('T')[0] ?? ''
        : String(row.last_commit);

    return {
      filename: row.filename,
      author: row.author,
      authorName: row.author_name,
      team: row.team,
      linesAdded: Number(row.lines_added),
      linesDeleted: Number(row.lines_deleted),
      netLines: Number(row.net_lines),
      totalChurn: Number(row.total_churn),
      commitCount: Number(row.commit_count),
      firstCommit,
      lastCommit,
    };
  }

  /**
   * Map database row to FileAuthorCommitDetail.
   */
  private mapRowToCommitDetail(row: FileAuthorCommitDbRow): FileAuthorCommitDetail {
    const commitDate =
      row.commit_date instanceof Date
        ? row.commit_date.toISOString().split('T')[0] ?? ''
        : String(row.commit_date);

    // Truncate message to first line
    const message = String(row.message).split('\n')[0] ?? '';

    return {
      sha: row.sha,
      commitDate,
      author: row.author,
      message,
      linesAdded: Number(row.lines_added),
      linesDeleted: Number(row.lines_deleted),
    };
  }

  /**
   * Fetch author contributions for specified files within a date range.
   *
   * @param filters - File paths and date range filters
   * @returns Chart data with aggregated contributions
   */
  async getFileAuthorContributions(filters: FileAuthorLocFilters): Promise<FileAuthorLocChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getFileAuthorContributions',
      `Fetching contributions for ${filters.filePaths.length} files`,
    );

    // Validate file paths
    const pathValidation = validateFilePaths(filters.filePaths);
    if (!pathValidation.valid) {
      this.logger.warn(
        CLASS_NAME,
        'getFileAuthorContributions',
        `Invalid file paths: ${pathValidation.errors.join(', ')}`,
      );
      throw new Error(`Invalid file paths: ${pathValidation.errors.join('; ')}`);
    }

    if (pathValidation.paths.length === 0) {
      this.logger.warn(CLASS_NAME, 'getFileAuthorContributions', 'No valid file paths provided');
      throw new Error('At least one valid file path is required');
    }

    if (pathValidation.paths.length > MAX_FILE_COUNT) {
      throw new Error(`Too many files: maximum ${MAX_FILE_COUNT} allowed`);
    }

    // Get or calculate date range
    const defaultRange = this.getDefaultDateRange();
    const startDate = filters.startDate ?? defaultRange.startDate;
    const endDate = filters.endDate ?? defaultRange.endDate;

    // Validate date range
    this.validateDateRange(startDate, endDate);

    this.logger.debug(
      CLASS_NAME,
      'getFileAuthorContributions',
      `Query params: files=${pathValidation.paths.length}, startDate=${startDate}, endDate=${endDate}`,
    );

    // Select query based on whether repository filter is provided
    let result;
    if (filters.repository) {
      this.logger.debug(
        CLASS_NAME,
        'getFileAuthorContributions',
        `Filtering by repository: ${filters.repository}`,
      );
      result = await this.db.query<FileAuthorLocDbRow>(QUERY_FILE_AUTHOR_LOC_BY_REPO, [
        pathValidation.paths,
        startDate,
        endDate,
        filters.repository,
      ]);
    } else {
      result = await this.db.query<FileAuthorLocDbRow>(QUERY_FILE_AUTHOR_LOC, [
        pathValidation.paths,
        startDate,
        endDate,
      ]);
    }

    this.logger.debug(
      CLASS_NAME,
      'getFileAuthorContributions',
      `Query returned ${result.rows.length} rows`,
    );

    const rows: FileAuthorLocRow[] = result.rows.map((row) => this.mapRowToFileAuthorLoc(row));

    // Extract unique authors and files
    const authorsSet = new Set<string>();
    const filesSet = new Set<string>();

    for (const row of rows) {
      authorsSet.add(row.authorName);
      filesSet.add(row.filename);
    }

    const authors = Array.from(authorsSet).sort();
    const files = Array.from(filesSet).sort();

    this.logger.info(
      CLASS_NAME,
      'getFileAuthorContributions',
      `Returning ${rows.length} contribution records for ${files.length} files by ${authors.length} authors`,
    );

    return {
      rows,
      hasData: rows.length > 0,
      authors,
      files,
      dateRange: { startDate, endDate },
    };
  }

  /**
   * Fetch commit details for a specific file and author (drill-down).
   *
   * @param filename - File path to drill down into
   * @param author - Author login to filter by
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @returns Array of commit details
   */
  async getCommitDetails(
    filename: string,
    author: string,
    startDate: string,
    endDate: string,
  ): Promise<readonly FileAuthorCommitDetail[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCommitDetails',
      `Fetching commits for ${filename} by ${author}`,
    );

    // Validate inputs
    const pathValidation = validateFilePaths([filename]);
    if (!pathValidation.valid) {
      throw new Error(`Invalid file path: ${filename}`);
    }

    this.validateDateRange(startDate, endDate);

    if (!author || typeof author !== 'string' || author.length > 256) {
      throw new Error('Invalid author parameter');
    }

    const result = await this.db.query<FileAuthorCommitDbRow>(QUERY_FILE_AUTHOR_COMMITS, [
      pathValidation.paths[0],
      author,
      startDate,
      endDate,
    ]);

    this.logger.debug(
      CLASS_NAME,
      'getCommitDetails',
      `Query returned ${result.rows.length} commits`,
    );

    return result.rows.map((row) => this.mapRowToCommitDetail(row));
  }

  /**
   * Fetch list of available repositories.
   *
   * @returns Array of repository names
   */
  async getRepositories(): Promise<readonly string[]> {
    this.logger.debug(CLASS_NAME, 'getRepositories', 'Fetching repositories');

    const result = await this.db.query<{ repository: string }>(QUERY_DISTINCT_REPOSITORIES);

    const repos = result.rows.map((r) => r.repository).filter((r) => r !== null && r !== undefined);
    this.logger.debug(CLASS_NAME, 'getRepositories', `Found ${repos.length} repositories`);

    return repos;
  }
}
