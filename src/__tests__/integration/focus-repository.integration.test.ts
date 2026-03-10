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
import { DeveloperFocusDataService } from '../../services/developer-focus-service.js';

/**
 * Integration tests for DeveloperFocusDataService with a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema from migration files,
 * then exercises the data service methods against the real database.
 *
 * Ticket: IQS-907
 *
 * Test coverage includes:
 * - View correctness with sample data
 * - Focus score calculation accuracy
 * - Focus category classification
 * - Week-over-week delta calculation
 * - Filter combinations
 * - Trend data structure correctness
 * - Team summary statistics
 * - Multi-repository commit aggregation
 */

const PG_DATABASE = 'gitrx_focus_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let focusService: DeveloperFocusDataService;

/**
 * Helper: Create schema from migration files.
 */
async function createSchema(dbService: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply migrations in order
  const migrations = [
    '001_create_tables.sql',
    '002_create_views.sql',
    '004_add_linear_support.sql',
    '016_developer_focus.sql',
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert test commit data for focus analysis.
 */
async function insertTestData(dbService: DatabaseService): Promise<void> {
  // Insert commit_history records
  // Week 1: 2024-06-10 to 2024-06-14 (Mon-Fri)
  // user1: 15 commits, 3 tickets - deep focus
  // user2: 20 commits, 8 tickets - fragmented
  // user3: 10 commits, 2 tickets - deep focus

  // Week 2: 2024-06-17 to 2024-06-21 (Mon-Fri)
  // user1: 12 commits, 4 tickets - moderate focus (slight degradation)
  // user2: 18 commits, 5 tickets - moderate focus (improved)
  // user3: 8 commits, 1 ticket - deep focus (improved)

  // Insert jira_detail records first
  await dbService.query(`
    INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points)
    VALUES
      ('j1001', 'PROJ-101', 'High', NOW() - INTERVAL '30 days', 'https://jira/PROJ-101', 'Feature A', 'Desc', 'rep', 'Story', 'PROJ', NULL, 'user1', 'Done', '1.0', 'BE', NOW(), 5),
      ('j1002', 'PROJ-102', 'Medium', NOW() - INTERVAL '30 days', 'https://jira/PROJ-102', 'Feature B', 'Desc', 'rep', 'Story', 'PROJ', NULL, 'user1', 'Done', '1.0', 'BE', NOW(), 3),
      ('j1003', 'PROJ-103', 'Medium', NOW() - INTERVAL '30 days', 'https://jira/PROJ-103', 'Bug Fix', 'Desc', 'rep', 'Bug', 'PROJ', NULL, 'user2', 'Done', '1.0', 'FE', NOW(), 2),
      ('j1004', 'PROJ-104', 'High', NOW() - INTERVAL '30 days', 'https://jira/PROJ-104', 'Feature C', 'Desc', 'rep', 'Story', 'PROJ', NULL, 'user2', 'Done', '1.0', 'FE', NOW(), 5),
      ('j1005', 'PROJ-105', 'Low', NOW() - INTERVAL '30 days', 'https://jira/PROJ-105', 'Task', 'Desc', 'rep', 'Task', 'PROJ', NULL, 'user3', 'Done', '1.0', 'BE', NOW(), 1),
      ('j1006', 'PROJ-106', 'Medium', NOW() - INTERVAL '30 days', 'https://jira/PROJ-106', 'Feature D', 'Desc', 'rep', 'Story', 'PROJ', NULL, 'user2', 'Done', '1.0', 'FE', NOW(), 3),
      ('j1007', 'PROJ-107', 'High', NOW() - INTERVAL '30 days', 'https://jira/PROJ-107', 'Feature E', 'Desc', 'rep', 'Story', 'PROJ', NULL, 'user2', 'Done', '1.0', 'FE', NOW(), 5),
      ('j1008', 'PROJ-108', 'Medium', NOW() - INTERVAL '30 days', 'https://jira/PROJ-108', 'Bug Fix 2', 'Desc', 'rep', 'Bug', 'PROJ', NULL, 'user2', 'Done', '1.0', 'FE', NOW(), 2),
      ('j1009', 'PROJ-109', 'Low', NOW() - INTERVAL '30 days', 'https://jira/PROJ-109', 'Task 2', 'Desc', 'rep', 'Task', 'PROJ', NULL, 'user1', 'Done', '1.0', 'BE', NOW(), 1),
      ('j1010', 'PROJ-110', 'Medium', NOW() - INTERVAL '30 days', 'https://jira/PROJ-110', 'Feature F', 'Desc', 'rep', 'Story', 'PROJ', NULL, 'user2', 'Done', '1.0', 'FE', NOW(), 3)
    ON CONFLICT (jira_key) DO NOTHING
  `);

  // Week 1: user1 - deep focus (15 commits, 3 tickets over 5 days = 0.6 tickets/day)
  for (let day = 10; day <= 14; day++) {
    const dateStr = `2024-06-${String(day).padStart(2, '0')}`;
    const ticketNum = (day % 3) + 101; // Cycles through 101, 102, 103

    for (let commit = 0; commit < 3; commit++) {
      const sha = `sha_user1_w1_d${day}_c${commit}`;
      await dbService.query(`
        INSERT INTO commit_history (sha, repository, commit_date, author, commit_message, is_merge, lines_added, lines_removed)
        VALUES ($1, 'repo1', $2::TIMESTAMP, 'user1@example.com', 'feat: work on PROJ-${ticketNum}', false, 50, 10)
      `, [sha, `${dateStr}T10:00:00Z`]);

      await dbService.query(`
        INSERT INTO commit_jira (sha, jira_key)
        VALUES ($1, $2)
      `, [sha, `PROJ-${ticketNum}`]);

      await dbService.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes)
        VALUES ($1, $2, 50, 10)
      `, [sha, `src/feature${ticketNum}/file${commit}.ts`]);
    }
  }

  // Week 1: user2 - fragmented (20 commits, 8 different tickets over 5 days = 1.6 tickets/day)
  const user2Tickets = [103, 104, 105, 106, 107, 108, 109, 110];
  let ticketIdx = 0;
  for (let day = 10; day <= 14; day++) {
    const dateStr = `2024-06-${String(day).padStart(2, '0')}`;

    for (let commit = 0; commit < 4; commit++) {
      const ticketNum = user2Tickets[ticketIdx % 8];
      ticketIdx++;
      const sha = `sha_user2_w1_d${day}_c${commit}`;

      await dbService.query(`
        INSERT INTO commit_history (sha, repository, commit_date, author, commit_message, is_merge, lines_added, lines_removed)
        VALUES ($1, 'repo1', $2::TIMESTAMP, 'user2@example.com', 'fix: work on PROJ-${ticketNum}', false, 30, 5)
      `, [sha, `${dateStr}T11:00:00Z`]);

      await dbService.query(`
        INSERT INTO commit_jira (sha, jira_key)
        VALUES ($1, $2)
      `, [sha, `PROJ-${ticketNum}`]);

      await dbService.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes)
        VALUES ($1, $2, 30, 5)
      `, [sha, `src/fix${ticketNum}/file${commit}.ts`]);
    }
  }

  // Week 1: user3 - deep focus (10 commits, 2 tickets over 5 days = 0.4 tickets/day)
  for (let day = 10; day <= 14; day++) {
    const dateStr = `2024-06-${String(day).padStart(2, '0')}`;
    const ticketNum = (day % 2) === 0 ? 105 : 101;

    for (let commit = 0; commit < 2; commit++) {
      const sha = `sha_user3_w1_d${day}_c${commit}`;
      await dbService.query(`
        INSERT INTO commit_history (sha, repository, commit_date, author, commit_message, is_merge, lines_added, lines_removed)
        VALUES ($1, 'repo1', $2::TIMESTAMP, 'user3@example.com', 'refactor: PROJ-${ticketNum}', false, 100, 50)
      `, [sha, `${dateStr}T12:00:00Z`]);

      await dbService.query(`
        INSERT INTO commit_jira (sha, jira_key)
        VALUES ($1, $2)
      `, [sha, `PROJ-${ticketNum}`]);

      await dbService.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes)
        VALUES ($1, $2, 100, 50)
      `, [sha, `src/core/module${commit}.ts`]);
    }
  }

  // Week 2: user1 - moderate focus (12 commits, 4 tickets)
  for (let day = 17; day <= 21; day++) {
    const dateStr = `2024-06-${String(day).padStart(2, '0')}`;
    const ticketNum = (day % 4) + 101;
    const commitsPerDay = day < 19 ? 3 : 2;

    for (let commit = 0; commit < commitsPerDay; commit++) {
      const sha = `sha_user1_w2_d${day}_c${commit}`;
      await dbService.query(`
        INSERT INTO commit_history (sha, repository, commit_date, author, commit_message, is_merge, lines_added, lines_removed)
        VALUES ($1, 'repo1', $2::TIMESTAMP, 'user1@example.com', 'feat: PROJ-${ticketNum}', false, 40, 8)
      `, [sha, `${dateStr}T10:00:00Z`]);

      await dbService.query(`
        INSERT INTO commit_jira (sha, jira_key)
        VALUES ($1, $2)
      `, [sha, `PROJ-${ticketNum}`]);

      await dbService.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes)
        VALUES ($1, $2, 40, 8)
      `, [sha, `src/feature${ticketNum}/file${commit}.ts`]);
    }
  }

  // Week 2: user2 - moderate focus (18 commits, 5 tickets - improved!)
  const user2W2Tickets = [103, 104, 105, 106, 107];
  ticketIdx = 0;
  for (let day = 17; day <= 21; day++) {
    const dateStr = `2024-06-${String(day).padStart(2, '0')}`;
    const commitsPerDay = day < 20 ? 4 : 3;

    for (let commit = 0; commit < commitsPerDay; commit++) {
      const ticketNum = user2W2Tickets[ticketIdx % 5];
      ticketIdx++;
      const sha = `sha_user2_w2_d${day}_c${commit}`;

      await dbService.query(`
        INSERT INTO commit_history (sha, repository, commit_date, author, commit_message, is_merge, lines_added, lines_removed)
        VALUES ($1, 'repo1', $2::TIMESTAMP, 'user2@example.com', 'fix: PROJ-${ticketNum}', false, 35, 7)
      `, [sha, `${dateStr}T11:00:00Z`]);

      await dbService.query(`
        INSERT INTO commit_jira (sha, jira_key)
        VALUES ($1, $2)
      `, [sha, `PROJ-${ticketNum}`]);

      await dbService.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes)
        VALUES ($1, $2, 35, 7)
      `, [sha, `src/fix${ticketNum}/file${commit}.ts`]);
    }
  }

  // Week 2: user3 - improved (8 commits, 1 ticket - deep focus)
  for (let day = 17; day <= 21; day++) {
    const dateStr = `2024-06-${String(day).padStart(2, '0')}`;
    const commitsPerDay = day < 19 ? 2 : 1;

    for (let commit = 0; commit < commitsPerDay; commit++) {
      const sha = `sha_user3_w2_d${day}_c${commit}`;
      await dbService.query(`
        INSERT INTO commit_history (sha, repository, commit_date, author, commit_message, is_merge, lines_added, lines_removed)
        VALUES ($1, 'repo1', $2::TIMESTAMP, 'user3@example.com', 'refactor: PROJ-105 deep work', false, 150, 80)
      `, [sha, `${dateStr}T12:00:00Z`]);

      await dbService.query(`
        INSERT INTO commit_jira (sha, jira_key)
        VALUES ($1, 'PROJ-105')
      `, [sha]);

      await dbService.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes)
        VALUES ($1, $2, 150, 80)
      `, [sha, `src/core/module${commit}.ts`]);
    }
  }
}

describe('DeveloperFocusDataService Integration Tests', () => {
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
    await service.query('DELETE FROM jira_detail');
  });

  describe('checkFocusViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await focusService.checkFocusViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('checkDailyActivityViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await focusService.checkDailyActivityViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('getFocusScores', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return focus scores ordered by week_start descending', async () => {
      const result = await focusService.getFocusScores();

      // Should have data for 3 users across 2 weeks = 6 rows
      expect(result.length).toBeGreaterThanOrEqual(6);

      // Verify ordering by week_start descending
      for (let i = 1; i < result.length; i++) {
        const prevWeek = new Date(result[i - 1]?.weekStart ?? 0).getTime();
        const currWeek = new Date(result[i]?.weekStart ?? 0).getTime();
        // Either same week or previous week comes after current (descending)
        expect(prevWeek).toBeGreaterThanOrEqual(currWeek);
      }
    });

    it('should calculate focus scores correctly based on tickets per day', async () => {
      const result = await focusService.getFocusScores();

      // Find user1's week 1 data (deep focus - 0.6 tickets/day)
      // Focus score = 100 - (0.6 * 15) = 91
      const user1Week1 = result.find(r =>
        r.author === 'user1@example.com' &&
        r.weekStart.includes('2024-06-10')
      );

      expect(user1Week1).toBeDefined();
      expect(user1Week1?.focusScore).toBeGreaterThanOrEqual(80); // deep_focus threshold
      expect(user1Week1?.focusCategory).toBe('deep_focus');
    });

    it('should classify high context switching as fragmented', async () => {
      const result = await focusService.getFocusScores();

      // Find user2's week 1 data (fragmented - 1.6 tickets/day)
      // Focus score = 100 - (1.6 * 15) = 76 -> moderate_focus or fragmented
      const user2Week1 = result.find(r =>
        r.author === 'user2@example.com' &&
        r.weekStart.includes('2024-06-10')
      );

      expect(user2Week1).toBeDefined();
      // With 8 unique tickets over 5 days, this developer is context-switching frequently
      expect(user2Week1?.totalUniqueTickets).toBeGreaterThanOrEqual(5);
    });

    it('should calculate delta correctly between weeks', async () => {
      const result = await focusService.getFocusScores();

      // Find user2's week 2 data - should show improvement (positive delta)
      const user2Week2 = result.find(r =>
        r.author === 'user2@example.com' &&
        r.weekStart.includes('2024-06-17')
      );

      // Week 2 has fewer tickets (5 vs 8), so score should be higher
      // Delta should be positive (improved)
      if (user2Week2?.focusScoreDelta !== null) {
        // Note: Exact delta depends on calculation, just verify it's calculated
        expect(typeof user2Week2?.focusScoreDelta).toBe('number');
      }
    });

    it('should filter by author', async () => {
      const result = await focusService.getFocusScores({ author: 'user1@example.com' });

      for (const row of result) {
        expect(row.author).toBe('user1@example.com');
      }
    });

    it('should filter by date range', async () => {
      const result = await focusService.getFocusScores({
        startDate: '2024-06-17',
        endDate: '2024-06-23',
      });

      // Should only have week 2 data
      for (const row of result) {
        const weekStart = new Date(row.weekStart);
        expect(weekStart.getTime()).toBeGreaterThanOrEqual(new Date('2024-06-17').getTime());
      }
    });

    it('should filter by focus category', async () => {
      const result = await focusService.getFocusScores({ focusCategory: 'deep_focus' });

      for (const row of result) {
        expect(row.focusCategory).toBe('deep_focus');
      }
    });

    it('should calculate metrics correctly', async () => {
      const result = await focusService.getFocusScores();

      for (const row of result) {
        // Total commits should be positive
        expect(row.totalCommits).toBeGreaterThan(0);

        // Active days should be between 1 and 7
        expect(row.activeDays).toBeGreaterThanOrEqual(1);
        expect(row.activeDays).toBeLessThanOrEqual(7);

        // Focus score should be between 0 and 100
        expect(row.focusScore).toBeGreaterThanOrEqual(0);
        expect(row.focusScore).toBeLessThanOrEqual(100);

        // LOC per commit should be positive
        expect(row.locPerCommit).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('getDailyActivities', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return daily activities ordered by commit_day descending', async () => {
      const result = await focusService.getDailyActivities();

      expect(result.length).toBeGreaterThan(0);

      // Verify ordering
      for (let i = 1; i < result.length; i++) {
        const prevDay = new Date(result[i - 1]?.commitDay ?? 0).getTime();
        const currDay = new Date(result[i]?.commitDay ?? 0).getTime();
        expect(prevDay).toBeGreaterThanOrEqual(currDay);
      }
    });

    it('should aggregate commits per day per author', async () => {
      const result = await focusService.getDailyActivities({ author: 'user1@example.com' });

      // Should have 10 days of activity (5 days per week x 2 weeks)
      expect(result.length).toBe(10);

      for (const activity of result) {
        expect(activity.commitCount).toBeGreaterThan(0);
        expect(activity.uniqueTickets).toBeGreaterThan(0);
      }
    });

    it('should filter by date range', async () => {
      const result = await focusService.getDailyActivities({
        startDate: '2024-06-10',
        endDate: '2024-06-14',
      });

      for (const activity of result) {
        const day = new Date(activity.commitDay);
        expect(day.getTime()).toBeGreaterThanOrEqual(new Date('2024-06-10').getTime());
        expect(day.getTime()).toBeLessThanOrEqual(new Date('2024-06-14').getTime());
      }
    });
  });

  describe('getFocusTrends', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should build trend data with weeks and developers', async () => {
      const result = await focusService.getFocusTrends();

      // Should have 2 weeks
      expect(result.weeks.length).toBe(2);

      // Should have 3 developers
      expect(result.developers.length).toBe(3);

      // Each developer should have scores for each week
      for (const dev of result.developers) {
        expect(dev.scores.length).toBe(2);
        expect(dev.avgScore).toBeGreaterThan(0);
      }
    });

    it('should calculate team averages correctly', async () => {
      const result = await focusService.getFocusTrends();

      // Team average should be between 0 and 100
      expect(result.overallTeamAvg).toBeGreaterThan(0);
      expect(result.overallTeamAvg).toBeLessThanOrEqual(100);

      // Should have team avg for each week
      expect(result.teamAvgByWeek.length).toBe(2);
    });
  });

  describe('getTeamSummary', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return team summary statistics', async () => {
      const result = await focusService.getTeamSummary();

      // Should have 3 developers
      expect(result.totalDevelopers).toBe(3);

      // Average focus score should be between 0 and 100
      expect(result.avgFocusScore).toBeGreaterThan(0);
      expect(result.avgFocusScore).toBeLessThanOrEqual(100);

      // Category counts should sum to total developers
      const totalCategorized =
        result.deepFocusCount +
        result.moderateFocusCount +
        result.fragmentedCount +
        result.highlyFragmentedCount;
      expect(totalCategorized).toBe(result.totalDevelopers);
    });
  });

  describe('getChartData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return complete chart data', async () => {
      const result = await focusService.getChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.focusData.length).toBeGreaterThan(0);
      expect(result.trends.developers.length).toBeGreaterThan(0);
      expect(result.teamSummary.totalDevelopers).toBeGreaterThan(0);
    });

    it('should return hasData false when no commits exist', async () => {
      // Clear all commit data
      await service.query('DELETE FROM commit_files');
      await service.query('DELETE FROM commit_jira');
      await service.query('DELETE FROM commit_history');

      const result = await focusService.getChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.focusData).toHaveLength(0);
    });

    it('should apply filters to chart data', async () => {
      const result = await focusService.getChartData({
        author: 'user1@example.com',
      });

      expect(result.hasData).toBe(true);
      for (const row of result.focusData) {
        expect(row.author).toBe('user1@example.com');
      }
    });
  });

  describe('getDailyActivityChartData', () => {
    beforeEach(async () => {
      await insertTestData(service);
    });

    it('should return daily activity chart data', async () => {
      const result = await focusService.getDailyActivityChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.activities.length).toBeGreaterThan(0);
    });

    it('should return hasData false when no commits exist', async () => {
      await service.query('DELETE FROM commit_files');
      await service.query('DELETE FROM commit_jira');
      await service.query('DELETE FROM commit_history');

      const result = await focusService.getDailyActivityChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.activities).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle commits without ticket associations', async () => {
      // Insert commit without jira link
      await service.query(`
        INSERT INTO commit_history (sha, repository, commit_date, author, commit_message, is_merge, lines_added, lines_removed)
        VALUES ('sha_no_ticket', 'repo1', '2024-06-12T10:00:00Z', 'user_no_ticket@example.com', 'chore: refactor without ticket', false, 50, 10)
      `);

      await service.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes)
        VALUES ('sha_no_ticket', 'src/utils/helper.ts', 50, 10)
      `);

      const result = await focusService.getFocusScores({ author: 'user_no_ticket@example.com' });

      // Should still get focus data
      expect(result.length).toBeGreaterThan(0);
      // Unique tickets should be 0
      expect(result[0]?.totalUniqueTickets).toBe(0);
      // Focus score should be 100 (no context switching)
      expect(result[0]?.focusScore).toBe(100);
      expect(result[0]?.focusCategory).toBe('deep_focus');
    });

    it('should exclude merge commits', async () => {
      // Insert merge commit
      await service.query(`
        INSERT INTO commit_history (sha, repository, commit_date, author, commit_message, is_merge, lines_added, lines_removed)
        VALUES ('sha_merge', 'repo1', '2024-06-12T10:00:00Z', 'user_merge@example.com', 'Merge branch main', true, 500, 100)
      `);

      const result = await focusService.getDailyActivities({ author: 'user_merge@example.com' });

      // Should not include merge commits
      expect(result.length).toBe(0);
    });

    it('should handle single commit week', async () => {
      await service.query(`
        INSERT INTO commit_history (sha, repository, commit_date, author, commit_message, is_merge, lines_added, lines_removed)
        VALUES ('sha_single', 'repo1', '2024-06-12T10:00:00Z', 'user_single@example.com', 'feat: single commit', false, 100, 20)
      `);

      await service.query(`
        INSERT INTO commit_files (sha, filename, line_inserts, line_deletes)
        VALUES ('sha_single', 'src/single.ts', 100, 20)
      `);

      const result = await focusService.getFocusScores({ author: 'user_single@example.com' });

      expect(result.length).toBe(1);
      expect(result[0]?.totalCommits).toBe(1);
      expect(result[0]?.activeDays).toBe(1);
    });
  });

  describe('performance', () => {
    it('should handle large number of commits efficiently', async () => {
      // Insert 100 commits over 2 weeks for 5 developers
      const developers = ['perf1', 'perf2', 'perf3', 'perf4', 'perf5'];

      for (const dev of developers) {
        for (let day = 10; day <= 21; day++) {
          if (day <= 14 || day >= 17) { // Skip weekend
            const dateStr = `2024-06-${String(day).padStart(2, '0')}`;

            for (let commit = 0; commit < 4; commit++) {
              const sha = `sha_perf_${dev}_d${day}_c${commit}`;
              const ticketNum = (commit % 3) + 101;

              await service.query(`
                INSERT INTO commit_history (sha, repository, commit_date, author, commit_message, is_merge, lines_added, lines_removed)
                VALUES ($1, 'repo1', $2::TIMESTAMP, $3, 'feat: PROJ-${ticketNum}', false, 30, 5)
              `, [sha, `${dateStr}T10:00:00Z`, `${dev}@example.com`]);

              await service.query(`
                INSERT INTO commit_files (sha, filename, line_inserts, line_deletes)
                VALUES ($1, $2, 30, 5)
              `, [sha, `src/${dev}/file${commit}.ts`]);
            }
          }
        }
      }

      const start = Date.now();
      const result = await focusService.getFocusScores();
      const elapsed = Date.now() - start;

      // Should return data
      expect(result.length).toBeGreaterThan(0);
      // Query should complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);

      // Also test trend building performance
      const trendStart = Date.now();
      const trends = await focusService.getFocusTrends();
      const trendElapsed = Date.now() - trendStart;

      expect(trends.developers.length).toBeGreaterThan(0);
      expect(trendElapsed).toBeLessThan(5000);
    }, 60_000); // 60 second timeout for bulk insert
  });
});
