import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';
import { sanitizeUrlForLogging } from '../utils/url-sanitizer.js';

/**
 * Tracker type for a repository. Determines which issue tracker
 * is used for linking commits to issues.
 * - 'jira' (default): Link commits to Jira issues
 * - 'linear': Link commits to Linear issues
 * - 'none': No issue tracker linking
 */
export type TrackerType = 'jira' | 'linear' | 'none';

/**
 * Repository entry in the gitrx.repositories array.
 * Maps from legacy config.ini [Classes] section + base_execution_dir.
 */
export interface RepositoryEntry {
  /** Absolute path to the Git repository. */
  readonly path: string;
  /** Display name for this repository. */
  readonly name: string;
  /** Organization or team that owns this repository. */
  readonly organization: string;
  /** Issue tracker type for this repository. Default: 'jira'. */
  readonly trackerType: TrackerType;
  /**
   * Repository URL for commit and PR linking.
   * Example: https://github.com/owner/repo
   * If undefined, auto-detected from git remote.
   * Ticket: IQS-923
   */
  readonly repoUrl?: string;
  /**
   * Earliest commit date to extract for this repository (ISO format YYYY-MM-DD).
   * Commits before this date are ignored. Overrides global sinceDate.
   * Ticket: IQS-931
   */
  readonly startDate?: string;
}

/**
 * Database connection settings.
 * Maps from legacy unclassified.properties: db_host, db_port, db_name, db_user.
 * Password is stored in SecretStorage (see SecretStorageService).
 */
export interface DatabaseSettings {
  /** PostgreSQL host. Default: "localhost". */
  readonly host: string;
  /** PostgreSQL port. Default: 5433. */
  readonly port: number;
  /** PostgreSQL database name. Default: "gitrx". */
  readonly name: string;
  /** PostgreSQL user. Default: "gitrx_admin". */
  readonly user: string;
  /** Optional privileged user for DDL migrations. Falls back to user if empty. (IQS-880) */
  readonly migrationUser: string;
}

/**
 * Jira connection settings.
 * Maps from legacy unclassified.properties: jira_server, jira_username.
 * Token is stored in SecretStorage (see SecretStorageService).
 */
export interface JiraSettings {
  /** Jira server URL (e.g., https://yourorg.atlassian.net). */
  readonly server: string;
  /** Jira username (email) for API authentication. */
  readonly username: string;
  /** Jira project keys to track (e.g., ["PROJ", "FEAT"]). */
  readonly projectKeys: readonly string[];
  /** Jira key aliases for renamed projects (e.g., { PROJ: "PROJ2" }). */
  readonly keyAliases: Readonly<Record<string, string>>;
  /** Jira custom field ID for story points (e.g., customfield_10034). */
  readonly pointsField: string;
  /** Maximum issue key number to scan per project (0 = auto-detect). */
  readonly maxKeys: number;
  /** Number of issues to fetch beyond current max per incremental run. Default: 200. */
  readonly increment: number;
  /** Days to look back for unfinished issue refresh. Default: 2. */
  readonly daysAgo: number;
  /**
   * Base URL prefix for Jira issue navigation. Falls back to server if empty.
   * Example: https://yourorg.atlassian.net
   * Ticket: IQS-926
   */
  readonly urlPrefix: string;
  /**
   * Enable verbose debug logging for Jira API requests and responses.
   * When enabled, logs full request URLs, headers, JQL queries, and response details.
   * Requires logLevel DEBUG or TRACE to see output.
   */
  readonly debugLogging: boolean;
}

/**
 * Linear connection settings.
 * Token is stored in SecretStorage (see SecretStorageService).
 *
 * Mirrors the JiraSettings structure for consistency, with fields
 * adapted for the Linear API and GraphQL-based SDK.
 *
 * Ticket: IQS-874
 */
export interface LinearSettings {
  /** Linear team keys to track (e.g., ["ENG", "PLAT"]). */
  readonly teamKeys: readonly string[];
  /** Linear key aliases for renamed teams (e.g., { OLD: "NEW" }). */
  readonly keyAliases: Readonly<Record<string, string>>;
  /** Maximum issue key number to scan per team (0 = auto-detect). */
  readonly maxKeys: number;
  /** Number of issues to fetch beyond current max per incremental run. Default: 200. */
  readonly increment: number;
  /** Days to look back for unfinished issue refresh. Default: 2. */
  readonly daysAgo: number;
  /**
   * Base URL prefix for Linear issue navigation. Falls back to https://linear.app/{team}/ if empty.
   * Example: https://linear.app/yourteam
   * Ticket: IQS-926
   */
  readonly urlPrefix: string;
}

/**
 * GitHub connection settings.
 * Token is stored in SecretStorage (see SecretStorageService).
 */
export interface GitHubSettings {
  /** GitHub organization name for repository correlation. */
  readonly organization: string;
}

/**
 * Pipeline schedule settings.
 * Maps from legacy config.ini [Schedule] section.
 */
export interface ScheduleSettings {
  /** Whether automatic scheduled pipeline execution is enabled. */
  readonly enabled: boolean;
  /** Cron expression for scheduled pipeline runs. Default: "0 9 * * 1-5". */
  readonly cronExpression: string;
}

/**
 * Pipeline step configuration.
 * Controls which steps are executed during a pipeline run.
 */
export interface PipelineSettings {
  /** Which pipeline steps to execute (empty = all). */
  readonly steps: readonly string[];
  /**
   * Earliest commit date to extract (ISO format YYYY-MM-DD).
   * Commits before this date are ignored. Per-repo startDate takes precedence.
   * Ticket: IQS-931
   */
  readonly sinceDate?: string;
}

/**
 * Docker configuration settings for the PostgreSQL container.
 */
export interface DockerSettings {
  /** PostgreSQL Docker image version tag. Default: "16". */
  readonly postgresVersion: string;
}

/**
 * Git extraction settings.
 * Controls debug logging for Git operations during commit extraction.
 *
 * Ticket: IQS-936
 */
export interface GitSettings {
  /**
   * Enable verbose debug logging for Git extraction operations.
   * When enabled, logs repository init, branch discovery, tag extraction,
   * commit processing, and file diff statistics.
   * Requires logLevel DEBUG or TRACE to see output.
   */
  readonly debugLogging: boolean;
}

/**
 * Valid log level string values matching the gitrx.logLevel enum in package.json.
 */
export type LogLevelString = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

/**
 * Complete extension configuration interface.
 * Maps to the gitrx.* settings defined in package.json contributes.configuration.
 *
 * This interface replaces the legacy Python PropertiesReader.py that read from
 * config.ini + unclassified.properties + classified.properties.
 *
 * Secrets (database password, Jira token, GitHub token) are NOT part of this
 * interface — they are managed by SecretStorageService via VS Code's encrypted
 * SecretStorage API.
 */
/**
 * Architecture component mapping settings.
 * Drives the file-to-category classification for the arc component backfill.
 * Ticket: IQS-885
 */
export interface ArcComponentSettings {
  /** Maps file extensions (e.g., ".ts") to architecture component categories (e.g., "Back-End"). */
  readonly extensionMapping: Readonly<Record<string, string>>;
  /** Maps filenames (e.g., "Dockerfile") to architecture component categories (e.g., "DevOps/CI"). */
  readonly filenameMapping: Readonly<Record<string, string>>;
}

export interface GitrxConfiguration {
  /** Repositories to analyze. */
  readonly repositories: readonly RepositoryEntry[];
  /** Database connection settings. */
  readonly database: DatabaseSettings;
  /** Jira connection settings. */
  readonly jira: JiraSettings;
  /** Linear connection settings. Ticket: IQS-874. */
  readonly linear: LinearSettings;
  /** GitHub connection settings. */
  readonly github: GitHubSettings;
  /** Pipeline schedule settings. */
  readonly schedule: ScheduleSettings;
  /** Pipeline step configuration. */
  readonly pipeline: PipelineSettings;
  /** Logging verbosity level. */
  readonly logLevel: LogLevelString;
  /** Docker configuration. */
  readonly docker: DockerSettings;
  /** Architecture component mapping settings. Ticket: IQS-885. */
  readonly arcComponent: ArcComponentSettings;
  /** Git extraction settings. Ticket: IQS-936. */
  readonly git: GitSettings;
}

/**
 * VS Code configuration section prefix for all gitrx settings.
 */
export const CONFIG_SECTION = 'gitrx';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'Settings';

/**
 * Valid log level values for runtime validation.
 */
const VALID_LOG_LEVELS: readonly LogLevelString[] = [
  'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL',
];

/**
 * Valid tracker type values for runtime validation.
 */
const VALID_TRACKER_TYPES: readonly TrackerType[] = ['jira', 'linear', 'none'];

/**
 * Read the current extension settings from VS Code configuration.
 *
 * Retrieves all gitrx.* settings and returns them as a typed, frozen
 * GitrxConfiguration object. Invalid or missing values fall back to
 * the defaults defined in package.json.
 *
 * @returns A frozen GitrxConfiguration object reflecting the current configuration
 */
export function getSettings(): GitrxConfiguration {
  const logger = LoggerService.getInstance();
  logger.trace(CLASS_NAME, 'getSettings', 'Reading extension settings from VS Code configuration');

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  // Read and validate repositories
  const rawRepositories = config.get<RepositoryEntry[]>('repositories', []);
  const repositories = validateRepositories(rawRepositories, logger);

  // Read database settings (IQS-880: added migrationUser)
  const database: DatabaseSettings = Object.freeze({
    host: config.get<string>('database.host', 'localhost'),
    port: validatePort(config.get<number>('database.port', 5433), logger),
    name: config.get<string>('database.name', 'gitrx'),
    user: config.get<string>('database.user', 'gitrx_admin'),
    migrationUser: config.get<string>('database.migrationUser', ''),
  });

  // Read Jira settings (IQS-926: added urlPrefix)
  const jira: JiraSettings = Object.freeze({
    server: config.get<string>('jira.server', ''),
    username: config.get<string>('jira.username', ''),
    projectKeys: config.get<string[]>('jira.projectKeys', []),
    keyAliases: config.get<Record<string, string>>('jira.keyAliases', {}),
    pointsField: config.get<string>('jira.pointsField', 'customfield_10034'),
    maxKeys: config.get<number>('jira.maxKeys', 0),
    increment: config.get<number>('jira.increment', 200),
    daysAgo: config.get<number>('jira.daysAgo', 2),
    urlPrefix: normalizeUrlPrefix(config.get<string>('jira.urlPrefix', '')),
    debugLogging: config.get<boolean>('jira.debugLogging', false),
  });

  // Read Linear settings (IQS-874, IQS-926: added urlPrefix)
  const linear: LinearSettings = Object.freeze({
    teamKeys: config.get<string[]>('linear.teamKeys', []),
    keyAliases: config.get<Record<string, string>>('linear.keyAliases', {}),
    maxKeys: config.get<number>('linear.maxKeys', 0),
    increment: config.get<number>('linear.increment', 200),
    daysAgo: config.get<number>('linear.daysAgo', 2),
    urlPrefix: normalizeUrlPrefix(config.get<string>('linear.urlPrefix', '')),
  });

  // Read GitHub settings
  const github: GitHubSettings = Object.freeze({
    organization: config.get<string>('github.organization', ''),
  });

  // Read schedule settings
  const schedule: ScheduleSettings = Object.freeze({
    enabled: config.get<boolean>('schedule.enabled', false),
    cronExpression: config.get<string>('schedule.cronExpression', '0 9 * * 1-5'),
  });

  // Read and validate log level
  const rawLogLevel = config.get<string>('logLevel', 'INFO');
  const logLevel = validateLogLevel(rawLogLevel, logger);

  // Read pipeline settings (IQS-931: added sinceDate)
  const rawSinceDate = config.get<string>('pipeline.sinceDate', '');
  const pipeline: PipelineSettings = Object.freeze({
    steps: config.get<string[]>('pipeline.steps', []),
    sinceDate: validateIsoDate(rawSinceDate, 'pipeline.sinceDate', logger),
  });

  // Read Docker settings
  const docker: DockerSettings = Object.freeze({
    postgresVersion: config.get<string>('docker.postgresVersion', '16'),
  });

  // Read arc component mapping settings (IQS-885)
  const arcComponent: ArcComponentSettings = Object.freeze({
    extensionMapping: Object.freeze(
      validateArcMappings(config.get<Record<string, string>>('arcComponent.extensionMapping', {}), 'extensionMapping', logger),
    ),
    filenameMapping: Object.freeze(
      validateArcMappings(config.get<Record<string, string>>('arcComponent.filenameMapping', {}), 'filenameMapping', logger),
    ),
  });

  // Read Git extraction settings (IQS-936)
  const git: GitSettings = Object.freeze({
    debugLogging: config.get<boolean>('git.debugLogging', false),
  });

  const settings: GitrxConfiguration = {
    repositories,
    database,
    jira,
    linear,
    github,
    schedule,
    pipeline,
    logLevel,
    docker,
    arcComponent,
    git,
  };

  logger.trace(CLASS_NAME, 'getSettings', `Settings loaded: ${repositories.length} repositories configured`);
  logger.debug(CLASS_NAME, 'getSettings', `Database: ${database.host}:${database.port}/${database.name}`);
  logger.debug(CLASS_NAME, 'getSettings', `Jira server: ${jira.server || '(not configured)'}`);
  logger.debug(CLASS_NAME, 'getSettings', `Linear team keys: [${linear.teamKeys.join(', ') || 'none'}]`);
  logger.debug(CLASS_NAME, 'getSettings', `GitHub org: ${github.organization || '(not configured)'}`);
  logger.debug(CLASS_NAME, 'getSettings', `Schedule: enabled=${schedule.enabled}, cron=${schedule.cronExpression}`);
  logger.debug(CLASS_NAME, 'getSettings', `Pipeline steps: [${pipeline.steps.join(', ') || 'all'}]`);
  logger.debug(CLASS_NAME, 'getSettings', `Log level: ${logLevel}`);

  return Object.freeze(settings);
}

/**
 * Get a specific configuration value by its full key within the gitrx section.
 *
 * @param key - The setting key relative to the gitrx section (e.g., "database.host")
 * @param defaultValue - Default value if the setting is not configured
 * @returns The configured value or the default
 */
export function getConfigValue<T>(key: string, defaultValue: T): T {
  const logger = LoggerService.getInstance();
  logger.trace(CLASS_NAME, 'getConfigValue', `Reading config key: ${CONFIG_SECTION}.${key}`);

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<T>(key, defaultValue);
}

/**
 * Register a listener for configuration changes affecting gitrx settings.
 *
 * @param callback - Called when any gitrx.* setting changes, with the new configuration
 * @returns A disposable to unregister the listener
 */
export function onConfigurationChanged(
  callback: (config: GitrxConfiguration) => void,
): vscode.Disposable {
  const logger = LoggerService.getInstance();
  logger.debug(CLASS_NAME, 'onConfigurationChanged', 'Registering configuration change listener');

  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(CONFIG_SECTION)) {
      logger.debug(CLASS_NAME, 'onConfigurationChanged', 'Configuration change detected, reloading settings');
      const newConfig = getSettings();
      callback(newConfig);
    }
  });
}

/**
 * Validate and normalize repository entries.
 * Filters out entries missing required fields and logs warnings.
 *
 * @param raw - Raw repository entries from configuration
 * @param logger - Logger instance for reporting issues
 * @returns Validated repository entries
 */
function validateRepositories(
  raw: RepositoryEntry[],
  logger: LoggerService,
): readonly RepositoryEntry[] {
  const validated: RepositoryEntry[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry === undefined || entry === null) {
      logger.warn(CLASS_NAME, 'validateRepositories', `Repository entry at index ${i} is null/undefined, skipping`);
      continue;
    }

    if (!entry.path || typeof entry.path !== 'string') {
      logger.warn(CLASS_NAME, 'validateRepositories', `Repository entry at index ${i} missing required 'path' field, skipping`);
      continue;
    }

    if (!entry.name || typeof entry.name !== 'string') {
      logger.warn(CLASS_NAME, 'validateRepositories', `Repository entry at index ${i} missing required 'name' field, skipping`);
      continue;
    }

    // Validate and normalize trackerType (IQS-874)
    const rawTracker = (entry as RepositoryEntry & { trackerType?: string }).trackerType;
    const trackerType = validateTrackerType(rawTracker, i, logger);

    // Validate and normalize repoUrl (IQS-923)
    const rawRepoUrl = (entry as RepositoryEntry & { repoUrl?: string }).repoUrl;
    const repoUrl = validateRepoUrl(rawRepoUrl, i, logger);

    // Validate and normalize startDate (IQS-931)
    const rawStartDate = (entry as RepositoryEntry & { startDate?: string }).startDate;
    const startDate = validateIsoDate(rawStartDate, `repositories[${i}].startDate`, logger);

    validated.push(Object.freeze({
      path: entry.path,
      name: entry.name,
      organization: typeof entry.organization === 'string' ? entry.organization : '',
      trackerType,
      repoUrl,
      startDate,
    }));
  }

  logger.trace(CLASS_NAME, 'validateRepositories', `Validated ${validated.length} of ${raw.length} repository entries`);
  return Object.freeze(validated);
}

/**
 * Validate that a port number is within the valid TCP range.
 *
 * @param port - The port number to validate
 * @param logger - Logger instance for reporting issues
 * @returns The validated port, or 5433 (default) if invalid
 */
function validatePort(port: number, logger: LoggerService): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    logger.warn(CLASS_NAME, 'validatePort', `Invalid port number ${port}, falling back to default 5433`);
    return 5433;
  }
  return port;
}

/**
 * Validate that a log level string is one of the known values.
 *
 * @param level - The log level string to validate
 * @param logger - Logger instance for reporting issues
 * @returns The validated log level, or "INFO" if invalid
 */
function validateLogLevel(level: string, logger: LoggerService): LogLevelString {
  const upper = level.toUpperCase() as LogLevelString;
  if (VALID_LOG_LEVELS.includes(upper)) {
    return upper;
  }
  logger.warn(CLASS_NAME, 'validateLogLevel', `Invalid log level '${level}', falling back to INFO`);
  return 'INFO';
}

/**
 * Regex for validating ISO date format (YYYY-MM-DD).
 * Used for sinceDate and startDate settings.
 * Ticket: IQS-931
 */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate that a date string is in ISO format (YYYY-MM-DD).
 * Returns undefined for empty/invalid dates and logs a warning for invalid formats.
 *
 * @param dateStr - The date string to validate (may be undefined, null, or empty)
 * @param settingName - Setting name for log context
 * @param logger - Logger instance for reporting issues
 * @returns The validated date string, or undefined if invalid/empty
 *
 * Ticket: IQS-931
 */
function validateIsoDate(
  dateStr: string | undefined | null,
  settingName: string,
  logger: LoggerService,
): string | undefined {
  // Treat undefined, null, or empty string as "not configured"
  if (!dateStr || typeof dateStr !== 'string' || dateStr.trim() === '') {
    return undefined;
  }

  const trimmed = dateStr.trim();

  // Validate format using regex
  if (!ISO_DATE_REGEX.test(trimmed)) {
    logger.warn(
      CLASS_NAME,
      'validateIsoDate',
      `Invalid date format for ${settingName}: "${trimmed}" (expected YYYY-MM-DD), ignoring`,
    );
    return undefined;
  }

  // Validate that it's a real date (e.g., not 2024-02-30)
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    logger.warn(
      CLASS_NAME,
      'validateIsoDate',
      `Invalid date value for ${settingName}: "${trimmed}" (not a valid date), ignoring`,
    );
    return undefined;
  }

  // Verify the date string round-trips correctly (catches edge cases like 2024-02-30 -> 2024-03-01)
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  const roundTripped = `${year}-${month}-${day}`;

  if (roundTripped !== trimmed) {
    logger.warn(
      CLASS_NAME,
      'validateIsoDate',
      `Invalid date value for ${settingName}: "${trimmed}" (date does not exist), ignoring`,
    );
    return undefined;
  }

  logger.trace(CLASS_NAME, 'validateIsoDate', `Validated ${settingName}: ${trimmed}`);
  return trimmed;
}

/**
 * Regex for validating arc component category names (CWE-20: Input Validation).
 * Must match ^[a-zA-Z0-9 /-]+$ to prevent XSS in webview rendering.
 * Ticket: IQS-885
 */
const ARC_CATEGORY_REGEX = /^[a-zA-Z0-9 /-]+$/;

/**
 * Normalize a URL prefix by stripping trailing slashes.
 * Returns empty string for invalid/empty input.
 *
 * @param url - The URL prefix to normalize
 * @returns Normalized URL with trailing slashes stripped
 *
 * Ticket: IQS-926
 */
function normalizeUrlPrefix(url: string): string {
  if (!url || typeof url !== 'string') {
    return '';
  }
  // Trim whitespace and strip trailing slashes
  return url.trim().replace(/\/+$/, '');
}

/**
 * Validate arc component mapping values. Removes entries with invalid category
 * names and logs warnings. Returns the validated mapping.
 *
 * @param raw - Raw mapping from VS Code configuration
 * @param settingName - Setting name for log context
 * @param logger - Logger instance for reporting issues
 * @returns Validated mapping with invalid entries removed
 */
function validateArcMappings(
  raw: Record<string, string>,
  settingName: string,
  logger: LoggerService,
): Record<string, string> {
  if (!raw || typeof raw !== 'object') {
    logger.warn(CLASS_NAME, 'validateArcMappings', `Invalid ${settingName} value, falling back to empty object`);
    return {};
  }

  const validated: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string' || !ARC_CATEGORY_REGEX.test(value)) {
      logger.warn(
        CLASS_NAME,
        'validateArcMappings',
        `Invalid category "${String(value)}" for key "${key}" in ${settingName}, skipping`,
      );
      continue;
    }
    validated[key] = value;
  }

  return validated;
}

/**
 * Validate that a tracker type string is one of the known values.
 * Default is 'jira' for backward compatibility with existing installations.
 *
 * @param rawTracker - The raw tracker type string from configuration
 * @param index - Repository index for logging context
 * @param logger - Logger instance for reporting issues
 * @returns The validated tracker type, or 'jira' if invalid/missing
 */
function validateTrackerType(
  rawTracker: string | undefined,
  index: number,
  logger: LoggerService,
): TrackerType {
  if (rawTracker === undefined || rawTracker === null) {
    // Default to 'jira' for backward compatibility
    return 'jira';
  }
  const lower = rawTracker.toLowerCase() as TrackerType;
  if (VALID_TRACKER_TYPES.includes(lower)) {
    return lower;
  }
  logger.warn(CLASS_NAME, 'validateTrackerType', `Invalid trackerType '${rawTracker}' at repository index ${index}, defaulting to 'jira'`);
  return 'jira';
}

/**
 * Validate and normalize a repository URL.
 *
 * Security: Only allows http:// and https:// schemes to prevent
 * javascript:, data:, file: URL injection attacks (CWE-20).
 *
 * Normalization:
 * - Removes trailing slashes
 * - Removes .git suffix
 * - Rejects embedded credentials (user:pass@host)
 *
 * @param url - The raw URL string from configuration
 * @param index - Repository index for logging context
 * @param logger - Logger instance for reporting issues
 * @returns The validated/normalized URL, or undefined if invalid
 *
 * Ticket: IQS-923
 */
function validateRepoUrl(
  url: string | undefined,
  index: number,
  logger: LoggerService,
): string | undefined {
  // Treat undefined, null, or empty string as "not configured"
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return undefined;
  }

  // Normalize: trim whitespace, remove trailing slashes, remove .git suffix
  const trimmed = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');

  try {
    // Parse URL using VS Code's strict URI parser
    const parsed = vscode.Uri.parse(trimmed, true);

    // Security: Only allow http and https schemes
    const scheme = parsed.scheme.toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      logger.warn(
        CLASS_NAME,
        'validateRepoUrl',
        `Invalid scheme "${scheme}" for repoUrl at index ${index}, must be http or https`,
      );
      return undefined;
    }

    // Security: Check for embedded credentials (CWE-200)
    // VS Code Uri doesn't expose userinfo directly, so check the raw URL
    const schemeEnd = trimmed.toLowerCase().indexOf('://');
    if (schemeEnd !== -1) {
      const afterScheme = trimmed.substring(schemeEnd + 3);
      const atIndex = afterScheme.indexOf('@');
      const slashIndex = afterScheme.indexOf('/');
      // If @ appears before the first slash (or no slash), it's embedded credentials
      if (atIndex !== -1 && (slashIndex === -1 || atIndex < slashIndex)) {
        logger.warn(
          CLASS_NAME,
          'validateRepoUrl',
          `Embedded credentials not allowed in repoUrl at index ${index}`,
        );
        return undefined;
      }
    }

    // Validate authority (domain) is present
    if (!parsed.authority) {
      logger.warn(
        CLASS_NAME,
        'validateRepoUrl',
        `Missing domain in repoUrl at index ${index}`,
      );
      return undefined;
    }

    // IQS-936: Sanitize URL before logging to prevent credential exposure
    const sanitizedUrl = sanitizeUrlForLogging(trimmed);
    logger.trace(CLASS_NAME, 'validateRepoUrl', `Validated repoUrl at index ${index}: ${sanitizedUrl}`);
    return trimmed;
  } catch {
    // IQS-936: Sanitize URL before logging to prevent credential exposure
    const sanitizedUrl = sanitizeUrlForLogging(url);
    logger.warn(
      CLASS_NAME,
      'validateRepoUrl',
      `Invalid URL format for repoUrl at index ${index}: ${sanitizedUrl}`,
    );
    return undefined;
  }
}

/**
 * Legacy settings interface.
 * @deprecated Use GitrxConfiguration instead. This type alias exists for backward
 * compatibility with code written against the IQS-845 scaffold.
 */
export type GitrSettings = GitrxConfiguration;
