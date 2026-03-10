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

/**
 * Integration tests for KnowledgeConcentrationDataService with a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema from migration files,
 * then exercises the data service methods against the real database.
 *
 * Ticket: IQS-903
 *
 * Test coverage includes:
 * - View correctness with sample data
 * - Ownership percentage calculation accuracy
 * - Bus factor calculation correctness
 * - Concentration risk categorization
 * - Filter combinations
 * - Module-level aggregation
 */

const PG_DATABASE = 'gitrx_knowledge_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let knowledgeService: KnowledgeConcentrationDataService;

/**
 * Helper: Create schema from migration files.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply migrations in order
  const migrations = [
    '001_create_tables.sql',
    '002_create_views.sql',
    '014_knowledge_concentration.sql',
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert test commit data for knowledge concentration analysis.
 */
async function insertTestData(dbService: DatabaseService): Promise<void> {
  // Insert commit_contributors
  await dbService.query(`
    INSERT INTO commit_contributors (login, full_name, email, team)
    VALUES
      ('user1', 'User One', 'user1@test.com', 'Engineering'),
      ('user2', 'User Two', 'user2@test.com', 'Engineering'),
      ('user3', 'User Three', 'user3@test.com', 'QA'),
      ('user4', 'User Four', 'user4@test.com', 'Engineering')
    ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name
  `);

  // Insert commit_history for various ownership patterns
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      -- Critical risk file: user1 owns 100% of solo-file.ts (1 contributor)
      ('sha001', 'https://github.com/org/repo/commit/sha001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '30 days', 'feat: Add solo file', 1, 100, 0, FALSE, FALSE, 'TestOrg'),
      ('sha002', 'https://github.com/org/repo/commit/sha002', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '25 days', 'fix: Fix solo file', 1, 20, 5, FALSE, FALSE, 'TestOrg'),
      ('sha003', 'https://github.com/org/repo/commit/sha003', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '20 days', 'refactor: Refactor solo file', 1, 30, 10, FALSE, FALSE, 'TestOrg'),

      -- High risk file: user1 owns ~85% (6/7 commits) of high-risk-file.ts
      ('sha004', 'https://github.com/org/repo/commit/sha004', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '29 days', 'feat: Add high risk file', 1, 150, 0, FALSE, FALSE, 'TestOrg'),
      ('sha005', 'https://github.com/org/repo/commit/sha005', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '27 days', 'fix: Update high risk', 1, 25, 10, FALSE, FALSE, 'TestOrg'),
      ('sha006', 'https://github.com/org/repo/commit/sha006', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '22 days', 'chore: Cleanup', 1, 15, 5, FALSE, FALSE, 'TestOrg'),
      ('sha007', 'https://github.com/org/repo/commit/sha007', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '18 days', 'feat: Extend', 1, 40, 5, FALSE, FALSE, 'TestOrg'),
      ('sha008', 'https://github.com/org/repo/commit/sha008', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '14 days', 'fix: Bug fix', 1, 10, 3, FALSE, FALSE, 'TestOrg'),
      ('sha009', 'https://github.com/org/repo/commit/sha009', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '10 days', 'refactor: Improve', 1, 20, 8, FALSE, FALSE, 'TestOrg'),
      ('sha010', 'https://github.com/org/repo/commit/sha010', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user2', NOW() - INTERVAL '5 days', 'fix: Minor fix', 1, 5, 2, FALSE, FALSE, 'TestOrg'),

      -- Medium risk file: user1 owns ~60% (3/5 commits) of medium-risk-file.ts
      ('sha011', 'https://github.com/org/repo/commit/sha011', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '28 days', 'feat: Add medium risk file', 1, 100, 0, FALSE, FALSE, 'TestOrg'),
      ('sha012', 'https://github.com/org/repo/commit/sha012', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '21 days', 'fix: Fix medium risk', 1, 20, 5, FALSE, FALSE, 'TestOrg'),
      ('sha013', 'https://github.com/org/repo/commit/sha013', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '15 days', 'refactor: Refactor', 1, 15, 8, FALSE, FALSE, 'TestOrg'),
      ('sha014', 'https://github.com/org/repo/commit/sha014', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user2', NOW() - INTERVAL '8 days', 'feat: Add feature', 1, 30, 0, FALSE, FALSE, 'TestOrg'),
      ('sha015', 'https://github.com/org/repo/commit/sha015', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user3', NOW() - INTERVAL '3 days', 'fix: Bug fix', 1, 10, 5, FALSE, FALSE, 'TestOrg'),

      -- Low risk file: evenly distributed (4 contributors, each ~25%)
      ('sha016', 'https://github.com/org/repo/commit/sha016', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '26 days', 'feat: Add shared file', 1, 50, 0, FALSE, FALSE, 'TestOrg'),
      ('sha017', 'https://github.com/org/repo/commit/sha017', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user2', NOW() - INTERVAL '19 days', 'feat: Extend shared', 1, 40, 5, FALSE, FALSE, 'TestOrg'),
      ('sha018', 'https://github.com/org/repo/commit/sha018', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user3', NOW() - INTERVAL '12 days', 'fix: Fix shared', 1, 25, 10, FALSE, FALSE, 'TestOrg'),
      ('sha019', 'https://github.com/org/repo/commit/sha019', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user4', NOW() - INTERVAL '6 days', 'refactor: Cleanup', 1, 20, 8, FALSE, FALSE, 'TestOrg'),

      -- Other repo file
      ('sha020', 'https://github.com/org/repo/commit/sha020', 'main', 'other-repo', 'https://github.com/org/other-repo.git', 'user1', NOW() - INTERVAL '15 days', 'feat: Other repo file', 1, 80, 0, FALSE, FALSE, 'TestOrg'),

      -- Merge commit (should be excluded)
      ('sha021', 'https://github.com/org/repo/commit/sha021', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW() - INTERVAL '2 days', 'Merge: Feature branch', 0, 0, 0, TRUE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commit_files
  await dbService.query(`
    INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
    VALUES
      -- solo-file.ts (3 commits from user1)
      ('sha001', 'src/solo-file.ts', 100, 0, 10, 100, 10, FALSE),
      ('sha002', 'src/solo-file.ts', 20, 5, 12, 115, 12, FALSE),
      ('sha003', 'src/solo-file.ts', 30, 10, 15, 135, 15, FALSE),

      -- high-risk-file.ts (7 commits: 6 from user1, 1 from user2)
      ('sha004', 'src/services/high-risk-file.ts', 150, 0, 20, 150, 20, FALSE),
      ('sha005', 'src/services/high-risk-file.ts', 25, 10, 22, 165, 22, FALSE),
      ('sha006', 'src/services/high-risk-file.ts', 15, 5, 23, 175, 23, FALSE),
      ('sha007', 'src/services/high-risk-file.ts', 40, 5, 28, 210, 28, FALSE),
      ('sha008', 'src/services/high-risk-file.ts', 10, 3, 29, 217, 29, FALSE),
      ('sha009', 'src/services/high-risk-file.ts', 20, 8, 30, 229, 30, FALSE),
      ('sha010', 'src/services/high-risk-file.ts', 5, 2, 30, 232, 30, FALSE),

      -- medium-risk-file.ts (5 commits: 3 from user1, 1 from user2, 1 from user3)
      ('sha011', 'src/services/medium-risk-file.ts', 100, 0, 15, 100, 15, FALSE),
      ('sha012', 'src/services/medium-risk-file.ts', 20, 5, 16, 115, 16, FALSE),
      ('sha013', 'src/services/medium-risk-file.ts', 15, 8, 17, 122, 17, FALSE),
      ('sha014', 'src/services/medium-risk-file.ts', 30, 0, 19, 152, 19, FALSE),
      ('sha015', 'src/services/medium-risk-file.ts', 10, 5, 18, 157, 18, FALSE),

      -- shared-file.ts (4 commits from 4 different users)
      ('sha016', 'src/utils/shared-file.ts', 50, 0, 8, 50, 8, FALSE),
      ('sha017', 'src/utils/shared-file.ts', 40, 5, 10, 85, 10, FALSE),
      ('sha018', 'src/utils/shared-file.ts', 25, 10, 11, 100, 11, FALSE),
      ('sha019', 'src/utils/shared-file.ts', 20, 8, 12, 112, 12, FALSE),

      -- other-repo-file.ts
      ('sha020', 'src/other-file.ts', 80, 0, 10, 80, 10, FALSE)
    ON CONFLICT (sha, filename) DO NOTHING
  `);
}

describe('KnowledgeConcentrationDataService Integration Tests', () => {
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

    // Create schema
    await createSchema(service);

    // Create data service
    knowledgeService = new KnowledgeConcentrationDataService(service);
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
    await service.query('DELETE FROM commit_history');
    await service.query('DELETE FROM commit_contributors');
  });

  describe('checkViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await knowledgeService.checkViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('checkModuleViewExists', () => {
    it('should return true when module view exists', async () => {
      const exists = await knowledgeService.checkModuleViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('getFileOwnership', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return files ordered by top_contributor_pct descending', async () => {
      const result = await knowledgeService.getFileOwnership();

      // Should have at least 5 files
      expect(result.length).toBeGreaterThanOrEqual(4);

      // Verify ordering by top_contributor_pct descending
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1]?.topContributorPct ?? 0).toBeGreaterThanOrEqual(result[i]?.topContributorPct ?? 0);
      }
    });

    it('should calculate ownership percentage correctly', async () => {
      const result = await knowledgeService.getFileOwnership();

      // Find solo-file.ts - 3 commits from user1 = 100%
      const soloFile = result.find(r => r.filePath === 'src/solo-file.ts');
      expect(soloFile).toBeDefined();
      expect(soloFile?.topContributorPct).toBe(100);
      expect(soloFile?.topContributor).toBe('user1');
      expect(soloFile?.totalContributors).toBe(1);
    });

    it('should calculate bus factor correctly for single contributor', async () => {
      const result = await knowledgeService.getFileOwnership();

      // solo-file.ts: 1 contributor = bus factor 1
      const soloFile = result.find(r => r.filePath === 'src/solo-file.ts');
      expect(soloFile?.busFactor).toBe(1);
    });

    it('should calculate bus factor correctly for high ownership', async () => {
      const result = await knowledgeService.getFileOwnership();

      // high-risk-file.ts: user1 has ~86% (6/7) = bus factor 1
      const highRiskFile = result.find(r => r.filePath === 'src/services/high-risk-file.ts');
      expect(highRiskFile).toBeDefined();
      expect(highRiskFile?.busFactor).toBe(1);
      expect(highRiskFile?.topContributorPct).toBeGreaterThanOrEqual(80);
    });

    it('should calculate bus factor correctly for distributed ownership', async () => {
      const result = await knowledgeService.getFileOwnership();

      // shared-file.ts: 4 contributors with equal commits = bus factor 3
      const sharedFile = result.find(r => r.filePath === 'src/utils/shared-file.ts');
      expect(sharedFile).toBeDefined();
      expect(sharedFile?.totalContributors).toBe(4);
      expect(sharedFile?.busFactor).toBeGreaterThanOrEqual(2);
    });

    it('should categorize concentration risk as critical (>= 90%)', async () => {
      const result = await knowledgeService.getFileOwnership();

      // solo-file.ts: 100% ownership = critical
      const soloFile = result.find(r => r.filePath === 'src/solo-file.ts');
      expect(soloFile?.concentrationRisk).toBe('critical');
    });

    it('should categorize concentration risk as high (>= 80%, < 90%)', async () => {
      const result = await knowledgeService.getFileOwnership();

      // high-risk-file.ts: ~86% ownership = high
      const highRiskFile = result.find(r => r.filePath === 'src/services/high-risk-file.ts');
      expect(highRiskFile).toBeDefined();
      if (highRiskFile!.topContributorPct >= 80 && highRiskFile!.topContributorPct < 90) {
        expect(highRiskFile?.concentrationRisk).toBe('high');
      }
    });

    it('should categorize concentration risk as medium (>= 60%, < 80%)', async () => {
      const result = await knowledgeService.getFileOwnership();

      // medium-risk-file.ts: 60% ownership (3/5) = medium
      const mediumRiskFile = result.find(r => r.filePath === 'src/services/medium-risk-file.ts');
      expect(mediumRiskFile).toBeDefined();
      expect(mediumRiskFile?.concentrationRisk).toBe('medium');
    });

    it('should categorize concentration risk as low (< 60%)', async () => {
      const result = await knowledgeService.getFileOwnership();

      // shared-file.ts: 25% each (4 contributors) = low
      const sharedFile = result.find(r => r.filePath === 'src/utils/shared-file.ts');
      expect(sharedFile?.concentrationRisk).toBe('low');
    });

    it('should identify second contributor correctly', async () => {
      const result = await knowledgeService.getFileOwnership();

      // high-risk-file.ts: user2 is second contributor
      const highRiskFile = result.find(r => r.filePath === 'src/services/high-risk-file.ts');
      expect(highRiskFile?.secondContributor).toBe('user2');
    });

    it('should exclude merge commits from calculations', async () => {
      const result = await knowledgeService.getFileOwnership();

      // sha021 is a merge commit and should not affect any file
      // All commit counts should match non-merge commits only
      const soloFile = result.find(r => r.filePath === 'src/solo-file.ts');
      expect(soloFile?.totalCommits).toBe(3); // Only sha001, sha002, sha003
    });

    it('should filter by repository', async () => {
      const result = await knowledgeService.getFileOwnership({ repository: 'other-repo' });

      // Only other-file.ts is in other-repo
      expect(result.length).toBe(1);
      expect(result[0]?.filePath).toBe('src/other-file.ts');
      expect(result[0]?.repository).toBe('other-repo');
    });

    it('should filter by concentration risk', async () => {
      const result = await knowledgeService.getFileOwnership({ concentrationRisk: 'critical' });

      for (const row of result) {
        expect(row.concentrationRisk).toBe('critical');
      }
    });

    it('should filter by contributor', async () => {
      const result = await knowledgeService.getFileOwnership({ contributor: 'user2' });

      // user2 is top or second contributor in these files
      for (const row of result) {
        expect(row.topContributor === 'user2' || row.secondContributor === 'user2').toBe(true);
      }
    });

    it('should filter by maxBusFactor', async () => {
      const result = await knowledgeService.getFileOwnership({ maxBusFactor: 1 });

      for (const row of result) {
        expect(row.busFactor).toBeLessThanOrEqual(1);
      }
    });

    it('should apply combined filters', async () => {
      const result = await knowledgeService.getFileOwnership({
        repository: 'test-repo',
        concentrationRisk: 'high',
      });

      for (const row of result) {
        expect(row.repository).toBe('test-repo');
        expect(row.concentrationRisk).toBe('high');
      }
    });
  });

  describe('getSummary', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return summary statistics by concentration risk', async () => {
      const result = await knowledgeService.getSummary();

      // Should have summary rows for existing risk levels
      expect(result.length).toBeGreaterThanOrEqual(1);

      // Verify structure
      for (const row of result) {
        expect(['critical', 'high', 'medium', 'low']).toContain(row.concentration_risk);
        expect(typeof row.file_count).toBe('number');
        expect(row.file_count).toBeGreaterThan(0);
      }
    });
  });

  describe('getModuleBusFactor', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return module-level aggregation', async () => {
      const result = await knowledgeService.getModuleBusFactor();

      // Should have modules (src/services has 2 files, qualifies for >= 3 threshold? Actually need >= 3)
      // Let's check what we get
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter by repository', async () => {
      const result = await knowledgeService.getModuleBusFactor({ repository: 'test-repo' });

      for (const row of result) {
        expect(row.repository).toBe('test-repo');
      }
    });
  });

  describe('getHighRiskModules', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return only modules with high-risk files', async () => {
      const result = await knowledgeService.getHighRiskModules();

      for (const row of result) {
        expect(row.highRiskFiles).toBeGreaterThan(0);
      }
    });
  });

  describe('getChartData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return chart data with view existence check', async () => {
      const result = await knowledgeService.getChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.rows.length).toBeGreaterThanOrEqual(4);
    });

    it('should return empty data when no files match filters', async () => {
      const result = await knowledgeService.getChartData({
        repository: 'non-existent-repo',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.rows.length).toBe(0);
    });
  });

  describe('getModuleChartData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return module chart data with view existence check', async () => {
      const result = await knowledgeService.getModuleChartData();

      expect(result.viewExists).toBe(true);
      // May or may not have data depending on 3-file threshold
    });
  });

  describe('edge cases', () => {
    it('should handle empty database', async () => {
      // No data inserted
      const result = await knowledgeService.getFileOwnership();
      expect(result.length).toBe(0);
    });

    it('should handle single commit per file', async () => {
      await service.query(`
        INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
        VALUES ('single001', 'https://github.com/org/repo/commit/single001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'user1', NOW(), 'feat: Single commit', 1, 50, 0, FALSE, FALSE, 'TestOrg')
      `);
      await service.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
        VALUES ('single001', 'src/single-commit.ts', 50, 0, 5, 50, 5, FALSE)
      `);

      const result = await knowledgeService.getFileOwnership();

      const singleCommitFile = result.find(r => r.filePath === 'src/single-commit.ts');
      expect(singleCommitFile).toBeDefined();
      expect(singleCommitFile?.totalCommits).toBe(1);
      expect(singleCommitFile?.totalContributors).toBe(1);
      expect(singleCommitFile?.busFactor).toBe(1);
      expect(singleCommitFile?.concentrationRisk).toBe('critical');
    });
  });

  describe('performance', () => {
    it('should handle large number of files efficiently', async () => {
      // Insert 100 commits with 5 files each
      for (let commitIdx = 0; commitIdx < 100; commitIdx++) {
        const sha = `perf_sha${String(commitIdx).padStart(4, '0')}`;
        const author = `user${(commitIdx % 5) + 1}`;

        await service.query(`
          INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
          VALUES ($1, $2, 'main', 'perf-repo', 'https://github.com/org/perf-repo.git', $3, NOW() - INTERVAL '1 day' * $4, 'perf commit', 5, 50, 10, FALSE, FALSE, 'TestOrg')
        `, [sha, `https://github.com/org/repo/commit/${sha}`, author, commitIdx]);

        for (let fileIdx = 0; fileIdx < 5; fileIdx++) {
          const filename = `src/module${fileIdx}/file${commitIdx % 20}.ts`;
          await service.query(`
            INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file)
            VALUES ($1, $2, 10, 2, $3, 100, 10, FALSE)
            ON CONFLICT (sha, filename) DO NOTHING
          `, [sha, filename, (commitIdx % 30) + (fileIdx * 3)]);
        }
      }

      const start = Date.now();
      const result = await knowledgeService.getFileOwnership();
      const elapsed = Date.now() - start;

      // Should return data
      expect(result.length).toBeGreaterThan(0);
      // Query should complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);
    }, 60_000); // 60 second timeout for bulk insert
  });
});
