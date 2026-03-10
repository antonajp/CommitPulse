/**
 * Factory for creating IssueTrackerService instances based on trackerType.
 *
 * Dispatches to the appropriate adapter (Jira or Linear) based on the
 * repository's trackerType configuration. Returns NullTrackerService
 * for repositories with trackerType='none'.
 *
 * Ticket: IQS-874, IQS-875
 */

import { LoggerService } from '../logging/logger.js';
import type { TrackerType } from '../config/settings.js';
import type { JiraSettings, LinearSettings } from '../config/settings.js';
import type { JiraIncrementalLoader } from './jira-incremental-loader.js';
import type { LinearIncrementalLoader } from './linear-incremental-loader.js';
import {
  NullTrackerService,
} from './issue-tracker-interface.js';
import type { IssueTrackerService } from './issue-tracker-interface.js';
import { JiraTrackerAdapter } from './jira-tracker-adapter.js';
import { LinearTrackerAdapter } from './linear-tracker-adapter.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'IssueTrackerFactory';

/**
 * Dependencies required to create a Jira tracker adapter.
 */
export interface JiraTrackerDependencies {
  /** The Jira incremental loader for issue loading and changelog refresh. */
  readonly jiraLoader: JiraIncrementalLoader;
  /** The Jira configuration settings. */
  readonly jiraSettings: JiraSettings;
}

/**
 * Dependencies required to create a Linear tracker adapter.
 * Ticket: IQS-875
 */
export interface LinearTrackerDependencies {
  /** The Linear incremental loader for issue loading. */
  readonly linearLoader: LinearIncrementalLoader;
  /** The Linear configuration settings. */
  readonly linearSettings: LinearSettings;
}

/**
 * Create an IssueTrackerService instance for the given tracker type.
 *
 * This factory centralizes tracker creation logic so the pipeline does not
 * need to know about specific tracker implementations. Each tracker type
 * has its own set of dependencies that must be provided.
 *
 * @param trackerType - The tracker type from the repository configuration
 * @param jiraDeps - Dependencies for creating a Jira tracker (required if trackerType='jira')
 * @param linearDeps - Dependencies for creating a Linear tracker (required if trackerType='linear')
 * @returns An IssueTrackerService instance for the given tracker type
 */
export function createTrackerService(
  trackerType: TrackerType,
  jiraDeps?: JiraTrackerDependencies,
  linearDeps?: LinearTrackerDependencies,
): IssueTrackerService {
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'createTrackerService', `Creating tracker service for type: ${trackerType}`);

  switch (trackerType) {
    case 'jira': {
      if (!jiraDeps) {
        logger.warn(CLASS_NAME, 'createTrackerService', 'Jira dependencies not provided, falling back to NullTrackerService');
        return new NullTrackerService();
      }
      logger.info(CLASS_NAME, 'createTrackerService', 'Creating JiraTrackerAdapter');
      return new JiraTrackerAdapter(jiraDeps.jiraLoader, jiraDeps.jiraSettings);
    }

    case 'linear': {
      if (!linearDeps) {
        logger.warn(CLASS_NAME, 'createTrackerService', 'Linear dependencies not provided, falling back to NullTrackerService');
        return new NullTrackerService();
      }
      logger.info(CLASS_NAME, 'createTrackerService', 'Creating LinearTrackerAdapter');
      return new LinearTrackerAdapter(linearDeps.linearLoader, linearDeps.linearSettings);
    }

    case 'none': {
      logger.debug(CLASS_NAME, 'createTrackerService', 'Creating NullTrackerService (trackerType=none)');
      return new NullTrackerService();
    }

    default: {
      // Exhaustive check: if a new TrackerType is added, TypeScript will catch it here
      const _exhaustive: never = trackerType;
      logger.error(CLASS_NAME, 'createTrackerService', `Unknown tracker type: ${String(_exhaustive)}, using NullTrackerService`);
      return new NullTrackerService();
    }
  }
}
