import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import {
  ALL_PIPELINE_STEPS,
  PIPELINE_STEP_LABELS,
} from '../../services/pipeline-service-types.js';
import type { PipelineStepId } from '../../services/pipeline-service-types.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for pipeline types Linear step additions.
 *
 * Validates:
 * - PipelineStepId includes linearIssueLoading, linearChangelogUpdate, commitLinearLinking
 * - ALL_PIPELINE_STEPS includes all 9 steps in correct order
 * - PIPELINE_STEP_LABELS has human-readable labels for all Linear steps
 *
 * Ticket: IQS-874
 */

describe('Pipeline Types - Linear Steps', () => {
  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
  });

  afterEach(() => {
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    _clearMocks();
  });

  describe('PipelineStepId type', () => {
    it('should include linearIssueLoading', () => {
      const step: PipelineStepId = 'linearIssueLoading';
      expect(step).toBe('linearIssueLoading');
    });

    it('should include linearChangelogUpdate', () => {
      const step: PipelineStepId = 'linearChangelogUpdate';
      expect(step).toBe('linearChangelogUpdate');
    });

    it('should include commitLinearLinking', () => {
      const step: PipelineStepId = 'commitLinearLinking';
      expect(step).toBe('commitLinearLinking');
    });
  });

  describe('ALL_PIPELINE_STEPS', () => {
    it('should contain 9 steps total', () => {
      expect(ALL_PIPELINE_STEPS).toHaveLength(9);
    });

    it('should include all original 6 steps', () => {
      expect(ALL_PIPELINE_STEPS).toContain('gitCommitExtraction');
      expect(ALL_PIPELINE_STEPS).toContain('githubContributorSync');
      expect(ALL_PIPELINE_STEPS).toContain('jiraIssueLoading');
      expect(ALL_PIPELINE_STEPS).toContain('jiraChangelogUpdate');
      expect(ALL_PIPELINE_STEPS).toContain('commitJiraLinking');
      expect(ALL_PIPELINE_STEPS).toContain('teamAssignment');
    });

    it('should include all 3 new Linear steps', () => {
      expect(ALL_PIPELINE_STEPS).toContain('linearIssueLoading');
      expect(ALL_PIPELINE_STEPS).toContain('linearChangelogUpdate');
      expect(ALL_PIPELINE_STEPS).toContain('commitLinearLinking');
    });

    it('should have teamAssignment as the last step', () => {
      expect(ALL_PIPELINE_STEPS[ALL_PIPELINE_STEPS.length - 1]).toBe('teamAssignment');
    });

    it('should have Linear steps after Jira steps and before teamAssignment', () => {
      const jiraLinkingIndex = ALL_PIPELINE_STEPS.indexOf('commitJiraLinking');
      const linearLoadingIndex = ALL_PIPELINE_STEPS.indexOf('linearIssueLoading');
      const linearChangelogIndex = ALL_PIPELINE_STEPS.indexOf('linearChangelogUpdate');
      const linearLinkingIndex = ALL_PIPELINE_STEPS.indexOf('commitLinearLinking');
      const teamAssignmentIndex = ALL_PIPELINE_STEPS.indexOf('teamAssignment');

      expect(jiraLinkingIndex).toBeLessThan(linearLoadingIndex);
      expect(linearLoadingIndex).toBeLessThan(linearChangelogIndex);
      expect(linearChangelogIndex).toBeLessThan(linearLinkingIndex);
      expect(linearLinkingIndex).toBeLessThan(teamAssignmentIndex);
    });
  });

  describe('PIPELINE_STEP_LABELS', () => {
    it('should have labels for all 9 steps', () => {
      const labels = Object.keys(PIPELINE_STEP_LABELS);
      expect(labels).toHaveLength(9);
    });

    it('should have human-readable label for linearIssueLoading', () => {
      expect(PIPELINE_STEP_LABELS.linearIssueLoading).toBe('Linear Issue Loading');
    });

    it('should have human-readable label for linearChangelogUpdate', () => {
      expect(PIPELINE_STEP_LABELS.linearChangelogUpdate).toBe('Linear Changelog/Unfinished Update');
    });

    it('should have human-readable label for commitLinearLinking', () => {
      expect(PIPELINE_STEP_LABELS.commitLinearLinking).toBe('Commit-Linear Linking');
    });

    it('should have a label for every step in ALL_PIPELINE_STEPS', () => {
      for (const step of ALL_PIPELINE_STEPS) {
        expect(PIPELINE_STEP_LABELS[step]).toBeDefined();
        expect(typeof PIPELINE_STEP_LABELS[step]).toBe('string');
        expect(PIPELINE_STEP_LABELS[step].length).toBeGreaterThan(0);
      }
    });
  });
});
