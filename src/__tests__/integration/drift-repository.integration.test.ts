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
import { ArchitectureDriftDataService } from '../../services/architecture-drift-service.js';

/**
 * Integration tests for ArchitectureDriftDataService with a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema from migration files,
 * then exercises the data service methods against the real database.
 *
 * Ticket: IQS-917
 *
 * Test coverage includes:
 * - View correctness with sample data
 * - Cross-component commit detection
 * - Drift severity assignment
 * - Heat map intensity calculations
 * - Component pair coupling detection
 * - Filter combinations
 */

const PG_DATABASE = 'gitrx_drift_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let driftService: ArchitectureDriftDataService;

/**
 * Helper: Create schema from migration files.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply migrations in order (dependencies first)
  const migrations = [
    '001_create_tables.sql',
    '002_create_views.sql',
    '004_add_linear_support.sql',
    '006_add_arc_component.sql',
    '010_dev_pipeline_baseline.sql',
    '021_architecture_drift.sql',
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert test data for drift analysis.
 */
async function insertTestData(dbService: DatabaseService): Promise<void> {
  // Insert commit_contributors
  await dbService.query(`
    INSERT INTO commit_contributors (login, full_name, email, team)
    VALUES
      ('clean_dev', 'Clean Developer', 'clean@test.com', 'Engineering'),
      ('drift_dev', 'Drift Developer', 'drift@test.com', 'Engineering'),
      ('critical_dev', 'Critical Developer', 'critical@test.com', 'Platform')
    ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name
  `);

  // Insert commits with single component (no drift)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      ('clean_sha_001', 'https://github.com/org/repo/commit/clean_sha_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'clean_dev', NOW() - INTERVAL '1 day', 'feat: Add API endpoint', 3, 100, 10, FALSE, FALSE, 'TestOrg'),
      ('clean_sha_002', 'https://github.com/org/repo/commit/clean_sha_002', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'clean_dev', NOW() - INTERVAL '2 days', 'fix: Database query optimization', 2, 50, 20, FALSE, FALSE, 'TestOrg'),
      ('clean_sha_003', 'https://github.com/org/repo/commit/clean_sha_003', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'clean_dev', NOW() - INTERVAL '3 days', 'refactor: Utility functions', 1, 30, 15, FALSE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commit files with single component
  await dbService.query(`
    INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file, arc_component)
    VALUES
      ('clean_sha_001', 'src/api/endpoint.ts', 100, 10, 15, 200, 20, FALSE, 'api'),
      ('clean_sha_002', 'src/database/query.ts', 50, 20, 10, 100, 10, FALSE, 'database'),
      ('clean_sha_003', 'src/utils/helpers.ts', 30, 15, 5, 50, 5, FALSE, 'utils')
    ON CONFLICT (sha, filename) DO NOTHING
  `);

  // Insert commits with 2 components (low drift)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      ('low_sha_001', 'https://github.com/org/repo/commit/low_sha_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'drift_dev', NOW() - INTERVAL '4 days', 'feat: API with utils integration', 4, 150, 30, FALSE, FALSE, 'TestOrg'),
      ('low_sha_002', 'https://github.com/org/repo/commit/low_sha_002', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'drift_dev', NOW() - INTERVAL '5 days', 'fix: Database and API fix', 3, 80, 20, FALSE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commit files with 2 components
  await dbService.query(`
    INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file, arc_component)
    VALUES
      ('low_sha_001', 'src/api/integration.ts', 100, 20, 12, 180, 15, FALSE, 'api'),
      ('low_sha_001', 'src/utils/integration.ts', 50, 10, 8, 80, 8, FALSE, 'utils'),
      ('low_sha_002', 'src/database/api-query.ts', 50, 10, 10, 100, 10, FALSE, 'database'),
      ('low_sha_002', 'src/api/db-handler.ts', 30, 10, 8, 60, 5, FALSE, 'api')
    ON CONFLICT (sha, filename) DO NOTHING
  `);

  // Insert commits with 3 components (medium drift)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      ('med_sha_001', 'https://github.com/org/repo/commit/med_sha_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'drift_dev', NOW() - INTERVAL '6 days', 'feat: Cross-component feature', 6, 250, 50, FALSE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commit files with 3 components
  await dbService.query(`
    INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file, arc_component)
    VALUES
      ('med_sha_001', 'src/api/cross.ts', 100, 20, 15, 200, 20, FALSE, 'api'),
      ('med_sha_001', 'src/database/cross.ts', 80, 15, 12, 150, 15, FALSE, 'database'),
      ('med_sha_001', 'src/auth/cross.ts', 70, 15, 10, 120, 10, FALSE, 'auth')
    ON CONFLICT (sha, filename) DO NOTHING
  `);

  // Insert commits with 5+ components (critical drift)
  await dbService.query(`
    INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
    VALUES
      ('crit_sha_001', 'https://github.com/org/repo/commit/crit_sha_001', 'main', 'test-repo', 'https://github.com/org/test-repo.git', 'critical_dev', NOW() - INTERVAL '7 days', 'feat: Major architecture change', 10, 500, 100, FALSE, FALSE, 'TestOrg')
    ON CONFLICT (sha) DO NOTHING
  `);

  // Insert commit files with 5+ components
  await dbService.query(`
    INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file, arc_component)
    VALUES
      ('crit_sha_001', 'src/api/major.ts', 100, 20, 20, 250, 25, FALSE, 'api'),
      ('crit_sha_001', 'src/database/major.ts', 100, 20, 18, 220, 20, FALSE, 'database'),
      ('crit_sha_001', 'src/auth/major.ts', 100, 20, 15, 200, 20, FALSE, 'auth'),
      ('crit_sha_001', 'src/utils/major.ts', 100, 20, 12, 180, 15, FALSE, 'utils'),
      ('crit_sha_001', 'src/core/major.ts', 100, 20, 25, 300, 30, FALSE, 'core')
    ON CONFLICT (sha, filename) DO NOTHING
  `);
}

describe('ArchitectureDriftDataService Integration Tests', () => {
  beforeAll(async () => {
    // Reset logger for clean test state
    try {
      LoggerService.getInstance().dispose();
    } catch {
      /* ignore */
    }
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
    driftService = new ArchitectureDriftDataService(service);
  }, 120_000); // 2 minute timeout for container startup

  afterAll(async () => {
    if (service?.isInitialized()) {
      await service.shutdown();
    }
    if (container) {
      await container.stop();
    }
    try {
      LoggerService.getInstance().dispose();
    } catch {
      /* ignore */
    }
    LoggerService.resetInstance();
  }, 30_000);

  beforeEach(async () => {
    // Clear test data before each test
    await service.query('DELETE FROM commit_jira');
    await service.query('DELETE FROM commit_linear');
    await service.query('DELETE FROM commit_files');
    await service.query('DELETE FROM commit_history');
    await service.query('DELETE FROM commit_contributors');
  });

  describe('checkDriftViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await driftService.checkDriftViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('checkCrossComponentViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await driftService.checkCrossComponentViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('checkWeeklyDriftViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await driftService.checkWeeklyDriftViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('checkPairCouplingViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await driftService.checkPairCouplingViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('getCrossComponentCommits', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return commits with 2+ components', async () => {
      const result = await driftService.getCrossComponentCommits();

      // Should have cross-component commits
      expect(result.length).toBeGreaterThan(0);

      // All commits should have 2+ components
      for (const commit of result) {
        expect(commit.componentCount).toBeGreaterThanOrEqual(2);
        expect(commit.componentsTouched.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should assign drift severity correctly', async () => {
      const result = await driftService.getCrossComponentCommits();

      for (const commit of result) {
        // Verify severity matches component count
        if (commit.componentCount >= 5) {
          expect(commit.driftSeverity).toBe('critical');
        } else if (commit.componentCount >= 4) {
          expect(commit.driftSeverity).toBe('high');
        } else if (commit.componentCount >= 3) {
          expect(commit.driftSeverity).toBe('medium');
        } else if (commit.componentCount >= 2) {
          expect(commit.driftSeverity).toBe('low');
        }
      }
    });

    it('should filter by severity', async () => {
      const result = await driftService.getCrossComponentCommits({ severity: 'critical' });

      for (const commit of result) {
        expect(commit.driftSeverity).toBe('critical');
        expect(commit.componentCount).toBeGreaterThanOrEqual(5);
      }
    });

    it('should filter by repository', async () => {
      const result = await driftService.getCrossComponentCommits({ repository: 'test-repo' });

      for (const commit of result) {
        expect(commit.repository).toBe('test-repo');
      }
    });

    it('should return empty for non-existent repository', async () => {
      const result = await driftService.getCrossComponentCommits({ repository: 'non-existent' });
      expect(result.length).toBe(0);
    });
  });

  describe('getArchitectureDrift', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return drift data by component', async () => {
      const result = await driftService.getArchitectureDrift();

      // Should have component drift data
      expect(result.length).toBeGreaterThan(0);

      // Each component should have valid metrics
      for (const drift of result) {
        expect(drift.component).toBeDefined();
        expect(drift.crossComponentCommits).toBeGreaterThanOrEqual(0);
        expect(drift.heatIntensity).toBeGreaterThanOrEqual(0);
        expect(drift.heatIntensity).toBeLessThanOrEqual(100);
      }
    });

    it('should filter by repository', async () => {
      const result = await driftService.getArchitectureDrift({ repository: 'test-repo' });

      for (const drift of result) {
        expect(drift.repository).toBe('test-repo');
      }
    });

    it('should filter by component', async () => {
      const result = await driftService.getArchitectureDrift({ component: 'api' });

      for (const drift of result) {
        expect(drift.component).toBe('api');
      }
    });
  });

  describe('getWeeklyDriftTrends', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return weekly trends', async () => {
      const result = await driftService.getWeeklyDriftTrends();

      // Should have weekly trends
      expect(result.length).toBeGreaterThan(0);

      // Each trend should have valid metrics
      for (const trend of result) {
        expect(trend.week).toBeDefined();
        expect(trend.component).toBeDefined();
        expect(trend.crossComponentCommits).toBeGreaterThanOrEqual(0);
        expect(trend.heatIntensity).toBeGreaterThanOrEqual(0);
      }
    });

    it('should filter by repository', async () => {
      const result = await driftService.getWeeklyDriftTrends({ repository: 'test-repo' });

      for (const trend of result) {
        expect(trend.repository).toBe('test-repo');
      }
    });

    it('should filter by component', async () => {
      const result = await driftService.getWeeklyDriftTrends({ component: 'api' });

      for (const trend of result) {
        expect(trend.component).toBe('api');
      }
    });
  });

  describe('getComponentPairCoupling', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return component pair couplings', async () => {
      const result = await driftService.getComponentPairCoupling();

      // Should have coupling data
      expect(result.length).toBeGreaterThan(0);

      // Each coupling should have valid metrics
      for (const coupling of result) {
        expect(coupling.componentA).toBeDefined();
        expect(coupling.componentB).toBeDefined();
        expect(coupling.couplingCount).toBeGreaterThan(0);
        expect(coupling.componentA < coupling.componentB).toBe(true); // Alphabetically ordered
      }
    });

    it('should filter by repository', async () => {
      const result = await driftService.getComponentPairCoupling({ repository: 'test-repo' });

      for (const coupling of result) {
        expect(coupling.repository).toBe('test-repo');
      }
    });

    it('should filter by component', async () => {
      const result = await driftService.getComponentPairCoupling({ component: 'api' });

      for (const coupling of result) {
        expect(coupling.componentA === 'api' || coupling.componentB === 'api').toBe(true);
      }
    });
  });

  describe('getSummary', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return summary statistics', async () => {
      const result = await driftService.getSummary();

      expect(result.totalCrossComponentCommits).toBeGreaterThan(0);
      expect(result.totalComponents).toBeGreaterThan(0);
      expect(result.avgDriftPercentage).toBeGreaterThanOrEqual(0);
      expect(result.maxHeatIntensity).toBeGreaterThanOrEqual(0);
    });
  });

  describe('buildHeatMapData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should build heat map from weekly trends', async () => {
      const trends = await driftService.getWeeklyDriftTrends();
      const heatMap = driftService.buildHeatMapData(trends);

      expect(heatMap.components.length).toBeGreaterThan(0);
      expect(heatMap.weeks.length).toBeGreaterThan(0);
      expect(heatMap.cells.length).toBe(trends.length);
    });
  });

  describe('getHeatMapChartData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return complete chart data', async () => {
      const result = await driftService.getHeatMapChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.driftData.length).toBeGreaterThan(0);
      expect(result.heatMapData.cells.length).toBeGreaterThan(0);
      expect(result.couplingData.length).toBeGreaterThan(0);
      expect(result.summary.totalCrossComponentCommits).toBeGreaterThan(0);
    });

    it('should return empty data for non-existent repository', async () => {
      const result = await driftService.getHeatMapChartData({
        repository: 'non-existent-repo',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.driftData.length).toBe(0);
    });
  });

  describe('getCrossComponentCommitData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return cross-component data with view check', async () => {
      const result = await driftService.getCrossComponentCommitData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.commits.length).toBeGreaterThan(0);
    });

    it('should return empty for non-existent repository', async () => {
      const result = await driftService.getCrossComponentCommitData({
        repository: 'non-existent-repo',
      });

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.commits.length).toBe(0);
    });
  });

  describe('getArchitectureDriftData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return drift data with view check', async () => {
      const result = await driftService.getArchitectureDriftData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.driftData.length).toBeGreaterThan(0);
    });
  });

  describe('performance', () => {
    it('should handle multiple cross-component commits efficiently', async () => {
      // Insert 100 commits with various component counts
      for (let commitIdx = 0; commitIdx < 100; commitIdx++) {
        const sha = `perf_sha${String(commitIdx).padStart(4, '0')}`;
        const componentCount = (commitIdx % 5) + 1; // 1-5 components

        await service.query(`
          INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
          VALUES ($1, $2, 'main', 'perf-repo', 'https://github.com/org/perf-repo.git', 'perfuser', NOW() - INTERVAL '${commitIdx} hours', $3, $4, 50, 10, FALSE, FALSE, 'TestOrg')
        `, [sha, `https://github.com/org/repo/commit/${sha}`, `feat: Commit ${commitIdx}`, componentCount]);

        const components = ['api', 'database', 'auth', 'utils', 'core'].slice(0, componentCount);
        for (const comp of components) {
          await service.query(`
            INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity, total_code_lines, total_comment_lines, is_test_file, arc_component)
            VALUES ($1, $2, 20, 5, 10, 50, 5, FALSE, $3)
          `, [sha, `src/${comp}/perf.ts`, comp]);
        }
      }

      // Insert contributor
      await service.query(`
        INSERT INTO commit_contributors (login, full_name, email, team)
        VALUES ('perfuser', 'Perf User', 'perf@test.com', 'Engineering')
        ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name
      `);

      const start = Date.now();
      const result = await driftService.getCrossComponentCommits();
      const elapsed = Date.now() - start;

      // Should return cross-component commits
      expect(result.length).toBeGreaterThan(0);
      // Query should complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);
    }, 60_000);
  });
});
