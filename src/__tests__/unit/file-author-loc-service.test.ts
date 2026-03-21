/**
 * Unit tests for FileAuthorLocService
 *
 * Tests the data service layer for file author LOC contributions:
 * - Input validation (file paths, date ranges)
 * - Query parameter building
 * - Result transformation
 *
 * Uses mock DatabaseService to isolate service layer testing.
 *
 * Ticket: GITX-128
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileAuthorLocService } from '../../services/file-author-loc-service.js';
import type { DatabaseService } from '../../database/database-service.js';
import type { FileAuthorLocDbRow } from '../../services/file-author-loc-types.js';

// Mock the logger
vi.mock('../../logging/logger.js', () => ({
  LoggerService: {
    getInstance: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    }),
  },
}));

describe('FileAuthorLocService', () => {
  let service: FileAuthorLocService;
  let mockDb: {
    query: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    service = new FileAuthorLocService(mockDb as unknown as DatabaseService);
  });

  describe('getFileAuthorContributions', () => {
    it('should fetch contributions for valid file paths', async () => {
      const mockRows: FileAuthorLocDbRow[] = [
        {
          filename: 'src/file.ts',
          author: 'john',
          author_name: 'John Doe',
          team: 'Engineering',
          lines_added: '100',
          lines_deleted: '20',
          net_lines: '80',
          total_churn: '120',
          commit_count: '5',
          first_commit: new Date('2024-01-01'),
          last_commit: new Date('2024-03-01'),
        },
      ];

      mockDb.query.mockResolvedValue({ rows: mockRows });

      const result = await service.getFileAuthorContributions({
        filePaths: ['src/file.ts'],
        startDate: '2024-01-01',
        endDate: '2024-03-01',
      });

      expect(result.hasData).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].filename).toBe('src/file.ts');
      expect(result.rows[0].authorName).toBe('John Doe');
      expect(result.rows[0].linesAdded).toBe(100);
      expect(result.rows[0].totalChurn).toBe(120);
      expect(result.authors).toContain('John Doe');
      expect(result.files).toContain('src/file.ts');
    });

    it('should return empty result when no data found', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await service.getFileAuthorContributions({
        filePaths: ['src/file.ts'],
        startDate: '2024-01-01',
        endDate: '2024-03-01',
      });

      expect(result.hasData).toBe(false);
      expect(result.rows).toHaveLength(0);
    });

    it('should use default date range when not provided', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await service.getFileAuthorContributions({
        filePaths: ['src/file.ts'],
      });

      // Verify query was called with date parameters
      expect(mockDb.query).toHaveBeenCalled();
      const callArgs = mockDb.query.mock.calls[0];
      expect(callArgs[1]).toHaveLength(3); // filePaths array, startDate, endDate
    });

    it('should include repository filter when provided', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await service.getFileAuthorContributions({
        filePaths: ['src/file.ts'],
        startDate: '2024-01-01',
        endDate: '2024-03-01',
        repository: 'my-repo',
      });

      // Verify query was called with repository parameter
      expect(mockDb.query).toHaveBeenCalled();
      const callArgs = mockDb.query.mock.calls[0];
      expect(callArgs[1]).toContain('my-repo');
    });

    it('should reject empty file paths array', async () => {
      await expect(
        service.getFileAuthorContributions({
          filePaths: [],
        }),
      ).rejects.toThrow();
    });

    it('should reject invalid file paths', async () => {
      await expect(
        service.getFileAuthorContributions({
          filePaths: ['../etc/passwd'],
        }),
      ).rejects.toThrow('Invalid file paths');
    });

    it('should reject invalid start date format', async () => {
      await expect(
        service.getFileAuthorContributions({
          filePaths: ['src/file.ts'],
          startDate: 'not-a-date',
          endDate: '2024-03-01',
        }),
      ).rejects.toThrow('Invalid start date');
    });

    it('should reject invalid end date format', async () => {
      await expect(
        service.getFileAuthorContributions({
          filePaths: ['src/file.ts'],
          startDate: '2024-01-01',
          endDate: 'not-a-date',
        }),
      ).rejects.toThrow('Invalid end date');
    });

    it('should reject when start date is after end date', async () => {
      await expect(
        service.getFileAuthorContributions({
          filePaths: ['src/file.ts'],
          startDate: '2024-03-01',
          endDate: '2024-01-01',
        }),
      ).rejects.toThrow('must be before');
    });

    it('should transform numeric string values correctly', async () => {
      const mockRows: FileAuthorLocDbRow[] = [
        {
          filename: 'src/file.ts',
          author: 'john',
          author_name: 'John',
          team: null,
          lines_added: '999',
          lines_deleted: '111',
          net_lines: '888',
          total_churn: '1110',
          commit_count: '42',
          first_commit: '2024-01-01',
          last_commit: '2024-03-01',
        },
      ];

      mockDb.query.mockResolvedValue({ rows: mockRows });

      const result = await service.getFileAuthorContributions({
        filePaths: ['src/file.ts'],
        startDate: '2024-01-01',
        endDate: '2024-03-01',
      });

      expect(result.rows[0].linesAdded).toBe(999);
      expect(result.rows[0].linesDeleted).toBe(111);
      expect(result.rows[0].netLines).toBe(888);
      expect(result.rows[0].totalChurn).toBe(1110);
      expect(result.rows[0].commitCount).toBe(42);
    });

    it('should handle null team values', async () => {
      const mockRows: FileAuthorLocDbRow[] = [
        {
          filename: 'src/file.ts',
          author: 'john',
          author_name: 'John',
          team: null,
          lines_added: '100',
          lines_deleted: '20',
          net_lines: '80',
          total_churn: '120',
          commit_count: '5',
          first_commit: new Date('2024-01-01'),
          last_commit: new Date('2024-03-01'),
        },
      ];

      mockDb.query.mockResolvedValue({ rows: mockRows });

      const result = await service.getFileAuthorContributions({
        filePaths: ['src/file.ts'],
      });

      expect(result.rows[0].team).toBeNull();
    });
  });

  describe('getCommitDetails', () => {
    it('should fetch commit details for a file and author', async () => {
      const mockRows = [
        {
          sha: 'abc123def456',
          commit_date: new Date('2024-02-15'),
          author: 'john',
          message: 'Fix bug in parser\nDetailed description',
          lines_added: '50',
          lines_deleted: '10',
        },
      ];

      mockDb.query.mockResolvedValue({ rows: mockRows });

      const result = await service.getCommitDetails(
        'src/file.ts',
        'john',
        '2024-01-01',
        '2024-03-01',
      );

      expect(result).toHaveLength(1);
      expect(result[0].sha).toBe('abc123def456');
      expect(result[0].author).toBe('john');
      expect(result[0].message).toBe('Fix bug in parser'); // First line only
      expect(result[0].linesAdded).toBe(50);
      expect(result[0].linesDeleted).toBe(10);
    });

    it('should reject invalid file path', async () => {
      await expect(
        service.getCommitDetails('../etc/passwd', 'john', '2024-01-01', '2024-03-01'),
      ).rejects.toThrow('Invalid file path');
    });

    it('should reject invalid date range', async () => {
      await expect(
        service.getCommitDetails('src/file.ts', 'john', '2024-03-01', '2024-01-01'),
      ).rejects.toThrow();
    });
  });

  describe('getRepositories', () => {
    it('should fetch list of repositories', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{ repository: 'repo-a' }, { repository: 'repo-b' }, { repository: 'repo-c' }],
      });

      const result = await service.getRepositories();

      expect(result).toEqual(['repo-a', 'repo-b', 'repo-c']);
    });

    it('should filter out null repositories', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{ repository: 'repo-a' }, { repository: null }, { repository: 'repo-c' }],
      });

      const result = await service.getRepositories();

      expect(result).toEqual(['repo-a', 'repo-c']);
    });
  });
});
