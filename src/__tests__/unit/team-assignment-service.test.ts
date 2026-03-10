import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { ContributorRepository } from '../../database/contributor-repository.js';
import { CommitJiraRepository } from '../../database/commit-jira-repository.js';
import { PipelineRepository } from '../../database/pipeline-repository.js';
import { TeamAssignmentService } from '../../services/team-assignment-service.js';

/**
 * Unit tests for TeamAssignmentService class.
 *
 * Tests the team assignment logic converted from Python GitjaTeamContributor.py:
 * - getCountOfMatchingCommitInfoFromProjectList (Jira key counting in commits)
 * - resetAuthorTeams (delete and recalculate for single author)
 * - resetAllKnownAuthorTeams (full reset across all contributors)
 * - updateContributorPrimaryTeam (set primary team from view)
 * - updateAllContributorsPrimaryTeam (apply primary teams for all)
 * - updateTeamAssignments (full orchestration)
 * - Pipeline run tracking and table counts logging
 *
 * Uses mocked repositories. Validates Python-to-TypeScript algorithm preservation.
 *
 * Ticket: IQS-862
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

/**
 * Helper: create a test config for DatabaseService.
 */
function createTestConfig(): DatabaseServiceConfig {
  return {
    host: 'localhost',
    port: 5433,
    database: 'gitrx_test',
    user: 'test_user',
    password: 'test_password',
  };
}

/**
 * Helper: set up the mock pool's connect method to return a mock client.
 */
function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  // Default health check response
  mockQuery.mockResolvedValue({ rows: [{ health: 1 }], rowCount: 1 });
}

describe('TeamAssignmentService', () => {
  let dbService: DatabaseService;
  let contributorRepo: ContributorRepository;
  let commitJiraRepo: CommitJiraRepository;
  let pipelineRepo: PipelineRepository;
  let service: TeamAssignmentService;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createTestConfig());
    contributorRepo = new ContributorRepository(dbService);
    commitJiraRepo = new CommitJiraRepository(dbService);
    pipelineRepo = new PipelineRepository(dbService);

    service = new TeamAssignmentService(
      contributorRepo,
      commitJiraRepo,
      pipelineRepo,
    );
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // ==========================================================================
  // getCountOfMatchingCommitInfoFromProjectList
  // ==========================================================================

  describe('getCountOfMatchingCommitInfoFromProjectList', () => {
    it('should count Jira project key references in commit messages', () => {
      const commits = [
        { commitMessage: 'Fix PROJ-123 bug in auth', branch: 'feature/PROJ-123' },
        { commitMessage: 'PROJ-456 refactor', branch: 'main' },
        { commitMessage: 'Update readme', branch: 'main' },
        { commitMessage: 'Fix FEAT-100 issue', branch: 'feature/FEAT-100' },
      ];
      const projectList = ['PROJ', 'FEAT', 'BUG'];

      const counts = service.getCountOfMatchingCommitInfoFromProjectList(
        commits, projectList,
      );

      // PROJ appears in 2 commit messages, FEAT in 1
      expect(counts.get('PROJ')).toBe(2);
      expect(counts.get('FEAT')).toBe(1);
      expect(counts.has('BUG')).toBe(false);
    });

    it('should be case-insensitive when matching keys', () => {
      const commits = [
        { commitMessage: 'fix proj-123', branch: 'main' },
      ];
      const projectList = ['PROJ'];

      const counts = service.getCountOfMatchingCommitInfoFromProjectList(
        commits, projectList,
      );

      expect(counts.get('PROJ')).toBe(1);
    });

    it('should only match first found key per commit message', () => {
      // Matches Python behavior: break after first match per row
      const commits = [
        { commitMessage: 'PROJ-1 and FEAT-2 in same message', branch: 'main' },
      ];
      const projectList = ['PROJ', 'FEAT'];

      const counts = service.getCountOfMatchingCommitInfoFromProjectList(
        commits, projectList,
      );

      // Python breaks after first match, so PROJ gets the count
      expect(counts.get('PROJ')).toBe(1);
      expect(counts.has('FEAT')).toBe(false);
    });

    it('should return empty map for no matches', () => {
      const commits = [
        { commitMessage: 'Updated readme', branch: 'main' },
      ];
      const projectList = ['PROJ'];

      const counts = service.getCountOfMatchingCommitInfoFromProjectList(
        commits, projectList,
      );

      expect(counts.size).toBe(0);
    });

    it('should handle empty commit list', () => {
      const counts = service.getCountOfMatchingCommitInfoFromProjectList(
        [], ['PROJ'],
      );

      expect(counts.size).toBe(0);
    });

    it('should handle empty project list', () => {
      const commits = [
        { commitMessage: 'PROJ-123 fix', branch: 'main' },
      ];
      const counts = service.getCountOfMatchingCommitInfoFromProjectList(
        commits, [],
      );

      expect(counts.size).toBe(0);
    });

    it('should filter counts to only known teams', () => {
      // Even if a key is found, if it's not in project list, skip
      const commits = [
        { commitMessage: 'UNKNOWN-123 fix', branch: 'main' },
      ];
      const projectList = ['PROJ'];

      const counts = service.getCountOfMatchingCommitInfoFromProjectList(
        commits, projectList,
      );

      expect(counts.size).toBe(0);
    });
  });

  // ==========================================================================
  // resetAuthorTeams
  // ==========================================================================

  describe('resetAuthorTeams', () => {
    it('should delete old teams, count refs, and insert new records', async () => {
      // Mock deleteAuthorTeams
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 2 })
        // Mock getCommitMsgBranchForAuthor
        .mockResolvedValueOnce({
          rows: [
            { commit_message: 'Fix PROJ-123', branch: 'feature/PROJ-123' },
            { commit_message: 'PROJ-456 update', branch: 'main' },
            { commit_message: 'FEAT-100 new feature', branch: 'feature/FEAT-100' },
          ],
          rowCount: 3,
        })
        // Mock BEGIN (transaction for batch upsert)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock INSERT for PROJ (count=2)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock INSERT for FEAT (count=1)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.resetAuthorTeams('user1', 'User One', ['PROJ', 'FEAT']);

      // Verify DELETE was called
      const deleteCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' &&
          (c[0] as string).includes('DELETE FROM gitja_team_contributor WHERE login'),
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]![1]).toEqual(['user1']);

      // Verify INSERT calls for team contributors
      const insertCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' &&
          (c[0] as string).includes('INSERT INTO gitja_team_contributor'),
      );
      expect(insertCalls).toHaveLength(2);
    });

    it('should handle author with no commit messages', async () => {
      // Mock deleteAuthorTeams
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock getCommitMsgBranchForAuthor (empty)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.resetAuthorTeams('user1', 'User One', ['PROJ']);

      // Verify DELETE was called but no INSERTs
      const insertCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' &&
          (c[0] as string).includes('INSERT INTO gitja_team_contributor'),
      );
      expect(insertCalls).toHaveLength(0);
    });
  });

  // ==========================================================================
  // resetAllKnownAuthorTeams
  // ==========================================================================

  describe('resetAllKnownAuthorTeams', () => {
    it('should reset teams for all contributors', async () => {
      // Mock getCommitContributors (returns contributors list)
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { login: 'user1', vendor: null, team: 'PROJ', full_name: 'User One' },
            { login: 'user2', vendor: null, team: null, full_name: 'User Two' },
          ],
          rowCount: 2,
        })
        // user1: deleteAuthorTeams
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // user1: getCommitMsgBranchForAuthor
        .mockResolvedValueOnce({
          rows: [{ commit_message: 'PROJ-1 fix', branch: 'main' }],
          rowCount: 1,
        })
        // user1: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // user1: INSERT PROJ
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // user1: COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // user2: deleteAuthorTeams
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // user2: getCommitMsgBranchForAuthor
        .mockResolvedValueOnce({
          rows: [{ commit_message: 'FEAT-2 update', branch: 'main' }],
          rowCount: 1,
        })
        // user2: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // user2: INSERT FEAT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // user2: COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.resetAllKnownAuthorTeams(['PROJ', 'FEAT']);

      // Verify both authors had their teams deleted
      const deleteCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' &&
          (c[0] as string).includes('DELETE FROM gitja_team_contributor WHERE login'),
      );
      expect(deleteCalls).toHaveLength(2);
    });
  });

  // ==========================================================================
  // updateContributorPrimaryTeam
  // ==========================================================================

  describe('updateContributorPrimaryTeam', () => {
    it('should update contributor team when primary team exists', async () => {
      // Mock getPrimaryTeamAssignment
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ team: 'PROJ' }],
          rowCount: 1,
        })
        // Mock UPDATE commit_contributors
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const updated = await service.updateContributorPrimaryTeam(
        'user1', 'User One',
      );

      expect(updated).toBe(true);

      // Verify UPDATE was called with correct params
      const updateCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' &&
          (c[0] as string).includes('UPDATE commit_contributors SET team'),
      );
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]![1]).toEqual(['PROJ', 'User One', 'user1']);
    });

    it('should skip update when no primary team found', async () => {
      // Mock getPrimaryTeamAssignment (no result)
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const updated = await service.updateContributorPrimaryTeam(
        'user1', 'User One',
      );

      expect(updated).toBe(false);

      // Verify no UPDATE was called
      const updateCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' &&
          (c[0] as string).includes('UPDATE commit_contributors SET team'),
      );
      expect(updateCalls).toHaveLength(0);
    });
  });

  // ==========================================================================
  // updateAllContributorsPrimaryTeam
  // ==========================================================================

  describe('updateAllContributorsPrimaryTeam', () => {
    it('should update primary team for all contributors', async () => {
      // Mock getCommitContributors
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { login: 'user1', vendor: null, team: null, full_name: 'User One' },
            { login: 'user2', vendor: null, team: null, full_name: 'User Two' },
          ],
          rowCount: 2,
        })
        // user1: getPrimaryTeamAssignment
        .mockResolvedValueOnce({
          rows: [{ team: 'PROJ' }],
          rowCount: 1,
        })
        // user1: updateContributorTeam
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // user2: getPrimaryTeamAssignment
        .mockResolvedValueOnce({
          rows: [{ team: 'FEAT' }],
          rowCount: 1,
        })
        // user2: updateContributorTeam
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await service.updateAllContributorsPrimaryTeam();

      expect(result).toBe(2);
    });

    it('should skip contributors without primary team assignment', async () => {
      // Mock getCommitContributors
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { login: 'user1', vendor: null, team: null, full_name: 'User One' },
          ],
          rowCount: 1,
        })
        // user1: getPrimaryTeamAssignment (no result)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.updateAllContributorsPrimaryTeam();

      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // updateTeamAssignments (full orchestration)
  // ==========================================================================

  describe('updateTeamAssignments', () => {
    it('should orchestrate full reset and primary team update', async () => {
      // Mock getUniqueListOfContributorTeams (for known teams)
      mockQuery
        // getUniqueListOfContributorTeams - commit_contributors teams
        .mockResolvedValueOnce({
          rows: [{ team: 'PROJ' }, { team: 'FEAT' }],
          rowCount: 2,
        })
        // getUniqueListOfContributorTeams - jira_detail projects
        .mockResolvedValueOnce({
          rows: [{ project: 'PROJ' }, { project: 'BUG' }],
          rowCount: 2,
        })
        // resetAllKnownAuthorTeams: getCommitContributors
        .mockResolvedValueOnce({
          rows: [
            { login: 'user1', vendor: null, team: 'PROJ', full_name: 'User One' },
          ],
          rowCount: 1,
        })
        // user1: deleteAuthorTeams
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // user1: getCommitMsgBranchForAuthor
        .mockResolvedValueOnce({
          rows: [
            { commit_message: 'PROJ-1 fix', branch: 'main' },
            { commit_message: 'PROJ-2 update', branch: 'main' },
          ],
          rowCount: 2,
        })
        // user1: BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // user1: INSERT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // user1: COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // updateAllContributorsPrimaryTeam: getCommitContributors
        .mockResolvedValueOnce({
          rows: [
            { login: 'user1', vendor: null, team: null, full_name: 'User One' },
          ],
          rowCount: 1,
        })
        // user1: getPrimaryTeamAssignment
        .mockResolvedValueOnce({
          rows: [{ team: 'PROJ' }],
          rowCount: 1,
        })
        // user1: updateContributorTeam
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await service.updateTeamAssignments();

      expect(result.authorsProcessed).toBe(1);
      expect(result.primaryTeamsUpdated).toBe(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Pipeline integration
  // ==========================================================================

  describe('pipeline integration', () => {
    it('should track pipeline run and log table counts', async () => {
      // Mock insertPipelineStart
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 42 }],
          rowCount: 1,
        })
        // Mock getUniqueListOfContributorTeams
        .mockResolvedValueOnce({
          rows: [{ team: 'PROJ' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ project: 'PROJ' }],
          rowCount: 1,
        })
        // Mock getCommitContributors (empty for simplicity)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock getCommitContributors for primary update (empty)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock logTableCounts - 6 tables to count
        .mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: '20' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: '30' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: '40' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: '60' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock updatePipelineRun
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await service.updateTeamAssignmentsWithPipeline();

      expect(result.authorsProcessed).toBe(0);
      expect(result.pipelineRunId).toBe(42);

      // Verify pipeline start was inserted
      const startCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' &&
          (c[0] as string).includes('INSERT INTO gitr_pipeline_run'),
      );
      expect(startCalls).toHaveLength(1);

      // Verify pipeline run was updated to FINISHED
      const updateCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' &&
          (c[0] as string).includes('UPDATE gitr_pipeline_run'),
      );
      expect(updateCalls).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Python-TypeScript equivalence golden tests
  // ==========================================================================

  describe('Python-TypeScript equivalence', () => {
    it('should match Python get_count_of_matching_commit_info_from_project_list behavior', () => {
      // From GitjaTeamContributor.py lines 94-110
      // Python checks str(s).upper()+"-" in str(row['commit_message']).upper()
      // Breaks after first match per row
      const commits = [
        { commitMessage: 'Fix ESR-123 and CDP-456', branch: 'feature/ESR-123' },
        { commitMessage: 'Update SFDC-789', branch: 'main' },
        { commitMessage: 'ESR-111 another fix', branch: 'feature/ESR-111' },
        { commitMessage: 'No jira key here', branch: 'develop' },
      ];
      const projectList = ['ESR', 'CDP', 'SFDC', 'PROJ2'];

      const counts = service.getCountOfMatchingCommitInfoFromProjectList(
        commits, projectList,
      );

      // ESR: 2 (first match in row 1 and row 3)
      // SFDC: 1 (row 2)
      // CDP: 0 (ESR is checked first and matches row 1)
      expect(counts.get('ESR')).toBe(2);
      expect(counts.get('SFDC')).toBe(1);
      expect(counts.has('CDP')).toBe(false);
    });

    it('should match Python _filter_series by only keeping known teams', () => {
      // Python: series.loc[series.index.intersection(item_list)]
      // TypeScript: filter map to only include keys in projectList
      const commits = [
        { commitMessage: 'PROJ-1 fix', branch: 'main' },
        { commitMessage: 'UNKNOWN-2 fix', branch: 'main' },
      ];
      const projectList = ['PROJ'];

      const counts = service.getCountOfMatchingCommitInfoFromProjectList(
        commits, projectList,
      );

      expect(counts.has('PROJ')).toBe(true);
      expect(counts.has('UNKNOWN')).toBe(false);
    });

    it('should match Python reset_author_teams flow (delete then insert)', async () => {
      // Mock deleteAuthorTeams
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 5 })
        // Mock getCommitMsgBranchForAuthor
        .mockResolvedValueOnce({
          rows: [
            { commit_message: 'ESR-100 fix', branch: 'main' },
            { commit_message: 'ESR-200 update', branch: 'main' },
            { commit_message: 'CDP-300 feature', branch: 'feature/CDP-300' },
          ],
          rowCount: 3,
        })
        // Mock BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock INSERT for ESR (count=2)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock INSERT for CDP (count=1)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.resetAuthorTeams('jdoe', 'John Doe', ['ESR', 'CDP', 'SFDC']);

      // Verify DELETE was called first
      const allSqlCalls = mockQuery.mock.calls
        .filter((c: unknown[]) => typeof c[0] === 'string')
        .map((c: unknown[]) => (c[0] as string).trim().substring(0, 40));

      // First relevant call should be DELETE, then SELECT for commits, then INSERTs
      const deleteIdx = allSqlCalls.findIndex((s: string) =>
        s.includes('DELETE FROM gitja_team_contributor'));
      const selectIdx = allSqlCalls.findIndex((s: string) =>
        s.includes('SELECT commit_message'));
      expect(deleteIdx).toBeLessThan(selectIdx);
    });
  });

  // ==========================================================================
  // SQL injection prevention
  // ==========================================================================

  describe('SQL injection prevention', () => {
    it('should never interpolate user input into SQL queries', async () => {
      // Mock with malicious author name
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.resetAuthorTeams(
        "user'; DROP TABLE commit_contributors; --",
        'Malicious User',
        ['PROJ'],
      );

      // Verify no SQL string contains the injection
      for (const call of mockQuery.mock.calls) {
        const sql = call[0] as string;
        if (typeof sql === 'string') {
          expect(sql).not.toContain('DROP TABLE');
        }
      }
    });
  });
});
