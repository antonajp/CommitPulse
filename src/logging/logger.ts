import * as vscode from 'vscode';

/**
 * Log level enum for controlling output verbosity.
 * Numeric values mirror Python's logging module hierarchy:
 *   Python: CRITICAL=50, ERROR=40, WARNING=30, INFO=20, DEBUG=10, NOTSET=0
 *   TypeScript: CRITICAL=5, ERROR=4, WARN=3, INFO=2, DEBUG=1, TRACE=0
 * Lower numeric values = more verbose. Messages at or above the configured
 * level are displayed.
 */
export enum LogLevel {
  Trace = 0,
  Debug = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
  Critical = 5,
}

/**
 * Map of LogLevel enum values to their display strings for log formatting.
 */
const LOG_LEVEL_LABELS: Readonly<Record<LogLevel, string>> = {
  [LogLevel.Trace]: 'TRACE',
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Info]: 'INFO',
  [LogLevel.Warn]: 'WARN',
  [LogLevel.Error]: 'ERROR',
  [LogLevel.Critical]: 'CRITICAL',
};

/**
 * Interface for deferred database logging.
 * Implemented when the DB layer (dockerode + pg) is ready.
 * Maps from Python's PostgresDB.insert_gitr_pipeline_log().
 */
export interface IDbLogger {
  /**
   * Log a pipeline entry to the pipeline_log database table.
   *
   * @param parentId - The pipeline run ID (foreign key to pipeline_run table)
   * @param className - The originating class name
   * @param context - The method or context string
   * @param detail - The log message detail
   * @param level - The log level for this entry
   * @returns The generated log entry ID, or undefined if logging failed
   */
  logPipelineEntry(
    parentId: number,
    className: string,
    context: string,
    detail: string,
    level: LogLevel,
  ): Promise<number | undefined>;
}

/**
 * Parse a string log level name to the LogLevel enum.
 * Used for reading from VS Code settings and configuration.
 *
 * @param level - String representation of the log level (case-insensitive)
 * @returns The corresponding LogLevel enum value, defaults to Info
 */
export function parseLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'trace':
      return LogLevel.Trace;
    case 'debug':
      return LogLevel.Debug;
    case 'info':
      return LogLevel.Info;
    case 'warn':
      return LogLevel.Warn;
    case 'error':
      return LogLevel.Error;
    case 'critical':
      return LogLevel.Critical;
    default:
      return LogLevel.Info;
  }
}

/**
 * Centralized logger service for the gitrx VS Code extension.
 *
 * Uses VS Code OutputChannel for display with structured log format:
 *   [TIMESTAMP] [LEVEL] [ClassName.methodName] message
 *
 * Implements singleton pattern for consistent logging across the extension.
 * Maps from Python's GitrLogger._print() method behavior.
 *
 * Features:
 * - Six log levels: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL
 * - Configurable via gitr.logLevel VS Code setting
 * - Class and method context in every log entry
 * - Deferred DB logging via IDbLogger interface
 * - VS Code OutputChannel 'gitrx' for display
 */
export class LoggerService implements vscode.Disposable {
  private static instance: LoggerService | undefined;
  private readonly outputChannel: vscode.OutputChannel;
  private currentLevel: LogLevel;
  private dbLogger: IDbLogger | undefined;
  private pipelineRunId: number | undefined;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('gitrx');
    this.currentLevel = LogLevel.Info;

    // Read initial log level from VS Code settings
    const config = vscode.workspace.getConfiguration('gitrx');
    const configuredLevel = config.get<string>('logLevel', 'INFO');
    this.currentLevel = parseLogLevel(configuredLevel);

    this.outputChannel.appendLine(
      this.formatMessage(LogLevel.Debug, 'LoggerService', 'constructor', `Logger initialized with level: ${configuredLevel}`),
    );
  }

  /**
   * Get the singleton LoggerService instance.
   * Creates the instance on first call.
   */
  static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService();
    }
    return LoggerService.instance;
  }

  /**
   * Reset the singleton instance. Used in tests to ensure clean state.
   * Callers should call dispose() first if the instance is active.
   */
  static resetInstance(): void {
    LoggerService.instance = undefined;
  }

  /**
   * Set the current log level.
   * Messages below this level will not be output.
   *
   * @param level - The minimum log level to display
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  /**
   * Get the current log level.
   */
  getLevel(): LogLevel {
    return this.currentLevel;
  }

  /**
   * Register a database logger for pipeline log persistence.
   * Once registered, all log calls will also attempt to write to the DB.
   *
   * @param dbLogger - The IDbLogger implementation to use
   */
  setDbLogger(dbLogger: IDbLogger): void {
    this.dbLogger = dbLogger;
    this.log(LogLevel.Debug, 'LoggerService', 'setDbLogger', 'Database logger registered');
  }

  /**
   * Set the current pipeline run ID for DB log correlation.
   *
   * @param runId - The pipeline run ID from pipeline_run table
   */
  setPipelineRunId(runId: number): void {
    this.pipelineRunId = runId;
    this.log(LogLevel.Debug, 'LoggerService', 'setPipelineRunId', `Pipeline run ID set to: ${runId}`);
  }

  /**
   * Get the current pipeline run ID.
   */
  getPipelineRunId(): number | undefined {
    return this.pipelineRunId;
  }

  /**
   * Generic log method mapping from Python's GitrLogger._print().
   * This is the core logging method that all convenience methods delegate to.
   *
   * @param level - The log level for this message
   * @param className - The originating class name
   * @param context - The method or context string
   * @param message - The log message
   */
  log(level: LogLevel, className: string, context: string, message: string): void {
    if (level < this.currentLevel) {
      return;
    }

    const formatted = this.formatMessage(level, className, context, message);
    this.outputChannel.appendLine(formatted);

    // Attempt DB logging if configured (fire-and-forget, errors logged to output channel)
    if (this.dbLogger && this.pipelineRunId !== undefined) {
      this.dbLogger.logPipelineEntry(
        this.pipelineRunId,
        className,
        context,
        message,
        level,
      ).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.outputChannel.appendLine(
          this.formatMessage(LogLevel.Error, 'LoggerService', 'log', `DB logging failed: ${errMsg}`),
        );
      });
    }
  }

  /**
   * Log a CRITICAL message. Highest severity, always displayed.
   *
   * @param className - The originating class name
   * @param context - The method or context string
   * @param message - The log message
   */
  critical(className: string, context: string, message: string): void {
    this.log(LogLevel.Critical, className, context, message);
  }

  /**
   * Log an ERROR message.
   *
   * @param className - The originating class name
   * @param context - The method or context string
   * @param message - The log message
   * @param error - Optional Error object for stack trace inclusion
   */
  error(className: string, context: string, message: string, error?: Error): void {
    this.log(LogLevel.Error, className, context, message);
    if (error?.stack && LogLevel.Error >= this.currentLevel) {
      this.outputChannel.appendLine(
        this.formatMessage(LogLevel.Error, className, context, `Stack: ${error.stack}`),
      );
    }
  }

  /**
   * Log a WARN message.
   *
   * @param className - The originating class name
   * @param context - The method or context string
   * @param message - The log message
   */
  warn(className: string, context: string, message: string): void {
    this.log(LogLevel.Warn, className, context, message);
  }

  /**
   * Log an INFO message.
   *
   * @param className - The originating class name
   * @param context - The method or context string
   * @param message - The log message
   */
  info(className: string, context: string, message: string): void {
    this.log(LogLevel.Info, className, context, message);
  }

  /**
   * Log a DEBUG message.
   *
   * @param className - The originating class name
   * @param context - The method or context string
   * @param message - The log message
   */
  debug(className: string, context: string, message: string): void {
    this.log(LogLevel.Debug, className, context, message);
  }

  /**
   * Log a TRACE message. Most verbose level.
   *
   * @param className - The originating class name
   * @param context - The method or context string
   * @param message - The log message
   */
  trace(className: string, context: string, message: string): void {
    this.log(LogLevel.Trace, className, context, message);
  }

  /**
   * Show the output channel in VS Code.
   */
  show(): void {
    this.outputChannel.show();
  }

  /**
   * Dispose the output channel and clear the singleton.
   */
  dispose(): void {
    this.outputChannel.dispose();
    this.dbLogger = undefined;
    this.pipelineRunId = undefined;
    LoggerService.instance = undefined;
  }

  /**
   * Format a log message in the standard format:
   * [TIMESTAMP] [LEVEL] [ClassName.methodName] message
   *
   * @param level - The log level
   * @param className - The originating class name
   * @param context - The method or context string
   * @param message - The log message
   * @returns The formatted log string
   */
  private formatMessage(level: LogLevel, className: string, context: string, message: string): string {
    const timestamp = new Date().toISOString();
    const levelLabel = LOG_LEVEL_LABELS[level];
    return `[${timestamp}] [${levelLabel}] [${className}.${context}] ${message}`;
  }
}

/**
 * Backward-compatible Logger alias.
 * The scaffold (IQS-845) exported a Logger class; existing code imports it.
 * This alias allows gradual migration to LoggerService.
 *
 * @deprecated Use LoggerService instead. This alias will be removed in a future version.
 */
export const Logger = LoggerService;
