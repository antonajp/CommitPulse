/**
 * Factory for creating jira.js Version3Client with debug logging.
 *
 * Provides comprehensive HTTP-level debug logging for Jira API calls:
 * - Pre-request logging: URL, headers, body payload
 * - Response logging: status, data summary
 * - Error logging: full error details with HTTP status
 *
 * Enable DEBUG or TRACE log level in VS Code settings (gitrx.logLevel)
 * to see Jira API request/response details.
 *
 * Ticket: IQS-XXX (debug logging enhancement)
 */

import { Version3Client } from 'jira.js';
import type { JiraError } from 'jira.js';
import { LoggerService } from '../logging/logger.js';

// ============================================================================
// Constants
// ============================================================================

const CLASS_NAME = 'JiraClientFactory';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for creating a Jira client with debug logging.
 */
export interface JiraClientConfig {
  /** Jira server URL (e.g., https://yourorg.atlassian.net) */
  readonly server: string;
  /** Jira username (email) for API authentication */
  readonly username: string;
  /** Jira API token */
  readonly token: string;
  /** Enable verbose request/response logging (default: true at DEBUG level) */
  readonly enableDebugLogging?: boolean;
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create a Version3Client with debug logging middleware.
 *
 * When log level is DEBUG or TRACE, this will log:
 * - Response data summaries (issue counts, keys)
 * - Error details including HTTP status and response body
 *
 * @param config - Jira client configuration
 * @returns Configured Version3Client instance
 */
export function createJiraClient(config: JiraClientConfig): Version3Client {
  const logger = LoggerService.getInstance();
  const enableLogging = config.enableDebugLogging ?? true;

  logger.debug(CLASS_NAME, 'createJiraClient', `Creating Jira client for server: ${config.server}`);
  logger.debug(CLASS_NAME, 'createJiraClient', `Debug logging enabled: ${enableLogging}`);

  // Build client config with optional middleware callbacks
  const clientConfig = {
    host: config.server,
    authentication: {
      basic: {
        email: config.username,
        apiToken: config.token,
      },
    },
    ...(enableLogging ? {
      middlewares: {
        onResponse: (data: unknown): void => {
          logJiraResponse(logger, data);
        },
        onError: (error: JiraError): void => {
          logJiraError(logger, error);
        },
      },
    } : {}),
  };

  const client = new Version3Client(clientConfig);

  logger.debug(CLASS_NAME, 'createJiraClient', 'Jira client created successfully');
  return client;
}

// ============================================================================
// Request logging helpers (call before API invocation)
// ============================================================================

/**
 * Options for JQL search request logging.
 */
export interface JqlSearchLogOptions {
  /** Jira server URL */
  server: string;
  /** JQL query string */
  jql: string;
  /** Pagination start index */
  startAt: number;
  /** Page size */
  maxResults: number;
  /** Fields to retrieve */
  fields: string[];
  /** Expand parameters (e.g., 'changelog') */
  expand?: string;
  /** Enable logging (default: true) */
  enabled?: boolean;
}

/**
 * Log details of a JQL search request before execution.
 * Call this before invoking issueSearch.searchForIssuesUsingJql().
 *
 * @param options - Request logging options
 */
export function logJqlSearchRequest(options: JqlSearchLogOptions): void {
  // Early return if logging is disabled
  if (options.enabled === false) {
    return;
  }

  const logger = LoggerService.getInstance();
  const { server, jql, startAt, maxResults, fields, expand } = options;

  // Build the equivalent REST API URL for debugging
  const encodedJql = encodeURIComponent(jql);
  const encodedFields = fields.join(',');
  let url = `${server}/rest/api/3/search?jql=${encodedJql}&startAt=${startAt}&maxResults=${maxResults}&fields=${encodedFields}`;
  if (expand) {
    url += `&expand=${expand}`;
  }

  logger.debug(CLASS_NAME, 'logJqlSearchRequest', '=== JIRA API REQUEST ===');
  logger.debug(CLASS_NAME, 'logJqlSearchRequest', `Method: GET`);
  logger.debug(CLASS_NAME, 'logJqlSearchRequest', `URL: ${url}`);
  logger.debug(CLASS_NAME, 'logJqlSearchRequest', `JQL: ${jql}`);
  logger.debug(CLASS_NAME, 'logJqlSearchRequest', `Pagination: startAt=${startAt}, maxResults=${maxResults}`);
  logger.debug(CLASS_NAME, 'logJqlSearchRequest', `Fields: ${encodedFields}`);
  if (expand) {
    logger.debug(CLASS_NAME, 'logJqlSearchRequest', `Expand: ${expand}`);
  }
  logger.debug(CLASS_NAME, 'logJqlSearchRequest', `Headers: Authorization: Basic <redacted>, Content-Type: application/json`);
}

/**
 * Log details of a single issue fetch request.
 *
 * @param server - Jira server URL
 * @param issueKey - Issue key (e.g., "IQS-100")
 * @param fields - Fields to retrieve
 * @param expand - Expand parameters
 */
export function logIssueGetRequest(
  server: string,
  issueKey: string,
  fields: string[],
  expand?: string,
): void {
  const logger = LoggerService.getInstance();

  const encodedFields = fields.join(',');
  let url = `${server}/rest/api/3/issue/${issueKey}?fields=${encodedFields}`;
  if (expand) {
    url += `&expand=${expand}`;
  }

  logger.debug(CLASS_NAME, 'logIssueGetRequest', '=== JIRA API REQUEST ===');
  logger.debug(CLASS_NAME, 'logIssueGetRequest', `Method: GET`);
  logger.debug(CLASS_NAME, 'logIssueGetRequest', `URL: ${url}`);
  logger.debug(CLASS_NAME, 'logIssueGetRequest', `Issue Key: ${issueKey}`);
  logger.debug(CLASS_NAME, 'logIssueGetRequest', `Fields: ${encodedFields}`);
  if (expand) {
    logger.debug(CLASS_NAME, 'logIssueGetRequest', `Expand: ${expand}`);
  }
  logger.debug(CLASS_NAME, 'logIssueGetRequest', `Headers: Authorization: Basic <redacted>, Content-Type: application/json`);
}

/**
 * Log details of a dev status request (internal Jira API).
 *
 * @param server - Jira server URL
 * @param issueId - Internal Jira issue ID
 * @param issueKey - Issue key for logging context
 */
export function logDevStatusRequest(
  server: string,
  issueId: string,
  issueKey: string,
): void {
  const logger = LoggerService.getInstance();

  const url = `${server}/rest/dev-status/latest/issue/detail?issueId=${issueId}&applicationType=GitHub&dataType=branch`;

  logger.debug(CLASS_NAME, 'logDevStatusRequest', '=== JIRA DEV STATUS API REQUEST ===');
  logger.debug(CLASS_NAME, 'logDevStatusRequest', `Method: GET`);
  logger.debug(CLASS_NAME, 'logDevStatusRequest', `URL: ${url}`);
  logger.debug(CLASS_NAME, 'logDevStatusRequest', `Issue ID: ${issueId}, Key: ${issueKey}`);
  logger.debug(CLASS_NAME, 'logDevStatusRequest', `Headers: Authorization: Basic <redacted>`);
}

// ============================================================================
// Response/Error logging helpers (called by middleware)
// ============================================================================

/**
 * Log Jira API response data.
 */
function logJiraResponse(logger: LoggerService, data: unknown): void {
  logger.debug(CLASS_NAME, 'onResponse', '=== JIRA API RESPONSE ===');

  if (data === null || data === undefined) {
    logger.debug(CLASS_NAME, 'onResponse', 'Response: null/undefined');
    return;
  }

  if (typeof data !== 'object') {
    logger.debug(CLASS_NAME, 'onResponse', `Response: ${String(data)}`);
    return;
  }

  const responseObj = data as Record<string, unknown>;

  // Handle search results
  if ('issues' in responseObj && Array.isArray(responseObj.issues)) {
    const issues = responseObj.issues as Array<{ key?: string }>;
    const total = responseObj.total ?? 'unknown';
    const startAt = responseObj.startAt ?? 0;
    logger.debug(CLASS_NAME, 'onResponse', `Search Result: ${issues.length} issues returned (total: ${total}, startAt: ${startAt})`);

    if (issues.length > 0 && issues.length <= 10) {
      const keys = issues.map((i) => i.key ?? 'unknown').join(', ');
      logger.trace(CLASS_NAME, 'onResponse', `Issue keys: ${keys}`);
    } else if (issues.length > 10) {
      const firstKeys = issues.slice(0, 5).map((i) => i.key ?? 'unknown').join(', ');
      const lastKeys = issues.slice(-5).map((i) => i.key ?? 'unknown').join(', ');
      logger.trace(CLASS_NAME, 'onResponse', `Issue keys (first 5): ${firstKeys}`);
      logger.trace(CLASS_NAME, 'onResponse', `Issue keys (last 5): ${lastKeys}`);
    }
    return;
  }

  // Handle single issue response
  if ('key' in responseObj && 'fields' in responseObj) {
    logger.debug(CLASS_NAME, 'onResponse', `Single Issue: ${responseObj.key}`);
    return;
  }

  // Handle dev status response
  if ('detail' in responseObj) {
    logger.debug(CLASS_NAME, 'onResponse', `Dev Status Response: ${JSON.stringify(responseObj).substring(0, 500)}`);
    return;
  }

  // Generic response
  const preview = JSON.stringify(data).substring(0, 500);
  logger.debug(CLASS_NAME, 'onResponse', `Response preview: ${preview}${preview.length >= 500 ? '...' : ''}`);
}

/**
 * Log Jira API error details.
 */
function logJiraError(logger: LoggerService, error: JiraError): void {
  logger.error(CLASS_NAME, 'onError', '=== JIRA API ERROR ===');

  // Check if it's an HttpException with detailed info
  if ('status' in error && 'statusText' in error) {
    const httpError = error as { status: number; statusText: string; message?: string; data?: unknown };
    logger.error(CLASS_NAME, 'onError', `HTTP Status: ${httpError.status} ${httpError.statusText}`);
    if (httpError.message) {
      logger.error(CLASS_NAME, 'onError', `Message: ${httpError.message}`);
    }
    if (httpError.data) {
      const dataStr = typeof httpError.data === 'string'
        ? httpError.data
        : JSON.stringify(httpError.data);
      logger.error(CLASS_NAME, 'onError', `Response Body: ${dataStr.substring(0, 1000)}`);
    }
    return;
  }

  // Check for AxiosError structure
  if ('response' in error && error.response) {
    const axiosError = error as { response: { status?: number; statusText?: string; data?: unknown }; message?: string; code?: string };
    logger.error(CLASS_NAME, 'onError', `HTTP Status: ${axiosError.response.status ?? 'unknown'} ${axiosError.response.statusText ?? ''}`);
    if (axiosError.code) {
      logger.error(CLASS_NAME, 'onError', `Error Code: ${axiosError.code}`);
    }
    if (axiosError.message) {
      logger.error(CLASS_NAME, 'onError', `Message: ${axiosError.message}`);
    }
    if (axiosError.response.data) {
      const dataStr = typeof axiosError.response.data === 'string'
        ? axiosError.response.data
        : JSON.stringify(axiosError.response.data);
      logger.error(CLASS_NAME, 'onError', `Response Body: ${dataStr.substring(0, 1000)}`);
    }
    return;
  }

  // Generic error
  if (error instanceof Error) {
    logger.error(CLASS_NAME, 'onError', `Error: ${error.message}`);
    if (error.stack) {
      logger.trace(CLASS_NAME, 'onError', `Stack: ${error.stack}`);
    }
    return;
  }

  logger.error(CLASS_NAME, 'onError', `Unknown error: ${String(error)}`);
}
