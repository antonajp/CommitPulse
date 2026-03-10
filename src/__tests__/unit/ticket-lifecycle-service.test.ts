import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import { TicketLifecycleDataService } from '../../services/ticket-lifecycle-service.js';
import { LIFECYCLE_MAX_FILTER_LENGTH } from '../../services/ticket-lifecycle-types.js';
import type { DatabaseService } from '../../database/database-service.js';

/**
 * Unit tests for TicketLifecycleDataService (IQS-905).
 * Tests the data service layer for the Ticket Lifecycle Sankey dashboard.
 *
 * Test coverage includes:
 * - View existence checking
 * - Query building with various filter combinations
 * - Ticket type validation
 * - Date filter validation
 * - String filter length validation (DoS prevention)
 * - Dwell time calculation mapping
 * - Rework detection flag mapping
 * - Status category mapping
 * - Empty result handling
 * - Data mapping (snake_case to camelCase)
 * - Sankey node and link building
 */
describe('TicketLifecycleDataService', () => {
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

  describe('checkTransitionsViewExists', () => {
    it('should return true when view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.checkTransitionsViewExists();

      expect(result).toBe(true);
    });

    it('should return false when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.checkTransitionsViewExists();

      expect(result).toBe(false);
    });

    it('should return false when query returns empty rows', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.checkTransitionsViewExists();

      expect(result).toBe(false);
    });
  });

  describe('checkMatrixViewExists', () => {
    it('should return true when matrix view exists', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.checkMatrixViewExists();

      expect(result).toBe(true);
    });

    it('should return false when matrix view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.checkMatrixViewExists();

      expect(result).toBe(false);
    });
  });

  describe('getTransitions', () => {
    it('should return mapped transition data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-123',
            ticket_type: 'jira',
            from_status: 'In Progress',
            to_status: 'In Review',
            transition_time: '2024-06-15T10:30:00Z',
            assignee: 'user1',
            issue_type: 'Story',
            dwell_hours: 24.5,
            is_rework: false,
            from_category: 'in_progress',
            to_category: 'review',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        ticketId: 'PROJ-123',
        ticketType: 'jira',
        fromStatus: 'In Progress',
        toStatus: 'In Review',
        transitionTime: '2024-06-15T10:30:00Z',
        assignee: 'user1',
        issueType: 'Story',
        dwellHours: 24.5,
        isRework: false,
        fromCategory: 'in_progress',
        toCategory: 'review',
      });
    });

    it('should handle Date objects in transition_time column', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-456',
            ticket_type: 'linear',
            from_status: 'Todo',
            to_status: 'In Progress',
            transition_time: new Date('2024-06-10T08:00:00Z'),
            assignee: 'user2',
            issue_type: 'Story',
            dwell_hours: 48.0,
            is_rework: false,
            from_category: 'backlog',
            to_category: 'in_progress',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(result).toHaveLength(1);
      expect(result[0]?.transitionTime).toBe('2024-06-10T08:00:00.000Z');
    });

    it('should handle null dwell_hours for first transition', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-789',
            ticket_type: 'jira',
            from_status: 'Backlog',
            to_status: 'Todo',
            transition_time: '2024-06-20T09:00:00Z',
            assignee: null,
            issue_type: 'Bug',
            dwell_hours: null,
            is_rework: false,
            from_category: 'backlog',
            to_category: 'backlog',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(result).toHaveLength(1);
      expect(result[0]?.dwellHours).toBeNull();
      expect(result[0]?.assignee).toBeNull();
    });

    it('should handle rework transitions', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-999',
            ticket_type: 'jira',
            from_status: 'In QA',
            to_status: 'In Progress',
            transition_time: '2024-06-21T14:00:00Z',
            assignee: 'user3',
            issue_type: 'Bug',
            dwell_hours: 8.5,
            is_rework: true,
            from_category: 'review',
            to_category: 'in_progress',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(result).toHaveLength(1);
      expect(result[0]?.isRework).toBe(true);
      expect(result[0]?.fromCategory).toBe('review');
      expect(result[0]?.toCategory).toBe('in_progress');
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(result).toHaveLength(0);
    });

    it('should use date range query when startDate and endDate provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TicketLifecycleDataService(mockDb);
      await service.getTransitions({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('transition_time >= $1::TIMESTAMP'),
        ['2024-06-01', '2024-06-30'],
      );
    });

    it('should use ticket type query when ticketType provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TicketLifecycleDataService(mockDb);
      await service.getTransitions({ ticketType: 'jira' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ticket_type = $1'),
        ['jira'],
      );
    });

    it('should use issue type query when issueType provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TicketLifecycleDataService(mockDb);
      await service.getTransitions({ issueType: 'Bug' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(issue_type) = LOWER($1)'),
        ['Bug'],
      );
    });

    it('should use assignee query when assignee provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TicketLifecycleDataService(mockDb);
      await service.getTransitions({ assignee: 'user1' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(assignee) = LOWER($1)'),
        ['user1'],
      );
    });

    it('should use combined query when multiple filters provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TicketLifecycleDataService(mockDb);
      await service.getTransitions({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        ticketType: 'jira',
        issueType: 'Story',
        assignee: 'user1',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('(transition_time >= $1::TIMESTAMP OR $1 IS NULL)'),
        ['2024-06-01', '2024-06-30', 'jira', 'Story', 'user1'],
      );
    });

    it('should throw on issueType filter exceeding max length', async () => {
      const service = new TicketLifecycleDataService(mockDb);
      const longIssueType = 'i'.repeat(LIFECYCLE_MAX_FILTER_LENGTH + 1);

      await expect(
        service.getTransitions({ issueType: longIssueType }),
      ).rejects.toThrow(`issueType exceeds maximum length of ${LIFECYCLE_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw on assignee filter exceeding max length', async () => {
      const service = new TicketLifecycleDataService(mockDb);
      const longAssignee = 'a'.repeat(LIFECYCLE_MAX_FILTER_LENGTH + 1);

      await expect(
        service.getTransitions({ assignee: longAssignee }),
      ).rejects.toThrow(`assignee exceeds maximum length of ${LIFECYCLE_MAX_FILTER_LENGTH} characters`);
    });

    it('should throw on invalid ticket type', async () => {
      const service = new TicketLifecycleDataService(mockDb);

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.getTransitions({ ticketType: 'invalid' as any }),
      ).rejects.toThrow('Invalid ticket type: invalid');
    });

    it('should throw on invalid date format', async () => {
      const service = new TicketLifecycleDataService(mockDb);

      await expect(
        service.getTransitions({ startDate: 'not-a-date' }),
      ).rejects.toThrow('Invalid date format for startDate: not-a-date');
    });

    it('should convert numeric string values to numbers', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-111',
            ticket_type: 'jira',
            from_status: 'Todo',
            to_status: 'In Progress',
            transition_time: '2024-06-15T10:00:00Z',
            assignee: 'user1',
            issue_type: 'Task',
            dwell_hours: '12.5',
            is_rework: false,
            from_category: 'backlog',
            to_category: 'in_progress',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(typeof result[0]?.dwellHours).toBe('number');
      expect(result[0]?.dwellHours).toBe(12.5);
    });
  });

  describe('getTransitionMatrix', () => {
    it('should return mapped matrix entry data', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            from_status: 'In Progress',
            to_status: 'In Review',
            from_category: 'in_progress',
            to_category: 'review',
            transition_count: 150,
            avg_dwell_hours: 18.5,
            median_dwell_hours: 12.0,
            rework_count: 5,
            unique_tickets: 140,
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitionMatrix();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        fromStatus: 'In Progress',
        toStatus: 'In Review',
        fromCategory: 'in_progress',
        toCategory: 'review',
        transitionCount: 150,
        avgDwellHours: 18.5,
        medianDwellHours: 12.0,
        reworkCount: 5,
        uniqueTickets: 140,
      });
    });

    it('should handle null dwell times', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            from_status: 'Backlog',
            to_status: 'Todo',
            from_category: 'backlog',
            to_category: 'backlog',
            transition_count: 50,
            avg_dwell_hours: null,
            median_dwell_hours: null,
            rework_count: 0,
            unique_tickets: 50,
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitionMatrix();

      expect(result).toHaveLength(1);
      expect(result[0]?.avgDwellHours).toBeNull();
      expect(result[0]?.medianDwellHours).toBeNull();
    });

    it('should handle empty results', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitionMatrix();

      expect(result).toHaveLength(0);
    });

    it('should use date range query when dates provided', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TicketLifecycleDataService(mockDb);
      await service.getTransitionMatrix({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('transition_time >= $1::TIMESTAMP'),
        ['2024-06-01', '2024-06-30'],
      );
    });
  });

  describe('getSankeyData', () => {
    it('should build Sankey data from matrix and status summaries', async () => {
      // Matrix query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            from_status: 'Todo',
            to_status: 'In Progress',
            from_category: 'backlog',
            to_category: 'in_progress',
            transition_count: 100,
            avg_dwell_hours: 24.0,
            median_dwell_hours: 16.0,
            rework_count: 0,
            unique_tickets: 95,
          },
          {
            from_status: 'In Progress',
            to_status: 'In Review',
            from_category: 'in_progress',
            to_category: 'review',
            transition_count: 80,
            avg_dwell_hours: 48.0,
            median_dwell_hours: 36.0,
            rework_count: 5,
            unique_tickets: 75,
          },
        ],
        rowCount: 2,
      });

      // Status summary query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { status: 'Todo', category: 'backlog', ticket_count: 100, avg_dwell_hours: 24.0 },
          { status: 'In Progress', category: 'in_progress', ticket_count: 150, avg_dwell_hours: 48.0 },
          { status: 'In Review', category: 'review', ticket_count: 80, avg_dwell_hours: 12.0 },
        ],
        rowCount: 3,
      });

      // Lifecycle summary query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            total_tickets: 100,
            total_transitions: 180,
            total_rework: 5,
            rework_pct: 2.78,
            avg_dwell_hours: 36.0,
            median_dwell_hours: 28.0,
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getSankeyData();

      // Check nodes
      expect(result.nodes).toHaveLength(3);
      expect(result.nodes.find(n => n.status === 'Todo')).toEqual({
        status: 'Todo',
        category: 'backlog',
        ticketCount: 100,
        avgDwellHours: 24.0,
      });

      // Check links
      expect(result.links).toHaveLength(2);
      expect(result.links.find(l => l.source === 'Todo' && l.target === 'In Progress')).toEqual({
        source: 'Todo',
        target: 'In Progress',
        count: 100,
        avgDwellHours: 24.0,
        isRework: false,
      });

      // Check rework link
      expect(result.links.find(l => l.source === 'In Progress' && l.target === 'In Review')?.isRework).toBe(true);

      // Check summary stats
      expect(result.totalTickets).toBe(100);
      expect(result.totalRework).toBe(5);
      expect(result.reworkPct).toBe(2.78);
    });

    it('should handle empty data', async () => {
      // Matrix query - empty
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // Status summary query - empty
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      // Lifecycle summary query - empty
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getSankeyData();

      expect(result.nodes).toHaveLength(0);
      expect(result.links).toHaveLength(0);
      expect(result.totalTickets).toBe(0);
      expect(result.totalRework).toBe(0);
      expect(result.reworkPct).toBe(0);
    });
  });

  describe('getChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.sankey.nodes).toHaveLength(0);
      expect(result.sankey.links).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // View existence check
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // Matrix query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            from_status: 'Todo',
            to_status: 'In Progress',
            from_category: 'backlog',
            to_category: 'in_progress',
            transition_count: 50,
            avg_dwell_hours: 24.0,
            median_dwell_hours: 16.0,
            rework_count: 0,
            unique_tickets: 48,
          },
        ],
        rowCount: 1,
      });

      // Status summary query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { status: 'Todo', category: 'backlog', ticket_count: 50, avg_dwell_hours: 24.0 },
          { status: 'In Progress', category: 'in_progress', ticket_count: 50, avg_dwell_hours: 36.0 },
        ],
        rowCount: 2,
      });

      // Lifecycle summary query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            total_tickets: 50,
            total_transitions: 50,
            total_rework: 0,
            rework_pct: 0,
            avg_dwell_hours: 30.0,
            median_dwell_hours: 20.0,
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.sankey.nodes).toHaveLength(2);
      expect(result.sankey.links).toHaveLength(1);
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

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(true);
      expect(result.sankey.nodes).toHaveLength(0);
    });

    it('should pass filters to getSankeyData', async () => {
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

      const service = new TicketLifecycleDataService(mockDb);
      await service.getChartData({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        ticketType: 'jira',
      });

      // Verify filters were passed through
      expect(mockDb.query).toHaveBeenCalledTimes(4); // view check + 3 queries
    });
  });

  describe('getTransitionsChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitionsChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.transitions).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // View existence check
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // Transitions query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-123',
            ticket_type: 'jira',
            from_status: 'Todo',
            to_status: 'In Progress',
            transition_time: '2024-06-15T10:00:00Z',
            assignee: 'user1',
            issue_type: 'Story',
            dwell_hours: 24.0,
            is_rework: false,
            from_category: 'backlog',
            to_category: 'in_progress',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitionsChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0]?.ticketId).toBe('PROJ-123');
    });
  });

  describe('getMatrixChartData', () => {
    it('should return empty data when view does not exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: false }],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getMatrixChartData();

      expect(result.hasData).toBe(false);
      expect(result.viewExists).toBe(false);
      expect(result.matrix).toHaveLength(0);
    });

    it('should return data when view exists and has data', async () => {
      // View existence check
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ view_exists: true }],
        rowCount: 1,
      });

      // Matrix query
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            from_status: 'Todo',
            to_status: 'In Progress',
            from_category: 'backlog',
            to_category: 'in_progress',
            transition_count: 100,
            avg_dwell_hours: 24.0,
            median_dwell_hours: 16.0,
            rework_count: 0,
            unique_tickets: 95,
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getMatrixChartData();

      expect(result.hasData).toBe(true);
      expect(result.viewExists).toBe(true);
      expect(result.matrix).toHaveLength(1);
      expect(result.matrix[0]?.transitionCount).toBe(100);
    });
  });

  describe('rework detection', () => {
    it('should correctly identify rework transitions', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-100',
            ticket_type: 'jira',
            from_status: 'Done',
            to_status: 'In Progress',
            transition_time: '2024-06-20T10:00:00Z',
            assignee: 'user1',
            issue_type: 'Bug',
            dwell_hours: 72.0,
            is_rework: true,
            from_category: 'done',
            to_category: 'in_progress',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(result[0]?.isRework).toBe(true);
      expect(result[0]?.fromCategory).toBe('done');
      expect(result[0]?.toCategory).toBe('in_progress');
    });

    it('should correctly identify forward transitions', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-101',
            ticket_type: 'jira',
            from_status: 'In Progress',
            to_status: 'Done',
            transition_time: '2024-06-21T10:00:00Z',
            assignee: 'user1',
            issue_type: 'Story',
            dwell_hours: 40.0,
            is_rework: false,
            from_category: 'in_progress',
            to_category: 'done',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(result[0]?.isRework).toBe(false);
      expect(result[0]?.fromCategory).toBe('in_progress');
      expect(result[0]?.toCategory).toBe('done');
    });
  });

  describe('dwell time calculations', () => {
    it('should handle zero dwell time', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-200',
            ticket_type: 'linear',
            from_status: 'Todo',
            to_status: 'In Progress',
            transition_time: '2024-06-15T10:00:00Z',
            assignee: 'user1',
            issue_type: 'Story',
            dwell_hours: 0,
            is_rework: false,
            from_category: 'backlog',
            to_category: 'in_progress',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(result[0]?.dwellHours).toBe(0);
    });

    it('should handle large dwell times (weeks)', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-201',
            ticket_type: 'jira',
            from_status: 'Backlog',
            to_status: 'Todo',
            transition_time: '2024-06-15T10:00:00Z',
            assignee: null,
            issue_type: 'Epic',
            dwell_hours: 720.5, // ~30 days
            is_rework: false,
            from_category: 'backlog',
            to_category: 'backlog',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(result[0]?.dwellHours).toBe(720.5);
    });
  });

  describe('status category mapping', () => {
    it('should handle unknown status categories', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            ticket_id: 'PROJ-300',
            ticket_type: 'linear',
            from_status: 'Custom Status',
            to_status: 'Another Custom',
            transition_time: '2024-06-15T10:00:00Z',
            assignee: 'user1',
            issue_type: 'Story',
            dwell_hours: 24.0,
            is_rework: false,
            from_category: 'unknown',
            to_category: 'unknown',
          },
        ],
        rowCount: 1,
      });

      const service = new TicketLifecycleDataService(mockDb);
      const result = await service.getTransitions();

      expect(result[0]?.fromCategory).toBe('unknown');
      expect(result[0]?.toCategory).toBe('unknown');
    });
  });
});
