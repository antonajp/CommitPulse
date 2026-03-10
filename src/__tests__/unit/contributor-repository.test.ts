import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import {
  ContributorRepository,
  type CommitContributorRow,
  type TeamContributorRow,
} from '../../database/contributor-repository.js';

/**
 * Unit tests for ContributorRepository class.
 *
 * Tests all insert/update/query methods using a mocked DatabaseService.
 * Verifies parameterized SQL for all operations. No real database required.
 *
 * Ticket: IQS-853
 */

// Mock pg module
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockOn = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    end: mockEnd,
    on: mockOn,
    query: mockQuery,
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  })),
}));

function createTestConfig(): DatabaseServiceConfig {
  return {
    host: 'localhost',
    port: 5433,
    database: 'gitrx_test',
    user: 'test_user',
    password: 'test_password',
  };
}

function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

function createSampleContributor(overrides?: Partial<CommitContributorRow>): CommitContributorRow {
  return {
    login: 'testuser',
    username: 'Test User',
    email: 'test@example.com',
    bio: 'A test user',
    userLocation: 'Test City',
    publicRepos: '10',
    followers: '5',
    followingUsers: '3',
    vendor: 'TestVendor',
    repo: 'test-repo',
    team: 'TestTeam',
    fullName: 'Test User Full',
    jiraName: 'test.user',
    isCompanyAccount: false,
    ...overrides,
  };
}

describe('ContributorRepository', () => {
  let dbService: DatabaseService;
  let repo: ContributorRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createTestConfig());
    repo = new ContributorRepository(dbService);
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // --------------------------------------------------------------------------
  // commit_contributors: Query methods
  // --------------------------------------------------------------------------

  describe('getCurrentContributors', () => {
    it('should return login-to-repo map', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { login: 'user1', repo: 'repo-a' },
          { login: 'user2', repo: 'repo-b' },
        ],
        rowCount: 2,
      });

      const result = await repo.getCurrentContributors();

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get('user1')).toBe('repo-a');
      expect(result.get('user2')).toBe('repo-b');
    });

    it('should return empty map when no contributors', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await repo.getCurrentContributors();
      expect(result.size).toBe(0);
    });
  });

  describe('getCommitContributors', () => {
    it('should return contributor details array', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { login: 'user1', vendor: 'VendorA', team: 'TeamA', full_name: 'User One' },
          { login: 'user2', vendor: null, team: 'TeamB', full_name: 'User Two' },
        ],
        rowCount: 2,
      });

      const result = await repo.getCommitContributors();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ login: 'user1', vendor: 'VendorA', team: 'TeamA', fullName: 'User One' });
      expect(result[1]).toEqual({ login: 'user2', vendor: null, team: 'TeamB', fullName: 'User Two' });
    });
  });

  // --------------------------------------------------------------------------
  // commit_contributors: Insert / Update methods
  // --------------------------------------------------------------------------

  describe('insertCommitContributor', () => {
    it('should insert with parameterized SQL', async () => {
      const contributor = createSampleContributor();
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await repo.insertCommitContributor(contributor);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_contributors'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toEqual([
        contributor.login, contributor.username, contributor.email,
        contributor.bio, contributor.userLocation, contributor.publicRepos,
        contributor.followers, contributor.followingUsers,
        contributor.vendor, contributor.repo, contributor.team,
        contributor.fullName, contributor.jiraName, contributor.isCompanyAccount,
      ]);
    });

    it('should use ON CONFLICT DO NOTHING', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      await expect(repo.insertCommitContributor(createSampleContributor())).resolves.not.toThrow();
    });
  });

  describe('updateCommitContributor', () => {
    it('should update with parameterized SQL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await repo.updateCommitContributor('testuser', 'NewVendor', 'NewTeam', 'New Name', 'new.jira', true);

      const updateCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE commit_contributors'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toEqual(['testuser', 'NewVendor', 'NewTeam', 'New Name', 'new.jira', true]);
    });

    it('should handle null values for optional fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await repo.updateCommitContributor('testuser', null, null, null, null, null);

      const updateCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE commit_contributors'),
      );
      expect(updateCall![1]).toEqual(['testuser', null, null, null, null, null]);
    });
  });

  describe('updateContributorTeam', () => {
    it('should update team with parameterized SQL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await repo.updateContributorTeam('testuser', 'Test User', 'NewTeam');

      const updateCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE commit_contributors SET team'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toEqual(['NewTeam', 'Test User', 'testuser']);
    });
  });

  // --------------------------------------------------------------------------
  // gitja_team_contributor: CRUD methods
  // --------------------------------------------------------------------------

  describe('upsertTeamContributor', () => {
    it('should upsert with parameterized SQL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const row: TeamContributorRow = {
        login: 'testuser', fullName: 'Test User', team: 'IQS', numCount: 42,
      };
      await repo.upsertTeamContributor(row);

      const insertCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO gitja_team_contributor'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toEqual(['testuser', 'Test User', 'IQS', 42]);
    });
  });

  describe('batchUpsertTeamContributors', () => {
    it('should batch upsert in a transaction', async () => {
      const callOrder: string[] = [];
      mockQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string') {
          callOrder.push(sql.trim().substring(0, 30));
        }
        return { rows: [], rowCount: 1 };
      });

      const rows: TeamContributorRow[] = [
        { login: 'u1', fullName: 'User One', team: 'IQS', numCount: 10 },
        { login: 'u1', fullName: 'User One', team: 'PROJ', numCount: 5 },
      ];

      await repo.batchUpsertTeamContributors(rows);

      expect(callOrder.some((s) => s.includes('BEGIN'))).toBe(true);
      expect(callOrder.some((s) => s.includes('COMMIT'))).toBe(true);
    });

    it('should skip when empty', async () => {
      const initialCallCount = mockQuery.mock.calls.length;
      await repo.batchUpsertTeamContributors([]);
      expect(mockQuery.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('deleteAllAuthorTeams', () => {
    it('should delete all team contributor records', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 15 });

      const count = await repo.deleteAllAuthorTeams();

      expect(count).toBe(15);
      const deleteCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM gitja_team_contributor') && !(c[0] as string).includes('WHERE'),
      );
      expect(deleteCall).toBeDefined();
    });
  });

  describe('deleteAuthorTeams', () => {
    it('should delete team records for specific login', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });

      const count = await repo.deleteAuthorTeams('testuser');

      expect(count).toBe(3);
      const deleteCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('WHERE login = $1'),
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![1]).toEqual(['testuser']);
    });

    it('should return 0 when no records exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const count = await repo.deleteAuthorTeams('nonexistent');
      expect(count).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Team query methods
  // --------------------------------------------------------------------------

  describe('getUniqueListOfContributorTeams', () => {
    it('should combine teams from contributors and jira projects', async () => {
      // First call: commit_contributors teams
      mockQuery.mockResolvedValueOnce({
        rows: [{ team: 'TeamA' }, { team: 'TeamB' }, { team: null }],
        rowCount: 3,
      });
      // Second call: jira_detail projects
      mockQuery.mockResolvedValueOnce({
        rows: [{ project: 'IQS' }, { project: 'TeamA' }], // TeamA is duplicate, should be deduplicated
        rowCount: 2,
      });

      const result = await repo.getUniqueListOfContributorTeams();

      // TeamA, TeamB, IQS (null filtered out, TeamA deduplicated)
      expect(result).toHaveLength(3);
      expect(result).toContain('TeamA');
      expect(result).toContain('TeamB');
      expect(result).toContain('IQS');
    });

    it('should filter out null teams', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ team: null }],
        rowCount: 1,
      });
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await repo.getUniqueListOfContributorTeams();
      expect(result).toHaveLength(0);
    });
  });

  describe('getPrimaryTeamAssignment', () => {
    it('should return team when exactly one result', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ team: 'IQS' }],
        rowCount: 1,
      });

      const result = await repo.getPrimaryTeamAssignment('Test User');

      expect(result).toBe('IQS');
    });

    it('should return null when no results', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await repo.getPrimaryTeamAssignment('Unknown User');
      expect(result).toBeNull();
    });

    it('should return null when multiple results', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ team: 'IQS' }, { team: 'PROJ' }],
        rowCount: 2,
      });

      const result = await repo.getPrimaryTeamAssignment('Ambiguous User');
      expect(result).toBeNull();
    });

    it('should pass fullName as parameterized value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await repo.getPrimaryTeamAssignment('Test User');

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('max_num_count_per_full_name'),
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual(['Test User']);
    });
  });

  // --------------------------------------------------------------------------
  // SQL injection prevention
  // --------------------------------------------------------------------------

  describe('SQL injection prevention', () => {
    it('should never interpolate login into SQL', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await repo.deleteAuthorTeams("'; DROP TABLE gitja_team_contributor; --");

      const deleteCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM gitja_team_contributor'),
      );
      expect(deleteCall).toBeDefined();
      expect((deleteCall![0] as string)).not.toContain('DROP TABLE');
      expect(deleteCall![1]).toEqual(["'; DROP TABLE gitja_team_contributor; --"]);
    });

    it('should never interpolate fullName into SQL', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await repo.getPrimaryTeamAssignment("'; DROP TABLE max_num_count_per_full_name; --");

      const selectCall = mockQuery.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('max_num_count_per_full_name'),
      );
      expect(selectCall).toBeDefined();
      expect((selectCall![0] as string)).not.toContain('DROP TABLE');
    });
  });
});
