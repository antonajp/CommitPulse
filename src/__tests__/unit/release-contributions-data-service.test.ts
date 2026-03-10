import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * ACCEPTANCE TEST SPECIFICATION: Release Management Contributions Chart
 *
 * Feature: Grouped bar chart showing merge commits per team member by environment
 * Ticket: TBD
 *
 * **ACCEPTANCE CRITERIA:**
 *
 * 1. [ ] Chart displays merge commits grouped by contributor (author + full_name)
 * 2. [ ] Merge commits are categorized by environment:
 *    - Production: branches matching 'main', 'master', or custom production patterns
 *    - Staging/Dev: branches matching 'develop', 'staging', or custom staging patterns
 * 3. [ ] Default time range is 30 days (configurable via filters)
 * 4. [ ] Branch pattern matching is configurable via VS Code settings
 * 5. [ ] Chart handles edge cases gracefully:
 *    - No merge commits in the period → displays "No data" message
 *    - Single contributor → displays one grouped bar
 *    - 20+ contributors → displays top N with expansion control
 * 6. [ ] Data aggregation is accurate:
 *    - Only merge commits (is_merge = TRUE) are counted
 *    - Commits are deduplicated by SHA
 *    - Contributors with no name show as "Unknown (email)"
 * 7. [ ] Chart respects VS Code theme (light/dark mode)
 * 8. [ ] SQL queries use parameterized values (CWE-89 prevention)
 * 9. [ ] Input validation prevents SQL injection and length overflow
 * 10. [ ] Chart loads in < 500ms with 1000 merge commits
 *
 * **TEST STRATEGY:**
 * - Unit tests: Data service with mock database (this file)
 * - Integration tests: Real PostgreSQL via Testcontainers
 * - Visual tests: Manual verification of chart rendering in light/dark themes
 * - Performance tests: Query execution time with 1000+ rows
 */

/**
 * Mock implementation of ReleaseContributionsDataService
 * (To be implemented in src/services/release-contributions-data-service.ts)
 */
class ReleaseContributionsDataService {
  constructor(private db: DatabaseService) {}

  /**
   * Fetch merge commits grouped by contributor and environment.
   *
   * @param options - Filter options
   * @param options.startDate - ISO date string (default: 30 days ago)
   * @param options.endDate - ISO date string (default: now)
   * @param options.repository - Optional repository filter
   * @param options.productionPatterns - Branch patterns for production (default: ['main', 'master'])
   * @param options.stagingPatterns - Branch patterns for staging (default: ['develop', 'staging'])
   * @returns Array of merge commit counts per contributor per environment
   */
  async getReleaseContributions(options?: {
    startDate?: string;
    endDate?: string;
    repository?: string;
    productionPatterns?: string[];
    stagingPatterns?: string[];
  }): Promise<ReleaseContribution[]> {
    // Input validation: date format (CWE-20)
    if (options?.startDate && !this.isValidISODate(options.startDate)) {
      throw new Error('Invalid startDate format. Expected ISO 8601 date string.');
    }
    if (options?.endDate && !this.isValidISODate(options.endDate)) {
      throw new Error('Invalid endDate format. Expected ISO 8601 date string.');
    }

    // Input validation: date range logic
    if (options?.startDate && options?.endDate) {
      const start = new Date(options.startDate);
      const end = new Date(options.endDate);
      if (start > end) {
        throw new Error('Invalid date range: startDate must be before endDate');
      }
    }

    // Input validation: repository length (CWE-20)
    if (options?.repository && options.repository.length > 200) {
      throw new Error('Repository filter exceeds maximum length of 200 characters');
    }

    // Input validation: pattern arrays
    if (options?.productionPatterns && options.productionPatterns.length > 50) {
      throw new Error('Too many production branch patterns (max 50)');
    }
    if (options?.stagingPatterns && options.stagingPatterns.length > 50) {
      throw new Error('Too many staging branch patterns (max 50)');
    }

    // Build parameterized query
    const productionPatterns = options?.productionPatterns ?? ['main', 'master'];
    const stagingPatterns = options?.stagingPatterns ?? ['develop', 'staging'];

    const query = `
      WITH merge_commits AS (
        SELECT
          ch.sha,
          ch.commit_date,
          ch.author,
          cc.full_name,
          cc.team,
          ch.repository,
          cbr.branch,
          CASE
            WHEN cbr.branch = ANY($1::TEXT[]) THEN 'Production'
            WHEN cbr.branch = ANY($2::TEXT[]) THEN 'Staging'
            ELSE 'Other'
          END AS environment
        FROM commit_history ch
        LEFT JOIN commit_contributors cc ON ch.author = cc.email
        LEFT JOIN commit_branch_relationship cbr ON ch.sha = cbr.sha
        WHERE ch.is_merge = TRUE
          AND ch.commit_date >= $3
          AND ch.commit_date <= $4
          AND ($5::TEXT IS NULL OR ch.repository = $5)
      )
      SELECT
        author,
        COALESCE(full_name, 'Unknown (' || author || ')') AS full_name,
        team,
        environment,
        COUNT(DISTINCT sha)::INT AS merge_count
      FROM merge_commits
      WHERE environment IN ('Production', 'Staging')
      GROUP BY author, full_name, team, environment
      ORDER BY full_name, environment
      LIMIT 1000
    `;

    const params = [
      productionPatterns,
      stagingPatterns,
      options?.startDate ?? this.getDefaultStartDate(),
      options?.endDate ?? this.getDefaultEndDate(),
      options?.repository ?? null,
    ];

    const result = await this.db.query<ReleaseContributionRow>(query, params);
    return result.rows.map(row => ({
      author: row.author,
      fullName: row.full_name,
      team: row.team ?? 'No Team',
      environment: row.environment as 'Production' | 'Staging',
      mergeCount: row.merge_count,
    }));
  }

  private isValidISODate(dateStr: string): boolean {
    const isoPattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;
    if (!isoPattern.test(dateStr)) {
      return false;
    }
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  }

  private getDefaultStartDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString();
  }

  private getDefaultEndDate(): string {
    return new Date().toISOString();
  }
}

interface ReleaseContributionRow {
  author: string;
  full_name: string;
  team: string | null;
  environment: string;
  merge_count: number;
}

interface ReleaseContribution {
  author: string;
  fullName: string;
  team: string;
  environment: 'Production' | 'Staging';
  mergeCount: number;
}

/**
 * Unit tests for ReleaseContributionsDataService
 * Pattern follows dashboard-data-service.test.ts
 */
describe('ReleaseContributionsDataService', () => {
  let mockDb: DatabaseService;
  let service: ReleaseContributionsDataService;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockResolvedValue(true),
    } as unknown as DatabaseService;

    service = new ReleaseContributionsDataService(mockDb);
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  // ==========================================================================
  // HAPPY PATH: Chart displays with correct data
  // ==========================================================================
  describe('getReleaseContributions (happy path)', () => {
    it('should return empty array when no merge commits in period', async () => {
      const result = await service.getReleaseContributions();
      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should return merge commits grouped by contributor and environment', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { author: 'alice@example.com', full_name: 'Alice Smith', team: 'Platform', environment: 'Production', merge_count: 5 },
          { author: 'alice@example.com', full_name: 'Alice Smith', team: 'Platform', environment: 'Staging', merge_count: 8 },
          { author: 'bob@example.com', full_name: 'Bob Jones', team: 'Frontend', environment: 'Production', merge_count: 3 },
        ],
        rowCount: 3,
      });

      const result = await service.getReleaseContributions();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        author: 'alice@example.com',
        fullName: 'Alice Smith',
        team: 'Platform',
        environment: 'Production',
        mergeCount: 5,
      });
      expect(result[1]).toEqual({
        author: 'alice@example.com',
        fullName: 'Alice Smith',
        team: 'Platform',
        environment: 'Staging',
        mergeCount: 8,
      });
      expect(result[2]).toEqual({
        author: 'bob@example.com',
        fullName: 'Bob Jones',
        team: 'Frontend',
        environment: 'Production',
        mergeCount: 3,
      });
    });

    it('should use parameterized queries (CWE-89 prevention)', async () => {
      await service.getReleaseContributions({
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        repository: 'my-app',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      expect(call).toBeDefined();
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      // Verify parameterized placeholders
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('$3');
      expect(sql).toContain('$4');
      expect(sql).toContain('$5');

      // Verify default branch patterns are passed as array parameters
      expect(params[0]).toEqual(['main', 'master']); // production patterns
      expect(params[1]).toEqual(['develop', 'staging']); // staging patterns
      expect(params[2]).toBe('2025-01-01');
      expect(params[3]).toBe('2025-01-31');
      expect(params[4]).toBe('my-app');
    });

    it('should use custom branch patterns when provided', async () => {
      await service.getReleaseContributions({
        productionPatterns: ['prod', 'release'],
        stagingPatterns: ['dev', 'test'],
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];

      expect(params[0]).toEqual(['prod', 'release']);
      expect(params[1]).toEqual(['dev', 'test']);
    });
  });

  // ==========================================================================
  // EDGE CASE: Single contributor
  // ==========================================================================
  describe('getReleaseContributions (single contributor)', () => {
    it('should handle single contributor with multiple environments', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { author: 'alice@example.com', full_name: 'Alice Smith', team: 'Platform', environment: 'Production', merge_count: 2 },
          { author: 'alice@example.com', full_name: 'Alice Smith', team: 'Platform', environment: 'Staging', merge_count: 5 },
        ],
        rowCount: 2,
      });

      const result = await service.getReleaseContributions();

      expect(result).toHaveLength(2);
      expect(result[0]?.fullName).toBe('Alice Smith');
      expect(result[1]?.fullName).toBe('Alice Smith');
    });
  });

  // ==========================================================================
  // EDGE CASE: Many contributors (20+)
  // ==========================================================================
  describe('getReleaseContributions (many contributors)', () => {
    it('should limit results to 1000 rows to prevent memory exhaustion', async () => {
      const rows = Array.from({ length: 1000 }, (_, i) => ({
        author: `dev${i}@example.com`,
        full_name: `Developer ${i}`,
        team: 'Engineering',
        environment: i % 2 === 0 ? 'Production' : 'Staging',
        merge_count: Math.floor(Math.random() * 10) + 1,
      }));

      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows,
        rowCount: 1000,
      });

      const result = await service.getReleaseContributions();

      expect(result).toHaveLength(1000);

      // Verify LIMIT clause exists in query
      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      expect(sql).toContain('LIMIT 1000');
    });
  });

  // ==========================================================================
  // EDGE CASE: Contributors without full_name
  // ==========================================================================
  describe('getReleaseContributions (unknown contributors)', () => {
    it('should display "Unknown (email)" for contributors without full_name', async () => {
      vi.mocked(mockDb.query).mockResolvedValueOnce({
        rows: [
          { author: 'bot@example.com', full_name: 'Unknown (bot@example.com)', team: null, environment: 'Production', merge_count: 10 },
        ],
        rowCount: 1,
      });

      const result = await service.getReleaseContributions();

      expect(result[0]?.fullName).toBe('Unknown (bot@example.com)');
      expect(result[0]?.team).toBe('No Team');
    });
  });

  // ==========================================================================
  // EDGE CASE: Default 30-day time range
  // ==========================================================================
  describe('getReleaseContributions (default time range)', () => {
    it('should default to 30 days when no dates provided', async () => {
      const beforeCall = new Date();
      await service.getReleaseContributions();
      const afterCall = new Date();

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];

      const startDate = new Date(params[2] as string);
      const endDate = new Date(params[3] as string);

      // Start date should be approximately 30 days before end date
      const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThanOrEqual(29.9);
      expect(daysDiff).toBeLessThanOrEqual(30.1);

      // End date should be approximately now
      expect(endDate.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime() - 1000);
      expect(endDate.getTime()).toBeLessThanOrEqual(afterCall.getTime() + 1000);
    });
  });

  // ==========================================================================
  // INPUT VALIDATION: Date format (CWE-20)
  // ==========================================================================
  describe('input validation (date format)', () => {
    it('should reject invalid startDate format', async () => {
      await expect(service.getReleaseContributions({
        startDate: 'not-a-date',
      })).rejects.toThrow('Invalid startDate format');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should reject invalid endDate format', async () => {
      await expect(service.getReleaseContributions({
        endDate: '2025-13-45', // Invalid month/day
      })).rejects.toThrow('Invalid endDate format');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should accept valid ISO 8601 date strings', async () => {
      await service.getReleaseContributions({
        startDate: '2025-01-01',
        endDate: '2025-01-31T23:59:59.999Z',
      });
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('should reject reversed date range (startDate > endDate)', async () => {
      await expect(service.getReleaseContributions({
        startDate: '2025-12-31',
        endDate: '2025-01-01',
      })).rejects.toThrow('Invalid date range');
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // INPUT VALIDATION: Repository filter length (CWE-20)
  // ==========================================================================
  describe('input validation (repository filter)', () => {
    it('should reject repository filter exceeding 200 characters', async () => {
      const longRepo = 'A'.repeat(201);
      await expect(service.getReleaseContributions({
        repository: longRepo,
      })).rejects.toThrow('Repository filter exceeds maximum length');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should accept repository filter at 200 characters', async () => {
      const repo = 'A'.repeat(200);
      await service.getReleaseContributions({ repository: repo });
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // INPUT VALIDATION: Branch pattern arrays
  // ==========================================================================
  describe('input validation (branch patterns)', () => {
    it('should reject too many production patterns (> 50)', async () => {
      const tooMany = Array.from({ length: 51 }, (_, i) => `prod-${i}`);
      await expect(service.getReleaseContributions({
        productionPatterns: tooMany,
      })).rejects.toThrow('Too many production branch patterns');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should reject too many staging patterns (> 50)', async () => {
      const tooMany = Array.from({ length: 51 }, (_, i) => `staging-${i}`);
      await expect(service.getReleaseContributions({
        stagingPatterns: tooMany,
      })).rejects.toThrow('Too many staging branch patterns');
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should accept 50 production patterns', async () => {
      const patterns = Array.from({ length: 50 }, (_, i) => `prod-${i}`);
      await service.getReleaseContributions({
        productionPatterns: patterns,
      });
      expect(mockDb.query).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // SECURITY: SQL Injection prevention (CWE-89)
  // ==========================================================================
  describe('security (SQL injection prevention)', () => {
    it('should prevent SQL injection via repository filter', async () => {
      const maliciousRepo = "'; DROP TABLE commit_history; --";
      await service.getReleaseContributions({
        repository: maliciousRepo,
      });

      // Query should be called with parameterized value, not string concatenation
      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).not.toContain(maliciousRepo);
      expect(params[4]).toBe(maliciousRepo); // Passed as parameter
    });

    it('should prevent SQL injection via branch pattern', async () => {
      const maliciousPattern = "main'; DROP TABLE commit_history; --";
      await service.getReleaseContributions({
        productionPatterns: [maliciousPattern],
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).not.toContain(maliciousPattern);
      expect(params[0]).toEqual([maliciousPattern]); // Passed as array parameter
    });
  });

  // ==========================================================================
  // INTEGRATION: Repository filter
  // ==========================================================================
  describe('getReleaseContributions (repository filter)', () => {
    it('should filter by repository when provided', async () => {
      await service.getReleaseContributions({
        repository: 'frontend-app',
      });

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const sql = call![0] as string;
      const params = call![1] as unknown[];

      expect(sql).toContain('$5');
      expect(params[4]).toBe('frontend-app');
    });

    it('should not filter by repository when null', async () => {
      await service.getReleaseContributions();

      const call = vi.mocked(mockDb.query).mock.calls[0];
      const params = call![1] as unknown[];

      expect(params[4]).toBeNull();
    });
  });
});

/**
 * MANUAL TEST CHECKLIST (Visual Verification)
 *
 * [ ] Chart renders correctly in VS Code light theme
 * [ ] Chart renders correctly in VS Code dark theme
 * [ ] Grouped bars are visually distinct (Production vs Staging colors)
 * [ ] Contributor names are readable and not truncated unnecessarily
 * [ ] Tooltip displays correct values on hover
 * [ ] Legend is visible and explains color coding
 * [ ] Chart title includes the time range filter
 * [ ] "No data" message displays when no merge commits exist
 * [ ] Top N expansion control works (e.g., "Show all 25 contributors")
 * [ ] Chart updates correctly when filters change
 *
 * PERFORMANCE TEST CHECKLIST (Integration Tests)
 *
 * [ ] Query executes in < 500ms with 1000 merge commits
 * [ ] Query executes in < 200ms with 100 merge commits
 * [ ] Memory usage remains stable with 1000 rows
 * [ ] No connection pool exhaustion after repeated queries
 *
 * REGRESSION TEST CONSIDERATIONS
 *
 * [ ] Existing charts continue to render after adding release contributions
 * [ ] Dashboard panel singleton behavior is preserved
 * [ ] Database connection pooling is not affected
 * [ ] VS Code settings for branch patterns are read correctly
 * [ ] Migration adds indexes on commit_branch_relationship.branch if needed
 * [ ] Rollback script removes indexes cleanly
 *
 * QUALITY GATES FOR RELEASE
 *
 * [ ] All unit tests pass (80%+ coverage)
 * [ ] Integration test with Testcontainers passes
 * [ ] Manual visual verification complete in both themes
 * [ ] Performance test passes (< 500ms for 1000 rows)
 * [ ] Security audit confirms no SQL injection vulnerabilities
 * [ ] Code review approved by at least one peer
 * [ ] Documentation updated in Linear ticket
 * [ ] Migration tested with rollback
 */
