import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { TeamCouplingDataService } from '../../services/team-coupling-service.js';
import { COUPLING_MAX_FILTER_LENGTH } from '../../services/team-coupling-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for TeamCouplingDataService (IQS-909).
 * Tests the data service layer for the Cross-Team Coupling Dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - Team filter validation
 * - Min strength filter validation
 * - String filter length validation (DoS prevention)
 * - Coupling strength calculation
 * - Chord data matrix building
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 * - Summary statistics
 * - Shared file detail retrieval
 */
describe('TeamCouplingDataService', () => {
  let mockDb: DatabaseService;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as DatabaseService;
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  describe('checkCouplingViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.checkCouplingViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.checkCouplingViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.checkCouplingViewExists();

      expect(result).toBe(false);
    });
  });

  describe('checkSharedFilesViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.checkSharedFilesViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.checkSharedFilesViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getCouplingMatrix', () => {
    it('should return mapped coupling data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            team_a: 'TeamAlpha',
            team_b: 'TeamBeta',
            shared_file_count: 15,
            total_shared_commits: 45,
            coupling_strength: 25.5,
            hotspot_files: ['src/shared/api.ts', 'src/shared/types.ts'],
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getCouplingMatrix();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        teamA: 'TeamAlpha',
        teamB: 'TeamBeta',
        sharedFileCount: 15,
        totalSharedCommits: 45,
        couplingStrength: 25.5,
        hotspotFiles: ['src/shared/api.ts', 'src/shared/types.ts'],
      });
    });

    it('should handle null hotspot_files', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            team_a: 'TeamAlpha',
            team_b: 'TeamBeta',
            shared_file_count: 5,
            total_shared_commits: 10,
            coupling_strength: 10.0,
            hotspot_files: null,
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getCouplingMatrix();

      expect(result).toHaveLength(1);
      expect(result[0]?.hotspotFiles).toEqual([]);
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getCouplingMatrix();

      expect(result).toHaveLength(0);
    });

    it('should use team query when teamA provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      await service.getCouplingMatrix({ teamA: 'TeamAlpha' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(team_a) = LOWER($1) OR LOWER(team_b) = LOWER($1)'),
        ['TeamAlpha'],
      );
    });

    it('should use team pair query when both teams provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      await service.getCouplingMatrix({ teamA: 'TeamAlpha', teamB: 'TeamBeta' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(team_a) = LOWER($1) AND LOWER(team_b) = LOWER($2)'),
        ['TeamAlpha', 'TeamBeta'],
      );
    });

    it('should use min strength query when minCouplingStrength provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      await service.getCouplingMatrix({ minCouplingStrength: 20 });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('coupling_strength >= $1'),
        [20],
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      await service.getCouplingMatrix({
        teamA: 'TeamAlpha',
        minCouplingStrength: 15,
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('$1 IS NULL OR LOWER(team_a) = LOWER($1)'),
        ['TeamAlpha', null, 15],
      );
    });

    it('should throw on teamA filter exceeding max length', async () => {
      const service = new TeamCouplingDataService(mockDb);
      const longTeam = 'a'.repeat(COUPLING_MAX_FILTER_LENGTH + 1);

      await expect(
        service.getCouplingMatrix({ teamA: longTeam }),
      ).rejects.toThrow(`teamA exceeds maximum length of ${COUPLING_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw on invalid minCouplingStrength (negative)', async () => {
      const service = new TeamCouplingDataService(mockDb);

      await expect(
        service.getCouplingMatrix({ minCouplingStrength: -10 }),
      ).rejects.toThrow('Invalid minCouplingStrength: must be between 0 and 100');
    });

    it('should throw on invalid minCouplingStrength (over 100)', async () => {
      const service = new TeamCouplingDataService(mockDb);

      await expect(
        service.getCouplingMatrix({ minCouplingStrength: 150 }),
      ).rejects.toThrow('Invalid minCouplingStrength: must be between 0 and 100');
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            team_a: 'TeamAlpha',
            team_b: 'TeamBeta',
            shared_file_count: '12',
            total_shared_commits: '36',
            coupling_strength: '22.5',
            hotspot_files: ['file1.ts'],
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getCouplingMatrix();

      expect(typeof result[0]?.sharedFileCount).toBe('number');
      expect(result[0]?.sharedFileCount).toBe(12);
      expect(typeof result[0]?.couplingStrength).toBe('number');
      expect(result[0]?.couplingStrength).toBe(22.5);
    });
  });

  describe('buildChordData', () => {
    it('should build chord data from coupling rows', () => {
      const couplingRows = [
        {
          teamA: 'Alpha',
          teamB: 'Beta',
          sharedFileCount: 10,
          totalSharedCommits: 30,
          couplingStrength: 25,
          hotspotFiles: ['file1.ts'],
        },
        {
          teamA: 'Alpha',
          teamB: 'Gamma',
          sharedFileCount: 5,
          totalSharedCommits: 15,
          couplingStrength: 12,
          hotspotFiles: [],
        },
        {
          teamA: 'Beta',
          teamB: 'Gamma',
          sharedFileCount: 8,
          totalSharedCommits: 24,
          couplingStrength: 18,
          hotspotFiles: [],
        },
      ];

      const service = new TeamCouplingDataService(mockDb);
      const result = service.buildChordData(couplingRows);

      expect(result.teams).toEqual(['Alpha', 'Beta', 'Gamma']);
      expect(result.matrix).toHaveLength(3);
      expect(result.matrix[0]).toHaveLength(3);

      // Check matrix values (shared file count, symmetric)
      expect(result.matrix[0]![1]).toBe(10); // Alpha-Beta
      expect(result.matrix[1]![0]).toBe(10); // Beta-Alpha (symmetric)
      expect(result.matrix[0]![2]).toBe(5);  // Alpha-Gamma
      expect(result.matrix[2]![0]).toBe(5);  // Gamma-Alpha (symmetric)
      expect(result.matrix[1]![2]).toBe(8);  // Beta-Gamma
      expect(result.matrix[2]![1]).toBe(8);  // Gamma-Beta (symmetric)
    });

    it('should handle empty coupling rows', () => {
      const service = new TeamCouplingDataService(mockDb);
      const result = service.buildChordData([]);

      expect(result.teams).toEqual([]);
      expect(result.matrix).toEqual([]);
    });

    it('should handle single team pair', () => {
      const couplingRows = [
        {
          teamA: 'Alpha',
          teamB: 'Beta',
          sharedFileCount: 20,
          totalSharedCommits: 60,
          couplingStrength: 40,
          hotspotFiles: [],
        },
      ];

      const service = new TeamCouplingDataService(mockDb);
      const result = service.buildChordData(couplingRows);

      expect(result.teams).toEqual(['Alpha', 'Beta']);
      expect(result.matrix).toEqual([
        [0, 20],
        [20, 0],
      ]);
    });
  });

  describe('getSharedFiles', () => {
    it('should return mapped shared file data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/shared/api.ts',
            repository: 'myrepo',
            team_a: 'TeamAlpha',
            team_b: 'TeamBeta',
            team_a_commits: 12,
            team_b_commits: 8,
            team_a_contributors: 3,
            team_b_contributors: 2,
            last_modified: '2024-06-15T10:00:00Z',
            total_commits: 20,
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getSharedFiles('TeamAlpha', 'TeamBeta');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        filePath: 'src/shared/api.ts',
        repository: 'myrepo',
        teamACommits: 12,
        teamBCommits: 8,
        teamAContributors: 3,
        teamBContributors: 2,
        lastModified: '2024-06-15T10:00:00Z',
        totalCommits: 20,
      });
    });

    it('should handle Date objects in last_modified column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/file.ts',
            repository: 'repo',
            team_a: 'A',
            team_b: 'B',
            team_a_commits: 5,
            team_b_commits: 3,
            team_a_contributors: 1,
            team_b_contributors: 1,
            last_modified: new Date('2024-06-20T14:30:00Z'),
            total_commits: 8,
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getSharedFiles('A', 'B');

      expect(result).toHaveLength(1);
      expect(result[0]?.lastModified).toBe('2024-06-20T14:30:00.000Z');
    });

    it('should throw when teamA is empty', async () => {
      const service = new TeamCouplingDataService(mockDb);

      await expect(
        service.getSharedFiles('', 'TeamBeta'),
      ).rejects.toThrow('Both teamA and teamB are required');
    });

    it('should throw when teamB is empty', async () => {
      const service = new TeamCouplingDataService(mockDb);

      await expect(
        service.getSharedFiles('TeamAlpha', ''),
      ).rejects.toThrow('Both teamA and teamB are required');
    });

    it('should use correct query with team pair params', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      await service.getSharedFiles('TeamAlpha', 'TeamBeta');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(team_a) = LOWER($1) AND LOWER(team_b) = LOWER($2)'),
        ['TeamAlpha', 'TeamBeta'],
      );
    });
  });

  describe('getSummary', () => {
    it('should return summary statistics', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            total_team_pairs: 5,
            total_shared_files: 45,
            avg_coupling_strength: 22.5,
            max_coupling_strength: 60.0,
            highest_coupling_team_a: 'TeamAlpha',
            highest_coupling_team_b: 'TeamBeta',
            highest_coupling_strength: 60.0,
            unique_team_count: 4,
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getSummary();

      expect(result).toEqual({
        totalTeamPairs: 5,
        totalSharedFiles: 45,
        avgCouplingStrength: 22.5,
        maxCouplingStrength: 60.0,
        highestCouplingPair: {
          teamA: 'TeamAlpha',
          teamB: 'TeamBeta',
          strength: 60.0,
        },
        uniqueTeams: 4,
      });
    });

    it('should handle empty summary result', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getSummary();

      expect(result).toEqual({
        totalTeamPairs: 0,
        totalSharedFiles: 0,
        avgCouplingStrength: 0,
        maxCouplingStrength: 0,
        highestCouplingPair: null,
        uniqueTeams: 0,
      });
    });

    it('should handle null avg_coupling_strength', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            total_team_pairs: 0,
            total_shared_files: 0,
            avg_coupling_strength: null,
            max_coupling_strength: null,
            highest_coupling_team_a: null,
            highest_coupling_team_b: null,
            highest_coupling_strength: null,
            unique_team_count: 0,
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getSummary();

      expect(result.avgCouplingStrength).toBe(0);
      expect(result.maxCouplingStrength).toBe(0);
      expect(result.highestCouplingPair).toBeNull();
    });
  });

  describe('getUniqueTeams', () => {
    it('should return list of unique teams', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { team: 'Alpha' },
          { team: 'Beta' },
          { team: 'Gamma' },
        ],
        rowCount: 3,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getUniqueTeams();

      expect(result).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('should return empty array when no teams', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getUniqueTeams();

      expect(result).toEqual([]);
    });
  });

  describe('getChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.couplingData).toHaveLength(0);
      expect(result.chordData.teams).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // View existence check
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // Coupling matrix query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            team_a: 'Alpha',
            team_b: 'Beta',
            shared_file_count: 10,
            total_shared_commits: 30,
            coupling_strength: 25.0,
            hotspot_files: ['file1.ts'],
          },
        ],
        rowCount: 1,
      });

      // Summary query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            total_team_pairs: 1,
            total_shared_files: 10,
            avg_coupling_strength: 25.0,
            max_coupling_strength: 25.0,
            highest_coupling_team_a: 'Alpha',
            highest_coupling_team_b: 'Beta',
            highest_coupling_strength: 25.0,
            unique_team_count: 2,
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.couplingData).toHaveLength(1);
      expect(result.chordData.teams).toEqual(['Alpha', 'Beta']);
      expect(result.summary.totalTeamPairs).toBe(1);
    });

    it('should return hasData false when view exists but no data', async () => {
      // View existence check
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // All subsequent queries return empty
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(true);
      expect(result.couplingData).toHaveLength(0);
    });
  });

  describe('getSharedFilesChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getSharedFilesChartData('TeamA', 'TeamB');

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.sharedFiles).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // View existence check
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // Shared files query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/shared/api.ts',
            repository: 'repo',
            team_a: 'TeamA',
            team_b: 'TeamB',
            team_a_commits: 10,
            team_b_commits: 5,
            team_a_contributors: 2,
            team_b_contributors: 1,
            last_modified: '2024-06-15T10:00:00Z',
            total_commits: 15,
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getSharedFilesChartData('TeamA', 'TeamB');

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.teamA).toBe('TeamA');
      expect(result.teamB).toBe('TeamB');
      expect(result.sharedFiles).toHaveLength(1);
      expect(result.sharedFiles[0]?.filePath).toBe('src/shared/api.ts');
    });
  });

  describe('coupling strength thresholds', () => {
    it('should correctly classify high coupling (>= 50%)', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            team_a: 'TeamA',
            team_b: 'TeamB',
            shared_file_count: 50,
            total_shared_commits: 150,
            coupling_strength: 55.0,
            hotspot_files: [],
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getCouplingMatrix();

      expect(result[0]?.couplingStrength).toBeGreaterThanOrEqual(50);
    });

    it('should correctly classify medium coupling (20-49%)', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            team_a: 'TeamA',
            team_b: 'TeamB',
            shared_file_count: 20,
            total_shared_commits: 60,
            coupling_strength: 35.0,
            hotspot_files: [],
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getCouplingMatrix();

      expect(result[0]?.couplingStrength).toBeGreaterThanOrEqual(20);
      expect(result[0]?.couplingStrength).toBeLessThan(50);
    });

    it('should correctly classify low coupling (5-19%)', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            team_a: 'TeamA',
            team_b: 'TeamB',
            shared_file_count: 8,
            total_shared_commits: 24,
            coupling_strength: 12.0,
            hotspot_files: [],
          },
        ],
        rowCount: 1,
      });

      const service = new TeamCouplingDataService(mockDb);
      const result = await service.getCouplingMatrix();

      expect(result[0]?.couplingStrength).toBeGreaterThanOrEqual(5);
      expect(result[0]?.couplingStrength).toBeLessThan(20);
    });
  });

  describe('matrix symmetry', () => {
    it('should produce symmetric chord matrix', () => {
      const couplingRows = [
        {
          teamA: 'A',
          teamB: 'B',
          sharedFileCount: 10,
          totalSharedCommits: 30,
          couplingStrength: 25,
          hotspotFiles: [],
        },
        {
          teamA: 'A',
          teamB: 'C',
          sharedFileCount: 15,
          totalSharedCommits: 45,
          couplingStrength: 35,
          hotspotFiles: [],
        },
      ];

      const service = new TeamCouplingDataService(mockDb);
      const result = service.buildChordData(couplingRows);

      // Matrix should be symmetric: matrix[i][j] === matrix[j][i]
      for (let i = 0; i < result.matrix.length; i++) {
        for (let j = 0; j < result.matrix.length; j++) {
          expect(result.matrix[i]![j]).toBe(result.matrix[j]![i]);
        }
      }
    });

    it('should have zeros on diagonal', () => {
      const couplingRows = [
        {
          teamA: 'A',
          teamB: 'B',
          sharedFileCount: 10,
          totalSharedCommits: 30,
          couplingStrength: 25,
          hotspotFiles: [],
        },
      ];

      const service = new TeamCouplingDataService(mockDb);
      const result = service.buildChordData(couplingRows);

      // Diagonal should be all zeros (no self-coupling)
      for (let i = 0; i < result.matrix.length; i++) {
        expect(result.matrix[i]![i]).toBe(0);
      }
    });
  });

  describe('getAllSharedFiles', () => {
    it('should use team pair query when both teams provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      await service.getAllSharedFiles({ teamA: 'Alpha', teamB: 'Beta' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(team_a) = LOWER($1) AND LOWER(team_b) = LOWER($2)'),
        ['Alpha', 'Beta'],
      );
    });

    it('should use single team query when only one team provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      await service.getAllSharedFiles({ teamA: 'Alpha' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(team_a) = LOWER($1) OR LOWER(team_b) = LOWER($1)'),
        ['Alpha'],
      );
    });

    it('should use all files query when no filters', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TeamCouplingDataService(mockDb);
      await service.getAllSharedFiles({});

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM vw_team_shared_files'),
        [],
      );
    });
  });
});
