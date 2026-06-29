/**
 * CRUD operations service for Organizations and Teams.
 * Separated from OrganizationProfileDataService to keep files under 600 lines.
 * Security: CWE-89 (SQL Injection), CWE-20 (Input validation). Ticket: GITX-204
 */

import { DatabaseService } from '../database/database-service.js';
import { LoggerService } from '../logging/logger.js';
import type {
  Organization,
  Team,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from './org-profile-data-types.js';
import type { OrgWithTeamCountDbRow } from '../database/queries/org-profile-queries.js';
import { QUERY_ALL_ORGANIZATIONS } from '../database/queries/org-profile-queries.js';

// Re-export types for convenience
export type {
  Organization,
  Team,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from './org-profile-data-types.js';

const CLASS_NAME = 'OrganizationCrudService';
const MAX_ORG_NAME_LENGTH = 100; // CWE-20: Input validation

/** Service for CRUD operations on Organizations and Teams. Ticket: GITX-204 */
export class OrganizationCrudService {
  private readonly logger: LoggerService;
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.logger = LoggerService.getInstance();
    this.db = db;
    this.logger.debug(CLASS_NAME, 'constructor', 'OrganizationCrudService created');
  }

  // ============================================================================
  // Input Validation Methods
  // ============================================================================

  /**
   * Validate organization ID at runtime.
   * CWE-20: Input validation - must be positive integer.
   *
   * @param organizationId - The organization ID to validate
   * @param methodName - Calling method name for log context
   */
  validateOrganizationId(organizationId: number, methodName: string): void {
    if (typeof organizationId !== 'number' || !Number.isInteger(organizationId)) {
      this.logger.warn(CLASS_NAME, methodName, `Non-integer organization ID rejected: ${organizationId}`);
      throw new Error('Organization ID must be an integer.');
    }
    if (organizationId <= 0) {
      this.logger.warn(CLASS_NAME, methodName, `Non-positive organization ID rejected: ${organizationId}`);
      throw new Error('Organization ID must be a positive integer.');
    }
  }

  /**
   * Validate organization name at runtime.
   * CWE-20: Input validation.
   *
   * @param name - The organization name to validate
   * @param methodName - Calling method name for log context
   */
  validateOrganizationName(name: string, methodName: string): void {
    if (!name || name.trim().length === 0) {
      this.logger.warn(CLASS_NAME, methodName, 'Empty organization name rejected');
      throw new Error('Organization name is required.');
    }
    if (name.length > MAX_ORG_NAME_LENGTH) {
      this.logger.warn(CLASS_NAME, methodName, `Organization name exceeds max length: ${name.length} > ${MAX_ORG_NAME_LENGTH}`);
      throw new Error(`Organization name exceeds maximum length of ${MAX_ORG_NAME_LENGTH} characters.`);
    }
    // Alphanumeric with spaces, hyphens, underscores, periods
    const nameRegex = /^[a-zA-Z0-9\s\-_.]+$/;
    if (!nameRegex.test(name)) {
      this.logger.warn(CLASS_NAME, methodName, `Invalid organization name rejected: ${name}`);
      throw new Error('Organization name contains invalid characters. Only alphanumeric, spaces, hyphens, underscores, and periods are allowed.');
    }
  }

  /**
   * Validate team ID at runtime.
   * CWE-20: Input validation - must be positive integer.
   *
   * @param teamId - The team ID to validate
   * @param methodName - Calling method name for log context
   */
  validateTeamId(teamId: number, methodName: string): void {
    if (typeof teamId !== 'number' || !Number.isInteger(teamId)) {
      this.logger.warn(CLASS_NAME, methodName, `Non-integer team ID rejected: ${teamId}`);
      throw new Error('Team ID must be an integer.');
    }
    if (teamId <= 0) {
      this.logger.warn(CLASS_NAME, methodName, `Non-positive team ID rejected: ${teamId}`);
      throw new Error('Team ID must be a positive integer.');
    }
  }

  // ============================================================================
  // Organizations CRUD
  // ============================================================================

  /**
   * Get all organizations with team counts.
   *
   * @returns Array of organizations
   */
  async getOrganizations(): Promise<Organization[]> {
    this.logger.debug(CLASS_NAME, 'getOrganizations', 'Fetching all organizations');

    const result = await this.db.query<OrgWithTeamCountDbRow>(QUERY_ALL_ORGANIZATIONS);

    this.logger.debug(CLASS_NAME, 'getOrganizations', `Found ${result.rowCount} organizations`);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      teamCount: row.team_count,
      contributorCount: 0, // Will be filled by getSummary if needed
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  /**
   * Get a single organization by ID.
   *
   * @param organizationId - The organization ID
   * @returns Organization or null if not found
   */
  async getOrganizationById(organizationId: number): Promise<Organization | null> {
    this.validateOrganizationId(organizationId, 'getOrganizationById');
    this.logger.debug(CLASS_NAME, 'getOrganizationById', `Fetching organization ${organizationId}`);

    const sql = `
      SELECT
        o.id,
        o.name,
        COUNT(DISTINCT t.id)::int AS team_count,
        o.created_at,
        o.updated_at
      FROM organizations o
      LEFT JOIN teams t ON t.organization_id = o.id
      WHERE o.id = $1
      GROUP BY o.id, o.name, o.created_at, o.updated_at
    `;

    const result = await this.db.query<OrgWithTeamCountDbRow>(sql, [organizationId]);

    if (result.rowCount === 0 || !result.rows[0]) {
      this.logger.debug(CLASS_NAME, 'getOrganizationById', `Organization ${organizationId} not found`);
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      teamCount: row.team_count,
      contributorCount: 0,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Create a new organization.
   *
   * @param input - Organization creation data
   * @returns Created organization
   */
  async createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    this.validateOrganizationName(input.name, 'createOrganization');
    this.logger.debug(CLASS_NAME, 'createOrganization', `Creating organization: ${input.name}`);

    const sql = `
      INSERT INTO organizations (name, created_at, updated_at)
      VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, name, created_at, updated_at
    `;

    const result = await this.db.query<{
      id: number;
      name: string;
      created_at: Date | string;
      updated_at: Date | string;
    }>(sql, [input.name.trim()]);

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create organization.');
    }

    this.logger.debug(CLASS_NAME, 'createOrganization', `Created organization ${row.id}: ${row.name}`);

    return {
      id: row.id,
      name: row.name,
      teamCount: 0,
      contributorCount: 0,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Update an existing organization.
   *
   * @param organizationId - The organization ID to update
   * @param input - Organization update data
   * @returns Updated organization or null if not found
   */
  async updateOrganization(organizationId: number, input: UpdateOrganizationInput): Promise<Organization | null> {
    this.validateOrganizationId(organizationId, 'updateOrganization');
    this.validateOrganizationName(input.name, 'updateOrganization');
    this.logger.debug(CLASS_NAME, 'updateOrganization', `Updating organization ${organizationId}`);

    const sql = `
      UPDATE organizations
      SET name = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, created_at, updated_at
    `;

    const result = await this.db.query<{
      id: number;
      name: string;
      created_at: Date | string;
      updated_at: Date | string;
    }>(sql, [organizationId, input.name.trim()]);

    if (result.rowCount === 0 || !result.rows[0]) {
      this.logger.debug(CLASS_NAME, 'updateOrganization', `Organization ${organizationId} not found`);
      return null;
    }

    const row = result.rows[0];
    this.logger.debug(CLASS_NAME, 'updateOrganization', `Updated organization ${row.id}: ${row.name}`);

    return {
      id: row.id,
      name: row.name,
      teamCount: 0,
      contributorCount: 0,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Delete an organization.
   *
   * @param organizationId - The organization ID to delete
   * @returns true if deleted, false if not found
   */
  async deleteOrganization(organizationId: number): Promise<boolean> {
    this.validateOrganizationId(organizationId, 'deleteOrganization');
    this.logger.debug(CLASS_NAME, 'deleteOrganization', `Deleting organization ${organizationId}`);

    const sql = `DELETE FROM organizations WHERE id = $1`;
    const result = await this.db.query(sql, [organizationId]);

    const deleted = (result.rowCount ?? 0) > 0;
    this.logger.debug(CLASS_NAME, 'deleteOrganization', `Organization ${organizationId} deleted: ${deleted}`);

    return deleted;
  }

  // ============================================================================
  // Team Assignment CRUD
  // ============================================================================

  /**
   * Assign a team to an organization.
   *
   * @param teamId - The team ID to assign
   * @param organizationId - The organization ID to assign to
   * @returns Updated team or null if team not found
   */
  async assignTeamToOrganization(teamId: number, organizationId: number): Promise<Team | null> {
    this.validateTeamId(teamId, 'assignTeamToOrganization');
    this.validateOrganizationId(organizationId, 'assignTeamToOrganization');
    this.logger.debug(CLASS_NAME, 'assignTeamToOrganization', `Assigning team ${teamId} to organization ${organizationId}`);

    const sql = `
      UPDATE teams
      SET organization_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, organization_id, created_at, updated_at
    `;

    const result = await this.db.query<{
      id: number;
      name: string;
      organization_id: number | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(sql, [teamId, organizationId]);

    if (result.rowCount === 0 || !result.rows[0]) {
      this.logger.debug(CLASS_NAME, 'assignTeamToOrganization', `Team ${teamId} not found`);
      return null;
    }

    const row = result.rows[0];

    // Get organization name
    let orgName: string | null = null;
    if (row.organization_id) {
      const orgResult = await this.db.query<{ name: string }>(
        'SELECT name FROM organizations WHERE id = $1',
        [row.organization_id]
      );
      orgName = orgResult.rows[0]?.name ?? null;
    }

    this.logger.debug(CLASS_NAME, 'assignTeamToOrganization', `Team ${teamId} assigned to organization ${organizationId}`);

    return {
      id: row.id,
      name: row.name,
      organizationId: row.organization_id,
      organizationName: orgName,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Remove a team from its organization.
   *
   * @param teamId - The team ID to unassign
   * @returns Updated team or null if team not found
   */
  async removeTeamFromOrganization(teamId: number): Promise<Team | null> {
    this.validateTeamId(teamId, 'removeTeamFromOrganization');
    this.logger.debug(CLASS_NAME, 'removeTeamFromOrganization', `Removing team ${teamId} from organization`);

    const sql = `
      UPDATE teams
      SET organization_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, organization_id, created_at, updated_at
    `;

    const result = await this.db.query<{
      id: number;
      name: string;
      organization_id: number | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(sql, [teamId]);

    if (result.rowCount === 0 || !result.rows[0]) {
      this.logger.debug(CLASS_NAME, 'removeTeamFromOrganization', `Team ${teamId} not found`);
      return null;
    }

    const row = result.rows[0];
    this.logger.debug(CLASS_NAME, 'removeTeamFromOrganization', `Team ${teamId} removed from organization`);

    return {
      id: row.id,
      name: row.name,
      organizationId: null,
      organizationName: null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Get all teams with organization info.
   *
   * @returns Array of teams
   */
  async getTeams(): Promise<Team[]> {
    this.logger.debug(CLASS_NAME, 'getTeams', 'Fetching all teams');

    const sql = `
      SELECT
        t.id,
        t.name,
        t.organization_id,
        o.name AS organization_name,
        t.created_at,
        t.updated_at
      FROM teams t
      LEFT JOIN organizations o ON t.organization_id = o.id
      ORDER BY t.name ASC
    `;

    const result = await this.db.query<{
      id: number;
      name: string;
      organization_id: number | null;
      organization_name: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(sql);

    this.logger.debug(CLASS_NAME, 'getTeams', `Found ${result.rowCount} teams`);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }
}
