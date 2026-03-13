import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { LoggerService } from '../../logging/logger.js';
import {
  MessageRateLimiter,
  DEFAULT_RATE_LIMIT_INTERVAL_MS,
} from '../../views/webview/message-rate-limiter.js';

/**
 * Unit tests for MessageRateLimiter (IQS-947).
 * Tests the rate limiting behavior for webview message handlers.
 *
 * Security hardening: CWE-770 - Allocation of Resources Without Limits
 */
describe('MessageRateLimiter', () => {
  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    vi.useFakeTimers();
  });

  afterEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create instance with default interval', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: DEFAULT_RATE_LIMIT_INTERVAL_MS,
        className: 'TestPanel',
      });

      expect(rateLimiter.getMinIntervalMs()).toBe(500);
    });

    it('should create instance with custom interval', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 1000,
        className: 'TestPanel',
      });

      expect(rateLimiter.getMinIntervalMs()).toBe(1000);
    });
  });

  describe('checkRateLimit', () => {
    it('should allow first message immediately', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      const result = rateLimiter.checkRateLimit('requestData');

      expect(result.allowed).toBe(true);
      expect(result.waitMs).toBe(0);
    });

    it('should block rapid subsequent messages', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      // First message allowed
      const first = rateLimiter.checkRateLimit('requestData');
      expect(first.allowed).toBe(true);

      // Immediate second message blocked
      const second = rateLimiter.checkRateLimit('requestData');
      expect(second.allowed).toBe(false);
      expect(second.waitMs).toBeGreaterThan(0);
      expect(second.waitMs).toBeLessThanOrEqual(500);
    });

    it('should allow message after interval has passed', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      // First message
      const first = rateLimiter.checkRateLimit('requestData');
      expect(first.allowed).toBe(true);

      // Advance time past the interval
      vi.advanceTimersByTime(501);

      // Second message should be allowed now
      const second = rateLimiter.checkRateLimit('requestData');
      expect(second.allowed).toBe(true);
      expect(second.waitMs).toBe(0);
    });

    it('should calculate correct wait time', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      // First message
      rateLimiter.checkRateLimit('requestData');

      // Advance time partially
      vi.advanceTimersByTime(200);

      // Second message should be blocked with ~300ms wait
      const second = rateLimiter.checkRateLimit('requestData');
      expect(second.allowed).toBe(false);
      expect(second.waitMs).toBe(300);
    });

    it('should track different message types independently', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      // First message type
      const firstA = rateLimiter.checkRateLimit('requestDataA');
      expect(firstA.allowed).toBe(true);

      // Different message type should be allowed immediately
      const firstB = rateLimiter.checkRateLimit('requestDataB');
      expect(firstB.allowed).toBe(true);

      // Same type as first should be blocked
      const secondA = rateLimiter.checkRateLimit('requestDataA');
      expect(secondA.allowed).toBe(false);

      // Same type as second should be blocked
      const secondB = rateLimiter.checkRateLimit('requestDataB');
      expect(secondB.allowed).toBe(false);
    });

    it('should reset wait time after each allowed message', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      // First message
      rateLimiter.checkRateLimit('requestData');

      // Wait and send another
      vi.advanceTimersByTime(501);
      rateLimiter.checkRateLimit('requestData');

      // Immediate message should be blocked
      const third = rateLimiter.checkRateLimit('requestData');
      expect(third.allowed).toBe(false);
      // Wait time should be close to 500ms since we just reset
      expect(third.waitMs).toBeGreaterThan(490);
    });
  });

  describe('reset', () => {
    it('should clear all rate limit state', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      // First message
      rateLimiter.checkRateLimit('requestDataA');
      rateLimiter.checkRateLimit('requestDataB');

      // Both should be blocked
      expect(rateLimiter.checkRateLimit('requestDataA').allowed).toBe(false);
      expect(rateLimiter.checkRateLimit('requestDataB').allowed).toBe(false);

      // Reset
      rateLimiter.reset();

      // Both should be allowed again
      expect(rateLimiter.checkRateLimit('requestDataA').allowed).toBe(true);
      expect(rateLimiter.checkRateLimit('requestDataB').allowed).toBe(true);
    });
  });

  describe('DEFAULT_RATE_LIMIT_INTERVAL_MS', () => {
    it('should be 500ms per IQS-947 specification', () => {
      expect(DEFAULT_RATE_LIMIT_INTERVAL_MS).toBe(500);
    });
  });

  describe('edge cases', () => {
    it('should allow message at exactly boundary timing', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      // First message
      rateLimiter.checkRateLimit('requestData');

      // Advance time exactly to boundary (500ms = minIntervalMs)
      // At exactly the boundary, elapsed >= minIntervalMs, so allowed
      vi.advanceTimersByTime(500);

      const second = rateLimiter.checkRateLimit('requestData');
      expect(second.allowed).toBe(true);
      expect(second.waitMs).toBe(0);
    });

    it('should block message just before boundary', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      // First message
      rateLimiter.checkRateLimit('requestData');

      // Advance time to 499ms (1ms before boundary)
      vi.advanceTimersByTime(499);

      // Should be blocked (need 1 more ms)
      const second = rateLimiter.checkRateLimit('requestData');
      expect(second.allowed).toBe(false);
      expect(second.waitMs).toBe(1);
    });

    it('should handle very rapid requests gracefully', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      // Simulate 100 rapid requests
      const results = [];
      for (let i = 0; i < 100; i++) {
        results.push(rateLimiter.checkRateLimit('requestData'));
      }

      // Only first should be allowed
      expect(results[0].allowed).toBe(true);
      for (let i = 1; i < 100; i++) {
        expect(results[i].allowed).toBe(false);
      }
    });

    it('should handle multiple message types with interleaved timing', () => {
      const rateLimiter = new MessageRateLimiter({
        minIntervalMs: 500,
        className: 'TestPanel',
      });

      // Type A at t=0
      rateLimiter.checkRateLimit('typeA');

      // Type B at t=100
      vi.advanceTimersByTime(100);
      rateLimiter.checkRateLimit('typeB');

      // Type A at t=400 (400ms since first A, should be blocked)
      vi.advanceTimersByTime(300);
      const thirdA = rateLimiter.checkRateLimit('typeA');
      expect(thirdA.allowed).toBe(false);
      expect(thirdA.waitMs).toBe(100); // Need 100 more ms

      // Type B at t=400 (300ms since first B, should be blocked)
      const thirdB = rateLimiter.checkRateLimit('typeB');
      expect(thirdB.allowed).toBe(false);
      expect(thirdB.waitMs).toBe(200); // Need 200 more ms

      // Type A at t=501 (should be allowed now)
      vi.advanceTimersByTime(101);
      expect(rateLimiter.checkRateLimit('typeA').allowed).toBe(true);

      // Type B at t=501 (still needs 99ms)
      const fourthB = rateLimiter.checkRateLimit('typeB');
      expect(fourthB.allowed).toBe(false);
      expect(fourthB.waitMs).toBe(99);
    });
  });
});
