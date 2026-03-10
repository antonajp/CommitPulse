/**
 * Validation utilities for Development Pipeline data service.
 * Provides input validation for filters, dates, and string parameters.
 *
 * All validation enforces CWE-20 (Input Validation) requirements.
 *
 * Ticket: IQS-930 (extracted from dev-pipeline-data-service.ts)
 */

import { LoggerService } from '../logging/logger.js';
import { isValidDateString } from '../utils/date-validation.js';
import type { DevPipelineFilters } from './dev-pipeline-data-types.js';
import { DEV_PIPELINE_MAX_FILTER_LENGTH } from './dev-pipeline-data-types.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'DevPipelineValidators';

/**
 * Validate string filter inputs.
 * Enforces maximum length to prevent DoS attacks (CWE-20).
 *
 * @param value - String value to validate
 * @param fieldName - Name of the field for error message
 * @param logger - Logger instance for warnings
 * @throws Error if value exceeds maximum length
 */
export function validateStringFilter(
  value: string | undefined,
  fieldName: string,
  logger: LoggerService
): void {
  if (value && value.length > DEV_PIPELINE_MAX_FILTER_LENGTH) {
    logger.warn(
      CLASS_NAME,
      'validateStringFilter',
      `${fieldName} exceeds max length: ${value.length} > ${DEV_PIPELINE_MAX_FILTER_LENGTH}`
    );
    throw new Error(
      `${fieldName} exceeds maximum length of ${DEV_PIPELINE_MAX_FILTER_LENGTH} characters`
    );
  }
}

/**
 * Validate date filter inputs.
 * Validates format and rejects malformed dates (CWE-20).
 *
 * @param filters - Filters to validate
 * @param logger - Logger instance for warnings
 * @throws Error if dates are invalid
 */
export function validateDateFilters(
  filters: DevPipelineFilters,
  logger: LoggerService
): void {
  if (filters.startDate && !isValidDateString(filters.startDate)) {
    logger.warn(
      CLASS_NAME,
      'validateDateFilters',
      `Invalid start date rejected: ${filters.startDate}`
    );
    throw new Error(`Invalid start date format: ${filters.startDate}. Expected YYYY-MM-DD.`);
  }
  if (filters.endDate && !isValidDateString(filters.endDate)) {
    logger.warn(
      CLASS_NAME,
      'validateDateFilters',
      `Invalid end date rejected: ${filters.endDate}`
    );
    throw new Error(`Invalid end date format: ${filters.endDate}. Expected YYYY-MM-DD.`);
  }
  // Validate date range order
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    logger.warn(
      CLASS_NAME,
      'validateDateFilters',
      `Invalid date range: ${filters.startDate} > ${filters.endDate}`
    );
    throw new Error(
      `Invalid date range: start date (${filters.startDate}) must be before end date (${filters.endDate})`
    );
  }
}

/**
 * Validate weekly metrics inputs.
 * Enforces team, date format, and date range requirements.
 *
 * @param team - Team name (required, non-empty)
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @param logger - Logger instance for warnings
 * @throws Error if validation fails
 */
export function validateWeeklyMetricsInputs(
  team: string,
  startDate: string,
  endDate: string,
  logger: LoggerService
): void {
  // Validate team is non-empty
  if (!team || team.trim().length === 0) {
    logger.warn(CLASS_NAME, 'validateWeeklyMetricsInputs', 'Team parameter is empty');
    throw new Error('Team parameter is required and must be non-empty');
  }
  validateStringFilter(team, 'team', logger);

  // Reuse existing date validation
  validateDateFilters({ startDate, endDate }, logger);

  // Additional: Validate date range does not exceed 365 days (weekly metrics specific)
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff > 365) {
    logger.warn(
      CLASS_NAME,
      'validateWeeklyMetricsInputs',
      `Date range exceeds 365 days: ${daysDiff.toFixed(0)} days`
    );
    throw new Error(
      `Date range exceeds maximum of 365 days. Requested range: ${daysDiff.toFixed(0)} days.`
    );
  }
}
