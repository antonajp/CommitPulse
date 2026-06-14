import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  DatabaseService,
  type DatabaseServiceConfig,
} from '../../database/database-service.js';
import {
  ContributorRepository,
  type CommitContributorRow,
} from '../../database/contributor-repository.js';
import { CommitRepository, type CommitHistoryRow } from '../../database/commit-repository.js';

/**
 * Integration tests for GITX-169: Contributor grouping by full_name.
 *
 * Tests that contributors with multiple logins are properly grouped by full_name
 * and that commits are aggregated across all associated logins.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema from migration files,
 * then exercises the grouping logic with real database queries.
 *
 * Ticket: GITX-169
 */

const PG_DATABASE = 'gitrx_contributor_grouping_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let contributorRepo: ContributorRepository;
let commitRepo: CommitRepository;

/**
 * Helper: Create schema from migration files.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');
  const tableSql = readFileSync(join(migrationsDir, '001_create_tables.sql'), 'utf-8');
  await dbService.query(tableSql);

  // GITX-169: Also create views (needed for max_num_count_per_full_name)
  const viewsSql = readFileSync(join(migrationsDir, '002_create_views.sql'), 'utf-8');
  await dbService.query(viewsSql);
}

/**
 * Helper: Create a sample contributor for testing.
 */
function createTestContributor(overrides?: Partial<CommitContributorRow>): CommitContributorRow {
  return {
    login: 'testuser',
    username: 'Test User',
    email: 'test@example.com',
    bio: 'A test user',
    userLocation: 'Test City',
    publicRepos: '10',
    followers: '5',
    followingUsers: '3',
    vendor: 'Company',
    repo: 'test-repo',
    team: 'Engineering',
    fullName: 'Test User',
    jiraName: 'test.user',
    isCompanyAccount: false,
    ...overrides,
  };
}

/**
 * Helper: Create a sample commit for testing.
 */
function createTestCommit(overrides?: Partial<CommitHistoryRow>): CommitHistoryRow {
  return {
    sha: 'a'.repeat(40),
    url: 'https://github.com/org/repo/commit/' + 'a'.repeat(40),
    branch: 'main',
    repository: 'test-repo',
    repositoryUrl: 'https://github.com/org/test-repo.git',
    author: 'testuser',
    commitDate: new Date('2024-01-15T10:30:00Z'),
    commitMessage: 'feat: add feature',
    fileCount: 2,
    linesAdded: 50,
    linesRemoved: 10,
    isMerge: false,
    isJiraRef: false,
    organization: 'TestOrg',
    ...overrides,
  };
}

describe('Contributor Grouping Integration Tests (GITX-169)', () => {
  beforeAll(async () => {
    // Reset logger for clean test state
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Start PostgreSQL 16 container
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

    config = {
      host,
      port: mappedPort,
      database: PG_DATABASE,
      user: PG_USER,
      password: PG_PASSWORD,
      maxPoolSize: 3,
      connectionTimeoutMs: 10_000,
      idleTimeoutMs: 5_000,
    };

    // Initialize service and create schema
    service = new DatabaseService();
    await service.initialize(config);
    await createSchema(service);

    // Create repository instances
    contributorRepo = new ContributorRepository(service);
    commitRepo = new CommitRepository(service);
  }, 120_000);

  afterAll(async () => {
    if (service?.isInitialized()) {
      await service.shutdown();
    }
    if (container) {
      await container.stop();
    }
  }, 30_000);

  beforeEach(async () => {
    // Reset logger for each test
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    // Clean up test data
    await service.query('DELETE FROM commit_jira');
    await service.query('DELETE FROM commit_msg_words');
    await service.query('DELETE FROM commit_tags');
    await service.query('DELETE FROM commit_branch_relationship');
    await service.query('DELETE FROM commit_directory');
    await service.query('DELETE FROM commit_files_types');
    await service.query('DELETE FROM commit_files');
    await service.query('DELETE FROM commit_history');
    await service.query('DELETE FROM gitja_team_contributor');
    await service.query('DELETE FROM commit_contributors');
  });

  // --------------------------------------------------------------------------
  // Test: Multiple logins with same full_name are grouped
  // --------------------------------------------------------------------------

  it('should aggregate commits across multiple logins for same person', async () => {
    // Insert 2 contributor records with same full_name but different logins
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'alice',
        fullName: 'Alice Smith',
        team: 'Engineering',
        vendor: 'Company',
        repo: 'repo-a',
      }),
    );
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'alice.smith',
        fullName: 'Alice Smith',
        team: 'Engineering',
        vendor: 'Company',
        repo: 'repo-b',
      }),
    );

    // Insert commits from both logins
    await commitRepo.insertCommitHistory(
      createTestCommit({
        sha: 'a'.repeat(40),
        author: 'alice',
        repository: 'repo-a',
      }),
    );
    await commitRepo.insertCommitHistory(
      createTestCommit({
        sha: 'b'.repeat(40),
        author: 'alice.smith',
        repository: 'repo-b',
      }),
    );

    // Query contributor summaries
    const summaries = await contributorRepo.getContributorSummaries();

    // Should be grouped into 1 contributor with 2 commits
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.fullName).toBe('Alice Smith');
    expect(summaries[0]?.logins).toContain('alice');
    expect(summaries[0]?.logins).toContain('alice.smith');
    expect(summaries[0]?.commitCount).toBe(2);
    expect(summaries[0]?.team).toBe('Engineering');
    expect(summaries[0]?.vendor).toBe('Company');
  });

  // --------------------------------------------------------------------------
  // Test: NULL full_name handled correctly
  // --------------------------------------------------------------------------

  it('should handle NULL full_name with login as fallback', async () => {
    // Insert contributor with NULL full_name
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'bot-user',
        fullName: null,
        team: null,
        vendor: null,
        repo: 'repo-a',
      }),
    );

    // Insert commit from bot
    await commitRepo.insertCommitHistory(
      createTestCommit({
        sha: 'c'.repeat(40),
        author: 'bot-user',
        repository: 'repo-a',
      }),
    );

    // Query contributor summaries
    const summaries = await contributorRepo.getContributorSummaries();

    expect(summaries).toHaveLength(1);
    // COALESCE(cc.full_name, STRING_AGG(DISTINCT cc.login, ',')) returns the login when full_name is NULL
    expect(summaries[0]?.fullName).toBe('bot-user');
    expect(summaries[0]?.logins).toBe('bot-user');
    expect(summaries[0]?.commitCount).toBe(1);
    expect(summaries[0]?.team).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test: Same full_name different teams (show separately)
  // --------------------------------------------------------------------------

  it('should show same full_name with different teams separately', async () => {
    // Insert contributor with same full_name but different teams
    // (This tests the GROUP BY full_name, team clause)
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'charlie',
        fullName: 'Charlie Brown',
        team: 'Engineering',
        vendor: 'Company',
        repo: 'repo-a',
      }),
    );

    // Insert team assignment for Engineering
    await service.query(
      `INSERT INTO gitja_team_contributor (login, full_name, team, num_count)
       VALUES ($1, $2, $3, $4)`,
      ['charlie', 'Charlie Brown', 'Engineering', 100],
    );

    // Insert team assignment for Data (lower count)
    await service.query(
      `INSERT INTO gitja_team_contributor (login, full_name, team, num_count)
       VALUES ($1, $2, $3, $4)`,
      ['charlie', 'Charlie Brown', 'Data', 50],
    );

    // Insert commits
    await commitRepo.insertCommitHistory(
      createTestCommit({
        sha: 'd'.repeat(40),
        author: 'charlie',
        repository: 'repo-a',
      }),
    );

    // Query contributor summaries
    const summaries = await contributorRepo.getContributorSummaries();

    // Should show one entry (primary team is Engineering based on max_num_count_per_full_name)
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.fullName).toBe('Charlie Brown');
    expect(summaries[0]?.team).toBe('Engineering'); // Primary team from max_num_count_per_full_name
    expect(summaries[0]?.commitCount).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Test: Multiple contributors with different full_names
  // --------------------------------------------------------------------------

  it('should keep contributors with different full_names separate', async () => {
    // Insert 3 different contributors
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'alice',
        fullName: 'Alice Smith',
        team: 'Engineering',
      }),
    );
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'bob',
        fullName: 'Bob Jones',
        team: 'Data',
      }),
    );
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'charlie',
        fullName: 'Charlie Brown',
        team: 'Engineering',
      }),
    );

    // Insert commits for each
    await commitRepo.insertCommitHistory(
      createTestCommit({
        sha: 'e'.repeat(40),
        author: 'alice',
      }),
    );
    await commitRepo.insertCommitHistory(
      createTestCommit({
        sha: 'f'.repeat(40),
        author: 'bob',
      }),
    );
    await commitRepo.insertCommitHistory(
      createTestCommit({
        sha: 'g'.repeat(40),
        author: 'charlie',
      }),
    );

    // Query contributor summaries
    const summaries = await contributorRepo.getContributorSummaries();

    expect(summaries).toHaveLength(3);
    expect(summaries.map((s) => s.fullName).sort()).toEqual([
      'Alice Smith',
      'Bob Jones',
      'Charlie Brown',
    ]);
  });

  // --------------------------------------------------------------------------
  // Test: Repo list aggregation
  // --------------------------------------------------------------------------

  it('should aggregate repo list across multiple logins', async () => {
    // Insert 2 contributor records with same full_name, different repos
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'alice',
        fullName: 'Alice Smith',
        repo: 'repo-a',
      }),
    );
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'alice.smith',
        fullName: 'Alice Smith',
        repo: 'repo-b',
      }),
    );

    // Insert commits
    await commitRepo.insertCommitHistory(
      createTestCommit({
        sha: 'h'.repeat(40),
        author: 'alice',
        repository: 'repo-a',
      }),
    );

    // Query contributor summaries
    const summaries = await contributorRepo.getContributorSummaries();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.repoList).toContain('repo-a');
    expect(summaries[0]?.repoList).toContain('repo-b');
  });

  // --------------------------------------------------------------------------
  // Test: Zero commits contributor
  // --------------------------------------------------------------------------

  it('should handle contributor with no commits', async () => {
    // Insert contributor but no commits
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'newbie',
        fullName: 'New Person',
        team: 'Engineering',
      }),
    );

    // Query contributor summaries
    const summaries = await contributorRepo.getContributorSummaries();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.fullName).toBe('New Person');
    expect(summaries[0]?.commitCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Test: Ordering by team then full_name
  // --------------------------------------------------------------------------

  it('should order results by team NULLS LAST, then full_name', async () => {
    // Insert contributors in various teams
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'zebra',
        fullName: 'Zebra User',
        team: 'Engineering',
      }),
    );
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'alice',
        fullName: 'Alice Smith',
        team: 'Data',
      }),
    );
    await contributorRepo.insertCommitContributor(
      createTestContributor({
        login: 'bot',
        fullName: null,
        team: null,
      }),
    );

    // Query contributor summaries
    const summaries = await contributorRepo.getContributorSummaries();

    expect(summaries).toHaveLength(3);
    // Should be ordered: Data (Alice), Engineering (Zebra), NULL (bot)
    expect(summaries[0]?.team).toBe('Data');
    expect(summaries[1]?.team).toBe('Engineering');
    expect(summaries[2]?.team).toBeNull();
  });
});
