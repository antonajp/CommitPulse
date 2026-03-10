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
import { TicketLifecycleDataService } from '../../services/ticket-lifecycle-service.js';

/**
 * Integration tests for TicketLifecycleDataService with a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema from migration files,
 * then exercises the data service methods against the real database.
 *
 * Ticket: IQS-905
 *
 * Test coverage includes:
 * - View correctness with sample data
 * - Dwell time calculation accuracy
 * - Rework detection correctness
 * - Status category mapping
 * - Filter combinations
 * - Sankey data structure correctness
 * - Both Jira and Linear transitions combined
 */

const PG_DATABASE = 'gitrx_lifecycle_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let service: DatabaseService;
let config: DatabaseServiceConfig;
let lifecycleService: TicketLifecycleDataService;

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
    '015_ticket_lifecycle.sql',
  ];

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
    await dbService.query(sql);
  }
}

/**
 * Helper: Insert test Jira data for lifecycle analysis.
 */
async function insertJiraTestData(dbService: DatabaseService): Promise<void> {
  // Insert jira_detail records
  await dbService.query(`
    INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points)
    VALUES
      ('1001', 'PROJ-101', 'High', NOW() - INTERVAL '30 days', 'https://jira/PROJ-101', 'Feature A', 'Description A', 'reporter1', 'Story', 'PROJ', NULL, 'user1', 'Done', '1.0', 'Backend', NOW() - INTERVAL '1 day', 5),
      ('1002', 'PROJ-102', 'Medium', NOW() - INTERVAL '28 days', 'https://jira/PROJ-102', 'Bug Fix B', 'Description B', 'reporter1', 'Bug', 'PROJ', NULL, 'user2', 'In QA', '1.0', 'Frontend', NOW() - INTERVAL '2 days', 3),
      ('1003', 'PROJ-103', 'Low', NOW() - INTERVAL '25 days', 'https://jira/PROJ-103', 'Task C', 'Description C', 'reporter2', 'Task', 'PROJ', NULL, 'user1', 'In Progress', '1.0', 'Backend', NOW() - INTERVAL '3 days', 2),
      ('1004', 'PROJ-104', 'High', NOW() - INTERVAL '20 days', 'https://jira/PROJ-104', 'Bug D with Rework', 'Description D', 'reporter1', 'Bug', 'PROJ', NULL, 'user3', 'In Progress', '1.0', 'Backend', NOW() - INTERVAL '1 day', 8)
    ON CONFLICT (jira_key) DO NOTHING
  `);

  // Insert jira_history records (status transitions)
  await dbService.query(`
    INSERT INTO jira_history (jira_key, change_date, assignee, field, from_value, to_value)
    VALUES
      -- PROJ-101: Normal forward flow
      ('PROJ-101', NOW() - INTERVAL '29 days', 'user1', 'status', 'Backlog', 'Todo'),
      ('PROJ-101', NOW() - INTERVAL '25 days', 'user1', 'status', 'Todo', 'In Progress'),
      ('PROJ-101', NOW() - INTERVAL '20 days', 'user1', 'status', 'In Progress', 'In Review'),
      ('PROJ-101', NOW() - INTERVAL '15 days', 'user1', 'status', 'In Review', 'In QA'),
      ('PROJ-101', NOW() - INTERVAL '10 days', 'user1', 'status', 'In QA', 'Done'),

      -- PROJ-102: Still in QA
      ('PROJ-102', NOW() - INTERVAL '27 days', 'user2', 'status', 'Backlog', 'In Progress'),
      ('PROJ-102', NOW() - INTERVAL '20 days', 'user2', 'status', 'In Progress', 'In Review'),
      ('PROJ-102', NOW() - INTERVAL '15 days', 'user2', 'status', 'In Review', 'In QA'),

      -- PROJ-103: In Progress
      ('PROJ-103', NOW() - INTERVAL '24 days', 'user1', 'status', 'Backlog', 'Todo'),
      ('PROJ-103', NOW() - INTERVAL '20 days', 'user1', 'status', 'Todo', 'In Progress'),

      -- PROJ-104: Bug with rework (QA -> In Progress -> QA again)
      ('PROJ-104', NOW() - INTERVAL '19 days', 'user3', 'status', 'Backlog', 'In Progress'),
      ('PROJ-104', NOW() - INTERVAL '15 days', 'user3', 'status', 'In Progress', 'In QA'),
      ('PROJ-104', NOW() - INTERVAL '10 days', 'user3', 'status', 'In QA', 'In Progress'),  -- REWORK!
      ('PROJ-104', NOW() - INTERVAL '5 days', 'user3', 'status', 'In Progress', 'In QA'),

      -- Non-status changes (should be filtered out)
      ('PROJ-101', NOW() - INTERVAL '22 days', 'user1', 'assignee', 'user2', 'user1'),
      ('PROJ-102', NOW() - INTERVAL '18 days', 'user2', 'priority', 'Low', 'Medium')
  `);
}

/**
 * Helper: Insert test Linear data for lifecycle analysis.
 */
async function insertLinearTestData(dbService: DatabaseService): Promise<void> {
  // Insert linear_detail records
  await dbService.query(`
    INSERT INTO linear_detail (linear_id, linear_key, priority, created_date, url, title, description, creator, state, assignee, project, team, estimate, status_change_date, completed_date)
    VALUES
      ('lin-1001', 'LIN-101', 'Urgent', NOW() - INTERVAL '15 days', 'https://linear/LIN-101', 'Linear Feature A', 'Description', 'creator1', 'Done', 'user4', 'ProjectX', 'TeamA', 5, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
      ('lin-1002', 'LIN-102', 'High', NOW() - INTERVAL '12 days', 'https://linear/LIN-102', 'Linear Task B', 'Description', 'creator1', 'In Progress', 'user5', 'ProjectX', 'TeamA', 3, NOW() - INTERVAL '1 day', NULL)
    ON CONFLICT (linear_key) DO NOTHING
  `);

  // Insert linear_history records (status transitions)
  await dbService.query(`
    INSERT INTO linear_history (linear_key, change_date, actor, field, from_value, to_value)
    VALUES
      -- LIN-101: Normal flow
      ('LIN-101', NOW() - INTERVAL '14 days', 'user4', 'status', 'Backlog', 'Todo'),
      ('LIN-101', NOW() - INTERVAL '10 days', 'user4', 'status', 'Todo', 'In Progress'),
      ('LIN-101', NOW() - INTERVAL '5 days', 'user4', 'status', 'In Progress', 'In Review'),
      ('LIN-101', NOW() - INTERVAL '2 days', 'user4', 'status', 'In Review', 'Done'),

      -- LIN-102: In Progress
      ('LIN-102', NOW() - INTERVAL '11 days', 'user5', 'status', 'Backlog', 'Todo'),
      ('LIN-102', NOW() - INTERVAL '8 days', 'user5', 'status', 'Todo', 'In Progress')
  `);
}

describe('TicketLifecycleDataService Integration Tests', () => {
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
    lifecycleService = new TicketLifecycleDataService(service);
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
    await service.query('DELETE FROM jira_history');
    await service.query('DELETE FROM linear_history');
    await service.query('DELETE FROM jira_detail');
    await service.query('DELETE FROM linear_detail');
  });

  describe('checkTransitionsViewExists', () => {
    it('should return true when view exists', async () => {
      const exists = await lifecycleService.checkTransitionsViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('checkMatrixViewExists', () => {
    it('should return true when matrix view exists', async () => {
      const exists = await lifecycleService.checkMatrixViewExists();
      expect(exists).toBe(true);
    });
  });

  describe('getTransitions', () => {
    beforeEach(async () => {
      await insertJiraTestData(service);
      await insertLinearTestData(service);
    });

    it('should return transitions ordered by transition_time descending', async () => {
      const result = await lifecycleService.getTransitions();

      // Should have transitions from all test tickets
      expect(result.length).toBeGreaterThanOrEqual(10);

      // Verify ordering by transition_time descending
      for (let i = 1; i < result.length; i++) {
        const prevTime = new Date(result[i - 1]?.transitionTime ?? 0).getTime();
        const currTime = new Date(result[i]?.transitionTime ?? 0).getTime();
        expect(prevTime).toBeGreaterThanOrEqual(currTime);
      }
    });

    it('should include both Jira and Linear transitions', async () => {
      const result = await lifecycleService.getTransitions();

      const jiraTransitions = result.filter(t => t.ticketType === 'jira');
      const linearTransitions = result.filter(t => t.ticketType === 'linear');

      expect(jiraTransitions.length).toBeGreaterThan(0);
      expect(linearTransitions.length).toBeGreaterThan(0);
    });

    it('should calculate dwell time correctly', async () => {
      const result = await lifecycleService.getTransitions();

      // Find a transition that should have dwell time
      const proj101Transitions = result.filter(t => t.ticketId === 'PROJ-101');

      // The second transition for PROJ-101 should have dwell time
      // (time from first transition to second transition)
      const secondTransition = proj101Transitions.find(t =>
        t.fromStatus === 'Todo' && t.toStatus === 'In Progress'
      );

      expect(secondTransition).toBeDefined();
      expect(secondTransition?.dwellHours).not.toBeNull();
      expect(secondTransition?.dwellHours).toBeGreaterThan(0);
    });

    it('should detect rework transitions', async () => {
      const result = await lifecycleService.getTransitions();

      // PROJ-104 has a rework transition: In QA -> In Progress
      const reworkTransitions = result.filter(t => t.isRework === true);

      expect(reworkTransitions.length).toBeGreaterThanOrEqual(1);

      const proj104Rework = reworkTransitions.find(t =>
        t.ticketId === 'PROJ-104' &&
        t.fromStatus === 'In QA' &&
        t.toStatus === 'In Progress'
      );

      expect(proj104Rework).toBeDefined();
      expect(proj104Rework?.isRework).toBe(true);
    });

    it('should assign correct status categories', async () => {
      const result = await lifecycleService.getTransitions();

      // Check backlog category
      const backlogTransition = result.find(t => t.fromStatus === 'Backlog');
      expect(backlogTransition?.fromCategory).toBe('backlog');

      // Check in_progress category
      const progressTransition = result.find(t => t.toStatus === 'In Progress');
      expect(progressTransition?.toCategory).toBe('in_progress');

      // Check review category
      const qaTransition = result.find(t => t.toStatus === 'In QA');
      expect(qaTransition?.toCategory).toBe('review');

      // Check done category
      const doneTransition = result.find(t => t.toStatus === 'Done');
      expect(doneTransition?.toCategory).toBe('done');
    });

    it('should filter by ticket type', async () => {
      const jiraResult = await lifecycleService.getTransitions({ ticketType: 'jira' });
      const linearResult = await lifecycleService.getTransitions({ ticketType: 'linear' });

      for (const t of jiraResult) {
        expect(t.ticketType).toBe('jira');
      }

      for (const t of linearResult) {
        expect(t.ticketType).toBe('linear');
      }
    });

    it('should filter by issue type', async () => {
      const result = await lifecycleService.getTransitions({ issueType: 'Bug' });

      for (const t of result) {
        expect(t.issueType.toLowerCase()).toBe('bug');
      }
    });

    it('should filter by assignee', async () => {
      const result = await lifecycleService.getTransitions({ assignee: 'user1' });

      for (const t of result) {
        expect(t.assignee?.toLowerCase()).toBe('user1');
      }
    });

    it('should filter by date range', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 20);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 5);

      const result = await lifecycleService.getTransitions({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });

      for (const t of result) {
        const transitionDate = new Date(t.transitionTime);
        expect(transitionDate.getTime()).toBeGreaterThanOrEqual(startDate.getTime());
        expect(transitionDate.getTime()).toBeLessThanOrEqual(endDate.getTime());
      }
    });

    it('should exclude non-status field changes', async () => {
      const result = await lifecycleService.getTransitions();

      // Should not have any assignee or priority changes
      for (const t of result) {
        expect(t.fromStatus).not.toBe('user2');
        expect(t.toStatus).not.toBe('user1');
        expect(t.fromStatus).not.toBe('Low');
        expect(t.toStatus).not.toBe('Medium');
      }
    });
  });

  describe('getTransitionMatrix', () => {
    beforeEach(async () => {
      await insertJiraTestData(service);
      await insertLinearTestData(service);
    });

    it('should return aggregated transition counts', async () => {
      const result = await lifecycleService.getTransitionMatrix();

      // Should have aggregated transitions
      expect(result.length).toBeGreaterThan(0);

      // Check structure
      for (const entry of result) {
        expect(entry.fromStatus).toBeDefined();
        expect(entry.toStatus).toBeDefined();
        expect(entry.transitionCount).toBeGreaterThan(0);
      }
    });

    it('should calculate average dwell time', async () => {
      const result = await lifecycleService.getTransitionMatrix();

      // At least some transitions should have dwell time
      const withDwellTime = result.filter(e => e.avgDwellHours !== null);
      expect(withDwellTime.length).toBeGreaterThan(0);
    });

    it('should include rework count', async () => {
      const result = await lifecycleService.getTransitionMatrix();

      // Check for the In QA -> In Progress transition (rework)
      const reworkEntry = result.find(e =>
        e.fromStatus === 'In QA' && e.toStatus === 'In Progress'
      );

      if (reworkEntry) {
        expect(reworkEntry.reworkCount).toBeGreaterThan(0);
      }
    });

    it('should track unique tickets', async () => {
      const result = await lifecycleService.getTransitionMatrix();

      for (const entry of result) {
        expect(entry.uniqueTickets).toBeLessThanOrEqual(entry.transitionCount);
      }
    });
  });

  describe('getSankeyData', () => {
    beforeEach(async () => {
      await insertJiraTestData(service);
      await insertLinearTestData(service);
    });

    it('should build nodes from unique statuses', async () => {
      const result = await lifecycleService.getSankeyData();

      expect(result.nodes.length).toBeGreaterThan(0);

      // Should have nodes for common statuses
      const statusNames = result.nodes.map(n => n.status);
      expect(statusNames).toContain('In Progress');
    });

    it('should build links from transition matrix', async () => {
      const result = await lifecycleService.getSankeyData();

      expect(result.links.length).toBeGreaterThan(0);

      // Each link should have source, target, and count
      for (const link of result.links) {
        expect(link.source).toBeDefined();
        expect(link.target).toBeDefined();
        expect(link.count).toBeGreaterThan(0);
      }
    });

    it('should calculate total tickets', async () => {
      const result = await lifecycleService.getSankeyData();

      expect(result.totalTickets).toBeGreaterThan(0);
    });

    it('should calculate rework percentage', async () => {
      const result = await lifecycleService.getSankeyData();

      // Should have some rework from PROJ-104
      expect(result.totalRework).toBeGreaterThanOrEqual(1);
      expect(result.reworkPct).toBeGreaterThanOrEqual(0);
      expect(result.reworkPct).toBeLessThanOrEqual(100);
    });

    it('should mark rework links', async () => {
      const result = await lifecycleService.getSankeyData();

      // Check for the In QA -> In Progress rework link
      const reworkLink = result.links.find(l =>
        l.source === 'In QA' && l.target === 'In Progress'
      );

      if (reworkLink) {
        expect(reworkLink.isRework).toBe(true);
      }
    });
  });

  describe('getChartData', () => {
    beforeEach(async () => {
      await insertJiraTestData(service);
      await insertLinearTestData(service);
    });

    it('should return chart data with view existence check', async () => {
      const result = await lifecycleService.getChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(true);
      expect(result.sankey.nodes.length).toBeGreaterThan(0);
      expect(result.sankey.links.length).toBeGreaterThan(0);
    });

    it('should return hasData false when no transitions exist', async () => {
      // Clear all data
      await service.query('DELETE FROM jira_history');
      await service.query('DELETE FROM linear_history');

      const result = await lifecycleService.getChartData();

      expect(result.viewExists).toBe(true);
      expect(result.hasData).toBe(false);
      expect(result.sankey.nodes).toHaveLength(0);
    });

    it('should apply filters to Sankey data', async () => {
      const jiraResult = await lifecycleService.getChartData({ ticketType: 'jira' });
      const linearResult = await lifecycleService.getChartData({ ticketType: 'linear' });

      // Both should have data
      expect(jiraResult.hasData).toBe(true);
      expect(linearResult.hasData).toBe(true);

      // Combined total should be greater than either individual filter
      const allResult = await lifecycleService.getChartData();
      expect(allResult.sankey.totalTickets).toBeGreaterThanOrEqual(jiraResult.sankey.totalTickets);
      expect(allResult.sankey.totalTickets).toBeGreaterThanOrEqual(linearResult.sankey.totalTickets);
    });
  });

  describe('edge cases', () => {
    it('should handle empty database', async () => {
      // No data inserted
      const result = await lifecycleService.getTransitions();
      expect(result.length).toBe(0);
    });

    it('should handle single transition per ticket', async () => {
      await service.query(`
        INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points)
        VALUES ('single001', 'SINGLE-001', 'Low', NOW(), 'https://jira/SINGLE-001', 'Single', 'Desc', 'rep', 'Task', 'PROJ', NULL, 'user1', 'Todo', '1.0', 'BE', NOW(), 1)
      `);

      await service.query(`
        INSERT INTO jira_history (jira_key, change_date, assignee, field, from_value, to_value)
        VALUES ('SINGLE-001', NOW(), 'user1', 'status', 'Backlog', 'Todo')
      `);

      const result = await lifecycleService.getTransitions();

      const singleTicket = result.find(t => t.ticketId === 'SINGLE-001');
      expect(singleTicket).toBeDefined();
      expect(singleTicket?.dwellHours).toBeNull(); // First transition has no dwell time
    });

    it('should handle transitions with same from and to status (filtered out)', async () => {
      await service.query(`
        INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points)
        VALUES ('same001', 'SAME-001', 'Low', NOW(), 'https://jira/SAME-001', 'Same', 'Desc', 'rep', 'Task', 'PROJ', NULL, 'user1', 'Todo', '1.0', 'BE', NOW(), 1)
      `);

      await service.query(`
        INSERT INTO jira_history (jira_key, change_date, assignee, field, from_value, to_value)
        VALUES ('SAME-001', NOW(), 'user1', 'status', 'Todo', 'Todo')
      `);

      const result = await lifecycleService.getTransitions();

      // Should not include transitions where from == to
      const sameTicket = result.find(t => t.ticketId === 'SAME-001');
      expect(sameTicket).toBeUndefined();
    });

    it('should handle unknown statuses (not in status_order)', async () => {
      await service.query(`
        INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points)
        VALUES ('custom001', 'CUSTOM-001', 'Low', NOW(), 'https://jira/CUSTOM-001', 'Custom', 'Desc', 'rep', 'Task', 'PROJ', NULL, 'user1', 'CustomStatus', '1.0', 'BE', NOW(), 1)
      `);

      await service.query(`
        INSERT INTO jira_history (jira_key, change_date, assignee, field, from_value, to_value)
        VALUES ('CUSTOM-001', NOW(), 'user1', 'status', 'MyCustom', 'AnotherCustom')
      `);

      const result = await lifecycleService.getTransitions();

      const customTicket = result.find(t => t.ticketId === 'CUSTOM-001');
      expect(customTicket).toBeDefined();
      expect(customTicket?.fromCategory).toBe('unknown');
      expect(customTicket?.toCategory).toBe('unknown');
      expect(customTicket?.isRework).toBe(false); // Can't determine rework without ordinal
    });
  });

  describe('performance', () => {
    it('should handle large number of transitions efficiently', async () => {
      // Insert 50 tickets with 5 transitions each
      for (let ticketIdx = 0; ticketIdx < 50; ticketIdx++) {
        const jiraKey = `PERF-${String(ticketIdx).padStart(4, '0')}`;
        const assignee = `user${(ticketIdx % 5) + 1}`;

        await service.query(`
          INSERT INTO jira_detail (jira_id, jira_key, priority, created_date, url, summary, description, reporter, issuetype, project, resolution, assignee, status, fixversion, component, status_change_date, points)
          VALUES ($1, $2, 'Medium', NOW() - INTERVAL '30 days', $3, 'Perf Test', 'Desc', 'reporter', 'Story', 'PROJ', NULL, $4, 'Done', '1.0', 'BE', NOW(), 3)
        `, [`perf${ticketIdx}`, jiraKey, `https://jira/${jiraKey}`, assignee]);

        const statuses = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done'];
        for (let statusIdx = 0; statusIdx < statuses.length - 1; statusIdx++) {
          await service.query(`
            INSERT INTO jira_history (jira_key, change_date, assignee, field, from_value, to_value)
            VALUES ($1, NOW() - INTERVAL '${30 - (ticketIdx + statusIdx * 2)} days', $2, 'status', $3, $4)
          `, [jiraKey, assignee, statuses[statusIdx], statuses[statusIdx + 1]]);
        }
      }

      const start = Date.now();
      const result = await lifecycleService.getTransitions();
      const elapsed = Date.now() - start;

      // Should return data
      expect(result.length).toBeGreaterThan(0);
      // Query should complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);

      // Also test Sankey building performance
      const sankeyStart = Date.now();
      const sankey = await lifecycleService.getSankeyData();
      const sankeyElapsed = Date.now() - sankeyStart;

      expect(sankey.nodes.length).toBeGreaterThan(0);
      expect(sankeyElapsed).toBeLessThan(5000);
    }, 60_000); // 60 second timeout for bulk insert
  });
});
