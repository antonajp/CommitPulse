/**
 * Unit tests for VelocityDataService getWeekCommitDetails method.
 * Validates input validation, query selection, and result mapping.
 *
 * Ticket: GITX-149, GITX-150
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VelocityDataService } from '../../services/velocity-data-service.js';
import type { DatabaseService } from '../../database/database-service.js';
import {
  QUERY_LOC_WEEK_DRILL_DOWN,
  QUERY_LOC_WEEK_DRILL_DOWN_REPOSITORY,
} from '../../database/queries/velocity-queries.js';

describe('VelocityDataService - getWeekCommitDetails', () => {
  let mockDb: DatabaseService;
  let service: VelocityDataService;

  beforeEach(() => {
    // Mock DatabaseService
    mockDb = {
      query: vi.fn(),
    } as unknown as DatabaseService;

    service = new VelocityDataService(mockDb);
  });

  it('should fetch commits for a week without repository filter', async () => {
    const mockRows = [
      {
        sha: 'abc1234567890',
        commit_date: new Date('2024-01-15T10:30:00Z'),
        author: 'John Doe',
        branch: 'main',
        message: 'Add feature X',
        lines_added: 100,
        lines_deleted: 20,
        total_loc: 120,
      },
      {
        sha: 'def4567890123',
        commit_date: new Date('2024-01-16T14:20:00Z'),
        author: 'Jane Smith',
        branch: 'feature/y',
        message: 'Fix bug Y',
        lines_added: 50,
        lines_deleted: 30,
        total_loc: 80,
      },
    ];

    vi.mocked(mockDb.query).mockResolvedValue({
      rows: mockRows,
      rowCount: mockRows.length,
    } as any);

    const result = await service.getWeekCommitDetails('2024-01-15');

    // Verify correct query was used
    expect(mockDb.query).toHaveBeenCalledWith(
      QUERY_LOC_WEEK_DRILL_DOWN,
      ['2024-01-15', '2024-01-22']
    );

    // Verify result structure
    expect(result.weekStart).toBe('2024-01-15');
    expect(result.repository).toBeNull();
    // GITX-150: repoUrl is always null from service (populated by panel from settings)
    expect(result.repoUrl).toBeNull();
    expect(result.commitCount).toBe(2);
    expect(result.totalLoc).toBe(200);
    expect(result.commits).toHaveLength(2);

    // Verify first commit mapping
    expect(result.commits[0]).toEqual({
      sha: 'abc1234',
      commitDate: '2024-01-15T10:30:00.000Z',
      author: 'John Doe',
      branch: 'main',
      message: 'Add feature X',
      linesAdded: 100,
      linesDeleted: 20,
      totalLoc: 120,
    });

    // Verify second commit mapping
    expect(result.commits[1]).toEqual({
      sha: 'def4567',
      commitDate: '2024-01-16T14:20:00.000Z',
      author: 'Jane Smith',
      branch: 'feature/y',
      message: 'Fix bug Y',
      linesAdded: 50,
      linesDeleted: 30,
      totalLoc: 80,
    });
  });

  it('should fetch commits for a week with repository filter', async () => {
    const mockRows = [
      {
        sha: 'xyz7890123456',
        commit_date: '2024-01-17',
        author: 'Bob Jones',
        branch: 'develop',
        message: 'Refactor module Z',
        lines_added: 200,
        lines_deleted: 150,
        total_loc: 350,
      },
    ];

    vi.mocked(mockDb.query).mockResolvedValue({
      rows: mockRows,
      rowCount: mockRows.length,
    } as any);

    const result = await service.getWeekCommitDetails('2024-01-15', 'my-repo');

    // Verify correct query was used with repository param
    expect(mockDb.query).toHaveBeenCalledWith(
      QUERY_LOC_WEEK_DRILL_DOWN_REPOSITORY,
      ['2024-01-15', '2024-01-22', 'my-repo']
    );

    // Verify result structure
    expect(result.weekStart).toBe('2024-01-15');
    expect(result.repository).toBe('my-repo');
    // GITX-150: repoUrl is always null from service (populated by panel from settings)
    expect(result.repoUrl).toBeNull();
    expect(result.commitCount).toBe(1);
    expect(result.totalLoc).toBe(350);
    expect(result.commits).toHaveLength(1);

    // Verify commit mapping
    expect(result.commits[0]).toEqual({
      sha: 'xyz7890',
      commitDate: '2024-01-17',
      author: 'Bob Jones',
      branch: 'develop',
      message: 'Refactor module Z',
      linesAdded: 200,
      linesDeleted: 150,
      totalLoc: 350,
    });
  });

  it('should throw error for invalid date format', async () => {
    await expect(
      service.getWeekCommitDetails('invalid-date')
    ).rejects.toThrow('Invalid week start date: invalid-date. Expected YYYY-MM-DD.');

    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('should throw error for invalid repository name', async () => {
    await expect(
      service.getWeekCommitDetails('2024-01-15', 'invalid/repo!@#')
    ).rejects.toThrow('Invalid repository name: invalid/repo!@#');

    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('should handle empty result set', async () => {
    vi.mocked(mockDb.query).mockResolvedValue({
      rows: [],
      rowCount: 0,
    } as any);

    const result = await service.getWeekCommitDetails('2024-01-15');

    expect(result.weekStart).toBe('2024-01-15');
    expect(result.repository).toBeNull();
    // GITX-150: repoUrl is always null from service
    expect(result.repoUrl).toBeNull();
    expect(result.commitCount).toBe(0);
    expect(result.totalLoc).toBe(0);
    expect(result.commits).toHaveLength(0);
  });

  it('should calculate week end correctly (7 days later)', async () => {
    vi.mocked(mockDb.query).mockResolvedValue({
      rows: [],
      rowCount: 0,
    } as any);

    await service.getWeekCommitDetails('2024-01-01');

    expect(mockDb.query).toHaveBeenCalledWith(
      QUERY_LOC_WEEK_DRILL_DOWN,
      ['2024-01-01', '2024-01-08']
    );
  });

  it('should truncate SHA to 7 characters', async () => {
    const mockRows = [
      {
        sha: 'abcdef1234567890',
        commit_date: new Date('2024-01-15T10:30:00Z'),
        author: 'Test',
        branch: 'main',
        message: 'Test',
        lines_added: 10,
        lines_deleted: 5,
        total_loc: 15,
      },
    ];

    vi.mocked(mockDb.query).mockResolvedValue({
      rows: mockRows,
      rowCount: 1,
    } as any);

    const result = await service.getWeekCommitDetails('2024-01-15');

    expect(result.commits[0].sha).toBe('abcdef1');
    expect(result.commits[0].sha).toHaveLength(7);
  });
});
