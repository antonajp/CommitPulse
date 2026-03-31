/**
 * Unit tests for settings diff utility.
 *
 * GITX-138: Add Refresh Tech Stack Baseline command
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateMappingDiff,
  calculateTechStackDiff,
  formatDiffForDisplay,
  validateClaudeResponse,
  createMappingsBackup,
  parseMappingsBackup,
} from '../../utils/settings-diff.js';

// Mock LoggerService
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

describe('SettingsDiff', () => {
  describe('calculateMappingDiff', () => {
    it('should detect added keys', () => {
      const current = { '.ts': 'Back-End' };
      const proposed = { '.ts': 'Back-End', '.jsx': 'Front-End' };

      const diff = calculateMappingDiff(current, proposed);

      expect(diff.addedCount).toBe(1);
      expect(diff.modifiedCount).toBe(0);
      expect(diff.removedCount).toBe(0);
      expect(diff.changes[0].key).toBe('.jsx');
      expect(diff.changes[0].changeType).toBe('added');
    });

    it('should detect modified keys', () => {
      const current = { '.ts': 'Back-End' };
      const proposed = { '.ts': 'Front-End' };

      const diff = calculateMappingDiff(current, proposed);

      expect(diff.addedCount).toBe(0);
      expect(diff.modifiedCount).toBe(1);
      expect(diff.removedCount).toBe(0);
      expect(diff.changes[0].oldValue).toBe('Back-End');
      expect(diff.changes[0].newValue).toBe('Front-End');
    });

    it('should detect removed keys', () => {
      const current = { '.ts': 'Back-End', '.jsx': 'Front-End' };
      const proposed = { '.ts': 'Back-End' };

      const diff = calculateMappingDiff(current, proposed);

      expect(diff.addedCount).toBe(0);
      expect(diff.modifiedCount).toBe(0);
      expect(diff.removedCount).toBe(1);
      expect(diff.changes[0].key).toBe('.jsx');
      expect(diff.changes[0].changeType).toBe('removed');
    });

    it('should handle no changes', () => {
      const current = { '.ts': 'Back-End' };
      const proposed = { '.ts': 'Back-End' };

      const diff = calculateMappingDiff(current, proposed);

      expect(diff.hasChanges).toBe(false);
      expect(diff.totalChanges).toBe(0);
    });

    it('should sort changes by key', () => {
      const current = {};
      const proposed = { '.z': 'Other', '.a': 'Other', '.m': 'Other' };

      const diff = calculateMappingDiff(current, proposed);

      expect(diff.changes[0].key).toBe('.a');
      expect(diff.changes[1].key).toBe('.m');
      expect(diff.changes[2].key).toBe('.z');
    });
  });

  describe('calculateTechStackDiff', () => {
    it('should combine extension and filename diffs', () => {
      const currentExt = { '.ts': 'Back-End' };
      const proposedExt = { '.ts': 'Back-End', '.jsx': 'Front-End' };
      const currentFn = { 'Dockerfile': 'DevOps/CI' };
      const proposedFn = { 'Dockerfile': 'DevOps/CI', 'Makefile': 'Build/Tooling' };

      const diff = calculateTechStackDiff(currentExt, currentFn, proposedExt, proposedFn);

      expect(diff.extensionDiff.addedCount).toBe(1);
      expect(diff.filenameDiff.addedCount).toBe(1);
      expect(diff.totalChanges).toBe(2);
      expect(diff.hasChanges).toBe(true);
    });

    it('should return hasChanges false when no changes', () => {
      const currentExt = { '.ts': 'Back-End' };
      const currentFn = { 'Dockerfile': 'DevOps/CI' };

      const diff = calculateTechStackDiff(currentExt, currentFn, currentExt, currentFn);

      expect(diff.hasChanges).toBe(false);
      expect(diff.totalChanges).toBe(0);
    });
  });

  describe('formatDiffForDisplay', () => {
    it('should format diff for display', () => {
      const currentExt = {};
      const proposedExt = { '.ts': 'Back-End' };
      const currentFn = {};
      const proposedFn = {};

      const diff = calculateTechStackDiff(currentExt, currentFn, proposedExt, proposedFn);
      const formatted = formatDiffForDisplay(diff);

      expect(formatted).toContain('Total changes: 1');
      expect(formatted).toContain('Extension Mappings');
      expect(formatted).toContain('+ 1 added');
    });

    it('should return no changes message when no diff', () => {
      const diff = calculateTechStackDiff({}, {}, {}, {});
      const formatted = formatDiffForDisplay(diff);

      expect(formatted).toContain('No changes detected');
    });
  });

  describe('validateClaudeResponse', () => {
    it('should validate correct response', () => {
      const response = {
        extensionMapping: { '.ts': 'Back-End' },
        filenameMapping: { 'Dockerfile': 'DevOps/CI' },
      };

      const result = validateClaudeResponse(response);

      expect(result.isValid).toBe(true);
      expect(result.extensionMapping).toEqual({ '.ts': 'Back-End' });
      expect(result.filenameMapping).toEqual({ 'Dockerfile': 'DevOps/CI' });
    });

    it('should reject non-object response', () => {
      const result = validateClaudeResponse('invalid');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('not an object');
    });

    it('should reject missing extensionMapping', () => {
      const response = { filenameMapping: {} };

      const result = validateClaudeResponse(response);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('missing required');
    });

    it('should filter invalid category names', () => {
      const response = {
        extensionMapping: {
          '.ts': 'Back-End',
          '.js': '<script>alert("xss")</script>', // Invalid XSS attempt
        },
        filenameMapping: {},
      };

      const result = validateClaudeResponse(response);

      expect(result.isValid).toBe(true);
      expect(result.extensionMapping).toEqual({ '.ts': 'Back-End' });
      expect(result.invalidCategoriesRemoved).toBe(1);
    });

    it('should validate category names against CATEGORY_NAME_REGEX', () => {
      const response = {
        extensionMapping: {
          '.ts': 'Back-End',
          '.js': 'Front-End',
          '.sql': 'Database',
          '.tf': 'DevOps/CI',
        },
        filenameMapping: {
          'Dockerfile': 'DevOps/CI',
        },
      };

      const result = validateClaudeResponse(response);

      expect(result.isValid).toBe(true);
      expect(Object.keys(result.extensionMapping ?? {}).length).toBe(4);
    });
  });

  describe('createMappingsBackup / parseMappingsBackup', () => {
    it('should create and parse backup', () => {
      const extensionMapping = { '.ts': 'Back-End' };
      const filenameMapping = { 'Dockerfile': 'DevOps/CI' };

      const backup = createMappingsBackup(extensionMapping, filenameMapping);
      const parsed = parseMappingsBackup(backup);

      expect(parsed).not.toBeNull();
      expect(parsed?.extensionMapping).toEqual(extensionMapping);
      expect(parsed?.filenameMapping).toEqual(filenameMapping);
      expect(parsed?.timestamp).toBeDefined();
    });

    it('should return null for invalid backup', () => {
      const result = parseMappingsBackup('invalid json');

      expect(result).toBeNull();
    });

    it('should return null for backup missing fields', () => {
      const result = parseMappingsBackup(JSON.stringify({ timestamp: '2024-01-01' }));

      expect(result).toBeNull();
    });
  });
});
