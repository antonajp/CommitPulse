/**
 * Unit tests for DashboardCacheService.
 * Ticket: GITX-194
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DashboardCacheService, type CachePanelType, type CacheStats } from '../../services/dashboard-cache-service.js';

// Mock vscode module
vi.mock('vscode', () => {
  const configValues: Record<string, unknown> = {
    'dashboardCacheTtlMinutes': 5,
    'dashboardCacheMaxEntries': 100,
    'logLevel': 'INFO',
  };

  const configChangeCallbacks: ((e: { affectsConfiguration: (key: string) => boolean }) => void)[] = [];

  return {
    window: {
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        show: vi.fn(),
        dispose: vi.fn(),
      })),
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue),
      })),
      onDidChangeConfiguration: vi.fn((callback: (e: { affectsConfiguration: (key: string) => boolean }) => void) => {
        configChangeCallbacks.push(callback);
        return { dispose: vi.fn() };
      }),
    },
    // Export config change helpers for tests
    __triggerConfigChange: (key: string) => {
      configChangeCallbacks.forEach(cb => cb({
        affectsConfiguration: (k: string) => k === key,
      }));
    },
    __setConfigValue: (key: string, value: unknown) => {
      configValues[key] = value;
    },
  };
});

describe('DashboardCacheService', () => {
  let cache: DashboardCacheService;

  beforeEach(() => {
    // Reset singleton before each test
    DashboardCacheService.resetInstance();
    cache = DashboardCacheService.getInstance();
  });

  afterEach(() => {
    DashboardCacheService.resetInstance();
    vi.clearAllMocks();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = DashboardCacheService.getInstance();
      const instance2 = DashboardCacheService.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = DashboardCacheService.getInstance();
      DashboardCacheService.resetInstance();
      const instance2 = DashboardCacheService.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('buildKey', () => {
    it('should build key with correct format', () => {
      const key = cache.buildKey('dev', 'john.doe', '30', 'getSummary');
      expect(key).toBe('dev:john.doe:30:getSummary');
    });

    it('should sanitize identifier with colons', () => {
      const key = cache.buildKey('dev', 'test:user:name', '30', 'getSummary');
      expect(key).toBe('dev:test_user_name:30:getSummary');
    });

    it('should sanitize invalid timeframe to default', () => {
      const key = cache.buildKey('team', 'Engineering', 'invalid', 'getTeams');
      expect(key).toBe('team:Engineering:30:getTeams');
    });

    it('should handle all valid panel types', () => {
      const panelTypes: CachePanelType[] = ['dev', 'team', 'org'];
      panelTypes.forEach(panelType => {
        const key = cache.buildKey(panelType, 'test', '60', 'query');
        expect(key.startsWith(`${panelType}:`)).toBe(true);
      });
    });

    it('should handle all valid timeframes', () => {
      const timeframes = ['30', '60', '90', '180', '365', '730'];
      timeframes.forEach(timeframe => {
        const key = cache.buildKey('dev', 'test', timeframe, 'query');
        expect(key).toContain(`:${timeframe}:`);
      });
    });

    it('should sanitize query name with special characters', () => {
      const key = cache.buildKey('dev', 'test', '30', 'get:Summary!@#$');
      expect(key).toBe('dev:test:30:getSummary');
    });

    it('should truncate long identifiers', () => {
      const longIdentifier = 'a'.repeat(300);
      const key = cache.buildKey('dev', longIdentifier, '30', 'query');
      expect(key.length).toBeLessThan(350); // panelType:truncatedIdentifier:timeframe:query
    });
  });

  describe('get/set', () => {
    it('should return undefined for non-existent key', () => {
      const result = cache.get<string>('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should store and retrieve value', () => {
      const key = 'dev:test:30:query';
      const value = { data: 'test' };

      cache.set(key, value);
      const result = cache.get<typeof value>(key);

      expect(result).toEqual(value);
    });

    it('should return undefined for expired entry', async () => {
      const key = 'dev:test:30:query';
      const value = { data: 'test' };

      cache.set(key, value, 50); // 50ms TTL

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = cache.get<typeof value>(key);
      expect(result).toBeUndefined();
    });

    it('should count hits and misses', () => {
      const key = 'dev:test:30:query';
      cache.set(key, 'value');

      cache.get(key); // Hit
      cache.get(key); // Hit
      cache.get('nonexistent'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should preserve type safety', () => {
      interface TestData {
        name: string;
        count: number;
      }

      const key = 'dev:test:30:query';
      const value: TestData = { name: 'test', count: 42 };

      cache.set<TestData>(key, value);
      const result = cache.get<TestData>(key);

      expect(result?.name).toBe('test');
      expect(result?.count).toBe(42);
    });
  });

  describe('has', () => {
    it('should return false for non-existent key', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should return true for existing valid key', () => {
      const key = 'dev:test:30:query';
      cache.set(key, 'value');
      expect(cache.has(key)).toBe(true);
    });

    it('should return false for expired key', async () => {
      const key = 'dev:test:30:query';
      cache.set(key, 'value', 50); // 50ms TTL

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(cache.has(key)).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('should invalidate all entries for panel type', () => {
      cache.set('dev:user1:30:query1', 'value1');
      cache.set('dev:user2:60:query2', 'value2');
      cache.set('team:team1:30:query1', 'value3');

      const invalidated = cache.invalidate('dev');

      expect(invalidated).toBe(2);
      expect(cache.has('dev:user1:30:query1')).toBe(false);
      expect(cache.has('dev:user2:60:query2')).toBe(false);
      expect(cache.has('team:team1:30:query1')).toBe(true);
    });

    it('should invalidate entries for specific identifier', () => {
      cache.set('dev:user1:30:query1', 'value1');
      cache.set('dev:user1:60:query2', 'value2');
      cache.set('dev:user2:30:query1', 'value3');

      const invalidated = cache.invalidate('dev', 'user1');

      expect(invalidated).toBe(2);
      expect(cache.has('dev:user1:30:query1')).toBe(false);
      expect(cache.has('dev:user1:60:query2')).toBe(false);
      expect(cache.has('dev:user2:30:query1')).toBe(true);
    });

    it('should return 0 when no entries match', () => {
      cache.set('team:team1:30:query', 'value');

      const invalidated = cache.invalidate('dev');

      expect(invalidated).toBe(0);
    });
  });

  describe('invalidateAll', () => {
    it('should clear all entries', () => {
      cache.set('dev:user1:30:query', 'value1');
      cache.set('team:team1:60:query', 'value2');
      cache.set('org:1:90:query', 'value3');

      const invalidated = cache.invalidateAll();

      expect(invalidated).toBe(3);
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.get('key1'); // Hit
      cache.get('nonexistent'); // Miss

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.maxSize).toBe(100);
      expect(stats.defaultTtlMs).toBe(5 * 60 * 1000);
    });
  });

  describe('resetStats', () => {
    it('should reset hit and miss counters', () => {
      cache.set('key', 'value');
      cache.get('key');
      cache.get('nonexistent');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(1); // Size should not be affected
    });
  });

  describe('onPipelineComplete', () => {
    it('should invalidate all cache entries', () => {
      cache.set('dev:user1:30:query', 'value1');
      cache.set('team:team1:60:query', 'value2');

      cache.onPipelineComplete();

      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entries when over capacity', async () => {
      // Create a cache with low max size for testing
      DashboardCacheService.resetInstance();

      // Mock config to return maxSize of 3
      const vscode = await import('vscode');
      (vscode as unknown as { __setConfigValue: (k: string, v: unknown) => void }).__setConfigValue('dashboardCacheMaxEntries', 3);

      cache = DashboardCacheService.getInstance();

      // Add entries
      cache.set('key1', 'value1');
      await new Promise(resolve => setTimeout(resolve, 10));
      cache.set('key2', 'value2');
      await new Promise(resolve => setTimeout(resolve, 10));
      cache.set('key3', 'value3');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Access key1 to make it recently used
      cache.get('key1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add a 4th entry - should evict key2 (LRU)
      cache.set('key4', 'value4');

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false); // Evicted
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should clear cache and reset singleton', () => {
      cache.set('key', 'value');

      cache.dispose();

      // After dispose, getInstance should create new instance
      const newCache = DashboardCacheService.getInstance();
      expect(newCache).not.toBe(cache);
      expect(newCache.getStats().size).toBe(0);
    });
  });
});
