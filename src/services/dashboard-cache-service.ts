/**
 * Dashboard Query Caching Service
 * Implements LRU cache with time-based expiration for dashboard queries.
 * Singleton instance shared across all dashboard panels for consistent caching.
 *
 * Security: CWE-20 (Input validation). Ticket: GITX-194
 *
 * @example
 * ```typescript
 * const cache = DashboardCacheService.getInstance();
 * const key = cache.buildKey('dev', 'john.doe', '30', 'getSummary');
 * const cached = cache.get<DevProfileSummary>(key);
 * if (!cached) {
 *   const data = await dataService.getSummary(filters);
 *   cache.set(key, data);
 * }
 * ```
 */

import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';

const CLASS_NAME = 'DashboardCacheService';

/**
 * Panel types supported for cache key organization.
 * Used as first segment in cache key format.
 */
export type CachePanelType = 'dev' | 'team' | 'org';

/**
 * Statistics about cache performance.
 * Useful for debugging and monitoring cache effectiveness.
 */
export interface CacheStats {
  /** Total cache hits since last reset */
  hits: number;
  /** Total cache misses since last reset */
  misses: number;
  /** Current number of entries in cache */
  size: number;
  /** Maximum configured cache size */
  maxSize: number;
  /** Default TTL in milliseconds */
  defaultTtlMs: number;
}

/**
 * Internal cache entry with value and expiration metadata.
 * Uses generics to maintain type safety for cached values.
 */
interface CacheEntry<T> {
  /** The cached value */
  value: T;
  /** Timestamp when entry expires (ms since epoch) */
  expiresAt: number;
  /** Timestamp when entry was last accessed (for LRU eviction) */
  lastAccessedAt: number;
}

/**
 * Dashboard Query Caching Service
 *
 * Provides a singleton LRU cache with time-based expiration for dashboard queries.
 * Key features:
 * - Singleton instance shared across all dashboard panels
 * - Time-based expiration (default 5 minutes, configurable via VS Code setting)
 * - LRU eviction when cache exceeds max size (default 100 entries)
 * - Manual invalidation by panel type and optional identifier
 * - Cache hit/miss logging for troubleshooting
 * - Auto-invalidation hook for pipeline run completion
 *
 * Cache key format: {panelType}:{identifier}:{timeframe}:{queryName}
 * Example: "dev:john.doe:30:getSummary"
 */
export class DashboardCacheService implements vscode.Disposable {
  private static instance: DashboardCacheService | undefined;

  private readonly logger: LoggerService;
  private readonly cache: Map<string, CacheEntry<unknown>>;
  private readonly configListener: vscode.Disposable;

  private maxSize: number;
  private defaultTtlMs: number;
  private hits = 0;
  private misses = 0;

  /**
   * Private constructor for singleton pattern.
   * Initializes cache and reads configuration from VS Code settings.
   */
  private constructor() {
    this.logger = LoggerService.getInstance();
    this.cache = new Map();

    // Read configuration from VS Code settings
    this.maxSize = this.readMaxSize();
    this.defaultTtlMs = this.readTtlMs();

    this.logger.debug(CLASS_NAME, 'constructor', `Cache initialized: maxSize=${this.maxSize}, ttlMs=${this.defaultTtlMs}`);

    // Listen for configuration changes
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gitr.dashboardCacheTtlMinutes')) {
        const oldTtl = this.defaultTtlMs;
        this.defaultTtlMs = this.readTtlMs();
        this.logger.debug(CLASS_NAME, 'onConfigChange', `TTL changed: ${oldTtl}ms -> ${this.defaultTtlMs}ms`);
      }
      if (e.affectsConfiguration('gitr.dashboardCacheMaxEntries')) {
        const oldMaxSize = this.maxSize;
        this.maxSize = this.readMaxSize();
        this.logger.debug(CLASS_NAME, 'onConfigChange', `Max size changed: ${oldMaxSize} -> ${this.maxSize}`);
        // If max size decreased, evict excess entries
        this.evictIfNeeded();
      }
    });
  }

  /**
   * Get the singleton DashboardCacheService instance.
   * Creates the instance on first call.
   *
   * @returns The singleton cache service instance
   */
  static getInstance(): DashboardCacheService {
    if (!DashboardCacheService.instance) {
      DashboardCacheService.instance = new DashboardCacheService();
    }
    return DashboardCacheService.instance;
  }

  /**
   * Reset the singleton instance. Used in tests to ensure clean state.
   * Callers should call dispose() first if the instance is active.
   */
  static resetInstance(): void {
    if (DashboardCacheService.instance) {
      DashboardCacheService.instance.dispose();
    }
    DashboardCacheService.instance = undefined;
  }

  /**
   * Build a cache key from components.
   * Format: {panelType}:{identifier}:{timeframe}:{queryName}
   *
   * @param panelType - The panel type (dev, team, org)
   * @param identifier - The entity identifier (developer name, team name, org ID)
   * @param timeframe - The timeframe in days (30, 60, 90, 180, 365, 730)
   * @param queryName - The query method name (e.g., 'getSummary', 'getLocPerWeek')
   * @returns The formatted cache key
   */
  buildKey(
    panelType: CachePanelType,
    identifier: string,
    timeframe: string,
    queryName: string
  ): string {
    // CWE-20: Input validation - sanitize identifier to prevent cache key injection
    const sanitizedIdentifier = this.sanitizeIdentifier(identifier);
    const sanitizedTimeframe = this.sanitizeTimeframe(timeframe);
    const sanitizedQueryName = this.sanitizeQueryName(queryName);

    return `${panelType}:${sanitizedIdentifier}:${sanitizedTimeframe}:${sanitizedQueryName}`;
  }

  /**
   * Get a cached value by key.
   * Returns undefined if not found or expired.
   * Updates last access time for LRU tracking.
   *
   * @param key - The cache key
   * @returns The cached value or undefined
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.misses++;
      this.logger.trace(CLASS_NAME, 'get', `Cache MISS: ${key}`);
      return undefined;
    }

    // Check expiration
    const now = Date.now();
    if (now > entry.expiresAt) {
      // Expired - remove and count as miss
      this.cache.delete(key);
      this.misses++;
      this.logger.debug(CLASS_NAME, 'get', `Cache EXPIRED: ${key}`);
      return undefined;
    }

    // Update last accessed time for LRU
    entry.lastAccessedAt = now;
    this.hits++;
    this.logger.trace(CLASS_NAME, 'get', `Cache HIT: ${key}`);

    return entry.value;
  }

  /**
   * Set a value in the cache.
   * Evicts oldest entries if cache exceeds max size.
   *
   * @param key - The cache key
   * @param value - The value to cache
   * @param ttlMs - Optional TTL in milliseconds (defaults to configured TTL)
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    const now = Date.now();

    const entry: CacheEntry<T> = {
      value,
      expiresAt: now + effectiveTtl,
      lastAccessedAt: now,
    };

    this.cache.set(key, entry as CacheEntry<unknown>);
    this.logger.trace(CLASS_NAME, 'set', `Cache SET: ${key} (ttl=${effectiveTtl}ms)`);

    // Evict if over capacity
    this.evictIfNeeded();
  }

  /**
   * Check if a key exists and is not expired.
   *
   * @param key - The cache key
   * @returns true if the key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Invalidate cache entries by panel type and optional identifier.
   * If identifier is provided, only entries for that identifier are invalidated.
   * If identifier is omitted, all entries for the panel type are invalidated.
   *
   * @param panelType - The panel type to invalidate (dev, team, org)
   * @param identifier - Optional identifier to narrow invalidation scope
   * @returns Number of entries invalidated
   */
  invalidate(panelType: CachePanelType, identifier?: string): number {
    const prefix = identifier
      ? `${panelType}:${this.sanitizeIdentifier(identifier)}:`
      : `${panelType}:`;

    let invalidated = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        invalidated++;
      }
    }

    this.logger.debug(
      CLASS_NAME,
      'invalidate',
      `Invalidated ${invalidated} entries for ${identifier ? `${panelType}:${identifier}` : panelType}`
    );

    return invalidated;
  }

  /**
   * Invalidate all cache entries.
   * Called when pipeline completes to ensure fresh data.
   *
   * @returns Number of entries invalidated
   */
  invalidateAll(): number {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.debug(CLASS_NAME, 'invalidateAll', `Invalidated all ${size} cache entries`);
    return size;
  }

  /**
   * Get cache statistics for monitoring and debugging.
   *
   * @returns Current cache statistics
   */
  getStats(): CacheStats {
    // Clean up expired entries before reporting stats
    this.cleanupExpired();

    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxSize: this.maxSize,
      defaultTtlMs: this.defaultTtlMs,
    };
  }

  /**
   * Reset statistics counters.
   * Useful for benchmarking or debugging specific operations.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.logger.debug(CLASS_NAME, 'resetStats', 'Cache statistics reset');
  }

  /**
   * Hook for pipeline completion.
   * Invalidates all cache entries to ensure fresh data after pipeline run.
   * Designed to be called from PipelineService after runPipeline() completes.
   */
  onPipelineComplete(): void {
    const invalidated = this.invalidateAll();
    this.logger.info(
      CLASS_NAME,
      'onPipelineComplete',
      `Pipeline complete: invalidated ${invalidated} cache entries`
    );
  }

  /**
   * Dispose resources and clear the singleton.
   */
  dispose(): void {
    this.configListener.dispose();
    this.cache.clear();
    this.logger.debug(CLASS_NAME, 'dispose', 'Cache service disposed');
    DashboardCacheService.instance = undefined;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Read max cache size from VS Code settings.
   * Falls back to default of 100 if not configured.
   */
  private readMaxSize(): number {
    const config = vscode.workspace.getConfiguration('gitr');
    const maxEntries = config.get<number>('dashboardCacheMaxEntries', 100);
    // CWE-20: Validate range
    return Math.max(1, Math.min(maxEntries, 10000));
  }

  /**
   * Read TTL in milliseconds from VS Code settings.
   * Configured in minutes, converted to milliseconds.
   * Falls back to default of 5 minutes if not configured.
   */
  private readTtlMs(): number {
    const config = vscode.workspace.getConfiguration('gitr');
    const ttlMinutes = config.get<number>('dashboardCacheTtlMinutes', 5);
    // CWE-20: Validate range (1 minute to 1 hour)
    const validMinutes = Math.max(1, Math.min(ttlMinutes, 60));
    return validMinutes * 60 * 1000;
  }

  /**
   * Sanitize identifier to prevent cache key injection.
   * Replaces colons with underscores to preserve key structure.
   */
  private sanitizeIdentifier(identifier: string): string {
    // Replace colons (key delimiter) and control characters
    return identifier
      .replace(/:/g, '_')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .substring(0, 200); // Limit length
  }

  /**
   * Sanitize timeframe to ensure valid format.
   * Only allows known timeframe values.
   */
  private sanitizeTimeframe(timeframe: string): string {
    const validTimeframes = ['30', '60', '90', '180', '365', '730'];
    return validTimeframes.includes(timeframe) ? timeframe : '30';
  }

  /**
   * Sanitize query name to prevent cache key injection.
   * Only allows alphanumeric characters and underscores.
   */
  private sanitizeQueryName(queryName: string): string {
    return queryName
      .replace(/[^a-zA-Z0-9_]/g, '')
      .substring(0, 100);
  }

  /**
   * Evict entries if cache exceeds max size using LRU policy.
   * Removes least recently accessed entries until under capacity.
   */
  private evictIfNeeded(): void {
    while (this.cache.size > this.maxSize) {
      // Find LRU entry (oldest lastAccessedAt)
      let lruKey: string | null = null;
      let lruTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastAccessedAt < lruTime) {
          lruTime = entry.lastAccessedAt;
          lruKey = key;
        }
      }

      if (lruKey) {
        this.cache.delete(lruKey);
        this.logger.debug(CLASS_NAME, 'evictIfNeeded', `LRU eviction: ${lruKey}`);
      } else {
        break;
      }
    }
  }

  /**
   * Remove all expired entries from cache.
   * Called before reporting stats to provide accurate size.
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      this.logger.debug(CLASS_NAME, 'cleanupExpired', `Cleaned up ${expiredCount} expired entries`);
    }
  }
}
