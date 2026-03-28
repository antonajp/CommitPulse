/**
 * Acceptance tests for Complexity Chart Feature (Top Complex Files).
 *
 * This test suite verifies the end-to-end functionality of the complexity
 * chart, including data rendering, filter combinations, edge cases, and
 * error handling.
 *
 * Test Strategy:
 * - Unit layer: Data service query logic (already covered in unit tests)
 * - Integration layer: Database queries with real data (covered here)
 * - UI layer: Chart rendering and filter interactions (manual/E2E)
 *
 * Ticket: IQS-894
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { DatabaseService, type DatabaseServiceConfig } from '../../database/database-service.js';
import { ComplexityDataService } from '../../services/complexity-data-service.js';
import type { DashboardFilters } from '../../services/dashboard-data-types.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Test fixture data for complexity chart acceptance tests.
 */
interface ComplexityTestFixture {
  readonly sha: string;
  readonly author: string;
  readonly commitDate: string;
  readonly repository: string;
  readonly filename: string;
  readonly complexity: number;
  readonly lineInserts: number;
  readonly team?: string;
  readonly fullName?: string;
}

describe('Complexity Chart Acceptance Tests', () => {
  let container: StartedTestContainer;
  let dbService: DatabaseService;
  let dataService: ComplexityDataService;

  // Setup test container with PostgreSQL 16
  beforeAll(async () => {
    // Reset logger for clean test state
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'gitr_test',
        POSTGRES_USER: 'gitr_test',
        POSTGRES_PASSWORD: 'test_password',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();

    const config: DatabaseServiceConfig = {
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: 'gitr_test',
      user: 'gitr_test',
      password: 'test_password',
      maxPoolSize: 5,
      connectionTimeoutMs: 10_000,
      idleTimeoutMs: 30_000,
    };

    dbService = new DatabaseService();
    await dbService.initialize(config);

    dataService = new ComplexityDataService(dbService);
  }, 120000); // 120s timeout for container startup

  afterAll(async () => {
    if (dbService?.isInitialized()) {
      await dbService.shutdown();
    }
    if (container) {
      await container.stop();
    }
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
  }, 30000);

  beforeEach(async () => {
    // Clean up tables before each test
    await dbService.query('TRUNCATE TABLE commit_files CASCADE', []);
    await dbService.query('TRUNCATE TABLE commit_history CASCADE', []);
    await dbService.query('TRUNCATE TABLE commit_contributors CASCADE', []);
  });

  /**
   * Helper: Insert test fixture data into the database.
   */
  async function insertFixture(fixture: ComplexityTestFixture): Promise<void> {
    // Insert contributor if team/fullName provided
    if (fixture.team || fixture.fullName) {
      await dbService.query(
        `INSERT INTO commit_contributors (login, full_name, team, vendor)
         VALUES ($1, $2, $3, 'Internal')
         ON CONFLICT (login) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           team = EXCLUDED.team`,
        [fixture.author, fixture.fullName || fixture.author, fixture.team || null]
      );
    }

    // Insert commit history
    await dbService.query(
      `INSERT INTO commit_history (
        sha, author, commit_date, repository, is_merge, message
      ) VALUES ($1, $2, $3, $4, FALSE, 'Test commit')
      ON CONFLICT (sha) DO NOTHING`,
      [fixture.sha, fixture.author, fixture.commitDate, fixture.repository]
    );

    // Insert commit file
    await dbService.query(
      `INSERT INTO commit_files (
        sha, filename, complexity, line_inserts, line_deletes, total_code_lines
      ) VALUES ($1, $2, $3, $4, 0, $4)
      ON CONFLICT (sha, filename) DO NOTHING`,
      [fixture.sha, fixture.filename, fixture.complexity, fixture.lineInserts]
    );
  }

  // ==========================================================================
  // AC1: Chart renders with complexity data
  // ==========================================================================
  describe('AC1: Chart renders with complexity data', () => {
    it('should return top 5 complex files with contributor breakdown', async () => {
      // Arrange: Create 5 files with different complexity levels
      const fixtures: ComplexityTestFixture[] = [
        { sha: 'sha1', author: 'alice', commitDate: '2025-01-15', repository: 'repo1', filename: 'src/complex-a.ts', complexity: 500, lineInserts: 1000, team: 'Platform', fullName: 'Alice Smith' },
        { sha: 'sha2', author: 'bob', commitDate: '2025-01-16', repository: 'repo1', filename: 'src/complex-a.ts', complexity: 500, lineInserts: 500, team: 'Backend', fullName: 'Bob Jones' },
        { sha: 'sha3', author: 'charlie', commitDate: '2025-01-17', repository: 'repo1', filename: 'src/complex-b.ts', complexity: 400, lineInserts: 800, team: 'Platform', fullName: 'Charlie Brown' },
        { sha: 'sha4', author: 'diana', commitDate: '2025-01-18', repository: 'repo1', filename: 'src/complex-c.ts', complexity: 300, lineInserts: 600, team: 'Frontend', fullName: 'Diana Prince' },
        { sha: 'sha5', author: 'eve', commitDate: '2025-01-19', repository: 'repo1', filename: 'src/complex-d.ts', complexity: 200, lineInserts: 400, team: 'Backend', fullName: 'Eve Adams' },
        { sha: 'sha6', author: 'frank', commitDate: '2025-01-20', repository: 'repo1', filename: 'src/simple-e.ts', complexity: 100, lineInserts: 200, team: 'Platform', fullName: 'Frank White' },
      ];

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }

      // Act: Fetch top 5 complex files
      const result = await dataService.getTopComplexFiles('individual', 5);

      // Assert: Should return 5 data points (top 5 files)
      expect(result.length).toBeGreaterThanOrEqual(5);

      // Verify sorting: files should be ordered by complexity descending
      const complexities = result.map(r => r.complexity);
      expect(complexities[0]).toBeGreaterThanOrEqual(complexities[1] || 0);

      // Verify data structure
      expect(result[0]).toMatchObject({
        filename: expect.any(String),
        complexity: expect.any(Number),
        contributor: expect.any(String),
        loc: expect.any(Number),
        percentage: expect.any(Number),
      });

      // Verify contributor breakdown exists
      const fileAContributors = result.filter(r => r.filename === 'src/complex-a.ts');
      expect(fileAContributors.length).toBe(2); // Alice and Bob
    });

    it('should aggregate by team when groupBy is team', async () => {
      // Arrange: Multiple contributors from same team
      const fixtures: ComplexityTestFixture[] = [
        { sha: 'sha1', author: 'alice', commitDate: '2025-01-15', repository: 'repo1', filename: 'src/app.ts', complexity: 300, lineInserts: 500, team: 'Platform', fullName: 'Alice Smith' },
        { sha: 'sha2', author: 'bob', commitDate: '2025-01-16', repository: 'repo1', filename: 'src/app.ts', complexity: 300, lineInserts: 300, team: 'Platform', fullName: 'Bob Jones' },
        { sha: 'sha3', author: 'charlie', commitDate: '2025-01-17', repository: 'repo1', filename: 'src/app.ts', complexity: 300, lineInserts: 200, team: 'Backend', fullName: 'Charlie Brown' },
      ];

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }

      // Act: Fetch with team grouping
      const result = await dataService.getTopComplexFiles('team', 10);

      // Assert: Platform team should have combined LOC of 800
      const platformContrib = result.find(r => r.contributor === 'Platform');
      expect(platformContrib).toBeDefined();
      expect(platformContrib?.loc).toBe(800);

      // Backend team should have 200
      const backendContrib = result.find(r => r.contributor === 'Backend');
      expect(backendContrib).toBeDefined();
      expect(backendContrib?.loc).toBe(200);
    });

    it('should handle files with NULL team assignment', async () => {
      // Arrange: Contributor without team
      const fixtures: ComplexityTestFixture[] = [
        { sha: 'sha1', author: 'unassigned_user', commitDate: '2025-01-15', repository: 'repo1', filename: 'src/orphan.ts', complexity: 150, lineInserts: 300 },
      ];

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }

      // Act
      const resultIndividual = await dataService.getTopComplexFiles('individual', 10);
      const resultTeam = await dataService.getTopComplexFiles('team', 10);

      // Assert: Individual mode should show author name with NULL team
      const individualRecord = resultIndividual.find(r => r.filename === 'src/orphan.ts');
      expect(individualRecord?.contributor).toBe('unassigned_user');
      expect(individualRecord?.team).toBeNull();

      // Team mode should show "Unassigned"
      const teamRecord = resultTeam.find(r => r.filename === 'src/orphan.ts');
      expect(teamRecord?.contributor).toBe('Unassigned');
    });
  });

  // ==========================================================================
  // AC2: Filter combinations work correctly
  // ==========================================================================
  describe('AC2: Filter combinations work correctly', () => {
    beforeEach(async () => {
      // Arrange: Common dataset for filter tests
      const fixtures: ComplexityTestFixture[] = [
        // File 1: High complexity, Platform team, repo1, Jan 2025
        { sha: 'sha1', author: 'alice', commitDate: '2025-01-15', repository: 'repo1', filename: 'src/high-complex.ts', complexity: 500, lineInserts: 1000, team: 'Platform', fullName: 'Alice Smith' },
        // File 2: Medium complexity, Backend team, repo1, Feb 2025
        { sha: 'sha2', author: 'bob', commitDate: '2025-02-10', repository: 'repo1', filename: 'src/mid-complex.ts', complexity: 300, lineInserts: 600, team: 'Backend', fullName: 'Bob Jones' },
        // File 3: Low complexity, Platform team, repo2, Jan 2025
        { sha: 'sha3', author: 'charlie', commitDate: '2025-01-20', repository: 'repo2', filename: 'src/low-complex.ts', complexity: 200, lineInserts: 400, team: 'Platform', fullName: 'Charlie Brown' },
        // File 4: Medium complexity, Frontend team, repo2, Mar 2025
        { sha: 'sha4', author: 'diana', commitDate: '2025-03-05', repository: 'repo2', filename: 'src/another-complex.ts', complexity: 350, lineInserts: 700, team: 'Frontend', fullName: 'Diana Prince' },
      ];

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }
    });

    it('should filter by startDate only', async () => {
      // Act: Filter commits from Feb 1 onwards
      const filters: DashboardFilters = { startDate: '2025-02-01' };
      const result = await dataService.getTopComplexFiles('individual', 20, filters);

      // Assert: Should only include sha2 and sha4
      const filenames = result.map(r => r.filename);
      expect(filenames).toContain('src/mid-complex.ts');
      expect(filenames).toContain('src/another-complex.ts');
      expect(filenames).not.toContain('src/high-complex.ts');
      expect(filenames).not.toContain('src/low-complex.ts');
    });

    it('should filter by endDate only', async () => {
      // Act: Filter commits until Jan 31
      const filters: DashboardFilters = { endDate: '2025-01-31' };
      const result = await dataService.getTopComplexFiles('individual', 20, filters);

      // Assert: Should only include sha1 and sha3
      const filenames = result.map(r => r.filename);
      expect(filenames).toContain('src/high-complex.ts');
      expect(filenames).toContain('src/low-complex.ts');
      expect(filenames).not.toContain('src/mid-complex.ts');
      expect(filenames).not.toContain('src/another-complex.ts');
    });

    it('should filter by date range (startDate + endDate)', async () => {
      // Act: Filter commits in January 2025
      const filters: DashboardFilters = {
        startDate: '2025-01-01',
        endDate: '2025-01-31'
      };
      const result = await dataService.getTopComplexFiles('individual', 20, filters);

      // Assert: Should only include sha1 and sha3
      const filenames = result.map(r => r.filename);
      expect(filenames).toContain('src/high-complex.ts');
      expect(filenames).toContain('src/low-complex.ts');
      expect(filenames).not.toContain('src/mid-complex.ts');
      expect(filenames).not.toContain('src/another-complex.ts');
    });

    it('should filter by team', async () => {
      // Act: Filter Platform team only
      const filters: DashboardFilters = { team: 'Platform' };
      const result = await dataService.getTopComplexFiles('individual', 20, filters);

      // Assert: Should only include Alice and Charlie (Platform team)
      const contributors = result.map(r => r.contributor);
      expect(contributors).toContain('Alice Smith');
      expect(contributors).toContain('Charlie Brown');
      expect(contributors).not.toContain('Bob Jones');
      expect(contributors).not.toContain('Diana Prince');
    });

    it('should filter by repository', async () => {
      // Act: Filter repo1 only
      const filters: DashboardFilters = { repository: 'repo1' };
      const result = await dataService.getTopComplexFiles('individual', 20, filters);

      // Assert: Should only include files from repo1
      const filenames = result.map(r => r.filename);
      expect(filenames).toContain('src/high-complex.ts');
      expect(filenames).toContain('src/mid-complex.ts');
      expect(filenames).not.toContain('src/low-complex.ts');
      expect(filenames).not.toContain('src/another-complex.ts');
    });

    it('should combine all filters (date range + team + repository)', async () => {
      // Act: Platform team, repo1, January 2025
      const filters: DashboardFilters = {
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        team: 'Platform',
        repository: 'repo1',
      };
      const result = await dataService.getTopComplexFiles('individual', 20, filters);

      // Assert: Should only include Alice's commit (sha1)
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.contributor).toBe('Alice Smith');
      expect(result[0]?.filename).toBe('src/high-complex.ts');

      // Should not include other contributors
      const contributors = result.map(r => r.contributor);
      expect(contributors).not.toContain('Bob Jones');
      expect(contributors).not.toContain('Charlie Brown');
    });

    it('should handle filters with no matching data', async () => {
      // Act: Filter non-existent team
      const filters: DashboardFilters = { team: 'NonExistentTeam' };
      const result = await dataService.getTopComplexFiles('individual', 20, filters);

      // Assert: Should return empty array
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // AC3: Time period filter changes data appropriately
  // ==========================================================================
  describe('AC3: Time period filter changes data appropriately', () => {
    it('should show different files for different time periods', async () => {
      // Arrange: Files committed in different months
      const fixtures: ComplexityTestFixture[] = [
        { sha: 'sha1', author: 'alice', commitDate: '2024-12-15', repository: 'repo1', filename: 'src/old-file.ts', complexity: 400, lineInserts: 800, team: 'Platform' },
        { sha: 'sha2', author: 'bob', commitDate: '2025-01-15', repository: 'repo1', filename: 'src/new-file.ts', complexity: 500, lineInserts: 1000, team: 'Backend' },
      ];

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }

      // Act: Get data for December 2024
      const dec2024 = await dataService.getTopComplexFiles('individual', 20, {
        startDate: '2024-12-01',
        endDate: '2024-12-31',
      });

      // Act: Get data for January 2025
      const jan2025 = await dataService.getTopComplexFiles('individual', 20, {
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });

      // Assert: Different time periods show different files
      const decFilenames = dec2024.map(r => r.filename);
      const janFilenames = jan2025.map(r => r.filename);

      expect(decFilenames).toContain('src/old-file.ts');
      expect(decFilenames).not.toContain('src/new-file.ts');

      expect(janFilenames).toContain('src/new-file.ts');
      expect(janFilenames).not.toContain('src/old-file.ts');
    });

    it('should respect inclusive date boundaries', async () => {
      // Arrange: Commits on boundary dates
      const fixtures: ComplexityTestFixture[] = [
        { sha: 'sha1', author: 'alice', commitDate: '2025-01-01', repository: 'repo1', filename: 'src/boundary-start.ts', complexity: 300, lineInserts: 600 },
        { sha: 'sha2', author: 'bob', commitDate: '2025-01-31', repository: 'repo1', filename: 'src/boundary-end.ts', complexity: 400, lineInserts: 800 },
        { sha: 'sha3', author: 'charlie', commitDate: '2025-02-01', repository: 'repo1', filename: 'src/outside.ts', complexity: 500, lineInserts: 1000 },
      ];

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }

      // Act: Filter exactly January 2025
      const result = await dataService.getTopComplexFiles('individual', 20, {
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });

      // Assert: Should include boundary dates but not outside
      const filenames = result.map(r => r.filename);
      expect(filenames).toContain('src/boundary-start.ts');
      expect(filenames).toContain('src/boundary-end.ts');
      expect(filenames).not.toContain('src/outside.ts');
    });
  });

  // ==========================================================================
  // AC4: Team/contributor/repo filters narrow results
  // ==========================================================================
  describe('AC4: Team/contributor/repo filters narrow results', () => {
    it('should progressively narrow results with multiple filters', async () => {
      // Arrange: Dataset with overlapping attributes
      const fixtures: ComplexityTestFixture[] = [
        { sha: 'sha1', author: 'alice', commitDate: '2025-01-15', repository: 'repo1', filename: 'src/file1.ts', complexity: 400, lineInserts: 800, team: 'Platform', fullName: 'Alice Smith' },
        { sha: 'sha2', author: 'bob', commitDate: '2025-01-16', repository: 'repo1', filename: 'src/file2.ts', complexity: 300, lineInserts: 600, team: 'Backend', fullName: 'Bob Jones' },
        { sha: 'sha3', author: 'charlie', commitDate: '2025-01-17', repository: 'repo2', filename: 'src/file3.ts', complexity: 500, lineInserts: 1000, team: 'Platform', fullName: 'Charlie Brown' },
      ];

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }

      // Act: Get baseline (no filters)
      const baseline = await dataService.getTopComplexFiles('individual', 20);

      // Act: Add team filter
      const withTeam = await dataService.getTopComplexFiles('individual', 20, { team: 'Platform' });

      // Act: Add team + repository filter
      const withTeamRepo = await dataService.getTopComplexFiles('individual', 20, {
        team: 'Platform',
        repository: 'repo1'
      });

      // Assert: Results should progressively narrow
      expect(baseline.length).toBeGreaterThanOrEqual(3);
      expect(withTeam.length).toBeLessThanOrEqual(baseline.length);
      expect(withTeamRepo.length).toBeLessThanOrEqual(withTeam.length);

      // Final filtered result should only include Alice
      expect(withTeamRepo.length).toBeGreaterThan(0);
      expect(withTeamRepo[0]?.contributor).toBe('Alice Smith');
    });
  });

  // ==========================================================================
  // AC5: Empty state when no data matches filters
  // ==========================================================================
  describe('AC5: Empty state when no data matches filters', () => {
    it('should return empty array when no files have complexity data', async () => {
      // Arrange: Insert commits without complexity
      await dbService.query(
        `INSERT INTO commit_history (sha, author, commit_date, repository, is_merge, message)
         VALUES ('sha1', 'alice', '2025-01-15', 'repo1', FALSE, 'Test')`,
        []
      );
      await dbService.query(
        `INSERT INTO commit_files (sha, filename, line_inserts, line_deletes)
         VALUES ('sha1', 'src/no-complexity.ts', 100, 0)`,
        []
      );

      // Act
      const result = await dataService.getTopComplexFiles('individual', 20);

      // Assert: No complexity data should return empty
      expect(result).toEqual([]);
    });

    it('should return empty array when date filter excludes all data', async () => {
      // Arrange: File from 2025
      await insertFixture({
        sha: 'sha1',
        author: 'alice',
        commitDate: '2025-01-15',
        repository: 'repo1',
        filename: 'src/file.ts',
        complexity: 300,
        lineInserts: 600,
      });

      // Act: Filter for 2024 data
      const result = await dataService.getTopComplexFiles('individual', 20, {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });

      // Assert: Should return empty
      expect(result).toEqual([]);
    });

    it('should return empty array when team filter matches no contributors', async () => {
      // Arrange: Platform team members only
      await insertFixture({
        sha: 'sha1',
        author: 'alice',
        commitDate: '2025-01-15',
        repository: 'repo1',
        filename: 'src/file.ts',
        complexity: 300,
        lineInserts: 600,
        team: 'Platform',
      });

      // Act: Filter for non-existent team
      const result = await dataService.getTopComplexFiles('individual', 20, {
        team: 'SecurityTeam',
      });

      // Assert: Should return empty
      expect(result).toEqual([]);
    });

    it('should return empty array when repository filter matches no repos', async () => {
      // Arrange: repo1 only
      await insertFixture({
        sha: 'sha1',
        author: 'alice',
        commitDate: '2025-01-15',
        repository: 'repo1',
        filename: 'src/file.ts',
        complexity: 300,
        lineInserts: 600,
      });

      // Act: Filter for different repo
      const result = await dataService.getTopComplexFiles('individual', 20, {
        repository: 'repo999',
      });

      // Assert: Should return empty
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // EDGE CASE: Very large date ranges
  // ==========================================================================
  describe('EDGE CASE: Very large date ranges', () => {
    it('should handle 10-year date range without performance degradation', async () => {
      // Arrange: Commits spread across 10 years
      const fixtures: ComplexityTestFixture[] = [];
      for (let year = 2015; year <= 2025; year++) {
        fixtures.push({
          sha: `sha${year}`,
          author: 'alice',
          commitDate: `${year}-06-15`,
          repository: 'repo1',
          filename: `src/file-${year}.ts`,
          complexity: 300 + year,
          lineInserts: 600,
        });
      }

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }

      // Act: Query entire 10-year range
      const startTime = Date.now();
      const result = await dataService.getTopComplexFiles('individual', 20, {
        startDate: '2015-01-01',
        endDate: '2025-12-31',
      });
      const duration = Date.now() - startTime;

      // Assert: Should return all files and complete within reasonable time
      expect(result.length).toBeGreaterThanOrEqual(10);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should respect LIMIT to prevent memory exhaustion on large ranges', async () => {
      // Arrange: Create 150 files (exceeds topN max of 100)
      const fixtures: ComplexityTestFixture[] = [];
      for (let i = 1; i <= 150; i++) {
        fixtures.push({
          sha: `sha${i}`,
          author: 'alice',
          commitDate: '2025-01-15',
          repository: 'repo1',
          filename: `src/file-${i}.ts`,
          complexity: 1000 - i, // Decreasing complexity
          lineInserts: 500,
        });
      }

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }

      // Act: Request top 50
      const result = await dataService.getTopComplexFiles('individual', 50);

      // Assert: Should return only top 50 files
      expect(result.length).toBeLessThanOrEqual(50);

      // Verify they are the highest complexity files
      const firstComplexity = result[0]?.complexity || 0;
      expect(firstComplexity).toBeGreaterThan(900); // Should be near top
    });
  });

  // ==========================================================================
  // EDGE CASE: Single data point
  // ==========================================================================
  describe('EDGE CASE: Single data point', () => {
    it('should render chart with single file', async () => {
      // Arrange: Single file with one contributor
      await insertFixture({
        sha: 'sha1',
        author: 'alice',
        commitDate: '2025-01-15',
        repository: 'repo1',
        filename: 'src/only-file.ts',
        complexity: 300,
        lineInserts: 600,
        team: 'Platform',
        fullName: 'Alice Smith',
      });

      // Act
      const result = await dataService.getTopComplexFiles('individual', 20);

      // Assert: Should return single data point with 100% contribution
      expect(result.length).toBe(1);
      expect(result[0]).toMatchObject({
        filename: 'src/only-file.ts',
        complexity: 300,
        contributor: 'Alice Smith',
        loc: 600,
        percentage: 100,
      });
    });

    it('should handle single contributor to a file', async () => {
      // Arrange: File with only one contributor
      await insertFixture({
        sha: 'sha1',
        author: 'bob',
        commitDate: '2025-01-15',
        repository: 'repo1',
        filename: 'src/solo-work.ts',
        complexity: 450,
        lineInserts: 900,
      });

      // Act
      const result = await dataService.getTopComplexFiles('individual', 20);

      // Assert: Single contributor should have 100% ownership
      expect(result.length).toBe(1);
      expect(result[0]?.percentage).toBe(100);
    });

    it('should handle single day date range', async () => {
      // Arrange: Multiple commits on same day
      const fixtures: ComplexityTestFixture[] = [
        { sha: 'sha1', author: 'alice', commitDate: '2025-01-15', repository: 'repo1', filename: 'src/file1.ts', complexity: 300, lineInserts: 600 },
        { sha: 'sha2', author: 'bob', commitDate: '2025-01-15', repository: 'repo1', filename: 'src/file2.ts', complexity: 400, lineInserts: 800 },
      ];

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }

      // Act: Filter single day
      const result = await dataService.getTopComplexFiles('individual', 20, {
        startDate: '2025-01-15',
        endDate: '2025-01-15',
      });

      // Assert: Should return both files from that day
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================================================
  // EDGE CASE: No complexity data in database
  // ==========================================================================
  describe('EDGE CASE: No complexity data in database', () => {
    it('should return empty array when database is empty', async () => {
      // Arrange: Empty database (already clean from beforeEach)

      // Act
      const result = await dataService.getTopComplexFiles('individual', 20);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when complexity fields are NULL', async () => {
      // Arrange: File with NULL complexity
      await dbService.query(
        `INSERT INTO commit_history (sha, author, commit_date, repository, is_merge, message)
         VALUES ('sha1', 'alice', '2025-01-15', 'repo1', FALSE, 'Test')`,
        []
      );
      await dbService.query(
        `INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity)
         VALUES ('sha1', 'src/null-complexity.ts', 100, 0, NULL)`,
        []
      );

      // Act
      const result = await dataService.getTopComplexFiles('individual', 20);

      // Assert: NULL complexity should be excluded
      expect(result).toEqual([]);
    });

    it('should handle mix of NULL and valid complexity values', async () => {
      // Arrange: Mix of NULL and valid complexity
      await insertFixture({
        sha: 'sha1',
        author: 'alice',
        commitDate: '2025-01-15',
        repository: 'repo1',
        filename: 'src/valid.ts',
        complexity: 300,
        lineInserts: 600,
      });

      await dbService.query(
        `INSERT INTO commit_history (sha, author, commit_date, repository, is_merge, message)
         VALUES ('sha2', 'bob', '2025-01-16', 'repo1', FALSE, 'Test')`,
        []
      );
      await dbService.query(
        `INSERT INTO commit_files (sha, filename, line_inserts, line_deletes, complexity)
         VALUES ('sha2', 'src/null.ts', 100, 0, NULL)`,
        []
      );

      // Act
      const result = await dataService.getTopComplexFiles('individual', 20);

      // Assert: Should only include valid complexity file
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.filename).toBe('src/valid.ts');
      const filenames = result.map(r => r.filename);
      expect(filenames).not.toContain('src/null.ts');
    });
  });

  // ==========================================================================
  // EDGE CASE: Concurrent filter changes
  // ==========================================================================
  describe('EDGE CASE: Concurrent filter changes', () => {
    beforeEach(async () => {
      // Arrange: Common dataset
      const fixtures: ComplexityTestFixture[] = [
        { sha: 'sha1', author: 'alice', commitDate: '2025-01-15', repository: 'repo1', filename: 'src/file1.ts', complexity: 400, lineInserts: 800, team: 'Platform' },
        { sha: 'sha2', author: 'bob', commitDate: '2025-02-10', repository: 'repo2', filename: 'src/file2.ts', complexity: 300, lineInserts: 600, team: 'Backend' },
      ];

      for (const fixture of fixtures) {
        await insertFixture(fixture);
      }
    });

    it('should handle multiple simultaneous queries without race conditions', async () => {
      // Act: Fire 5 queries simultaneously with different filters
      const queries = [
        dataService.getTopComplexFiles('individual', 20, { team: 'Platform' }),
        dataService.getTopComplexFiles('team', 20, { repository: 'repo1' }),
        dataService.getTopComplexFiles('individual', 20, { startDate: '2025-02-01' }),
        dataService.getTopComplexFiles('team', 20, { endDate: '2025-01-31' }),
        dataService.getTopComplexFiles('individual', 20, {}),
      ];

      const results = await Promise.all(queries);

      // Assert: All queries should complete successfully
      expect(results.length).toBe(5);
      results.forEach(result => {
        expect(Array.isArray(result)).toBe(true);
      });

      // Verify each result is correct
      expect(results[0]?.some(r => r.team === 'Platform' || r.contributor === 'Platform')).toBe(true);
      expect(results[2]?.every(r => r.filename === 'src/file2.ts')).toBe(true);
    });

    it('should maintain data isolation between concurrent queries', async () => {
      // Act: Run same query twice simultaneously
      const [result1, result2] = await Promise.all([
        dataService.getTopComplexFiles('individual', 20, { team: 'Platform' }),
        dataService.getTopComplexFiles('individual', 20, { team: 'Platform' }),
      ]);

      // Assert: Both should return identical results
      expect(result1).toEqual(result2);
    });
  });

  // ==========================================================================
  // REGRESSION: Verify merge commits are excluded
  // ==========================================================================
  describe('REGRESSION: Merge commits excluded from complexity calculation', () => {
    it('should exclude merge commits from contributor LOC calculation', async () => {
      // Arrange: Same file with regular commit and merge commit
      await insertFixture({
        sha: 'sha1',
        author: 'alice',
        commitDate: '2025-01-15',
        repository: 'repo1',
        filename: 'src/file.ts',
        complexity: 300,
        lineInserts: 600,
        team: 'Platform',
        fullName: 'Alice Smith',
      });

      // Insert merge commit (should be excluded)
      await dbService.query(
        `INSERT INTO commit_history (sha, author, commit_date, repository, is_merge, message)
         VALUES ('merge1', 'alice', '2025-01-16', 'repo1', TRUE, 'Merge branch')`,
        []
      );
      await dbService.query(
        `INSERT INTO commit_files (sha, filename, complexity, line_inserts, line_deletes)
         VALUES ('merge1', 'src/file.ts', 300, 600, 0)`,
        []
      );

      // Act
      const result = await dataService.getTopComplexFiles('individual', 20);

      // Assert: LOC should only count non-merge commit
      const aliceContrib = result.find(r => r.contributor === 'Alice Smith');
      expect(aliceContrib?.loc).toBe(600); // Only from sha1, not merge1
    });
  });

  // ==========================================================================
  // INPUT VALIDATION: Security tests (CWE-89, CWE-20)
  // ==========================================================================
  describe('INPUT VALIDATION: Security and edge cases', () => {
    it('should reject invalid groupBy value', async () => {
      // Act & Assert
      await expect(
        dataService.getTopComplexFiles('invalid' as 'individual', 20)
      ).rejects.toThrow('Invalid groupBy');
    });

    it('should reject SQL injection attempt in groupBy', async () => {
      // Act & Assert
      await expect(
        dataService.getTopComplexFiles("'; DROP TABLE commit_files; --" as 'individual', 20)
      ).rejects.toThrow('Invalid groupBy');
    });

    it('should reject malformed date strings', async () => {
      // Act & Assert
      await expect(
        dataService.getTopComplexFiles('individual', 20, { startDate: 'not-a-date' })
      ).rejects.toThrow('Invalid startDate');

      await expect(
        dataService.getTopComplexFiles('individual', 20, { endDate: '2025/99/99' })
      ).rejects.toThrow('Invalid endDate');
    });

    it('should reject reversed date ranges', async () => {
      // Act & Assert
      await expect(
        dataService.getTopComplexFiles('individual', 20, {
          startDate: '2025-12-31',
          endDate: '2025-01-01',
        })
      ).rejects.toThrow('Invalid date range');
    });

    it('should reject filter strings exceeding 200 characters', async () => {
      // Arrange: 201-character string
      const longString = 'A'.repeat(201);

      // Act & Assert: Team filter
      await expect(
        dataService.getTopComplexFiles('individual', 20, { team: longString })
      ).rejects.toThrow('Team filter exceeds maximum length');

      // Act & Assert: Repository filter
      await expect(
        dataService.getTopComplexFiles('individual', 20, { repository: longString })
      ).rejects.toThrow('Repository filter exceeds maximum length');
    });

    it('should clamp topN to valid range (1-100)', async () => {
      await insertFixture({
        sha: 'sha1',
        author: 'alice',
        commitDate: '2025-01-15',
        repository: 'repo1',
        filename: 'src/file.ts',
        complexity: 300,
        lineInserts: 600,
      });

      // Act: topN = 0 (below minimum)
      const resultZero = await dataService.getTopComplexFiles('individual', 0);
      expect(resultZero.length).toBeGreaterThanOrEqual(1); // Clamped to 1

      // Act: topN = 200 (above maximum)
      const resultHigh = await dataService.getTopComplexFiles('individual', 200);
      expect(resultHigh.length).toBeLessThanOrEqual(100); // Clamped to 100
    });
  });
});
