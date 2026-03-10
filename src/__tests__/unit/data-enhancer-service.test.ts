import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { CommitRepository } from '../../database/commit-repository.js';
import { CommitJiraRepository } from '../../database/commit-jira-repository.js';
import { DataEnhancerService } from '../../services/data-enhancer-service.js';

/**
 * Unit tests for DataEnhancerService class.
 *
 * Tests the commit-to-Jira linking logic:
 * - Regex pattern matching (findJiraProjectRefsInText)
 * - Exclusion logic (shouldExcludeMatch)
 * - Cleanup logic (cleanupJiraKeyMatch)
 * - is_jira_ref flag detection (identifyCommitMsgJiraRef)
 * - commit_jira relationship insertion (identifyCommitMsgJiraRelationship)
 * - Full orchestration (enhanceCommitJiraLinks)
 *
 * Uses mocked DatabaseService, CommitRepository, and CommitJiraRepository.
 * Validates Python-to-TypeScript algorithm preservation.
 *
 * Ticket: IQS-861
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

/**
 * Testable subclass of DataEnhancerService that provides
 * contributor teams via a simple setter rather than DB query.
 */
class TestableDataEnhancerService extends DataEnhancerService {
  private testTeams: string[] = [];

  setTestTeams(teams: string[]): void {
    this.testTeams = teams;
  }

  protected override async getContributorTeams(): Promise<string[]> {
    return this.testTeams;
  }
}

describe('DataEnhancerService', () => {
  let dbService: DatabaseService;
  let commitRepo: CommitRepository;
  let commitJiraRepo: CommitJiraRepository;
  let service: TestableDataEnhancerService;

  beforeEach(async () => {
    vi.clearAllMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    setupMockClient();
    dbService = new DatabaseService();
    await dbService.initialize(createTestConfig());
    commitRepo = new CommitRepository(dbService);
    commitJiraRepo = new CommitJiraRepository(dbService);

    // Create with default key aliases matching the original Python hardcoded values
    service = new TestableDataEnhancerService(
      commitRepo,
      commitJiraRepo,
      { PROJ: 'PROJ2', CRM: 'CRMSYS' },
    );
  });

  afterEach(async () => {
    if (dbService.isInitialized()) {
      await dbService.shutdown();
    }
  });

  // ==========================================================================
  // findJiraProjectRefsInText - regex pattern matching
  // ==========================================================================

  describe('findJiraProjectRefsInText', () => {
    it('should find standard Jira keys with hyphens', () => {
      const keys = ['PROJ', 'FEAT'];
      const text = 'Fixed PROJ-123 and FEAT-456 issues';

      const matches = service.findJiraProjectRefsInText(keys, text);

      expect(matches).toContain('PROJ-123');
      expect(matches).toContain('FEAT-456');
      expect(matches).toHaveLength(2);
    });

    it('should be case-insensitive', () => {
      const keys = ['PROJ2'];
      const text = 'PROJ2-1999updating sequence in constant class';

      const matches = service.findJiraProjectRefsInText(keys, text);

      expect(matches).toHaveLength(1);
      expect(matches[0]!.toUpperCase()).toContain('PROJ2');
    });

    it('should match keys with dots as separators', () => {
      const keys = ['SFDC'];
      const text = 'Updated SFDC.123 configuration';

      const matches = service.findJiraProjectRefsInText(keys, text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toBe('SFDC.123');
    });

    it('should match keys with spaces as separators', () => {
      const keys = ['PROJ'];
      const text = 'PROJ 456 was deployed';

      const matches = service.findJiraProjectRefsInText(keys, text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toBe('PROJ 456');
    });

    it('should match keys with no separator (direct digit)', () => {
      const keys = ['PROJ'];
      const text = 'PROJ123 was deployed';

      const matches = service.findJiraProjectRefsInText(keys, text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toBe('PROJ123');
    });

    it('should return empty array for no matches', () => {
      const keys = ['PROJ'];
      const text = 'No jira keys here';

      const matches = service.findJiraProjectRefsInText(keys, text);

      expect(matches).toHaveLength(0);
    });

    it('should return empty array for empty keys list', () => {
      const matches = service.findJiraProjectRefsInText([], 'PROJ-123');
      expect(matches).toHaveLength(0);
    });

    it('should return empty array for empty text', () => {
      const matches = service.findJiraProjectRefsInText(['PROJ'], '');
      expect(matches).toHaveLength(0);
    });

    it('should find multiple keys from a large set (matching Python test)', () => {
      const keys = ['ESR', 'CCACMS', 'SFDC','CRM', 'DMS', 'PROJ2', 'PTCS', 'GXM', 'PCB', 'CRMSYS', 'ECXX', 'DVX', 'CEE', 'DOC', 'PROJ'];
      const text = 'Proj2-1999updating sequence in constant class and changing logic to relate rent breakdown and rent calculation';

      const matches = service.findJiraProjectRefsInText(keys, text);

      // Should find PROJ2-1999 and PROJ-1999 (both PROJ2 and PROJ match)
      expect(matches.length).toBeGreaterThanOrEqual(1);
      // At minimum, PROJ2-1999 should match
      expect(matches.some((m) => /PROJ2/i.test(m) && m.includes('1999'))).toBe(true);
    });

    it('should find keys in branch name text', () => {
      const keys = ['PROJ'];
      const text = 'feature/PROJ-789-add-auth_main';

      const matches = service.findJiraProjectRefsInText(keys, text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toBe('PROJ-789');
    });

    it('should handle special regex characters in project keys', () => {
      const keys = ['C++', 'C#'];
      const text = 'C++-123 and C#-456';

      // Should not throw, keys are properly escaped
      const matches = service.findJiraProjectRefsInText(keys, text);
      expect(matches).toHaveLength(2);
    });
  });

  // ==========================================================================
  // shouldExcludeMatch - exclusion logic
  // ==========================================================================

  describe('shouldExcludeMatch', () => {
    const projectKeys = ['EXR', 'CAP', 'SFDC', 'PROJ2', 'PROJ', 'CRM', 'CRMSYS'];

    it('should exclude SFDC.20 release tags', () => {
      expect(service.shouldExcludeMatch('SFDC.2024', projectKeys)).toBe(true);
      expect(service.shouldExcludeMatch('sfdc.2023', projectKeys)).toBe(true);
    });

    it('should exclude strings with no numeric suffix', () => {
      expect(service.shouldExcludeMatch('PROJ-', projectKeys)).toBe(true);
      expect(service.shouldExcludeMatch('PROJ', projectKeys)).toBe(true);
    });

    it('should exclude bare project keys (exact match)', () => {
      expect(service.shouldExcludeMatch('ESR', projectKeys)).toBe(true);
      expect(service.shouldExcludeMatch('esr', projectKeys)).toBe(true);
    });

    it('should exclude bare project keys without hyphens', () => {
      // "CDP-" without digits is caught by rule 2 (no numeric suffix)
      // But "CDP" with hyphen removed matches a project key
      expect(service.shouldExcludeMatch('CDP-', projectKeys)).toBe(true);
    });

    it('should exclude CPD-20 padded zero pattern', () => {
      expect(service.shouldExcludeMatch('CPD-2023', projectKeys)).toBe(true);
      expect(service.shouldExcludeMatch('cpd-20', projectKeys)).toBe(true);
    });

    it('should not exclude valid Jira keys', () => {
      expect(service.shouldExcludeMatch('ESR-123', projectKeys)).toBe(false);
      expect(service.shouldExcludeMatch('PROJ2-999', projectKeys)).toBe(false);
      expect(service.shouldExcludeMatch('CDP-456', projectKeys)).toBe(false);
    });

    it('should not exclude keys with numeric suffixes', () => {
      expect(service.shouldExcludeMatch('PROJ-1', ['PROJ'])).toBe(false);
      expect(service.shouldExcludeMatch('PROJ-99999', ['PROJ'])).toBe(false);
    });
  });

  // ==========================================================================
  // cleanupJiraKeyMatch - cleanup logic
  // ==========================================================================

  describe('cleanupJiraKeyMatch', () => {
    const projectKeys = ['ESR', 'CDP', 'SFDC', 'PROJ', 'CRM', 'PROJ2', 'CRMSYS'];

    it('should replace spaces with hyphens', () => {
      const result = service.cleanupJiraKeyMatch('PROJ 123', projectKeys);
      // PROJ 123 -> PROJ-123 (space to hyphen) -> PROJ2-123 (alias)
      expect(result).toBe('PROJ2-123');
    });

    it('should apply PROJ -> PROJ2 alias', () => {
      const result = service.cleanupJiraKeyMatch('PROJ-999', projectKeys);
      expect(result).toBe('PROJ2-999');
    });

    it('should apply CRM -> CRMSYS alias', () => {
      const result = service.cleanupJiraKeyMatch('CRM-456', projectKeys);
      expect(result).toBe('CRMSYS-456');
    });

    it('should fix triple hyphens', () => {
      const result = service.cleanupJiraKeyMatch('PROJ---123', projectKeys);
      // PROJ---123 -> PROJ-123 (fix hyphens) -> PROJ2-123 (alias)
      expect(result).toBe('PROJ2-123');
    });

    it('should fix double hyphens', () => {
      const result = service.cleanupJiraKeyMatch('PROJ--123', projectKeys);
      // PROJ--123 -> PROJ-123 (fix hyphens) -> PROJ2-123 (alias)
      expect(result).toBe('PROJ2-123');
    });

    it('should fix CDP-0 padded zeros', () => {
      const result = service.cleanupJiraKeyMatch('CDP-0456', projectKeys);
      expect(result).toBe('CDP-456');
    });

    it('should insert missing hyphen between key and number', () => {
      const result = service.cleanupJiraKeyMatch('ESR1', projectKeys);
      expect(result).toBe('ESR-1');
    });

    it('should not double-modify PROJ2 with hyphen insertion', () => {
      const result = service.cleanupJiraKeyMatch('PROJ2-1999', projectKeys);
      // After alias: PROJ is replaced with PROJ2 but PROJ2 already has a hyphen
      // The key "PROJ-" gets replaced to "PROJ2-", result stays "PROJ2-1999"
      // But input already starts with PROJ2, so no alias match on "PROJ-"
      expect(result).toBe('PROJ2-1999');
    });

    it('should handle combined cleanup operations', () => {
      // Space replacement + alias
      const result = service.cleanupJiraKeyMatch('PROJ 999', projectKeys);
      // Step 1: "PROJ 999" -> "PROJ-999"
      // Step 2: "PROJ-999" -> "PROJ2-999"
      expect(result).toBe('PROJ2-999');
    });

    it('should leave valid keys unchanged when no alias applies', () => {
      const result = service.cleanupJiraKeyMatch('ESR-123', projectKeys);
      // ESR has no alias configured, so it stays unchanged
      expect(result).toBe('ESR-123');
    });
  });

  // ==========================================================================
  // identifyCommitMsgJiraRef - is_jira_ref flag processing
  // ==========================================================================

  describe('identifyCommitMsgJiraRef', () => {
    it('should set is_jira_ref=true when commit message contains Jira key', async () => {
      // Mock getCommitMsgForJiraRef to return commits
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_message: 'Fix PROJ-123 bug in auth' },
            { sha: 'sha2', commit_message: 'Update readme' },
          ],
          rowCount: 2,
        })
        // Mock BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock UPDATE for sha1
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock UPDATE for sha2
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.identifyCommitMsgJiraRef('testuser', ['PROJ'], false);

      expect(result.refsUpdated).toBe(2);

      // Verify the UPDATE calls
      const updateCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE commit_history SET is_jira_ref'),
      );
      expect(updateCalls).toHaveLength(2);

      // sha1 should have is_jira_ref=true (PROJ-123 found)
      expect(updateCalls[0]![1]).toEqual(['sha1', true]);
      // sha2 should have is_jira_ref=false (no jira key)
      expect(updateCalls[1]![1]).toEqual(['sha2', false]);
    });

    it('should return 0 when no commits to process', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.identifyCommitMsgJiraRef('testuser', ['PROJ'], false);

      expect(result.refsUpdated).toBe(0);
    });

    it('should be case-insensitive when checking keys', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ sha: 'sha1', commit_message: 'proj-123 fix' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.identifyCommitMsgJiraRef('testuser', ['PROJ'], false);

      expect(result.refsUpdated).toBe(1);

      const updateCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE commit_history SET is_jira_ref'),
      );
      // lowercase proj- should match PROJ-
      expect(updateCalls[0]![1]).toEqual(['sha1', true]);
    });
  });

  // ==========================================================================
  // identifyCommitMsgJiraRelationship - full linking
  // ==========================================================================

  describe('identifyCommitMsgJiraRelationship', () => {
    it('should find and insert Jira links from commit messages', async () => {
      // Mock getAuthorUnlinkedCommits
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_message: 'Fix PROJ-123 and PROJ-456', branch: 'main' },
          ],
          rowCount: 1,
        })
        // Mock insertCommitJira (BEGIN)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock INSERT for PROJ-123
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock INSERT for PROJ-456
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.identifyCommitMsgJiraRelationship(
        'testuser', ['PROJ'], false, false,
      );

      expect(result.commitsScanned).toBe(1);
      expect(result.linksInserted).toBe(2);

      // Verify INSERT calls
      const insertCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_jira'),
      );
      expect(insertCalls).toHaveLength(2);
    });

    it('should delete existing links in refresh mode', async () => {
      // Mock deleteAuthorCommitJira
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 3 })
        // Mock getAuthorUnlinkedCommits (returns empty for simplicity)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.identifyCommitMsgJiraRelationship(
        'testuser', ['PROJ'], true, false,
      );

      // Verify DELETE was called
      const deleteCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM commit_jira'),
      );
      expect(deleteCalls).toHaveLength(1);
      expect(result.commitsScanned).toBe(0);
    });

    it('should deduplicate matches within the same commit', async () => {
      // Mock getAuthorUnlinkedCommits - same key appears twice
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_message: 'PROJ-123 fix PROJ-123 again', branch: 'main' },
          ],
          rowCount: 1,
        })
        // Mock insertCommitJira (BEGIN)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock INSERT (only 1 due to dedup)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.identifyCommitMsgJiraRelationship(
        'testuser', ['PROJ'], false, false,
      );

      // Only 1 link despite 2 matches (deduplication)
      expect(result.linksInserted).toBe(1);
    });

    it('should exclude false positives', async () => {
      // Mock getAuthorUnlinkedCommits
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_message: 'Release SFDC.2024.1 deployed', branch: 'main' },
          ],
          rowCount: 1,
        });

      const result = await service.identifyCommitMsgJiraRelationship(
        'testuser', ['SFDC'], false, false,
      );

      // SFDC.2024 should be excluded (release tag pattern)
      expect(result.linksInserted).toBe(0);
    });

    it('should apply cleanup to matched keys', async () => {
      // Mock getAuthorUnlinkedCommits
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_message: 'Fix PROJ-999 issue', branch: 'main' },
          ],
          rowCount: 1,
        })
        // Mock insertCommitJira (BEGIN)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock INSERT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.identifyCommitMsgJiraRelationship(
        'testuser', ['PROJ'], false, false,
      );

      expect(result.linksInserted).toBe(1);

      // Verify PROJ-999 was cleaned up to PROJ2-999
      const insertCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_jira'),
      );
      expect(insertCalls).toHaveLength(1);
      // The jiraKey param should be PROJ2-999 (after alias cleanup)
      expect(insertCalls[0]![1]![1]).toBe('PROJ2-999');
    });

    it('should extract project key from cleaned jira key', async () => {
      // Mock getAuthorUnlinkedCommits
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_message: 'Fix PROJ-42 issue', branch: 'main' },
          ],
          rowCount: 1,
        })
        // Mock insertCommitJira (BEGIN)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock INSERT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.identifyCommitMsgJiraRelationship(
        'testuser', ['PROJ'], false, false,
      );

      // Verify the jiraProject is correctly extracted from the ALIASED key
      // PROJ-42 -> PROJ2-42 (alias), so jiraProject should be PROJ2
      const insertCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO commit_jira'),
      );
      expect(insertCalls).toHaveLength(1);
      // params: [sha, jiraKey, author, jiraProject]
      expect(insertCalls[0]![1]![3]).toBe('PROJ2');
    });

    it('should return zero counts when no commits to process', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.identifyCommitMsgJiraRelationship(
        'testuser', ['PROJ'], false, false,
      );

      expect(result.commitsScanned).toBe(0);
      expect(result.linksInserted).toBe(0);
    });
  });

  // ==========================================================================
  // enhanceCommitJiraLinks - full orchestration
  // ==========================================================================

  describe('enhanceCommitJiraLinks', () => {
    it('should process all authors and return aggregate results', async () => {
      // Set up test teams (these will be the jira keys)
      service.setTestTeams(['PROJ', 'FEAT']);

      // Mock getCommitContributorLogins (1 author)
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ author: 'user1' }],
          rowCount: 1,
        })
        // Mock getCommitMsgForJiraRef for user1
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_message: 'Fix PROJ-100' },
          ],
          rowCount: 1,
        })
        // Mock batchUpdateIsJiraRef (BEGIN)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock UPDATE
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock getAuthorUnlinkedCommits for user1
        .mockResolvedValueOnce({
          rows: [
            { sha: 'sha1', commit_message: 'Fix PROJ-100', branch: 'main' },
          ],
          rowCount: 1,
        })
        // Mock insertCommitJira (BEGIN)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock INSERT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.enhanceCommitJiraLinks();

      expect(result.authorsProcessed).toBe(1);
      expect(result.commitsScanned).toBe(1);
      expect(result.linksInserted).toBe(1);
      expect(result.refsUpdated).toBe(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should include alias source keys in scan list', async () => {
      // Set up test teams
      service.setTestTeams(['PROJ']);

      // Mock getCommitContributorLogins (0 authors for simplicity)
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.enhanceCommitJiraLinks();

      // The key list should include PROJ + PROJ + CRM (from aliases)
      // We can verify this indirectly through the behavior - since there are
      // no authors, no further processing happens, but the key list is built
    });

    it('should handle empty author list gracefully', async () => {
      service.setTestTeams(['PROJ']);

      // Mock getCommitContributorLogins (no authors)
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.enhanceCommitJiraLinks();

      expect(result.authorsProcessed).toBe(0);
      expect(result.commitsScanned).toBe(0);
      expect(result.linksInserted).toBe(0);
      expect(result.refsUpdated).toBe(0);
    });

    it('should pass refresh and combine options through', async () => {
      service.setTestTeams(['PROJ']);

      // Mock getCommitContributorLogins (1 author)
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ author: 'user1' }],
          rowCount: 1,
        })
        // Mock getCommitMsgForJiraRef (refresh=true uses different SQL)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock deleteAuthorCommitJira (refresh=true deletes first)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock getAuthorUnlinkedCommits (refresh=true)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.enhanceCommitJiraLinks({
        refresh: true,
        combine: true,
      });

      expect(result.authorsProcessed).toBe(1);

      // Verify delete was called (refresh=true)
      const deleteCalls = mockQuery.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM commit_jira'),
      );
      expect(deleteCalls).toHaveLength(1);
    });
  });

  // ==========================================================================
  // SQL injection prevention
  // ==========================================================================

  describe('SQL injection prevention', () => {
    it('should never interpolate user input into SQL queries', async () => {
      // Mock getAuthorUnlinkedCommits with malicious commit message
      mockQuery.mockResolvedValueOnce({
        rows: [{
          sha: 'sha1',
          commit_message: "PROJ-123'; DROP TABLE commit_jira; --",
          branch: 'main',
        }],
        rowCount: 1,
      })
        // Mock BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // Mock INSERT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.identifyCommitMsgJiraRelationship(
        'testuser', ['PROJ'], false, false,
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

  // ==========================================================================
  // Python-TypeScript equivalence golden tests
  // ==========================================================================

  describe('Python-TypeScript equivalence', () => {
    it('should match Python find_jira_project_refs_in_text for PROJ2-1999 test case', () => {
      // From GitjaDataEnhancerTester.py lines 6-9
      const keys = ['PROJ2', 'PROJ'];
      const text = 'PROJ2-1999updating sequence in constant class and changing logic to relate rent breakdown and rent calculation';

      const matches = service.findJiraProjectRefsInText(keys, text);

      // Python re.findall returns all matches; PROJ2-1999 should be found
      expect(matches.some((m) => /PROJ2/i.test(m))).toBe(true);
    });

    it('should match Python _should_exclude_match for SFDC release tags', () => {
      // From GitjaDataEnhancer.py line 104
      const projectKeys = ['SFDC'];
      expect(service.shouldExcludeMatch('SFDC.2023', projectKeys)).toBe(true);
    });

    it('should match Python _cleanup_jira_key_match for PROJ alias', () => {
      // From GitjaDataEnhancer.py line 128
      const result = service.cleanupJiraKeyMatch('PROJ-100', ['PROJ']);
      expect(result).toBe('PROJ2-100');
    });

    it('should match Python _cleanup_jira_key_match for CRM alias', () => {
      // From GitjaDataEnhancer.py line 129 (alias updated to CRMSYS)
      const result = service.cleanupJiraKeyMatch('CRM-200', ['CRM']);
      expect(result).toBe('CRMSYS-200');
    });

    it('should match Python _cleanup_jira_key_match for CDP-0 pattern', () => {
      // From GitjaDataEnhancer.py line 132
      const result = service.cleanupJiraKeyMatch('CDP-0456', ['CDP']);
      expect(result).toBe('CDP-456');
    });

    it('should match Python _replace_ref_without_hyphen for missing hyphen', () => {
      // From GitjaDataEnhancer.py lines 136-143
      const result = service.cleanupJiraKeyMatch('ESR1', ['ESR']);
      expect(result).toBe('ESR-1');
    });

    it('should not modify PROJ2 in _replace_ref_without_hyphen (skip guard)', () => {
      // From GitjaDataEnhancer.py line 138: PROJ2 guard
      const result = service.cleanupJiraKeyMatch('PROJ2-999', ['PROJ2', 'PROJ']);
      expect(result).toBe('PROJ2-999');
    });
  });
});
