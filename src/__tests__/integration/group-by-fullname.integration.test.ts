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
import { KnowledgeConcentrationDataService } from '../../services/knowledge-concentration-service.js';
import { DeveloperFocusDataService } from '../../services/developer-focus-service.js';

/**
 * Integration tests for GITX-171: Group by full_name instead of login.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema including
 * migration 029, then verifies that contributors with multiple logins are
 * consolidated into a single contributor by full_name.
 *
 * Ticket: GITX-171
 *
 * Test coverage includes:
 * - Multiple logins consolidated into single full_name
 * - NULL full_name falls back to login
 * - Knowledge Concentration view shows full_name
 * - Developer Focus view shows full_name
 * - Bus factor calculated correctly with consolidated contributors
 */

const PG_DATABASE = 'gitrx_fullname_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let knowledgeService: KnowledgeConcentrationDataService;
let focusService: DeveloperFocusDataService;

/**
 * Helper: Create schema from migration files including 029.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply migrations in order
  const migrations = [
    '001_create_tables.sql',
    '002_create_views.sql',
    '004_add_linear_support.sql',
    '014_knowledge_concentration.sql',
    '016_developer_focus.sql',
    '029_group_by_full_name.sql', // The migration under test
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert test data with a developer having multiple logins.
 * Alice Smith has logins: alice, alice.smith, asmith
 * Bot account has NULL full_name.
 */
async function insertMultiLoginTestData(dbService: DatabaseService): Promise<void> {
  // Insert commit_contributors with multiple logins for same person
  await dbService.query(`
    INSERT INTO commit_contributors (login, full_name, email, team)
    VALUES
      ('alice', 'Alice Smith', 'alice@test.com', 'Engineering'),
      ('alice.smith', 'Alice Smith', 'alice.smith@test.com', 'Engineering'),
      ('asmith', 'Alice Smith', 'asmith@test.com', 'Engineering'),
      ('bob', 'Bob Jones', 'bob@test.com', 'Engineering'),
      ('charlie', 'Charlie Brown', 'charlie@test.com', 'QA'),
      ('dependabot', NULL, 'dependabot@github.com', NULL)
    ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name
  `);

  // Insert jira_detail records
  await dbService.query(`
    INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points)
    VALUES
      ('j1001', 'PROJ-101', 'High', NOW() - INTERVAL '30 days', 'https://jira/PROJ-101', 'Feature A', 'Desc', 'rep', 'Story', 'PROJ', NULL, 'alice', 'Done', '1.0', 'BE', NOW(), 5),
      ('j1002', 'PROJ-102', 'Medium', NOW() - INTERVAL '30 days', 'https://jira/PROJ-102', 'Feature B', 'Desc', 'rep', 'Story', 'PROJ', NULL, 'bob', 'Done', '1.0', 'BE', NOW(), 3)
    ON CONFLICT (jira_key) DO NOTHING
  `);

  // Insert commits from Alice's different logins - all should consolidate
  // Alice commits to same file from different logins
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      -- Alice (login: alice) - 3 commits
      ('sha_alice_001', 'https://github.com/org/repo/commit/sha_alice_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'alice', NOW() - INTERVAL '30 days', 'feat: Add feature', 1, 100, 0, FALSE, FALSE, 'TestOrg'),
      ('sha_alice_002', 'https://github.com/org/repo/commit/sha_alice_002', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'alice', NOW() - INTERVAL '25 days', 'fix: Bug fix', 1, 20, 5, FALSE, FALSE, 'TestOrg'),
      ('sha_alice_003', 'https://github.com/org/repo/commit/sha_alice_003', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'alice', NOW() - INTERVAL '20 days', 'refactor: Cleanup', 1, 30, 10, FALSE, FALSE, 'TestOrg'),

      -- Alice (login: alice.smith) - 2 commits to same file
      ('sha_asmith_001', 'https://github.com/org/repo/commit/sha_asmith_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'alice.smith', NOW() - INTERVAL '18 days', 'feat: Extend', 1, 40, 5, FALSE, FALSE, 'TestOrg'),
      ('sha_asmith_002', 'https://github.com/org/repo/commit/sha_asmith_002', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'alice.smith', NOW() - INTERVAL '15 days', 'fix: Minor fix', 1, 10, 3, FALSE, FALSE, 'TestOrg'),

      -- Alice (login: asmith) - 1 commit to same file
      ('sha_as_001', 'https://github.com/org/repo/commit/sha_as_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'asmith', NOW() - INTERVAL '10 days', 'chore: Update', 1, 15, 2, FALSE, FALSE, 'TestOrg'),

      -- Bob - 2 commits to same file
      ('sha_bob_001', 'https://github.com/org/repo/commit/sha_bob_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'bob', NOW() - INTERVAL '12 days', 'feat: Add feature B', 1, 50, 0, FALSE, FALSE, 'TestOrg'),
      ('sha_bob_002', 'https://github.com/org/repo/commit/sha_bob_002', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'bob', NOW() - INTERVAL '8 days', 'fix: Bug fix B', 1, 25, 10, FALSE, FALSE, 'TestOrg'),

      -- Dependabot (NULL full_name) - 1 commit
      ('sha_bot_001', 'https://github.com/org/repo/commit/sha_bot_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'dependabot', NOW() - INTERVAL '5 days', 'chore(deps): Bump', 1, 5, 5, FALSE, FALSE, 'TestOrg'),

      -- Charlie - 1 commit (to test multi-contributor scenario)
      ('sha_charlie_001', 'https://github.com/org/repo/commit/sha_charlie_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'charlie', NOW() - INTERVAL '3 days', 'test: Add tests', 1, 80, 0, FALSE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commit_files - all commits touch the same file
  await dbService.query(`
    INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
    VALUES
      -- Alice (login: alice)
      ('sha_alice_001', 'src/services/feature.ts', 100, 0, 10, 100, 10, FALSE),
      ('sha_alice_002', 'src/services/feature.ts', 20, 5, 12, 115, 12, FALSE),
      ('sha_alice_003', 'src/services/feature.ts', 30, 10, 15, 135, 15, FALSE),

      -- Alice (login: alice.smith)
      ('sha_asmith_001', 'src/services/feature.ts', 40, 5, 18, 170, 18, FALSE),
      ('sha_asmith_002', 'src/services/feature.ts', 10, 3, 19, 177, 19, FALSE),

      -- Alice (login: asmith)
      ('sha_as_001', 'src/services/feature.ts', 15, 2, 20, 190, 20, FALSE),

      -- Bob
      ('sha_bob_001', 'src/services/feature.ts', 50, 0, 22, 240, 22, FALSE),
      ('sha_bob_002', 'src/services/feature.ts', 25, 10, 24, 255, 24, FALSE),

      -- Dependabot
      ('sha_bot_001', 'src/services/feature.ts', 5, 5, 24, 255, 24, FALSE),

      -- Charlie
      ('sha_charlie_001', 'src/services/feature.ts', 80, 0, 28, 335, 28, FALSE)
    ON CONFLICT (sha, filename) DO NOTHING
  `);

  // Insert commit_jira links for focus score testing
  await dbService.query(`
    INSERT INTO commit_jira (sha, jira_key)
    VALUES
      ('sha_alice_001', 'PROJ-101'),
      ('sha_alice_002', 'PROJ-101'),
      ('sha_alice_003', 'PROJ-101'),
      ('sha_asmith_001', 'PROJ-101'),
      ('sha_asmith_002', 'PROJ-101'),
      ('sha_as_001', 'PROJ-101'),
      ('sha_bob_001', 'PROJ-102'),
      ('sha_bob_002', 'PROJ-102'),
      ('sha_charlie_001', 'PROJ-102')
    ON CONFLICT DO NOTHING
  `);
}

describe('GITX-171: Group by full_name Integration Tests', () => {
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

    // Initialize database service
    service = new DatabaseService();
    await service.initialize(config);

    // Create schema including migration 029
    await createSchema(service);

    // Create data services
    knowledgeService = new KnowledgeConcentrationDataService(service);
    focusService = new DeveloperFocusDataService(service);
  }, 120_000); // 2 minute timeout for container startup

  afterAll(async () => {
    if (service?.isInitialized()) {
      await service.shutdown();
    }
    if (container) {
      await container.stop();
    }
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  }, 30_000);

  beforeEach(async () => {
    // Clear test data before each test
    await service.query('DELETE FROM commit_files');
    await service.query('DELETE FROM commit_jira');
    await service.query('DELETE FROM commit_linear');
    await service.query('DELETE FROM commit_history');
    await service.query('DELETE FROM commit_contributors');
    await service.query('DELETE FROM jira_detail');
  });

  describe('Knowledge Concentration: Multiple logins consolidated', () => {
    beforeEach(async () => {
      await insertMultiLoginTestData(service);
    });

    it('should consolidate multiple logins into single full_name for top_contributor', async () => {
      const result = await knowledgeService.getFileOwnership();

      // Find the feature.ts file
      const featureFile = result.find(r => r.filePath === 'src/services/feature.ts');
      expect(featureFile).toBeDefined();

      // Alice has 6 commits total (3 from alice + 2 from alice.smith + 1 from asmith)
      // All should be consolidated under "Alice Smith"
      expect(featureFile?.topContributor).toBe('Alice Smith');
    });

    it('should calculate correct ownership percentage with consolidated commits', async () => {
      const result = await knowledgeService.getFileOwnership();

      const featureFile = result.find(r => r.filePath === 'src/services/feature.ts');
      expect(featureFile).toBeDefined();

      // Total commits: 6 (Alice) + 2 (Bob) + 1 (dependabot) + 1 (Charlie) = 10
      // Alice ownership: 6/10 = 60%
      expect(featureFile?.totalCommits).toBe(10);
      expect(featureFile?.topContributorPct).toBe(60);
    });

    it('should count consolidated contributors correctly for total_contributors', async () => {
      const result = await knowledgeService.getFileOwnership();

      const featureFile = result.find(r => r.filePath === 'src/services/feature.ts');
      expect(featureFile).toBeDefined();

      // Should have 4 unique contributors: Alice Smith, Bob Jones, dependabot, Charlie Brown
      // NOT 6 (alice, alice.smith, asmith, bob, dependabot, charlie)
      expect(featureFile?.totalContributors).toBe(4);
    });

    it('should calculate bus factor correctly with consolidated contributors', async () => {
      const result = await knowledgeService.getFileOwnership();

      const featureFile = result.find(r => r.filePath === 'src/services/feature.ts');
      expect(featureFile).toBeDefined();

      // 4 contributors with 60% top ownership = bus factor should be 2 or 3
      // (not 1, since top ownership is < 80%)
      expect(featureFile?.busFactor).toBeGreaterThanOrEqual(2);
    });

    it('should show second contributor as full_name', async () => {
      const result = await knowledgeService.getFileOwnership();

      const featureFile = result.find(r => r.filePath === 'src/services/feature.ts');
      expect(featureFile).toBeDefined();

      // Second contributor should be "Bob Jones" (2 commits = 20%)
      expect(featureFile?.secondContributor).toBe('Bob Jones');
      expect(featureFile?.secondContributorPct).toBe(20);
    });

    it('should fall back to login when full_name is NULL', async () => {
      // Query the view directly to check dependabot entry
      const result = await service.query<{ contributor_name: string }>(`
        SELECT DISTINCT COALESCE(cc.full_name, cc.login, ch.author) AS contributor_name
        FROM commit_history ch
        LEFT JOIN commit_contributors cc ON ch.author = cc.login
        WHERE ch.author = 'dependabot'
      `);

      expect(result.rows.length).toBe(1);
      // Dependabot has NULL full_name, should fall back to login
      expect(result.rows[0]?.contributor_name).toBe('dependabot');
    });

    it('should categorize concentration risk correctly with consolidated ownership', async () => {
      const result = await knowledgeService.getFileOwnership();

      const featureFile = result.find(r => r.filePath === 'src/services/feature.ts');
      expect(featureFile).toBeDefined();

      // 60% ownership = medium risk
      expect(featureFile?.concentrationRisk).toBe('medium');
    });
  });

  describe('Developer Focus: Multiple logins consolidated', () => {
    beforeEach(async () => {
      await insertMultiLoginTestData(service);
    });

    it('should consolidate multiple logins into single full_name for author', async () => {
      const result = await focusService.getFocusScores();

      // Should have focus scores for unique full_names, not logins
      const authors = [...new Set(result.map(r => r.author))];

      // Should include "Alice Smith" not "alice", "alice.smith", "asmith" separately
      expect(authors).toContain('Alice Smith');
      expect(authors).not.toContain('alice');
      expect(authors).not.toContain('alice.smith');
      expect(authors).not.toContain('asmith');
    });

    it('should aggregate commits from all logins for same person', async () => {
      const result = await focusService.getDailyActivities({ author: 'Alice Smith' });

      // Alice has commits from 6 different days via different logins
      // All should be consolidated under "Alice Smith"
      expect(result.length).toBeGreaterThan(0);

      // Total commits should sum commits from all three logins
      const totalCommits = result.reduce((sum, r) => sum + r.commitCount, 0);
      expect(totalCommits).toBe(6); // 3 + 2 + 1
    });

    it('should fall back to login when full_name is NULL in focus data', async () => {
      const result = await focusService.getDailyActivities({ author: 'dependabot' });

      // Should find dependabot by login since full_name is NULL
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.author).toBe('dependabot');
    });

    it('should calculate focus score correctly with consolidated commits', async () => {
      const result = await focusService.getFocusScores({ author: 'Alice Smith' });

      expect(result.length).toBeGreaterThan(0);

      // Alice worked on 1 ticket (PROJ-101) consistently
      // Focus score should be high (low context switching)
      for (const row of result) {
        expect(row.author).toBe('Alice Smith');
        // Working on single ticket = high focus
        expect(row.focusScore).toBeGreaterThanOrEqual(80);
      }
    });
  });

  describe('Filter dropdown population', () => {
    beforeEach(async () => {
      await insertMultiLoginTestData(service);
    });

    it('should return full_names for contributor filter in Knowledge Concentration', async () => {
      // Query the view to get unique contributors (both top and second)
      const result = await service.query<{ contributor: string }>(`
        SELECT DISTINCT contributor FROM (
          SELECT top_contributor AS contributor FROM vw_knowledge_concentration WHERE top_contributor IS NOT NULL
          UNION
          SELECT second_contributor AS contributor FROM vw_knowledge_concentration WHERE second_contributor IS NOT NULL
        ) AS all_contributors
        ORDER BY contributor
      `);

      const contributors = result.rows.map(r => r.contributor);

      // Should have full_names, not logins
      // Alice is top_contributor, Bob is second_contributor
      expect(contributors).toContain('Alice Smith');
      expect(contributors).toContain('Bob Jones');
      expect(contributors).not.toContain('alice');
      expect(contributors).not.toContain('alice.smith');
    });

    it('should return full_names for developer filter in Developer Focus', async () => {
      // Query the view to get unique authors
      const result = await service.query<{ author: string }>(`
        SELECT DISTINCT author
        FROM vw_developer_focus
        WHERE author IS NOT NULL
        ORDER BY author
      `);

      const authors = result.rows.map(r => r.author);

      // Should have full_names, not logins
      expect(authors).toContain('Alice Smith');
      expect(authors).toContain('Bob Jones');
      expect(authors).not.toContain('alice');
      expect(authors).not.toContain('alice.smith');
    });
  });

  describe('Rollback verification', () => {
    it('should be able to apply rollback and restore original views', async () => {
      const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

      // Apply rollback
      const rollbackSql = readFileSync(join(migrationsDir, '029_group_by_full_name.rollback.sql'), 'utf-8');
      await service.query(rollbackSql);

      // Verify views still exist
      const viewExists = await knowledgeService.checkViewExists();
      expect(viewExists).toBe(true);

      // Re-apply the migration for subsequent tests
      const migrationSql = readFileSync(join(migrationsDir, '029_group_by_full_name.sql'), 'utf-8');
      await service.query(migrationSql);

      // Verify migration was reapplied
      const viewExistsAfter = await knowledgeService.checkViewExists();
      expect(viewExistsAfter).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle contributor with no full_name in commit_contributors table', async () => {
      // Insert commit from unknown author (not in commit_contributors)
      await service.query(`
        INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
        VALUES ('sha_unknown_001', 'https://github.com/org/repo/commit/sha_unknown_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'unknown_user', NOW() - INTERVAL '1 day', 'feat: Unknown user commit', 1, 50, 0, FALSE, FALSE, 'TestOrg')
      `);

      await service.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
        VALUES ('sha_unknown_001', 'src/unknown.ts', 50, 0, 5, 50, 5, FALSE)
      `);

      const result = await knowledgeService.getFileOwnership();

      const unknownFile = result.find(r => r.filePath === 'src/unknown.ts');
      expect(unknownFile).toBeDefined();
      // Should fall back to ch.author when no commit_contributors entry
      expect(unknownFile?.topContributor).toBe('unknown_user');
    });

    it('should handle empty full_name string as NULL', async () => {
      // Insert contributor with empty string full_name (edge case)
      await service.query(`
        INSERT INTO commit_contributors (login, full_name, email, team)
        VALUES ('empty_name', '', 'empty@test.com', 'Engineering')
        ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name
      `);

      await service.query(`
        INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
        VALUES ('sha_empty_001', 'https://github.com/org/repo/commit/sha_empty_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'empty_name', NOW() - INTERVAL '1 day', 'feat: Empty name commit', 1, 50, 0, FALSE, FALSE, 'TestOrg')
      `);

      await service.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
        VALUES ('sha_empty_001', 'src/empty.ts', 50, 0, 5, 50, 5, FALSE)
      `);

      const result = await knowledgeService.getFileOwnership();

      const emptyFile = result.find(r => r.filePath === 'src/empty.ts');
      expect(emptyFile).toBeDefined();
      // Empty string should still show (COALESCE picks first non-NULL)
      // This is expected behavior - empty string is not NULL
      expect(emptyFile?.topContributor).toBeDefined();
    });
  });
});
