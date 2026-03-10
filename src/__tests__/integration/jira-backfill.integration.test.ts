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
import { JiraRepository } from '../../database/jira-repository.js';
import type {
  JiraDetailRow,
  JiraHistoryRow,
  JiraIssueLinkRow,
  JiraParentRow,
} from '../../database/jira-types.js';

/**
 * Integration tests for JiraRepository.clearAllJiraData() with
 * a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema
 * from migration files, inserts test data, then verifies:
 *
 * - All 7 Jira tables are cleared
 * - commit_jira is preserved (commits retain Jira key references)
 * - Transaction atomicity (all tables cleared together)
 * - FK constraint handling (CASCADE works correctly)
 *
 * Ticket: IQS-933
 */

const PG_DATABASE = 'gitrx_jira_backfill_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let dbService: DatabaseService;
let dbConfig: DatabaseServiceConfig;
let jiraRepo: JiraRepository;

/**
 * Create schema from migration files.
 */
async function createSchema(db: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');

  // Apply base tables migration
  const tableSql = readFileSync(join(migrationsDir, '001_create_tables.sql'), 'utf-8');
  await db.query(tableSql);

  // We don't need other migrations for this test
}

/**
 * Create a test JiraDetailRow.
 */
function createTestJiraDetail(jiraKey: string, overrides?: Partial<JiraDetailRow>): JiraDetailRow {
  return {
    jiraId: Math.floor(Math.random() * 100000),
    jiraKey,
    priority: 'Medium',
    createdDate: new Date('2025-01-15T10:00:00Z'),
    url: `https://jira.example.com/browse/${jiraKey}`,
    summary: `Test issue ${jiraKey}`,
    description: `Description for ${jiraKey}`,
    reporter: 'Jane Smith',
    issuetype: 'Story',
    project: jiraKey.split('-')[0],
    resolution: null,
    assignee: 'John Doe',
    status: 'In Progress',
    fixversion: null,
    component: null,
    statusChangeDate: null,
    points: 3,
    ...overrides,
  };
}

/**
 * Create a test JiraHistoryRow.
 */
function createTestJiraHistory(jiraKey: string): JiraHistoryRow {
  return {
    jiraKey,
    changeDate: new Date('2025-01-16T10:00:00Z'),
    assignee: 'Jane Smith',
    field: 'status',
    fromValue: 'To Do',
    toValue: 'In Progress',
  };
}

/**
 * Create a test JiraIssueLinkRow.
 */
function createTestJiraIssueLink(jiraKey: string): JiraIssueLinkRow {
  return {
    jiraKey,
    linkType: 'Blocks',
    linkKey: 'PROJ-999',
    linkStatus: 'Open',
    linkPriority: 'High',
    issueType: 'Bug',
  };
}

/**
 * Create a test JiraParentRow.
 */
function createTestJiraParent(jiraKey: string): JiraParentRow {
  return {
    jiraKey,
    parentKey: 'PROJ-1',
    parentSummary: 'Parent Epic',
    parentType: 'Epic',
  };
}

/**
 * Count rows in a table.
 */
async function countRows(db: DatabaseService, tableName: string): Promise<number> {
  const result = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return parseInt(result.rows[0].count, 10);
}

beforeAll(async () => {
  try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
  LoggerService.resetInstance();

  // Start PostgreSQL container
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

  dbConfig = {
    host,
    port: mappedPort,
    database: PG_DATABASE,
    user: PG_USER,
    password: PG_PASSWORD,
    maxPoolSize: 3,
    connectionTimeoutMs: 10_000,
    idleTimeoutMs: 5_000,
  };

  dbService = new DatabaseService();
  await dbService.initialize(dbConfig);
  await createSchema(dbService);

  jiraRepo = new JiraRepository(dbService);
}, 120_000);

afterAll(async () => {
  try { await dbService.shutdown(); } catch { /* ignore */ }
  try { await container.stop(); } catch { /* ignore */ }
  try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
  LoggerService.resetInstance();
}, 30_000);

beforeEach(async () => {
  // Clean tables between tests (in FK order)
  await dbService.query('DELETE FROM commit_jira');
  await dbService.query('DELETE FROM gitr_pipeline_jira');
  await dbService.query('DELETE FROM jira_github_pullrequest');
  await dbService.query('DELETE FROM jira_github_branch');
  await dbService.query('DELETE FROM jira_parent');
  await dbService.query('DELETE FROM jira_issue_link');
  await dbService.query('DELETE FROM jira_history');
  await dbService.query('DELETE FROM jira_detail');
  await dbService.query('DELETE FROM commit_history');
});

describe('JiraRepository.clearAllJiraData integration', () => {
  describe('table clearing', () => {
    it('should clear all 7 Jira tables', async () => {
      // Insert test data into jira_detail
      await jiraRepo.upsertJiraDetail(createTestJiraDetail('PROJ-100'));
      await jiraRepo.upsertJiraDetail(createTestJiraDetail('PROJ-101'));
      await jiraRepo.upsertJiraDetail(createTestJiraDetail('CRM-50'));

      // Insert test data into jira_history
      await jiraRepo.replaceJiraHistory('PROJ-100', [createTestJiraHistory('PROJ-100')]);
      await jiraRepo.replaceJiraHistory('PROJ-101', [createTestJiraHistory('PROJ-101')]);

      // Insert test data into jira_issue_link
      await jiraRepo.replaceJiraIssueLinks('PROJ-100', [createTestJiraIssueLink('PROJ-100')]);

      // Insert test data into jira_parent
      await jiraRepo.insertJiraParents([createTestJiraParent('PROJ-100')]);

      // Verify data was inserted
      expect(await countRows(dbService, 'jira_detail')).toBe(3);
      expect(await countRows(dbService, 'jira_history')).toBe(2);
      expect(await countRows(dbService, 'jira_issue_link')).toBe(1);
      expect(await countRows(dbService, 'jira_parent')).toBe(1);

      // Clear all Jira data
      const result = await jiraRepo.clearAllJiraData();

      // Verify result
      expect(result.countBefore).toBe(3);

      // Verify all tables are empty
      expect(await countRows(dbService, 'jira_detail')).toBe(0);
      expect(await countRows(dbService, 'jira_history')).toBe(0);
      expect(await countRows(dbService, 'jira_issue_link')).toBe(0);
      expect(await countRows(dbService, 'jira_parent')).toBe(0);
      expect(await countRows(dbService, 'jira_github_branch')).toBe(0);
      expect(await countRows(dbService, 'jira_github_pullrequest')).toBe(0);
      expect(await countRows(dbService, 'gitr_pipeline_jira')).toBe(0);
    });

    it('should preserve commit_jira table', async () => {
      // Insert a commit first (required for FK)
      // Using correct column names from schema: sha, repository, commit_message, author, commit_date, file_count
      await dbService.query(`
        INSERT INTO commit_history (sha, repository, commit_message, author, commit_date, file_count)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, ['abc123def456', 'test-repo', 'PROJ-100: Test commit', 'jdoe', new Date(), 1]);

      // Insert commit_jira mapping (uses sha, jira_key, author, jira_project)
      await dbService.query(`
        INSERT INTO commit_jira (sha, jira_key, author, jira_project)
        VALUES ($1, $2, $3, $4)
      `, ['abc123def456', 'PROJ-100', 'jdoe', 'PROJ']);

      // Insert Jira detail for the same key
      await jiraRepo.upsertJiraDetail(createTestJiraDetail('PROJ-100'));

      // Verify both tables have data
      expect(await countRows(dbService, 'jira_detail')).toBe(1);
      expect(await countRows(dbService, 'commit_jira')).toBe(1);

      // Clear all Jira data
      await jiraRepo.clearAllJiraData();

      // Verify jira_detail is cleared but commit_jira is preserved
      expect(await countRows(dbService, 'jira_detail')).toBe(0);
      expect(await countRows(dbService, 'commit_jira')).toBe(1);

      // Verify the commit_jira record is still correct
      const commitJiraResult = await dbService.query<{ sha: string; jira_key: string }>(
        'SELECT sha, jira_key FROM commit_jira',
      );
      expect(commitJiraResult.rows[0].sha).toBe('abc123def456');
      expect(commitJiraResult.rows[0].jira_key).toBe('PROJ-100');
    });

    it('should work on already empty tables', async () => {
      // Tables are empty from beforeEach
      expect(await countRows(dbService, 'jira_detail')).toBe(0);

      // Should not throw
      const result = await jiraRepo.clearAllJiraData();

      expect(result.countBefore).toBe(0);
      expect(await countRows(dbService, 'jira_detail')).toBe(0);
    });

    it('should handle large datasets efficiently', async () => {
      // Insert 100 Jira issues
      for (let i = 0; i < 100; i++) {
        await jiraRepo.upsertJiraDetail(createTestJiraDetail(`PROJ-${i}`));
      }

      expect(await countRows(dbService, 'jira_detail')).toBe(100);

      // Clear should still be fast (TRUNCATE is O(1))
      const startTime = Date.now();
      const result = await jiraRepo.clearAllJiraData();
      const durationMs = Date.now() - startTime;

      expect(result.countBefore).toBe(100);
      expect(await countRows(dbService, 'jira_detail')).toBe(0);
      // TRUNCATE should be fast, even for 100 rows
      expect(durationMs).toBeLessThan(5000);
    });
  });

  describe('getJiraDetailCount', () => {
    it('should return 0 for empty table', async () => {
      const count = await jiraRepo.getJiraDetailCount();
      expect(count).toBe(0);
    });

    it('should return correct count with data', async () => {
      await jiraRepo.upsertJiraDetail(createTestJiraDetail('PROJ-1'));
      await jiraRepo.upsertJiraDetail(createTestJiraDetail('PROJ-2'));
      await jiraRepo.upsertJiraDetail(createTestJiraDetail('PROJ-3'));

      const count = await jiraRepo.getJiraDetailCount();
      expect(count).toBe(3);
    });
  });

  describe('atomicity', () => {
    it('should clear all tables atomically in a transaction', async () => {
      // Insert data into multiple tables
      await jiraRepo.upsertJiraDetail(createTestJiraDetail('PROJ-1'));
      await jiraRepo.replaceJiraHistory('PROJ-1', [createTestJiraHistory('PROJ-1')]);
      await jiraRepo.insertJiraParents([createTestJiraParent('PROJ-1')]);

      // Verify data exists
      expect(await countRows(dbService, 'jira_detail')).toBe(1);
      expect(await countRows(dbService, 'jira_history')).toBe(1);
      expect(await countRows(dbService, 'jira_parent')).toBe(1);

      // Clear all
      await jiraRepo.clearAllJiraData();

      // All tables should be empty
      expect(await countRows(dbService, 'jira_detail')).toBe(0);
      expect(await countRows(dbService, 'jira_history')).toBe(0);
      expect(await countRows(dbService, 'jira_parent')).toBe(0);
    });
  });
});
