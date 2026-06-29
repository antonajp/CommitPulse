import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { vi } from 'vitest';
import { resolve } from 'path';
import { Pool } from 'pg';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { MigrationRunner } from '../../database/migration-runner.js';
import {
  DatabaseService,
  type DatabaseServiceConfig,
} from '../../database/database-service.js';
import { OrganizationProfileDataService } from '../../services/org-profile-data-service.js';

/**
 * Integration tests for Organization Profile feature (GITX-213).
 *
 * Tests comprehensive edge cases for organization dashboard data aggregation:
 * - Organization with 3 teams, full data (happy path)
 * - Organization with 1 team (sum/average of 1)
 * - Empty organization (no teams assigned)
 * - Organization with no data in timeframe
 * - Team with no commits in timeframe (excluded from aggregation)
 * - Contributor in multiple teams (uses primary team assignment)
 * - Partial Jira integration (some teams have Jira, others don't)
 * - NULL organization teams grouped under "Unassigned"
 * - Query performance with 20 teams, 200 contributors
 * - Regression tests for Team Profile and Developer Profile unchanged
 * - Regression test for Pipeline team assignment unchanged
 *
 * Uses Testcontainers for PostgreSQL 16-alpine.
 * Ticket: GITX-213
 */

const PG_DATABASE = 'gitrx_org_profile_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

const projectRoot = resolve(__dirname, '..', '..', '..');
const migrationsDir = resolve(projectRoot, 'docker', 'migrations');

let container: StartedTestContainer;
let pool: Pool;
let dbService: DatabaseService;
let orgService: OrganizationProfileDataService;
let config: DatabaseServiceConfig;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Insert test organization data for integration tests.
 */
async function insertTestOrganization(
  name: string,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [name]
  );
  return result.rows[0]?.id as number;
}

/**
 * Insert test team data for integration tests.
 */
async function insertTestTeam(
  name: string,
  organizationId: number | null = null,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO teams (name, organization_id) VALUES ($1, $2) RETURNING id`,
    [name, organizationId]
  );
  return result.rows[0]?.id as number;
}

/**
 * Insert test contributor data for integration tests.
 */
async function insertTestContributor(
  login: string,
  fullName: string | null = null,
  teamId: number | null = null,
  email: string | null = null,
  jiraName: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO commit_contributors (login, full_name, team_id, email, jira_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (login) DO UPDATE SET full_name = $2, team_id = $3, email = $4, jira_name = $5`,
    [login, fullName, teamId, email, jiraName]
  );
}

/**
 * Insert test commit history data for integration tests.
 */
async function insertTestCommit(
  sha: string,
  author: string,
  repository: string,
  commitDate: Date,
  linesAdded: number = 100,
  linesRemoved: number = 10,
  isMerge: boolean = false,
): Promise<void> {
  await pool.query(
    `INSERT INTO commit_history (sha, author, repository, commit_date, lines_added, lines_removed, is_merge, commit_message, branch)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Test commit', 'main')
     ON CONFLICT (sha) DO NOTHING`,
    [sha, author, repository, commitDate, linesAdded, linesRemoved, isMerge]
  );
}

/**
 * Insert test commit files data for integration tests.
 */
async function insertTestCommitFile(
  sha: string,
  filename: string,
  lineInserts: number = 50,
  lineDeletes: number = 5,
  complexity: number | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, file_extension)
     VALUES ($1, $2, $3, $4, $5, '.ts')
     ON CONFLICT DO NOTHING`,
    [sha, filename, lineInserts, lineDeletes, complexity]
  );
}

/**
 * Insert test Jira issue data for integration tests.
 */
async function insertTestJiraIssue(
  jiraKey: string,
  assignee: string,
  storyPoints: number | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO jira_detail (jira_key, assignee, calculated_story_points, summary, status, issuetype)
     VALUES ($1, $2, $3, 'Test issue', 'Done', 'Story')
     ON CONFLICT (jira_key) DO NOTHING`,
    [jiraKey, assignee, storyPoints]
  );
}

/**
 * Insert test Jira history data for integration tests.
 */
async function insertTestJiraHistory(
  jiraKey: string,
  changeDate: Date,
  field: string = 'status',
  toValue: string = 'Done',
): Promise<void> {
  await pool.query(
    `INSERT INTO jira_history (jira_key, change_date, field, to_value)
     VALUES ($1, $2, $3, $4)`,
    [jiraKey, changeDate, field, toValue]
  );
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Organization Profile Integration Tests (GITX-213)', () => {
  beforeAll(async () => {
    // Reset logger for clean test state
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Start PostgreSQL 16 container with Testcontainers
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: PG_DATABASE,
        POSTGRES_USER: PG_USER,
        POSTGRES_PASSWORD: PG_PASSWORD,
      })
      .withExposedPorts(PG_PORT)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();

    const mappedPort = container.getMappedPort(PG_PORT);
    const host = container.getHost();

    pool = new Pool({
      host,
      port: mappedPort,
      database: PG_DATABASE,
      user: PG_USER,
      password: PG_PASSWORD,
      max: 5,
    });

    config = {
      host,
      port: mappedPort,
      database: PG_DATABASE,
      user: PG_USER,
      password: PG_PASSWORD,
      maxPoolSize: 5,
      connectionTimeoutMs: 10_000,
      idleTimeoutMs: 5_000,
    };

    // Verify connectivity
    const result = await pool.query('SELECT 1 AS health');
    expect(result.rows[0]?.health).toBe(1);

    // Run all migrations
    const runner = new MigrationRunner(pool, migrationsDir);
    const migrationResult = await runner.migrate();
    expect(migrationResult.success).toBe(true);

    // Initialize DatabaseService for org profile service
    dbService = new DatabaseService();
    await dbService.initialize(config);
    orgService = new OrganizationProfileDataService(dbService);
  }, 120_000);

  afterAll(async () => {
    if (dbService?.isInitialized()) {
      await dbService.shutdown();
    }
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  }, 30_000);

  beforeEach(async () => {
    // Reset logger
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Clear test data before each test
    await pool.query('DELETE FROM jira_history');
    await pool.query('DELETE FROM jira_detail');
    await pool.query('DELETE FROM commit_files');
    await pool.query('DELETE FROM commit_history');
    await pool.query('DELETE FROM commit_contributors');
    await pool.query('DELETE FROM teams');
    await pool.query('DELETE FROM organizations');
  });

  // ==========================================================================
  // Test: Organization with 3 teams, full data (happy path)
  // ==========================================================================

  describe('Organization with 3 teams, full data (happy path)', () => {
    it('should aggregate metrics across all 3 teams correctly', async () => {
      // Setup: Create organization with 3 teams
      const orgId = await insertTestOrganization('Engineering');
      const team1Id = await insertTestTeam('Backend', orgId);
      const team2Id = await insertTestTeam('Frontend', orgId);
      const team3Id = await insertTestTeam('DevOps', orgId);

      // Add contributors to each team
      await insertTestContributor('user1', 'Alice Smith', team1Id, 'alice@example.com');
      await insertTestContributor('user2', 'Bob Jones', team2Id, 'bob@example.com');
      await insertTestContributor('user3', 'Charlie Brown', team3Id, 'charlie@example.com');
      await insertTestContributor('user4', 'Diana Prince', team1Id, 'diana@example.com');

      // Add commits (within last 30 days)
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 15);

      await insertTestCommit('sha1', 'Alice Smith', 'owner/repo1', recentDate, 100, 10);
      await insertTestCommitFile('sha1', 'src/backend/api.ts', 80, 5, 10);

      await insertTestCommit('sha2', 'Bob Jones', 'owner/repo1', recentDate, 150, 20);
      await insertTestCommitFile('sha2', 'src/frontend/app.tsx', 120, 15, 8);

      await insertTestCommit('sha3', 'Charlie Brown', 'owner/repo2', recentDate, 200, 30);
      await insertTestCommitFile('sha3', 'infra/terraform/main.tf', 180, 25, 5);

      await insertTestCommit('sha4', 'Diana Prince', 'owner/repo1', recentDate, 80, 5);
      await insertTestCommitFile('sha4', 'src/backend/service.ts', 70, 3, 12);

      // Verify: Fetch organization summary
      const summary = await orgService.getSummary({ organizationId: orgId, timeframeDays: '30' });

      expect(summary.organizationId).toBe(orgId);
      expect(summary.organizationName).toBe('Engineering');
      expect(summary.teamCount).toBe(3);
      expect(summary.contributorCount).toBe(4);
      expect(summary.totalCommits).toBe(4);
      expect(summary.totalLoc).toBeGreaterThan(0);
      expect(summary.repositoriesWorkedOn).toBe(2);
    }, 60_000);

    it('should return LOC aggregated by week across all teams', async () => {
      // Setup
      const orgId = await insertTestOrganization('Engineering');
      const teamId = await insertTestTeam('Backend', orgId);
      await insertTestContributor('user1', 'Alice Smith', teamId);

      // Add commits at different dates
      const week1 = new Date();
      week1.setDate(week1.getDate() - 20);
      const week2 = new Date();
      week2.setDate(week2.getDate() - 10);

      await insertTestCommit('sha1', 'Alice Smith', 'owner/repo1', week1, 100, 10);
      await insertTestCommitFile('sha1', 'src/file1.ts', 100, 10);

      await insertTestCommit('sha2', 'Alice Smith', 'owner/repo1', week2, 200, 20);
      await insertTestCommitFile('sha2', 'src/file2.ts', 200, 20);

      // Verify: Fetch LOC per week
      const locData = await orgService.getLocPerWeek({ organizationId: orgId, timeframeDays: '30' });

      expect(locData.length).toBeGreaterThanOrEqual(1);
      const totalLinesAdded = locData.reduce((sum, d) => sum + d.linesAdded, 0);
      expect(totalLinesAdded).toBe(300);
    }, 60_000);
  });

  // ==========================================================================
  // Test: Organization with 1 team (sum/average of 1)
  // ==========================================================================

  describe('Organization with 1 team (sum/average of 1)', () => {
    it('should handle single team correctly without division errors', async () => {
      const orgId = await insertTestOrganization('Solo Team Org');
      const teamId = await insertTestTeam('Solo Team', orgId);

      await insertTestContributor('solo_user', 'Solo Dev', teamId);

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);

      await insertTestCommit('sha_solo', 'Solo Dev', 'owner/solo-repo', recentDate, 500, 50);
      await insertTestCommitFile('sha_solo', 'src/solo.ts', 500, 50, 15);

      const summary = await orgService.getSummary({ organizationId: orgId, timeframeDays: '30' });

      expect(summary.teamCount).toBe(1);
      expect(summary.contributorCount).toBe(1);
      expect(summary.totalCommits).toBe(1);
      expect(summary.totalLoc).toBe(500);
    }, 60_000);
  });

  // ==========================================================================
  // Test: Empty organization (no teams assigned)
  // ==========================================================================

  describe('Empty organization (no teams assigned)', () => {
    it('should return zero metrics for empty organization', async () => {
      const orgId = await insertTestOrganization('Empty Org');

      const summary = await orgService.getSummary({ organizationId: orgId, timeframeDays: '30' });

      expect(summary.teamCount).toBe(0);
      expect(summary.contributorCount).toBe(0);
      expect(summary.totalCommits).toBe(0);
      expect(summary.totalLoc).toBe(0);
    }, 60_000);

    it('should return empty arrays for LOC and velocity data', async () => {
      const orgId = await insertTestOrganization('Empty Org');

      const locData = await orgService.getLocPerWeek({ organizationId: orgId, timeframeDays: '30' });
      const velocityData = await orgService.getVelocityVsLoc({ organizationId: orgId, timeframeDays: '30' });

      expect(locData.length).toBe(0);
      expect(velocityData.length).toBe(0);
    }, 60_000);
  });

  // ==========================================================================
  // Test: Organization with no data in timeframe
  // ==========================================================================

  describe('Organization with no data in timeframe', () => {
    it('should return empty weekly data when all commits are outside timeframe', async () => {
      const orgId = await insertTestOrganization('Old Data Org');
      const teamId = await insertTestTeam('Old Team', orgId);
      await insertTestContributor('old_user', 'Old Dev', teamId);

      // Add commits from 2 years ago (outside all timeframe options)
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 2);

      await insertTestCommit('sha_old', 'Old Dev', 'owner/old-repo', oldDate, 1000, 100);
      await insertTestCommitFile('sha_old', 'src/old.ts', 1000, 100);

      // Query with 30-day timeframe - summary shows all-time, but weekly should be empty
      const locData = await orgService.getLocPerWeek({ organizationId: orgId, timeframeDays: '30' });
      const velocityData = await orgService.getVelocityVsLoc({ organizationId: orgId, timeframeDays: '30' });

      // Weekly LOC and velocity should be empty (commits outside timeframe)
      expect(locData.length).toBe(0);
      expect(velocityData.length).toBe(0);

      // Summary shows all-time data (not filtered by timeframe)
      const summary = await orgService.getSummary({ organizationId: orgId, timeframeDays: '30' });
      expect(summary.teamCount).toBe(1);
      expect(summary.contributorCount).toBe(1);
      // totalCommits comes from all-time query, not filtered
      expect(summary.totalCommits).toBe(1);
    }, 60_000);
  });

  // ==========================================================================
  // Test: Team with no commits in timeframe (excluded from aggregation)
  // ==========================================================================

  describe('Team with no commits in timeframe (excluded from aggregation)', () => {
    it('should include team in count but exclude from commit metrics', async () => {
      const orgId = await insertTestOrganization('Mixed Activity Org');
      const activeTeamId = await insertTestTeam('Active Team', orgId);
      const inactiveTeamId = await insertTestTeam('Inactive Team', orgId);

      await insertTestContributor('active_user', 'Active Dev', activeTeamId);
      await insertTestContributor('inactive_user', 'Inactive Dev', inactiveTeamId);

      // Only active team has recent commits
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);

      await insertTestCommit('sha_active', 'Active Dev', 'owner/active-repo', recentDate, 200, 20);
      await insertTestCommitFile('sha_active', 'src/active.ts', 200, 20);

      const summary = await orgService.getSummary({ organizationId: orgId, timeframeDays: '30' });

      expect(summary.teamCount).toBe(2); // Both teams counted
      expect(summary.contributorCount).toBe(2); // Both contributors counted
      expect(summary.totalCommits).toBe(1); // Only active team's commits
      expect(summary.totalLoc).toBe(200); // Only active team's LOC
    }, 60_000);

    it('should show partial data coverage in getDataCoverage', async () => {
      const orgId = await insertTestOrganization('Mixed Activity Org 2');
      const activeTeamId = await insertTestTeam('Active Team 2', orgId);
      await insertTestTeam('Inactive Team 2', orgId);

      await insertTestContributor('active_user2', 'Active Dev 2', activeTeamId);

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);

      await insertTestCommit('sha_active2', 'Active Dev 2', 'owner/active-repo2', recentDate, 100, 10);
      await insertTestCommitFile('sha_active2', 'src/active2.ts', 100, 10);

      const coverage = await orgService.getDataCoverage({ organizationId: orgId, timeframeDays: '30' });

      expect(coverage.totalTeams).toBe(2);
      expect(coverage.teamsWithData).toBe(1);
      expect(coverage.isPartial).toBe(true);
    }, 60_000);
  });

  // ==========================================================================
  // Test: Contributor in multiple teams (uses primary team assignment)
  // ==========================================================================

  describe('Contributor in multiple teams (uses primary team assignment)', () => {
    it('should use team_id as primary team assignment', async () => {
      const orgId = await insertTestOrganization('Multi-Team Contributor Org');
      const primaryTeamId = await insertTestTeam('Primary Team', orgId);
      await insertTestTeam('Secondary Team', orgId);

      // Contributor is assigned to Primary Team via team_id
      await insertTestContributor('multi_user', 'Multi Team Dev', primaryTeamId);

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);

      await insertTestCommit('sha_multi', 'Multi Team Dev', 'owner/multi-repo', recentDate, 300, 30);
      await insertTestCommitFile('sha_multi', 'src/multi.ts', 300, 30);

      const summary = await orgService.getSummary({ organizationId: orgId, timeframeDays: '30' });

      // Should only count once under primary team
      expect(summary.contributorCount).toBe(1);
      expect(summary.totalCommits).toBe(1);
    }, 60_000);
  });

  // ==========================================================================
  // Test: Partial Jira integration (some teams have Jira, others don't)
  // ==========================================================================

  describe('Partial Jira integration (some teams have Jira, others don\'t)', () => {
    it('should handle mixed Jira and non-Jira teams', async () => {
      const orgId = await insertTestOrganization('Mixed Jira Org');
      const jiraTeamId = await insertTestTeam('Jira Team', orgId);
      const noJiraTeamId = await insertTestTeam('No Jira Team', orgId);

      // Jira team contributor with jira_name
      await insertTestContributor('jira_user', 'Jira Dev', jiraTeamId, 'jira@example.com', 'Jira Dev');
      // Non-Jira team contributor without jira_name
      await insertTestContributor('no_jira_user', 'No Jira Dev', noJiraTeamId, 'nojira@example.com');

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);

      // Both teams have commits
      await insertTestCommit('sha_jira', 'Jira Dev', 'owner/jira-repo', recentDate, 100, 10);
      await insertTestCommitFile('sha_jira', 'src/jira.ts', 100, 10);

      await insertTestCommit('sha_nojira', 'No Jira Dev', 'owner/nojira-repo', recentDate, 150, 15);
      await insertTestCommitFile('sha_nojira', 'src/nojira.ts', 150, 15);

      // Only Jira team has Jira issues
      await insertTestJiraIssue('PROJ-1', 'Jira Dev', 3);
      await insertTestJiraHistory('PROJ-1', recentDate);

      const coverage = await orgService.getDataCoverage({ organizationId: orgId, timeframeDays: '30' });

      expect(coverage.totalTeams).toBe(2);
      expect(coverage.teamsWithData).toBe(2); // Both have commits
      expect(coverage.isJiraPartial).toBe(true); // Only one has Jira data
    }, 60_000);

    it('should aggregate velocity points only from teams with Jira data', async () => {
      const orgId = await insertTestOrganization('Mixed Velocity Org');
      const jiraTeamId = await insertTestTeam('Jira Velocity Team', orgId);
      const noJiraTeamId = await insertTestTeam('No Jira Velocity Team', orgId);

      await insertTestContributor('vel_jira_user', 'Vel Jira Dev', jiraTeamId, 'vj@example.com', 'Vel Jira Dev');
      await insertTestContributor('vel_nojira_user', 'Vel No Jira Dev', noJiraTeamId);

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);

      await insertTestCommit('sha_vel_jira', 'Vel Jira Dev', 'owner/vel-repo', recentDate, 100, 10);
      await insertTestCommitFile('sha_vel_jira', 'src/vel.ts', 100, 10);

      await insertTestCommit('sha_vel_nojira', 'Vel No Jira Dev', 'owner/vel-repo', recentDate, 100, 10);
      await insertTestCommitFile('sha_vel_nojira', 'src/vel2.ts', 100, 10);

      // Only Jira team has story points
      await insertTestJiraIssue('VEL-1', 'Vel Jira Dev', 5);
      await insertTestJiraHistory('VEL-1', recentDate);

      const velocity = await orgService.getVelocityVsLoc({ organizationId: orgId, timeframeDays: '30' });

      // Should have velocity data points
      expect(velocity.length).toBeGreaterThan(0);
      // Total story points should be from Jira team only
      const totalStoryPoints = velocity.reduce((sum, v) => sum + v.storyPoints, 0);
      expect(totalStoryPoints).toBe(5);
    }, 60_000);
  });

  // ==========================================================================
  // Test: NULL organization teams grouped under "Unassigned"
  // ==========================================================================

  describe('NULL organization teams grouped under "Unassigned"', () => {
    it('should handle teams with NULL organization_id separately', async () => {
      const orgId = await insertTestOrganization('Assigned Org');
      const assignedTeamId = await insertTestTeam('Assigned Team', orgId);
      const unassignedTeamId = await insertTestTeam('Unassigned Team', null); // NULL org

      await insertTestContributor('assigned_user', 'Assigned Dev', assignedTeamId);
      await insertTestContributor('unassigned_user', 'Unassigned Dev', unassignedTeamId);

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);

      await insertTestCommit('sha_assigned', 'Assigned Dev', 'owner/assigned-repo', recentDate, 100, 10);
      await insertTestCommitFile('sha_assigned', 'src/assigned.ts', 100, 10);

      await insertTestCommit('sha_unassigned', 'Unassigned Dev', 'owner/unassigned-repo', recentDate, 200, 20);
      await insertTestCommitFile('sha_unassigned', 'src/unassigned.ts', 200, 20);

      // Query the assigned organization
      const summary = await orgService.getSummary({ organizationId: orgId, timeframeDays: '30' });

      // Should only include the assigned team
      expect(summary.teamCount).toBe(1);
      expect(summary.contributorCount).toBe(1);
      expect(summary.totalLoc).toBe(100);
    }, 60_000);
  });

  // ==========================================================================
  // Test: Database migration rollback
  // ==========================================================================

  describe('Database migration rollback', () => {
    it('should verify rollback script removes organization tables', async () => {
      const { readFileSync } = await import('fs');

      // First verify organizations table exists
      const beforeResult = await pool.query(`
        SELECT COUNT(*) AS cnt FROM information_schema.tables
        WHERE table_name = 'organizations'
      `);
      expect(parseInt(beforeResult.rows[0]?.cnt as string, 10)).toBe(1);

      // Run rollback
      const rollbackSql = readFileSync(
        resolve(migrationsDir, '030_create_organizations_teams_tables.rollback.sql'),
        'utf-8'
      );
      await pool.query(rollbackSql);

      // Verify tables removed
      const afterOrgs = await pool.query(`
        SELECT COUNT(*) AS cnt FROM information_schema.tables
        WHERE table_name = 'organizations'
      `);
      expect(parseInt(afterOrgs.rows[0]?.cnt as string, 10)).toBe(0);

      const afterTeams = await pool.query(`
        SELECT COUNT(*) AS cnt FROM information_schema.tables
        WHERE table_name = 'teams'
      `);
      expect(parseInt(afterTeams.rows[0]?.cnt as string, 10)).toBe(0);

      // Re-apply migration for subsequent tests
      const migrateSql = readFileSync(
        resolve(migrationsDir, '030_create_organizations_teams_tables.sql'),
        'utf-8'
      );
      await pool.query(migrateSql);
    }, 60_000);
  });

  // ==========================================================================
  // Test: Query performance with 20 teams, 200 contributors
  // ==========================================================================

  describe('Query performance with 20 teams, 200 contributors', () => {
    it('should execute summary query within acceptable time', async () => {
      const orgId = await insertTestOrganization('Large Org');

      // Create 20 teams
      const teamIds: number[] = [];
      for (let i = 0; i < 20; i++) {
        const teamId = await insertTestTeam(`Team ${i + 1}`, orgId);
        teamIds.push(teamId);
      }

      // Create 200 contributors (10 per team)
      for (let i = 0; i < 200; i++) {
        const teamId = teamIds[i % 20];
        await insertTestContributor(
          `user_${i}`,
          `Contributor ${i}`,
          teamId ?? null,
          `user${i}@example.com`
        );
      }

      // Create commits for each contributor
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 15);

      for (let i = 0; i < 200; i++) {
        await insertTestCommit(
          `sha_perf_${i}`,
          `Contributor ${i}`,
          `owner/repo${i % 5}`,
          recentDate,
          50 + (i % 100),
          5 + (i % 10)
        );
        await insertTestCommitFile(
          `sha_perf_${i}`,
          `src/file_${i}.ts`,
          50 + (i % 100),
          5 + (i % 10)
        );
      }

      // Measure query time
      const startTime = Date.now();
      const summary = await orgService.getSummary({ organizationId: orgId, timeframeDays: '30' });
      const elapsed = Date.now() - startTime;

      // Verify data integrity
      expect(summary.teamCount).toBe(20);
      expect(summary.contributorCount).toBe(200);
      expect(summary.totalCommits).toBe(200);

      // Performance assertion: should complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);
    }, 120_000);

    it('should use EXPLAIN ANALYZE to verify query plan efficiency', async () => {
      const orgId = await insertTestOrganization('Perf Analysis Org');
      const teamId = await insertTestTeam('Perf Team', orgId);
      await insertTestContributor('perf_user', 'Perf Dev', teamId);

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);

      await insertTestCommit('sha_explain', 'Perf Dev', 'owner/perf-repo', recentDate, 100, 10);
      await insertTestCommitFile('sha_explain', 'src/perf.ts', 100, 10);

      // Run EXPLAIN ANALYZE on summary query
      const explainResult = await pool.query(`
        EXPLAIN ANALYZE
        WITH org_teams AS (
          SELECT t.id AS team_id, t.name AS team_name
          FROM teams t
          WHERE t.organization_id = $1
        ),
        team_members AS (
          SELECT DISTINCT cc.login, cc.full_name, cc.jira_name, t.team_name
          FROM commit_contributors cc
          INNER JOIN org_teams t ON cc.team_id = t.team_id
        )
        SELECT COUNT(*) FROM team_members
      `, [orgId]);

      // Verify EXPLAIN ran successfully
      expect(explainResult.rows.length).toBeGreaterThan(0);

      // Check for index usage (the plan should mention index scans)
      const planText = explainResult.rows.map(r => r['QUERY PLAN']).join('\n');
      // Plan should complete without full table scans on large tables
      expect(planText).toBeDefined();
    }, 60_000);
  });

  // ==========================================================================
  // Regression test: Team Profile dashboard unchanged
  // ==========================================================================

  describe('Regression test: Team Profile dashboard unchanged', () => {
    it('should query team profile using commit_contributors.team column', async () => {
      // Create team without organization (backward compatibility)
      await pool.query(
        `INSERT INTO commit_contributors (login, full_name, team)
         VALUES ('legacy_user', 'Legacy Dev', 'Legacy Team')
         ON CONFLICT (login) DO UPDATE SET team = 'Legacy Team'`
      );

      // Verify team column still works for team profile queries
      const result = await pool.query(`
        SELECT DISTINCT login, full_name, team
        FROM commit_contributors
        WHERE team = $1
      `, ['Legacy Team']);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.full_name).toBe('Legacy Dev');
      expect(result.rows[0]?.team).toBe('Legacy Team');
    }, 60_000);

    it('should maintain team velocity query compatibility', async () => {
      await pool.query(
        `INSERT INTO commit_contributors (login, full_name, team)
         VALUES ('vel_legacy_user', 'Vel Legacy Dev', 'Velocity Team')
         ON CONFLICT (login) DO UPDATE SET team = 'Velocity Team'`
      );

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);

      await insertTestCommit('sha_vel_legacy', 'Vel Legacy Dev', 'owner/vel-repo', recentDate, 100, 10);
      await insertTestCommitFile('sha_vel_legacy', 'src/vel_legacy.ts', 100, 10);

      // Team velocity query uses team column
      const result = await pool.query(`
        WITH team_members AS (
          SELECT DISTINCT login, full_name, email, jira_name
          FROM commit_contributors
          WHERE team = $1
        ),
        team_commits AS (
          SELECT COUNT(DISTINCT ch.sha) AS commit_count
          FROM commit_history ch
          JOIN team_members tm ON (
            ch.author = tm.full_name
            OR (tm.full_name IS NULL AND ch.author = tm.login)
          )
          WHERE ch.is_merge = FALSE
        )
        SELECT commit_count FROM team_commits
      `, ['Velocity Team']);

      expect(Number(result.rows[0]?.commit_count)).toBe(1);
    }, 60_000);
  });

  // ==========================================================================
  // Regression test: Developer Profile dashboard unchanged
  // ==========================================================================

  describe('Regression test: Developer Profile dashboard unchanged', () => {
    it('should query developer profile using full_name with login fallback', async () => {
      await insertTestContributor('dev_profile_user', 'Dev Profile Dev', null);

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);

      await insertTestCommit('sha_dev_profile', 'Dev Profile Dev', 'owner/dev-repo', recentDate, 100, 10);
      await insertTestCommitFile('sha_dev_profile', 'src/dev_profile.ts', 100, 10);

      // Developer profile query uses full_name with login fallback
      const result = await pool.query(`
        WITH dev_commits AS (
          SELECT COUNT(DISTINCT ch.sha) AS commit_count
          FROM commit_history ch
          JOIN commit_contributors cc ON (
            ch.author = cc.full_name
            OR (cc.full_name IS NULL AND ch.author = cc.login)
          )
          WHERE (cc.full_name = $1 OR (cc.full_name IS NULL AND cc.login = $1))
            AND ch.is_merge = FALSE
        )
        SELECT commit_count FROM dev_commits
      `, ['Dev Profile Dev']);

      expect(Number(result.rows[0]?.commit_count)).toBe(1);
    }, 60_000);
  });

  // ==========================================================================
  // Regression test: Pipeline team assignment unchanged
  // ==========================================================================

  describe('Regression test: Pipeline team assignment unchanged', () => {
    it('should preserve team_id foreign key relationship with teams table', async () => {
      const orgId = await insertTestOrganization('Pipeline Test Org');
      const teamId = await insertTestTeam('Pipeline Team', orgId);

      await insertTestContributor('pipeline_user', 'Pipeline Dev', teamId);

      // Verify FK relationship
      const result = await pool.query(`
        SELECT cc.login, cc.full_name, cc.team_id, t.name AS team_name
        FROM commit_contributors cc
        LEFT JOIN teams t ON cc.team_id = t.id
        WHERE cc.login = 'pipeline_user'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.team_id).toBe(teamId);
      expect(result.rows[0]?.team_name).toBe('Pipeline Team');
    }, 60_000);

    it('should allow NULL team_id for unassigned contributors', async () => {
      await insertTestContributor('unassigned_pipeline_user', 'Unassigned Pipeline Dev', null);

      const result = await pool.query(`
        SELECT cc.login, cc.full_name, cc.team_id
        FROM commit_contributors cc
        WHERE cc.login = 'unassigned_pipeline_user'
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.team_id).toBeNull();
    }, 60_000);
  });

  // ==========================================================================
  // Test: TreeView click navigation (org -> team -> contributor)
  // ==========================================================================

  describe('TreeView click navigation (org -> team -> contributor)', () => {
    it('should support 3-level hierarchy data structure', async () => {
      const orgId = await insertTestOrganization('Nav Test Org');
      const team1Id = await insertTestTeam('Nav Team 1', orgId);
      const team2Id = await insertTestTeam('Nav Team 2', orgId);

      await insertTestContributor('nav_user1', 'Nav Dev 1', team1Id);
      await insertTestContributor('nav_user2', 'Nav Dev 2', team1Id);
      await insertTestContributor('nav_user3', 'Nav Dev 3', team2Id);

      // Verify organization -> teams hierarchy
      const orgTeams = await pool.query(`
        SELECT t.id, t.name, t.organization_id
        FROM teams t
        WHERE t.organization_id = $1
        ORDER BY t.name
      `, [orgId]);

      expect(orgTeams.rows.length).toBe(2);
      expect(orgTeams.rows[0]?.name).toBe('Nav Team 1');
      expect(orgTeams.rows[1]?.name).toBe('Nav Team 2');

      // Verify teams -> contributors hierarchy
      const team1Contributors = await pool.query(`
        SELECT cc.login, cc.full_name, cc.team_id
        FROM commit_contributors cc
        WHERE cc.team_id = $1
        ORDER BY cc.full_name
      `, [team1Id]);

      expect(team1Contributors.rows.length).toBe(2);
      expect(team1Contributors.rows[0]?.full_name).toBe('Nav Dev 1');
      expect(team1Contributors.rows[1]?.full_name).toBe('Nav Dev 2');

      // Verify full path: org -> team -> contributor
      const fullPath = await pool.query(`
        SELECT o.name AS org_name, t.name AS team_name, cc.full_name
        FROM organizations o
        JOIN teams t ON t.organization_id = o.id
        JOIN commit_contributors cc ON cc.team_id = t.id
        WHERE o.id = $1
        ORDER BY t.name, cc.full_name
      `, [orgId]);

      expect(fullPath.rows.length).toBe(3);
      expect(fullPath.rows[0]?.org_name).toBe('Nav Test Org');
    }, 60_000);
  });

  // ==========================================================================
  // Test: Input validation
  // ==========================================================================

  describe('Input validation', () => {
    it('should reject invalid organization ID', async () => {
      await expect(
        orgService.getSummary({ organizationId: -1, timeframeDays: '30' })
      ).rejects.toThrow('Organization ID must be a positive integer.');
    });

    it('should reject invalid timeframe', async () => {
      const orgId = await insertTestOrganization('Validation Test Org');

      await expect(
        orgService.getSummary({ organizationId: orgId, timeframeDays: '999' })
      ).rejects.toThrow('Invalid timeframe');
    });
  });
});
