/**
 * Unit tests for extraction mode Quick Pick helper functions.
 *
 * Tests the buildExtractionModeQuickPickItems(), showExtractionModeQuickPick(),
 * and determineExtractionMode() functions used by gitr.runPipeline and
 * gitr.runGitExtraction commands.
 *
 * Ticket: GITX-125, GITX-126 (first-run detection), GITX-131 (fast mode)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, window } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import {
  buildExtractionModeQuickPickItems,
  showExtractionModeQuickPick,
  determineExtractionMode,
} from '../../commands/index.js';
import { LoggerService } from '../../logging/logger.js';
import { CommitRepository } from '../../database/commit-repository.js';
import { DatabaseService } from '../../database/database-service.js';
import type { ExtractionModeQuickPickItem } from '../../services/git-analysis-types.js';

describe('buildExtractionModeQuickPickItems', () => {
  beforeEach(() => {
    _clearMocks();
    try {
      LoggerService.getInstance().dispose();
    } catch {
      // Ignore if not initialized
    }
    LoggerService.resetInstance();
  });

  // GITX-131: Updated to reflect three Quick Pick items with Fast Incremental first
  it('should return exactly three Quick Pick items', () => {
    const items = buildExtractionModeQuickPickItems();
    expect(items).toHaveLength(3);
  });

  it('should return fast mode item first (GITX-131)', () => {
    const items = buildExtractionModeQuickPickItems();
    const fastItem = items[0];

    expect(fastItem).toBeDefined();
    expect(fastItem!.mode).toBe('fast');
    expect(fastItem!.label).toContain('Fast');
  });

  it('should return incremental mode item second', () => {
    const items = buildExtractionModeQuickPickItems();
    const incrementalItem = items[1];

    expect(incrementalItem).toBeDefined();
    expect(incrementalItem!.mode).toBe('incremental');
    expect(incrementalItem!.label).toContain('Incremental');
  });

  it('should return full mode item third', () => {
    const items = buildExtractionModeQuickPickItems();
    const fullItem = items[2];

    expect(fullItem).toBeDefined();
    expect(fullItem!.mode).toBe('full');
    expect(fullItem!.label).toContain('Full');
  });

  it('should have correct labels with icons', () => {
    const items = buildExtractionModeQuickPickItems();

    // Fast item should have rocket icon (GITX-131)
    expect(items[0]!.label).toBe('$(rocket) Fast Incremental');
    // Incremental item should have sync icon
    expect(items[1]!.label).toBe('$(sync) Incremental');
    // Full item should have database icon
    expect(items[2]!.label).toBe('$(database) Full Re-extraction');
  });

  it('should have descriptions for all items', () => {
    const items = buildExtractionModeQuickPickItems();

    for (const item of items) {
      expect(item.description).toBeDefined();
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it('should have detail text for all items', () => {
    const items = buildExtractionModeQuickPickItems();

    for (const item of items) {
      expect(item.detail).toBeDefined();
      expect(item.detail.length).toBeGreaterThan(0);
    }
  });

  it('should have correct description for fast mode (GITX-131)', () => {
    const items = buildExtractionModeQuickPickItems();
    const fastItem = items[0];

    expect(fastItem!.description).toBe('Optimized extraction (Recommended)');
  });

  it('should have correct description for incremental mode', () => {
    const items = buildExtractionModeQuickPickItems();
    const incrementalItem = items[1];

    expect(incrementalItem!.description).toBe('Standard per-branch extraction');
  });

  it('should have correct description for full mode', () => {
    const items = buildExtractionModeQuickPickItems();
    const fullItem = items[2];

    expect(fullItem!.description).toBe('Extract entire commit history');
  });

  it('should have correct detail for fast mode (GITX-131)', () => {
    const items = buildExtractionModeQuickPickItems();
    const fastItem = items[0];

    expect(fastItem!.detail).toBe('Single git query across all branches. Fastest for regular syncs.');
  });

  it('should have correct detail for incremental mode', () => {
    const items = buildExtractionModeQuickPickItems();
    const incrementalItem = items[1];

    expect(incrementalItem!.detail).toBe('Iterates each branch separately. Slower but traditional.');
  });

  it('should have correct detail for full mode', () => {
    const items = buildExtractionModeQuickPickItems();
    const fullItem = items[2];

    expect(fullItem!.detail).toBe('Ignores previous data. Use if incremental sync has issues.');
  });

  it('should return items conforming to ExtractionModeQuickPickItem interface', () => {
    const items = buildExtractionModeQuickPickItems();

    for (const item of items) {
      // Verify all required properties exist
      expect(typeof item.label).toBe('string');
      expect(typeof item.description).toBe('string');
      expect(typeof item.detail).toBe('string');
      // GITX-131: Updated to include 'fast' mode
      expect(['fast', 'incremental', 'full']).toContain(item.mode);
    }
  });

  it('should return static items (no database queries)', () => {
    // Call multiple times and verify consistent results
    const items1 = buildExtractionModeQuickPickItems();
    const items2 = buildExtractionModeQuickPickItems();
    const items3 = buildExtractionModeQuickPickItems();

    expect(items1).toEqual(items2);
    expect(items2).toEqual(items3);
  });
});

describe('showExtractionModeQuickPick', () => {
  let logger: LoggerService;

  beforeEach(() => {
    _clearMocks();
    try {
      LoggerService.getInstance().dispose();
    } catch {
      // Ignore if not initialized
    }
    LoggerService.resetInstance();
    logger = LoggerService.getInstance();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    try {
      LoggerService.getInstance().dispose();
    } catch {
      // Ignore
    }
  });

  it('should return fast mode when user selects fast (GITX-131)', async () => {
    const fastItem: ExtractionModeQuickPickItem = {
      label: '$(rocket) Fast Incremental',
      description: 'Optimized extraction (Recommended)',
      detail: 'Single git query across all branches. Fastest for regular syncs.',
      mode: 'fast',
    };

    vi.spyOn(window, 'showQuickPick').mockResolvedValue(fastItem);

    const result = await showExtractionModeQuickPick(logger);

    expect(result).toBe('fast');
    logger.dispose();
  });

  it('should return incremental mode when user selects incremental', async () => {
    const incrementalItem: ExtractionModeQuickPickItem = {
      label: '$(sync) Incremental',
      description: 'Standard per-branch extraction',
      detail: 'Iterates each branch separately. Slower but traditional.',
      mode: 'incremental',
    };

    vi.spyOn(window, 'showQuickPick').mockResolvedValue(incrementalItem);

    const result = await showExtractionModeQuickPick(logger);

    expect(result).toBe('incremental');
    logger.dispose();
  });

  it('should return full mode when user selects full', async () => {
    const fullItem: ExtractionModeQuickPickItem = {
      label: '$(database) Full Re-extraction',
      description: 'Extract entire commit history',
      detail: 'Ignores previous data. Use if incremental sync has issues.',
      mode: 'full',
    };

    vi.spyOn(window, 'showQuickPick').mockResolvedValue(fullItem);

    const result = await showExtractionModeQuickPick(logger);

    expect(result).toBe('full');
    logger.dispose();
  });

  it('should return undefined when user cancels the Quick Pick', async () => {
    vi.spyOn(window, 'showQuickPick').mockResolvedValue(undefined);

    const result = await showExtractionModeQuickPick(logger);

    expect(result).toBeUndefined();
    logger.dispose();
  });

  it('should call showQuickPick with correct options', async () => {
    const showQuickPickSpy = vi.spyOn(window, 'showQuickPick').mockResolvedValue(undefined);

    await showExtractionModeQuickPick(logger);

    expect(showQuickPickSpy).toHaveBeenCalledTimes(1);
    expect(showQuickPickSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        title: 'Git Extraction Mode',
        placeHolder: 'Choose extraction mode',
      }),
    );
    logger.dispose();
  });

  it('should pass Quick Pick items from buildExtractionModeQuickPickItems', async () => {
    const showQuickPickSpy = vi.spyOn(window, 'showQuickPick').mockResolvedValue(undefined);

    await showExtractionModeQuickPick(logger);

    const expectedItems = buildExtractionModeQuickPickItems();
    const actualItems = showQuickPickSpy.mock.calls[0]![0] as ExtractionModeQuickPickItem[];

    expect(actualItems).toEqual(expectedItems);
    logger.dispose();
  });

  it('should log info message when user cancels', async () => {
    vi.spyOn(window, 'showQuickPick').mockResolvedValue(undefined);
    const loggerInfoSpy = vi.spyOn(logger, 'info');

    await showExtractionModeQuickPick(logger);

    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'Commands',
      'showExtractionModeQuickPick',
      'Extraction mode selection cancelled by user',
    );
    logger.dispose();
  });

  it('should log info message when user selects a mode', async () => {
    const incrementalItem: ExtractionModeQuickPickItem = {
      label: '$(sync) Incremental Extraction',
      description: 'Extract new commits since last run',
      detail: 'Processes only commits after the last extracted date',
      mode: 'incremental',
    };

    vi.spyOn(window, 'showQuickPick').mockResolvedValue(incrementalItem);
    const loggerInfoSpy = vi.spyOn(logger, 'info');

    await showExtractionModeQuickPick(logger);

    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'Commands',
      'showExtractionModeQuickPick',
      'User selected extraction mode: incremental',
    );
    logger.dispose();
  });

  it('should log correct mode when user selects full', async () => {
    const fullItem: ExtractionModeQuickPickItem = {
      label: '$(database) Full Re-extraction',
      description: 'Extract entire commit history',
      detail: 'Ignores previous data. Use if incremental sync has issues.',
      mode: 'full',
    };

    vi.spyOn(window, 'showQuickPick').mockResolvedValue(fullItem);
    const loggerInfoSpy = vi.spyOn(logger, 'info');

    await showExtractionModeQuickPick(logger);

    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'Commands',
      'showExtractionModeQuickPick',
      'User selected extraction mode: full',
    );
    logger.dispose();
  });
});

// --------------------------------------------------------------------------
// GITX-126: First-run detection for extraction mode
// --------------------------------------------------------------------------

describe('determineExtractionMode', () => {
  let logger: LoggerService;
  let mockDbService: DatabaseService;
  let mockCommitRepo: CommitRepository;

  beforeEach(() => {
    _clearMocks();
    try {
      LoggerService.getInstance().dispose();
    } catch {
      // Ignore if not initialized
    }
    LoggerService.resetInstance();
    logger = LoggerService.getInstance();
    vi.restoreAllMocks();

    // Create mock database service and commit repository
    mockDbService = {
      query: vi.fn(),
      transaction: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as DatabaseService;

    mockCommitRepo = new CommitRepository(mockDbService);
  });

  afterEach(() => {
    try {
      LoggerService.getInstance().dispose();
    } catch {
      // Ignore
    }
  });

  it('should return full mode with isFirstRun=true when no commits exist', async () => {
    // Mock hasAnyCommits to return false (no data)
    vi.spyOn(mockCommitRepo, 'hasAnyCommits').mockResolvedValue(false);

    const result = await determineExtractionMode(mockCommitRepo, logger);

    expect(result).toBeDefined();
    expect(result!.mode).toBe('full');
    expect(result!.isFirstRun).toBe(true);
    logger.dispose();
  });

  it('should skip Quick Pick when no commits exist (first run)', async () => {
    vi.spyOn(mockCommitRepo, 'hasAnyCommits').mockResolvedValue(false);
    const showQuickPickSpy = vi.spyOn(window, 'showQuickPick');

    await determineExtractionMode(mockCommitRepo, logger);

    // Quick Pick should NOT be called for first run
    expect(showQuickPickSpy).not.toHaveBeenCalled();
    logger.dispose();
  });

  it('should show Quick Pick when commits exist (subsequent run)', async () => {
    vi.spyOn(mockCommitRepo, 'hasAnyCommits').mockResolvedValue(true);

    const incrementalItem: ExtractionModeQuickPickItem = {
      label: '$(sync) Incremental Extraction',
      description: 'Extract new commits since last run',
      detail: 'Processes only commits after the last extracted date',
      mode: 'incremental',
    };
    vi.spyOn(window, 'showQuickPick').mockResolvedValue(incrementalItem);

    const result = await determineExtractionMode(mockCommitRepo, logger);

    expect(result).toBeDefined();
    expect(result!.mode).toBe('incremental');
    expect(result!.isFirstRun).toBe(false);
    logger.dispose();
  });

  it('should return selected mode from Quick Pick when commits exist', async () => {
    vi.spyOn(mockCommitRepo, 'hasAnyCommits').mockResolvedValue(true);

    const fullItem: ExtractionModeQuickPickItem = {
      label: '$(database) Full Re-extraction',
      description: 'Extract entire commit history',
      detail: 'Ignores previous data. Use if incremental sync has issues.',
      mode: 'full',
    };
    vi.spyOn(window, 'showQuickPick').mockResolvedValue(fullItem);

    const result = await determineExtractionMode(mockCommitRepo, logger);

    expect(result).toBeDefined();
    expect(result!.mode).toBe('full');
    expect(result!.isFirstRun).toBe(false);
    logger.dispose();
  });

  it('should return undefined when user cancels Quick Pick', async () => {
    vi.spyOn(mockCommitRepo, 'hasAnyCommits').mockResolvedValue(true);
    vi.spyOn(window, 'showQuickPick').mockResolvedValue(undefined);

    const result = await determineExtractionMode(mockCommitRepo, logger);

    expect(result).toBeUndefined();
    logger.dispose();
  });

  it('should log info message for first-run detection', async () => {
    vi.spyOn(mockCommitRepo, 'hasAnyCommits').mockResolvedValue(false);
    const loggerInfoSpy = vi.spyOn(logger, 'info');

    await determineExtractionMode(mockCommitRepo, logger);

    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'Commands',
      'determineExtractionMode',
      'No existing data found - first run detected, defaulting to full extraction',
    );
    logger.dispose();
  });

  it('should log debug message when checking for existing data', async () => {
    vi.spyOn(mockCommitRepo, 'hasAnyCommits').mockResolvedValue(true);
    vi.spyOn(window, 'showQuickPick').mockResolvedValue(undefined);
    const loggerDebugSpy = vi.spyOn(logger, 'debug');

    await determineExtractionMode(mockCommitRepo, logger);

    expect(loggerDebugSpy).toHaveBeenCalledWith(
      'Commands',
      'determineExtractionMode',
      'Checking for existing data to determine extraction mode',
    );
    logger.dispose();
  });

  it('should log debug message when showing Quick Pick for subsequent run', async () => {
    vi.spyOn(mockCommitRepo, 'hasAnyCommits').mockResolvedValue(true);
    vi.spyOn(window, 'showQuickPick').mockResolvedValue(undefined);
    const loggerDebugSpy = vi.spyOn(logger, 'debug');

    await determineExtractionMode(mockCommitRepo, logger);

    expect(loggerDebugSpy).toHaveBeenCalledWith(
      'Commands',
      'determineExtractionMode',
      'Existing data found - showing extraction mode Quick Pick',
    );
    logger.dispose();
  });

  it('should call hasAnyCommits on the commit repository', async () => {
    const hasAnyCommitsSpy = vi.spyOn(mockCommitRepo, 'hasAnyCommits').mockResolvedValue(false);

    await determineExtractionMode(mockCommitRepo, logger);

    expect(hasAnyCommitsSpy).toHaveBeenCalledTimes(1);
    logger.dispose();
  });
});
