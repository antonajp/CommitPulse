import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _clearMocks, window as vscodeWindow } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService, LogLevel, parseLogLevel } from '../../logging/logger.js';
import type { IDbLogger } from '../../logging/logger.js';

/**
 * Unit tests for LoggerService (IQS-848).
 *
 * Validates:
 * - Singleton pattern and instance lifecycle
 * - All six log levels: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL
 * - Level filtering: messages below configured level are suppressed
 * - Log format: [TIMESTAMP] [LEVEL] [ClassName.methodName] message
 * - parseLogLevel utility function
 * - IDbLogger interface integration (deferred DB logging)
 * - Class name and method context in every log entry
 * - Error stack trace inclusion
 * - Pipeline run ID management
 */

describe('LoggerService', () => {
  beforeEach(() => {
    _clearMocks();
    // Reset singleton between tests
    try {
      LoggerService.getInstance().dispose();
    } catch {
      // Ignore if not initialized
    }
    LoggerService.resetInstance();
  });

  describe('Singleton Pattern', () => {
    it('should create a singleton instance', () => {
      const logger1 = LoggerService.getInstance();
      const logger2 = LoggerService.getInstance();
      expect(logger1).toBe(logger2);
      logger1.dispose();
    });

    it('should create new instance after dispose', () => {
      const logger1 = LoggerService.getInstance();
      logger1.dispose();
      LoggerService.resetInstance();

      const logger2 = LoggerService.getInstance();
      expect(logger2).not.toBe(logger1);
      logger2.dispose();
    });

    it('should create new instance after resetInstance', () => {
      const logger1 = LoggerService.getInstance();
      LoggerService.resetInstance();

      const logger2 = LoggerService.getInstance();
      expect(logger2).not.toBe(logger1);
      logger1.dispose();
      logger2.dispose();
    });
  });

  describe('Log Levels', () => {
    it('should default to Info log level', () => {
      const logger = LoggerService.getInstance();
      expect(logger.getLevel()).toBe(LogLevel.Info);
      logger.dispose();
    });

    it('should set log level', () => {
      const logger = LoggerService.getInstance();

      logger.setLevel(LogLevel.Debug);
      expect(logger.getLevel()).toBe(LogLevel.Debug);

      logger.setLevel(LogLevel.Error);
      expect(logger.getLevel()).toBe(LogLevel.Error);

      logger.setLevel(LogLevel.Critical);
      expect(logger.getLevel()).toBe(LogLevel.Critical);

      logger.dispose();
    });

    it('should have correct numeric ordering: Trace < Debug < Info < Warn < Error < Critical', () => {
      expect(LogLevel.Trace).toBeLessThan(LogLevel.Debug);
      expect(LogLevel.Debug).toBeLessThan(LogLevel.Info);
      expect(LogLevel.Info).toBeLessThan(LogLevel.Warn);
      expect(LogLevel.Warn).toBeLessThan(LogLevel.Error);
      expect(LogLevel.Error).toBeLessThan(LogLevel.Critical);
    });
  });

  describe('Level Filtering', () => {
    it('should filter messages below the configured level', () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();

      // Set to WARN level — only WARN, ERROR, CRITICAL should pass
      logger.setLevel(LogLevel.Warn);

      logger.trace('TestClass', 'testMethod', 'trace message');
      logger.debug('TestClass', 'testMethod', 'debug message');
      logger.info('TestClass', 'testMethod', 'info message');
      logger.warn('TestClass', 'testMethod', 'warn message');
      logger.error('TestClass', 'testMethod', 'error message');
      logger.critical('TestClass', 'testMethod', 'critical message');

      // Count lines that contain our test messages (excluding constructor init line)
      const testLines = capture.lines.filter(l => l.includes('TestClass'));
      expect(testLines).toHaveLength(3);
      expect(testLines[0]).toContain('[WARN]');
      expect(testLines[1]).toContain('[ERROR]');
      expect(testLines[2]).toContain('[CRITICAL]');

      capture.restore();
      logger.dispose();
    });

    it('should filter all below ERROR when set to Error level', () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Error);

      logger.trace('A', 'b', 'filtered');
      logger.debug('A', 'b', 'filtered');
      logger.info('A', 'b', 'filtered');
      logger.warn('A', 'b', 'filtered');
      logger.error('A', 'b', 'should pass');
      logger.critical('A', 'b', 'should pass');

      const testLines = capture.lines.filter(l => l.includes('[A.b]'));
      expect(testLines).toHaveLength(2);
      expect(testLines[0]).toContain('[ERROR]');
      expect(testLines[1]).toContain('[CRITICAL]');

      capture.restore();
      logger.dispose();
    });

    it('should show all messages when set to Trace level', () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Trace);

      logger.trace('X', 'y', 'msg1');
      logger.debug('X', 'y', 'msg2');
      logger.info('X', 'y', 'msg3');
      logger.warn('X', 'y', 'msg4');
      logger.error('X', 'y', 'msg5');
      logger.critical('X', 'y', 'msg6');

      const testLines = capture.lines.filter(l => l.includes('[X.y]'));
      expect(testLines).toHaveLength(6);

      capture.restore();
      logger.dispose();
    });

    it('should show only CRITICAL when set to Critical level', () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Critical);

      logger.trace('C', 'm', 'no');
      logger.debug('C', 'm', 'no');
      logger.info('C', 'm', 'no');
      logger.warn('C', 'm', 'no');
      logger.error('C', 'm', 'no');
      logger.critical('C', 'm', 'yes');

      const testLines = capture.lines.filter(l => l.includes('[C.m]'));
      expect(testLines).toHaveLength(1);
      expect(testLines[0]).toContain('[CRITICAL]');

      capture.restore();
      logger.dispose();
    });
  });

  describe('Log Format', () => {
    it('should format messages as [TIMESTAMP] [LEVEL] [ClassName.methodName] message', () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Trace);

      logger.info('MyService', 'doWork', 'processing item 42');

      const testLines = capture.lines.filter(l => l.includes('MyService'));
      expect(testLines).toHaveLength(1);

      const line = testLines[0]!;
      // Verify ISO timestamp format
      const timestampMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
      expect(timestampMatch).toBeTruthy();

      // Verify level
      expect(line).toContain('[INFO]');

      // Verify class.method context
      expect(line).toContain('[MyService.doWork]');

      // Verify message
      expect(line).toContain('processing item 42');

      // Verify full format order: timestamp, level, class.method, message
      const formatRegex = /^\[\d{4}-\d{2}-\d{2}T.*Z\] \[INFO\] \[MyService\.doWork\] processing item 42$/;
      expect(line).toMatch(formatRegex);

      capture.restore();
      logger.dispose();
    });

    it('should include class name and method context for each level', () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Trace);

      logger.trace('ClassA', 'method1', 'trace msg');
      logger.debug('ClassB', 'method2', 'debug msg');
      logger.info('ClassC', 'method3', 'info msg');
      logger.warn('ClassD', 'method4', 'warn msg');
      logger.error('ClassE', 'method5', 'error msg');
      logger.critical('ClassF', 'method6', 'critical msg');

      const testLines = capture.lines.filter(l => l.includes('Class'));
      expect(testLines[0]).toContain('[ClassA.method1]');
      expect(testLines[1]).toContain('[ClassB.method2]');
      expect(testLines[2]).toContain('[ClassC.method3]');
      expect(testLines[3]).toContain('[ClassD.method4]');
      expect(testLines[4]).toContain('[ClassE.method5]');
      expect(testLines[5]).toContain('[ClassF.method6]');

      capture.restore();
      logger.dispose();
    });
  });

  describe('Error Handling', () => {
    it('should include stack trace when error object is provided', () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Error);

      const testError = new Error('something went wrong');
      logger.error('Handler', 'process', 'failed to process', testError);

      const testLines = capture.lines.filter(l => l.includes('[Handler.process]'));
      expect(testLines.length).toBeGreaterThanOrEqual(2);
      expect(testLines[0]).toContain('failed to process');
      expect(testLines[1]).toContain('Stack:');

      capture.restore();
      logger.dispose();
    });

    it('should not include stack trace when no error object is provided', () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Error);

      logger.error('Handler', 'process', 'simple error message');

      const testLines = capture.lines.filter(l => l.includes('[Handler.process]'));
      expect(testLines).toHaveLength(1);
      expect(testLines[0]).not.toContain('Stack:');

      capture.restore();
      logger.dispose();
    });

    it('should not throw when logging at various levels', () => {
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Trace);

      expect(() => logger.error('T', 'm', 'test error')).not.toThrow();
      expect(() => logger.error('T', 'm', 'test error with stack', new Error('test'))).not.toThrow();
      expect(() => logger.warn('T', 'm', 'test warning')).not.toThrow();
      expect(() => logger.info('T', 'm', 'test info')).not.toThrow();
      expect(() => logger.debug('T', 'm', 'test debug')).not.toThrow();
      expect(() => logger.trace('T', 'm', 'test trace')).not.toThrow();
      expect(() => logger.critical('T', 'm', 'test critical')).not.toThrow();

      logger.dispose();
    });
  });

  describe('Generic log() Method', () => {
    it('should accept level enum and class/context/message arguments', () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Trace);

      logger.log(LogLevel.Info, 'Pipeline', 'run', 'started pipeline execution');

      const testLines = capture.lines.filter(l => l.includes('[Pipeline.run]'));
      expect(testLines).toHaveLength(1);
      expect(testLines[0]).toContain('[INFO]');
      expect(testLines[0]).toContain('started pipeline execution');

      capture.restore();
      logger.dispose();
    });

    it('should respect level filtering via generic log() method', () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Warn);

      logger.log(LogLevel.Debug, 'A', 'b', 'should be filtered');
      logger.log(LogLevel.Warn, 'A', 'b', 'should pass');

      const testLines = capture.lines.filter(l => l.includes('[A.b]'));
      expect(testLines).toHaveLength(1);
      expect(testLines[0]).toContain('[WARN]');

      capture.restore();
      logger.dispose();
    });
  });

  describe('parseLogLevel', () => {
    it('should parse valid level strings (case-insensitive)', () => {
      expect(parseLogLevel('trace')).toBe(LogLevel.Trace);
      expect(parseLogLevel('TRACE')).toBe(LogLevel.Trace);
      expect(parseLogLevel('Trace')).toBe(LogLevel.Trace);
      expect(parseLogLevel('debug')).toBe(LogLevel.Debug);
      expect(parseLogLevel('DEBUG')).toBe(LogLevel.Debug);
      expect(parseLogLevel('info')).toBe(LogLevel.Info);
      expect(parseLogLevel('INFO')).toBe(LogLevel.Info);
      expect(parseLogLevel('warn')).toBe(LogLevel.Warn);
      expect(parseLogLevel('WARN')).toBe(LogLevel.Warn);
      expect(parseLogLevel('error')).toBe(LogLevel.Error);
      expect(parseLogLevel('ERROR')).toBe(LogLevel.Error);
      expect(parseLogLevel('critical')).toBe(LogLevel.Critical);
      expect(parseLogLevel('CRITICAL')).toBe(LogLevel.Critical);
    });

    it('should default to Info for unknown strings', () => {
      expect(parseLogLevel('unknown')).toBe(LogLevel.Info);
      expect(parseLogLevel('')).toBe(LogLevel.Info);
      expect(parseLogLevel('verbose')).toBe(LogLevel.Info);
    });
  });

  describe('IDbLogger Interface', () => {
    it('should accept a dbLogger and pipeline run ID', () => {
      const logger = LoggerService.getInstance();

      const mockDbLogger: IDbLogger = {
        logPipelineEntry: vi.fn().mockResolvedValue(1),
      };

      logger.setDbLogger(mockDbLogger);
      logger.setPipelineRunId(42);
      expect(logger.getPipelineRunId()).toBe(42);

      logger.dispose();
    });

    it('should call dbLogger.logPipelineEntry when logging with DB logger set', async () => {
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Trace);

      const mockDbLogger: IDbLogger = {
        logPipelineEntry: vi.fn().mockResolvedValue(1),
      };

      logger.setDbLogger(mockDbLogger);
      logger.setPipelineRunId(100);

      logger.info('PipelineService', 'execute', 'processing repos');

      // Allow the async DB call to resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockDbLogger.logPipelineEntry).toHaveBeenCalledWith(
        100,
        'PipelineService',
        'execute',
        'processing repos',
        LogLevel.Info,
      );

      logger.dispose();
    });

    it('should not call dbLogger when pipeline run ID is not set', async () => {
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Trace);

      const mockDbLogger: IDbLogger = {
        logPipelineEntry: vi.fn().mockResolvedValue(1),
      };

      logger.setDbLogger(mockDbLogger);
      // Do NOT set pipeline run ID

      logger.info('Test', 'method', 'no run ID set');

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockDbLogger.logPipelineEntry).not.toHaveBeenCalled();

      logger.dispose();
    });

    it('should handle dbLogger errors gracefully', async () => {
      const capture = createOutputCaptureSpy();
      const logger = LoggerService.getInstance();
      logger.setLevel(LogLevel.Trace);

      const mockDbLogger: IDbLogger = {
        logPipelineEntry: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      };

      logger.setDbLogger(mockDbLogger);
      logger.setPipelineRunId(200);

      logger.info('Test', 'method', 'this will fail DB write');

      // Allow the async DB call to reject and error to be logged
      await new Promise(resolve => setTimeout(resolve, 50));

      const errorLines = capture.lines.filter(l => l.includes('DB logging failed'));
      expect(errorLines.length).toBeGreaterThanOrEqual(1);
      expect(errorLines[0]).toContain('DB connection failed');

      capture.restore();
      logger.dispose();
    });
  });

  describe('Output Channel', () => {
    it('should show output channel without throwing', () => {
      const logger = LoggerService.getInstance();
      expect(() => logger.show()).not.toThrow();
      logger.dispose();
    });
  });

  describe('Backward Compatibility', () => {
    it('should export Logger alias pointing to LoggerService', async () => {
      const { Logger } = await import('../../logging/logger.js');
      expect(Logger).toBe(LoggerService);
    });
  });
});

/**
 * Create a spy-based output capture that intercepts appendLine calls.
 * Uses vscode mock's createOutputChannel to capture all logged lines.
 * Must be called BEFORE LoggerService.getInstance() in each test
 * since the output channel is created during construction.
 */
function createOutputCaptureSpy(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];

  // We need to reset the singleton so the new output channel is used
  LoggerService.resetInstance();

  // Cast to allow reassignment of the mock's createOutputChannel
  const win = vscodeWindow as { createOutputChannel: typeof vscodeWindow.createOutputChannel };
  const originalFn = win.createOutputChannel;

  win.createOutputChannel = (_name: string) => ({
    appendLine: (value: string) => { lines.push(value); },
    append: (_value: string) => { /* noop */ },
    clear: () => { /* noop */ },
    show: () => { /* noop */ },
    hide: () => { /* noop */ },
    dispose: () => { /* noop */ },
  });

  return {
    lines,
    restore: () => {
      win.createOutputChannel = originalFn;
    },
  };
}
