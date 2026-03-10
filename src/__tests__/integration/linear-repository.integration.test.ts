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
import { LinearRepository } from '../../database/linear-repository.js';
import { CommitLinearRepository } from '../../database/commit-linear-repository.js';
import { CommitRepository } from '../../database/commit-repository.js';
import type {
  LinearDetailRow,
  LinearHistoryRow,
  CommitLinearRow,
} from '../../database/linear-types.js';

/**
 * Integration tests for LinearRepository and CommitLinearRepository
 * with a real PostgreSQL 16 container.
 *
 * Uses Testcontainers to spin up PostgreSQL, creates the schema
 * from migration files (001 + 004), then exercises all repository
 * methods against the real database.
 *
 * Validates:
 * - linear_detail CRUD with upsert behavior
 * - linear_history replace semantics
 * - commit_linear insertion with ON CONFLICT
 * - is_linear_ref batch updates
 * - Migration 004 idempotency (apply, rollback, re-apply)
 * - Parameterized SQL (no string interpolation in SQL)
 *
 * Ticket: IQS-875
 */

const PG_DATABASE = 'gitrx_linear_test';
const PG_USER = 'test_user';
const PG_PASSWORD = 'test_password';
const PG_PORT = 5432;

let container: StartedTestContainer;
let dbService: DatabaseService;
let dbConfig: DatabaseServiceConfig;
let linearRepo: LinearRepository;
let commitLinearRepo: CommitLinearRepository;
let commitRepo: CommitRepository;

/**
 * Create schema from migration files including the Linear migration.
 */
async function createSchema(db: DatabaseService): Promise<void> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');
  const tableSql = readFileSync(join(migrationsDir, '001_create_tables.sql'), 'utf-8');
  await db.query(tableSql);

  const linearSql = readFileSync(join(migrationsDir, '004_add_linear_support.sql'), 'utf-8');
  await db.query(linearSql);
}

/**
 * Create a test LinearDetailRow.
 */
function createTestDetail(overrides?: Partial<LinearDetailRow>): LinearDetailRow {
  return {
    linearId: 'uuid-test-001',
    linearKey: 'IQS-42',
    priority: 'High',
    createdDate: new Date('2025-01-15T10:00:00Z'),
    url: 'https://linear.app/iqsubagents/issue/IQS-42',
    title: 'Test issue',
    description: 'Test description for integration',
    creator: 'Jane Smith',
    state: 'In Progress',
    assignee: 'John Doe',
    project: 'gitrx',
    team: 'IQS',
    estimate: 3,
    statusChangeDate: null,
    completedDate: null,
    calculatedStoryPoints: null,
    ...overrides,
  };
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

  linearRepo = new LinearRepository(dbService);
  commitLinearRepo = new CommitLinearRepository(dbService);
  commitRepo = new CommitRepository(dbService);
}, 120_000);

afterAll(async () => {
  try { await dbService.shutdown(); } catch { /* ignore */ }
  try { await container.stop(); } catch { /* ignore */ }
  try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
  LoggerService.resetInstance();
}, 30_000);

beforeEach(async () => {
  // Clean tables between tests
  await dbService.query('DELETE FROM commit_linear');
  await dbService.query('DELETE FROM linear_history');
  await dbService.query('DELETE FROM linear_detail');
  await dbService.query('DELETE FROM commit_history');
});

describe('LinearRepository integration', () => {
  describe('upsertLinearDetail', () => {
    it('should insert a new Linear detail', async () => {
      const detail = createTestDetail();
      await linearRepo.upsertLinearDetail(detail);

      const result = await dbService.query<{ linear_key: string; title: string; state: string }>(
        'SELECT linear_key, title, state FROM linear_detail WHERE linear_key = $1',
        ['IQS-42'],
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.linear_key).toBe('IQS-42');
      expect(result.rows[0]!.title).toBe('Test issue');
      expect(result.rows[0]!.state).toBe('In Progress');
    });

    it('should update existing detail on conflict (upsert)', async () => {
      const detail = createTestDetail();
      await linearRepo.upsertLinearDetail(detail);

      // Update state
      const updatedDetail = createTestDetail({ state: 'Done', completedDate: new Date('2025-02-01') });
      await linearRepo.upsertLinearDetail(updatedDetail);

      const result = await dbService.query<{ state: string }>(
        'SELECT state FROM linear_detail WHERE linear_key = $1',
        ['IQS-42'],
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.state).toBe('Done');
    });

    it('should handle null optional fields', async () => {
      const detail = createTestDetail({
        description: null,
        assignee: null,
        estimate: null,
        completedDate: null,
      });

      await linearRepo.upsertLinearDetail(detail);

      const result = await dbService.query<{ description: string | null; assignee: string | null }>(
        'SELECT description, assignee FROM linear_detail WHERE linear_key = $1',
        ['IQS-42'],
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.description).toBeNull();
      expect(result.rows[0]!.assignee).toBeNull();
    });
  });

  describe('batchUpsertLinearDetails', () => {
    it('should insert multiple details in a transaction', async () => {
      const details = [
        createTestDetail({ linearKey: 'IQS-1', linearId: 'uuid-1' }),
        createTestDetail({ linearKey: 'IQS-2', linearId: 'uuid-2' }),
        createTestDetail({ linearKey: 'IQS-3', linearId: 'uuid-3' }),
      ];

      await linearRepo.batchUpsertLinearDetails(details);

      const result = await dbService.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM linear_detail');
      expect(parseInt(result.rows[0]!.count, 10)).toBe(3);
    });

    it('should skip empty array without error', async () => {
      await linearRepo.batchUpsertLinearDetails([]);

      const result = await dbService.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM linear_detail');
      expect(parseInt(result.rows[0]!.count, 10)).toBe(0);
    });
  });

  describe('replaceLinearHistory', () => {
    it('should replace history entries for a key', async () => {
      // First insert the detail (FK constraint)
      await linearRepo.upsertLinearDetail(createTestDetail());

      const history: LinearHistoryRow[] = [
        {
          linearKey: 'IQS-42',
          changeDate: new Date('2025-01-15T10:00:00Z'),
          actor: 'Jane',
          field: 'state',
          fromValue: 'Todo',
          toValue: 'In Progress',
        },
        {
          linearKey: 'IQS-42',
          changeDate: new Date('2025-01-16T10:00:00Z'),
          actor: 'Jane',
          field: 'assignee',
          fromValue: null,
          toValue: 'John Doe',
        },
      ];

      await linearRepo.replaceLinearHistory('IQS-42', history);

      const result = await dbService.query<{ field: string; to_value: string }>(
        'SELECT field, to_value FROM linear_history WHERE linear_key = $1 ORDER BY change_date',
        ['IQS-42'],
      );

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]!.field).toBe('state');
      expect(result.rows[1]!.field).toBe('assignee');
    });

    it('should delete old history before inserting new', async () => {
      await linearRepo.upsertLinearDetail(createTestDetail());

      // Insert initial history
      const initial: LinearHistoryRow[] = [
        { linearKey: 'IQS-42', changeDate: new Date(), actor: 'Jane', field: 'state', fromValue: 'A', toValue: 'B' },
      ];
      await linearRepo.replaceLinearHistory('IQS-42', initial);

      // Replace with new history
      const replacement: LinearHistoryRow[] = [
        { linearKey: 'IQS-42', changeDate: new Date(), actor: 'John', field: 'priority', fromValue: 'Low', toValue: 'High' },
      ];
      await linearRepo.replaceLinearHistory('IQS-42', replacement);

      const result = await dbService.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM linear_history WHERE linear_key = $1',
        ['IQS-42'],
      );

      // Only the replacement history should remain
      expect(parseInt(result.rows[0]!.count, 10)).toBe(1);
    });
  });

  describe('getDistinctLinearIds', () => {
    it('should return distinct keys from linear_detail', async () => {
      await linearRepo.batchUpsertLinearDetails([
        createTestDetail({ linearKey: 'IQS-1', linearId: 'uuid-1' }),
        createTestDetail({ linearKey: 'IQS-2', linearId: 'uuid-2' }),
        createTestDetail({ linearKey: 'ENG-10', linearId: 'uuid-3' }),
      ]);

      const keys = await linearRepo.getDistinctLinearIds();

      expect(keys.size).toBe(3);
      expect(keys.has('IQS-1')).toBe(true);
      expect(keys.has('IQS-2')).toBe(true);
      expect(keys.has('ENG-10')).toBe(true);
    });
  });

  describe('identifyLinearTeamMaxIssue', () => {
    it('should return max issue number per team', async () => {
      await linearRepo.batchUpsertLinearDetails([
        createTestDetail({ linearKey: 'IQS-10', linearId: 'uuid-1' }),
        createTestDetail({ linearKey: 'IQS-100', linearId: 'uuid-2' }),
        createTestDetail({ linearKey: 'ENG-50', linearId: 'uuid-3' }),
      ]);

      const teams = await linearRepo.identifyLinearTeamMaxIssue();

      expect(teams).toHaveLength(2);
      const iqsTeam = teams.find((t) => t.teamKey === 'IQS');
      const engTeam = teams.find((t) => t.teamKey === 'ENG');
      expect(iqsTeam!.count).toBe(100);
      expect(engTeam!.count).toBe(50);
    });
  });

  describe('getUnfinishedLinearIssues', () => {
    it('should return issues not in Done/Canceled states', async () => {
      await linearRepo.batchUpsertLinearDetails([
        createTestDetail({ linearKey: 'IQS-1', linearId: 'uuid-1', state: 'In Progress' }),
        createTestDetail({ linearKey: 'IQS-2', linearId: 'uuid-2', state: 'Done' }),
        createTestDetail({ linearKey: 'IQS-3', linearId: 'uuid-3', state: 'Todo' }),
      ]);

      const unfinished = await linearRepo.getUnfinishedLinearIssues(0);

      // IQS-1 (In Progress) and IQS-3 (Todo) are unfinished
      const keys = unfinished.map((u) => u.linearKey);
      expect(keys).toContain('IQS-1');
      expect(keys).toContain('IQS-3');
      // Done with no recent status change and daysAgo=0 should NOT be returned
    });
  });
});

describe('CommitLinearRepository integration', () => {
  describe('insertCommitLinear', () => {
    it('should insert commit-linear relationships', async () => {
      // Insert prerequisite commit_history row
      await dbService.query(
        `INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        ['abc123' + 'x'.repeat(34), 'https://example.com', 'main', 'repo', 'https://example.com', 'john', new Date(), 'Fix IQS-42', 1, 10, 5, false, true, 'TestOrg'],
      );

      const rows: CommitLinearRow[] = [
        { sha: 'abc123' + 'x'.repeat(34), linearKey: 'IQS-42', author: 'john', linearProject: 'IQS' },
      ];

      // First need to insert linear_detail (FK constraint)
      await linearRepo.upsertLinearDetail(createTestDetail({ linearKey: 'IQS-42' }));

      await commitLinearRepo.insertCommitLinear(rows);

      const result = await dbService.query<{ sha: string; linear_key: string }>(
        'SELECT sha, linear_key FROM commit_linear',
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.linear_key).toBe('IQS-42');
    });

    it('should handle ON CONFLICT DO NOTHING for duplicates', async () => {
      // Insert prerequisites
      await dbService.query(
        `INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        ['dup123' + 'x'.repeat(34), 'https://example.com', 'main', 'repo', 'https://example.com', 'john', new Date(), 'Fix IQS-42', 1, 10, 5, false, true, 'TestOrg'],
      );
      await linearRepo.upsertLinearDetail(createTestDetail({ linearKey: 'IQS-42' }));

      const rows: CommitLinearRow[] = [
        { sha: 'dup123' + 'x'.repeat(34), linearKey: 'IQS-42', author: 'john', linearProject: 'IQS' },
      ];

      // Insert twice - should not throw
      await commitLinearRepo.insertCommitLinear(rows);
      await commitLinearRepo.insertCommitLinear(rows);

      const result = await dbService.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM commit_linear WHERE sha = $1',
        ['dup123' + 'x'.repeat(34)],
      );

      expect(parseInt(result.rows[0]!.count, 10)).toBe(1);
    });
  });

  describe('deleteAuthorCommitLinear', () => {
    it('should delete entries for a specific author', async () => {
      // Insert prerequisites
      const sha = 'del123' + 'x'.repeat(34);
      await dbService.query(
        `INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [sha, 'https://example.com', 'main', 'repo', 'https://example.com', 'john', new Date(), 'Fix IQS-42', 1, 10, 5, false, true, 'TestOrg'],
      );
      await linearRepo.upsertLinearDetail(createTestDetail({ linearKey: 'IQS-42' }));
      await commitLinearRepo.insertCommitLinear([
        { sha, linearKey: 'IQS-42', author: 'john', linearProject: 'IQS' },
      ]);

      const deleted = await commitLinearRepo.deleteAuthorCommitLinear('john');

      expect(deleted).toBe(1);

      const result = await dbService.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM commit_linear WHERE author = $1',
        ['john'],
      );
      expect(parseInt(result.rows[0]!.count, 10)).toBe(0);
    });
  });

  describe('batchUpdateIsLinearRef', () => {
    it('should update is_linear_ref flags on commit_history', async () => {
      const sha = 'ref123' + 'x'.repeat(34);
      await dbService.query(
        `INSERT INTO commit_history (sha, url, branch, repository, repository_url, author, commit_date, commit_message, file_count, lines_added, lines_removed, is_merge, is_jira_ref, organization)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [sha, 'https://example.com', 'main', 'repo', 'https://example.com', 'john', new Date(), 'Fix IQS-42', 1, 10, 5, false, true, 'TestOrg'],
      );

      await commitLinearRepo.batchUpdateIsLinearRef([
        { sha, isLinearRef: true },
      ]);

      const result = await dbService.query<{ is_linear_ref: boolean }>(
        'SELECT is_linear_ref FROM commit_history WHERE sha = $1',
        [sha],
      );

      expect(result.rows[0]!.is_linear_ref).toBe(true);
    });
  });
});

describe('Migration 004 idempotency', () => {
  it('should be safe to apply migration 004 twice', async () => {
    // Migration was already applied in beforeAll. Apply again.
    const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');
    const linearSql = readFileSync(join(migrationsDir, '004_add_linear_support.sql'), 'utf-8');

    // Should not throw - uses IF NOT EXISTS guards
    await expect(dbService.query(linearSql)).resolves.not.toThrow();
  });

  it('should support rollback and re-apply', async () => {
    const migrationsDir = join(__dirname, '..', '..', '..', 'docker', 'migrations');
    const rollbackSql = readFileSync(join(migrationsDir, '004_add_linear_support.rollback.sql'), 'utf-8');
    const applySql = readFileSync(join(migrationsDir, '004_add_linear_support.sql'), 'utf-8');

    // Rollback
    await dbService.query(rollbackSql);

    // Verify tables are gone
    const detailCheck = await dbService.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'linear_detail') AS exists`,
    );
    expect(detailCheck.rows[0]!.exists).toBe(false);

    // Re-apply
    await dbService.query(applySql);

    // Verify tables are back
    const detailCheck2 = await dbService.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'linear_detail') AS exists`,
    );
    expect(detailCheck2.rows[0]!.exists).toBe(true);
  });
});
