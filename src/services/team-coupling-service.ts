/**
 * Data service for the Cross-Team Coupling Dashboard.
 * Provides methods to fetch coupling data from the vw_team_coupling
 * and vw_team_shared_files database views, with optional filtering.
 *
 * The Cross-Team Coupling dashboard helps engineering architects understand:
 *   - Which teams are architecturally entangled through shared code?
 *   - What files are being modified by multiple teams?
 *   - Where are potential ownership boundaries being crossed?
 *   - Which areas need architectural attention or ownership clarification?
 *
 * All queries use parameterized SQL ($1, $2 placeholders) per CWE-89 requirements.
 * Input validation enforces string length limits per CWE-20 requirements.
 *
 * Ticket: IQS-909
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import {
  QUERY_COUPLING_VIEW_EXISTS,
  QUERY_SHARED_FILES_VIEW_EXISTS,
  QUERY_COUPLING_ALL,
  QUERY_COUPLING_BY_MIN_STRENGTH,
  QUERY_COUPLING_BY_TEAM,
  QUERY_COUPLING_BY_TEAM_PAIR,
  QUERY_COUPLING_COMBINED,
  QUERY_SHARED_FILES_ALL,
  QUERY_SHARED_FILES_BY_TEAM_PAIR,
  QUERY_SHARED_FILES_BY_TEAM,
  QUERY_COUPLING_SUMMARY,
  QUERY_UNIQUE_TEAMS,
  type CouplingDbRow,
  type SharedFileDbRow,
  type CouplingSummaryDbRow,
  type UniqueTeamDbRow,
} from '../database/queries/coupling-queries.js';
import type {
  CouplingFilters,
  TeamCouplingRow,
  ChordData,
  SharedFileDetail,
  CouplingMatrixSummary,
  CouplingChartData,
  SharedFilesChartData,
} from './team-coupling-types.js';
import {
  COUPLING_MAX_FILTER_LENGTH,
  COUPLING_MAX_RESULT_ROWS,
} from './team-coupling-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'TeamCouplingDataService';

/**
 * Service responsible for querying the vw_team_coupling and
 * vw_team_shared_files database views and returning typed data for
 * the Cross-Team Coupling Dashboard.
 *
 * Ticket: IQS-909
 */
export class TeamCouplingDataService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'TeamCouplingDataService created');
  }

  /**
   * Check if the vw_team_coupling view exists.
   * Used for graceful degradation when migration 017 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkCouplingViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkCouplingViewExists', 'Checking vw_team_coupling existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_COUPLING_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkCouplingViewExists', `vw_team_coupling exists: ${exists}`);
    return exists;
  }

  /**
   * Check if the vw_team_shared_files view exists.
   * Used for graceful degradation when migration 017 has not been applied.
   *
   * @returns true if the view exists
   */
  async checkSharedFilesViewExists(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'checkSharedFilesViewExists', 'Checking vw_team_shared_files existence');

    const result = await this.db.query<{ view_exists: boolean }>(QUERY_SHARED_FILES_VIEW_EXISTS);
    const exists = result.rows[0]?.view_exists ?? false;

    this.logger.debug(CLASS_NAME, 'checkSharedFilesViewExists', `vw_team_shared_files exists: ${exists}`);
    return exists;
  }

  /**
   * Validate string filter inputs.
   * Enforces maximum length to prevent DoS attacks (CWE-20).
   *
   * @param value - String value to validate
   * @param fieldName - Name of the field for error message
   * @throws Error if value exceeds maximum length
   */
  private validateStringFilter(value: string | undefined, fieldName: string): void {
    if (value && value.length > COUPLING_MAX_FILTER_LENGTH) {
      this.logger.warn(
        CLASS_NAME,
        'validateStringFilter',
        `${fieldName} exceeds max length: ${value.length} > ${COUPLING_MAX_FILTER_LENGTH}`
      );
      throw new Error(
        `${fieldName} exceeds maximum length of ${COUPLING_MAX_FILTER_LENGTH} characters`
      );
    }
  }

  /**
   * Validate numeric filter inputs.
   * Ensures coupling strength is in valid range (0-100).
   *
   * @param value - Numeric value to validate
   * @param fieldName - Name of the field for error message
   * @throws Error if value is out of range
   */
  private validateNumericFilter(value: number | undefined, fieldName: string): void {
    if (value !== undefined) {
      if (isNaN(value) || value < 0 || value > 100) {
        this.logger.warn(CLASS_NAME, 'validateNumericFilter', `Invalid ${fieldName}: ${value}`);
        throw new Error(`Invalid ${fieldName}: must be between 0 and 100`);
      }
    }
  }

  /**
   * Map database row to TeamCouplingRow.
   * Converts snake_case to camelCase and handles type conversions.
   */
  private mapRowToCouplingRow(row: CouplingDbRow): TeamCouplingRow {
    return {
      teamA: row.team_a,
      teamB: row.team_b,
      sharedFileCount: Number(row.shared_file_count),
      totalSharedCommits: Number(row.total_shared_commits),
      couplingStrength: Number(row.coupling_strength),
      hotspotFiles: row.hotspot_files ?? [],
    };
  }

  /**
   * Map database row to SharedFileDetail.
   * Converts Date objects to ISO strings and snake_case to camelCase.
   */
  private mapRowToSharedFileDetail(row: SharedFileDbRow): SharedFileDetail {
    const lastModified =
      row.last_modified instanceof Date
        ? row.last_modified.toISOString()
        : String(row.last_modified);

    return {
      filePath: row.file_path,
      repository: row.repository,
      teamACommits: Number(row.team_a_commits),
      teamBCommits: Number(row.team_b_commits),
      teamAContributors: Number(row.team_a_contributors),
      teamBContributors: Number(row.team_b_contributors),
      lastModified,
      totalCommits: Number(row.total_commits),
    };
  }

  /**
   * Fetch coupling matrix data with optional filters.
   *
   * @param filters - Optional filters for team, min strength
   * @returns Array of TeamCouplingRow sorted by shared_file_count descending
   */
  async getCouplingMatrix(filters: CouplingFilters = {}): Promise<readonly TeamCouplingRow[]> {
    this.logger.debug(
      CLASS_NAME,
      'getCouplingMatrix',
      `Fetching coupling matrix: filters=${JSON.stringify(filters)}`
    );

    // Validate all filters
    this.validateStringFilter(filters.teamA, 'teamA');
    this.validateStringFilter(filters.teamB, 'teamB');
    this.validateNumericFilter(filters.minCouplingStrength, 'minCouplingStrength');

    // Determine which query to use based on filter combination
    const hasTeamA = Boolean(filters.teamA);
    const hasTeamB = Boolean(filters.teamB);
    const hasMinStrength = filters.minCouplingStrength !== undefined;

    let sql: string;
    let params: unknown[];

    // Select optimal query based on filter combination
    if (!hasTeamA && !hasTeamB && !hasMinStrength) {
      // No filters - use simple query
      sql = QUERY_COUPLING_ALL;
      params = [];
      this.logger.debug(CLASS_NAME, 'getCouplingMatrix', 'Using unfiltered query');
    } else if (hasTeamA && hasTeamB && !hasMinStrength) {
      // Both teams specified - use team pair query
      sql = QUERY_COUPLING_BY_TEAM_PAIR;
      params = [filters.teamA, filters.teamB];
      this.logger.debug(CLASS_NAME, 'getCouplingMatrix', 'Using team pair query');
    } else if ((hasTeamA || hasTeamB) && !hasMinStrength) {
      // Single team filter
      sql = QUERY_COUPLING_BY_TEAM;
      params = [filters.teamA ?? filters.teamB];
      this.logger.debug(CLASS_NAME, 'getCouplingMatrix', 'Using single team query');
    } else if (!hasTeamA && !hasTeamB && hasMinStrength) {
      // Only min strength filter
      sql = QUERY_COUPLING_BY_MIN_STRENGTH;
      params = [filters.minCouplingStrength];
      this.logger.debug(CLASS_NAME, 'getCouplingMatrix', 'Using min strength query');
    } else {
      // Combined filters
      sql = QUERY_COUPLING_COMBINED;
      params = [
        filters.teamA ?? null,
        filters.teamB ?? null,
        filters.minCouplingStrength ?? null,
      ];
      this.logger.debug(CLASS_NAME, 'getCouplingMatrix', 'Using combined filter query');
    }

    this.logger.trace(CLASS_NAME, 'getCouplingMatrix', `Params: ${JSON.stringify(params)}`);

    const result = await this.db.query<CouplingDbRow>(sql, params);

    this.logger.debug(
      CLASS_NAME,
      'getCouplingMatrix',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety (already in query but double-check)
    const limitedRows = result.rows.slice(0, COUPLING_MAX_RESULT_ROWS);
    if (result.rows.length > COUPLING_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getCouplingMatrix',
        `Result set truncated from ${result.rows.length} to ${COUPLING_MAX_RESULT_ROWS} rows`
      );
    }

    const couplingRows: TeamCouplingRow[] = limitedRows.map((row) => this.mapRowToCouplingRow(row));

    this.logger.debug(
      CLASS_NAME,
      'getCouplingMatrix',
      `Returning ${couplingRows.length} coupling records`
    );
    return couplingRows;
  }

  /**
   * Build chord diagram data from coupling matrix.
   * Creates a symmetric matrix suitable for D3 chord diagrams.
   *
   * @param couplingRows - Array of team coupling rows
   * @returns ChordData with teams and matrix
   */
  buildChordData(couplingRows: readonly TeamCouplingRow[]): ChordData {
    this.logger.debug(
      CLASS_NAME,
      'buildChordData',
      `Building chord data from ${couplingRows.length} rows`
    );

    // Extract unique teams
    const teamsSet = new Set<string>();
    for (const row of couplingRows) {
      teamsSet.add(row.teamA);
      teamsSet.add(row.teamB);
    }
    const teams = Array.from(teamsSet).sort();

    this.logger.debug(CLASS_NAME, 'buildChordData', `Found ${teams.length} unique teams`);

    // Create team index map
    const teamIndex = new Map<string, number>();
    teams.forEach((team, idx) => teamIndex.set(team, idx));

    // Initialize symmetric matrix with zeros
    const matrix: number[][] = teams.map(() => teams.map(() => 0));

    // Populate matrix with coupling strengths
    for (const row of couplingRows) {
      const i = teamIndex.get(row.teamA);
      const j = teamIndex.get(row.teamB);
      if (i !== undefined && j !== undefined) {
        // Use shared file count as the chord value (not strength percentage)
        // This gives better visual representation
        matrix[i]![j] = row.sharedFileCount;
        matrix[j]![i] = row.sharedFileCount; // Symmetric
      }
    }

    this.logger.debug(
      CLASS_NAME,
      'buildChordData',
      `Chord matrix: ${teams.length}x${teams.length}`
    );

    return { teams, matrix };
  }

  /**
   * Fetch shared files between two teams.
   *
   * @param teamA - First team name
   * @param teamB - Second team name
   * @returns Array of SharedFileDetail sorted by total_commits descending
   */
  async getSharedFiles(teamA: string, teamB: string): Promise<readonly SharedFileDetail[]> {
    this.logger.debug(
      CLASS_NAME,
      'getSharedFiles',
      `Fetching shared files: teamA=${teamA}, teamB=${teamB}`
    );

    // Validate inputs
    this.validateStringFilter(teamA, 'teamA');
    this.validateStringFilter(teamB, 'teamB');

    if (!teamA || !teamB) {
      this.logger.warn(CLASS_NAME, 'getSharedFiles', 'Both teamA and teamB are required');
      throw new Error('Both teamA and teamB are required');
    }

    const result = await this.db.query<SharedFileDbRow>(
      QUERY_SHARED_FILES_BY_TEAM_PAIR,
      [teamA, teamB]
    );

    this.logger.debug(
      CLASS_NAME,
      'getSharedFiles',
      `Query returned ${result.rows.length} rows`
    );

    // Apply row limit for safety
    const limitedRows = result.rows.slice(0, COUPLING_MAX_RESULT_ROWS);
    if (result.rows.length > COUPLING_MAX_RESULT_ROWS) {
      this.logger.warn(
        CLASS_NAME,
        'getSharedFiles',
        `Result set truncated from ${result.rows.length} to ${COUPLING_MAX_RESULT_ROWS} rows`
      );
    }

    const sharedFiles: SharedFileDetail[] = limitedRows.map((row) =>
      this.mapRowToSharedFileDetail(row)
    );

    this.logger.debug(
      CLASS_NAME,
      'getSharedFiles',
      `Returning ${sharedFiles.length} shared file records`
    );
    return sharedFiles;
  }

  /**
   * Fetch all shared files with optional filters.
   *
   * @param filters - Optional filters
   * @returns Array of SharedFileDetail sorted by total_commits descending
   */
  async getAllSharedFiles(filters: CouplingFilters = {}): Promise<readonly SharedFileDetail[]> {
    this.logger.debug(
      CLASS_NAME,
      'getAllSharedFiles',
      `Fetching all shared files: filters=${JSON.stringify(filters)}`
    );

    // Validate filters
    this.validateStringFilter(filters.teamA, 'teamA');
    this.validateStringFilter(filters.teamB, 'teamB');

    let sql: string;
    let params: unknown[];

    if (filters.teamA && filters.teamB) {
      sql = QUERY_SHARED_FILES_BY_TEAM_PAIR;
      params = [filters.teamA, filters.teamB];
    } else if (filters.teamA || filters.teamB) {
      sql = QUERY_SHARED_FILES_BY_TEAM;
      params = [filters.teamA ?? filters.teamB];
    } else {
      sql = QUERY_SHARED_FILES_ALL;
      params = [];
    }

    const result = await this.db.query<SharedFileDbRow>(sql, params);

    const limitedRows = result.rows.slice(0, COUPLING_MAX_RESULT_ROWS);
    const sharedFiles: SharedFileDetail[] = limitedRows.map((row) =>
      this.mapRowToSharedFileDetail(row)
    );

    this.logger.debug(
      CLASS_NAME,
      'getAllSharedFiles',
      `Returning ${sharedFiles.length} shared file records`
    );
    return sharedFiles;
  }

  /**
   * Get coupling summary statistics.
   *
   * @returns CouplingMatrixSummary with aggregate metrics
   */
  async getSummary(): Promise<CouplingMatrixSummary> {
    this.logger.debug(CLASS_NAME, 'getSummary', 'Fetching coupling summary');

    const result = await this.db.query<CouplingSummaryDbRow>(QUERY_COUPLING_SUMMARY);

    const row = result.rows[0];
    if (!row) {
      this.logger.debug(CLASS_NAME, 'getSummary', 'No summary data found');
      return {
        totalTeamPairs: 0,
        totalSharedFiles: 0,
        avgCouplingStrength: 0,
        maxCouplingStrength: 0,
        highestCouplingPair: null,
        uniqueTeams: 0,
      };
    }

    const summary: CouplingMatrixSummary = {
      totalTeamPairs: Number(row.total_team_pairs),
      totalSharedFiles: Number(row.total_shared_files),
      avgCouplingStrength: row.avg_coupling_strength !== null ? Number(row.avg_coupling_strength) : 0,
      maxCouplingStrength: row.max_coupling_strength !== null ? Number(row.max_coupling_strength) : 0,
      highestCouplingPair:
        row.highest_coupling_team_a && row.highest_coupling_team_b
          ? {
              teamA: row.highest_coupling_team_a,
              teamB: row.highest_coupling_team_b,
              strength: Number(row.highest_coupling_strength ?? 0),
            }
          : null,
      uniqueTeams: Number(row.unique_team_count),
    };

    this.logger.info(
      CLASS_NAME,
      'getSummary',
      `Summary: ${summary.totalTeamPairs} pairs, ${summary.uniqueTeams} teams, avg strength ${summary.avgCouplingStrength}`
    );

    return summary;
  }

  /**
   * Get list of unique teams in coupling data.
   *
   * @returns Array of team names
   */
  async getUniqueTeams(): Promise<readonly string[]> {
    this.logger.debug(CLASS_NAME, 'getUniqueTeams', 'Fetching unique teams');

    const result = await this.db.query<UniqueTeamDbRow>(QUERY_UNIQUE_TEAMS);

    const teams = result.rows.map((row) => row.team);

    this.logger.debug(CLASS_NAME, 'getUniqueTeams', `Found ${teams.length} unique teams`);
    return teams;
  }

  /**
   * Get complete chart data including view existence check and coupling data.
   *
   * @param filters - Optional filters for coupling queries
   * @returns CouplingChartData with coupling data and metadata
   */
  async getChartData(filters: CouplingFilters = {}): Promise<CouplingChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getChartData',
      `Fetching chart data: filters=${JSON.stringify(filters)}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkCouplingViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getChartData',
        'vw_team_coupling view not found -- returning empty data'
      );
      return {
        couplingData: [],
        chordData: { teams: [], matrix: [] },
        summary: {
          totalTeamPairs: 0,
          totalSharedFiles: 0,
          avgCouplingStrength: 0,
          maxCouplingStrength: 0,
          highestCouplingPair: null,
          uniqueTeams: 0,
        },
        hasData: false,
        viewExists: false,
      };
    }

    // Fetch data in parallel
    const [couplingData, summary] = await Promise.all([
      this.getCouplingMatrix(filters),
      this.getSummary(),
    ]);

    // Build chord data from coupling matrix
    const chordData = this.buildChordData(couplingData);

    this.logger.info(
      CLASS_NAME,
      'getChartData',
      `Chart data ready: ${couplingData.length} coupling rows, ${chordData.teams.length} teams`
    );

    return {
      couplingData,
      chordData,
      summary,
      hasData: couplingData.length > 0,
      viewExists: true,
    };
  }

  /**
   * Get shared files chart data with view existence check.
   *
   * @param teamA - First team name
   * @param teamB - Second team name
   * @returns SharedFilesChartData with shared files and metadata
   */
  async getSharedFilesChartData(teamA: string, teamB: string): Promise<SharedFilesChartData> {
    this.logger.debug(
      CLASS_NAME,
      'getSharedFilesChartData',
      `Fetching shared files chart data: teamA=${teamA}, teamB=${teamB}`
    );

    // Check view existence for graceful degradation
    const viewExists = await this.checkSharedFilesViewExists();
    if (!viewExists) {
      this.logger.warn(
        CLASS_NAME,
        'getSharedFilesChartData',
        'vw_team_shared_files view not found -- returning empty data'
      );
      return {
        teamA,
        teamB,
        sharedFiles: [],
        hasData: false,
        viewExists: false,
      };
    }

    const sharedFiles = await this.getSharedFiles(teamA, teamB);

    this.logger.info(
      CLASS_NAME,
      'getSharedFilesChartData',
      `Shared files chart data ready: ${sharedFiles.length} files`
    );

    return {
      teamA,
      teamB,
      sharedFiles,
      hasData: sharedFiles.length > 0,
      viewExists: true,
    };
  }
}
