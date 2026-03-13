/**
 * Rate limiter for webview message handlers.
 * Implements debounce/throttle pattern to prevent excessive message handling.
 *
 * Security hardening (IQS-947, CWE-770):
 * A malicious or malfunctioning webview could rapidly send messages,
 * triggering excessive database queries. This rate limiter enforces
 * a minimum interval between message handler invocations.
 *
 * @module message-rate-limiter
 */

import { LoggerService } from '../../logging/logger.js';

/**
 * Default minimum interval between message handler invocations (milliseconds).
 * Per IQS-947 security recommendation: 500ms minimum.
 */
export const DEFAULT_RATE_LIMIT_INTERVAL_MS = 500;

/**
 * Configuration for rate limiter instance.
 */
export interface RateLimiterConfig {
  /** Minimum interval between handler invocations in milliseconds */
  readonly minIntervalMs: number;
  /** Class name for logging context */
  readonly className: string;
}

/**
 * Result of a rate limit check.
 */
export interface RateLimitCheckResult {
  /** Whether the message should be processed */
  readonly allowed: boolean;
  /** Milliseconds until the next message will be allowed (0 if allowed now) */
  readonly waitMs: number;
}

/**
 * Rate limiter for webview message handlers.
 *
 * Usage:
 * ```typescript
 * const rateLimiter = new MessageRateLimiter({
 *   minIntervalMs: 500,
 *   className: 'VelocityChartPanel',
 * });
 *
 * // In message handler:
 * const check = rateLimiter.checkRateLimit('requestVelocityData');
 * if (!check.allowed) {
 *   this.logger.debug('Rate limited, wait ' + check.waitMs + 'ms');
 *   return;
 * }
 * // Process message...
 * ```
 *
 * @class MessageRateLimiter
 */
export class MessageRateLimiter {
  private readonly config: RateLimiterConfig;
  private readonly logger: LoggerService;
  private readonly lastMessageTime: Map<string, number> = new Map();

  /**
   * Create a new rate limiter instance.
   *
   * @param config - Rate limiter configuration
   */
  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.logger = LoggerService.getInstance();
    this.logger.debug(
      config.className,
      'MessageRateLimiter',
      `Rate limiter initialized with ${config.minIntervalMs}ms interval`,
    );
  }

  /**
   * Check if a message of the given type should be processed.
   * Updates the last message timestamp if allowed.
   *
   * @param messageType - The type of message being handled
   * @returns Rate limit check result indicating if processing is allowed
   */
  checkRateLimit(messageType: string): RateLimitCheckResult {
    const now = Date.now();
    const lastTime = this.lastMessageTime.get(messageType) ?? 0;
    const elapsed = now - lastTime;

    if (elapsed < this.config.minIntervalMs) {
      const waitMs = this.config.minIntervalMs - elapsed;
      this.logger.trace(
        this.config.className,
        'checkRateLimit',
        `Rate limited: ${messageType} (wait ${waitMs}ms)`,
      );
      return { allowed: false, waitMs };
    }

    // Update timestamp and allow processing
    this.lastMessageTime.set(messageType, now);
    this.logger.trace(
      this.config.className,
      'checkRateLimit',
      `Allowed: ${messageType} (elapsed ${elapsed}ms)`,
    );
    return { allowed: true, waitMs: 0 };
  }

  /**
   * Reset the rate limiter state.
   * Useful for testing or when the panel is being disposed.
   */
  reset(): void {
    this.lastMessageTime.clear();
    this.logger.debug(
      this.config.className,
      'MessageRateLimiter',
      'Rate limiter state reset',
    );
  }

  /**
   * Get the minimum interval configured for this rate limiter.
   *
   * @returns Minimum interval in milliseconds
   */
  getMinIntervalMs(): number {
    return this.config.minIntervalMs;
  }
}
